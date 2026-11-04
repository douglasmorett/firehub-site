/**
 * "Assinatura aprovada!" no celular do Douglas, no modelo da Cakto e com a logo do
 * FireHub (é o ícone do app FireHub), a cada venda paga na conta do FireHub no
 * Asaas: mensalidade da loja (lib/pagamento-da-mensalidade.ts) e recarga do
 * Disparo oficial (lib/disparo-oficial/servidor.ts). Pedido do Douglas
 * (01/11/2026): gravar a tela e postar.
 *
 * ── Só para ele ─────────────────────────────────────────────────────────────
 * Vai SÓ para os celulares em que uma conta de CONTAS_QUE_RECEBEM está logada
 * no app FireHub — nunca pela loja, nunca pelo papel (ADMIN). Lojista nenhum
 * cai nisto: o aparelho é gravado com o usuário que entrou no app
 * (lib/app-firehub/aparelhos.ts), e o celular que troca de conta sai da lista
 * na hora. Lista vazia = ninguém recebe.
 *
 * O texto não leva o nome da loja: o aviso vai para vídeo público.
 */
import { prisma } from "@/lib/prisma";
import { enviarPeloExpo, garantirTabelaDeAparelhosDaLoja } from "@/lib/app-firehub/aparelhos";

/** E-mail do login (loja ou equipe) que recebe — o app não aceita a conta ADMIN. */
export const CONTAS_QUE_RECEBEM = ["firehubfood@gmail.com"];

export function podeReceberAvisoDeVenda(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && CONTAS_QUE_RECEBEM.includes(e);
}

export function textoDaVenda(valor: number): { titulo: string; corpo: string } {
  const reais = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return { titulo: "Assinatura aprovada! 🔥", corpo: `Valor: ${reais}` };
}

/** NUNCA lança e nunca deve ser esperado por quem grava o pagamento. */
export async function avisarVendaAprovada(valor: number | null | undefined): Promise<void> {
  if (!valor || !(valor > 0)) return;
  try {
    if (!(await garantirTabelaDeAparelhosDaLoja())) return;
    const linhas = await prisma.$queryRaw<{ pushToken: string; email: string | null }[]>`
      SELECT a."pushToken", u."email" FROM "LojaAparelho" a
      JOIN "User" u ON u."id" = a."userId"
      WHERE lower(u."email") = ANY(${CONTAS_QUE_RECEBEM})
    `;
    // A conferência repete a do SQL de propósito: o filtro é a única coisa que
    // separa o aviso do celular de um lojista.
    const tokens = linhas.filter((l) => podeReceberAvisoDeVenda(l.email)).map((l) => l.pushToken);
    if (tokens.length === 0) return;

    const { titulo, corpo } = textoDaVenda(valor);
    const mensagens = tokens.map((to) => ({
      to,
      title: titulo,
      body: corpo,
      data: { tipo: "venda" },
      sound: "default",
      priority: "high",
    }));
    await enviarPeloExpo(mensagens, "o aviso de venda");
  } catch (err: any) {
    console.warn(`[App FireHub] aviso de venda falhou: ${err?.message}`);
  }
}
