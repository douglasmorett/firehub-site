/**
 * Prova da regra do acréscimo de itens em pedido que está na cozinha.
 *
 *   node scripts/teste-acrescimo-do-pedido.mjs
 *
 * O caso de partida é o da Hakim Centro em 12/09/2026: a Gabi com o #48 do
 * site em preparo querendo mais coisa pelo WhatsApp.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/acrescimo-do-pedido.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  podeAcrescentar, subtotalDoAcrescimo, listaDosItens, reais,
  mensagemAcrescimoAceito, mensagemAcrescimoRecusado, mensagemAcrescimoExpirado, pedidoJaPago,
  blocoDoPromptDeAcrescimo, prometeuCozinha,
} = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};
const igual = (nome, obtido, esperado) => conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), `obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);

console.log("\n1) Quem pode pedir acréscimo");
igual("#48 da Gabi: site, em preparo", podeAcrescentar({ status: "PREPARANDO", canal: "SITE" }), { pode: true });
igual("pedido do robô aceito", podeAcrescentar({ status: "ACEITO", canal: "WHATSAPP_IA" }), { pode: true });
igual("pedido do site ainda novo", podeAcrescentar({ status: "NOVO", canal: "SITE" }), { pode: true });
igual("pronto na cozinha mas ainda na loja (a loja decide)", podeAcrescentar({ status: "PRONTO", canal: "SITE" }), { pode: true });
igual("status em minúsculas", podeAcrescentar({ status: "preparando", canal: "SITE" }), { pode: true });
for (const canal of ["IFOOD", "99FOOD", "JOTAJA", "BRENDI", "WABIZ"]) {
  igual(`${canal} em preparo: não (é do app)`, podeAcrescentar({ status: "PREPARANDO", canal }), { pode: false, motivo: "CANAL" });
}
for (const canal of ["PDV", "TOTEM", "MESA", "DESCONHECIDO"]) {
  igual(`${canal}: não`, podeAcrescentar({ status: "PREPARANDO", canal }), { pode: false, motivo: "CANAL" });
}
for (const status of ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "ENCERRADO", "CANCELADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO", "", null]) {
  igual(`status ${JSON.stringify(status)}: não`, podeAcrescentar({ status, canal: "SITE" }), { pode: false, motivo: "STATUS" });
}
igual("status manda antes do canal (iFood que já saiu)", podeAcrescentar({ status: "SAIU_ENTREGA", canal: "IFOOD" }), { pode: false, motivo: "STATUS" });

console.log("\n2) Contas");
const itens = [
  { name: "Coca-Cola 2L", quantity: 1, price: 12 },
  { name: "Pastel de Carne", quantity: 2, price: 8.95 },
];
igual("subtotal soma preço x quantidade", subtotalDoAcrescimo(itens), 29.9);
igual("sem ruído de ponto flutuante", subtotalDoAcrescimo([{ name: "a", quantity: 3, price: 0.1 }]), 0.3);
igual("lista vazia é zero", subtotalDoAcrescimo([]), 0);
igual("reais no formato do Brasil", reais(29.9), "29,90");
igual("lista dos itens", listaDosItens(itens), "1x Coca-Cola 2L (R$ 12,00), 2x Pastel de Carne (R$ 17,90)");

console.log("\n3) O que a cliente recebe no WhatsApp");
const aceito = mensagemAcrescimoAceito({ numero: 48, itens, novoTotal: 162.49 });
conferir("aceito cita o número do pedido", aceito.includes("#48"), aceito);
conferir("aceito lista os itens", aceito.includes("1x Coca-Cola 2L (R$ 12,00)"), aceito);
conferir("aceito dá o novo total", aceito.includes("Novo total do pedido: R$ 162,49"), aceito);
conferir("aceito sem pagamento online não fala de diferença", !aceito.includes("diferença"), aceito);
const aceitoPago = mensagemAcrescimoAceito({ numero: 48, itens, novoTotal: 162.49, cobrarDiferencaNaEntrega: true });
conferir("pedido já pago: avisa que a diferença é na entrega", aceitoPago.includes("A diferença de R$ 29,90 é paga na entrega"), aceitoPago);
const recusado = mensagemAcrescimoRecusado({ numero: 48, motivo: "o pedido já está saindo" });
conferir("recusado traz o motivo da loja", recusado.includes("#48: o pedido já está saindo"), recusado);
conferir("recusado oferece pedido novo", recusado.includes("pedido novo"), recusado);
const semMotivo = mensagemAcrescimoRecusado({ numero: 48, motivo: "  " });
conferir("recusado sem motivo termina a frase com ponto", semMotivo.includes("pedido #48."), semMotivo);
const expirado = mensagemAcrescimoExpirado({ numero: 48 });
conferir("expirado explica que já saiu", expirado.includes("#48 já saiu da cozinha"), expirado);
const semNumero = mensagemAcrescimoRecusado({ numero: null, motivo: "" });
conferir("sem número não deixa espaço duplo", !/  /.test(semNumero), JSON.stringify(semNumero));

console.log("\n4) Pedido já pago");
conferir("pagamento confirmado (paymentPaidAt)", pedidoJaPago({ paymentMethod: "Pix", paymentPaidAt: "2026-09-12T23:00:00Z" }));
conferir("pagarmeStatus paid", pedidoJaPago({ paymentMethod: "Cartão", pagarmeStatus: "paid" }));
conferir("pagarmeStatus pending não é pago", !pedidoJaPago({ paymentMethod: "Cartão", pagarmeStatus: "pending" }));
conferir("\"Pix (Pago Online)\"", pedidoJaPago({ paymentMethod: "Pix (Pago Online)" }));
conferir("\"iFood App (Pago Online)\"", pedidoJaPago({ paymentMethod: "iFood App (Pago Online)" }));
conferir("\"Crédito (Cobrar na Entrega)\" não é pago", !pedidoJaPago({ paymentMethod: "Crédito (Cobrar na Entrega)" }));
conferir("\"Cartão de Débito\" não é pago", !pedidoJaPago({ paymentMethod: "Cartão de Débito" }));
conferir("\"Dinheiro\" não é pago", !pedidoJaPago({ paymentMethod: "Dinheiro" }));

console.log("\n5) O que o robô lê na regra 28");
const nosso = blocoDoPromptDeAcrescimo({ numero: 48, canalNome: "Online", statusLegivel: "Em Preparação na Cozinha 🔥", aceitaAcrescimo: true });
const exemplo = (nosso.match(/\[\[ACRESCIMO_PEDIDO: (\{.*\})\]\]/) || [])[1];
let exemploOk = null;
try { exemploOk = JSON.parse(exemplo); } catch {}
conferir("pedido nosso: o exemplo do marcador é JSON válido com o número", exemploOk?.pedido === 48 && Array.isArray(exemploOk?.items), exemplo);
conferir("pedido nosso: manda conferir com a cozinha", nosso.includes("CONFERIR COM A COZINHA"));
conferir("pedido nosso: proíbe dizer que já incluiu", nosso.includes("PROIBIDO dizer que o item JÁ FOI incluído"));
conferir("pedido nosso: nunca PEDIDO_IA para acréscimo", nosso.includes("NUNCA use PEDIDO_IA"));
conferir("pedido nosso: sem histórico não há item g)", !nosso.includes("g) "));
const semNumeroNosso = blocoDoPromptDeAcrescimo({ numero: null, canalNome: "IA Whats", statusLegivel: "Novo", aceitaAcrescimo: true });
const exemploSemNumero = (semNumeroNosso.match(/\[\[ACRESCIMO_PEDIDO: (\{.*\})\]\]/) || [])[1];
let semNumeroOk = null;
try { semNumeroOk = JSON.parse(exemploSemNumero); } catch {}
conferir("pedido sem número: exemplo continua JSON válido", semNumeroOk !== null && semNumeroOk.pedido === "", exemploSemNumero);
const comHistorico = blocoDoPromptDeAcrescimo({
  numero: 48, canalNome: "Online", statusLegivel: "Em Preparação na Cozinha 🔥", aceitaAcrescimo: true,
  historico: "  - Acréscimo pedido às 21:05: 1x Coca-Cola 2L (R$ 12,00) → RECUSADO pela cozinha — motivo: já saiu",
});
conferir("histórico entra no item g) com a orientação", comHistorico.includes("g) Acréscimos já pedidos") && comHistorico.includes("RECUSADO pela cozinha — motivo: já saiu"));
const app = blocoDoPromptDeAcrescimo({ numero: 221, canalNome: "iFood", statusLegivel: "Em Preparação na Cozinha 🔥", aceitaAcrescimo: false });
conferir("app: diz que não é possível", app.includes("NÃO É POSSÍVEL incluir itens"));
conferir("app: oferece chamar a cozinha pelo atendente", app.includes("[[CHAMAR_ATENDENTE]]"));
conferir("app: não traz exemplo de marcador para copiar", !/\[\[ACRESCIMO_PEDIDO: \{/.test(app));
conferir("app: cita o canal", app.includes("feito pelo iFood"));

console.log("\n6) Trava da promessa sem pedido gravado");
const p48 = { numero: 48 };
conferir("sem pedido na cozinha: \"já está na cozinha\" continua sendo promessa", prometeuCozinha("Pronto, já está na cozinha!", null));
conferir("sem pedido na cozinha: \"pedido confirmado\" é promessa", prometeuCozinha("Pedido confirmado! 🎉", null));
conferir("com #48: \"seu pedido #48 já está na cozinha\" NÃO é promessa", !prometeuCozinha("Seu pedido #48 já está na cozinha! O que você quer acrescentar?", p48));
conferir("com #48: \"já está na cozinha\" sem número NÃO é promessa", !prometeuCozinha("Seu pedido já está na cozinha 🔥", p48));
conferir("com #48: \"vou conferir com a cozinha\" NÃO é promessa", !prometeuCozinha("Vou conferir com a cozinha se ainda dá tempo!", p48));
conferir("com #48: \"pedido #48 foi confirmado\" fala do pedido que existe", !prometeuCozinha("Seu pedido #48 foi confirmado e está sendo preparado.", p48));
conferir("com #48: \"pedido nº 48 foi registrado\"", !prometeuCozinha("O pedido nº 48 foi registrado às 20:57.", p48));
conferir("com #48: \"Pedido confirmado! Enviado para a cozinha\" sem número É promessa de pedido novo", prometeuCozinha("Pedido confirmado! Enviado para a cozinha 🎉", p48));
conferir("com #48: citar o #480 não é citar o #48", prometeuCozinha("Pedido confirmado! O #480 foi para a cozinha.", p48));

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
