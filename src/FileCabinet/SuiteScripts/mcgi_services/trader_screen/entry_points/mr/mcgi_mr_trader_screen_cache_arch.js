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
 * ═══ STATUS: ON HAND ONLY ═══════════════════════════════════════════════════
 * This is deliberately partial. Five of the six buckets have NO SOURCE DATA in
 * the account yet — checked 2026-08-17: the six ARCH SKUs carry 96 lots across
 * 3 locations and 123 transactions, and every one of those transactions is an
 * Inventory Adjustment. There is not a single ARCH sales order, purchase order,
 * receipt or transfer order.
 *
 *   onHand        ✅ built here, from lot balances
 *   reserve       ⛔ needs sales orders        — none exist
 *   readyToBuild  ⛔ needs sales orders        — none exist
 *   outbound      ⛔ needs sales orders        — none exist
 *   onOrder       ⛔ needs purchase orders     — none exist
 *   inTransit     ⛔ needs POs/TOs billed not received — none exist
 *
 * Writing the other five now would mean writing queries nothing can validate:
 * an empty result is indistinguishable from a broken one. They are stubbed to
 * zero, explicitly, so the shape is right and the gap is visible on the screen
 * rather than hidden behind plausible-looking numbers.
 *
 * ═══ WHY N/query AND NOT SAVED SEARCHES ═════════════════════════════════════
 * A DEPARTURE from IND and MTL, which each drive off six saved searches. Three
 * reasons it is the right call here and not merely convenient:
 *
 *  1. ARCH is LOT-CENTRIC. The screen shows per-lot rows, tallies and container
 *     numbers. IND/MTL aggregate to item × location and never descend to the
 *     lot. Saved searches express lot-level joins awkwardly; SuiteQL expresses
 *     them directly.
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
    'N/query', 'N/cache', 'N/log', 'N/runtime',
    '../../shared/cacheKeys_arch',
    '../../shared/cacheClient',
], (query, cache, log, runtime, CacheKeys, CacheClient) => {

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
     * REPLACE THIS ENTIRELY once the hardwood/softwood SKU segment Lucas and
     * Julie are adding is populated. It remains a proxy: it only works while
     * softwood carries no units type at all.
     */
    const EXCLUDED_UNITS_TYPES = [2];   // Manual — MTL dunnage, not hardwood

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
        'WHERE i.unitstype IS NOT NULL ' +
        '  AND i.unitstype NOT IN (' + EXCLUDED_UNITS_TYPES.map(() => '?').join(',') + ') ' +
        '  AND inl.quantityonhand <> 0';

    // ── getInputData ────────────────────────────────────────────────────────
    // Returns one entry per item × location, each carrying its lots. FULL only.
    const getInputData = () => {
        try {
            const rows = query.runSuiteQL({
                query: LOT_SQL,
                params: EXCLUDED_UNITS_TYPES,
            }).asMappedResults();

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
                        unit:         normalizeUnit(r.unitname),
                        rate:         rate,
                        locationId:   String(r.locationid),
                        locationName: r.locationname || KNOWN_LOCATIONS[r.locationid] || '',
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
            const lots = pair.lots.map((l) => ({
                lotNo:         l.lotNo,
                lotId:         l.lotId,
                po:            '',      // no ARCH purchase orders exist yet
                containerNo:   '',      // not on inventorynumber; open question with Marc-Antoine
                onHand:        l.storedQty / pair.rate,
                reserve:       0,       // ⛔ no sales orders exist
                readyToBuild:  0,       // ⛔ no sales orders exist
                outbound:      0,       // ⛔ no sales orders exist
                onOrder:       0,       // ⛔ no purchase orders exist
                inTransit:     0,       // ⛔ no POs/TOs exist
                tallyImageUrl: null,
            }));

            const onHand = lots.reduce((s, l) => s + l.onHand, 0);

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
                // Only THREE segments exist on `item`: cseg1 (species),
                // csegitem_category, and cseggrade. Of those, grade is genuinely
                // empty on the hardwood items.
                //
                // thickness and grain are NOT segments at all — no csegthickness
                // or cseggrain column exists. So they cannot be "populated
                // later"; they need a decided source. The fixtures fake thickness
                // by formatting descriptions as `${species} ${thickness} KD`,
                // which real item descriptions will not guarantee.
                thickness:    '',   // no such segment — needs a source decision
                grade:        '',   // segment exists, empty on the hardwood items
                grain:        '',   // no such segment — needs a source decision
                containerNo:  '',
                containers:   [],
                lots:         lots,
                unit:         pair.unit,
                onHand:       onHand,
                reserve:      0,
                readyToBuild: 0,
                outbound:     0,
                onOrder:      0,
                inTransit:    0,
                // The FULL formula with its floor, not `onHand`, even though
                // every deduction is structurally zero today. Writing the
                // shortcut would mean that whoever fills `reserve` has to
                // remember to come back and change this too — and if they
                // don't, the screen offers stock that is already committed.
                available:    Math.max(0, onHand + 0 /*onOrder*/ + 0 /*inTransit*/
                                          - 0 /*reserve*/ - 0 /*readyToBuild*/ - 0 /*outbound*/),
                // NULL, NOT ZERO. Lot costing is not wired yet, and 0 renders as
                // "$0.00/BF" — indistinguishable from stock that genuinely cost
                // nothing. null is self-describing: the formatter shows an em
                // dash, so an absent cost can never be read as a measured one.
                avgCostPerUnit: null,
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
                        bucketsBuilt:       ['onHand'],
                        bucketsEmpty:       ['reserve', 'readyToBuild', 'outbound', 'onOrder', 'inTransit'],
                        skippedLotCount:    skippedLots.length,
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
                    bucketsBuilt: ['onHand'],
                    bucketsEmpty: ['reserve', 'readyToBuild', 'outbound', 'onOrder', 'inTransit'],
                    // Non-zero means the On Hand figures on screen are LOW: these
                    // lots exist but could not be converted to display units.
                    skippedLotCount: skippedLots.length,
                }),
                ttl: CacheKeys.TTL_SUMMARY,
            });

            log.audit('ARCH cache summarize',
                rows.length + ' summary row(s), ' + payloadBytes + ' bytes. On Hand only.' +
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
