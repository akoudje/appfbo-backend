const { computePaymentPricing } = require('../payments/payment-pricing');

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]));
}

function customerOrderResponse(order) {
  if (!order) return order;
  const result = pick(order, [
    'id', 'preorderNumber', 'status', 'paymentStatus', 'preorderPaymentMode', 'deliveryMode',
    'fboNumero', 'fboNomComplet', 'placedByFboNumero', 'placedByFboName', 'placedByHomeCountryCode',
    'totalFcfa', 'totalProduitsFcfa', 'fraisLivraisonFcfa', 'emballageFcfa',
    'paymentCollectionCode', 'paymentExpiresAt', 'paymentExpiryHours', 'parcelNumber',
    'bankPaymentStatus', 'bankPaymentDueAt', 'createdAt', 'updatedAt', 'submittedAt',
    'invoicedAt', 'paidAt', 'preparationLaunchedAt', 'preparedAt', 'fulfilledAt', 'cancelledAt',
    'manualPaymentReceivedAt', 'pickupPointLabel', 'pickupCode', 'pickupSecretCode',
    'deliveryAddress', 'deliveryTrackingNumber', 'relationType',
  ]);
  result.country = pick(order.country, ['code', 'name']);
  result.paymentPricing = computePaymentPricing({ preorderPaymentMode: order.preorderPaymentMode, orderTotalFcfa: order.totalFcfa });
  if (Array.isArray(order.items)) result.items = order.items.map((item) => ({
    ...pick(item, ['id', 'qty', 'productNameSnapshot', 'productSkuSnapshot', 'lineTotalFcfa', 'unitPriceFcfa', 'packagingLabelSnapshot', 'packagingUnitsPerPackage']),
    product: pick(item.product, ['id', 'sku', 'nom', 'imageUrl']),
  }));
  if (Array.isArray(order.messages)) result.messages = order.messages.map((message) => pick(message, ['id', 'channel', 'purpose', 'status', 'sentAt', 'deliveredAt', 'failedAt', 'createdAt']));
  if (Array.isArray(order.bankPaymentProofs)) result.bankPaymentProofs = order.bankPaymentProofs.map((proof) => pick(proof, ['id', 'status', 'submittedAt', 'createdAt', 'reference', 'declaredAmountFcfa', 'fileUrl', 'originalFileName', 'fileSizeBytes', 'rejectionReason']));
  if (order.latestBankProof) result.latestBankProof = pick(order.latestBankProof, ['id', 'status', 'submittedAt', 'fileUrl', 'rejectionReason']);
  return result;
}

module.exports = { customerOrderResponse };
