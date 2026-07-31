/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Centralized cache key constants for Trader Screen.
 */
define([], () => {
    const CACHE_NAME = 'MGSL_TRADERSCREEN_CACHE';

    const TS_META = 'TS_META';
    const TS_SUMMARY = 'TS_SUMMARY';
    const TS_DETAIL_PREFIX = 'TS_DETAIL__';
    const TS_LAST_RUN_TIMESTAMP = 'TS_LAST_RUN_TIMESTAMP';
    const TS_LAST_FULL_TIMESTAMP = 'TS_LAST_FULL_TIMESTAMP';
    const TS_SUMMARY_CHUNK_PREFIX = 'TS_SUMMARY_CHUNK__';
    const TS_REDUCE_BATCH_PREFIX = 'TS_RB__';
    const REDUCE_BATCH_COUNT = 20;
    const TS_SUMMARY_DATA_PREFIX = 'TS_SUMMARY_DATA__';
    const MAX_CACHE_VALUE_BYTES = 450 * 1024;

    // TS_SUMMARY (+ its chunks) and TS_META live under this TTL, and summarize
    // only rewrites them on a run that produced output. Under real DELTA mode a
    // quiet subsidiary produces no output for hours — every run is "DELTA 0
    // changes" — so a 30-min TTL let both keys expire with nothing rebuilding
    // them, and the screen answered "Cache is being rebuilt, try again shortly"
    // until the next hourly FULL (Julie, sandbox 2026-07-31). Must outlive the
    // MR's FULL backstop (FULL_REFRESH_MS, 1h) with margin — same reasoning that
    // took TTL_DETAIL to 4h.
    const TTL_SUMMARY = 14400;
    // Detail entries are rewritten only when their (item, location) key is
    // rebuilt; under real DELTA mode quiet keys go hours between rebuilds, so
    // this must outlive the hourly FULL-refresh backstop with margin (the 30-min
    // TTL killed quiet keys' drawers on MTL once the full-rebuild churn stopped,
    // 2026-07-28).
    const TTL_DETAIL = 14400;
    const TTL_LAST_RUN = 86400;

    const buildDetailKey = (itemId, locationId) =>
        TS_DETAIL_PREFIX + itemId + '__' + locationId;

    const buildDetailBucketKey = (itemId, locationId, bucket) =>
        TS_DETAIL_PREFIX + itemId + '__' + locationId + '__' + bucket;

    const buildChunkKey = (reduceKey) =>
        TS_SUMMARY_CHUNK_PREFIX + reduceKey;

    const buildReduceBatchKey = (batchNum) =>
        TS_REDUCE_BATCH_PREFIX + batchNum;

    const buildSummaryDataKey = (index) =>
        TS_SUMMARY_DATA_PREFIX + index;

    return {
        CACHE_NAME,
        TS_META,
        TS_SUMMARY,
        TS_DETAIL_PREFIX,
        TS_LAST_RUN_TIMESTAMP,
        TS_LAST_FULL_TIMESTAMP,
        TS_SUMMARY_CHUNK_PREFIX,
        TS_REDUCE_BATCH_PREFIX,
        REDUCE_BATCH_COUNT,
        TS_SUMMARY_DATA_PREFIX,
        MAX_CACHE_VALUE_BYTES,
        TTL_SUMMARY,
        TTL_DETAIL,
        TTL_LAST_RUN,
        buildDetailKey,
        buildDetailBucketKey,
        buildChunkKey,
        buildReduceBatchKey,
        buildSummaryDataKey,
    };
});
