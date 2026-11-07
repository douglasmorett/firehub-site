/**
 * Prova da memória do pedido e do destino da tag (lib/rascunho-do-robo.ts).
 *
 *   node scripts/teste-rascunho-do-robo.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/rascunho-do-robo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  destinoDaTag, cancelamentoDaTag, contemTudo, mesmosItens, candidatosValidos,
  candidatosSoDeComparacao, memoriaDoPedidoParaOPrompt, escolhasEmTexto, JANELA_DO_PEDIDO_ENVIADO_MS,
  pedidosParaNaoDuplicar, itensAlemDoPedido, JANELA_DE_COMPARACAO_MS,
} = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

const AGORA = Date.UTC(2026, 8, 18, 23, 0, 0);
const haMin = (m) => new Date(AGORA - m * 60000);

const xtudo = (q = 2, extra = {}) => ({ menuProductId: "p-xtudo", productName: "X-Tudo", quantity: q, price: 25, ...extra });
const coca = (q = 1) => ({ menuProductId: "p-coca", productName: "Coca 2L", quantity: q, price: 12 });
const guarana = (q = 1) => ({ menuProductId: "p-guarana", productName: "Guaraná 2L", quantity: q, price: 10 });

const rascunho = (itens, min = 3) => ({ id: "r1", status: "CRIANDO_IA", source: "WHATSAPP_IA", createdAt: haMin(min), items: itens });
// deliveryType no banco é "DELIVERY"/"RETIRADA" (o que tipoDoPedidoDoRobo grava);
// o modelo escreve "ENTREGA" na tag. Os dois têm que ser a mesma coisa.
const enviado = (itens, min = 5, extra = {}) => ({
  id: "n1", status: "NOVO", source: "WHATSAPP_IA", createdAt: haMin(min), dailyOrderNumber: 12,
  customerAddress: "Rua A, 10", paymentMethod: "Pix", deliveryType: "DELIVERY", items: itens, ...extra,
});

console.log("\n1) Sem nada no banco: cria");
conferir("criar", destinoDaTag({ candidatos: [], isFinal: false, itensNovos: [xtudo()], agora: AGORA }).acao === "criar");

console.log("\n2) Rascunho em andamento: reescreve, final ou não");
conferir("não-final", destinoDaTag({ candidatos: [rascunho([xtudo()])], isFinal: false, itensNovos: [coca()], agora: AGORA }).acao === "reescrever");
conferir("final", destinoDaTag({ candidatos: [rascunho([xtudo()])], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA }).acao === "reescrever");
conferir("rascunho velho (faxina não passou) ainda é rascunho", destinoDaTag({ candidatos: [rascunho([xtudo()], 300)], isFinal: false, itensNovos: [coca()], agora: AGORA }).acao === "reescrever");

console.log("\n3) Pedido ENVIADO nunca vira rascunho");
{
  const d = destinoDaTag({ candidatos: [enviado([xtudo(), coca()])], isFinal: false, itensNovos: [xtudo(), coca(), guarana()], agora: AGORA });
  conferir("acréscimo não confirmado: não mexe", d.acao === "nao_mexer" && d.pedido.id === "n1", d);
  const d2 = destinoDaTag({ candidatos: [enviado([xtudo(), coca()])], isFinal: false, itensNovos: [guarana()], alteraPedido: 12, agora: AGORA });
  conferir("alteração declarada e não confirmada: não mexe", d2.acao === "nao_mexer", d2);
  const d3 = destinoDaTag({ candidatos: [enviado([xtudo(), coca()])], isFinal: false, itensNovos: [guarana()], agora: AGORA });
  conferir("tag não-final só com item novo: não abre rascunho (vira acréscimo ao confirmar)", d3.acao === "nao_mexer" && d3.pedido.id === "n1", d3);
  const d4 = destinoDaTag({ candidatos: [enviado([xtudo(), coca()])], isFinal: false, itensNovos: [guarana()], pedidoSeparado: true, agora: AGORA });
  conferir("tag não-final de OUTRO pedido (pedidoSeparado): cria rascunho novo, o enviado fica", d4.acao === "criar", d4);
}

console.log("\n4) Pedido enviado + tag FINAL");
{
  const base = [xtudo(), coca()];
  const igual = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [coca(), xtudo()], endereco: "rua a 10", pagamento: "PIX", tipo: "ENTREGA", agora: AGORA });
  conferir("reemissão idêntica: não regrava nem reimprime", igual.acao === "identico", igual);
  const semDados = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA });
  conferir("idêntica sem endereço/pagamento na tag", semDados.acao === "identico", semDados);
  const novoEndereco = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), coca()], endereco: "Rua B, 99", agora: AGORA });
  conferir("mesmos itens, endereço novo e nada declarado: pedido separado", novoEndereco.acao === "criar", novoEndereco);
  const acrescimo = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), coca(), guarana()], agora: AGORA });
  conferir("acréscimo (contém tudo): reescreve o mesmo pedido", acrescimo.acao === "reescrever" && acrescimo.pedido.id === "n1", acrescimo);
  const maisQtd = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(3), coca()], agora: AGORA });
  conferir("aumentou a quantidade: reescreve", maisQtd.acao === "reescrever", maisQtd);
  const troca = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), guarana()], alteraPedido: 12, agora: AGORA });
  conferir("troca DECLARADA (alteraPedido: 12): reescreve", troca.acao === "reescrever", troca);
  const trocaTexto = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), guarana()], alteraPedido: "#12", agora: AGORA });
  conferir("alteraPedido: \"#12\" também vale", trocaTexto.acao === "reescrever", trocaTexto);
  const outroNumero = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [guarana()], alteraPedido: 7, agora: AGORA });
  conferir("alteraPedido de OUTRO número não autoriza", outroNumero.acao === "criar", outroNumero);
  const separado = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [guarana()], agora: AGORA });
  conferir("só o item novo, sem declarar: acréscimo do mesmo pedido (o enviado não perde itens)", separado.acao === "acrescentar" && separado.pedido.id === "n1" && separado.itens.length === 1, separado);
  const separadoDeclarado = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [guarana()], pedidoSeparado: true, agora: AGORA });
  conferir("só o item novo com pedidoSeparado: pedido SEPARADO", separadoDeclarado.acao === "criar", separadoDeclarado);
  const outroEndereco = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), coca()], endereco: "Rua B, 99", pagamento: "Dinheiro", agora: AGORA });
  conferir("'outro igual pra minha mãe na Rua B': pedido separado, não reescreve", outroEndereco.acao === "criar", outroEndereco);
  const outroEnderecoDeclarado = destinoDaTag({ candidatos: [enviado(base)], isFinal: true, itensNovos: [xtudo(), coca()], endereco: "Rua B, 99", alteraPedido: 12, agora: AGORA });
  conferir("mudança de endereço DECLARADA como alteração: reescreve", outroEnderecoDeclarado.acao === "reescrever", outroEnderecoDeclarado);
  const observacao = destinoDaTag({ candidatos: [enviado([xtudo(2)])], isFinal: true, itensNovos: [xtudo(2, { notes: "sem cebola" })], agora: AGORA });
  conferir("mesmos itens com observação nova: reescreve, não é idêntico", observacao.acao === "reescrever", observacao);
}

console.log("\n5) O que a tag NÃO pode tocar");
{
  const doSite = enviado([xtudo()], 5, { source: "ONLINE" });
  conferir("pedido do SITE", destinoDaTag({ candidatos: [doSite], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA }).acao === "criar");
  const semOrigem = enviado([xtudo()], 5, { source: null });
  conferir("pedido sem origem", destinoDaTag({ candidatos: [semOrigem], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA }).acao === "criar");
  // Não reescreve nenhum destes; o que é novo vira ACRÉSCIMO do mesmo pedido (06/11).
  const soCoca = (d) => d.acao === "acrescentar" && d.itens.length === 1 && d.itens[0].productName === "Coca 2L" && d.itens[0].quantity === 1;
  const velho = enviado([xtudo()], 21);
  conferir("pedido enviado há mais de 20 min: não reescreve, a coca vira acréscimo", soCoca(destinoDaTag({ candidatos: [velho], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA })));
  const aceito = enviado([xtudo()], 2, { status: "ACEITO" });
  conferir("pedido que a loja já ACEITOU: não reescreve, a coca vira acréscimo", soCoca(destinoDaTag({ candidatos: [aceito], isFinal: true, itensNovos: [xtudo(), coca()], agora: AGORA })));
  const preparando = enviado([xtudo()], 2, { status: "PREPARANDO" });
  conferir("pedido em preparo + tag não-final da coca: não abre rascunho", destinoDaTag({ candidatos: [preparando], isFinal: false, itensNovos: [coca()], agora: AGORA }).acao === "nao_mexer");
  conferir("janela é de 20 min", JANELA_DO_PEDIDO_ENVIADO_MS === 20 * 60 * 1000);
  conferir("candidatos nulos", candidatosValidos(null, AGORA).length === 0);
}

console.log("\n6) Rascunho novo DEPOIS de um pedido enviado: o alvo é o rascunho");
{
  const d = destinoDaTag({ candidatos: [enviado([xtudo()], 10), rascunho([guarana()], 1)], isFinal: true, itensNovos: [guarana(2)], agora: AGORA });
  conferir("reescreve o rascunho, não o enviado", d.acao === "reescrever" && d.pedido.id === "r1", d);
  const inverso = destinoDaTag({ candidatos: [rascunho([guarana()], 30), enviado([xtudo()], 2)], isFinal: false, itensNovos: [xtudo(), coca()], agora: AGORA });
  conferir("rascunho VELHO não passa na frente do pedido enviado", inverso.acao === "nao_mexer" && inverso.pedido.id === "n1", inverso);
}

console.log("\n6b) Alteração confirmada vai ao PEDIDO apontado, mesmo com rascunho aberto em paralelo");
{
  const base = [xtudo(2), coca()];
  const candidatos = [enviado(base, 8), rascunho([xtudo(2), guarana()], 1)];
  const d = destinoDaTag({ candidatos, isFinal: true, itensNovos: [xtudo(2), guarana()], alteraPedido: 12, agora: AGORA });
  conferir("reescreve o pedido nº 12, não o rascunho", d.acao === "reescrever" && d.pedido.id === "n1", d);
  conferir("e manda descartar o rascunho órfão", d.descartarRascunhoId === "r1", d);
  const semDeclarar = destinoDaTag({ candidatos, isFinal: true, itensNovos: [xtudo(2), guarana()], agora: AGORA });
  conferir("sem declarar, continua no rascunho", semDeclarar.acao === "reescrever" && semDeclarar.pedido.id === "r1", semDeclarar);
  const naoFinal = destinoDaTag({ candidatos: [enviado(base, 8)], isFinal: false, itensNovos: [xtudo(2), guarana()], alteraPedido: 12, agora: AGORA });
  conferir("tag não-final COM alteraPedido não cria rascunho paralelo", naoFinal.acao === "nao_mexer", naoFinal);
}

console.log("\n6c) Troco e observação pedidos depois do pedido enviado NÃO são engolidos");
{
  const base = [xtudo(2), coca()];
  const semTroco = enviado(base, 4, { paymentMethod: "Dinheiro", changeAmount: null, notes: "" });
  const comTroco = destinoDaTag({ candidatos: [semTroco], isFinal: true, itensNovos: [xtudo(2), coca()], pagamento: "Dinheiro", troco: 100, alteraPedido: 12, agora: AGORA });
  conferir("troco novo: reescreve (não é 'identico')", comTroco.acao === "reescrever", comTroco);
  const mesmoTroco = destinoDaTag({ candidatos: [enviado(base, 4, { paymentMethod: "Dinheiro", changeAmount: 100 })], isFinal: true, itensNovos: [xtudo(2), coca()], pagamento: "Dinheiro", troco: 100, agora: AGORA });
  conferir("mesmo troco: identico", mesmoTroco.acao === "identico", mesmoTroco);
  const comObs = destinoDaTag({ candidatos: [enviado(base, 4, { notes: "" })], isFinal: true, itensNovos: [xtudo(2), coca()], observacao: "interfone quebrado", alteraPedido: 12, agora: AGORA });
  conferir("observação nova: reescreve", comObs.acao === "reescrever", comObs);
  const obsJaGravada = destinoDaTag({ candidatos: [enviado(base, 4, { notes: "🤖 Pedido pelo robô · Obs: interfone quebrado" })], isFinal: true, itensNovos: [xtudo(2), coca()], observacao: "interfone quebrado", agora: AGORA });
  conferir("observação já gravada: identico", obsJaGravada.acao === "identico", obsJaGravada);
}

console.log("\n6d) Tag repetida depois do ACEITE não vira pedido gêmeo");
{
  const base = [xtudo(2), coca()];
  for (const status of ["ACEITO", "PREPARANDO", "PRONTO"]) {
    const p = enviado(base, 3, { status, id: "a1" });
    const d = destinoDaTag({ candidatos: [p], isFinal: true, itensNovos: [coca(), xtudo(2)], endereco: "Rua A, 10", pagamento: "Pix", tipo: "ENTREGA", agora: AGORA });
    conferir(`${status}: reconhece e não duplica`, d.acao === "identico" && d.pedido.id === "a1", d);
    const alterado = destinoDaTag({ candidatos: [p], isFinal: true, itensNovos: [xtudo(2), coca(), guarana()], alteraPedido: 12, agora: AGORA });
    conferir(`${status}: o que foi pedido depois vira acréscimo (só o guaraná), nunca reescreve o que está na chapa`, alterado.acao === "acrescentar" && alterado.itens.length === 1 && alterado.itens[0].productName === "Guaraná 2L", alterado);
  }
  // Garagem Burger, 31/10/2026: a loja finalizou à mão; o "Confirmo" trouxe pagamento/troco/observação de outro jeito.
  const amao = enviado(base, 3, { status: "ACEITO", id: "a5", paymentMethod: "Dinheiro", changeAmount: 81, notes: "🤖 Montado pela IA no WhatsApp · 🧑‍💼 Finalizado à mão" });
  const gemeo = destinoDaTag({ candidatos: [amao], isFinal: true, itensNovos: [coca(), xtudo(2)], endereco: "Rua A 10 - centro", pagamento: "Dinheiro (troco para 81)", troco: 81, observacao: "tem trocado", tipo: "ENTREGA", agora: AGORA });
  conferir("finalizado à mão + 'Confirmo' com o resto escrito diferente: não nasce gêmeo", gemeo.acao === "identico" && gemeo.pedido.id === "a5", gemeo);
  const outraCoisa = destinoDaTag({ candidatos: [amao], isFinal: true, itensNovos: [xtudo(2), coca(), guarana()], tipo: "ENTREGA", agora: AGORA });
  conferir("aceito + item a mais: só o item a mais vira acréscimo", outraCoisa.acao === "acrescentar" && outraCoisa.itens.length === 1, outraCoisa);
  const velho = enviado(base, 50, { status: "ACEITO", id: "a1" });
  conferir("fora da janela: não compara", destinoDaTag({ candidatos: [velho], isFinal: true, itensNovos: [xtudo(2), coca()], agora: AGORA }).acao === "criar");
  conferir("só de comparação: pedido do site fora", candidatosSoDeComparacao([enviado(base, 3, { status: "ACEITO", source: "ONLINE" })], AGORA).length === 0);
}

console.log("\n6d2) Casos reais de 31/10 a 06/11: gêmeo, rascunho gêmeo e 'e uma coca'");
{
  const pizza = (q = 1) => ({ menuProductId: "p-pizza", productName: "Pizza Grande", quantity: q, price: 50 });
  // Deeds nº 6/9 (03/11): a tag repetida veio 16,8 min depois, com o pedido já saindo.
  const saindo = enviado([pizza()], 17, { status: "SAIU_ENTREGA", id: "d6" });
  const deeds = destinoDaTag({ candidatos: [saindo], isFinal: true, itensNovos: [pizza()], endereco: "Rua A, 10", pagamento: "Pix", tipo: "ENTREGA", agora: AGORA });
  conferir("pedido SAINDO + tag igual: não abre gêmeo", deeds.acao === "identico" && deeds.pedido.id === "d6", deeds);
  const entregue = enviado([pizza()], 30, { status: "ENTREGUE", id: "d7" });
  conferir("pedido ENTREGUE há pouco + tag igual: não abre gêmeo", destinoDaTag({ candidatos: [entregue], isFinal: true, itensNovos: [pizza()], tipo: "ENTREGA", agora: AGORA }).acao === "identico");
  // Pizzaria Cardoso nº 52/53 (31/10): 20,1 min depois, ainda ACEITO.
  const cardoso = enviado([pizza()], 21, { status: "ACEITO", id: "c52" });
  conferir("ACEITO há 21 min + tag igual: não abre gêmeo", destinoDaTag({ candidatos: [cardoso], isFinal: true, itensNovos: [pizza()], tipo: "ENTREGA", agora: AGORA }).acao === "identico");
  // Garagem nº 74 (31/10) e Pizzaria 17 nº 48 (06/11): rascunho gêmeo segundos depois do aceite.
  const g74 = enviado([xtudo(1)], 1, { status: "ACEITO", id: "g74" });
  conferir("ACEITO + tag NÃO-final igual: não abre rascunho", destinoDaTag({ candidatos: [g74], isFinal: false, itensNovos: [xtudo(1)], agora: AGORA }).acao === "nao_mexer");
  // Garagem nº 69 (02/11): rascunho só com o milkshake que já estava no pedido.
  const g69 = enviado([xtudo(1), coca()], 9, { status: "ACEITO", id: "g69" });
  conferir("ACEITO + tag NÃO-final com parte do pedido: não abre rascunho", destinoDaTag({ candidatos: [g69], isFinal: false, itensNovos: [coca()], agora: AGORA }).acao === "nao_mexer");
  const novoParcial = destinoDaTag({ candidatos: [enviado([xtudo(1), coca()], 3)], isFinal: false, itensNovos: [coca()], agora: AGORA });
  conferir("NOVO + tag NÃO-final com parte do pedido: não abre rascunho", novoParcial.acao === "nao_mexer", novoParcial);
  // Yakisoba nº 35/36 (02/11): a tag trouxe os 2 yakisobas de novo + o guaraná.
  const yaki = destinoDaTag({ candidatos: [enviado([xtudo(2)], 1, { status: "ACEITO", id: "y35" })], isFinal: true, itensNovos: [xtudo(2), guarana()], tipo: "ENTREGA", agora: AGORA });
  conferir("pedido inteiro + guaraná: só o guaraná vira acréscimo", yaki.acao === "acrescentar" && yaki.pedido.id === "y35" && yaki.itens.length === 1 && yaki.itens[0].productName === "Guaraná 2L", yaki);
  // Túlio nº 69/70 (27/10): retirada, o segundo pedido só com o que veio depois.
  const tulio = destinoDaTag({ candidatos: [enviado([xtudo(1)], 4, { status: "ACEITO", deliveryType: "RETIRADA", customerAddress: null, id: "t69" })], isFinal: true, itensNovos: [coca(), guarana(3)], tipo: "RETIRADA", agora: AGORA });
  conferir("retirada + itens novos: viram acréscimo do mesmo pedido", tulio.acao === "acrescentar" && tulio.itens.length === 2, tulio);
  const mais1 = destinoDaTag({ candidatos: [enviado([xtudo(2), coca()], 4, { status: "ACEITO" })], isFinal: true, itensNovos: [xtudo(3), coca()], agora: AGORA });
  conferir("mais um do mesmo: acréscimo de 1", mais1.acao === "acrescentar" && mais1.itens.length === 1 && mais1.itens[0].quantity === 1, mais1);
  // O que NÃO vira acréscimo.
  const aceitoBase = enviado([xtudo(2)], 4, { status: "ACEITO" });
  conferir("pedidoSeparado: true → pedido novo", destinoDaTag({ candidatos: [aceitoBase], isFinal: true, itensNovos: [coca()], pedidoSeparado: true, agora: AGORA }).acao === "criar");
  conferir("pedidoSeparado: true → até o igual vira pedido novo", destinoDaTag({ candidatos: [aceitoBase], isFinal: true, itensNovos: [xtudo(2)], pedidoSeparado: true, agora: AGORA }).acao === "criar");
  conferir("outro endereço → pedido novo", destinoDaTag({ candidatos: [aceitoBase], isFinal: true, itensNovos: [coca()], endereco: "Rua B, 99", agora: AGORA }).acao === "criar");
  conferir("endereço escrito de outro jeito ainda é o mesmo lugar", destinoDaTag({ candidatos: [aceitoBase], isFinal: true, itensNovos: [coca()], endereco: "Rua A, 10 - Centro", agora: AGORA }).acao === "acrescentar");
  conferir("entrega × retirada → pedido novo", destinoDaTag({ candidatos: [aceitoBase], isFinal: true, itensNovos: [coca()], tipo: "RETIRADA", agora: AGORA }).acao === "criar");
  conferir("pedido que já SAIU → pedido novo (não dá para acrescentar)", destinoDaTag({ candidatos: [enviado([xtudo(2)], 4, { status: "SAIU_ENTREGA" })], isFinal: true, itensNovos: [coca()], agora: AGORA }).acao === "criar");
  conferir("troca de item (mistura) → caminho antigo", destinoDaTag({ candidatos: [enviado([xtudo(2), coca()], 4, { status: "ACEITO" })], isFinal: true, itensNovos: [xtudo(2), guarana()], agora: AGORA }).acao === "criar");
  conferir("fora da janela de 45 min → pedido novo", destinoDaTag({ candidatos: [enviado([xtudo(2)], 50, { status: "ACEITO" })], isFinal: true, itensNovos: [coca()], agora: AGORA }).acao === "criar");
  conferir("janela de comparação é 45 min", JANELA_DE_COMPARACAO_MS === 45 * 60 * 1000);
  conferir("pedido do site não entra na comparação", pedidosParaNaoDuplicar([enviado([xtudo()], 3, { status: "ACEITO", source: "ONLINE" })], AGORA).length === 0);
  conferir("cancelado não entra na comparação", pedidosParaNaoDuplicar([enviado([xtudo()], 3, { status: "CANCELADO" })], AGORA).length === 0);
  conferir("itensAlemDoPedido: diferença", JSON.stringify(itensAlemDoPedido([xtudo(2)], [xtudo(3), coca()]).map((i) => [i.productName, i.quantity])) === JSON.stringify([["X-Tudo", 1], ["Coca 2L", 1]]));
  conferir("itensAlemDoPedido: tag sem o pedido inteiro → null", itensAlemDoPedido([xtudo(2), coca()], [xtudo(2)]) === null);
  conferir("itensAlemDoPedido: escolha diferente não é o mesmo item", itensAlemDoPedido([xtudo(1, { comboSelections: { g: { Bacon: 1 } } })], [xtudo(1)]) === null);
}

console.log("\n6e) 'ENTREGA' da tag e 'DELIVERY' do banco são a mesma coisa");
{
  const d = destinoDaTag({ candidatos: [enviado([xtudo(2)])], isFinal: true, itensNovos: [xtudo(2)], tipo: "ENTREGA", endereco: "Rua A, 10", agora: AGORA });
  conferir("não regrava por causa do rótulo", d.acao === "identico", d);
  const r = destinoDaTag({ candidatos: [enviado([xtudo(2)], 5, { deliveryType: "RETIRADA", customerAddress: null })], isFinal: true, itensNovos: [xtudo(2)], tipo: "PICKUP", agora: AGORA });
  conferir("RETIRADA e PICKUP também", r.acao === "identico", r);
  const troca = destinoDaTag({ candidatos: [enviado([xtudo(2)])], isFinal: true, itensNovos: [xtudo(2)], tipo: "RETIRADA", alteraPedido: 12, agora: AGORA });
  conferir("entrega → retirada declarada: reescreve", troca.acao === "reescrever", troca);
}

console.log("\n6f) Cancelar: rascunho sempre; pedido na loja só se o cliente apontar");
{
  const base = [xtudo(2)];
  const so = cancelamentoDaTag({ candidatos: [rascunho(base)], agora: AGORA });
  conferir("rascunho: cancela", so.acao === "cancelar" && so.pedido.id === "r1", so);
  const desistiuDaAlteracao = cancelamentoDaTag({ candidatos: [enviado(base, 5)], agora: AGORA });
  conferir("'deixa pra lá' no meio da alteração: NÃO cancela o pedido da cozinha", desistiuDaAlteracao.acao === "nada" && desistiuDaAlteracao.pedido.id === "n1", desistiuDaAlteracao);
  const apontou = cancelamentoDaTag({ candidatos: [enviado(base, 5)], alteraPedido: 12, agora: AGORA });
  conferir("cliente aponta o nº 12: cancela", apontou.acao === "cancelar" && apontou.pedido.id === "n1", apontou);
  const comRascunho = cancelamentoDaTag({ candidatos: [enviado(base, 8), rascunho([coca()], 1)], agora: AGORA });
  conferir("com rascunho aberto, o rascunho é o alvo", comRascunho.acao === "cancelar" && comRascunho.pedido.id === "r1", comRascunho);
  const nada = cancelamentoDaTag({ candidatos: [], agora: AGORA });
  conferir("sem nada: nada a cancelar", nada.acao === "nada" && !nada.pedido, nada);
  const doSite = cancelamentoDaTag({ candidatos: [enviado(base, 5, { source: "ONLINE" })], alteraPedido: 12, agora: AGORA });
  conferir("pedido do site: intocável mesmo apontado", doSite.acao === "nada" && !doSite.pedido, doSite);
}

console.log("\n7) contemTudo / mesmosItens");
conferir("soma linhas do mesmo produto", contemTudo([xtudo(2)], [xtudo(1), xtudo(1)]) === true);
conferir("quantidade menor não contém", contemTudo([xtudo(2)], [xtudo(1)]) === false);
conferir("lista antiga vazia não autoriza nada", contemTudo([], [xtudo()]) === false);
conferir("casa por nome quando não há id", contemTudo([{ productName: "X-Tudo", quantity: 1 }], [{ productName: "x tudo", quantity: 1 }]) === true);
conferir("nome do cadastro vale mais que productName com escolhas", contemTudo([{ productName: "Pizza (Calabresa)", menuProduct: { name: "Pizza" }, quantity: 1 }], [{ productName: "Pizza", quantity: 1 }]) === true);
conferir("escolha diferente não é o mesmo item", mesmosItens([xtudo(1, { comboSelections: { g: { Bacon: 1 } } })], [xtudo(1, { comboSelections: { g: { Cheddar: 1 } } })]) === false);
conferir("ordem das chaves não importa", mesmosItens([xtudo(1, { comboSelections: { a: { x: 1 }, b: { y: 2 } } })], [xtudo(1, { comboSelections: { b: { y: 2 }, a: { x: 1 } } })]) === true);
conferir("vazio nunca é 'mesmos itens'", mesmosItens([], []) === false);

console.log("\n8) A memória volta ao prompt");
{
  conferir("sem nada: seção vazia", memoriaDoPedidoParaOPrompt([], AGORA) === "");
  conferir("rascunho sem itens: seção vazia", memoriaDoPedidoParaOPrompt([rascunho([])], AGORA) === "");
  const r = rascunho([xtudo(2, { notes: "sem cebola", comboSelections: { g1: { Bacon: 2, Cheddar: 1 } } }), coca()]);
  r.customerAddress = "Rua A, 10"; r.paymentMethod = "Dinheiro"; r.changeAmount = 100; r.totalAmount = 67; r.deliveryFee = 5; r.deliveryType = "ENTREGA";
  const t = memoriaDoPedidoParaOPrompt([r], AGORA);
  conferir("lista itens com quantidade", t.includes("- 2x X-Tudo") && t.includes("- 1x Coca 2L"), t);
  conferir("leva as escolhas", t.includes("[opções: 2x Bacon, Cheddar]"), t);
  conferir("leva a observação", t.includes("(obs: sem cebola)"), t);
  conferir("leva endereço, pagamento, troco, taxa e total", /Endereço: Rua A, 10/.test(t) && /Pagamento: Dinheiro/.test(t) && /Troco para: R\$ 100,00/.test(t) && /Taxa de entrega: R\$ 5,00/.test(t) && /Total: R\$ 67,00/.test(t), t);
  conferir("manda repetir TODOS os itens", /SUBSTITUI este rascunho inteiro/.test(t) && /repita TODOS/.test(t));
  conferir("sem lixo", !/undefined|NaN|null|\$\{/.test(t), t);

  const e = memoriaDoPedidoParaOPrompt([enviado([xtudo(), coca()], 6)], AGORA);
  conferir("pedido enviado: número e minutos", e.includes("PEDIDO Nº 12 ENVIADO À LOJA HÁ 6 MIN"), e);
  conferir("pedido enviado: ensina alteraPedido com o número", e.includes('"alteraPedido": 12'), e);
  conferir("pedido enviado: não reemitir no 'obrigado'", /NÃO emita a tag de novo/.test(e));
  conferir("pedido enviado: sem lixo", !/undefined|NaN|null|\$\{/.test(e), e);

  const ambos = memoriaDoPedidoParaOPrompt([enviado([xtudo()], 10), rascunho([guarana()], 1)], AGORA);
  conferir("rascunho mais novo + enviado: os dois aparecem", ambos.includes("RASCUNHO EM ANDAMENTO") && ambos.includes("PEDIDO Nº 12"), ambos);
  const resto = memoriaDoPedidoParaOPrompt([rascunho([guarana()], 30), enviado([xtudo()], 2)], AGORA);
  conferir("rascunho mais VELHO que o enviado: não aparece", !resto.includes("RASCUNHO EM ANDAMENTO") && resto.includes("PEDIDO Nº 12"), resto);
  conferir("pedido do site não aparece como alterável", memoriaDoPedidoParaOPrompt([enviado([xtudo()], 5, { source: "ONLINE" })], AGORA) === "");
  conferir("escolhas: lixo vira vazio", escolhasEmTexto(null) === "" && escolhasEmTexto("x") === "" && escolhasEmTexto({ g: { A: 0 } }) === "");
}

console.log(falhas === 0 ? "\nTUDO CERTO\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
