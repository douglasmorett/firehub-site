/**
 * /src/lib/nfce/impressao-do-danfe.ts
 *
 * Põe o DANFE NFC-e do emissor próprio na FILA DE IMPRESSÃO da loja, para o
 * Assistente imprimir na térmica do caixa com o QR Code.
 *
 *   imprimirDanfe(pedidoId)   — a emissão (frente A) chama logo depois de
 *                               GRAVAR o fiscalInfo da nota autorizada ou em
 *                               contingência (por import dinâmico). Nunca lança.
 *   enfileirarDanfe(pedidoId) — o mesmo, devolvendo o resultado e os avisos
 *                               (para uma tela "imprimir DANFE" mostrar).
 *
 * ── A fila ──────────────────────────────────────────────────────────────────
 * A fila da nuvem já tinha, além dos pedidos, as impressões AVULSAS
 * (PrintRequest: conta da mesa, papel do caixa, reimpressão), cada uma com seu
 * `kind`. O DANFE entrou como mais um `kind` ("DANFE_NFCE") — a extensão
 * mínima: nada de tabela ou coluna nova. A rota da fila
 * (api/store/print-queue) manda o trabalho para a impressora do CAIXA (a mesma
 * regra do papel do caixa: lib/impressao-da-conta.ts, impressoraDoCaixa) e SÓ
 * para o Assistente que ANUNCIA imprimir o DANFE (`&danfe=1` na consulta da
 * fila — lib/print.ts → assistenteImprimeDanfe; a versão não decide, porque
 * as 1.2.24 a 1.2.27 saíram sem o DANFE). Vale a mesma janela de 30 min das
 * outras impressões, e o `ack` carimba `printedAt`.
 *
 * O que vai no payload está em trabalho-do-danfe.ts (as linhas prontas, por
 * largura e por via). O QR sai sempre: pelo comando da impressora ou, no
 * perfil "legacy", como imagem desenhada pelo Assistente.
 *
 * Só servidor.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assistenteOuvindoAFila } from "@/lib/imprimir-caixa";
import { KIND_DANFE_NFCE, VERSAO_ASSISTENTE_COM_DANFE, assistenteImprimeDanfe } from "@/lib/print";
import { danfeDoPedido } from "./danfe-do-pedido";
import { largurasDasImpressoras, trabalhoDoDanfe } from "./trabalho-do-danfe";

/** Quanto tempo o mesmo DANFE (mesma chave, mesmo estado) não entra de novo na fila sem `forcar`. */
const JANELA_SEM_REPETIR_MS = 30 * 60 * 1000;

export type ResultadoDoDanfeNaFila =
  | { ok: true; id: string; jaEstavaNaFila: boolean; vias: number; avisos: string[] }
  | { ok: false; motivo: string; mensagem: string };

const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/**
 * O interruptor "imprimir o DANFE sozinho" da loja — o ÚNICO lugar que o lê.
 *
 * Existem dois campos, dos dois lados da emissão: `fiscalConfig.imprimirDanfe`
 * (o que lib/fiscal-automatico lê) e `fiscalConfig.sefaz.imprimirDanfe` (o do
 * bloco do emissor próprio, o único que esta fila lia). Cada lado lia um: com
 * só o de cima desligado, a emissão automática não mandava imprimir, mas quem
 * chamasse `enfileirarDanfe` imprimia. Agora `false` em QUALQUER um desliga;
 * ausente = ligado. lib/fiscal-automatico (que tem a cópia local
 * `imprimeODanfe`) pode passar a usar esta.
 */
export function lojaImprimeODanfe(fiscalConfig: unknown): boolean {
  const config = objeto(fiscalConfig);
  return config.imprimirDanfe !== false && objeto(config.sefaz).imprimirDanfe !== false;
}

export async function enfileirarDanfe(
  pedidoId: string,
  opcoes: {
    /** Reimpressão pedida na mão: entra mesmo que o mesmo DANFE já esteja na fila, e mesmo com a impressão automática desligada. */
    forcar?: boolean;
    /** Quem pediu (auditoria no PrintRequest). */
    operador?: string | null;
  } = {}
): Promise<ResultadoDoDanfeNaFila> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: String(pedidoId ?? "") },
    select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true },
  });
  if (!pedido) return { ok: false, motivo: "pedido_inexistente", mensagem: `Pedido ${pedidoId} não encontrado.` };

  const lido = await danfeDoPedido(pedido);
  if (!lido.ok) return { ok: false, motivo: lido.erro, mensagem: lido.mensagem };

  const dono = await prisma.user.findUnique({
    where: { id: pedido.franchiseeId },
    select: { printerConfig: true, printQueueEstado: true, fiscalConfig: true },
  });
  // Interruptor da loja (lojaImprimeODanfe): quem não quer o cupom automático
  // no papel — entrega o DANFE só pelo link, com a concordância do cliente.
  if (!opcoes.forcar && !lojaImprimeODanfe(dono?.fiscalConfig)) {
    return { ok: false, motivo: "desligado", mensagem: "A loja desligou a impressão automática do DANFE." };
  }

  const printers: any[] = Array.isArray(objeto(dono?.printerConfig).printers) ? objeto(dono?.printerConfig).printers : [];
  const trabalho = trabalhoDoDanfe(lido.dados, { pedidoId: pedido.id, larguras: largurasDasImpressoras(printers) });

  const avisos: string[] = [];
  const estado = objeto(dono?.printQueueEstado);
  const versao = String(estado.versao || "");
  // Pela CAPACIDADE que o Assistente anunciou na consulta da fila — a mesma
  // régua da fila, que só entrega o DANFE a ele —, não pela versão.
  if (!assistenteImprimeDanfe(estado)) {
    avisos.push(
      `O Assistente de impressão desta loja (${versao || "versão desconhecida"}) ainda não imprime o DANFE — precisa da ` +
        `${VERSAO_ASSISTENTE_COM_DANFE}. Até atualizar, imprima pelo navegador (Notas fiscais → DANFE).`
    );
  }
  // O perfil "legacy" deixou de ser aviso: o Assistente que imprime o DANFE
  // desenha o QR como imagem (GS v 0) quando a impressora não entende o
  // comando de QR, e não imprime DANFE sem QR (server.js → buildDanfeEscPos).
  if (lido.dados.pendenteDeAutorizacao) {
    avisos.push("Contingência: saem duas vias — a do estabelecimento fica guardada na loja até a SEFAZ autorizar a nota.");
  }

  if (!opcoes.forcar) {
    // A emissão pode chamar duas vezes (a automática e o botão, ou uma
    // consulta que regrava a nota): o mesmo papel não sai em dobro. A
    // contingência autorizada depois é OUTRA identidade — mas quem decide se
    // reimprime é quem chama.
    const jaNaFila = await prisma.printRequest
      .findFirst({
        where: {
          franchiseeId: pedido.franchiseeId,
          kind: KIND_DANFE_NFCE,
          createdAt: { gt: new Date(Date.now() - JANELA_SEM_REPETIR_MS) },
          payload: { path: ["danfe", "identidade"], equals: trabalho.danfe.identidade },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (jaNaFila) return { ok: true, id: jaNaFila.id, jaEstavaNaFila: true, vias: trabalho.danfe.vias.length, avisos };
  }

  const criado = await prisma.printRequest.create({
    data: {
      franchiseeId: pedido.franchiseeId,
      kind: KIND_DANFE_NFCE,
      payload: trabalho as unknown as Prisma.InputJsonValue,
      requestedBy: opcoes.operador || "nfce-emissor-proprio",
    },
    select: { id: true },
  });

  if ((await assistenteOuvindoAFila(pedido.franchiseeId)) === false) {
    avisos.push("Nenhum Assistente consultou a fila nos últimos 3 minutos: o DANFE espera na fila por até 30 minutos.");
  }
  return { ok: true, id: criado.id, jaEstavaNaFila: false, vias: trabalho.danfe.vias.length, avisos };
}

/**
 * Enfileira o DANFE do pedido na impressora do caixa. NUNCA lança: imprimir é
 * consequência da nota, não condição — uma falha aqui não pode desfazer nem
 * atrasar a emissão. O que acontecer vai para o log.
 *
 * Chame DEPOIS de gravar o fiscalInfo (xmlNoCofre) do pedido: o DANFE é lido
 * do cofre, pela nota gravada.
 */
export async function imprimirDanfe(pedidoId: string, opcoes: { forcar?: boolean; operador?: string | null } = {}): Promise<void> {
  try {
    const r = await enfileirarDanfe(pedidoId, opcoes);
    if (!r.ok) {
      console.warn(`[DANFE] pedido ${pedidoId}: não foi para a fila — ${r.mensagem}`);
      return;
    }
    const como = r.jaEstavaNaFila ? "já estava na fila" : `na fila (${r.vias} via${r.vias > 1 ? "s" : ""})`;
    console.log(`[DANFE] pedido ${pedidoId}: ${como}, PrintRequest ${r.id}.${r.avisos.length ? ` Avisos: ${r.avisos.join(" | ")}` : ""}`);
  } catch (e: any) {
    console.error(`[DANFE] pedido ${pedidoId}: falha ao enfileirar o DANFE:`, String(e?.message ?? e).slice(0, 300));
  }
}
