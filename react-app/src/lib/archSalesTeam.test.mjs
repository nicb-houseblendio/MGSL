// archSalesTeam.js (SuiteScript, AMD) loaded through a four-line define shim.
// The pick rule and the id sanitising are pure; the query is a recorded fake.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts', 'mcgi_services', 'trader_screen', 'shared', 'archSalesTeam.js');

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const queries = [];
let canned = [];
const query = { runSuiteQL: ({ query: sql }) => { queries.push(sql); return { asMappedResults: () => canned }; } };
const audits = [];
const errors = [];
const log = { audit: (t, m) => audits.push(t + ' ' + m), error: (t, m) => errors.push(t + ' ' + m), debug: () => {} };

let mod = null;
const define = (deps, factory) => {
  ok('module declares exactly N/query and N/log', JSON.stringify(deps) === JSON.stringify(['N/query', 'N/log']), deps);
  mod = factory(query, log);
};
new Function('define', fs.readFileSync(FILE, 'utf8'))(define);
ok('module loaded with repByTransaction and pickRep', !!mod && typeof mod.repByTransaction === 'function' && typeof mod.pickRep === 'function');

const { pickRep, repByTransaction } = mod;

// ── pickRep: the rule ──────────────────────────────────────────────────────────
ok('no members -> null', pickRep([]) === null && pickRep(null) === null);

let p = pickRep([{ repid: '2084', rep: 'Christian Labbé', contribution: '1', isprimary: 'F' }]);
ok('single member is the rep', p.repId === '2084' && p.rep === 'Christian Labbé', p);
ok('single member: not shared, not tied', p.shared === false && p.tied === false && p.memberCount === 1, p);

// SO-CWP-001352 as measured: two reps at 0.5, no primary
p = pickRep([
  { repid: '2094', rep: 'Samuel Nadon', contribution: '0.5', isprimary: 'F' },
  { repid: '2090', rep: 'Justin Loveland', contribution: '0.5', isprimary: 'F' },
]);
ok('50/50 tie goes to the LOWEST employee id regardless of row order', p.repId === '2090' && p.rep === 'Justin Loveland', p);
ok('50/50 is flagged shared AND tied', p.shared === true && p.tied === true && p.memberCount === 2, p);

p = pickRep([
  { repid: '10', rep: 'Minor', contribution: '0.3', isprimary: 'F' },
  { repid: '20', rep: 'Major', contribution: '0.7', isprimary: 'F' },
]);
ok('unequal split: highest contribution wins', p.repId === '20' && p.rep === 'Major', p);
ok('unequal split: shared but not tied', p.shared === true && p.tied === false, p);

p = pickRep([
  { repid: '10', rep: 'Big Share', contribution: '0.9', isprimary: 'F' },
  { repid: '20', rep: 'Primary', contribution: '0.1', isprimary: 'T' },
]);
ok('a primary flag beats a larger contribution', p.repId === '20' && p.rep === 'Primary' && p.tied === false, p);

p = pickRep([{ repid: '7', rep: 'X', contribution: null, isprimary: null }]);
ok('null contribution/isprimary do not throw', p.repId === '7', p);

// ── repByTransaction: sanitising and grouping ─────────────────────────────────
queries.length = 0;
let out = repByTransaction([]);
ok('empty input runs no query', queries.length === 0 && Object.keys(out).length === 0);

queries.length = 0;
canned = [
  { tranid: '126664', repid: '2094', rep: 'Samuel Nadon', contribution: '0.5', isprimary: 'F' },
  { tranid: '126664', repid: '2090', rep: 'Justin Loveland', contribution: '0.5', isprimary: 'F' },
  { tranid: '126868', repid: '2084', rep: 'Christian Labbé', contribution: '1', isprimary: 'F' },
];
out = repByTransaction(['126664', 126868, '126664', 'abc', '', null, '-5', '0', "1 OR 1=1"]);
ok('one query for a small id set', queries.length === 1, queries.length);
const inList = (queries[0].match(/IN \(([^)]*)\)/) || [])[1] || '';
ok('IN list holds only positive integers, deduplicated, nothing else', inList === '126664,126868' || inList === '126868,126664', inList);
ok('injection-shaped and non-numeric ids are dropped, not passed through', !/OR|abc|-5/.test(queries[0]), queries[0]);
ok('grouped by transaction: 126664 -> Justin Loveland (tied), 126868 -> Christian Labbé',
  out['126664'] && out['126664'].rep === 'Justin Loveland' && out['126664'].tied === true &&
  out['126868'] && out['126868'].rep === 'Christian Labbé' && out['126868'].shared === false, out);
ok('an id with no sublist rows is simply absent', out['999'] === undefined);
ok('a tie is audited once, not per row', audits.filter((a) => /split evenly/.test(a)).length === 1, audits);

// chunking: 1,200 ids -> 3 queries, none over 500 ids
queries.length = 0; canned = [];
repByTransaction(Array.from({ length: 1200 }, (_, i) => String(1000 + i)));
ok('1,200 ids are sent in 3 chunks', queries.length === 3, queries.length);
ok('no chunk exceeds 500 ids', queries.every((q) => ((q.match(/IN \(([^)]*)\)/) || [])[1] || '').split(',').length <= 500));

// ── 2026-09-08 evening, three more defects in the morning's version ──────────────
// D8 `tied` was gated on `!primaries.length`, so two PRIMARIES splitting evenly were
//    reported as a clean single attribution. And `rivals` was counted over `members`
//    while `best` came from `pool`, i.e. two different sets.
let tp = pickRep([
  { repid: '2090', rep: 'A', contribution: '0.5', isprimary: 'T' },
  { repid: '2094', rep: 'B', contribution: '0.5', isprimary: 'T' },
]);
ok('two primaries at 50/50 are reported TIED', tp.tied === true, tp);
ok('two primaries at 50/50 still pick the lowest id', tp.repId === '2090', tp);
tp = pickRep([
  { repid: '10', rep: 'Primary small', contribution: '0.1', isprimary: 'T' },
  { repid: '20', rep: 'Big non-primary', contribution: '0.9', isprimary: 'F' },
]);
ok('one primary against a bigger non-primary is NOT tied', tp.tied === false && tp.repId === '10', tp);

// D6 a rep whose id resolves but whose NAME the caller's role cannot read. SuiteQL
//    omits null columns, so `rep` arrives undefined. Reporting a blank name let the
//    service fall through to the header rep and group under "Unassigned" while Edit
//    pre-selected the id.
const nameless = pickRep([{ repid: '2094', contribution: '1', isprimary: 'F' }]);
ok('an unreadable name still yields a usable label, not an empty string', !!nameless.rep && nameless.rep !== '', nameless);
ok('and is flagged so the caller need not guess', nameless.nameUnreadable === true, nameless);
ok('a readable name is not flagged', pickRep([{ repid: '1', rep: 'Real Name', contribution: '1' }]).nameUnreadable === false);

// D5 one failing chunk discarded every chunk that had already succeeded, and the whole
//    tab reverted to "Unassigned".
let call = 0;
const flaky = {
  runSuiteQL: ({ query: sql }) => {
    call++;
    if (call === 2) throw new Error('SSS_REQUEST_TIME_EXCEEDED');
    return { asMappedResults: () => [{ tranid: '5001', repid: '77', rep: 'Survivor', contribution: '1', isprimary: 'F' }] };
  },
};
let mod2 = null;
new Function('define', fs.readFileSync(FILE, 'utf8'))((deps, factory) => { mod2 = factory(flaky, log); });
call = 0;
const partial = mod2.repByTransaction(Array.from({ length: 600 }, (_, i) => String(5000 + i)));
ok('a mid-run chunk failure does not throw', true);
ok('and the chunk that succeeded is still returned', partial['5001'] && partial['5001'].rep === 'Survivor', partial);
ok('the failed chunk is logged at ERROR', errors.filter((e) => /chunk read failed/.test(e)).length === 1, errors);
ok('and the partial result is called out at ERROR, not buried in an audit line',
  errors.filter((e) => /PARTIAL read/.test(e)).length === 1 && audits.filter((a) => /PARTIAL read/.test(a)).length === 0,
  { errors, audits });
ok('the partial-read message says it is partial, not empty', errors.some((e) => /partial result, not an empty one/.test(e)), errors);

console.log(fail ? ('# FAIL ' + fail) : '# archSalesTeam ok');
process.exit(fail ? 1 : 0);
