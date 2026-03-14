const bcrypt = require("bcryptjs");
const prisma = require("../src/prisma");

async function main() {
  const email = "admin@forever.ci".trim().toLowerCase();
  const newPassword = "Test1234!";

  const admin = await prisma.adminUser.findUnique({
    where: { email },
  });

  if (!admin) {
    throw new Error(`Admin introuvable: ${email}`);
  }

  const hash = await bcrypt.hash(newPassword, 10);

  await prisma.adminUser.update({
    where: { email },
    data: {
      password: hash,
      actif: true,
    },
  });

  console.log(`Mot de passe réinitialisé pour ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });