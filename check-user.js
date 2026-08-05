const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const user = await p.user.findFirst({
    where: { email: 'contatohakim@gmail.com' }
  });
  console.log("User:", user);
  if (user && user.password) {
    const bcrypt = require('bcryptjs');
    const is123456 = await bcrypt.compare('123456', user.password);
    console.log("Password matches 123456?", is123456);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
