import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentWidgetController } from '../src/adapters/apps/bridge.mjs';
import { APPS_META, APPS_TOOLS } from '../src/adapters/apps/routes.mjs';

const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const initial=(contextId='a',id='one',openedAt=1)=>({_meta:{[APPS_META]:{kind:'bootstrap',requestId:`${contextId}-${id}-${openedAt}`,openedAt,contextId,response:{status:200,body:null},session:{actor:{role:'admin'},local:true},documents:[{id}],document:{id,sections:[{id:'section',content:`private-${contextId}`}],revision:1}}}});
const response=(contextId,body,status=200)=>({_meta:{[APPS_META]:{kind:'response',contextId,response:{status,body}}},...(status>=400?{isError:true}:{})});
function fixture({connect,callServerTool,loadModule,downloadFile,observeSize,capabilities={downloadFile:{}}}={}) {
  const apps=[],elements=[],statuses=[];
  const root={children:[],replaceChildren(){this.children=[];},append(element){this.children.push(element);element.isConnected=true;}};
  const controller=createDocumentWidgetController({root,initialResultDelay:0,
    createApp:()=>{
      const app={calls:[],async connect(){if(connect)await connect(app,apps.length);else app.ontoolresult(initial());},async close(){app.onclose?.();},async callServerTool(request){app.calls.push(request);return callServerTool?callServerTool(request,app):response('a',{value:'ok'});},getHostCapabilities:()=>capabilities,downloadFile:downloadFile??(async()=>({}))};apps.push(app);return app;
    },
    loadModule:loadModule??(async()=>{}),observeSize,
    createElement:()=>{const element={s:{instructions:{secret:'do not persist'},doc:{content:'old'},proposal:{content:'secret'}},root:{replaceChildren(){}},remove(){this.removed=true;},setAttribute(name,value){this[name]=value;},configure(options){this.options=options;},render(){this.rendered=true;}};elements.push(element);return element;},
    onStatus:(message,retry)=>statuses.push({message,retry})
  });
  return {controller,apps,elements,root,statuses};
}
test('bridge subscribes before handshake, mounts unchanged custom element and caches initial data once',async()=>{
  const f=fixture();await f.controller.start();const element=f.controller.element;
  assert.equal(element.embedded,undefined);assert.equal(element.options.documentId,'one');assert.equal(element.options.getAccessToken,undefined);
  assert.equal((await element.api('/session')).local,false);
  assert.equal((await element.api('/documents'))[0].id,'one');
  assert.equal((await element.api('/documents/one')).sections[0].content,'private-a');
  assert.equal(f.apps[0].calls.length,0);
  await element.api('/documents');assert.equal(f.apps[0].calls[0].name,APPS_TOOLS.read);
  f.controller.dispose();
});
test('only newest bootstrap is mounted after a slow module import; duplicate/older payloads are ignored',async()=>{
  let release;const module=new Promise(resolve=>{release=resolve;});const f=fixture({loadModule:()=>module});
  const start=f.controller.start();await flush();f.apps[0].ontoolresult(initial('a','two',2));release();await start;
  assert.equal(f.controller.element.options.documentId,'two');const count=f.elements.length;
  f.apps[0].ontoolresult(initial('a','two',2));f.apps[0].ontoolresult(initial('a','one',1));
  assert.equal(f.elements.length,count);f.controller.dispose();
});
test('read-only open fallback recovers a missing initial result',async()=>{
  const f=fixture({connect:async()=>{},callServerTool:async request=>{assert.equal(request.name,APPS_TOOLS.open);return initial();}});
  await f.controller.start();assert.equal(f.controller.element.options.documentId,'one');f.controller.dispose();
});
test('host result arriving during fallback wins over the older fallback response',async()=>{
  let resolveOpen;const f=fixture({connect:async()=>{},callServerTool:()=>new Promise(resolve=>{resolveOpen=resolve;})});
  const starting=f.controller.start();while(!resolveOpen)await flush();
  f.apps[0].ontoolresult(initial('a','desired',2));resolveOpen(initial('a','default',3));await starting;
  assert.equal(f.controller.element.options.documentId,'desired');f.controller.dispose();
});
test('identity change erases old state and rejects in-flight results before mounting new account',async()=>{
  let finish;const f=fixture({callServerTool:request=>request.name===APPS_TOOLS.open?Promise.resolve(initial('b','new',2)):new Promise(resolve=>{finish=resolve;})});
  await f.controller.start();const old=f.controller.element;
  const pending=old.api('/documents/one/history');finish(response('b',{error:{code:'ACCOUNT_CHANGED',message:'changed'}},409));
  await assert.rejects(pending,{code:'ACCOUNT_CHANGED'});await flush();
  assert.equal(old.removed,true);assert.equal(old.s.doc,null);assert.deepEqual(old.s.instructions,{});assert.equal(old.s.proposal,null);
  assert.equal(f.controller.element.options.documentId,'new');
  await assert.rejects(old.api('/documents'),{code:'APP_STALE'});f.controller.dispose();
});
test('newer host result fences old pending actions and never retries writes',async()=>{
  let finish;const f=fixture({callServerTool:()=>new Promise(resolve=>{finish=resolve;})});await f.controller.start();
  const pending=f.controller.element.api('/documents/one/accept','POST',{proposalId:'p1'});
  f.apps[0].ontoolresult(initial('a','two',2));finish(response('a',{id:'old'}));
  await assert.rejects(pending,{code:'APP_STALE'});assert.equal(f.apps[0].calls.length,1);assert.equal(f.controller.element.options.documentId,'two');f.controller.dispose();
});
test('transport failure preserves current source and does not automatically replay mutation',async()=>{
  const f=fixture({callServerTool:async()=>{throw new Error('network');}});await f.controller.start();const current=f.controller.element;
  await assert.rejects(current.api('/documents/one/accept','POST',{proposalId:'p1'}),{code:'APP_CONNECTION'});
  assert.equal(f.controller.element,current);assert.equal(f.apps[0].calls.length,1);f.controller.dispose();
});
test('initialization failure has a usable retry with a new App instance',async()=>{
  const f=fixture({connect:async(app,attempt)=>{if(attempt===1)throw new Error('host delayed');app.ontoolresult(initial());}});
  await f.controller.start();assert.equal(f.controller.element,null);assert.equal(f.statuses.at(-1).retry,true);
  await f.controller.start();assert(f.controller.element);assert.equal(f.apps.length,2);f.controller.dispose();
});
test('host download bridge contains complete text, handles cancellation, and fails clearly when unavailable',async()=>{
  let download;const f=fixture({downloadFile:async request=>{download=request;return {isError:true};}});await f.controller.start();
  const element=f.controller.element;element.download('complete private source','BUILD.md');await flush();
  assert.equal(download.contents[0].resource.text,'complete private source');assert.equal(download.contents[0].resource.uri,'file:///BUILD.md');
  assert.equal(element.s.error.code,'DOWNLOAD_DECLINED');assert.equal(element.s.notice,'');f.controller.dispose();
  const missing=fixture({capabilities:{}});await missing.controller.start();assert.throws(()=>missing.controller.element.download('x','BUILD.md'),{code:'DOWNLOAD_UNAVAILABLE'});missing.controller.dispose();
});
test('teardown clears private state and rejects stale API requests',async()=>{
  const f=fixture();await f.controller.start();const old=f.controller.element;await f.apps[0].onteardown();
  assert.equal(f.controller.element,null);assert.deepEqual(old.s.instructions,{});await assert.rejects(old.api('/session'),{code:'APP_STALE'});
});
test('duplicate retry clicks share one initialization; module load can recover without any mutation',async()=>{
  let attempts=0,finish;const f=fixture({loadModule:async()=>{if(++attempts===1)throw new Error('asset failed');await new Promise(resolve=>{finish=resolve;});}});
  await f.controller.start();assert.equal(f.statuses.at(-1).retry,true);
  const first=f.controller.start(),second=f.controller.start();assert.equal(first,second);
  while(!finish)await flush();finish();await first;
  assert.equal(f.apps.length,2);assert.equal(f.controller.element.options.documentId,'one');
  assert(f.apps.every(app=>app.calls.length===0));f.controller.dispose();
});
test('bootstrap errors are surfaced and can be retried rather than leaving an endless loading state',async()=>{
  const denied=response('a',{error:{code:'AUTH_REQUIRED',message:'Reconnect the account.'}},401);
  const f=fixture({connect:async app=>{app.ontoolresult(denied);},callServerTool:async()=>denied});
  await f.controller.start();assert.equal(f.controller.element,null);assert.deepEqual(f.statuses.at(-1),{message:'Reconnect the account.',retry:true});f.controller.dispose();
});
test('teardown during the initial-result wait resolves initialization without further reads',async()=>{
  const f=fixture({connect:async()=>{}});const starting=f.controller.start();f.controller.dispose();await starting;
  assert.equal(f.controller.element,null);assert.equal(f.apps[0].calls.length,0);
});
test('insufficient-scope challenge preserves the view and asks for account reconnection without replaying the write',async()=>{
  const denied=response('a',{error:{code:'FORBIDDEN',message:'Cannot write.'}},403);denied._meta['mcp/www_authenticate']='Bearer scope="document:write"';
  const f=fixture({callServerTool:async()=>denied});await f.controller.start();const current=f.controller.element;
  await assert.rejects(current.api('/documents','POST',{type:'example'}),error=>error.code==='INSUFFICIENT_SCOPE'&&/Reconnect/.test(error.message));
  assert.equal(f.controller.element,current);assert.equal(f.apps[0].calls.length,1);f.controller.dispose();
});

test('controller disposes each resize subscription before retry, closed host and teardown',async()=>{
  let active=0,started=0,stopped=0;
  const f=fixture({observeSize:()=>{active++;started++;return()=>{active--;stopped++;};}});
  await f.controller.start();assert.equal(active,1);
  await f.controller.start();assert.equal(active,1);assert.equal(stopped,1);
  f.apps.at(-1).onclose();assert.equal(active,0);
  await f.controller.start();assert.equal(active,1);
  f.controller.dispose();assert.equal(active,0);assert.equal(started,3);assert.equal(stopped,3);
});
