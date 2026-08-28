import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";
import { paraEnvioWhatsApp } from "@/lib/telefone";

export const dynamic = "force-dynamic";

/**
 * POST /api/chatbot/codigo-pareamento   { "numero": "22999999999" }
 *
 * O caminho de conectar SEM câmera: em vez de apontar o celular para o QR na
 * tela, o lojista digita um código de 8 caracteres no próprio WhatsApp.
 *
 * Existe porque o QR pressupõe uma cena que muitas vezes não acontece: alguém
 * na frente do computador COM o telefone da loja na mão, dentro dos 60s de
 * validade. Quando o dono está longe da loja — ou quando é o suporte tentando
 * ajudar por telefone — o código resolve, porque dá para ditar por ligação.
 *
 * O número precisa ser o MESMO que vai ser conectado: a Meta emite o código
 * amarrado a ele.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const quemPediu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!quemPediu) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  // Funcionário conecta a loja em que trabalha, nunca uma conta dele.
  const lojaId = quemPediu.ownerId || quemPediu.id;
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storePhone: true },
  });

  const body = await req.json().catch(() => ({}));
  const numero = paraEnvioWhatsApp(body?.numero || loja?.storePhone);
  if (!numero) {
    return NextResponse.json(
      {
        error:
          "Informe o número do WhatsApp da loja com DDD (ex: 22 99999-9999). É o mesmo número que será conectado.",
      },
      { status: 400 },
    );
  }

  const gatewayUrl = (
    process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app"
  ).replace(/\/$/, "");
  const instanceName = `firehub_${lojaId.slice(-10)}`;

  try {
    const res = await fetch(
      `${gatewayUrl}/instance/pairing-code/${instanceName}?number=${numero}`,
      {
        headers: { apikey: segredoObrigatorio("EVOLUTION_API_KEY") },
        signal: AbortSignal.timeout(20000),
      },
    );
    const dados = await res.json().catch(() => ({}));

    if (dados?.jaConectada) {
      return NextResponse.json({ jaConectada: true, phone: dados.phone || "" });
    }
    if (!res.ok || !dados?.pairingCode) {
      // O motivo real vai para o log; para a tela vai uma frase que diz o que
      // fazer. "Erro 500" não ajuda ninguém a conectar o WhatsApp.
      console.warn(`[codigo-pareamento] ${instanceName}: ${res.status} ${JSON.stringify(dados)}`);
      return NextResponse.json(
        {
          error:
            "Não consegui gerar o código agora. Tente o QR Code — ele funciona do mesmo jeito — ou tente o código de novo em um minuto.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ pairingCode: dados.pairingCode, numero });
  } catch (err: any) {
    console.warn(`[codigo-pareamento] Falha ao falar com o gateway:`, err?.message);
    return NextResponse.json(
      { error: "O serviço de conexão não respondeu. Tente o QR Code enquanto isso." },
      { status: 502 },
    );
  }
}
