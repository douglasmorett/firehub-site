/**
 * scripts/definir-chave-central-gemini.js
 *
 * Guarda a chave do Gemini uma única vez, na conta matriz do FireHub, para que
 * TODA loja passe a ser atendida pelo robô assim que o lojista conectar o QR —
 * inclusive as que forem cadastradas depois.
 *
 * Por que isto existe: a busca da chave em src/lib/chatbot-ai.ts tem três
 * níveis — chave da própria loja, variável de ambiente, e a chave desta conta
 * matriz. Enquanto os dois primeiros não existiam em produção, só atendia quem
 * tivesse chave configurada à mão: a Hakim Centro respondia e a Brasa Burguer
 * devolvia "instabilidade técnica" para qualquer mensagem.
 *
 * A chave é lida de GEMINI_API_KEY (.env ou ambiente) e gravada direto no
 * banco. Ela nunca é impressa na tela.
 *
 * Uso:
 *   node scripts/definir-chave-central-gemini.js              # simula
 *   node scripts/definir-chave-central-gemini.js --aplicar    # grava
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const EMAIL_MATRIZ = process.env.EMAIL_MATRIZ_FIREHUB || "admin@firehubfood.com.br";

async function main() {
  const chave = (process.env.GEMINI_API_KEY || "").trim();
  if (!chave) {
    console.error("GEMINI_API_KEY não está definida. Coloque no .env ou exporte antes de rodar.");
    process.exit(1);
  }

  console.log(APLICAR ? "=== APLICANDO ===" : "=== SIMULAÇÃO (use --aplicar para gravar) ===");
  console.log(`chave encontrada: sim (${chave.length} caracteres, não exibida)`);

  const matriz = await prisma.user.findUnique({
    where: { email: EMAIL_MATRIZ },
    select: { id: true, email: true, storeName: true, isFireHubSystem: true, chatbotConfig: true },
  });

  if (!matriz) {
    console.error(`Conta matriz não encontrada: ${EMAIL_MATRIZ}`);
    console.error("Defina EMAIL_MATRIZ_FIREHUB apontando para a conta certa.");
    process.exit(1);
  }

  const cfgAtual = matriz.chatbotConfig || {};
  console.log(`\nconta matriz: ${matriz.storeName} (${matriz.email})`);
  console.log(`  isFireHubSystem hoje: ${matriz.isFireHubSystem}`);
  console.log(`  já tinha chave: ${cfgAtual.geminiApiKey ? "SIM" : "NAO"}`);

  if (!APLICAR) {
    console.log("\nnada foi gravado. rode de novo com --aplicar.");
    return;
  }

  await prisma.user.update({
    where: { id: matriz.id },
    // O restante do chatbotConfig é preservado de propósito: esta conta pode ter
    // outras configurações, e sobrescrever o objeto inteiro apagaria todas.
    data: { isFireHubSystem: true, chatbotConfig: { ...cfgAtual, geminiApiKey: chave } },
  });

  const conferencia = await prisma.user.findUnique({
    where: { id: matriz.id },
    select: { isFireHubSystem: true, chatbotConfig: true },
  });
  const gravou = !!conferencia?.chatbotConfig?.geminiApiKey;
  console.log(`\ngravado: isFireHubSystem=${conferencia?.isFireHubSystem} chave=${gravou ? "SIM" : "NAO"}`);

  const lojas = await prisma.user.findMany({
    where: { role: "FRANCHISEE", NOT: { chatbotConfig: { equals: null } } },
    select: { storeName: true, chatbotConfig: true },
    orderBy: { storeName: "asc" },
  });
  console.log("\n=== DE ONDE CADA LOJA TIRA A CHAVE ===");
  for (const l of lojas) {
    const propria = !!l.chatbotConfig?.geminiApiKey;
    console.log(`  ${l.storeName}: ${propria ? "chave própria" : "herda da matriz"}`);
  }
}

main()
  .catch((e) => { console.error("ERRO:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
