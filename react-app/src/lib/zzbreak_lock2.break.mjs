// D13: ArchScreen.handleCreateOrder has no try/finally, so a REJECTION from
// createArchOrder leaves `submitting` true forever. Every dismissal route on the
// confirmation dialog is gated on `submitting`, so the modal can never be closed.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => fs.readFileSync(join(here, '..', p), 'utf8');
const say = (n, cond, got) => console.log((cond ? 'ok   ' : 'BROKEN ') + n + (cond ? '' : '   -> ' + JSON.stringify(got)));

const screen = src('components/ArchScreen.tsx');
const dlg = src('components/arch/ArchOrderDraftDialog.tsx');
const api = src('lib/archOrderApi.ts');
const ui = src('components/ui/dialog.tsx');

const body = screen.slice(screen.indexOf('const handleCreateOrder'), screen.indexOf('const rowSelectionRef'));
say('handleCreateOrder wraps the await in try/finally', /finally\s*{/.test(body), body.match(/try|catch|finally/g));
say('setSubmitting(false) appears on more than the happy path',
  (screen.match(/setSubmitting\(false\)/g) || []).length > 1, (screen.match(/setSubmitting\(false\)/g) || []).length);

{
  const sub = api.slice(api.indexOf('const submit = async'));
  const ac = sub.indexOf('new AbortController()');
  const tr = sub.indexOf('try {');
  say('submit() builds the AbortController INSIDE its try (so it cannot reject)', tr >= 0 && tr < ac,
    { firstTryAt: tr, abortControllerAt: ac, preTry: sub.slice(ac, tr).replace(/\s+/g, ' ') });
}

const exits = {
  'onOpenChange': /onOpenChange=\{\(o\) => \{ if \(!o && !submitting\) onClose\(\); \}\}/.test(dlg),
  'Escape':       /onEscapeKeyDown=\{\(e\) => \{ if \(submitting\) e\.preventDefault\(\); \}\}/.test(dlg),
  'outside':      /onPointerDownOutside=\{\(e\) => \{ if \(submitting\) e\.preventDefault\(\); \}\}/.test(dlg),
  'interact':     /onInteractOutside=\{\(e\) => \{ if \(submitting\) e\.preventDefault\(\); \}\}/.test(dlg),
  'Done':         /disabled=\{submitting\}/.test(dlg),
};
console.log('   dismissal routes gated on `submitting`: ' + JSON.stringify(exits));
say('at least one dismissal route survives a stuck `submitting`',
  Object.values(exits).some((v) => !v), exits);
say('DialogContent renders no built-in close button as a last resort',
  /DialogPrimitive\.Close/.test(ui.slice(ui.indexOf('const DialogContent'), ui.indexOf('DialogContent.displayName'))),
  'no DialogPrimitive.Close inside DialogContent');

// Simulate the exact control flow.
let submitting = false, createdDraft = null;
const setSubmitting = (v) => { submitting = v; };
const createArchOrderThatRejects = async () => { throw new ReferenceError('AbortController is not defined'); };
const handleCreateOrder = async (draft) => {
  createdDraft = draft;
  setSubmitting(true);
  const result = await createArchOrderThatRejects(draft);   // rejects
  setSubmitting(false);                                     // never runs
  return result;
};
await handleCreateOrder({ mode: 'new' }).catch(() => {});
say('after a rejected submit the dialog is dismissable', submitting === false || createdDraft === null,
  { submitting, dialogMounted: createdDraft !== null });
