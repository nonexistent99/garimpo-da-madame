const createProductsRoutes = require('./products/products-routes');
const createNichesRoutes = require('./niches/niches-routes');
const createCreativesRoutes = require('./creatives/creatives-routes');
const createAccountsRoutes = require('./accounts/accounts-routes');
const createPublisherRoutes = require('./publisher/publisher-routes');
const createTrackingRoutes = require('./tracking/tracking-routes');
const createAnalyticsRoutes = require('./analytics/analytics-routes');
const createQualityGuardRoutes = require('./quality-guard/quality-guard-routes');
const createContentQualityRoutes = require('./content-quality/content-quality-routes');

function registerOffersWorkspace(app) {
  // Offers Workspace is mounted as additive modules on top of the existing offers-bot app.
  app.use('/api/products', createProductsRoutes());
  app.use('/api/niches', createNichesRoutes());
  app.use('/api/creatives', createCreativesRoutes());
  app.use('/api/accounts', createAccountsRoutes());
  app.use('/api/publisher', createPublisherRoutes());
  app.use('/api/analytics', createAnalyticsRoutes());
  app.use('/api/quality', createQualityGuardRoutes());
  app.use('/api/content-quality', createContentQualityRoutes());
  app.use(createTrackingRoutes());
}

module.exports = registerOffersWorkspace;
