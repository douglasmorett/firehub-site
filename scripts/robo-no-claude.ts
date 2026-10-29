/**
 * Liga (ou desliga) o robô no Claude Haiku 5.5 em uma ou mais lojas:
 * `chatbotConfig.modeloDoRobo = "claude-haiku-5-5"` (lib/robo-no-claude.ts).
 * Sem a chave da Anthropic (ANTHROPIC_API_KEY no servidor ou `anthropicApiKey` na conta matriz,
 * scripts/chave-do-claude-na-matriz.ts) a marca não faz nada: o robô segue no Gemini.
 *
 *   npx tsx scripts/robo-no-claude.ts <lojaId> [<lojaId> ...]               # só mostra
 *   npx tsx scripts/robo-no-claude.ts <lojaId> [<lojaId> ...] --ligar       # liga
 *   npx tsx scripts/robo-no-claude.ts <lojaId> [<lojaId> ...] --desligar    # volta ao Gemini
 *
 * Grava só a chave (o `||` do jsonb mantém o resto do chatbotConfig; desligar
 * apaga só ela) e guarda o chatbotConfig de antes em ~/firehub-backups/.
 * Vale na próxima mensagem do cliente, sem deploy.
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import os from "os";
import path from "path";

const MODELO_CLAUDE = "claude-haiku-5-5";
const lojas = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ligar = process.argv.includes("--ligar");
const desligar = process.argv.includes("--desligar");
if (!lojas.length || (ligar && desligar)) {
  console.error("Uso: npx tsx scripts/robo-no-claude.ts <lojaId> [<lojaId> ...] [--ligar | --desligar]");
  process.exit(2);
}

const prisma = new PrismaClient();

async function main() {
  const matriz = await prisma.user.findFirst({ where: { isFireHubSystem: true }, select: { chatbotConfig: true } });
  console.log(`Chave da Anthropic na conta matriz: ${(matriz?.chatbotConfig as any)?.anthropicApiKey ? "sim" : "NÃO (só vale se estiver no ambiente do servidor)"}`);
  for (const lojaId of lojas) {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, name: true, storeName: true, chatbotConfig: true } });
    if (!loja) {
      console.log(`\n${lojaId}: loja não encontrada`);
      continue;
    }
    const cfg = (loja.chatbotConfig as any) || {};
    console.log(`\n${loja.storeName || loja.name} (${loja.id}): robô ${cfg.modeloDoRobo === MODELO_CLAUDE ? "NO CLAUDE" : "no Gemini"}`);
    if (!ligar && !desligar) continue;

    const pasta = path.join(os.homedir(), "firehub-backups");
    fs.mkdirSync(pasta, { recursive: true });
    const arquivo = path.join(pasta, `chatbotConfig-${loja.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(arquivo, JSON.stringify({ id: loja.id, chatbotConfig: loja.chatbotConfig }, null, 2));
    console.log(`  backup: ${arquivo}`);

    if (ligar) {
      const valor = JSON.stringify({ modeloDoRobo: MODELO_CLAUDE });
      await prisma.$executeRaw`UPDATE "User" SET "chatbotConfig" = COALESCE("chatbotConfig", '{}'::jsonb) || ${valor}::jsonb WHERE id = ${loja.id}`;
    } else {
      await prisma.$executeRaw`UPDATE "User" SET "chatbotConfig" = "chatbotConfig" - 'modeloDoRobo' WHERE id = ${loja.id}`;
    }
    const depois = await prisma.user.findUnique({ where: { id: loja.id }, select: { chatbotConfig: true } });
    console.log(`  agora: robô ${(depois?.chatbotConfig as any)?.modeloDoRobo === MODELO_CLAUDE ? "NO CLAUDE" : "no Gemini"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
