// backend/prisma/seed.js
// This script seeds the database with initial country data and related settings.

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const defaultCode = String(process.env.DEFAULT_COUNTRY_CODE || "CIV").trim().toUpperCase();
  const minCartFcfa = readIntEnv("DEFAULT_MIN_CART_FCFA", 10000);
  const countriesToSeed = [
    { code: "CIV", name: "Cote d'Ivoire", currencyCode: "XOF" },
    { code: "BFA", name: "Burkina Faso", currencyCode: "XOF" },
    { code: "TGO", name: "Togo", currencyCode: "XOF" }, 
    { code: "BEN", name: "Benin", currencyCode: "XOF" },
    { code: "NER", name: "Niger", currencyCode: "XOF" },
  ];

  if (!countriesToSeed.some((c) => c.code === defaultCode)) {
    countriesToSeed.unshift({
      code: defaultCode,
      name: process.env.DEFAULT_COUNTRY_NAME || defaultCode,
      currencyCode: (process.env.DEFAULT_COUNTRY_CURRENCY_CODE || "XOF").trim() || null,
    });
  }

  for (const entry of countriesToSeed) {
    const country = await prisma.country.upsert({
      where: { code: entry.code },
      update: {
        name: entry.name,
        currencyCode: entry.currencyCode,
        actif: true,
      },
      create: {
        code: entry.code,
        name: entry.name,
        currencyCode: entry.currencyCode,
        actif: true,
      },
    });

    await prisma.countrySettings.upsert({
      where: { countryId: country.id },
      update: { minCartFcfa },
      create: {
        countryId: country.id,
        minCartFcfa,
      },
    });

    await prisma.gradeDiscount.upsert({
      where: {
        countryId_grade: {
          countryId: country.id,
          grade: "ANIMATEUR",
        },
      },
      update: { discountPercent: "10.00" },
      create: {
        countryId: country.id,
        grade: "ANIMATEUR",
        discountPercent: "10.00",
      },
    });
  }

  console.log(`Seed complete for countries: ${countriesToSeed.map((c) => c.code).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
