// Fermeture d'une session de paiement Wave encore ouverte (un seul lien actif).
// Une session déjà payée ou en cours de paiement n'est jamais fermée : elle
// est signalée (paid / processing) pour que l'appelant n'en ouvre pas d'autre.
const paymentOrchestrator = require("./payment-orchestrator.service");

async function closeWaveCheckoutSession(providerSessionId, { simulated = false } = {}) {
  const result = { closed: false, paid: false, processing: false, failed: false };
  if (!providerSessionId) return { ...result, closed: true };
  if (simulated || String(providerSessionId).startsWith("wave_sim_")) return { ...result, closed: true };
  try {
    await paymentOrchestrator.expireCheckoutSession("WAVE", { providerSessionId });
    return { ...result, closed: true };
  } catch (error) {
    try {
      const session = await paymentOrchestrator.getCheckoutSession("WAVE", { providerSessionId });
      const paymentStatus = String(session?.paymentStatus || "").toLowerCase();
      const checkoutStatus = String(session?.checkoutStatus || "").toLowerCase();
      if (paymentStatus === "succeeded") return { ...result, paid: true, session };
      if (paymentStatus === "processing" && checkoutStatus === "open") return { ...result, processing: true, session };
      if (["expired", "complete"].includes(checkoutStatus)) return { ...result, closed: true, session };
    } catch (_lookupError) {
      // Session introuvable ou Wave indisponible : traité comme un échec.
    }
    return { ...result, failed: true, error };
  }
}

module.exports = { closeWaveCheckoutSession };
