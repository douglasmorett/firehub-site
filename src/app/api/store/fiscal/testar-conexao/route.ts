import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { testarConexaoComProvedor } from "@/lib/fiscal-emissao";
import { ambienteNumerico, normalizarConfigFiscal } from "@/lib/fiscal-config";
import { usaEmissorProprio } from "@/lib/nfce/config-da-loja";
import { checkRateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Um teste por minuto por loja (ver "Só POST, só o titular, um por minuto"). */
const JANELA_DO_TESTE_MS = 60_000;

/**
 * POST /api/store/fiscal/testar-conexao — o botão "Testar conexão" da tela
 * fiscal. Corpo JSON `{ "ambiente": 1 | 2 }` (opcional). Autentica no provedor
 * com o token salvo e devolve, em português, se o token vale para o ambiente.
 * O token nunca sai do servidor.
 *
 * `ambiente` testa o token do OUTRO ambiente sem trocar a configuração: o
 * lojista confere o de produção antes de virar a chave, em vez de descobrir na
 * primeira venda. Sem ele vale o ambiente gravado (Focus) ou HOMOLOGAÇÃO
 * (emissor próprio). `?ambiente=` na URL continua valendo como reserva, para
 * quem chamava assim.
 *
 * ── Emissor próprio (provedor "sefaz") ──────────────────────────────────────
 *
 * Não há token: o teste é o STATUS DO SERVIÇO da SEFAZ da UF (consStatServ),
 * com o certificado A1 da loja no TLS — prova, antes da primeira venda, que o
 * .pfx abre, que a cadeia ICP-Brasil fecha e que a SEFAZ responde. Sem
 * ambiente, HOMOLOGAÇÃO — o teste do "dia 1" não deve tocar produção sem
 * pedir. Responde `{ ok, success, cStat, mensagem, ambiente, certificado:
 * { titular, validoAte, diasParaVencer } }` (200 se ok, 409 se não) e grava em
 * fiscalConfig.sefaz.ultimoTeste (lib/nfce/emissao-da-loja). Na Focus:
 * `{ success, mensagem }`, 200/409.
 *
 * ── Só POST, só o titular, um por minuto ────────────────────────────────────
 *
 * Respondia também a GET — e o teste TEM efeito: no emissor próprio abre uma
 * conexão mTLS na SEFAZ com o A1 da loja e grava o resultado. GET com efeito é
 * o que pré-carregamento, link e "voltar" do navegador disparam sozinhos, e a
 * SEFAZ responde 656 (consumo indevido) e bloqueia por um tempo o CNPJ que
 * consulta demais — em série, a loja ficaria bloqueada justo no dia de ligar
 * a emissão. E qualquer sessão da loja disparava, inclusive o funcionário.
 * Agora: só POST, só o titular (FRANCHISEE) ou o ADMIN, e no máximo um teste
 * por minuto por loja (429 "Aguarde um minuto para testar de novo.").
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    if (user.role !== "FRANCHISEE" && user.role !== "ADMIN") {
      return NextResponse.json(
        { success: false, ok: false, error: "sem_permissao", mensagem: "Só o responsável pela loja testa a conexão com a SEFAZ e com a Focus." },
        { status: 403 }
      );
    }
    const lojaId = user.ownerId || user.id;

    // Conta por LOJA (o dono e o admin testando a mesma loja dividem o minuto):
    // o limite da SEFAZ é pelo CNPJ, não por quem clicou.
    const limite = checkRateLimit(`fiscal-testar-conexao:${lojaId}`, { windowMs: JANELA_DO_TESTE_MS, maxRequests: 1 });
    if (!limite.allowed) {
      return NextResponse.json(
        { success: false, ok: false, error: "aguarde", mensagem: "Aguarde um minuto para testar de novo." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(limite.resetIn / 1000))) } }
      );
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    // Normalizada: com o `ambiente: "producao"` por extenso da tela antiga, o
    // teste ia para homologação (NaN !== 1) e dizia "OK" para o token errado.
    const config = normalizarConfigFiscal(loja?.fiscalConfig);
    const body = await req.json().catch(() => ({}));
    const daUrl = new URL(req.url).searchParams.get("ambiente");
    const pedido = ambienteNumerico(body?.ambiente ?? daUrl);

    if (usaEmissorProprio(config)) {
      const { testarConexaoDaLoja } = await import("@/lib/nfce/emissao-da-loja");
      const r = await testarConexaoDaLoja({ lojaId, config, ambiente: pedido ?? 2 });
      // `success` junto de `ok`: a tela de antes lia `success`.
      return NextResponse.json({ ...r, success: r.ok }, { status: r.ok ? 200 : 409 });
    }

    if (pedido) config.ambiente = pedido;
    const resultado = await testarConexaoComProvedor(config);
    return NextResponse.json(
      { success: resultado.ok, mensagem: resultado.mensagem },
      { status: resultado.ok ? 200 : 409 }
    );
  } catch (err: any) {
    console.error("[Fiscal Testar Conexão] Erro:", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
