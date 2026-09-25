/**
 * O cadastro da entrega (src/lib/cadastro-da-entrega.ts): faixas de km,
 * bairros e áreas, como o /api/store-settings valida antes de gravar e como a
 * tela de Entrega confere antes de mandar.
 *
 *   npx tsx scripts/teste-cadastro-da-entrega.ts
 *
 * A tabela de referência é a da Divinos Burger (Cabo Frio, modo ROTA), em km
 * de rua: taxa ao cliente • repasse ao motoboy.
 */
import {
  lerValorDigitado,
  tipoDeCobranca,
  ehCobrancaPorDistancia,
  normalizarFaixasDeKm,
  normalizarBairros,
  normalizarAreas,
  normalizarCadastroDeEntrega,
  faixaDaDistancia,
  repasseDescontado,
  mesmoCadastro,
  cadastroParaGravar,
  mesclarRegraDeRepasse,
  previaDaTabelaDaTela,
  lerZonasGravadas,
  escolhaDoRepasseParaGravar,
  repasseNaTelaDepoisDeLer,
  repasseNaAbertura,
  listaDoAviso,
  type FaixaDeKm,
} from "../src/lib/cadastro-da-entrega";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; return; }
  falhas++;
  console.log(`✖ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`);
}

// ── Número digitado ────────────────────────────────────────────────────────
confere("vírgula decimal", lerValorDigitado("1,5") === 1.5);
confere("ponto decimal", lerValorDigitado("1.5") === 1.5);
confere("R$ e espaços", lerValorDigitado(" R$ 5,00 ") === 5);
confere("milhar com ponto e decimal com vírgula", lerValorDigitado("1.234,50") === 1234.5);
confere("vazio é nulo, não zero", lerValorDigitado("") === null && lerValorDigitado("   ") === null);
confere("zero é zero", lerValorDigitado("0") === 0 && lerValorDigitado(0) === 0);
confere("lixo é nulo", lerValorDigitado("abc") === null && lerValorDigitado("1e5") === null && lerValorDigitado(true) === null);
confere("meio digitado: '1,' e ',5'", lerValorDigitado("1,") === 1 && lerValorDigitado(",5") === 0.5);
confere("NaN é nulo", lerValorDigitado(Number.NaN) === null && lerValorDigitado(null) === null && lerValorDigitado(undefined) === null);

// ── Tipo ───────────────────────────────────────────────────────────────────
confere("tipo em minúscula", tipoDeCobranca("rota") === "ROTA");
confere("tipo inventado", tipoDeCobranca("GALAXIA") === null && tipoDeCobranca(null) === null);
confere("ROTA, KM, RADIUS e DISTANCE são por distância", ["ROTA", "KM", "RADIUS", "DISTANCE"].every(ehCobrancaPorDistancia));
confere("bairro e desenho não são por distância", !ehCobrancaPorDistancia("NEIGHBORHOOD") && !ehCobrancaPorDistancia("POLIGONO"));

// ── A tabela real da Divinos, digitada fora de ordem e com vírgula ─────────
const DIVINOS = [
  [1, 5, 4], [1.5, 8, 7], [2, 10, 9], [2.5, 12, 11], [3, 15, 14],
  [3.5, 17, 16], [4, 18, 17], [4.5, 19, 18], [5, 20, 19],
];
const digitada = [...DIVINOS].reverse().map(([km, fee, moto], i) => ({
  km: String(km).replace(".", ","), fee: `${fee},00`, motoboyFee: String(moto), time: String(30 + i),
}));
const divinos = normalizarFaixasDeKm(digitada);
confere("Divinos: 9 faixas válidas", divinos.ok && divinos.zonas.length === 9, divinos.erros);
confere("Divinos: em ordem crescente de km", divinos.zonas.map((z) => z.km).join("|") === "1|1.5|2|2.5|3|3.5|4|4.5|5");
confere("Divinos: taxa e repasse viram número", divinos.zonas[1].fee === 8 && divinos.zonas[1].motoboyFee === 7);
confere("Divinos: sem aviso (tabela crescente)", divinos.avisos.length === 0, divinos.avisos);

// ── Km ─────────────────────────────────────────────────────────────────────
const comKm = (kms: unknown[]) => normalizarFaixasDeKm(kms.map((km) => ({ km, fee: 5, time: 30 })));
confere("km zero é erro", !comKm([0]).ok && comKm([0]).problemas[0].campo === "km");
confere("km negativo é erro", !comKm([-1]).ok);
confere("km vazio é erro", !comKm([""]).ok);
confere("km absurdo é erro", !comKm([150]).ok);
const repetida = comKm([2, "2,00", 3]);
confere("km repetido é erro, apontando a SEGUNDA", !repetida.ok && repetida.problemas.some((p) => p.campo === "km" && p.indice === 1));
confere("km arredondado a 0,01", comKm([1.234]).zonas[0].km === 1.23);
confere("lista vazia é erro (sem faixa = atende o mundo)", !normalizarFaixasDeKm([]).ok && !normalizarFaixasDeKm(null).ok);
confere("mais de 50 faixas é erro", !comKm(Array.from({ length: 51 }, (_, i) => i + 1)).ok);
confere("nomes antigos maxKm/radius viram km", (() => {
  const r = normalizarFaixasDeKm([{ maxKm: 2, fee: 5, time: 30 }, { radius: 4, fee: 7, time: 40 }]);
  return r.ok && r.zonas[0].km === 2 && r.zonas[1].km === 4 && !("maxKm" in r.zonas[0]) && !("radius" in r.zonas[1]);
})());
confere("campo desconhecido não é gravado", (() => {
  const r = normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, qualquer: "coisa", __proto_x: 1 }]);
  return r.ok && Object.keys(r.zonas[0]).sort().join(",") === "fee,km,time";
})());
confere("faixa que não é objeto é erro", !normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30 }, "lixo"]).ok);

// ── Taxa ───────────────────────────────────────────────────────────────────
confere("taxa zero vale (entrega grátis é decisão da loja)", normalizarFaixasDeKm([{ km: 1, fee: 0, time: 30 }]).ok);
confere("taxa negativa é erro", !normalizarFaixasDeKm([{ km: 1, fee: -2, time: 30 }]).ok);
confere("taxa vazia é erro", !normalizarFaixasDeKm([{ km: 1, fee: "", time: 30 }]).ok);
confere("taxa de R$ 600 é erro (vírgula esquecida)", !normalizarFaixasDeKm([{ km: 1, fee: 600, time: 30 }]).ok);
const descendo = normalizarFaixasDeKm([{ km: 1, fee: 12, time: 30 }, { km: 2, fee: 10, time: 45 }]);
confere("taxa menor numa faixa mais longe: aviso, não erro", descendo.ok && descendo.problemas.some((p) => p.codigo === "TAXA_MENOR_QUE_A_ANTERIOR" && p.indice === 1));

// ── Tempo ──────────────────────────────────────────────────────────────────
confere("tempo zero é erro", !normalizarFaixasDeKm([{ km: 1, fee: 5, time: 0 }]).ok);
confere("tempo vazio é erro", !normalizarFaixasDeKm([{ km: 1, fee: 5 }]).ok);
confere("tempo vira minuto inteiro", normalizarFaixasDeKm([{ km: 1, fee: 5, time: "30,4" }]).zonas[0].time === 30);

// ── Repasse ao motoboy (R6) ────────────────────────────────────────────────
const misturada = normalizarFaixasDeKm([
  { km: 1, fee: 5, time: 30, motoboyFee: 4 },
  { km: 2, fee: 10, time: 30 },
  { km: 3, fee: 15, time: 30, motoboyFee: "" },
  { km: 4, fee: 18, time: 30, motoboyFee: 17 },
]);
const faltando = misturada.problemas.filter((p) => p.codigo === "REPASSE_FALTANDO").map((p) => p.indice).join(",");
confere("faixa sem repasse no meio de faixas com repasse é erro, nas faixas certas", !misturada.ok && faltando === "1,2", faltando);
const nenhuma = normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, motoboyFee: "" }, { km: 2, fee: 8, time: 30, motoboyFee: null }]);
confere("nenhuma com repasse: vale, e não grava motoboyFee", nenhuma.ok && nenhuma.zonas.every((z) => !("motoboyFee" in z)));
const zero = normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, motoboyFee: 0 }, { km: 2, fee: 8, time: 30, motoboyFee: "0" }]);
confere("repasse ZERO é valor, não ausência", zero.ok && zero.zonas.every((z) => z.motoboyFee === 0));
confere("repasse negativo é erro", !normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, motoboyFee: -1 }]).ok);
const acima = normalizarFaixasDeKm([{ km: 1, fee: 0, time: 30, motoboyFee: 4 }]);
confere("motoboy acima da taxa sem confirmação é erro", !acima.ok && acima.problemas.some((p) => p.codigo === "REPASSE_ACIMA_DA_TAXA"));
const confirmada = normalizarFaixasDeKm([{ km: 1, fee: 0, time: 30, motoboyFee: 4, repasseAcimaDaTaxa: true }]);
confere("motoboy acima da taxa confirmado vale e guarda a confirmação", confirmada.ok && confirmada.zonas[0].repasseAcimaDaTaxa === true);
const confirmacaoSobrando = normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, motoboyFee: 4, repasseAcimaDaTaxa: true }]);
confere("confirmação sem motivo não é gravada", confirmacaoSobrando.ok && !("repasseAcimaDaTaxa" in confirmacaoSobrando.zonas[0]));
confere("repasse igual à taxa não pede confirmação", normalizarFaixasDeKm([{ km: 1, fee: 5, time: 30, motoboyFee: 5 }]).ok);

// ── Bairros ────────────────────────────────────────────────────────────────
const bairros = normalizarBairros([
  { name: " Centro ", fee: "5", time: 30 },
  { name: "", fee: 7, time: 40 },
  { name: "Jardim  Esperança", fee: 8, time: 45 },
]);
confere("bairro sem nome sai com aviso, sem travar", bairros.ok && bairros.zonas.length === 2 && bairros.problemas.some((p) => p.codigo === "SEM_NOME_IGNORADO" && p.indice === 1));
confere("nome do bairro limpo e ordem preservada", bairros.zonas[0].name === "Centro" && bairros.zonas[1].name === "Jardim Esperança");
const bairroRepetido = normalizarBairros([{ name: "São Cristóvão", fee: 5, time: 30 }, { name: "sao cristovao", fee: 6, time: 30 }]);
confere("bairro repetido (acento e caixa) é erro", !bairroRepetido.ok && bairroRepetido.problemas.some((p) => p.campo === "name" && p.indice === 1));
confere("lista só com linha em branco é erro", !normalizarBairros([{ name: "", fee: 5, time: 30 }]).ok);
const bairroMisto = normalizarBairros([{ name: "A", fee: 5, time: 30, motoboyFee: 4 }, { name: "", fee: 1, time: 1 }, { name: "B", fee: 6, time: 30 }]);
confere("bairro sem repasse aponta o índice da lista que entrou", !bairroMisto.ok && bairroMisto.problemas.some((p) => p.codigo === "REPASSE_FALTANDO" && p.indice === 2));

// ── Áreas desenhadas ───────────────────────────────────────────────────────
const tri = [[-22.85, -42.03], [-22.86, -42.02], [-22.84, -42.01]];
const areas = normalizarAreas([
  { nome: "Centro", pontos: tri, fee: 5, time: 30, motoboyFee: 4 },
  { nome: "Praia", pontos: JSON.stringify(tri.map(([lat, lng]) => ({ lat, lng }))), fee: 7, time: 40, repasse: 6 },
]);
confere("área: pontos em objeto/texto viram [lat,lng]", areas.ok && areas.zonas[1].pontos.length === 3 && areas.zonas[1].pontos[0][0] === -22.85, areas.erros);
confere("área: motoboyFee vira `repasse`", areas.zonas[0].repasse === 4 && !("motoboyFee" in areas.zonas[0]));
confere("área com 2 pontos é erro", !normalizarAreas([{ nome: "X", pontos: tri.slice(0, 2), fee: 5, time: 30 }]).ok);
confere("nenhuma área é erro", !normalizarAreas([]).ok);

// ── O cadastro pelo tipo ───────────────────────────────────────────────────
confere("tipo desconhecido é erro", !normalizarCadastroDeEntrega("XYZ", []).ok);
const pelaRota = normalizarCadastroDeEntrega("rota", JSON.stringify([{ km: 2, fee: 5, time: 30 }]));
confere("ROTA com cadastro em texto: lido e gravado como lista", pelaRota.ok && pelaRota.tipo === "ROTA" && Array.isArray(pelaRota.zonas));
confere("KM com lista de bairros é erro (sem km)", !normalizarCadastroDeEntrega("KM", [{ name: "Centro", fee: 5, time: 30 }]).ok);
confere("NEIGHBORHOOD valida bairros", normalizarCadastroDeEntrega("NEIGHBORHOOD", [{ name: "Centro", fee: 5, time: 30 }]).ok);

// ── A faixa da distância (R5) ──────────────────────────────────────────────
const tabela: FaixaDeKm[] = divinos.zonas;
const f = (km: number) => faixaDaDistancia(tabela, km);
confere("1,00 km cai na faixa de 1 km (limite inclusivo)", f(1).faixa?.km === 1 && f(1).faixa?.fee === 5);
confere("1,004 km arredonda para 1,00", f(1.004).faixa?.km === 1);
confere("1,01 km cai na faixa de 1,5 km", f(1.01).faixa?.km === 1.5 && f(1.01).faixa?.fee === 8);
confere("0 km cai na primeira faixa (sem km mínimo)", f(0).resultado === "ATENDE" && f(0).faixa?.km === 1);
confere("2,5 km cai na de 2,5 (inclusivo)", f(2.5).faixa?.km === 2.5 && f(2.5).faixa?.motoboyFee === 11);
confere("5,05 km ainda atende na última (folga de 50 m)", f(5.05).resultado === "ATENDE" && f(5.05).faixa?.km === 5 && f(5.05).naFolga);
confere("5,06 km é FORA", f(5.06).resultado === "FORA" && f(5.06).faixa === null);
confere("4,99 km cai na de 5 km sem folga", f(4.99).faixa?.km === 5 && !f(4.99).naFolga);
confere("a folga é só na última: 1,04 km NÃO fica na de 1 km", f(1.04).faixa?.km === 1.5);
const semRepasseNaDe2 = faixaDaDistancia([{ km: 1, fee: 5, motoboyFee: 4 }, { km: 2, fee: 10 }, { km: 3, fee: 15, motoboyFee: 14 }], 1.8);
confere("faixa sem repasse devolve nulo, não o da faixa seguinte (R6)", semRepasseNaDe2.faixa?.km === 2 && semRepasseNaDe2.faixa?.motoboyFee === null);
confere("repasse zero é zero", faixaDaDistancia([{ km: 1, fee: 0, motoboyFee: 0 }], 0.5).faixa?.motoboyFee === 0);
confere("sem faixa nenhuma", faixaDaDistancia([], 1).resultado === "SEM_FAIXA");

// ── Atalho "taxa − R$ X" ───────────────────────────────────────────────────
confere("taxa − R$ 1", repasseDescontado(5, 1) === 4 && repasseDescontado(20, 1) === 19);
confere("atalho nunca negativo", repasseDescontado(0.5, 1) === 0);
confere("atalho sem ponto flutuante torto", repasseDescontado(12.3, 0.1) === 12.2);
confere("atalho aplicado na Divinos reproduz a tabela real",
  DIVINOS.every(([, fee, moto]) => repasseDescontado(fee, 1) === moto));

// ── Mesmo cadastro (para não revalidar o que não mudou) ────────────────────
confere("chaves em outra ordem é o mesmo cadastro",
  mesmoCadastro([{ km: 1, fee: 5, time: 30 }], [{ time: 30, fee: 5, km: 1 }]));
confere("valor diferente não é o mesmo", !mesmoCadastro([{ km: 1, fee: 5, time: 30 }], [{ km: 1, fee: 6, time: 30 }]));
confere("texto JSON e lista são o mesmo", mesmoCadastro(JSON.stringify([{ km: 1 }]), [{ km: 1 }]));
confere("nulo e nulo", mesmoCadastro(null, null) && !mesmoCadastro(null, []));

// ── O que o /api/store-settings grava ──────────────────────────────────────
const gravadoDivinos = { tipo: "ROTA", zonas: [{ km: 1, fee: 5, time: 30 }, { km: 3, fee: 8, time: 45 }, { km: 5, fee: 12, time: 60 }] };
confere("corpo sem tipo nem zonas: mantém", cadastroParaGravar(gravadoDivinos, {}).acao === "manter");
confere("zonas nulas NÃO apagam (sem área = atende o mundo)", cadastroParaGravar(gravadoDivinos, { deliveryZones: null, deliveryZoneType: null }).acao === "manter");
confere("tipo vazio não conta como troca", cadastroParaGravar(gravadoDivinos, { deliveryZoneType: "" }).acao === "manter");
confere("mesmo cadastro com chaves em outra ordem: mantém (Salvar Tudo)",
  cadastroParaGravar(gravadoDivinos, { deliveryZoneType: "rota", deliveryZones: gravadoDivinos.zonas.map((z) => ({ time: z.time, fee: z.fee, km: z.km })) }).acao === "manter");
const legadoInvalido = { tipo: "KM", zonas: [{ km: 0, fee: 5, time: 30 }, { km: 3, fee: 8, time: 0 }] };
confere("cadastro antigo inválido reenviado igual: mantém, não trava o salvar do resto",
  cadastroParaGravar(legadoInvalido, { deliveryZoneType: "KM", deliveryZones: legadoInvalido.zonas }).acao === "manter");
const novaTabela = cadastroParaGravar(gravadoDivinos, { deliveryZoneType: "ROTA", deliveryZones: digitada });
confere("tabela nova válida: grava normalizada", novaTabela.acao === "gravar" && novaTabela.zonas.length === 9 && (novaTabela.zonas[0] as FaixaDeKm).km === 1);
const recusada = cadastroParaGravar(gravadoDivinos, { deliveryZoneType: "ROTA", deliveryZones: [{ km: 2, fee: 5, time: 30 }, { km: 2, fee: 6, time: 30 }] });
confere("tabela com km repetido: recusa com mensagem", recusada.acao === "recusar" && /2 km/.test(recusada.erro));
const trocaDeTipo = cadastroParaGravar({ tipo: "NEIGHBORHOOD", zonas: [{ name: "Centro", fee: 5, time: 30 }] }, { deliveryZoneType: "ROTA" });
confere("trocar só o tipo valida as zonas gravadas contra o tipo novo (bairro não vira faixa)", trocaDeTipo.acao === "recusar");
confere("loja nova com zonas mas sem tipo: tipo desconhecido é recusado",
  cadastroParaGravar({ tipo: null, zonas: null }, { deliveryZones: [{ km: 1, fee: 5, time: 30 }] }).acao === "recusar");
confere("RADIUS gravado e KM mandado com as mesmas faixas: grava (troca o nome do tipo)",
  cadastroParaGravar({ tipo: "RADIUS", zonas: [{ km: 2, fee: 5, time: 30 }] }, { deliveryZoneType: "KM", deliveryZones: [{ km: 2, fee: 5, time: 30 }] }).acao === "gravar");

// ── Regra de repasse: cada tela manda só o que decide ──────────────────────
const regraGravada = { separado: false, marketplace: "FIXO", valorFixoApp: 4, extraDeOutraVersao: "fica" };
const daTelaDeEntrega = mesclarRegraDeRepasse(regraGravada, { separado: true });
confere("tela de Entrega liga o separado sem mexer na regra do app",
  daTelaDeEntrega.separado === true && daTelaDeEntrega.marketplace === "FIXO" && daTelaDeEntrega.valorFixoApp === 4 && daTelaDeEntrega.extraDeOutraVersao === "fica");
const daAbaMotoboys = mesclarRegraDeRepasse({ separado: false, marketplace: "TABELA", valorFixoApp: null }, { marketplace: "APP", valorFixoApp: "abc" });
confere("aba Motoboys NÃO liga o separado (era o defeito: separado:true em todo clique)", daAbaMotoboys.separado === false && daAbaMotoboys.marketplace === "APP");
confere("valor fixo inválido vira nulo", daAbaMotoboys.valorFixoApp === null);
confere("valor fixo zero é zero", mesclarRegraDeRepasse({}, { marketplace: "FIXO", valorFixoApp: 0 }).valorFixoApp === 0);
confere("valor fixo ausente mantém o gravado", mesclarRegraDeRepasse(regraGravada, { marketplace: "TABELA" }).valorFixoApp === 4);
confere("separado ligado continua ligado quando a aba Motoboys salva", mesclarRegraDeRepasse({ separado: true }, { marketplace: "APP" }).separado === true);
confere("sem nada gravado: padrão desligado/TABELA", (() => {
  const r = mesclarRegraDeRepasse(null, {});
  return r.separado === false && r.marketplace === "TABELA" && r.valorFixoApp === null;
})());

// ── Prévia do simulador com a tabela da tela (revisão do cluster D) ────────
//
// Loja ROTA com a tabela salva 1/3/5 km estende na tela para 6 km R$ 14 e 7 km
// R$ 16. O servidor só vai à rua até a última faixa SALVA (5 + 0,05 km): um
// endereço a 5,5 km em linha reta (≈ 7,7 km pela rua) volta em linha reta.
const tabelaDaTela = [
  { km: 1, fee: 5, time: 30 }, { km: 3, fee: 8, time: 45 }, { km: 5, fee: 12, time: 60 },
  { km: 6, fee: 14, time: 70 }, { km: 7, fee: 16, time: 80 },
];
{
  const p = previaDaTabelaDaTela("ROTA", { distanceKm: 5.5, medida: "linha-reta", available: false } as any, tabelaDaTela, false);
  confere("ROTA com linha reta dentro da tabela da tela: NÃO mostra faixa (era 'até 6 km — R$ 14')",
    p?.tipo === "sem-previa" && p.motivo === "SEM_MEDIDA_PELA_RUA", p);
  const longe = previaDaTabelaDaTela("ROTA", { distanceKm: 7.5, medida: "linha-reta" }, tabelaDaTela, false);
  confere("ROTA com linha reta além da tabela da tela: FORA (pela rua só aumenta)",
    longe?.tipo === "faixa" && longe.resultado === "FORA" && longe.foraJaEmLinhaReta, longe);
  const pelaRua = previaDaTabelaDaTela("ROTA", { distanceKm: 4.2, medida: "rota" }, tabelaDaTela, false);
  confere("ROTA medida pela rua: a faixa da tabela da tela",
    pelaRua?.tipo === "faixa" && pelaRua.resultado === "ATENDE" && pelaRua.faixa?.km === 5 && pelaRua.faixa.fee === 12, pelaRua);
  const estimada = previaDaTabelaDaTela("ROTA", { distanceKm: 5.8, medida: "estimada" }, tabelaDaTela, false);
  confere("ROTA estimada (roteador fora): vale — é o que o servidor usaria",
    estimada?.tipo === "faixa" && estimada.resultado === "ATENDE" && estimada.faixa?.km === 6, estimada);
  const semMedida = previaDaTabelaDaTela("ROTA", { distanceKm: 2 }, tabelaDaTela, false);
  confere("ROTA sem `medida` na resposta: não confia na distância", semMedida?.tipo === "sem-previa" && semMedida.motivo === "SEM_MEDIDA_PELA_RUA", semMedida);
  const raio = previaDaTabelaDaTela("KM", { distanceKm: 5.5, medida: "linha-reta" }, tabelaDaTela, false);
  confere("KM (raio): a linha reta É a medida — faixa até 6 km",
    raio?.tipo === "faixa" && raio.resultado === "ATENDE" && raio.faixa?.km === 6 && raio.faixa.fee === 14, raio);
  const naoAchou = previaDaTabelaDaTela("ROTA", { distanceKm: 3.1, medida: "rota", unknown: true, precisaConfirmarNoMapa: true }, tabelaDaTela, false);
  confere("DESCONHECIDO (confirme no mapa): sem prévia", naoAchou?.tipo === "sem-previa" && naoAchou.motivo === "PONTO_INCERTO", naoAchou);
  const aproximado = previaDaTabelaDaTela("KM", { distanceKm: 2.4, medida: "linha-reta", pedeConfirmacao: true }, tabelaDaTela, false);
  confere("ponto aproximado: sem prévia", aproximado?.tipo === "sem-previa" && aproximado.motivo === "PONTO_INCERTO", aproximado);
  const risco = previaDaTabelaDaTela("KM", { distanceKm: 0.9, medida: "linha-reta" }, tabelaDaTela, true);
  confere("área de risco: fora com qualquer tabela", risco?.tipo === "sem-previa" && risco.motivo === "AREA_DE_RISCO", risco);
  confere("sem distância: nada a mostrar", previaDaTabelaDaTela("KM", { distanceKm: null }, tabelaDaTela, false) === null);
  confere("tabela da tela sem faixa: nada a mostrar", previaDaTabelaDaTela("KM", { distanceKm: 2, medida: "linha-reta" }, [], false) === null);
  const borda = previaDaTabelaDaTela("ROTA", { distanceKm: 7.05, medida: "rota" }, tabelaDaTela, false);
  confere("R5 na prévia: 7,05 km cabe na última faixa (folga)", borda?.tipo === "faixa" && borda.resultado === "ATENDE" && borda.naFolga, borda);
}

// ── Cadastro gravado em TEXTO: a tela lê como o motor ──────────────────────
{
  const bairrosReais = [{ name: "Centro", fee: 6, time: 30 }, { name: "Braga", fee: 8, time: 40 }, { name: "Passagem", fee: 7, time: 35 }];
  const lidoTexto = lerZonasGravadas(JSON.stringify(bairrosReais));
  confere("bairros em texto: os 3 da loja, não os 2 de exemplo",
    !lidoTexto.ilegivel && lidoTexto.zonas.length === 3 && lidoTexto.zonas[1].name === "Braga", lidoTexto);
  const faixasTexto = lerZonasGravadas(JSON.stringify([{ km: 1, fee: 5, time: 30 }, { km: 1.5, fee: 8, time: 30 }]));
  confere("faixas em texto: lidas", faixasTexto.zonas.length === 2 && faixasTexto.zonas[1].km === 1.5);
  const lista = lerZonasGravadas(bairrosReais);
  confere("lista continua lista", !lista.ilegivel && lista.zonas.length === 3);
  const area = lerZonasGravadas([{ nome: "Centro", fee: 5, time: 30, pontos: JSON.stringify([[-22.85, -42.02], [-22.86, -42.02], [-22.86, -42.03]]) }]);
  confere("contorno da área em texto: vira lista (a área não some no próximo Salvar)",
    !area.ilegivel && Array.isArray(area.zonas[0].pontos) && area.zonas[0].pontos.length === 3, area);
  const contornoQuebrado = lerZonasGravadas([{ nome: "X", fee: 5, time: 30, pontos: "[[-22.85," }]);
  confere("contorno em texto quebrado: ilegível (a tela pergunta antes de gravar por cima)", contornoQuebrado.ilegivel);
  confere("texto que não é JSON: ilegível", lerZonasGravadas("Centro R$5; Braga R$8").ilegivel);
  confere("objeto solto com conteúdo: ilegível", lerZonasGravadas({ Centro: 5 }).ilegivel);
  const vazios = [null, undefined, "", "   ", "null", {}, []].map((v) => lerZonasGravadas(v));
  confere("nada gravado (null, vazio, {}, []): lista vazia, sem alarme", vazios.every((r) => !r.ilegivel && r.zonas.length === 0), vazios);
  // A mesma leitura do servidor: o texto gravado igual ao da tela não é mudança.
  confere("cadastroParaGravar: texto gravado = lista igual da tela → manter",
    cadastroParaGravar({ tipo: "NEIGHBORHOOD", zonas: JSON.stringify(bairrosReais) }, { deliveryZoneType: "NEIGHBORHOOD", deliveryZones: bairrosReais }).acao === "manter");
}

// ── A escolha "um valor por faixa" depois do Salvar ─────────────────────────
{
  // O caso da revisão: separado:false gravado, motoboyFee antigo nas faixas, o
  // GET do carregamento falhou e a tela abriu com o palpite "ligado".
  const falhouAoAbrir = escolhaDoRepasseParaGravar({ lidaAoAbrir: null, lidaAgora: false, naTela: true, lojaEscolheu: false });
  confere("GET do carregamento falhou: o palpite NÃO é gravado; a tela passa ao gravado",
    falhouAoAbrir.mandar === null && falhouAoAbrir.telaPassaA === false && falhouAoAbrir.gravada === false, falhouAoAbrir);
  const nadaLido = escolhaDoRepasseParaGravar({ lidaAoAbrir: null, lidaAgora: null, naTela: true, lojaEscolheu: false });
  confere("nenhuma leitura: não grava e avisa", nadaLido.mandar === null && nadaLido.naoLida, nadaLido);
  const escolheuSemLer = escolhaDoRepasseParaGravar({ lidaAoAbrir: null, lidaAgora: null, naTela: true, lojaEscolheu: true });
  confere("a loja clicou (mesmo sem leitura): grava a escolha dela", escolheuSemLer.mandar === true, escolheuSemLer);
  const ligou = escolhaDoRepasseParaGravar({ lidaAoAbrir: false, lidaAgora: false, naTela: true, lojaEscolheu: true });
  confere("gravado desligado, a loja ligou: grava true", ligou.mandar === true, ligou);
  const igual = escolhaDoRepasseParaGravar({ lidaAoAbrir: true, lidaAgora: true, naTela: true, lojaEscolheu: false });
  confere("igual ao gravado: não manda nada", igual.mandar === null && !igual.naoLida, igual);
  const desligou = escolhaDoRepasseParaGravar({ lidaAoAbrir: true, lidaAgora: true, naTela: false, lojaEscolheu: true });
  confere("gravado ligado, a loja desligou: grava false", desligou.mandar === false, desligou);
  const palpiteLigadoIgual = escolhaDoRepasseParaGravar({ lidaAoAbrir: null, lidaAgora: true, naTela: true, lojaEscolheu: false });
  confere("GET falhou, gravado ligado e palpite ligado: nada a mandar, tela fica ligada",
    palpiteLigadoIgual.mandar === null && palpiteLigadoIgual.telaPassaA === true, palpiteLigadoIgual);
  const conferenciaMaisNova = escolhaDoRepasseParaGravar({ lidaAoAbrir: true, lidaAgora: false, naTela: true, lojaEscolheu: false });
  confere("outra aba desligou depois do carregamento: sem clique, não desfaz; a tela passa a desligado",
    conferenciaMaisNova.gravada === false && conferenciaMaisNova.mandar === null && conferenciaMaisNova.telaPassaA === false, conferenciaMaisNova);
  const escolheuContraAConferencia = escolhaDoRepasseParaGravar({ lidaAoAbrir: true, lidaAgora: false, naTela: true, lojaEscolheu: true });
  confere("a loja clicou em ligado e a conferência diz desligado: grava true", escolheuContraAConferencia.mandar === true, escolheuContraAConferencia);
  const semClique = escolhaDoRepasseParaGravar({ lidaAoAbrir: true, lidaAgora: true, naTela: false, lojaEscolheu: false });
  confere("gravado ligado com faixas em branco (tela mostra desligado), sem clique: não grava", semClique.mandar === null && !semClique.naoLida, semClique);
  confere("… e a tela passa ao gravado (ligado), para pedir o 'Motoboy recebe'", semClique.telaPassaA === true, semClique);
}

// ── A tela abre no que está gravado, nos dois sentidos ──────────────────────
{
  // Teste de ponta a ponta (E1, 25/09/2026): loja recém-configurada com
  // `separado: true` e as faixas sem "Motoboy recebe". O palpite de abertura
  // (há valores nas faixas?) dá "acerto"; a leitura só desligava, e a tela
  // abria em "Pelo acerto de cada entregador" contradizendo o gravado.
  confere("gravado ligado, palpite desligado, sem clique → 'Um valor por faixa'",
    repasseNaTelaDepoisDeLer({ gravado: true, naTela: false, lojaEscolheu: false }) === true);
  confere("gravado desligado, valores velhos nas faixas (palpite ligado), sem clique → desligado",
    repasseNaTelaDepoisDeLer({ gravado: false, naTela: true, lojaEscolheu: false }) === false);
  confere("a loja já clicou antes de a leitura voltar: a escolha dela fica",
    repasseNaTelaDepoisDeLer({ gravado: true, naTela: false, lojaEscolheu: true }) === false
      && repasseNaTelaDepoisDeLer({ gravado: false, naTela: true, lojaEscolheu: true }) === true);
  confere("leitura falhou: fica o palpite",
    repasseNaTelaDepoisDeLer({ gravado: null, naTela: true, lojaEscolheu: false }) === true
      && repasseNaTelaDepoisDeLer({ gravado: null, naTela: false, lojaEscolheu: false }) === false);
}

// ── A tela ABRE no gravado que a página leu (sem palpite até o GET) ─────────
{
  // E1 de novo, agora antes do GET: por 1–1,5 s a tela mostrava "Pelo acerto
  // de cada entregador" (palpite: faixas sem valor) numa loja com
  // `separado: true` — e o clique nesse intervalo vencia o gravado.
  confere("gravado ligado, faixas em branco → abre em 'Um valor por faixa'",
    repasseNaAbertura({ gravadoNaPagina: true, temValorNasFaixas: false }) === true);
  confere("gravado desligado, valores velhos nas faixas → abre em 'acerto'",
    repasseNaAbertura({ gravadoNaPagina: false, temValorNasFaixas: true }) === false);
  confere("sem o gravado (null/ausente) → o palpite de antes: há valores nas faixas?",
    repasseNaAbertura({ gravadoNaPagina: null, temValorNasFaixas: true }) === true
      && repasseNaAbertura({ temValorNasFaixas: false }) === false);
}

// ── O aviso "Não salvei" conta o que não coube ─────────────────────────────
{
  // D3: a Divinos com "um valor por faixa" e as 9 faixas em branco. O aviso
  // listava 8 e sumia com a de 5 km, e o contador dizia 9.
  const DIVINOS_KM = ["1", "1,5", "2", "2,5", "3", "3,5", "4", "4,5", "5"];
  const nove = DIVINOS_KM.map((k) => `até ${k} km: falta quanto o motoboy recebe (use 0 se ele não recebe nada).`);
  const lista = listaDoAviso(nove, 8);
  const contada = lista[lista.length - 1];
  const mostradas = lista.length - 1;
  const numeroContado = Number(contada.match(/e mais ([0-9]+)/)?.[1]);
  confere("9 faixas sem valor: no máximo 8 linhas", lista.length === 8, lista);
  confere("… a última diz quantas faltam, e a conta fecha nas 9",
    /^… e mais 2 problemas/.test(contada) && mostradas + numeroContado === 9, contada);
  confere("… as mostradas são as primeiras, na ordem", lista.slice(0, mostradas).every((t, i) => t === nove[i]));
  confere("8 erros cabem: todos, sem linha de contagem",
    JSON.stringify(listaDoAviso(nove.slice(0, 8), 8)) === JSON.stringify(nove.slice(0, 8)));
  confere("1 erro: ele só", JSON.stringify(listaDoAviso(nove.slice(0, 1))) === JSON.stringify(nove.slice(0, 1)));
  confere("nenhum erro: lista vazia", listaDoAviso([]).length === 0);
  const vinte = Array.from({ length: 20 }, (_, i) => `erro ${i + 1}`);
  const l20 = listaDoAviso(vinte, 8);
  confere("20 erros: 7 + 'e mais 13'", l20.length === 8 && /e mais 13 problemas/.test(l20[7]), l20);
  confere("não mexe na lista original", nove.length === 9);
}

console.log(`\n${ok} ok, ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
