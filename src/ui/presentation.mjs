/** All interpolated source, model and user strings are escaped before rendering. */
export const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={
 document:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
 home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 space:'<rect x="4" y="6" width="13" height="15" rx="3"/><path d="m10 6 1-3 10 3-3 13"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l-4 3"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 down:'<path d="m6 9 6 6 6-6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 panel:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
 bell:'<path d="M6 9a6 6 0 1 1 12 0c0 5 3 6 3 8H3c0-2 3-3 3-8ZM9 21h6"/>',
 check:'<path d="m5 12 4 4 10-10"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
 unlock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/>',
 arrow:'<path d="M12 20V4m-7 7 7-7 7 7"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
 undo:'<path d="M9 5 3 11l6 6M4 11h10a6 6 0 0 1 6 6"/>',
 link:'<path d="m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
 folder:'<path d="M3 7V4h6l3 3h9v14H3Z"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="8" r="2"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
 sheet:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 10h18M10 3v18"/>',
 slides:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M6 3h12"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
 alert:'<path d="m12 3 10 18H2ZM12 9v5M12 17v1"/>',
 dots:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 moon:'<path d="M20 14A8 8 0 0 1 10 4 9 9 0 1 0 20 14Z"/>',
 file:'<path d="M6 2h8l5 5v15H6Z M14 2v6h5"/>'
};
export const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.document}</svg>`;
export function markdown(source){
  // Deliberately small display grammar. No HTML, images, URLs or code execution.
  const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  const lines=source.split('\n');let out='',inCode=false,code=[];
  for(const line of lines){
    if(/^```/.test(line)){if(inCode){out+=`<pre>${esc(code.join('\n'))}</pre>`;code=[];}inCode=!inCode;continue;}
    if(inCode){code.push(line);continue;}
    if(!line.trim()){out+='<div class="paragraph-gap"></div>';continue;}
    if(/^[-*] /.test(line))out+=`<p class="list-line"><span aria-hidden="true">•</span>${inline(line.slice(2))}</p>`;
    else out+=`<p>${inline(line.replace(/^#{1,6}\s+/,''))}</p>`;
  }
  if(code.length)out+=`<pre>${esc(code.join('\n'))}</pre>`;
  return out;
}
export const shortHash=h=>esc(h?.slice(0,12)??'—');
export const number=n=>new Intl.NumberFormat('en-US').format(n??0);
export const date=d=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
