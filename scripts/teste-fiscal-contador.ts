/**
 * O pacote do contador (lib/contador-pacote): uma linha e um XML por NOTA,
 * com o valor da NOTA, pela data de EMISSÃO — e o que o contador precisa
 * além das autorizadas (as canceladas com o XML do evento, as inutilizações).
 *
 *   npx tsx scripts/teste-fiscal-contador.ts
 *
 * A parte que decide o conteúdo (`relacaoDoPacote`) é pura. A montagem do zip
 * roda contra um banco FALSO e um Focus FALSO (fetch interceptado) — nada vai
 * ao banco nem à Focus.
 */
// Módulo (e não script global): o `main` daqui não colide com o de outros scripts no tsc.
export {};

process.env.FISCAL_CHAVE = "chave-de-teste-do-contador";
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── Banco e Focus falsos ─────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[] } = { user: [], customerOrder: [] };
const noIntervalo = (v: Date, f: any) =>
  (f.gte == null || v.getTime() >= f.gte.getTime()) && (f.lte == null || v.getTime() <= f.lte.getTime()) && (f.lt == null || v.getTime() < f.lt.getTime());
const casa = (l: Linha, w: any): boolean =>
  Object.entries(w ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((x) => casa(l, x));
    if (k === "createdAt") return noIntervalo(l.createdAt, v);
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(l[k]);
    return l[k] === v;
  });
(globalThis as any).prisma = {
  user: { findUnique: async (a: any) => db.user.find((u) => u.id === a.where.id) ?? null },
  customerOrder: { findMany: async (a: any) => db.customerOrder.filter((o) => casa(o, a.where)).map((o) => structuredClone(o)) },
};
const baixados: string[] = [];
(globalThis as any).fetch = async (url: URL | string, init: any = {}) => {
  const alvo = String(url);
  baixados.push(`${new URL(alvo).host}${new URL(alvo).pathname}${init?.headers?.Authorization ? " (com token)" : ""}`);
  return new Response(`<xml>${new URL(alvo).pathname}</xml>`, { status: 200 });
};

async function main() {
  const { cifrar } = await import("../src/lib/fiscal-credenciais");
  const { enderecoDaFocus, montarPacoteDoContador, relacaoDoPacote } = await import("../src/lib/contador-pacote");

  const periodo = { inicio: new Date("2026-09-01T03:00:00.000Z"), fim: new Date("2026-10-01T02:59:59.999Z") };
  const setembro = (dia: number, hora = 15) => new Date(Date.UTC(2026, 8, dia, hora));
  const xml = (n: string) => `https://api.focusnfe.com.br/arquivos/${n}.xml`;
  let seq = 0;
  const pedido = (p: Partial<Linha>): Linha => ({
    id: `p${++seq}`, dailyOrderNumber: seq, createdAt: setembro(10), totalAmount: 30, paymentMethod: "Pix",
    deliveryType: "RETIRADA", customerName: "Cliente", customerCpfCnpj: null, status: "ENTREGUE", fiscalStatus: "PENDING", fiscalInfo: null, ...p,
  });

  // A conta da mesa: UMA nota (chave KM) gravada em três pedidos; vNF 81 (com o desconto da conta), pedidos somam 90.
  const conta = { nfceKey: "KM", nfceNumber: 10, serie: 1, protocol: "P10", emittedAt: setembro(10, 23).toISOString(), ambiente: 1, xmlUrl: xml("KM"), valorDaNota: 81, formaNaNota: "Pix", idDaNota: "mesa-S1", notaDaConta: { pedidos: ["m1", "m2", "m3"] } };
  const mesa = ["m1", "m2", "m3"].map((id) => pedido({ id, deliveryType: "MESA", totalAmount: 30, fiscalStatus: "EMITTED", fiscalInfo: conta }));
  // iFood: totalAmount 20,99 com a taxa de serviço; a nota vale 20.
  const ifood = pedido({ totalAmount: 20.99, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KI", nfceNumber: 11, serie: 1, emittedAt: setembro(12).toISOString(), ambiente: 1, xmlUrl: xml("KI"), valorDaNota: 20 } });
  // Pedido cancelado pelo parceiro DEPOIS da nota: a nota vale até ser cancelada na SEFAZ.
  const canceladoDepois = pedido({ status: "CANCELADO", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KX", nfceNumber: 12, serie: 1, emittedAt: setembro(13).toISOString(), ambiente: 1, xmlUrl: xml("KX"), valorDaNota: 30 } });
  // Nota cancelada pela loja e REEMITIDA: a nova no fiscalInfo, a cancelada em notasAnteriores.
  const reemitido = pedido({
    fiscalStatus: "EMITTED",
    fiscalInfo: {
      nfceKey: "KN", nfceNumber: 14, serie: 1, emittedAt: setembro(14, 16).toISOString(), ambiente: 1, xmlUrl: xml("KN"), valorDaNota: 30, idDaNota: "p-2",
      notasAnteriores: [{ nfceKey: "KV", nfceNumber: 13, serie: 1, emittedAt: setembro(14).toISOString(), ambiente: 1, xmlUrl: xml("KV"), xmlCancelamentoUrl: xml("KV-canc"), canceladaEm: setembro(14, 15).toISOString(), valorDaNota: 30 }],
    },
  });
  // Nota cancelada sem reemissão: CANCELED no próprio pedido (é venda sem nota também).
  const soCancelada = pedido({ fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "KS", nfceNumber: 15, serie: 1, emittedAt: setembro(15).toISOString(), ambiente: 1, xmlUrl: xml("KS"), xmlCancelamentoUrl: xml("KS-canc"), valorDaNota: 25 } });
  // Emitida em homologação: fica fora, e o pedido conta como sem nota.
  const teste = pedido({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KT", ambiente: 2, emittedAt: setembro(16).toISOString() } });
  // Pedido de 31/08 cuja nota saiu em 01/09 (conta fechada depois da meia-noite): é de SETEMBRO.
  const virada = pedido({ createdAt: new Date("2026-09-01T02:30:00.000Z"), fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KV1", nfceNumber: 9, serie: 1, emittedAt: new Date("2026-09-01T03:10:00.000Z").toISOString(), ambiente: 1, xmlUrl: xml("KV1"), valorDaNota: 50 } });
  // Pedido de 30/09 com a nota emitida em 01/10: vai no pacote de outubro — e não é "sem nota".
  const outubro = pedido({ createdAt: setembro(30, 23), fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KO", nfceNumber: 16, serie: 1, emittedAt: new Date("2026-10-01T04:00:00.000Z").toISOString(), ambiente: 1, xmlUrl: xml("KO"), valorDaNota: 40 } });
  const semNota = pedido({ totalAmount: 12 });
  const semNotaCancelado = pedido({ status: "CANCELADO", totalAmount: 99 });
  // XML com endereço adulterado: o token da loja não pode sair para outro host.
  const adulterado = pedido({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "KA", nfceNumber: 17, serie: 1, emittedAt: setembro(17).toISOString(), ambiente: 1, xmlUrl: "https://ladrao.exemplo.com/roubar.xml", valorDaNota: 10 } });

  const todos = [...mesa, ifood, canceladoDepois, reemitido, soCancelada, teste, virada, outubro, semNota, semNotaCancelado, adulterado];
  const inutilizacoes = [
    { serie: 1, numeroInicial: 5, numeroFinal: 6, protocolo: "PI", homologadaEm: setembro(20).toISOString(), justificativa: "salto de numeração", ambiente: 1, xmlUrl: xml("inut") },
    { serie: 1, numeroInicial: 1, numeroFinal: 1, protocolo: "PT", homologadaEm: setembro(20).toISOString(), justificativa: "teste", ambiente: 2, xmlUrl: xml("inut-teste") },
  ];

  console.log("\n— relacaoDoPacote —");
  const r = relacaoDoPacote(todos as any, periodo, inutilizacoes);
  const porChave = Object.fromEntries(r.notas.map((n) => [n.chave, n]));
  confere(
    "uma linha por NOTA: a da conta da mesa aparece uma vez, com os três pedidos",
    [r.notas.filter((n) => n.chave === "KM").length, porChave.KM?.pedidos],
    [1, "#1, #2, #3"]
  );
  confere("valor da NOTA, não a soma dos pedidos (81 com o desconto da conta; iFood 20 sem a taxa de serviço)", [porChave.KM?.valor, porChave.KI?.valor], [81, 20]);
  confere("pedido cancelado depois da nota: a nota continua no pacote (autorizada)", porChave.KX?.situacao, "Autorizada");
  confere(
    "cancelada substituída por reemissão: vem de notasAnteriores, cancelada, com o XML do evento",
    [porChave.KV?.situacao, porChave.KV?.xmlCancelamentoUrl, porChave.KN?.situacao],
    ["Cancelada", xml("KV-canc"), "Autorizada"]
  );
  confere("cancelada sem reemissão: entra como cancelada", [porChave.KS?.situacao, porChave.KS?.xmlCancelamentoUrl], ["Cancelada", xml("KS-canc")]);
  confere("homologação fica fora e é contada", [Boolean(porChave.KT), r.notasDeTesteIgnoradas], [false, 1]);
  confere("pela data de EMISSÃO: a da virada do mês entra, a emitida em outubro não", [Boolean(porChave.KV1), Boolean(porChave.KO)], [true, false]);
  confere(
    "sem nota: o sem nota, o de homologação e o de nota cancelada; não o cancelado sem nota nem o que tem nota em outubro",
    r.semNota.map((p) => p.id).sort(),
    [semNota.id, soCancelada.id, teste.id].sort()
  );
  confere("inutilizações do período, só de produção", r.inutilizacoes.map((i) => [i.numeroInicial, i.numeroFinal, i.protocolo]), [[5, 6, "PI"]]);

  console.log("\n— só a Focus recebe o token —");
  confere(
    "enderecoDaFocus: https nos dois servidores da Focus; nada mais",
    ["https://api.focusnfe.com.br/a.xml", "https://homologacao.focusnfe.com.br/a.xml", "http://api.focusnfe.com.br/a.xml", "https://ladrao.exemplo.com/a.xml", "https://api.focusnfe.com.br.ladrao.com/a.xml", "lixo"].map((u) => Boolean(enderecoDaFocus(u))),
    [true, true, false, false, false, false]
  );

  console.log("\n— montarPacoteDoContador (banco e Focus falsos) —");
  db.user.push({ id: "loja", storeName: "Loja Teste", name: "Dono", fiscalConfig: { ambiente: 1, tokens: { producao: cifrar("TOKEN-P") }, inutilizacoes } });
  db.customerOrder.push(...todos.map((p) => ({ ...p, franchiseeId: "loja" })));
  const pacote = await montarPacoteDoContador("loja", { de: "2026-09-01", ate: "2026-09-30" }, periodo);
  const nomes = pacote.arquivos.map((a) => a.nome);
  confere("o XML da nota da conta sai UMA vez", nomes.filter((n) => n === "xml/KM.xml").length, 1);
  confere(
    "vão os XMLs das notas, dos eventos de cancelamento e da inutilização",
    ["xml/KV-cancelamento.xml", "xml/KS-cancelamento.xml", "xml/inutilizacao-serie1-5-a-6.xml", "inutilizacoes.csv"].map((n) => nomes.includes(n)),
    [true, true, true, true]
  );
  confere("o endereço adulterado não recebeu o token (nem foi chamado)", baixados.some((b) => b.startsWith("ladrao.exemplo.com")), false);
  confere("…e conta como XML que não baixou", pacote.resumo.xmlsQueNaoBaixaram, 1);
  confere(
    "resumo: autorizadas, valor das que valem, canceladas à parte, sem nota",
    [pacote.resumo.notas, pacote.resumo.valorDasNotas, pacote.resumo.notasCanceladas, pacote.resumo.pedidosSemNota, pacote.resumo.inutilizacoes],
    // KM 81 + KI 20 + KX 30 + KN 30 + KV1 50 + KA 10 = 221; canceladas KV e KS.
    [6, 221, 2, 3, 1]
  );
  const relacao = String(pacote.arquivos.find((a) => a.nome === "relacao-de-notas.csv")?.conteudo || "");
  confere("a relação traz a situação e o valor da nota", [relacao.includes(";Cancelada;"), relacao.includes(";81,00"), relacao.split("\r\n").length - 1], [true, true, 8]);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
