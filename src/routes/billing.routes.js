// routes/billing.routes.js
// Routes pour la file de précommandes à facturer, permettant aux invoicers de réclamer la prochaine précommande à facturer, de commencer le travail de facturation, de le libérer ou de l'escalader en cas de problème.

const express = require("express");
const { Permission } = require("../auth/permissions");
const { resolveCountry } = require("../middlewares/resolveCountry");
const {
  requireAuth,
  requirePermission,
  requireCountryScope,
} = require("../middlewares/rbac");

const {
  claimNext,
  startWork,
  releaseWork,
  escalateWork,
} = require("../controllers/billingQueue.controller");

const router = express.Router();

router.use(resolveCountry, requireAuth, requireCountryScope);

router.post(
  "/claim-next",
  requirePermission(Permission.INVOICE_CREATE),
  claimNext,
);

router.post(
  "/:id/start",
  requirePermission(Permission.INVOICE_CREATE),
  startWork,
);

router.post(
  "/:id/release",
  requirePermission(Permission.INVOICE_CREATE),
  releaseWork,
);

router.post(
  "/:id/escalate",
  requirePermission(Permission.INVOICE_CREATE),
  escalateWork,
);

module.exports = router;