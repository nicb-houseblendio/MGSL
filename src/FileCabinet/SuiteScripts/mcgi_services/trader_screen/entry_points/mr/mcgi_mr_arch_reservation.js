/**
 * mcgi_mr_arch_reservation.js — CWP ARCH pre-arrival reservation reconciler.
 * Feedback 8, build steps 2.7 (un-reserve), 2.7b (reconciler), 2.7c (exception
 * report) and 3.1 (hand-off at receipt).
 *
 * One pass over every live `customrecord_arch_res` claim. For each, the rules in
 * `archReservation.decideClaim` pick one of:
 *
 *   release   SO-side failure: the order is gone, cancelled or closed, the line
 *             was removed, closed, fulfilled or now carries another item, or a
 *             claim was left pending by a crash. The claim is deleted and the lot
 *             mirror cleared. MA 2026-09-17: « SO est void, alors toutes les
 *             réservations tombent », « Ligne supprimée sur le SO ».
 *   handoff   the bundle has LANDED at the line's location. The real inventory
 *             assignment is written onto the SO line (min of the line's open
 *             quantity and the stock there), and the claim is released once the
 *             line is fully covered. MA 2026-09-22: the receipt writes the SO LINE
 *             quantity, the remainder stays locked until the physical split.
 *   keep      still on the water, or a SUPPLY-side failure. Never released
 *             (MA 2026-09-22: no auto-release); the reason is written to the lot
 *             mirror so the exception report and the screen can show it.
 *
 * WHY A SCHEDULED JOB AND NOT A USER EVENT. 47% of hardwood sales orders are
 * created or edited by hand outside the trader screen (I7b), and this repo has
 * no sales-order user event at all, so events cannot be relied on to notice a
 * deleted line. The job is the primary mechanism, and it is idempotent: running
 * it twice does nothing the first run did not.
 *
 * The lot MIRROR (custitemnumber_arch_res_*) is written here and only here,
 * because the order endpoint's role cannot write the lot record (measured,
 * INSUFFICIENT_PERMISSION). A Map/Reduce runs with administrator permissions.
 *
 * It also logs at ERROR if any ARC sales-order line carries the PO Allocation
 * segment: MR 5544 has no subsidiary guard and would FIFO-assign such a line
 * after receipt, ignoring the claim (plan I4 and Errata 1).
 *
 * Nothing here sends email. The summary's last AUDIT line is the job's heartbeat:
 * the exception report must show when it last ran, or a dead job reads as "no
 * exceptions".
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/query', 'N/record', 'N/log', '../../shared/archReservation'],
(query, record, log, Reservation) => {

    const HEARTBEAT = 'ARCH reservation reconciler - run complete';

    const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
    const int = (v) => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };
    const rows = (sql, params) => query.runSuiteQL({ query: sql, params: params || [] }).asMappedResults();

    const getInputData = () => {
        const read = Reservation.readClaims(query);
        if (!read.sourced) {
            // Throwing fails the run visibly; an empty input would read as "nothing reserved".
            throw new Error('ARCH reservation claims unreadable: ' + read.error);
        }
        const items = read.rows.map((c) => ({ kind: 'claim', c: c }));

        /* A lot whose mirror names an SO but no claim holds it: a claim deleted by
         * hand, or a mirror written just before a crash. Cleared, so the lot record
         * never claims a reservation nobody holds. */
        try {
            const held = {};
            read.rows.forEach((c) => { held[String(c.lotId)] = true; });
            rows('SELECT id AS lotid FROM inventorynumber ' +
                 'WHERE custitemnumber_arch_res_so IS NOT NULL OR custitemnumber_arch_res_exception IS NOT NULL')
                .forEach((r) => { if (!held[String(int(r.lotid))]) items.push({ kind: 'stale', lotId: int(r.lotid) }); });
        } catch (e) {
            log.audit('ARCH reservation reconciler', 'stale-mirror read failed (non-fatal): ' + e.message);
        }

        // I4 tripwire. Isolated: the segment column does not exist everywhere.
        try {
            const seg = rows("SELECT t.tranid AS tranid FROM transactionline tl " +
                "JOIN transaction t ON t.id = tl.transaction " +
                "WHERE t.type = 'SalesOrd' AND tl.mainline = 'F' AND tl.isclosed = 'F' " +
                "  AND BUILTIN.DF(tl.subsidiary) = 'ARC' AND tl.cseg_po_segment_gl IS NOT NULL");
            if (seg.length) {
                log.error('ARCH reservation - ARC SO LINE CARRIES THE PO ALLOCATION SEGMENT',
                    seg.length + ' open ARC sales-order line(s) carry cseg_po_segment_gl (' +
                    seg.slice(0, 10).map((r) => r.tranid).join(', ') + '). MR 5544 FIFO-assigns such lines ' +
                    'after receipt with no subsidiary guard, ignoring a bundle reservation. See Feedback 8 I4.');
            }
        } catch (e) {
            log.audit('ARCH reservation reconciler', 'segment tripwire skipped: ' + e.message);
        }
        return items;
    };

    /** List value internal ids by script id; they differ between accounts. */
    let exceptionIds = null;
    const exceptionId = (code) => {
        if (!exceptionIds) {
            exceptionIds = {};
            rows('SELECT id, scriptid FROM customlist_arch_res_exception').forEach((r) => {
                exceptionIds[String(r.scriptid).toUpperCase()] = int(r.id);
            });
        }
        return code ? (exceptionIds[String(code).toUpperCase()] || 0) : 0;
    };

    const readMirror = (lotId) => {
        const r = rows('SELECT custitemnumber_arch_res_so AS so, custitemnumber_arch_res_line AS line, ' +
                       '       custitemnumber_arch_res_exception AS exc, ' +
                       "       TO_CHAR(custitemnumber_arch_res_flagged, 'YYYY-MM-DD') AS flagged " +
                       'FROM inventorynumber WHERE id = ?', [lotId]);
        return r.length ? { so: int(r[0].so), line: int(r[0].line), exc: int(r[0].exc), flagged: r[0].flagged || '' } : null;
    };

    /** Writes the mirror only when it differs, so a quiet run writes nothing. */
    const writeMirror = (lotId, want) => {
        const have = readMirror(lotId) || { so: 0, line: 0, exc: 0, flagged: '' };
        const excId = want.exception ? exceptionId(want.exception) : 0;
        const values = {};
        if (have.so !== (want.so || 0)) values.custitemnumber_arch_res_so = want.so || '';
        if (have.line !== (want.line || 0)) values.custitemnumber_arch_res_line = want.line || '';
        if (have.exc !== excId) {
            values.custitemnumber_arch_res_exception = excId || '';
            // First detected: set when an exception appears or changes, cleared with it.
            values.custitemnumber_arch_res_flagged = excId ? new Date() : '';
        }
        if (!Object.keys(values).length) return false;
        record.submitFields({ type: 'inventorynumber', id: lotId, values: values });
        return true;
    };

    const factsFor = (c) => {
        const f = { so: null, line: null, stock: [], assignedOnLineBase: 0, otherCommitBase: 0, poLines: [], poHasReceipt: false };
        if (c.soId) {
            const so = rows('SELECT t.type AS type, t.status AS status FROM transaction t WHERE t.id = ?', [c.soId]);
            f.so = so.length ? { type: String(so[0].type), status: String(so[0].status) } : null;
            if (f.so && c.lineKey) {
                const ln = rows('SELECT tl.id AS lineid, tl.item AS item, tl.location AS location, ' +
                    '       tl.quantity AS qty, tl.quantityshiprecv AS shipped, tl.isclosed AS closed ' +
                    "FROM transactionline tl WHERE tl.transaction = ? AND tl.uniquekey = ? AND tl.mainline = 'F'",
                    [c.soId, c.lineKey]);
                if (ln.length) {
                    f.line = {
                        lineId: int(ln[0].lineid), item: int(ln[0].item), location: int(ln[0].location),
                        qtyBase: Math.abs(num(ln[0].qty)), shippedBase: Math.abs(num(ln[0].shipped)),
                        closed: String(ln[0].closed) === 'T',
                    };
                    /* 🔴 JOINED THROUGH transactionline, NEVER filtered on
                     * ia.transactionline directly. Measured 2026-09-23 in N/query:
                     * `FROM inventoryassignment ia WHERE ia.transaction = ? AND
                     * ia.transactionline = ?` returns ZERO rows (binds and literals
                     * alike) for a line that carries the lot, while REST SuiteQL
                     * returns it. That silent empty kept claim 20 alive on a line
                     * another bundle already filled. The join form returns it. */
                    const onLine = rows('SELECT ia.inventorynumber AS lot, ia.quantity AS q ' +
                        'FROM transactionline tl ' +
                        'JOIN inventoryassignment ia ON ia.transaction = tl.transaction AND ia.transactionline = tl.id ' +
                        'WHERE tl.transaction = ? AND tl.uniquekey = ?', [c.soId, c.lineKey]);
                    f.assignedOnLineBase = onLine.filter((r) => int(r.lot) === c.lotId)
                        .reduce((s, r) => s + Math.abs(num(r.q)), 0);
                    // Every lot on the line (review HIGH 2).
                    f.assignedAllOnLineBase = onLine.reduce((s, r) => s + Math.abs(num(r.q)), 0);
                }
            }
        }
        f.stock = rows('SELECT location, quantityonhand AS oh, quantityonorder AS oo ' +
                       'FROM inventorynumberlocation WHERE inventorynumber = ?', [c.lotId])
            .map((r) => ({ location: int(r.location), onHandBase: num(r.oh), onOrderBase: num(r.oo) }));
        // Any OTHER sales order holding the bundle: the lock should make this
        // impossible, so it blocks the hand-off and is reported.
        f.otherCommitBase = rows('SELECT ia.quantity AS q, tl.quantity AS lq, tl.quantityshiprecv AS sh ' +
            'FROM inventoryassignment ia ' +
            'JOIN transactionline tl ON tl.transaction = ia.transaction AND tl.id = ia.transactionline ' +
            'JOIN transaction t ON t.id = tl.transaction ' +
            "WHERE ia.inventorynumber = ? AND t.type = 'SalesOrd' AND tl.isclosed = 'F' AND t.id <> ?",
            [c.lotId, c.soId || 0]).reduce((s, r) => {
                const ord = Math.abs(num(r.lq)); const open = Math.max(0, ord - Math.abs(num(r.sh)));
                return s + (ord > 0 ? Math.abs(num(r.q)) * open / ord : 0);
            }, 0);
        const po = rows('SELECT t.id AS poid, t.status AS status, tl.isclosed AS closed, tl.quantity AS qty, ' +
            '       tl.quantityshiprecv AS rcv, ia.quantity AS bq ' +
            'FROM inventoryassignment ia ' +
            'JOIN transactionline tl ON tl.transaction = ia.transaction AND tl.id = ia.transactionline ' +
            'JOIN transaction t ON t.id = tl.transaction ' +
            "WHERE ia.inventorynumber = ? AND t.type = 'PurchOrd'", [c.lotId]);
        f.poLines = po.map((r) => ({
            poId: int(r.poid),
            closedLine: String(r.closed) === 'T',
            closedPo: String(r.status || '').split(':').pop() === 'H',
            orderedBase: Math.abs(num(r.qty)), receivedBase: Math.abs(num(r.rcv)), bundleBase: Math.abs(num(r.bq)),
        }));
        const poIds = f.poLines.map((p) => p.poId).filter(Boolean);
        if (poIds.length) {
            f.poHasReceipt = rows('SELECT tl.quantityshiprecv AS rcv FROM transactionline tl ' +
                "WHERE tl.transaction IN (" + poIds.join(',') + ") AND tl.mainline = 'F'")
                .some((r) => Math.abs(num(r.rcv)) > 0);
        }
        return f;
    };

    /** 3.1: the real assignment onto the SO line. DISPLAY units on a sales order. */
    const handOff = (c, f, base) => {
        const rate = rows('SELECT u.conversionrate AS rate FROM item i ' +
            'LEFT JOIN unitstypeuom u ON u.internalid = i.stockunit WHERE i.id = ?', [f.line.item]);
        const r = rate.length ? num(rate[0].rate) : 0;
        if (!(r > 0)) throw new Error('item ' + f.line.item + ' has no stock-unit rate; refusing to guess');
        const so = record.load({ type: record.Type.SALES_ORDER, id: c.soId, isDynamic: false });
        const n = so.getLineCount({ sublistId: 'item' });
        let at = -1;
        for (let i = 0; i < n; i++) {
            if (int(so.getSublistValue({ sublistId: 'item', fieldId: 'lineuniquekey', line: i })) === c.lineKey) { at = i; break; }
        }
        if (at < 0) throw new Error('line ' + c.lineKey + ' not found on SO ' + c.soId);
        const detail = so.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: at });
        const k = Math.max(0, detail.getLineCount({ sublistId: 'inventoryassignment' }));
        detail.setSublistValue({ sublistId: 'inventoryassignment', fieldId: 'issueinventorynumber', line: k, value: c.lotId });
        // Same unit rule as archOrderCreate.assignLots: SO assignment = DISPLAY.
        detail.setSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', line: k,
            value: Math.round((base / r) * 1e5) / 1e5 });
        so.save({ enableSourcing: false, ignoreMandatoryFields: true });
    };

    /**
     * A pending claim whose order DID save (review HIGH 3): find it by the request
     * key and its bare line (same item, same location as the bundle's PO line,
     * the bundle's quantity, no inventory detail, not named by another claim), then
     * complete the claim. Returns { soId, lineKey }, { found: true } when the order
     * exists but the line is ambiguous (kept for a person, never swept), or 0.
     */
    const recoverPending = (c) => {
        if (!c.orderKey || c.soId) return 0;
        // A create that was later appended to reads ARCH-ORDER-<key>[ARCH-APPEND:..]
        // (final review L2), so the create form is matched as a prefix too.
        const so = rows('SELECT id FROM transaction WHERE type = ? AND ' +
            '(externalid = ? OR externalid LIKE ? OR externalid LIKE ?)',
            ['SalesOrd', 'ARCH-ORDER-' + c.orderKey, 'ARCH-ORDER-' + c.orderKey + '[%',
             '%[ARCH-APPEND:' + c.orderKey + ']%']);
        if (so.length !== 1) return 0;
        const po = rows('SELECT tl.location AS loc, ia.quantity AS bq FROM inventoryassignment ia ' +
            'JOIN transactionline tl ON tl.transaction = ia.transaction AND tl.id = ia.transactionline ' +
            "JOIN transaction t ON t.id = tl.transaction WHERE ia.inventorynumber = ? AND t.type = 'PurchOrd'",
            [c.lotId]);
        const soId = int(so[0].id);
        const claimed = {};
        Reservation.readClaims(query).rows.forEach((x) => { if (x.soId === soId && x.lineKey) claimed[x.lineKey] = true; });
        const lines = rows("SELECT tl.id AS lineid, tl.uniquekey AS uk, tl.location AS loc, tl.quantity AS qty FROM transactionline tl " +
            "WHERE tl.transaction = ? AND tl.mainline = 'F' AND tl.item = ? AND tl.isclosed = 'F' " +
            'AND NOT EXISTS (SELECT 1 FROM inventoryassignment ia WHERE ia.transaction = tl.transaction AND ia.transactionline = tl.id)',
            [soId, c.itemId]).filter((r) => !claimed[int(r.uk)])
            // Narrowed by the bundle's own PO line when it is known (final review M2).
            .filter((r) => po.length !== 1 || (int(r.loc) === int(po[0].loc) &&
                Math.abs(Math.abs(num(r.qty)) - Math.abs(num(po[0].bq))) < 1e-6));
        if (lines.length !== 1) return { found: true };
        Reservation.finalize(record, c.claimId, soId, int(lines[0].uk));
        return { soId: soId, lineKey: int(lines[0].uk) };
    };

    const map = (context) => {
        const item = JSON.parse(context.value);
        if (item.kind === 'stale') {
            const changed = writeMirror(item.lotId, {});
            context.write({ key: changed ? 'staleCleared' : 'noop', value: String(item.lotId) });
            return;
        }
        let c = item.c;
        let orderFound = false;
        if (!c.soId && c.orderKey && !c.inactive) {
            const got = recoverPending(c);
            if (got && got.found) orderFound = true;
            if (got && got.lineKey) {
                log.audit('ARCH reservation - claim completed from its order key',
                    (c.lotNo || c.lotId) + ' -> SO ' + got.soId + ' line ' + got.lineKey);
                c = Object.assign({}, c, { soId: got.soId, lineKey: got.lineKey, pending: false });
            }
        }
        const f = factsFor(c);
        f.orderFound = orderFound;
        let d = Reservation.decideClaim(c, f);
        const tag = (c.lotNo || c.lotId) + (c.soNumber ? ' on ' + c.soNumber : '');

        if (d.action === 'handoff') {
            try {
                handOff(c, f, d.handoffBase);
                log.audit('ARCH reservation - handed over', tag + ': ' + d.reason);
                d = d.releaseAfterHandoff
                    ? Object.assign({}, d, { action: 'release', reason: 'handed over at receipt' })
                    : Object.assign({}, d, { action: 'keep' });
            } catch (e) {
                /* Kept, never released: the bundle stays locked and the next run
                 * retries. Reported ON THE LOT (review HIGH 1: a null here wiped a
                 * received-short flag), and at ERROR only the first time, when the
                 * mirror changes, so a stuck hand-off is not an error every 15 min. */
                const why = (e.name || '') + ': ' + (e.message || String(e));
                const first = writeMirror(c.lotId, { so: c.soId, line: c.lineKey, exception: 'VAL_HANDOFF_FAILED' });
                (first ? log.error : log.audit)('ARCH reservation - HAND-OFF FAILED, bundle stays reserved', tag + ': ' + why);
                context.write({ key: 'exception', value: tag + ' | hand-off failed: ' + why });
                return;
            }
        }

        if (d.alert) log.error('ARCH reservation - needs a person', tag + ': ' + d.reason);

        if (d.action === 'release') {
            Reservation.release(record, c.claimId);
            writeMirror(c.lotId, {});
            log.audit('ARCH reservation - released', tag + ': ' + d.reason);
            context.write({ key: 'released', value: tag + ' | ' + d.reason });
            return;
        }
        // keep: mirror the claim (pending claims name nothing yet).
        writeMirror(c.lotId, c.soId ? { so: c.soId, line: c.lineKey, exception: d.exception } : {});
        context.write({ key: d.exception ? 'exception' : 'held', value: tag + ' | ' + d.reason });
    };

    const summarize = (s) => {
        const counts = {};
        s.output.iterator().each((k) => { counts[k] = (counts[k] || 0) + 1; return true; });
        const errs = [];
        s.mapSummary.errors.iterator().each((k, e) => { errs.push(k + ': ' + e); return true; });
        if (s.inputSummary.error) errs.push('input: ' + s.inputSummary.error);
        if (errs.length) log.error('ARCH reservation reconciler - errors', errs.slice(0, 20).join(' || '));
        // The heartbeat. Read by whoever needs "when did the check last run".
        log.audit(HEARTBEAT, JSON.stringify({ counts: counts, errors: errs.length }));
    };

    return { getInputData, map, summarize };
});
