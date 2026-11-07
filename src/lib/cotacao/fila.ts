/**
 * A FILA DO QUE A LOJA MANDA PELO WHATSAPP DELA (pedido de preços, pedido de
 * compra, resumo ao comprador).
 *
 * Por que fila e não "manda tudo agora": o número é o da LOJA, o mesmo que
 * atende os clientes. Dez mensagens iguais em dez segundos é o padrão que o
 * antispam do WhatsApp procura — e a conta restrita (erro 463) deixa o robô da
 * loja mudo para os clientes. Então cada envio nasce com hora marcada
 * (`enviarApos`, espaçado de ESPACO_ENTRE_ENVIOS_MS), e quem manda é o cron
 * (/api/cron/cotacao) ou o empurrão logo depois do clique, um de cada vez.
 *
 * "Nunca repetir para o mesmo fornecedor na mesma rodada" é trava do banco
 * (índice único rodada × fornecedor × tipo). Cada envio é "pego" com um UPDATE
 * condicional antes de sair: dois servidores, ou o cron e o empurrão juntos,
 * não mandam a mesma mensagem duas vezes.
 */
import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { registerBotReply } from "@/lib/loop-guard";
import { paraEnvioWhatsApp } from "@/lib/telefone";
import { cotacaoEstaLigada } from "./assinatura";

/** Entre duas mensagens da mesma loja. */
export const ESPACO_ENTRE_ENVIOS_MS = 20_000;
/** Envio "pego" e nunca concluído (servidor caiu no meio): não tenta de novo, para não duplicar. */
const PRESO_MS = 10 * 60_000;

export type NovoEnvio = {
  franchiseeId: string;
  rodadaId?: string | null;
  fornecedorId?: string | null;
  pedidoId?: string | null;
  tipo: "PRECOS" | "PEDIDO" | "RESUMO";
  telefone: string;
  texto: string;
  enviarApos: Date;
};

/** Põe na fila; o repetido (mesma rodada, fornecedor e tipo) fica de fora sozinho. */
export async function enfileirar(envios: NovoEnvio[]): Promise<number> {
  if (!envios.length) return 0;
  const r = await prisma.cotacaoEnvio.createMany({
    data: envios.map((e) => ({
      franchiseeId: e.franchiseeId, rodadaId: e.rodadaId ?? null, fornecedorId: e.fornecedorId ?? null, pedidoId: e.pedidoId ?? null,
      tipo: e.tipo, telefone: e.telefone, texto: e.texto, enviarApos: e.enviarApos,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** A próxima hora livre na fila da loja: depois do último envio marcado, com o espaço. */
export async function proximaHoraLivre(franchiseeId: string, agora: Date = new Date()): Promise<Date> {
  const ultimo = await prisma.cotacaoEnvio.findFirst({
    where: { franchiseeId, status: { in: ["FILA", "ENVIANDO"] } },
    orderBy: { enviarApos: "desc" },
    select: { enviarApos: true },
  });
  const depois = ultimo ? ultimo.enviarApos.getTime() + ESPACO_ENTRE_ENVIOS_MS : 0;
  return new Date(Math.max(agora.getTime(), depois));
}

/**
 * Manda pelo WhatsApp da loja. O hash entra ANTES (registerBotReply): o eco
 * volta em milissegundos e, sem ele, o webhook leria a própria mensagem como
 * "o lojista assumiu a conversa".
 */
export async function enviarPelaLoja(franchiseeId: string, telefone: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const numero = paraEnvioWhatsApp(telefone);
  if (!numero) return { ok: false, erro: "telefone inválido" };
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { chatbotConfig: true } });
  const robo = String((loja?.chatbotConfig as any)?.phone || "").replace(/\D/g, "");
  if (robo.length >= 10 && robo.slice(-10) === numero.slice(-10)) return { ok: false, erro: "é o número do próprio robô" };
  const jid = `${numero}@s.whatsapp.net`;
  await registerBotReply(franchiseeId, jid, texto).catch(() => {});
  const ok = await sendEvolutionMessage(franchiseeId, jid, texto).catch(() => false);
  return ok ? { ok: true } : { ok: false, erro: "o WhatsApp da loja não aceitou (desconectado?)" };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda o que está na hora, em ordem, esperando a hora de cada um até o teto.
 * `franchiseeId` restringe à loja (o empurrão depois do clique); sem ele, todas
 * (o cron). Nunca lança.
 */
export async function processarFila(opcoes: { franchiseeId?: string; tetoMs?: number } = {}): Promise<{ enviados: number; falhas: number }> {
  const inicio = Date.now();
  const teto = opcoes.tetoMs ?? 45_000;
  let enviados = 0, falhas = 0;
  const ligada = new Map<string, boolean>();
  try {
    await prisma.cotacaoEnvio.updateMany({
      where: { status: "ENVIANDO", enviarApos: { lt: new Date(Date.now() - PRESO_MS) }, ...(opcoes.franchiseeId ? { franchiseeId: opcoes.franchiseeId } : {}) },
      data: { status: "FALHOU", erro: "interrompido no meio do envio (não repetido para não duplicar)" },
    });
    for (let volta = 0; volta < 200; volta++) {
      const restante = teto - (Date.now() - inicio);
      if (restante <= 0) break;
      const proximo = await prisma.cotacaoEnvio.findFirst({
        where: { status: "FILA", enviarApos: { lte: new Date(Date.now() + restante) }, ...(opcoes.franchiseeId ? { franchiseeId: opcoes.franchiseeId } : {}) },
        orderBy: { enviarApos: "asc" },
      });
      if (!proximo) break;
      const falta = proximo.enviarApos.getTime() - Date.now();
      if (falta > 0) await esperar(falta);
      const pego = await prisma.cotacaoEnvio.updateMany({ where: { id: proximo.id, status: "FILA" }, data: { status: "ENVIANDO" } });
      if (pego.count === 0) continue;

      if (!ligada.has(proximo.franchiseeId)) ligada.set(proximo.franchiseeId, await cotacaoEstaLigada(proximo.franchiseeId));
      if (!ligada.get(proximo.franchiseeId)) {
        await prisma.cotacaoEnvio.update({ where: { id: proximo.id }, data: { status: "CANCELADO", erro: "módulo desligado" } });
        if (proximo.pedidoId) await prisma.pedidoDeCompra.updateMany({ where: { id: proximo.pedidoId, status: "FILA" }, data: { status: "FALHOU" } });
        continue;
      }

      const r = await enviarPelaLoja(proximo.franchiseeId, proximo.telefone, proximo.texto);
      await prisma.cotacaoEnvio.update({
        where: { id: proximo.id },
        data: r.ok ? { status: "ENVIADO", enviadoEm: new Date(), erro: null } : { status: "FALHOU", erro: r.erro || "falhou" },
      });
      if (proximo.pedidoId) {
        await prisma.pedidoDeCompra.updateMany({
          where: { id: proximo.pedidoId, status: "FILA" },
          data: r.ok ? { status: "ENVIADO", enviadoEm: new Date() } : { status: "FALHOU" },
        });
      }
      if (r.ok) enviados++; else falhas++;
    }
  } catch (err: any) {
    console.error("[Cotação] Fila falhou:", err?.message);
  }
  return { enviados, falhas };
}
