const {
  validateOrdersQuery
} = require('../helpers/order-query');
const {
  isShipping
} = require('./shipping.service');
const STAGES = ['TO_PREPARE', 'TO_QUOTE', 'TO_PAY', 'READY', 'HANDED_OVER'];
function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
function shippingFilters(query, countryId) {
  validateOrdersQuery(query);
  const stage = query.stage || 'TO_PREPARE';
  if (!STAGES.includes(stage)) fail('Étape d’expédition invalide.');
  if (query.carrier && !['EXPEDITION_POSTE', 'EXPEDITION_CODITRANS'].includes(query.carrier)) fail('Transporteur invalide.');
  if (query.destination != null && (typeof query.destination !== 'string' || query.destination.length > 120)) fail('La ville est limitée à 120 caractères.');
  const where = {
    countryId,
    deliveryMode: query.carrier || {
      in: ['EXPEDITION_POSTE', 'EXPEDITION_CODITRANS']
    },
    status: {
      in: ['PAID', 'READY', 'FULFILLED']
    },
    paymentStatus: 'PAID',
    preparationLaunchedAt: {
      not: null
    },
    AND: []
  };
  if (query.destination?.trim()) where.shippingDestinationCity = {
    contains: query.destination.trim(),
    mode: 'insensitive'
  };
  const q = String(query.q || '').trim();
  if (q) where.AND.push({
    OR: ['preorderNumber', 'parcelNumber', 'fboNomComplet', 'fboNumero', 'shippingRecipientName', 'shippingRecipientPhone', 'shippingDestinationCity', 'deliveryTracking'].map(field => ({
      [field]: {
        contains: q,
        mode: 'insensitive'
      }
    }))
  });
  if (query.dateFrom || query.dateTo) where.createdAt = {
    ...(query.dateFrom ? {
      gte: new Date(query.dateFrom + 'T00:00:00Z')
    } : {}),
    ...(query.dateTo ? {
      lte: new Date(query.dateTo + 'T23:59:59.999Z')
    } : {})
  };
  return {
    where,
    stage
  };
}
function stageFilters(countryId) {
  const verified = {
    preparationItems: {
      some: {},
      none: {
        checked: false
      }
    },
    preparationAnomalies: {
      none: {
        blocking: true,
        resolvedAt: null
      }
    }
  };
  const paid = {
    OR: [{
      shippingFeeFcfa: 0
    }, {
      shippingFeeFcfa: {
        gt: 0
      },
      shippingPaymentLink: {
        is: {
          source: 'SHIPPING',
          countryId,
          status: 'PAID',
          providerStatus: 'SUCCEEDED'
        }
      }
    }]
  };
  const quote = {
    status: {
      in: ['PAID', 'READY']
    },
    shippingFeeFcfa: null,
    ...verified
  };
  const awaiting = {
    status: {
      in: ['PAID', 'READY']
    },
    shippingFeeFcfa: {
      gt: 0
    },
    ...verified,
    NOT: paid
  };
  const ready = {
    status: 'READY',
    ...verified,
    AND: [paid]
  };
  return {
    TO_PREPARE: {
      status: {
        in: ['PAID', 'READY']
      },
      NOT: {
        OR: [quote, awaiting, ready]
      }
    },
    TO_QUOTE: quote,
    TO_PAY: awaiting,
    READY: ready,
    HANDED_OVER: {
      status: 'FULFILLED'
    }
  };
}
function handoverInput(body, order, now = new Date()) {
  if (!isShipping(order.deliveryMode)) return {};
  const reference = typeof body.deliveryTracking === 'string' ? body.deliveryTracking.trim() : '';
  if (!reference || reference.length > 120 || /[\x00-\x1f\x7f]/.test(reference)) fail('Saisissez la référence du bordereau du transporteur (120 caractères maximum).');
  const rawDate = body.shippingHandedOverAt;
  if (rawDate != null && (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate))) fail('Date de remise au transporteur invalide.');
  const date = rawDate ? new Date(rawDate) : now;
  if (!Number.isFinite(date.getTime()) || date > now || order.preparedAt && date < new Date(order.preparedAt)) fail('La remise doit être comprise entre la préparation du colis et maintenant.');
  return {
    deliveryTracking: reference,
    shippingHandedOverAt: date,
    fulfillmentMode: 'SHIPPING'
  };
}
module.exports = {
  STAGES,
  shippingFilters,
  stageFilters,
  handoverInput
};
