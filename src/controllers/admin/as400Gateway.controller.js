const as400GatewayService = require("../../services/as400Gateway.service");
const { pickCountryId } = require("../../helpers/countryScope");

function handleError(res, error, fallback = "Erreur serveur AS400 gateway") {
  console.error("as400Gateway controller error:", error);
  return res.status(error?.statusCode || 500).json({
    message: error?.message || fallback,
  });
}

async function listRequests(req, res) {
  try {
    const countryId = pickCountryId(req);
    const result = await as400GatewayService.listRequests({
      countryId,
      status: req.query?.status,
      preorderId: req.query?.preorderId,
      q: req.query?.q,
      take: req.query?.take,
      skip: req.query?.skip,
    });

    res.json(result);
  } catch (error) {
    handleError(res, error, "Erreur liste demandes AS400");
  }
}

async function getRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.getRequest({
      countryId,
      id: req.params.id,
    });

    if (!request) {
      return res.status(404).json({ message: "Demande AS400 introuvable" });
    }

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur detail demande AS400");
  }
}

async function enqueueRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const result = await as400GatewayService.enqueueInvoiceRequest({
      countryId,
      preorderId: req.body?.preorderId,
      actorAdminId: req.user?.id,
      mode: req.body?.mode,
      action: req.body?.action,
      note: req.body?.note,
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    handleError(res, error, "Erreur creation demande AS400");
  }
}

async function enqueueOrderRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const result = await as400GatewayService.enqueueInvoiceRequest({
      countryId,
      preorderId: req.params.id,
      actorAdminId: req.user?.id,
      mode: req.body?.mode,
      action: req.body?.action,
      note: req.body?.note,
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    handleError(res, error, "Erreur creation demande AS400 commande");
  }
}

async function claimNextRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.claimNextRequest({
      countryId,
      actorAdminId: req.user?.id,
      workerId: req.body?.workerId,
      mode: req.body?.mode,
      action: req.body?.action,
    });

    if (!request) {
      return res.status(204).send();
    }

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur reservation demande AS400");
  }
}

async function markWaitingHuman(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.markWaitingHuman({
      countryId,
      id: req.params.id,
      actorAdminId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur bascule manuelle demande AS400");
  }
}

async function cancelRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.cancelRequest({
      countryId,
      id: req.params.id,
      actorAdminId: req.user?.id,
      reason: req.body?.reason,
    });

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur annulation demande AS400");
  }
}

async function completeRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.completeRequest({
      countryId,
      id: req.params.id,
      actorAdminId: req.user?.id,
      workerId: req.body?.workerId,
      as400InvoiceReference: req.body?.as400InvoiceReference,
      as400OrderReference: req.body?.as400OrderReference,
      as400AmountFcfa: req.body?.as400AmountFcfa,
      as400Validated: req.body?.as400Validated,
      spoolFilePath: req.body?.spoolFilePath,
      screenSnapshotPath: req.body?.screenSnapshotPath,
      resultPayload: req.body?.resultPayload,
      message: req.body?.message,
    });

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur finalisation demande AS400");
  }
}

async function failRequest(req, res) {
  try {
    const countryId = pickCountryId(req);
    const request = await as400GatewayService.failRequest({
      countryId,
      id: req.params.id,
      actorAdminId: req.user?.id,
      workerId: req.body?.workerId,
      errorCode: req.body?.errorCode,
      errorMessage: req.body?.errorMessage,
      retry: req.body?.retry,
      retryDelaySeconds: req.body?.retryDelaySeconds,
      screenSnapshotPath: req.body?.screenSnapshotPath,
      resultPayload: req.body?.resultPayload,
    });

    res.json(request);
  } catch (error) {
    handleError(res, error, "Erreur echec demande AS400");
  }
}

module.exports = {
  listRequests,
  getRequest,
  enqueueRequest,
  enqueueOrderRequest,
  claimNextRequest,
  markWaitingHuman,
  cancelRequest,
  completeRequest,
  failRequest,
};
