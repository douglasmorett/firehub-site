import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { darBaixaNaFila, filaDaCredencial } from "@/lib/jotaja-api";
import { conferirFilaNaLigacao } from "@/lib/jotaja-loja";

export const dynamic = "force-dynamic";

// GET: Retorna as credenciais salvas do JotaJá para o usuário logado
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        email: true,
        jotajaClientId: true,
        jotajaClientSecret: true,
        jotajaMerchantId: true,
        jotajaConnected: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // ⚠️ NÃO devolver credencial embutida no código.
    // Antes, para qualquer e-mail contendo "hakim", esta rota devolvia
    // client_id/secret/merchant fixos e `connected: true` mesmo com o banco
    // vazio. O painel mostrava "🟢 Conectado & Ativo" independentemente do
    // estado real, então uma integração desligada no banco (que o cron ignora)
    // parecia saudável na tela — e o segredo ia junto para o browser.
    // Agora o painel reflete o banco, e o secret nunca é devolvido.
    return NextResponse.json({
      ok: true,
      clientId: user.jotajaClientId || "",
      clientSecret: "", // nunca volta para o cliente; vazio no POST = "manter o atual"
      hasSecret: !!user.jotajaClientSecret,
      merchantId: user.jotajaMerchantId || "",
      connected: !!user.jotajaConnected,
      configurada: !!(user.jotajaClientId && user.jotajaClientSecret),
      userEmail: user.email
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Salva e ativa as credenciais do JotaJá para o usuário logado
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { clientId, clientSecret, merchantId, connected } = body;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true }
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetUserId = user.ownerId || user.id;

    // ⚠️ Campo vazio NUNCA apaga credencial.
    // O formulário chegava em branco (o GET não devolve mais o secret) e o POST
    // gravava `null` nos três campos com jotajaConnected: true. O cron exige
    // clientId E secret não-nulos, então a loja saía da lista de polling para
    // sempre — com o painel continuando verde. Vazio agora significa "mantém".
    const atual = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { jotajaClientId: true, jotajaClientSecret: true, jotajaMerchantId: true, jotajaConnected: true },
    });

    const novoClientId = clientId?.trim() || atual?.jotajaClientId || null;
    const novoSecret = clientSecret?.trim() || atual?.jotajaClientSecret || null;
    const novoMerchant = merchantId?.trim() || atual?.jotajaMerchantId || null;

    if (!novoClientId || !novoSecret) {
      return NextResponse.json(
        { error: "Informe o Client ID e o Client Secret do JotaJá — sem os dois a loja não entra no polling de pedidos." },
        { status: 400 }
      );
    }

    // Só liga se a credencial autenticar E for desta loja. A fila do JotaJá
    // (que a leitura já autentica) diz de que restaurante ela é: credencial de
    // outro restaurante, de vários, ou de restaurante que já está em outra loja
    // do FireHub não liga. Integração é POR LOJA (lib/jotaja-loja.ts).
    const vaiLigar = connected !== false;
    let autenticou = false;
    let erro = "";
    let merchant = novoMerchant;
    let foraDaLargada = 0;
    try {
      const fila = await filaDaCredencial(novoClientId, novoSecret);
      autenticou = true;
      const conferida = conferirFilaNaLigacao(fila, novoMerchant);
      if (conferida.erro) {
        erro = conferida.erro;
      } else {
        merchant = conferida.merchant;
        const outra = merchant
          ? await prisma.user.findFirst({
              where: {
                jotajaMerchantId: merchant,
                id: { not: targetUserId },
                ownerId: null,
                NOT: { email: { startsWith: "deleted_" } },
              },
              select: { storeName: true, email: true },
            })
          : null;
        if (outra) {
          erro = `o restaurante ${merchant} do JotaJá já está ligado em outra loja do FireHub (${outra.storeName || outra.email})`;
        } else if (vaiLigar && (!atual?.jotajaConnected || novoClientId !== atual?.jotajaClientId) && fila.length > 0) {
          // Largada limpa: ligando agora (ou trocando de credencial), o que
          // está na fila é de ANTES — pedido que a loja já atendeu por outro
          // caminho. Sem a baixa, a semana inteira caía no painel e na impressora.
          foraDaLargada = await darBaixaNaFila(novoClientId, novoSecret, fila);
        }
      }
    } catch (e: any) {
      erro = e?.message || "não foi possível falar com o JotaJá";
    }

    const ligada = vaiLigar && autenticou && !erro;
    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        jotajaClientId: novoClientId,
        jotajaClientSecret: novoSecret,
        jotajaMerchantId: merchant,
        jotajaConnected: ligada,
      },
      select: {
        id: true,
        email: true,
        jotajaClientId: true,
        jotajaMerchantId: true,
        jotajaConnected: true
      }
    });

    return NextResponse.json({
      ok: true,
      message: !vaiLigar
        ? "Integração JotaJá desligada — nenhum pedido do JotaJá entra até ligar de novo."
        : ligada
          ? `Integração JotaJá ligada — credencial aceita${merchant ? ` (restaurante ${merchant} no JotaJá)` : ""}.` +
            (foraDaLargada > 0 ? ` ${foraDaLargada} pedido(s) que estavam parados na fila do JotaJá, de antes de ligar, ficaram de fora; os novos entram a partir de agora.` : "")
          : `Credenciais salvas, mas a integração ficou DESLIGADA: ${erro}. Confira Client ID e Secret no painel do JotaJá.`,
      autenticou,
      foraDaLargada,
      user: updatedUser
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
