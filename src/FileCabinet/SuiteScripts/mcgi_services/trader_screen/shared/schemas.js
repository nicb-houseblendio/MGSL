/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Schema constants for TS_META, TS_SUMMARY, and TS_DETAIL contracts.
 *
 * IND and MTL share the same cache bucket but use different row shapes — the
 * MR files (mcgi_mr_trader_screen_cache.js for IND, mcgi_mr_trader_screen_cache_mtl.js
 * for MTL) are the authoritative source for each variant's exact fields. The lists
 * below are the consumer-facing contract for the union of fields available.
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

    // MTL detail rows (mcgi_mr_trader_screen_cache_mtl.js): richer per-row shape with
    // dedupe-by-line for committed/outbound. IND detail rows (mcgi_mr_trader_screen_cache.js):
    // simpler per-row shape, no dedupe. Consumers should treat the union as available
    // fields and tolerate either variant.
    const DETAIL_ROW_SCHEMAS = {
        // onHand row — per lot, aggregated across the lot's source transactions.
        // MTL fields: docType, docNumber, docUrl, poNumber, poUrl, date, vendor,
        //   vendorUrl, lotNumber, lotUrl, lotInternalId, tranId, tranType,
        //   packsOnHand, piecesPerPack, mbfPrice, currency, reloadId, segmentId,
        //   lotCost (added by applyLotCost)
        // IND fields: docType, docNum, docUrl, reloadId, poWoNumber, poWoUrl,
        //   receiptDate, vendor, vendorUrl, lotNo, lotInternalId, packQty,
        //   piecesPerPack, pricePerPiece, avgPrice, segmentId
        onHand: [
            // Union — see comments above for which variant emits what.
            'docType', 'docNumber', 'docNum', 'docUrl',
            'poNumber', 'poWoNumber', 'poUrl', 'poWoUrl',
            'date', 'receiptDate',
            'vendor', 'vendorUrl',
            'lotNumber', 'lotNo', 'lotUrl', 'lotInternalId',
            'tranId', 'tranType',
            'packsOnHand', 'packQty', 'piecesPerPack',
            'mbfPrice', 'pricePerPiece', 'avgPrice', 'currency',
            'reloadId', 'segmentId', 'lotCost',
        ],
        // committed row — per SO line (MTL is dedupeByLine'd; IND is per-lot fan).
        // MTL fields: docId, lineSeq, docNumber, docUrl, customer, customerUrl,
        //   soCreationDate, shipWeek, packsCommitted, piecesPerPack, mbfPrice,
        //   currency, allocatedPO, allocatedSegmentId, lotNumber, lotUrl (added later)
        // MTL also emits Transfer Order rows (committed at SOURCE location, spec
        //   2026-07-27): isTO=true, customer = "→ <destination location>", no
        //   customerUrl, packsCommitted = unfulfilled remainder.
        // IND fields: docId, lineSeq, docNum, docUrl, customerName, customerUrl,
        //   tranDate, expectedShipDate, packCommitted, piecesPerPack, pricePerPiece,
        //   rate, lotNumber, allocatedPO, allocatedSegmentId
        committed: [
            'docId', 'lineSeq', 'docNumber', 'docNum', 'docUrl',
            'customer', 'customerName', 'customerUrl',
            'soCreationDate', 'tranDate', 'shipWeek', 'expectedShipDate',
            'packsCommitted', 'packCommitted', 'piecesPerPack',
            'mbfPrice', 'pricePerPiece', 'rate', 'currency',
            'allocatedPO', 'allocatedSegmentId', 'lotNumber', 'lotUrl', 'isTO',
        ],
        // outbound row — per IF line (MTL is dedupeByLine'd; IND is per-lot fan).
        // MTL fields: docId, lineSeq, docNumber, docUrl, lotNumber, lotUrl, lotId,
        //   customer, customerUrl, invoicedDate, packs, piecesPerPack, mbfPrice,
        //   currency, allocatedPO, allocatedSegmentId
        // IND fields: docId, lineSeq, docNum, docUrl, customerName, customerUrl,
        //   dueDate, packQty, piecesPerPack, pricePerPiece, rate, lotNumber, lotId,
        //   allocatedPO, allocatedSegmentId
        outbound: [
            'docId', 'lineSeq', 'docNumber', 'docNum', 'docUrl',
            'customer', 'customerName', 'customerUrl',
            'invoicedDate', 'dueDate',
            'packs', 'packQty', 'piecesPerPack',
            'mbfPrice', 'pricePerPiece', 'rate', 'currency',
            'lotNumber', 'lotUrl', 'lotId',
            'allocatedPO', 'allocatedSegmentId',
        ],
        // onOrder row — per PO (grouped). Not consumed by PO Allocation under the
        // hybrid path (PO Allocation runs live getPoSegmentsForItem for unreceived).
        // MTL fields: docNumber, docUrl, vendor, vendorUrl, shipWeek, packs,
        //   piecesPerPack, mbfPrice, currency
        // IND fields: docNum, docUrl, vendorName, vendorUrl, shipDate, packQty,
        //   piecesPerPack, pricePerPiece, rate
        onOrder: [
            'docNumber', 'docNum', 'docUrl',
            'vendor', 'vendorName', 'vendorUrl',
            'shipWeek', 'shipDate',
            'packs', 'packQty', 'piecesPerPack',
            'mbfPrice', 'pricePerPiece', 'rate', 'currency',
        ],
        // inTransit row — per PO/TO transit. Not consumed by PO Allocation under
        // the hybrid path.
        // MTL fields: docNumber, docUrl, shipWeek, vendor, vendorUrl, packs,
        //   piecesPerPack, mbfPrice, currency
        // IND fields: docNum, docUrl, shipWeek, vendor, vendorUrl, packQty,
        //   piecesPerPack, pricePerPiece, rate
        inTransit: [
            'docNumber', 'docNum', 'docUrl',
            'shipWeek', 'vendor', 'vendorUrl',
            'packs', 'packQty', 'piecesPerPack',
            'mbfPrice', 'pricePerPiece', 'rate', 'currency',
        ],
    };

    return {
        SUMMARY_FIELDS,
        META_FIELDS,
        DETAIL_BUCKETS,
        DETAIL_ROW_SCHEMAS,
    };
});
