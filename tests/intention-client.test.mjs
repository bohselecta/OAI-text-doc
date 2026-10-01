/** Explicit DOM-stub client logic tests. Native Chromium separately proves UI/CSP/download behavior. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as stateApi from '../src/intention/state.mjs';
import * as capsuleApi from '../src/intention/capsule.mjs';
import * as bridgeApi from '../src/intention/document-bridge.mjs';
const source=readFileSync(new URL('../src/intention/workspace.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function configure','function configure').replace(/boot\(\);\s*$/,'globalThis.CLIENT_TEST={state,boot,setProject,localWrite,localProjects,render,navigate,run,command};');
function harness(embedded,saved=new Map(),session=new Map(),fetcher=null){
 const listeners={}; const app={innerHTML:'',addEventListener:(name,fn)=>listeners[name]=fn,querySelectorAll:()=>[],querySelector:()=>null};
 const location={hash:'',pathname:'/test.capsule.html'};const elements={app,'capsule-state':embedded?{textContent:JSON.stringify(embedded)}:null};
 const context=vm.createContext({...stateApi,...capsuleApi,...bridgeApi,fetch:fetcher,JSON,validateProject:value=>stateApi.validateProject(JSON.parse(JSON.stringify(value))),applyCommand:(input,command,...args)=>stateApi.applyCommand(JSON.parse(JSON.stringify(input)),JSON.parse(JSON.stringify(command)),...args),console,structuredClone,TextEncoder,crypto,URL,Blob,setTimeout,clearTimeout,FormData:class{constructor(form){this.data=form.data}get(k){return this.data[k]}getAll(k){return this.data[k]??[]}},document:{activeElement:null,getElementById:id=>elements[id]??null,querySelector:()=>null,addEventListener:()=>{}},window:{addEventListener:()=>{}},location,history:{replaceState:(_a,_b,hash)=>location.hash=hash,pushState:(_a,_b,hash)=>location.hash=hash},localStorage:{get length(){return saved.size},key:i=>[...saved.keys()][i],getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)},sessionStorage:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value)},navigator:{locks:{request:async(_key,fn)=>fn()}},requestAnimationFrame:()=>{}});
 vm.runInContext(source,context);
 return {ctx:context,ref:context.CLIENT_TEST,saved,session,listeners,app};
}
async function settle(){for(let i=0;i<20;i++)await Promise.resolve()}

test('offline forks, full-state CAS, rediscovery and project-scoped drafts',async()=>{
let original=stateApi.createProject('original seed','Original');original=stateApi.applyCommand(original,{type:'intention',intention:'accepted branch A',title:'Branch A'});
const divergent=structuredClone(original);divergent.intention='accepted branch B';divergent.title='Branch B';const key=`language-canvas:intention:${original.id}`;
const h=harness(original,new Map([[key,JSON.stringify(original)]]));await h.ref.boot();assert.equal(h.ref.state.project.id,original.id);
h.listeners.change({target:{id:'import-file',files:[{size:1000,text:async()=>JSON.stringify(divergent)}]}});await settle();assert.equal(JSON.parse(h.saved.get(key)).intention,original.intention);assert.notEqual(h.ref.state.project.id,original.id);
const boot=harness(divergent,new Map([[key,JSON.stringify(original)]]));await boot.ref.boot();assert.notEqual(boot.ref.state.project.id,original.id);assert.equal(JSON.parse(boot.saved.get(key)).intention,original.intention);
await assert.rejects(h.ref.localWrite({...original,revision:original.revision+1},divergent),e=>e.code==='STALE');
h.listeners.click({target:{closest:()=>({dataset:{action:'home'},disabled:false})}});await settle();assert.equal(h.ref.state.projects.length,2);
h.listeners.submit({target:{matches:()=>true,dataset:{form:'create'},data:{intention:'Brand new capsule intention'}},preventDefault:()=>{}});await settle();
const newId=h.ref.state.project.id;const restarted=harness(original,h.saved,h.session);await restarted.ref.boot();assert.equal(restarted.ref.state.project.id,newId);
h.listeners.input({target:{id:'constraints',closest:()=>null,value:'PRIVATE DRAFT FOR PROJECT A'}});await h.ref.setProject(original);h.ref.navigate('boundaries');assert.equal(h.app.innerHTML.includes('PRIVATE DRAFT FOR PROJECT A'),false);



});
test('host identity changes discard stale bootstrap results and prior source',async()=>{
// Explicit mock responses, no credential or network use.
let resolveOld,oldStarted=false;const oldProject=stateApi.createProject('Actor A source','Actor A');
const remote=harness(null,new Map(),new Map([['language-canvas:current',oldProject.id]]),async(path,options)=>{const token=options.headers.Authorization;if(path.endsWith('/session'))return new Response(JSON.stringify({mode:'local',persistence:'server',actor:{role:'admin',sub:token?'B':'A'}}));if(path==='/api/intention/projects')return new Response(JSON.stringify(token?[]:[{id:oldProject.id,title:oldProject.title}]));oldStarted=true;return await new Promise(resolve=>resolveOld=resolve)});
const oldBoot=remote.ref.boot();for(let i=0;i<30&&!oldStarted;i++)await settle();
remote.ctx.languageCanvasWorkspace.configure({getAccessToken:async()=> 'test-token-B'});for(let i=0;i<30;i++)await settle();
resolveOld(new Response(JSON.stringify(oldProject)));await oldBoot;await settle();
assert.equal(remote.ref.state.session.actor.sub,'B');assert.equal(remote.ref.state.project,null);
});

test('reconfiguration clears open modal and cancels an in-flight old-session import',async()=>{
 const imported=stateApi.createProject('Private old-session source','Imported source');const posts=[];
 const remote=harness(null,new Map(),new Map(),async(path,options)=>{if(options.method==='POST')posts.push({path,body:options.body});if(path.endsWith('/session'))return new Response(JSON.stringify({mode:'local',persistence:'server',actor:{role:'admin'}}));return new Response('[]');});await remote.ref.boot();
 await remote.ref.setProject(imported);remote.ref.state.modal={type:'addPart',parentId:null,title:'Draft'};
 let resolveFile;remote.listeners.change({target:{id:'import-file',files:[{size:1000,text:()=>new Promise(resolve=>resolveFile=resolve)}]}});await settle();
 assert.doesNotThrow(()=>remote.ctx.languageCanvasWorkspace.configure({getAccessToken:async()=> 'test-token-B'}));await settle();resolveFile(JSON.stringify(imported));await settle();
 assert.equal(remote.ref.state.modal,null);assert.equal(remote.ref.state.project,null);assert.equal(posts.length,0);
});
