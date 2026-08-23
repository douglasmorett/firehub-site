import { segredoObrigatorio } from "./segredos";
/**
 * src/lib/server-monitor.ts
 * Sistema de monitoramento interno com alertas via WhatsApp.
 * 
 * Envia alertas para os administradores quando:
 * - O banco de dados fica inacessível
 * - A memória ultrapassa o limite
 * - O servidor reinicia (notificação de boot)
 * 
 * Usa a Evolution API (WhatsApp Gateway) que roda em servidor separado (Railway),
 * garantindo que os alertas funcionam mesmo se o servidor principal tiver problemas.
 */

// Números dos administradores para alertas (com código do país)
const ALERT_PHONES = [
  "5522998851680", // Douglas
  "5521972947120", // Victor
];

// Cooldown de 5 minutos entre alertas do mesmo tipo para evitar spam
const alertCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

function canAlert(alertType: string): boolean {
  const last = alertCooldowns.get(alertType) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  alertCooldowns.set(alertType, Date.now());
  return true;
}

async function sendWhatsAppAlert(message: string) {
  const gatewayUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  const apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  // Buscar primeira instância ativa do banco para enviar o alerta
  let instanceName = "firehub_admin";
  try {
    const { prisma } = await import("@/lib/prisma");
    const admin = await prisma.user.findFirst({
      where: { email: "contatohakim@gmail.com" },
      select: { id: true },
    });
    if (admin) {
      instanceName = `firehub_${admin.id.slice(-10)}`;
    }
  } catch {
    // Se não conseguir acessar o banco, usa instância padrão
  }

  for (const phone of ALERT_PHONES) {
    try {
      await fetch(`${gatewayUrl}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: {
          "apikey": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          number: phone,
          text: message,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err: any) {
      console.error(`[Monitor] Falha ao enviar alerta para ${phone}:`, err.message);
    }
  }
}

/**
 * Verifica a saúde do servidor e envia alertas se necessário.
 * Chamado pelo cron-runner a cada 5 minutos.
 */
export async function runHealthCheck(): Promise<{
  status: "healthy" | "degraded" | "critical";
  issues: string[];
}> {
  const issues: string[] = [];

  // 1. Verificar banco de dados
  try {
    const { prisma } = await import("@/lib/prisma");
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbMs = Date.now() - start;
    if (dbMs > 5000) {
      issues.push(`⚠️ Banco de dados lento: ${dbMs}ms`);
    }
  } catch (err: any) {
    issues.push(`🔴 Banco de dados INACESSÍVEL: ${err.message?.substring(0, 80)}`);
  }

  // 2. Verificar memória
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (heapMB > 450) {
    issues.push(`⚠️ Memória alta: ${heapMB}MB`);
  }

  // 3. Determinar status e alertar se necessário
  const hasCritical = issues.some((i) => i.includes("🔴"));
  const status = hasCritical ? "critical" : issues.length > 0 ? "degraded" : "healthy";

  if (issues.length > 0 && canAlert("health")) {
    const msg = [
      `🚨 *ALERTA FIREHUB*`,
      `Status: ${status.toUpperCase()}`,
      `Hora: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      ``,
      ...issues,
      ``,
      `🔗 https://firehubfood.com.br`,
    ].join("\n");

    await sendWhatsAppAlert(msg);
    console.log(`[Monitor] 🚨 Alerta enviado: ${issues.join("; ")}`);
  }

  return { status, issues };
}

/**
 * Envia notificação de que o servidor reiniciou com sucesso.
 * Chamado uma vez após o boot do servidor.
 */
let bootNotified = false;
export async function notifyServerBoot() {
  if (bootNotified) return;
  bootNotified = true;

  // Aguardar 30s para o servidor estabilizar antes de notificar
  await new Promise((r) => setTimeout(r, 30000));

  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);

  const msg = [
    `✅ *FIREHUB ONLINE*`,
    `Servidor reiniciou com sucesso!`,
    `Hora: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `Memória: ${heapMB}MB`,
    ``,
    `🔗 https://firehubfood.com.br`,
  ].join("\n");

  await sendWhatsAppAlert(msg);
  console.log("[Monitor] ✅ Notificação de boot enviada");
}
