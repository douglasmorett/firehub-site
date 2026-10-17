/**
 * Trilha Premiada e cartão de carimbos na FICHA DO CLIENTE (aba Clientes do
 * painel) — sem banco; quem busca os pedidos é lib/clientes-da-loja.ts.
 *
 * Pedido do Phabio (Pizzaria Lapastine), aprovado pelo Douglas em 16/10/2026:
 * abrir o cliente e ver quanto ele tem em cada programa, sem pedir print do
 * celular dele.
 *
 * ── Regra de ouro: o número da ficha é o que o cliente vê no cardápio ─────────
 *
 * Nada aqui conta de novo:
 * - trilha: `resumoDaTrilha` (lib/trilha-premiada.ts) sobre os pedidos de
 *   `pedidosDaTrilhaDoTelefone` (lib/premio-no-pedido.ts) — a conta e a lista
 *   que respondem ao cardápio e que decidem o prêmio do pedido;
 * - carimbos: `contarCarimbos` (lib/carimbos.ts) sobre o histórico do telefone
 *   (`pedidosDosCarimbosDoTelefone`) — a conta que o cardápio recebe pronta e
 *   que decide o prêmio no checkout e no robô.
 * Cada bloco só existe com o programa no ar: `trilhaValida` e `carimbosNoAr`.
 *
 * ── Por que pode não bater com o "Pedidos" da ficha ───────────────────────────
 *
 * O "Pedidos" da ficha segue a régua dos relatórios (DDD + 8 dígitos; sem
 * cancelado, rascunho do robô e esperando pagamento). Cada programa tem a regra
 * dele, e a ficha segue a do programa:
 * - a trilha só conta os canais que a loja ligou, e só no ciclo (prazo) atual;
 * - o carimbo exige o pedido mínimo e não conta marketplace;
 * - os dois acham o pedido pelos 8 últimos dígitos, sem olhar o DDD
 *   (lib/pedidos-do-telefone.ts); a ficha junta por DDD + 8.
 */
import { carimbosNoAr, contarCarimbos, lerCarimbos, minimoDosCarimbos, premioDosCarimbos, type PedidoDoCarimbo } from "./carimbos";
import {
  lerTrilha,
  nomeDoPremio,
  ondeContaOPasso,
  pedidoConta,
  resumoDaTrilha,
  tamanhoDaTrilha,
  trilhaValida,
  type ParadaDaTrilha,
  type PedidoDaTrilha,
  type TipoDePremio,
} from "./trilha-premiada";

export type ParadaNaFicha = {
  pedidos: number;
  tipo: TipoDePremio;
  premio: string;
  situacao: "conquistada" | "proxima" | "adiante";
};

export type TrilhaNaFicha = {
  /** Pedidos que contam no ciclo atual — o "você já deu N passos" do cardápio. */
  passos: number;
  /** O pedido da última parada (a bandeira). */
  tamanho: number;
  faltam: number;
  proxima: { pedidos: number; premio: string } | null;
  /** A última parada alcançada no ciclo atual. */
  alcancada: { pedidos: number; premio: string } | null;
  completou: boolean;
  paradas: ParadaNaFicha[];
  /** A frase que o cardápio mostra ao cliente. */
  chamada: string;
  /** O prêmio que entra sozinho no próximo pedido pelo site. */
  premioAReceber: string | null;
  premiosNaFila: number;
  /** 0 = sem prazo. */
  janelaDias: number;
  cicloExpiraEm: string | null;
  /** Já houve pedido que conta, mas o ciclo venceu: o cliente está no zero. */
  prazoVenceu: boolean;
  /** "Contam os pedidos feitos pelo site e pelo WhatsApp. ..." */
  ondeConta: string;
};

export function trilhaNaFicha(storeLoyalty: unknown, pedidos: PedidoDaTrilha[], agora: Date = new Date()): TrilhaNaFicha | null {
  const trilha = lerTrilha(storeLoyalty);
  if (!trilhaValida(trilha)) return null;
  const r = resumoDaTrilha(trilha, pedidos, agora);
  const parada = (p: ParadaDaTrilha) => ({ pedidos: p.pedidos, premio: nomeDoPremio(p) });
  const alcancada = r.conquistadas[r.conquistadas.length - 1];
  return {
    passos: r.passos,
    tamanho: tamanhoDaTrilha(trilha),
    faltam: r.faltam,
    proxima: r.proxima ? parada(r.proxima) : null,
    alcancada: alcancada ? parada(alcancada) : null,
    completou: r.completou,
    paradas: trilha.paradas.map((p) => ({
      pedidos: p.pedidos,
      tipo: p.tipo,
      premio: nomeDoPremio(p),
      situacao: r.passos >= p.pedidos ? "conquistada" : r.proxima?.pedidos === p.pedidos ? "proxima" : "adiante",
    })),
    chamada: r.chamada,
    premioAReceber: r.premio ? nomeDoPremio(r.premio) : null,
    premiosNaFila: r.premiosNaFila,
    janelaDias: trilha.janelaDias,
    cicloExpiraEm: r.cicloExpiraEm ? r.cicloExpiraEm.toISOString() : null,
    prazoVenceu: r.passos === 0 && (pedidos || []).some((p) => pedidoConta(p, trilha.canais)),
    ondeConta: ondeContaOPasso(trilha),
  };
}

export type CarimbosNaFicha = {
  /** Carimbos no cartão atual — o "3 / 10" do cardápio. */
  noCartao: number;
  meta: number;
  faltam: number;
  /** Cartelas completas (pedidos que ganharam ÷ meta). */
  completas: number;
  /** Prêmios já usados em pedidos (cancelado devolve). */
  usados: number;
  /** Prêmios ganhos e não usados: entram sozinhos no próximo pedido pelo site ou WhatsApp. */
  aReceber: number;
  /** O cliente vê "Você completou a cartela!" no cardápio. */
  acabouDeCompletar: boolean;
  /** Pedidos que ganharam carimbo. */
  validos: number;
  /** "pedido a partir de R$ 43,00" */
  minimo: string;
  /** "R$ 50,00 de desconto" */
  premio: string;
};

/**
 * `pedidos` é o histórico do telefone (`pedidosDosCarimbosDoTelefone`,
 * lib/premio-no-pedido.ts) — o mesmo que o cardápio recebe contado e que decide
 * o prêmio no checkout e no robô.
 */
export function carimbosNaFicha(storeLoyalty: unknown, pedidos: PedidoDoCarimbo[]): CarimbosNaFicha | null {
  const regra = lerCarimbos(storeLoyalty);
  if (!carimbosNoAr(regra)) return null;
  const c = contarCarimbos(regra, pedidos);
  return {
    noCartao: c.noCartao,
    meta: regra.meta,
    faltam: c.faltam,
    completas: c.completas,
    usados: c.usados,
    aReceber: c.aReceber,
    acabouDeCompletar: c.acabouDeCompletar,
    validos: c.validos,
    minimo: minimoDosCarimbos(regra),
    premio: premioDosCarimbos(regra),
  };
}

export type FidelidadeNaFicha = { trilha: TrilhaNaFicha | null; carimbos: CarimbosNaFicha | null };
