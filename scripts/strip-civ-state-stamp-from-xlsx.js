const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GRADE_HEADERS = [
  "CLIENT_PRIVILEGIE",
  "ANIMATEUR_ADJOINT",
  "ANIMATEUR",
  "MANAGER_ADJOINT",
  "MANAGER",
];

function parseArgs(argv) {
  const args = { file: null, apply: false, force: false };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--apply") args.apply = true;
    else if (value === "--force") args.force = true;
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
    const textParts = [];
    for (const textMatch of siMatch[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
      textParts.push(decodeXmlText(textMatch[1]));
    }
    strings.push(textParts.join(""));
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

function computeIncludedStateStampFcfa(invoiceAmountFcfa) {
  const amount = Math.round(Number(invoiceAmountFcfa || 0));
  if (amount <= 5000) return 0;
  if (amount <= 100000) return 100;
  if (amount <= 500000) return 500;
  if (amount <= 1000000) return 1000;
  if (amount <= 5000000) return 2000;
  return 5000;
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
  if (!args.file) {
    throw new Error("Usage: node scripts/strip-civ-state-stamp-from-xlsx.js <file.xlsx> [--apply] [--force]");
  }

  const filePath = path.resolve(args.file);
  const sharedXml = readZipEntry(filePath, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheetEntry = "xl/worksheets/sheet1.xml";
  const sheetXml = readZipEntry(filePath, sheetEntry);

  const rows = [...sheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)];
  if (!rows.length) throw new Error("Aucune ligne trouvee dans la feuille 1");

  const headerCells = [];
  for (const cellMatch of rows[0][0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = parseXmlAttributes(cellMatch[1]);
    headerCells[columnIndex(attrs.r)] = normalizeHeader(
      getCellValue(cellMatch[0], attrs, sharedStrings),
    );
  }

  const gradeColumns = new Set();
  for (const header of GRADE_HEADERS) {
    const index = headerCells.indexOf(header);
    if (index === -1) throw new Error(`Colonne manquante: ${header}`);
    gradeColumns.add(index);
  }

  let updatedXml = sheetXml;
  let cellsUpdated = 0;
  let totalStampRemovedFcfa = 0;

  for (const rowMatch of rows.slice(1)) {
    const rowXml = rowMatch[0];
    let updatedRowXml = rowXml;
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseXmlAttributes(cellMatch[1]);
      if (!gradeColumns.has(columnIndex(attrs.r))) continue;

      const rawValue = getCellValue(cellMatch[0], attrs, sharedStrings);
      const amount = parseMoney(rawValue);
      if (amount === null) continue;

      const stamp = computeIncludedStateStampFcfa(amount);
      if (!stamp) continue;

      const adjusted = Math.max(0, amount - stamp);
      updatedRowXml = updatedRowXml.replace(cellMatch[0], replaceCellValue(cellMatch[0], adjusted));
      cellsUpdated += 1;
      totalStampRemovedFcfa += stamp;
    }
    if (updatedRowXml !== rowXml) updatedXml = updatedXml.replace(rowXml, updatedRowXml);
  }

  console.log(JSON.stringify({
    file: filePath,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    cellsUpdated,
    totalStampRemovedFcfa,
  }, null, 2));

  if (!args.apply) {
    console.log("Dry-run only. Add --apply to write the adjusted workbook.");
    return;
  }

  const backupPath = `${filePath}.bak`;
  if (fs.existsSync(backupPath) && !args.force) {
    throw new Error(
      `Backup deja existant: ${backupPath}. Refus d'appliquer une deuxieme soustraction. Ajoutez --force uniquement si le fichier a ete restaure.`,
    );
  }
  if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
  writeZipEntry(filePath, sheetEntry, updatedXml);
  console.log(`Workbook updated. Backup: ${backupPath}`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
