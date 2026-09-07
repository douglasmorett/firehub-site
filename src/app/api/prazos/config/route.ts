/**
 * PUT /api/prazos/config — o que o lojista muda no popup, guardado na conta.
 *
 * Motoboys, modo (auto/manual), faixas manuais, regra do 99Food, as lojas
 * marcadas em cada plataforma e as colunas marcadas no painel (receitas, por
 * host). Tudo mora no servidor porque é o servidor que calcula e que decide
 * ONDE escrever: valor que ficasse só no navegador voltaria ao padrão em
 * silêncio ao trocar de PC — foi assim que a Hakim passou um dia inteiro em
 * "ESTOURO" com a extensão interna.
 *
 * A cota de lojas do plano é conferida aqui: marcar além dela devolve 400 com
 * o motivo, e a marcação não muda.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  respostaPrazos, resolverConta, contaPodeUsar, motivoDoBloqueio,
  contaParaExtensao, lerConfig, sanearRegras, sanearReceitas,
  sanearLojasIfood, sanearLojas99, sanearPreparo99, cotaDeLojas, excessoDeCota,
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
    if (body?.lojasIfood !== undefined) { novaConfig.lojasIfood = sanearLojasIfood(body.lojasIfood); mudouConfig = true; }
    if (body?.lojas99 !== undefined) { novaConfig.lojas99 = sanearLojas99(body.lojas99); mudouConfig = true; }
    if (body?.preparo99 !== undefined) { novaConfig.preparo99 = sanearPreparo99(body.preparo99); mudouConfig = true; }
    if (mudouConfig) {
      const excesso = excessoDeCota(novaConfig, cotaDeLojas(conta));
      if (excesso) return respostaPrazos({ error: excesso, cota: true, lojasIncluidas: cotaDeLojas(conta) }, { status: 400 });
      dados.config = novaConfig;
    }

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
