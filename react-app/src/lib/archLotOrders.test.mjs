/**
 * The Reserved panel's SO columns, end to end.
 *
 * Until 2026-09-08 SO #, SO Creation Date, Reserved For, Ship Week, Customer and
 * Trader all came from `lotAllocation()` in lib/archFixtures.ts, a seeded
 * generator, on LIVE payloads as well as demo ones. What this file pins:
 *
 *   A. the cache MR carries the real order per bundle — document number,
 *      customer, both dates and the Sales Team rep — out of the SAME
 *      `inventoryassignment` join it already used for the quantity, with no
 *      second query and no change to the bucket arithmetic
 *   B. only the OPEN share reaches a bundle, so a shipped-and-billed line names
 *      no order (the phantom SO-CWP-001346 defect, one field along)
 *   C. a bundle held by SEVERAL orders keeps every one of them: 31 lots in this
 *      sandbox are held by two or more open orders right now, one by 17
 *   D. `orders` present vs absent is what tells real data from a fixture, and
 *      `[]` is a THIRD state that must render em dashes, never a generated value
 *   E. the panel's rows still sum to its own footer
 *   F. the placeholder banner is now conditional, and the generator is only ever
 *      reached where nothing can source the columns
 *
 * ── Proving a failure BEFORE the change ────────────────────────────────────
 * Set ARCH_PRE_DIR to a directory holding the pre-change
 * `mcgi_mr_trader_screen_cache_arch.js`, `ArchReservedSection.tsx` and
 * `ArchLotTable.tsx`, and sections B..F read from there instead of the repo.
 * That is how the failing-before output in the commit message was produced.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  orderSource,
  ordersFor,
  ageDays,
  formatOrderDate,
  traderName,
  reservedRows,
  joinValues,
  oldestAge,
  anyUnsourced,
  anyUnavailable,
  NO_VALUE,
} from './archLotOrders.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..');
const PRE = process.env.ARCH_PRE_DIR || '';
const MR = PRE
  ? join(PRE, 'mcgi_mr_trader_screen_cache_arch.js')
  : join(REPO, 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen',
      'entry_points', 'mr', 'mcgi_mr_trader_screen_cache_arch.js');
const SHARED = join(REPO, 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen', 'shared');
const component = (name) =>
  fs.readFileSync(PRE ? join(PRE, name) : join(here, '..', 'components', 'arch', name), 'utf8');

let fail = 0;
const ok = (name, cond, got) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

/* ════ A. the pure resolver ════════════════════════════════════════════════ */

const lot = (over) => Object.assign({
  lotNo: '316027-12', lotId: '49847', po: '316027', containerNo: '',
  onHand: 1080, reserve: 1080, readyToBuild: 0, outbound: 0, onOrder: 0, inTransit: 0,
}, over || {});

const order = (over) => Object.assign({
  tranId: '126449', soNumber: 'SO-CWP-001344', customerId: '2853',
  customer: 'County Line Materials LLC', created: '2026-08-20', shipDate: '2026-08-20',
  repId: '2085', rep: 'Camil Perrault', repSource: 'salesTeam',
  repShared: false, repTied: false, repNameUnreadable: false, qty: 1080,
}, over || {});

const TODAY = new Date(2026, 8, 8);   // 2026-09-08, local

{
  ok('A1 no `orders` key at all is UNSOURCED — a fixture, or a cache written before the field',
    orderSource(lot(), 'reserve') === 'unsourced');
  ok('A2 an EMPTY array is a third state, not the same as absent',
    orderSource(lot({ orders: [] }), 'reserve') === 'unavailable');
  ok('A3 a populated array on the reserve bucket is real data',
    orderSource(lot({ orders: [order()] }), 'reserve') === 'netsuite');
  // readyToBuild is a literal 0 in the cache and outbound is attributed to no
  // bundle, so neither may borrow the reserve's orders.
  ok('A4 readyToBuild never borrows the reserve orders',
    orderSource(lot({ orders: [order()] }), 'readyToBuild') === 'unavailable');
  ok('A5 outbound never borrows the reserve orders',
    orderSource(lot({ orders: [order()] }), 'outbound') === 'unavailable');
  ok('A6 ordersFor returns nothing unless the source is real',
    ordersFor(lot({ orders: [order()] }), 'outbound').length === 0 &&
    ordersFor(lot({ orders: [order()] }), 'reserve').length === 1);

  ok('A7 age is measured from trandate, in whole local days',
    ageDays('2026-08-20', TODAY) === 19, ageDays('2026-08-20', TODAY));
  // new Date('2026-09-08') alone is UTC midnight, i.e. the 7th in Montreal, so a
  // naive parse reports an order written TODAY as one day old.
  ok('A8 an order written today is 0 days old, not 1 (local midnight, not UTC)',
    ageDays('2026-09-08', TODAY) === 0, ageDays('2026-09-08', TODAY));
  ok('A9 no date gives null, never 0 — "unknown" and "today" are different answers',
    ageDays('', TODAY) === null && ageDays(undefined, TODAY) === null && ageDays('nonsense', TODAY) === null);
  ok('A10 a future trandate floors at 0 rather than printing "-3 d"',
    ageDays('2026-09-11', TODAY) === 0);
  ok('A11 a missing date formats as an em dash, not as an epoch',
    formatOrderDate('') === NO_VALUE && formatOrderDate(null) === NO_VALUE && formatOrderDate('x') === NO_VALUE);
  ok('A12 an ISO date formats to the calendar day it names',
    /Aug\s*20,?\s*2026/.test(formatOrderDate('2026-08-20')), formatOrderDate('2026-08-20'));

  ok('A13 a nameless rep is an em dash, never "Unassigned"',
    traderName(order({ rep: '' })) === NO_VALUE && traderName(order()) === 'Camil Perrault');
}

/* ── C/E. multi-order expansion, and the footer reconciliation ──────────── */
{
  const two = lot({
    reserve: 1081,
    orders: [
      order({ tranId: '126449', soNumber: 'SO-CWP-001344', qty: 540.5 }),
      order({ tranId: '126500', soNumber: 'SO-CWP-001360', customer: '40 West Corporation',
              rep: 'Nicolas Harvey', created: '2026-09-01', qty: 540.5 }),
    ],
  });
  const rows = reservedRows([two], TODAY);
  ok('C1 a bundle held by two orders becomes TWO rows, neither dropped',
    rows.length === 2 && rows[0].order.soNumber === 'SO-CWP-001344' && rows[1].order.soNumber === 'SO-CWP-001360');
  ok('C2 each row carries its OWN customer and trader',
    rows[0].order.customer === 'County Line Materials LLC' && rows[1].order.rep === 'Nicolas Harvey');
  ok('C3 continuation rows are marked, so two claims read as one bundle',
    rows[0].index === 0 && rows[1].index === 1 && rows[1].count === 2);
  // 540.5 rounds to 541 twice = 1,082 against a bundle rounding to 1,081.
  // Largest remainder reconciles it, so the visible rows equal the strip's figure.
  ok('E1 the rows sum EXACTLY to the footer total, which is summed from bundles',
    rows.reduce((s, r) => s + r.qty, 0) === Math.round(two.reserve),
    { rows: rows.map((r) => r.qty), footer: Math.round(two.reserve) });
  ok('E2 each row still shows its own share, not the bundle total',
    rows[0].qty === 541 && rows[1].qty === 540, rows.map((r) => r.qty));
  ok('C4 the age shown per row is that order\'s own age',
    rows[0].age === 19 && rows[1].age === 7, rows.map((r) => r.age));
  ok('C5 the oldest claim is what a one-row-per-bundle table reports',
    oldestAge(two.orders, TODAY) === 19);

  const single = reservedRows([lot({ orders: [order()] })], TODAY);
  ok('E3 one order still reconciles', single.length === 1 && single[0].qty === 1080);

  /* ⚠️ The pathological case that broke the naive "last row absorbs it" version.
     Five claims of 0.5 against a bundle rounding to 3: rounding the first four
     to 1 each leaves the last at -1, and "-1 BF reserved" is a printed lie. */
  const five = reservedRows([lot({
    reserve: 2.5,
    orders: [0, 1, 2, 3, 4].map((n) => order({ tranId: 'T' + n, soNumber: 'SO-' + n, qty: 0.5 })),
  })], TODAY);
  ok('E4 no share is ever negative, however the fractions fall',
    five.every((r) => r.qty >= 0), five.map((r) => r.qty));
  ok('E5 and they still sum to the footer figure exactly',
    five.reduce((s, r) => s + r.qty, 0) === 3, five.map((r) => r.qty));
  ok('E6 the allocation is deterministic — equal fractions break to the older order',
    JSON.stringify(five.map((r) => r.qty)) ===
      JSON.stringify(reservedRows([lot({
        reserve: 2.5,
        orders: [0, 1, 2, 3, 4].map((n) => order({ tranId: 'T' + n, soNumber: 'SO-' + n, qty: 0.5 })),
      })], TODAY).map((r) => r.qty)),
    five.map((r) => r.qty));

  /* Orders that claim nothing against a bundle that reserves something is
     contradictory data. It must not vanish from the panel. */
  const zeroClaims = reservedRows([lot({ reserve: 400, orders: [order({ qty: 0 }), order({ tranId: '2', soNumber: 'SO-2', qty: 0 })] })], TODAY);
  ok('E7 contradictory data is shown on the oldest claim, never dropped',
    zeroClaims.reduce((s, r) => s + r.qty, 0) === 400 && zeroClaims[0].qty === 400,
    zeroClaims.map((r) => r.qty));

  // 'unavailable': a live payload listing a bundle it cannot attribute.
  const blank = reservedRows([lot({ orders: [] })], TODAY);
  ok('D1 an unattributable live bundle still shows its QUANTITY, with no order',
    blank.length === 1 && blank[0].order === null && blank[0].qty === 1080 && blank[0].source === 'unavailable');
  ok('D2 and no age is invented for it', blank[0].age === null);
}

{
  ok('C6 one distinct value renders alone', joinValues(['SO-1']).text === 'SO-1');
  ok('C7 several values disclose the count and name them all',
    joinValues(['SO-1', 'SO-2', 'SO-3']).text === 'SO-1 +2' &&
    joinValues(['SO-1', 'SO-2', 'SO-3']).title === 'SO-1, SO-2, SO-3');
  ok('C8 duplicates collapse — two lines of one order are one claim',
    joinValues(['SO-1', 'SO-1']).text === 'SO-1');
  ok('C9 nothing at all is an em dash', joinValues([]).text === NO_VALUE && joinValues(['', ' ']).text === NO_VALUE);

  ok('D3 the banner is driven by ANY unsourced bundle, not all of them',
    anyUnsourced([lot({ orders: [order()] }), lot()]) === true &&
    anyUnsourced([lot({ orders: [order()] })]) === false);
  ok('D4 the "no order named" note only fires on a live bundle with a real quantity',
    anyUnavailable([lot({ orders: [] })]) === true &&
    anyUnavailable([lot({ orders: [], reserve: 0 })]) === false &&
    anyUnavailable([lot()]) === false);
}

/* ════ B. the cache MR, through an AMD define shim ═════════════════════════
 *
 * Node cannot load a SuiteScript module directly, so the file is evaluated with
 * a four-line `define` and every dependency faked. `cacheKeys_arch.js` is loaded
 * for real (it is `define([], ...)`, no dependencies) so the cache keys under
 * test are the real ones.
 */

const load = (file, resolve) => {
  let exported = null;
  const define = (deps, factory) => { exported = factory(...deps.map(resolve)); };
  new Function('define', fs.readFileSync(file, 'utf8'))(define);
  return exported;
};

const CacheKeysARCH = load(join(SHARED, 'cacheKeys_arch.js'), () => { throw new Error('no deps'); });
const ArchSalesTeamReal = (q, l) =>
  load(join(SHARED, 'archSalesTeam.js'), (id) => (id === 'N/query' ? q : l));

/* One hardwood item at one location with three bundles, mirroring the live
 * ZEB84KD @ Ramsey Xpress row (item 2915, location 136, two bundles of 1,080 BF
 * reserved by SO-CWP-001344). Stored in MBF, rate 0.001, exactly like Lumber. */
const LOT_ROWS = [
  { itemid: '2915', itemcode: 'ZEB84KD', description: 'Zebrawood 8/4 KD', species: 'Zebrawood',
    category: 'Lumber', thickness: '8/4', unitname: 'BF', rate: '0.001',
    locationid: '136', locationname: 'Ramsey Xpress', lotid: '49847', lotno: '316027-12', storedqty: '1.08' },
  { itemid: '2915', itemcode: 'ZEB84KD', description: 'Zebrawood 8/4 KD', species: 'Zebrawood',
    category: 'Lumber', thickness: '8/4', unitname: 'BF', rate: '0.001',
    locationid: '136', locationname: 'Ramsey Xpress', lotid: '49840', lotno: '316027-2', storedqty: '1.08' },
  // A bundle nobody has sold, so it must carry `orders: []` and NOT a fixture.
  { itemid: '2915', itemcode: 'ZEB84KD', description: 'Zebrawood 8/4 KD', species: 'Zebrawood',
    category: 'Lumber', thickness: '8/4', unitname: 'BF', rate: '0.001',
    locationid: '136', locationname: 'Ramsey Xpress', lotid: '49850', lotno: '316027-20', storedqty: '2' },
];

const bkRow = (over) => Object.assign({
  itemid: '2915', locationid: '136', trantype: 'SalesOrd', tranid: '126449',
  docno: 'SO-CWP-001344', trandate: '8/20/2026', shipdate: '8/20/2026',
  custid: '2853', customer: 'County Line Materials LLC',
  hdrrepid: null, hdrrep: null,
  lineno: '1', qty: '-1.08', shiprecv: '0', billed: '0',
  lotno: '316027-12', assignedqty: '-1.08',
}, over || {});

const BUCKET_ROWS = [
  // SO-CWP-001344, two lines, one bundle each. The real open ARCH order.
  bkRow({}),
  bkRow({ lineno: '6', lotno: '316027-2' }),
  // A SECOND order on bundle 316027-12: 31 lots in this sandbox are double-held.
  bkRow({ tranid: '126500', docno: 'SO-CWP-001360', trandate: '9/1/2026', shipdate: '9/22/2026',
          custid: '3285', customer: '40 West Corporation', lineno: '9',
          qty: '-0.54', assignedqty: '-0.54' }),
  // Two LINES of that same second order naming the same bundle: one row, summed.
  bkRow({ tranid: '126500', docno: 'SO-CWP-001360', trandate: '9/1/2026', shipdate: '9/22/2026',
          custid: '3285', customer: '40 West Corporation', lineno: '10',
          qty: '-0.1', assignedqty: '-0.1' }),
  // FULLY SHIPPED AND BILLED, on bundle 316027-20. openShare is 0, so this order
  // must reach neither the quantity nor the attribution. This is the phantom
  // reservation (SO-CWP-001346 / lot 315643-7) one field along.
  bkRow({ tranid: '126654', docno: 'SO-CWP-001346', lineno: '1', lotno: '316027-20',
          qty: '-0.3', shiprecv: '-0.3', billed: '-0.3', assignedqty: '-0.3' }),
];

const TEAM_ROWS = [
  { tranid: '126449', repid: '2085', rep: 'Camil Perrault', contribution: '1', isprimary: 'F' },
  // A 50/50, which the panel must flag rather than resolve away silently.
  { tranid: '126500', repid: '2094', rep: 'Samuel Nadon', contribution: '0.5', isprimary: 'F' },
  { tranid: '126500', repid: '2090', rep: 'Justin Loveland', contribution: '0.5', isprimary: 'F' },
];

const runMr = ({ teamRows = TEAM_ROWS, teamThrows = false } = {}) => {
  const sqlLog = [];
  const errors = [];
  const audits = [];
  const logFake = {
    audit: (t, m) => audits.push(t + ' :: ' + m),
    error: (t, m) => errors.push(t + ' :: ' + m),
    debug: () => {},
  };
  const queryFake = {
    runSuiteQL: ({ query: sql }) => {
      sqlLog.push(sql);
      let rows = [];
      if (/FROM transactionsalesteam/.test(sql)) {
        if (teamThrows) throw new Error('Search error occurred: permission');
        rows = teamRows;
      } else if (/FROM inventorynumberlocation/.test(sql)) rows = LOT_ROWS;
      else if (/FROM transactionline tl/.test(sql)) rows = BUCKET_ROWS;
      else if (/FROM item i/.test(sql)) rows = [];                      // untagged check
      else if (/customrecord_msl_plc_capture/i.test(sql)) rows = [];     // tallies
      return { asMappedResults: () => rows };
    },
  };
  const searchFake = {
    create: () => ({ run: () => ({ each: () => {} }) }),
    createColumn: (o) => o,
    createFilter: (o) => o,
  };
  const runtimeFake = { getCurrentScript: () => ({ getParameter: () => null }) };
  const taskFake = { create: () => ({ submit: () => 'x' }), TaskType: { MAP_REDUCE: 'MAP_REDUCE' } };
  const cacheStore = {};
  const CacheClientFake = {
    getCache: () => ({
      get: ({ key }) => (Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null),
      put: ({ key, value }) => { cacheStore[key] = value; },
      remove: ({ key }) => { delete cacheStore[key]; },
    }),
  };
  const LotCostFake = { getLotCostsAtLocation: () => ({}) };
  const team = ArchSalesTeamReal(queryFake, logFake);

  const mod = load(MR, (id) => {
    if (id === 'N/query') return queryFake;
    if (id === 'N/search') return searchFake;
    if (id === 'N/log') return logFake;
    if (id === 'N/runtime') return runtimeFake;
    if (id === 'N/task') return taskFake;
    if (/cacheKeys_arch$/.test(id)) return CacheKeysARCH;
    if (/cacheClient$/.test(id)) return CacheClientFake;
    if (/MCGI_LIB_LotCost$/.test(id)) return LotCostFake;
    if (/archSalesTeam$/.test(id)) return team;
    throw new Error('unmocked module: ' + id);
  });

  const input = mod.getInputData();
  const written = [];
  Object.keys(input).forEach((k) => {
    mod.reduce({ key: k, values: [input[k]], write: (o) => written.push(JSON.parse(o.value)) });
  });
  return { input, written, sqlLog, errors, audits };
};

{
  const { written, sqlLog, errors, audits } = runMr();
  const row = written[0];
  ok('B0 the builder produced the row', !!row && row.itemCode === 'ZEB84KD', row && row.itemCode);

  const byLot = {};
  (row ? row.lots : []).forEach((l) => { byLot[l.lotNo] = l; });

  ok('B1 every bundle carries an `orders` key, `[]` included — the live/fixture signal',
    (row ? row.lots : []).every((l) => Array.isArray(l.orders)),
    (row ? row.lots : []).map((l) => [l.lotNo, Array.isArray(l.orders)]));

  /* Tolerant of the field being ABSENT, so a pre-change run reports every
     assertion instead of throwing on the first one. */
  const ords = (l) => (l && Array.isArray(l.orders) ? l.orders : []);

  const held = byLot['316027-12'];
  ok('B2 a reserved bundle names its REAL sales orders',
    ords(held).length === 2 &&
    ords(held).map((o) => o.soNumber).sort().join('|') === 'SO-CWP-001344|SO-CWP-001360',
    ords(held).map((o) => o.soNumber));
  const so1344 = ords(held).find((o) => o.soNumber === 'SO-CWP-001344');
  ok('B3 the order carries the customer NetSuite records, not a generated one',
    !!so1344 && so1344.customer === 'County Line Materials LLC' && so1344.customerId === '2853',
    so1344 && so1344.customer);
  ok('B4 both dates come through as ISO, not in the account display format',
    !!so1344 && so1344.created === '2026-08-20' && so1344.shipDate === '2026-08-20',
    so1344 && [so1344.created, so1344.shipDate]);
  ok('B5 the trader is the SALES TEAM rep — the header field is null on every ARCH order',
    !!so1344 && so1344.rep === 'Camil Perrault' && so1344.repId === '2085' && so1344.repSource === 'salesTeam',
    so1344 && [so1344.rep, so1344.repSource]);
  ok('B6 the internal id is carried, so the SO number can be a link and an identity',
    !!so1344 && so1344.tranId === '126449');

  const shared = ords(held).find((o) => o.soNumber === 'SO-CWP-001360');
  ok('B7 a 50/50 order is FLAGGED shared and tied, not silently attributed to one rep',
    !!shared && shared.repShared === true && shared.repTied === true,
    shared && [shared.rep, shared.repShared, shared.repTied]);
  ok('B8 two LINES of one order are ONE claim, with the shares summed (0.54 + 0.10 MBF = 640 BF)',
    !!shared && Math.round(shared.qty) === 640, shared && shared.qty);

  ok('B9 the shares sum to the bundle reserve, in display units',
    !!held && ords(held).length > 0 &&
    Math.abs(ords(held).reduce((s, o) => s + o.qty, 0) - held.reserve) < 1e-6,
    held && [ords(held).map((o) => o.qty), held.reserve]);
  ok('B10 quantities are converted out of base units, so a claim is BF and not MBF',
    !!so1344 && Math.round(so1344.qty) === 1080, so1344 && so1344.qty);

  const shipped = byLot['316027-20'];
  ok('B11 a fully shipped and billed line names NO order — only the open share attributes',
    !!shipped && Array.isArray(shipped.orders) && shipped.orders.length === 0 && shipped.reserve === 0,
    shipped && [shipped.orders, shipped.reserve]);

  ok('B12 no extra query: the order fields ride the bucket query that was already running',
    sqlLog.filter((s) => /FROM transactionline tl/.test(s)).length === 1,
    sqlLog.filter((s) => /FROM transactionline tl/.test(s)).length);
  ok('B13 the sales-team read is ONE query for the whole run, not one per row',
    sqlLog.filter((s) => /FROM transactionsalesteam/.test(s)).length === 1,
    sqlLog.filter((s) => /FROM transactionsalesteam/.test(s)).length);
  ok('B14 the sublist is NOT joined into the bucket query — that doubles a two-rep order',
    !sqlLog.some((s) => /FROM transactionline tl/.test(s) && /transactionsalesteam/.test(s)));
  ok('B15 the run is clean: no error line', errors.length === 0, errors);
  ok('B16 the attribution is reported in the log, so a silent zero is visible',
    audits.some((a) => /reserved-order attribution/.test(a)), audits);

  /* ── THE BUCKET ARITHMETIC MUST NOT MOVE ─────────────────────────────────
   * Corrected three times on 2026-09-08; the final formula is
   * available = onHand + onOrder + inTransit - reserve - readyToBuild - held,
   * with outbound NOT subtracted. Pinned here because this file touches the
   * same function that computes it. */
  ok('B17 reserve is unchanged: 1,080 + 640 + 1,080 BF of open sales-order lines',
    !!row && Math.round(row.reserve) === 2800, row && row.reserve);
  ok('B18 outbound still reports the shipped 300 BF and is NOT subtracted from available',
    !!row && Math.round(row.outbound) === 300 &&
    Math.round(row.available) === Math.max(0, Math.round(row.onHand + row.onOrder + row.inTransit - row.reserve - (row.held || 0))),
    row && [row.outbound, row.onHand, row.available]);
  ok('B19 on hand is still summed from the bundles (1.08 + 1.08 + 2 MBF)',
    !!row && Math.round(row.onHand) === 4160, row && row.onHand);
}

{
  // The role caveat, made a behaviour rather than a comment. archSalesTeam.js
  // records that the ARCH trader role cannot read the employee table; if the
  // sublist is unreadable too, the panel must lose the NAME and nothing else.
  const { written, errors } = runMr({ teamThrows: true });
  const held = written[0].lots.find((l) => l.lotNo === '316027-12');
  const heldOrders = held && Array.isArray(held.orders) ? held.orders : [];
  ok('B20 an unreadable sales team still leaves the SO, customer and dates real',
    heldOrders.length === 2 && !!heldOrders[0].soNumber && heldOrders[0].customer === 'County Line Materials LLC');
  ok('B21 …with the rep empty and its source declared "none", not guessed',
    heldOrders.length > 0 && heldOrders.every((o) => o.rep === '' && o.repSource === 'none'),
    heldOrders.map((o) => [o.rep, o.repSource]));
  ok('B22 …and it is logged at ERROR, because the loss is silent on screen',
    errors.some((e) => /SALES TEAM UNREADABLE|chunk read failed/.test(e)), errors);
}

/* ════ F. source guards on the two components ══════════════════════════════
 * These are SOURCE-TEXT checks, not behavioural: node cannot load a .tsx. They
 * pin the pairs that must move together, which is all a text check can do.
 */
{
  const s = component('ArchReservedSection.tsx');
  ok('F1 the panel reads the real orders',
    /from '@\/lib\/archLotOrders'/.test(s) && /reservedRows\(/.test(s));
  ok('F2 the placeholder banner is CONDITIONAL, not printed over real data',
    /\{showPlaceholderBanner && \(/.test(s));
  ok('F3 the generator is reached only on the unsourced branch',
    /source === 'unsourced' \? lotAllocation\(/.test(s));
  /* Counts INVOCATIONS, not mentions: the import line and the comment above the
     banner both contain the word. Every call in this file passes `lot.lotNo`, so
     that is the invocation shape, and there must be exactly one of it — the one
     behind the 'unsourced' guard checked above. */
  ok('F4 exactly one lotAllocation() invocation remains, and it is the guarded one',
    (s.match(/lotAllocation\(lot\./g) || []).length === 1,
    (s.match(/lotAllocation\(lot\./g) || []).length);
  ok('F5 the banner text survives while the generator is still imported, per archUiGuards',
    !/lotAllocation\(/.test(s) || s.includes('Placeholder columns.'));

  const l = component('ArchLotTable.tsx');
  ok('F6 the lot table resolves its SO columns the same way',
    /from '@\/lib\/archLotOrders'/.test(l) && /orderSource\(l, bucket\) === 'unsourced'/.test(l));
  ok('F7 the lot table never renders a generated SO number over a real one',
    !/render: \(l\) => lotAllocation\(l\.lotNo, bucket\)\.soNumber/.test(l));
  ok('F8 a bundle held by several orders discloses the others rather than dropping them',
    /is held by \$\{claims\(l\)\.length\} sales orders/.test(l));
}

console.log(fail ? ('# FAIL ' + fail) : '# archLotOrders ok');
if (fail) process.exitCode = 1;
