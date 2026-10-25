const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'tester@firehubfood.com.br';
  if (!process.env.TESTER_PASSWORD) throw new Error('Defina TESTER_PASSWORD (a senha não fica no código).');
  const password = await bcrypt.hash(process.env.TESTER_PASSWORD, 10);
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
