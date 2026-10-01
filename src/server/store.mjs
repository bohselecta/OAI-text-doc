import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authorize, fail, requireRevision, validateDocument } from '../core/contracts.mjs';
import { sha, sourceHash } from '../core/compiler.mjs';

/** Durable single-instance reference store. All draft commits are transactional. */
export class Store {
  constructor(path=':memory:') {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1) {this.db.close();fail(500,'MIGRATION','Database version is newer than this application.');}
    if(version===0) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE documents (tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(tenant,id));
      CREATE TABLE snapshots (tenant TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,document,revision));
      CREATE TABLE events (tenant TEXT NOT NULL,document TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(tenant,document,sequence));
      CREATE TABLE proposals (tenant TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id));
      CREATE TABLE audits (tenant TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id));
      CREATE TABLE releases (tenant TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,audit TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id),UNIQUE(tenant,document,audit));
      CREATE INDEX proposals_document ON proposals(tenant,document);
      CREATE INDEX audits_document ON audits(tenant,document);
      PRAGMA user_version=1; COMMIT;`);
  }
  close(){this.db.close();}
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  list(actor){authorize(actor,'read');return this.db.prepare('SELECT body FROM documents WHERE tenant=? ORDER BY rowid DESC').all(actor.tenant).map(r=>{const d=JSON.parse(r.body);return {id:d.id,title:d.title,profiles:d.profiles,revision:d.revision,updatedAt:d.updatedAt};});}
  get(actor,id){authorize(actor,'read');const r=this.db.prepare('SELECT body FROM documents WHERE tenant=? AND id=?').get(actor.tenant,id);if(!r)fail(404,'NOT_FOUND','Document not found in this workspace.');return validateDocument(JSON.parse(r.body));}
  event(actor,doc,type,detail={}){
    const last=this.db.prepare('SELECT sequence,hash FROM events WHERE tenant=? AND document=? ORDER BY sequence DESC LIMIT 1').get(actor.tenant,doc.id);
    const entry={sequence:(last?.sequence??0)+1,previousHash:last?.hash??null,documentId:doc.id,revision:doc.revision,sourceHash:sourceHash(doc),actor:actor.sub,type,detail,at:new Date().toISOString()};
    const body=JSON.stringify(entry),hash=sha(body);
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(actor.tenant,doc.id,entry.sequence,body,hash);
  }
  saveSnapshot(actor,doc){this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run(actor.tenant,doc.id,doc.revision,JSON.stringify(doc));}
  create(actor,doc){authorize(actor,'write');validateDocument(doc);return this.tx(()=>{
    if(this.list(actor).length>=200)fail(409,'LIMIT','This reference workspace supports at most 200 documents.');
    this.db.prepare('INSERT INTO documents VALUES(?,?,?,?)').run(actor.tenant,doc.id,JSON.stringify(doc),doc.revision);
    this.saveSnapshot(actor,doc);this.event(actor,doc,'created');return doc;
  });}
  commitInside(actor,doc,type,detail,change){
    const next=structuredClone(doc);change(next);next.revision++;next.updatedAt=new Date().toISOString();validateDocument(next);
    this.db.prepare('UPDATE documents SET body=?,revision=? WHERE tenant=? AND id=?').run(JSON.stringify(next),next.revision,actor.tenant,doc.id);
    this.saveSnapshot(actor,next);this.event(actor,next,type,detail);return next;
  }
  mutate(actor,id,revision,type,detail,change){authorize(actor,'write');return this.tx(()=>{const doc=this.get(actor,id);requireRevision(doc,revision);return this.commitInside(actor,doc,type,detail,change);});}
  addProposal(actor,doc,section,instruction,replacement,model){authorize(actor,'write');return this.tx(()=>{
    const current=this.get(actor,doc.id);requireRevision(current,doc.revision);
    const proposal={id:randomUUID(),documentId:doc.id,sectionId:section.id,revision:doc.revision,sourceHash:sourceHash(doc),before:section.content,after:replacement,instruction,model,actor:actor.sub,expiresAt:Date.now()+15*60*1000,status:'pending'};
    this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?)').run(actor.tenant,proposal.id,doc.id,JSON.stringify(proposal));return proposal;
  });}
  accept(actor,id,proposalId){authorize(actor,'write');return this.tx(()=>{
    const row=this.db.prepare('SELECT body FROM proposals WHERE tenant=? AND id=? AND document=?').get(actor.tenant,proposalId,id);
    if(!row)fail(404,'NOT_FOUND','Proposal not found.');const p=JSON.parse(row.body);
    if(p.actor!==actor.sub)fail(403,'FORBIDDEN','Only the requesting editor can accept this proposal.');
    const doc=this.get(actor,id);
    if(p.status==='accepted')return doc;
    if(p.expiresAt<=Date.now())fail(410,'EXPIRED','This proposal expired. Ask for a new proposal.');
    requireRevision(doc,p.revision);
    if(sourceHash(doc)!==p.sourceHash)fail(409,'SOURCE_CHANGED','The proposal no longer matches its source.');
    const section=doc.sections.find(s=>s.id===p.sectionId);
    if(!section||section.locked)fail(423,'LOCKED','Unlock the selected section before proposing a change.');
    const next=this.commitInside(actor,doc,'section.changed',{sectionId:p.sectionId,instruction:p.instruction,model:p.model,proposalId:p.id,beforeHash:sha(p.before),afterHash:sha(p.after)},d=>{d.sections.find(s=>s.id===p.sectionId).content=p.after;});
    p.status='accepted';p.appliedRevision=next.revision;
    this.db.prepare('UPDATE proposals SET body=? WHERE tenant=? AND id=?').run(JSON.stringify(p),actor.tenant,p.id);
    return next;
  });}
  undo(actor,id,revision,sectionId){return this.mutate(actor,id,revision,'section.restored',{sectionId},doc=>{
    const section=doc.sections.find(s=>s.id===sectionId);if(!section)fail(404,'NOT_FOUND','Section not found.');if(section.locked)fail(423,'LOCKED','Unlock the section before restoring it.');
    const snapshots=this.db.prepare('SELECT body FROM snapshots WHERE tenant=? AND document=? AND revision<? ORDER BY revision DESC').all(actor.tenant,id,revision);
    const previous=snapshots.map(r=>JSON.parse(r.body).sections.find(s=>s.id===sectionId)).find(s=>s&&s.content!==section.content);
    if(!previous)fail(409,'NO_HISTORY','No previous content exists for this section.');section.content=previous.content;
  });}
  history(actor,id){this.get(actor,id);const entries=this.db.prepare('SELECT body,hash FROM events WHERE tenant=? AND document=? ORDER BY sequence').all(actor.tenant,id);let previous=null,valid=true;return {entries:entries.map(r=>{const e=JSON.parse(r.body);if(sha(r.body)!==r.hash||e.previousHash!==previous)valid=false;previous=r.hash;return {...e,hash:r.hash};}),valid,headHash:previous};}
  saveAudit(actor,doc,audit){this.get(actor,doc.id);return this.tx(()=>{requireRevision(this.get(actor,doc.id),doc.revision);const report={...audit,id:randomUUID(),documentId:doc.id,revision:doc.revision,sourceHash:sourceHash(doc),createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO audits VALUES(?,?,?,?)').run(actor.tenant,report.id,doc.id,JSON.stringify(report));this.event(actor,doc,'audit.completed',{auditId:report.id,semantic:report.semantic.status});return report;});}
  getAudit(actor,id,aid){this.get(actor,id);const r=this.db.prepare('SELECT body FROM audits WHERE tenant=? AND document=? AND id=?').get(actor.tenant,id,aid);if(!r)fail(404,'NOT_FOUND','Audit not found.');return JSON.parse(r.body);}
  release(actor,id,aid,acknowledged=[]){authorize(actor,'publish');return this.tx(()=>{
    const doc=this.get(actor,id),audit=this.getAudit(actor,id,aid);
    requireRevision(doc,audit.revision);if(sourceHash(doc)!==audit.sourceHash)fail(409,'STALE_AUDIT','Audit source has changed.');
    if(!audit.compiled.budget.fits||audit.findings.some(f=>f.severity==='blocker')||audit.semantic.status!=='completed'||audit.freshReader.status!=='completed')fail(409,'AUDIT_BLOCKED','Resolve blockers and complete both model reviews before publishing an audited release.');
    const warnings=audit.findings.filter(f=>f.severity==='warning').map(f=>f.id);
    if(warnings.some(id=>!acknowledged.includes(id)))fail(409,'ACKNOWLEDGEMENT','Explicitly acknowledge each remaining warning.');
    const existing=this.db.prepare('SELECT body FROM releases WHERE tenant=? AND document=? AND audit=?').get(actor.tenant,id,aid);if(existing)return JSON.parse(existing.body);
    const release={id:randomUUID(),documentId:id,revision:doc.revision,auditId:aid,sourceHash:audit.sourceHash,createdAt:new Date().toISOString(),publisher:actor.sub,acknowledged:warnings,content:exportText(audit,true)};
    this.db.prepare('INSERT INTO releases VALUES(?,?,?,?,?)').run(actor.tenant,release.id,id,aid,JSON.stringify(release));this.event(actor,doc,'release.published',{releaseId:release.id,auditId:aid,acknowledged:warnings});return release;
  });}
}
export function exportText(audit,released=false){
  return `${released?'':'DRAFT EXPORT — NOT AN AUDITED RELEASE\n\n'}${audit.compiled.content}\n## Audit receipt\n\nStatus: ${released?'Structurally checked and model-reviewed; NOT execution proof':'Draft; release gates may be incomplete'}\nSource SHA-256: ${audit.sourceHash}\nCompiled body SHA-256 (before this receipt): ${audit.compiled.contentHash}\nStructural checks: ${audit.structural.scope}\nSemantic review: ${audit.semantic.status} (${audit.semantic.model??'not run'})\nFresh-reader review: ${audit.freshReader.status} (${audit.freshReader.model??'not run'})\nBudget method: UTF-8 byte ceiling, not an exact target-model token count.\n\nFindings:\n${audit.findings.map(f=>`- ${f.severity.toUpperCase()}: ${f.message}`).join('\n')||'- No findings in the checks performed. This does not prove completeness.'}\n\nA model review is fallible. This receipt makes no claim about software execution, scientific validity, legal compliance, physical safety or participant outcomes.\n`;
}
