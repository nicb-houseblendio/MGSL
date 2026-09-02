/**
 * Tally fixtures, generated from MSL_PL_GroundTruth.json. DO NOT HAND-EDIT.
 *
 * Regenerate: node scratchpad/genfix.mjs <path-to-MSL_PL_GroundTruth.json> <out.ts>
 *
 * ── WHAT IS AND IS NOT IN HERE ───────────────────────────────────────────────
 * The ground truth hand-transcribes PER BUNDLE for exactly TWO of its six
 * documents. The other four are scored at document level only - they carry
 * `coverageOnly: true` or a `scoredClasses` list that stops at totals. That is a
 * limit of the TRANSCRIPTION, not a statement that those documents lack a
 * breakdown. We do not know their per-bundle shape and must not imply we do, so
 * they appear below as UNTRANSCRIBED_DOCS with their real document totals and no
 * invented bundles.
 *
 * ── THE MEASURED SHAPE, and it is not what the mock assumes ──────────────────
 * Across all 32 hand-transcribed bundles, EVERY ONE has exactly one thickness,
 * one width (or none printed) and one length. Not one bundle contains a matrix.
 * The per-bundle grid in the UI mock has zero support in the paperwork.
 *
 * The distribution a trader actually wants runs ACROSS bundles of the same item:
 *
 *   314307  14 bundles  0.75" x 5.5" IPE, lengths 8/10/12/14/16/18/20 ft
 *   CHECHEN 18 bundles  1.25" and 1.0", lengths 3-10 ft, width printed "Anchos: RW"
 *
 * So the useful view is a LENGTH DISTRIBUTION built by grouping bundles, which is
 * what toLengthDistribution() in archTally.ts produces. See that file.
 */

import type { TallyPayload, TallyBundle } from '@/lib/archTally';
import { siblingsOf } from '@/lib/archTally';

/** Packing List  030_2025 - PO 314307.pdf — 14 bundles, hand-verified, width printed */
export const TALLY_314307: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": "314307",
  "container": "MEDU7574050",
  "bundles": [
    {
      "bundleNo": "1535",
      "lot": "1535",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "5.5": 140
            }
          }
        ]
      },
      "totals": {
        "pieces": 140,
        "boardFeet": null,
        "volumeM3": 0.918
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1536",
      "lot": "1536",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "5.5": 140
            }
          }
        ]
      },
      "totals": {
        "pieces": 140,
        "boardFeet": null,
        "volumeM3": 0.918
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1537",
      "lot": "1537",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "5.5": 147
            }
          }
        ]
      },
      "totals": {
        "pieces": 147,
        "boardFeet": null,
        "volumeM3": 0.964
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1538",
      "lot": "1538",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 10,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 10,
            "pieces": {
              "5.5": 140
            }
          }
        ]
      },
      "totals": {
        "pieces": 140,
        "boardFeet": null,
        "volumeM3": 1.145
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1539",
      "lot": "1539",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 10,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 10,
            "pieces": {
              "5.5": 140
            }
          }
        ]
      },
      "totals": {
        "pieces": 140,
        "boardFeet": null,
        "volumeM3": 1.145
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1540",
      "lot": "1540",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 10,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 10,
            "pieces": {
              "5.5": 140
            }
          }
        ]
      },
      "totals": {
        "pieces": 140,
        "boardFeet": null,
        "volumeM3": 1.145
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1541",
      "lot": "1541",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 12,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 12,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 1.577
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1542",
      "lot": "1542",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 12,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 12,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 1.577
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1543",
      "lot": "1543",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 14,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 14,
            "pieces": {
              "5.5": 51
            }
          }
        ]
      },
      "totals": {
        "pieces": 51,
        "boardFeet": null,
        "volumeM3": 0.583
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1544",
      "lot": "1544",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 14,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 14,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 1.839
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1545",
      "lot": "1545",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 14,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 14,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 1.839
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1546",
      "lot": "1546",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 16,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 16,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 2.1
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1547",
      "lot": "1547",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 18,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 18,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 2.361
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1548",
      "lot": "1548",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
      "width": {
        "raw": "139.7mm",
        "inches": 5.5
      },
      "widthPolicy": "printed",
      "lengthFt": 20,
      "matrix": {
        "widthsIn": [
          5.5
        ],
        "rows": [
          {
            "lengthFt": 20,
            "pieces": {
              "5.5": 161
            }
          }
        ]
      },
      "totals": {
        "pieces": 161,
        "boardFeet": null,
        "volumeM3": 2.625
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "Packing List  030_2025 - PO 314307.pdf",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/** PACKING CHECHEN S-8 04 JUN 2026.pdf — 18 bundles, hand-verified, width randomWidth */
export const TALLY_CHECHEN: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": null,
  "container": null,
  "bundles": [
    {
      "bundleNo": "14",
      "lot": "141.25\"101",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 10,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 10,
            "pieces": {
              "": 63
            },
            "declaredBF": 899
          }
        ]
      },
      "totals": {
        "pieces": 63,
        "boardFeet": 899,
        "volumeM3": 2.12
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "12",
      "lot": "121.25\"93",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 9,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 9,
            "pieces": {
              "": 31
            },
            "declaredBF": 391
          }
        ]
      },
      "totals": {
        "pieces": 31,
        "boardFeet": 391,
        "volumeM3": 0.922
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "10",
      "lot": "101.25\"95",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 9,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 9,
            "pieces": {
              "": 72
            },
            "declaredBF": 900
          }
        ]
      },
      "totals": {
        "pieces": 72,
        "boardFeet": 900,
        "volumeM3": 2.123
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "11",
      "lot": "111.25\"81",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "": 60
            },
            "declaredBF": 689
          }
        ]
      },
      "totals": {
        "pieces": 60,
        "boardFeet": 689,
        "volumeM3": 1.625
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "9",
      "lot": "91.25\"88",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "": 71
            },
            "declaredBF": 752
          }
        ]
      },
      "totals": {
        "pieces": 71,
        "boardFeet": 752,
        "volumeM3": 1.773
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "8",
      "lot": "81.25\"72",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 7,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 7,
            "pieces": {
              "": 74
            },
            "declaredBF": 724
          }
        ]
      },
      "totals": {
        "pieces": 74,
        "boardFeet": 724,
        "volumeM3": 1.708
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "7",
      "lot": "71.25\"71",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 7,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 7,
            "pieces": {
              "": 76
            },
            "declaredBF": 717
          }
        ]
      },
      "totals": {
        "pieces": 76,
        "boardFeet": 717,
        "volumeM3": 1.69
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "1\"818",
      "lot": "1\"818",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "": 77
            },
            "declaredBF": 284
          }
        ]
      },
      "totals": {
        "pieces": 77,
        "boardFeet": 284,
        "volumeM3": 0.67
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "86",
      "lot": "861\"843",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 8,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 8,
            "pieces": {
              "": 181
            },
            "declaredBF": 699
          }
        ]
      },
      "totals": {
        "pieces": 181,
        "boardFeet": 699,
        "volumeM3": 1.648
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "85",
      "lot": "851\"735",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 7,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 7,
            "pieces": {
              "": 181
            },
            "declaredBF": 615
          }
        ]
      },
      "totals": {
        "pieces": 181,
        "boardFeet": 615,
        "volumeM3": 1.45
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "84",
      "lot": "841\"733",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 7,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 7,
            "pieces": {
              "": 158
            },
            "declaredBF": 517
          }
        ]
      },
      "totals": {
        "pieces": 158,
        "boardFeet": 517,
        "volumeM3": 1.219
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "83",
      "lot": "831\"640",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 6,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 6,
            "pieces": {
              "": 193
            },
            "declaredBF": 552
          }
        ]
      },
      "totals": {
        "pieces": 193,
        "boardFeet": 552,
        "volumeM3": 1.301
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "82",
      "lot": "821\"620",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 6,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 6,
            "pieces": {
              "": 118
            },
            "declaredBF": 280
          }
        ]
      },
      "totals": {
        "pieces": 118,
        "boardFeet": 280,
        "volumeM3": 0.659
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "90",
      "lot": "901\"57",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 5,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 5,
            "pieces": {
              "": 244
            },
            "declaredBF": 543
          }
        ]
      },
      "totals": {
        "pieces": 244,
        "boardFeet": 543,
        "volumeM3": 1.28
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "92",
      "lot": "921\"41",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 4,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 4,
            "pieces": {
              "": 205
            },
            "declaredBF": 363
          }
        ]
      },
      "totals": {
        "pieces": 205,
        "boardFeet": 363,
        "volumeM3": 0.856
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "92",
      "lot": "921\"44",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 4,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 4,
            "pieces": {
              "": 32
            },
            "declaredBF": 46
          }
        ]
      },
      "totals": {
        "pieces": 32,
        "boardFeet": 46,
        "volumeM3": 0.108
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "89",
      "lot": "891\"32",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 3,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 3,
            "pieces": {
              "": 80
            },
            "declaredBF": 98
          }
        ]
      },
      "totals": {
        "pieces": 80,
        "boardFeet": 98,
        "volumeM3": 0.231
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "88",
      "lot": "881\"313",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "25.4mm",
        "inches": 1
      },
      "width": null,
      "widthPolicy": "randomWidth",
      "lengthFt": 3,
      "matrix": {
        "widthsIn": [],
        "rows": [
          {
            "lengthFt": 3,
            "pieces": {
              "": 223
            },
            "declaredBF": 287
          }
        ]
      },
      "totals": {
        "pieces": 223,
        "boardFeet": 287,
        "volumeM3": 0.677
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "PACKING CHECHEN S-8 04 JUN 2026.pdf",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/**
 * Documents the ground truth scored at DOCUMENT level only. No per-bundle data
 * exists for these, so none is fabricated. Kept so the counts stay auditable.
 */
export const UNTRANSCRIBED_DOCS = [
  {
    "key": "314776",
    "file": "PL PO 314776_KD_CWP_FAT 131-2025_PO-BL.xlsx",
    "lotCount": 14,
    "pieces": 1680,
    "volumeM3": 22.257,
    "boardFeet": null,
    "scored": "references+totals+spotLots",
    "note": null
  },
  {
    "key": "314888",
    "file": "PL IPE PO 314888 (BMOU6888755).pdf",
    "lotCount": 23,
    "pieces": 1968,
    "volumeM3": 22.142,
    "boardFeet": null,
    "scored": "coverageOnly",
    "note": "3 content streams; text-layer extractor unproven on this file (spike returned 0 runs). References hand-checked 2026-07-16 (packing-list-capture build prompt)."
  },
  {
    "key": "detail-pl",
    "file": "detail pl inv 2026_00031.xlsx",
    "lotCount": 14,
    "pieces": 1901,
    "volumeM3": 31.9613,
    "boardFeet": null,
    "scored": "references+totals",
    "note": null
  },
  {
    "key": "stuffing",
    "file": "Stuffing list.pdf",
    "lotCount": 17,
    "pieces": null,
    "volumeM3": 26.61,
    "boardFeet": null,
    "scored": "coverageOnly",
    "note": "no piece counts printed in this doc. References hand-checked 2026-07-16 (packing-list-capture build prompt)."
  }
] as const;

export const ARCH_TALLY_FIXTURES: Record<string, TallyPayload> = {
  '314307': TALLY_314307,
  CHECHEN: TALLY_CHECHEN,
};

/**
 * What the dialog needs to render a SAMPLE tally, including the fact that it is one.
 *
 * `sample` is not decoration. The bundle handed back belongs to a different shipment
 * from the lot the trader clicked, and without saying so on screen the dialog shows a
 * confident, precise, wrong tally against a real lot.
 */
export interface DemoTally {
  bundle: TallyBundle;
  siblings: TallyBundle[];
  sample: { sourceFile: string | null; po: string | null; species: string | null; container: string | null };
}

/**
 * Fixture-only: hand an ARCH lot a parsed tally so the real shapes can be seen
 * before any NetSuite record exists.
 *
 * ⚠️ A DEMO MAPPING, NOT A MATCH. Real ARCH lots are numbered "316027-1"; these
 * bundles come from unrelated shipments. Nothing claims a lot IS that bundle, and
 * the dialog MUST show the `sample` provenance whenever it uses this.
 * Deterministic by lot number so screenshots reproduce. Delete this whole export
 * when lots carry a real tally link.
 */
const DEMO_DOCS: TallyPayload[] = [TALLY_314307, TALLY_CHECHEN];

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

export const demoTallyForLot = (lotNo: string): DemoTally | null => {
  if (!lotNo) return null;
  const h = hash(lotNo);
  const doc = DEMO_DOCS[h % DEMO_DOCS.length];
  if (!doc || !doc.bundles.length) return null;
  const bundle = doc.bundles[h % doc.bundles.length];
  if (!bundle) return null;
  // Siblings are the same ITEM, not merely the same thickness. Selecting on
  // thickness alone mixes species: measured, a Sapele lot rendered 350 pieces
  // when Sapele was 50. See sameItem() in archTally.ts.
  const siblings = siblingsOf(doc.bundles, bundle);
  return {
    bundle,
    siblings,
    sample: { sourceFile: doc.provenance?.sourceFile ?? null, po: doc.po, species: bundle.species, container: doc.container ?? null },
  };
};
