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

    // Was 1800 (30 min), annotated "rewritten every MR run" — which stopped being
    // true once deltas started working (2026-07-28). A run with pairCount === 0
    // returns early and never rewrites SUMMARY/META, so any stretch quieter than the
    // TTL expired them and the screen fell back to "cache is being rebuilt" until the
    // next hourly FULL. Must outlive the FULL_REFRESH_MS backstop with margin, same
    // reasoning as TTL_DETAIL below. IND shipped this 2026-07-31.
    //
    // It also closes a truncation path the summarize shrink guard structurally cannot:
    // once SUMMARY has expired there is no cached row count left to compare against,
    // so the guard disarms (hasCache === false) and the next small DELTA legitimately
    // replaces the entire summary with its handful of rows.
    const TTL_SUMMARY           = 14400;       // 4h
    // Detail entries are rewritten only when their (item, location) key is
    // rebuilt. Under real DELTA mode (working since 2026-07-28) quiet keys are
    // not rebuilt for hours, so their TTL must outlive the hourly FULL-refresh
    // backstop with margin — a 30-min TTL made every quiet key's drawer die
    // with "MTL detail not found" once the accidental full-rebuild churn stopped.
    const TTL_DETAIL            = 14400;       // 4h
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
        LAST_FULL:             'TS_MTL_LAST_FULL_TIMESTAMP',
        LAST_INPUT_MODE:       'TS_MTL_LAST_INPUT_MODE',
        LOCATION_NAMES:        'TS_MTL_LOCATION_NAMES',
        ACTIVE_HOLDS:          'TS_MTL_ACTIVE_HOLDS',
        TTL_SUMMARY:           TTL_SUMMARY,
        TTL_DETAIL:            TTL_DETAIL,
        TTL_LAST_RUN:          TTL_LAST_RUN,
        MAX_CACHE_VALUE_BYTES: MAX_CACHE_VALUE_BYTES,
        detailKey:             detailKey,
        buildDetailBucketKey:  buildDetailBucketKey,
        buildSummaryDataKey:   buildSummaryDataKey,
    };
});
