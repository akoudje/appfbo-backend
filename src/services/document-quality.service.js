// src/services/document-quality.service.js
// Contrôle qualité des pièces d'identité envoyées (parrainage) : format réel (signature du fichier, pas seulement le type annoncé), résolution
// des images (lue dans l'en-tête, sans dépendance) et PDF lisible.

const fs = require("fs");

const MIN_LONG_SIDE_PX = 1000;
const MIN_SHORT_SIDE_PX = 600;

// Format réel d'après les premiers octets.
function detectFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  return null;
}

// Dimensions { width, height } d'une image JPEG / PNG / WEBP, ou null.
function readImageSize(buffer, format) {
  try {
    if (format === "png") return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (format === "jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) return null;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF15 (hors DHT C4, JPG C8, DAC CC) : hauteur puis largeur.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
      return null;
    }
    if (format === "webp") {
      const chunk = buffer.toString("ascii", 12, 16);
      if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
    }
  } catch {
    return null;
  }
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
    return null;
  }
  const dimensions = readImageSize(buffer, format);
  if (!dimensions) return `${label} : image illisible. Reprenez la photo.`;
  const longSide = Math.max(dimensions.width, dimensions.height);
  const shortSide = Math.min(dimensions.width, dimensions.height);
  if (longSide < MIN_LONG_SIDE_PX || shortSide < MIN_SHORT_SIDE_PX) {
    return `${label} : photo trop petite (${dimensions.width} × ${dimensions.height} px). Il faut au moins ${MIN_LONG_SIDE_PX} × ${MIN_SHORT_SIDE_PX} px : rapprochez-vous de la pièce ou utilisez l'appareil photo plutôt qu'une capture d'écran.`;
  }
  return null;
}

module.exports = { MIN_LONG_SIDE_PX, MIN_SHORT_SIDE_PX, checkDocumentQuality, detectFormat, readImageSize };
