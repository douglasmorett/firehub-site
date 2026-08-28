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
];

const ESPERADAS = ["priceSalao", "priceDelivery", "priceTotem"];

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

      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'MenuProduct'
          AND column_name IN ('priceSalao', 'priceDelivery', 'priceTotem')
      `;
      const existentes = rows.map((r) => r.column_name);
      const faltando = ESPERADAS.filter((c) => !existentes.includes(c));

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
