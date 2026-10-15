const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const sponsorshipsController = require("../../controllers/admin/sponsorships.controller");

const router = express.Router();

router.use(requirePermission(Permission.SPONSORSHIP_REVIEW));

router.get("/", sponsorshipsController.listSponsorships);
router.get("/:id", sponsorshipsController.getSponsorship);
router.get("/:id/documents/:documentId/file", sponsorshipsController.downloadSponsorshipDocument);
router.get("/:id/agreement.pdf", sponsorshipsController.downloadSponsorshipAgreement);
router.get("/:id/dossier.pdf", sponsorshipsController.downloadSponsorshipDossier);
router.get("/:id/catalog", sponsorshipsController.getCounterCatalog);
// L'achat au comptoir préfacture : il faut aussi le droit de facturer.
router.post("/:id/counter-purchase", requirePermission(Permission.INVOICE_CREATE), sponsorshipsController.counterPurchase);
router.post("/:id/request-changes", sponsorshipsController.requestChanges);
router.post("/:id/reject", sponsorshipsController.rejectSponsorship);
router.post("/:id/approve", sponsorshipsController.approveSponsorship);
router.post("/:id/evaluate", sponsorshipsController.evaluateNow);

module.exports = router;
