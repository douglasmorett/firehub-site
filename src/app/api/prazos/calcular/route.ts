/**
 * POST /api/prazos/calcular — "tenho N pedidos; que prazo eu ponho?"
 *
 * É a única chamada que a extensão faz a cada mudança na cozinha, e a única
 * que sabe a tabela. Também é o sinal de vida da conta: o corpo traz o que a
 * extensão leu (host do painel, colunas e números), o que aplicou no iFood e
 * o último erro — tudo vai para `ultimoEstado`, que o admin lê para dar
 * suporte sem ir até a loja.
 *
 * Conta sem pagamento recebe 402 e a extensão para de escrever no iFood.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaPrazos, resolverConta, contaPodeUsar, motivoDoBloqueio, calcularPrazo, lerConfig } from "@/lib/prazos";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

const texto = (v: unknown, max: number) => (v === undefined || v === null ? undefined : String(v).slice(0, max));

export async function POST(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Entre de novo na extensão." }, { status: 401 });
    if (!contaPodeUsar(conta.status)) {
      return respostaPrazos({ error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
    }

    const body = await req.json().catch(() => ({}));
    const anterior: any = conta.ultimoEstado || {};

    // Sem `pedidos` no corpo é só relato (aplicou / falhou): recalcula com o
    // último número conhecido para a resposta continuar útil.
    const pedidosBrutos = body?.pedidos ?? anterior.pedidos;
    const pedidos = Number.isFinite(Number(pedidosBrutos)) ? Math.max(0, Math.floor(Number(pedidosBrutos))) : 0;

    const cfg = lerConfig(conta.config);
    const prazo = calcularPrazo({ pedidos, motoboys: conta.motoboys, modo: cfg.modo, regrasManuais: cfg.regrasManuais });

    const colunas = Array.isArray(body?.colunas)
      ? body.colunas.slice(0, 12).map((c: any) => ({ rotulo: texto(c?.rotulo, 60) || "", n: Math.max(0, Math.floor(Number(c?.n) || 0)) }))
      : anterior.colunas;

    const estado = {
      ...anterior,
      visto: new Date().toISOString(),
      host: texto(body?.host, 120) ?? anterior.host,
      pedidos,
      colunas,
      minutos: prazo.minutos,
      pausar: prazo.pausar,
      versao: texto(body?.versao, 20) ?? anterior.versao,
      // Relato do que a extensão fez no iFood (vem na chamada seguinte).
      ...(body?.aplicado && typeof body.aplicado === "object"
        ? {
            aplicadoEm: new Date().toISOString(),
            aplicadoMinutos: Math.floor(Number(body.aplicado.minutos) || 0),
            aplicadoOk: body.aplicado.ok !== false,
          }
        : {}),
      // `erro: null` no corpo limpa o erro anterior; ausente mantém.
      ...(body?.erro !== undefined ? { erro: body.erro ? texto(body.erro, 200) : null } : {}),
    };

    await prisma.prazoConta.update({ where: { id: conta.id }, data: { ultimoEstado: estado } });

    return respostaPrazos({
      success: true,
      pedidos,
      motoboys: conta.motoboys,
      minutos: prazo.minutos,
      pausar: prazo.pausar,
      rotulo: prazo.rotulo,
      modo: prazo.modo,
      limites: prazo.limites || null,
    });
  } catch (err: any) {
    console.error("[Prazos calcular]", err?.message);
    return respostaPrazos({ error: "Erro ao calcular" }, { status: 500 });
  }
}
