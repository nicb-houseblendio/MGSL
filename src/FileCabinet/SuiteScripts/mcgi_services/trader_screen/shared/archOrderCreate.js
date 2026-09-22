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
 *
 * ── ⚠️ The one thing the caller MUST name, or it does not happen ────────────
 * `header.salesTeamId` is the exception that proves the rule above. Commission
 * attribution is not derived, defaulted or configured: no team id means the old
 * single sublist line, and a team id means THAT team, validated member by member
 * and refused whole if any member is unusable. Subsidiary and department are
 * refused from the caller because a screen must not choose where money POSTS;
 * a sales team is required FROM the caller because nothing else may choose who
 * money goes TO. See `resolveSalesTeam`.
 */
define(['N/record', 'N/query', 'N/search', 'N/runtime', 'N/log', 'N/render', 'N/email',
        'N/currency', './archSplitExecute'],
// AMD BINDS POSITIONALLY. N/render and N/email were appended to the array and
// their parameters inserted at the SAME positions, before splitLib, in one edit.
// N/currency was appended the same way on 2026-09-15, again before splitLib.
(record, query, search, runtime, log, render, email, currencyMod, splitLib) => {

    /**
     * ⚠️ SUPERSEDED 2026-09-10 — see the cache MR's header comment for the full
     * reasoning (`mcgi_mr_trader_screen_cache_arch.js`). The segment
     * (`cseg_subsidiary_loc`, 1 = Hardwood) is a manual, opt-in, per-item flag
     * that has already failed twice: real ARCH stock went invisible because
     * nobody tagged the item. Scoping is now department "Hardwood", minus a
     * hardcoded exclusion list for decking, the one real product-line
     * distinction inside that department. This module gates ORDER CREATION,
     * not display, so it has to use the SAME scope the screen now uses — an
     * item that shows on the grid must be orderable, and one that does not
     * must still be refused here.
     *
     * BY NAME, not internal id 11: measured 2026-09-10, that id does not
     * exist at all in production — same class of trap as a status-list value
     * differing by environment. `readLotStates` below selects
     * `BUILTIN.DF(i.department)`, a string, not the raw id.
     */
    const HARDWOOD_DEPARTMENT = 'Hardwood';
    /* 🔴 AND THE SUBSIDIARY ARM, WITHOUT WHICH THIS ENDPOINT REFUSES 95% OF THE
     * STOCK THE SCREEN DISPLAYS.
     *
     * Feedback 7 moved the cache builder's scope to
     * `(department = 'Hardwood' OR subsidiary = 'ARC')` because Marc-Antoine's
     * inventory arrived in subsidiary ARC carrying department "Trading", not
     * "Hardwood". THIS MODULE NEVER GOT THAT CHANGE, and the comment on the
     * check in `resolveLines` still claims "Same scope as the cache MR uses for
     * display" -- an assertion that silently stopped being true and is what kept
     * the divergence invisible.
     *
     * Measured 2026-09-21, on-hand lots inside the ARCH scope:
     *
     *     ARC      / Trading    99 items   1,048 lots   <- every one REFUSED
     *     CWP MTL  / Hardwood   15 items      51 lots   <- the only sellable set
     *
     * So the grid offered 132 rows and this endpoint would reject 95% of them
     * with "X is not an ARCH hardwood item and cannot be ordered from the ARCH
     * screen".
     *
     * 🔴 AND IT WAS PROVEN RATHER THAN INFERRED, because the obvious check says
     * the opposite. 33 sales orders on ARC/Trading items exist, the newest created
     * the same day, which reads as "creation works fine". It does not: every one
     * was made by hand in the NetSuite UI -- Mohamed Chraiet, Lucas Gibb,
     * Marc-Antoine -- and NOT ONE carries the `ARCH-` externalid this endpoint
     * stamps for idempotency. The external ids that are there read
     * `SAP-ARC-SO-*`, a migration prefix. This endpoint has created zero.
     *
     * ⚠️ THE DECKING EXCLUSION APPLIES TO BOTH ARMS, and that is the trap in
     * widening this. `NON_ARCH_DEPARTMENT_ITEMS` is the one real product-line
     * split inside the scope; hanging it off the department arm alone would make
     * IPE and the other decking SKUs orderable from the ARCH screen the moment
     * they sit in ARC.
     *
     * ONE predicate, used by every site, so the next divergence is a compile-time
     * concern rather than an invisible one. Drop the department arm when the CWP
     * MTL hardwood items and their open POs finish moving to ARC -- the same exit
     * condition Feedback 7 recorded for the cache.
     */
    const ARCH_SUBSIDIARY_NAME = 'ARC';

    /**
     * Is this item inside the ARCH scope, by department OR subsidiary, and not a
     * decking SKU? `subsidiary` may be undefined on a caller that has not been
     * updated to select it, in which case this degrades to the old
     * department-only behaviour rather than throwing.
     */
    const inArchScope = (department, subsidiary, itemCode) => {
        const dept = String(department == null ? '' : department).trim();
        const sub  = String(subsidiary == null ? '' : subsidiary).trim();
        const code = String(itemCode == null ? '' : itemCode).trim();
        // Decking is out regardless of which arm matched.
        if (NON_ARCH_DEPARTMENT_ITEMS.indexOf(code) !== -1) return false;
        return dept === HARDWOOD_DEPARTMENT || sub === ARCH_SUBSIDIARY_NAME;
    };
    const NON_ARCH_DEPARTMENT_ITEMS = [
        'IPE44DECKD', 'IPE54DECKD', 'IPE54DECKDDNU',
        'NRM44DECKDS4S', 'NRM44DECKDTNG',
        'RBL44DECKD', 'RBL54DECKD',
    ];

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
     * FALLBACK operations + insurance rate, for a customer that carries none.
     *
     * Measured across all 4,216 SOs in the account on 2026-08-20: 3,979 (94.4%)
     * carry 0.003, the range is 0.0015-0.015 and only 48 are null. The front end
     * prices the draft against this same default.
     *
     * ⚠️ It is NOT stamped unconditionally. `custbody_mgsl_insurancerate` is
     * sourced from the customer, and this module only fills it when the customer
     * has no rate of its own: 105 of 815 active customers in prod on 2026-09-03,
     * against 710 that carry one, 47 of those at something other than 0.003. On
     * those 710 the order records the customer's rate while the trader was quoted
     * this one, so the two DO diverge -- by design, and reported rather than
     * hidden: see `customerInsuranceRate`, the audit line at the write site, and
     * `insuranceRateSource` in the result. Stamping over the customer to force
     * agreement was the old behaviour, and it overwrote negotiated rates.
     *
     * This is the FRACTION, which is what prices a line and what the browser is
     * handed back. The field itself is a Percent and wants 0.3 for the same
     * rate -- see `insuranceRateStored`.
     */
    const INSURANCE_RATE_DEFAULT = 0.003;

    /**
     * Department stamped on ARCH orders.
     *
     * 🔴 WAS 11, AND 11 CANNOT BE WRITTEN ON AN ARC ORDER AT ALL.
     *
     * Department 11 is `Trading : Hardwood` and its SUBSIDIARY LIST IS `CWP MTL`
     * AND NOTHING ELSE. Department 9 `Trading` is the parent and is available to
     * every subsidiary including ARC. Measured 2026-09-21:
     *
     *   9   Trading             parent, 27 subsidiaries incl. ARC
     *   11  Trading : Hardwood  parent 9, CWP MTL only
     *   10  Trading : Softwood  parent 9, CWP MTL only
     *
     * The order's subsidiary is sourced from the CUSTOMER, so an ARC customer
     * makes an ARC order, and writing 11 on it fails with "You have entered an
     * Invalid Field Value 11 for the following field: department". That is the
     * 2026-09-14 failure recorded at `diagnoseDepartment` below, and it would
     * have refused EVERY order on ARC stock the day traders went on the screen.
     *
     * ⚠️ It was diagnosed as a role permission for a week, including in this
     * file's own error text, which then got quoted back as evidence. A department
     * that is not available to the order's subsidiary is invalid for every role,
     * Administrator included, so no permission change would have fixed it.
     *
     * 9 IS ALSO WHAT MGSL ACTUALLY USES, in both subsidiaries. Sales orders by
     * subsidiary and department, 2026-09-21:
     *
     *   CWP MTL  Trading   1,452     ARC  Trading  33
     *   CWP MTL  Hardwood     33
     *   CWP MTL  Softwood      9
     *
     * So 11 was never the house convention: it appears on 33 of 1,495 MTL orders
     * and THIS ENDPOINT WROTE 16 OF THEM. The previous comment here had already
     * noticed real MTL orders use 9 and called it a value "to change"; nobody
     * changed it because nothing had failed yet.
     *
     * And the granularity is not lost. Once ARCH moved into its own subsidiary,
     * the Hardwood DEPARTMENT is redundant for it: subsidiary ARC identifies the
     * business, which is the reason the migration chose subsidiary over
     * department in the first place.
     *
     * Still overridable by script parameter, and now VALIDATED against the
     * record's own option list before the save -- see `resolveDepartment`.
     */
    const DEPARTMENT_DEFAULT = 9;

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
     * The signed-in person's employee id. NOT `int()`: NetSuite's built-in
     * Administrators are real employee records with NEGATIVE internal ids, and in
     * this account Philippe Dubois is -5 (active, has an email, verified 2026-09-08).
     * `int(-5)` is null, so the CREATOR mail reported 'no creator' for the one
     * Administrator who can reach this endpoint, and the current-user rep fallback
     * was skipped for him too. Zero is the only value that is never a person.
     */
    const currentUserId = () => {
        const n = Number(runtime.getCurrentUser().id);
        return Number.isSafeInteger(n) && n !== 0 ? n : null;
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

    /**
     * 🔴 ASK THE ACCOUNT, DO NOT TRUST THE CONSTANT.
     *
     * `departmentId()` is a wish. Whether it can be written depends on the
     * order's subsidiary, which depends on the customer, which is only known
     * once `entity` is set. So this runs AFTER the customer and checks the
     * wanted department against `departmentsubsidiarymap` before the save.
     *
     * Why a fallback and not a throw: a refused save costs the trader the whole
     * wizard, and there is normally a correct answer available -- department 9
     * `Trading` is mapped to 27 subsidiaries. Failing closed on a configuration
     * mismatch turns it into an outage, which is exactly what the 11-on-ARC bug
     * did for a week.
     *
     * Order of preference:
     *   1. the wanted id, when the map says this subsidiary allows it
     *   2. `DEPARTMENT_DEFAULT`, when the map allows that instead
     *   3. the wanted id unchanged, at ERROR level, so the save reports the real
     *      refusal rather than this code guessing a department onto an order
     *
     * ⚠️ Step 3 never invents a third answer. An arbitrary valid department would
     * write wrong GL segmentation onto a real customer order and nobody would
     * notice; a refused save is visible and gets reported.
     *
     * ⚠️ And every unknown resolves to "keep the wish, unvalidated": a throw from
     * the query, or zero rows. An empty result must NOT be read as "nothing is
     * valid" -- that is the same false-zero shape as an unsupported SuiteQL
     * filter returning 0 rows for a populated field.
     */
    const resolveDepartment = (so) => {
        const wanted = departmentId();
        const sub = int(so.getValue({ fieldId: 'subsidiary' }));

        /* No subsidiary yet means no question to answer. The create path sets
         * `entity` before this runs precisely so the subsidiary is populated by
         * the time we get here, but an append can reach it on a record whose
         * subsidiary is not exposed to the executing role. */
        if (!sub) return wanted;

        /* 🔴 WAS `fld.getSelectOptions()`, WHICH DOES NOT EXIST HERE.
         *
         * The first version of this function asked the department field for its
         * option list. On a NON-DYNAMIC record that method is not defined, so
         * every call threw, the catch returned `wanted` unvalidated, and the
         * whole validation layer was dead code that reported success. It was
         * caught by the health GET on 2026-09-21:
         *
         *   "optionsError": "TypeError: fld.getSelectOptions is not a function"
         *
         * The guards passed because they mocked `getSelectOptions` as a
         * function, which is the classic shape of a test that proves the mock
         * works. `departmentsubsidiarymap` is the real source: two columns,
         * 193 rows, and it is what NetSuite itself filters the dropdown on.
         */
        let rows = null;
        try {
            rows = query.runSuiteQL({
                query: 'SELECT department FROM departmentsubsidiarymap WHERE subsidiary = ?',
                params: [sub],
            }).asMappedResults() || [];
        } catch (e) {
            /* ⚠️ REST SuiteQL and N/query are DIFFERENT DIALECTS, and this query
             * was written and proved against the REST endpoint. If
             * `departmentsubsidiarymap` is not a valid search type inside
             * N/query it throws HERE, on a live order. The only acceptable
             * outcome is the behaviour we had before validation existed: a
             * validation failure must never become an order failure. */
            log.audit('ARCH order - department validation unavailable',
                'Keeping department ' + wanted + ' unvalidated for subsidiary ' + sub + '. ' +
                (e && e.message ? e.message : e));
            return wanted;
        }

        /* 🔴 AN EMPTY RESULT IS NO INFORMATION, NOT "nothing is valid".
         * Treating zero rows as authoritative is the same false-zero shape an
         * unsupported SuiteQL filter produces, which cost a whole measurement
         * pass on 2026-09-21 by returning 0 for a field with 271 populated
         * rows. No rows means we learned nothing; proceed as before. */
        if (!rows.length) return wanted;

        const valid = {};
        for (let i = 0; i < rows.length; i++) {
            const id = int(rows[i].department);
            if (id) valid[String(id)] = true;
        }
        if (valid[String(wanted)]) return wanted;

        if (valid[String(DEPARTMENT_DEFAULT)]) {
            log.audit('ARCH order - department remapped for this subsidiary',
                'Department ' + wanted + ' is not available to subsidiary ' + sub +
                ', so this order uses ' + DEPARTMENT_DEFAULT + ' instead.');
            return DEPARTMENT_DEFAULT;
        }

        /* 🔴 DELIBERATELY DOES NOT INVENT A DEPARTMENT.
         *
         * There is no third guess worth making. Picking an arbitrary valid id
         * would write wrong GL segmentation onto a real customer order and
         * nobody would ever notice. Letting the save refuse costs the trader
         * this one order and produces a report. A visible failure beats silent
         * miscoding, so keep the wish and let NetSuite say no. */
        log.error('ARCH order - no valid department for this subsidiary',
            'Subsidiary ' + sub + ' allows ' + Object.keys(valid).length + ' department(s), and ' +
            'neither ' + wanted + ' nor the default ' + DEPARTMENT_DEFAULT + ' is among them. ' +
            'Keeping ' + wanted + ' so the save reports the real refusal rather than this code ' +
            'guessing a department onto a customer order.');
        return wanted;
    };

    /**
     * The REAL incoterms options, read from NetSuite rather than invented.
     *
     * Served to the wizard the same way `listSalesReps` is, and for the same
     * reason: the list and the validator must run under the same role so the
     * screen cannot offer a value the write path then refuses. That failure is
     * exactly what happened here, in its worst form -- the picker offered
     * "Customer Pick Up", which is not a value in this account, and NetSuite
     * answered `Invalid custbody_incoterms reference key`. The three options came
     * from `archOrderFixtures.ts`, a demo-data module, driving a mandatory field.
     *
     * `getSelectOptions` is used rather than a `customlist` query on purpose:
     * `custbody_incoterms` is not in the `customlist` or `customfield` tables that
     * SuiteQL exposes here (both return zero rows for it, verified), so there is no
     * list id to query. Asking the field itself needs no id and cannot drift from
     * what the form would accept.
     *
     * The record is created and thrown away, never saved. `record.create` does not
     * validate mandatory fields, so this costs a governance unit, not an order.
     */
    /**
     * The rate that turns a COST into the currency the order is billed in.
     *
     * Feedback 6 item 10b, Marc-Antoine 2026-09-14: "Calcul du profit : Est-ce
     * qu'il prend en compte la devise du SO vs la devise du lot? ... idéalement on
     * le converti en USD au taux du SO date pour avoir une bonne idée." His own
     * worked example is a USD sale with a CAD lot cost and CAD services, and the
     * profit line under it reads "on a du cad et USD mixed".
     *
     * Everything on the cost side of the trader screen is Canadian: the cache
     * costs against accounting book 1, whose subsidiaries are all CAD-based, and
     * the service rates are Canadian by his instruction in item 9b. Revenue is
     * whatever the customer is billed in. So one multiplier closes the gap.
     *
     * 🔴 DIRECTION. `rate` converts FROM the cost currency TO the order currency,
     * which is what the screen multiplies by. For USD today that is about 0.719,
     * the reciprocal of the 1.3906 a trader sees on the sales order itself, so
     * `quotedRate` carries the familiar figure for display and nothing has to be
     * inverted in the browser.
     *
     * Returns `rate: null` rather than 1 when it cannot answer. A silent 1 would
     * be a claim that the currencies are at par, and the screen would print a
     * converted margin that was never converted.
     */
    /**
     * A YYYY-MM-DD in the ACCOUNT's day rather than UTC.
     *
     * `toISOString().slice(0,10)` is UTC, so from 20:00 Eastern it reads as
     * tomorrow. Not cosmetic here: the Cut milling rate ends 2026-12-31, and a
     * UTC "today" of 2027-01-01 on the evening of the 31st would expire it and
     * drop the screen back to a constant without saying so.
     */
    const isoDay = (d) => {
        const p = (n) => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };

    const getFxRate = (orderCurrency, dateIso) => {
        const COST_CURRENCY = 'CAD';
        const target = String(orderCurrency || '').trim().toUpperCase();
        if (!target) return { rate: null, error: 'No order currency was given.' };
        // An ISO code or nothing. Letting anything else through is what turned a
        // currency into a LIKE pattern below.
        if (!/^[A-Z]{3}$/.test(target)) {
            return { rate: null, error: '"' + target + '" is not a currency code.' };
        }
        if (target === COST_CURRENCY) {
            return { rate: 1, quotedRate: 1, source: COST_CURRENCY, target: target,
                     effectiveDate: null, via: 'same-currency', error: null };
        }

        /*
         * 🔴 ONE DATE PARSER IN THIS FILE, and this used to be the second one.
         * The regex-and-construct version here accepted 2026-02-30 and let
         * JavaScript roll it into 2026-03-02, then returned that day's rate as a
         * success: measured live 2026-09-15, `date=2026-02-30` answered 1.3651
         * where today is 1.3906, a 1.9% error on every converted cost, labelled
         * with a date nobody asked for. `0002-09-15` became 1902 the same way.
         *
         * `parseIsoDate` refuses all of those, and it is the SAME parser the write
         * path already uses for this same ship-date field, so the screen can no
         * longer price an order against a day the order itself would reject.
         */
        const asked = parseIsoDate(dateIso);
        if (dateIso && !asked) {
            return { rate: null, error: 'Ship date "' + String(dateIso) +
                '" is not a real date, so no exchange rate was read.' };
        }
        const effective = asked || new Date();

        try {
            const r = currencyMod.exchangeRate({
                source: COST_CURRENCY,
                target: target,
                date: effective,
            });
            const n = parseFloat(r);
            if (isFinite(n) && n > 0) {
                /*
                 * ⚠️ `asOf` is the date we ASKED about, not the date of the rate
                 * row NetSuite used. For a future ship date NetSuite answers with
                 * the latest rate it holds, so calling this "the rate for
                 * 2026-09-30" would assert a rate that may not exist yet. The
                 * client phrases it as the rate NetSuite APPLIES for that date,
                 * which is exactly what it is and is also what the sales order
                 * will carry.
                 */
                return {
                    rate: n,
                    quotedRate: 1 / n,
                    source: COST_CURRENCY,
                    target: target,
                    asOf: isoDay(effective),
                    effectiveDate: null,
                    via: 'N/currency',
                    error: null,
                };
            }
        } catch (e) {
            log.debug('ARCH fx', 'N/currency could not answer ' + COST_CURRENCY + '->' +
                target + ': ' + (e.message || String(e)));
        }

        /*
         * Fallback, and it reads the table the other way round on purpose.
         * `currencyrate` stores base CAD against transaction USD with the rate
         * NetSuite puts on the sales order, 1.3906 today, which is CAD per USD.
         * So the multiplier this function returns is its reciprocal.
         */
        try {
            /*
             * 🔴 JOINS THE CURRENCY CODE. This used to LIKE against the display
             * NAME with the caller's string wrapped in wildcards, which had two
             * defects in one line. The wildcards survived binding, so a currency
             * of "%" built LIKE '%%%' and handed back another currency's rate as
             * a success. And matching a three-letter code against an English name
             * worked by luck: USD needed a special case, EUR matched "Euro" by
             * accident, and the first currency whose code is not inside its name
             * would have been reported as having no rate while its row sat in the
             * table. `currency.symbol` is the ISO code, so the join says what was
             * meant, and the shape check above makes the wildcard unreachable.
             */
            const rows = query.runSuiteQL({
                query:
                    "SELECT cr.exchangerate, TO_CHAR(cr.effectivedate, 'YYYY-MM-DD') AS eff " +
                    'FROM currencyrate cr ' +
                    'JOIN currency bc ON bc.id = cr.basecurrency ' +
                    'JOIN currency tc ON tc.id = cr.transactioncurrency ' +
                    'WHERE UPPER(bc.symbol) = ? ' +
                    '  AND UPPER(tc.symbol) = ? ' +
                    "  AND cr.effectivedate <= TO_DATE(?, 'YYYY-MM-DD') " +
                    'ORDER BY cr.effectivedate DESC',
                params: [COST_CURRENCY, target, isoDay(effective)],
            }).asMappedResults();
            if (rows && rows.length) {
                const quoted = parseFloat(rows[0].exchangerate);
                if (isFinite(quoted) && quoted > 0) {
                    /* This path DOES know the row's own date, because it read
                     * it, so both are carried and the client can say the stronger
                     * thing when it has it. */
                    return {
                        rate: 1 / quoted,
                        quotedRate: quoted,
                        source: COST_CURRENCY,
                        target: target,
                        asOf: isoDay(effective),
                        effectiveDate: rows[0].eff || null,
                        via: 'currencyrate',
                        error: null,
                    };
                }
            }
        } catch (e) {
            return { rate: null, error: 'No exchange rate could be read for ' +
                COST_CURRENCY + ' to ' + target + ': ' + (e.message || String(e)) };
        }

        return { rate: null, error: 'No exchange rate exists for ' + COST_CURRENCY +
            ' to ' + target + ' on or before ' + isoDay(effective) + '.' };
    };

    /**
     * The milling rates, read from the record Mo built rather than from constants.
     *
     * Feedback 6 item 10c, Marc-Antoine 2026-09-14: "Pour le Split/Cut/PLaning on
     * pourrait feeder les taux à partir du `customrecord_milling_rate` que Mo a
     * créé pour que ce soit dynamique."
     *
     * Three rows exist, created 2026-09-08. They agreed with the screen's
     * constants on two of three and disagreed on planing, 0.25 against 0.20,
     * which is the figure he confirmed in writing. He edited that row to 0.20
     * himself on 2026-09-15, so the record and the code now agree on all three
     * and switching the source changes no number today. That is the safest moment
     * to switch it.
     *
     * 🔴 THE UNIT IS CHECKED, NOT ASSUMED. A per-BF rate applied as a flat fee, or
     * a flat fee applied per board foot, is a 600x error on a normal bundle. A row
     * whose unit is not the one the caller expects is refused and the caller keeps
     * its own constant, which is the only safe direction.
     *
     * Dates are honoured: a row applies when it started on or before the order
     * date and has not ended before it. The Cut row carries an end date of
     * 2026-12-31 today, so this is not theoretical.
     */
    const getMillingRates = (dateIso) => {
        const out = { rates: {}, rows: [], error: null };
        /*
         * 🔴 THE SAME PARSER AS EVERY OTHER DATE IN THIS FILE. This used to keep
         * the caller's string and compare it lexicographically, so `2026-99-99`
         * was accepted, sorted after the Cut row's end date of 2026-12-31, and
         * reported that rate as expired: measured live, the endpoint answered
         * `ok: true` with cutting missing, and the screen then charged its own
         * constant while the legend said the sources were mixed. Harmless only
         * while the record and the constants agree, which is precisely what item
         * 10c exists to stop relying on.
         */
        const parsed = parseIsoDate(dateIso);
        if (dateIso && !parsed) {
            return { rates: {}, rows: [], asOf: null, error: 'Ship date "' + String(dateIso) +
                '" is not a real date, so no milling rates were read.' };
        }
        const asked = isoDay(parsed || new Date());
        let rows;
        try {
            rows = query.runSuiteQL({
                query:
                    'SELECT id, name, ' +
                    '  BUILTIN.DF(custrecord_mcgi_mr_feetype) AS feetype, ' +
                    '  BUILTIN.DF(custrecord_mcgi_mr_unit)    AS unit, ' +
                    '  custrecord_mcgi_mr_rate                AS rate, ' +
                    "  TO_CHAR(custrecord_mcgi_mr_startdate, 'YYYY-MM-DD') AS startdate, " +
                    "  TO_CHAR(custrecord_mcgi_mr_enddate,   'YYYY-MM-DD') AS enddate " +
                    'FROM customrecord_milling_rate ' +
                    "WHERE isinactive = 'F' " +
                    // Deterministic. Without it two rows sharing a fee type came
                    // back in whatever order NetSuite chose, and the tiebreak below
                    // then depended on that order.
                    'ORDER BY custrecord_mcgi_mr_startdate, id',
            }).asMappedResults();
        } catch (e) {
            return { rates: {}, rows: [], error: 'The milling rate record could not be ' +
                'read: ' + (e.message || String(e)) };
        }

        /* feetype and unit are list values, so they are matched on their LABEL.
         * The internal ids are 1/2/3 today and would move with any list edit,
         * while the labels are what a human reads on the record. */
        const KEY = { split: 'split', planning: 'planing', planing: 'planing', cut: 'cut', cutting: 'cut' };
        const PER_BF = 'par bf';
        const FLAT = 'fixe';

        for (let i = 0; i < (rows || []).length; i++) {
            const r = rows[i];
            const label = String(r.feetype || '').trim().toLowerCase();
            // Own property only: a fee type named "constructor" or "toString"
            // would otherwise resolve to an inherited function and pass the
            // truthiness check below.
            const key = Object.prototype.hasOwnProperty.call(KEY, label) ? KEY[label] : undefined;
            const rate = parseFloat(r.rate);
            const unit = String(r.unit || '').trim().toLowerCase();
            const started = !r.startdate || r.startdate <= asked;
            const ended = !!r.enddate && r.enddate < asked;
            const unitOk = key === 'split'
                ? unit.indexOf(FLAT) !== -1
                : unit.indexOf(PER_BF) !== -1;

            out.rows.push({
                id: r.id, name: r.name, feetype: r.feetype, unit: r.unit, rate: r.rate,
                startdate: r.startdate || null, enddate: r.enddate || null,
                used: !!(key && isFinite(rate) && rate >= 0 && started && !ended && unitOk),
                why: !key ? 'fee type not recognised'
                    : !isFinite(rate) || rate < 0 ? 'rate is not a usable number'
                    : !started ? 'starts after ' + asked
                    : ended ? 'ended before ' + asked
                    : !unitOk ? 'unit does not match what the screen applies'
                    : null,
            });
            if (!key || !isFinite(rate) || rate < 0 || !started || ended || !unitOk) continue;
            /* Latest start wins when two rows overlap, so a newer rate supersedes
             * an older one without anyone having to inactivate the old row. */
            const prev = out.rates[key];
            if (!prev || String(r.startdate || '') >= String(prev.startdate || '')) {
                out.rates[key] = { rate: rate, startdate: r.startdate || null, enddate: r.enddate || null, id: r.id };
            }
        }
        out.asOf = asked;
        return out;
    };

    const listIncoterms = () => {
        let rec;
        try {
            rec = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
        } catch (e) {
            return { incoterms: [], error: 'Could not open a sales order to read the ' +
                'incoterms list: ' + (e.message || String(e)) };
        }
        try {
            const fld = rec.getField({ fieldId: H_INCOTERMS });
            if (!fld) {
                return { incoterms: [], error: 'Field ' + H_INCOTERMS + ' is not on the ' +
                    'sales-order form this role uses, so its options cannot be read.' };
            }
            const opts = fld.getSelectOptions({ filter: '', operator: 'contains' }) || [];
            const out = [];
            for (let i = 0; i < opts.length; i++) {
                const v = opts[i] ? opts[i].value : null;
                const t = opts[i] ? opts[i].text : null;
                // NetSuite includes a blank option for an unset select. It is not a
                // choice, and offering it would put the mandatory field right back
                // where it started.
                if (v === null || v === undefined) continue;
                const id = String(v).trim();
                if (!id || id === '0' || id === '-1') continue;
                out.push({ id: id, name: String(t === null || t === undefined ? '' : t) });
            }
            return { incoterms: out, error: null };
        } catch (e) {
            return { incoterms: [], error: (e.name || '') + ': ' + (e.message || String(e)) };
        }
    };

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
     * The same rate in the form the FIELD wants.
     *
     * 🔴 `custbody_mgsl_insurancerate` is `fieldvaluetype = Percent`, so
     * `setValue` takes the number a person would type into it -- 0.3 for 0.3%
     * -- and not the fraction that multiplies a price. Handing it the fraction
     * stored 0.003% of the price, which is 3.0E-5: a hundredth of the rate the
     * trader was quoted.
     *
     * Measured in the sandbox 2026-09-02: exactly 3 sales orders in the whole
     * account carry 3.0E-5 and they are the only three this endpoint has ever
     * created (SO-CWP-001344, 001345, 001346), against 3,987 at 0.003. Among
     * those 3,987 is SO-CWP-001329, an ARCH line that took its rate from the
     * form rather than from here -- so the correct value was sitting next to
     * the wrong one in the same account the whole time.
     *
     * The stamp exists so the margin the trader saw and the margin the order
     * records agree. Unscaled, it was putting them a hundredfold apart, in the
     * direction that understates cost and overstates profit.
     *
     * Only the WRITE is scaled. `insuranceRate()` stays the fraction, because
     * that is what prices the draft, what `archOrderPricing.ts` defaults to,
     * and what this endpoint hands back to the browser.
     */
    const insuranceRateStored = () => insuranceRate() * 100;

    /**
     * The customer's own negotiated ops+insurance rate, as a FRACTION, or null.
     *
     * 🔴 The body field is SOURCED FROM THE CUSTOMER, and this module used to
     * write straight over it. Measured in PRODUCTION 2026-09-03: of the 4,838
     * sales orders that have `createdby IS NOT NULL` and a customer carrying a
     * rate -- saved by a user or a script, so sourcing actually ran -- 4,836
     * store exactly their customer's `custentity_mgsl_insurancerate`, including
     * all 192 belonging to a customer at 0.015 and all 17 at 0.0015. Two differ,
     * both on Billed orders and neither from sourcing: SO-IND-246044 (id 22210)
     * carries a hand-typed 0.015 against a 0.003 customer, and SO-IND-246519 (id
     * 41736) was left blank. Only the first is an override; the second is the
     * empty-field case the append guard exists for. These counts drift, roughly
     * 40 new SOs a day; the invariant that carries the argument is that agreement
     * inside every rate cohort is total. `custbody_mgsl_insurancerate` is
     * also `<displayType>DISABLED</displayType>` on form 386, which is what a
     * field fed from somewhere else looks like.
     *
     * ⚠️ Do NOT cite the 0.015 cohort as proof, as an earlier draft of this
     * comment did. Those 173 sandbox orders all have `createdby IS NULL` --
     * migrated, never saved through any code path -- and sit on form 359 (172)
     * and 373 (1), none on ARCH's 386. They show what an import wrote, not what
     * sourcing does.
     *
     * Read through SuiteQL like everything else in this file, NOT through
     * `lookupFields`: both fields are `fieldvaluetype = Percent`, SuiteQL returns
     * a Percent as the stored FRACTION (0.003 for 0.3%), and that is the same
     * unit `insuranceRate()` speaks. `lookupFields` formats for display and would
     * hand back a string whose shape depends on account preferences.
     *
     * Returns null for "no rate" AND for "could not tell", which are the same
     * thing to the caller: fall back to configuration, exactly as before this
     * existed. 0 is NOT null -- a customer genuinely set to 0% keeps its 0.
     */
    const customerInsuranceRate = (customerId) => {
        const id = int(customerId);
        if (!id) return null;
        try {
            const rows = query.runSuiteQL({
                query: 'SELECT custentity_mgsl_insurancerate AS rate FROM customer WHERE id = ?',
                params: [id],
            }).asMappedResults();
            if (!rows.length) {
                /* Not "no rate" -- the ROW did not come back, and the two are
                 * indistinguishable to the caller. Worth one line because this
                 * deployment runs as customrole2184 (see <runasrole> in
                 * customscript_mcgi_sl_arch_order_create.xml) and this account has
                 * already produced a table that role cannot read: see
                 * custscript_arch_default_sales_rep, "the role cannot read the
                 * employee table", measured 2026-08-20. If that ever happens to
                 * `customer`, every order falls back to configuration and reports
                 * rateSource:'configuration', which looks entirely correct. */
                log.audit('ARCH Order Create',
                    'Customer ' + id + ' returned no row for its ops+insurance rate ' +
                    '(deleted, or not visible to this deployment role). Falling back ' +
                    'to configuration.');
                return null;
            }
            /* ⚠️ numOr, not num. `num` is the STRICT guard for REQUEST payloads:
             * its regex is /^-?\d+(\.\d+)?$/ and rejects exponent notation. This
             * is a Percent column, and this account formats a Percent below 0.001
             * in exponent form -- measured 2026-09-03, SO-CWP-001344/45/46 read
             * their own custbody_mgsl_insurancerate back as the string "3.0E-5".
             *
             * Changes nothing today: every customer rate in both environments is
             * 0.0015, 0.003, 0.015 or unset, and 0.0015 is above the threshold. It
             * stops a customer negotiated below 0.1% from silently reverting to the
             * configured rate. Every other SuiteQL number in this file already goes
             * through numOr for exactly this reason.
             *
             * ⛔ NO [0,1) BOUND HERE, deliberately. `insuranceRate()` bounds the
             * script PARAMETER because that value gets WRITTEN. This one never is:
             * when it is non-null the caller writes nothing and lets NetSuite
             * source the field. Nulling an out-of-range value would push the caller
             * into the configuration branch and stamp 0.3% over a negotiated rate,
             * which is the bug this function was added to remove. 0 stays 0. */
            return numOr(rows[0].rate, null);
        } catch (e) {
            // Never fail an order over a rate lookup. The fallback is the
            // behaviour this function replaced, so the worst case is the old one.
            log.audit('ARCH Order Create',
                'Could not read the ops+insurance rate on customer ' + id +
                ', falling back to configuration: ' +
                (e.name || '') + ': ' + (e.message || String(e)));
            return null;
        }
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

            /* The customer leg, which the old version ignored entirely.
             *
             * 🔴 READS THE SAME TWO COLUMNS AS `resolveSalesRep`, IN THE SAME
             * ORDER. This function exists only to explain why the resolver returned
             * nothing, so the moment the two disagree about where a rep comes from,
             * the refusal starts naming the wrong cause -- it would say
             * NO_CUSTOMER_REP about a customer that has one. They were already
             * split once (see the header on `diagnoseSalesRep`) and this is the
             * pair that has to move together.
             */
            const cust = query.runSuiteQL({
                query: 'SELECT custentity_mgsl_sales_rep AS mgslrep, salesrep ' +
                       'FROM customer WHERE id = ?',
                params: [customerId],
            }).asMappedResults();
            const custRep = cust.length
                ? (int(cust[0].mgslrep) || int(cust[0].salesrep)) : 0;
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

        /* ── Fall back to whoever covers the customer ─────────────────────
         *
         * 🔴 THIS LEG READ A FIELD THAT IS POPULATED ON ONE CUSTOMER IN THE
         * ACCOUNT, so it could never fire. Measured 2026-09-21 across all 1,127
         * customers:
         *
         *     custentity_mgsl_sales_rep   498
         *     salesrep                      1   <- the only one this used to read
         *
         * The single `salesrep` is Julie Munger on customer 1913. So for 1,126 of
         * 1,127 customers the customer leg returned null and the endpoint refused
         * with NO_CUSTOMER_REP, which reads as "this customer has no rep" when the
         * customer record plainly names one.
         *
         * Feedback 9 item 7 is Marc-Antoine asking exactly this: « Sales Rep :
         * possible de le populer à partir du champs suivant? custentity_mgsl_sales_rep
         * ou est-ce qu'on devrait utiliser salesrep ». The data answers it. On the
         * 321 active ARC customers, 264 carry the MGSL field and 0 carry `salesrep`.
         *
         * BOTH are read, MGSL field first, because the change has to be strictly
         * additive: customer 1913 keeps resolving off `salesrep`, and no case that
         * works today can stop working.
         *
         * ⚠️ WRAPPED, AND THAT IS NOT DECORATION. This function's only caller
         * does not catch (`const repId = namedTeam ? null : resolveSalesRep(...)`),
         * so an unknown-identifier error on a custom field would propagate out of
         * order creation as an exception instead of the refusal the caller is built
         * to report. `customer.custentity_mgsl_insurancerate` is already read
         * through N/query in this same file, so the shape is proven, but REST
         * SuiteQL and N/query are different dialects on this tenant and this field
         * has only been verified through the REST endpoint. Degrading to null is
         * exactly today's behaviour, so the wrap cannot make anything worse.
         *
         * ⚠️ AND THE REP IS NOT THE TEAM. Marc-Antoine, 2026-09-08: « le rep
         * permet d'identifier qui est le owner du SO. Le sales team définit le split
         * commission ». On ARC customers the two happen to name the same person
         * (263 agree, 0 disagree, measured), but they answer different questions and
         * must not be collapsed into one lookup.
         */
        const customerRep = (column) => {
            try {
                const rows = query.runSuiteQL({
                    query:
                        'SELECT c.' + column + ' AS repid FROM customer c ' +
                        'JOIN employee e ON e.id = c.' + column + ' ' +
                        "WHERE c.id = ? AND e.issalesrep = 'T' AND e.isinactive = 'F'",
                    params: [customerId],
                }).asMappedResults();
                return rows.length ? int(rows[0].repid) : null;
            } catch (e) {
                log.error('ARCH Order Create — customer sales rep unreadable',
                    'Column ' + column + ' could not be read, so the customer leg was ' +
                    'skipped and the request falls back to the refusal it would have ' +
                    'given before this field was consulted. ' +
                    (e.name || '') + ': ' + (e.message || String(e)));
                return null;
            }
        };

        return customerRep('custentity_mgsl_sales_rep') || customerRep('salesrep');
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
     * Hard cap on how many members one Sales Team may post onto an order.
     *
     * The largest real team in this account holds FOUR (measured 2026-09-08:
     * 9 teams of 1, 33 of 2, 1 of 3, 1 of 4), so this is a sanity ceiling and
     * not a business rule. It exists because every member is a sublist line on
     * a commission-bearing document and a malformed group should refuse rather
     * than write twenty of them.
     */
    const MAX_TEAM_MEMBERS = 20;

    /**
     * The Sales Team to post, expanded from a team the caller NAMED.
     *
     * ── 🔴 IT REFUSES INSTEAD OF COPING, AND THERE IS NO DEFAULT ─────────────
     * This writes COMMISSION ATTRIBUTION onto a real sales document. With no
     * `header.salesTeamId` the endpoint keeps posting exactly one line from
     * `resolveSalesRep`, byte for byte as before, so a caller can never get a
     * team it did not name. The reasoning that keeps
     * `custscript_arch_default_sales_rep` deliberately empty ("filling it in
     * attributes commission on real sales documents to somebody nobody chose")
     * applies with more force here, because a team names several people AND a
     * percentage each.
     *
     * ⚠️ AND MGSL HAVE BEEN TOLD IN WRITING THAT SELECTING A TEAM DOES NOT WRITE
     * YET: "Choisir une equipe ne l'ecrit pas encore sur le SO: ca attribue de la
     * commission sur un document reel, donc on attend ton feu vert avant de
     * brancher l'ecriture" (status note to Marc-Antoine, 2026-09-08,
     * docs todo-list). This function makes the ENDPOINT able to honour a team
     * when they say go; it is not a licence for the screen to start offering the
     * control before then.
     *
     * ── What the account actually holds, measured 2026-09-08 (sandbox) ───────
     *   44 active teams   `entitygroup`, issalesrep 'T', isinactive 'F'
     *   82 member rows    `entitygroupmember`, none inactive, no null contribution
     *   sizes             9 of 1, 33 of 2, 1 of 3, 1 of 4
     *   contributions     sum to EXACTLY 1 on all 44; values 0.25 to 1, and 14
     *                     teams are a 0.67/0.33 weighting rather than a 50/50
     *   isprimary 'T'     on 8 of the 82 rows, never twice in one team
     *
     * 🔴 SIX OF THE 44 HOLD A MEMBER WHO IS NOT FLAGGED SALES REP. Chris/Alec
     * (3307), Chris/Melissa (3300), Chris/Tom (3302), Leo/Chris (3301) and
     * Rettenmeier/James (3165) each carry Christopher Pajot (3268) or James
     * Bradley (3163) at `issalesrep = 'F'`, and "James Bradley" (3283) has no
     * other member at all. Those are refused here BY NAME, because a Sales Team
     * line for an employee who is not an active rep takes the whole save down
     * with an opaque `UNEXPECTED_ERROR` -- the same failure the integration user
     * (3136, `issalesrep = 'F'`) produced and that `resolveSalesRep` exists to
     * prevent. Note the flag is not a proxy for "never been on a sales team":
     * James Bradley sits on 33 saved `transactionsalesteam` rows, one of them on
     * ARCH's own form 386, so the flag was evidently ticked once and untucked
     * later. What the API accepts TODAY is what matters, and today he is 'F'.
     *
     * ── The SUM is the integrity check, and it replaces `g.size` ─────────────
     * All 8,665 transactions in this account that carry a sales team carry one
     * whose contributions sum to exactly 1 (10,170 rows, zero exceptions), and so
     * does every one of the 44 templates, with no member below 0.25. So a team
     * whose READABLE members do not sum to 1 is a team with a member missing --
     * most likely one this role cannot see -- and saying that is more useful than
     * comparing counts. `g.size` is deliberately NOT read: it would be a second
     * unproven identifier inside N/query for a strictly weaker check.
     *
     * ── ⚠️ THREE SMALL QUERIES, NOT ONE JOIN, AND THAT IS THE DIALECT TRAP ──
     * REST SuiteQL and N/query are different dialects. `entitygroup.grouptype`
     * filters cleanly through REST and is a missing RECORD JOIN inside N/query,
     * which is how the service's own team list failed live after passing every
     * shim assertion. A shim test cannot catch that class of defect, so the
     * unproven surface is kept to ONE identifier: `entitygroupmember."group"`.
     * `group` is a reserved word and the read is a hard 400 without the quotes.
     *
     * Everything else here is already proven inside N/query: `employee` by id
     * with `entityid`, `issalesrep` and `isinactive` is what `listSalesReps` and
     * `diagnoseSalesRep` run, and `entitygroup`'s own plain columns resolved even
     * in the failure above, whose error named the join and not the record.
     *
     * A query failure is reported VERBATIM rather than swallowed, because that
     * message is the only thing that will identify a dialect problem on the first
     * live call. It is a refusal, not a fallback: falling back to the requesting
     * user would credit the wrong person.
     */
    /**
     * 🔴 THE COMMISSION WRITE IS OFF UNTIL MGSL SAY OTHERWISE, AND THIS IS THE LATCH.
     *
     * Writing a multi-member sales team ATTRIBUTES COMMISSION ON A REAL SALES DOCUMENT.
     * Marc-Antoine asked for the teams to be fed from Setup > Sales Teams and we have
     * told him in writing, twice, that we would not write one until he says go. The
     * read side (the picker, the `salesTeams` action) is deliberately live so he can
     * see the right data; the WRITE has to stay inert until asked for.
     *
     * The screen already refuses to send `header.salesTeamId` unless its own switch is
     * on, but the screen is not the only thing that can POST here. This is the
     * server-side half, and it is deliberately the SAME shape as the PDF email switch:
     * an unset parameter reads null, `param()` swallows a parameter that is not even
     * deployed, and both cases mean OFF. So the failure mode of shipping this file, or
     * this whole tree, is "no team is written", never "commission was attributed
     * because two halves happened to deploy on the same day".
     *
     * ⚠️ DO NOT tick this box to make a test pass. Turning it on starts writing
     * commission to real orders, and `custscript_arch_default_sales_rep` exists,
     * empty, for exactly this reason: a refusal is recoverable, a wrong attribution
     * on somebody's paycheque is not.
     */
    const SALES_TEAM_WRITE_PARAM = 'custscript_arch_salesteam_write_on';
    const salesTeamWriteEnabled = () => {
        try {
            const raw = param(SALES_TEAM_WRITE_PARAM);
            return raw === true || String(raw || '').trim().toUpperCase() === 'T';
        } catch (e) {
            // A parameter that is not on the deployed script object can throw rather
            // than read null. That is still OFF.
            return false;
        }
    };

    const resolveSalesTeam = (requestedId, suppliedMembers, suppliedName) => {
        if (!salesTeamWriteEnabled()) {
            // Not a refusal: a refusal would fail the whole order, and the order is
            // fine. The caller asked for something this deployment is not authorised
            // to do, so it is ignored and SAID SO in the response and the log.
            log.audit('ARCH Order Create — sales team NOT written (switch off)',
                'A team (' + String(requestedId) + ') was requested but ' +
                SALES_TEAM_WRITE_PARAM + ' is not enabled, so no commission was ' +
                'attributed and the order keeps the single rep. This is the default and ' +
                'it stays until MGSL ask for the team write to be turned on.');
            return null;
        }
        const teamId = int(requestedId);
        if (!teamId) {
            throw refusal('"' + String(requestedId) + '" is not a NetSuite internal id for a ' +
                          'sales team, so no team was written. Pick one from the Sales team ' +
                          'list on the order.');
        }

        const read = (label, sql, params) => {
            try {
                return query.runSuiteQL(
                    params ? { query: sql, params: params } : { query: sql }
                ).asMappedResults();
            } catch (e) {
                const msg = (e.name || '') + ': ' + (e.message || String(e));
                log.error('ARCH Order Create — sales team read failed (' + label + ')',
                    msg + ' | query: ' + sql +
                    ' | FIRST THING TO SUSPECT: this runs inside N/query, not the REST query ' +
                    'endpoint, and the two are different dialects. The member read quotes ' +
                    '"group" because it is a reserved word, and that exact statement has never ' +
                    'run through N/query before this feature shipped. The service\'s own team ' +
                    'list failed live on `entitygroup.grouptype` for the same class of reason ' +
                    'after passing every shim assertion. SECOND: the executing role, since ' +
                    'every read here is scoped to this deployment\'s runasrole.');
                throw refusal('The sales team could not be read from NetSuite (' + label + '), ' +
                              'so nothing was written and no commission was attributed. ' +
                              'NetSuite said: ' + msg);
            }
        };

        /* ── THE TEAM COMES FROM THE CALLER, NOT FROM `entitygroup` ───────────
         *
         * 🔴 REWRITTEN 2026-09-14, because the two reads this replaces CANNOT RUN
         * on this deployment. Measured live, four times:
         *
         *   SSS_SEARCH_ERROR_OCCURRED: Search error occurred:
         *   Record 'entitygroup' was not found.
         *
         * This Suitelet executes as `runasrole` customrole2184, an ACCOUNTCENTER
         * role, and `entitygroup` is not reachable from it. Granting that role
         * LIST_CRMGROUP (View) changed nothing: the error was byte-identical
         * before and after, ten minutes later. It is not a permission level, it is
         * the record not being exposed to that context.
         *
         * ⚠️ AND THE OBVIOUS FIXES ARE BOTH WRONG:
         *   - Changing `runasrole` breaks lot attachment on EVERY order, silently.
         *     2184 is chosen because the SO form comes from the executing role's
         *     preference and only the ARCH/MTL forms have INVENTORYDETAIL visible.
         *     See "DO NOT FIX THE runasrole ON DEPLOYMENT 6505" in the todo-list.
         *   - Widening an accounting role's CRM access so a sales feature can
         *     write is the wrong direction, and it did not work anyway.
         *
         * ── WHY LOSING THE GROUP READ COSTS ALMOST NOTHING ───────────────────
         * The group read answered three questions: who the members are, what each
         * one's share is, and whether the team is real. The caller already holds
         * the first two — the screen gets them from `action=salesTeams` on the
         * RESTlet, which runs under the CALLER's role and works. And the third was
         * never what protected the money: what protects it is the employee
         * validation immediately below, which reads `employee` (this role reads it
         * fine, 20 sales reps came back on this same deployment) and which is the
         * SAME check NetSuite itself applies when it accepts a Sales Team line.
         *
         * ⚠️ WHAT IS GENUINELY GIVEN UP, stated plainly: a hand-crafted POST can
         * send a member list matching no real team. Today this endpoint admits
         * only roles 3 and 2181, so such a caller is already an administrator or
         * the trader whose own commission it is. If that stops being acceptable,
         * the group read moves to a sales-centre deployment and this becomes a
         * second line of defence rather than the only one. It is NOT a reason to
         * trust the numbers: every share is still re-validated below.
         */
        const teamName = String(suppliedName || '').trim() || ('Team ' + teamId);
        const supplied = Array.isArray(suppliedMembers) ? suppliedMembers : null;
        if (!supplied) {
            throw refusal('Sales team "' + teamName + '" was named without its members, so ' +
                          'there is nothing to credit and nothing was written. The screen sends ' +
                          'the members alongside the team id; a caller that sends only the id ' +
                          'is using an older shape than this endpoint accepts.');
        }

        /* Shaped to match what the `entitygroupmember` read used to return, so
         * everything below this point is unchanged: the duplicate check, the
         * member cap, the share checks, the employee validation and the percent
         * conversion all run exactly as they did. */
        const rows = supplied.map((m) => ({
            repid:        m && (m.id !== undefined ? m.id : m.repid),
            repname:      m && (m.name !== undefined ? m.name : m.repname),
            /* The FRACTION, matching what SuiteQL returned. The client carries
             * both (`contribution` 0.5 and `contributionPct` 50) and sending the
             * wrong one would put a 50x error into a commission split, so the
             * percent form is refused outright rather than guessed at. */
            contribution: m && (m.contribution !== undefined ? m.contribution : NaN),
        }));

        const looksLikePercent = rows.filter((r) => numOr(r.contribution, 0) > 1);
        if (looksLikePercent.length) {
            throw refusal('Sales team "' + teamName + '" was sent with shares above 1 (' +
                          looksLikePercent.map((r) => String(r.contribution)).join(', ') +
                          '), which is the percent form. This endpoint takes the fraction, so ' +
                          '50% is 0.5. Nothing was written.');
        }

        /* One person twice in a group would post two sublist lines crediting
         * them, and `verifySalesTeam` compares by employee id so it would read
         * back as correct. It is refused by NAME rather than deduplicated: two
         * rows at 0.5 each mean the group intends that person 100%, and quietly
         * keeping one of them would credit them 50% instead. Neither guess is
         * ours to make. No team in this account has one today. */
        const members = [];
        const seen = {};
        const doubled = [];
        rows.forEach((r) => {
            const id = int(r.repid);
            if (!id) return;
            const name = String(r.repname || '').trim() || ('employee ' + id);
            if (seen[String(id)]) {
                /* The name of the row already ACCEPTED, not this one's. Two rows
                 * for one person can carry different member names and reporting
                 * the second would name somebody who is not in the team list. */
                const first = seen[String(id)];
                if (doubled.indexOf(first) === -1) doubled.push(first);
                return;
            }
            seen[String(id)] = name;
            members.push({
                id: id,
                name: name,
                fraction: numOr(r.contribution, NaN),
            });
        });
        if (doubled.length) {
            throw refusal('Sales team "' + teamName + '" lists ' + doubled.join(', ') +
                          ' more than once, so their share of the commission is ambiguous ' +
                          'and nothing was written. Fix the team under Setup > Sales Team.');
        }
        /* Sorted, so "the last member absorbs the rounding remainder" below is
         * deterministic rather than dependent on the order the engine returns. */
        members.sort((a, b) => a.id - b.id);

        if (!members.length) {
            /* Two different faults, one symptom, and naming the wrong one sends
             * whoever debugs it at role scope when the caller simply sent nothing.
             * This endpoint stopped reading the group on 2026-09-14, so "no members
             * this endpoint can read" is no longer a thing it can truthfully say:
             * it reads no members at all, it is handed them. */
            throw refusal(supplied.length
                ? 'Sales team "' + teamName + '" was sent ' + supplied.length + ' member row(s), ' +
                  'not one of which carries a usable employee id, so there is nobody to credit ' +
                  'and nothing was written.'
                : 'Sales team "' + teamName + '" was sent with an EMPTY member list, so there is ' +
                  'nobody to credit and nothing was written. The members come from the screen ' +
                  'rather than from NetSuite, so this is the caller sending none rather than a ' +
                  'team this endpoint cannot see.');
        }
        if (members.length > MAX_TEAM_MEMBERS) {
            throw refusal('Sales team "' + teamName + '" has ' + members.length + ' members. ' +
                          'The largest team in this account has four, so this looks wrong and ' +
                          'nothing was written.');
        }

        const unusableShare = members.filter((m) => !isFinite(m.fraction) || m.fraction <= 0);
        if (unusableShare.length) {
            throw refusal('Sales team "' + teamName + '" gives no usable percentage to ' +
                          unusableShare.map((m) => m.name).join(', ') +
                          ', so the split cannot be recorded and nothing was written.');
        }

        const total = members.reduce((s, m) => s + m.fraction, 0);
        if (Math.abs(total - 1) > 1e-6) {
            throw refusal('Sales team "' + teamName + '" adds up to ' +
                          (Math.round(total * 10000) / 100) + '% across the ' + members.length +
                          ' member(s) this endpoint can read, not 100%. Every one of the 44 ' +
                          'teams in this account totals 100%, so a member is missing rather ' +
                          'than the team being wrong, most likely one outside the subsidiaries ' +
                          'this endpoint can read. Nothing was written.');
        }

        /* The employee records, read as FLAGS rather than filtered on, so the
         * refusal can say which of the three things is wrong about which person.
         * `resolveSalesRep` filters instead and its refusal needed a whole second
         * function (`diagnoseSalesRep`) to recover the same information. */
        const emps = read('members’ employee records',
            'SELECT id, entityid, issalesrep, isinactive FROM employee ' +
            'WHERE id IN (' + members.map((m) => m.id).join(',') + ')');
        const byId = {};
        emps.forEach((r) => { byId[String(int(r.id))] = r; });

        const problems = [];
        members.forEach((m) => {
            const e = byId[String(m.id)];
            if (e && e.entityid) m.name = String(e.entityid);
            if (!e) {
                problems.push(m.name + ' is outside the subsidiaries this endpoint can write for');
            } else if (String(e.issalesrep) !== 'T') {
                problems.push(m.name + ' is not flagged Sales Rep on their employee record');
            } else if (String(e.isinactive) === 'T') {
                problems.push(m.name + ' is inactive');
            }
        });
        if (problems.length) {
            throw refusal('Sales team "' + teamName + '" cannot be written: ' +
                          problems.join('; ') + '. NetSuite refuses the WHOLE order when a ' +
                          'Sales Team line names somebody who is not an active sales rep, so ' +
                          'no part of this team was written and no commission was attributed. ' +
                          'Either have Sales Rep ticked on that employee record, or pick a ' +
                          'team whose members all have it.');
        }

        /* ── The Percent trap, and why the LAST member absorbs the remainder ──
         *
         * 🔴 SuiteQL returns a Percent as the stored FRACTION (0.5) while
         * `setValue` takes the number a person would type (50). That has already
         * cost this project a real bug on `custbody_mgsl_insurancerate`, where
         * the fraction went in and stored a hundredth of the intended rate on
         * three real orders. Same trap, same fix: multiply once, here.
         *
         * ── And the last member takes the remainder, which is a GUARANTEE ────
         * Every member but the last is rounded to four decimals and the last
         * takes 100 minus the rest, so the percentages always total exactly 100.
         *
         * ⚠️ BE HONEST ABOUT WHY: on TODAY's data this is a no-op, and claiming
         * otherwise would be the sort of confident wrong note this file has had
         * to correct before. The account stores at most five decimals on the
         * fraction, the widest case being one real 0.33333/0.33333/0.33334 team,
         * and rounding those naively already comes to exactly 100. Checked by
         * brute force over every five-decimal two- and three-way split with no
         * member below 5%: not one of them loses a hundredth.
         *
         * It is here for the case that WOULD lose one. A fraction with more than
         * six decimals rounds short three times over: a true one third at
         * 0.3333333333 gives 33.3333 + 33.3333 + 33.3333 = 99.9999, and Team
         * Selling wants 100. The remainder rule turns that into
         * 33.3333/33.3333/33.3334 and cannot drift whatever precision NetSuite
         * hands back, which is worth having when the alternative is an opaque
         * save failure on a commission document. It also reproduces the stored
         * 33.333/33.333/33.334 on the team that does exist, so nothing about
         * today's behaviour changes.
         */
        let running = 0;
        members.forEach((m, i) => {
            if (i < members.length - 1) {
                m.pct = Math.round(m.fraction * 1000000) / 10000;
                running += m.pct;
            } else {
                m.pct = Math.round((100 - running) * 10000) / 10000;
            }
        });

        return {
            teamId: teamId,
            teamName: teamName,
            members: members,
            memberCount: members.length,
        };
    };

    /**
     * Which fields the Sales Team sublist actually exposes on THIS record.
     *
     * Same question, and the same reasoning, as `remanFieldsPresent`: the record
     * is the thing that will accept or refuse the write, so ask it rather than
     * keep a flag somewhere. Not memoised, for the reason those two give.
     *
     * ⚠️ The answer differs by PATH. A new record takes the form the executing
     * role prefers; an append inherits the form stored on the order it is adding
     * to. So this is probed per order rather than once.
     */
    const salesTeamSublistFields = (so) => {
        try {
            return so.getSublistFields({ sublistId: 'salesteam' }) || [];
        } catch (e) {
            log.audit('ARCH Order Create',
                'The sales team sublist could not be inspected on this record: ' +
                (e.name || '') + ': ' + (e.message || String(e)));
            return [];
        }
    };

    /**
     * Posts the named team onto the order, replacing whatever is there.
     *
     * ── Nothing is committed until `save()`, which is what makes this safe ──
     * The lines are removed and rebuilt on the IN-MEMORY record, so a refusal
     * part-way through leaves the order in NetSuite exactly as it was. That is
     * why every check in here can throw rather than having to unwind.
     *
     * ── What is set, and what is deliberately NOT ───────────────────────────
     *   employee       always. The only field the six orders this endpoint has
     *                  already created ever set, and all six saved.
     *   contribution   ONLY when the team has more than one member. With a
     *                  single line NetSuite fills in 1 (100%) itself -- proven
     *                  on those same six orders, which all read back
     *                  contribution 1 and salesrole -2 without either being
     *                  passed -- so a one-member team keeps the byte-for-byte
     *                  proven path and nothing unproven is written. With two or
     *                  more it MUST be set: 14 of the 44 teams are a 0.67/0.33
     *                  weighting and one is 0.7/0.3, so letting NetSuite guess
     *                  would silently misattribute commission on exactly the
     *                  teams whose split is the point.
     *   salesrole      NEVER. -2 is what every stored row holds, but setting it
     *                  turned a clear USER_ERROR into an opaque UNEXPECTED_ERROR
     *                  at save. NetSuite fills it in itself.
     *   isprimary      NEVER, and this is a decision rather than an omission.
     *                  8 of the 82 template member rows carry it, but 8,611 of
     *                  the 8,665 transactions in this account that have a sales
     *                  team have NO primary at all and only 54 have one, so not
     *                  setting it is the overwhelming majority behaviour. It
     *                  carries no money either: `contribution` is what splits
     *                  the commission. So it is one more unproven write on a
     *                  commission-bearing document for no benefit, and the
     *                  `salesrole` precedent is that a value read out of a saved
     *                  record is not necessarily a value the API accepts.
     *
     * 🔴 `contribution` HAS NOT BEEN PROVEN AT SAVE TIME, and it cannot be from
     * here: proving it means creating a real sales order. So the write is guarded
     * two ways instead. `getSublistFields` must list the field, and a
     * multi-member team is REFUSED when it does not rather than posted without
     * its split -- the opposite of `splitFieldsPresent`, which skips the write
     * and saves the order, because a missing split marker loses a note while a
     * missing contribution misattributes money. And `verifySalesTeam` re-reads
     * what NetSuite actually stored after the save.
     */
    const writeSalesTeam = (so, team) => {
        const fields = salesTeamSublistFields(so);
        const canSetContribution = fields.indexOf('contribution') !== -1;
        const needsContribution = team.members.length > 1;

        if (needsContribution && !canSetContribution) {
            throw refusal('Sales team "' + team.teamName + '" splits commission between ' +
                          team.members.length + ' people, and the Sales Team sublist on this ' +
                          'order does not expose a contribution field, so the split cannot be ' +
                          'recorded. Nothing was written: posting the members without their ' +
                          'percentages would let NetSuite invent the split.');
        }

        /* What the order carried before, for the audit line and the response. An
         * append can legitimately be replacing a real team, and "replaced X with
         * Y" is the only record of that anybody will have. */
        const previous = [];
        let count = 0;
        try {
            count = so.getLineCount({ sublistId: 'salesteam' });
        } catch (e) {
            count = 0;
        }
        if (!(count > 0)) count = 0;
        /* Reading and clearing are one try/catch on purpose. If either fails
         * part-way the record is left half-cleared, and the right answer is to
         * abandon the request rather than save it: nothing is committed until
         * `save()`, so a refusal here leaves the order in NetSuite untouched.
         * Note `count` is 0 on a new order in standard mode -- measured on the
         * six orders this endpoint has created, each of which carries exactly
         * one member and none of which inherited a customer default. */
        try {
            for (let i = 0; i < count; i++) {
                previous.push(String(so.getSublistValue({
                    sublistId: 'salesteam', fieldId: 'employee', line: i,
                })));
            }
            // Backwards, so removing a line cannot renumber one still to be removed.
            for (let i = count - 1; i >= 0; i--) {
                so.removeLine({ sublistId: 'salesteam', line: i });
            }
        } catch (e) {
            const msg = (e.name || '') + ': ' + (e.message || String(e));
            log.error('ARCH Order Create — sales team could not be cleared',
                'Read ' + previous.length + ' of ' + count + ' existing line(s) before failing: ' +
                msg);
            throw refusal('The Sales Team already on this order could not be replaced, so ' +
                          'nothing was written and no commission was reattributed. NetSuite ' +
                          'said: ' + msg);
        }

        team.members.forEach((m, i) => {
            so.setSublistValue({
                sublistId: 'salesteam', fieldId: 'employee', line: i, value: m.id,
            });
            if (needsContribution) {
                so.setSublistValue({
                    sublistId: 'salesteam', fieldId: 'contribution', line: i, value: m.pct,
                });
            }
        });

        return {
            previousEmployees: previous,
            contributionWritten: needsContribution,
        };
    };

    /**
     * What the SAVED order's Sales Team actually holds, compared with what was
     * asked for.
     *
     * The `verifyAssignments` pattern: re-read rather than trust, because this is
     * the only automated check that would notice NetSuite reinterpreting a
     * contribution. Reports, never throws -- the order exists by the time this
     * runs, so a failure here is a diagnostic and not an outcome.
     *
     * ⚠️ `verified: false` means COULD NOT TELL, not "wrong". This deployment
     * runs as `customrole2184` and whether that role can read
     * `transactionsalesteam` is not established; the ARCH trader role 2181
     * demonstrably cannot in some contexts, which is a documented cause of the
     * open-orders tab falling back to "Unassigned". An unreadable sublist must
     * not be reported as a mismatch.
     *
     * 🔴 The comparison is in FRACTIONS. SuiteQL hands a Percent back as the
     * stored fraction while the write took the typed number, so 50 goes in and
     * 0.5 comes out. Tolerance is 5e-5, i.e. half of the smallest difference the
     * account actually stores (0.33333 against 0.33334).
     */
    const verifySalesTeam = (soId, team) => {
        let rows;
        try {
            rows = query.runSuiteQL({
                query: 'SELECT employee, contribution FROM transactionsalesteam ' +
                       'WHERE transaction = ?',
                params: [soId],
            }).asMappedResults();
        } catch (e) {
            log.audit('ARCH Order Create',
                'The sales team on SO ' + soId + ' could not be read back, so the team that ' +
                'was written is unverified: ' + (e.name || '') + ': ' + (e.message || String(e)));
            return { verified: false, mismatches: [], stored: [] };
        }

        const stored = {};
        rows.forEach((r) => {
            const id = int(r.employee);
            if (!id) return;
            stored[String(id)] = numOr(r.contribution, NaN);
        });

        const mismatches = [];
        team.members.forEach((m) => {
            const got = stored[String(m.id)];
            if (got === undefined) {
                mismatches.push(m.name + ' is not on the saved order');
                return;
            }
            const want = m.pct / 100;
            if (!isFinite(got) || Math.abs(got - want) > 5e-5) {
                mismatches.push(m.name + ' stored ' + got + ' where ' + want + ' was intended');
            }
        });
        Object.keys(stored).forEach((k) => {
            if (!team.members.some((m) => String(m.id) === k)) {
                mismatches.push('employee ' + k + ' is credited on the saved order but is not ' +
                                'in team "' + team.teamName + '"');
            }
        });

        return {
            verified: true,
            mismatches: mismatches,
            stored: Object.keys(stored).map((k) => k + '=' + stored[k]),
        };
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

    const F_READY_TO_BUILD = 'custbody_arch_ready_to_build';

    /**
     * Ticks or unticks Ready to Build on an EXISTING, already-saved sales
     * order. This is the ENTIRE point of the call — unlike `remanStored` /
     * `splitStored` on order creation, where the order itself is the real
     * outcome and a missing side field is a partial success, there is no
     * partial success here: if the field cannot be set, nothing this call was
     * asked to do happened, so it REFUSES rather than returning a quiet no-op.
     *
     * Loaded and saved standard-mode, matching `assignLots`: a narrow,
     * single-field update to a record that already exists, not the
     * order-creation path. `enableSourcing: false` for the same reason
     * `assignLots` uses it — this call has no business re-deriving anything
     * else on the order — and `ignoreMandatoryFields: true` so a save is not
     * blocked by an unrelated mandatory field on an old order this endpoint
     * did not create.
     *
     * Reverting (`value: false`) is the SAME call with the opposite value,
     * deliberately: this is a plain checkbox, not a one-way workflow status,
     * which is also the answer to Marc-Antoine's 2026-08-14 question of
     * whether an order can go back from Ready to Build to Reserved.
     */
    /**
     * Is this sales order in scope for the ARCH screen?
     *
     * 🔴 ADDED 2026-09-14. `setReadyToBuild` accepted ANY sales order id, in a
     * module whose order-creation path refuses a non-ARCH item line by line
     * (see the HARDWOOD_DEPARTMENT check in `validateLines`). So the one call
     * that writes to an order it did not create was the least guarded one in
     * the file, and a mistyped or stale id could flip a flag on an Industriel
     * or MTL order that no ARCH screen will ever show again.
     *
     * The test is the SAME one every other ARCH module uses, and it is BY NAME:
     * department "Hardwood", minus the decking exclusions. Never the internal
     * id — 11 does not exist in production at all, measured 2026-09-10, which is
     * why `HARDWOOD_DEPARTMENT` is a string.
     *
     * Returns `{ known, hardwoodLines, totalLines, sample }`. `known: false`
     * means the question could not be answered, which the caller treats
     * differently from an answered "no": a read failure must not silently
     * become a refusal that looks like a business rule.
     *
     * ⚠️ ONE LINE IS ENOUGH, and that is a decision nobody has put to the
     * client. A mixed order carrying one hardwood line and four softwood lines
     * passes this guard. The permissive reading is chosen because the whole-order
     * flag is what the warehouse consumes and a part-ARCH order still has ARCH
     * wood to build; the strict reading (every line hardwood) would refuse an
     * order the trader can legitimately see on the screen. Worth one line of
     * confirmation from Marc-Antoine, and it changes one comparison here.
     *
     * ⚠️ IN PRODUCTION THIS CURRENTLY REFUSES EVERYTHING. Measured 2026-09-13:
     * prod has exactly one Trading department row, id 9, with no Hardwood child,
     * so `BUILTIN.DF(i.department) = 'Hardwood'` matches zero items there. That
     * is correct behaviour for an ARCH endpoint on an account with no ARCH data,
     * but it must not be mistaken for a bug when prod cutover starts. The
     * refusal text below names the department so the cause is readable.
     */
    const readOrderArchScope = (soId) => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT BUILTIN.DF(i.department) AS dept, ' +
                    // Same reason as `readLotStates`: the union needs both arms.
                    '       BUILTIN.DF(i.subsidiary) AS sub, i.itemid AS itemcode ' +
                    'FROM transactionline tl ' +
                    '  JOIN item i ON i.id = tl.item ' +
                    "WHERE tl.transaction = ? AND tl.mainline = 'F'",
                params: [int(soId)],
            }).asMappedResults() || [];

            let hardwood = 0;
            let sample = null;
            for (let i = 0; i < rows.length; i++) {
                const dept = String(rows[i].dept || '').trim();
                const code = String(rows[i].itemcode || '').trim();
                if (inArchScope(dept, rows[i].sub, code)) {
                    hardwood++;
                } else if (!sample) {
                    sample = code || '(unnamed item)';
                }
            }
            return { known: true, hardwoodLines: hardwood, totalLines: rows.length, sample: sample };
        } catch (e) {
            // Deliberately NOT a refusal. The caller decides, and it logs, because
            // "we could not check" and "this is not an ARCH order" are different
            // facts and collapsing them is how a query outage starts reading as a
            // business rule.
            log.error('ARCH Order Create — ARCH scope check failed',
                'SO ' + soId + ': ' + (e.name || '') + ': ' + (e.message || String(e)));
            return { known: false, hardwoodLines: 0, totalLines: 0, sample: null };
        }
    };

    const setReadyToBuild = (soId, value) => {
        const id = int(soId);
        if (!id) throw refusal('No sales order id was given, so nothing was changed.');

        /* Scope BEFORE load, so a non-ARCH order is refused without this endpoint
           ever opening it, and the refusal names the reason rather than surfacing
           whatever NetSuite says about the record. */
        const scope = readOrderArchScope(id);
        if (!scope.known) {
            throw refusal('Ready to Build was not changed on sales order ' + id +
                          ': its lines could not be read, so whether this is an ARCH ' +
                          'hardwood order is unknown. Nothing was changed. This is a ' +
                          'read failure, not a rule about the order.');
        }
        if (!scope.totalLines) {
            throw refusal('Sales order ' + id + ' has no lines, so there is nothing to ' +
                          'build and Ready to Build was not changed.');
        }
        if (!scope.hardwoodLines) {
            throw refusal('Sales order ' + id + ' carries no ' + HARDWOOD_DEPARTMENT +
                          ' line' + (scope.sample ? ' (for example ' + scope.sample + ')' : '') +
                          ', so it is not an ARCH order and Ready to Build was not changed.');
        }

        let so;
        try {
            so = record.load({ type: record.Type.SALES_ORDER, id: id, isDynamic: false });
        } catch (e) {
            throw refusal('Sales order ' + id + ' could not be loaded, so Ready to Build was ' +
                          'not changed: ' + (e.name || '') + ': ' + (e.message || String(e)));
        }

        const present = setIfPresent(so, F_READY_TO_BUILD, !!value, 'Ready to Build');
        if (!present) {
            throw refusal('Ready to Build is not available on this account yet: the field ' +
                          'has not been created in NetSuite. Nothing was changed.');
        }

        try {
            so.save({ enableSourcing: false, ignoreMandatoryFields: true });
        } catch (e) {
            const message = (e.name || '') + ': ' + (e.message || String(e));
            log.error('ARCH Order Create — setReadyToBuild failed to save',
                'SO ' + id + ': ' + message);
            // FAILED, not REFUSED: setValue succeeded on the in-memory record
            // and only the save threw, so whether NetSuite kept a partial
            // write is genuinely unknown — the same distinction createOrder's
            // ARCH_ORDER_REFUSED/plain-throw split exists to preserve.
            throw new Error('Ready to Build could not be saved on SO ' + id + ': ' + message);
        }

        return { soId: id, readyToBuild: !!value };
    };

    /**
     * What the SAVED order's Ready to Build flag actually holds, the same
     * trust-but-verify shape as `verifySalesTeam`: `setValue` + `save` not
     * throwing is not proof NetSuite kept the value, only that nothing
     * objected.
     */
    const verifyReadyToBuild = (soId, expected) => {
        let rows;
        try {
            rows = query.runSuiteQL({
                query: 'SELECT ' + F_READY_TO_BUILD + ' AS flag FROM transaction WHERE id = ?',
                params: [int(soId)],
            }).asMappedResults();
        } catch (e) {
            log.audit('ARCH Order Create',
                'Ready to Build on SO ' + soId + ' could not be read back, so the value that ' +
                'was written is unverified: ' + (e.name || '') + ': ' + (e.message || String(e)));
            return { verified: false, matches: false };
        }
        if (!rows.length) return { verified: false, matches: false };
        const stored = rows[0].flag === 'T';
        return { verified: true, matches: stored === !!expected };
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
    const applyIncoterms = (rec, h, creating) => {
        /* An explicit ID wins over the display text, and the wizard now sends one.
         * `setText` has to match a list label exactly, and a label the screen
         * invented is how "Customer Pick Up" reached NetSuite and was rejected. The
         * text path stays as a fallback so an older bundle against this script
         * keeps working. */
        const id = int(h && (h.incotermsId || h.incoterms));
        if (id) {
            rec.setValue({ fieldId: H_INCOTERMS, value: id });
        } else if (h && h.incoterms) {
            rec.setText({ fieldId: H_INCOTERMS, text: String(h.incoterms) });
        } else if (creating) {
            /* Only on a NEW order. The field is mandatory on form 386, so a create
             * that names none still has to carry something, and the configured
             * default is the honest choice there. */
            rec.setValue({ fieldId: H_INCOTERMS, value: incotermsDefault() });
        }
        /* 🔴 AN APPEND THAT NAMES NO INCOTERMS NOW LEAVES THEM ALONE.
         *
         * MEASURED 2026-09-14 on SO-CWP-001371. It was created with FOB Mill (4).
         * A later append that said nothing about incoterms fell into the old
         * unconditional `else`, wrote `incotermsDefault()`, and the order silently
         * became Delivered (3). Nobody asked for that: adding a bundle to an order
         * is not a statement about its shipping terms, the trader is not shown the
         * field on an append, and the change is invisible until somebody reads the
         * order back.
         *
         * Same defect as the Created By / Sales Rep item, and the same rule
         * settles it: an append changes what the caller ASKED to change and
         * nothing else. The mandatory-field argument does not carry over, because
         * an existing order already holds a value. */
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
                '  BUILTIN.DF(i.department) AS department, ' +
                // Feedback 7's subsidiary arm. Without this column the union in
                // `inArchScope` cannot be evaluated and every ARC lot is refused.
                '  BUILTIN.DF(i.subsidiary) AS subsidiary, ' +
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
                department: String(r.department || ''),
                // Feedback 7's subsidiary arm. Selected AND mapped: selecting the
                // column without carrying it here would leave `inArchScope` reading
                // undefined and every ARC lot refused, exactly as before the fix.
                subsidiary: String(r.subsidiary || ''),
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
    /* 🔴 NON-INVENTORY CHARGE LINES (Feedback 9 item 10) ══════════════
     *
     * Marc-Antoine, 2026-09-17, and he re-sent this line on its own at 10:18 so
     * it is the one he most wants moved: « Permet d'ajouter une ligne à la
     * création du SO avec des non-inventory items (freight, milling charges,
     * etc.). Dans la section 2 (items) ».
     *
     * 🔴 A SEPARATE CHANNEL, NOT A RELAXATION OF `resolveLines`. That function
     * refuses any line without a lot and a location, and it is right to: every
     * guard behind it -- the oversell check, active holds, unattributed
     * commitments, the `claimed` accumulator that stops two lines jointly
     * overselling one bundle -- keys off the lot. Making those conditional so a
     * freight line could pass would put the bundle-level protections one bad
     * request away from being skipped. A charge has no lot by nature, so it gets
     * its own resolver and its own validation, and the lot path is untouched.
     *
     * ⚠️ AN ALLOWLIST, BY INTERNAL ID, AND DELIBERATELY SHORT. The account has 31
     * active non-inventory items and they are not all sellable: `Temp Migration
     * AP`, `Temp Migration AR`, `Credit Memo Customer`, `Prepaids`, `Duty` and
     * `Export Tax` are accounting artifacts that must never reach a
     * customer-facing sales order. Offering the whole table with a search box
     * would put them one keystroke away.
     *
     * These four are the freight-shaped ones. `Freight/Transport` is the only one
     * with proven ARC usage -- 6 ARC sales orders and 2 invoices, all created by
     * hand by Marc-Antoine and Mohamed Chraiet -- which is also the evidence that
     * a parent-subsidiary (MGSL) item is accepted on an ARC order at all. None of
     * the 31 is mapped to ARC itself, so that mattered.
     *
     * ✅ MILLING IS NOW OFFERED, AND THE OBJECTION THAT KEPT IT OUT WAS WRONG.
     *
     * This block used to argue that a `Milling Charges` line would be a second,
     * competing representation of the $0.20/BF the Remanufacturing step already
     * prices, so a trader could charge the customer twice. That was asked of
     * Marc-Antoine rather than guessed, which was right, and he answered it on
     * the 2026-09-21 call at [10:04]:
     *
     *   "milling charges, ca c'est l'ecran du remand donc j'ai un cout interne,
     *    mon service cost, ca il est calcule automatiquement, ca ca marche, mais
     *    parfois on va charger notre client aussi dans un frais comme le frais de
     *    transport, ca fait qu'on va rajouter une ligne sur le SO"
     *
     * **They are two different numbers.** The $0.20/BF is the INTERNAL cost and
     * it is automatic. The milling charge is a SEPARATE, optional, customer-facing
     * amount a trader types in. Nothing is billed twice, because nothing was ever
     * the same money.
     *
     * 🔴 AND THE ACCOUNT ALREADY SPLITS IT THAT WAY, which is the evidence the
     * old objection lacked. Measured 2026-09-21:
     *
     *   3330  Milling Charges : Cut       5 lines, ALL on PurchOrd
     *   3331  Milling Charges : Planing   5 lines, ALL on PurchOrd
     *   3540  Milling Charges             0 lines, never used
     *
     * The Cut and Planing items live on the internal reman POs -- `SO-CWP-001375-M`
     * carries Cut at 148.40 and Planing at 148.40, which is 742 BF x $0.20 twice.
     * So the cost side is already two items on a PO, and 3540 has been sitting
     * unused because the customer-facing line it was made for did not exist yet.
     * That is why this offers 3540 and NOT 3330/3331: putting the cost-side items
     * on a sales order would mix the two sides of the same job.
     *
     * ⚠️ ONE LINE, THE COLUMN TOTAL. He constrained the shape twice, at [10:49]
     * and [11:06]: "c'est juste une ligne ... si j'ai plusieurs mes lignes pour
     * plusieurs items, tu rajoutes pas 5 lignes la, juste un montant qui est le
     * total de mes lignes pour toute la colonne" and "Est le total de toutes les
     * lignes si applicables". The wizard sums its milling column and sends ONE
     * charge; this end does not fan it back out per lot line.
     */
    const ARCH_CHARGE_ITEMS = [
        { id: 2089, label: 'Freight/Transport' },
        { id: 1859, label: 'Freight' },
        { id: 3541, label: 'Freight Charges' },
        { id: 1874, label: 'Drop Charges' },
        /* Customer-facing milling, added 2026-09-21 on his answer at [10:04].
         * 3540 and NOT 3330/3331: those two carry the internal cost on the reman
         * POs and belong nowhere near a sales order. See the block above. */
        { id: 3540, label: 'Milling Charges' },
    ];

    /**
     * The charge items the screen may offer, re-read from NetSuite so a label
     * cannot drift from the record and an item that has been inactivated or
     * retyped stops being offered.
     *
     * Wrapped: this feeds a diagnostic GET, and a read failure must not take the
     * endpoint's health report down with it.
     */
    const chargeItemList = () => {
        try {
            const ids = ARCH_CHARGE_ITEMS.map((c) => c.id);
            const rows = query.runSuiteQL({
                query:
                    'SELECT id, itemid, itemtype FROM item ' +
                    'WHERE id IN (' + ids.join(',') + ') ' +
                    "  AND isinactive = 'F' AND itemtype = 'NonInvtPart'",
            }).asMappedResults();
            return rows.map((r) => ({ id: String(int(r.id)), name: String(r.itemid) }));
        } catch (e) {
            return { error: (e.name || '') + ': ' + (e.message || String(e)) };
        }
    };

    /**
     * Validates the charge lines a request asked for. Same shape as
     * `resolveLines` -- `{ charges, problems }` -- so the caller refuses the whole
     * order the same way and a bad charge can never half-write one.
     */
    /**
     * 🔴 FOB RELOAD MEANS SOMEBODY OWES FREIGHT, SO THE LINE IS ADDED FOR THEM.
     *
     * Asked for on the 2026-09-21 call, and it is not in the Slack list:
     *
     *   [08:51] "quand les gars vont choisir FOB Reload, sont obliges d'ajouter un
     *            frais de transport sur leur SO ... si on pouvait rajouter une ligne
     *            automatiquement quand ca cree le SO de freight transport"
     *   [09:41] "mettons l'incoterm FOB Reload est choisi. Ben la ca rajoute un line
     *            item sur le SO de freight."
     *
     * ⚠️ RATE 0, DELIBERATELY. He gave the reason in the same breath: "a ce
     * moment-la ils ne savent pas toujours le prix". The line is a placeholder that
     * says this order owes freight, not a guess at what it costs. `resolveCharges`
     * already accepts rate 0 as legitimate rather than a mistake -- 3 of the 6
     * hand-made ARC freight lines carry 0 -- so this needs no special case.
     *
     * 🔴 THE GAP IS REAL AND MEASURED. Of 89 FOB Reload sales orders in the
     * account, 4 carry a freight line. So 85 orders that by his own terms owe
     * freight do not show it, which is what this closes.
     *
     * 🔴 NEVER DOUBLES AN EXISTING FREIGHT LINE. If the trader already chose any
     * freight-shaped charge in the Items step, this does nothing: the trader knows
     * something this code does not, and quietly adding a second line would invent a
     * charge nobody agreed to. Milling does NOT count as freight for this test,
     * which is why the check is a list rather than "any charge at all".
     *
     * ⚠️ CREATE ONLY, inherited from the charge path: an append is refused
     * earlier if it carries charges at all, and an existing order already has
     * whatever freight it was given.
     */
    const FOB_RELOAD_INCOTERM = 5;
    const FREIGHT_SHAPED_ITEMS = [2089, 1859, 3541, 1874];

    const autoFreightForFobReload = (incotermId, charges) => {
        if (int(incotermId) !== FOB_RELOAD_INCOTERM) return null;
        for (let i = 0; i < charges.length; i++) {
            if (FREIGHT_SHAPED_ITEMS.indexOf(int(charges[i].itemId)) !== -1) return null;
        }
        return {
            itemId: 2089,
            itemCode: 'Freight/Transport',
            quantity: 1,
            rate: 0,
            description: 'Added automatically: FOB Reload. Rate to be confirmed.',
            autoAdded: true,
        };
    };

    const resolveCharges = (rawCharges) => {
        const problems = [];
        const charges = [];
        if (rawCharges === undefined || rawCharges === null) return { charges: [], problems: [] };
        if (!Array.isArray(rawCharges)) {
            return { charges: [], problems: ['`charges` must be an array.'] };
        }

        const allowed = {};
        ARCH_CHARGE_ITEMS.forEach((c) => { allowed[String(c.id)] = c.label; });

        rawCharges.forEach((raw, idx) => {
            const label = 'Charge line ' + (idx + 1);
            const itemId = int(raw && raw.itemId);
            if (!itemId) {
                problems.push(label + ': no item was chosen.');
                return;
            }
            /* 🔴 THE ALLOWLIST IS ENFORCED HERE, NOT IN THE BROWSER. The screen only
             * offers four items; a hand-made POST can name any of the 31, including
             * the accounting artifacts. The server is the only place this can be
             * refused. */
            if (!Object.prototype.hasOwnProperty.call(allowed, String(itemId))) {
                problems.push(label + ': item ' + itemId + ' is not a charge item this ' +
                              'screen may add. Allowed: ' +
                              ARCH_CHARGE_ITEMS.map((c) => c.label).join(', ') + '.');
                return;
            }

            /* Quantity POSITIVE on the way in. `transactionline.quantity` reads back
             * NEGATIVE for a sales order -- measured on order 115751, where the three
             * Assembly lot lines are -0.826, -0.409 and -0.816 and the freight line
             * is -1. That is NetSuite's storage convention for every outbound line,
             * not something peculiar to freight, so a charge is written exactly the
             * way `addLine` already writes wood and needs no sign handling. */
            const qty = numOr(raw && raw.quantity, NaN);
            if (!isFinite(qty) || qty <= 0) {
                problems.push(label + ': quantity must be a positive number.');
                return;
            }

            /* Rate MAY be zero and that is legitimate, not a mistake to reject: 3 of
             * the 6 hand-made ARC freight lines carry rate 0, which is how a
             * prepaid or absorbed charge is recorded. Negative is refused, because a
             * negative charge on a sales order is a credit and belongs on a credit
             * memo. */
            const rate = numOr(raw && raw.rate, NaN);
            if (!isFinite(rate) || rate < 0) {
                problems.push(label + ': the rate must be zero or more.');
                return;
            }

            charges.push({
                itemId: itemId,
                itemCode: allowed[String(itemId)],
                quantity: qty,
                rate: rate,
                description: raw && raw.description
                    ? String(raw.description).slice(0, 300) : '',
            });
        });

        return { charges: charges, problems: problems };
    };

    /**
     * Writes one charge line. No location, no inventory detail, no reman, no
     * split: a charge is not stock and must not acquire any of the machinery that
     * belongs to stock.
     */
    const addChargeLine = (so, charge, index) => {
        const set = (fieldId, value) =>
            so.setSublistValue({ sublistId: 'item', fieldId: fieldId, line: index, value: value });
        set('item',     charge.itemId);
        set('quantity', charge.quantity);
        set('rate',     charge.rate);
        if (charge.description) {
            // Best-effort: the field is standard, but a form could hide it and a
            // missing note must never cost the order its freight line.
            try { set('description', charge.description); } catch (e) { /* kept */ }
        }
    };

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

            if (!inArchScope(st.department, st.subsidiary, st.itemCode)) {
                // Not a caller mistake to explain away. This endpoint exists for
                // hardwood and must refuse anything else outright.
                //
                // 🔴 READS THE SHARED PREDICATE NOW. This line used to compare the
                // department alone and carried a comment claiming parity with the
                // cache MR. The cache moved to the subsidiary union in Feedback 7
                // and this did not, so the claim went stale and the endpoint
                // refused every ARC lot -- 1,048 of 1,099 on hand. See
                // `inArchScope`.
                problems.push(label + ': ' + st.itemCode + ' is not an ARCH hardwood item and cannot be ' +
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

    /**
     * Are the split line fields actually deployed?
     *
     * The same question `remanFieldsPresent` asks, with a sharper edge. In this
     * sandbox all three are deployed and the write has never once failed, which
     * is exactly why it went unguarded. Production carries NONE of the eight
     * `custcol_mgsl_*` fields -- measured 2026-09-02 by SOAP getCustomizationId
     * over transactionColumnCustomField, which is the only source that answers
     * this reliably -- so the first split line written there would throw.
     *
     * And it would not throw at the `setSublistValue`. It throws out of
     * `record.save`, as a bare UNEXPECTED_ERROR naming no field, which loses THE
     * WHOLE ORDER rather than just the marker.
     *
     * Not memoised, for the reason `remanFieldsPresent` gives: a module-level
     * cache would keep answering "no" after somebody deployed the fields.
     */
    const splitFieldsPresent = (so) => {
        let present;
        try {
            const fields = so.getSublistFields({ sublistId: 'item' }) || [];
            present = fields.indexOf(F_SPLIT)        !== -1
                   && fields.indexOf(F_SPLIT_BF)     !== -1
                   && fields.indexOf(F_SPLIT_STATUS) !== -1;
        } catch (e) {
            // If the probe itself fails, do not write. Same asymmetry as reman.
            present = false;
        }
        if (!present) {
            log.audit('ARCH Order split',
                'The split line fields are not on the sales order record, so the split ' +
                'marker was NOT written. Deploy custcol_mgsl_split, _split_bf and ' +
                '_split_status to turn this on. The order itself is unaffected, but the ' +
                'warehouse queue will not see these bundles.');
        }
        return present;
    };

    const addLine = (so, line, index, remanOk, splitOk) => {
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

        /* Split, guarded the same way, and it must never be able to lose the
         * order either. An order saved without its marker is recoverable by
         * ticking the box by hand -- the bundle is committed either way. An
         * order that never saved is not.
         *
         * Reported rather than swallowed, for the reason reman is: the marker is
         * what puts the bundle in the warehouse queue, so a trader told "split
         * requested" when nothing was written would be waiting on a cut that
         * nobody will ever be asked to make. */
        let splitWritten = true;
        if (line.isSplit) {
            if (splitOk) {
                try {
                    set(F_SPLIT,    true);
                    set(F_SPLIT_BF, line.displayQty);
                    // setSublistText is not available in standard mode, so the split
                    // status goes in by its list value id rather than its label.
                    so.setSublistValue({
                        sublistId: 'item', fieldId: F_SPLIT_STATUS, line: index,
                        value: splitStatusPendingId(),
                    });
                } catch (e) {
                    splitWritten = false;
                    log.error('ARCH Order split NOT written',
                        'Line ' + index + ' (' + (line.itemCode || line.itemId) + '): ' +
                        (e.name || '') + ': ' + (e.message || String(e)) +
                        ' | The fields passed the presence probe but refused the write. The ' +
                        'order itself is unaffected and is reported as split-not-stored.');
                }
            } else {
                splitWritten = false;
            }
        }

        return { reman: remanWritten, split: splitWritten };
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
     * `custscript_arch_pdf_email_to` holds a COMMA-SEPARATED list of recipients.
     * Empty is the default and means no email at all. Each entry is one of:
     *
     *   CREATOR   the person who created the order. Resolved from getCurrentUser,
     *             which survives the runasrole switch.
     *   SALESREP  the sales rep or reps credited ON THE SAVED ORDER. This is the
     *             third clause of Marc-Antoine's 2026-09-08 item 9, which we had
     *             marked done on the strength of the first two: "Je crois qu'on
     *             devrait ajouter le field sales rep [...] Le courriel pourrait
     *             s'envoyer au sales rep."
     *   anything  treated as a literal email address, sent to as-is. Use this in
     *   else      the sandbox so nothing reaches MGSL until they have asked for it.
     *
     * So `CREATOR` alone is his item 3.b, `SALESREP` alone is his item 9, and
     * `CREATOR,SALESREP` is both. One parameter, because the two asks are the same
     * mechanism pointed at different people, and a second parameter would let the
     * two drift.
     *
     * Same shape as the split fee: config, default off, until confirmed.
     *
     * ── Why SALESREP reads the SAVED order instead of re-deriving ───────────
     * `resolveSalesRep` answers "who SHOULD be credited" from the request. That is
     * the wrong question here, for two reasons. On an APPEND the request carries no
     * rep at all and deliberately ignores one if sent, yet the order still has a
     * rep from when it was created. And the rep that matters is the one that
     * actually landed, not the one we asked for. Reading it back is both simpler
     * and truthful.
     *
     * The rep lives on the sales team SUBLIST, not the header: `transaction.salesrep`
     * is empty on every ARCH order in this account, which is the same fact that made
     * the Open Sales Orders tab show "Unassigned" for all of them.
     *
     * ── Why failure here is swallowed ───────────────────────────────────────
     * The order is already saved and verified by the time this runs. If rendering
     * or mailing fails, the order is still correct and the trader must not be told
     * it failed — the same reasoning that makes `assignLots` non-fatal. Logged at
     * AUDIT for a config problem, ERROR only when it actually broke.
     */
    const PDF_EMAIL_PARAM = 'custscript_arch_pdf_email_to';

    /**
     * The employees credited as sales reps on a SAVED order, for SALESREP.
     *
     * Returns { ids, skipped, readable }. `readable: false` means the sublist could
     * not be read at all, which is NOT the same as "no reps" and must never be
     * reported as one.
     *
     * ⚠️ Two queries, not one join, and that is deliberate. Both shapes are already
     * proven under `N/query` in this file at this role: the first is the same shape
     * as `verifySalesTeam`, the second the same as `resolveSalesRep`. REST SuiteQL
     * and N/query are different dialects and a join that works in `sql.mjs` can fail
     * only once deployed, which has already cost this project a live defect. Reusing
     * proven shapes is cheaper than discovering that again in a mail path.
     *
     * ⚠️ Whether `customrole2184` can read `transactionsalesteam` is NOT established
     * (see the note on `verifySalesTeam`), so an unreadable sublist degrades to "do
     * not send" with an AUDIT line, never to a fallback recipient. Mailing the wrong
     * person a customer's order confirmation is worse than mailing nobody.
     */
    const resolveRepRecipients = (soId) => {
        let rows;
        try {
            rows = query.runSuiteQL({
                query: 'SELECT employee, contribution FROM transactionsalesteam ' +
                       'WHERE transaction = ?',
                params: [soId],
            }).asMappedResults();
        } catch (e) {
            log.audit('ARCH Order PDF',
                'Could not read the sales team on order ' + soId + ', so SALESREP ' +
                'resolved to nobody: ' + (e.message || String(e)));
            return { ids: [], skipped: [], readable: false };
        }

        // Contribution orders the log usefully (the majority holder first) and is
        // stored as a FRACTION, not a percentage. Ordering only, never arithmetic.
        const ranked = (rows || [])
            .map((r) => ({ id: int(r.employee), share: parseFloat(r.contribution) || 0 }))
            .filter((r) => r.id)
            .sort((a, b) => b.share - a.share);

        const seen = {};
        const candidates = [];
        for (let i = 0; i < ranked.length; i++) {
            if (seen[ranked[i].id]) continue;
            seen[ranked[i].id] = true;
            candidates.push(ranked[i].id);
        }
        if (!candidates.length) return { ids: [], skipped: [], readable: true };

        /* A team member who is inactive, not flagged Sales Rep, or has no address
         * cannot receive this. Each is a real state in this account rather than a
         * hypothetical: James Bradley sits on 33 saved sales-team rows and reads
         * `issalesrep = 'F'` today. */
        let ok;
        try {
            ok = query.runSuiteQL({
                query:
                    'SELECT id, email FROM employee ' +
                    'WHERE id IN (' + candidates.join(',') + ') ' +
                    "  AND issalesrep = 'T' AND isinactive = 'F'",
            }).asMappedResults();
        } catch (e) {
            log.audit('ARCH Order PDF',
                'Could not check the sales team members of order ' + soId + ', so ' +
                'SALESREP resolved to nobody: ' + (e.message || String(e)));
            return { ids: [], skipped: [], readable: false };
        }

        const mailable = {};
        for (let i = 0; i < (ok || []).length; i++) {
            const id = int(ok[i].id);
            // NULL columns are OMITTED from a SuiteQL row, so an absent key is an
            // absent address. Checking truthiness covers both that and ''.
            if (id && ok[i].email) mailable[id] = true;
        }

        const ids = [];
        const skipped = [];
        for (let i = 0; i < candidates.length; i++) {
            if (mailable[candidates[i]]) ids.push(candidates[i]);
            else skipped.push(candidates[i]);
        }
        return { ids: ids, skipped: skipped, readable: true };
    };

    /**
     * What the PDF-email parameter is set to, for the GET health payload.
     *
     * Reports the KINDS of recipient configured, never the address itself: a health
     * endpoint should not hand out a mailbox. This is the read-only way to tell an
     * absent parameter from an empty one, which the runtime log cannot do.
     */
    const pdfEmailReadiness = () => {
        let raw = null;
        let threw = false;
        try {
            raw = param(PDF_EMAIL_PARAM);
        } catch (e) {
            threw = true;
        }
        const target = String(raw === null || raw === undefined ? '' : raw).trim();
        const tokens = target.split(',').map((t) => String(t).trim()).filter((t) => t)
            .map((t) => {
                const u = t.toUpperCase();
                if (u === 'CREATOR' || u === 'SALESREP') return u;
                return 'ADDRESS';
            });
        return {
            // `present: false` means the field is not on the deployment at all, as
            // distinct from present-and-empty, which is the intended default.
            present: !threw && raw !== null && raw !== undefined,
            configured: tokens.length > 0,
            tokens: tokens,
        };
    };

    /**
     * The facts for the email, read from the SAVED order.
     *
     * Not passed in and not recomputed. The body claims to describe what NetSuite
     * holds, so it reads what NetSuite holds; anything assembled from the request
     * could differ from the document by the time it is sent. `BUILTIN.DF` is used 40
     * times in deployed SuiteScript here, so the dialect is proven.
     *
     * Returns null on any failure, and the caller then sends the plain body. An
     * email that is a little bare is fine; one carrying a figure that disagrees with
     * the order is not.
     */
    const orderSummary = (soId) => {
        try {
            const rows = query.runSuiteQL({
                query:
                    'SELECT BUILTIN.DF(t.entity)               AS customer, ' +
                    '       BUILTIN.DF(t.custbody_incoterms)   AS incoterms, ' +
                    '       t.shipdate                         AS shipdate, ' +
                    '       t.foreigntotal                     AS total, ' +
                    '       c.symbol                           AS iso, ' +
                    // Feedback 6 item 7b. Read back off the SAVED order like every
                    // other fact in this email, so what it prints is the note the
                    // order actually carries rather than the one that was sent.
                    '       t.memo                             AS memo ' +
                    'FROM transaction t ' +
                    '  LEFT JOIN currency c ON c.id = t.currency ' +
                    'WHERE t.id = ?',
                params: [soId],
            }).asMappedResults();
            return rows.length ? rows[0] : null;
        } catch (e) {
            log.audit('ARCH Order PDF',
                'Could not read the summary for order ' + soId + ', so the email is ' +
                'sent without it: ' + (e.message || String(e)));
            return null;
        }
    };

    /** A money figure with thousands separators. No currency symbol guessing. */
    const money = (n) => {
        const v = parseFloat(n);
        if (!isFinite(v)) return null;
        const fixed = v.toFixed(2);
        const parts = fixed.split('.');
        return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
    };

    /**
     * `label   value` rows, aligned, and a row is OMITTED when its value is unknown
     * rather than printed as a blank or a zero. A blank line in a summary reads as
     * "this order has none of that", which for a total would be a lie.
     */
    const summaryBlock = (rows) => {
        const present = rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '');
        if (!present.length) return '';
        let width = 0;
        present.forEach((r) => { if (r[0].length > width) width = r[0].length; });
        return present
            .map((r) => {
                let pad = r[0];
                while (pad.length < width) pad += ' ';
                return pad + '   ' + r[1];
            })
            .join('\n');
    };

    const sendOrderPdf = (soId, tranId, creatorId, appending, facts) => {
        /* READ DEFENSIVELY. `param()` already swallows a throwing getParameter and
         * returns null (a parameter missing from the DEPLOYED script object can
         * throw rather than read null). The try here is belt and braces so that
         * uploading this JS before the script object can never break order
         * creation, which would be a far worse outcome than an unsent email. */
        let target = '';
        try {
            target = String(param(PDF_EMAIL_PARAM) || '').trim();
        } catch (e) {
            log.audit('ARCH Order PDF',
                'Parameter ' + PDF_EMAIL_PARAM + ' is not on this deployment yet, so no ' +
                'confirmation was sent. The order is unaffected.');
            return { sent: false, reason: 'parameter not deployed' };
        }
        if (!target) {
            /* Was silent until 2026-09-09, and that cost a debugging session: an
             * ABSENT parameter and an EMPTY one both produced no log line at all,
             * so a run that mailed nothing looked identical to a run that never
             * reached here. The audit above this that was meant to tell them apart
             * is unreachable, because param() catches the throw and returns null. */
            log.audit('ARCH Order PDF',
                'No recipient is configured on ' + PDF_EMAIL_PARAM + ', so ' + tranId +
                ' was not mailed. This is the default state and the order is unaffected.');
            return { sent: false, reason: 'not configured' };
        }

        try {
            /* Recipients are assembled BEFORE the PDF is rendered. Rendering is the
             * expensive half, and a configuration that resolves to nobody should not
             * pay for it. */
            const tokens = target.split(',')
                .map((t) => String(t).trim())
                .filter((t) => t);

            const recipients = [];
            const to = [];          // what actually got mailed, for the log
            const notes = [];       // why anything was left out
            const seen = {};
            const add = (value, label) => {
                const key = String(value);
                if (seen[key]) return;
                seen[key] = true;
                recipients.push(value);
                to.push(label);
            };

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const upper = token.toUpperCase();

                if (upper === 'CREATOR') {
                    // Resolved to the real person, not the runasrole. See the note on
                    // resolveSalesRep: getCurrentUser survives the role switch.
                    if (creatorId) add(creatorId, 'creator (' + creatorId + ')');
                    else notes.push('CREATOR resolved to nobody');
                    continue;
                }

                if (upper === 'SALESREP') {
                    const reps = resolveRepRecipients(soId);
                    for (let k = 0; k < reps.ids.length; k++) {
                        add(reps.ids[k], 'sales rep (' + reps.ids[k] + ')');
                    }
                    if (reps.skipped.length) {
                        notes.push('sales team member(s) ' + reps.skipped.join(', ') +
                                   ' skipped: inactive, not flagged Sales Rep, or no address');
                    }
                    if (!reps.readable) notes.push('the sales team could not be read');
                    else if (!reps.ids.length) notes.push('no mailable sales rep on the order');
                    continue;
                }

                // Anything else is a literal address.
                add(token, token);
            }

            if (!recipients.length) {
                log.audit('ARCH Order PDF',
                    'Configured as "' + target + '" but that resolved to no recipient, so ' +
                    'SO ' + tranId + ' was not mailed. The order is unaffected.' +
                    (notes.length ? ' ' + notes.join('; ') + '.' : ''));
                return { sent: false, reason: notes.length ? notes.join('; ') : 'no recipient resolved' };
            }

            // The PDF comes from the transaction's own form, so it is whatever
            // NetSuite would print — no layout invented here. render.transaction
            // does not take a form id: the record already knows its form, which is
            // the one thing about `customform` that works in our favour.
            const pdf = render.transaction({
                entityId: soId,
                printMode: render.PrintMode.PDF,
            });
            pdf.name = tranId + '.pdf';

            const summary = orderSummary(soId);
            const total = summary && money(summary.total)
                ? (summary.iso ? summary.iso + ' ' : '') + money(summary.total)
                : null;

            email.send({
                // Author must be an employee with an email address. The creating
                // user is one by definition — they just saved a transaction.
                author: creatorId,
                recipients: recipients,
                /* The customer is in the SUBJECT because these land in a working
                 * inbox: two orders were otherwise indistinguishable without opening
                 * them. Internal only, so a customer name here reaches nobody outside
                 * MGSL. Falls back to the bare form when the summary is unreadable. */
                subject: 'Sales order ' + tranId +
                         (summary && summary.customer ? ' for ' + summary.customer : ''),
                body: (function () {
                    const lots = (facts && facts.lots ? facts.lots : [])
                        .filter(function (x) { return x; });
                    const block = summaryBlock([
                        ['Customer', summary ? summary.customer : null],
                        ['Total', total],
                        ['Incoterms', summary ? summary.incoterms : null],
                        // Omitted entirely when there is none: `summaryBlock` drops
                        // an empty row rather than printing a bare label.
                        ['Note', summary ? summary.memo : null],
                        ['Ship date', summary ? summary.shipdate : null],
                        [lots.length === 1 ? 'Bundle' : 'Bundles', lots.join(', ') || null],
                    ]);

                    /* Reman is mentioned ONLY when reman was actually asked for, and
                     * then it says which way it went. Printed unconditionally until
                     * 2026-09-09, hedged as "if any were entered", on every order --
                     * including the great majority that have no reman at all. The
                     * server knows: it computes remanRequested and remanStored a few
                     * lines from the call site. The case genuinely worth an email is
                     * requested-but-not-stored, and that was buried under the same
                     * sentence as everything else. */
                    let reman = '';
                    if (facts && facts.remanRequested) {
                        reman = facts.remanStored
                            ? '\n\nReman instructions were entered and are stored on the order ' +
                              'lines. They are NOT part of the printed PDF.'
                            : '\n\nReman instructions were entered but did NOT reach the order. ' +
                              'They are not on the lines and not in the PDF, so they need ' +
                              'entering by hand.';
                    }

                    return 'Sales order ' + tranId +
                           (appending ? ' has been updated' : ' has been created') +
                           ' from the CWP ARCH trader screen.' +
                           (block ? '\n\n' + block : '') +
                           '\n\nThe PDF is attached and shows what NetSuite holds.' +
                           reman;
                }()),
                attachments: [pdf],
            });

            log.audit('ARCH Order PDF',
                'Mailed ' + tranId + ' to ' + to.join(', ') +
                (notes.length ? ' | ' + notes.join('; ') : ''));
            return { sent: true, to: to, skipped: notes };
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
        /* Feedback 9 item 10. Resolved BEFORE the record is touched, exactly like
         * the sales team below, so a bad charge refuses the request without
         * leaving a half-built order behind. An absent `charges` resolves to []
         * and every path below runs precisely as it did. */
        const resolvedCharges = resolveCharges(
            (input.header || {}).charges || input.charges);
        if (resolvedCharges.problems.length) {
            throw refusal(resolvedCharges.problems.join(' '));
        }
        /* 🔴 FOB RELOAD ADDS ITS OWN FREIGHT LINE, and it happens HERE so the
         * added line goes through the same cap check, the same writer and the same
         * response as a charge the trader chose. Putting it after the write would
         * let it slip past MAX_LINES and leave it out of the reply, so the trader
         * would be told one thing and the order would say another -- the same
         * defect the Review step already had once this session. */
        if (!appending) {
            const autoFreight = autoFreightForFobReload(
                (input.header || {}).incotermsId, resolvedCharges.charges);
            if (autoFreight) {
                resolvedCharges.charges.push(autoFreight);
                log.audit('ARCH order - freight line added for FOB Reload',
                    'Incoterm is FOB Reload (' + FOB_RELOAD_INCOTERM + ') and the request ' +
                    'carried no freight charge, so one Freight/Transport line was added at ' +
                    'rate 0 for billing to complete.');
            }
        }
        /* ⚠️ CHARGES COUNT TOWARD THE LINE CAP. `resolveLines` enforces MAX_LINES
         * over the stock lines alone, so without this a request could carry 200
         * stock lines plus any number of charges and walk straight past a limit
         * that exists because NetSuite crawls on very long orders. */
        if (resolved.lines.length + resolvedCharges.charges.length > MAX_LINES) {
            throw refusal('This order has ' + resolved.lines.length + ' stock line(s) and ' +
                          resolvedCharges.charges.length + ' charge line(s), which is past ' +
                          'the ' + MAX_LINES + '-line limit. Split it into several orders.');
        }
        /* ⚠️ CHARGES ARE CREATE-ONLY, because he asked for this at SO CREATION.
         * On an append the order already carries whatever freight it was given,
         * this wizard cannot show it, and a second line would silently double it.
         * Refused rather than quietly dropped, so nobody is told a charge was
         * added that was not. */
        if (appending && resolvedCharges.charges.length) {
            throw refusal('Charge lines can only be added when a NEW order is created, ' +
                          'not when adding bundles to an existing one. Add the freight ' +
                          'line on the order itself.');
        }

        /* ── The Sales Team the caller NAMED, or null ─────────────────────────
         *
         * Resolved BEFORE the record is touched, so a refusal costs nothing and
         * cannot leave a half-built order behind. `null` is the default and the
         * whole safety property: with no `header.salesTeamId` the paths below run
         * exactly as they did, one line from `resolveSalesRep` on create and
         * nothing at all on an append. There is no fallback team and no
         * configured one -- see `resolveSalesTeam`. */
        const teamRequest = (input.header || {}).salesTeamId;
        /* The members travel WITH the id. See the long note on `resolveSalesTeam`:
         * this deployment's role cannot read `entitygroup` at all, so the caller
         * supplies what it was served and the server re-validates every member
         * against `employee`, which it can read. */
        const teamRequested = !(teamRequest === undefined || teamRequest === null ||
                                String(teamRequest).trim() === '');
        const namedTeam = !teamRequested
            ? null
            : resolveSalesTeam(
                teamRequest,
                (input.header || {}).salesTeamMembers,
                (input.header || {}).salesTeamName
            );
        /* WHY THIS IS SOUND: `resolveSalesTeam` returns null on EXACTLY ONE path,
         * the write switch being off. Every other exit throws. So a request that
         * came back empty is the switch and nothing else.
         *
         * It exists because the response could not tell "the switch is off, your
         * team was ignored" from "the team was written and replaced nothing":
         * both left `teamWrite` null, so both answered `salesTeamReplaced: false`
         * with an empty `salesTeamPrevious`. The client latch and this deployment's
         * parameter are two different script deployments and CAN disagree, and
         * when they do the trader is told the team will be written, gets a success,
         * and no commission is attributed. Silent, which is the exact defect this
         * screen keeps being corrected for. */
        const teamIgnoredReason = (teamRequested && !namedTeam)
            ? 'A sales team was picked, but ' + SALES_TEAM_WRITE_PARAM + ' is off on this ' +
              'deployment, so no commission was attributed and the order keeps its single rep. ' +
              'Nothing else about the order was affected.'
            : null;
        /* Filled by whichever branch writes the team, so the response can say
         * what it replaced. Stays null when no team was named. */
        let teamWrite = null;

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

        /* What rate the order will actually carry, and where it came from,
         * returned on the response and written to the execution log.
         *
         * ⚠️ NOTHING READS THEM YET. `ArchOrderResult` in archOrderApi.ts
         * declares neither key and no component reads either, so this is a
         * server-side and API-level record rather than something the trader sees.
         * The screen's own copy is what discloses the divergence today.
         *
         * `effectiveRate` starts null and is filled by the create branch or by
         * the post-save read. `rateSource` starts at 'configuration' rather than
         * null, which is a deliberate floor and also a limit: an append whose
         * post-save read fails keeps that initial answer. */
        let effectiveRate = null;
        let rateSource = 'configuration';

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
            const termsId    = int(h.termsId);
            /*
             * 🔴 RESOLVE THE CODE, AND REFUSE RATHER THAN FALL BACK.
             *
             * The screen sends an id (since 2026-09-16) and a code. If the id is
             * missing but a code is present, the code is resolved here; if THAT
             * fails, the order is refused. Falling through to the customer's primary
             * currency is what made this dangerous in the first place: the screen
             * priced, converted and quoted in the currency a trader clicked while
             * NetSuite silently created the order in a different one, 39% out at
             * today's rate on a CAD pick against a USD-primary customer, and nothing
             * in the response said so.
             */
            let currencyId = int(h.currencyId);
            if (!currencyId && h.currency && /^[A-Z]{3}$/.test(String(h.currency).toUpperCase())) {
                const code = String(h.currency).toUpperCase();
                const rows = query.runSuiteQL({
                    query: 'SELECT id FROM currency WHERE UPPER(symbol) = ?',
                    params: [code],
                }).asMappedResults();
                currencyId = rows.length === 1 ? int(rows[0].id) : null;
                if (!currencyId) {
                    throw refusal('The order is priced in ' + code + ', which does not resolve to a ' +
                                  'currency in NetSuite, so it cannot be created without billing the ' +
                                  'customer in a different one. Nothing was saved.');
                }
            }
            if (currencyId) so.setValue({ fieldId: 'currency', value: currencyId });
            if (termsId)    so.setValue({ fieldId: 'terms',    value: termsId });

            /*
             * Feedback 6 item 7b: "Ajouter le champ customer notes (memo). Parfois les
             * users veulent inscrire une note pour leur client sur la commande."
             *
             * 🔴 THE NATIVE `memo`, not a new custom field, because that is where this
             * note already goes. SO-CWP-001369 and -001370 both read "thank you for your
             * business", written by Marc-Antoine on 2026-09-11, and 73 of 1,270 ARCH
             * orders carry one. A custom field beside it would have split the same note
             * across two places and left every note he has already written invisible.
             *
             * Truncated rather than refused: NetSuite caps this at 999 and drops the
             * rest without a word, so an over-long note would lose its tail either way.
             * The wizard counts down from the same number, so this is the backstop for a
             * caller that is not the wizard.
             */
            if (h.customerNote) {
                const note = String(h.customerNote).slice(0, 999);
                so.setValue({ fieldId: 'memo', value: note });
            }

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
            so.setValue({ fieldId: 'department', value: resolveDepartment(so) });

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
            //
            // ── A NAMED TEAM REPLACES ALL OF THAT, and only a named one ──────
            //
            // When the caller named a team, the sublist comes ENTIRELY from that
            // team and the rep resolution below is skipped: the mandatory sublist
            // is satisfied by the team's own members, every one of them validated
            // by `resolveSalesTeam`, so there is nothing left for a fallback to
            // do. That also means a trader who is not themselves a sales rep can
            // raise an order by naming a team, which is the correct outcome and
            // not a bypass: the team is an explicit choice, whereas the three
            // fallbacks below are guesses ranked by plausibility.
            //
            // ⚠️ `header.salesRepId` is NOT required to be a member of the team,
            // and is not cross-checked against it. Marc-Antoine keeps the two
            // apart on purpose -- "Je crois qu'on devrait ajouter le field 'sales
            // rep'. Qui permet d'identifier qui est le owner du SO. Le sales team
            // définit le split commission" (2026-09-08) -- so the rep is the
            // OWNER, written to `custbody_sales_rep` above, and the team is the
            // SPLIT. An owner outside the team is a legitimate combination and
            // refusing it would block it.
            const repId = namedTeam ? null : resolveSalesRep(
                int(h.salesRepId), currentUserId(), customerId);
            if (!namedTeam && !repId) {
                /*
                 * Names the CAUSE, not just the symptom. The single generic
                 * message this replaced was read as "not flagged as a sales rep"
                 * when the real cause was "this role cannot see that employee",
                 * and acting on the wrong reading turned our bug into a client
                 * ask. See `diagnoseSalesRep`.
                 */
                const why = diagnoseSalesRep(
                    int(h.salesRepId), currentUserId(), customerId);
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
            if (namedTeam) {
                teamWrite = writeSalesTeam(so, namedTeam);
                log.audit('ARCH Order Create',
                    'Sales team "' + namedTeam.teamName + '" (' + namedTeam.teamId + ') written ' +
                    'to a new order. The label comes from the CALLER and is verified against ' +
                    'nothing; the names and ids below were re-read from `employee`: ' +
                    namedTeam.members.map((m) => m.name + ' #' + m.id + ' ' + m.pct + '%').join(', ') +
                    (teamWrite.contributionWritten
                        ? '. Contributions were set explicitly.'
                        : '. Single member, so NetSuite fills the 100% in itself.'));
            } else {
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
                //
                // ⚠️ The branch above DOES set contribution, and that is not a
                // contradiction: it only does so for a team with MORE than one
                // member, where NetSuite has nothing to infer from, and it sends
                // the TYPED number (50) rather than the stored fraction. This
                // single-line path is the one the six orders this endpoint has
                // created already prove, so it is left exactly as it was.
            }

            applyIncoterms(so, h, true);

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

            /* Ops + insurance: FILL ONLY, never clobber.
             *
             * Not taken from the request. An earlier version accepted
             * `input.insuranceRate` from the browser, unbounded, which
             * contradicts this module's own rule about not letting a screen
             * choose financial context.
             *
             * 🔴 But it is not ours to assert either. This line used to stamp
             * `insuranceRateStored()` UNCONDITIONALLY over a value NetSuite
             * sources from the customer, and it really did overwrite: the three
             * oldest form-386 orders (126449, 126450, 126654) hold 3.0E-5
             * against customers carrying 0.003, which is the old 100x scale value
             * written straight over the sourced one.
             *
             * The 1.5% exposure is ahead of us, not behind. Measured 2026-09-03:
             * 16 active subsidiary-5 customers carry 0.015, and subsidiary 5 is
             * where every ARCH lot and all three customers with a form-386 order
             * live. None of those three is one of the 16 -- customers 2853, 3285
             * and 2878 all sit at 0.003, and production has no form-386 order at
             * all -- so no order has yet been stamped 0.3% over a negotiated 1.5%.
             * The first order from any of the 16 would have been, understating
             * cost and overstating profit fivefold. The earlier 100x scale bug at
             * least looked absurd; this one would not have.
             *
             * ⚠️ THE APPEND PATH'S GUARD CANNOT SIMPLY BE COPIED HERE, and that
             * is the trap. The record is created in STANDARD mode (`isDynamic:
             * false`, see `record.create` above), where sourcing does not run
             * until `save({ enableSourcing: true })`. So on a NEW record
             * `so.getValue(H_INSURANCE)` is empty no matter what the customer
             * carries, a read-back guard would pass every time, and it would
             * clobber exactly as before while looking fixed. The customer has to
             * be asked directly.
             *
             * When the customer has a rate we write NOTHING and let NetSuite
             * source it. That also keeps the Percent conversion in one place
             * instead of two. */
            const custRate = customerInsuranceRate(customerId);
            if (custRate === null) {
                effectiveRate = insuranceRate();
                rateSource = 'configuration';
                setIfPresent(so, H_INSURANCE, insuranceRateStored(), 'the ops and insurance rate');
            } else {
                effectiveRate = custRate;
                rateSource = 'customer';
                if (custRate !== insuranceRate()) {
                    // Worth a line in the log, because the margin the trader was
                    // shown was computed against the configured rate, not this one.
                    log.audit('ARCH Order Create',
                        'Customer ' + customerId + ' carries its own ops+insurance rate ' +
                        custRate + ', which differs from the configured ' + insuranceRate() +
                        '. Leaving the field to NetSuite; the quoted margin used the ' +
                        'configured rate and is optimistic by the difference.');
                }
            }

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

            /* ── The rep and the team on an APPEND, decided separately ────────
             *
             * 🔴 `header.salesRepId` AND `custbody_sales_rep` STAY IGNORED HERE,
             * and that is the answer rather than an omission. The wizard already
             * says so on the append path ("Adding lines does not change who owns
             * it: change the rep on the order in NetSuite"), and the measurements
             * behind that warning are decisive:
             *
             *  1. THE ROUND TRIP IS LOSSY BY CONSTRUCTION. On an append the
             *     wizard PRE-FILLS its rep dropdown from the order's own lead
             *     rep, which `shared/archSalesTeam.js:pickRep` computes by
             *     collapsing the whole Sales Team down to ONE employee -- for a
             *     tie, the lowest id. SO-CWP-001352 in this sandbox is Justin
             *     Loveland 0.5 / Samuel Nadon 0.5, so its prefill is Justin
             *     alone. An append that wrote the sublist from that prefill would
             *     turn a 50/50 into Justin at 100% while the trader changed
             *     NOTHING, silently moving half the commission. That is not a
             *     hypothesis about a future order; it is what this account holds
             *     today.
             *  2. THE TEXT FIELD IS WORSE, NOT BETTER. `custbody_sales_rep`
             *     ("Sales Rep (PDF)", id 9186) is FREE-FORM TEXT and holds
             *     hand-typed content: SO-CWP-001352 reads "Samuel Nadon / Justin
             *     Loveland", typed by a person to match that split. The wizard
             *     can only ever send ONE name, so writing it would truncate a
             *     value nobody asked to change. Same lost-update shape already
             *     noted for `otherrefnum`, with a concrete instance.
             *  3. NOBODY ASKED FOR IT. Marc-Antoine asked for a Sales Rep field
             *     to identify the OWNER of an order (2026-09-08). No client note
             *     asks for the owner of an EXISTING order to be reassignable from
             *     this screen, and reassigning an order somebody else owns is a
             *     real-world consequence, not a UI nicety.
             *
             * ✅ A NAMED TEAM IS DIFFERENT, AND IS HONOURED. `header.salesTeamId`
             * is an `entitygroup` id, and no such id can be pre-filled: a saved
             * order's sublist carries employees and percentages, not the template
             * it came from, and there is no reverse mapping. So a team id on an
             * append can only have come from a trader actively picking one out of
             * the 44, which makes it deliberate BY CONSTRUCTION rather than by
             * hoping. It is also lossless where the rep is not, because the team
             * carries every member and every percentage.
             *
             * This is the append rule this block already follows, applied
             * honestly: apply what the trader could SEE and CHANGE, and the team
             * picker is the only one of the two that a change can be distinguished
             * from a prefill. */
            if (namedTeam) {
                teamWrite = writeSalesTeam(so, namedTeam);
                log.audit('ARCH Order Create',
                    'Sales team on SO ' + existingId + ' REPLACED by an explicit request: ' +
                    (teamWrite.previousEmployees.length
                        ? 'employee(s) ' + teamWrite.previousEmployees.join(', ')
                        : 'no team') +
                    ' -> "' + namedTeam.teamName + '" (' + namedTeam.teamId + ') = ' +
                    namedTeam.members.map((m) => m.name + ' #' + m.id + ' ' + m.pct + '%').join(', ') +
                    '. The team LABEL comes from the caller and is unverified; the names ' +
                    'and ids are ' +
                    'from `employee`. Commission on this order has been reattributed.');
            }

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
                so.setValue({ fieldId: 'department', value: resolveDepartment(so) });
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

            /* Ops + insurance on an APPEND: fill a gap from the CUSTOMER, never
             * restate configuration over a rate the order already has.
             *
             * `!num(...)` was the wrong emptiness test twice over.
             *
             * It treats a legitimate stored 0% as absent. No instance today --
             * measured 2026-09-03, 0 prod customers and 0 prod sales orders sit at
             * 0%, so a stored 0 cannot arise from sourcing. A hand-typed one could:
             * two prod orders diverge from their customer (see
             * `customerInsuranceRate`), one an override to 0.015 on SO-IND-246044
             * and one left blank on SO-IND-246519. Neither is 0, so the guard is
             * safe today -- but do not read this as proof that an order can only
             * ever hold its customer's rate.
             *
             * ⚠️ And `num` is the STRICT guard for REQUEST payloads: its regex is
             * /^-?\d+(\.\d+)?$/. If `getValue` on a Percent hands back a display
             * form such as "1.5%" it parses to null, the guard fires on an order
             * that is NOT blank, and configuration gets stamped over a negotiated
             * rate -- 10 open production orders carry 0.015. That return shape is
             * NOT established here and cannot be read read-only. `numOr` is
             * correct under either shape: parseFloat takes "1.5" and "1.5%" alike,
             * returns 0 for a real zero, and NaN only for genuinely empty.
             *
             * The gap was also filled from configuration when the field is sourced
             * from the CUSTOMER. No appendable blank-rate order has a rated
             * customer today -- all eight are intercompany or test entities -- so
             * this changes nothing yet; it fires the first time a rate is added to
             * a customer that already has an open order.
             *
             * ⚠️ This WRITES where the create branch deliberately stays silent,
             * and that asymmetry is correct: whether `save({ enableSourcing: true
             * })` re-sources a blank field on an EXISTING record is not
             * established, so silence here would be a gamble, while writing the
             * customer's own value is the same number sourcing would produce.
             *
             * Nothing is REPORTED from here. The post-save read is the one place
             * that answers what the order actually carries, on both paths. */
            if (numOr(so.getValue({ fieldId: H_INSURANCE }), null) === null) {
                const custRate = customerInsuranceRate(entityId);
                setIfPresent(so, H_INSURANCE,
                    custRate === null ? insuranceRateStored() : custRate * 100,
                    'the ops and insurance rate');
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
        const wantsSplit = resolved.lines.some((l) => !!l.isSplit);
        const splitOk = wantsSplit ? splitFieldsPresent(so) : false;
        // `every` over the write outcomes, not the intent: one refused line makes
        // the whole order reman-not-stored, because a trader told "recorded" would
        // stop carrying ANY of it across by hand. The split marker is reported the
        // same way and for the same reason.
        const lineWrites = resolved.lines.map(
            (line, i) => addLine(so, line, firstNewLine + i, remanOk, splitOk));

        /* 🔴 CHARGES LAST, AFTER EVERY STOCK LINE, AND THAT ORDER IS LOAD-BEARING.
         *
         * `assignLots` runs after the save, RELOADS the order and finds each lot's
         * line by matching item + location + quantity while skipping lines it has
         * already used. A charge line can never match a stock line's triple -- its
         * item is a NonInvtPart from the allowlist and every ARCH stock item is an
         * Assembly, so the ids cannot collide -- but keeping charges at the end of
         * the sublist means the matcher never has to walk past one to reach a lot,
         * and the printed order reads the way a reader expects with freight last.
         *
         * ⚠️ On an APPEND `firstNewLine` is the existing line count, so charges
         * still land after this call's own stock lines rather than among the
         * order's earlier ones. Appending charges is refused outright anyway -- see
         * the append path -- because he asked for this « à la création du SO ». */
        resolvedCharges.charges.forEach((charge, j) => {
            addChargeLine(so, charge, firstNewLine + resolved.lines.length + j);
        });

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

            /* 🔴 THE DEPARTMENT THE EXECUTING ROLE IS NOT ALLOWED TO USE.
             *
             * "You have entered an Invalid Field Value 11 for the following field:
             * department" reached the trader as a raw 500 with no cause and no
             * next step, which is how it arrives: `setValue` ACCEPTS the id
             * happily and only `save` enforces the restriction, so nothing before
             * this point can see it coming.
             *
             * MEASURED 2026-09-14. This endpoint created SO-CWP-001366 and
             * SO-CWP-001367 with department 11 on 2026-09-09. At 08:52 on
             * 2026-09-14 role 2184, this deployment's `runasrole`, was given
             * SRESTRICTDEPT "own, subordinate, and unassigned" together with
             * BRESTRICTEDITINGONLYONDEPT and BRESTRICTITEMSBYDEPT. "Own" resolves
             * to the EXECUTING USER's department, not the role's, so the same code
             * now succeeds or fails depending on who is signed in:
             *   employee 3293 Trader Hardwood  department 11  -> allowed
             *   employee 3136 House Blend 2    department  1  -> refused
             * Department 11 is `Trading : Hardwood`, parent 9, subsidiary 5, and
             * department 1 is Administration, so 11 is neither own nor subordinate
             * nor unassigned.
             *
             * Nothing was written: this is the save itself failing, so the order
             * does not exist. Reported as a refusal so the message reaches the
             * trader intact instead of as FAILED, which also tells them the order
             * MAY exist -- here it certainly does not. */
            if (/invalid field value/i.test(e.message || String(e)) &&
                /department/i.test(e.message || String(e))) {
                const dept = new Error(
                    'NetSuite refused department ' + departmentId() + ' on this order, so nothing ' +
                    'was written and the order does not exist. This is a PERMISSION on the role ' +
                    'this endpoint runs as, not a problem with the order: that role restricts ' +
                    'which departments it may use to the signed-in user’s own, and ' +
                    'the ARCH department is not one of them for this user. An administrator has ' +
                    'to lift the department restriction on that role. Moving the signed-in ' +
                    'employee into the ARCH department instead only works if they are already ' +
                    'in the same subsidiary as it, which most users are not. NetSuite ' +
                    'said: ' + (e.message || String(e)));
                dept.name = 'ARCH_ORDER_REFUSED';
                log.error('ARCH Order Create — department refused by the runasrole',
                    'department=' + departmentId() + ' | user=' + currentUserId() +
                    ' | NetSuite: ' + (e.message || String(e)) +
                    ' | THIS IS ROLE CONFIGURATION, NOT CODE. Check SRESTRICTDEPT / ' +
                    'BRESTRICTEDITINGONLYONDEPT on the deployment’s runasrole. MEASURED ' +
                    '2026-09-14: department 11 is scoped to subsidiary 5, so it CANNOT be put ' +
                    'on an employee outside that subsidiary, which rules out the ' +
                    'move-the-employee workaround for most users. Changing the runasrole is ' +
                    'NOT the fix either; see the runasrole note on this deployment.');
                throw dept;
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

        /* What the order's Sales Team actually holds, read back off the saved
         * record. Only when a team was named -- the single-rep path is what the
         * six orders this endpoint has already created prove, and re-reading it
         * would be a query per order for a question already answered.
         *
         * 🔴 ERROR level deliberately, on the same bar the assignment mismatch
         * sets: a commission split that did not land as intended on a trading
         * document is not routine noise. `verified: false` is NOT logged here --
         * `verifySalesTeam` already audits the unreadable case, and reporting
         * "could not tell" at error level is how a log fills up with lines nobody
         * can act on. */
        const teamCheck = namedTeam ? verifySalesTeam(soId, namedTeam) : null;
        if (teamCheck && teamCheck.mismatches.length) {
            log.error('ARCH Order Create — SALES TEAM MISMATCH on SO ' + soId,
                'The order was saved but its Sales Team is not the team that was requested ' +
                '("' + namedTeam.teamName + '"), so commission may be attributed to the wrong ' +
                'people: ' + teamCheck.mismatches.join('; ') +
                ' | stored: ' + teamCheck.stored.join(', '));
        }

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
        const saved = (function () {
            try {
                /* The CURRENCY rides along on the query that was already being run.
                 * `cur.symbol` is the ISO code, not the display name: BUILTIN.DF
                 * gives "US Dollar", which is a label and throws RangeError the
                 * moment it reaches a currency formatter. */
                const r = query.runSuiteQL({
                    query: 'SELECT t.tranid, t.custbody_mgsl_insurancerate AS rate, ' +
                           '       t.currency AS currencyid, cur.symbol AS currencycode ' +
                           'FROM transaction t ' +
                           'LEFT JOIN currency cur ON cur.id = t.currency ' +
                           'WHERE t.id = ?',
                    params: [soId],
                }).asMappedResults();
                if (!r.length) return { tranId: 'SO ' + soId, rate: null, currencyId: null, currencyCode: null };
                /* `numOr`, not `num`: this account renders a Percent below 0.001
                 * in exponent form and `num`'s regex /^-?\d+(\.\d+)?$/ rejects
                 * it. Measured 2026-09-03: SO-CWP-001344/45/46 read their own
                 * custbody_mgsl_insurancerate back as the string "3.0E-5". */
                return {
                    tranId: String(r[0].tranid),
                    rate: numOr(r[0].rate, null),
                    currencyId: r[0].currencyid ? String(r[0].currencyid) : null,
                    currencyCode: r[0].currencycode ? String(r[0].currencycode) : null,
                };
            } catch (e) {
                return { tranId: 'SO ' + soId, rate: null, currencyId: null, currencyCode: null };
            }
        }());
        const tranId = saved.tranId;

        /* What the ORDER carries, read back AFTER the save so sourcing has run.
         *
         * 🔴 This is the only reading that is true on BOTH paths. An append never
         * enters the create branch, so `effectiveRate` stayed null and `rateSource`
         * still said 'configuration' for an order that may carry anything: 11 open
         * production sales orders carry a rate other than the configured 0.003
         * today (10 at 0.015, 1 at 0.0015), and 16 active subsidiary-5 customers
         * are set to 0.015. The response understated the ops cost fivefold while
         * naming configuration as the source.
         *
         * SuiteQL returns a Percent as the stored FRACTION (0.015, not 1.5), which
         * is the unit `insuranceRate()` speaks, so nothing is scaled here. A null
         * rate leaves whichever branch ran to keep its own answer. */
        if (saved.rate !== null) {
            effectiveRate = saved.rate;
            /* On an append the source is not knowable after the fact -- the order
             * may have carried this rate before the append touched it -- so the
             * honest answer is the order itself. */
            if (appending) rateSource = 'order';
        }
        /* ── WHAT CURRENCY DID THIS ORDER ACTUALLY GET ──────────────────────
         *
         * 🔴 READ BACK, not assumed. Until 2026-09-16 the screen never sent a
         * currency at all, so NetSuite sourced it from the customer while the
         * trader priced, converted and quoted in whatever they had clicked. On a
         * CAD pick against a USD-primary customer that is a CA$6,500 quote billed
         * as US$6,500, 39% over at today's rate, and nothing in the response said
         * so. 47 active non-industrial customers carry more than one currency.
         *
         * The request now carries the id and the header sets it, so this should
         * always agree. "Should" is the reason to check: the one thing worse than
         * a currency mismatch is a currency mismatch nobody can see. Reported on
         * every order, so the confirmation can print what NetSuite actually used,
         * and logged at ERROR when it differs, because that is money.
         *
         * An APPEND sets no header field by design, so its order keeps its own
         * currency. Comparing it against what the screen believed is how a stale
         * tab gets caught: the wizard prices an append in the currency the order
         * carried when the list was fetched. */
        let currencyMismatch = null;
        if (saved.currencyCode) {
            /* ⚠️ From `input.header`, NOT from `h`. `h` is scoped to the create and
             * append branches above; reading it here threw `h is not defined` AFTER
             * the order had already been saved, so the first test order came back
             * reported as a failure it had not had. The header is the same object
             * either way, so this reads it from the one name that is in scope. */
            const reqHeader = (input && input.header) || {};
            const wanted = String(reqHeader.currency || '').toUpperCase();
            if (wanted && wanted !== saved.currencyCode.toUpperCase()) {
                currencyMismatch = { expected: wanted, actual: saved.currencyCode };
                log.error('ARCH Order — currency mismatch',
                    tranId + ' was created in ' + saved.currencyCode + ' but the screen priced it in ' +
                    wanted + '. Every figure the trader saw -- price, revenue, margin, the low-price ' +
                    'check -- is in ' + wanted + ' and the customer will be billed in ' +
                    saved.currencyCode + '. Check this order before it goes out.');
            }
        }

        /* The lots and the reman outcome are known HERE and nowhere else, so they
         * are passed rather than re-derived. Everything else in the email is read
         * back off the saved order. */
        const pdfMail = sendOrderPdf(soId, tranId, currentUserId(), appending, {
            lots: resolved.lines.map(function (l) { return l.lotName; }),
            remanRequested: wantsReman,
            remanStored: wantsReman && remanOk && lineWrites.every(function (w) { return w.reman; }),
        });

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
            /* Lines the warehouse will ACTUALLY be asked to split, not lines that
             * asked to be split. The confirmation dialog renders this as "N lines
             * queued for the warehouse to split", so counting intent here would
             * keep making that promise on an order where the marker never landed
             * -- which is precisely the failure the guard above exists to survive.
             * `lineWrites` is index-parallel to `resolved.lines`. */
            splitLinesQueued: resolved.lines.filter(
                (l, i) => l.isSplit && lineWrites[i] && lineWrites[i].split).length,
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
            remanStored: wantsReman && remanOk && lineWrites.every((w) => w.reman),
            /* Same contract for the split marker, and it carries further than the
             * reman note does: the marker is the ONLY thing that puts a bundle in
             * the warehouse queue, so `splitRequested && !splitStored` means the
             * stock is committed and nobody will ever be told to cut it. */
            splitRequested: wantsSplit,
            splitStored: wantsSplit && splitOk && lineWrites.every((w) => w.split),
            assignmentRows: check.assignmentRows,
            assignmentMismatches: check.mismatches,
            /* ── The Sales Team, reported rather than assumed ─────────────────
             *
             * Same contract as `remanStored` and `splitStored`, and for the same
             * reason: six separate notices in this app told traders a path did
             * not write to NetSuite long after it did, all because the claim was
             * hardcoded in the copy. Here the server says what happened.
             *
             * `salesTeamSource` is the one to branch on. 'rep' means the single
             * line from `resolveSalesRep`, which is the default and unchanged
             * behaviour; 'team' means the named team below was expanded onto the
             * sublist.
             *
             * ⚠️ `salesTeamVerified: false` means COULD NOT TELL, not "wrong".
             * See `verifySalesTeam`: this deployment's role may not be able to
             * read `transactionsalesteam` at all. A non-empty
             * `salesTeamMismatches` is the only statement that something IS
             * wrong. */
            salesTeamSource: namedTeam ? 'team' : 'rep',
            salesTeamId: namedTeam ? String(namedTeam.teamId) : null,
            salesTeamName: namedTeam ? namedTeam.teamName : null,
            salesTeamMembers: namedTeam
                ? namedTeam.members.map((m) => ({
                    id: String(m.id), name: m.name, contributionPct: m.pct,
                }))
                : [],
            /* Non-empty means an append reattributed commission that was already
             * on the order. The employee ids the order carried BEFORE this call,
             * so the change is recoverable from the response alone. */
            salesTeamPrevious: teamWrite ? teamWrite.previousEmployees : [],
            salesTeamReplaced: !!(teamWrite && teamWrite.previousEmployees.length),
            /* The two that make the difference above legible to a caller.
             * `salesTeamWritten` false with a non-null reason means the team was
             * understood, accepted and then deliberately not written. */
            salesTeamWritten: !!teamWrite,
            salesTeamIgnoredReason: teamIgnoredReason,
            salesTeamVerified: !!(teamCheck && teamCheck.verified),
            salesTeamMismatches: teamCheck ? teamCheck.mismatches : [],
            // Reported, not asserted — this is how the sign convention for a
            // sales order's assignments gets established on the first real write.
            storedSigns: check.storedSigns,
            /* The rate the ORDER carries, read back off the saved record, not the
             * one configuration holds.
             *
             * `insuranceRateSource` is only as precise as the create branch:
             * 'configuration' means that branch stamped the fallback, 'customer'
             * means it wrote nothing and left the field to NetSuite's sourcing.
             * On an APPEND it is always 'order' once the read-back returns a
             * value, and that is coarser than it looks: it covers an order that
             * already carried the rate AND one whose blank field this very call
             * just filled from the customer or from configuration. Do not read
             * 'order' as proof the value predates this request. When the
             * read-back returns nothing at all, an append still reports
             * 'configuration' and the configured rate, which is a statement
             * about configuration and not about the order.
             *
             * Any value different from the screen's own default means the margin
             * the trader saw is wrong by at least that difference. */
            insuranceRate: effectiveRate !== null ? effectiveRate : insuranceRate(),
            insuranceRateSource: rateSource,
            idempotencyKey: idempotencyKey,
            // Non-empty means the order exists but those bundles are NOT locked.
            lotsNotAttributed: unplaced,
            formWarning: wrongForm,
            /* What NetSuite actually stamped, so the confirmation states the order's
             * own currency rather than the screen's memory of it. Null only when the
             * read-back itself failed. */
            currency: saved.currencyCode,
            /* Non-null means the trader was quoted in one currency and the customer
             * will be billed in another. See the read-back above. */
            currencyMismatch: currencyMismatch,
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

        /* The named team, validated on the dry run too.
         *
         * 🔴 THIS IS THE ONLY PRE-FLIGHT A TEAM GETS, and it matters more than
         * the line checks around it: 6 of the 44 teams in this account hold a
         * member who is not flagged Sales Rep, and NetSuite answers that with an
         * opaque UNEXPECTED_ERROR out of `save` rather than a message. Without
         * this, a trader picking Chris/Tom would price the whole cart and then be
         * refused by a validation they could have been told about on the step that
         * owns the field.
         *
         * Reported as a problem rather than thrown, because a dry run's job is to
         * report.
         *
         * 🔴 THE MEMBERS MUST BE PASSED HERE TOO. `resolveSalesTeam` stopped
         * reading `entitygroup` on 2026-09-14 and now takes the member list from
         * its caller, so calling it with the id alone refuses with "was named
         * without its members" -- which the dry run would then report as a problem
         * with the ORDER. It fails only once the write switch is on, because the
         * switch is checked first and returns null, so an off-switch smoke test
         * looks clean. Ordinary unit tests miss it as well: they call
         * `resolveSalesTeam` directly and never come through here. */
        const teamProblems = [];
        const teamHeader = (input && input.header) || {};
        const teamRequest = teamHeader.salesTeamId;
        if (!(teamRequest === undefined || teamRequest === null ||
              String(teamRequest).trim() === '')) {
            try {
                resolveSalesTeam(teamRequest, teamHeader.salesTeamMembers,
                                 teamHeader.salesTeamName);
            } catch (e) {
                if (e.name !== 'ARCH_ORDER_REFUSED') throw e;
                teamProblems.push(e.message);
            }
        }

        const resolved = resolveLines(input.lines);
        const problems = teamProblems.concat(resolved.problems);
        return {
            ok: problems.length === 0,
            problems: problems,
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
     * So `split` is here as a CONTROL, but only in an account where the split
     * fields are deployed. In THIS sandbox they are, so it must read true, and a
     * false reading means the probe mechanism is broken rather than a missing
     * deploy. In PRODUCTION it will read false and be entirely correct: none of
     * the eight custcol_mgsl_* fields exist there (measured 2026-09-02). Check
     * whether the fields exist before concluding anything about the probe.
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
    /**
     * WHICH DEPARTMENT VALUES THIS DEPLOYMENT CAN ACTUALLY WRITE.
     *
     * 🔴 Added 2026-09-14, after a create failed on
     * "You have entered an Invalid Field Value 11 for the following field:
     * department" with every piece of stored data agreeing that 11 is right:
     * department 11 is `Trading : Hardwood`, subsidiary 5, active; the customer,
     * the location and the item are all subsidiary 5; role 2184 is scoped to
     * subsidiary 5 and holds LIST_DEPARTMENT. Reading more tables was not going
     * to settle it, so this asks the record.
     *
     * `record.create` writes NOTHING -- only `save` does -- so this is a plain
     * read under this deployment's own `runasrole`, which is the whole point:
     * the valid list is the EXECUTING role's, and no SuiteQL query run as
     * Administrator can show it. Same reasoning as the `salesTeam` probe above.
     *
     * The customer matters, because department options are filtered by the
     * order's subsidiary and the subsidiary is sourced from the customer, so the
     * probe takes one rather than guessing.
     */
    const diagnoseDepartment = (customerId) => {
        const out = {
            wanted: departmentId(),
            paramPresent: param('custscript_arch_department') !== null,
        };
        try {
            const so = record.create({ type: record.Type.SALES_ORDER, isDynamic: false });
            if (int(customerId)) {
                so.setValue({ fieldId: 'entity', value: int(customerId) });
                out.customerSet = int(customerId);
            }
            out.subsidiary = so.getValue({ fieldId: 'subsidiary' });
            /* 🔴 THE FORM IS THE OTHER HALF. `customform` is deliberately never
             * set by the create path, so the form comes from the EXECUTING role's
             * preference, and the form decides which fields are mandatory and what
             * they will accept. Role 2184 was edited on 2026-09-14 and a role save
             * can move that preference, which would change the form under us
             * without a line of code changing. Reported here so the form in play is
             * a fact rather than an assumption. */
            out.customform = so.getValue({ fieldId: 'customform' });
            out.location = so.getValue({ fieldId: 'location' });
            const fld = so.getField({ fieldId: 'department' });
            out.fieldFound = !!fld;
            if (fld) {
                out.mandatory = !!fld.isMandatory;
                /* ⚠️ THIS PROBE IS LEGACY AND IT ALWAYS FAILS. Kept, renamed, and
                 * documented rather than deleted, because its failure is the
                 * evidence for why `resolveDepartment` no longer works this way:
                 * `getSelectOptions` is not defined on a non-dynamic record, so
                 * the field cannot be asked what it will accept. Reading
                 * `legacyOptionsProbe` as "validation is broken" is the wrong
                 * conclusion -- `mapAllowed` below is the real check. */
                try {
                    const opts = fld.getSelectOptions({}) || [];
                    out.optionCount = opts.length;
                    out.options = opts.slice(0, 60).map((o) => String(o.value) + '=' + String(o.text));
                    out.wantedIsOffered = opts.some((o) => String(o.value) === String(out.wanted));
                } catch (e) {
                    out.legacyOptionsProbe = 'expected to fail on a non-dynamic record: ' +
                        (e.name || '') + ': ' + (e.message || String(e));
                }
            }
            /* 🔴 THE REAL VALIDATION, REPORTED SO IT CANNOT GO DEAD UNNOTICED.
             *
             * `resolveDepartment` checks `departmentsubsidiarymap` through
             * N/query. That query was written against REST SuiteQL, which is a
             * DIFFERENT DIALECT, so it could fail only once deployed -- exactly
             * how the previous implementation stayed broken while its guards
             * were green. Running the same query here means the health GET
             * answers "does validation work in production" without creating an
             * order. If `mapError` appears, the resolver is falling back to the
             * unvalidated path and the constant is the only thing protecting
             * order creation. */
            try {
                const mapRows = query.runSuiteQL({
                    query: 'SELECT department FROM departmentsubsidiarymap WHERE subsidiary = ?',
                    params: [int(out.subsidiary)],
                }).asMappedResults() || [];
                out.mapAllowed = mapRows.map((r) => int(r.department)).filter(function (v) { return !!v; });
                out.mapAllowsWanted = out.mapAllowed.indexOf(int(out.wanted)) !== -1;
                out.mapAllowsDefault = out.mapAllowed.indexOf(DEPARTMENT_DEFAULT) !== -1;
            } catch (e) {
                out.mapError = (e.name || '') + ': ' + (e.message || String(e));
            }
            /* The same call the create path makes, so a failure here is the
             * failure there, reported instead of thrown. */
            try {
                so.setValue({ fieldId: 'department', value: out.wanted });
                out.setOk = true;
                out.readBack = so.getValue({ fieldId: 'department' });
            } catch (e) {
                out.setOk = false;
                out.setError = (e.name || '') + ': ' + (e.message || String(e));
            }

            /* 🔴 DO NOT ADD A SAVE BACK HERE.
             *
             * A `probeDeptSave=T` branch lived here on 2026-09-14 and called
             * `so.save()` from this GET. It answered the question it was written
             * for -- `setValue` accepts a department the save then refuses, so
             * only a save tells the truth -- and it was deleted the same day.
             *
             * A GET that writes a transaction is a hazard however well gated:
             * browsers prefetch, links get shared and bookmarked, monitors poll
             * health URLs, and this one hardcoded a customer, an item and a
             * location, so every accidental hit left a junk order holding real
             * inventory. If the question comes up again, reproduce it through the
             * POST path against a throwaway order rather than here. */
        } catch (e) {
            out.error = (e.name || '') + ': ' + (e.message || String(e));
        }
        return out;
    };

    /* 🔴 READ-ONLY: WHAT THIS DEPLOYMENT'S runasrole CAN ACTUALLY SEE ════
     *
     * Feedback 9 items 6 and 8 both hinge on one unknown, and it cannot be read
     * from outside NetSuite. Marc-Antoine asked to feed customers, Sales Rep and
     * Sales Team from sub ARC, « Si possible de prendre les employés qui sont
     * attitrés à la Sub ARC ». Whether that is even reachable depends on what
     * role 2184 is scoped to, and:
     *
     *   - `listSalesReps` carries NO subsidiary predicate, yet the note above it
     *     records 15 reps measured live on 2026-08-25. CWP MTL has exactly 15
     *     active reps and the account has 32, so the ROLE is doing the filtering.
     *   - role 2184 is "MGSL - CWP MTL - Hardwood AP/AR Analyst", ACCOUNTCENTER,
     *     subsidiaryoption SELECTED. Which subsidiaries are selected is NOT
     *     readable: `rolesubsidiaries`, `rolesubsidiary` and `subsidiaryrole` are
     *     all invalid search types on this tenant.
     *   - the health GET authenticates as Administrator, so asking from there
     *     answers a different question.
     *
     * So the question has to be asked from INSIDE, which is what this does. It
     * writes nothing and returns ids and counts, never names beyond entityid.
     *
     * 🔴 `entityGroupControl` IS THE VALIDITY CHECK, NOT A CURIOSITY. `entitygroup`
     * is documented four times over as unreachable from this role, and granting
     * LIST_CRMGROUP changed nothing. So it MUST come back refused here. If it
     * reads, this probe is running with wider scope than the create path and every
     * other number in this object is answering the wrong question. Check that
     * field first; the rest is only meaningful when it says refused.
     */
    const roleVisibility = () => {
        const out = {};

        try {
            const u = runtime.getCurrentUser();
            out.reportedRole = u ? u.role : null;
        } catch (e) {
            out.reportedRole = 'ERROR: ' + (e.message || String(e));
        }

        // The list `listSalesReps` serves, broken down the way the answer needs.
        // 15 CWP MTL only means role-scoped; 32 across three subsidiaries means
        // this is running as Administrator and the control below will say so.
        try {
            out.repsBySubsidiary = query.runSuiteQL({
                query:
                    'SELECT BUILTIN.DF(e.subsidiary) AS sub, COUNT(*) AS n ' +
                    'FROM employee e ' +
                    "WHERE e.issalesrep = 'T' AND e.isinactive = 'F' " +
                    'GROUP BY BUILTIN.DF(e.subsidiary)',
            }).asMappedResults().map((r) => ({
                subsidiary: r.sub ? String(r.sub) : null,
                count: parseInt(r.n, 10) || 0,
            }));
        } catch (e) {
            out.repsBySubsidiary = 'ERROR: ' + (e.message || String(e));
        }

        /* The five ARCH traders BY ID, because a count cannot answer item 6.
         * Measured as Administrator on 2026-09-21: all five are issalesrep = T,
         * active, subsidiary ARC. If this comes back empty the role cannot see
         * them, and "prefer ARC employees" is not a filter change at all. */
        try {
            out.arcTradersVisible = query.runSuiteQL({
                query: 'SELECT id, entityid FROM employee ' +
                       'WHERE id IN (3268, 3296, 3297, 3298, 3299)',
            }).asMappedResults().map((r) => String(r.entityid || r.id));
        } catch (e) {
            out.arcTradersVisible = 'ERROR: ' + (e.message || String(e));
        }

        /* Item 8: « est-ce qu'on peut faire en sorte qu'il suive ce qu'il y a sur
         * la fiche client? ». `customersalesteam` is the sublist behind that, 634
         * rows account-wide and 264 ARC customers as Administrator, every one a
         * single employee at contribution 1. Readable from here or not is what
         * decides whether item 8 can be built the obvious way. */
        try {
            const cst = query.runSuiteQL({
                query: 'SELECT COUNT(*) AS n FROM customersalesteam',
            }).asMappedResults();
            out.customerSalesTeamRows = cst.length ? (parseInt(cst[0].n, 10) || 0) : 0;
        } catch (e) {
            out.customerSalesTeamRows = 'REFUSED: ' + (e.message || String(e));
        }

        // THE CONTROL. Must be refused. See the block header.
        try {
            query.runSuiteQL({ query: 'SELECT COUNT(*) AS n FROM entitygroup' })
                .asMappedResults();
            out.entityGroupControl =
                'READABLE — THIS PROBE IS NOT ROLE-SCOPED, IGNORE THE FIGURES ABOVE';
        } catch (e) {
            out.entityGroupControl = 'refused as expected (' +
                String(e.message || e).slice(0, 80) + ')';
        }

        return out;
    };

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
                /* ── What the Sales Team sublist will actually accept ─────────
                 *
                 * 🔴 THIS IS HERE TO SETTLE A QUESTION THAT COULD NOT BE
                 * SETTLED ANY OTHER WAY. Whether `contribution` can be written
                 * on a Sales Team line cannot be established read-only: SuiteQL
                 * shows what is STORED, and the `salesrole` precedent in this
                 * file is that a value read out of a saved record is not
                 * necessarily a value the API accepts. Proving it otherwise
                 * means creating a real sales order and attributing commission
                 * on it, which this task was not allowed to do.
                 *
                 * `record.create` writes NOTHING -- only `save` does -- so this
                 * asks the live account, under this deployment's own runasrole,
                 * on a plain GET. Call `suitelet.mjs script=6505 deploy=1` after
                 * deploying and read the answer instead of guessing at it.
                 *
                 * `contribution: false` means a multi-member team will be
                 * REFUSED rather than posted without its split, and that refusal
                 * is deliberate: see `writeSalesTeam`. */
                salesTeam: (function () {
                    try {
                        const st = so.getSublistFields({ sublistId: 'salesteam' }) || [];
                        return {
                            fields:       st,
                            employee:     st.indexOf('employee') !== -1,
                            contribution: st.indexOf('contribution') !== -1,
                            isprimary:    st.indexOf('isprimary') !== -1,
                            salesrole:    st.indexOf('salesrole') !== -1,
                        };
                    } catch (e) {
                        return { error: (e.name || '') + ': ' + (e.message || String(e)) };
                    }
                }()),
            };
        } catch (e) {
            return { error: (e.name || '') + ': ' + (e.message || String(e)) };
        }
    };

    return {
        createOrder: createOrder,
        validateOrder: validateOrder,
        fieldReadiness: fieldReadiness,
        diagnoseDepartment: diagnoseDepartment,
        listSalesReps: listSalesReps,
        listIncoterms: listIncoterms,
        getFxRate: getFxRate,
        getMillingRates: getMillingRates,
        // Exported for the test runner.
        resolveLines: resolveLines,
        verifyAssignments: verifyAssignments,
        sendOrderPdf: sendOrderPdf,
        resolveRepRecipients: resolveRepRecipients,
        pdfEmailReadiness: pdfEmailReadiness,
        roleVisibility: roleVisibility,
        chargeItemList: chargeItemList,
        resolveSalesTeam: resolveSalesTeam,
        writeSalesTeam: writeSalesTeam,
        verifySalesTeam: verifySalesTeam,
        setReadyToBuild: setReadyToBuild,
        verifyReadyToBuild: verifyReadyToBuild,
    };
});
