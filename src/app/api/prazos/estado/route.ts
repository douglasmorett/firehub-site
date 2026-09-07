/**
 * GET /api/prazos/estado — o que o popup mostra ao abrir.
 *
 * Devolve a conta (status, motoboys, modo, faixas, lojas marcadas, colunas
 * marcadas, cota) e o último prazo calculado. Conta bloqueada TAMBÉM responde
 * — com `podeUsar: false` e o motivo — para o popup dizer ao lojista por que
 * parou, em vez de um 401 mudo que parece defeito.
 */
import { NextRequest } from "next/server";
import { respostaPrazos, resolverConta, contaParaExtensao, calcularPrazo, calcularPreparo99, lerConfig } from "@/lib/prazos";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

export async function GET(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Entre de novo na extensão." }, { status: 401 });

    const ultimo: any = conta.ultimoEstado || null;
    const cfg = lerConfig(conta.config);
    const pedidos = typeof ultimo?.pedidos === "number" ? ultimo.pedidos : null;
    const prazo = pedidos === null
      ? null
      : calcularPrazo({ pedidos, motoboys: conta.motoboys, modo: cfg.modo, regrasManuais: cfg.regrasManuais });
    const preparo99 = prazo && pedidos !== null ? calcularPreparo99({ pedidos, prazoIfood: prazo, preparo99: cfg.preparo99 }) : null;

    return respostaPrazos({ success: true, conta: contaParaExtensao(conta), ultimoEstado: ultimo, prazo, preparo99 });
  } catch (err: any) {
    console.error("[Prazos estado]", err?.message);
    return respostaPrazos({ error: "Erro ao ler a conta" }, { status: 500 });
  }
}
