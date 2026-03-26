const orangeSmsService = require("../services/sms.orange.service");

async function sendTestSms(req, res) {
  const { phone, titre, contenu } = req.body || {};

  if (!phone || !titre) {
    return res.status(400).json({
      success: false,
      error: "Les champs phone et titre sont requis",
    });
  }

  try {
    const result = await orangeSmsService.send(
      { contact1: phone },
      { titre, contenu },
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || "Erreur envoi SMS Orange",
      status: error.status || null,
      details: error.data || null,
    });
  }
}

module.exports = {
  sendTestSms,
};
