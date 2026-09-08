// trader_screen_service_arch.js handleGetOpenOrders, loaded through an AMD shim
// with every dependency faked. What this pins:
//   A. the trader comes from the Sales Team sublist, not the (null) header rep
//   B. traderId is set from it, so the wizard's rep dropdown pre-selects on Edit
//   C. createdBy is returned alongside, and is NOT what trader shows
//   D. no fan-out: a two-rep order keeps its line count, and the line query
//      never mentions the sublist table
//   E. fallbacks: header rep when the sublist is empty, "Unassigned" when both are
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen');
const SERVICE = join(ROOT, 'service', 'trader_screen_service_arch.js');
const TEAM = join(ROOT, 'shared', 'archSalesTeam.js');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// ── canned data ────────────────────────────────────────────────────────────────
const line = (tranid, sono, lineid, extra) => Object.assign({
  tranid, sono, trandate: '9/1/2026', status: 'SalesOrd:B',
  customerid: '500', customer: 'Acme Millwork',
  repid: null, rep: null,
  createdbyid: '3154', createdby: 'Lucas Gibb',
  currencycode: 'CAD', customerpo: 'PO-' + sono, incoterms: 'Delivered', shipdate: '9/15/2026',
  shipto: 'Acme Millwork\n123 Rue Principale', exchangerate: '1',
  lineid, itemid: '9001', itemcode: 'ARCH-HARMAP-44', description: 'Hard Maple 4/4 KD', thickness: '4/4',
  unitname: 'BF', convrate: '0.001', locationid: '7', locationname: 'CWP Prevost',
  lineqty: '1.145', linerate: '5000', foreignamount: '5725', shiprecv: '0',
  lotid: null, lotno: null, assignedqty: null,
}, extra || {});

const OPEN_ROWS = [
  // A: two lines, two reps at 50/50 on the sublist, header rep null, saved by a developer
  line('126664', 'SO-CWP-001352', '1'),
  line('126664', 'SO-CWP-001352', '2'),
  // B: one line, one rep at 100%
  line('126868', 'SO-CWP-001354', '3', { createdbyid: '678', createdby: 'Marc-Antoine Poirier' }),
  // C: no sublist rows, header rep set (an account without Team Selling)
  line('126999', 'SO-CWP-001399', '4', { repid: '55', rep: 'Header Rep' }),
  // D: neither
  line('127000', 'SO-CWP-001400', '5'),
];
const TEAM_ROWS = [
  { tranid: '126664', repid: '2094', rep: 'Samuel Nadon', contribution: '0.5', isprimary: 'F' },
  { tranid: '126664', repid: '2090', rep: 'Justin Loveland', contribution: '0.5', isprimary: 'F' },
  { tranid: '126868', repid: '2084', rep: 'Christian Labbé', contribution: '1', isprimary: 'F' },
];

// ── fakes ──────────────────────────────────────────────────────────────────────
const sqlLog = [];
const query = {
  runSuiteQL: ({ query: sql }) => {
    sqlLog.push(sql);
    let rows;
    if (/FROM transactionsalesteam/.test(sql)) rows = TEAM_ROWS;
    else if (/FROM transactionline tl/.test(sql) && /otherrefnum/.test(sql)) rows = OPEN_ROWS;
    else if (/COUNT\(\*\) AS n FROM item/.test(sql)) rows = [{ n: '6' }];
    else rows = [];
    return { asMappedResults: () => rows };
  },
};
const log = { audit: () => {}, error: (t, m) => { throw new Error('log.error called: ' + t + ' ' + m); }, debug: () => {} };
const runtime = {
  getCurrentScript: () => ({ getParameter: () => null }),
  getCurrentUser: () => ({ id: 1, role: 3 }),
};
const CacheKeysARCH = new Proxy({}, { get: (_t, k) => 'ARCH_' + String(k) });
const CacheClient = { getCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };

// ── load the two modules through one shim ─────────────────────────────────────
const load = (file, resolve) => {
  let exported = null;
  const define = (deps, factory) => { exported = factory(...deps.map(resolve)); };
  new Function('define', fs.readFileSync(file, 'utf8'))(define);
  return exported;
};
const team = load(TEAM, (d) => ({ 'N/query': query, 'N/log': log })[d]);
ok('archSalesTeam loaded', !!team && typeof team.repByTransaction === 'function');

const service = load(SERVICE, (d) => {
  const table = {
    'N/runtime': runtime, 'N/log': log, 'N/query': query,
    '../shared/cacheKeys_arch': CacheKeysARCH,
    '../shared/cacheClient': CacheClient,
    '../shared/archSalesTeam': team,
  };
  if (!(d in table)) throw new Error('service asked for an unfaked dependency: ' + d);
  return table[d];
});
ok('service loaded with getRouter', !!service && typeof service.getRouter === 'function');

// ── run ────────────────────────────────────────────────────────────────────────
sqlLog.length = 0;
const res = service.getRouter({ action: 'openOrders' });
ok('openOrders succeeds', res && res.success === true, res && res.error);
const orders = (res && res.orders) || [];
const by = Object.fromEntries(orders.map((o) => [o.soNo, o]));
ok('four orders come back', orders.length === 4, orders.map((o) => o.soNo));

// A + B: sublist wins, header null
ok('A: SO-CWP-001352 trader is the sublist rep, not Unassigned', by['SO-CWP-001352'] && by['SO-CWP-001352'].trader === 'Justin Loveland', by['SO-CWP-001352'] && by['SO-CWP-001352'].trader);
ok('A: 50/50 is flagged shared and tied', by['SO-CWP-001352'].traderShared === true && by['SO-CWP-001352'].traderTied === true, by['SO-CWP-001352']);
ok('B: SO-CWP-001354 trader is Christian Labbé', by['SO-CWP-001354'].trader === 'Christian Labbé' && by['SO-CWP-001354'].traderShared === false, by['SO-CWP-001354']);
ok('B: traderId is the sublist employee id (what the wizard pre-selects on)', by['SO-CWP-001354'].traderId === '2084', by['SO-CWP-001354'].traderId);

// C: creator returned, not shown
ok('C: createdBy is returned', by['SO-CWP-001352'].createdBy === 'Lucas Gibb' && by['SO-CWP-001352'].createdById === '3154', by['SO-CWP-001352']);
ok('C: createdBy is NOT what trader shows', by['SO-CWP-001352'].trader !== by['SO-CWP-001352'].createdBy);
ok('C: Marc-Antoine created 001354 but Christian Labbé is its trader', by['SO-CWP-001354'].createdBy === 'Marc-Antoine Poirier' && by['SO-CWP-001354'].trader === 'Christian Labbé');

// D: no fan-out
ok('D: the two-rep order keeps exactly its two lines', by['SO-CWP-001352'].lines.length === 2, by['SO-CWP-001352'].lines.map((l) => l.key));
const lineSql = sqlLog.find((s) => /FROM transactionline tl/.test(s) && /otherrefnum/.test(s)) || '';
ok('D: the line query never mentions the sublist table (a JOIN would double the lines)', lineSql && !/transactionsalesteam/i.test(lineSql));
ok('D: the sublist is read by its own query, once', sqlLog.filter((s) => /FROM transactionsalesteam/.test(s)).length === 1, sqlLog.length);
const teamSql = sqlLog.find((s) => /FROM transactionsalesteam/.test(s)) || '';
ok('D: that query asks for exactly the four transaction ids', /IN \(/.test(teamSql) && ['126664', '126868', '126999', '127000'].every((id) => teamSql.includes(id)), teamSql);

// E: fallbacks
ok('E: no sublist rows -> header rep', by['SO-CWP-001399'].trader === 'Header Rep' && by['SO-CWP-001399'].traderId === '55', by['SO-CWP-001399']);
ok('E: neither -> Unassigned with null id', by['SO-CWP-001400'].trader === 'Unassigned' && by['SO-CWP-001400'].traderId === null, by['SO-CWP-001400']);

// the sublist query failing must not take the tab down
const brokenTeam = { repByTransaction: () => { throw new Error('SSS_MISSING_REQD_ARGUMENT'); } };
const service2 = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': { ...log, audit: () => {} }, 'N/query': query,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': brokenTeam,
})[d]);
const res2 = service2.getRouter({ action: 'openOrders' });
ok('a failing sublist read degrades to the header rep instead of failing the tab', res2.success === true && res2.orders.length === 4 && res2.orders.every((o) => o.trader === 'Unassigned' || o.trader === 'Header Rep'), res2.orders && res2.orders.map((o) => o.trader));

console.log(fail ? ('# FAIL ' + fail) : '# archOpenOrders ok');
process.exit(fail ? 1 : 0);
