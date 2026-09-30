/**
 * /src/lib/fiscal-notas-em-andamento.ts
 *
 * A loja tem NFC-e EM ANDAMENTO — nota que ainda pode virar documento fiscal
 * (ou precisa ser cancelada/inutilizada) sem ninguém clicar de novo? É o que
 * trava trocar de emissor (FireHub ↔ Focus) e de ambiente (homologação ↔
 * produção): api/store/fiscal (PUT) e api/store/fiscal/provisionar.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * A nota em andamento é acompanhada pelo emissor que a começou, no ambiente
 * dela: o cron consulta o "processando" e transmite a contingência
 * (lib/fiscal-automatico → retentarNotasFiscais), a rotina do emissor próprio
 * confere o número que foi à SEFAZ sem resposta (lib/nfce/rotina-da-sefaz) e
 * a próxima tentativa confere pela chave o envio guardado
 * (lib/nfce/emissao-da-loja). Trocar de emissor no meio deixa a nota órfã: o
 * outro lado não sabe dela, a venda pode sair de novo com outro número (duas
 * notas para uma venda) e o número sem conferir nunca é cancelado nem
 * inutilizado. Trocar de ambiente faz a consulta perguntar no ambiente errado.
 *
 * "Em andamento" é:
 *   - emitindo agora, ou sem resposta final: PENDING com `processando` (a
 *     reserva do número e o envio à SEFAZ gravam essa marca — lib/nfce/
 *     numeracao → sqlMarcarEmEmissao; a Focus também, no "processando");
 *   - contingência off-line ainda não transmitida: EMITTED com `contingencia`;
 *   - número que foi à SEFAZ sem resposta, a conferir: `numeroTentado.situacao`
 *     "a_conferir";
 *   - envio guardado para a próxima tentativa conferir pela chave: `envioSefaz`
 *     num pedido PENDING/FAILED (a falha pode ter sido só a resposta que não
 *     voltou — a nota pode estar autorizada lá).
 *
 * Venda de até 31 dias (`JANELA_DA_VENDA_CONSULTADA_MS`, a mesma do cron): é
 * o piso do índice (franchiseeId, createdAt), e o que é mais antigo o cron
 * também não acompanha — fica com o "Consultar situação" da tela.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { JANELA_DA_VENDA_CONSULTADA_MS } from "@/lib/fiscal-momento";

export type NotaEmAndamento = "emitindo" | "contingencia" | "numero_a_conferir" | "envio_a_conferir";

export const MENSAGEM_NOTAS_EM_ANDAMENTO_EMISSOR = "Há notas em andamento: consulte-as antes de trocar de emissor.";
export const MENSAGEM_NOTAS_EM_ANDAMENTO_AMBIENTE = "Há notas em andamento: consulte-as antes de trocar de ambiente.";

const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** O que está em andamento na nota deste pedido (null = nada). A mesma regra do `where` de `ondeHaNotaEmAndamento`. */
export function notaEmAndamento(pedido: { fiscalStatus?: string | null; fiscalInfo?: unknown }): NotaEmAndamento | null {
  const info = objeto(pedido.fiscalInfo);
  if (pedido.fiscalStatus === "PENDING" && info.processando === true) return "emitindo";
  if (pedido.fiscalStatus === "EMITTED" && info.contingencia === true) return "contingencia";
  if (objeto(info.numeroTentado).situacao === "a_conferir") return "numero_a_conferir";
  if ((pedido.fiscalStatus === "PENDING" || pedido.fiscalStatus === "FAILED") && info.envioSefaz != null) return "envio_a_conferir";
  return null;
}

/**
 * O filtro do banco para "pedido da loja com nota em andamento".
 *
 * `NOT { equals: AnyNull }` no caminho é "a chave existe e não é null": o
 * `AnyNull` vira `#> … = 'null' OR #> … IS NULL` (conferido em 24/09/2026), e
 * a negação disso só passa com valor de verdade. Um `not: null` no caminho
 * sumiria com as linhas sem a chave de um jeito difícil de enxergar.
 */
export function ondeHaNotaEmAndamento(lojaId: string, agora: Date = new Date()): Prisma.CustomerOrderWhereInput {
  return {
    franchiseeId: lojaId,
    createdAt: { gte: new Date(agora.getTime() - JANELA_DA_VENDA_CONSULTADA_MS) },
    OR: [
      { fiscalStatus: "PENDING", fiscalInfo: { path: ["processando"], equals: true } },
      { fiscalStatus: "EMITTED", fiscalInfo: { path: ["contingencia"], equals: true } },
      { fiscalInfo: { path: ["numeroTentado", "situacao"], equals: "a_conferir" } },
      { fiscalStatus: { in: ["PENDING", "FAILED"] }, NOT: { fiscalInfo: { path: ["envioSefaz"], equals: Prisma.AnyNull } } },
    ],
  };
}

export type PedidoComNotaEmAndamento = { id: string; dailyOrderNumber: number | null; motivo: NotaEmAndamento };

type BancoDasNotas = {
  customerOrder: {
    findMany(args: {
      where: Prisma.CustomerOrderWhereInput;
      select: { id: true; dailyOrderNumber: true; fiscalStatus: true; fiscalInfo: true };
      orderBy: { createdAt: "desc" };
      take: number;
    }): Promise<Array<{ id: string; dailyOrderNumber: number | null; fiscalStatus: string | null; fiscalInfo: unknown }>>;
  };
};

/** Até `limite` pedidos da loja com nota em andamento. Vazio = pode trocar. */
export async function notasEmAndamentoDaLoja(
  lojaId: string,
  opcoes: { agora?: Date; limite?: number; banco?: BancoDasNotas } = {}
): Promise<PedidoComNotaEmAndamento[]> {
  const banco = opcoes.banco ?? (prisma as unknown as BancoDasNotas);
  const pedidos = await banco.customerOrder.findMany({
    where: ondeHaNotaEmAndamento(lojaId, opcoes.agora),
    select: { id: true, dailyOrderNumber: true, fiscalStatus: true, fiscalInfo: true },
    orderBy: { createdAt: "desc" },
    take: opcoes.limite ?? 5,
  });
  // O banco já filtrou; a regra pura confere de novo e diz o motivo.
  return pedidos.flatMap((p) => {
    const motivo = notaEmAndamento(p);
    return motivo ? [{ id: p.id, dailyOrderNumber: p.dailyOrderNumber ?? null, motivo }] : [];
  });
}

/** A resposta 409 das rotas que trocam de emissor ou de ambiente. */
export function respostaDeNotasEmAndamento(pedidos: PedidoComNotaEmAndamento[], troca: "emissor" | "ambiente") {
  return {
    error: "notas_em_andamento",
    mensagem: troca === "emissor" ? MENSAGEM_NOTAS_EM_ANDAMENTO_EMISSOR : MENSAGEM_NOTAS_EM_ANDAMENTO_AMBIENTE,
    // Para a tela apontar QUAIS: o número do dia (ou o fim do id) e o que falta em cada um.
    pedidos: pedidos.map((p) => ({ id: p.id, numero: p.dailyOrderNumber ?? p.id.slice(-6), motivo: p.motivo })),
  };
}
