const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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

function normalizeHeader(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function readZipEntry(filePath, entryName) {
  const psFilePath = String(filePath).replace(/'/g, "''");
  const psEntryName = String(entryName).replace(/'/g, "''");
  const script = [
    `$xlsx='${psFilePath}'`,
    `$entryName='${psEntryName}'`,
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$zip=[System.IO.Compression.ZipFile]::OpenRead($xlsx)",
    "try {",
    "  $entry=$zip.GetEntry($entryName)",
    "  if (-not $entry) { exit 2 }",
    "  $reader=[System.IO.StreamReader]::new($entry.Open())",
    "  try { $reader.ReadToEnd() } finally { $reader.Dispose() }",
    "} finally { $zip.Dispose() }",
  ].join("\n");

  return execFileSync(
    "powershell",
    ["-NoProfile", "-Command", script],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 },
  );
}

function parseXmlAttributes(rawAttrs) {
  const attrs = {};
  for (const match of rawAttrs.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const siMatch of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const textParts = [];
    for (const textMatch of siMatch[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      textParts.push(decodeXmlText(textMatch[1]));
    }
    strings.push(textParts.join(""));
  }
  return strings;
}

function columnIndex(ref) {
  const letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseXlsx(filePath) {
  const sharedXml = readZipEntry(filePath, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheetXml = readZipEntry(filePath, "xl/worksheets/sheet1.xml");
  const rows = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseXmlAttributes(cellMatch[1]);
      const valueMatch = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = cellMatch[2].match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      let value = valueMatch ? decodeXmlText(valueMatch[1]) : "";
      if (attrs.t === "s" && value !== "") {
        value = sharedStrings[Number(value)] || "";
      } else if (attrs.t === "inlineStr" && inlineMatch) {
        value = decodeXmlText(inlineMatch[1]);
      }
      cells[columnIndex(attrs.r)] = value;
    }
    rows.push(cells.map((cell) => String(cell ?? "").trim()));
  }

  return parseRows(rows);
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => splitCsvLine(line));

  return parseRows(rows);
}

function parseRows(rows) {
  if (rows.length < 2) {
    throw new Error("FILE_EMPTY");
  }

  const headers = rows[0].map(normalizeHeader);
  const skuIndex = headers.indexOf("SKU");
  if (skuIndex === -1) {
    throw new Error("SKU_HEADER_MISSING");
  }

  const gradeIndexes = GRADES.map((grade) => [grade, headers.indexOf(grade)]);
  const missingHeaders = gradeIndexes.filter(([, index]) => index === -1).map(([grade]) => grade);
  if (missingHeaders.length) {
    throw new Error(`GRADE_HEADERS_MISSING: ${missingHeaders.join(", ")}`);
  }

  return rows.slice(1).map((cells, idx) => {
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

function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx") return parseXlsx(filePath);
  if (ext === ".csv") return parseCsv(filePath);
  throw new Error("Format non supporte. Utilisez .csv ou .xlsx");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    throw new Error(
      "Usage: node scripts/import-product-grade-prices.js <file.csv|file.xlsx> [--country CIV] [--ensure-schema] [--apply]",
    );
  }

  const filePath = path.resolve(args.file);
  if (args.ensureSchema) {
    await ensureProductGradePriceSchema();
  }
  const rows = parseFile(filePath);
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
