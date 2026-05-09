const router = require("express").Router();
const { listActiveCountries } = require("../controllers/countries.controller");

router.get("/", listActiveCountries);

module.exports = router;
