const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const settingsController = require("../../controllers/admin/settings.controller");

const router = express.Router();

router.get(
  "/",
  requirePermission(Permission.COUNTRY_READ),
  settingsController.getCountrySettings,
);

router.patch(
  "/",
  requirePermission(Permission.COUNTRY_WRITE),
  settingsController.updateCountrySettings,
);

module.exports = router;
