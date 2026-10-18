/**
 * O ASSISTENTE DA NOTIFICAÇÃO — o que escrever e o que evitar (puro; teste em
 * scripts/teste-meu-aplicativo.ts).
 *
 * Douglas, 17/10/2026: "notificação DIRECIONADA, onde a gente ajude ele:
 * sugestões do que fazer, o que escrever, o que dá certo e o que dá errado,
 * baseado no comportamento do cliente dele".
 *
 * - `avaliarTexto`: as regras fixas (título curto, um benefício claro, prazo,
 *   emoji com moderação, nada de madrugada, não repetir) — avisos, nunca
 *   bloqueio. Quem decide é a loja.
 * - `sugestoesProntas`: um texto pronto por objetivo, montado com os dados da
 *   própria loja (produto mais pedido no app, dia mais fraco, horário de pico).
 */
import { MENSAGEM_MAX, TITULO_MAX } from "@/lib/app-da-loja/regras-do-push";
import type { TipoDeSegmento } from "@/lib/app-da-loja/segmentos";

/** Até ~40 letras o título aparece inteiro na tela de bloqueio da maioria dos celulares. */
export const TITULO_IDEAL = 40;

export type Aviso = { nivel: "bom" | "dica" | "atencao"; texto: string };

const BENEFICIO = /(\d|%|r\$|gr[aá]tis|desconto|off\b|dobro|brinde|leve\b|ganhe|promo|cupom|frete|metade|cashback|oferta|novidade|lan[cç]amento)/i;
const PRAZO = /(hoje|amanh|at[eé]\s|s[oó]\s(hoje|at)|[uú]ltim|agora|esta\s(noite|semana)|nesta|neste|sexta|s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|\d{1,2}\s?h\b|\d{1,2}:\d{2}|fim de semana)/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

/** Quantos emojis o texto tem. */
export function contarEmojis(t: string): number {
  return (String(t).match(EMOJI) || []).length;
}

/**
 * Os avisos do texto e da hora de envio. `hora` é a hora do relógio da loja
 * em que vai sair; `enviosNoDia` quantas já saíram/agendadas no mesmo dia;
 * `titulosRecentes` os títulos dos últimos 7 dias.
 */
export function avaliarTexto(t: { titulo: string; mensagem: string }, ctx: { hora: number; enviosNoDia: number; titulosRecentes?: string[] }): Aviso[] {
  const titulo = String(t.titulo || "").trim(), mensagem = String(t.mensagem || "").trim();
  const tudo = `${titulo} ${mensagem}`;
  const avisos: Aviso[] = [];
  if (!titulo && !mensagem) return avisos;
  const tam = [...titulo].length;
  if (tam > TITULO_IDEAL) avisos.push({ nivel: "atencao", texto: `Título com ${tam} letras: acima de ${TITULO_IDEAL} o celular costuma cortar.` });
  else if (tam > 0) avisos.push({ nivel: "bom", texto: "Título curto, aparece inteiro." });
  if (!BENEFICIO.test(tudo)) avisos.push({ nivel: "atencao", texto: "Sem um benefício claro (preço, desconto, frete grátis, brinde). É o que faz tocar." });
  else avisos.push({ nivel: "bom", texto: "Tem um benefício claro." });
  if (!PRAZO.test(tudo)) avisos.push({ nivel: "dica", texto: "Diga até quando vale (“só hoje”, “até as 23h”): prazo dá pressa." });
  else avisos.push({ nivel: "bom", texto: "Tem prazo." });
  const emojis = contarEmojis(tudo);
  if (emojis > 2) avisos.push({ nivel: "atencao", texto: `${emojis} emojis: mais de 2 parece propaganda e cansa.` });
  else if (emojis === 0) avisos.push({ nivel: "dica", texto: "Um emoji no começo do título (🍕, 🔥) ajuda a notificação a se destacar." });
  const letras = tudo.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letras.length >= 10 && letras.replace(/[^A-ZÀ-Þ]/g, "").length / letras.length > 0.6) {
    avisos.push({ nivel: "atencao", texto: "Texto quase todo em MAIÚSCULAS parece spam." });
  }
  if (ctx.hora >= 23 || ctx.hora < 9) avisos.push({ nivel: "atencao", texto: `Envio às ${ctx.hora}h: de madrugada a notificação incomoda e a pessoa desliga as promoções.` });
  if (ctx.enviosNoDia >= 2) {
    avisos.push({ nivel: "atencao", texto: `Você já mandou ${ctx.enviosNoDia} hoje. Muitos envios fazem o cliente desligar as promoções ou apagar o app.` });
  } else if (ctx.enviosNoDia === 1) {
    avisos.push({ nivel: "dica", texto: "Já saiu uma hoje: a segunda do mesmo dia costuma render menos." });
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (titulo && (ctx.titulosRecentes || []).some((r) => norm(r) === norm(titulo))) {
    avisos.push({ nivel: "atencao", texto: "Esse título já foi usado nos últimos 7 dias: repetido, o cliente ignora." });
  }
  if ([...mensagem].length > 0 && [...mensagem].length < 20) avisos.push({ nivel: "dica", texto: "Mensagem bem curta: conte o que a pessoa ganha e como pedir." });
  return avisos;
}

/** Envio duplicado por engano: o mesmo título e mensagem há menos de 2 minutos. */
export function envioDuplicado(t: { titulo: string; mensagem: string }, recentes: { titulo: string; mensagem: string; criadoEm: Date }[], agora: Date): boolean {
  const norm = (s: string) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return recentes.some((r) => agora.getTime() - r.criadoEm.getTime() < 2 * 60 * 1000 && norm(r.titulo) === norm(t.titulo) && norm(r.mensagem) === norm(t.mensagem));
}

// ── SUGESTÕES PRONTAS ───────────────────────────────────────────────────────

export type Objetivo = "voltar" | "promocaoDoDia" | "produtoNovo" | "diaFraco" | "freteGratis" | "combo";

export const OBJETIVOS: { id: Objetivo; rotulo: string; emoji: string }[] = [
  { id: "voltar", rotulo: "Trazer de volta", emoji: "👋" },
  { id: "promocaoDoDia", rotulo: "Promoção do dia", emoji: "🔥" },
  { id: "produtoNovo", rotulo: "Produto novo", emoji: "✨" },
  { id: "diaFraco", rotulo: "Movimentar dia fraco", emoji: "📈" },
  { id: "freteGratis", rotulo: "Frete grátis", emoji: "🛵" },
  { id: "combo", rotulo: "Combo", emoji: "🍱" },
];

export type DadosDaLoja = {
  loja: string;
  produtoTop: { id: string; nome: string; preco: number } | null;
  categoriaTop: string | null;
  /** Nome do dia mais fraco ("terça"). */
  diaFraco: string | null;
  /** Hora sugerida para enviar (relógio da loja). */
  horaDeEnvio: number | null;
};

export type Sugestao = { objetivo: Objetivo; titulo: string; mensagem: string; segmento: TipoDeSegmento; produtoId: string | null; porque: string };

const curto = (s: string, max: number) => {
  const t = s.trim();
  if ([...t].length <= max) return t;
  return [...t].slice(0, max - 1).join("").replace(/\s+\S*$/, "") + "…";
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Um texto pronto por objetivo, com os dados da loja. Sempre dentro dos limites. */
export function sugestoesProntas(d: DadosDaLoja): Sugestao[] {
  const prod = d.produtoTop;
  const nomeProd = prod ? curto(prod.nome, 22) : "seu prato favorito";
  const hora = d.horaDeEnvio != null ? `${Math.min(23, d.horaDeEnvio + 4)}h` : "23h";
  const loja = curto(d.loja, 30);
  const lista: Sugestao[] = [
    {
      objetivo: "voltar", segmento: "sumidos30", produtoId: prod?.id ?? null,
      titulo: `👋 Saudade de você na ${curto(d.loja, 22)}`,
      mensagem: `Faz tempo que você não pede! Hoje tem ${nomeProd} esperando por você. Toque e peça pelo app.`,
      porque: "Vai para quem não pede há 30 dias: lembrar do favorito traz mais de volta do que uma oferta genérica.",
    },
    {
      objetivo: "promocaoDoDia", segmento: "todos", produtoId: prod?.id ?? null,
      titulo: `🔥 Só hoje: ${nomeProd}`,
      mensagem: prod ? `${prod.nome} com preço especial até as ${hora}. Peça pelo app em poucos toques!` : `Promoção especial até as ${hora}. Peça pelo app em poucos toques!`,
      porque: prod ? `É o mais pedido no seu app. Envie ${d.horaDeEnvio != null ? `por volta das ${d.horaDeEnvio}h, uma hora antes do pico` : "uma hora antes do seu horário de pico"}.` : "Um benefício e um prazo claros.",
    },
    {
      objetivo: "produtoNovo", segmento: "ativos30", produtoId: null,
      titulo: `✨ Novidade na ${curto(d.loja, 24)}`,
      mensagem: `Chegou coisa nova no cardápio! Seja um dos primeiros a provar — toque e confira no app.`,
      porque: "Novidade funciona melhor com quem abriu o app no último mês. Escolha o produto novo no link.",
    },
    {
      objetivo: "diaFraco", segmento: "todos", produtoId: prod?.id ?? null,
      titulo: d.diaFraco ? `📈 ${d.diaFraco[0].toUpperCase()}${d.diaFraco.slice(1)} com desconto no app` : "📈 Hoje tem desconto no app",
      mensagem: `Só pelo app: peça hoje até as ${hora} e ganhe um mimo da ${loja}. Toque para pedir!`,
      porque: d.diaFraco ? `${d.diaFraco[0].toUpperCase()}${d.diaFraco.slice(1)} é o dia mais fraco da sua semana: é o dia de usar a notificação.` : "Use no dia de menos movimento.",
    },
    {
      objetivo: "freteGratis", segmento: "ativos30", produtoId: null,
      titulo: "🛵 Frete grátis hoje no app",
      mensagem: `Hoje a entrega é por nossa conta até as ${hora}. Peça pelo app da ${loja}!`,
      porque: "Frete grátis é o benefício mais fácil de entender. Combine um valor mínimo no cardápio.",
    },
    {
      objetivo: "combo", segmento: "ticketAlto", produtoId: null,
      titulo: "🍱 Combo pra galera no app",
      mensagem: `Juntou a turma? Combo com preço especial até as ${hora}. Toque e monte o seu no app.`,
      porque: "Vai para quem já gasta mais: combo sobe o ticket sem dar desconto no item.",
    },
  ];
  return lista.map((s) => ({
    ...s,
    titulo: curto(s.titulo, TITULO_MAX),
    mensagem: curto(s.mensagem, MENSAGEM_MAX),
  }));
}
