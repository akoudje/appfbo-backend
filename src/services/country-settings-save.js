function conflict() {
  const error = new Error(
    "Ces paramètres ont été modifiés par un autre administrateur. Rechargez les valeurs avant d’enregistrer.",
  );
  error.statusCode = 409;
  return error;
}
async function persistCountrySettings(prisma, req, existing, options, data) {
  const countryId = options.where.countryId;
  if (Object.hasOwn(req.body || {}, "expectedUpdatedAt")) {
    const expected = req.body.expectedUpdatedAt;
    if (
      expected !== null &&
      (typeof expected !== "string" ||
        !Number.isFinite(new Date(expected).getTime()))
    ) {
      const error = new Error("Version de paramètres invalide.");
      error.statusCode = 400;
      throw error;
    }
    if (
      (existing?.updatedAt?.toISOString() || null) !==
      (expected === null ? null : new Date(expected).toISOString())
    )
      throw conflict();
  }
  const changes = Object.fromEntries(
    Object.entries(data)
      .filter(
        ([key, value]) =>
          JSON.stringify(existing?.[key] ?? null) !== JSON.stringify(value),
      )
      .map(([key, value]) => [
        key,
        { before: existing?.[key] ?? null, after: value },
      ]),
  );
  try {
    return await prisma.$transaction(
      async (tx) => {
        let updated;
        if (existing) {
          if (!Object.keys(changes).length)
            return tx.countrySettings.findUnique({
              where: { countryId },
              select: options.select,
            });
          const updatedAt = new Date(
            Math.max(Date.now(), existing.updatedAt.getTime() + 1),
          );
          const result = await tx.countrySettings.updateMany({
            where: { countryId, updatedAt: existing.updatedAt },
            data: { ...data, updatedAt },
          });
          if (result.count !== 1) throw conflict();
          updated = await tx.countrySettings.findUnique({
            where: { countryId },
            select: options.select,
          });
        } else
          updated = await tx.countrySettings.create({
            data: { ...options.create, ...data },
            select: options.select,
          });
        if (Object.keys(changes).length)
          await tx.countrySettingsChange.create({
            data: {
              countryId,
              actorId: req.user?.id || null,
              actorLabel: req.user?.email || req.user?.id || "Administrateur",
              changes,
            },
          });
        return updated;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (["P2002", "P2034"].includes(error.code)) throw conflict();
    throw error;
  }
}
module.exports = { persistCountrySettings };
