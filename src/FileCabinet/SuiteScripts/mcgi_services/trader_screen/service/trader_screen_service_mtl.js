/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Trader Screen service — CWP MTL (subsidiary 5).
 *
 * Reads from TS_MTL_* keys in the shared MGSL_TRADERSCREEN_CACHE bucket.
 * Populated by mcgi_mr_trader_screen_cache_mtl.js.
 *
 * ⚠️ MUST expose getRouter / postRouter — that is what the RESTlet calls.
 */
define([
    'N/runtime', 'N/log',
    '../shared/cacheKeys_mtl',
    '../shared/cacheClient',
], (runtime, log, CacheKeysMTL, CacheClient) => {

    const getMyCache = () => CacheClient.getCache();

    const toValueList = value => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value.toString().split(',').map(v => String(v).trim()).filter(Boolean);
    };

    const computeTotals = rows => {
        const t = { onHand: 0, committed: 0, outbound: 0, onOrder: 0, inTransit: 0, available: 0 };
        rows.forEach(r => {
            t.onHand    += parseFloat(r.onHand)    || 0;
            t.committed += parseFloat(r.committed) || 0;
            t.outbound  += parseFloat(r.outbound)  || 0;
            t.onOrder   += parseFloat(r.onOrder)   || 0;
            t.inTransit += parseFloat(r.inTransit) || 0;
            t.available += parseFloat(r.available) || 0;
        });
        return t;
    };

    const applyFilters = (rows, params) => {
        let filtered = rows;
        if (params.location && toValueList(params.location).length > 0) {
            const locIds = toValueList(params.location).map(Number);
            filtered = filtered.filter(r => locIds.indexOf(Number(r.locationId)) >= 0);
        }
        if (params.thickness && toValueList(params.thickness).length > 0) {
            const vals = toValueList(params.thickness);
            filtered = filtered.filter(r => vals.some(v => String(r.thickness || '').trim() === v));
        }
        if (params.width && toValueList(params.width).length > 0) {
            const vals = toValueList(params.width);
            filtered = filtered.filter(r => vals.some(v => String(r.width || '').trim() === v));
        }
        if (params.length && toValueList(params.length).length > 0) {
            const vals = toValueList(params.length);
            filtered = filtered.filter(r => vals.some(v => String(r.length || '').trim() === v));
        }
        if (params.grade && toValueList(params.grade).length > 0) {
            const vals = toValueList(params.grade);
            filtered = filtered.filter(r => vals.some(v => String(r.grade || '').trim() === v));
        }
        if (params.country && toValueList(params.country).length > 0) {
            const countries = toValueList(params.country);
            filtered = filtered.filter(r => r.country && countries.indexOf(r.country) >= 0);
        }
        if (params.vendor && toValueList(params.vendor).length > 0) {
            const vendors = toValueList(params.vendor);
            filtered = filtered.filter(r => {
                if (Array.isArray(r.vendors) && r.vendors.length > 0) {
                    return r.vendors.some(v => vendors.indexOf(v) >= 0);
                }
                return vendors.indexOf(String(r.vendor || '')) >= 0;
            });
        }
        if (params.po && toValueList(params.po).length > 0) {
            const pos = toValueList(params.po);
            filtered = filtered.filter(r => r.pos && r.pos.some(p => pos.indexOf(p) >= 0));
        }
        // greaterThanZero: default true — exclude rows with no activity
        if (params.greaterThanZero !== false && params.greaterThanZero !== 'false') {
            filtered = filtered.filter(r =>
                (r.onHand || 0) + (r.committed || 0) + (r.outbound || 0) +
                (r.onOrder || 0) + (r.inTransit || 0) > 0
            );
        }
        return filtered;
    };

    const handleGetContext = () => {
        const user = runtime.getCurrentUser();
        return {
            success: true,
            data: {
                userId: user.id,
                userName: user.name,
                subsidiaryId: user.subsidiary,
                accountId: runtime.accountId,
                uomConfig: { 'CWP MTL': ['Packs', 'MBF'] },
            },
        };
    };

    const handleGetMeta = () => {
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysMTL.META });
            if (!raw) return { available: false, reason: 'CACHE_MISS' };
            const meta = JSON.parse(raw);
            return {
                available:    true,
                cacheVersion: meta.cacheVersion,
                lastUpdated:  meta.lastUpdated,
                rowCount:     meta.rowCount,
                uniquePOs:    meta.uniquePOs || [],
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_mtl.getMeta', details: e.message });
            return { available: false, reason: 'ERROR' };
        }
    };

    const handleGetSummary = params => {
        try {
            const myCache = getMyCache();
            const raw = myCache.get({ key: CacheKeysMTL.SUMMARY });
            if (!raw) {
                return { error: 'CACHE_MISS', message: 'MTL cache not populated. Run the MTL Map/Reduce script.' };
            }
            const parsed = JSON.parse(raw);
            let allRows;
            if (parsed && parsed.chunked && parsed.chunkCount) {
                allRows = [];
                for (let i = 0; i < parsed.chunkCount; i++) {
                    const chunkStr = myCache.get({ key: CacheKeysMTL.buildSummaryDataKey(i) });
                    if (chunkStr) {
                        const chunkRows = JSON.parse(chunkStr);
                        if (Array.isArray(chunkRows)) allRows.push.apply(allRows, chunkRows);
                    }
                }
            } else {
                allRows = parsed;
            }
            const filtered = applyFilters(allRows, params || {});

            const metaRaw = myCache.get({ key: CacheKeysMTL.META });
            const meta = metaRaw ? JSON.parse(metaRaw) : { lastUpdated: '', cacheVersion: 0, rowCount: 0, uniquePOs: [] };

            return {
                success: true,
                rows:    filtered,
                totals:  computeTotals(filtered),
                meta: {
                    lastUpdated:  meta.lastUpdated,
                    cacheVersion: meta.cacheVersion,
                    rowCount:     filtered.length,
                    uniquePOs:    meta.uniquePOs || [],
                },
            };
        } catch (e) {
            log.error({ title: 'trader_screen_service_mtl.getSummary', details: e.message });
            return { error: 'CACHE_MISS', message: 'MTL cache error: ' + e.message };
        }
    };

    const handleGetDetail = params => {
        const itemId     = params && params.itemId;
        const locationId = params && params.locationId;
        if (!itemId || !locationId) {
            return { success: false, error: 'itemId and locationId required' };
        }
        try {
            const myCache = getMyCache();
            const key     = CacheKeysMTL.detailKey(itemId, locationId);
            const raw     = myCache.get({ key: key });
            if (!raw) {
                // Overflow fallback — MR splits large payloads into per-bucket entries
                const buckets = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available'];
                const merged = {};
                let anyFound = false;
                buckets.forEach(b => {
                    const bStr = myCache.get({ key: CacheKeysMTL.buildDetailBucketKey(itemId, locationId, b) });
                    if (bStr) { anyFound = true; merged[b] = JSON.parse(bStr); }
                });
                if (anyFound) return { success: true, data: merged };
                return { error: 'DETAIL_CACHE_MISS', message: 'MTL detail not found. Try again after cache refresh.' };
            }
            return { success: true, data: JSON.parse(raw) };
        } catch (e) {
            log.error({ title: 'trader_screen_service_mtl.getDetail', details: e.message });
            return { error: 'DETAIL_CACHE_MISS', message: 'MTL detail error: ' + e.message };
        }
    };

    const getHandler = dataIn => {
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

    // ⚠️ getRouter / postRouter — the RESTlet calls these, not the individual handlers.
    return {
        getRouter: function (dataIn) {
            if (!dataIn || !dataIn.action) {
                return { success: false, error: 'action parameter required' };
            }
            return getHandler(dataIn);
        },
        postRouter: function (dataIn) {
            return { success: false, error: 'No POST actions defined for MTL service' };
        },
    };
});
