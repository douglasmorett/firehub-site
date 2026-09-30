import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { pendenciasParaEmitir, inutilizarNumeracao } from "@/lib/fiscal-emissao";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { usaEmissorProprio } from "@/lib/nfce/config-da-loja";

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

    // O ambiente da faixa (1 = produção, 2 = homologação): cada um tem a sua
    // numeração na SEFAZ. Sem ele, vale o da loja — e a resposta DIZ qual foi,
    // para ninguém guardar um protocolo de homologação achando que é o real.
    const ambientePedido = body.ambiente === undefined || body.ambiente === null || body.ambiente === "" ? null : Number(body.ambiente);
    if (ambientePedido !== null && ambientePedido !== 1 && ambientePedido !== 2) {
      return NextResponse.json({ error: "Ambiente inválido: 1 (produção) ou 2 (homologação)." }, { status: 400 });
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

    // NORMALIZADA (lib/fiscal-config), como a emissão: o legado "producao"
    // por extenso virava NaN e a inutilização ia para o servidor de
    // HOMOLOGAÇÃO — o lojista guardaria o protocolo de um ambiente de teste
    // achando que regularizou a faixa. A normalização também carimba de que
    // ambiente é o token colado à mão. A loja cadastrada pela Focus (CSC só em
    // `cscNaFocus`) passa na conferência: pendenciasParaEmitir aceita.
    const config = normalizarConfigFiscal(loja?.fiscalConfig);
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

    // ── Emissor próprio: direto na SEFAZ ─────────────────────────────────
    // Antes de pedir, a faixa é conferida contra os pedidos da loja: número
    // de nota emitida, em contingência (ainda vai ser transmitida COM ele) ou
    // reservado não se inutiliza — e nada vai à SEFAZ. O ProcInutNFe vai para
    // o cofre e o registro para fiscalConfig.inutilizacoes, gravado sem
    // reescrever o resto do fiscalConfig (lib/nfce/inutilizacao-da-loja).
    if (usaEmissorProprio(config)) {
      const { inutilizarFaixaNaSefaz } = await import("@/lib/nfce/inutilizacao-da-loja");
      const ambiente = ambientePedido === 1 || ambientePedido === 2 ? ambientePedido : Number(config.ambiente) === 1 ? 1 : 2;
      const r = await inutilizarFaixaNaSefaz({
        lojaId,
        config,
        serie: Number(serie),
        numeroInicial: Number(numeroInicial),
        numeroFinal: Number(numeroFinal),
        justificativa: String(justificativa).trim(),
        ambiente,
        origem: "tela",
      });
      if (!r.ok) {
        return NextResponse.json(
          { error: r.motivo, mensagem: r.mensagem, detalhe: r.detalhe ?? null, conflitos: r.conflitos ?? [], pendencias: r.pendencias ?? [], ambiente, cStat: r.statusSefaz ?? null },
          { status: r.motivo === "erro_de_comunicacao" ? 502 : 409 }
        );
      }
      const qual = r.ambiente === 1 ? "PRODUÇÃO" : "HOMOLOGAÇÃO (teste, sem valor fiscal)";
      return NextResponse.json({
        success: true,
        protocolo: r.protocolo || null,
        ambiente: r.ambiente,
        ...(r.semProtocolo ? { semProtocolo: true } : {}),
        mensagem: r.semProtocolo
          ? `A SEFAZ informa que a faixa ${r.numeroInicial}–${r.numeroFinal} da série ${r.serie} JÁ estava inutilizada em ${qual} ` +
            `(${r.mensagemSefaz}). O registro ficou sem o protocolo — ele pode ser consultado no portal da SEFAZ.`
          : `Inutilização homologada pela SEFAZ em ${qual} (${r.mensagemSefaz}). ` +
            `Faixa ${r.numeroInicial}–${r.numeroFinal} da série ${r.serie}. Protocolo: ${r.protocolo}.`,
      });
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
              ambiente: Number(config.ambiente) === 1 ? 1 : 2,
              // O XML da inutilização homologada é o que se guarda por 5 anos
              // e vai no pacote do contador (lib/contador-pacote).
              xmlUrl: resultado.urlDoXml,
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
