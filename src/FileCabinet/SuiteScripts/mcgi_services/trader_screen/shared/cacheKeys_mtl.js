/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Cache key constants for Trader Screen — CWP MTL.
 *
 * IND and MTL share the same N/cache bucket ('MGSL_TRADERSCREEN_CACHE').
 * The TS_MTL_ prefix is the namespace separator.
 */
define([], () => {
    const TS_MTL_DETAIL_PREFIX       = 'TS_MTL_DETAIL__';
    const TS_MTL_SUMMARY_DATA_PREFIX = 'TS_MTL_SUMMARY_DATA_';

    const TTL_SUMMARY           = 1800;        // 30 min
    const TTL_LAST_RUN          = 86400;       // 24h
    const MAX_CACHE_VALUE_BYTES = 500 * 1024;  // 500 KB

    const detailKey = (itemId, locationId) =>
        TS_MTL_DETAIL_PREFIX + itemId + '__' + locationId;

    const buildDetailBucketKey = (itemId, locationId, bucket) =>
        TS_MTL_DETAIL_PREFIX + itemId + '__' + locationId + '__' + bucket;

    const buildSummaryDataKey = (index) =>
        TS_MTL_SUMMARY_DATA_PREFIX + index;

    return {
        CACHE_NAME:            'MGSL_TRADERSCREEN_CACHE',
        SUMMARY:               'TS_MTL_SUMMARY',
        META:                  'TS_MTL_META',
        LAST_RUN:              'TS_MTL_LAST_RUN_TIMESTAMP',
        LAST_INPUT_MODE:       'TS_MTL_LAST_INPUT_MODE',
        LOCATION_NAMES:        'TS_MTL_LOCATION_NAMES',
        ACTIVE_HOLDS:          'TS_MTL_ACTIVE_HOLDS',
        TTL_SUMMARY:           TTL_SUMMARY,
        TTL_LAST_RUN:          TTL_LAST_RUN,
        MAX_CACHE_VALUE_BYTES: MAX_CACHE_VALUE_BYTES,
        detailKey:             detailKey,
        buildDetailBucketKey:  buildDetailBucketKey,
        buildSummaryDataKey:   buildSummaryDataKey,
    };
});
