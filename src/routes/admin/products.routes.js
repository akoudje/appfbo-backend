const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const productsController = require("../../controllers/admin/products.controller");

const router = express.Router();

router.get("/", requirePermission(Permission.PRODUCT_READ), productsController.listProducts);
router.get("/:id", requirePermission(Permission.PRODUCT_READ), productsController.getProductById);

router.post("/", requirePermission(Permission.PRODUCT_WRITE), productsController.createProduct);
router.put("/:id", requirePermission(Permission.PRODUCT_WRITE), productsController.updateProduct);
router.delete("/:id", requirePermission(Permission.PRODUCT_WRITE), productsController.deleteProduct);

router.post(
  "/import",
  requirePermission(Permission.PRODUCT_WRITE),
  productsController.importProductsCsv,
);

router.post(
  "/:id/image",
  requirePermission(Permission.PRODUCT_WRITE),
  productsController.uploadProductImage,
);

module.exports = router;
