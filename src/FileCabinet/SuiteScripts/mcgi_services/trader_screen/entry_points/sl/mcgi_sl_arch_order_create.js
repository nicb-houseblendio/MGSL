/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @description CWP ARCH sales-order creation — the only sanctioned write path.
 *
 * The trader screen's wizard POSTs a resolved cart here and this creates the
 * Sales Order, with each line carrying its lot in inventory detail so the bundle
 * leaves availability the moment the order is saved.
 *
 * ── Why a Suitelet and not a RESTlet ────────────────────────────────────────
 * A RESTlet runs as the calling user. A trader role cannot always write the
 * inventory detail an ARCH line needs, so a RESTlet drops those writes, and
 * sometimes silently. That failure mode hit PO Allocation twice and its RESTlet
 * was retired on 2026-07-30. This deployment runs Execute-as-Role =
 * Administrator so the write always lands, which then makes the authorisation
 * check this script's own responsibility rather than NetSuite's.
 *
 * ── The role check fails CLOSED, and that is the point ──────────────────────
 * Running as Administrator means the deployment audience is not a security
 * boundary — anyone who can reach the URL writes as an administrator. The
 * audience has to stay wide enough for traders to load it, so the real boundary
 * is the allowlist below.
 *
 * `custscript_arch_order_roles` holds the permitted role internal IDs, comma
 * separated. If it is empty or unset, ONLY Administrator passes. That default is
 * deliberate: an unconfigured deployment of a write endpoint must refuse
 * everyone rather than admit everyone. Sibling deployment 6495 currently sits at
 * allemployees=T, which is exactly the shape of mistake this guards against.
 *
 * Creating a sales order is a lower-privilege act than posting an inventory
 * adjustment, so this list will most likely end up wider than the split
 * endpoint's. It is a SEPARATE parameter for that reason: sharing one list would
 * force whoever widens this to also widen adjustment-posting rights.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * POST, JSON body:
 *   { mode: 'new' | 'existing',
 *     existingSO,                       // internal id, when mode is 'existing'
 *     header: { customerId, currencyId, termsId, customerPO, incoterms,
 *               salesRep, shipDate },
 *     lines: [ { itemId, locationId, lotId, qty, pricePerUnit,
 *                isSplit, splitTargetQty } ],
 *     insuranceRate?, dryRun? }
 *
 * Quantities are DISPLAY units — board feet for Lumber. The library converts to
 * NetSuite's stored base unit for the lot assignment; nothing here does unit
 * maths.
 *
 * `dryRun: true` validates against live stock and writes nothing. The wizard
 * uses it to catch a cart that went stale while the trader was pricing it.
 *
 * Replies { ok: true, ... } or { ok: false, error, code }. Never a raw stack —
 * the wizard shows the message verbatim to a trader, so it has to read as an
 * instruction.
 *
 * GET returns a small health payload and performs no writes. Useful for
 * confirming the deployment, the role allowlist and the executing user without
 * creating an order.
 */
define(['N/runtime', 'N/log', './../../shared/archOrderCreate'],
(runtime, log, orderLib) => {

    const ROLE_ADMINISTRATOR = 3;

    /** Role IDs permitted to create an ARCH order. Empty parameter = Administrator only. */
    const permittedRoles = () => {
        const raw = runtime.getCurrentScript().getParameter({ name: 'custscript_arch_order_roles' });
        const ids = String(raw || '')
            .split(',')
            .map((s) => parseInt(String(s).trim(), 10))
            .filter((n) => !isNaN(n));
        if (!ids.length) return [ROLE_ADMINISTRATOR];
        // Administrator always retains access so a misconfigured list cannot lock
        // out the person who has to fix it.
        if (ids.indexOf(ROLE_ADMINISTRATOR) === -1) ids.push(ROLE_ADMINISTRATOR);
        return ids;
    };

    /**
     * A Suitelet cannot set an HTTP status code — NetSuite answers 200 to
     * everything, including refusals. So the status is carried in the payload as
     * `status`, advisory only, and clients MUST branch on `ok` and `code`.
     *
     * The split endpoint learned this the hard way: an earlier version of that
     * field was called `httpStatus`, which invited a caller to check
     * response.status and read every error as success.
     */
    const respond = (context, status, payload) => {
        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        if (status) payload.status = status;
        context.response.write({ output: JSON.stringify(payload) });
    };

    const onRequest = (context) => {
        const user = runtime.getCurrentUser();
        const allowed = permittedRoles();

        if (allowed.indexOf(Number(user.role)) === -1) {
            log.error('ARCH Order Create',
                'Refused: user ' + user.id + ' role ' + user.role +
                ' is not in [' + allowed.join(',') + ']');
            return respond(context, 403, {
                ok: false,
                code: 'FORBIDDEN',
                error: 'Your role is not permitted to create orders from the trader screen. ' +
                       'Ask an administrator to add it.',
            });
        }

        if (context.request.method === 'GET') {
            /*
             * `action=salesReps` serves the wizard's sales-rep dropdown.
             *
             * It lives on this Suitelet rather than on the trader-screen RESTlet
             * because a RESTlet ignores `runasrole` and runs as the caller, and
             * the ARCH trader role cannot read the employee table. The dropdown
             * was therefore empty for the only role that needs it. Here the read
             * happens under `customrole2184`, the same role that validates the
             * rep on write, so the list cannot offer somebody the write path
             * then refuses. See `listSalesReps`.
             *
             * Anything else, including no action at all, keeps the original
             * health-check response untouched, because `suitelet.mjs script=6505
             * deploy=1` is the cheap way to prove the AMD graph resolves and to
             * read line-field readiness. Do not fold the two together.
             */
            const action = String(context.request.parameters.action || '');

            if (action === 'salesReps') {
                const reps = orderLib.listSalesReps();
                return respond(context, 200, {
                    ok: !reps.error,
                    service: 'arch-order-create',
                    action: 'salesReps',
                    /*
                     * The CALLER's role, which is NOT the role the list was read
                     * under. Measured 2026-08-25: a TBA GET as Administrator
                     * (role 3) reports callerRole 3 and still returns only the 15
                     * subsidiary-5 reps, with the single subsidiary-9 rep absent.
                     *
                     * So `runasrole` governs the data read while
                     * `getCurrentUser().role` keeps reporting the caller. Do not
                     * use this field to reason about what the read could see, and
                     * do not rename it back to something that implies it.
                     */
                    callerRole: user.role,
                    count: reps.salesReps.length,
                    salesReps: reps.salesReps,
                    error: reps.error || undefined,
                });
            }

            return respond(context, 200, {
                ok: true,
                service: 'arch-order-create',
                user: user.id,
                role: user.role,
                permittedRoles: allowed,
                rolesConfigured: allowed.length > 1,
                // Which line fields the writer can actually reach. `split` is a
                // control that must read true; see fieldReadiness.
                lineFields: orderLib.fieldReadiness(),
            });
        }

        if (context.request.method !== 'POST') {
            return respond(context, 405, {
                ok: false, code: 'METHOD', error: 'Use POST to create an order.',
            });
        }

        let input;
        try {
            input = JSON.parse(context.request.body || '{}');
        } catch (e) {
            return respond(context, 400, {
                ok: false, code: 'BAD_JSON', error: 'The request body was not valid JSON.',
            });
        }

        if (!Array.isArray(input.lines) || !input.lines.length) {
            return respond(context, 400, {
                ok: false, code: 'MISSING_FIELDS', error: 'The order has no lines.',
            });
        }

        if (input.mode !== 'new' && input.mode !== 'existing') {
            return respond(context, 400, {
                ok: false, code: 'MISSING_FIELDS',
                error: 'The order mode must be "new" or "existing".',
            });
        }

        try {
            if (input.dryRun) {
                const v = orderLib.validateOrder(input);
                return respond(context, v.ok ? 200 : 409, {
                    ok: v.ok,
                    dryRun: true,
                    code: v.ok ? undefined : 'STALE_CART',
                    error: v.ok ? undefined : v.problems.join(' '),
                    problems: v.problems,
                    lines: v.lines,
                });
            }

            const result = orderLib.createOrder(input);
            return respond(context, 200, result);

        } catch (e) {
            // Expected refusals — a bundle sold since the screen loaded, a lot
            // moved, an untagged item — are AUDIT, not ERROR. They are the
            // validation doing its job, and logging them as errors would bury the
            // real failures. That is the same mistake that once put hundreds of
            // lines a day into this account's log.
            //
            // Classified by NAME ONLY. An earlier version also pattern-matched
            // the message, which is the wrong direction for this rule: a genuine
            // system failure whose text happened to contain a word like "already"
            // would have been demoted to AUDIT and lost among routine refusals.
            // Every refusal the library raises now carries the name.
            const message = e.message || String(e);
            const expected = e.name === 'ARCH_ORDER_REFUSED';

            if (expected) {
                log.audit('ARCH Order Create', 'Refused for user ' + user.id + ': ' + message);
            } else {
                log.error('ARCH Order Create', 'Failed for user ' + user.id + ': ' + message +
                          (e.stack ? ' | ' + e.stack : ''));
            }
            return respond(context, expected ? 409 : 500, {
                ok: false,
                code: expected ? 'REFUSED' : 'FAILED',
                error: message,
            });
        }
    };

    return { onRequest: onRequest };
});
