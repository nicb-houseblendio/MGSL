# MGSL Trader Screen --- Phase 1

## Canonical Cache Contract

System Boundary: Map/Reduce → N/cache → RESTlet → React

------------------------------------------------------------------------

# 1. Contract Purpose

This document defines the immutable JSON contract between:

-   Map/Reduce (writer)
-   N/cache (storage)
-   RESTlet (reader)
-   React application (consumer)

Any change requires: - Schema version increment - Forced FULL rebuild -
Cache invalidation

------------------------------------------------------------------------

# 2. Cache Configuration

Cache Scope:

``` js
cache.getCache({
  name: 'MGSL_TRADERSCREEN_CACHE',
  scope: cache.Scope.PUBLIC
});
```

TTL (main keys): 1800 seconds\
Max TTL allowed: 86400 seconds\
Max value size per key: 500 KB

------------------------------------------------------------------------

# 3. Cache Keys

  ----------------------------------------------------------------------------------
  Key Pattern                             TTL           Description
  --------------------------------------- ------------- ----------------------------
  TS_META                                 1800s         Metadata about current cache
                                                        snapshot

  TS_SUMMARY                              1800s         Full grid dataset

  TS_DETAIL\_\_{itemId}\_\_{locationId}   1800s         Detail buckets per item ×
                                                        location

  TS_LAST_RUN_TIMESTAMP                   86400s        ISO timestamp for delta
                                                        window

  TS_SUMMARY_CHUNK\_\_\*                  1800s         Temporary reduce queue
                                                        chunks
  ----------------------------------------------------------------------------------

------------------------------------------------------------------------

# 4. TS_META Schema

Key: TS_META\
TTL: 1800 seconds

``` json
{
  "cacheVersion": 7,
  "lastUpdated": "2025-10-14T10:32:11.000Z",
  "rowCount": 312,
  "lastRunMode": "DELTA",
  "deltaCount": 14,
  "lastRunTimestamp": "2025-10-14T10:32:11.000Z"
}
```

Field Definitions:

  ------------------------------------------------------------------------
  Field              Type          Required               Notes
  ------------------ ------------- ---------------------- ----------------
  cacheVersion       number        Yes                    Incremented
                                                          every successful
                                                          run

  lastUpdated        ISO 8601      Yes                    UTC timestamp
                     string                               

  rowCount           number        Yes                    Count of
                                                          TS_SUMMARY rows

  lastRunMode        "FULL" \|     Yes                    Mode of last run
                     "DELTA"                              

  deltaCount         number \|     DELTA only             Number of
                     null                                 changed rows

  lastRunTimestamp   ISO 8601      Yes                    Used for next
                     string                               delta window
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# 5. TS_SUMMARY Schema

Key: TS_SUMMARY\
TTL: 1800 seconds\
Type: Array of objects

Each object represents one item × location.

``` json
{
  "internalId": "1042",
  "locationId": "3",
  "locationName": "MTL - Industriel",
  "locationUrl": "/app/setup/location.nl?id=3",
  "isReload": false,

  "itemType": "inventoryitem",
  "itemCode": "2x4x16-SPF-KD-STD",
  "itemName": "2x4 16ft SPF KD STANDARD",
  "itemUrl": "/app/accounting/items/item.nl?id=1042",

  "species": "SPF",
  "thickness": "2\"",
  "width": "4\"",
  "length": "16ft",
  "grade": "Standard",
  "finition": "KD",
  "humidity": "19%",
  "plannage": "",
  "etampage": "",
  "autres": "",

  "onHand": 142,
  "committed": 38,
  "outbound": 12,
  "onOrder": 80,
  "inTransit": 25,
  "available": 92,

  "quantityFBM": 28400,
  "averageCost": 485.00,

  "detailKey": "TS_DETAIL__1042__3"
}
```

Rules:

-   available = onHand - committed - outbound
-   All quantities stored in Packs
-   All URLs resolved server-side
-   detailKey format must be exact

------------------------------------------------------------------------

# 6. TS_DETAIL Schema

Key Pattern: TS_DETAIL\_\_{itemId}\_\_{locationId}

TTL: 1800 seconds

``` json
{
  "onHand": [],
  "committed": [],
  "outbound": [],
  "onOrder": [],
  "inTransit": []
}
```

------------------------------------------------------------------------

## OnHandRow

``` json
{
  "docType": "Item Receipt",
  "docNum": "REC-10245",
  "docUrl": "/app/accounting/transactions/itemrcpt.nl?id=50210",
  "receiptDate": "2025-09-15",
  "vendor": "Canfor Ltd.",
  "vendorUrl": "/app/accounting/vendor.nl?id=88",
  "lotNo": "LOT-2025-0912",
  "packQty": 40,
  "avgPrice": 482.50
}
```

------------------------------------------------------------------------

## CommittedRow

``` json
{
  "docNum": "SO-7821",
  "docUrl": "/app/accounting/transactions/salesord.nl?id=30881",
  "customerName": "Construction Leblanc Inc.",
  "customerUrl": "/app/accounting/customer.nl?id=441",
  "tranDate": "2025-10-01",
  "expectedShipDate": "2025-10-20",
  "itemCode": "2x4x16-SPF-KD-STD",
  "itemUrl": "/app/accounting/items/item.nl?id=1042",
  "packCommitted": 10,
  "openPackQty": 10,
  "rate": 510.00,
  "pricePerPiece": 5.10
}
```

------------------------------------------------------------------------

## OutboundRow

``` json
{
  "docNum": "FULFILL-4412",
  "docUrl": "/app/accounting/transactions/itemship.nl?id=44120",
  "customerName": "Matériaux Dupont",
  "customerUrl": "/app/accounting/customer.nl?id=302",
  "dueDate": "2025-10-18",
  "itemCode": "2x4x16-SPF-KD-STD",
  "itemUrl": "/app/accounting/items/item.nl?id=1042",
  "packQty": 12,
  "invoicedQty": 0,
  "remainingQty": 12,
  "rate": 508.00
}
```

------------------------------------------------------------------------

## OnOrderRow

``` json
{
  "docNum": "PO-3391",
  "docUrl": "/app/accounting/transactions/purchord.nl?id=33910",
  "vendorName": "Canfor Ltd.",
  "vendorUrl": "/app/accounting/vendor.nl?id=88",
  "shipDate": "2025-11-05",
  "itemCode": "2x4x16-SPF-KD-STD",
  "itemUrl": "/app/accounting/items/item.nl?id=1042",
  "packQty": 80,
  "openQty": 80,
  "rate": 478.00
}
```

------------------------------------------------------------------------

## InTransitRow

``` json
{
  "docNum": "PO-3305",
  "docUrl": "/app/accounting/transactions/purchord.nl?id=33050",
  "tranDate": "2025-10-05",
  "vendor": "Resolute Forest Products",
  "vendorUrl": "/app/accounting/vendor.nl?id=91",
  "itemCode": "2x4x16-SPF-KD-STD",
  "itemUrl": "/app/accounting/items/item.nl?id=1042",
  "packQty": 25,
  "inTransitAdditional": 0,
  "rate": 475.00
}
```

------------------------------------------------------------------------

# 7. Delta Rules

Delta selection: lastmodifieddate \>= TS_LAST_RUN_TIMESTAMP

Transaction types: - Purchase Order - Sales Order - Item Receipt - Item
Fulfillment - Inventory Adjustment - Transfer Order

Fallback to FULL if distinct item×location pairs exceed threshold.

------------------------------------------------------------------------

# 8. Payload Size Rules

Max per cache value: 500 KB

If exceeded: Option A (preferred): split by bucket\
Option B: prune non-essential detail fields (never summary fields)

------------------------------------------------------------------------

# 9. Invariants

-   RESTlet GET never executes a search
-   Suitelet shell never executes a search
-   URLs pre-resolved
-   Quantities stored in Packs
-   UOM conversion client-side only

------------------------------------------------------------------------

# 10. Versioning Policy

If schema changes: 1. Increment schemaVersion 2. Force FULL rebuild 3.
Invalidate TS_SUMMARY and TS_DETAIL keys

------------------------------------------------------------------------

End of Canonical Cache Contract
