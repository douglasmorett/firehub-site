/**
 * GET /api/prazos/relatorio?dias=7 — a matéria-prima do relatório do dono.
 *
 * Devolve os eventos de prazo (transições) do período, o último estado e as
 * lojas; quem soma os minutos por faixa é a página /prazos/relatorio, no
 * fuso do navegador do dono. A rota aceita o token do popup (query ou header)
 * — o relatório abre pela extensão, sem segundo login.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaPrazos, resolverConta, lerConfig, contaPodeUsar, motivoDoBloqueio } from "@/lib/prazos";
import { podarEventosDePrazo } from "@/lib/prazos-eventos";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

export async function GET(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Abra o relatório pela extensão." }, { status: 401 });
    if (!contaPodeUsar(conta.status)) {
      return respostaPrazos({ error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
    }

    const dias = Math.min(31, Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get("dias")) || 7)));
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    // O trecho aberto no início do período precisa do último evento ANTES dele.
    const [anteriorAoPeriodo, eventos] = await Promise.all([
      prisma.prazoEvento.findFirst({ where: { contaId: conta.id, em: { lt: desde } }, orderBy: { em: "desc" } }),
      prisma.prazoEvento.findMany({ where: { contaId: conta.id, em: { gte: desde } }, orderBy: { em: "asc" }, take: 5000 }),
    ]);
    if (Math.random() < 0.05) await podarEventosDePrazo(conta.id);

    const cfg = lerConfig(conta.config);
    const estado: any = conta.ultimoEstado || {};
    const linha = (e: any) => ({ em: e.em, tipo: e.tipo, pedidos: e.pedidos, minutos: e.minutos, pausar: e.pausar, preparo99: e.preparo99 });

    return respostaPrazos({
      success: true,
      agora: new Date().toISOString(),
      dias,
      conta: { nomeLoja: conta.nomeLoja, motoboys: conta.motoboys, modo: cfg.modo, status: conta.status, roboLigado: cfg.roboLigado },
      visto: estado.visto || null,
      lendo: estado.lendo !== false,
      lojas: {
        ifood: cfg.lojasIfood.filter((l) => l.ativa).map((l) => l.nome),
        n99: cfg.lojas99.filter((l) => l.ativa).map((l) => l.nome),
        ultimaAplicacao: estado.lojas || null,
        aplicadoEm: estado.aplicadoEm || null,
      },
      anterior: anteriorAoPeriodo ? linha(anteriorAoPeriodo) : null,
      eventos: eventos.map(linha),
    });
  } catch (err: any) {
    console.error("[Prazos relatorio]", err?.message);
    return respostaPrazos({ error: "Erro ao montar o relatório" }, { status: 500 });
  }
}
