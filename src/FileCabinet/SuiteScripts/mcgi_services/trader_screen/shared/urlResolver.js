/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Thin wrapper around N/url.resolveRecord for reuse across Trader Screen scripts.
 */
define(['N/url'], (url) => {
    const getRecordUrl = (recordId, recordType) => {
        if (!recordId || !recordType) return '';
        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: String(recordId),
                isEditMode: false,
            });
        } catch (e) {
            return '';
        }
    };

    return { getRecordUrl };
});
