/**
 * Read a packing-list capture into the tally render model.
 *
 * ── WHY THIS FILE EXISTS, and it corrects archTally.ts ───────────────────────
 * Philippe's item 4 says the tally matrix "sera feedé par le custom record". That
 * custom record is `customrecord_msl_plc_capture`, and the JSON it holds in
 * `custrecord_msl_plc_results_json` is written by the SHIPPED packing-list parser
 * (MSL_LIB_PLSchema.js, SCHEMA_VERSION '1.0'). Its shape is NOT `mgsl.tally.v1`:
 *
 *   { parsedAt, engine, sourceFile,
 *     references: { po, invoice, contract, container, billOfLading, supplier, documentDate },
 *     totals:     { lotCount, pieces, volumeM3, boardFeet },
 *     lots: [ { lot, species, grade, thicknessMm, widthMm, lengthMm, pieces, volumeM3,
 *               boardFeet, printed{thickness,width,length}, matrix, needsReview } ],
 *     warnings, needsReview }
 *
 * ⚠️ archTally.ts records a decision that `mgsl.tally.v1` "is what we STORE". That is
 * true of the parsing SKILL's hand-off, and false of this record. The screen must
 * therefore read the PARSER's shape, and we adapt at the boundary rather than change
 * a parser already running in production for a front-end preference. `mgsl.tally.v1`
 * stays the render model; this file is the only place that knows about capture JSON.
 *
 * ── WHAT buildLotMatrix CAN AND CANNOT PRODUCE ───────────────────────────────
 * Its per-lot matrix is { axis, widths[], widthsRaw[], rows[{len,lenRaw,counts,pcs,bf}],
 * colPcs{}, totPcs, totBF } where `axis` is one of none | width | length | scalar.
 * It is an if / else-if: a lot gets a WIDTH breakdown or a LENGTH breakdown, never
 * both. So the shipped parser STRUCTURALLY cannot emit a two-dimensional grid, which
 * is the same conclusion the six hand-verified documents give empirically.
 *
 * `rows[].bf` is always null - the parser only ever fills `totBF` - so per-row board
 * feet come from the lot total, and only when the lot has a single row.
 *
 * A width column key is the literal string 'RW' when the document printed random
 * width. That is the parser stating a supplier practice, so it is the one honest
 * source for `widthPolicy` and the reason this adapter never guesses it.
 */

import type { TallyBundle, TallyPayload, TallyRow, WidthPolicy } from '@/lib/archTally';

/** The per-lot matrix buildLotMatrix() emits. */
export interface CaptureMatrix {
  axis?: 'none' | 'width' | 'length' | 'scalar' | string;
  widths?: Array<number | string>;
  widthsRaw?: Array<string | null>;
  rows?: Array<{
    len?: number | null;
    lenRaw?: string | null;
    counts?: Record<string, number>;
    pcs?: number | null;
    bf?: number | null;
  }>;
  colPcs?: Record<string, number>;
  totPcs?: number | null;
  totBF?: number | null;
}

export interface CaptureLot {
  lot?: string | null;
  species?: string | null;
  grade?: string | null;
  thicknessMm?: number | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  pieces?: number | null;
  volumeM3?: number | null;
  boardFeet?: number | null;
  printed?: { thickness?: string | null; width?: string | null; length?: string | null };
  matrix?: CaptureMatrix | null;
  needsReview?: boolean;
}

export interface CaptureResult {
  parsedAt?: string | null;
  engine?: string | null;
  sourceFile?: string | null;
  references?: {
    po?: string | null;
    invoice?: string | null;
    contract?: string | null;
    /** THE ANSWER TO ITEM 3. The parser already extracts this; nothing reads it yet. */
    container?: string | null;
    billOfLading?: string | null;
    supplier?: string | null;
    documentDate?: string | null;
  };
  totals?: { lotCount?: number | null; pieces?: number | null; volumeM3?: number | null; boardFeet?: number | null };
  lots?: CaptureLot[];
  warnings?: string[];
  needsReview?: boolean;
}

/** What the screen needs alongside the bundles, from the document header. */
export interface CaptureHeader {
  po: string | null;
  container: string | null;
  supplier: string | null;
  documentDate: string | null;
  sourceFile: string | null;
  needsReview: boolean;
  warnings: string[];
}

export interface CaptureTally {
  payload: TallyPayload;
  header: CaptureHeader;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const mmToIn = (mm: number | null): number | null => {
  if (mm == null) return null;
  const raw = mm / 25.4;
  // Lumber is quoted in quarters, so snap only when the value is already within a
  // rounding whisker of one. 19.05mm -> 0.75", 31.75mm -> 1.25". Never force it:
  // a genuinely odd width must stay odd rather than be tidied into a lie.
  const q = Math.round(raw * 4) / 4;
  return Math.abs(raw - q) < 1e-6 ? q : Math.round(raw * 100) / 100;
};

/**
 * A width column key is either a number or the literal 'RW'.
 *
 * 'RW' present means the DOCUMENT said random width. Anything else absent means we
 * simply do not know, which is a different thing and must not print as RW.
 */
const widthPolicyOf = (m: CaptureMatrix | null | undefined, widthMm: number | null): WidthPolicy => {
  const keys = Array.isArray(m?.widths) ? (m as CaptureMatrix).widths as Array<number | string> : [];
  if (keys.some((k) => typeof k === 'string' && k.toUpperCase() === 'RW')) return 'randomWidth';
  if (widthMm != null) return 'printed';
  if (keys.some((k) => num(k) != null)) return 'printed';
  return 'unknown';
};

/** Numeric width keys only. 'RW' is a marker, not a measurement. */
const widthsInOf = (m: CaptureMatrix | null | undefined): number[] => {
  const keys = Array.isArray(m?.widths) ? (m as CaptureMatrix).widths as Array<number | string> : [];
  const out: number[] = [];
  for (const k of keys) {
    const n = num(k);
    if (n != null && n > 0) out.push(n);
  }
  return out;
};

const toRows = (m: CaptureMatrix | null | undefined, widthsIn: number[]): TallyRow[] => {
  const src = Array.isArray(m?.rows) ? (m as CaptureMatrix).rows! : [];
  const rows: TallyRow[] = [];
  for (const r of src) {
    const pieces: Record<string, number> = {};
    const counts = r?.counts && typeof r.counts === 'object' ? r.counts : {};
    let any = false;
    for (const [k, v] of Object.entries(counts)) {
      const n = num(v);
      if (n == null) continue;
      // Keep the parser's key so a numeric width still lines up with widthsIn, but
      // collapse 'RW' to '' because it is not a column.
      const key = widthsIn.includes(Number(k)) ? String(Number(k)) : '';
      pieces[key] = (pieces[key] || 0) + n;
      any = true;
    }
    if (!any) {
      const p = num(r?.pcs);
      if (p != null) pieces[''] = p;
    }
    const row: TallyRow = { pieces };
    const len = num(r?.len);
    if (len != null) row.lengthFt = len;
    // The parser never fills rows[].bf, so nothing is read from it. Left unset so
    // the render layer falls back to the lot total for single-row lots only.
    rows.push(row);
  }
  return rows;
};

const toBundle = (l: CaptureLot): TallyBundle => {
  const m = l?.matrix ?? null;
  const widthsIn = widthsInOf(m);
  const rows = toRows(m, widthsIn);
  const thicknessMm = num(l?.thicknessMm);
  const widthMm = num(l?.widthMm);
  const lengthMm = num(l?.lengthMm);
  const rowLen = rows.length === 1 ? (rows[0].lengthFt ?? null) : null;

  return {
    bundleNo: l?.lot != null && String(l.lot).trim() !== '' ? String(l.lot) : '—',
    lot: l?.lot != null ? String(l.lot) : null,
    species: l?.species ?? null,
    thickness: { raw: l?.printed?.thickness ?? (thicknessMm != null ? `${thicknessMm}mm` : null), inches: mmToIn(thicknessMm) },
    width: widthMm != null ? { raw: l?.printed?.width ?? `${widthMm}mm`, inches: mmToIn(widthMm) } : null,
    widthPolicy: widthPolicyOf(m, widthMm),
    lengthFt: lengthMm != null ? Math.round((lengthMm / 304.8) * 1000) / 1000 : rowLen,
    matrix: rows.length ? { widthsIn, rows } : null,
    totals: { pieces: num(l?.pieces), boardFeet: num(l?.boardFeet), volumeM3: num(l?.volumeM3) },
    provenance: { page: null, confidence: null },
  };
};

/**
 * Convert one capture record's `custrecord_msl_plc_results_json` into the render
 * model, plus the document header the screen needs for Container #.
 *
 * Returns null for anything that is not a usable capture, because a half-read
 * document must fall back to the PDF rather than render a partial tally as fact.
 */
export const fromCaptureResult = (raw: unknown): CaptureTally | null => {
  let res: CaptureResult | null = null;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { res = JSON.parse(raw) as CaptureResult; } catch { return null; }
  } else if (raw && typeof raw === 'object') {
    res = raw as CaptureResult;
  }
  if (!res || !Array.isArray(res.lots) || res.lots.length === 0) return null;

  const refs = res.references || {};
  const header: CaptureHeader = {
    po: refs.po ?? null,
    container: refs.container ?? null,
    supplier: refs.supplier ?? null,
    documentDate: refs.documentDate ?? null,
    sourceFile: res.sourceFile ?? null,
    needsReview: !!res.needsReview,
    warnings: Array.isArray(res.warnings) ? res.warnings : [],
  };

  const payload: TallyPayload = {
    schema: 'mgsl.tally.v1',
    po: header.po,
    bundles: res.lots.map((l) => toBundle(l)),
    provenance: {
      sourceFile: header.sourceFile,
      parsedAt: res.parsedAt ?? null,
      skill: res.engine ?? null,
      reviewedBy: null,
    },
  };

  return { payload, header };
};

/**
 * The bundles that belong to one NetSuite lot.
 *
 * The parser's `lot` is the supplier's BUNDLE number off the document, which is not
 * the NetSuite inventory number - matching the two is the open piece of item 4 and
 * needs a link nobody has written yet. Until then this matches exactly, so a lot
 * either finds its bundle or shows nothing. It never falls back to a near match:
 * attaching the wrong shipment's tally to a lot is the failure that matters.
 */
export const bundlesForLot = (payload: TallyPayload | null, lotNo: string): TallyBundle[] => {
  if (!payload || !Array.isArray(payload.bundles) || !lotNo) return [];
  const want = String(lotNo).trim().toUpperCase();
  return payload.bundles.filter((b) => String(b.lot ?? '').trim().toUpperCase() === want);
};
