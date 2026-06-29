const express = require("express");
const controller = require("../controllers/fboDocuments.controller");

const router = express.Router();

router.get("/verify/:token", controller.verifyFboDocument);

module.exports = router;
