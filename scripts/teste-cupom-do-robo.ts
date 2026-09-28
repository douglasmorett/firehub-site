/**
 * Trava o cupom no robô do WhatsApp (lib/cupom-do-robo.ts).
 *
 *   npx tsx scripts/teste-cupom-do-robo.ts
 *
 * O caso é o da R&D Pizzaria em 28/09/2026. O Rafa: "quando o robô identificar
 * que o cliente nunca pediu naquele número, oferecer o cupom de primeiro
 * pedido" — e o robô tem que entender os cupons cadastrados quando o cliente
 * quer usar um. Os cupons abaixo são os da loja nesse dia.
 */
import { avaliarCupom } from "../src/lib/cupons";
import {
  codigoCompacto,
  cupomCitadoPeloCliente,
  cupomDesteClienteParaOPrompt,
  cuponsDoRobo,
  cuponsParaTentar,
  mensagemDoCupom,
} from "../src/lib/cupom-do-robo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const RD = [
  { code: "PRIMEIROPEDIDO", type: "percent", active: true, discount: 40, primeiroPedido: true, usosPorCliente: 1 },
  { code: "CLIENTE INATIVO A 7 DIAS", type: "percent", active: true, discount: 10, minOrderValue: 0 },
  { code: "CLIENTE SEM PEDIR A 15 DIAS", type: "percent", active: true, discount: 15, minOrderValue: 0 },
  { code: "CLIENTE SEM PEDIR A 30 DIAS", type: "percent", active: true, discount: 30, minOrderValue: 0 },
];
const CONFIG_RD = { instantCouponEnabled: true, instantCouponCode: "PRIMEIROPEDIDO", instantCouponDiscount: "40%" };
const HOJE = "2026-09-28";
const codigos = (l: { code: string }[]) => l.map((c) => c.code);

console.log("\n— O que o robô pode anunciar —");
const rd = cuponsDoRobo(RD, CONFIG_RD, HOJE);
confere("R&D: nenhum público (o instantâneo é o de primeiro pedido)", codigos(rd.publicos), []);
confere("R&D: o de primeiro pedido é o PRIMEIROPEDIDO", rd.primeiroPedido?.code, "PRIMEIROPEDIDO");
confere("Estratégicos nunca entram na lista", codigos(rd.publicos).some((c) => c.startsWith("CLIENTE")), false);

const HAKIM = [{ code: "HAKIM10", active: true, discount: 10 }];
const hk = cuponsDoRobo(HAKIM, { instantCouponEnabled: true, instantCouponCode: "HAKIM10", instantCouponDiscount: "10%" }, HOJE);
confere("Hakim: o instantâneo HAKIM10 continua público (como antes)", codigos(hk.publicos), ["HAKIM10"]);
confere("Hakim: sem cupom de primeiro pedido", hk.primeiroPedido, null);
confere("Instantâneo sem cadastro em Cupons: não se anuncia (o site recusaria)", codigos(cuponsDoRobo([], { instantCouponEnabled: true, instantCouponCode: "FANTASMA" }, HOJE).publicos), []);
confere("Instantâneo desligado: não entra", codigos(cuponsDoRobo(HAKIM, { instantCouponEnabled: false, instantCouponCode: "HAKIM10" }, HOJE).publicos), []);
confere("Primeiro pedido vencido: some", cuponsDoRobo([{ ...RD[0], validade: "2026-09-27" }], {}, HOJE).primeiroPedido, null);
confere("Público marcado na tela de cupons entra", codigos(cuponsDoRobo([{ code: "BEMVINDO", isPublic: true, discount: 5 }], {}, HOJE).publicos), ["BEMVINDO"]);

console.log("\n— O cupom que o cliente escreveu —");
const citado = (t: string[]) => cupomCitadoPeloCliente(t, RD)?.code ?? null;
confere("\"quero usar o PRIMEIROPEDIDO\"", citado(["quero usar o PRIMEIROPEDIDO"]), "PRIMEIROPEDIDO");
confere("\"tenho o cupom primeiro pedido\" (separado, minúsculo)", citado(["tenho o cupom primeiro pedido"]), "PRIMEIROPEDIDO");
confere("\"cliente inativo a 7 dias\" (o código da campanha de recuperação)", citado(["recebi o cupom cliente inativo a 7 dias"]), "CLIENTE INATIVO A 7 DIAS");
confere("\"CLIENTE SEM PEDIR A 30 DIAS!!\" com pontuação", citado(["CLIENTE SEM PEDIR A 30 DIAS!!"]), "CLIENTE SEM PEDIR A 30 DIAS");
confere("Conversa sem código: nada", citado(["oi, quero uma pizza grande", "é o meu primeiro pedido aí"]), null);
confere("\"primeiro pedido\" sem falar de cupom é conversa, não o código", citado(["meu primeiro pedido foi ótimo"]), null);
confere("\"tem desconto de primeiro pedido?\" fala de desconto: é o cupom", citado(["tem desconto de primeiro pedido?"]), "PRIMEIROPEDIDO");
confere("Dentro de palavra não casa (\"pizzard10\" não é RD10)", cupomCitadoPeloCliente(["manda uma pizzard10"], [{ code: "RD10" }])?.code ?? null, null);
confere("Palavra inteira casa (\"cupom rd10\")", cupomCitadoPeloCliente(["cupom rd10 por favor"], [{ code: "RD10" }])?.code ?? null, "RD10");
confere("Código curto (\"10\") não se procura", cupomCitadoPeloCliente(["quero 10 esfihas"], [{ code: "10" }]), null);
confere("Cupom desativado não casa", cupomCitadoPeloCliente(["HAKIM10"], [{ code: "HAKIM10", active: false }]), null);
confere(
  "Dois códigos na conversa: vale o da mensagem mais nova",
  citado(["tenho o cliente inativo a 7 dias", "ah não, usa o cliente sem pedir a 15 dias"]),
  "CLIENTE SEM PEDIR A 15 DIAS"
);
confere("codigoCompacto junta e tira acento", codigoCompacto("Promoção  Verão!"), "PROMOCAOVERAO");

console.log("\n— Qual cupom o pedido tenta —");
const tenta = (daTag: unknown, textos: string[]) =>
  codigos(cuponsParaTentar({ cupons: RD, daTag, citado: cupomCitadoPeloCliente(textos, RD), doRobo: rd }));
confere("Cliente novo sem código: o de primeiro pedido, sozinho", tenta(null, ["quero uma pizza"]), ["PRIMEIROPEDIDO"]);
confere("Tag com o de primeiro pedido: ele (uma vez só)", tenta("PRIMEIROPEDIDO", []), ["PRIMEIROPEDIDO"]);
confere(
  "Tag com estratégico que o cliente NÃO escreveu: ignorado (o modelo não dá cupom sigiloso)",
  tenta("CLIENTE SEM PEDIR A 30 DIAS", ["quero uma pizza"]),
  ["PRIMEIROPEDIDO"]
);
confere(
  "Cliente escreveu o estratégico: vem primeiro, mesmo sem a tag",
  tenta(null, ["tenho o cupom cliente inativo a 7 dias"]),
  ["CLIENTE INATIVO A 7 DIAS", "PRIMEIROPEDIDO"]
);
confere("Tag com código que não existe: ignorado", tenta("DESCONTAO", []), ["PRIMEIROPEDIDO"]);

console.log("\n— A régua é a do checkout (avaliarCupom) —");
const fatos = (jaPediu: boolean | null, usos: number | null = 0) => ({ subtotal: 100, taxa: 8, hojeDaLoja: HOJE, usosDoCliente: usos, jaPediuPeloSite: jaPediu });
confere("PRIMEIROPEDIDO para quem nunca pediu: 40 reais em 100 de itens", avaliarCupom(rd.primeiroPedido, fatos(false)).desconto, 40);
confere("PRIMEIROPEDIDO para quem já pediu: recusa", avaliarCupom(rd.primeiroPedido, fatos(true)).ok, false);
confere("PRIMEIROPEDIDO já usado 1 vez: recusa", avaliarCupom(rd.primeiroPedido, fatos(false, 1)).ok, false);

console.log("\n— O que vai para o prompt —");
const prompt = (clienteNovo: boolean | null, textos: string[] = [], recusa: string | null = null) =>
  cupomDesteClienteParaOPrompt({ doRobo: rd, clienteNovo, citado: cupomCitadoPeloCliente(textos, RD), recusaDoCitado: recusa });
confere("Cliente novo: oferece o PRIMEIROPEDIDO", /NUNCA PEDIU[\s\S]*PRIMEIROPEDIDO \(40% de desconto\)[\s\S]*próxima resposta/.test(prompt(true)), true);
confere("Cliente antigo: proíbe oferecer", /JÁ PEDIU[\s\S]*NÃO vale para ele/.test(prompt(false)), true);
confere("Telefone desconhecido e nada citado: seção vazia", prompt(null), "");
confere("Citou e vale: aplica com couponCode", /citou o cupom CLIENTE INATIVO A 7 DIAS[\s\S]*"couponCode": "CLIENTE INATIVO A 7 DIAS"/.test(prompt(false, ["cupom cliente inativo a 7 dias"])), true);
confere(
  "Citou e não vale: o motivo, sem aplicar",
  /NÃO vale para ele agora: Este cupom venceu/.test(prompt(false, ["PRIMEIROPEDIDO"], "Este cupom venceu em 27/09.")),
  true
);

console.log("\n— A linha que o sistema acrescenta —");
const cupom40 = { code: "PRIMEIROPEDIDO", desconto: 40, freteGratis: false };
confere("Modelo acertou o total: nada a acrescentar", mensagemDoCupom({ total: 68, cupom: cupom40, totalDitoPelaIa: 68 }, "Total: R$ 68,00", true), "");
confere(
  "Modelo esqueceu o desconto na confirmação: a linha com o total certo",
  mensagemDoCupom({ total: 68, cupom: cupom40, totalDitoPelaIa: 108 }, "Pedido confirmado!", true),
  "\n\n🎟️ Cupom PRIMEIROPEDIDO aplicado (-R$ 40,00): o total fica R$ 68,00."
);
confere("Rascunho sem falar de total: nada (não repete a cada item)", mensagemDoCupom({ total: 68, cupom: cupom40, totalDitoPelaIa: 108 }, "Anotado! Mais alguma coisa?", false), "");
confere("Rascunho com o resumo e o total errado: a linha", mensagemDoCupom({ total: 68, cupom: cupom40, totalDitoPelaIa: 108 }, "Total: R$ 108,00. Confirma?", false).includes("R$ 68,00"), true);
confere("Recusa do cupom pedido, na confirmação", mensagemDoCupom({ total: 108, cupomRecusado: "Válido para pedidos a partir de R$ 50,00." }, "Pedido confirmado!", true), "\n\nℹ️ Válido para pedidos a partir de R$ 50,00.");
confere("Frete grátis por cupom", mensagemDoCupom({ total: 60, cupom: { code: "ENTREGA0", desconto: 8, freteGratis: true }, totalDitoPelaIa: 68 }, "ok", true), "\n\n🎟️ Cupom ENTREGA0: entrega grátis, e o total fica R$ 60,00.");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
