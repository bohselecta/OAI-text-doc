import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as rawRequest } from 'node:http';
import { createApp } from '../src/server/app.mjs';
import { RECOVERY } from '../src/core/templates.mjs';
async function setup(t,provider){
 const config={db:':memory:',auth:'local',host:'127.0.0.1',provider:'rehearsal',origin:'http://127.0.0.1:0',production:false};
 const app=createApp(config,{provider,authenticate:req=>({sub:req.headers['x-test-sub']??'alice',tenant:req.headers['x-test-tenant']??'acme',role:req.headers['x-test-role']??'admin'})});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');config.origin=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.store.close();});
 const request=async(path,body,headers={})=>{const res=await fetch(config.origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,headers:res.headers,body:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};};
 const d=(await request('/documents',{type:'example'})).body;
 return {app,request,d,config};
}
async function repair(request,d){const p=(await request(`/documents/${d.id}/proposals`,{sectionId:'recovery',instruction:'Define recovery behavior',revision:d.revision})).body;return (await request(`/documents/${d.id}/accept`,{proposalId:p.id})).body;}
test('HTTP edit / accept / export exercises actual durable service',async t=>{const {request,d}=await setup(t);const next=await repair(request,d);assert.equal(next.revision,2);assert.equal(next.sections.find(s=>s.id==='recovery').content,RECOVERY);const audit=(await request(`/documents/${d.id}/audit`,{revision:2,target:'codex',semantic:false})).body;assert.equal(audit.findings.filter(f=>f.severity==='blocker').length,0);const exported=await request(`/documents/${d.id}/export`,{auditId:audit.id,format:'md'});assert.equal(exported.status,200);assert.match(exported.body,/DRAFT EXPORT — NOT AN AUDITED RELEASE/);for(const s of next.sections)assert.ok(exported.body.includes(s.content));});
test('API never accepts a whole-document patch on the proposal endpoint',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go',sections:[]});assert.equal(r.status,400);assert.equal((await request(`/documents/${d.id}`)).body.revision,1);});
test('cross-origin writes are rejected',async t=>{const {request}=await setup(t);assert.equal((await request('/documents',{type:'example'},{Origin:'https://evil.example'})).status,403);});
test('unrecognized host is rejected even without Origin',async t=>{
 const {config}=await setup(t);
 // Node fetch normalizes Host. Use the wire-level client to test DNS-rebinding defense.
 const status=await new Promise((resolve,reject)=>{const req=rawRequest(config.origin+'/api/session',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
 assert.equal(status,403);
});
test('cross-site browser requests are rejected',async t=>{const {request}=await setup(t);assert.equal((await request('/session',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);});
test('API rejects viewer writes and conceals cross-tenant source',async t=>{const {request,d}=await setup(t);assert.equal((await request('/documents',{type:'example'},{'x-test-role':'viewer'})).status,403);assert.equal((await request(`/documents/${d.id}`,undefined,{'x-test-tenant':'other'})).status,404);});
test('scope-violating model response is rejected at the server',async t=>{const provider={mode:'test',model:'fixture',edit:async()=>({sectionId:'other',content:'Injected'})};const {request,d}=await setup(t,provider);const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});assert.equal(r.status,502);assert.equal(r.body.error.code,'SCOPE_VIOLATION');assert.equal((await request(`/documents/${d.id}`)).body.revision,1);});
test('locked source cannot invoke the model',async t=>{let called=false;const {request,d}=await setup(t,{mode:'test',model:'fixture',edit:async()=>{called=true;return{};}});assert.equal((await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'constraints',instruction:'Go'})).status,423);assert.equal(called,false);});
test('audit is read-only and never repairs source behind the user',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/audit`,{revision:1,target:'codex'});assert.equal(r.status,201);assert.ok(r.body.findings.some(f=>f.code==='UNRESOLVED'));assert.deepEqual((await request(`/documents/${d.id}`)).body,d);});
test('a client cannot forge semantic findings or a passing status',async t=>{const {request,d}=await setup(t);assert.equal((await request(`/documents/${d.id}/audit`,{revision:1,semantic:false,status:'completed',findings:[]})).status,400);});
test('rehearsal cannot publish a falsely audited release',async t=>{const {request,d}=await setup(t);const next=await repair(request,d),a=(await request(`/documents/${d.id}/audit`,{revision:next.revision})).body;const r=await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]});assert.equal(r.status,409);assert.equal(r.body.error.code,'AUDIT_BLOCKED');});
test('rehearsal semantic request fails explicitly',async t=>{const {request,d}=await setup(t);const r=await request(`/documents/${d.id}/audit`,{revision:1,semantic:true});assert.equal(r.status,503);assert.equal(r.body.error.code,'MODEL_REQUIRED');});
test('both mock model reviews enable a release only on complete source',async t=>{
 const phases=[];const provider={mode:'test',model:'test-fixture',reviewModel:'test-reviewer',edit:async(_d,s)=>({sectionId:s.id,content:RECOVERY}),review:async(d,_c,phase)=>{phases.push(phase);return{findings:[],coveredSectionIds:d.sections.map(s=>s.id)};}};
 const {request,d}=await setup(t,provider),next=await repair(request,d),a=(await request(`/documents/${d.id}/audit`,{revision:next.revision,semantic:true})).body;
 assert.deepEqual(phases,['semantic','freshReader']);const r=await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]});assert.equal(r.status,201);assert.equal(r.body.revision,2);assert.match(r.body.content,/test-reviewer/);assert.match(r.body.content,/NOT execution proof/);
});
test('semantic review cannot make structural blockers disappear',async t=>{const provider={mode:'test',model:'fixture',review:async d=>({findings:[],coveredSectionIds:d.sections.map(s=>s.id)})};const {request,d}=await setup(t,provider),a=(await request(`/documents/${d.id}/audit`,{revision:1,semantic:true})).body;assert.ok(a.findings.some(f=>f.severity==='blocker'));assert.equal((await request(`/documents/${d.id}/publish`,{auditId:a.id,acknowledged:[]})).status,409);});
test('hallucinated review citations fail closed',async t=>{const provider={mode:'test',model:'fixture',review:async d=>({coveredSectionIds:d.sections.map(s=>s.id),findings:[{severity:'warning',message:'Risk',sectionIds:['intent'],quote:'Not in the source'}]})};const {request,d}=await setup(t,provider);const r=await request(`/documents/${d.id}/audit`,{revision:1,semantic:true});assert.equal(r.status,502);assert.equal(r.body.error.code,'REVIEW_PROVENANCE');});
test('audit budget includes the complete exported file, not just source',async t=>{const {request,d}=await setup(t);const a=(await request(`/documents/${d.id}/audit`,{revision:1})).body;const exported=await request(`/documents/${d.id}/export`,{auditId:a.id,format:'txt'});assert.ok(a.compiled.budget.units>=Buffer.byteLength(exported.body));});
test('profile changes are explicit and preserve existing source',async t=>{const {request,d}=await setup(t);const next=(await request(`/documents/${d.id}/profiles`,{revision:1,profiles:['software','research']})).body;assert.ok(next.sections.some(s=>s.kind==='method'&&!s.content));for(const s of d.sections)assert.deepEqual(next.sections.find(x=>x.id===s.id),s);});
test('adding a section cannot overwrite an existing one',async t=>{const {request,d}=await setup(t);const next=(await request(`/documents/${d.id}/sections`,{revision:1,title:'Notes',kind:'reference'})).body;assert.equal(next.sections.length,d.sections.length+1);assert.deepEqual(next.sections.slice(0,-1),d.sections);});
test('stale response after an in-flight model call is rejected',async t=>{
 let resolve,startedResolve;const started=new Promise(r=>startedResolve=r);const wait=new Promise(r=>resolve=r);
 const provider={mode:'test',model:'fixture',edit:async(_d,s)=>{startedResolve();await wait;return{sectionId:s.id,content:'New intent'};}};
 const {request,d}=await setup(t,provider);const pending=request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});await started;
 const change=await request(`/documents/${d.id}/lock`,{revision:1,sectionId:'outcome',locked:true},{'x-test-sub':'bob'});assert.equal(change.status,200);resolve();const result=await pending;assert.equal(result.status,409);assert.equal((await request(`/documents/${d.id}`)).body.sections[0].content,d.sections[0].content);
});
test('concurrent model requests from one editor do not duplicate spend',async t=>{
 let resolve,signal;const wait=new Promise(r=>resolve=r),started=new Promise(r=>signal=r);const provider={mode:'test',model:'fixture',edit:async(_d,s)=>{signal();await wait;return{sectionId:s.id,content:'New'};}};
 const {request,d}=await setup(t,provider);const pending=request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go'});await started;
 const r=await request(`/documents/${d.id}/proposals`,{revision:1,sectionId:'intent',instruction:'Go again'});assert.equal(r.status,409);assert.equal(r.body.error.code,'BUSY');resolve();await pending;
});
test('security headers do not allow script eval or external framing',async t=>{const {request}=await setup(t);const r=await request('/session');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.ok(!r.headers.get('content-security-policy').includes('unsafe-eval'));assert.equal(r.headers.get('cache-control'),'no-store');});
test('HTTP body size limit rejects large source without creating a document',async t=>{const {request}=await setup(t);const r=await request('/documents',{type:'import',source:'x'.repeat(1000001)});assert.equal(r.status,413);assert.equal((await request('/documents')).body.length,1);});
