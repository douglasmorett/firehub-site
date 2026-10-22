/**
 * Rota 100% automatizada — o estado do botão roxo e a gravação da regra.
 *
 *   GET → `RotaAutomaticaEstado` (components/customer/RotaAutomatica.tsx):
 *         regra gravada, liberação, cobrança e os requisitos reais (pino da
 *         loja, motoboys ativos, horário). Loja fora da liberação recebe só
 *         `{ liberada: false }` — e a tela nem desenha o botão.
 *   PUT → grava `deliveryConfig.roteirizacaoAutomatica` (mesclado: as outras
 *         chaves do deliveryConfig ficam). 403 fora da liberação; 409 ao
 *         tentar ligar sem o pino da loja ou sem motoboy ativo (§4.1 do plano).
 *
 * Desde a Fase 1 (22/10/2026), `ativo: true` LIGA: o cron de 20 s
 * (api/cron/roteirizacao-automatica) passa a criar as rotas e pedir
 * prioridade no KDS desta loja. Chamar o motoboy é a Fase 2.
 *
 * Por que uma rota própria e não o PUT /api/store-settings: a regra passa por
 * `limparRoteirizacaoAutomatica` (só chaves conhecidas, limites) e pela trava
 * da liberação e dos requisitos. O store-settings deixa de aceitar a chave.
 *
 * Cobrança: nesta fase só a Hakim Centro (loja do Douglas) vê o módulo, e ela
 * é isenta — `isento: true`. O módulo pago (R$ 97, 7 dias grátis) é a Fase 4,
 * pela mecânica dos módulos pagos (lib/modulo-pago.ts).
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

export const dynamic = "force-dynamic";

const PRECO = 97;
const DIAS_DE_TESTE = 7;

async function lojaDaSessao(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  return lojaDoUsuario(u);
}

async function estadoDaLoja(lojaId: string) {
  const [loja, motoboysAtivos] = await Promise.all([
    prisma.user.findUnique({ where: { id: lojaId }, select: { storeLatLng: true, deliveryConfig: true, storeHours: true } }),
    prisma.motoboy.count({ where: { franchiseeId: lojaId, active: true } }),
  ]);
  // Sem horário gravado o normalizeStoreHours devolve o padrão (18h–23h todo
  // dia) — por isso o nulo é conferido antes.
  const temHorario = loja?.storeHours != null && normalizeStoreHours(loja.storeHours).some((d) => d.active);
  return {
    config: lerRoteirizacaoAutomatica(loja?.deliveryConfig),
    liberada: true,
    cobranca: { preco: PRECO, diasDeTeste: DIAS_DE_TESTE, testeAte: null, jaTestou: false, isento: true },
    requisitos: { temPino: !!lerPontoDaLoja(loja?.storeLatLng), motoboysAtivos, temHorario },
  };
}

export async function GET() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!liberadaPara(lojaId)) return NextResponse.json({ liberada: false });
  try {
    return NextResponse.json(await estadoDaLoja(lojaId));
  } catch (e: any) {
    console.error("[Rota automática] GET falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui ler a rota automática agora." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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

    // Mesclado, nunca substituído (o mesmo de api/store-settings): frete
    // grátis, áreas de risco e o repasse moram no mesmo deliveryConfig.
    // Gravado como texto JSON por algum caminho antigo? Lê antes de mesclar,
    // senão as outras chaves iriam embora.
    let atual: unknown = loja.deliveryConfig;
    if (typeof atual === "string") { try { atual = JSON.parse(atual); } catch { atual = null; } }
    const base = atual && typeof atual === "object" && !Array.isArray(atual) ? (atual as Record<string, unknown>) : {};
    await prisma.user.update({
      where: { id: lojaId },
      data: { deliveryConfig: { ...base, roteirizacaoAutomatica: regra } as any },
    });
    // O raio da loja mudou: o carimbo de chegada vale com o novo já.
    esquecerLojaDoCarimbo(lojaId);
    return NextResponse.json(await estadoDaLoja(lojaId));
  } catch (e: any) {
    console.error("[Rota automática] PUT falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui salvar a rota automática agora." }, { status: 500 });
  }
}
