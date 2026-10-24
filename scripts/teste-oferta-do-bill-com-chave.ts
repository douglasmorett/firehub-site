/**
 * O "sim" do dono à oferta do Bill pelo WhatsApp (lib/assessor/oferta-no-whatsapp.ts)
 * só liga o serviço pago com a chave do gateway: sem ela, o remetente pode ser
 * forjado (webhook de instância que ainda não mandou a chave). Banco falso em memória.
 * Roda sem banco: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-oferta-do-bill-com-chave.ts
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { respostaAoDonoSemBill, TEXTO_SEM_CHAVE } from "../src/lib/assessor/oferta-no-whatsapp";

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

// Loja que paga (não isenta), sem assinatura do Bill ainda.
let assinatura: any = null;
let gravacoes = 0;
const falso: any = {
  user: { findUnique: async () => ({ id: "loja", email: "loja@teste.com", planPercent: 5, isFranqueadoHakim: false, storeName: "Pizzaria Teste", storeTimezone: "America/Sao_Paulo" }) },
  assessorAssinatura: {
    findUnique: async () => assinatura,
    upsert: async ({ create }: any) => { gravacoes++; assinatura = { ...create }; return assinatura; },
    update: async ({ data }: any) => { gravacoes++; assinatura = { ...assinatura, ...data }; return assinatura; },
  },
};
for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });
// Sem postgres na URL, a garantia das tabelas do Bill não vai ao banco (estrutura-no-banco.ts).
process.env.DATABASE_URL = "teste-sem-banco";

async function main() {
  const agora = new Date("2026-10-24T15:00:00Z");
  const dono = { franchiseeId: "loja", telefone: "5511999990000", agora };

  let r = await respostaAoDonoSemBill({ ...dono, texto: "oi", comChaveDoGateway: false });
  confere("mensagem do dono sem o Bill: recebe a oferta (igual a antes)", r.acao === "oferta", r.acao);

  r = await respostaAoDonoSemBill({ ...dono, texto: "sim", comChaveDoGateway: false });
  confere("\"sim\" SEM a chave do gateway: não liga", r.acao === "sem-chave" && r.resposta === TEXTO_SEM_CHAVE, r);
  confere("...e nada foi gravado na assinatura", gravacoes === 0 && assinatura === null, { gravacoes, assinatura });

  r = await respostaAoDonoSemBill({ ...dono, texto: "e aí?", comChaveDoGateway: false });
  confere("a oferta segue valendo (lembrete, como antes)", r.acao === "lembrete", r.acao);

  r = await respostaAoDonoSemBill({ ...dono, texto: "sim", comChaveDoGateway: true });
  confere("\"sim\" COM a chave do gateway: liga", r.acao === "ativou", r);
  confere("...gravou a assinatura ligada, com o aceite do termo pelo WhatsApp",
    gravacoes === 1 && assinatura?.ativo === true && /WhatsApp \+5511999990000/.test(assinatura?.periodos?.[0]?.aceite?.userAgent || ""), assinatura);

  // Sem chave, "não" continua recusando normalmente (não é cobrança).
  const outro = { franchiseeId: "loja", telefone: "5511888880000", agora };
  await respostaAoDonoSemBill({ ...outro, texto: "oi", comChaveDoGateway: false });
  r = await respostaAoDonoSemBill({ ...outro, texto: "não", comChaveDoGateway: false });
  confere("\"não\" sem a chave: recusa como antes", r.acao === "recusou", r.acao);

  // O webhook passa a chave do evento (chaveDoGateway) até a oferta.
  const rota = readFileSync("src/app/api/webhook/whatsapp/route.ts", "utf8");
  confere("o webhook entrega a chave ao handleIncomingMessage", /await handleIncomingMessage\(body, instance, chave\)/.test(rota));
  confere("e a oferta só liga com chave === \"ok\"", /respostaAoDonoSemBill\(\{[^}]*comChaveDoGateway: chave === "ok"/.test(rota));
}

main()
  .then(() => { console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo."); process.exit(falhas ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
