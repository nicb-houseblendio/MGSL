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
 * ARCH filters on its own axes — species, thickness, category, grade, container
 * — not IND's width/length/country/vendor. Several of those segments are not
 * populated on the hardwood items yet, so their filters will legitimately match
 * nothing; that is a data gap, not a bug here.
 */
define([
    'N/runtime', 'N/log',
    '../shared/cacheKeys_arch',
    '../shared/cacheClient',
], (runtime, log, CacheKeysARCH, CacheClient) => {

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
        if (params.containerNo && toValueList(params.containerNo).length > 0) {
            const vals = toValueList(params.containerNo);
            // Lot-level: keep the row if ANY of its lots is in a selected container.
            filtered = filtered.filter((r) =>
                Array.isArray(r.lots) && r.lots.some((l) => l.containerNo && vals.indexOf(l.containerNo) >= 0));
        }
        // greaterThanZero: default true — hide rows with nothing in any bucket
        if (params.greaterThanZero !== false && params.greaterThanZero !== 'false') {
            filtered = filtered.filter((r) =>
                (r.onHand || 0) + (r.onOrder || 0) + (r.inTransit || 0) > 0);
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

    const handleGetMeta = () => {
        try {
            const raw = getMyCache().get({ key: CacheKeysARCH.META });
            if (!raw) return { available: false, reason: 'CACHE_MISS' };
            const meta = JSON.parse(raw);
            return {
                available:    true,
                cacheVersion: meta.cacheVersion,
                lastUpdated:  meta.lastUpdated,
                rowCount:     meta.rowCount,
                bucketsBuilt: meta.bucketsBuilt || [],
                bucketsEmpty: meta.bucketsEmpty || [],
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_arch.getMeta', details: e.message });
            return { available: false, reason: 'ERROR' };
        }
    };

    const handleGetSummary = (params) => {
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysARCH.SUMMARY });
            if (!raw) {
                return {
                    error: 'CACHE_MISS',
                    message: 'ARCH cache not populated. Run the ARCH Map/Reduce script.',
                };
            }

            const parsed = JSON.parse(raw);
            let allRows;
            if (parsed && parsed.chunked && parsed.chunkCount) {
                // The builder does not chunk yet — it refuses to write an
                // oversized payload instead. This branch is here so the reader
                // is ready the day chunking is ported from MTL.
                allRows = [];
                for (let i = 0; i < parsed.chunkCount; i++) {
                    const chunkStr = myCache.get({ key: CacheKeysARCH.buildSummaryDataKey(i) });
                    if (chunkStr) {
                        const chunkRows = JSON.parse(chunkStr);
                        if (Array.isArray(chunkRows)) allRows.push.apply(allRows, chunkRows);
                    }
                }
            } else {
                allRows = parsed;
            }

            const filtered = applyFilters(allRows, params || {});
            const metaRaw = myCache.get({ key: CacheKeysARCH.META });
            const meta = metaRaw ? JSON.parse(metaRaw) : {};

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

    const getHandler = (dataIn) => {
        const action = (dataIn && dataIn.action) || 'get';
        const handlers = {
            getContext: handleGetContext,
            meta:       handleGetMeta,
            summary:    handleGetSummary,
            detail:     handleGetDetail,
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
