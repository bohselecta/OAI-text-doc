import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDocumentSize } from '../src/adapters/apps/resize.mjs';
function fixture(send=async()=>{}){
 const queued=new Map(),calls=[];let serial=0,observer,disconnected=0;
 const win={innerWidth:600,requestAnimationFrame:cb=>{queued.set(++serial,cb);return serial;},cancelAnimationFrame:id=>queued.delete(id)};
 const doc={documentElement:{style:{height:'100%'},getBoundingClientRect:()=>({height:650})},body:{}};
 class Observer{constructor(cb){this.cb=cb;observer=this;}observe(){}disconnect(){disconnected++;}}
 const dispose=observeDocumentSize({sendSizeChanged:async value=>{calls.push(value);return send(value);}},{window:win,document:doc,ResizeObserver:Observer});
 const flush=async()=>{const frames=[...queued.values()];queued.clear();frames.forEach(cb=>cb());await new Promise(r=>setImmediate(r));};
 return {calls,queued,win,doc,dispose,flush,trigger:()=>observer.cb(),get disconnected(){return disconnected;}};
}
test('owned resize sends changed dimensions once and restores measured root style',async()=>{const f=fixture();await f.flush();assert.deepEqual(f.calls,[{width:600,height:650}]);assert.equal(f.doc.documentElement.style.height,'100%');f.trigger();await f.flush();assert.equal(f.calls.length,1);f.win.innerWidth=390;f.trigger();await f.flush();assert.equal(f.calls.length,2);f.dispose();});
test('owned resize cancels queued RAF and ignores old observer callbacks after teardown',async()=>{const f=fixture();assert.equal(f.queued.size,1);f.dispose();assert.equal(f.queued.size,0);f.trigger();await f.flush();assert.equal(f.calls.length,0);f.dispose();assert.equal(f.disconnected,1);});
test('host disconnect rejection is handled without leaking or replaying resize',async()=>{const f=fixture(async()=>{throw new Error('Not connected');});await f.flush();f.dispose();f.win.innerWidth=400;f.trigger();await f.flush();assert.equal(f.calls.length,1);});
