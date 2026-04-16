require("dotenv").config();

const {
  cancelExpiredInvoicedPreorders,
} = require("../src/services/preorder-expiration.service");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await cancelExpiredInvoicedPreorders({ dryRun });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[cancel-expired-preinvoiced] failed", error);
    process.exit(1);
  });
