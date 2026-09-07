/**
 * PUT /api/prazos/config — o que o lojista muda no popup, guardado na conta.
 *
 * Motoboys, modo (auto/manual), faixas manuais e as colunas marcadas no
 * painel dele (receitas, por host). Tudo mora no servidor porque é o
 * servidor que calcula: valor que ficasse só no navegador voltaria ao padrão
 * em silêncio ao trocar de PC — foi assim que a Hakim passou um dia inteiro
 * em "ESTOURO" com a extensão interna.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  respostaPrazos, resolverConta, contaPodeUsar, motivoDoBloqueio,
  contaParaExtensao, lerConfig, sanearRegras, sanearReceitas,
} from "@/lib/prazos";

export const dynamic = "force-dynamic";

const MAX_MOTOBOYS = 50;

export async function OPTIONS() {
  return respostaPrazos({});
}

export async function PUT(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Entre de novo na extensão." }, { status: 401 });
    if (!contaPodeUsar(conta.status)) {
      return respostaPrazos({ error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
    }

    const body = await req.json().catch(() => ({}));
    const atual = lerConfig(conta.config);
    const dados: { motoboys?: number; config?: any } = {};

    if (body?.motoboys !== undefined) {
      const m = Number(body.motoboys);
      if (!Number.isInteger(m) || m < 1 || m > MAX_MOTOBOYS) {
        return respostaPrazos({ error: `motoboys deve ser um inteiro entre 1 e ${MAX_MOTOBOYS}` }, { status: 400 });
      }
      dados.motoboys = m;
    }

    const novaConfig = { ...atual };
    let mudouConfig = false;
    if (body?.modo !== undefined) { novaConfig.modo = body.modo === "manual" ? "manual" : "auto"; mudouConfig = true; }
    if (body?.regrasManuais !== undefined) { novaConfig.regrasManuais = sanearRegras(body.regrasManuais); mudouConfig = true; }
    if (body?.receitas !== undefined) { novaConfig.receitas = sanearReceitas(body.receitas); mudouConfig = true; }
    if (mudouConfig) dados.config = novaConfig;

    if (Object.keys(dados).length === 0) {
      return respostaPrazos({ error: "Nada para salvar" }, { status: 400 });
    }

    const salva = await prisma.prazoConta.update({ where: { id: conta.id }, data: dados });
    return respostaPrazos({ success: true, conta: contaParaExtensao(salva) });
  } catch (err: any) {
    console.error("[Prazos config]", err?.message);
    return respostaPrazos({ error: "Erro ao salvar" }, { status: 500 });
  }
}
