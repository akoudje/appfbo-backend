const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const prisma = require("../src/prisma");

const GRADES = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

function parseArgs(argv) {
  const args = {
    file: null,
    countryCode: "BFA",
    apply: false,
    ensureSchema: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--apply") {
      args.apply = true;
    } else if (value === "--ensure-schema") {
      args.ensureSchema = true;
    } else if (value === "--country" || value === "--countryCode") {
      args.countryCode = String(argv[++i] || args.countryCode).trim().toUpperCase();
    } else if (!args.file) {
      args.file = value;
    }
  }

  return args;
}

async function ensureProductGradePriceSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquant");
  }

  const migrationPath = path.resolve(
    __dirname,
    "../prisma/migrations/20260523120000_bfa_product_grade_prices/migration.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function splitCsvLine(line, sep = ";") {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === sep && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseMoney(raw) {
  const normalized = String(raw || "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");

  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("CSV_EMPTY");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toUpperCase());
  const skuIndex = headers.indexOf("SKU");
  if (skuIndex === -1) {
    throw new Error("SKU_HEADER_MISSING");
  }

  const gradeIndexes = GRADES.map((grade) => [grade, headers.indexOf(grade)]);
  const missingHeaders = gradeIndexes.filter(([, index]) => index === -1).map(([grade]) => grade);
  if (missingHeaders.length) {
    throw new Error(`GRADE_HEADERS_MISSING: ${missingHeaders.join(", ")}`);
  }

  return lines.slice(1).map((line, idx) => {
    const cells = splitCsvLine(line);
    const sku = String(cells[skuIndex] || "").trim();
    const prices = {};
    const errors = [];

    for (const [grade, index] of gradeIndexes) {
      const price = parseMoney(cells[index]);
      if (price === null) errors.push(`${grade} invalide`);
      else prices[grade] = price;
    }

    if (!sku) errors.push("SKU manquant");

    return {
      line: idx + 2,
      sku,
      prices,
      errors,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    throw new Error(
      "Usage: node scripts/import-bfa-grade-prices.js <file.csv> [--country BFA] [--ensure-schema] [--apply]",
    );
  }

  const filePath = path.resolve(args.file);
  if (args.ensureSchema) {
    await ensureProductGradePriceSchema();
  }
  const rows = parseCsv(filePath);
  const validRows = rows.filter((row) => row.errors.length === 0);
  const invalidRows = rows.filter((row) => row.errors.length > 0);

  const country = await prisma.country.findUnique({
    where: { code: args.countryCode },
    select: { id: true, code: true, name: true },
  });
  if (!country) {
    throw new Error(`Pays introuvable: ${args.countryCode}`);
  }

  const skus = [...new Set(validRows.map((row) => row.sku))];
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      nom: true,
      countryProducts: {
        where: { countryId: country.id },
        select: { id: true },
      },
    },
  });
  const productsBySku = new Map(products.map((product) => [product.sku, product]));

  const missingProducts = [];
  const unavailableProducts = [];
  const importRows = [];

  for (const row of validRows) {
    const product = productsBySku.get(row.sku);
    if (!product) {
      missingProducts.push({ line: row.line, sku: row.sku });
      continue;
    }
    if (!product.countryProducts?.length) {
      unavailableProducts.push({ line: row.line, sku: row.sku, nom: product.nom });
      continue;
    }
    importRows.push({ ...row, product });
  }

  const summary = {
    file: filePath,
    country: `${country.code} - ${country.name}`,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    rowsRead: rows.length,
    validRows: validRows.length,
    invalidRows: invalidRows.length,
    matchedProducts: importRows.length,
    missingProducts: missingProducts.length,
    unavailableProducts: unavailableProducts.length,
    priceRowsToUpsert: importRows.length * GRADES.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (invalidRows.length) {
    console.log("Invalid rows sample:", invalidRows.slice(0, 10));
  }
  if (missingProducts.length) {
    console.log("Missing products sample:", missingProducts.slice(0, 20));
  }
  if (unavailableProducts.length) {
    console.log("Unavailable in country sample:", unavailableProducts.slice(0, 20));
  }

  if (!args.apply) {
    console.log("Dry-run only. Add --apply to write ProductGradePrice rows.");
    return;
  }

  for (const row of importRows) {
    for (const grade of GRADES) {
      await prisma.productGradePrice.upsert({
        where: {
          countryId_productId_grade: {
            countryId: country.id,
            productId: row.product.id,
            grade,
          },
        },
        create: {
          countryId: country.id,
          productId: row.product.id,
          grade,
          prixFcfa: row.prices[grade],
        },
        update: {
          prixFcfa: row.prices[grade],
        },
      });
    }
  }

  console.log(`Import complete: ${summary.priceRowsToUpsert} prix par grade upserted.`);
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
