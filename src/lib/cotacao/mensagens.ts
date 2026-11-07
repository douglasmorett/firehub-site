/**
 * OS TEXTOS QUE A LOJA MANDA PELO WHATSAPP DELA. Puro: a tela mostra o mesmo
 * texto antes de mandar, e o teste confere.
 *
 * Regras da casa: curto (1–4 linhas, fora a lista do pedido), educado,
 * assinado pela LOJA — o fornecedor fala com a loja, não com um robô; e link
 * sozinho na linha, sem asterisco nem pontuação colada (o WhatsApp emenda e o
 * link quebra).
 */
import type { GrupoDoPedido } from "./pedido";

export const LINK_DO_COMPARATIVO = "https://firehubfood.com.br/store/cotacao";
export const TEXTO_DE_RECEBIDO = "Recebido, obrigado! 🙏";
/** Quantos itens a mensagem de pedido de preços cita pelo nome. */
const ITENS_NA_MENSAGEM = 12;

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora da loja (minutos desde a meia-noite). */
export function saudacao(minutos: number): string {
  if (minutos < 12 * 60) return "Bom dia";
  if (minutos < 18 * 60) return "Boa tarde";
  return "Boa noite";
}

function primeiroNome(contato: string | null | undefined): string {
  const n = String(contato || "").trim().split(/\s+/)[0] || "";
  return n.length >= 2 ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
}

/**
 * O pedido de preços: "Bom dia, João! Aqui é Pizzaria X 😊 Pode me mandar a
 * tabela de preços atualizada ou o encarte? Hoje a gente cota: tomate, cebola e
 * mais 8 itens. Obrigado!"
 */
export function textoDoPedidoDePrecos(o: { loja: string; contato: string | null; itens: string[]; minutos: number }): string {
  const nome = primeiroNome(o.contato);
  const itens = [...new Set(o.itens.map((i) => i.trim()).filter(Boolean))];
  const citados = itens.slice(0, ITENS_NA_MENSAGEM).map((i) => i.toLowerCase());
  const resto = itens.length - citados.length;
  const lista = citados.length
    ? `\nItens que estamos cotando: ${citados.join(", ")}${resto > 0 ? ` e mais ${resto}` : ""}.`
    : "";
  // "Aqui é <loja>", sem "da"/"do": o gênero do nome da loja não se adivinha
  // ("da Sabor da Praça" soa errado; "do Hakim" e "da Hakim" também).
  return `${saudacao(o.minutos)}${nome ? `, ${nome}` : ""}! Aqui é ${o.loja.trim()} 😊\nPode me mandar a tabela de preços atualizada ou o encarte da semana?${lista}\nObrigado!`;
}

/** O pedido de compra, pronto para o fornecedor ler e separar. */
export function textoDoPedidoDeCompra(o: { loja: string; grupo: GrupoDoPedido; minutos: number; observacao?: string | null }): string {
  const g = o.grupo;
  const nome = primeiroNome(g.fornecedor.contato);
  const linhas = g.itens.map((i) => `• ${qtd(i.quantidade)} ${i.unidade} ${i.nome}${i.preco !== null ? ` — ${reais(i.preco)}` : ""}`);
  const partes = [
    `${saudacao(o.minutos)}${nome ? `, ${nome}` : ""}! Aqui é ${o.loja.trim()}. Segue o nosso pedido:`,
    "",
    ...linhas,
    "",
    g.semPreco ? `Total dos itens com preço: ${reais(g.total)} (me confirma o preço dos outros, por favor).` : `Total: ${reais(g.total)}`,
    `Entrega: ${g.entrega.texto}.`,
  ];
  const obs = String(o.observacao || "").trim();
  if (obs) partes.push(obs.slice(0, 300));
  partes.push("Pode confirmar, por favor? Obrigado!");
  return partes.join("\n");
}

export type DadosDoResumo = {
  loja: string;
  responderam: number;
  pedidos: number;
  quedas: { nome: string; de: number; para: number }[];
  altas: { nome: string; de: number; para: number }[];
  /** Preços que a leitura não teve certeza: o comprador confere na tela. */
  paraConferir: number;
};

/** O resumo da rodada para o comprador (o próprio lojista), com o link sozinho na linha. */
export function textoDoResumo(d: DadosDoResumo): string {
  const fmt = (v: { nome: string; de: number; para: number }) => `${v.nome} (${reais(v.de)} → ${reais(v.para)})`;
  const linhas = [`📊 Cotação — ${d.loja.trim()}: ${d.responderam} de ${d.pedidos} fornecedor${d.pedidos === 1 ? "" : "es"} responderam.`];
  if (d.quedas.length) linhas.push(`⬇️ Caíram: ${d.quedas.map(fmt).join("; ")}`);
  if (d.altas.length) linhas.push(`⬆️ Subiram: ${d.altas.map(fmt).join("; ")}`);
  if (d.paraConferir > 0) linhas.push(`${d.paraConferir} preço${d.paraConferir === 1 ? "" : "s"} para você conferir.`);
  linhas.push("Compare e monte o pedido:", LINK_DO_COMPARATIVO);
  return linhas.join("\n");
}
