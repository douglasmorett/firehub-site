import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  const email = "contatohakim@gmail.com";
  const newPass = process.env.NEW_PASSWORD;
  if (!newPass) throw new Error("Defina NEW_PASSWORD (a senha não fica no código).");

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

  console.log(`✅ SUCCESS! Password for ${email} reset (NEW_PASSWORD).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
