/**
 * CWP ARCH demo data.
 *
 * WHY THIS EXISTS: as of 2026-08-12 the ARCH subsidiary (NetSuite `ARC`, id 9)
 * has ZERO transaction lines in sandbox AND production, no hardwood items exist
 * among the 2,294 items in the account, and no ARCH saved searches have been
 * built. There is no back end to read from yet. This module produces data in the
 * exact shape the ARCH RESTlet is expected to return, so the screen can be built
 * and demoed now and swapped to live data by changing one hook.
 *
 * Everything here is DETERMINISTIC (seeded, no Math.random, no Date.now in the
 * row data) so the screen looks identical on every reload — a demo that reshuffles
 * itself between screenshots is useless for review.
 *
 * The screen labels this data as demo data in the header. Do not remove that
 * label while this module is the source.
 */

import { seededRandom } from '@/lib/archLots';
import type { ArchLot, ArchSummaryRow } from '@/types/arch';

/** Real NetSuite location ids — the only genuinely real values in this file. */
const LOCATIONS = [
  { id: '122', name: 'CWP Prevost' },
  { id: '120', name: 'North Carolina State Ports' },
  { id: '110', name: 'Buffalo' },
];

const SPECIES = [
  'African Mahogany',
  'Sapele',
  'European White Oak',
  'Black Limba',
  'Bolivian Rosewood',
  'Bloodwood',
  'Birdseye Maple',
  'Red Zebrawood',
  'White Ash',
  'Hard Maple',
];

const THICKNESSES = ['4/4', '5/4', '6/4', '8/4', '12/4', '16/4'];
const CATEGORIES = ['Dimensional', 'Panel', 'Trim', 'Engineered', 'Specialty'];
const GRADES = ['FAS', 'Sel & Btr', '#1 Common', 'Prime', 'Veneer Grade'];
const GRAINS = ['Quarter Cut', 'Flat Cut', 'Rift Cut', 'Mixed Grain'];
const CONTAINER_PREFIXES = ['MEDU', 'BMOU', 'MSCU', 'TCLU', 'CMAU', 'HLXU'];

const ITEM_COUNT = 40;

/**
 * Build one item row with its lots.
 *
 * A physical lot lives in exactly ONE bucket — on hand, in transit, or on order.
 * Stock cannot be simultaneously sitting in the yard and on a vessel, and a grid
 * whose buckets overlap makes Available meaningless.
 */
const buildRow = (index: number): ArchSummaryRow => {
  const rng = seededRandom(`arch-fixture|item|${index}`);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const randInt = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

  const location = LOCATIONS[index % LOCATIONS.length];
  const species = SPECIES[index % SPECIES.length];
  const thickness = THICKNESSES[Math.floor(index / SPECIES.length) % THICKNESSES.length];
  const grade = pick(GRADES);
  const grain = pick(GRAINS);
  const category = pick(CATEGORIES);

  const internalId = String(90000 + index);
  const itemCode = `ARCH-${species
    .split(' ')
    .map((w) => w.slice(0, 3).toUpperCase())
    .join('')}-${thickness.replace('/', '')}`;

  const lots: ArchLot[] = Array.from({ length: randInt(1, 4) }, (_, i) => {
    const lotRng = seededRandom(`arch-fixture|lot|${index}|${i}`);
    const lotInt = (a: number, b: number) => a + Math.floor(lotRng() * (b - a + 1));
    // Bundle sizes in the 300-2,400 BF range, matching the sizes discussed on the call.
    const qty = lotInt(6, 48) * 50;
    const bucket = ['onHand', 'onHand', 'onHand', 'inTransit', 'onOrder'][lotInt(0, 4)];

    const onHand = bucket === 'onHand' ? qty : 0;
    // ~30% of on-hand bundles carry a reservation. Roughly a third of those are
    // partial — that is the bundle-split case, where the whole bundle still locks.
    const hasReserve = bucket === 'onHand' && lotInt(1, 10) <= 3;
    const reserve = hasReserve ? (lotInt(1, 3) === 1 ? lotInt(1, Math.max(1, Math.floor(onHand * 0.6))) : onHand) : 0;
    const readyToBuild = bucket === 'onHand' && !hasReserve && lotInt(1, 10) <= 2 ? lotInt(1, Math.floor(onHand * 0.5)) : 0;
    const outbound = bucket === 'onHand' && !hasReserve && !readyToBuild && lotInt(1, 10) <= 2 ? lotInt(1, Math.floor(onHand * 0.4)) : 0;

    return {
      lotNo: `${itemCode}-${String(i + 1).padStart(3, '0')}`,
      po: `PO-${lotInt(10000, 99999)}`,
      containerNo: `${CONTAINER_PREFIXES[lotInt(0, CONTAINER_PREFIXES.length - 1)]}${lotInt(1000000, 9999999)}`,
      onHand,
      reserve,
      readyToBuild,
      outbound,
      onOrder: bucket === 'onOrder' ? qty : 0,
      inTransit: bucket === 'inTransit' ? qty : 0,
      tallyImageUrl: null,
    };
  });

  const sum = (k: keyof ArchLot) => lots.reduce((s, l) => s + ((l[k] as number) || 0), 0);
  const onHand = sum('onHand');
  const reserve = sum('reserve');
  const readyToBuild = sum('readyToBuild');
  const outbound = sum('outbound');
  const onOrder = sum('onOrder');
  const inTransit = sum('inTransit');

  const containers = [...new Set(lots.map((l) => l.containerNo).filter(Boolean))];

  return {
    internalId,
    itemCode,
    description: `${species} ${thickness} KD`,
    locationId: location.id,
    locationName: location.name,
    species,
    thickness,
    category,
    grade,
    grain,
    containerNo: containers[0] || '',
    containers,
    lots,
    onHand,
    reserve,
    readyToBuild,
    outbound,
    onOrder,
    inTransit,
    available: Math.max(0, onHand + onOrder + inTransit - reserve - readyToBuild - outbound),
    // Hardwood lot cost per board foot — roughly $2.40 to $9.80.
    avgCostBF: Math.round((2.4 + rng() * 7.4) * 100) / 100,
    detailKey: `${internalId}-${location.id}`,
  };
};

let cached: ArchSummaryRow[] | null = null;

/** The full ARCH demo dataset. Built once, then reused. */
export const getArchFixtureRows = (): ArchSummaryRow[] => {
  if (!cached) {
    cached = Array.from({ length: ITEM_COUNT }, (_, i) => buildRow(i))
      // Match the grid's default posture: hide rows with nothing in any bucket.
      .filter((r) => r.onHand > 0 || r.onOrder > 0 || r.inTransit > 0);
  }
  return cached;
};

/* ── Per-lot detail (demo) ──────────────────────────────────────────────────
 * The detail modal needs the sales order a reservation belongs to, and the
 * supplier/ETA behind an incoming lot. Both come from the ARCH RESTlet once it
 * exists; until then they are derived deterministically from the lot number so a
 * given lot always shows the same SO and the same customer.
 * ------------------------------------------------------------------------- */

const CUSTOMERS = [
  'Atlas Millwork',
  'Heritage Cabinetry',
  'Summit Builders Supply',
  'Coastal Hardwoods',
  'Lakeside Interiors',
  'Vanguard Doors & Trim',
  'Ironwood Construction',
  'Meridian Flooring',
  'Northstar Furniture',
  'Pinnacle Architectural',
];

const CUSTOMER_TRADER: Record<string, string> = {
  'Atlas Millwork': 'Christopher Pajot',
  'Heritage Cabinetry': 'Léo Dupuis',
  'Summit Builders Supply': 'Alec Wolf',
  'Coastal Hardwoods': 'Melissa De Castro',
  'Lakeside Interiors': 'Tom Gorelle',
  'Vanguard Doors & Trim': 'Antoine Quimper',
  'Ironwood Construction': 'Christopher Pajot',
  'Meridian Flooring': 'Léo Dupuis',
  'Northstar Furniture': 'Alec Wolf',
  'Pinnacle Architectural': 'Melissa De Castro',
};

const SUPPLIERS = ['Pacific Lumber Co.', 'Northern Forest Inc.', 'Cascades Inc.', 'Boreal Wood', 'Alpine Timber'];

const addDays = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Monday of the week containing `d` — ship dates are quoted as a ship week. */
export const mondayOf = (d: Date): Date => {
  const x = new Date(d);
  const dow = x.getDay() || 7;
  x.setDate(x.getDate() - (dow - 1));
  return x;
};

export interface ArchAllocation {
  soNumber: string;
  customer: string;
  trader: string;
  createdDate: Date;
  shipWeek: Date;
  /** Days since the SO was raised — drives the ageing colour. */
  ageDays: number;
}

export const lotAllocation = (lotNo: string, bucket: string): ArchAllocation => {
  const rng = seededRandom(`${lotNo}|so|${bucket}`);
  const randInt = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const customer = CUSTOMERS[randInt(0, CUSTOMERS.length - 1)];
  const ageDays = randInt(0, 29);
  return {
    soNumber: `SO-${randInt(20000, 89999)}`,
    customer,
    trader: CUSTOMER_TRADER[customer] || 'Unassigned',
    createdDate: addDays(-ageDays),
    shipWeek: mondayOf(addDays(7 + randInt(0, 44))),
    ageDays,
  };
};

export interface ArchIncomingInfo {
  supplier: string;
  eta: Date;
}

export const lotIncomingInfo = (lotNo: string, bucket: 'onOrder' | 'inTransit'): ArchIncomingInfo => {
  const rng = seededRandom(`${lotNo}|incoming|${bucket}`);
  // In-transit stock lands sooner than stock still on order.
  const base = bucket === 'onOrder' ? 35 : 7;
  const span = bucket === 'onOrder' ? 70 : 35;
  return {
    supplier: SUPPLIERS[Math.floor(rng() * SUPPLIERS.length)],
    eta: addDays(base + Math.floor(rng() * span)),
  };
};

export const formatShortDate = (d: Date): string =>
  d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
