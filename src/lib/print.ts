import { camposDeEntregaParaImpressao } from "./entrega-parceira";
import { camposDoEnderecoParaImpressao } from "./endereco-impresso";
import { comboParaImpressao } from "./parse-combo";
import { camposDoQrPuxar, qrLigadoNaImpressora } from "./qr-puxar";
import { camposDaCampanha, type BlocoDaCampanha, type CampanhaConverterConfig } from "./campanha-converter";
import { impressorasDaLoja } from "./loja-de-origem";
import { categoriasPedidas, impressoraDaViaDoEntregador, impressorasPeloPedidoSoDeBebida, itensQueContamParaAVia, itensDaImpressora, restoDoPedido, SUFIXO_DA_VIA_DO_ENTREGADOR, umaPorImpressora } from "./roteamento-de-impressao";
import { contaSaiNestaImpressora } from "./impressao-da-conta";
import { avisosDoPedido, blocosDaViaDoEntregador, blocosDoPedido, semValoresDaImpressora, type AvisosDesligados, type Bloco } from "./comanda-modelo";
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
  /** "CPF na nota" (só os dígitos). Ver lib/documento-do-cliente.ts. */
  customerCpfCnpj?: string | null;
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
// ⚠️ SÓ suba a versão NO MESMO COMMIT que trocar o instalador em
// public/downloads pelo build correspondente. Anunciar versão nova com
// instalador velho no site faz o auto-update de TODAS as lojas baixar e
// reinstalar a versão antiga em loop, a cada 6 horas, para sempre.
export const VERSAO_ASSISTENTE_ATUAL = "1.2.34";

/** "1.2.10" é mais nova que "1.2.9": compara por número, não por texto. */
export function versaoAssistenteAoMenos(versao: string | null | undefined, minima: string): boolean {
  if (!versao) return false;
  const a = String(versao).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(minima).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

/** Antes desta, cada reinício reimprimia as últimas horas: não havia confirmação no servidor. */
export const VERSAO_QUE_CONFIRMA_IMPRESSAO = "1.2.7";
/** Desde a 1.2.0 ele se atualiza sozinho — e, desde 24/09/2026, só com a loja parada. */
export const VERSAO_QUE_SE_ATUALIZA = "1.2.0";
/**
 * Teto zero: aberto, reiniciado ou atualizado, só imprime o que entrar depois,
 * e comanda presa desiste em 30 min (regra do dono em 24/09/2026).
 */
export const VERSAO_TETO_ZERO = "1.2.25";

/**
 * A partir daqui o Assistente imprime o "CPF na nota" em LINHA PRÓPRIA.
 *
 * Antes disso o documento saía colado no nome do cliente — a única forma de
 * ele aparecer no papel de toda loja sem ninguém atualizar nada, igual ao
 * pager (lib/documento-do-cliente.ts). O site continua mandando os dois: o
 * nome com o sufixo, para quem está atrás, e o campo `customerCpfCnpj`. Quem
 * tem esta versão tira o sufixo do nome sozinho, então o documento não sai
 * duas vezes — a decisão é do Assistente, não do site, e por isso não há nada
 * aqui para ligar ou desligar por loja.
 */
export const VERSAO_ASSISTENTE_COM_DOCUMENTO = "1.2.20";

/**
 * A partir daqui o Assistente imprime a CONTA DA MESA com rodape proprio:
 * consumo, desconto, taxa de servico e gorjeta, cada um na sua linha. Antes
 * disso taxa e gorjeta iam como ITEM, no meio dos pratos — foi reclamacao de
 * cliente em 15/09/2026 (ver src/lib/conta-da-mesa.ts).
 */
export const VERSAO_ASSISTENTE_COM_TAXA_SEPARADA = "1.2.15";

/**
 * O Assistente que imprime o DANFE NFC-e do emissor próprio (PrintRequest com
 * `kind` KIND_DANFE_NFCE): as linhas do cupom fiscal que o site monta
 * (lib/nfce/danfe.ts, danfeEmTexto) e o QR Code em ESC/POS.
 *
 * ── QUEM RECEBE O DANFE É DECIDIDO PELA CAPACIDADE, NÃO PELA VERSÃO ─────────
 * Esta constante dizia "1.2.24", e as 1.2.24 a 1.2.27 foram lançadas SEM o
 * DANFE (a versão andou com outras mudanças): a fila entregaria o DANFE a quem
 * não sabe imprimi-lo — uma comanda vazia com cara de cupom, o `printedAt`
 * carimbado pelo ack e o DANFE nunca mais de volta. Agora o Assistente que
 * imprime ANUNCIA, na consulta da fila, `&danfe=1` (PARAMETRO_DO_DANFE;
 * server.js → parametrosDeEstado); a fila (api/store/print-queue) guarda isso
 * no estado dele e só entrega o DANFE a quem anunciou — ver
 * `assistenteImprimeDanfe`. A versão fica só para o texto do aviso ("atualize
 * para a 1.2.28"): é a primeira com `buildDanfeEscPos`, lançada em 30/09/2026
 * (instalador em public/downloads + VERSAO_ASSISTENTE_ATUAL no mesmo commit).
 */
export const VERSAO_ASSISTENTE_COM_DANFE = "1.2.28";

/**
 * O parâmetro da consulta da fila com que o Assistente anuncia que imprime o
 * DANFE NFC-e (`&danfe=1` — firehub-print-assistant/server.js →
 * parametrosDeEstado). O Assistente que não sabe nem manda: fica sem DANFE.
 */
export const PARAMETRO_DO_DANFE = "danfe";

/**
 * O Assistente imprime o DANFE? Pelo estado que ELE contou na consulta da
 * fila (api/store/print-queue → estadoInformado, gravado em
 * User.printQueueEstado): só `imprimeDanfe: true`, que vem de `&danfe=1`. A
 * versão não conta — ver VERSAO_ASSISTENTE_COM_DANFE.
 */
export function assistenteImprimeDanfe(estado: unknown): boolean {
  return Boolean(estado && typeof estado === "object" && (estado as { imprimeDanfe?: unknown }).imprimeDanfe === true);
}

/** O `kind` do PrintRequest do DANFE NFC-e (lib/nfce/impressao-do-danfe.ts). */
export const KIND_DANFE_NFCE = "DANFE_NFCE";

export type EscPosProfile = "full" | "safe" | "legacy";

export type PrinterEntry = {
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
  /** Recebe o pedido que é SÓ bebida, e só ele (lib/roteamento-de-impressao.ts). */
  pedidoSoDeBebida?: boolean;
  /** Com pedidoSoDeBebida: também o pedido de comida com bebida, inteiro. */
  pedidoComBebida?: boolean;
  /** true = uma linha por unidade ("1x X-Bacon" cinco vezes). Ausente = agrupado. */
  separarItens?: boolean;
  /* Quais mundos esta impressora atende: salao, delivery, ou os dois.
     Ausente ou vazio = os dois, que e como toda loja configurada antes
     desta opcao existir continua funcionando. */
  modulos?: ModuloDePedido[];
  /* QR "puxar pedido" do motoboy no rodape da comanda de entrega.
     Ausente = LIGADO (nasce ligado em todas; a loja desliga onde nao quer). */
  qrPuxar?: boolean;
  /* Via do entregador: papel a mais no delivery da loja, com o pedido inteiro,
     valores e QR (lib/roteamento-de-impressao.ts). Ausente = desligado. */
  viaDoEntregador?: boolean;
  /* Recebe a conta da mesa (a impressao pedida no modulo de mesas).
     Ausente = automatico, decidido por lib/impressao-da-conta.ts. */
  contaDaMesa?: boolean;
  /* De quais LOJAS recebe pedido, quando a conta tem mais de uma na mesma
     integracao (tres marcas no iFood, duas no 99Food). Chaves de
     lib/loja-de-origem.ts. Ausente ou vazio = de todas. */
  lojas?: string[];
  /* QUAL MODELO DE COMANDA sai nesta impressora (lib/comanda-modelo.ts,
     `modelos[].id`). Ausente, vazio, ou apontando para modelo apagado = o
     modelo PADRAO da loja — a mesma regra de `modulos`: ausente significa "o
     de sempre", nunca "nenhum". Ninguem acorda com a impressora muda porque
     um campo novo apareceu. */
  modeloId?: string;
};

type PrinterConfig = {
  autoprint: boolean;
  autoBeverageTag?: boolean;
  customBeverageKeywords?: string;
  /* Herdado pela impressora detectada automaticamente (loja nova, sem printers[]). */
  defaultPaperWidth?: "58mm" | "80mm";
  defaultColumns?: number;
  printers: PrinterEntry[];
  /* Vem do GET /api/store/printer-config: monta a URL do QR do motoboy e a
     do QR da campanha. */
  storeSlug?: string;
  /* Campanha "converter para site próprio" (lib/campanha-converter.ts): se a
     comanda do iFood/99Food leva o bloco "VOCÊ GANHOU" e em qual impressora. */
  campanhaConverter?: CampanhaConverterConfig;
};

/**
 * A lista de impressoras no formato que o POST /config do Assistente espera.
 *
 * Duas telas mandam essa lista — Impressoras (botão Salvar) e a faixa
 * "Assistente não vinculado" do painel (botão Vincular agora). Um mapeamento
 * só, para as duas nunca divergirem: campo esquecido numa delas seria
 * impressora roteando de um jeito pelo navegador e de outro pela fila.
 */
export function printersParaAssistente(printers: Array<Pick<PrinterEntry, "name"> & Partial<PrinterEntry>>) {
  const lista = Array.isArray(printers) ? printers : [];
  return lista.map((pr) => ({
    name: pr.name,
    paperWidth: pr.paperWidth || "80mm",
    columns: pr.columns,
    escposProfile: pr.escposProfile,
    copies: pr.copies || 1,
    categories: pr.categories || [],
    // O Assistente antigo ignora o que não conhece; o novo usa para rotear o
    // que vem pela fila da nuvem.
    modulos: pr.modulos || [],
    somenteBebidas: pr.somenteBebidas === true,
    separarItens: pr.separarItens === true,
    qrPuxar: pr.qrPuxar !== false,
    contaDaMesa: contaSaiNestaImpressora(pr as any, lista as any),
    lojas: pr.lojas || [],
    // Qual modelo de comanda esta impressora usa. Esta lista e BRANCA: campo
    // esquecido aqui simplesmente nao existe para o Assistente.
    modeloId: pr.modeloId || "",
  }));
}

/* Impressora virtual não põe papel na mesa: PDF, XPS, OneNote, fax, "enviar
   para arquivo". A lista do Assistente vem na ordem do registro do Windows,
   onde essas costumam aparecer ANTES da térmica — e "a primeira da lista"
   mandava a comanda para o PDF com cara de OK. Mesma lista do Assistente
   (server.js, IMPRESSORA_VIRTUAL). */
const IMPRESSORA_VIRTUAL = /PDF|XPS|OneNote|Fax|PORTPROMPT|FILE:|nul:|SHRFAX|Microsoft Print/i;
function primeiraImpressoraFisica(lista: unknown): string {
  if (!Array.isArray(lista)) return "";
  const fisica = lista.find((p: any) => p?.name && !IMPRESSORA_VIRTUAL.test(`${p.name} ${p.driver || ""} ${p.port || ""}`));
  return fisica ? String(fisica.name) : "";
}

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
//
// Com cache curto: sem ele, cada pedido de cada rodada refazia as oito sondas
// (até 16 s quando não há Assistente na máquina), e por isso o ouvinte de
// impressão evitava tentar de novo — dando o pedido por impresso. A URL
// encontrada vale 60 s; "não achei" vale 20 s. Falha numa chamada real
// esquece o cache, para a próxima sondar de novo.
let urlDoAssistenteEmCache: { url: string | null; ate: number } | null = null;

function esquecerUrlDoAssistente() {
  urlDoAssistenteEmCache = null;
}

async function getAssistantUrl(): Promise<string | null> {
  if (urlDoAssistenteEmCache && Date.now() < urlDoAssistenteEmCache.ate) return urlDoAssistenteEmCache.url;
  for (const url of ASSISTANT_URLS) {
    try {
      const res = await fetchAssistente(`${url}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.ok) {
        urlDoAssistenteEmCache = { url, ate: Date.now() + 60_000 };
        return url;
      }
    } catch {}
  }
  urlDoAssistenteEmCache = { url: null, ate: Date.now() + 20_000 };
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
  somenteBebidas = false,
  /** true = uma linha por unidade no papel desta impressora. Ausente = agrupado. */
  separarItens = false,
  /** ESTA impressora imprime o QR do motoboy? Decidido por impressora, la no printOrder. */
  qrPuxar = true,
  /** O bloco da campanha "converter" para ESTA impressora (ausente = nao sai). */
  campanha?: BlocoDaCampanha,
  /** O modelo de comanda da loja. Ausente = layout embutido no Assistente. */
  blocos?: Bloco[],
  /** Os avisos que a loja desligou (aba Avisos). Ausente = todos ligados. */
  avisos?: AvisosDesligados
): Promise<{ ok: boolean; aguardando: boolean; semAssistente?: boolean; erro?: string }> {
  // `semAssistente`: ninguém respondeu neste computador — diferente de o
  // Assistente responder que a impressora falhou (aí vem `erro`).
  const nao = { ok: false, aguardando: false, semAssistente: true };
  try {
    const baseUrl = await getAssistantUrl();
    if (!baseUrl) return nao;

    let targetPrinter = printerName;
    if (!targetPrinter) {
      const printers = await fetchAssistente(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
      targetPrinter = primeiraImpressoraFisica(printers);
    }
    if (!targetPrinter) return nao;

    const res = await fetchAssistente(`${baseUrl}/print`, {
      method: "POST",
      // O Assistente imprime numa fila serial e responde quando ESTE job sai
      // (ou falha). Sem prazo, uma impressora travada segurava esta chamada
      // por minutos — e com ela o laço do ouvinte de impressão inteiro, que
      // só volta a olhar pedido novo quando esta promessa resolve. O job
      // continua na fila do Assistente depois do abort; quem volta a mandar
      // recebe "já impresso" ou "aguardando", nunca uma cópia.
      signal: AbortSignal.timeout(90_000),
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
          // O "CPF na nota" JÁ vem embutido no nome (lib/documento-do-cliente.ts)
          // — é assim que ele sai no papel em toda versão do Assistente. Este
          // campo é o aditivo: o Assistente de hoje ignora, o de amanhã imprime
          // em linha própria sem precisar de mudança aqui.
          customerCpfCnpj: (order as any).customerCpfCnpj,
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
          // O nome do app no "N. no 99Food:" quando a origem gravada é a
          // genérica (OPEN_DELIVERY); o Assistente lê `source` primeiro.
          openDeliveryChannel: (order as any).openDeliveryChannel,
          // ── QR "PUXAR PEDIDO" na comanda ────────────────────────────────
          // O código é só AAAAMMDD-numero — o mesmo número que já sai em corpo
          // dobrado no topo desta comanda, nada de segredo no papel. Quem
          // autoriza o puxar é a sessão assinada do motoboy logado no app.
          // Só em ENTREGA DA LOJA: comanda de mesa/balcão/parceira não tem o
          // que puxar (regra em lib/qr-puxar.ts, a mesma da fila da nuvem).
          // A marca é POR IMPRESSORA: a da cozinha pode ficar sem QR enquanto
          // a do balcão, que grampeia a via no saco, imprime. Assistente antigo
          // ignora campo desconhecido.
          ...(qrPuxar ? camposDoQrPuxar(order as any, (printerConfig as any)?.storeSlug) : {}),
          // ── CAMPANHA "CONVERTER PARA SITE PRÓPRIO" ──────────────────────
          // "VOCÊ GANHOU R$ X" em corpo dobrado + QR com o cupom, no fim da
          // comanda do iFood/99Food. Decidido no printOrder, por impressora
          // (lib/campanha-converter.ts). Assistente antigo ignora o campo.
          ...(campanha ? { campanha } : {}),
          // ── MODELO DA COMANDA (lib/comanda-modelo.ts) ───────────────────
          // A ORDEM das seções que a loja montou na tela. O conteúdo de cada
          // uma continua sendo montado pelo Assistente, com o mesmo código de
          // sempre — aqui vai só a ordem, o que aparece e o tamanho do que é
          // texto solto. Loja que nunca abriu a tela não manda nada e o
          // Assistente imprime o layout embutido; Assistente antigo ignora o
          // campo e faz a mesma coisa.
          ...(blocos && blocos.length ? { blocos } : {}),
          // Os avisos desligados na aba Avisos (Assistente 1.2.23+). Só vai o
          // que a loja desligou; Assistente antigo ignora e imprime todos.
          ...(avisos ? { avisos } : {}),
          // Quem entrega, decidido AQUI. O payload não mandava `deliveryBy`:
          // no Assistente o campo chegava vazio e sobrava o código de coleta
          // para decidir, então todo pedido do iFood com código saía com
          // "MOTOBOY IFOOD (ENTREGA PARCEIRA) - NAO USAR MOTOBOY DA LOJA!",
          // mesmo sendo entrega da própria loja. Ver lib/entrega-parceira.ts.
          //
          // A previsão de entrega vem pronta de quem chamou (o painel e o
          // ouvinte a calculam do pedido inteiro); o spread abaixo só a
          // substitui quando consegue calcular de novo. Assistente antigo ignora.
          previsaoEntrega: (order as any).previsaoEntrega,
          ...camposDeEntregaParaImpressao(order),
          source: (order as any).source,
          // O ENDEREÇO EM LINHAS (Rua / Número / Bairro…), e o mesmo endereço
          // rotulado numa linha só no customerAddress para o Assistente que
          // ainda não lê as linhas. Mesma regra da fila da nuvem
          // (lib/endereco-impresso.ts); a cidade da loja vem com a config
          // (/api/store/printer-config).
          ...camposDoEnderecoParaImpressao(order as any, (printerConfig as any)?.cidadeDaLoja),
          // Conta da mesa (src/lib/conta-da-mesa.ts): o Assistente novo imprime
          // o bloco por pessoa a partir de `rateio` e limpa o cupom por `kind`;
          // o antigo ignora campo que nao conhece.
          kind: (order as any).kind,
          rateio: (order as any).rateio,
          consumo: (order as any).consumo,
          taxaServico: (order as any).taxaServico,
          gorjeta: (order as any).gorjeta,
          // ── A TAXA DE SERVIÇO EM LINHA PRÓPRIA ─────────────────────────
          // Sem `taxaSeparada` o Assistente não sabe que a taxa ficou FORA dos
          // itens e desenha o rodapé de pedido comum: "Subtotal R$ 83,40" e
          // "Total R$ 91,74", sem dizer de onde vieram os R$ 8,34 (Delícias de
          // Casa, mesa 2, 01/10/2026). Era este trilho — o "Imprimir conta" do
          // painel sai primeiro pela impressora local — que descartava a marca;
          // a cópia certa da fila da nuvem chegava depois e era deduplicada.
          // O desconto da conta caía junto, pelo mesmo motivo.
          taxaSeparada: (order as any).taxaSeparada,
          descontoDaConta: (order as any).descontoDaConta,
          tableSessionId: (order as any).tableSessionId,
          // A mesa e o garçom (lib/mesa-na-comanda.ts): o Assistente 1.2.24 põe
          // "(3) MESA 4" no topo e o garçom logo abaixo. O antigo ignora — para
          // ele os dois já vão embutidos no nome do cliente.
          mesa: (order as any).mesa,
          garcom: (order as any).garcom,
          // O que desta comanda saiu em OUTRA impressora (ver printOrder).
          restoDoPedido: (order as any).restoDoPedido,
          // Comanda da cozinha. Assistente antigo ignora campo que não conhece,
          // então mandar isto para uma loja que ainda não atualizou o Assistente
          // não muda nada: o cupom sai como sempre saiu, com valores.
          semValores,
          // Quem decide o que e bebida e o Assistente: a lista de palavras
          // (com as do lojista) mora la, e duplica-la aqui criaria duas
          // verdades que divergem no dia em que alguem editar so uma.
          somenteBebidas,
          // Campo ADITIVO: Assistente que nao conhece ignora e agrupa, como sempre.
          separarItens,
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
    // `ok:false` com `aguardando` é o Assistente dizendo que este pedido
    // falhou nesta impressora e está PENDENTE lá: ele insiste sozinho até
    // sair. Não saiu ainda, mas ninguém precisa mandar de novo.
    if (data?.aguardando) console.warn(`[FireHub Print] ${targetPrinter}: ${data.message || "pendente no Assistente"}`);
    return {
      ok: data.ok === true,
      aguardando: data?.aguardando === true,
      // O /print responde 500 com { error: "Falha ao enviar dados para
      // impressora 'X' (Win32 N)" } quando o Windows recusa.
      erro: data?.ok === true ? undefined : String(data?.error || data?.message || "") || undefined,
    };
  } catch (err) {
    console.error("[FireHub Print]", err);
    esquecerUrlDoAssistente();
    return nao;
  }
}

/* ─── Função principal: imprime o pedido roteando por categoria ─ */
/** `impressoraEscolhida` de printOrder para "Todas" no modal de reimpressão. */
export const TODAS_AS_IMPRESSORAS = "*";

export async function printOrder(
  order: PrintOrder,
  storeName: string,
  printerConfig: PrinterConfig,
  itemCategories: Record<string, string> = {}, // { "item name" => "categoria" }
  force = false,
  /** Comanda da cozinha: mesmos itens, sem preço nenhum na folha. */
  semValores = false,
  /**
   * O botão "Cupom Completo (Com Valores)": a pessoa escolheu UM papel.
   *
   * Na Map Grill (04/10/2026), impressora única com o modelo "Cozinha sem
   * valores" e a via do entregador marcada, o botão soltava os dois papéis — a
   * comanda sem valores do modelo e a via. Escolha explícita vence o modelo:
   * com via do entregador, sai só ela (é o cupom completo, com o QR); sem via,
   * cada impressora imprime com valores, mesmo a que tem modelo sem valores.
   */
  cupomCompleto = false,
  /**
   * Reimpressão pelo modal do painel: o `name` de uma impressora, ou
   * TODAS_AS_IMPRESSORAS. Em qualquer dos dois sai o pedido INTEIRO em cada
   * destino, sem a regra de categoria, de "só bebidas" nem a via do
   * entregador: no modal a pessoa já escolheu com ou sem valores, e o papel é
   * o pedido (Douglas, 09/10/2026). Ausente = o roteamento de sempre.
   */
  impressoraEscolhida?: string
): Promise<{ success: boolean; printed: number; attempted: boolean; aguardando: boolean }> {
  const baseUrl = await getAssistantUrl();
  if (!baseUrl) return { success: false, printed: 0, attempted: false, aguardando: false };

  let printersToUse = printerConfig?.printers || [];
  if (!printersToUse.length || printersToUse.every(p => !p.name)) {
    const detected = await fetchAssistente(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
    const fisica = primeiraImpressoraFisica(detected);
    if (fisica) {
      printersToUse = [{
        id: "detected",
        name: fisica,
        label: "Impressora Padrão",
        categories: [],
        copies: 1,
        paperWidth: printerConfig?.defaultPaperWidth || "80mm",
        columns: printerConfig?.defaultColumns,
      }];
    }
  }

  if (!printersToUse.length) return { success: false, printed: 0, attempted: true, aguardando: false };
  /** Todas as cadastradas, antes dos filtros: a via do entregador escolhe entre elas. */
  const todasAsImpressoras = printersToUse;

  // ── DE QUE MUNDO E ESTE PEDIDO ─────────────────────────────────────────
  // Categoria nunca soube de onde o pedido veio: a impressora do balcao
  // cuspia a comanda do iFood no meio do salao, e nao havia como dizer
  // "esta aqui e so para o delivery".
  // (O modelo de comanda NÃO é resolvido aqui: ele é por IMPRESSORA, e sai
  //  dentro do laço lá embaixo. Resolver uma vez só entregava o modelo da
  //  primeira impressora para todas, e o defeito só aparece em loja com duas.)

  const modulo = moduloDoPedido((order as any).source);
  const doModulo = printersToUse.filter(p => impressoraAtendeModulo(p.modulos, modulo));

  // Nenhuma impressora configurada para este mundo: imprime em todas, em vez
  // de engolir o pedido. Mesma regra que ja vale para a categoria que nao
  // casa com ninguem — comanda que nao sai e prejuizo, comanda a mais e papel.
  printersToUse = doModulo.length > 0 ? doModulo : printersToUse;

  // ── DE QUAL LOJA E ESTE PEDIDO ───────────────────────────────────────────
  // Tres marcas no iFood no mesmo painel: a impressora da Ragnar Pizza nao
  // quer a comanda da Ragnar Burguer, e categoria/canal nao separam uma marca
  // da outra. Mesma regra da fila da nuvem (roteamento-de-impressao.ts), com o
  // mesmo resgate: nenhuma impressora marcada para esta loja = todas.
  printersToUse = impressorasDaLoja(printersToUse, order as any);

  // ── DE QUAL ANDAR E ESTA MESA ────────────────────────────────────────────
  // A impressora do terreo nao recebe a mesa do segundo andar, e a do andar da
  // mesa recebe a mesa INTEIRA (sem categoria, sem "so bebida"). Mesma regra da
  // fila da nuvem (lib/andares-da-mesa.ts); o numero vem do campo `mesa` que
  // ── CADA IMPRESSORA COM OS SEUS ITENS ──────────────────────────────────
  // Mesma regra da fila da nuvem (roteamento-de-impressao.ts): só bebida leva
  // o pedido inteiro e o Assistente separa; categoria leva o que é dela; e o
  // que NENHUMA impressora pediu vai para as que ficariam sem nada. Aqui a
  // categoria vem do cardápio aberto na tela (`itemCategories`), e o objeto
  // do item segue intacto para o papel.
  const itensComCategoria = order.items.map(item => ({
    item,
    category: itemCategories[item.name] || (item as any).category || "",
    // O que o "pedido só de bebida" olha além da categoria.
    name: item.name,
    isBeverage: (item as any).isBeverage === true || (item as any).menuProduct?.isBeverage === true,
    // As escolhas do combo com categoria (vêm do poll): a impressora do suco
    // recebe a linha do suco mesmo o combo sendo da cozinha.
    opcoesParaImpressao: (item as any).opcoesParaImpressao,
  }));
  const pedidoParaRotear = { source: (order as any).source, items: itensComCategoria };

  // Pedido só de bebida vai só para a impressora dele; os outros nunca vão
  // (mesma regra da fila, roteamento-de-impressao.ts). ANTES de deduplicar:
  // a mesma impressora cadastrada duas vezes — uma normal, outra de pedido só
  // de bebida — perderia a linha que viesse depois na lista.
  printersToUse = impressorasPeloPedidoSoDeBebida(
    printersToUse,
    pedidoParaRotear,
    printerConfig?.customBeverageKeywords
  );

  // Deduplica impressoras para a mesma impressora física não receber o pedido
  // 2x — com a linha de pedido só de bebida vencendo a comum (mesma regra da
  // fila, roteamento-de-impressao.ts → umaPorImpressora).
  const uniquePrinters = umaPorImpressora(printersToUse);

  const reimpressao = impressoraEscolhida !== undefined && impressoraEscolhida !== "";
  const nomeDe = (p: { name?: string }) => String(p.name || "").trim();
  // A mesma impressora em duas linhas recebe uma vez (vale a primeira linha).
  const destinosDaReimpressao = !reimpressao
    ? null
    : impressoraEscolhida === TODAS_AS_IMPRESSORAS
      ? todasAsImpressoras.filter((p, i, todas) => nomeDe(p) && todas.findIndex(q => nomeDe(q) === nomeDe(p)) === i)
      : todasAsImpressoras.filter(p => nomeDe(p) === impressoraEscolhida!.trim()).slice(0, 1);
  if (destinosDaReimpressao && destinosDaReimpressao.length === 0) return { success: false, printed: 0, attempted: true, aguardando: false };

  if (cupomCompleto && !semValores && !reimpressao) {
    const via = impressoraDaViaDoEntregador(todasAsImpressoras, order as any, []);
    if (via) {
      const r = await imprimirViaDoEntregador(via);
      return { success: r.ok, printed: r.ok ? 1 : 0, attempted: true, aguardando: r.aguardando };
    }
  }

  let printed = 0;
  // Alguma impressora respondeu "pendente no Assistente": ele vai insistir.
  let aguardando = false;

  const pedidas = categoriasPedidas(uniquePrinters, pedidoParaRotear);
  // Quem ficou com itens do pedido: é onde a via do entregador sai (abaixo).
  const receberam: { nome: string; itens: number }[] = [];

  for (const printer of destinosDaReimpressao || uniquePrinters) {
    if (!printer.name) continue;

    // Reimpressão pelo modal: o pedido inteiro, sem filtro de categoria.
    const daImpressora = reimpressao ? null : itensDaImpressora(printer, pedidoParaRotear, pedidas);
    // Nada deste pedido é desta impressora: o bar não recebe a comanda do
    // burger. (Antes saía o pedido inteiro — ver roteamento-de-impressao.ts.)
    if (daImpressora === null && !reimpressao) continue;
    const itemsToPrint = daImpressora ? daImpressora.map(i => i.item) : order.items;
    receberam.push({ nome: printer.name, itens: itensQueContamParaAVia(itemsToPrint) });

    // O que foi para as outras impressoras, para o papel desta dizer "Em outra
    // impressora (2 itens)" em vez de "Outros valores do pedido" (mesma regra
    // da fila da nuvem, lib/roteamento-de-impressao.ts). A de bebida recebe o
    // pedido inteiro e não imprime valores: não tem resto.
    const resto = printer.somenteBebidas || reimpressao ? undefined : restoDoPedido(order.items, itemsToPrint);
    const filteredOrder = { ...order, items: itemsToPrint, ...(resto ? { restoDoPedido: resto } : {}) };

    // ── CAMPANHA "CONVERTER PARA SITE PRÓPRIO" ────────────────────────────
    // Só em pedido do iFood/99Food, só na impressora que a loja escolheu,
    // nunca na comanda da cozinha. Regra em lib/campanha-converter.ts — a
    // mesma que a fila da nuvem aplica quando o painel não está aberto.
    const { campanha } = camposDaCampanha(
      order as any,
      { converter: printerConfig?.campanhaConverter },
      printerConfig?.storeSlug,
      printer.name,
      semValores
    );

    // Cupom completo pedido no botão: o modelo sem valores da impressora não
    // vale (cai no padrão da loja), senão o papel sai sem os valores pedidos.
    const modeloSemValores = semValoresDaImpressora(printerConfig, (printer as any).modeloId);
    const modeloId = cupomCompleto && modeloSemValores ? undefined : (printer as any).modeloId;
    const semValoresAqui = semValores || (!cupomCompleto && modeloSemValores);

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
      // O botão "Cupom da cozinha" força sem valores em todas; o modelo da
      // impressora ("Cozinha sem valores") força só nela.
      semValoresAqui,
      // Na reimpressão sai o pedido inteiro: o "só bebidas" não corta o papel.
      printer.somenteBebidas === true && !reimpressao,
      printer.separarItens === true,
      qrLigadoNaImpressora(printer, printerConfig as any),
      campanha,
      // ── O MODELO DESTA IMPRESSORA ───────────────────────────────────────
      //
      // A cozinha pode ter um modelo e o caixa outro. Resolvido AQUI, dentro
      // do laço, e não uma vez para o pedido todo: a versão anterior entregava
      // o mesmo modelo para todas as impressoras, e o defeito só aparecia em
      // loja com mais de uma. Impressora sem `modeloId` (inclusive a sintética
      // de resgate, que não tem cadastro) cai no modelo padrão da loja.
      blocosDoPedido(printerConfig, {
        semValores: semValoresAqui,
        modeloId,
      }),
      avisosDoPedido(printerConfig, { modeloId })
    );
    if (result.ok) printed++;
    if (result.aguardando) aguardando = true;
  }

  // ── A VIA DO ENTREGADOR (lib/roteamento-de-impressao.ts) ────────────────
  // O pedido inteiro, com valores, pagamento e o QR do motoboy, num papel a
  // mais na impressora marcada — a mesma regra da fila da nuvem. O id com
  // sufixo é o que impede o Assistente de tomá-la por segunda via da comanda
  // que acabou de sair na mesma impressora. O "Cupom da cozinha" não a leva.
  const daVia = semValores || reimpressao ? null : impressoraDaViaDoEntregador(todasAsImpressoras, order as any, receberam);
  if (daVia) {
    const via = await imprimirViaDoEntregador(daVia);
    if (via.aguardando) aguardando = true;
  }

  return { success: printed > 0, printed, attempted: true, aguardando };

  function imprimirViaDoEntregador(daVia: (typeof todasAsImpressoras)[number]) {
    return printToDevice(
      daVia.name,
      { ...order, id: String(order.id) + SUFIXO_DA_VIA_DO_ENTREGADOR } as PrintOrder,
      storeName,
      1,
      daVia.paperWidth || printerConfig?.defaultPaperWidth || "80mm",
      force,
      printerConfig,
      resolveColumns(daVia) ?? printerConfig?.defaultColumns,
      daVia.escposProfile,
      false,
      false,
      false,
      true,
      undefined,
      blocosDaViaDoEntregador(printerConfig),
      avisosDoPedido(printerConfig)
    );
  }
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
): Promise<{ ok: boolean; semAssistente: boolean; erro?: string }> {
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
  // A comanda de teste sai com o QR quando ESTA impressora esta marcada para
  // isso: e assim que o lojista descobre, antes do primeiro pedido, se a
  // impressora entende o comando de QR — ou se so o numero digitavel sai.
  const entrada = (printerConfig?.printers || []).find(p => p.name === printerName);
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
    escposProfile,
    // O modelo DESTA impressora decide: com "Cozinha sem valores" o teste
    // sai sem valores, que é o que o lojista quer conferir antes do pedido.
    semValoresDaImpressora(printerConfig, (entrada as any)?.modeloId),
    false,
    // Impressao de teste sai agrupada: ela existe para conferir o LAYOUT.
    entrada?.separarItens === true,
    qrLigadoNaImpressora(entrada, printerConfig as any),
    undefined,
    // O teste tem que sair com o MODELO da impressora, senão o lojista aperta
    // "Imprimir teste" para conferir o que acabou de montar e recebe outro
    // layout — e conclui que a tela não funciona.
    blocosDoPedido(printerConfig, {
      modeloId: (entrada as any)?.modeloId,
      semValores: semValoresDaImpressora(printerConfig, (entrada as any)?.modeloId),
    }),
    avisosDoPedido(printerConfig, { modeloId: (entrada as any)?.modeloId })
  ).then(r => ({ ok: r.ok, semAssistente: r.semAssistente === true, erro: r.erro }));
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
