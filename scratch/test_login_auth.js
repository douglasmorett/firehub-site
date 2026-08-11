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
  const user = await prisma.user.findFirst({
    where: { email: { equals: "contatohakim@gmail.com", mode: "insensitive" } }
  });

  if (!user) {
    console.log("User not found");
    return;
  }

  const match = await bcrypt.compare("123456", user.password);
  console.log("Password match result for contatohakim@gmail.com with '123456':", match);
}

main().catch(console.error).finally(() => prisma.$disconnect());
