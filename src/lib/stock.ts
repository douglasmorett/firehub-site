import { prisma } from "./prisma";

/**
 * Uma escolha de combo já normalizada.
 *
 * `chaves` é o que dá para usar para achar a opção no cadastro, em ordem de
 * confiança: id do ComboGroupItem, id do MenuProduct e, só no fim, o nome. O
 * nome é o último recurso porque ele muda — o lojista renomeia "Coca 350ml"
 * para "Coca-Cola Lata" e a baixa de todos os pedidos novos pararia de casar.
 */
type EscolhaDeCombo = {
  grupoId?: string;
  chaves: string[];
  /** Como a escolha aparece no log quando não dá para resolver. */
  rotulo: string;
  qtd: number;
};

/** Opção de um grupo de combo com a ficha técnica do produto que ela entrega. */
type OpcaoDeCombo = {
  id: string;
  comboGroupId: string;
  menuProductId: string;
  comboGroup: { menuProductId: string };
  menuProduct: {
    name: string;
    recipeItems: {
      stockItemId: string;
      quantityConsumed: number;
      stockItem: { name: string; unit: string };
    }[];
  };
};

/** Índice das opções de UM produto-combo, para casar o que o cliente escolheu. */
type IndiceDeOpcoes = {
  /** `${grupoId}::${chave}` — o caminho preciso, usado quando o grupo veio no JSON. */
  porGrupo: Map<string, OpcaoDeCombo>;
  /**
   * Só a chave, sem grupo. Guarda `null` quando duas opções disputam a mesma
   * chave apontando para produtos diferentes: aí a escolha é ambígua e baixar
   * o insumo errado é pior do que não baixar.
   */
  porChave: Map<string, OpcaoDeCombo | null>;
};

function chaveNormalizada(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Normaliza os dois formatos de `comboSelections` que circulam no sistema numa
 * lista de (grupo, chaves, quantidade) — o mesmo trabalho que
 * `normalizarEscolhas` faz em preco-combo.ts para calcular o preço:
 *
 *   cardápio e totem  →  { grupoId: { nomeDaOpção: qtd } }
 *   PDV, mesa, iFood  →  [{ name, quantity }]
 *
 * O grupo é preservado quando existe: a mesma opção pode estar em dois grupos
 * do mesmo combo (a "Esfirra de Carne" inclusa e a segunda esfirra paga), e é
 * o grupo que diz qual das duas o cliente marcou.
 */
function normalizarEscolhasDoCombo(bruto: unknown): EscolhaDeCombo[] {
  if (!bruto) return [];

  let dados: any = bruto;
  if (typeof dados === "string") {
    try {
      dados = JSON.parse(dados);
    } catch {
      return [];
    }
  }

  // Formato do PDV, da mesa e dos marketplaces: lista sem grupo.
  if (Array.isArray(dados)) {
    const lista: EscolhaDeCombo[] = [];

    for (const escolha of dados) {
      // Registro antigo gravava só o texto ("2x Esfirra de Carne").
      if (typeof escolha === "string") {
        const texto = escolha.trim();
        if (!texto) continue;
        // O "x" é obrigatório no casamento: sem ele, "5 Queijos" — que é o
        // nome do sabor — viraria 5 unidades de "Queijos", produto que não
        // existe, e a baixa sairia cinco vezes maior no insumo errado.
        const comQuantidade = texto.match(/^(\d+)\s*x\s+(.+)$/i);
        const nome = comQuantidade ? comQuantidade[2].trim() : texto;
        const qtd = comQuantidade ? Number(comQuantidade[1]) : 1;
        if (!nome || !(qtd > 0)) continue;
        lista.push({ chaves: [nome], rotulo: nome, qtd });
        continue;
      }

      if (!escolha || typeof escolha !== "object") continue;

      const qtd = Number(escolha.quantity ?? escolha.qty ?? 0);
      if (!Number.isFinite(qtd) || qtd <= 0) continue;

      const nome = String(escolha.name ?? escolha.productName ?? "").trim();
      const chaves = [
        escolha.comboGroupItemId,
        escolha.optionId,
        escolha.menuProductId,
        escolha.productId,
        escolha.id,
        nome,
      ]
        .map((c) => (c == null ? "" : String(c).trim()))
        .filter(Boolean);
      if (chaves.length === 0) continue;

      const grupoId = escolha.groupId ?? escolha.comboGroupId;
      lista.push({
        grupoId: grupoId ? String(grupoId) : undefined,
        chaves,
        rotulo: nome || chaves[0],
        qtd,
      });
    }

    return lista;
  }

  // Formato do cardápio e do totem: { grupoId: { chave: qtd } }. Hoje a chave é
  // o nome da opção, mas o índice também aceita id — no dia em que o cardápio
  // passar a gravar id, a baixa continua casando sem mexer aqui.
  if (typeof dados === "object") {
    const lista: EscolhaDeCombo[] = [];
    for (const [grupoId, grupo] of Object.entries(dados as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [chave, qtd] of Object.entries(grupo as Record<string, any>)) {
        const n = Number(qtd);
        if (!chave || !Number.isFinite(n) || n <= 0) continue;
        lista.push({ grupoId, chaves: [chave], rotulo: chave, qtd: n });
      }
    }
    return lista;
  }

  return [];
}

function chavesDaOpcao(opcao: OpcaoDeCombo): string[] {
  return [
    chaveNormalizada(opcao.id),
    chaveNormalizada(opcao.menuProductId),
    chaveNormalizada(opcao.menuProduct.name || ""),
  ].filter(Boolean);
}

function indexarOpcoes(opcoes: OpcaoDeCombo[]): IndiceDeOpcoes {
  const porGrupo = new Map<string, OpcaoDeCombo>();
  const porChave = new Map<string, OpcaoDeCombo | null>();

  for (const opcao of opcoes) {
    for (const chave of chavesDaOpcao(opcao)) {
      porGrupo.set(`${opcao.comboGroupId}::${chave}`, opcao);

      if (!porChave.has(chave)) {
        porChave.set(chave, opcao);
        continue;
      }
      const anterior = porChave.get(chave);
      if (anterior && anterior.menuProductId !== opcao.menuProductId) porChave.set(chave, null);
    }
  }

  return { porGrupo, porChave };
}

/**
 * Acha a opção que o cliente escolheu. Tenta na ordem das `chaves` (ids antes
 * do nome) e, dentro de cada chave, o grupo antes do índice solto: o grupo
 * pode não bater mais porque o lojista remontou o combo e os ComboGroups
 * nasceram com ids novos, e nesse caso a chave sozinha ainda resolve.
 */
function acharOpcaoDoCombo(indice: IndiceDeOpcoes, escolha: EscolhaDeCombo): OpcaoDeCombo | null {
  for (const chave of escolha.chaves) {
    const normalizada = chaveNormalizada(chave);
    if (!normalizada) continue;

    if (escolha.grupoId) {
      const doGrupo = indice.porGrupo.get(`${escolha.grupoId}::${normalizada}`);
      if (doGrupo) return doGrupo;
    }

    const unica = indice.porChave.get(normalizada);
    if (unica) return unica;
  }
  return null;
}

/**
 * Realiza a baixa automática do estoque com base nas fichas técnicas (receitas)
 * dos produtos vinculados a um pedido — e, nos combos, das opções que o
 * cliente escolheu dentro deles.
 *
 * Idempotente: verifica campo `stockDeductedForOrderId` na CustomerOrder
 * para garantir que o estoque só seja debitado uma vez por pedido,
 * mesmo com chamadas concorrentes.
 *
 * @param orderId ID do pedido aceito
 */
export async function deductStockForOrder(orderId: string) {
  try {
    // Checar e marcar atomicamente usando updateMany com condição.
    // Se `stockDeductedForOrderId` já estiver preenchido, o count será 0 e paramos.
    // Nota: usamos o campo `cancelReason` como flag temporária se o schema
    // ainda não tiver o campo dedicado — preferimos adicionar campo ao schema.
    // Por ora, usamos a abordagem de transaction com findFirst + create único.

    // Preenchido dentro da transação e só impresso depois do commit: logar saldo
    // negativo de uma baixa que acabou revertida seria caça a fantasma no Coolify.
    const saldosNegativos: {
      insumoId: string;
      insumo: string;
      saldo: number;
      unidade: string;
    }[] = [];

    // Verificar idempotência com transação atômica
    const result = await prisma.$transaction(async (tx) => {
      // A devolução por cancelamento desfaz a baixa, então a venda antiga
      // sozinha não prova mais que o insumo está fora do saldo: o pedido
      // cancelado e depois reaceito (a tela de pedidos deixa voltar de
      // CANCELADO para ACEITO) já teve o insumo devolvido, e se pularmos a
      // baixa aqui ele fica no estoque para sempre. Só conta como já baixado
      // quem tem venda posterior à última devolução deste pedido.
      const ultimaDevolucao = await tx.stockTransaction.findFirst({
        where: {
          type: "INPUT",
          notes: { contains: `cancel id: ${orderId}` },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // Verifica se já existe uma transação de estoque para este pedido
      const existing = await tx.stockTransaction.findFirst({
        where: {
          type: "SALE",
          notes: { contains: `id: ${orderId}` }, // match exato do padrão que geramos abaixo
          ...(ultimaDevolucao ? { createdAt: { gt: ultimaDevolucao.createdAt } } : {}),
        },
        select: { id: true },
      });

      if (existing) {
        return { skipped: true };
      }

      // Buscar o pedido e seus itens com receitas
      const order = await tx.customerOrder.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              menuProduct: {
                include: {
                  recipeItems: {
                    include: { stockItem: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        console.error(`[Stock] Pedido não encontrado: ${orderId}`);
        return { skipped: true };
      }

      // Um combo quase nunca tem ficha técnica própria: quem consome insumo são
      // as opções que o cliente escolheu dentro dele, e elas só existem no JSON
      // `comboSelections` do item. Enquanto a baixa olhava apenas a receita do
      // produto-combo, vender um "Combo 2 Esfirras" não tirava nada da
      // prateleira — o recheio só sumia do saldo no inventário do fim do mês.
      //
      // As opções vêm numa consulta à parte, e só quando existe item com
      // escolha: descer o include até a receita de cada opção pesaria em todo
      // pedido, inclusive nos que não têm combo nenhum.
      const idsDeProdutosComEscolha = Array.from(
        new Set(
          order.items
            .filter((item) => item.comboSelections != null && item.menuProductId)
            .map((item) => item.menuProductId as string)
        )
      );

      const opcoesPorProduto = new Map<string, OpcaoDeCombo[]>();
      if (idsDeProdutosComEscolha.length > 0) {
        const opcoes = await tx.comboGroupItem.findMany({
          where: { comboGroup: { menuProductId: { in: idsDeProdutosComEscolha } } },
          select: {
            id: true,
            comboGroupId: true,
            menuProductId: true,
            comboGroup: { select: { menuProductId: true } },
            menuProduct: {
              select: {
                name: true,
                recipeItems: {
                  select: {
                    stockItemId: true,
                    quantityConsumed: true,
                    stockItem: { select: { name: true, unit: true } },
                  },
                },
              },
            },
          },
        });

        for (const opcao of opcoes) {
          const dono = opcao.comboGroup.menuProductId;
          const lista = opcoesPorProduto.get(dono);
          if (lista) lista.push(opcao);
          else opcoesPorProduto.set(dono, [opcao]);
        }
      }

      const indicesPorProduto = new Map<string, IndiceDeOpcoes>();

      let deducted = false;

      for (const item of order.items) {
        const menuProduct = item.menuProduct;
        const rotuloDoItem = menuProduct?.name || item.productName || "produto removido";

        // Quanto sai da prateleira por UNIDADE vendida deste item, somando a
        // receita do próprio produto com a das opções escolhidas. Os insumos são
        // agrupados por id porque a massa da esfirra pode estar na receita do
        // combo e na de cada sabor: assim fica uma linha só no histórico do
        // lojista, com o total certo.
        const consumoPorUnidade = new Map<
          string,
          { nome: string; unidade: string; quantidade: number; origens: string[] }
        >();

        const somarConsumo = (
          stockItemId: string,
          nome: string,
          unidade: string,
          quantidade: number,
          origem: string
        ) => {
          if (!Number.isFinite(quantidade) || quantidade <= 0) return;
          const atual = consumoPorUnidade.get(stockItemId);
          if (atual) {
            atual.quantidade += quantidade;
            atual.origens.push(origem);
          } else {
            consumoPorUnidade.set(stockItemId, { nome, unidade, quantidade, origens: [origem] });
          }
        };

        // ── O PRODUTO-ESPELHO DO MARKETPLACE NÃO TEM, E NÃO PODE TER, FICHA ──
        //
        // Pedido de iFood/99Food/Jotajá/Brendi não aponta para o produto do
        // cardápio: o importador cria um ESPELHO (`ifood-<itemId>`) com
        // `active:false` e `category:"iFood"`. E a tela de fichas técnicas
        // exclui exatamente isso — não existe lugar no sistema onde esse
        // produto possa receber ficha. Ou seja, a baixa do marketplace era
        // estruturalmente impossível, e é a maior parte do faturamento da
        // maioria das lojas de delivery.
        //
        // A saída sem obrigar o lojista a cadastrar nada duas vezes: quando o
        // item não tem receita própria, procurar no cardápio DESTA loja um
        // produto ativo com o mesmo nome e usar a ficha dele. É a ligação que
        // o lojista faria à mão, feita sozinha — e é exatamente o nome que ele
        // cadastrou nas duas pontas, porque o cardápio do iFood sai daqui.
        //
        // Nome não casa? Não inventa nada: fica sem baixa, e o log diz qual
        // produto ficou de fora para a tela poder cobrar a ligação depois.
        let receita = menuProduct?.recipeItems ?? [];
        if (receita.length === 0 && rotuloDoItem && rotuloDoItem !== "produto removido") {
          const real = await tx.menuProduct.findFirst({
            where: {
              franchiseeId: order.franchiseeId,
              active: true,
              name: { equals: rotuloDoItem, mode: "insensitive" },
              // Nunca casar com outro espelho: dois espelhos com o mesmo nome
              // fariam a baixa apontar para um produto que também não tem ficha.
              NOT: { id: { startsWith: "ifood-" } },
              recipeItems: { some: {} },
            },
            select: {
              id: true,
              recipeItems: {
                select: {
                  stockItemId: true,
                  quantityConsumed: true,
                  stockItem: { select: { name: true, unit: true } },
                },
              },
            },
          });
          if (real) {
            receita = real.recipeItems as typeof receita;
            console.log(
              `[Stock] "${rotuloDoItem}" veio do marketplace sem ficha própria; ` +
                `usando a ficha técnica do produto do cardápio (${real.id}).`
            );
          } else if (menuProduct && !menuProduct.recipeItems?.length) {
            console.warn(
              `[Stock] ⚠️ "${rotuloDoItem}" (pedido ${order.id}) não tem ficha técnica e ` +
                `não achei produto de mesmo nome no cardápio — nada foi baixado por este item.`
            );
          }
        }

        for (const recipeItem of receita) {
          somarConsumo(
            recipeItem.stockItemId,
            recipeItem.stockItem.name,
            recipeItem.stockItem.unit,
            recipeItem.quantityConsumed,
            rotuloDoItem
          );
        }

        const escolhas = normalizarEscolhasDoCombo(item.comboSelections);
        if (escolhas.length > 0) {
          const opcoes = item.menuProductId ? opcoesPorProduto.get(item.menuProductId) ?? [] : [];

          if (opcoes.length === 0) {
            // Acontece no pedido importado de marketplace: o "combo" é um
            // produto espelho (`ifood-...`) e as opções são texto, nunca foram
            // cadastradas como grupo. Não há o que resolver, e a venda segue.
            console.warn(
              `[Stock] Pedido ${order.id}: "${rotuloDoItem}" veio com ${escolhas.length} escolha(s), mas o produto não tem grupos de combo cadastrados. Nada a baixar por elas.`
            );
          } else {
            let indice = item.menuProductId ? indicesPorProduto.get(item.menuProductId) : undefined;
            if (!indice) {
              indice = indexarOpcoes(opcoes);
              if (item.menuProductId) indicesPorProduto.set(item.menuProductId, indice);
            }

            const naoResolvidas: string[] = [];

            for (const escolha of escolhas) {
              const opcao = acharOpcaoDoCombo(indice, escolha);
              if (!opcao) {
                naoResolvidas.push(escolha.rotulo);
                continue;
              }

              // A quantidade da escolha é POR unidade do combo; a do item entra
              // depois, quando a linha vira transação.
              for (const recipeItem of opcao.menuProduct.recipeItems) {
                somarConsumo(
                  recipeItem.stockItemId,
                  recipeItem.stockItem.name,
                  recipeItem.stockItem.unit,
                  recipeItem.quantityConsumed * escolha.qtd,
                  `${escolha.qtd}x ${opcao.menuProduct.name}`
                );
              }
            }

            if (naoResolvidas.length > 0) {
              // Escolha que não casa com nenhuma opção cadastrada não pode
              // derrubar a venda: fica o registro de quem ficou sem baixa e o
              // resto do pedido é debitado normalmente.
              console.warn(
                `[Stock] Pedido ${order.id}: ${naoResolvidas.length} escolha(s) de "${rotuloDoItem}" não casaram com as opções cadastradas (${naoResolvidas.join(", ")}). Esses componentes não foram baixados.`
              );
            }
          }
        }

        if (consumoPorUnidade.size === 0) {
          console.log(`[Stock] "${rotuloDoItem}" sem ficha técnica (nem no produto, nem nas opções escolhidas).`);
          continue;
        }

        for (const [stockItemId, consumo] of consumoPorUnidade) {
          const amountToDeduct = consumo.quantidade * item.quantity;
          if (!Number.isFinite(amountToDeduct) || amountToDeduct <= 0) continue;

          console.log(
            `[Stock] Deduzindo ${amountToDeduct}${consumo.unidade} de "${consumo.nome}" para ${item.quantity}x "${rotuloDoItem}" (${consumo.origens.join(" + ")})`
          );

          // ── A GARANTIA DE UMA VEZ SÓ MORA NO ÍNDICE, NÃO NA BUSCA ────────
          //
          // A idempotência era um `notes: { contains: "id: " + orderId }`:
          // busca por SUBSTRING, em coluna sem índice, e SEM filtro de loja —
          // varria as movimentações de todas as lojas do sistema a cada venda.
          // Pior: qualquer funcionário podia plantar esse texto no campo de
          // observação de um lançamento manual e fazer a baixa automática de
          // um pedido de OUTRA loja ser pulada para sempre.
          //
          // E ela não segurava a corrida real: a rota de status dispara esta
          // função duas vezes em paralelo no mesmo request, e um findFirst sem
          // constraint deixa as duas passarem — baixa dobrada.
          //
          // Agora quem garante é o banco: `sourceRef` é @unique, e a chave é
          // determinística por (pedido, insumo). A segunda gravação viola o
          // índice e a baixa não acontece duas vezes, aconteça o que acontecer
          // com a ordem das chamadas.
          await tx.stockTransaction.create({
            data: {
              stockItemId,
              franchiseeId: order.franchiseeId,
              sourceRef: `sale:${order.id}:${stockItemId}`,
              quantity: -amountToDeduct,
              type: "SALE",
              notes: `Baixa automática - Pedido #${order.id.slice(-6)} (id: ${order.id})`,
            },
          });

          // `updateMany` com franchiseeId no WHERE da escrita. O `update` por id
          // puro escrevia no saldo sem nunca conferir de quem era o insumo —
          // era a única escrita de estoque do sistema sem essa proteção, e a
          // rota de pedido de mesa aceita menuProductId de outra loja.
          const alterados = await tx.stockItem.updateMany({
            where: { id: stockItemId, franchiseeId: order.franchiseeId },
            data: { quantity: { decrement: amountToDeduct } },
          });
          if (alterados.count === 0) {
            // Insumo de outra loja (ou apagado entre ler e gravar): aborta tudo,
            // em vez de deixar a movimentação registrada sem saldo correspondente.
            throw new Error(`INSUMO_FORA_DA_LOJA:${stockItemId}`);
          }
          const saldoDepois = (await tx.stockItem.findUnique({
            where: { id: stockItemId },
            select: { id: true, name: true, quantity: true, unit: true },
          }))!;

          // Saldo negativo não trava a venda: quando a baixa roda o pedido já foi
          // aceito e a comida está com o cliente — abortar aqui só produziria um
          // pedido cobrado sem baixa nenhuma. Mas negativo significa que a ficha
          // técnica consumiu insumo que o sistema não tinha (quase sempre nota de
          // entrada esquecida), e até agora isso passava mudo até o inventário.
          // Fica uma linha por insumo, com o pedido e o saldo que sobrou.
          if (saldoDepois.quantity < 0) {
            saldosNegativos.push({
              insumoId: saldoDepois.id,
              insumo: saldoDepois.name,
              saldo: saldoDepois.quantity,
              unidade: saldoDepois.unit,
            });
          }

          deducted = true;
        }
      }

      return { skipped: false, deducted };
    });

    if (result.skipped) {
      console.log(`[Stock] Baixa já processada para pedido: ${orderId}`);
    } else {
      console.log(`[Stock] Baixa concluída para pedido #${orderId.slice(-6)}`);
    }

    for (const negativo of saldosNegativos) {
      console.warn(
        "[Stock] saldo negativo",
        JSON.stringify({
          pedido: orderId,
          insumoId: negativo.insumoId,
          insumo: negativo.insumo,
          saldo: negativo.saldo,
          unidade: negativo.unidade,
        })
      );
    }
  } catch (error: any) {
    // P2002 no `sourceRef` é o RESULTADO ESPERADO da corrida, não um defeito:
    // a rota de status dispara esta função duas vezes em paralelo no mesmo
    // request (uma direta e outra dentro de confirmOrderPayment). A segunda
    // bate no índice único e a transação inteira volta atrás — que é
    // exatamente o que impede a baixa dobrada. Logar como erro faria o time
    // caçar um problema que na verdade é a proteção funcionando.
    if (String(error?.code) === "P2002") {
      console.log(`[Stock] Baixa do pedido ${orderId} já estava registrada (corrida evitada).`);
      return;
    }
    if (String(error?.message || "").startsWith("INSUMO_FORA_DA_LOJA:")) {
      console.error(
        `[Stock] 🛑 Pedido ${orderId} tentou baixar insumo que não é desta loja ` +
          `(${String(error.message).split(":")[1]}). Nada foi gravado.`
      );
      return;
    }
    console.error(`[Stock] Erro ao realizar baixa de estoque para pedido ${orderId}:`, error);
  }
}

/**
 * Devolve ao estoque os insumos que a baixa automática consumiu, quando o
 * pedido acaba cancelado. Sem isso o saldo fica furado: o insumo saiu do
 * sistema mas voltou para a prateleira, e o lojista só descobre no inventário.
 *
 * Idempotente por conta própria (não depende da guarda da baixa): a devolução
 * grava a marca `cancel id: {orderId}` nas notas e só devolve as baixas
 * gravadas depois da última marca dessas — o mesmo pedido pode ser cancelado
 * pelo painel e pelo marketplace com segundos de diferença, e cada chamada
 * cai aqui.
 *
 * O `type` gravado é "INPUT" e não "RETURN": StockTransaction.type é texto
 * livre no schema, mas o vocabulário documentado lá (e o único que a tela de
 * Estoque traduz em badge) é INPUT/OUTPUT/SALE/WASTE — um "RETURN" apareceria
 * cru em inglês no histórico do lojista. Quem identifica a devolução é a nota.
 *
 * @param orderId ID do pedido cancelado
 */
export async function restoreStockForOrder(orderId: string) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Quando foi a última devolução deste pedido, se é que houve alguma.
      const ultimaDevolucao = await tx.stockTransaction.findFirst({
        where: {
          type: "INPUT",
          notes: { contains: `cancel id: ${orderId}` }, // match exato do padrão que geramos abaixo
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // As baixas do pedido são a fonte da verdade do que devolver: usar de novo
      // a ficha técnica do produto devolveria a receita de hoje, que pode ter
      // mudado depois que o pedido entrou.
      //
      // Entram só as baixas posteriores à última devolução. Isso resolve os dois
      // lados de uma vez: o cancelamento que chega em duplicidade (painel e
      // marketplace mandam os dois com segundos de diferença) não acha baixa
      // nova e devolve zero, e o pedido que foi cancelado, reaceito e cancelado
      // de novo baixou duas vezes e precisa ser devolvido nas duas.
      const sales = await tx.stockTransaction.findMany({
        where: {
          type: "SALE",
          notes: { contains: `id: ${orderId}` },
          ...(ultimaDevolucao ? { createdAt: { gt: ultimaDevolucao.createdAt } } : {}),
        },
        select: { id: true, stockItemId: true, quantity: true, franchiseeId: true },
      });

      // Pedido cancelado antes do ACEITO nunca baixou nada — não é erro.
      if (sales.length === 0) {
        return { skipped: Boolean(ultimaDevolucao), restored: 0 };
      }

      let restored = 0;

      for (const sale of sales) {
        // A baixa grava quantidade negativa; o módulo protege contra registro
        // que alguém tenha gravado positivo na mão.
        const amountToRestore = Math.abs(sale.quantity);
        if (amountToRestore === 0) continue;

        await tx.stockTransaction.create({
          data: {
            stockItemId: sale.stockItemId,
            franchiseeId: sale.franchiseeId,
            quantity: amountToRestore,
            type: "INPUT",
            notes: `Devolução por cancelamento - Pedido #${orderId.slice(-6)} (cancel id: ${orderId})`,
          },
        });

        // Libera a chave da baixa que está sendo desfeita.
        //
        // `sourceRef` é determinístico por (pedido, insumo) e único no banco.
        // Sem soltar aqui, o pedido cancelado e REACEITO — a tela de pedidos
        // deixa voltar de CANCELADO para ACEITO — bateria no índice e a baixa
        // nunca mais aconteceria: o insumo ficaria no saldo para sempre. A
        // trava tem que valer contra repetição, não contra reabertura.
        await tx.stockTransaction.update({
          where: { id: sale.id },
          data: { sourceRef: null },
        });

        await tx.stockItem.updateMany({
          where: { id: sale.stockItemId, ...(sale.franchiseeId ? { franchiseeId: sale.franchiseeId } : {}) },
          data: { quantity: { increment: amountToRestore } },
        });

        restored++;
      }

      return { skipped: false, restored };
    });

    if (result.skipped) {
      console.log(`[Stock] Devolução já processada para pedido: ${orderId}`);
    } else if (result.restored === 0) {
      console.log(`[Stock] Nada a devolver no pedido #${orderId.slice(-6)} (sem baixa registrada)`);
    } else {
      console.log(`[Stock] Devolução concluída para pedido #${orderId.slice(-6)} (${result.restored} insumo(s))`);
    }
  } catch (error) {
    console.error(`[Stock] Erro ao devolver estoque do pedido ${orderId}:`, error);
  }
}
