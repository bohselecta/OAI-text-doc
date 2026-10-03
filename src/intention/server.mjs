import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authentication,environment } from '../server/auth.mjs';
import { authorize } from '../core/contracts.mjs';
import { IntentionStore } from './store.mjs';
import { IntentionProvider } from './provider.mjs';
import { MAX_BYTES,fail,localProposal,validateScope } from './state.mjs';
const ROOT=fileURLToPath(new URL('./',import.meta.url));
const files=new Map([['/',['index.html','text/html']],['/workspace.mjs',['workspace.mjs','text/javascript']],['/state.mjs',['state.mjs','text/javascript']],['/capsule.mjs',['capsule.mjs','text/javascript']],['/document-bridge.mjs',['document-bridge.mjs','text/javascript']],['/workspace.css',['workspace.css','text/css']]]);
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!(k in value)))fail('SCHEMA','Unsupported or missing request fields.');}
async function body(req){if(!(req.headers['content-type']??'').startsWith('application/json'))fail('CONTENT_TYPE','Use a JSON request.',415);let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BYTES+20000)fail('SIZE','Request exceeds the capsule size limit.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('JSON','Invalid JSON request.');}}
export function createIntentionServer({store,provider=null,authenticate,origin,production=false}){
 const pending=new Set(),rates=new Map();
 const meter=actor=>{const key=actor.tenant+':'+actor.sub,at=Date.now();if(rates.size>10000)for(const [k,r]of rates)if(at-r.start>60000)rates.delete(k);if(!rates.has(key)&&rates.size>=10000)fail('CAPACITY','The request limiter is full. Try again later.',503);let r=rates.get(key);if(!r||at-r.start>60000){r={start:at,count:0};rates.set(key,r);}if(++r.count>30)fail('RATE_LIMIT','Too many changes in one minute. Try again shortly.',429);};
 const server=createServer(async(req,res)=>{const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail('ORIGIN','Use the configured application origin.',403);
  const url=new URL(req.url,origin);if(url.search)fail('ROUTE','Unexpected query parameters.');const path=url.pathname;
  if(req.method==='GET'&&path==='/core/contracts.mjs'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(readFileSync(fileURLToPath(new URL('../core/contracts.mjs',import.meta.url))));return;}
  if(req.method==='GET'&&path==='/capsule-runtime.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(readFileSync(fileURLToPath(new URL('../../dist/intention/capsule-runtime.js',import.meta.url))));return;}
  if(req.method==='GET'&&files.has(path)){const [file,type]=files.get(path);res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});res.end(readFileSync(ROOT+file));return;}
  if(path==='/healthz'&&req.method==='GET'){json(200,{status:'ok'});return;}
  const actor=await authenticate(req);authorize(actor,'read');
  if(path==='/api/intention/session'&&req.method==='GET'){json(200,{mode:provider?'connected':'local',model:provider?.model??null,persistence:'server',actor:{role:actor.role},production});return;}
  if(path==='/api/intention/projects'&&req.method==='GET'){json(200,store.list(actor));return;}
  if(req.method!=='GET'&&req.method!=='POST')fail('METHOD','Method not allowed.',405);
  if(req.method==='POST'){authorize(actor,'write');meter(actor);}
  if(path==='/api/intention/projects'&&req.method==='POST'){const data=await body(req);exact(data,['intention','title','source']);json(201,store.create(actor,data));return;}
  const match=path.match(/^\/api\/intention\/projects\/([\w-]+)(?:\/(command|develop|discuss))?$/);if(!match)fail('NOT_FOUND','Route not found.',404);const [,id,action]=match;const project=store.get(actor,id);
  if(req.method==='GET'&&!action){json(200,project);return;}
  if(req.method!=='POST'||!action)fail('METHOD','Method not allowed.',405);const data=await body(req);
  if(action==='command'){exact(data,['revision','command']);if(['propose','discussion'].includes(data.command?.type))fail('COMMAND','Provider responses must pass through the development endpoint.');json(200,store.command(actor,id,data.revision,data.command));return;}
  exact(data,['revision','scope','instruction']);if(data.revision!==project.revision)fail('STALE','The project changed. Reload before requesting another proposal.',409);validateScope(data.scope,project);if(typeof data.instruction!=='string'||!data.instruction.trim()||data.instruction.length>6000)fail('SCHEMA','Write an instruction of at most 6000 characters.');if(project.pending)fail('PENDING','Resolve the current proposal first.',409);if(data.scope.type==='part'&&project.parts.find(p=>p.id===data.scope.partId)?.locked&&action==='develop')fail('LOCKED','Unlock this part explicitly before developing it.',423);
  const key=actor.tenant+':'+actor.sub;if(pending.has(key))fail('BUSY','A model request is already running for this editor.',429);if(pending.size>=8)fail('CAPACITY','The model queue is full. Try again later.',503);pending.add(key);
  try{if(action==='develop'){const proposal=provider?await provider.develop(project,data.scope,data.instruction):localProposal(project,data.scope,data.instruction);json(200,store.command(actor,id,data.revision,{type:'propose',proposal}));}else if(provider){const reply=await provider.discuss(project,data.scope,data.instruction);json(200,store.command(actor,id,data.revision,{type:'discussion',scope:data.scope,instruction:data.instruction,reply}));}else{json(200,store.command(actor,id,data.revision,{type:'message',scope:data.scope,text:data.instruction}));}}finally{pending.delete(key);}
 }catch(error){json(error.status??500,{error:{code:error.code??'INTERNAL',message:error.status?error.message:'The request failed. Saved work was not replaced.'}});}});server.requestTimeout=150000;server.headersTimeout=10000;server.keepAliveTimeout=5000;return server;
}
export function startIntentionServer(env=process.env){const config=environment({...env,PORT:env.PORT??'4175',DOCUMENT_DB:env.INTENTION_DB??'./data/intentions.sqlite'});const store=new IntentionStore(config.db);const provider=config.provider==='openai'?new IntentionProvider({key:config.key,model:config.model}):null;if(!['openai','rehearsal','local'].includes(config.provider))throw new Error('Choose DOCUMENT_PROVIDER=openai or local.');const server=createIntentionServer({store,provider,authenticate:authentication(config),origin:config.origin,production:config.production});server.listen(config.port,config.host,()=>console.log(`Whole-intention workspace: ${config.origin} · ${provider?'configured model '+provider.model:'local recording; no AI'} · SQLite persistence`));for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(()=>{store.close();process.exit(0);}));return {server,store};}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])startIntentionServer();
