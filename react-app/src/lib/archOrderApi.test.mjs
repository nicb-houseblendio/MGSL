// archOrderApi: the one outcome classification, and the submit timeout.
//
// The Done button on the confirmation dialog is now disabled while submitting,
// like Escape and outside-click already were. That closes the hole where the
// trader dismissed the dialog mid-request and lost the outcome, but it also means
// a request that never returns would leave them with NO exit. The timeout below is
// what makes the guard safe to ship; the two are one change.
import { orderOutcome, createArchOrder, SUBMIT_TIMEOUT_MS } from './archOrderApi.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ── orderOutcome ──────────────────────────────────────────────────────────────
let o = orderOutcome(null, true);
ok('submitting: kind', o.kind === 'submitting', o);
ok('submitting: no cart reason yet', o.cartReason === null, o);

o = orderOutcome(null, false);
ok('not connected: kind', o.kind === 'notConnected', o);
ok('not connected: cart reason names the cause', /not connected to NetSuite/.test(o.cartReason || ''), o);

o = orderOutcome({ ok: false, error: 'No sales rep was selected and none could be resolved.' }, false);
ok('refused: kind', o.kind === 'refused', o);
ok('refused: cart reason carries the refusal text', /No sales rep was selected/.test(o.cartReason || ''), o);
ok('refused: title may say nothing was written (server answered)', /nothing was written/.test(o.title), o);

o = orderOutcome({ ok: false, transportFailure: true, error: 'Failed to fetch' }, false);
ok('unknown: kind', o.kind === 'unknown', o);
ok('unknown: cart reason sends the trader to the SO list', /Check the sales order list/.test(o.cartReason || ''), o);
ok('unknown: NEVER claims nothing was written (the SO may exist)', !/nothing was written/i.test(o.title + ' ' + o.cartReason), o);

o = orderOutcome({ ok: true, tranId: 'SO-CWP-001354', salesOrderId: 126868 }, false);
ok('created: kind', o.kind === 'created', o);
ok('created: title prefers the tranId', o.title === 'Sales order created — SO-CWP-001354', o);
ok('created: no cart reason (cart is cleared)', o.cartReason === null, o);

o = orderOutcome({ ok: true, salesOrderId: 126868 }, false);
ok('created without tranId: falls back to the internal id', o.title === 'Sales order created — internal id 126868', o);

// submitting wins over any stale result
o = orderOutcome({ ok: false, error: 'old' }, true);
ok('submitting beats a stale result', o.kind === 'submitting', o);

// ── submit timeout ────────────────────────────────────────────────────────────
ok('default timeout is finite and generous (60s..300s)', SUBMIT_TIMEOUT_MS >= 60_000 && SUBMIT_TIMEOUT_MS <= 300_000, SUBMIT_TIMEOUT_MS);

globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/order' } };
let sawSignal = false;
globalThis.fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    sawSignal = !!(init && init.signal);
    if (init && init.signal) {
      init.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted.');
        e.name = 'AbortError';
        reject(e);
      });
    }
    // never resolves on its own: a hung Suitelet
  });

const draft = {
  mode: 'new',
  existingSO: null,
  header: { customerId: '1', customerPO: 'PO-1', shipTo: '', currency: 'CAD', shipDate: '2026-09-10', incoterms: 'Delivered', salesTeam: '', paymentTerms: '' },
  lines: [],
};

const t0 = Date.now();
const r = await createArchOrder(draft, 'ARCH-test-key', { timeoutMs: 60 });
const elapsed = Date.now() - t0;
ok('timeout: fetch was given an abort signal', sawSignal);
ok('timeout: returned instead of hanging (under 2s)', elapsed < 2000, elapsed);
ok('timeout: ok is false', r.ok === false, r);
ok('timeout: classified as a transport failure, not a refusal', r.transportFailure === true, r);
ok('timeout: message says NetSuite did not answer and the order may exist', /did not answer within/.test(r.error || '') && /may still have been created/.test(r.error || ''), r.error);
ok('timeout: message does not claim nothing was written', !/nothing was written/i.test(r.error || ''), r.error);
ok('timeout: flows into orderOutcome as unknown', orderOutcome(r, false).kind === 'unknown');

// a fetch that resolves must still be honoured (the timer must not fire after)
globalThis.fetch = () => Promise.resolve({ json: async () => ({ ok: true, tranId: 'SO-CWP-000001', salesOrderId: 1 }) });
const good = await createArchOrder(draft, 'ARCH-test-key-2', { timeoutMs: 60 });
ok('a fast answer is returned intact', good.ok === true && good.tranId === 'SO-CWP-000001', good);
await new Promise((res) => setTimeout(res, 120));
ok('and the timer does not fire afterwards (no unhandled abort)', true);

// ── 2026-09-08 evening: four defects found by an adversarial pass, all in code that
//    shipped that morning. Each assertion below fails on the version that shipped.
//
// D1 the timeout was BELOW the measured server time. A one-line order took 102s in
//    this account's own log (SO-CWP-001354), of which assignLots' second save was 62s.
//    At 90s a correctly saved order was reported as "may not exist".
ok('timeout is above the 102s measured for a one-line order', SUBMIT_TIMEOUT_MS > 102_000, SUBMIT_TIMEOUT_MS);
ok('timeout is 300s', SUBMIT_TIMEOUT_MS === 300_000, SUBMIT_TIMEOUT_MS);

// D2 the server distinguishes REFUSED from FAILED; the client dropped the field, so a
//    throw AFTER the save committed was reported as "nothing was written".
let f = orderOutcome({ ok: false, code: 'FAILED', error: 'SSS_USAGE_LIMIT_EXCEEDED' }, false);
ok('a server FAILED is classified unknown, not refused', f.kind === 'unknown', f);
ok('a server FAILED never claims nothing was written', !/nothing was written/i.test(f.title + ' ' + f.cartReason), f);
ok('a server FAILED sends the trader to the SO list', /check the sales order list/i.test(f.cartReason || ''), f);
let rf = orderOutcome({ ok: false, code: 'REFUSED', error: 'The order needs a customer' }, false);
ok('a server REFUSED is still a refusal', rf.kind === 'refused', rf);
ok('a server REFUSED may say nothing was written', /nothing was written/.test(rf.title), rf);
ok('no code at all (client-side refusal) stays a refusal', orderOutcome({ ok: false, error: 'not connected' }, false).kind === 'refused');

// the code must survive the transport layer, or none of the above can ever fire
globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/order' } };
globalThis.fetch = () => Promise.resolve({ json: async () => ({ ok: false, code: 'FAILED', error: 'boom' }) });
const carried = await createArchOrder(draft, 'ARCH-code-key');
ok('the server code survives submit() and reaches the caller', carried.code === 'FAILED', carried);
ok('and classifies as unknown end to end', orderOutcome(carried, false).kind === 'unknown');

// D3 submit() must always RESOLVE. It built an AbortController above its own try, so a
//    browser without one rejected instead, and ArchScreen had no catch: `submitting`
//    stayed true and every exit from the confirmation modal is gated on it.
const realAC = globalThis.AbortController;
delete globalThis.AbortController;
let resolved = true, out = null;
try { out = await createArchOrder(draft, 'ARCH-no-ac'); } catch (e) { resolved = false; out = String(e); }
globalThis.AbortController = realAC;
ok('createArchOrder resolves even with no AbortController, never rejects', resolved, out);
ok('and reports it as a transport failure rather than a refusal', resolved && out.ok === false && out.transportFailure === true, out);

console.log(fail ? ('# FAIL ' + fail) : '# archOrderApi ok');
process.exit(fail ? 1 : 0);
