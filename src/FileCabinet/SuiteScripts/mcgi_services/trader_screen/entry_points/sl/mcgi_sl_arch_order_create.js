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
 * was retired on 2026-07-30. This deployment sets Execute-as-Role, so the write
 * lands whoever calls it, which then makes the authorisation check this script's
 * own responsibility rather than NetSuite's.
 *
 * 🔴 IT IS NOT ADMINISTRATOR, and these lines said it was until 2026-09-15.
 * Measured that day by `object:import`: `runasrole` is `customrole2184`, the
 * CWP MTL Hardwood AP/AR Analyst, and it is that role deliberately because the
 * executing role decides which SO form is used and only a form with Inventory
 * Detail enabled can carry a lot. Believing this ran as an administrator makes
 * every exposure argument in this file too pessimistic in one direction and too
 * relaxed in the other, so check the deployment before repeating it.
 *
 * ── The role check fails CLOSED, and that is the point ──────────────────────
 * Running as another role means the deployment audience is not a security
 * boundary on its own: whoever reaches the URL acts with role 2184's rights, not
 * their own. The audience has to stay wide enough for traders to load it, so the
 * real boundary for a WRITE is the allowlist below.
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
 *               salesRep, salesRepId, salesTeamId?, shipDate },
 *     lines: [ { itemId, locationId, lotId, qty, pricePerUnit,
 *                isSplit, splitTargetQty } ],
 *     insuranceRate?, dryRun? }
 *
 * ── 🔴 `header.salesTeamId` ATTRIBUTES COMMISSION, so read this first ───────
 * OPTIONAL and with no default. It is an `entitygroup` internal id as a string
 * (Setup > Sales Team, 44 active in this account), and sending one expands that
 * team's members and percentages onto the order's Sales Team sublist. OMIT IT
 * and the endpoint behaves exactly as before: one sublist line, resolved from
 * `salesRepId` / the caller / the customer's rep. There is no configured team
 * and no fallback team, for the same reason `custscript_arch_default_sales_rep`
 * is deliberately empty. Every member is validated first and a team with one
 * bad member is REFUSED WHOLE rather than posted in part -- 6 of the 44 teams
 * hold somebody who is not flagged Sales Rep, which NetSuite answers with an
 * opaque UNEXPECTED_ERROR out of `save`. See `resolveSalesTeam`.
 *
 * ⚠️ MGSL were told in writing that picking a team does not write yet ("on
 * attend ton feu vert avant de brancher l'ecriture", 2026-09-08). The endpoint
 * being able to honour a team is not permission for the screen to offer the
 * control.
 *
 * ── On an APPEND (`mode: 'existing'`) ──────────────────────────────────────
 * `salesRepId` and `salesRep` are IGNORED, deliberately and with the wizard
 * saying so. `salesTeamId` is honoured, because a template id cannot be
 * pre-filled from a saved order and is therefore a deliberate choice. Both
 * decisions are argued from measured data in `archOrderCreate.js`, in the
 * append branch.
 *
 * Quantities are DISPLAY units — board feet for Lumber, including the lot
 * assignment. NETSUITE does the converting, not the library; nothing here does
 * unit maths. Corrected 2026-09-02: this line used to say the library converts.
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
define([
    'N/runtime', 'N/log',
    './../../shared/archOrderCreate',
    /*
     * The ARCH service, required as a plain module so `action=customers` and
     * `action=salesTeams` can be answered from HERE, under this deployment's
     * runasrole, instead of from the RESTlet which runs as the caller.
     *
     * The same code runs either way. Nothing is moved and nothing is copied;
     * only the role executing it changes, and that is the entire defect.
     */
    './../../service/trader_screen_service_arch',
], (runtime, log, orderLib, archService) => {

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
        const isWrite = context.request.method !== 'GET';
        /** Developer diagnostics stay on the write list, which is where they were. */
        const mayDiagnose = allowed.indexOf(Number(user.role)) !== -1;

        /*
         * 🔴 THE ALLOWLIST GATES WRITES, NOT READS, and until 2026-09-15 it gated
         * both. That is Feedback 6 item 12: "Avec le user trader j'ai le message
         * d'erreur suivant: The incoterms list could not be read from NetSuite ...
         * Unexpected token '<' ... (ça fonctionne avec le rôle admin)". The
         * `<!DOCTYPE` is NetSuite's own page, served because the role was refused
         * before the GET branch was ever reached, and the wizard cannot complete an
         * order without incoterms. It has since come to gate the exchange rate and
         * the milling rates too, so the same refusal now silently un-converts a
         * margin as well as emptying a mandatory field.
         *
         * The split is not a relaxation of the boundary that matters. Creating a
         * sales order commits stock and attributes commission, so the write list
         * stays exactly as strict as it was. A GET writes nothing: it lists
         * incoterms, customers, reps, open orders, a currency rate and three
         * milling rates, and every write action is behind the POST guard further
         * down, not behind this one.
         *
         * ⚠️ What a read DOES cross is the runasrole, which is `customrole2184`
         * and NOT an administrator. So a role in the audience sees what that role
         * can see, whether or not its own permissions would allow it. That is a
         * real widening and a bounded one, which is why the audience is a named
         * list of the hardwood roles rather than all employees.
         */
        if (isWrite && allowed.indexOf(Number(user.role)) === -1) {
            /*
             * 🔴 AUDIT, NOT ERROR, and that changed the day the audience did.
             * While the audience and this allowlist named the same roles, a
             * refusal here meant somebody had reached a URL they could not reach,
             * which is worth an error. Since the audience was widened to 2182,
             * 2183 and 2184 while only 2182 may write, a refusal is an ORDINARY
             * outcome: a logistics coordinator ticking Ready to Build produces one
             * per click. This file's own rule further down says expected refusals
             * are audit, "the same mistake that once put hundreds of lines a day
             * into this account's log".
             */
            log.audit('ARCH Order Create',
                'Refused: user ' + user.id + ' role ' + user.role +
                ' is not in [' + allowed.join(',') + ']');
            return respond(context, 403, {
                ok: false,
                code: 'FORBIDDEN',
                /*
                 * Says what was refused rather than naming one action. The old
                 * wording was "not permitted to create orders", which is a strange
                 * thing to read after ticking a checkbox on the Open Sales Orders
                 * tab: `setReadyToBuild` comes through this same gate.
                 */
                error: 'Your role can open the ARCH screen but not change orders with it. ' +
                       'Ask an administrator to add it to the ARCH order roles.',
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

            /*
             * `customers`, proxied so the read happens under customrole2184 instead
             * of as the caller.
             *
             * MEASURED 2026-09-09, the same service call under three roles:
             *
             *                        visible   offered to the picker
             *   Administrator          806            465
             *   role 2181 (trader)      25             24
             *   role 2184 (here)       416            397
             *
             * Role 2181 is SALESCENTER with issalesrole=T. It holds LIST_CUSTJOB, so
             * nothing errors and the list is not empty -- NetSuite just narrows it to
             * the role's own customers. A trader who can sell to 24 of 806 cannot
             * work, and nothing on screen says why.
             *
             * ⚠️ 397 is NOT 465. Role 2184 is itself scoped, so this endpoint still
             * hides 68 of the customers an administrator sees. That is a 16x
             * improvement, not a fix, and it should not be described as one.
             *
             * 🔴 `salesTeams` is DELIBERATELY NOT PROXIED HERE. It was, until the
             * same measurement was taken: under 2184 the call fails outright with
             * `Record 'entitygroup' was not found`, because role 2184 holds NO group
             * permission at all, while 2181 does hold LIST_CRMGROUP. So proxying it
             * turns partial data (44 teams, 0 members) into total failure. It stays on
             * the RESTlet until 2184 is granted View on CRM Groups -- the same missing
             * permission that will refuse every team on the commission WRITE the
             * moment that latch is opened.
             *
             * `subsidiaryId` is passed straight through. The service decides what to
             * do with it; second-guessing it here is how the customers list once got
             * scoped to one subsidiary and hid 420 of them.
             */
            if (action === 'customers') {
                let out;
                try {
                    out = archService.getRouter({
                        action: action,
                        subsidiaryId: context.request.parameters.subsidiaryId,
                    });
                } catch (e) {
                    return respond(context, 200, {
                        ok: false,
                        service: 'arch-order-create',
                        action: action,
                        callerRole: user.role,
                        error: 'The ARCH service could not answer ' + action + ': ' +
                               (e.message || String(e)),
                    });
                }
                /* The service answers with `success`, this endpoint with `ok`. Both are
                 * carried so a client can branch on either and neither contract has to
                 * change. */
                return respond(context, 200, Object.assign({}, out, {
                    ok: out && out.success !== false,
                    service: 'arch-order-create',
                    action: action,
                    callerRole: user.role,
                }));
            }

            if (action === 'incoterms') {
                /* The wizard's Incoterms picker. Served from here rather than
                 * hardcoded in the bundle: it used to render three strings from
                 * a fixtures module, one of which does not exist in this account,
                 * and the field is mandatory -- so the wizard could not complete
                 * an order at all. See listIncoterms. */
                const ic = orderLib.listIncoterms();
                return respond(context, 200, {
                    ok: !ic.error,
                    service: 'arch-order-create',
                    action: 'incoterms',
                    callerRole: user.role,
                    count: ic.incoterms.length,
                    incoterms: ic.incoterms,
                    error: ic.error || undefined,
                });
            }

            if (action === 'equipment') {
                /* The wizard's Equipment picker, Feedback 10 item 1.
                 *
                 * Same shape and the same reasons as the incoterms handler above.
                 * ⚠️ One difference that matters downstream: equipment is
                 * OPTIONAL on the ARC form, so an empty list or an error here must
                 * not stop an order being created. The wizard is told so and simply
                 * leaves the field out. */
                const eq = orderLib.listEquipment();
                return respond(context, 200, {
                    ok: !eq.error,
                    service: 'arch-order-create',
                    action: 'equipment',
                    callerRole: user.role,
                    count: eq.equipment.length,
                    equipment: eq.equipment,
                    error: eq.error || undefined,
                });
            }

            if (action === 'fxRate') {
                /*
                 * The rate the Pricing step converts costs with, Feedback 6 item
                 * 10b. Read-only and cheap, and deliberately NOT folded into the
                 * customers payload: the rate depends on the SHIP DATE the trader
                 * types, which arrives long after the customer list has loaded.
                 */
                const fx = orderLib.getFxRate(
                    context.request.parameters.currency,
                    context.request.parameters.date
                );
                return respond(context, 200, {
                    ok: fx.rate !== null && fx.rate !== undefined,
                    service: 'arch-order-create',
                    action: 'fxRate',
                    callerRole: user.role,
                    rate: fx.rate,
                    quotedRate: fx.quotedRate,
                    source: fx.source,
                    target: fx.target,
                    asOf: fx.asOf,
                    effectiveDate: fx.effectiveDate,
                    via: fx.via,
                    error: fx.error || undefined,
                });
            }

            if (action === 'millingRates') {
                /* Item 10c: the split, cutting and planing rates as the record
                 * holds them, for the date the order will carry. Read-only. The
                 * client keeps its own constants and uses these only where a row
                 * is usable, so an empty or broken record changes no price. */
                const mr = orderLib.getMillingRates(context.request.parameters.date);
                return respond(context, 200, {
                    ok: !mr.error,
                    service: 'arch-order-create',
                    action: 'millingRates',
                    callerRole: user.role,
                    asOf: mr.asOf,
                    rates: mr.rates,
                    rows: mr.rows,
                    error: mr.error || undefined,
                });
            }

            /* 🔴 THE CUSTOMER'S OWN SALES TEAM, for the wizard's prefill.
             *
             * Marc-Antoine asked for the SO's Sales Team to follow the customer
             * record. The server half of that lives in `resolveSalesRep`, but it
             * is invisible on its own: the wizard always sends a rep, so the
             * customer leg never fires. This is what lets the SCREEN fill the
             * field the moment a customer is picked, which is the behaviour he
             * actually described.
             *
             * ⚠️ ON THE SUITELET, NEVER THE RESTLET, and for the same reason
             * `listSalesReps` was moved here. A RESTlet ignores `runasrole` and
             * runs as the CALLER, and the ARCH trader role cannot read `employee`
             * at all. The lookup joins `employee`, so on a RESTlet it would come
             * back empty for exactly the role that needs it.
             *
             * NOT gated on `mayDiagnose`. This is screen data, the same carve-out
             * `chargeItems` already has, not a diagnostic. */
            if (action === 'customerSalesTeam') {
                const cust = parseInt(context.request.parameters.customer, 10);
                const team = orderLib.customerSalesRep(cust);
                return respond(context, 200, {
                    ok: true,
                    service: 'arch-order-create',
                    action: 'customerSalesTeam',
                    customer: cust || null,
                    repId: team.repId,
                    repName: team.repName,
                    /* 'none' is a real answer, not a failure. 57 of the 321 active
                     * ARC customers carry no team row, and the trader picks for
                     * those exactly as they do today. */
                    source: team.source,
                });
            }

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

            /*
             * `openOrders`, proxied for the SAME reason as `customers` and with a
             * sharper cause. Marc-Antoine's item 5.b: under his own role the Open
             * Sales Orders tab returns NO orders at all.
             *
             * MEASURED 2026-09-09/10. Role 2181 is SALESCENTER with issalesrole=T,
             * so NetSuite narrows a transaction search to the role's OWN records.
             * Its only holder, employee 3293 `Trader Hardwood`, sits on ZERO
             * `transactionsalesteam` rows account-wide and reads issalesrep='F', and
             * all three customers on the open ARCH orders have `salesrep` NULL. So
             * that role's "own" set is EMPTY BY CONSTRUCTION -- the query succeeds,
             * returns nothing, and nothing anywhere errors. That silence is the
             * defect; the permissions all looked fine when they were checked.
             *
             * 2181 and 2184 hold the SAME TRAN_SALESORD (3) and TRAN_FIND (4). The
             * difference is not permission, it is centertype: 2184 is ACCOUNTCENTER
             * with issalesrole=F, so it is not narrowed to its own book.
             *
             * It is narrowed a DIFFERENT way. 2184 is subsidiaryoption=SELECTED and
             * demonstrably cannot see subsidiary 1 or 7 transactions, where 2181 was
             * subsidiaryoption=OWN. This trades one scope for another rather than
             * removing scope, and it is deliberately WIDER than the trader's own
             * role: the tab now shows every ARCH order in 2184's subsidiaries, not
             * only the trader's own. Same trade already accepted for the customer
             * list. Since 2026-09-22 `OPEN_ORDERS_SQL` DOES scope items to subsidiary
             * ARC (Feedback 14), so the tab is the intersection of that item scope
             * and the executing role's subsidiary scope: a role narrower than ARC
             * still hides orders, and nothing on the tab can tell.
             *
             * Unlike `salesTeams`, this one was checked BEFORE it shipped rather than
             * after. `handleGetOpenOrders` touches no `entitygroup`: the rep column
             * reads `transactionsalesteam`, and ADMI_TEAMSELLINGCONTRIBUTION is
             * level 4 on BOTH roles. That is why this is proxied and salesTeams,
             * twenty lines up, is not.
             */
            if (action === 'openOrders') {
                let out;
                try {
                    out = archService.getRouter({
                        action: action,
                        subsidiaryId: context.request.parameters.subsidiaryId,
                    });
                } catch (e) {
                    return respond(context, 200, {
                        ok: false,
                        service: 'arch-order-create',
                        action: action,
                        callerRole: user.role,
                        error: 'The ARCH service could not answer ' + action + ': ' +
                               (e.message || String(e)),
                    });
                }
                /* Same envelope as `customers`: the service answers with `success`,
                 * this endpoint with `ok`, and both are carried. The client REQUIRES
                 * `success === true` AND an `orders` array before it trusts this leg,
                 * because the health fall-through below is also `ok: true` and would
                 * otherwise read as an empty order list. */
                return respond(context, 200, Object.assign({}, out, {
                    ok: out && out.success !== false,
                    service: 'arch-order-create',
                    action: action,
                    callerRole: user.role,
                }));
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
                //
                // It also carries `salesTeam`, the Sales Team sublist's own
                // fields, which is the ONLY way to establish read-only whether
                // `contribution` can be written on a commission line. That
                // question decides whether a multi-member team is posted or
                // refused, so check it here after any deploy rather than
                // inferring it from stored data.
                lineFields: orderLib.fieldReadiness(),
                /* Read-only: which department values this deployment's runasrole
                 * is actually offered, and whether the one the create path writes
                 * is among them. `?probeDeptCustomer=<customer id>`, because the
                 * list is filtered by the order's subsidiary and that comes from
                 * the customer. Writes nothing. */
                /* 🔴 THE PROBE ARGUMENT IS ADMIN-ONLY SINCE 2026-09-15. These two
                 * diagnostics were written when this deployment's audience was
                 * Administrator alone. Opening GET to the hardwood roles promoted
                 * them, and they execute under `runasrole` 2184, which is wider
                 * than role 2183's own scope. They are developer tools, not screen
                 * data: the screen calls none of them. So the PROBE is gated on
                 * the write list while the readiness payload itself stays open,
                 * because `fetchWriteAuth` genuinely needs `role` and
                 * `permittedRoles` from it. */
                department: orderLib.diagnoseDepartment(
                    mayDiagnose ? (context.request.parameters || {}).probeDeptCustomer : null),
                /* Whether the order-confirmation email has a recipient, and of
                 * what kind. Reports the KINDS only, never the address. This is
                 * the only read-only way to tell an ABSENT parameter from an
                 * empty one: the runtime cannot, because param() turns a missing
                 * parameter into null. Check it here after any object deploy. */
                pdfEmail: orderLib.pdfEmailReadiness(),
                /* Feedback 9 item 10: the non-inventory charge items the Items
                 * step may offer, re-read from NetSuite so a label cannot drift
                 * from the record and an inactivated item stops being offered.
                 *
                 * NOT gated on `mayDiagnose`, unlike the probes around it: this
                 * one IS screen data. The wizard already calls this GET for
                 * `role` and `permittedRoles`, so the list rides along rather
                 * than needing a second round trip, and the server allowlist
                 * stays the single source of what may be added. */
                chargeItems: orderLib.chargeItemList(),
                /* Which of the five this account lacks. Empty in sandbox, and
                 * ['Freight Charges'] in production, where that is correct rather
                 * than broken. Reported as data so the absence is visible without
                 * a log line on every call. */
                chargeItemsMissing: orderLib.chargeItemsMissing(),
                /* Read-only, Feedback 9 items 6 and 8: what this deployment's
                 * runasrole can actually SEE. Gated on the write list like the
                 * other probes, because it is a developer tool and the screen
                 * calls none of them. Writes nothing.
                 *
                 * Read `entityGroupControl` FIRST: it must say refused, or this
                 * probe ran with wider scope than the create path and the rest of
                 * the object is answering the wrong question. */
                roleVisibility: mayDiagnose ? orderLib.roleVisibility() : undefined,
                /* Read-only probe: which sales reps SALESREP would mail for a given
                 * saved order. `?probeSo=<id>`, and it returns employee IDS only,
                 * never addresses.
                 *
                 * It exists because the send and the RESOLUTION cannot be tested
                 * together here. Sending is already proven live (SO-CWP-001360). But
                 * every active sales rep in this account has an MGSL or CWP mailbox,
                 * so actually exercising SALESREP would email a real MGSL employee
                 * from a sandbox, which is the exact harm the empty default guards
                 * against. This verifies the untested half and posts nothing. */
                repProbe: (function () {
                    // Same gate as the department probe above, and for the sharper
                    // reason: this one takes ANY transaction id with no scope check,
                    // which was acceptable while only an administrator could ask.
                    if (!mayDiagnose) return undefined;
                    const so = parseInt(context.request.parameters.probeSo, 10);
                    if (!so) return undefined;
                    return orderLib.resolveRepRecipients(so);
                }()),
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

        /* Dispatched BEFORE the order-creation shape checks below, which
         * require `lines`/`mode` this request does not carry — those two
         * requests are otherwise unrelated. Same allowlist gate as every
         * other action on this Suitelet; it already ran above this branch. */
        if (input.action === 'setReadyToBuild') {
            if (typeof input.soId === 'undefined' || typeof input.value !== 'boolean') {
                return respond(context, 400, {
                    ok: false, code: 'MISSING_FIELDS',
                    error: 'setReadyToBuild needs a soId and a boolean value.',
                });
            }
            try {
                const result = orderLib.setReadyToBuild(input.soId, input.value);
                const verify = orderLib.verifyReadyToBuild(input.soId, input.value);
                return respond(context, 200, {
                    ok: true,
                    soId: result.soId,
                    readyToBuild: result.readyToBuild,
                    verified: verify.verified,
                    verifiedMatches: verify.matches,
                });
            } catch (e) {
                const message = e.message || String(e);
                const expected = e.name === 'ARCH_ORDER_REFUSED';
                if (expected) {
                    log.audit('ARCH Order Create — setReadyToBuild',
                        'Refused for user ' + user.id + ': ' + message);
                } else {
                    log.error('ARCH Order Create — setReadyToBuild',
                        'Failed for user ' + user.id + ': ' + message +
                        (e.stack ? ' | ' + e.stack : ''));
                }
                return respond(context, expected ? 409 : 500, {
                    ok: false, code: expected ? 'REFUSED' : 'FAILED', error: message,
                });
            }
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
