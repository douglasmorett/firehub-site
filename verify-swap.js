const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Use raw SQL to bypass schema mismatch
  const byId = await p.$queryRaw`SELECT id, name, email, role FROM "User" WHERE id = 'cmornm4wd0000l804s0jy0eit'`;
  console.log('User by ID:', byId[0] || 'NOT FOUND');

  const oldEmail = await p.$queryRaw`SELECT id, name, email FROM "User" WHERE email = 'tst.fabiano.andrade@gmail.com'`;
  console.log('Old email exists?', oldEmail.length > 0, oldEmail[0] || '');

  const newEmail = await p.$queryRaw`SELECT id, name, email FROM "User" WHERE email = 'viniciusmenezes.ofc@gmail.com'`;
  console.log('New email exists?', newEmail.length > 0, newEmail[0] || '');
}

main().catch(console.error).finally(() => p.$disconnect());
