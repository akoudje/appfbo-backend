const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/cashRegisterStatus.controller");

const router = express.Router();
const requireCashRegisterAccess = requirePermission(Permission.PAYMENT_VALIDATE);

router.get("/", requireCashRegisterAccess, controller.getStatus);
router.post("/close", requireCashRegisterAccess, controller.closeRegister);
router.post("/open", requireCashRegisterAccess, controller.openRegister);

module.exports = router;
