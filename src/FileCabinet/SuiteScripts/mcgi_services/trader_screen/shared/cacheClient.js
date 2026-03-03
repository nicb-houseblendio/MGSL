/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Centralized N/cache client for Trader Screen (PUBLIC scope).
 */
define(['N/cache', './cacheKeys'], (cache, CacheKeys) => {
    const getCache = () => cache.getCache({
        name: CacheKeys.CACHE_NAME,
        scope: cache.Scope.PUBLIC,
    });

    return { getCache };
});
