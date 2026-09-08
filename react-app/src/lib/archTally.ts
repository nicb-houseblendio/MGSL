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
 * and one length. None of the 32 contains a matrix.
 *
 * ⚠️⚠️ CORRECTION (2026-09-04), AND IT REVERSES THE CONCLUSION THIS NOTE USED TO
 * DRAW. The paragraph above is true of the 32 TRANSCRIBED bundles and was then
 * generalised to the corpus. That generalisation was wrong, and it is the same
 * mistake as the 2026-08-30 correction above: reading a transcription limit as a
 * document property.
 *
 * A THIRD document was read directly on 2026-09-04, not through the ground truth:
 *
 *   detail pl inv 2026_00031.xlsx   14 bundles, SAPELI KD, container CAAU9944443
 *     one thickness (25mm) and ONE length per bundle, but 11 to 22 DISTINCT
 *     WIDTHS each, across 28 populated columns from 100mm to 400mm in 10mm steps
 *
 * It reconciles 14/14 on pieces (width columns sum to `t_pcs`) and 14/14 on volume,
 * to document totals of 1,901 pieces and 31.9613 m3. So a real supplier document
 * DOES carry a per-bundle width breakdown, at far higher cardinality than the
 * `widthsIn: [6, 9]` template example - that literal is synthetic, but what it
 * expresses is attested.
 *
 * Two further claims this note used to make, both withdrawn:
 *   - "the dense grid in the UI mock is drawn by a random fixture generator" is
 *     FALSE. `demoTallyForLot` is a deterministic `h*31 + charCodeAt` hash and
 *     there is no `Math.random` in any ARCH tally file.
 *   - "A bundle is one cell" is false for this document: a bundle is one LENGTH
 *     spanning many WIDTHS, i.e. a row of a width matrix.
 *
 * ⚠️ SO THERE ARE TWO CORRECT GRAINS, NOT ONE, AND THEY ARE NOT ALTERNATIVES.
 * A lot is one bundle (Marc-Antoine, 2026-09: one PO line per thickness, three
 * lines yielding 24 bundles, PO number plus an increment per bundle). Therefore:
 *   - ACROSS bundles of an item, the distribution is by LENGTH. That is what a
 *     trader asks first ("do I hold enough 12-footers?") and it only exists once
 *     bundles are grouped, since no bundle spans two lengths. toLengthDistribution().
 *   - WITHIN one bundle, the breakdown is by WIDTH. No sibling set is involved, so
 *     it needs neither sameItem() nor siblingsOf() - and must not relax either,
 *     because the width equality in sameItem() is what stopped a measured bug
 *     where a Sapele lot rendered 350 pieces against a real 50.
 *
 * Multi-row bundles and length ranges are still handled below because the schema
 * permits them, though no document we hold uses either.
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
  /**
   * Column headers, in the unit `widthUnit` declares. Empty when the supplier prints
   * random width (RW).
   *
   * NOTE THE NAME IS NOW A LIE FOR METRIC DOCUMENTS and is kept only because renaming
   * it would break the stored contract with the parsing skill. Read `widthUnit`.
   */
  widthsIn: number[];
  /**
   * The unit `widthsIn` and the `pieces` keys are expressed in. Defaults to inches
   * when absent, so every payload written before 2026-09-04 stays correct.
   *
   * WHY THIS EXISTS. `detail pl inv 2026_00031.xlsx` is metric: 28 populated columns
   * from 100mm to 400mm in even 10mm steps. Converting to inches turns those into
   * 3.937, 4.331, 4.724 - uneven decimals that no longer round-trip once any consumer
   * rounds them, and keys like "3.937" in the `pieces` map. Storing the document's own
   * unit and saying so is lossless; converting is not.
   *
   * This is the same rule as `widthPolicy` below: state the fact explicitly rather
   * than leaving a reader to infer it from the shape of the data.
   */
  widthUnit?: 'in' | 'mm';
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
  /**
   * Grade as the document prints it, e.g. "FIRST AND SECOND" (FAS).
   *
   * Added 2026-09-04. It had no home at all before, so the adapter dropped it:
   * `CaptureLot.grade` exists in archTallyCapture.ts and `toBundle` never read it.
   * Free text on purpose - the account's Grade segment is empty for hardwood, so
   * there is nothing to resolve an id against yet, and inventing a mapping would be
   * worse than carrying the supplier's own words.
   */
  grade?: string | null;
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
  /**
   * True when the bundles handed in are NOT all the same item.
   *
   * 🔴 A CALLER BUG, AND THE VIEW MUST NOT SHOW A TOTAL WHEN IT IS SET. This
   * function cannot know which item the trader clicked, so it cannot filter — but
   * it can tell that somebody handed it a mixture, and refuse to be the thing that
   * silently adds Sapele to African Mahogany. Selecting siblings by thickness
   * alone did exactly that: 350 pieces reported for a 50-piece Sapele lot.
   *
   * Use `siblingsOf()` to build the input and this stays false.
   */
  mixedItems: boolean;
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

  /* 🔴 COLLAPSE SAME-LENGTH LINES BEFORE ASKING "IS THIS ONE LENGTH?"
   *
   * `single` decides whether a row may carry the bundle's volume and board feet, because
   * those figures are per BUNDLE and cannot be split across lengths. It used to be
   * `rows.length === 1`, which treats two lines at the SAME length as a multi-length
   * bundle. It is not: that is one length reported on two lines, typically two width
   * groups.
   *
   * Measured 2026-09-07, and it was visible on screen: a bundle listing 8' twice showed a
   * dot for volume and BF on its only row while the Total row printed the real figures,
   * with NO dagger - `volumePartial` stayed false because no contribution had a figure to
   * begin with (`volumeSeen === 0`). A total appeared that no row accounted for, which is
   * the one error this whole model is built to refuse. */
  const merged = new Map<string, { label: string; sortKey: number; pieces: number; bf: number | null; lines: number; bfLines: number }>();
  for (const r of rows) {
    const label = rowLabel(r);
    let m = merged.get(label);
    if (!m) { m = { label, sortKey: rowSortKey(r), pieces: 0, bf: null, lines: 0, bfLines: 0 }; merged.set(label, m); }
    m.pieces += rowPieces(r);
    m.lines += 1;
    if (r.declaredBF != null) { m.bf = (m.bf || 0) + r.declaredBF; m.bfLines += 1; }
  }

  const out = [...merged.values()];
  const single = out.length === 1;
  return out.map((m) => ({
    label: m.label,
    sortKey: m.sortKey,
    pieces: m.pieces,
    volumeM3: single ? (b?.totals?.volumeM3 ?? null) : null,
    // A declared BF covering only SOME of the merged lines is not this length's board
    // feet, so it is discarded rather than summed into a figure that looks whole.
    boardFeet: m.bf != null && m.bfLines === m.lines
      ? m.bf
      : (single ? (b?.totals?.boardFeet ?? null) : null),
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

  // Homogeneity is checked here rather than trusted from the caller. Every bundle
  // must be the same item as the first; one that is not makes the totals a lie.
  const mixedItems = list.length > 1 && !list.every((b) => sameItem(b, list[0]));

  return {
    rows,
    mixedItems,
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

/**
 * The widths a bundle's MATRIX declares, or null when it has none.
 *
 * A multi-width bundle has no single printed width, so `b.width` is correctly null on
 * one - but the widths are right there in the matrix, and the two functions below used
 * to miss them entirely. See the correction note on widthNote().
 */
const matrixWidths = (b: TallyBundle): { list: number[]; unit: string } | null => {
  const list = Array.isArray(b?.matrix?.widthsIn) ? (b.matrix as TallyMatrix).widthsIn : [];
  if (!list.length) return null;
  return { list, unit: b?.matrix?.widthUnit === 'mm' ? 'mm' : '"' };
};

/** How to describe a bundle's width, without inventing a supplier practice. */
export const widthLabel = (b: TallyBundle): string => {
  if (b?.width?.inches != null) return `${b.width.inches}"`;
  const m = matrixWidths(b);
  if (m) {
    if (m.list.length === 1) return `${m.list[0]}${m.unit}`;
    return `${m.list.length} widths, ${Math.min(...m.list)}-${Math.max(...m.list)}${m.unit}`;
  }
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
  // 🔴 CORRECTION 2026-09-05. Without this branch a multi-width bundle fell through
  // to the "no width" sentence below and printed a flat falsehood: detail-pl's first
  // bundle states 19 widths and the note claimed the document gave none. These two
  // functions were written when a bundle had at most ONE width and only ever read the
  // scalar `b.width`, which is correctly null when there is no single width to state.
  // Nothing to caveat here: the breakdown is on screen.
  if (matrixWidths(b)) return '';
  if (b?.widthPolicy === 'randomWidth') {
    return 'This supplier prints random width (RW), so there is no width breakdown. Any width figure here would be invented.';
  }
  return 'This document does not give a width for these bundles, so none is shown.';
};

/* ── WIDTH, the second grain ─────────────────────────────────────────────────── */

/** One width column of a single bundle. */
export interface TallyWidthRow {
  /** The width as printed, in `unit`. Null for pieces the document did not attribute. */
  width: number | null;
  /** '150mm', '6"', or 'unstated'. */
  label: string;
  pieces: number;
  /** Share of the bundle's attributed pieces, 0..1. For a bar, not for arithmetic. */
  share: number;
}

export interface TallyWidthDistribution {
  rows: TallyWidthRow[];
  /** The unit the widths are in, taken from the matrix. Inches when undeclared. */
  unit: 'in' | 'mm';
  totals: {
    /** Distinct widths carrying stock. */
    widths: number;
    /**
     * Pieces ATTRIBUTED TO A WIDTH - deliberately not called `pieces`, because it is
     * not the bundle's total and must never be rendered as one. A random-width bundle
     * attributes nothing, so this is 0 while the bundle holds 63 pieces. The total the
     * bundle claims is `statedPieces`; whether they agree is `footsToTotal`.
     */
    attributed: number;
    /** What the bundle itself claims. Compare it: see `footsToTotal`. */
    statedPieces: number | null;
  };
  /**
   * Pieces the document placed under no width (a random-width column). Shown as its
   * own row rather than folded into a width, because attributing them would invent a
   * measurement.
   */
  unattributed: number;
  /**
   * True when there is no breakdown to show - one width or none. The caller should
   * fall back to the scalar `widthLabel(bundle)` rather than draw a one-row table.
   */
  degenerate: boolean;
  /**
   * FALSE means the width columns do not sum to the bundle's own stated piece count.
   * The view must not present a total when this is false: a partial sum shown as a
   * total is the one error a trader cannot see. Same rule as `volumePartial` above.
   */
  footsToTotal: boolean;
}

/**
 * The width breakdown WITHIN one bundle.
 *
 * ── WHY THIS TAKES ONE BUNDLE AND NOT A SET ──────────────────────────────────
 * A width breakdown is a property of a single bundle, so this needs no sibling set
 * and deliberately does not use `sameItem` or `siblingsOf`. That matters: `sameItem`
 * requires equal widths, so a sibling set can never BE multi-width, and relaxing it
 * to allow one would reopen the measured bug it was added to close (a Sapele lot
 * rendering 350 pieces against a real 50).
 *
 * So the two grains are complementary, not rival:
 *   toLengthDistribution(siblings)  - ACROSS bundles of an item, by LENGTH
 *   toWidthDistribution(bundle)     - WITHIN one bundle, by WIDTH
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 * No board feet and no volume. Both are derivable per width in principle
 * (thickness x width x length / 12 x pieces), and both are refused here, because the
 * one real multi-width document we hold states volume with no reproducible rounding
 * contract - 9 rows at 3dp, 5 at 4dp, two truncating where twelve round half-up. A
 * derived figure would disagree with the paper in the fourth decimal on most rows.
 * Pieces are integers the document prints; those are safe to sum.
 *
 * Widths are summed ACROSS length rows, so a bundle that did span two lengths still
 * yields one width distribution.
 */
export const toWidthDistribution = (bundle: TallyBundle | null | undefined): TallyWidthDistribution => {
  const unit: 'in' | 'mm' = bundle?.matrix?.widthUnit === 'mm' ? 'mm' : 'in';
  const fmt = (w: number): string => (unit === 'mm' ? `${w}mm` : `${w}"`);

  const rows = Array.isArray(bundle?.matrix?.rows) ? (bundle!.matrix as TallyMatrix).rows : [];
  const declared = Array.isArray(bundle?.matrix?.widthsIn) ? (bundle!.matrix as TallyMatrix).widthsIn : [];

  const byWidth = new Map<number, number>();
  let unattributed = 0;

  for (const r of rows) {
    for (const [k, v] of Object.entries(r?.pieces || {})) {
      const n = Number(v) || 0;
      if (!n) continue;
      // An empty key is the random-width column. A key that is not a number, or one
      // absent from widthsIn, is a parser fault - count it, never guess a width.
      const w = k === '' ? NaN : Number(k);
      if (!Number.isFinite(w) || !declared.includes(w)) { unattributed += n; continue; }
      byWidth.set(w, (byWidth.get(w) || 0) + n);
    }
  }

  const attributed = [...byWidth.values()].reduce((a, b) => a + b, 0);
  const out: TallyWidthRow[] = [...byWidth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, pieces]) => ({
      width: w,
      label: fmt(w),
      pieces,
      share: attributed > 0 ? pieces / attributed : 0,
    }));

  if (unattributed > 0) {
    out.push({ width: null, label: 'unstated', pieces: unattributed, share: 0 });
  }

  const stated = bundle?.totals?.pieces ?? null;
  return {
    rows: out,
    unit,
    totals: { widths: byWidth.size, attributed, statedPieces: stated },
    unattributed,
    // 🔴 A SINGLE WIDTH PLUS UNATTRIBUTED PIECES IS NOT DEGENERATE.
    // `byWidth.size <= 1` hid the table whenever one width column sat beside pieces the
    // document did not attribute, and those pieces then appeared NOWHERE: measured
    // 2026-09-07 on `pieces: {'6': 3, '': 2}`, the two unstated pieces vanished from the
    // UI entirely. A pure random-width bundle (size 0) stays degenerate on purpose - its
    // only row would be `unstated`, and widthNote() already explains that in a sentence.
    degenerate: byWidth.size === 0 || (byWidth.size === 1 && unattributed === 0),
    footsToTotal: stated == null ? false : attributed + unattributed === stated,
  };
};

/* ── VALIDATION: does the payload agree with itself? ──────────────────────────── */

/**
 * One way a bundle contradicts itself. Never a parse failure - the payload read fine;
 * its numbers disagree.
 */
export interface TallyBundleIssue {
  /** Position in `payload.bundles`, so a view can suppress exactly this bundle. */
  index: number;
  bundleNo: string;
  kind: 'strayWidth' | 'doesNotFoot';
  /** Plain sentence, safe to show a trader. */
  detail: string;
}

export interface TallyPayloadCheck {
  ok: boolean;
  issues: TallyBundleIssue[];
}

/**
 * Check a payload against ITSELF. Nothing did this before: `fromCaptureRecord` casts a
 * `mgsl.tally.v1` payload straight through, so a bundle claiming 50 pieces over columns
 * summing to 5,000 reached the dialog and drew a bold `Total` row as fact.
 *
 * ── THE TWO CHECKS, AND WHY EXACTLY THESE TWO ────────────────────────────────
 * 1. `strayWidth` - a `pieces` key that is not in `widthsIn`. This CANNOT be read off
 *    `toWidthDistribution`: that reducer deliberately folds an unknown key into
 *    `unattributed`, where it is indistinguishable from a genuine random-width column.
 *    So the raw rows are walked again here. A stray key means the matrix header and its
 *    body disagree, which is a parser fault, not a document one.
 * 2. `doesNotFoot` - attributed + unattributed != the bundle's own `totals.pieces`.
 *
 * ── WHAT IS DELIBERATELY NOT A FAULT ─────────────────────────────────────────
 * A bundle with NO stated total. `footsToTotal` is false in that case, but nothing is
 * wrong: the document simply did not print a total, and flagging it would put a warning
 * on every random-width bundle we hold. Only a stated total that disagrees is an issue.
 *
 * A bundle with no matrix is likewise clean - a scalar bundle has nothing to foot.
 *
 * ── AND NOT VOLUME OR BOARD FEET ─────────────────────────────────────────────
 * Same reason `toWidthDistribution` refuses to derive them: detail-pl states volume
 * with no reproducible rounding contract, so a derived check would reject 11 of 14
 * genuine rows. Pieces are integers the document prints.
 *
 * Returns a flag, never throws. A view that cannot trust one bundle still has the
 * source PDF and the other thirteen bundles.
 */
export const checkPayload = (payload: TallyPayload | null | undefined): TallyPayloadCheck => {
  const issues: TallyBundleIssue[] = [];
  const bundles = Array.isArray(payload?.bundles) ? payload!.bundles : [];

  bundles.forEach((b, index) => {
    // A non-object in the bundles array is not this function's problem to describe,
    // but it must not throw here either.
    if (!b || typeof b !== 'object') return;
    const bundleNo = String(b.bundleNo ?? index + 1);
    const m = b.matrix;
    if (!m || !Array.isArray(m.rows) || !m.rows.length) return;

    const declared = Array.isArray(m.widthsIn) ? m.widthsIn : [];
    const stray = new Set<string>();
    for (const r of m.rows) {
      for (const [k, v] of Object.entries(r?.pieces || {})) {
        if (!(Number(v) || 0)) continue;
        if (k === '') continue; // the random-width column, legitimate
        const w = Number(k);
        if (!Number.isFinite(w) || !declared.includes(w)) stray.add(k);
      }
    }
    if (stray.size) {
      issues.push({
        index, bundleNo, kind: 'strayWidth',
        detail: `Bundle ${bundleNo} counts pieces under ${[...stray].join(', ')}, which the document's width list does not contain.`,
      });
    }

    const d = toWidthDistribution(b);
    // Only a STATED total can fail to foot. See the header.
    if (d.totals.statedPieces != null && !d.footsToTotal) {
      const summed = d.totals.attributed + d.unattributed;
      issues.push({
        index, bundleNo, kind: 'doesNotFoot',
        detail: `Bundle ${bundleNo} states ${d.totals.statedPieces} pieces but its widths sum to ${summed}.`,
      });
    }
  });

  return { ok: issues.length === 0, issues };
};
