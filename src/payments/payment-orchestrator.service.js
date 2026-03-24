// src/payments/payment-orchestrator.service.js
// Service d'orchestration des paiements, responsable de la gestion des différents fournisseurs de paiement (ex: Wave). 
// Ce service agit comme une façade, permettant au reste de l'application d'interagir avec les fournisseurs de manière uniforme, sans se soucier des détails spécifiques à chaque fournisseur. 
// Il gère l'initialisation des paiements, la récupération de leur statut et le traitement des webhooks en déléguant ces tâches aux classes de fournisseurs correspondantes.


const WaveProvider = require("./providers/wave.provider");

class PaymentOrchestratorService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.providers = {
      WAVE: new WaveProvider({ logger }),
    };
  }

  getProvider(providerCode) {
    const code = String(providerCode || "").trim().toUpperCase();
    const provider = this.providers[code];

    if (!provider) {
      const err = new Error(`Provider non supporté: ${providerCode}`);
      err.statusCode = 400;
      throw err;
    }

    return provider;
  }

  async createCheckoutSession(providerCode, payload) {
    return this.getProvider(providerCode).createCheckoutSession(payload);
  }

  async getCheckoutSession(providerCode, payload) {
    return this.getProvider(providerCode).getCheckoutSession(payload);
  }

  async getCheckoutSessionDetails(providerCode, payload) {
    const provider = this.getProvider(providerCode);
    if (typeof provider.getCheckoutSessionDetails === "function") {
      return provider.getCheckoutSessionDetails(payload);
    }
    return provider.getCheckoutSession(payload);
  }

  async parseWebhook(providerCode, payload) {
    return this.getProvider(providerCode).parseWebhook(payload);
  }
}

module.exports = new PaymentOrchestratorService();
