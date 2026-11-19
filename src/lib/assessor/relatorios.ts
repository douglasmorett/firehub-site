/**
 * QUALQUER RELATÓRIO, QUALQUER DIA — o Bill lê os relatórios do menu pelas
 * mesmas rotas das telas (api/store/relatorios/<slug>), dentro da sessão de
 * quem conversa (./sessao-do-bill.ts). Antes ele só sabia o dia de hoje (os
 * DADOS AO VIVO do prompt): "quanto vendi ontem?" não tinha de onde sair
 * (reclamação de cliente, 18/11/2026).
 *
 * Os números são os da tela, com a régua dela (dia vira às 5h, fuso da loja,
 * mesa conta uma vez). Aqui só se escolhe o relatório, monta a query e encolhe
 * a resposta para caber no modelo: lista longa vira as primeiras linhas + o
 * total de linhas.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hojeNaLoja, NOMES_DOS_DIAS } from "@/lib/relatorios/base";
import { comoQuemConversa } from "./sessao-do-bill";
import type { ContextoDoAssessor } from "./ferramentas";

type Rota = { GET: (req: NextRequest) => Promise<Response> };

/** slug → [o que traz (vai na descrição da ferramenta), a rota da tela]. */
export const RELATORIOS_DO_BILL: Record<string, [string, () => Promise<Rota>]> = {
  "vendas": ["Vendas por período: faturamento, nº de vendas, ticket, canais, tipos, canceladas, comparação com o período anterior", () => import("@/app/api/store/relatorios/vendas/route")],
  "faturamento-por-dia": ["faturamento dia a dia", () => import("@/app/api/store/relatorios/faturamento-por-dia/route")],
  "faturamento-mensal": ["faturamento mês a mês", () => import("@/app/api/store/relatorios/faturamento-mensal/route")],
  "itens-vendidos": ["produtos mais vendidos (quantidade e valor)", () => import("@/app/api/store/relatorios/itens-vendidos/route")],
  "faturamento-combos": ["faturamento dos combos", () => import("@/app/api/store/relatorios/faturamento-combos/route")],
  "ticket-medio": ["ticket médio por canal/dia", () => import("@/app/api/store/relatorios/ticket-medio/route")],
  "formas-de-pagamento": ["vendas por forma de pagamento (Pix, cartão, dinheiro…)", () => import("@/app/api/store/relatorios/formas-de-pagamento/route")],
  "plataformas": ["iFood/99/apps: vendas, taxas e repasses", () => import("@/app/api/store/relatorios/plataformas/route")],
  "data-hora": ["vendas por dia da semana e hora", () => import("@/app/api/store/relatorios/data-hora/route")],
  "areas-de-entrega": ["vendas por bairro/área de entrega", () => import("@/app/api/store/relatorios/areas-de-entrega/route")],
  "descontos": ["cupons e descontos dados", () => import("@/app/api/store/relatorios/descontos/route")],
  "tempos": ["tempo de preparo, de entrega e por status", () => import("@/app/api/store/relatorios/tempos/route")],
  "reposicoes": ["reposições (faltou item, troca)", () => import("@/app/api/store/relatorios/reposicoes/route")],
  "giro-de-mesas": ["giro e ocupação das mesas", () => import("@/app/api/store/relatorios/giro-de-mesas/route")],
  "cancelamentos": ["cancelamentos e cortesias (quem, motivo, valor)", () => import("@/app/api/store/relatorios/cancelamentos/route")],
  "falhas-de-integracao": ["pedidos com falha na integração", () => import("@/app/api/store/relatorios/falhas-de-integracao/route")],
  "ranking-de-entregadores": ["ranking dos entregadores (entregas, tempo)", () => import("@/app/api/store/relatorios/ranking-de-entregadores/route")],
  "acerto-de-entregadores": ["acerto dos motoboys (quanto cada um recebe)", () => import("@/app/api/store/relatorios/acerto-de-entregadores/route")],
  "fluxo-de-caixa": ["entradas e saídas de dinheiro por dia", () => import("@/app/api/store/relatorios/fluxo-de-caixa/route")],
  "contas-a-receber": ["a receber (cartão, apps, fiado)", () => import("@/app/api/store/relatorios/contas-a-receber/route")],
  "diferencas-de-caixa": ["diferenças na conferência do caixa", () => import("@/app/api/store/relatorios/diferencas-de-caixa/route")],
  "sangrias-e-suprimentos": ["sangrias e suprimentos do caixa", () => import("@/app/api/store/relatorios/sangrias-e-suprimentos/route")],
  "itens-consumidos": ["insumos consumidos pela ficha técnica", () => import("@/app/api/store/relatorios/itens-consumidos/route")],
  "sugestao-de-compras": ["lista de compras sugerida", () => import("@/app/api/store/relatorios/sugestao-de-compras/route")],
  "previsao-de-insumos": ["previsão de insumos da semana", () => import("@/app/api/store/relatorios/previsao-de-insumos/route")],
  "margem-por-produto": ["margem e custo por produto", () => import("@/app/api/store/relatorios/margem-por-produto/route")],
  "historico-de-contagens": ["contagens de estoque e diferenças", () => import("@/app/api/store/relatorios/historico-de-contagens/route")],
  "saidas-de-estoque": ["saídas de estoque (perda, vencido, consumo)", () => import("@/app/api/store/relatorios/saidas-de-estoque/route")],
  "compras-por-fornecedor": ["compras por fornecedor", () => import("@/app/api/store/relatorios/compras-por-fornecedor/route")],
};

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^\d{2}:\d{2}$/;
const MAX_LINHAS = 25;
const MAX_TEXTO = 240;
const MAX_JSON = 14000;

/** A resposta da tela, encolhida: listas longas viram as primeiras linhas + quantas são. */
export function enxugar(v: unknown, fundo = 0): unknown {
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > MAX_TEXTO ? `${v.slice(0, MAX_TEXTO)}…` : v;
  if (fundo > 6) return "…";
  if (Array.isArray(v)) {
    const linhas = v.slice(0, MAX_LINHAS).map((x) => enxugar(x, fundo + 1));
    return v.length > MAX_LINHAS ? [...linhas, `… e mais ${v.length - MAX_LINHAS} linha(s) (total ${v.length})`] : linhas;
  }
  if (typeof v === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === null || x === undefined || x === "") continue;
      saida[k] = enxugar(x, fundo + 1);
    }
    return saida;
  }
  return String(v);
}

/** Mesmo encolhido, o JSON não passa do teto: corta as listas pela metade até caber. */
function caber(dados: unknown): unknown {
  let atual = dados;
  for (let limite = MAX_LINHAS; JSON.stringify(atual).length > MAX_JSON && limite > 2; limite = Math.floor(limite / 2)) {
    const cortar = (v: unknown): unknown => Array.isArray(v)
      ? [...v.slice(0, limite).map(cortar), ...(v.length > limite ? [`… (lista cortada: ${v.length} itens)`] : [])]
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, cortar(x)])) : v;
    atual = cortar(dados);
  }
  return atual;
}

const lista = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((s) => String(s).trim()).filter(Boolean);

export async function consultarRelatorio(args: any, ctx: ContextoDoAssessor): Promise<Record<string, unknown>> {
  const slug = String(args?.relatorio || "").trim();
  const rel = RELATORIOS_DO_BILL[slug];
  if (!rel) return { ok: false, erro: `Relatório desconhecido: "${slug}". Use um destes: ${Object.keys(RELATORIOS_DO_BILL).join(", ")}.` };

  // O WhatsApp não manda o fuso no contexto: o "hoje" é o da loja, como na tela.
  const tz = ctx.timezone || (await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeTimezone: true } }))?.storeTimezone;
  const hoje = hojeNaLoja(tz);
  const de = DIA_RE.test(String(args?.de || "")) ? String(args.de) : hoje;
  const ate = DIA_RE.test(String(args?.ate || "")) ? String(args.ate) : de;
  if (de > hoje) return { ok: false, erro: `O período começa no futuro (${de}); hoje é ${hoje}.` };

  const sp = new URLSearchParams({ de, ate, lojas: ctx.franchiseeId });
  if (HORA_RE.test(String(args?.horaDe || ""))) sp.set("horaDe", String(args.horaDe));
  if (HORA_RE.test(String(args?.horaAte || ""))) sp.set("horaAte", String(args.horaAte));
  for (const nome of ["canais", "tipos", "categorias", "produtos"] as const) {
    const v = lista(args?.[nome]);
    if (v.length) sp.set(nome, v.join(","));
  }

  const rota = await rel[1]();
  const req = new NextRequest(`http://bill.interno/api/store/relatorios/${slug}?${sp.toString()}`);
  const res = await comoQuemConversa({ usuarioId: ctx.usuarioId, franchiseeId: ctx.franchiseeId }, () => rota.GET(req));
  const corpo: any = await res.json().catch(() => null);
  if (!res.ok || !corpo) return { ok: false, erro: corpo?.error || `O relatório não abriu (${res.status}).` };

  // O dia da semana pronto: no ensaio de 19/11 o modelo chamou terça de "segunda" ao fazer a conta sozinho.
  const comDia = (d: string) => `${NOMES_DOS_DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.split("-").reverse().slice(0, 2).join("/")}`;
  return { ok: true, relatorio: slug, periodo: { de, ate, deComDia: comDia(de), ateComDia: comDia(ate) }, hoje: comDia(hoje), dados: caber(enxugar(corpo)) };
}
