import { randomUUID } from 'node:crypto';
import { KINDS, TITLES, fail, text, validateDocument } from './contracts.mjs';
import { template } from './templates.mjs';
export function importDocument(input,title='Imported document',profiles=['writing']) {
  text(input,'import',900000);
  if(input.trim().startsWith('{')) {
    let parsed;try{parsed=JSON.parse(input);}catch{fail(400,'IMPORT_JSON','Invalid JSON backup.');}
    validateDocument(parsed);
    return {...parsed,id:randomUUID(),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  }
  const d=template(title,profiles,'');
  const chunks=input.split(/^#{1,3}\s+/m).filter(x=>x.trim());
  const sections=chunks.map((chunk,i)=>{
    const [first,...rest]=chunk.trim().split('\n');
    const title=rest.length?first.slice(0,100):`Imported section ${i+1}`;
    const match=Object.entries(TITLES).find(([kind,label])=>title.toLowerCase().includes(label.toLowerCase())||title.toLowerCase()===kind);
    return {id:`import-${i+1}`,title,kind:match?.[0]??(i===0?'intent':'reference'),content:rest.length?rest.join('\n').trim():first,locked:false,dependsOn:[]};
  });
  d.sections=sections;
  return validateDocument(d);
}
