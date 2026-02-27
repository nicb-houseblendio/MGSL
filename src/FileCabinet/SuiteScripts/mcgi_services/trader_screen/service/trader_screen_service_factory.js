/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description Service factory for Trader Screen RESTlet API
 */
define(['./trader_screen_service'], TraderScreenService => {
  const serviceMap = {
    traderScreen: TraderScreenService,
  };

  return {
    getService: serviceName => {
      if (!serviceMap[serviceName]) {
        throw new Error('Service not found: ' + serviceName);
      }
      return serviceMap[serviceName];
    },
  };
});
