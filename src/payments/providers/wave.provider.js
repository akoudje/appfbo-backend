// src/payments/providers/wave.provider.js
// Implémentation du provider de paiement Wave

const crypto = require("crypto");
const BasePaymentProvider = require("./base.provider");

class WaveProvider extends BasePaymentProvider {
  constructor({ logger = console } = {}) {
    super({ logger });

    this.baseUrl = process.env.WAVE_API_BASE_URL || "https://api.wave.com";
    this.apiKey = process.env.WAVE_API_KEY || "";

    // Secret pour SIGNER les requêtes sortantes vers Wave
    this.apiSigningSecret = process.env.WAVE_API_SIGNING_SECRET || "";

    // Secret pour VÉRIFIER les webhooks entrants Wave
    this.webhookSecret = process.env.WAVE_WEBHOOK_SECRET || "";

    this.webhookSignatureHeader =
      process.env.WAVE_WEBHOOK_SIGNATURE_HEADER || "wave-signature";

    this.webhookToleranceSeconds = Number(
      process.env.WAVE_WEBHOOK_TOLERANCE_SECONDS || 300
    );
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

    // Si request signing est activé sur la clé API, Wave exige Wave-Signature
    if (this.apiSigningSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = `${timestamp}${bodyString}`;
      const signature = crypto
        .createHmac("sha256", this.apiSigningSecret)
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
          data?.details?.message ||
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
      providerPayerPhone:
        session?.payerPhone ||
        session?.customer_msisdn ||
        session?.phone_number ||
        session?.sender_phone ||
        session?.payment_method?.phone_number ||
        session?.payment_method?.payer_phone ||
        session?.payment_method?.customer_msisdn ||
        null,
      providerStatusLabel:
        session?.payment_status_label ||
        session?.checkout_status_label ||
        session?.status_label ||
        null,
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
      providerPayerPhone:
        session?.payerPhone ||
        session?.customer_msisdn ||
        session?.phone_number ||
        session?.sender_phone ||
        session?.payment_method?.phone_number ||
        session?.payment_method?.payer_phone ||
        session?.payment_method?.customer_msisdn ||
        null,
      providerStatusLabel:
        session?.payment_status_label ||
        session?.checkout_status_label ||
        session?.status_label ||
        null,
      checkoutUrl: session?.wave_launch_url || null,
      providerLaunchUrl: session?.wave_launch_url || null,
      clientReference: session?.client_reference || null,
      checkoutStatus: session?.checkout_status || null,
      paymentStatus: session?.payment_status || null,
      completedAt: session?.when_completed || null,
    };
  }

  getHeader(req, name) {
    const lower = String(name || "").toLowerCase();
    return (
      req.headers?.[name] ||
      req.headers?.[lower] ||
      req.get?.(name) ||
      null
    );
  }

  parseWaveSignatureHeader(signatureHeader) {
    if (!signatureHeader) {
      return {
        timestamp: null,
        signatures: [],
      };
    }

    const parts = String(signatureHeader)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const timestampPart = parts.find((x) => x.startsWith("t="));
    const signatureParts = parts.filter((x) => x.startsWith("v1="));

    return {
      timestamp: timestampPart ? timestampPart.slice(2) : null,
      signatures: signatureParts.map((x) => x.slice(3)).filter(Boolean),
    };
  }

  isWebhookTimestampFresh(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;

    const now = Math.floor(Date.now() / 1000);
    return Math.abs(now - ts) <= this.webhookToleranceSeconds;
  }

  verifyWebhookSignature(req) {
    if (!this.webhookSecret) {
      return {
        valid: false,
        mode: "missing_secret",
        reason: "WAVE_WEBHOOK_SECRET manquant",
      };
    }

    const rawBody = req.rawBody || "";
    if (!rawBody) {
      return {
        valid: false,
        mode: "missing_raw_body",
        reason: "req.rawBody manquant",
      };
    }

    const signatureHeader = this.getHeader(req, this.webhookSignatureHeader);

    // Mode recommandé: signing secret via Wave-Signature
    if (signatureHeader) {
      const { timestamp, signatures } =
        this.parseWaveSignatureHeader(signatureHeader);

      if (!timestamp || signatures.length === 0) {
        return {
          valid: false,
          mode: "signature",
          reason: "Header Wave-Signature invalide",
        };
      }

      if (!this.isWebhookTimestampFresh(timestamp)) {
        return {
          valid: false,
          mode: "signature",
          reason: "Timestamp webhook expiré",
        };
      }

      const payload = `${timestamp}${rawBody}`;
      const expectedSignature = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(payload)
        .digest("hex");

      const valid = signatures.some((receivedSignature) => {
        try {
          return crypto.timingSafeEqual(
            Buffer.from(receivedSignature, "hex"),
            Buffer.from(expectedSignature, "hex")
          );
        } catch {
          return false;
        }
      });

      return {
        valid,
        mode: "signature",
        reason: valid ? null : "Signature webhook invalide",
      };
    }

    // Mode alternatif: shared secret dans Authorization: Bearer <secret>
    const authHeader = this.getHeader(req, "authorization");
    if (authHeader) {
      const expected = `Bearer ${this.webhookSecret}`;
      const valid = authHeader === expected;

      return {
        valid,
        mode: "shared_secret",
        reason: valid ? null : "Authorization webhook invalide",
      };
    }

    return {
      valid: false,
      mode: "missing_auth",
      reason: "Aucun mécanisme d'authentification webhook trouvé",
    };
  }

  async parseWebhook({ req }) {
    const signature = this.verifyWebhookSignature(req);

    return {
      provider: this.code,
      signatureValid: signature.valid,
      signatureMode: signature.mode,
      signatureReason: signature.reason,
      providerEventId:
        req.body?.id ||
        req.body?.event_id ||
        this.getHeader(req, "x-wave-event-id") ||
        null,
      eventType: req.body?.type || req.body?.event_type || null,
      body: req.body,
      headers: req.headers,
    };
  }
}

module.exports = WaveProvider;
