/**
 * O COMPROVANTE DO FIADO — o papel que o funcionário (ou o cliente do fiado)
 * assina reconhecendo o que foi para a conta dele.
 *
 * Pedido do Douglas (07/11/2026): "no fiado incluir opção de imprimir fiado
 * para o funcionário assinar com o nome dele e já a opção de assinatura".
 * Sem papel assinado, a cobrança do fiado no fim do mês vira "eu não peguei
 * isso" contra a palavra do caixa.
 *
 * ── Por que ele nasce como papel de caixa ──────────────────────────────────
 *
 * Vai pela mesma fila da sangria/suprimento (lib/imprimir-caixa.ts) com
 * `kind` "CAIXA_FIADO": o print-queue manda todo `CAIXA_*` para a impressora
 * do caixa, e o Assistente imprime o `relatorio` (1.2.19+) ou, no antigo, os
 * itens como pedido — sem ninguém instalar versão nova. O mesmo envelope
 * (`montar`) que o papel do caixa usa.
 *
 * A assinatura feita NA TELA não sai como desenho no papel térmico: o
 * Assistente só imprime texto. O papel diz "Assinado na tela por Fulano em
 * dd/mm hh:mm"; o desenho sai na impressão pelo navegador
 * (`htmlDoComprovanteDoFiado`) e fica na consulta do extrato.
 *
 * Tudo aqui é puro (sem banco): o teste é scripts/teste-comprovante-do-fiado.ts.
 */
import { montar, reais, type LinhaDoCaixa, type LinhaDoRelatorio, type CupomDoCaixa } from "./cupom-do-caixa";

export const KIND_DO_COMPROVANTE_DO_FIADO = "CAIXA_FIADO";

/** O traço da assinatura. O HTML põe o desenho logo acima dele. */
export const TRACO_DA_ASSINATURA = "______________________________";
/** Cabe em 32 colunas (bobina de 58 mm) com o rótulo. */
export const LINHA_DO_NOME = "Nome legivel: __________________";

/** O que foi lançado no fiado: um pedido (balcão, dívida à mão) ou uma conta de mesa. */
export type LancamentoDoFiado = {
  tipo: "PEDIDO" | "MESA";
  id: string;
  /** "#12" no pedido; "Mesa 4" na mesa. */
  numero: string;
  quando: Date;
  /** Itens com o valor da LINHA (preço × quantidade). Dívida à mão: vazio. */
  itens: { nome: string; qtd: number; valor: number }[];
  /** O que foi para o fiado. */
  valorNoFiado: number;
  /** Observação do pedido / motivo da dívida à mão. */
  obs?: string | null;
};

export type AssinaturaGravada = { nome: string; em: Date };

const quando = (d: Date, fuso: string) =>
  d.toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const centavos = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** A linha do pedido no papel: "2x X Burger". Quantidade 1 também aparece — é conferência. */
export function itensDoPedido(itens: { quantity: number; price: number; productName?: string | null; menuProduct?: { name: string } | null }[]) {
  return itens.map((i) => ({
    nome: (i.productName || i.menuProduct?.name || "Item").trim(),
    qtd: Number(i.quantity) || 1,
    valor: centavos((Number(i.price) || 0) * (Number(i.quantity) || 1)),
  }));
}

export function cupomDoFiado(e: {
  loja: string;
  fuso: string;
  /** Quem está imprimindo agora. */
  operador: string;
  cliente: { nome: string; cargo?: string | null };
  lancamento: LancamentoDoFiado;
  /** Saldo devedor do cliente agora (lib/fiado-da-mesa-regras.ts → saldoDoFiado). */
  saldo: number;
  /** Já assinado na tela: o papel diz por quem e quando. */
  assinatura?: AssinaturaGravada | null;
  segundaVia?: boolean;
  agora?: Date;
}): CupomDoCaixa {
  const agora = e.agora || new Date();
  const l = e.lancamento;
  const nome = "COMPROVANTE DE FIADO";
  const titulo = e.segundaVia ? `2a VIA - ${nome}` : nome;
  const dataHora = agora.toLocaleString("pt-BR", { timeZone: e.fuso, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const R: LinhaDoRelatorio[] = [
    { tipo: "titulo", texto: "Conta (fiado) de" },
    { tipo: "texto", texto: e.cliente.cargo ? `${e.cliente.nome} (${e.cliente.cargo})` : e.cliente.nome },
    { tipo: "linha", texto: l.tipo === "MESA" ? "Conta" : "Pedido", valor: l.numero },
    { tipo: "linha", texto: "Lancado em", valor: quando(l.quando, e.fuso) },
  ];
  if (l.itens.length > 0) {
    // Na mesa é "consumo": taxa, desconto e o que já foi pago no fechamento
    // mexem no valor, e o que ele assina é o NO FIADO, não a soma dos itens.
    R.push({ tipo: "titulo", texto: l.tipo === "MESA" ? "Consumo da mesa" : "Itens" });
    for (const i of l.itens) R.push({ tipo: "linha", texto: `${i.qtd}x ${i.nome}`, valor: reais(i.valor) });
  }
  if (l.obs && l.obs.trim()) R.push({ tipo: "texto", texto: `Obs: ${l.obs.trim()}` });
  R.push({ tipo: "separador" });
  R.push({ tipo: "destaque", texto: "NO FIADO", valor: reais(l.valorNoFiado) });
  R.push({ tipo: "linha", texto: `Saldo devedor em ${quando(agora, e.fuso)}`, valor: reais(e.saldo) });
  R.push({ tipo: "separador" });
  R.push({ tipo: "texto", texto: "Reconheco o valor acima lancado na minha conta (fiado)." });
  if (e.assinatura) {
    R.push({ tipo: "texto", texto: `Assinado na tela por ${e.assinatura.nome} em ${quando(e.assinatura.em, e.fuso)}` });
  }
  // O vão é uma "linha" sem texto nem valor (o Assistente descarta o texto só
  // de espaço): sem ele não há onde escrever em cima do traço — o mesmo
  // recurso da sangria (cupomDeMovimentacaoDeCaixa).
  const vao = (): LinhaDoRelatorio => ({ tipo: "linha", texto: "", valor: "" });
  R.push(vao(), vao());
  R.push({ tipo: "texto", texto: LINHA_DO_NOME });
  R.push(vao(), vao(), vao());
  R.push({ tipo: "texto", texto: TRACO_DA_ASSINATURA });
  R.push({ tipo: "texto", texto: "Assinatura" });

  // Assistente antigo (sem `relatorio`) imprime isto como pedido: os itens, ou
  // uma linha só na dívida lançada à mão.
  const items: LinhaDoCaixa[] = l.itens.length > 0
    ? l.itens.map((i) => ({ name: i.nome, qty: i.qtd, price: i.qtd > 0 ? centavos(i.valor / i.qtd) : i.valor }))
    : [{ name: "Divida no fiado", qty: 1, price: centavos(l.valorNoFiado), notes: l.obs || undefined }];

  return montar({
    // Cada impressão é um pedido de impressão novo (a 2ª via não pode ter o id da 1ª).
    id: `caixa_fiado_${l.id}_${agora.getTime()}`,
    kind: KIND_DO_COMPROVANTE_DO_FIADO,
    titulo,
    cabecalho: { loja: e.loja, dataHora, operador: e.operador || "—" },
    items,
    total: centavos(l.valorNoFiado),
    rodape: `Fiado de ${e.cliente.nome} - ${l.numero}. Assinatura: ______________`,
    relatorio: R,
  });
}

// ── A assinatura desenhada na tela ─────────────────────────────────────────

/** Teto do PNG em base64. A caixa de 500×180 com traço fino dá 5–20 KB; 120 KB é folga, não convite. */
export const TETO_DA_IMAGEM = 120_000;

/** O que chega para gravar. Devolve o erro em português, ou null se está bom. */
export function problemaDaAssinatura(a: { nome?: unknown; imagem?: unknown }): string | null {
  const nome = typeof a.nome === "string" ? a.nome.trim() : "";
  if (nome.length < 2) return "Digite o nome de quem está assinando.";
  if (nome.length > 80) return "O nome ficou comprido demais.";
  const img = typeof a.imagem === "string" ? a.imagem : "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(img)) return "Faça a assinatura na caixa antes de salvar.";
  if (img.length > TETO_DA_IMAGEM) return "A assinatura ficou grande demais. Limpe e assine de novo.";
  return null;
}

// ── A impressão pelo navegador ─────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * O mesmo papel em HTML de bobina (80 mm), para a loja sem Assistente (tablet,
 * celular) ou para levar o desenho da assinatura feita na tela — o que a
 * impressora térmica pela fila não faz. Monta a partir das MESMAS linhas do
 * cupom: o papel do navegador nunca diz outra coisa que o da fila.
 */
export function htmlDoComprovanteDoFiado(cupom: CupomDoCaixa, o: { loja: string; imagemDaAssinatura?: string | null }): string {
  const imagem = o.imagemDaAssinatura;
  const img = imagem && problemaDaAssinatura({ nome: "ok", imagem }) == null ? imagem : null;
  const linhas = (cupom.relatorio || []).map((l) => {
    switch (l.tipo) {
      case "separador":
        return `<hr>`;
      case "titulo":
        return `<h3>${esc(l.texto)}</h3>`;
      case "destaque":
        return `<div class="row big"><span>${esc(l.texto)}</span><span>${esc(l.valor)}</span></div>`;
      case "linha":
        if (!l.texto && !l.valor) return `<div class="vao"></div>`;
        return `<div class="row"><span>${esc(l.texto)}</span><span>${esc(l.valor)}</span></div>`;
      case "texto":
        // O desenho entra em cima do traço, onde a caneta assinaria.
        if (l.texto === TRACO_DA_ASSINATURA && img) return `<img class="ass" src="${esc(img)}" alt="Assinatura"><p>${esc(l.texto)}</p>`;
        return `<p>${esc(l.texto)}</p>`;
    }
  }).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante de fiado</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; width: 72mm; max-width: 100%; padding: 4px; font-family: "Courier New", monospace; font-size: 12px; color: #000; background: #fff; }
  h1 { font-size: 15px; text-align: center; margin: 4px 0; }
  h2 { font-size: 12px; text-align: center; margin: 0 0 6px; font-weight: normal; }
  h3 { font-size: 12px; text-transform: uppercase; margin: 8px 0 2px; }
  p { margin: 2px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row span:last-child { white-space: nowrap; }
  .big { font-size: 15px; font-weight: bold; margin: 4px 0; }
  .vao { height: 12px; }
  .ass { display: block; width: 100%; max-height: 28mm; object-fit: contain; margin-top: -10mm; }
  @media print { .naoimprime { display: none; } }
</style></head><body>
${o.loja ? `<h2><b>${esc(o.loja)}</b></h2>` : ""}
<h1>${esc(cupom.dailyOrderNumber)}</h1>
<h2>${esc(cupom.caixaQuando)} &middot; ${esc(cupom.caixaOperador)}</h2>
${linhas}
<p class="naoimprime" style="margin-top:16px;text-align:center"><button onclick="window.print()" style="padding:10px 18px;font-size:14px">Imprimir</button></p>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });</script>
</body></html>`;
}
