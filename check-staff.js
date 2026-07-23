const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const prisma = new PrismaClient();
  
  const user = await prisma.user.findUnique({
    where: { email: "anaclarasonia22@gmail.com" },
    select: { id: true, name: true, email: true, role: true, password: true, ownerId: true }
  });

  if (!user) {
    console.log("❌ USUÁRIO NÃO ENCONTRADO no banco de dados!");
    await prisma.$disconnect();
    return;
  }

  console.log("✅ Usuário encontrado:");
  console.log("  ID:", user.id);
  console.log("  Nome:", user.name);
  console.log("  Email:", user.email);
  console.log("  Role:", user.role);
  console.log("  OwnerId:", user.ownerId);
  console.log("  Password hash:", user.password?.substring(0, 20) + "...");
  console.log("  Password length:", user.password?.length);

  // Testa se a senha "123456" é válida
  const match = await bcrypt.compare("123456", user.password);
  console.log("\n🔑 Senha '123456' bate?", match ? "✅ SIM" : "❌ NÃO");

  await prisma.$disconnect();
}

main().catch(console.error);
