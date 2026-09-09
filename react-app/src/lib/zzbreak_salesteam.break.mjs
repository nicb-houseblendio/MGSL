// DEFECT PROBES against the SHIPPED archSalesTeam.js + trader_screen_service_arch.js.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen');
const TEAM = join(ROOT, 'shared', 'archSalesTeam.js');
const SERVICE = join(ROOT, 'service', 'trader_screen_service_arch.js');

const say = (n, cond, got) => console.log((cond ? 'ok   ' : 'BROKEN ') + n + (cond ? '' : '   -> ' + JSON.stringify(got)));

const queries = [];
let responder = () => [];
const query = { runSuiteQL: ({ query: sql }) => { queries.push(sql); const r = responder(sql); return { asMappedResults: () => r }; } };
const log = { audit: () => {}, error: () => {}, debug: () => {} };
const load = (file, resolve) => { let x = null; new Function('define', fs.readFileSync(file, 'utf8'))((d, f) => { x = f(...d.map(resolve)); }); return x; };
const team = load(TEAM, (d) => ({ 'N/query': query, 'N/log': log })[d]);
const { pickRep, repByTransaction } = team;

console.log('== D1  one failing CHUNK discards every chunk that already succeeded ==');
queries.length = 0;
let chunkNo = 0;
responder = () => {
  chunkNo++;
  if (chunkNo === 2) { const e = new Error('SSS_REQUEST_TIME_EXCEEDED'); e.name = 'SuiteScriptError'; throw e; }
  return [{ tranid: '1000', repid: '2090', rep: 'Justin Loveland', contribution: '1', isprimary: 'F' }];
};
const ids = Array.from({ length: 600 }, (_, i) => String(1000 + i));   // 2 chunks: 500 + 100
let threw = null, out = null;
try { out = repByTransaction(ids); } catch (e) { threw = e; }
say('repByTransaction survives a mid-run chunk failure and keeps chunk 1', !threw, threw && threw.message);
say('  (the 500 reps resolved by chunk 1 are still returned)', out && Object.keys(out).length > 0, out && Object.keys(out || {}).length);

console.log('');
console.log('== D2  TWO primaries sharing evenly are not reported as tied ==');
let p = pickRep([
  { repid: '2094', rep: 'Samuel Nadon',   contribution: '0.5', isprimary: 'T' },
  { repid: '2090', rep: 'Justin Loveland', contribution: '0.5', isprimary: 'T' },
]);
say('two primaries at 50/50 -> tied === true (the service publishes this as traderTied)', p.tied === true, p);

console.log('');
console.log('== D3  pickRep is order-dependent when repid is not parseable ==');
const a = { repid: 'abc', rep: 'A', contribution: '0.5', isprimary: 'F' };
const b = { repid: '2090', rep: 'B', contribution: '0.5', isprimary: 'F' };
const f = pickRep([a, b]).rep, g = pickRep([b, a]).rep;
say('same two members in either order pick the same rep', f === g, { forward: f, reversed: g });

console.log('');
console.log('== D4  duplicate sublist rows for ONE employee read as a shared/tied order ==');
p = pickRep([
  { repid: '2084', rep: 'Christian Labbe', contribution: '0.5', isprimary: 'F' },
  { repid: '2084', rep: 'Christian Labbe', contribution: '0.5', isprimary: 'F' },
]);
say('one employee on two rows is not "shared between reps"', p.shared === false && p.tied === false, p);

console.log('');
console.log('== D5  a transaction id past 2^53 is silently rewritten in the IN list ==');
queries.length = 0; responder = () => [];
repByTransaction(['9007199254740993']);
const inList = (queries[0].match(/IN \(([^)]*)\)/) || [])[1];
say('the id in the SQL is the id that was asked for', inList === '9007199254740993', inList);

console.log('');
console.log('== D6  a rep the role cannot NAME: repId set, BUILTIN.DF null (omitted by SuiteQL) ==');
const line = (tranid, sono) => ({
  tranid, sono, trandate: '9/1/2026', status: 'SalesOrd:B', customerid: '500', customer: 'Acme',
  createdbyid: '3154', createdby: 'Lucas Gibb', currencycode: 'CAD', customerpo: 'PO-1',
  incoterms: 'Delivered', shipdate: '9/15/2026', shipto: 'Acme', exchangerate: '1',
  lineid: '1', itemid: '9001', itemcode: 'ARCH-HARMAP-44', description: 'Hard Maple', thickness: '4/4',
  unitname: 'BF', convrate: '0.001', locationid: '7', locationname: 'CWP Prevost',
  lineqty: '1.145', linerate: '5000', foreignamount: '5725', shiprecv: '0',
});
const OPEN_ROWS = [line('126664', 'SO-CWP-001352')];
//  BUILTIN.DF(st.employee) came back null -> SuiteQL OMITS the column entirely
const TEAM_ROWS = [{ tranid: '126664', repid: '2094', contribution: '1', isprimary: 'F' }];
const q2 = { runSuiteQL: ({ query: sql }) => ({ asMappedResults: () =>
  /FROM transactionsalesteam/.test(sql) ? TEAM_ROWS
  : (/FROM transactionline tl/.test(sql) && /otherrefnum/.test(sql)) ? OPEN_ROWS
  : /COUNT\(\*\) AS n FROM item/.test(sql) ? [{ n: '6' }] : [] }) };
const team2 = load(TEAM, (d) => ({ 'N/query': q2, 'N/log': log })[d]);
const svc = load(SERVICE, (d) => ({
  'N/runtime': { getCurrentScript: () => ({ getParameter: () => null }), getCurrentUser: () => ({ id: 1, role: 3 }) },
  'N/log': log, 'N/query': q2,
  '../shared/cacheKeys_arch': new Proxy({}, { get: (_t, k) => 'ARCH_' + String(k) }),
  '../shared/cacheClient': { getCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
  '../shared/archSalesTeam': team2,
})[d]);
const o = svc.getRouter({ action: 'openOrders' }).orders[0];
say('trader and traderId agree about whether a rep is known',
  !(o.trader === 'Unassigned' && o.traderId !== null),
  { trader: o.trader, traderId: o.traderId, traderShared: o.traderShared });
