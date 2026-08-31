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
 * Measured 2026-08-30 against MSL_PL_GroundTruth.json.
 *
 * ⚠️ CORRECTION (2026-08-30). An earlier version of this note claimed four of the
 * six documents were "totals only". That was WRONG and came from reading a
 * transcription limit as a document property. The ground truth hand-transcribes
 * per bundle for TWO documents; the other four carry `coverageOnly: true` or a
 * `scoredClasses` list that stops at totals, which says the TRANSCRIBER stopped
 * there, not that the paperwork has no breakdown. Their per-bundle shape is
 * simply unknown.
 *
 * What the two transcribed documents do prove, across all 32 bundles:
 *
 *   314307 IPE  14 bundles  0.75" x 5.5", lengths 8/10/12/14/16/18/20 ft
 *   CHECHEN     18 bundles  1.25" and 1.0", lengths 3-10 ft, width NOT printed
 *
 * EVERY ONE of those 32 bundles has exactly one thickness, one width (or none)
 * and one length. NOT ONE contains a matrix. The `widthsIn: [6, 9]` example in
 * payload-template.json is synthetic and the dense grid in the UI mock is drawn
 * by a random fixture generator.
 *
 * ⚠️ So a per-bundle matrix view is the WRONG GRAIN. A bundle is one cell. The
 * distribution a trader wants - "which lengths do I hold, and how many" - lives
 * ACROSS bundles of the same item, which is what toLengthDistribution() builds.
 * The per-bundle shape below is kept because the schema permits richer bundles
 * and a future supplier may send one, but it is not the primary view.
 *
 * CHECHEN prints "Anchos: RW" (random width), so a width-less bundle is a first
 * class case and not an error. Its header also says "Largos: RL", but the ground
 * truth records a 2026-07-16 correction: every package row DOES print its length.
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
  /** Printed width, when the supplier prints one. Null for random-width (RW) stock. */
  width?: { raw: string | null; inches: number | null } | null;
  /** The bundle's single length, when it has one. Every real bundle so far does. */
  lengthFt?: number | null;
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

/** One length across a set of bundles: the view that actually matters. */
export interface TallyDistRow {
  lengthFt: number | null;
  label: string;
  bundles: number;
  /** Bundle numbers at this length, so the trader can go find them. */
  bundleNos: string[];
  pieces: number;
  volumeM3: number | null;
  boardFeet: number | null;
}

/**
 * Group bundles by length.
 *
 * THIS IS THE PRIMARY TALLY VIEW. Every hand-verified bundle is a single length,
 * so the distribution a trader reads ("do I have enough 12-footers?") only exists
 * once bundles are grouped. Pass the bundles that share an item and a thickness.
 *
 * Sums are plain addition of what the document printed. Nothing is derived, so a
 * column stays null when no bundle printed it rather than showing a partial total
 * that looks complete.
 */
export const toLengthDistribution = (bundles: TallyBundle[]): TallyDistRow[] => {
  const byLen = new Map<string, TallyDistRow & { _m3seen: boolean; _bfseen: boolean }>();
  for (const b of bundles || []) {
    const len = b?.lengthFt ?? b?.matrix?.rows?.[0]?.lengthFt ?? null;
    const key = len == null ? '—' : String(len);
    let row = byLen.get(key);
    if (!row) {
      row = { lengthFt: len, label: len == null ? '—' : `${len}'`, bundles: 0, bundleNos: [],
        pieces: 0, volumeM3: null, boardFeet: null, _m3seen: false, _bfseen: false };
      byLen.set(key, row);
    }
    row.bundles += 1;
    if (b.bundleNo) row.bundleNos.push(b.bundleNo);
    row.pieces += Number(b.totals?.pieces) || 0;
    if (b.totals?.volumeM3 != null) { row.volumeM3 = (row.volumeM3 || 0) + b.totals.volumeM3; row._m3seen = true; }
    if (b.totals?.boardFeet != null) { row.boardFeet = (row.boardFeet || 0) + b.totals.boardFeet; row._bfseen = true; }
  }
  return [...byLen.values()]
    .sort((a, b) => (a.lengthFt ?? Infinity) - (b.lengthFt ?? Infinity))
    .map(({ _m3seen, _bfseen, ...r }) => ({
      ...r,
      volumeM3: r.volumeM3 == null ? null : Math.round(r.volumeM3 * 1000) / 1000,
      boardFeet: r.boardFeet == null ? null : Math.round(r.boardFeet),
    }));
};
