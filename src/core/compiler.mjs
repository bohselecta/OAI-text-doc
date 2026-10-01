import { createHash } from 'node:crypto';
import { budget, fail, exact, PROFILES, TARGETS, TITLES, UNIVERSAL, validateDocument } from './contracts.mjs';
export const sha = v => createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const sourceHash = doc => sha(doc);
export function compile(doc, options={}) {
  validateDocument(doc);
  const target=options.target??'codex';
  if (typeof target!=='string'||!Object.hasOwn(TARGETS,target)) fail(400,'TARGET','Unknown build target.');
  const limits=budget(options.budget);
  const rank=[...UNIVERSAL,...Object.values(PROFILES).flatMap(p=>p.kinds),'reference'];
  const ordered=[...doc.sections].sort((a,b)=>rank.indexOf(a.kind)-rank.indexOf(b.kind)||doc.sections.indexOf(a)-doc.sections.indexOf(b));
  const lines=[`# ${doc.title}`, '', '> BUILD CONTRACT · SOURCE SNAPSHOT, NOT EXECUTION PROOF', '',`Source: ${doc.id} · revision ${doc.revision}`,`SHA-256: ${sourceHash(doc)}`,`Target: ${TARGETS[target].label}`,`Profiles: ${doc.profiles.map(p=>PROFILES[p].label).join(' + ')}`,'', '## Start here','',TARGETS[target].directive,'','Build the specified outcome, not merely a scaffold. Preserve explicit constraints, licensed inputs and data. Make reversible routine decisions independently. Stop for missing authorization, paid services or irreversible operations. Record evidence and distinguish simulated checks from deployed, physical or participant outcomes.','','## Project contract'];
  const sourceMap=[];
  // Count incrementally: source-map construction stays linear in document size.
  let lineCount=lines.join('\n').split('\n').length;
  for(const s of ordered) {
    const content=s.content||'[UNRESOLVED: this section is empty]';
    const contentLines=content.split('\n').length;
    const headingLines=s.title.split('\n').length;
    lines.push('',`### ${s.title} [${s.id}]`, '',content);
    const startLine=lineCount+3+headingLines;
    lineCount=startLine+contentLines-1;
    sourceMap.push({sectionId:s.id,contentHash:sha(s.content),startLine,endLine:lineCount});
  }
  lines.push('','## Traceability','',...sourceMap.map(s=>`- ${s.sectionId}: source lines ${s.startLine}–${s.endLine}; content SHA-256 ${s.contentHash}`),'','## Builder handoff','',`Begin with ${doc.sections.find(s=>s.kind==='execution')?.title??'the execution plan'}. Validate unknown dependencies before implementation. On completion, report exact source revision, artifacts, tests run, observed failures, repairs, remaining risks and the next authorized action. Do not describe this plan’s audit as validation of its eventual implementation.`,'');
  const content=lines.join('\n');
  // UTF-8 bytes are a conservative proxy, NOT an exact target tokenizer count.
  const size=Buffer.byteLength(content,'utf8');
  return {content,sourceMap,sourceHash:sourceHash(doc),contentHash:sha(content),target,budget:{...limits,units:size,method:'utf8-byte-ceiling',fits:size<=limits.available},compilerVersion:'1.0.0'};
}
export function structuralAudit(doc, compiled) {
  validateDocument(doc);
  const findings=[];
  const add=(code,severity,message,sectionIds=[],quote='')=>findings.push({id:`${code}-${findings.length+1}`,code,severity,message,sectionIds,quote,origin:'structural'});
  const kinds=[...new Set([...UNIVERSAL,...doc.profiles.flatMap(p=>PROFILES[p].kinds)])];
  for(const kind of kinds) {
    const matches=doc.sections.filter(s=>s.kind===kind);
    if(!matches.length) add('MISSING_STAGE','blocker',`Add ${TITLES[kind]} to complete the selected spine.`);
  }
  for(const s of doc.sections) {
    if(!s.content.trim()) add('EMPTY_SECTION','blocker',`${s.title} is empty.`,[s.id]);
    const marker=s.content.match(/\b(TBD|TODO|FIXME)\b|\[UNRESOLVED[^\]]*\]/i);
    if(marker) add('UNRESOLVED','blocker',`${s.title} contains an unresolved decision.`,[s.id],marker[0]);
  }
  const requirementSections=doc.sections.filter(s=>s.kind==='requirements');
  const requirements=requirementSections.flatMap(s=>[...s.content.matchAll(/\bREQ-\d+\b/g)].map(m=>({id:m[0],section:s.id})));
  const verifies=doc.sections.filter(s=>s.kind==='verification').map(s=>s.content).join('\n');
  if(doc.profiles.includes('software')&&!requirements.length) add('TRACEABILITY','blocker','Give software requirements stable REQ-01 style IDs so acceptance coverage can be checked.',requirementSections.map(s=>s.id));
  for(const r of requirements) if(!new RegExp(`\\b${r.id}\\b`).test(verifies)) add('UNPROVEN_REQUIREMENT','blocker',`${r.id} has no explicit acceptance reference.`,[r.section]);
  for(const id of [...new Set(verifies.match(/\bREQ-\d+\b/g)||[])]) if(!requirements.some(r=>r.id===id)) add('ORPHAN_TEST','warning',`${id} appears in verification but not requirements.`,doc.sections.filter(s=>s.kind==='verification').map(s=>s.id));
  const seen=new Map();
  for(const s of doc.sections) {
    const key=s.content.trim().replace(/\s+/g,' ');
    if(key && seen.has(key)) add('DUPLICATE','warning','These sections repeat the same content. Consolidate explicitly in Draft; the compiler will not drop it.',[seen.get(key),s.id]);
    else if(key) seen.set(key,s.id);
  }
  // Explicit decision syntax supports deterministic contradictions, not semantic omniscience.
  const decisions=new Map();
  for(const s of doc.sections) for(const m of s.content.matchAll(/^@decision\s+([\w.-]+)\s*=\s*(.+)$/gm)) {
    const prior=decisions.get(m[1]);
    if(prior&&prior.value!==m[2].trim()) add('DECISION_CONFLICT','blocker',`Conflicting explicit values for ${m[1]}.`,[prior.id,s.id],m[0]);
    decisions.set(m[1],{value:m[2].trim(),id:s.id});
  }
  const visiting=new Set(), visited=new Set();
  function visit(id) {
    if(visiting.has(id)) return true;
    if(visited.has(id)) return false;
    visiting.add(id);
    if(doc.sections.find(s=>s.id===id).dependsOn.some(visit)) return true;
    visiting.delete(id);visited.add(id);return false;
  }
  if(doc.sections.some(s=>visit(s.id))) add('DEPENDENCY_CYCLE','blocker','The declared section dependency graph contains a cycle.');
  if(!compiled.budget.fits) add('CONTEXT_OVERFLOW','blocker','The complete artifact exceeds the configured input allowance. Increase the verified allowance or revise the source; nothing was truncated.');
  return {findings,stages:kinds.map(kind=>({kind,label:TITLES[kind],sectionIds:doc.sections.filter(s=>s.kind===kind).map(s=>s.id),complete:doc.sections.some(s=>s.kind===kind&&s.content.trim())&&!findings.some(f=>f.severity==='blocker'&&f.sectionIds.some(id=>doc.sections.some(s=>s.id===id&&s.kind===kind)))})),requirements:[...new Set(requirements.map(r=>r.id))],scope:'Presence, placeholders, explicit requirement references, exact duplicates, explicit decision conflicts, dependency cycles and byte budget. Presence and ID coverage are not semantic completeness.'};
}
export function reviewEvidence(raw, doc, origin) {
  exact(raw,['findings','coveredSectionIds']);
  if(!raw || !Array.isArray(raw.findings)||raw.findings.length>40||!Array.isArray(raw.coveredSectionIds)) fail(502,'REVIEW_SCHEMA','The reviewer returned an invalid report.');
  const ids=new Set(doc.sections.map(s=>s.id));
  if(raw.coveredSectionIds.some(id=>!ids.has(id))||new Set(raw.coveredSectionIds).size!==ids.size) fail(502,'REVIEW_COVERAGE','The review did not cover every source section.');
  return raw.findings.map((f,i)=>{
    exact(f,['severity','message','sectionIds','quote']);
    if(!['blocker','warning'].includes(f.severity)||typeof f.message!=='string'||f.message.length>1200||!f.message.trim()||!Array.isArray(f.sectionIds)||!f.sectionIds.length||f.sectionIds.some(id=>!ids.has(id))||typeof f.quote!=='string'||!f.quote.trim()||!f.sectionIds.some(id=>doc.sections.find(s=>s.id===id).content.includes(f.quote))) fail(502,'REVIEW_PROVENANCE','A review finding did not cite literal source evidence.');
    return {id:`${origin}-${i+1}`,code:'SEMANTIC_FINDING',severity:f.severity,message:f.message,sectionIds:f.sectionIds,quote:f.quote,origin};
  });
}
