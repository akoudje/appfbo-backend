// src/payments/providers/wave.provider.js
// Implémentation du fournisseur de paiement Wave, étendant la classe de base et utilisant l'API de Wave pour créer des sessions de paiement, récupérer leur statut et traiter les webhooks. La classe gère également la validation de configuration et la construction des requêtes HTTP vers l'API de Wave.

const crypto = require("crypto");
const BasePaymentProvider = require("./base.provider");

class WaveProvider extends BasePaymentProvider {
  constructor({ logger = console } = {}) {
    super({ logger });
    this.baseUrl = process.env.WAVE_API_BASE_URL || "https://api.wave.com";
    this.apiKey = process.env.WAVE_API_KEY || "";
    this.signingSecret = process.env.WAVE_API_SIGNING_SECRET || "";
  }

  get code() {
    return "WAVE";
  }

  ensureConfigured() {
    if (!this.apiKey) {
      const err = new Error("WAVE_API_KEY manquante");
      err.statusCode = 500;
      throw err;
    }
  }

  buildHeaders(bodyString = "") {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    if (this.signingSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = `${timestamp}${bodyString}`;
      const signature = crypto
        .createHmac("sha256", this.signingSecret)
        .update(payload)
        .digest("hex");

      headers["Wave-Signature"] = `t=${timestamp},v1=${signature}`;
    }

    return headers;
  }

  async http(path, { method = "GET", body } = {}) {
    this.ensureConfigured();

    const bodyString = body ? JSON.stringify(body) : "";
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(bodyString),
      body: body ? bodyString : undefined,
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { raw: rawText };
    }

    if (!response.ok) {
      const err = new Error(
        data?.message ||
          data?.error ||
          `Wave API error (${response.status})`
      );
      err.statusCode = response.status;
      err.details = data;
      throw err;
    }

    return data;
  }

  async createCheckoutSession({
    amountFcfa,
    successUrl,
    errorUrl,
    clientReference,
    restrictPayerMobile,
  }) {
    const payload = {
      amount: String(amountFcfa),
      currency: "XOF",
      success_url: successUrl,
      error_url: errorUrl,
      client_reference: clientReference,
    };

    if (restrictPayerMobile) {
      payload.restrict_payer_mobile = restrictPayerMobile;
    }

    const session = await this.http("/v1/checkout/sessions", {
      method: "POST",
      body: payload,
    });

    return {
      provider: this.code,
      raw: session,
      providerSessionId: session?.id || null,
      providerTransactionId: session?.transaction_id || null,
      checkoutUrl: session?.wave_launch_url || null,
      providerLaunchUrl: session?.wave_launch_url || null,
      clientReference: session?.client_reference || clientReference || null,
      checkoutStatus: session?.checkout_status || null,
      paymentStatus: session?.payment_status || null,
    };
  }

  async getCheckoutSession({ providerSessionId }) {
    if (!providerSessionId) {
      const err = new Error("providerSessionId requis");
      err.statusCode = 400;
      throw err;
    }

    const session = await this.http(
      `/v1/checkout/sessions/${encodeURIComponent(providerSessionId)}`
    );

    return {
      provider: this.code,
      raw: session,
      providerSessionId: session?.id || providerSessionId,
      providerTransactionId: session?.transaction_id || null,
      checkoutUrl: session?.wave_launch_url || null,
      providerLaunchUrl: session?.wave_launch_url || null,
      clientReference: session?.client_reference || null,
      checkoutStatus: session?.checkout_status || null,
      paymentStatus: session?.payment_status || null,
      completedAt: session?.when_completed || null,
    };
  }

  async parseWebhook({ req }) {
    // V1 : on stocke le payload brut. La validation de signature pourra être renforcée après.
    return {
      provider: this.code,
      signatureValid: false,
      providerEventId:
        req.body?.id ||
        req.body?.event_id ||
        req.headers["x-wave-event-id"] ||
        null,
      eventType: req.body?.type || req.body?.event_type || null,
      body: req.body,
      headers: req.headers,
    };
  }
}

module.exports = WaveProvider;