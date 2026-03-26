const router = require("express").Router();

const { sendTestSms } = require("../controllers/sms.controller");

router.post("/test", sendTestSms);

module.exports = router;
