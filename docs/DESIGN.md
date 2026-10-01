# Product and interaction design

## One thing to make things with

The user's concept is preserved literally: a large document, addressable semantic sections, no insertion cursor in the work itself. The author changes an idea by instructing a selected scope. The work remains in one canonical place instead of accumulating across chat responses.

The proposal is named **Document** in the host interface. **Language Canvas** describes its authoring model, not a competing shell. The original reference screenshot supplies the placement and restrained dark workspace vocabulary. The implemented shell uses original line icons, system typography, charcoal surfaces, subtle violet selection and a small two-mode control. No OpenAI logo, official product claim or inaccessible internal asset is needed.

## Draft

The center is a reading surface. Section boundaries are quiet until hovered or selected. Selection is indicated by border, tint, text and icon rather than color alone. A persistent composer identifies the exact section and says “Only this section.” The right inspector connects the selected source to the outcome spine; it explicitly says **Not yet audited** when it is only showing authored stage presence.

A proposal replaces neither the document nor its canonical section until accepted. Before and after are shown together. Accept, discard and restore are ordinary explicit actions. A pending proposal prevents switching to a different section or compiling a new release. Locked sections disable generation, and the server independently rejects attempts to modify them.

On small screens, the inspector collapses and lock/restore remain in the composer. The navigation becomes an overlay. Keyboard users can enter the selected section, move among sections with arrow keys, select with Enter/Space and focus the instruction field. Enter proposes; Shift+Enter inserts a newline; composition events are not prematurely submitted. Native dialogs trap focus and return it on Escape. Reduced motion removes transitions and smooth scrolling.

## Publish

Publish is a separate workspace, not a second editable draft. It shows target/format/allowance, read-only compiled source, source revision/hash, explicit audit gates and findings. Clicking a source-linked finding returns to the relevant Draft section. A missing stage opens section creation. No audit pass silently authors a repair.

The status language is deliberately specific: **findings to resolve**, **structure checked**, **model review not run**, or the actual model-reviewed release. There is no percentage “quality score.” A draft export remains useful even when review or authorization is unavailable, but its name and receipt cannot be mistaken for an audited release.

## Spine choice

The universal chain is intent → outcome → audience → deliverables → requirements → constraints → structure → execution → verification → delivery. Domain profiles extend this chain by required roles, not by copying dozens of generic headings into every project. The first creation screen selects one profile; the author can later combine any of six profiles. Existing source survives a profile change.

## Deliberate tradeoffs

Automatic destructive consolidation would violate the central scope promise. Version one therefore reports repetitions and incoherence, preserves source in compilation, and routes repairs through explicit authoring. A future semantic condenser must propose a source-mapped transformation and prove contractual preservation before it can replace this behavior.

The interface does not promote a constant stream of suggested AI actions. The main controls are source, selection, instruction and review. Metadata controls exist where an explicit permission decision is clearer than a language inference: lock, restore, profiles, output format and publish authorization.

The module can produce arbitrary textual project plans, but it does not claim arbitrary software execution, design-asset production, physical manufacturing or research results merely because the final file describes them.
