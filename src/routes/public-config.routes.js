const router = require("express").Router();
const { resolveCountry } = require("../middlewares/resolveCountry");
const { getStorefrontConfig } = require("../controllers/publicConfig.controller");

router.use(resolveCountry);

router.get("/", getStorefrontConfig);

module.exports = router;
