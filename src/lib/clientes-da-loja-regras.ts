/**
 * As regras da aba Clientes que não precisam do banco — a tela, a rota e o
 * teste (scripts/teste-clientes-da-loja.ts) leem daqui. A consulta mora em
 * lib/clientes-da-loja.ts e faz em SQL a MESMA conta.
 *
 * ── O mesmo cliente em duas linhas (auditoria de 11/10/2026) ─────────────────
 *
 * O robô grava o telefone pelo número da conversa do WhatsApp, que no DDD 91
 * (e em boa parte do país fora de SP/RJ/ES) vem SEM o 9: "+55 (91) 8106-0960".
 * O site grava o que o cliente digitou, com o 9: "91981060960". A lista
 * juntava pelo número inteiro e mostrava duas pessoas: na Ragnar, 79 linhas
 * para 71 clientes — "Erik Bastos, nunca pediu" e "Erik Bastos, 3 pedidos,
 * R$ 213,70". Agora a chave é DDD + os 8 últimos dígitos, a forma canônica de
 * lib/telefone.ts (`telefoneCanonico`, que tira o nono dígito); o saldo de
 * cashback já casava pelos 8 últimos dígitos (`chaveDoSaldo`).
 */
import { ehReposicao, situacaoDoPedido } from "@/lib/relatorios/regua-da-venda";
import { dataDaLoja, FUSO_PADRAO } from "@/lib/fuso";

/**
 * O telefone sem o ramal que o 99Food pendura no número do cliente
 * ("+55 22999642452 (ramal 23163674)"): contados com o ramal, os dígitos
 * passavam de 11 e o cliente do 99 sumia da aba (508 de 853 pedidos do 99 em
 * 30 dias até 11/10/2026). É o número de verdade do cliente — 448 números
 * diferentes nesses 508 pedidos, um nome para cada.
 */
export function semRamal(bruto: unknown): string {
  return String(bruto ?? "").replace(/\(?\s*ramal[^0-9]*[0-9]*\s*\)?/gi, " ").trim();
}

/** DDD + número, só dígitos, sem o 55 do país e sem o ramal; null quando não é telefone brasileiro de cliente. */
export function telefoneDoCliente(bruto: unknown): string | null {
  let d = semRamal(bruto).replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  // 0800 do iFood, "00000000000" do balcão e da mesa: não é telefone de ninguém.
  if (d.startsWith("0")) return null;
  return d;
}

/**
 * A chave do cliente: DDD + os 8 últimos dígitos. "(91) 8106-0960" e
 * "(91) 98106-0960" são a mesma pessoa; "(11) 9 8765-4321" e "(21) 9 8765-4321"
 * não.
 */
export function chaveDoCliente(bruto: unknown): string | null {
  const t = telefoneDoCliente(bruto);
  return t ? t.slice(0, 2) + t.slice(-8) : null;
}

/**
 * O pedido conta para o cliente? A régua única dos relatórios
 * (lib/relatorios/regua-da-venda.ts): venda conta; cancelado (CANCELADO,
 * CANCELLED, CANCELED) e "não concluído" — o rascunho que o robô ainda monta e
 * o pedido do totem/Pix esperando o pagamento — não contam como pedido, nem
 * como gasto, nem como "primeiro pedido".
 */
export function contaComoPedido(status: string | null | undefined): boolean {
  return situacaoDoPedido(status) === "venda";
}

/** `reposicao`: o pedido de reposição (faltou item / troca, R$ 0,00) não é pedido nem gasto do cliente. */
export type PedidoParaNumeros = { status?: string | null; totalAmount?: number | null; createdAt: Date | string; reposicao?: unknown };

/**
 * Os números da ficha do cliente, pela régua: pedidos e gasto só do que conta;
 * o primeiro e o último pedido também (cancelado não faz ninguém cliente); os
 * cancelados e os não concluídos (rascunho do robô, esperando pagamento) à
 * parte. Os pedidos podem vir em qualquer ordem.
 */
export function numerosDoCliente(pedidos: PedidoParaNumeros[]): {
  pedidos: number; gasto: number; ticketMedio: number; primeiro: string | null; ultimo: string | null; cancelados: number; naoConcluidos: number;
} {
  const quando = (p: PedidoParaNumeros) => new Date(p.createdAt).getTime();
  const validos = pedidos.filter((p) => contaComoPedido(p.status) && !ehReposicao(p)).sort((a, b) => quando(a) - quando(b));
  const cancelados = pedidos.filter((p) => situacaoDoPedido(p.status) === "cancelado").length;
  const gasto = Math.round(validos.reduce((t, p) => t + (Number(p.totalAmount) || 0), 0) * 100) / 100;
  return {
    pedidos: validos.length,
    gasto,
    ticketMedio: validos.length ? Math.round((gasto / validos.length) * 100) / 100 : 0,
    primeiro: validos.length ? new Date(validos[0].createdAt).toISOString() : null,
    ultimo: validos.length ? new Date(validos[validos.length - 1].createdAt).toISOString() : null,
    cancelados,
    naoConcluidos: pedidos.length - validos.length - cancelados,
  };
}

/** Quantos dias de CALENDÁRIO, no relógio da loja, separam o instante de agora (0 = hoje). */
export function diasAtras(iso: string | Date, agora: Date = new Date(), fuso: string | null | undefined = FUSO_PADRAO): number {
  const dia = (d: Date) => Date.parse(`${dataDaLoja(fuso || FUSO_PADRAO, d)}T12:00:00Z`);
  return Math.round((dia(agora) - dia(new Date(iso))) / 86_400_000);
}

/**
 * "hoje", "ontem", "há 5 dias" — pelo dia da LOJA, o mesmo da data que a tela
 * mostra ao lado. Antes contava janelas de 24 h: o pedido de ontem às 22h, visto
 * hoje às 10h, era "hoje".
 */
export function haQuanto(iso: string | null | undefined, agora: Date = new Date(), fuso: string | null | undefined = FUSO_PADRAO): string {
  if (!iso) return "nunca pediu";
  const dias = diasAtras(iso, agora, fuso);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "há 1 mês" : meses < 12 ? `há ${meses} meses` : `há ${Math.floor(meses / 12)} ano${meses >= 24 ? "s" : ""}`;
}

/** A data (dd/mm/aaaa) no relógio da loja. */
export function dataNaLoja(iso: string | null | undefined, fuso: string | null | undefined = FUSO_PADRAO): string {
  return iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: fuso || FUSO_PADRAO }) : "";
}

// ── Aniversariantes (o filtro "🎂" da aba e o parabéns pelo WhatsApp) ─────────
//
// O SWFast lista os aniversariantes do mês; aqui a lista vem com o botão de
// mandar parabéns (e um cupom, se a loja quiser) pelo WhatsApp do lojista —
// um link wa.me com o texto pronto, que ele confere e envia. Nada sai sozinho.

export type PeriodoDoAniversario = "mes" | "semana";

/** A "semana" do aniversário: hoje e os 6 dias seguintes. */
export const DIAS_DA_SEMANA_DO_ANIVERSARIO = 7;

/** "15/03", "15/03/1990", "1990-03-15" → mês e dia; inválido → null. */
export function mesEDiaDoAniversario(bruto: unknown): { mes: number; dia: number } | null {
  const t = String(bruto ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  let mes: number, dia: number;
  if (m) [mes, dia] = [Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-]\d{2,4})?$/.exec(t))) [dia, mes] = [Number(m[1]), Number(m[2])];
  else return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > new Date(Date.UTC(2000, mes, 0)).getUTCDate()) return null;
  return { mes, dia };
}

const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const dataIso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** O aniversário naquele ano ("YYYY-MM-DD"); o 29/02 cai no 28/02 quando o ano não é bissexto. */
function aniversarioNoAno(ano: number, x: { mes: number; dia: number }): string {
  const dia = x.mes === 2 && x.dia === 29 && !bissexto(ano) ? 28 : x.dia;
  return dataIso(ano, x.mes, dia);
}

export type Aniversariante = { chave: string; aniversario: string; em: string; hoje: boolean; jaPassou: boolean };

/**
 * Quem faz aniversário no MÊS de hoje (o mês inteiro, também os dias que já
 * passaram — "parabéns atrasado" ainda é parabéns) ou na SEMANA (hoje e os 6
 * dias seguintes, atravessando o fim do mês e do ano). `hoje` é o dia de
 * calendário da loja ("YYYY-MM-DD"). Em ordem de data.
 */
export function aniversariantes(aniversarios: Iterable<[string, string]>, hoje: string, periodo: PeriodoDoAniversario): Aniversariante[] {
  const [ano, mes] = hoje.split("-").map(Number);
  const fimDaSemana = (() => {
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + DIAS_DA_SEMANA_DO_ANIVERSARIO - 1);
    return d.toISOString().slice(0, 10);
  })();
  const saida: Aniversariante[] = [];
  for (const [chave, aniversario] of aniversarios) {
    const x = mesEDiaDoAniversario(aniversario);
    if (!x) continue;
    let em: string | null = null;
    if (periodo === "mes") em = x.mes === mes ? aniversarioNoAno(ano, x) : null;
    else em = [aniversarioNoAno(ano, x), aniversarioNoAno(ano + 1, x)].find((d) => d >= hoje && d <= fimDaSemana) ?? null;
    if (em) saida.push({ chave, aniversario, em, hoje: em === hoje, jaPassou: em < hoje });
  }
  return saida.sort((a, b) => a.em.localeCompare(b.em) || a.chave.localeCompare(b.chave));
}

/** O cupom do presente, como a tela escolhe: o código e o que ele dá ("10% de desconto"). */
export type CupomDoPresente = { codigo: string; beneficio: string };

const NOME_GENERICO = /^(cliente|consumidor|balc[aã]o|sem nome|n[aã]o informado)$/i;

/** O primeiro nome, com a primeira letra maiúscula ("ana paula" → "Ana"); genérico ou vazio → null. */
export function primeiroNome(nome: string | null | undefined): string | null {
  const t = String(nome ?? "").trim();
  if (!t || NOME_GENERICO.test(t)) return null;
  const p = t.split(/\s+/)[0];
  return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR");
}

/**
 * O texto pronto do parabéns. Curto, do jeito que o dono mandaria; o cupom em
 * negrito do WhatsApp; o link sozinho na última linha (link com pontuação
 * colada quebra no WhatsApp).
 */
export function mensagemDeAniversario(x: { nome: string | null | undefined; loja: string; cupom?: CupomDoPresente | null; link?: string | null }): string {
  const nome = primeiroNome(x.nome);
  const linhas = [nome ? `Feliz aniversário, ${nome}! 🎉` : "Feliz aniversário! 🎉", ""];
  // Sem artigo antes do nome da loja: "a NIK", "o Point da esfiha" — o texto não sabe o gênero.
  if (x.cupom) linhas.push(`${x.loja} preparou um presente pra você: use o cupom *${x.cupom.codigo}* e ganhe ${x.cupom.beneficio} no seu próximo pedido.`);
  else linhas.push(`Um dia muito especial pra você, com carinho de ${x.loja}!`);
  if (x.link) linhas.push("", "Peça por aqui:", x.link);
  return linhas.join("\n");
}

/** O link wa.me com o texto pronto — abre o WhatsApp do lojista; quem envia é ele. */
export function linkDoParabens(telefone: string, mensagem: string): string | null {
  const t = telefoneDoCliente(telefone);
  return t ? `https://wa.me/55${t}?text=${encodeURIComponent(mensagem)}` : null;
}

/** O nome do arquivo exportado, com o dia DA LOJA — o do UTC virava amanhã depois das 21h. */
export function nomeDoArquivoDeClientes(agora: Date = new Date(), fuso: string | null | undefined = FUSO_PADRAO): string {
  return `clientes-${dataDaLoja(fuso || FUSO_PADRAO, agora)}.csv`;
}
