const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const args = { file: null, sku: null, grade: null, price: null, apply: false };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--sku") args.sku = String(argv[++i] || "").trim();
    else if (value === "--grade") args.grade = String(argv[++i] || "").trim().toUpperCase();
    else if (value === "--price") args.price = Number(String(argv[++i] || "").replace(",", "."));
    else if (value === "--apply") args.apply = true;
    else if (!args.file) args.file = value;
  }
  return args;
}

function psEscape(value) {
  return String(value).replace(/'/g, "''");
}

function readZipEntry(filePath, entryName) {
  const script = [
    `$xlsx='${psEscape(filePath)}'`,
    `$entryName='${psEscape(entryName)}'`,
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$zip=[System.IO.Compression.ZipFile]::OpenRead($xlsx)",
    "try {",
    "  $entry=$zip.GetEntry($entryName)",
    "  if (-not $entry) { exit 2 }",
    "  $reader=[System.IO.StreamReader]::new($entry.Open())",
    "  try { $reader.ReadToEnd() } finally { $reader.Dispose() }",
    "} finally { $zip.Dispose() }",
  ].join("\n");
  return execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
}

function writeZipEntry(filePath, entryName, content) {
  const tempPath = `${filePath}.${Date.now()}.tmp.xml`;
  fs.writeFileSync(tempPath, content, "utf8");
  const script = [
    `$xlsx='${psEscape(filePath)}'`,
    `$entryName='${psEscape(entryName)}'`,
    `$temp='${psEscape(tempPath)}'`,
    "Add-Type -AssemblyName System.IO.Compression",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "$zip=[System.IO.Compression.ZipFile]::Open($xlsx, [System.IO.Compression.ZipArchiveMode]::Update)",
    "try {",
    "  $entry=$zip.GetEntry($entryName)",
    "  if ($entry) { $entry.Delete() }",
    "  $newEntry=$zip.CreateEntry($entryName)",
    "  $writer=[System.IO.StreamWriter]::new($newEntry.Open())",
    "  try { $writer.Write([System.IO.File]::ReadAllText($temp)) } finally { $writer.Dispose() }",
    "} finally { $zip.Dispose() }",
  ].join("\n");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
    });
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
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
    const parts = [];
    for (const textMatch of siMatch[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      parts.push(decodeXmlText(textMatch[1]));
    }
    strings.push(parts.join(""));
  }
  return strings;
}

function parseXmlAttributes(rawAttrs) {
  const attrs = {};
  for (const match of rawAttrs.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function normalizeHeader(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function columnIndex(ref) {
  const letters = String(ref || "").replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function getCellValue(cellXml, attrs, sharedStrings) {
  const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
  const inlineMatch = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
  let value = valueMatch ? decodeXmlText(valueMatch[1]) : "";
  if (attrs.t === "s" && value !== "") value = sharedStrings[Number(value)] || "";
  else if (attrs.t === "inlineStr" && inlineMatch) value = decodeXmlText(inlineMatch[1]);
  return value;
}

function replaceCellValue(cellXml, value) {
  let numericCellXml = cellXml
    .replace(/\s+t="s"/, "")
    .replace(/\s+t="str"/, "")
    .replace(/\s+t="inlineStr"/, "")
    .replace(/<is>[\s\S]*?<\/is>/, "");
  if (/<v>[\s\S]*?<\/v>/.test(numericCellXml)) {
    return numericCellXml.replace(/<v>[\s\S]*?<\/v>/, `<v>${value}</v>`);
  }
  return numericCellXml.replace(/<\/c>$/, `<v>${value}</v></c>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.file || !args.sku || !args.grade || !Number.isFinite(args.price)) {
    throw new Error("Usage: node scripts/set-xlsx-grade-price.js <file.xlsx> --sku 815 --grade ANIMATEUR_ADJOINT --price 15009.25 [--apply]");
  }

  const filePath = path.resolve(args.file);
  const sharedStrings = parseSharedStrings(readZipEntry(filePath, "xl/sharedStrings.xml"));
  const sheetEntry = "xl/worksheets/sheet1.xml";
  const sheetXml = readZipEntry(filePath, sheetEntry);
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)];
  const headerCells = [];

  for (const cellMatch of rows[0][0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = parseXmlAttributes(cellMatch[1]);
    headerCells[columnIndex(attrs.r)] = normalizeHeader(getCellValue(cellMatch[0], attrs, sharedStrings));
  }

  const skuCol = headerCells.indexOf("SKU");
  const gradeCol = headerCells.indexOf(args.grade);
  if (skuCol === -1) throw new Error("Colonne SKU introuvable");
  if (gradeCol === -1) throw new Error(`Colonne ${args.grade} introuvable`);

  let updatedXml = sheetXml;
  let found = false;
  let previous = null;

  for (const rowMatch of rows.slice(1)) {
    const rowXml = rowMatch[0];
    const cells = [];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseXmlAttributes(cellMatch[1]);
      cells[columnIndex(attrs.r)] = { xml: cellMatch[0], attrs };
    }
    const skuCell = cells[skuCol];
    const priceCell = cells[gradeCol];
    if (!skuCell || !priceCell) continue;
    if (String(getCellValue(skuCell.xml, skuCell.attrs, sharedStrings)).trim() !== args.sku) continue;

    previous = getCellValue(priceCell.xml, priceCell.attrs, sharedStrings);
    const updatedRowXml = rowXml.replace(priceCell.xml, replaceCellValue(priceCell.xml, args.price));
    updatedXml = updatedXml.replace(rowXml, updatedRowXml);
    found = true;
    break;
  }

  if (!found) throw new Error(`SKU introuvable: ${args.sku}`);

  console.log(JSON.stringify({
    file: filePath,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    sku: args.sku,
    grade: args.grade,
    previous,
    next: args.price,
  }, null, 2));

  if (!args.apply) {
    console.log("Dry-run only. Add --apply to write the workbook.");
    return;
  }

  writeZipEntry(filePath, sheetEntry, updatedXml);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
