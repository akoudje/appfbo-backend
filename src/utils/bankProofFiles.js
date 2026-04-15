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

  const response = await axios.get(raw, {
    responseType: "stream",
    timeout: 15000,
    maxRedirects: 5,
  });

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
