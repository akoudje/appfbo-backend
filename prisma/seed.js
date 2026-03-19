// backend/prisma/seed.js
// Seed de la base : pays + paramètres + remises + super admin + provider Wave simulation

const { PrismaClient, AdminRole } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function seedSuperAdmin(defaultCountryId) {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL || "admin@forverver.ci";
  const passwordRaw = process.env.SEED_SUPER_ADMIN_PASSWORD || "Test1234!";

  const existing = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (existing) {
    console.log("Super admin already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(passwordRaw, 10);

  await prisma.adminUser.create({
    data: {
      email,
      password: passwordHash,
      fullName: "Super Admin",
      role: AdminRole.SUPER_ADMIN,
      actif: true,
      countryId: defaultCountryId,
    },
  });

  console.log("Super admin created:", email);
}

async function seedWaveProviderAccount(defaultCountryId) {
  if (!defaultCountryId) return null;

  const existing = await prisma.paymentProviderAccount.findFirst({
    where: {
      countryId: defaultCountryId,
      provider: "WAVE",
    },
  });

  if (existing) {
    console.log("Wave provider account already exists for default country");
    return existing;
  }

  const account = await prisma.paymentProviderAccount.create({
    data: {
      countryId: defaultCountryId,
      provider: "WAVE",
      label: "Wave CIV Simulation",
      status: "ACTIVE",
      merchantIdentifier: "wave-civ-sim",
      apiBaseUrl: process.env.WAVE_API_BASE_URL || "https://api.wave.com",
      configEncrypted: JSON.stringify({
        mode: "simulation",
        apiKeyPresent: !!process.env.WAVE_API_KEY,
      }),
      supportsCheckout: true,
      supportsWebhook: true,
      supportsRefund: false,
    },
  });

  console.log("Wave provider account created for default country");
  return account;
}

async function main() {
  const defaultCode = String(process.env.DEFAULT_COUNTRY_CODE || "CIV")
    .trim()
    .toUpperCase();

  const minCartFcfa = readIntEnv("DEFAULT_MIN_CART_FCFA", 100);
  const maxActiveBillingPerInvoicer = readIntEnv(
    "DEFAULT_MAX_ACTIVE_BILLING_PER_INVOICER",
    5,
  );
  const billingClaimTimeoutMin = readIntEnv(
    "DEFAULT_BILLING_CLAIM_TIMEOUT_MIN",
    15,
  );

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
      currencyCode:
        (process.env.DEFAULT_COUNTRY_CURRENCY_CODE || "XOF").trim() || null,
    });
  }

  let defaultCountryId = null;

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

    if (entry.code === defaultCode) {
      defaultCountryId = country.id;
    }

    await prisma.countrySettings.upsert({
      where: { countryId: country.id },
      update: {
        minCartFcfa,
        maxActiveBillingPerInvoicer,
        billingClaimTimeoutMin,
      },
      create: {
        countryId: country.id,
        minCartFcfa,
        maxActiveBillingPerInvoicer,
        billingClaimTimeoutMin,
      },
    });

    const gradeDiscounts = [
      ["CLIENT_PRIVILEGIE", "5.00"],
      ["ANIMATEUR_ADJOINT", "30.00"],
      ["ANIMATEUR", "38.00"],
      ["MANAGER_ADJOINT", "43.00"],
      ["MANAGER", "48.00"],
    ];

    for (const [grade, discount] of gradeDiscounts) {
      await prisma.gradeDiscount.upsert({
        where: {
          countryId_grade: {
            countryId: country.id,
            grade,
          },
        },
        update: {
          discountPercent: discount,
        },
        create: {
          countryId: country.id,
          grade,
          discountPercent: discount,
        },
      });
    }
  }

  console.log(
    `Seed complete for countries: ${countriesToSeed
      .map((c) => c.code)
      .join(", ")}`,
  );

  if (defaultCountryId) {
    await seedWaveProviderAccount(defaultCountryId);
    await seedSuperAdmin(defaultCountryId);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });