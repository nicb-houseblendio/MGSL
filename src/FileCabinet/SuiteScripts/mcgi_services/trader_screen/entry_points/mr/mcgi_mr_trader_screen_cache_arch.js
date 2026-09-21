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
 * ═══ STATUS: SIX BUCKETS, ONE SELF-ACTIVATING ═══════════════════════════════
 * Updated 2026-09-10. `readyToBuild` is wired end to end — `loadBuckets` reads
 * `custbody_arch_ready_to_build` in its own isolated query (never joined into
 * BUCKET_SQL, which five other buckets depend on and cannot afford to fail) —
 * but the field does not exist in the account yet, so it reads exactly like
 * before: every open line falls back to `reserve`, `readyToBuild` is 0 on
 * every row, and META reports it under `bucketsEmpty`. No further deploy is
 * needed once the field is created; the next hourly run picks it up on its
 * own and META moves it to `bucketsBuilt`. See `readyToBuildSourced` and
 * `bucketsMeta`.
 *
 *   onHand        ✅ lot balances
 *   reserve       ✅ open sales-order quantity — sold, still in the building
 *   outbound      ✅ shipped sales-order quantity
 *   onOrder       ✅ open purchase-order quantity — ordered, not received
 *   inTransit     ✅ purchase-order quantity billed but not received
 *   readyToBuild  ⏳ wired, self-activating; 0 until the field exists in NS
 *
 * `bucketsBuilt` / `bucketsEmpty` in META carry this to the browser, so the
 * screen states which columns are real rather than showing a confident zero.
 *
 * ═══ WHO HOLDS A BUNDLE, added 2026-09-08 ═══════════════════════════════════
 * `reserve` said HOW MUCH of a bundle was sold and nothing about WHO bought it,
 * so the Reserved panel's SO #, SO Creation Date, Reserved For, Ship Week,
 * Customer and Trader columns all came from a seeded generator. Each lot now
 * carries `orders: []` — one entry per sales order holding it, with the order's
 * document number, customer, dates, rep and its own share of the reserve. See
 * `loadBuckets` for why it is keyed by transaction (a bundle can be held by
 * several orders: 31 lots in this sandbox are, one of them by 17) and why the
 * key is present even when empty (it is what tells the browser the payload knows
 * about attribution at all, rather than leaving a fixture to look real).
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
    // WHO the sales order belongs to, read from the Sales Team SUBLIST. Added
    // 2026-09-08 so the Reserved panel can name a real trader instead of a
    // generated one. `transaction.employee` (the header Sales Rep) is NULL on
    // every ARCH order because Team Selling puts the rep on the sublist, so the
    // header alone cannot answer it — see archSalesTeam.js for the measurement.
    //
    // It is the SAME module the open-orders service already uses, deliberately:
    // the pick rule (primary, else highest contribution, else lowest employee id)
    // must not exist twice, or the Reserved panel and the Open Orders tab will
    // eventually name two different people for one order.
    //
    // ⚠️ DEPLOY DEPENDENCY. It is file 123861 in the sandbox File Cabinet
    // (trader_screen/shared, 9,016 bytes, byte-identical to this repo's copy as of
    // 2026-09-08). If it were ever absent, THIS MODULE WOULD NOT LOAD AT ALL and
    // the cache would stop rebuilding, so confirm it exists before uploading this
    // file into an environment that has never had it.
    //
    // Appended at the END of the array rather than beside the other two shared
    // modules, so that not one existing positional binding moves. The comment
    // above about positional binding is the reason: a new id in the middle
    // silently reassigns every parameter after it.
    // Shared FIFO lot-cost engine, validated to the cent against production GL
    // (2026-06-11). MTL already depends on it, so it exists in both sandbox and
    // production — but it is NOT tracked in this repo and drifts per
    // environment, so treat its output as data to be checked, not as a given.
    // Every call here is wrapped: costing must never take down the cache build.
    '/SuiteScripts/MCGI_LIB_LotCost',
    '../../shared/archSalesTeam',
], (query, search, log, runtime, task, CacheKeys, CacheClient, LotCostLib, ArchSalesTeam) => {

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
     *     from here on. Existing lines are not retroactively tagged. THIS ROLE
     *     IS UNCHANGED by the 2026-09-10 scoping change below — the segment
     *     keeps doing its GL job; this file just stops using it to decide which
     *     items to show.
     *
     * ── SUPERSEDED AGAIN, 2026-09-10. The segment is not the scope either. ────
     * The segment's exact failure mode showed up twice: 54 lots on 3 items
     * missing 2026-09-09, then 3 more items the next day. It is a manual,
     * per-item, opt-in flag — every item anyone adds has to be remembered and
     * tagged, and the account has already proven that does not reliably
     * happen. Measured the same day: only 6 of the 149 items in Department 11
     * ("Hardwood") carry the segment at all.
     *
     * Scoping is now `department = "Hardwood"` (by name, not id 11 — see
     * `HARDWOOD_DEPARTMENT`'s own comment below), minus a hardcoded exclusion list
     * (`NON_ARCH_DEPARTMENT_ITEMS` below) for the one real distinction inside
     * that department: decking, a different product line sold by a different
     * unit with a different tally shape, not the lumber-lot stock this screen
     * tracks. Measured: 7 of the 149 department items are decking by name
     * (`*DECKD*`); the other 142, including the 6 that already carried the
     * segment, are the same species-thickness-KD shape as every known ARCH
     * SKU.
     *
     * This inverts the failure mode on purpose. The segment's failure mode was
     * silent: a real item with real stock, invisible, nothing to notice. An
     * exclusion list's failure mode is loud: a wrongly-visible item shows up
     * on the grid where someone can see it and tell us to add it to the list.
     * Visible-and-wrong beats invisible-and-missing for exactly the reason the
     * 2026-08-18 units-type note above already argued for excluding rather
     * than allowlisting — the same logic, one scope further in.
     *
     * The segment field itself is untouched: still real, still posts to GL,
     * still worth setting correctly on new items for that reason. It is only
     * no longer what this file reads to decide what to show.
     */
    /**
     * By NAME, not internal id. Measured 2026-09-10: department id 11 is
     * "Hardwood" in sandbox and DOES NOT EXIST AT ALL in production — same
     * class of trap as `REVIEWED` being list value 101 in sandbox with no
     * counterpart in prod. Hardcoding `11` would silently match nothing the
     * day this code runs in production. Every WHERE clause below resolves it
     * with `BUILTIN.DF(i.department) = ?` instead of comparing the raw id.
     */
    const HARDWOOD_DEPARTMENT = 'Hardwood';
    /**
     * ── 🔴 THE DEPARTMENT ALONE STOPPED BEING THE SCOPE ON 2026-09-16 ───────────
     *
     * Marc-Antoine's inventory re-import landed 98 hardwood items in the ARC
     * subsidiary carrying department "Trading", not "Hardwood". Measured
     * 2026-09-17: African Mahogany, Afrormosia, Bocote, Bolivian Rosewood,
     * Canarywood, Curly Maple, Caribbean Rosewood and European White Oak, 1,037
     * lot rows, every one of them with stock on hand. Under a department-only
     * scope the screen saw NONE of them.
     *
     * The damage was not a missing row here and there, it was total. The pair
     * count fell 105 -> 21 in one run, the shrink guard correctly refused a 0.200
     * ratio, and the cache then froze on the previous payload for ~20 hours while
     * every hourly rebuild recomputed the same 21 and was refused again. That is
     * what Marc-Antoine reported as « est-ce possible d'accélérer le refresh » on
     * 2026-09-17: the screen was not slow, it was stopped.
     *
     * So the scope is a UNION, deliberately, and not a swap to the subsidiary:
     *
     *   department = Hardwood  keeps the 17 items and 18 on-order bundles still
     *                          sitting under CWP MTL, including PO-CWP-001326,
     *                          which is the PO in his own screenshot.
     *   subsidiary = ARC       picks up everything the migration has moved, and
     *                          keeps picking it up as more arrives.
     *
     * It is also self-healing in both directions. If he sets department =
     * Hardwood on the migrated items the union still matches them exactly once;
     * if he never does, the subsidiary arm carries them forever. Measured after
     * the change: 128 pairs from 1,107 lot rows, and the "miscategorized
     * hardwood" warning that had been counting 143 items drops to 0, because
     * every one of those 143 WAS the migration.
     *
     * ⚠️ BY NAME, for the same reason HARDWOOD_DEPARTMENT is by name. And note
     * `i.subsidiary` raw is NOT_EXPOSED to search on this tenant (a bare
     * `i.subsidiary = 9` is a hard 400), so `BUILTIN.DF` is not a stylistic
     * match with the line above it, it is the only form that works.
     */
    const ARCH_SUBSIDIARY = 'ARC';
    /**
     * The scope predicate, one definition, four query sites.
     *
     * Binds in this order: department, then subsidiary. `ARCH_SCOPE_PARAMS` is
     * the matching array and the two must be edited together — which is the
     * whole reason they sit on adjacent lines rather than in the queries.
     */
    const ARCH_SCOPE_SQL =
        '(BUILTIN.DF(i.department) = ? OR BUILTIN.DF(i.subsidiary) = ?)';
    const ARCH_SCOPE_PARAMS = [HARDWOOD_DEPARTMENT, ARCH_SUBSIDIARY];
    /**
     * The one real distinction inside Department 11: decking is a different
     * product line (sold by the linear foot, not board-feet lots) that shares
     * the trading department for accounting reasons only. Hardcoded rather
     * than another segment/flag, deliberately — see the note above on why an
     * opt-in per-item flag is the thing that just failed twice. A short,
     * reviewable list beats a field someone has to remember to set.
     */
    const NON_ARCH_DEPARTMENT_ITEMS = [
        'IPE44DECKD', 'IPE54DECKD', 'IPE54DECKDDNU',
        'NRM44DECKDS4S', 'NRM44DECKDTNG',
        'RBL44DECKD', 'RBL54DECKD',
    ];
    // Fixed, hardcoded item codes, never user input — safe to inline as SQL
    // literals rather than bind as parameters.
    const NON_ARCH_ITEMS_SQL = NON_ARCH_DEPARTMENT_ITEMS.map((id) => "'" + id + "'").join(',');
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
    /**
     * ── 15 MINUTES, LOWERED FROM 60 ON 2026-09-17 ───────────────────────────────
     *
     * Marc-Antoine, 2026-09-17: « On va bientôt rentrer dans la phase de testing.
     * Est-ce possible d'accélérer le refresh de l'info? »
     *
     * ⚠️ READ THIS BEFORE LOWERING IT FURTHER, because the obvious reading of the
     * cost is backwards. The expensive half of this chain is the NO-OP cycles,
     * which run every 2.7 seconds (measured, see THE CHAIN above) and are
     * completely unaffected by this number. What this number changes is only the
     * count of REAL rebuilds: 24 a day at 60 minutes, 96 a day at 15. So the
     * chain's permanent ~6% tax on IND and MTL does not move, and what does move
     * is four times the SuiteQL and four times the log volume.
     *
     * 🔴 RE-MEASURED 2026-09-21, AND THE FIGURE THIS NOTE ORIGINALLY CARRIED WAS
     * WRONG BY 85%. It claimed ~129 script notes per rebuild and projected
     * 12,384 a day. The real number is **239 per rebuild** — three consecutive
     * rebuilds, identical — so 96 rebuilds a day is **~22,900 notes a day**. The
     * method, for whoever checks it next:
     *
     *   SELECT DISTINCT TO_CHAR(date,'MM-DD HH24:MI') AS minute FROM scriptnote
     *   WHERE scripttype = 6503 AND date > TO_DATE('<today>','YYYY-MM-DD')
     *
     * which also confirms the cadence is real: the minutes land on :05, :20, :35
     * and :50, so the self-rescheduling chain is genuinely driving it.
     *
     * 15 is a testing-phase number, not a floor discovered by experiment, and the
     * corrected arithmetic leaves it less headroom than this note used to imply.
     * Going to 5 would be ~380 rebuilds a day and **~68,800 script notes**, not
     * the ~49,000 first written here. That is the volume at which `scriptnote`
     * itself stops answering queries reliably (GROUP BY and aggregates silently
     * return empty), i.e. it would degrade the tool used to diagnose this screen,
     * and at ~22,900 a day we are already about a third of the way there rather
     * than a quarter. Do not lower it without moving LotCostLib's DEBUG lines
     * behind a flag first — they are the bulk of the 239.
     *
     * ⚠️ Retention is the second cost and it is not visible in a rate. The log
     * for this script spanned 2026-09-07 to 2026-09-21 at 120,899 rows when
     * measured, so four times the volume buys roughly a quarter of the history,
     * on the one table that makes this screen debuggable without the UI.
     *
     * ⚠️ `ARCH_REBUILD_MINUTES` in `react-app/src/lib/archFreshness.ts` is the
     * other half of this constant and MUST be changed with it. It drives the
     * grid's freshness badge and the text of all three tooltips, so leaving it at
     * 60 makes a healthy screen describe a schedule it is not on.
     *
     * PACE_TTL_SECONDS below is DERIVED from this, so lowering it is safe by
     * construction. Raising it past 6 hours is not; see TTL_SUMMARY.
     *
     * 🔴 AND IT IS NOT WHAT HE WAS ACTUALLY SEEING. On the day he asked, the
     * cache had been frozen for ~20 hours: the department scope had stopped
     * matching his re-imported items, every rebuild computed 21 pairs against a
     * cached 105, and the shrink guard refused all of them. A faster interval
     * would have refused faster. The scope union at ARCH_SCOPE_SQL is that fix;
     * this one is the answer to the question he asked.
     */
    const REBUILD_INTERVAL_MS = 15 * 60 * 1000;   // 15 min — see the note above

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

    /**
     * Pairs recovered by donor-row logic (stock on order/reserved, nothing on
     * hand), carried the same way as `skippedLots` so the count reaches META and
     * the "already reported" check below has something to compare against.
     */
    let recoveredCount = 0;

    /**
     * Pairs SKIPPED for want of a donor row, carried the same way and read by the same
     * kind of "already reported" check. See the note at its log site: this one has never
     * fired, so the latch there is insurance rather than a fix.
     */
    let unrecoverableCount = 0;

    /**
     * Item ids carrying an ARCH-shaped units type but no Hardwood segment, so their
     * stock cannot appear on the screen. Carried to META so the SCREEN can say why
     * stock is missing, instead of the fact living only in the execution log. Same
     * best-effort caveat as `skippedLots` about surviving between Map/Reduce stages.
     */
    let untaggedItems = [];

    /**
     * Whether `custbody_arch_ready_to_build` could be read this run.
     *
     * 🔴 THIS VARIABLE DOES NOT REACH `summarize`, AND MUST NOT BE READ THERE.
     * It is written inside `loadBuckets()`, which runs in `getInputData`; META
     * is written in `summarize`, a SEPARATE execution in which every module
     * variable is re-initialised — this file says so itself where `costedRows`
     * is computed ("module state does not reliably survive between stages").
     *
     * The comment here used to claim that a lost flag meant META "describes the
     * bucket as still unsourced, which was already true before this field
     * existed." That was exactly backwards and it is the reason this is now
     * spelled out: the default is `true`, so a lost flag makes META claim the
     * bucket IS sourced on a run where the read failed — a structural zero
     * presented as a measured one, which is the single thing `archBuckets.ts`
     * exists to prevent, and which `App.tsx` renders as "Live" with no caveat.
     *
     * So it travels in the DATA, the way everything else that has to cross the
     * stage boundary travels: `getInputData` stamps `rtbSourced` on each pair,
     * `reduce` copies it onto the summary row, and `summarize` folds the rows
     * back into one boolean. One extra boolean per row, ~2 KB across a full
     * ARCH payload, well inside the 500 KB per-value ceiling.
     *
     * The bucket TOTALS never depended on this reaching `summarize` — they are
     * computed and embedded in each row inside `getInputData`, before the split.
     */
    let readyToBuildSourced = true;

    /**
     * One computation, called from BOTH `summarize` META writes, so they
     * cannot drift the way the memory note on this file warns about ("both
     * META writes carry it"). `bucketsBuilt`/`bucketsEmpty` name six buckets
     * between them, never five — `readyToBuild` moves from one list to the
     * other, it never just vanishes.
     *
     * Takes `sourced` as an ARGUMENT rather than closing over
     * `readyToBuildSourced`: this is only ever called from `summarize`, where
     * that variable is a re-initialised `true` and means nothing. See its note.
     */
    const bucketsMeta = (sourced) => ({
        bucketsBuilt: sourced
            ? ['onHand', 'reserve', 'outbound', 'onOrder', 'inTransit', 'readyToBuild']
            : ['onHand', 'reserve', 'outbound', 'onOrder', 'inTransit'],
        bucketsEmpty: sourced ? [] : ['readyToBuild'],
    });

    /**
     * The run's Ready to Build sourcing, folded back out of the summary rows.
     *
     * ANY row that crossed with `rtbSourced: false` unsources the whole run:
     * the flag is a property of the single query in `loadBuckets`, so it is the
     * same answer on every row, and `every` over an empty list is `true`, which
     * is the right reading for "no rows to disagree" (that path does not write
     * META at all).
     */
    const rtbSourcedFrom = (rows) => rows.every((r) => r.rtbSourced !== false);

    const num = (v) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : 0;
    };

    /**
     * A NetSuite date column as `YYYY-MM-DD`, or '' when there is none.
     *
     * 🔴 THE PAYLOAD MUST CARRY ISO, NOT WHAT NETSUITE HANDS BACK. N/query returns
     * a date in the ACCOUNT'S display format, which here is M/D/YYYY, and
     * `new Date('8/20/2026')` in a browser is parser-dependent while
     * `new Date('2026-08-20')` is not. The front end also has to compare two of
     * these (an order's age is today minus its creation date), and string
     * comparison only sorts correctly in ISO.
     *
     * Byte for byte the same function as `isoDate` in trader_screen_service_arch.js,
     * and deliberately so: both feed a date into the same React screen, and the
     * open-orders tab and the Reserved panel must not disagree about a day.
     * Duplicated rather than shared because the service is not a module this one
     * may depend on (it is the RESTlet's own file), and a two-branch regex is a
     * smaller risk than a new cross-entry-point dependency.
     *
     * ⚠️ The browser must parse these as LOCAL, i.e. `new Date(iso + 'T00:00:00')`.
     * `new Date('2026-08-20')` alone is UTC midnight, which is the 19th anywhere
     * west of Greenwich — Montreal included.
     */
    const isoDate = (v) => {
        if (!v) return '';
        const s = String(v).trim();
        const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (mdy) {
            return mdy[3] + '-' + ('0' + mdy[1]).slice(-2) + '-' + ('0' + mdy[2]).slice(-2);
        }
        const ymd = s.match(/^(\d{4}-\d{2}-\d{2})/);
        return ymd ? ymd[1] : '';
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
            /*
             * 🔴 THE WRITE PATH CANNOT FOLLOW THIS PARAMETER. `archSplitExecute`
             * calls the same costing library with NO book, deliberately, because an
             * inventory adjustment posts to the PRIMARY book -- its own comment says
             * so. Book 1 is the primary here, so the default agrees with it and the
             * screen and the adjustment quote the same number.
             *
             * Point this at anything else and they diverge silently, which is
             * precisely the shape of Feedback 6 item 18: two costs, both correct, for
             * different questions. It is not theoretical. The USD Accounting Book
             * (id 2) went live 2026-04-30 and carries a line for every ARCH posting:
             * measured 2026-09-16 on ZEB84KD, 175 accounting lines in book 1 and 175
             * in book 2.
             */
            if (_costBookCached !== ARCH_COST_BOOK_DEFAULT) {
                log.error('ARCH cache — costing book is not the primary book',
                    'custscript_ts_arch_cost_book is set to ' + _costBookCached + ', so the grid and ' +
                    'the order wizard will quote costs from that book while a bundle split posts its ' +
                    'inventory adjustment against the primary book (' + ARCH_COST_BOOK_DEFAULT + '). ' +
                    'The two will disagree and nothing else will say so. See Feedback 6 item 18.');
            }
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

    /* == Tally resolution (SDD Phase 1, section 3.2.3) =========================
     *
     * Until 2026-09-07 this file contained exactly ONE tally token in 1,953 lines:
     * `tallyImageUrl: null`. The whole read and render half of the tally feature was
     * built, tested and deployed while nothing on the server ever sent it data. This
     * is that missing half.
     *
     * 🔴 MATCH ON THE PAYLOAD'S OWN `lot` VALUE, EXACTLY, OR NOT AT ALL.
     * The SDD is explicit and it is not a compromise: "the push never guesses a lot"
     * (s4.2), and a bundle's lot reference, where set, must belong to that PO's own
     * receipts (s4.1). A supplier numbers bundles 1535-1548; NetSuite numbers the same
     * goods 316027-1. Those do not correspond and are not meant to. A bundle whose
     * `lot` is null is CORRECT, not broken - it falls back to the document view and
     * lands in Carlos's queue for a human to assign. Never derive a lot from a bundle
     * number, a position, or a PO prefix.
     *
     * 🔴 STATUS BY NAME, NEVER BY INTERNAL ID. The two environments disagree:
     * REVIEWED is list value 101 in sandbox and does not exist in production at all
     * (9 values there, 10 here). BUILTIN.DF gives the name, which is why it is used.
     *
     * The foot-check deliberately does NOT run here. `checkPayload()` in
     * react-app/src/lib/archTally.ts is the single implementation and it runs in the
     * browser; this function carries the payload through untouched so there is only
     * ever one dialect of the arithmetic. Consequence, accepted 2026-09-07: nothing
     * guards the WRITE, and the NetSuite-side half of SDD s4.1 stays unmet until
     * Lucas's skill exists.
     */
    const TALLY_STATUSES = { PARSED: 1, MATCHED: 1, REVIEWED: 1 };

    /** Cap on capture records read per reduce call, with a loud log if it bites. */
    const TALLY_MAX = 500;

    const TALLY_SQL =
        'SELECT ' +
        '  c.id                                    AS captureid, ' +
        // BUILTIN.DF resolves the list VALUE to its NAME. See the status note above.
        '  BUILTIN.DF(c.custrecord_msl_plc_status) AS statusname, ' +
        /* 🔴 TO_CHAR, NOT THE RAW COLUMN. Selected raw, `lastmodified` comes
         * back as "9/14/2026" with the time SILENTLY DROPPED, while the same
         * value through TO_CHAR is "2026-09-14 23:41:03". The split comparison
         * in reduce() is a timestamp comparison, so the raw form would collapse
         * every capture to midnight and mark a lot stale for any split that
         * happened later the SAME DAY it was tallied. Caught before deploy
         * 2026-09-15 by printing both forms side by side. */
        "  TO_CHAR(c.lastmodified,'YYYY-MM-DD HH24:MI:SS') AS lastmodified, " +
        '  c.custrecord_msl_plc_container_no       AS container, ' +
        '  c.custrecord_msl_plc_intake_json        AS intake, ' +
        '  c.custrecord_msl_plc_results_json       AS payload, ' +
        // The source document, for the middle rung of the fallback chain. LEFT JOIN:
        // a capture with no file attached is normal and must still yield its matrix.
        '  f.url                                   AS fileurl ' +
        'FROM customrecord_msl_plc_capture c ' +
        '  LEFT JOIN file f ON f.id = c.custrecord_msl_plc_file ' +
        "WHERE c.isinactive = 'F' " +
        // NEWEST FIRST, and the order is load-bearing rather than tidy. Two documents can
        // name the same lot (a re-push, a supersede), and record-format.md leaves dedupe
        // procedural until anchoring exists. Without ORDER BY, "first row wins" meant the
        // tally a trader sees could change between builds for no visible reason.
        'ORDER BY c.id DESC';

    /* ── WHICH LOTS HAVE BEEN SPLIT SINCE THEIR TALLY WAS CAPTURED ──────────
     *
     * A split makes the parent's tally wrong: the parent no longer holds the wood
     * the matrix describes, and the child is brand new and described by no
     * supplier document at all. Before this existed the screen kept serving the
     * pre-split matrix as though nothing had happened.
     *
     * 🔴 IDENTIFYING A SPLIT IS THE WHOLE PROBLEM, and the obvious answers are
     * all wrong. Measured 2026-09-14:
     *   - "any inventory adjustment" is useless: 820 of 835 ARCH lots have been
     *     touched by one, and only 32 of 3,581 adjustments are ARCH splits.
     *   - the assignment SHAPE does not separate them: splits are 2 lots / 2 rows
     *     in 28 cases, and non-split adjustments are 2 lots / 2 rows in 28 cases.
     *   - the ACCOUNT does not either: splits post to 288, 612 and 228, and
     *     non-split adjustments use all three heavily (3,549 / 1,833 / 140).
     *
     * So this matches on two things WE write, not on anything inferred:
     *
     *   the link   `custcol_mgsl_split_invadj` (field 13634) on the SO line, set
     *              by `archSplitExecute.js:662`. Precise: all 6 linked adjustments
     *              carry the split memo too. But it is written by
     *              `trueUpSalesOrderLine`, which RETHROWS on failure, so a split
     *              whose true-up failed has moved the lots and left no link.
     *   the memo   written by `postSplitAdjustment` BEFORE the true-up, so it
     *              survives that case. On its own it is brittle: the wording has
     *              already drifted once, 28 rows use an em dash and 4 a colon,
     *              which is why it is the backstop and not the primary.
     *
     * Union of the two: precise where the link exists, complete where it does not.
     *
     * PARENT vs CHILD comes from the SIGN of the lot's net quantity on that
     * adjustment, which is structural and needs no lot-name pattern. Verified with
     * no exceptions across every split since 2026-09-01: the parent nets negative
     * (wood leaving) and the child nets positive (the new lot). This survives the
     * child-lot naming question landing either way. */
    const SPLIT_SQL =
        'SELECT ' +
        '  BUILTIN.DF(ia.inventorynumber) AS lot, ' +
        '  t.id                           AS adjid, ' +
        /* TO_CHAR for the same reason as `lastmodified` above: the raw column
         * drops the time. Both sides of the comparison must carry one. */
        "  TO_CHAR(t.createddate,'YYYY-MM-DD HH24:MI:SS') AS splitat, " +
        '  SUM(ia.quantity)               AS net ' +
        'FROM inventoryassignment ia ' +
        '  JOIN transaction t ON t.id = ia.transaction ' +
        "WHERE t.type = 'InvAdjst' " +
        "  AND ( t.memo LIKE '%ARCH bundle split%' " +
        /* Aliased `sl`, NOT `tl`. `archLotOrders.test.mjs` B12 asserts the bucket
         * query "FROM transactionline tl" runs exactly ONCE per run, and that is a
         * real property worth keeping. This subquery is a different query that
         * merely mentions the same table, so it takes a different alias rather
         * than making a true assertion go quiet. */
        '     OR t.id IN (SELECT sl.custcol_mgsl_split_invadj ' +
        '                   FROM transactionline sl ' +
        '                  WHERE sl.custcol_mgsl_split_invadj IS NOT NULL) ) ' +
        "GROUP BY BUILTIN.DF(ia.inventorynumber), t.id, TO_CHAR(t.createddate,'YYYY-MM-DD HH24:MI:SS') " +
        /* Ordered on the FORMATTED value, not the raw column, because the raw
         * one is no longer in the GROUP BY and NetSuite rejects the query
         * outright for it. Safe: 'YYYY-MM-DD HH24:MI:SS' sorts
         * lexicographically in the same order it sorts chronologically. */
        "ORDER BY TO_CHAR(t.createddate,'YYYY-MM-DD HH24:MI:SS') DESC";

    /* The scan is newest-first and unbounded in time, which is correct — a lot split
     * two years ago and never re-tallied is still stale — but unbounded row counts do
     * not belong in a Map/Reduce that runs hourly forever. 67 rows today. The cap is
     * generous enough that reaching it means something changed, and the log says so
     * rather than letting the oldest splits fall off in silence, which is exactly the
     * failure mode TALLY_MAX had before its status filter moved into SQL. */
    const SPLIT_MAX = 5000;

    /**
     * When THIS bundle entry was last tallied, if the payload says so.
     *
     * 🔴 WHY THIS EXISTS (review finding B3). The staleness comparison below
     * needs to know when a LOT was last tallied, and the only timestamp available
     * is `lastmodified` on the capture RECORD. That is per document, and a document
     * covers many lots, so any edit to a capture, even a typo fix in Status Reason,
     * reads as "every lot in here was just re-tallied" and clears the flag for all
     * of them. Demonstrated live on 2026-09-15: one edit to capture 401 cleared the
     * flag for all five of its lots when only one had genuinely been re-measured.
     *
     * The real fix is a per-lot timestamp inside the payload. No payload written so
     * far carries one, and the writer lives in another repo, so this reads the field
     * if it is ever present and falls back to the record otherwise. That makes
     * precision improve on its own the day the writer starts emitting it, with no
     * further change here.
     *
     * Accepts either `tallyAt` or `parsedAt` on the bundle. Anything unparseable is
     * treated as absent rather than as epoch zero, which would mark every lot stale.
     */
    const bundleStamp = (b) => {
        const raw = b && (b.tallyAt || b.parsedAt ||
                          (b.provenance && (b.provenance.tallyAt || b.provenance.parsedAt)));
        if (!raw) return null;
        const d = new Date(raw);
        return isFinite(d.getTime()) ? d : null;
    };

    /* WHEN EACH CAPTURE'S PAYLOAD ACTUALLY CHANGED, as opposed to when the record
     * was last touched for any reason at all.
     *
     * 🔴 THIS IS THE B3 NARROWING, and the divergence is real, not theoretical.
     * Measured 2026-09-15 on capture 1: `lastmodified` reads 2026-09-03 14:01:21
     * while the payload last changed at 13:46:36. Fifteen minutes apart, because the
     * record was edited without the tally being touched. Comparing a split against
     * `lastmodified` there would claim the lot had been re-tallied when it had not.
     *
     * `systemnote` records changes per FIELD, so filtering to the results-JSON field
     * answers "when did this document's tally last change" exactly. Scoped to
     * recordtypeid 3834 it reads 9 rows in this account.
     *
     * ⚠️ Still per RECORD, not per lot. A genuine re-tally of lot X still clears
     * lots Y and Z in the same document. Only the per-bundle stamp in `bundleStamp`
     * closes that, and it needs the writer to emit one. This removes the WORST case,
     * an unrelated edit clearing everything, not the whole problem. */
    /* 🔴 TO_CHAR, AND IT WAS MISSING UNTIL 2026-09-15. The comment three blocks up
     * says "the raw column drops the time, both sides of the comparison must carry
     * one" and this query did not do it. `MAX(sn.date)` returns '9/15/2026', which
     * `new Date()` reads as MIDNIGHT, so every payload change was backdated by up to
     * 24 hours.
     *
     * That made the narrowing WORSE than the fallback it replaced: `lastmodified` is
     * TO_CHAR'd and carries a time, so on a same-day re-tally this "more precise"
     * path was strictly less precise. Measured on the live screen: lot 315643-6 was
     * split at 2026-09-15 00:34:14 and its capture payload was rewritten at 02:19:35,
     * two hours AFTER, so the tally is current. Truncated to 00:00:00 the comparison
     * flipped and the trader was told a fresh tally was stale.
     *
     * MAX() then TO_CHAR, not TO_CHAR then MAX(): the string form sorts the same as
     * the date form, but taking the max on the real type is what the column is for. */
    const PAYLOAD_CHANGE_SQL =
        "SELECT sn.recordid AS captureid, TO_CHAR(MAX(sn.date),'YYYY-MM-DD HH24:MI:SS') AS changedat " +
        'FROM systemnote sn ' +
        'WHERE sn.recordtypeid = 3834 ' +
        "  AND sn.field = 'CUSTRECORD_MSL_PLC_RESULTS_JSON' " +
        'GROUP BY sn.recordid';

    let _payloadChangeCache = null;
    /**
     * captureId -> Date the payload last changed, or {} when it cannot be read.
     *
     * Fails SOFT on purpose. `systemnote` is a search type this MR has never queried,
     * and REST SuiteQL and N/query are different dialects here, which has already
     * cost this project a query that passed every check and failed only once
     * deployed. An empty map falls back to `lastmodified`, which is how this ran
     * before: wider than it should be, never wrong in the common case.
     */
    const loadPayloadChanges = () => {
        if (_payloadChangeCache) return _payloadChangeCache;
        const byCapture = {};
        try {
            const rows = query.runSuiteQL({ query: PAYLOAD_CHANGE_SQL }).asMappedResults() || [];
            for (let i = 0; i < rows.length; i++) {
                const id = String(rows[i].captureid || '');
                const d  = rows[i].changedat ? new Date(rows[i].changedat) : null;
                if (id && d && isFinite(d.getTime())) byCapture[id] = d;
            }
        } catch (e) {
            log.audit('ARCH tally payload-change read unavailable',
                'Falling back to the record-level lastmodified. ' + (e.message || String(e)));
        }
        _payloadChangeCache = byCapture;
        return byCapture;
    };

    let _splitCache = null;
    /**
     * lot (upper, trimmed) -> { at: Date, adjId, role: 'parent' | 'child' }
     *
     * The LATEST split per lot only. A lot split twice is stale from the most
     * recent one, and `ORDER BY t.createddate DESC` means the first row seen wins.
     *
     * ⚠️ Memoized exactly like `loadTallies`, and for the same reason: reduce()
     * runs once per item+location pair, so an unmemoized call would re-read this
     * for every pair, every hour.
     *
     * Fails SOFT. An error here means no lot is marked, which is precisely
     * today's behaviour, so a failure costs the new signal and nothing else. It
     * must never take the cache down: an outer throw here would blank quantities
     * that have nothing to do with tallies.
     */
    const loadSplitEvents = () => {
        if (_splitCache) return _splitCache;
        const byLot = {};
        try {
            const rows = query.runSuiteQL({ query: SPLIT_SQL }).asMappedResults() || [];
            if (rows.length >= SPLIT_MAX) {
                log.error('ARCH split scan hit its row cap',
                    'Read ' + rows.length + ' rows, cap ' + SPLIT_MAX + '. Rows are newest-first, so ' +
                    'the OLDEST splits are the ones dropped and those lots will stop reporting a stale ' +
                    'tally. Raise SPLIT_MAX or bound the scan by date.');
            }
            for (let i = 0; i < rows.length && i < SPLIT_MAX; i++) {
                const r = rows[i];
                const lot = String(r.lot || '').trim().toUpperCase();
                if (!lot || byLot[lot]) continue;   // newest wins, see ORDER BY
                const net = Number(r.net);
                /* 🔴 EPSILON, NOT `=== 0`. A net of zero is a REAL and correct
                 * outcome, not a data error: a remainder-zero split issues the whole
                 * bundle and receives it straight back onto the same lot, so the lot
                 * ends where it started, no child is created, and the tally still
                 * describes the wood exactly. Skipping it is right.
                 *
                 * Measured on IA-CWP-732 (2026-09-15): NetSuite returned exactly '0'
                 * and `=== 0` held. But that is luck, not a guarantee. A split whose
                 * two halves round differently would come back as 1e-16, fall past an
                 * exact-zero test, be classified a CHILD because the sign is positive,
                 * and then be marked stale against its own tally. An epsilon is the
                 * difference between "correct today" and "correct". */
                if (!isFinite(net) || Math.abs(net) < 1e-9) continue;
                byLot[lot] = {
                    at:    r.splitat ? new Date(r.splitat) : null,
                    adjId: r.adjid,
                    role:  net < 0 ? 'parent' : 'child',
                };
            }
            log.audit('ARCH split events',
                Object.keys(byLot).length + ' lot(s) carry a split. Rows: ' + rows.length + '.');
        } catch (e) {
            log.error('ARCH split detection failed',
                'No lot will be marked as awaiting a re-tally this run, which is the ' +
                'behaviour before this existed. Quantities are unaffected. ' + (e.message || String(e)));
        }
        _splitCache = byLot;
        return byLot;
    };

    /* The SAME query with the status whitelist pushed into SQL.
     *
     * 🔴 WHY THIS EXISTS. `TALLY_MAX` caps the rows CONSUMED, and the cap is
     * applied before the JS gates below, over a result set that is not filtered at
     * all: PL and BOL captures share this record type, and so do rejected and
     * in-flight ones. So the budget is spent on rows that were never going to
     * qualify, and because the sort is newest-first the rows pushed out are the
     * OLDEST, which are the real supplier tallies a trader is most likely to want.
     * Filtering in SQL means the 500 are 500 CANDIDATES.
     *
     * ⚠️ AND WHY IT IS TRIED, NOT TRUSTED. `BUILTIN.DF` in a WHERE clause is
     * verified working on the REST SuiteQL endpoint, which is NOT the dialect this
     * runs in. This project has already shipped a query that passed every check and
     * then failed only once deployed, on `entitygroup.grouptype`. The cost of being
     * wrong here is not a degraded query, it is the outer catch below returning {}
     * and EVERY lot on the screen losing its tally, behind one log line.
     *
     * So the filtered form is attempted and the unfiltered form is the fallback.
     * A dialect that rejects it lands exactly on today's behaviour instead of on a
     * blank screen. The JS status gate stays either way, and has to: on the
     * fallback path it is still the only thing doing the filtering. */
    const TALLY_SQL_FILTERED = TALLY_SQL.replace(
        "WHERE c.isinactive = 'F' ",
        "WHERE c.isinactive = 'F' " +
        "  AND BUILTIN.DF(c.custrecord_msl_plc_status) IN ('PARSED', 'MATCHED', 'REVIEWED') "
    );

    /**
     * lotNo (upper, trimmed) -> { status, container, sourceFile, docUrl, bundles }
     *
     * One query per reduce call, mirroring loadLotCosts. Wrapped for the same reason:
     * a tally failure must degrade to "no tally shown" and must never cost the row its
     * quantities, which are why the screen exists.
     */
    let _tallyCache = null;

    const loadTallies = () => {
        // Memoized. reduce() runs once per item+location pair, 13 today, and this query
        // has no filter beyond isinactive, so an unmemoized call meant reading every
        // capture record 13 times an hour. NetSuite reuses a reduce execution context
        // across keys where it can, so this collapses those reads; where it cannot, it
        // costs nothing. Deliberately NOT threaded through getInputData's pairs: that
        // would put the whole map in the MR key payload for every pair.
        if (_tallyCache) return _tallyCache;
        try {
            // Narrower than lastmodified, wider than a per-bundle stamp. See B3.
            const payloadChanges = loadPayloadChanges();
            let rows;
            try {
                rows = query.runSuiteQL({ query: TALLY_SQL_FILTERED }).asMappedResults() || [];
            } catch (filterErr) {
                /* log.audit, not error: falling back is a supported outcome, not a
                 * fault. It costs the cap efficiency and nothing else. */
                log.audit('ARCH tally status filter not supported by this dialect',
                    'Falling back to the unfiltered read, which is how this ran before ' +
                    '2026-09-14. The JS status gate below still applies, so the RESULT is ' +
                    'identical; only the ' + TALLY_MAX + ' cap is spent less efficiently. ' +
                    'NetSuite said: ' + (filterErr.message || String(filterErr)));
                rows = query.runSuiteQL({ query: TALLY_SQL }).asMappedResults() || [];
            }
            // log.audit, NOT log.error. This is a per-run condition and reduce runs once
            // per pair, so at error level a hit cap would emit 13 ERROR lines an hour,
            // roughly 312 a day, and possibly emails. Level goes by cause, not importance.
            if (rows.length >= TALLY_MAX) {
                log.audit('ARCH tally cap hit',
                    'TALLY_SQL returned ' + rows.length + ' rows, at or over the ' + TALLY_MAX +
                    ' cap. Lots beyond it silently show no tally. Add a PO or lot filter here ' +
                    'before this grows further.');
            }
            const byLot = {};
            for (let i = 0; i < rows.length && i < TALLY_MAX; i++) {
                const r = rows[i];

                // docType lives in the INTAKE envelope, a different field from the
                // payload. PL and BOL captures share this record and their payloads
                // would render as nonsense, so a record with no envelope is not
                // assumed to be a tally.
                let docType = '';
                try {
                    const env = JSON.parse(r.intake || '{}') || {};
                    docType = String(env.docType || '').trim().toUpperCase();
                } catch (e) { docType = ''; }
                if (docType !== 'TALLY') continue;

                const status = String(r.statusname || '').trim().toUpperCase();
                if (!TALLY_STATUSES[status]) continue;

                let payload = null;
                try { payload = JSON.parse(r.payload || 'null'); } catch (e) { payload = null; }
                if (!payload || payload.schema !== 'mgsl.tally.v1' || !Array.isArray(payload.bundles)) {
                    log.audit('ARCH tally skipped',
                        'capture ' + r.captureid + ' is a TALLY at ' + status +
                        ' but its Results JSON is not a readable mgsl.tally.v1 payload.');
                    continue;
                }

                const prov = payload.provenance || {};
                for (let j = 0; j < payload.bundles.length; j++) {
                    const b = payload.bundles[j];
                    const lot = b && b.lot != null ? String(b.lot).trim().toUpperCase() : '';
                    // The whole point. An unmatched bundle is expected, not an error.
                    if (!lot) continue;

                    const held = byLot[lot];

                    /* SAME capture, second entry for this lot. LEGITIMATE, and it must be
                     * KEPT. A supplier form with ONE Length column per row has to split a
                     * mixed-length bundle across rows, so one lot's wood arrives as two
                     * entries of one document. Measured on JCM doc 02PS000198: bundle 13
                     * appears twice, batches 09230-13 and 09230-13-1, same forest, same
                     * compartment, same coordinates, 480cm/19pcs and 450cm/9pcs. On the
                     * hardwood side this is the NORM rather than an oddity: one Zebrano FAS
                     * bundle in the 2026-09 supplier set carries 15 distinct lengths.
                     *
                     * 🔴 This branch did not exist. The second entry fell into the
                     * cross-capture guard below, so its pieces were DROPPED from the map
                     * and the log named a second document that does not exist. The
                     * `bundles` array below has always been an array, and both the payload
                     * this MR forwards raw and `bundlesForLot()` on the client already
                     * return every match, so the server was the only place collapsing a
                     * lot to a single bundle. */
                    if (held && held.captureId === r.captureid) {
                        held.bundles.push(b);
                        continue;
                    }

                    /* DIFFERENT capture. Newest already won, thanks to ORDER BY c.id DESC.
                     * Say so rather than resolve it silently: two DOCUMENTS claiming one
                     * lot is a human question (supersede? re-push?) and Carlos owns it.
                     * The wording is now true whenever it prints, which it was not before. */
                    if (held) {
                        log.audit('ARCH tally lot claimed twice',
                            'lot ' + lot + ' appears in more than one capture. Keeping the ' +
                            'newest (capture ' + held.captureId + ') and ignoring ' +
                            'capture ' + r.captureid + '.');
                        continue;
                    }

                    byLot[lot] = {
                        captureId:  r.captureid,
                        /* When this capture was last touched. The split comparison
                         * in reduce() needs it, and it must come from the SAME
                         * source as the transaction timestamp it is compared
                         * against: both are the account's local time through
                         * SuiteQL, verified 2026-09-14 against two records whose
                         * real creation time was known. */
                        lastModified: r.lastmodified ? new Date(r.lastmodified) : null,
                        /* PER-LOT freshness, when the payload carries it. See
                         * `tallyStampFor` and the B3 note on the comparison in
                         * reduce(). Null on every payload written so far, which is
                         * why the record-level `lastModified` above stays as the
                         * fallback rather than being replaced. */
                        lotStamp: bundleStamp(b),
                        /* When the DOCUMENT's payload last changed. Narrower than
                         * `lastModified`, wider than `lotStamp`. */
                        payloadChangedAt: payloadChanges[String(r.captureid)] || null,
                        status:     status,
                        container:  r.container || payload.container || null,
                        sourceFile: prov.sourceFile || null,
                        docUrl:     r.fileurl || null,
                        bundles:    [b],
                    };
                }
            }
            _tallyCache = byLot;
            return byLot;
        } catch (e) {
            log.error('ARCH tally resolution failed',
                'Rows keep their quantities and report no tally. ' + e.message);
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
        'WHERE ' + ARCH_SCOPE_SQL + ' ' +
        '  AND i.itemid NOT IN (' + NON_ARCH_ITEMS_SQL + ') ' +
        /*
         * ── 🔴 A BUNDLE ON ORDER HAS AN inventorynumberlocation ROW AT ZERO ─────
         *
         * This used to end `AND inl.quantityonhand <> 0`, and that single
         * predicate is why Marc-Antoine's On Order drill-down was empty on
         * 2026-09-17 while the column above it read 3,000 BF.
         *
         * He guessed the cause himself — « est-ce parce que nous n'avons pas
         * encore de bundle? » — and he was half right. The bundles DO exist:
         * PO-CWP-001326 carries 001326-1 and 001326-2, minted as inventory
         * detail on the unreceived PO lines. What they do not have is stock, and
         * that is the point of them. Measured 2026-09-17, lot 001326-2 at
         * Bluelinx: quantityonhand 0, quantityonorder 3. The row exists,
         * NetSuite tracks the on-order quantity on it, and this clause threw it
         * away.
         *
         * The 2026-09-09 donor-recovery block downstream was the half fix. It
         * rebuilt the missing PAIR so the row total appeared, and its own comment
         * says it leaves `lots: []` because no on-hand lot exists. That is
         * exactly the screenshot: a total with nothing under it. This is the
         * other half, and it makes most of that recovery path redundant rather
         * than wrong, so the path stays as the backstop it always was.
         *
         * Scope, measured 2026-09-17 across the union above: 1,089 rows on hand,
         * 18 incoming-only, and 42 rows that are zero in all three columns —
         * dead lot-location pairs that this clause still correctly excludes. So
         * the universe grows by the 18 bundles a trader wants to see and by
         * nothing else.
         *
         * ⚠️ ADMITTING THEM IS NOT MAKING THEM SELLABLE, and the two must not be
         * conflated. `storedQty` is 0 for every one of these, so On Hand and the
         * lock arithmetic are untouched; `archLots.ts` is what decides a bundle
         * with no wood in the yard cannot go on a sales order, and it carries
         * the matching note.
         */
        '  AND (inl.quantityonhand <> 0 ' +
        '       OR inl.quantityonorder <> 0 ' +
        '       OR inl.quantityintransit <> 0)';

    /**
     * Items that LOOK like hardwood by the old units-type heuristic but are NOT
     * in Department 11.
     *
     * Department is set at item creation, not an extra opt-in step the way the
     * segment was — so this is a much rarer case than the segment's "untagged"
     * problem was. Kept anyway as a cheap sanity check: an ARCH-shaped SKU
     * outside the department is more likely a miscategorization than a new
     * product line, and it costs one query per run to turn that into a log
     * line instead of a silent gap.
     */
    const UNTAGGED_SQL =
        'SELECT i.id, i.itemid FROM item i ' +
        'WHERE i.unitstype IS NOT NULL ' +
        '  AND i.unitstype NOT IN (' + EXCLUDED_UNITS_TYPES.map(() => '?').join(',') + ') ' +
        '  AND (i.department IS NULL OR BUILTIN.DF(i.department) <> ?) ' +
        /*
         * The subsidiary arm of the scope, inverted, so this warning keeps
         * meaning "ARCH-shaped and invisible" rather than drifting into "not in
         * department 11", which the union above no longer makes a synonym.
         *
         * NVL rather than `i.subsidiary IS NULL`: the raw column is NOT_EXPOSED
         * to search here, so only the BUILTIN.DF form is available, and a bare
         * `<> ?` against a NULL would silently drop every item with no
         * subsidiary — the rows most worth warning about.
         *
         * Measured 2026-09-17: this took the warning from 143 items to 0. All
         * 143 were the ARC migration, i.e. the thing the union now shows.
         */
        "  AND NVL(BUILTIN.DF(i.subsidiary), '~none~') <> ?";

    /**
     * ── 🔴 THE MIRROR OF THE WARNING ABOVE: IN SCOPE AND SHOULD NOT BE ──────────
     *
     * `UNTAGGED_SQL` catches hardwood the screen cannot see. This catches the
     * opposite and newer risk: NON-hardwood the screen CAN see.
     *
     * `NON_ARCH_DEPARTMENT_ITEMS` is seven decking SKUs excluded by literal name,
     * and until 2026-09-17 that list was only lightly loaded, because an item had
     * to carry department Hardwood to be in scope at all. The scope union changed
     * that: every item in subsidiary ARC is now in scope automatically, and MA is
     * still importing. ARC held 98 items on 2026-09-17 and 149 on 2026-09-21, so
     * the aperture is both wider and moving.
     *
     * It held, and it held by luck of implementation rather than design. Measured
     * 2026-09-21: SIX of the seven decking SKUs have ALREADY migrated into ARC
     * (IPE44DECKD, IPE54DECKD, NRM44DECKDS4S, NRM44DECKDTNG, RBL44DECKD,
     * RBL54DECKD) and all six are still excluded — because the list keys on NAME,
     * not on department. Had it been written as a department test it would have
     * failed silently the day the migration ran, and decking sold by the linear
     * foot would have appeared on a board-feet screen.
     *
     * So this is the tripwire for the next one. It does NOT gate anything: the
     * explicit list stays the gate, deliberately, because an exclusion by name
     * pattern would be a guess about every future SKU and `DEC` is three letters
     * that a real species abbreviation could carry. It only means nobody has to
     * REMEMBER the list exists.
     *
     * ⚠️ Scoped to the full ARCH_SCOPE_SQL rather than the subsidiary arm alone.
     * A new decking SKU tagged department Hardwood leaks exactly as easily, and
     * reusing the constant means this cannot drift away from what the real
     * queries match. Expected result: zero rows.
     */
    const DECKING_LEAK_SQL =
        'SELECT i.itemid FROM item i ' +
        'WHERE ' + ARCH_SCOPE_SQL + ' ' +
        '  AND i.itemid NOT IN (' + NON_ARCH_ITEMS_SQL + ') ' +
        "  AND UPPER(i.itemid) LIKE '%DEC%'";

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
     * ⚠️ 2026-09-10: this used to filter on `cseg_subsidiary_loc`, which did
     * double duty — scoped to hardwood AND removed the CA-E and TAXQC lines
     * that user events add to every order, since those items carried no
     * segment. The `department = "Hardwood"` filter below does the same second job by
     * construction, not by accident: every one of the 149 Department 11 items
     * is `itemtype = 'Assembly'`, measured with zero exceptions, and a
     * currency-adjustment or tax charge line is never that type. If that ever
     * stops being true, it will show up loudly as a nonsense row on the grid,
     * not silently as a miscounted total.
     */
    const BUCKET_SQL =
        'SELECT ' +
        '  tl.item                AS itemid, ' +
        '  tl.location            AS locationid, ' +
        /* The location's NAME, added 2026-09-09. An item/location pair that has a
         * bucket but NO on-hand lot never appears in LOT_SQL, so it has no other
         * source for its own location name. See the orphan-recovery block in
         * getInputData: without this the recovered row would render a blank
         * location, and KNOWN_LOCATIONS covers only three ids. */
        '  BUILTIN.DF(tl.location) AS locationname, ' +
        '  t.type                 AS trantype, ' +
        '  t.id                   AS tranid, ' +
        // The line's OWN id, which is what inventoryassignment points at —
        // see the join below. Also the dedupe key, so a line that fans out
        // over several lots is still counted once in the row totals.
        '  tl.id                  AS lineno, ' +
        '  tl.quantity            AS qty, ' +
        '  tl.quantityshiprecv    AS shiprecv, ' +
        '  tl.quantitybilled      AS billed, ' +
        /* ── WHICH ORDER, added 2026-09-08 ────────────────────────────────────
         * Five header columns on a query that was ALREADY reading this exact row
         * for its quantity. They cost no extra query, no extra join and no extra
         * row: the fan-out is unchanged and the line-level dedupe below is
         * unchanged. That is the whole reason the order attribution lives here
         * rather than in a second read.
         *
         * ⚠️ `docno`, NOT `tranid`. `t.id` is already aliased `tranid` above (it
         * is the join key for inventoryassignment and half the dedupe key), so
         * the DOCUMENT number — "SO-CWP-001344" — has to take a different name.
         * Selecting `t.tranid AS tranid` here would silently overwrite the
         * internal id with a string and break the assignment attribution.
         *
         * `t.shipdate` is the NATIVE field and it IS populated: 6 of 6 open ARCH
         * sales-order lines carry one (2026-09-08). custbody_mgsl_expectedshipdate
         * does NOT exist on the record despite being selectable, so do not reach
         * for it — see the same note in trader_screen_service_arch.js.
         *
         * `t.employee` is the HEADER Sales Rep and is NULL on every ARCH order,
         * measured. It is read anyway, as the second rung of the same fallback the
         * open-orders service uses, so that the two cannot disagree if MGSL ever
         * turn Team Selling off. */
        '  t.tranid               AS docno, ' +
        /* ── THE ETA, and it is a REAL field, added 2026-09-17 ────────────────
         * `custbody_ship_week` is what MTL and IND already display in their own
         * In Transit and On Order drawers (DetailDrawerMTL.tsx, DetailDrawer.tsx),
         * so this is the house convention rather than a new idea.
         *
         * ⚠️ IT IS NOT `expectedreceiptdate` OR `duedate`. Both were checked on
         * 2026-09-16 and both are empty on all 37 hardwood PO lines and all 13
         * hardwood POs, which is how an earlier read of this concluded there was
         * no ETA source at all and recommended shipping without one. Wrong field.
         * Measured 2026-09-17: every open hardwood PO carrying bundles has a ship
         * week, and so do 377 of 377 open production POs.
         *
         * Header-grain, like take ownership. One PO is one packing list is one
         * container in Marc-Antoine's flow, so every bundle on the PO shares it. */
        '  t.custbody_ship_week   AS shipweek, ' +
        '  t.trandate             AS trandate, ' +
        '  t.shipdate             AS shipdate, ' +
        '  t.entity               AS custid, ' +
        '  BUILTIN.DF(t.entity)   AS customer, ' +
        '  t.employee             AS hdrrepid, ' +
        '  BUILTIN.DF(t.employee) AS hdrrep, ' +
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
        'WHERE ' + ARCH_SCOPE_SQL + ' ' +
        '  AND i.itemid NOT IN (' + NON_ARCH_ITEMS_SQL + ') ' +
        "  AND tl.mainline = 'F' " +
        "  AND tl.isclosed = 'F' " +
        "  AND t.type IN ('SalesOrd', 'PurchOrd')";


    /**
     * Reads BUCKET_SQL and folds it into per-(item, location) figures.
     *
     * Returns, keyed `itemId__locationId`:
     *   { reserve, outbound, onOrder, inTransit,       // row totals, BASE units
     *     lots: { lotNo: {reserve, outbound, onOrder, inTransit,
     *                     orders: { tranId: {...} } } },
     *     unattributed: { ...same four... } }          // no lot assignment
     *
     * ── `orders`: WHICH sales order holds the bundle ──────────────────────────
     * Added 2026-09-08. Until then the per-lot figure was a committed QUANTITY
     * with nothing about the order behind it, and the Reserved panel filled its
     * SO #, date, customer and trader columns from a SEEDED GENERATOR
     * (`lotAllocation` in lib/archFixtures.ts). A trader would read an SO number
     * and a customer name off that panel and believe them.
     *
     * The link is not new information: BUCKET_SQL has always joined
     * `inventoryassignment` to the order LINE that names the lot — that join is
     * what tied SO-CWP-001346 to lot 315643-7 during the phantom-reservation fix
     * on the same day. All that was missing was carrying the order's identity
     * through instead of discarding it.
     *
     * 🔴 KEYED BY TRANSACTION, BECAUSE A BUNDLE CAN BE HELD BY MORE THAN ONE
     * ORDER, and this is measured, not defensive. Right now, in this sandbox,
     * 31 inventory numbers sit on an open unshipped line of TWO OR MORE sales
     * orders at once, the worst at 17 orders on one lot ("CWP ANTE - 813-4"), and
     * 199 lots have been assigned across more than one sales order over their
     * lifetime. None of those are hardwood TODAY, so ARCH has not met the case
     * yet — but the shape is real in this account and picking one order would
     * eventually print one customer's name over another's reservation.
     *
     * So every order that contributes reserve to a bundle is recorded, with the
     * quantity IT contributes, and the front end lists them all. The shares sum
     * to the bundle's `reserve` by construction: they are accumulated from the
     * same expression, under the same guard.
     *
     * Only SALES orders. A purchase order's assignment feeds `onOrder`, and there
     * is no panel column asking who the supplier is on it (the PO number already
     * comes from the lot-number prefix), so recording it would be shape without a
     * consumer.
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
        const blank = () => ({ reserve: 0, outbound: 0, onOrder: 0, inTransit: 0, readyToBuild: 0 });

        let rows;
        try {
            rows = query.runSuiteQL({
                query: BUCKET_SQL,
                params: ARCH_SCOPE_PARAMS,
            }).asMappedResults();
        } catch (e) {
            // Buckets missing is bad; On Hand being wrong is worse. Return empty
            // and let the run continue with the buckets at zero, loudly.
            log.error('ARCH cache buckets — COULD NOT LOAD, all four buckets will read 0',
                e.name + ': ' + e.message);
            return {};
        }

        /* ── Ready to Build, a SEPARATE query over the SO ids this run already
         * found ─────────────────────────────────────────────────────────────
         *
         * Same shape as `repByTransaction` below: one query for the whole run,
         * scoped to the ids BUCKET_SQL already returned, never joined into
         * BUCKET_SQL itself — joining a header field onto a query that fans out
         * per line and per lot assignment would not change any total (a header
         * value is identical on every fanned-out row), but it is still the
         * wrong shape to add a header-only read to.
         *
         * Read BEFORE the fold below, not after: the fold has to know the flag
         * to decide reserve vs readyToBuild while it sums, and patching a
         * classification in after the fact would mean walking every bucket and
         * every lot a second time to move quantity between the two keys.
         *
         * ⚠️ `custbody_arch_ready_to_build` EXISTS. Corrected 2026-09-15: it is
         * internal id 14083, created in sandbox 2026-09-11, and 3 sales orders
         * already carry it set. The "DOES NOT EXIST YET" that stood here was
         * true when written and is now simply wrong, which is worth more than a
         * tidy-up: the next reader would have concluded the whole branch was
         * dead. Production is still a different story, since it has no Hardwood
         * department at all.
         *
         * The isolation below stays regardless, and NOT because the field might
         * be missing. It is DELIBERATELY kept out of BUCKET_SQL as a column
         * to BUCKET_SQL itself: SuiteQL fails an entire query on an unknown
         * column, and BUCKET_SQL feeds On Hand, Reserved, Outbound, On Order
         * and In Transit too. Adding it there would take down all five buckets
         * the moment this deploys, not just the one that is not sourced yet.
         * This way, an absent field degrades to exactly today's behaviour —
         * every open line stays in `reserve` — and the day the field is
         * created, the NEXT hourly run picks it up with no further deploy.
         */
        const soIdsForFlag = [];
        const seenSoId = {};
        rows.forEach((r) => {
            // Numbers, not strings: these go straight into `params` below, and
            // the id is the dedupe key either way (object keys stringify).
            const id = parseInt(r.tranid, 10);
            if (String(r.trantype) !== 'SalesOrd') return;
            if (id > 0 && !seenSoId[id]) { seenSoId[id] = true; soIdsForFlag.push(id); }
        });
        /*
         * CHUNKED at 500, changed 2026-09-13. This comment used to argue the
         * opposite — that the list is "already bounded by BUCKET_SQL's own scope
         * (open hardwood SO lines only), currently a few dozen orders
         * account-wide" — and that bound is the thing about to move: 169 items
         * carry the Hardwood department today against the six that carried the
         * old segment, with ~200 SKUs planned and traders starting.
         *
         * ⚠️ NOT because of a 1,000-expression cap. That claim was written here
         * on 2026-09-13 and MEASURED FALSE the next day: against this account's
         * SuiteQL endpoint, `WHERE id IN (...)` with 999, 1,005, 5,000, 20,000
         * and 50,000 literal ids all returned OK. NetSuite compiles SuiteQL
         * rather than passing it to Oracle verbatim, so the familiar limit does
         * not apply as stated. `archSalesTeam.js` carried the same belief and
         * has been corrected too. Two things that test did NOT settle, so do not
         * read it as more than it is: it ran against REST SuiteQL, a different
         * dialect and host from the `N/query` that actually runs here, and it
         * used inline literals rather than the `?` binds below.
         *
         * The chunking stays, on the reasons that survive measurement:
         *   - BLAST RADIUS. The catch below is a deliberate silent degrade, so
         *     one failing query means "Ready to Build reads zero everywhere"
         *     with nothing naming the cause. Chunking bounds what one failure
         *     can cost and makes the loop able to report which part failed.
         *   - CONSISTENCY with the two sibling reads of this same id list
         *     (`archSalesTeam.repByTransaction`, and the open-orders service),
         *     both chunked at 500.
         *
         * ⚠️ ALL OR NOTHING on a failed chunk, which is the OPPOSITE of the
         * partial-keeping loops in `archSalesTeam.repByTransaction` and in the
         * open-orders service, and deliberately so. Those resolve a DISPLAY
         * value per row, so a name resolved is still a name. This one decides
         * whether quantity is folded into `reserve` or into `readyToBuild`: a
         * half-read map splits two buckets the screen presents as measured,
         * while `readyToBuildSourced` — one boolean feeding META's
         * bucketsBuilt/bucketsEmpty — has no way to say "half". Sourced has to
         * mean sourced, so a single failed chunk unsources the whole run.
         */
        const FLAG_CHUNK = 500;
        let readyToBuildIds = {};
        for (let i = 0; i < soIdsForFlag.length; i += FLAG_CHUNK) {
            const slice = soIdsForFlag.slice(i, i + FLAG_CHUNK);
            try {
                const flagRows = query.runSuiteQL({
                    query: 'SELECT id AS tranid FROM transaction ' +
                           'WHERE id IN (' + slice.map(() => '?').join(',') + ') ' +
                           "  AND custbody_arch_ready_to_build = 'T'",
                    params: slice,
                }).asMappedResults();
                flagRows.forEach((r) => { readyToBuildIds[String(r.tranid)] = true; });
            } catch (e) {
                // Same degrade as everywhere else this field is touched: absence
                // is not an error, it is "nobody has been asked to create it
                // yet". Every order falls back to `reserve`, exactly today's
                // behaviour, and META is told so this run did not source it.
                readyToBuildSourced = false;
                readyToBuildIds = {};
                log.audit('ARCH cache — Ready to Build field not readable (non-fatal, ' +
                    'every order stays in Reserved): ' + (e.name || '') + ': ' +
                    (e.message || String(e)));
                break;
            }
        }

        rows.forEach((r) => {
            const key = String(r.itemid) + '__' + String(r.locationid);
            if (!byPair[key]) {
                byPair[key] = {
                    totals: blank(), lots: {}, unattributed: blank(),
                    // Carried so a pair with NO on-hand lot can still name itself.
                    itemId: String(r.itemid),
                    locationId: String(r.locationid),
                    locationName: r.locationname || '',
                };
            }
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
                    // Sold, and either still in the building (reserve) or the
                    // trader has marked the whole order ready to build. The two
                    // are mutually exclusive by construction: `readyToBuildIds`
                    // decides which ONE bucket this line's open quantity lands
                    // in, never both, so the sum against `reserve + readyToBuild`
                    // matches what `reserve` alone used to carry.
                    if (readyToBuildIds[String(r.tranid)]) {
                        bucket.totals.readyToBuild += open;
                    } else {
                        bucket.totals.reserve += open;
                    }
                    // Already gone out the door.
                    bucket.totals.outbound += moved;
                } else {
                    /*
                     * 🔴 ON ORDER AND IN TRANSIT ARE DISJOINT. Corrected 2026-09-09.
                     *
                     * They used to be NESTED, and `available` adds both, so the same
                     * wood could be counted twice. `onOrder` was the whole open
                     * quantity while `inTransit` was the billed-not-received part of
                     * that same quantity: algebraically inTransit <= onOrder for every
                     * input, and EQUAL as soon as billed >= ordered. So a purchase
                     * order billed ahead of receipt booked its full quantity into both
                     * buckets and inflated Available by that amount.
                     *
                     * Latent rather than live when found: all six hardwood PO lines
                     * read quantitybilled 0, so inTransit was 0 everywhere and nothing
                     * doubled. It would have appeared the first time a supplier
                     * invoiced before delivering, which for imported hardwood on the
                     * water is the normal case, not an exotic one.
                     *
                     * Now: `water` is the billed-not-received part, and `onOrder` is
                     * what is left of the open quantity. The two sum to `open` by
                     * construction, which is the invariant the grid's arithmetic wants.
                     */
                    const water = Math.max(0, Math.min(billed, ordered) - moved);
                    // Billed but not received — it is on the water.
                    bucket.totals.inTransit += water;
                    // Ordered from a supplier and not yet on the water.
                    bucket.totals.onOrder += Math.max(0, open - water);
                }
            }

            /* ── Lot attribution, only where an assignment exists ─────────────
             *
             * 🔴 ONLY THE OPEN SHARE OF THE LINE REACHES THE LOT.
             *
             * An inventoryassignment row lives on the ORDER and never moves: it
             * still says "300 BF of lot 315643-7" long after that 300 BF has
             * shipped. The line-level split above already knows the difference —
             * `open` is still in the building, `moved` has gone — and until
             * 2026-09-08 this block threw that away and booked the WHOLE
             * assignment as the lot's `reserve`.
             *
             * Measured in sandbox on 2026-09-08. SO-CWP-001346 ordered 300 BF of
             * PUR44KD from lot 315643-7, fulfilled it on IF1208 and billed it on
             * INV-CWP-1236 (status G). The row was correct — reserve 0, outbound
             * 300 — while the LOT carried reserve 300, and the same 300 BF was
             * simultaneously reported as `unattributed.outbound`. Downstream that
             * one number:
             *   · put a "Res. 300 BF" note and a Rsvd badge on a bundle no order
             *     holds, on a row whose Reserved column correctly read 0;
             *   · listed the bundle a second time in the Reserved panel;
             *   · locked all 211 remaining BF out of selling (`isLotLocked`),
             *     which NetSuite itself reports as 211 available.
             * That is Lucas's report, and it cannot be fixed in the browser: the
             * front end has no way to tell a real reservation from this one.
             *
             * The shipped share is deliberately booked to NO lot rather than to
             * `lots[..].outbound`. It is not on the lot any more — IA-CWP-362 put
             * 511 BF into 315643-7, IF1208 took 300 out, and `storedQty` reads
             * the resulting 211 — so recording it against the bundle would count
             * the same wood twice and, because `commitmentOn` treats outbound as a
             * commitment, would keep the bundle locked under a different label.
             * The row still reports it in `outbound`, which is where shipment
             * history belongs.
             *
             * The purchase-order branch is split the same way for the same
             * reason: a received PO line's assignment describes stock that is now
             * ON HAND, so leaving it whole would report received wood as still on
             * order. No hardwood PO is part-received today (every open line reads
             * quantityshiprecv 0), so this is the latent half of one defect, not
             * a second one.
             */
            const assigned  = Math.abs(num(r.assignedqty));
            // Proportional, because an assignment carries no ship state of its
            // own. A fully shipped line gives 0, an untouched line gives 1, and a
            // half-shipped line splits — the only reading available from what
            // NetSuite exposes here.
            const openShare = ordered > 0 ? open / ordered : 0;
            if (r.lotno && assigned > 0 && openShare > 0) {
                if (!bucket.lots[r.lotno]) bucket.lots[r.lotno] = blank();
                if (isSale) {
                    // Same either/or split as the line-level totals above, on
                    // the same order id, so a lot's readyToBuild + reserve never
                    // disagrees with the row's.
                    if (readyToBuildIds[String(r.tranid)]) {
                        bucket.lots[r.lotno].readyToBuild += assigned * openShare;
                    } else {
                        bucket.lots[r.lotno].reserve += assigned * openShare;
                    }
                } else {
                    bucket.lots[r.lotno].onOrder += assigned * openShare;
                    /* ── WHERE IT IS COMING FROM AND WHEN, added 2026-09-17 ───
                     *
                     * Marc-Antoine, 2026-09-17: « On order : aucun PO n'apparaît.
                     * Il faudrait présenter l'information. » The drill-down had
                     * nothing to present partly because the lot universe excluded
                     * these bundles (see LOT_SQL) and partly because the only
                     * supplier and ETA the table had were invented in the browser
                     * by `lotIncomingInfo`, a seeded PRNG in archFixtures.ts.
                     *
                     * Both values are already on this row. `custid`/`customer` is
                     * `t.entity`, which on a PURCHASE order is the VENDOR — the
                     * alias is named for the sales-order case that needed it
                     * first and is not wrong here, just badly named. So this
                     * costs no extra query, no extra join and no extra row.
                     *
                     * LAST WRITE WINS, and that is deliberate rather than
                     * accidental: a bundle appearing on two open PO lines is not
                     * a case that exists (measured 2026-09-17, every hardwood
                     * bundle sits on exactly one), and if it ever did, either
                     * answer is honest and neither is worth a tiebreak rule
                     * nobody can verify. */
                    bucket.lots[r.lotno].incoming = {
                        poNumber: String(r.docno || ''),
                        supplier: String(r.customer || ''),
                        // ISO, or empty. The browser must not be handed a NetSuite
                        // date string to parse — `isoDate` is the one place this
                        // file converts, and it already handles the null.
                        eta:      isoDate(r.shipweek) || '',
                    };
                }

                /* ── WHICH order, under the SAME guard as the quantity ────────
                 *
                 * Inside this `if`, deliberately. A bundle must never name an
                 * order that contributes nothing to its reserve: that is exactly
                 * the phantom SO-CWP-001346 / lot 315643-7 defect one field
                 * along. A fully shipped line has openShare 0, so it reaches
                 * neither the quantity nor the attribution.
                 *
                 * Accumulated per TRANSACTION, not per line: one order can carry
                 * two lines that both assign the same bundle, and the panel wants
                 * one row per order with the combined share, not two rows for one
                 * SO number.
                 */
                if (isSale) {
                    const lotRec = bucket.lots[r.lotno];
                    if (!lotRec.orders) lotRec.orders = {};
                    const oid = String(r.tranid);
                    if (!lotRec.orders[oid]) {
                        lotRec.orders[oid] = {
                            tranId:     oid,
                            soNumber:   String(r.docno || ''),
                            customerId: r.custid ? String(r.custid) : '',
                            customer:   String(r.customer || ''),
                            created:    isoDate(r.trandate),
                            shipDate:   isoDate(r.shipdate),
                            // The HEADER Sales Rep, which is null on every ARCH
                            // order. The sublist read below overwrites it where
                            // it resolves; this is the second rung, not the first.
                            repId:      r.hdrrepid ? String(r.hdrrepid) : '',
                            rep:        String(r.hdrrep || ''),
                            repSource:  r.hdrrepid ? 'header' : 'none',
                            /* WHICH BUCKET THIS ORDER'S SHARE LANDED IN. Added
                             * 2026-09-14, and it is what lets the drawer name an
                             * order under Ready to Build at all.
                             *
                             * 🔴 Without it the client CANNOT tell the two apart.
                             * `qty` below accumulates the order's share of this
                             * bundle, and a bundle can be claimed by a Reserved
                             * order AND a Ready-to-Build one at the same time —
                             * 31 lots in this sandbox are held by two or more
                             * orders, one in 17. So `archLotOrders.ts` reading
                             * `orders` for both buckets was tried on 2026-09-10
                             * and reverted the same day: it showed the same list
                             * and the same qty under both tabs, which is worse
                             * than an honest em dash.
                             *
                             * Stamped from the SAME `readyToBuildIds` map that
                             * decided the quantity a few lines up, so the
                             * attribution and the number can never disagree.
                             *
                             * Per TRANSACTION, which is the right grain: the flag
                             * is a header field, so every line of one order shares
                             * it and there is no per-line case to worry about. */
                            readyToBuild: !!readyToBuildIds[oid],
                            // BASE units, converted in reduce with the same
                            // `/ rate` every other quantity goes through.
                            qty:        0,
                        };
                    }
                    lotRec.orders[oid].qty += assigned * openShare;
                }
            }
        });

        /* ── WHO the order belongs to: ONE query for the whole run ────────────
         *
         * After the fold, not inside it. `repByTransaction` chunks an IN list at
         * 500 ids and exactly ONE open hardwood order holds a bundle today, so
         * this is a single cheap read — but it must never become one read per
         * row, which is what calling it from `reduce` would do.
         *
         * It is NOT joined into BUCKET_SQL, and that is the same trap
         * archSalesTeam.js documents: BUCKET_SQL already fans out per lot
         * assignment, so joining a two-rep order's sublist would multiply its
         * lines by two and DOUBLE the row totals. Measured on SO-CWP-001352
         * during the 2026-09-08 audit. A separate read is the fix, not a
         * preference.
         *
         * A failure here costs the trader NAME and nothing else: the panel still
         * shows a real SO number, customer and date, and the trader cell renders
         * as unresolved rather than as a guess.
         */
        const soIds = {};
        Object.keys(byPair).forEach((k) => {
            const lots = byPair[k].lots;
            Object.keys(lots).forEach((lotNo) => {
                const ords = lots[lotNo].orders;
                if (ords) Object.keys(ords).forEach((oid) => { soIds[oid] = true; });
            });
        });
        const orderIds = Object.keys(soIds);
        if (orderIds.length) {
            let reps = {};
            try {
                reps = ArchSalesTeam.repByTransaction(orderIds) || {};
            } catch (e) {
                // ERROR, not audit: the Reserved panel silently loses every
                // trader name, and an hourly audit line once hid a four-day
                // outage on this exact screen.
                log.error('ARCH cache — SALES TEAM UNREADABLE, the Reserved panel will name no trader',
                    orderIds.length + ' order(s): ' + (e.name || '') + ': ' + (e.message || String(e)));
            }
            let resolved = 0;
            Object.keys(byPair).forEach((k) => {
                const lots = byPair[k].lots;
                Object.keys(lots).forEach((lotNo) => {
                    const ords = lots[lotNo].orders;
                    if (!ords) return;
                    Object.keys(ords).forEach((oid) => {
                        const pick = reps[oid];
                        if (!pick || !pick.repId) return;
                        const o = ords[oid];
                        o.repId           = String(pick.repId);
                        o.rep             = String(pick.rep || '');
                        o.repSource       = 'salesTeam';
                        // Carried, not resolved away. A 50/50 order really has two
                        // owners; the panel says so rather than printing one name
                        // as if it were the whole answer.
                        o.repShared       = !!pick.shared;
                        o.repTied         = !!pick.tied;
                        o.repNameUnreadable = !!pick.nameUnreadable;
                        resolved++;
                    });
                });
            });
            log.audit('ARCH cache reserved-order attribution',
                orderIds.length + ' open sales order(s) hold hardwood bundles; ' +
                resolved + ' bundle-order pair(s) carry a Sales Team rep.');
        }

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
                params: ARCH_SCOPE_PARAMS,
            }).asMappedResults();

            // Early warning for ARCH-shaped SKUs outside Department 11 — see UNTAGGED_SQL.
            try {
                const untagged = query.runSuiteQL({
                    query: UNTAGGED_SQL,
                    params: EXCLUDED_UNITS_TYPES.concat(ARCH_SCOPE_PARAMS),
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
                     *
                     * ⚠️ The "2,294" above is history, not current. It was the
                     * segment-vs-heuristic gap, measured before the 2026-09-10
                     * switch to Department 11. Under the department scope this
                     * query measures 0 today — the near-permanent standing
                     * warning this comment justified downgrading is not
                     * expected to fire routinely anymore. If it does start
                     * firing often, that is itself a signal something is off,
                     * not the account's normal state anymore.
                     */
                    log.audit('ARCH cache — POSSIBLE MISCATEGORIZED HARDWOOD, invisible to this screen',
                        untagged.length + ' item(s) carry an ARCH-shaped units type but sit outside ' +
                        'Department 11 (Hardwood), so their stock does NOT appear: ' +
                        untagged.map((r) => r.itemid).join(', ') +
                        '. Set Department = Hardwood on them, or confirm they are not hardwood.');

                    /* 🔴 CARRIED TO META, added 2026-09-10, and the reason is a real
                     * client report rather than tidiness.
                     *
                     * Marc-Antoine added bundles in sandbox on 2026-09-09 and asked the
                     * next morning: "Le TS ne semble pas s'etre mis a jour. Pourtant le
                     * MR semble avoir roule. Est-ce que je dois trigger autre chose
                     * manuellement?" He was right on both counts. The MR had run, the
                     * cache was fresh, nothing needed triggering, and his stock was
                     * nowhere: his lots were on CAN44KD, CAN84KD and SAP44FCKD, three
                     * of the items named in the very audit line above.
                     *
                     * This block has known that all along and told nobody who could act
                     * on it. The execution log is not a place a trader looks. So the
                     * count and a sample of names now reach META, where the screen can
                     * say "your stock is not missing, it is untagged" instead of
                     * silently rendering the same rows as yesterday.
                     *
                     * The SAMPLE is capped deliberately: this list runs to 143 names in
                     * sandbox today and META is read on every page load. The full list
                     * stays in the audit line above, which is the right place for it. */
                    untaggedItems = untagged.map((r) => r.itemid);
                }
            } catch (e) {
                log.audit('ARCH cache', 'Untagged-hardwood check failed (non-fatal): ' + e.message);
            }

            /*
             * Tripwire for a decking SKU that has entered scope without being on
             * the exclusion list — see DECKING_LEAK_SQL for why this exists and
             * why it warns rather than excludes.
             *
             * AUDIT, not ERROR, for the same reason as its sibling above: once it
             * fires it will fire on EVERY rebuild until someone edits the list,
             * and at 96 rebuilds a day an error-level standing condition is the
             * thing that trains people to ignore the error channel. The
             * difference from the sibling is that this one is expected to be zero
             * forever, so if it appears at all it is worth acting on rather than
             * a known state of the account.
             *
             * Its own try/catch: a failure here must not cost the rebuild, and
             * must not be mistaken for the untagged check failing.
             */
            try {
                const leaked = query.runSuiteQL({
                    query: DECKING_LEAK_SQL,
                    params: ARCH_SCOPE_PARAMS,
                }).asMappedResults();
                if (leaked.length) {
                    log.audit('ARCH cache — POSSIBLE NON-HARDWOOD ON THIS SCREEN',
                        leaked.length + ' item(s) in ARCH scope look like decking by name but are ' +
                        'NOT in NON_ARCH_DEPARTMENT_ITEMS, so their stock IS being shown and can be ' +
                        'sold from this screen: ' + leaked.map((r) => r.itemid).join(', ') +
                        '. Decking is a different product line sold by the linear foot, not in board ' +
                        'feet. Add them to NON_ARCH_DEPARTMENT_ITEMS in this file, or confirm they ' +
                        'really are hardwood.');
                }
            } catch (e) {
                log.audit('ARCH cache', 'Decking-leak check failed (non-fatal): ' + e.message);
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
                        // Carried per pair only so it can cross into `summarize`.
                        // See `readyToBuildSourced`.
                        rtbSourced:   readyToBuildSourced,
                        lots:         [],
                    };
                }
                byPair[key].lots.push({
                    lotId:     String(r.lotid),
                    lotNo:     r.lotno || '',
                    storedQty: num(r.storedqty),
                });
            });

            /*
             * ── 🔴 PAIRS THAT HAVE A BUCKET BUT NO ON-HAND LOT ────────────────────
             *
             * ⚠️ READ THE DATES: this block was written on 2026-09-09 against a
             * LOT_SQL that no longer exists, and it is now a BACKSTOP rather than
             * the route that carries incoming stock to the screen. On 2026-09-17
             * that WHERE clause was widened to admit rows that are zero on hand
             * but non-zero on order or in transit, so the pairs described below
             * mostly arrive with real lots attached now. Kept because it still
             * covers the case this cannot: a bucket key whose lot rows are zero in
             * all three columns, which LOT_SQL correctly excludes (42 such rows
             * measured 2026-09-17). See the note on LOT_SQL for the other half.
             *
             * Added 2026-09-09. `byPair` above is built ONLY from LOT_SQL, whose WHERE
             * ended `AND inl.quantityonhand <> 0` at the time. `buckets` is keyed on the same
             * itemId__locationId string but is read as a lookup, so any bucket key with
             * no on-hand lot produced NO ROW AT ALL: no On Order, no In Transit, no
             * unattributed, and not one line in the log. Stock on order simply was not
             * on the screen.
             *
             * Measured when found: key 2912__108, PUR44KD at Ambassador Services
             * International, carrying 600 BF on PO-CWP-001325. The grid's On Order read
             * 8,350 BF while NetSuite's open hardwood PO lines totalled 8,950. That is
             * the whole discrepancy, and it is the NORMAL state for a first delivery to
             * a location: nothing is on hand there yet, which is exactly when a trader
             * most wants to see what is coming.
             *
             * ITEM-LEVEL metadata is adopted from any pair that already carries the
             * same itemId, because itemCode, description, species, category, thickness,
             * unit and RATE are properties of the ITEM, not of the location. The rate is
             * the one that matters: it is load-bearing (Lumber is 0.001, and defaulting
             * it to 1 is wrong by three orders of magnitude), so it is copied from a
             * real row and never invented.
             *
             * With NO donor there is nothing safe to do: the row cannot be built without
             * a rate, and guessing one is the failure this file already refuses
             * elsewhere. It is logged at ERROR and skipped, which is at least visible.
             */
            const bucketKeys = Object.keys(buckets);
            const donorFor = (itemId) => {
                const k = Object.keys(byPair).find((x) => byPair[x].itemId === itemId);
                return k ? byPair[k] : null;
            };
            const recovered = [];
            const unrecoverable = [];
            bucketKeys.forEach((key) => {
                if (byPair[key]) return;
                const b = buckets[key] || {};
                const itemId = String(b.itemId || String(key).split('__')[0]);
                const donor = donorFor(itemId);
                const t = b.totals || {};
                const carried = (num(t.onOrder) || 0) + (num(t.inTransit) || 0) +
                                (num(t.reserve) || 0) + (num(t.outbound) || 0);
                if (!donor) {
                    unrecoverable.push(key + ' (' + carried.toFixed(3) + ' stored units)');
                    return;
                }
                byPair[key] = {
                    itemId:       itemId,
                    itemCode:     donor.itemCode,
                    description:  donor.description,
                    species:      donor.species,
                    category:     donor.category,
                    thickness:    donor.thickness,
                    unit:         donor.unit,
                    rate:         donor.rate,
                    locationId:   String(b.locationId || String(key).split('__')[1]),
                    locationName: b.locationName || KNOWN_LOCATIONS[String(b.locationId)] || '',
                    holds:        holds[key] || {},
                    buckets:      buckets[key],
                    // Same carrier as the pair above. A donor-recovered pair
                    // reaches `summarize` by the same route and must not be the
                    // row that reports the run as sourced when it was not.
                    rtbSourced:   readyToBuildSourced,
                    // No on-hand lot exists at this location. An EMPTY array, not a
                    // fabricated lot: the drill-down correctly shows nothing on hand,
                    // and bucketGap on the front end names the quantity no bundle claims.
                    lots:         [],
                };
                recovered.push(byPair[key].itemCode + ' @ ' + (byPair[key].locationName || key));
            });
            if (recovered.length) {
                recoveredCount = recovered.length;

                // ── Level by CAUSE, same rule as `rateless` below and the shrink
                // guard. ⚠️ CORRECTED 2026-09-10: this was unconditional log.error,
                // on the reasoning that these rows were missing until 2026-09-09 and
                // an audit line on an hourly job is how a four-day outage hid here
                // once before. That reasoning covers the FIRST occurrence, not every
                // one after it — measured 2026-09-10: 19 consecutive hourly runs since
                // 2026-09-09 04:25 logged the IDENTICAL pair (PUR44KD @ Ambassador
                // Services International) at error, because this condition does not
                // change hour to hour once the item's tagging/data is what it is. That
                // is the exact per-run-condition-at-error-level pattern the untagged-
                // items note above already fixed; it was missed here.
                //
                // First occurrence is an error because it is news. Once META already
                // records a non-zero recoveredCount it is a known condition, so it
                // drops to audit. The count and the pair list stay in the log either
                // way, so nothing is hidden from the screen.
                //
                // ⚠️ THIS LATCH IS UNPROVEN END TO END, per adversarial review
                // 2026-09-10. It depends on `recoveredCount` (a module-scope variable
                // set here, in getInputData) surviving as live state into summarize,
                // hundreds of lines below, which is where it is actually written to
                // META. The file's own comment on `skippedLots` above already admits
                // this is not guaranteed across Map/Reduce STAGES. That sibling
                // mechanism (skippedLotCount, the "no conversion rate" line) is the
                // ESTABLISHED CONVENTION this fix mirrors — and a live query
                // (`SELECT COUNT(*) FROM scriptnote WHERE title LIKE '%no conversion
                // rate%'`) returns ZERO rows in this account's entire history. So the
                // exact mechanism being relied on here has never once been observed to
                // actually latch in production. Before trusting this: let the
                // condition fire on two consecutive real hourly runs and confirm via
                // scriptnote that the SECOND run logs AUDIT, not ERROR. If it does
                // not, module state is not surviving and this needs a mechanism
                // Map/Reduce actually guarantees (e.g. summarize deriving the count
                // itself from its own aggregated rows, rather than trusting a
                // getInputData-scoped variable).
                let alreadyReported = false;
                try {
                    const metaRaw = CacheClient.getCache().get({ key: CacheKeys.META });
                    if (metaRaw) alreadyReported = (JSON.parse(metaRaw).recoveredCount || 0) > 0;
                } catch (e) { /* unknown — treat as news and log loudly */ }

                const logRecovered = alreadyReported ? log.audit : log.error;
                logRecovered('ARCH cache — recovered ' + recovered.length + ' pair(s) that have stock ' +
                    'on order or reserved but nothing on hand',
                    'These produced NO grid row at all before 2026-09-09: ' + recovered.join('; ') +
                    '. Their quantities were absent from On Order and In Transit.' +
                    (alreadyReported ? ' (STILL RECOVERING — first occurrence already logged at error level.)' : ''));
            }
            if (unrecoverable.length) {
                unrecoverableCount = unrecoverable.length;

                /* Same latch as `recovered` above, applied 2026-09-10 for the same
                 * reason and with one honest difference: this block has NEVER fired.
                 * A live query for its title returns zero rows in this account's whole
                 * history, so unlike `recovered` (21 identical ERROR notes and
                 * counting) there is no measured spam to fix here.
                 *
                 * It is latched anyway, deliberately, because the CONDITION is the same
                 * standing kind: an item with a bucket but no donor row anywhere is an
                 * untagged item, and that does not heal itself hour to hour any more
                 * than recovered's did. Leaving one of two adjacent, identically-shaped
                 * blocks unlatched is precisely the asymmetry that produced the
                 * original bug - the untagged-items block above was fixed on 2026-08-25
                 * and this family was missed. Since it has never fired, adding the
                 * latch cannot change any behaviour anyone has observed; it is
                 * insurance, not a fix, and it is recorded as such. */
                let alreadyReported = false;
                try {
                    const metaRaw = CacheClient.getCache().get({ key: CacheKeys.META });
                    if (metaRaw) alreadyReported = (JSON.parse(metaRaw).unrecoverableCount || 0) > 0;
                } catch (e) { /* unknown — treat as news and log loudly */ }

                const logUnrecoverable = alreadyReported ? log.audit : log.error;
                logUnrecoverable('ARCH cache — pair(s) with a bucket but NO on-hand lot and NO donor row',
                    'Skipped because the item appears nowhere else, so its stock-unit rate could ' +
                    'not be read and inventing one would be wrong by three orders of magnitude for ' +
                    'Lumber: ' + unrecoverable.join('; ') + '. These quantities are missing from ' +
                    'the grid. Fix by tagging the item or by giving BUCKET_SQL the item columns.' +
                    (alreadyReported ? ' (STILL SKIPPING — first occurrence already logged at error level.)' : ''));
            }

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
            // One query per pair, same shape as loadLotCosts. See loadTallies.
            const tallies  = loadTallies();
            // Same one-query-per-run shape as loadTallies. See loadSplitEvents.
            const splits   = loadSplitEvents();

            const lots = pair.lots.map((l) => {
                const lotKey = String(l.lotNo || '').trim().toUpperCase();
                const tally  = tallies[lotKey] || null;

                /* ── CAN THIS LOT'S TALLY STILL BE TRUSTED? ─────────────────────
                 *
                 * Three outcomes, genuinely different things:
                 *
                 *   null          no split on record. Ordinary lot.
                 *   'staleParent' the lot WAS split and a tally names it, but that
                 *                 tally predates the split, so its matrix describes
                 *                 wood that is no longer all here.
                 *   'newChild'    the lot was CREATED by a split and no supplier
                 *                 document has ever described it. Distinct from the
                 *                 830 lots that simply never had a tally, and it is
                 *                 the case Marc-Antoine asked for at 26:54.
                 *
                 * ⚠️ A capture modified AFTER the split clears this BY DESIGN: it
                 * means somebody re-tallied the lot. That is the self-clearing
                 * property, and it works whether the re-tally arrives as a new
                 * capture or as an edit of the existing one, because `lastmodified`
                 * moves either way.
                 *
                 * 🔴 KNOWN LIMIT, do not read more into this than it says.
                 * `lastmodified` is per RECORD, not per lot or per bundle entry, so
                 * ANY edit to a capture, even a typo fix in Status Reason, clears
                 * the flag for EVERY lot in that document. Narrowing it needs a
                 * per-lot signal inside the payload, which is a schema change. Until
                 * then this errs toward showing the tally, the same direction the
                 * screen already errs. */
                const split = splits[lotKey] || null;
                let tallyState = null;
                if (split) {
                    /* 🔴 ROLE DECIDES THE LABEL, then the timestamp decides whether
                     * there is a label at all. The two used to be entangled: the
                     * `newChild` arm required `!tally`, so a CHILD lot that carried a
                     * tally older than its own creation fell through to the parent arm
                     * and the trader was told "this bundle was split" about a bundle
                     * the split CREATED. Wrong noun, wrong remedy — a parent needs
                     * re-measuring, a child has never been measured at all.
                     *
                     * Reachable whenever a capture names a lot before that lot exists,
                     * which is exactly what a document listing `X-B` does when the
                     * split that makes `X-B` has not run yet. */
                    if (split.role === 'child') {
                        const childStamp = tally
                            ? (tally.lotStamp || tally.payloadChangedAt || tally.lastModified)
                            : null;
                        // No tally, or one that predates the lot: nothing here describes it.
                        if (!tally || (split.at && childStamp && split.at.getTime() > childStamp.getTime())
                                   || (split.at && !childStamp)) {
                            tallyState = 'newChild';
                        }
                    } else if (tally && split.at) {
                        /* Per-LOT stamp wins over the per-RECORD one. See
                         * `bundleStamp`: the record-level timestamp moves for any
                         * edit to any part of the document, so it clears this flag
                         * too eagerly. Where the payload names when this particular
                         * bundle was tallied, that is the honest comparison. */
                        /* Most precise first. `lotStamp` is per bundle and needs
                         * the writer to emit it. `payloadChangedAt` is per document
                         * but only moves when the tally really changed.
                         * `lastModified` moves for any edit and is the last resort. */
                        const stamp = tally.lotStamp || tally.payloadChangedAt || tally.lastModified;
                        if (stamp && split.at.getTime() > stamp.getTime()) {
                            tallyState = 'staleParent';
                        }
                    }
                }
                const isHeld = Object.prototype.hasOwnProperty.call(heldLots, l.lotNo);
                const lb     = perLot[l.lotNo] || null;
                return {
                    lotNo:         l.lotNo,
                    lotId:         l.lotId,
                    // Derived from the lot-number prefix, which IS the PO by
                    // Marc-Antoine's own bundle nomenclature — see poFromLotNo.
                    po:            poFromLotNo(l.lotNo),
                    // A container can span several POs (2026-08-19), so the lot-number
                    // prefix that gives `po` above can never give a container. The only
                    // route is the packing-list capture, and as of 2026-09-07 that route
                    // EXISTS: custrecord_msl_plc_container_no was created 09-03 and
                    // loadTallies reads it. Empty where no capture matches the lot, which
                    // is still most lots.
                    containerNo:   (tally && tally.container) || '',
                    onHand:        l.storedQty / rate,
                    // Per-lot figures exist ONLY where the order line carries an
                    // inventory-detail assignment. A line without one contributes
                    // to the ROW but to no lot — see `unattributed` below.
                    reserve:       lb ? lb.reserve   / rate : 0,
                    outbound:      lb ? lb.outbound  / rate : 0,
                    onOrder:       lb ? lb.onOrder   / rate : 0,
                    inTransit:     lb ? lb.inTransit / rate : 0,
                    /* Supplier and ETA for the On Order / In Transit drill-downs.
                     * NULL rather than an empty object where the lot sits on no
                     * open PO line, because the browser uses the distinction the
                     * same way it uses `orders`: a value means this cache
                     * resolved it, absent means fall back and say so. */
                    incoming:      (lb && lb.incoming) || null,
                    readyToBuild:  lb ? (lb.readyToBuild || 0) / rate : 0,
                    /* ── THE SALES ORDERS THAT HOLD THIS BUNDLE ───────────────
                     *
                     * One entry per order, quantities converted to display units
                     * by the same `/ rate` as `reserve` above, so the entries sum
                     * to `reserve` in the unit the panel prints.
                     *
                     * 🔴 THE KEY IS ALWAYS PRESENT, `[]` INCLUDED, and that is
                     * load-bearing rather than tidy. It is the ONLY signal the
                     * browser has that a payload came from a source that knows
                     * about order attribution at all:
                     *
                     *   `orders` is an array  → this cache built it. Render it,
                     *                           and render nothing where a value
                     *                           is genuinely absent.
                     *   `orders` is undefined → fixtures, or a cache written
                     *                           before 2026-09-08. Fall back to
                     *                           the generator AND show the
                     *                           placeholder banner.
                     *
                     * Omitting it on unreserved bundles would save about 830
                     * bytes across the 69 live hardwood lots and would make the
                     * two cases indistinguishable on every one of them, which is
                     * how a fixture ends up on screen labelled as real.
                     *
                     * Sorted oldest order first, then by document number, so two
                     * reads of the same data list them in the same order —
                     * `Object.keys` order is insertion order here and insertion
                     * order follows whatever sequence SuiteQL returned the rows
                     * in, which is not guaranteed stable.
                     */
                    orders: lb && lb.orders
                        ? Object.keys(lb.orders)
                            .map((oid) => {
                                const o = lb.orders[oid];
                                return {
                                    tranId:     o.tranId,
                                    soNumber:   o.soNumber,
                                    customerId: o.customerId,
                                    customer:   o.customer,
                                    created:    o.created,
                                    shipDate:   o.shipDate,
                                    repId:      o.repId,
                                    rep:        o.rep,
                                    repSource:  o.repSource,
                                    repShared:  !!o.repShared,
                                    repTied:    !!o.repTied,
                                    repNameUnreadable: !!o.repNameUnreadable,
                                    qty:        o.qty / rate,
                                };
                            })
                            .sort((a, b) => (a.created === b.created
                                ? String(a.soNumber).localeCompare(String(b.soNumber))
                                : String(a.created).localeCompare(String(b.created))))
                        : [],
                    // The lot is still REPORTED — it physically exists and On Hand
                    // must keep showing it. It is only withheld from `available`.
                    onHold:        isHeld,
                    heldPacks:     isHeld ? heldLots[l.lotNo] : 0,
                    /* THE FALLBACK CHAIN, SDD s3.2.3: matrix, then document, then
                     * placeholder. `null` means the third rung - the dialog already
                     * renders its own empty state for that and needs no help.
                     *
                     * 🔴 The bundles are carried through RAW, exactly as the payload
                     * stored them. Do not reshape, round or total them here: the browser
                     * runs archTally.ts over them, and a second dialect of that
                     * arithmetic on the server is the one thing guaranteed to drift. */
                    tally: tally ? {
                        status:     tally.status,
                        sourceFile: tally.sourceFile,
                        docUrl:     tally.docUrl,
                        bundles:    tally.bundles,
                    } : null,
                    /* null, 'staleParent' or 'newChild'. See the block above.
                     * Emitted BESIDE `tally` rather than inside it, because
                     * 'newChild' is exactly the case where `tally` is null and
                     * there is nowhere inside it to put anything. */
                    tallyState: tallyState,
                    // Kept: the image a user uploads by hand is a different thing from
                    // the parsed document, and the dialog shows both. A capture's file
                    // arrives as `tally.docUrl` above, never here.
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
                const costed = perBase !== null && perBase !== undefined && isFinite(perBase);
                /*
                 * 🔴 THE LOT'S OWN COST, EMITTED. Feedback 6 item 18: "IA-CWP-730.
                 * Le MBF price est 12.76 vs 14.15."
                 *
                 * Both figures were right and they are different figures. 14.15 is
                 * what lot 316027-9 actually cost, which is why the adjustment posted
                 * at 14150. 12.76 is the ROW's on-hand-weighted average, computed
                 * three lines below, and it is what the wizard priced against because
                 * it was the only cost this payload carried. The 21 ZEB84KD lots at
                 * CWP Prevost run 12.25 to 14.15, so a trader picking the dearest
                 * bundle was quoted the cheapest wood's share of the average.
                 *
                 * The figure was already here and was being thrown away after the
                 * average was taken. Same conversion, same rounding as the row, so
                 * the two can never disagree about units: base to display MULTIPLIES
                 * by rate, the opposite of every quantity in this file.
                 *
                 * Null, never zero, for a lot with no posting history: the row-level
                 * average has always made that distinction and the per-lot figure has
                 * to make it too, or an uncosted bundle prices at free.
                 */
                l.costPerUnit = costed ? Math.round(perBase * rate * 100) / 100 : null;
                if (!costed) return;
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
            const blankTotals = { reserve: 0, outbound: 0, onOrder: 0, inTransit: 0, readyToBuild: 0 };
            const bt          = (bk && bk.totals) || blankTotals;
            const bu          = (bk && bk.unattributed) || blankTotals;
            const reserve      = bt.reserve      / rate;
            const outbound     = bt.outbound     / rate;
            const onOrder      = bt.onOrder      / rate;
            const inTransit    = bt.inTransit    / rate;
            // Absent on a bucket keyed before this field existed in the payload
            // shape — `|| 0` rather than a throw, the same tolerance every other
            // figure here already has for a missing bucket.
            const readyToBuild = (bt.readyToBuild || 0) / rate;
            const unattributed = {
                reserve:      bu.reserve      / rate,
                outbound:     bu.outbound     / rate,
                onOrder:      bu.onOrder      / rate,
                inTransit:    bu.inTransit    / rate,
                readyToBuild: (bu.readyToBuild || 0) / rate,
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
                /*
                 * ADDING a field here is safe; the deploy-order warning above is
                 * about REMOVING one. This is the stage-crossing carrier for
                 * `readyToBuildSourced` — see its note. `!== false` so that a row
                 * written by an older reduce, replayed from a retried stage, is
                 * read as "no claim" rather than as unsourced.
                 */
                rtbSourced:   pair.rtbSourced !== false,
                onHand:       onHand,
                // Row totals come from the ORDER LINES, not from summing the
                // lots. A line without an inventory-detail assignment is real
                // and must count here even though no lot can claim it — summing
                // lots would silently under-report exactly those orders.
                reserve:      reserve,
                outbound:     outbound,
                onOrder:      onOrder,
                inTransit:    inTransit,
                // Sourced from `custbody_arch_ready_to_build` where the field
                // exists and could be read this run (see `loadBuckets`); 0 on
                // any account where it cannot, which is exactly today's value
                // and exactly what every open line falls back to. Never both
                // this and `reserve` for the same open quantity — the two are
                // an either/or split of the same line.
                readyToBuild: readyToBuild,
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
                /* The full formula, floored.
                 *
                 * 🔴 `outbound` IS NOT SUBTRACTED, and removing it on 2026-09-08
                 * was a CORRECTION, not a simplification. Do not put it back
                 * without re-measuring the two facts below.
                 *
                 * `outbound` is `quantityshiprecv` on sales-order lines that are
                 * still open (isclosed='F'). That quantity has left inventory: it
                 * requires an Item Fulfillment, and the fulfillment relieves the
                 * stock. So `onHand` — read from quantityonhand, per lot — is
                 * ALREADY net of it, and subtracting it again removed the same
                 * wood twice.
                 *
                 * Measured in sandbox 2026-09-08, lot 315643-7 of PUR44KD at
                 * Ramsey Xpress. IA-CWP-362 put 511 BF in on 08-14; IF1208 took
                 * 300 out on 09-08; inventorynumberlocation reports
                 * quantityonhand 0.211 and quantityavailable 0.211. The row read
                 * On Hand 1,754, Reserved 0, Available 1,454 — 300 BF of
                 * uncommitted hardwood that NetSuite says is on the floor and
                 * free, reported as unsellable. Three more rows carried the same
                 * error (SAP54FCKD @ USL 225, ZEB44KD 141, ZEB84KD @ Prevost 500;
                 * 1,166 BF across 13 rows), and it GROWS WITHOUT BOUND: nothing
                 * closes a shipped-and-billed line, so every future shipment adds
                 * to a permanent deduction.
                 *
                 * That is the arithmetic half of Marc-Antoine's report — the
                 * stock left On Hand, left Reserved, was deducted a second time
                 * here, and appeared in no column, because the grid rendered no
                 * Outbound column either. The column is back (InventoryTableARCH)
                 * and it reports shipment history, which is what it is.
                 *
                 * With this line as it stands, every one of the 13 live rows
                 * reconciles exactly: available equals the free volume of its own
                 * bundles plus whatever is on order or in transit and has no
                 * bundle yet. With `- outbound` it did not on 4 of 13.
                 *
                 * ⚠️ lib/archFixtures.ts still models outbound as a claim on
                 * on-hand stock and subtracts it, which is self-consistent for a
                 * generator but no longer matches live. Bring it in step when it
                 * is next touched.
                 *
                 * `readyToBuild` IS subtracted, same as `reserve`: it is sold
                 * wood one stage further along, not unsold wood. When the field
                 * cannot be read, `readyToBuild` is 0 and this line is
                 * unchanged from before it existed.
                 */
                available:    Math.max(0, onHand + onOrder + inTransit
                                          - reserve - readyToBuild
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

            /* Read off the ROWS, never off `readyToBuildSourced` — this is a
             * different execution and that variable is a re-initialised `true`
             * here. See its note for what that used to make META claim. */
            const rtbSourced = rtbSourcedFrom(rows);

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
                        bucketsBuilt:       bucketsMeta(rtbSourced).bucketsBuilt,
                        bucketsEmpty:       bucketsMeta(rtbSourced).bucketsEmpty,
                        skippedLotCount:    skippedLots.length,
                        recoveredCount:     recoveredCount,
                        unrecoverableCount: unrecoverableCount,
                        untaggedItemCount:  untaggedItems.length,
                        untaggedItemSample: untaggedItems.slice(0, 8),
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
                    // can tell the user which columns are real. See `bucketsMeta`:
                    // readyToBuild moves from Empty to Built the first run after
                    // the field exists and can be read.
                    bucketsBuilt: bucketsMeta(rtbSourced).bucketsBuilt,
                    bucketsEmpty: bucketsMeta(rtbSourced).bucketsEmpty,
                    // Non-zero means the On Hand figures on screen are LOW: these
                    // lots exist but could not be converted to display units.
                    skippedLotCount: skippedLots.length,
                    // Same reason: read by the "already reported" check above so a
                    // standing recovery does not re-alarm at error level every hour.
                    recoveredCount:  recoveredCount,
                    unrecoverableCount: unrecoverableCount,
                    // Non-zero means stock EXISTS in the account that this screen
                    // cannot show, because nobody has tagged its item as Hardwood.
                    // The screen says so; the full list is in the audit log.
                    untaggedItemCount:  untaggedItems.length,
                    untaggedItemSample: untaggedItems.slice(0, 8),
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
                rows.length + ' summary row(s), ' + payloadBytes + ' bytes. ' +
                (rtbSourced ? 'readyToBuild sourced. ' : 'readyToBuild not sourced. ') +
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
