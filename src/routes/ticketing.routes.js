const express = require("express");
const { resolveCountry } = require("../middlewares/resolveCountry");
const ticketingController = require("../controllers/ticketing.controller");

const router = express.Router();

router.use(resolveCountry);

router.get("/events", ticketingController.listPublicEvents);
router.get("/events/:slug", ticketingController.getPublicEvent);
router.post("/orders", ticketingController.createTicketOrder);
router.get("/orders/:orderNumber", ticketingController.getTicketOrder);

module.exports = router;
