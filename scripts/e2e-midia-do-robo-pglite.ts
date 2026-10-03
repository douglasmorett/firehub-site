/**
 * E2E da mídia no número do FireHub: webhook → grava → lê a imagem em segundo
 * plano → regrava com a descrição → o robô espera, VÊ a imagem e responde.
 * Só contra o PGlite local (crm-teste; ver a memória teste-local-com-pglite):
 *
 *   cd C:\Users\Micro\crm-teste && npx pglite-server --db=./dados-midia --port=5441 --max-connections=10
 *   DATABASE_URL=<o PGlite: usuário/senha padrão dele, 127.0.0.1:5441/postgres?sslmode=disable&connection_limit=1&pgbouncer=true> npx prisma db push --skip-generate
 *   GEMINI_API_KEY=... DATABASE_URL=<o mesmo> EVOLUTION_API_URL=http://127.0.0.1:9 NEXTAUTH_SECRET=teste npx tsx scripts/e2e-midia-do-robo-pglite.ts
 *   (o pgbouncer=true é obrigatório no PGlite: sem ele o Prisma dá "prepared statement already exists")
 *
 * Recusa rodar com outro banco ou com gateway de verdade: sem EVOLUTION_API_URL
 * o código cai no gateway de PRODUÇÃO e a resposta sairia no WhatsApp.
 */
import fs from "node:fs";
import path from "node:path";

if (!/127\.0\.0\.1:5441/.test(process.env.DATABASE_URL || "")) throw new Error("DATABASE_URL não é o PGlite local");
if (!/127\.0\.0\.1:9\b/.test(process.env.EVOLUTION_API_URL || "")) throw new Error("EVOLUTION_API_URL tem de ser a porta morta");

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const foto = (nome: string) => fs.readFileSync(path.join(__dirname, "fixtures", "ensaio-robo", nome)).toString("base64");

(async () => {
  const { prisma } = await import("../src/lib/prisma");
  const { salvarConfigDoAtendimento } = await import("../src/lib/atendimento/config");
  const { receberEventoDoAtendimento } = await import("../src/lib/atendimento/entrada");
  await salvarConfigDoAtendimento({
    roboLigado: true,
    conexao: { conectado: true, telefone: "5522981118514", desde: new Date().toISOString(), desconectadoDesde: null, jaConectou: true },
  } as any);

  let n = 0;
  const evento = (numero: string, message: any) =>
    receberEventoDoAtendimento("messages.upsert", {
      event: "messages.upsert",
      instance: "firehub_atendimento",
      data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: `E2E${Date.now()}${n++}` }, pushName: "Teste", message },
    });

  async function respostaDoRobo(numero: string, depoisDe: Date, prazo = 150_000) {
    const ate = Date.now() + prazo;
    while (Date.now() < ate) {
      const c = await prisma.crmContato.findFirst({ where: { telefone: { endsWith: numero.slice(-8) } } });
      if (c) {
        const r = await prisma.crmMensagem.findFirst({ where: { contatoId: c.id, autor: "ROBO", criadoEm: { gt: depoisDe } }, orderBy: { criadoEm: "desc" } });
        if (r) return { contato: c, resposta: r.texto };
      }
      await esperar(1500);
    }
    return null;
  }

  async function turno(numero: string, rotulo: string, message: any) {
    const t0 = new Date();
    const inicio = Date.now();
    await evento(numero, message);
    const webhook = Date.now() - inicio;
    const r = await respostaDoRobo(numero, t0);
    const entrada = r
      ? await prisma.crmMensagem.findFirst({ where: { contatoId: r.contato.id, direcao: "ENTRADA" }, orderBy: { criadoEm: "desc" } })
      : null;
    console.log(`\n── ${rotulo} (webhook respondeu em ${(webhook / 1000).toFixed(1)} s)`);
    console.log(`   💬 gravado: ${String(entrada?.texto || "").slice(0, 700).replace(/\n/g, "\n      ")}`);
    console.log(`   🤖 ${r ? r.resposta.replace(/\n/g, "\n      ") : "(sem resposta)"}`);
    const ev = r ? await prisma.crmEvento.findMany({ where: { contatoId: r.contato.id, criadoEm: { gt: t0 } }, select: { texto: true } }) : [];
    for (const e of ev) console.log(`   ⚙ ${e.texto.slice(0, 200)}`);
    return { webhook, entrada: entrada?.texto || "", resposta: r?.resposta || "" };
  }

  // A) Interessado manda a foto do cardápio.
  const A = "5522988880001";
  await turno(A, "A1 interessado: texto", { conversation: "Oi, quero testar o FireHub. Tenho uma pizzaria" });
  const a2 = await turno(A, "A2 interessado: foto do cardápio", {
    imageMessage: { mimetype: "image/jpeg", caption: "esse é meu cardápio", fileLength: { low: 63321, high: 0 } },
    base64: foto("foto-cardapio.jpg"),
  });

  // B) Lojista (sem loja reconhecida) manda o print da promoção errada.
  const B = "5522988880002";
  await turno(B, "B1 lojista: texto", { conversation: "já uso o FireHub. quero a pizza Grande de filé mignon por 65 na promoção, como faço?" });
  const b2 = await turno(B, "B2 lojista: print", {
    imageMessage: { mimetype: "image/jpeg", caption: "Assim?", fileLength: 70758 },
    base64: foto("print-promo-grande.jpg"),
  });

  const ok = (oQue: string, cond: boolean) => console.log(`${cond ? "✅" : "❌"} ${oQue}`);
  console.log("\n── Conferência");
  ok("webhook da foto respondeu em menos de 3 s (a leitura é depois)", a2.webhook < 3000 && b2.webhook < 3000);
  ok("a foto do cardápio foi descrita e regravada", /\[O que a imagem mostra:/.test(a2.entrada) && /calabresa/i.test(a2.entrada));
  ok("o robô respondeu sobre o cardápio (montagem/conta)", /(card[aá]pio|loja|conta|nome|e-?mail|CPF)/i.test(a2.resposta) && !/n[aã]o chegou/i.test(a2.resposta));
  ok("o print foi descrito com os campos", /\[O que a imagem mostra:/.test(b2.entrada) && /65/.test(b2.entrada) && /50/.test(b2.entrada));
  ok("o robô leu o print (35 ou explica o Promo menor que o +R$)", /(\b35\b|menor)/i.test(b2.resposta) && !/n[aã]o chegou/i.test(b2.resposta));
  await prisma.$disconnect();
  process.exit(0);
})();
