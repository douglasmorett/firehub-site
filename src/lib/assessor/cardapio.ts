/**
 * BILL NO CARDÁPIO E NA PORTA DA LOJA — "acabou a esfirra de frango, pausa",
 * "abre de novo", "quais itens estão pausados?", "fecha o site".
 *
 * Douglas, 14/10/2026: "ele literalmente vai controlar a loja dele pelo
 * WhatsApp — isso faz valer os 29,90".
 *
 * Pausar é o mesmo `MenuProduct.active` do ⏸ do painel (PUT
 * api/admin/menu-products), pela função de lib/pausar-produtos.ts: vale para o
 * item avulso e para a opção dentro de todo combo, em todos os canais
 * (lib/opcao-pausada.ts), pausa a meia pizza do mesmo sabor e atualiza a
 * vitrine na hora (o cache é de 60 s). Espelho de marketplace fica de fora: o iFood tem o
 * cardápio dele.
 *
 * Fechar o site é o `storeOpen` do botão "Site" do topo. O iFood NÃO fecha por
 * aqui (a interrupção é pela tela) — a resposta avisa.
 */
import { prisma } from "@/lib/prisma";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { PREFIXO_DA_MEIA } from "@/lib/meio-a-meio";
import { atualizarVitrineDaLoja, mudarPausaDosProdutos } from "@/lib/pausar-produtos";
import { esquecerPausaPeloEstoque } from "@/lib/pausa-pelo-estoque-no-banco";
import type { ContextoDoAssessor } from "./ferramentas";

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** Produtos da própria loja (sem espelho de marketplace e sem a meia, que acompanha o sabor). */
async function produtosDaLoja(franchiseeId: string) {
  return prisma.menuProduct.findMany({
    where: { franchiseeId, AND: [SEM_PRODUTO_DE_INTEGRACAO, { NOT: { name: { startsWith: PREFIXO_DA_MEIA } } }] },
    select: { id: true, name: true, category: true, active: true, price: true, isCombo: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

const atualizarVitrine = atualizarVitrineDaLoja;

export async function buscarNoCardapio(args: any, ctx: ContextoDoAssessor) {
  const palavras = semAcento(String(args?.busca || "")).split(/\s+/).filter((p) => p.length > 1);
  if (!palavras.length) return { ok: false, erro: "Diga o nome do item." };
  const todos = await produtosDaLoja(ctx.franchiseeId);
  // Todas as palavras no nome (ou na categoria): "esfirra frango" acha
  // "Esfirra de Frango" e "Esfirra de Frango c/ Catupiry".
  const achados = todos.filter((p) => {
    const alvo = semAcento(`${p.name} ${p.category || ""}`);
    return palavras.every((w) => alvo.includes(w.replace(/s$/, "")));
  });
  return {
    ok: true,
    itens: achados.slice(0, 40).map((p) => ({
      id: p.id, nome: p.name, categoria: p.category, situacao: p.active ? "à venda" : "PAUSADO", preco: reais(p.price), combo: p.isCombo || undefined,
    })),
    observacao: achados.length === 0 ? "Nada com esse nome no cardápio." : achados.length > 40 ? `Mostrando 40 de ${achados.length}; peça para ser mais específico.` : undefined,
  };
}

export async function pausarOuReativar(args: any, ctx: ContextoDoAssessor) {
  const ids: string[] = Array.isArray(args?.produtoIds) ? args.produtoIds.map(String).filter(Boolean) : [];
  const ativo = args?.ativo === true;
  if (!ids.length) return { ok: false, erro: "Nenhum item escolhido: use buscar_no_cardapio antes." };

  const daLoja = (await produtosDaLoja(ctx.franchiseeId)).filter((p) => ids.includes(p.id));
  if (!daLoja.length) return { ok: false, erro: "Esses itens não são do cardápio desta loja." };
  const mudar = daLoja.filter((p) => p.active !== ativo);
  const jaEstavam = daLoja.filter((p) => p.active === ativo).map((p) => p.name);

  if (mudar.length) {
    // Mesma função do painel e da pausa pelo estoque (lib/pausar-produtos.ts):
    // leva a meia pizza do mesmo sabor e atualiza a vitrine na hora.
    await mudarPausaDosProdutos(ctx.franchiseeId, mudar.map((p) => p.id), ativo);
    // O dono decidiu na mão: a pausa deixa de ser "do estoque" e o estoque não
    // reativa sozinho o que ele pausou.
    await esquecerPausaPeloEstoque(ctx.franchiseeId, mudar.map((p) => p.id));
    const nomes = mudar.map((p) => p.name);
    const resumo = `${ativo ? "Reativado" : "Pausado"} no cardápio: ${nomes.join(", ")}`;
    try {
      await prisma.assessorRegistro.create({
        data: { franchiseeId: ctx.franchiseeId, tipo: ativo ? "REATIVADO" : "PAUSADO", resumo: resumo.slice(0, 500), refs: { ids: mudar.map((p) => p.id), ativo } as any, canal: ctx.canal, telefone: ctx.telefone || null },
      });
    } catch {}
  }
  return {
    ok: true,
    [ativo ? "reativados" : "pausados"]: mudar.map((p) => p.name),
    jaEstavamAssim: jaEstavam.length ? jaEstavam : undefined,
    observacao: ativo ? "Já aparece de novo no site, robô, balcão e totem." : "Some do site, robô, balcão e totem — e de dentro dos combos. O iFood tem o cardápio dele: pausar lá pelo app do iFood.",
  };
}

export async function listarPausados(_args: any, ctx: ContextoDoAssessor) {
  const pausados = (await produtosDaLoja(ctx.franchiseeId)).filter((p) => !p.active);
  const porCategoria: Record<string, string[]> = {};
  for (const p of pausados) (porCategoria[p.category || "Sem categoria"] ||= []).push(p.name);
  return { ok: true, total: pausados.length, porCategoria };
}

export async function abrirOuFecharSite(args: any, ctx: ContextoDoAssessor) {
  const aberto = args?.aberto === true;
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeOpen: true } });
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  if (loja.storeOpen === aberto) return { ok: true, observacao: `O site já estava ${aberto ? "aberto" : "fechado"}.` };
  await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeOpen: aberto } });
  await atualizarVitrine(ctx.franchiseeId);
  const resumo = aberto ? "Site aberto" : "Site fechado";
  try {
    await prisma.assessorRegistro.create({
      data: { franchiseeId: ctx.franchiseeId, tipo: "SITE", resumo, refs: { anterior: loja.storeOpen } as any, canal: ctx.canal, telefone: ctx.telefone || null },
    });
  } catch {}
  return {
    ok: true,
    site: aberto ? "ABERTO" : "FECHADO",
    observacao: aberto ? "Site e robô voltam a aceitar pedido." : "Site e robô param de aceitar pedido. iFood e 99 continuam abertos: feche pelo app deles ou pelo botão Site do painel (que pausa o iFood junto).",
  };
}

/** Desfaz uma pausa/reativação ou a abertura/fechamento do site. */
export async function desfazerNoCardapio(tipo: string, refs: any, ctx: ContextoDoAssessor) {
  if (tipo === "PAUSADO" || tipo === "REATIVADO") {
    const voltaPara = !refs.ativo;
    const ids: string[] = refs.ids || [];
    await mudarPausaDosProdutos(ctx.franchiseeId, ids, voltaPara);
    await esquecerPausaPeloEstoque(ctx.franchiseeId, ids);
  } else if (tipo === "SITE") {
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeOpen: Boolean(refs.anterior) } });
  }
  await atualizarVitrine(ctx.franchiseeId);
}
