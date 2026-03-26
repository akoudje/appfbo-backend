// preorders.routes.js

const router = require("express").Router();
const {
  createDraft,
  setItems,
  getCatalog,
  getSummary,
  submit,
  notifySms,
  getSmsStatus,
} = require("../controllers/preorders.controller");
const { resolveCountry } = require("../middlewares/resolveCountry");

router.use(resolveCountry);

router.post("/draft", createDraft);
router.post("/", createDraft);
router.get("/:id/catalog", getCatalog);
router.put("/:id/items", setItems);
router.get("/:id/summary", getSummary);
router.post("/:id/submit", submit);
router.post("/:id/notify-sms", notifySms);
router.get("/:id/sms-status", getSmsStatus);

module.exports = router;
