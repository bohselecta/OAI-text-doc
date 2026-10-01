/** Additive interoperability with the byte-preserved native Document contract. */
import { validateDocument } from '../core/contracts.mjs';
import { createProject,validateProject } from './state.mjs';
export function toDocument(project,profiles=['writing']){
 validateProject(project);const used=new Set(project.parts.map(p=>p.id));const unique=name=>{let id='capsule-'+name;while(used.has(id))id+='-';used.add(id);return id;};
 const sections=[{id:unique('intention'),title:'Whole intention',kind:'intent',content:project.intention,locked:false,dependsOn:[]}];
 if(project.constraints.length)sections.push({id:unique('constraints'),title:'Whole-intention constraints',kind:'constraints',content:project.constraints.map((s,i)=>`${i+1}. ${s}`).join('\n\n'),locked:true,dependsOn:[]});
 if(project.acceptance.length)sections.push({id:unique('acceptance'),title:'Whole-intention acceptance',kind:'verification',content:project.acceptance.map((s,i)=>`${i+1}. ${s}`).join('\n\n'),locked:true,dependsOn:[]});
 sections.push(...project.parts.map(({parentId,...p})=>p));
 sections.push({id:unique('structure'),title:'Capsule structure and handoff boundary',kind:'structure',content:JSON.stringify({source:'language-canvas/intention@1',projectId:project.id,sourceRevision:project.revision,tree:project.parts.map(p=>({id:p.id,parentId:p.parentId})),boundary:'Accepted source only. Pending proposals, conversations and full history remain in the HTML/JSON capsule. Native Document audits must be run afresh; no release or execution is implied.'},null,2),locked:true,dependsOn:[]});
 if(project.decisions.length)sections.push({id:unique('decisions'),title:'Material decisions',kind:'reference',content:project.decisions.map(d=>`[${d.status}] ${d.question}\nWhy: ${d.why}\n${d.answer?'Answer: '+d.answer:'No answer assumed.'}\nParts: ${d.partIds.join(', ')||'whole intention'}`).join('\n\n'),locked:true,dependsOn:[]});
 // Reuse the exact native validator. Its 64-section / 30k-content / 900KB bounds
 // are a real compatibility boundary; never truncate to pretend interoperability.
 return validateDocument({id:project.id,title:project.title,profiles,revision:Math.max(1,project.revision),sections,createdAt:project.createdAt,updatedAt:project.updatedAt});
}
export function fromDocument(input){const doc=validateDocument(typeof input==='string'?JSON.parse(input):input);const intention=doc.sections.find(s=>s.kind==='intent')?.content;const project=createProject(intention&&intention.length<=10000?intention:doc.title,doc.title);project.parts=doc.sections.map(p=>({...structuredClone(p),parentId:null}));return validateProject(project);}
