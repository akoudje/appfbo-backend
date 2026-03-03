const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const code = String(process.env.DEFAULT_COUNTRY_CODE || "CI").trim().toUpperCase();
  const name = process.env.DEFAULT_COUNTRY_NAME || "Cote d'Ivoire";
  const currencyCode = (process.env.DEFAULT_COUNTRY_CURRENCY_CODE || "XOF").trim() || null;
  const minCartFcfa = readIntEnv("DEFAULT_MIN_CART_FCFA", 10000);

  const country = await prisma.country.upsert({
    where: { code },
    update: {
      name,
      currencyCode,
      actif: true,
    },
    create: {
      code,
      name,
      currencyCode,
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

  console.log(`Seed complete for country ${code} (${country.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
