const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const email = "contatohakim@gmail.com";
  const newPassword = "123456"; // Senha limpa para teste de acesso
  const hash = await bcrypt.hash(newPassword, 12);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, isFranqueadoHakim: true }
  });

  if (!user) {
    console.log(`❌ Usuário ${email} não encontrado no banco!`);
    return;
  }

  await prisma.user.update({
    where: { email },
    data: { password: hash }
  });

  console.log(`✅ Sucesso! Senha da conta "${email}" redefinida para: "${newPassword}"`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
