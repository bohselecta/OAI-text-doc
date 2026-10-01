import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store.mjs';
import { createDocumentService } from '../src/adapters/service.mjs';
import { RehearsalProvider } from '../src/server/provider.mjs';
import { fail } from '../src/core/contracts.mjs';
import { RECOVERY } from '../src/core/templates.mjs';
// This suite reuses the native HTTP journey expectations against the async API
// adapter. SQLite here is only a service fixture; Neon has a separate SQL suite.
async function setup(t,provider=new RehearsalProvider()){
  const store=new Store();t.after(()=>store.close());
  const pending=new Set();
  const dispatch=createDocumentService({store,provider,inference:async(actor,fn)=>{
    const key=actor.tenant+':'+actor.sub;if(pending.has(key))fail(409,'BUSY','Operation running.');pending.add(key);
    try{return await fn();}finally{pending.delete(key);}
  }});
  const request=(path,body,headers={})=>dispatch({sub:headers['x-test-sub']??'alice',tenant:headers['x-test-tenant']??'acme',role:headers['x-test-role']??'admin'},{path:'/api'+path,method:body===undefined?'GET':'POST',body});
  const d=(await request('/documents',{type:'example'})).body;
  return {request,d};
}
async function repair(request,d){const p=(await request(`/documents/${d.id}/proposals`,{sectionId:'recovery',instruction:'Define recovery behavior',revision:d.revision})).body;return (await request(`/documents/${d.id}/accept`,{proposalId:p.id})).body;}
test('hosted service: HTTP edit / accept / export exercises actual durable service',async t=>{const {request,d}=await setup(t);const next=await repair(request,d);assert.equal(next.revision,2);assert.equal(next.sections.find(s=>s.id==='recovery').content,RECOVERY);const audit=(await request(`/documents/${d.id}/audit`,{revision:2,target:'codex',semantic:false})).body;assert.equal(audit.findings.filter(f=>f.severity==='blocker').length,0);const exported=await request(`/documents/${d.id}/export`,{auditId:audit.id,format:'md'});assert.equal(exported.status,200);assert.match(exported.body,/DRAFT EXPORT — NOT AN AUDITED RELEASE/);for(const s of next.sections)assert.ok(exported.body.includes(s.content));});
test('hosted service: API never accepts a whole-document patch on the proposal endpoint',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go',sections:[]});assert.equal(r.status,400);assert.equal((await request(`/documents/${d.id}`)).body.revision,1);});
test('hosted service: API rejects viewer writes and conceals cross-tenant source',async t=>{const {request,d}=await setup(t);assert.equal((await request('/documents',{type:'example'},{'x-test-role':'viewer'})).status,403);assert.equal((await request(`/documents/${d.id}`,undefined,{'x-test-tenant':'other'})).status,404);});
test('hosted service: scope-violating model response is rejected at the server',async t=>{const provider={mode:'test',model:'fixture',edit:async()=>({sectionId:'other',content:'Injected'})};const {request,d}=await setup(t,provider);const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});assert.equal(r.status,502);assert.equal(r.body.error.code,'SCOPE_VIOLATION');assert.equal((await request(`/documents/${d.id}`)).body.revision,1);});
test('hosted service: locked source cannot invoke the model',async t=>{let called=false;const {request,d}=await setup(t,{mode:'test',model:'fixture',edit:async()=>{called=true;return{};}});assert.equal((await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'constraints',instruction:'Go'})).status,423);assert.equal(called,false);});
test('hosted service: audit is read-only and never repairs source behind the user',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/audit`,{revision:1,target:'codex'});assert.equal(r.status,201);assert.ok(r.body.findings.some(f=>f.code==='UNRESOLVED'));assert.deepEqual((await request(`/documents/${d.id}`)).body,d);});
test('hosted service: a client cannot forge semantic findings or a passing status',async t=>{const {request,d}=await setup(t);assert.equal((await request(`/documents/${d.id}/audit`,{revision:1,semantic:false,status:'completed',findings:[]})).status,400);});
test('hosted service: rehearsal cannot publish a falsely audited release',async t=>{const {request,d}=await setup(t);const next=await repair(request,d),a=(await request(`/documents/${d.id}/audit`,{revision:next.revision})).body;const r=await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]});assert.equal(r.status,409);assert.equal(r.body.error.code,'AUDIT_BLOCKED');});
test('hosted service: rehearsal semantic request fails explicitly',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/audit`,{revision:1,semantic:true});assert.equal(r.status,503);assert.equal(r.body.error.code,'MODEL_REQUIRED');});
test('hosted service: both mock model reviews enable a release only on complete source',async t=>{
 const phases=[];const provider={mode:'test',model:'test-fixture',reviewModel:'test-reviewer',edit:async(_d,s)=>({sectionId:s.id,content:RECOVERY}),review:async(d,_c,phase)=>{phases.push(phase);return{findings:[],coveredSectionIds:d.sections.map(s=>s.id)};}};
 const {request,d}=await setup(t,provider),next=await repair(request,d),a=(await request(`/documents/${d.id}/audit`,{revision:next.revision,semantic:true})).body;
 assert.deepEqual(phases,['semantic','freshReader']);const r=await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]});assert.equal(r.status,201);assert.equal(r.body.revision,2);assert.match(r.body.content,/test-reviewer/);assert.match(r.body.content,/NOT execution proof/);
});
test('hosted service: semantic review cannot make structural blockers disappear',async t=>{const provider={mode:'test',model:'fixture',review:async d=>({findings:[],coveredSectionIds:d.sections.map(s=>s.id)})};const {request,d}=await setup(t,provider),a=(await request(`/documents/${d.id}/audit`,{revision:1,semantic:true})).body;assert.ok(a.findings.some(f=>f.severity==='blocker'));assert.equal((await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]})).status,409);});
test('hosted service: hallucinated review citations fail closed',async t=>{const provider={mode:'test',model:'fixture',review:async d=>({coveredSectionIds:d.sections.map(s=>s.id),findings:[{severity:'warning',message:'Risk',sectionIds:['intent'],quote:'Not in the source'}]})};const {request,d}=await setup(t,provider);const r=await request(`/documents/${d.id}/audit`,{revision:1,semantic:true});assert.equal(r.status,502);assert.equal(r.body.error.code,'REVIEW_PROVENANCE');});
test('hosted service: audit budget includes the complete exported file, not just source',async t=>{const {request,d}=await setup(t);const a=(await request(`/documents/${d.id}/audit`,{revision:1})).body;const exported=await request(`/documents/${d.id}/export`,{auditId:a.id,format:'txt'});assert.ok(a.compiled.budget.units>=Buffer.byteLength(exported.body));});
test('hosted service: profile changes are explicit and preserve existing source',async t=>{const {request,d}=await setup(t);const next=(await request(`/documents/${d.id}/profiles`,{revision:1,profiles:['software','research']})).body;assert.ok(next.sections.some(s=>s.kind==='method'&&!s.content));for(const s of d.sections)assert.deepEqual(next.sections.find(x=>x.id===s.id),s);});
test('hosted service: adding a section cannot overwrite an existing one',async t=>{const {request,d}=await setup(t);const next=(await request(`/documents/${d.id}/sections`,{revision:1,title:'Notes',kind:'reference'})).body;assert.equal(next.sections.length,d.sections.length+1);assert.deepEqual(next.sections.slice(0,-1),d.sections);});
test('hosted service: stale response after an in-flight model call is rejected',async t=>{
 let resolve,startedResolve;const started=new Promise(r=>startedResolve=r);const wait=new Promise(r=>resolve=r);
 const provider={mode:'test',model:'fixture',edit:async(_d,s)=>{startedResolve();await wait;return{sectionId:s.id,content:'New intent'};}};
 const {request,d}=await setup(t,provider);const pending=request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});await started;
 const change=await request(`/documents/${d.id}/lock`,{revision:1,sectionId:'outcome',locked:true},{'x-test-sub':'bob'});assert.equal(change.status,200);resolve();const result=await pending;assert.equal(result.status,409);assert.equal((await request(`/documents/${d.id}`)).body.sections[0].content,d.sections[0].content);
});
test('hosted service: concurrent model requests from one editor do not duplicate spend',async t=>{
 let resolve,signal;const wait=new Promise(r=>resolve=r),started=new Promise(r=>signal=r);const provider={mode:'test',model:'fixture',edit:async(_d,s)=>{signal();await wait;return{sectionId:s.id,content:'New'};}};
 const {request,d}=await setup(t,provider);const pending=request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});await started;
 const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go again'});assert.equal(r.status,409);assert.equal(r.body.error.code,'BUSY');resolve();await pending;
});
test('hosted service: HTTP body size limit rejects large source without creating a document',async t=>{const {request}=await setup(t);const r=await request('/documents',{type:'import',source:'x'.repeat(1000001)});assert.equal(r.status,413);assert.equal((await request('/documents')).body.length,1);});
