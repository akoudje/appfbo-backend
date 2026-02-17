// preorders.routes.js : définit les routes liées aux précommandes, permettant de créer un brouillon, de définir les items, d'obtenir un résumé et de soumettre la précommande

const router = require("express").Router();
const {
  createDraft,
  setItems,
  getSummary,
  submit,
} = require("../controllers/preorders.controller");

// ✅ Étape 1 : créer un draft (route officielle)
router.post("/draft", createDraft);

// ✅ (Optionnel) Alias rétro-compatible si ton front appelle encore POST /api/preorders
router.post("/", createDraft);

// ✅ Étape 2 : items
router.put("/:id/items", setItems);

// ✅ Étape 3 : summary
router.get("/:id/summary", getSummary);

// ✅ Finalisation
router.post("/:id/submit", submit);

module.exports = router;



