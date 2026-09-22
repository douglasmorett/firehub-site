/**
 * VÁRIOS MODELOS DE COMANDA, UM POR IMPRESSORA — e o texto que se dobra
 * sozinho conforme o pedido.
 *
 * Duas coisas que o dono pediu depois de ver o editor da Saipos (19/09/2026):
 *
 *   (A) cada impressora cadastrada escolhe QUAL modelo usa;
 *   (B) cabeçalho e rodapé com variáveis no meio da frase, onde o rótulo some
 *       junto com o campo vazio ("Ref: {referência}" não imprime "Ref:" órfão).
 *
 * O que este harness protege é o caminho de volta: o FireHub tem ~30 lojas em
 * operação com um modelo já configurado, e a compatibilidade inteira mora em
 * duas funções que o mapa deste arquivo apontou como as mais fáceis de quebrar
 * sem ninguém perceber:
 *
 *   • `modeloFoiPersonalizado` testa literalmente `Array.isArray(bruto.completo)`.
 *     Guardar os modelos novos em outra chave e parar de escrever `completo`
 *     faz TODA loja personalizada voltar ao layout de fábrica, em silêncio.
 *   • `lerModelo` descartava qualquer chave de topo desconhecida. Como o editor
 *     salva com `{...lerModelo(atual), [via]: nova}`, um Salvar na tela antiga
 *     apagaria os modelos extras.
 *
 *   node scripts/teste-modelo-por-impressora.js
 */
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const M = jiti(path.resolve(__dirname, "..", "src", "lib", "comanda-modelo.ts"));
const {
  modeloPadrao, lerModelo, viaDoModelo, blocosDoPedido, blocosParaOAssistente,
  modeloFoiPersonalizado, resolverLinhaRica, montarComanda, previaEmTexto,
  pedidoDeExemplo, aceitaFormato, CAMPOS_DISPONIVEIS, NOME_DO_BLOCO,
} = M;

let ok = 0, falhou = 0;
function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const bloco = (tipo, extra = {}) => ({ tipo, ligado: true, ...extra });

console.log("\n== O CAMINHO DE VOLTA: nada pode mudar para quem já usa ==");
const antigo = { versao: 1, cozinha: [bloco("itens")], completo: [bloco("itens"), bloco("totais")] };
conferir("modelo antigo continua sendo 'personalizado'", modeloFoiPersonalizado(antigo), true);
conferir("loja que nunca abriu a tela não manda blocos", blocosDoPedido({}, {}), undefined);
conferir("printerConfig nulo não quebra", blocosDoPedido(null, {}), undefined);
const lidoAntigo = lerModelo(antigo);
conferir("lerModelo de modelo antigo não inventa modelos[]", lidoAntigo.modelos, undefined);
conferir("e continua com as duas vias", [Array.isArray(lidoAntigo.cozinha), Array.isArray(lidoAntigo.completo)], [true, true]);

console.log("\n== lerModelo PRESERVA os modelos extras (senão a tela antiga os apaga) ==");
const comExtras = {
  versao: 1,
  cozinha: [bloco("itens")],
  completo: [bloco("itens"), bloco("totais")],
  modelos: [{ id: "m1", nome: "Cozinha grande", cozinha: [bloco("itens", { tamanho: 2 })], completo: [bloco("itens")] }],
};
const lido = lerModelo(comExtras);
conferir("o modelo extra sobrevive ao lerModelo", lido.modelos?.length, 1);
conferir("com id e nome", [lido.modelos[0].id, lido.modelos[0].nome], ["m1", "Cozinha grande"]);
// E o que o editor faz ao salvar: espalha o lido e troca UMA via.
const salvoPelaTelaAntiga = { ...lerModelo(comExtras), completo: [bloco("itens")] };
conferir("salvar pela tela antiga NÃO apaga os extras", lerModelo(salvoPelaTelaAntiga).modelos?.length, 1);

console.log("\n== cada modelo extra passa pela MESMA validação ==");
const semObrigatorio = {
  versao: 1, cozinha: [bloco("itens")], completo: [bloco("itens")],
  modelos: [{ id: "m2", nome: "Só totais", cozinha: [bloco("totais")], completo: [bloco("totais")] }],
};
const v = lerModelo(semObrigatorio).modelos[0];
conferir("bloco obrigatório volta no modelo extra (itens)", v.completo.some((b) => b.tipo === "itens"), true);
conferir("e o aviso de entrega parceira também", v.completo.some((b) => b.tipo === "avisoEntrega"), true);
conferir("modelo extra sem id é descartado", lerModelo({ ...antigo, modelos: [{ nome: "sem id" }] }).modelos, undefined);

console.log("\n== a impressora escolhe o modelo ==");
const cfg = { comandaModelo: comExtras };
const padraoDaLoja = blocosDoPedido(cfg, { semValores: true });
const doModeloM1 = blocosDoPedido(cfg, { semValores: true, modeloId: "m1" });
conferir("sem modeloId, vem o padrão da loja", padraoDaLoja.map((b) => b.tipo), ["itens", "avisoEntrega"]);
conferir("com modeloId, vem o modelo escolhido (tamanho 2)", doModeloM1[0].tamanho, 2);
conferir(
  "modeloId que aponta para modelo APAGADO cai no padrão — nunca em nada",
  blocosDoPedido(cfg, { semValores: true, modeloId: "nao-existe" }).map((b) => b.tipo),
  ["itens", "avisoEntrega"],
);
conferir(
  "impressora sintética de resgate (sem modeloId) usa o padrão",
  viaDoModelo(lerModelo(comExtras), { modeloId: undefined, semValores: false }).some((b) => b.tipo === "totais"),
  true,
);
conferir("a via (cozinha/completo) continua valendo dentro do modelo escolhido",
  viaDoModelo(lerModelo(comExtras), { modeloId: "m1", semValores: false }).map((b) => b.tipo).includes("itens"), true);

console.log("\n== TEXTO RICO: o rótulo some junto com o campo vazio ==");
const pedidoCheio = { ...pedidoDeExemplo("Loja"), cliente: "Ana", endereco: "Rua X, 10", entregador: "Bruno", observacao: "sem cebola" };
const pedidoMagro = { ...pedidoDeExemplo("Loja"), cliente: "Ana", endereco: "", entregador: "", observacao: "" };

const linhaRef = { partes: [{ texto: "Entregador: ", campo: "entregador" }] };
conferir("com valor, imprime rótulo + valor", resolverLinhaRica(linhaRef, pedidoCheio), "Entregador: Bruno");
conferir("sem valor, NÃO imprime o rótulo órfão", resolverLinhaRica(linhaRef, pedidoMagro), "");

const mista = { partes: [{ texto: "Cliente: ", campo: "cliente" }, { texto: " | " }, { texto: "Obs: ", campo: "observacao" }] };
conferir("parte com campo vazio some, literal fica", resolverLinhaRica(mista, pedidoMagro), "Cliente: Ana |");
conferir("com tudo preenchido, sai inteiro", resolverLinhaRica(mista, pedidoCheio), "Cliente: Ana | Obs: sem cebola");
conferir("linha só de literais sai sempre", resolverLinhaRica({ partes: [{ texto: "OBRIGADO!" }] }, pedidoMagro), "OBRIGADO!");
conferir("campo que não existe no mapa não imprime nada", resolverLinhaRica({ partes: [{ texto: "X: ", campo: "inventado" }] }, pedidoCheio), "");
conferir("linha sem partes vira vazio", resolverLinhaRica({ partes: [] }, pedidoCheio), "");

console.log("\n== o bloco de texto rico na prévia ==");
const modeloRico = {
  versao: 1,
  cozinha: [bloco("itens")],
  completo: [
    bloco("textoRico", {
      linhas: [
        { partes: [{ texto: "Ref: ", campo: "endereco" }], negrito: true },
        { partes: [{ texto: "Entregador: ", campo: "entregador" }] },
        { partes: [{ texto: "SEMPRE SAI" }], alinhamento: "centro" },
      ],
    }),
    bloco("itens"),
  ],
};
const linhasCheio = montarComanda(lerModelo(modeloRico).completo, pedidoCheio, 48);
const textoCheio = linhasCheio.map((l) => l.texto).join("\n");
conferir("pedido com endereço imprime a linha do endereço", /Ref: Rua X, 10/.test(textoCheio), true);
conferir("e a do entregador", /Entregador: Bruno/.test(textoCheio), true);

const linhasMagro = montarComanda(lerModelo(modeloRico).completo, pedidoMagro, 48);
const textoMagro = linhasMagro.map((l) => l.texto).join("\n");
conferir("pedido sem endereço NÃO imprime 'Ref:' sozinho", /Ref:/.test(textoMagro), false);
conferir("nem 'Entregador:' sozinho", /Entregador:/.test(textoMagro), false);
conferir("mas o literal continua saindo", /SEMPRE SAI/.test(textoMagro), true);
conferir("a linha vazia não vira linha em branco", textoMagro.split("\n").filter((l) => l.trim() === "").length, textoCheio.split("\n").filter((l) => l.trim() === "").length);

console.log("\n== o formato do texto rico é POR LINHA ==");
conferir("o bloco todo não aceita formato", aceitaFormato("textoRico"), false);
conferir("mas textoLivre continua aceitando", aceitaFormato("textoLivre"), true);
const negritoNaLinha = linhasCheio.find((l) => /Ref:/.test(l.texto));
conferir("a linha marcada como negrito chega negrito na prévia", negritoNaLinha?.negrito, true);

console.log("\n== o payload que atravessa a rede ==");
const paraRede = blocosParaOAssistente(lerModelo(modeloRico).completo);
const blocoRico = paraRede.find((b) => b.tipo === "textoRico");
conferir("o bloco rico vai para o Assistente", !!blocoRico, true);
conferir("com as linhas dentro (lista branca de campos)", blocoRico.linhas.length, 3);
conferir("bloco desligado não vai", blocosParaOAssistente([bloco("itens"), { tipo: "totais", ligado: false }]).length, 1);

console.log("\n== o contrato com o Assistente ==");
conferir("textoRico está no dicionário de nomes", typeof NOME_DO_BLOCO.textoRico, "string");
conferir("os campos novos estão na lista da tela", ["observacao", "subtotal", "desconto", "troco"].every((c) => CAMPOS_DISPONIVEIS.some((x) => x.chave === c)), true);
conferir("e continuam os antigos", CAMPOS_DISPONIVEIS.some((x) => x.chave === "cliente"), true);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
