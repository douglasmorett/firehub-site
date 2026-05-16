const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@firehubfood.com.br';
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    console.log('User not found. Creating admin...');
    const hashedPassword = await bcrypt.hash('123456', 10);
    const newAdmin = await prisma.user.create({
      data: {
        name: 'Admin FireHub',
        email,
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
    console.log('Admin created:', newAdmin.email);
  } else {
    console.log('User exists. Updating password to 123456 and role to ADMIN...');
    const hashedPassword = await bcrypt.hash('123456', 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword, role: 'ADMIN' },
    });
    console.log('Admin updated.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
