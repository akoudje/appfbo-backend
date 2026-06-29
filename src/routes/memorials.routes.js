const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const memorialsController = require("../controllers/memorials.controller");

const router = express.Router();

router.use(resolveCountry);

router.get("/:slug", memorialsController.getPublicMemorial);
router.post("/:slug/tributes", memorialsController.submitTribute);

module.exports = router;
