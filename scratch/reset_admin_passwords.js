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
  const targetEmails = [
    "admin@firehubfood.com.br",
    "contatohakim@gmail.com",
    "admin@hakim.com.br"
  ];

  const defaultPass = "123456"; // ou hakim123
  const hash = await bcrypt.hash(defaultPass, 12);

  for (const email of targetEmails) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      await prisma.user.update({
        where: { email },
        data: { password: hash }
      });
      console.log(`✅ Senha do usuário ${email} resetada com sucesso para "${defaultPass}"`);
    } else {
      console.log(`⚠️ Usuário ${email} não encontrado.`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
