/**
 * "TAMBÉM NESTE PEDIDO": a comanda de um setor avisa o que saiu nos outros.
 *
 * Jerrajê (Gil, pastel/burger/esfiha, impressão por categoria em várias
 * impressoras — vídeo de 17/10/2026): o sistema antigo dele terminava cada
 * comanda de setor com
 *
 *     ** TAMBEM NESTE PEDIDO **
 *     BURGER: 1 item(s)
 *     ESFIHA: 1 item(s)
 *
 * "para o pessoal já ficar ligado e não liberar um e esquecer o outro". O
 * Douglas aprovou como OPÇÃO POR IMPRESSORA (`avisarOutrosSetores`), desligada
 * por padrão: a impressora que solta só bebida não quer isso.
 *
 * ── POR QUE É UM BLOCO DO MODELO, E NÃO CÓDIGO NO ASSISTENTE ──
 *
 * O Assistente instalado (1.2.18+) já imprime blocos `textoRico` e
 * `separador` do `blocos` de cada destino, na ordem em que vêm. O site monta
 * o aviso aqui e o encaixa logo depois do bloco "itens" — nenhuma versão nova
 * do Assistente. Loja que nunca personalizou a comanda não manda `blocos`; com
 * o aviso ligado ela passa a mandar o modelo de fábrica (`modeloPadrao`), que
 * desenha o mesmo papel que o layout embutido (conferido byte a byte no texto
 * visível em scripts/teste-outros-setores-na-comanda.ts). Opção desligada ou
 * nada em outra impressora = nenhum bloco muda.
 */
import { blocosParaOAssistente, modeloPadrao, type Bloco } from "./comanda-modelo";
import { itemEhBebida, type ImpressoraConfigurada } from "./roteamento-de-impressao";

export type SetorDoPedido = { nome: string; itens: number };

type Destino<T> = { impressora: ImpressoraConfigurada; itens: T[] };

const nomeFisico = (p: ImpressoraConfigurada | null | undefined) => String(p?.name || "").trim();

/** O nome do setor no papel: o nome que a loja deu à impressora ("BURGER"), senão o do Windows. */
export function nomeDoSetor(p: ImpressoraConfigurada): string {
  return String(p.label || p.name || "").trim().toUpperCase();
}

function quantidade(i: unknown): number {
  const x = (i || {}) as { quantity?: unknown; qty?: unknown; item?: { quantity?: unknown; qty?: unknown } | null };
  const q = Number(x.quantity ?? x.qty ?? x.item?.quantity ?? x.item?.qty);
  return Number.isFinite(q) && q > 0 ? Math.round(q) : 1;
}

/**
 * Os outros setores deste pedido, do ponto de vista de `desta`.
 *
 * `destinos` é a lista que o roteamento já montou (destinosDoPedido na fila,
 * o mesmo cálculo por impressora no navegador): cada item é o MESMO objeto em
 * todas as impressoras que o recebem, e é por ele que se sabe o que já está
 * no papel desta. `todos` são os itens do pedido inteiro.
 *
 * Não entram: a própria impressora; a que recebe o pedido INTEIRO (sem
 * categoria, "comanda inteira no misto", pedido só de bebida) — ela não é um
 * setor com uma parte, é uma via do pedido. A de "só bebidas" conta só as
 * bebidas, que é o que ela solta (o Assistente tira a bebida do resto).
 */
export function outrosSetoresDoPedido<T>(
  destinos: ReadonlyArray<Destino<T>>,
  desta: ImpressoraConfigurada,
  todos: ReadonlyArray<T> | null | undefined,
  opcoes: { source?: unknown; palavrasDeBebida?: string | string[] | null } = {}
): SetorDoPedido[] {
  if (!desta || desta.avisarOutrosSetores !== true || desta.somenteBebidas === true) return [];
  const minha = destinos.find((d) => d.impressora === desta) || destinos.find((d) => nomeFisico(d.impressora) === nomeFisico(desta));
  if (!minha) return [];
  const aqui = new Set<unknown>(minha.itens);
  const doPedido = new Set<unknown>(todos || []);
  const recebeTudo = (d: Destino<T>) => doPedido.size > 0 && [...doPedido].every((i) => d.itens.includes(i as T));

  const porNome = new Map<string, number>();
  for (const d of destinos) {
    if (d === minha || nomeFisico(d.impressora) === nomeFisico(desta)) continue;
    const soBebida = d.impressora.somenteBebidas === true;
    if (!soBebida && recebeTudo(d)) continue;
    let n = 0;
    for (const item of d.itens) {
      if (aqui.has(item)) continue;
      if (soBebida && !itemEhBebida(item as any, opcoes.source, opcoes.palavrasDeBebida)) continue;
      n += quantidade(item);
    }
    if (n <= 0) continue;
    const nome = nomeDoSetor(d.impressora);
    if (!nome) continue;
    porNome.set(nome, (porNome.get(nome) || 0) + n);
  }
  return [...porNome].map(([nome, itens]) => ({ nome, itens }));
}

/** O aviso no formato de blocos do modelo (separador + texto rico + separador). */
export function blocosDoAvisoDosOutrosSetores(setores: ReadonlyArray<SetorDoPedido>): Bloco[] {
  if (!setores.length) return [];
  return [
    { tipo: "espaco", ligado: true },
    { tipo: "separador", ligado: true },
    {
      tipo: "textoRico",
      ligado: true,
      linhas: [
        { partes: [{ texto: "** TAMBEM NESTE PEDIDO **" }], negrito: true, invertido: true, alinhamento: "centro", tamanho: 1.5 },
        { partes: [{ texto: "(sai em outro setor - nao preparar aqui)" }], alinhamento: "centro" },
        ...setores.map((s) => ({
          partes: [{ texto: `${s.nome}: ${s.itens} ${s.itens === 1 ? "item" : "itens"}` }],
          negrito: true,
        })),
      ],
    },
    { tipo: "separador", ligado: true },
  ];
}

/**
 * Os blocos desta impressora com o aviso logo depois dos itens.
 *
 * `base` é o modelo que a impressora já mandaria (o dela, ou o padrão da loja);
 * sem modelo (loja que nunca personalizou), o de fábrica — a via da cozinha
 * quando a impressora imprime sem valores. Sem setor para avisar devolve
 * `undefined`: quem chama segue mandando exatamente o que mandava.
 */
export function blocosComOutrosSetores(
  base: Bloco[] | null | undefined,
  setores: ReadonlyArray<SetorDoPedido>,
  opcoes: { semValores?: boolean } = {}
): Bloco[] | undefined {
  if (!setores.length) return undefined;
  const lista = Array.isArray(base) && base.length > 0
    ? base
    : blocosParaOAssistente(opcoes.semValores ? modeloPadrao().cozinha : modeloPadrao().completo);
  const aviso = blocosDoAvisoDosOutrosSetores(setores);
  const posItens = lista.findIndex((b) => b && b.tipo === "itens" && b.ligado !== false);
  if (posItens < 0) return [...lista, ...aviso];
  return [...lista.slice(0, posItens + 1), ...aviso, ...lista.slice(posItens + 1)];
}

/** Papel que não é comanda de preparo (conta da mesa, caixa): nunca leva o aviso. */
export function papelSemAvisoDeSetores(order: { kind?: unknown } | null | undefined): boolean {
  const kind = String(order?.kind || "");
  return kind === "CONTA_DA_MESA" || kind.startsWith("CAIXA_");
}
