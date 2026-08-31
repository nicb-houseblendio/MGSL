/**
 * Tally fixtures, generated from the HAND-VERIFIED ground truth.
 *
 * Source: houseblend-clients @ origin/master
 *   McGillStLaurent/Architectural/Packing List/Sandbox/MSL_PL_GroundTruth.json
 *
 * NOT invented. Every figure here was read off a real supplier document and
 * cross-checked against that document's own printed totals. Generated 2026-08-31.
 *
 * ⚠️ WHAT THESE FIXTURES ARE FOR. The UI mock draws a dense width x length grid from
 * a random generator. No real document looks like that. These six do:
 *
 *   314307    scalar per bundle   thickness + width + length all printed
 *   CHECHEN   by length only      width is "RW", random, so any number is invented
 *   the rest  totals only         no per-bundle breakdown at all
 *
 * Render against these before believing any screenshot. If the matrix panel only
 * looks right on the mock's data, it is wrong.
 */
import type { TallyPayload } from '@/lib/archTally';

/** Packing List  030_2025 - PO 314307.pdf — 14 bundles */
export const TALLY_314307: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": "314307",
  "bundles": [
    {
      "bundleNo": "1535",
      "lot": "1535",
      "species": "IPE",
      "thickness": {
        "raw": "19.05mm",
        "inches": 0.75
      },
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

/** PACKING CHECHEN S-8 04 JUN 2026.pdf — 18 bundles */
export const TALLY_CHECHEN: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": null,
  "bundles": [
    {
      "bundleNo": "14",
      "lot": "141.25\"101",
      "species": "CHECHEN / METOPIUM BROWNEI",
      "thickness": {
        "raw": "31.75mm",
        "inches": 1.25
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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
        "inches": 1.0
      },
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

/** PL PO 314776_KD_CWP_FAT 131-2025_PO-BL.xlsx — 14 bundles */
export const TALLY_314776: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": "314776",
  "bundles": [
    {
      "bundleNo": "314776-1",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-2",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-3",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-4",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-5",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-6",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-7",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-8",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-9",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-10",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-11",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-12",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-13",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314776-14",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "PL PO 314776_KD_CWP_FAT 131-2025_PO-BL.xlsx",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/** detail pl inv 2026_00031.xlsx — 14 bundles */
export const TALLY_DETAIL_PL: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": null,
  "bundles": [
    {
      "bundleNo": "detail-pl-1",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-2",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-3",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-4",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-5",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-6",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-7",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-8",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-9",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-10",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-11",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-12",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-13",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "detail-pl-14",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "detail pl inv 2026_00031.xlsx",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/** PL IPE PO 314888 (BMOU6888755).pdf — 23 bundles */
export const TALLY_314888: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": "314888",
  "bundles": [
    {
      "bundleNo": "314888-1",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-2",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-3",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-4",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-5",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-6",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-7",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-8",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-9",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-10",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-11",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-12",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-13",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-14",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-15",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-16",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-17",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-18",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-19",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-20",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-21",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-22",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "314888-23",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "PL IPE PO 314888 (BMOU6888755).pdf",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/** Stuffing list.pdf — 17 bundles */
export const TALLY_STUFFING: TallyPayload = {
  "schema": "mgsl.tally.v1",
  "po": null,
  "bundles": [
    {
      "bundleNo": "stuffing-1",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-2",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-3",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-4",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-5",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-6",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-7",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-8",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-9",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-10",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-11",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-12",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-13",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-14",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-15",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-16",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    },
    {
      "bundleNo": "stuffing-17",
      "lot": null,
      "species": null,
      "thickness": null,
      "matrix": null,
      "totals": {
        "pieces": null,
        "boardFeet": null,
        "volumeM3": null
      },
      "provenance": {
        "page": null,
        "confidence": null
      }
    }
  ],
  "provenance": {
    "sourceFile": "Stuffing list.pdf",
    "parsedAt": null,
    "skill": "ground-truth@hand-verified",
    "reviewedBy": null
  }
};

/** Every fixture, keyed by the ground-truth document id. */
export const ARCH_TALLY_FIXTURES: Record<string, TallyPayload> = {
  "314307": TALLY_314307,
  "CHECHEN": TALLY_CHECHEN,
  "314776": TALLY_314776,
  "detail-pl": TALLY_DETAIL_PL,
  "314888": TALLY_314888,
  "stuffing": TALLY_STUFFING,
};

/**
 * Fixture-only: hand an ARCH lot a parsed tally so the matrix panel can be seen
 * before any NetSuite record exists.
 *
 * ⚠️ THIS IS A DEMO MAPPING, NOT A MATCH. Real ARCH lots are numbered "316027-1"
 * (the prefix is the PO); the ground-truth bundles are numbered "1535", "S8-0142"
 * and so on, from entirely different shipments. Nothing here claims a lot IS that
 * bundle. It exists so the client can review the SHAPE of the four states against
 * their own paperwork, which is the cheap thing to correct now.
 *
 * Deterministic by lot number so a screenshot is reproducible. Delete this function
 * the moment lots carry a real tally link.
 */
const DEMO_POOL: TallyPayload[] = [
  ARCH_TALLY_FIXTURES['314307'],   // scalar: thickness + width + length printed
  ARCH_TALLY_FIXTURES['CHECHEN'],  // by length, width is RW so no width breakdown
  ARCH_TALLY_FIXTURES['314888'],   // totals only
];

export const demoTallyBundleForLot = (lotNo: string) => {
  if (!lotNo) return null;
  let h = 0;
  for (let i = 0; i < lotNo.length; i++) h = (h * 31 + lotNo.charCodeAt(i)) >>> 0;
  const doc = DEMO_POOL[h % DEMO_POOL.length];
  if (!doc || !doc.bundles.length) return null;
  return doc.bundles[h % doc.bundles.length] || null;
};
