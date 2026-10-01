import { randomUUID } from 'node:crypto';
import { UNIVERSAL, PROFILES, TITLES, profiles, text } from './contracts.mjs';
export function template(title, selected=['software'], goal='') {
  profiles(selected); text(title,'title',120);
  const now=new Date().toISOString();
  const kinds=[...new Set([...UNIVERSAL,...selected.flatMap(p=>PROFILES[p].kinds)])];
  return { id:randomUUID(), title, profiles:selected, revision:1, createdAt:now, updatedAt:now,
    sections:kinds.map(kind=>({id:kind,title:TITLES[kind],kind,content:kind==='intent'?goal:'',locked:false,dependsOn:kind==='intent'?[]:['intent']})) };
}
export const RECOVERY = 'If a generation times out, retain the accepted section and the original instruction. Offer an explicit retry; never retry a billable request silently. Reject stale proposals without changing any section. On save failure, keep the proposal visible until the server confirms a commit. A rejected or incomplete model response never becomes document state.';
export function example() {
  const d=template('Document — product blueprint',['software','media']);
  const copy={
    intent:'Make the document the place where an idea becomes buildable. Not a conversation about the work. The work itself.\n\nDocument is an instruction-native canvas of semantic sections. Click defines scope. Language defines change.',
    outcome:'A person can turn a disjointed idea into one coherent, audited build contract. A fresh builder can explain the intended outcome, preserve the non-negotiables and begin the first meaningful slice without reconstructing a chat history.',
    audience:'People who make things with intelligent tools: developers, designers, researchers and teams. They need control over intent without becoming prompt engineers. The host owns workspace identity and access.',
    deliverables:'A working Document module, a reference Spaces shell, a durable draft with section history, an audited publish view, and a downloadable BUILD.md or BUILD.txt. Preserve a portable JSON backup of the authored draft.',
    requirements:'REQ-01: An accepted instruction changes only the selected section.\nREQ-02: Every accepted change records its instruction, actor and revision.\nREQ-03: Publish preserves all normative content and traces it to source.\nREQ-04: A stale, locked or unauthorized write leaves the document unchanged.\nREQ-05: A published release is bound to its source revision and audit evidence.',
    constraints:'No insertion cursor in the document. No manual text replacement inside sections. Instruction fields remain editable. No silent cross-section rewrites. No silent truncation to fit a model window. Do not treat an audit as proof that the finished project works. Do not assume a ChatGPT subscription covers runtime API costs.',
    structure:'Separate the framework-neutral document engine, the model adapter and the host interface. Store stable section IDs and revisions. The runtime, not a prompt, enforces the write boundary. Compile a frozen source snapshot into a portable text artifact.',
    execution:'First prove select → instruct → propose → accept while other sections remain byte-identical. Then add durable history and stale-write rejection. Complete structural audits and deterministic compilation. Add isolated semantic and fresh-reader reviews. Integrate the interface, test recovery and accessibility, then prepare the host handoff.',
    verification:'REQ-01: Compare every unselected section before and after an accepted edit; require byte equality.\nREQ-02: Restart the service and verify the accepted instruction and actor remain in history.\nREQ-03: Check that each source section occurs intact in the compiled file and the source map resolves.\nREQ-04: Exercise a second-client stale edit, a locked section and a viewer write; assert zero changes.\nREQ-05: Change the draft after review and prove the previous audit cannot authorize a new release.',
    delivery:'Deliver the source, build instructions, test evidence and integration contracts. A local browser check is not a deployed acceptance check. The host must validate its authentication, retention policy, provider entitlements and production load before enabling the module for an enterprise workspace.',
    interaction:'Click a section. Everything outside it becomes read-only context. Describe a change in the instruction field. Review the proposed replacement and accept or discard it.\n\nDraft stays expansive. Publish becomes precise: a separate screen shows the outcome spine, unresolved findings and the exact compiled text.',
    data:'The server stores workspace-scoped documents, proposals, revision snapshots, audit events and published artifacts. Never send one workspace’s content to another. Keep private model credentials out of the browser and source exports.',
    recovery:'TBD: Define timeout, stale-edit and failed-save recovery without losing accepted work.',
    security:'Verify identity and workspace scope before reading a document. Require editor permission for drafting and publisher permission for releasing. Treat source content, model output and imported text as untrusted data. Reject unknown patch fields and mismatched section IDs.',
    direction:'Quiet, precise, familiar. A charcoal workspace, warm neutral type, generous document margins and a single restrained accent for selection. Hierarchy comes from typography and space, not decoration. Use an original document glyph rather than OpenAI’s logo.',
    assets:'Use system fonts, original interface icons and screenshots of the actual application. Keep first-party source under the OpenAI-exclusive license. Do not redistribute proprietary fonts, screenshots of private workspaces or third-party brand assets.',
    continuity:'Use “Document” in the host menu and interface. Use “Language Canvas” to explain the authoring model. Keep these names consistent in the draft, release file, documentation and host contract.'
  };
  d.sections.forEach(s=>{s.content=copy[s.kind];s.locked=s.kind==='constraints';});
  return d;
}
