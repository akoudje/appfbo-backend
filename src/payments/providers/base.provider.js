// src/payments/providers/base.provider.js
// Classe de base pour les fournisseurs de paiement, définissant l'interface et les méthodes communes. Chaque fournisseur spécifique (ex: Wave) étend cette classe et implémente les méthodes nécessaires.

class BasePaymentProvider {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  get code() {
    throw new Error("Provider code getter must be implemented");
  }

  async createCheckoutSession(_payload) {
    throw new Error("createCheckoutSession() must be implemented");
  }

  async getCheckoutSession(_payload) {
    throw new Error("getCheckoutSession() must be implemented");
  }

  async parseWebhook(_payload) {
    throw new Error("parseWebhook() must be implemented");
  }
}

module.exports = BasePaymentProvider;