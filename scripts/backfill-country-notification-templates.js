require("dotenv").config();

const prisma = require("../src/prisma");
const {
  buildDefaultNotificationTemplates,
  mergeNotificationTemplates,
} = require("../src/services/notification-template-defaults");

function normalizeMode(args = []) {
  if (args.includes("--apply")) return "apply";
  return "dry-run";
}

function buildUpdatedTemplates(currentTemplates = null) {
  const defaults = buildDefaultNotificationTemplates();
  const current =
    currentTemplates && typeof currentTemplates === "object" && !Array.isArray(currentTemplates)
      ? currentTemplates
      : {};

  const merged = mergeNotificationTemplates(current, defaults);
  merged.sms = {
    ...(current.sms || {}),
    INVOICE: defaults.sms.INVOICE,
    INVOICE_WAVE: defaults.sms.INVOICE_WAVE,
    INVOICE_BANK_TRANSFER: defaults.sms.INVOICE_BANK_TRANSFER,
    INVOICE_ECOBANK_PAY: defaults.sms.INVOICE_ECOBANK_PAY,
    INVOICE_CASH: defaults.sms.INVOICE_CASH,
    PAYMENT_CONFIRMED: defaults.sms.PAYMENT_CONFIRMED,
  };
  merged.email = {
    ...(current.email || {}),
    INVOICE: defaults.email.INVOICE,
    INVOICE_ECOBANK_PAY: defaults.email.INVOICE_ECOBANK_PAY,
    PAYMENT_CONFIRMED: defaults.email.PAYMENT_CONFIRMED,
  };
  merged.meta = {
    ...(current.meta || {}),
    ...defaults.meta,
    lastBackfilledAt: new Date().toISOString(),
  };

  return merged;
}

async function main() {
  const mode = normalizeMode(process.argv.slice(2));
  const rows = await prisma.countrySettings.findMany({
    select: {
      id: true,
      countryId: true,
      notificationTemplates: true,
      country: {
        select: {
          code: true,
          name: true,
        },
      },
    },
    orderBy: {
      country: {
        code: "asc",
      },
    },
  });

  const summary = [];

  for (const row of rows) {
    const nextTemplates = buildUpdatedTemplates(row.notificationTemplates);
    summary.push({
      countryId: row.countryId,
      countryCode: row.country?.code || null,
      countryName: row.country?.name || null,
      templateVersion: nextTemplates?.meta?.version || null,
      paymentExpiryHours: nextTemplates?.meta?.paymentExpiryHours || null,
    });

    if (mode !== "apply") continue;

    await prisma.countrySettings.update({
      where: { countryId: row.countryId },
      data: {
        notificationTemplates: nextTemplates,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        mode,
        count: summary.length,
        countries: summary,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[backfill-country-notification-templates] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
