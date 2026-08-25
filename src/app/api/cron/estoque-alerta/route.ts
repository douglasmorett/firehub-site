/**
 * GET /api/cron/estoque-alerta
 *
 * Alerta de reposição: avisa a loja, pelo mesmo WhatsApp que já manda os
 * alertas de abertura e fechamento de caixa, quando um insumo chega no mínimo
 * cadastrado ou fica com saldo negativo.
 *
 * Até aqui o mínimo do insumo só pintava um card na tela de Estoque. Quem não
 * abre essa tela — que é a regra num sábado à noite — descobria a falta com o
 * pedido já na cozinha. A tela continua sendo a fonte da verdade; este cron é
 * só o empurrão.
 *
 * Roda de hora em hora, mas cada insumo gera no máximo um aviso por dia (veja
 * INTERVALO_ENTRE_AVISOS_MS) e só dentro do horário comercial da loja: alerta
 * de reposição às 4h da manhã não faz ninguém repor nada, só ensina o lojista
 * a silenciar o número.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export const dynamic = "force-dynamic";

/**
 * Um aviso por insumo a cada 24h. O cron roda de hora em hora para pegar o
 * insumo que acabou de cair, mas o insumo continua abaixo do mínimo até alguém
 * receber a mercadoria — sem esta trava seriam 14 mensagens idênticas por dia
 * e o lojista bloquearia o número.
 */
const INTERVALO_ENTRE_AVISOS_MS = 24 * 60 * 60 * 1000;

/** Janela em que o aviso pode sair, na hora local da loja: 08:00 às 21:59. */
const HORA_INICIO = 8;
const HORA_FIM = 21;

/** No máximo isso de insumo listado na mensagem; o resto vira "+ N insumo(s)". */
const MAX_ITENS_NA_MENSAGEM = 15;

/** Onde o carimbo do último aviso mora dentro de `User.chatbotConfig`. */
const CHAVE_AVISOS = "stockAlerts";

type InsumoBaixo = {
  id: string;
  franchiseeId: string;
  name: string;
  quantity: number;
  unit: string;
  minQuantity: number | null;
};

/**
 * Hora do relógio da loja, não do servidor: o container roda em UTC, e usar
 * `new Date().getHours()` mandaria o aviso "das 8h" às 5h da manhã de Brasília.
 */
function horaLocalDaLoja(fuso: string | null | undefined): number {
  const lerHora = (zona: string) => {
    const partes = new Intl.DateTimeFormat("en-US", {
      timeZone: zona,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    return Number(partes.find((p) => p.type === "hour")?.value ?? "");
  };

  try {
    const hora = lerHora(fuso || "America/Sao_Paulo");
    if (Number.isFinite(hora)) return hora;
  } catch {
    // Fuso inválido no cadastro (já apareceu vazio e com nome digitado à mão)
    // cai no padrão de Brasília em vez de derrubar o cron inteiro.
  }
  return lerHora("America/Sao_Paulo");
}

function formatarQuantidade(valor: number, unidade: string): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unidade}`;
}

function montarMensagem(nomeDaLoja: string, insumos: InsumoBaixo[]): string {
  const mostrados = insumos.slice(0, MAX_ITENS_NA_MENSAGEM);
  const restantes = insumos.length - mostrados.length;

  const linhas = mostrados.map((insumo) => {
    const minimo =
      insumo.minQuantity !== null
        ? ` _(mínimo ${formatarQuantidade(insumo.minQuantity, insumo.unit)})_`
        : "";

    // Negativo não é "acabando", é buraco no saldo: a ficha técnica baixou
    // insumo que o sistema não tinha. Merece destaque próprio na mensagem.
    if (insumo.quantity < 0) {
      return `🔴 *${insumo.name}* — saldo negativo: ${formatarQuantidade(insumo.quantity, insumo.unit)}${minimo}`;
    }
    return `🟡 *${insumo.name}* — restam ${formatarQuantidade(insumo.quantity, insumo.unit)}${minimo}`;
  });

  const extra = restantes > 0 ? `\n\n_+ ${restantes} insumo(s) na tela de Estoque._` : "";

  return (
    `📦 *Hora de repor o estoque*\n\n` +
    `Olá chefe! Estes insumos de *${nomeDaLoja}* chegaram no limite que você cadastrou:\n\n` +
    `${linhas.join("\n")}${extra}\n\n` +
    `_Ass: Seu Assistente FireHub 🔥_`
  );
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = Date.now();
  const resumo = {
    insumosBaixos: 0,
    lojasComInsumoBaixo: 0,
    lojasAvisadas: 0,
    foraDoHorario: 0,
    semTelefone: 0,
    falhasNoEnvio: 0,
  };

  try {
    // A comparação é entre duas colunas da mesma linha (quantity <= minQuantity),
    // daí o field reference do Prisma: puxar o estoque inteiro de todas as lojas
    // para filtrar em memória seria carregar milhares de linhas de hora em hora.
    //
    // O `gt: 0` no mínimo é de propósito. Insumo sem mínimo (null) ou com mínimo
    // zero não tem limite definido — esse só entra aqui se ficar negativo, que é
    // furo de saldo e vale aviso mesmo sem ninguém ter configurado nada.
    const insumos = (await prisma.stockItem.findMany({
      where: {
        OR: [
          { quantity: { lt: 0 } },
          {
            minQuantity: { gt: 0 },
            quantity: { lte: prisma.stockItem.fields.minQuantity },
          },
        ],
      },
      select: {
        id: true,
        franchiseeId: true,
        name: true,
        quantity: true,
        unit: true,
        minQuantity: true,
      },
    })) as InsumoBaixo[];

    resumo.insumosBaixos = insumos.length;

    if (insumos.length === 0) {
      return NextResponse.json({ ...resumo, timestamp: new Date().toISOString() });
    }

    const porLoja = new Map<string, InsumoBaixo[]>();
    for (const insumo of insumos) {
      const lista = porLoja.get(insumo.franchiseeId);
      if (lista) lista.push(insumo);
      else porLoja.set(insumo.franchiseeId, [insumo]);
    }
    resumo.lojasComInsumoBaixo = porLoja.size;

    const lojas = await prisma.user.findMany({
      where: { id: { in: Array.from(porLoja.keys()) } },
      select: {
        id: true,
        storeName: true,
        notificationPhone: true,
        storeTimezone: true,
        chatbotConfig: true,
      },
    });

    for (const loja of lojas) {
      const daLoja = porLoja.get(loja.id) || [];
      if (daLoja.length === 0) continue;

      // Mesmo destino dos alertas de caixa. Loja que nunca preencheu o telefone
      // de notificação não tem para onde receber — fica só no log.
      if (!loja.notificationPhone) {
        resumo.semTelefone++;
        continue;
      }

      const hora = horaLocalDaLoja(loja.storeTimezone);
      if (hora < HORA_INICIO || hora > HORA_FIM) {
        resumo.foraDoHorario++;
        continue;
      }

      // O carimbo do último aviso vive no `chatbotConfig` porque é o único Json
      // por loja que já guarda estado de notificação (o histórico das campanhas
      // de marketing mora lá também) e o schema não pode ganhar coluna agora. Se
      // esse campo vier em outro formato, é melhor a loja ficar sem aviso do que
      // ter a configuração do robô dela sobrescrita.
      const bruto = loja.chatbotConfig;
      if (bruto !== null && bruto !== undefined && (typeof bruto !== "object" || Array.isArray(bruto))) {
        console.warn(
          `[EstoqueAlerta] chatbotConfig da loja ${loja.id} não é objeto — sem onde guardar o controle de aviso, loja pulada`
        );
        continue;
      }
      const config: Record<string, any> = bruto ? { ...(bruto as Record<string, any>) } : {};
      const avisoAnterior: Record<string, string> =
        config[CHAVE_AVISOS] &&
        typeof config[CHAVE_AVISOS] === "object" &&
        !Array.isArray(config[CHAVE_AVISOS])
          ? config[CHAVE_AVISOS]
          : {};

      const devidos = daLoja.filter((insumo) => {
        const ultimo = Date.parse(avisoAnterior[insumo.id] ?? "");
        // Carimbo ausente ou ilegível conta como "nunca avisado".
        if (Number.isNaN(ultimo)) return true;
        return agora - ultimo >= INTERVALO_ENTRE_AVISOS_MS;
      });

      if (devidos.length === 0) continue;

      // Pior primeiro: negativo antes de baixo e, dentro de cada grupo, quem
      // está mais longe do mínimo. É o que sobrevive ao corte da mensagem.
      devidos.sort((a, b) => {
        const aNegativo = a.quantity < 0;
        const bNegativo = b.quantity < 0;
        if (aNegativo !== bNegativo) return aNegativo ? -1 : 1;
        return (b.minQuantity ?? 0) - b.quantity - ((a.minQuantity ?? 0) - a.quantity);
      });

      const mensagem = montarMensagem(loja.storeName || "sua loja", devidos);
      const enviado = await sendEvolutionMessage(loja.id, loja.notificationPhone, mensagem);

      // Só carimba o que realmente saiu. Gateway fora do ar marcando os insumos
      // como avisados esconderia a falta pelas 24h seguintes.
      if (!enviado) {
        resumo.falhasNoEnvio++;
        console.warn(
          `[EstoqueAlerta] Não consegui enviar o aviso da loja ${loja.id} (${devidos.length} insumo(s))`
        );
        continue;
      }

      const carimbo = new Date(agora).toISOString();
      const idsAvisadosAgora = new Set(devidos.map((d) => d.id));
      // O mapa é reconstruído a partir de quem está baixo agora: insumo reposto
      // ou apagado sai dele em vez de inchar o Json para sempre — e, se cair de
      // novo mais tarde, vale como aviso novo.
      const novosAvisos: Record<string, string> = {};
      for (const insumo of daLoja) {
        if (idsAvisadosAgora.has(insumo.id)) novosAvisos[insumo.id] = carimbo;
        else if (avisoAnterior[insumo.id]) novosAvisos[insumo.id] = avisoAnterior[insumo.id];
      }

      await prisma.user.update({
        where: { id: loja.id },
        data: { chatbotConfig: { ...config, [CHAVE_AVISOS]: novosAvisos } },
      });

      resumo.lojasAvisadas++;
      console.log(
        `[EstoqueAlerta] Loja ${loja.id} avisada sobre ${devidos.length} insumo(s) no limite`
      );
    }

    return NextResponse.json({ ...resumo, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error("[EstoqueAlerta] Falhou:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Erro interno", ...resumo }, { status: 500 });
  }
}
