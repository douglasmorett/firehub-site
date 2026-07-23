require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  
  const authRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grantType: "client_credentials", clientId, clientSecret })
  });
  const authData = await authRes.json();
  const token = authData.accessToken;

  console.log("🔑 Token iFood obtido com sucesso!");

  // 1. Busca eventos da fila polling do iFood
  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    headers: { Authorization: `Bearer ${token}` }
  });

  console.log("Status GET /events/v1.0/events:polling:", res.status);
  const events = await res.json().catch(() => []);
  console.log("📋 Eventos na fila do iFood:", JSON.stringify(events, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
