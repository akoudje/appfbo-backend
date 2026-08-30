// Utilitaires partagés entre les sous-contrôleurs du module billetterie
// (events, orders, checkin, reports). Rien d'ici n'est spécifique à un seul
// domaine : cette limite est ce qui justifie leur présence dans ce fichier
// plutôt que dupliqués ou logés dans l'un des sous-contrôleurs.

const PAYMENT_METHOD_ALIASES = {
  CASH: ["CASH", "ESPECES", "ESPÈCES", "ESPECES_AU_GUICHET"],
  WAVE: ["WAVE"],
};

function classifyPaymentMethodCategory(order) {
  const value = String(order?.paymentMethod || order?.paymentProvider || "").trim().toUpperCase();
  if (!value) return "OTHER";
  if (PAYMENT_METHOD_ALIASES.CASH.includes(value)) return "CASH";
  if (PAYMENT_METHOD_ALIASES.WAVE.includes(value)) return "WAVE";
  return "OTHER";
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  const header = columns.map((col) => csvEscape(col.label)).join(";");
  const lines = rows.map((row) =>
    columns.map((col) => csvEscape(col.value(row))).join(";"),
  );
  // BOM UTF-8 pour qu'Excel affiche correctement les accents à l'ouverture.
  return `﻿${[header, ...lines].join("\r\n")}`;
}

function sendCsv(res, filename, csvContent) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(csvContent);
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePositiveInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function includeEventDetails() {
  return {
    ticketTypes: {
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: { in: ["ACTIVE", "USED"] } },
            },
          },
        },
      },
    },
    _count: {
      select: {
        ticketOrders: true,
        tickets: true,
      },
    },
  };
}

function buildOrdersWhere(req, { eventId, status, q, paymentMethod } = {}) {
  const where = { countryId: req.countryId };
  if (eventId) where.eventId = String(eventId);
  if (status) where.status = String(status).trim().toUpperCase();
  if (paymentMethod) {
    const normalizedPaymentMethod = String(paymentMethod).trim().toUpperCase();
    const knownValues = [...PAYMENT_METHOD_ALIASES.CASH, ...PAYMENT_METHOD_ALIASES.WAVE];
    const paymentMatches = (values) =>
      values.flatMap((value) => [
        { paymentMethod: { equals: value, mode: "insensitive" } },
        { paymentProvider: { equals: value, mode: "insensitive" } },
      ]);
    if (normalizedPaymentMethod === "OTHER") {
      where.AND = [
        ...(where.AND || []),
        {
          NOT: { OR: paymentMatches(knownValues) },
        },
      ];
    } else {
      const values = PAYMENT_METHOD_ALIASES[normalizedPaymentMethod] || [normalizedPaymentMethod];
      where.AND = [
        ...(where.AND || []),
        { OR: paymentMatches(values) },
      ];
    }
  }
  if (q && String(q).trim()) {
    const term = String(q).trim();
    where.OR = [
      { orderNumber: { contains: term, mode: "insensitive" } },
      { buyerFullName: { contains: term, mode: "insensitive" } },
      { buyerPhone: { contains: term, mode: "insensitive" } },
      { buyerFboNumber: { contains: term, mode: "insensitive" } },
    ];
  }
  return where;
}

module.exports = {
  PAYMENT_METHOD_ALIASES,
  classifyPaymentMethodCategory,
  csvEscape,
  toCsv,
  sendCsv,
  normalizeSlug,
  parseDate,
  parsePositiveInt,
  digitsOnly,
  includeEventDetails,
  buildOrdersWhere,
};
