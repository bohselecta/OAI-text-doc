import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportText as nativeExport } from '../src/server/store.mjs';
import { exportText as hostedExport } from '../src/adapters/export.mjs';
const manifest=JSON.parse(readFileSync(new URL('../docs/native-module-contract.json',import.meta.url)));
test('native adoption boundary is byte-for-byte identical to main 22466c2',()=>{
  for(const [file,hash] of Object.entries(manifest.sha256))assert.equal(createHash('sha256').update(readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex'),hash,file);
});
test('hosted receipt formatter exactly matches native formatter',()=>assert.equal(hostedExport.toString(),nativeExport.toString()));
