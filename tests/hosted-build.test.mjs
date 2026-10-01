import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const env={...process.env,VERCEL:'1',DOCUMENT_ORIGIN:'https://build.example',DOCUMENT_OAUTH_ISSUER:'https://identity.example/',DOCUMENT_OAUTH_JWKS_URL:'https://identity.example/jwks'};
test('Vercel static output contains OAuth discovery without reserved-path rewrites',()=>{
  execFileSync(process.execPath,['scripts/build-hosted.mjs'],{env});
  const metadata=JSON.parse(readFileSync('dist/public/.well-known/oauth-protected-resource'));
  assert.equal(metadata.resource,'https://build.example/mcp');
  assert.deepEqual(metadata.authorization_servers,['https://identity.example/']);
  const config=JSON.parse(readFileSync('vercel.json'));
  assert.ok(config.rewrites.every(rule=>!rule.source.startsWith('/.well-known')));
  const manifest=JSON.parse(readFileSync('dist/hosted-manifest.json'));assert.equal(manifest.deployable,true);
  assert.ok(!readFileSync('dist/public/.well-known/oauth-protected-resource','utf8').includes('DATABASE_URL'));
});
test('Vercel build fails closed without public OAuth deployment config',()=>{
  const clean={...process.env,VERCEL:'1'};for(const k of ['DOCUMENT_ORIGIN','DOCUMENT_OAUTH_ISSUER','DOCUMENT_OAUTH_JWKS_URL','DOCUMENT_OAUTH_AUDIENCE'])delete clean[k];
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-hosted.mjs'],{env:clean,stdio:'pipe'}),e=>e.status!==0);
});
