/**
 * CWP ARCH units.
 *
 * ── The correction this file exists to make ─────────────────────────────────
 * ARCH is NOT board-foot native. That assumption was wrong and it was baked in
 * everywhere: `formatBF()` at ~40 call sites and hardcoded "BF" literals beside
 * them. Marc-Antoine confirmed a three-unit model on 2026-08-16 and the sandbox
 * agrees — verified 2026-08-17 against the six ARCH SKUs:
 *
 *     PUR44KD, ZEB44KD, ZEB84KD, SAP54FCKD   stock unit BF            (Lumber)
 *     WALVENFCAA                             stock unit Square Feet   (Veneer)
 *     WAL44OVLOUTKD                          stock unit Unit          (Ovals)
 *
 * A "Linear Feet" units type also exists in the account with zero items on it,
 * almost certainly waiting for Decking, which is sold by the linear foot. It is
 * handled here so the day those items appear nothing needs changing.
 *
 * The unit is a property of the ITEM — its stock unit — not of a category
 * string. That is the discriminator to key off, and it is the same one
 * `archSplitQueue.js` already uses server-side.
 *
 * ── The storage asymmetry, which is the dangerous part ──────────────────────
 * `inventorynumberlocation.quantityonhand` is stored in the item's BASE unit:
 *
 *     BF items      base MBF, conversion rate 0.001  →  a lot reading 1.170 is 1 170 BF
 *     Square Feet   base Square Feet, rate 1         →  stored value is already SQFT
 *     Unit          base Unit, rate 1                →  stored value is already units
 *
 * Two of the three need no conversion, which is exactly what makes the third
 * easy to miss. Everything that reaches this module is expected to be in
 * DISPLAY units already — the conversion belongs at the data boundary
 * (archSplitQueue.js does `stored / rate`), never in a formatter.
 *
 * ── Cubic metres ────────────────────────────────────────────────────────────
 * 1 m³ = 423 BF, Marc-Antoine's figure from the 2026-08-11 call. It is a
 * VOLUME conversion, so it applies to board feet and to nothing else. Asking
 * for veneer in cubic metres is a category error, and silently converting an
 * area or a count by 423 would invent numbers. Non-BF rows stay in their own
 * unit when the m³ view is on — see `convertQty`.
 *
 * (The offline POC's `UOM_FACTORS` table is NOT the source of truth — it mixes
 * an MBF-based m³ factor with a BF-based identity factor. Don't port it.)
 */

export const BF_PER_CUBIC_METRE = 423;

/** Canonical stock units an ARCH item can carry. */
export type ArchUnit = 'BF' | 'SQFT' | 'UNIT' | 'LF';

/** The default when a row carries no unit — ARCH is mostly Lumber. */
export const DEFAULT_ARCH_UNIT: ArchUnit = 'BF';

/**
 * NetSuite's `unitstypeuom.unitname` → our canonical code.
 *
 * Matched case-insensitively on a trimmed string because the account holds both
 * "Square Feet" (the units type) and "SQFT" (an abbreviation used on some item
 * records), and neither spelling is guaranteed by anything.
 */
export const normalizeUnit = (nsUnitName: string | null | undefined): ArchUnit => {
  const s = String(nsUnitName || '').trim().toLowerCase();
  if (!s) return DEFAULT_ARCH_UNIT;
  if (s === 'bf' || s.indexOf('board') !== -1) return 'BF';
  if (s === 'sqft' || s === 'sf' || (s.indexOf('square') !== -1 && s.indexOf('feet') !== -1)) return 'SQFT';
  if (s === 'lf' || (s.indexOf('linear') !== -1 && s.indexOf('feet') !== -1)) return 'LF';
  if (s === 'unit' || s === 'units' || s === 'ea' || s === 'each') return 'UNIT';
  return DEFAULT_ARCH_UNIT;
};

/**
 * Item Category → unit, per Marc-Antoine's model (2026-08-16), confirmed
 * independently by the six sandbox SKUs.
 *
 * PRODUCTION READS THE ITEM'S STOCK UNIT, not this map — an item is the
 * authority on what it is counted in, and a category is only a label on it.
 * This exists for the fixture dataset and as a last-resort fallback when a row
 * arrives with a category but no unit.
 */
export const unitForCategory = (category: string | null | undefined): ArchUnit => {
  switch (String(category || '').trim().toLowerCase()) {
    case 'veneer':  return 'SQFT';
    case 'ovals':   return 'UNIT';
    case 'decking': return 'LF';
    default:        return 'BF'; // Lumber, and anything unrecognised
  }
};

/** Short suffix for column headers, badges and totals. */
export const unitLabel = (unit: ArchUnit = DEFAULT_ARCH_UNIT): string => {
  switch (unit) {
    case 'SQFT': return 'SQFT';
    case 'UNIT': return 'units';
    case 'LF':   return 'LF';
    default:     return 'BF';
  }
};

/** Long form, for prose and tooltips — "650 board feet", "3 pieces". */
export const unitLabelLong = (unit: ArchUnit = DEFAULT_ARCH_UNIT, qty = 2): string => {
  const plural = Math.abs(qty) !== 1;
  switch (unit) {
    case 'SQFT': return plural ? 'square feet' : 'square foot';
    case 'UNIT': return plural ? 'pieces' : 'piece';
    case 'LF':   return plural ? 'linear feet' : 'linear foot';
    default:     return plural ? 'board feet' : 'board foot';
  }
};

/**
 * Can this unit be shown as cubic metres? Volume only.
 * Veneer is an area and ovals are a count — neither has a cubic-metre value.
 */
export const supportsCubicMetres = (unit: ArchUnit = DEFAULT_ARCH_UNIT): boolean => unit === 'BF';

// ── Display UoM (the screen-level toggle) ───────────────────────────────────

export const ARCH_UOM_NATIVE = 'Native (BF / SQFT / units)';
export const ARCH_UOM_M3 = 'Cubic meters (m³)';

/**
 * What the UoM dropdown offers on the ARCH screen.
 *
 * The old list was ['BF', 'Cubic meters (m³)'], which only made sense while
 * every row was Lumber. "Native" is the honest label now: each row renders in
 * the unit its own item is stocked in.
 */
export const ARCH_UOMS: string[] = [ARCH_UOM_NATIVE, ARCH_UOM_M3];

/**
 * Convert a quantity from its native unit into the selected display UoM.
 *
 * Selecting m³ converts BF rows and leaves everything else alone — a mixed grid
 * shows cubic metres for Lumber and SQFT/units for the rest, rather than
 * pretending a veneer sheet has a volume.
 */
export const convertQty = (qty: number, unit: ArchUnit, displayUom: string): number => {
  if (displayUom === ARCH_UOM_M3 && supportsCubicMetres(unit)) return qty / BF_PER_CUBIC_METRE;
  return qty;
};

/** The suffix actually rendered, given the row's unit and the selected UoM. */
export const displaySuffix = (unit: ArchUnit = DEFAULT_ARCH_UNIT, displayUom: string = ARCH_UOM_NATIVE): string =>
  (displayUom === ARCH_UOM_M3 && supportsCubicMetres(unit)) ? 'm³' : unitLabel(unit);

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a quantity in its own unit, optionally converted to the display UoM.
 *
 * Whole numbers for every native unit: a fractional board foot is noise, the
 * sandbox veneer and oval lots are whole, and half an oval is not a thing you
 * can put on a truck. Cubic metres keep three decimals — a bundle is only a
 * couple of m³ and integers would collapse distinct lots onto the same figure.
 */
export const formatQty = (
  qty: number,
  unit: ArchUnit = DEFAULT_ARCH_UNIT,
  displayUom: string = ARCH_UOM_NATIVE,
): string => {
  const v = convertQty(qty, unit, displayUom);
  if (displayUom === ARCH_UOM_M3 && supportsCubicMetres(unit)) {
    return v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  // `|| 0` normalizes -0, which Intl would otherwise render as "-0".
  return (Math.round(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
};

/** Quantity followed by its unit — "1,158 BF", "87 SQFT", "3 units". */
export const formatQtyWithUnit = (
  qty: number,
  unit: ArchUnit = DEFAULT_ARCH_UNIT,
  displayUom: string = ARCH_UOM_NATIVE,
): string => `${formatQty(qty, unit, displayUom)} ${displaySuffix(unit, displayUom)}`;

/**
 * Lot cost, quoted per native unit regardless of the selected display UoM.
 * Converting the cost as well as the quantity would double-apply the rate.
 *
 * An em dash for null — an ABSENT cost must never render as "$0.00", which a
 * trader would read as free stock rather than as missing data.
 */
export const formatCostPerUnit = (cost: number | null | undefined, unit: ArchUnit = DEFAULT_ARCH_UNIT): string =>
  (cost === null || cost === undefined)
    ? '—'
    : `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/${unitLabel(unit)}`;

/** Bare money, no unit suffix — for columns that already carry one in the header. */
export const formatCost = (cost: number): string =>
  `$${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Total a set of quantities that may not share a unit.
 *
 * A sales order cart can hold a Lumber line in BF and a Veneer line in SQFT.
 * Adding those into one figure is the defect this whole module exists to remove,
 * so the totals are grouped and rendered side by side instead:
 *
 *     one unit    → "1,158 BF"
 *     mixed       → "1,158 BF · 87 SQFT · 3 units"
 *     nothing     → "0 BF" (the default unit, so the bar never renders empty)
 *
 * Order is fixed rather than insertion-based so the string does not reshuffle
 * as lines are added and removed.
 */
const UNIT_ORDER: ArchUnit[] = ['BF', 'SQFT', 'LF', 'UNIT'];

/**
 * The known order first, then anything unrecognised — never dropping a unit.
 *
 * Filtering by UNIT_ORDER alone silently discarded any unit outside the list.
 * `ArchUnit` is a closed union so TypeScript says that cannot happen, but the
 * values arrive as JSON from NetSuite, and a totals line that quietly omits a
 * quantity is precisely the failure this module exists to prevent.
 */
const orderedUnits = (units: ArchUnit[]): ArchUnit[] => [
  ...UNIT_ORDER.filter((u) => units.indexOf(u) !== -1),
  ...units.filter((u) => UNIT_ORDER.indexOf(u) === -1),
];

/**
 * The units present, as a short list — "BF · SQFT · units".
 *
 * Used where a total cannot honestly be shown. It replaced the instruction
 * "filter by Category to total", which was a dead end: the ARCH cache emits an
 * empty `category` on every row because `csegitem_category` is not populated,
 * so the filter that advice pointed at has no options to choose from.
 */
export const unitListLabel = (units: ArchUnit[]): string =>
  orderedUnits(units).map((u) => unitLabel(u)).join(' · ');

export const formatUnitTotals = (
  items: Array<{ unit?: ArchUnit; qty: number }>,
  displayUom: string = ARCH_UOM_NATIVE,
): string => {
  const byUnit = new Map<ArchUnit, number>();
  items.forEach((it) => {
    const u = it.unit || DEFAULT_ARCH_UNIT;
    byUnit.set(u, (byUnit.get(u) || 0) + (it.qty || 0));
  });
  if (byUnit.size === 0) return `0 ${unitLabel(DEFAULT_ARCH_UNIT)}`;
  return orderedUnits([...byUnit.keys()])
    .map((u) => formatQtyWithUnit(byUnit.get(u) as number, u, displayUom))
    .join(' · ');
};
