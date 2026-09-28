/**
 * A API do Asaas NA CONTA DO LOJISTA (a chave que ele colou em Minha Loja).
 *
 * Não confundir com lib/asaas.ts: aquele usa a chave do FireHub para cobrar a
 * mensalidade e os pedidos de insumo. Aqui toda chamada leva a chave DA LOJA,
 * então a cobrança, o cliente e o saldo são dela.
 *
 * Não toca no banco — só HTTP. Quem grava é lib/pix-online-pedido.ts e a rota
 * /api/store/asaas. Isso deixa o arquivo testável contra um Asaas falso
 * (`ASAAS_API_BASE_LOJA`, scripts/teste-pix-online.ts).
 *
 * Referência: docs.asaas.com (lida em 25/09/2026). Nomes de campo e eventos
 * conferidos na especificação de cada endpoint.
 */
import { getAsaasKey } from "@/lib/asaas";

export type Ambiente = "producao" | "sandbox";

export type RespostaAsaas<T = any> = {
  ok: boolean;
  status: number;
  dados: T | null;
  /** A primeira mensagem de erro do Asaas, já legível, ou a do transporte. */
  erro: string | null;
};

/** Aceita a chave com ou sem o `$` inicial, com espaço ou aspas coladas junto. */
export function normalizarChave(bruta: string | null | undefined): string | null {
  const limpa = String(bruta || "").replace(/[\s"'`]/g, "");
  if (!limpa) return null;
  const comCifrao = limpa.startsWith("$") ? limpa : `$${limpa}`;
  if (!comCifrao.startsWith("$aact_")) return null;
  if (comCifrao.length < 30) return null;
  return comCifrao;
}

/** Chave de produção começa com `$aact_prod`; o resto é Sandbox. */
export function ambienteDaChave(chave: string): Ambiente {
  return chave.startsWith("$aact_prod") ? "producao" : "sandbox";
}

export function baseDaApi(ambiente: Ambiente): string {
  const teste = (process.env.ASAAS_API_BASE_LOJA || "").trim();
  if (teste) return teste.replace(/\/$/, "");
  return ambiente === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

function mensagemDeErro(dados: any, status: number): string {
  const primeira = dados?.errors?.[0]?.description;
  if (primeira) return String(primeira);
  if (status === 401) return "O Asaas recusou a chave de API (inválida, desativada ou excluída).";
  if (status === 403) return "O Asaas bloqueou o acesso. Confira se a Whitelist de IPs está desligada em Integrações.";
  if (status === 404) return "O Asaas não encontrou o que foi pedido.";
  if (status === 429) return "O Asaas pediu para esperar (muitas requisições). Tente de novo em instantes.";
  return `O Asaas respondeu com erro ${status}.`;
}

export async function asaasDaLoja<T = any>(
  chave: string,
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<RespostaAsaas<T>> {
  const url = `${baseDaApi(ambienteDaChave(chave))}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
  try {
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: {
        access_token: chave,
        "Content-Type": "application/json",
        "User-Agent": "firehub-pix-online/1.0",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const texto = await res.text();
    let dados: any = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = null;
    }
    return { ok: res.ok, status: res.status, dados: res.ok ? dados : null, erro: res.ok ? null : mensagemDeErro(dados, res.status) };
  } catch (err: any) {
    const tempo = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      dados: null,
      erro: tempo ? "O Asaas demorou para responder. Tente de novo." : `Sem conexão com o Asaas: ${err?.message || err}`,
    };
  }
}

// ─── A CONTA ────────────────────────────────────────────────────────────────

export type SituacaoDaConta = "APPROVED" | "PENDING" | "REJECTED" | "AWAITING_APPROVAL" | "DESCONHECIDA";

export type ContaDoAsaas = {
  ambiente: Ambiente;
  walletId: string | null;
  nome: string;
  cpfCnpj: string | null;
  tipoDePessoa: "JURIDICA" | "FISICA" | null;
  /** `general` de /myAccount/status: APPROVED é a única que recebe. */
  situacao: SituacaoDaConta;
  /** Quais partes do cadastro faltam, na língua do lojista. */
  pendenciasDoCadastro: string[];
  chavesPixAtivas: { tipo: string; chave: string }[];
  /** O site dos dados comerciais: decide se o cartão pode voltar sozinho (`mesmoDominio`). */
  site: string | null;
};

/**
 * O Asaas só devolve o cliente ao site (`callback.successUrl`) se a URL for do
 * MESMO domínio do site cadastrado nos dados comerciais da conta
 * (docs.asaas.com/docs/redirecionamento-apos-o-pagamento). "www." não conta.
 */
export function mesmoDominio(site: string | null | undefined, url: string): boolean {
  const dominio = (v: string) => {
    try {
      return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const a = dominio(String(site || "").trim());
  return Boolean(a) && a === dominio(url);
}

const PARTES_DO_CADASTRO: Record<string, string> = {
  commercialInfo: "dados comerciais",
  bankAccountInfo: "conta bancária",
  documentation: "documentos",
};

/**
 * Lê o que a conexão precisa saber da conta. Uma resposta 401 aqui é a chave
 * ruim — o chamador mostra `erro` ao lojista como está.
 */
export async function lerContaDoAsaas(chave: string): Promise<RespostaAsaas<ContaDoAsaas>> {
  const [carteiras, status, comercial, chaves] = await Promise.all([
    asaasDaLoja(chave, "/wallets/"),
    asaasDaLoja(chave, "/myAccount/status/"),
    asaasDaLoja(chave, "/myAccount/commercialInfo/"),
    asaasDaLoja(chave, "/pix/addressKeys?status=ACTIVE"),
  ]);

  // A carteira é o que prova que a chave abre a conta; sem ela, nada adiante.
  if (!carteiras.ok) return { ok: false, status: carteiras.status, dados: null, erro: carteiras.erro };

  const walletId: string | null = carteiras.dados?.data?.[0]?.id ?? carteiras.dados?.id ?? null;
  const geral = String(status.dados?.general || "").toUpperCase();
  const situacao: SituacaoDaConta = ["APPROVED", "PENDING", "REJECTED", "AWAITING_APPROVAL"].includes(geral)
    ? (geral as SituacaoDaConta)
    : "DESCONHECIDA";

  const pendenciasDoCadastro: string[] = [];
  for (const [campo, rotulo] of Object.entries(PARTES_DO_CADASTRO)) {
    const s = String(status.dados?.[campo] || "").toUpperCase();
    if (s === "REJECTED") pendenciasDoCadastro.push(`${rotulo} recusados — reenvie no Asaas`);
    else if (s === "PENDING") pendenciasDoCadastro.push(`${rotulo} não enviados`);
    else if (s === "AWAITING_APPROVAL") pendenciasDoCadastro.push(`${rotulo} em análise`);
  }

  const c = comercial.dados || {};
  const lista: any[] = Array.isArray(chaves.dados?.data) ? chaves.dados.data : [];

  return {
    ok: true,
    status: 200,
    erro: null,
    dados: {
      ambiente: ambienteDaChave(chave),
      walletId,
      nome: String(c.companyName || c.tradingName || c.name || "Conta Asaas"),
      cpfCnpj: c.cpfCnpj ? String(c.cpfCnpj) : null,
      tipoDePessoa: c.personType === "JURIDICA" || c.personType === "FISICA" ? c.personType : null,
      situacao,
      pendenciasDoCadastro,
      chavesPixAtivas: lista
        .filter((k) => String(k.status || "").toUpperCase() === "ACTIVE")
        .map((k) => ({ tipo: String(k.type || ""), chave: String(k.key || "") })),
      site: c.site ? String(c.site).trim() || null : null,
    },
  };
}

/** Cria uma chave Pix aleatória (EVP) — a única que a API cria. */
export async function criarChavePixAleatoria(chave: string) {
  return asaasDaLoja(chave, "/pix/addressKeys", { method: "POST", body: { type: "EVP" } });
}

// ─── WEBHOOK ────────────────────────────────────────────────────────────────

/**
 * Os eventos que o FireHub ouve na conta da loja. Pix dispara PAYMENT_RECEIVED
 * direto (não passa por CONFIRMED); CONFIRMED fica por segurança.
 */
export const EVENTOS_DO_WEBHOOK = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS",
  "PAYMENT_DELETED",
  // Cartão reprovado pelo antifraude do Asaas.
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  // O split da taxa do pagamento online foi cancelado ou bloqueado.
  "PAYMENT_SPLIT_DONE",
  "PAYMENT_SPLIT_CANCELLED",
  "PAYMENT_SPLIT_DIVERGENCE_BLOCK",
  "ACCESS_TOKEN_DISABLED",
  "ACCESS_TOKEN_DELETED",
  "ACCESS_TOKEN_EXPIRED",
] as const;

export async function criarWebhookNaLoja(
  chave: string,
  opts: { url: string; email: string; authToken: string },
): Promise<RespostaAsaas<{ id: string }>> {
  return asaasDaLoja(chave, "/webhooks", {
    method: "POST",
    body: {
      name: "FireHub — pagamento pelo cardápio",
      url: opts.url,
      email: opts.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: opts.authToken,
      sendType: "SEQUENTIALLY",
      events: EVENTOS_DO_WEBHOOK,
    },
  });
}

export async function removerWebhookDaLoja(chave: string, webhookId: string) {
  return asaasDaLoja(chave, `/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
}

// ─── CLIENTE E COBRANÇA ─────────────────────────────────────────────────────

/**
 * O cliente do Asaas para quem paga, SEM notificação.
 *
 * Notificação do Asaas é cobrada da loja (R$ 0,99 o pacote e-mail+SMS por
 * cobrança, R$ 0,55 cada WhatsApp). Um cliente que a loja já tenha cadastrado
 * por conta própria NÃO é alterado — pode ser alguém que ela cobra por boleto
 * e quer que receba aviso. Nesse caso nasce um cadastro novo, marcado.
 */
export async function clienteSemAvisos(
  chave: string,
  pagador: { nome: string; cpf: string; telefone?: string | null },
): Promise<RespostaAsaas<{ id: string }>> {
  const cpf = pagador.cpf.replace(/\D/g, "");
  const busca = await asaasDaLoja(chave, `/customers?cpfCnpj=${cpf}&limit=20`);
  if (busca.ok) {
    const existente = (busca.dados?.data || []).find(
      (c: any) => c.notificationDisabled === true && !c.deleted,
    );
    if (existente?.id) return { ok: true, status: 200, dados: { id: existente.id }, erro: null };
  }
  const celular = String(pagador.telefone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return asaasDaLoja(chave, "/customers", {
    method: "POST",
    body: {
      name: pagador.nome.slice(0, 100) || "Cliente do cardápio",
      cpfCnpj: cpf,
      ...(celular.length >= 10 ? { mobilePhone: celular } : {}),
      notificationDisabled: true,
      externalReference: "firehub-cardapio",
      observations: "Cadastrado pelo FireHub (pagamento pelo cardápio). Sem notificações do Asaas.",
    },
  });
}

export type CobrancaGerada = {
  cobrancaId: string;
  valor: number;
  /** A taxa do pagamento online que foi no split (0 = sem split). */
  split: number;
  /**
   * Preenchido quando o split foi PEDIDO e o Asaas recusou: a cobrança saiu
   * sem ele (a venda da loja não para por causa da taxa do FireHub).
   */
  splitRecusado: string | null;
  /** Pix: o copia e cola e a imagem do QR. */
  copiaECola: string | null;
  imagemBase64: string | null;
  /** Cartão: a página do Asaas onde o cliente digita o cartão. */
  linkDePagamento: string | null;
  /** O Asaas aceitou devolver o cliente ao cardápio depois de pagar. */
  voltaSozinho: boolean;
  /** Preenchido quando a volta foi PEDIDA e o Asaas recusou (site da conta). */
  voltaRecusada: string | null;
};

/** Hoje no fuso de Brasília, "YYYY-MM-DD" — o vencimento da cobrança. */
function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Erro do Asaas que é do split (carteira, lista de carteiras, valor do split). */
function erroDeSplit(erro: string | null): boolean {
  return /split|wallet|carteira/i.test(String(erro || ""));
}

/**
 * Erro do Asaas que pode ser da volta ao site (`callback`): a documentação não
 * diz o texto, e refazer sem ela nunca faz mal — então a rede é larga.
 */
function erroDaVolta(erro: string | null): boolean {
  return /callback|success|url|dom[ií]nio|site|redirec/i.test(String(erro || ""));
}

/**
 * Cria a cobrança do pedido: Pix (com QR) ou cartão (sem dado de cartão — o
 * cliente paga na página do Asaas, `invoiceUrl`, e o número do cartão nunca
 * passa pelo FireHub; ver docs.asaas.com/docs/pci-dss-1).
 *
 * Se o Asaas recusar a cobrança POR CAUSA do split, ela é refeita sem o split
 * e `splitRecusado` diz o motivo: a venda da loja não pode parar por causa da
 * taxa do FireHub, e o FireHub fica sabendo (lib/pix-online-pedido.ts).
 */
export async function criarCobranca(
  chave: string,
  opts: {
    forma: "pix" | "cartao";
    clienteId: string;
    valor: number;
    descricao: string;
    referencia: string;
    /** Carteira que recebe o split; null = sem split (ver `walletDoFireHub`). */
    walletDoSplit: string | null;
    valorDoSplit: number;
    /**
     * Cartão: para onde o Asaas devolve o cliente depois de pagar. Só vale no
     * domínio do site cadastrado na conta (`mesmoDominio`); recusada, a
     * cobrança sai sem ela e o cliente volta pela aba do cardápio.
     */
    voltarPara?: string | null;
  },
): Promise<RespostaAsaas<CobrancaGerada>> {
  const valor = Math.round(opts.valor * 100) / 100;
  const pediuSplit = Boolean(opts.walletDoSplit) && opts.valorDoSplit > 0;
  const pediuVolta = opts.forma === "cartao" && Boolean(opts.voltarPara);

  const corpo = (comSplit: boolean, comVolta: boolean) => ({
    customer: opts.clienteId,
    billingType: opts.forma === "cartao" ? "CREDIT_CARD" : "PIX",
    value: valor,
    dueDate: hojeEmSaoPaulo(),
    description: opts.descricao.slice(0, 500),
    externalReference: opts.referencia,
    ...(comSplit
      ? {
          split: [
            {
              walletId: opts.walletDoSplit,
              fixedValue: opts.valorDoSplit,
              externalReference: opts.referencia,
              description: "FireHub — taxa do pagamento online",
            },
          ],
        }
      : {}),
    ...(comVolta ? { callback: { successUrl: opts.voltarPara, autoRedirect: true } } : {}),
  });

  // Recusada por causa da volta ou do split, a cobrança é refeita sem o que
  // foi recusado: a venda da loja não para por nenhum dos dois.
  let comSplit = pediuSplit;
  let comVolta = pediuVolta;
  let splitRecusado: string | null = null;
  let voltaRecusada: string | null = null;
  let criada = await asaasDaLoja(chave, "/payments", { method: "POST", body: corpo(comSplit, comVolta) });
  for (let tentativa = 0; tentativa < 2 && !criada.ok; tentativa++) {
    if (comVolta && erroDaVolta(criada.erro)) {
      voltaRecusada = criada.erro;
      comVolta = false;
    } else if (comSplit && erroDeSplit(criada.erro)) {
      splitRecusado = criada.erro;
      comSplit = false;
    } else break;
    criada = await asaasDaLoja(chave, "/payments", { method: "POST", body: corpo(comSplit, comVolta) });
  }
  if (!criada.ok || !criada.dados?.id) {
    return { ok: false, status: criada.status, dados: null, erro: criada.erro || "O Asaas não devolveu a cobrança." };
  }

  const base = {
    cobrancaId: String(criada.dados.id),
    valor,
    split: comSplit ? opts.valorDoSplit : 0,
    splitRecusado,
    copiaECola: null as string | null,
    imagemBase64: null as string | null,
    linkDePagamento: null as string | null,
    voltaSozinho: comVolta,
    voltaRecusada,
  };

  if (opts.forma === "cartao") {
    const link = criada.dados.invoiceUrl ? String(criada.dados.invoiceUrl) : null;
    if (!link) {
      await excluirCobranca(chave, base.cobrancaId);
      return { ok: false, status: 502, dados: null, erro: "O Asaas não devolveu a página de pagamento do cartão." };
    }
    return { ok: true, status: 200, erro: null, dados: { ...base, linkDePagamento: link } };
  }

  const qr = await asaasDaLoja(chave, `/payments/${base.cobrancaId}/pixQrCode`);
  if (!qr.ok || !qr.dados?.payload) {
    // Cobrança sem QR não serve para nada e ainda contaria no extrato: apaga.
    await excluirCobranca(chave, base.cobrancaId);
    return { ok: false, status: qr.status, dados: null, erro: qr.erro || "O Asaas não gerou o QR Code do Pix." };
  }
  return {
    ok: true,
    status: 200,
    erro: null,
    dados: {
      ...base,
      copiaECola: String(qr.dados.payload),
      imagemBase64: qr.dados.encodedImage ? String(qr.dados.encodedImage) : null,
    },
  };
}

export async function consultarCobranca(chave: string, cobrancaId: string) {
  return asaasDaLoja(chave, `/payments/${encodeURIComponent(cobrancaId)}`);
}

export async function excluirCobranca(chave: string, cobrancaId: string) {
  return asaasDaLoja(chave, `/payments/${encodeURIComponent(cobrancaId)}`, { method: "DELETE" });
}

export async function estornarCobranca(chave: string, cobrancaId: string, motivo: string) {
  return asaasDaLoja(chave, `/payments/${encodeURIComponent(cobrancaId)}/refund`, {
    method: "POST",
    body: { description: motivo.slice(0, 200) },
  });
}

/**
 * Status do Asaas que querem dizer "o dinheiro entrou". CONFIRMED é o cartão
 * aprovado (o crédito cai em até 2 dias úteis); para o pedido, já é pago.
 */
export function cobrancaPaga(status: string | null | undefined): boolean {
  return ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(String(status || "").toUpperCase());
}

/** Status que querem dizer "o dinheiro voltou (ou está voltando)". */
export function cobrancaEstornada(status: string | null | undefined): boolean {
  return ["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS"].includes(String(status || "").toUpperCase());
}

// ─── A CARTEIRA DO FIREHUB ─────────────────────────────────────────────────

const carteiraEmCache: { producao?: string | null } = {};

/**
 * Para onde vai o split. Em produção, a carteira da conta Asaas do FireHub (a
 * mesma que emite a mensalidade), lida uma vez pela chave do FireHub, ou
 * `ASAAS_WALLET_ID_FIREHUB` se estiver definida. Em Sandbox só com
 * `ASAAS_WALLET_ID_FIREHUB_SANDBOX`: carteira de produção não existe lá.
 *
 * Devolve null quando não há carteira — a cobrança sai sem split e o log diz.
 * O Asaas recusa split para a própria conta emissora; `walletDaLoja` evita o
 * caso da loja que usa a mesma conta do FireHub.
 */
export async function walletDoFireHub(ambiente: Ambiente, walletDaLoja?: string | null): Promise<string | null> {
  let carteira: string | null = null;
  if (ambiente === "sandbox") {
    carteira = (process.env.ASAAS_WALLET_ID_FIREHUB_SANDBOX || "").trim() || null;
  } else if ((process.env.ASAAS_WALLET_ID_FIREHUB || "").trim()) {
    carteira = process.env.ASAAS_WALLET_ID_FIREHUB!.trim();
  } else if (carteiraEmCache.producao !== undefined) {
    carteira = carteiraEmCache.producao;
  } else {
    const chaveDoFireHub = getAsaasKey();
    if (chaveDoFireHub && chaveDoFireHub.startsWith("$aact_prod")) {
      const r = await asaasDaLoja(chaveDoFireHub, "/wallets/");
      carteira = r.ok ? r.dados?.data?.[0]?.id ?? null : null;
      // Só guarda o acerto: uma falha de rede não pode deixar o split desligado até o próximo deploy.
      if (carteira) carteiraEmCache.producao = carteira;
    }
  }
  if (carteira && walletDaLoja && carteira === walletDaLoja) return null;
  return carteira;
}
