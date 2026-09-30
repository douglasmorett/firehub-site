import { prisma } from "@/lib/prisma";
import { estadoAoVivoDoRobo } from "@/lib/whatsapp-estado";
import { atividadeDasLojas, textoDoUltimoPedido } from "@/lib/atividade-da-loja";

/**
 * O RAIO-X DA LOJA PARA O SUPORTE — o que o robô do FireHub lê antes de
 * responder "minha impressora parou" e o que a ficha do contato mostra ao
 * admin e ao vendedor.
 *
 * Só leitura, e só o que ajuda a diagnosticar: nada de token, senha, chave
 * Pix ou faturamento em reais (o robô conversa com quem escreveu do número da
 * loja, e número de loja às vezes fica no celular do caixa).
 */
export type EstadoDaLojaParaSuporte = {
  loja: string;
  cardapio: string | null;
  lojaAberta: boolean;
  teste: { emTeste: boolean; diasRestantes: number | null; terminaEm: string | null };
  robo: { conectado: boolean | null; ligado: boolean; telefone: string | null };
  impressao: {
    ultimaConsulta: string | null;
    minutosSemConsultar: number | null;
    versao: string | null;
    pendentes: number | null;
    erro: string | null;
  };
  canais: { ifood: boolean; food99: boolean; jotaja: boolean; brendi: boolean };
  ultimoPedido: string;
  pedidosNaSemana: number;
  faturaEmAberto: { valor: number; vencimento: string | null; link: string | null } | null;
};

export async function estadoDaLojaParaSuporte(userId: string, opcoes: { aoVivo?: boolean } = {}): Promise<EstadoDaLojaParaSuporte | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, storeName: true, slug: true, storeOpen: true, trialEndsAt: true, createdAt: true,
      chatbotConfig: true, printQueuePolledAt: true, printQueueEstado: true, isFranqueadoHakim: true,
      food99Connected: true, jotajaConnected: true,
    },
  });
  if (!u) return null;

  const config = (u.chatbotConfig as any) || {};
  const [robo, ifood, atividade, fatura, brendi] = await Promise.all([
    opcoes.aoVivo ? estadoAoVivoDoRobo(u.id, config).catch(() => ({ conectada: null, telefone: null })) : Promise.resolve(null),
    prisma.ifoodIntegration.count({ where: { userId: u.id, connected: true, active: true } }).catch(() => 0),
    atividadeDasLojas([u.id]).catch(() => new Map()),
    u.isFranqueadoHakim
      ? Promise.resolve(null)
      : prisma.franchiseeBillingCycle.findFirst({
          where: { franchiseeId: u.id, status: "CLOSED", amountPending: { gt: 0 } },
          orderBy: { closedAt: "desc" },
          select: { amountPending: true, dueDate: true, asaasBoletoUrl: true },
        }).catch(() => null),
    prisma.$queryRaw<{ c: boolean | null }[]>`SELECT "brendiConnected" AS c FROM "User" WHERE id = ${u.id}`.then((r) => r[0]?.c === true).catch(() => false),
  ]);

  const fimDoTeste = u.trialEndsAt ? u.trialEndsAt.getTime() : u.createdAt.getTime() + 15 * 86_400_000;
  const emTeste = fimDoTeste > Date.now();
  const estadoImpressao = (u.printQueueEstado as any) || {};
  const a = atividade.get(u.id);

  return {
    loja: u.storeName || u.name,
    cardapio: u.slug ? `https://firehubfood.com.br/loja/${u.slug}` : null,
    lojaAberta: u.storeOpen,
    teste: {
      emTeste,
      diasRestantes: emTeste ? Math.ceil((fimDoTeste - Date.now()) / 86_400_000) : null,
      terminaEm: new Date(fimDoTeste).toISOString().slice(0, 10),
    },
    robo: {
      conectado: robo ? robo.conectada : typeof config.connected === "boolean" ? config.connected : null,
      ligado: config.active !== false,
      telefone: robo?.telefone || null,
    },
    impressao: {
      ultimaConsulta: u.printQueuePolledAt ? u.printQueuePolledAt.toISOString() : null,
      minutosSemConsultar: u.printQueuePolledAt ? Math.round((Date.now() - u.printQueuePolledAt.getTime()) / 60_000) : null,
      versao: typeof estadoImpressao.versao === "string" ? estadoImpressao.versao : null,
      pendentes: typeof estadoImpressao.pendentes === "number" ? estadoImpressao.pendentes : null,
      erro: typeof estadoImpressao.erro === "string" ? estadoImpressao.erro.slice(0, 200) : null,
    },
    canais: { ifood: ifood > 0, food99: u.food99Connected, jotaja: u.jotajaConnected, brendi },
    ultimoPedido: textoDoUltimoPedido(a),
    pedidosNaSemana: a?.pedidos7d || 0,
    faturaEmAberto: fatura
      ? { valor: Math.round(fatura.amountPending * 100) / 100, vencimento: fatura.dueDate ? fatura.dueDate.toISOString().slice(0, 10) : null, link: fatura.asaasBoletoUrl || null }
      : null,
  };
}
