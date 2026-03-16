// src/payments/providers/wave.provider.js

const crypto = require("crypto");
const BasePaymentProvider = require("./base.provider");

class WaveProvider extends BasePaymentProvider {
  constructor({ logger = console } = {}) {
    super({ logger });
    this.baseUrl = process.env.WAVE_API_BASE_URL || "https://api.wave.com";
    this.apiKey = process.env.WAVE_API_KEY || "";
    this.signingSecret = process.env.WAVE_API_SIGNING_SECRET || "";
    this.webhookSignatureHeader =
      process.env.WAVE_WEBHOOK_SIGNATURE_HEADER || "wave-signature";
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

  verifyWebhookSignature(req) {
    if (!this.signingSecret) return false;

    const rawBody = req.rawBody || "";
    if (!rawBody) return false;

    const signatureHeader =
      req.headers[this.webhookSignatureHeader] ||
      req.headers[this.webhookSignatureHeader.toLowerCase()] ||
      null;

    if (!signatureHeader) return false;

    // Format attendu configurable type: t=...,v1=...
    const parts = String(signatureHeader)
      .split(",")
      .map((x) => x.trim());

    const timestampPart = parts.find((x) => x.startsWith("t="));
    const signaturePart = parts.find((x) => x.startsWith("v1="));

    if (!timestampPart || !signaturePart) return false;

    const timestamp = timestampPart.slice(2);
    const receivedSignature = signaturePart.slice(3);

    const payload = `${timestamp}${rawBody}`;
    const expectedSignature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(payload)
      .digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(receivedSignature, "hex"),
        Buffer.from(expectedSignature, "hex")
      );
    } catch {
      return false;
    }
  }

  async parseWebhook({ req }) {
    return {
      provider: this.code,
      signatureValid: this.verifyWebhookSignature(req),
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