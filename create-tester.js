const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'tester@firehubfood.com.br';
  const password = await bcrypt.hash('123456', 10);
  await prisma.user.upsert({
    where: { email },
    update: { password, role: 'FRANCHISEE' },
    create: {
      name: 'Cliente Teste',
      email,
      password,
      role: 'FRANCHISEE',
      storeName: 'Loja Teste QA',
      cpfCnpj: '00000000000000',
      slug: 'loja-teste-qa'
    }
  });
  console.log('Tester user ready');
}

main().catch(console.error).finally(()=>prisma.$disconnect());
