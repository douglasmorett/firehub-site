import { prisma } from "@/lib/prisma";

/**
 * A distância que a moto REALMENTE percorre, pelas ruas.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O FireHub sempre cobrou por RAIO: a linha reta entre a loja e o cliente, que
 * é o círculo desenhado no mapa. É simples de explicar e de desenhar, mas
 * castiga quem está do outro lado de um rio, de uma linha de trem ou de um
 * morro — 1,2 km em linha reta que são 6 km de moto. O iFood e a Brendi cobram
 * por rota, e o lojista que veio de lá sente a diferença no primeiro dia.
 *
 * O raio continua sendo o padrão. A loja escolhe rota quando quiser, e as
 * faixas que ela já cadastrou continuam valendo — o que muda é só o número que
 * entra na comparação.
 *
 * ── Quando o roteador falha: estimativa DECLARADA, nunca linha reta calada ──
 *
 * Até 25/09/2026 qualquer falha do roteador voltava, calada, para a linha reta.
 * Em Cabo Frio a rua é de 1,09× a 1,92× a linha reta (Gamboa: 2,50 km em linha
 * reta, 4,78 km pela Ponte Feliciano Sodré): com o roteador fora, a Divinos
 * cobrava a faixa de 3 km de quem mora a 5 km de rua, e o motoboy recebia pela
 * faixa errada — sem nada no pedido dizendo que a conta tinha sido outra.
 *
 * Agora:
 *   - uma nova tentativa, curta, antes de desistir;
 *   - desistindo, quem chama estima: linha reta × o fator de desvio DA LOJA
 *     (`fatorDeDesvio`: a mediana de rua ÷ linha reta das rotas que ela já
 *     mediu), e marca a medida como "estimada";
 *   - um disjuntor de 60 s: com o roteador fora, a cotação seguinte não espera
 *     o prazo inteiro para descobrir de novo que ele está fora.
 *
 * ── O servidor público pede ≤ 1 requisição por segundo ──────────────────────
 *
 * O padrão é o servidor de demonstração do OSRM (router.project-osrm.org):
 * "reasonable, non-commercial use", no máximo 1 req/s, sem garantia — e o
 * acesso pode ser cortado sem aviso. O cron de distâncias pendentes disparava
 * até 150 chamadas em sequência. Aqui há um limitador de processo inteiro
 * (≤ 1/s) e o cache agressivo: um par loja→cliente é calculado UMA vez
 * (chave a 4 casas, ~11 m) e vale por 60 dias, no banco e na memória.
 *
 * `OSRM_URL` no ambiente troca o servidor por uma instância própria — aí o
 * limitador não se aplica (o limite era do servidor público), o disjuntor sim.
 *
 * ── O roteador reserva ──────────────────────────────────────────────────────
 *
 * Falha passageira do principal (ou disjuntor dele aberto) ainda tenta o do
 * FOSSGIS — o OpenStreetMap da Alemanha, mesma API, sem chave — ANTES da
 * estimativa. Medido em 25/09/2026 na Deeds Delivery (Londrina): os dois
 * devolvem a mesma rota ao metro (3.195,8 m). Tem limitador e disjuntor
 * próprios; `OSRM_URL_RESERVA` troca, e vazio desliga.
 *
 * ── O ponto arrastado até a rua ─────────────────────────────────────────────
 *
 * O roteador prende cada ponto na rua mais próxima e diz quanto andou
 * (`waypoints[].distance`). "Braga, Cabo Frio" caiu numa praia e foi arrastado
 * 351 m: a rota medida é de OUTRO lugar. Quem chama recebe esse deslocamento
 * (`deslocamentoM`) e, acima de 150 m, pede ao cliente para confirmar o ponto.
 *
 * Teste: scripts/teste-motor-da-entrega.ts (roteador simulado, sem rede).
 */

const URL_PUBLICA = "https://router.project-osrm.org";

/** Lido a cada chamada (não no carregamento), para o teste poder trocar. */
function baseDoRoteador(): string {
  return (process.env.OSRM_URL || URL_PUBLICA).replace(/\/+$/, "");
}
function roteadorPublico(): boolean {
  return !process.env.OSRM_URL;
}

const URL_RESERVA_PUBLICA = "https://routing.openstreetmap.de/routed-car";

/** O reserva, ou "" quando desligado (`OSRM_URL_RESERVA=` vazio) ou igual ao principal. */
function baseDaReserva(): string {
  const base = (process.env.OSRM_URL_RESERVA ?? URL_RESERVA_PUBLICA).trim().replace(/\/+$/, "");
  return base && base !== baseDoRoteador() ? base : "";
}

/** Os dois servidores públicos pedem ≤ 1 req/s; instância própria não tem limite. */
function servidorPublico(base: string): boolean {
  return base === URL_PUBLICA || base === URL_RESERVA_PUBLICA;
}

/** Prazo da primeira pergunta. */
const PRAZO_PRIMEIRA_MS = 3000;
/** A nova tentativa é curta: o cliente está esperando a taxa. */
const PRAZO_SEGUNDA_MS = 1500;
const PAUSA_ANTES_DA_SEGUNDA_MS = 200;
/** Abaixo disto de tempo restante não vale a pena perguntar. */
const TEMPO_MINIMO_MS = 400;
/** Política do servidor público: no máximo 1 requisição por segundo. */
const INTERVALO_DO_PUBLICO_MS = 1000;
/** Quanto uma chamada sem prazo aceita esperar pela vez no limitador. */
const ESPERA_MAXIMA_PADRAO_MS = 5000;
/** Prazo padrão de quem não informa um (cron, importação de pedido). */
const PRAZO_PADRAO_MS = 8000;
const DISJUNTOR_MS = 60_000;
/** Rota guardada há mais que isto é perguntada de novo: ponte nova, mão trocada no OSM. */
const VALIDADE_DO_CACHE_MS = 60 * 24 * 60 * 60_000;
/** Teto do cache da memória — o Map sem limite crescia enquanto o processo vivesse. */
const TETO_DA_MEMORIA = 5000;
/** Rota absurda é rota errada: acima disto o endereço caiu noutra cidade. */
const ROTA_ABSURDA_KM = 200;
/** Banco lento não pode segurar a cotação: leitura do cache tem prazo próprio. */
const PRAZO_DO_BANCO_MS = 2000;

/** Deslocamento até a rua acima do qual a rota é de outro lugar (R3). */
export const DESLOCAMENTO_SUSPEITO_M = 150;

/** Fator de desvio (rua ÷ linha reta) quando a loja ainda não tem histórico. */
export const FATOR_SEM_HISTORICO = 1.4;
export const FATOR_MINIMO = 1.2;
export const FATOR_MAXIMO = 2.0;
/** Menos amostras que isto e a mediana é sorte, não medida. */
const AMOSTRAS_MINIMAS = 3;
/** Rota curta tem razão ruidosa (200 m de reta, 400 m de rua = 2×). */
const RETA_MINIMA_DA_AMOSTRA_KM = 0.3;

/** ~11 metros. Preciso o bastante para a porta, grosso o bastante para reusar. */
const casas = (n: number) => Number(n.toFixed(4));
const arredondar = (n: number) => Math.round(n * 100) / 100;

export type Ponto = { lat: number; lng: number };

export function chaveDaRota(origem: Ponto, destino: Ponto): string {
  return `${casas(origem.lat)},${casas(origem.lng)}>${casas(destino.lat)},${casas(destino.lng)}`;
}

/** Prefixo de todas as rotas que saem deste ponto (a loja). */
function prefixoDaOrigem(origem: Ponto): string {
  return `${casas(origem.lat)},${casas(origem.lng)}>`;
}

/**
 * Linha reta SEM arredondar. Mora aqui (e não em lib/geocoding) porque
 * geocoding importa este módulo; a de lá arredonda a 0,01 km para a faixa.
 */
function linhaRetaKm(a: Ponto, b: Ponto): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── RESULTADO ──────────────────────────────────────────────────────────────

export type RotaMedida = {
  ok: true;
  /** Km de rua, arredondado a 0,01. */
  km: number;
  minutos: number | null;
  /** Quanto o roteador arrastou o CLIENTE até a rua, em metros. null = não se sabe. */
  deslocamentoM: number | null;
  doCache: boolean;
};

export type FalhaDaRota = {
  ok: false;
  /**
   * "transitoria": rede, prazo, 5xx, limite (429), disjuntor aberto, sem vez
   * no limitador — perguntar de novo mais tarde pode dar certo.
   * "definitiva": o roteador respondeu e não há rota (ponto numa ilha, fora da
   * malha, rota absurda) — perguntar de novo dá o mesmo.
   */
  tipo: "transitoria" | "definitiva";
  motivo: string;
};

export type ResultadoDaRota = RotaMedida | FalhaDaRota;

// ── CACHE: MEMÓRIA (LRU) + BANCO ──────────────────────────────────────────

export type RotaGuardada = {
  km: number;
  minutos: number | null;
  /**
   * null = o roteador não informou; `undefined` = linha gravada antes de
   * 25/09/2026, quando o deslocamento não era guardado — ela é perguntada de
   * novo uma vez (sem o deslocamento, o ponto na praia passaria sem aviso).
   */
  deslocamentoM?: number | null;
  /** Epoch ms de quando o roteador respondeu isto. */
  criadoEm: number;
};

const naMemoria = new Map<string, RotaGuardada>();

function lembrar(chave: string, r: RotaGuardada) {
  naMemoria.delete(chave);
  naMemoria.set(chave, r);
  if (naMemoria.size > TETO_DA_MEMORIA) {
    const maisVelha = naMemoria.keys().next().value;
    if (maisVelha !== undefined) naMemoria.delete(maisVelha);
  }
}

function daMemoria(chave: string): RotaGuardada | undefined {
  const r = naMemoria.get(chave);
  if (r) {
    // LRU: quem é lido vai para o fim da fila de despejo.
    naMemoria.delete(chave);
    naMemoria.set(chave, r);
  }
  return r;
}

/**
 * Onde as rotas ficam guardadas entre processos. É um objeto trocável de
 * propósito: o teste põe um de memória no lugar — o banco de verdade, com uma
 * DATABASE_URL de mentira, levava 4 s por consulta para desistir.
 */
export type CacheDeRotas = {
  ler(chave: string): Promise<RotaGuardada | null>;
  gravar(chave: string, r: Omit<RotaGuardada, "criadoEm">): Promise<void>;
  /** As rotas guardadas que saem desta origem: é de onde sai o fator da loja. */
  daOrigem(prefixo: string): Promise<{ chave: string; km: number }[]>;
};

let tabelaPronta = false;
/** Banco fora: não se tenta de novo a cada cotação, só depois disto. */
let bancoForaAte = 0;

async function garantirTabela(): Promise<boolean> {
  if (tabelaPronta) return true;
  if (Date.now() < bancoForaAte) return false;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RotaCache" (
        "chave" TEXT PRIMARY KEY,
        "km" DOUBLE PRECISION NOT NULL,
        "minutos" DOUBLE PRECISION,
        "deslocamentoM" DOUBLE PRECISION,
        "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "usos" INTEGER NOT NULL DEFAULT 1,
        "ultimoUso" TIMESTAMP(3) NOT NULL DEFAULT NOW()
      )
    `);
    // A tabela nasceu em 23/09/2026 sem esta coluna. Linha antiga fica com
    // deslocamento nulo e é perguntada de novo ao roteador uma vez.
    await prisma.$executeRawUnsafe(`ALTER TABLE "RotaCache" ADD COLUMN IF NOT EXISTS "deslocamentoM" DOUBLE PRECISION`);
    tabelaPronta = true;
    return true;
  } catch (e: any) {
    bancoForaAte = Date.now() + DISJUNTOR_MS;
    console.warn("[Rota] cache no banco indisponível por 60 s:", String(e?.message || e).slice(0, 120));
    return false;
  }
}

const cacheNoBanco: CacheDeRotas = {
  async ler(chave) {
    if (!(await garantirTabela())) return null;
    const linhas = await prisma.$queryRawUnsafe<{ km: number; minutos: number | null; deslocamentoM: number | null; criadoEm: Date }[]>(
      `SELECT "km","minutos","deslocamentoM","criadoEm" FROM "RotaCache" WHERE "chave" = $1`,
      chave,
    );
    const l = linhas?.[0];
    const km = Number(l?.km);
    if (!l || !Number.isFinite(km) || km < 0) return null;
    prisma
      .$executeRawUnsafe(`UPDATE "RotaCache" SET "usos" = "usos" + 1, "ultimoUso" = NOW() WHERE "chave" = $1`, chave)
      .catch(() => {});
    // No banco: NULL = linha antiga (nunca mediu); -1 = o roteador não disse.
    const desloc = l.deslocamentoM == null ? undefined : Number(l.deslocamentoM) < 0 ? null : Number(l.deslocamentoM);
    return {
      km,
      minutos: l.minutos == null ? null : Number(l.minutos),
      deslocamentoM: desloc,
      criadoEm: l.criadoEm instanceof Date ? l.criadoEm.getTime() : new Date(l.criadoEm as any).getTime() || 0,
    };
  },
  async gravar(chave, r) {
    if (!(await garantirTabela())) return;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RotaCache" ("chave","km","minutos","deslocamentoM") VALUES ($1,$2,$3,$4)
       ON CONFLICT ("chave") DO UPDATE SET "km" = EXCLUDED."km", "minutos" = EXCLUDED."minutos",
         "deslocamentoM" = EXCLUDED."deslocamentoM", "criadoEm" = NOW(),
         "usos" = "RotaCache"."usos" + 1, "ultimoUso" = NOW()`,
      chave,
      r.km,
      r.minutos,
      r.deslocamentoM == null ? -1 : r.deslocamentoM,
    );
  },
  async daOrigem(prefixo) {
    if (!(await garantirTabela())) return [];
    const linhas = await prisma.$queryRawUnsafe<{ chave: string; km: number }[]>(
      `SELECT "chave","km" FROM "RotaCache" WHERE "chave" LIKE $1 ORDER BY "ultimoUso" DESC LIMIT 300`,
      `${prefixo}%`,
    );
    return (linhas || []).map((l) => ({ chave: String(l.chave), km: Number(l.km) }));
  },
};

export const cacheDeRotas: CacheDeRotas = { ...cacheNoBanco };

/** Qualquer ida ao banco daqui tem prazo, e falhar derruba o banco por 60 s. */
async function doBanco<T>(fn: () => Promise<T>, seFalhar: T): Promise<T> {
  if (Date.now() < bancoForaAte) return seFalhar;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, rejeita) => {
        timer = setTimeout(() => rejeita(new Error("banco demorou")), PRAZO_DO_BANCO_MS);
      }),
    ]);
  } catch (e: any) {
    bancoForaAte = Date.now() + DISJUNTOR_MS;
    console.warn("[Rota] cache no banco falhou — só memória por 60 s:", String(e?.message || e).slice(0, 120));
    return seFalhar;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── LIMITADOR E DISJUNTOR ──────────────────────────────────────────────────

/** A próxima vez livre em cada servidor público (epoch ms). Reserva, não espera em fila. */
const proximaVaga = new Map<string, number>();
let intervaloDoPublicoMs = INTERVALO_DO_PUBLICO_MS;

/**
 * Reserva a próxima vez livre neste servidor. Devolve quanto esperar, ou null
 * quando a vez cai depois do que quem chama pode esperar — aí nem se reserva,
 * para não empurrar os outros por uma pergunta que não vai acontecer.
 */
function reservarVaga(base: string, esperaMaximaMs: number): number | null {
  if (!servidorPublico(base)) return 0;
  const agora = Date.now();
  const vaga = Math.max(agora, proximaVaga.get(base) || 0);
  const espera = vaga - agora;
  if (espera > esperaMaximaMs) return null;
  proximaVaga.set(base, vaga + intervaloDoPublicoMs);
  return espera;
}

let disjuntorAbertoAte = 0;
/** O reserva tem o dele: fora, não atrasa a cotação seguinte. */
let disjuntorDaReservaAte = 0;

const estado = {
  ultimoSucessoEm: 0,
  ultimaFalhaEm: 0,
  ultimaFalhaMotivo: "",
  consultas: 0,
  doCache: 0,
  falhas: 0,
  disjuntorAberturas: 0,
  respondidasPelaReserva: 0,
};

function abrirDisjuntor(motivo: string) {
  const jaAberto = Date.now() < disjuntorAbertoAte;
  disjuntorAbertoAte = Date.now() + DISJUNTOR_MS;
  if (!jaAberto) {
    estado.disjuntorAberturas++;
    console.warn(`[Rota] roteador ${baseDoRoteador()} fora (${motivo}) — distâncias por estimativa nos próximos 60 s`);
  }
}

/** Para o /api/health: o roteador está respondendo? Sem ir à rede. */
export function estadoDoRoteador() {
  const agora = Date.now();
  return {
    servidor: roteadorPublico() ? "público (router.project-osrm.org)" : "próprio (OSRM_URL)",
    disjuntorAberto: agora < disjuntorAbertoAte,
    disjuntorAte: agora < disjuntorAbertoAte ? new Date(disjuntorAbertoAte).toISOString() : null,
    ultimoSucesso: estado.ultimoSucessoEm ? new Date(estado.ultimoSucessoEm).toISOString() : null,
    ultimaFalha: estado.ultimaFalhaEm
      ? { em: new Date(estado.ultimaFalhaEm).toISOString(), motivo: estado.ultimaFalhaMotivo }
      : null,
    contagem: {
      perguntasAoRoteador: estado.consultas,
      respondidasPeloCache: estado.doCache,
      respondidasPelaReserva: estado.respondidasPelaReserva,
      falhas: estado.falhas,
      aberturasDoDisjuntor: estado.disjuntorAberturas,
    },
    reserva: {
      servidor: baseDaReserva() || null,
      disjuntorAberto: agora < disjuntorDaReservaAte,
    },
    rotasNaMemoria: naMemoria.size,
  };
}

/**
 * Zera o estado do processo. SÓ PARA TESTE: o disjuntor, o limitador e o
 * cache da memória são do processo inteiro, e um caso de teste não pode
 * herdar o do anterior.
 */
export function reiniciarRoteadorParaTeste(opcoes?: { intervaloDoPublicoMs?: number }) {
  naMemoria.clear();
  fatores.clear();
  disjuntorAbertoAte = 0;
  disjuntorDaReservaAte = 0;
  proximaVaga.clear();
  bancoForaAte = 0;
  intervaloDoPublicoMs = opcoes?.intervaloDoPublicoMs ?? INTERVALO_DO_PUBLICO_MS;
  ultimaSonda = null;
  Object.assign(estado, { ultimoSucessoEm: 0, ultimaFalhaEm: 0, ultimaFalhaMotivo: "", consultas: 0, doCache: 0, falhas: 0, disjuntorAberturas: 0, respondidasPelaReserva: 0 });
}

// ── A PERGUNTA AO ROTEADOR ─────────────────────────────────────────────────

/** Respostas do OSRM que não mudam se perguntar de novo. */
const CODIGOS_DEFINITIVOS = new Set(["NoRoute", "NoSegment", "InvalidQuery", "InvalidValue", "InvalidOptions", "InvalidUrl", "InvalidService", "InvalidVersion", "TooBig", "NoMatch", "NoTrips"]);

type Resposta =
  | { ok: true; km: number; minutos: number | null; deslocamentoM: number | null }
  | { ok: false; definitiva: boolean; status?: number; motivo: string };

async function perguntar(base: string, origem: Ponto, destino: Ponto, prazoMs: number): Promise<Resposta> {
  // `overview=false`: não precisamos do desenho da rota, só do número — e o
  // desenho é o que pesa na resposta.
  const url = `${base}/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=false&alternatives=false&steps=false`;
  estado.consultas++;
  let r: Response;
  try {
    r = await fetch(url, {
      signal: AbortSignal.timeout(Math.max(1, Math.round(prazoMs))),
      headers: { "User-Agent": "FireHub/1.0 (contato@firehubfood.com.br)" },
    });
  } catch (e: any) {
    const tempo = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { ok: false, definitiva: false, motivo: tempo ? `sem resposta em ${Math.round(prazoMs)} ms` : `rede: ${e?.message || e}` };
  }
  let d: any = null;
  try {
    d = await r.json();
  } catch {
    d = null;
  }
  const codigo = String(d?.code || "");
  if (r.ok && codigo === "Ok") {
    const rota = Array.isArray(d?.routes) ? d.routes[0] : null;
    const metros = Number(rota?.distance);
    if (!rota || !Number.isFinite(metros) || metros < 0) return { ok: false, definitiva: true, motivo: "resposta sem distância" };
    const km = arredondar(metros / 1000);
    if (km > ROTA_ABSURDA_KM) return { ok: false, definitiva: true, motivo: `rota absurda (${km} km)` };
    const segundos = Number(rota?.duration);
    const deslocamento = Number(d?.waypoints?.[1]?.distance);
    return {
      ok: true,
      km,
      minutos: Number.isFinite(segundos) ? Math.round(segundos / 60) : null,
      deslocamentoM: Number.isFinite(deslocamento) && deslocamento >= 0 ? Math.round(deslocamento) : null,
    };
  }
  if (CODIGOS_DEFINITIVOS.has(codigo)) return { ok: false, definitiva: true, status: r.status, motivo: `roteador: ${codigo}` };
  return { ok: false, definitiva: false, status: r.status, motivo: `HTTP ${r.status}${codigo ? ` (${codigo})` : ""}` };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A rota de rua entre os dois pontos — do cache ou do roteador.
 *
 * `prazo` (epoch ms) é o fim do tempo de quem chama: a cotação de frete tem
 * 12 s para tudo, e o roteador não pode comer o que falta.
 *
 * NUNCA lança. A falha vem descrita, e quem chama decide: a cotação estima
 * pelo fator da loja; a medida de pedido de marketplace deixa para o cron.
 */
export async function rotaEntre(origem: Ponto, destino: Ponto, opcoes?: { prazo?: number }): Promise<ResultadoDaRota> {
  if (!Number.isFinite(origem?.lat) || !Number.isFinite(origem?.lng) || !Number.isFinite(destino?.lat) || !Number.isFinite(destino?.lng)) {
    return { ok: false, tipo: "definitiva", motivo: "ponto inválido" };
  }
  const prazo = opcoes?.prazo ?? Date.now() + PRAZO_PADRAO_MS;
  const chave = chaveDaRota(origem, destino);
  const fresca = (r: RotaGuardada) => Date.now() - r.criadoEm < VALIDADE_DO_CACHE_MS && r.deslocamentoM !== undefined;
  const doCache = (r: RotaGuardada): RotaMedida => {
    estado.doCache++;
    return { ok: true, km: r.km, minutos: r.minutos, deslocamentoM: r.deslocamentoM ?? null, doCache: true };
  };

  // 1. Memória, depois banco. Linha velha (ou de antes do deslocamento) fica
  //    de reserva: se o roteador não responder, ela ainda é rua medida.
  let velha: RotaGuardada | null = null;
  const lembrada = daMemoria(chave);
  if (lembrada) {
    if (fresca(lembrada)) return doCache(lembrada);
    velha = lembrada;
  }
  if (!velha) {
    const guardada = await doBanco(() => cacheDeRotas.ler(chave), null);
    if (guardada) {
      lembrar(chave, guardada);
      if (fresca(guardada)) return doCache(guardada);
      velha = guardada;
    }
  }
  /** Sem resposta nova: a rua medida antes (mesmo vencida) ainda vale mais que estimar. */
  const ouRotaVelha = (falha: FalhaDaRota): ResultadoDaRota => (velha ? doCache(velha) : falha);
  const medida = (r: Extract<Resposta, { ok: true }>): RotaMedida => {
    const guardar = { km: r.km, minutos: r.minutos, deslocamentoM: r.deslocamentoM };
    lembrar(chave, { ...guardar, criadoEm: Date.now() });
    doBanco(() => cacheDeRotas.gravar(chave, guardar), undefined).catch(() => {});
    estado.ultimoSucessoEm = Date.now();
    return { ok: true, ...guardar, doCache: false };
  };
  const anotarFalha = (motivo: string) => {
    estado.falhas++;
    estado.ultimaFalhaEm = Date.now();
    estado.ultimaFalhaMotivo = motivo;
  };

  // 2. O roteador principal. Disjuntor aberto = nem pergunta.
  let ultimoMotivo = "sem tempo para perguntar ao roteador";
  if (Date.now() < disjuntorAbertoAte) {
    ultimoMotivo = "roteador fora (disjuntor aberto)";
  } else {
    const base = baseDoRoteador();
    const tentativas = [PRAZO_PRIMEIRA_MS, PRAZO_SEGUNDA_MS];
    let falhasTransitorias = 0;
    for (let i = 0; i < tentativas.length; i++) {
      if (i > 0) await dormir(PAUSA_ANTES_DA_SEGUNDA_MS);
      const restante = prazo - Date.now();
      if (restante < TEMPO_MINIMO_MS) break;
      const espera = reservarVaga(base, Math.min(ESPERA_MAXIMA_PADRAO_MS, restante - TEMPO_MINIMO_MS));
      if (espera === null) {
        ultimoMotivo = "limitador de 1 req/s sem vez a tempo";
        break;
      }
      if (espera > 0) await dormir(espera);
      const tempo = Math.min(tentativas[i], prazo - Date.now());
      if (tempo < TEMPO_MINIMO_MS) break;

      const r = await perguntar(base, origem, destino, tempo);
      if (r.ok) return medida(r);
      anotarFalha(r.motivo);
      ultimoMotivo = r.motivo;
      if (r.definitiva) {
        return ouRotaVelha({ ok: false, tipo: "definitiva", motivo: r.motivo });
      }
      falhasTransitorias++;
      // 429 é o servidor pedindo para parar: insistir piora e pode render
      // bloqueio do IP — que derrubaria a rota de TODAS as lojas.
      if (r.status === 429) {
        abrirDisjuntor("HTTP 429");
        break;
      }
    }
    // Duas falhas seguidas é roteador fora, não azar.
    if (falhasTransitorias >= 2) abrirDisjuntor(ultimoMotivo);
  }

  // 3. O roteador reserva, só para falha passageira do principal: "não há
  //    rota" dele o reserva também diria. Uma tentativa; falhou, disjuntor dele.
  const baseReserva = baseDaReserva();
  if (baseReserva && Date.now() >= disjuntorDaReservaAte) {
    const restante = prazo - Date.now();
    const espera = restante >= TEMPO_MINIMO_MS
      ? reservarVaga(baseReserva, Math.min(ESPERA_MAXIMA_PADRAO_MS, restante - TEMPO_MINIMO_MS))
      : null;
    if (espera !== null) {
      if (espera > 0) await dormir(espera);
      const tempo = Math.min(PRAZO_PRIMEIRA_MS, prazo - Date.now());
      if (tempo >= TEMPO_MINIMO_MS) {
        const r = await perguntar(baseReserva, origem, destino, tempo);
        if (r.ok) {
          estado.respondidasPelaReserva++;
          return medida(r);
        }
        anotarFalha(`reserva: ${r.motivo}`);
        if (r.definitiva) {
          return ouRotaVelha({ ok: false, tipo: "definitiva", motivo: `reserva: ${r.motivo}` });
        }
        disjuntorDaReservaAte = Date.now() + DISJUNTOR_MS;
        ultimoMotivo = `${ultimoMotivo}; reserva: ${r.motivo}`;
      }
    }
  }
  return ouRotaVelha({ ok: false, tipo: "transitoria", motivo: ultimoMotivo });
}

/**
 * Quantos km de rua entre os dois pontos, ou `null` quando não deu para saber.
 * A forma antiga, para quem só quer o número; o motivo da falha está em
 * `rotaEntre`.
 */
export async function distanciaPorRotaKm(origem: Ponto, destino: Ponto): Promise<number | null> {
  const r = await rotaEntre(origem, destino);
  return r.ok ? r.km : null;
}

// ── O FATOR DE DESVIO DA LOJA ──────────────────────────────────────────────

const fatores = new Map<string, { valor: { fator: number; amostras: number }; exp: number }>();
const VALIDADE_DO_FATOR_MS = 10 * 60_000;

/**
 * Quanto a rua desta loja costuma ser maior que a linha reta.
 *
 * A mediana das rotas que ela JÁ mediu (RotaCache, mesma origem), limitada
 * entre 1,2 e 2,0; sem histórico, 1,4. Medido na Divinos: de 1,09× a 1,92×,
 * mediana perto de 1,5 — o 1,3 da literatura subcobraria justo quem mora do
 * outro lado do canal. Rota menor que a linha reta (ponto arrastado até a
 * rua) e rota muito curta (razão ruidosa) não entram na conta.
 */
export async function fatorDeDesvio(origem: Ponto): Promise<{ fator: number; amostras: number }> {
  const prefixo = prefixoDaOrigem(origem);
  const lembrado = fatores.get(prefixo);
  if (lembrado && lembrado.exp > Date.now()) return lembrado.valor;

  const doBancoAmostras = await doBanco(() => cacheDeRotas.daOrigem(prefixo), [] as { chave: string; km: number }[]);
  const porChave = new Map<string, number>();
  for (const a of doBancoAmostras) porChave.set(a.chave, a.km);
  for (const [chave, r] of naMemoria) if (chave.startsWith(prefixo)) porChave.set(chave, r.km);

  const razoes: number[] = [];
  for (const [chave, km] of porChave) {
    const [lat, lng] = chave.slice(prefixo.length).split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(km)) continue;
    const reta = linhaRetaKm(origem, { lat, lng });
    if (reta < RETA_MINIMA_DA_AMOSTRA_KM) continue;
    const razao = km / reta;
    if (razao < 1 || razao > 4) continue;
    razoes.push(razao);
  }

  let valor: { fator: number; amostras: number };
  if (razoes.length < AMOSTRAS_MINIMAS) {
    valor = { fator: FATOR_SEM_HISTORICO, amostras: razoes.length };
  } else {
    razoes.sort((a, b) => a - b);
    const meio = Math.floor(razoes.length / 2);
    const mediana = razoes.length % 2 ? razoes[meio] : (razoes[meio - 1] + razoes[meio]) / 2;
    valor = { fator: arredondar(Math.min(FATOR_MAXIMO, Math.max(FATOR_MINIMO, mediana))), amostras: razoes.length };
  }
  fatores.set(prefixo, { valor, exp: Date.now() + VALIDADE_DO_FATOR_MS });
  return valor;
}

/**
 * A distância estimada: linha reta × fator, arredondada a 0,01 km como a rota.
 * A reta entra EXATA (geocoding.ts, linhaRetaKm): arredondada antes, a conta
 * arredondava duas vezes e 0,7375 × 1,36 dava 1,01 km em vez de 1,00 (R5).
 */
export function estimarPelaLinhaReta(linhaRetaKm: number, fator: number): number {
  return arredondar(linhaRetaKm * fator);
}

// ── SONDA (só para o /api/health?sondar=1) ─────────────────────────────────

type ResultadoDaSonda = { ok: boolean; ms: number; motivo?: string };
let ultimaSonda: { em: number; valor: ResultadoDaSonda } | null = null;
let sondaEmVoo: Promise<ResultadoDaSonda> | null = null;

/**
 * Pergunta de verdade ao roteador, sem cache — o estado passivo só sabe da
 * última cotação. Uma vez por minuto no máximo, e respeitando o limitador.
 *
 * Uma sonda por vez: o resultado só era guardado DEPOIS de ela terminar, e
 * 30 GETs simultâneos de /api/health?sondar=1 reservavam 3 vagas do limitador
 * (empurrando a rota das cotações). Quem chega com uma em voo espera a mesma.
 */
export function sondarRoteador(): Promise<ResultadoDaSonda> {
  if (ultimaSonda && Date.now() - ultimaSonda.em < 60_000) return Promise.resolve(ultimaSonda.valor);
  if (sondaEmVoo) return sondaEmVoo;
  const voo = (async (): Promise<ResultadoDaSonda> => {
    const inicio = Date.now();
    // A sonda é do PRINCIPAL: é ele que diz se a rota está saindo do jeito certo.
    const base = baseDoRoteador();
    const espera = reservarVaga(base, 2000);
    let valor: ResultadoDaSonda;
    if (espera === null) {
      valor = { ok: false, ms: 0, motivo: "limitador sem vez" };
    } else {
      if (espera > 0) await dormir(espera);
      // Dois pontos fixos em Cabo Frio (Divinos Burger → Vila Boca do Mato).
      const r = await perguntar(base, { lat: -22.854033, lng: -42.0296526 }, { lat: -22.8518, lng: -42.0353 }, PRAZO_PRIMEIRA_MS);
      valor = r.ok ? { ok: true, ms: Date.now() - inicio } : { ok: false, ms: Date.now() - inicio, motivo: r.motivo };
    }
    ultimaSonda = { em: Date.now(), valor };
    return valor;
  })();
  sondaEmVoo = voo;
  voo
    .finally(() => {
      if (sondaEmVoo === voo) sondaEmVoo = null;
    })
    .catch(() => undefined);
  return voo;
}

// ── COMO A LOJA MEDE ───────────────────────────────────────────────────────

export type MedicaoDeDistancia = "RAIO" | "ROTA";

/**
 * Como esta loja mede a distância — pelo `deliveryZoneType`.
 *
 * "ROTA" é um TIPO de área, não uma opção à parte, e isso é de propósito: as
 * faixas em km são exatamente as mesmas do raio, muda só o número que entra
 * na comparação. Guardar num segundo lugar (deliveryConfig) criaria o estado
 * impossível de "área por bairro medindo por rota".
 *
 * Qualquer outro valor — inclusive os antigos "KM" e "RADIUS" — é raio, que é
 * como toda loja cadastrada até aqui funciona.
 */
export function medicaoDaLoja(deliveryZoneType: unknown): MedicaoDeDistancia {
  return String(deliveryZoneType || "").toUpperCase() === "ROTA" ? "ROTA" : "RAIO";
}
