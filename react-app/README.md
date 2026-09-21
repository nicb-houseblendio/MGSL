# Trader Screen, React SPA

The UI for all three MGSL trader screens and the ARCH warehouse screen. One
bundle, one build; which view renders is decided by the signed-in role, server
side, in `mcgi_sl_trader_screen_react.js`.

See the repo root `README.md` for the NS side: script ids, the scoped upload
recipe, credentials, and the house rules.

## Development

```
npm install
npm run dev
```

Serves on `localhost:3000` (`server.port` in `vite.config.ts`, not Vite's
default).

**ARCH works offline.** `App.tsx` starts `archSource` at `'fixtures'` and only
switches to live data when the RESTlet answers, so the hardwood screen renders on
local demo data with an amber badge saying so. That badge is the contract: if you
see it in NetSuite, the cache could not be read.

**IND and MTL do not work offline.** They have no fixture path and need the
RESTlet, so they will not load outside NetSuite.

⚠️ The ARCH tally fixture is a separate switch and defaults to **off**
(`allowFixture`, only `source === 'fixtures'` enables it). A lot with no tally
draws nothing rather than borrowing another shipment's wood. Do not turn it on to
make a screen look populated.

## Build

```
npm run build
```

`tsc -b` then `vite build`. Output is **not** `dist/index.html`. Vite's `outDir`
is set to

```
../src/FileCabinet/SuiteScripts/mcgi_services/trader_screen/react-app/dist/
```

and it writes exactly two files there, `bundle.js` and `bundle.css`
(`entryFileNames` and `assetFileNames` in `vite.config.ts` pin the names, so
there is no content hash to chase). Both suitelets load those two by path and
inline them into the page:

```js
// mcgi_sl_trader_screen_react.js and mcgi_sl_warehouse_screen_react.js
const path = '/SuiteScripts/mcgi_services/trader_screen/react-app/dist/' + fileName;
```

So deploying the UI is uploading those two files. Nothing else in the build
output matters, and the folder is gitignored.

🔴 **Do not use `npm run build:deploy`, and do not follow the old deploy steps.**
It runs `scripts/copy-html.js`, which reads `react-app/dist/index.html` and copies
it to `src/FileCabinet/SuiteScripts/trader-screen/index.html`. Neither path is
part of the current build or the current suitelets: `react-app/dist/index.html` is
a stale single-file artifact from March that the build no longer writes, and
`src/FileCabinet/SuiteScripts/trader-screen/` is dead in the account. Its three
files do not exist in the sandbox File Cabinet at all and no script record points
at them; the live suitelets are file ids 54340 and 122932 under
`trader_screen/entry_points/sl/`. So running `build:deploy` silently stages a
six-month-old bundle into a folder nothing reads. The script, that folder, and the
tracked `react-app/dist/index.html` are all dead and should be removed.

⚠️ There is also nothing to update after a deploy. The old step 4 here told you to
edit the RESTlet ids in `getContext()`; the suitelet resolves the RESTlet by
script id at runtime with `url.resolveScript`, so the ids move with the account.

## Deploy

From the repo root, per the root `README.md`: build a flat scratch SDF project and
upload the two bundle files with `file:upload`, then verify the byte counts with
SuiteQL. Never `project:deploy` against `src/deploy.xml`.

The one thing worth knowing here: the bundle is inlined into the page, so a stale
upload shows up as a working screen with old behaviour rather than a 404. Check
`file.lastmodifieddate` on `bundle.js` when a change appears not to have taken.

## Tests

```
npm test
```

33 suites under `src/lib`, node test runner, TypeScript imported directly through
`--experimental-strip-types` with an alias hook in `scripts/test-alias-hook.mjs`
resolving `@/`. Needs Node 22.6 or newer.

They cover the pure logic and nothing else: bucket arithmetic and the gap
reasons, lot locking and sellability, tally math and the length matrix, order
gating and pricing, sales team splits, freshness thresholds, wizard navigation.
There is no component or browser layer, so anything that only exists in the
rendered screen has to be checked in NetSuite.

`npx tsc -b` typechecks without emitting.

## Layout

```
src/
  App.tsx            the shell: role routing, tab strip, toolbar, ARCH source badge
  components/
    arch/            hardwood only: lot table, PO list, tally grid, split queue, order wizard
    warehouse/       the ARCH bundle-split queue screen
    ui/              shadcn primitives
    *.tsx            the shared and softwood screens (InventoryTable, DetailDrawer, ...)
  hooks/             data fetching, one hook per cache read
  lib/               all the logic, and all the tests
  types/             the cache payload shapes, which are the contract with the MRs
  config/            business config per subsidiary
```

`types/arch.ts` is worth reading first if you are touching ARCH. It documents the
cache contract, including the cases where `null` and `undefined` mean different
things (`orders`, `incoming`): a null means the cache looked and found nothing,
undefined means the cache predates the field and the view may fall back.

## Features

- TanStack Table with a fixed Width to Length pivot
- Light and dark mode, following system preference
- Per-subsidiary filters and views (IND, MTL, ARCH)
- Multi-select comboboxes with type-ahead
- Drill-downs for On Hand, Committed, Outbound, On Order, In Transit, down to
  bundle level, with supplier and ETA on the incoming buckets
- ARCH order wizard writing real SOs, with sales team splits and reman rates
- ARCH bundle split, tally capture and the warehouse split queue
- Excel export
- Totals banner that recalculates on filter change
