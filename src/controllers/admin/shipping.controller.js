const crypto = require('crypto');
const multer = require('multer');
const prisma = require('../../prisma');
const {
  scopeWhere,
  pickCountryId
} = require('../../helpers/countryScope');
const {
  STAGES,
  shippingFilters,
  stageFilters
} = require('../../services/shipping-workspace.service');
const {
  isShipping,
  shippingPaymentSummary
} = require('../../services/shipping.service');
const {
  uploadBuffer,
  cloudinary
} = require('../../services/cloudinary');
const {
  streamBankProofFileToResponse
} = require('../../utils/bankProofFiles');
const {
  claimOrderSnapshot
} = require('../../helpers/order-write-guard');
async function listShipments(req, res) {
  try {
    const countryId = pickCountryId(req);
    const {
      where,
      stage
    } = shippingFilters(req.query, countryId);
    const filters = stageFilters(countryId);
    const scoped = key => ({
      ...where,
      AND: [...where.AND, filters[key]]
    });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1),
      pageSize = Math.max(10, Math.min(100, parseInt(req.query.pageSize, 10) || 25));
    const [rows, counts] = await Promise.all([prisma.preorder.findMany({
      where: scoped(stage),
      take: pageSize,
      skip: (page - 1) * pageSize,
      orderBy: [{
        [stage === 'HANDED_OVER' ? 'fulfilledAt' : 'preparationLaunchedAt']: stage === 'HANDED_OVER' ? 'desc' : 'asc'
      }, {
        id: 'asc'
      }],
      select: {
        id: true,
        countryId: true,
        preorderNumber: true,
        parcelNumber: true,
        fboNomComplet: true,
        fboNumero: true,
        status: true,
        paymentStatus: true,
        totalFcfa: true,
        deliveryMode: true,
        shippingRecipientName: true,
        shippingRecipientPhone: true,
        shippingDestinationCity: true,
        shippingFeeFcfa: true,
        shippingWeightKg: true,
        shippingParcelCount: true,
        shippingQuotedAt: true,
        shippingHandedOverAt: true,
        deliveryTracking: true,
        deliveryCarrier: true,
        fulfilledAt: true,
        preparedAt: true,
        preparationLaunchedAt: true,
        shippingPaymentLink: {
          select: {
            source: true,
            countryId: true,
            status: true,
            providerStatus: true,
            baseAmountFcfa: true,
            amountFcfa: true,
            serviceFeeFcfa: true
          }
        },
        _count: {
          select: {
            items: true
          }
        }
      }
    }), Promise.all(STAGES.map(async key => [key, await prisma.preorder.count({
      where: scoped(key)
    })]))]);
    const stats = Object.fromEntries(counts),
      totalCount = stats[stage];
    return res.json({
      data: rows.map(order => {
        const {
          path,
          ...shippingPayment
        } = shippingPaymentSummary(order);
        return {
          ...order,
          shippingStage: stage,
          shippingPayment
        };
      }),
      stats,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      page
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      message: error.statusCode === 400 ? error.message : 'Impossible de charger les expéditions.'
    });
  }
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  }
});
function receiptMiddleware(req, res, next) {
  upload.single('file')(req, res, error => error ? res.status(400).json({
    message: 'Joignez une photo JPG, PNG ou un PDF de 8 Mo maximum.'
  }) : next());
}
function receiptType(file) {
  const b = file?.buffer;
  if (!b?.length) return null;
  if (file.mimetype === 'image/jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255) return ['image/jpeg', 'jpg'];
  if (file.mimetype === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['image/png', 'png'];
  if (file.mimetype === 'application/pdf' && b.subarray(0, 5).toString() === '%PDF-') return ['application/pdf', 'pdf'];
  return null;
}
async function uploadReceipt(req, res) {
  let asset;
  try {
    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, {
        id: req.params.id
      })
    });
    if (!order || !isShipping(order.deliveryMode)) return res.status(404).json({
      message: 'Expédition introuvable.'
    });
    if (!['READY', 'FULFILLED'].includes(order.status)) return res.status(409).json({
      message: 'Le bordereau se joint à un colis prêt ou remis au transporteur.'
    });
    if (order.shippingReceiptFileUrl) return res.status(409).json({
      message: 'Un bordereau est déjà enregistré pour ce colis.'
    });
    const type = receiptType(req.file);
    if (!type) return res.status(400).json({
      message: 'Le fichier doit être une photo JPG, PNG ou un PDF valide.'
    });
    asset = await uploadBuffer(req.file.buffer, {
      resource_type: 'raw',
      type: 'authenticated',
      public_id: `shipping-receipts/${crypto.randomUUID()}.${type[1]}`
    });
    await prisma.$transaction(async tx => {
      await claimOrderSnapshot(tx, order);
      const current = await tx.preorder.findUnique({
        where: {
          id: order.id
        },
        select: {
          shippingReceiptFileUrl: true
        }
      });
      if (current.shippingReceiptFileUrl) {
        const error = new Error('Un bordereau a déjà été joint.');
        error.statusCode = 409;
        throw error;
      }
      await tx.preorder.update({
        where: {
          id: order.id
        },
        data: {
          shippingReceiptFileUrl: asset.secure_url,
          shippingReceiptMimeType: type[0]
        }
      });
      await tx.preorderLog.create({
        data: {
          preorderId: order.id,
          action: 'FULFILL',
          actorAdminId: req.user.id,
          note: 'Bordereau transporteur joint',
          meta: {
            event: 'SHIPPING_RECEIPT',
            fileAttached: true
          }
        }
      });
    });
    return res.json({
      shippingReceiptAvailable: true
    });
  } catch (error) {
    if (asset?.public_id) await cloudinary.uploader.destroy(asset.public_id, {
      resource_type: 'raw',
      type: 'authenticated'
    }).catch(() => {});
    return res.status(error.statusCode || 500).json({
      message: error.statusCode === 409 ? 'La commande a changé. Actualisez le dossier.' : 'Impossible d’enregistrer le bordereau. Réessayez.'
    });
  }
}
async function downloadReceipt(req, res) {
  try {
    const order = await prisma.preorder.findFirst({
      where: scopeWhere(req, {
        id: req.params.id
      }),
      select: {
        deliveryMode: true,
        shippingReceiptFileUrl: true,
        shippingReceiptMimeType: true
      }
    });
    if (!order || !isShipping(order.deliveryMode) || !order.shippingReceiptFileUrl) return res.status(404).json({
      message: 'Bordereau introuvable.'
    });
    res.setHeader('Cache-Control', 'private, no-store');
    if (!(await streamBankProofFileToResponse({
      res,
      fileUrl: order.shippingReceiptFileUrl,
      fileMimeType: order.shippingReceiptMimeType,
      originalFileName: 'bordereau'
    }))) return res.status(404).json({
      message: 'Bordereau introuvable.'
    });
  } catch {
    if (!res.headersSent) return res.status(500).json({
      message: 'Impossible de consulter le bordereau.'
    });
  }
}
module.exports = {
  listShipments,
  receiptMiddleware,
  uploadReceipt,
  downloadReceipt,
  receiptType
};
