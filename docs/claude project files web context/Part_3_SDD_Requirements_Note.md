# MGSL Trader Screen — Part 3: SDD Requirements Document

> **Purpose:** The full SDD (Software Design Document) is the source of truth for all requirements. It already exists as a markdown file and should be pasted into Claude web as its own message.

## How to Use

The complete SDD is available at:
```
docs/claude project files web context/Documentation/MGSL_TraderScreen_React_Requirements_v1.3.md
```

**Paste the ENTIRE contents of that file into Claude web as a separate message.** It is ~1000 lines and covers:

- Section 1: Overview & Goals
- Section 2: Architecture (Component Overview, Data Flow)
- Section 3: Map/Reduce Cache Script (full specification including all schemas, delta logic, field alignment matrices)
- Section 4: RESTlet API (meta, summary, detail, createOrder endpoints)
- Section 5: Suitelet Shell
- Section 6: React Front-End Specification (design tokens, layout, column set, qty cell behaviors, UOM, detail modals, clickable links, create PO/SO, loading states, refresh state machine)
- Section 7: Linked Journal Entry Suitelet
- Section 8: Non-Functional Requirements (performance targets, governance, cache limits, browser compatibility, security)
- Section 9: Migration & Backward Compatibility
- Section 10: Open Questions

This document is the authoritative reference. Part 2 (Gap Analysis) identifies where the implementation deviates from it.

---

*End of Part 3. Next: Part 4 — Backend SuiteScript Code*
