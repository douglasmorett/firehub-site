/**
 * Teste do bairro cadastrado achado no texto do endereço
 * (src/lib/bairro-pelo-endereco.ts) e do acerto do motoboy que usa ele
 * (src/lib/ganho-do-entregador.ts) no pedido de app.
 *
 * As zonas são as da NIK ESFIHAS E PIZZAS (Sobradinho/DF), lidas do banco em
 * 15/10/2026, e os endereços são pedidos reais de iFood, 99Food e Wabiz.
 * A tabela que a loja passou: AR 1–24 = Sobradinho 2 (R$ 7), Mansões 9,
 * Dnoks 9, Q2 = 6, Q1/Q3–Q8 = 5, Q9–Q17 = 6, Q18 = 9.
 *
 * Rodar: npx tsx scripts/teste-bairro-pelo-endereco.ts
 */
import { bairroPeloEndereco, zonasDeBairro, lerApelidos } from "../src/lib/bairro-pelo-endereco";
import { ganhoDoPedido, lerAcerto } from "../src/lib/ganho-do-entregador";
import { lerRegraDeRepasse } from "../src/lib/repasse-do-entregador";
import { normalizarBairros } from "../src/lib/cadastro-da-entrega";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

// Como está no banco hoje (sem apelidos).
const NIK = [{"fee":5,"name":"Quadra 1","time":45,"motoboyFee":5},{"fee":6,"name":"Quadra 2","time":45,"motoboyFee":6},{"fee":5,"name":"Quadra 3","time":45,"motoboyFee":5},{"fee":5,"name":"Quadra 4","time":45,"motoboyFee":5},{"fee":5,"name":"Quadra 5","time":45,"motoboyFee":5},{"fee":5,"name":"Quadra 6","time":45,"motoboyFee":5},{"fee":5,"name":"Quadra 7","time":45,"motoboyFee":5},{"fee":5,"name":"Quadra 8","time":45,"motoboyFee":5},{"fee":6,"name":"Quadra 9 a Quadra 17","time":45,"motoboyFee":6},{"fee":9,"name":"Quadra 18","time":45,"motoboyFee":9},{"fee":7,"name":"Sobradinho 2","time":45,"motoboyFee":7},{"fee":9,"name":"Setor de Mansões","time":45,"motoboyFee":9},{"fee":12,"name":"Império","time":60,"motoboyFee":12},{"fee":9,"name":"Serra Azul e Contagem","time":45,"motoboyFee":9},{"fee":12,"name":"425","time":60,"motoboyFee":12},{"fee":9,"name":"Rezende","time":45,"motoboyFee":9},{"fee":12,"name":"RK","time":60,"motoboyFee":12},{"fee":12,"name":"Grande Colorado e DF","time":60,"motoboyFee":12},{"fee":9,"name":"Dnoks","time":45,"motoboyFee":9},{"fee":12,"name":"Alto da Boa Vista","time":60,"motoboyFee":12},{"fee":13,"name":"Nova Colina","time":60,"motoboyFee":13},{"fee":13,"name":"Condomínio Uberaba","time":60,"motoboyFee":13},{"fee":12,"name":"Condomínio Recanto Real","time":60,"motoboyFee":12},{"fee":12,"name":"Morada dos Nobres","time":60,"motoboyFee":12}];

// Os apelidos sugeridos para a NIK (o JSON a aplicar está no relatório do commit).
const APELIDOS: Record<string, string[]> = {
  "Sobradinho 2": ["AR 1 a AR 24"],
  "Setor de Mansões": ["SMS", "QMS"],
  "Dnoks": ["Dnocs", "SES", "Expansão Econômica"],
  "Grande Colorado e DF": ["DF 150"],
};
const NIK_COM_APELIDOS = NIK.map((z) => (APELIDOS[z.name] ? { ...z, aliases: APELIDOS[z.name] } : z));
const CIDADE = ["BRASILIA DF"];

const nome = (endereco: string, zonas: unknown = NIK_COM_APELIDOS) => bairroPeloEndereco(endereco, zonas, { cidades: CIDADE })?.name ?? null;

// ── Os endereços da tarefa e os do banco ────────────────────────────────────
const casos: [string, string | null][] = [
  // iFood
  ["Q 3, 0 - Ref: Na Loja Dog Do Bartô - Sobradinho - Brasília", "Quadra 3"],
  ["Q. 6 Conjunto H, 34 - Comp: Rua Do Na Hora - Ref: Próximo ao McDonald's - Sobradinho - Brasília", "Quadra 6"],
  ["Q 12 Cl 6, Apt 1 - Comp: sem completo - Ref: Palmeiras pequenas na frente - Sobradinho - Brasília", "Quadra 9 a Quadra 17"],
  ["Q 2 Conjunto D17, 3 - Ref: Atras Da Br - Sobradinho - Brasília", "Quadra 2"],
  ["Q 15 Conjunto A, 22 - Comp: …. - Sobradinho - Brasília", "Quadra 9 a Quadra 17"],
  ["Q 5 Cl, 0 - Comp: Cl 28, Apartamento 02 - Ref: Em Frente Ao Conjunto F Da Quadra 5 - Sobradinho - Brasília", "Quadra 5"],
  ["Q 7, CL, 40 - Comp: Cojunto E Casa 40 - Sobradinho - Brasília", "Quadra 7"],
  ["Quadra 04 Conjunto E Bloco J Apartamento 209, 0 - Sobradinho - Brasília", "Quadra 4"],
  ["Quadra 07, CL, Comércio Local, 204 - Comp: Quadra 7/9 Cl 17 Apt 204 - Ref: Prédio Verde", "Quadra 7"],
  ["Edf Angra dos Reis, 206 - Comp: Quadra 2 Conjunto A comercial - Ref: Salão da Antônia - Sobradinho - Brasília", "Quadra 2"],
  ["Q. 9 Conjunto E, AR 17 - Comp: Apto 102 - Ref: Residencial Vitória - Sobradinho - Brasília", "Quadra 9 a Quadra 17"],
  ["St Mansões Sobradinho Qd 51A Mód G, 6 - Comp: Rua do mercado da Juju - Ref: Prédio em frente - Sobradinho II - Br", "Setor de Mansões"],
  ["SH Mansões Sobradinho Condomínio Sobradinho Novo Q 41, 30 - Comp: QMS 41 Casa 30 - Ref: 5a rua", "Setor de Mansões"],
  ["Ar 7 Conjunto 8, 14 - Comp: casa - Ref: cemitério - Sobradinho - Brasília", "Sobradinho 2"],
  ["Ar 13 Conjunto 2, 10 - Comp: Casa - Sobradinho - Brasília", "Sobradinho 2"],
  ["AR 8, 33 - Comp: Conjunto 1 - Ref: Próximo ao super produtor - Sobradinho 2 - Brasília", "Sobradinho 2"],
  ["Ar 22 Ar 14 Conjunto 1 8, 9 - Comp: Ar 22 Cnj 1 Cs 9 - Sobradinho II - Brasília", "Sobradinho 2"],
  ["Quadra 49, Ap 108 - Comp: Residencial Arnóbio Pereira - Ref: Subindo a rua do mercado FOX - Sobradinho II - Brasília", "Sobradinho 2"],
  ["St. de Expansão Econômica Dnocs Conjunto 15, 12 - Comp: Conjunto 5 casa 12 - Ref: na rua do MP Auto Peças", "Dnoks"],
  ["St. de Expansão Econômica Q 13, 0 - Ref: Ao Lado Da Ferro E Aco Em Frente A Br - Sobradinho - Brasília", "Dnoks"],
  ["Dnocs quadra 3 conjunto 4, Casa 2 - Comp: Descendo entre a rua da paróquia", "Dnoks"],
  ["SMS quadra 47 casa 18a, 18 - Ref: Sentido verde vale - Sobradinho - Brasília", "Setor de Mansões"],
  ["Condomínio Morada dos Nobres Quadra 11, 3 - Comp: Quadra 9 - Sobradinho II - Brasília", "Morada dos Nobres"],
  ["Bloco C, 212 - Comp: Edf Renoir - Ref: Ao lado do churrasquinho do dimi - Sobradinho - Brasília", null],
  ["St. Administrativo, Q. Central, 0 - Comp: Quartel dos bombeiros - Sobradinho - Brasília", null],
  ["R. 3 Sobradinho, o poderoso crepe - Ref: Mercado Sampaio - Brasília", null],
  // Wabiz
  ["Quadra 12, conjunto B, casa 06, 06 - Sobradinho 1 - QUADRA 12 - Brasília/DF - CEP 73010122", "Quadra 9 a Quadra 17"],
  ["SES quadra 13, 20 - Empresa Rezgatte - DNOKS - Brasília/DF - CEP 73040134", "Dnoks"],
  ["Quadra 2 Conjunto A10 Bloco D, SN - AP 501 - QUADRA 2 - Brasília/DF - CEP 73015139", "Quadra 2"],
  ["Quadra central conjunto B bloco D Ap, 307 - Quadra central - QUADRA 6 - Brasília/DF - CEP 73010605", "Quadra 6"],
  ["Ar 19 conjunto 9, 07 - Casa - SOBRADINHO 2 - Brasília/DF - CEP 73063009", "Sobradinho 2"],
  ["Quadra 08 conjunto E, 34 - QUADRA 8 - Brasília/DF - CEP 73005085", "Quadra 8"],
  ["Qd 15 conjunto D casa, 28 - Fundos (faixa verde) - QUADRA 15 - Brasília/DF - CEP 73045154", "Quadra 9 a Quadra 17"],
  ["Edifício Residencial do Bosque, 207 - Edifício Residencial - QUADRA 9 - Brasília/DF - CEP 73035090", "Quadra 9 a Quadra 17"],
  ["Edificio Mirante da Serra, 102 - QUADRA 17 - Brasília/DF - CEP 73046625", "Quadra 9 a Quadra 17"],
  ["Conjunto B-6, S/N - Bl3 Ap105 Ed.Carajas - QUADRA 14 - Brasília/DF - CEP 73050146", "Quadra 9 a Quadra 17"],
  ["Área especial 3, 4 - Nas chácaras - QUADRA 1 - Brasília/DF - CEP 73017017", "Quadra 1"],
  ["Alto da Boa Vista Quadra 106 conjunto 1 casa 37, 37 - ALTO BOA VISTA - Brasília/DF - CEP 73130900", "Alto da Boa Vista"],
  ["Quadra 206 cj 06 casa 52, 52 - ALTO BOA VISTA - Brasília/DF - CEP 73130900", "Alto da Boa Vista"],
  ["Cond. Jardim Europa 1 Qd. 2 Conj. G Casa 06, 06 - GRANDE COLORADO - Brasília/DF - CEP 73105900", "Grande Colorado e DF"],
  ["Quadra 28, 15 A - SERRA AZUL - Brasília/DF - CEP 73070045", "Serra Azul e Contagem"],
  ["QMS 30, 30 - Cond. Mini Chácara - SETOR DE MANSOES - Brasília/DF - CEP 73081525", "Setor de Mansões"],
  ["Es 6a, 11 - SETOR DE MANSOES - Brasília/DF - CEP 73083180", "Setor de Mansões"],
  ["DF 440 Km 3 Condomínio Asa Branca módulo B casa 28, 28 - NOVA COLINA - Brasília/DF - CEP 73271900", "Nova Colina"],
  ["Condominio Rk Antares N 22, 22 - Antares n 22 - RK - Brasília/DF - CEP 73252200", "RK"],
  ["Qd 45 A conj F, 20 - Vale dos pinheiros - SOBRADINHO 2 - Brasília/DF - CEP 73088350", "Sobradinho 2"],
  ["Sobradinho-df, quadra 16, conjunto F, 22 - QUADRA 16 - Brasília/DF - CEP 73050166", "Quadra 9 a Quadra 17"],
  ["df 150 chacara boa esperança, 24 - DF 150 - Brasília/DF - CEP 73105010", "Grande Colorado e DF"],
  ["Df 150 km 3 Condomínio Vivendas Campestre conj D, 16 - DF 150 - Brasília/DF - CEP 73090918", "Grande Colorado e DF"],
  ["⁠sobradinho, 16 - (Qd 5 cj C cs 16 - QUADRA 5 - Brasília/DF - CEP 73030053", "Quadra 5"],
  // 99Food
  ["ar 7, cj 5 LT 18 - Sobradinho II, Sobradinho - DF, Casa cinza na esquina", "Sobradinho 2"],
  ["Qr05 , casa49 - Sobradinho II, Brasília - DF, em frente a Ubs 7", "Sobradinho 2"],
  ["Quadra Central Feira Modelo, 83/84 - Sobradinho, Brasília - DF, box c, Feira Modelo Sobradinho", null],
];
for (const [endereco, esperado] of casos) {
  const achado = nome(endereco);
  conferir(endereco.slice(0, 70), achado === esperado, `esperado ${esperado ?? "nada"}, deu ${achado ?? "nada"}`);
}

// ── Sem apelido, o que já casa só pelo nome ─────────────────────────────────
conferir("sem apelido: Q 3 casa a Quadra 3", nome("Q 3, 0 - Sobradinho - Brasília", NIK) === "Quadra 3");
conferir("sem apelido: DNOKS casa Dnoks", nome("SES quadra 13, 20 - DNOKS - Brasília/DF - CEP 73040134", NIK) === "Dnoks");
conferir("sem apelido: St Mansões casa Setor de Mansões", nome("St Mansões Sobradinho Qd 51A Mód G, 6 - Sobradinho II - Br", NIK) === "Setor de Mansões");
conferir("sem apelido: Sobradinho II casa Sobradinho 2", nome("Quadra 49, Ap 108 - Sobradinho II - Brasília", NIK) === "Sobradinho 2");
conferir("sem apelido: DF 150 não casa (o DF é UF)", nome("df 150 chacara boa esperança, 24 - DF 150 - Brasília/DF - CEP 73105010", NIK) === null);
conferir("sem apelido: Ar 13 (sem região) não casa nada", nome("Ar 13 Conjunto 2, 10 - Comp: Casa - Sobradinho - Brasília", NIK) === null);

// ── Cidade sozinha nunca é bairro ───────────────────────────────────────────
conferir("Brasília/DF não casa", nome("Brasília/DF") === null);
conferir("\"Grande Colorado e DF\": o DF sozinho não casa", nome("Rua 1, 10 - Centro - DF") === null);
conferir("nome só de número (425) só casa o pedaço que é ele", nome("Rua 9, casa 425 - Centro - Brasília") === null && nome("Chácara 3 - 425 - Brasília/DF") === "425");

// ── Loja que não cobra por bairro não casa nada ─────────────────────────────
const FAIXAS = [{ km: 2, fee: 5, motoboyFee: 3, name: "Quadra 3" }, { km: 5, fee: 8 }];
conferir("zonas por km: nada", bairroPeloEndereco("Q 3, 0 - Sobradinho - Brasília", FAIXAS) === null);
conferir("tipo KM declarado: nada", bairroPeloEndereco("Q 3, 0 - Sobradinho - Brasília", NIK, { tipo: "KM" }) === null);
conferir("tipo NEIGHBORHOOD: casa", bairroPeloEndereco("Q 3, 0 - Sobradinho - Brasília", NIK, { tipo: "NEIGHBORHOOD" })?.name === "Quadra 3");
conferir("zonas como texto (JSON serializado)", bairroPeloEndereco("Q 3, 0 - Sobradinho - Brasília", JSON.stringify(NIK))?.name === "Quadra 3");
conferir("zonasDeBairro lê os apelidos", zonasDeBairro(NIK_COM_APELIDOS).find((z) => z.name === "Sobradinho 2")?.aliases?.[0] === "AR 1 a AR 24");
conferir("lerApelidos aceita texto com vírgula e tira repetido", JSON.stringify(lerApelidos({ aliases: "AR, ar , Dnocs" })) === JSON.stringify(["AR", "Dnocs"]));

// O salvar da tela de Entrega não pode apagar os apelidos.
const salvo = normalizarBairros(NIK_COM_APELIDOS) as any;
conferir("normalizarBairros mantém os apelidos",
  JSON.stringify((salvo.zonas || []).find((z: any) => z.name === "Sobradinho 2")?.aliases) === JSON.stringify(["AR 1 a AR 24"]),
  JSON.stringify((salvo.zonas || []).find((z: any) => z.name === "Sobradinho 2")));
conferir("normalizarBairros: bairro sem apelido continua sem a chave", !("aliases" in ((salvo.zonas || []).find((z: any) => z.name === "Quadra 1") || {})));

// ── O acerto: pedido de app pela tabela da loja ─────────────────────────────
const regra = lerRegraDeRepasse({ repasseDoEntregador: { separado: true, marketplace: "TABELA", valorFixoApp: null } });
const diariaMaisTaxa = lerAcerto({ paymentType: "DAILY_PLUS_FEE", dailyRate: 50 });
const ganho = (customerAddress: string, extra: Record<string, unknown> = {}) =>
  ganhoDoPedido({
    acerto: diariaMaisTaxa,
    pedido: { motoboyFee: null, deliveryFee: 6.99, deliveryDistance: null, customerAddress, ...extra },
    regraDaLoja: regra,
    zonas: NIK_COM_APELIDOS,
    ehMarketplace: true,
  });
const ig = (a: { valor: number; origem: string }, valor: number, origem: string) => a.valor === valor && a.origem === origem;

conferir("iFood Q 3 paga 5 pela tabela (não 6,99)", ig(ganho("Q 3, 0 - Ref: Na Loja Dog Do Bartô - Sobradinho - Brasília"), 5, "REGRA_DA_LOJA"), JSON.stringify(ganho("Q 3, 0 - Sobradinho - Brasília")));
conferir("iFood Q 2 paga 6", ig(ganho("Q 2 Conjunto D17, 3 - Sobradinho - Brasília"), 6, "REGRA_DA_LOJA"));
conferir("iFood Q 12 paga 6", ig(ganho("Q 12 Cl 6, Apt 1 - Sobradinho - Brasília"), 6, "REGRA_DA_LOJA"));
conferir("Wabiz QUADRA 18 paga 9", ig(ganho("Quadra 18 conjunto A, 2 - QUADRA 18 - Brasília/DF - CEP 73000000"), 9, "REGRA_DA_LOJA"));
conferir("99Food AR 7 paga 7", ig(ganho("ar 7, cj 5 LT 18 - Sobradinho II, Sobradinho - DF"), 7, "REGRA_DA_LOJA"));
conferir("iFood Mansões paga 9", ig(ganho("St Mansões Sobradinho Qd 51A Mód G, 6 - Sobradinho II - Br"), 9, "REGRA_DA_LOJA"));
conferir("Wabiz DNOKS paga 9", ig(ganho("SES quadra 13, 20 - DNOKS - Brasília/DF - CEP 73040134"), 9, "REGRA_DA_LOJA"));
conferir("endereço sem bairro achado: segue a taxa do cliente, como antes",
  ig(ganho("Bloco C, 212 - Comp: Edf Renoir - Sobradinho - Brasília"), 6.99, "TAXA_DO_CLIENTE"));
conferir("motoboyFee gravado continua vencendo", ig(ganho("Q 3, 0 - Sobradinho - Brasília", { motoboyFee: 4 }), 4, "GRAVADO"));

// O que NÃO muda.
const semTabelaNoApp = lerRegraDeRepasse({ repasseDoEntregador: { separado: true, marketplace: "APP" } });
conferir("marketplace APP: continua a taxa do app",
  ig(ganhoDoPedido({ acerto: diariaMaisTaxa, pedido: { deliveryFee: 6.99, customerAddress: "Q 3, 0 - Sobradinho - Brasília" }, regraDaLoja: semTabelaNoApp, zonas: NIK, ehMarketplace: true }), 6.99, "REGRA_DA_LOJA"));
const naoSeparado = lerRegraDeRepasse({ repasseDoEntregador: { separado: false, marketplace: "TABELA" } });
conferir("loja que não separa o repasse: continua a taxa do cliente",
  ig(ganhoDoPedido({ acerto: diariaMaisTaxa, pedido: { deliveryFee: 6.99, customerAddress: "Q 3, 0 - Sobradinho - Brasília" }, regraDaLoja: naoSeparado, zonas: NIK, ehMarketplace: true }), 6.99, "TAXA_DO_CLIENTE"));
conferir("pedido do site sem motoboyFee: não procura bairro (como antes)",
  ig(ganhoDoPedido({ acerto: diariaMaisTaxa, pedido: { deliveryFee: 5, customerAddress: "Q 3, 0 - Sobradinho - Brasília" }, regraDaLoja: regra, zonas: NIK, ehMarketplace: false }), 5, "TAXA_DO_CLIENTE"));
const porEntrega = lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 4 });
conferir("acordo individual por entrega continua antes da tabela",
  ig(ganhoDoPedido({ acerto: porEntrega, pedido: { deliveryFee: 6.99, customerAddress: "Q 3, 0 - Sobradinho - Brasília" }, regraDaLoja: regra, zonas: NIK, ehMarketplace: true }), 4, "POR_ENTREGA"));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
