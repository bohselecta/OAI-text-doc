import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { hostedAuthConfig,createOAuthAuthenticator } from '../src/adapters/oauth.mjs';
import { createHostedHandler } from '../src/adapters/hosted.mjs';
import { pglitePool } from '../scripts/pglite-pool.mjs';
import { NeonStore,migrateNeon } from '../src/adapters/neon/index.mjs';
import assert from 'node:assert/strict';
// Combined boundary fixture: ephemeral signed keys, loopback HTTP and embedded
// PostgreSQL; validates claims/host shape without claiming TLS or live OAuth/Neon.
test('signed OAuth identity crosses HTTP, MCP and PostgreSQL with tenant/role fences',async()=>{
let handler;
const server=createServer((...args)=>handler(...args));
server.listen(0,'127.0.0.1');await once(server,'listening');
const port=server.address().port;
const env={DOCUMENT_ORIGIN:`https://127.0.0.1:${port}`,DOCUMENT_OAUTH_ISSUER:'https://issuer.example/',DOCUMENT_OAUTH_JWKS_URL:'https://issuer.example/jwks'};
const config=hostedAuthConfig(env), {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const auth=createOAuthAuthenticator(config,{keyResolver:async()=>publicKey});
const pool=await pglitePool();await migrateNeon(pool);
handler=createHostedHandler({env,authenticate:auth,storeFactory:()=>new NeonStore({pool})});
const url=new URL(`http://127.0.0.1:${port}/mcp`);const clients=[];
async function client(sub,scope){
 const token=await new SignJWT({scope}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime('5m').setSubject(sub).setIssuer(config.issuer).setAudience(config.resource).sign(privateKey);
 const c=new Client({name:'review',version:'1'});clients.push(c);
 await c.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));return c;
}
try{
 const a=await client('alice','document:read document:write document:publish');
 const initial=await a.callTool({name:'open_document',arguments:{}});assert.equal(initial.structuredContent.documentCount,0);
 const contextId=initial._meta.languageCanvas.contextId;
 const created=await a.callTool({name:'document_action',arguments:{contextId,request:{action:'create',body:{type:'example'}}}});assert.equal(created.structuredContent.status,201);
 const id=created._meta.languageCanvas.response.body.id;
 const b=await client('bob','document:read document:write document:publish');
 const hidden=await b.callTool({name:'open_document',arguments:{documentId:id}});assert.equal(hidden.structuredContent.status,404);
 const forged=await b.callTool({name:'document_action',arguments:{contextId,request:{action:'create',body:{type:'example'}}}});assert.equal(forged.structuredContent.code,'ACCOUNT_CHANGED');
 const viewer=await client('alice','document:read');
 const view=await viewer.callTool({name:'open_document',arguments:{documentId:id}});assert.equal(view.structuredContent.status,200);
 const denied=await viewer.callTool({name:'document_action',arguments:{contextId:view._meta.languageCanvas.contextId,request:{action:'create',body:{type:'example'}}}});assert.equal(denied.structuredContent.status,403);

}finally{
 for(const c of clients)await c.close();server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();
}
});
