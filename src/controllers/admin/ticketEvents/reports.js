// Bilan événement : agrégats de vente, exports CSV (acheteurs, paiements)
// et envoi en masse d'un fichier de restitution aux acheteurs payés.

const multer = require("multer");
const prisma = require("../../../prisma");
const { normalizeEmail, sendEmail } = require("../../../services/email.service");
const {
  classifyPaymentMethodCategory,
  toCsv,
  sendCsv,
  normalizeSlug,
  buildOrdersWhere,
} = require("./shared");

// Pièce jointe du mail de restitution : document quelconque (PDF, photos,
// diaporama), pas seulement des images, d'où un filtre plus permissif que
// l'upload d'affiche du sous-contrôleur events.
const MAX_RESTITUTION_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_RESTITUTION_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const uploadRestitutionFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESTITUTION_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_RESTITUTION_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
    cb(ok ? null : new Error("Format de fichier non supporté (PDF, image, zip, docx, pptx)"), ok);
  },
});

function uploadRestitutionFileMiddleware(req, res, next) {
  uploadRestitutionFile.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Le fichier dépasse 15 MB." });
    }
    return res.status(400).json({ message: err.message || "Upload invalide" });
  });
}

async function buildEventSummaryData(req, eventId) {
  const event = await prisma.ticketEvent.findFirst({
    where: { id: eventId, countryId: req.countryId },
    select: { id: true, title: true, startsAt: true, venueName: true },
  });
  if (!event) return null;

  const orders = await prisma.ticketOrder.findMany({
    where: { eventId, countryId: req.countryId },
    select: {
      status: true,
      paymentMethod: true,
      paymentProvider: true,
      paymentStatus: true,
      quantity: true,
      totalFcfa: true,
    },
  });

  const paidOrders = orders.filter((order) => order.status === "PAID");
  const byPaymentMethod = new Map();
  for (const order of paidOrders) {
    const category = classifyPaymentMethodCategory(order);
    const entry = byPaymentMethod.get(category) || { paymentMethod: category, ordersCount: 0, ticketsCount: 0, totalFcfa: 0 };
    entry.ordersCount += 1;
    entry.ticketsCount += order.quantity || 0;
    entry.totalFcfa += order.totalFcfa || 0;
    byPaymentMethod.set(category, entry);
  }

  const totals = paidOrders.reduce(
    (acc, order) => {
      acc.ordersCount += 1;
      acc.ticketsCount += order.quantity || 0;
      acc.totalFcfa += order.totalFcfa || 0;
      return acc;
    },
    { ordersCount: 0, ticketsCount: 0, totalFcfa: 0 },
  );

  return {
    event,
    totals: {
      ...totals,
      allOrdersCount: orders.length,
      cancelledOrdersCount: orders.filter((o) => o.status === "CANCELLED").length,
      pendingOrdersCount: orders.filter((o) => o.status === "PENDING_PAYMENT" || o.status === "DRAFT").length,
    },
    byPaymentMethod: [...byPaymentMethod.values()].sort((a, b) => b.totalFcfa - a.totalFcfa),
  };
}

async function getEventSummary(req, res) {
  try {
    const summary = await buildEventSummaryData(req, req.params.id);
    if (!summary) return res.status(404).json({ message: "Événement introuvable" });
    return res.json(summary);
  } catch (error) {
    console.error("ticketEvents.getEventSummary error:", error);
    return res.status(500).json({ message: "Erreur serveur (getEventSummary)" });
  }
}

async function exportEventOrders(req, res) {
  try {
    const eventId = req.params.id;
    const event = await prisma.ticketEvent.findFirst({
      where: { id: eventId, countryId: req.countryId },
      select: { title: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const where = buildOrdersWhere(req, { ...req.query, eventId });
    const orders = await prisma.ticketOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: { ticketType: { select: { label: true } } },
    });

    const csv = toCsv(orders, [
      { label: "N° commande", value: (o) => o.orderNumber },
      { label: "Nom acheteur", value: (o) => o.buyerFullName },
      { label: "Téléphone", value: (o) => o.buyerPhone },
      { label: "Email", value: (o) => o.buyerEmail || "" },
      { label: "Numéro FBO", value: (o) => o.buyerFboNumber || "" },
      { label: "Type de billet", value: (o) => o.ticketType?.label || "" },
      { label: "Quantité", value: (o) => o.quantity },
      { label: "Montant (FCFA)", value: (o) => o.totalFcfa },
      { label: "Moyen de paiement", value: (o) => classifyPaymentMethodCategory(o) },
      { label: "Statut", value: (o) => o.status },
      { label: "Date d'achat", value: (o) => o.createdAt.toISOString() },
    ]);

    const safeTitle = normalizeSlug(event.title) || "evenement";
    return sendCsv(res, `acheteurs-${safeTitle}.csv`, csv);
  } catch (error) {
    console.error("ticketEvents.exportEventOrders error:", error);
    return res.status(500).json({ message: "Erreur serveur (exportEventOrders)" });
  }
}

async function exportEventPaymentReport(req, res) {
  try {
    const summary = await buildEventSummaryData(req, req.params.id);
    if (!summary) return res.status(404).json({ message: "Événement introuvable" });

    const csv = toCsv(summary.byPaymentMethod, [
      { label: "Moyen de paiement", value: (row) => row.paymentMethod },
      { label: "Nombre de commandes", value: (row) => row.ordersCount },
      { label: "Billets vendus", value: (row) => row.ticketsCount },
      { label: "Montant total (FCFA)", value: (row) => row.totalFcfa },
    ]);

    const safeTitle = normalizeSlug(summary.event.title) || "evenement";
    return sendCsv(res, `rapport-paiements-${safeTitle}.csv`, csv);
  } catch (error) {
    console.error("ticketEvents.exportEventPaymentReport error:", error);
    return res.status(500).json({ message: "Erreur serveur (exportEventPaymentReport)" });
  }
}

async function sendRestitutionEmail(req, res) {
  try {
    const eventId = req.params.id;
    const event = await prisma.ticketEvent.findFirst({
      where: { id: eventId, countryId: req.countryId },
      select: { id: true, title: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable" });

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "Fichier de restitution requis." });
    }

    const subject = String(req.body?.subject || "").trim() || `FOREVER | Restitution — ${event.title}`;
    const message =
      String(req.body?.message || "").trim() ||
      `Bonjour,\n\nMerci pour votre participation à "${event.title}". Vous trouverez ci-joint le document de restitution de l'événement.\n\nÉquipe FOREVER`;

    const orders = await prisma.ticketOrder.findMany({
      where: { eventId, countryId: req.countryId, status: "PAID" },
      select: { id: true, orderNumber: true, buyerFullName: true, buyerEmail: true },
    });

    const attachments = [
      {
        filename: file.originalname || "restitution.pdf",
        content: file.buffer,
        contentType: file.mimetype || undefined,
      },
    ];

    const results = { sent: [], skippedNoEmail: [], failed: [] };
    // Envoi séquentiel (pas Promise.all) pour ne pas déclencher des dizaines
    // d'envois simultanés vers le même provider SMTP/MailerSend.
    for (const order of orders) {
      const email = normalizeEmail(order.buyerEmail || "");
      if (!email) {
        results.skippedNoEmail.push({ orderId: order.id, orderNumber: order.orderNumber, buyerFullName: order.buyerFullName });
        continue;
      }
      const result = await sendEmail({
        to: email,
        subject,
        body: message,
        attachments,
        metadata: { ticketOrderId: order.id, ticketOrderNumber: order.orderNumber },
      });
      if (result?.accepted) {
        results.sent.push({ orderId: order.id, orderNumber: order.orderNumber, email });
      } else {
        results.failed.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          email,
          errorMessage: result?.errorMessage || "Échec d'envoi",
        });
      }
    }

    return res.json({
      ok: true,
      eventId,
      totalPaidOrders: orders.length,
      sentCount: results.sent.length,
      skippedNoEmailCount: results.skippedNoEmail.length,
      failedCount: results.failed.length,
      results,
    });
  } catch (error) {
    console.error("ticketEvents.sendRestitutionEmail error:", error);
    return res.status(500).json({ message: "Erreur serveur (sendRestitutionEmail)" });
  }
}

module.exports = {
  getEventSummary,
  exportEventOrders,
  exportEventPaymentReport,
  sendRestitutionEmail,
  uploadRestitutionFileMiddleware,
};
