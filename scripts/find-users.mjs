import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const users = await prisma.user.findMany({
  where: { role: 'FRANCHISEE' },
  select: { id: true, name: true, email: true, role: true, storeSlug: true },
  take: 5
})

console.log('Usuários FRANCHISEE encontrados:')
users.forEach(u => console.log(`Nome: ${u.name} | Email: ${u.email} | Loja: ${u.storeSlug}`))

await prisma.$disconnect()
