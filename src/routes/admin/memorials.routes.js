const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const memorialsController = require("../../controllers/memorials.controller");

const router = express.Router();

router.get(
  "/tributes",
  requirePermission(Permission.MARKETING_WRITE),
  memorialsController.listAdminTributes,
);

router.put(
  "/",
  requirePermission(Permission.MARKETING_WRITE),
  memorialsController.updateAdminMemorial,
);

router.post(
  "/assets",
  requirePermission(Permission.MARKETING_WRITE),
  memorialsController.uploadMemorialCoverMiddleware,
  memorialsController.uploadAdminMemorialCover,
);

router.patch(
  "/tributes/:id/status",
  requirePermission(Permission.MARKETING_WRITE),
  memorialsController.updateAdminTributeStatus,
);

module.exports = router;
