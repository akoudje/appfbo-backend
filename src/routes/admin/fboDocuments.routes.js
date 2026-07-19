const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const controller = require("../../controllers/admin/fboDocuments.controller");

const router = express.Router();

router.get("/fbos", requirePermission(Permission.FBO_DOCUMENT_ISSUE), controller.searchFbos);
router.get("/", requirePermission(Permission.FBO_DOCUMENT_ISSUE), controller.listDocuments);
router.post("/", requirePermission(Permission.FBO_DOCUMENT_ISSUE), controller.createDocument);
router.post("/:id/cancel", requirePermission(Permission.FBO_DOCUMENT_ISSUE), controller.cancelDocument);

module.exports = router;
