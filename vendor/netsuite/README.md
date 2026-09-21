# Vendored NetSuite scripts

Read-only, byte-for-byte copies of File Cabinet scripts that the trader screen
**depends on at runtime but does not own**. They are here so a fresh clone can
read them. Before this folder existed, four tracked files in `src/` declared
`define('/SuiteScripts/MCGI_LIB_LotCost')` against a module that was in no
repository and on no developer's disk.

## Do not deploy these, and do not edit them here

`src/deploy.xml` globs only `trader_screen/*` and `inventory_hold/*`, so nothing
under `vendor/` is in deploy scope and that is deliberate. These files are MGSL's
and Nic's, they are maintained in the account, and a copy in this folder is a
snapshot for reading. Editing one here changes nothing in NetSuite and will
silently go stale against the thing that actually runs.

If one of them needs to change, change it in the account and re-pull.

## What is here

| File | FC path | id | bytes | sha256 (first 16) | NS lastmod | pulled from |
|---|---|---|---|---|---|---|
| `SuiteScripts/MCGI_LIB_LotCost.js` | `/SuiteScripts/` | 91334 | 22,839 | `c1ea2d795201ebe3` | 2026-07-07 | prod |
| `SuiteScripts/MSL_UE_allocationSegmentSync.js` | `/SuiteScripts/` | 68373 | 22,138 | `54d261274bade37f` | 2026-04-30 | prod |
| `SuiteScripts/SO Auto PO Allocation/MSL_LIB_POAllocationCore.js` | `/SuiteScripts/SO Auto PO Allocation/` | 68475 | 207,449 | `96c0bf50b0afe29f` | 2026-09-03 | prod |

Pulled 2026-09-21. Every `bytes` figure above was cross-checked against the
SuiteQL `file.filesize` column for the same id, which is the check that catches a
truncated SOAP read.

## Why each one matters

**`MCGI_LIB_LotCost.js`** is the FIFO lot cost engine from Task 8. It exports
`getLineCosts` and `getLotCostsAtLocation`, and `getLotCostsAtLocation(lotIds,
locationId, {book})` is the only entry point our code uses. Four tracked files
call into it: the IND, MTL and ARCH cache MRs, and `archSplitExecute.js`. It is
what decides the unit cost an ARCH split writes to the GL, so the split value
conservation work is unreadable without it.

**`MSL_UE_allocationSegmentSync.js`** is Nic's User Event, script id
`customscriptmsl_ue_purchaseorderposegmen`. It stamps `cseg_po_segment_gl` on PO
lines from a `customrecord_cseg_po_segment_gl` record. Nothing in `src/` calls it,
but the ARCH and MTL screens read that segment, so a line it failed to stamp
looks to us like missing data rather than an upstream miss.

**`MSL_LIB_POAllocationCore.js`** is the PO allocation engine behind
`poAllocationView.js`. `addUnreceivedRows` (line 2850) is where segment-less rows
get skipped, which is the behaviour the PO allocation panel inherits.

## Refreshing a copy

```
node "D:\HouseBlend\Clients\MGSL\nsfile.mjs" --prod --out ./vendor/netsuite/SuiteScripts 91334 68373
```

For the one in a subfolder, pass a manifest so the subdir is preserved:

```
echo '[{"id":68475,"name":"MSL_LIB_POAllocationCore.js","subdir":"SO Auto PO Allocation"}]' > files.json
node "D:\HouseBlend\Clients\MGSL\nsfile.mjs" --prod --out ./vendor/netsuite/SuiteScripts -f files.json
```

Drop `--prod` for sandbox. `nsfile.mjs` prints bytes and sha256 for each file;
always compare `bytes` against SuiteQL before trusting the result:

```
node "D:\HouseBlend\Clients\MGSL\sql.mjs" --prod "SELECT id, name, filesize, lastmodifieddate FROM file WHERE id IN (91334, 68373, 68475)"
```

## Sandbox and production drift, measured 2026-09-21

These three drift independently of anything in git, so a clean `git diff` between
two commits says nothing about whether they changed. Current state:

| File | sandbox | production | verdict |
|---|---|---|---|
| `MCGI_LIB_LotCost.js` | 22,839 B, 2026-07-07 | identical | no drift |
| `MSL_UE_allocationSegmentSync.js` | 22,138 B, 2026-04-30 | identical | no drift |
| `MSL_LIB_POAllocationCore.js` | 205,008 B, 2026-08-30 | 207,449 B, 2026-09-03 | **prod ahead by 2,441 B** |

The first two agreed only because a sandbox refresh pulled sbx up to prod; on
2026-07-27 all three differed. Re-measure before any trader screen deploy rather
than trusting this table. Equal filesize plus equal `lastmodifieddate` is strong
evidence of the same file but is not byte-proof; pull both and compare sha256 if
it matters.

The vendored copy of `MSL_LIB_POAllocationCore.js` is the **production** one. If
you are debugging PO allocation behaviour you see in sandbox, pull the sandbox
copy separately rather than reading this one.
