/**
 * Rota 100% automatizada — o estado do botão roxo e a gravação da regra.
 *
 *   GET → `RotaAutomaticaEstado` (components/customer/RotaAutomatica.tsx):
 *         regra gravada, cobrança (a assinatura), os requisitos reais (pino
 *         da loja, motoboys ativos, horário) e o resultado do mês.
 *   PUT → grava `deliveryConfig.roteirizacaoAutomatica` (mesclado: as outras
 *         chaves do deliveryConfig ficam). 409 ao tentar ligar sem o pino da
 *         loja ou sem motoboy ativo (§4.1 do plano).
 *
 * Desde a Fase 1 (22/10/2026), ligada, o cron de 20 s
 * (api/cron/roteirizacao-automatica) cria as rotas e pede prioridade no KDS
 * desta loja; desde a Fase 2, também chama o motoboy.
 *
 * Por que uma rota própria e não o PUT /api/store-settings: a regra passa por
 * `limparRoteirizacaoAutomatica` (só chaves conhecidas, limites) e pela trava
 * dos requisitos e da assinatura. O store-settings deixa de aceitar a chave.
 *
 * ── Fase 4 (05/11/2026): módulo pago, para todas as lojas ──────────────────
 * R$ 97/mês, 7 dias grátis, pela mecânica dos módulos pagos
 * (lib/roteirizacao-automatica/assinatura.ts). Ligar e desligar passam pela
 * assinatura ANTES de gravar a regra:
 *   - ligar: abre um trecho com o aceite do termo (`aceite: { versao }` no
 *     corpo; sem ele, 400 com `precisaDoTermo`). Loja isenta não precisa;
 *   - "Continuar ligada" (`continuar: true`): desmarca o desligamento da
 *     virada do mês (ou põe o aceite no teste que começou sem ele);
 *   - desligar: no teste, para na hora; depois do teste, fica até a virada do
 *     mês — a regra segue `ativo: true` e os trechos desligam sozinhos.
 * O `config.ativo` que o GET devolve é o de VERDADE: a regra ligada E o
 * módulo ligado pela assinatura (ou isenta).
 * Ligar e desligar pagos são do dono (ou do ADMIN pelo "Acessar"), como no
 * Multimarcas; o funcionário vê e ajusta as regras da rota já ligada.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { normalizeStoreHours } from "@/lib/store-hours";
import { lerRoteirizacaoAutomatica, limparRoteirizacaoAutomatica } from "@/lib/roteirizacao-automatica/config";
import { liberadaPara, lojaDoUsuario } from "@/lib/roteirizacao-automatica/liberacao";
import { esquecerLojaDoCarimbo } from "@/lib/roteirizacao-automatica/motoboy-na-loja";
import {
  DIAS_DE_TESTE_DA_ROTA_AUTOMATICA,
  TermoNaoAceitoError,
  estadoDaRotaAutomatica,
  ligarOuDesligarRotaAutomatica,
} from "@/lib/roteirizacao-automatica/assinatura";
import { rotasAutomaticasDoPeriodo, type PedidoDaRotaAutomatica } from "@/lib/relatorios/acerto-de-entregadores";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";

export const dynamic = "force-dynamic";

async function lojaDaSessao(): Promise<{ lojaId: string; podeContratar: boolean } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true, role: true } });
  const lojaId = lojaDoUsuario(u);
  if (!lojaId) return null;
  // Contratar põe R$ 97 no boleto: o funcionário não liga nem desliga.
  return { lojaId, podeContratar: u?.role !== "STAFF" };
}

/**
 * O resultado da loja no mês (dia operacional, virada das 5h, fuso da loja):
 * as rotas AUTO que SAÍRAM, as entregas por rota e o tempo da chamada até o
 * motoboy puxar — a mesma conta do bloco do Acerto de entregadores
 * (lib/relatorios/acerto-de-entregadores.ts). Sem as colunas: sem o bloco.
 */
async function resultadoDoMes(lojaId: string, tz: string | null | undefined) {
  try {
    const hoje = hojeNaLoja(tz);
    const desde = `${hoje.slice(0, 8)}01`;
    const { inicio, fim } = janelaDoPeriodo(desde, hoje, tz);
    const linhas = await prisma.$queryRaw<PedidoDaRotaAutomatica[]>`
      SELECT r."id" AS "rotaId", r."chamadaEm", o."status", o."motoboyPuxadoEm"
      FROM "RouteSchedule" r
      LEFT JOIN "CustomerOrder" o ON o."routeId" = r."id"
      WHERE r."franchiseeId" = ${lojaId} AND r."origem" = 'AUTO'
        AND r."dispatchedAt" >= ${inicio} AND r."dispatchedAt" < ${fim}
    `;
    return { desde, ...rotasAutomaticasDoPeriodo(linhas) };
  } catch (e: any) {
    console.warn("[Rota automática] resultado do mês não lido:", e?.message?.slice(0, 120));
    return null;
  }
}

async function estadoDaLoja(lojaId: string, podeContratar: boolean) {
  const [loja, motoboysAtivos] = await Promise.all([
    prisma.user.findUnique({ where: { id: lojaId }, select: { storeLatLng: true, deliveryConfig: true, storeHours: true, storeTimezone: true } }),
    prisma.motoboy.count({ where: { franchiseeId: lojaId, active: true } }),
  ]);
  const config = lerRoteirizacaoAutomatica(loja?.deliveryConfig);
  const [assinatura, resultado] = await Promise.all([
    estadoDaRotaAutomatica(lojaId, { configAtivo: config.ativo }),
    resultadoDoMes(lojaId, loja?.storeTimezone),
  ]);
  // Sem horário gravado o normalizeStoreHours devolve o padrão (18h–23h todo
  // dia) — por isso o nulo é conferido antes.
  const temHorario = loja?.storeHours != null && normalizeStoreHours(loja.storeHours).some((d) => d.active);
  return {
    // Ligada de verdade: a regra E a assinatura (ou isenta) — o que o cron usa.
    config: { ...config, ativo: config.ativo && assinatura.ativo },
    liberada: true,
    podeContratar,
    cobranca: {
      preco: assinatura.preco,
      diasDeTeste: DIAS_DE_TESTE_DA_ROTA_AUTOMATICA,
      testeAte: assinatura.testeAte,
      jaTestou: assinatura.jaTestou,
      isento: assinatura.isento,
      emTeste: assinatura.emTeste,
      semAceite: assinatura.semAceite,
      desligaEm: assinatura.desligaEm,
      fimDoMes: assinatura.fimDoMes,
      cobradoEsteMes: assinatura.cobradoEsteMes,
    },
    requisitos: { temPino: !!lerPontoDaLoja(loja?.storeLatLng), motoboysAtivos, temHorario },
    resultado,
  };
}

export async function GET() {
  const s = await lojaDaSessao();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!liberadaPara(s.lojaId)) return NextResponse.json({ liberada: false });
  try {
    return NextResponse.json(await estadoDaLoja(s.lojaId, s.podeContratar));
  } catch (e: any) {
    console.error("[Rota automática] GET falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui ler a rota automática agora." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const s = await lojaDaSessao();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { lojaId } = s;
  if (!liberadaPara(lojaId)) {
    return NextResponse.json({ error: "A rota automática ainda não está liberada para esta loja." }, { status: 403 });
  }
  const corpo = await req.json().catch(() => null);
  const bruto = corpo?.roteirizacaoAutomatica ?? corpo;
  // Corpo vazio viraria o padrão (desligado) gravado por cima da regra da loja.
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return NextResponse.json({ error: "Regra inválida." }, { status: 400 });
  }
  const regra = limparRoteirizacaoAutomatica(bruto);
  const continuar = corpo?.continuar === true;

  try {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeLatLng: true, deliveryConfig: true } });
    if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

    if (regra.ativo) {
      if (!lerPontoDaLoja(loja.storeLatLng)) {
        return NextResponse.json(
          { error: "Falta o pino da loja no mapa (Minha Loja › Endereço). Sem ele não dá para saber quem chegou na loja." },
          { status: 409 },
        );
      }
      const motoboysAtivos = await prisma.motoboy.count({ where: { franchiseeId: lojaId, active: true } });
      if (motoboysAtivos === 0) {
        return NextResponse.json(
          { error: "Nenhum motoboy ativo. Cadastre em Motoboys e mande o link do app antes de ligar." },
          { status: 409 },
        );
      }
    }

    // ── A assinatura antes da regra: termo recusado não grava nada ──────────
    const antes = await estadoDaRotaAutomatica(lojaId, { configAtivo: lerRoteirizacaoAutomatica(loja.deliveryConfig).ativo });
    // Ligada pela assinatura depois desta gravação (isenta: sempre).
    let assinaturaLigada = antes.ativo;
    if (!antes.isento) {
      const mexeNaAssinatura = regra.ativo
        ? !antes.ativo || (continuar && (!!antes.desligaEm || antes.semAceite))
        : antes.ativo && !antes.desligaEm;
      if (mexeNaAssinatura) {
        if (!s.podeContratar) {
          return NextResponse.json({ error: "Só o dono da loja liga ou desliga a rota automática (ela entra na fatura do FireHub)." }, { status: 403 });
        }
        // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
        let aceite = null;
        if (regra.ativo && corpo?.aceite?.versao) {
          const session = await getServerSession(authOptions);
          const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
          aceite = { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null };
        }
        assinaturaLigada = (await ligarOuDesligarRotaAutomatica(lojaId, regra.ativo, aceite)).ativo;
      }
    }

    // Desligou depois do teste: o mês já está pago e a rota segue até a virada
    // (os trechos desligam sozinhos) — a regra fica ligada até lá.
    const ativo = regra.ativo || (!antes.isento && assinaturaLigada);

    // Mesclado, nunca substituído (o mesmo de api/store-settings): frete
    // grátis, áreas de risco e o repasse moram no mesmo deliveryConfig.
    // Gravado como texto JSON por algum caminho antigo? Lê antes de mesclar,
    // senão as outras chaves iriam embora.
    let atual: unknown = loja.deliveryConfig;
    if (typeof atual === "string") { try { atual = JSON.parse(atual); } catch { atual = null; } }
    const base = atual && typeof atual === "object" && !Array.isArray(atual) ? (atual as Record<string, unknown>) : {};
    await prisma.user.update({
      where: { id: lojaId },
      data: { deliveryConfig: { ...base, roteirizacaoAutomatica: { ...regra, ativo } } as any },
    });
    // O raio da loja mudou (ou ligou/desligou): o carimbo de chegada vale com o novo já.
    esquecerLojaDoCarimbo(lojaId);
    return NextResponse.json(await estadoDaLoja(lojaId, s.podeContratar));
  } catch (e: any) {
    if (e instanceof TermoNaoAceitoError) return NextResponse.json({ error: e.message, precisaDoTermo: true }, { status: 400 });
    console.error("[Rota automática] PUT falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui salvar a rota automática agora." }, { status: 500 });
  }
}
