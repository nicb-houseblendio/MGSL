/**
 * Saved Search: customsearch_suitelet_all_items_search
 * Purpose: Main item data search for Trader Screen summary rows.
 *          Used in Map/Reduce getInputData to build TS_SUMMARY cache.
 *
 * Referenced by: mcgi_mr_trader_screen_cache.js (ITEM_DATA_SEARCH_ID)
 *
 * Expected summary columns (per SDD v1.3 §3.4):
 *   GROUP: inventorylocation, itemid, salesdescription, locationquantityonhand, locationaveragecost
 *   MAX:   internalid, type, custitem_species, custitem_mgsl_thickness, custitem_mgsl_width,
 *          custitem_mgsl_length, custitem_grade, custitem_finition, custitem_humidity,
 *          custitem_plannage, custitem_etampage, custitem_autres
 *   FORMULA columns: onHand, commited, onorder, intransit, available, outbound
 *
 * Last updated: <PASTE DATE HERE>
 * Exported from NetSuite via: Lists > Search > Saved Searches > Export as Script
 *
 * ──────────────────────────────────────────────────────────────────
 * PASTE EXPORTED SCRIPT BELOW THIS LINE
 * ──────────────────────────────────────────────────────────────────
 */
/** @NApiVersion 2.1 */
const itemSearchObj = search.create({
    type: "item",
    filters:
        [
            ["type","anyof","Assembly","InvtPart"],
            "AND",
            ["transaction.quantity","notequalto","0"],
            "AND",
            ["formulanumeric: CASE WHEN ({transaction.type} = 'Transfer Order' AND {inventorylocation} = {transaction.transferlocation}) OR ({transaction.type} != 'Transfer Order' AND {inventorylocation} = {transaction.location}) THEN 1 ELSE 0 END","equalto","1"],
            "AND",
            ["transaction.custcol_mgsl_packqty","isnotempty",""]
        ],
    columns:
        [
            search.createColumn({
                name: "inventorylocation",
                summary: "GROUP",
                label: "Reload"
            }),
            search.createColumn({
                name: "custrecord_is_reload",
                join: "inventoryLocation",
                summary: "GROUP",
                label: "Is Reload"
            }),
            search.createColumn({
                name: "itemid",
                summary: "GROUP",
                label: "Item Code"
            }),
            search.createColumn({
                name: "displayname",
                summary: "GROUP",
                label: "Item Name"
            }),
            search.createColumn({
                name: "salesdescription",
                summary: "GROUP",
                label: "Item Description"
            }),
            search.createColumn({
                name: "locationquantityonhand",
                summary: "GROUP",
                label: "Quantity (FBM)"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "CASE     WHEN         (             /* Incoming quantity */             SUM(                 CASE                     WHEN {inventorylocation} = {transaction.location}                          AND (                              {transaction.type} = 'Item Receipt'                              OR (                                  {transaction.type} = 'Inventory Adjustment'                                  AND {transaction.quantity} > 0                              )                              OR ({transaction.type} = 'Credit Memo')                          )                     THEN NVL({transaction.custcol_mgsl_packqty}, 0)                     ELSE 0                 END             )             -             /* Outgoing quantity */             SUM(                 CASE                     WHEN {inventorylocation} = {transaction.location}                          AND (                              ({transaction.type} = 'Item Fulfillment'                               AND {transaction.status} = 'Shipped')                              OR (                                  {transaction.type} = 'Inventory Adjustment'                                  AND {transaction.quantity} < 0                              )                          )                     THEN ABS(NVL({transaction.custcol_mgsl_packqty}, 0))                     ELSE 0                 END             )         ) <= 0     THEN 0     ELSE         (             /* Incoming quantity */             SUM(                 CASE                     WHEN {inventorylocation} = {transaction.location}                          AND (                              {transaction.type} = 'Item Receipt'                              OR (                                  {transaction.type} = 'Inventory Adjustment'                                  AND {transaction.quantity} > 0                              )                              OR ({transaction.type} = 'Credit Memo')                          )                     THEN NVL({transaction.custcol_mgsl_packqty}, 0)                     ELSE 0                 END             )             -             /* Outgoing quantity */             SUM(                 CASE                     WHEN {inventorylocation} = {transaction.location}                          AND (                              ({transaction.type} = 'Item Fulfillment'                               AND {transaction.status} = 'Shipped')                              OR (                                  {transaction.type} = 'Inventory Adjustment'                                  AND {transaction.quantity} < 0                              )                          )                     THEN ABS(NVL({transaction.custcol_mgsl_packqty}, 0))                     ELSE 0                 END             )         ) END",
                label: "onHand"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "SUM(CASE WHEN {inventorylocation} = {transaction.location} AND {transaction.type} = 'Sales Order' AND {transaction.closed} = 'F' AND   (NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantity}-{transaction.quantitybilled})/NULLIF({transaction.quantity},0))> (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantityshiprecv}/NULLIF({transaction.quantity},0))    THEN (NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantity}-{transaction.quantitybilled})/ NULLIF({transaction.quantity},0)) ELSE 0 END)",
                label: "commited"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "SUM(CASE WHEN {inventorylocation} = {transaction.location} AND {transaction.type} = 'Sales Order' AND {transaction.closed} = 'F' AND (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantitybilled}/NULLIF({transaction.quantity},0))> (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantityshiprecv}/NULLIF({transaction.quantity},0)) THEN (NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantitybilled}-{transaction.quantityshiprecv})/ NULLIF({transaction.quantity},0)) ELSE 0 END)	",
                label: "outbound"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "SUM(CASE WHEN {inventorylocation} = {transaction.location}  AND {transaction.type} = 'Purchase Order'  AND {transaction.closed} = 'F' AND  NVL({transaction.custcol_mgsl_packqty},0)>(NVL({transaction.custcol_mgsl_packqty},0)*(NVL({transaction.quantityshiprecv},0))/NULLIF({transaction.quantity},0))   AND (NVL({transaction.custcol_mgsl_packqty},0)*(NVL({transaction.quantityshiprecv},0))/NULLIF({transaction.quantity},0))>=(NVL({transaction.custcol_mgsl_packqty},0)*(NVL({transaction.quantitybilled},0))/NULLIF({transaction.quantity},0))   THEN (NVL({transaction.custcol_mgsl_packqty},0)-(NVL({transaction.custcol_mgsl_packqty},0)*(NVL({transaction.quantityshiprecv},0))/NULLIF({transaction.quantity},0))) ELSE 0 END)",
                label: "onOrder"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "SUM(CASE WHEN (({transaction.type} = 'Purchase Order' AND {inventorylocation} = {transaction.location}) OR ({transaction.type} = 'Transfer Order' AND {inventorylocation} = {transaction.transferlocation})) AND {transaction.closed} = 'F' AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0))>(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0))>(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) THEN ((NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0))-(NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0))) ELSE 0 END)",
                label: "inTransit"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "( CASE WHEN ( (SUM(CASE WHEN {inventorylocation}={transaction.location} AND ({transaction.type}='Item Receipt' OR ({transaction.type}='Inventory Adjustment' AND {transaction.quantity}>0)) THEN NVL({transaction.custcol_mgsl_packqty},0) ELSE 0 END)) - (SUM(CASE WHEN {inventorylocation}={transaction.location} AND (({transaction.type}='Item Fulfillment' AND {transaction.status}='Shipped') OR ({transaction.type}='Inventory Adjustment' AND {transaction.quantity}<0)) THEN ABS(NVL({transaction.custcol_mgsl_packqty},0)) ELSE 0 END)) ) <= 0 THEN 0 ELSE ( (SUM(CASE WHEN {inventorylocation}={transaction.location} AND ({transaction.type}='Item Receipt' OR ({transaction.type}='Inventory Adjustment' AND {transaction.quantity}>0)) THEN NVL({transaction.custcol_mgsl_packqty},0) ELSE 0 END)) - (SUM(CASE WHEN {inventorylocation}={transaction.location} AND (({transaction.type}='Item Fulfillment' AND {transaction.status}='Shipped') OR ({transaction.type}='Inventory Adjustment' AND {transaction.quantity}<0)) THEN ABS(NVL({transaction.custcol_mgsl_packqty},0)) ELSE 0 END)) ) END ) + ( SUM(CASE WHEN {inventorylocation}={transaction.location} AND {transaction.type}='Sales Order' AND {transaction.closed}='F' AND (NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantity}-{transaction.quantitybilled})/NULLIF({transaction.quantity},0)) > (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantityshiprecv}/NULLIF({transaction.quantity},0)) THEN NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantity}-{transaction.quantitybilled})/NULLIF({transaction.quantity},0) ELSE 0 END) ) + ( SUM(CASE WHEN {inventorylocation}={transaction.location} AND {transaction.type}='Sales Order' AND {transaction.closed}='F' AND (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantitybilled}/NULLIF({transaction.quantity},0)) > (NVL({transaction.custcol_mgsl_packqty},0)*{transaction.quantityshiprecv}/NULLIF({transaction.quantity},0)) THEN NVL({transaction.custcol_mgsl_packqty},0)*({transaction.quantitybilled}-{transaction.quantityshiprecv})/NULLIF({transaction.quantity},0) ELSE 0 END) ) + ( SUM(CASE WHEN {inventorylocation}={transaction.location} AND {transaction.type}='Purchase Order' AND {transaction.closed}='F' AND NVL({transaction.custcol_mgsl_packqty},0) > (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) >= (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0)) THEN NVL({transaction.custcol_mgsl_packqty},0) - (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) ELSE 0 END) ) + ( SUM(CASE WHEN {inventorylocation}={transaction.location} AND {transaction.type}='Purchase Order' AND {transaction.closed}='F' AND (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0)) > (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) THEN (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantitybilled},0)/NULLIF({transaction.quantity},0)) - (NVL({transaction.custcol_mgsl_packqty},0)*NVL({transaction.quantityshiprecv},0)/NULLIF({transaction.quantity},0)) ELSE 0 END) )",
                label: "Formula (Numeric)"
            }),
            search.createColumn({
                name: "formulanumeric",
                summary: "MAX",
                formula: "GREATEST(     0,      /* Incoming quantity */     SUM(         CASE             WHEN {inventorylocation} = {transaction.location}                  AND (                      {transaction.type} = 'Item Receipt'                      OR (                          {transaction.type} = 'Inventory Adjustment'                          AND {transaction.quantity} > 0                      )                      OR ({transaction.type} = 'Credit Memo')                  )             THEN NVL({transaction.custcol_mgsl_packqty}, 0)             ELSE 0         END     )      -      /* Outgoing quantity */     SUM(         CASE             WHEN {inventorylocation} = {transaction.location}                  AND (                      ({transaction.type} = 'Item Fulfillment'                       AND {transaction.status} = 'Shipped')                      OR (                          {transaction.type} = 'Inventory Adjustment'                          AND {transaction.quantity} < 0                      )                  )             THEN ABS(NVL({transaction.custcol_mgsl_packqty}, 0))             ELSE 0         END     )      -      /* Open Sales Orders – unbilled portion exceeding shipped/received */     SUM(         CASE             WHEN {inventorylocation} = {transaction.location}                  AND {transaction.type} = 'Sales Order'                  AND {transaction.closed} = 'F'                  AND (                      NVL({transaction.custcol_mgsl_packqty}, 0)                      * ({transaction.quantity} - {transaction.quantitybilled})                      / CASE                            WHEN {transaction.quantity} = 0 THEN 1                            ELSE {transaction.quantity}                        END                      >                      NVL({transaction.custcol_mgsl_packqty}, 0)                      * {transaction.quantityshiprecv}                      / CASE                            WHEN {transaction.quantity} = 0 THEN 1                            ELSE {transaction.quantity}                        END                  )             THEN                 NVL({transaction.custcol_mgsl_packqty}, 0)                 * ({transaction.quantity} - {transaction.quantitybilled})                 / CASE                       WHEN {transaction.quantity} = 0 THEN 1                       ELSE {transaction.quantity}                   END             ELSE 0         END     )      -      /* Open Sales Orders – billed portion exceeding shipped/received */     SUM(         CASE             WHEN {inventorylocation} = {transaction.location}                  AND {transaction.type} = 'Sales Order'                  AND {transaction.closed} = 'F'                  AND (                      NVL({transaction.custcol_mgsl_packqty}, 0)                      * {transaction.quantitybilled}                      / CASE                            WHEN {transaction.quantity} = 0 THEN 1                            ELSE {transaction.quantity}                        END                      >                      NVL({transaction.custcol_mgsl_packqty}, 0)                      * {transaction.quantityshiprecv}                      / CASE                            WHEN {transaction.quantity} = 0 THEN 1                            ELSE {transaction.quantity}                        END                  )             THEN                 NVL({transaction.custcol_mgsl_packqty}, 0)                 * ({transaction.quantitybilled} - {transaction.quantityshiprecv})                 / CASE                       WHEN {transaction.quantity} = 0 THEN 1                       ELSE {transaction.quantity}                   END             ELSE 0         END     ) )",
                label: "available"
            }),
            search.createColumn({
                name: "locationaveragecost",
                summary: "GROUP",
                label: "Average Cost"
            }),
            search.createColumn({
                name: "internalid",
                summary: "MAX",
                label: "Internal ID"
            }),
            search.createColumn({
                name: "type",
                summary: "MAX",
                label: "Type"
            }),
            search.createColumn({
                name: "custitem_mgsl_length",
                summary: "GROUP",
                label: "Length"
            }),
            search.createColumn({
                name: "custitem_mgsl_width",
                summary: "GROUP",
                label: "Width"
            }),
            search.createColumn({
                name: "custitem_mgsl_thickness",
                summary: "GROUP",
                label: "Thickness"
            }),
            search.createColumn({
                name: "custitem_species",
                summary: "GROUP",
                label: "Spieces"
            }),
            search.createColumn({
                name: "custitem_grade",
                summary: "GROUP",
                label: "Grade"
            }),
            search.createColumn({
                name: "custitem_finition",
                summary: "GROUP",
                label: "Finition"
            }),
            search.createColumn({
                name: "custitem_humidity",
                summary: "GROUP",
                label: "Humidité"
            }),
            search.createColumn({
                name: "custitem_plannage",
                summary: "GROUP",
                label: "Plannage"
            }),
            search.createColumn({
                name: "custitem_etampage",
                summary: "GROUP",
                label: "Étampage"
            }),
            search.createColumn({
                name: "custitem_autres",
                summary: "GROUP",
                label: "Autres"
            })
        ]
});
const searchResultCount = itemSearchObj.runPaged().count;
log.debug("itemSearchObj result count",searchResultCount);
itemSearchObj.run().each(function(result){
    // .run().each has a limit of 4,000 results
    return true;
});

/*
itemSearchObj.id="customsearch1772774414923";
itemSearchObj.title="null (copy)";
const newSearchId = itemSearchObj.save();
*/