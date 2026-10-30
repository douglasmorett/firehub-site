/**
 * scripts/teste-balao-guardado.ts — o balãozinho (GET /api/chatbot/human-support)
 * com o lib/prisma.ts de verdade num Postgres descartável: a lista fica
 * guardada enquanto ninguém grava na fila da loja; entrar na fila, marcar como
 * lida, responder e encerrar aparecem na consulta SEGUINTE.
 *
 *   DATABASE_URL="postgresql://postgres@127.0.0.1:55501/postgres?pgbouncer=true&connection_limit=1" NEXTAUTH_SECRET=x npx tsx scripts/teste-balao-guardado.ts
 * Recusa qualquer banco que não seja local.
 */
import Module from "module";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Só roda em banco local descartável.");
  process.exit(2);
}

const sufixo = Date.now().toString(36);
const LOJA = `loja_balao_${sufixo}`;
const EMAIL = `${LOJA}@teste.invalid`;
const carregar = (Module as any)._load;
(Module as any)._load = function (req: string, parent: any, isMain: boolean) {
  const real = carregar.apply(this, [req, parent, isMain]);
  if (req === "next-auth/next" || req === "next-auth") {
    return new Proxy(real, { get: (t, k) => (k === "getServerSession" ? async () => ({ user: { email: EMAIL } }) : (t as any)[k]) });
  }
  return real;
};

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string, detalhe?: unknown) => {
  c ? ok++ : falhas++;
  console.log(c ? "  ✓" : "  ✗", m, c || detalhe === undefined ? "" : JSON.stringify(detalhe));
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const F = await import("../src/lib/fila-de-atendimento-humano");
  const { GET } = await import("../src/app/api/chatbot/human-support/route");
  const { NextRequest } = await import("next/server");

  await prisma.user.create({ data: { id: LOJA, email: EMAIL, name: "Loja", password: "x", storeName: "Loja Balão", role: "FRANCHISEE" } as any });
  const balao = async () => {
    const res = await GET(new NextRequest(`https://firehubfood.com.br/api/chatbot/human-support?t=${Date.now()}`));
    const corpo = (await res.json()) as any;
    return { status: res.status, chats: (corpo.chats || []) as any[], naoLidas: corpo.totalUnread };
  };
  const base = { userId: LOJA, telefone: "5522999990000", nomeDoCliente: "Ana", motivoDaIaForaDoAr: "IA fora do ar" };
  const msg = (t: string) => [{ sender: "user" as const, text: t, timestamp: Date.now() }];

  const a = await balao();
  confere(a.status === 200 && a.chats.length === 0, "começa vazio", a);

  await F.entrarNaFila({ ...base, jid: "5522999990000@s.whatsapp.net", textoDoCliente: "quero atendente", mensagens: msg("quero atendente"), motivo: "Pediu atendente" });
  const b = await balao();
  confere(b.chats.length === 1 && b.chats[0].status === "PENDING" && b.naoLidas === 1, "entrou na fila: aparece na consulta seguinte", b);

  // Gravação POR FORA da fila (sem a marca): a lista guardada continua valendo
  // — é a prova de que o balão não foi ao banco.
  await prisma.$executeRawUnsafe(`UPDATE "AtendimentoHumano" SET "nomeDoCliente" = 'Por fora' WHERE "userId" = $1`, LOJA);
  const c = await balao();
  confere(c.chats[0]?.clientName === "Ana", "sem gravação pela fila: resposta guardada (não leu o banco)", c.chats[0]?.clientName);

  await F.acrescentarDoCliente(LOJA, "5522999990000@s.whatsapp.net", "alô?");
  const d = await balao();
  confere(d.naoLidas === 2 && d.chats[0]?.clientName === "Por fora", "cliente escreveu de novo: não lidas sobem na consulta seguinte", d);

  await F.marcarLido(LOJA, "5522999990000@s.whatsapp.net");
  const e = await balao();
  confere(e.chats[0]?.status === "ACTIVE" && e.naoLidas === 0, "marcou como lida: ACTIVE e zero não lidas na seguinte", e);

  await F.encerrarChamado(LOJA, "5522999990000@s.whatsapp.net");
  const f = await balao();
  confere(f.chats.length === 0, "encerrou: some na consulta seguinte", f);

  const outra = `${LOJA}_outra`;
  await F.entrarNaFila({ ...base, userId: outra, jid: "5522988880000@s.whatsapp.net", textoDoCliente: "oi", mensagens: msg("oi") });
  const g = await balao();
  confere(g.chats.length === 0, "fila de OUTRA loja não aparece aqui", g);

  await prisma.$executeRawUnsafe(`DELETE FROM "AtendimentoHumano" WHERE "userId" IN ($1, $2)`, LOJA, outra);
  await prisma.user.deleteMany({ where: { id: LOJA } });
  await prisma.$disconnect();
  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
