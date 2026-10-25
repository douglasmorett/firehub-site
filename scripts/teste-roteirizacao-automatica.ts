/**
 * Rota 100% automatizada — o planejador (lib/roteirizacao-automatica/planejador.ts),
 * a leitura da regra (config.ts), a liberação (liberacao.ts) e o prazo (prazo.ts).
 *
 * Fase 0 do plano (vault "FireHub - Plano despacho automático"): nada liga de
 * verdade, mas a decisão tem de estar certa antes de o Douglas ver a prévia.
 * Os casos são os da lista da Fase 0: semente por prazo; priorizado à mão
 * antes do menor prazo; raio; desvio; janela de prazo; rota cheia; sem ponto;
 * agendado; crescer rota aberta; não mexer em chamada; espera estourada tira
 * os não prontos; chamada escolhe quem chegou primeiro; ninguém na loja →
 * motoboyId null; cancelado sai; rota vazia apaga; determinismo.
 *
 * Fase 2 (a chamada do motoboy): a chamada grava `chamadaEm`/`chamadaMotoboyId`
 * e não toca `CustomerOrder.motoboyId`; ninguém na loja → push a todos os
 * livres; `quemPuxa: "qualquer"` → todos; rechamada só depois de 60 min (no
 * planejador e na gravação); rota que terminou sozinha → "fechar-rota";
 * pedido tirado pela loja (`semRotaAutomaticaEm`) fica de fora com motivo, e
 * sem a marca (o "voltar") volta a ser agrupado. A chamada (`chamarARota`)
 * roda com um Prisma falso e o `fetch` do Expo interceptado.
 *
 * Fase 3: a ordem das paradas pela rua (ordem-por-rua.ts) com um `medir`
 * falso — a rua muda a ordem da linha reta; perna sem medida, `medir` que
 * lança e teto de tempo estourado caem na linha reta. E o ROTA_JA_SAIU: a
 * chamada para todos que alguém levou avisa os outros livres, nunca quem levou.
 *
 * D8 revisto (22/10/2026): rota chamada que ninguém puxou recebe pedido
 * PRONTO que cabe (nunca o da chapa; nunca a já puxada; teto respeitado) e a
 * chamada sai de novo, "atualizada", para o mesmo chamado.
 *
 * Pela rua (22/10/2026, 21h15–21h30): o encaixe mede pela RUA quando há
 * medida (`pelaRua` falso) — a reta de 1,5 km que dá 4 km de rua (o rio) não
 * junta; sem medida, a linha reta de sempre; o candidato cabe perto de
 * QUALQUER parada (o #35 no caminho do #33, com as coordenadas reais da
 * Hakim); a ordem das paradas é o MENOR PERCURSO TOTAL (34 → 35 → 33, não o
 * guloso 34 → 33 → 35); e "uma rota por vez" trava só enquanto a rota aberta
 * tem vaga.
 *
 * Histórico oculto da rota (22/10/2026, 22h20 — o #47 na Rota #15 da Hakim):
 * o planejador diz POR QUÊ cada pedido entrou ("#35 entrou: no caminho do
 * #33 — desvio 0,8 km pela rua"; a semente "abriu a rota"), e o
 * `registrarNaRota` (historico-da-rota.ts) acrescenta com o teto de 60
 * entradas e nunca lança — com um Prisma falso que faz o papel do SQL.
 *
 *   npx tsx scripts/teste-roteirizacao-automatica.ts
 *
 * Sem banco e sem rede. O prazo.ts importa lib/painel-do-dono (que importa o
 * Prisma): o Prisma é simulado em globalThis.prisma, como em
 * teste-fila-do-mapa.ts, e o import é dinâmico, depois do DATABASE_URL falso.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
(globalThis as any).prisma = {};

type Ponto = { lat: number; lng: number };

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

// Hakim Centro, mais ou menos.
const LOJA: Ponto = { lat: -22.52, lng: -41.94 };
/** Um ponto a `leste` km a leste e `norte` km ao norte da loja. */
const em = (leste: number, norte = 0): Ponto => ({
  lat: LOJA.lat + norte / 111.32,
  lng: LOJA.lng + leste / (111.32 * Math.cos((LOJA.lat * Math.PI) / 180)),
});

const AGORA = new Date("2026-10-22T22:00:00.000Z");
const min = (m: number) => new Date(AGORA.getTime() + m * 60_000);

async function main() {
  const { planejar, ordenarParadas, ordemDeMenorPercurso, paresParaMedirPelaRua, LOJA_NA_TABELA, RECHAMAR_DEPOIS_MIN } = await import("../src/lib/roteirizacao-automatica/planejador");
  const { lerRoteirizacaoAutomatica, limparRoteirizacaoAutomatica, ROTEIRIZACAO_AUTOMATICA_PADRAO } = await import("../src/lib/roteirizacao-automatica/config");
  const { liberadaPara, lojaDoUsuario } = await import("../src/lib/roteirizacao-automatica/liberacao");
  const { prazoDoPedido, agendadoParaDepois } = await import("../src/lib/roteirizacao-automatica/prazo");
  type Pedido = import("../src/lib/roteirizacao-automatica/planejador").PedidoParaDespacho;
  type Rota = import("../src/lib/roteirizacao-automatica/planejador").RotaAberta;
  type Motoboy = import("../src/lib/roteirizacao-automatica/planejador").MotoboyLivre;
  type Acao = import("../src/lib/roteirizacao-automatica/planejador").Acao;

  const CFG = { ...ROTEIRIZACAO_AUTOMATICA_PADRAO, ativo: true };

  /** Pedido de teste: id = "p" + número; prazo em minutos a partir de AGORA. */
  const pedido = (numero: number, ponto: Ponto | null, prazoMin: number, extra: Partial<Pedido> = {}): Pedido => ({
    id: `p${String(numero).padStart(2, "0")}`,
    numero,
    ponto,
    prazo: min(prazoMin),
    criadoEm: min(prazoMin - 45),
    pronto: false,
    prontoEm: null,
    rotaId: null,
    prioridadeManual: false,
    ...extra,
  });
  const pronto = (haMin: number): Partial<Pedido> => ({ pronto: true, prontoEm: min(-haMin) });
  const rota = (id: string, pedidos: Pedido[], extra: Partial<Rota> = {}): Rota => ({
    id, routeNumber: `Rota #${id}`, pedidos: pedidos.map((p) => ({ ...p, rotaId: id })), chamadaEm: null, ...extra,
  });
  const plano = (pedidos: Pedido[], rotasAbertas: Rota[] = [], motoboys: Motoboy[] = [], config = CFG, pelaRua?: (a: string, b: string) => number | null) =>
    planejar({ loja: LOJA, config, pedidos, rotasAbertas, motoboys, agora: AGORA, pelaRua });
  const criadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "criar-rota" }> => a.tipo === "criar-rota").map((a) => a.pedidos);
  const chamadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "chamar" }> => a.tipo === "chamar");
  const motivoDe = (r: ReturnType<typeof plano>, id: string) => r.descartados.find((d) => d.pedidoId === id)?.motivo;
  const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

  console.log("\n== Semente e agrupamento ==");
  {
    // Dois pedidos prontos longe um do outro: uma rota por vez — nasce a do menor prazo.
    const r = plano([pedido(1, em(3), 40, pronto(1)), pedido(2, em(-3), 20, pronto(1))]);
    const c = criadas(r.acoes);
    conferir("semente = menor prazo: a rota criada é a do #2 (uma por vez)", c.length === 1 && c[0][0] === "p02", c);
    conferir("… o outro espera a próxima rota", motivoDe(r, "p01") === "proxima-rota", r.descartados);
  }
  {
    // O #3 tem prioridade pedida à mão e o maior prazo: é ele a semente.
    const r = plano([
      pedido(1, em(1), 10), pedido(2, em(1.2), 12), pedido(3, em(1.1), 30, { prioridadeManual: true }),
    ], [], [], { ...CFG, maxEntregasPorRota: 2, janelaDePrazoMin: 30 });
    const a = r.acoes.find((x) => x.tipo === "criar-rota") as Extract<Acao, { tipo: "criar-rota" }> | undefined;
    conferir("priorizado à mão vira semente antes do menor prazo", !!a && a.pedidos.includes("p03") && /prioridade/.test(a.motivo), a);
  }
  {
    // Candidato a 1,5 km da semente (raio 2): entra.
    const r = plano([pedido(1, em(3), 20), pedido(2, em(3, 1.5), 25)]);
    conferir("raio: candidato a 1,5 km da semente entra na rota", mesmoConjunto(criadas(r.acoes)[0] ?? [], ["p01", "p02"]), r.acoes);
  }
  {
    // Candidato a 4 km da semente, do outro lado: não entra; nenhum dos dois está pronto.
    const r = plano([pedido(1, em(2), 20), pedido(2, em(-2), 25)]);
    conferir("fora do raio: ninguém pronto e longe → nenhuma rota", criadas(r.acoes).length === 0, r.acoes);
    conferir("… e o motivo é fora-do-raio", motivoDe(r, "p02") === "fora-do-raio" && motivoDe(r, "p01") === "fora-do-raio", r.descartados);
  }
  {
    // Semente a 5 km; candidato a 2,5 km no caminho (2,5 km da semente > raio 2), desvio ~0.
    const r = plano([pedido(1, em(5), 20), pedido(2, em(2.5, 0.1), 25)]);
    conferir("desvio: pedido no caminho entra mesmo fora do raio da semente", mesmoConjunto(criadas(r.acoes)[0] ?? [], ["p01", "p02"]), r.acoes);
    conferir("… e a ordem das paradas é o do caminho primeiro", (criadas(r.acoes)[0] ?? []).join() === "p02,p01", r.acoes);
  }
  {
    // Perto, mas prazo 20 min depois da semente (janela 15).
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.3), 40)]);
    conferir("janela de prazo: prazo 20 min depois não entra", criadas(r.acoes).length === 0, r.acoes);
    conferir("… motivo prazo-incompativel", motivoDe(r, "p02") === "prazo-incompativel", r.descartados);
  }
  {
    // Três vizinhos, máximo 2: o terceiro fica de fora por rota cheia.
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.1), 21), pedido(3, em(1.2), 22)], [], [], { ...CFG, maxEntregasPorRota: 2 });
    const c = criadas(r.acoes);
    conferir("rota cheia: só 2 por rota", c.length === 1 && c[0].length === 2 && c[0].includes("p01"), c);
    conferir("… o que sobrou espera a próxima rota", motivoDe(r, "p03") === "proxima-rota", r.descartados);
  }
  {
    const r = plano([pedido(1, null, 20, pronto(5))]);
    conferir("sem ponto: não entra e diz sem-ponto", criadas(r.acoes).length === 0 && motivoDe(r, "p01") === "sem-ponto", r);
  }
  {
    const r = plano([
      pedido(1, em(1), 20, { fora: "agendado" }), pedido(2, em(1), 20, { fora: "parceiro" }),
      pedido(3, em(1), 20, { fora: "ja-com-motoboy" }), pedido(4, em(1), 20, { fora: "rota-manual" }),
    ]);
    conferir("agendado / parceiro / com motoboy / rota manual: só relatados",
      criadas(r.acoes).length === 0 && motivoDe(r, "p01") === "agendado" && motivoDe(r, "p02") === "parceiro" &&
      motivoDe(r, "p03") === "ja-com-motoboy" && motivoDe(r, "p04") === "rota-manual", r);
  }
  {
    const r1 = plano([pedido(1, em(2), 20)]);
    conferir("sozinho e na cozinha: não cria rota (espera companhia)", criadas(r1.acoes).length === 0 && motivoDe(r1, "p01") === "esperando-companhia", r1);
    const r2 = plano([pedido(1, em(2), 20, pronto(0))]);
    conferir("sozinho e pronto: vira rota de 1", criadas(r2.acoes).length === 1 && criadas(r2.acoes)[0].join() === "p01", r2.acoes);
  }

  console.log("\n== Rota aberta ==");
  {
    const aberta = rota("R1", [pedido(1, em(2), 20)]);
    const r = plano([pedido(2, em(1, 0.2), 25)], [aberta]);
    const a = r.acoes.find((x) => x.tipo === "acrescentar") as Extract<Acao, { tipo: "acrescentar" }> | undefined;
    conferir("crescer rota aberta: o pedido novo que cabe entra", !!a && a.rotaId === "R1" && a.pedidoId === "p02", r.acoes);
    conferir("… na posição certa (mais perto da loja = 1ª parada)", a?.posicao === 1 && a?.ordem.join() === "p02,p01", a);
    conferir("… e não cria rota nova", criadas(r.acoes).length === 0, r.acoes);
  }
  {
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(2))], { chamadaEm: min(-5), chamadaMotoboyId: "m1" });
    const r = plano([pedido(2, em(2.1), 22)], [chamada]);
    conferir("rota chamada + pedido NÃO pronto: não acrescenta (ela espera motoboy) nem chama de novo",
      !r.acoes.some((x) => "rotaId" in x && x.rotaId === "R1"), r.acoes);
  }

  const acrescimos = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "acrescentar" }> => a.tipo === "acrescentar");

  console.log("\n== Uma rota por vez (Douglas, 22/10 20h50) ==");
  {
    // Rota aberta com 1 (máx 3); o #3 cabe pela regra (1 km da semente): entra
    // nela, e ela segue com vaga (2/3).
    const aberta = rota("R1", [pedido(1, em(2), 20)]);
    const r = plano([pedido(3, em(2, 1), 24), pedido(4, em(-3), 25, pronto(1))], [aberta]);
    const a = acrescimos(r.acoes);
    conferir("rota aberta recebe o que cabe pela regra de sempre", a.length === 1 && a[0].pedidoId === "p03", r.acoes);
    conferir("… com vaga ainda (2/3): o de longe NÃO vira rota nova", criadas(r.acoes).length === 0 && motivoDe(r, "p04") === "proxima-rota", { acoes: r.acoes, d: r.descartados });
  }
  {
    // Rota aberta com 2; o #3 entra e ela ENCHE (3/3) no passo 3: o de longe
    // já pode virar a próxima rota (Douglas, 21h30).
    const aberta = rota("R1", [pedido(1, em(2), 20), pedido(2, em(2, 0.3), 22)]);
    const r = plano([pedido(3, em(2, 1), 24), pedido(4, em(-3), 25, pronto(1))], [aberta]);
    conferir("rota que encheu no passo 3: o de longe vira a próxima rota",
      acrescimos(r.acoes).length === 1 && criadas(r.acoes).length === 1 && criadas(r.acoes)[0].join() === "p04", r.acoes);
  }
  {
    // Rota aberta cheia (3/3) esperando motoboy: a próxima já pode nascer —
    // UMA só, mesmo com dois grupos possíveis.
    const cheia = rota("R1", [pedido(1, em(5), 20, pronto(1)), pedido(2, em(5.1), 20, pronto(1)), pedido(3, em(5.2), 20, pronto(1))], { chamadaEm: min(-2) });
    const r = plano([pedido(4, em(-1), 20), pedido(5, em(-1.2), 21), pedido(6, em(0, 4), 22), pedido(7, em(0.2, 4), 23)], [cheia]);
    const c = criadas(r.acoes);
    conferir("rota aberta cheia (3/3) + pedidos novos: nasce UMA rota nova", c.length === 1 && mesmoConjunto(c[0], ["p04", "p05"]), r.acoes);
    conferir("… e o outro grupo espera a próxima (a nova ainda tem vaga)", motivoDe(r, "p06") === "proxima-rota" && motivoDe(r, "p07") === "proxima-rota", r.descartados);
    // Teto 4: a mesma rota de 3 tem vaga — não nasce nada.
    const r4 = plano([pedido(4, em(-1), 20), pedido(5, em(-1.2), 21)], [cheia], [], { ...CFG, maxEntregasPorRota: 4 });
    conferir("se mudar o teto, muda a regra: com teto 4 a rota de 3 tem vaga — não nasce", criadas(r4.acoes).length === 0 && motivoDe(r4, "p04") === "proxima-rota", r4);
  }
  {
    // Rota cheia cujo não pronto saiu (espera estourada): voltou a ter vaga.
    const r = plano(
      [pedido(4, em(-3), 25), pedido(5, em(-3.1), 26)],
      [rota("R1", [pedido(1, em(2), 20, pronto(9)), pedido(2, em(2.1), 21), pedido(3, em(2.2), 22, pronto(9))])],
    );
    conferir("rota cheia que perdeu o não pronto volta a ter vaga: não nasce outra",
      r.acoes.some((x) => x.tipo === "tirar-da-rota") && criadas(r.acoes).length === 0, r.acoes);
  }
  {
    // Sem rota aberta: nasce UMA só, mesmo com dois grupos possíveis.
    const r = plano([pedido(1, em(3), 20), pedido(2, em(3.2), 21), pedido(3, em(-3), 22), pedido(4, em(-3.2), 23)]);
    conferir("sem rota aberta: nasce uma rota só por vez", criadas(r.acoes).length === 1 && mesmoConjunto(criadas(r.acoes)[0], ["p01", "p02"]), r.acoes);
  }

  console.log("\n== Rota chamada que ninguém puxou (D8 revisto, 22/10) ==");
  {
    // (a) Rota de 1 chamada, ninguém na loja puxou; o #2 ficou pronto e cabe.
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(4))], { chamadaEm: min(-3), chamadaMotoboyId: null });
    const r = plano([pedido(2, em(2.1), 22, pronto(1))], [chamada]);
    const a = acrescimos(r.acoes);
    conferir("(a) chamada não puxada + pedido pronto que cabe: acrescenta e marca para reavisar",
      a.length === 1 && a[0].rotaId === "R1" && a[0].pedidoId === "p02" && a[0].rotaChamada === true && mesmoConjunto(a[0].ordem, ["p01", "p02"]), r.acoes);
    conferir("… sem chamar de novo pelo passo 2 nem criar rota", chamadas(r.acoes).length === 0 && criadas(r.acoes).length === 0, r.acoes);
    const aberta = plano([pedido(2, em(2.1), 22)], [rota("R1", [pedido(1, em(2), 20)])]);
    conferir("… rota aberta (não chamada) não leva a marca", acrescimos(aberta.acoes)[0] && !acrescimos(aberta.acoes)[0].rotaChamada, aberta.acoes);
  }
  {
    // (a') Pronto mas longe / prazo fora da janela: as mesmas regras de candidato.
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(4))], { chamadaEm: min(-3) });
    const longe = plano([pedido(2, em(-3), 22, pronto(1))], [chamada]);
    const prazo = plano([pedido(3, em(2.1), 50, pronto(1))], [chamada]);
    conferir("(a') pronto fora do raio ou da janela de prazo: não entra na chamada",
      acrescimos(longe.acoes).length === 0 && acrescimos(prazo.acoes).length === 0, { longe: longe.acoes, prazo: prazo.acoes });
  }
  {
    // (b) Chamada + um pronto e um ainda na chapa, os dois cabem: só o pronto.
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(4))], { chamadaEm: min(-3), chamadaMotoboyId: "m1" });
    const r = plano([pedido(2, em(2.1), 22), pedido(3, em(2.05), 23, pronto(0))], [chamada]);
    const a = acrescimos(r.acoes);
    conferir("(b) chamada: o não pronto não entra, o pronto sim", a.length === 1 && a[0].pedidoId === "p03" && a[0].rotaChamada === true, r.acoes);
  }
  {
    // (c) Já puxada: um pedido dela está com motoboy — congelada, mesmo chamada.
    const puxada = rota("R1", [pedido(1, em(2), 20, { ...pronto(4), fora: "ja-com-motoboy" }), pedido(2, em(2.1), 21, pronto(3))], { chamadaEm: min(-3), chamadaMotoboyId: "m1" });
    const r = plano([pedido(3, em(2.05), 22, pronto(1))], [puxada]);
    conferir("(c) rota chamada já puxada: não acrescenta (puxou, acabou)", acrescimos(r.acoes).length === 0, r.acoes);
  }
  {
    // (d) Teto: max 2, chamada com 1, três prontos que cabem — só um entra.
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(4))], { chamadaEm: min(-3) });
    const r = plano([pedido(2, em(2.1), 22, pronto(1)), pedido(3, em(2.05), 21, pronto(1)), pedido(4, em(2.15), 23, pronto(1))], [chamada], [], { ...CFG, maxEntregasPorRota: 2 });
    conferir("(d) teto max respeitado na rota chamada: 1 + 1 = 2", acrescimos(r.acoes).length === 1, r.acoes);
    const cheia = rota("R2", [pedido(5, em(2), 20, pronto(4)), pedido(6, em(2.1), 21, pronto(4))], { chamadaEm: min(-3) });
    const r2 = plano([pedido(7, em(2.05), 22, pronto(1))], [cheia], [], { ...CFG, maxEntregasPorRota: 2 });
    conferir("… chamada já cheia não recebe nada", acrescimos(r2.acoes).length === 0, r2.acoes);
  }
  {
    // Rechamada agora (D13): um push por vez — cresce só no ciclo seguinte.
    const vencida = rota("R1", [pedido(1, em(2), 20, pronto(70))], { chamadaEm: min(-(RECHAMAR_DEPOIS_MIN + 1)) });
    const r = plano([pedido(2, em(2.1), 22, pronto(1))], [vencida]);
    conferir("rota rechamada neste ciclo não cresce no mesmo ciclo", chamadas(r.acoes).length === 1 && acrescimos(r.acoes).every((x) => x.rotaId !== "R1"), r.acoes);
  }
  {
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(70))], { chamadaEm: min(-(RECHAMAR_DEPOIS_MIN + 1)) });
    const r = plano([], [chamada], [{ id: "m1", nome: "Maicon", naLojaDesde: min(-3), gpsFresco: true }]);
    const c = chamadas(r.acoes);
    conferir("chamada há mais de 60 min sem ninguém puxar: chama de novo", c.length === 1 && c[0].rotaId === "R1" && c[0].motoboyId === "m1", r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(1)), pedido(2, em(2.2), 22, pronto(0))])]);
    conferir("todos prontos (2): chama", chamadas(r.acoes).length === 1, r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(3))])]);
    conferir("rota de 1 pronta há 3 min (espera 8): ainda espera companhia", chamadas(r.acoes).length === 0, r.acoes);
    const r2 = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(9))])]);
    conferir("rota de 1 pronta há 9 min: chama", chamadas(r2.acoes).length === 1, r2.acoes);
  }
  {
    // O mais urgente pronto há 10 min, o outro ainda na chapa: o outro sai e a rota é chamada.
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(10)), pedido(2, em(2.2), 25)])]);
    const tirados = r.acoes.filter((x) => x.tipo === "tirar-da-rota");
    conferir("espera estourada: o não pronto sai da rota", tirados.length === 1 && (tirados[0] as any).pedidoId === "p02" && (tirados[0] as any).motivo === "espera-estourada", r.acoes);
    conferir("… e a rota é chamada com o pronto", chamadas(r.acoes).length === 1 && chamadas(r.acoes)[0].rotaId === "R1", r.acoes);
    conferir("… o que saiu volta ao bolo (espera a próxima rota)", motivoDe(r, "p02") === "proxima-rota", r.descartados);
    const r2 = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(3)), pedido(2, em(2.2), 25)])]);
    conferir("espera NÃO estourada (3 min): nada muda", r2.acoes.length === 0, r2.acoes);
  }

  console.log("\n== Quem é chamado ==");
  const prontaR = (id: string, prazo: number) => rota(id, [pedido(prazo, em(2), prazo, pronto(1)), pedido(prazo + 1, em(2.1), prazo, pronto(1))]);
  {
    const motoboys: Motoboy[] = [
      { id: "m1", nome: "Kaio", naLojaDesde: min(-10), gpsFresco: true },
      { id: "m2", nome: "Maicon", naLojaDesde: min(-20), gpsFresco: true },
      { id: "m3", nome: "Na rua", naLojaDesde: null, gpsFresco: true },
    ];
    const r = plano([], [prontaR("R1", 20)], motoboys);
    conferir("chamada escolhe quem chegou primeiro na loja (naLojaDesde mais antigo)", chamadas(r.acoes)[0]?.motoboyId === "m2", r.acoes);
    const r2 = plano([], [prontaR("R1", 20)], motoboys.map((m) => (m.id === "m2" ? { ...m, gpsFresco: false } : m)));
    conferir("GPS parado há mais de 3 min não conta como na loja", chamadas(r2.acoes)[0]?.motoboyId === "m1", r2.acoes);
    const r3 = plano([], [prontaR("R1", 20), prontaR("R2", 30), prontaR("R3", 40)], motoboys);
    const c3 = chamadas(r3.acoes);
    conferir("três rotas, dois na loja: a mais urgente leva o primeiro, a 2ª o segundo, a 3ª avisa todos",
      c3.map((c) => `${c.rotaId}:${c.motoboyId}`).join() === "R1:m2,R2:m1,R3:null", c3);
    const ocupada = rota("R0", [pedido(80, em(4), 80, pronto(1))], { chamadaEm: min(-2), chamadaMotoboyId: "m2" });
    const r4 = plano([], [ocupada, prontaR("R1", 20)], motoboys);
    conferir("motoboy já chamado para outra rota não é chamado de novo", chamadas(r4.acoes).find((c) => c.rotaId === "R1")?.motoboyId === "m1", r4.acoes);
  }
  {
    const r = plano([], [prontaR("R1", 20)], [{ id: "m3", nome: "Na rua", naLojaDesde: null, gpsFresco: true }]);
    conferir("ninguém na loja → chamar com motoboyId null (avisa todos os livres)", chamadas(r.acoes).length === 1 && chamadas(r.acoes)[0].motoboyId === null, r.acoes);
  }

  console.log("\n== Limpeza ==");
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true }), pedido(2, em(2.1), 22)])]);
    const t = r.acoes.find((x) => x.tipo === "tirar-da-rota") as any;
    conferir("cancelado sai da rota", t?.pedidoId === "p01" && t?.motivo === "cancelado", r.acoes);
    conferir("… e a rota não é apagada (ainda tem o #2)", !r.acoes.some((x) => x.tipo === "apagar-rota"), r.acoes);
  }
  {
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true })])]);
    conferir("rota que ficou vazia é apagada", r.acoes.some((x) => x.tipo === "apagar-rota" && x.rotaId === "R1"), r.acoes);
  }
  {
    const r = plano([pedido(3, em(2.05), 21, pronto(20))], [rota("R1", [pedido(1, em(2), 20, { fora: "ja-com-motoboy" }), pedido(2, em(2.1), 22, pronto(20))])]);
    conferir("rota com um pedido já puxado: não cresce nem é chamada", !r.acoes.some((x) => "rotaId" in x && x.rotaId === "R1"), r.acoes);
  }

  console.log("\n== Ordem das paradas e determinismo ==");
  {
    const ordem = ordenarParadas(LOJA, [{ id: "c", ponto: em(3) }, { id: "a", ponto: em(1) }, { id: "x", ponto: null }, { id: "b", ponto: em(2) }]);
    conferir("menor percurso a partir da loja; sem ponto vai para o fim", ordem.join() === "a,b,c,x", ordem);
  }
  {
    const pedidos = [
      pedido(1, em(1), 20), pedido(2, em(1.2, 0.3), 24), pedido(3, em(-2), 18, pronto(2)), pedido(4, em(-2.3), 30),
      pedido(5, em(0.5, 2), 22, { prioridadeManual: true }), pedido(6, null, 15), pedido(7, em(4), 60),
    ];
    const rotas = [rota("R9", [pedido(8, em(3, 1), 25, pronto(1))])];
    const motoboys: Motoboy[] = [{ id: "m1", nome: "A", naLojaDesde: min(-4), gpsFresco: true }, { id: "m2", nome: "B", naLojaDesde: min(-4), gpsFresco: true }];
    const a = plano(pedidos, rotas, motoboys);
    const b = plano(pedidos, rotas, motoboys);
    const c = plano([...pedidos].reverse(), [...rotas].reverse(), [...motoboys].reverse());
    conferir("mesma entrada → mesma saída", JSON.stringify(a) === JSON.stringify(b));
    conferir("entrada em outra ordem → mesma saída", JSON.stringify(a) === JSON.stringify(c), { a, c });
  }

  console.log("\n== A regra gravada (config.ts) ==");
  {
    conferir("sem nada gravado: o padrão", JSON.stringify(lerRoteirizacaoAutomatica(null)) === JSON.stringify(ROTEIRIZACAO_AUTOMATICA_PADRAO));
    const lida = lerRoteirizacaoAutomatica({ freteGratis: 50, roteirizacaoAutomatica: { ativo: true, maxEntregasPorRota: 12, raioDoGrupoKm: 0.1, esperaMaxMin: "abc", quemPuxa: "qualquer", lixo: 1 } });
    conferir("lê a chave do deliveryConfig e prende nos limites", lida.ativo && lida.maxEntregasPorRota === 6 && lida.raioDoGrupoKm === 0.5 && lida.esperaMaxMin === 8 && lida.quemPuxa === "qualquer", lida);
    conferir("… e não copia chave desconhecida", !("lixo" in lida));
    conferir("quemPuxa inválido vira 'chamado'; ativo só com true", limparRoteirizacaoAutomatica({ quemPuxa: "todos", ativo: "true" }).quemPuxa === "chamado" && limparRoteirizacaoAutomatica({ ativo: "true" }).ativo === false);
    conferir("deliveryConfig com chave 'ativo' solta não liga nada", lerRoteirizacaoAutomatica({ ativo: true }).ativo === false);
  }

  console.log("\n== Liberação e prazo ==");
  {
    conferir("Hakim Centro liberada", liberadaPara("cmpx96phr0000ujf0sb0qk5vr"));
    conferir("loja de demonstração liberada (ensaio com o simulador)", liberadaPara("cmupkiesh0000ujmcjwtpd706"));
    conferir("outra loja não", !liberadaPara("loja-qualquer-fora-da-lista") && !liberadaPara(null));
    conferir("funcionário resolve para a loja do dono", lojaDoUsuario({ id: "func", ownerId: "cmpx96phr0000ujf0sb0qk5vr" }) === "cmpx96phr0000ujf0sb0qk5vr");
    const criado = "2026-10-22T21:00:00.000Z";
    conferir("prazo = criação + tempoEntregaMin", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40 }, []).toISOString() === "2026-10-22T21:40:00.000Z");
    conferir("sem tempo gravado: o maior tempo das áreas", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY" }, [{ time: 30 }, { time: 50 }]).toISOString() === "2026-10-22T21:50:00.000Z");
    conferir("prazo do parceiro (scheduledDatetime) vale primeiro", prazoDoPedido({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: "2026-10-22T21:35:00.000Z", tempoEntregaMin: 60 }, []).toISOString() === "2026-10-22T21:35:00.000Z");
    const agendado = { createdAt: criado, deliveryType: "DELIVERY", agendado: true, scheduledDatetime: "2026-10-23T01:00:00.000Z" };
    conferir("agendado para daqui a 3 h (libera 60 min antes): fora", agendadoParaDepois(agendado, 60, AGORA));
    conferir("agendado para daqui a 50 min: já entra", !agendadoParaDepois({ ...agendado, scheduledDatetime: "2026-10-22T22:50:00.000Z" }, 60, AGORA));
  }

  // ── Fase 1: o que GRAVAR (gravacoes.ts) a partir das ações ───────────────
  const { gravacoesDasAcoes } = await import("../src/lib/roteirizacao-automatica/gravacoes");
  const { pedePrioridadeNaRota } = await import("../src/lib/rotas-da-loja");
  const { pontoParaRotaAutomatica } = await import("../src/lib/roteirizacao-automatica/ponto");
  type Passo = import("../src/lib/roteirizacao-automatica/gravacoes").Passo;
  const lidas = (rotas: Rota[]) => rotas.map((r) => ({ id: r.id, pedidoIds: r.pedidos.map((p) => p.id) }));
  const tipos = (passos: Passo[]) => passos.map((p) => p.tipo).join(",");

  console.log("\n== Fase 1: as gravações ==");
  {
    const r = plano([pedido(1, em(1), 20), pedido(2, em(1.2), 22)]);
    const g = gravacoesDasAcoes(r.acoes, []);
    const criar = g.passos.find((p) => p.tipo === "criar-rota") as Extract<Passo, { tipo: "criar-rota" }> | undefined;
    conferir("criar-rota vira UMA rota nova com os pedidos na ordem das paradas (sequência = posição)",
      g.passos.length === 1 && criar?.pedidoIds.join() === (criadas(r.acoes)[0] ?? []).join() && criar?.pedidoIds.join() === "p01,p02", g);
  }
  {
    // Rota aberta R1 com o #1; o #2 (mais perto da loja) entra na frente.
    const aberta = rota("R1", [pedido(1, em(2), 20)]);
    const r = plano([pedido(2, em(1, 0.2), 25)], [aberta]);
    const g = gravacoesDasAcoes(r.acoes, lidas([aberta]));
    const seq = g.passos.find((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }> | undefined;
    conferir("acrescentar: o pedido entra e a sequência da rota INTEIRA é regravada na ordem nova",
      tipos(g.passos) === "entrar-na-rota,sequencia" && seq?.rotaId === "R1" && seq?.pedidoIds.join() === "p02,p01", g);
  }
  {
    // Duas entradas na mesma rota no mesmo ciclo: uma sequência só, com a última ordem.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"], porque: "teste" },
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p03", posicao: 2, ordem: ["p02", "p03", "p01"], porque: "teste" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seqs = g.passos.filter((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }>[];
    conferir("duas entradas na mesma rota: uma sequência, a última, depois das entradas",
      tipos(g.passos) === "entrar-na-rota,entrar-na-rota,sequencia" && seqs.length === 1 && seqs[0].pedidoIds.join() === "p02,p03,p01", g);
  }
  {
    // Rota que não está entre as AUTO abertas lidas (a manual, a que saiu): não se mexe.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "MANUAL1", pedidoId: "p02", posicao: 1, ordem: ["p02"], porque: "teste" },
      { tipo: "tirar-da-rota", rotaId: "MANUAL1", pedidoId: "p01", motivo: "cancelado" },
      { tipo: "apagar-rota", rotaId: "MANUAL1" },
      { tipo: "chamar", rotaId: "MANUAL1", motoboyId: null },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p09"] }]);
    conferir("rota fora das AUTO abertas (manual): nenhuma gravação",
      g.passos.length === 0 && g.ignoradas.length === 4 && g.ignoradas.every((i) => i.motivo === "rota-desconhecida"), g);
  }
  {
    // Cancelado sozinho na rota: sai, e a rota (vazia) é apagada.
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, { cancelado: true })])]);
    const g = gravacoesDasAcoes(r.acoes, lidas([rota("R1", [pedido(1, em(2), 20)])]));
    conferir("cancelado sai e a rota vazia é apagada (nesta ordem)", tipos(g.passos) === "sair-da-rota,apagar-rota", g);
  }
  {
    // apagar-rota de rota que ainda tem pedido: recusada.
    const g = gravacoesDasAcoes([{ tipo: "apagar-rota", rotaId: "R1" }], [{ id: "R1", pedidoIds: ["p01", "p02"] }]);
    conferir("apagar-rota só se vazia: com pedido, não apaga", g.passos.length === 0 && g.ignoradas[0]?.motivo === "rota-com-pedido", g);
    const g2 = gravacoesDasAcoes(
      [{ tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" }, { tipo: "apagar-rota", rotaId: "R1" }],
      [{ id: "R1", pedidoIds: ["p01", "p02"] }],
    );
    conferir("… tirar um de dois e mandar apagar: sai um, a rota fica", tipos(g2.passos) === "sair-da-rota" && g2.ignoradas[0]?.motivo === "rota-com-pedido", g2);
  }
  {
    // Espera estourada: o não pronto sai; depois (Fase 2) a rota é chamada.
    const aberta = rota("R1", [pedido(1, em(2), 20, pronto(10)), pedido(2, em(2.2), 25)]);
    const r = plano([], [aberta]);
    const g = gravacoesDasAcoes(r.acoes, lidas([aberta]));
    const sai = g.passos[0] as Extract<Passo, { tipo: "sair-da-rota" }> | undefined;
    conferir("espera estourada: o não pronto sai da rota e DEPOIS a rota é chamada",
      tipos(g.passos) === "sair-da-rota,chamar" && sai?.pedidoId === "p02" && sai?.motivo === "espera-estourada", g);
  }
  {
    // Pedido que entrou numa rota aberta não entra também numa rota nova; tirar quem não está na rota é ignorado.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 2, ordem: ["p01", "p02"], porque: "teste" },
      { tipo: "criar-rota", pedidos: ["p02", "p03"], motivo: "teste", porques: {} },
      { tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p07", motivo: "cancelado" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const criar = g.passos.find((p) => p.tipo === "criar-rota") as Extract<Passo, { tipo: "criar-rota" }> | undefined;
    conferir("pedido repetido no ciclo: só a primeira rota leva", criar?.pedidoIds.join() === "p03", g);
    conferir("tirar pedido que não está na rota: ignorado", g.ignoradas.some((i) => i.motivo === "fora-da-rota") && !g.passos.some((p) => p.tipo === "sair-da-rota"), g);
  }
  {
    // Saída depois de entrada na mesma rota: a sequência não leva quem saiu.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"], porque: "teste" },
      { tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seq = g.passos.find((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }> | undefined;
    conferir("sequência regravada só com quem ficou na rota", seq?.pedidoIds.join() === "p02", g);
  }
  {
    // D8 revisto: a rota chamada que cresceu avisa UMA vez, por último, com a rota pronta.
    const chamada = rota("R1", [pedido(1, em(2), 20, pronto(4))], { chamadaEm: min(-3) });
    const r = plano([pedido(2, em(2.1), 22, pronto(1)), pedido(3, em(2.05), 21, pronto(1))], [chamada]);
    const g = gravacoesDasAcoes(r.acoes, lidas([chamada]));
    const entradas = g.passos.filter((p): p is Extract<Passo, { tipo: "entrar-na-rota" }> => p.tipo === "entrar-na-rota");
    conferir("rota chamada que cresceu: entradas marcadas, sequência e UM avisar-mudanca no fim",
      tipos(g.passos) === "entrar-na-rota,entrar-na-rota,sequencia,avisar-mudanca" && entradas.every((p) => p.rotaChamada === true), g);
    const aberta = rota("R2", [pedido(5, em(2), 20)]);
    const g2 = gravacoesDasAcoes(plano([pedido(6, em(2.1), 22)], [aberta]).acoes, lidas([aberta]));
    conferir("… rota aberta que cresceu: sem aviso", tipos(g2.passos) === "entrar-na-rota,sequencia", g2);
    const g3 = gravacoesDasAcoes(
      [{ tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"], rotaChamada: true, porque: "teste" }, { tipo: "fechar-rota", rotaId: "R1" }],
      [{ id: "R1", pedidoIds: ["p01"] }],
    );
    conferir("… rota que fechou no mesmo ciclo: nada de aviso", !g3.passos.some((p) => p.tipo === "avisar-mudanca"), g3);
  }
  {
    conferir("prioridade no KDS: na cozinha pede, pronto/saiu/entregue não",
      pedePrioridadeNaRota("ACEITO") && pedePrioridadeNaRota("PREPARANDO") && !pedePrioridadeNaRota("PRONTO") && !pedePrioridadeNaRota("SAIU_ENTREGA") && !pedePrioridadeNaRota("ENTREGUE"));
    const area = { centro: LOJA, raioKm: 8, raioDoParceiroKm: 12, base: "faixas" as const };
    const p = em(1.5);
    conferir("ponto da rota automática: o do cliente vale", !!pontoParaRotaAutomatica({ ...p, origem: "pino" }, false, area));
    conferir("… o centro do bairro NÃO (D3)", pontoParaRotaAutomatica({ ...p, origem: "bairro" }, false, area) === null);
    conferir("… sem nada gravado, nada", pontoParaRotaAutomatica(null, false, area) === null);
  }

  // ── Fase 2: a chamada do motoboy ─────────────────────────────────────────
  const { chamadaVencida, MOTIVO_EM_PORTUGUES } = await import("../src/lib/roteirizacao-automatica/planejador");
  const { avisoDaRotaPronta, avisoDaRotaFoiComOutro, avisoDaRotaJaSaiu, quemRecebeAChamada, quemPerdeAChamada, quemSabeQueARotaJaSaiu } = await import("../src/lib/roteirizacao-automatica/chamada");
  const naLoja = (id: string, nome: string, haMin: number): Motoboy => ({ id, nome, naLojaDesde: min(-haMin), gpsFresco: true });
  const prontaComDois = (id: string, extra: Partial<Rota> = {}) =>
    rota(id, [pedido(1, em(2), 20, pronto(2)), pedido(2, em(2.1), 22, pronto(1))], extra);

  console.log("\n== Fase 2: quem é chamado ==");
  {
    const r = plano([], [prontaComDois("R1")], [naLoja("m1", "Maicon", 10)], { ...CFG, quemPuxa: "qualquer" });
    conferir("quemPuxa 'qualquer': chamada sempre para todos (motoboyId null), mesmo com motoboy na loja",
      chamadas(r.acoes).length === 1 && chamadas(r.acoes)[0].motoboyId === null, r.acoes);
    const r2 = plano([], [prontaComDois("R1")], [naLoja("m1", "Maicon", 10)]);
    conferir("… e com 'chamado' (padrão) vai para quem está na loja", chamadas(r2.acoes)[0]?.motoboyId === "m1", r2.acoes);
    const r3 = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(70))], { chamadaEm: min(-61), chamadaMotoboyId: "m1" })], [naLoja("m2", "Kaio", 5)], { ...CFG, quemPuxa: "qualquer" });
    conferir("… rechamada no 'qualquer' também é para todos", chamadas(r3.acoes)[0]?.motoboyId === null, r3.acoes);
  }
  {
    conferir("chamadaVencida: nunca chamada não venceu", !chamadaVencida(null, AGORA));
    conferir("chamadaVencida: 59 e 60 min não, 61 min sim",
      !chamadaVencida(min(-59), AGORA) && !chamadaVencida(min(-60), AGORA) && chamadaVencida(min(-61), AGORA));
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, pronto(70))], { chamadaEm: min(-59), chamadaMotoboyId: "m1" })], [naLoja("m1", "Maicon", 3)]);
    conferir("rota chamada há 59 min: não chama de novo (um push por hora)", chamadas(r.acoes).length === 0, r.acoes);
  }

  console.log("\n== Fase 2: a rota que terminou sozinha ==");
  {
    const comMotoboy = { fora: "ja-com-motoboy" as const };
    const r = plano([], [rota("R1", [pedido(1, em(2), 20, comMotoboy), pedido(2, em(2.1), 22, comMotoboy)])]);
    conferir("todos puxados um a um ('Só este'): fechar-rota, sem chamar",
      r.acoes.length === 1 && r.acoes[0].tipo === "fechar-rota" && (r.acoes[0] as any).rotaId === "R1", r.acoes);
    const r2 = plano([], [rota("R1", [pedido(1, em(2), 20, comMotoboy), pedido(2, em(2.1), 22, { finalizado: true })])]);
    conferir("um puxado + um já entregue: fechar-rota", r2.acoes.map((a) => a.tipo).join() === "fechar-rota", r2.acoes);
    const r3 = plano([], [rota("R1", [pedido(1, em(2), 20, comMotoboy), pedido(2, em(2.1), 22, { cancelado: true })])]);
    conferir("um puxado + um cancelado: o cancelado sai e a rota fecha", r3.acoes.map((a) => a.tipo).join() === "tirar-da-rota,fechar-rota", r3.acoes);
    const r4 = plano([], [rota("R1", [pedido(1, em(2), 20, comMotoboy), pedido(2, em(2.1), 22, pronto(1))])]);
    conferir("um puxado + um esperando: a rota segue aberta (nada a fazer)", r4.acoes.length === 0, r4.acoes);
    const r5 = plano([pedido(3, em(2.05), 21)], [rota("R1", [pedido(1, em(2), 20, { finalizado: true }), pedido(2, em(2.1), 22)])]);
    conferir("entregue sem motoboy não conta como companhia: a rota não é chamada com ele", chamadas(r5.acoes).length === 0, r5.acoes);

    const g = gravacoesDasAcoes(r3.acoes, lidas([rota("R1", [pedido(1, em(2), 20), pedido(2, em(2.1), 22)])]));
    conferir("gravação: sair-da-rota e depois fechar-rota (DISPATCHED sem efeitos, sem push)", tipos(g.passos) === "sair-da-rota,fechar-rota", g);
    const g2 = gravacoesDasAcoes([{ tipo: "fechar-rota", rotaId: "MANUAL1" }], [{ id: "R1", pedidoIds: ["p01"] }]);
    conferir("fechar-rota de rota que não é AUTO aberta: ignorada", g2.passos.length === 0 && g2.ignoradas[0]?.motivo === "rota-desconhecida", g2);
  }

  console.log("\n== Fase 2: a gravação da chamada ==");
  {
    const g = gravacoesDasAcoes([{ tipo: "chamar", rotaId: "R1", motoboyId: "m1" }], [{ id: "R1", pedidoIds: ["p01", "p02"] }]);
    const c = g.passos[0] as Extract<Passo, { tipo: "chamar" }> | undefined;
    conferir("chamar vira o passo 'chamar' com o motoboy (e nada nos pedidos)",
      g.passos.length === 1 && c?.tipo === "chamar" && c.rotaId === "R1" && c.motoboyId === "m1" && !("pedidoId" in (c as any)) && !("pedidoIds" in (c as any)), g);
    const g2 = gravacoesDasAcoes([{ tipo: "chamar", rotaId: "R1", motoboyId: null }], [{ id: "R1", pedidoIds: ["p01"] }]);
    conferir("chamar todos: passo com motoboyId null", (g2.passos[0] as any)?.motoboyId === null, g2);
    const g3 = gravacoesDasAcoes(
      [{ tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" }, { tipo: "chamar", rotaId: "R1", motoboyId: "m1" }],
      [{ id: "R1", pedidoIds: ["p01"] }],
    );
    conferir("chamar rota que ficou vazia no ciclo: ignorada", !g3.passos.some((p) => p.tipo === "chamar") && g3.ignoradas.some((i) => i.motivo === "vazia"), g3);
  }

  console.log("\n== Fase 2: o push ==");
  {
    const a = avisoDaRotaPronta({ id: "R7", routeNumber: "Rota #7" }, [18, 12, 15], false);
    conferir("ROTA_PRONTA para o chamado: título e corpo do plano",
      a.titulo === "🛵 Rota #7 pronta na loja" && a.corpo === "3 entregas: #12, #15, #18. Vai lá buscar." && a.dados.tipo === "ROTA_PRONTA" && a.dados.rotaId === "R7", a);
    const t = avisoDaRotaPronta({ id: "R7", routeNumber: "Rota #7" }, [12, 15, 18], true);
    conferir("… para todos: 'Quem chegar primeiro sai com ela.'", t.corpo === "3 entregas: #12, #15, #18. Quem chegar primeiro sai com ela.", t);
    conferir("… uma entrega no singular", avisoDaRotaPronta({ id: "R7", routeNumber: "Rota #7" }, [12], false).corpo === "1 entrega: #12. Vai lá buscar.");
    const o = avisoDaRotaFoiComOutro({ id: "R7", routeNumber: "Rota #7" }, "Maicon Souza");
    conferir("ROTA_FOI_COM_OUTRO: 'Rota #7 foi com Maicon'",
      o.titulo === "Rota #7 foi com Maicon" && o.corpo === "A loja trocou o entregador desta rota." && o.dados.tipo === "ROTA_FOI_COM_OUTRO", o);
    conferir("quem recebe: o chamado sozinho; null = todos os livres",
      quemRecebeAChamada("m1", ["m1", "m2"]).join() === "m1" && quemRecebeAChamada(null, ["m1", "m2", "m2"]).join() === "m1,m2");
    conferir("quem perde: só o chamado anterior trocado por OUTRO motoboy",
      quemPerdeAChamada("m1", "m2") === "m1" && quemPerdeAChamada("m1", "m1") === null && quemPerdeAChamada("m1", null) === null && quemPerdeAChamada(null, "m2") === null);
    const j = avisoDaRotaJaSaiu({ id: "R7", routeNumber: "Rota #7" }, "Maicon Souza");
    conferir("ROTA_JA_SAIU: 'Rota #7 já saiu' · 'Maicon levou a Rota #7.'",
      j.titulo === "Rota #7 já saiu" && j.corpo === "Maicon levou a Rota #7." && j.dados.tipo === "ROTA_JA_SAIU" && j.dados.rotaId === "R7", j);
    conferir("… sem nome: 'Outro entregador levou a Rota #7.'", avisoDaRotaJaSaiu({ id: "R7", routeNumber: "Rota #7" }, "  ").corpo === "Outro entregador levou a Rota #7.");
    conferir("quem sabe que saiu: os livres sem repetir, NUNCA quem levou",
      quemSabeQueARotaJaSaiu(["m1", "m2", "m2", "m3"], "m2").join() === "m1,m3" && quemSabeQueARotaJaSaiu(["m2"], "m2").length === 0);
  }

  // ── chamarARota com um Prisma falso e o Expo interceptado ────────────────
  console.log("\n== Fase 2: chamarARota (Prisma falso) ==");
  {
    const fake = (globalThis as any).prisma;
    const chamadas: { onde: string; args: any }[] = [];
    let rotaNoBanco: any = null;
    const numeros = [18, 12, 15];
    fake.routeSchedule = {
      findFirst: async (args: any) => { chamadas.push({ onde: "routeSchedule.findFirst", args }); return rotaNoBanco; },
      updateMany: async (args: any) => { chamadas.push({ onde: "routeSchedule.updateMany", args }); return { count: rotaNoBanco ? 1 : 0 }; },
    };
    fake.customerOrder = {
      findMany: async (args: any) => {
        chamadas.push({ onde: "customerOrder.findMany", args });
        if (args?.distinct) return [{ motoboyId: "m3" }]; // m3 está com pedido: não é livre
        return numeros.map((n) => ({ dailyOrderNumber: n }));
      },
      updateMany: async (args: any) => { chamadas.push({ onde: "customerOrder.updateMany", args }); return { count: 1 }; },
      update: async (args: any) => { chamadas.push({ onde: "customerOrder.update", args }); return {}; },
    };
    fake.motoboy = {
      findMany: async () => [
        { id: "m1", name: "Maicon Souza", lastLocationUpdate: AGORA, naLojaDesde: min(-5) },
        { id: "m2", name: "Kaio", lastLocationUpdate: AGORA, naLojaDesde: null },
        { id: "m3", name: "Ocupado", lastLocationUpdate: AGORA, naLojaDesde: null },
      ],
    };
    // lib/app-motoboy/aparelhos.ts: a tabela "existe" e cada motoboy tem um aparelho.
    fake.$executeRawUnsafe = async () => 0;
    fake.$executeRaw = async () => 0;
    fake.$queryRaw = async (_partes: TemplateStringsArray, ...valores: any[]) => [{ pushToken: `ExponentPushToken[aparelho-${valores[0]}]` }];
    const pushes: { para: string; titulo: string; corpo: string; tipo: string }[] = [];
    const fetchDeVerdade = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      for (const m of JSON.parse(init.body)) pushes.push({ para: m.to, titulo: m.title, corpo: m.body, tipo: m.data?.tipo });
      return { ok: true, json: async () => ({ data: [] }) };
    };
    const esperarPushes = () => new Promise((r) => setTimeout(r, 30));
    const { chamarARota } = await import("../src/lib/roteirizacao-automatica/executar");
    const aparelho = (id: string) => `ExponentPushToken[aparelho-${id}]`;

    try {
      // 1. Chamada para o Maicon (quem está na loja).
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: null, chamadaMotoboyId: null };
      const r = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: "m1", soSeVencida: true, agora: AGORA });
      await esperarPushes();
      const grav = chamadas.find((c) => c.onde === "routeSchedule.updateMany");
      conferir("chamada grava chamadaEm = agora e chamadaMotoboyId na ROTA",
        r.ok && grav?.args.data.chamadaEm.getTime() === AGORA.getTime() && grav?.args.data.chamadaMotoboyId === "m1" && Object.keys(grav?.args.data).length === 2, grav?.args);
      conferir("… só rota AUTO aberta desta loja, condicional ao chamadaEm lido",
        grav?.args.where.origem === "AUTO" && grav?.args.where.status === "PENDING" && grav?.args.where.franchiseeId === "L1" && grav?.args.where.chamadaEm === null, grav?.args.where);
      conferir("… e NÃO toca CustomerOrder.motoboyId (nenhuma escrita em pedido)",
        !chamadas.some((c) => c.onde === "customerOrder.updateMany" || c.onde === "customerOrder.update"), chamadas.map((c) => c.onde));
      conferir("… push ROTA_PRONTA só para o chamado",
        pushes.length === 1 && pushes[0].para === aparelho("m1") && pushes[0].tipo === "ROTA_PRONTA" && pushes[0].corpo === "3 entregas: #12, #15, #18. Vai lá buscar.", pushes);

      // 2. Ninguém na loja: todos os ativos e livres (o m3 está com pedido).
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R8", routeNumber: "Rota #8", chamadaEm: null, chamadaMotoboyId: null };
      const r2 = await chamarARota({ lojaId: "L1", rotaId: "R8", motoboyId: null, soSeVencida: true, agora: AGORA });
      await esperarPushes();
      const paraQuem = pushes.map((p) => p.para).sort().join();
      conferir("ninguém na loja (null): push a todos os livres, não a quem está com pedido",
        r2.ok && paraQuem === [aparelho("m1"), aparelho("m2")].sort().join() && pushes.every((p) => p.corpo.endsWith("Quem chegar primeiro sai com ela.")), pushes);
      conferir("… e chamadaMotoboyId null na rota",
        chamadas.find((c) => c.onde === "routeSchedule.updateMany")?.args.data.chamadaMotoboyId === null);

      // 3. Rechamada antes da hora: nada gravado, nada enviado.
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: min(-30), chamadaMotoboyId: "m1" };
      const r3 = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: "m2", soSeVencida: true, agora: AGORA });
      await esperarPushes();
      conferir("cron chamando de novo com 30 min: recusa, sem gravar e sem push",
        !r3.ok && !chamadas.some((c) => c.onde === "routeSchedule.updateMany") && pushes.length === 0, { r3, chamadas, pushes });

      // 4. Rechamada depois de 61 min, agora para o Kaio: o Maicon fica sabendo.
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: min(-61), chamadaMotoboyId: "m1" };
      const r4 = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: "m2", soSeVencida: true, agora: AGORA });
      await esperarPushes();
      const pronta = pushes.find((p) => p.tipo === "ROTA_PRONTA");
      const foi = pushes.find((p) => p.tipo === "ROTA_FOI_COM_OUTRO");
      conferir("rechamada depois de 61 min: ROTA_PRONTA ao novo e ROTA_FOI_COM_OUTRO ao anterior",
        r4.ok && pushes.length === 2 && pronta?.para === aparelho("m2") && foi?.para === aparelho("m1") && foi?.titulo === "Rota #7 foi com Kaio", pushes);

      // 5. A loja ("Chamar de novo") chama na hora, sem esperar a hora: o mesmo motoboy, sem ROTA_FOI_COM_OUTRO.
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: min(-2), chamadaMotoboyId: "m1" };
      const r5 = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: "m1", agora: AGORA });
      await esperarPushes();
      conferir("'Chamar de novo' da loja: grava na hora e só o ROTA_PRONTA ao mesmo",
        r5.ok && pushes.length === 1 && pushes[0].para === aparelho("m1") && pushes[0].tipo === "ROTA_PRONTA", pushes);

      // 6. Rota que já saiu (ou não é AUTO): nada.
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = null;
      const r6 = await chamarARota({ lojaId: "L1", rotaId: "R9", motoboyId: "m1", agora: AGORA });
      await esperarPushes();
      conferir("rota que não está aberta: recusa, sem push", !r6.ok && pushes.length === 0);

      // 6b. D8 revisto: a rota chamada para o Maicon cresceu — a chamada sai de
      //     novo para ELE (o motoboyId passado é ignorado), com "atualizada".
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: min(-5), chamadaMotoboyId: "m1" };
      const r6b = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: "m2", rotaMudou: true, agora: AGORA });
      await esperarPushes();
      const g6b = chamadas.find((c) => c.onde === "routeSchedule.updateMany")?.args;
      conferir("rota mudou: reenvia ao MESMO chamado, título 'atualizada', tipo ROTA_PRONTA",
        r6b.ok && r6b.entregas === 3 && pushes.length === 1 && pushes[0].para === aparelho("m1") && pushes[0].tipo === "ROTA_PRONTA" &&
          pushes[0].titulo === "🛵 Rota #7 atualizada" && pushes[0].corpo === "Agora 3 entregas: #12, #15, #18. Vai lá buscar.", { r6b, pushes });
      conferir("… trava no UPDATE: mesma chamada, mesmo chamado e nenhum pedido com motoboy",
        g6b?.where.chamadaEm?.getTime() === min(-5).getTime() && g6b?.where.chamadaMotoboyId === "m1" &&
          g6b?.where.orders?.none?.motoboyId?.not === null && g6b?.data.chamadaMotoboyId === "m1", g6b);
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: null, chamadaMotoboyId: null };
      const r6c = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: null, rotaMudou: true, agora: AGORA });
      await esperarPushes();
      conferir("… rota que nunca foi chamada: o aviso de mudança não sai",
        !r6c.ok && pushes.length === 0 && !chamadas.some((c) => c.onde === "routeSchedule.updateMany"), { r6c, pushes });
      chamadas.length = 0; pushes.length = 0;
      rotaNoBanco = { id: "R7", routeNumber: "Rota #7", chamadaEm: min(-5), chamadaMotoboyId: "m1" };
      const updateDeVerdade = fake.routeSchedule.updateMany;
      fake.routeSchedule.updateMany = async (args: any) => { chamadas.push({ onde: "routeSchedule.updateMany", args }); return { count: 0 }; };
      const r6d = await chamarARota({ lojaId: "L1", rotaId: "R7", motoboyId: null, rotaMudou: true, agora: AGORA });
      fake.routeSchedule.updateMany = updateDeVerdade;
      await esperarPushes();
      conferir("… puxada entre a leitura e o aviso (UPDATE casa 0): sem push", !r6d.ok && pushes.length === 0, { r6d, pushes });

      // 7. A chamada para todos da Rota #8 foi levada pelo Kaio: o Maicon
      //    (livre) fica sabendo; o Kaio não; o m3 (com pedido) não.
      pushes.length = 0;
      fake.routeSchedule.findUnique = async (args: any) => {
        chamadas.push({ onde: "routeSchedule.findUnique", args });
        return { id: "R8", routeNumber: "Rota #8", franchiseeId: "L1" };
      };
      const { avisarQueARotaJaSaiu } = await import("../src/lib/roteirizacao-automatica/executar");
      await avisarQueARotaJaSaiu({ rotaId: "R8", quemLevou: { id: "m2", nome: "Kaio" } });
      conferir("ROTA_JA_SAIU aos outros livres, nunca a quem levou nem a quem está com pedido",
        pushes.length === 1 && pushes[0].para === aparelho("m1") && pushes[0].tipo === "ROTA_JA_SAIU" &&
          pushes[0].titulo === "Rota #8 já saiu" && pushes[0].corpo === "Kaio levou a Rota #8.", pushes);
      fake.routeSchedule.findUnique = async () => { throw new Error("banco fora"); };
      let lancou = false;
      try { await avisarQueARotaJaSaiu({ rotaId: "R8", quemLevou: { id: "m2", nome: "Kaio" } }); } catch { lancou = true; }
      conferir("… e com o banco fora não lança (o puxar e o despacho não esperam por isto)", !lancou);
    } finally {
      (globalThis as any).fetch = fetchDeVerdade;
    }
  }

  console.log("\n== Fase 2: fora da automática (tirado pela loja) ==");
  {
    const r = plano([pedido(1, em(1), 20, { fora: "tirado-pela-loja" }), pedido(2, em(1.2), 22, { fora: "tirado-pela-loja" })]);
    conferir("pedidos tirados pela loja não viram rota", criadas(r.acoes).length === 0, r.acoes);
    conferir("… e saem como descartados com o motivo 'tirado-pela-loja'",
      motivoDe(r, "p01") === "tirado-pela-loja" && motivoDe(r, "p02") === "tirado-pela-loja", r.descartados);
    conferir("… com o texto em português no mapa de motivos", /tirou da rota automática/.test(MOTIVO_EM_PORTUGUES["tirado-pela-loja"]));
    const voltou = plano([pedido(1, em(1), 20), pedido(2, em(1.2), 22, { fora: "tirado-pela-loja" })]);
    conferir("um voltou (marca limpa), o outro não: o que voltou não leva o outro junto",
      !criadas(voltou.acoes).some((g) => g.includes("p02")) && motivoDe(voltou, "p02") === "tirado-pela-loja", voltou);
    const os2 = plano([pedido(1, em(1), 20), pedido(2, em(1.2), 22)]);
    conferir("'voltar' limpa a marca: no ciclo seguinte os dois se juntam de novo", criadas(os2.acoes).length === 1 && mesmoConjunto(criadas(os2.acoes)[0], ["p01", "p02"]), os2.acoes);
    const naRota = plano([], [rota("R1", [pedido(1, em(2), 20, { ...pronto(2), fora: null }), pedido(2, em(2.1), 22, pronto(1))])], [naLoja("m1", "Maicon", 3)]);
    conferir("pedido de rota AUTO aberta não é afetado (a marca só vale fora de rota)", chamadas(naRota.acoes).length === 1, naRota.acoes);
  }

  // ── Fase 3: a ordem das paradas pela rua ─────────────────────────────────
  console.log("\n== Fase 3: a ordem das paradas pela rua ==");
  {
    const { ordenarParadasPorMedida } = await import("../src/lib/roteirizacao-automatica/ordem-por-rua");
    // A ao lado da loja na reta, mas do outro lado do rio: 5 km de rua.
    const A = em(1), B = em(0, 1.5), C = em(2);
    const nomeDo = (p: Ponto) => (p === LOJA ? "L" : p === A ? "A" : p === B ? "B" : p === C ? "C" : "?");
    const rua: Record<string, number> = { "L>A": 5, "L>B": 1.6, "L>C": 3, "B>A": 4, "A>B": 4, "B>C": 2.5, "C>B": 2.5, "A>C": 1, "C>A": 1 };
    const pernas: string[] = [];
    const medirFalso = (falhar?: string) => async (a: Ponto, b: Ponto) => {
      const perna = `${nomeDo(a)}>${nomeDo(b)}`;
      pernas.push(perna);
      return perna === falhar ? null : rua[perna] ?? null;
    };
    const paradas = [{ id: "pA", ponto: A }, { id: "pB", ponto: B }, { id: "pC", ponto: C }];
    const reta = ordenarParadas(LOJA, paradas);
    const r = await ordenarParadasPorMedida(LOJA, paradas, medirFalso());
    conferir("linha reta: B, A, C (o menor percurso no mapa)", reta.join() === "pB,pA,pC", reta);
    conferir("pela rua: B, C, A — o menor percurso de MOTO, diferente da reta", r.fonte === "rua" && r.ordem.join() === "pB,pC,pA" && !r.falha, r);
    conferir("… medindo cada perna uma vez: 3 da loja + 6 entre as paradas (os dois sentidos)", pernas.length === 9 && new Set(pernas).size === 9, pernas);

    pernas.length = 0;
    const f = await ordenarParadasPorMedida(LOJA, paradas, medirFalso("B>C"));
    conferir("uma perna sem medida (B>C): a rota inteira fica em linha reta", f.fonte === "linha-reta" && f.ordem.join() === reta.join() && !!f.falha, f);

    const lanca = await ordenarParadasPorMedida(LOJA, paradas, async () => { throw new Error("rede"); });
    conferir("`medir` que lança: linha reta, sem lançar", lanca.fonte === "linha-reta" && lanca.ordem.join() === reta.join(), lanca);

    const t0 = Date.now();
    const lenta = await ordenarParadasPorMedida(LOJA, paradas, (a, b) => new Promise((ok) => setTimeout(() => ok(rua[`${nomeDo(a)}>${nomeDo(b)}`] ?? null), 200)), { tetoMs: 30 });
    const levou = Date.now() - t0;
    conferir("teto estourado (30 ms, cada perna 200 ms): linha reta, sem esperar o roteador", lenta.fonte === "linha-reta" && lenta.ordem.join() === reta.join() && /passou de 30 ms/.test(lenta.falha || "") && levou < 150, { lenta, levou });

    let prazoVisto = 0;
    await ordenarParadasPorMedida(LOJA, paradas, async (a, b, prazo) => { prazoVisto = prazo; return rua[`${nomeDo(a)}>${nomeDo(b)}`] ?? null; });
    conferir("o `medir` recebe o fim do tempo (4 s por padrão) para passar ao rotaEntre", prazoVisto > Date.now() + 3_000 && prazoVisto <= Date.now() + 4_000, prazoVisto - Date.now());

    pernas.length = 0;
    const comSemPonto = await ordenarParadasPorMedida(LOJA, [...paradas, { id: "pD", ponto: null }], medirFalso());
    conferir("pedido sem ponto vai para o fim, sem perna medida para ele", comSemPonto.ordem.join() === "pB,pC,pA,pD" && pernas.every((x) => !x.includes("?")), { comSemPonto, pernas });

    pernas.length = 0;
    const uma = await ordenarParadasPorMedida(LOJA, [{ id: "pA", ponto: A }], medirFalso());
    conferir("uma parada só: nada a medir, nenhuma falha a relatar", uma.ordem.join() === "pA" && pernas.length === 0 && !uma.falha, { uma, pernas });
    const semTempo = await ordenarParadasPorMedida(LOJA, paradas, medirFalso(), { tetoMs: 0 });
    conferir("sem tempo no ciclo (teto 0): linha reta sem perguntar", semTempo.fonte === "linha-reta" && semTempo.ordem.join() === reta.join() && pernas.length === 0, semTempo);
  }

  // ── Pela rua (Douglas, 22/10/2026 21h15–21h30) ───────────────────────────
  console.log("\n== Encaixe pela rua: o rio, qualquer parada, menor percurso ==");
  const { encaixe } = await import("../src/lib/roteirizacao-automatica/planejador");
  /** Tabela falsa de km de rua, simétrica, por par de ids ("loja" = LOJA_NA_TABELA). */
  const tabela = (km: Record<string, number>) => (a: string, b: string) => km[`${a}|${b}`] ?? km[`${b}|${a}`] ?? null;
  {
    // O #34 e o #26 da Hakim: 1,5 km em linha reta, mas um valão no meio —
    // de moto são 4 km (tem que subir para a pista).
    const p1 = pedido(1, em(3), 20), p2 = pedido(2, em(3, 1.5), 25);
    const reta = plano([p1, p2]);
    conferir("rio: em linha reta (sem medida) os dois a 1,5 km se juntam", mesmoConjunto(criadas(reta.acoes)[0] ?? [], ["p01", "p02"]), reta.acoes);
    const rio = plano([p1, p2], [], [], CFG, tabela({ "p01|p02": 4, [`${LOJA_NA_TABELA}|p01`]: 3.4, [`${LOJA_NA_TABELA}|p02`]: 3.9 }));
    conferir("rio: reta de 1,5 km que dá 4 km de rua NÃO junta", criadas(rio.acoes).length === 0 && motivoDe(rio, "p02") === "fora-do-raio", rio);
    const soOPar = plano([p1, p2], [], [], CFG, tabela({ "p01|p02": 4 }));
    conferir("… e sem as pernas da loja (o par pela rua já desmentiu a reta) o \"no caminho\" em reta não junta", criadas(soOPar.acoes).length === 0, soOPar);
    const vazia = plano([p1, p2], [], [], CFG, () => null);
    conferir("fallback: tabela sem medida nenhuma = a linha reta de antes", JSON.stringify(vazia) === JSON.stringify(reta), { vazia, reta });
    const perto = plano([p1, p2], [], [], CFG, tabela({ "p01|p02": 1.9 }));
    conferir("rua de 1,9 km (≤ 2): junta", mesmoConjunto(criadas(perto.acoes)[0] ?? [], ["p01", "p02"]), perto.acoes);
  }
  {
    // Rota da Hakim (22/10, 21h15), coordenadas reais: #34 perto da loja
    // (semente, o mais urgente), #33 na Maria Turri; o #35 (Nova Aliança)
    // fica no caminho da loja até o #33, mas longe do #34.
    const HAKIM: Ponto = { lat: -22.5187175, lng: -41.9418978 };
    const p33 = pedido(33, { lat: -22.5229604, lng: -41.9817868 }, 25);
    const p34 = pedido(34, { lat: -22.510523, lng: -41.953844 }, 20);
    const p35 = pedido(35, { lat: -22.530717, lng: -41.95746 }, 28);
    conferir("#35 não cabe com a semente (#34) sozinha — era o que barrava", !encaixe(HAKIM, p34, p35, CFG).ok);
    const r = planejar({ loja: HAKIM, config: CFG, pedidos: [p35], rotasAbertas: [rota("R11", [p34, p33])], motoboys: [], agora: AGORA });
    const a = acrescimos(r.acoes);
    conferir("qualquer parada: o #35 entra na rota de 33 + 34 pela parada 33", a.length === 1 && a[0].rotaId === "R11" && a[0].pedidoId === "p35", r.acoes);
    conferir("… e a ordem (menor percurso, linha reta) é 34 → 35 → 33", a[0]?.ordem.join() === "p34,p35,p33", a[0]);
    // Janela ancorada na semente: o #35 com prazo 40 (20 min depois do #34) não entra.
    const fora = planejar({ loja: HAKIM, config: CFG, pedidos: [{ ...p35, prazo: min(40) }], rotasAbertas: [rota("R11", [p34, p33])], motoboys: [], agora: AGORA });
    conferir("… a janela de prazo continua ancorada na semente (#34)", acrescimos(fora.acoes).length === 0, fora.acoes);
  }
  {
    // Hakim, 22/10 21h35: rota aberta (chamada, ninguém puxou) com #36 e #37
    // prontos; o #39 (Costazul) pronto, fora de rota. Caminho do Douglas:
    // loja → desce para a avenida → #39 → sobe pela orla → #36/#37. Desvio
    // ~2 km: passava do limite antigo do "no caminho" (1,5 km), cabe no raio.
    const HAKIM: Ponto = { lat: -22.5187175, lng: -41.9418978 };
    const P36: Ponto = { lat: -22.498627, lng: -41.917278 }, P37: Ponto = { lat: -22.497458, lng: -41.921505 }, P39: Ponto = { lat: -22.523739, lng: -41.921258 };
    const p36 = pedido(36, P36, 20, pronto(3)), p37 = pedido(37, P37, 22, pronto(2)), p39 = pedido(39, P39, 25, pronto(1));
    const aberta = rota("R12", [p36, p37], { chamadaEm: min(-1), chamadaMotoboyId: null });
    const ruaFalsa = tabela({
      [`${LOJA_NA_TABELA}|p39`]: 2.6, [`${LOJA_NA_TABELA}|p37`]: 3.9, [`${LOJA_NA_TABELA}|p36`]: 4.1,
      "p37|p39": 3.2, "p36|p39": 3.4, "p36|p37": 0.6,
    });
    for (const [nomeDaRegua, rua] of [["linha reta", undefined], ["rua", ruaFalsa]] as const) {
      const r = planejar({ loja: HAKIM, config: CFG, pedidos: [p39], rotasAbertas: [aberta], motoboys: [], agora: AGORA, pelaRua: rua });
      const a = acrescimos(r.acoes);
      conferir(`#39 no caminho do #36/#37 pela orla (desvio ~2 km ≤ raio) entra na rota chamada — ${nomeDaRegua}`,
        a.length === 1 && a[0].pedidoId === "p39" && a[0].rotaChamada === true, r);
    }
    const { ordenarParadasPorMedida } = await import("../src/lib/roteirizacao-automatica/ordem-por-rua");
    const nome = (p: Ponto) => (p === HAKIM ? "L" : p === P36 ? "36" : p === P37 ? "37" : p === P39 ? "39" : "?");
    const km: Record<string, number> = { "L>39": 2.6, "L>37": 3.9, "L>36": 4.1, "39>37": 3.2, "37>39": 3.2, "39>36": 3.4, "36>39": 3.4, "37>36": 0.6, "36>37": 0.6 };
    const ordem = await ordenarParadasPorMedida(HAKIM, [{ id: "p36", ponto: P36 }, { id: "p37", ponto: P37 }, { id: "p39", ponto: P39 }], async (x, y) => km[`${nome(x)}>${nome(y)}`] ?? null);
    conferir("… e a rota sai 39 → 37 → 36 (o menor percurso pela rua)", ordem.fonte === "rua" && ordem.ordem.join() === "p39,p37,p36", ordem);
    // O rio continua barrado com o desvio de 2 km: 1,5 km de reta, 4 de rua.
    const rio = plano([pedido(1, em(3), 20), pedido(2, em(3, 1.5), 25)], [], [], CFG, tabela({ "p01|p02": 4, [`${LOJA_NA_TABELA}|p01`]: 3.4, [`${LOJA_NA_TABELA}|p02`]: 3.9 }));
    conferir("… e o rio (34 × 26) continua barrado com o desvio no raio", criadas(rio.acoes).length === 0, rio);
  }
  {
    // Hakim Centro, 25/10/2026, Rota #4, coordenadas e km de rua REAIS: o #13
    // (Hospital, a 0,3 km da loja) serviu de ponte — o #14 coube "perto do
    // #13" (1,9 km) e o #12 (Chácara Mariléa) ficou a 6 km de rua do #14.
    const HAKIM: Ponto = { lat: -22.5187175, lng: -41.9418978 };
    const p12 = pedido(12, { lat: -22.503306, lng: -41.9347504 }, 20), p13 = pedido(13, { lat: -22.516792, lng: -41.943676 }, 22), p14 = pedido(14, { lat: -22.502664, lng: -41.947971 }, 24);
    const ruaReal = tabela({
      [`${LOJA_NA_TABELA}|p12`]: 4.38, [`${LOJA_NA_TABELA}|p13`]: 0.33, [`${LOJA_NA_TABELA}|p14`]: 2.18,
      "p12|p13": 4.72, "p13|p14": 1.97, "p12|p14": 5.82,
    });
    const rota4 = planejar({ loja: HAKIM, config: CFG, pedidos: [p12, p13, p14], rotasAbertas: [], motoboys: [], agora: AGORA, pelaRua: ruaReal });
    const grupo4 = criadas(rota4.acoes)[0] ?? [];
    conferir("ponte: o #14 não entra na rota do #12 + #13 (alonga 3,6 km de rua)", !grupo4.includes("p14"), rota4.acoes);
    const emLinhaReta = planejar({ loja: HAKIM, config: CFG, pedidos: [p12, p13, p14], rotasAbertas: [], motoboys: [], agora: AGORA });
    conferir("… em linha reta (sem medida) os três ainda se juntam, como antes", mesmoConjunto(criadas(emLinhaReta.acoes)[0] ?? [], ["p12", "p13", "p14"]), emLinhaReta.acoes);
  }
  {
    // Passo 4 cresce um a um: C está a 1,8 km de B e a 3,6 km de A (a semente).
    const A = pedido(1, em(3), 20), B = pedido(2, em(3, 1.8), 22), C = pedido(3, em(3, 3.6), 24);
    const r = plano([A, B, C]);
    conferir("rota nova cresce um a um: quem entrou traz o vizinho dele (A + B + C)", mesmoConjunto(criadas(r.acoes)[0] ?? [], ["p01", "p02", "p03"]), r.acoes);
    const dois = plano([A, B, C], [], [], { ...CFG, maxEntregasPorRota: 2 });
    conferir("… até o teto: com 2 por rota, C espera a próxima", mesmoConjunto(criadas(dois.acoes)[0] ?? [], ["p01", "p02"]) && motivoDe(dois, "p03") === "proxima-rota", dois);
  }
  {
    const iguais = ordemDeMenorPercurso(["b", "c", "a"], () => 1, () => 1);
    conferir("menor percurso: empate fica com a ordem de menor id", iguais.join() === "a,b,c", iguais);
    // Rota #11 da Hakim (22/10, 21h20): o guloso gravou 34 → 33 → 35.
    const { ordenarParadasPorMedida } = await import("../src/lib/roteirizacao-automatica/ordem-por-rua");
    const HAKIM: Ponto = { lat: -22.5187175, lng: -41.9418978 };
    const P33: Ponto = { lat: -22.5229604, lng: -41.9817868 }, P34: Ponto = { lat: -22.510523, lng: -41.953844 }, P35: Ponto = { lat: -22.530717, lng: -41.95746 };
    const nome = (p: Ponto) => (p === HAKIM ? "L" : p === P33 ? "33" : p === P34 ? "34" : p === P35 ? "35" : "?");
    // Do 34, o 33 é "mais perto" (2,5 < 2,8), mas voltar do 33 ao 35 custa 4
    // e descer do 35 ao 33 pela orla custa 1,2.
    const km: Record<string, number> = {
      "L>34": 1.8, "L>33": 5.5, "L>35": 2.6, "34>33": 2.5, "33>34": 2.5, "34>35": 2.8, "35>34": 2.8, "33>35": 4.0, "35>33": 1.2,
    };
    const r = await ordenarParadasPorMedida(HAKIM, [{ id: "p33", ponto: P33 }, { id: "p34", ponto: P34 }, { id: "p35", ponto: P35 }], async (a, b) => km[`${nome(a)}>${nome(b)}`] ?? null);
    conferir("Rota #11: menor percurso pela rua é 34 → 35 → 33 (o guloso dava 34 → 33 → 35)", r.fonte === "rua" && r.ordem.join() === "p34,p35,p33", r);
    const reta = ordenarParadas(HAKIM, [{ id: "p33", ponto: P33 }, { id: "p34", ponto: P34 }, { id: "p35", ponto: P35 }]);
    conferir("… e a reserva em linha reta (a da prévia) também dá 34 → 35 → 33", reta.join() === "p34,p35,p33", reta);
  }
  {
    // Os pares que o executar mede: loja primeiro; nunca dois da mesma rota,
    // nem par que não cabe nem em linha reta, nem prazos longe demais.
    const pares = paresParaMedirPelaRua({
      loja: LOJA, config: CFG,
      pedidos: [pedido(3, em(2, 0.5), 22), pedido(4, em(-6), 22), pedido(5, em(2.2), 90), pedido(6, em(2.1), 21, { fora: "parceiro" })],
      rotasAbertas: [rota("R1", [pedido(1, em(2), 20), pedido(2, em(2.3), 21)])],
    });
    const txt = pares.map((p) => p.join("|"));
    conferir("pares: as pernas da loja vêm primeiro", txt.slice(0, 4).every((t) => t.startsWith(`${LOJA_NA_TABELA}|`)) && txt.length >= 4, txt);
    conferir("… o do bolo com as paradas da rota entra; os dois da mesma rota não", txt.includes("p01|p03") && txt.includes("p02|p03") && !txt.includes("p01|p02"), txt);
    conferir("… longe (6 km do outro lado), prazo fora de 2 × janela e corte de D4 ficam de fora",
      !txt.some((t) => t.includes("p04") && !t.startsWith(LOJA_NA_TABELA)) && !txt.some((t) => t.includes("p05") && !t.startsWith(LOJA_NA_TABELA)) && !txt.some((t) => t.includes("p06")), txt);
  }
  // ── O porquê de cada entrada e o histórico oculto (22/10/2026, 22h20) ────
  console.log("\n== Histórico da rota: o porquê e o registro ==");
  {
    // O caso 33/34/35 da Hakim, coordenadas reais: o #35 entra "no caminho
    // do #33" (não do #34, a semente).
    const HAKIM: Ponto = { lat: -22.5187175, lng: -41.9418978 };
    const p33 = pedido(33, { lat: -22.5229604, lng: -41.9817868 }, 25);
    const p34 = pedido(34, { lat: -22.510523, lng: -41.953844 }, 20);
    const p35 = pedido(35, { lat: -22.530717, lng: -41.95746 }, 28);
    const reta = acrescimos(planejar({ loja: HAKIM, config: CFG, pedidos: [p35], rotasAbertas: [rota("R11", [p34, p33])], motoboys: [], agora: AGORA }).acoes);
    conferir("porquê em linha reta: \"#35 entrou: no caminho do #33 — desvio X km em linha reta\"",
      /^#35 entrou: no caminho do #33 — desvio \d+,\d km em linha reta$/.test(reta[0]?.porque ?? ""), reta[0]?.porque);
    // Pela rua: 35→33 2,5 km (não é "perto"), loja→35 2,6, loja→33 4,3 → desvio 0,8.
    const rua = tabela({
      [`${LOJA_NA_TABELA}|p33`]: 4.3, [`${LOJA_NA_TABELA}|p34`]: 1.8, [`${LOJA_NA_TABELA}|p35`]: 2.6,
      "p33|p35": 2.5, "p34|p35": 2.8,
    });
    const pelaRua = acrescimos(planejar({ loja: HAKIM, config: CFG, pedidos: [p35], rotasAbertas: [rota("R11", [p34, p33])], motoboys: [], agora: AGORA, pelaRua: rua }).acoes);
    conferir("porquê pela rua: \"#35 entrou: no caminho do #33 — desvio 0,8 km pela rua\"",
      pelaRua[0]?.porque === "#35 entrou: no caminho do #33 — desvio 0,8 km pela rua", pelaRua[0]?.porque);
    // Perto ganha do "no caminho" no texto quando vale: 35→33 a 1,2 km de rua.
    const perto = acrescimos(planejar({
      loja: HAKIM, config: CFG, pedidos: [p35], rotasAbertas: [rota("R11", [p34, p33])], motoboys: [], agora: AGORA,
      pelaRua: tabela({ [`${LOJA_NA_TABELA}|p33`]: 4.3, [`${LOJA_NA_TABELA}|p34`]: 1.8, [`${LOJA_NA_TABELA}|p35`]: 2.6, "p33|p35": 1.2, "p34|p35": 2.8 }),
    }).acoes);
    conferir("porquê \"perto\": \"#35 entrou: perto do #33 — 1,2 km pela rua\"", perto[0]?.porque === "#35 entrou: perto do #33 — 1,2 km pela rua", perto[0]?.porque);
  }
  {
    // Rota nova: a semente "abriu a rota", a companhia "entrou" com a distância.
    const p1 = pedido(1, em(3), 20), p2 = pedido(2, em(3, 1.5), 25);
    const criada = (r: ReturnType<typeof plano>) => r.acoes.find((a): a is Extract<Acao, { tipo: "criar-rota" }> => a.tipo === "criar-rota");
    const reta = criada(plano([p1, p2]));
    conferir("criar-rota: a semente \"#1 abriu a rota (menor prazo)\"", reta?.porques.p01 === "#1 abriu a rota (menor prazo)", reta?.porques);
    conferir("… e \"#2 entrou: perto do #1 — 1,5 km em linha reta\"", reta?.porques.p02 === "#2 entrou: perto do #1 — 1,5 km em linha reta", reta?.porques);
    const rua = criada(plano([p1, p2], [], [], CFG, tabela({ "p01|p02": 1.9 })));
    conferir("… pela rua: \"#2 entrou: perto do #1 — 1,9 km pela rua\"", rua?.porques.p02 === "#2 entrou: perto do #1 — 1,9 km pela rua", rua?.porques);
    const sozinho = criada(plano([pedido(3, em(2), 20, pronto(1))]));
    conferir("… sozinho e pronto: \"#3 abriu a rota sozinho e pronto (menor prazo)\"", sozinho?.porques.p03 === "#3 abriu a rota sozinho e pronto (menor prazo)", sozinho?.porques);
    const priorizado = criada(plano([pedido(4, em(2), 30, { prioridadeManual: true }), pedido(5, em(2.2), 25)], [], [], { ...CFG, janelaDePrazoMin: 30 }));
    conferir("… priorizado à mão: \"(prioridade pedida pela loja)\"", priorizado?.porques.p04 === "#4 abriu a rota (prioridade pedida pela loja)", priorizado?.porques);
  }
  {
    const { registrarNaRota, quemNaSessao, TETO_DO_HISTORICO, QUEM_AUTOMATICA } = await import("../src/lib/roteirizacao-automatica/historico-da-rota");
    // Prisma falso: guarda o histórico por rota e faz o que o UPDATE faz —
    // anexa as novas ao fim e fica com as últimas `teto` entradas.
    const linhas = new Map<string, any[]>();
    const sqls: string[] = [];
    let quebrar = false;
    const banco = {
      $executeRaw: (async (strings: TemplateStringsArray, ...valores: any[]) => {
        if (quebrar) throw new Error('column "historico" does not exist');
        sqls.push(strings.join("?"));
        const [novas, , teto, rotaId] = valores;
        if (!linhas.has(rotaId)) return 0;
        const tudo = [...(linhas.get(rotaId) ?? []), ...JSON.parse(novas)];
        linhas.set(rotaId, tudo.slice(Math.max(0, tudo.length - teto)));
        return 1;
      }) as any,
    };
    linhas.set("R15", Array.from({ length: 58 }, (_, i) => ({ em: "2026-10-22T22:00:00.000Z", quem: QUEM_AUTOMATICA, acao: "entrou", pedido: i + 1 })));
    const gravou = await registrarNaRota("R15", [
      { quem: QUEM_AUTOMATICA, acao: "entrou", pedido: 46, motivo: "#46 abriu a rota (menor prazo)" },
      { quem: QUEM_AUTOMATICA, acao: "entrou", pedido: 48, motivo: "#48 entrou: perto do #46 — 0,9 km pela rua" },
      { quem: "Maria (maria@hakim.com)", acao: "incluiu", pedido: 47, motivo: "pelo ✏️ Editar" },
      { quem: "motoboy Maicon", acao: "despachou", motivo: "x".repeat(500) },
      { quem: QUEM_AUTOMATICA, acao: "fechou" },
    ], banco);
    const h = linhas.get("R15") ?? [];
    conferir("registrar: anexa ao fim e corta as mais antigas no teto (58 + 5 → 60)", gravou && h.length === TETO_DO_HISTORICO && h[0].pedido === 4 && h[59].acao === "fechou", { n: h.length, primeiro: h[0], ultimo: h[59] });
    conferir("… a ordem fica: o #47 do ✏️ Editar com quem fez", h[57]?.pedido === 47 && h[57]?.quem === "Maria (maria@hakim.com)" && h[57]?.acao === "incluiu", h[57]);
    conferir("… cada entrada ganha a hora (ISO) e o motivo longo é cortado", typeof h[59]?.em === "string" && !Number.isNaN(Date.parse(h[59].em)) && h[58]?.motivo.length === 240 && !("motivo" in h[59]), h.slice(58));
    conferir("… num UPDATE só, anexando ao que já havia", sqls.length === 1 && /COALESCE\("historico", '\[\]'::jsonb\) \|\|/.test(sqls[0]) && /WHERE "id" = \?/.test(sqls[0]), sqls);
    quebrar = true;
    let lancou = false;
    let r: boolean | undefined;
    const avisoOriginal = console.warn;
    console.warn = () => {};
    try { r = await registrarNaRota("R15", [{ quem: QUEM_AUTOMATICA, acao: "chamou" }], banco); } catch { lancou = true; } finally { console.warn = avisoOriginal; }
    conferir("… coluna ausente (ou banco fora): não lança, devolve false", !lancou && r === false);
    quebrar = false;
    conferir("… sem rota ou sem entrada: nem pergunta ao banco", (await registrarNaRota(null, [{ quem: "x", acao: "chamou" }], banco)) === false && (await registrarNaRota("R15", [], banco)) === false && sqls.length === 1);
    conferir("quem na sessão: nome (e-mail); suporte entrando como a loja não vira o dono",
      quemNaSessao({ name: "Maria", email: "maria@hakim.com" }) === "Maria (maria@hakim.com)"
        && quemNaSessao({ email: "loja@hakim.com" }) === "loja@hakim.com"
        && quemNaSessao({ name: "Hakim Centro", email: "loja@hakim.com", impersonatedBy: "adm1" }) === "Suporte FireHub (como Hakim Centro (loja@hakim.com))");
  }

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exitCode = falhou ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 20));
