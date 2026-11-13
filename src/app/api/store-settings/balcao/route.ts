import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerBalcaoConfig, BALCAO_CONFIG_PADRAO } from "@/lib/balcao-config";
import { bairrosAtendidos, modoDaArea } from "@/lib/area-de-entrega";
import { MENSAGEM_FECHE_O_CAIXA_PARA_TROCAR } from "@/lib/caixa-por-usuario-regras";

/**
 * As regras do lançamento presencial da loja (lib/balcao-config.ts).
 *
 * Sempre pelo DONO da loja (`ownerId || id`): funcionário logado configura e
 * lê a mesma coisa que o dono, como em toda tela de Minha Loja. Se cada
 * funcionário tivesse a sua, o atendente ligaria o pager obrigatório e o
 * colega ao lado continuaria lançando sem.
 */

async function donoDaLoja(email: string) {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!u) return null;
  return u.ownerId || u.id;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const targetId = await donoDaLoja(session.user.email);
  if (!targetId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Os bairros que a loja entrega, para o Delivery do balcão escolher numa
  // lista. Só na loja que entrega POR BAIRRO: lá é o bairro que decide a
  // taxa, e o atendente digitava "Rua X, 35" sem bairro e via "bairro não
  // atendido" sem saber quais existem. Em raio ou área desenhada quem decide
  // é o mapa, e uma lista de nomes só confundiria.
  const bairros = await prisma.user
    .findUnique({ where: { id: targetId }, select: { deliveryZones: true, deliveryZoneType: true } })
    .then((loja) => (loja && modoDaArea(loja as any) === "BAIRRO" ? bairrosAtendidos(loja as any).map((b) => ({ name: b.name, fee: b.fee })) : []))
    .catch(() => []);

  // O caixa por usuário só o dono troca (ver o POST): a tela mostra a chave
  // travada para o funcionário em vez de deixar ele clicar e ouvir "não".
  const souDono = await prisma.user
    .findUnique({ where: { email: session.user.email }, select: { ownerId: true } })
    .then((u) => !u?.ownerId)
    .catch(() => false);

  try {
    const dono = await prisma.user.findUnique({ where: { id: targetId }, select: { balcaoConfig: true } });
    return NextResponse.json({ ...lerBalcaoConfig((dono as any)?.balcaoConfig), bairros, souDono });
  } catch (err) {
    // Coluna ainda ausente (o boot não rodou o ADD COLUMN): a tela abre no
    // padrão em vez de dar erro. Nada obrigatório é exatamente o que vale
    // enquanto não há o que gravar.
    console.error("[Balcão] leitura da config:", (err as any)?.code || err);
    return NextResponse.json({ ...BALCAO_CONFIG_PADRAO, bairros, souDono });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const targetId = await donoDaLoja(session.user.email);
  if (!targetId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Passa pelo mesmo leitor da tela e do PDV: o que entra no banco é sempre
  // o objeto com as duas chaves booleanas, nunca o corpo cru do navegador.
  const corpo = await req.json().catch(() => null);
  const config = lerBalcaoConfig(corpo);

  // ── CAIXA POR USUÁRIO (lib/caixa-por-usuario-regras.ts) ────────────────
  //
  // Diferente do pager, esta chave é só do DONO: ela muda de quem é o
  // dinheiro de cada gaveta, e o funcionário que a desligasse juntaria o caixa
  // dele com o do colega. A tela velha (sem F5) e o funcionário mandam o que
  // já estava gravado — nunca desligam sem querer.
  //
  // E só troca com TODOS os caixas fechados: um caixa compartilhado aberto
  // conta toda venda pelo horário, e um caixa por usuário aberto ao lado dele
  // contaria as mesmas vendas de novo.
  try {
    const eu = await prisma.user.findUnique({ where: { email: session.user.email }, select: { ownerId: true } });
    const atual = lerBalcaoConfig(((await prisma.user.findUnique({ where: { id: targetId }, select: { balcaoConfig: true } as any })) as any)?.balcaoConfig);
    const pediu = corpo && typeof corpo === "object" && "caixaPorUsuario" in corpo;
    if (!pediu || eu?.ownerId) {
      if (pediu && config.caixaPorUsuario !== atual.caixaPorUsuario) {
        return NextResponse.json({ error: "Só o login do dono da loja liga ou desliga o caixa por usuário." }, { status: 403 });
      }
      config.caixaPorUsuario = atual.caixaPorUsuario;
    } else if (config.caixaPorUsuario !== atual.caixaPorUsuario) {
      const abertos = await prisma.cashSession.count({ where: { franchiseeId: targetId, status: "OPEN" } });
      if (abertos > 0) return NextResponse.json({ error: MENSAGEM_FECHE_O_CAIXA_PARA_TROCAR, ...atual }, { status: 409 });
    }
  } catch (err) {
    console.error("[Balcão] conferência do caixa por usuário:", (err as any)?.code || err);
    return NextResponse.json({ error: "Não consegui salvar agora. Tente de novo em um minuto." }, { status: 500 });
  }

  try {
    await prisma.user.update({ where: { id: targetId }, data: { balcaoConfig: config } as any });
  } catch (err) {
    console.error("[Balcão] gravação da config:", (err as any)?.code || err);
    return NextResponse.json(
      { error: "Não consegui salvar agora. Se acabou de sair uma atualização, tente de novo em um minuto." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, ...config });
}
