import { prisma } from "@/lib/prisma";
import { minutoDaLoja, motivoForaDoCardapio, textoDoHorario } from "@/lib/cardapio-interno";
import { ordemDasCategorias, ordenarComoALoja } from "@/lib/cardapio-da-loja";
import { precoDaOpcao, precoDeTabelaDoCanal, precoDoCanal, promocaoDaOpcao, promocaoDoCanal } from "@/lib/preco-por-canal";

/**
 * O CARDÁPIO DA LOJA, COMO O SUPORTE VÊ — a ferramenta ver_cardapio_da_loja do
 * robô do FireHub. Só leitura.
 *
 * Douglas, 03/10/2026: o robô tem de ser "tão capaz quanto nosso atendente".
 * Um atendente de verdade, quando a Serpa diz "pus 65 na promoção e ficou 95",
 * abre o produto e olha. Sem isto o robô adivinhava o preço do produto (e
 * errava a conta), e para a Luxúria ("a marmita não aparece") listava causas
 * possíveis em vez de dizer "ela só aparece das 10h às 14h, e agora são 9h40
 * aí".
 *
 * Os preços saem PRONTOS (conta feita aqui, não pelo modelo): o flash erra
 * aritmética e número errado é pior que nenhum. Só o canal delivery (o
 * cardápio do cliente); preço diferente por canal aparece como aviso.
 */

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const relogio = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Palavras que não ajudam a achar o produto ("a pizza de filé mignon" → "pizza", "file", "mignon"). */
const VAZIAS = new Set(["a", "o", "as", "os", "de", "do", "da", "dos", "das", "e", "com", "sem", "no", "na", "um", "uma", "meu", "minha", "produto", "item"]);

const SELECT = {
  id: true, name: true, category: true, price: true, promoPrice: true, priceSalao: true, priceDelivery: true, priceTotem: true,
  active: true, activePDV: true, activeDelivery: true, activeTotem: true, activeGarcom: true, availableDays: true, availableHours: true,
  isCombo: true, apenasEmCombo: true, estoqueQtd: true, estoquePausar: true,
} as const;

type Produto = {
  id: string; name: string; category: string; price: number; promoPrice: number | null;
  priceSalao: number | null; priceDelivery: number | null; priceTotem: number | null;
  active: boolean; activePDV: boolean; activeDelivery: boolean; activeTotem: boolean; activeGarcom: boolean;
  availableDays: string | null; availableHours: string | null; isCombo: boolean; apenasEmCombo: boolean;
  estoqueQtd: number | null; estoquePausar: boolean | null;
};

const NOME_DO_DIA: Record<string, string> = { SEG: "segunda", TER: "terça", QUA: "quarta", QUI: "quinta", SEX: "sexta", SAB: "sábado", DOM: "domingo" };
function diasDoProduto(availableDays: unknown): string {
  try {
    const dias = typeof availableDays === "string" ? JSON.parse(availableDays) : availableDays;
    return Array.isArray(dias) && dias.length ? dias.map((d) => NOME_DO_DIA[String(d).toUpperCase()] || d).join(", ") : "todos os dias";
  } catch {
    return "?";
  }
}

/** Por que o produto não aparece agora no cardápio do cliente (delivery), ou null. */
function situacao(p: Produto, fuso: string, agora: Date): string {
  const motivos: string[] = [];
  if (!p.active) motivos.push("PAUSADO (⏸)");
  if (!p.activeDelivery) motivos.push("canal Delivery DESLIGADO (some do cardápio do cliente)");
  if (p.apenasEmCombo) motivos.push("só aparece dentro de combo/pergunta");
  const fora = motivoForaDoCardapio(p, fuso, agora);
  if (fora === "horario") motivos.push(`FORA DO HORÁRIO agora (só ${textoDoHorario(p.availableHours)}, hora da loja)`);
  if (fora === "dia") motivos.push(`FORA DO DIA hoje (Dias de Disponibilidade: só ${diasDoProduto(p.availableDays)})`);
  if (motivos.length) return `não aparece agora: ${motivos.join("; ")}`;
  const horario = textoDoHorario(p.availableHours);
  return `aparece agora no cardápio${horario ? ` (só ${horario})` : ""}`;
}

export type CardapioParaOSuporte = {
  loja: string;
  horaDaLoja: string;
  fuso: string;
  ordemDasCategorias: string[];
  produtos: string[];
  aviso?: string;
};

export async function cardapioParaOSuporte(userId: string, busca: string, agora = new Date()): Promise<CardapioParaOSuporte | null> {
  const loja = await prisma.user.findUnique({ where: { id: userId }, select: { storeName: true, name: true, storeTimezone: true } });
  if (!loja) return null;
  const fuso = loja.storeTimezone || "America/Sao_Paulo";

  const [todos, ordem] = await Promise.all([
    prisma.menuProduct.findMany({ where: { franchiseeId: userId }, select: SELECT }) as Promise<Produto[]>,
    ordemDasCategorias(userId),
  ]);
  const categorias = [...new Set(ordenarComoALoja(todos, ordem).map((p) => p.category))];

  // ── Achar os produtos: palavras da busca no nome (pesa mais) ou na categoria ──
  const palavras = norm(busca).split(" ").filter((p) => p.length >= 2 && !VAZIAS.has(p));
  const pontos = (p: Produto) => {
    const nome = ` ${norm(p.name)} `;
    const cat = ` ${norm(p.category)} `;
    let n = 0;
    for (const w of palavras) {
      if (nome.includes(` ${w} `)) n += 3;
      else if (nome.includes(w)) n += 2;
      else if (cat.includes(w)) n += 1;
    }
    return n;
  };
  const achados = palavras.length
    ? todos
        .map((p) => ({ p, n: pontos(p), agora: p.active && p.activeDelivery && !p.apenasEmCombo && !motivoForaDoCardapio(p, fuso, agora) }))
        .filter((x) => x.n > 0)
        // Empate: o que o cliente vê agora primeiro (a marmita do dia antes das outras cinco).
        .sort((a, b) => b.n - a.n || Number(b.agora) - Number(a.agora) || Number(b.p.active) - Number(a.p.active))
    : [];
  const melhor = achados[0]?.n || 0;
  const escolhidos = achados.filter((x) => x.n >= melhor * 0.75).slice(0, 6).map((x) => x.p);

  // ── As perguntas de cada um, com o preço já somado ─────────────────────────
  const grupos = escolhidos.length
    ? await prisma.comboGroup.findMany({
        where: { menuProductId: { in: escolhidos.map((p) => p.id) } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          menuProductId: true, title: true, minQty: true, maxQty: true, priceRule: true,
          items: {
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              additionalPrice: true, additionalPriceDelivery: true, promoAdditionalPrice: true, precoPorEscolha: true,
              menuProduct: { select: { name: true, active: true } },
            },
          },
        },
      })
    : [];

  const produtos = escolhidos.map((p) => {
    // As contas do cardápio do cliente (lib/preco-por-canal), não uma cópia delas.
    const promoDoProduto = promocaoDoCanal(p, "delivery");
    const base = precoDoCanal(p, "delivery");
    const linhas = [
      `■ ${p.name} — categoria "${p.category}"${p.isCombo ? " (combo)" : ""}`,
      `  Situação: ${situacao(p, fuso, agora)}.`,
      `  Preço de Venda: ${reais(p.price)}${p.promoPrice ? `; Preço promocional: ${reais(p.promoPrice)}${promoDoProduto === null ? " (NÃO VALE: não é menor que o preço)" : ""}` : ""}. No cardápio do cliente o produto sai ${reais(base)}${promoDoProduto !== null ? ` (riscado ${reais(precoDeTabelaDoCanal(p, "delivery"))})` : ""}.`,
    ];
    const porCanal = [p.priceSalao && `Balcão e mesa ${reais(p.priceSalao)}`, p.priceDelivery && `Delivery ${reais(p.priceDelivery)}`, p.priceTotem && `Totem ${reais(p.priceTotem)}`].filter(Boolean);
    if (porCanal.length) linhas.push(`  Preço diferente por canal: ${porCanal.join(", ")}.`);
    const canaisOff = [!p.activePDV && "PDV/Balcão", !p.activeDelivery && "Delivery", !p.activeTotem && "Totem", !p.activeGarcom && "Garçom"].filter(Boolean);
    if (canaisOff.length) linhas.push(`  Canais desligados: ${canaisOff.join(", ")}.`);
    if (p.estoqueQtd != null) linhas.push(`  Controla estoque (${p.estoqueQtd} cadastrados${p.estoquePausar ? ", pausa ao zerar" : ""}).`);

    for (const g of grupos.filter((x) => x.menuProductId === p.id)) {
      const regra = g.priceRule === "MAIOR" ? " — cobra o sabor mais caro" : g.priceRule === "MEDIA" ? " — cobra a média dos sabores" : "";
      linhas.push(`  ❓ Pergunta "${g.title}" (escolhe ${g.minQty === 0 ? "até " : ""}${g.maxQty})${regra}:`);
      const opcoes = g.items.slice(0, 30).map((i) => {
        const soma = precoDaOpcao(i, "delivery");
        const promo = i.promoAdditionalPrice;
        const promoVale = promocaoDaOpcao(i, "delivery") !== null;
        let t = `    - ${i.menuProduct?.name || "?"}${i.menuProduct && !i.menuProduct.active ? " [PAUSADA]" : ""}: +R$ ${soma.toFixed(2).replace(".", ",")}${soma < 0 ? " (desconta)" : ""}`;
        const porEscolha = i.precoPorEscolha && typeof i.precoPorEscolha === "object" ? Object.entries(i.precoPorEscolha as Record<string, number>) : [];
        // Meia pizza custa conforme o tamanho escolhido: aí não há um "sai R$" só.
        if ((!g.priceRule || g.priceRule === "SOMA") && !porEscolha.length) t += ` → com esta opção o produto sai ${reais(base + soma)}`;
        if (promo != null) {
          t += promoVale
            ? `; Promo +R$ ${promo.toFixed(2).replace(".", ",")} → na promoção sai ${reais(base + promo)} (${reais(base)} do produto + ${reais(promo)})`
            : `; Promo +R$ ${promo.toFixed(2).replace(".", ",")} NÃO VALE (não é menor que o +R$ ${soma.toFixed(2).replace(".", ",")})`;
        }
        if (porEscolha.length) t += ` (soma conforme a outra escolha: ${porEscolha.map(([k, v]) => `${k} ${Number(v) < 0 ? "−" : "+"}${reais(Math.abs(Number(v)))}`).join(", ")})`;
        return t;
      });
      linhas.push(...opcoes);
      if (g.items.length > 30) linhas.push(`    … e mais ${g.items.length - 30} opções.`);
    }
    return linhas.join("\n");
  });

  return {
    loja: loja.storeName || loja.name || "",
    horaDaLoja: relogio(minutoDaLoja(fuso, agora)),
    fuso,
    ordemDasCategorias: categorias.slice(0, 40),
    produtos,
    ...(palavras.length && !produtos.length ? { aviso: `Nenhum produto com "${busca}" no nome ou na categoria.` } : {}),
    ...(achados.length > escolhidos.length ? { aviso: `Mostrando ${escolhidos.length} de ${achados.length} produtos parecidos; peça o nome exato para ver outro.` } : {}),
  };
}
