

// prisma.js

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
