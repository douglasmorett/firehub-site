/**
 * LOJA SEM CONEXÃO (lib/loja-sem-conexao.ts): a internet da loja caiu no
 * horário → pausa iFood, site e robô, avisa o dono e desfaz tudo na volta.
 *
 *   npx tsx scripts/teste-loja-sem-conexao.ts
 *
 * O achado de 12/10/2026: com o aceite automático, o pedido do site, do 99, da
 * Keeta e da Wabiz é aceito na nuvem com a loja sem internet, e ninguém vê.
 * Este harness prova as decisões, sem banco: quando a loja APAGA (e, mais
 * importante, quando NÃO apaga — pausa por engano perde venda), quando VOLTA,
 * que a volta só desfaz o que a proteção fez, e que rodar duas vezes não abre
 * duas pausas nem manda dois avisos. Um "mundo" de mentira faz o papel do cron:
 * grava a decisão antes de agir (com a versão), fala com um iFood falso e
 * registra os resultados pelas mesmas funções que a rota usa.
 */
import {
  CARENCIA_DO_BOOT_MS, DESCRICAO_DA_PAUSA, ENTRE_AVISOS_DE_QUEDA_MS, MAX_TENTATIVAS_DE_PAUSA, PAUSA_NO_IFOOD_MS,
  REPETIR_MS, RENOVAR_ANTES_MS,
  decidirSemConexao, duracaoEmTexto, horaLocalParaOIfood, idDaPausaCriada, idsDasNossasPausas, lerEstadoSemConexao,
  mensagemDeFimDoHorario, mensagemDeQueda, mensagemDeVolta, mesmoEstado, protecaoLigada,
  registrarAviso, registrarPausaNoIfood, registrarTiradaDoIfood,
  type DecisaoSemConexao, type EstadoSemConexao, type ResultadoDaPausa, type SinaisDeVida, type SituacaoDaLoja,
} from "../src/lib/loja-sem-conexao";
import { estadoDaLoja, instrucaoDeHorario, TEXTO_DA_INSTABILIDADE } from "../src/lib/loja-aberta";
import {
  assistenteVistoEm, marcarAssistente, marcarPainelAberto, painelVistoEm, sinalDeOutraInstancia, tirarSinaisParaOBanco,
} from "../src/lib/sinais-da-loja";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const contem = (oQue: string, texto: string, trecho: string) => confere(oQue, texto.includes(trecho), true);
const naoContem = (oQue: string, texto: string, trecho: string) => confere(oQue, texto.includes(trecho), false);

const MIN = 60_000;
const SP = "America/Sao_Paulo";
/** 12/10/2026 20:30 em Brasília. */
const T0 = Date.parse("2026-10-12T23:30:00.000Z");
const TURNO = "2026-10-12@18:00";
const IFOOD = [{ merchantId: "m1", nome: "Pizzaria 17" }];

/** Assistente mudo há 3 min, nenhum painel, servidor de pé há 1 h. */
const sinais = (o: Partial<SinaisDeVida> = {}): SinaisDeVida => ({
  agora: T0, bootEm: T0 - 60 * MIN, assistenteNoBanco: T0 - 3 * MIN - 20_000, assistenteNaMemoria: T0 - 3 * MIN, painelNaMemoria: null, ...o,
});
/** No horário, "Site aberto" ligado, proteção ligada. */
const loja = (o: Partial<SituacaoDaLoja> = {}): SituacaoDaLoja => ({ turno: TURNO, emPausa: false, storeOpen: true, protecaoLigada: true, ...o });

const decide = (o: { s?: Partial<SinaisDeVida>; l?: Partial<SituacaoDaLoja>; estado?: EstadoSemConexao; podeAvisar?: boolean } = {}) =>
  decidirSemConexao({ sinais: sinais(o.s), loja: loja(o.l), ifood: IFOOD, podeAvisar: o.podeAvisar ?? true, estado: o.estado });

const nenhumaAcao = (d: DecisaoSemConexao) =>
  !d.acoes.fecharSite && !d.acoes.reabrirSite && d.acoes.pausarNoIfood.length === 0 && d.acoes.renovarNoIfood.length === 0 &&
  d.acoes.tirarDoIfood.length === 0 && d.acoes.aviso === null;

// ── O mundo de mentira: banco com versão, "Site aberto", iFood e WhatsApp ──
type Mundo = {
  estado: EstadoSemConexao;
  versao: number;
  storeOpen: boolean;
  /** Pausas por loja do iFood: as nossas e as do dono. */
  pausas: Map<string, { id: string; descricao: string; ate: number }[]>;
  avisos: string[];
  seq: number;
  ifood: "ok" | "falha" | "fechado";
  tirar: "ok" | "falha";
  podeAvisar: boolean;
};
const novoMundo = (o: Partial<Mundo> = {}): Mundo => ({
  estado: {}, versao: 0, storeOpen: true, pausas: new Map([["m1", []]]), avisos: [], seq: 0, ifood: "ok", tirar: "ok", podeAvisar: true, ...o,
});

/** O UPDATE condicionado à versão (lib/loja-sem-conexao-no-banco.ts, `gravarEstadoSemConexao`). */
function gravar(m: Mundo, versaoLida: number, estado: EstadoSemConexao, site?: "fechar" | "reabrir"): boolean {
  if (m.versao !== versaoLida) return false;
  if (site === "fechar" && !m.storeOpen) return false;
  if (site === "fechar") m.storeOpen = false;
  if (site === "reabrir") m.storeOpen = true;
  m.estado = JSON.parse(JSON.stringify(estado));
  m.versao++;
  return true;
}

/** Uma rodada do cron para esta loja, na ordem da rota: decide, grava, age, grava o resultado. */
function rodada(m: Mundo, s: Partial<SinaisDeVida>, l: Partial<SituacaoDaLoja> = {}, lido = { estado: m.estado, versao: m.versao }) {
  const agora = s.agora ?? T0;
  const d = decidirSemConexao({ sinais: sinais(s), loja: loja({ storeOpen: m.storeOpen, ...l }), ifood: IFOOD, podeAvisar: m.podeAvisar, estado: lido.estado });
  const a = d.acoes;
  const age = !nenhumaAcao(d);
  if (!age && mesmoEstado(d.estado, lido.estado)) return { d, gravou: false, agiu: false };
  if (!gravar(m, lido.versao, d.estado, a.fecharSite ? "fechar" : a.reabrirSite ? "reabrir" : undefined)) return { d, gravou: false, agiu: false };
  let estado = d.estado;
  const criar = (merchantId: string): ResultadoDaPausa => {
    if (m.ifood === "falha") return { situacao: "falhou", erro: "rede" };
    if (m.ifood === "fechado") return { situacao: "ja_fechada" };
    const id = `p${++m.seq}`;
    m.pausas.get(merchantId)!.push({ id, descricao: DESCRICAO_DA_PAUSA, ate: agora + PAUSA_NO_IFOOD_MS });
    return { situacao: "pausada", interrupcaoId: id, ate: agora + PAUSA_NO_IFOOD_MS };
  };
  const tirarNossas = (merchantId: string): boolean => {
    if (m.tirar === "falha") return false;
    m.pausas.set(merchantId, m.pausas.get(merchantId)!.filter((p) => p.descricao !== DESCRICAO_DA_PAUSA));
    return true;
  };
  for (const id of a.pausarNoIfood) estado = registrarPausaNoIfood(estado, id, criar(id));
  for (const r of a.renovarNoIfood) estado = registrarPausaNoIfood(estado, r.merchantId, tirarNossas(r.merchantId) ? criar(r.merchantId) : { situacao: "mantida" });
  for (const t of a.tirarDoIfood) estado = registrarTiradaDoIfood(estado, t.merchantId, tirarNossas(t.merchantId));
  if (a.aviso) {
    m.avisos.push(a.aviso);
    estado = registrarAviso(estado, a.aviso, true, agora);
  }
  if (!mesmoEstado(estado, d.estado)) gravar(m, lido.versao + 1, estado);
  return { d, gravou: true, agiu: age };
}
const nossas = (m: Mundo) => m.pausas.get("m1")!.filter((p) => p.descricao === DESCRICAO_DA_PAUSA).length;

// ════════════════════════════════════════════════════════════════════════════
console.log("\n— Quando a loja NÃO apaga (pausa por engano perde venda) —");
{
  const d = decide({ s: { assistenteNoBanco: null, assistenteNaMemoria: null } });
  confere("nunca usou o Assistente: nunca apaga", [d.evento, nenhumaAcao(d)], ["nada", true]);
}
confere("Assistente mudo há 3 min, mas painel aberto há 20 s: não apaga", decide({ s: { painelNaMemoria: T0 - 20_000 } }).evento, "nada");
confere("painel visto há 1 min 50 s ainda conta como aberto", decide({ s: { painelNaMemoria: T0 - 110_000 } }).evento, "nada");
confere("Assistente mudo há só 1 min: não apaga", decide({ s: { assistenteNaMemoria: T0 - MIN, assistenteNoBanco: T0 - 90_000 } }).evento, "nada");
confere("fora do horário: não apaga", decide({ l: { turno: null } }).evento, "nada");
confere("\"Site aberto\" desligado pelo dono: não apaga", decide({ l: { storeOpen: false } }).evento, "nada");
confere("pausa programada (férias): não apaga", decide({ l: { emPausa: true } }).evento, "nada");
confere("proteção desligada pelo dono: não apaga", decide({ l: { protecaoLigada: false } }).evento, "nada");
confere("servidor subiu há 1 min (memória vazia): não apaga", decide({ s: { bootEm: T0 - MIN } }).evento, "nada");
confere("...e há 3 min já pode apagar", decide({ s: { bootEm: T0 - CARENCIA_DO_BOOT_MS } }).evento, "apagou");
confere(
  "PC desligado desde antes de abrir (Assistente mudo há 40 min): não apaga",
  decide({ s: { assistenteNaMemoria: null, assistenteNoBanco: T0 - 40 * MIN } }).evento,
  "nada",
);
confere(
  "depois de um deploy (memória vazia), carimbo do banco de 70 s atrás é Assistente vivo",
  decide({ s: { assistenteNaMemoria: null, assistenteNoBanco: T0 - 70_000, bootEm: T0 - 10 * MIN } }).evento,
  "nada",
);

console.log("\n— Quando apaga —");
{
  const d = decide();
  confere("Assistente mudo + nenhum painel + no horário: apaga", d.evento, "apagou");
  confere("fecha o site (na mesma gravação do estado)", d.acoes.fecharSite, true);
  confere("pausa o iFood da loja", d.acoes.pausarNoIfood, ["m1"]);
  confere("avisa o dono", d.acoes.aviso, "queda");
  confere("o episódio guarda o último sinal do Assistente", d.estado.episodio?.ultimoSinal, T0 - 3 * MIN);
  confere("painel visto há 2 min 10 s não segura mais", decide({ s: { painelNaMemoria: T0 - 130_000 } }).evento, "apagou");
  const semAviso = decide({ podeAvisar: false });
  confere("sem número/aviso desligado: pausa igual, aviso pulado", [semAviso.evento, semAviso.acoes.aviso, semAviso.estado.episodio?.aviso.pulado], ["apagou", null, true]);
}

console.log("\n— Idempotência —");
{
  const m = novoMundo();
  const r1 = rodada(m, { agora: T0 });
  confere("1ª rodada: apagou, site fechado, 1 pausa no iFood, 1 aviso", [r1.d.evento, m.storeOpen, nossas(m), m.avisos], ["apagou", false, 1, ["queda"]]);
  const r2 = rodada(m, { agora: T0 });
  confere("a mesma rodada de novo: nenhuma ação, nada gravado", [r2.d.evento, nenhumaAcao(r2.d), r2.gravou], ["segue_apagada", true, false]);
  rodada(m, { agora: T0 + 30_000 });
  rodada(m, { agora: T0 + MIN });
  confere("rodadas seguintes: continua 1 pausa e 1 aviso", [nossas(m), m.avisos.length, m.estado.episodio?.ifood[0].situacao], [1, 1, "pausada"]);

  // Duas rodadas AO MESMO TEMPO (deploy com dois servidores): as duas leem a
  // versão 0 e decidem apagar; só a primeira grava, e só quem grava age.
  const c = novoMundo();
  const lido = { estado: c.estado, versao: c.versao };
  const a = rodada(c, { agora: T0 }, {}, lido);
  const b = rodada(c, { agora: T0 }, {}, lido);
  confere("rodadas simultâneas: só a primeira grava e age", [a.gravou, b.gravou], [true, false]);
  confere("rodadas simultâneas: 1 pausa no iFood e 1 aviso", [nossas(c), c.avisos.length], [1, 1]);

  // Decisão gravada, resultado ainda não (rodada lenta): quem lê no meio não repete.
  const meio = decide();
  const deNovo = decide({ estado: meio.estado });
  confere("decisão gravada antes de agir: quem lê no meio não pausa nem avisa de novo", [deNovo.acoes.pausarNoIfood, deNovo.acoes.aviso], [[], null]);
}

console.log("\n— A volta —");
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const segue = rodada(m, { agora: T0 + 2 * MIN });
  confere("2 min depois, ainda sem sinal: segue apagada sem fazer nada", [segue.d.evento, segue.agiu], ["segue_apagada", false]);
  const r = rodada(m, { agora: T0 + 5 * MIN, assistenteNaMemoria: T0 + 5 * MIN - 3_000 });
  confere("volta pelo Assistente (consulta de 3 s atrás)", [r.d.evento, r.d.motivo], ["voltou", "assistente"]);
  confere("religa o site, tira a NOSSA pausa do iFood, avisa a volta", [m.storeOpen, nossas(m), m.avisos], [true, 0, ["queda", "volta"]]);
  confere("o estado fica sem episódio", m.estado.episodio, undefined);
  const depois = rodada(m, { agora: T0 + 6 * MIN, assistenteNaMemoria: T0 + 6 * MIN - 3_000 });
  confere("rodada seguinte: nada a fazer", [depois.d.evento, depois.agiu], ["nada", false]);
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const r = rodada(m, { agora: T0 + 4 * MIN, assistenteNaMemoria: null, assistenteNoBanco: T0 + 4 * MIN - 40_000 });
  confere("volta pelo Assistente visto só no banco (outro servidor, carimbo de 40 s)", [r.d.evento, r.d.motivo], ["voltou", "assistente"]);
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const r = rodada(m, { agora: T0 + 4 * MIN, painelNaMemoria: T0 + 4 * MIN - 10_000 });
  confere("volta pelo painel aberto (10 s atrás)", [r.d.evento, r.d.motivo, m.storeOpen, nossas(m)], ["voltou", "painel", true, 0]);
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const painelVelho = rodada(m, { agora: T0 + 4 * MIN, painelNaMemoria: T0 + 4 * MIN - 40_000 });
  confere("painel de 40 s atrás não é volta", painelVelho.d.evento, "segue_apagada");
  const piscada = rodada(m, { agora: T0 + 5 * MIN, assistenteNaMemoria: T0 + 5 * MIN - 50_000, assistenteNoBanco: T0 + 5 * MIN - 2 * MIN });
  confere("Assistente que piscou há 50 s e sumiu de novo não é volta", piscada.d.evento, "segue_apagada");
}

console.log("\n— A volta só desfaz o que a proteção fez —");
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  m.storeOpen = true; // alguém religou o site no meio da queda (sem painel: pela API, por exemplo)
  rodada(m, { agora: T0 + MIN });
  confere("site religado no meio da queda passa a ser do dono", m.estado.episodio?.site, "dono_mexeu");
  m.storeOpen = false; // ...e o dono fechou de novo
  const r = rodada(m, { agora: T0 + 3 * MIN, painelNaMemoria: T0 + 3 * MIN - 5_000 });
  confere("na volta, o site que o dono fechou continua fechado", [r.d.acoes.reabrirSite, m.storeOpen], [false, false]);
  confere("...mas a pausa do iFood, que é nossa, sai", nossas(m), 0);
  const msg = mensagemDeVolta({ loja: "Pizzaria 17", episodio: r.d.encerrado!, agora: T0 + 3 * MIN, tz: SP });
  contem("a mensagem da volta diz que o site ficou como o dono deixou", msg, "O site ficou do jeito que você deixou.");
  naoContem("...e não diz que reabriu o site", msg, "• Site e robô");
}
{
  // O iFood já estava fechado (pausa do dono): a proteção não mexe nele.
  const m = novoMundo({ ifood: "fechado" });
  m.pausas.set("m1", [{ id: "do-dono", descricao: "Reforma", ate: T0 + 24 * 60 * MIN }]);
  rodada(m, { agora: T0 });
  confere("iFood já fechado: não cria pausa nossa", [m.estado.episodio?.ifood[0].situacao, nossas(m)], ["ja_fechada", 0]);
  const r = rodada(m, { agora: T0 + 3 * MIN, painelNaMemoria: T0 + 3 * MIN - 5_000 });
  confere("na volta, a faxina só procura as NOSSAS (sem id do dono)", r.d.acoes.tirarDoIfood, [{ merchantId: "m1", ids: [] }]);
  confere("a pausa do dono continua lá", m.pausas.get("m1")!.map((p) => p.id), ["do-dono"]);
  const msg = mensagemDeVolta({ loja: "Pizzaria 17", episodio: r.d.encerrado!, agora: T0 + 3 * MIN, tz: SP });
  naoContem("a mensagem da volta não diz que reabriu o iFood", msg, "• iFood");
}
confere(
  "a faxina reconhece as nossas pausas pela descrição",
  idsDasNossasPausas([{ id: "dono", description: "Fechado para reforma" }, { id: "nossa", description: DESCRICAO_DA_PAUSA }]),
  ["nossa"],
);
confere("...também no formato { interruptions: [...] }", idsDasNossasPausas({ interruptions: [{ id: 7, description: DESCRICAO_DA_PAUSA }] }), ["7"]);

console.log("\n— Fim do horário com a loja ainda sem conexão —");
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const r = rodada(m, { agora: T0 + 40 * MIN }, { turno: null });
  confere("fim do horário encerra a queda", [r.d.evento, r.d.motivo, r.d.acoes.aviso], ["voltou", "fora_do_horario", "fim_do_horario"]);
  confere("desfaz o que fez: site religado, pausa nossa fora", [m.storeOpen, nossas(m)], [true, 0]);
  const msg = mensagemDeFimDoHorario({ loja: "Pizzaria 17", episodio: r.d.encerrado!, agora: T0 + 40 * MIN, tz: SP });
  contem("mensagem do fim do horário", msg, "horário encerrado ainda sem conexão");
  contem("...diz o que foi desfeito", msg, "a pausa do iFood e o site e o robô");
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const r = rodada(m, { agora: T0 + 2 * MIN }, { protecaoLigada: false });
  confere("dono desligou a proteção no meio: desfaz sem aviso", [r.d.motivo, r.d.acoes.aviso, m.storeOpen, nossas(m)], ["protecao_desligada", null, true, 0]);
}

console.log("\n— iFood que falha, renovação e pausa que não sai —");
{
  const m = novoMundo({ ifood: "falha" });
  rodada(m, { agora: T0 });
  confere("iFood fora: pausa falhou (1ª tentativa)", [m.estado.episodio?.ifood[0].situacao, m.estado.episodio?.ifood[0].tentativas], ["falhou", 1]);
  const cedo = rodada(m, { agora: T0 + MIN });
  confere("1 min depois ainda não tenta de novo", cedo.d.acoes.pausarNoIfood, []);
  const r = rodada(m, { agora: T0 + REPETIR_MS });
  confere("2 min depois tenta de novo", [r.d.acoes.pausarNoIfood, m.estado.episodio?.ifood[0].tentativas], [["m1"], 2]);
  for (let i = 2; i <= 6; i++) rodada(m, { agora: T0 + i * REPETIR_MS });
  confere(`para em ${MAX_TENTATIVAS_DE_PAUSA} tentativas`, m.estado.episodio?.ifood[0].tentativas, MAX_TENTATIVAS_DE_PAUSA);
  m.ifood = "ok";
  const tarde = rodada(m, { agora: T0 + 20 * REPETIR_MS });
  confere("...e não tenta mais", tarde.d.acoes.pausarNoIfood, []);
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  const antes = rodada(m, { agora: T0 + PAUSA_NO_IFOOD_MS - RENOVAR_ANTES_MS - MIN });
  confere("pausa longe de vencer: não renova", antes.d.acoes.renovarNoIfood, []);
  const agora = T0 + PAUSA_NO_IFOOD_MS - RENOVAR_ANTES_MS + MIN;
  const r = rodada(m, { agora });
  confere("perto de vencer, ainda sem conexão: renova", r.d.acoes.renovarNoIfood, [{ merchantId: "m1", ids: ["p1"] }]);
  confere("a pausa nova vale mais 2 h, e continua uma só", [m.estado.episodio?.ifood[0].interrupcaoId, m.estado.episodio?.ifood[0].ate, nossas(m)], ["p2", agora + PAUSA_NO_IFOOD_MS, 1]);
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  m.tirar = "falha";
  rodada(m, { agora: T0 + 3 * MIN, painelNaMemoria: T0 + 3 * MIN - 5_000 });
  confere("a pausa que não saiu na volta fica guardada para tentar de novo", m.estado.tirarDoIfood?.map((t) => [t.merchantId, t.ids]), [["m1", ["p1"]]]);
  const cedo = rodada(m, { agora: T0 + 4 * MIN, painelNaMemoria: T0 + 4 * MIN - 5_000 });
  confere("1 min depois ainda não tenta", cedo.d.acoes.tirarDoIfood, []);
  m.tirar = "ok";
  rodada(m, { agora: T0 + 5 * MIN, painelNaMemoria: T0 + 5 * MIN - 5_000 });
  confere("2 min depois tira, e a lista esvazia", [nossas(m), m.estado.tirarDoIfood], [0, undefined]);
}
{
  const vencida: EstadoSemConexao = { tirarDoIfood: [{ merchantId: "m1", ids: ["p9"], ate: T0 - MIN }] };
  const d = decide({ s: { assistenteNaMemoria: T0 - 5_000 }, estado: vencida });
  confere("pausa que já venceu sozinha sai da lista sem chamar o iFood", [d.acoes.tirarDoIfood, d.estado.tirarDoIfood], [[], undefined]);
  const viva: EstadoSemConexao = { tirarDoIfood: [{ merchantId: "m1", ids: ["p9"], ate: T0 + 30 * MIN, tentouEm: T0 - 5 * MIN }] };
  const nova = decide({ estado: viva });
  confere(
    "nova queda com pausa nossa que não tinha saído: renova (tira e põe), em vez de pausar por cima",
    [nova.evento, nova.acoes.pausarNoIfood, nova.acoes.renovarNoIfood, nova.estado.tirarDoIfood],
    ["apagou", [], [{ merchantId: "m1", ids: ["p9"] }], undefined],
  );
  // No mundo: a pausa velha (p9) ainda está no iFood quando a loja cai de novo.
  const m = novoMundo({ estado: viva });
  m.pausas.set("m1", [{ id: "p9", descricao: DESCRICAO_DA_PAUSA, ate: T0 + 30 * MIN }]);
  rodada(m, { agora: T0 });
  confere(
    "...e fica uma pausa só, a nova, registrada no episódio",
    [nossas(m), m.estado.episodio?.ifood[0].situacao, m.estado.episodio?.ifood[0].interrupcaoId],
    [1, "pausada", "p1"],
  );
}

console.log("\n— Aviso: loja que pisca não vira enxurrada —");
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  rodada(m, { agora: T0 + 5 * MIN, assistenteNaMemoria: T0 + 5 * MIN - 3_000 });
  confere("1ª queda e volta: dois avisos", m.avisos, ["queda", "volta"]);
  // Caiu de novo 5 min depois da volta (10 min depois do 1º aviso).
  const t2 = T0 + 10 * MIN;
  const r = rodada(m, { agora: t2, assistenteNaMemoria: t2 - 3 * MIN, assistenteNoBanco: t2 - 3 * MIN });
  confere("2ª queda logo depois: pausa, mas o aviso espera", [r.d.evento, m.storeOpen, nossas(m), r.d.acoes.aviso], ["apagou", false, 1, null]);
  const t3 = T0 + ENTRE_AVISOS_DE_QUEDA_MS;
  const r3 = rodada(m, { agora: t3, assistenteNaMemoria: t2 - 3 * MIN, assistenteNoBanco: t2 - 3 * MIN });
  confere("...e sai 20 min depois do anterior, se a queda continua", r3.d.acoes.aviso, "queda");
}
{
  const m = novoMundo();
  rodada(m, { agora: T0 });
  rodada(m, { agora: T0 + 5 * MIN, assistenteNaMemoria: T0 + 5 * MIN - 3_000 });
  const t2 = T0 + 10 * MIN;
  rodada(m, { agora: t2, assistenteNaMemoria: t2 - 3 * MIN, assistenteNoBanco: t2 - 3 * MIN });
  rodada(m, { agora: t2 + 2 * MIN, assistenteNaMemoria: t2 + 2 * MIN - 3_000 });
  confere("piscada que volta antes do aviso: sem \"voltou\" (não houve \"caiu\")", m.avisos, ["queda", "volta"]);
}
{
  const m = novoMundo({ podeAvisar: false });
  rodada(m, { agora: T0 });
  rodada(m, { agora: T0 + 5 * MIN, painelNaMemoria: T0 + 5 * MIN - 3_000 });
  confere("sem número de aviso: pausa e despausa sem mensagem", [m.avisos, m.storeOpen, nossas(m)], [[], true, 0]);
}

console.log("\n— Site e robô durante a queda —");
{
  const horario = [{ day: "Segunda", active: true, open: "18:00", close: "23:00", shifts: [{ open: "18:00", close: "23:00" }] }];
  const fechada = estadoDaLoja({ storeHours: horario, storeOpen: false, timezone: SP, agora: new Date(T0) });
  const queda = estadoDaLoja({ storeHours: horario, storeOpen: false, timezone: SP, agora: new Date(T0), semConexao: true });
  confere("fechada pelo dono: a frase de sempre", [fechada.aberta, fechada.texto, fechada.instabilidade], [false, "A loja está fechada no momento.", undefined]);
  confere("fechada pela queda: continua sem vender, com a frase da instabilidade", [queda.aberta, queda.instabilidade, queda.texto], [false, true, TEXTO_DA_INSTABILIDADE]);
  const prompt = instrucaoDeHorario(queda);
  contem("o robô fala em instabilidade", prompt, "instabilidade no sistema");
  contem("o robô não anota pedido", prompt, "É PROIBIDO anotar pedido");
  contem("o robô não diz que está fechado", prompt, "NÃO diga que a loja está fechada");
  naoContem("o robô não dá horário de abertura", prompt, "abrimos");
  const aberta = estadoDaLoja({ storeHours: horario, storeOpen: true, timezone: SP, agora: new Date(T0), semConexao: true });
  confere("\"semConexao\" com o site ligado não fecha nada", aberta.aberta, true);
  const depoisDeFechar = estadoDaLoja({ storeHours: horario, storeOpen: false, timezone: SP, agora: new Date(T0 + 3 * 60 * MIN), semConexao: true });
  confere(
    "fora do horário a frase é a do horário, não a da instabilidade",
    [depoisDeFechar.aberta, depoisDeFechar.instabilidade, depoisDeFechar.motivo],
    [false, undefined, "fora_do_horario"],
  );
}

console.log("\n— Mensagens ao dono —");
{
  const d = decide();
  const ep = registrarPausaNoIfood(d.estado, "m1", { situacao: "pausada", interrupcaoId: "p1", ate: T0 + PAUSA_NO_IFOOD_MS }).episodio!;
  const queda = mensagemDeQueda({ loja: "Pizzaria 17", episodio: ep, tz: SP, semPausaAutomatica: ["99Food", "Keeta"] });
  contem("queda: título", queda, "*Pizzaria 17: loja sem conexão*");
  contem("queda: desde quando (último sinal, 20:27)", queda, "Desde as 20:27");
  contem("queda: o site e o robô pausados", queda, "Site e robô do WhatsApp");
  contem("queda: o iFood pausado, com o nome", queda, "• iFood (Pizzaria 17)");
  contem("queda: 99 e Keeta não pausam", queda, "99Food e Keeta não têm pausa automática");
  contem("queda: tudo volta sozinho", queda, "tudo é reaberto sozinho");
  const volta = mensagemDeVolta({ loja: "Pizzaria 17", episodio: ep, agora: T0 + 14 * MIN, tz: SP });
  contem("volta: a hora em que voltou", volta, "A loja voltou às 20:44");
  contem("volta: quanto durou (desde o último sinal)", volta, "depois de 17 min sem conexão");
  contem("volta: o que foi reaberto", volta, "Já reabrimos:");
  const presa = mensagemDeVolta({ loja: "Pizzaria 17", episodio: ep, agora: T0 + 14 * MIN, tz: SP, ifoodQueFicou: ["m1"] });
  contem("volta com a pausa presa: avisa e diz quando ela acaba sozinha", presa, "ela acaba sozinha às 22:30");
  const falhou = mensagemDeQueda({
    loja: "Pizzaria 17", tz: SP,
    episodio: registrarPausaNoIfood(d.estado, "m1", { situacao: "sem_acesso" }).episodio!,
  });
  contem("queda sem permissão no iFood: diz para pausar pelo Gestor", falhou, "pause pelo Gestor de Pedidos");
  confere("duração em texto", [duracaoEmTexto(7 * MIN), duracaoEmTexto(60 * MIN), duracaoEmTexto(80 * MIN)], ["7 min", "1 h", "1 h 20 min"]);

  // Modo Contingência (14/10/2026): a queda diz que o computador assumiu, a volta diz o que subiu.
  const quedaCont = mensagemDeQueda({ loja: "Pizzaria 17", episodio: ep, tz: SP, contingencia: true });
  contem("queda com contingência: o computador do caixa assumiu", quedaCont, "*Modo Contingência:* se o computador do caixa está ligado, ele já assumiu");
  naoContem("queda sem contingência: não fala dela", queda, "Modo Contingência");
  const comVolta = (subida: any) => mensagemDeVolta({ loja: "Pizzaria 17", episodio: ep, agora: T0 + 14 * MIN, tz: SP, contingencia: { subida } });
  const subiu = comVolta({ quedas: 1, pedidos: 8, linhas: 31, conflitos: 0 });
  contem("volta com contingência: quanto subiu", subiu, "8 pedidos e 31 mudanças subiram para o FireHub, sem duplicar");
  naoContem("volta sem conflito: não fala de conflito", subiu, "nos dois lugares");
  contem("volta com contingência: segue reabrindo o resto", subiu, "Já reabrimos:");
  const conflito = comVolta({ quedas: 2, pedidos: 1, linhas: 1, conflitos: 1 });
  contem("volta: singular", conflito, "1 pedido e 1 mudança subiram");
  contem("volta com conflito: manda conferir", conflito, "1 mudança foi feita nos dois lugares ao mesmo tempo: confira em Modo Contingência › Últimas quedas");
  contem("volta só com mudanças", comVolta({ quedas: 1, pedidos: 0, linhas: 4, conflitos: 0 }), "nenhum pedido novo e 4 mudanças subiram");
  contem("volta sem nada lançado", comVolta({ quedas: 1, pedidos: 0, linhas: 0, conflitos: 0 }), "nada foi lançado nele durante a queda");
  contem("volta antes da subida: avisa que sobe sozinho", comVolta(null), "sobe sozinho assim que ele tiver internet de novo");
  naoContem("volta sem contingência: não fala dela", volta, "computador do caixa");
}

console.log("\n— Formatos e leitura —");
confere("hora da pausa no relógio da loja (servidor em UTC)", horaLocalParaOIfood(T0, SP), "2026-10-12T20:30:00");
confere("hora da pausa duas horas depois", horaLocalParaOIfood(T0 + PAUSA_NO_IFOOD_MS, SP), "2026-10-12T22:30:00");
confere("id da pausa criada", [idDaPausaCriada({ id: "abc" }), idDaPausaCriada({}), idDaPausaCriada(null)], ["abc", null, null]);
confere("proteção: ausente = ligada", [protecaoLigada(undefined), protecaoLigada({}), protecaoLigada({ protecaoSemConexao: true }), protecaoLigada({ protecaoSemConexao: false })], [true, true, true, false]);
confere("estado gravado ilegível vira estado vazio", lerEstadoSemConexao("lixo"), { estado: {}, versao: 0 });
{
  const d = decide();
  const lido = lerEstadoSemConexao(JSON.parse(JSON.stringify({ ...d.estado, versao: 4 })));
  confere("o estado gravado volta igual (com a versão)", [mesmoEstado(lido.estado, d.estado), lido.versao], [true, 4]);
  confere("comparação ignora a ordem das chaves", mesmoEstado({ ultimoAvisoEm: 1, tirarDoIfood: [{ merchantId: "a", ids: [], ate: 2 }] }, { tirarDoIfood: [{ ate: 2, ids: [], merchantId: "a" }], ultimoAvisoEm: 1 }), true);
}

console.log("\n— Sinais na memória do processo —");
marcarPainelAberto(["loja-a", "loja-b", null], 1_000);
marcarAssistente("loja-a", 2_000);
confere("painel marcado para a loja e o grupo", [painelVistoEm("loja-a"), painelVistoEm("loja-b"), painelVistoEm("loja-c")], [1_000, 1_000, null]);
confere("Assistente marcado", [assistenteVistoEm("loja-a"), assistenteVistoEm("loja-b")], [2_000, null]);
confere("guardado no globalThis (um só por processo, para todas as rotas)", (globalThis as any).__firehubSinaisDaLoja?.painel.get("loja-b"), 1_000);

console.log("\n— Sinais de OUTRA instância (o banco, gravado no máximo a cada 30 s) —");
{
  confere("nenhuma outra instância viu a loja: null", sinalDeOutraInstancia(null, T0), null);
  confere("linha de agora: no máximo agora, nunca no futuro", sinalDeOutraInstancia(0, T0), T0);
  confere("linha de 50 s: conta como 20 s atrás (a outra pode ter visto até 30 s depois)", sinalDeOutraInstancia(50_000, T0), T0 - 20_000);

  tirarSinaisParaOBanco();
  marcarPainelAberto(["l1"], 100_000);
  marcarPainelAberto(["l1"], 105_000);
  marcarAssistente("l1", 106_000);
  confere("painel a cada 5 s vira UMA linha para o banco (e o Assistente outra)", tirarSinaisParaOBanco().map((s) => `${s.tipo}:${s.lojaId}`), ["painel:l1", "assistente:l1"]);
  marcarPainelAberto(["l1"], 129_000);
  confere("antes de 30 s: nada para o banco", tirarSinaisParaOBanco().length, 0);
  marcarPainelAberto(["l1"], 130_000);
  confere("30 s depois: de novo", tirarSinaisParaOBanco().length, 1);

  // O dono olha o painel no celular, preso (cookie do balanceador) ao OUTRO
  // servidor; o Assistente está fechado há 3 min. Este cron não viu painel.
  confere("sem o sinal de fora: apagou (o defeito com dois servidores)", decide().evento, "apagou");
  const deFora = (haMs: number) => decide({ s: { painelNaMemoria: sinalDeOutraInstancia(haMs, T0) } });
  confere("painel visto pela outra há 10 s: não apaga", deFora(10_000).evento === "apagou", false);
  confere("…nem com a linha de 2 min (pode ter sido visto até 1,5 min atrás)", deFora(2 * MIN).evento === "apagou", false);
  confere("linha de 2,5 min: aí sim (os mesmos 2 min de um servidor só, do lado seguro)", deFora(2.5 * MIN + 1_000).evento, "apagou");
  const emQueda = decide().estado;
  confere("em queda, painel visto pela outra há 50 s: voltou", decide({ estado: emQueda, s: { painelNaMemoria: sinalDeOutraInstancia(50_000, T0) } }).evento, "voltou");
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
