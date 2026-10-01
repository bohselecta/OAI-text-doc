import { validateProject, importProject, MAX_BYTES } from './state.mjs';
export const encodeData=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const escapeHtml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Uses only accepted runtime bytes. Imported HTML is parsed as text, never executed. */
export async function makeCapsule(project,{runtime,css}){
 validateProject(project);if(typeof runtime!=='string'||!runtime||typeof css!=='string'||!css)throw new Error('The trusted capsule runtime is unavailable. Save JSON instead.');
 runtime=runtime.replace(/<\/script/gi,'<\\/script');css=css.replace(/<\/style/gi,'<\\/style');
 const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(runtime)))));
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(project.title)} · Language Canvas</title><style id="capsule-style">${css}</style></head><body><div id="app"></div><script id="capsule-state" type="application/json">${encodeData(project)}</script><script id="capsule-runtime">${runtime}</script></body></html>`;
}
export function parseCapsule(text){
 if(typeof text!=='string'||text.length>MAX_BYTES+2000000)throw new Error('The import exceeds the capsule size limit.');
 if(text.trim().startsWith('{'))return importProject(text);
 const nodes=[...text.matchAll(/<script\b(?=[^>]*\bid=["']capsule-state["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];if(nodes.length!==1)throw new Error('Choose a Language Canvas HTML capsule or JSON backup.');return importProject(nodes[0][1]);
}
