/** Framework-independent domain contract. All public inputs are validated. */
export class Fault extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new Fault(status, code, message); };
export const KINDS = ['intent','outcome','audience','deliverables','requirements','constraints','structure','execution','verification','delivery','interaction','data','recovery','security','method','evidence','alternatives','voice','continuity','direction','assets','operations','economics','materials','safety','reference'];
export const UNIVERSAL = KINDS.slice(0, 10);
export const PROFILES = {
  software: { label: 'Software & interactive', kinds: ['interaction','data','recovery','security'], check: 'Prove the primary interaction, retained data, failure recovery and access boundaries.' },
  research: { label: 'Research & evidence', kinds: ['method','evidence','alternatives'], check: 'Separate claims from evidence; define methods, alternatives and falsification.' },
  writing: { label: 'Writing & knowledge', kinds: ['voice','continuity'], check: 'Make audience, argument, voice, continuity and editorial acceptance explicit.' },
  media: { label: 'Visual & media', kinds: ['direction','assets','continuity'], check: 'Preserve approved direction, asset rights, continuity and representative inspection.' },
  operations: { label: 'Business & operations', kinds: ['operations','economics','recovery'], check: 'Specify owners, permissions, costs, success measures, rollout and recovery.' },
  physical: { label: 'Physical & spatial', kinds: ['materials','safety','recovery'], check: 'Specify dimensions, materials, tolerances, fabrication and qualified physical validation.' }
};
export const TITLES = {
  intent:'The idea', outcome:'What success looks like', audience:'Who this is for', deliverables:'What we are making', requirements:'What it must do', constraints:'What must stay true', structure:'How it fits together', execution:'The build sequence', verification:'How we will prove it', delivery:'The finish line', interaction:'The core interaction', data:'Data & ownership', recovery:'When things go wrong', security:'Trust & permissions', method:'Method & falsification', evidence:'Evidence & uncertainty', alternatives:'Competing explanations', voice:'Voice & argument', continuity:'Continuity', direction:'Visual direction', assets:'Assets & rights', operations:'Owners & workflow', economics:'Economics & measures', materials:'Materials & tolerances', safety:'Safety & physical validation', reference:'Reference'
};
export const TARGETS = {
  codex: { label: 'Codex', directive: 'Read this BUILD file explicitly before implementation. It is not auto-discovered AGENTS.md. Inspect any existing AGENTS.md hierarchy and preserve unrelated work. Establish contracts, build vertical slices, run meaningful tests and verify the actual result. Create concise durable project instructions as the repository grows.' },
  antigravity: { label: 'Antigravity', directive: 'Read this BUILD file explicitly. Inspect the workspace, applicable rules and skills. Implement the complete deliverable in dependency order. Use available terminal and browser checks and preserve evidence of failures and repairs. Do not assume this file configures the agent automatically.' },
  generic: { label: 'Any capable builder', directive: 'Read this whole file. Establish the environment and constraints, then execute the bounded plan. Verify observable acceptance criteria, preserve evidence and report any unavailable tool, credential, permission or physical validation.' }
};
export function record(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
export function exact(v, keys) {
  if (!record(v) || Object.keys(v).some(k => !keys.includes(k))) fail(400,'SCHEMA','Unexpected or invalid fields.');
}
export function text(v, name, max=20000, allowEmpty=false) {
  if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim()) || /\u0000/.test(v)) fail(400,'SCHEMA',`Invalid ${name}.`);
  return v.replace(/\r\n?/g,'\n');
}
export function profiles(v) {
  if (!Array.isArray(v) || !v.length || v.length > 6 || new Set(v).size !== v.length || v.some(p => typeof p!=='string'||!Object.hasOwn(PROFILES,p))) fail(400,'SCHEMA','Choose one or more valid project profiles.');
  return v;
}
export function validateSection(s) {
  exact(s,['id','title','kind','content','locked','dependsOn']);
  if (typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)) fail(400,'SCHEMA','Invalid section id.');
  text(s.title,'section title',100); text(s.content,'section content',30000,true);
  if (!KINDS.includes(s.kind) || typeof s.locked !== 'boolean' || !Array.isArray(s.dependsOn) || s.dependsOn.length > 64 || s.dependsOn.some(x=>typeof x!=='string')) fail(400,'SCHEMA','Invalid section contract.');
  return s;
}
export function validateDocument(d) {
  exact(d,['id','title','profiles','revision','sections','createdAt','updatedAt']);
  text(d.id,'document id',80); text(d.title,'document title',120); profiles(d.profiles);
  for(const key of ['createdAt','updatedAt'])if(typeof d[key]!=='string'||!Number.isFinite(Date.parse(d[key])))fail(400,'SCHEMA','Document timestamps must be valid date strings.');
  if (!Number.isSafeInteger(d.revision) || d.revision < 1 || !Array.isArray(d.sections) || !d.sections.length || d.sections.length > 64) fail(400,'SCHEMA','Invalid document shape.');
  d.sections.forEach(validateSection);
  const ids = new Set(d.sections.map(s=>s.id));
  if (ids.size !== d.sections.length || d.sections.some(s=>s.dependsOn.some(id=>!ids.has(id)||id===s.id))) fail(400,'SCHEMA','Section identities or dependencies are invalid.');
  if (new TextEncoder().encode(JSON.stringify(d)).length > 900000) fail(413,'TOO_LARGE','Document exceeds the 900 KB source limit.');
  return d;
}
export function budget(v={}) {
  exact(v,['context','reserve']);
  const context=v.context??128000, reserve=v.reserve??32000;
  if (![context,reserve].every(Number.isSafeInteger)||context<2048||context>2000000||reserve<1024||reserve>=context) fail(400,'BUDGET','Use a context limit of 2,048–2,000,000 and a reserve of at least 1,024, smaller than the limit.');
  return {context,reserve,available:context-reserve};
}
export function authorize(actor, permission) {
  const allow={read:['viewer','editor','publisher','admin'],write:['editor','publisher','admin'],publish:['publisher','admin']};
  if (!actor || !allow[permission]?.includes(actor.role)) fail(403,'FORBIDDEN',`Your role cannot ${permission} this document.`);
}
export function requireRevision(doc, revision) {
  if (!Number.isSafeInteger(revision) || revision!==doc.revision) fail(409,'REVISION_CONFLICT','The document changed. Refresh and review the latest version; your instruction has been kept.');
}
