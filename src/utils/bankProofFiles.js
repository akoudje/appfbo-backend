const fs = require("fs");
const path = require("path");

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

module.exports = {
  PRIVATE_PREFIX,
  getPrivateBankProofDir,
  ensurePrivateBankProofDir,
  buildPrivateBankProofRef,
  resolveBankProofAbsolutePath,
};

