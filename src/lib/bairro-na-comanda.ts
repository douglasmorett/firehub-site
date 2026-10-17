/**
 * O BAIRRO NA COMANDA — e o aviso da "taxa pelo bairro" fora da observação do cliente.
 *
 * ── O pedido ────────────────────────────────────────────────────────────────
 *
 * Divinos Burguer (Luiz, gerente; aprovado pelo Douglas em 16/10/2026): na
 * correria ele distribui os pedidos entre os motoboys olhando a comanda da
 * COZINHA impressa, e o modelo "Cozinha sem valores" não tem endereço nem
 * bairro. E quando a taxa saiu pelo bairro (o mapa achou o bairro, não a rua),
 * o aviso que o sistema escreve na observação do pedido
 * (lib/entrega-do-pedido.ts → notasDaEntrega) saía no papel debaixo de
 * "!! OBSERVACAO DO CLIENTE !!" — a cozinha lia como recado do cliente.
 *
 * ── O que mora aqui ─────────────────────────────────────────────────────────
 *
 * 1. O CAMPO {bairro} do modelo da comanda ("BAIRRO: PORTO DO CARRO"), só em
 *    pedido de entrega. O Assistente instalado nas lojas (até a 1.2.44) não
 *    conhece o campo: `campos[parte.campo]` volta vazio e o pedaço some do
 *    papel. Então quem o resolve é o SITE, antes de o pedido ir ao Assistente:
 *    o pedaço `{ texto: "BAIRRO: ", campo: "bairro" }` vira texto pronto
 *    (`{ texto: "BAIRRO: PORTO DO CARRO" }`), que todo Assistente desde a
 *    1.2.18 (texto com variáveis) imprime com o negrito e o tamanho da linha.
 *    Sem bairro (retirada, mesa, endereço sem bairro legível) o pedaço some
 *    inteiro, rótulo junto — a mesma regra do texto rico.
 *    O bairro é o MESMO da linha "Bairro:" do endereço impresso
 *    (lib/endereco-impresso.ts → `bairroDoPedido`), que lê o formato de cada
 *    canal: no iFood/99/Brendi é o bairro que o parceiro mandou.
 *
 * 2. O AVISO DA TAXA PELO BAIRRO sai da observação no papel e vira
 *    "(confira o endereço)" junto do bairro: no campo {avisoDoBairro} (a
 *    linha pequena logo abaixo do BAIRRO, no modelo) e na linha "Bairro:" do
 *    endereço (lib/endereco-impresso.ts). No BANCO a etiqueta continua igual —
 *    a tela de pedidos e o app do motoboy mostram a observação inteira, e lá o
 *    aviso serve.
 *
 * Pura e sem banco: roda na fila da nuvem (api/store/print-queue), no
 * navegador (lib/print.ts) e na prévia da tela (lib/previa-da-comanda.ts) —
 * os três trilhos que montam o pedido do Assistente passam por aqui.
 */
import type { Bloco, LinhaRica, ParteDaLinha } from "@/lib/comanda-modelo";

/** A chave do campo no modelo da comanda (CAMPOS_DISPONIVEIS). */
export const CAMPO_DO_BAIRRO = "bairro";

/**
 * "(confira o endereço)" quando a taxa saiu pelo bairro — campo à parte para
 * a linha do bairro continuar só com o bairro, grande, e o aviso ir pequeno
 * logo abaixo (em 2x os dois juntos quebravam "CARRO (confira o" na bobina).
 */
export const CAMPO_DO_AVISO_DO_BAIRRO = "avisoDoBairro";

/**
 * Os campos que o SITE resolve antes de mandar o pedido: o Assistente
 * instalado não os conhece. Campo novo de comanda que não precise de
 * Assistente novo entra aqui e em `valoresDosCamposDoSite`.
 */
export const CAMPOS_RESOLVIDOS_PELO_SITE: ReadonlySet<string> = new Set([CAMPO_DO_BAIRRO, CAMPO_DO_AVISO_DO_BAIRRO]);

/**
 * A etiqueta que o pedido do site e do balcão leva na observação quando a
 * taxa saiu pelo bairro. Mora aqui (e não só em lib/entrega-do-pedido.ts, que
 * a escreve) para quem escreve e quem a tira do papel lerem o MESMO texto.
 */
export const ETIQUETA_DA_TAXA_PELO_BAIRRO =
  "[📍 Taxa pelo bairro: o mapa achou o bairro, não a rua do cliente — confira o endereço antes de sair]";

/** O aviso curto que fica no papel, ao lado do bairro. */
export const CONFIRA_O_ENDERECO = "(confira o endereço)";

/**
 * A etiqueta do site/balcão, com ou sem o 📍 (o texto já foi escrito com
 * variações de espaço) — e o pedaço que o robô do WhatsApp escreve na nota
 * dele (lib/entrega-do-robo.ts → avisosDaEntregaNaNota), com o " · " que o
 * separa do resto.
 */
const ETIQUETA = String.raw`\s*\[\s*(?:📍\s*)?Taxa pelo bairro\b[^\]]*\]`;
const DO_ROBO = String.raw`(?:\s*·\s*)?📍\s*taxa pelo bairro\s*\(o mapa n[ãa]o achou a rua\)\s*[—–-]\s*confira o endere[çc]o`;
// Uma regex para PERGUNTAR (sem "g": `test` com "g" guarda lastIndex entre
// chamadas e erra a segunda) e outra para TIRAR todas as ocorrências.
const TEM_AVISO = [new RegExp(ETIQUETA, "iu"), new RegExp(DO_ROBO, "iu")];
const TIRA_AVISO = [new RegExp(ETIQUETA, "giu"), new RegExp(DO_ROBO, "giu")];

/** A observação deste pedido tem o aviso de que a taxa saiu pelo bairro? */
export function temAvisoDaTaxaPeloBairro(notas: unknown): boolean {
  if (typeof notas !== "string" || !notas) return false;
  return TEM_AVISO.some((re) => re.test(notas));
}

/**
 * A observação como vai ao PAPEL: sem o aviso do sistema da taxa pelo bairro.
 * O resto (o recado do cliente, cupom, agendamento) fica como está — linha
 * sem o aviso sai idêntica, e a linha que era só o aviso some. Sem o aviso,
 * devolve o mesmo valor que recebeu.
 */
export function notasParaOPapel<T>(notas: T): T | string {
  if (typeof notas !== "string" || !temAvisoDaTaxaPeloBairro(notas)) return notas;
  const saida: string[] = [];
  for (const linha of notas.split("\n")) {
    const limpa = TIRA_AVISO.reduce((t, re) => t.replace(re, ""), linha);
    if (limpa === linha) {
      saida.push(linha);
      continue;
    }
    const t = limpa.replace(/[ \t]{2,}/g, " ").trim();
    if (t) saida.push(t);
  }
  return saida.join("\n").trim();
}

type PedidoComBairro = {
  deliveryType?: unknown;
  tableSessionId?: unknown;
  bairroDoPedido?: unknown;
  notes?: unknown;
};

/**
 * O que o {bairro} imprime: o bairro em maiúsculas ("PORTO DO CARRO"). Vazio
 * fora da entrega e sem bairro legível — e aí a linha some.
 */
export function textoDoBairroNaComanda(pedido: PedidoComBairro | null | undefined): string {
  if (!pedido) return "";
  if (String(pedido.deliveryType ?? "").toUpperCase() !== "DELIVERY" || pedido.tableSessionId) return "";
  return String(pedido.bairroDoPedido ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * O que o {avisoDoBairro} imprime: "(confira o endereço)" quando a taxa saiu
 * pelo bairro — e só junto de um bairro, porque é dele que o aviso fala.
 */
export function avisoDoBairroNaComanda(pedido: PedidoComBairro | null | undefined): string {
  return textoDoBairroNaComanda(pedido) && temAvisoDaTaxaPeloBairro(pedido?.notes) ? CONFIRA_O_ENDERECO : "";
}

/** O valor de cada campo que o site resolve, para ESTE pedido. */
export function valoresDosCamposDoSite(pedido: PedidoComBairro | null | undefined): Record<string, string> {
  return {
    [CAMPO_DO_BAIRRO]: textoDoBairroNaComanda(pedido),
    [CAMPO_DO_AVISO_DO_BAIRRO]: avisoDoBairroNaComanda(pedido),
  };
}

/**
 * Os blocos com os campos do site já trocados pelo valor.
 *
 * Texto com variáveis: o pedaço do campo vira texto pronto (rótulo + valor);
 * vazio, o pedaço some com o rótulo. Texto livre: `{bairro}` e
 * `{avisoDoBairro}` viram o valor (ou nada, como os outros campos do texto
 * livre); os outros `{campos}` ficam para o Assistente. O resto do bloco — negrito,
 * tamanho, tarja, alinhamento — segue intacto. Sem campo do site, devolve a
 * MESMA lista.
 */
export function blocosComCamposDoSite<B extends Partial<Bloco>>(
  blocos: B[] | null | undefined,
  valores: Record<string, string>,
): B[] | null | undefined {
  if (!Array.isArray(blocos)) return blocos;
  const ehDoSite = (campo: unknown) => typeof campo === "string" && CAMPOS_RESOLVIDOS_PELO_SITE.has(campo);
  let mudou = false;
  const saida = blocos.map((bl) => {
    if (!bl || typeof bl !== "object") return bl;
    if (bl.tipo === "textoRico" && Array.isArray(bl.linhas)) {
      if (!bl.linhas.some((ln) => Array.isArray(ln?.partes) && ln.partes.some((p) => ehDoSite(p?.campo)))) return bl;
      mudou = true;
      const linhas = bl.linhas.map((ln): LinhaRica => {
        if (!ln || !Array.isArray(ln.partes) || !ln.partes.some((p) => ehDoSite(p?.campo))) return ln;
        const partes = ln.partes.flatMap((p): ParteDaLinha[] => {
          if (!p || !ehDoSite(p.campo)) return p ? [p] : [];
          const valor = String(valores[p.campo as string] ?? "").trim();
          return valor ? [{ texto: `${p.texto ?? ""}${valor}` }] : [];
        });
        return { ...ln, partes };
      });
      return { ...bl, linhas };
    }
    if (bl.tipo === "textoLivre" && typeof bl.texto === "string" && /\{(\w+)\}/.test(bl.texto)) {
      const texto = bl.texto.replace(/\{(\w+)\}/g, (marca, campo: string) => (ehDoSite(campo) ? valores[campo] ?? "" : marca));
      if (texto === bl.texto) return bl;
      mudou = true;
      return { ...bl, texto };
    }
    return bl;
  });
  return mudou ? saida : blocos;
}

/**
 * O pedido como vai ao Assistente: os campos do site resolvidos em
 * `order.blocos` e a observação sem o aviso do sistema. `valores` vem de fora
 * quando quem chama já os tirou do pedido (o trabalho da fila resolve também
 * os blocos de cada impressora com os mesmos valores).
 */
export function pedidoParaOAssistente<P extends PedidoComBairro & { blocos?: unknown }>(
  pedido: P,
  valores: Record<string, string> = valoresDosCamposDoSite(pedido),
): P {
  if (!pedido || typeof pedido !== "object") return pedido;
  const blocos = Array.isArray(pedido.blocos) ? blocosComCamposDoSite(pedido.blocos as Partial<Bloco>[], valores) : pedido.blocos;
  const notes = notasParaOPapel(pedido.notes);
  if (blocos === pedido.blocos && notes === pedido.notes) return pedido;
  return {
    ...pedido,
    ...(blocos !== pedido.blocos ? { blocos } : {}),
    ...(notes !== pedido.notes ? { notes } : {}),
  };
}

/**
 * A linha "BAIRRO: PORTO DO CARRO" pronta para o modelo: texto com variáveis,
 * em negrito e 2x — o destaque de quem lê a comanda de longe para dividir as
 * entregas —, e logo abaixo, pequeno e em negrito, o "(confira o endereço)"
 * quando a taxa saiu pelo bairro. Pedido sem bairro não imprime nada (o
 * rótulo some com o campo, e o aviso só existe junto do bairro).
 */
export function blocoDaLinhaDoBairro(): Bloco {
  return {
    tipo: "textoRico",
    ligado: true,
    linhas: [
      { partes: [{ texto: "BAIRRO: ", campo: CAMPO_DO_BAIRRO }], negrito: true, tamanho: 2 },
      { partes: [{ campo: CAMPO_DO_AVISO_DO_BAIRRO }], negrito: true },
    ],
  };
}

/** A via já tem a linha do bairro (um pedaço com o campo `bairro`, em qualquer texto com variáveis)? */
export function temLinhaDoBairro(via: Partial<Bloco>[] | null | undefined): boolean {
  return (via || []).some(
    (bl) => bl?.tipo === "textoRico" && (bl.linhas || []).some((ln) => (ln?.partes || []).some((p) => p?.campo === CAMPO_DO_BAIRRO)),
  );
}

/**
 * A via com a linha do bairro logo ABAIXO do cliente (sem bloco de cliente,
 * logo antes dos itens). Se a via já tem a linha, volta a mesma lista: rodar
 * de novo não duplica.
 */
export function viaComLinhaDoBairro(via: Bloco[]): Bloco[] {
  if (temLinhaDoBairro(via)) return via;
  const doCliente = via.findIndex((bl) => bl?.tipo === "cliente");
  const dosItens = via.findIndex((bl) => bl?.tipo === "itens");
  const onde = doCliente >= 0 ? doCliente + 1 : dosItens >= 0 ? dosItens : via.length;
  return [...via.slice(0, onde), blocoDaLinhaDoBairro(), ...via.slice(onde)];
}

/**
 * O trabalho da fila da nuvem como vai ao Assistente: o pedido e o modelo de
 * cada impressora (`destinos[].blocos`), todos com os valores do MESMO pedido
 * — tirados antes de limpar a observação, que é onde está o aviso.
 *
 * Papel que não é pedido (conta da mesa, caixa, DANFE: `order.kind`) passa
 * intacto.
 */
export function trabalhoParaOAssistente<J extends { order?: any; destinos?: any[] }>(job: J): J {
  const order = job?.order;
  if (!order || typeof order !== "object" || order.kind) return job;
  const valores = valoresDosCamposDoSite(order);
  const novoPedido = pedidoParaOAssistente(order, valores);
  let destinosMudaram = false;
  const destinos = Array.isArray(job.destinos)
    ? job.destinos.map((d: any) => {
        if (!d || !Array.isArray(d.blocos)) return d;
        const blocos = blocosComCamposDoSite(d.blocos, valores);
        if (blocos === d.blocos) return d;
        destinosMudaram = true;
        return { ...d, blocos };
      })
    : job.destinos;
  if (novoPedido === order && !destinosMudaram) return job;
  return { ...job, order: novoPedido, ...(destinosMudaram ? { destinos } : {}) };
}
