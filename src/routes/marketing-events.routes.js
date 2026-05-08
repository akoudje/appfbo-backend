const express = require("express");
const marketingCampaignsController = require("../controllers/admin/marketingCampaigns.controller");

const router = express.Router();

router.get(
  "/:campaignId/:recipientId/:token",
  marketingCampaignsController.getSmsCampaignRsvp,
);

router.post(
  "/:campaignId/:recipientId/:token/respond",
  marketingCampaignsController.respondSmsCampaignRsvp,
);

module.exports = router;
