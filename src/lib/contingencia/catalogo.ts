/**
 * O QUE ENTRA NA CÓPIA DA LOJA (Modo Contingência).
 * Obsidian: Projetos/FireHub - Modo Contingência.md, itens 2 e 6.
 *
 * Cada tabela diz:
 *   - como achar a LOJA de uma linha (para o gatilho da nuvem anotar a
 *     mudança só das lojas com contingência, e para a subida conferir que a
 *     linha é mesmo da loja dona da chave);
 *   - a CHAVE (para buscar e apagar linha por linha);
 *   - o recorte da FOTO inicial (pedidos dos últimos dias, não a história
 *     inteira);
 *   - as colunas que NUNCA descem para o computador da loja.
 *
 * Sem banco nem Prisma: o supervisor do computador da loja usa o mesmo
 * arquivo, e os dois lados nunca discordam sobre o que é cópia.
 */

export type LojaDaLinha =
  /** A linha tem a coluna da loja. */
  | { tipo: "coluna"; coluna: string; tambem?: string }
  /** User: a loja é `ownerId` (funcionário) ou o próprio `id` (dono). */
  | { tipo: "usuario" }
  /** A loja está na linha-pai: `coluna` aponta para `tabela`.id, que tem `lojaDoPai`. */
  | { tipo: "pai"; coluna: string; tabela: string; lojaDoPai: string }
  /** Dois saltos: item → grupo → produto. */
  | { tipo: "avo"; coluna: string; tabela: string; colunaDoPai: string; tabelaDoAvo: string; lojaDoAvo: string };

export type TabelaDaCopia = {
  nome: string;
  loja: LojaDaLinha;
  /** Colunas da chave primária, na ordem. */
  chave: string[];
  /**
   * Recorte da foto: condição SQL sobre o alias `t`, com `$1` = id da loja.
   * Ausente = todas as linhas da loja.
   */
  foto?: string;
  /** Colunas que nunca descem (além de `colunaSecreta`). */
  semColunas?: string[];
  /** Colunas secretas pela regra geral que esta tabela PRECISA (ex.: senha do garçom). */
  permitirColunas?: string[];
  /**
   * Colunas que DESCEM (o painel do computador lê) mas nunca SOBEM: a subida
   * é montada pelo computador da loja, e o corpo pode ser forjado com a chave
   * da contingência, que qualquer dono ativa.
   */
  naoSobem?: string[];
  /**
   * Mudança só nestas colunas não conta (o Assistente grava
   * `printQueuePolledAt` a cada 3 s: sem isto, cada consulta da fila desceria
   * a linha inteira da loja).
   */
  ignorarMudancaDe?: string[];
  /** Tabela global ou sem loja na linha: sem gatilho, a foto é refeita de tempos em tempos. */
  soPorFoto?: boolean;
  /**
   * Na VOLTA, coluna que a loja e a nuvem mudaram ao mesmo tempo:
   *   "soma"  = a diferença da loja vai por cima do valor da nuvem (estoque:
   *             a loja vendeu 3, a nuvem já tinha baixado 1 → baixa 4);
   *   "maior" = fica o maior (o contador do número do pedido nunca anda para trás).
   * Sem regra, vale o que a loja fez — e o conflito fica anotado.
   */
  mescla?: Record<string, "soma" | "maior">;
  /** A loja não cria linha nova desta tabela pela contingência (só altera). */
  semLinhaNova?: boolean;
  /**
   * Na VOLTA, colunas de chave estrangeira ANULÁVEIS cuja linha-pai pode não
   * estar na nuvem (o banco do computador não tem chave estrangeira: a rota
   * que nunca subiu, o cliente cadastrado de novo com um telefone que a nuvem
   * já tinha). Sem isto, a linha inteira seria recusada; com isto, ela sobe
   * com a coluna vazia e o conflito fica anotado (subida-linha-a-linha.ts).
   */
  paiQuePodeFaltar?: string[];
};

/**
 * Quantos dias de história a cópia traz na foto: pedidos, mesas e caixas.
 * Era 3 (pedidos) e 7 (caixas) — o bastante para operar, mas os relatórios
 * do computador da loja (vendas do dia, da semana, do mês, fechamentos de
 * caixa) ficavam vazios na queda. Com 31 dias, "este mês" e "últimos 30 dias"
 * saem iguais aos da nuvem (pedido de 12/11/2026: o sistema completo no PC).
 * Depois da foto, o espelho mantém tudo em dia; a história mais velha que
 * isso continua só na nuvem.
 */
export const DIAS_DE_HISTORIA_NA_COPIA = 31;
const HISTORIA = `interval '${DIAS_DE_HISTORIA_NA_COPIA} days'`;

/** Pedidos que entram na cópia: os da história e os de mesa ainda aberta. */
const PEDIDOS_DA_FOTO = `t."franchiseeId" = $1 AND (t."createdAt" >= now() - ${HISTORIA}
  OR t."tableSessionId" IN (SELECT s.id FROM "TableSession" s WHERE s."franchiseeId" = $1 AND s.status <> 'CLOSED'))`;

/** Caixas da cópia: o aberto e os da história (o número do pedido usa o último fechado; o relatório, todos). */
const CAIXAS_DA_FOTO = `t."franchiseeId" = $1 AND (t.status = 'OPEN' OR t."openedAt" >= now() - ${HISTORIA})`;

/** Mesas da cópia: as abertas e as da história (relatório de mesas). */
const MESAS_DA_FOTO = `t."franchiseeId" = $1 AND (t.status <> 'CLOSED' OR t."openedAt" >= now() - ${HISTORIA})`;

/**
 * ── COMO PÔR UMA TABELA NOVA NA CÓPIA ───────────────────────────────────────
 * (para quem cria tela nova que tem de funcionar sem internet — ex.: o
 * "Caixa de mercado", feat/caixa-de-mercado)
 *
 *   1. Uma entrada em TABELAS_DA_COPIA, abaixo: `nome` (igual ao banco),
 *      `loja` (como achar a loja da linha), `chave` e, se a tabela cresce sem
 *      parar, o recorte `foto` (use HISTORIA para acompanhar o resto).
 *   2. Tabela criada por SQL no primeiro uso (fora do schema.prisma) também
 *      vale: o esquema do computador vem do information_schema da nuvem
 *      (servidor.ts → esquemaDoBanco), e a tabela que ainda não existe na
 *      nuvem é só pulada até existir (estrutura-no-banco.ts, existeTabela).
 *   3. Segredo (token, senha, certificado) nunca desce: `semColunas`, ou o
 *      nome já cai em `colunaSecreta`.
 *   4. Coluna que é contador ou saldo: `mescla` ("soma"/"maior") para a volta.
 *      Coluna que a loja NÃO pode gravar pela contingência: `naoSobem`.
 *   5. Foto/imagem que a tela mostra: uma linha em FOTOS_DA_COPIA.
 *   6. Rodar `npx tsx scripts/teste-contingencia.ts` (trava as regras).
 * O supervisor (contingencia/supervisor) usa este mesmo arquivo: nada a mudar lá.
 */

export const TABELAS_DA_COPIA: TabelaDaCopia[] = [
  {
    nome: "User",
    loja: { tipo: "usuario" },
    chave: ["id"],
    foto: `(t.id = $1 OR t."ownerId" = $1)`,
    // Configuração com chave de fora, cobrança, robô e fiscal: nada disso
    // funciona sem internet, e não pode morar no computador da loja.
    semColunas: [
      "password", "resetToken", "resetTokenExp", "chatbotConfig", "fiscalConfig", "asaasConexao",
      "asaasChaveCifrada", "firecheckIntegracao", "onboardingData", "repasseConfig", "metaFbAccessToken",
      "metaCapiToken", "gaApiSecret", "mpAccessToken", "mpRefreshToken", "ifoodAccessToken",
      "ifoodRefreshToken", "ifoodAuthVerifier", "jotajaClientSecret", "food99SecretKey",
    ],
    // O Painel de senhas (configuração e código da TV que chama o pedido) cai
    // na regra geral por ter "senha" no nome, mas não é segredo: sem ele, a
    // TV do salão não acha a loja na cópia e o PC gera um código novo.
    permitirColunas: ["painelDeSenhas"],
    // Papel, dono, grupo, plano, cobrança e vínculos: com eles na subida, o
    // dono gravava role ADMIN ou o accountGroupId de outra loja na própria
    // linha. Nada disso muda durante uma queda de internet.
    naoSobem: [
      "email", "role", "permissions", "ownerId", "accountGroupId", "isPrimaryStore", "isFireHubSystem",
      "isFranqueadoHakim", "planPercent", "trialEndsAt", "slug", "slugsAntigos", "cpfCnpj",
      "ambassadorId", "vendedorId", "vendedorStatus", "vendedorAtribuidoEm", "vendedorAtendidoEm",
      "referredById", "asaasWalletId", "pagarmeRecipientId", "mpSellerId", "celcoinAccountId",
      "metaAdsEnabled", "metaAdsWeeklyFee", "metaIaGeracoesUsadas", "metaIaSemanaReferencia",
      "employeeAccountEnabled", "totemEnabled", "ifoodMerchantId", "ifoodClientId", "jotajaMerchantId",
      // Vínculos e "conectado" dos canais, Meta, Asaas e o estado da queda: só
      // a nuvem grava (a rota de cada um confere se o id já é de outra loja).
      "ifoodConnected", "ifoodWidgetId", "ifoodTokenExpiresAt", "jotajaClientId", "jotajaConnected",
      "food99MerchantId", "food99AppId", "food99Connected", "brendiClientId", "brendiMerchantId",
      "brendiConnected", "wabizUsername", "wabizConnected", "metaFbPageId", "metaAdAccountId", "metaPixelId",
      "pixOnlineAtivo", "cartaoOnlineAtivo", "semConexaoEstado",
    ],
    ignorarMudancaDe: ["printQueuePolledAt", "printQueueEstado", "updatedAt"],
    semLinhaNova: true,
    mescla: { storeOrderCount: "soma" },
  },
  {
    nome: "CustomerOrder",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: PEDIDOS_DA_FOTO,
    paiQuePodeFaltar: ["routeId", "motoboyId", "employeeId", "tableSessionId", "customerId", "parentOrderId"],
  },
  {
    nome: "CustomerOrderItem",
    loja: { tipo: "pai", coluna: "orderId", tabela: "CustomerOrder", lojaDoPai: "franchiseeId" },
    chave: ["id"],
    foto: `t."orderId" IN (SELECT t.id FROM "CustomerOrder" t WHERE ${PEDIDOS_DA_FOTO})`,
    paiQuePodeFaltar: ["menuProductId", "tableGuestId"],
  },
  {
    nome: "DailyOrderCounter",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["franchiseeId", "dateKey"],
    mescla: { lastNumber: "maior" },
  },
  { nome: "Table", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"] },
  {
    nome: "TableSession",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: MESAS_DA_FOTO,
    paiQuePodeFaltar: ["waiterId"],
  },
  {
    nome: "TableGuest",
    loja: { tipo: "pai", coluna: "tableSessionId", tabela: "TableSession", lojaDoPai: "franchiseeId" },
    chave: ["id"],
    foto: `t."tableSessionId" IN (SELECT t.id FROM "TableSession" t WHERE ${MESAS_DA_FOTO})`,
  },
  // A senha do garçom desce: ele entra pelo login próprio na rede da loja.
  { nome: "Waiter", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"], permitirColunas: ["passwordHash"] },
  { nome: "CashSession", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"], foto: CAIXAS_DA_FOTO },
  {
    nome: "CashMovement",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `t."cashSessionId" IN (SELECT t.id FROM "CashSession" t WHERE ${CAIXAS_DA_FOTO})`,
  },
  {
    nome: "CashSessionEdicao",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `t."cashSessionId" IN (SELECT t.id FROM "CashSession" t WHERE ${CAIXAS_DA_FOTO})`,
  },
  {
    nome: "PrintRequest",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `t."franchiseeId" = $1 AND t."createdAt" >= now() - interval '1 day'`,
  },
  { nome: "MenuProduct", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"] },
  // Categoria sem loja (`franchiseeId` nulo) é a do FireHub, usada por todas.
  {
    nome: "MenuCategory",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `(t."franchiseeId" = $1 OR t."franchiseeId" IS NULL)`,
  },
  {
    nome: "ComboGroup",
    loja: { tipo: "pai", coluna: "menuProductId", tabela: "MenuProduct", lojaDoPai: "franchiseeId" },
    chave: ["id"],
    foto: `t."menuProductId" IN (SELECT p.id FROM "MenuProduct" p WHERE p."franchiseeId" = $1)`,
  },
  {
    nome: "ComboGroupItem",
    loja: {
      tipo: "avo", coluna: "comboGroupId", tabela: "ComboGroup", colunaDoPai: "menuProductId",
      tabelaDoAvo: "MenuProduct", lojaDoAvo: "franchiseeId",
    },
    chave: ["id"],
    foto: `t."comboGroupId" IN (SELECT g.id FROM "ComboGroup" g JOIN "MenuProduct" p ON p.id = g."menuProductId" WHERE p."franchiseeId" = $1)`,
  },
  { nome: "StoreEmployee", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"] },
  { nome: "Motoboy", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"] },
  // A rota do motoboy ("Despachar rota" no Pedidos): sem ela na cópia, a rota
  // criada na queda nunca subia e o pedido que apontava para ela (routeId)
  // travava a volta inteira na chave estrangeira da nuvem.
  {
    nome: "RouteSchedule",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `t."franchiseeId" = $1 AND (t."createdAt" >= now() - interval '3 days' OR t.status = 'PENDING')`,
    paiQuePodeFaltar: ["motoboyId"],
  },
  { nome: "StockItem", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"], mescla: { quantity: "soma" } },
  {
    nome: "StockTransaction",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["id"],
    foto: `t."franchiseeId" = $1 AND t."createdAt" >= now() - interval '1 day'`,
    paiQuePodeFaltar: ["stockLotId"],
  },
  // A ficha técnica: sem ela, o pedido aceito no computador não baixava
  // insumo nenhum (lib/stock.ts lê a receita do produto) e a volta não refaz
  // a baixa. Com ela, a baixa acontece no PC e sobe como StockTransaction
  // nova + StockItem.quantity pela regra "soma". A receita é cadastro da
  // nuvem: a loja só altera na queda, não cria.
  {
    nome: "ProductRecipe",
    loja: { tipo: "pai", coluna: "menuProductId", tabela: "MenuProduct", lojaDoPai: "franchiseeId" },
    chave: ["id"],
    foto: `t."menuProductId" IN (SELECT p.id FROM "MenuProduct" p WHERE p."franchiseeId" = $1)`,
    semLinhaNova: true,
  },
  // Tabelas criadas por SQL (fora do schema.prisma).
  { nome: "ClienteDaLoja", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["id"] },
  { nome: "AcrescimoDoPedido", loja: { tipo: "coluna", coluna: "franchiseeId" }, chave: ["id"] },
  { nome: "CashbackAjuste", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["id"] },
  { nome: "TransferenciaDoPedido", loja: { tipo: "coluna", coluna: "deLojaId", tambem: "paraLojaId" }, chave: ["id"] },
  { nome: "LancheDaEquipe", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["id"] },
  // Caixa de mercado (lib/caixa-mercado/estrutura.ts): o mercado vende sem
  // internet. Pedido (CustomerOrder), produto (MenuProduct) e o caixa da loja
  // (CashSession) já estão aqui.
  {
    nome: "CaixaMercadoAssinatura",
    loja: { tipo: "coluna", coluna: "franchiseeId" },
    chave: ["franchiseeId"],
    // Ligado, teste e trechos são a cobrança: descem (o caixa confere se está
    // ligado), mas a contingência não liga nem estica teste. `config` sobe
    // (etiqueta da balança, NFC-e, a cópia da chave Pix).
    naoSobem: ["ativo", "testeAte", "trechos"],
    semLinhaNova: true,
  },
  {
    nome: "CaixaMercadoTerminal",
    loja: { tipo: "coluna", coluna: "lojaId" },
    chave: ["id"],
    // O hash do cookie do computador do caixa (não é a senha): sem ele o caixa
    // não se reconhece no FireHub do computador. Desce, nunca sobe.
    permitirColunas: ["tokenHash"],
    naoSobem: ["tokenHash", "lojaId", "numero", "criadoEm", "criadoPor", "desativadoEm"],
    // Registrar computador de caixa é com internet (e cobra): a contingência não cria.
    semLinhaNova: true,
    ignorarMudancaDe: ["ultimoSinal"],
  },
  { nome: "CaixaMercadoUso", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["terminalId", "dia"], foto: `t."lojaId" = $1 AND t."em" >= now() - ${HISTORIA}` },
  { nome: "CaixaMercadoProduto", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["menuProductId"] },
  { nome: "CaixaMercadoCodigo", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["lojaId", "tipo", "codigo"] },
  { nome: "CaixaMercadoRegraNcm", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["lojaId", "ncm"] },
  { nome: "CaixaMercadoTurno", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["id"], foto: `t."lojaId" = $1 AND (t."fechadoEm" IS NULL OR t."abertoEm" >= now() - ${HISTORIA})` },
  { nome: "CaixaMercadoMovimento", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["id"], foto: `t."lojaId" = $1 AND t."em" >= now() - ${HISTORIA}` },
  { nome: "CaixaMercadoVenda", loja: { tipo: "coluna", coluna: "lojaId" }, chave: ["orderId"], foto: `t."lojaId" = $1 AND t."criadoEm" >= now() - ${HISTORIA}` },
  // Cadastro do cliente é global (o telefone é único no sistema todo): entra
  // o de quem já pediu na loja, e a foto é refeita de tempos em tempos.
  {
    nome: "StoreCustomer",
    loja: { tipo: "coluna", coluna: "id" },
    chave: ["id"],
    soPorFoto: true,
    foto: `t.phone IN (SELECT DISTINCT o."customerPhone" FROM "CustomerOrder" o WHERE o."franchiseeId" = $1 AND o."createdAt" >= now() - interval '180 days')`,
  },
];

/** Regra geral: coluna com cara de segredo não desce, salvo `permitirColunas`. */
export function colunaSecreta(coluna: string): boolean {
  return /(password|senha|secret|token|chavecifrada|apikey|api_key)/i.test(coluna);
}

/** As colunas que esta tabela não manda para o computador da loja. */
export function colunasQueNaoDescem(t: TabelaDaCopia, colunasDaTabela: string[]): string[] {
  const permitidas = new Set(t.permitirColunas || []);
  const fora = new Set(t.semColunas || []);
  for (const c of colunasDaTabela) if (colunaSecreta(c) && !permitidas.has(c)) fora.add(c);
  for (const c of permitidas) fora.delete(c);
  return [...fora];
}

export function tabelaDaCopia(nome: string): TabelaDaCopia | undefined {
  return TABELAS_DA_COPIA.find((t) => t.nome === nome);
}

/**
 * O que a loja grava nesta tabela durante a queda sobe na volta
 * (subida-no-banco.ts): toda tabela da cópia, menos as só de foto — exceto o
 * cliente, que sobe só como cadastro novo.
 */
export function sobeNaVolta(t: TabelaDaCopia): boolean {
  return !t.soPorFoto || t.nome === "StoreCustomer";
}

/** Identificador do registro na anotação de mudança: o id, ou a chave composta em JSON. */
export function idDoRegistro(t: TabelaDaCopia, linha: Record<string, unknown>): string {
  if (t.chave.length === 1) return String(linha[t.chave[0]] ?? "");
  return JSON.stringify(t.chave.map((c) => linha[c] ?? null));
}

/**
 * As FOTOS que a cópia leva (logo, capa, foto de produto e de categoria): a
 * coluna que guarda o endereço da imagem. O supervisor do computador baixa
 * para a pasta da cópia (contingencia/supervisor/fotos.ts) só o que é nosso
 * (/uploads/…) e o FireHub local serve de lá (UPLOADS_DIR) — sem internet, o
 * cardápio do balcão e do garçom aparece com foto. Vídeo da capa fica de fora
 * (pesa e não faz falta na queda).
 */
export const FOTOS_DA_COPIA: { tabela: string; coluna: string }[] = [
  { tabela: "MenuProduct", coluna: "imageUrl" },
  { tabela: "MenuCategory", coluna: "imageUrl" },
  { tabela: "User", coluna: "storeLogo" },
  { tabela: "User", coluna: "storeBanner" },
];

/** Extensões de imagem que o computador baixa (as que /uploads serve como imagem). */
const EXTENSOES_DE_FOTO = /\.(webp|jpe?g|png|gif)$/i;

/**
 * O caminho dentro de /uploads de um endereço de imagem da cópia, ou null se
 * não for imagem nossa: "/uploads/produtos/x.webp", "https://firehubfood.com.br/uploads/…"
 * e o mesmo com www viram "produtos/x.webp". Imagem de fora (CDN do iFood…)
 * não desce: o endereço dela não abriria sem internet de qualquer jeito.
 */
export function caminhoDaFoto(endereco: unknown): string | null {
  if (typeof endereco !== "string" || !endereco) return null;
  let caminho = endereco.trim();
  if (/^https?:\/\//i.test(caminho)) {
    try {
      const u = new URL(caminho);
      if (!/^(www\.)?firehubfood\.com\.br$/i.test(u.hostname)) return null;
      caminho = u.pathname;
    } catch {
      return null;
    }
  }
  caminho = caminho.split(/[?#]/)[0];
  if (!caminho.startsWith("/uploads/")) return null;
  const rel = caminho.slice("/uploads/".length);
  try {
    if (decodeURIComponent(rel) !== rel) return null; // nome com %xx: não é dos nossos
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9._\-/]+$/.test(rel) || rel.split("/").some((p) => !p || p === "." || p === "..")) return null;
  return EXTENSOES_DE_FOTO.test(rel) ? rel : null;
}
