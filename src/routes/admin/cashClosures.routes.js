const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const cashClosuresController = require("../../controllers/admin/cashClosures.controller");

const router = express.Router();

router.get(
  "/",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.listClosures,
);

router.get(
  "/draft",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.getOrCreateDraft,
);

router.put(
  "/:id",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.updateClosure,
);

router.post(
  "/:id/submit",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.submitClosure,
);

router.post(
  "/:id/approve",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.approveClosure,
);

router.post(
  "/:id/reject",
  requirePermission(Permission.PAYMENT_VALIDATE),
  cashClosuresController.rejectClosure,
);

module.exports = router;
