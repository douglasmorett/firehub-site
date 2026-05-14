const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = 'teste@firehubfood.com.br';
  const password = 'FireHub@2026';
  const hash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Atualiza a senha
    await prisma.user.update({ where: { email }, data: { password: hash } });
    console.log('Usuário atualizado!');
  } else {
    await prisma.user.create({
      data: {
        name: 'Lojista Teste',
        email,
        password: hash,
        role: 'FRANCHISEE',
        slug: 'loja-teste',
        storeName: 'Loja de Teste FireHub',
      }
    });
    console.log('Usuário criado!');
  }

  console.log('\n=== CREDENCIAIS DE TESTE ===');
  console.log('Email:', email);
  console.log('Senha:', password);
  console.log('URL:', 'https://firehubfood.com.br/login');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); prisma.$disconnect(); });
