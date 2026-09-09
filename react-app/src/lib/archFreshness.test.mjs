// archFreshness: the ARCH grid's own staleness bounds.
//
// Why this module exists at all is the thing to test: the SHARED badge calls
// anything over one hour stale, and the ARCH cache rebuilds hourly, so the shared
// thresholds report the normal cycle as a problem. That is why the badge was
// suppressed for ARCH, which left the grid with no age indicator, which is half of
// "on dirait qu'il fait juste disparaitre du TS".
import {
  archFreshness,
  formatAge,
  ARCH_REBUILD_MINUTES,
  ARCH_FRESH_LIMIT_MINUTES,
  ARCH_OVERDUE_LIMIT_MINUTES,
} from './archFreshness.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

const NOW = Date.parse('2026-09-08T20:00:00Z');
const ago = (mins) => new Date(NOW - mins * 60000).toISOString();

// ── the bound that matters: a full normal cycle is NOT stale ──────────────────
ok('the fresh bound is above the rebuild interval, or the badge cries wolf every cycle',
  ARCH_FRESH_LIMIT_MINUTES > ARCH_REBUILD_MINUTES, { ARCH_FRESH_LIMIT_MINUTES, ARCH_REBUILD_MINUTES });
ok('a cache that completed 59 minutes ago is fresh', archFreshness(ago(59), NOW).state === 'fresh');
ok('a cache that completed 61 minutes ago is STILL fresh (the shared badge calls this stale)',
  archFreshness(ago(61), NOW).state === 'fresh', archFreshness(ago(61), NOW));
ok('a cache that completed 74 minutes ago is still fresh', archFreshness(ago(74), NOW).state === 'fresh');
ok('76 minutes is due: one cycle has been missed', archFreshness(ago(76), NOW).state === 'due');
ok('2 hours 59 is still only due', archFreshness(ago(179), NOW).state === 'due');
ok('3 hours 1 is overdue', archFreshness(ago(181), NOW).state === 'overdue');
ok('4 days is overdue, not merely due', archFreshness(ago(4 * 24 * 60), NOW).state === 'overdue');
ok('the overdue bound is above the due bound', ARCH_OVERDUE_LIMIT_MINUTES > ARCH_FRESH_LIMIT_MINUTES);

// ── unknown is NOT fresh, which is the shared helper's bug ───────────────────
for (const bad of [null, undefined, '', 'not a date', 'yesterday']) {
  const r = archFreshness(bad, NOW);
  ok(`no usable timestamp (${JSON.stringify(bad)}) reports unknown, never fresh`,
    r.state === 'unknown' && r.ageMinutes === null, r);
}
ok('an unreadable timestamp is quoted back so it can be diagnosed',
  archFreshness('not a date', NOW).title.includes('not a date'));

// ── a clock disagreement must not print a negative age ───────────────────────
{
  const future = archFreshness(new Date(NOW + 10 * 60000).toISOString(), NOW);
  ok('a future timestamp clamps to zero and stays fresh', future.state === 'fresh' && future.ageMinutes === 0, future);
  ok('and does not print a negative age', !/-/.test(future.label), future.label);
}

// ── every state explains itself and says what to do ──────────────────────────
for (const [mins, expected] of [[10, 'fresh'], [90, 'due'], [600, 'overdue']]) {
  const r = archFreshness(ago(mins), NOW);
  ok(`${expected}: state and a non-empty label`, r.state === expected && r.label.length > 0, r);
  ok(`${expected}: the tooltip names the rebuild interval`, r.title.includes(String(ARCH_REBUILD_MINUTES)), r.title);
}
ok('due tells the trader to refresh', /refresh/i.test(archFreshness(ago(90), NOW).title));
ok('overdue says the figures are out of date, not just old',
  /out of date/i.test(archFreshness(ago(600), NOW).title));
ok('fresh warns that a just-sold bundle may not have moved yet',
  /may not have moved/i.test(archFreshness(ago(5), NOW).title));

// ── formatAge ────────────────────────────────────────────────────────────────
ok('formatAge: minutes', formatAge(0) === '0 min' && formatAge(59) === '59 min', [formatAge(0), formatAge(59)]);
ok('formatAge: exact hours drop the minutes', formatAge(120) === '2 h', formatAge(120));
ok('formatAge: hours and minutes', formatAge(185) === '3 h 5 min', formatAge(185));
ok('formatAge: a day is singular', formatAge(24 * 60) === '1 day', formatAge(24 * 60));
ok('formatAge: days are plural', formatAge(4 * 24 * 60) === '4 days', formatAge(4 * 24 * 60));
ok('formatAge: never negative', formatAge(-5) === '0 min', formatAge(-5));

console.log(fail ? ('# FAIL ' + fail) : '# archFreshness ok');
process.exit(fail ? 1 : 0);
