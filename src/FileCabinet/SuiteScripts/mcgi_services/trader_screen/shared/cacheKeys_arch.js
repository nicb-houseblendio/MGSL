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
 * ⚠️ AND DO NOT ADD A SCHEDULE BACK ALONGSIDE THE CHAIN, 2026-08-26. There is no
 * scheduled deployment on ARCH any more, and the obvious idea once you know the
 * chain can die is to re-enable the hourly recurrence as a safety net. It is not
 * one, it is a slow fork. Every run resubmits itself exactly once, so a scheduled
 * fire lands as an EXTRA chain member on top of the one already circulating, and
 * that member then resubmits forever too. The chain grows by one per scheduled
 * fire: hourly means about 25 concurrent members after a day. `concurrencylimit`
 * 1 hides it by queueing them rather than preventing it. The right safety net is
 * external, which is what `cachecheck.mjs` is for.
 *
 * ⚠️ THE SAME ARITHMETIC APPLIES TO THE SAVE & EXECUTE BUTTON, which is the far
 * likelier way it happens, because pressing it is the natural human response to a
 * screen that looks stale. One press on a LIVE chain is one extra permanent
 * member. Always run `node cachecheck.mjs` first: FRESH means do not press.
 * The builder's own header carries the full procedure.
 *
 * ── What ARCH adds that IND and MTL do not have ─────────────────────────────
 * Two extra buckets, `reserve` and `readyToBuild`, and lot-level payloads with
 * per-lot tallies, PO numbers and costs. That is the main reason ARCH gets its
 * own fork rather than reusing the IND builder with a subsidiary parameter, as
 * Nic's SDD suggests: MTL already needed a fork, and MTL diverges from IND far
 * less than ARCH does.
 */
define([], () => {

    const TS_ARCH_DETAIL_PREFIX       = 'TS_ARCH_DETAIL__';
    const TS_ARCH_SUMMARY_DATA_PREFIX = 'TS_ARCH_SUMMARY_DATA_';

    // 12h, NOT 4h. Sized to outlive the schedule's ~8h nightly gap with margin —
    // read the note above before changing either of these.
    //
    // ⚠️ THE NIGHTLY GAP IS GONE as of 2026-08-26: the hourly schedule was
    // replaced by a self-rescheduling chain in the builder, so the ~8h window
    // these numbers were sized against no longer exists. The reason for 12h has
    // changed; the number has not, and it must not be "corrected" downward.
    //
    // The refresh backstop is now roughly one hour, which by the rule above would
    // permit a far shorter TTL. Keep 12h anyway, because the failure mode changed
    // too. A dead SCHEDULE used to be recoverable by the next day's start. A dead
    // CHAIN has nothing to restart it from inside NetSuite, so the TTL is now the
    // only thing standing between chain death and an empty screen. 12h is most of
    // a working day in which someone can notice and press one button. Matching the
    // TTL to the refresh interval would convert a dead chain into a dead screen
    // within the hour, which is the same mistake in a new costume.
    const TTL_SUMMARY           = 43200;       // 12h
    const TTL_DETAIL            = 43200;       // 12h
    const MAX_CACHE_VALUE_BYTES = 500 * 1024;  // 500 KB, N/cache's hard per-value ceiling

    /* ── ⚠️ THERE IS NO TTL_PACE HERE, AND THERE MUST NOT BE ────────────────────
     *
     * The pacing key's TTL is DERIVED in the builder, from REBUILD_INTERVAL_MS, as
     * `PACE_TTL_SECONDS`. It was briefly a constant here (7200, "2h against a 1h
     * interval") and that was a latent bug, not merely redundant.
     *
     * The gate only works while the key outlives the interval. Those are two halves
     * of ONE invariant, and putting them in two files meant someone raising the
     * interval above 2h in the builder would satisfy every local check, pass
     * review, and silently arm the worst failure available: the key expires before
     * the gate opens, the gate fails open by design, and every cycle becomes a full
     * rebuild at ~1,330 an hour.
     *
     * A TTL belongs beside the interval it protects. Do not "tidy" it back into
     * this module for symmetry with TTL_SUMMARY and TTL_DETAIL; those two are not
     * coupled to anything in the builder, and this one is.
     */
    // No TTL_LAST_RUN either: it existed only for the LAST_RUN key, which is gone.
    // See the note on the return block below.

    const detailKey = (itemId, locationId) =>
        TS_ARCH_DETAIL_PREFIX + itemId + '__' + locationId;

    const buildDetailBucketKey = (itemId, locationId, bucket) =>
        TS_ARCH_DETAIL_PREFIX + itemId + '__' + locationId + '__' + bucket;

    const buildSummaryDataKey = (index) =>
        TS_ARCH_SUMMARY_DATA_PREFIX + index;

    /* ── Five keys were DELETED here on 2026-08-19, deliberately ──────────────
     *
     * `LAST_RUN`, `LAST_FULL`, `LAST_INPUT_MODE`, `LOCATION_NAMES` and
     * `ACTIVE_HOLDS` were copied from MTL's key surface and never written by
     * anything. Measured before removing: zero references in the ARCH builder,
     * zero in the ARCH service, zero anywhere else in the tree. IND and MTL have
     * their own key modules (`cacheKeys.js`, `cacheKeys_mtl.js`) and are
     * untouched by this.
     *
     * A key surface is a contract. Declaring a delta-mode key on a builder that
     * only ever does FULL rebuilds advertises a capability that does not exist,
     * which is exactly what made these worth deleting rather than leaving.
     *
     * ➕ **`CACHE_NAME` went too, 2026-08-20**, found by auditing the first pass
     * rather than by it. It also had zero consumers in the builder and the
     * service, and worse, it implied ARCH owns a cache. It does not:
     * `cacheClient.js` is `define(['N/cache', './cacheKeys'])` and takes the
     * cache name from **IND's** key module, so all three screens share ONE
     * N/cache instance and are separated only by their key prefixes
     * (`TS_ARCH_*` here). Anyone needing the cache name must go through
     * CacheClient; do not re-declare it here.
     *
     * ⚠️ `LAST_RUN` was NOT repopulated, and the note suggesting it should be is
     * wrong. Its stated purpose was to let the service say "last updated 3h ago,
     * not refreshing" instead of a bare cache miss — but META ALREADY CARRIES
     * THAT, and more precisely: `lastUpdated` (when SUMMARY was last actually
     * written) and `lastAttempt` (when a run last tried), which diverge exactly
     * when the shrink guard refuses. The service already surfaces both. A
     * separate LAST_RUN key would be a second source of truth for the same fact,
     * written non-atomically beside the payload, i.e. free drift. If more
     * run-state is ever needed, add a field to META rather than a key here.
     */

    /* ── ➕ PACE_LAST_START, added 2026-08-26, and it is NOT the LAST_RUN mistake
     *
     * Read this before deleting it, because it looks exactly like the key the
     * warning above says not to re-add. The warning stands; it does not apply,
     * and the difference is the whole reason this key exists.
     *
     * That warning forbids a SECOND SOURCE OF TRUTH FOR THE SAME FACT. META's
     * `lastAttempt` answers "when did summarize last conclude". This key answers
     * "when did getInputData last begin real work". Those are different facts, and
     * on every failure path they hold different values.
     *
     * Why the difference is load-bearing. The builder now paces itself: it runs as
     * a continuous self-rescheduling chain and this key is what makes most cycles
     * cheap no-ops. So the pacing signal has to be written at the DECISION POINT,
     * at the top of getInputData, before any query runs. META is written at the
     * very END of the pipeline, and there are four paths that reach the end
     * without writing it: the over-ceiling early return, the zero-output guard, an
     * exception in summarize, and an exception in getInputData.
     *
     * Pace off META and every one of those four becomes a HOT LOOP. The run fails,
     * META keeps its old timestamp, the gate reads "stale", the next cycle does the
     * same full rebuild about twenty seconds later, and it fails again. The
     * deployment carries notifyemails, so a persistent failure would become
     * thousands of identical error lines and thousands of emails in a day. That is
     * a strictly worse outage than the one this whole change is fixing.
     *
     * Stamped at the top of getInputData, the interval holds no matter what
     * happens downstream, including a total failure. That crash-safety is the
     * property being bought, and META structurally cannot provide it.
     *
     * It is also write-only from the builder's side: no consumer reads it, the
     * service does not surface it, and it must never be used to tell the screen
     * anything. `lastUpdated` and `lastAttempt` remain the only reportable run
     * state, so the drift the warning above is about cannot start here.
     */
    return {
        SUMMARY:               'TS_ARCH_SUMMARY',
        META:                  'TS_ARCH_META',
        PACE_LAST_START:       'TS_ARCH_PACE_LAST_START',
        TTL_SUMMARY:           TTL_SUMMARY,
        TTL_DETAIL:            TTL_DETAIL,
        MAX_CACHE_VALUE_BYTES: MAX_CACHE_VALUE_BYTES,
        detailKey:             detailKey,
        buildDetailBucketKey:  buildDetailBucketKey,
        buildSummaryDataKey:   buildSummaryDataKey,
    };
});
