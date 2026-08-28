import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";
import { verifyCronAuth } from "@/lib/cron-auth";
import { paraEnvioWhatsApp } from "@/lib/telefone";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/whatsapp-aprender-contatos
 *
 * Ensina ao gateway o LID de cada cliente da loja.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * O WhatsApp está trocando o endereço dos contatos: em vez do JID de telefone,
 * usa um id interno (LID). Mensagem cifrada para `@lid` chega no aparelho e NÃO
 * decifra — é o "Aguardando mensagem" que apareceu nas conversas do dono, dos
 * motoboys e de parte dos clientes.
 *
 * O gateway resolve LID→telefone antes de enviar, mas só sabe o caminho de
 * volta dos contatos que já viu. Sem este job, o mapa só se enche quando o robô
 * manda alguma coisa — ou seja, a PRIMEIRA resposta a um cliente sai errada. E
 * primeira mensagem é exatamente quando a pessoa está decidindo se pede.
 *
 * O mapa do gateway vive em memória e zera quando ele reinicia; por isso este
 * job repete de hora em hora em vez de rodar uma vez só.
 */
const DIAS_DE_CLIENTE_ATIVO = 60;
const TETO_DE_NUMEROS_POR_LOJA = 800;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gatewayUrl = (
    process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app"
  ).replace(/\/$/, "");
  const apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  const desde = new Date(Date.now() - DIAS_DE_CLIENTE_ATIVO * 24 * 60 * 60 * 1000);
  const porLoja: Record<string, unknown> = {};

  try {
    const lojas = await prisma.user.findMany({
      where: { NOT: { chatbotConfig: { equals: undefined } } },
      select: { id: true, chatbotConfig: true },
    });

    for (const loja of lojas) {
      const cfg = (loja.chatbotConfig as any) || {};
      // Loja fora do ar não tem socket para consultar — o gateway recusaria.
      if (cfg.connected !== true) continue;

      const pedidos = await prisma.customerOrder.findMany({
        where: { franchiseeId: loja.id, createdAt: { gte: desde } },
        select: { customerPhone: true },
        distinct: ["customerPhone"],
        take: TETO_DE_NUMEROS_POR_LOJA,
        orderBy: { createdAt: "desc" },
      });

      const numeros = [
        ...new Set(pedidos.map((p) => paraEnvioWhatsApp(p.customerPhone)).filter(Boolean)),
      ];
      if (numeros.length === 0) continue;

      const instanceName = `firehub_${loja.id.slice(-10)}`;
      try {
        const res = await fetch(`${gatewayUrl}/instance/aprender-contatos/${instanceName}`, {
          method: "POST",
          headers: { apikey: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ numeros }),
          signal: AbortSignal.timeout(120000),
        });
        porLoja[instanceName] = res.ok ? await res.json() : `status_${res.status}`;
      } catch (err: any) {
        porLoja[instanceName] = `falhou: ${err.message}`;
      }
    }
  } catch (err: any) {
    return NextResponse.json({ status: "erro", erro: err.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", lojas: porLoja });
}
