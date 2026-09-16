/**
 * Bundle-split rules and demo work queue.
 *
 * The maths here is small but load-bearing — it is what tells a warehouse worker
 * whether the numbers they just keyed in are believable.
 */

import { seededRandom } from '@/lib/archLots';
import type { ArchSplitBundle, ArchSplitEntry, ArchSplitJob, ArchSplitOutcome } from '@/types/archSplit';

/**
 * How far the re-tally may drift from the system's figure for the bundle before
 * the row is flagged.
 *
 * NOT a validation failure — a genuine re-tally legitimately disagrees with the
 * supplier's figure, which is the entire reason this screen exists. It flags for
 * a second look; it never blocks the save. Blocking would mean a worker who
 * measured correctly cannot record what they measured.
 */
export const SPLIT_VARIANCE_TOLERANCE = 0.1;

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Key for one bundle's entry, scoped to the SALES ORDER as well as the lot.
 *
 * Lot number alone is not unique enough. The same physical bundle can be split
 * for two different orders — that is the partial-split case this whole screen
 * exists for — so a lot-only key would merge two jobs' measurements into one.
 */
export const entryKey = (soNo: string, lotNo: string): string => `${soNo}|${lotNo}`;

export const emptyEntry = (): ArchSplitEntry => ({ customerBF: '', inventoryBF: '' });

export const entryTouched = (e: ArchSplitEntry): boolean =>
  e.customerBF.trim() !== '' || e.inventoryBF.trim() !== '';

export const entryComplete = (e: ArchSplitEntry): boolean =>
  e.customerBF.trim() !== '' && e.inventoryBF.trim() !== '';

export interface SplitRowState {
  /** customer + inventory: what the bundle actually held, derived not entered. */
  measured: number;
  customer: number;
  inventory: number;
  /** measured − the system's figure. Positive means it re-tallied heavy. */
  discrepancy: number;
  discrepancyPct: number;
  /** Outside tolerance against the system figure — worth a second look. */
  flagged: boolean;
  /** Physically impossible input. */
  invalid: boolean;
  complete: boolean;
  touched: boolean;
}

/**
 * @param systemBF what the system believes the bundle holds, the reference the
 *   re-tally is compared against. Passed in rather than stored on the entry: the
 *   worker never types it, so it is not part of what they keyed in.
 */
export const evaluateEntry = (e: ArchSplitEntry, systemBF: number): SplitRowState => {
  const customer = num(e.customerBF);
  const inventory = num(e.inventoryBF);
  const measured = customer + inventory;
  const touched = entryTouched(e);
  const complete = entryComplete(e);
  const discrepancy = measured - systemBF;
  const discrepancyPct = systemBF > 0 ? discrepancy / systemBF : 0;

  // Neither part can be negative, and a split that gives the customer nothing is
  // a cancellation, not a split — it would otherwise balance perfectly and show
  // green. Whether that last rule is right is still open with the client.
  const invalid = touched && (customer <= 0 || inventory < 0);

  return {
    measured,
    customer,
    inventory,
    discrepancy,
    discrepancyPct,
    flagged: touched && !invalid && systemBF > 0 && Math.abs(discrepancyPct) > SPLIT_VARIANCE_TOLERANCE,
    invalid,
    complete,
    touched,
  };
};

/* 🔴 `nextSplitLotNo()` WAS HERE AND IS DELETED. Do not bring it back.
 *
 * It returned `` `${lotNo}-${priorSplits + 1}` `` and was rendered in three places,
 * one of them the printed SPLIT / LOT SHEET the warehouse staples to the new
 * bundle. NetSuite never created that name. Two separate faults:
 *
 * 1. WRONG NAMESPACE. The numeric `-N` suffix is what RECEIVING hands to a second
 *    bundle on one PO line, not what a split produces. Measured on Marc-Antoine's
 *    own screen, 2026-09-10 [11:50]: one 2,000 BF line of BEM84AD carrying lots
 *    `12345` AND `12345-1`, 1,000 BF each, two different physical bundles. His
 *    receiving reports do the same, `315946-1` through `315946-15`. So `-1` on a
 *    split can name a real bundle that already exists or has not landed yet.
 *    `archSplitExecute.js:336-375` already knew this and appends a LETTER instead
 *    (`-B`, `-C`, …), walking past every sibling name already taken.
 * 2. WRONG AUTHOR. Only the server creates the lot, and only the server can
 *    collision-check against siblings at the moment it does. Any name computed on
 *    the client is a prediction of a decision that has not been made.
 *
 * The client therefore does not predict. It DISPLAYS what the server created,
 * carried back as `childLot` from `completeBundle`. Before completion there is no
 * name, and the paperwork says so rather than guessing (see `SplitWorkOrder.tsx`,
 * which already treats LOT BF the same way and for the same reason).
 *
 * ⚠️ This deliberately sidesteps, rather than answers, the `-N` vs `-B` convention
 * question. Marc-Antoine answered `-N` in the Feedback 2/3 round ("à chaque split,
 * on fait un incrément... il y a un « -1 » après"); the server's own comment marks
 * its letter ladder UNCONFIRMED. That is one client question with one answer, and
 * it belongs in ONE place: `nextChildLotNumber()` on the server. Answering it here
 * too is how the two halves drifted apart in the first place.
 */

/**
 * What completing this row should do in NetSuite.
 *
 * `childLotNo` is the name NetSuite ACTUALLY created, returned by
 * `executeSplit` as `childLot`. Pass it whenever the split has run. Omit it on
 * the fixture path, where nothing is written and no lot exists, and the panel
 * reports the quantity without inventing a number for it.
 */
export const splitOutcome = (
  bundle: ArchSplitBundle,
  e: ArchSplitEntry,
  childLotNo: string | null = null
): ArchSplitOutcome => {
  const s = evaluateEntry(e, bundle.systemBF);
  return {
    lotNo: bundle.lotNo,
    unit: bundle.unit,
    soLineBF: s.customer,
    /*
     * 🔴 THE CUSTOMER'S PIECE IS THE ONE THAT GETS THE NEW NUMBER. Feedback 6 item
     * 16 reversed this on the server (`archSplitExecute.js`, `lot: divides ? 'child'
     * : 'parent'` on the customer line), and these two assignments were left as they
     * were, so the completion panel put each quantity on the wrong bundle: it told a
     * worker the parent held the customer's board feet while the banner underneath
     * said the opposite in words.
     */
    stockLotBF: s.inventory,
    customerLotBF: s.customer,
    newLotNo: childLotNo,
    systemVarianceBF: s.discrepancy,
  };
};

/* ── Demo work queue ────────────────────────────────────────────────────────
 * Real jobs come from a saved search of SO lines flagged as splits. That field
 * does not exist yet — there is no split marker anywhere on the SO line (all 102
 * custom fields checked, 2026-08-12) — so the queue is generated here in the
 * shape the search will return.
 * ------------------------------------------------------------------------- */

const SPECIES = [
  'African Mahogany',
  'Sapele',
  'European White Oak',
  'Black Limba',
  'Bolivian Rosewood',
  'Hard Maple',
  'White Ash',
  'Red Zebrawood',
];
const THICKNESS = ['4/4', '5/4', '6/4', '8/4'];
const GRADES = ['FAS', 'Sel & Btr', '#1 Common', 'Prime'];
const CUSTOMERS = [
  'Atlas Millwork',
  'Heritage Cabinetry',
  'Summit Builders Supply',
  'Coastal Hardwoods',
  'Lakeside Interiors',
  'Northstar Furniture',
  'Meridian Flooring',
];
const TRADERS = ['Christopher Pajot', 'Léo Dupuis', 'Alec Wolf', 'Melissa De Castro'];
const LOCATIONS = ['CWP Prevost', 'North Carolina State Ports', 'Buffalo'];
const CONTAINERS = ['MEDU', 'BMOU', 'MSCU', 'TCLU', 'CMAU', 'HLXU'];

let cached: ArchSplitJob[] | null = null;

export const getSplitJobs = (): ArchSplitJob[] => {
  if (cached) return cached;

  cached = Array.from({ length: 9 }, (_, i) => {
    const rng = seededRandom(`arch-split-job|${i}`);
    const randInt = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

    const thickness = pick(THICKNESS);
    const grade = pick(GRADES);
    // 1 to 4 bundles, matching the prototype's "1x" to "4x" column.
    const bundleCount = randInt(1, 4);

    const ship = new Date();
    // Spread across late / today / soon so the urgency pills are all exercised.
    ship.setDate(ship.getDate() + randInt(-3, 18));

    const bundles: ArchSplitBundle[] = Array.from({ length: bundleCount }, (_, b) => {
      const bRng = seededRandom(`arch-split-bundle|${i}|${b}`);
      const bInt = (a: number, c: number) => a + Math.floor(bRng() * (c - a + 1));
      // Species varies PER BUNDLE. A split job routinely spans several species,
      // which is why the queue row shows them pipe-joined.
      const species = SPECIES[(i * 3 + b * 5) % SPECIES.length];
      // Bundles run 350–2,400 BF; the trader asks for 25–80% of one.
      const systemBF = bInt(7, 48) * 50;
      const requestedBF = Math.round((systemBF * (0.25 + bRng() * 0.55)) / 25) * 25;
      return {
        // Job index is in the lot number so two orders can never collide. Species
        // + thickness alone repeats across orders, which silently merged their
        // split entries when the map was keyed on lot number.
        lotNo: `ARCH-${species.split(' ').map((w) => w.slice(0, 3).toUpperCase()).join('')}-${thickness.replace('/', '')}-${String(i + 1).padStart(2, '0')}${String(b + 1).padStart(2, '0')}`,
        itemDescription: `${species} ${thickness} ${grade}`,
        species,
        containerNo: `${CONTAINERS[bInt(0, CONTAINERS.length - 1)]}${bInt(1000000, 9999999)}`,
        // Every fixture bundle is Lumber, deliberately. The five real `-B` lots
        // in the sandbox are all Lumber, and whether veneer or ovals are
        // splittable at all is still an open question with Marc-Antoine. Seeding
        // a splittable veneer bundle here would answer it by invention.
        unit: 'BF' as const,
        systemBF,
        requestedBF,
      };
    });

    return {
      soNo: `SO-${52000 + i * 173 + randInt(0, 60)}`,
      customer: pick(CUSTOMERS),
      trader: pick(TRADERS),
      locationName: pick(LOCATIONS),
      shipDate: ship.toISOString().slice(0, 10),
      bundles,
    };
  });

  return cached;
};

/* ── Queue row helpers ──────────────────────────────────────────────────────*/

/** Distinct species on a job, pipe-joined, in first-seen order. */
export const speciesListOf = (job: ArchSplitJob): string =>
  [...new Set(job.bundles.map((b) => b.species))].join(' | ');

/** Board feet the sales order asks for across the whole job. */
export const jobRequestedBF = (job: ArchSplitJob): number =>
  job.bundles.reduce((s, b) => s + b.requestedBF, 0);

/** Board feet the system believes is on the floor across the whole job. */
export const jobSystemBF = (job: ArchSplitJob): number =>
  job.bundles.reduce((s, b) => s + b.systemBF, 0);

/** "Jul 17" — the ship-week column. */
export const shortDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/* ── Urgency ────────────────────────────────────────────────────────────────*/

export interface DueInfo {
  label: string;
  color: string;
  background: string;
}

export const dueInfo = (shipDate: string): DueInfo => {
  if (!shipDate) return { label: 'No date', color: '#64748B', background: '#F1F5F9' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${shipDate}T00:00:00`);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)}d late`, color: '#B91C1C', background: '#FEE2E2' };
  if (days === 0) return { label: 'Ships today', color: '#A16207', background: '#FEF3C7' };
  if (days <= 2) return { label: `Ships in ${days}d`, color: '#A16207', background: '#FEF3C7' };
  return { label: `Ships in ${days}d`, color: '#3D5166', background: '#EEF1F6' };
};
