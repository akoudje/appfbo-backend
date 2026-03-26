// preorders.routes.js

const router = require("express").Router();
const {
  createDraft,
  setItems,
  getCatalog,
  getSummary,
  submit,
  notifySms,
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

module.exports = router;
