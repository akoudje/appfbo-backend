const express = require("express");
const { Permission } = require("../../auth/permissions");
const { requirePermission } = require("../../middlewares/rbac");
const sponsorshipsController = require("../../controllers/admin/sponsorships.controller");

const router = express.Router();

router.use(requirePermission(Permission.SPONSORSHIP_REVIEW));

router.get("/", sponsorshipsController.listSponsorships);
router.get("/:id", sponsorshipsController.getSponsorship);
router.get("/:id/documents/:documentId/file", sponsorshipsController.downloadSponsorshipDocument);
router.post("/:id/request-changes", sponsorshipsController.requestChanges);
router.post("/:id/reject", sponsorshipsController.rejectSponsorship);
router.post("/:id/approve", sponsorshipsController.approveSponsorship);
router.post("/:id/evaluate", sponsorshipsController.evaluateNow);

module.exports = router;
