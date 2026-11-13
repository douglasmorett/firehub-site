/**
 * PUT { produtoId, unidade, eans, plu, ncmConferido? } — unidade e códigos de um
 * produto (a conferência do cadastro na tela de importação). EAN com dígito
 * errado é recusado.
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { aplicarPlanilha, salvarCodigosDoProduto } from "@/lib/caixa-mercado/importar";
import { eanValido } from "@/lib/caixa-mercado/etiqueta";
import { resumoDaSenha, senhaAtualConfere } from "@/lib/senha-do-gerente";
import { CABECALHO_DA_SENHA, CODIGO_SENHA_PEDIDA, senhaDoCabecalho } from "@/lib/senha-do-gerente-regras";

export const dynamic = "force-dynamic";

/**
 * POST { nome, codigo, precoCentavos, unidade, ncm? } — cadastra UM produto já
 * com o código de barras (chegou mercadoria nova: bipa e cadastra). Vem do caixa
 * (?de=caixa, ao bipar um código que não existe) ou da tela de importação. No
 * caixa pede a senha do gerente, quando a loja tem uma — quem está no caixa não
 * cria produto com o preço que quiser. Usa a mesma gravação da planilha: nome
 * igual a um produto que já existe liga o código a ele em vez de duplicar.
 */
export async function POST(req: Request) {
  const doCaixa = new URL(req.url).searchParams.get("de") === "caixa";
  const ctx = await contextoDoCaixa(doCaixa ? { exigirTerminal: true } : { tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  if (doCaixa) {
    const { temSenha } = await resumoDaSenha(ctx.quem.lojaId);
    if (temSenha) {
      const senha = senhaDoCabecalho(req.headers.get(CABECALHO_DA_SENHA));
      if (!senha) return NextResponse.json({ error: "Cadastrar produto no caixa pede a senha do gerente.", codigo: CODIGO_SENHA_PEDIDA, acao: "cancelarPedido" }, { status: 403 });
      const r = await senhaAtualConfere(ctx.quem.lojaId, senha);
      if (!r.ok) return NextResponse.json({ error: r.error, codigo: r.codigo, restam: r.restam }, { status: r.status });
    }
  }
  const corpo: any = await req.json().catch(() => ({}));
  const nome = String(corpo?.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const codigo = String(corpo?.codigo ?? "").replace(/\D/g, "");
  const preco = Math.round(Number(corpo?.precoCentavos));
  const ncm = String(corpo?.ncm ?? "").replace(/\D/g, "");
  if (!nome) return NextResponse.json({ error: "Escreva o nome do produto." }, { status: 400 });
  if (!codigo) return NextResponse.json({ error: "Bipe ou digite o código de barras." }, { status: 400 });
  if (codigo.length >= 8 && !eanValido(codigo)) return NextResponse.json({ error: `O código ${codigo} tem o dígito verificador errado. Bipe de novo.` }, { status: 400 });
  if (!Number.isFinite(preco) || preco <= 0) return NextResponse.json({ error: "Informe o preço de venda." }, { status: 400 });
  if (ncm && ncm.length !== 8) return NextResponse.json({ error: "O NCM tem 8 números (pode deixar em branco)." }, { status: 400 });
  try {
    const r = await aplicarPlanilha(ctx.quem.lojaId, [{
      linha: 1, codigos: [codigo], descricao: nome, precoCentavos: preco, unidade: corpo?.unidade === "KG" ? "KG" : "UN",
      ncm: ncm || null, cest: null, estoque: null, custoCentavos: null, categoria: null, plu: null, avisos: [],
    }]);
    return NextResponse.json({ ok: true, criado: r.criados > 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu para cadastrar." }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const corpo: any = await req.json().catch(() => ({}));
  const eans = (Array.isArray(corpo?.eans) ? corpo.eans : []).map((e: unknown) => String(e ?? "").replace(/\D/g, "")).filter(Boolean);
  const errado = eans.find((e: string) => e.length >= 8 && !eanValido(e));
  if (errado) return NextResponse.json({ error: `O código ${errado} tem o dígito verificador errado.` }, { status: 400 });
  const plu = String(corpo?.plu ?? "").replace(/\D/g, "");
  try {
    await salvarCodigosDoProduto(ctx.quem.lojaId, String(corpo?.produtoId || ""), {
      unidade: corpo?.unidade === "KG" ? "KG" : "UN",
      eans,
      plu: plu ? String(Number(plu)) : null,
      ncmConferido: corpo?.ncmConferido === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu para salvar." }, { status: 400 });
  }
}
