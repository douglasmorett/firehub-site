/**
 * POST /api/prazos/calcular — "tenho N pedidos; que prazo eu ponho, e onde?"
 *
 * É a única chamada que a extensão faz a cada mudança na cozinha, e a única
 * que sabe a tabela. Responde o prazo do iFood, o tempo de preparo do 99Food
 * e as lojas marcadas de cada plataforma — a extensão só escreve no que vier
 * daqui. Também é o sinal de vida da conta: o corpo traz o que a extensão leu
 * (host do painel, colunas e números), o que aplicou em cada loja e o último
 * erro — tudo vai para `ultimoEstado`, que o admin lê para dar suporte sem ir
 * até a loja, e as transições viram histórico (PrazoEvento) para o relatório.
 *
 * Conta sem pagamento recebe 402 e a extensão para de escrever.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  respostaPrazos, resolverConta, contaPodeUsar, motivoDoBloqueio,
  calcularPrazo, calcularPreparo99, lerConfig, cotaDeLojas,
} from "@/lib/prazos";
import { registrarEventoDePrazo } from "@/lib/prazos-eventos";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

const texto = (v: unknown, max: number) => (v === undefined || v === null ? undefined : String(v).slice(0, max));

/** Relato por loja vindo da extensão: [{ id, nome, minutos, ok, erro }], no máximo 40. */
function sanearRelato(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).map((r: any) => ({
    id: texto(r?.id ?? r?.uuid ?? r?.shopId, 40) || "",
    nome: texto(r?.nome, 80) || "",
    minutos: Number.isFinite(Number(r?.minutos)) ? Math.floor(Number(r.minutos)) : null,
    ok: r?.ok === true,
    erro: r?.erro ? texto(r.erro, 160) : null,
    aviso: r?.aviso ? texto(r.aviso, 160) : null,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Entre de novo na extensão." }, { status: 401 });
    if (!contaPodeUsar(conta.status)) {
      return respostaPrazos({ error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
    }

    const body = await req.json().catch(() => ({}));
    const anterior: any = conta.ultimoEstado || {};

    // Sem `pedidos` no corpo é só relato (aplicou / falhou / parou de ler):
    // recalcula com o último número conhecido para a resposta continuar útil.
    const temLeitura = body?.pedidos !== undefined && body?.pedidos !== null && Number.isFinite(Number(body.pedidos));
    const pedidos = temLeitura ? Math.max(0, Math.floor(Number(body.pedidos))) : Math.max(0, Math.floor(Number(anterior.pedidos) || 0));

    const cfg = lerConfig(conta.config);
    const prazo = calcularPrazo({ pedidos, motoboys: conta.motoboys, modo: cfg.modo, regrasManuais: cfg.regrasManuais });
    const preparo99 = calcularPreparo99({ pedidos, prazoIfood: prazo, preparo99: cfg.preparo99 });
    const cota = cotaDeLojas(conta);
    // Acima da cota não sai nada da plataforma: a trava é aqui, não no popup.
    const lojasIfood = cfg.lojasIfood.filter((l) => l.ativa).slice(0, cota).map(({ uuid, nome }) => ({ uuid, nome }));
    const lojas99 = cfg.lojas99.filter((l) => l.ativa).slice(0, cota).map(({ shopId, cityId, contractorId, nome }) => ({ shopId, cityId, contractorId, nome }));

    const colunas = Array.isArray(body?.colunas)
      ? body.colunas.slice(0, 12).map((c: any) => ({ rotulo: texto(c?.rotulo, 60) || "", n: Math.max(0, Math.floor(Number(c?.n) || 0)) }))
      : anterior.colunas;

    // `erro: null` no corpo limpa o erro anterior; ausente mantém.
    const erro = body?.erro !== undefined ? (body.erro ? texto(body.erro, 200) : null) : anterior.erro;
    // Leitura parada = o painel sumiu (a extensão avisa com "sem leitura").
    const lendo = temLeitura ? true : /sem leitura/i.test(String(erro || "")) ? false : anterior.lendo !== false;

    const relato = body?.aplicado && typeof body.aplicado === "object"
      ? {
          aplicadoEm: new Date().toISOString(),
          aplicadoMinutos: Math.floor(Number(body.aplicado.minutos) || 0),
          aplicadoOk: body.aplicado.ok !== false,
          lojas: {
            ifood: sanearRelato(body.aplicado.ifood),
            n99: sanearRelato(body.aplicado.n99),
          },
        }
      : {};

    const estado = {
      ...anterior,
      visto: new Date().toISOString(),
      host: texto(body?.host, 120) ?? anterior.host,
      pedidos,
      colunas,
      minutos: prazo.minutos,
      pausar: prazo.pausar,
      preparo99: preparo99.minutos,
      lendo,
      roboLigado: cfg.roboLigado,
      versao: texto(body?.versao, 20) ?? anterior.versao,
      ...relato,
      erro: erro ?? null,
    };

    await prisma.prazoConta.update({ where: { id: conta.id }, data: { ultimoEstado: estado } });
    await registrarEventoDePrazo(conta.id, anterior, { lendo, minutos: prazo.minutos, pausar: prazo.pausar, preparo99: preparo99.minutos, pedidos });

    return respostaPrazos({
      success: true,
      pedidos,
      motoboys: conta.motoboys,
      minutos: prazo.minutos,
      pausar: prazo.pausar,
      rotulo: prazo.rotulo,
      modo: prazo.modo,
      limites: prazo.limites || null,
      roboLigado: cfg.roboLigado,
      preparo99: { minutos: preparo99.minutos, rotulo: preparo99.rotulo, modo: preparo99.modo },
      lojasIfood,
      lojas99,
      lojasIncluidas: cota,
    });
  } catch (err: any) {
    console.error("[Prazos calcular]", err?.message);
    return respostaPrazos({ error: "Erro ao calcular" }, { status: 500 });
  }
}
