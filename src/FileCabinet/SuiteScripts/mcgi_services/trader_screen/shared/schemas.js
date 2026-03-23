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
        'mbfFactor', 'averageCost', 'detailKey',
    ];

    const META_FIELDS = [
        'cacheVersion', 'lastUpdated', 'rowCount',
        'lastRunMode', 'deltaCount', 'lastRunTimestamp',
    ];

    const DETAIL_BUCKETS = ['onHand', 'committed', 'outbound', 'onOrder', 'inTransit'];

    const DETAIL_ROW_SCHEMAS = {
        onHand: ['docType', 'docNum', 'docUrl', 'reloadId', 'poWoNumber', 'receiptDate', 'vendor', 'vendorUrl', 'lotNo', 'packQty', 'piecesPerPack', 'pricePerPiece', 'avgPrice'],
        committed: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'tranDate', 'expectedShipDate', 'packCommitted', 'piecesPerPack', 'pricePerPiece', 'rate'],
        outbound: ['docNum', 'docUrl', 'customerName', 'customerUrl', 'dueDate', 'packQty', 'piecesPerPack', 'pricePerPiece', 'rate'],
        onOrder: ['docNum', 'docUrl', 'vendorName', 'vendorUrl', 'shipDate', 'packQty', 'piecesPerPack', 'pricePerPiece', 'rate'],
        inTransit: ['docNum', 'docUrl', 'tranDate', 'vendor', 'vendorUrl', 'packQty', 'piecesPerPack', 'pricePerPiece', 'rate'],
    };

    return {
        SUMMARY_FIELDS,
        META_FIELDS,
        DETAIL_BUCKETS,
        DETAIL_ROW_SCHEMAS,
    };
});
