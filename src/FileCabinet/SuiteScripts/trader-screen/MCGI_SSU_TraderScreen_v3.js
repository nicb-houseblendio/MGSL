/* eslint-disable quotes */
/* eslint-disable no-unused-vars */
/**
 *@NApiVersion 2.1
 *@NScriptType Suitelet
 */
// eslint-disable-next-line no-undef
define(['N/ui/serverWidget', 'N/search', 'N/url', 'N/record', 'N/log'], function (serverWidget, search, url, record, log) {
    const ITEM_DATA_SEARCH_ID = 'customsearch_suitelet_all_items_search';
    const MAX_RESULTS_PER_SEARCH_EXECUTION = 1000;
    const FILTER_PARAMS = {
        subsidiary: 'custpage_field_filters_subsidiary',
        reload: 'custpage_field_filters_reload',
        item: 'custpage_field_filters_item',
        greaterThanZero: 'custpage_field_filters_not_zero',
        category: 'custpage_field_filters_category',
        species: 'custpage_field_filters_species',
        thickness: 'custpage_field_filters_thickness',
        width: 'custpage_field_filters_width',
        length: 'custpage_field_filters_length',
        grade: 'custpage_field_filters_grade',
        finition: 'custpage_field_filters_finition',
        humdity: 'custpage_field_filters_humidity',
        plannage: 'custpage_field_filters_plannage',
        etampage: 'custpage_field_filters_etampage',
        autres: 'custpage_field_filters_autres'
    };
    const OFFSET = {offset: 'custpage_field_offset'};
    const SUITELET = {
        ON_HAND_SCRIPTID: 'customscript_mcgi_ssu_onhand',
        ON_HAND_DEPLOYID: 'customdeploy_mcgi_ssu_onhand',
        COMMITED_SCRIPTID: 'customscript_mcgi_ssu_commited',
        COMMITED_DEPLOYID: 'customdeploy_mcgi_ssu_commited',
        IN_TRANSIT_SCRIPTID: 'customscript_mcgi_ssu_intransit',
        IN_TRANSIT_DEPLOYID: 'customdeploy_mcgi_ssu_intransit',
        OUTBOUND_SCRIPTID: 'customscript_mcgi_ssu_outbound',
        OUTBOUND_DEPLOYID: 'customdeploy_mcgi_ssu_outbound',
        ON_ORDER_SCRIPTID: 'customscript_mcgi_ssu_onorder',
        ON_ORDER_DEPLOYID: 'customdeploy_mcgi_ssu_onorder'
    };

    const ITEM_RECORD_TYPE_MAPPING = {
        'Inventory Item': 'inventoryitem',
        Assembly: 'assemblyitem'
    };

    const MCGI_CUE_TRADERSCREEN = 'SuiteScripts/MCGI_CUE_TraderScreen_v2.js';
    function onRequest(context) {
        if (context.request.method === 'GET') {
            const form = getRequest(context);
            context.response.writePage(form);
        }

        if (context.request.method === 'POST') {
            return postRequest(context);
        }
    }

    function getRequest(context) {
        let form = serverWidget.createForm({
            title: 'Trader Screen v2'
        });
        form.clientScriptModulePath = MCGI_CUE_TRADERSCREEN;

        const params = context.request.parameters;
        log.debug('filter', params);
        form = addMainBody(form);
        form = addFilters(form, params);
        form = addItemSublists(form);
        const itemData = getItemData(params);
        form = populateSublist(form, itemData);
        log.debug('itemData', itemData);

        return form;
    }

    /**
     * This function validates whether a value is null or empty. It handles the following types:
     *      - String, Array, Object, Number, Boolean
     * The following is considered "empty":
     *      - String : ''
     *      - Array: []
     *      - Object: {}
     *
     * @governance 0 units
     * @param {Object} value - The variable to validate.
     * @returns {Boolean} true if the value passed is either null or empty, false if it is not null or empty.
     */
    function isNullOrEmpty(value) {
        if (value == null || value == undefined) {
            return true;
        } else if (Array.isArray(value) || typeof value === 'string' || value instanceof String) {
            return value.length == 0;
        } else if (typeof value === 'object' || value instanceof Object) {
            for (const key in value) {
                if (value.hasOwnProperty(key)) {
                    return false;
                }
            }

            return true && JSON.stringify(value) === JSON.stringify({});
        }

        return false;
    }

    /**
     * Safely retrieves all results from a NetSuite search using runPaged().
     * Returns an array of search.Result objects.
     */
    function getAllSearchResults(options) {
        if (!isNullOrEmpty(options)) {
            const searchObj = options.search;
            if (isNullOrEmpty(searchObj)) {
                return;
            }

            let allSearchResults = [];
            let searchResults = [];

            let startIndex = 0;
            let endIndex = MAX_RESULTS_PER_SEARCH_EXECUTION;
            const resultSet = searchObj.run();

            do {
                searchResults = resultSet.getRange({
                    start: startIndex,
                    end: endIndex
                }); //10 units per batch of 1,000 results

                startIndex = endIndex;
                endIndex += MAX_RESULTS_PER_SEARCH_EXECUTION;

                allSearchResults = allSearchResults.concat(searchResults);
            } while (searchResults.length >= MAX_RESULTS_PER_SEARCH_EXECUTION);

            return allSearchResults;
        }
    }

    function getItemData(params) {
        const itemData = [];
        const mySearch = search.load({
            id: ITEM_DATA_SEARCH_ID
        });

        const originalSearchFilterExpressionl = mySearch.filterExpression;

        const newFilterTwo = addFiltersToSearch(originalSearchFilterExpressionl, params);

        mySearch.filterExpression = newFilterTwo;

        const mySearchResults = getAllSearchResults({search: mySearch});

        let totalQuantity = 0,
            totalOnHand = 0,
            totalCommited = 0,
            totalOnOrder = 0,
            totalInTransit = 0,
            totalAvailable = 0,
            totalOutbound = 0;

        mySearchResults.forEach(function (result) {
            log.debug('result', result);
            const locationId = result.getValue({
                name: 'inventorylocation',
                summary: 'GROUP'
            });
            const locationName = result.getText({
                name: 'inventorylocation',
                summary: 'GROUP'
            });

            // Retrieve formula numeric values dynamically based on their labels
            const formulaValues = {};

            result.columns.forEach(function (column) {
                if (column.formula) {
                    // Ensure it's a formula column
                    const label = column.label.toLowerCase(); // Normalize label for matching

                    if (label === 'onhand') {
                        formulaValues.onHand = result.getValue(column);
                    }
                    if (label === 'commited') {
                        formulaValues.commited = result.getValue(column);
                    }
                    if (label === 'onorder') {
                        formulaValues.onOrder = result.getValue(column);
                    }
                    if (label === 'intransit') {
                        formulaValues.inTransit = result.getValue(column);
                    }
                    if (label === 'available') {
                        formulaValues.available = result.getValue(column);
                    }

                    if (label === 'outbound') {
                        formulaValues.outbound = result.getValue(column);
                    }
                }
            });

            const quantity =
                parseFloat(
                    result.getValue({
                        name: 'locationquantityonhand',
                        summary: 'GROUP'
                    })
                ) || 0;

            totalQuantity += quantity;
            totalOnHand += !isNaN(parseFloat(formulaValues.onHand)) ? parseFloat(formulaValues.onHand) : 0;
            totalCommited += !isNaN(parseFloat(formulaValues.commited)) ? parseFloat(formulaValues.commited) : 0;
            totalOnOrder += !isNaN(parseFloat(formulaValues.onOrder)) ? parseFloat(formulaValues.onOrder) : 0;
            totalInTransit += !isNaN(parseFloat(formulaValues.inTransit)) ? parseFloat(formulaValues.inTransit) : 0;
            totalAvailable += !isNaN(parseFloat(formulaValues.available)) ? parseFloat(formulaValues.available) : 0;
            totalOutbound += !isNaN(parseFloat(formulaValues.outbound)) ? parseFloat(formulaValues.outbound) : 0;

            const totalRowBuckets =
                parseFloat(formulaValues.onHand) +
                    parseFloat(formulaValues.commited) +
                    parseFloat(formulaValues.onOrder) +
                    parseFloat(formulaValues.inTransit) +
                    parseFloat(formulaValues.outbound) || 0;

            const itemDataObj = {
                internalId: result.getValue({name: 'internalid', summary: 'MAX'}),
                locationId: locationId,
                location: {
                    label: locationName,
                    url: getRecordUrl(locationId, record.Type.LOCATION)
                },
                itemName: result.getValue({name: 'salesdescription', summary: 'GROUP'}),
                itemCode: {
                    label: result.getValue({name: 'itemid', summary: 'GROUP'}),
                    url: getRecordUrl(
                        result.getValue({name: 'internalid', summary: 'MAX'}),
                        ITEM_RECORD_TYPE_MAPPING[result.getValue({name: 'type', summary: 'MAX'})]
                    ) // item internal id
                },
                quantity: roundToTwoDecimals(quantity).toFixed(2),
                onHand: roundToTwoDecimals(formulaValues.onHand).toFixed(0),
                commited: roundToTwoDecimals(formulaValues.commited).toFixed(0),
                onOrder: roundToTwoDecimals(formulaValues.onOrder).toFixed(0),
                inTransit: roundToTwoDecimals(formulaValues.inTransit).toFixed(0),
                available: roundToTwoDecimals(formulaValues.available).toFixed(0),
                averageCost: roundToTwoDecimals(
                    result.getValue({
                        name: 'locationaveragecost',
                        summary: 'GROUP'
                    })
                ).toFixed(2),
                outbound: roundToTwoDecimals(formulaValues.outbound).toFixed(0)
            };

            // Only filter if greaterThanZero is explicitly 'true'
            if (params[FILTER_PARAMS.greaterThanZero] === 'true' || !params[FILTER_PARAMS.greaterThanZero]) {
                if (totalRowBuckets > 0) {
                    itemData.push(itemDataObj);
                }
            } else {
                // Push all items if greaterThanZero is false or undefined
                itemData.push(itemDataObj);
            }
            return true;
        });

        // total row
        itemData.push({
            location: {
                label: 'Total'
            },
            quantity: roundToTwoDecimals(totalQuantity).toFixed(2),
            itemName: null,
            itemCode: null,
            onHand: roundToTwoDecimals(totalOnHand).toFixed(0),
            commited: roundToTwoDecimals(totalCommited).toFixed(0),
            onOrder: roundToTwoDecimals(totalOnOrder).toFixed(0),
            inTransit: roundToTwoDecimals(totalInTransit).toFixed(0),
            available: roundToTwoDecimals(totalAvailable).toFixed(0),
            outbound: roundToTwoDecimals(totalOutbound).toFixed(0)
        });

        return itemData;
    }

    function addFiltersToSearch(originalFilterExpression, filtersRequest) {
        const filters = originalFilterExpression;

        // Add subsidiary filter
        if (filtersRequest[FILTER_PARAMS.subsidiary]) {
            filters.push('AND', ['subsidiary', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.subsidiary])]);
        }

        // Add inventory location filter
        if (filtersRequest[FILTER_PARAMS.reload]) {
            filters.push('AND', ['inventorylocation', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.reload])]);
        }

        // Add item filter
        if (filtersRequest[FILTER_PARAMS.item]) {
            filters.push('AND', ['internalid', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.item])]);
        }

        // Handle greaterThanZero logic
        /* if (filtersRequest[FILTER_PARAMS.greaterThanZero] === 'true' || !filtersRequest[FILTER_PARAMS.greaterThanZero]) {
            filters.push('AND', [
                ['locationquantityonhand', 'greaterthan', '0'],
                'OR',
                ['formulanumeric', 'greaterthan', '0', '(({locationquantityonhand}*1000)/{custitem_mgsl_fbm})/{custitem_mgsl_ppp}'],
                'OR',
                [
                    'formulanumeric',
                    'greaterthan',
                    '0',
                    'CASE WHEN {inventorylocation} = {inventorynumber.location} AND {inventorynumber.inventorynumber} IS NOT NULL ' +
                        "AND {inventorylocation} = {transaction.location} AND {transaction.type} = 'Sales Order' " +
                        'AND ({transaction.custcol_mgsl_packqty}*{transaction.quantitycommitted}/{transaction.quantity}) > ' +
                        '({transaction.custcol_mgsl_packqty}*{transaction.quantityshiprecv}/{transaction.quantity}) ' +
                        'THEN {transaction.custcol_mgsl_packqty}*{transaction.quantitycommitted}/{transaction.quantity} END'
                ],
                'OR',
                [
                    'formulanumeric',
                    'greaterthan',
                    '0',
                    "CASE WHEN {inventorylocation} = {inventorynumber.location} AND {inventorynumber.inventorynumber} is not NULL AND {inventorylocation} = {transaction.location} AND {transaction.type} = 'Sales Order' AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))>(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0)) THEN (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))-(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0)) END"
                ],
                'OR',
                [
                    'formulanumeric',
                    'greaterthan',
                    '0',
                    "CASE WHEN {inventorylocation} = {inventorynumber.location} AND {inventorynumber.inventorynumber} is not NULL AND {inventorylocation} = {transaction.location} AND {transaction.type} = 'Sales Order' AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))>(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0)) THEN (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))-(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0)) END"
                ],
                'OR',
                [
                    'formulanumeric',
                    'greaterthan',
                    '0',
                    "CASE WHEN {inventorylocation} = {inventorynumber.location} AND {inventorynumber.inventorynumber} is not NULL AND {inventorylocation} = {transaction.location} AND {transaction.type} = 'Purchase Order' AND ((NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))>(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0))) THEN ((NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NVL({transaction.quantity},0))-(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NVL({transaction.quantity},0))) END"
                ],
                'OR',
                ['formulanumeric', 'greaterthan', '0', '(({locationquantityavailable}*1000)/{custitem_mgsl_fbm})/{custitem_mgsl_ppp}'],
                'OR',
                [
                    'formulanumeric',
                    'greaterthan',
                    '0',
                    '{locationaveragecost}*((({locationquantityonhand}*1000)/{custitem_mgsl_fbm})/{custitem_mgsl_ppp})/{locationquantityonhand}'
                ]
            ]);
        } */

        // Add thickness filter
        if (filtersRequest[FILTER_PARAMS.thickness]) {
            filters.push('AND', ['custitem_mgsl_thickness', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.thickness])]);
        }

        // Add width filter
        if (filtersRequest[FILTER_PARAMS.width]) {
            filters.push('AND', ['custitem_mgsl_width', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.width])]);
        }

        // Add length filter
        if (filtersRequest[FILTER_PARAMS.length]) {
            filters.push('AND', ['custitem_mgsl_length', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.length])]);
        }

        // Add grade filter
        if (filtersRequest[FILTER_PARAMS.grade]) {
            filters.push('AND', ['custitem_grade', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.grade])]);
        }

        // Add species filter
        if (filtersRequest[FILTER_PARAMS.species]) {
            filters.push('AND', ['custitem_species', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.species])]);
        }

        // Add finishing filter
        if (filtersRequest[FILTER_PARAMS.finition]) {
            filters.push('AND', ['custitem_finition', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.finition])]);
        }

        // Add humidity filter
        if (filtersRequest[FILTER_PARAMS.humdity]) {
            filters.push('AND', ['custitem_humidity', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.humdity])]);
        }
        // Add plannage filter
        if (filtersRequest[FILTER_PARAMS.plannage]) {
            filters.push('AND', ['custitem_plannage', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.plannage])]);
        }

        // Add etampage filter
        if (filtersRequest[FILTER_PARAMS.etampage]) {
            filters.push('AND', ['custitem_etampage', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.etampage])]);
        }
        // Add autres filter
        if (filtersRequest[FILTER_PARAMS.autres]) {
            filters.push('AND', ['custitem_autres', 'anyof', toIdArray(filtersRequest[FILTER_PARAMS.autres])]);
        }

        log.debug('filters', filters);

        return filters;
    }

    function toIdArray(value) {
        if (!value) {
            return null;
        }

        return value
            .toString()
            .split(',')
            .map((v) => Number(v.trim()))
            .filter((n) => !isNaN(n));
    }

    function addMainBody(form) {
        form.addButton({
            id: '_filter_button',
            label: 'Filter',
            functionName: 'button_FilterOrders'
        });

        return form;
    }
    function addItemSublists(form) {
        const sublist = form.addSublist({
            id: 'custpage_sublist_itemsublist',
            type: serverWidget.SublistType.LIST,
            label: 'List'
        });

        const reload = sublist.addField({
            id: 'custpage_field_reload',
            label: 'Reload',
            type: serverWidget.FieldType.TEXT
        });
        const itemCode = sublist.addField({
            id: 'custpage_field_item_code',
            label: 'Item Code',
            type: serverWidget.FieldType.TEXT
        });

        const itemName = sublist.addField({
            id: 'custpage_field_item_name',
            label: 'Item Description',
            type: serverWidget.FieldType.TEXT
        });
        const quantity = sublist.addField({
            id: 'custpage_field_quantity',
            label: 'Quantity (FBM)',
            type: serverWidget.FieldType.TEXT
        });
        const onHand = sublist.addField({
            id: 'custpage_field_on_hand',
            label: 'On Hand',
            type: serverWidget.FieldType.TEXT
        });
        const commited = sublist.addField({
            id: 'custpage_field_commited',
            label: 'Committed',
            type: serverWidget.FieldType.TEXT
        });
        const outbound = sublist.addField({
            id: 'custpage_field_outbound',
            label: 'outbound',
            type: serverWidget.FieldType.TEXT
        });

        const onOrder = sublist.addField({
            id: 'custpage_field_on_order',
            label: 'On Order',
            type: serverWidget.FieldType.TEXT
        });
        const inTransit = sublist.addField({
            id: 'custpage_field_in_transit',
            label: 'in Transit',
            type: serverWidget.FieldType.TEXT
        });
        const available = sublist.addField({
            id: 'custpage_field_available',
            label: 'Available',
            type: serverWidget.FieldType.TEXT
        });

        const averageCost = sublist.addField({
            id: 'custpage_field_average_cost',
            label: 'Average Cost',
            type: serverWidget.FieldType.TEXT
        });

        return form;
    }
    function truncateString(input) {
        const str = input.toString(); // Convert input to string

        if (str.length > 20) {
            return str.slice(0, 17) + '...';
        }
        return str;
    }

    function populateSublist(form, itemData) {
        const numberOfItems = itemData.length;
        const sublist = form.getSublist({
            id: 'custpage_sublist_itemsublist'
        });

        for (let i = 0; i < numberOfItems - 1; i++) {
            // last index is total
            if (itemData[i].location.url) {
                const locationURL = itemData[i].location.url;
                const locationDisplay = itemData[i].location.label;
                const locationLink = '<a href="' + locationURL + '" target="_blank" rel="noopener noreferrer">' + locationDisplay + '</a>';

                sublist.setSublistValue({
                    id: 'custpage_field_reload',
                    line: i,
                    value: locationLink
                });
            } else {
                sublist.setSublistValue({
                    id: 'custpage_field_reload',
                    line: i,
                    value: itemData[i].location.label
                });
            }
            if (itemData[i].itemCode) {
                const itemURL = itemData[i].itemCode.url;
                const itemDisplay = itemData[i].itemCode.label;
                const itemLink = '<a href="' + itemURL + '" target="_blank" rel="noopener noreferrer">' + itemDisplay + '</a>';

                sublist.setSublistValue({
                    id: 'custpage_field_item_code',
                    line: i,
                    value: itemLink
                });
            }

            sublist.setSublistValue({
                id: 'custpage_field_item_name',
                line: i,
                value: itemData[i].itemName ? itemData[i].itemName : 'no name'
            });
            sublist.setSublistValue({
                id: 'custpage_field_quantity',
                line: i,
                value: truncateString(itemData[i].quantity)
            });

            const onHandURL = url.resolveScript({
                scriptId: SUITELET.ON_HAND_SCRIPTID,
                deploymentId: SUITELET.ON_HAND_DEPLOYID,
                params: {
                    itemId: itemData[i].internalId,
                    locationId: itemData[i].locationId
                }
            });

            const onHandLink = '<a href="' + onHandURL + '" target="_blank" rel="noopener noreferrer">' + Math.round(itemData[i].onHand) + '</a>';

            sublist.setSublistValue({
                id: 'custpage_field_on_hand',
                line: i,
                value: onHandLink
            });

            const commitedURL = url.resolveScript({
                scriptId: SUITELET.COMMITED_SCRIPTID,
                deploymentId: SUITELET.COMMITED_DEPLOYID,
                params: {
                    itemId: itemData[i].internalId,
                    locationId: itemData[i].locationId
                }
            });

            const commitedLink =
                '<a href="' + commitedURL + '" target="_blank" rel="noopener noreferrer">' + Math.round(itemData[i].commited) + '</a>';

            sublist.setSublistValue({
                id: 'custpage_field_commited',
                line: i,
                value: commitedLink
            });

            const outboundURL = url.resolveScript({
                scriptId: SUITELET.OUTBOUND_SCRIPTID,
                deploymentId: SUITELET.OUTBOUND_DEPLOYID,
                params: {
                    itemId: itemData[i].internalId,
                    locationId: itemData[i].locationId
                }
            });

            const outboundLink =
                '<a href="' + outboundURL + '" target="_blank" rel="noopener noreferrer">' + Math.round(itemData[i].outbound) + '</a>';

            sublist.setSublistValue({
                id: 'custpage_field_outbound',
                line: i,
                value: outboundLink
            });

            const onOrderURL = url.resolveScript({
                scriptId: SUITELET.ON_ORDER_SCRIPTID,
                deploymentId: SUITELET.ON_ORDER_DEPLOYID,
                params: {
                    itemId: itemData[i].internalId,
                    locationId: itemData[i].locationId
                }
            });

            const onOrderLink = '<a href="' + onOrderURL + '" target="_blank" rel="noopener noreferrer">' + Math.round(itemData[i].onOrder) + '</a>';

            sublist.setSublistValue({
                id: 'custpage_field_on_order',
                line: i,
                value: onOrderLink
            });

            const inTransitURL = url.resolveScript({
                scriptId: SUITELET.IN_TRANSIT_SCRIPTID,
                deploymentId: SUITELET.IN_TRANSIT_DEPLOYID,
                params: {
                    itemId: itemData[i].internalId,
                    locationId: itemData[i].locationId
                }
            });

            const inTransitLink =
                '<a href="' + inTransitURL + '" target="_blank" rel="noopener noreferrer">' + Math.round(itemData[i].inTransit) + '</a>';

            sublist.setSublistValue({
                id: 'custpage_field_in_transit',
                line: i,
                value: inTransitLink
            });
            sublist.setSublistValue({
                id: 'custpage_field_available',
                line: i,
                value: Math.round(itemData[i].available)
            });

            sublist.setSublistValue({
                id: 'custpage_field_average_cost',
                line: i,
                value: itemData[i].averageCost || 0
            });
        }
        // populate total with the last index which is the total

        const quantityTotal = form.getField({
            id: 'custpage_field_quantity_total'
        });
        quantityTotal.defaultValue = itemData[numberOfItems - 1].quantity;

        const onHandTotal = form.getField({
            id: 'custpage_field_on_hand'
        });
        onHandTotal.defaultValue = itemData[numberOfItems - 1].onHand;

        const commitedTotal = form.getField({
            id: 'custpage_field_committed'
        });
        commitedTotal.defaultValue = itemData[numberOfItems - 1].commited;

        const outboundTotal = form.getField({
            id: 'custpage_field_outbound'
        });
        outboundTotal.defaultValue = itemData[numberOfItems - 1].outbound;

        const onOrderTotal = form.getField({
            id: 'custpage_field_on_order'
        });
        onOrderTotal.defaultValue = itemData[numberOfItems - 1].onOrder;

        const inTransitTotal = form.getField({
            id: 'custpage_field_in_transit'
        });
        inTransitTotal.defaultValue = itemData[numberOfItems - 1].inTransit;

        const availableTotal = form.getField({
            id: 'custpage_field_available'
        });
        availableTotal.defaultValue = itemData[numberOfItems - 1].available;

        return form;
    }
    function addFilters(form, params) {
        const fieldGroup_Filters = form.addFieldGroup({
            id: 'custpage_fieldgroup_filters',
            label: 'Filters'
        });

        const filterGreaterThanZero = form.addField({
            id: 'custpage_field_filters_not_zero',
            type: serverWidget.FieldType.CHECKBOX,
            label: 'Quantity greater than 0',
            container: 'custpage_fieldgroup_filters'
        });

        const filterSubsidiary = form.addField({
            id: 'custpage_field_filters_subsidiary',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Subsidiary',
            container: 'custpage_fieldgroup_filters'
        });

        filterSubsidiary.updateDisplaySize({
            height: 4,
            width: 250
        });

        // trim out and remove the parent hierarchy from the subsidiary name
        const subsidiarySearch = search.create({
            type: search.Type.SUBSIDIARY,
            columns: ['internalid', 'name'],
            filters: [['isinactive', 'is', 'F']]
        });

        subsidiarySearch.run().each((result) => {
            const id = result.getValue({name: 'internalid'});
            const fullName = result.getValue({name: 'name'});

            // Strip parent hierarchy from name
            const cleanName = fullName.split(':').pop().trim();

            filterSubsidiary.addSelectOption({
                value: id,
                text: cleanName
            });

            return true;
        });
        if (params[FILTER_PARAMS.subsidiary]) {
            filterSubsidiary.defaultValue = params[FILTER_PARAMS.subsidiary];
        }

        const filterReload = form.addField({
            id: 'custpage_field_filters_reload',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Warehouse (Reload)',
            container: 'custpage_fieldgroup_filters'
        });
        filterReload.updateDisplaySize({
            height: 3,
            width: 250
        });

        const locationSearch = search.create({
            type: search.Type.LOCATION,
            filters: [['locationtype', 'is', 2], 'AND', ['isinactive', 'is', 'F']],
            columns: ['internalid', 'name']
        });

        locationSearch.run().each(function (result) {
            filterReload.addSelectOption({
                value: result.getValue('internalid'),
                text: result.getValue('name')
            });
            return true;
        });

        if (params[FILTER_PARAMS.reload]) {
            const reloadParam = params[FILTER_PARAMS.reload];
            filterReload.defaultValue = reloadParam ? reloadParam.split(',') : []; //filter[FILTER_PARAMS.reload];
        }
        const filterItem = form.addField({
            id: 'custpage_field_filters_item',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Item',
            source: 'item',
            container: 'custpage_fieldgroup_filters'
        });
        filterItem.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        if (params[FILTER_PARAMS.item]) {
            const itemParam = params[FILTER_PARAMS.item];
            filterItem.defaultValue = itemParam ? itemParam.split(',') : []; //filter[FILTER_PARAMS.item];
        }

        if (params[FILTER_PARAMS.greaterThanZero]) {
            filterGreaterThanZero.defaultValue = params[FILTER_PARAMS.greaterThanZero] == 'false' ? 'F' : 'T';
        } else {
            filterGreaterThanZero.defaultValue = 'T';
        }

        const filterSpecies = form.addField({
            id: 'custpage_field_filters_species',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Espèce',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist_species'
        });
        filterSpecies.updateDisplaySize({
            height: 3,
            width: 250
        });
        if (params[FILTER_PARAMS.species]) {
            const speciesParam = params[FILTER_PARAMS.species];
            filterSpecies.defaultValue = speciesParam ? speciesParam.split(',') : []; //filter[FILTER_PARAMS.species];
        }
        const filterThickness = form.addField({
            id: 'custpage_field_filters_thickness',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Épaisseur',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist1585'
        });
        filterThickness.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        filterThickness.updateDisplaySize({
            height: 3,
            width: 170
        });

        if (params[FILTER_PARAMS.thickness]) {
            const thicknessParam = params[FILTER_PARAMS.thickness];
            filterThickness.defaultValue = thicknessParam;
        }
        const filterWidth = form.addField({
            id: 'custpage_field_filters_width',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Largeur',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist1587'
        });
        filterWidth.updateDisplaySize({
            height: 3,
            width: 170
        });

        if (params[FILTER_PARAMS.width]) {
            const widthParam = params[FILTER_PARAMS.width];
            filterWidth.defaultValue = widthParam ? widthParam.split(',') : []; //filter[FILTER_PARAMS.width];
        }
        const filterLength = form.addField({
            id: 'custpage_field_filters_length',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Longeur',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist1586'
        });

        filterLength.updateDisplaySize({
            height: 3,
            width: 170
        });

        if (params[FILTER_PARAMS.length]) {
            const lengthParam = params[FILTER_PARAMS.length];
            filterLength.defaultValue = lengthParam ? lengthParam.split(',') : []; //filter[FILTER_PARAMS.length];
        }
        const filterGrade = form.addField({
            id: 'custpage_field_filters_grade',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Grade',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist_grade'
        });
        filterGrade.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        filterGrade.updateDisplaySize({
            height: 3,
            width: 170
        });

        if (params[FILTER_PARAMS.grade]) {
            const gradeParam = params[FILTER_PARAMS.grade];
            filterGrade.defaultValue = gradeParam ? gradeParam.split(',') : []; //filter[FILTER_PARAMS.grade];
        }

        const filterFinition = form.addField({
            id: 'custpage_field_filters_finition',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Finition',
            container: 'custpage_fieldgroup_filters',
            source: 'customlistfinition'
        });
        filterFinition.updateDisplaySize({
            height: 3,
            width: 200
        });

        if (params[FILTER_PARAMS.finition]) {
            const finitionParam = params[FILTER_PARAMS.finition];
            filterFinition.defaultValue = finitionParam ? finitionParam.split(',') : [];
        }

        const filterHumidity = form.addField({
            id: 'custpage_field_filters_humidity',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Humidité',
            container: 'custpage_fieldgroup_filters',
            source: 'customlisthumidite'
        });
        filterHumidity.updateDisplaySize({
            height: 3,
            width: 200
        });
        if (params[FILTER_PARAMS.humdity]) {
            const humidityParam = params[FILTER_PARAMS.humdity];
            filterHumidity.defaultValue = humidityParam ? humidityParam.split(',') : [];
        }

        const filterPlannage = form.addField({
            id: 'custpage_field_filters_plannage',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Plannage',
            container: 'custpage_fieldgroup_filters',
            source: 'customlistplannage'
        });
        filterPlannage.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        filterPlannage.updateDisplaySize({
            height: 3,
            width: 200
        });

        if (params[FILTER_PARAMS.plannage]) {
            const plannageParam = params[FILTER_PARAMS.plannage];
            filterPlannage.defaultValue = plannageParam ? plannageParam.split(',') : [];
        }

        const filterEtampage = form.addField({
            id: 'custpage_field_filters_etampage',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Étampage',
            container: 'custpage_fieldgroup_filters',
            source: 'customlist2001'
        });
        filterEtampage.updateDisplaySize({
            height: 3,
            width: 200
        });

        if (params[FILTER_PARAMS.etampage]) {
            const etampageParam = params[FILTER_PARAMS.etampage];
            filterEtampage.defaultValue = etampageParam ? etampageParam.split(',') : [];
        }

        const filterAutres = form.addField({
            id: 'custpage_field_filters_autres',
            type: serverWidget.FieldType.MULTISELECT,
            label: 'Autres',
            container: 'custpage_fieldgroup_filters',
            source: 'customlistitemsattributesautres'
        });
        filterAutres.updateDisplaySize({
            height: 3,
            width: 170
        });
        filterAutres.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });

        if (params[FILTER_PARAMS.autres]) {
            const autresParam = params[FILTER_PARAMS.autres];
            filterAutres.defaultValue = autresParam ? autresParam.split(',') : [];
        }

        const offset = form.addField({
            id: 'custpage_field_offset',
            label: 'Offset',
            type: serverWidget.FieldType.TEXT
        });

        offset.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        if (params[OFFSET.offset]) {
            offset.defaultValue = params[OFFSET.offset];
        }

        const fieldGroup_total = form.addFieldGroup({
            id: 'custpage_fieldgroup_total',
            label: 'Total'
        });
        const quantityTotal = form.addField({
            id: 'custpage_field_quantity_total',
            type: serverWidget.FieldType.TEXT,
            label: 'Quantity (FBM)',
            container: 'custpage_fieldgroup_total'
        });
        quantityTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        quantityTotal.updateDisplaySize({
            height: 2,
            width: 10
        });
        quantityTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });

        const onHandTotal = form.addField({
            id: 'custpage_field_on_hand',
            type: serverWidget.FieldType.TEXT,
            label: 'On Hand',
            container: 'custpage_fieldgroup_total'
        });
        onHandTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        onHandTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        onHandTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });
        onHandTotal.updateDisplaySize({
            height: 2,
            width: 10
        });
        const committedTotal = form.addField({
            id: 'custpage_field_committed',
            type: serverWidget.FieldType.TEXT,
            label: 'Committed',
            container: 'custpage_fieldgroup_total'
        });
        committedTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        committedTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        committedTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });
        const outboundTotal = form.addField({
            id: 'custpage_field_outbound',
            type: serverWidget.FieldType.TEXT,
            label: 'Outbound',
            container: 'custpage_fieldgroup_total'
        });
        outboundTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        outboundTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        outboundTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });

        const onOrderTotal = form.addField({
            id: 'custpage_field_on_order',
            type: serverWidget.FieldType.TEXT,
            label: 'on order',
            container: 'custpage_fieldgroup_total'
        });
        onOrderTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        onOrderTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        onOrderTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });

        const inTransitTotal = form.addField({
            id: 'custpage_field_in_transit',
            type: serverWidget.FieldType.TEXT,
            label: 'in transit',
            container: 'custpage_fieldgroup_total'
        });
        inTransitTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        inTransitTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        inTransitTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });

        const availableTotal = form.addField({
            id: 'custpage_field_available',
            type: serverWidget.FieldType.TEXT,
            label: 'available',
            container: 'custpage_fieldgroup_total'
        });
        availableTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.DISABLED
        });
        availableTotal.updateBreakType({
            breakType: serverWidget.FieldBreakType.STARTCOL
        });
        availableTotal.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.INLINE
        });

        return form;
    }

    function roundToTwoDecimals(num) {
        if (isNaN(num)) {
            log.debug('roundToTwoDecimals', 'Input is not a number: ' + num);
            throw new Error('Input must be a number. value is ' + num);
        }

        const rounded = Math.round(num * 100) / 100; // Round to 2 decimal places
        return parseFloat(rounded.toFixed(2)); // Ensure it’s a float
    }

    function getRecordUrl(itemId, recordType) {
        const itemUrl = url.resolveRecord({
            recordType: recordType,
            recordId: itemId,
            isEditMode: false
        });
        return itemUrl;
    }

    // eslint-disable-next-line no-empty-function
    function postRequest(context) {}

    return {
        onRequest: onRequest
    };
});
