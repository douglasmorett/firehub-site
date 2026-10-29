/**
 * Grava a chave da Anthropic na conta matriz (isFireHubSystem):
 * `chatbotConfig.anthropicApiKey`, lida pelo robô em lib/robo-no-claude.ts
 * (`chaveDoClaude`) quando o servidor não tem ANTHROPIC_API_KEY. É o mesmo
 * lugar da chave do Gemini (`geminiApiKey`), e o navegador não a vê
 * (lib/gateway-da-loja.ts).
 *
 *   npx tsx scripts/chave-do-claude-na-matriz.ts             # só mostra se existe
 *   npx tsx scripts/chave-do-claude-na-matriz.ts --gravar    # grava a ANTHROPIC_API_KEY deste ambiente
 *
 * A chave nunca é impressa (só os 4 últimos caracteres). Grava só esse campo
 * (o `||` do jsonb mantém o resto do chatbotConfig). O servidor lê a nova em até 5 min.
 */
import { PrismaClient } from "@prisma/client";

const gravar = process.argv.includes("--gravar");
const prisma = new PrismaClient();
const fim = (k: unknown) => (typeof k === "string" && k ? `…${k.slice(-4)}` : "nenhuma");

async function main() {
  const matriz = await prisma.user.findFirst({ where: { isFireHubSystem: true }, select: { id: true, chatbotConfig: true } });
  if (!matriz) throw new Error("conta matriz (isFireHubSystem) não encontrada");
  console.log(`Conta matriz ${matriz.id}: chave da Anthropic ${fim((matriz.chatbotConfig as any)?.anthropicApiKey)}`);
  if (!gravar) {
    console.log("Só leitura. Para gravar a ANTHROPIC_API_KEY deste ambiente: --gravar.");
    return;
  }
  const chave = process.env.ANTHROPIC_API_KEY || "";
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(chave)) throw new Error("ANTHROPIC_API_KEY ausente ou fora do formato sk-ant-…");
  const valor = JSON.stringify({ anthropicApiKey: chave });
  await prisma.$executeRaw`UPDATE "User" SET "chatbotConfig" = COALESCE("chatbotConfig", '{}'::jsonb) || ${valor}::jsonb WHERE id = ${matriz.id}`;
  const depois = await prisma.user.findUnique({ where: { id: matriz.id }, select: { chatbotConfig: true } });
  console.log(`Gravada: ${fim((depois?.chatbotConfig as any)?.anthropicApiKey)}`);
}

main()
  .catch((e) => {
    console.error(e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
