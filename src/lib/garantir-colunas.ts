import { prisma } from "@/lib/prisma";

/**
 * Garante as colunas de PREÇO POR CANAL antes de o servidor aceitar tráfego.
 *
 * ── POR QUE ISTO EXISTE, SE JÁ HÁ /api/admin/colunas-preco ──────────────────
 *
 * A rota continua sendo a ferramenta manual de conferência. Mas ela exige uma
 * sessão ADMIN — e no deploy desta revisão não havia nenhuma disponível: a
 * conta da matriz opera como FRANCHISEE. O deploy não pode depender de um
 * clique que ninguém consegue dar.
 *
 * A regra da casa ("migração é decisão de pessoa, não de start de container")
 * nasceu do `prisma db push` automático que derrubou o cardápio duas vezes
 * (5a953ac): sincronização de schema INTEIRA, com potencial destrutivo. Isto
 * aqui é outra categoria:
 *
 *   - TRÊS instruções fixas, escritas no código, aditivas e idempotentes
 *     (`ADD COLUMN IF NOT EXISTS` de coluna NULÁVEL não altera, não apaga e
 *     não trava nada; rodar mil vezes é igual a uma).
 *   - Roda ANTES do primeiro request do container novo — que é a única ordem
 *     que impede o 500 de "campo no schema, coluna ausente" (o que derrubou
 *     /loja em 24/08/2026 com MenuProduct.sortOrder).
 *   - NUNCA lança: falhar aqui não pode impedir o boot. Se o banco estiver
 *     fora, o app inteiro já não funciona de qualquer jeito — e o log CRÍTICO
 *     abaixo diz exatamente o que conferir.
 *
 * Colunas novas no futuro: adicionar a instrução AQUI e o campo no schema no
 * MESMO commit — a ordem passa a ser garantida pelo boot, não por gente.
 */
const INSTRUCOES = [
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceSalao" DOUBLE PRECISION`,
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceDelivery" DOUBLE PRECISION`,
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceTotem" DOUBLE PRECISION`,
  // A OPÇÃO do combo também tem preço por canal. Quem modela o cardápio como o
  // iFood e o Anota AI põe o preço na opção de tamanho, e o produto fica com
  // preço base zero — nessas lojas as três colunas acima não alcançam nada.
  // Complemento carimbado na criação, dentro da pergunta do combo. Sem esta
  // coluna o sistema volta a adivinhar pelo preço — e adivinhava errado nos
  // dois sentidos: escondia pastel sem preço de salão e mostrava adicional
  // com preço como se fosse item avulso.
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "apenasEmCombo" BOOLEAN DEFAULT false`,
  `ALTER TABLE "ComboGroupItem" ADD COLUMN IF NOT EXISTS "additionalPriceSalao" DOUBLE PRECISION`,
  `ALTER TABLE "ComboGroupItem" ADD COLUMN IF NOT EXISTS "additionalPriceDelivery" DOUBLE PRECISION`,
  `ALTER TABLE "ComboGroupItem" ADD COLUMN IF NOT EXISTS "additionalPriceTotem" DOUBLE PRECISION`,
];

/** `tabela.coluna` — a conferência é por par, porque agora são duas tabelas. */
const ESPERADAS = [
  "MenuProduct.priceSalao",
  "MenuProduct.priceDelivery",
  "MenuProduct.priceTotem",
  "MenuProduct.apenasEmCombo",
  "ComboGroupItem.additionalPriceSalao",
  "ComboGroupItem.additionalPriceDelivery",
  "ComboGroupItem.additionalPriceTotem",
];

/**
 * Carimba de uma vez os complementos que já existiam antes da coluna.
 *
 * O `apenasEmCombo` só é preenchido na criação, pela pergunta do combo. Todo
 * cardápio cadastrado antes dele nasce `false` — e aí a classificação volta a
 * depender de heurística em tempo de leitura, em toda tela, para sempre.
 *
 * Este UPDATE congela a classificação nos dados, uma vez, usando exatamente o
 * que a heurística de `cardapio-interno.ts` já decide hoje: item SEM pergunta
 * própria, SEM preço em canal nenhum, e que ou é oferecido dentro de algum
 * combo ou está na categoria que o cadastro usa para as opções.
 *
 * ── O que ele NÃO toca, e é o ponto ────────────────────────────────────────
 *
 * Combo com pergunta própria fica de fora pelo `NOT EXISTS` em ComboGroup.
 * Isso é o que protege o cardápio no molde iFood, onde o pastel é um combo de
 * preço base R$ 0,00 e o valor sai da opção de tamanho — preço zero ali é
 * normal e não quer dizer complemento nenhum.
 *
 * ── Por que roda a cada boot sem estragar nada ─────────────────────────────
 *
 * O `= false` no WHERE faz a segunda execução casar zero linhas: quem já foi
 * carimbado sai do alcance. O corte por `createdAt` garante que item novo
 * nunca seja carimbado por aqui — quem nasce dentro do combo já vem com o
 * carimbo, e quem nasce fora não deve receber.
 *
 * RESSALVA para quem for mexer: no dia em que a tela permitir DESmarcar um
 * complemento, este UPDATE precisa de um guarda de verdade (uma marca de
 * migração já executada), senão o próximo boot desfaz a escolha do lojista.
 */
const CARIMBO_DE_COMPLEMENTO = `
  UPDATE "MenuProduct" p SET "apenasEmCombo" = true
  WHERE p."apenasEmCombo" = false
    AND p."createdAt" < TIMESTAMP '2026-09-04 00:00:00'
    AND NOT EXISTS (SELECT 1 FROM "ComboGroup" g WHERE g."menuProductId" = p."id")
    AND COALESCE(p."price", 0) <= 0
    AND COALESCE(p."priceSalao", 0) <= 0
    AND COALESCE(p."priceDelivery", 0) <= 0
    AND COALESCE(p."priceTotem", 0) <= 0
    AND (
      LOWER(TRIM(COALESCE(p."category", ''))) = 'adicionais'
      OR EXISTS (SELECT 1 FROM "ComboGroupItem" i WHERE i."menuProductId" = p."id")
    )
`;

export async function garantirColunasDePreco(): Promise<void> {
  // Ambiente sem banco de verdade (dev local usa .env higienizado): não há o
  // que garantir, e ficar tentando só suja o log.
  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia de colunas.");
    return;
  }

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      for (const sql of INSTRUCOES) {
        await prisma.$executeRawUnsafe(sql);
      }

      // Depois das colunas existirem, e nunca antes.
      const carimbados = await prisma.$executeRawUnsafe(CARIMBO_DE_COMPLEMENTO);
      if (Number(carimbados) > 0) {
        console.log(`[Boot] ${carimbados} complemento(s) antigo(s) carimbados com apenasEmCombo.`);
      }

      const rows = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
        SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
        WHERE table_name IN ('MenuProduct', 'ComboGroupItem')
          AND column_name IN (
            'priceSalao', 'priceDelivery', 'priceTotem', 'apenasEmCombo',
            'additionalPriceSalao', 'additionalPriceDelivery', 'additionalPriceTotem'
          )
      `;
      const existentes = new Set(rows.map((r) => `${r.tabela}.${r.coluna}`));
      const faltando = ESPERADAS.filter((c) => !existentes.has(c));

      if (faltando.length === 0) {
        console.log("[Boot] ✅ Colunas de preço por canal garantidas no banco.");
        return;
      }
      // ADD COLUMN sem erro mas coluna ausente não deveria acontecer nunca;
      // se acontecer, é melhor o log gritar do que o cardápio servir 500 mudo.
      console.error(`[Boot] 🛑 Colunas ausentes mesmo após o ALTER: ${faltando.join(", ")}.`);
      return;
    } catch (err: any) {
      console.error(
        `[Boot] Garantia de colunas falhou (tentativa ${tentativa}/3): ${err?.message}`
      );
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }

  console.error(
    "[Boot] 🛑 CRÍTICO: não consegui garantir as colunas de preço por canal. " +
      "Se o cardápio servir 500, rode /api/admin/colunas-preco?criar=sim (ADMIN) ou o SQL acima à mão."
  );
}

/**
 * ── Colunas da integração Brendi (Open Delivery) ────────────────────────────
 *
 * Mesma categoria das colunas de preço: instruções fixas, aditivas e
 * idempotentes (`ADD COLUMN IF NOT EXISTS` de coluna NULÁVEL + índice
 * `IF NOT EXISTS` — rodar mil vezes é igual a uma). Elas precisam existir no
 * banco ANTES de os campos entrarem no schema.prisma — regra da casa desde o
 * incidente do MenuProduct.sortOrder: campo no schema com coluna ausente é 500
 * em produção. Enquanto o schema não as conhece, todo acesso é por SQL cru
 * (brendi-api.ts), então esta garantia é o único pré-requisito de banco da
 * integração inteira.
 *
 * O índice em brendiMerchantId existe porque é a coluna de AMARRAÇÃO
 * pedido→loja: cada evento de polling resolve a dona por
 * `merchant.id == brendiMerchantId`, e essa busca roda a cada pedido — não
 * pode virar seq scan na tabela de usuários.
 */
const INSTRUCOES_BRENDI = [
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "brendiClientId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "brendiClientSecret" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "brendiMerchantId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "brendiConnected" BOOLEAN DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS "User_brendiMerchantId_idx" ON "User"("brendiMerchantId")`,
];

/**
 * Uma vez por processo — mas só marca DEPOIS de conseguir. As rotas da Brendi
 * chamam esta função defensivamente no topo (custo zero após o primeiro
 * sucesso); se o boot pegou o banco num soluço, é a próxima requisição que
 * conserta, em vez de o processo inteiro ficar marcado como "já garantiu"
 * sem ter garantido.
 */
let brendiColunasOk = false;

export async function garantirColunasBrendi(): Promise<void> {
  if (brendiColunasOk) return;

  // Ambiente sem banco de verdade (dev local usa .env higienizado): não há o
  // que garantir. Marca como resolvido para não repetir o aviso a cada rota.
  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia de colunas Brendi.");
    brendiColunasOk = true;
    return;
  }

  try {
    for (const sql of INSTRUCOES_BRENDI) {
      await prisma.$executeRawUnsafe(sql);
    }
    brendiColunasOk = true;
    console.log("[Boot] ✅ Colunas da integração Brendi garantidas no banco.");
  } catch (err: any) {
    // NUNCA lança: falhar aqui não pode impedir o boot nem derrubar uma rota
    // que só chamou por precaução. Sem as colunas, o gate natural segura tudo
    // (nenhuma loja aparece conectada) — o log diz o que conferir.
    console.error(`[Boot] 🛑 Garantia de colunas Brendi falhou: ${err?.message}`);
  }
}

/**
 * ── Estrutura de LOTE (etiqueta de validade + QR que dá baixa no estoque) ───
 *
 * O lote é a peça que liga dois mundos que hoje não se tocam: `KitchenItem`
 * (de onde a etiqueta nasce) e `StockItem` (onde a baixa acontece). Não existe
 * relação nenhuma entre os dois hoje, e casar por nome falharia em silêncio —
 * `StockItem` tem `@@unique([franchiseeId, name])` e `KitchenItem` não tem
 * unique de nome nenhum.
 *
 * MESMA CATEGORIA das garantias acima: instruções fixas, escritas no código,
 * aditivas e idempotentes. `CREATE TABLE IF NOT EXISTS` não toca em tabela
 * existente; `ADD COLUMN IF NOT EXISTS` de coluna NULÁVEL não altera e não
 * apaga; os `DO $$ ... EXCEPTION WHEN duplicate_object` tornam o `ADD
 * CONSTRAINT` repetível (o Postgres não aceita `IF NOT EXISTS` em constraint).
 * Rodar mil vezes é igual a rodar uma.
 *
 * A ORDEM É O PONTO. Isto roda no boot, antes do primeiro request — que é a
 * única forma de impedir o 500 de "campo no schema, coluna ausente" que já
 * derrubou /loja duas vezes (schema.prisma:394-401). Model e campos entram no
 * schema.prisma no MESMO commit que estas instruções, como manda a regra
 * escrita no topo deste arquivo.
 *
 * DECISÃO DE ARQUITETURA gravada aqui porque é ela que explica o formato:
 * `StockItem.quantity` continua sendo o total e o ÚNICO escritor do saldo. O
 * lote ALOCA parte desse total — não é uma segunda fonte da verdade. Insumo
 * sem lote se comporta exatamente como hoje, então nenhuma loja em operação
 * sente diferença no dia do deploy. A sobra `quantity - soma(lotes ativos)`
 * não é bug escondido: é o número "sem lote identificado", que a tela mostra.
 */
const INSTRUCOES_LOTES = [
  `CREATE TABLE IF NOT EXISTS "StockLot" (
     "id" TEXT NOT NULL,
     "code" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "stockItemId" TEXT,
     "kitchenItemId" TEXT,
     "productName" TEXT NOT NULL,
     "loteRef" TEXT,
     "fabricadoEm" TIMESTAMP(3),
     "validoAte" TIMESTAMP(3),
     "weightStr" TEXT,
     "unit" TEXT NOT NULL DEFAULT 'un',
     "quantidadeInicial" DOUBLE PRECISION NOT NULL DEFAULT 1,
     "quantidadeRestante" DOUBLE PRECISION NOT NULL DEFAULT 1,
     "status" TEXT NOT NULL DEFAULT 'ATIVO',
     "origem" TEXT NOT NULL DEFAULT 'ETIQUETA',
     "criadoPor" TEXT,
     "impressoes" INTEGER NOT NULL DEFAULT 1,
     "active" BOOLEAN NOT NULL DEFAULT true,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
   )`,

  // Único no SISTEMA INTEIRO, não por loja: dois códigos iguais em lojas
  // diferentes é exatamente como a baixa cai no estoque errado. É o mesmo
  // raciocínio já escrito em Food99Store.appShopId.
  `CREATE UNIQUE INDEX IF NOT EXISTS "StockLot_code_key" ON "StockLot"("code")`,
  // "o que vence hoje/amanhã" e o alerta de vencimento.
  `CREATE INDEX IF NOT EXISTS "StockLot_franchiseeId_validoAte_idx" ON "StockLot"("franchiseeId", "validoAte")`,
  // A baixa por validade mais próxima primeiro.
  `CREATE INDEX IF NOT EXISTS "StockLot_franchiseeId_stockItemId_idx" ON "StockLot"("franchiseeId", "stockItemId")`,

  // SET NULL, não CASCADE: apagar um insumo não pode apagar a rastreabilidade
  // de lotes que já estão colados em comida dentro da geladeira. O lote vira
  // "sem insumo vinculado", que é um estado que a tela do celular já trata.
  `DO $$ BEGIN
     ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_stockItemId_fkey"
       FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_franchiseeId_fkey"
       FOREIGN KEY ("franchiseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ── StockTransaction ganha o que sempre faltou ────────────────────────────
  // `stockLotId`: de qual lote saiu — FK de verdade, não substring.
  // `franchiseeId`: hoje NÃO EXISTE, e por isso as buscas de idempotência
  //   varrem as movimentações de TODAS as lojas.
  // `userId`: hoje é impossível saber quem lançou o quê. Com o scan indo para
  //   o celular de qualquer funcionário, isso deixa de ser detalhe.
  // `sourceRef`: chave de idempotência dedicada, que substitui o
  //   `notes: { contains: 'id: ' + orderId }` de src/lib/stock.ts — hack que
  //   além de não ter índice pode ser envenenado por um lançamento manual com
  //   o texto certo no campo de observação.
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "stockLotId" TEXT`,
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "franchiseeId" TEXT`,
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "userId" TEXT`,
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StockTransaction_sourceRef_key" ON "StockTransaction"("sourceRef")`,
  `CREATE INDEX IF NOT EXISTS "StockTransaction_stockLotId_idx" ON "StockTransaction"("stockLotId")`,
  `CREATE INDEX IF NOT EXISTS "StockTransaction_franchiseeId_idx" ON "StockTransaction"("franchiseeId")`,
  `DO $$ BEGIN
     ALTER TABLE "StockTransaction" ADD CONSTRAINT "StockTransaction_stockLotId_fkey"
       FOREIGN KEY ("stockLotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // Quem RECEBEU o lote. Na franquia a fábrica imprime a etiqueta e a LOJA lê o
  // QR para dar entrada — imprimir não põe nada em estoque nenhum.
  `ALTER TABLE "StockLot" ADD COLUMN IF NOT EXISTS "recebidoPorId" TEXT`,
  `ALTER TABLE "StockLot" ADD COLUMN IF NOT EXISTS "recebidoEm" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "StockLot_recebidoPorId_idx" ON "StockLot"("recebidoPorId")`,

  // A ponte escolhida UMA vez na tela: "este item de cozinha vira este insumo".
  // Sem ela o QR não sabe o que movimentar.
  `ALTER TABLE "KitchenItem" ADD COLUMN IF NOT EXISTS "stockItemId" TEXT`,
  `ALTER TABLE "KitchenItem" ADD COLUMN IF NOT EXISTS "labelSize" TEXT`,

  // Config de quais campos saem na etiqueta — UMA regra por loja. Json em User
  // é o padrão da casa para configuração de loja (printerConfig, totemConfig,
  // kdsScreens), e não sofre a armadilha da coluna escalar ausente do mesmo
  // jeito, porque nada além desta tela lê o campo.
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "labelFieldsConfig" JSONB`,
  // O que a loja mostra na barra do painel de pedidos. Ausente = tudo ligado.
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "painelPedidosConfig" JSONB`,

  // Token da API de Conversões do Meta. Sem ele a venda só existe pelo pixel do
  // navegador, que perde de 30% a 50% dos eventos.
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaCapiToken" TEXT`,

  // Soft-delete no insumo. Hoje a lixeira faz DELETE físico e a cascata leva
  // TODO o histórico de movimentação junto (schema:1153) e as fichas técnicas
  // que referenciam o insumo (:1167) — perda silenciosa e irreversível.
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true`,
];

let lotesOk = false;

export async function garantirEstruturaDeLotes(): Promise<void> {
  if (lotesOk) return;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia da estrutura de lotes.");
    lotesOk = true;
    return;
  }

  // Três tentativas, como a garantia de colunas de preço: o container novo
  // pode subir antes de o banco aceitar conexão, e desistir na primeira
  // deixaria o schema declarando colunas que não existem — que é o 500 mudo
  // que já derrubou /loja duas vezes.
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      for (const sql of INSTRUCOES_LOTES) {
        await prisma.$executeRawUnsafe(sql);
      }

      // Conferir a tabela não basta: as COLUNAS novas em tabelas que já existem
      // são o perigo de verdade. Uma delas faltando faz toda consulta ao
      // estoque servir 500, porque o Prisma monta o SELECT com todas as
      // escalares do schema.
      const faltando: string[] = [];

      const tab = await prisma.$queryRaw<{ t: string }[]>`
        SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'StockLot'
      `;
      if (tab.length === 0) faltando.push("tabela StockLot");

      const cols = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
        SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (
            (table_name = 'StockTransaction' AND column_name IN ('stockLotId','franchiseeId','userId','sourceRef'))
            OR (table_name = 'KitchenItem'    AND column_name IN ('stockItemId','labelSize'))
            OR (table_name = 'User'           AND column_name IN ('labelFieldsConfig','metaCapiToken'))
            OR (table_name = 'StockItem'      AND column_name IN ('active'))
            OR (table_name = 'StockLot'       AND column_name IN ('recebidoPorId','recebidoEm'))
          )
      `;
      const tem = new Set(cols.map((c) => `${c.tabela}.${c.coluna}`));
      for (const esperada of [
        "StockTransaction.stockLotId", "StockTransaction.franchiseeId",
        "StockTransaction.userId", "StockTransaction.sourceRef",
        "KitchenItem.stockItemId", "KitchenItem.labelSize",
        "User.labelFieldsConfig", "User.metaCapiToken", "StockItem.active",
        "StockLot.recebidoPorId", "StockLot.recebidoEm",
      ]) {
        if (!tem.has(esperada)) faltando.push(esperada);
      }

      if (faltando.length > 0) {
        console.error(`[Boot] 🛑 Estrutura de lotes incompleta: falta ${faltando.join(", ")}.`);
        if (tentativa < 3) { await new Promise((r) => setTimeout(r, 2000 * tentativa)); continue; }
        return;
      }

      lotesOk = true;
      console.log("[Boot] ✅ Estrutura de lotes (StockLot + 8 colunas) garantida no banco.");
      return;
    } catch (err: any) {
      // NUNCA lança: falhar aqui não pode impedir o boot.
      console.error(`[Boot] Garantia da estrutura de lotes falhou (tentativa ${tentativa}/3): ${err?.message}`);
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }

  console.error(
    "[Boot] 🛑 CRÍTICO: não consegui garantir a estrutura de lotes. O estoque pode servir 500 " +
      "enquanto o schema declarar campos sem coluna. Rode o SQL de INSTRUCOES_LOTES à mão."
  );
}

/**
 * ── Movimentação de caixa: sangria e reforço ───────────────────────────────
 *
 * O caixa só conhecia DOIS momentos: o troco de abertura e a contagem do
 * fechamento. Entre um e outro, todo dinheiro que sai (pagar motoboy, comprar
 * gelo, sangria para o cofre) e todo dinheiro que entra (reforço de troco)
 * acontecia sem registro nenhum.
 *
 * O estrago é direto: `expected.cash` é a soma dos pedidos em dinheiro mais o
 * troco inicial (api/cash-session/route.ts:88). Uma sangria de R$ 200 faz o
 * fechamento acusar R$ 200 de FALTA — e não há nada no sistema que explique.
 * O lojista aprende a ignorar a diferença, e a partir daí o caixa não confere
 * mais nada: é o mesmo efeito de um alarme que toca todo dia sem motivo.
 *
 * MESMA CATEGORIA das garantias acima: fixas, aditivas, idempotentes.
 */
const INSTRUCOES_CAIXA = [
  `CREATE TABLE IF NOT EXISTS "CashMovement" (
     "id" TEXT NOT NULL,
     "cashSessionId" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "tipo" TEXT NOT NULL,
     "valor" DOUBLE PRECISION NOT NULL,
     "descricao" TEXT,
     "criadoPor" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "CashMovement_cashSessionId_idx" ON "CashMovement"("cashSessionId")`,
  `CREATE INDEX IF NOT EXISTS "CashMovement_franchiseeId_createdAt_idx" ON "CashMovement"("franchiseeId", "createdAt")`,
  `DO $$ BEGIN
     ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey"
       FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

let caixaOk = false;

export async function garantirEstruturaDeCaixa(): Promise<void> {
  if (caixaOk) return;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia da estrutura de caixa.");
    caixaOk = true;
    return;
  }

  try {
    for (const sql of INSTRUCOES_CAIXA) {
      await prisma.$executeRawUnsafe(sql);
    }
    const rows = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT table_name AS tabela FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'CashMovement'
    `;
    if (rows.length === 0) {
      console.error("[Boot] 🛑 Tabela CashMovement ausente mesmo após o CREATE TABLE.");
      return;
    }
    caixaOk = true;
    console.log("[Boot] ✅ Estrutura de movimentação de caixa garantida no banco.");
  } catch (err: any) {
    console.error(`[Boot] 🛑 Garantia da estrutura de caixa falhou: ${err?.message}`);
  }
}

/** Mesmo degrau de `temEstruturaDeLotes`, para o caixa. */
let cacheTemCaixa: boolean | null = null;

export async function temEstruturaDeCaixa(): Promise<boolean> {
  if (cacheTemCaixa !== null) return cacheTemCaixa;
  try {
    const rows = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT table_name AS tabela FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'CashMovement'
    `;
    cacheTemCaixa = rows.length > 0;
  } catch {
    cacheTemCaixa = false;
  }
  return cacheTemCaixa;
}

/**
 * O código novo pergunta ISTO antes de tocar em lote.
 *
 * É o degrau que transforma "a garantia do boot falhou" em "o recurso de
 * validade fica desligado" em vez de "o estoque inteiro serve 500". Mesmo
 * padrão de src/lib/food99-lojas.ts: o caminho novo é uma ADIÇÃO, nunca uma
 * troca — se ele não estiver disponível, o antigo continua inteiro.
 */
let cacheTemLotes: boolean | null = null;

export async function temEstruturaDeLotes(): Promise<boolean> {
  if (cacheTemLotes !== null) return cacheTemLotes;
  try {
    const rows = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT table_name AS tabela FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'StockLot'
    `;
    cacheTemLotes = rows.length > 0;
  } catch {
    cacheTemLotes = false;
  }
  return cacheTemLotes;
}

/**
 * ── COLUNAS QUE O SCHEMA DECLARA E O BANCO PODE NÃO TER ─────────────────────
 *
 * A regra escrita no topo deste arquivo — "coluna nova entra AQUI e no
 * schema.prisma no MESMO commit" — vinha sendo furada. Varrendo
 * prisma/schema.prisma commit a commit desde 15/08/2026: 39 colunas foram
 * adicionadas a tabelas que JÁ EXISTIAM, e nenhuma delas tinha DDL em lugar
 * nenhum. O Dockerfile diz na cara que o deploy não roda `prisma db push`, e o
 * resto deste arquivo explica por que não deve rodar. Então quem tem essas
 * colunas em produção tem porque alguém rodou o push na mão; quem não tem
 * serve 500 no primeiro request que tocar o campo.
 *
 * Isto não é hipótese — é a mesma família de duas quedas já registradas neste
 * repositório: `MenuProduct.sortOrder` derrubou /loja em 24/08/2026, e "o
 * deploy apagava as colunas do iFood" (851169d). As mais caras da lista abaixo
 * são as que ficam no caminho quente:
 *
 *   - CustomerOrder.gaClientId / gaSessionId → gravadas em TODO pedido novo
 *     (src/app/api/customer-order/route.ts). Sem a coluna, pedido não entra.
 *   - User.gaMeasurementId / gtmContainerId → lidas ao abrir o cardápio
 *     público (src/app/loja/[slug]/page.tsx). Sem a coluna, cardápio não abre.
 *   - CustomerOrder.acceptedAt / readyAt / dispatchedAt / deliveredAt →
 *     gravadas pela extensão do Prisma em QUALQUER mudança de status. Sem as
 *     colunas, nenhum pedido muda de fase.
 *
 * MESMA CATEGORIA das garantias acima: instruções fixas, escritas no código,
 * aditivas e idempotentes. As nuláveis não alteram e não apagam nada. As seis
 * NOT NULL levam DEFAULT junto, porque `ADD COLUMN ... NOT NULL` sem default
 * falha em tabela que já tem linha dentro — com default o Postgres 11+ resolve
 * sem reescrever a tabela.
 *
 * NÃO cria índice, de propósito. `PosTerminal.deviceToken` e
 * `Ambassador.linkedUserId` são `@unique` no schema, mas o que serve 500 é a
 * coluna ausente, não o índice. Um `CREATE UNIQUE INDEX` num banco que já
 * tenha valor repetido falharia a cada boot e sujaria o log para sempre —
 * isso é decisão de gente, com o dado na mão.
 */
const INSTRUCOES_COLUNAS_DO_SCHEMA = [
  // ── User (a loja) ──
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gaMeasurementId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gaApiSecret" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gtmContainerId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "etaConfig" JSONB`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingData" JSONB`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaIaSemanaReferencia" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaIaGeracoesUsadas" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showAddressOnMenu" BOOLEAN NOT NULL DEFAULT true`,

  // ── CustomerOrder — o caminho mais quente do sistema ──
  // De qual loja iFood veio o pedido — conta com várias lojas no mesmo painel.
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodStoreName" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodStoreMerchant" TEXT`,
  // De qual loja do 99Food veio — conta com mais de uma no mesmo painel.
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "food99AppShopId" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "food99ShopId" TEXT`,
  // Quando o ENTREGADOR puxou o pedido pelo app (QR/número da comanda).
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "motoboyPuxadoEm" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "gaClientId" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "gaSessionId" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodDropCodeAt" TIMESTAMP(3)`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodDropCodeRequired" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "posOrderId" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "posTerminalId" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "posStatus" TEXT`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "posDadosTransacao" JSONB`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "posTentativas" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "tableSessionId" TEXT`,

  // ── Item do pedido ──
  `ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
  `ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "tableGuestId" TEXT`,

  // ── Cardápio ──
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "ComboGroup" ADD COLUMN IF NOT EXISTS "minQty" INTEGER`,
  `ALTER TABLE "ComboGroupItem" ADD COLUMN IF NOT EXISTS "maxPerItem" INTEGER`,
  `ALTER TABLE "ComboGroupItem" ADD COLUMN IF NOT EXISTS "optionNote" TEXT`,

  // ── Cliente da loja ──
  `ALTER TABLE "StoreCustomer" ADD COLUMN IF NOT EXISTS "birthDate" TEXT`,

  // ── Totem ──
  `ALTER TABLE "TotemLicense" ADD COLUMN IF NOT EXISTS "posTerminalId" TEXT`,

  // ── Embaixadores ──
  `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "parentAmbassadorId" TEXT`,
  `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "linkedUserId" TEXT`,
  `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "level2Percent" DOUBLE PRECISION NOT NULL DEFAULT 3`,

  // ── Tabelas que também nasceram nesta janela ──
  // Se a tabela não existir no banco desta loja, estas seis falham sozinhas e
  // as 33 de cima continuam valendo. É por isso que o catch é por instrução.
  `ALTER TABLE "TableSession" ADD COLUMN IF NOT EXISTS "waiterId" TEXT`,
  `ALTER TABLE "TableSession" ADD COLUMN IF NOT EXISTS "waiterTip" DOUBLE PRECISION`,
  `ALTER TABLE "TableSession" ADD COLUMN IF NOT EXISTS "waiterCommission" DOUBLE PRECISION`,
  `ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "deviceToken" TEXT`,
  `ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3)`,
  `ALTER TABLE "PosTerminal" ADD COLUMN IF NOT EXISTS "appVersion" TEXT`,
];


/**
 * ── Acesso do garçom e conta da mesa ───────────────────────────────────────
 *
 * MESMA CATEGORIA das garantias acima: instruções fixas, escritas no código,
 * aditivas e idempotentes. `ADD COLUMN IF NOT EXISTS` de coluna NULÁVEL não
 * altera e não apaga; `CREATE TABLE/INDEX IF NOT EXISTS` não toca no que já
 * existe; o `DO $ ... EXCEPTION WHEN duplicate_object` torna o
 * `ADD CONSTRAINT` repetível (o Postgres não aceita `IF NOT EXISTS` em
 * constraint). Rodar mil vezes é igual a rodar uma.
 *
 * POR QUE NÃO `prisma db push`: o banco de produção tem tabelas e colunas
 * que nenhum schema.prisma declara (AmbassadorApplication, Food99Store,
 * emergencyFine, routeSequence...). Um push pediria `--accept-data-loss` e
 * APAGARIA tudo isso — inclusive candidaturas de embaixador. A garantia por
 * DDL aditivo aplica só o que falta e não tem como apagar nada.
 *
 * A ORDEM É O PONTO: roda no boot, antes do primeiro request. É a única forma
 * de impedir o 500 de "campo no schema, coluna ausente" — e aqui o estrago
 * seria grande, porque `GET /api/store/print-queue` é chamado pelo Assistente
 * de TODA loja a cada 3 s: sem a coluna, a impressão de mesa e balcão pararia
 * em toda a base ao mesmo tempo.
 *
 * O índice único de `Waiter(franchiseeId, login)` aceita nulos sem conflito,
 * então garçom já cadastrado (sem login) não trava a criação.
 */
const INSTRUCOES_MESA = [
  // Acesso próprio do garçom pelo link (src/lib/garcom-auth.ts).
  `ALTER TABLE "Waiter" ADD COLUMN IF NOT EXISTS "login" TEXT`,
  `ALTER TABLE "Waiter" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`,
  `ALTER TABLE "Waiter" ADD COLUMN IF NOT EXISTS "credentialsUpdatedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Waiter" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Waiter_franchiseeId_login_key" ON "Waiter"("franchiseeId", "login")`,

  // Fechar o caixa encerra o turno do garçom; e o carimbo do poll da fila.
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cashClosedAt" TIMESTAMP(3)`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "printQueuePolledAt" TIMESTAMP(3)`,

  // Quem fechou a mesa (painel ou garçom).
  `ALTER TABLE "TableSession" ADD COLUMN IF NOT EXISTS "closedByKind" TEXT`,
  `ALTER TABLE "TableSession" ADD COLUMN IF NOT EXISTS "closedByName" TEXT`,

  // Impressão que não nasce de pedido — hoje, a conta da mesa.
  `CREATE TABLE IF NOT EXISTS "PrintRequest" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "payload" JSONB NOT NULL,
     "requestedBy" TEXT,
     "tableSessionId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "PrintRequest_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "PrintRequest_franchiseeId_createdAt_idx" ON "PrintRequest"("franchiseeId", "createdAt")`,
];

/**
 * A chave estrangeira entra a parte, e nao na lista acima.
 *
 * O caminho usual seria um bloco anonimo (DO ... EXCEPTION WHEN
 * duplicate_object), que e o que as garantias vizinhas fazem. Mas por
 * `$executeRawUnsafe` o Prisma trata o cifrao como marcador de parametro e o
 * Postgres responde `syntax error at or near "$"` — barulho no log a cada boot,
 * sem criar nada. Conferir antes em `pg_constraint` faz o mesmo servico sem
 * bloco anonimo, e e igualmente repetivel.
 */
async function garantirChaveDaImpressao(): Promise<void> {
  const existe = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname = 'PrintRequest_franchiseeId_fkey'
  `;
  if (existe.length > 0) return;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PrintRequest" ADD CONSTRAINT "PrintRequest_franchiseeId_fkey" ` +
      `FOREIGN KEY ("franchiseeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`
  );
}

let mesaOk = false;

export async function garantirEstruturaDeMesa(): Promise<void> {
  if (mesaOk) return;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia da estrutura de mesa.");
    mesaOk = true;
    return;
  }

  try {
    // Catch por instrução: uma que falhe (tabela ausente numa loja antiga) não
    // pode levar as outras junto — é o mesmo desenho das garantias acima.
    for (const sql of INSTRUCOES_MESA) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err: any) {
        console.error(`[Boot] Instrução de mesa falhou: ${err?.message}`);
      }
    }

    try {
      await garantirChaveDaImpressao();
    } catch (err: any) {
      console.error(`[Boot] Chave estrangeira de PrintRequest: ${err?.message}`);
    }

    const colunas = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
      SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND ((table_name = 'Waiter' AND column_name IN ('login', 'passwordHash', 'credentialsUpdatedAt', 'lastLoginAt'))
          OR (table_name = 'User' AND column_name IN ('cashClosedAt', 'printQueuePolledAt'))
          OR (table_name = 'TableSession' AND column_name IN ('closedByKind', 'closedByName')))
    `;
    const tabela = await prisma.$queryRaw<{ tabela: string }[]>`
      SELECT table_name AS tabela FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'PrintRequest'
    `;

    const faltando = 8 - colunas.length;
    if (faltando > 0 || tabela.length === 0) {
      console.error(
        `[Boot] 🛑 Estrutura de mesa incompleta: ${faltando} coluna(s) e ${tabela.length === 0 ? "a tabela PrintRequest" : "nenhuma tabela"} faltando.`
      );
      return;
    }
    mesaOk = true;
    console.log("[Boot] ✅ Acesso do garçom e conta da mesa garantidos no banco.");
  } catch (err: any) {
    console.error(`[Boot] 🛑 Garantia da estrutura de mesa falhou: ${err?.message}`);
  }
}

let colunasDoSchemaOk = false;

export async function garantirColunasDoSchema(): Promise<void> {
  if (colunasDoSchemaOk) return;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia de colunas do schema.");
    colunasDoSchemaOk = true;
    return;
  }

  let aplicadas = 0;
  const falhas: string[] = [];

  for (const sql of INSTRUCOES_COLUNAS_DO_SCHEMA) {
    try {
      await prisma.$executeRawUnsafe(sql);
      aplicadas++;
    } catch (err: any) {
      // O try/catch é POR INSTRUÇÃO, e não em volta do laço. O caso esperado é
      // tabela que não existe ("relation does not exist") num banco que nunca
      // recebeu o módulo de mesa ou de maquininha. Com o catch em volta do
      // laço, a primeira dessas abortaria justamente as que evitam o 500 do
      // cardápio e do pedido.
      const tabela = sql.match(/ALTER TABLE "(\w+)"/)?.[1] ?? "?";
      const coluna = sql.match(/IF NOT EXISTS "(\w+)"/)?.[1] ?? "?";
      falhas.push(`${tabela}.${coluna}: ${String(err?.message || "").slice(0, 90)}`);
    }
  }

  // Marca resolvido mesmo com falha: isto roda uma vez por instância, e
  // repetir não conserta banco fora do ar. O log é que diz o que conferir.
  colunasDoSchemaOk = true;

  if (falhas.length === 0) {
    console.log(`[Boot] ✅ ${aplicadas} colunas do schema garantidas no banco.`);
  } else {
    console.error(
      `[Boot] 🛑 ${aplicadas} colunas garantidas, ${falhas.length} falharam:\n  ` + falhas.join("\n  "),
    );
  }
}
