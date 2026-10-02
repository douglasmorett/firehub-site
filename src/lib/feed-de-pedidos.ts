/**
 * src/lib/feed-de-pedidos.ts — o poll de /api/customer-order/poll trazendo só
 * o que mudou, sem o resto do painel perceber.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Três telas leem este feed em laço: o ouvinte de impressão (toda tela do
 * /store, a cada 5 s), a tela de pedidos (8 s) e a roteirização (8 s). Cada
 * rodada trazia a lista INTEIRA — no pico de 01/10/2026, ~660 mil linhas de
 * pedido por minuto saindo do banco, e o servidor a ~70% de um núcleo só para
 * montar e serializar isso, sendo que quase nada tinha mudado.
 *
 * Agora a primeira rodada é completa e as seguintes pedem `desde=<instante>`:
 * o servidor devolve só o pedido atualizado depois disso e os ids que saíram
 * do filtro. Este módulo guarda a lista, aplica a diferença e devolve a lista
 * INTEIRA, ordenada e cortada como o servidor faz (createdAt desc, 200). Quem
 * chama continua recebendo exatamente o formato de antes.
 *
 * ── As três garantias ───────────────────────────────────────────────────────
 *
 *   • Lista completa a cada 60 s, ao trocar o período e quando o servidor
 *     acha que mudou demais: o que escapar da diferença (nome do motoboy,
 *     garçom da mesa, pedido que saiu da janela de tempo) se corrige sozinho.
 *   • `desde` volta 30 s antes do último `agora` do servidor: o que foi gravado
 *     enquanto a leitura rodava aparece de novo na rodada seguinte.
 *   • Resposta antiga (lista pura) é tratada como completa — nada quebra se o
 *     servidor ainda não tiver esta versão.
 */

const COMPLETA_A_CADA_MS = 60_000;
const FOLGA_MS = 30_000;
const LIMITE = 200;

export type RodadaDoFeed = {
  ok: boolean;
  status: number;
  /** Cabeçalho Date da resposta (ms), ou NaN — a "hora do servidor" do painel. */
  dataDoServidor: number;
  /** A lista inteira, no formato de sempre. null quando a resposta falhou. */
  lista: any[] | null;
  /** O texto que representa a lista, para quem compara com a rodada anterior. */
  texto: string;
  /** Esta rodada veio completa do servidor? */
  completa: boolean;
};

export type FeedDePedidos = {
  buscar: (janela: string, opcoes?: { completa?: boolean; init?: RequestInit }) => Promise<RodadaDoFeed>;
};

function porCriacaoDesc(a: any, b: any): number {
  return new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime();
}

/**
 * Aplica uma resposta de "só o que mudou" à lista guardada e devolve a lista
 * inteira, como o servidor a mandaria: createdAt desc, até 200. Altera o mapa.
 * Separada do `buscar` para o teste de equivalência usar exatamente esta conta
 * (scripts/teste-feed-so-o-que-mudou.ts).
 */
export function remontarLista(porId: Map<string, any>, pedidos: any[], removidos: string[]): any[] {
  for (const id of removidos) porId.delete(id);
  for (const o of pedidos) porId.set(o.id, o);
  const lista = Array.from(porId.values()).sort(porCriacaoDesc).slice(0, LIMITE);
  // O que passou do corte sai do mapa também, como sairia da lista completa.
  if (porId.size > LIMITE) {
    const ficam = new Set(lista.map((o) => o.id));
    for (const id of Array.from(porId.keys())) if (!ficam.has(id)) porId.delete(id);
  }
  return lista;
}

/**
 * Um feed por consumidor: cada um tem a própria janela (o ouvinte de impressão
 * usa as últimas 24 h; a tela de pedidos, o período escolhido).
 *
 * `janela` é o pedaço da query que define o recorte (ex.: "&from=…&to=…", ou
 * "" para o padrão do servidor). Trocou a janela, a próxima rodada é completa.
 */
export function criarFeedDePedidos(): FeedDePedidos {
  let porId = new Map<string, any>();
  let agoraDoServidor: number | null = null;
  let janelaAtual: string | null = null;
  let ultimaCompleta = 0;

  async function buscar(janela: string, opcoes: { completa?: boolean; init?: RequestInit } = {}): Promise<RodadaDoFeed> {
    const pedeCompleta =
      opcoes.completa === true ||
      janela !== janelaAtual ||
      agoraDoServidor === null ||
      Date.now() - ultimaCompleta >= COMPLETA_A_CADA_MS;

    let url = `/api/customer-order/poll?t=${Date.now()}${janela}`;
    if (!pedeCompleta) url += `&desde=${encodeURIComponent(new Date(agoraDoServidor! - FOLGA_MS).toISOString())}`;

    const res = await fetch(url, opcoes.init);
    const dataDoServidor = new Date(res.headers.get("date") || "").getTime();
    if (!res.ok) return { ok: false, status: res.status, dataDoServidor, lista: null, texto: "", completa: pedeCompleta };

    const texto = await res.text();
    const corpo = JSON.parse(texto);
    const agoraHeader = new Date(res.headers.get("x-feed-agora") || "").getTime();

    if (Array.isArray(corpo)) {
      // Completa: a lista é exatamente a do servidor, na ordem dele.
      porId = new Map(corpo.map((o: any) => [o.id, o]));
      janelaAtual = janela;
      ultimaCompleta = Date.now();
      // Sem o cabeçalho (servidor anterior a esta versão) a rodada seguinte
      // também é completa — o comportamento de antes.
      agoraDoServidor = Number.isFinite(agoraHeader) ? agoraHeader : null;
      return { ok: true, status: res.status, dataDoServidor, lista: corpo, texto, completa: true };
    }

    const lista = remontarLista(porId, corpo?.pedidos || [], corpo?.removidos || []);
    const agoraCorpo = new Date(corpo?.agora || "").getTime();
    agoraDoServidor = Number.isFinite(agoraCorpo) ? agoraCorpo : null;
    return { ok: true, status: res.status, dataDoServidor, lista, texto: JSON.stringify(lista), completa: false };
  }

  return { buscar };
}
