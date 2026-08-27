import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  pendenciasParaEmitir,
  inutilizarNumeracao,
  type ConfiguracaoFiscal,
} from "@/lib/fiscal-emissao";

export const dynamic = "force-dynamic";

/**
 * Inutilização de faixa de numeração de NFC-e.
 *
 * O que esta rota fazia antes:
 *
 *     const protocolo = `13526${Math.floor(1000000000 + Math.random() * 9000000000)}`;
 *     return NextResponse.json({ success: true, protocolo,
 *       mensagem: `Numeração de X a Y da série S inutilizada com sucesso na SEFAZ.` });
 *
 * Um número aleatório apresentado como protocolo da SEFAZ. O lojista guardaria
 * esse comprovante achando que regularizou a faixa, e a numeração continuaria em
 * aberto na Receita — para aparecer na próxima fiscalização.
 *
 * Inutilizar é um ato junto à SEFAZ: precisa de certificado digital, assinatura
 * do XML de inutilização e transmissão pelo webservice. Enquanto o provedor de
 * emissão não estiver configurado, a resposta honesta é dizer que não dá.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true, fiscalConfig: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // Inutilizar numeração é ato do titular perante a SEFAZ. Antes, qualquer
    // sessão autenticada — inclusive um STAFF de balcão — disparava a rota.
    if (user.role === "STAFF") {
      return NextResponse.json(
        { error: "Só o responsável pela loja pode inutilizar numeração fiscal." },
        { status: 403 }
      );
    }

    const lojaId = user.ownerId || user.id;

    const body = await req.json().catch(() => ({}));
    const { serie, numeroInicial, numeroFinal, justificativa } = body;

    if (!serie || !numeroInicial || !numeroFinal || !justificativa) {
      return NextResponse.json(
        { error: "Preencha série, número inicial, número final e justificativa." },
        { status: 400 }
      );
    }

    // A SEFAZ exige justificativa com no mínimo 15 caracteres. Recusar aqui
    // evita a viagem e a rejeição 000-000 lá na frente.
    if (String(justificativa).trim().length < 15) {
      return NextResponse.json(
        { error: "A justificativa precisa ter pelo menos 15 caracteres — é exigência da SEFAZ." },
        { status: 400 }
      );
    }

    if (Number(numeroFinal) < Number(numeroInicial)) {
      return NextResponse.json(
        { error: "O número final não pode ser menor que o inicial." },
        { status: 400 }
      );
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });

    const config = (loja?.fiscalConfig as ConfiguracaoFiscal | null) ?? {};
    const pendencias = pendenciasParaEmitir(config);

    // Nada de protocolo inventado: sem caminho até a SEFAZ, não houve
    // inutilização, e o lojista precisa saber disso agora.
    if (pendencias.length > 0) {
      return NextResponse.json(
        {
          error: "emissao_nao_configurada",
          mensagem:
            "A inutilização de numeração não foi executada. Ela é um ato junto à SEFAZ e exige " +
            "certificado digital e provedor de emissão configurados — o que ainda não está " +
            `pronto nesta loja (${pendencias.length} pendência(s)). Enquanto isso, inutilize a ` +
            "faixa pelo portal da SEFAZ do seu estado.",
          pendencias,
          faixaSolicitada: { serie, numeroInicial, numeroFinal },
        },
        { status: 409 }
      );
    }

    // Cadastro completo: transmite a inutilização de verdade pelo provedor.
    const resultado = await inutilizarNumeracao(config, {
      serie: Number(serie),
      numeroInicial: Number(numeroInicial),
      numeroFinal: Number(numeroFinal),
      justificativa: String(justificativa).trim(),
    });

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.motivo, mensagem: resultado.mensagem, detalhe: resultado.detalhe ?? null },
        { status: resultado.motivo === "erro_de_comunicacao" ? 502 : 409 }
      );
    }

    // Guarda o comprovante junto da configuração fiscal: o protocolo da SEFAZ
    // é o documento que o lojista apresenta numa fiscalização.
    const historico = Array.isArray((config as any).inutilizacoes)
      ? (config as any).inutilizacoes
      : [];
    await prisma.user.update({
      where: { id: lojaId },
      data: {
        fiscalConfig: {
          ...(config as any),
          inutilizacoes: [
            ...historico,
            {
              serie: resultado.serie,
              numeroInicial: resultado.numeroInicial,
              numeroFinal: resultado.numeroFinal,
              protocolo: resultado.protocolo,
              statusSefaz: resultado.statusSefaz,
              mensagemSefaz: resultado.mensagemSefaz,
              justificativa: String(justificativa).trim(),
              homologadaEm: resultado.homologadaEm,
            },
          ],
        },
      },
    });

    return NextResponse.json({
      success: true,
      protocolo: resultado.protocolo,
      mensagem:
        `Inutilização homologada pela SEFAZ (${resultado.mensagemSefaz}). ` +
        `Faixa ${resultado.numeroInicial}–${resultado.numeroFinal} da série ${resultado.serie}. ` +
        `Protocolo: ${resultado.protocolo}.`,
    });
  } catch (err: any) {
    console.error("[Fiscal Inutilizacao] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
