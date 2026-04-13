/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Service factory for Trader Screen RESTlet API.
 * Routes to MTL service when subsidiaryId === 5, IND service otherwise.
 */
define([
  './trader_screen_service',
  './trader_screen_service_mtl',
], (TraderScreenService, TraderScreenServiceMTL) => {

  const MTL_SUBSIDIARY_ID = 5;

  return {
    getService: (serviceName, subsidiaryId) => {
      if (serviceName === 'traderScreen') {
        const subId = subsidiaryId ? Number(subsidiaryId) : null;
        if (subId === MTL_SUBSIDIARY_ID) return TraderScreenServiceMTL;
        return TraderScreenService;
      }
      throw new Error('Service not found: ' + serviceName);
    },
  };
});
