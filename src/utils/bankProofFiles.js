const fs = require("fs");
const path = require("path");
const axios = require("axios");

const PRIVATE_PREFIX = "private://bank-proofs/";

function getPrivateBankProofDir() {
  return path.join(__dirname, "..", "..", "private_uploads", "bank-proofs");
}

function ensurePrivateBankProofDir() {
  const dir = getPrivateBankProofDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildPrivateBankProofRef(fileName = "") {
  const safeName = path.basename(String(fileName || "").trim());
  return `${PRIVATE_PREFIX}${safeName}`;
}

function getLegacyBankProofDir() {
  return path.join(__dirname, "..", "..", "uploads", "bank-proofs");
}

function resolveBankProofAbsolutePath(fileUrl = "") {
  const raw = String(fileUrl || "").trim();
  if (!raw) return null;

  if (raw.startsWith(PRIVATE_PREFIX)) {
    const fileName = path.basename(raw.slice(PRIVATE_PREFIX.length));
    if (!fileName) return null;
    return path.join(getPrivateBankProofDir(), fileName);
  }

  if (raw.startsWith("/uploads/bank-proofs/")) {
    const fileName = path.basename(raw);
    if (!fileName) return null;
    return path.join(getLegacyBankProofDir(), fileName);
  }

  return null;
}

function isRemoteBankProofUrl(fileUrl = "") {
  return /^https?:\/\//i.test(String(fileUrl || "").trim());
}

function buildRemoteBankProofCandidates(raw = "", fileMimeType = "") {
  const candidates = [raw];
  const mime = String(fileMimeType || "").toLowerCase();

  if (mime.includes("pdf") && raw.includes("/image/upload/")) {
    candidates.push(raw.replace("/image/upload/", "/raw/upload/"));
  }

  if (!mime.includes("pdf") && raw.includes("/raw/upload/")) {
    candidates.push(raw.replace("/raw/upload/", "/image/upload/"));
  }

  return [...new Set(candidates.filter(Boolean))];
}

// Cloudinary refuse la livraison publique des PDF sur ce compte (401 "deny or ACL
// failure"). On retombe alors sur un téléchargement signé via l'API, qui n'est
// pas soumis à cette restriction.
function buildCloudinarySignedDownloadUrl(raw = "") {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  if (parsed.hostname !== "res.cloudinary.com") return null;

  const match = parsed.pathname.match(
    /^\/[^/]+\/(image|raw|video)\/(upload|authenticated|private)\/(?:v\d+\/)?(.+)$/,
  );
  if (!match) return null;

  const [, resourceType, deliveryType, encodedPath] = match;
  const assetPath = decodeURIComponent(encodedPath);
  // Pour "raw", l'extension fait partie du public_id ; pour image/video, c'est le format.
  const ext = path.extname(assetPath);
  const publicId = resourceType === "raw" || !ext ? assetPath : assetPath.slice(0, -ext.length);
  const format = resourceType === "raw" ? "" : ext.replace(/^\./, "");

  // Chargé ici pour ne pas exiger la config Cloudinary quand elle est inutile.
  const { cloudinary } = require("../services/cloudinary");
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    type: deliveryType,
  });
}

async function streamBankProofFileToResponse({
  res,
  fileUrl,
  fileMimeType,
  originalFileName,
}) {
  const raw = String(fileUrl || "").trim();
  if (!raw) {
    return false;
  }

  const absPath = resolveBankProofAbsolutePath(raw);
  if (absPath && fs.existsSync(absPath)) {
    const stat = fs.statSync(absPath);
    const fileName = path.basename(originalFileName || absPath);

    res.setHeader("Content-Type", fileMimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size || 0));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName.replace(/"/g, "")}"`,
    );
    fs.createReadStream(absPath).pipe(res);
    return true;
  }

  if (!isRemoteBankProofUrl(raw)) {
    return false;
  }

  let response = null;
  let lastError = null;
  const candidateUrls = buildRemoteBankProofCandidates(raw, fileMimeType);
  const signedUrl = buildCloudinarySignedDownloadUrl(raw);
  if (signedUrl) candidateUrls.push(signedUrl);
  for (const candidateUrl of candidateUrls) {
    try {
      response = await axios.get(candidateUrl, {
        responseType: "stream",
        timeout: 15000,
        maxRedirects: 5,
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    throw lastError || new Error("Fichier preuve distant inaccessible");
  }

  const remoteType = String(response?.headers?.["content-type"] || "").trim();
  const remoteLength = String(response?.headers?.["content-length"] || "").trim();
  const urlPathName = (() => {
    try {
      return new URL(raw).pathname || "";
    } catch {
      return "";
    }
  })();
  const fileName = path.basename(originalFileName || urlPathName || "proof");

  res.setHeader(
    "Content-Type",
    fileMimeType || remoteType || "application/octet-stream",
  );
  if (remoteLength) {
    res.setHeader("Content-Length", remoteLength);
  }
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${fileName.replace(/"/g, "")}"`,
  );

  response.data.pipe(res);
  return true;
}

module.exports = {
  PRIVATE_PREFIX,
  getPrivateBankProofDir,
  ensurePrivateBankProofDir,
  buildPrivateBankProofRef,
  resolveBankProofAbsolutePath,
  isRemoteBankProofUrl,
  streamBankProofFileToResponse,
};
