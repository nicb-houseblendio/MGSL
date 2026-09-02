/**
 * CWP ARCH sales-order creation — the library behind the trader screen's wizard.
 *
 * The differentiator for this screen: hardwood traders build the SO from the
 * trader screen rather than the NetSuite SO form ("la grosse différence avec les
 * autres trader screens, c'est qu'on a la fonctionnalité de créer des SO à partir
 * du trader screen", 2026-08-11 call).
 *
 * ── Why this writes inventory detail, and why that is the whole point ────────
 * The reservation lock is NOT a new mechanism. Committed already derives from SO
 * lines, so a line that carries its lot in inventory detail locks that bundle
 * for free, and it locks it identically for orders raised on the native form.
 * That is what makes Marc-Antoine's "form fallback" safe.
 *
 * A line WITHOUT inventory detail still contributes correct quantity to the row
 * but cannot be attributed to any lot, which the ARCH cache publishes as
 * `unattributed`. Today every seeded line lands there: 526 units of reserve that
 * no lot claims (measured 2026-08-20). Writing detail here is what moves that
 * figure to 0 and makes the drill-down agree with the column.
 *
 * So `unattributed` is also this module's acceptance test. Create an order, let
 * the cache rebuild, and assert that per-lot reserve rose by what was ordered
 * while `unattributed` stayed flat.
 *
 * ── Units: the two sides are NOT the same, and the codebase has been bitten ──
 * Three separate bugs have come from this asymmetry, so it is stated once here
 * and relied on below:
 *
 *   SO line `quantity`        DISPLAY units (board feet). NetSuite converts to
 *                             base on save. Verified by `trueUpSalesOrderLine`
 *                             in archSplitExecute, which writes a measured
 *                             board-foot figure straight into this field.
 *   inventoryassignment       BASE units. The ARCH cache builder divides BOTH
 *   `quantity`                `inventoryassignment.quantity` and
 *                             `transactionline.quantity` by the same rate
 *                             (builder lines 839-842 and 904-912), which is the
 *                             only way its `unattributed = totals - claimed`
 *                             subtraction can be meaningful.
 *
 * Lumber is rate 0.001 and is the only ARCH category that exposes a mistake
 * here; Veneer and Ovals are rate 1 and pass a wrong conversion through
 * unchanged. Do not "simplify" either side.
 *
 * ✅ EVERY WRITE TAKES DISPLAY. NetSuite does the converting, not us.
 *
 *   SO line `quantity`                     DISPLAY
 *   SO   inventoryassignment.quantity      DISPLAY
 *   IA   `adjustqtyby` and assignment      DISPLAY
 *
 * 🔴 THIS BLOCK USED TO SAY THE IA SIDE TOOK **BASE**, AND IT WAS WRONG.
 * Corrected 2026-09-02. The claim rested on IA-CWP-347, where the stored line
 * quantity and the stored assignment quantity are both 1.103 — but that is a
 * READ-BACK of what NetSuite stored, and it says nothing about what was passed
 * in. Two runs of the same function settle it:
 *
 *   IA-CWP-412  680 BF remainder  passed BASE (0.68)  → stored 6.8E-4  ❌ 1000x short
 *   IA-CWP-413  650 BF remainder  passed DISPLAY      → stored 0.65    ✅
 *   IA-CWP-467  645 BF remainder  passed DISPLAY      → stored 0.645   ✅
 *
 * The old note also ended "Do not 'make these consistent'". They already are,
 * and that instruction was defending an asymmetry that does not exist. It is
 * removed deliberately — `archSplitExecute.js:269-280` says the same thing
 * correctly ("pass DISPLAY units when WRITING. Nothing here is converted"), and
 * the two must not disagree again.
 *
 * `verifyAssignments` re-reads what NetSuite actually stored rather than trusting
 * any of this. Keep it — it is the only automated check that would notice a unit
 * error at all, and note it compares BASE to BASE, so it cannot catch a
 * stock-unit/sale-unit divergence. That is what the guard in `resolveLines` is for.
 *
 * ── What is deliberately NOT accepted from the caller ────────────────────────
 * Subsidiary and department come from the customer and the location, never from
 * the request, for the same reason the split endpoint stopped accepting a GL
 * account: a screen must not choose where a transaction posts. Every item is
 * checked against the hardwood segment, so this endpoint cannot be used to write
 * IND or MTL orders even by someone crafting their own payload.
 */
define(['N/record', 'N/query', 'N/search', 'N/runtime', 'N/log', 'N/render', 'N/email',
        './archSplitExecute'],
// AMD BINDS POSITIONALLY. N/render and N/email were appended to the array and
// their parameters inserted at the SAME positions, before splitLib, in one edit.
(record, query, search, runtime, log, render, email, splitLib) => {

    /**
     * `cseg_subsidiary_loc` = 1 is Hardwood. Named `_loc` because Lucas and Julie
     * first built it on locations; the 2026-08-17 call moved it to the SKU and
     * the name did not follow. Scoping by location would have been wrong anyway:
     * CWP Prevost is tagged Softwood and holds most of the hardwood volume.
     */
    const HARDWOOD_SEGMENT = 1;

    /**
     * Split marker columns. These ALREADY EXIST — they were created for the
     * Phase 2 split mechanism and `archSplitExecute` reads them off the SO
     * sublist. Nothing new has to be created to mark a split line; the earlier
     * note claiming "no split marker field" predates them.
     *
     * Marc-Antoine's desired-state PDF settles the granularity: "Split specified
     * at the SO line level", not a custom record.
     */
    const F_SPLIT        = 'custcol_mgsl_split';
    const F_SPLIT_BF     = 'custcol_mgsl_split_bf';
    const F_SPLIT_STATUS = 'custcol_mgsl_split_status';

    /* ── Reman line fields ───────────────────────────────────────────────────
     * Marc-Antoine, 2026-08-21, asked where reman should live on the SO:
     * "Sur la ligne du SO ca devrait peut etre un sublist field ou qq chose du
     * genre." So: line-level custom fields, the same shape as the split ones.
     *
     * These are NOT the same thing as `custcol_remanufacturing_order`, which
     * already exists in the account. That one is `colsale = F` / `coljournal =
     * T` -- a SELECT pointing at a transaction, used on JOURNAL lines for
     * remanufacturing traceability. It cannot be written on a sales order line
     * at all, so it is not a candidate however much its name suggests it is.
     *
     * ⚠️ THEY MAY NOT BE DEPLOYED. Objects cannot be pushed from here -- only
     * `file:upload` works in this project, and the full deploy.xml is off
     * limits because it resets deployment records. So `remanFieldsPresent`
     * probes the record and the write is skipped when they are absent. The
     * order still saves; the result reports `remanStored: false`; and the day
     * somebody deploys the four objects this starts working with no code
     * change and no redeploy of this file.
     */
    const F_REMAN_PLANE     = 'custcol_mgsl_reman_plane';
    const F_REMAN_PLANE_TGT = 'custcol_mgsl_reman_plane_tgt';
    const F_REMAN_CUT       = 'custcol_mgsl_reman_cut';
    const F_REMAN_CUT_LEN   = 'custcol_mgsl_reman_cut_len';
    const STATUS_PENDING = 'Pending';

    /**
     * Internal id of the "Pending" value on `customlist_mgsl_split_status`.
     *
     * Needed because standard mode has no `setSublistText`, so the value has to
     * go in by id rather than by label. Looked up rather than assumed: the list
     * holds 1 = Pending, 2 = Done (read 2026-08-20).
     *
     * Resolved at runtime with the measured value as a fallback, because a list
     * value id is exactly the sort of thing a sandbox refresh moves. If the lookup
     * fails the split still records, and the warehouse queue reads the status by
     * text, so a wrong id would surface as a queue miss rather than silent data
     * loss.
     */
    const splitStatusPendingId = () => {
        try {
            const rows = query.runSuiteQL({
                query: 'SELECT id FROM customlist_mgsl_split_status WHERE name = ?',
                params: [STATUS_PENDING],
            }).asMappedResults();
            const id = rows.length ? int(rows[0].id) : null;
            if (id) return id;
        } catch (e) {
            log.audit('ARCH Order Create',
                'Could not resolve the Pending split-status id, falling back to 1: ' +
                (e.message || String(e)));
        }
        return 1;
    };

    /**
     * Header fields. Every id below was confirmed to resolve against live
     * NetSuite on 2026-08-20 by selecting it from `transaction`.
     *
     * ⚠️ Customer PO is `otherrefnum`, NOT `custbody_customer_po_num`. The
     * latter exists and is dead: 0 of 1,728 SOs carry it, against 1,200 for
     * `otherrefnum`. Do not "correct" this to the more descriptive name.
     */
    const H_CUSTOMER_PO = 'otherrefnum';
    const H_INCOTERMS   = 'custbody_incoterms';
    const H_SHIP_DATE   = 'custbody_mgsl_expectedshipdate';
    const H_SALES_REP   = 'custbody_sales_rep';
    const H_INSURANCE   = 'custbody_mgsl_insurancerate';

    /**
     * Operations + insurance rate stamped onto the order.
     *
     * Measured across all 4,216 SOs in the account on 2026-08-20: 3,979 (94.4%)
     * carry 0.003, the range is 0.0015-0.015 and only 48 are null. The front end
     * prices the draft against the same default, so stamping it here keeps the
     * margin the trader saw and the margin the order records in agreement. If it
     * were left to NetSuite's own default the two could silently diverge.
     */
    const INSURANCE_RATE_DEFAULT = 0.003;

    /**
     * Department stamped on ARCH orders.
     *
     * 11 is "Hardwood" in this account (9 Trading, 10 Softwood, 11 Hardwood,
     * read 2026-08-20). NetSuite makes department MANDATORY on the sales-order
     * form and does not source it from the customer, so it has to come from
     * somewhere; Nic's design says it should follow the trader's role, and until
     * roles are settled the screen's own subject matter is the honest default.
     *
     * Overridable by script parameter so it never needs a deploy to change. Note
     * the real MTL orders in this account use 9 (Trading) rather than 10, so if
     * MGSL turns out to book hardwood under Trading too, this is the one value to
     * change.
     */
    const DEPARTMENT_DEFAULT = 11;

    /**
     * The sales-order form ARCH orders MUST end up on, and how they get there.
     *
     * 🔴 THE FORM DECIDES WHETHER A LOT CAN BE ATTACHED AT ALL. Inventory Detail
     * is a per-form column on the ITEM sublist, and its visibility decides whether
     * `inventorydetail` exists as a subrecord. Read out of the form definitions
     * on 2026-08-20:
     *
     *   Industriel - Sales Order   INVENTORYDETAIL visible=F   globally preferred
     *   CWP MTL - Sales Order      INVENTORYDETAIL visible=T
     *   CWP ARC - Sales Order      INVENTORYDETAIL visible=T
     *
     * ⛔ AND IT CANNOT BE SELECTED IN CODE. `setValue` on `customform` throws
     * `MODULE_DOES_NOT_EXIST: /NLRecordScripting.scriptInit$sys.js` — at setValue
     * in dynamic mode, and at save in standard mode. Measured against BOTH the MTL
     * and ARCH forms, which fail identically, so this is a platform constraint in
     * this account and not a broken form. Do not try again.
     *
     * ✅ SO THE FORM COMES FROM THE EXECUTING ROLE. Julie already made the ARCH
     * form preferred for "MGSL - CWP ARC - Trader" (customrole2181) and nine other
     * roles. Administrator is not among them, and Industriel is globally
     * preferred, which is why an order created by an Administrator-as-role
     * deployment lands on a form that cannot carry a lot.
     *
     * 🔴 THEREFORE THIS DEPLOYMENT'S `runasrole` IS LOAD-BEARING, not a security
     * detail. It must be a role the ARCH form is preferred for. Note this is not a
     * compromise on the split endpoint's reasoning: THAT one needs Administrator
     * because it posts Inventory Adjustments, which a trader cannot. Creating a
     * sales order needs only Sales Order permission, so the trader role is the
     * more correct executor here, not a weaker one.
     *
     * The id below is recorded for diagnostics and for the check in
     * `warnIfFormUnavailable`; nothing sets it.
     */
    const ARCH_SO_FORM_DEFAULT = 386;

    /** Hard cap on lines per request. Real ARCH orders are a handful. */
    const MAX_LINES = 200;

    /**
     * Sanity ceiling on price per unit. The dearest thing on this screen is
     * zebrawood at roughly $14/BF, and the veneer's $1,695/SQFT is Marc-Antoine's
     * own quantity problem rather than a real price, so this is orders of
     * magnitude clear of anything legitimate.
     */
    const MAX_PRICE_PER_UNIT = 100000;

    /**
     * Strict positive integer, or null.
     *
     * `parseInt` is deliberately NOT used. It accepts trailing garbage and
     * truncates, so an id can silently resolve to a DIFFERENT valid record:
     * measured 2026-08-20, `parseInt` turned "49783abc" into 49783, 49783.9 into
     * 49783 and — worst — "1e5" into 1. The last one only failed safe because lot
     * 1 happened to have no stock at that location.
     */
    const int = (v) => {
        if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : null;
        if (typeof v !== 'string') return null;
        if (!/^\d+$/.test(v.trim())) return null;
        const n = Number(v.trim());
        return Number.isSafeInteger(n) && n > 0 ? n : null;
    };

    /**
     * Strict finite number, or null. Rejects trailing garbage the same way, so
     * "100abc" is refused rather than silently becoming 100.
     */
    const num = (v) => {
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v !== 'string') return null;
        if (!/^-?\d+(\.\d+)?$/.test(v.trim())) return null;
        const n = Number(v.trim());
        return isFinite(n) ? n : null;
    };

    const dedupe = (arr) => {
        const seen = {};
        const out = [];
        arr.forEach((v) => {
            const k = String(v);
            if (!seen[k]) { seen[k] = true; out.push(v); }
        });
        return out;
    };

    /** Lenient parse, for values NetSuite itself returns and we already trust. */
    const numOr = (v, fallback) => {
        const n = parseFloat(v);
        return isFinite(n) ? n : fallback;
    };

    /**
     * JSON over HTTP loses boolean typing constantly, so `=== true` is not enough.
     *
     * 🔴 Measured 2026-08-20: with the strict check, a payload of
     * `isSplit: "true", splitTargetQty: 300, qty: 2206` was accepted as a
     * NON-split line and committed the WHOLE 2,206 BF bundle when 300 was asked
     * for. Same normalization the MTL builder uses for `forceFull`, which exists
     * because of the same class of bug.
     */
    const bool = (v) =>
        v === true || v === 1 || v === 'T' || v === 't' ||
        (typeof v === 'string' && v.trim().toLowerCase() === 'true');

    /**
     * Parses YYYY-MM-DD into a Date, or null.
     *
     * Built explicitly rather than handed to `new Date(str)`, which parses an
     * ISO date as UTC midnight and can therefore land on the previous day once
     * NetSuite renders it in the account's timezone. This project already has two
     * clocks to worry about (scriptnote is PT, file timestamps render ET), and a
     * ship date that is a day early is the kind of thing nobody notices until a
     * truck is booked.
     */
    const parseIsoDate = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
        if (!m) return null;
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        const dt = new Date(y, mo - 1, d);
        // Rejects 2026-02-30, which would otherwise roll into March.
        if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
        return dt;
    };

    /**
     * Operations + insurance rate, from configuration rather than the request.
     *
     * Falls back to the measured account default when the parameter is unset, so
     * an unconfigured deployment still stamps the right figure rather than 0.
     */
    /** Reads a script parameter, tolerating a library loaded outside a script. */
    const param = (name) => {
        try {
            return runtime.getCurrentScript().getParameter({ name: name });
        } catch (e) {
            return null;
        }
    };

    const departmentId = () => int(param('custscript_arch_department')) || DEPARTMENT_DEFAULT;

    const archFormId = () => int(param('custscript_arch_so_form')) || ARCH_SO_FORM_DEFAULT;

    /**
     * Incoterms fallback when the wizard sends none.
     *
     * Every one of the 1,728 sales orders since 2026-06-01 carries a value, so
     * there is no "blank" precedent to copy, and the field is mandatory. 3 is what
     * the real form-373 orders in this account use.
     */
    const incotermsDefault = () => int(param('custscript_arch_incoterms')) || 3;

    const insuranceRate = () => {
        const n = num(param('custscript_arch_insurance_rate'));
        return n !== null && n >= 0 && n < 1 ? n : INSURANCE_RATE_DEFAULT;
    };

    /**
     * A refusal the caller can act on, as opposed to a system failure.
     *
     * The name is the ONLY classifier. The Suitelet used to pattern-match the
     * message text, which meant a genuine NetSuite error containing a word like
     * "already" would be logged at AUDIT and lost among the routine refusals.
     */
    const refusal = (message) => {
        const e = new Error(message);
        e.name = 'ARCH_ORDER_REFUSED';
        return e;
    };

    /**
     * The employee to credit on the mandatory Sales Team line.
     *
     * 🔴 The candidate MUST be a real sales rep. NetSuite rejects the whole save
     * with an opaque `UNEXPECTED_ERROR` if it is not, which cost real time to
     * diagnose: the integration user this endpoint's token runs as ("House Blend
     * 2", id 3136) has `issalesrep = F`, while both employees on the real order
     * that was used as a template are `T`.
     *
     * Order of preference, and it is a business order rather than a technical one:
     *   1. whoever the request names, so a trader ordering on someone's behalf works
     *   2. the requesting user, which is the normal case and the right attribution
     *      for an order a trader builds on this screen
     *   3. the customer's assigned rep, when the caller is not one
     *
     * If none of those is a sales rep the order is REFUSED. Picking an arbitrary
     * rep would misattribute commission on a real sales document, and that is not
     * a guess worth making silently.
     */
    const salesRepCandidates = (requestedId, userId) => dedupe(
        [requestedId, userId, int(param('custscript_arch_default_sales_rep'))].filter(Boolean));

    /**
     * WHY no rep could be resolved. Called only on the refusal path, so it costs
     * nothing on the happy path.
     *
     * 🔴 This exists because one message covered two unrelated causes, and that
     * ambiguity cost a full day. "No sales rep could be determined" was read as
     * "this person is not flagged as a sales rep", which sent us to the client
     * asking them to tick a checkbox on an employee record. The real cause was
     * that the ROLE COULD NOT SEE the employee, because `runasrole` scopes every
     * read in this module to that role's subsidiaries. Same message, opposite
     * fix, and the wrong one was an ask we nearly made of MGSL.
     *
     * The discriminator is the SAME query without the `issalesrep` predicate. If
     * the row comes back, the role can see the person and the flag is the
     * problem. If it does not, the role cannot see them at all and no employee
     * record needs changing.
     */
    const diagnoseSalesRep = (requestedId, userId, customerId) => {
        /*
         * ⚠️ The first version of this probed the candidate list as a SET and
         * reported whatever it found, which produced two wrong answers:
         *
         *   - It never looked at the customer's rep, yet the refusal only fires
         *     when the candidates AND that rep have both failed. So it could say
         *     "this customer has none assigned" about a customer who has one.
         *   - With a requested rep the role cannot see plus a caller who is
         *     visible but not a rep, the probe saw only the caller and answered
         *     NOT_A_SALES_REP — telling somebody to tick a box on the WRONG
         *     employee while the actual problem was the rep they had picked.
         *
         * So it now diagnoses the EXPLICIT CHOICE first and reports on that
         * specific id, then the caller, then the customer. Same order the
         * resolver tries them in, which is the only order whose answer is
         * actionable.
         */
        const probe = (id) => {
            if (!id) return null;
            const rows = query.runSuiteQL({
                query: 'SELECT id, issalesrep, isinactive FROM employee WHERE id = ' + id,
            }).asMappedResults();
            if (!rows.length) return 'NOT_VISIBLE';          // invisible OR nonexistent
            if (String(rows[0].issalesrep) !== 'T') return 'NOT_A_REP';
            if (String(rows[0].isinactive) === 'T') return 'INACTIVE';
            return 'USABLE';
        };

        try {
            // The trader's explicit pick. Its verdict wins, because it is the one
            // thing they can act on directly.
            if (requestedId) {
                const v = probe(requestedId);
                if (v === 'NOT_VISIBLE') return 'REQUESTED_NOT_VISIBLE';
                if (v === 'NOT_A_REP') return 'REQUESTED_NOT_A_REP';
                if (v === 'INACTIVE') return 'REQUESTED_INACTIVE';
                // 'USABLE' should be unreachable: the resolver would have taken
                // it. Fall through rather than assert, so a race cannot turn a
                // refusal into an exception.
            }

            const configured = int(param('custscript_arch_default_sales_rep'));
            if (!requestedId && !configured && probe(userId) === 'NOT_A_REP') {
                return 'CALLER_NOT_A_REP';
            }

            // The customer leg, which the old version ignored entirely.
            const cust = query.runSuiteQL({
                query: 'SELECT salesrep FROM customer WHERE id = ?',
                params: [customerId],
            }).asMappedResults();
            const custRep = cust.length ? int(cust[0].salesrep) : 0;
            if (!custRep) return 'NO_CUSTOMER_REP';
            return 'CUSTOMER_REP_UNUSABLE';
        } catch (e) {
            // Diagnosis must never be the thing that fails the request. The
            // caller already has a refusal to report either way.
            log.error('ARCH Order Create — sales rep diagnosis failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return 'UNKNOWN';
        }
    };

    const resolveSalesRep = (requestedId, userId, customerId) => {
        // A configured rep is the LAST resort, and deliberately has no built-in
        // default.
        //
        // ⚠️ This parameter is EMPTY by default ON PURPOSE. Filling it in with
        // some plausible rep would attribute commission on real sales documents
        // to a person nobody chose. Leaving it empty keeps the refusal, which is
        // recoverable; a wrong default is not.
        //
        // ⚠️ **The sentence that used to end this comment was wrong**, and it was
        // the load-bearing wrong claim in a chain that reached the client: "the
        // better fix is upstream: flag ARCH traders as sales reps on their
        // employee records." It is NOT upstream. The 2026-08-20 observation behind
        // it was real — the trader role cannot read the employee table, so the
        // dropdown was empty and all three legs missed — but the conclusion
        // inverted cause and effect. The dropdown was empty because its list came
        // from the RESTlet, which ignores `runasrole` and runs as the caller. With
        // the list served by this Suitelet instead (see `listSalesReps`) a trader
        // picks any of the 15 reps this role can write for, and no employee record
        // needs touching. Fixed 2026-08-25.
        //
        // Whether an ARCH trader should ALSO be a rep in their own right is a real
        // business question, but it is not what makes this function work.
        const candidates = salesRepCandidates(requestedId, userId);

        if (candidates.length) {
            const valid = query.runSuiteQL({
                query:
                    'SELECT id FROM employee ' +
                    'WHERE id IN (' + candidates.join(',') + ') ' +
                    "  AND issalesrep = 'T' AND isinactive = 'F'",
            }).asMappedResults().map((r) => int(r.id));

            for (let i = 0; i < candidates.length; i++) {
                if (valid.indexOf(candidates[i]) !== -1) return candidates[i];
            }
        }

        // Fall back to whoever covers the customer.
        const rows = query.runSuiteQL({
            query:
                'SELECT c.salesrep AS repid FROM customer c ' +
                'JOIN employee e ON e.id = c.salesrep ' +
                "WHERE c.id = ? AND e.issalesrep = 'T' AND e.isinactive = 'F'",
            params: [customerId],
        }).asMappedResults();

        return rows.length ? int(rows[0].repid) : null;
    };

    /**
     * The sales reps this endpoint can actually credit.
     *
     * 🔴 Served from HERE rather than from the RESTlet, and that is the whole
     * point. A RESTlet ignores `runasrole` and runs as the CALLER, and the ARCH
     * trader role cannot read the employee table at all ("Record 'employee' was
     * not found"). So the wizard's dropdown came back empty for the only role
     * that needs it, while the control itself was built and working. This
     * Suitelet runs as `customrole2184`, which can read employees: proven by
     * `resolveSalesRep` resolving employee 2085 on SO-CWP-001344 and 001345.
     *
     * Living in the same module as `resolveSalesRep` is deliberate. The list and
     * the validator now run the same predicate under the same role, so the screen
     * cannot offer a rep the write path will then refuse. That was a real defect:
     * an ARC rep in a subsidiary this role cannot see was offered by the dropdown
     * and then rejected with "No sales rep could be determined", naming somebody
     * the screen had suggested one step earlier.
     *
     * ⚠️ Do NOT add a subsidiary filter. The equivalent list on the RESTlet says
     * why: scoping to the requested subsidiary returned an empty list and blocked
     * the wizard outright. The role's own scope is already the correct filter,
     * and it is applied by NetSuite rather than by us.
     */
    const listSalesReps = () => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT e.id AS id, e.entityid AS name, ' +
                    '       BUILTIN.DF(e.subsidiary) AS subsidiaryname ' +
                    'FROM employee e ' +
                    "WHERE e.issalesrep = 'T' AND e.isinactive = 'F' " +
                    'ORDER BY e.entityid',
            }).asMappedResults();

            return {
                salesReps: rows.map((r) => ({
                    id: String(r.id),
                    name: String(r.name || ('Employee ' + r.id)),
                    subsidiaryName: r.subsidiaryname ? String(r.subsidiaryname) : null,
                })),
            };
        } catch (e) {
            // Never throws. An empty list is exactly today's behaviour, so a
            // failure here cannot be worse than not having made this change.
            log.error('ARCH Order Create — sales rep list failed',
                (e.name || '') + ': ' + (e.message || String(e)));
            return { salesReps: [], error: (e.name || '') + ': ' + (e.message || String(e)) };
        }
    };

    /**
     * Sets an OPTIONAL field only if the record actually has it.
     *
     * 🔴 A `setValue` on a field the record does not carry throws
     * `UNEXPECTED_ERROR` from `record.save` with no usable message, taking the
     * whole order down. That happened with `custbody_mgsl_expectedshipdate`:
     * SuiteQL will happily SELECT that column from `transaction`, which is how it
     * came to be treated as verified, but it is not on the sales-order record and
     * the fields that are are `custbody_ship_week`, `custbody_delivery_date` and
     * `custbody_pickup_date`.
     *
     * Lesson worth keeping: a column being selectable in SuiteQL says nothing
     * about whether a field exists on a record or can be written to it.
     *
     * Mandatory fields are deliberately NOT routed through this. If `department`
     * or `location` ever vanished, failing loudly is correct.
     */
    const setIfPresent = (rec, fieldId, value, label) => {
        let field = null;
        try {
            field = rec.getField({ fieldId: fieldId });
        } catch (e) {
            field = null;
        }
        if (!field) {
            log.audit('ARCH Order Create',
                'Field ' + fieldId + ' is not on the sales-order record, so ' +
                (label || 'that value') + ' was not set. The order is otherwise complete.');
            return false;
        }
        rec.setValue({ fieldId: fieldId, value: value });
        return true;
    };

    /**
     * Sets Incoterms, which is a SELECT and mandatory on the sales-order form.
     *
     * The wizard may send either an internal id or the label a trader picked, so
     * both are handled rather than assuming one. Shared by the create and append
     * paths deliberately: append was missing this entirely, and NetSuite refuses
     * the save of an EXISTING record that has no incoterms just as readily as a
     * new one.
     */
    const applyIncoterms = (rec, h) => {
        const id = int(h && h.incoterms);
        if (id) {
            rec.setValue({ fieldId: H_INCOTERMS, value: id });
        } else if (h && h.incoterms) {
            rec.setText({ fieldId: H_INCOTERMS, text: String(h.incoterms) });
        } else {
            rec.setValue({ fieldId: H_INCOTERMS, value: incotermsDefault() });
        }
    };

    /**
     * The customer address to ship to.
     *
     * 🔴 MANDATORY ON THE ARCH FORM, and not on Industriel — form 386 refuses with
     * "Please enter value(s) for: Ship To Select". Different form, different
     * mandatory fields, so this only surfaced once orders started landing on 386.
     *
     * Derived rather than demanded, because the caller should not have to know a
     * customer's address ids. Preference order: what the request names, then the
     * customer's default SHIPPING address, then its default BILLING address, then
     * its only address. The billing fallback matters: the test customer carries
     * one address flagged billing-but-not-shipping, which is a perfectly ordinary
     * way for a customer record to be set up.
     *
     * Returns null when the customer has no addresses at all, which is a refusal
     * rather than something to invent.
     */
    const resolveShipAddress = (customerId, requested) => {
        const asked = int(requested);
        if (asked) return asked;

        const rows = query.runSuiteQL({
            query:
                // ⚠️ `internalid`, the ADDRESS BOOK entry, not `addressbookaddress`.
                // The latter is the address record itself and NetSuite rejects it:
                // "Invalid Field Value 9460 for the following field: shipaddresslist".
                'SELECT internalid AS addr, defaultshipping, defaultbilling ' +
                'FROM customeraddressbook WHERE entity = ?',
            params: [customerId],
        }).asMappedResults();
        if (!rows.length) return null;

        const pick = (test) => {
            for (let i = 0; i < rows.length; i++) {
                if (test(rows[i])) return int(rows[i].addr);
            }
            return null;
        };
        return pick((r) => String(r.defaultshipping) === 'T')
            || pick((r) => String(r.defaultbilling) === 'T')
            || int(rows[0].addr);
    };

    /** The one location every line ships from, or null when they differ. */
    const soleLocation = (lines) => {
        const ids = dedupe(lines.map((l) => l.locationId));
        return ids.length === 1 ? ids[0] : null;
    };


    /* ── Resolution and validation ───────────────────────────────────────────*/

    /**
     * Reads live state for every (lot, location) the order touches, in ONE query.
     *
     * Keyed `lotId__locationId`. Every id is parsed to a positive integer before
     * it reaches the SQL, so the IN lists cannot carry anything but numbers.
     *
     * Reads `inventorynumberlocation`, the same table the cache builder and the
     * split library both use, so a quantity refused here matches what the trader
     * was looking at rather than being a second opinion.
     *
     * The conversion rate is joined in here rather than looked up per line. A
     * twelve-line order calling `checkedStockUnitRate` once per line is twelve extra
     * SuiteQL round trips at 10 governance units each, on an endpoint with a
     * 1,000-unit budget that also has to save a transaction.
     *
     * The join returns the cross product of the requested lots and locations, so
     * it can carry pairs nobody asked for. That is harmless: every read is by an
     * exact `lotId__locationId` key taken from the line itself.
     */
    const readLotStates = (lotIds, locationIds) => {
        const lots = lotIds.map(int).filter(Boolean);
        const locs = locationIds.map(int).filter(Boolean);
        if (!lots.length || !locs.length) return {};

        const rows = query.runSuiteQL({
            query:
                'SELECT ' +
                '  inl.inventorynumber   AS lotid, ' +
                '  inv.inventorynumber   AS lotname, ' +
                '  inv.item              AS itemid, ' +
                '  i.itemid              AS itemcode, ' +
                '  i.cseg_subsidiary_loc AS segment, ' +
                '  inl.location          AS locationid, ' +
                '  inl.quantityonhand    AS storedqty, ' +
                '  i.stockunit           AS stockunit, ' +
                '  i.saleunit            AS saleunit, ' +
                '  u.conversionrate      AS rate ' +
                'FROM inventorynumberlocation inl ' +
                'JOIN inventorynumber inv ON inv.id = inl.inventorynumber ' +
                'JOIN item i              ON i.id  = inv.item ' +
                'LEFT JOIN unitstypeuom u ON u.internalid = i.stockunit ' +
                'WHERE inl.inventorynumber IN (' + lots.join(',') + ') ' +
                '  AND inl.location        IN (' + locs.join(',') + ')',
        }).asMappedResults();

        const byKey = {};
        rows.forEach((r) => {
            byKey[String(r.lotid) + '__' + String(r.locationid)] = {
                lotId:      int(r.lotid),
                lotName:    String(r.lotname),
                itemId:     int(r.itemid),
                itemCode:   String(r.itemcode),
                segment:    int(r.segment),
                locationId: int(r.locationid),
                storedQty:  numOr(r.storedqty, 0),
                // Both units, because the rate below is keyed on the STOCK unit
                // while the SO line NetSuite writes is keyed on the SALE unit.
                // Free to carry: same row, same query. See the guard in resolveLines.
                stockUnit:  int(r.stockunit),
                saleUnit:   int(r.saleunit),
                rate:       numOr(r.rate, 0),
            };
        });
        return byKey;
    };

    /**
     * How much of each lot is ALREADY committed on another sales order.
     *
     * 🔴 THIS IS THE CHECK THAT STOPS OVERSELLING, and its absence was the worst
     * defect in the first version of this file. `quantityonhand` is PHYSICAL
     * stock: it does not net what is already sold. Proven in this account on
     * 2026-08-20 — lot 49409 reads 194.56 on hand while two separate open,
     * unshipped sales orders each assign 28.16 of it.
     *
     * ⚠️ And `inventorynumberlocation.quantityavailable` is NOT a shortcut for
     * this. It equalled `quantityonhand` on all 1,627 rows in the account despite
     * those commitments existing, so it is not commitment-aware here. Do not
     * "simplify" this function away by reading that column.
     *
     * Keyed `lotId__locationId`, in BASE units, matching `ia.quantity`.
     *
     * ── Why shipped quantity is apportioned ─────────────────────────────────
     * Once a line ships, that wood physically left, so `quantityonhand` has
     * already dropped by it. Counting the whole assignment again would deduct it
     * twice and under-report what is sellable. Assignments are per lot while
     * shipping is per line, so the open share of the line is applied to its
     * assignments: fully unshipped gives 1 (the normal case), fully shipped gives
     * 0, and a part-shipped line gives the remainder.
     */
    const readCommitments = (lotIds) => {
        const lots = dedupe(lotIds.map(int).filter(Boolean));
        if (!lots.length) return {};

        const rows = query.runSuiteQL({
            query:
                'SELECT ' +
                '  ia.inventorynumber   AS lotid, ' +
                '  tl.location          AS locationid, ' +
                '  ia.quantity          AS assignedqty, ' +
                '  tl.quantity          AS lineqty, ' +
                '  tl.quantityshiprecv  AS shipped ' +
                'FROM transactionline tl ' +
                'JOIN transaction t ON t.id = tl.transaction ' +
                // Both keys. `transactionline.id` is unique only WITHIN a
                // transaction, so joining on the line id alone cross-matches
                // unrelated transactions that share a line number. Measured: 35%
                // of lines have id <> linesequencenumber.
                'JOIN inventoryassignment ia ' +
                '       ON ia.transaction = t.id AND ia.transactionline = tl.id ' +
                "WHERE t.type = 'SalesOrd' " +
                "  AND tl.mainline = 'F' " +
                "  AND tl.isclosed = 'F' " +
                '  AND ia.inventorynumber IN (' + lots.join(',') + ')',
        }).asMappedResults();

        const byKey = {};
        rows.forEach((r) => {
            const ordered = Math.abs(numOr(r.lineqty, 0));
            const moved   = Math.abs(numOr(r.shipped, 0));
            const openShare = ordered > 0 ? Math.max(0, (ordered - moved) / ordered) : 0;
            const assigned  = Math.abs(numOr(r.assignedqty, 0)) * openShare;
            if (assigned <= 0) return;
            const key = String(int(r.lotid)) + '__' + String(int(r.locationid));
            byKey[key] = (byKey[key] || 0) + assigned;
        });
        return byKey;
    };

    /**
     * Commitment on an item at a location that NO lot claims, in BASE units.
     *
     * 🔴 WITHOUT THIS THE LOT-LEVEL GUARD IS BLIND. `readCommitments` joins
     * `inventoryassignment`, so it only sees commitments that carry lot detail —
     * and an ARCH sales order that never got lot detail carries none. Demonstrated
     * 2026-08-20: four orders totalling 2,000 BF against lot 315604-1, a 2,206 BF
     * bundle, and the lot-level check still accepted another 500 because not one
     * of them had an assignment to join to.
     *
     * The gap is circular, which is what makes it dangerous: the guard depends on
     * lot attribution, and lot attribution is the thing that is currently blocked.
     *
     * Keyed `itemId__locationId`. Since nothing says WHICH lot an unattributed
     * commitment is against, it has to be treated as potentially against any lot
     * in the pair. That is deliberately conservative and will refuse more than
     * strictly necessary; erring the other way oversells real wood. The builder
     * publishes the same figure as `unattributed` rather than hiding it.
     */
    const readUnattributedCommitments = (itemLocationPairs) => {
        const items = dedupe(itemLocationPairs.map((p) => p.itemId).filter(Boolean));
        const locs  = dedupe(itemLocationPairs.map((p) => p.locationId).filter(Boolean));
        if (!items.length || !locs.length) return {};

        const rows = query.runSuiteQL({
            query:
                'SELECT ' +
                '  tl.item             AS itemid, ' +
                '  tl.location         AS locationid, ' +
                '  tl.id               AS lineid, ' +
                '  t.id                AS tranid, ' +
                '  tl.quantity         AS lineqty, ' +
                '  tl.quantityshiprecv AS shipped, ' +
                '  ia.quantity         AS assignedqty ' +
                'FROM transactionline tl ' +
                'JOIN transaction t ON t.id = tl.transaction ' +
                'LEFT JOIN inventoryassignment ia ' +
                '       ON ia.transaction = t.id AND ia.transactionline = tl.id ' +
                "WHERE t.type = 'SalesOrd' " +
                "  AND tl.mainline = 'F' " +
                "  AND tl.isclosed = 'F' " +
                '  AND tl.item     IN (' + items.join(',') + ') ' +
                '  AND tl.location IN (' + locs.join(',') + ')',
        }).asMappedResults();

        // A line fans out over its assignments, so line-level figures are taken
        // once per line and assignment totals accumulated separately. Same shape
        // as the cache builder's own dedupe.
        const lines = {};
        rows.forEach((r) => {
            const lineKey = String(r.tranid) + '#' + String(r.lineid);
            const pairKey = String(int(r.itemid)) + '__' + String(int(r.locationid));
            if (!lines[lineKey]) {
                const ordered = Math.abs(numOr(r.lineqty, 0));
                const moved   = Math.abs(numOr(r.shipped, 0));
                lines[lineKey] = { pairKey: pairKey, open: Math.max(0, ordered - moved), claimed: 0 };
            }
            lines[lineKey].claimed += Math.abs(numOr(r.assignedqty, 0));
        });

        const byPair = {};
        Object.keys(lines).forEach((k) => {
            const l = lines[k];
            const unclaimed = Math.max(0, l.open - l.claimed);
            if (unclaimed <= 0) return;
            byPair[l.pairKey] = (byPair[l.pairKey] || 0) + unclaimed;
        });
        return byPair;
    };

    /**
     * Lots under an ACTIVE inventory hold, as a set of `itemId__locationId__lotName`.
     *
     * Mirrors `loadActiveHolds` in the ARCH cache builder deliberately, including
     * its two non-obvious rules, because an endpoint that disagreed with the
     * screen about what is sellable would be worse than one with no holds at all:
     *
     *   1. A hold withholds the lot ENTIRELY. The quantity field is
     *      `custrecord_mgsl_hold_packs` and ARCH has no packs, so subtracting a
     *      pack figure from a board-foot balance would produce a confidently
     *      wrong number.
     *   2. Blank or zero packs still counts as a hold. MTL rejects those rows;
     *      here that would silently leave held stock sellable.
     *
     * Status is filtered in JS for the same reason the builder does it: the SDF
     * customlist's value internal id is not known at deploy time.
     *
     * On failure this THROWS rather than returning empty. The builder swallows
     * the error because a failed hold read must not kill a whole cache rebuild,
     * but the trade is inverted here: an empty holds map on a WRITE path means
     * held stock gets sold, and refusing to write is always recoverable.
     */
    const readActiveHolds = () => {
        const held = {};
        search.create({
            type: 'customrecord_mgsl_inventory_hold',
            columns: [
                search.createColumn({ name: 'custrecord_mgsl_hold_item' }),
                search.createColumn({ name: 'custrecord_mgsl_hold_location' }),
                search.createColumn({ name: 'custrecord_mgsl_hold_lot' }),
                search.createColumn({ name: 'custrecord_mgsl_hold_status' }),
            ],
        }).run().each((r) => {
            if (r.getText({ name: 'custrecord_mgsl_hold_status' }) !== 'Active') return true;
            const itemId  = r.getValue({ name: 'custrecord_mgsl_hold_item' });
            const locId   = r.getValue({ name: 'custrecord_mgsl_hold_location' });
            const lotName = r.getText({ name: 'custrecord_mgsl_hold_lot' });
            if (!itemId || !locId || !lotName) return true;
            held[String(itemId) + '__' + String(locId) + '__' + String(lotName)] = true;
            return true;
        });
        return held;
    };

    /**
     * Turns the request's lines into resolved, checked lines.
     *
     * Returns `{ lines, problems }`. Problems are collected rather than thrown on
     * the first one: a trader who built a twelve-line order deserves to see every
     * bad line at once, not to fix them one refusal at a time.
     *
     * Each problem is phrased as something the trader can act on, because the
     * wizard shows these verbatim.
     */
    const resolveLines = (rawLines) => {
        const problems = [];
        const lines = [];

        if (!Array.isArray(rawLines) || !rawLines.length) {
            return { lines: [], problems: ['The order has no lines.'] };
        }

        if (rawLines.length > MAX_LINES) {
            return {
                lines: [],
                problems: ['This order has ' + rawLines.length + ' lines, which is past the ' +
                           MAX_LINES + '-line limit. Split it into several orders.'],
            };
        }

        const states = readLotStates(
            rawLines.map((l) => l && l.lotId),
            rawLines.map((l) => l && l.locationId)
        );
        const committed = readCommitments(rawLines.map((l) => l && l.lotId));
        const holds = readActiveHolds();
        // Pair-level commitment that no lot claims. Read from the resolved states
        // rather than the raw request so the ids are the ones the lot actually
        // belongs to, not the ones the caller asserted.
        const unattributed = readUnattributedCommitments(
            Object.keys(states).map((k) => ({
                itemId: states[k].itemId, locationId: states[k].locationId,
            })));

        // Two lines drawing on the SAME lot at the same location would each pass
        // an individual on-hand check and jointly oversell it. Accumulated here
        // rather than per line for exactly that reason.
        const claimed = {};

        rawLines.forEach((raw, idx) => {
            const label = 'Line ' + (idx + 1);
            const lotId = int(raw && raw.lotId);
            const locId = int(raw && raw.locationId);

            if (!lotId || !locId) {
                problems.push(label + ': the lot or location is missing. Re-pick it from the grid.');
                return;
            }

            const key = String(lotId) + '__' + String(locId);
            const st = states[key];
            if (!st) {
                problems.push(label + ': lot ' + lotId + ' has no stock at that location any more. ' +
                              'Someone may have moved or sold it since the screen loaded.');
                return;
            }

            if (st.segment !== HARDWOOD_SEGMENT) {
                // Not a caller mistake to explain away. This endpoint exists for
                // hardwood and must refuse anything else outright.
                problems.push(label + ': ' + st.itemCode + ' is not tagged as hardwood and cannot be ' +
                              'ordered from the ARCH screen.');
                return;
            }

            // The item the caller believes it is ordering must be the item the
            // lot actually belongs to. Without this a stale grid could pair a lot
            // with the wrong item and the order would still save.
            const claimedItem = int(raw.itemId);
            if (claimedItem && claimedItem !== st.itemId) {
                problems.push(label + ': lot ' + st.lotName + ' belongs to ' + st.itemCode +
                              ', not to the item the screen sent. Reload the screen.');
                return;
            }

            // Refuse rather than fall back to 1:1. `splitLib.checkedStockUnitRate` treats
            // a missing rate as 1 and logs it, which is right for reading a
            // warehouse queue but wrong here: this document COMMITS stock, and at
            // rate 1 a Lumber line would be off by a factor of a thousand. The
            // cache builder makes the same call, excluding rateless lots rather
            // than counting them.
            /* ── The sale unit must BE the stock unit ──────────────────────
             *
             * Everything on this screen is quoted in the STOCK unit, and every
             * rate read in this file comes from `i.stockunit`. But the quantity
             * we write lands on a SALES ORDER line, whose unit NetSuite sources
             * from `i.saleunit`. Nothing in this codebase reads `saleunit`, so
             * if the two ever differ we hand NetSuite a stock-unit number and it
             * applies a sale-unit conversion.
             *
             * 🔴 THE FAILURE IS INVISIBLE, WHICH IS WHY IT REFUSES RATHER THAN WARNS.
             * `amount = quantity x rate` is identical whichever unit the quantity
             * is in, so the order total, the margin and the confirmation all look
             * right while the line commits a thousand times the wood. Nothing
             * downstream catches it: the `wanted <= onHandDisplay` gate below is
             * computed from the STOCK-unit rate and passes; `assignLots` matches
             * on `displayQty` and matches; and `verifyAssignments` compares BASE
             * to BASE, where NetSuite applied the same wrong conversion to the
             * line and the assignment, so it reports no mismatch.
             *
             * Measured 2026-09-02: units type 1 (MBF) is the ONLY type in this
             * account with more than one UOM row, so the only divergence that can
             * be expressed is BF <-> MBF, which is exactly the 1000x. Today
             * `saleunit <> stockunit` occurs on ZERO items in sandbox and ZERO in
             * production. This guard is therefore for the future, and the moment
             * it guards is specific: production has no hardwood items and no
             * `cseg_subsidiary_loc` on `item` at all, so all six SKUs get created
             * by hand at cutover, and the unused MBF row sits in the dropdown one
             * click away from BF.
             *
             * ERROR, not AUDIT, unlike the rateless case below. A missing rate
             * means an item was never configured; divergent units mean somebody
             * CHOSE two different ones. It is rare, abnormal, and a person has to
             * go and fix a record. */
            if (!st.stockUnit || !st.saleUnit || st.stockUnit !== st.saleUnit) {
                log.error({
                    title: 'ARCH Order — UNIT MISMATCH, LINE REFUSED',
                    details: st.itemCode + ' (item ' + st.itemId + ') has stockunit=' +
                             st.stockUnit + ' saleunit=' + st.saleUnit + '. The screen quotes ' +
                             'the stock unit and the SO line would use the sale unit, so the ' +
                             'committed quantity would be wrong by the conversion between them. ' +
                             'Fix the item record; do not convert in code.',
                });
                problems.push(label + ': ' + st.itemCode + ' is stocked and sold in different units, ' +
                              'so ordering it would commit the wrong quantity. It was refused rather ' +
                              'than converted. Set the sale unit to match the stock unit on the item.');
                return;
            }

            const rate = st.rate;
            if (!(rate > 0)) {
                problems.push(label + ': ' + st.itemCode + ' has no usable stock-unit conversion rate, ' +
                              'so its quantity cannot be trusted. It was refused rather than guessed at 1:1.');
                return;
            }

            // ── Commitment nothing can attribute to a lot ───────────────────
            //
            // Exists on this item at this location but names no lot, so it could
            // be against THIS bundle and nothing in the data says otherwise. It
            // therefore locks the bundle too. See `readUnattributedCommitments`
            // for why this is the conservative direction.
            const pairKey = String(st.itemId) + '__' + String(st.locationId);
            const unclaimed = unattributed[pairKey] || 0;
            if (unclaimed > 0) {
                problems.push(label + ': ' + st.itemCode + ' at this location carries ' +
                              splitLib.toDisplay(unclaimed, rate).toFixed(3) + ' committed on open ' +
                              'sales orders that name no lot, so it cannot be told apart from ' +
                              'bundle ' + st.lotName + '. Attribute those orders to their lots first.');
                return;
            }

            // ── The bundle lock, matching the screen exactly ─────────────────
            //
            // `isLotLocked` in lib/archLots.ts is `commitmentOn(lot) > 0`, where
            // commitment is reserve + readyToBuild + outbound, and its comment is
            // explicit that a PARTIALLY committed bundle is the case the rule
            // exists for. The physical remainder of a part-sold bundle is unknown
            // until the warehouse measures it, so the whole thing is spoken for.
            //
            // The screen therefore never OFFERS such a lot. Enforcing it here too
            // is what makes the endpoint the real boundary rather than the UI: a
            // stale cart or a hand-made payload gets the same answer.
            const alreadyCommitted = committed[key] || 0;
            if (alreadyCommitted > 0) {
                problems.push(label + ': ' + st.itemCode + ' lot ' + st.lotName + ' is already ' +
                              'committed on another sales order (' +
                              splitLib.toDisplay(alreadyCommitted, rate).toFixed(3) +
                              ' of ' + splitLib.toDisplay(st.storedQty, rate).toFixed(3) +
                              '). The whole bundle is locked until that order is settled.');
                return;
            }

            if (holds[String(st.itemId) + '__' + String(st.locationId) + '__' + String(st.lotName)]) {
                problems.push(label + ': ' + st.itemCode + ' lot ' + st.lotName + ' is on hold ' +
                              'pending an inventory correction and cannot be sold.');
                return;
            }

            // On-hand net of commitments. Redundant while the bundle lock above
            // refuses any committed lot, and kept deliberately: if that rule is
            // ever relaxed to allow selling a partial remainder, the arithmetic
            // guard against overselling must not have to be remembered.
            // Nets BOTH kinds of commitment. Either refusal above already stops a
            // committed bundle, so this is unreachable today — but the comment
            // below promises it is the safety net if those rules are relaxed, and
            // subtracting only the attributed half would not have been one.
            const onHandDisplay = splitLib.toDisplay(
                Math.max(0, st.storedQty - alreadyCommitted - unclaimed), rate);
            const isSplit = bool(raw.isSplit);

            // Reman intent. The checkbox is what makes a spec meaningful: a
            // target thickness with planing UNTICKED is not a quiet instruction
            // to plane, it is leftover text from a trader who changed their
            // mind, so the spec is dropped with the flag rather than stored on
            // its own where the mill might act on it.
            const remanRaw = raw.reman && typeof raw.reman === 'object' ? raw.reman : {};
            const planing  = bool(remanRaw.planing);
            const cutting  = bool(remanRaw.cutting);
            const reman = (planing || cutting) ? {
                planing:   planing,
                planeTgt:  planing ? String(remanRaw.planingSpec || '').slice(0, 40) : '',
                cutting:   cutting,
                cutLen:    cutting ? String(remanRaw.cutLength || '').slice(0, 40) : '',
            } : null;

            // A split target on a line not being treated as a split means the two
            // fields disagree about intent. Refusing beats picking one: guessing
            // `qty` would sell the whole bundle, which is exactly what the loose
            // boolean check used to do silently.
            if (!isSplit && raw.splitTargetQty !== undefined && raw.splitTargetQty !== null) {
                problems.push(label + ': the line carries a split target but is not marked as a ' +
                              'split. Refusing rather than guessing whether to split it.');
                return;
            }

            // On a split line the ORDER carries the target, not the bundle. The
            // whole bundle still leaves availability, because the front end locks
            // a lot on any commitment at all (`isLotLocked` = commitment > 0), so
            // there is nothing extra to reserve here.
            const wanted = num(isSplit ? raw.splitTargetQty : raw.qty);

            if (wanted === null || wanted <= 0) {
                problems.push(label + ': ' + (isSplit ? 'the split target' : 'the quantity') +
                              ' must be a number greater than zero.');
                return;
            }

            const already = claimed[key] || 0;
            if (wanted + already > onHandDisplay + 1e-9) {
                problems.push(
                    label + ': ' + st.itemCode + ' lot ' + st.lotName + ' has ' +
                    onHandDisplay.toFixed(3) + ' on hand' +
                    (already ? ' and ' + already.toFixed(3) + ' is already claimed by another line' : '') +
                    ', so ' + wanted.toFixed(3) + ' cannot be committed.'
                );
                return;
            }

            if (isSplit && wanted >= onHandDisplay - 1e-9) {
                // A "split" that takes the whole bundle is not a split, and would
                // queue warehouse work that produces a zero remainder.
                problems.push(label + ': a split of ' + wanted.toFixed(3) + ' takes the whole ' +
                              onHandDisplay.toFixed(3) + ' bundle. Order the bundle instead of splitting it.');
                return;
            }

            // A ceiling as well as a floor. 1e300 was accepted before this, which
            // would have written a nonsense rate onto a real order and overflowed
            // every downstream total. The bound is deliberately far above any real
            // hardwood price so it can only ever catch a bug or a bad payload.
            const price = num(raw.pricePerUnit);
            if (price === null || price < 0) {
                problems.push(label + ': the price must be a number and cannot be negative.');
                return;
            }
            if (price > MAX_PRICE_PER_UNIT) {
                problems.push(label + ': a price of ' + price + ' per unit is not credible. ' +
                              'Check the figure before committing the order.');
                return;
            }

            claimed[key] = already + wanted;

            lines.push({
                itemId:       st.itemId,
                itemCode:     st.itemCode,
                locationId:   st.locationId,
                lotId:        st.lotId,
                lotName:      st.lotName,
                rate:         rate,
                // DISPLAY units, straight onto the SO line.
                displayQty:   wanted,
                // BASE units, for the inventory assignment. See the header.
                storedQty:    splitLib.toStored(wanted, rate),
                pricePerUnit: price,
                isSplit:      isSplit,
                // null when the trader asked for no reman on this line.
                reman:        reman,
                bundleDisplayQty: onHandDisplay,
            });
        });

        return { lines: lines, problems: problems };
    };

    /* ── Writing ─────────────────────────────────────────────────────────────*/

    /**
     * Adds one resolved line. NO inventory detail — see `assignLots` below.
     *
     * 🔴 INVENTORY DETAIL CANNOT BE SET ON AN UNSAVED SALES ORDER LINE in this
     * account, so this is deliberately a two-phase write. Established 2026-08-20
     * by probing every structural route on a NEW order, all of which fail with
     * `FIELD_1_IS_NOT_A_SUBRECORD_FIELD: Field inventorydetail is not a
     * subrecord field`:
     *
     *   dynamic mode, default form 359          getCurrentSublistSubrecord  FAIL
     *   dynamic mode, commitinventory = 1       getCurrentSublistSubrecord  FAIL
     *   standard mode, default form             getSublistSubrecord         FAIL
     *   standard mode, form 373 (set OK)        getSublistSubrecord         FAIL
     *   dynamic mode                            hasCurrentSublistSubrecord  FAIL
     *   ── against an EXISTING saved order ──
     *   standard mode, load SO 121144           hasSublistSubrecord         TRUE
     *
     * So the field materialises only once the line exists. Two things were ruled
     * out along the way and should not be retried: `commitinventory` is not the
     * gate (setting it to 1, Available Qty, changes nothing), and the form is not
     * the gate either. Every one of the 157 SO-level assignments in this account
     * sits on form 373, which made the form look like the variable, but a new
     * order on 373 fails identically.
     *
     * ⚠️ Switching `customform` in DYNAMIC mode throws
     * `MODULE_DOES_NOT_EXIST: /NLRecordScripting.scriptInit$sys.js` because form
     * 373 carries a client script that cannot load server-side. It works in
     * standard mode, where client scripts do not run. Relevant if an ARCH form is
     * ever made preferred.
     */
    /**
     * Are the reman line fields actually deployed?
     *
     * Asking the RECORD beats keeping a flag in a script parameter: the record
     * is the thing that will accept or reject the write, and a parameter would
     * be one more thing to remember to flip. Deliberately NOT memoised across
     * executions -- a module-level cache would answer "no" for as long as the
     * script stayed compiled after somebody deployed the fields, which is the
     * kind of staleness that gets diagnosed as "the feature does not work".
     * One call per order, not per line.
     */
    const remanFieldsPresent = (so) => {
        let present;
        try {
            const fields = so.getSublistFields({ sublistId: 'item' }) || [];
            present = fields.indexOf(F_REMAN_PLANE) !== -1
                   && fields.indexOf(F_REMAN_CUT)   !== -1;
        } catch (e) {
            // If the probe itself fails, do not write. An order that saves
            // without its reman note is recoverable; one that fails to save
            // because of a note is not.
            present = false;
        }
        if (!present) {
            log.audit('ARCH Order reman',
                'The reman line fields are not on the sales order record, so reman was ' +
                'NOT written. Deploy custcol_mgsl_reman_plane, _plane_tgt, _cut and ' +
                '_cut_len to turn this on. The order itself is unaffected.');
        }
        return present;
    };

    const addLine = (so, line, index, remanOk) => {
        const set = (fieldId, value) =>
            so.setSublistValue({ sublistId: 'item', fieldId: fieldId, line: index, value: value });

        set('item',     line.itemId);
        set('location', line.locationId);
        set('quantity', line.displayQty);
        set('rate',     line.pricePerUnit);

        /* Reman, and it must never be able to lose the order.
         *
         * `remanFieldsPresent` asks `getSublistFields`, which answers for the
         * RECORD. A field could in principle be listed there and still refuse a
         * write -- hidden on the form the record landed on, or restricted by
         * role. The probe cannot rule that out, so the write is guarded too:
         * an order that saves without its reman note is recoverable by hand,
         * and one that fails to save BECAUSE of a note is not.
         *
         * Returning the outcome rather than swallowing it is the other half.
         * If this fails, `remanStored` must come back false, or the screen
         * would tell the trader the mill has instructions it never got. */
        let remanWritten = true;
        if (line.reman && remanOk) {
            try {
                set(F_REMAN_PLANE, line.reman.planing);
                set(F_REMAN_CUT,   line.reman.cutting);
                if (line.reman.planeTgt) set(F_REMAN_PLANE_TGT, line.reman.planeTgt);
                if (line.reman.cutLen)   set(F_REMAN_CUT_LEN,   line.reman.cutLen);
            } catch (e) {
                remanWritten = false;
                log.error('ARCH Order reman NOT written',
                    'Line ' + index + ' (' + (line.itemCode || line.itemId) + '): ' +
                    (e.name || '') + ': ' + (e.message || String(e)) +
                    ' | The fields passed the presence probe but refused the write. The order ' +
                    'itself is unaffected and will be reported as reman-not-stored.');
            }
        }

        if (line.isSplit) {
            set(F_SPLIT,    true);
            set(F_SPLIT_BF, line.displayQty);
            // setSublistText is not available in standard mode, so the split
            // status goes in by its list value id rather than its label.
            so.setSublistValue({
                sublistId: 'item', fieldId: F_SPLIT_STATUS, line: index,
                value: splitStatusPendingId(),
            });
        }

        return remanWritten;
    };

    /**
     * Phase two: attach each lot to its saved line.
     *
     * ── Why lines are matched on content, not on index ───────────────────────
     * Orders in this account acquire extra lines by themselves. The seeded ARCH
     * order came back carrying two `CA-E` lines, and the seeded PO two `TAXQC`
     * lines, added by existing user events. Index matching would therefore attach
     * a lot to a tax line. Each resolved line is matched on item, location and
     * quantity, and a saved line is consumed once so two identical requested
     * lines take two distinct saved lines rather than both claiming the first.
     *
     * `issueinventorynumber` takes the internal ID of an EXISTING lot and rejects
     * a name outright, the same trap documented in `archSplitExecute.addLine`. A
     * sales order ISSUES stock, so it is always the issue side; the receipt side
     * is only for minting a lot that does not exist yet.
     *
     * Returns the lines it could not place. A failure here leaves an order whose
     * ROW quantities are correct but whose lots are unattributed, which is a state
     * the ARCH cache already reports honestly as `unattributed` rather than
     * hiding. That is a real degradation and the caller is told about it, but it
     * is not corruption.
     */
    const assignLots = (soId, lines, priorLineKeys) => {
        const so = record.load({ type: record.Type.SALES_ORDER, id: soId, isDynamic: false });
        const count = so.getLineCount({ sublistId: 'item' });
        const used = {};
        const unplaced = [];
        const prior = priorLineKeys || {};

        lines.forEach((line) => {
            let target = -1;
            for (let i = 0; i < count; i++) {
                if (used[i]) continue;
                // 🔴 Never attach to a line that existed before this call. On an
                // append, an order may already carry a line with the same item,
                // location and quantity, and matching on content alone would hang
                // this request's lot on the PREVIOUS request's line. `lineuniquekey`
                // is only assigned at save, so it cannot be captured when the line
                // is built — it has to be snapshotted from the order beforehand.
                const key = String(so.getSublistValue({
                    sublistId: 'item', fieldId: 'lineuniquekey', line: i,
                }));
                if (prior[key]) continue;
                const itemId = int(so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
                const locId  = int(so.getSublistValue({ sublistId: 'item', fieldId: 'location', line: i }));
                const qty    = numOr(so.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }), NaN);
                if (itemId === line.itemId && locId === line.locationId &&
                    Math.abs(Math.abs(qty) - line.displayQty) < 1e-6) {
                    target = i;
                    break;
                }
            }
            if (target < 0) {
                unplaced.push(line.lotName + ' (no saved line matched item ' + line.itemCode +
                              ' at location ' + line.locationId + ' for ' + line.displayQty + ')');
                return;
            }
            used[target] = true;

            try {
                const detail = so.getSublistSubrecord({
                    sublistId: 'item', fieldId: 'inventorydetail', line: target,
                });

                // ⚠️ STANDARD-mode subrecord API. `selectNewLine` /
                // `setCurrentSublistValue` / `commitLine` are DYNAMIC-mode only and
                // are not even defined here — the failure is a bare
                // `TypeError: detail.selectNewLine is not a function`, which reads
                // like a missing subrecord rather than the wrong API flavour.
                //
                // Assignments are appended after whatever the line already has, so
                // re-running against a line that is already assigned adds rather
                // than overwrites.
                const assignLine = detail.getLineCount({ sublistId: 'inventoryassignment' });
                const at = assignLine < 0 ? 0 : assignLine;

                detail.setSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId:   'issueinventorynumber',
                    line:      at,
                    value:     Number(line.lotId),
                });
                // 🔴 DISPLAY UNITS HERE, and this is the FOURTH time this codebase
                // has been caught by a unit direction. Measured 2026-08-20 on SO
                // 126446: passing the BASE figure 0.4 stored 0.0004, i.e. NetSuite
                // read 0.4 as board feet and converted it to MBF itself. Passing
                // the display figure 400 stores 0.4, which is what we want.
                //
                // ⚠️ THIS IS THE OPPOSITE OF AN INVENTORY ADJUSTMENT. archSplitExecute
                // passes BASE to the same-named field and is correct to, verified
                // against IA-CWP-347 where assignment quantity equals line quantity
                // in MBF. So the rule is per record type, not per field name:
                //
                //   Inventory Adjustment  inventoryassignment.quantity = BASE
                //   Sales Order           inventoryassignment.quantity = DISPLAY
                //
                // Do not "make these consistent". They are consistent with
                // NetSuite, which is what matters.
                detail.setSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId:   'quantity',
                    line:      at,
                    value:     line.displayQty,
                });
            } catch (e) {
                unplaced.push(line.lotName + ' (' + (e.name || 'Error') + ': ' +
                              (e.message || String(e)) + ')');
            }
        });

        if (unplaced.length < lines.length) {
            so.save({ enableSourcing: false, ignoreMandatoryFields: true });
        }
        return unplaced;
    };

    /**
     * Re-reads what NetSuite actually stored against the saved order.
     *
     * This exists because the base-unit side of the assignment is inferred from
     * how the cache builder READS assignments, never from a write we have
     * observed — no ARCH order has ever carried inventory detail. Rather than
     * trust that, the order is read back and compared against what was intended.
     *
     * A mismatch is reported, not thrown: the order exists either way and hiding
     * it would be worse than saying so. If the first real order comes back clean
     * this check has done its job and can go.
     *
     * Note the join carries BOTH keys. `transactionline.id` is unique only within
     * a transaction, so joining assignments on the line id alone cross-matches
     * other transactions that happen to share a line number.
     */
    /**
     * Assignment totals per lot on one transaction, in BASE units.
     *
     * Signed sum kept alongside the magnitude: a sales order's stored assignments
     * are negative (measured: -28.16 against a -28.16 line), and this module
     * passes a POSITIVE quantity in and lets NetSuite sign it. Comparing only
     * magnitudes would hide an inverted sign, so the sign is reported.
     */
    const assignmentsByLot = (txnId) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT ia.inventorynumber AS lotid, ia.quantity AS assignedqty ' +
                'FROM transactionline tl ' +
                'JOIN inventoryassignment ia ' +
                '       ON ia.transaction = tl.transaction AND ia.transactionline = tl.id ' +
                "WHERE tl.transaction = ? AND tl.mainline = 'F'",
            params: [txnId],
        }).asMappedResults();

        const byLot = {};
        rows.forEach((r) => {
            const k = String(int(r.lotid));
            const q = numOr(r.assignedqty, 0);
            if (!byLot[k]) byLot[k] = { magnitude: 0, signed: 0, rows: 0 };
            byLot[k].magnitude += Math.abs(q);
            byLot[k].signed    += q;
            byLot[k].rows      += 1;
        });
        return byLot;
    };

    const verifyAssignments = (soId, lines, priorAssignments) => {
        const after = assignmentsByLot(soId);
        const before = priorAssignments || {};

        // Several lines may draw on one lot, so the intended figure is summed the
        // same way the observed one is.
        const intended = {};
        const nameOf = {};
        lines.forEach((l) => {
            const k = String(l.lotId);
            intended[k] = (intended[k] || 0) + Math.abs(l.storedQty);
            nameOf[k] = l.lotName;
        });

        const mismatches = [];
        let rowsSeen = 0;

        Object.keys(after).forEach((k) => { rowsSeen += after[k].rows; });

        Object.keys(intended).forEach((k) => {
            const want = intended[k];
            const got = (after[k] ? after[k].magnitude : 0) -
                        (before[k] ? before[k].magnitude : 0);
            const name = nameOf[k] || k;

            if (!after[k]) {
                mismatches.push('lot ' + name + ' has no assignment on the saved order');
                return;
            }
            // Base units on both sides. Tolerance is generous relative to the
            // 5-decimal storage NetSuite uses for quantity.
            if (Math.abs(got - want) > 1e-6) {
                mismatches.push('lot ' + name + ' stored ' + got + ' where ' + want +
                                ' was intended (delta against ' +
                                (before[k] ? before[k].magnitude : 0) + ' already on the order)');
            }
        });

        // An assignment for a lot nobody ordered. Invisible to the loop above,
        // which only walks what was intended.
        Object.keys(after).forEach((k) => {
            const added = after[k].magnitude - (before[k] ? before[k].magnitude : 0);
            if (!intended[k] && added > 1e-6) {
                mismatches.push('lot ' + k + ' gained ' + added +
                                ' but was not on this request');
            }
        });

        // Sign is reported, never asserted. A sales order's assignments are
        // stored negative and this module passes a positive quantity, so the
        // first real order is what establishes whether NetSuite signs it for us.
        const signs = Object.keys(intended)
            .filter((k) => after[k])
            .map((k) => nameOf[k] + '=' + after[k].signed);

        return { assignmentRows: rowsSeen, mismatches: mismatches, storedSigns: signs };
    };

    /**
     * States an order can no longer accept lines in.
     *
     * A deny-list, not an allow-list, and deliberately so: NetSuite's sales-order
     * status codes are single letters and getting one wrong in an ALLOW-list
     * silently blocks legitimate work, while getting one wrong in a DENY-list
     * only means NetSuite refuses the save itself a moment later. So this catches
     * the three that are certainly wrong and leaves the rest to NetSuite.
     *
     * Verified against live data 2026-08-20: 'B' is Pending Fulfillment and 'G'
     * is Billed.
     */
    const CLOSED_STATUSES = { C: 'Cancelled', G: 'Billed', H: 'Closed' };

    /**
     * Refuses an append onto an order that cannot take one.
     *
     * Without this the failure surfaces as whatever NetSuite says when a save
     * fails, which a trader cannot act on. `record.load` already throws for an
     * order that does not exist, so only the state needs checking here.
     *
     * ⚠️ This does NOT verify the order is an ARCH order, and it cannot today.
     * All three hardwood locations sit in subsidiary 5 alongside MTL, so
     * subsidiary does not separate them and there is no ARCH marker on the
     * header. The lines are still guaranteed hardwood by the segment check, so
     * the worst case is hardwood lines landing on a non-ARCH order that a trader
     * chose deliberately. Worth a real discriminator once one exists; not worth
     * inventing a rule now.
     */
    const assertAppendable = (soId) => {
        const rows = query.runSuiteQL({
            query:
                'SELECT t.status AS status, BUILTIN.DF(t.status) AS label, t.tranid AS tranid, ' +
                '       t.externalid AS externalid ' +
                'FROM transaction t WHERE t.id = ? AND t.type = ?',
            params: [soId, 'SalesOrd'],
        }).asMappedResults();

        if (!rows.length) throw refusal('That sales order does not exist.');

        const code = String(rows[0].status || '').toUpperCase();
        if (CLOSED_STATUSES[code]) {
            throw refusal('Sales order ' + rows[0].tranid + ' is ' +
                            (rows[0].label || CLOSED_STATUSES[code]) +
                            ' and can no longer take new lines. Create a new order instead.');
        }
        return { tranId: rows[0].tranid, externalId: String(rows[0].externalid || '') };
    };

    /**
     * ORDER-level validation, shared by the dry run and the write.
     *
     * 🔴 THIS RUNS BEFORE THE LINES, and both halves of that matter.
     *
     * Before, because line validation used to run first and throw, which made
     * every check in here unreachable. Measured 2026-08-20: appending to sales
     * order 999999, which does not exist, reported "WAL44OVLOUTKD at this
     * location carries 6.000 committed on open sales orders that name no lot".
     * The caller was told about stock when the real problem was a dead order id.
     *
     * Shared, because `validateOrder` used to validate only lines, so a dry run
     * answered ok=true for a non-existent target, a Billed target, a missing
     * order id, AND a mode of "sideways". The dry run exists precisely so a
     * trader does not confirm something that cannot succeed, and it was
     * green-lighting four cases that could not.
     *
     * `mode` is checked HERE rather than only in the Suitelet. The entry point
     * checked it, but this library is reached by more than one caller — the test
     * harness did exactly that — and `createOrder` treats anything that is not
     * 'existing' as 'new', so an unrecognised mode would have created an order.
     */
    const resolveOrderContext = (input) => {
        const mode = input && input.mode;
        if (mode !== 'new' && mode !== 'existing') {
            throw refusal('The order mode must be "new" or "existing", not "' +
                          String(mode) + '".');
        }

        const appending = mode === 'existing';
        const existingId = int(input.existingSO);
        if (appending && !existingId) {
            throw refusal('Adding to an existing order needs the internal id of that order.');
        }

        // Restricted to characters that are safe in an externalid and cannot be
        // used to collide with another convention. A missing key is allowed so
        // the endpoint stays callable by hand, but the wizard must always send
        // one — that is what makes a retry safe.
        const rawKey = String((input && input.idempotencyKey) || '').trim();
        if (rawKey && !/^[A-Za-z0-9_-]{8,64}$/.test(rawKey)) {
            throw refusal('The idempotency key must be 8 to 64 characters of letters, ' +
                          'digits, dash or underscore.');
        }
        const idempotencyKey = rawKey || null;

        let target = null;
        if (appending) {
            target = assertAppendable(existingId);

            // ── Idempotency on the APPEND path ──────────────────────────────
            //
            // Create is protected by NetSuite's unique `externalid`, so a
            // duplicate fails in the database. Append has no such constraint: the
            // lines simply go on twice, double-committing stock on a live order.
            // That makes a retried append MORE dangerous than a retried create,
            // and the first version of this module protected only the create.
            //
            // So the key is recorded on the order it appended to, and a repeat is
            // refused by reading it back. This is a lookup rather than a database
            // constraint, so it is not race-proof the way create is; it closes the
            // realistic case, which is a human clicking twice or a browser
            // retrying after a timeout.
            if (idempotencyKey && target.externalId.indexOf(appendMarker(idempotencyKey)) !== -1) {
                throw refusal('These lines were already added to ' + target.tranId +
                              ' by an identical request. Nothing was duplicated.');
            }
        }

        return {
            mode: mode,
            appending: appending,
            existingId: existingId,
            idempotencyKey: idempotencyKey,
            target: target,
        };
    };

    /**
     * Reports the form an order actually landed on, so a misconfigured
     * `runasrole` explains itself instead of silently producing orders with no
     * lots. Returns a warning string, or null when the form is the expected one.
     *
     * This is the diagnosis that took the longest to reach, so it is worth having
     * the code say it: unattributed lots on an ARCH order almost always mean the
     * order is on the wrong form, and the wrong form almost always means the
     * deployment is executing as a role the ARCH form is not preferred for.
     */
    const formWarning = (soId) => {
        const expected = archFormId();
        try {
            const rows = query.runSuiteQL({
                query: 'SELECT t.customform AS formid, BUILTIN.DF(t.customform) AS formname ' +
                       'FROM transaction t WHERE t.id = ?',
                params: [soId],
            }).asMappedResults();
            if (!rows.length) return null;
            const actual = int(rows[0].formid);
            if (actual === expected) return null;
            return 'landed on form ' + actual + ' (' + rows[0].formname + ') rather than ' +
                   expected + '. Inventory Detail is not available on that form, so lots ' +
                   'cannot be attached. The form comes from the EXECUTING ROLE, so check ' +
                   'the runasrole on this deployment.';
        } catch (e) {
            return null;
        }
    };

    /** Marker recorded on an appended-to order so a retry can recognise itself. */
    const appendMarker = (key) => '[ARCH-APPEND:' + key + ']';

    /**
     * Creates the order, or appends to an existing one.
     *
     * @param {Object} input
     * @param {string} input.mode          'new' | 'existing'
     * @param {number} [input.existingSO]  internal id, required when mode is 'existing'
     * @param {Object} input.header
     * @param {Array}  input.lines
     */
    /* ── The order confirmation PDF ──────────────────────────────────────────
     *
     * 🔴 OFF BY DEFAULT, AND DELIBERATELY SO. This sends real email, and in this
     * sandbox that is not hypothetical: employee 3293 "Trader Hardwood" — the ARCH
     * trader test account — carries `ma.poirier+arc@mcgillstlaurent.com`, which is
     * Marc-Antoine's own address. He is actively testing in here. A feature that
     * silently mails him from a sandbox he did not know had one is exactly the kind
     * of surprise that costs trust.
     *
     * `custscript_arch_pdf_email_to` therefore has three states:
     *
     *   empty            no email at all. The default.
     *   an address       send there, whoever created the order. Use this in the
     *                    sandbox so nothing reaches MGSL until they have asked for it.
     *   the word CREATOR send to the person who created the order, which is the
     *                    actual feature. Prod only, once MGSL want it.
     *
     * Same shape as the split fee: config, default off, until confirmed.
     *
     * ── Why failure here is swallowed ───────────────────────────────────────
     * The order is already saved and verified by the time this runs. If rendering
     * or mailing fails, the order is still correct and the trader must not be told
     * it failed — the same reasoning that makes `assignLots` non-fatal. Logged at
     * AUDIT for a config problem, ERROR only when it actually broke.
     */
    const PDF_EMAIL_PARAM = 'custscript_arch_pdf_email_to';

    const sendOrderPdf = (soId, tranId, creatorId) => {
        /* 🔴 READ DEFENSIVELY. `param()` calls getParameter with no try/catch, and
         * a parameter that is not on the DEPLOYED script is not guaranteed to come
         * back null — it can throw. Without this, uploading the JS before the
         * script object would break order creation outright, which is a far worse
         * outcome than an unsent email. This way the file is deployable on its own
         * and the object can follow whenever the feature is actually wanted. */
        let target = '';
        try {
            target = String(param(PDF_EMAIL_PARAM) || '').trim();
        } catch (e) {
            log.audit('ARCH Order PDF',
                'Parameter ' + PDF_EMAIL_PARAM + ' is not on this deployment yet, so no ' +
                'confirmation was sent. The order is unaffected.');
            return { sent: false, reason: 'parameter not deployed' };
        }
        if (!target) return { sent: false, reason: 'not configured' };

        try {
            // The PDF comes from the transaction's own form, so it is whatever
            // NetSuite would print — no layout invented here. render.transaction
            // does not take a form id: the record already knows its form, which is
            // the one thing about `customform` that works in our favour.
            const pdf = render.transaction({
                entityId: soId,
                printMode: render.PrintMode.PDF,
            });
            pdf.name = tranId + '.pdf';

            // CREATOR is resolved to the real person, not the runasrole. See the
            // note on resolveSalesRep: getCurrentUser survives the role switch.
            const toCreator = target.toUpperCase() === 'CREATOR';
            if (toCreator && !creatorId) {
                log.audit('ARCH Order PDF',
                    'Configured to mail the creator but no creator id was resolved, so ' +
                    'SO ' + tranId + ' was not mailed. The order is unaffected.');
                return { sent: false, reason: 'no creator' };
            }

            email.send({
                // Author must be an employee with an email address. The creating
                // user is one by definition — they just saved a transaction.
                author: creatorId,
                recipients: toCreator ? creatorId : target,
                subject: 'Sales order ' + tranId,
                body:
                    'Sales order ' + tranId + ' has been created from the CWP ARCH trader screen.\n\n' +
                    'The PDF is attached. Quantities and bundles on it are what NetSuite holds.\n\n' +
                    'Reman instructions, if any were entered on the trader screen, are NOT on this ' +
                    'order and are not in the PDF — see the note on the Review step.',
                attachments: [pdf],
            });

            log.audit('ARCH Order PDF',
                'Mailed ' + tranId + ' to ' + (toCreator ? 'its creator (' + creatorId + ')' : target));
            return { sent: true, to: toCreator ? 'creator' : target };
        } catch (e) {
            // Never fatal. The order exists and is correct.
            log.error('ARCH Order PDF — NOT SENT for ' + tranId,
                (e.name || '') + ': ' + (e.message || String(e)) +
                ' | The order itself is unaffected.');
            return { sent: false, reason: e.message || String(e) };
        }
    };

    const createOrder = (input) => {
        // ORDER first, LINES second. See `resolveOrderContext`.
        const ctx = resolveOrderContext(input);
        const appending = ctx.appending;
        const existingId = ctx.existingId;
        const idempotencyKey = ctx.idempotencyKey;

        if (!idempotencyKey) {
            log.audit('ARCH Order Create',
                'No idempotency key supplied — a retry of this request would create a second order.');
        }

        const resolved = resolveLines(input.lines);
        if (resolved.problems.length) {
            throw refusal(resolved.problems.join(' '));
        }

        // ── STANDARD mode, not dynamic, and the reason is `customform` ──────
        //
        // Setting `customform` in DYNAMIC mode throws
        // `MODULE_DOES_NOT_EXIST: /NLRecordScripting.scriptInit$sys.js` — it tries
        // to reinitialise the form through client-script infrastructure that does
        // not exist server-side. It is a dynamic-mode limitation, not a property
        // of any particular form: 373 and 386 both fail, and both set cleanly in
        // standard mode.
        //
        // Nothing here needs dynamic mode any more. Inventory detail moved to
        // phase two the moment it turned out not to exist on an unsaved line, and
        // that was the only reason for it.
        const so = appending
            ? record.load({ type: record.Type.SALES_ORDER, id: existingId, isDynamic: false })
            : record.create({ type: record.Type.SALES_ORDER, isDynamic: false });

        if (!appending) {
            const h = input.header || {};
            const customerId = int(h.customerId);
            if (!customerId) throw refusal('The order needs a customer.');

            // ⛔ `customform` is deliberately NOT set. See ARCH_SO_FORM_DEFAULT:
            // setting it breaks the SAVE from a server script in this account, for
            // every form, so the form comes from the EXECUTING ROLE's preference
            // instead. That is why this deployment's runasrole matters.

            // Subsidiary and department are deliberately NOT set from the
            // request. NetSuite sources them from the customer and the location,
            // which is what the order should book against; asserting them here
            // would let a crafted payload post an ARCH order anywhere.
            so.setValue({ fieldId: 'entity', value: customerId });

            // ⚠️ Guard on the PARSED id, not the raw value. `if (h.currencyId)`
            // is true for "USD", and int("USD") is null, so the earlier version
            // set currency to null. Not hypothetical: ArchOrderHeader.currency is
            // typed as a string and carries a code, so it would have fired the
            // moment the wizard was wired up.
            const currencyId = int(h.currencyId);
            const termsId    = int(h.termsId);
            if (currencyId) so.setValue({ fieldId: 'currency', value: currencyId });
            if (termsId)    so.setValue({ fieldId: 'terms',    value: termsId });

            if (h.customerPO) setIfPresent(so, H_CUSTOMER_PO, String(h.customerPO), 'the customer PO');
            if (h.salesRep)   setIfPresent(so, H_SALES_REP,   String(h.salesRep),   'the sales rep name');

            // ── Mandatory on the sales-order form, so not optional here ──────
            //
            // NetSuite refuses the save with "Please enter value(s) for: Reload
            // (Ship From), Incoterms, Department" otherwise. Worth recording that
            // our own seeded ARCH order (SO 125745) has neither incoterms nor
            // department, which made them look optional; that order was written by
            // the temporary seed Suitelet, which evidently bypassed mandatory
            // fields. Absence on an existing record is not evidence a field is
            // optional.
            so.setValue({ fieldId: 'department', value: departmentId() });

            // ── "Reload (Ship From)" is the standard `location` header field ──
            //
            // Do not go looking for a custom field: the mandatory-field message
            // names the LABEL, and on this form `location` is relabelled "Reload
            // (Ship From)". Established 2026-08-20 by asking NetSuite which fields
            // it considers mandatory on a new order rather than guessing at ids —
            // four `custbody*reload*` fields exist and none of them is this one.
            //
            // Derived from the lines rather than accepted blindly, because it is
            // the warehouse the wood physically leaves from and the lines already
            // say which one that is. When the lines disagree the answer is a real
            // business decision, so it is refused rather than guessed.
            const headerLocation = int(h.locationId) || soleLocation(resolved.lines);
            if (!headerLocation) {
                throw refusal('The lines ship from more than one location, so the order needs ' +
                              'an explicit ship-from location. Raise one order per location, or ' +
                              'send header.locationId.');
            }
            so.setValue({ fieldId: 'location', value: headerLocation });

            // Mandatory on form 386. See resolveShipAddress.
            const shipAddr = resolveShipAddress(customerId, h.shipAddressId);
            if (!shipAddr) {
                throw refusal('That customer has no address on file, so the order has ' +
                              'nowhere to ship to. Add an address to the customer first.');
            }
            so.setValue({ fieldId: 'shipaddresslist', value: shipAddr });

            // ── Sales Team is a mandatory SUBLIST, not a field ───────────────
            //
            // The form refuses with "You must enter at least one line for
            // sublist: Sales Team".
            //
            // ONLY `employee` is set. The stored data on a real order shows
            // salesrole -2 and contribution 0.5, and both were tried: setting
            // salesrole turned a clear USER_ERROR into an opaque
            // UNEXPECTED_ERROR at save, and contribution is a FRACTION rather
            // than a percentage, so the 100 that looks right means 10,000%.
            // A value read out of a saved record is not necessarily a value the
            // API accepts. NetSuite fills both in for a single-line team.
            //
            // Attributed to the REQUESTING USER where possible. This deployment
            // runs as `customrole2184` (see the runasrole note on the deployment
            // object), but `getCurrentUser` still returns the person who actually
            // called it, so the order records the trader who built it. The role
            // switch changes the ROLE, not the user.
            //
            // ⚠️ `resolveSalesRep`'s validation query runs under that role, so it
            // can only see employees within the role's subsidiary scope. A rep the
            // role cannot see is indistinguishable here from one who is not a
            // sales rep, and both produce the same refusal below.
            //
            // See `resolveSalesRep` for the fallbacks and why a rep that is not a
            // real sales rep breaks the save outright.
            const repId = resolveSalesRep(
                int(h.salesRepId), int(runtime.getCurrentUser().id), customerId);
            if (!repId) {
                /*
                 * Names the CAUSE, not just the symptom. The single generic
                 * message this replaced was read as "not flagged as a sales rep"
                 * when the real cause was "this role cannot see that employee",
                 * and acting on the wrong reading turned our bug into a client
                 * ask. See `diagnoseSalesRep`.
                 */
                const why = diagnoseSalesRep(
                    int(h.salesRepId), int(runtime.getCurrentUser().id), customerId);
                const detail = {
                    REQUESTED_NOT_VISIBLE:
                        'The sales rep you selected is outside the subsidiaries this endpoint ' +
                        'can write for, so it cannot be credited. Pick one from the Sales rep ' +
                        'list on the order — that list only contains reps this endpoint ' +
                        'accepts. Nothing needs changing on anybody’s employee record.',
                    REQUESTED_NOT_A_REP:
                        'The person you selected is not flagged as a Sales Rep on their ' +
                        'employee record, and NetSuite will not accept them on the Sales Team. ' +
                        'Pick somebody from the Sales rep list, or have Sales Rep ticked on ' +
                        'their employee record.',
                    REQUESTED_INACTIVE:
                        'The sales rep you selected is inactive. Pick an active one from the ' +
                        'Sales rep list.',
                    CALLER_NOT_A_REP:
                        'No sales rep was selected, and you are not flagged as a Sales Rep on ' +
                        'your own employee record, so the order cannot be credited to you. ' +
                        'Pick a rep from the Sales rep list on the order.',
                    NO_CUSTOMER_REP:
                        'No sales rep was selected and this customer has none assigned, so ' +
                        'there is nobody to credit. Pick one from the Sales rep list on the ' +
                        'order.',
                    CUSTOMER_REP_UNUSABLE:
                        'No sales rep was selected. This customer has one assigned, but it is ' +
                        'either inactive or outside the subsidiaries this endpoint can write ' +
                        'for, so it cannot be credited. Pick one from the Sales rep list on ' +
                        'the order.',
                    UNKNOWN:
                        'No sales rep could be determined, so there is nobody to credit and ' +
                        'NetSuite would reject the order. Pick a rep from the list on the ' +
                        'order, or assign one to this customer.',
                }[why] || 'No sales rep could be determined.';

                log.error('ARCH Order Create — sales rep unresolved', 'cause=' + why);
                throw refusal(detail);
            }
            {
                so.setSublistValue({ sublistId: 'salesteam', fieldId: 'employee', line: 0, value: repId });
                // `salesrole` is deliberately NOT set. -2 is what the stored data
                // shows, but a value read out of a saved record is not necessarily
                // a value the API accepts, and setting it turned a clear
                // USER_ERROR into an opaque UNEXPECTED_ERROR at save. NetSuite
                // fills the role in itself for a single-line sales team.
                // Contribution and isprimary are deliberately NOT set. The real
                // orders store contribution as 0.5 for a two-way split, i.e. a
                // FRACTION rather than a percentage, so passing 100 would mean
                // 10,000%. With a single line NetSuite fills it in itself, and
                // both real lines carry isprimary=F, so asserting it is wrong too.
            }

            applyIncoterms(so, h);

            if (h.shipDate) {
                // setValue with a real Date, NOT setText. setText parses against
                // the executing user's date-format preference, so an ISO string
                // throws, and the old catch swallowed it at audit level — the
                // order saved with the field silently empty.
                const d = parseIsoDate(h.shipDate);
                if (d) {
                    setIfPresent(so, H_SHIP_DATE, d, 'the expected ship date');
                } else {
                    // Still not fatal: the order is correct without it. But it is
                    // now a refusal to guess rather than a swallowed exception.
                    log.audit('ARCH Order Create',
                        'Ship date "' + h.shipDate + '" is not YYYY-MM-DD and was not set.');
                }
            }

            // Not taken from the request. An earlier version accepted
            // `input.insuranceRate` from the browser, unbounded, which
            // contradicts this module's own rule about not letting a screen
            // choose financial context. It is configuration now.
            setIfPresent(so, H_INSURANCE, insuranceRate(), 'the ops and insurance rate');

            // ── Idempotency ─────────────────────────────────────────────────
            //
            // 🔴 Without this a double-click or a retry creates a SECOND order
            // committing the same stock. This project has already been bitten by
            // the underlying cause: a client-side fetch timeout does NOT cancel
            // the server, and re-firing the P6 suite produced overlapping runs
            // whose "failures" were the library correctly refusing stock the
            // first run had taken.
            //
            // `externalid` is used rather than a lookup-then-create because
            // NetSuite enforces uniqueness on it. A duplicate therefore fails in
            // the database with no race window, which a read-before-write check
            // cannot promise.
            if (idempotencyKey) {
                so.setValue({ fieldId: 'externalid', value: 'ARCH-ORDER-' + idempotencyKey });
            }
        } else {
            /* ── Header fields on an APPEND ───────────────────────────────────
             *
             * 🔴 THIS BLOCK EXISTS BECAUSE APPEND COULD NOT SAVE AT ALL. Every
             * header assignment lived under `if (!appending)`, so appending set
             * none of them — and NetSuite re-runs the form's mandatory-field
             * validation on the SAVE of an existing record, not just on create.
             * Appending to SO-CWP-001329 was refused with "Please enter value(s)
             * for: Incoterms, Department", because that order (written by the
             * temporary seed Suitelet, which bypassed mandatory fields) has
             * neither. The comment in the create branch predicted exactly this:
             * absence on an existing record is not evidence a field is optional.
             *
             * A second, quieter defect the same gap caused: the wizard collects
             * Customer PO, ship-to, incoterms and ship date in append mode, and
             * NONE of them were written. The trader filled in four fields that
             * did nothing.
             *
             * ── The rule this block follows ──────────────────────────────────
             *
             *   Apply what the trader could SEE and CHANGE.
             *   Fill what is MISSING and mandatory.
             *   Never rewrite what the trader was never shown.
             *
             * So `entity`, `currency` and `terms` are untouched: an append must
             * not be able to move an order to another customer or re-denominate
             * it. `department`, `location` and the insurance rate are filled ONLY
             * when empty — they are configuration and derived values that the
             * wizard never displays, and silently restating an existing order's
             * ops rate would change its economics behind the trader's back.
             */
            const h = input.header || {};
            const entityId = int(so.getValue({ fieldId: 'entity' }));

            // Shown on the wizard's header step, so applied. Sending the value
            // back unchanged is a no-op; where the trader edited it, the edit is
            // the point.
            if (h.customerPO) setIfPresent(so, H_CUSTOMER_PO, String(h.customerPO), 'the customer PO');
            applyIncoterms(so, h);

            if (h.shipDate) {
                const d = parseIsoDate(h.shipDate);
                if (d) {
                    setIfPresent(so, H_SHIP_DATE, d, 'the expected ship date');
                } else {
                    log.audit('ARCH Order Create',
                        'Ship date "' + h.shipDate + '" is not YYYY-MM-DD and was not set.');
                }
            }

            // Mandatory on form 386. Applied when the request names one, and
            // otherwise only filled when the order has none — an order that
            // already ships somewhere must not be redirected by an append that
            // was silent about it.
            const requestedAddr = int(h.shipAddressId);
            if (requestedAddr || !so.getValue({ fieldId: 'shipaddresslist' })) {
                const shipAddr = resolveShipAddress(entityId, h.shipAddressId);
                if (shipAddr) {
                    so.setValue({ fieldId: 'shipaddresslist', value: shipAddr });
                } else if (!so.getValue({ fieldId: 'shipaddresslist' })) {
                    throw refusal('That customer has no address on file, so this order has ' +
                                  'nowhere to ship to. Add an address to the customer first.');
                }
            }

            // ── Mandatory, and NOT on the wizard: fill the gap, never overwrite ──
            if (!int(so.getValue({ fieldId: 'department' }))) {
                so.setValue({ fieldId: 'department', value: departmentId() });
            }

            // "Reload (Ship From)". Derived from the lines being added, and only
            // when the order has none — see the create branch for why the label
            // and the field id differ.
            if (!int(so.getValue({ fieldId: 'location' }))) {
                const headerLocation = int(h.locationId) || soleLocation(resolved.lines);
                if (!headerLocation) {
                    throw refusal('This order has no ship-from location and the lines being added ' +
                                  'span more than one, so there is nothing to derive it from. ' +
                                  'Add lines from a single location, or send header.locationId.');
                }
                so.setValue({ fieldId: 'location', value: headerLocation });
            }

            // Configuration, so filled rather than restated. Overwriting it would
            // silently re-cost every line already on the order.
            if (!num(so.getValue({ fieldId: H_INSURANCE }))) {
                setIfPresent(so, H_INSURANCE, insuranceRate(), 'the ops and insurance rate');
            }
        }

        if (appending && idempotencyKey) {
            // Append cannot use a unique externalid, because the order already has
            // one (or none) and overwriting it would break whatever else keys off
            // it. So the marker is APPENDED to the existing value, and
            // `resolveOrderContext` reads it back to recognise a retry.
            const existing = (ctx.target && ctx.target.externalId) || '';
            so.setValue({ fieldId: 'externalid', value: existing + appendMarker(idempotencyKey) });
        }

        // Assignments already on the order BEFORE this call, so the verification
        // below compares the DELTA. Without this, appending to an order that
        // already carries the same lot reports a false mismatch at ERROR level.
        const priorAssignments = appending ? assignmentsByLot(existingId) : {};

        // The lines that already existed, so phase two cannot hang this request's
        // lot on a previous request's line. Read off the loaded record rather than
        // re-queried, so it is the same snapshot the lines are added to.
        const priorLineKeys = {};
        if (appending) {
            const existingCount = so.getLineCount({ sublistId: 'item' });
            for (let i = 0; i < existingCount; i++) {
                priorLineKeys[String(so.getSublistValue({
                    sublistId: 'item', fieldId: 'lineuniquekey', line: i,
                }))] = true;
            }
        }

        // Standard mode addresses lines by index, so new lines start after
        // whatever the order already has.
        const firstNewLine = appending ? so.getLineCount({ sublistId: 'item' }) : 0;
        const wantsReman = resolved.lines.some((l) => !!l.reman);
        const remanOk = wantsReman ? remanFieldsPresent(so) : false;
        // `every` over the write outcomes, not the intent: one refused line makes
        // the whole order reman-not-stored, because a trader told "recorded" would
        // stop carrying ANY of it across by hand.
        const remanWrites = resolved.lines.map(
            (line, i) => addLine(so, line, firstNewLine + i, remanOk));

        let soId;
        try {
            soId = so.save({ enableSourcing: true, ignoreMandatoryFields: false });
        } catch (e) {
            // The unique externalid doing its job: this exact request already
            // created an order. Report the refusal rather than a raw NetSuite
            // error, so a retried double-click reads as "already done".
            if (idempotencyKey && /extern|unique|duplicate/i.test(e.message || String(e))) {
                const dup = new Error('This order was already created by an identical request. ' +
                                      'Nothing was duplicated.');
                dup.name = 'ARCH_ORDER_REFUSED';
                throw dup;
            }
            throw e;
        }

        // Phase two. The order already exists at this point, so a failure here is
        // reported rather than thrown: throwing would tell the trader the order
        // failed when it is sitting in NetSuite with correct quantities.
        const unplaced = assignLots(soId, resolved.lines, priorLineKeys);
        const wrongForm = unplaced.length ? formWarning(soId) : null;
        if (unplaced.length) {
            log.error('ARCH Order Create — LOTS NOT ATTRIBUTED on SO ' + soId,
                'The order exists with correct quantities but ' + unplaced.length + ' of ' +
                resolved.lines.length + ' line(s) carry no lot, so the bundles are NOT locked: ' +
                unplaced.join('; ') +
                (wrongForm ? ' | LIKELY CAUSE: the order ' + wrongForm : ''));
        }

        const check = verifyAssignments(soId, resolved.lines, priorAssignments);

        // Only report a mismatch when at least one lot actually landed. When
        // NOTHING was placed, every line is trivially a "mismatch" and the
        // LOTS NOT ATTRIBUTED line above has already said so at error level.
        // Logging both put two error entries on the log for one condition, and
        // this account may email on error — `notifyowner` and `notifyemails` are
        // not readable from SuiteQL, so it cannot be ruled out.
        const somethingLanded = unplaced.length < resolved.lines.length;
        if (check.mismatches.length && somethingLanded) {
            // Deliberately ERROR: this is rare and abnormal, which is the bar
            // this codebase sets for the error level. A quantity that did not
            // land as intended on a trading document is not routine noise.
            log.error('ARCH Order Create — ASSIGNMENT MISMATCH on SO ' + soId,
                check.mismatches.join('; '));
        }

        log.audit('ARCH Order Create',
            (appending ? 'Appended to' : 'Created') + ' SO ' + soId + ' with ' +
            resolved.lines.length + ' line(s), ' + check.assignmentRows + ' assignment row(s)' +
            (check.mismatches.length ? ' — WITH MISMATCHES' : ''));

        /* Confirmation PDF. LAST, and after the audit line, so the order's own
         * record in the log is written before anything that talks to the outside
         * world. Non-fatal by construction — see sendOrderPdf. */
        const tranId = (function () {
            try {
                const r = query.runSuiteQL({
                    query: 'SELECT tranid FROM transaction WHERE id = ?',
                    params: [soId],
                }).asMappedResults();
                return r.length ? String(r[0].tranid) : 'SO ' + soId;
            } catch (e) {
                return 'SO ' + soId;
            }
        }());
        const pdfMail = sendOrderPdf(soId, tranId, int(runtime.getCurrentUser().id));

        return {
            ok: true,
            salesOrderId: soId,
            tranId: tranId,
            appended: appending,
            // Reported so the screen can say "emailed to you" rather than implying
            // it. Off by default, so `sent: false` is the normal answer.
            pdfEmail: pdfMail,
            lines: resolved.lines.map((l) => ({
                itemCode: l.itemCode,
                lotName:  l.lotName,
                quantity: l.displayQty,
                isSplit:  l.isSplit,
            })),
            splitLinesQueued: resolved.lines.filter((l) => l.isSplit).length,
            /* Whether the reman instructions actually reached the order.
             *
             * Reported rather than assumed, and this is the whole point: the
             * fields may or may not be deployed, and the SCREEN must not be the
             * thing that decides which. Six separate notices in this app told
             * traders a path did not write to NetSuite long after it did, all
             * because the claim was hardcoded in the copy. Here the server says
             * what happened and the copy repeats it.
             *
             * `false` with `remanRequested: true` means the trader typed
             * instructions that were NOT saved and must be passed on by hand. */
            remanRequested: wantsReman,
            remanStored: wantsReman && remanOk && remanWrites.every(Boolean),
            assignmentRows: check.assignmentRows,
            assignmentMismatches: check.mismatches,
            // Reported, not asserted — this is how the sign convention for a
            // sales order's assignments gets established on the first real write.
            storedSigns: check.storedSigns,
            insuranceRate: insuranceRate(),
            idempotencyKey: idempotencyKey,
            // Non-empty means the order exists but those bundles are NOT locked.
            lotsNotAttributed: unplaced,
            formWarning: wrongForm,
        };
    };

    /**
     * Validates without writing, so the wizard can refuse a stale cart before the
     * trader commits to it. Same code path as the write, so a dry run that passes
     * and a write that then fails means the data moved underneath rather than the
     * two disagreeing.
     */
    const validateOrder = (input) => {
        // Same order-level checks as the write, and in the same order, so a dry
        // run that passes means the write will get past this point too. When it
        // fails, the refusal is returned as a problem rather than thrown: a dry
        // run's job is to report, not to raise.
        try {
            resolveOrderContext(input);
        } catch (e) {
            if (e.name !== 'ARCH_ORDER_REFUSED') throw e;
            return { ok: false, problems: [e.message], lines: [] };
        }

        const resolved = resolveLines(input.lines);
        return {
            ok: resolved.problems.length === 0,
            problems: resolved.problems,
            lines: resolved.lines.map((l) => ({
                itemCode:         l.itemCode,
                lotName:          l.lotName,
                quantity:         l.displayQty,
                storedQuantity:   l.storedQty,
                bundleQuantity:   l.bundleDisplayQty,
                isSplit:          l.isSplit,
                remainderIfSplit: l.isSplit ? l.bundleDisplayQty - l.displayQty : 0,
            })),
        };
    };

    /**
     * Which line fields this endpoint can actually write. Read-only.
     *
     * ── Why this exists ─────────────────────────────────────────────────────
     * `remanFieldsPresent` decides at write time whether reman can be stored,
     * and its answer rests on an assumption worth proving rather than trusting:
     * that `getSublistFields` lists CUSTOM column fields at all. If it does not,
     * the reman write would be skipped forever, including after the four objects
     * are deployed, and the endpoint would keep reporting `remanStored: false`
     * while looking entirely healthy.
     *
     * So `split` is here as a CONTROL. `custcol_mgsl_split` is deployed and is
     * written successfully on every split line, so it MUST read true. If it ever
     * reads false, the probe mechanism is broken and the reman answer means
     * nothing -- do not go looking for a missing deploy.
     *
     * Creates an UNSAVED sales order and asks it. `record.create` writes nothing;
     * only `save` does. Runs under the deployment's `runasrole`, same as a real
     * create, so it reflects what the writer would actually see rather than what
     * an administrator would.
     *
     * ⚠️ It answers for the CREATE path specifically. A new record takes the form
     * that follows the executing role, but an APPEND inherits the form stored on
     * the order it is adding to, and a field hidden on that form is not
     * guaranteed to appear here. `remanFieldsPresent` therefore probes the actual
     * record being written rather than trusting this; treat this as "is the
     * deploy done", not as a per-order guarantee.
     */
    const fieldReadiness = () => {
        try {
            const so = record.create({ type: record.Type.SALES_ORDER, isDynamic: false });
            const fields = so.getSublistFields({ sublistId: 'item' }) || [];
            const has = (id) => fields.indexOf(id) !== -1;
            return {
                split: has(F_SPLIT) && has(F_SPLIT_BF) && has(F_SPLIT_STATUS),
                reman: has(F_REMAN_PLANE) && has(F_REMAN_PLANE_TGT)
                    && has(F_REMAN_CUT) && has(F_REMAN_CUT_LEN),
                remanMissing: [F_REMAN_PLANE, F_REMAN_PLANE_TGT, F_REMAN_CUT, F_REMAN_CUT_LEN]
                    .filter((id) => !has(id)),
                itemFieldCount: fields.length,
            };
        } catch (e) {
            return { error: (e.name || '') + ': ' + (e.message || String(e)) };
        }
    };

    return {
        createOrder: createOrder,
        validateOrder: validateOrder,
        fieldReadiness: fieldReadiness,
        listSalesReps: listSalesReps,
        // Exported for the test runner.
        resolveLines: resolveLines,
        verifyAssignments: verifyAssignments,
    };
});
