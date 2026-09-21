/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * MCGI_LIB_LotCost — shared lot cost engine (CWP MTL).
 *
 * Costing model — validated to the cent against Prod GL (2026-06-11, see
 * Task 8 docs/lot-cost-issue-summary.md and the SuiteQL traces):
 *
 *   NetSuite costs these lot-numbered items as FIFO LAYERS PER LOT + LOCATION.
 *   - Each posting receipt (Item Receipt / positive Inventory Adjustment)
 *     creates a layer. Layer rate = line GL on the inventory accounts
 *     (Primary book = CAD) / line qty, PLUS the transaction's qty-less
 *     landed-cost GL for the same item+location apportioned over the
 *     item's received qty.
 *   - GL is LINE-level: one line's GL covers all its lot assignments at a
 *     uniform rate (pro-rata by assigned qty).
 *   - Posting issues (Item Fulfillments / negative IAs) consume the lot's
 *     layers FIFO. "Reset when a lot empties" falls out automatically.
 *   - Non-posting transactions (Reman Orders, Sales Orders) move nothing.
 *
 * Falsified alternatives (do not "simplify" back to these): single-origin
 * cost, per-lot weighted average, item+location average.
 *
 * Consumers: MCGI_UE_reman_lot_cost.js, MCGI_RL_REMAN_LOT_COST.js,
 * MCGI_MR_REMAN_LOT_COST_BACKFILL.js (via getLineCosts), and the
 * Trader Screen MR mcgi_mr_trader_screen_cache_mtl.js (via
 * getLotCostsAtLocation — 2026-06-16).
 */
define(['N/query', 'N/log'], function (query, log) {

    const PRIMARY_BOOK = 1;
    // CAD inventory asset accounts (1500100 family). 632 included defensively.
    const INVENTORY_ACCOUNTS = [288, 632];
    const QTY_EPSILON = 0.0001;

    /**
     * Main API. Computes the lot cost for each line of a Reman Order
     * (or any consumer with the same shape).
     *
     * @param {Array<Object>} lines - [{
     *     key: any,                  // caller's line identifier, echoed back
     *     matchTranId: number|null,  // the Reman Order internal id (optional).
     *                                // If its consumption already posted, the
     *                                // POSTED cost is returned instead of a
     *                                // projection — keeps saved ROs stable.
     *     assignments: [{ lotId, locationId, qty }]   // qty positive
     * }]
     * @returns {Object} { lines: { <key>: {
     *     unitCost: number|null,     // blended per-unit cost across the line's lots
     *     totalCost: number|null,    // sum of per-lot costs (2dp)
     *     qty: number,
     *     source: 'posted'|'projected'|'mixed'|'none',
     *     warnings: string[],
     *     perLot: [{ lotId, locationId, qty, unitCost, source }]
     * } } }
     */
    function getLineCosts(lines) {
        const TAG = 'LotCostLib.getLineCosts';
        const result = { lines: {} };

        const lotIds = [];
        (lines || []).forEach(function (line) {
            (line.assignments || []).forEach(function (a) {
                if (a.lotId && lotIds.indexOf(String(a.lotId)) === -1) lotIds.push(String(a.lotId));
            });
        });

        if (lotIds.length === 0) {
            (lines || []).forEach(function (line) {
                result.lines[line.key] = emptyLineResult(0, ['no lots assigned']);
            });
            return result;
        }

        const states = buildLotStates(lotIds);

        (lines || []).forEach(function (line) {
            const perLot = [];
            const warnings = [];
            let totalQty = 0;
            let totalCost = 0;
            let costedQty = 0;
            const sources = {};

            (line.assignments || []).forEach(function (a) {
                const res = resolveAssignment(states, a, line.matchTranId);
                perLot.push(res);
                totalQty += res.qty;
                res.warnings.forEach(function (w) { warnings.push('lot ' + a.lotId + ': ' + w); });
                if (res.unitCost !== null) {
                    totalCost += res.unitCost * res.qty;
                    costedQty += res.qty;
                    sources[res.source] = true;
                }
            });

            if (costedQty === 0) {
                result.lines[line.key] = emptyLineResult(totalQty, warnings.length ? warnings : ['no cost found']);
                result.lines[line.key].perLot = perLot;
                return;
            }
            if (costedQty < totalQty - QTY_EPSILON) {
                warnings.push('blend covers only ' + costedQty + ' of ' + totalQty + ' units (no cost for the rest)');
            }

            const unitCost = totalCost / costedQty;
            result.lines[line.key] = {
                unitCost: round2(unitCost),
                totalCost: round2(unitCost * totalQty),
                qty: totalQty,
                source: Object.keys(sources).length > 1 ? 'mixed' : (Object.keys(sources)[0] || 'none'),
                warnings: warnings,
                perLot: perLot
            };
        });

        log.debug(TAG, 'Lots: [' + lotIds.join(',') + '] → ' + JSON.stringify(result));
        return result;
    }

    function emptyLineResult(qty, warnings) {
        return { unitCost: null, totalCost: null, qty: qty, source: 'none', warnings: warnings, perLot: [] };
    }

    /**
     * Returns the current cost per unit for each lot at a location, computed as
     * the weighted average across the lot's remaining FIFO layers (after all
     * historical postings consume their share). Falls back to the last posted
     * issue's cost when layers are empty, returns null when no posting history
     * exists at the location.
     *
     * Same data sources, same FIFO model, same CustInvc exclusion as
     * getLineCosts — different shape of question (lot-shaped, not line-shaped).
     *
     * Consumer: Trader Screen MR (mcgi_mr_trader_screen_cache_mtl.js) — fills
     * `row.lotCost` for the on-hand bucket of the trader cache.
     *
     * @param {Array<string|number>} lotIds
     * @param {string|number} locationId
     * @param {Object} [options]
     * @param {number} [options.book] - accounting book id (defaults to Primary, 1).
     *                                  Pass 6 for USD secondary book on CWP MTL.
     * @returns {Object<lotId, number|null>} per-lot unit cost (2dp) in the chosen book's currency
     */
    function getLotCostsAtLocation(lotIds, locationId, options) {
        const TAG = 'LotCostLib.getLotCostsAtLocation';
        options = options || {};
        const book = parseInt(options.book, 10) || PRIMARY_BOOK;

        if (!lotIds || !lotIds.length) return {};

        const states = buildLotStates(lotIds.map(String), book);
        const locKey = String(locationId || '');
        const result = {};

        lotIds.forEach(function (lotId) {
            const key = String(lotId) + '__' + locKey;
            const state = states[key];
            if (!state) { result[lotId] = null; return; }
            if (!state.layers.length) {
                // Lot fully consumed at this location: report the last posted
                // issue's cost (matches the fallback used by getLineCosts).
                result[lotId] = state.issues.length
                    ? round2(state.issues[state.issues.length - 1].unitCost)
                    : null;
                return;
            }
            // Weighted average across remaining layers — what the lot's
            // current on-hand is worth per unit, blended.
            let qty = 0;
            let cost = 0;
            state.layers.forEach(function (l) { qty += l.qty; cost += l.qty * l.rate; });
            result[lotId] = qty > QTY_EPSILON ? round2(cost / qty) : null;
        });

        log.debug(TAG, 'book=' + book + ' loc=' + locKey + ' lots=[' + lotIds.join(',') + '] → ' + JSON.stringify(result));
        return result;
    }

    // ========== Resolution ==========

    /**
     * Resolves one (lot, location, qty) to a unit cost.
     * Priority (posted remans): the reman's OWN consumption IA via the IA→reman
     * link (custbody_related_inv_adj_reman) → an unambiguous same-qty IA when no
     * link exists → FIFO projection from remaining layers (unposted remans).
     */
    function resolveAssignment(states, assignment, matchTranId) {
        const lotId = String(assignment.lotId);
        const locationId = String(assignment.locationId || '');
        const qty = Math.abs(parseFloat(assignment.qty) || 0);
        const out = { lotId: lotId, locationId: locationId, qty: qty, unitCost: null, source: 'none', warnings: [] };

        const state = states[lotId + '__' + locationId] || pickAnyLocation(states, lotId, out);
        if (!state) {
            out.warnings.push('no posting history found' + (locationId ? ' (location ' + locationId + ')' : ''));
            return out;
        }

        if (matchTranId) {
            // Primary: match this reman's OWN consumption IA via the IA→reman
            // link (custbody_related_inv_adj_reman). Deterministic — the only
            // safe key when one lot is consumed by several remans, including
            // reman CHAINS where one reman's finished lot re-enters and feeds
            // another (e.g. RO-031's output → RO-036's input, lot 37124).
            // Replaces the old exact-match that compared the IA's own txn id to
            // the reman internal id (never equal) and so always fell through to
            // the qty guess below — which mis-costed shared-lot remans by
            // grabbing the LATEST same-qty issue (RO-031/036, RO-024/040,
            // found 2026-07-07).
            const linked = state.issues.filter(function (i) {
                return i.remanId && String(i.remanId) === String(matchTranId);
            });
            if (linked.length) {
                const m = linked[linked.length - 1];
                out.unitCost = m.unitCost;
                out.source = 'posted';
                if (linked.length > 1) {
                    out.warnings.push('reman ' + matchTranId + ' has ' + linked.length +
                        ' consumption issues for this lot; used latest (' + m.tranId + ')');
                }
                return out;
            }
            // Fallback: qty-match, but ONLY when unambiguous (exactly one
            // candidate). Restricted to Inventory Adjustments — the reman
            // consumption vehicle (matching any issue type grabbed unrelated
            // fulfillments, RO024 regression 2026-06-12). If several posted IAs
            // of this lot share the qty and none is link-matched, we cannot tell
            // them apart — warn and fall through to FIFO rather than guess.
            const byQty = state.issues.filter(function (i) {
                return i.tranType === 'InvAdjst' && Math.abs(i.qty - qty) < QTY_EPSILON;
            });
            if (byQty.length === 1) {
                out.unitCost = byQty[0].unitCost;
                out.source = 'posted';
                out.warnings.push('matched posted IA ' + byQty[0].tranId + ' by quantity (no reman link)');
                return out;
            }
            if (byQty.length > 1) {
                out.warnings.push('AMBIGUOUS: ' + byQty.length + ' posted IAs of this lot match qty ' +
                    qty + ' and none is linked to reman ' + matchTranId + '; using FIFO projection');
            }
        }

        const projected = projectFifo(state.layers, qty);
        if (projected.unitCost !== null) {
            out.unitCost = projected.unitCost;
            out.source = 'projected';
            projected.warnings.forEach(function (w) { out.warnings.push(w); });
            return out;
        }

        // Layers empty (lot fully consumed) and no match — fall back to the last posted issue cost.
        if (state.issues.length) {
            const last = state.issues[state.issues.length - 1];
            out.unitCost = last.unitCost;
            out.source = 'posted';
            out.warnings.push('lot has no remaining layers; using last posted issue cost (' + last.tranId + ')');
            return out;
        }

        out.warnings.push('no layers and no posted issues');
        return out;
    }

    function pickAnyLocation(states, lotId, out) {
        const keys = Object.keys(states).filter(function (k) { return k.indexOf(lotId + '__') === 0; });
        if (!keys.length) return null;
        out.warnings.push('no history at the requested location; using location ' + keys[0].split('__')[1]);
        return states[keys[0]];
    }

    /** Projects consuming `qty` from the remaining FIFO layers (does not mutate). */
    function projectFifo(layers, qty) {
        const warnings = [];
        if (!qty) return { unitCost: null, warnings: ['zero quantity requested'] };
        let remaining = qty;
        let cost = 0;
        for (let i = 0; i < layers.length && remaining > QTY_EPSILON; i++) {
            const take = Math.min(layers[i].qty, remaining);
            cost += take * layers[i].rate;
            remaining -= take;
        }
        if (remaining > QTY_EPSILON) {
            if (qty - remaining <= QTY_EPSILON) return { unitCost: null, warnings: warnings };
            const lastRate = layers.length ? layers[layers.length - 1].rate : 0;
            cost += remaining * lastRate;
            warnings.push('layers short by ' + remaining + ' units; extended at last layer rate');
        }
        return { unitCost: cost / qty, warnings: warnings };
    }

    // ========== History → FIFO state ==========

    /**
     * Builds { '<lotId>__<locationId>': { layers: [{qty, rate}], issues: [{tranId, qty, unitCost, tranDate}] } }
     * by replaying each lot's posting history chronologically.
     *
     * @param {Array<string>} lotIds
     * @param {number} [book] - accounting book id; defaults to PRIMARY_BOOK.
     *                          Plumbed through to fetchMovements/fetchLandedPools
     *                          so the Trader Screen consumer can request USD
     *                          secondary book (book=6) for IA-origin lots.
     */
    function buildLotStates(lotIds, book) {
        book = book || PRIMARY_BOOK;
        const TAG = 'LotCostLib.buildLotStates';
        const states = {};

        const movements = fetchMovements(lotIds, book);
        if (!movements.length) return states;

        const landedPools = fetchLandedPools(movements, book);

        movements.forEach(function (m) {
            const key = m.lot_id + '__' + (m.location_id || '');
            if (!states[key]) states[key] = { layers: [], issues: [] };
            const state = states[key];
            const qty = parseFloat(m.qty) || 0;

            if (qty > 0) {
                state.layers.push({ qty: qty, rate: receiptRate(m, landedPools) });
            } else if (qty < 0) {
                consumeFifo(state, m, -qty);
            }
        });

        log.debug(TAG, Object.keys(states).map(function (k) {
            return k + ': ' + states[k].layers.length + ' layers, ' + states[k].issues.length + ' issues';
        }).join(' | '));
        return states;
    }

    /** Layer rate = line GL / line qty + landed pool / item qty (validated incl. landed cost). */
    function receiptRate(m, landedPools) {
        const lineQty = parseFloat(m.line_qty) || 0;
        const lineGl = (m.line_gl === null || m.line_gl === undefined) ? null : parseFloat(m.line_gl);

        let rate = 0;
        if (lineGl !== null && lineQty > 0) {
            rate = lineGl / lineQty;
        }

        const pool = landedPools[m.tran_id + '__' + m.item_id + '__' + (m.location_id || '')];
        if (pool && pool.landedGl && pool.itemQty > 0) {
            rate += pool.landedGl / pool.itemQty;
        }
        return rate;
    }

    /** Consumes FIFO from the lot's layers and records the posted issue cost. */
    function consumeFifo(state, m, qty) {
        let remaining = qty;
        let cost = 0;
        while (remaining > QTY_EPSILON && state.layers.length) {
            const layer = state.layers[0];
            const take = Math.min(layer.qty, remaining);
            cost += take * layer.rate;
            layer.qty -= take;
            remaining -= take;
            if (layer.qty <= QTY_EPSILON) state.layers.shift();
        }
        const consumed = qty - remaining;
        const fifoCost = consumed > QTY_EPSILON ? cost / consumed
            : (state.issues.length ? state.issues[state.issues.length - 1].unitCost : 0);

        // When the issue posted its own inventory-account GL (IAs do), that
        // IS the cost truth — prefer it over the FIFO replay so posted-match
        // results equal the GL to the cent even if layer math drifts.
        const lineQty = parseFloat(m.line_qty);
        const lineGl = (m.line_gl === null || m.line_gl === undefined) ? null : parseFloat(m.line_gl);
        const glRate = (lineGl !== null && lineQty) ? Math.abs(lineGl / lineQty) : null;

        state.issues.push({
            tranId: m.tran_id,
            tranType: m.tran_type,
            tranDate: m.trandate,
            remanId: m.reman_id,
            qty: qty,
            unitCost: glRate !== null ? glRate : fifoCost
        });
    }

    // ========== SuiteQL ==========

    /**
     * All POSTING movements for the lots, chronological, with line qty and the
     * line's inventory-account GL for the chosen accounting book. Validated
     * ordering: trandate, createddate, id.
     *
     * @param {Array<string>} lotIds
     * @param {number} [book] - accounting book id; defaults to PRIMARY_BOOK (CAD).
     *                          Pass 6 for USD secondary book.
     */
    function fetchMovements(lotIds, book) {
        book = book || PRIMARY_BOOK;
        const placeholders = lotIds.map(function () { return '?'; }).join(',');
        // Type whitelist matches the on-hand saved search universe
        // (customsearch_mgsl_trader_onhand_tran_mtl). Exclusions are
        // deliberate:
        //   - CustInvc: billed-against-fulfillment IAs that do NOT move
        //     stock — fulfillment already did. Proven by Run 8 lot walks
        //     and the RO024 regression (2026-06-12).
        //   - VendBill: in "Bill First, Receive Later" workflows the VB
        //     carries inventoryassignment rows but posts to accrual
        //     accounts (e.g. 112 "Provisions Courus Inventaire - Achats"),
        //     not the inventory account in INVENTORY_ACCOUNTS. They yield
        //     line_gl = NULL → receiptRate = 0 → a phantom $0 FIFO layer
        //     that dilutes the lot's weighted average. Reconciled on
        //     lots 112233 + 558899 (sbx 2026-06-25).
        //   - StatChng and other non-inventory-moving types: same logic.
        const sql =
            'SELECT inv.inventorynumber AS lot_id, inv.transaction AS tran_id, t.type AS tran_type, ' +
            ' t.custbody_related_inv_adj_reman AS reman_id, ' +
            ' inv.quantity AS qty, t.trandate, tl.location AS location_id, tl.item AS item_id, ' +
            ' tl.quantity AS line_qty, SUM(tal.amount) AS line_gl ' +
            'FROM inventoryassignment inv ' +
            'JOIN transaction t ON t.id = inv.transaction ' +
            'JOIN transactionline tl ON tl.transaction = inv.transaction AND tl.id = inv.transactionline ' +
            'LEFT JOIN transactionaccountingline tal ' +
            '  ON tal.transaction = inv.transaction AND tal.transactionline = inv.transactionline ' +
            ' AND tal.accountingbook = ' + book + ' AND tal.posting = \'T\' ' +
            ' AND tal.account IN (' + INVENTORY_ACCOUNTS.join(',') + ') ' +
            'WHERE inv.inventorynumber IN (' + placeholders + ') ' +
            '  AND t.posting = \'T\' ' +
            '  AND t.type IN (\'ItemRcpt\',\'ItemShip\',\'InvAdjst\',\'CustCred\') ' +
            'GROUP BY inv.inventorynumber, inv.transaction, inv.transactionline, inv.quantity, ' +
            ' t.type, t.custbody_related_inv_adj_reman, t.trandate, t.createddate, t.id, tl.location, tl.item, tl.quantity ' +
            'ORDER BY t.trandate, t.createddate, t.id';

        return query.runSuiteQL({ query: sql, params: lotIds }).asMappedResults();
    }

    /**
     * Landed-cost pools for the receipt transactions: qty-less inventory-account
     * GL lines, apportioned over the item's received qty at the location.
     * Keyed '<tranId>__<itemId>__<locationId>'.
     *
     * @param {Array<Object>} movements
     * @param {number} [book] - accounting book id; defaults to PRIMARY_BOOK.
     */
    function fetchLandedPools(movements, book) {
        book = book || PRIMARY_BOOK;
        const pools = {};
        const tranIds = [];
        movements.forEach(function (m) {
            if ((parseFloat(m.qty) || 0) > 0 && tranIds.indexOf(String(m.tran_id)) === -1) {
                tranIds.push(String(m.tran_id));
            }
        });
        if (!tranIds.length) return pools;

        const placeholders = tranIds.map(function () { return '?'; }).join(',');
        const sql =
            'SELECT tl.transaction AS tran_id, tl.item AS item_id, tl.location AS location_id, ' +
            ' SUM(CASE WHEN tl.quantity IS NULL OR tl.quantity = 0 THEN tal.amount ELSE 0 END) AS landed_gl, ' +
            ' SUM(CASE WHEN tl.quantity > 0 THEN tl.quantity ELSE 0 END) AS item_qty ' +
            'FROM transactionline tl ' +
            'LEFT JOIN transactionaccountingline tal ' +
            '  ON tal.transaction = tl.transaction AND tal.transactionline = tl.id ' +
            ' AND tal.accountingbook = ' + book + ' AND tal.posting = \'T\' ' +
            ' AND tal.account IN (' + INVENTORY_ACCOUNTS.join(',') + ') ' +
            'WHERE tl.transaction IN (' + placeholders + ') ' +
            'GROUP BY tl.transaction, tl.item, tl.location';

        query.runSuiteQL({ query: sql, params: tranIds }).asMappedResults().forEach(function (r) {
            pools[r.tran_id + '__' + r.item_id + '__' + (r.location_id || '')] = {
                landedGl: parseFloat(r.landed_gl) || 0,
                itemQty: parseFloat(r.item_qty) || 0
            };
        });
        return pools;
    }

    function round2(n) {
        return Math.round(n * 100) / 100;
    }

    return {
        getLineCosts: getLineCosts,
        getLotCostsAtLocation: getLotCostsAtLocation
    };
});
