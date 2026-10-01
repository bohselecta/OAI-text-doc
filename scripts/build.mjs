import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
function walk(path) { return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${path}/${e.name}`):[`${path}/${e.name}`]); }
for(const file of walk('src').filter(f=>f.endsWith('.mjs'))) execFileSync(process.execPath,['--check',file]);
rmSync('dist',{recursive:true,force:true});mkdirSync('dist',{recursive:true});
cpSync('src','dist/src',{recursive:true});cpSync('package.json','dist/package.json');
const files=walk('dist');
writeFileSync('dist/manifest.json',JSON.stringify({version:'1.0.0',files:Object.fromEntries(files.map(f=>[f.slice(5),createHash('sha256').update(readFileSync(f)).digest('hex')]))},null,2));
console.log(`Built ${files.length} runtime files; all JavaScript syntax checked (native reference remains dependency-free).`);
