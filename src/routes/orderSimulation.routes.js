// orderSimulation.routes.js : simulation de commande publique (sans commande).
const router = require("express").Router();
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { startSimulation, quoteSimulation } = require("../controllers/orderSimulation.controller");

router.use(resolveCountry);

router.post("/session", startSimulation);
// Recalcul à chaque modification du panier : quota large.
router.post(
  "/quote",
  createRateLimiter({ keyPrefix: "order_simulation_quote", windowMs: 60_000, max: 120 }),
  quoteSimulation,
);

module.exports = router;
