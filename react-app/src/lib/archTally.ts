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
 * DECISION (2026-08-30): `mgsl.tally.v1` is what we STORE and what the parsing skill
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
 * The richer per-bundle shapes are still handled below (multi-row bundles, length
 * ranges) because the schema permits them and a future supplier may send one, but
 * no document we hold today uses either.
 *
 * CHECHEN prints "Anchos: RW" (random width), so a width-less bundle is a first
 * class case and not an error. Its header also says "Largos: RL", but the ground
 * truth records a 2026-07-16 correction: every package row DOES print its length.
 *
 * ⚠️ ABSENCE IS NOT A POLICY. A null width means "we have no width", which covers
 * genuine random-width stock AND a document nobody has parsed yet. Never print
 * "RW" from a null - read `widthPolicy`, which the parser must set explicitly.
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

/**
 * What the DOCUMENT says about width, as distinct from what we happen to hold.
 *
 * `randomWidth` is a claim about the supplier and may only be set when the paperwork
 * actually says so (CHECHEN prints "Anchos: RW"). `unknown` is the safe default.
 */
export type WidthPolicy = 'printed' | 'randomWidth' | 'unknown';

export interface TallyBundle {
  bundleNo: string;
  /** Printed width, when the supplier prints one. Null otherwise - see widthPolicy. */
  width?: { raw: string | null; inches: number | null } | null;
  /** Why width is absent. NEVER infer this from `width` being null. */
  widthPolicy?: WidthPolicy;
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
  /**
   * The shipping container, when the document names one.
   *
   * This is Philippe's item 3. It is a DOCUMENT-level fact, not a lot-level one: a
   * packing list covers one container and every bundle on it shares that container.
   * It cannot be derived from a lot number - Marc-Antoine confirmed on 2026-08-19
   * that a container can span several POs, so the lot prefix (which is the PO) can
   * never yield it. The packing-list parser already extracts it; see archTallyCapture.
   */
  container?: string | null;
  bundles: TallyBundle[];
  provenance?: {
    sourceFile?: string | null;
    parsedAt?: string | null;
    skill?: string | null;
    reviewedBy?: string | null;
  };
}

const rowPieces = (r: TallyRow): number =>
  Object.values(r.pieces || {}).reduce((a, b) => a + (Number(b) || 0), 0);

/** "8'", or "12-14'" for a declared range. Also the grouping key. */
const rowLabel = (r: TallyRow): string => {
  if (r.lengthFtMin != null && r.lengthFtMax != null) return `${r.lengthFtMin}-${r.lengthFtMax}'`;
  if (r.lengthFt != null) return `${r.lengthFt}'`;
  return '—';
};

/** Sorts a range by its start. Unknown lengths sink to the bottom. */
const rowSortKey = (r: TallyRow): number => {
  if (r.lengthFtMin != null) return r.lengthFtMin;
  if (r.lengthFt != null) return r.lengthFt;
  return Number.POSITIVE_INFINITY;
};

/**
 * Do two bundles describe the SAME ITEM?
 *
 * 🔴 THIS IS THE SELECTION PREDICATE AND GETTING IT WRONG CONTAMINATES THE VIEW.
 * One packing list routinely carries several species. Philippe's example on the
 * 2026-08-27 call was one PO holding African Mahogany 4/4, African Mahogany 8/4 and
 * Sapele, and his requirement was that a trader looking at Sapele sees the Sapele
 * tally and nothing else. Selecting on thickness alone satisfies neither half of
 * that: measured, it renders 350 pieces across 3 bundles for a Sapele lot whose
 * real content is 50 pieces.
 *
 * An ARCH item IS species + thickness + width — that is what the grid's own
 * "Purpleheart 4/4 KD" description encodes. So all three must match.
 *
 * Nulls match nulls deliberately. A single-species document with no species
 * recorded should still group, and a random-width supplier has null width on every
 * bundle. What must NEVER happen is a null matching a value, which would let an
 * unlabelled bundle join any group.
 */
export const sameItem = (a: TallyBundle, b: TallyBundle): boolean => {
  if (!a || !b) return false;
  const norm = (v: string | null | undefined) => (v == null ? null : String(v).trim().toUpperCase());
  const dim = (v: number | null | undefined) => (v == null ? null : v);
  return norm(a.species) === norm(b.species)
    && dim(a.thickness?.inches) === dim(b.thickness?.inches)
    && dim(a.width?.inches) === dim(b.width?.inches);
};

/**
 * The bundles that belong to the same item as `bundle`, including it.
 *
 * Always use this to build the set handed to toLengthDistribution. Filtering by
 * hand is how the contamination above happened.
 */
export const siblingsOf = (bundles: TallyBundle[], bundle: TallyBundle): TallyBundle[] => {
  if (!Array.isArray(bundles) || !bundle) return bundle ? [bundle] : [];
  const kin = bundles.filter((b) => sameItem(b, bundle));
  return kin.length ? kin : [bundle];
};

/** One length (or length range) across a set of bundles: the view that matters. */
export interface TallyDistRow {
  label: string;
  /** Sort position. Infinity for rows whose length the document did not state. */
  sortKey: number;
  /** How many bundles contribute to this length. */
  bundles: number;
  /** INDICES into the array passed in, so the caller can mark rows by identity. */
  bundleIdx: number[];
  pieces: number;
  volumeM3: number | null;
  boardFeet: number | null;
  /**
   * True when SOME but not all contributors printed the figure, so the number shown
   * covers only part of the row. Render these as incomplete - a partial sum shown as
   * a total is the one error a trader cannot see.
   */
  volumePartial: boolean;
  boardFeetPartial: boolean;
}

export interface TallyDistribution {
  rows: TallyDistRow[];
  totals: {
    /** DISTINCT bundles. A bundle spanning two lengths is counted once here. */
    bundles: number;
    pieces: number;
    volumeM3: number | null;
    boardFeet: number | null;
    volumePartial: boolean;
    boardFeetPartial: boolean;
  };
}

/**
 * The rows a bundle contributes, one per length it holds.
 *
 * A bundle with no matrix still contributes one row, built from its own totals, so a
 * counted-but-unparsed bundle appears rather than vanishing.
 *
 * Volume and board feet are per-BUNDLE figures. When a bundle spans several lengths
 * they cannot be split across them - you do not know how much volume sits at 12' as
 * against 14' - so they are attributed only when the bundle has a single row.
 * `declaredBF` is the exception: the document stated it for that row.
 */
const bundleRows = (b: TallyBundle): Array<{
  label: string; sortKey: number; pieces: number; volumeM3: number | null; boardFeet: number | null;
}> => {
  const rows = Array.isArray(b?.matrix?.rows) ? (b.matrix as TallyMatrix).rows : [];

  if (rows.length === 0) {
    return [{
      label: b?.lengthFt != null ? `${b.lengthFt}'` : '—',
      sortKey: b?.lengthFt != null ? b.lengthFt : Number.POSITIVE_INFINITY,
      pieces: Number(b?.totals?.pieces) || 0,
      volumeM3: b?.totals?.volumeM3 ?? null,
      boardFeet: b?.totals?.boardFeet ?? null,
    }];
  }

  const single = rows.length === 1;
  return rows.map((r) => ({
    label: rowLabel(r),
    sortKey: rowSortKey(r),
    pieces: rowPieces(r),
    volumeM3: single ? (b?.totals?.volumeM3 ?? null) : null,
    boardFeet: r.declaredBF != null ? r.declaredBF : (single ? (b?.totals?.boardFeet ?? null) : null),
  }));
};

/**
 * Group bundles by length.
 *
 * THIS IS THE PRIMARY TALLY VIEW. Every hand-verified bundle is a single length, so
 * the distribution a trader reads ("do I have enough 12-footers?") only exists once
 * bundles are grouped. Pass the bundles that share an item and a thickness.
 *
 * Sums are plain addition of what the document printed - nothing is derived. Where
 * only some contributors printed a figure the sum is flagged partial rather than
 * shown as though it were the whole.
 */
export const toLengthDistribution = (bundles: TallyBundle[]): TallyDistribution => {
  const list = Array.isArray(bundles) ? bundles : [];

  interface Acc extends TallyDistRow { volumeSeen: number; boardFeetSeen: number; contributions: number }
  const byLabel = new Map<string, Acc>();

  list.forEach((b, idx) => {
    for (const r of bundleRows(b)) {
      let row = byLabel.get(r.label);
      if (!row) {
        row = {
          label: r.label, sortKey: r.sortKey, bundles: 0, bundleIdx: [], pieces: 0,
          volumeM3: null, boardFeet: null, volumePartial: false, boardFeetPartial: false,
          volumeSeen: 0, boardFeetSeen: 0, contributions: 0,
        };
        byLabel.set(r.label, row);
      }
      // A bundle listing the same length twice still counts once for this row.
      if (!row.bundleIdx.includes(idx)) { row.bundleIdx.push(idx); row.bundles += 1; }
      row.contributions += 1;
      row.pieces += r.pieces;
      if (r.volumeM3 != null) { row.volumeM3 = (row.volumeM3 || 0) + r.volumeM3; row.volumeSeen += 1; }
      if (r.boardFeet != null) { row.boardFeet = (row.boardFeet || 0) + r.boardFeet; row.boardFeetSeen += 1; }
    }
  });

  const rows: TallyDistRow[] = [...byLabel.values()]
    .sort((a, b) => (a.sortKey - b.sortKey) || a.label.localeCompare(b.label))
    .map(({ volumeSeen, boardFeetSeen, contributions, ...r }) => ({
      ...r,
      volumeM3: r.volumeM3 == null ? null : Math.round(r.volumeM3 * 1000) / 1000,
      boardFeet: r.boardFeet == null ? null : Math.round(r.boardFeet),
      volumePartial: volumeSeen > 0 && volumeSeen < contributions,
      boardFeetPartial: boardFeetSeen > 0 && boardFeetSeen < contributions,
    }));

  // Totals come from the bundles themselves, not from summing the rows, so a bundle
  // spanning two lengths is counted once and its volume is not double-added.
  let pieces = 0;
  let volumeM3: number | null = null;
  let boardFeet: number | null = null;
  let volumeSeen = 0;
  let boardFeetSeen = 0;
  for (const b of list) {
    pieces += Number(b?.totals?.pieces) || 0;
    if (b?.totals?.volumeM3 != null) { volumeM3 = (volumeM3 || 0) + b.totals.volumeM3; volumeSeen += 1; }
    if (b?.totals?.boardFeet != null) { boardFeet = (boardFeet || 0) + b.totals.boardFeet; boardFeetSeen += 1; }
  }

  return {
    rows,
    totals: {
      bundles: list.length,
      pieces,
      volumeM3: volumeM3 == null ? null : Math.round(volumeM3 * 1000) / 1000,
      boardFeet: boardFeet == null ? null : Math.round(boardFeet),
      volumePartial: volumeSeen > 0 && volumeSeen < list.length,
      boardFeetPartial: boardFeetSeen > 0 && boardFeetSeen < list.length,
    },
  };
};

/** How to describe a bundle's width, without inventing a supplier practice. */
export const widthLabel = (b: TallyBundle): string => {
  if (b?.width?.inches != null) return `${b.width.inches}"`;
  return b?.widthPolicy === 'randomWidth' ? 'RW' : '—';
};

/**
 * The width CAVEAT under the table, or '' when there is nothing to caveat.
 *
 * Deliberately says nothing when the width is printed: the dialog footer already
 * carries provenance, and returning a sentence here too put two near-identical
 * lines under the table.
 */
export const widthNote = (b: TallyBundle): string => {
  if (b?.width?.inches != null) return '';
  if (b?.widthPolicy === 'randomWidth') {
    return 'This supplier prints random width (RW), so there is no width breakdown. Any width figure here would be invented.';
  }
  return 'This document does not give a width for these bundles, so none is shown.';
};
