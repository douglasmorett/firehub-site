/**
 * Prova da regra "pedido do JotaJá só entra na loja dona da credencial"
 * (lib/jotaja-loja.ts). Pura, sem banco nem rede.
 *
 *   npx tsx scripts/teste-jotaja-por-loja.ts
 *
 * O caso real é a DUGA BURGUER (16/10/2026): restaurante 19869 no JotaJá, com
 * 313 pedidos da semana parados na fila quando a credencial chegou. O Hakim era
 * o restaurante 22238. Os eventos abaixo têm o formato que a fila devolveu.
 */
import {
  conferirFilaNaLigacao,
  decidirLojaDoPedido,
  idDoEspelhoJotaja,
  idDoItemJotaja,
  merchantDoEvento,
  pedidoAntigoDemais,
} from "../src/lib/jotaja-loja";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const eventoDuga = {
  createdAt: "2026-10-17T00:10:15.826Z",
  eventId: "18b4a2bf-58e0-479c-84b2-fa6007e6593c",
  sourceAppId: "",
  orderId: "d5139500-14a0-4093-bc40-be9e2fc7091f",
  storeId: "19869",
  eventType: "CREATED",
};
const eventoHakim = { ...eventoDuga, eventId: "x", orderId: "y", storeId: "22238" };
const pedidoDuga = { id: "d5139500", merchant: { id: "19869", name: "DUGA BURGUER" }, createdAt: "2026-10-17T00:10:14.217Z", orderTiming: "INSTANT" };

// ── De que restaurante é o evento ────────────────────────────────────────────
confere("evento da fila: restaurante pelo storeId", merchantDoEvento(eventoDuga), "19869");
confere("pedido: restaurante pelo merchant.id", merchantDoEvento(pedidoDuga), "19869");
confere("número vira texto", merchantDoEvento({ merchant: { id: 19869 } }), "19869");
confere("sem restaurante: null", merchantDoEvento({ orderId: "a" }), null);

// ── O pedido entra nesta loja? ───────────────────────────────────────────────
confere("Duga (19869) recebe pedido da Duga",
  decidirLojaDoPedido({ merchantDaLoja: "19869", merchantDoPedido: "19869", outraLojaComEsseMerchant: null }),
  { entra: true, adotarMerchant: null });
confere("Duga NÃO recebe pedido do Hakim (22238)",
  decidirLojaDoPedido({ merchantDaLoja: "19869", merchantDoPedido: "22238", outraLojaComEsseMerchant: null }).entra, false);
confere("Hakim NÃO recebe pedido da Duga",
  decidirLojaDoPedido({ merchantDaLoja: "22238", merchantDoPedido: "19869", outraLojaComEsseMerchant: null }).entra, false);
confere("loja sem o número: a credencial é dela, grava o número no 1º pedido",
  decidirLojaDoPedido({ merchantDaLoja: null, merchantDoPedido: "19869", outraLojaComEsseMerchant: null }),
  { entra: true, adotarMerchant: "19869" });
confere("loja sem o número, mas o restaurante já é de OUTRA loja: não entra",
  decidirLojaDoPedido({ merchantDaLoja: "", merchantDoPedido: "19869", outraLojaComEsseMerchant: "DUGABURGUER" }).entra, false);
confere("pedido sem restaurante, na credencial da loja: entra (sem gravar nada)",
  decidirLojaDoPedido({ merchantDaLoja: "19869", merchantDoPedido: null, outraLojaComEsseMerchant: null }),
  { entra: true, adotarMerchant: null });

// ── Na hora de ligar ─────────────────────────────────────────────────────────
const filaDaDuga = Array.from({ length: 313 }, (_, i) => ({ ...eventoDuga, eventId: `e${i}` }));
confere("fila só da Duga: liga como 19869", conferirFilaNaLigacao(filaDaDuga, null), { merchant: "19869", erro: null });
confere("fila só da Duga, número informado igual: liga", conferirFilaNaLigacao(filaDaDuga, "19869"), { merchant: "19869", erro: null });
confere("fila da Duga com o número do Hakim informado: NÃO liga",
  conferirFilaNaLigacao(filaDaDuga, "22238").erro !== null, true);
confere("fila com dois restaurantes (credencial de parceiro): NÃO liga",
  conferirFilaNaLigacao([...filaDaDuga, eventoHakim], null).erro !== null, true);
confere("fila vazia: fica o número informado", conferirFilaNaLigacao([], "19869"), { merchant: "19869", erro: null });
confere("fila vazia e nada informado: sem número (grava no 1º pedido)", conferirFilaNaLigacao([], ""), { merchant: null, erro: null });

// ── Pedido velho demais não entra sozinho ───────────────────────────────────
const agora = new Date("2026-10-17T00:15:00Z");
confere("pedido de 5 min atrás entra", pedidoAntigoDemais(pedidoDuga, agora), false);
confere("pedido de 11 h atrás entra", pedidoAntigoDemais({ createdAt: "2026-10-16T13:15:00Z" }, agora), false);
confere("pedido de 10/10 (fila parada) não entra", pedidoAntigoDemais({ createdAt: "2026-10-10T00:16:47Z" }, agora), true);
confere("agendado ontem para hoje à noite: entra (conta a hora marcada)",
  pedidoAntigoDemais({ createdAt: "2026-10-15T20:00:00Z", orderTiming: "SCHEDULED", schedule: { scheduledDatetimeStart: "2026-10-16T23:30:00Z", scheduledDatetimeEnd: "2026-10-17T00:00:00Z" } }, agora), false);
confere("sem data: entra (não descarta no escuro)", pedidoAntigoDemais({}, agora), false);

// ── Produto-espelho é da loja ────────────────────────────────────────────────
confere("item com id do catálogo (Méqui Nelson)", idDoItemJotaja({ id: "930040", externalCode: "", name: "Méqui Nelson" }), "930040");
confere("item sem id: pelo nome, sem acento", idDoItemJotaja({ name: "Pão de Açúcar Duplo" }), "nome-pao-de-acucar-duplo");
confere("id livre: o de sempre", idDoEspelhoJotaja("930040", "duga", null), "jotaja-930040");
confere("id já desta loja: o de sempre", idDoEspelhoJotaja("930040", "duga", "duga"), "jotaja-930040");
confere("id de OUTRA loja: ganha o seu", idDoEspelhoJotaja("nome-x-tudo", "duga", "hakim"), "jotaja-duga-nome-x-tudo");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
