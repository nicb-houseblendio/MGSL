# Trader Screen - React SPA

React-based Trader Screen for NetSuite, with TanStack Table pivot grouping, light/dark mode, and RESTlet API backend.

## Development

```bash
npm install
npm run dev
```

Note: The app requires NetSuite context (RESTlet URL). For local dev, the API calls will fail. Deploy to NetSuite to test fully.

## Build

```bash
npm run build
```

Output: `dist/index.html` (single file, ~675KB)

## Deploy to NetSuite

1. Build and copy HTML to File Cabinet:
   ```bash
   npm run build:deploy
   ```

2. Deploy the project:
   ```bash
   suitecloud project:deploy
   ```

3. Create the Script records in NetSuite:
   - **Suitelet** (MCGI_SL_TraderScreen.js): Create Script record, add Deployment. The Suitelet will look for `index.html` in `SuiteScripts/trader-screen/` folder.
   - **RESTlet** (MCGI_RL_TraderAPI.js): Create Script record, add Deployment. Update the script IDs in MCGI_SL_TraderScreen.js `getContext()` to match your RESTlet deployment.

4. Update the RESTlet URL in the host Suitelet: The `getContext()` function uses `customscript_mcgi_rl_traderapi` and `customdeploy_mcgi_rl_traderapi`. Update these to match your deployment IDs.

## Features

- TanStack Table with fixed Width → Length pivot grouping
- Light/Dark mode with system preference detection
- Business-specific filters (CWP MTL, CWP IND, CWP ARCH)
- Multi-select comboboxes with type-ahead search
- Drill-down detail views (On Hand, Committed, Outbound, On Order, In Transit) with lot numbers
- Excel export
- Totals banner that recalculates on filter change
