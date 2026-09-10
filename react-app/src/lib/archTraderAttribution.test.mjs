// archTraderAttribution.ts — turns "Unassigned on every row" from a silent
// display state into something the tab says out loud.
//
// WHY THIS EXISTS. The Open Orders tab reads the sales rep off the
// `transactionsalesteam` sublist. That read happens inside a RESTlet; a RESTlet
// IGNORES runasrole and runs as the CALLER; and `archOrderCreate.js:668` records
// that an ARCH trader role once could not read the employee table at all. If the
// sublist read comes back empty for the actual users, every row prints
// "Unassigned" and looks like an account with no sales reps on it. That is the
// exact symptom Marc-Antoine reported on 2026-09-08, and a fix that can regress
// into the identical symptom without saying so is not a fix.
import { traderAttributionNotice, deriveTraderAttribution, UNASSIGNED } from './archTraderAttribution.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const base = {
  source: 'netsuite',
  orderCount: 4,
  unattributedCount: 0,
  namesUnreadable: 0,
  salesTeamRead: 'ok',
  salesTeamError: '',
  roleLabel: 'MGSL - CWP ARC - Trader (2181)',
};

// ── silent when there is nothing to say ───────────────────────────────────────
ok('everything attributed -> no notice', traderAttributionNotice(base) === null, traderAttributionNotice(base));
// The demo banner and the live-and-empty banner already speak for these two, and
// a second banner underneath would be noise.
ok('fixtures -> no notice (the demo banner already says the data is invented)',
  traderAttributionNotice({ ...base, source: 'fixtures', unattributedCount: 4 }) === null);
ok('loading -> no notice', traderAttributionNotice({ ...base, source: 'loading', unattributedCount: 4 }) === null);
ok('no orders -> no notice (the tagging banner already says why it is empty)',
  traderAttributionNotice({ ...base, orderCount: 0, unattributedCount: 0 }) === null);

// ── the reported symptom: nobody attributed anywhere ──────────────────────────
/*
 * `transport: 'restlet'` is stated explicitly so this case SAYS which leg it is
 * about. Be honest about what that annotation does: nothing, mechanically. An
 * unstated transport already falls through to the RESTlet wording, so deleting it
 * leaves every assertion below passing. It is documentation, not a fixture.
 *
 * The default it makes explicit is pinned separately, at the end of this block,
 * because it IS load-bearing: every caller in the codebase that has not been
 * taught about transports depends on it.
 *
 * 🔴 What is not cosmetic is the endpoint case further down. This one asserts the
 * sentence "a RESTlet ignores runasrole and runs as the caller", and now that
 * openOrders is served by the order Suitelet first, that sentence is false on the
 * leg that usually answers. Without a counterweight this assertion would go on
 * holding a false claim in place, passing the whole time.
 */
let n = traderAttributionNotice({ ...base, transport: 'restlet', unattributedCount: 4 });
ok('every order unattributed -> a notice at ERROR level', n && n.level === 'error', n);
ok('and it counts them', n && n.lines.join(' ').includes('4 orders'), n);
ok('and it says the column is UNREAD, not empty', n && /unread/i.test(n.lines.join(' ')), n);
ok('and it names the role the RESTlet actually ran as', n && n.lines.join(' ').includes('MGSL - CWP ARC - Trader (2181)'), n);
ok('and it explains that a RESTlet runs as the caller', n && /runasrole/.test(n.lines.join(' ')), n);
ok('and it says Created by is unaffected, so the trader knows what IS trustworthy',
  n && /Created by/.test(n.lines.join(' ')), n);
ok('no em dashes in anything shown to the client', n && !n.lines.join(' ').includes('—'), n);
ok('nothing prints null or undefined', n && !/null|undefined/.test(n.lines.join(' ')), n);

/* ── the SAME failure, served by the order endpoint instead ───────────────────
 *
 * 🔴 The whole notice exists to tell someone WHICH ROLE to go and audit. On the
 * endpoint leg `roleLabel` is the wrong answer to that question: the service
 * resolves it from `runtime.getCurrentUser()`, which reports the CALLER even under
 * `runasrole`. Measured on this exact Suitelet, it reported callerRole 3 while
 * returning data scoped to 2184.
 *
 * This has already misled once for real. scriptnote for scripttype 6505 logged
 * "A RESTlet runs as the caller, so check that role first: administrator (3)" for
 * a failure that occurred under 2184. Sending someone to audit the wrong role is
 * worse than sending them nowhere.
 */
{
  const e = traderAttributionNotice({ ...base, transport: 'endpoint', unattributedCount: 4 });
  const t = e ? e.lines.join(' ') : '';
  ok('endpoint leg: still an ERROR notice, the severity does not depend on the leg',
    e && e.level === 'error', e);
  ok('endpoint leg: does NOT claim a RESTlet ran', e && !/A RESTlet ignores runasrole/.test(t), e);
  ok('endpoint leg: does NOT present the caller as the role that read',
    e && !/This request ran as/.test(t), e);
  ok('endpoint leg: says the read ran under a DIFFERENT role than the caller',
    e && /reads under its own role/.test(t), e);
  ok('endpoint leg: still names the caller, so the reader knows who asked',
    e && t.includes('MGSL - CWP ARC - Trader (2181)'), e);
  ok('endpoint leg: no em dashes', e && !t.includes('—'), e);
  ok('endpoint leg: nothing prints null or undefined', e && !/null|undefined/.test(t), e);

  const nm = traderAttributionNotice({ ...base, transport: 'endpoint', namesUnreadable: 2 });
  ok('endpoint leg: "this role" gets a real referent, since the named role is not the reading one',
    nm && /the order endpoint role cannot read/.test(nm.lines.join(' ')), nm);
  const nmR = traderAttributionNotice({ ...base, transport: 'restlet', namesUnreadable: 2 });
  ok('restlet leg: keeps "this role", which IS the reading role there',
    nmR && /this role cannot read/.test(nmR.lines.join(' ')), nmR);
}

/* The default that the explicit annotation above documents. Every existing caller
 * passes no transport, so this is the behaviour they actually get, and it must not
 * drift when a new leg is added. */
{
  const u = traderAttributionNotice({ ...base, unattributedCount: 4 });
  const r = traderAttributionNotice({ ...base, transport: 'restlet', unattributedCount: 4 });
  ok('an UNSTATED transport still gets the RESTlet wording, which is what every old caller relies on',
    u && r && u.lines.join(' ') === r.lines.join(' '), { u, r });
  ok('and it is genuinely the RESTlet wording, not merely equal to itself',
    u && /A RESTlet ignores runasrole/.test(u.lines.join(' ')), u);
}

// A single order is still the same failure, and reads as one.
n = traderAttributionNotice({ ...base, orderCount: 1, unattributedCount: 1 });
ok('one order, unattributed -> ERROR, singular', n && n.level === 'error' && /1 order\b/.test(n.lines.join(' ')) && !/1 orders/.test(n.lines.join(' ')), n);

// ── partial: some attributed, some not ────────────────────────────────────────
n = traderAttributionNotice({ ...base, unattributedCount: 1 });
ok('1 of 4 unattributed -> WARN, not error', n && n.level === 'warn', n);
ok('and it says which fraction', n && /1 of 4/.test(n.lines.join(' ')), n);
ok('a partial gap does not claim the read failed', n && !/failed/i.test(n.lines.join(' ')), n);

// ── the read itself threw ─────────────────────────────────────────────────────
n = traderAttributionNotice({
  ...base,
  unattributedCount: 4,
  salesTeamRead: 'failed',
  salesTeamError: "Record 'transactionsalesteam' was not found",
});
ok('a failed read -> ERROR', n && n.level === 'error', n);
ok('and it quotes what NetSuite said, which is the only way to tell a permission problem from an outage',
  n && n.lines.join(' ').includes("Record 'transactionsalesteam' was not found"), n);
ok('a failed read is reported as a failure, not as "no reps on the orders"',
  n && /failed/i.test(n.lines.join(' ')), n);
// A read that threw is a failure even if some orders happen to carry a header rep.
n = traderAttributionNotice({ ...base, unattributedCount: 0, salesTeamRead: 'failed', salesTeamError: 'SSS_REQUEST_TIME_EXCEEDED' });
ok('a failed read still reports even when the header rep covered every order', n && n.level === 'error', n);

// ── an id that resolves with an unreadable name ────────────────────────────────
n = traderAttributionNotice({ ...base, namesUnreadable: 2 });
ok('names unreadable, everything else fine -> WARN', n && n.level === 'warn', n);
ok('and it says they show as an employee id', n && /Employee/.test(n.lines.join(' ')), n);
n = traderAttributionNotice({ ...base, unattributedCount: 4, namesUnreadable: 2 });
ok('unreadable names ride along with the bigger error rather than replacing it',
  n && n.level === 'error' && n.lines.length >= 2 && /Employee/.test(n.lines.join(' ')), n);

// ── the service that has not been redeployed yet ──────────────────────────────
// `salesTeamRead` is absent from the currently deployed ARCH service, so the hook
// passes 'unknown'. The tab must still report the symptom it can see for itself.
n = traderAttributionNotice({ source: 'netsuite', orderCount: 3, unattributedCount: 3, salesTeamRead: 'unknown' });
ok('an old service that returns no diagnostics still gets the all-unattributed error',
  n && n.level === 'error' && /3 orders/.test(n.lines.join(' ')), n);
ok('and with no role to name, the notice does not print an empty role',
  n && !/ran as \./.test(n.lines.join(' ')) && !/undefined/.test(n.lines.join(' ')), n);
ok('an unknown read state is not reported as a failure',
  n && !/failed/i.test(n.lines.join(' ')), n);

// ── defensive: counts that do not add up must not produce nonsense ────────────
n = traderAttributionNotice({ ...base, orderCount: 2, unattributedCount: 7 });
ok('unattributed > orderCount is still the all-unattributed error, not a "7 of 2"',
  n && n.level === 'error' && !/7 of 2/.test(n.lines.join(' ')), n);
ok('negative counts are ignored rather than rendered',
  traderAttributionNotice({ ...base, unattributedCount: -1, namesUnreadable: -3 }) === null);

// ── deriving the figures from the orders alone ────────────────────────────────
// The deployed ARCH service does not return traderAttribution until this change
// reaches the account, and "the diagnostic only works once it is deployed" is not
// a diagnostic. So the tab has to be able to count for itself.
let d = deriveTraderAttribution([
  { trader: 'Justin Loveland', traderSource: 'salesTeam' },
  { trader: 'Header Rep', traderSource: 'header' },
  { trader: UNASSIGNED, traderSource: 'none' },
  { trader: 'Employee 2094', traderSource: 'salesTeam', traderNameUnreadable: true },
]);
ok('derive: counts each source', d.orders === 4 && d.fromSalesTeam === 2 && d.fromHeader === 1 && d.unattributed === 1, d);
ok('derive: counts unreadable names', d.namesUnreadable === 1, d);
ok('derive: never claims the read succeeded', d.salesTeamRead === 'unknown' && d.salesTeamError === '' && d.roleLabel === '', d);

// The old service: no traderSource at all, only the word it put in `trader`.
d = deriveTraderAttribution([{ trader: UNASSIGNED }, { trader: UNASSIGNED }, { trader: 'Camil Perrault' }]);
ok('derive: with no traderSource, Unassigned still counts as unattributed', d.unattributed === 2, d);
ok('derive: and a real name is not counted as unattributed', d.fromSalesTeam === 1, d);
d = deriveTraderAttribution([{ trader: UNASSIGNED }, { trader: UNASSIGNED }]);
ok('derive: the reported symptom is detectable from an old service response',
  d.unattributed === d.orders && d.orders === 2, d);
ok('derive: and feeding that into the notice produces the error',
  (traderAttributionNotice({ source: 'netsuite', orderCount: d.orders, unattributedCount: d.unattributed, salesTeamRead: d.salesTeamRead }) || {}).level === 'error');

ok('derive: a blank trader is unattributed, not a group called ""', deriveTraderAttribution([{ trader: '' }]).unattributed === 1);
ok('derive: a missing trader field does not throw', deriveTraderAttribution([{}]).unattributed === 1);
ok('derive: no orders is all zeroes, not NaN',
  (() => { const z = deriveTraderAttribution([]); return z.orders === 0 && z.unattributed === 0 && z.namesUnreadable === 0; })());
ok('derive: a non-array does not throw', deriveTraderAttribution(null).orders === 0);

console.log(fail ? ('# FAIL ' + fail) : '# archTraderAttribution ok');
process.exit(fail ? 1 : 0);
