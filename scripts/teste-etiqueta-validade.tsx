/**
 * Trava as regras da etiqueta de validade (lib/etiqueta-validade.ts) e o que
 * sai no papel (EtiquetaPapel 4x6 e EtiquetaCompacta) — sem banco.
 *
 *   DATABASE_URL=postgres://x npx tsx scripts/teste-etiqueta-validade.tsx
 *
 * O `@page` de cada tamanho é conferido no Chromium por
 * scripts/teste-impressao-etiquetas.mjs.
 */
import { renderToStaticMarkup } from "react-dom/server";
import EtiquetaPapel from "../src/app/store/etiquetas/EtiquetaPapel";
import EtiquetaCompacta from "../src/app/store/etiquetas/EtiquetaCompacta";
import { TAMANHOS } from "../src/app/store/etiquetas/etiqueta-css";
import { PADRAO } from "../src/lib/etiqueta-campos";
import {
  agruparVencimentos, calcularVencimento, comoFechar, conservacaoDaEtiqueta, csvDoHistorico, dadosDaReimpressao,
  diaLocal, instanteDaHoraLocal, prazoDaConservacao, sanitizarPrazos, situacaoDoVencimento, textoDaConservacaoNoPapel,
  textosDasDatas, type DadosDoPapel, type LoteDaEtiqueta,
} from "../src/lib/etiqueta-validade";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const hora = (s: string) => instanteDaHoraLocal(s)!;

// ── 1. Conservação certa (o defeito: saía "congelado" em tudo) ────────────
console.log("\n— Conservação —");
confere("refrigerado usa o texto de refrigerado", textoDaConservacaoNoPapel(null, "REFRIGERADO"), "Manter refrigerado entre 0ºC e 4ºC.");
confere("congelado usa o texto de congelado", textoDaConservacaoNoPapel(null, "CONGELADO").startsWith("Congelador"), true);
confere("ambiente usa o texto de ambiente", textoDaConservacaoNoPapel(null, "AMBIENTE"), "Conservar em temperatura ambiente, em local seco e arejado.");
confere("descongelando usa o texto de descongelamento", textoDaConservacaoNoPapel(null, "DESCONGELANDO"), "Descongelando sob refrigeração, abaixo de 5ºC. Não recongelar.");
confere("texto editado pela loja vale", textoDaConservacaoNoPapel({ textos: { conservacaoResfriado: "Geladeira 2" } }, "REFRIGERADO"), "Geladeira 2");
confere("temperatura do produto vence o texto genérico", textoDaConservacaoNoPapel(null, "REFRIGERADO", "até 2 °C"), "Refrigerado: até 2 °C");
confere("tipo descongelando força a conservação", conservacaoDaEtiqueta("DESCONGELANDO", "CONGELADO"), "DESCONGELANDO");
confere("outros tipos seguem a escolha", conservacaoDaEtiqueta("ABERTO", "REFRIGERADO"), "REFRIGERADO");

// ── 2. Prazo por conservação, em horas ou dias ────────────────────────────
console.log("\n— Prazo e validade —");
const item = { prazos: { REFRIGERADO: { valor: 3, unidade: "d", temperatura: "até 4 °C" }, AMBIENTE: { valor: 8, unidade: "h" } }, shelfLifeDays: 90, conservacao: "CONGELADO" };
confere("prazo próprio da conservação", prazoDaConservacao(item, "REFRIGERADO"), { valor: 3, unidade: "d", temperatura: "até 4 °C" });
confere("shelfLifeDays vale só na conservação padrão", prazoDaConservacao(item, "CONGELADO"), { valor: 90, unidade: "d" });
confere("descongelando sem prazo próprio NÃO herda os 90 dias", prazoDaConservacao(item, "DESCONGELANDO"), null);
confere("item sem padrão: shelfLifeDays vale, menos descongelando", [prazoDaConservacao({ shelfLifeDays: 5 }, "REFRIGERADO"), prazoDaConservacao({ shelfLifeDays: 5 }, "DESCONGELANDO")], [{ valor: 5, unidade: "d" }, null]);
confere("sanitizar descarta lixo e conservação desconhecida", sanitizarPrazos({ REFRIGERADO: { valor: "abc" }, FORNO: { valor: 2 }, CONGELADO: { valor: 30, unidade: "x" } }), { CONGELADO: { valor: 30, unidade: "d" } });

const arroz = calcularVencimento(hora("2026-10-26T11:00"), { valor: 8, unidade: "h" });
confere("8 horas: vence às 19h do mesmo dia", [diaLocal(arroz.venceEm), arroz.comHora, textosDasDatas({ ...papel(), venceEm: arroz.venceEm, comHora: true }).validade], ["2026-10-26", true, "26/10/2026 19:00"]);
const molho = calcularVencimento(hora("2026-10-26T21:30"), { valor: 6, unidade: "h" });
confere("6 horas passando da meia-noite vira o dia", textosDasDatas({ ...papel(), venceEm: molho.venceEm, comHora: true }).validade, "27/10/2026 03:30");
const carne = calcularVencimento(hora("2026-10-26T23:50"), { valor: 2, unidade: "d" });
confere("2 dias: vale até o FIM do dia 28, sem hora no papel", [carne.comHora, textosDasDatas({ ...papel(), venceEm: carne.venceEm, comHora: false }).validade, carne.venceEm.toISOString()], [false, "28/10/2026", "2026-10-29T02:59:59.999Z"]);

// ── 3. Reimpressão não revalida ───────────────────────────────────────────
console.log("\n— Reimpressão —");
const primeira = calcularVencimento(hora("2026-10-26T14:00"), { valor: 6, unidade: "h" });
const gravado: LoteDaEtiqueta = {
  code: "K7F2M9QX", productName: "Molho de alho", kitchenItemId: "k1", tipoEtiqueta: "ABERTO", conservacao: "REFRIGERADO",
  manipuladoEm: hora("2026-10-26T14:00").toISOString(), venceEm: primeira.venceEm.toISOString(), validadeComHora: true,
  fabricadoEm: "2026-10-26T00:00:00.000Z", validoAte: "2026-10-26T00:00:00.000Z", responsavel: "Maria", loteRef: null,
  marca: "Hellmann's", fornecedor: "Atacadão", impressoes: 1, status: "ATIVO", createdAt: hora("2026-10-26T14:01").toISOString(),
};
const r1 = dadosDaReimpressao(gravado);
// O produto passou a ter 3 dias e a reimpressão é feita no dia seguinte: nada disso entra.
const r2 = dadosDaReimpressao({ ...gravado, impressoes: 2 });
confere("reimpressão mantém a validade da primeira (6 h)", textosDasDatas(r2).validade, "26/10/2026 20:00");
confere("reimpressão mantém a manipulação com hora", textosDasDatas(r2).data, "26/10/2026 14:00");
confere("duas reimpressões dão o mesmo papel", JSON.stringify(r1), JSON.stringify(r2));
confere("reimpressão leva tipo, conservação, responsável, marca e fornecedor", [r2.tipo, r2.conservacao, r2.responsavel, r2.marca, r2.fornecedor, r2.lote], ["ABERTO", "REFRIGERADO", "Maria", "Hellmann's", "Atacadão", "K7F2M9QX"]);
const antigo = dadosDaReimpressao({ code: "ABCDEFGH", productName: "Massa", fabricadoEm: "2026-10-20T00:00:00.000Z", validoAte: "2026-10-23T00:00:00.000Z" });
confere("lote antigo (só o dia) imprime o dia certo, sem hora", [textosDasDatas(antigo).data, textosDasDatas(antigo).validade], ["20/10/2026", "23/10/2026"]);

// ── 4. Lista de vencimento ────────────────────────────────────────────────
console.log("\n— Vence hoje / amanhã / venceu —");
const agora = hora("2026-10-26T18:30");
const lotes: LoteDaEtiqueta[] = [
  { code: "A", productName: "Molho 6h", venceEm: hora("2026-10-26T18:00").toISOString(), validadeComHora: true, status: "ATIVO" },
  { code: "B", productName: "Arroz 8h", venceEm: hora("2026-10-26T22:00").toISOString(), validadeComHora: true, status: "ATIVO" },
  { code: "C", productName: "Frango", validoAte: "2026-10-26T00:00:00.000Z", status: "ATIVO" },
  { code: "D", productName: "Carne moída", venceEm: hora("2026-10-27T23:59").toISOString(), status: "ATIVO" },
  { code: "E", productName: "Massa", validoAte: "2026-10-25T00:00:00.000Z", status: "ATIVO" },
  { code: "F", productName: "Queijo", validoAte: "2026-10-30T00:00:00.000Z", status: "ATIVO" },
  { code: "G", productName: "Já descartado", validoAte: "2026-10-20T00:00:00.000Z", status: "DESCARTADO" },
];
const g = agruparVencimentos(lotes, agora);
confere("venceu: o de 6h que venceu às 18h e o de ontem", g.venceu.map((l) => l.code), ["E", "A"]);
confere("vence hoje: o de 8h (22h) e o do dia de hoje", g.hoje.map((l) => l.code), ["B", "C"]);
confere("vence amanhã", g.amanha.map((l) => l.code), ["D"]);
confere("depois de amanhã e fechado ficam de fora", [situacaoDoVencimento(lotes[5], agora), g.venceu.some((l) => l.code === "G")], ["depois", false]);
confere("etiqueta de ontem com 1 dia aparece em 'vence hoje'", situacaoDoVencimento({ code: "X", productName: "x", venceEm: calcularVencimento(hora("2026-10-25T09:00"), { valor: 1, unidade: "d" }).venceEm }, agora), "hoje");

console.log("\n— Usei / descartei —");
confere("recebida nesta loja com saldo: baixa pelo estoque", comoFechar({ code: "A", productName: "a", recebidoPorId: "loja", stockItemId: "i", quantidadeRestante: 2 }, "loja"), "ESTOQUE");
confere("nunca escaneada: fecha só a etiqueta", comoFechar({ code: "A", productName: "a", recebidoPorId: null }, "loja"), "SO_ETIQUETA");
confere("recebida por outra loja: não mexe", comoFechar({ code: "A", productName: "a", recebidoPorId: "outra" }, "loja"), "OUTRA_LOJA");

console.log("\n— Histórico CSV —");
const csv = csvDoHistorico([gravado, { ...gravado, code: "Q2", productName: 'Molho "da casa"; picante' }], agora);
const linhas = csv.split("\r\n");
confere("CSV com BOM e ponto e vírgula", [csv.charCodeAt(0), linhas[0].includes(";Validade;Responsável;")], [0xfeff, true]);
confere("linha traz tipo, datas com hora e responsável", linhas[1], "26/10/2026 14:01;Molho de alho;Produto aberto;Refrigerado;26/10/2026 14:00;26/10/2026 20:00;Maria;;K7F2M9QX;1;Em uso;Hellmann's;Atacadão");
confere("aspas e ponto e vírgula escapados", linhas[2].split(";")[1] + ";" + linhas[2].split(";")[2], '"Molho ""da casa""; picante"');

// ── 5. O papel ────────────────────────────────────────────────────────────
console.log("\n— O papel —");
function papel(x: Partial<DadosDoPapel> = {}): DadosDoPapel {
  return {
    tipo: "MANIPULADO", conservacao: "REFRIGERADO", manipuladoEm: hora("2026-10-26T14:00"), manipulacaoComHora: true,
    venceEm: hora("2026-10-26T20:00"), comHora: true, responsavel: "Maria", lote: "", marca: "", fornecedor: "", ...x,
  };
}
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const grande = texto(renderToStaticMarkup(
  <EtiquetaPapel
    etq={{ code: "K7F2M9QX", qr: "" }} nomeDoProduto="Molho de alho" config={{ weightStr: "1 kg" }} campos={{ ...PADRAO, tabelaNutricional: false }}
    textoConservacao={textoDaConservacaoNoPapel(null, "REFRIGERADO")} textoTransgenico="" textoPorcao="" mostrarSeloAltoEm={false}
    storeLogo="" nomeDaLoja="Loja" cnpj="" endereco="" dados={papel({ tipo: "ABERTO", marca: "Hellmann's", fornecedor: "Atacadão" })} paraVenda={false}
  />,
));
confere("4x6: conservação de refrigerado, sem o texto do congelador", [grande.includes("Manter refrigerado"), grande.includes("Congelador")], [true, false]);
confere("4x6: tipo, data e hora, validade com hora, responsável, lote", [
  grande.includes("PRODUTO ABERTO"), grande.includes("Aberto em: 26/10/2026 14:00"), grande.includes("Validade: 26/10/2026 20:00"),
  grande.includes("Resp.: Maria"), grande.includes("Lote: K7F2M9QX"),
], [true, true, true, true, true]);
confere("4x6: marca e fornecedor no produto aberto", [grande.includes("Marca: Hellmann's"), grande.includes("Fornecedor: Atacadão")], [true, true]);
const venda = texto(renderToStaticMarkup(
  <EtiquetaPapel
    etq={{ code: "", qr: "" }} nomeDoProduto="Esfiha" config={{}} campos={{ ...PADRAO, tabelaNutricional: false }}
    textoConservacao="" textoTransgenico="" textoPorcao="" mostrarSeloAltoEm={false} storeLogo="" nomeDaLoja="" cnpj="" endereco=""
    dados={papel({ comHora: false, venceEm: hora("2026-11-25T23:59") })} paraVenda
  />,
));
confere("4x6 de venda: 'Fabricado em', sem faixa MANIPULADO, validade sem hora", [venda.includes("Fabricado em: 26/10/2026 14:00"), venda.includes("MANIPULADO"), venda.includes("Validade: 25/11/2026 ")], [true, false, true]);
const pequena = texto(renderToStaticMarkup(
  <EtiquetaCompacta
    medidas={TAMANHOS["60x40"]} etq={{ code: "K7F2M9QX", qr: "" }} nomeDoProduto="Arroz temperado" mostrarQr mostrarLote nomeDaLoja=""
    dados={papel({ conservacao: "AMBIENTE", venceEm: hora("2026-10-26T22:00") })} textoConservacao={textoDaConservacaoNoPapel(null, "AMBIENTE")}
  />,
));
confere("60x40: tipo, produto, preparado com hora, validade com hora, conservação, resp. e lote", [
  pequena.includes("MANIPULADO"), pequena.includes("Arroz temperado"), pequena.includes("Preparado em: 26/10/2026 14:00"),
  pequena.includes("VAL: 26/10/2026 22:00"), pequena.includes("temperatura ambiente"), pequena.includes("Resp.: Maria"), pequena.includes("Lote: K7F2M9QX"),
], [true, true, true, true, true, true, true]);
const html60 = renderToStaticMarkup(
  <EtiquetaCompacta medidas={TAMANHOS["60x40"]} etq={{ code: "C", qr: "" }} nomeDoProduto="x" mostrarQr={false} mostrarLote={false} nomeDaLoja="" dados={papel()} textoConservacao="" />,
);
confere("60x40: a folha mede 60 x 40 mm", [html60.includes("width:60mm"), html60.includes("height:40mm")], [true, true]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
