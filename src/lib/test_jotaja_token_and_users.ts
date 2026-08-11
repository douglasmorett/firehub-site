import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { jotajaFetch } = await import("./jotaja-api");
  const res = await jotajaFetch("/v1/events:polling");
  console.log("jotajaFetch /v1/events:polling status:", res.status);
  const text = await res.text();
  console.log("jotajaFetch /v1/events:polling text:", text);
}

main().catch(console.error).finally(() => prisma.$disconnect());
