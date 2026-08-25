// prisma.js
// This file is responsible for creating and exporting a single instance of PrismaClient.
// This pattern ensures that we don't create multiple instances of PrismaClient during development
// due to hot reloading. In production, it simply creates one instance.

const { PrismaClient } = require("@prisma/client");

// Ajoute des bornes de pool de connexions explicites à l'URL de la base si
// elles n'y figurent pas déjà.
//
// - connection_limit n'est PAS fixé par défaut : Prisma le calcule sinon à
//   partir du nombre de cœurs CPU de la machine qui l'exécute, et un test de
//   charge a montré qu'un chiffre codé en dur peut être pire que ce calcul
//   automatique selon la machine (ex. 12 cœurs → pool par défaut de 25, donc
//   imposer 10 dégrade les perfs). Ça reste réglable via DB_POOL_SIZE pour
//   ajuster manuellement une instance précise (ex. petite instance Render).
// - pool_timeout, lui, est toujours porté à une valeur un peu plus généreuse
//   que le défaut Prisma (10s) : ça ne réduit pas la taille du pool, ça
//   donne juste plus de temps à une requête en file d'attente avant de
//   timeout, ce qui est sans risque de régression.
function withPoolParams(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connection_limit") && process.env.DB_POOL_SIZE) {
      parsed.searchParams.set("connection_limit", String(process.env.DB_POOL_SIZE));
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set(
        "pool_timeout",
        String(process.env.DB_POOL_TIMEOUT_SECONDS || 20),
      );
    }
    return parsed.toString();
  } catch (error) {
    console.warn("[prisma] Impossible de parser DATABASE_URL pour y ajouter le pool:", error.message);
    return url;
  }
}

// PrismaClient est attaché au global object en développement pour éviter
// plusieurs instances chaudes avec hot reload
const globalForPrisma = global;

const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: { url: withPoolParams(process.env.DATABASE_URL) },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
