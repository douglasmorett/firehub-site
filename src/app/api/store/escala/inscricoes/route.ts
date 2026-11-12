/**
 * POST /api/store/escala/inscricoes — o painel encaixa alguém no turno.
 *   { turnoId, pessoaTipo, pessoaId }          quem já está na lista (equipe, motoboy, freelancer)
 *   { turnoId, novoFreelancer: { nome, telefone?, funcao? } }   cadastra na hora e encaixa
 *   aumentarVaga: true                          turno cheio — abre mais uma vaga e encaixa
 */
import { NextResponse } from "next/server";
import { ErroDaEscala, inscrever, pessoasDaLoja, salvarFreelancer } from "@/lib/escala-da-equipe/banco";
import { ehTipoDePessoa } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const corpo = await lerCorpo(req);
    const turnoId = String(corpo.turnoId || "");
    if (!turnoId) return NextResponse.json({ error: "Turno não informado." }, { status: 400 });

    let pessoaTipo = String(corpo.pessoaTipo || ""), pessoaId = String(corpo.pessoaId || "");
    const novo = corpo.novoFreelancer as Record<string, unknown> | undefined;
    if (novo && typeof novo === "object") {
      pessoaTipo = "freelancer";
      pessoaId = await salvarFreelancer(s.lojaId, novo, { podeVerDiaria: s.ehDono });
    }
    if (!ehTipoDePessoa(pessoaTipo) || !pessoaId) return NextResponse.json({ error: "Escolha quem vai no turno." }, { status: 400 });
    // A pessoa tem de ser DESTA loja e estar ativa — o id veio do navegador.
    const pessoa = (await pessoasDaLoja(s.lojaId)).find((p) => p.tipo === pessoaTipo && p.id === pessoaId);
    if (!pessoa) return NextResponse.json({ error: "Pessoa não encontrada (ou desativada)." }, { status: 404 });

    try {
      const r = await inscrever(s.lojaId, turnoId, { tipo: pessoa.tipo, id: pessoa.id, nome: pessoa.nome }, {
        origem: "painel", quem: s.quem, aumentarVaga: corpo.aumentarVaga === true,
      });
      return NextResponse.json({ ok: true, id: r.id });
    } catch (err) {
      // Turno cheio com freelancer recém-cadastrado: a tela pergunta "abrir mais
      // uma vaga?" e reenvia com o id dele — sem cadastrar a mesma pessoa de novo.
      if (err instanceof ErroDaEscala && err.codigo === "CHEIO") {
        return NextResponse.json({ error: err.message, codigo: err.codigo, pessoaTipo: pessoa.tipo, pessoaId: pessoa.id }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    return respostaDoErro(err, "POST inscrição");
  }
}
