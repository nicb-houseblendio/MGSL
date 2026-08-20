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
 * fields on an older cached payload. So: bundle.js, then this file, then let the
 * hourly schedule rebuild. `deploy.xml` is banned here (it clobbers ungit'd
 * sandbox work), which means every ARCH deploy is hand-scoped — exactly the
 * situation where an ordering rule gets missed.
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
    // AMD binds these POSITIONALLY. Never delete a module id without deleting
    // its parameter below in the same edit. (Module ids are written unquoted in
    // this comment on purpose: a quoted one here is picked up by naive scripts
    // that count the array's entries, which cost me a false misalignment report.)
    'N/query', 'N/search', 'N/log', 'N/runtime',
    '../../shared/cacheKeys_arch',
    '../../shared/cacheClient',
    // Shared FIFO lot-cost engine, validated to the cent against production GL
    // (2026-06-11). MTL already depends on it, so it exists in both sandbox and
    // production — but it is NOT tracked in this repo and drifts per
    // environment, so treat its output as data to be checked, not as a given.
    // Every call here is wrapped: costing must never take down the cache build.
    '/SuiteScripts/MCGI_LIB_LotCost',
], (query, search, log, runtime, CacheKeys, CacheClient, LotCostLib) => {

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
        '  i.displayname           AS description, ' +
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
     * `archSplitQueue` documents, and the reason `ia.transactionline` joins on
     * the line NUMBER rather than `tl.id`.
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
    const getInputData = () => {
        try {
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
                    log.error('ARCH cache — POSSIBLE UNTAGGED HARDWOOD, invisible to this screen',
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
                        description:  r.description || r.itemcode || '',
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
            return out;
        } catch (e) {
            log.error('ARCH cache getInputData failed', e.message);
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
                //   cseggrade            → does NOT exist on `item` at all. It is
                //        a column on TRANSACTIONLINE, i.e. grade is recorded per
                //        SO line, not per item. So an inventory grid cannot
                //        source it from the item however long we wait — that is a
                //        product question, not missing data.
                //   grain                → no column anywhere on the item. The
                //        item table DOES expose custitem_* fields (12 of them),
                //        so this is absence, not invisibility.
                thickness:    pair.thickness || '',
                grade:        '',   // see below — cseggrade is NOT an item field
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

            // Stable order so the grid does not reshuffle between rebuilds.
            rows.sort((a, b) => (a.itemCode + a.locationName).localeCompare(b.itemCode + b.locationName));

            // Counted here, not in reduce: reduce runs per pair and module state
            // does not reliably survive between stages (see `skippedLots`).
            const costedRows = rows.filter((r) =>
                r.avgCostPerUnit !== null && r.avgCostPerUnit !== undefined).length;

            const payload = JSON.stringify(rows);
            const payloadBytes = utf8Bytes(payload);

            // The 500 KB ceiling is per VALUE, not per cache. 6 SKUs cannot
            // approach it today, but the check is here rather than added later
            // under pressure — that is how IND acquired its chunking bug.
            if (payloadBytes > CacheKeys.MAX_CACHE_VALUE_BYTES) {
                log.error('ARCH cache summarize',
                    'Summary payload is ' + payloadBytes + ' bytes, over the ' +
                    CacheKeys.MAX_CACHE_VALUE_BYTES + ' byte ceiling. Chunking is NOT implemented ' +
                    'for ARCH yet — port it from cacheKeys_mtl/buildSummaryDataKey before this ships ' +
                    'at real volume.');
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
            // Tolerant on purpose. A CHECKBOX parameter should come back as a
            // boolean, but this is the ONLY escape from a guard that otherwise
            // blocks a legitimate shrink forever, and it has never been exercised.
            // If NetSuite ever hands back 'T' or 'true', a strict === true would
            // fail silently and leave the cache wedged with no way out.
            const forceFull = (function () {
                try {
                    const v = runtime.getCurrentScript()
                        .getParameter({ name: 'custscript_ts_arch_force_full_rebuild' });
                    return v === true || v === 'T' || v === 'true';
                } catch (e) { return false; }
            })();

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
                // The deployment has notifyowner=T, and this now runs EVERY HOUR.
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

            myCache.put({ key: CacheKeys.SUMMARY, value: payload, ttl: CacheKeys.TTL_SUMMARY });
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
        }
    };

    return {
        getInputData: getInputData,
        map:          map,
        reduce:       reduce,
        summarize:    summarize,
    };
});
