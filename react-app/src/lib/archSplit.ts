/**
 * Bundle-split rules and demo work queue.
 *
 * The maths here is small but load-bearing — it is what tells a warehouse worker
 * whether the numbers they just keyed in are believable.
 */

import { seededRandom } from '@/lib/archLots';
import type { ArchSplitBundle, ArchSplitEntry, ArchSplitJob, ArchSplitOutcome } from '@/types/archSplit';

/**
 * How far customer + inventory may drift from the measured bundle before the row
 * is flagged.
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

export const emptyEntry = (bundle: ArchSplitBundle): ArchSplitEntry => ({
  // Pre-fill the measured figure with what the system believes, since that is
  // usually close and saves typing. The worker overwrites it with the re-tally.
  measuredBF: String(bundle.systemBF),
  customerBF: '',
  inventoryBF: '',
});

export const entryTouched = (e: ArchSplitEntry): boolean =>
  e.customerBF.trim() !== '' || e.inventoryBF.trim() !== '';

export const entryComplete = (e: ArchSplitEntry): boolean =>
  e.customerBF.trim() !== '' && e.inventoryBF.trim() !== '' && e.measuredBF.trim() !== '';

export interface SplitRowState {
  measured: number;
  customer: number;
  inventory: number;
  /** customer + inventory */
  accounted: number;
  /** accounted − measured. Positive means more came out than went in. */
  discrepancy: number;
  discrepancyPct: number;
  /** Outside tolerance — worth a second look before saving. */
  flagged: boolean;
  complete: boolean;
  touched: boolean;
}

export const evaluateEntry = (e: ArchSplitEntry): SplitRowState => {
  const measured = num(e.measuredBF);
  const customer = num(e.customerBF);
  const inventory = num(e.inventoryBF);
  const accounted = customer + inventory;
  const discrepancy = accounted - measured;
  const touched = entryTouched(e);
  const complete = entryComplete(e);
  const discrepancyPct = measured > 0 ? discrepancy / measured : 0;
  return {
    measured,
    customer,
    inventory,
    accounted,
    discrepancy,
    discrepancyPct,
    flagged: touched && measured > 0 && Math.abs(discrepancyPct) > SPLIT_VARIANCE_TOLERANCE,
    complete,
    touched,
  };
};

/**
 * The new lot number for the remainder: the original with a `-N` suffix,
 * incrementing per split ("à chaque split, on fait un incrément... il y a un
 * « -1 » après").
 *
 * ALWAYS APPENDS. Never parse a trailing number off the lot and increment it —
 * MGSL lot numbers already end in a sequence (`ARC-SAP-64-001`, `-002`, `-003`
 * are three different bundles of the same item), so incrementing the last group
 * would hand back the lot number of a DIFFERENT PHYSICAL BUNDLE and collide with
 * it in NetSuite. Nothing in the lot number distinguishes "bundle sequence" from
 * "split sequence", so the only safe move is to append a new group.
 *
 * ⚠️ Splitting an already-split lot is ambiguous in the source material: does
 * `ARC-SAP-64-001-1` split into `-001-2` (a sibling) or `-001-1-1` (nested)?
 * This returns the sibling form via `priorSplits`. Confirm with the client
 * before this reaches NetSuite.
 */
export const nextSplitLotNo = (lotNo: string, priorSplits = 0): string => `${lotNo}-${priorSplits + 1}`;

/** What completing this row should do in NetSuite. */
export const splitOutcome = (bundle: ArchSplitBundle, e: ArchSplitEntry): ArchSplitOutcome => {
  const s = evaluateEntry(e);
  return {
    lotNo: bundle.lotNo,
    soLineBF: s.customer,
    originalLotBF: s.customer,
    newLotBF: s.inventory,
    newLotNo: nextSplitLotNo(bundle.lotNo),
    systemVarianceBF: s.measured - bundle.systemBF,
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

    const species = SPECIES[i % SPECIES.length];
    const thickness = pick(THICKNESS);
    const grade = pick(GRADES);
    const bundleCount = randInt(1, 3);

    const ship = new Date();
    // Spread across late / today / soon so the urgency pills are all exercised.
    ship.setDate(ship.getDate() + randInt(-3, 18));

    const bundles: ArchSplitBundle[] = Array.from({ length: bundleCount }, (_, b) => {
      const bRng = seededRandom(`arch-split-bundle|${i}|${b}`);
      const bInt = (a: number, c: number) => a + Math.floor(bRng() * (c - a + 1));
      // Bundles run 350–2,400 BF; the trader asks for 25–80% of one.
      const systemBF = bInt(7, 48) * 50;
      const requestedBF = Math.round((systemBF * (0.25 + bRng() * 0.55)) / 25) * 25;
      return {
        // Job index is in the lot number so two orders can never collide. Species
        // + thickness alone repeats across orders, which silently merged their
        // split entries when the map was keyed on lot number.
        lotNo: `ARC-${species.split(' ').map((w) => w.slice(0, 3).toUpperCase()).join('')}-${thickness.replace('/', '')}-${String(i + 1).padStart(2, '0')}${String(b + 1).padStart(2, '0')}`,
        itemDescription: `${species} ${thickness} ${grade}`,
        containerNo: `${CONTAINERS[bInt(0, CONTAINERS.length - 1)]}${bInt(1000000, 9999999)}`,
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
