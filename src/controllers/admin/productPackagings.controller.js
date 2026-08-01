const prisma = require("../../prisma");

function parsePositiveInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseNonNegativeIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function listPackagings(req, res) {
  try {
    const { id: productId } = req.params;

    const packagings = await prisma.productPackaging.findMany({
      where: { productId },
      orderBy: { unitsPerPackage: "asc" },
    });

    return res.json(packagings);
  } catch (e) {
    console.error("listPackagings error:", e);
    return res.status(500).json({ message: "Erreur serveur (listPackagings)" });
  }
}

async function createPackaging(req, res) {
  try {
    const { id: productId } = req.params;
    const { label, unitsPerPackage, barcode, prixFcfa, actif = true } = req.body || {};

    const cleanLabel = String(label || "").trim();
    const cleanUnitsPerPackage = parsePositiveInt(unitsPerPackage);
    const cleanBarcode = String(barcode || "").trim() || null;
    const cleanPrixFcfa = parseNonNegativeIntOrNull(prixFcfa);

    if (!cleanLabel) {
      return res.status(400).json({ message: "Le libellé du conditionnement est requis" });
    }
    if (!cleanUnitsPerPackage) {
      return res
        .status(400)
        .json({ message: "unitsPerPackage doit être un entier positif" });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ message: "Produit introuvable" });

    const created = await prisma.productPackaging.create({
      data: {
        productId,
        label: cleanLabel,
        unitsPerPackage: cleanUnitsPerPackage,
        barcode: cleanBarcode,
        prixFcfa: cleanPrixFcfa,
        actif: Boolean(actif),
      },
    });

    return res.status(201).json(created);
  } catch (e) {
    console.error("createPackaging error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({
        message: "Ce libellé ou ce code-barres est déjà utilisé pour ce produit",
      });
    }
    return res.status(500).json({ message: "Erreur serveur (createPackaging)" });
  }
}

async function updatePackaging(req, res) {
  try {
    const { id: productId, packagingId } = req.params;
    const { label, unitsPerPackage, barcode, prixFcfa, actif } = req.body || {};

    const existing = await prisma.productPackaging.findFirst({
      where: { id: packagingId, productId },
    });
    if (!existing) return res.status(404).json({ message: "Conditionnement introuvable" });

    const data = {};

    if (label !== undefined) {
      const cleanLabel = String(label || "").trim();
      if (!cleanLabel) {
        return res.status(400).json({ message: "Le libellé du conditionnement est requis" });
      }
      data.label = cleanLabel;
    }

    if (unitsPerPackage !== undefined) {
      const cleanUnitsPerPackage = parsePositiveInt(unitsPerPackage);
      if (!cleanUnitsPerPackage) {
        return res
          .status(400)
          .json({ message: "unitsPerPackage doit être un entier positif" });
      }
      data.unitsPerPackage = cleanUnitsPerPackage;
    }

    if (barcode !== undefined) {
      data.barcode = String(barcode || "").trim() || null;
    }

    if (prixFcfa !== undefined) {
      data.prixFcfa = parseNonNegativeIntOrNull(prixFcfa);
    }

    if (actif !== undefined) {
      data.actif = Boolean(actif);
    }

    const updated = await prisma.productPackaging.update({
      where: { id: packagingId },
      data,
    });

    return res.json(updated);
  } catch (e) {
    console.error("updatePackaging error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({
        message: "Ce libellé ou ce code-barres est déjà utilisé pour ce produit",
      });
    }
    return res.status(500).json({ message: "Erreur serveur (updatePackaging)" });
  }
}

async function deletePackaging(req, res) {
  try {
    const { id: productId, packagingId } = req.params;

    const existing = await prisma.productPackaging.findFirst({
      where: { id: packagingId, productId },
    });
    if (!existing) return res.status(404).json({ message: "Conditionnement introuvable" });

    await prisma.productPackaging.delete({ where: { id: packagingId } });

    return res.status(204).send();
  } catch (e) {
    console.error("deletePackaging error:", e);
    return res.status(500).json({ message: "Erreur serveur (deletePackaging)" });
  }
}

module.exports = {
  listPackagings,
  createPackaging,
  updatePackaging,
  deletePackaging,
};
