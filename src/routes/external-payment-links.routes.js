const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const controller = require("../controllers/externalPaymentLinks.controller");

const router = express.Router();

router.use(resolveCountry);

router.get("/:token", controller.getPublicLink);
router.post("/:token/wave/initiate", controller.initiateWave);
router.post("/:token/wave/sync", controller.syncWave);

module.exports = router;
