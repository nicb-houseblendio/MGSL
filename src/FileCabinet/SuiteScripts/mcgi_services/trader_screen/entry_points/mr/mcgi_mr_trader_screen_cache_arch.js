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
                log.error('ARCH cache getInputData — lots SKIPPED, no conversion rate',
                    rateless.length + ' lot row(s) had no usable stock-unit conversion rate and were ' +
                    'excluded rather than counted at rate 1: ' + rateless.join(', '));
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
                thickness:    '',   // segment not yet populated on the ARCH items
                category:     '',   // csegitem_category not yet populated
                grade:        '',   // confirmed empty on hardwood items
                grain:        '',
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

            myCache.put({ key: CacheKeys.SUMMARY, value: payload, ttl: CacheKeys.TTL_SUMMARY });
            myCache.put({
                key: CacheKeys.META,
                value: JSON.stringify({
                    cacheVersion: 1,
                    lastUpdated:  new Date().toISOString(),
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
                rows.length + ' summary row(s), ' + payloadBytes + ' bytes. On Hand only.');
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
