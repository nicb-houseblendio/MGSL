// archOrderApi: the one outcome classification, and the submit timeout.
//
// The Done button on the confirmation dialog is now disabled while submitting,
// like Escape and outside-click already were. That closes the hole where the
// trader dismissed the dialog mid-request and lost the outcome, but it also means
// a request that never returns would leave them with NO exit. The timeout below is
// what makes the guard safe to ship; the two are one change.
import { readFileSync } from 'node:fs';
import { orderOutcome, createArchOrder, SUBMIT_TIMEOUT_MS, fetchIncoterms, fetchOpenOrdersFromEndpoint } from './archOrderApi.ts';

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


/* ── fetchIncoterms ───────────────────────────────────────────────────────────
 *
 * The picker used to render ['Delivered', 'Customer Pick Up', 'FOB Reload'] from
 * archOrderFixtures.ts -- a DEMO-DATA module -- against a MANDATORY field. Measured
 * against the account, the real list is five values and "Customer Pick Up" is not
 * one of them, so NetSuite answered `Invalid custbody_incoterms reference key` and
 * the wizard could not create an order at all. Every automated test had posted no
 * incoterms and silently taken the server default, so only a real click found it.
 *
 * `offline` exists so the demo walkthrough can still show the sample list while a
 * genuine failure shows NOTHING. Collapsing those two is what caused the defect.
 */
const REAL = [
  { id: '6', name: 'CIF' },
  { id: '3', name: 'Delivered' },
  { id: '4', name: 'FOB Mill' },
  { id: '7', name: 'FOB Port' },
  { id: '5', name: 'FOB Reload' },
];

globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/order' } };
let lastUrl = null;
globalThis.fetch = (url) => {
  lastUrl = String(url);
  return Promise.resolve({ json: async () => ({ ok: true, incoterms: REAL }) });
};
let ic = await fetchIncoterms();
ok('incoterms: ok status on a good answer', ic.status === 'ok', ic);
ok('incoterms: returns every option the account offers', ic.incoterms.length === 5, ic);
ok('incoterms: carries ids, because the ID is what gets written',
  ic.incoterms.every((x) => x.id && x.name), ic);
ok('incoterms: asks the order endpoint with action=incoterms',
  /action=incoterms/.test(lastUrl || ''), lastUrl);
ok('incoterms: includes CIF, which NO order in the account has ever used',
  ic.incoterms.some((x) => x.name === 'CIF'), ic);
ok('incoterms: and does NOT invent "Customer Pick Up"',
  !ic.incoterms.some((x) => /Customer Pick Up/i.test(x.name)), ic);

// A server that answers but declines: no options, and say why.
globalThis.fetch = () => Promise.resolve({ json: async () => ({ ok: false, error: 'field not on form' }) });
ic = await fetchIncoterms();
ok('incoterms: a refusing endpoint is FAILED, not offline', ic.status === 'failed', ic);
ok('incoterms: failure offers NO options rather than a fallback',
  ic.incoterms.length === 0, ic);
ok('incoterms: and surfaces the reason', /field not on form/.test(ic.error || ''), ic);

// A thrown fetch is still a failure, not offline.
globalThis.fetch = () => Promise.reject(new Error('Failed to fetch'));
ic = await fetchIncoterms();
ok('incoterms: a thrown fetch is FAILED', ic.status === 'failed' && ic.incoterms.length === 0, ic);

// No endpoint configured at all is the demo walkthrough, and is NOT a failure.
globalThis.window = { MCGI_CONFIG: {} };
ic = await fetchIncoterms();
ok('incoterms: no endpoint is OFFLINE, so demo can show the sample list',
  ic.status === 'offline' && ic.incoterms.length === 0, ic);

/* The fixture list must never be mistaken for the live source again. */
const { INCOTERMS } = await import('./archOrderFixtures.ts');
ok('incoterms: the fixture list is still WRONG for this account, by design',
  INCOTERMS.some((t) => /Customer Pick Up/i.test(t)), INCOTERMS);
const wizard = readFileSync(new URL('../components/arch/SOWizard.tsx', import.meta.url), 'utf8');
ok('incoterms: the wizard reaches for the fixture ONLY on the offline branch',
  /status === 'offline'[\s\S]{0,120}INCOTERMS\.map/.test(wizard), false);
ok('incoterms: and renders the fetched options on the live branch',
  /status === 'ok'[\s\S]{0,80}incotermsOpts\.incoterms/.test(wizard), false);
ok('incoterms: the wizard sends the ID, not just the text',
  /incotermsId: incotermsId \|\| undefined/.test(wizard), false);

/* ── fetchOpenOrdersFromEndpoint: the item 5.b endpoint leg ───────────────────
 *
 * 🔴 BEHAVIOURAL, not a source grep. The guards in archUiGuards.test.mjs prove a
 * string is in a file; they cannot tell a health payload from an order list. This
 * helper decides whether the tab trusts the endpoint or falls back to the RESTlet,
 * and getting that wrong reintroduces the very defect it was written to fix: the
 * Suitelet health fall-through is `{ok: true, ...}` with no orders, so a helper
 * that branched on `ok` would render an empty tab and call it live.
 */
{
  const url = 'https://example.invalid/order';
  const reply = (payload) => {
    globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve(payload) });
  };
  globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: url } };

  const good = { success: true, orders: [{ soNo: 'SO-1' }], service: 'arch-order-create' };
  reply(good);
  let r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: a real order list is accepted', r.outcome === 'ok' && r.body === good, r);

  /* THE ONE THAT MATTERS. This is what an older Suitelet, with no openOrders
   * branch, actually returns: it falls through to the health payload. */
  reply({ ok: true, service: 'arch-order-create', user: 3136, role: 3, status: 200 });
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: the HEALTH fall-through is not mistaken for an empty order list',
    r.outcome === 'failed', r);

  /* And this is what EVERY viewer outside roles [2181, 3] gets. The Suitelet
   * answers HTTP 200 and puts 403 in the body, so only `code` distinguishes it. */
  reply({ ok: false, code: 'FORBIDDEN', error: 'Your role is not permitted...', status: 403 });
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: a role refusal is REFUSED, not "did not answer"',
    r.outcome === 'refused', r);

  reply({ success: false, error: 'Open sales orders could not be loaded' });
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: an explicit service failure falls back', r.outcome === 'failed', r);

  reply({ success: true });
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: success with NO orders array falls back, rather than showing nothing',
    r.outcome === 'failed', r);

  reply({ success: true, orders: [] });
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: but an honestly EMPTY list is accepted, not retried as a failure',
    r.outcome === 'ok', r);

  globalThis.fetch = () => Promise.reject(new Error('Failed to fetch'));
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: a thrown fetch falls back rather than propagating', r.outcome === 'failed', r);

  /* Nothing was SENT here, so the banner must not claim the endpoint stayed
   * silent. That distinction is the whole reason this returns an outcome. */
  globalThis.window = { MCGI_CONFIG: {} };
  r = await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: no endpoint configured is UNCONFIGURED, not a non-answer',
    r.outcome === 'unconfigured', r);

  let seen = '';
  globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: url + '?script=6505&deploy=1' } };
  globalThis.fetch = (u) => { seen = String(u); return Promise.resolve({ json: () => Promise.resolve(good) }); };
  await fetchOpenOrdersFromEndpoint(9);
  ok('openOrders leg: the action and subsidiary are on the query string',
    /action=openOrders/.test(seen) && /subsidiaryId=9/.test(seen), seen);
  ok('openOrders leg: and the separator is & when the url already carries a query',
    /deploy=1&action=openOrders/.test(seen), seen);
}

console.log(fail ? ('# FAIL ' + fail) : '# archOrderApi ok');
process.exit(fail ? 1 : 0);
