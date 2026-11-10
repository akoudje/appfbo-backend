// Validité d'un lien de paiement Wave de précommande.
//
// Règles validées le 2026-11-10 :
// - un lien est valable 3 h après son envoi, au maximum ;
// - seul le dernier lien envoyé est valable : chaque nouvel envoi rend les
//   précédents inutilisables (le jeton porte sa date d'émission, la commande
//   garde celle du dernier lien dans `paymentLinkIssuedAt`) ;
// - un lien ne sert qu'à un seul paiement : une commande payée, annulée ou
//   sortie du circuit de paiement refuse tout nouveau paiement.
//
// Module pur (aucun accès base) : la lecture des données et la signature des
// jetons restent dans payments.service.js.

const PAYMENT_LINK_TTL_MS = 3 * 60 * 60 * 1000;

// Un lien encore récent (même envoi : facture puis notification) est réutilisé
// tel quel ; au-delà, tout nouvel envoi émet un nouveau lien.
const PAYMENT_LINK_REISSUE_AFTER_MS = 15 * 60 * 1000;

const PAYABLE_STATUSES = new Set(["INVOICED", "PAYMENT_PENDING"]);

const LINK_STATE_MESSAGES = {
  ORDER_PAID: "Cette commande est déjà payée. Ce lien ne peut plus être utilisé.",
  ORDER_CANCELLED:
    "Cette commande a été annulée. Ce lien ne peut plus être utilisé. Contactez votre agent de vente.",
  NOT_PAYABLE: "Cette commande n'est pas payable en ligne pour le moment. Contactez votre agent de vente.",
  LINK_REPLACED:
    "Ce lien a été remplacé par un lien plus récent. Utilisez le dernier lien reçu par SMS ou e-mail, ou demandez un nouveau lien.",
  LINK_EXPIRED: "Ce lien de paiement a expiré (validité 3 h). Demandez un nouveau lien.",
};

function toLinkSecond(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor(time / 1000);
}

function isOrderPaid(preorder) {
  return (
    String(preorder?.status || "").toUpperCase() === "PAID" ||
    String(preorder?.paymentStatus || "").toUpperCase() === "PAID" ||
    String(preorder?.activePayment?.status || "").toUpperCase() === "SUCCEEDED"
  );
}

// tokenIssuedSec : date d'émission portée par le jeton (secondes), ou null
//   pour un lien sans jeton daté (ancien format, page commande du portail).
// legacyToken : vrai pour un jeton de l'ancien format (non daté).
// legacyIssuedAt : date du dernier envoi de lien connu quand la commande n'a
//   pas encore de `paymentLinkIssuedAt` (liens envoyés avant ce changement).
function evaluatePaymentLinkWindow(
  preorder,
  { tokenIssuedSec = null, legacyToken = false, legacyIssuedAt = null, now = new Date() } = {},
) {
  const result = (code, extra = {}) => ({
    ok: code === "OK",
    code,
    message: LINK_STATE_MESSAGES[code] || null,
    canRequestNewLink: code === "LINK_EXPIRED" || code === "LINK_REPLACED",
    ...extra,
  });

  if (isOrderPaid(preorder)) return result("ORDER_PAID");
  const status = String(preorder?.status || "").toUpperCase();
  if (status === "CANCELLED") return result("ORDER_CANCELLED");
  if (!PAYABLE_STATUSES.has(status)) return result("NOT_PAYABLE");

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const currentSec = toLinkSecond(preorder?.paymentLinkIssuedAt);

  let issuedSec;
  if (tokenIssuedSec !== null && tokenIssuedSec !== undefined) {
    // Seul le dernier lien émis est valable.
    if (currentSec !== null && tokenIssuedSec !== currentSec) return result("LINK_REPLACED");
    issuedSec = tokenIssuedSec;
  } else if (legacyToken && currentSec !== null) {
    // Ancien lien non daté alors qu'un lien daté a été envoyé depuis.
    return result("LINK_REPLACED");
  } else {
    issuedSec = currentSec ?? toLinkSecond(legacyIssuedAt);
  }

  if (issuedSec === null) return result("LINK_EXPIRED");
  const expiresAtMs = issuedSec * 1000 + PAYMENT_LINK_TTL_MS;
  if (nowMs >= expiresAtMs) {
    return result("LINK_EXPIRED", { expiresAt: new Date(expiresAtMs) });
  }
  return result("OK", { issuedAt: new Date(issuedSec * 1000), expiresAt: new Date(expiresAtMs) });
}

// Commande encore payable en ligne (ni payée, ni annulée, ni hors circuit),
// indépendamment de la validité du dernier lien.
function isPreorderPayableOnline(preorder) {
  if (isOrderPaid(preorder)) return false;
  return PAYABLE_STATUSES.has(String(preorder?.status || "").toUpperCase());
}

// Faut-il émettre un nouveau lien pour cet envoi ? Oui sauf si tous les liens
// du message sont le lien courant, émis il y a moins de 15 min.
function shouldReissuePaymentLink(preorder, tokenIssuedSecs, now = new Date()) {
  const currentSec = toLinkSecond(preorder?.paymentLinkIssuedAt);
  if (currentSec === null || !tokenIssuedSecs.length) return true;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (nowMs - currentSec * 1000 >= PAYMENT_LINK_REISSUE_AFTER_MS) return true;
  return tokenIssuedSecs.some((sec) => sec !== currentSec);
}

module.exports = {
  PAYMENT_LINK_TTL_MS,
  PAYMENT_LINK_REISSUE_AFTER_MS,
  PAYABLE_STATUSES,
  LINK_STATE_MESSAGES,
  toLinkSecond,
  isOrderPaid,
  isPreorderPayableOnline,
  evaluatePaymentLinkWindow,
  shouldReissuePaymentLink,
};
