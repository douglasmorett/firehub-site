import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { criarTokenDePrazos } from "@/lib/prazos-token";
import { CORS_PRAZOS, respostaPrazos, contaParaExtensao, contaPodeUsar, motivoDoBloqueio } from "@/lib/prazos";

/**
 * POST /api/prazos/ativar — troca o código do e-mail de compra por um token.
 *
 * É o que tira o trabalho da instalação. Sem isto o lojista precisa abrir o
 * e-mail, copiar uma senha gerada e digitar dentro do popup — três passos que
 * geram chamado de suporte e, pior, param a instalação no meio. Com isto ele
 * clica no link do e-mail, o content script da extensão lê o código da URL,
 * chama aqui e entra. Nada digitado.
 *
 * Quem chama é o CONTENT SCRIPT, não a página: assim o token nunca encosta no
 * DOM nem no JavaScript da página, e não sobra num histórico de navegação.
 *
 * O código é de uso único (vira null) e não expira sozinho — o lojista pode
 * comprar hoje e instalar no computador da loja no dia seguinte, e é comum.
 * Quem corta o acesso continua sendo o `status` da conta, conferido a cada
 * chamada, igual ao login por senha.
 */

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_PRAZOS });
}

export async function POST(req: NextRequest) {
  let codigo = "";
  try {
    const corpo = await req.json();
    codigo = String(corpo?.codigo || "").trim();
  } catch {
    return respostaPrazos({ success: false, error: "Corpo inválido." }, { status: 400 });
  }

  // 24 é o tamanho que o webhook gera. Conferir antes evita ir ao banco com
  // lixo e dá a mesma resposta para código curto e para código inexistente.
  if (codigo.length < 12 || codigo.length > 64) {
    return respostaPrazos({ success: false, error: "Link de ativação inválido." }, { status: 400 });
  }

  const conta = await prisma.prazoConta.findUnique({ where: { ativacaoCodigo: codigo } });
  if (!conta) {
    // Também cai aqui o link já usado, e é de propósito: a mensagem diz o que
    // fazer em vez de deixar o lojista olhando para um erro.
    return respostaPrazos(
      { success: false, error: "Este link de ativação já foi usado. Entre com o e-mail e a senha que chegaram na compra." },
      { status: 404 },
    );
  }

  if (!contaPodeUsar(conta.status)) {
    return respostaPrazos({ success: false, error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
  }

  const atualizada = await prisma.prazoConta.update({
    where: { id: conta.id },
    data: { ativacaoCodigo: null, ativadoEm: conta.ativadoEm ?? new Date() },
  });

  return respostaPrazos({
    success: true,
    token: criarTokenDePrazos(conta.id),
    conta: contaParaExtensao(atualizada),
  });
}
