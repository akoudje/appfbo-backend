// src/middlewares/validate.js
// Middleware de validation d'inputs sans dépendance externe.
// Chaque schéma est un objet { field: validatorFn } où validatorFn retourne
// une string d'erreur ou null.

"use strict";

/**
 * Crée un middleware Express qui valide req.body selon le schéma fourni.
 * Retourne 400 avec le détail des erreurs si la validation échoue.
 *
 * @param {Record<string, (value: unknown, body: object) => string|null>} schema
 */
function validateBody(schema) {
  return (req, res, next) => {
    const body   = req.body || {};
    const errors = {};

    for (const [field, validator] of Object.entries(schema)) {
      const error = validator(body[field], body);
      if (error) errors[field] = error;
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: "Données invalides", details: errors });
    }

    next();
  };
}

// ─── Helpers de validation réutilisables ──────────────────────────────────────

function required(label) {
  return (v) => (v == null || String(v).trim() === "" ? `${label} est requis` : null);
}

function isString(label, { minLength = 0, maxLength = 500 } = {}) {
  return (v) => {
    if (typeof v !== "string") return `${label} doit être une chaîne de caractères`;
    const t = v.trim();
    if (t.length < minLength) return `${label} doit faire au moins ${minLength} caractère(s)`;
    if (t.length > maxLength) return `${label} ne doit pas dépasser ${maxLength} caractères`;
    return null;
  };
}

/** Valide un UUID v4 ou un CUID (format alphanumérique, longueur 20-36) */
function isId(label) {
  return (v) => {
    if (!v || typeof v !== "string") return `${label} est requis`;
    const t = v.trim();
    if (t.length < 10 || t.length > 50) return `${label} invalide`;
    if (!/^[a-zA-Z0-9_-]+$/.test(t)) return `${label} contient des caractères invalides`;
    return null;
  };
}

/** Valide un numéro de téléphone (10 chiffres, optionnellement espacés) */
function isPhone(label) {
  return (v) => {
    if (!v || typeof v !== "string") return `${label} est requis`;
    const digits = v.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return `${label} invalide (8 à 15 chiffres attendus)`;
    return null;
  };
}

/** Valide un booléen optionnel */
function isOptionalBoolean(label) {
  return (v) => {
    if (v == null || v === "") return null;
    if (typeof v !== "boolean") return `${label} doit être un booléen`;
    return null;
  };
}

/** Valide une valeur dans une liste autorisée */
function isEnum(label, allowed) {
  return (v) => {
    if (v == null || v === "") return null; // optionnel
    if (!allowed.includes(v)) return `${label} invalide. Valeurs acceptées : ${allowed.join(", ")}`;
    return null;
  };
}

module.exports = { validateBody, required, isString, isId, isPhone, isOptionalBoolean, isEnum };
