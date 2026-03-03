# MGSL Trader Screen --- Phase 1

## Test Plan

Functional Tests: - FULL rebuild writes TS_SUMMARY + TS_META - DELTA
updates only modified rows - greaterThanZero filter default true -
Detail modal loads correct rows

Delta Verification: 1. Run FULL 2. Modify transaction 3. Run DELTA 4.
Verify deltaCount + row change

Performance: - Measure governance per cycle - Verify RESTlet GET uses no
searches

Edge Cases: - Cache miss handling (503) - Detail cache miss - Payload
\>500KB handling
