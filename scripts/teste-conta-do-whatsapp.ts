/**
 * A conta do WhatsApp de um celular digitado com o nono dígito.
 *
 *   npx tsx scripts/teste-conta-do-whatsapp.ts
 *
 * Pizzaria Lapastine (DDD 91), 08/10/2026: os avisos de pedido do cardápio
 * digital iam para 5591998047356 e a conta do cliente é 559198047356.
 */
import { numerosAPerguntar, escolherConta, contaParaEnviar } from "../src/lib/conta-do-whatsapp";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const sem9 = { numero: "559198047356", info: { exists: true, jid: "559198047356@s.whatsapp.net", lid: "136884953079926@lid" } };
const naoExiste = { numero: "5591998047356", info: { exists: false, jid: "5591998047356@s.whatsapp.net" } };
const existeSemLid = { info: { exists: true, jid: "5591998047356@s.whatsapp.net" } };

(async () => {
  // ── quando perguntar ──
  confere("celular com 9 (Belém): as duas formas", numerosAPerguntar("5591998047356"), ["5591998047356", "559198047356"]);
  confere("já sem o 9: nada a perguntar", numerosAPerguntar("559198047356"), []);
  confere("fixo: nada a perguntar", numerosAPerguntar("552226431234"), []);
  confere("endereço @lid: nada a perguntar", numerosAPerguntar("136884953079926@lid"), []);
  confere("conversa do robô (@s.whatsapp.net com 9): nada a perguntar", numerosAPerguntar("5522998765432@s.whatsapp.net"), []);
  confere("estrangeiro: nada a perguntar", numerosAPerguntar("5491123456789"), []);

  // ── qual conta ──
  confere("com 9 não existe, sem 9 existe → sem 9", escolherConta([naoExiste, sem9]), "559198047356@s.whatsapp.net");
  confere("com 9 'existe' sem LID, sem 9 com LID → sem 9", escolherConta([existeSemLid, sem9]), "559198047356@s.whatsapp.net");
  const sp = { info: { exists: true, jid: "5511987654321@s.whatsapp.net", lid: "999@lid" } };
  confere("São Paulo: a conta com 9 é a certa", escolherConta([sp, { info: { exists: false } }]), "5511987654321@s.whatsapp.net");
  confere("nenhuma existe → null (manda como veio)", escolherConta([naoExiste, { info: null }]), null);
  confere("jid com aparelho (:12) vira a conta", escolherConta([{ info: { exists: true, jid: "559198047356:12@s.whatsapp.net" } }]), "559198047356@s.whatsapp.net");

  // ── o envio ──
  let perguntas = 0;
  const gateway = async (n: string) => { perguntas++; return n === "559198047356" ? sem9 : naoExiste; };
  confere("Lapastine: o aviso vai para a conta sem o 9", await contaParaEnviar("t1", "5591998047356", gateway), "559198047356@s.whatsapp.net");
  confere("segunda vez: lembrada, sem perguntar de novo", [await contaParaEnviar("t1", "5591998047356", gateway), perguntas], ["559198047356@s.whatsapp.net", 2]);
  const semRota = async () => { throw new Error("quem-e 404"); };
  confere("gateway sem a rota (Evolution oficial): manda como veio", await contaParaEnviar("t2", "5591998047356", semRota), "5591998047356");
  confere("número sem dúvida nem pergunta", await contaParaEnviar("t3", "559198047356", semRota), "559198047356");

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
})();
