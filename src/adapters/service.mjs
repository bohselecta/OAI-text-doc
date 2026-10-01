import { randomUUID } from 'node:crypto';
import { Fault, fail, exact, text, profiles, requireRevision, authorize, KINDS, TITLES, PROFILES } from '../core/contracts.mjs';
import { example, template } from '../core/templates.mjs';
import { importDocument } from '../core/importer.mjs';
import { compile, structuralAudit, reviewEvidence, sourceHash } from '../core/compiler.mjs';
import { exportText } from './export.mjs';
import { validateEdit } from '../server/provider.mjs';

/** Async hosted adapter for the frozen reference API. No ambient identity or store. */
export function createDocumentService({store,provider,meter=async()=>{},inference=async(_actor,fn)=>fn()}) {
  return async function dispatch(actor,{method,path,body:input={}}) {
    const requestId=randomUUID(), result={status:200,body:null,headers:{'Content-Type':'application/json; charset=utf-8'}};
    const res={
      setHeader(name,value){result.headers[name]=value;},
      writeHead(status,headers={}){result.status=status;Object.assign(result.headers,headers);},
      end(value){result.body=value;}
    };
    const json=(_res,status,value)=>{result.status=status;result.body=value;};
    try {
      if(typeof path!=='string'||!path.startsWith('/api/')||path.includes('?')||path.includes('#'))fail(400,'ROUTE','Invalid API path.');
      if(method!=='GET'&&method!=='POST')fail(405,'METHOD','Method not allowed.');
      if(Buffer.byteLength(JSON.stringify(input))>1000000)fail(413,'TOO_LARGE','Request is larger than 1 MB.');
      authorize(actor,'read');
      const req={method},url={pathname:path};
      await (async()=>{
      if(req.method==='GET'&&url.pathname==='/api/session'){json(res,200,{actor,provider:provider.mode,model:provider.model,local:false,profiles:PROFILES,version:'1.0.0'});return;}
      if(req.method==='GET'&&url.pathname==='/api/documents'){json(res,200,await store.list(actor));return;}
      if(!['GET','POST'].includes(req.method))fail(405,'METHOD','Method not allowed.');
      if(req.method==='POST')await meter(actor);
      if(req.method==='POST'&&url.pathname==='/api/documents') {
        authorize(actor,'write');exact(input,['type','title','profiles','goal','source']);
        let doc;
        if(input.type==='example')doc=example();
        else if(input.type==='import')doc=importDocument(input.source,text(input.title??'Imported document','title',120),profiles(input.profiles??['writing']));
        else if(input.type==='brief')doc=await inference(actor,()=>provider.create(text(input.title,'title',120),profiles(input.profiles),text(input.goal,'goal',10000)));
        else if(input.type==='template')doc=template(text(input.title,'title',120),profiles(input.profiles),text(input.goal??'','goal',10000,true));
        else fail(400,'SCHEMA','Choose example, brief, template or import.');
        json(res,201,await store.create(actor,doc));return;
      }
      const match=url.pathname.match(/^\/api\/documents\/([\w-]+)(?:\/(.*))?$/);
      if(!match)fail(404,'NOT_FOUND','Route not found.');
      const [,id,action='']=match;const doc=await store.get(actor,id);
      if(req.method==='GET') {
        if(action===''){json(res,200,doc);return;}
        if(action==='history'){json(res,200,await store.history(actor,id));return;}
        if(action==='backup'){res.setHeader('Content-Disposition','attachment; filename="document.canvas.json"');json(res,200,doc);return;}
        fail(404,'NOT_FOUND','Route not found.');
      }
      if(action==='proposals'){
        authorize(actor,'write');exact(input,['sectionId','instruction','revision']);requireRevision(doc,input.revision);
        const section=doc.sections.find(s=>s.id===input.sectionId);if(!section)fail(404,'NOT_FOUND','Select a section first.');if(section.locked)fail(423,'LOCKED','This section is locked. Unlock it explicitly before requesting a change.');
        const instruction=text(input.instruction,'instruction',6000);
        const result=await inference(actor,()=>provider.edit(doc,section,instruction));
        json(res,201,await store.addProposal(actor,doc,section,instruction,validateEdit(result,section),provider.model));return;
      }
      if(action==='accept'){exact(input,['proposalId']);json(res,200,await store.accept(actor,id,text(input.proposalId,'proposal id',80)));return;}
      if(action==='undo'){exact(input,['sectionId','revision']);json(res,200,await store.undo(actor,id,input.revision,text(input.sectionId,'section id',80)));return;}
      if(action==='lock'){
        exact(input,['sectionId','revision','locked']);if(typeof input.locked!=='boolean')fail(400,'SCHEMA','Set a boolean lock.');
        json(res,200,await store.mutate(actor,id,input.revision,'section.locked',{sectionId:input.sectionId,locked:input.locked},d=>{const s=d.sections.find(s=>s.id===input.sectionId);if(!s)fail(404,'NOT_FOUND','Section not found.');s.locked=input.locked;}));return;
      }
      if(action==='profiles'){
        exact(input,['profiles','revision']);const selected=profiles(input.profiles);
        json(res,200,await store.mutate(actor,id,input.revision,'profiles.changed',{profiles:selected},d=>{d.profiles=selected;for(const kind of [...new Set(selected.flatMap(p=>PROFILES[p].kinds))])if(!d.sections.some(s=>s.kind===kind))d.sections.push({id:randomUUID(),kind,title:TITLES[kind],content:'',locked:false,dependsOn:[]});}));return;
      }
      if(action==='sections'){
        exact(input,['title','kind','revision']);if(!KINDS.includes(input.kind))fail(400,'SCHEMA','Invalid section kind.');
        const title=text(input.title,'section title',100);json(res,201,await store.mutate(actor,id,input.revision,'section.added',{title,kind:input.kind},d=>d.sections.push({id:randomUUID(),kind:input.kind,title,content:'',locked:false,dependsOn:[]})));return;
      }
      if(action==='audit') {
        exact(input,['revision','target','budget','semantic']);requireRevision(doc,input.revision);
        if(input.semantic!==undefined&&typeof input.semantic!=='boolean')fail(400,'SCHEMA','Invalid semantic review option.');
        if(input.semantic)authorize(actor,'write');
        const compiled=compile(doc,{target:input.target,budget:input.budget}),structural=structuralAudit(doc,compiled);
        const report={sourceHash:sourceHash(doc),compiled,structural,findings:[...structural.findings],semantic:{status:'not_run'},freshReader:{status:'not_run'}};
        if(input.semantic){await inference(actor,async()=>{
          for(const phase of ['semantic','freshReader']) {
            const raw=await provider.review(doc,compiled,phase);const findings=reviewEvidence(raw,doc,phase);
            report[phase]={status:'completed',model:provider.reviewModel??provider.model};report.findings.push(...findings);
          }
        });}
        // Budget the delivered file, including the audit receipt; never just the body.
        let fullSize=Math.max(Buffer.byteLength(exportText(report,true),'utf8'),Buffer.byteLength(exportText(report,false),'utf8'));
        if(fullSize>compiled.budget.available&&!report.findings.some(f=>f.code==='CONTEXT_OVERFLOW'))report.findings.push({id:'receipt-overflow',code:'CONTEXT_OVERFLOW',severity:'blocker',message:'The complete file including its audit receipt exceeds the configured allowance.',sectionIds:[],quote:'',origin:'structural'});
        fullSize=Math.max(Buffer.byteLength(exportText(report,true),'utf8'),Buffer.byteLength(exportText(report,false),'utf8'));
        report.compiled.budget.units=fullSize;report.compiled.budget.fits=fullSize<=compiled.budget.available;
        json(res,201,await store.saveAudit(actor,doc,report));return;
      }
      if(action==='export'){
        exact(input,['auditId','format']);if(!['md','txt'].includes(input.format))fail(400,'FORMAT','Choose md or txt.');
        const audit=await store.getAudit(actor,id,text(input.auditId,'audit id',80));
        res.setHeader('Content-Disposition',`attachment; filename="BUILD-DRAFT.${input.format}"`);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(exportText(audit));return;
      }
      if(action==='publish'){
        exact(input,['auditId','acknowledged']);if(!Array.isArray(input.acknowledged)||input.acknowledged.some(x=>typeof x!=='string'))fail(400,'SCHEMA','Invalid warning acknowledgements.');
        json(res,201,await store.release(actor,id,text(input.auditId,'audit id',80),input.acknowledged));return;
      }
      fail(404,'NOT_FOUND','Route not found.');
      })();
    } catch(e) {
      const known=e instanceof Fault;
      result.status=known?e.status:500;
      result.headers={'Content-Type':'application/json; charset=utf-8'};
      result.body={error:{code:known?e.code:'INTERNAL',message:known?e.message:'The request failed. Accepted work was not replaced.',requestId}};
    }
    return result;
  };
}
