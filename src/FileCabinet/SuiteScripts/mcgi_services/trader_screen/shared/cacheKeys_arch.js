/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Cache key constants for Trader Screen — CWP ARCH (subsidiary 9).
 *
 * IND, MTL and ARCH all share the one N/cache bucket
 * ('MGSL_TRADERSCREEN_CACHE'). The TS_ARCH_ prefix is the namespace separator,
 * exactly as TS_MTL_ is for Montréal. Nothing here may collide with either.
 *
 * ── TTLs are NOT a fresh decision ───────────────────────────────────────────
 * They are copied from MTL/IND deliberately, because the 30-minute value they
 * started with was a real production bug and the 4-hour value is what fixed it.
 * Repeating the original number here would re-buy that bug at full price:
 *
 *   A run that finds no changed pairs returns early and never rewrites SUMMARY
 *   or META. Any quiet stretch longer than the TTL therefore expired them, and
 *   the screen fell back to "cache is being rebuilt" until the next hourly FULL.
 *
 *   Worse, it opened a truncation path the summarize shrink guard structurally
 *   cannot close: once SUMMARY has expired there is no cached row count left to
 *   compare against, so the guard disarms and the next small DELTA legitimately
 *   replaces the whole summary with its handful of rows.
 *
 * The rule the numbers encode: every TTL must outlive the FULL-refresh backstop
 * with margin. Do not lower these to "match the refresh interval" — that is the
 * exact reasoning that caused the outage.
 *
 * ── What ARCH adds that IND and MTL do not have ─────────────────────────────
 * Two extra buckets, `reserve` and `readyToBuild`, and lot-level payloads with
 * per-lot tallies and container numbers. That is the main reason ARCH gets its
 * own fork rather than reusing the IND builder with a subsidiary parameter, as
 * Nic's SDD suggests: MTL already needed a fork, and MTL diverges from IND far
 * less than ARCH does.
 */
define([], () => {

    const TS_ARCH_DETAIL_PREFIX       = 'TS_ARCH_DETAIL__';
    const TS_ARCH_SUMMARY_DATA_PREFIX = 'TS_ARCH_SUMMARY_DATA_';

    const TTL_SUMMARY           = 14400;       // 4h — see the note above before changing
    const TTL_DETAIL            = 14400;       // 4h
    const TTL_LAST_RUN          = 86400;       // 24h
    const MAX_CACHE_VALUE_BYTES = 500 * 1024;  // 500 KB, N/cache's hard per-value ceiling

    const detailKey = (itemId, locationId) =>
        TS_ARCH_DETAIL_PREFIX + itemId + '__' + locationId;

    const buildDetailBucketKey = (itemId, locationId, bucket) =>
        TS_ARCH_DETAIL_PREFIX + itemId + '__' + locationId + '__' + bucket;

    const buildSummaryDataKey = (index) =>
        TS_ARCH_SUMMARY_DATA_PREFIX + index;

    return {
        CACHE_NAME:            'MGSL_TRADERSCREEN_CACHE',
        SUMMARY:               'TS_ARCH_SUMMARY',
        META:                  'TS_ARCH_META',
        LAST_RUN:              'TS_ARCH_LAST_RUN_TIMESTAMP',
        LAST_FULL:             'TS_ARCH_LAST_FULL_TIMESTAMP',
        LAST_INPUT_MODE:       'TS_ARCH_LAST_INPUT_MODE',
        LOCATION_NAMES:        'TS_ARCH_LOCATION_NAMES',
        ACTIVE_HOLDS:          'TS_ARCH_ACTIVE_HOLDS',
        TTL_SUMMARY:           TTL_SUMMARY,
        TTL_DETAIL:            TTL_DETAIL,
        TTL_LAST_RUN:          TTL_LAST_RUN,
        MAX_CACHE_VALUE_BYTES: MAX_CACHE_VALUE_BYTES,
        detailKey:             detailKey,
        buildDetailBucketKey:  buildDetailBucketKey,
        buildSummaryDataKey:   buildSummaryDataKey,
    };
});
