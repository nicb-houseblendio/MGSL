/**
 * Read a packing-list capture record into the tally render model.
 *
 * ── THE RECORD, settled 2026-08-27 ───────────────────────────────────────────
 * Philippe's item 4 says the matrix "sera feedé par le custom record". That record
 * is `customrecord_msl_plc_capture`, and the decision is explicit:
 *
 *   record-format.md, Nic, 2026-08-27
 *     "Phase 1 tally storage REUSES the existing packing-list capture record.
 *      `customrecord_mgsl_tally` (SDD §3.3.1) will NOT be created — that section
 *      and the shell-per-PO model in §3.2.6 are superseded on this point."
 *
 * That document lives at McGillStLaurent/Architectural/Tally/record-format.md on
 * origin/master of the houseblend-clients repo, a path never checked out locally,
 * which is why several ARCH-side notes written AFTER it still describe the storage
 * question as open. It is not open.
 *
 * ── ⚠️ ONE FIELD, TWO WRITERS, TWO SHAPES ────────────────────────────────────
 * `custrecord_msl_plc_results_json` is claimed by two authorities, and both are
 * right, which is why this file sniffs instead of assuming:
 *
 *   record-format.md            "The canonical `mgsl.tally.v1` payload"
 *   MSL_LIB_CaptureCommon.js:46 "v0: written by the MR (lot report; Long Text)"
 *
 * The Cowork skill (Phase 1, operated by Carlos) writes `mgsl.tally.v1`. The email
 * capture MR writes `MSL_LIB_PLSchema.toLotReport`'s shape. They share one Long
 * Text field on one record, discriminated only by `docType` in a DIFFERENT field.
 * An earlier version of this header asserted the parser shape was the only one and
 * called archTally.ts's mgsl.tally.v1 decision "false of this record". Corrected
 * 2026-09-02: both shapes are real, `fromCaptureRecord` dispatches on the payload.
 *
 * ── WHAT buildLotMatrix CAN AND CANNOT PRODUCE ───────────────────────────────
 * Its per-lot matrix is { axis, widths[], widthsRaw[], rows[{len,lenRaw,counts,pcs,bf}],
 * colPcs{}, totPcs, totBF } where `axis` is one of none | width | length | scalar.
 * It is an if / else-if: a lot gets a WIDTH breakdown or a LENGTH breakdown, never
 * both. So the shipped parser STRUCTURALLY cannot emit a two-dimensional grid, which
 * is the same conclusion the six hand-verified documents give empirically. The
 * mgsl.tally.v1 template CAN express a grid — its worked example is 6"/9" x 8'/12' —
 * so the two shapes do not have equal expressive power and the sniff matters.
 *
 * `rows[].bf` is always null in the parser shape - it only ever fills `totBF` - so
 * per-row board feet come from the lot total, and only when the lot has a single row.
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


/* ═══════════════════════════════════════════════════════════════════════════
   The capture RECORD, as built (v0)

   record-format.md: "The account is built to v0: exactly the six fields below.
   The ~30 other `custrecord_msl_plc_*` IDs in code and RECORDS.md are the v1 full
   schema — defined as strings, NOT created in the account."
   ═══════════════════════════════════════════════════════════════════════════ */

/** The six v0 fields. Ids from MSL_LIB_CaptureCommon.js `CAP`, the code source of truth. */
export const CAPTURE_FIELDS = {
  FILE: 'custrecord_msl_plc_file',
  INTAKE_JSON: 'custrecord_msl_plc_intake_json',
  RESULT_JSON: 'custrecord_msl_plc_results_json',
  STATUS: 'custrecord_msl_plc_status',
  STATUS_REASON: 'custrecord_msl_plc_status_reason',
  BATCH_ID: 'custrecord_msl_plc_batch_id',
} as const;

/**
 * Status VALUE NAMES, never internal ids.
 *
 * record-format.md is explicit: "Resolve values by NAME, never by internal id (SB1
 * and prod lists are created manually; ids differ)". Comparing ids across
 * environments is the bug this constant exists to prevent.
 */
export const CAPTURE_STATUS = {
  PENDING: 'PENDING',
  PARSING: 'PARSING',
  AWAITING_CLAUDE: 'AWAITING_CLAUDE',
  PARSED: 'PARSED',
  MATCHED: 'MATCHED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  DUPLICATE: 'DUPLICATE',
  UNSUPPORTED: 'UNSUPPORTED',
  ERROR: 'ERROR',
} as const;

/** Statuses whose payload is safe to show a trader. */
const DISPLAYABLE = new Set<string>([CAPTURE_STATUS.PARSED, CAPTURE_STATUS.MATCHED, 'REVIEWED']);

/** One capture record as the server hands it over. All fields are raw strings. */
export interface CaptureRecord {
  id?: string | number | null;
  intakeJson?: string | null;
  resultsJson?: string | null;
  /** The status TEXT, resolved by name upstream. Never an internal id. */
  status?: string | null;
  statusReason?: string | null;
  fileUrl?: string | null;
}

export interface CaptureIntake {
  filename?: string | null;
  /** 'TALLY' for skill-pushed tallies; 'PL' / 'BOL' for email captures sharing this record. */
  docType?: string | null;
  source?: string | null;
  variant?: string | null;
}

export interface CaptureReadResult {
  payload: TallyPayload | null;
  header: CaptureHeader;
  /** Which writer produced the payload, or why nothing was read. */
  shape: 'mgsl.tally.v1' | 'lotReport' | 'unrecognised' | 'absent';
  /** True when the record is a tally rather than a PL or BOL capture. */
  isTally: boolean;
  /** True when the status says this payload may be shown. */
  displayable: boolean;
  status: string | null;
  statusReason: string | null;
}

const parseJson = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Read one capture record, sniffing which of the two payload shapes it holds.
 *
 * Never throws and never guesses. A record it cannot read comes back with
 * `payload: null` and a `shape` saying why, because the Tally View still has the
 * source PDF to fall back to and a wrong matrix is worse than no matrix.
 */
export const fromCaptureRecord = (rec: CaptureRecord | null | undefined): CaptureReadResult => {
  const status = rec?.status ? String(rec.status).trim().toUpperCase() : null;
  const statusReason = rec?.statusReason ? String(rec.statusReason) : null;
  const intake = (parseJson(rec?.intakeJson) || {}) as CaptureIntake;
  const docType = intake.docType ? String(intake.docType).trim().toUpperCase() : null;

  // docType lives in intake_json, a DIFFERENT field from the payload. A record with
  // no intake envelope is not assumed to be a tally - PL and BOL captures share this
  // record and their payloads would render as nonsense.
  const isTally = docType === 'TALLY';
  const displayable = !!status && DISPLAYABLE.has(status);

  const empty: CaptureHeader = {
    po: null, container: null, supplier: null, documentDate: null,
    sourceFile: intake.filename ?? null, needsReview: status === CAPTURE_STATUS.NEEDS_REVIEW, warnings: [],
  };

  const raw = parseJson(rec?.resultsJson);
  if (!raw) return { payload: null, header: empty, shape: 'absent', isTally, displayable, status, statusReason };

  // ── shape 1: the skill's canonical payload, used as-is
  if (raw.schema === 'mgsl.tally.v1' && Array.isArray(raw.bundles)) {
    const payload = raw as unknown as TallyPayload;
    return {
      payload,
      header: {
        po: payload.po ?? null,
        container: payload.container ?? null,
        supplier: null,
        documentDate: null,
        sourceFile: payload.provenance?.sourceFile ?? intake.filename ?? null,
        needsReview: status === CAPTURE_STATUS.NEEDS_REVIEW,
        warnings: [],
      },
      shape: 'mgsl.tally.v1',
      isTally,
      displayable,
      status,
      statusReason,
    };
  }

  // ── shape 2: the email MR's lot report, converted
  if (Array.isArray(raw.lots)) {
    const converted = fromCaptureResult(raw);
    if (converted) {
      return { payload: converted.payload, header: converted.header, shape: 'lotReport', isTally, displayable, status, statusReason };
    }
  }

  return { payload: null, header: empty, shape: 'unrecognised', isTally, displayable, status, statusReason };
};
