# MGSL Trader Screen --- Phase 1

## Master LLM Implementation Specification

Architecture: Map/Reduce → N/cache → RESTlet → React 18

Core Rules: - No searches in RESTlet GET - No searches in Suitelet
shell - All heavy computation in Map/Reduce - Client-side filtering +
UOM conversion - Lazy detail loading

Refresh Flow: 1. GET meta 2. Compare cacheVersion 3. If newer → GET
summary 4. Clear detail cache

Delta Logic: - Transactions lastmodifieddate \>= TS_LAST_RUN_TIMESTAMP -
Fallback to FULL if pair count \> threshold

Non-Functional Targets: - Meta \<200ms - Summary \<3s - Detail \<1s -
Client filtering \<100ms

All configuration via script parameters.
