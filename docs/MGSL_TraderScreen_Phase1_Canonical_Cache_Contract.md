# MGSL Trader Screen --- Phase 1

## Canonical Cache Contract

This document defines the immutable cache schema between: Map/Reduce →
N/cache → RESTlet → React

------------------------------------------------------------------------

## Cache Keys

-   TS_META (TTL 1800s)
-   TS_SUMMARY (TTL 1800s)
-   TS_DETAIL\_\_{itemId}\_\_{locationId} (TTL 1800s)
-   TS_LAST_RUN_TIMESTAMP (TTL 86400s)

Max value size: 500 KB per key.

------------------------------------------------------------------------

## TS_META Schema

{ "cacheVersion": number, "lastUpdated": "ISO_8601", "rowCount": number,
"lastRunMode": "FULL" \| "DELTA", "deltaCount": number \| null,
"lastRunTimestamp": "ISO_8601" }

------------------------------------------------------------------------

## TS_SUMMARY Schema

Array of:

{ "internalId": string, "locationId": string, "locationName": string,
"itemType": string, "itemCode": string, "itemName": string, "onHand":
number, "committed": number, "outbound": number, "onOrder": number,
"inTransit": number, "available": number, "quantityFBM": number,
"averageCost": number, "detailKey": string }

available = onHand - committed - outbound

------------------------------------------------------------------------

## TS_DETAIL Schema

{ "onHand": \[\], "committed": \[\], "outbound": \[\], "onOrder": \[\],
"inTransit": \[\] }

Detail buckets must match saved search outputs exactly.
