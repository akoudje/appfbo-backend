// prisma.js
// This file is responsible for creating and exporting a single instance of PrismaClient.
// This pattern ensures that we don't create multiple instances of PrismaClient during development
// due to hot reloading. In production, it simply creates one instance.

const { PrismaClient } = require("@prisma/client");

// PrismaClient est attaché au global object en développement pour éviter
// plusieurs instances chaudes avec hot reload
const globalForPrisma = global;

const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
