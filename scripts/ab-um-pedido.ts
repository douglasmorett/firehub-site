/** Laboratório: uma conversa de pedido, impressa fala a fala (mesmas variáveis FIREHUB_AB_* do ab-do-robo.ts). */
import path from "node:path";
import dotenv from "dotenv";

const pasta = process.env.ENV_DIR || process.cwd();
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });

async function main() {
  if (process.env.FIREHUB_AB_SEM_GRAVAR !== "1" || process.env.FIREHUB_AB_SEM_REGISTRO !== "1") throw new Error("sem FIREHUB_AB_SEM_*");
  const { prisma } = await import("../src/lib/prisma");
  const { processChatbotAI } = await import("../src/lib/chatbot-ai");
  const loja = await prisma.user.findFirst({ where: { storeName: process.argv[2] || "PIZZARIA 17" }, select: { id: true } });
  const falas = process.argv.slice(3);
  const h: any[] = [];
  const g: any = globalThis;
  g.__abBrutos ||= [];
  for (const fala of falas) {
    const r: any = await processChatbotAI(loja!.id, fala, h, "5599911112222@s.whatsapp.net", undefined, "Cliente Teste");
    console.log(`CLIENTE: ${fala}\nROBÔ: ${r?.reply}\nMARCAS: ${(String(g.__abBrutos.at(-1) || "").match(/\[\[[^\]]{0,80}/g) || []).join(" ")}\n`);
    h.push({ sender: "user", text: fala }, { sender: "bot", text: r?.reply });
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
