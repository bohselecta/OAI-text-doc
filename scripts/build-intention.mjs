import { build } from 'esbuild';
import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { createProject } from '../src/intention/state.mjs';
import { makeCapsule } from '../src/intention/capsule.mjs';
export async function buildIntention(){mkdirSync('dist/intention',{recursive:true});await build({entryPoints:['src/intention/workspace.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',outfile:'dist/intention/capsule-runtime.js',legalComments:'none'});const runtime=readFileSync('dist/intention/capsule-runtime.js','utf8'),css=readFileSync('src/intention/workspace.css','utf8');writeFileSync('dist/intention/language-canvas.capsule.html',await makeCapsule(createProject(),{runtime,css}));console.log('Built self-contained whole-intention HTML capsule (no network or embedded AI).');}
if(process.argv[1]?.endsWith('build-intention.mjs'))await buildIntention();
