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
    const TS_SUMMARY_CHUNK_PREFIX = 'TS_SUMMARY_CHUNK__';
    const TS_REDUCE_BATCH_PREFIX = 'TS_RB__';
    const REDUCE_BATCH_COUNT = 20;
    const TS_SUMMARY_DATA_PREFIX = 'TS_SUMMARY_DATA__';
    const MAX_CACHE_VALUE_BYTES = 450 * 1024;

    const TTL_SUMMARY = 1800;
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
        TS_SUMMARY_CHUNK_PREFIX,
        TS_REDUCE_BATCH_PREFIX,
        REDUCE_BATCH_COUNT,
        TS_SUMMARY_DATA_PREFIX,
        MAX_CACHE_VALUE_BYTES,
        TTL_SUMMARY,
        TTL_LAST_RUN,
        buildDetailKey,
        buildDetailBucketKey,
        buildChunkKey,
        buildReduceBatchKey,
        buildSummaryDataKey,
    };
});
