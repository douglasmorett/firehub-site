/**
 * O Caixa de mercado, sem banco (lib/caixa-mercado):
 * - BR Code do Pix: o exemplo oficial do manual do BACEN (CRC 1D3D) e o QR
 *   com valor e txid que o caixa gera;
 * - etiqueta da balança (EAN-13 começando com 2: PLU + preço ou peso);
 * - leitura do campo do código ("3*789…", "0,452*123") e as contas em centavos
 *   (itens, KG, troco, misto, TEF);
 * - XML de NF-e de compra (nfeProc, SEM GTIN, caixa × unidade);
 * - planilha do PDV antigo (CSV Latin-1 com ; e XLSX ida e volta);
 * - agrupamento por NCM, sugestão de tributação e a planilha que o contador devolve;
 * - cobrança de R$ 97 por computador em uso no mês.
 * Roda: DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-caixa-de-mercado.ts
 * (a URL falsa só satisfaz o import do prisma; nada conecta).
 */
import assert from "node:assert/strict";
import { crc16, montarBrCode, novoTxid, textoDoPix, cidadeDoCadastro } from "../src/lib/caixa-mercado/pix-brcode";
import { digitoEan13, eanValido, lerEtiqueta, lerFormatoDaEtiqueta, montarEtiqueta } from "../src/lib/caixa-mercado/etiqueta";
import {
  conferirPagamentos, diferencaDoTurno, esperadoDoTurno, lerEntrada, liquidoPorForma, problemaDaQuantidade, somarItens, valorDoItem,
} from "../src/lib/caixa-mercado/conta";
import { custoDaUnidade, eanDaUnidade, lerNotaDeCompra } from "../src/lib/caixa-mercado/importacao/nfe";
import { lerCsv, lerPlanilha, lerXlsx, lerZip, textoDoArquivo } from "../src/lib/caixa-mercado/importacao/arquivos";
import { lerLinhasDaPlanilha, numeroBrasileiro, sugerirMapeamento } from "../src/lib/caixa-mercado/importacao/planilha";
import { agruparPorNcm, lerPlanilhaDoContador, ncmDaIa, sugestaoDeTributacao, COLUNAS_DO_CONTADOR } from "../src/lib/caixa-mercado/importacao/ncm";
import { montarPlanilha } from "../src/lib/planilha-xlsx";
import { montarZip } from "../src/lib/zip";
import { valorDoTabletNoMes } from "../src/lib/tablet-da-mesa/assinatura";
import { CLAUSULAS_DO_TERMO_DO_CAIXA } from "../src/lib/caixa-mercado/termo";
import { PRECO_POR_COMPUTADOR } from "../src/lib/caixa-mercado/preco";

let n = 0;
const ok = (nome: string, f: () => void) => { f(); n++; console.log(`✅ ${nome}`); };

// ── Pix ──────────────────────────────────────────────────────────────────────
ok("BR Code: exemplo oficial do BACEN (Manual de Padrões para Iniciação do Pix) com CRC 1D3D", () => {
  const esperado = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";
  assert.equal(montarBrCode({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" }), esperado);
  assert.equal(crc16(esperado.slice(0, -4)), "1D3D");
});
ok("BR Code do caixa: valor, txid, estático, nome/cidade sem acento e CRC que confere", () => {
  const c = montarBrCode({ chave: "+5522999627179", nome: "Mercado São João Ltda", cidade: "Cabo Frio", valorCentavos: 1234, txid: "CXABC123", pontoDeIniciacao: "11" });
  assert.match(c, /^000201010211/);
  assert.ok(c.includes("540512.34"));
  assert.ok(c.includes("5921Mercado Sao Joao Ltda"));
  assert.ok(c.includes("6009Cabo Frio"));
  assert.ok(c.includes("62120508CXABC123"));
  assert.equal(crc16(c.slice(0, -4)), c.slice(-4));
  assert.throws(() => montarBrCode({ chave: "x", nome: "a", cidade: "b", valorCentavos: 10.5 }));
  assert.throws(() => montarBrCode({ chave: "x", nome: "a", cidade: "b", txid: "com espaço" }));
  const t = novoTxid();
  assert.match(t, /^CX[A-Z0-9]{18}$/);
  assert.equal(textoDoPix("Açaí & Cia — Ltda.", 25), "Acai Cia Ltda");
  assert.equal(cidadeDoCadastro("Cabo Frio - RJ"), "Cabo Frio");
});

// ── Etiqueta ─────────────────────────────────────────────────────────────────
ok("EAN-13: dígito verificador e validação (EAN-8, 13 e GTIN-14)", () => {
  assert.equal(digitoEan13("789100010010"), 3);
  assert.ok(eanValido("7891000100103"));
  assert.ok(!eanValido("7891000100102"));
  assert.ok(eanValido("96385074"));
  assert.ok(eanValido("17891000100100"));
});
ok("Etiqueta de balança: 2 CCCCC x PPPPP D (preço) e peso; dígito errado não é etiqueta", () => {
  const e = montarEtiqueta(123, 1590);
  assert.equal(e.length, 13);
  assert.match(e, /^200123001590\d$/);
  assert.deepEqual(lerEtiqueta(e), { plu: "123", precoCentavos: 1590, pesoGramas: null });
  const peso = lerFormatoDaEtiqueta({ tipo: "peso", codigoTamanho: 4, valorTamanho: 5 });
  const e2 = montarEtiqueta(45, 752, peso);
  assert.deepEqual(lerEtiqueta(e2, peso), { plu: "45", precoCentavos: null, pesoGramas: 752 });
  const seis = lerFormatoDaEtiqueta({ codigoTamanho: 5, valorTamanho: 6 });
  assert.deepEqual(lerEtiqueta(montarEtiqueta(7, 123456, seis), seis), { plu: "7", precoCentavos: 123456, pesoGramas: null });
  assert.equal(lerEtiqueta(e.slice(0, 12) + ((Number(e[12]) + 1) % 10)), null);
  assert.equal(lerEtiqueta("7891000100103"), null);
  // 6 + 6 não cabe: o formato cai para valor de 5.
  assert.equal(lerFormatoDaEtiqueta({ codigoTamanho: 6, valorTamanho: 6 }).valorTamanho, 5);
});

// ── Contas ───────────────────────────────────────────────────────────────────
ok("Campo do código: quantidade antes do *", () => {
  assert.deepEqual(lerEntrada("7891000100103"), { quantidade: null, codigo: "7891000100103" });
  assert.deepEqual(lerEntrada("3*7891000100103"), { quantidade: 3, codigo: "7891000100103" });
  assert.deepEqual(lerEntrada("0,452*123"), { quantidade: 0.452, codigo: "123" });
  assert.deepEqual(lerEntrada(" 2x 789 "), { quantidade: 2, codigo: "789" });
  assert.equal(lerEntrada("0*123"), null);
  assert.equal(lerEntrada(""), null);
});
ok("Itens em centavos: UN inteiro, KG peso × quilo arredondado", () => {
  assert.equal(valorDoItem("UN", 3, 499), 1497);
  assert.equal(valorDoItem("KG", 0.452, 3990), 1803); // 18,0348 → 18,03
  assert.equal(valorDoItem("KG", 1.2345, 1000), 1235); // 3 casas: 1,235 kg (arredondado em gramas)
  assert.equal(somarItens([{ unidade: "UN", quantidade: 2, precoCentavos: 1099 }, { unidade: "KG", quantidade: 0.5, precoCentavos: 2999 }]), 2198 + 1500);
  assert.ok(problemaDaQuantidade("UN", 1.5));
  assert.equal(problemaDaQuantidade("KG", 1.5), null);
  // 0,1 + 0,2 em reais daria 0,30000000000000004; em centavos é 30.
  assert.equal(somarItens([{ unidade: "UN", quantidade: 1, precoCentavos: 10 }, { unidade: "UN", quantidade: 1, precoCentavos: 20 }]), 30);
});
ok("Pagamentos: troco só do dinheiro, misto, TEF e o que falta", () => {
  assert.deepEqual(conferirPagamentos(4750, [{ forma: "DINHEIRO", valorCentavos: 5000 }]), { ok: true, trocoCentavos: 250, tefCentavos: 0 });
  assert.deepEqual(conferirPagamentos(4750, [{ forma: "DINHEIRO", valorCentavos: 2000 }, { forma: "TEF", valorCentavos: 2750 }]), { ok: true, trocoCentavos: 0, tefCentavos: 2750 });
  const falta = conferirPagamentos(4750, [{ forma: "PIX", valorCentavos: 4000 }]);
  assert.equal(falta.ok, false);
  assert.match((falta as any).erro, /Falta R\$\s?7,50/);
  assert.equal(conferirPagamentos(4750, [{ forma: "PIX", valorCentavos: 5000 }]).ok, false); // Pix não dá troco
  assert.equal(conferirPagamentos(1000, [{ forma: "DINHEIRO", valorCentavos: 500 }, { forma: "PIX", valorCentavos: 1000 }]).ok, false); // dinheiro só de troco
  assert.equal(conferirPagamentos(1000, [{ forma: "TEF", valorCentavos: 500 }, { forma: "TEF", valorCentavos: 500 }]).ok, false);
  assert.deepEqual(liquidoPorForma([{ forma: "DINHEIRO", valorCentavos: 5000 }, { forma: "PIX", valorCentavos: 1000 }], 250), [
    { forma: "DINHEIRO", valorCentavos: 4750 }, { forma: "PIX", valorCentavos: 1000 },
  ]);
});
ok("Turno: esperado na gaveta = fundo + dinheiro + suprimento − sangria; diferença só do que foi contado", () => {
  const esp = esperadoDoTurno(10000, { DINHEIRO: 25000, PIX: 3000 }, [{ tipo: "SANGRIA", valorCentavos: 20000 }, { tipo: "SUPRIMENTO", valorCentavos: 5000 }]);
  assert.deepEqual(esp, { DINHEIRO: 20000, PIX: 3000 });
  assert.equal(diferencaDoTurno(esp, { DINHEIRO: 19800, PIX: null }), -200);
  assert.equal(diferencaDoTurno(esp, { DINHEIRO: null }), null);
});

// ── XML de compra ────────────────────────────────────────────────────────────
const XML = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe33261112345678000199550010000012341000012345" versao="4.00">
<ide><nNF>1234</nNF><dhEmi>2026-11-10T09:00:00-03:00</dhEmi></ide><emit><CNPJ>12345678000199</CNPJ><xNome>DISTRIBUIDORA BOM PRECO LTDA</xNome><xFant>Bom Preço</xFant></emit>
<det nItem="1"><prod><cProd>A1</cProd><cEAN>7891000100103</cEAN><xProd>LEITE UHT INTEGRAL 1L</xProd><NCM>04012010</NCM><CEST>1700100</CEST><CFOP>5405</CFOP><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>60.0000000000</vUnCom><vProd>120.00</vProd><cEANTrib>7891000100103</cEANTrib><uTrib>UN</uTrib><qTrib>24.0000</qTrib></prod><imposto/></det>
<det nItem="2"><prod><cProd>B2</cProd><cEAN>SEM GTIN</cEAN><xProd>BANANA PRATA &amp; CIA</xProd><NCM>08039000</NCM><CFOP>5102</CFOP><uCom>KG</uCom><qCom>10.5000</qCom><vUnCom>4.5000</vUnCom><vProd>47.25</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>KG</uTrib><qTrib>10.5000</qTrib></prod><imposto/></det>
</infNFe></NFe><protNFe><infProt><chNFe>33261112345678000199550010000012341000012345</chNFe></infProt></protNFe></nfeProc>`;
ok("XML de NF-e de compra: chave, emitente, EAN, NCM, CEST, SEM GTIN, custo da unidade", () => {
  const nota = lerNotaDeCompra(XML)!;
  assert.equal(nota.chave, "33261112345678000199550010000012341000012345");
  assert.equal(nota.numero, "1234");
  assert.equal(nota.emitente, "Bom Preço");
  assert.equal(nota.itens.length, 2);
  const [leite, banana] = nota.itens;
  assert.equal(leite.ean, "7891000100103");
  assert.equal(leite.ncm, "04012010");
  assert.equal(leite.cest, "1700100");
  assert.equal(custoDaUnidade(leite), 500); // caixa de 24 a R$ 60 → R$ 5,00 a unidade
  assert.equal(eanDaUnidade(leite), "7891000100103");
  assert.equal(banana.ean, null);
  assert.equal(banana.descricao, "BANANA PRATA & CIA");
  assert.equal(banana.unidade, "KG");
  assert.equal(custoDaUnidade(banana), 450);
  assert.equal(lerNotaDeCompra("<html>não é nota</html>"), null);
});
ok("ZIP com XMLs: o leitor abre o que o lib/zip monta (deflate e stored)", () => {
  const zip = montarZip([{ nome: "nota1.xml", conteudo: XML }, { nome: "leia.txt", conteudo: "x" }]);
  const entradas = lerZip(zip);
  assert.deepEqual(entradas.map((e) => e.nome), ["nota1.xml", "leia.txt"]);
  assert.equal(lerNotaDeCompra(entradas[0].dados.toString("utf8"))!.itens.length, 2);
});

// ── Planilha do PDV antigo ──────────────────────────────────────────────────
ok("CSV do Excel brasileiro (Latin-1, ;, aspas) → mapeamento sugerido e linhas lidas", () => {
  const csv = Buffer.from('Código de Barras;Descrição;Preço Venda;Preço de Custo;Un;NCM;CEST;Estoque\r\n7891000100103;"LEITE UHT ""INTEGRAL"" 1L";5,99;4,10;UN;0401.20.10;17.001.00;120\r\n2000001;Banana prata;4,99;;KG;08039000;;35,5\r\n;   ;1,00;;;;;\r\n7891000100102;Produto com EAN errado;1.234,50;;un;123;;\r\n', "latin1");
  const linhas = lerPlanilha(csv);
  assert.equal(linhas[0][1], "Descrição");
  const mapa = sugerirMapeamento(linhas[0]);
  assert.deepEqual({ codigo: mapa.codigo, descricao: mapa.descricao, preco: mapa.preco, custo: mapa.custo, unidade: mapa.unidade, ncm: mapa.ncm, cest: mapa.cest, estoque: mapa.estoque }, {
    codigo: 0, descricao: 1, preco: 2, custo: 3, unidade: 4, ncm: 5, cest: 6, estoque: 7,
  });
  const { itens, descartadas } = lerLinhasDaPlanilha(linhas, mapa);
  assert.equal(descartadas, 1);
  assert.equal(itens.length, 3);
  assert.deepEqual(
    { d: itens[0].descricao, c: itens[0].codigos, p: itens[0].precoCentavos, custo: itens[0].custoCentavos, ncm: itens[0].ncm, cest: itens[0].cest, e: itens[0].estoque },
    { d: 'LEITE UHT "INTEGRAL" 1L', c: ["7891000100103"], p: 599, custo: 410, ncm: "04012010", cest: "1700100", e: 120 },
  );
  assert.equal(itens[1].unidade, "KG");
  assert.deepEqual(itens[1].codigos, ["2000001"]);
  assert.equal(itens[2].precoCentavos, 123450);
  assert.deepEqual(itens[2].codigos, []);
  assert.equal(itens[2].avisos.length, 2); // EAN com dígito errado e NCM curto
  assert.equal(numeroBrasileiro("R$ 1.234,56"), 1234.56);
  assert.equal(numeroBrasileiro("12.5"), 12.5);
  assert.equal(textoDoArquivo(Buffer.from("﻿abc", "utf8")), "abc");
  assert.deepEqual(lerCsv("a,b\n1,\"x,y\"\n"), [["a", "b"], ["1", "x,y"]]);
});
ok("XLSX: o leitor abre a planilha que o lib/planilha-xlsx monta (NCM com zero à esquerda continua texto)", () => {
  const buf = montarPlanilha([{ nome: "Produtos", linhas: [["EAN", "Descrição", "Preço", "NCM"], ["7891000100103", "Leite & Cia <1L>", 5.99, "04012010"]] }]);
  const linhas = lerXlsx(buf);
  assert.deepEqual(linhas[0], ["EAN", "Descrição", "Preço", "NCM"]);
  assert.deepEqual(linhas[1], ["7891000100103", "Leite & Cia <1L>", "5.99", "04012010"]);
});

// ── NCM e contador ──────────────────────────────────────────────────────────
ok("Sugestão de tributação: Simples (CSOSN 102/500, CFOP 5102/5405, PIS 49) e regime normal (CST, monofásico 04)", () => {
  assert.deepEqual(sugestaoDeTributacao("19053100", null, 1), { cfop: "5102", csosn: "102", pis: "49", cofins: "49", obs: "" });
  const st = sugestaoDeTributacao("22021000", "0300700", 1);
  assert.equal(st.cfop, "5405"); assert.equal(st.csosn, "500");
  const normal = sugestaoDeTributacao("22021000", "0300700", 3);
  assert.equal(normal.csosn, "60"); assert.equal(normal.pis, "04");
  assert.equal(sugestaoDeTributacao("04012010", null, 3).pis, "01");
});
ok("Agrupamento por NCM e a planilha que o contador devolve", () => {
  const { grupos, semNcm } = agruparPorNcm([
    { id: "1", nome: "Coca 2L", ncm: "2202.10.00", cest: "0300700" },
    { id: "2", nome: "Guaraná 2L", ncm: "22021000", cest: "0300700", ncmSugerido: true },
    { id: "3", nome: "Biscoito", ncm: "19053100", cest: null },
    { id: "4", nome: "Coisa", ncm: null, cest: null },
  ], 1);
  assert.equal(grupos.length, 2);
  assert.deepEqual({ ncm: grupos[0].ncm, q: grupos[0].quantidade, cest: grupos[0].cest, ia: grupos[0].sugeridosPelaIa, cfop: grupos[0].sugestao.cfop }, { ncm: "22021000", q: 2, cest: "0300700", ia: 1, cfop: "5405" });
  assert.deepEqual(semNcm.map((p) => p.id), ["4"]);
  const devolvida = [
    [...COLUNAS_DO_CONTADOR],
    ["22021000", "Coca", "2", "03.007.00", "5405", "500", "04", "04", "monofásico"],
    ["1905.31.00", "Biscoito", "1", "", "5102", "102", "49", "49", ""],
    ["123", "x", "1", "", "5102", "102", "49", "49", ""],
    ["04012010", "Leite", "1", "", "6102", "102", "49", "49", ""],
  ];
  const { regras, erros } = lerPlanilhaDoContador(devolvida);
  assert.deepEqual(regras.map((r) => [r.ncm, r.cfop, r.csosn, r.pis, r.cest]), [["22021000", "5405", "500", "04", "0300700"], ["19053100", "5102", "102", "49", null]]);
  assert.equal(erros.length, 2);
  assert.equal(ncmDaIa("2202.10.00"), "22021000");
  assert.equal(ncmDaIa("00000000"), null);
});

// ── Cobrança ─────────────────────────────────────────────────────────────────
ok("Cobrança: R$ 97 por computador com uso no mês, fora dos dias grátis; o termo fala o preço", () => {
  const inicio = new Date("2026-12-01T03:00:00Z"), fim = new Date("2027-01-01T03:00:00Z");
  const trechos = [{ de: "2026-11-20T12:00:00Z", ate: null, valor: PRECO_POR_COMPUTADOR }];
  const usos = [
    { tabletId: "cx1", em: "2026-12-02T15:00:00Z" }, { tabletId: "cx1", em: "2026-12-03T15:00:00Z" },
    { tabletId: "cx2", em: "2026-12-10T15:00:00Z" },
    { tabletId: "cx3", em: "2026-11-25T15:00:00Z" }, // outro mês
  ];
  assert.deepEqual(valorDoTabletNoMes(trechos, "2026-11-27T12:00:00Z", usos, inicio, fim, new Date("2026-12-31T12:00:00Z")), { tablets: 2, valor: 194 });
  // Uso só dentro do teste: nada a cobrar.
  assert.deepEqual(valorDoTabletNoMes(trechos, "2026-12-15T12:00:00Z", usos.slice(0, 3), inicio, fim, new Date("2026-12-31T12:00:00Z")), { tablets: 0, valor: 0 });
  assert.ok(CLAUSULAS_DO_TERMO_DO_CAIXA[0].includes("97,00"));
});

console.log(`\n${n} verificações do Caixa de mercado passaram.`);
