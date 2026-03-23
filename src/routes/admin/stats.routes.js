const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const statsController = require("../../controllers/admin/stats.controller");

const router = express.Router();

router.get("/", requirePermission(Permission.EXPORT_READ), statsController.getStats);

module.exports = router;
