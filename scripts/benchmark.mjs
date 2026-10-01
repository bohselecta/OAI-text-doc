/** Local workload measurements, not a latency SLO or production load test. */
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { platform, arch, cpus } from 'node:os';
import { example, RECOVERY } from '../src/core/templates.mjs';
import { compile, structuralAudit } from '../src/core/compiler.mjs';
import { Store } from '../src/server/store.mjs';
const results=[];
function measure(name,fn,iterations=40){
  for(let i=0;i<5;i++)fn();
  const samples=[];
  for(let i=0;i<iterations;i++){const begin=performance.now();fn();samples.push(performance.now()-begin);}
  samples.sort((a,b)=>a-b);
  results.push({name,iterations,p50Ms:+samples[Math.floor(samples.length*.5)].toFixed(3),p95Ms:+samples[Math.floor(samples.length*.95)].toFixed(3),maxMs:+samples.at(-1).toFixed(3)});
}
const small=example();small.sections.find(s=>s.id==='recovery').content=RECOVERY;
const large=structuredClone(small);
while(large.sections.length<64){const i=large.sections.length;large.sections.push({id:`reference-${i}`,title:`Reference ${i}`,kind:'reference',content:`Source ${i}. `+'Bounded workload text; no external factual claim. '.repeat(270),locked:false,dependsOn:[]});}
for(const [name,doc]of [['17 sections',small],['64 sections',large]])measure(`compile + structural audit: ${name} / ${Buffer.byteLength(JSON.stringify(doc))} bytes`,()=>{const c=compile(doc,{budget:{context:2000000,reserve:32000}});structuralAudit(doc,c);});
const store=new Store(),actor={sub:'benchmark',tenant:'local',role:'admin'};let doc=store.create(actor,small);
measure('SQLite in-memory transactional section commit + snapshot + event',()=>{doc=store.mutate(actor,doc.id,doc.revision,'benchmark',{sectionId:'intent'},d=>{d.sections[0].content=`Benchmark revision ${d.revision}`;});});
store.close();
const report={environment:{node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model},scope:'Single-process local workloads. In-memory SQLite, no provider, browser network, concurrent tenants or production disk. Not a production SLA.',peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),results};
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
