/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Service factory for Trader Screen RESTlet API.
 * Routes by subsidiary: 5 → MTL, 9 → ARCH, anything else → IND.
 *
 * IND stays the default rather than becoming an explicit branch, so an
 * unrecognised subsidiary keeps its existing behaviour instead of failing.
 */
define([
  './trader_screen_service',
  './trader_screen_service_mtl',
  './trader_screen_service_arch',
], (TraderScreenService, TraderScreenServiceMTL, TraderScreenServiceARCH) => {

  const MTL_SUBSIDIARY_ID  = 5;
  const ARCH_SUBSIDIARY_ID = 9;   // "ARC" in NetSuite; CWP Architectural Inc.

  return {
    getService: (serviceName, subsidiaryId) => {
      if (serviceName === 'traderScreen') {
        const subId = subsidiaryId ? Number(subsidiaryId) : null;
        if (subId === MTL_SUBSIDIARY_ID)  return TraderScreenServiceMTL;
        if (subId === ARCH_SUBSIDIARY_ID) return TraderScreenServiceARCH;
        return TraderScreenService;
      }
      throw new Error('Service not found: ' + serviceName);
    },
  };
});
