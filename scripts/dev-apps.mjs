import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { pglitePool } from './pglite-pool.mjs';
import { NeonStore, migrateNeon } from '../src/adapters/neon/index.mjs';
import { RehearsalProvider } from '../src/server/provider.mjs';
import { createDocumentService } from '../src/adapters/service.mjs';
import { handleAppsMcpRequest } from '../src/adapters/apps/server.mjs';
import { readMcpBody } from '../src/adapters/hosted.mjs';
if(process.env.NODE_ENV==='production')throw new Error('The rehearsal harness must never run in production.');
const { buildApps }=await import('./build-apps.mjs');await buildApps();
await build({entryPoints:['scripts/dev-apps-host.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'dist/apps/dev-host.js'});
const port=Number(process.env.PORT??4174),origin=`http://127.0.0.1:${port}`;
await mkdir('data',{recursive:true});
const pool=await pglitePool(process.env.DOCUMENT_DEV_DATA??'data/apps-pg');await migrateNeon(pool);
const store=new NeonStore({pool}),actor={sub:'local-app-author',tenant:'local-app-fixture',role:'admin'};
const dispatch=createDocumentService({store,provider:new RehearsalProvider(),meter:a=>store.meter(a),inference:async(a,fn)=>{const release=await store.acquireInference(a);try{return await fn();}finally{await release();}}});
const files=new Map([
 ['/apps/apps-widget.js',['dist/apps/apps-widget.js','text/javascript']],
 ['/apps/dev-host.js',['dist/apps/dev-host.js','text/javascript']],
 ...['document.mjs','presentation.mjs','document.css','document.svg'].map(f=>['/ui/'+f,['src/ui/'+f,f.endsWith('.mjs')?'text/javascript':f.endsWith('.css')?'text/css':'image/svg+xml']])
]);
const server=createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&![origin,'null'].includes(req.headers.origin)){res.writeHead(403);res.end();return;}
    const path=new URL(req.url,origin).pathname;
    if(path==='/mcp'){
      // Only the visible local test host can make MCP HTTP requests. The iframe
      // uses postMessage to it; opaque Origin:null is for public static assets only.
      if(req.headers.origin==='null'){res.writeHead(403);res.end();return;}
      const parsedBody=req.method==='POST'?await readMcpBody(req):undefined;
      await handleAppsMcpRequest(req,res,{dispatch,actor,assetBase:origin,widgetDomain:origin,securitySchemes:[{type:'noauth'}],parsedBody});return;
    }
    if(path==='/healthz'){res.setHeader('Content-Type','application/json');res.end('{"status":"ok","fixture":"embedded-postgres-rehearsal"}');return;}
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(files.has(path)){const [file,type]=files.get(path);res.writeHead(200,{'Content-Type':type,'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});res.end(await readFile(resolve(file)));return;}
    if(path==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Document · MCP Apps rehearsal</title><style>body{margin:0;background:#141414;color:#eee;font:14px system-ui}header{padding:12px}iframe{width:100%;height:calc(100vh - 65px);border:0}#error{color:#ffb4b4}</style><header>Local MCP Apps rehearsal · embedded PostgreSQL · no OAuth or paid model calls <span id="error" role="alert"></span></header><iframe id="document" title="Document app" sandbox="allow-scripts"></iframe><script type="module" src="/apps/dev-host.js"></script></html>');return;}
    res.writeHead(404);res.end();
  }catch(e){if(!res.headersSent)res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:e.code??'ERROR',message:e.message}}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local MCP Apps rehearsal: ${origin} (embedded PostgreSQL, no OAuth/live model)`));
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>server.close(async()=>{await pool.end();process.exit(0);}));
