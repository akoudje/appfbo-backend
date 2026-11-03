const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const settingsController = require("../../controllers/admin/settings.controller");
const commercialMonthsController = require("../../controllers/admin/commercialMonths.controller");

const router = express.Router();

router.get(
  "/",
  requirePermission(Permission.COUNTRY_READ),
  settingsController.getCountrySettings,
);

router.get("/history", requirePermission(Permission.COUNTRY_WRITE), settingsController.getCountrySettingsHistory);

router.post(
  "/submission-override",
  requirePermission(Permission.COUNTRY_WRITE),
  settingsController.setSubmissionOverride,
);

router.get(
  "/commercial-months",
  requirePermission(Permission.COUNTRY_READ),
  commercialMonthsController.listCommercialMonths,
);
router.put(
  "/commercial-months/:month",
  requirePermission(Permission.COUNTRY_WRITE),
  commercialMonthsController.upsertCommercialMonth,
);
router.delete(
  "/commercial-months/:month",
  requirePermission(Permission.COUNTRY_WRITE),
  commercialMonthsController.deleteCommercialMonth,
);

router.patch(
  "/",
  requirePermission(Permission.COUNTRY_WRITE),
  settingsController.updateCountrySettings,
);

module.exports = router;
