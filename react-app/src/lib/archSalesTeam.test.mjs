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
const log = { audit: (t, m) => audits.push(t + ' ' + m), error: () => {}, debug: () => {} };

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

console.log(fail ? ('# FAIL ' + fail) : '# archSalesTeam ok');
process.exit(fail ? 1 : 0);
