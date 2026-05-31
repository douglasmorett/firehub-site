const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

async function main() {
  const oldEmail = 'tst.fabiano.andrade@gmail.com';
  const newEmail = 'viniciusmenezes.ofc@gmail.com';
  const newPassword = '123456';

  // 1) Check the old user exists
  const user = await p.user.findUnique({ where: { email: oldEmail } });
  if (!user) {
    console.log(`❌ Usuário com email ${oldEmail} NÃO encontrado.`);
    return;
  }
  console.log(`✅ Usuário encontrado:`);
  console.log({ id: user.id, name: user.name, email: user.email, role: user.role });

  // 2) Check the new email is not already in use
  const existing = await p.user.findUnique({ where: { email: newEmail } });
  if (existing) {
    console.log(`❌ O email ${newEmail} já está em uso pelo usuário ${existing.id} (${existing.name}). Abortando.`);
    return;
  }

  // 3) Hash the new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // 4) Update email + password
  const updated = await p.user.update({
    where: { id: user.id },
    data: {
      email: newEmail,
      password: hashedPassword,
    },
  });

  console.log(`\n🔄 Atualizado com sucesso!`);
  console.log({
    id: updated.id,
    name: updated.name,
    emailAnterior: oldEmail,
    emailNovo: updated.email,
    role: updated.role,
    senhaAtualizada: true,
  });

  // 5) Verify orders are still linked
  const orderCount = await p.order.count({ where: { userId: user.id } });
  const customerOrderCount = await p.customerOrder.count({ where: { franchiseeId: user.id } });
  console.log(`\n📦 Pedidos mantidos: ${orderCount} orders + ${customerOrderCount} customerOrders`);
}

main().catch(console.error).finally(() => p.$disconnect());
