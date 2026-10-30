/**
 * BILL NA ENTREGA POR BAIRRO — "muda a taxa do bairro Vivendas Bela Vista para
 * 13 reais", "quanto está a entrega de cada bairro?", "começa a entregar no
 * Morada do Sol por 9", "não entrego mais no Centro".
 *
 * Douglas, 29/10/2026: "o Bill, seu assessor, tem que conseguir mudar taxa de
 * bairro, controlar toda a loja que o cliente pedir".
 *
 * Grava pelo MESMO caminho da tela de Entrega (DeliveryZoneMap → PUT
 * api/store-settings): a lista inteira passa por `cadastroParaGravar`
 * (lib/cadastro-da-entrega.ts, a validação da tela e da rota) e vai para
 * `deliveryZoneType` + `deliveryZones` da loja; depois esquece o ponto da loja
 * em cache, como a rota. Como a tela (montarLista), o valor do motoboy por
 * bairro só atravessa com "um valor por bairro" ligado
 * (`repasseDoEntregador.separado`).
 *
 * Só loja que cobra POR BAIRRO (`modoDaArea` = BAIRRO, a leitura do motor).
 * Raio, km pela rua e área desenhada: só consulta — mudar é pela tela. Loja
 * sem área não ganha bairro pelo Bill: o primeiro bairro trocaria "entrega em
 * qualquer lugar" por "só neste bairro".
 *
 * O nome casa sem acento, caixa e "de/da/do", e pelos apelidos (`aliases`).
 * Não achou = nada muda e a resposta traz os parecidos para a IA perguntar;
 * nunca cadastra no lugar de alterar.
 *
 * Desfazer volta só o que o Bill mexeu (a taxa de antes, o bairro que saiu ou
 * entrou); o resto da lista, que o painel pode ter mudado depois, fica. Se o
 * mesmo bairro mudou de novo depois do Bill, não desfaz por aqui.
 *
 * Teste: scripts/teste-bill-taxa-de-bairro.ts
 */
import { prisma } from "@/lib/prisma";
import { cadastroParaGravar, formatarKm, formatarReais, lerValorDigitado, lerZonasGravadas } from "@/lib/cadastro-da-entrega";
import { modoDaArea, normalizarTexto } from "@/lib/area-de-entrega";
import { lerApelidos } from "@/lib/bairro-pelo-endereco";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { esquecerPontoDaLoja } from "@/lib/distancia-da-entrega";
import { atualizarVitrineDaLoja } from "@/lib/pausar-produtos";
import type { ContextoDoAssessor } from "./ferramentas";
import { comAutor } from "./painel";

type Loja = { deliveryZoneType: string | null; deliveryZones: unknown; deliveryConfig: unknown };
type Falha = { ok: false; erro: string; [k: string]: unknown };

const SO_BAIRRO = "Por enquanto o Bill só muda a taxa de loja que cobra por bairro; o resto é no painel, em Minha Loja › Entrega.";
const VALE_PARA = "Vale para os próximos pedidos do site, do robô e do balcão. iFood e outros apps cobram a taxa do app.";

const cent = (n: number) => Math.round(n * 100);
const taxaTxt = (n: number) => (cent(n) === 0 ? "grátis" : formatarReais(n));
/** "13", "13,50", "R$ 13", "13 reais" — o número que o dono disse. */
const lerTaxa = (v: unknown) => lerValorDigitado(typeof v === "string" ? v.replace(/reais|real/gi, "") : v);
const nomeDe = (z: any) => String(z?.name ?? z?.nome ?? "").replace(/\s+/g, " ").trim();

// ── O NOME DO BAIRRO ────────────────────────────────────────────────────────

const CONECTIVOS = new Set(["de", "da", "do", "das", "dos"]);
/** Palavras que muitos bairros têm: sozinhas não fazem dois nomes parecidos. */
const GENERICAS = new Set(["jardim", "vila", "parque", "residencial", "conjunto", "setor", "bairro", "loteamento", "condominio", "quadra"]);
const chave = (s: unknown) => normalizarTexto(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const chaveSolta = (s: unknown) => chave(s).split(" ").filter((p) => p && !CONECTIVOS.has(p)).join(" ");
const nomesDe = (z: any) => [nomeDe(z), ...lerApelidos(z)];
const exato = (lista: any[], nome: string) => lista.findIndex((z) => chave(nomeDe(z)) === chave(nome));

function semelhanca(a: string, b: string): number {
  const pares = (s: string) => { const t = s.replace(/ /g, ""); return Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)); };
  const pa = pares(a), resto = pares(b);
  if (!pa.length || !resto.length) return 0;
  const total = pa.length + resto.length;
  let comuns = 0;
  for (const p of pa) { const k = resto.indexOf(p); if (k >= 0) { comuns++; resto.splice(k, 1); } }
  // Palavra inteira em comum ("Bela Vista" e "Vivendas Bela Vista") conta mesmo com um nome bem maior que o outro.
  const palavra = a.split(" ").some((p) => p.length >= 4 && !GENERICAS.has(p) && b.split(" ").includes(p));
  return Math.max((2 * comuns) / total, palavra ? 0.5 : 0);
}

function parecidos(pedido: string, lista: any[]): string[] {
  const q = chaveSolta(pedido);
  return lista
    .map((z) => ({ nome: nomeDe(z), s: semelhanca(q, chaveSolta(nomeDe(z))) }))
    .filter((x) => x.nome && x.s >= 0.4)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.nome);
}

/** O bairro cadastrado que o dono nomeou: igual (sem acento/caixa, ou pelo apelido) e, se não, sem "de/da/do". Nunca chuta. */
function acharBairro(lista: any[], pedido: string): { indice: number } | { parecidos: string[] } {
  const q = chave(pedido), qs = chaveSolta(pedido);
  if (!q) return { parecidos: [] };
  const por = (casa: (n: string) => boolean) => lista.flatMap((z, i) => (nomesDe(z).some(casa) ? [i] : []));
  for (const achados of [por((n) => chave(n) === q), por((n) => chaveSolta(n) === qs)]) {
    if (achados.length === 1) return { indice: achados[0] };
    if (achados.length > 1) return { parecidos: achados.map((i) => nomeDe(lista[i])) };
  }
  return { parecidos: parecidos(pedido, lista) };
}

// ── LER E GRAVAR, PELO CAMINHO DA TELA ──────────────────────────────────────

async function lerLoja(franchiseeId: string): Promise<Loja | null> {
  return prisma.user.findUnique({ where: { id: franchiseeId }, select: { deliveryZoneType: true, deliveryZones: true, deliveryConfig: true } }) as Promise<Loja | null>;
}

function nomeDoMetodo(loja: Loja): string {
  const modo = modoDaArea(loja);
  if (modo === "BAIRRO") return "por bairro";
  if (modo === "KM") return String(loja.deliveryZoneType || "").toUpperCase() === "ROTA" ? "por km rodado (pela rua)" : "por distância (raio em km)";
  if (modo === "POLIGONO") return "por área desenhada no mapa";
  return "sem área de entrega cadastrada";
}

/** Os bairros gravados, lidos como a tela lê (lerZonasGravadas) — ou o motivo de não mexer. */
async function bairrosDaLoja(ctx: ContextoDoAssessor): Promise<{ ok: true; loja: Loja; bairros: any[] } | Falha> {
  const loja = await lerLoja(ctx.franchiseeId);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  if (modoDaArea(loja) !== "BAIRRO") {
    return { ok: false, metodo: nomeDoMetodo(loja), erro: `A entrega desta loja é ${nomeDoMetodo(loja)}, não por bairro. ${SO_BAIRRO}` };
  }
  const { zonas, ilegivel } = lerZonasGravadas(loja.deliveryZones);
  if (ilegivel) return { ok: false, erro: "Não consegui ler o cadastro de bairros desta loja. Mexa pelo painel, em Minha Loja › Entrega." };
  return { ok: true, loja, bairros: zonas.filter((z) => z && typeof z === "object").map((z) => ({ ...z })) };
}

async function gravar(ctx: ContextoDoAssessor, loja: Loja, lista: any[]): Promise<{ ok: true; avisos: string[] } | Falha> {
  const separado = lerRegraDeRepasse(loja.deliveryConfig).separado;
  const corpo = separado ? lista : lista.map(({ motoboyFee, repasse, repasseAcimaDaTaxa, ...z }: any) => z);
  const d = cadastroParaGravar({ tipo: loja.deliveryZoneType, zonas: loja.deliveryZones }, { deliveryZoneType: "NEIGHBORHOOD", deliveryZones: corpo });
  if (d.acao === "recusar") return { ok: false, erro: `${d.erro} Nada foi alterado.` };
  if (d.acao === "gravar") {
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { deliveryZoneType: d.tipo, deliveryZones: d.zonas as any } });
    esquecerPontoDaLoja(ctx.franchiseeId);
    await atualizarVitrineDaLoja(ctx.franchiseeId);
  }
  return { ok: true, avisos: d.acao === "gravar" ? d.avisos : [] };
}

async function registrar(ctx: ContextoDoAssessor, resumo: string, refs: Record<string, unknown>) {
  try {
    await prisma.assessorRegistro.create({
      data: { franchiseeId: ctx.franchiseeId, tipo: "ENTREGA", resumo: resumo.slice(0, 500), refs: comAutor(refs, ctx) as any, canal: ctx.canal, telefone: ctx.telefone || null },
    });
  } catch (err: any) {
    console.error("[Assessor] Não gravou o registro:", err?.message);
  }
}

// ── AS FERRAMENTAS ──────────────────────────────────────────────────────────

export async function consultarTaxasDeEntrega(args: any, ctx: ContextoDoAssessor) {
  const loja = await lerLoja(ctx.franchiseeId);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const { zonas } = lerZonasGravadas(loja.deliveryZones);
  const modo = modoDaArea(loja);
  const metodo = nomeDoMetodo(loja);
  const taxaDe = (z: any) => taxaTxt(lerValorDigitado(z?.fee) ?? 0);
  if (modo === "KM") {
    const km = (z: any) => Number(z?.km ?? z?.maxKm ?? z?.radius) || 0;
    const faixas = zonas.filter((z) => km(z) > 0).sort((a, b) => km(a) - km(b)).map((z) => ({ ate: `${formatarKm(km(z))} km`, taxa: taxaDe(z) }));
    return { ok: true, metodo, faixas, observacao: SO_BAIRRO };
  }
  if (modo === "POLIGONO") {
    return { ok: true, metodo, areas: zonas.filter((z) => z?.pontos).map((z) => ({ area: nomeDe(z) || "Área", taxa: taxaDe(z) })), observacao: SO_BAIRRO };
  }
  if (modo !== "BAIRRO") return { ok: true, metodo, observacao: `A loja não tem área de entrega cadastrada (atende qualquer endereço). ${SO_BAIRRO}` };

  const bairros = zonas.filter((z) => z && typeof z === "object" && nomeDe(z));
  const busca = chaveSolta(args?.busca || "");
  const achados = bairros.filter((z) => !busca || nomesDe(z).some((n) => chaveSolta(n).includes(busca)));
  return {
    ok: true,
    metodo,
    total: bairros.length,
    bairros: achados.map((z) => {
      const minimo = lerValorDigitado(z.minimo);
      return { bairro: nomeDe(z), taxa: taxaDe(z), tempo: `${Math.round(lerValorDigitado(z.time) ?? 0)} min`, ...(minimo ? { pedidoMinimo: formatarReais(minimo) } : {}) };
    }),
    ...(busca && !achados.length ? { observacao: "Nenhum bairro com esse nome.", parecidos: parecidos(String(args?.busca), bairros) } : {}),
  };
}

export async function alterarTaxaDeBairro(args: any, ctx: ContextoDoAssessor) {
  const pedidos: any[] = Array.isArray(args?.bairros) ? args.bairros : [];
  if (!pedidos.length) return { ok: false, erro: "Diga o bairro e a nova taxa." };
  const base = await bairrosDaLoja(ctx);
  if (!base.ok) return base;
  const lista = base.bairros;

  const naoAchados: { pedido: string; parecidos: string[] }[] = [];
  const mudancas = new Map<number, { bairro: string; antes: number; depois: number }>();
  const jaEstavam: string[] = [];
  for (const p of pedidos) {
    const nome = String(p?.nome || "").trim();
    const taxa = lerTaxa(p?.taxa);
    if (!nome) return { ok: false, erro: "Faltou o nome do bairro." };
    if (taxa == null) return { ok: false, erro: `Faltou a nova taxa do ${nome}: pergunte o valor (0 = entrega grátis).` };
    const achou = acharBairro(lista, nome);
    if ("parecidos" in achou) { naoAchados.push({ pedido: nome, parecidos: achou.parecidos }); continue; }
    const z = lista[achou.indice];
    const antes = mudancas.get(achou.indice)?.antes ?? lerValorDigitado(z.fee) ?? 0;
    if (cent(antes) === cent(taxa)) { mudancas.delete(achou.indice); jaEstavam.push(nomeDe(z)); z.fee = antes; continue; }
    z.fee = taxa;
    if (args?.confirmarMotoboyAcimaDaTaxa === true) z.repasseAcimaDaTaxa = true;
    mudancas.set(achou.indice, { bairro: nomeDe(z), antes, depois: cent(taxa) / 100 });
  }
  if (naoAchados.length) {
    return {
      ok: false,
      erro: `Não achei ${naoAchados.map((n) => `"${n.pedido}"`).join(", ")} entre os bairros cadastrados — nada foi alterado. Pergunte qual dos parecidos ele quis dizer (ou se é bairro novo, para cadastrar). Não cadastre sem ele dizer.`,
      naoAchados,
    };
  }
  if (!mudancas.size) return { ok: true, alterados: [], jaEstavamAssim: jaEstavam, observacao: "A taxa já era essa; nada mudou." };

  const g = await gravar(ctx, base.loja, lista);
  if (!g.ok) return g;
  const feitas = [...mudancas.values()];
  await registrar(ctx, `Taxa de entrega: ${feitas.map((m) => `${m.bairro} ${taxaTxt(m.antes)} → ${taxaTxt(m.depois)}`).join("; ")}`, { acao: "ALTERAR", bairros: feitas });
  return {
    ok: true,
    alterados: feitas.map((m) => ({ bairro: m.bairro, antes: taxaTxt(m.antes), agora: taxaTxt(m.depois) })),
    ...(jaEstavam.length ? { jaEstavamAssim: jaEstavam } : {}),
    ...(g.avisos.length ? { avisos: g.avisos } : {}),
    observacao: VALE_PARA,
  };
}

export async function cadastrarBairro(args: any, ctx: ContextoDoAssessor) {
  const nome = String(args?.nome || "").replace(/\s+/g, " ").trim();
  if (!nome) return { ok: false, erro: "Diga o nome do bairro." };
  const taxa = lerTaxa(args?.taxa);
  if (taxa == null) return { ok: false, erro: `Faltou a taxa do ${nome}: pergunte o valor (0 = entrega grátis).` };
  const base = await bairrosDaLoja(ctx);
  if (!base.ok) return base;
  const achou = acharBairro(base.bairros, nome);
  if ("indice" in achou) {
    const z = base.bairros[achou.indice];
    return { ok: false, erro: `O bairro ${nomeDe(z)} já está cadastrado (${taxaTxt(lerValorDigitado(z.fee) ?? 0)}). Para mudar a taxa, use alterar_taxa_de_bairro.` };
  }
  // Sem tempo dito, o do último bairro — o mesmo que o "Adicionar bairro" da tela põe.
  const tempoDito = lerValorDigitado(args?.tempo);
  const tempo = tempoDito ?? lerValorDigitado(base.bairros[base.bairros.length - 1]?.time) ?? 40;
  const motoboy = lerTaxa(args?.motoboyRecebe);
  const novo = {
    name: nome, fee: taxa, time: tempo,
    ...(motoboy != null ? { motoboyFee: motoboy } : {}),
    ...(args?.confirmarMotoboyAcimaDaTaxa === true ? { repasseAcimaDaTaxa: true } : {}),
  };
  const g = await gravar(ctx, base.loja, [...base.bairros, novo]);
  if (!g.ok) return g;
  const resumo = `Bairro novo na entrega: ${nome} — ${taxaTxt(taxa)}, ${Math.round(tempo)} min`;
  await registrar(ctx, resumo, { acao: "CADASTRAR", nome });
  return {
    ok: true,
    bairro: nome,
    taxa: taxaTxt(taxa),
    tempo: `${Math.round(tempo)} min${tempoDito == null ? " (o mesmo do último bairro; diga se for outro)" : ""}`,
    ...(achou.parecidos.length ? { parecidosJaCadastrados: achou.parecidos } : {}),
    ...(g.avisos.length ? { avisos: g.avisos } : {}),
    observacao: VALE_PARA,
  };
}

export async function removerBairro(args: any, ctx: ContextoDoAssessor) {
  const nome = String(args?.nome || "").trim();
  if (!nome) return { ok: false, erro: "Diga o nome do bairro." };
  const base = await bairrosDaLoja(ctx);
  if (!base.ok) return base;
  const achou = acharBairro(base.bairros, nome);
  if ("parecidos" in achou) {
    return { ok: false, erro: `Não achei "${nome}" entre os bairros cadastrados — nada foi removido. Pergunte qual dos parecidos ele quis dizer.`, parecidos: achou.parecidos };
  }
  const saiu = base.bairros[achou.indice];
  const g = await gravar(ctx, base.loja, base.bairros.filter((_, i) => i !== achou.indice));
  if (!g.ok) return g;
  const era = taxaTxt(lerValorDigitado(saiu.fee) ?? 0);
  await registrar(ctx, `Bairro removido da entrega: ${nomeDe(saiu)} (era ${era})`, { acao: "REMOVER", bairro: saiu, posicao: achou.indice });
  return { ok: true, bairro: nomeDe(saiu), eraTaxa: era, observacao: "Endereço desse bairro passa a ficar fora da área de entrega do site e do robô." };
}

/** O "desfaz" de um registro ENTREGA: volta só o que o Bill mexeu. */
export async function desfazerNaEntrega(refs: any, ctx: ContextoDoAssessor): Promise<{ ok: true } | Falha> {
  const base = await bairrosDaLoja(ctx);
  if (!base.ok) return { ok: false, erro: `A entrega mudou depois: ${base.erro}` };
  const lista = base.bairros;
  const PELO_PAINEL = "desfaça pelo painel, em Minha Loja › Entrega.";
  if (refs?.acao === "ALTERAR") {
    for (const b of refs.bairros || []) {
      const i = exato(lista, b.bairro);
      if (i < 0) return { ok: false, erro: `O bairro ${b.bairro} não está mais cadastrado; ${PELO_PAINEL}` };
      const agora = lerValorDigitado(lista[i].fee);
      if (agora == null || cent(agora) !== cent(Number(b.depois))) {
        return { ok: false, erro: `A taxa do ${b.bairro} foi mudada de novo depois (agora ${taxaTxt(agora ?? 0)}); ${PELO_PAINEL}` };
      }
      lista[i].fee = Number(b.antes);
    }
  } else if (refs?.acao === "CADASTRAR") {
    const i = exato(lista, refs.nome);
    if (i < 0) return { ok: false, erro: `O bairro ${refs.nome} já não está cadastrado.` };
    lista.splice(i, 1);
  } else if (refs?.acao === "REMOVER") {
    if (exato(lista, nomeDe(refs.bairro)) >= 0) return { ok: false, erro: `O bairro ${nomeDe(refs.bairro)} já voltou para a lista.` };
    lista.splice(Math.min(Math.max(0, Number(refs.posicao) || 0), lista.length), 0, refs.bairro);
  } else {
    return { ok: false, erro: "Esse lançamento não se desfaz por aqui." };
  }
  const g = await gravar(ctx, base.loja, lista);
  return g.ok ? { ok: true } : g;
}
