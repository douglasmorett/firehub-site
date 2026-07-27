require('dotenv').config({ path: '.env.local' });
let dbUrl = process.env.DATABASE_URL.replace("&channel_binding=require", "").replace("?channel_binding=require", "");
process.env.DATABASE_URL = dbUrl;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  const orders = await prisma.customerOrder.findMany({
    where: {
      OR: [
        { customerName: { contains: "Adalgiza", mode: "insensitive" } },
        { openDeliveryReference: "32555166" }
      ]
    },
    include: {
      items: {
        include: {
          menuProduct: true
        }
      }
    }
  });

  console.log("Pedido da Adalgiza no banco:", JSON.stringify(orders, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
