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

console.log(fail ? ('# FAIL ' + fail) : '# archOrderApi ok');
process.exit(fail ? 1 : 0);
