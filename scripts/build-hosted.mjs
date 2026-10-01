import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hostedAuthConfig, protectedResourceMetadata } from '../src/adapters/oauth.mjs';
const configured=process.env.VERCEL==='1'||['DOCUMENT_OAUTH_ISSUER','DOCUMENT_OAUTH_JWKS_URL','DOCUMENT_OAUTH_AUDIENCE'].some(key=>process.env[key]);
const config=configured?hostedAuthConfig(process.env):null;
import { buildApps } from './build-apps.mjs';
await buildApps();
// Only frozen public UI assets and the bridge bundle go to the static root.
await mkdir('dist/public/ui',{recursive:true});
await mkdir('dist/public/apps',{recursive:true});
const files=['document.mjs','presentation.mjs','document.css','document.svg'];
for(const file of files)await cp(`src/ui/${file}`,`dist/public/ui/${file}`);
await cp('dist/apps/apps-widget.js','dist/public/apps/apps-widget.js');
await writeFile('dist/public/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Document · Language Canvas</title><body><main><h1>Document</h1><p>Language Canvas Apps SDK host. Connect this deployment’s /mcp endpoint from an authorized MCP Apps host.</p><p>Independent OpenAI-exclusive proposal. Not an official OpenAI product or native Spaces integration.</p></main></body></html>');
if(config){
  await mkdir('dist/public/.well-known',{recursive:true});
  await writeFile('dist/public/.well-known/oauth-protected-resource',JSON.stringify(protectedResourceMetadata(config),null,2)+'\n');
}
const paths=[...files.map(f=>`ui/${f}`),'apps/apps-widget.js'];
await writeFile('dist/hosted-manifest.json',JSON.stringify({deployable:Boolean(config),metadataUrl:config?.metadataUrl??null,files:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(`dist/public/${p}`)).digest('hex')]))),neonLiveVerified:false,chatgptLiveVerified:false},null,2));
if(!config)console.log('Assets-only local build: OAuth public config absent; not a deployable hosted package. Vercel builds require it.');
console.log('Built Apps widget and byte-preserved static native module assets.');
