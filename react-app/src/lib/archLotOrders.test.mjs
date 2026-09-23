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
  daysReady,
  bfPriceText,
  shipWeekCell,
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
  /* ⚠️ A4 REWRITTEN 2026-09-14. It read "readyToBuild is a literal 0 in the
     cache and outbound is attributed to no bundle, so neither may borrow the
     reserve's orders", and pinned readyToBuild at 'unavailable' unconditionally.
     The first half expired when the field went live: the deployed screen showed
     lot 315643-5 with readyToBuild 25 and every contextual column blank.

     What survives, and is now pinned precisely: readyToBuild may NOT borrow the
     reserve's orders on a payload that cannot tell the two apart. A bundle can be
     claimed by a Reserved order and a Ready-to-Build one at once, and `qty` is the
     order's share of the BUNDLE, so an unstamped payload would show the same list
     and number under both tabs. That is the 2026-09-10 revert, preserved. */
  ok('A4 readyToBuild does NOT borrow orders when the payload cannot tell the buckets apart',
    orderSource(lot({ orders: [order()] }), 'readyToBuild') === 'unavailable');
  ok('A4b ...but DOES resolve them once the cache stamps which bucket each order landed in',
    orderSource(lot({ orders: [order({ readyToBuild: true })] }), 'readyToBuild') === 'netsuite');
  ok('A4c ...and then each tab shows only its own orders, never the other tab\'s',
    ordersFor(lot({ orders: [order({ tranId: '1', readyToBuild: true }), order({ tranId: '2', readyToBuild: false })] }), 'readyToBuild')
      .map((o) => o.tranId).join() === '1' &&
    ordersFor(lot({ orders: [order({ tranId: '1', readyToBuild: true }), order({ tranId: '2', readyToBuild: false })] }), 'reserve')
      .map((o) => o.tranId).join() === '2');
  ok('A4d ...while an UNSTAMPED payload still gives reserve everything, exactly as before',
    ordersFor(lot({ orders: [order({ tranId: '1' }), order({ tranId: '2' })] }), 'reserve').length === 2);
  ok('A5 outbound never borrows the reserve orders',
    orderSource(lot({ orders: [order()] }), 'outbound') === 'unavailable');
  ok('A5b ...even on a stamped payload, because shipped wood is attributed to no bundle',
    orderSource(lot({ orders: [order({ readyToBuild: true })] }), 'outbound') === 'unavailable');
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

const runMr = ({ teamRows = TEAM_ROWS, teamThrows = false, lotRows = LOT_ROWS, bucketRows = BUCKET_ROWS, flagIds = [], transitRows = [], sealRows = [], poSealRows = [], rtsRows = [], rtsThrows = false, noteRows = [], noteThrows = false, priceRows = [], shipWeekRows = [], shipWeekThrows = false } = {}) => {
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
      // Feedback 10, BEFORE the transactionline route: the price read is a
      // `FROM transactionline tl` query too and would otherwise get bucket rows.
      if (/custbody_so_ready_to_ship/.test(sql)) {
        if (rtsThrows) throw new Error('Unknown identifier custbody_so_ready_to_ship');
        return { asMappedResults: () => rtsRows };
      }
      if (/FROM systemnote/.test(sql)) {
        if (noteThrows) throw new Error('Invalid search type: systemnote');
        return { asMappedResults: () => noteRows };
      }
      if (/tl\.foreignamount/.test(sql)) return { asMappedResults: () => priceRows };
      if (/custbody_ship_week/.test(sql) && /FROM transaction WHERE id IN/.test(sql)) {
        if (shipWeekThrows) throw new Error('Unknown identifier custbody_ship_week');
        return { asMappedResults: () => shipWeekRows };
      }
      if (/FROM transactionsalesteam/.test(sql)) {
        if (teamThrows) throw new Error('Search error occurred: permission');
        rows = teamRows;
      } else if (/FROM inventorynumberlocation/.test(sql)) rows = lotRows;
      else if (/FROM transactionline tl/.test(sql)) rows = bucketRows;
      // The Ready to Build flag read. Returned [] by default, which is why nothing
      // here noticed the stamp never reached the payload (Feedback 13).
      else if (/custbody_arch_ready_to_build/.test(sql)) rows = flagIds.map((id) => ({ tranid: id }));
      // The take-ownership journal / agency / status read (1.2). Returned [] by
      // default, which kept every PO test on the billing branch.
      else if (/custbody_po_intransit_journal/.test(sql)) rows = transitRows;
      // Feedback 15: the lot seal read (via inventoryassignment) and the per-PO one.
      else if (/custbody_seal_trailer_number/.test(sql) && /FROM inventoryassignment/.test(sql)) rows = sealRows;
      else if (/custbody_seal_trailer_number/.test(sql)) rows = poSealRows;
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
    // Feedback 13: loaded for real, it has no dependencies.
    if (/archShipWeek$/.test(id)) return load(join(SHARED, 'archShipWeek.js'), () => { throw new Error('no deps'); });
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
  // Feedback 13: the fixture's ship date equals its order date, NetSuite's default,
  // so the resolved ship week is '' and flagged. `created` is still ISO.
  ok('B4 dates come through as ISO, and a default ship date is served as none (flagged)',
    !!so1344 && so1344.created === '2026-08-20' && so1344.shipDate === '' && so1344.shipDateDefaulted === true,
    so1344 && [so1344.created, so1344.shipDate, so1344.shipDateDefaulted]);
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
  /* Feedback 10: the shipped 300 BF no longer reaches Outbound, which is Ready to
   * Ship wood now, and Available is unchanged by dropping it (it was never
   * subtracted). Section I covers the new meaning. */
  ok('B18 shipped wood no longer counts as Outbound, and Available does not move',
    !!row && Math.round(row.outbound) === 0 &&
    Math.round(row.available) === Math.max(0, Math.round(row.onHand - row.reserve - (row.held || 0))),
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


/* ════ C. THE TWO CACHE DEFECTS, found by the 2026-09-09 adversarial review ═══
 *
 * Both are arithmetic on a trading screen, so both are driven through the REAL MR
 * rather than asserted from source.
 */
{
  /* ── C1. A pair with a BUCKET but NO on-hand lot used to vanish entirely ────
   *
   * `byPair` in getInputData is built only from LOT_SQL, whose WHERE ends
   * `quantityonhand <> 0`, while buckets are read as a lookup (`buckets[key] ||
   * null`). So a key with no on-hand lot produced NO ROW: no On Order, no In
   * Transit, and not one line in the log. Measured live: 2912__108, PUR44KD at
   * Ambassador Services International, 600 BF on PO-CWP-001325. The grid's On
   * Order read 8,350 BF against NetSuite's 8,950. That is the whole gap, and it
   * is the NORMAL state for a first delivery to a location.
   */
  const ORPHAN = bkRow({
    locationid: '108', locationname: 'Ambassador Services International',
    trantype: 'PurchOrd', tranid: '999001', docno: 'PO-CWP-001325',
    lineno: '9', qty: '0.6', shiprecv: '0', billed: '0',
    lotno: null, assignedqty: null,
  });
  const c1 = runMr({ bucketRows: BUCKET_ROWS.concat([ORPHAN]) });
  const orphan = c1.written.find((r) => String(r.locationId) === '108');
  ok('C1: the pair with stock on order but nothing on hand now produces a row', !!orphan,
    c1.written.map((r) => r.itemCode + '@' + r.locationId));
  ok('C1: and it carries the on-order quantity that used to disappear',
    !!orphan && Math.round(orphan.onOrder) === 600, orphan && orphan.onOrder);
  ok('C1: item-level metadata is ADOPTED from a real row, never invented',
    !!orphan && orphan.itemCode === 'ZEB84KD' && orphan.unit === 'BF', orphan && [orphan.itemCode, orphan.unit]);
  ok('C1: it names its own location, which no lot row could have told it',
    !!orphan && orphan.locationName === 'Ambassador Services International', orphan && orphan.locationName);
  ok('C1: it has NO lots, rather than a fabricated one',
    !!orphan && Array.isArray(orphan.lots) && orphan.lots.length === 0, orphan && orphan.lots);
  ok('C1: nothing is on hand there, so On Hand reads 0',
    !!orphan && Math.round(orphan.onHand) === 0, orphan && orphan.onHand);
  /* ⚠️ THIS ASSERTED ERROR UNTIL 2026-09-21, AND THE CHANGE IS DELIBERATE.
   *
   * The original reasoning was sound when written: these rows were missing from
   * the grid entirely until 2026-09-09, and an audit line on a slow job is how a
   * four-day outage hid here once before. The builder paired that with a latch
   * meant to demote repeats to audit, so only the FIRST occurrence shouted.
   *
   * Measured 2026-09-21: the latch never armed, not once. Four consecutive
   * rebuilds (07:35:44, 07:50:48, 08:05:55, 08:20:59) logged this at ERROR with
   * an identical four-pair payload, and the cause is structural — the count rides
   * a module-scope variable from getInputData to summarize, and Map/Reduce gives
   * each stage a fresh module instance, so META always records 0. The builder
   * carries the full explanation.
   *
   * With the interval now at 15 minutes that is 96 error notes a day for a
   * standing state of the data, which is the exact pattern this project already
   * corrected twice (untagged items 2026-08-25, shrink guard before it). And the
   * message reports a SUCCESS: the recovery worked and the rows are on screen.
   *
   * So the invariant worth pinning is that the condition is NOT SILENT, which is
   * what the original test was really protecting. AUDIT satisfies that — scriptnote
   * returns audit and error alike. If someone builds a carrier that survives
   * stages, restore ERROR for the first occurrence and assert both halves here. */
  ok('C1: the recovery is reported, not silent',
    c1.audits.some((e) => /recovered/.test(e) && /nothing on hand/.test(e)), c1.audits);
  ok('C1: …at AUDIT, because it fires on every run and reports the fix WORKING',
    !c1.errors.some((e) => /recovered/.test(e) && /nothing on hand/.test(e)), c1.errors);

  /* A bucket for an item that appears in NO lot row has no donor, so its
   * stock-unit rate cannot be read. Inventing one is wrong by three orders of
   * magnitude for Lumber, which this file refuses to do elsewhere too. */
  const NO_DONOR = bkRow({
    itemid: '8888', locationid: '777', locationname: 'Nowhere',
    trantype: 'PurchOrd', tranid: '999009', docno: 'PO-CWP-009999',
    lineno: '99', qty: '5', shiprecv: '0', billed: '0', lotno: null, assignedqty: null,
  });
  const c1b = runMr({ bucketRows: BUCKET_ROWS.concat([NO_DONOR]) });
  ok('C1: a bucket whose item appears nowhere else is NOT invented into a row',
    !c1b.written.some((r) => String(r.internalId) === '8888'), c1b.written.map((r) => r.internalId));
  /* Same change as the recovery assertion above, same date, same measurement:
   * this block also fires on every rebuild, with twelve real pairs, so ERROR was
   * 96 notes a day for a standing condition.
   *
   * 🔴 BUT UNLIKE THE RECOVERY, THE UNDERLYING CONDITION IS A REAL BUG THAT IS
   * STILL OPEN, so do not read a quieter log as the problem being solved. The
   * comment above this block says the rate "cannot be read", and that turned out
   * to be false. Measured 2026-09-21: all eleven items behind the twelve live
   * pairs are correctly tagged and every one resolves BF at 0.001 through
   * `LEFT JOIN unitstypeuom u ON u.internalid = i.stockunit`, the same join
   * LOT_SQL already uses. The rate is not unknowable, BUCKET_SQL just never asks
   * for it. Refusing to invent a rate is still right; the fix is to select the
   * item unit columns so there is nothing to invent. Until then these quantities
   * are missing from the grid, 3187__9 at 20 stored units among them. */
  ok('C1: and that omission is reported, not silent',
    c1b.audits.some((e) => /no usable stock-unit rate/i.test(e)), c1b.audits);
  ok('C1: …at AUDIT, because it is a standing data condition on every run',
    !c1b.errors.some((e) => /no usable stock-unit rate/i.test(e)), c1b.errors);

  /* ── C1d. THE PAIR'S OWN RATE, WHICH IS WHAT MADE THE DONOR OPTIONAL ───────
   *
   * Added 2026-09-21 with the BUCKET_SQL unit columns. Before them, a pair with
   * a bucket and no on-hand lot could only be built by copying a rate from a
   * DONOR pair carrying the same item somewhere else, so an item with stock on
   * order at its FIRST location and nowhere else was dropped entirely. That was
   * discarding twelve pairs on every live rebuild, 3187__9 at 20 stored units
   * among them, and the log line blamed untagged items — wrongly, since all
   * eleven items were tagged and every one resolved BF at 0.001 off
   * `item.stockunit`.
   *
   * Same NO_DONOR shape as above, with the one difference that matters: the
   * bucket row now carries its own unitname and rate, the way the real query
   * returns them. The row must build, and it must build at the row's OWN rate
   * rather than at 1. */
  const OWN_RATE = bkRow({
    itemid: '7777', locationid: '778', locationname: 'First Delivery Ever',
    trantype: 'PurchOrd', tranid: '999010', docno: 'PO-CWP-009998',
    // 20 stored units, which is 3187__9 (OKO84KD at ARCH CLOUD) to the number —
    // the largest of the twelve pairs this fix recovers on live data.
    lineno: '98', qty: '20', shiprecv: '0', billed: '0',
    lotno: null, assignedqty: null,
    itemcode: 'OKO84KD', description: 'Okoume 8/4 KD', unitname: 'BF', rate: '0.001',
  });
  const c1d = runMr({ bucketRows: BUCKET_ROWS.concat([OWN_RATE]) });
  const own = c1d.written.find((r) => String(r.internalId) === '7777');
  ok('C1d: a pair with NO donor anywhere now builds from its own item row', !!own,
    c1d.written.map((r) => r.internalId));
  ok('C1d: …naming itself from its own row rather than adopting another item',
    !!own && own.itemCode === 'OKO84KD', own && own.itemCode);
  /* 20 stored units at rate 0.001 is 20,000 BF, because display = base / rate.
   * This is the assertion that actually catches the old bug's twin: a defaulted
   * rate of 1 would render 20 BF here, three orders of magnitude LOW, which is
   * precisely the failure the builder refuses to risk by guessing. Pinned as the
   * exact figure rather than "> 0" so a future default cannot slip through. */
  ok('C1d: …and converting at ITS OWN rate, not at a defaulted 1',
    !!own && Math.round(own.onOrder) === 20000, own && own.onOrder);
  ok('C1d: nothing is on hand there, so On Hand is still 0',
    !!own && Math.round(own.onHand) === 0, own && own.onHand);
  ok('C1d: …with no lots, since no bundle exists yet',
    !!own && Array.isArray(own.lots) && own.lots.length === 0, own && own.lots);
  ok('C1d: and it is NOT reported as skipped, because nothing was skipped',
    !c1d.audits.some((e) => /no usable stock-unit rate/i.test(e) && /7777__778/.test(e)),
    c1d.audits.filter((e) => /stock-unit rate/i.test(e)));
  /* The refusal must still bite when the rate is absent on BOTH paths — a zero
   * rate is not a licence to guess 1. Same row, rate stripped. */
  const c1e = runMr({ bucketRows: BUCKET_ROWS.concat([
    Object.assign({}, OWN_RATE, { rate: null, unitname: null }),
  ]) });
  ok('C1d: a rate of null on both paths is still refused, not defaulted to 1',
    !c1e.written.some((r) => String(r.internalId) === '7777'),
    c1e.written.map((r) => r.internalId));
}

{
  /* ── C2. On Order and In Transit were NESTED, and Available adds both ──────
   *
   * onOrder was the WHOLE open quantity; inTransit was the billed-not-received
   * PART of that same quantity. So inTransit <= onOrder for every input, and
   * EQUAL once billed >= ordered: a purchase order billed ahead of receipt
   * booked its full quantity into both buckets and inflated Available by it.
   * Latent when found only because all six hardwood PO lines read billed 0,
   * which for imported hardwood on the water is luck, not a property.
   */
  const po = (over) => bkRow(Object.assign({
    trantype: 'PurchOrd', lotno: null, assignedqty: null, shiprecv: '0',
  }, over));

  const full = runMr({ bucketRows: [po({ tranid: '999002', docno: 'PO-A', lineno: '11', qty: '2', billed: '2' })] })
    .written.find((r) => String(r.internalId) === '2915');
  ok('C2: a fully billed, unreceived PO line is IN TRANSIT',
    !!full && Math.round(full.inTransit) === 2000, full && full.inTransit);
  ok('C2: and is NOT also counted as On Order',
    !!full && Math.round(full.onOrder) === 0, full && full.onOrder);
  ok('C2: the two buckets sum to the open quantity, never more',
    !!full && Math.round(full.onOrder + full.inTransit) === 2000,
    full && { onOrder: full.onOrder, inTransit: full.inTransit });

  const half = runMr({ bucketRows: [po({ tranid: '999003', docno: 'PO-B', lineno: '12', qty: '2', billed: '0.5' })] })
    .written.find((r) => String(r.internalId) === '2915');
  ok('C2: half billed splits 500 in transit / 1,500 on order',
    !!half && Math.round(half.inTransit) === 500 && Math.round(half.onOrder) === 1500,
    half && { onOrder: half.onOrder, inTransit: half.inTransit });
  ok('C2: and still sums to the open quantity',
    !!half && Math.round(half.onOrder + half.inTransit) === 2000, half && [half.onOrder, half.inTransit]);

  const none = runMr({ bucketRows: [po({ tranid: '999004', docno: 'PO-C', lineno: '13', qty: '2', shiprecv: '2', billed: '2' })] })
    .written.find((r) => String(r.internalId) === '2915');
  ok('C2: a fully received AND billed line is in neither bucket',
    !!none && Math.round(none.onOrder) === 0 && Math.round(none.inTransit) === 0,
    none && { onOrder: none.onOrder, inTransit: none.inTransit });

  // Billed MORE than ordered, which NetSuite permits on an over-invoice.
  const over = runMr({ bucketRows: [po({ tranid: '999005', docno: 'PO-D', lineno: '14', qty: '2', billed: '5' })] })
    .written.find((r) => String(r.internalId) === '2915');
  ok('C2: over-billed cannot push In Transit above the ordered quantity',
    !!over && Math.round(over.inTransit) === 2000 && Math.round(over.onOrder) === 0,
    over && { onOrder: over.onOrder, inTransit: over.inTransit });
}

/* ════ G. Ready to Build attribution reaches the PAYLOAD (Feedback 13) ════════
 * 2026-09-21, MA on SO 115774 / lot 315310-16: "Ready to build : Il manque de
 * l'info dans les colonnes". The MR stamped `readyToBuild` on each order in
 * getInputData, then the reduce-side payload builder copied a fixed field list
 * that omitted it, so `orderSource(lot, 'readyToBuild')` read 'unavailable' on
 * every live bundle and all six SO columns rendered an em dash. A4b passed the
 * whole time because it hand-builds stamped orders; these run the MR's OWN
 * output through the real resolver, which is the only thing that proves it. */
{
  const { written, errors } = runMr({ flagIds: ['126500'] });
  const row = written.find((r) => String(r.internalId) === '2915');
  const held = row && row.lots.find((l) => l.lotNo === '316027-12');
  const ords = held && Array.isArray(held.orders) ? held.orders : [];
  ok('G1 every written order carries a BOOLEAN readyToBuild stamp',
    ords.length === 2 && ords.every((o) => typeof o.readyToBuild === 'boolean'),
    ords.map((o) => [o.soNumber, o.readyToBuild]));
  ok('G2 the flagged order is stamped true, the other false',
    ords.find((o) => o.soNumber === 'SO-CWP-001360')?.readyToBuild === true &&
    ords.find((o) => o.soNumber === 'SO-CWP-001344')?.readyToBuild === false,
    ords.map((o) => [o.soNumber, o.readyToBuild]));
  ok('G3 the buckets split on the same flag: 640 Ready to Build, 1,080 Reserved',
    !!held && Math.round(held.readyToBuild) === 640 && Math.round(held.reserve) === 1080,
    held && { readyToBuild: held.readyToBuild, reserve: held.reserve });
  ok('G4 the resolver now SOURCES the Ready to Build tab from the MR output',
    !!held && orderSource(held, 'readyToBuild') === 'netsuite', held && orderSource(held, 'readyToBuild'));
  ok('G5 and each tab lists only its own order',
    !!held &&
    ordersFor(held, 'readyToBuild').map((o) => o.soNumber).join() === 'SO-CWP-001360' &&
    ordersFor(held, 'reserve').map((o) => o.soNumber).join() === 'SO-CWP-001344',
    held && [ordersFor(held, 'readyToBuild').map((o) => o.soNumber), ordersFor(held, 'reserve').map((o) => o.soNumber)]);
  ok('G6 each tab lists quantities that sum to that tab\'s own figure',
    !!held &&
    Math.abs(ordersFor(held, 'readyToBuild').reduce((t, o) => t + o.qty, 0) - held.readyToBuild) < 1e-6 &&
    Math.abs(ordersFor(held, 'reserve').reduce((t, o) => t + o.qty, 0) - held.reserve) < 1e-6);
  ok('G7 clean run', errors.length === 0, errors);
}

/* ════ H. PO lines with NO bundles are listed, with provenance (F8 2.8c) ═══════
 * « si jamais on facture avant réception et qu'on a pas de packing list, alors on
 * présentera la ligne dans le TS sans le détail des bundles. Ce sera un flag pour
 * l'équipe. » The quantity already reached the row; it vanished from the
 * drill-down, which lists lots only, and on a MIXED row it vanished silently. */
{
  const po = (over) => bkRow(Object.assign({
    trantype: 'PurchOrd', lotno: null, assignedqty: null, shiprecv: '0', shipweek: '10/1/2026',
    custid: '77', customer: 'Supplier SA',
  }, over));

  const pure = runMr({ bucketRows: [po({ tranid: '999102', docno: 'PO-BILL', lineno: '11', qty: '2', billed: '2' })] })
    .written.find((r) => String(r.internalId) === '2915');
  const u = pure && Array.isArray(pure.unbundled) ? pure.unbundled : [];
  ok('H1 a billed-ahead PO line with no bundle is published as unbundled, with its PO, supplier and ETA',
    u.length === 1 && u[0].poNumber === 'PO-BILL' && u[0].supplier === 'Supplier SA' && u[0].eta === '2026-10-01',
    u);
  ok('H2 ...flagged as the BILLED arm, all of it in transit, in display units',
    u.length === 1 && u[0].arm === 'billed' && Math.round(u[0].inTransit) === 2000 && Math.round(u[0].onOrder) === 0, u);

  // Mixed: one line 3 units with 1 unit bundled on 316027-12, plus a second line with no bundle.
  const mixed = runMr({ bucketRows: [
    po({ tranid: '999103', docno: 'PO-MIX', lineno: '21', qty: '3', billed: '0', lotno: '316027-12', assignedqty: '1' }),
    po({ tranid: '999103', docno: 'PO-MIX', lineno: '22', qty: '1', billed: '0' }),
  ] }).written.find((r) => String(r.internalId) === '2915');
  const mu = mixed && Array.isArray(mixed.unbundled) ? mixed.unbundled : [];
  const lotsOnOrder = mixed ? mixed.lots.reduce((t, l) => t + (l.onOrder || 0), 0) : 0;
  const unbOnOrder = mu.reduce((t, x) => t + x.onOrder, 0);
  ok('H3 on a MIXED row, bundles + unbundled lines add up to the On Order column exactly',
    !!mixed && Math.abs(lotsOnOrder + unbOnOrder - mixed.onOrder) < 1e-6 && Math.round(mixed.onOrder) === 4000,
    mixed && { lotsOnOrder, unbOnOrder, onOrder: mixed.onOrder });
  // Both lines are in the same state on the same PO, so they merge (H11): the
  // partly bundled line contributes only its UNbundled 2,000, the other its 1,000.
  ok('H4 ...the partly bundled line contributes only its UNbundled part: one merged entry, 2 lines, 3,000',
    mu.length === 1 && mu[0].lineCount === 2 && Math.round(mu[0].onOrder) === 3000 && mu[0].arm === 'none', mu);
  ok('H5 ...and agrees with the row-level unattributed figure',
    !!mixed && Math.abs(unbOnOrder - mixed.unattributed.onOrder) < 1e-6, mixed && mixed.unattributed);

  const bundled = runMr({ bucketRows: [po({ tranid: '999104', docno: 'PO-ALL', lineno: '31', qty: '1', billed: '0', lotno: '316027-2', assignedqty: '1' })] })
    .written.find((r) => String(r.internalId) === '2915');
  ok('H6 a fully bundled line publishes NO unbundled entry',
    !!bundled && Array.isArray(bundled.unbundled) && bundled.unbundled.length === 0, bundled && bundled.unbundled);

  /* ── Round-1 review of 6210842 ── */
  const one = (res) => res.written.find((r) => String(r.internalId) === '2915');

  // Take ownership AND a supplier invoice: arm 'journal', but still billed ahead.
  const jb = one(runMr({
    bucketRows: [po({ tranid: '999105', docno: 'PO-JB', lineno: '41', qty: '2', billed: '2' })],
    transitRows: [{ tranid: '999105', transitje: '555', agencyflag: 'F', tstatus: 'B' }],
  }));
  const ju = jb && jb.unbundled ? jb.unbundled : [];
  ok('H7 a journal line that is ALSO billed ahead keeps billedAhead, so it is flagged',
    ju.length === 1 && ju[0].arm === 'journal' && ju[0].billedAhead === true && Math.round(ju[0].inTransit) === 2000, ju);

  // Journal, not billed: in transit, not his case.
  const jn = one(runMr({
    bucketRows: [po({ tranid: '999106', docno: 'PO-JN', lineno: '42', qty: '2', billed: '0' })],
    transitRows: [{ tranid: '999106', transitje: '556', agencyflag: 'F', tstatus: 'B' }],
  }));
  const jnu = jn && jn.unbundled ? jn.unbundled : [];
  ok('H8 a journal line NOT billed is in transit without the billed flag',
    jnu.length === 1 && jnu[0].arm === 'journal' && jnu[0].billedAhead === false && Math.round(jnu[0].inTransit) === 2000, jnu);

  // Closed PO with an open line: its own arm, never billed-ahead.
  const cl = one(runMr({
    bucketRows: [po({ tranid: '999107', docno: 'PO-CL', lineno: '43', qty: '2', billed: '2' })],
    transitRows: [{ tranid: '999107', transitje: '', agencyflag: 'F', tstatus: 'H' }],
  }));
  const clu = cl && cl.unbundled ? cl.unbundled : [];
  ok('H9 a closed PO line is arm "closed" and never flagged as billed ahead',
    clu.length === 1 && clu[0].arm === 'closed' && clu[0].billedAhead === false, clu);

  // Partly received, the remainder with no bundle (PO344951's live shape: 12 ordered, 10 received).
  const pr = one(runMr({ bucketRows: [po({ tranid: '999108', docno: 'PO-PR', lineno: '44', qty: '12', shiprecv: '10', billed: '0' })] }));
  const pru = pr && pr.unbundled ? pr.unbundled : [];
  ok('H10 a partly received line lists only its OPEN remainder, marked partlyReceived',
    pru.length === 1 && pru[0].partlyReceived === true && Math.round(pru[0].onOrder) === 2000, pru);

  // Two lines of one PO in the same state merge into one entry with a count.
  const mg = one(runMr({ bucketRows: [
    po({ tranid: '999109', docno: 'PO-MG', lineno: '45', qty: '0.45', billed: '0' }),
    po({ tranid: '999109', docno: 'PO-MG', lineno: '46', qty: '0.45', billed: '0' }),
  ] }));
  const mgu = mg && mg.unbundled ? mg.unbundled : [];
  ok('H11 two identical-state lines of one PO are ONE entry with lineCount 2 and the summed quantity',
    mgu.length === 1 && mgu[0].lineCount === 2 && Math.round(mgu[0].onOrder) === 900, mgu);

  // ETA: a ship week equal to the PO date is the default and is not an ETA.
  const ed = one(runMr({ bucketRows: [po({ tranid: '999110', docno: 'PO-ED', lineno: '47', qty: '1', billed: '0',
    trandate: '9/21/2026', shipweek: '9/21/2026' })] }));
  const edu = ed && ed.unbundled ? ed.unbundled : [];
  ok('H12 a ship week equal to the PO date gives NO ETA (it is the field default)',
    edu.length === 1 && edu[0].eta === '', edu);

  // Partly billed: only the billed part is in transit; the rest is On Order.
  const pb = one(runMr({ bucketRows: [po({ tranid: '999111', docno: 'PO-PB', lineno: '48', qty: '2', billed: '1' })] }));
  const pbu = pb && pb.unbundled ? pb.unbundled : [];
  ok('H13 a partly billed line splits 1,000 in transit / 1,000 on order, flagged billed ahead',
    pbu.length === 1 && pbu[0].billedAhead === true &&
      Math.round(pbu[0].inTransit) === 1000 && Math.round(pbu[0].onOrder) === 1000, pbu);

  // The openShare factor must be applied to what bundles claim (a mutation the
  // review showed H1-H6 did not catch): half-received line, bundle assigned for all of it.
  const os = one(runMr({ bucketRows: [po({ tranid: '999112', docno: 'PO-OS', lineno: '49', qty: '2', shiprecv: '1',
    billed: '0', lotno: '316027-12', assignedqty: '1' })] }));
  const osu = os && os.unbundled ? os.unbundled : [];
  const osLots = os ? os.lots.reduce((t, l) => t + (l.onOrder || 0), 0) : 0;
  ok('H14 bundles claim assigned x openShare, so lots + unbundled still equal the row',
    !!os && Math.abs(osLots + osu.reduce((t, x) => t + x.onOrder, 0) - os.onOrder) < 1e-6,
    os && { osLots, osu, onOrder: os.onOrder });

  /* ── Round-2 review: three behaviours no test pinned (mutations survived) ── */
  // A BUNDLE whose PO ship week is only the PO date has no ETA either, and says why.
  const be = one(runMr({ bucketRows: [po({ tranid: '999113', docno: 'PO-BE', lineno: '50', qty: '1', billed: '0',
    lotno: '316027-2', assignedqty: '1', trandate: '9/21/2026', shipweek: '9/21/2026' })] }));
  const beLot = be && be.lots.find((l) => l.lotNo === '316027-2');
  ok('H15 a bundle whose ship week equals the PO date gets eta "" and etaDefaulted',
    !!beLot && beLot.incoming && beLot.incoming.eta === '' && beLot.incoming.etaDefaulted === true,
    beLot && beLot.incoming);

  // Two lines of one PO, one billed and one not, are NOT merged (different state).
  const tb = one(runMr({ bucketRows: [
    po({ tranid: '999114', docno: 'PO-TB', lineno: '51', qty: '1', billed: '1' }),
    po({ tranid: '999114', docno: 'PO-TB', lineno: '52', qty: '1', billed: '0' }),
  ] }));
  const tbu = tb && tb.unbundled ? tb.unbundled : [];
  ok('H16 a billed and an unbilled line of one PO stay two entries',
    tbu.length === 2 && tbu.some((x) => x.billedAhead) && tbu.some((x) => !x.billedAhead), tbu);

  // Billed ONLY for what was received is not billed AHEAD.
  const br = one(runMr({ bucketRows: [po({ tranid: '999115', docno: 'PO-BR', lineno: '53', qty: '2', shiprecv: '1', billed: '1' })] }));
  const bru = br && br.unbundled ? br.unbundled : [];
  ok('H17 a line billed exactly for what was received is NOT billedAhead',
    bru.length === 1 && bru[0].billedAhead === false && bru[0].partlyReceived === true, bru);

  /* ── Feedback 15: the container from the PO's Seal / Trailer # ── */
  const sl = one(runMr({
    bucketRows: [po({ tranid: '999116', docno: 'PO-SL', lineno: '54', qty: '1', billed: '0' })],
    sealRows: [{ lotid: '49847', seal: 'ABC1234' }],
    poSealRows: [{ tranid: '999116', seal: 'TRL-9' }],
  }));
  const slLot = sl && sl.lots.find((l) => l.lotNo === '316027-12');
  ok('H19 a bundle from a PO reads the PO Seal / Trailer # as its container',
    !!slLot && slLot.containerNo === 'ABC1234', slLot && slLot.containerNo);
  const slu = sl && sl.unbundled ? sl.unbundled : [];
  ok('H20 an unbundled PO line carries its PO Seal / Trailer # too',
    slu.length === 1 && slu[0].container === 'TRL-9', slu);
  const noSeal = one(runMr({ bucketRows: [po({ tranid: '999117', docno: 'PO-NS', lineno: '55', qty: '1', billed: '0' })] }));
  ok('H21 no seal anywhere leaves the container empty, not invented',
    !!noSeal && noSeal.lots.every((l) => l.containerNo === '') && noSeal.unbundled.every((u) => u.container === ''),
    noSeal && noSeal.lots.map((l) => l.containerNo));

  // Per-tab line counts on a merged entry.
  ok('H18 a merged entry counts its lines per tab',
    mgu.length === 1 && mgu[0].onOrderLines === 2 && mgu[0].inTransitLines === 0, mgu);
}

/* ════ I. Ready to Ship is the ARCH Outbound (Feedback 10) ═══════════════════
 * « Colonne outbound -> C'est un peu différent pour ARC. Le statut est la
 * commande est ready to ship (elle a bougée de ready to build à ready to ship)
 * ... Le stock est donc toujours on hand. Lot #, So#, Customer, Days ready (basé
 * sur le stamp date de quand on a coché "Ready to Ship"), Total BF, BF Price ».
 * SO-CWP-001360 (126500, lines 9 and 10, 640 BF of bundle 316027-12) is ticked
 * Ready to Ship AND still ticked Ready to Build. */
{
  const rts = runMr({
    flagIds: ['126500'],
    rtsRows: [{ tranid: '126500', trandate: '2026-09-01' }],
    noteRows: [
      { tranid: '126500', ts: '2026-09-10 08:00:00' },
      { tranid: '126500', ts: '2026-09-15 09:30:00' },   // ticked again later: this one
    ],
    priceRows: [
      { tranid: '126500', lineid: '9',  famt: '-6480', fqty: '-0.54', cur: 'USD' },   // 12.00 / BF
      { tranid: '126500', lineid: '10', famt: '-1500', fqty: '-0.1',  cur: 'USD' },   // 15.00 / BF
      // Another order's line 9. transactionline.id restarts per order, so a
      // line-only key would hand this price to SO-CWP-001360.
      { tranid: '126449', lineid: '9',  famt: '-99999', fqty: '-0.54', cur: 'CAD' },
    ],
  });
  const row = rts.written.find((r) => String(r.internalId) === '2915');
  const held = row && row.lots.find((l) => l.lotNo === '316027-12');
  const ords = held && Array.isArray(held.orders) ? held.orders : [];
  const o1360 = ords.find((o) => o.soNumber === 'SO-CWP-001360');
  const o1344 = ords.find((o) => o.soNumber === 'SO-CWP-001344');

  ok('I1 a Ready to Ship order puts its open share in Outbound, on the row and on the bundle',
    !!row && Math.round(row.outbound) === 640 && !!held && Math.round(held.outbound) === 640,
    row && { row: row.outbound, lot: held && held.outbound });
  ok('I2 ...and NOT also in Ready to Build, although that box is still ticked',
    !!row && Math.round(row.readyToBuild) === 0 && Math.round(held.readyToBuild) === 0,
    row && { row: row.readyToBuild, lot: held && held.readyToBuild });
  ok('I3 Reserved keeps only the other order', !!held && Math.round(held.reserve) === 1080, held && held.reserve);
  ok('I4 🔴 Available subtracts it: still on hand, still sold (4,160 - 2,160 - 640)',
    !!row && Math.round(row.available) === 1360, row && row.available);
  ok('I5 the order is stamped readyToShip and NOT readyToBuild, so it is listed under one tab',
    o1360?.readyToShip === true && o1360?.readyToBuild === false && o1344?.readyToShip === false,
    ords.map((o) => [o.soNumber, o.readyToShip, o.readyToBuild]));
  ok('I6 Days ready counts from the LATEST tick',
    o1360?.readySince === '2026-09-15', o1360 && o1360.readySince);
  ok('I7 BF Price is the order-currency price per BF, weighted over its lines',
    !!o1360 && Math.abs(o1360.bfPrice - (6480 + 1500) / 0.64 * 0.001) < 1e-9 && o1360.currency === 'USD',
    o1360 && [o1360.bfPrice, o1360.currency]);
  ok('I8 🔴 prices are keyed by ORDER and line, so another order\'s line 9 does not leak in',
    !!o1360 && o1360.bfPrice < 20, o1360 && o1360.bfPrice);
  ok('I9 the resolver sources the Outbound tab and each tab lists its own order',
    !!held && orderSource(held, 'outbound') === 'netsuite' &&
    ordersFor(held, 'outbound').map((o) => o.soNumber).join() === 'SO-CWP-001360' &&
    ordersFor(held, 'readyToBuild').length === 0 &&
    ordersFor(held, 'reserve').map((o) => o.soNumber).join() === 'SO-CWP-001344',
    held && ['outbound', 'readyToBuild', 'reserve'].map((b) => ordersFor(held, b).map((o) => o.soNumber)));
  ok('I10 the Outbound tab\'s orders sum to the bundle\'s Outbound',
    !!held && Math.abs(ordersFor(held, 'outbound').reduce((t, o) => t + o.qty, 0) - held.outbound) < 1e-6);
  ok('I11 the helpers render his columns', !!o1360 &&
    daysReady(o1360, new Date(2026, 8, 22)) === 7 && /12\.47/.test(bfPriceText(o1360)),
    o1360 && [daysReady(o1360, new Date(2026, 8, 22)), bfPriceText(o1360)]);
  ok('I12 clean run', rts.errors.length === 0, rts.errors);

  // Ticked when the order was created: a create writes no field note.
  const noNote = runMr({ rtsRows: [{ tranid: '126500', trandate: '2026-09-01' }] });
  const nn = noNote.written.find((r) => String(r.internalId) === '2915')
    ?.lots.find((l) => l.lotNo === '316027-12')?.orders.find((o) => o.soNumber === 'SO-CWP-001360');
  ok('I13 no system note means ticked at creation: the order date', nn?.readySince === '2026-09-01', nn && nn.readySince);
  ok('I14 no price row means an em dash, not a zero', nn?.bfPrice === null && bfPriceText(nn) === NO_VALUE, nn && nn.bfPrice);

  // The notes could not be read: no date, never the order's age.
  const badNote = runMr({ rtsRows: [{ tranid: '126500', trandate: '2026-09-01' }], noteThrows: true });
  const bn = badNote.written.find((r) => String(r.internalId) === '2915')
    ?.lots.find((l) => l.lotNo === '316027-12')?.orders.find((o) => o.soNumber === 'SO-CWP-001360');
  ok('I15 an unreadable system note gives NO date, not the order date',
    bn?.readySince === '' && daysReady(bn) === null, bn && bn.readySince);
  ok('I16 ...and says so in the log, at audit', badNote.audits.some((a) => /Ready to Ship dates not readable/.test(a)));

  // The field could not be read: the order stays where it was, still deducted.
  const badFlag = runMr({ flagIds: ['126500'], rtsThrows: true });
  const bf = badFlag.written.find((r) => String(r.internalId) === '2915');
  ok('I17 an unreadable Ready to Ship field leaves the order in Ready to Build, still deducted',
    !!bf && Math.round(bf.outbound) === 0 && Math.round(bf.readyToBuild) === 640 && Math.round(bf.available) === 1360,
    bf && [bf.outbound, bf.readyToBuild, bf.available]);
  ok('I18 ...and logs it at audit, not error', badFlag.audits.some((a) => /Ready to Ship field not readable/.test(a)) &&
    badFlag.errors.length === 0, badFlag.errors);
}

/* ════ J. Ship Week on the lot drawer's orders (Feedback 13) ═══════════════════
 * SO-CWP-001344 (126449) gets a hand-set Monday week; SO-CWP-001360 (126500) an
 * import-day week with an order-date ship date, i.e. both defaults. */
{
  const res = runMr({ shipWeekRows: [
    { tranid: '126449', sw: '2026-09-28', sd: '2026-08-20', td: '2026-08-20', cd: '2026-08-20' },
    { tranid: '126500', sw: '2026-09-18', sd: '2026-09-01', td: '2026-09-01', cd: '2026-09-18' },
  ] });
  const held = res.written.find((r) => String(r.internalId) === '2915')?.lots.find((l) => l.lotNo === '316027-12');
  const o = (n) => (held?.orders || []).find((x) => x.soNumber === n) || {};
  ok('J1 a hand-set Ship Week reaches the payload, source week',
    o('SO-CWP-001344').shipDate === '2026-09-28' && o('SO-CWP-001344').shipDateSource === 'week', o('SO-CWP-001344'));
  ok('J2 two defaults give no date, flagged defaulted, and the cell says why',
    o('SO-CWP-001360').shipDate === '' && o('SO-CWP-001360').shipDateDefaulted === true &&
    shipWeekCell(o('SO-CWP-001360').shipDate, o('SO-CWP-001360').created, undefined, o('SO-CWP-001360').shipDateDefaulted).title,
    o('SO-CWP-001360'));
  ok('J3 the ship week is its own read, not a BUCKET_SQL column change',
    res.sqlLog.some((q) => /custbody_ship_week/.test(q) && /FROM transaction WHERE id IN/.test(q)));
  const bad = runMr({ shipWeekThrows: true });
  const bh = bad.written.find((r) => String(r.internalId) === '2915')?.lots.find((l) => l.lotNo === '316027-12');
  const b1344 = (bh?.orders || []).find((x) => x.soNumber === 'SO-CWP-001344') || {};
  ok('J4 an unreadable Ship Week falls back to the ship date rule, logged at audit',
    b1344.shipDate === '' && b1344.shipDateDefaulted === true &&
    bad.audits.some((a) => /ship week not readable/.test(a)) && bad.errors.length === 0, [b1344, bad.errors]);
}

console.log(fail ? ('# FAIL ' + fail) : '# archLotOrders ok');
if (fail) process.exitCode = 1;
