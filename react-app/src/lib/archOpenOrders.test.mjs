// trader_screen_service_arch.js handleGetOpenOrders, loaded through an AMD shim
// with every dependency faked. What this pins:
//   A. the trader comes from the Sales Team sublist, not the (null) header rep
//   B. traderId is set from it, so the wizard's rep dropdown pre-selects on Edit
//   C. createdBy is returned alongside, and is NOT what trader shows
//   D. no fan-out: a two-rep order keeps its line count, and the line query
//      never mentions the sublist table
//   E. fallbacks: header rep when the sublist is empty, "Unassigned" when both are
//   F. (2026-09-08) the attribution is REPORTED, not just guessed at: every order
//      says where its rep came from, and the response carries counts plus the role
//      the RESTlet actually ran as, so "Unassigned everywhere" cannot be silent
//   G. (2026-09-08) the customer list excludes the industrial companies (Lucas)
//   H. (2026-09-08) Setup > Sales Team is readable as TEMPLATES, read only, and an
//      empty or partial read says so instead of looking like an empty account
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

/* Customers, for the industrial-company exclusion. Subsidiary is the marker:
 * `customer.category` is NULL on all 807 active customers and there is no custom
 * division field, so subsidiary 7 (IND, "CWP Industriel Inc.") is what identifies
 * the group Lucas named. Measured 2026-09-08: 5 -> 387, 7 -> 342, 21 -> 53,
 * 1 -> 24, 2 -> 1. The null-subsidiary row is defensive, not measured. */
const cust = (id, name, subsidiaryid, subsidiaryname) => ({
  id, companyname: name, entityid: name,
  currencyid: '1', currencycode: 'USD', currencyname: 'US Dollar',
  termsid: '4', termsname: 'Net 30',
  subsidiaryid, subsidiaryname,
});
const CUSTOMER_ROWS = [
  cust('2853', 'County Line Materials LLC', '5', 'CWP MTL'),
  cust('900', 'Industriel Client One', '7', 'IND'),
  cust('901', 'Industriel Client Two', '7', 'IND'),
  cust('902', 'WPRED Client', '21', 'WPRED'),
  cust('903', 'Subsidiary-less Client', null, null),
];

/* Setup > Sales Team, i.e. the `entitygroup` TEMPLATES, in the fan-out shape the
 * query returns. Measured in the sandbox 2026-09-08: 44 active teams, 82 member
 * rows, `g.size` equal to the real member count on all 44, contributions summing
 * to exactly 1 on all 44, and "Sam/Justin" = Samuel Nadon 0.5 / Justin Loveland
 * 0.5, which is byte for byte what SO-CWP-001352 stores in its
 * `transactionsalesteam`. The template/instance relationship is measured, not
 * assumed. The last three rows are shaped for the ROLE problem and were NOT
 * observed as Administrator. */
const TEAM_GROUP_ROWS = [
  { teamid: '2805', teamname: 'Sam/Justin', declaredsize: '2', repid: '2094', repname: 'Samuel Nadon', repdf: 'Samuel Nadon', contribution: '0.5', isprimary: 'F' },
  { teamid: '2805', teamname: 'Sam/Justin', declaredsize: '2', repid: '2090', repname: 'Justin Loveland', repdf: 'Justin Loveland', contribution: '0.5', isprimary: 'F' },
  { teamid: '2810', teamname: 'Chris/Tom', declaredsize: '2', repid: '2084', repname: 'Christian Labbé', repdf: 'Christian Labbé', contribution: '0.7', isprimary: 'T' },
  // A member whose id resolves but whose NAME neither column returns. SuiteQL
  // omits a null column from the row entirely, so both keys are simply absent.
  { teamid: '2810', teamname: 'Chris/Tom', declaredsize: '2', repid: '2099', contribution: '0.3', isprimary: 'F' },
  // The group says 3 members; only one row came back, i.e. two were withheld.
  { teamid: '2820', teamname: 'Rettenmeier/James', declaredsize: '3', repid: '2085', repname: 'Camil Perrault', repdf: 'Camil Perrault', contribution: '1', isprimary: 'F' },
  // The LEFT JOIN row for a team whose members are entirely unreadable.
  { teamid: '2830', teamname: 'Ghost Team', declaredsize: '1' },
];

// ── fakes ──────────────────────────────────────────────────────────────────────
const sqlLog = [];
let customerRows = CUSTOMER_ROWS;
let teamGroupRows = TEAM_GROUP_ROWS;
const query = {
  runSuiteQL: ({ query: sql }) => {
    sqlLog.push(sql);
    let rows;
    if (/FROM transactionsalesteam/.test(sql)) rows = TEAM_ROWS;
    else if (/FROM transactionline tl/.test(sql) && /otherrefnum/.test(sql)) rows = OPEN_ROWS;
    else if (/COUNT\(\*\) AS n FROM item/.test(sql)) rows = [{ n: '6' }];
    else if (/FROM customer c/.test(sql)) rows = customerRows;
    else if (/FROM entitygroup g/.test(sql)) rows = teamGroupRows;
    else if (/FROM role\b/.test(sql)) rows = [{ name: 'MGSL - CWP ARC - Trader' }];
    else rows = [];
    return { asMappedResults: () => rows };
  },
};
const log = { audit: () => {}, error: (t, m) => { throw new Error('log.error called: ' + t + ' ' + m); }, debug: () => {} };
// A log that RECORDS instead of throwing, for the paths where an error line is the
// point rather than the accident.
const recording = () => {
  const errors = [];
  const audits = [];
  return { errors, audits, log: { audit: (t, m) => audits.push(t + ' ' + m), error: (t, m) => errors.push(t + ' ' + m), debug: () => {} } };
};
/* The real caller. A RESTlet ignores runasrole and runs as the CALLER, so the role
 * here is the one whose permissions decide whether the sublist is readable at all
 * (2181 "MGSL - CWP ARC - Trader", held by employee 3293 "Trader Hardwood"). */
const runtime = {
  getCurrentScript: () => ({ getParameter: () => null }),
  getCurrentUser: () => ({ id: 3293, role: 2181, roleId: 'customrole2181' }),
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
// Snapshotted HERE, before the failure runs below pollute the shared log: the role
// name costs a query and must be resolved only when there is a problem to diagnose.
const roleQueriesOnHealthyRun = sqlLog.filter((s) => /FROM role\b/.test(s)).length;
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
const rec2 = recording();
const service2 = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': rec2.log, 'N/query': query,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': brokenTeam,
})[d]);
const res2 = service2.getRouter({ action: 'openOrders' });
ok('a failing sublist read degrades to the header rep instead of failing the tab', res2.success === true && res2.orders.length === 4 && res2.orders.every((o) => o.trader === 'Unassigned' || o.trader === 'Header Rep'), res2.orders && res2.orders.map((o) => o.trader));

/* ── F. the attribution has to be REPORTED ────────────────────────────────────
 *
 * 🔴 THE FAILURE MODE THIS PINS IS INVISIBLE. The sublist is read inside a
 * RESTlet, a RESTlet ignores runasrole and runs as the CALLER, and
 * archOrderCreate.js:668 records an ARCH trader role that could not read the
 * `employee` table at all. If the sublist comes back empty under the role a real
 * trader holds, every row prints "Unassigned" and the tab looks like an account
 * with no reps on it, which is EXACTLY the symptom Marc-Antoine reported. A fix
 * that can regress into the identical symptom without saying so is not a fix. */
const att = res.traderAttribution;
ok('F: the response carries a traderAttribution block', !!att, att);
ok('F: it counts the orders it is describing', att && att.orders === 4, att);
ok('F: two orders got their rep from the Sales Team sublist', att && att.fromSalesTeam === 2, att);
ok('F: one fell back to the header rep', att && att.fromHeader === 1, att);
ok('F: one has neither, and is counted as unattributed rather than just printed as Unassigned',
  att && att.unattributed === 1, att);
ok('F: a successful read says so', att && att.salesTeamRead === 'ok' && att.salesTeamError === '', att);
ok('F: nothing is null or undefined in the block a banner will render',
  att && Object.keys(att).every((k) => att[k] !== null && att[k] !== undefined), att);

ok('F: each order says WHERE its rep came from (sublist)',
  by['SO-CWP-001352'].traderSource === 'salesTeam' && by['SO-CWP-001354'].traderSource === 'salesTeam',
  [by['SO-CWP-001352'].traderSource, by['SO-CWP-001354'].traderSource]);
ok('F: and when it came from the header', by['SO-CWP-001399'].traderSource === 'header', by['SO-CWP-001399'].traderSource);
ok('F: and when there is nothing behind the word Unassigned', by['SO-CWP-001400'].traderSource === 'none', by['SO-CWP-001400'].traderSource);

// The role name costs a query, so it is resolved ONLY when there is a problem to
// diagnose. A healthy tab must not pay for it on every load.
ok('F: a healthy read does NOT query the role table', roleQueriesOnHealthyRun === 0, roleQueriesOnHealthyRun);
ok('F: and reports no role label it did not look up', att && att.roleLabel === '', att && att.roleLabel);

const att2 = res2.traderAttribution;
ok('F: a thrown sublist read is reported as FAILED, not as "no reps found"',
  att2 && att2.salesTeamRead === 'failed', att2);
ok('F: and carries what NetSuite said, which is the only way to tell a permission problem from a timeout',
  att2 && /SSS_MISSING_REQD_ARGUMENT/.test(att2.salesTeamError), att2);
/* The field is unchanged and so is this assertion; only its DESCRIPTION was wrong.
 * `currentRoleLabel` resolves from `runtime.getCurrentUser()`, which reports the
 * CALLER on either transport, never the `runasrole` a Suitelet reads under. Since
 * 2026-09-10 openOrders is served by the order Suitelet first, so on that leg this
 * names who ASKED, not who read, and the client says so per leg. Calling it "the
 * role the RESTlet ran as" would keep a false claim alive in a passing test. */
ok('F: and NAMES the CALLER role, which is the first thing to check on the RESTlet leg',
  att2 && att2.roleLabel === 'MGSL - CWP ARC - Trader (2181)', att2 && att2.roleLabel);
ok('F: a total failure is logged at ERROR, not buried in an audit line',
  rec2.errors.some((e) => /sales team/i.test(e)) && !rec2.audits.some((a) => /sales team/i.test(a)),
  { errors: rec2.errors, audits: rec2.audits });

// A rep whose id resolves but whose NAME the role cannot read: the tab shows
// "Employee 2094" and has to be able to say that is what happened.
const namelessTeam = {
  repByTransaction: () => ({
    126664: { repId: '2094', rep: 'Employee 2094', nameUnreadable: true, shared: false, tied: false },
  }),
};
const rec4 = recording();
const service4 = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': rec4.log, 'N/query': query,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': namelessTeam,
})[d]);
const res4 = service4.getRouter({ action: 'openOrders' });
const o4 = res4.orders.find((o) => o.soNo === 'SO-CWP-001352');
ok('F: an unreadable rep name is flagged on the order', o4 && o4.traderNameUnreadable === true, o4 && o4.traderNameUnreadable);
ok('F: a readable one is not', res4.orders.every((o) => o.soNo === 'SO-CWP-001352' || o.traderNameUnreadable === false));
ok('F: and it is counted in the block', (res4.traderAttribution || {}).namesUnreadable === 1, res4.traderAttribution);

/* ── G. the industrial companies are out of the customer picker ───────────────
 *
 * Lucas, 2026-09-08: "Need to filter out the industrial companies from the SO".
 * The marker is the SUBSIDIARY, because `customer.category` is NULL on all 807
 * active customers and no custom division field exists. Subsidiary 7 is IND
 * ("CWP Industriel Inc."), 342 of the 807. */
sqlLog.length = 0;
const resC = service.getRouter({ action: 'customers' });
ok('G: customers succeeds', resC && resC.success === true, resC && resC.error);
const custIds = (resC.customers || []).map((c) => c.id);
ok('G: an industrial customer is ABSENT', !custIds.includes('900') && !custIds.includes('901'), custIds);
ok('G: a CWP MTL customer is still PRESENT', custIds.includes('2853'), custIds);
ok('G: the filter is not over-broad: WPRED and MGSL customers survive', custIds.includes('902'), custIds);
ok('G: a customer with NO subsidiary is kept, not swept up by the exclusion', custIds.includes('903'), custIds);
ok('G: how many were removed is reported', resC.excludedIndustrialCount === 2, resC.excludedIndustrialCount);
ok('G: and which subsidiary did it, by id and by its own name rather than a hardcoded label',
  resC.excludedSubsidiaryId === '7' && resC.excludedSubsidiaryName === 'IND', resC);
ok('G: the pre-filter total is reported too, so an over-broad filter cannot hide',
  resC.totalActiveCount === 5, resC.totalActiveCount);
/* The list is STILL not scoped to a subsidiary. Subsidiary 9 (ARC) holds zero
 * customers, so scoping on the request would empty the picker; that reasoning is
 * unchanged and the exclusion is a narrower, client-named thing. */
const custSql = sqlLog.find((s) => /FROM customer c/.test(s)) || '';
ok('G: the query still is not scoped to a subsidiary (that would return an empty picker)',
  custSql && !/c\.subsidiary\s*=/.test(custSql) && !/c\.subsidiary\s+IN/i.test(custSql), custSql);
ok('G: and it asks for the subsidiary name, so the exclusion can describe itself',
  /BUILTIN\.DF\(c\.subsidiary\)/.test(custSql), custSql);

// An exclusion that empties the whole picker is a defect, not a quiet day.
const recC = recording();
const serviceC = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': recC.log, 'N/query': query,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': team,
})[d]);
customerRows = [cust('900', 'Industriel Client One', '7', 'IND')];
const resC2 = serviceC.getRouter({ action: 'customers' });
customerRows = CUSTOMER_ROWS;
ok('G: excluding everything still succeeds rather than throwing', resC2.success === true, resC2);
ok('G: but leaves the counts that explain the empty picker',
  resC2.customers.length === 0 && resC2.totalActiveCount === 1 && resC2.excludedIndustrialCount === 1, resC2);
ok('G: and is logged at ERROR, because a filter that removes every row is a defect',
  recC.errors.some((e) => /custom/i.test(e)), recC.errors);

// The comment above handleGetCustomers explained why the list is NOT scoped by
// subsidiary. Adding an exclusion on top of that reads as a reversal unless the
// note is updated, so pin that it was.
const serviceSrc = fs.readFileSync(SERVICE, 'utf8');
ok('G: the source records who asked and what was measured', /Lucas/.test(serviceSrc) && /342/.test(serviceSrc) && /465/.test(serviceSrc));
ok('G: the excluded subsidiary is a named constant, not a bare 7',
  /INDUSTRIAL_CUSTOMER_SUBSIDIARY\s*=\s*7/.test(serviceSrc), false);

/* ── H. Setup > Sales Team, the templates behind the transaction sublist ───────
 *
 * "Sales Team : Ça ne semble pas feeder de la bonne affaire : On veut les teams
 * qui sont dela page (Setup > sales team)" — Marc-Antoine, 2026-09-08. That page
 * is `entitygroup` with issalesrep = 'T', and the percentages are
 * `entitygroupmember.contribution`.
 *
 * READ ONLY. Nothing here posts a multi-member sales team onto a real order:
 * that attributes commission on real sales documents and needs an explicit
 * go-ahead. The last assertions in this section pin that. */
sqlLog.length = 0;
const resT = service.getRouter({ action: 'salesTeams' });
ok('H: salesTeams succeeds', resT && resT.success === true, resT && resT.error);
const teams = (resT && resT.salesTeams) || [];
const byTeam = Object.fromEntries(teams.map((t) => [t.name, t]));

// The query fans out per member, exactly like the open-orders one. Six rows, four teams.
ok('H: six member rows collapse to four teams, not six', teams.length === 4, teams.map((t) => t.name));
ok('H: one query, not one per team', sqlLog.filter((s) => /FROM entitygroup g/.test(s)).length === 1, sqlLog.length);

const sj = byTeam['Sam/Justin'];
ok('H: Sam/Justin has both members', sj && sj.members.length === 2, sj);
ok('H: with the ids the write path would need', sj && sj.members.map((m) => m.id).sort().join(',') === '2090,2094', sj && sj.members);
ok('H: and the names a person reads', sj && sj.members.map((m) => m.name).sort().join('|') === 'Justin Loveland|Samuel Nadon', sj && sj.members);
/* 🔴 THE PERCENT TRAP, which has cost this project a real bug before: SuiteQL
 * returns a Percent as a FRACTION while setValue takes the typed number. Both are
 * returned under names that say which, so the boundary cannot be guessed wrong. */
ok('H: contribution is the stored FRACTION, as a number', sj && sj.members.every((m) => m.contribution === 0.5), sj && sj.members);
ok('H: contributionPct is the typed number a setValue would take', sj && sj.members.every((m) => m.contributionPct === 50), sj && sj.members);
ok('H: neither is a string', sj && sj.members.every((m) => typeof m.contribution === 'number' && typeof m.contributionPct === 'number'));
ok('H: the team id is carried', sj && sj.id === '2805', sj && sj.id);
ok('H: teams come back in name order', teams.map((t) => t.name).join('|') === 'Chris/Tom|Ghost Team|Rettenmeier/James|Sam/Justin', teams.map((t) => t.name));

const ct = byTeam['Chris/Tom'];
ok('H: isPrimary is a boolean, not the raw T/F', ct && ct.members.some((m) => m.isPrimary === true) && ct.members.some((m) => m.isPrimary === false), ct && ct.members);
/* A member the role can identify but not NAME. Printing '' would put a blank line
 * in the picker and printing "null" would be worse; the same rule as
 * archSalesTeam.pickRep, so the two agree. */
const nameless = ct && ct.members.find((m) => m.id === '2099');
ok('H: an unreadable member name still yields a usable label', nameless && nameless.name === 'Employee 2099', nameless);
ok('H: and never prints null, undefined or an empty string',
  teams.every((t) => t.members.every((m) => m.name && !/null|undefined/.test(m.name))), teams);
ok('H: the team flags that one of its names was unreadable', ct && ct.nameUnreadableCount === 1, ct);
ok('H: a team whose names all resolved is not flagged', sj && sj.nameUnreadableCount === 0, sj);

/* `g.size` is the group's OWN member count, and it matched the real one on all 44
 * teams as Administrator. So a shortfall is proof that members were withheld from
 * this caller rather than a team simply being small. That is the cheapest
 * possible check on the role problem and it costs no extra query. */
const rj = byTeam['Rettenmeier/James'];
ok('H: a team that returned fewer members than it declares is flagged',
  rj && rj.memberCount === 1 && rj.declaredSize === 3 && rj.membersUnreadable === true, rj);
ok('H: a complete team is not flagged', sj && sj.membersUnreadable === false && sj.declaredSize === 2, sj);

/* LEFT JOIN, so a team with no readable members is reported as a team with no
 * members. An inner join would have made it vanish from the picker, which is the
 * silent version of the same failure. */
const ghost = byTeam['Ghost Team'];
ok('H: a team with no readable members is still LISTED, with an empty member array',
  ghost && Array.isArray(ghost.members) && ghost.members.length === 0, ghost);
ok('H: and is flagged rather than looking like a legitimately empty team',
  ghost && ghost.membersUnreadable === true, ghost);

// The SQL itself: the reserved word, and the three filters that define the page.
const groupSql = sqlLog.find((s) => /FROM entitygroup g/.test(s)) || '';
ok('H: `group` is quoted, because it is a reserved word', groupSql.includes('m."group"'), groupSql);
/* 🔴 NO grouptype clause, and the assertion is INVERTED from what it first pinned.
 * `grouptype` works through the REST query endpoint but is a record join inside
 * N/query, so the DEPLOYED endpoint failed with "Record Join 'grouptype' for record
 * 'EntityGroup' was not found" while this shim passed. Same class as
 * transaction.status differing between the two dialects. Measured: issalesrep +
 * isinactive returns the same 44 teams, and all 44 are Employee groups anyway, so
 * the clause excluded nothing. Pinned OUT so it cannot be reintroduced. */
ok('H: scoped to the Sales Team page: issalesrep and active only',
  /issalesrep\s*=\s*'T'/.test(groupSql) && /g\.isinactive\s*=\s*'F'/.test(groupSql), groupSql);
ok('H: and NOT by grouptype, which N/query rejects as a record join',
  !/grouptype/.test(groupSql), groupSql);
ok('H: inactive MEMBERS are excluded in the JOIN, not the WHERE (a WHERE drops the team too)',
  /LEFT JOIN entitygroupmember m ON[^)]*m\.isinactive\s*=\s*'F'/.test(groupSql) &&
  !/WHERE[\s\S]*m\.isinactive/.test(groupSql), groupSql);
ok('H: the name is read from the member row AND resolved, so one unreadable path is survivable',
  /m\.name/.test(groupSql) && /BUILTIN\.DF\(m\.employeemember\)/.test(groupSql), groupSql);

// Counts travel with the response, the same contract as taggedItemCount.
// Five of the six rows carry a member id; the sixth is Ghost Team's LEFT JOIN row.
ok('H: the response reports what it read', resT.teamCount === 4 && resT.memberRowCount === 5, {
  teamCount: resT.teamCount, memberRowCount: resT.memberRowCount });
ok('H: and totals the degradation across teams',
  resT.teamsWithMissingMembers === 2 && resT.membersWithUnreadableNames === 1, resT);
ok('H: a partly-degraded read still names the role, because that is what to check first',
  resT.roleLabel === 'MGSL - CWP ARC - Trader (2181)', resT.roleLabel);

/* ⚠️ THE MEASURED RISK, and why this degrades loudly. All 44 teams sit in
 * subsidiary 1 (MGSL), while role 2181 is `subsidiaryoption` OWN and its holder
 * (employee 3293) sits in subsidiary 5. If `entitygroup` is subsidiary-scoped for
 * an OWN role, the trader sees ZERO teams and the wizard's picker is simply
 * empty. Empty must therefore be a statement, not a shrug. */
const recT = recording();
const serviceT = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': recT.log, 'N/query': query,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': team,
})[d]);
teamGroupRows = [];
const resT2 = serviceT.getRouter({ action: 'salesTeams' });
teamGroupRows = TEAM_GROUP_ROWS;
ok('H: an empty list still succeeds rather than throwing', resT2.success === true && resT2.salesTeams.length === 0, resT2);
ok('H: and says so in words, naming the role it ran as',
  typeof resT2.notice === 'string' && resT2.notice.includes('MGSL - CWP ARC - Trader (2181)'), resT2.notice);
ok('H: the notice does not claim the account has no sales teams',
  resT2.notice && !/no sales teams (exist|are set up)/i.test(resT2.notice), resT2.notice);
ok('H: an empty list is logged at ERROR, because 44 teams exist',
  recT.errors.some((e) => /sales team/i.test(e)), recT.errors);
ok('H: no em dashes in the notice, which is client-facing', resT2.notice && !resT2.notice.includes('—'), resT2.notice);

// A throwing query must not take the wizard down.
const throwing = {
  runSuiteQL: ({ query: sql }) => {
    if (/FROM entitygroup g/.test(sql)) throw new Error("Record 'entitygroup' was not found");
    return { asMappedResults: () => (/FROM role\b/.test(sql) ? [{ name: 'MGSL - CWP ARC - Trader' }] : []) };
  },
};
const recT3 = recording();
const serviceT3 = load(SERVICE, (d) => ({
  'N/runtime': runtime, 'N/log': recT3.log, 'N/query': throwing,
  '../shared/cacheKeys_arch': CacheKeysARCH, '../shared/cacheClient': CacheClient, '../shared/archSalesTeam': team,
})[d]);
let threw = false;
let resT3 = null;
try { resT3 = serviceT3.getRouter({ action: 'salesTeams' }); } catch (e) { threw = true; }
ok('H: a failing read returns an answer instead of throwing', threw === false, threw);
ok('H: and reports the failure rather than an empty list of teams',
  resT3 && resT3.success === false && /entitygroup/.test(resT3.error), resT3);
ok('H: an empty array is NOT offered alongside a failure, so nothing can render it as "no teams"',
  resT3 && resT3.salesTeams === undefined, resT3);
ok('H: and it is logged at ERROR', recT3.errors.some((e) => /sales team/i.test(e)), recT3.errors);

/* ── The write path is NOT wired, deliberately ────────────────────────────────*/
ok('H: the service still refuses every POST', service.postRouter().success === false);
ok('H: and nothing in it writes a sales team',
  !/record\.(create|load|submitFields)/.test(serviceSrc) &&
  !/setSublistValue|insertLine|salesteam.*setValue/i.test(serviceSrc), false);
ok('H: the source says the read side is deliberate and the write side is not authorised',
  /READ ONLY/.test(serviceSrc) && /commission/i.test(serviceSrc), false);

console.log(fail ? ('# FAIL ' + fail) : '# archOpenOrders ok');
process.exit(fail ? 1 : 0);
