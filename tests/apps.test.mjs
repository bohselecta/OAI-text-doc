import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDocumentMcpServer, handleAppsMcpRequest, createWidgetHtml, actorContextId, actionInputSchema } from '../src/adapters/apps/server.mjs';
import { APPS_META, APPS_TOOLS, WIDGET_URI, toToolRequest } from '../src/adapters/apps/routes.mjs';
import { createDocumentService } from '../src/adapters/service.mjs';
import { Store } from '../src/server/store.mjs';
import { RehearsalProvider } from '../src/server/provider.mjs';
import { RECOVERY } from '../src/core/templates.mjs';

const actor={sub:'person',tenant:'workspace',role:'publisher'};
const document={id:'doc-1',title:'Private title',revision:2,sections:[{id:'sec-1',content:'CONFIDENTIAL-DOCUMENT-TEXT'}]};
const calls=[];
async function dispatch(who,request) {
  calls.push({who,request});
  if(request.path==='/api/session')return {status:200,body:{actor:who,local:true,provider:'rehearsal',profiles:{}}};
  if(request.path==='/api/documents'&&request.method==='GET')return {status:200,body:[{id:document.id,title:document.title}]};
  if(request.path==='/api/documents/doc-1'&&request.method==='GET')return {status:200,body:document};
  if(request.path.endsWith('/export'))return {status:200,headers:{'Content-Type':'text/plain; charset=utf-8'},body:'PRIVATE-BUILD-CONTENT'};
  return {status:200,body:{accepted:true,private:'SECRET-PROPOSAL'}};
}
async function setup(t,options={}) {
  const server=createDocumentMcpServer({dispatch,actor,assetBase:'https://document.example/',widgetDomain:'https://canvas.example/',...options});
  const client=new Client({name:'apps-tests',version:'1.0.0'});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  t.after(async()=>{await client.close();await server.close();});
  return client;
}
test('Apps SDK advertises a read-only opener and closed app-only data/action tools',async t=>{
  const client=await setup(t),{tools}=await client.listTools();
  assert.deepEqual(tools.map(x=>x.name),Object.values(APPS_TOOLS));
  const open=tools[0],read=tools[1],action=tools[2];
  assert.equal(open.annotations.readOnlyHint,true);assert.equal(open._meta.ui.resourceUri,WIDGET_URI);
  assert.deepEqual(open._meta.ui.visibility,['model','app']);
  for(const tool of [read,action]){assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool._meta.ui.resourceUri,undefined);assert.equal(tool.inputSchema.additionalProperties,false);}
  assert.deepEqual(action.annotations,{readOnlyHint:false,destructiveHint:true,openWorldHint:false,idempotentHint:false});
  assert.deepEqual(open._meta.securitySchemes,[{type:'oauth2',scopes:['document:read']}]);
  assert.deepEqual(action._meta.securitySchemes,[{type:'oauth2',scopes:['document:read','document:write','document:publish']}]);
});
test('opening never mutates, leaks no source/title/account, and prevents loopback auto-seeding',async t=>{
  calls.length=0;const client=await setup(t),result=await client.callTool({name:APPS_TOOLS.open,arguments:{documentId:'doc-1'}});
  assert.equal(result.isError,undefined);
  assert.deepEqual(result.structuredContent,{ok:true,status:200,view:'document',documentCount:1,documentId:'doc-1'});
  const modelVisible=JSON.stringify({content:result.content,structuredContent:result.structuredContent});
  assert.doesNotMatch(modelVisible,/CONFIDENTIAL|Private title|workspace|person|SECRET/);
  assert.equal(result._meta[APPS_META].document.sections[0].content,'CONFIDENTIAL-DOCUMENT-TEXT');
  assert.equal(result._meta[APPS_META].session.local,false);
  assert(calls.every(call=>call.request.method==='GET'));
});
test('empty account opens without creation',async t=>{
  const seen=[];const client=await setup(t,{dispatch:async(who,request)=>{seen.push(request);return request.path==='/api/session'?{status:200,body:{actor:who,local:true}}:{status:200,body:[]};}});
  const result=await client.callTool({name:APPS_TOOLS.open,arguments:{}});
  assert.equal(result.structuredContent.documentCount,0);assert.equal(result._meta[APPS_META].document,null);
  assert(seen.every(request=>request.method==='GET'));
});
test('MCP resource loads exact original module with a static-only CSP and no credentials',async t=>{
  const client=await setup(t);const {contents}=await client.readResource({uri:WIDGET_URI});
  assert.equal(contents[0].mimeType,'text/html;profile=mcp-app');
  assert.match(contents[0].text,/https:\/\/document.example\/ui\/document.mjs/);
  assert.match(contents[0].text,/https:\/\/document.example\/apps\/apps-widget.js/);
  assert.doesNotMatch(contents[0].text,/Bearer|accessToken|OPENAI_API_KEY|localStorage/);
  assert.deepEqual(contents[0]._meta.ui.csp,{connectDomains:[],resourceDomains:['https://document.example']});
  assert.equal(contents[0]._meta.ui.domain,'https://canvas.example');
  assert.throws(()=>createWidgetHtml({assetBase:'https://user:pass@example.com'}));
  assert.throws(()=>createWidgetHtml({assetBase:'http://example.com'}));
});
test('app request delegates exact authenticated actor, route and body, preserving text exports in metadata',async t=>{
  calls.length=0;const client=await setup(t);
  const request=toToolRequest('/documents/doc-1/proposals','POST',{sectionId:'sec-1',instruction:'Append: precise recovery',revision:2},actorContextId(actor));
  const result=await client.callTool(request);
  assert.deepEqual(calls.at(-1),{who:actor,request:{method:'POST',path:'/api/documents/doc-1/proposals',body:{sectionId:'sec-1',instruction:'Append: precise recovery',revision:2}}});
  assert.doesNotMatch(JSON.stringify(result.structuredContent),/SECRET/);
  assert.equal(result._meta[APPS_META].response.body.private,'SECRET-PROPOSAL');
  const exported=await client.callTool(toToolRequest('/documents/doc-1/export','POST',{auditId:'audit-1',format:'md'},actorContextId(actor)));
  assert.equal(exported._meta[APPS_META].response.body,'PRIVATE-BUILD-CONTENT');
  assert.equal(exported._meta[APPS_META].response.headers['Content-Type'],'text/plain; charset=utf-8');
  assert.doesNotMatch(JSON.stringify(exported.content),/PRIVATE-BUILD/);
});
test('account, workspace and role changes fence old app writes before dispatch',async t=>{
  for(const next of [{...actor,sub:'other'},{...actor,tenant:'other'},{...actor,role:'viewer'}]) {
    let dispatched=false;const client=await setup(t,{actor:next,dispatch:async()=>{dispatched=true;return {status:200,body:{}};}});
    const result=await client.callTool(toToolRequest('/documents/doc-1/accept','POST',{proposalId:'p-1'},actorContextId(actor)));
    assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'ACCOUNT_CHANGED');assert.equal(dispatched,false);
    assert.equal(result._meta[APPS_META].contextId,actorContextId(next));
  }
});
test('MCP schema rejects unknown fields, arbitrary paths, bad revision, oversized instruction and ambiguous action bodies',async t=>{
  const client=await setup(t);const base={contextId:actorContextId(actor),request:{action:'accept',documentId:'doc-1',body:{proposalId:'p-1'}}};
  for(const args of [
    {...base,actor:{role:'admin'}},
    {...base,request:{...base.request,path:'/api/arbitrary'}},
    {...base,request:{...base.request,documentId:'../../other'}},
    {...base,request:{action:'proposals',documentId:'doc-1',body:{sectionId:'s',instruction:'x'.repeat(6001),revision:1}}},
    {...base,request:{action:'lock',documentId:'doc-1',body:{sectionId:'s',revision:0,locked:true}}},
    {...base,request:{...base.request,body:{proposalId:'p-1',content:'replace whole source'}}}
  ]) {const result=await client.callTool({name:APPS_TOOLS.action,arguments:args});assert.equal(result.isError,true);}
  assert.throws(()=>toToolRequest('https://attacker.test/api/documents','GET',undefined,base.contextId));
  assert.throws(()=>toToolRequest('/documents/../secret','GET',undefined,base.contextId));
  assert.throws(()=>toToolRequest('/documents/doc-1','DELETE',undefined,base.contextId));
});
test('all original UI operations have a schema-valid closed bridge mapping',()=>{
  const scope=actorContextId(actor),documentId='doc-1';
  const requests=[
    ['/documents',{type:'example'}],['/documents',{type:'brief',title:'A title',profiles:['software'],goal:'A goal'}],
    ['/documents',{type:'template',title:'A title',profiles:['writing'],goal:''}],['/documents',{type:'import',source:'# Markdown'}],
    [`/documents/${documentId}/proposals`,{sectionId:'sec-1',revision:1,instruction:'Append: next'}],
    [`/documents/${documentId}/accept`,{proposalId:'p-1'}],[`/documents/${documentId}/undo`,{sectionId:'sec-1',revision:1}],
    [`/documents/${documentId}/lock`,{sectionId:'sec-1',revision:1,locked:true}],[`/documents/${documentId}/sections`,{title:'Recovery',kind:'recovery',revision:1}],
    [`/documents/${documentId}/profiles`,{profiles:['writing'],revision:1}],
    [`/documents/${documentId}/audit`,{revision:1,target:'codex',budget:{context:128000,reserve:32000},semantic:false}],
    [`/documents/${documentId}/export`,{auditId:'audit-1',format:'txt'}],[`/documents/${documentId}/publish`,{auditId:'audit-1',acknowledged:[]}]
  ];
  for(const [path,body]of requests)assert.equal(actionInputSchema.safeParse(toToolRequest(path,'POST',body,scope).arguments).success,true,path);
});
test('actual StreamableHTTP initialization, tool calls and resources use SDK transport',async t=>{
  const http=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    await handleAppsMcpRequest(req,res,{parsedBody:body?JSON.parse(body):undefined,dispatch,actor,assetBase:'http://127.0.0.1:4173'});
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const client=new Client({name:'http-apps-tests',version:'1.0.0'});
  t.after(async()=>{await client.close();await new Promise(resolve=>http.close(resolve));});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`)));
  assert.equal((await client.listTools()).tools.length,3);
  const result=await client.callTool({name:APPS_TOOLS.open,arguments:{documentId:'doc-1'}});
  assert.equal(result.structuredContent.documentId,'doc-1');
  assert.equal((await client.readResource({uri:WIDGET_URI})).contents.length,1);
});
test('real MCP → shared service → durable store preserves proposal/accept/export and rehearsal release gates',async t=>{
  const store=new Store();t.after(()=>store.close());
  const client=await setup(t,{dispatch:createDocumentService({store,provider:new RehearsalProvider()})});
  const request=async(path,body)=>client.callTool(toToolRequest(path,body===undefined?'GET':'POST',body,actorContextId(actor)));
  const read=result=>result._meta[APPS_META].response.body;
  const created=read(await request('/documents',{type:'example'}));
  const proposal=read(await request(`/documents/${created.id}/proposals`,{sectionId:'recovery',instruction:'Define recovery behavior',revision:created.revision}));
  assert.deepEqual(read(await request(`/documents/${created.id}`)),created);
  const accepted=read(await request(`/documents/${created.id}/accept`,{proposalId:proposal.id}));
  assert.equal(accepted.revision,2);assert.equal(accepted.sections.find(s=>s.id==='recovery').content,RECOVERY);
  for(const section of created.sections.filter(s=>s.id!=='recovery'))assert.deepEqual(accepted.sections.find(s=>s.id===section.id),section);
  const audit=read(await request(`/documents/${created.id}/audit`,{revision:2,target:'codex',budget:{context:128000,reserve:32000},semantic:false}));
  const exported=await request(`/documents/${created.id}/export`,{auditId:audit.id,format:'md'});
  assert.match(read(exported),/DRAFT EXPORT — NOT AN AUDITED RELEASE/);
  for(const section of accepted.sections)assert(read(exported).includes(section.content));
  assert.doesNotMatch(JSON.stringify({content:exported.content,structuredContent:exported.structuredContent}),/DRAFT EXPORT|sourceHash|RECOVERY/);
  const release=await request(`/documents/${created.id}/publish`,{auditId:audit.id,acknowledged:[]});
  assert.equal(release.isError,true);assert.equal(release.structuredContent.code,'AUDIT_BLOCKED');
  assert.deepEqual(read(await request(`/documents/${created.id}`)),accepted);
});
test('real MCP release requires both explicit fixture reviews and returns full immutable content only to app',async t=>{
  const store=new Store();t.after(()=>store.close());const phases=[];
  const provider={mode:'test-fixture',model:'test-model',edit:async(_doc,section)=>({sectionId:section.id,content:RECOVERY}),review:async(doc,_compiled,phase)=>{phases.push(phase);return {findings:[],coveredSectionIds:doc.sections.map(s=>s.id)};}};
  const client=await setup(t,{dispatch:createDocumentService({store,provider})});
  const request=async(path,body)=>client.callTool(toToolRequest(path,body===undefined?'GET':'POST',body,actorContextId(actor)));
  const body=result=>result._meta[APPS_META].response.body;
  const created=body(await request('/documents',{type:'example'}));
  const proposal=body(await request(`/documents/${created.id}/proposals`,{sectionId:'recovery',instruction:'Define recovery behavior',revision:created.revision}));
  await request(`/documents/${created.id}/accept`,{proposalId:proposal.id});
  const audit=body(await request(`/documents/${created.id}/audit`,{revision:2,target:'codex',budget:{context:128000,reserve:32000},semantic:true}));
  assert.deepEqual(phases,['semantic','freshReader']);
  const release=await request(`/documents/${created.id}/publish`,{auditId:audit.id,acknowledged:[]});
  assert.equal(release.structuredContent.status,201);assert.equal(body(release).revision,2);assert.match(body(release).content,/NOT execution proof/);
  assert.doesNotMatch(JSON.stringify(release.structuredContent),/test-model|NOT execution/);
});
test('StreamableHTTP permission denial forwards trusted OAuth challenge only in metadata',async t=>{
  const challenge='Bearer resource_metadata="https://document.example/.well-known/oauth-protected-resource", scope="document:read document:write document:publish", error="insufficient_scope"';
  const viewer={...actor,role:'viewer'};
  const http=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    await handleAppsMcpRequest(req,res,{parsedBody:raw?JSON.parse(raw):undefined,actor:viewer,assetBase:'http://127.0.0.1:4173',authorizationChallenge:challenge,dispatch:async()=>({status:403,body:{error:{code:'FORBIDDEN',message:'Your role cannot write this document.'}}})});
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const client=new Client({name:'oauth-challenge-test',version:'1.0.0'});
  t.after(async()=>{await client.close();await new Promise(resolve=>http.close(resolve));});
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/mcp`)));
  const result=await client.callTool(toToolRequest('/documents','POST',{type:'example'},actorContextId(viewer)));
  assert.equal(result.isError,true);assert.equal(result.structuredContent.code,'FORBIDDEN');
  assert.equal(result._meta['mcp/www_authenticate'],challenge);
  assert.doesNotMatch(JSON.stringify({content:result.content,structuredContent:result.structuredContent}),/Bearer|resource_metadata|document:publish/);
});
test('stateless transport immediately closes GET and DELETE with 405 while SDK POST still works',async t=>{
  let dispatched=0;
  const http=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    await handleAppsMcpRequest(req,res,{parsedBody:raw?JSON.parse(raw):undefined,actor,assetBase:'http://127.0.0.1:4173',dispatch:async(...args)=>{dispatched++;return dispatch(...args);}});
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const url=new URL(`http://127.0.0.1:${http.address().port}/mcp`);
  const client=new Client({name:'stateless-transport-test',version:'1.0.0'});
  t.after(async()=>{await client.close();http.closeAllConnections();await new Promise(resolve=>http.close(resolve));});
  for(const method of ['GET','DELETE']) {
    const response=await fetch(url,{method,headers:{Accept:'text/event-stream'},signal:AbortSignal.timeout(1500)});
    assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'POST');
    const body=await response.json();assert.equal(body.jsonrpc,'2.0');assert.match(body.error.message,/POST only/);
  }
  assert.equal(dispatched,0);
  // The official SDK tolerates the optional GET being unavailable.
  await client.connect(new StreamableHTTPClientTransport(url));
  assert.equal((await client.listTools()).tools.length,3);
  assert.equal((await client.callTool({name:APPS_TOOLS.open,arguments:{documentId:'doc-1'}})).structuredContent.documentId,'doc-1');
  assert.equal(dispatched,3);
});
