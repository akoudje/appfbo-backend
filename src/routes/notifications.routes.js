const router = require("express").Router();
const { resolveCountry } = require("../middlewares/resolveCountry");
const notificationsController = require("../controllers/notifications.controller");

router.use(resolveCountry);

router.post("/register-token", notificationsController.registerToken);

module.exports = router;
