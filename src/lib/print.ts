import { camposDeEntregaParaImpressao } from "./entrega-parceira";
import { comboParaImpressao } from "./parse-combo";
import {
  moduloDoPedido,
  impressoraAtendeModulo,
  type ModuloDePedido,
} from "@/lib/modulo-do-pedido";

/* ─────────────────────────────────────────────────────────────
   FireHub Print Engine
   Usa o Assistente FireHub (localhost:7891) para impressão
   ───────────────────────────────────────────────────────────── */

const ASSISTANT_URLS = [
  "http://localhost:7899", "http://127.0.0.1:7899",
  "http://localhost:7900", "http://127.0.0.1:7900",
  "http://localhost:7901", "http://127.0.0.1:7901",
  "http://localhost:7891", "http://127.0.0.1:7891",
];

/**
 * TODO fetch para o Assistente local passa por aqui — nunca por fetch() puro.
 *
 * ── POR QUE (Chrome 2026, "Local Network Access") ───────────────────────────
 *
 * O Chrome passou a exigir permissão do usuário para um site público falar com
 * localhost — e a requisição só entra na fila do prompt se DECLARAR o espaço
 * de endereço de destino. Sem a declaração o bloqueio é imediato e mudo:
 *
 *   "Permission was denied for this request to access the `loopback` address
 *    space."
 *
 * Foi assim que, em 27/08/2026, a tela de impressoras passou a dizer
 * "Desconectado" com o Assistente rodando e saudável na mesma máquina (visto
 * no Brasa Burguer e reproduzido aqui) — e a impressão disparada do navegador
 * morria do mesmo jeito, sem erro visível.
 *
 * O nome do valor mudou entre versões do spec ("local" → "loopback"), e valor
 * desconhecido faz o fetch LANÇAR TypeError na hora. Por isso a escada:
 * loopback → local → sem a opção (navegador antigo ignora chave desconhecida,
 * então o último degrau é o comportamento de sempre).
 *
 * Na primeira chamada o Chrome mostra "firehubfood.com.br quer acessar
 * dispositivos na sua rede" — a loja clica PERMITIR uma vez e a escolha fica
 * salva para o site inteiro (o WebSocket da tela de impressoras herda a
 * permissão; ele não tem como declarar o espaço sozinho).
 */
export async function fetchAssistente(url: string, init?: RequestInit): Promise<Response> {
  for (const espaco of ["loopback", "local"]) {
    try {
      return await fetch(url, { ...(init || {}), targetAddressSpace: espaco } as RequestInit);
    } catch (err) {
      // TypeError com a MENSAGEM do enum = valor que este Chrome não conhece:
      // tenta o próximo nome. Qualquer outra falha (rede, timeout, abort) é
      // real e sobe para o chamador tratar como sempre tratou.
      const msg = String((err as any)?.message || "");
      if (err instanceof TypeError && /targetAddressSpace|address space|enum/i.test(msg)) continue;
      throw err;
    }
  }
  return fetch(url, init);
}

type OrderItem = { name: string; qty: number; price: number; notes?: string };

type PrintOrder = {
  id: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryType: "DELIVERY" | "RETIRADA";
  paymentMethod: string;
  items: OrderItem[];
  totalAmount: number;
  deliveryFee?: number;
  notes?: string;
  createdAt?: string;
};

/**
 * Versão do Assistente que o site distribui hoje em /downloads.
 *
 * Serve para a tela de impressoras dizer à loja que o programa dela está
 * velho. O Assistente não tem atualização automática: cada loja fica na versão
 * do dia em que instalou, e a única forma de perceber era comparar comandas
 * impressas lado a lado.
 *
 * MANTENHA IGUAL a firehub-print-assistant/package.json ao gerar um instalador.
 */
// ⚠️ SÓ suba para "1.2.3" NO MESMO COMMIT que trocar o instalador em
// public/downloads pelo build 1.2.3. Anunciar versão nova com instalador
// velho no site faz o auto-update de TODAS as lojas baixar e reinstalar o
// 1.2.2 em loop, a cada 6 horas, para sempre.
export const VERSAO_ASSISTENTE_ATUAL = "1.2.2";

export type EscPosProfile = "full" | "safe" | "legacy";

type PrinterEntry = {
  id: string;
  name: string;
  label: string;
  categories: string[];
  copies: number;
  paperWidth?: "58mm" | "80mm";
  /* Escape hatch: largura REAL medida pela regua de calibracao.
     Vazio = usa o padrao da bobina (80mm -> 48 / 58mm -> 32). */
  columns?: number;
  /* Perfil de preambulo ESC/POS. Assistentes antigos ignoram este campo. */
  escposProfile?: EscPosProfile;
  /* So bebida: mesmo dentro de combo, so a bebida sai nesta impressora. */
  somenteBebidas?: boolean;
  /* Quais mundos esta impressora atende: salao, delivery, ou os dois.
     Ausente ou vazio = os dois, que e como toda loja configurada antes
     desta opcao existir continua funcionando. */
  modulos?: ModuloDePedido[];
};

type PrinterConfig = {
  autoprint: boolean;
  autoBeverageTag?: boolean;
  customBeverageKeywords?: string;
  /* Herdado pela impressora detectada automaticamente (loja nova, sem printers[]). */
  defaultPaperWidth?: "58mm" | "80mm";
  defaultColumns?: number;
  printers: PrinterEntry[];
};

/* ─── Fonte unica da verdade da largura no site ──────────────
   Devolve undefined quando NAO ha calibracao. Assim o body do POST
   sai byte-a-byte igual ao de hoje e o assistente mantem o
   comportamento atual (32 ou 48 colunas). */
export function resolveColumns(p?: { paperWidth?: string; columns?: number } | null): number | undefined {
  const c = Number(p?.columns);
  if (Number.isFinite(c) && c >= 24 && c <= 64) return Math.floor(c);
  return undefined;
}

/* ─── Tenta obter URL ativa do assistente (localhost ou 127.0.0.1) ── */
async function getAssistantUrl(): Promise<string | null> {
  for (const url of ASSISTANT_URLS) {
    try {
      const res = await fetchAssistente(`${url}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.ok) return url;
    } catch {}
  }
  return null;
}

/* ─── Verifica se o assistente está rodando ──────────────── */
async function isAssistantRunning(): Promise<boolean> {
  const activeUrl = await getAssistantUrl();
  return activeUrl !== null;
}

/* ─── Imprime em uma impressora específica ───────────────── */
async function printToDevice(
  printerName: string,
  order: PrintOrder,
  storeName: string,
  copies = 1,
  paperWidth = "80mm",
  force = false,
  printerConfig?: PrinterConfig,
  columns?: number,
  escposProfile?: EscPosProfile,
  semValores = false,
  somenteBebidas = false
): Promise<boolean> {
  try {
    const baseUrl = await getAssistantUrl();
    if (!baseUrl) return false;

    let targetPrinter = printerName;
    if (!targetPrinter) {
      const printers = await fetchAssistente(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
      if (Array.isArray(printers) && printers.length > 0) {
        targetPrinter = printers[0].name;
      }
    }
    if (!targetPrinter) return false;

    const res = await fetchAssistente(`${baseUrl}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printer: targetPrinter,
        paperWidth,
        force,
        /* Aditivos: assistente antigo ignora campo que nao conhece.
           O assistente ja instalado nas lojas honra "columns" em
           cols = columns || (paperWidth === "58mm" ? 32 : 48). */
        ...(columns ? { columns } : {}),
        ...(escposProfile ? { escposProfile } : {}),
        printerConfig: {
          autoBeverageTag: (printerConfig as any)?.autoBeverageTag !== false,
          customBeverageKeywords: (printerConfig as any)?.customBeverageKeywords || "",
        },
        order: {
          id: order.id,
          dailyOrderNumber: (order as any).dailyOrderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType,
          paymentMethod: order.paymentMethod,
          // `comboSelections` sai daqui SEMPRE como lista. O combo do cardápio
          // online é gravado como `{ grupoId: { nome: qtd } }`, e o Assistente
          // só sabe ler array: descartava o objeto inteiro e a comanda saía com
          // o nome do combo e mais nada. Ver `comboParaImpressao`.
          items: order.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, notes: i.notes, comboSelections: comboParaImpressao((i as any).comboSelections) })),
          totalAmount: order.totalAmount,
          deliveryFee: order.deliveryFee,
          discountTotal: (order as any).discountTotal,
          discountIfood: (order as any).discountIfood,
          discountMerchant: (order as any).discountMerchant,
          // Detalhe do desconto (ex.: "Cupom HAKIM10 (-10%)") para a comanda
          // dizer POR QUE o total ficou menor que a soma dos itens.
          discountDetails: (order as any).discountDetails,
          changeAmount: (order as any).changeAmount,
          ifoodReference: (order as any).ifoodReference,
          // DE QUAL loja iFood veio, quando a conta tem mais de uma. Sem isto a
          // comanda de Ragnar Pizza sai idêntica à de Ragnar Burguer e o
          // atendente não sabe em qual saco vai. Assistente antigo ignora campo
          // que não conhece, então quem não atualizou imprime como sempre.
          ifoodStoreName: (order as any).ifoodStoreName,
          openDeliveryReference: (order as any).openDeliveryReference,
          // Quem entrega, decidido AQUI. O payload não mandava `deliveryBy`:
          // no Assistente o campo chegava vazio e sobrava o código de coleta
          // para decidir, então todo pedido do iFood com código saía com
          // "MOTOBOY IFOOD (ENTREGA PARCEIRA) - NAO USAR MOTOBOY DA LOJA!",
          // mesmo sendo entrega da própria loja. Ver lib/entrega-parceira.ts.
          ...camposDeEntregaParaImpressao(order),
          source: (order as any).source,
          // Comanda da cozinha. Assistente antigo ignora campo que não conhece,
          // então mandar isto para uma loja que ainda não atualizou o Assistente
          // não muda nada: o cupom sai como sempre saiu, com valores.
          semValores,
          // Quem decide o que e bebida e o Assistente: a lista de palavras
          // (com as do lojista) mora la, e duplica-la aqui criaria duas
          // verdades que divergem no dia em que alguem editar so uma.
          somenteBebidas,
          notes: order.notes,
          createdAt: order.createdAt,
          printerConfig: {
            autoBeverageTag: (printerConfig as any)?.autoBeverageTag !== false,
            customBeverageKeywords: (printerConfig as any)?.customBeverageKeywords || "",
          },
        },
        storeName,
        copies,
      }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.error("[FireHub Print]", err);
    return false;
  }
}

/* ─── Função principal: imprime o pedido roteando por categoria ─ */
export async function printOrder(
  order: PrintOrder,
  storeName: string,
  printerConfig: PrinterConfig,
  itemCategories: Record<string, string> = {}, // { "item name" => "categoria" }
  force = false,
  /** Comanda da cozinha: mesmos itens, sem preço nenhum na folha. */
  semValores = false
): Promise<{ success: boolean; printed: number; attempted: boolean }> {
  const baseUrl = await getAssistantUrl();
  if (!baseUrl) return { success: false, printed: 0, attempted: false };

  let printersToUse = printerConfig?.printers || [];
  if (!printersToUse.length || printersToUse.every(p => !p.name)) {
    const detected = await fetchAssistente(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
    if (Array.isArray(detected) && detected.length > 0) {
      printersToUse = [{
        id: "detected",
        name: detected[0].name,
        label: "Impressora Padrão",
        categories: [],
        copies: 1,
        paperWidth: printerConfig?.defaultPaperWidth || "80mm",
        columns: printerConfig?.defaultColumns,
      }];
    }
  }

  if (!printersToUse.length) return { success: false, printed: 0, attempted: true };

  // ── DE QUE MUNDO E ESTE PEDIDO ─────────────────────────────────────────
  // Categoria nunca soube de onde o pedido veio: a impressora do balcao
  // cuspia a comanda do iFood no meio do salao, e nao havia como dizer
  // "esta aqui e so para o delivery".
  const modulo = moduloDoPedido((order as any).source);
  const doModulo = printersToUse.filter(p => impressoraAtendeModulo(p.modulos, modulo));

  // Nenhuma impressora configurada para este mundo: imprime em todas, em vez
  // de engolir o pedido. Mesma regra que ja vale para a categoria que nao
  // casa com ninguem — comanda que nao sai e prejuizo, comanda a mais e papel.
  printersToUse = doModulo.length > 0 ? doModulo : printersToUse;

  // Deduplica impressoras para a mesma impressora física não receber o pedido 2x
  const uniquePrinters: PrinterEntry[] = [];
  const seenPrinterNames = new Set<string>();
  for (const p of printersToUse) {
    const key = (p.name || "").toLowerCase().trim();
    if (key && !seenPrinterNames.has(key)) {
      seenPrinterNames.add(key);
      uniquePrinters.push(p);
    }
  }

  let printed = 0;

  for (const printer of uniquePrinters) {
    if (!printer.name) continue;

    // Filtra itens por categoria se configurado
    let itemsToPrint = order.items;

    // Impressora so de bebida NAO passa pelo filtro de categoria, e isso e o
    // ponto: o "Combo 2 + Guaravita" tem categoria "Combos", entao o filtro o
    // descartava — e caia no resgate de 'nenhum item casou, imprime tudo',
    // que mandava o combo INTEIRO para a impressora do bar. Aqui vai o pedido
    // completo e o Assistente extrai so as bebidas, inclusive as de dentro do
    // combo. Sem bebida nenhuma, ele nao imprime nada.
    if (printer.somenteBebidas) {
      itemsToPrint = order.items;
    } else if (printer.categories && printer.categories.length > 0) {
      const matchesChannel = printer.categories.some(c => {
        const cLower = c.toLowerCase().trim();
        const srcLower = (order as any).source?.toLowerCase()?.trim() || "";
        return cLower === srcLower || (cLower === "ifood" && srcLower === "ifood") || (cLower === "jotaja" && srcLower === "jotaja") || (cLower === "jotajá" && srcLower === "jotaja");
      });

      if (!matchesChannel) {
        itemsToPrint = order.items.filter(item => {
          const cat = (itemCategories[item.name] || (item as any).category || "").toLowerCase().trim();
          return printer.categories.some(c => c.toLowerCase().trim() === cat);
        });
      }

      // Se nenhum item foi filtrado (ex: nome da categoria sutilmente diferente), imprime tudo para não perder o pedido!
      if (itemsToPrint.length === 0) {
        itemsToPrint = order.items;
      }
    }

    const filteredOrder = { ...order, items: itemsToPrint };
    const result = await printToDevice(
      printer.name,
      filteredOrder,
      storeName,
      printer.copies || 1,
      printer.paperWidth || printerConfig?.defaultPaperWidth || "80mm",
      force,
      printerConfig,
      resolveColumns(printer) ?? printerConfig?.defaultColumns,
      printer.escposProfile,
      semValores,
      printer.somenteBebidas === true
    );
    if (result) printed++;
  }

  return { success: printed > 0, printed, attempted: true };
}

/* ─── Comanda de teste ─────────────────────────────────────
   NAO usa /print-test: aquela rota ignora "columns" no assistente ja
   instalado e sempre calcula 32/48 a partir do paperWidth. O POST /print
   honra columns hoje, sem reinstalar nada — entao o teste passa a refletir
   de verdade a largura configurada pelo lojista. */
export async function printTestReceipt(
  printerName: string,
  storeName: string,
  paperWidth: "58mm" | "80mm" = "80mm",
  columns?: number,
  printerConfig?: PrinterConfig,
  escposProfile?: EscPosProfile
): Promise<boolean> {
  const larguraTxt = columns ? `${paperWidth} / ${columns} col` : paperWidth;
  const dummy = {
    /* id unico: evita a trava anti-duplo-clique de 5s do assistente */
    id: `TESTE_${Date.now()}`,
    dailyOrderNumber: "000",
    customerName: "Cliente Teste FireHub",
    customerPhone: "(00) 00000-0000",
    customerAddress: "Rua Exemplo de Endereco Bem Longo Para Testar Quebra, 1234 - Bairro Modelo - Cidade/UF",
    deliveryType: "DELIVERY" as const,
    paymentMethod: "Pix (Online)",
    items: [
      { name: "Item Teste com Nome Longo Para Medir Largura", qty: 1, price: 15.0 },
      { name: "Item Teste 2", qty: 2, price: 10.0 },
    ],
    totalAmount: 35.0,
    deliveryFee: 5.99,
    notes: `Impressao de Teste FireHub (${larguraTxt})`,
    createdAt: new Date().toISOString(),
  };
  return printToDevice(
    printerName,
    dummy as any,
    storeName,
    1,
    paperWidth,
    true,
    /* config real da loja: sem ela a tarja de bebida cairia no default ligado */
    printerConfig || ({ autoprint: true, autoBeverageTag: false, printers: [] } as PrinterConfig),
    columns,
    escposProfile
  );
}

/* ─── Regua de calibracao de largura ───────────────────────
   Usa /print-raw, que existe no assistente ja instalado e envia os bytes
   verbatim (sem preambulo nenhum): controlamos 100% do stream a partir do
   navegador. Cada variacao comeca com ESC @ para isolar o estado da anterior.
   O lojista acha a ultima linha "CABE N" que NAO quebrou e digita esse N
   no campo de colunas reais. */
const RULER_VARIANTS: Array<{ n: string; cmd: number[] }> = [
  { n: "A: INIT ANTIGO (exe atual da loja)", cmd: [0x1b, 0x74, 0x03] },
  { n: "B: + ESC M 0 (forca Fonte A)",       cmd: [0x1b, 0x74, 0x03, 0x1b, 0x4d, 0x00] },
  { n: "C: + ESC SP 0 (espacamento 0)",      cmd: [0x1b, 0x74, 0x03, 0x1b, 0x20, 0x00] },
  { n: "D: + GS W 576 (area 80mm)",          cmd: [0x1b, 0x74, 0x03, 0x1d, 0x57, 0x40, 0x02] },
  { n: "E: PERFIL SAFE (novo padrao)",       cmd: [0x1b, 0x74, 0x03, 0x1b, 0x4d, 0x00, 0x1b, 0x21, 0x00, 0x1b, 0x20, 0x00] },
  { n: "F: PERFIL FULL (safe + geometria)",  cmd: [0x1b, 0x74, 0x03, 0x1b, 0x52, 0x00, 0x1b, 0x4d, 0x00, 0x1b, 0x21, 0x00, 0x1b, 0x20, 0x00, 0x1b, 0x32, 0x1d, 0x4c, 0x00, 0x00, 0x1d, 0x57, 0x40, 0x02] },
];

/* Base64 sem espalhar o array inteiro em String.fromCharCode (estoura a pilha) */
function bytesToBase64(bytes: number[]): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b & 0xff);
  return btoa(bin);
}

export async function printWidthRuler(printerName: string): Promise<boolean> {
  try {
    const baseUrl = await getAssistantUrl();
    if (!baseUrl) return false;

    const b: number[] = [];
    const put = (str: string) => { for (const ch of str) b.push(ch.charCodeAt(0) & 0xff); };
    const line = (str: string) => { put(str); b.push(0x0a); };

    const tens  = Array.from({ length: 60 }, (_, i) => String(Math.floor((i + 1) / 10) % 10)).join("");
    const units = Array.from({ length: 60 }, (_, i) => String((i + 1) % 10)).join("");
    const fit = (n: number) => `CABE ${n} `.padEnd(n - 1, ".") + "|";

    b.push(0x1b, 0x40);
    b.push(0x1b, 0x61, 0x01); line("FIREHUB - REGUA DE LARGURA"); b.push(0x1b, 0x61, 0x00);
    line(`Impressora: ${printerName || "(padrao)"}`);
    line("1) Ache a ULTIMA linha CABE que NAO quebrou.");
    line("2) Anote o numero dela no bloco A e no bloco E.");
    b.push(0x0a);

    for (const v of RULER_VARIANTS) {
      b.push(0x1b, 0x40); // reset total isola cada variacao
      for (const cmd of v.cmd) b.push(cmd);
      line(`--- ${v.n} ---`);
      line(tens);
      line(units);
      for (const n of [32, 40, 42, 44, 46, 48]) line(fit(n));
      b.push(0x0a);
    }
    b.push(0x1b, 0x61, 0x00);             // volta para LEFT: nao deixa estado sujo
    b.push(0x1b, 0x64, 0x04, 0x1d, 0x56, 0x00);

    const res = await fetchAssistente(`${baseUrl}/print-raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printer: printerName, data: bytesToBase64(b) }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.error("[FireHub Print] Regua:", err);
    return false;
  }
}
