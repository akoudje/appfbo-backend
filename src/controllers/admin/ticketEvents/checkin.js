// Contrôle d'accès : sessions de scan, validation d'un billet (QR ou code),
// journal d'audit et résumé en temps réel. Ce domaine a son propre jeu
// d'helpers (masquage, normalisation de la valeur scannée, construction du
// log) qui n'est utile qu'ici, d'où leur portée locale à ce fichier.

const prisma = require("../../../prisma");
const { Permission } = require("../../../auth/permissions");

function includeCheckInDetails() {
  return {
    event: { select: { id: true, title: true, startsAt: true, venueName: true } },
    ticketType: { select: { id: true, label: true, priceFcfa: true } },
    order: { select: { id: true, orderNumber: true, buyerFullName: true, buyerPhone: true } },
    session: { select: { id: true, entryPoint: true, openedAt: true, closedAt: true } },
    checkedBy: { select: { id: true, fullName: true, email: true } },
    ticket: {
      select: {
        id: true,
        ticketCode: true,
        holderFullName: true,
        status: true,
        checkedInAt: true,
      },
    },
  };
}

function normalizeEntryPoint(value) {
  const normalized = String(value || "").trim();
  return normalized || "Entrée principale";
}

function maskScannedValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length <= 16) return raw;
  return `${raw.slice(0, 8)}...${raw.slice(-6)}`;
}

function normalizeScannedTicketValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const queryToken =
      url.searchParams.get("ticket") ||
      url.searchParams.get("token") ||
      url.searchParams.get("qr") ||
      url.searchParams.get("code");
    if (queryToken && String(queryToken).trim()) return String(queryToken).trim();

    const segments = url.pathname.split("/").map((segment) => segment.trim()).filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "";
    if (lastSegment) return decodeURIComponent(lastSegment);
  } catch {
    // Le QR contient normalement le token brut, pas une URL.
  }

  return raw;
}

function buildCheckInLogData({
  req,
  ticket = null,
  eventId = null,
  session = null,
  entryPoint = null,
  scannedValue = null,
  result,
  reason,
  ticketStatusBefore = null,
  ticketStatusAfter = null,
  clientRequestId = null,
}) {
  return {
    countryId: req.countryId,
    eventId: ticket?.eventId || eventId || null,
    ticketTypeId: ticket?.ticketTypeId || null,
    ticketId: ticket?.id || null,
    orderId: ticket?.orderId || null,
    sessionId: session?.id || null,
    checkedById: req.user?.id || null,
    entryPoint: session?.entryPoint || entryPoint || null,
    scannedValue: maskScannedValue(scannedValue),
    ticketCode: ticket?.ticketCode || null,
    result,
    reason,
    ticketStatusBefore,
    ticketStatusAfter,
    clientRequestId,
    metadata: {
      userAgent: req.get?.("user-agent") || null,
    },
  };
}

// Rejoue le résultat déjà obtenu pour une tentative de scan identifiée par
// clientRequestId (généré côté app à chaque scan). Sans ça, un scan qui a
// réussi côté serveur mais dont la réponse s'est perdue en route (coupure
// réseau) serait retraité au retry et renverrait à tort "déjà utilisé" au
// lieu du succès initial.
async function findReplayResponse(clientRequestId, countryId) {
  if (!clientRequestId) return null;
  const existing = await prisma.ticketCheckInLog.findFirst({
    where: { clientRequestId, countryId },
    include: includeCheckInDetails(),
  });
  if (!existing) return null;

  if (existing.result === "NOT_FOUND") {
    return { status: 404, body: { message: "Billet introuvable.", log: existing } };
  }
  if (existing.result === "WRONG_EVENT") {
    return {
      status: 409,
      body: { message: "Ce billet appartient à un autre événement.", ticket: existing.ticket, log: existing },
    };
  }
  if (existing.result === "ALREADY_USED") {
    return { status: 409, body: { message: "Billet déjà utilisé.", ticket: existing.ticket, log: existing } };
  }
  if (existing.result === "INACTIVE") {
    return { status: 400, body: { message: "Billet non actif.", ticket: existing.ticket, log: existing } };
  }

  const fullTicket = existing.ticketId
    ? await prisma.ticket.findUnique({
        where: { id: existing.ticketId },
        include: {
          event: true,
          ticketType: true,
          order: true,
          checkedInBy: { select: { id: true, fullName: true, email: true } },
        },
      })
    : null;
  return { status: 200, body: { ...(fullTicket || existing.ticket || {}), checkInLog: existing } };
}

async function checkInTicket(req, res) {
  try {
    const { tokenOrCode, eventId, sessionId, entryPoint } = req.body || {};
    const clientRequestId = String(req.body?.clientRequestId || "").trim() || null;

    if (clientRequestId) {
      const replay = await findReplayResponse(clientRequestId, req.countryId);
      if (replay) return res.status(replay.status).json(replay.body);
    }

    const raw = normalizeScannedTicketValue(tokenOrCode);
    const expectedEventId = String(eventId || "").trim();
    if (!raw) return res.status(400).json({ message: "Code billet ou QR requis." });

    let session = null;
    if (sessionId) {
      session = await prisma.ticketCheckInSession.findFirst({
        where: {
          id: String(sessionId),
          countryId: req.countryId,
          ...(expectedEventId ? { eventId: expectedEventId } : {}),
        },
      });
      if (!session) return res.status(404).json({ message: "Session de contrôle introuvable." });
      if (session.closedAt) return res.status(400).json({ message: "Session de contrôle déjà fermée." });
      // Un agent ne doit pouvoir scanner que sur SA propre session : sinon,
      // n'importe quel titulaire de TICKET_CHECKIN connaissant l'id d'une
      // session ouverte par un collègue pourrait l'utiliser à sa place.
      if (session.agentId && session.agentId !== req.user?.id) {
        return res.status(403).json({ message: "Cette session de contrôle appartient à un autre agent." });
      }
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        countryId: req.countryId,
        OR: [{ qrToken: raw }, { ticketCode: raw.toUpperCase() }],
      },
      include: {
        event: true,
        ticketType: true,
        order: true,
        checkedInBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!ticket) {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          eventId: expectedEventId || null,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "NOT_FOUND",
          reason: "Billet introuvable.",
          clientRequestId,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(404).json({ message: "Billet introuvable.", log });
    }
    if (expectedEventId && ticket.eventId !== expectedEventId) {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          eventId: expectedEventId,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "WRONG_EVENT",
          reason: "Ce billet appartient à un autre événement.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
          clientRequestId,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(409).json({ message: "Ce billet appartient à un autre événement.", ticket, log });
    }
    if (ticket.status === "USED") {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "ALREADY_USED",
          reason: "Billet déjà utilisé.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
          clientRequestId,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(409).json({ message: "Billet déjà utilisé.", ticket, log });
    }
    if (ticket.status !== "ACTIVE") {
      const log = await prisma.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "INACTIVE",
          reason: "Billet non actif.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: ticket.status,
          clientRequestId,
        }),
        include: includeCheckInDetails(),
      });
      return res.status(400).json({ message: "Billet non actif.", ticket, log });
    }

    const { updated, log, alreadyUsed } = await prisma.$transaction(async (tx) => {
      const checkInTime = new Date();
      const claim = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "ACTIVE", checkedInAt: null },
        data: {
          status: "USED",
          checkedInAt: checkInTime,
          checkedInById: req.user?.id || null,
        },
      });

      const checkedTicket = await tx.ticket.findUnique({
        where: { id: ticket.id },
        include: {
          event: true,
          ticketType: true,
          order: true,
          checkedInBy: { select: { id: true, fullName: true, email: true } },
        },
      });

      if (!claim.count) {
        const duplicateLog = await tx.ticketCheckInLog.create({
          data: buildCheckInLogData({
            req,
            ticket: checkedTicket || ticket,
            session,
            entryPoint: normalizeEntryPoint(entryPoint),
            scannedValue: raw,
            result: "ALREADY_USED",
            reason: "Billet déjà utilisé.",
            ticketStatusBefore: ticket.status,
            ticketStatusAfter: checkedTicket?.status || ticket.status,
            clientRequestId,
          }),
          include: includeCheckInDetails(),
        });
        return { updated: checkedTicket || ticket, log: duplicateLog, alreadyUsed: true };
      }

      const checkInLog = await tx.ticketCheckInLog.create({
        data: buildCheckInLogData({
          req,
          ticket,
          session,
          entryPoint: normalizeEntryPoint(entryPoint),
          scannedValue: raw,
          result: "ACCEPTED",
          reason: "Entrée validée.",
          ticketStatusBefore: ticket.status,
          ticketStatusAfter: "USED",
          clientRequestId,
        }),
        include: includeCheckInDetails(),
      });
      return { updated: checkedTicket, log: checkInLog, alreadyUsed: false };
    });

    if (alreadyUsed) {
      return res.status(409).json({ message: "Billet déjà utilisé.", ticket: updated, log });
    }

    return res.json({ ...updated, checkInLog: log });
  } catch (error) {
    if (error?.code === "P2002") {
      const target = Array.isArray(error?.meta?.target)
        ? error.meta.target.join(",")
        : String(error?.meta?.target || "");
      if (target.includes("clientRequestId")) {
        // Requête concurrente identique (même retry envoyé deux fois en
        // parallèle) : l'autre a créé le log en premier, on relit son résultat.
        const clientRequestId = String(req.body?.clientRequestId || "").trim() || null;
        const replay = await findReplayResponse(clientRequestId, req.countryId).catch(() => null);
        if (replay) return res.status(replay.status).json(replay.body);
      }
    }
    console.error("ticketEvents.checkInTicket error:", error);
    return res.status(500).json({ message: "Erreur serveur (checkInTicket)" });
  }
}

async function openCheckInSession(req, res) {
  try {
    const { eventId, entryPoint, deviceName } = req.body || {};
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return res.status(400).json({ message: "Événement requis." });

    const event = await prisma.ticketEvent.findFirst({
      where: { id: normalizedEventId, countryId: req.countryId },
      select: { id: true },
    });
    if (!event) return res.status(404).json({ message: "Événement introuvable." });

    const session = await prisma.ticketCheckInSession.create({
      data: {
        countryId: req.countryId,
        eventId: event.id,
        agentId: req.user?.id || null,
        entryPoint: normalizeEntryPoint(entryPoint),
        deviceName: deviceName ? String(deviceName).trim().slice(0, 120) : null,
      },
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        agent: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.status(201).json(session);
  } catch (error) {
    console.error("ticketEvents.openCheckInSession error:", error);
    return res.status(500).json({ message: "Erreur serveur (openCheckInSession)" });
  }
}

async function closeCheckInSession(req, res) {
  try {
    const session = await prisma.ticketCheckInSession.findFirst({
      where: { id: req.params.sessionId, countryId: req.countryId },
    });
    if (!session) return res.status(404).json({ message: "Session de contrôle introuvable." });

    // Seul l'agent propriétaire peut fermer sa session ; un titulaire de
    // MARKETING_WRITE (admin événementiel) garde la main pour débloquer une
    // session orpheline (ex. agent parti sans fermer, device perdu).
    if (session.agentId && session.agentId !== req.user?.id) {
      const permissions = req.user?.permissions || [];
      if (!permissions.includes(Permission.MARKETING_WRITE)) {
        return res.status(403).json({ message: "Cette session de contrôle appartient à un autre agent." });
      }
    }

    const updated = await prisma.ticketCheckInSession.update({
      where: { id: session.id },
      data: { closedAt: session.closedAt || new Date() },
      include: {
        event: { select: { id: true, title: true, startsAt: true } },
        agent: { select: { id: true, fullName: true, email: true } },
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error("ticketEvents.closeCheckInSession error:", error);
    return res.status(500).json({ message: "Erreur serveur (closeCheckInSession)" });
  }
}

async function listCheckInLogs(req, res) {
  try {
    const { eventId, sessionId, result, q } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (sessionId) where.sessionId = String(sessionId);
    if (result) where.result = String(result).trim().toUpperCase();
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { ticketCode: { contains: term, mode: "insensitive" } },
        { scannedValue: { contains: term, mode: "insensitive" } },
        { ticket: { holderFullName: { contains: term, mode: "insensitive" } } },
        { order: { buyerFullName: { contains: term, mode: "insensitive" } } },
      ];
    }

    const logs = await prisma.ticketCheckInLog.findMany({
      where,
      orderBy: [{ scannedAt: "desc" }],
      take: 200,
      include: includeCheckInDetails(),
    });

    return res.json({ data: logs });
  } catch (error) {
    console.error("ticketEvents.listCheckInLogs error:", error);
    return res.status(500).json({ message: "Erreur serveur (listCheckInLogs)" });
  }
}

async function getCheckInSummary(req, res) {
  try {
    const { eventId, sessionId } = req.query;
    const where = { countryId: req.countryId };
    if (eventId) where.eventId = String(eventId);
    if (sessionId) where.sessionId = String(sessionId);

    const [byResult, activeSessions, totalTickets, usedTickets] = await Promise.all([
      prisma.ticketCheckInLog.groupBy({
        by: ["result"],
        where,
        _count: { result: true },
      }),
      prisma.ticketCheckInSession.findMany({
        where: {
          countryId: req.countryId,
          ...(eventId ? { eventId: String(eventId) } : {}),
          closedAt: null,
        },
        orderBy: [{ openedAt: "desc" }],
        take: 20,
        include: {
          agent: { select: { id: true, fullName: true, email: true } },
        },
      }),
      eventId
        ? prisma.ticket.count({ where: { countryId: req.countryId, eventId: String(eventId), status: { in: ["ACTIVE", "USED"] } } })
        : Promise.resolve(0),
      eventId
        ? prisma.ticket.count({ where: { countryId: req.countryId, eventId: String(eventId), status: "USED" } })
        : Promise.resolve(0),
    ]);

    const counts = byResult.reduce((acc, item) => {
      acc[item.result] = item._count.result;
      return acc;
    }, {});
    const accepted = counts.ACCEPTED || 0;
    const refused = Object.entries(counts).reduce(
      (sum, [key, value]) => (key === "ACCEPTED" ? sum : sum + value),
      0,
    );

    return res.json({
      counts,
      accepted,
      refused,
      totalScans: accepted + refused,
      totalTickets,
      usedTickets,
      remainingTickets: Math.max(0, totalTickets - usedTickets),
      activeSessions,
    });
  } catch (error) {
    console.error("ticketEvents.getCheckInSummary error:", error);
    return res.status(500).json({ message: "Erreur serveur (getCheckInSummary)" });
  }
}

module.exports = {
  checkInTicket,
  openCheckInSession,
  closeCheckInSession,
  listCheckInLogs,
  getCheckInSummary,
};
