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
  const { planejar, ordenarParadas, RECHAMAR_DEPOIS_MIN } = await import("../src/lib/roteirizacao-automatica/planejador");
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
  const plano = (pedidos: Pedido[], rotasAbertas: Rota[] = [], motoboys: Motoboy[] = [], config = CFG) =>
    planejar({ loja: LOJA, config, pedidos, rotasAbertas, motoboys, agora: AGORA });
  const criadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "criar-rota" }> => a.tipo === "criar-rota").map((a) => a.pedidos);
  const chamadas = (acoes: Acao[]) => acoes.filter((a): a is Extract<Acao, { tipo: "chamar" }> => a.tipo === "chamar");
  const motivoDe = (r: ReturnType<typeof plano>, id: string) => r.descartados.find((d) => d.pedidoId === id)?.motivo;
  const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

  console.log("\n== Semente e agrupamento ==");
  {
    // Dois pedidos prontos longe um do outro: duas rotas de 1, a do menor prazo primeiro.
    const r = plano([pedido(1, em(3), 40, pronto(1)), pedido(2, em(-3), 20, pronto(1))]);
    const c = criadas(r.acoes);
    conferir("semente = menor prazo: a primeira rota criada é a do #2", c.length === 2 && c[0][0] === "p02", c);
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
    conferir("… o que sobrou é rota-cheia", motivoDe(r, "p03") === "rota-cheia", r.descartados);
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
    conferir("não mexe em rota chamada: nada é acrescentado nem chamado de novo",
      !r.acoes.some((x) => "rotaId" in x && x.rotaId === "R1"), r.acoes);
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
    conferir("… o que saiu volta ao bolo (sozinho e na cozinha: esperando)", motivoDe(r, "p02") === "esperando-companhia", r.descartados);
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
    conferir("vizinho mais próximo a partir da loja; sem ponto vai para o fim", ordem.join() === "a,b,c,x", ordem);
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
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"] },
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p03", posicao: 2, ordem: ["p02", "p03", "p01"] },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seqs = g.passos.filter((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }>[];
    conferir("duas entradas na mesma rota: uma sequência, a última, depois das entradas",
      tipos(g.passos) === "entrar-na-rota,entrar-na-rota,sequencia" && seqs.length === 1 && seqs[0].pedidoIds.join() === "p02,p03,p01", g);
  }
  {
    // Rota que não está entre as AUTO abertas lidas (a manual, a que saiu): não se mexe.
    const acoes: Acao[] = [
      { tipo: "acrescentar", rotaId: "MANUAL1", pedidoId: "p02", posicao: 1, ordem: ["p02"] },
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
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 2, ordem: ["p01", "p02"] },
      { tipo: "criar-rota", pedidos: ["p02", "p03"], motivo: "teste" },
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
      { tipo: "acrescentar", rotaId: "R1", pedidoId: "p02", posicao: 1, ordem: ["p02", "p01"] },
      { tipo: "tirar-da-rota", rotaId: "R1", pedidoId: "p01", motivo: "cancelado" },
    ];
    const g = gravacoesDasAcoes(acoes, [{ id: "R1", pedidoIds: ["p01"] }]);
    const seq = g.passos.find((p) => p.tipo === "sequencia") as Extract<Passo, { tipo: "sequencia" }> | undefined;
    conferir("sequência regravada só com quem ficou na rota", seq?.pedidoIds.join() === "p02", g);
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
    const rua: Record<string, number> = { "L>A": 5, "L>B": 1.6, "L>C": 6, "B>A": 2.0, "B>C": 2.5, "A>C": 1, "A>B": 2.0, "C>A": 1, "C>B": 2.5 };
    const pernas: string[] = [];
    const medirFalso = (falhar?: string) => async (a: Ponto, b: Ponto) => {
      const perna = `${nomeDo(a)}>${nomeDo(b)}`;
      pernas.push(perna);
      return perna === falhar ? null : rua[perna] ?? null;
    };
    const paradas = [{ id: "pA", ponto: A }, { id: "pB", ponto: B }, { id: "pC", ponto: C }];
    const reta = ordenarParadas(LOJA, paradas);
    const r = await ordenarParadasPorMedida(LOJA, paradas, medirFalso());
    conferir("linha reta: A, C, B (A é a mais perto da loja no mapa)", reta.join() === "pA,pC,pB", reta);
    conferir("pela rua: B, A, C — o vizinho mais próximo de MOTO, diferente da reta", r.fonte === "rua" && r.ordem.join() === "pB,pA,pC" && !r.falha, r);
    conferir("… medindo só as pernas que decidem (3 da loja + 2 de B; a última não mede)", pernas.length === 5 && pernas.slice(0, 3).sort().join() === "L>A,L>B,L>C", pernas);

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
    conferir("o `medir` recebe o fim do tempo (3 s por padrão) para passar ao rotaEntre", prazoVisto > Date.now() + 2_000 && prazoVisto <= Date.now() + 3_000, prazoVisto - Date.now());

    pernas.length = 0;
    const comSemPonto = await ordenarParadasPorMedida(LOJA, [...paradas, { id: "pD", ponto: null }], medirFalso());
    conferir("pedido sem ponto vai para o fim, sem perna medida para ele", comSemPonto.ordem.join() === "pB,pA,pC,pD" && pernas.every((x) => !x.includes("?")), { comSemPonto, pernas });

    pernas.length = 0;
    const uma = await ordenarParadasPorMedida(LOJA, [{ id: "pA", ponto: A }], medirFalso());
    conferir("uma parada só: nada a medir, nenhuma falha a relatar", uma.ordem.join() === "pA" && pernas.length === 0 && !uma.falha, { uma, pernas });
    const semTempo = await ordenarParadasPorMedida(LOJA, paradas, medirFalso(), { tetoMs: 0 });
    conferir("sem tempo no ciclo (teto 0): linha reta sem perguntar", semTempo.fonte === "linha-reta" && semTempo.ordem.join() === reta.join() && pernas.length === 0, semTempo);
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
