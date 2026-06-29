const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/fboDocuments.controller");

const router = express.Router();

router.get("/fbos", requirePermission(Permission.PREORDER_READ), controller.searchFbos);
router.get("/", requirePermission(Permission.PREORDER_READ), controller.listDocuments);
router.post("/", requirePermission(Permission.PREORDER_READ), controller.createDocument);
router.post("/:id/cancel", requirePermission(Permission.PREORDER_READ), controller.cancelDocument);

module.exports = router;
