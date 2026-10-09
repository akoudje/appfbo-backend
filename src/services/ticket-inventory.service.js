const prisma = require("../prisma");
function fail(message, statusCode = 400, code = null) {
  throw Object.assign(new Error(message), { statusCode, code });
}
function quantity(value) {
  if (
    !/^\d+$/.test(String(value ?? "")) ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 50
  )
    fail("Choisissez de 1 à 50 billets.");
  return Number(value);
}
function graceMs() {
  const n = Number(
    process.env.TICKET_ORDER_WAVE_FINALIZATION_GRACE_MINUTES ?? 15,
  );
  return (Number.isFinite(n) ? Math.max(0, n) : 15) * 60000;
}
function holdWhere(now = new Date()) {
  return {
    status: { in: ["DRAFT", "PENDING_PAYMENT"] },
    expiresAt: { gt: new Date(now.getTime() - graceMs()) },
  };
}
function pendingOrders(now=new Date()){return {OR:[holdWhere(now),{status:'PAID',ticketIssueCode:null}]};}
function seatWhere(now = new Date()) {
  return {
    OR: [
      { status: { in: ["ACTIVE", "USED"] } },
      { status: "RESERVED", order: { is: pendingOrders(now) } },
    ],
  };
}
async function lockEvent(tx, eventId) {
  await tx.$queryRaw`SELECT id FROM "TicketEvent" WHERE id = ${eventId} FOR UPDATE`;
}
async function lockOrder(tx, orderId) {
  await tx.$queryRaw`SELECT id FROM "TicketOrder" WHERE id = ${orderId} FOR UPDATE`;
}
async function occupied(
  client,
  where,
  excludeOrderId = null,
  now = new Date(),
) {
  const [issued, pending] = await Promise.all([
    client.ticket.count({
      where: {
        ...where,
        ...seatWhere(now),
        ...(excludeOrderId ? { orderId: { not: excludeOrderId } } : {}),
      },
    }),
    client.ticketOrder.aggregate({
      where: {
        ...where,
        ...pendingOrders(now),
        tickets: { none: { status: { in: ["RESERVED", "ACTIVE", "USED"] } } },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
      _sum: { quantity: true },
    }),
  ]);
  return issued + Number(pending._sum.quantity || 0);
}
async function assertCapacity(tx, event, type, qty, excludeOrderId = null) {
  const [global, local] = await Promise.all([
    occupied(tx, { eventId: event.id }, excludeOrderId),
    occupied(tx, { eventId: event.id, ticketTypeId: type.id }, excludeOrderId),
  ]);
  if (
    (event.capacity != null && global + qty > event.capacity) ||
    (type.capacity != null && local + qty > type.capacity)
  )
    fail(
      "Les places disponibles ne suffisent plus. Choisissez une autre quantité ou contactez l’organisateur.",
      409,
      "CAPACITY_CONFLICT",
    );
}
function salesState(event, now = new Date()) {
  if (event.status === "CANCELLED") return "CANCELLED";
  if (event.endsAt && new Date(event.endsAt) <= now) return "ENDED";
  if (
    event.status !== "PUBLISHED" ||
    (event.salesCloseAt && new Date(event.salesCloseAt) <= now)
  )
    return "CLOSED";
  if (event.salesOpenAt && new Date(event.salesOpenAt) > now) return "UPCOMING";
  return "OPEN";
}
function timeZone(code) {
  return (
    {
      CIV: "Africa/Abidjan",
      BFA: "Africa/Ouagadougou",
      TGO: "Africa/Lome",
      BEN: "Africa/Porto-Novo",
      NER: "Africa/Niamey",
      SEN: "Africa/Dakar",
      CMR: "Africa/Douala",
    }[code] || "UTC"
  );
}
async function availability(events, client = prisma) {
  if (!events.length) return new Map();
  const ids = events.map((e) => e.id);
  const [tickets, holds] = await Promise.all([
    client.ticket.groupBy({
      by: ["eventId", "ticketTypeId", "status"],
      where: { eventId: { in: ids }, ...seatWhere() },
      _count: { _all: true },
    }),
    client.ticketOrder.groupBy({
      by: ["eventId", "ticketTypeId"],
      where: {
        eventId: { in: ids },
        ...pendingOrders(),
        tickets: { none: { status: { in: ["RESERVED", "ACTIVE", "USED"] } } },
      },
      _sum: { quantity: true },
    }),
  ]);
  const totals = new Map();
  for (const row of [...tickets, ...holds]) {
    const n = Number(row._count ? row._count._all : row._sum.quantity || 0);
    for (const key of ["event:" + row.eventId, "type:" + row.ticketTypeId])
      totals.set(key, (totals.get(key) || 0) + n);
  }
  return totals;
}
module.exports = {
  fail,
  quantity,
  graceMs,
  holdWhere,
  seatWhere,
  lockEvent,
  lockOrder,
  occupied,
  assertCapacity,
  salesState,
  timeZone,
  availability,
};
