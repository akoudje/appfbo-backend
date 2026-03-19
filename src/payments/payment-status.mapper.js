// src/payments/payment-status.mapper.js
// Mapping Wave -> statuts Prisma internes
// Cette fonction prend un objet session de Wave et retourne un objet avec les statuts internes correspondants pour Payment, PaymentAttempt et Preorder, ainsi que des flags pour indiquer les actions à prendre sur la commande.

function mapWaveSessionToInternal(session = {}) {
  const checkoutStatus = String(session.checkout_status || "").toLowerCase();
  const paymentStatus = String(session.payment_status || "").toLowerCase();

  // Paiement réussi
  if (paymentStatus === "succeeded" || checkoutStatus === "complete") {
    return {
      paymentStatus: "SUCCEEDED",
      attemptStatus: "SUCCEEDED",
      orderPaymentStatus: "PAID",
      markOrderPaid: true,
      markFailed: false,
      markExpired: false,
      markCancelled: false,
      isFinal: true,
      reason: "wave_succeeded",
    };
  }

  // Expiré
  if (checkoutStatus === "expired") {
    return {
      paymentStatus: "EXPIRED",
      attemptStatus: "EXPIRED",
      orderPaymentStatus: "PAYMENT_PENDING",
      markOrderPaid: false,
      markFailed: false,
      markExpired: true,
      markCancelled: false,
      isFinal: true,
      reason: "wave_expired",
    };
  }

  // Annulé
  if (paymentStatus === "cancelled") {
    return {
      paymentStatus: "CANCELLED",
      attemptStatus: "CANCELLED",
      orderPaymentStatus: "PAYMENT_PENDING",
      markOrderPaid: false,
      markFailed: false,
      markExpired: false,
      markCancelled: true,
      isFinal: true,
      reason: "wave_cancelled",
    };
  }

  // Échec explicite éventuel
  if (
    paymentStatus === "failed" ||
    paymentStatus === "error" ||
    checkoutStatus === "failed"
  ) {
    return {
      paymentStatus: "FAILED",
      attemptStatus: "FAILED",
      orderPaymentStatus: "PAYMENT_PENDING",
      markOrderPaid: false,
      markFailed: true,
      markExpired: false,
      markCancelled: false,
      isFinal: true,
      reason: "wave_failed",
    };
  }

  // En attente / processing
  return {
    paymentStatus: "PROCESSING",
    attemptStatus: "PENDING",
    orderPaymentStatus: "PAYMENT_PENDING",
    markOrderPaid: false,
    markFailed: false,
    markExpired: false,
    markCancelled: false,
    isFinal: false,
    reason: "wave_processing",
  };
}

module.exports = {
  mapWaveSessionToInternal,
};