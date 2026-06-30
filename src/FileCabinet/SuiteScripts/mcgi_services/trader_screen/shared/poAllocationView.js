/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description PO Allocation view of the Trader Screen cache.
 *
 * Reads the buckets PO Allocation needs (onHand + committed + outbound + onOrder
 * + inTransit) from MGSL_TRADERSCREEN_CACHE. onOrder and inTransit feed the
 * unreceived-segment list so PO Allocation can render its full segment chooser
 * (open POs AND billed-not-received/in-transit POs) from cache alone.
 *
 * PO Allocation imports via absolute path:
 *   /SuiteScripts/mcgi_services/trader_screen/shared/poAllocationView
 *
 * Sub mapping: 5 → MTL prefix (TS_MTL_*); anything else → IND prefix (TS_*).
 * Other subsidiaries naturally return null on cache miss → caller falls through
 * to live SuiteQL.
 *
 * See plans/for-po-allocation-sbx-transient.
 */
define([
    './cacheClient',
    './cacheKeys',
    './cacheKeys_mtl',
], (CacheClient, CacheKeys, CacheKeysMTL) => {

    const isMtl = (subsidiaryId) => String(subsidiaryId) === '5';

    const pickKeys = (subsidiaryId) => isMtl(subsidiaryId) ? {
        detailKey:        CacheKeysMTL.detailKey,
        detailBucketKey:  CacheKeysMTL.buildDetailBucketKey,
        metaKey:          CacheKeysMTL.META,
    } : {
        detailKey:        CacheKeys.buildDetailKey,
        detailBucketKey:  CacheKeys.buildDetailBucketKey,
        metaKey:          CacheKeys.TS_META,
    };

    /**
     * Fetch onHand/committed/outbound/onOrder buckets for a given (item, location) pair.
     * Returns null on miss or error so the caller can fall through to live SuiteQL.
     *
     * @param {string|number} subsidiaryId
     * @param {string|number} itemId
     * @param {string|number} locationId
     * @returns {{onHand: Array, committed: Array, outbound: Array, onOrder: Array, inTransit: Array, available: Array, lastUpdated: string, cacheVersion: number} | null}
     */
    const getReceivedDetailByItemLocation = (subsidiaryId, itemId, locationId) => {
        if (!itemId || !locationId) return null;
        try {
            const keys    = pickKeys(subsidiaryId);
            const myCache = CacheClient.getCache();
            const detKey  = keys.detailKey(itemId, locationId);
            const raw     = myCache.get({ key: detKey });

            let detail = null;
            if (raw) {
                try { detail = JSON.parse(raw); } catch (_e) { detail = null; }
            }

            // Overflow fallback — MR splits per-bucket when payload exceeds size limit
            if (!detail) {
                const buckets = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available'];
                const merged  = {};
                let anyFound  = false;
                buckets.forEach((b) => {
                    const bStr = myCache.get({ key: keys.detailBucketKey(itemId, locationId, b) });
                    if (bStr) {
                        try {
                            merged[b] = JSON.parse(bStr);
                            anyFound  = true;
                        } catch (_e) {}
                    }
                });
                if (anyFound) detail = merged;
            }
            if (!detail) return null;

            // Meta (lastUpdated / cacheVersion) — best-effort, missing meta is OK
            let lastUpdated  = '';
            let cacheVersion = 0;
            try {
                const metaRaw = myCache.get({ key: keys.metaKey });
                if (metaRaw) {
                    const meta   = JSON.parse(metaRaw);
                    lastUpdated  = meta.lastUpdated || '';
                    cacheVersion = meta.cacheVersion || 0;
                }
            } catch (_e) {}

            return {
                onHand:       Array.isArray(detail.onHand)    ? detail.onHand    : [],
                committed:    Array.isArray(detail.committed) ? detail.committed : [],
                outbound:     Array.isArray(detail.outbound)  ? detail.outbound  : [],
                onOrder:      Array.isArray(detail.onOrder)   ? detail.onOrder   : [],
                // In-transit (billed-but-not-received) POs — PO Allocation pre-commits
                // against these like on-order. IND consumes this raw array; MTL also
                // surfaces them as status='In Transit' rows inside `available` below.
                inTransit:    Array.isArray(detail.inTransit) ? detail.inTransit : [],
                // MTL emits `available` as an array of source rows (one per stock
                // source, with status='On Order' / 'On Hand' / 'In Transit' /
                // 'Committed'). IND emits it as a scalar — `Array.isArray` keeps
                // PO Allocation's consumer code safe in both shapes.
                available:    Array.isArray(detail.available) ? detail.available : [],
                lastUpdated:  lastUpdated,
                cacheVersion: cacheVersion,
            };
        } catch (_e) {
            return null;
        }
    };

    return {
        getReceivedDetailByItemLocation: getReceivedDetailByItemLocation,
    };
});
