# MGSL Trader Screen

SuiteScript and React source for the MGSL trader screens in NetSuite. Three
screens share one codebase and one build:

| Screen | Subsidiary | Suitelet (sbx) | Cache MR (sbx) |
|---|---|---|---|
| Trader screen, softwood | CWP Industriel (IND) | 4719 `customscriptmcgi_sl_trader_screen_react` | 4722 `customscript_mcgi_mr_trader_cache` |
| Trader screen, softwood | CWP Montreal (MTL) | same suitelet, MTL view | 5543 `customscript_mcgi_mr_trader_cache_mtl` |
| Trader screen, hardwood | CWP ARCH (ARC) | same suitelet, ARCH view | 6503 `customscript_mcgi_mr_trader_cache_arch` |
| Warehouse screen, bundle-split queue | CWP ARCH | 6495 `customscript_mcgi_sl_warehouse_react` | reads the ARCH cache |

One RESTlet serves all of them: 4720 `customscript_mcgi_rl_traderapi`. The
screens never query NetSuite directly, they read a cache that the Map/Reduce
scripts build. Which view a user gets is decided by their role, in
`mcgi_sl_trader_screen_react.js`.

## Layout

```
src/
  FileCabinet/SuiteScripts/mcgi_services/
    trader_screen/
      entry_points/   the deployed scripts: mr, sl, rl, cs
      service/        per-subsidiary query and shaping layer
      shared/         modules the entry points share
    inventory_hold/   the Inventory Hold custom record's UE and CS
  Objects/            SDF XML for the fields, lists, records and script records we own
  deploy.xml          see the warning below before you run anything with this
react-app/            the React SPA all three screens render
vendor/netsuite/      read-only copies of NS scripts we depend on but do not own
```

## Setup

Node 22.6 or newer. `npm test` runs TypeScript directly via
`--experimental-strip-types`, which does not exist before 22.6. Developed on
v22.14.

```
cd react-app
npm install
```

To query NetSuite you need the shared credentials and runners, which live **one
directory above this repo** at `D:\HouseBlend\Clients\MGSL\` and are deliberately
not in git:

```
node "D:\HouseBlend\Clients\MGSL\sql.mjs" "SELECT id, scriptid FROM script WHERE scriptid LIKE '%trader%'"
node "D:\HouseBlend\Clients\MGSL\sql.mjs" --prod "SELECT ..."
node "D:\HouseBlend\Clients\MGSL\restlet.mjs" action=meta subsidiaryId=9
node "D:\HouseBlend\Clients\MGSL\nsfile.mjs" --prod --out ./tmp 91334
```

`sql.mjs` walks up the directory tree for `.env`, so it works from any folder
under `MGSL\`. Sandbox is the default and production needs an explicit `--prod`.
The REST SuiteQL endpoint is SELECT-only in both. If you are new to the project,
ask Andrei for those files; there is no setup step in this repo that creates them.

## Build

```
cd react-app
npm run build
```

Vite writes `bundle.js` and `bundle.css` into
`src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/react-app/dist/`, which
is gitignored because it is a build artifact. Both suitelets load those two files
by path and inline them into the page, so **deploying the UI means uploading those
two files** and nothing else.

`npm run dev` serves the app at `localhost:3000`. ARCH renders on local demo data
with a visible badge saying so; IND and MTL need the RESTlet and will not load
outside NetSuite.

## Deploy

🔴 **Never run `suitecloud project:deploy` against `src/deploy.xml`.** It covers
`trader_screen/*` **and** `~/Objects/*`, so it clobbers uncommitted sandbox work
and resets deployment records, including script parameter values that are not in
this repo. It also does not work in this project: `sourceRootFolder: "src"` is
unsupported in CLI v3.x.

Deploy by scoped upload instead. Build a flat scratch SDF project in a temp
folder (`manifest.xml` with `projecttype="ACCOUNTCUSTOMIZATION"`, `project.json`
with `defaultAuthId`, and the files under `FileCabinet/`), then:

```
MSYS_NO_PATHCONV=1 npx @oracle/suitecloud-cli file:upload --paths /SuiteScripts/mcgi_services/trader_screen/react-app/dist/bundle.js
```

`MSYS_NO_PATHCONV=1` is required under Git Bash. Without it the leading `/` is
rewritten to `C:/Program Files/Git/SuiteScripts/...` and the upload fails. There
is no `--authid` flag; auth comes from the scratch project's `project.json`.

Auth IDs: `9448239_SB1-Adm-Sand` (sandbox), `9448239-Adm-Prod` (production).

Objects deploy the same way, from a flat scratch project containing **only** the
objects you intend to touch, and always with `--dryrun` first. The dry run prints
a deployment preview listing every object it would create or modify, which is the
proof of scope.

Verify every upload by comparing NS `file.filesize` against local bytes:

```
node "D:\HouseBlend\Clients\MGSL\sql.mjs" "SELECT name, filesize, lastmodifieddate FROM file WHERE name = 'bundle.js'"
```

NS stores most of these files with CRLF, so the NS size is usually local LF bytes
plus the newline count. Calibrate on a file you know is in sync before reading
anything into a mismatch.

## Tests

```
cd react-app
npm test
```

33 suites under `react-app/src/lib`, run by the node test runner. They cover the
pure logic: bucket arithmetic, lot locking, tally math, order gating, freshness.
There is no component or browser test layer, so anything that only shows up in
the rendered screen has to be checked in NetSuite.

`npx tsc -b` typechecks without emitting.

## What is not in this repo

- **`docs/`** stays local by project rule. It holds the client feedback,
  meeting notes, specs and the task list, and it is never committed. Do not
  `git add -A`; stage `src/` and `react-app/src/` explicitly.
- **Build output.** `react-app/dist/` and the FileCabinet `dist/` are gitignored.
- **The NS tooling and credentials**, one directory up, as above.
- **Most of the account's customization.** 37 of the custom fields and records
  this code reads have no SDF XML here (`cseggrade`, `cseg_subsidiary_loc`,
  `custbody_ship_week`, `custcol_mgsl_ppp`, the packing-list capture record, and
  more). They are pre-existing MGSL customizations that live in the account, so
  nobody needs to create them, but it means this repo cannot rebuild an account
  from scratch and `src/Objects/` is only the things we made.
- **Deployment parameter values and saved search definitions.** Not in SuiteQL
  and not here. Read them with `record.load({type: 'scriptdeployment', id})`; the
  internal id is `scriptdeployment.primarykey`, not the `id` column.
- **A second repo, `houseblend-clients`**, holds code the ARCH flow depends on at
  runtime: the PO allocation backend, the segment-sync UE, the Map/Reduce that
  FIFO lot-assigns any segmented SO line, and the packing-list capture record.
  Clone it too before concluding something is missing.

## House rules

- **`dev` is shared with Nic.** Always `git fetch` before you push. He works
  sandbox-first, so the newest commit here is not the full sandbox state, and a
  scoped upload is not a lock on the file.
- **MTL and IND are strictly isolated.** An MTL change must never touch IND
  components. New files for anything that is a major UI change.
- **Check what is actually deployed before trusting the repo.** A clean
  `git diff` between two commits says nothing about the three scripts under
  `vendor/netsuite/`, which are maintained in the account.
- **The ARCH cache can die silently for days** while its deployment still reads
  SCHEDULED. Check `restlet.mjs action=meta` for `CACHE_MISS` before quoting any
  live ARCH figure.
- **Never enable the scheduled deployment on the IND or MTL cache MR.** Two
  runners corrupt the summarize merge and fork a chain that cannot be stopped
  cleanly. ARCH is scheduled on purpose and is the exception.
- **Sandbox sends real email to real client addresses.** Blank a script's
  recipient parameter before testing any failure path, and restore it after.

## Debugging in NetSuite

Script execution logs are queryable, so most of the loop needs no UI:

```
node "D:\HouseBlend\Clients\MGSL\sql.mjs" "SELECT date, type, title, detail FROM scriptnote WHERE scripttype = 6503 ORDER BY date DESC"
```

`scriptnote` is the execution log and `scripttype` is the **script's** internal
id, not a type name. Filter tightly: there are over a million rows in production,
no GROUP BY or aggregates are supported, and retention is short enough that a
low-volume MR keeps only its last couple of runs. `scriptnote.date` is UTC-7
while the cache's own `lastUpdated` is UTC, which has made a healthy cache look
dead.

`CLAUDE.md` in the parent folder carries the rest of the SuiteQL quirks for this
tenant.
