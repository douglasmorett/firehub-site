/**
 * GET /api/store/antecipacao — quanto deixar pronto: a média de cada lanche
 * nos dois últimos dias iguais da semana (a conta: lib/antecipacao.ts).
 *
 *   dia=hoje|amanha        o dia que se prepara (padrão: hoje, no dia da loja)
 *   horaDe=18:00&horaAte=20:00   só essa faixa (vazio = o dia inteiro)
 *   proximas=3             a faixa é "da hora cheia de agora até daqui a 3 h"
 *   feriado=auto|sim|nao   modo feriado: +20% (auto = pelo calendário da cidade)
 *
 * Vale para toda loja; as 4 bases (carne, calabresa, queijo temperado,
 * mussarela) só vêm para o Hakim.
 *
 * ── Os dias de referência ───────────────────────────────────────────────────
 *
 * Os dois últimos dias iguais da semana, no dia operacional da loja (vira às
 * 5h, fuso da loja — lib/relatorios). Pula o que foi FERIADO (12/10 não serve
 * de base para a segunda comum) e o dia sem venda nenhuma (loja fechada), até
 * 8 semanas para trás. Antes a média usava o relógio do navegador e o dia que
 * viesse — feriado e loja fechada inclusive.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoRelatorio, pedidosDoRelatorio, type ContextoDoRelatorio } from "@/lib/relatorios/servidor";
import { catalogoDoRelatorio } from "@/lib/relatorios/catalogo";
import { temValorImpossivel } from "@/lib/relatorios/regua-da-venda";
import { canalDoRelatorio, dentroDaFaixa, naLoja, somarDias } from "@/lib/relatorios/base";
import { inicioOperacional } from "@/lib/relatorios/janela";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { feriadoLocal } from "@/lib/holidays";
import { nomeDoProduto } from "@/lib/relatorios/itens-vendidos";
import {
  FATOR_DO_FERIADO, contarDia, juntarNomesCurtos, preverBases, preverLinhas, type ContagemDoDia, type PedidoDaAntecipacao,
} from "@/lib/antecipacao";

export const dynamic = "force-dynamic";

const EMAIL_HAKIM = "contatohakim@gmail.com";
const DIAS_DE_REFERENCIA = 2;
const SEMANAS_PARA_TRAS = 8;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/antecipacao");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const dia = sp.get("dia") === "amanha" ? somarDias(ctx.hoje, 1) : ctx.hoje;

  // A faixa de horas. "Próximas N horas" conta da hora cheia de agora, no relógio da loja.
  let horaDe = HORA_RE.test(sp.get("horaDe") || "") ? String(sp.get("horaDe")) : "";
  let horaAte = HORA_RE.test(sp.get("horaAte") || "") ? String(sp.get("horaAte")) : "";
  const proximas = Math.min(12, Math.max(0, Math.floor(Number(sp.get("proximas")) || 0)));
  if (proximas > 0) {
    const agora = naLoja(new Date(), ctx.tz).hora;
    horaDe = hh(agora);
    horaAte = hh(agora + proximas);
  }

  const lojas = await prisma.user.findMany({
    where: { id: { in: [...new Set([ctx.donoId, ...ctx.lojaIds])] } },
    select: { id: true, email: true, isFranqueadoHakim: true, city: true },
  });
  const ehHakim = lojas.some((l) => ctx.lojaIds.includes(l.id) && (l.isFranqueadoHakim || l.email?.toLowerCase() === EMAIL_HAKIM));
  const cidade = lojas.find((l) => l.id === ctx.donoId)?.city || null;

  // Feriado do dia que se prepara: automático pelo calendário, ou ligado/desligado na mão.
  const feriadoDoDia = feriadoLocal(dia, cidade);
  const modoFeriado = sp.get("feriado") === "sim" ? "sim" : sp.get("feriado") === "nao" ? "nao" : "auto";
  const feriadoAtivo = modoFeriado === "sim" || (modoFeriado === "auto" && Boolean(feriadoDoDia));
  const fator = feriadoAtivo ? FATOR_DO_FERIADO : 1;

  // Os pedidos do dia inteiro (a faixa de horas é aplicada na conta, para saber se a loja abriu).
  const ctxDoDia: ContextoDoRelatorio = { ...ctx, filtros: { ...ctx.filtros, horaDe: "", horaAte: "" } };
  const [doRelatorio, ativos] = await Promise.all([
    catalogoDoRelatorio(ctx.lojaIds),
    prisma.menuProduct.findMany({ where: { franchiseeId: { in: ctx.lojaIds }, active: true }, select: { id: true } }),
  ]);
  const catalogo = { ...doRelatorio, ativos: new Set(ativos.map((p) => p.id)) };

  type PedidoLido = PedidoDaAntecipacao & { id: string; createdAt: Date };
  const referencias: { contagem: ContagemDoDia; pedidos: PedidoLido[] }[] = [];
  const pulados: { dia: string; motivo: string }[] = [];
  for (let semana = 1; semana <= SEMANAS_PARA_TRAS && referencias.length < DIAS_DE_REFERENCIA; semana++) {
    const d = somarDias(dia, -7 * semana);
    const feriado = feriadoLocal(d, cidade);
    if (feriado) { pulados.push({ dia: d, motivo: `feriado (${feriado})` }); continue; }
    const lidos = await pedidosDoRelatorio(ctxDoDia, {
      janela: { inicio: inicioOperacional(d, ctx.tz), fim: inicioOperacional(somarDias(d, 1), ctx.tz) },
      select: {
        parentOrderId: true,
        items: {
          select: {
            quantity: true, price: true, productName: true, menuProductId: true, comboSelections: true,
            menuProduct: { select: { id: true, name: true, category: true, active: true, isCombo: true } },
          },
        },
      },
    });
    const pedidos: PedidoLido[] = lidos
      .filter((p) => !temValorImpossivel(p))
      .map((p) => ({ id: p.id, franchiseeId: p.franchiseeId, canal: canalDoRelatorio(p), createdAt: p.createdAt, items: p.items || [] }));
    if (pedidos.length === 0) { pulados.push({ dia: d, motivo: "sem venda (loja fechada?)" }); continue; }
    referencias.push({ contagem: contarDia(d, pedidos, catalogo, ctx.tz, horaDe, horaAte), pedidos });
  }

  const dias = referencias.map((x) => x.contagem);
  juntarNomesCurtos(dias);
  const linhas = preverLinhas(dias, fator);
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));

  return NextResponse.json({
    lojas: ctx.lojaIds.map((id) => ctx.lojasDaConta.find((l) => l.id === id)?.nome || "Loja"),
    tz: ctx.tz,
    hoje: ctx.hoje,
    dia,
    diaSemana: naLoja(inicioOperacional(dia, ctx.tz), ctx.tz).diaSemana,
    horaDe,
    horaAte,
    feriado: { doDia: feriadoDoDia, modo: modoFeriado, ativo: feriadoAtivo, pct: Math.round((FATOR_DO_FERIADO - 1) * 100) },
    referencias: dias.map((d) => ({ dia: d.dia, pedidosNoDia: d.pedidosNoDia, pedidosNaFaixa: d.pedidosNaFaixa })),
    pulados,
    lanches: linhas.filter((l) => !l.combo),
    combos: linhas.filter((l) => l.combo),
    ehHakim,
    bases: ehHakim ? preverBases(dias, fator) : null,
    // Os pedidos que entraram na conta, para a equipe conferir (sem valor).
    pedidos: referencias.map(({ contagem, pedidos }) => ({
      dia: contagem.dia,
      lista: pedidos
        .filter((p) => dentroDaFaixa(naLoja(p.createdAt, ctx.tz).minutos, horaDe, horaAte))
        .map((p) => ({
          id: p.id,
          hora: new Date(p.createdAt).toLocaleTimeString("pt-BR", { timeZone: ctx.tz, hour: "2-digit", minute: "2-digit" }),
          canal: nomeDoCanal.get(p.canal) || p.canal,
          itens: p.items.map((i) => ({ quantidade: i.quantity, nome: nomeDoProduto(i) })),
        })),
    })),
  });
}
