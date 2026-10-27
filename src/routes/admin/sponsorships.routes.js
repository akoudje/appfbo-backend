const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const sponsorshipsController = require("../../controllers/admin/sponsorships.controller");
const { uploadSponsorshipDocumentsMiddleware } = require("../../services/sponsorship.service");

const router = express.Router();

router.use(requirePermission(Permission.SPONSORSHIP_REVIEW));

// Soumission assistée au comptoir (parrain non reconnu par FBO Service, donc
// sans accès à son espace client) : avant /:id pour ne pas être capté par lui.
router.post(
  "/counter-submit",
  uploadSponsorshipDocumentsMiddleware,
  sponsorshipsController.counterSubmitSponsorship,
);

router.get("/", sponsorshipsController.listSponsorships);
router.get("/:id", sponsorshipsController.getSponsorship);
router.get("/:id/documents/:documentId/file", sponsorshipsController.downloadSponsorshipDocument);
router.get("/:id/agreement.pdf", sponsorshipsController.downloadSponsorshipAgreement);
router.get("/:id/dossier.pdf", sponsorshipsController.downloadSponsorshipDossier);
router.get("/:id/catalog", sponsorshipsController.getCounterCatalog);
// L'approbation et la relance de l'achat préfacturent : il faut aussi le droit de facturer.
router.post("/:id/counter-purchase", requirePermission(Permission.INVOICE_CREATE), sponsorshipsController.counterPurchase);
router.post("/:id/cancel", sponsorshipsController.cancelSponsorship);
router.post("/:id/request-changes", sponsorshipsController.requestChanges);
router.post("/:id/reject", sponsorshipsController.rejectSponsorship);
router.post("/:id/approve", requirePermission(Permission.INVOICE_CREATE), sponsorshipsController.approveSponsorship);
router.post("/:id/evaluate", sponsorshipsController.evaluateNow);
router.post("/:id/resend-notification", sponsorshipsController.resendNotification);

module.exports = router;
