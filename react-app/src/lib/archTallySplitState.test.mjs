// The "this lot's tally cannot be trusted" path, end to end across the seam.
//
// Two halves, and they are tested separately because they live in different
// runtimes. The SERVER half derives the state in the ARCH cache MR and is
// exercised here as pure logic. The CLIENT half turns the state into words and
// into a decision not to draw a matrix.
//
// WHY THIS FILE EXISTS. Before it, a split left the parent serving its pre-split
// matrix and the child rendering ANOTHER SHIPMENT'S wood out of the fixture pool.
// Both look completely authoritative on screen.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, '..', '..', '..', 'src', 'FileCabinet', 'SuiteScripts',
  'mcgi_services', 'trader_screen', 'entry_points', 'mr', 'mcgi_mr_trader_screen_cache_arch.js');

let fail = 0, total = 0;
const ok = (name, cond, got) => {
  total++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '   got: ' + JSON.stringify(got)));
  if (!cond) fail++;
};

/* ── the server rule, as pure logic ──────────────────────────────────────────
 * Mirrors the branch in reduce(). Kept in step with it by the SOURCE guards at
 * the bottom, which fail if the real branch stops looking like this. */
const derive = (tally, split) => {
  if (!split) return null;
  if (split.role === 'child' && !tally) return 'newChild';
  if (tally && split.at && tally.lastModified && split.at.getTime() > tally.lastModified.getTime()) {
    return 'staleParent';
  }
  return null;
};
const D = (s) => new Date(s);
const tallyAt = (s) => ({ lastModified: D(s), bundles: [{}] });

ok('a lot with no split is untouched', derive(tallyAt('2026-09-01'), null) === null);
ok('a parent split AFTER its tally is stale',
  derive(tallyAt('2026-09-01'), { role: 'parent', at: D('2026-09-09') }) === 'staleParent');
ok('a parent tallied AFTER the split is NOT stale, that is the self-clear',
  derive(tallyAt('2026-09-14'), { role: 'parent', at: D('2026-09-09') }) === null);
ok('a brand-new child with no tally is newChild',
  derive(null, { role: 'child', at: D('2026-09-09') }) === 'newChild');
ok('a child that HAS since been tallied is not newChild',
  derive(tallyAt('2026-09-14'), { role: 'child', at: D('2026-09-09') }) === null);
/* 🔴 The precision trap. Both sides are selected with TO_CHAR precisely so this
   case can be decided: raw, both collapse to midnight and this returns null. */
ok('SAME DAY is decided by the TIME, not the date',
  derive(tallyAt('2026-09-09T08:00:00'), { role: 'parent', at: D('2026-09-09T12:04:28') }) === 'staleParent');
ok('  ...and the other way round on the same day',
  derive(tallyAt('2026-09-09T18:00:00'), { role: 'parent', at: D('2026-09-09T12:04:28') }) === null);
ok('a parent with NO tally at all stays null, there is nothing to invalidate',
  derive(null, { role: 'parent', at: D('2026-09-09') }) === null);

/* ── B3: the per-lot stamp narrows the blast radius ──────────────────────────
 *
 * `lastmodified` is per RECORD, and a capture covers many lots, so any edit to it
 * reads as "every lot in here was re-tallied". Demonstrated live 2026-09-15: one
 * edit to capture 401 cleared the flag for all five of its lots.
 *
 * The comparison now prefers a per-BUNDLE stamp where the payload carries one, so
 * precision improves the day the writer starts emitting it, with no further change
 * on this side. */
const deriveStamped = (tally, split) => {
  if (!split) return null;
  if (split.role === 'child' && !tally) return 'newChild';
  if (tally && split.at) {
    const stamp = tally.lotStamp || tally.payloadChangedAt || tally.lastModified;
    if (stamp && split.at.getTime() > stamp.getTime()) return 'staleParent';
  }
  return null;
};
ok('B3: a per-lot stamp OLDER than the record still marks the lot stale',
  deriveStamped({ lastModified: D('2026-09-20'), lotStamp: D('2026-09-01'), bundles: [{}] },
                { role: 'parent', at: D('2026-09-09') }) === 'staleParent');
ok('  ...which the record-level timestamp alone would have wrongly cleared',
  derive({ lastModified: D('2026-09-20'), bundles: [{}] },
         { role: 'parent', at: D('2026-09-09') }) === null);
ok('B3: a per-lot stamp NEWER than the split clears it',
  deriveStamped({ lastModified: D('2026-09-01'), lotStamp: D('2026-09-14'), bundles: [{}] },
                { role: 'parent', at: D('2026-09-09') }) === null);
ok('B3: with no per-lot stamp it falls back to the record, so nothing regresses',
  deriveStamped({ lastModified: D('2026-09-01'), lotStamp: null, bundles: [{}] },
                { role: 'parent', at: D('2026-09-09') }) === 'staleParent');
/* The measured case: capture 1 reads lastmodified 14:01:21 but its payload last
   changed at 13:46:36, because the record was edited without the tally changing.
   Using lastmodified there claims a re-tally that never happened. */
ok('B3: payloadChangedAt beats a later lastmodified, the real 15-minute divergence',
  deriveStamped({ lastModified: D('2026-09-03T14:01:21'),
                  payloadChangedAt: D('2026-09-03T13:46:36'), lotStamp: null, bundles: [{}] },
                { role: 'parent', at: D('2026-09-03T13:55:00') }) === 'staleParent');
ok('  ...and lastmodified alone would have wrongly cleared that same case',
  derive({ lastModified: D('2026-09-03T14:01:21'), bundles: [{}] },
         { role: 'parent', at: D('2026-09-03T13:55:00') }) === null);
ok('B3: a per-lot stamp still outranks the payload-change time',
  deriveStamped({ lastModified: D('2026-09-01'), payloadChangedAt: D('2026-09-01'),
                  lotStamp: D('2026-09-20'), bundles: [{}] },
                { role: 'parent', at: D('2026-09-09') }) === null);
/* Three tiers, most precise first. `payloadChangedAt` was added 2026-09-15 after
   measuring capture 1: lastmodified 14:01:21 but the payload last changed 13:46:36,
   fifteen minutes apart, because the record was edited without the tally changing. */
ok('SOURCE: the stamp chain is lotStamp, then payloadChangedAt, then lastModified',
  /tally\.lotStamp \|\| tally\.payloadChangedAt \|\| tally\.lastModified/.test(fs.readFileSync(MR, 'utf8')));
ok('SOURCE: the payload-change read is scoped to the results-JSON field only',
  /CUSTRECORD_MSL_PLC_RESULTS_JSON/.test(fs.readFileSync(MR, 'utf8')) &&
  /recordtypeid = 3834/.test(fs.readFileSync(MR, 'utf8')));
ok('SOURCE: and it fails soft, so an unreadable systemnote falls back not blanks',
  /ARCH tally payload-change read unavailable/.test(fs.readFileSync(MR, 'utf8')));
ok('SOURCE: an unparseable stamp is treated as ABSENT, not as epoch zero',
  /isFinite\(d\.getTime\(\)\) \? d : null/.test(fs.readFileSync(MR, 'utf8')));

/* ── the remainder-zero split ────────────────────────────────────────────────
 *
 * A customer taking the WHOLE bundle issues it and receives it straight back onto
 * the same lot, so the lot ends where it started and no child is created. The
 * tally still describes the wood exactly, so the lot must NOT be marked.
 *
 * Proven live on IA-CWP-732 (2026-09-15): 315643-19 at -1.172 and +1.172, no
 * child lot, and SPLIT_SQL returned net exactly '0'.
 *
 * Mirrors the loader's guard, which is why the epsilon matters: NetSuite happened
 * to return a clean zero, but a split whose halves rounded differently would come
 * back as 1e-16, read as a CHILD on the positive sign, and get marked stale
 * against its own tally. */
const netSkipped = (net) => !isFinite(net) || Math.abs(net) < 1e-9;
ok('remainder-zero: an exact 0 net is skipped', netSkipped(0));
ok('remainder-zero: a rounding crumb is ALSO skipped, not read as a child',
  netSkipped(1e-16) && netSkipped(-1e-16));
ok('  ...but a real child quantity is not skipped', !netSkipped(0.27));
ok('  ...and a real parent quantity is not skipped', !netSkipped(-1.048));
ok('SOURCE: the shipped guard uses an epsilon, not === 0',
  /Math\.abs\(net\) < 1e-9/.test(fs.readFileSync(MR, 'utf8')));

/* ── the server SQL, as shipped ───────────────────────────────────────────── */
const src = fs.readFileSync(MR, 'utf8');
ok('SOURCE: splits are found by OUR link and OUR memo, not by guessing',
  /custcol_mgsl_split_invadj/.test(src) && /ARCH bundle split/.test(src));
ok('SOURCE: parent vs child comes from the SIGN, not a lot-name pattern',
  /net < 0 \? 'parent' : 'child'/.test(src));
/* Raw, `lastmodified` and `createddate` come back as "9/14/2026" with the time
   dropped, and every same-day comparison above would then be wrong. */
ok('SOURCE: both timestamps are read with TO_CHAR, not raw',
  /TO_CHAR\(c\.lastmodified,'YYYY-MM-DD HH24:MI:SS'\)/.test(src) &&
  /TO_CHAR\(t\.createddate,'YYYY-MM-DD HH24:MI:SS'\)/.test(src));
ok('SOURCE: split detection fails SOFT, it must never take the cache down',
  /ARCH split detection failed/.test(src) && /_splitCache = byLot;/.test(src));
ok('SOURCE: the state is emitted beside tally, not inside it',
  /tallyState: tallyState,/.test(src));

/* ── the client half ─────────────────────────────────────────────────────── */
const tallyTs = fs.readFileSync(join(here, 'archTally.ts'), 'utf8');
const fixtures = fs.readFileSync(join(here, 'archTallyFixtures.ts'), 'utf8');
const dialog = fs.readFileSync(join(here, '..', 'components', 'arch', 'TallyImageDialog.tsx'), 'utf8');
const lotTable = fs.readFileSync(join(here, '..', 'components', 'arch', 'ArchLotTable.tsx'), 'utf8');

ok('CLIENT: the two states say DIFFERENT things, a split lot is not "no tally yet"',
  /was split, so the tally taken for it no longer describes/.test(tallyTs) &&
  /was created by a split, so no supplier document/.test(tallyTs));
/* The whole point. Without this the child hashes into the demo pool and draws a
   real, precise, wrong matrix belonging to another shipment. */
ok('CLIENT: a split lot gets NO bundle, so no fixture can be substituted',
  /if \(tallyState === 'staleParent' \|\| tallyState === 'newChild'\) \{/.test(fixtures) &&
  /return \{ bundle: undefined/.test(fixtures));
ok('CLIENT: and that guard is the FIRST thing, ahead of the real-data branch',
  fixtures.indexOf("tallyState === 'staleParent'") < fixtures.indexOf('tally.bundles.length'));
ok('CLIENT: the inline row prefers the split wording over the generic empty text',
  /tallyStateNote\(tallyState\) \|\| 'No tally parsed for this bundle yet\.'/.test(lotTable));
/* A split lot can still carry a receiving photo. Showing it as though it described
   the lot is the same lie as showing the stale matrix. */
ok('CLIENT: the dialog answers the split BEFORE falling back to an image',
  dialog.indexOf('tallyStateNote(tallyState) ?') < dialog.indexOf(': imageUrl ?'));
ok('CLIENT: all three call sites pass the lot state through',
  (lotTable.match(/lot\.tallyState|\?\.tallyState/g) || []).length >= 2 &&
  /\?\.tallyState/.test(fs.readFileSync(join(here, '..', 'components', 'arch', 'ArchReservedSection.tsx'), 'utf8')));

console.log('\n' + total + ' assertions, ' + (fail ? fail + ' FAILED' : 'all passed'));
if (fail) process.exit(1);
