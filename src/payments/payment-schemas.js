// backend/src/payments/payment-schemas.js
// Schémas de validation pour les routes de paiement Wave.
// Chaque schéma est { field: validatorFn } passé à validateBody().

"use strict";

const { isId, isPhone, isOptionalBoolean } = require("../middlewares/validate");

/** POST /wave/public/initiate — initiation publique */
const initiatePublicWaveSchema = {
  orderId:    isId("orderId"),
  payerPhone: isPhone("payerPhone"),
};

/** POST /wave/public/:orderId/sync — sync statut public (orderId dans params, body vide) */
const syncPublicWaveSchema = {};

/** POST /wave/initiate — initiation admin */
const initiateAdminWaveSchema = {
  orderId:             isId("orderId"),
  restrictPayerMobile: isOptionalBoolean("restrictPayerMobile"),
};

module.exports = {
  initiatePublicWaveSchema,
  syncPublicWaveSchema,
  initiateAdminWaveSchema,
};
