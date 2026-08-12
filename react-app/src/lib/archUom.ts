/**
 * CWP ARCH units.
 *
 * Hardwood is tracked in BOARD FEET — 1 BF = 1" thick x 1' long x 1' wide.
 * Unlike MTL/IND there are no packs and no PPP, so there is no pack factor and
 * no MBF display mode: the stored number IS the displayed number in BF.
 *
 * The only conversion is cubic metres, needed because European packing lists
 * arrive metric. Rate is Marc-Antoine's stated figure (2026-08-11 call):
 *
 *     1 m3 = 423 BF
 *
 * (The offline POC's `UOM_FACTORS` table is NOT the source of truth here — it
 * mixes an MBF-based m3 factor with a BF-based identity factor. Don't port it.)
 */

export const BF_PER_CUBIC_METRE = 423;

export const ARCH_UOM_BF = 'BF';
export const ARCH_UOM_M3 = 'Cubic meters (m³)';

export const ARCH_UOMS: string[] = [ARCH_UOM_BF, ARCH_UOM_M3];

/** Convert a stored board-foot quantity into the display unit. */
export const convertBF = (bf: number, uom: string): number => {
  if (uom === ARCH_UOM_M3) return bf / BF_PER_CUBIC_METRE;
  return bf;
};

/**
 * Format a quantity for display.
 * BF reads as a whole number (a fractional board foot is noise); m3 keeps three
 * decimals, since a whole bundle is only a couple of cubic metres and rounding
 * to integers would collapse distinct lots onto the same figure.
 */
export const formatArchQty = (bf: number, uom: string): string => {
  const v = convertBF(bf, uom);
  if (uom === ARCH_UOM_M3) {
    return v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  // `|| 0` normalizes -0, which Intl would otherwise render as "-0".
  return (Math.round(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
};

/** Board feet, always — used inside the tally where the unit is fixed. */
export const formatBF = (bf: number): string =>
  (Math.round(bf) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Lot cost is quoted per board foot regardless of the display UoM. */
export const formatCostPerBF = (costPerBF: number): string =>
  `$${costPerBF.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short unit suffix for badges and column headers. */
export const uomSuffix = (uom: string): string => (uom === ARCH_UOM_M3 ? 'm³' : 'BF');
