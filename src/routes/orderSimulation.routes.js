// orderSimulation.routes.js : simulation de commande publique (sans commande).
const router = require("express").Router();
const { resolveCountry } = require("../middlewares/resolveCountry");
const { createRateLimiter } = require("../middlewares/rateLimit");
const { startSimulation, quoteSimulation } = require("../controllers/orderSimulation.controller");

router.use(resolveCountry);

// Le numéro FBO a en plus le quota de la vérification FBO (contrôleur).
router.post(
  "/session",
  createRateLimiter({ keyPrefix: "order_simulation_session", windowMs: 60_000, max: 30 }),
  startSimulation,
);
// Recalcul à chaque modification du panier : quota large.
router.post(
  "/quote",
  createRateLimiter({ keyPrefix: "order_simulation_quote", windowMs: 60_000, max: 120 }),
  quoteSimulation,
);

module.exports = router;
