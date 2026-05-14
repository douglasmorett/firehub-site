/**
 * Script: criar admin do FireHub no banco
 * Uso: node scripts/create-firehub-admin.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const p = new PrismaClient();

async function main() {
  const email = 'admin@firehubfood.com.br';
  const password = 'FireHub@Admin2026!';
  
  const existing = await p.user.findUnique({ where: { email } });
  if (existing) {
    console.log('⚠️  Admin já existe:', email);
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const admin = await p.user.create({
    data: {
      name: 'Admin FireHub',
      email,
      password: hashed,
      role: 'ADMIN',
      slug: 'admin-firehub',
      storeName: 'FireHub Admin',
    }
  });
  
  console.log('\n✅ Admin FireHub criado com sucesso!');
  console.log('   Email:', email);
  console.log('   Senha:', password);
  console.log('   ID:', admin.id);
  console.log('\n⚠️  ANOTE ESSA SENHA E TROQUE APÓS O PRIMEIRO LOGIN!');
}

main()
  .catch(e => console.error('❌ Erro:', e.message))
  .finally(() => p.$disconnect());
