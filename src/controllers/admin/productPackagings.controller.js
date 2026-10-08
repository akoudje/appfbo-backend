const prisma = require("../../prisma");
const {
  integer,
  boolean,
  text,
  fail,
  audit,
} = require("../../helpers/product-domain");
async function ensureProduct(req) {
  const product = await prisma.product.findFirst({
    where: {
      id: req.params.id,
      countryProducts: { some: { countryId: req.countryId } },
    },
    select: { id: true },
  });
  if (!product) fail("Produit introuvable dans ce pays.", 404);
}

function parsePositiveInt(v) {
  if (v === null || v === undefined || v === "") return null;
  return integer(v, "Nombre d’unités", 1);
}

function parseNonNegativeIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  return integer(v, "Prix du conditionnement");
}

async function listPackagings(req, res) {
  try {
    await ensureProduct(req);
    const { id: productId } = req.params;

    const packagings = await prisma.productPackaging.findMany({
      where: { productId },
      orderBy: { unitsPerPackage: "asc" },
    });

    return res.json(packagings);
  } catch (e) {
    if (e.statusCode)
      return res.status(e.statusCode).json({ message: e.message });
    console.error("listPackagings error:", e);
    return res.status(500).json({ message: "Erreur serveur (listPackagings)" });
  }
}

async function createPackaging(req, res) {
  try {
    await ensureProduct(req);
    const { id: productId } = req.params;
    const {
      label,
      unitsPerPackage,
      barcode,
      prixFcfa,
      actif = true,
    } = req.body || {};

    const cleanLabel = text(label, "Libellé", 150);
    const cleanUnitsPerPackage = parsePositiveInt(unitsPerPackage);
    const cleanBarcode = text(barcode || null, "Code-barres", 100, true);
    const cleanPrixFcfa = parseNonNegativeIntOrNull(prixFcfa);

    if (!cleanLabel) {
      return res
        .status(400)
        .json({ message: "Le libellé du conditionnement est requis" });
    }
    if (!cleanUnitsPerPackage) {
      return res
        .status(400)
        .json({ message: "unitsPerPackage doit être un entier positif" });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product)
      return res.status(404).json({ message: "Produit introuvable" });

    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.productPackaging.create({
        data: {
          productId,
          label: cleanLabel,
          unitsPerPackage: cleanUnitsPerPackage,
          barcode: cleanBarcode,
          prixFcfa: cleanPrixFcfa,
          actif: boolean(actif),
        },
      });

      await audit(tx, req, productId, "PACKAGING_CREATE", { after: result });
      return result;
    });
    return res.status(201).json(created);
  } catch (e) {
    if (e.statusCode)
      return res.status(e.statusCode).json({ message: e.message });
    console.error("createPackaging error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({
        message:
          "Ce libellé ou ce code-barres est déjà utilisé pour ce produit",
      });
    }
    return res
      .status(500)
      .json({ message: "Erreur serveur (createPackaging)" });
  }
}

async function updatePackaging(req, res) {
  try {
    await ensureProduct(req);
    const { id: productId, packagingId } = req.params;
    const { label, unitsPerPackage, barcode, prixFcfa, actif } = req.body || {};

    const existing = await prisma.productPackaging.findFirst({
      where: { id: packagingId, productId },
    });
    if (!existing)
      return res.status(404).json({ message: "Conditionnement introuvable" });

    const data = {};

    if (label !== undefined) {
      const cleanLabel = text(label, "Libellé", 150);
      if (!cleanLabel) {
        return res
          .status(400)
          .json({ message: "Le libellé du conditionnement est requis" });
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
      data.barcode = text(barcode || null, "Code-barres", 100, true);
    }

    if (prixFcfa !== undefined) {
      data.prixFcfa = parseNonNegativeIntOrNull(prixFcfa);
    }

    if (actif !== undefined) {
      data.actif = boolean(actif);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.productPackaging.update({
        where: { id: packagingId },
        data,
      });

      await audit(tx, req, productId, "PACKAGING_UPDATE", {
        before: existing,
        after: result,
      });
      return result;
    });
    return res.json(updated);
  } catch (e) {
    if (e.statusCode)
      return res.status(e.statusCode).json({ message: e.message });
    console.error("updatePackaging error:", e);
    if (String(e?.code) === "P2002") {
      return res.status(409).json({
        message:
          "Ce libellé ou ce code-barres est déjà utilisé pour ce produit",
      });
    }
    return res
      .status(500)
      .json({ message: "Erreur serveur (updatePackaging)" });
  }
}

async function deletePackaging(req, res) {
  try {
    await ensureProduct(req);
    const { id: productId, packagingId } = req.params;

    const existing = await prisma.productPackaging.findFirst({
      where: { id: packagingId, productId },
    });
    if (!existing)
      return res.status(404).json({ message: "Conditionnement introuvable" });

    await prisma.$transaction(async (tx) => {
      await tx.productPackaging.update({
        where: { id: packagingId },
        data: { actif: false },
      });
      await audit(tx, req, productId, "PACKAGING_DEACTIVATE", {
        before: existing,
        after: { actif: false },
      });
    });

    return res.status(204).send();
  } catch (e) {
    if (e.statusCode)
      return res.status(e.statusCode).json({ message: e.message });
    console.error("deletePackaging error:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur (deletePackaging)" });
  }
}

module.exports = {
  listPackagings,
  createPackaging,
  updatePackaging,
  deletePackaging,
};
