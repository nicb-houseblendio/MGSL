/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 * @description Trader Screen cache builder — CWP ARCH (subsidiary 9).
 *
 * Pre-computes one summary row per item × location for hardwood, plus a
 * lot-level detail payload per pair, and writes both to N/cache so the React
 * screen loads with zero search governance.
 *
 * ═══ 🔴 DEPLOY ORDER: bundle.js FIRST, THEN THIS FILE ═══════════════════════
 * Mandatory, not a preference. This builder's payload no longer carries
 * row-level `containers` (removed 2026-08-19 with the Container column), and the
 * pre-2026-08-19 front end does `row.original.containers.length` on it, which
 * throws on undefined.
 *
 * **In production that is a HARD break, not a degraded view.** The Suitelet
 * INLINES bundle.js into every HTML response, so there is no per-browser caching
 * to soften it: an old bundle plus a new payload throws during render on every
 * page load for every user until the bundle is uploaded.
 *
 * The reverse order is always safe, because the current front end ignores extra
 * fields on an older cached payload. So: bundle.js, then this file, then wait one
 * pacing interval for the chain to rebuild. `deploy.xml` is banned here (it
 * clobbers ungit'd sandbox work), which means every ARCH deploy is hand-scoped —
 * exactly the situation where an ordering rule gets missed.
 *
 * ⚠️ Uploading THIS file does not restart the builder. The chain carries the
 * running code, so a new upload is picked up by the next cycle, but if the chain
 * is already dead the upload changes nothing and the screen stays on fixtures.
 * Confirm with `node cachecheck.mjs` after any deploy, and if it reports stale or
 * missing, restart with one Save & Execute on deployment 1. If it reports FRESH,
 * the chain is alive and you must NOT press that button: it would fork the chain
 * permanently. See THE CHAIN below.
 *
 * ⚠️ Nothing in the code enforces this yet. `cacheVersion` in META is the
 * obvious place to make it self-detecting, but it is currently decorative: this
 * file hardcodes 1 and the service only forwards it, never compares it. Bumping
 * it without adding that comparison would change nothing. See todo-list 5.6.
 *
 * ANY future change to the summary row's shape inherits this constraint. Adding
 * a field is safe in both directions; REMOVING one is not.
 *
 * ═══ STATUS: FIVE OF SIX BUCKETS BUILT ══════════════════════════════════════
 * Updated 2026-08-18. The original version of this header said "On Hand only",
 * which was true when there was not a single ARCH sales or purchase order in the
 * account. Seeded orders now exist, so four more are sourced:
 *
 *   onHand        ✅ lot balances
 *   reserve       ✅ open sales-order quantity — sold, still in the building
 *   outbound      ✅ shipped sales-order quantity
 *   onOrder       ✅ open purchase-order quantity — ordered, not received
 *   inTransit     ✅ purchase-order quantity billed but not received
 *   readyToBuild  ⛔ NO FIELD EXISTS to source it from. Marc-Antoine describes
 *                    it as a header status a trader ticks by hand; every
 *                    candidate custbody name was probed on 2026-08-18 and none
 *                    resolved. It stays a literal 0 — a proxy would invent data.
 *
 * `bucketsBuilt` / `bucketsEmpty` in META carry this to the browser, so the
 * screen states which columns are real rather than showing five confident zeros.
 *
 * ── The honest gap: lot attribution ─────────────────────────────────────────
 * ARCH is lot-centric, so each bucket is wanted PER LOT. That needs the order
 * line to carry an inventory-detail assignment. Real ARCH orders do; the seeded
 * ones do not, because no inventory detail was set on them. Quantity that no lot
 * can claim is therefore published as `unattributed` rather than dropped or
 * spread — so a drill-down showing fewer lots than the column implies reads as a
 * known gap instead of a bug.
 *
 * ═══ WHY N/query AND NOT SAVED SEARCHES ═════════════════════════════════════
 * A DEPARTURE from IND and MTL, which each drive off six saved searches. Three
 * reasons it is the right call here and not merely convenient:
 *
 *  1. ARCH is LOT-CENTRIC. The screen shows per-lot rows, tallies, per-lot PO
 *     numbers and per-lot costs. IND/MTL aggregate to item × location and never
 *     descend to the lot. Saved searches express lot-level joins awkwardly;
 *     SuiteQL expresses them directly.
 *  2. Saved searches live in the NetSuite UI, not in this repo. They cannot be
 *     reviewed, diffed or deployed with the code, and the existing ones are
 *     already documented as a fragility.
 *  3. Governance is not the constraint it was for IND. IND holds ~1 195 item ×
 *     location rows and MTL 446; ARCH currently has 6 SKUs. The reason saved
 *     searches were chosen — pushing heavy formula columns into the search
 *     engine — does not apply at this size.
 *
 * If ARCH later grows to IND's scale and this becomes a governance problem, the
 * fix is to move the aggregation into SuiteQL GROUP BY, not to go back to saved
 * searches.
 *
 * ═══ UNITS — the thing most likely to be got wrong ══════════════════════════
 * `inventorynumberlocation.quantityonhand` is stored in the item's BASE unit.
 * For Lumber the base is MBF, so a lot reading 1.170 holds 1 170 BF. Veneer
 * (Square Feet) and Ovals (Unit) are base-rate 1 and pass through untouched.
 *
 * TWO OF THE THREE NEED NO CONVERSION, which is exactly what makes the third
 * easy to miss — it already produced a remainder created three orders of
 * magnitude short during split testing. Everything leaving this module is in
 * DISPLAY units, and `unit` travels with every row so the screen can label it.
 *
 * ═══ WHAT IS NOT HERE YET ═══════════════════════════════════════════════════
 * DELTA mode. IND and MTL both carry one, and IND's was broken for months in a
 * way that cost real time to find. Building a delta against an account with no
 * transaction churn would be untestable in the same way the five empty buckets
 * are. FULL rebuild only, until there is something to be incremental about.
 */
define([
    // The N/cache module is deliberately NOT imported: every cache touch goes
    // through CacheClient, which owns the name and the getCache() call. Removed
    // 2026-08-19. N/runtime IS used and must stay, for two script parameters:
    // the cost book and the force-full override.
    //
    // N/task added 2026-08-26 for the self-reschedule at the end of summarize.
    // It is what keeps this builder running at all now that the deployment is
    // NOTSCHEDULED, so it is not optional and not decorative.
    //
    // AMD binds these POSITIONALLY. Never delete a module id without deleting
    // its parameter below in the same edit. (Module ids are written unquoted in
    // this comment on purpose: a quoted one here is picked up by naive scripts
    // that count the array's entries, which cost me a false misalignment report.)
    'N/query', 'N/search', 'N/log', 'N/runtime', 'N/task',
    '../../shared/cacheKeys_arch',
    '../../shared/cacheClient',
    // Shared FIFO lot-cost engine, validated to the cent against production GL
    // (2026-06-11). MTL already depends on it, so it exists in both sandbox and
    // production — but it is NOT tracked in this repo and drifts per
    // environment, so treat its output as data to be checked, not as a given.
    // Every call here is wrapped: costing must never take down the cache build.
    '/SuiteScripts/MCGI_LIB_LotCost',
], (query, search, log, runtime, task, CacheKeys, CacheClient, LotCostLib) => {

    /**
     * ⚠️ ARCH STOCK IS **NOT** SCOPED BY SUBSIDIARY OR LOCATION. Do not "fix"
     * this back to a subsidiary filter — it was tried on 2026-08-17 and it is
     * structurally wrong, not merely broken:
     *
     *   The three locations holding hardwood — 122 CWP Prevost, 135 USL,
     *   136 CAL — ALL belong to subsidiary 5 (MTL), not 9 (ARC). Subsidiary 9
     *   maps to one unrelated location. A `location.subsidiary = 9` filter
     *   therefore matches nothing, and `JOIN location ... WHERE loc.subsidiary`
     *   does not even execute — NetSuite rejects it with
     *   SSS_SEARCH_ERROR_OCCURRED, the same way `transaction.subsidiary` is
     *   NOT_EXPOSED for search.
     *
     * This is the same conclusion the client reached independently on the
     * 2026-08-17 call: CWP Prevost is a shared reload carrying both softwood
     * and hardwood, so location cannot separate them. Nic's ruling was that
     * hardwood/softwood is the nature of the wood and therefore belongs on the
     * SKU. Andrei agreed. Scope by SKU.
     *
     * ── The discriminator, and why it is temporary ──────────────────────────
     * The SKU-level hardwood/softwood segment Lucas and Julie are adding is not
     * populated yet, so there is nothing durable to filter on today. The one
     * property that separates them cleanly right now is the units type: ARCH
     * items are sold by MBF, by the piece or by the square foot, and softwood
     * items in this account carry no units type at all.
     *
     * The account defines five units types, verified 2026-08-17:
     *   1 MBF          → Lumber  (PUR44KD, ZEB44KD, ZEB84KD, SAP54FCKD)
     *   2 Manual       → six MTL dunnage items: pallets, nets, blocks & slats
     *   3 Linear Feet  → NO ITEMS YET. This is what Decking will be sold in.
     *   4 Unit         → Ovals   (WAL44OVLOUTKD)
     *   5 Square Feet  → Veneer  (WALVENFCAA)
     *
     * ── Why this EXCLUDES rather than allowlists ────────────────────────────
     * The first version listed [1, 4, 5], the three types that had items. That
     * was a live bug: type 3 is Linear Feet, Decking is sold by the linear
     * foot, and the Decking category is already documented as existing-but-
     * empty. The day those items were created the cache would have dropped
     * every one of them — no error, no empty result to notice, just a whole
     * product category quietly absent from the screen. The SKU log below lists
     * what MATCHED; it can never show what was missed.
     *
     * Excluding the one known-foreign type instead means a new hardwood unit is
     * included by default. The failure mode flips from "stock silently missing"
     * to "something unexpected appears in the logged SKU list" — the second is
     * visible, the first is not.
     *
     * ── SUPERSEDED 2026-08-18. The units-type heuristic is NO LONGER the scope. ─
     * Scoping is now `cseg_subsidiary_loc = Hardwood` on the item — a real
     * segment rather than a proxy. What is kept below is only the early-warning
     * query, which uses the old heuristic to spot SKUs that look like hardwood
     * but were never tagged.
     *
     * How it got here: Lucas and Julie had applied the segment to LOCATIONS
     * only, and the data showed exactly the problem Nic described on the
     * 2026-08-17 call — CWP Prevost is tagged SOFTWOOD and holds 79 of the 97
     * hardwood lots, because it is a shared reload. The segment was already
     * enabled on the item record but blank on every SKU, so on 2026-08-18 the
     * six ARCH SKUs (plus our Decking test item) were tagged Hardwood, with
     * Andrei's explicit approval.
     *
     * ⚠️ TWO THINGS TO KNOW.
     *   - The segment POSTS TO GL. It is present on transaction and
     *     transactionline, so it now sources onto ARCH transaction lines created
     *     from here on. Existing lines are not retroactively tagged.
     *   - Tagging is a DELIBERATE ACT, so an untagged hardwood SKU is invisible
     *     to this screen. That is the cost of dropping the heuristic, which
     *     caught things by accident. UNTAGGED_SQL below is the mitigation.
     */
    const HARDWOOD_SEGMENT = 1;         // customrecord_cseg_subsidiary_loc: 1=Hardwood, 2=Softwood
    const EXCLUDED_UNITS_TYPES = [2];   // Manual — MTL dunnage. Used ONLY by the untagged-SKU warning.

    /**
     * ── Shrink guard thresholds ─────────────────────────────────────────────
     * Ported from MTL, but the row threshold is NOT MTL's number and must not be
     * "corrected" to match it. MTL uses 20 because it carries ~452 rows in prod
     * and ~200 in sandbox. ARCH carries 14. Copying 20 would leave the guard
     * permanently disarmed — it would never once arm, and the port would be
     * decorative.
     *
     * 5 arms the guard as soon as the cached summary is large enough for a
     * collapse to be unambiguous at ARCH's current size, and scales harmlessly
     * upward because growth never trips it.
     *
     * ⚠️ RECALIBRATE when the real import lands. At 500 rows a floor of 5 is far
     * too permissive to mean anything on its own; the RATIO carries the
     * protection from then on.
     */
    const SHRINK_GUARD_MIN_ROWS = 5;
    /**
     * Trip when the incoming set is under half the cached set. Same value and
     * same reasoning as MTL: every truncation actually observed there was far
     * below half (prod 27/452 = 0.06), and erring high is deliberate — a false
     * trip costs stale rows plus a loud log line, a missed catch costs the user
     * their data. A false trip is recoverable in one step: run once with
     * custscript_ts_arch_force_full_rebuild checked.
     */
    const SHRINK_GUARD_MAX_RATIO = 0.5;

    /* ══ THE CHAIN: how this builder gets run at all ═════════════════════════════
     *
     * Added 2026-08-26, replacing the hourly scheduled deployment. Read this
     * before changing anything in this block, and before "simplifying" any of it.
     *
     * ── What happened, twice ────────────────────────────────────────────────────
     * The deployment was SCHEDULED hourly. NetSuite silently stopped firing the
     * recurrence. Measured: dead 2026-08-21 11:45 to 2026-08-25 13:32, so the
     * screen served fixtures for three and a half days while the client was being
     * asked to test it. A manual Save & Execute restored the data and the
     * recurrence STILL did not resume: the next run never came, and 23 hours later
     * the cache was CACHE_MISS again. Both times the deployment record cheerfully
     * read `status=SCHEDULED` throughout. Cause never established, and it cannot
     * be established remotely, because `startdate`, `enddate`, `starttime` and
     * `recurrence` are all NOT_EXPOSED to SuiteQL.
     *
     * The important part is not the fault, it is that NOTHING INSIDE NETSUITE CAN
     * REPORT IT. The deployment's notify-on-error only fires when the script RUNS
     * and errors, and a script that is not running cannot report its own absence.
     *
     * ── Why this shape, and not a schedule ──────────────────────────────────────
     * IND and MTL are both NOTSCHEDULED and have never had this outage, because
     * they do not depend on NetSuite's scheduler: each one's summarize resubmits
     * itself to its own deployment, so the script IS the scheduler. Once started,
     * the chain is self-perpetuating. ARCH had none of that machinery, so the
     * recurrence was its only heartbeat, and a single silent NetSuite fault took
     * the screen down completely.
     *
     * So ARCH now runs the same way: NOTSCHEDULED, one deployment, summarize
     * resubmits itself. The IND trap warning ("never enable the trader-cache MR's
     * scheduled deployment") is about adding a SECOND DEPLOYMENT, which forks an
     * unstoppable chain. It is not about self-rescheduling, and the three
     * mechanisms behind it were already verified absent here on 2026-08-18.
     *
     * ── Why a pacing gate is mandatory, not a tuning knob ───────────────────────
     * `task.submit` cannot be delayed. There is no interval, no "run in one hour".
     * A chain therefore cycles as fast as NetSuite will queue it, roughly every
     * 20 to 60 seconds. Without a gate this builder would run a full SuiteQL
     * rebuild plus the lot-cost engine thousands of times a day instead of 24.
     *
     * The gate makes the overwhelming majority of cycles cost one cache read: if
     * the last real run started less than REBUILD_INTERVAL_MS ago, getInputData
     * returns nothing and the cycle is a no-op that only reschedules.
     *
     * ── MEASURED CYCLE RATE, 2026-08-27, and it decides the logging ─────────────
     * 394 cycles in 1,068 seconds on the first live run of the chain. That is ONE
     * CYCLE EVERY 2.7 SECONDS, roughly 1,330 an hour and 32,000 a day. The first
     * version of this comment guessed 20 to 60 seconds and was wrong by more than
     * an order of magnitude, so do not re-derive this from intuition.
     *
     * At that rate a single log line on the paced path costs ~32,000 lines a day.
     * The first deploy carried three of them and produced ~96,000 a day, which is
     * IND's known no-op spin problem in a new place. So THE PACED PATH IS NOW
     * ENTIRELY SILENT: no line in getInputData, none in summarize, none on the
     * reschedule.
     *
     * That is not just tidiness. `scriptnote` is measurably unreliable at volume:
     * GROUP BY, aggregates and LIKE with a date range all silently return empty
     * rather than erroring. A chatty paced path therefore degrades the exact tool
     * used to diagnose this screen, and it did so during the verification of this
     * very change.
     *
     * What is left is sufficient for every failure mode. Real rebuilds emit four
     * AUDIT lines, roughly 24 times a day, so a dead chain looks like silence in
     * the channel people read. A gate stuck open floods AUDIT instead, which is
     * equally visible. A failed reschedule is an ERROR. And chain death is caught
     * from outside by cachecheck.mjs, which is the only place it can be caught.
     *
     * ⚠️ Do not add a heartbeat line here to "make the chain visible". It is 32,000
     * lines a day to learn something the cache's own age already tells you.
     *
     * ── WHAT THE CHAIN COSTS THE OTHER TWO SCREENS, MEASURED ────────────────────
     * ~1,330 Map/Reduce submissions an hour is real contention, and it is NOT free.
     * Measured against IND's own note volume in matched 45-minute windows on
     * 2026-08-27, the day this went live at 05:54 PT:
     *
     *     pre-chain    2,374  2,407  2,450  2,380      mean 2,403
     *     chain live   2,237  2,266  2,268  2,262  2,206  2,314   mean 2,259
     *
     * A sustained 6.0% drop, and every post-chain window sits below every
     * pre-chain window, so it is not noise. IND's refresh goes from roughly 75s to
     * 80s, which is operationally invisible, but it is a permanent tax on two
     * screens that are live in production.
     *
     * Stated so nobody has to rediscover it, and so the trade-off is explicit: the
     * lever is REBUILD_INTERVAL_MS, but raising it does NOT help. The no-op cycles
     * are the cost, not the rebuilds, and they continue at the same rate whatever
     * the interval. The only real reductions are fewer chain members or no chain.
     * ⚠️ Re-measure before ARCH ever goes to production, where it would contend
     * with IND and MTL serving actual traders rather than a sandbox.
     *
     * ── Two things that are load-bearing and look optional ──────────────────────
     * 1. The pacing stamp is written at the TOP of getInputData, before any query,
     *    NOT derived from META at the end. If it came from META, every failure
     *    path would become a hot loop: run fails, META keeps its old timestamp,
     *    gate says stale, identical rebuild 20 seconds later, fails again, with
     *    notifyemails attached. See the long note in cacheKeys_arch.js.
     * 2. The reschedule is in a `finally`. It must fire on every path out of
     *    summarize including the early returns and the catch, because a path that
     *    misses it does not degrade the chain, it ENDS the chain.
     *
     * ── Operating it ────────────────────────────────────────────────────────────
     * 🔴 NEVER PRESS SAVE & EXECUTE ON A CHAIN THAT IS ALREADY RUNNING. Check
     * first, every time, with one command:
     *
     *     node cachecheck.mjs
     *
     *   FRESH   -> the chain is alive. DO NOTHING. Pressing the button here is the
     *              single easiest way to damage this design.
     *   STALE
     *   MISSING -> the chain is dead. Press it once.
     *
     * WHY, because it is not obvious and it is not recoverable. Every run resubmits
     * itself exactly once, so ONE trigger sustains exactly ONE circulating member.
     * A Save & Execute on a live chain adds a SECOND member that also resubmits
     * forever. Nothing merges them and nothing times them out. Press it three times
     * over a month and four members circulate permanently, each multiplying the job
     * churn this builder costs the account.
     *
     * And it is invisible. Rebuild frequency stays hourly no matter how many
     * members there are, because they share one pacing key and whichever member
     * crosses the interval first stamps it. The paced path logs nothing. There is no
     * queryable table of Map/Reduce job instances either: `scheduledscriptinstance`
     * accepts COUNT(*) but exposes zero columns to REST SuiteQL, so this cannot be
     * checked from a script. The ONLY way to see the member count is the Map/Reduce
     * status page in the UI, counting concurrent or queued instances of this script.
     * Prevention is therefore the whole defence, which is why the check above is
     * stated as a hard precondition rather than advice.
     *
     * START IT: the deployment is NOTSCHEDULED, so in any environment where the
     * chain is not already circulating it has to be started by hand exactly once,
     * subject to the same check. Uploading this file is NOT starting it: a new
     * upload is picked up by the next cycle, but if there is no next cycle the
     * upload changes nothing.
     *
     * READING THE LOG: real rebuilds are the AUDIT lines, four per rebuild and
     * roughly 24 rebuilds a day. Paced cycles log NOTHING, so the log shows one
     * cluster an hour and nothing in between. A dead chain looks like silence, and
     * a chain spinning without pacing looks like an AUDIT flood. Both are obvious
     * at a glance, which was the point of taking the DEBUG lines out.
     *
     * VERIFYING THE CHAIN IS ALIVE: `node cachecheck.mjs`, not the log. The cache's
     * age is the liveness signal, and it is the only one that works from outside.
     *
     * THERE IS NO "REBUILD RIGHT NOW". Nothing bypasses the pacing gate, including
     * the force checkbox, and that is deliberate; see paceShouldSkip. The most you
     * can do is wait for the gate, which is at most one interval away. To force a
     * rebuild that is ALLOWED TO SHRINK the cache, tick
     * custscript_ts_arch_force_full_rebuild, wait for the next gate opening, untick
     * it. Ticking it does not make the rebuild happen sooner.
     *
     * ── Its one interaction with paused work ────────────────────────────────────
     * Cache-miss auto-recovery (on standby since 2026-05-05) would want the gate to
     * open early when SUMMARY is missing, so an evicted summary recovers in one
     * cycle instead of within the interval. That is deliberately NOT built here.
     * Anyone unpausing it should know the hazard: a bypass keyed on "SUMMARY is
     * missing" becomes a hot loop the moment SUMMARY is persistently unwritable,
     * so it needs its own shorter floor rather than a plain bypass.
     *
     * ── The residual risk, stated plainly ───────────────────────────────────────
     * A chain has exactly one failure mode and it is total: if the resubmit never
     * happens, nothing inside NetSuite restarts it. That is strictly better than
     * the schedule only because a chain that dies leaves a loud ERROR line, where
     * a recurrence that dies leaves nothing at all. It is not self-healing.
     *
     * The watchdog is therefore EXTERNAL and must stay external: `cachecheck.mjs`
     * beside `sql.mjs`, which checks the AGE of the cache rather than its absence,
     * because at a 12h TTL absence is the late symptom. Recovery from chain death
     * is one Save & Execute on deployment 1, ONLY after that check reports STALE or
     * MISSING; see the precondition under Operating it, because pressing it on a
     * live chain is the other failure mode and it is permanent. Do not "fix" this by
     * adding a schedule back as a net either; that multiplies the chain instead of
     * protecting it, and cacheKeys_arch.js explains why.
     *
     * Note the asymmetry that makes prevention the whole defence: chain DEATH is
     * loud, external, and recoverable in one action, while chain MULTIPLICATION is
     * silent, invisible to every automated check available here, and cannot be
     * undone except by stopping the script and starting one member again.
     */
    const REBUILD_INTERVAL_MS = 60 * 60 * 1000;   // 1h, matching the old schedule

    /**
     * TTL for the pacing key, DERIVED from the interval and not configured
     * anywhere. The derivation is the safety mechanism, not a style choice.
     *
     * The gate only works while the key OUTLIVES the interval. If the key expires
     * first, the gate reads an absent key, fails open exactly as designed, and
     * every single cycle becomes a full rebuild: ~1,330 an hour, four AUDIT lines
     * each, the cache rewritten continuously.
     *
     * This used to be `TTL_PACE = 7200` in cacheKeys_arch.js, with a comment
     * saying "2h against a 1h rebuild interval". That put the two halves of one
     * invariant in two different files with nothing connecting them, so raising
     * REBUILD_INTERVAL_MS above 2h here would have silently triggered the failure
     * above from a one-line edit that looked local and safe. Deriving it means the
     * interval cannot outrun its own TTL.
     *
     * 2x is the margin. Expiry remains the safe direction regardless, costing one
     * extra rebuild rather than a skipped one, so the multiplier is not delicate.
     */
    const PACE_TTL_SECONDS = Math.ceil((REBUILD_INTERVAL_MS / 1000) * 2);

    /**
     * The force-full checkbox on the deployment, read tolerantly.
     *
     * SHRINK GUARD ONLY. It does not affect the pacing gate; see the long note in
     * paceShouldSkip for why that bypass was removed rather than kept.
     *
     * Lives at module scope rather than as the inline IIFE it started as, because
     * the gate briefly needed the same answer. It stays here now that the gate does
     * not: one tolerant parameter read is easier to reason about than one, and a
     * second copy appearing later is how they drift apart.
     *
     * Tolerant on purpose. A CHECKBOX parameter should come back as a boolean, but
     * this is the ONLY escape from a guard that otherwise blocks a legitimate
     * shrink forever. If NetSuite ever hands back 'T' or 'true', a strict === true
     * would fail silently and leave the cache wedged with no way out.
     */
    const forceFullRequested = () => {
        try {
            const v = runtime.getCurrentScript()
                .getParameter({ name: 'custscript_ts_arch_force_full_rebuild' });
            return v === true || v === 'T' || v === 'true';
        } catch (e) { return false; }
    };

    /**
     * Has a real rebuild started recently enough that this cycle should be a
     * no-op?
     *
     * Fails OPEN on every uncertainty: an unreadable key, an absent key, a
     * non-numeric value, or a stamp in the future all return false. Wrong in
     * this direction costs one extra rebuild. Wrong in the other direction would
     * be a cache that stops refreshing because of a cache error, and a stamp in
     * the future could suppress every rebuild until the key expires.
     *
     * Returns a bare boolean. It used to return the age alongside it, for a log
     * line on the paced path that has since been deleted; see the measured cycle
     * rate under THE CHAIN. Nothing reads an age any more, so nothing carries one.
     */
    const paceShouldSkip = () => {
        /*
         * ⚠️ THE FORCE BOX DELIBERATELY DOES **NOT** BYPASS THIS GATE, and the
         * first version of this function got that wrong. Do not re-add it.
         *
         * The argument for bypassing was that Save & Execute used to guarantee a
         * real rebuild and would no longer: press it a minute after a rebuild and
         * the run correctly does nothing, which looks like a broken script. That
         * argument does not survive contact with the numbers.
         *
         *   - The box exists to escape a wedged shrink guard, and that works
         *     without a bypass. Tick it, the next gate opening within the interval
         *     runs forced, untick. The escape is delayed, never blocked.
         *   - A cycle is 2.7 seconds, measured. With the bypass, a box left ticked
         *     is roughly 32,000 forced rebuilds a day with the shrink guard
         *     disarmed throughout, against 24 a day under the old schedule. That is
         *     a ~1,300x amplification of a footgun this file already warns about
         *     twice.
         *   - The confusion the bypass was meant to prevent only occurs when the
         *     cache is already fresh, which is exactly when nobody needed to press
         *     the button. If the chain has genuinely been dead longer than the
         *     interval, the gate is open and Save & Execute rebuilds normally.
         *
         * So the bypass removed a nonexistent problem and multiplied a real one.
         * If Save & Execute appears to do nothing, that is the correct answer;
         * confirm with `node cachecheck.mjs`, which reports the cache's real age.
         */
        try {
            const raw = CacheClient.getCache().get({ key: CacheKeys.PACE_LAST_START });
            if (!raw) return false;
            const last = Number(raw);
            if (!isFinite(last) || last <= 0) return false;
            const ageMs = Date.now() - last;
            if (ageMs < 0) return false;
            return ageMs < REBUILD_INTERVAL_MS;
        } catch (e) {
            // Rare path, and it stays DEBUG rather than going quiet like the paced
            // path did. If the cache were persistently unreadable this would fire
            // every cycle, but that is not the noise that would matter: the gate
            // fails open, so every cycle would also run a full rebuild and emit
            // four AUDIT lines. The AUDIT flood is the alarm; this is the reason.
            log.debug('ARCH cache pacing',
                'Pacing key unreadable, running the rebuild: ' + e.message);
            return false;
        }
    };

    /**
     * Claim this cycle as a real run. Called once, at the top of getInputData,
     * immediately after the gate lets the work through and BEFORE any query.
     *
     * The position is the point. A failed query, a payload over the ceiling or an
     * exception in summarize all leave the next cycle paced anyway, so nothing
     * downstream can turn a persistent failure into a hot loop.
     */
    const stampPaceStart = () => {
        try {
            CacheClient.getCache().put({
                key:   CacheKeys.PACE_LAST_START,
                value: String(Date.now()),
                // Derived from REBUILD_INTERVAL_MS. Never take this from the key
                // module; see PACE_TTL_SECONDS for what that cost.
                ttl:   PACE_TTL_SECONDS,
            });
        } catch (e) {
            // ERROR is right by the level-by-cause rule: this is rare and
            // abnormal, and its consequence is a gate that never closes, i.e. a
            // full rebuild every 2.7 seconds (measured) against a deployment that
            // emails on error. If this line ever appears, the spin is the emergency.
            log.error('ARCH cache pacing — COULD NOT STAMP, REBUILDS ARE NO LONGER PACED',
                e.name + ': ' + e.message);
        }
    };

    /**
     * Resubmit this deployment. The only thing keeping the builder alive.
     *
     * NO `params` are passed, deliberately, and this differs from IND, which
     * passes three. Omitted params fall back to the deployment record, which keeps
     * `custscript_ts_arch_force_full_rebuild` working as a live escape hatch: tick
     * it and the next cycle picks it up within the interval. Passing an explicit
     * `false` the way IND does would make the checkbox permanently inert while the
     * chain runs, and it is the only way out of a wedged shrink guard.
     *
     * ⚠️ The flip side, and it is worse than it was under the schedule: leaving
     * that box ticked disarms the guard AND the pacing gate on every cycle, and a
     * cycle is 2.7 seconds, not an hour. It is a one-run switch. Tick, wait one
     * cycle, untick.
     */
    const rescheduleSelf = () => {
        try {
            const mrTask = task.create({
                taskType:     task.TaskType.MAP_REDUCE,
                scriptId:     runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
            });
            // NOT LOGGED, at any level. This fires on every cycle, so even at DEBUG
            // it measured ~32,000 lines a day on its own. A successful reschedule is
            // also the least interesting thing that can happen here: it is the
            // default, and its absence is what matters, which the catch below and
            // cachecheck.mjs both cover.
            //
            // The return value is discarded rather than logged. taskId=null was
            // always expected anyway and never meant failure: it means the task is
            // deferred until the current execution finishes, which is exactly what a
            // self-resubmit is supposed to do.
            mrTask.submit();
        } catch (e) {
            // The one place ERROR is unarguable. This fires at most once, because
            // after it there are no more cycles to fire it: the builder has
            // stopped and only an external check or a human will notice.
            log.error('ARCH cache chain — SELF-RESCHEDULE FAILED, THE BUILDER HAS STOPPED',
                e.name + ': ' + e.message + '. Nothing inside NetSuite will restart it. ' +
                'Run cachecheck.mjs FIRST: this line proves THIS member stopped, not that ' +
                'the chain is empty, and if another member is still circulating then a ' +
                'Save & Execute forks it permanently. Only if the check reports STALE or ' +
                'MISSING, Save & Execute once on deployment 1.');
        }
    };

    /**
     * Fallback display names for the locations holding ARCH stock, verified
     * 2026-08-17.
     *
     * `BUILTIN.DF(inl.location)` normally supplies the name and this is never
     * reached — which is exactly why it has to exist. An earlier edit deleted
     * this constant while leaving the reference below in place, and nothing
     * failed: `||` short-circuits on a truthy name, so the undefined identifier
     * was never evaluated. The first location with a blank display name would
     * have thrown ReferenceError and killed the whole cache build.
     */
    const KNOWN_LOCATIONS = { 122: 'CWP Prevost', 135: 'USL', 136: 'CAL' };

    /**
     * NetSuite unit name → the canonical code the React app uses.
     * Mirrors `normalizeUnit` in react-app/src/lib/archUom.ts and the copy in
     * archSplitQueue.js. Three copies is two too many; if a fourth is ever
     * needed, promote it to shared/ instead of pasting it again.
     */
    const normalizeUnit = (unitName) => {
        const s = String(unitName || '').trim().toLowerCase();
        if (!s) return 'BF';
        if (s === 'bf' || s.indexOf('board') !== -1) return 'BF';
        if (s === 'sqft' || s === 'sf' || (s.indexOf('square') !== -1 && s.indexOf('feet') !== -1)) return 'SQFT';
        if (s === 'lf' || (s.indexOf('linear') !== -1 && s.indexOf('feet') !== -1)) return 'LF';
        if (s === 'unit' || s === 'units' || s === 'ea' || s === 'each') return 'UNIT';
        return 'BF';
    };

    /**
     * Byte length of a UTF-8 string.
     *
     * `String.length` counts UTF-16 code units, but N/cache's 500 KB ceiling is
     * measured in BYTES. Every ARCH string today is ASCII so the two coincide —
     * which is why the difference is easy to miss — but one accented species
     * name makes `.length` under-count, and a guard that under-counts lets
     * through exactly the payload it exists to stop.
     */
    const utf8Bytes = (str) => {
        let bytes = 0;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) bytes += 1;
            else if (c < 0x800) bytes += 2;
            else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }  // surrogate pair
            else bytes += 3;
        }
        return bytes;
    };

    /**
     * Lots dropped for want of a usable conversion rate, carried from
     * getInputData to summarize so the count reaches META.
     *
     * ⚠️ Module state across Map/Reduce STAGES is not guaranteed — NetSuite may
     * run them in different executions. This is therefore best-effort: when it
     * survives, the browser learns that stock is missing; when it does not, the
     * execution log still has the detail. It is never the only record.
     */
    let skippedLots = [];

    const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
    };

    /* ══ PO from the lot number ════════════════════════════════════════════════
     *
     * The lot-number prefix is the PURCHASE ORDER number. Marc-Antoine, asked
     * directly on 2026-08-19 whether it was the container or the PO:
     *
     *   « le 316027 c'est le numéro du PO qu'on utilise dans notre nomenclature
     *     du bundle. »
     *
     * So `316027-1` … `316027-14` are fourteen bundles from PO 316027, and the
     * prefix is the only per-lot PO attribution available: SuiteQL exposes just
     * id, inventorynumber, item and lastmodifieddate on `inventorynumber`, and
     * there is no PO link on the record.
     *
     * ⚠️ THIS IS A NAMING CONVENTION, NOT A NETSUITE REFERENCE, and it cannot be
     * corroborated here. Measured 2026-08-19: no PO in the account carries 316027
     * or 315970 in `tranid` or `otherrefnum`, and hardwood touches only 177
     * Inventory Adjustments, 4 PO lines (our own seed) and 3 SO lines — Julie's
     * data was imported, never received against a PO. So these are MGSL's own PO
     * numbers, and nothing in NetSuite can confirm or contradict one. A mistyped
     * lot number therefore yields a wrong PO rather than an error, which is why
     * silence is the failure mode: no match means no PO, never a guess.
     *
     * 🔴 DO NOT REUSE THIS FOR containerNo. The same answer said a container can
     * span more than one PO, so the mapping is not invertible in either
     * direction — a prefix can never yield a container number. The original plan
     * on this screen was to derive `containerNo` from exactly this prefix, and it
     * would have shipped a column headed Container that held PO numbers.
     *
     * ── Why the pattern is this strict ──────────────────────────────────────
     * Run against all 103 real hardwood lot numbers: 92 yield one of 12 POs, all
     * in the 31xxxx range, and 11 correctly yield nothing —
     *
     *   `1` `2` `3` `4`      manual lots with no PO in the name
     *   `no name A-2`        does not start with digits
     *   `49839.0` `49846.0`  our own seeder wrote a lot INTERNAL ID into the name
     *   `414983`             6 digits but NO bundle suffix, and outside the range
     *                        every other lot uses. Ambiguous, so it is declined:
     *                        requiring the separator is what declines it.
     *
     * The separator is required for that last case specifically. `^(\d{5,})$`
     * would also accept `414983` and invent a 13th PO out of the one lot that
     * does not follow the convention.
     *
     * Note it would also read `00000-442` as PO `00000` — but softwood lots like
     * that never reach this function, because getInputData is scoped to the
     * hardwood segment. Do not lift this helper out of that scope.
     */
    const PO_FROM_LOT_RE = /^(\d{5,})-/;
    const poFromLotNo = (lotNo) => {
        const m = PO_FROM_LOT_RE.exec(String(lotNo || '').trim());
        return m ? m[1] : '';
    };

    /* ══ Lot costing ═══════════════════════════════════════════════════════════
     *
     * WHICH BOOK. The Primary book, which on a CAD subsidiary IS the CAD cost.
     * Asked twice and answered twice, independently: Marc-Antoine — « Je crois
     * que nous utiliserons le CAD (comme IND) » — and Lucas on the 2026-08-17
     * call — « on va faire comme industriel et on va tout présenter en CAD ».
     *
     * MTL's sandbox-6 / production-2 divergence therefore does NOT apply here:
     * that is MTL reaching for a USD SECONDARY book, and the secondary book id
     * is what differs per environment. The PRIMARY book is 1 everywhere, so this
     * default is environment-independent — the one safe thing to hard-default.
     * (Verified in sandbox 2026-08-19: only two books exist, 1 Primary and 2
     * "USD Accounting Book". There is no book 6, so MTL's sandbox default is
     * already stale — flagged, not touched, since MTL is out of scope here.)
     *
     * ⚠️ STILL OPEN, and it is NOT this parameter's job to fix: the trader can
     * raise a SO in USD, and a CAD cost against a USD price makes the margin
     * compare two currencies. Lucas described the exposure himself — « notre
     * inventaire est en CAD, mais on vend aussi en US quand même beaucoup ». The
     * question to settle is the CONVERSION RULE and the rate, not the currency.
     * If the answer ever becomes "cost in USD", flip the parameter — no code
     * change — but the margin still needs the rule.
     */
    const ARCH_COST_BOOK_DEFAULT = 1;

    let _costBookCached = null;
    const costBookId = () => {
        if (_costBookCached === null) {
            let v = null;
            try {
                v = runtime.getCurrentScript().getParameter({ name: 'custscript_ts_arch_cost_book' });
            } catch (e) { /* parameter absent — fall through to the default */ }
            _costBookCached = parseInt(v, 10) || ARCH_COST_BOOK_DEFAULT;
        }
        return _costBookCached;
    };

    /**
     * Per-lot cost at one location, **PER BASE UNIT**, in the costing book's
     * currency. Keys are lot internal ids; a lot with no posting history at the
     * location comes back null and must stay null.
     *
     * Wrapped deliberately. MCGI_LIB_LotCost is an untracked runtime dependency
     * that runs its own SuiteQL, and a costing failure must degrade to "no cost
     * shown" — an em dash — rather than lose the row's quantities, which are the
     * reason the screen exists.
     */
    const loadLotCosts = (lotList, locationId) => {
        if (!lotList || !lotList.length) return {};
        try {
            const ids = [];
            for (let i = 0; i < lotList.length; i++) {
                if (lotList[i].lotId) ids.push(lotList[i].lotId);
            }
            if (!ids.length) return {};
            return LotCostLib.getLotCostsAtLocation(ids, locationId, { book: costBookId() }) || {};
        } catch (e) {
            log.error('ARCH cache lot costing failed',
                'location=' + locationId + ' book=' + costBookId() + ' — the row keeps its ' +
                'quantities and reports no cost. ' + e.message);
            return {};
        }
    };

    /**
     * Every ARCH lot with a balance, one row per lot × location.
     *
     * Scoped by the ITEM's units type — see ARCH_UNITS_TYPES above for why it
     * cannot be scoped by location, and why this filter is a placeholder.
     */
    const LOT_SQL =
        'SELECT ' +
        '  i.id                    AS itemid, ' +
        '  i.itemid                AS itemcode, ' +
        // `description`, NOT `displayname`. Philippe reported the grid showing SKUs
        // (PUR44KD) instead of names on 2026-08-27, and the cause was reading the
        // wrong column: displayname is NULL on all six ARCH items, so the merge below
        // fell through to itemcode. `i.description` holds exactly what he asked for,
        // measured the same day:
        //
        //   PUR44KD        "Purpleheart 4/4 KD\r\n"   <- his literal example
        //   SAP54FCKD      "Sapele 5/4 FC KD\r\n"
        //   WAL44OVLOUTKD  "Walnut 4/4 Ovals OUT KD\r\n"
        //   WALVENFCAA     "Walnut Veneer FC AA"
        //
        // ⚠️ Three of the six end in a real CRLF, so the merge point MUST .trim().
        // Oracle's TRIM does not strip it and it renders as a blank second line.
        '  i.description           AS description, ' +
        '  BUILTIN.DF(i.cseg1)     AS species, ' +
        '  BUILTIN.DF(i.csegitem_category) AS category, ' +
        '  BUILTIN.DF(i.csegseg_thickness) AS thickness, ' +
        '  u.unitname              AS unitname, ' +
        '  u.conversionrate        AS rate, ' +
        '  inl.location            AS locationid, ' +
        '  BUILTIN.DF(inl.location) AS locationname, ' +
        '  inv.id                  AS lotid, ' +
        '  inv.inventorynumber     AS lotno, ' +
        '  inl.quantityonhand      AS storedqty ' +
        'FROM inventorynumberlocation inl ' +
        'JOIN inventorynumber inv ON inv.id = inl.inventorynumber ' +
        'JOIN item i              ON i.id  = inv.item ' +
        'LEFT JOIN unitstypeuom u ON u.internalid = i.stockunit ' +
        'WHERE i.cseg_subsidiary_loc = ? ' +
        '  AND inl.quantityonhand <> 0';

    /**
     * Items that LOOK like hardwood by the old heuristic but are NOT tagged.
     *
     * The segment is a deliberate act — somebody has to set it — so an untagged
     * hardwood SKU is invisible to this cache, silently. That is the price of
     * moving off the units-type heuristic, which caught things by accident.
     *
     * This query is the early warning: anything carrying an ARCH-shaped units
     * type without the Hardwood segment is probably a SKU someone forgot to tag.
     * It costs one query per run and turns a silent omission into a log line.
     */
    const UNTAGGED_SQL =
        'SELECT i.id, i.itemid FROM item i ' +
        'WHERE i.unitstype IS NOT NULL ' +
        '  AND i.unitstype NOT IN (' + EXCLUDED_UNITS_TYPES.map(() => '?').join(',') + ') ' +
        '  AND (i.cseg_subsidiary_loc IS NULL OR i.cseg_subsidiary_loc <> ?)';

    /**
     * ═══ THE FOUR SOURCED BUCKETS ════════════════════════════════════════════
     * Open sales and purchase order lines for hardwood items, with any lot
     * assignment attached.
     *
     * ⚠️ THIS QUERY FANS OUT. A line with three lot assignments returns three
     * rows carrying the SAME line quantity. Summing `qty` across them triples
     * the figure. The line-level values are therefore taken ONCE per
     * (transaction, line) in JS and the assignment rows are used only to
     * attribute quantity to lots. This is the same cartesian trap that
     * `archSplitQueue` documents.
     *
     * ⚠️ This sentence used to end "and the reason `ia.transactionline` joins on
     * the line NUMBER rather than `tl.id`". That is BACKWARDS and it is corrected
     * here on 2026-09-02. The join below uses `tl.id`, deliberately, and the note
     * beside it records why: 35% of lines have id <> linesequencenumber, and
     * joining on the sequence mis-attributes exactly those. Joining on the number
     * is the bug, not the fix.
     *
     * ⚠️ EVERY QUANTITY IS IN THE ITEM'S BASE UNIT, exactly like
     * `quantityonhand`. A 500 BF sales-order line stores -0.5, a 1 500 BF
     * purchase-order line stores 1.5. They go through the same `/ rate`
     * conversion as On Hand. Veneer and Ovals are rate 1 and pass through, which
     * is what makes the Lumber case easy to miss.
     *
     * ⚠️ SALES ORDER QUANTITIES ARE NEGATIVE. NetSuite signs outbound lines, so
     * everything from a SalesOrd is taken through Math.abs.
     *
     * The `cseg_subsidiary_loc` filter does double duty: it scopes to hardwood
     * AND removes the CA-E and TAXQC lines that user events add to every order,
     * because those items carry no segment. Without it they would be counted as
     * stock.
     */
    const BUCKET_SQL =
        'SELECT ' +
        '  tl.item                AS itemid, ' +
        '  tl.location            AS locationid, ' +
        '  t.type                 AS trantype, ' +
        '  t.id                   AS tranid, ' +
        // The line's OWN id, which is what inventoryassignment points at —
        // see the join below. Also the dedupe key, so a line that fans out
        // over several lots is still counted once in the row totals.
        '  tl.id                  AS lineno, ' +
        '  tl.quantity            AS qty, ' +
        '  tl.quantityshiprecv    AS shiprecv, ' +
        '  tl.quantitybilled      AS billed, ' +
        '  inv.inventorynumber    AS lotno, ' +
        '  ia.quantity            AS assignedqty ' +
        'FROM transactionline tl ' +
        'JOIN transaction t ON t.id = tl.transaction ' +
        'JOIN item i        ON i.id = tl.item ' +
        'LEFT JOIN inventoryassignment ia ' +
        // 🔴 tl.id, NOT tl.linesequencenumber. Measured in sandbox across every
        // transaction from 2026-08-01 to 08-19: joining assignments on
        // linesequencenumber leaves 8 with no matching line, joining on tl.id
        // leaves 0. inventoryassignment.transactionline references tl.id.
        //
        // This hid for weeks because the two columns are usually EQUAL — both
        // are 1 on a single-line order, which is every order we seeded. Over
        // the same window 2,073 of 6,003 lines (35%) have id <> seq, and those
        // are the ones that mis-attribute. Row totals were never affected
        // (they come from the LINES, deduped); per-LOT reserve/onOrder and the
        // `unattributed` figure were.
        '       ON ia.transaction = t.id AND ia.transactionline = tl.id ' +
        'LEFT JOIN inventorynumber inv ON inv.id = ia.inventorynumber ' +
        'WHERE i.cseg_subsidiary_loc = ? ' +
        "  AND tl.mainline = 'F' " +
        "  AND tl.isclosed = 'F' " +
        "  AND t.type IN ('SalesOrd', 'PurchOrd')";


    /**
     * Reads BUCKET_SQL and folds it into per-(item, location) figures.
     *
     * Returns, keyed `itemId__locationId`:
     *   { reserve, outbound, onOrder, inTransit,       // row totals, BASE units
     *     lots: { lotNo: {reserve, outbound, onOrder, inTransit} },
     *     unattributed: { ...same four... } }          // no lot assignment
     *
     * `unattributed` is not a rounding detail — it is the honest half of the
     * answer. A sales order line with no inventory detail contributes real,
     * correct quantity to the ROW but cannot be attributed to any LOT, so the
     * drill-down would show nothing while the column shows a number. Recording
     * it means that gap is visible instead of looking like a bug.
     */
    const loadBuckets = () => {
        const byPair = {};
        const seenLines = {};
        const blank = () => ({ reserve: 0, outbound: 0, onOrder: 0, inTransit: 0 });

        let rows;
        try {
            rows = query.runSuiteQL({
                query: BUCKET_SQL,
                params: [HARDWOOD_SEGMENT],
            }).asMappedResults();
        } catch (e) {
            // Buckets missing is bad; On Hand being wrong is worse. Return empty
            // and let the run continue with the buckets at zero, loudly.
            log.error('ARCH cache buckets — COULD NOT LOAD, all four buckets will read 0',
                e.name + ': ' + e.message);
            return {};
        }

        rows.forEach((r) => {
            const key = String(r.itemid) + '__' + String(r.locationid);
            if (!byPair[key]) byPair[key] = { totals: blank(), lots: {}, unattributed: blank() };
            const bucket = byPair[key];

            const isSale = String(r.trantype) === 'SalesOrd';
            // SO quantities are signed negative by NetSuite.
            const ordered  = Math.abs(num(r.qty));
            const moved    = Math.abs(num(r.shiprecv));   // shipped (SO) / received (PO)
            const billed   = Math.abs(num(r.billed));
            const open     = Math.max(0, ordered - moved);

            // ── Line-level figures ONCE per line, never per assignment row ──
            const lineKey = String(r.tranid) + '#' + String(r.lineno);
            if (!seenLines[lineKey]) {
                seenLines[lineKey] = true;
                if (isSale) {
                    // Sold and still in the building.
                    bucket.totals.reserve  += open;
                    // Already gone out the door.
                    bucket.totals.outbound += moved;
                } else {
                    // Ordered from a supplier, not yet received.
                    bucket.totals.onOrder += open;
                    // Billed but not received — it is on the water.
                    bucket.totals.inTransit += Math.max(0, Math.min(billed, ordered) - moved);
                }
            }

            // ── Lot attribution, only where an assignment exists ──
            const assigned = Math.abs(num(r.assignedqty));
            if (r.lotno && assigned > 0) {
                if (!bucket.lots[r.lotno]) bucket.lots[r.lotno] = blank();
                if (isSale) bucket.lots[r.lotno].reserve += assigned;
                else        bucket.lots[r.lotno].onOrder += assigned;
            }
        });

        // Whatever the row carries but no lot claims.
        Object.keys(byPair).forEach((k) => {
            const b = byPair[k];
            ['reserve', 'outbound', 'onOrder', 'inTransit'].forEach((f) => {
                const claimed = Object.keys(b.lots).reduce((s, lot) => s + b.lots[lot][f], 0);
                b.unattributed[f] = Math.max(0, b.totals[f] - claimed);
            });
        });

        return byPair;
    };

    /**
     * ═══ ACTIVE INVENTORY HOLDS ══════════════════════════════════════════════
     * Marc-Antoine creates hold records to pull stock off the trader screen
     * before posting an Inventory Adjustment. So a hold means "this stock is
     * being corrected, do not sell it", and until 2026-08-18 ARCH ignored them
     * entirely — a held hardwood lot read as fully sellable.
     *
     * ── Why the WHOLE lot is withheld, not a quantity ───────────────────────
     * The record's quantity field is `custrecord_mgsl_hold_packs`, "Packs on
     * Hold". ARCH has no packs. MTL subtracts packs from a pack count, which is
     * meaningful there and meaningless here — subtracting a pack figure from a
     * board-foot balance would produce a confidently wrong number of exactly the
     * kind this module has spent the day removing.
     *
     * So an active hold on an ARCH lot withholds that lot ENTIRELY. Three
     * reasons, in order of weight:
     *   1. It matches ARCH's own existing rule. A bundle with any reserve is
     *      already locked in full, because the real remainder is unknown until
     *      the warehouse physically splits it. A hold is the same shape of
     *      uncertainty.
     *   2. It matches the stated intent — pull the stock off the screen. Being
     *      conservative errs toward not selling something twice.
     *   3. The packs figure is carried through as `heldPacks` untouched, so if
     *      the client later says a hardwood hold is partial, it can be
     *      reinterpreted without re-reading NetSuite.
     *
     * ⚠️ OPEN WITH THE CLIENT: is a hardwood hold all-or-nothing per lot, or a
     * quantity in the item's own unit? This implements the first. Sandbox has
     * zero hold records, so nothing here is verified against real data.
     *
     * ── Why status is filtered in JS ────────────────────────────────────────
     * Same reason MTL does it: the SDF customlist's value internal id is not
     * known at deploy time, and the volume is tiny — Marc described creating
     * these "quelques fois par semaine".
     */
    const loadActiveHolds = () => {
        const byKey = {};
        let holdCount = 0;
        try {
            search.create({
                type: 'customrecord_mgsl_inventory_hold',
                columns: [
                    search.createColumn({ name: 'custrecord_mgsl_hold_item' }),
                    search.createColumn({ name: 'custrecord_mgsl_hold_location' }),
                    search.createColumn({ name: 'custrecord_mgsl_hold_lot' }),
                    search.createColumn({ name: 'custrecord_mgsl_hold_packs' }),
                    search.createColumn({ name: 'custrecord_mgsl_hold_status' }),
                ],
            }).run().each((r) => {
                if (r.getText({ name: 'custrecord_mgsl_hold_status' }) !== 'Active') return true;
                const itemId  = r.getValue({ name: 'custrecord_mgsl_hold_item' });
                const locId   = r.getValue({ name: 'custrecord_mgsl_hold_location' });
                const lotName = r.getText({ name: 'custrecord_mgsl_hold_lot' });
                // NOTE: packs may legitimately be 0 or blank for an ARCH hold,
                // since the field does not describe hardwood. MTL rejects those
                // rows; we must NOT, or a hold entered without a pack figure
                // would be silently ignored and the stock would stay sellable.
                const packs = parseFloat(r.getValue({ name: 'custrecord_mgsl_hold_packs' })) || 0;
                if (!itemId || !locId || !lotName) return true;
                const key = String(itemId) + '__' + String(locId);
                if (!byKey[key]) byKey[key] = {};
                byKey[key][lotName] = (byKey[key][lotName] || 0) + packs;
                holdCount++;
                return true;
            });
            log.audit('ARCH cache holds',
                holdCount + ' active hold(s) across ' + Object.keys(byKey).length +
                ' item x location key(s)');
        } catch (e) {
            // Fail LOUD and fail CLOSED is not an option here — throwing would
            // kill the whole cache build over a subsidiary feature. But an empty
            // holds map means held stock becomes sellable, so this must never
            // pass silently.
            log.error('ARCH cache holds — COULD NOT LOAD, held stock may appear sellable',
                e.name + ': ' + e.message);
        }
        return byKey;
    };

    // ── getInputData ────────────────────────────────────────────────────────
    // Returns one entry per item × location, each carrying its lots. FULL only.
    //
    // Also the gate for the chain. Because the builder now reschedules itself, most
    // invocations of this function are supposed to do nothing at all, and returning
    // {} here is what makes a cycle cheap. See THE CHAIN above.
    const getInputData = () => {
        try {
            // ── The pacing gate ─────────────────────────────────────────────
            // FIRST statement in the function, before the queries, before the
            // holds and buckets loads, before anything that costs governance. A
            // gate placed after any of that work would still pay for the cycle it
            // is meant to skip.
            //
            // ⚠️ SILENT ON PURPOSE, and this is measured, not a preference. See the
            // log-volume paragraph under THE CHAIN: at the real cycle rate a single
            // line here costs about 32,000 log lines a day.
            if (paceShouldSkip()) return {};

            // Claim the cycle BEFORE the work, not after it. Everything downstream
            // may now fail freely without costing us the interval.
            stampPaceStart();

            const rows = query.runSuiteQL({
                query: LOT_SQL,
                params: [HARDWOOD_SEGMENT],
            }).asMappedResults();

            // Early warning for SKUs nobody tagged — see UNTAGGED_SQL.
            try {
                const untagged = query.runSuiteQL({
                    query: UNTAGGED_SQL,
                    params: EXCLUDED_UNITS_TYPES.concat([HARDWOOD_SEGMENT]),
                }).asMappedResults();
                if (untagged.length) {
                    /*
                     * ⚠️ AUDIT, not ERROR, and the level is chosen by CAUSE rather
                     * than by importance.
                     *
                     * This was `log.error` and it fired on EVERY hourly run,
                     * because the condition it reports is a standing state of the
                     * account, not an event: MGSL have 2,294 untagged items and
                     * that will not change until Julie's tagging process exists
                     * (0.1). Measured 2026-08-25: it logged at ERROR on all 95
                     * non-debug notes since 2026-08-20, one per run, every run.
                     *
                     * That is the exact rule this project already learned the hard
                     * way: a per-run condition at error level is hundreds of lines
                     * a day and possibly emails, and it trains everyone to ignore
                     * the error channel, which is where a real failed rebuild
                     * appears. The information is worth keeping; the severity was
                     * a lie about frequency.
                     *
                     * If this should ever shout again, gate it on the count
                     * CHANGING between runs, not on the count being non-zero.
                     */
                    log.audit('ARCH cache — POSSIBLE UNTAGGED HARDWOOD, invisible to this screen',
                        untagged.length + ' item(s) carry an ARCH-shaped units type but no Hardwood ' +
                        'segment, so their stock does NOT appear: ' +
                        untagged.map((r) => r.itemid).join(', ') +
                        '. Set cseg_subsidiary_loc = Hardwood on them, or confirm they are not hardwood.');
                }
            } catch (e) {
                log.audit('ARCH cache', 'Untagged-hardwood check failed (non-fatal): ' + e.message);
            }

            const holds = loadActiveHolds();
            const buckets = loadBuckets();

            const byPair = {};
            const rateless = [];
            rows.forEach((r) => {
                // A MISSING CONVERSION RATE IS AN ERROR, NOT A DEFAULT OF 1.
                //
                // `unitstypeuom` is LEFT JOINed, so a broken or absent unit
                // record yields null. Defaulting that to 1 is silently wrong by
                // three orders of magnitude for Lumber, whose real rate is
                // 0.001 — the exact failure that once created a 680 BF
                // remainder as 0.68 BF. Veneer and Ovals are genuinely rate 1,
                // so a wrong default is invisible on two categories out of
                // three, which is what makes it dangerous.
                //
                // Skip the row and name it. A lot missing from the screen with
                // an error in the log is recoverable; a lot present and wrong
                // by 1000x is not.
                const rate = num(r.rate);
                if (!(rate > 0)) {
                    rateless.push(r.itemcode + ' / lot ' + (r.lotno || r.lotid));
                    return;
                }
                const key = String(r.itemid) + '__' + String(r.locationid);
                if (!byPair[key]) {
                    byPair[key] = {
                        itemId:       String(r.itemid),
                        itemCode:     r.itemcode || '',
                        // .trim() is load-bearing, not tidiness: three of the six ARCH
                        // descriptions end in a real CRLF. Trim BEFORE the fallback so a
                        // description that is only whitespace still falls through to the
                        // SKU rather than rendering as a blank cell.
                        description:  String(r.description || '').trim() || r.itemcode || '',
                        species:      r.species || '',
                        category:     r.category || '',
                        // Blank on veneer, and correctly so — veneer has no
                        // thickness. Blank is not the same as missing here.
                        thickness:    r.thickness || '',
                        unit:         normalizeUnit(r.unitname),
                        rate:         rate,
                        locationId:   String(r.locationid),
                        locationName: r.locationname || KNOWN_LOCATIONS[r.locationid] || '',
                        holds:        holds[key] || {},
                        buckets:      buckets[key] || null,
                        lots:         [],
                    };
                }
                byPair[key].lots.push({
                    lotId:     String(r.lotid),
                    lotNo:     r.lotno || '',
                    storedQty: num(r.storedqty),
                });
            });

            const out = {};
            Object.keys(byPair).forEach((k) => { out[k] = JSON.stringify(byPair[k]); });

            // Name every SKU the placeholder filter matched. When the units-type
            // heuristic starts pulling in something that is not hardwood, this
            // line is what makes it obvious instead of silently wrong.
            const matched = [...new Set(rows.map((r) => r.itemcode))].sort();
            log.audit('ARCH cache getInputData',
                Object.keys(out).length + ' item x location pair(s) from ' + rows.length +
                ' lot row(s). SKUs matched (' + matched.length + '): ' + matched.join(', '));
            if (rateless.length) {
                // Also stashed on the module so summarize can put it in META.
                // An error in the execution log is invisible to the trader
                // looking at the screen; every other gap here (empty buckets,
                // absent costing) is declared in meta, and so is this one.
                skippedLots = rateless.slice();

                // ── Level by CAUSE, same rule as the shrink guard ────────────
                // An item with a broken unit setup does not heal itself, so this
                // is a PERSISTENT condition. At error level, on an hourly
                // schedule with notifyowner set, it would fire an error and an
                // email every hour forever — the documented failure mode in this
                // codebase, and the exact bug that was just fixed in summarize.
                // It was missed here while fixing it there.
                //
                // First occurrence is an error because it is news. Once META
                // already records a non-zero skippedLotCount it is a known
                // condition, so it drops to audit. The count stays in META
                // either way, so nothing is hidden from the screen.
                let alreadyReported = false;
                try {
                    const metaRaw = CacheClient.getCache().get({ key: CacheKeys.META });
                    if (metaRaw) alreadyReported = (JSON.parse(metaRaw).skippedLotCount || 0) > 0;
                } catch (e) { /* unknown — treat as news and log loudly */ }

                const logSkipped = alreadyReported ? log.audit : log.error;
                logSkipped('ARCH cache getInputData — lots SKIPPED, no conversion rate',
                    rateless.length + ' lot row(s) had no usable stock-unit conversion rate and were ' +
                    'excluded rather than counted at rate 1: ' + rateless.join(', ') +
                    (alreadyReported ? ' (STILL SKIPPING — first occurrence already logged at error level.)' : ''));
            }

            /*
             * A REAL run that found nothing has to say so HERE, not in summarize.
             *
             * Since the chain started, summarize sees zero output in two completely
             * different situations: a paced cycle that deliberately did no work, and
             * a real cycle that did the work and genuinely found no hardwood stock.
             * By the time summarize runs, those are indistinguishable, because both
             * arrive as an empty output iterator. This function is the only place
             * that knows which one happened, so this is the only place the second
             * one can be reported.
             *
             * Without this line the second case would be silent, and silence is
             * exactly what made the four-day outage a four-day outage.
             *
             * AUDIT, not ERROR, by the same rule that moved the untagged-hardwood
             * notice off ERROR in 00db2fb: the causes are all persistent states of
             * the account (the segment tag removed, stock genuinely at zero), not
             * events, so at error level this becomes an hourly email forever. The
             * cache is left alone either way, `lastUpdated` keeps reporting the real
             * age of what is being served, and cachecheck.mjs catches the resulting
             * staleness from outside.
             */
            if (!Object.keys(out).length) {
                log.audit('ARCH cache getInputData — REAL RUN FOUND NO HARDWOOD STOCK',
                    'The queries ran and produced zero item x location pairs, so there is ' +
                    'nothing to cache. The existing cached summary is being KEPT rather than ' +
                    'blanked, so the screen will serve older rows and label them stale. ' +
                    'Check that the Hardwood segment is still set on the items before ' +
                    'assuming the stock is really gone.');
            }
            return out;
        } catch (e) {
            log.error('ARCH cache getInputData failed', e.message);
            /*
             * The rethrow is what populates `context.inputSummary.error`, which is
             * how summarize tells a broken cycle from a paced one. Keep it.
             *
             * ⚠️ THE ONE UNVERIFIED ASSUMPTION IN THE CHAIN. NetSuite documents
             * that summarize still runs when getInputData throws, and summarize is
             * where the reschedule lives, so chain survival depends on that being
             * true. It has never been observed here: zero getInputData failures in
             * the log since the script went live on 2026-08-18, so there is no
             * evidence either way from this account.
             *
             * If it turns out to be false, the symptom is precise and recognisable:
             * an "ARCH cache getInputData failed" line with no summarize line after
             * it in the same run, and then no further runs at all. Recovery is one
             * Save & Execute. Do not "fix" it by calling rescheduleSelf() here as
             * well; if summarize also runs, that doubles the chain permanently, and
             * a growing chain is worse than a stopped one.
             *
             * `cachecheck.mjs` is the net either way, which is why it is external.
             */
            throw e;
        }
    };

    // ── map ─────────────────────────────────────────────────────────────────
    // Pass-through, matching IND/MTL. Kept as a stage rather than folded away
    // so a future delta mode has somewhere to filter.
    const map = (context) => {
        context.write({ key: context.key, value: context.value });
    };

    // ── reduce ──────────────────────────────────────────────────────────────
    // One summary row + one detail payload per pair.
    const reduce = (context) => {
        try {
            const pair = JSON.parse(context.values[0]);
            const myCache = CacheClient.getCache();

            // Stored → display. The ONLY place this conversion happens.
            const heldLots = pair.holds || {};
            const bk       = pair.buckets;
            const rate     = pair.rate;
            const perLot   = (bk && bk.lots) || {};

            const lots = pair.lots.map((l) => {
                const isHeld = Object.prototype.hasOwnProperty.call(heldLots, l.lotNo);
                const lb     = perLot[l.lotNo] || null;
                return {
                    lotNo:         l.lotNo,
                    lotId:         l.lotId,
                    // Derived from the lot-number prefix, which IS the PO by
                    // Marc-Antoine's own bundle nomenclature — see poFromLotNo.
                    po:            poFromLotNo(l.lotNo),
                    // ⛔ NO SOURCE, and there cannot be one from the lot number.
                    // A container can span several POs (2026-08-19), so the
                    // prefix that gives `po` above can never give a container.
                    // Real container tracking needs the packing-list lot →
                    // container capture and has no other route. Container is
                    // also mostly a decking/IPE concern, which this screen is
                    // not for, so this is a display nicety and not Phase 1.
                    containerNo:   '',
                    onHand:        l.storedQty / rate,
                    // Per-lot figures exist ONLY where the order line carries an
                    // inventory-detail assignment. A line without one contributes
                    // to the ROW but to no lot — see `unattributed` below.
                    reserve:       lb ? lb.reserve   / rate : 0,
                    outbound:      lb ? lb.outbound  / rate : 0,
                    onOrder:       lb ? lb.onOrder   / rate : 0,
                    inTransit:     lb ? lb.inTransit / rate : 0,
                    // ⛔ readyToBuild has NO SOURCE. Marc-Antoine described it as a
                    // header status a trader ticks by hand, and no such field
                    // exists on the transaction — every candidate custbody name
                    // was probed on 2026-08-18 and none resolved. It stays 0 until
                    // the field is created; guessing a proxy would invent data.
                    readyToBuild:  0,
                    // The lot is still REPORTED — it physically exists and On Hand
                    // must keep showing it. It is only withheld from `available`.
                    onHold:        isHeld,
                    heldPacks:     isHeld ? heldLots[l.lotNo] : 0,
                    tallyImageUrl: null,
                };
            });

            /* ── Row cost: quantity-weighted across the lots that HAVE one ─────
             *
             * 🔴 THE UNIT DIRECTION IS THE OPPOSITE OF EVERY QUANTITY ABOVE.
             *
             * `rate` is base-units-per-display-unit (BF = 0.001, i.e. NetSuite
             * stores lumber in MBF). So:
             *
             *     quantity:  base → display  is  qty  / rate      (÷ 0.001 = ×1000)
             *     cost:      base → display  is  cost * rate      (× 0.001 = ÷1000)
             *
             * getLotCostsAtLocation derives its rate as `line GL / line qty`, and
             * that line qty is in BASE units — which is why MTL calls the same
             * return value `mbfPrice`. Divide here instead of multiplying and
             * purpleheart reports $4,320,000/BF instead of $4.32/BF.
             *
             * This asymmetry has already caused three separate bugs on this
             * screen, every time because two of the three ARCH unit types are
             * rate 1 and hide the error completely. Only Lumber exposes it.
             *
             * A lot with no posting history has NO cost, which is not a cost of
             * zero: it is excluded from both sides of the average, and a row
             * where no lot is costed stays null so the grid shows an em dash.
             * Weighting by on-hand means an empty lot cannot drag the average.
             */
            const lotCosts = loadLotCosts(pair.lots, pair.locationId);
            let costQty = 0;
            let costVal = 0;
            lots.forEach((l) => {
                const perBase = lotCosts[l.lotId];
                if (perBase === null || perBase === undefined || !isFinite(perBase)) return;
                if (!(l.onHand > 0)) return;
                costQty += l.onHand;
                costVal += l.onHand * (perBase * rate);
            });
            const avgCostPerUnit = costQty > 0 ? Math.round((costVal / costQty) * 100) / 100 : null;

            const onHand = lots.reduce((s, l) => s + l.onHand, 0);
            // Quantity sitting on a held lot, in display units. Reported, not
            // hidden — ARCH declares what it withholds rather than quietly
            // shrinking a number the way MTL does.
            const held = lots.reduce((s, l) => s + (l.onHold ? l.onHand : 0), 0);

            // Row-level buckets, converted from BASE units the same way On Hand
            // is. Taken from the order lines rather than summed from the lots —
            // see the note on `reserve` below.
            const bt        = (bk && bk.totals) || { reserve: 0, outbound: 0, onOrder: 0, inTransit: 0 };
            const bu        = (bk && bk.unattributed) || { reserve: 0, outbound: 0, onOrder: 0, inTransit: 0 };
            const reserve   = bt.reserve   / rate;
            const outbound  = bt.outbound  / rate;
            const onOrder   = bt.onOrder   / rate;
            const inTransit = bt.inTransit / rate;
            const unattributed = {
                reserve:   bu.reserve   / rate,
                outbound:  bu.outbound  / rate,
                onOrder:   bu.onOrder   / rate,
                inTransit: bu.inTransit / rate,
            };

            const summaryRow = {
                internalId:   pair.itemId,
                itemCode:     pair.itemCode,
                description:  pair.description,
                locationId:   pair.locationId,
                locationName: pair.locationName,
                species:      pair.species,
                category:     pair.category,
                // ── The other three, and why they are empty ──────────────────
                // Verified 2026-08-18 against the item record, correcting an
                // earlier comment here that claimed category was unpopulated —
                // it is, with Lumber / Veneer / Ovals on all six SKUs, and this
                // module was throwing it away.
                //
                // ⚠️ REWRITTEN 2026-08-19. The previous comment here claimed no
                // thickness segment existed and that grade was an item field.
                // BOTH were wrong — checked by selecting a whole item row and
                // reading its 81 columns instead of assuming:
                //
                //   cseg1                → species    ✅ populated
                //   csegitem_category    → category   ✅ populated
                //   csegseg_thickness    → thickness  ✅ POPULATED, and it was
                //        being discarded here exactly like category was until
                //        2026-08-18. Verified against all six SKUs: PUR44KD 4/4,
                //        SAP54FCKD 5/4, ZEB44KD 4/4, ZEB84KD 8/4, ovals 4/4 —
                //        every one matching the digits in its own item code.
                //        WALVENFCAA is blank, which is correct: veneer has no
                //        thickness.
                //   cseggrade            → ⚠️ CORRECTED 2026-08-28. This comment
                //        used to say cseggrade "does NOT exist on `item` at all,
                //        it is a column on TRANSACTIONLINE". THAT WAS WRONG and it
                //        did real damage: it was quoted to the client as the reason
                //        Grade could never be sourced, and it was copied into two
                //        front-end files on 2026-08-27 before anyone checked it.
                //
                //        Measured: `SELECT COUNT(*) FROM item WHERE cseggrade IS
                //        NOT NULL` returns 539. It exists on the item and MGSL
                //        already populate it on 539 items. It is simply NULL on
                //        the six ARCH SKUs.
                //
                //        So this is MISSING DATA, not an impossible field, and
                //        Marc-Antoine's « on va le mettre sur l'item » (2026-08-19)
                //        is achievable with the field that already exists. The
                //        moment ARCH items carry a grade, select it here and the
                //        column he asked to keep becomes real.
                //   grain                → no column anywhere on the item. The
                //        item table DOES expose custitem_* fields (12 of them),
                //        so this is absence, not invisibility.
                thickness:    pair.thickness || '',
                grade:        '',   // not sourced YET. cseggrade exists on item (539
                                    // populated) but is null on the ARCH SKUs. See above.
                grain:        '',   // no such segment — needs a source decision
                // Row-level `containerNo`/`containers` were REMOVED 2026-08-19.
                // They existed to feed a Container column and filter on the main
                // grid; that column is gone, because the value it was going to
                // carry is a PO. Container survives at LOT level only, where the
                // detail tables render it, and it is empty there until the
                // packing-list capture exists.
                //
                // 🔴 THIS REMOVAL IS WHY DEPLOY ORDER IS MANDATORY — bundle.js
                // before this file. See the header. Removing a field from this
                // object breaks any older front end that still reads it, and in
                // production that breaks every page load, because the Suitelet
                // inlines the bundle rather than letting the browser cache it.
                lots:         lots,
                unit:         pair.unit,
                onHand:       onHand,
                // Row totals come from the ORDER LINES, not from summing the
                // lots. A line without an inventory-detail assignment is real
                // and must count here even though no lot can claim it — summing
                // lots would silently under-report exactly those orders.
                reserve:      reserve,
                outbound:     outbound,
                onOrder:      onOrder,
                inTransit:    inTransit,
                // ⛔ STILL NO SOURCE. There is no Ready to Build field on the
                // transaction — every candidate custbody name was probed on
                // 2026-08-18 and none exists. Marc-Antoine describes it as a
                // header status ticked by hand, so the field has to be created
                // before this can be anything but 0. Do not substitute a proxy.
                readyToBuild: 0,
                // Quantity the row carries that NO lot claims, because the order
                // line has no inventory detail. Published so a drill-down showing
                // fewer lots than the column suggests reads as a known gap rather
                // than a bug. Real ARCH orders assign lots; ours seeded none.
                unattributed: unattributed,
                // Held stock is subtracted here and ONLY here. onHand still
                // reports it, because the wood is on the floor; it simply is not
                // sellable while a correction is pending.
                held:         held,
                heldLotCount: lots.filter((l) => l.onHold).length,
                // The full formula, floored. readyToBuild stays a literal 0 so it
                // is obvious it contributes nothing yet.
                available:    Math.max(0, onHand + onOrder + inTransit
                                          - reserve - 0 /*readyToBuild*/ - outbound
                                          - held),
                // NULL, NOT ZERO, when nothing could be costed. 0 renders as
                // "$0.00/BF" — indistinguishable from stock that genuinely cost
                // nothing. null is self-describing: the formatter shows an em
                // dash, so an absent cost can never be read as a measured one.
                avgCostPerUnit: avgCostPerUnit,
                detailKey:    pair.itemId + '-' + pair.locationId,
            };

            myCache.put({
                key:   CacheKeys.detailKey(pair.itemId, pair.locationId),
                value: JSON.stringify({ onHand: lots }),
                ttl:   CacheKeys.TTL_DETAIL,
            });

            // Keyed per PAIR, not a shared 'summary' literal. Writing every row
            // under one key relies on the output stage preserving duplicate
            // keys — it does here, but it is not a documented guarantee, and a
            // change in that behaviour would collapse the whole grid to one row
            // with nothing failing loudly.
            context.write({ key: pair.itemId + '__' + pair.locationId, value: JSON.stringify(summaryRow) });
        } catch (e) {
            log.error('ARCH cache reduce failed for ' + context.key, e.message);
        }
    };

    /**
     * Split rows into chunks that each FIT, verified in bytes.
     *
     * 🔴 Deliberately NOT a port of MTL's version, which carries two defects:
     *
     *   1. It compares `fullJson.length` — UTF-16 code units — against a ceiling
     *      expressed in BYTES. Every accented character in a French location or
     *      item name counts as one there and two on the wire, so it under-counts
     *      exactly where MGSL's data has accents. ARCH already has `utf8Bytes`
     *      and uses it everywhere else; this is one of the few places ARCH is
     *      ahead of MTL and it should stay that way.
     *   2. It derives `rowsPerChunk` from an AVERAGE
     *      (`rows.length / ceil(json.length / chunkSize)`) and never measures a
     *      chunk it actually built. Rows are not uniform — a lot-heavy pair
     *      carries far more than a single-lot one — so one fat row can push a
     *      chunk over the ceiling and `put` then fails or truncates. That is the
     *      shape of the chunking bug this file's own comments warn about.
     *
     * So: measure each row once, accumulate greedily against the real budget
     * including JSON framing, then VERIFY each finished chunk with a genuine
     * `utf8Bytes` before it is written.
     *
     * Returns null when a SINGLE row cannot fit on its own, because that is
     * genuinely unchunkable and the caller must refuse loudly rather than write
     * something that will throw.
     */
    const chunkRowsByBytes = (allRows, maxBytes) => {
        // `[` + `]`, plus one `,` per row after the first.
        const FRAME = 2;
        const sizes = allRows.map((r) => utf8Bytes(JSON.stringify(r)));

        const chunks = [];
        let cur = [];
        let curBytes = FRAME;

        for (let i = 0; i < allRows.length; i++) {
            const add = sizes[i] + (cur.length ? 1 : 0);
            if (cur.length && curBytes + add > maxBytes) {
                chunks.push(cur);
                cur = [];
                curBytes = FRAME;
            }
            // A row that cannot fit even alone is unchunkable. Bail rather than
            // emit a chunk we know is oversized.
            if (FRAME + sizes[i] > maxBytes) return null;
            cur.push(allRows[i]);
            curBytes += add;
        }
        if (cur.length) chunks.push(cur);

        // Verify what was actually built, not what the arithmetic predicted.
        for (let c = 0; c < chunks.length; c++) {
            if (utf8Bytes(JSON.stringify(chunks[c])) > maxBytes) return null;
        }
        return chunks;
    };

    // ── summarize ───────────────────────────────────────────────────────────
    const summarize = (context) => {
        try {
            const myCache = CacheClient.getCache();
            const rows = [];

            context.output.iterator().each((key, value) => {
                try { rows.push(JSON.parse(value)); }
                catch (e) { log.error('ARCH cache summarize parse', e.message); }
                return true;
            });

            /*
             * Stage errors, counted for one reason: to tell a run that produced
             * nothing ON PURPOSE from a run that produced nothing BECAUSE IT BROKE.
             * The action is the same for both (leave the cache alone) but the log
             * level must not be, or a broken rebuild reads like a quiet one.
             *
             * Wrapped, because these summaries are the one part of the context that
             * may be incomplete when getInputData itself threw, and a summarize that
             * dies here would skip the reschedule and end the chain.
             */
            let mapErrorCount = 0, reduceErrorCount = 0;
            try {
                context.mapSummary.errors.iterator().each((key, err) => {
                    mapErrorCount++;
                    log.error('ARCH cache map error, key ' + key, err);
                    return true;
                });
                context.reduceSummary.errors.iterator().each((key, err) => {
                    reduceErrorCount++;
                    log.error('ARCH cache reduce error, key ' + key, err);
                    return true;
                });
            } catch (e) {
                log.error('ARCH cache summarize',
                    'Could not read the stage error summaries: ' + e.message);
            }
            const runFailed = !!(context.inputSummary && context.inputSummary.error) ||
                mapErrorCount > 0 || reduceErrorCount > 0;

            /*
             * ══ ZERO OUTPUT: NEVER WRITE AN EMPTY PAYLOAD OVER A LIVE CACHE ══════
             *
             * This has to sit ABOVE the shrink guard, and the ordering is not
             * cosmetic. The guard would happily catch zero rows (existingCount 13 is
             * over the floor of 5, and 0 is under half of 13) and would preserve the
             * cache correctly. What it would ALSO do is stamp `shrinkGuard: true`
             * into META. On the next real truncation, `alreadyKnown` would then be
             * true, and the guard would log that truncation at AUDIT instead of
             * ERROR, because it would look like a repeat of a condition already
             * reported. Routing paced no-ops through the guard would therefore
             * disable the guard's alerting within one cycle of going live, while
             * leaving the guard itself apparently intact. The screen would also
             * permanently report the cache as refusing to update.
             *
             * Zero output now has three causes and all three want the same action:
             *   1. a paced cycle, which is the common case and is not news;
             *   2. a real run that found no stock, already reported loudly in
             *      getInputData, which is the only place that can tell;
             *   3. a run that errored to nothing, which is news every time.
             *
             * Nothing is written, not even a TTL refresh, because at a 1h interval
             * against a 12h TTL there is no expiry pressure to relieve. The shrink
             * guard's own path does rewrite SUMMARY to keep TTLs in step, but it
             * runs at most once an hour on a persistent fault, where this path runs
             * on most cycles.
             */
            if (rows.length === 0) {
                if (runFailed) {
                    log.error('ARCH cache summarize — ZERO OUTPUT AFTER ERRORS, cache PRESERVED',
                        'inputError=' + !!(context.inputSummary && context.inputSummary.error) +
                        ' mapErrors=' + mapErrorCount +
                        ' reduceErrors=' + reduceErrorCount +
                        '. The cached summary was NOT replaced with an empty one. ' +
                        (context.inputSummary && context.inputSummary.error
                            ? 'inputSummary.error: ' + context.inputSummary.error
                            : ''));
                }
                // No `else`, deliberately. Zero output with no stage errors is the
                // paced path, which is the overwhelming majority of cycles, so a
                // line here costs ~32,000 a day on its own. Silence is the correct
                // report for a no-op.
                return;
            }

            // Stable order so the grid does not reshuffle between rebuilds.
            rows.sort((a, b) => (a.itemCode + a.locationName).localeCompare(b.itemCode + b.locationName));

            // Counted here, not in reduce: reduce runs per pair and module state
            // does not reliably survive between stages (see `skippedLots`).
            const costedRows = rows.filter((r) =>
                r.avgCostPerUnit !== null && r.avgCostPerUnit !== undefined).length;

            const payload = JSON.stringify(rows);
            const payloadBytes = utf8Bytes(payload);

            /*
             * The 500 KB ceiling is per VALUE, not per cache.
             *
             * ✅ Chunking implemented 2026-08-25. This used to LOG AND RETURN,
             * which meant an oversized payload wrote nothing at all: the cache
             * would expire at TTL and the screen would fall to fixtures. In other
             * words the failure mode of arriving at real volume was the same
             * four-day silent outage we had just spent an afternoon on, triggered
             * by the very upload we are waiting for.
             *
             * `chunkPlan` is null only when a SINGLE row exceeds the ceiling on
             * its own, which no amount of chunking fixes.
             */
            const overCeiling = payloadBytes > CacheKeys.MAX_CACHE_VALUE_BYTES;
            const chunkPlan = overCeiling
                ? chunkRowsByBytes(rows, CacheKeys.MAX_CACHE_VALUE_BYTES)
                : null;

            if (overCeiling && !chunkPlan) {
                log.error('ARCH cache summarize',
                    'Summary payload is ' + payloadBytes + ' bytes, over the ' +
                    CacheKeys.MAX_CACHE_VALUE_BYTES + ' byte ceiling, and at least one SINGLE row ' +
                    'exceeds the ceiling by itself, so chunking cannot help. The cached summary is ' +
                    'kept rather than replaced with nothing. This means one item+location pair ' +
                    'carries an implausible amount of data — check its lot count before assuming ' +
                    'the ceiling is the problem.');
                return;
            }

            // ── Shrink guard ──────────────────────────────────────────────
            // Everything above this point will happily write a 1-row payload over
            // a good 14-row one, and it looks entirely legitimate.
            //
            // The exposure is real, not theoretical. `reduce` catches per-pair
            // errors, logs them and CONTINUES, so a partial failure produces a
            // partial payload rather than a failed run. Zero rows writes an empty
            // array and blanks the screen outright.
            //
            // MTL learned this in production: 452 rows became 27, leaving a
            // US-only location dropdown, spotted by Julie at 13:14 ET on
            // 2026-07-31. MTL's own trigger — a stale N/cache read confusing
            // DELTA for FULL — cannot happen here, because ARCH has no delta
            // mode. But MTL keys its guard on the OUTCOME rather than the mode
            // precisely so it ALSO catches an errored run with little or no
            // output, and that is the hole ARCH has.
            //
            // Scheduling this hourly (2026-08-18) widened it: truncation used to
            // require someone pressing a button and watching. Now an unattended
            // run can blank the cache overnight and nobody sees it for hours.
            //
            // ARCH REFUSES rather than merging. MTL merges because a delta's
            // partial set is still real data worth keeping; every ARCH payload is
            // complete by construction, so the cached one is strictly better than
            // a truncated new one. Stale-but-complete beats silently-truncated.
            //
            // The tolerant parameter read moved out to forceFullRequested() at
            // module scope on 2026-08-26, because the pacing gate needs the same
            // answer and two copies of a tolerant read is how they drift apart.
            // Note the widened meaning: the box now bypasses the pacing gate too,
            // so it forces a rebuild to HAPPEN as well as allowing it to shrink.
            const forceFull = forceFullRequested();

            let existingCount = 0;
            let existingRaw   = null;
            let priorMeta     = null;
            try {
                existingRaw = myCache.get({ key: CacheKeys.SUMMARY });
                if (existingRaw) {
                    const existing = JSON.parse(existingRaw);
                    if (Array.isArray(existing)) {
                        existingCount = existing.length;
                    } else if (existing && existing.chunked && existing.chunkCount) {
                        // Chunking is not implemented in THIS writer, but the reader
                        // supports it and MTL's port is on the list. Without this
                        // branch the guard would meet a chunked summary, fail the
                        // Array.isArray test, leave existingCount at 0 and silently
                        // disarm itself — the protection would vanish exactly when
                        // the data got big enough to need it.
                        for (let ci = 0; ci < existing.chunkCount; ci++) {
                            const chunkRaw = myCache.get({ key: CacheKeys.buildSummaryDataKey(ci) });
                            if (chunkRaw) {
                                const chunkRows = JSON.parse(chunkRaw);
                                if (Array.isArray(chunkRows)) existingCount += chunkRows.length;
                            }
                        }
                    }
                }
                const metaRaw = myCache.get({ key: CacheKeys.META });
                if (metaRaw) priorMeta = JSON.parse(metaRaw);
            } catch (e) {
                // A cache we cannot read is a cache we cannot protect. Proceed:
                // writing a fresh complete payload beats leaving an unparseable one.
                log.error('ARCH cache summarize',
                    'Could not read the existing summary to compare against, so the shrink ' +
                    'guard is disarmed for this run: ' + e.message);
            }

            const shrinkGuardTripped =
                !forceFull &&
                existingCount >= SHRINK_GUARD_MIN_ROWS &&
                rows.length < existingCount * SHRINK_GUARD_MAX_RATIO;

            if (shrinkGuardTripped) {
                // ── Level by CAUSE, not by importance ────────────────────
                // The deployment carries notifyemails, and this runs on every real
                // cycle, which the pacing gate holds to roughly hourly.
                // A persistent cause — a broken query, a permanently smaller data
                // set — would otherwise fire an error and an email every hour,
                // forever. That is the documented failure mode in this codebase:
                // a per-run condition logged at error level becomes hundreds of
                // lines a day and a mailbox full of the same message.
                //
                // So: the FIRST trip is an error, because it is news. A trip that
                // repeats a condition already recorded in META is an audit line,
                // because it is not. The state is still fully visible — shrinkGuard
                // stays true in META and the screen can surface it.
                const alreadyKnown = !!(priorMeta && priorMeta.shrinkGuard === true);
                const logTrip = alreadyKnown ? log.audit : log.error;
                logTrip('ARCH cache summarize — SHRINK GUARD',
                    'REFUSING to replace ' + existingCount + ' cached row(s) with ' + rows.length +
                    ' (ratio=' + (rows.length / existingCount).toFixed(3) +
                    ', trips below ' + SHRINK_GUARD_MAX_RATIO + '). The cached summary is kept.' +
                    (alreadyKnown ? ' STILL TRIPPING — first occurrence was already logged at error level.' : '') +
                    ' If the shrink is REAL, run once with ' +
                    'custscript_ts_arch_force_full_rebuild checked.');

                // ── Keep the data we are protecting ALIVE ─────────────────────
                // Refusing to replace SUMMARY also means not refreshing its TTL,
                // while META below IS refreshed. Left alone, a guard that trips
                // repeatedly would let SUMMARY expire after TTL_SUMMARY while META
                // kept claiming N rows — the service would return CACHE_MISS from
                // one endpoint and "available: true, rowCount: 14" from the other.
                // Re-writing the same bytes costs nothing and keeps them in step.
                if (existingRaw) {
                    myCache.put({
                        key:   CacheKeys.SUMMARY,
                        value: existingRaw,
                        ttl:   CacheKeys.TTL_SUMMARY,
                    });
                }
                // META is still refreshed, so the screen can report that the cache
                // did NOT update and why, rather than silently serving older rows
                // as though they were fresh.
                // `lastUpdated` must keep pointing at when the SUMMARY last actually
                // changed — carried over from the previous META. Stamping it with
                // "now" would tell the browser the cache had just refreshed when it
                // had in fact refused to, which is worse than the truncation this
                // guard is preventing: stale data that reports itself as fresh.
                // `lastAttempt` records that a run happened and was rejected.
                const priorUpdated = priorMeta ? (priorMeta.lastUpdated || null) : null;

                myCache.put({
                    key: CacheKeys.META,
                    value: JSON.stringify({
                        cacheVersion:       1,
                        lastUpdated:        priorUpdated,
                        lastAttempt:        new Date().toISOString(),
                        rowCount:           existingCount,
                        lastRunMode:        'FULL',
                        bucketsBuilt:       ['onHand', 'reserve', 'outbound', 'onOrder', 'inTransit'],
                        bucketsEmpty:       ['readyToBuild'],
                        skippedLotCount:    skippedLots.length,
                        // Carried from the prior run, exactly like lastUpdated: the
                        // rows being SERVED are the previous ones, so this run's
                        // costed count would describe rows nobody can see.
                        // costBook is config, not row state, so it is current.
                        costBook:           costBookId(),
                        costedRowCount:     priorMeta ? priorMeta.costedRowCount : null,
                        uncostedRowCount:   priorMeta ? priorMeta.uncostedRowCount : null,
                        shrinkGuard:        true,
                        shrinkGuardRefused: rows.length,
                    }),
                    ttl: CacheKeys.TTL_SUMMARY,
                });
                return;
            }

            /*
             * CHUNKS FIRST, POINTER LAST, and the order is load-bearing.
             *
             * The reader treats a missing chunk as a MISS rather than a smaller
             * result (`trader_screen_service_arch.js`), so a pointer written
             * before its chunks would describe data that is not there yet and any
             * request landing in that window would read a miss. Written in this
             * order, SUMMARY keeps pointing at the previous payload until every
             * chunk is in place.
             *
             * ⚠️ Chunks from a PREVIOUS, larger run are deliberately not deleted.
             * They expire on their own TTL and nothing reads past `chunkCount`, so
             * removing them buys nothing and a failed delete midway would be worse
             * than leaving them.
             */
            if (chunkPlan) {
                for (let ci = 0; ci < chunkPlan.length; ci++) {
                    myCache.put({
                        key:   CacheKeys.buildSummaryDataKey(ci),
                        value: JSON.stringify(chunkPlan[ci]),
                        ttl:   CacheKeys.TTL_SUMMARY,
                    });
                }
                myCache.put({
                    key:   CacheKeys.SUMMARY,
                    value: JSON.stringify({ chunked: true, chunkCount: chunkPlan.length }),
                    ttl:   CacheKeys.TTL_SUMMARY,
                });
                log.audit('ARCH cache summarize — CHUNKED',
                    rows.length + ' row(s), ' + payloadBytes + ' bytes, written as ' +
                    chunkPlan.length + ' chunk(s) against a ' + CacheKeys.MAX_CACHE_VALUE_BYTES +
                    ' byte ceiling. Rows per chunk: ' +
                    chunkPlan.map((c) => c.length).join(', ') + '.');
            } else {
                myCache.put({ key: CacheKeys.SUMMARY, value: payload, ttl: CacheKeys.TTL_SUMMARY });
            }
            myCache.put({
                key: CacheKeys.META,
                value: JSON.stringify({
                    cacheVersion: 1,
                    // On the healthy path these are the same instant; they diverge
                    // only when the shrink guard refuses a run.
                    lastUpdated:  new Date().toISOString(),
                    lastAttempt:  new Date().toISOString(),
                    rowCount:     rows.length,
                    lastRunMode:  'FULL',
                    // Stated in the payload, not just in this file, so the screen
                    // can tell the user which columns are real.
                    bucketsBuilt: ['onHand', 'reserve', 'outbound', 'onOrder', 'inTransit'],
                    // readyToBuild alone. No field exists on the transaction to
                    // source it from — see the note in reduce.
                    bucketsEmpty: ['readyToBuild'],
                    // Non-zero means the On Hand figures on screen are LOW: these
                    // lots exist but could not be converted to display units.
                    skippedLotCount: skippedLots.length,
                    // Costing, declared rather than inferred from the rows. A row
                    // with no cost shows an em dash, which is honest per-row but
                    // does not tell anyone WHY — these two counts do, and they
                    // separate "the library returned nothing" from "no stock".
                    costBook:        costBookId(),
                    costedRowCount:  costedRows,
                    uncostedRowCount: rows.length - costedRows,
                }),
                ttl: CacheKeys.TTL_SUMMARY,
            });

            log.audit('ARCH cache summarize',
                rows.length + ' summary row(s), ' + payloadBytes + ' bytes. readyToBuild not sourced. ' +
                costedRows + '/' + rows.length + ' row(s) costed from book ' + costBookId() + '.' +
                (existingCount ? ' Replaced ' + existingCount + ' cached row(s).' : '') +
                (forceFull ? ' FORCED — shrink guard bypassed.' : ''));
        } catch (e) {
            log.error('ARCH cache summarize failed', e.message);
        } finally {
            /*
             * ⚠️ `finally`, AND IT MUST STAY `finally`.
             *
             * This one call is the entire reason the builder keeps running, now that
             * the deployment is NOTSCHEDULED. summarize has five ways out: the
             * over-ceiling return, the zero-output return, the shrink-guard return,
             * the normal end, and the catch above. A reschedule sitting on the happy
             * path alone would mean any of the other four silently ENDS the chain,
             * and the symptom would be identical to the NetSuite scheduler fault
             * this replaced: a cache that quietly stops updating while every record
             * still looks healthy.
             *
             * Moving this out of `finally` for tidiness, or guarding it with "only
             * reschedule if the run succeeded", reintroduces the original outage.
             * The failure paths are precisely the ones that most need another cycle.
             */
            rescheduleSelf();
        }
    };

    return {
        getInputData: getInputData,
        map:          map,
        reduce:       reduce,
        summarize:    summarize,
    };
});
