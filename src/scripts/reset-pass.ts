import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const email = "contatohakim@gmail.com";
  const newPass = "hakim123";

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`User ${email} NOT FOUND in DB! Listing all users:`);
    const all = await prisma.user.findMany({ select: { email: true, name: true, role: true } });
    console.log(all);
    return;
  }

  const hash = await bcrypt.hash(newPass, 10);
  await prisma.user.update({
    where: { email },
    data: { password: hash }
  });

  console.log(`✅ SUCCESS! Password for ${email} reset to '${newPass}'.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
