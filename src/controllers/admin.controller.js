const ordersController = require("./admin/orders.controller");
const paymentsController = require("./admin/payments.controller");
const statsController = require("./admin/stats.controller");
const settingsController = require("./admin/settings.controller");
const productsController = require("./admin/products.controller");

async function paydunyaWebhook(req, res) {
  console.warn("paydunyaWebhook called but disabled after payment refactor.");
  return res.status(200).json({
    ok: true,
    ignored: true,
    message:
      "Webhook PayDunya désactivé. Utiliser le nouveau moteur de paiement.",
  });
}

module.exports = {
  ...ordersController,
  ...paymentsController,
  ...statsController,
  ...settingsController,
  ...productsController,
  paydunyaWebhook,
};
