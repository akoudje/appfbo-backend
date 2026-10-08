// This conditional UPDATE locks the order row for the transaction. After a
// concurrent writer commits, PostgreSQL checks the conditions again.
async function claimOrderSnapshot(tx, order) {
  if (!order?.id || !order.countryId || !order.status) throw new Error("Le contexte de la commande est incomplet.");
  const result = await tx.preorder.updateMany({
    where: {
      id: order.id,
      countryId: order.countryId,
      status: order.status,
      ...(order.paymentStatus ? { paymentStatus: order.paymentStatus } : {}),
      stockDeductedAt: order.stockDeductedAt ? { not: null } : null,
      stockRestoredAt: order.stockRestoredAt ? { not: null } : null,
      preparationLaunchedAt: order.preparationLaunchedAt ? { not: null } : null,
    },
    data: { updatedAt: new Date() },
  });
  if (result.count !== 1) {
    const error = new Error("La commande a été modifiée pendant l’opération. Actualisez le dossier avant de réessayer.");
    error.statusCode = 409;
    error.code = "ORDER_CHANGED";
    throw error;
  }
}

module.exports = { claimOrderSnapshot };
