/**
 * Bundle tally: the storage contract and the render adapter.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Two rival matrix shapes ship in the houseblend-clients repo and neither derives
 * from the other:
 *
 *   payload-template.json  `mgsl.tally.v1`  { widthsIn[], rows[{lengthFt, pieces{}}] }
 *   MSL_LIB_PLSchema.js    buildLotMatrix() { axis, widths[], rows[{len,counts{},pcs,bf}] }
 *
 * DECISION (2026-08-31): `mgsl.tally.v1` is what we STORE and what the parsing skill
 * hands over. It is named canonical by record-format.md, it is the hand-off contract
 * between the skill and NetSuite, and it is the only one of the two that can express
 * a length RANGE row. `buildLotMatrix`'s shape is a rendering convenience and is NOT
 * persisted. This file converts one to the other so only one of them is ever stored.
 *
 * ── WHAT THE REAL DOCUMENTS ACTUALLY LOOK LIKE ───────────────────────────────
 * Measured 2026-08-31 against all six hand-verified documents in
 * MSL_PL_GroundTruth.json. NOT ONE contains a two-dimensional width x length grid:
 *
 *   314307 IPE      14 lots  thickness + width + length + pieces   -> SCALAR per lot
 *   CHECHEN         18 lots  thickness + length, width "RW"        -> BY LENGTH only
 *   314776 xlsx     14 lots  totals only
 *   detail-pl xlsx  14 lots  totals only
 *   314888 pdf      23 lots  totals only
 *   Stuffing list   17 lots  totals only
 *
 * The `widthsIn: [6, 9]` example in payload-template.json is SYNTHETIC. The dense
 * grid in the UI mock is drawn by a fixture generator, not taken from paperwork.
 *
 * ⚠️ So the renderer must lead with SCALAR and BY-LENGTH and treat the grid as the
 * rare case, not the other way round. A UI built grid-first would look right in a
 * demo and be wrong on every real document the client owns.
 *
 * CHECHEN also prints "Anchos: RW" / "Largos: RL" — random width and length. Any
 * numeric per-lot width there is a hallucination, which is why `none` is a first
 * class density and not an error state.
 */

/** A row of a bundle matrix. Either one length, or a declared range. */
export interface TallyRow {
  lengthFt?: number;
  /** Range rows carry min+max instead of lengthFt. Added in v1.1 of the SDD. */
  lengthFtMin?: number;
  lengthFtMax?: number;
  /** width (as a string key, matching widthsIn) -> piece count */
  pieces: Record<string, number>;
  /** Present when the document states board feet for the row rather than deriving it. */
  declaredBF?: number;
}

export interface TallyMatrix {
  /** Column headers. Empty when the supplier prints random width (RW). */
  widthsIn: number[];
  rows: TallyRow[];
}

export interface TallyBundle {
  bundleNo: string;
  /** NetSuite lot, when the document could be tied to one. Null before matching. */
  lot: string | null;
  species: string | null;
  thickness: { raw: string | null; inches: number | null } | null;
  /** Null when the document carries no per-bundle breakdown at all. */
  matrix: TallyMatrix | null;
  totals: { pieces: number | null; boardFeet: number | null; volumeM3: number | null };
  provenance?: { page?: number | null; confidence?: number | null };
}

export interface TallyPayload {
  schema: 'mgsl.tally.v1';
  po: string | null;
  bundles: TallyBundle[];
  provenance?: {
    sourceFile?: string | null;
    parsedAt?: string | null;
    skill?: string | null;
    reviewedBy?: string | null;
  };
}

/**
 * How much dimensional detail a bundle actually has.
 *
 * Ordered by how much the trader can see, and every one of these occurs in the real
 * documents except `grid`, which occurs in none of them.
 */
export type TallyDensity =
  /** widths x lengths, more than one of each. Zero real examples so far. */
  | 'grid'
  /** several lengths, one width (or width unknown). CHECHEN. */
  | 'byLength'
  /** several widths, one length. */
  | 'byWidth'
  /** exactly one width and one length. 314307. */
  | 'scalar'
  /** pieces and volume only, no breakdown. The four totals-only documents. */
  | 'none';

export interface TallyRenderRow {
  /** "8'" or "12-14'" */
  label: string;
  /** aligned to widths[]; null where the document gives no width breakdown */
  counts: (number | null)[];
  pieces: number;
  boardFeet: number | null;
}

export interface TallyRenderShape {
  density: TallyDensity;
  /** Column headers as display strings. Empty for byLength with unknown width. */
  widths: string[];
  rows: TallyRenderRow[];
  totals: { pieces: number | null; boardFeet: number | null; volumeM3: number | null };
  /** Why there is no matrix, when density is 'none'. Shown instead of an empty grid. */
  emptyReason?: string;
}

const rowPieces = (r: TallyRow): number =>
  Object.values(r.pieces || {}).reduce((a, b) => a + (Number(b) || 0), 0);

const rowLabel = (r: TallyRow): string => {
  if (r.lengthFtMin != null && r.lengthFtMax != null) return `${r.lengthFtMin}-${r.lengthFtMax}'`;
  if (r.lengthFt != null) return `${r.lengthFt}'`;
  return '—';
};

/**
 * Board feet for one row.
 *
 * Uses the DECLARED value when the document states one. A range row cannot be
 * derived (you do not know how many pieces are at 12' versus 14'), which is exactly
 * why `declaredBF` exists in the schema, so a derived figure there would be invented.
 */
const rowBoardFeet = (r: TallyRow, thicknessIn: number | null): number | null => {
  if (r.declaredBF != null) return r.declaredBF;
  if (r.lengthFt == null || thicknessIn == null) return null;
  let bf = 0;
  for (const [w, n] of Object.entries(r.pieces || {})) {
    const width = Number(w);
    const count = Number(n) || 0;
    if (!isFinite(width) || width <= 0) return null;
    bf += (thicknessIn * width * (r.lengthFt * 12) * count) / 144;
  }
  return Math.round(bf * 100) / 100;
};

/**
 * Convert a stored bundle into something a table can render, and say plainly how
 * much detail it has. Never throws: an unparseable bundle degrades to `none` with a
 * reason, because the dialog still has a PDF to fall back to.
 */
export const toRenderShape = (bundle: TallyBundle): TallyRenderShape => {
  const totals = bundle?.totals || { pieces: null, boardFeet: null, volumeM3: null };
  const m = bundle?.matrix;

  if (!m || !Array.isArray(m.rows) || m.rows.length === 0) {
    return {
      density: 'none',
      widths: [],
      rows: [],
      totals,
      emptyReason: 'This document lists bundle totals only, with no length or width breakdown.',
    };
  }

  const widths = Array.isArray(m.widthsIn) ? m.widthsIn.filter((w) => Number.isFinite(w)) : [];
  const thicknessIn = bundle.thickness?.inches ?? null;
  const distinctLengths = new Set(m.rows.map(rowLabel)).size;

  const density: TallyDensity =
    widths.length > 1 && distinctLengths > 1 ? 'grid'
      : distinctLengths > 1 ? 'byLength'
        : widths.length > 1 ? 'byWidth'
          : 'scalar';

  const rows: TallyRenderRow[] = m.rows.map((r) => ({
    label: rowLabel(r),
    counts: widths.length
      ? widths.map((w) => {
          const v = r.pieces?.[String(w)];
          return v == null ? null : Number(v);
        })
      : [rowPieces(r)],
    pieces: rowPieces(r),
    boardFeet: rowBoardFeet(r, thicknessIn),
  }));

  return {
    density,
    // A single unnamed column is not a width, so do not print a fake header for it.
    widths: widths.length ? widths.map((w) => `${w}"`) : [],
    rows,
    totals,
  };
};

/** Human label for the density, used in the dialog so the trader knows what they are looking at. */
export const densityLabel = (d: TallyDensity): string => ({
  grid: 'widths × lengths',
  byLength: 'by length',
  byWidth: 'by width',
  scalar: 'single dimension',
  none: 'totals only',
}[d]);
