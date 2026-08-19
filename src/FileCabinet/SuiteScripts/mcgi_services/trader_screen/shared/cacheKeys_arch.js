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
 * ── RAISED 4h → 12h ON 2026-08-19, because the schedule has a nightly gap ────
 * The hourly schedule does NOT give 24-hour coverage. Measured over the first
 * full night, 2026-08-18/19:
 *
 *     07:01 … 20:02 PT   hourly, unbroken
 *     20:02 → 04:01 PT   ~8 HOUR GAP, seven runs missing
 *     04:01 PT onward    resumes
 *
 * The resume is at 11:01Z — EXACTLY the configured `starttime`. So the daily
 * event fires at 11:00Z, repeats hourly for roughly sixteen hours, and then
 * stops until the next day's start. It is a bounded repeat window, not
 * continuous.
 *
 * At a 4h TTL the arithmetic was: last write 03:02Z, expired ~07:02Z, next run
 * 11:01Z — so the cache was DEAD about four hours every night. That is the same
 * failure scheduling was meant to fix, reduced from permanent to nightly rather
 * than removed.
 *
 * 12h outlives an 8h gap with 4h of margin. The real refresh backstop is now the
 * next day's start (~24h), not one hour, so by the rule above the TTL had to grow
 * with it.
 *
 * THE TRADE-OFF, STATED: at 4h the cache dies nightly and shows nothing; at 12h
 * it survives and may serve data up to 12h old. Staleness is VISIBLE — the
 * builder publishes `lastUpdated` and `lastAttempt`, the service passes them
 * through, and the screen badge surfaces them — so this is the same judgement as
 * the shrink guard: stale-but-labelled beats dead-or-silently-wrong.
 *
 * ⚠️ DO NOT close the gap by adding a second scheduled deployment. That is
 * mechanism 3 of the IND trap and forks a chain that cannot be stopped. One
 * script, one deployment.
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

    // 12h, NOT 4h. Sized to outlive the schedule's ~8h nightly gap with margin —
    // read the note above before changing either of these.
    const TTL_SUMMARY           = 43200;       // 12h
    const TTL_DETAIL            = 43200;       // 12h
    const TTL_LAST_RUN          = 86400;       // 24h, N/cache's maximum
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
