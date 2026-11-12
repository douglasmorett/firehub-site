/**
 * O link de inscrição da Escala da equipe (/escala/<código>) — SEM login.
 *
 * GET  — a loja, as regras do link e os turnos FUTUROS com vaga (próximas ~3
 *        semanas), só das funções que a loja deixou no link. De quem já se
 *        inscreveu sai só o primeiro nome.
 * POST { acao: "identificar", telefone }
 *        — quem é esta pessoa na loja (motoboy, funcionário ou freelancer), as
 *          inscrições dela e a chave Pix ESCONDIDA (***.456.789-**): quem
 *          digitar o telefone de um colega não lê a chave dele. Telefone que
 *          ninguém tem: "conhecido: false", e a tela pede nome, função e Pix.
 * POST { acao: "inscrever", telefone, turnoId, nome?, funcao?, pix?, pixTipo? }
 *        — inscreve (trava a vaga no banco); pessoa nova vira freelancer
 *          "veio pelo link" e TEM de dar o Pix (Douglas, 12/11/2026: "manda
 *          ele colocar o Pix dele para facilitar na hora do pagamento"); quem
 *          já é da loja e não tem Pix pode mandar junto (ou pular). Devolve a
 *          chave de desistir, que só este aparelho guarda.
 * POST { acao: "pix", telefone, pix, pixTipo?, chaves: [...] }
 *        — grava/corrige o Pix. Quem já tem chave só troca com a chave de uma
 *          inscrição feita NESTE aparelho (a mesma prova do desistir), e a
 *          troca fica marcada para o dono conferir antes de pagar.
 * POST { acao: "desistir", inscricaoId, chave }
 *        — só com a chave e dentro do prazo da loja.
 *
 * Limite por IP: o telefone identifica, então tentar telefones em série para
 * descobrir quem trabalha na loja tem de ser lento.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import {
  ErroDaEscala, aparelhoDaPessoa, desistirPeloLink, gravarPixPeloLink, inscrever, inscricoesDaPessoa, lojaPeloCodigo, pessoasDaLoja, salvarFreelancer,
  turnosDoPeriodo, type PessoaDaEscala,
} from "@/lib/escala-da-equipe/banco";
import {
  DIAS_NO_LINK, acharPeloTelefone, agoraDaLoja, desistenciaAberta, funcaoNoLink, inscricaoAberta, lerChavePix, normalizarFuncao, pixMascarado,
  primeiroNome, situacaoDasVagas, somarDias, telefoneUtilizavel, tipoDaChave, turnoJaTerminou,
} from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

const ROTULO: Record<PessoaDaEscala["tipo"], string> = { motoboy: "Motoboy", equipe: "Equipe", freelancer: "Freelancer" };

async function lojaDoLink(codigo: string) {
  const achada = await lojaPeloCodigo(codigo);
  if (!achada) throw new ErroDaEscala("Este link de escala não existe mais. Peça o link novo para a loja.", 404);
  const fuso = await fusoDaLoja(achada.lojaId);
  return { ...achada, fuso, agora: agoraDaLoja(fuso) };
}

/** O Pix que a própria pessoa vê: escondido, com o tipo. */
const pixVisivel = (p: Pick<PessoaDaEscala, "pix" | "pixTipo">) =>
  p.pix ? { mascarada: pixMascarado(p.pix, p.pixTipo), tipo: tipoDaChave(p.pix, p.pixTipo) } : null;

/** Quem tem este telefone na loja — inclusive freelancer desativado (para dizer que está desativado). */
async function quemTemOTelefone(lojaId: string, telefone: string) {
  return acharPeloTelefone(telefone, await pessoasDaLoja(lojaId, { inativos: true }));
}

export async function GET(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  try {
    if (!checkRateLimit(`escala-link:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 60 }).allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Espere um minuto." }, { status: 429 });
    }
    const { codigo } = await params;
    const l = await lojaDoLink(codigo);
    const loja = await prisma.user.findUnique({ where: { id: l.lojaId }, select: { storeName: true, name: true, storeLogo: true } });
    const turnos = l.config.linkAtivo ? await turnosDoPeriodo(l.lojaId, l.agora.data, somarDias(l.agora.data, DIAS_NO_LINK)) : [];
    const abertos = turnos
      .filter((t) => funcaoNoLink(t.funcao, l.config.funcoesNoLink) && !turnoJaTerminou(t, l.agora) && inscricaoAberta(t, l.agora, l.config))
      .map((t) => {
        const v = situacaoDasVagas(t.inscritos.length, t.vagas);
        return {
          id: t.id, data: t.data, inicio: t.inicio, fim: t.fim, funcao: t.funcao, obs: t.obs, vagas: t.vagas, faltam: v.faltam,
          nomes: t.inscritos.map((i) => primeiroNome(i.nome)),
        };
      })
      .filter((t) => t.faltam > 0);
    return NextResponse.json({
      loja: { nome: loja?.storeName || loja?.name || "Loja", logo: loja?.storeLogo || null },
      hoje: l.agora.data,
      regras: {
        linkAtivo: l.config.linkAtivo, prazoInscricaoHoras: l.config.prazoInscricaoHoras,
        permiteDesistir: l.config.permiteDesistir, prazoDesistenciaHoras: l.config.prazoDesistenciaHoras,
      },
      turnos: abertos,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return respostaDoErro(err, "GET link");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  try {
    const ip = getClientIp(req);
    const corpo = await lerCorpo(req);
    const acao = String(corpo.acao || "");
    if (!checkRateLimit(`escala-link-${acao}:${ip}`, { windowMs: 60_000, maxRequests: acao === "identificar" ? 20 : 15 }).allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Espere um minuto." }, { status: 429 });
    }
    const { codigo } = await params;
    const l = await lojaDoLink(codigo);

    if (acao === "desistir") {
      await desistirPeloLink(l.lojaId, String(corpo.inscricaoId || ""), String(corpo.chave || ""), (t) => desistenciaAberta(t, l.agora, l.config));
      return NextResponse.json({ ok: true });
    }

    const telefone = String(corpo.telefone || "").slice(0, 30);
    if (!telefoneUtilizavel(telefone)) return NextResponse.json({ error: "Digite o seu WhatsApp com DDD (ex.: 22 99999-1234)." }, { status: 400 });
    let pessoa = await quemTemOTelefone(l.lojaId, telefone);
    if (pessoa && !pessoa.ativo) throw new ErroDaEscala("O seu cadastro na escala desta loja está desativado. Fale com a loja.", 403);

    if (acao === "identificar") {
      if (!pessoa) return NextResponse.json({ conhecido: false });
      const minhas = await inscricoesDaPessoa(l.lojaId, pessoa, l.agora.data);
      return NextResponse.json({
        conhecido: true,
        pessoa: { nome: primeiroNome(pessoa.nome), tipo: ROTULO[pessoa.tipo] },
        pix: pixVisivel(pessoa),
        inscricoes: minhas
          .filter((t) => !turnoJaTerminou(t, l.agora))
          .map((t) => ({ inscricaoId: t.inscricaoId, turnoId: t.id, data: t.data, inicio: t.inicio, fim: t.fim, funcao: t.funcao, podeDesistir: desistenciaAberta(t, l.agora, l.config) })),
      });
    }

    if (acao === "pix") {
      if (!pessoa) return NextResponse.json({ error: "Primeiro se inscreva em um turno.", codigo: "PRECISA_NOME" }, { status: 400 });
      const lida = lerChavePix(corpo.pix, corpo.pixTipo);
      if (!lida.ok) return NextResponse.json({ error: lida.erro, codigo: "PIX_INVALIDO" }, { status: 400 });
      if (pessoa.pix !== lida.chave) {
        // Trocar a chave de quem já tem: só do aparelho que se inscreveu (ninguém
        // troca o Pix do colega digitando o telefone dele).
        if (pessoa.pix && !(await aparelhoDaPessoa(l.lojaId, pessoa, Array.isArray(corpo.chaves) ? corpo.chaves : []))) {
          throw new ErroDaEscala("Para trocar a chave Pix, use o celular em que você se inscreveu — ou peça para a loja trocar.", 403, "OUTRO_APARELHO");
        }
        await gravarPixPeloLink(l.lojaId, pessoa, lida.chave, lida.tipo, !!pessoa.pix);
      }
      return NextResponse.json({ ok: true, pix: pixVisivel({ pix: lida.chave, pixTipo: lida.tipo }) });
    }

    if (acao !== "inscrever") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    if (!l.config.linkAtivo) throw new ErroDaEscala("A loja fechou as inscrições pelo link.", 409);

    // O Pix que veio junto: obrigatório para quem é novo; para quem já é da loja
    // e ainda não tem, grava (quem já tem não troca por aqui — é pela ação "pix").
    const temPix = String(corpo.pix ?? "").trim() !== "";
    const pix = temPix ? lerChavePix(corpo.pix, corpo.pixTipo) : null;
    if (pix && !pix.ok) return NextResponse.json({ error: pix.erro, codigo: "PIX_INVALIDO" }, { status: 400 });

    if (!pessoa) {
      // Pessoa nova: vira freelancer "veio pelo link" — com nome, função e Pix.
      const nome = String(corpo.nome || "").trim();
      const funcao = normalizarFuncao(String(corpo.funcao || ""));
      if (nome.length < 2) return NextResponse.json({ error: "Escreva o seu nome.", codigo: "PRECISA_NOME" }, { status: 400 });
      if (!funcao) return NextResponse.json({ error: "Escolha a sua função.", codigo: "PRECISA_NOME" }, { status: 400 });
      if (!pix?.ok) return NextResponse.json({ error: "Digite a sua chave Pix — é por ela que a loja te paga.", codigo: "PRECISA_PIX" }, { status: 400 });
      try {
        await salvarFreelancer(l.lojaId, { nome, telefone, funcao, pix: pix.chave, pixTipo: pix.tipo }, { origem: "link", podeVerDiaria: false });
      } catch (err) {
        // Dois toques ao mesmo tempo: o outro já criou — segue com ele.
        if (!(err instanceof ErroDaEscala && err.status === 409)) throw err;
      }
      pessoa = await quemTemOTelefone(l.lojaId, telefone);
      if (!pessoa) throw new ErroDaEscala("Não deu para cadastrar agora. Tente de novo.", 500);
    } else if (pix?.ok && !pessoa.pix) {
      await gravarPixPeloLink(l.lojaId, pessoa, pix.chave, pix.tipo, false);
      pessoa = { ...pessoa, pix: pix.chave, pixTipo: pix.tipo };
    }

    const r = await inscrever(l.lojaId, String(corpo.turnoId || ""), { tipo: pessoa.tipo, id: pessoa.id, nome: pessoa.nome }, {
      origem: "link", comChave: true, semSobreposicao: true,
      conferir: (t) => {
        if (!funcaoNoLink(t.funcao, l.config.funcoesNoLink)) throw new ErroDaEscala("Este turno não está aberto pelo link.", 409);
        if (!inscricaoAberta(t, l.agora, l.config)) throw new ErroDaEscala("As inscrições para este turno já fecharam.", 409);
      },
    });
    return NextResponse.json({
      ok: true, inscricaoId: r.id, chave: r.chave,
      pessoa: { nome: primeiroNome(pessoa.nome), tipo: ROTULO[pessoa.tipo] },
      pix: pixVisivel(pessoa),
      turno: { data: r.turno.data, inicio: r.turno.inicio, fim: r.turno.fim, funcao: r.turno.funcao },
    });
  } catch (err) {
    if (err instanceof ErroDaEscala && err.codigo === "JA_INSCRITO") {
      return NextResponse.json({ error: "Você já está inscrito neste turno.", codigo: err.codigo }, { status: 409 });
    }
    return respostaDoErro(err, "POST link");
  }
}
