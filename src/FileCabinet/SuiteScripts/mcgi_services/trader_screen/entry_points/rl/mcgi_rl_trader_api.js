/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @description Trader Screen REST API - thin RESTlet delegating to trader_screen_service
 */
define(['../../service/trader_screen_service_factory'], ServiceFactory => {
    const serviceName = 'traderScreen';

    const getParamsFromGet = requestParams => {
        const p = requestParams || {};
        return {
            action: p.action,
            itemId: p.itemId,
            locationId: p.locationId,
            bucket: p.bucket,
            subsidiaryId: p.subsidiaryId,
            location: p.location,
            item: p.item,
            greaterThanZero: p.greaterThanZero !== 'false',
            species: p.species,
            thickness: p.thickness,
            width: p.width,
            length: p.length,
            grade: p.grade,
            finition: p.finition,
            humidity: p.humidity,
            plannage: p.plannage,
            etampage: p.etampage,
            autres: p.autres,
            country: p.country,
            vendor: p.vendor,
            po: p.po,
        };
    };

    const getParamsFromPost = requestBody => {
        if (!requestBody) return {};
        if (typeof requestBody === 'object') return requestBody;
        try {
            return JSON.parse(requestBody);
        } catch (e) {
            return {};
        }
    };

    const get = requestParams => {
        const params = getParamsFromGet(requestParams);
        if (!params.action) params.action = 'get';
        const svc = ServiceFactory.getService(serviceName, params.subsidiaryId);
        const result = svc.getRouter(params);
        return (result && typeof result === 'object') ? JSON.stringify(result) : result;
    };

    const post = requestBody => {
        const params = getParamsFromPost(requestBody);
        if (!params.action) params.action = 'post';
        const svc = ServiceFactory.getService(serviceName, params.subsidiaryId);
        const result = svc.postRouter(params);
        return (result && typeof result === 'object') ? JSON.stringify(result) : result;
    };

    return { get: get, post: post };
});
