const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const productsController = require("../../controllers/admin/products.controller");
const productPackagingsController = require("../../controllers/admin/productPackagings.controller");

const router = express.Router();

router.get("/", requirePermission(Permission.PRODUCT_READ), productsController.listProducts);
router.post(
  "/copy-from-country",
  requirePermission(Permission.PRODUCT_WRITE),
  productsController.copyProductsFromCountry,
);
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

router.get(
  "/:id/packagings",
  requirePermission(Permission.PRODUCT_READ),
  productPackagingsController.listPackagings,
);
router.post(
  "/:id/packagings",
  requirePermission(Permission.PRODUCT_WRITE),
  productPackagingsController.createPackaging,
);
router.put(
  "/:id/packagings/:packagingId",
  requirePermission(Permission.PRODUCT_WRITE),
  productPackagingsController.updatePackaging,
);
router.delete(
  "/:id/packagings/:packagingId",
  requirePermission(Permission.PRODUCT_WRITE),
  productPackagingsController.deletePackaging,
);

module.exports = router;
