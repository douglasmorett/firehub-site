/**
 * As regras do supervisor que não dependem de banco, processo nem rede — num
 * arquivo só para o teste (scripts/teste-supervisor-porta.ts) importar sem
 * ligar o supervisor (o index.ts sobe tudo ao ser importado).
 *
 * Origem: a noite de 14/10/2026 na Hakim Centro. A TV do KDS pulava para a
 * porta da loja num soluço da nuvem, encontrava o supervisor em modo normal e
 * ficava presa em "Ligando o FireHub…"; o FireHub local subia e era desligado
 * 2 a 5 s depois, a cada soluço; e a tela não tinha como voltar à nuvem.
 */

export type ModoDoSupervisor = "iniciando" | "sem-copia" | "normal" | "contingencia" | "voltando" | "revogada";

/**
 * Quanto tempo SEM a nuvem até o supervisor declarar a contingência. Medido
 * no relógio (desde a primeira falha da série), não em número de falhas: o
 * ciclo às vezes demora (espelho, foto) e "4 falhas" virava 12 s ou 24 s.
 * As telas que não são o computador do caixa esperam mais (45 s, decisão do
 * Douglas em 14/10 — lib/contingencia/troca.ts): quando elas pulam, o
 * computador já declarou a queda e a cópia já está atendendo.
 */
export const LIMIAR_DA_QUEDA_MS = 30_000;

/** O FireHub local só desliga depois de tanto tempo sem NENHUMA falha da nuvem. */
export const PAZ_PARA_DESLIGAR_MS = 10 * 60_000;

/**
 * Um aparelho chegou à porta da loja com o supervisor ainda em normal, mas
 * vendo falhas: o FireHub local fica ligado pelo menos isto, pronto para a
 * queda que o aparelho percebeu primeiro.
 */
export const MANTER_LIGADO_NA_ENTRADA_MS = 3 * 60_000;

/** Chave recusada (401) tantas vezes seguidas, por pelo menos tanto tempo: este computador foi desligado da loja. */
export const RECUSAS_PARA_REVOGAR = 5;
export const TEMPO_PARA_REVOGAR_MS = 60_000;

export const emContingencia = (modo: ModoDoSupervisor) => modo === "contingencia" || modo === "voltando";

/** A nuvem está fora há tempo bastante para a loja passar para o computador? */
export function nuvemCaiu(s: { falhas: number; primeiraFalhaEm: number; agora: number }): boolean {
  return s.falhas >= 2 && s.primeiraFalhaEm > 0 && s.agora - s.primeiraFalhaEm >= LIMIAR_DA_QUEDA_MS;
}

/**
 * Pode desligar o FireHub local? Só com a nuvem em paz há 10 min contados da
 * ÚLTIMA falha (antes contava da entrada no modo normal: o local subia num
 * soluço e morria logo em seguida), nunca no meio da subida e nunca enquanto
 * um aparelho que chegou à porta pediu para segurá-lo ligado.
 */
export function deveDesligarLocal(s: {
  ligado: boolean;
  subindo: boolean;
  agora: number;
  normalDesde: number;
  ultimaFalhaEm: number;
  manterLigadoAte: number;
}): boolean {
  if (!s.ligado || s.subindo) return false;
  if (s.agora < s.manterLigadoAte) return false;
  return s.agora - Math.max(s.normalDesde, s.ultimaFalhaEm) > PAZ_PARA_DESLIGAR_MS;
}

/** A chave da loja deixou de valer (a contingência foi ativada noutro computador ou desativada)? */
export function chaveRecusada(s: { recusas: number; primeiraRecusaEm: number; agora: number }): boolean {
  return s.recusas >= RECUSAS_PARA_REVOGAR && s.primeiraRecusaEm > 0 && s.agora - s.primeiraRecusaEm >= TEMPO_PARA_REVOGAR_MS;
}

/** O que a porta da loja faz com um pedido que não é dos endereços internos (/__contingencia/...). */
export type DecisaoDaRota =
  | { tipo: "repassar" }
  | { tipo: "esperar" }
  | { tipo: "redirecionar"; para: string }
  /** A página de entrada do próprio supervisor (PAGINA_DA_ENTRADA): devolve o aparelho à nuvem. */
  | { tipo: "entrada"; acordarLocal: boolean }
  | { tipo: "na-nuvem" };

/** Arquivos do build: só servem à página que a cópia já está mostrando. */
const arquivoDoBuild = (url: string) => url.startsWith("/_next/") || url.startsWith("/favicon") || url.startsWith("/firehub-");

/**
 * A regra da porta da loja:
 *   - em contingência, tudo vai ao FireHub local (ou espera ele ficar pronto);
 *   - com a nuvem de pé, NUNCA a cópia: a loja não pode gravar em dois lugares.
 *     A página de entrar (o aparelho que pulou num soluço) recebe a página
 *     própria do supervisor, que confere a nuvem a partir do aparelho e o
 *     devolve; as outras páginas vão direto para a nuvem;
 *   - ligando (antes do banco subir), a porta já responde: páginas voltam
 *     para a nuvem, a entrada espera;
 *   - chave revogada: só devolve para a nuvem.
 */
export function decidirRota(p: {
  url: string;
  metodo: string;
  html: boolean;
  modo: ModoDoSupervisor;
  localPronto: boolean;
  falhas: number;
  nuvem: string;
}): DecisaoDaRota {
  const url = p.url || "/";
  const paginaGet = p.html && p.metodo === "GET";
  const entrar = url.startsWith("/contingencia/entrar");

  // Endereço curto para digitar no controle da TV: a lista de telas do KDS (a
  // tela solta, sem ?stage=, abria na Produção e a TV não tinha como trocar).
  if (url === "/tv" || url === "/tv/") return { tipo: "redirecionar", para: `${emContingencia(p.modo) ? "" : p.nuvem}/store/kds` };

  if (emContingencia(p.modo)) return p.localPronto ? { tipo: "repassar" } : { tipo: "esperar" };

  if (p.modo === "iniciando") {
    if (entrar || arquivoDoBuild(url)) return { tipo: "esperar" };
    return paginaGet ? { tipo: "redirecionar", para: `${p.nuvem}${url}` } : { tipo: "na-nuvem" };
  }

  if (entrar) {
    if (!paginaGet) return { tipo: "na-nuvem" };
    return { tipo: "entrada", acordarLocal: p.modo === "normal" && p.falhas > 0 };
  }
  if (p.modo !== "revogada" && arquivoDoBuild(url)) return p.localPronto ? { tipo: "repassar" } : { tipo: "esperar" };
  return paginaGet ? { tipo: "redirecionar", para: `${p.nuvem}${url}` } : { tipo: "na-nuvem" };
}

/**
 * A linha do registro de um pedido de página na porta: hora (o registro põe),
 * IP, caminho SEM a consulta (pode levar ficha de acesso) e sem fragmento (o
 * bilhete mora nele — nem chega ao servidor, mas por garantia), e a decisão.
 */
export function linhaDoPedido(ip: string, url: string, decisao: string): string {
  const caminho = String(url || "/").split("#")[0].split("?")[0].slice(0, 120) || "/";
  const temConsulta = String(url || "").split("#")[0].includes("?");
  return `Porta da loja: ${ip || "?"} ${caminho}${temConsulta ? "?…" : ""} → ${decisao}`;
}

// ── Regras da página de entrada (rodam NO NAVEGADOR do aparelho) ─────────────
// Vão para a página como texto (`função.toString()`), por isso: sem chamar
// outra função deste arquivo, sem nada que o navegador de uma TV antiga não
// tenha (nada de `?.`, `??`, arrow nem `1_000`).

/** Para onde a tela volta: um caminho deste site, nunca outro endereço (`//x`, `/\x`). Sem fragmento. */
export function voltaSegura(volta: string | null, tipo: string | null): string {
  var v = String(volta || "").split("#")[0];
  if (v.charAt(0) === "/" && v.charAt(1) !== "/" && v.charAt(1) !== "\\") return v;
  return tipo === "garcom" ? "/garcom" : "/store/pedidos-clientes";
}

/**
 * Para que endereço da nuvem a tela volta: o que a tela pediu (`origem` no
 * fragmento), se for um da nuvem; senão o do painel deste computador; senão
 * o de sempre. Com ou sem "www" importa: cada um guarda a própria entrada.
 */
export function origemDaVolta(p: { origemPedida: string | null; origens: string[]; origemDoPainel: string | null; nuvem: string }): string {
  var origens = p.origens || [];
  if (p.origemPedida && origens.indexOf(p.origemPedida) >= 0) return p.origemPedida;
  if (p.origemDoPainel && origens.indexOf(p.origemDoPainel) >= 0) return p.origemDoPainel;
  return p.nuvem;
}

/**
 * O endereço da volta para a nuvem, com a marca do contrato
 * (`#fh-voltou=<ms>&n=<pulos>`): a tela da nuvem lê a marca e espera antes de
 * pular de novo (1, 3, 10 min, pelo n).
 */
export function enderecoDeVolta(origem: string, volta: string, agora: number, n: number): string {
  return origem + volta + "#fh-voltou=" + agora + "&n=" + n;
}

/** Espera entre as tentativas do aparelho que não alcança a nuvem: 15 s, 30 s, depois 60 s. */
export function esperaDoAparelho(tentativa: number): number {
  return tentativa <= 1 ? 15000 : tentativa === 2 ? 30000 : 60000;
}

/** Quantas vezes este aparelho já voltou para a nuvem em seguida (vai-e-volta = a mesma série). */
export function proximaContagem(anterior: { n: number; em: number } | null, agora: number): number {
  if (anterior && anterior.n > 0 && agora - anterior.em < 20 * 60000) return anterior.n + 1;
  return 1;
}
