import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ler99Food } from "@/lib/webhook-99food-log";

export const dynamic = "force-dynamic";

// GET: Retorna as credenciais salvas do 99Food para o usuário logado
export async function GET(req: NextRequest) {
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
        food99MerchantId: true,
        food99AppId: true,
        food99SecretKey: true,
        food99Connected: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    // ── ?diagnostico=pedido — o pedido CRU, como o 99Food manda ───────────
    //
    // O registro de eventos abaixo guarda o que chega pelo WEBHOOK, que é só o
    // aviso; o pedido inteiro vem de uma segunda chamada (`order/detail`), e é
    // lá que moram campos que o contrato deles não declara — o código de
    // coleta, por exemplo. Só que essa chamada precisa das credenciais do app,
    // que existem no servidor e em nenhum outro lugar.
    //
    // Daí este diagnóstico: o lojista logado pede, o servidor busca e devolve o
    // que o 99Food respondeu sobre um pedido DELE. Sem isso, descobrir o nome
    // de um campo exige esperar o próximo pedido real e ler log de container.
    if (req.nextUrl.searchParams.get("diagnostico") === "pedido") {
      const { diagnosticoDePedido99 } = await import("@/lib/food99-diagnostico");
      const qual = req.nextUrl.searchParams.get("pedido") || undefined;
      return NextResponse.json(await diagnosticoDePedido99(user.id, qual));
    }

    return NextResponse.json({
      ok: true,
      merchantId: user.food99MerchantId || "",
      appId: user.food99AppId || "",
      // O segredo NÃO volta em texto puro. Ele autentica a loja no 99Food:
      // devolvê-lo colocava a credencial no navegador, ao alcance de qualquer
      // XSS ou extensão instalada na máquina do lojista. A tela só precisa
      // saber se existe — e os 4 últimos caracteres para ele reconhecer qual é.
      temSecretKey: Boolean(user.food99SecretKey),
      secretKeyMascarada: user.food99SecretKey
        ? `••••••••${String(user.food99SecretKey).slice(-4)}`
        : "",
      connected: !!user.food99Connected,
      webhookUrl: "https://firehubfood.com.br/api/99food/webhook",
      userEmail: user.email,

      // `connected` acima significa apenas "alguém preencheu o formulário": nada
      // neste sistema fala com o 99Food para confirmar. Enquanto a integração
      // de saída não existir, o que diz a verdade sobre a integração é isto —
      // o que o 99Food efetivamente mandou para cá.
      //
      // Vazio depois de um pedido de teste = o 99Food não está chamando o
      // webhook, e o problema está na configuração do Callback address no
      // portal deles, não aqui dentro.
      ultimosEventos99Food: ler99Food(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Salva e ativa as credenciais do 99Food para o usuário logado
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const { merchantId, appId, secretKey, connected } = body;

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const targetUserId = user.ownerId || user.id;

    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: {
        food99MerchantId: merchantId ? merchantId.trim() : null,
        food99AppId: appId ? appId.trim() : null,
        // Campo vazio MANTÉM o segredo salvo. Como o GET passou a devolvê-lo
        // mascarado, um "salvar" sem redigitar mandaria vazio e apagaria a
        // credencial — derrubando a integração da loja sem ninguém pedir.
        ...(secretKey && String(secretKey).trim()
          ? { food99SecretKey: String(secretKey).trim() }
          : {}),
        food99Connected: connected !== undefined ? connected : true,
      },
      select: {
        id: true,
        email: true,
        food99MerchantId: true,
        food99AppId: true,
        food99Connected: true,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Integração 99Food salva e ativada com sucesso!",
      user: updatedUser,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
