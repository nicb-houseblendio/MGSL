// DEFECT PROBES against the shipped archOrderApi.ts.
import { orderOutcome, createArchOrder, SUBMIT_TIMEOUT_MS } from './archOrderApi.ts';
const say = (n, cond, got) => console.log((cond ? 'ok   ' : 'BROKEN ') + n + (cond ? '' : '   -> ' + JSON.stringify(got)));

globalThis.window = { MCGI_CONFIG: { orderEndpointUrl: 'https://example.invalid/order' } };
const draft = {
  mode: 'new', existingSO: null,
  header: { customerId: '1', customerPO: 'PO-1', shipTo: '', currency: 'CAD', shipDate: '2026-09-10', incoterms: 'Delivered', salesTeam: '', paymentTerms: '' },
  lines: [],
};

console.log('== D7  createArchOrder REJECTS (does not resolve) when AbortController is absent ==');
const savedAC = globalThis.AbortController;
delete globalThis.AbortController;
globalThis.fetch = () => Promise.resolve({ json: async () => ({ ok: true, tranId: 'SO-1', salesOrderId: 1 }) });
let res = null, err = null;
try { res = await createArchOrder(draft, 'ARCH-key-nc'); } catch (e) { err = e; }
globalThis.AbortController = savedAC;
say('a browser without AbortController still gets a RESULT, not a rejection', !err && res, err && (err.name + ': ' + err.message));

console.log('');
console.log('== D8  the server\'s own code field is dropped, so a post-save FAILURE reads as a refusal ==');
// This is exactly what mcgi_sl_arch_order_create.js sends when createOrder throws
// AFTER so.save() has already committed the order (e.g. assignLots -> record.load
// or its second so.save() blows a governance/lock error): 500, code FAILED.
globalThis.fetch = () => Promise.resolve({ json: async () => ({
  ok: false, code: 'FAILED', error: 'SSS_USAGE_LIMIT_EXCEEDED: Script Execution Usage Limit Exceeded',
}) });
const failed = await createArchOrder(draft, 'ARCH-key-f');
say('the server code survives the client', failed.code === 'FAILED', failed);
const oc = orderOutcome(failed, false);
say('an unexpected server FAILURE is not asserted as "nothing was written"',
  !/nothing was written/i.test(oc.title + ' ' + oc.cartReason), { kind: oc.kind, title: oc.title, cartReason: oc.cartReason });

console.log('');
console.log('== D9  the same for an explicit REFUSED, which IS safe to claim ==');
globalThis.fetch = () => Promise.resolve({ json: async () => ({ ok: false, code: 'REFUSED', error: 'Bundle already sold.' }) });
const refused = await createArchOrder(draft, 'ARCH-key-r');
console.log('   refused ->', JSON.stringify(orderOutcome(refused, false)));

console.log('');
console.log('== D10  the 90s timer can fire between fetch() and r.json() on an order that WAS created ==');
globalThis.fetch = (_u, init) => Promise.resolve({
  json: () => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  }),
});
const t0 = Date.now();
const late = await createArchOrder(draft, 'ARCH-key-late', { timeoutMs: 50 });
say('a body that arrives but streams past the deadline is not reported as "did not answer"',
  !/did not answer/.test(late.error || ''), { ms: Date.now() - t0, error: late.error });

console.log('');
console.log('== D11  SUBMIT_TIMEOUT_MS ==');
console.log('   SUBMIT_TIMEOUT_MS = ' + SUBMIT_TIMEOUT_MS + ' ms');
