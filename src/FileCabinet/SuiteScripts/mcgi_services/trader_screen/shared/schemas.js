/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Schema constants for TS_META, TS_SUMMARY, and TS_DETAIL contracts.
 */
define([], () => {
    const SUMMARY_FIELDS = [
        'internalId', 'locationId', 'locationName', 'locationUrl', 'isReload',
        'itemType', 'itemCode', 'itemName', 'itemUrl',
        'species', 'thickness', 'width', 'length', 'grade',
        'finition', 'humidity', 'plannage', 'etampage', 'autres',
        'onHand', 'committed', 'outbound', 'onOrder', 'inTransit', 'available',
        'quantityFBM', 'averageCost', 'detailKey',
    ];

    const META_FIELDS = [
        'cacheVersion', 'lastUpdated', 'rowCount',
        'lastRunMode', 'deltaCount', 'lastRunTimestamp',
    ];

    const DETAIL_BUCKETS = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'];

    const DETAIL_ROW_SCHEMAS = {
        onHand: ['docType', 'docNum', 'docUrl', 'receiptDate', 'vendor', 'vendorUrl', 'lotNo', 'packQty', 'avgPrice'],
        committed: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'tranDate', 'expectedShipDate', 'itemCode', 'itemUrl', 'packCommitted', 'openPackQty', 'rate', 'pricePerPiece'],
        outbound: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'dueDate', 'itemCode', 'itemUrl', 'packQty', 'invoicedQty', 'remainingQty', 'rate'],
        onOrder: ['docNum', 'docUrl', 'vendorName', 'vendorUrl', 'shipDate', 'itemCode', 'itemUrl', 'packQty', 'openQty', 'rate'],
        inTransit: ['docNum', 'docUrl', 'tranDate', 'vendor', 'vendorUrl', 'itemCode', 'itemUrl', 'packQty', 'inTransitAdditional', 'rate'],
    };

    return {
        SUMMARY_FIELDS,
        META_FIELDS,
        DETAIL_BUCKETS,
        DETAIL_ROW_SCHEMAS,
    };
});
