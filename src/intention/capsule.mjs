import { validateProject, importProject, MAX_BYTES } from './state.mjs';
import { fromDocument } from './document-bridge.mjs';
export const MAX_CAPSULE_BYTES=Math.ceil(MAX_BYTES*4/3)+2000000;
export function encodedState(project){const bytes=new TextEncoder().encode(JSON.stringify(project));let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return JSON.stringify({encoding:'base64-utf8',data:btoa(binary)});}
export function decodeState(text){const value=JSON.parse(text);if(value?.encoding==='base64-utf8'){if(typeof value.data!=='string'||value.data.length>Math.ceil(MAX_BYTES*4/3)+8)throw new Error('The encoded capsule exceeds the source safety limit.');const binary=atob(value.data);if(binary.length>MAX_BYTES)throw new Error('The decoded capsule exceeds the source safety limit.');return importProject(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));}return importProject(value);}
export const encodeData=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const escapeHtml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Uses only accepted runtime bytes. Imported HTML is parsed as text, never executed. */
export async function makeCapsule(project,{runtime,css}){
 validateProject(project);if(typeof runtime!=='string'||!runtime||typeof css!=='string'||!css)throw new Error('The trusted capsule runtime is unavailable. Save JSON instead.');
 runtime=runtime.replace(/<\/script/gi,'<\\/script');css=css.replace(/<\/style/gi,'<\\/style');
 const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(runtime)))));
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(project.title)} · Language Canvas</title><style id="capsule-style">${css}</style></head><body><div id="app"></div><script id="capsule-state" type="application/json">${encodedState(project)}</script><script id="capsule-runtime">${runtime}</script></body></html>`;
}
export function parseCapsule(text){
 if(typeof text!=='string'||text.length>MAX_CAPSULE_BYTES)throw new Error('The import exceeds the capsule size limit.');
 if(text.trim().startsWith('{')){let value;try{value=JSON.parse(text);}catch{return importProject(text);}return value?.sections?fromDocument(value):decodeState(text);}
 const nodes=[...text.matchAll(/<script\b(?=[^>]*\bid=["']capsule-state["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];if(nodes.length!==1)throw new Error('Choose a Language Canvas HTML capsule or JSON backup.');return decodeState(nodes[0][1]);
}
