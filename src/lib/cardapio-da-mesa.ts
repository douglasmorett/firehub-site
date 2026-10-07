/**
 * O cardápio que o garçom vê na mesa, montado a partir do que a rota entrega
 * (/api/admin/menu-products?canal=salao no painel, /api/garcom/cardapio pelo
 * link do garçom).
 *
 * Mora aqui, e não dentro da tela, porque são DUAS telas de mesa — a completa
 * (components/mesas/MesasApp.tsx) e a de celular (components/mesas/
 * MesasCelular.tsx). Cada uma com o seu filtro, o garçom veria um cardápio no
 * tablet e outro no celular, e "sumiu item da mesa" voltaria a ser impossível
 * de investigar.
 */
import { idsSoDeOpcaoDeCombo, motivoForaDoCardapio, textoDoHorario, textoDosDias } from "@/lib/cardapio-interno";

export interface ItemDaMesa {
  id: string;
  name: string;
  price: number;
  category?: string;
  isCombo?: boolean;
  imageUrl?: string | null;
  comboGroups?: any[];
  comboConfig?: any;
}

export type ItemOcultoDaMesa = ItemDaMesa & { motivo: string };

/** Os grupos de pergunta do produto, venham eles de `comboGroups` ou do `comboConfig` antigo. */
export function gruposDoProduto(prod: any): any[] {
  if (prod?.comboGroups && Array.isArray(prod.comboGroups) && prod.comboGroups.length > 0) {
    return prod.comboGroups;
  }
  if (!prod?.comboConfig) return [];
  try {
    const config = typeof prod.comboConfig === "string" ? JSON.parse(prod.comboConfig) : prod.comboConfig;
    if (Array.isArray(config)) return config;
    if (config.groups && Array.isArray(config.groups)) return config.groups;
    if (config.comboGroups && Array.isArray(config.comboGroups)) return config.comboGroups;
  } catch {}
  return [];
}

export function montarCardapioDaMesa(data: any[]): {
  itens: ItemDaMesa[];
  ocultos: ItemOcultoDaMesa[];
  /** Abas na ordem da loja, começando por "Todos". */
  categorias: string[];
} {
  // Esconde itens stub de integração (iFood, JotaJá, 99Food)
  const HIDDEN_CATS = new Set(["IFOOD", "JOTAJA", "JOTAJÁ", "99FOOD", "ONLINE", "OCULTO"]);
  // O prefixo do id diz como o registro NASCEU, não o que ele É hoje:
  // cardápio importado do sistema antigo reaproveita ids `ifood-…` (o
  // porquê está em SEM_PRODUTO_DE_INTEGRACAO, cardapio-interno.ts — o
  // servidor já filtra assim). Condenar por prefixo escondia desta tela
  // 8 dos 13 pastéis de carne da Pastelaria da Paulista — ativos, com
  // categoria própria e combo montado — e sem aparecer nem no aviso de
  // ocultos, porque espelho fica fora dele de propósito. Prefixo só
  // condena o espelho que ninguém adotou: o inativo.
  const isIntegration = (p: any) => {
    const temPrefixoDeEspelho =
      p.id?.startsWith("ifood-") || p.id?.startsWith("jotaja-") || p.id?.startsWith("99food-");
    if (temPrefixoDeEspelho && p.active === false) return true;
    return HIDDEN_CATS.has((p.category || "").toUpperCase().trim());
  };

  // Adicionais e sabores são MenuProduct de R$ 0,00 que existem só para
  // preencher a pergunta do combo. Viravam card no cardápio do garçom.
  //
  // Quem decide isso é o SERVIDOR, em `apenasOpcaoDeCombo`. Aqui o
  // `price` já veio trocado pelo preço do salão, então um item que a
  // loja precificou só no delivery chega como zero — e calcular a regra
  // com esse número escondia item vendável da mesa, calado. O cálculo
  // local fica como reserva para um payload antigo, sem a bandeira.
  const temBandeira = data.some((p: any) => p.apenasOpcaoDeCombo !== undefined);
  const soOpcaoDeCombo = temBandeira
    ? new Set(data.filter((p: any) => p.apenasOpcaoDeCombo).map((p: any) => String(p.id)))
    : idsSoDeOpcaoDeCombo(data);

  // ── Dia e horário do item ────────────────────────────────────────────
  //
  // A mesa era a ÚNICA tela de venda que ignorava `availableDays` /
  // `availableHours`. O site, o totem, o balcão e o robô já respeitavam —
  // e, pior, `lib/lancar-na-mesa.ts` RECUSA o item fora do dia. O garçom via
  // o produto na vitrine, tocava, e levava "não está no cardápio da mesa".
  // Queixa da Ragnar Burger em 06/10/2026, uma terça: o "Burger Clássico"
  // estava cadastrado em seg, qua, qui, sex, sáb e dom.
  //
  // Quem decide é o SERVIDOR (`foraDoCardapioAgora`), que conhece o fuso da
  // loja — é o mesmo relógio que recusa o lançamento, então a vitrine não
  // tem como discordar dele. O cálculo local fica de reserva para um payload
  // antigo, sem a bandeira.
  const foraDoCardapio = (p: any): "dia" | "horario" | null =>
    p?.foraDoCardapioAgora !== undefined ? p.foraDoCardapioAgora : motivoForaDoCardapio(p);

  const paraItem = (p: any): ItemDaMesa => ({
    id: p.id,
    name: p.name,
    price: p.price,
    // A categoria REAL, sempre. Antes todo combo virava "Combos" e perdia
    // a dele — e numa loja onde quase todo item é combo (a Pastelaria da
    // Paulista tem 69 de 186) isso apagava as abas de "Pastéis de carne",
    // "Pastéis Doces", "Pastéis especiais"... O garçom procurava a aba,
    // não achava, e concluía que os pastéis não estavam no sistema.
    // Combo continua tendo aba própria: ela é montada à parte, abaixo.
    category: p.category || "Outros",
    isCombo: p.isCombo,
    imageUrl: p.imageUrl || null,
    comboGroups: p.comboGroups,
    comboConfig: p.comboConfig,
  });

  // Vendáveis de verdade: o que passa por todos os filtros.
  const itens = data
    .filter((p: any) => p.active !== false && !isIntegration(p))
    // O cadastro tem um interruptor por canal e esta tela era a única
    // que ignorava o dela: o que a loja desligava para a mesa continuava
    // aparecendo aqui. Balcão já olha activePDV, totem já olha activeTotem.
    .filter((p: any) => p.activeGarcom !== false)
    .filter((p: any) => p.esgotado !== true)
    .filter((p: any) => !foraDoCardapio(p))
    .filter((p: any) => !soOpcaoDeCombo.has(String(p.id)))
    .map(paraItem);

  // ── TUDO que não entrou, e o motivo de cada um ──────────────────────
  //
  // Antes a tela só descartava. Quando a loja dizia "sumiu item do
  // cardápio da mesa", não havia como saber qual nem por quê sem abrir o
  // banco — e são quatro motivos diferentes, com consertos diferentes.
  // Espelho de integração fica de fora da lista de propósito: aquilo
  // nunca foi cardápio da loja e só faria ruído.
  const motivoDeOcultar = (p: any): string | null => {
    if (isIntegration(p)) return null;
    if (p.active === false) return "pausado no cardápio";
    if (p.activeGarcom === false) return "desligado para o garçom no cadastro";
    if (p.esgotado === true) return "estoque zerou — pausado até repor (Cardápio → 📦 Estoque)";
    // O caminho exato do cadastro: sem ele o lojista procura o item em
    // "pausado" e não acha — ele está ativo, só não vende HOJE.
    const fora = foraDoCardapio(p);
    if (fora === "horario") {
      const quando = textoDoHorario(p.availableHours);
      return `fora do horário${quando ? " — só vende " + quando : ""} (Cardápio → o item → 📅 Dias de Disponibilidade)`;
    }
    if (fora === "dia") {
      const quando = textoDosDias(p.availableDays);
      return `hoje não é dia dele${quando ? " — só vende " + quando : ""} (Cardápio → o item → 📅 Dias de Disponibilidade)`;
    }
    if (p.apenasEmCombo === true) return "complemento de combo — aparece dentro da pergunta do combo";
    if (soOpcaoDeCombo.has(String(p.id))) return "sem preço em nenhum canal — não dá para lançar na comanda";
    return null;
  };

  const ocultos = data
    .map((p: any) => {
      const motivo = motivoDeOcultar(p);
      return motivo ? { ...paraItem(p), motivo } : null;
    })
    .filter(Boolean) as ItemOcultoDaMesa[];

  // "Combos" é uma aba TRANSVERSAL: o combo aparece na categoria dele e
  // também aqui, para quem quer ver só os montados. Só entra na lista se
  // a loja tiver algum — e não tiver uma categoria chamada "Combos",
  // senão apareciam duas abas iguais.
  //
  // A ORDEM é a da loja ("Reordenar Cardápio"): o servidor já entrega os
  // produtos nela (lib/cardapio-da-loja.ts). Sem `.sort()` alfabético.
  const reais = Array.from(new Set(itens.map((i) => i.category || "Outros")));
  const temCombo = itens.some((i) => i.isCombo);
  const temCategoriaCombos = reais.some((c) => String(c).trim().toLowerCase() === "combos");
  const categorias = ["Todos", ...(temCombo && !temCategoriaCombos ? ["Combos"] : []), ...reais];

  return { itens, ocultos, categorias };
}
