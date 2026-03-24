// src/payments/providers/wave.provider.js
// Implémentation du provider de paiement Wave

const crypto = require("crypto");
const BasePaymentProvider = require("./base.provider");

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function getNested(source, path) {
  return path.reduce(
    (acc, key) => (acc == null ? undefined : acc[key]),
    source,
  );
}

function normalizePhone(value) {
  const raw = firstNonEmptyString(value);
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, "");
  return compact || raw;
}

function extractWaveSessionMetadata(raw = {}) {
  const providerSessionId =
    firstNonEmptyString(
      raw?.id,
      raw?.data?.id,
      raw?.checkout_session?.id,
      raw?.session?.id,
    ) || null;

  const providerTransactionId =
    firstNonEmptyString(
      raw?.transaction_id,
      raw?.data?.transaction_id,
      raw?.checkout_session?.transaction_id,
      raw?.session?.transaction_id,
      raw?.payment_id,
      raw?.data?.payment_id,
      raw?.payment?.id,
      raw?.data?.payment?.id,
    ) || null;

  const providerPayerPhone = normalizePhone(
    firstNonEmptyString(
      raw?.payerPhone,
      raw?.payer_phone,
      raw?.customer_msisdn,
      raw?.phone_number,
      raw?.sender_phone,
      raw?.sender_msisdn,
      raw?.mobile,
      raw?.customer_phone,
      raw?.client_phone,
      getNested(raw, ["payer", "phone_number"]),
      getNested(raw, ["payer", "phone"]),
      getNested(raw, ["payment_method", "phone_number"]),
      getNested(raw, ["payment_method", "payer_phone"]),
      getNested(raw, ["payment_method", "customer_msisdn"]),
      getNested(raw, ["payment_method", "sender_phone"]),
      getNested(raw, ["client", "phone"]),
      getNested(raw, ["customer", "phone"]),
      getNested(raw, ["data", "payerPhone"]),
      getNested(raw, ["data", "payer_phone"]),
      getNested(raw, ["data", "customer_msisdn"]),
      getNested(raw, ["data", "phone_number"]),
      getNested(raw, ["data", "sender_phone"]),
      getNested(raw, ["data", "client", "phone"]),
      getNested(raw, ["data", "payer", "phone_number"]),
      getNested(raw, ["data", "payment_method", "phone_number"]),
      getNested(raw, ["checkout_session", "payer_phone"]),
      getNested(raw, ["checkout_session", "customer_msisdn"]),
      getNested(raw, ["checkout_session", "phone_number"]),
      getNested(raw, ["checkout_session", "payment_method", "phone_number"]),
      getNested(raw, ["session", "payer_phone"]),
      getNested(raw, ["session", "customer_msisdn"]),
      getNested(raw, ["session", "payment_method", "phone_number"]),
    ),
  );

  const providerStatusLabel =
    firstNonEmptyString(
      raw?.payment_status_label,
      raw?.checkout_status_label,
      raw?.status_label,
      raw?.payment_status,
      raw?.checkout_status,
      raw?.status,
      raw?.data?.payment_status_label,
      raw?.data?.checkout_status_label,
      raw?.data?.status_label,
      raw?.data?.payment_status,
      raw?.data?.checkout_status,
      raw?.checkout_session?.payment_status_label,
      raw?.checkout_session?.checkout_status_label,
      raw?.checkout_session?.status_label,
      raw?.session?.payment_status_label,
      raw?.session?.checkout_status_label,
      raw?.session?.status_label,
    ) || null;

  const completedAt =
    firstNonEmptyString(
      raw?.when_completed,
      raw?.completed_at,
      raw?.paid_at,
      raw?.data?.when_completed,
      raw?.data?.completed_at,
      raw?.data?.paid_at,
      raw?.checkout_session?.when_completed,
      raw?.checkout_session?.completed_at,
      raw?.checkout_session?.paid_at,
      raw?.session?.when_completed,
      raw?.session?.completed_at,
      raw?.session?.paid_at,
    ) || null;

  return {
    providerSessionId,
    providerTransactionId,
    providerPayerPhone,
    providerStatusLabel,
    completedAt,
  };
}

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
    const metadata = extractWaveSessionMetadata(session);

    return {
      provider: this.code,
      raw: session,
      providerSessionId: metadata.providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerPayerPhone: metadata.providerPayerPhone,
      providerStatusLabel: metadata.providerStatusLabel,
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
    const metadata = extractWaveSessionMetadata(session);

    return {
      provider: this.code,
      raw: session,
      providerSessionId: metadata.providerSessionId || providerSessionId,
      providerTransactionId: metadata.providerTransactionId,
      providerPayerPhone: metadata.providerPayerPhone,
      providerStatusLabel: metadata.providerStatusLabel,
      checkoutUrl: session?.wave_launch_url || null,
      providerLaunchUrl: session?.wave_launch_url || null,
      clientReference: session?.client_reference || null,
      checkoutStatus: session?.checkout_status || null,
      paymentStatus: session?.payment_status || null,
      completedAt: metadata.completedAt,
    };
  }

  async getCheckoutSessionDetails({
    providerSessionId,
    providerTransactionId,
  } = {}) {
    if (!providerSessionId && !providerTransactionId) {
      const err = new Error(
        "providerSessionId ou providerTransactionId requis pour le détail",
      );
      err.statusCode = 400;
      throw err;
    }

    let bySessionRaw = null;
    if (providerSessionId) {
      bySessionRaw = await this.http(
        `/v1/checkout/sessions/${encodeURIComponent(providerSessionId)}`
      );
    }

    let byTransactionRaw = null;
    if (providerTransactionId) {
      const encodedTxnId = encodeURIComponent(providerTransactionId);
      const candidatePaths = [
        `/v1/checkout/sessions?transaction_id=${encodedTxnId}`,
        `/v1/checkout/sessions/transactions/${encodedTxnId}`,
        `/v1/checkout/payments/${encodedTxnId}`,
        `/v1/payments/${encodedTxnId}`,
      ];

      for (const path of candidatePaths) {
        try {
          const raw = await this.http(path);
          byTransactionRaw = Array.isArray(raw?.data) ? raw.data[0] : raw;
          if (byTransactionRaw) break;
        } catch (_e) {
          continue;
        }
      }
    }

    const detailRaw = byTransactionRaw || bySessionRaw;
    if (!detailRaw) {
      const err = new Error("Aucun payload détail récupéré depuis Wave");
      err.statusCode = 404;
      throw err;
    }

    const mergedRaw = {
      ...(bySessionRaw && typeof bySessionRaw === "object" ? bySessionRaw : {}),
      ...(detailRaw && typeof detailRaw === "object" ? detailRaw : {}),
      _waveDetails: {
        bySession: bySessionRaw,
        byTransaction: byTransactionRaw,
      },
    };
    const metadata = extractWaveSessionMetadata(mergedRaw);

    return {
      provider: this.code,
      raw: mergedRaw,
      providerSessionId: metadata.providerSessionId || providerSessionId || null,
      providerTransactionId:
        metadata.providerTransactionId || providerTransactionId || null,
      providerPayerPhone: metadata.providerPayerPhone,
      providerStatusLabel: metadata.providerStatusLabel,
      checkoutUrl: mergedRaw?.wave_launch_url || null,
      providerLaunchUrl: mergedRaw?.wave_launch_url || null,
      clientReference: mergedRaw?.client_reference || null,
      checkoutStatus: mergedRaw?.checkout_status || null,
      paymentStatus: mergedRaw?.payment_status || null,
      completedAt: metadata.completedAt,
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
