#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generates src/lib/archTallyDetailPL.ts from the supplier xlsx.

WHY THIS SCRIPT IS COMMITTED. archTallyFixtures.ts carries a header saying
"DO NOT HAND-EDIT / Regenerate: node scratchpad/genfix.mjs", and that generator
does not exist anywhere - it lived in a session scratchpad. So the file it guards
is hand-maintained under a comment forbidding hand-editing. This script exists in
the repo precisely so that does not happen twice.

SOURCE (not in this repo; second repo, origin/master only):
  McGillStLaurent/Architectural/Packing List/Examples/detail pl inv 2026_00031.xlsx
  blob 109056c384f1918381860da06e2b3bfe1adae0cb, 13,442 bytes

RUN:
  R="D:/HouseBlend/Github Repo/houseblend-clients"
  P="McGillStLaurent/Architectural/Packing List/Examples/detail pl inv 2026_00031.xlsx"
  git -C "$R" show "origin/master:$P" > /tmp/detail.xlsx
  python scripts/gen-detail-pl.py /tmp/detail.xlsx src/lib/archTallyDetailPL.ts

Stdlib only - zipfile + ElementTree. openpyxl is NOT required and NOT installed.

⚠️ TWO TRAPS IN THIS DOCUMENT, both handled below, both of which produce
   plausible-looking wrong numbers if you miss them:

1. THE COLUMN LABELS SKIP. Row 1 runs col01..col08 then jumps straight to col13;
   col09..col12 do not exist. There are 31 width columns, not 35. Deriving a width
   from the colNN label arithmetically is wrong by 40mm on 23 of the 31 columns -
   col13 is 180MM, not 220MM. ALWAYS read the width from ROW 2.

2. t_thick AND t_len ARE STRINGS, not numbers: '25.00mm', '2700.00mm'. Feeding them
   to a numeric parse without stripping the suffix throws.

⚠️ VOLUME IS COPIED, NEVER RECOMPUTED. The document's t_vol has no reproducible
   rounding contract: 9 rows are authored at 3dp and 5 at 4dp, and two rows (A1831,
   A1847) truncate where the other twelve round half-up. A validator that recomputed
   volume would flag 11 of 14 genuine rows as failures. We reconcile once, here, and
   store what the document printed.
"""

import json
import re
import sys
import zipfile
from decimal import Decimal
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
TOL = Decimal('0.0005')  # max residual seen is 0.0005 m3 on row A3546


def load_cells(path):
    z = zipfile.ZipFile(path)
    shared = [
        ''.join(t.text or '' for t in si.iter('{%s}t' % NS['m']))
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)
    ]
    sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    cells = {}
    for c in sheet.iter('{%s}c' % NS['m']):
        v = c.find('m:v', NS)
        if v is None or v.text is None:
            continue
        cells[c.get('r')] = shared[int(v.text)] if c.get('t') == 's' else v.text
    return cells


def mm_to_in(mm):
    """Mirrors mmToIn in archTallyCapture.ts exactly. Snaps to quarters only when
    already within a whisker, else 2dp. A genuinely odd width stays odd."""
    raw = mm / 25.4
    q = round(raw * 4) / 4
    return q if abs(raw - q) < 1e-6 else round(raw * 100) / 100


def mm_to_ft(mm):
    """Mirrors archTallyCapture.ts:213."""
    return round((mm / 304.8) * 1000) / 1000


def parse(path):
    cells = load_cells(path)
    colof = lambda r: re.match(r'([A-Z]+)', r).group(1)
    rowof = lambda r: int(re.match(r'[A-Z]+(\d+)', r).group(1))
    row1 = {colof(k): v for k, v in cells.items() if rowof(k) == 1}
    row2 = {colof(k): v for k, v in cells.items() if rowof(k) == 2}

    # TRAP 1: width comes from ROW 2, never from the colNN label in row 1.
    width_cols = {c: int(row2[c].replace('MM', '')) for c in row2 if row2[c].endswith('MM')}
    assert len(width_cols) == 31, 'expected 31 width columns, found %d' % len(width_cols)

    hdr = {v: k for k, v in row1.items()}
    get = lambda rw, name: cells.get(hdr[name] + str(rw))
    strip_mm = lambda s: Decimal(re.sub(r'[^0-9.]', '', s))  # TRAP 2

    bundles, failures = [], []
    for rw in range(3, 17):
        if not get(rw, 't_bdleno'):
            continue
        thick, length = strip_mm(get(rw, 't_thick')), strip_mm(get(rw, 't_len'))
        pieces = {}
        for col, w in width_cols.items():
            v = cells.get(col + str(rw))
            if v and int(float(v)) != 0:
                pieces[w] = int(float(v))

        stated_pcs = int(float(get(rw, 't_pcs')))
        stated_vol = Decimal(repr(float(get(rw, 't_vol'))))
        recomputed = sum(
            Decimal(n) * Decimal(w) * thick * length for w, n in pieces.items()
        ) / Decimal(10 ** 9)

        ok_p = sum(pieces.values()) == stated_pcs
        ok_v = abs(recomputed - stated_vol) <= TOL
        if not (ok_p and ok_v):
            failures.append((get(rw, 't_bdleno'), ok_p, ok_v, str(recomputed), str(stated_vol)))

        bundles.append({
            'bundleNo': get(rw, 't_bdleno'),
            'species': get(rw, 't_spcdescr'),
            'grade': get(rw, 't_gddescr'),
            'thickRaw': get(rw, 't_thick'),
            'thickMm': float(thick),
            'lengthRaw': get(rw, 't_len'),
            'lengthMm': float(length),
            'pieces': stated_pcs,
            'volumeM3': float(stated_vol),
            'widths': dict(sorted(pieces.items())),
            'residual': float(recomputed - stated_vol),
        })

    meta = {
        'container': get(3, 't_cont'),
        'docLot': get(3, 't_lotno'),
        'contract': get(3, 't_scno'),
        'totalPieces': int(float(cells['AN18'])),
        'totalVolume': float(Decimal(repr(float(cells['AO18'])))),
        'totalBundles': int(float(cells['AP18'])),
    }
    return bundles, meta, failures


def emit(bundles, meta):
    def bundle_ts(b):
        widths = sorted(b['widths'])
        pieces = ', '.join('%r: %d' % (str(w), b['widths'][w]) for w in widths)
        return """  {
    bundleNo: %s,
    lot: null,
    species: %s,
    grade: %s,
    thickness: { raw: %s, inches: %s },
    width: null,
    widthPolicy: 'printed',
    lengthFt: %s,
    matrix: {
      widthUnit: 'mm',
      widthsIn: [%s],
      rows: [{ lengthFt: %s, pieces: { %s } }],
    },
    totals: { pieces: %d, boardFeet: null, volumeM3: %s },
  },""" % (
            json.dumps(b['bundleNo']), json.dumps(b['species']), json.dumps(b['grade']),
            json.dumps(b['thickRaw']), mm_to_in(b['thickMm']),
            mm_to_ft(b['lengthMm']),
            ', '.join(str(w) for w in widths),
            mm_to_ft(b['lengthMm']), pieces.replace("'", '"'),
            b['pieces'], repr(b['volumeM3']),
        )

    worst = max(abs(b['residual']) for b in bundles)
    return """/**
 * detail pl inv 2026_00031.xlsx - the only multi-width supplier document we hold.
 *
 * GENERATED by scripts/gen-detail-pl.py. Do not hand-edit; the generator is committed
 * next to this file precisely so it can be re-run (unlike archTallyFixtures.ts, whose
 * generator was lost with a scratchpad).
 *
 * WHY IT MATTERS. Until this was read, archTally.ts asserted that no real document
 * carries a per-bundle matrix. It does: %d bundles, one thickness and ONE length each,
 * but 11 to 22 distinct WIDTHS across %d populated columns from 100mm to 400mm in even
 * 10mm steps.
 *
 * RECONCILED %d/%d on both axes against the document's own totals row:
 *   pieces  - each bundle's width counts sum to its stated t_pcs, exactly
 *   volume  - sum(pieces x width_mm x thick_mm x len_mm) / 1e9 matches stated t_vol,
 *             worst residual %s m3
 *   totals  - %d pieces, %s m3, %d bundles
 *
 * ⚠️ NOT IN DEMO_DOCS, DELIBERATELY. This document is metric (2400-4500mm), so through
 * rowLabel() its lengths render as 7.874' / 8.858' / 9.843' - correct and unreadable.
 * Adding it to the demo rotation would degrade the working length view on roughly a
 * third of ARCH lots. It feeds tests and the width view only.
 *
 * ⚠️ Widths are stored in MILLIMETRES with matrix.widthUnit = 'mm'. Converting the even
 * 10mm steps to inches yields 3.937 / 4.331 / 4.724, which stop round-tripping the
 * moment any consumer rounds them.
 *
 * The document names a sales contract (%s), not a PO, so `po` is null. `lot` is null on
 * every bundle: the per-bundle key here is t_bdleno (%s...), while t_lotno is
 * document-level (%s) and shared by all %d - keying on it would make bundlesForLot()
 * return the whole document for any lot.
 */

import type { TallyPayload } from '@/lib/archTally';

export const TALLY_DETAIL_PL: TallyPayload = {
  schema: 'mgsl.tally.v1',
  po: null,
  container: %s,
  bundles: [
%s
  ],
  provenance: {
    sourceFile: 'detail pl inv 2026_00031.xlsx',
    parsedAt: null,
    skill: 'gen-detail-pl.py@1 (stdlib xlsx read, reconciled)',
    reviewedBy: null,
  },
};

/** The document's own totals row, for tests to assert against. */
export const DETAIL_PL_TOTALS = { bundles: %d, pieces: %d, volumeM3: %s } as const;
""" % (
        len(bundles), 31, len(bundles), len(bundles), repr(round(worst, 6)),
        meta['totalPieces'], repr(meta['totalVolume']), meta['totalBundles'],
        meta['contract'], bundles[0]['bundleNo'], meta['docLot'], len(bundles),
        json.dumps(meta['container']),
        '\n'.join(bundle_ts(b) for b in bundles),
        meta['totalBundles'], meta['totalPieces'], repr(meta['totalVolume']),
    )


def main():
    src, out = sys.argv[1], sys.argv[2]
    bundles, meta, failures = parse(src)

    print('bundles           : %d' % len(bundles))
    print('pieces (stated)   : %d  vs totals row %d' % (
        sum(b['pieces'] for b in bundles), meta['totalPieces']))
    print('volume (stated)   : %s  vs totals row %s' % (
        sum(Decimal(repr(b['volumeM3'])) for b in bundles), meta['totalVolume']))
    print('widths per bundle : %s' % [len(b['widths']) for b in bundles])
    print('reconciliation    : %s' % (
        'ALL %d/%d PASS' % (len(bundles), len(bundles)) if not failures
        else 'FAILURES %s' % failures))

    if failures:
        sys.exit('refusing to emit: %d row(s) do not reconcile' % len(failures))
    if sum(b['pieces'] for b in bundles) != meta['totalPieces']:
        sys.exit('refusing to emit: piece total disagrees with the document')

    with open(out, 'w', encoding='utf-8', newline='') as f:
        f.write(emit(bundles, meta))
    print('-> wrote %s' % out)


if __name__ == '__main__':
    main()
