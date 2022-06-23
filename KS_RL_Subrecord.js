/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search'],
/**
 * @param{record} record
 * @param{search} search
 */
function(record, search) {
   
    /**
     * Function called upon sending a GET request to the RESTlet.
     *
     * @param {Object} requestParams - Parameters from HTTP request URL; parameters will be passed into function as an Object (for all supported content types)
     * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
     * @since 2015.1
     */
    function doGet(requestParams) {

    }

    /**
     * Function called upon sending a PUT request to the RESTlet.
     *
     * @param {string | Object} requestBody - The HTTP request body; request body will be passed into function as a string when request Content-Type is 'text/plain'
     * or parsed into an Object when request Content-Type is 'application/json' (in which case the body must be a valid JSON)
     * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
     * @since 2015.2
     */
    function doPut(requestBody) {

    }


    /**
     * Function called upon sending a POST request to the RESTlet.
     *
     * @param {string | Object} requestBody - The HTTP request body; request body will be passed into function as a string when request Content-Type is 'text/plain'
     * or parsed into an Object when request Content-Type is 'application/json' (in which case the body must be a valid JSON)
     * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
     * @since 2015.2
     */
    function doPost(requestBody) {
        log.debug('requestBody', requestBody);
        transformPOtoIR(requestBody.poid);
        // parseFile(requestBody.fileid);
    }

    /**
     * Function called upon sending a DELETE request to the RESTlet.
     *
     * @param {Object} requestParams - Parameters from HTTP request URL; parameters will be passed into function as an Object (for all supported content types)
     * @returns {string | Object} HTTP response body; return string when request Content-Type is 'text/plain'; return Object when request Content-Type is 'application/json'
     * @since 2015.2
     */
    function doDelete(requestParams) {

    }

    function parseFile(inFileId){
        var file = file.load({
            id: inFileId
        }).getContents();
        log.debug('file', file);
    }

    function transformPOtoIR(inPOId){
        var objResponse = {};
        var objPurchaseOrder = searchPurchaseOrderLines(inPOId);
        log.debug('objPurchaseOrder', objPurchaseOrder);
        var objLines = objPurchaseOrder[inPOId].items;
        log.debug('objLines', objLines);
        try{
            var objItemReceipt = record.transform({
                fromType: record.Type.PURCHASE_ORDER,
                fromId: inPOId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            createInventoryDetail(objItemReceipt, objLines, inPOId)

            var inItemReceiptId = objItemReceipt.save();
            log.debug('inItemReceiptId', inItemReceiptId);

            if(inItemReceiptId){
                objResponse.success = true;
                objResponse.message = "Successfully Receipted PO: " + inPOId + ", Item Receipt ID: " + inItemReceiptId
            }
        } catch (e) {
            log.error('error in receiptLabourPO()', e);
            objResponse.success = false;
            objResponse.message = e.message;
        }
        return objResponse;
    }

    function searchPurchaseOrderLines(inPOId){
        var objPurchaseOrder = {};
        var transactionSearchObj = search.create({
            type: "transaction",
            filters:
                [
                    ["internalid","anyof",inPOId],
                    "AND",
                    ["type","anyof","PurchOrd"],
                    "AND",
                    ["taxline","is","F"],
                    "AND",
                    ["shipping","is","F"],
                    "AND",
                    ["mainline", "is", "F"]
                ],
            columns:
                [
                    "internalid",
                    search.createColumn({
                        name: "ordertype",
                        sort: search.Sort.ASC
                    }),
                    "mainline",
                    "trandate",
                    "asofdate",
                    "postingperiod",
                    "taxperiod",
                    "type",
                    "tranid",
                    "entity",
                    "account",
                    "memo",
                    "amount",
                    "statusref",
                    "item",
                    "quantity",
                    "line"
                ]
        });
        var searchResultCount = transactionSearchObj.runPaged().count;
        log.debug("transactionSearchObj result count",searchResultCount);

        if(searchResultCount > 0) {
            var myPagedData = transactionSearchObj.runPaged({
                pageSize: 1000
            });
            myPagedData.pageRanges.forEach(function (pageRange) {
                var myPage = myPagedData.fetch({
                    index: pageRange.index
                });
                myPage.data.forEach(function (result) {

                    var inTransactionId = Number(result.getValue({
                        name: 'internalid'
                    }));

                    if (objPurchaseOrder[inTransactionId] == null) {
                        objPurchaseOrder[inTransactionId] = {};
                    }

                    if (objPurchaseOrder[inTransactionId].items == null) {
                        objPurchaseOrder[inTransactionId].items = {};
                    }

                    var inItemId = result.getValue({
                        name: 'item'
                    });
                    log.debug('inItemId', inItemId);

                    if (inItemId > 0) {
                        var quantity = Number(result.getValue({
                            name: 'quantity'
                        }));
                        log.debug('quantity', quantity);
                        if (quantity > 0) {
                            log.debug("Positive Quantity Found")

                            objPurchaseOrder[inTransactionId].items[inItemId] = {quantity: quantity}
                        }
                    }
                })
            })
        }
        return objPurchaseOrder;
    }

    function createInventoryDetail(objItemReceipt, objLines, inPOId){
        log.debug('INVENTORY DETAIL START');
        log.debug("objLines", objLines);
        var numLines = objItemReceipt.getLineCount({
            sublistId: 'item'
        });
        log.debug('numLines', numLines);

        for(var count = 0; count < numLines; count++) {
            objItemReceipt.selectLine({
                sublistId: 'item',
                line: count
            });

            var objItemProperties = checkItemProperties(objItemReceipt);
            log.debug('objItemProperties', objItemProperties);

            var itemId = objItemReceipt.getCurrentSublistValue({
                sublistId: 'item',
                fieldId: 'item'
            });

            if(objItemProperties.isNumbered){
                log.debug("Is Numbered", objLines[itemId])
                if(objLines[itemId]){
                    var invDetailSubRecord = objItemReceipt.getCurrentSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail'
                    });

                    var currentLineCount = invDetailSubRecord.getLineCount({
                        sublistId: 'inventoryassignment'
                    });

                    log.debug('currentLineCount', currentLineCount);

                    if (currentLineCount === 0) {
                        invDetailSubRecord.selectNewLine({
                            sublistId: 'inventoryassignment'
                        })
                    } else {
                        invDetailSubRecord.selectLine({
                            sublistId: 'inventoryassignment',
                            line: currentLineCount
                        });
                    }

                    invDetailSubRecord.setCurrentSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'receiptinventorynumber',
                        value: inPOId
                    });

                    var stSerial = invDetailSubRecord.getCurrentSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'receiptinventorynumber',
                    })
                    log.debug('Serial', stSerial);

                    invDetailSubRecord.setCurrentSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'quantity',
                        value: objLines[itemId].quantity
                    });

                    invDetailSubRecord.commitLine({
                        sublistId: 'inventoryassignment'
                    })
                }
            }

            objItemReceipt.commitLine({
                sublistId: 'item'
            });
        }
    }

    function checkItemProperties(objItemReceipt){
        var isBinItem = objItemReceipt.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'binitem'
        });

        var isSerial = objItemReceipt.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'isserial'
        });

        var isNumbered = objItemReceipt.getCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'isnumbered'
        });

        var objItemProperties = {};
        objItemProperties.isBinItem = isBinItem === "T";
        objItemProperties.isSerial = isSerial === "T";
        objItemProperties.isNumbered = isNumbered === "T";

        return objItemProperties;
    }

    return {
        'get': doGet,
        put: doPut,
        post: doPost,
        'delete': doDelete
    };
    
});
