// src/services/document-quality.service.js
// Contrôle des pièces d'identité envoyées (parrainage) : format réel (signature
// du fichier, pas seulement le type annoncé) et PDF lisible. Pas de taille ni de
// poids minimum : la lisibilité est appréciée par le facturier.

const fs = require("fs");

// Format réel d'après les premiers octets.
function detectFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  return null;
}

// Renvoie un message d'erreur, ou null si la pièce est acceptable.
// `label` : « Recto de la pièce », « Passeport »…
async function checkDocumentQuality({ path, mimetype }, label) {
  const buffer = fs.readFileSync(path);
  const format = detectFormat(buffer);
  const declaredPdf = String(mimetype || "").toLowerCase() === "application/pdf";
  if (!format || (format === "pdf") !== declaredPdf) {
    return `${label} : le fichier n'est pas une image JPG, PNG, WEBP ou un PDF valide.`;
  }
  if (format === "pdf") {
    try {
      const { PDFDocument } = require("pdf-lib");
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      if (pdf.getPageCount() < 1) return `${label} : le PDF ne contient aucune page.`;
    } catch {
      return `${label} : PDF illisible ou endommagé.`;
    }
  }
  return null;
}

module.exports = { checkDocumentQuality, detectFormat };
