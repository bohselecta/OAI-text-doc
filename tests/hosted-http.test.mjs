import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { request as wireRequest } from 'node:http';
import { createHostedHandler } from '../src/adapters/hosted.mjs';
import { Store } from '../src/server/store.mjs';
import { Fault } from '../src/core/contracts.mjs';
const env={DOCUMENT_ORIGIN:'https://document.example',DOCUMENT_OAUTH_ISSUER:'https://identity.example/',DOCUMENT_OAUTH_JWKS_URL:'https://identity.example/jwks'};
async function setup(t,{auth=true}={}){
 let opened=0,closed=0;const db=new Store();
 const handler=createHostedHandler({env,authenticate:async req=>{if(!auth||req.headers.authorization!=='Bearer fixture')throw Object.assign(new Fault(401,'AUTH_REQUIRED','Sign in.'),{oauthError:'invalid_token'});return {sub:'fixture',tenant:'fixture',role:'publisher'};},storeFactory:async()=>{opened++;return new Proxy(db,{get:(o,k)=>k==='close'?async()=>{closed++;}:k==='meter'?async()=>{}:k==='acquireInference'?async()=>async()=>{}:typeof o[k]==='function'?o[k].bind(o):o[k]});}});
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
 const send=(path,{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{
   const req=wireRequest({host:'127.0.0.1',port:server.address().port,path,method,headers:{host:'document.example',...headers}},res=>{let text='';res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,body:text?JSON.parse(text):null}));});req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
 });
 return {send,stats:()=>({opened,closed})};
}
test('hosted metadata advertises the exact OAuth protected resource before auth',async t=>{const {send,stats}=await setup(t);const r=await send('/.well-known/oauth-protected-resource');assert.equal(r.status,200);assert.equal(r.body.resource,'https://document.example/mcp');assert.deepEqual(r.body.scopes_supported,['document:read','document:write','document:publish']);assert.equal(stats().opened,0);});
test('hosted auth challenge occurs before database access',async t=>{const {send,stats}=await setup(t);const r=await send('/mcp',{method:'POST',headers:{'content-type':'application/json'},body:{}});assert.equal(r.status,401);assert.match(r.headers['www-authenticate'],/oauth-protected-resource/);assert.equal(stats().opened,0);});
test('hosted origin and host guards cannot be bypassed with forwarded headers',async t=>{const {send,stats}=await setup(t);for(const headers of [{host:'evil.example','x-forwarded-host':'document.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}]){assert.equal((await send('/mcp',{method:'POST',headers:{authorization:'Bearer fixture',...headers}})).status,403);}assert.equal(stats().opened,0);});
test('hosted JSON/content-type/body size fail before database access',async t=>{const {send,stats}=await setup(t);for(const [body,type,status] of [['{}','text/plain',415],['{','application/json',400],['x'.repeat(1000001),'application/json',413]]){assert.equal((await send('/mcp',{method:'POST',body,headers:{authorization:'Bearer fixture','content-type':type}})).status,status);}assert.equal(stats().opened,0);});
test('actual hosted MCP initialize is stateless and closes its request store',async t=>{const {send,stats}=await setup(t);const r=await send('/mcp',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json',accept:'application/json, text/event-stream'},body:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}}});assert.equal(r.status,200);assert.equal(r.body.result.serverInfo.name,'language-canvas-document');assert.equal(r.headers['mcp-session-id'],undefined);assert.equal(stats().opened,1);await new Promise(r=>setImmediate(r));assert.equal(stats().closed,1);});
test('health endpoint works without credentials and does not claim database readiness',async()=>{const handler=createHostedHandler({env:{}});const headers={};let status,text;await handler({method:'GET',url:'/healthz',headers:{}},{setHeader:(k,v)=>headers[k]=v,writeHead:s=>status=s,end:t=>text=t});assert.equal(status,200);assert.equal(JSON.parse(text).adapter,'apps-sdk-neon');assert.equal(JSON.parse(text).database,undefined);});
