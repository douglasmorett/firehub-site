/**
 * Liga (ou desliga) `kdsConfig.finalizacaoSoComTudoPronto` de uma loja: o
 * pedido só entra na finalização do KDS quando todas as telas de produção que
 * têm item dele deram o pronto (lib/kds-telas.ts, `esperaTodaAProducao`).
 *
 *   npx tsx scripts/ligar-finalizacao-so-no-fim.ts <lojaId>              # só mostra
 *   npx tsx scripts/ligar-finalizacao-so-no-fim.ts <lojaId> --gravar     # liga
 *   npx tsx scripts/ligar-finalizacao-so-no-fim.ts <lojaId> --desligar   # desliga
 *
 * Grava só a chave nova (o `||` do jsonb mantém o resto do kdsConfig) e guarda
 * o kdsConfig de antes em ~/firehub-backups/ antes de gravar.
 * NIK Esfihas e Pizzas: cmtn5q78c00ebte01zsqrggqx.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import os from "os";
import path from "path";

const lojaId = process.argv[2];
const gravar = process.argv.includes("--gravar");
const desligar = process.argv.includes("--desligar");
if (!lojaId || lojaId.startsWith("--")) {
  console.error("Uso: npx tsx scripts/ligar-finalizacao-so-no-fim.ts <lojaId> [--gravar | --desligar]");
  process.exit(2);
}

const prisma = new PrismaClient();

async function main() {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, name: true, storeName: true, kdsConfig: true, kdsScreens: true } });
  if (!loja) throw new Error(`loja ${lojaId} não encontrada`);
  const telas = Array.isArray(loja.kdsScreens) ? (loja.kdsScreens as any[]) : [];
  const deProducao = telas.filter((t) => String(t?.stage || "").toLowerCase() === "production").map((t) => t?.name);
  console.log(`Loja: ${loja.storeName || loja.name} (${loja.id})`);
  console.log(`Telas de produção: ${deProducao.join(", ") || "nenhuma"}${deProducao.length < 2 ? "  (com menos de 2 a regra não muda nada)" : ""}`);
  console.log("kdsConfig hoje:", JSON.stringify(loja.kdsConfig));

  if (!gravar && !desligar) {
    console.log("\nSó leitura. Para ligar: --gravar. Para desligar: --desligar.");
    return;
  }

  const pasta = path.join(os.homedir(), "firehub-backups");
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `kdsConfig-${loja.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ id: loja.id, kdsConfig: loja.kdsConfig }, null, 2));
  console.log(`Backup: ${arquivo}`);

  const valor = JSON.stringify({ finalizacaoSoComTudoPronto: !desligar });
  await prisma.$executeRaw`UPDATE "User" SET "kdsConfig" = COALESCE("kdsConfig", '{}'::jsonb) || ${valor}::jsonb WHERE id = ${loja.id}`;
  const depois = await prisma.user.findUnique({ where: { id: loja.id }, select: { kdsConfig: true } });
  console.log("kdsConfig agora:", JSON.stringify(depois?.kdsConfig));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
