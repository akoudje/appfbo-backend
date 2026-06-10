const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const controller = require("../controllers/externalPaymentLinks.controller");

const router = express.Router();

router.use(resolveCountry);

router.get("/:token", controller.getPublicLink);

module.exports = router;
