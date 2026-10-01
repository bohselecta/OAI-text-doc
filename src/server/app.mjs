import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Fault, fail, exact, text, profiles, requireRevision, authorize, KINDS, TITLES, PROFILES } from '../core/contracts.mjs';
import { example, template } from '../core/templates.mjs';
import { importDocument } from '../core/importer.mjs';
import { compile, structuralAudit, reviewEvidence, sourceHash } from '../core/compiler.mjs';
import { Store, exportText } from './store.mjs';
import { RehearsalProvider, OpenAIProvider, validateEdit } from './provider.mjs';
import { authentication } from './auth.mjs';
const UI=fileURLToPath(new URL('../ui/',import.meta.url));
const MIME={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
async function body(req){
  if((req.headers['content-type']??'').split(';')[0]!=='application/json')fail(415,'CONTENT_TYPE','Send application/json.');
  let data='',bytes=0;
  for await(const part of req){bytes+=part.length;if(bytes>1000000)fail(413,'TOO_LARGE','Request is larger than 1 MB.');data+=part;}
  try{return JSON.parse(data);}catch{fail(400,'JSON','Request contains invalid JSON.');}
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
function security(res,production){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
}
export function createApp(config,{store=new Store(config.db),provider,authenticate}={}) {
  if(!provider) {
    if(config.provider==='rehearsal')provider=new RehearsalProvider();
    else if(config.provider==='openai')provider=new OpenAIProvider({key:config.key,model:config.model,reviewModel:config.reviewModel});
    else fail(500,'PROVIDER_CONFIG','Unknown model provider.');
  }
  const auth=authenticate??authentication(config),pending=new Set(),rates=new Map();
  const meter=actor=>{
    const key=`${actor.tenant}/${actor.sub}`,now=Date.now();
    if(rates.size>10000)for(const [k,v]of rates)if(now-v.start>60000)rates.delete(k);
    if(!rates.has(key)&&rates.size>=10000)fail(503,'CAPACITY','Rate limiter capacity reached. Try later.');
    let row=rates.get(key);if(!row||now-row.start>60000){row={start:now,count:0};rates.set(key,row);}
    if(++row.count>30)fail(429,'RATE_LIMIT','Too many changes in one minute. Try again shortly.');
    return key;
  };
  async function inference(actor,fn){const key=`${actor.tenant}/${actor.sub}`;if(pending.has(key))fail(409,'BUSY','A model operation is already running for this editor.');if(pending.size>=8)fail(503,'CAPACITY','The model queue is full. Try again shortly.');pending.add(key);try{return await fn();}finally{pending.delete(key);}}
  const server=createServer(async(req,res)=>{
    security(res,config.production);const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);
    try {
      const url=new URL(req.url,'http://document.local');
      if(url.pathname==='/healthz'){json(res,200,{status:'ok',version:'1.0.0'});return;}
      if(!url.pathname.startsWith('/api/')){
        if(!['GET','HEAD'].includes(req.method))fail(405,'METHOD','Method not allowed.');
        const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
        const path=resolve(UI,name);if(!path.startsWith(UI.endsWith(sep)?UI:UI+sep)||!MIME[extname(path)])fail(404,'NOT_FOUND','Resource not found.');
        let content;try{content=await readFile(path);}catch{fail(404,'NOT_FOUND','Resource not found.');}
        res.writeHead(200,{'Content-Type':MIME[extname(path)]});res.end(req.method==='HEAD'?undefined:content);return;
      }
      // Origin check also protects loopback rehearsal from cross-site requests/DNS rebinding.
      const expectedHost=new URL(config.origin).host;
      if(req.headers.host!==expectedHost)fail(403,'HOST','Unrecognized host.');
      if(req.headers.origin&&req.headers.origin!==config.origin)fail(403,'ORIGIN','Cross-origin API requests are not allowed.');
      if(req.headers['sec-fetch-site']==='cross-site')fail(403,'ORIGIN','Cross-site API requests are not allowed.');
      const actor=auth(req);authorize(actor,'read');
      if(req.method==='GET'&&url.pathname==='/api/session'){json(res,200,{actor,provider:provider.mode,model:provider.model,local:config.auth==='local',profiles:PROFILES,version:'1.0.0'});return;}
      if(req.method==='GET'&&url.pathname==='/api/documents'){json(res,200,store.list(actor));return;}
      if(!['GET','POST'].includes(req.method))fail(405,'METHOD','Method not allowed.');
      const input=req.method==='POST'?await body(req):{};
      if(req.method==='POST')meter(actor);
      if(req.method==='POST'&&url.pathname==='/api/documents') {
        authorize(actor,'write');exact(input,['type','title','profiles','goal','source']);
        let doc;
        if(input.type==='example')doc=example();
        else if(input.type==='import')doc=importDocument(input.source,text(input.title??'Imported document','title',120),profiles(input.profiles??['writing']));
        else if(input.type==='brief')doc=await inference(actor,()=>provider.create(text(input.title,'title',120),profiles(input.profiles),text(input.goal,'goal',10000)));
        else if(input.type==='template')doc=template(text(input.title,'title',120),profiles(input.profiles),text(input.goal??'','goal',10000,true));
        else fail(400,'SCHEMA','Choose example, brief, template or import.');
        json(res,201,store.create(actor,doc));return;
      }
      const match=url.pathname.match(/^\/api\/documents\/([\w-]+)(?:\/(.*))?$/);
      if(!match)fail(404,'NOT_FOUND','Route not found.');
      const [,id,action='']=match;const doc=store.get(actor,id);
      if(req.method==='GET') {
        if(action===''){json(res,200,doc);return;}
        if(action==='history'){json(res,200,store.history(actor,id));return;}
        if(action==='backup'){res.setHeader('Content-Disposition','attachment; filename="document.canvas.json"');json(res,200,doc);return;}
        fail(404,'NOT_FOUND','Route not found.');
      }
      if(action==='proposals'){
        authorize(actor,'write');exact(input,['sectionId','instruction','revision']);requireRevision(doc,input.revision);
        const section=doc.sections.find(s=>s.id===input.sectionId);if(!section)fail(404,'NOT_FOUND','Select a section first.');if(section.locked)fail(423,'LOCKED','This section is locked. Unlock it explicitly before requesting a change.');
        const instruction=text(input.instruction,'instruction',6000);
        const result=await inference(actor,()=>provider.edit(doc,section,instruction));
        json(res,201,store.addProposal(actor,doc,section,instruction,validateEdit(result,section),provider.model));return;
      }
      if(action==='accept'){exact(input,['proposalId']);json(res,200,store.accept(actor,id,text(input.proposalId,'proposal id',80)));return;}
      if(action==='undo'){exact(input,['sectionId','revision']);json(res,200,store.undo(actor,id,input.revision,text(input.sectionId,'section id',80)));return;}
      if(action==='lock'){
        exact(input,['sectionId','revision','locked']);if(typeof input.locked!=='boolean')fail(400,'SCHEMA','Set a boolean lock.');
        json(res,200,store.mutate(actor,id,input.revision,'section.locked',{sectionId:input.sectionId,locked:input.locked},d=>{const s=d.sections.find(s=>s.id===input.sectionId);if(!s)fail(404,'NOT_FOUND','Section not found.');s.locked=input.locked;}));return;
      }
      if(action==='profiles'){
        exact(input,['profiles','revision']);const selected=profiles(input.profiles);
        json(res,200,store.mutate(actor,id,input.revision,'profiles.changed',{profiles:selected},d=>{d.profiles=selected;for(const kind of [...new Set(selected.flatMap(p=>PROFILES[p].kinds))])if(!d.sections.some(s=>s.kind===kind))d.sections.push({id:randomUUID(),kind,title:TITLES[kind],content:'',locked:false,dependsOn:[]});}));return;
      }
      if(action==='sections'){
        exact(input,['title','kind','revision']);if(!KINDS.includes(input.kind))fail(400,'SCHEMA','Invalid section kind.');
        const title=text(input.title,'section title',100);json(res,201,store.mutate(actor,id,input.revision,'section.added',{title,kind:input.kind},d=>d.sections.push({id:randomUUID(),kind:input.kind,title,content:'',locked:false,dependsOn:[]})));return;
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
        json(res,201,store.saveAudit(actor,doc,report));return;
      }
      if(action==='export'){
        exact(input,['auditId','format']);if(!['md','txt'].includes(input.format))fail(400,'FORMAT','Choose md or txt.');
        const audit=store.getAudit(actor,id,text(input.auditId,'audit id',80));
        res.setHeader('Content-Disposition',`attachment; filename="BUILD-DRAFT.${input.format}"`);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(exportText(audit));return;
      }
      if(action==='publish'){
        exact(input,['auditId','acknowledged']);if(!Array.isArray(input.acknowledged)||input.acknowledged.some(x=>typeof x!=='string'))fail(400,'SCHEMA','Invalid warning acknowledgements.');
        json(res,201,store.release(actor,id,text(input.auditId,'audit id',80),input.acknowledged));return;
      }
      fail(404,'NOT_FOUND','Route not found.');
    } catch(e){
      const known=e instanceof Fault;const status=known?e.status:500;
      if(!known)console.error(JSON.stringify({event:'request.error',requestId,code:'INTERNAL'}));
      if(!res.headersSent)json(res,status,{error:{code:known?e.code:'INTERNAL',message:known?e.message:'The request failed. Accepted work was not replaced. Retry or contact the host administrator.',requestId}});
      else res.end();
    }
  });
  server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  return {server,store,provider};
}
