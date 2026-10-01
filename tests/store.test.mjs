import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.mjs';
import { example, RECOVERY } from '../src/core/templates.mjs';
import { compile, structuralAudit, sourceHash } from '../src/core/compiler.mjs';
const actor={sub:'alice',tenant:'acme',role:'admin'};
const other={sub:'eve',tenant:'other',role:'admin'};
function setup(t){const s=new Store();t.after(()=>s.close());const input=example();input.sections.find(s=>s.id==='recovery').content=RECOVERY;const d=s.create(actor,input);return {s,d};}
function proposal(s,d,id='intent',after='A clearer goal.'){return s.addProposal(actor,d,d.sections.find(s=>s.id===id),'Make it clearer.',after,'test-fixture');}
function validAudit(d){const c=compile(d),a=structuralAudit(d,c);return {compiled:c,structural:a,findings:a.findings,semantic:{status:'completed',model:'test-fixture'},freshReader:{status:'completed',model:'test-fixture'}};}
test('accept updates one section and preserves all other bytes',t=>{const {s,d}=setup(t),p=proposal(s,d),next=s.accept(actor,d.id,p.id);assert.equal(next.revision,2);for(const section of d.sections)assert.equal(next.sections.find(x=>x.id===section.id).content,section.id==='intent'?'A clearer goal.':section.content);});
test('accept retry is idempotent',t=>{const {s,d}=setup(t),p=proposal(s,d);s.accept(actor,d.id,p.id);const next=s.accept(actor,d.id,p.id);assert.equal(next.revision,2);assert.equal(s.history(actor,d.id).entries.length,2);});
test('a different editor cannot accept the proposal',t=>{const {s,d}=setup(t),p=proposal(s,d);assert.throws(()=>s.accept({...actor,sub:'bob'},d.id,p.id),e=>e.status===403);});
test('locked section rejects accepted mutation',t=>{const {s,d}=setup(t),p=proposal(s,d,'constraints');assert.throws(()=>s.accept(actor,d.id,p.id),e=>e.code==='LOCKED');assert.deepEqual(s.get(actor,d.id),d);});
test('stale proposal cannot overwrite a later edit',t=>{const {s,d}=setup(t),a=proposal(s,d),b=proposal(s,d,'outcome','Different.');s.accept(actor,d.id,a.id);assert.throws(()=>s.accept(actor,d.id,b.id),e=>e.code==='REVISION_CONFLICT');assert.equal(s.get(actor,d.id).sections[1].content,d.sections[1].content);});
test('expired proposal is rejected without mutation',t=>{const {s,d}=setup(t),p=proposal(s,d);p.expiresAt=0;s.db.prepare('UPDATE proposals SET body=? WHERE id=?').run(JSON.stringify(p),p.id);assert.throws(()=>s.accept(actor,d.id,p.id),e=>e.code==='EXPIRED');assert.equal(s.get(actor,d.id).revision,1);});
test('tenant-scoped reads do not reveal another workspace',t=>{const {s,d}=setup(t);assert.throws(()=>s.get(other,d.id),e=>e.status===404);assert.deepEqual(s.list(other),[]);});
test('cross-tenant proposal replay cannot write',t=>{const {s,d}=setup(t),p=proposal(s,d);assert.throws(()=>s.accept(other,d.id,p.id),e=>e.status===404);});
test('viewer can read but cannot create or accept',t=>{const {s,d}=setup(t),viewer={...actor,role:'viewer'},p=proposal(s,d);assert.equal(s.get(viewer,d.id).id,d.id);assert.throws(()=>s.accept(viewer,d.id,p.id),e=>e.status===403);assert.throws(()=>s.create(viewer,example()),e=>e.status===403);});
test('undo restores only the chosen section and creates history',t=>{const {s,d}=setup(t);const n=s.accept(actor,d.id,proposal(s,d).id);const n2=s.accept(actor,d.id,proposal(s,n,'outcome','New outcome.').id);const n3=s.undo(actor,d.id,n2.revision,'intent');assert.equal(n3.sections[0].content,d.sections[0].content);assert.equal(n3.sections[1].content,'New outcome.');assert.equal(n3.revision,4);assert.equal(s.history(actor,d.id).valid,true);});
test('failed changes roll back documents and history',t=>{const {s,d}=setup(t);assert.throws(()=>s.mutate(actor,d.id,1,'bad',{},next=>{next.sections[0].content='New';throw new Error('Fail');}));assert.deepEqual(s.get(actor,d.id),d);assert.equal(s.history(actor,d.id).entries.length,1);});
test('history hash chain detects altered events',t=>{const {s,d}=setup(t);s.db.prepare('UPDATE events SET body=? WHERE document=?').run(JSON.stringify({previousHash:null,sequence:1}),d.id);assert.equal(s.history(actor,d.id).valid,false);});
test('database restart retains exact source and history',()=>{const dir=mkdtempSync(join(tmpdir(),'document-'));try{let s=new Store(join(dir,'db.sqlite'));const d=s.create(actor,example());const n=s.accept(actor,d.id,proposal(s,d).id);s.close();s=new Store(join(dir,'db.sqlite'));assert.deepEqual(s.get(actor,d.id),n);assert.equal(s.history(actor,d.id).valid,true);s.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('old audit cannot authorize new source',t=>{const {s,d}=setup(t),a=s.saveAudit(actor,d,validAudit(d));s.accept(actor,d.id,proposal(s,d).id);assert.throws(()=>s.release(actor,d.id,a.id),e=>e.code==='REVISION_CONFLICT');});
test('structural-only review cannot authorize audited publication',t=>{const {s,d}=setup(t),report=validAudit(d);report.semantic.status='not_run';const a=s.saveAudit(actor,d,report);assert.throws(()=>s.release(actor,d.id,a.id),e=>e.code==='AUDIT_BLOCKED');});
test('fresh-reader review is independently required',t=>{const {s,d}=setup(t),report=validAudit(d);report.freshReader.status='not_run';const a=s.saveAudit(actor,d,report);assert.throws(()=>s.release(actor,d.id,a.id),e=>e.code==='AUDIT_BLOCKED');});
test('unacknowledged warning blocks publication',t=>{const {s,d}=setup(t),report=validAudit(d);report.findings=[{id:'w1',severity:'warning',message:'A risk.'}];const a=s.saveAudit(actor,d,report);assert.throws(()=>s.release(actor,d.id,a.id),e=>e.code==='ACKNOWLEDGEMENT');const release=s.release(actor,d.id,a.id,['w1']);assert.equal(release.sourceHash,sourceHash(d));});
test('audited release is immutable, repeat publication is idempotent',t=>{const {s,d}=setup(t),a=s.saveAudit(actor,d,validAudit(d)),r=s.release(actor,d.id,a.id);assert.deepEqual(s.release(actor,d.id,a.id),r);assert.match(r.content,/NOT execution proof/);});
test('editors do not inherit publication permission',t=>{const {s,d}=setup(t),a=s.saveAudit(actor,d,validAudit(d));assert.throws(()=>s.release({...actor,role:'editor'},d.id,a.id),e=>e.status===403);});

test('out-of-budget reports cannot authorize release even without a finding',t=>{const {s,d}=setup(t),report=validAudit(d);report.compiled.budget.fits=false;const a=s.saveAudit(actor,d,report);assert.throws(()=>s.release(actor,d.id,a.id),e=>e.code==='AUDIT_BLOCKED');});
