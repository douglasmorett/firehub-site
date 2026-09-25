/**
 * /src/lib/assistente-da-loja.ts
 *
 * QUANDO O ASSISTENTE PODE SE ATUALIZAR.
 *
 * O auto-update fecha o Assistente, instala por cima e religa. Ele decidia
 * sozinho, olhando só "imprimi nos últimos 30 min?" — e essa exigência afrouxa
 * com o tempo (2 min depois de 48 h de versão pendente). Numa loja movimentada
 * isso cai no meio do serviço: a 1.2.24 saiu em 24/09/2026 às 21h e a Ragnar e
 * a Divinos se atualizaram no meio do jantar. Queixa do dono, no mesmo dia: "o
 * instalador tá fechando no meio da operação, o pessoal tá reclamando".
 *
 * Agora quem decide é o servidor, que sabe o que o Assistente não sabe: o
 * horário da loja, no fuso dela, e se entrou pedido há pouco. Fora disso a
 * rota da versão responde "adiada", e o Assistente pergunta de novo em 10 min.
 *
 * ── QUAL LOJA ESTÁ PERGUNTANDO ─────────────────────────────────────────────
 * O Assistente 1.2.25+ manda o id da loja. Os anteriores perguntam a versão
 * sem dizer quem são — mas o mesmo programa, na mesma máquina, consulta a
 * fila da nuvem a cada 3 s COM o id. O endereço de quem consultou a fila é o
 * endereço de quem pergunta a versão: é por ele que a loja é reconhecida, e é
 * isso que protege as versões já instaladas sem reinstalar nada.
 */
import { prisma } from "@/lib/prisma";
import { estadoDaLoja, relogioDaLoja } from "@/lib/loja-aberta";
import { horaDaLoja, FUSO_PADRAO } from "@/lib/fuso";

/** Endereço → loja, aprendido na fila da nuvem. Vale 10 min sem renovar. */
const lojaPorEndereco = new Map<string, { franchiseeId: string; em: number }>();
const VALIDADE_DO_ENDERECO_MS = 10 * 60_000;

export function lembrarAssistente(endereco: string | null | undefined, franchiseeId: string | null | undefined): void {
  const ip = String(endereco || "").trim();
  const id = String(franchiseeId || "").trim();
  if (!ip || !id || ip === "unknown") return;
  lojaPorEndereco.set(ip, { franchiseeId: id, em: Date.now() });
  // O mapa não pode crescer para sempre: a cada tanto, sai o que venceu.
  if (lojaPorEndereco.size > 500) {
    const limite = Date.now() - VALIDADE_DO_ENDERECO_MS;
    for (const [chave, v] of lojaPorEndereco) if (v.em < limite) lojaPorEndereco.delete(chave);
  }
}

export function lojaDoEndereco(endereco: string | null | undefined): string | null {
  const v = lojaPorEndereco.get(String(endereco || "").trim());
  if (!v || Date.now() - v.em > VALIDADE_DO_ENDERECO_MS) return null;
  return v.franchiseeId;
}

/** Pedido entrou há menos que isso: a loja está trabalhando, diga o horário o que disser. */
export const SEM_PEDIDO_HA_MIN = 45;
/** Abre em menos que isso: não é hora de desligar a impressão. */
export const ANTES_DE_ABRIR_MIN = 45;

export type DecisaoDeAtualizacao = { pode: boolean; motivo: string };

function minutosDoTexto(hhmm: string | undefined): number | null {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * A regra, sem banco: separada para o teste provar cada caso.
 *
 * Três coisas seguram a atualização, e qualquer uma basta:
 *   - a loja está aberta pelo horário dela (ver estadoParaAtualizacao);
 *   - abre hoje em menos de 45 min;
 *   - entrou pedido nos últimos 45 min (mesa aberta depois do horário, iFood
 *     tocando com a loja "fechada" no cadastro, turno que passou da hora).
 */
export function decidirAtualizacao(opts: {
  estado: ReturnType<typeof estadoDaLoja>;
  minutosAgora: number;
  minutosDesdeOUltimoPedido: number | null;
}): DecisaoDeAtualizacao {
  const { estado, minutosAgora, minutosDesdeOUltimoPedido } = opts;
  if (estado.aberta) {
    return { pode: false, motivo: `loja aberta${estado.fechaAs ? ` até ${estado.fechaAs}` : ""}` };
  }
  const abre = estado.proximaAbertura?.ehHoje ? minutosDoTexto(estado.proximaAbertura.hora) : null;
  if (abre != null && abre - minutosAgora >= 0 && abre - minutosAgora < ANTES_DE_ABRIR_MIN) {
    return { pode: false, motivo: `a loja abre às ${estado.proximaAbertura!.hora}` };
  }
  if (minutosDesdeOUltimoPedido != null && minutosDesdeOUltimoPedido < SEM_PEDIDO_HA_MIN) {
    return { pode: false, motivo: `entrou pedido há ${Math.max(0, Math.round(minutosDesdeOUltimoPedido))} min` };
  }
  return { pode: true, motivo: "loja fora de operação" };
}

/**
 * O horário da loja SEM o interruptor do painel. Ele fecha o delivery na
 * correria — cozinha cheia, motoboy faltando — e a cozinha continua
 * trabalhando e imprimindo. Para vender, ele manda; para decidir se dá para
 * desligar a impressão, quem manda é o horário. A pausa programada (férias)
 * continua valendo: aí a loja está parada de verdade.
 */
export function estadoParaAtualizacao(
  loja: { storeHours?: unknown; storePause?: unknown; storeTimezone?: string | null },
  agora?: Date
): ReturnType<typeof estadoDaLoja> {
  return estadoDaLoja({
    storeHours: loja.storeHours,
    storePause: loja.storePause,
    storeOpen: true,
    timezone: loja.storeTimezone,
    agora,
  });
}

/** Loja que não deu para reconhecer: só de madrugada e de manhã cedo, no fuso de Brasília. */
export function decidirSemLoja(horaEmBrasilia: number): DecisaoDeAtualizacao {
  return horaEmBrasilia >= 1 && horaEmBrasilia < 10
    ? { pode: true, motivo: "madrugada" }
    : { pode: false, motivo: "loja não identificada; só atualiza entre 1h e 10h" };
}

export async function podeAtualizarAgora(franchiseeId: string | null): Promise<DecisaoDeAtualizacao> {
  if (!franchiseeId) return decidirSemLoja(horaDaLoja(FUSO_PADRAO));

  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeHours: true, storePause: true, storeTimezone: true },
  });
  if (!loja) return decidirSemLoja(horaDaLoja(FUSO_PADRAO));

  // O último papel pedido conta junto: conta da mesa e fechamento de caixa
  // não nascem de pedido, e o fechamento é justamente o último do dia.
  const [ultimoPedido, ultimaAvulsa] = await Promise.all([
    prisma.customerOrder.findFirst({ where: { franchiseeId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.printRequest
      .findFirst({ where: { franchiseeId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
      .catch(() => null),
  ]);
  const instantes = [ultimoPedido?.createdAt, ultimaAvulsa?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  const minutosDesdeOUltimoPedido = instantes.length ? (Date.now() - Math.max(...instantes)) / 60_000 : null;

  const estado = estadoParaAtualizacao(loja);
  const { minutos } = relogioDaLoja(loja.storeTimezone || FUSO_PADRAO);
  return decidirAtualizacao({ estado, minutosAgora: minutos, minutosDesdeOUltimoPedido });
}
