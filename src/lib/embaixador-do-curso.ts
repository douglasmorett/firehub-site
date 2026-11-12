import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";

/**
 * EMBAIXADOR DO CURSO "O Jogo da Recorrência" (Douglas, 11/11/2026).
 *
 * O aluno se cadastra sozinho pelo link que só existe dentro do curso e já sai
 * embaixador ativo, com 20% recorrente. É a exceção ao "ninguém vira embaixador
 * por formulário" de /seja-embaixador — e só é seguro por duas travas:
 *
 *   1. O endereço tem um código que só o curso tem (`CODIGO_DO_CURSO`). Vazou?
 *      Troque o código aqui e atualize o link na aula.
 *   2. A carteira do Asaas é conferida ANTES de cadastrar: "se o código estiver
 *      errado, o ideal é nem cadastrar". O Asaas não tem consulta de carteira
 *      de outra conta, então a conferência é uma cobrança de teste com split
 *      para a carteira, apagada na hora — se o Asaas recusa o split, a carteira
 *      não serve e o cadastro não acontece.
 *
 * E se a carteira deixar de valer depois (conta fechada), o boleto da loja sai
 * sem split (lib/billing.ts) — "nunca o cliente sem ser cobrado" — e o
 * embaixador vê o aviso no portal (`marcarSplitRecusado`).
 */

export const CODIGO_DO_CURSO = "jdr-7q4m9x2k";
export const COMISSAO_DO_CURSO = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Conferencia = { ok: true } | { ok: false; motivo: string };

async function asaas(caminho: string, init: { method?: string; body?: unknown } = {}) {
  const chave = getAsaasKey();
  if (!chave) return { ok: false, status: 0, dados: null as any };
  const base = chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
  try {
    const r = await fetch(`${base}${caminho}`, {
      method: init.method || "GET",
      headers: { "Content-Type": "application/json", access_token: chave },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { ok: r.ok, status: r.status, dados: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, dados: null as any };
  }
}

/** O cliente da conferência: o próprio FireHub, sem nenhuma notificação do Asaas. */
async function clienteDaConferencia(): Promise<string | null> {
  const ref = "firehub-conferencia-de-carteira";
  const busca = await asaas(`/customers?externalReference=${ref}&limit=1`);
  const existente = busca.dados?.data?.find((c: any) => !c.deleted);
  if (existente?.id) return existente.id;
  const conta = await asaas("/myAccount/commercialInfo");
  const cpfCnpj = String(conta.dados?.cpfCnpj || "").replace(/\D/g, "");
  if (!cpfCnpj) return null;
  const novo = await asaas("/customers", {
    method: "POST",
    body: {
      name: "FireHub - conferência de carteira",
      cpfCnpj,
      notificationDisabled: true,
      externalReference: ref,
      observations: "Usado só para conferir a carteira (Wallet ID) de embaixador. As cobranças são apagadas na hora.",
    },
  });
  return novo.dados?.id || null;
}

export async function conferirCarteiraNoAsaas(walletId: string): Promise<Conferencia> {
  if (!UUID.test(walletId)) {
    return { ok: false, motivo: "Esse não parece um Wallet ID. Ele tem este formato: 1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f." };
  }
  const indisponivel = { ok: false as const, motivo: "Não consegui conferir o seu código no Asaas agora. Tente de novo em alguns minutos." };
  const cliente = await clienteDaConferencia();
  if (!cliente) return indisponivel;

  const amanha = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const cobranca = await asaas("/payments", {
    method: "POST",
    body: {
      customer: cliente,
      billingType: "PIX",
      value: 5,
      dueDate: amanha,
      description: "Conferência de carteira de embaixador (apagada na hora)",
      split: [{ walletId, percentualValue: 1 }],
    },
  });
  if (cobranca.ok && cobranca.dados?.id) {
    await asaas(`/payments/${cobranca.dados.id}`, { method: "DELETE" });
    return { ok: true };
  }
  // 4xx = o Asaas leu e recusou (carteira inexistente, a do próprio FireHub…).
  // Qualquer outra coisa é o Asaas fora — não é culpa do aluno.
  if (cobranca.status >= 400 && cobranca.status < 500) {
    const detalhe = cobranca.dados?.errors?.[0]?.description;
    console.warn(`[Embaixador do curso] Carteira recusada pelo Asaas: ${detalhe || cobranca.status}`);
    return { ok: false, motivo: "Esse código do Asaas não existe ou não pode receber comissão. Confira no app do Asaas: Menu › Integrações › Wallet ID." };
  }
  return indisponivel;
}

/**
 * O Asaas recusou o split de um boleto e ele saiu sem comissão: marca as
 * carteiras envolvidas para o portal avisar "fale com a gente". Nunca lança —
 * quem chama está no meio do fechamento da mensalidade.
 */
export async function marcarSplitRecusado(walletIds: string[]) {
  if (!walletIds.length) return;
  try {
    await prisma.ambassador.updateMany({
      where: { asaasWalletId: { in: walletIds } },
      data: { splitRecusadoEm: new Date() },
    });
  } catch (e: any) {
    console.error("[Billing] Não consegui marcar o split recusado no embaixador:", e?.message);
  }
}
