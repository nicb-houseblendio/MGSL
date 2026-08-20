/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Trader Screen service — CWP ARCH (subsidiary 9).
 *
 * Reads TS_ARCH_* keys from the shared MGSL_TRADERSCREEN_CACHE bucket,
 * populated by mcgi_mr_trader_screen_cache_arch.js.
 *
 * ⚠️ MUST expose getRouter / postRouter — that is what the RESTlet calls.
 *
 * ── Honesty about what is in the cache ──────────────────────────────────────
 * The ARCH builder fills On Hand and structurally zeroes the other five buckets
 * because no ARCH sales orders, purchase orders or transfer orders exist in the
 * account. `meta.bucketsEmpty` carries that fact to the browser so the screen
 * can say which columns are real. Serving zeros as though they were measured is
 * the failure mode to avoid — it is the same reasoning that keeps `source` on
 * the split queue hook.
 *
 * ── Filters ────────────────────────────────────────────────────────────────
 * ARCH filters on its own axes — location, species, thickness, category, grade
 * — not IND's width/length/country/vendor, and NOT container (see applyFilters).
 * Several of those segments are not populated on the hardwood items yet, so their
 * filters will legitimately match nothing; that is a data gap, not a bug here.
 */
define([
    'N/runtime', 'N/log', 'N/query',
    '../shared/cacheKeys_arch',
    '../shared/cacheClient',
], (runtime, log, query, CacheKeysARCH, CacheClient) => {

    const getMyCache = () => CacheClient.getCache();

    const toValueList = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map((v) => String(v).trim()).filter(Boolean);
    };

    /**
     * Column totals, plus the distinct units that went into them.
     *
     * Board feet, square feet and pieces do not add up. The sums are computed
     * regardless and `units` reports what they span, which is what lets the
     * grid footer refuse to print a total across mixed units — the same
     * contract as `ArchTotals` on the front end.
     */
    const computeTotals = (rows) => {
        const t = {
            onHand: 0, reserve: 0, readyToBuild: 0,
            outbound: 0, onOrder: 0, inTransit: 0, available: 0,
            held: 0, heldLotCount: 0,
            units: [],
        };
        const seen = {};
        rows.forEach((r) => {
            t.onHand       += parseFloat(r.onHand)       || 0;
            t.reserve      += parseFloat(r.reserve)      || 0;
            t.readyToBuild += parseFloat(r.readyToBuild) || 0;
            t.outbound     += parseFloat(r.outbound)     || 0;
            t.onOrder      += parseFloat(r.onOrder)      || 0;
            t.inTransit    += parseFloat(r.inTransit)    || 0;
            t.available    += parseFloat(r.available)    || 0;
            t.held         += parseFloat(r.held)         || 0;
            t.heldLotCount += parseInt(r.heldLotCount, 10) || 0;
            const u = r.unit || 'BF';
            if (!seen[u]) { seen[u] = true; t.units.push(u); }
        });
        return t;
    };

    const applyFilters = (rows, params) => {
        let filtered = rows;

        if (params.location && toValueList(params.location).length > 0) {
            const locIds = toValueList(params.location).map(Number);
            filtered = filtered.filter((r) => locIds.indexOf(Number(r.locationId)) >= 0);
        }
        ['species', 'thickness', 'category', 'grade', 'grain'].forEach((field) => {
            if (params[field] && toValueList(params[field]).length > 0) {
                const vals = toValueList(params[field]);
                filtered = filtered.filter((r) => vals.indexOf(String(r[field] || '').trim()) >= 0);
            }
        });
        // `containerNo` is DELIBERATELY NOT A FILTER, removed 2026-08-19 with the
        // grid column. It was going to be fed from the lot-number prefix, and
        // Marc-Antoine confirmed that prefix is the PO number; a container can
        // also span several POs, so neither derives from the other.
        //
        // Removed rather than left as a dead branch because it fails LOUDLY in
        // the wrong direction: every lot's containerNo is empty today, so a
        // stale saved filter arriving here would match nothing and blank the
        // whole grid with no reason given. Ignoring the parameter is the honest
        // behaviour for a filter the screen no longer offers.
        // greaterThanZero: default true — hide rows with nothing in ANY bucket.
        //
        // Every bucket, not just the incoming three. A row that is entirely
        // outbound — shipped, nothing left on hand — has real activity a trader
        // needs to see, and testing only onHand/onOrder/inTransit would hide it
        // the moment outbound is populated. IND sums committed and outbound for
        // the same reason.
        if (params.greaterThanZero !== false && params.greaterThanZero !== 'false') {
            filtered = filtered.filter((r) =>
                (r.onHand || 0) + (r.reserve || 0) + (r.readyToBuild || 0) +
                (r.outbound || 0) + (r.onOrder || 0) + (r.inTransit || 0) +
                // Held stock counts as activity. A row that is entirely on hold
                // has an Available of 0, and hiding it would make the stock
                // disappear from the screen entirely — the opposite of what a
                // hold is for, which is to make it visible as unsellable.
                (r.held || 0) > 0);
        }
        return filtered;
    };

    const handleGetContext = () => {
        const user = runtime.getCurrentUser();
        return {
            success: true,
            data: {
                userId:       user.id,
                userName:     user.name,
                subsidiaryId: user.subsidiary,
                accountId:    runtime.accountId,
                // Must match ARCH_UOMS in react-app/src/lib/archUom.ts. "Native"
                // rather than "BF" because a row renders in its own item's unit.
                uomConfig: { 'CWP ARCH': ['Native (BF / SQFT / units)', 'Cubic meters (m³)'] },
            },
        };
    };

    /**
     * Is the summary ACTUALLY readable? META alone is not proof.
     *
     * SUMMARY and META are separate cache entries with separate lifetimes, so
     * they can disagree. The builder's shrink guard refreshes META on every run
     * but only rewrites SUMMARY when it accepts one; before that was fixed, a
     * repeatedly-tripping guard would let SUMMARY expire while META kept
     * claiming rows. The builder no longer does that — but a service that
     * believes META on its own would report "available, 14 rows" while the
     * summary endpoint returned CACHE_MISS, and the two answers would come from
     * the same request cycle.
     *
     * Cheap to check, so check rather than trust.
     *
     * @returns {{present: boolean, reason: string|null, rows: Array|null}}
     */
    const readSummary = (myCache) => {
        const raw = myCache.get({ key: CacheKeysARCH.SUMMARY });
        if (!raw) return { present: false, reason: 'SUMMARY_MISSING', rows: null };
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            return { present: false, reason: 'SUMMARY_UNREADABLE', rows: null };
        }
        if (Array.isArray(parsed)) return { present: true, reason: null, rows: parsed };

        if (parsed && parsed.chunked && parsed.chunkCount) {
            // ⚠️ A MISSING CHUNK IS A MISS, NOT A SMALLER RESULT.
            // This loop used to skip absent chunks and return whatever it found,
            // which is silent truncation on the read side — the same failure the
            // shrink guard prevents on the write side, and harder to notice
            // because the rows that survive look perfectly valid. Chunks share
            // SUMMARY's TTL but are separate entries, so one expiring or failing
            // to write is a real scenario once chunking lands.
            const rows = [];
            for (let i = 0; i < parsed.chunkCount; i++) {
                const chunkRaw = myCache.get({ key: CacheKeysARCH.buildSummaryDataKey(i) });
                if (!chunkRaw) return { present: false, reason: 'SUMMARY_CHUNK_MISSING', rows: null };
                let chunkRows;
                try {
                    chunkRows = JSON.parse(chunkRaw);
                } catch (e) {
                    return { present: false, reason: 'SUMMARY_CHUNK_UNREADABLE', rows: null };
                }
                if (!Array.isArray(chunkRows)) {
                    return { present: false, reason: 'SUMMARY_CHUNK_UNREADABLE', rows: null };
                }
                rows.push.apply(rows, chunkRows);
            }
            return { present: true, reason: null, rows: rows };
        }
        return { present: false, reason: 'SUMMARY_UNREADABLE', rows: null };
    };

    const handleGetMeta = () => {
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysARCH.META });
            if (!raw) return { available: false, reason: 'CACHE_MISS' };
            const meta = JSON.parse(raw);

            // Cross-check. If META survived but the summary did not, the screen
            // has nothing to render, so saying "available" would be a lie that
            // the very next request contradicts. `lastUpdated` is still returned
            // so the UI can say WHEN the data it cannot show was last built,
            // rather than just failing blank.
            const summary = readSummary(myCache);
            if (!summary.present) {
                return {
                    available:   false,
                    reason:      summary.reason,
                    lastUpdated: meta.lastUpdated || '',
                    lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                    rowCount:    0,
                };
            }

            return {
                available:    true,
                cacheVersion: meta.cacheVersion,
                lastUpdated:  meta.lastUpdated,
                rowCount:     meta.rowCount,
                bucketsBuilt: meta.bucketsBuilt || [],
                bucketsEmpty: meta.bucketsEmpty || [],
                // >0 means the On Hand figures are LOW — lots exist that could
                // not be converted to display units and were excluded.
                skippedLotCount: meta.skippedLotCount || 0,
                // ⚠️ THIS OBJECT IS AN ALLOWLIST. A field added to the cached META
                // is invisible to the browser until it is named here — that has now
                // been missed twice (skippedLotCount, then shrinkGuard). If you add
                // something to the builder's META, add it here in the same commit.
                lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                // True means the last run REFUSED to update: the rows below are the
                // previously cached set, and `lastUpdated` is when they were built,
                // not when the run happened.
                shrinkGuard: meta.shrinkGuard === true,
                shrinkGuardRefused: meta.shrinkGuardRefused || 0,
                // Costing. costBook says WHICH book the money is in (1 = Primary
                // = CAD); the counts separate "nothing could be costed" from
                // "there is no stock", which an em-dash column cannot express.
                costBook:         meta.costBook || 0,
                costedRowCount:   meta.costedRowCount == null ? null : meta.costedRowCount,
                uncostedRowCount: meta.uncostedRowCount == null ? null : meta.uncostedRowCount,
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getMeta', details: e.message });
            return { available: false, reason: 'ERROR' };
        }
    };

    const handleGetSummary = (params) => {
        try {
            const myCache = getMyCache();
            const summary = readSummary(myCache);
            if (!summary.present) {
                return {
                    error: summary.reason === 'SUMMARY_MISSING' ? 'CACHE_MISS' : summary.reason,
                    message: summary.reason === 'SUMMARY_MISSING'
                        ? 'ARCH cache not populated. Run the ARCH Map/Reduce script.'
                        : 'ARCH cache is present but not readable (' + summary.reason + '). ' +
                          'Returning nothing rather than a partial set — run the ARCH Map/Reduce ' +
                          'script to rebuild.',
                };
            }
            const allRows = summary.rows;

            const filtered = applyFilters(allRows, params || {});
            const metaRaw = myCache.get({ key: CacheKeysARCH.META });
            const meta = metaRaw ? JSON.parse(metaRaw) : {};

            // Mirrors the audit line IND has carried for months, and its absence
            // here cost real time: when the browser sat on "Loading inventory
            // data…" there was no way to tell whether the request had reached
            // this service at all, because a successful ARCH call logged nothing.
            // Silence read identically to "never arrived".
            log.audit('trader_screen_service_arch.getSummary',
                'rowsInCache=' + allRows.length + ' rowsServed=' + filtered.length +
                ' metaRowCount=' + (meta.rowCount || 0) +
                ' shrinkGuard=' + (meta.shrinkGuard === true) +
                ' greaterThanZero=' + ((params || {}).greaterThanZero !== false));

            return {
                success: true,
                rows:    filtered,
                totals:  computeTotals(filtered),
                meta: {
                    lastUpdated:  meta.lastUpdated || '',
                    cacheVersion: meta.cacheVersion || 0,
                    rowCount:     filtered.length,
                    bucketsBuilt: meta.bucketsBuilt || [],
                    bucketsEmpty: meta.bucketsEmpty || [],
                    skippedLotCount: meta.skippedLotCount || 0,
                    lastAttempt: meta.lastAttempt || meta.lastUpdated || '',
                    shrinkGuard: meta.shrinkGuard === true,
                    shrinkGuardRefused: meta.shrinkGuardRefused || 0,
                    // Same allowlist rule as getMeta above — see the warning
                    // there. Added with lot costing, 2026-08-19.
                    costBook:         meta.costBook || 0,
                    costedRowCount:   meta.costedRowCount == null ? null : meta.costedRowCount,
                    uncostedRowCount: meta.uncostedRowCount == null ? null : meta.uncostedRowCount,
                },
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getSummary', details: e.message });
            return { error: 'CACHE_MISS', message: 'ARCH cache error: ' + e.message };
        }
    };

    const handleGetDetail = (params) => {
        const itemId     = params && params.itemId;
        const locationId = params && params.locationId;
        if (!itemId || !locationId) {
            return { success: false, error: 'itemId and locationId required' };
        }
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysARCH.detailKey(itemId, locationId) });
            if (!raw) {
                const buckets = ['onHand', 'reserve', 'readyToBuild', 'outbound', 'onOrder', 'inTransit'];
                const merged = {};
                let anyFound = false;
                buckets.forEach((b) => {
                    const bStr = myCache.get({ key: CacheKeysARCH.buildDetailBucketKey(itemId, locationId, b) });
                    if (bStr) { anyFound = true; merged[b] = JSON.parse(bStr); }
                });
                if (anyFound) return { success: true, data: merged };
                return {
                    error: 'DETAIL_CACHE_MISS',
                    message: 'ARCH detail not found. Try again after cache refresh.',
                };
            }
            return { success: true, data: JSON.parse(raw) };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getDetail', details: e.message });
            return { error: 'DETAIL_CACHE_MISS', message: 'ARCH detail error: ' + e.message };
        }
    };

    /**
     * Customers the wizard can raise an order for.
     *
     * Exists because the wizard's customer dropdown was a hardcoded list of
     * invented names, so `customerId` was always undefined and the order endpoint
     * refused every submission with "The order needs a customer".
     *
     * ── Why this is NOT scoped by the request's subsidiary ───────────────────
     * It would return an empty list. The ARCH screen calls this service with
     * subsidiaryId 9 (ARC), and measured 2026-08-20: **zero** of the 807 active
     * customers sit in subsidiary 9, while 387 sit in subsidiary 5 where the
     * hardwood actually is. Scoping on the request would therefore hide every
     * customer and look like a broken feature.
     *
     * Nor is it scoped to subsidiary 5. That would hide 420 customers on a guess
     * about who ARCH sells to, and hiding the one name a trader is looking for is
     * a worse failure than a longer list. 807 rows is a small payload and the
     * picker searches. NetSuite still refuses an order whose customer its
     * subsidiary does not permit, which is a clean failure rather than a silent
     * one.
     *
     * ── Why it is not cached ────────────────────────────────────────────────
     * One query per wizard open, against a table that changes when someone adds
     * a customer. A cache key here would need invalidating on a customer edit,
     * and this module has just finished deleting five keys that promised things
     * nothing maintained.
     *
     * `currency` and `terms` come back so the wizard can pre-fill from the
     * customer record rather than making the trader restate what NetSuite knows.
     */
    const handleGetCustomers = () => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT ' +
                    '  c.id                     AS id, ' +
                    '  c.companyname            AS companyname, ' +
                    '  c.entityid               AS entityid, ' +
                    '  c.currency               AS currencyid, ' +
                    '  BUILTIN.DF(c.currency)   AS currencyname, ' +
                    '  c.terms                  AS termsid, ' +
                    '  BUILTIN.DF(c.terms)      AS termsname, ' +
                    '  c.subsidiary             AS subsidiaryid ' +
                    'FROM customer c ' +
                    "WHERE c.isinactive = 'F' " +
                    // Sorted on the DISPLAYED name, not on companyname. Sorting
                    // by companyname alone puts every record that lacks one at
                    // the top of the picker — "Anonymous Customer" and "Nordex
                    // Norway AS" ahead of "2K Wholesale Inc" — which reads as an
                    // unsorted list.
                    'ORDER BY COALESCE(c.companyname, c.entityid)',
            }).asMappedResults();

            return {
                success: true,
                customers: rows.map((r) => ({
                    id: String(r.id),
                    // companyname is blank on some records — County Line Materials
                    // LLC carries its name in entityid only — so neither field
                    // alone is a reliable label.
                    name: String(r.companyname || r.entityid || ('Customer ' + r.id)),
                    currencyId: r.currencyid ? String(r.currencyid) : null,
                    currencyName: r.currencyname ? String(r.currencyname) : null,
                    termsId: r.termsid ? String(r.termsid) : null,
                    termsName: r.termsname ? String(r.termsname) : null,
                    subsidiaryId: r.subsidiaryid ? String(r.subsidiaryid) : null,
                })),
            };
        } catch (e) {
            // A failed customer list must not read as "this account has no
            // customers". The screen keeps its picker disabled and says why.
            log.error('ARCH service — customer list failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return {
                success: false,
                error: 'The customer list could not be loaded: ' + (e.message || String(e)),
            };
        }
    };

    const getHandler = (dataIn) => {
        const action = (dataIn && dataIn.action) || 'get';
        const handlers = {
            getContext: handleGetContext,
            meta:       handleGetMeta,
            summary:    handleGetSummary,
            detail:     handleGetDetail,
            customers:  handleGetCustomers,
        };
        const handler = handlers[action];
        if (!handler) return { success: false, error: 'Unknown action: ' + action };
        return handler(dataIn);
    };

    return {
        getRouter: function (dataIn) {
            if (!dataIn || !dataIn.action) {
                return { success: false, error: 'action parameter required' };
            }
            return getHandler(dataIn);
        },
        postRouter: function () {
            // SO creation from the ARCH wizard is Track D, not Phase 1.
            return { success: false, error: 'No POST actions defined for the ARCH service' };
        },
    };
});
