function ensureCountry(req) {
  const countryId = req?.country?.id || req?.countryId;
  if (!countryId) {
    const err = new Error("Country context missing");
    err.statusCode = 400;
    throw err;
  }
  return countryId;
}

function pickCountryId(req) {
  return ensureCountry(req);
}

function scopeWhere(req, where = {}) {
  return { ...(where || {}), countryId: pickCountryId(req) };
}

function scopeCreate(req, data = {}) {
  return { ...(data || {}), countryId: pickCountryId(req) };
}

function assertSameCountry(req, entityCountryId) {
  const countryId = pickCountryId(req);
  if (entityCountryId !== countryId) {
    const err = new Error("Forbidden: cross-country access");
    err.statusCode = 403;
    throw err;
  }
}

async function safeFindUniqueScoped(modelDelegate, req, id, where = {}, options = {}) {
  return modelDelegate.findFirst({
    ...(options || {}),
    where: scopeWhere(req, { ...(where || {}), id }),
  });
}

module.exports = {
  scopeWhere,
  scopeCreate,
  assertSameCountry,
  pickCountryId,
  safeFindUniqueScoped,
};
