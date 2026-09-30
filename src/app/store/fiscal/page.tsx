"use client";

import { useState, useEffect, useMemo, type CSSProperties } from "react";
import {
  FileText, ShieldCheck, Check, AlertTriangle, Search, Plus, Trash2,
  DollarSign, RefreshCw, Layers, Edit3, Settings, CheckCircle2, ChevronRight,
  Info, Sparkles, Receipt, Filter, ArrowUpRight, Calendar, Download, Printer, Copy,
  ExternalLink, Eye, ChevronDown, ChevronUp, Lock, HelpCircle, X, CheckSquare, Square,
  Send, Mail, FileArchive
} from "lucide-react";
import EmissorProprio, { EscolhaDoEmissor, pedirTesteDeConexao } from "./EmissorProprio";
import NcmAssistido, { type SugestaoComAtual } from "./NcmAssistido";
import ModalDeJustificativa from "./ModalDeJustificativa";
import type { EmissorNaTela, ItemDeProntidao } from "@/lib/nfce/cadastro-do-emissor";
import { cestComPontos, ncmComPontos, situacaoDoNcmGravado, sugerirParaCardapio } from "@/lib/nfce/ncm-sugerido";
import { mesmoTexto, sugestoesDaReceita, type SugestoesDaReceita } from "@/lib/nfce/dados-da-receita";
import {
  avisoComRotulos, camposEmTexto, JUSTIFICATIVA_DO_CANCELAMENTO, OBSERVACAO_DA_DEVOLUCAO, pendenciaEmTexto, rotuloDoCampoFiscal,
} from "@/lib/textos-da-tela-fiscal";

type FiscalConfig = {
  enabled: boolean;
  // 1 = produção (vale de verdade), 2 = homologação (teste) — o MESMO número
  // que vai no XML e que o servidor espera. A tela antiga mandava a string
  // "homologacao"/"producao"; o servidor faz Number() e descartava em
  // silêncio: o ambiente nunca chegava a ser salvo.
  ambiente: number;
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia: string;
  // CRT: 1 Simples, 2 Simples c/ excesso, 3 Normal, 4 MEI. null = ainda não
  // gravado (a tela mostra "Selecione" e a sugestão, não um regime escolhido por nós).
  regimeTributario: number | null;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
  serie: number;
  provedor: string | null;
  cscId: string;
  autoEmitPaymentMethods: string[];
  // Presença dos segredos — o GET diz QUE existem, nunca o valor.
  temTokenDoProvedor?: boolean;
  temToken?: { homologacao: boolean; producao: boolean };
  temTokenManual?: boolean;
  // O token colado à mão é de UM ambiente e só vale nele (lib/fiscal-credenciais).
  ambienteDoTokenManual?: "homologacao" | "producao" | null;
  temCsc?: boolean;
  // Na loja cadastrada pela Focus o CSC é por ambiente: o de homologação não
  // serve para produção.
  temCscNoAmbiente?: { homologacao: boolean; producao: boolean };
  temCertificado?: boolean;
  // Cadastro na Focus pela conta de revenda do FireHub (rota /provisionar).
  cadastradoNaFocus?: boolean;
  focusEmpresaId?: string | null;
  cadastradoNaFocusEm?: string | null;
  cscFinal?: string | null;
  cscNaFocus?: {
    homologacao?: { id: string; final: string } | null;
    producao?: { id: string; final: string } | null;
  } | null;
  certificado?: { validoAte: string; dias: number; situacao: "vencido" | "vence_em_breve" | "ok" } | null;
  // ── Regras da nota (acordeão "Regras da nota") ──
  // Existiam na emissão (lib/fiscal-momento, lib/fiscal-emissao) e nenhuma
  // tela as gravava: o PUT descartava. "aceite" | "saida" | "conclusao".
  momentoDaEmissao?: string;
  taxaDeServicoNaNota?: boolean;
  /** Por canal: CNPJ (vazio = o oficial do código), identificador e liga/desliga. */
  intermediadores?: Record<string, { cnpj?: string | null; id?: string | null; ativo?: boolean }> | null;
  pixEstatico?: boolean;
  entregaComoPresencial?: boolean;
  // ── Emissor próprio (api/store/fiscal → lib/nfce/cadastro-do-emissor) ──
  // Quem transmite de fato: o gravado, ou o padrão (loja nova → "sefaz").
  provedorEfetivo?: "sefaz" | "focusnfe";
  provedorGravado?: string | null;
  /** true = a escolha ainda não foi gravada (é o padrão). */
  provedorPadrao?: boolean;
  /** O retrato do bloco `sefaz` — sem caminho do cofre, senha ou CSC. */
  emissorProprio?: EmissorNaTela | null;
};

/**
 * O que o lojista precisa fazer na SEFAZ do estado dele antes de cadastrar.
 *
 * Existe porque o erro mais comum não é do FireHub nem da Focus: é a loja sem
 * credenciamento de NFC-e ou sem CSC, e cada estado esconde isso num lugar
 * diferente. Texto conferido em pesquisa de 24/09/2026 (RJ, DF, MG, PA); os
 * demais estados recebem a orientação genérica.
 */
const PASSO_A_PASSO_POR_UF: Record<string, { credenciamento: string; csc: string; aviso?: string }> = {
  RJ: {
    credenciamento:
      "Automático para quem tem Inscrição Estadual ativa — o estabelecimento precisa estar como OPERACIONAL no cadastro da SEFAZ-RJ.",
    csc:
      "Acesse www.fazenda.rj.gov.br/dfe → \"Geração e Manutenção CSC\", entre com o certificado digital e gere o CSC de homologação e o de produção (anote o ID de cada um). O portal bloqueia alguns endereços de internet: se não abrir, tente de outra rede (o 4G do celular, por exemplo).",
  },
  DF: {
    credenciamento:
      "Em ww2.receita.fazenda.df.gov.br → Painel de Serviços → Meus Serviços → DF-e → Credenciamento. A liberação sai em até 1 dia.",
    csc: "No mesmo painel: DF-e → Código CSC.",
  },
  MG: {
    credenciamento:
      "No SIARE: Documentos Eletrônicos → Credenciar Emissor. Atenção: o credenciamento é irrevogável.",
    csc: "O CSC aparece no SIARE depois do credenciamento.",
  },
  PA: {
    credenciamento: "Automático.",
    csc: "No Portal de Serviços da SEFA: \"Gerenciar Código Segurança NFC-e\".",
    aviso:
      "No Pará o SOFTWARE emissor também precisa estar cadastrado na SEFA (\"Cadastro Software NFC-e - Fornecedor\") e a loja precisa comunicar que usa esse software. Confirme com o suporte do FireHub antes de ligar em produção.",
  },
};
const PASSO_A_PASSO_GENERICO = {
  credenciamento:
    "Procure \"credenciamento NFC-e\" no portal da SEFAZ do seu estado. Em vários estados é automático para quem tem Inscrição Estadual ativa; em outros é preciso pedir.",
  csc:
    "No mesmo portal, procure \"CSC\" (Código de Segurança do Contribuinte). Gere um para homologação e outro para produção e anote o ID de cada um.",
};

const fmtData = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

type FiscalProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
  isCombo?: boolean;
  isBeverage?: boolean;
  apenasEmCombo?: boolean;
  fiscalBreakdown?: any[] | null;
  comboGroups?: any[];
};

type FiscalOrder = {
  id: string;
  dailyOrderNumber?: number | string | null;
  // Pedido de mesa: a nota é da CONTA (uma por mesa), emitida pelo botão de
  // qualquer rodada com a conta fechada (api/store/fiscal/emitir).
  tableSessionId?: string | null;
  mesa?: { numero: number | null; nome: string | null; contaFechada: boolean } | null;
  // Pedido cancelado pelo parceiro com a nota de pé (lib/fiscal-momento →
  // alertaDoCancelamento): o aviso fica até a nota ser cancelada ou a
  // devolução ser registrada.
  alerta?: { quando: string; origem: string; mensagem: string } | null;
  customerName: string;
  customerCpfCnpj?: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentMethod: string;
  deliveryType?: string;
  orderStatus?: string;
  totalAmount: number;
  deliveryFee?: number;
  createdAt: string;
  fiscalStatus?: string | null; // "EMITTED" | "PENDING" | "FAILED" | "CANCELED"
  fiscalInfo?: {
    nfceNumber?: string;
    serie?: string;
    nfceKey?: string;
    protocol?: string;
    emittedAt?: string;
    ambiente?: string;
    impostosAproximados?: number;
    xmlUrl?: string;
    pdfUrl?: string;
    items?: any[];
    // Estados intermediários que a rota devolve quando NÃO houve emissão:
    processando?: boolean;
    ultimoErro?: string | null;
    ultimaTentativaEm?: string | null;
    /** O que falta, item a item, gravado com a falha (vai no título do "Falhou"). */
    pendencias?: { campo: string; mensagem: string }[];
    // Contingência off-line: autorizada off-line, DANFE vale e tem de ser
    // impresso, mas a SEFAZ ainda não efetivou (o cron acompanha).
    contingencia?: boolean;
    contingenciaDesde?: string | null;
    /** O vNF que foi para a SEFAZ (na mesa, a conta inteira; no iFood, sem a taxa de serviço). */
    valorDaNota?: number | null;
    notaDaConta?: { pedidos: number | null; restante: boolean } | null;
    devolucao?: { quando: string; quem: string; observacao: string } | null;
    /** A regra do cancelamento decidida no servidor (mercadoria não saiu + 30 min). */
    podeCancelar?: boolean;
    semCancelamentoPorque?: "saiu" | "prazo" | null;
    /** A nota que a loja cancelou (a tela oferece emitir outra). */
    cancelada?: boolean;
    canceladaEm?: string | null;
  } | null;
};

const FAQ_ITEMS = [
  // A resposta anterior prometia "NFC-e e NF-e". NF-e (modelo 55) não existe
  // neste módulo — só NFC-e (modelo 65). Prometer na FAQ o que o botão não faz
  // é o mesmo tipo de mentira que o módulo fiscal falso antigo contava.
  { q: "Preciso contratar um provedor (a Focus NFe) para emitir?", a: "Não. O Emissor do FireHub transmite a NFC-e direto à SEFAZ, com o certificado A1 da própria loja, sem custo por nota. A Focus NFe continua como alternativa para quem já tem conta lá — a escolha fica em Configurações → Quem transmite as notas." },
  { q: "Que tipos de notas podem ser emitidas?", a: "O sistema emite NFC-e (Nota Fiscal de Consumidor Eletrônica, modelo 65) — a nota do consumidor final, para delivery, balcão, mesa e totem. NF-e modelo 55 (para venda a outra empresa) ainda não é emitida por aqui." },
  { q: "Como as recompensas de fidelidade aparecem na nota?", a: "Entram junto com os demais descontos: são rateadas entre os itens na proporção do valor de cada um (vDesc do item) e somam no vDesc do total." },
  { q: "Como as taxas de serviços e acréscimos aparecem na nota?", a: "A taxa de entrega vai como Outras Despesas Acessórias (vOutro), rateada entre os itens na proporção do valor de cada um. NFC-e não tem campo de frete, por isso a modalidade vai como 'sem frete'." },
  { q: "Como os descontos aparecem na nota?", a: "Cupons e descontos são rateados item a item, em centavos inteiros, e o total (vDesc) é a soma exata dessas partes — como a SEFAZ exige. Se o cupom for maior que o valor dos produtos, o que sobra é tratado como desconto da entrega." },
  { q: "Descontos pagos pelo iFood na nota", a: "Subídios de cupons pagos pelo iFood não reduzem o valor fiscal repassado à SEFAZ." },
  { q: "Como produtos cadastrados como combos aparecem na nota?", a: "Na Engenharia de Cardápio Fiscal, os itens do combo são enviados discriminados com valores tributários individuais sem alterar o preço para o cliente." },
  { q: "Uma opção do meu produto deve ser tributada de forma diferente, como fazer?", a: "Configure o NCM e CST específicos do item ou adicional na aba de Produtos." },
  { q: "Formas de pagamento na nota", a: "Cada venda envia a credenciadora e meio de pagamento correspondente (Pix, Cartão, Dinheiro, Voucher)." },
  { q: "Como fica o campo de Indicador de presença?", a: "Pedido de delivery sai como Entrega a Domicílio (código 4). Retirada, balcão, mesa e totem saem como Operação Presencial (código 1). O CPF do cliente não muda esse campo." },
];

const PAYMENT_OPTIONS = [
  { key: "MONEY", label: "💵 Dinheiro", desc: "Pagamentos em espécie no balcão / entrega" },
  { key: "PIX", label: "⚡ PIX", desc: "Chave Pix online ou QR Code no balcão" },
  { key: "CREDIT_CARD", label: "💳 Cartão de Crédito", desc: "Crédito presencial ou online" },
  { key: "DEBIT_CARD", label: "💳 Cartão de Débito", desc: "Débito maquininha presencial" },
  { key: "VOUCHER", label: "🎟️ Voucher / Refeição", desc: "VR, VA, Alelo, Sodexo, Ticket" },
  // Pago antes de o pedido existir aqui: no app do iFood/99Food ou no site
  // (gateway). Sem esta opção o pedido do iFood pago na carteira ("iFood App
  // (Pago Online)", 909 pedidos em 30 dias) nunca tinha nota automática —
  // o servidor já sabia a chave (lib/fiscal-momento → chavesDoPagamento).
  { key: "ONLINE", label: "🌐 Pago online", desc: "iFood, 99Food, site (pagamento feito no app ou no site)" },
];

/**
 * Cabeçalho de acordeão como BOTÃO: era um <div onClick>, que o teclado não
 * alcança (Tab passava direto) e o leitor de tela não anunciava como algo que
 * abre e fecha. Com <button>, Enter/Espaço funcionam e `aria-expanded` diz o
 * estado.
 */
const ESTILO_DO_CABECALHO: CSSProperties = {
  width: "100%", padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between",
  cursor: "pointer", background: "none", border: "none", textAlign: "left", font: "inherit", color: "inherit",
};

/** Quando a nota sai — os três valores que lib/fiscal-momento lê. */
const MOMENTOS_DA_EMISSAO = [
  {
    valor: "saida",
    nome: "Na saída (recomendado)",
    explicacao:
      "Entrega: quando o pedido sai (botão Saiu, rota despachada, motoboy puxando, despacho do parceiro). Retirada, " +
      "balcão e totem: na conclusão, quando o cliente leva. É o que a regra pede — NFC-e autorizada antes de a mercadoria sair.",
  },
  {
    valor: "aceite",
    nome: "No aceite",
    explicacao:
      "A nota sai quando a loja aceita o pedido. O mais seguro quanto ao “antes da saída” e o mais caro no cancelamento: " +
      "pedido cancelado depois dos 30 minutos fica com uma nota que não se cancela mais (devolução com o contador).",
  },
  {
    valor: "conclusao",
    nome: "Na conclusão",
    explicacao:
      "Tudo no ENTREGUE (o comportamento antigo). A nota da entrega sai depois de a comida chegar — só use se o seu contador pedir.",
  },
];

/** Os canais em que dá para ajustar o intermediador (lib/fiscal-config → CANAIS_DO_INTERMEDIADOR). */
const CANAIS_DE_MARKETPLACE = [
  { canal: "IFOOD", nome: "iFood" },
  { canal: "99FOOD", nome: "99Food" },
];
const CANAIS_PROPRIOS = [
  { canal: "BRENDI", nome: "Brendi" },
  { canal: "WABIZ", nome: "Wabiz" },
  { canal: "JOTAJA", nome: "JotaJá" },
];

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Sugestão ao lado de um campo da empresa que ainda não foi gravado.
 *
 * É texto e um botão, nunca o valor dentro do campo: o que está dentro do
 * campo é o que está no banco, e é isso que a lista de pendências e o ligar
 * conferem (api/store/fiscal → retratoDoCadastro).
 */
function Sugestao({ id, campo, valor, origem, onUsar }: { id: string; campo: string; valor: string; origem: string; onUsar: () => void }) {
  return (
    <p id={id} style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.4 }}>
      Sugestão ({origem}): <strong style={{ color: "#334155" }}>{valor}</strong>{" "}
      <button
        type="button"
        onClick={onUsar}
        // Vários "Usar esta" na mesma tela: o nome diz qual campo recebe o quê.
        // E COMEÇA pelo texto visível (WCAG 2.5.3, rótulo no nome): quem usa
        // comando de voz diz "clicar Usar esta" — com "Usar Hakim Centro como
        // razão social" nenhum controle respondia a esse nome.
        aria-label={`Usar esta: ${valor} como ${campo}`}
        style={{ background: "none", border: "none", padding: 0, color: "#1D4ED8", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", textDecoration: "underline" }}
      >
        Usar esta
      </button>
    </p>
  );
}

export default function StoreFiscalPage() {
  const [activeNav, setActiveNav] = useState<"config" | "products" | "invoices" | "inutilizacao" | "contador">("invoices");
  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");

  const [fiscalConfig, setFiscalConfig] = useState<FiscalConfig>({
    enabled: false,
    ambiente: 2, // homologação: produção é escolha deliberada
    cnpj: "",
    inscricaoEstadual: "",
    razaoSocial: "",
    nomeFantasia: "",
    // Sem regime até o servidor dizer qual está GRAVADO. Começar em 1 fazia o
    // select mostrar "Simples Nacional" escolhido numa loja que nunca salvou o
    // regime — e o ligar recusava por regime vazio. A sugestão vem do GET.
    regimeTributario: null,
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    municipio: "",
    codigoMunicipio: "",
    uf: "",
    cep: "",
    serie: 1,
    provedor: null,
    cscId: "",
    // `ncmDefault: "2106.90.90"` saiu daqui. Aquele valor era gravado no
    // produto sem NCM e o produto passava a exibir "Regular" — o lojista via o
    // cardápio inteiro em ordem com o cadastro fiscal vazio. Cada produto tem
    // o NCM dele na tabela da Receita; não existe genérico que sirva.
    //
    // Igual a FORMAS_AUTOMATICAS_PADRAO (lib/fiscal-config): o GET devolve essa
    // lista quando a loja nunca escolheu, e o PUT a grava no primeiro Salvar.
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  });
  // Sugestões do servidor para os dados da empresa ainda não GRAVADOS (o nome
  // da loja para a razão social, o documento do cadastro para o CNPJ). Antes o
  // servidor punha esses palpites no próprio formulário e conferia as
  // pendências sobre eles: a tela dizia "pronto" e o ligar recusava, porque
  // no banco a razão social estava vazia (Hakim Centro, 24/09/2026). Agora
  // aparecem ao lado do campo, e só viram dado quando o lojista usa e salva.
  const [sugestoes, setSugestoes] = useState<{ cnpj?: string; razaoSocial?: string; nomeFantasia?: string; regimeTributario?: number }>({});
  // Segredos digitados AGORA. Só entram no PUT quando preenchidos — mandar ""
  // apagaria o que já está salvo no servidor.
  const [tokenHomologacaoInput, setTokenHomologacaoInput] = useState("");
  const [tokenProducaoInput, setTokenProducaoInput] = useState("");
  const [cscInput, setCscInput] = useState("");
  const [testandoConexao, setTestandoConexao] = useState(false);

  // Quem está logado e se o FireHub já tem conta de revenda na Focus — as
  // duas coisas decidem o que a tela deixa fazer ANTES do clique.
  const [papelDoUsuario, setPapelDoUsuario] = useState<string>("");
  const [cadastroAutomaticoDisponivel, setCadastroAutomaticoDisponivel] = useState(false);
  const ehTitular = papelDoUsuario !== "" && papelDoUsuario !== "STAFF";
  // Quem transmite as notas (o servidor decide o efetivo: o gravado, ou o
  // padrão — loja nova no emissor do FireHub, loja com Focus na Focus).
  const emissorProprioAtivo = fiscalConfig.provedorEfetivo === "sefaz";
  const [alterandoEmissao, setAlterandoEmissao] = useState(false);

  // Cadastro na Focus: o arquivo, a senha e os CSCs vivem só aqui até o envio
  // e são apagados do estado assim que a Focus confirma.
  const [arquivoCertificado, setArquivoCertificado] = useState<File | null>(null);
  const [senhaCertificado, setSenhaCertificado] = useState("");
  const [cscHomologacaoInput, setCscHomologacaoInput] = useState("");
  const [idCscHomologacaoInput, setIdCscHomologacaoInput] = useState("");
  const [cscProducaoInput, setCscProducaoInput] = useState("");
  const [idCscProducaoInput, setIdCscProducaoInput] = useState("");
  const [provisionando, setProvisionando] = useState(false);
  const [resultadoDoCadastro, setResultadoDoCadastro] = useState<{ ok: boolean; mensagem: string } | null>(null);
  const [mostrarCadastroManual, setMostrarCadastroManual] = useState(false);
  const [chaveDoArquivo, setChaveDoArquivo] = useState(0);

  // O que falta para esta loja emitir, conforme o servidor. Vazio = pronta.
  const [pendenciasFiscais, setPendenciasFiscais] = useState<{ campo: string; mensagem: string }[]>([]);
  const [podeEmitir, setPodeEmitir] = useState(false);
  // Emissor próprio: o checklist até a primeira nota (null na loja da Focus),
  // as UF que ele atende e a gravação da escolha do emissor.
  const [prontidao, setProntidao] = useState<ItemDeProntidao[] | null>(null);
  const [ufsDoEmissorProprio, setUfsDoEmissorProprio] = useState<string[]>([]);
  const [gravandoEmissor, setGravandoEmissor] = useState(false);
  // Dados da empresa na Receita Federal (consulta pública do CNPJ), como
  // SUGESTÃO ao lado de cada campo — nunca gravados sem o lojista usar e salvar.
  const [receita, setReceita] = useState<SugestoesDaReceita | null>(null);
  const [consultandoReceita, setConsultandoReceita] = useState(false);
  const [erroDaReceita, setErroDaReceita] = useState<string | null>(null);
  const [receitaConsultada, setReceitaConsultada] = useState<string | null>(null);
  // NCM assistido: as marcas de "sugestão aplicada" e o que a sugestão precisa
  // (regime e UF) — vêm com a lista de produtos.
  const [marcasDoNcm, setMarcasDoNcm] = useState<Record<string, { ncm: string; regra: string; em: string }>>({});
  const [regimeDosProdutos, setRegimeDosProdutos] = useState<number | null>(null);
  const [ufDosProdutos, setUfDosProdutos] = useState<string | null>(null);
  // Os CNPJs dos marketplaces que o código conhece (o GET manda): o campo
  // nasce com eles, e só o que a loja mudar é gravado.
  const [intermediadoresOficiais, setIntermediadoresOficiais] = useState<Record<string, { nome: string; razaoSocial: string; cnpj: string }>>({});
  const [salvandoRegras, setSalvandoRegras] = useState(false);

  // Config sub-accordion state
  const [openConfigSection, setOpenConfigSection] = useState<string | null>("dados");
  const [faqSearch, setFaqSearch] = useState("");
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(null);

  // Products state
  const [productsTab, setProductsTab] = useState<"produtos" | "combos">("produtos");
  const [products, setProducts] = useState<FiscalProduct[]>([]);
  const [searchProduct, setSearchProduct] = useState("");
  const [editingProduct, setEditingProduct] = useState<FiscalProduct | null>(null);
  const [editingCombo, setEditingCombo] = useState<FiscalProduct | null>(null);
  const [fiscalItemsDraft, setFiscalItemsDraft] = useState<any[]>([]);
  const [comboDetails, setComboDetails] = useState<any>(null);
  /**
   * Valor que o lojista digitou para cada opção do combo, por id da opção.
   *
   * A coluna de preço nos "Grupos do Combo" era texto fixo: mostrava o rateio
   * automático (preço do combo ÷ escolhas exigidas) e não deixava mexer. Só que
   * o rateio igual raramente é o que interessa — o refrigerante e o lanche têm
   * tributação bem diferente, e é justamente para isso que a Engenharia Fiscal
   * existe. Quem não digitar nada continua com o rateio automático.
   */
  const [precoFiscalPorItem, setPrecoFiscalPorItem] = useState<Record<string, number>>({});

  // ── Aba Contador ─────────────────────────────────────────────────────────
  const [contador, setContador] = useState<any>({
    email: "", copiaParaLoja: true, automatico: false, quando: "DIA_1", dia: 5, data: null,
    ultimoEnvioEm: null, ultimoEnvioResultado: null,
  });
  const [salvandoContador, setSalvandoContador] = useState(false);
  const [enviandoContador, setEnviandoContador] = useState(false);
  /* O período nasce no MÊS PASSADO fechado, que é o que o contador pede em 9
     de cada 10 vezes. Deixar em branco obrigaria o lojista a montar a data
     toda vez para fazer o que ele quase sempre quer. */
  const [periodoContador, setPeriodoContador] = useState(() => {
    const agora = new Date();
    const ano = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
    const mes = agora.getMonth() === 0 ? 12 : agora.getMonth();
    const ultimo = new Date(ano, mes, 0).getDate();
    const dd = (n: number) => String(n).padStart(2, "0");
    return { de: `${ano}-${dd(mes)}-01`, ate: `${ano}-${dd(mes)}-${dd(ultimo)}` };
  });
  const [savingCombo, setSavingCombo] = useState(false);

  // Invoices state & Filters
  const [orders, setOrders] = useState<FiscalOrder[]>([]);
  const [searchOrder, setSearchOrder] = useState("");
  // Data LOCAL, não toISOString (UTC): depois das 21h o padrão pulava para o
  // dia seguinte e a tela abria "vazia" escondendo os pedidos do dia.
  const [dateFrom, setDateFrom] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [selectedOrderForEmit, setSelectedOrderForEmit] = useState<FiscalOrder | null>(null);
  const [selectedOrderForDanfe, setSelectedOrderForDanfe] = useState<FiscalOrder | null>(null);
  const [emitCpfInput, setEmitCpfInput] = useState("");
  const [emitting, setEmitting] = useState(false);
  // Cancelar a nota / registrar a devolução: o modal da justificativa (era window.prompt).
  const [justificativaDaNota, setJustificativaDaNota] = useState<{ tipo: "cancelar" | "devolucao"; order: FiscalOrder } | null>(null);
  const [enviandoJustificativa, setEnviandoJustificativa] = useState(false);
  const [erroDaJustificativa, setErroDaJustificativa] = useState<{ mensagem: string; podeRegistrarDevolucao: boolean } | null>(null);

  // Batch emit state
  const [showBatchEmitModal, setShowBatchEmitModal] = useState(false);
  const [selectedBatchOrderIds, setSelectedBatchOrderIds] = useState<string[]>([]);
  const [batchEmitting, setBatchEmitting] = useState(false);

  // Inutilização state
  const [inutilSerie, setInutilSerie] = useState("1");
  const [inutilNumIni, setInutilNumIni] = useState("");
  const [inutilNumFin, setInutilNumFin] = useState("");
  const [inutilJustif, setInutilJustif] = useState("");
  const [inutilizing, setInutilizing] = useState(false);

  useEffect(() => {
    fetchFiscalData();
    fetchProducts();
    fetch("/api/store/fiscal/contador")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.contador) setContador({ ...d.contador, email: d.contador.email || "" }); })
      .catch(() => null);
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [dateFrom, dateTo]);

  // Inutilização no emissor próprio: a série padrão do formulário é a DELE
  // (a NIK emite na série nova, não na 1 que a Saipos usou).
  useEffect(() => {
    const serieDoEmissor = fiscalConfig.emissorProprio?.serie;
    if (fiscalConfig.provedorEfetivo === "sefaz" && serieDoEmissor) setInutilSerie(String(serieDoEmissor));
  }, [fiscalConfig.provedorEfetivo, fiscalConfig.emissorProprio?.serie]);

  const fetchFiscalData = async () => {
    try {
      const res = await fetch("/api/store/fiscal");
      if (res.ok) {
        const data = await res.json();
        setStoreName(data.storeName || "");
        setCpfCnpj(data.cpfCnpj || "");
        if (data.fiscalConfig) {
          setFiscalConfig(prev => ({ ...prev, ...data.fiscalConfig }));
        }
        setSugestoes(data.sugestoes && typeof data.sugestoes === "object" ? data.sugestoes : {});
        setPapelDoUsuario(String(data.papelDoUsuario || ""));
        setCadastroAutomaticoDisponivel(Boolean(data.cadastroAutomaticoDisponivel));
        // O servidor devolve a lista do que ainda falta para emitir. É ela que
        // alimenta o aviso do topo — antes a tela não tinha como saber se o
        // módulo estava pronto, então mostrava tudo verde de qualquer jeito.
        setPendenciasFiscais(Array.isArray(data.pendencias) ? data.pendencias : []);
        setPodeEmitir(Boolean(data.podeEmitir));
        setIntermediadoresOficiais(data.intermediadoresOficiais && typeof data.intermediadoresOficiais === "object" ? data.intermediadoresOficiais : {});
        setProntidao(Array.isArray(data.prontidao) ? data.prontidao : null);
        setUfsDoEmissorProprio(Array.isArray(data.ufsDoEmissorProprio) ? data.ufsDoEmissorProprio : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/store/fiscal/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
        setMarcasDoNcm(data.ncmAssistido && typeof data.ncmAssistido === "object" ? data.ncmAssistido : {});
        setRegimeDosProdutos(typeof data.regime === "number" ? data.regime : null);
        setUfDosProdutos(typeof data.uf === "string" ? data.uf : null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchComboDetails = async (comboId: string) => {
    try {
      const res = await fetch("/api/store/fiscal/combos");
      if (res.ok) {
        const data = await res.json();
        const found = (data.combos || []).find((c: any) => c.id === comboId);
        if (found) setComboDetails(found);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveComboFiscal = async () => {
    if (!editingCombo) return;
    setSavingCombo(true);
    try {
      const res = await fetch(`/api/store/fiscal/combos/${editingCombo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalBreakdown: fiscalItemsDraft }),
      });
      if (res.ok) {
        alert(`Engenharia fiscal do combo "${editingCombo.name}" salva com sucesso! ✅`);
        setEditingCombo(null);
        setComboDetails(null);
        fetchProducts();
      } else {
        const data = await res.json();
        alert(data.error || "Erro ao salvar.");
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setSavingCombo(false);
    }
  };

  const fetchInvoices = async () => {
    try {
      const url = `/api/store/fiscal/invoices?fromDate=${dateFrom}&toDate=${dateTo}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveFiscalConfig = async (newConfig?: Partial<FiscalConfig>) => {
    const c = { ...fiscalConfig, ...(newConfig || {}) };
    // Só os campos que o servidor aceita, com os NOMES e TIPOS que ele espera.
    // A versão antiga mandava `ie`, `ambiente: "homologacao"` e regime por
    // extenso — o servidor ignorava tudo em silêncio e o cadastro nunca
    // avançava.
    //
    // `enabled` e `ambiente` NÃO vão aqui: têm controle próprio no topo, com
    // confirmação. Mandar os dois em todo "Salvar Endereço" fazia qualquer
    // salvamento com estado velho da tela desligar ou trocar o ambiente.
    const payload: any = {
      cnpj: c.cnpj,
      inscricaoEstadual: c.inscricaoEstadual,
      razaoSocial: c.razaoSocial,
      nomeFantasia: c.nomeFantasia,
      regimeTributario: c.regimeTributario,
      logradouro: c.logradouro,
      numero: c.numero,
      complemento: c.complemento || "",
      bairro: c.bairro,
      municipio: c.municipio,
      codigoMunicipio: c.codigoMunicipio,
      uf: c.uf,
      cep: c.cep,
      serie: c.serie,
      provedor: c.provedor,
      cscId: c.cscId,
    };
    if (tokenHomologacaoInput.trim()) payload.tokenHomologacao = tokenHomologacaoInput.trim();
    if (tokenProducaoInput.trim()) payload.tokenProducao = tokenProducaoInput.trim();
    if (cscInput.trim()) payload.csc = cscInput.trim();

    try {
      const res = await fetch("/api/store/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const dados = await res.json().catch(() => ({}));
      if (res.ok) {
        setTokenHomologacaoInput("");
        setTokenProducaoInput("");
        setCscInput("");
        // Relê do servidor: é ele quem sabe se o token abre e o que falta.
        await fetchFiscalData();
        // O PUT devolve o retrato atualizado: mostrar na hora o que ainda
        // falta vale mais que um "salvo com sucesso" genérico.
        setPendenciasFiscais(dados.pendencias || []);
        setPodeEmitir(Boolean(dados.podeEmitir));
        alert(
          (dados.podeEmitir
            ? "Configurações salvas. Cadastro completo: esta loja PODE emitir NFC-e. ✅"
            : `Configurações salvas. Ainda faltam ${dados.pendencias?.length ?? 0} item(ns) — veja a lista no topo da tela.`) +
          (dados.aviso ? `\n\n${avisoComRotulos(dados.aviso, dados.camposIgnorados)}` : "")
        );
      } else {
        alert(dados.mensagem || dados.error || "Erro ao salvar.");
      }
    } catch {
      alert("Erro ao salvar.");
    }
  };

  /**
   * Grava SÓ os campos passados (liga/desliga, ambiente, formas automáticas,
   * declaração do certificado) e relê do servidor. Devolve a resposta para
   * quem chamou tratar recusa (pendências, confirmação de produção).
   */
  const gravarCampos = async (campos: Record<string, unknown>) => {
    const res = await fetch("/api/store/fiscal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campos),
    });
    const dados = await res.json().catch(() => ({}));
    await fetchFiscalData();
    return { ok: res.ok, status: res.status, dados };
  };

  const explicarRecusa = (dados: any, padrao: string) => {
    // O rótulo do formulário (lib/textos-da-tela-fiscal), não o nome interno do campo.
    const lista = Array.isArray(dados?.pendencias) && dados.pendencias.length > 0
      ? "\n\n" + dados.pendencias.slice(0, 8).map((x: any) => `• ${pendenciaEmTexto(x)}`).join("\n")
      : "";
    alert(`${dados?.mensagem || dados?.error || padrao}${lista}${dados?.aviso ? `\n\n${avisoComRotulos(dados.aviso, dados.camposIgnorados)}` : ""}`);
  };

  // Aviso que acompanha qualquer passo para PRODUÇÃO. O servidor também exige
  // `confirmarProducao` — a confirmação não depende só desta tela.
  const AVISO_DE_PRODUCAO =
    "Ligar a emissão em PRODUÇÃO\n\n" +
    "A partir de agora cada NFC-e vai para a SEFAZ de verdade: tem valor fiscal, entra no " +
    "faturamento da empresa e gera imposto. Nota errada só sai por cancelamento, em até 30 minutos.\n\n" +
    "Você já emitiu e conferiu notas em homologação?";

  // O botão que faltava: o erro de emissão mandava "ligar em Fiscal →
  // Configuração" numa tela que não tinha como ligar.
  const alternarEmissao = async (ligar: boolean) => {
    if (!ehTitular) return;
    const emProducao = Number(fiscalConfig.ambiente) === 1;
    if (ligar && emProducao && !window.confirm(AVISO_DE_PRODUCAO)) return;
    if (!ligar && !window.confirm("Desligar a emissão de NFC-e? Nenhuma nota sairá — nem as automáticas — até você ligar de novo.")) return;
    setAlterandoEmissao(true);
    try {
      const r = await gravarCampos({ enabled: ligar, ...(ligar && emProducao ? { confirmarProducao: true } : {}) });
      if (!r.ok) explicarRecusa(r.dados, "Não consegui alterar a emissão.");
    } catch {
      alert("Não consegui falar com o servidor. Nada foi alterado.");
    } finally {
      setAlterandoEmissao(false);
    }
  };

  // Homologação ↔ produção sem colar token: os dois vieram do cadastro na Focus.
  const trocarAmbiente = async (ambiente: 1 | 2) => {
    if (!ehTitular || Number(fiscalConfig.ambiente) === ambiente) return;
    const ligada = Boolean(fiscalConfig.enabled);
    // No emissor próprio não há token: o que o ambiente precisa é o
    // certificado válido e o CSC dele (lib/nfce/cadastro-do-emissor).
    if (emissorProprioAtivo) {
      const pronto = ambiente === 1 ? fiscalConfig.emissorProprio?.prontoNoAmbiente.producao : fiscalConfig.emissorProprio?.prontoNoAmbiente.homologacao;
      if (ligada && !pronto) {
        alert(
          `Não dá para passar para ${ambiente === 1 ? "PRODUÇÃO" : "homologação"} com a emissão ligada: falta ` +
          `${fiscalConfig.emissorProprio?.certificado ? "o CSC desse ambiente" : "o certificado digital"}. Complete em "Emissor do FireHub" e tente de novo.`
        );
        return;
      }
    }
    const temTokenDestino = emissorProprioAtivo || (ambiente === 1 ? fiscalConfig.temToken?.producao : fiscalConfig.temToken?.homologacao);
    const temCscDestino = ambiente === 1 ? fiscalConfig.temCscNoAmbiente?.producao : fiscalConfig.temCscNoAmbiente?.homologacao;
    if (ligada && (!temTokenDestino || temCscDestino === false)) {
      alert(
        `Não dá para passar para ${ambiente === 1 ? "PRODUÇÃO" : "homologação"} com a emissão ligada: ` +
        `falta ${!temTokenDestino ? "o token" : "o CSC"} desse ambiente. Cadastre o CSC dele em "Cadastro na Focus NFe" ` +
        "(ou cole o token, se a conta é sua) e tente de novo."
      );
      return;
    }
    if (ambiente === 1 && ligada && !window.confirm(AVISO_DE_PRODUCAO)) return;
    setAlterandoEmissao(true);
    try {
      const r = await gravarCampos({ ambiente, ...(ambiente === 1 && ligada ? { confirmarProducao: true } : {}) });
      if (!r.ok) explicarRecusa(r.dados, "Não consegui trocar o ambiente.");
    } catch {
      alert("Não consegui falar com o servidor. Nada foi alterado.");
    } finally {
      setAlterandoEmissao(false);
    }
  };

  /**
   * Grava quem transmite as notas (fiscalConfig.provedor). Com a emissão
   * ligada, o servidor só aceita a troca se o outro emissor estiver completo
   * — e diz o que falta; aqui a confirmação vem antes.
   */
  const escolherEmissor = async (provedor: "sefaz" | "focusnfe") => {
    if (!ehTitular) return;
    if (fiscalConfig.provedorEfetivo === provedor && !fiscalConfig.provedorPadrao) return;
    if (
      fiscalConfig.enabled &&
      fiscalConfig.provedorEfetivo !== provedor &&
      !window.confirm(
        `Trocar o emissor para ${provedor === "sefaz" ? "o Emissor do FireHub" : "a Focus NFe"} com a emissão LIGADA?\n\n` +
          "A partir da próxima venda as notas sairão por ele. A troca só passa se ele já estiver completo."
      )
    ) return;
    setGravandoEmissor(true);
    try {
      const r = await gravarCampos({ provedor });
      if (!r.ok) explicarRecusa(r.dados, "Não consegui trocar o emissor.");
    } catch {
      alert("Não consegui falar com o servidor. Nada foi alterado.");
    } finally {
      setGravandoEmissor(false);
    }
  };

  /**
   * Consulta pública do CNPJ (api/cnpj-lookup → BrasilAPI/ReceitaWS). O que
   * volta é SUGESTÃO ao lado de cada campo (lib/nfce/dados-da-receita): razão
   * social, fantasia, endereço, código IBGE e o regime. A IE a Receita não
   * tem — o campo diz isso.
   */
  const consultarReceita = async (cnpjInformado?: string) => {
    const cnpj = String(cnpjInformado ?? (fiscalConfig.cnpj || cpfCnpj || sugestoes.cnpj || "")).replace(/[^0-9A-Za-z]/g, "");
    if (cnpj.length !== 14) {
      setErroDaReceita("Digite o CNPJ (14 caracteres) para buscar os dados na Receita.");
      return;
    }
    setConsultandoReceita(true);
    setErroDaReceita(null);
    try {
      const res = await fetch("/api/cnpj-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj }),
      });
      const dados = await res.json().catch(() => ({}));
      const lido = res.ok ? sugestoesDaReceita(dados) : null;
      if (!lido) setErroDaReceita(dados.error || "A Receita não respondeu. Tente de novo em instantes.");
      setReceita(lido);
      setReceitaConsultada(cnpj);
    } catch {
      setErroDaReceita("Não consegui consultar a Receita agora. Tente de novo em instantes.");
    } finally {
      setConsultandoReceita(false);
    }
  };

  // Loja com CNPJ e o cadastro da empresa incompleto: a consulta à Receita
  // roda sozinha ao abrir as Configurações (uma vez por CNPJ). Só busca e
  // mostra — gravar continua sendo o "Usar esta" + Salvar do lojista.
  useEffect(() => {
    if (loading || activeNav !== "config" || !ehTitular || consultandoReceita) return;
    const cnpj = String(fiscalConfig.cnpj || cpfCnpj || "").replace(/[^0-9A-Za-z]/g, "");
    if (cnpj.length !== 14 || receitaConsultada === cnpj) return;
    if (fiscalConfig.razaoSocial && fiscalConfig.codigoMunicipio && fiscalConfig.logradouro && fiscalConfig.regimeTributario) return;
    consultarReceita(cnpj);
  }, [loading, activeNav, ehTitular, fiscalConfig.cnpj, cpfCnpj, fiscalConfig.razaoSocial, fiscalConfig.codigoMunicipio, fiscalConfig.logradouro, fiscalConfig.regimeTributario, receitaConsultada]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A Receita tem valor para o campo, e ele é diferente do que está no formulário? */
  const receitaDiferente = (campo: "razaoSocial" | "nomeFantasia" | "logradouro" | "numero" | "complemento" | "bairro" | "municipio" | "codigoMunicipio" | "uf" | "cep") => {
    const sugerido = receita?.[campo];
    if (!sugerido) return false;
    const atual = fiscalConfig[campo];
    if (campo === "cep" || campo === "codigoMunicipio") return String(sugerido).replace(/\D/g, "") !== String(atual ?? "").replace(/\D/g, "");
    return !mesmoTexto(sugerido, atual);
  };

  /** Usa todas as sugestões da Receita que diferem do formulário (ainda sem salvar). */
  const usarTudoDaReceita = () => {
    if (!receita) return;
    setFiscalConfig(p => ({
      ...p,
      ...(receita.razaoSocial ? { razaoSocial: receita.razaoSocial } : {}),
      ...(receita.nomeFantasia ? { nomeFantasia: receita.nomeFantasia } : {}),
      ...(receita.logradouro ? { logradouro: receita.logradouro } : {}),
      ...(receita.numero ? { numero: receita.numero } : {}),
      ...(receita.complemento ? { complemento: receita.complemento } : {}),
      ...(receita.bairro ? { bairro: receita.bairro } : {}),
      ...(receita.municipio ? { municipio: receita.municipio } : {}),
      ...(receita.codigoMunicipio ? { codigoMunicipio: receita.codigoMunicipio } : {}),
      ...(receita.uf ? { uf: receita.uf } : {}),
      ...(receita.cep ? { cep: receita.cep } : {}),
      ...(receita.regimeTributario ? { regimeTributario: receita.regimeTributario } : {}),
      ...(!p.cnpj ? { cnpj: receita.cnpj } : {}),
    }));
  };

  /**
   * Envia certificado + senha + CSCs para a Focus pela rota /provisionar.
   *
   * Multipart, não JSON com base64: o arquivo vai como arquivo e o servidor
   * recusa pelo tamanho antes de ler. Depois da resposta — boa ou ruim — a
   * senha e os CSCs saem do estado da tela; só o arquivo fica, se falhou, para
   * o lojista corrigir a senha sem escolher de novo.
   */
  const handleProvisionar = async () => {
    if (!ehTitular) return;
    if (arquivoCertificado && arquivoCertificado.size > 50 * 1024) {
      setResultadoDoCadastro({ ok: false, mensagem: "Este arquivo é grande demais para ser um certificado A1 (limite 50 KB). Confira se escolheu o .pfx certo." });
      return;
    }
    const form = new FormData();
    if (arquivoCertificado) form.append("certificado", arquivoCertificado);
    form.append("senha", senhaCertificado);
    form.append("cscHomologacao", cscHomologacaoInput.trim());
    form.append("idCscHomologacao", idCscHomologacaoInput.trim());
    form.append("cscProducao", cscProducaoInput.trim());
    form.append("idCscProducao", idCscProducaoInput.trim());

    setProvisionando(true);
    setResultadoDoCadastro(null);
    try {
      const res = await fetch("/api/store/fiscal/provisionar", { method: "POST", body: form });
      const dados = await res.json().catch(() => ({}));
      const lista = Array.isArray(dados.pendencias) && dados.pendencias.length > 0 && res.status === 409
        ? " Falta: " + camposEmTexto(dados.pendencias) + "."
        : "";
      setResultadoDoCadastro({
        ok: res.ok,
        mensagem: (dados.mensagem || (res.ok ? "Cadastro concluído." : "Não consegui cadastrar na Focus.")) + lista,
      });
      if (res.ok) {
        setArquivoCertificado(null);
        setChaveDoArquivo(k => k + 1);
        setIdCscHomologacaoInput("");
        setIdCscProducaoInput("");
        await fetchFiscalData();
      }
    } catch {
      setResultadoDoCadastro({ ok: false, mensagem: "Não consegui falar com o servidor. Nada foi enviado à Focus — tente de novo." });
    } finally {
      // Os IDs do CSC não são segredo e ficam para a nova tentativa; a senha
      // e os códigos do CSC saem da memória da tela de qualquer jeito.
      setSenhaCertificado("");
      setCscHomologacaoInput("");
      setCscProducaoInput("");
      setProvisionando(false);
    }
  };

  // Chama o provedor com o token salvo e traduz a resposta. Autenticou = o
  // token vale; recusou = o lojista descobre AQUI, não na primeira emissão.
  // O `ambiente` vai sempre (POST { ambiente }, o contrato da rota): testar o
  // token do outro ambiente não troca nada. 429 = testou há menos de 1 min.
  const handleTestarConexao = async (ambiente: 1 | 2) => {
    setTestandoConexao(true);
    try {
      const r = await pedirTesteDeConexao(ambiente);
      alert(r.mensagem);
    } catch {
      alert("Não consegui falar com o servidor. Tente de novo.");
    } finally {
      setTestandoConexao(false);
    }
  };

  // Emissor próprio: pergunta à SEFAZ se o serviço está no ar, com o
  // certificado da loja (POST /api/store/fiscal/testar-conexao, da frente de
  // emissão). É consulta de status — não emite nota, nem em produção.
  const handleTestarConexaoSefaz = async (ambiente: 1 | 2) => {
    setTestandoConexao(true);
    try {
      const r = await pedirTesteDeConexao(ambiente);
      // 429: nada foi perguntado à SEFAZ — a frase do servidor diz quanto esperar.
      if (r.aguarde) {
        alert(r.mensagem);
        return;
      }
      alert(`${r.ok ? "Conexão OK" : "A conexão falhou"}${r.cStat ? ` (cStat ${r.cStat})` : ""}: ${r.mensagem}`);
      await fetchFiscalData();
    } catch {
      alert("Não consegui falar com o servidor. Tente de novo.");
    } finally {
      setTestandoConexao(false);
    }
  };

  const handleSaveProductTax = async () => {
    if (!editingProduct) return;
    try {
      const res = await fetch("/api/store/fiscal/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: editingProduct.id,
          ncm: editingProduct.ncm,
          cest: editingProduct.cest,
          cfop: editingProduct.cfop,
          origem: editingProduct.origem,
          csosn: editingProduct.csosn,
          pis: editingProduct.pis,
          cofins: editingProduct.cofins,
        }),
      });
      if (res.ok) {
        alert(`Tributação do produto ${editingProduct.name} salva com sucesso! ⚡`);
        setEditingProduct(null);
        fetchProducts();
      } else {
        // A recusa do servidor (NCM com 7 dígitos, CSOSN 500 sem CEST…) passava
        // calada: o modal ficava aberto e nada dizia o porquê.
        const dados = await res.json().catch(() => ({}));
        alert(dados.mensagem || dados.error || "Não consegui salvar a tributação.");
      }
    } catch {
      alert("Erro ao salvar produto.");
    }
  };

  const handleEmitSingle = async (andPrint = false) => {
    if (!selectedOrderForEmit) return;
    setEmitting(true);
    try {
      const res = await fetch("/api/store/fiscal/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // O CPF digitado no modal VAI junto — antes o campo existia, o lojista
        // preenchia, e o valor era descartado: a nota saía sem o documento.
        body: JSON.stringify({
          orderId: selectedOrderForEmit.id,
          cpfCnpj: emitCpfInput.trim() || null,
        }),
      });
      const dados = await res.json();

      // 202 = a SEFAZ recebeu e ainda está processando. NÃO é sucesso (não há
      // chave nem protocolo) e NÃO é falha (reemitir duplicaria) — é "aguarde
      // e consulte". fetch trata 202 como res.ok, então o teste vem primeiro.
      if (res.status === 202) {
        alert(`${dados.mensagem || "A SEFAZ está processando esta nota."}\n\nUse "Consultar situação" em alguns segundos — não emita de novo.`);
        setSelectedOrderForEmit(null);
        fetchInvoices();
        return;
      }

      if (!res.ok) {
        // A resposta traz a lista do que falta. Mostrar item por item é o que
        // permite o lojista resolver — "Erro na emissão" não dizia nada.
        const lista = Array.isArray(dados.pendencias) && dados.pendencias.length > 0
          ? "\n\n" + dados.pendencias.map((x: any) => `• ${pendenciaEmTexto(x)}`).join("\n")
          : "";
        alert(`${dados.mensagem || dados.error || "Não foi possível emitir."}${lista}`);
        return;
      }

      // Pedido de mesa: a nota que saiu é a da CONTA inteira (o servidor
      // devolve os pedidos que ela cobre), não só a desta rodada. Em
      // contingência a nota vale e o DANFE TEM de ser impresso, mas a SEFAZ
      // ainda vai recebê-la: o aviso diz isso, em vez de um "autorizada" seco.
      const daConta = dados.notaDaConta && Array.isArray(dados.pedidos)
        ? `Nota da conta da mesa ${dados.contingencia ? "emitida em CONTINGÊNCIA" : "autorizada"} — cobre ${dados.pedidos.length} pedido(s) da conta.` +
          (dados.restante ? " É a nota do RESTANTE: o pedido que já tinha nota própria ficou de fora." : "")
        : dados.contingencia
          ? "Nota emitida em CONTINGÊNCIA — imprima o DANFE (ele vale para o cliente)."
          : dados.reemissao ? "Nova nota autorizada (a anterior continua cancelada)." : "Nota autorizada.";
      alert(
        `${daConta}

Chave: ${dados.chaveDeAcesso}
Protocolo: ${dados.protocolo}` +
        (dados.aviso ? `

${dados.aviso}` : "")
      );
      // Pelo proxy do servidor: a URL direta do provedor exige autenticação
      // Basic e abria como 401 no navegador do lojista.
      if (andPrint) window.open(`/api/store/fiscal/danfe?orderId=${selectedOrderForEmit.id}`, "_blank");
      setSelectedOrderForEmit(null);
      fetchInvoices();
    } catch {
      alert("Não consegui falar com o servidor. A nota NÃO foi emitida.");
    } finally {
      setEmitting(false);
    }
  };

  // Consulta no provedor a situação real de uma nota que ficou "processando"
  // (SEFAZ lenta). O servidor sincroniza o pedido: autorizada vira EMITTED.
  const handleConsultarSituacao = async (order: any) => {
    try {
      const res = await fetch(`/api/store/fiscal/emitir?orderId=${order.id}`);
      const dados = await res.json().catch(() => ({}));
      if (res.ok && dados.success && dados.situacao === "contingencia") {
        // Continua valendo para o cliente; a consulta não desfaz nada.
        alert(dados.mensagem || "A nota continua em contingência: a SEFAZ ainda não efetivou. Consulte de novo mais tarde.");
      } else if (res.ok && dados.success) {
        alert(`Nota autorizada.\n\nChave: ${dados.chaveDeAcesso}\nProtocolo: ${dados.protocolo}`);
      } else {
        alert(dados.mensagem || dados.error || "Não consegui consultar a situação.");
      }
      fetchInvoices();
    } catch {
      alert("Não consegui falar com o servidor. Tente de novo.");
    }
  };

  // Cancela a NFC-e na SEFAZ. O prazo é da SEFAZ (normalmente 30 min para
  // NFC-e) — passou, a recusa dela volta na íntegra para o lojista ler.
  //
  // A justificativa é pedida no modal da tela (ModalDeJustificativa), não
  // mais no window.prompt: contagem de caracteres, confirmar só dentro da
  // regra (15 a 255) e a recusa do servidor dentro do modal, com o texto lá.
  const handleCancelarNota = (order: FiscalOrder) => {
    setErroDaJustificativa(null);
    setJustificativaDaNota({ tipo: "cancelar", order });
  };

  const cancelarNota = async (order: FiscalOrder, justificativa: string) => {
    setEnviandoJustificativa(true);
    setErroDaJustificativa(null);
    try {
      const res = await fetch("/api/store/fiscal/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, justificativa }),
      });
      const dados = await res.json().catch(() => ({}));
      fetchInvoices();
      if (res.ok) {
        setJustificativaDaNota(null);
        alert(dados.mensagem || "Nota cancelada.");
        return;
      }
      // Fora da regra do cancelamento (a mercadoria saiu, ou os 30 min
      // passaram): o caminho é a devolução com o contador — o modal oferece
      // registrá-la ali mesmo.
      setErroDaJustificativa({
        mensagem: dados.mensagem || dados.error || "Não consegui cancelar.",
        podeRegistrarDevolucao: Boolean(dados.podeRegistrarDevolucao),
      });
    } catch {
      setErroDaJustificativa({ mensagem: "Não consegui falar com o servidor. Nada foi cancelado — tente de novo.", podeRegistrarDevolucao: false });
    } finally {
      setEnviandoJustificativa(false);
    }
  };

  /**
   * A saída do pedido travado: a nota não cancela mais (mercadoria saiu ou
   * passou o prazo), o contador fez a NF-e de devolução/estorno, e a loja
   * registra isso aqui — o que libera editar e cancelar o pedido
   * (api/store/fiscal/devolucao). Não emite nada na SEFAZ; fica no histórico
   * do pedido. A descrição é pedida no mesmo modal do cancelamento.
   */
  const handleRegistrarDevolucao = (order: FiscalOrder) => {
    setErroDaJustificativa(null);
    setJustificativaDaNota({ tipo: "devolucao", order });
  };

  const registrarDevolucao = async (order: FiscalOrder, observacao: string) => {
    setEnviandoJustificativa(true);
    setErroDaJustificativa(null);
    try {
      const res = await fetch("/api/store/fiscal/devolucao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `confirmar: true` é a declaração marcada no modal ("o contador JÁ fez").
        body: JSON.stringify({ orderId: order.id, observacao, confirmar: true }),
      });
      const dados = await res.json().catch(() => ({}));
      fetchInvoices();
      if (res.ok) {
        setJustificativaDaNota(null);
        alert(dados.mensagem || "Devolução registrada.");
        return;
      }
      setErroDaJustificativa({ mensagem: dados.mensagem || dados.error || "Não consegui registrar.", podeRegistrarDevolucao: false });
    } catch {
      setErroDaJustificativa({ mensagem: "Não consegui falar com o servidor. Nada foi registrado.", podeRegistrarDevolucao: false });
    } finally {
      setEnviandoJustificativa(false);
    }
  };

  /** Grava o acordeão "Regras da nota" — só esses campos (titular). */
  const salvarRegrasDaNota = async () => {
    if (!ehTitular) return;
    // CNPJ igual ao oficial vai vazio: fica valendo o do código, e uma
    // correção lá chega a esta loja sem ninguém mexer aqui.
    const intermediadores: Record<string, { cnpj: string | null; id?: string | null; ativo?: boolean }> = {};
    for (const { canal } of [...CANAIS_DE_MARKETPLACE, ...CANAIS_PROPRIOS]) {
      const a = fiscalConfig.intermediadores?.[canal] || {};
      const cnpj = String(a.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
      const oficial = intermediadoresOficiais[canal]?.cnpj;
      intermediadores[canal] = {
        cnpj: cnpj && cnpj !== oficial ? cnpj : null,
        ...(a.id ? { id: a.id } : {}),
        ...(a.ativo === false ? { ativo: false } : {}),
      };
    }
    setSalvandoRegras(true);
    try {
      const r = await gravarCampos({
        momentoDaEmissao: fiscalConfig.momentoDaEmissao || "saida",
        taxaDeServicoNaNota: fiscalConfig.taxaDeServicoNaNota === true,
        intermediadores,
        pixEstatico: fiscalConfig.pixEstatico === true,
        entregaComoPresencial: fiscalConfig.entregaComoPresencial === true,
      });
      if (!r.ok) explicarRecusa(r.dados, "Não consegui salvar as regras da nota.");
      else alert("Regras da nota salvas." + (r.dados?.aviso ? `\n\n${avisoComRotulos(r.dados.aviso, r.dados.camposIgnorados)}` : ""));
    } catch {
      alert("Não consegui falar com o servidor. Nada foi alterado.");
    } finally {
      setSalvandoRegras(false);
    }
  };

  const handleBatchEmit = async () => {
    if (selectedBatchOrderIds.length === 0) return;
    setBatchEmitting(true);
    try {
      // Uma por vez, de propósito: cada NFC-e consome um número da série, e a
      // SEFAZ recusa a série inteira se houver furo na sequência. Em paralelo,
      // duas falhas simultâneas deixariam dois números queimados.
      const resultados: { numero: any; ok: boolean; motivo?: string }[] = [];
      // Pedidos de mesa: a primeira rodada emite a nota da CONTA inteira e o
      // servidor diz quais pedidos ela cobre. Pedir de novo para as outras
      // rodadas voltaria 409 "já emitida", e a mesa de 13 rodadas do Pastel
      // da Paulista apareceria como "1 de 13 autorizadas".
      const naNotaDaConta = new Set<string>();
      for (const id of selectedBatchOrderIds) {
        const pedido = orders.find((o: any) => o.id === id);
        if (naNotaDaConta.has(id)) {
          resultados.push({ numero: pedido?.dailyOrderNumber ?? id.slice(-5), ok: true });
          continue;
        }
        const res = await fetch("/api/store/fiscal/emitir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: id }),
        });
        const dados = await res.json().catch(() => ({}));
        // 202 (processando) não é autorizada: sem chave, sem protocolo. Conta
        // como pendente com instrução de consultar — nunca como sucesso.
        const autorizada = res.ok && res.status !== 202;
        if (autorizada && dados.notaDaConta && Array.isArray(dados.pedidos)) {
          for (const coberto of dados.pedidos) naNotaDaConta.add(String(coberto));
        }
        resultados.push({
          numero: pedido?.dailyOrderNumber ?? id.slice(-5),
          ok: autorizada,
          motivo: autorizada
            ? undefined
            : res.status === 202
              ? "SEFAZ processando — use Consultar situação, não reemita"
              : (dados.mensagem || dados.error),
        });
      }

      const autorizadas = resultados.filter(r => r.ok);
      const recusadas = resultados.filter(r => !r.ok);
      const detalhe = recusadas.length
        ? "\n\nNão emitidas:\n" + recusadas.map(r => `• #${r.numero}: ${r.motivo}`).join("\n")
        : "";
      // Conta PEDIDOS: numa mesa, vários pedidos saem numa nota só.
      alert(
        `${autorizadas.length} de ${resultados.length} pedido(s) com nota autorizada.` +
        (naNotaDaConta.size > 0 ? " Os pedidos de mesa saíram na nota da conta da mesa." : "") +
        detalhe
      );

      setShowBatchEmitModal(false);
      setSelectedBatchOrderIds([]);
      fetchInvoices();
    } catch {
      alert("Não consegui falar com o servidor. Verifique quais notas saíram antes de tentar de novo.");
    } finally {
      setBatchEmitting(false);
    }
  };

  const handleInutilizar = async () => {
    if (!inutilNumIni || !inutilNumFin || !inutilJustif) {
      alert("Preencha todos os campos obrigatórios.");
      return;
    }
    setInutilizing(true);
    try {
      const res = await fetch("/api/store/fiscal/inutilizacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serie: inutilSerie,
          numeroInicial: inutilNumIni,
          numeroFinal: inutilNumFin,
          justificativa: inutilJustif,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.mensagem);
        setInutilNumIni(""); setInutilNumFin(""); setInutilJustif("");
      } else {
        // A mensagem explica; o slug do erro ("emissao_nao_configurada") não.
        const lista = Array.isArray(data.pendencias) && data.pendencias.length > 0
          ? "\n\n" + data.pendencias.slice(0, 6).map((x: any) => `• ${pendenciaEmTexto(x)}`).join("\n")
          : "";
        alert((data.mensagem || data.error || "Erro ao inutilizar.") + lista);
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setInutilizing(false);
    }
  };

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter(p => p.name.toLowerCase().includes(searchProduct.toLowerCase()) || p.category.toLowerCase().includes(searchProduct.toLowerCase()));
  }, [products, searchProduct]);

  const combosList = useMemo(() => products.filter(p => p.isCombo), [products]);
  const pendingProductsCount = useMemo(() => products.filter(p => !p.ncm || p.ncm === "Indefinido").length, [products]);

  // NCM assistido (lib/nfce/ncm-sugerido, puro): a sugestão de cada produto,
  // calculada aqui uma vez — o painel por categoria, a tabela e o editor do
  // produto mostram a mesma.
  const sugestoesDeNcm = useMemo<SugestaoComAtual[]>(() => {
    const ncmPorId = new Map(products.map(p => [p.id, p.ncm ?? null]));
    return sugerirParaCardapio(
      products.map(p => ({ id: p.id, nome: p.name, categoria: p.category, preco: p.price, ehBebida: p.isBeverage, apenasEmCombo: p.apenasEmCombo })),
      { regime: regimeDosProdutos ?? fiscalConfig.regimeTributario ?? 1, uf: ufDosProdutos || fiscalConfig.uf }
    ).map(s => ({ ...s, ncmAtual: ncmPorId.get(s.produtoId) ?? null }));
  }, [products, regimeDosProdutos, ufDosProdutos, fiscalConfig.regimeTributario, fiscalConfig.uf]);
  const sugestaoPorProduto = useMemo(() => new Map(sugestoesDeNcm.map(s => [s.produtoId, s])), [sugestoesDeNcm]);
  /** O NCM gravado é o que a sugestão aplicou e ninguém revisou ainda? (a mesma regra do lote) */
  const ehSugestaoAplicada = (p: FiscalProduct) => situacaoDoNcmGravado(p.ncm, marcasDoNcm[p.id]) === "sugestao";

  // Filtered Orders & Summary
  const filteredOrders = useMemo(() => {
    if (!searchOrder.trim()) return orders;
    const term = searchOrder.trim().toLowerCase();
    return orders.filter(o =>
      o.customerName.toLowerCase().includes(term) ||
      String(o.dailyOrderNumber).includes(term) ||
      o.id.toLowerCase().includes(term)
    );
  }, [orders, searchOrder]);

  const orderStats = useMemo(() => {
    const totalVendas = filteredOrders.length;
    const valVendas = filteredOrders.reduce((s, o) => s + o.totalAmount, 0);
    // NOTAS, não pedidos: a nota da conta da mesa fica gravada em todas as
    // rodadas, e contar pedidos dava "13 notas autorizadas" para uma nota só,
    // com a soma das rodadas no lugar do valor da nota (que tem o desconto da
    // conta e, no iFood, não tem a taxa de serviço da plataforma).
    const porNota = (lista: FiscalOrder[]) => {
      const m = new Map<string, number>();
      for (const o of lista) {
        const chave = o.fiscalInfo?.nfceKey || o.id;
        const valor = o.fiscalInfo?.valorDaNota;
        m.set(chave, typeof valor === "number" ? valor : (m.get(chave) ?? 0) + o.totalAmount);
      }
      return { quantas: m.size, valor: [...m.values()].reduce((s, v) => s + v, 0) };
    };
    const autorizadas = porNota(filteredOrders.filter(o => o.fiscalStatus === "EMITTED"));
    const negadas = filteredOrders.filter(o => o.fiscalStatus === "FAILED");
    const valNegadas = negadas.reduce((s, o) => s + o.totalAmount, 0);
    const canceladas = porNota(filteredOrders.filter(o => o.fiscalStatus === "CANCELED"));

    return {
      totalVendas, valVendas,
      countAutorizadas: autorizadas.quantas, valAutorizadas: autorizadas.valor,
      countNegadas: negadas.length, valNegadas,
      countCanceladas: canceladas.quantas, valCanceladas: canceladas.valor,
    };
  }, [filteredOrders]);

  // Pedidos cancelados pelo parceiro com a nota ainda de pé (aviso no topo da lista).
  const pedidosComAlerta = useMemo(() => orders.filter(o => o.alerta), [orders]);

  const filteredFaq = useMemo(() => {
    if (!faqSearch.trim()) return FAQ_ITEMS;
    return FAQ_ITEMS.filter(f => f.q.toLowerCase().includes(faqSearch.toLowerCase()) || f.a.toLowerCase().includes(faqSearch.toLowerCase()));
  }, [faqSearch]);

  /* O estado real do módulo, dito em voz alta no topo de todas as abas.
     Antes a tela não avisava nada: o botão "Emitir" respondia
     "✅ Nota Fiscal emitida com sucesso" sem chamar API nenhuma, e a listagem
     inventava chave e protocolo. Dava para usar o módulo por meses achando que
     estava emitindo. Agora, enquanto faltar qualquer peça, a tela diz que
     nenhuma nota sai — e diz exatamente o que buscar. */
  /* A faixa de HOMOLOGAÇÃO.

     O ambiente já era gravado na nota, já vinha da API e já estava no tipo
     desta tela — e não era mostrado em lugar nenhum. Uma loja em homologação
     com o cadastro completo recebia `podeEmitir: true`, a faixa vermelha
     sumia, e a partir daí tudo tinha cara de produção: badge verde
     "Autorizada", série/número, chave de 44 dígitos, protocolo, e o card
     "Notas autorizadas" somando o valor.

     A nota de homologação existe de verdade (no ambiente de TESTE da SEFAZ),
     então nada aqui é inventado — mas para o lojista o efeito prático é o
     mesmo do módulo falso antigo: meses achando que emitiu, e a descoberta na
     fiscalização. Por isso a faixa é fixa, em todas as abas, e não some. */
  const emHomologacao = Number(fiscalConfig.ambiente) === 2;
  const AvisoDeHomologacao = () =>
    !emHomologacao ? null : (
      <div style={{ margin: "0 0 1.25rem", padding: "1rem 1.25rem", background: "#FFF7E6", border: "1px solid #FDE68A", borderLeft: "6px solid #B45309", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="#B45309" />
          <strong style={{ fontSize: "0.92rem", color: "#92400E" }}>
            Modo TESTE (homologação) — as notas emitidas aqui NÃO têm valor fiscal
          </strong>
        </div>
        <p style={{ fontSize: "0.83rem", color: "#78350F", margin: "8px 0 0", lineHeight: 1.5 }}>
          Tudo funciona igual e a nota é aceita — mas pelo ambiente de <strong>teste</strong> da SEFAZ.
          Ela não serve para o cliente, não serve para o contador e não conta para o Fisco.
          Quando terminar de testar, vá em <strong>Configurações → Emissão de NFC-e</strong> e passe para
          <strong> Produção</strong>.
        </p>
      </div>
    );

  // Cadastro completo mas emissão desligada: antes a tela ficava muda nesse
  // caso, e o lojista só descobria no erro "emissão desligada" ao emitir.
  const AvisoDoEstadoFiscal = () =>
    podeEmitir ? (
      fiscalConfig.enabled ? null : (
        <div style={{ margin: "0 0 1.25rem", padding: "1rem 1.25rem", background: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Info size={18} color="#334155" />
            <strong style={{ fontSize: "0.92rem", color: "#1E293B" }}>
              Cadastro completo — a emissão de NFC-e está DESLIGADA
            </strong>
          </div>
          <p style={{ fontSize: "0.83rem", color: "#475569", margin: "8px 0 0", lineHeight: 1.5 }}>
            Nenhuma nota sai enquanto ela estiver desligada. Ligue em <strong>Configurações → Emissão de NFC-e</strong>.
          </p>
        </div>
      )
    ) : (
      <div style={{ margin: "0 0 1.25rem", padding: "1rem 1.25rem", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="#C92E09" />
          <strong style={{ fontSize: "0.92rem", color: "#B71C1C" }}>
            Esta loja ainda não emite nota fiscal
          </strong>
        </div>
        <p style={{ fontSize: "0.83rem", color: "#B71C1C", margin: "8px 0 0", lineHeight: 1.5 }}>
          Nenhuma NFC-e é transmitida à SEFAZ enquanto o cadastro abaixo não estiver completo.
          Os pedidos aparecem como <strong>pendentes</strong> — não há nota emitida para eles.
        </p>
        {pendenciasFiscais.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: "0.82rem", color: "#B71C1C", lineHeight: 1.6 }}>
            {pendenciasFiscais.slice(0, 8).map((p, i) => {
              // "Inscrição Estadual", não "inscricaoEstadual": o lojista lê o
              // nome do campo como está no formulário (lib/textos-da-tela-fiscal).
              const rotulo = rotuloDoCampoFiscal(p.campo);
              return (
                <li key={i}>
                  {rotulo ? <><strong>{rotulo}</strong>: </> : null}{p.mensagem}
                </li>
              );
            })}
            {pendenciasFiscais.length > 8 && (
              <li>e mais {pendenciasFiscais.length - 8} pendência(s).</li>
            )}
          </ul>
        )}
      </div>
    );

  return (
    <div className="fiscal-layout" style={{ background: "#F8FAFC", minHeight: "100vh", display: "flex", fontFamily: "'Inter', sans-serif" }}>
      {/* No celular a barra lateral de 220 px comia metade da tela e as grades
          de duas colunas espremiam os campos: abaixo de 760 px o menu vira uma
          faixa rolável no topo e as grades viram uma coluna. Os estilos da
          página são inline, e media query só existe em CSS — daí as classes. */}
      <style>{`
        @media (max-width: 760px) {
          .fiscal-layout { flex-direction: column; }
          .fiscal-nav { width: auto !important; border-right: none !important; border-bottom: 1px solid #E2E8F0; padding: 0.5rem 0 !important; }
          .fiscal-nav-titulo { display: none; }
          .fiscal-nav-lista { display: flex; gap: 4px; overflow-x: auto; padding: 0.25rem 0.5rem !important; }
          .fiscal-nav-lista > button { width: auto !important; white-space: nowrap; margin-bottom: 0 !important; }
          .fiscal-main { padding: 1rem 0.75rem 130px !important; }
          .fiscal-config-grade, .fiscal-grade-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>
      {/* ── CARDÁPIO WEB STYLE SIDEBAR (FISCAL NAV) ── */}
      <nav aria-label="Seções do módulo fiscal" className="fiscal-nav" style={{ width: 220, background: "#fff", borderRight: "1px solid #E2E8F0", padding: "1.5rem 0", flexShrink: 0 }}>
        <div className="fiscal-nav-titulo" style={{ padding: "0 1.25rem 1rem", borderBottom: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "1px" }}>FISCAL</span>
        </div>

        <div className="fiscal-nav-lista" style={{ padding: "0.75rem 0.5rem" }}>
          {[
            { key: "config", label: "Configurações", icon: Settings },
            { key: "products", label: "Produtos", icon: Layers },
            { key: "invoices", label: "Notas fiscais", icon: Receipt },
            { key: "inutilizacao", label: "Inutilizações", icon: ShieldCheck },
            { key: "contador", label: "Contador", icon: Send },
          ].map(item => {
            const active = activeNav === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setActiveNav(item.key as any)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: active ? "#FAF6F2" : "transparent",
                  color: active ? "#1C1917" : "#475569",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  transition: "0.15s",
                }}
              >
                <Icon size={16} color={active ? "#1C1917" : "#64748B"} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── MAIN CONTENT AREA ── */}
      {/* A folga embaixo (130px) deixa a última linha da tabela de notas subir acima das
          bolinhas flutuantes (WhatsApp da loja e Fale conosco), que ficam sobre a coluna
          "Ação" — o "Cancelar" da última nota ficava debaixo delas. */}
      <div className="fiscal-main" style={{ flex: 1, minWidth: 0, padding: "1.5rem 2rem 130px", overflowX: "auto" }}>
        
        {/* ── NAV 1: CONFIGURAÇÕES FISCAIS (STYLE CARDÁPIO WEB) ── */}
        {activeNav === "config" && (
          <div>
            <AvisoDoEstadoFiscal />
            <AvisoDeHomologacao />
            <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
              Configurações fiscais
            </h1>

            <div className="fiscal-config-grade" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
              {/* Left Column: Accordion Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Emissão de NFC-e: liga/desliga e ambiente, sempre à vista.
                    O erro de emissão sempre mandou "ligar em Fiscal →
                    Configuração" — e não existia botão para isso em lugar
                    nenhum. O ambiente saiu do acordeão do fim da página: é a
                    decisão que mais pesa (teste x nota de verdade). */}
                {(() => {
                  const ligada = Boolean(fiscalConfig.enabled);
                  const producao = Number(fiscalConfig.ambiente) === 1;
                  const cert = fiscalConfig.certificado;
                  const cor = !ligada ? "#475569" : producao ? "#0F766E" : "#B45309";
                  const fundo = !ligada ? "#F1F5F9" : producao ? "#F0FDFA" : "#FFF7E6";
                  return (
                    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem 1.5rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: "1rem", color: "#1E293B" }}>Emissão de NFC-e</span>
                        <span style={{ fontSize: "0.75rem", fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: fundo, color: cor, letterSpacing: "0.3px" }}>
                          {!ligada ? "DESLIGADA" : producao ? "LIGADA — PRODUÇÃO" : "LIGADA — HOMOLOGAÇÃO (TESTE)"}
                        </span>
                      </div>
                      <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "8px 0 0", lineHeight: 1.5 }}>
                        {ligada
                          ? producao
                            ? "As notas saem com valor fiscal. Desligar para aqui a emissão manual e a automática."
                            : "As notas saem pelo ambiente de TESTE da SEFAZ, sem valor fiscal. Quando estiver tudo certo, passe para produção."
                          : podeEmitir
                            ? "O cadastro está completo. Ligue para começar — de preferência em homologação primeiro."
                            : `Só dá para ligar com o cadastro completo: ${pendenciasFiscais.length} pendência(s) na lista vermelha do topo.`}
                      </p>

                      <div role="group" aria-label="Ambiente da emissão" style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                        {([2, 1] as const).map(amb => {
                          const ativo = Number(fiscalConfig.ambiente) === amb;
                          const temToken = amb === 1 ? fiscalConfig.temToken?.producao : fiscalConfig.temToken?.homologacao;
                          // Token sozinho não basta: a Focus devolve os dois tokens no
                          // cadastro, mas só emite no ambiente que tem CSC.
                          const temCsc = (amb === 1 ? fiscalConfig.temCscNoAmbiente?.producao : fiscalConfig.temCscNoAmbiente?.homologacao) !== false;
                          // No emissor próprio não há token: o ambiente precisa do
                          // certificado válido e do CSC dele.
                          const prontoNoProprio = amb === 1 ? fiscalConfig.emissorProprio?.prontoNoAmbiente.producao : fiscalConfig.emissorProprio?.prontoNoAmbiente.homologacao;
                          const pronto = emissorProprioAtivo ? Boolean(prontoNoProprio) : Boolean(temToken) && temCsc;
                          // O token colado à mão é de um ambiente só. Antes ele
                          // "cobria" os dois e este botão mostrava produção pronta
                          // com o token de homologação. Agora o botão diz de onde é.
                          const nomeDoAmb = amb === 1 ? "producao" : "homologacao";
                          const tokenColadoEhDoOutro = Boolean(fiscalConfig.temTokenManual) && fiscalConfig.ambienteDoTokenManual !== nomeDoAmb;
                          return (
                            <button
                              key={amb}
                              type="button"
                              aria-pressed={ativo}
                              onClick={() => trocarAmbiente(amb)}
                              disabled={!ehTitular || alterandoEmissao}
                              style={{
                                padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${ativo ? "#1C1917" : "#CBD5E1"}`,
                                background: ativo ? "#FAF6F2" : "#fff", color: ativo ? "#1C1917" : "#475569", fontWeight: 700,
                                cursor: ehTitular ? "pointer" : "not-allowed", fontSize: "0.82rem", textAlign: "left",
                              }}
                            >
                              {amb === 2 ? "🧪 Homologação (teste)" : "🚀 Produção (vale de verdade)"}
                              <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 600, color: pronto ? "#0F766E" : "#B91C1C", marginTop: 2 }}>
                                {emissorProprioAtivo
                                  ? pronto
                                    ? "certificado e CSC ✓"
                                    : !fiscalConfig.emissorProprio?.certificado
                                      ? "sem certificado"
                                      : fiscalConfig.emissorProprio.certificado.situacao === "vencido"
                                        ? "certificado vencido"
                                        : "sem CSC deste ambiente"
                                  : pronto
                                  ? "token e CSC cadastrados ✓"
                                  : !temToken
                                    ? tokenColadoEhDoOutro
                                      ? `sem token (o colado à mão é de ${fiscalConfig.ambienteDoTokenManual === "producao" ? "produção" : "homologação"})`
                                      : "sem token"
                                    : "sem CSC deste ambiente"}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
                        {ligada ? (
                          <button
                            onClick={() => alternarEmissao(false)}
                            disabled={!ehTitular || alterandoEmissao}
                            style={{ padding: "9px 18px", background: "#fff", color: "#B91C1C", border: "1.5px solid #B91C1C", borderRadius: 8, fontWeight: 800, cursor: ehTitular ? "pointer" : "not-allowed", opacity: alterandoEmissao ? 0.6 : 1 }}
                          >
                            Desligar emissão
                          </button>
                        ) : (
                          <button
                            onClick={() => alternarEmissao(true)}
                            disabled={!ehTitular || !podeEmitir || alterandoEmissao}
                            title={!podeEmitir ? "Resolva as pendências do cadastro para ligar" : undefined}
                            style={{ padding: "9px 18px", background: podeEmitir && ehTitular ? "#1C1917" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: podeEmitir && ehTitular ? "pointer" : "not-allowed", opacity: alterandoEmissao ? 0.6 : 1 }}
                          >
                            {producao ? "Ligar emissão em PRODUÇÃO" : "Ligar emissão (homologação)"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => (emissorProprioAtivo ? handleTestarConexaoSefaz : handleTestarConexao)(Number(fiscalConfig.ambiente) === 1 ? 1 : 2)}
                          disabled={testandoConexao}
                          style={{ padding: "9px 14px", background: "#fff", color: "#1C1917", border: "1.5px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", opacity: testandoConexao ? 0.6 : 1 }}
                        >
                          {testandoConexao ? "Testando..." : emissorProprioAtivo ? "Testar conexão com a SEFAZ" : "Testar conexão com a Focus"}
                        </button>
                        {alterandoEmissao && <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Salvando…</span>}
                      </div>

                      {!ehTitular && papelDoUsuario && (
                        <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "10px 0 0" }}>
                          Só o responsável pela loja liga, desliga ou troca o ambiente da emissão.
                        </p>
                      )}
                      {cert && cert.situacao !== "ok" && (
                        <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#B91C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px", margin: "12px 0 0", lineHeight: 1.5 }}>
                          {cert.situacao === "vencido"
                            ? `O certificado digital VENCEU em ${fmtData(cert.validoAte)}. Nenhuma nota é autorizada até você enviar o novo em "${emissorProprioAtivo ? "Emissor do FireHub → Certificado digital" : "Cadastro na Focus NFe"}".`
                            : `O certificado digital vence em ${fmtData(cert.validoAte)} (${cert.dias} dia(s)). Renove na certificadora e envie o arquivo novo em "${emissorProprioAtivo ? "Emissor do FireHub → Certificado digital" : "Cadastro na Focus NFe"}" antes disso.`}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Quem transmite as notas: o emissor do FireHub (padrão da
                    loja nova, sem custo por nota) ou a Focus (conta própria). */}
                {!loading && (
                  <EscolhaDoEmissor
                    provedor={emissorProprioAtivo ? "sefaz" : "focusnfe"}
                    padrao={Boolean(fiscalConfig.provedorPadrao)}
                    ehTitular={ehTitular}
                    emissaoLigada={Boolean(fiscalConfig.enabled)}
                    gravando={gravandoEmissor}
                    aoEscolher={escolherEmissor}
                  />
                )}
                {!loading && emissorProprioAtivo && (
                  <EmissorProprio
                    emissor={fiscalConfig.emissorProprio ?? null}
                    prontidao={prontidao}
                    uf={String(fiscalConfig.uf || "")}
                    ufsAtendidas={ufsDoEmissorProprio}
                    emissaoLigada={Boolean(fiscalConfig.enabled)}
                    ambiente={Number(fiscalConfig.ambiente) === 1 ? 1 : 2}
                    ehTitular={ehTitular}
                    papelDoUsuario={papelDoUsuario}
                    aoAtualizar={fetchFiscalData}
                  />
                )}

                {/* Accordion 1: Dados da Empresa */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpenConfigSection(openConfigSection === "dados" ? null : "dados")}
                    aria-expanded={openConfigSection === "dados"}
                    aria-controls="fiscal-secao-dados"
                    style={ESTILO_DO_CABECALHO}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#0F766E" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Dados da empresa</span>
                    </div>
                    <ChevronRight aria-hidden size={18} color="#94A3B8" style={{ transform: openConfigSection === "dados" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {openConfigSection === "dados" && (
                    <div id="fiscal-secao-dados" style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      {/* Receita Federal: razão social, fantasia, endereço, IBGE e
                          regime como SUGESTÃO ao lado de cada campo. */}
                      <div style={{ marginTop: 14, padding: "10px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => consultarReceita()}
                          disabled={consultandoReceita}
                          style={{ padding: "7px 12px", background: "#fff", color: "#1C1917", border: "1.5px solid #CBD5E1", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: consultandoReceita ? 0.6 : 1 }}
                        >
                          <Search size={14} aria-hidden /> {consultandoReceita ? "Consultando a Receita…" : receita ? "Consultar a Receita de novo" : "Buscar os dados na Receita Federal"}
                        </button>
                        {receita && (
                          <span style={{ fontSize: "0.75rem", color: receita.ativa ? "#334155" : "#B71C1C", lineHeight: 1.4, flex: "1 1 220px" }}>
                            Receita Federal: CNPJ <strong>{receita.situacao}</strong>
                            {receita.porte ? ` · ${receita.porte}` : ""}
                            {receita.atividade ? ` · ${receita.atividade}` : ""}
                          </span>
                        )}
                        {receita && ehTitular && (
                          <button
                            type="button"
                            onClick={usarTudoDaReceita}
                            style={{ padding: "7px 12px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
                          >
                            Usar todos os dados da Receita
                          </button>
                        )}
                      </div>
                      {erroDaReceita && <p role="status" style={{ fontSize: "0.78rem", color: "#B71C1C", margin: "6px 0 0" }}>{erroDaReceita}</p>}
                      {receita?.avisos.map(a => (
                        <p key={a} style={{ fontSize: "0.75rem", color: "#92400E", margin: "6px 0 0", lineHeight: 1.45 }}>{a}</p>
                      ))}
                      <div className="fiscal-grade-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                        <div>
                          <label htmlFor="fiscal-cnpj" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>CNPJ / CPF *</label>
                          {/* O valor é o GRAVADO. Mostrar o documento do cadastro da
                              loja aqui dentro fazia o campo parecer salvo sem estar. */}
                          <input id="fiscal-cnpj" value={fiscalConfig.cnpj} onChange={e => setFiscalConfig(p => ({ ...p, cnpj: e.target.value }))} aria-describedby={sugestoes.cnpj && !fiscalConfig.cnpj ? "fiscal-cnpj-sugestao" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {sugestoes.cnpj && !fiscalConfig.cnpj && (
                            <Sugestao id="fiscal-cnpj-sugestao" campo="CNPJ" valor={sugestoes.cnpj} origem="documento do cadastro da loja" onUsar={() => setFiscalConfig(p => ({ ...p, cnpj: sugestoes.cnpj || "" }))} />
                          )}
                        </div>
                        <div>
                          <label htmlFor="fiscal-ie" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Inscrição Estadual (IE)</label>
                          <input id="fiscal-ie" value={fiscalConfig.inscricaoEstadual} onChange={e => setFiscalConfig(p => ({ ...p, inscricaoEstadual: e.target.value }))} placeholder="Obrigatória para emitir NFC-e" aria-describedby="fiscal-ie-ajuda" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {/* A Receita Federal não tem a IE (é do estado): a consulta
                              não sugere nada aqui, e a tela diz onde achar. */}
                          <p id="fiscal-ie-ajuda" style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0", lineHeight: 1.4 }}>
                            A Receita Federal não informa a IE.{" "}
                            {String(fiscalConfig.uf || receita?.uf || "").toUpperCase() === "DF"
                              ? "No DF ela se chama CF/DF (13 dígitos): está no cadastro da Receita do DF ou com o contador."
                              : "Ela está no cadastro da SEFAZ do seu estado ou com o contador."}
                          </p>
                        </div>
                        <div>
                          <label htmlFor="fiscal-razao-social" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Razão Social *</label>
                          <input id="fiscal-razao-social" value={fiscalConfig.razaoSocial} onChange={e => setFiscalConfig(p => ({ ...p, razaoSocial: e.target.value }))} placeholder="Como consta no cartão CNPJ" aria-describedby={receitaDiferente("razaoSocial") ? "fiscal-razao-social-receita" : sugestoes.razaoSocial && !fiscalConfig.razaoSocial ? "fiscal-razao-social-sugestao" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("razaoSocial") ? (
                            <Sugestao id="fiscal-razao-social-receita" campo="razão social" valor={receita!.razaoSocial!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, razaoSocial: receita?.razaoSocial || "" }))} />
                          ) : sugestoes.razaoSocial && !fiscalConfig.razaoSocial && !receita?.razaoSocial && (
                            <Sugestao id="fiscal-razao-social-sugestao" campo="razão social" valor={sugestoes.razaoSocial} origem="nome da loja — confira no cartão CNPJ, a razão social costuma ser outra" onUsar={() => setFiscalConfig(p => ({ ...p, razaoSocial: sugestoes.razaoSocial || "" }))} />
                          )}
                        </div>
                        <div>
                          <label htmlFor="fiscal-nome-fantasia" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Nome Fantasia</label>
                          <input id="fiscal-nome-fantasia" value={fiscalConfig.nomeFantasia} onChange={e => setFiscalConfig(p => ({ ...p, nomeFantasia: e.target.value }))} placeholder="Vazio: vai a razão social" aria-describedby={receitaDiferente("nomeFantasia") ? "fiscal-nome-fantasia-receita" : sugestoes.nomeFantasia && !fiscalConfig.nomeFantasia ? "fiscal-nome-fantasia-sugestao" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("nomeFantasia") ? (
                            <Sugestao id="fiscal-nome-fantasia-receita" campo="nome fantasia" valor={receita!.nomeFantasia!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, nomeFantasia: receita?.nomeFantasia || "" }))} />
                          ) : sugestoes.nomeFantasia && !fiscalConfig.nomeFantasia && !receita?.nomeFantasia && (
                            <Sugestao id="fiscal-nome-fantasia-sugestao" campo="nome fantasia" valor={sugestoes.nomeFantasia} origem="nome da loja" onUsar={() => setFiscalConfig(p => ({ ...p, nomeFantasia: sugestoes.nomeFantasia || "" }))} />
                          )}
                        </div>
                        <div>
                          <label htmlFor="fiscal-regime" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Regime tributário (CRT) *</label>
                          <select
                            id="fiscal-regime"
                            value={fiscalConfig.regimeTributario ?? ""}
                            onChange={e => setFiscalConfig(p => ({ ...p, regimeTributario: e.target.value ? Number(e.target.value) : null }))}
                            aria-describedby={sugestoes.regimeTributario && fiscalConfig.regimeTributario == null ? "fiscal-regime-sugestao" : undefined}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", background: "#fff" }}
                          >
                            <option value="" disabled>Selecione o regime…</option>
                            <option value={1}>1 — Simples Nacional</option>
                            <option value={2}>2 — Simples Nacional (excesso de sublimite)</option>
                            <option value={3} disabled>3 — Regime Normal (em breve)</option>
                            {/* MEI (CRT 4) já era lido pelo servidor (regimeNumerico) e
                                validado na nota (CFOP 5102, CSOSN 102/300 — rejeições
                                337 e 782), mas a tela não deixava escolher. */}
                            <option value={4}>4 — MEI (Microempreendedor Individual)</option>
                          </select>
                          {receita?.regimeTributario && receita.regimeTributario !== fiscalConfig.regimeTributario ? (
                            // Simples → CRT 1; MEI → CRT 4. O CRT 2 (excesso de
                            // sublimite) não aparece na consulta: é sugestão.
                            <Sugestao
                              id="fiscal-regime-receita"
                              campo="regime tributário"
                              valor={receita.regimeTributario === 4 ? "4 — MEI" : "1 — Simples Nacional"}
                              origem={receita.regimeTributario === 4 ? "Receita Federal: optante pelo MEI" : "Receita Federal: optante pelo Simples"}
                              onUsar={() => setFiscalConfig(p => ({ ...p, regimeTributario: receita?.regimeTributario ?? p.regimeTributario }))}
                            />
                          ) : sugestoes.regimeTributario && fiscalConfig.regimeTributario == null && !receita?.regimeTributario && (
                            <Sugestao id="fiscal-regime-sugestao" campo="regime tributário" valor="1 — Simples Nacional" origem="o regime da maioria das lojas" onUsar={() => setFiscalConfig(p => ({ ...p, regimeTributario: sugestoes.regimeTributario ?? 1 }))} />
                          )}
                        </div>
                      </div>
                      {(sugestoes.cnpj || sugestoes.razaoSocial || sugestoes.regimeTributario) && (
                        <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "10px 0 0", lineHeight: 1.5 }}>
                          As sugestões não estão gravadas: a lista de pendências e o botão de ligar conferem só o que foi salvo.
                          Use as que estiverem certas e clique em <strong>Salvar Dados</strong>.
                        </p>
                      )}
                      <button onClick={() => saveFiscalConfig()} style={{ marginTop: 14, padding: "8px 18px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Dados</button>
                    </div>
                  )}
                </div>

                {/* Accordion 2: Configurações Fiscais Gerais */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpenConfigSection(openConfigSection === "gerais" ? null : "gerais")}
                    aria-expanded={openConfigSection === "gerais"}
                    aria-controls="fiscal-secao-gerais"
                    style={ESTILO_DO_CABECALHO}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#0F766E" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Configurações fiscais gerais</span>
                    </div>
                    <ChevronRight aria-hidden size={18} color="#94A3B8" style={{ transform: openConfigSection === "gerais" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {openConfigSection === "gerais" && (
                    <div id="fiscal-secao-gerais" style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 12 }}>Selecione as formas de pagamento com emissão automática de NFC-e (basta uma forma do pedido estar marcada — no pagamento dividido a nota é da venda inteira):</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        {PAYMENT_OPTIONS.map(pm => {
                          const active = fiscalConfig.autoEmitPaymentMethods.includes(pm.key);
                          return (
                            <label key={pm.key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
                              <input type="checkbox" checked={active} onChange={() => {
                                const next = active ? fiscalConfig.autoEmitPaymentMethods.filter(k => k !== pm.key) : [...fiscalConfig.autoEmitPaymentMethods, pm.key];
                                // Só este campo: antes o clique no checkbox gravava o
                                // formulário inteiro, com o que estivesse meio digitado.
                                setFiscalConfig(p => ({ ...p, autoEmitPaymentMethods: next }));
                                gravarCampos({ autoEmitPaymentMethods: next }).then(r => {
                                  if (!r.ok) explicarRecusa(r.dados, "Não consegui salvar as formas de pagamento.");
                                });
                              }} style={{ accentColor: "#1C1917", width: 16, height: 16 }} />
                              {pm.label} — <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 400 }}>{pm.desc}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion: Regras da nota — quando sai e o que entra nela.
                    Estes campos já decidiam a nota (lib/fiscal-momento,
                    lib/fiscal-emissao) e ninguém conseguia gravá-los: o PUT os
                    descartava e a tela não tinha onde pedir. */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpenConfigSection(openConfigSection === "regras" ? null : "regras")}
                    aria-expanded={openConfigSection === "regras"}
                    aria-controls="fiscal-secao-regras"
                    style={ESTILO_DO_CABECALHO}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Receipt size={18} color="#0F766E" />
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B", display: "block" }}>Regras da nota</span>
                        <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Quando a nota sai, taxa de serviço, marketplaces, Pix e entrega</span>
                      </div>
                    </div>
                    <ChevronRight aria-hidden size={18} color="#94A3B8" style={{ transform: openConfigSection === "regras" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {openConfigSection === "regras" && (() => {
                    const rotulo = { fontSize: "0.85rem", fontWeight: 800, color: "#1E293B", margin: "16px 0 6px", display: "block" } as const;
                    const ajuda = { display: "block", fontSize: "0.75rem", color: "#64748B", fontWeight: 400, marginTop: 2, lineHeight: 1.45 } as const;
                    const campo = { width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" } as const;
                    const ajuste = (canal: string) => fiscalConfig.intermediadores?.[canal] || {};
                    const mudarAjuste = (canal: string, mudanca: { cnpj?: string | null; id?: string | null; ativo?: boolean }) =>
                      setFiscalConfig(p => ({ ...p, intermediadores: { ...(p.intermediadores || {}), [canal]: { ...(p.intermediadores?.[canal] || {}), ...mudanca } } }));
                    return (
                      <div id="fiscal-secao-regras" style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                        <fieldset disabled={!ehTitular} style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
                          <legend style={rotulo}>Quando a nota sai</legend>
                          {MOMENTOS_DA_EMISSAO.map(m => (
                            <label key={m.valor} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                              <input
                                type="radio"
                                name="fiscal-momento-da-emissao"
                                checked={(fiscalConfig.momentoDaEmissao || "saida") === m.valor}
                                onChange={() => setFiscalConfig(p => ({ ...p, momentoDaEmissao: m.valor }))}
                                style={{ accentColor: "#1C1917", marginTop: 3 }}
                              />
                              <span>{m.nome}<span style={ajuda}>{m.explicacao}</span></span>
                            </label>
                          ))}
                          <p style={{ ...ajuda, marginTop: 8 }}>Mesa: sempre uma nota por CONTA, no fechamento — as rodadas não têm nota própria.</p>

                          <span style={rotulo}>Taxa de serviço da mesa</span>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                            <input type="checkbox" checked={fiscalConfig.taxaDeServicoNaNota === true} onChange={e => setFiscalConfig(p => ({ ...p, taxaDeServicoNaNota: e.target.checked }))} style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2 }} />
                            <span>
                              Os 10% do garçom entram na nota
                              <span style={ajuda}>
                                Desligado (padrão): a taxa fica fora da nota — pela Lei 13.419/2017 ela não é receita da casa, é da equipe.
                                Ligue só se o seu contador pedir; aí ela entra como outras despesas.
                              </span>
                            </span>
                          </label>

                          <span style={rotulo}>Marketplaces (intermediador da venda)</span>
                          <p style={{ ...ajuda, marginTop: 0 }}>
                            Venda pelo iFood e pelo 99Food vai na nota com o CNPJ da plataforma e o identificador da loja nela
                            (NT 2020.006). Os CNPJs abaixo são os conferidos na Receita; troque só se o seu contador indicar outro
                            (o da NFS-e de comissão que a plataforma emite para você).
                          </p>
                          {CANAIS_DE_MARKETPLACE.map(({ canal, nome }) => {
                            const oficial = intermediadoresOficiais[canal];
                            const a = ajuste(canal);
                            return (
                              <div key={canal} style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 10, alignItems: "center", marginTop: 8 }}>
                                <label htmlFor={`fiscal-intermediador-${canal}`} style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>{nome}</label>
                                <input
                                  id={`fiscal-intermediador-${canal}`}
                                  value={a.cnpj ?? oficial?.cnpj ?? ""}
                                  onChange={e => mudarAjuste(canal, { cnpj: e.target.value })}
                                  placeholder={oficial?.cnpj || "CNPJ do intermediador"}
                                  aria-describedby={`fiscal-intermediador-${canal}-ajuda`}
                                  style={campo}
                                />
                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", color: "#475569", cursor: "pointer" }}>
                                  <input type="checkbox" checked={a.ativo !== false} onChange={e => mudarAjuste(canal, { ativo: e.target.checked })} style={{ accentColor: "#1C1917" }} />
                                  declarar
                                </label>
                                <span id={`fiscal-intermediador-${canal}-ajuda`} style={{ ...ajuda, gridColumn: "2 / 4", marginTop: -4 }}>
                                  {oficial ? `Oficial: ${oficial.razaoSocial}, ${oficial.cnpj}.` : ""} Desmarcar &quot;declarar&quot; tira o intermediador da nota — só com orientação do contador.
                                </span>
                              </div>
                            );
                          })}
                          <p style={{ ...ajuda, marginTop: 12 }}>
                            Brendi, Wabiz e JotaJá são delivery PRÓPRIO da loja (cardápio com a sua marca): a venda vai sem
                            intermediador. Só preencha se o seu contrato com um deles for de intermediação — aí informe o CNPJ e o
                            identificador da loja na plataforma.
                          </p>
                          {CANAIS_PROPRIOS.map(({ canal, nome }) => {
                            const a = ajuste(canal);
                            return (
                              <div key={canal} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", gap: 10, alignItems: "center", marginTop: 8 }}>
                                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>{nome}</span>
                                <input aria-label={`CNPJ do intermediador ${nome}`} value={a.cnpj ?? ""} onChange={e => mudarAjuste(canal, { cnpj: e.target.value })} placeholder="Vazio = delivery próprio" style={campo} />
                                <input aria-label={`Identificador da loja na ${nome}`} value={a.id ?? ""} onChange={e => mudarAjuste(canal, { id: e.target.value })} placeholder="Identificador da loja" style={campo} />
                              </div>
                            );
                          })}

                          <span style={rotulo}>Pix</span>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                            <input type="checkbox" checked={fiscalConfig.pixEstatico === true} onChange={e => setFiscalConfig(p => ({ ...p, pixEstatico: e.target.checked }))} style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2 }} />
                            <span>
                              Recebo Pix por chave ou QR Code fixo (Pix estático)
                              <span style={ajuda}>
                                A nota declara Pix estático (código 20), sem os dados de cartão. Deixe desligado se o Pix passa pela
                                maquininha ou por QR Code gerado a cada venda.
                              </span>
                            </span>
                          </label>

                          <span style={rotulo}>Entrega</span>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                            <input type="checkbox" checked={fiscalConfig.entregaComoPresencial === true} onChange={e => setFiscalConfig(p => ({ ...p, entregaComoPresencial: e.target.checked }))} style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2 }} />
                            <span>
                              Emitir a entrega como venda presencial
                              <span style={{ ...ajuda, color: "#92400E" }}>
                                Use SÓ se a SEFAZ do seu estado recusar a nota de entrega com a rejeição 785 (&quot;não aceita NFC-e de
                                entrega&quot;). Em qualquer outro caso a entrega vai como entrega, com o CPF e o endereço do cliente
                                (presença 4) — ligar isto sem a 785 é declarar a venda errado.
                              </span>
                            </span>
                          </label>
                        </fieldset>

                        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={salvarRegrasDaNota}
                            disabled={!ehTitular || salvandoRegras}
                            style={{ padding: "8px 18px", background: ehTitular ? "#1C1917" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: ehTitular ? "pointer" : "not-allowed", opacity: salvandoRegras ? 0.6 : 1 }}
                          >
                            {salvandoRegras ? "Salvando…" : "Salvar regras da nota"}
                          </button>
                          {!ehTitular && papelDoUsuario && (
                            <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Só o responsável pela loja muda as regras da nota.</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Accordion: Endereço fiscal — vai no XML de toda NFC-e */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpenConfigSection(openConfigSection === "endereco" ? null : "endereco")}
                    aria-expanded={openConfigSection === "endereco"}
                    aria-controls="fiscal-secao-endereco"
                    style={ESTILO_DO_CABECALHO}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#0F766E" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Endereço fiscal da empresa</span>
                    </div>
                    <ChevronRight aria-hidden size={18} color="#94A3B8" style={{ transform: openConfigSection === "endereco" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {openConfigSection === "endereco" && (
                    <div id="fiscal-secao-endereco" style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 12 }}>
                        É o endereço que consta no CNPJ — ele vai dentro do XML de cada nota. O código IBGE do
                        município tem 7 dígitos e é diferente do CEP (busque por &quot;código IBGE + nome da cidade&quot;).
                      </p>
                      {receita && ["logradouro", "numero", "complemento", "bairro", "municipio", "codigoMunicipio", "uf", "cep"].some(c => receitaDiferente(c as Parameters<typeof receitaDiferente>[0])) && (
                        <p style={{ fontSize: "0.75rem", color: "#334155", margin: "8px 0 0" }}>
                          A Receita Federal tem um endereço diferente do que está aqui: veja as sugestões abaixo de cada campo, ou{" "}
                          <button type="button" onClick={usarTudoDaReceita} style={{ background: "none", border: "none", padding: 0, color: "#1D4ED8", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", textDecoration: "underline" }}>
                            use todos os dados da Receita
                          </button>{" "}
                          e clique em <strong>Salvar Endereço</strong>.
                        </p>
                      )}
                      <div className="fiscal-grade-2" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-logradouro">Logradouro (rua/avenida) *</label>
                          <input id="fiscal-logradouro" value={fiscalConfig.logradouro || ""} onChange={e => setFiscalConfig(p => ({ ...p, logradouro: e.target.value }))} aria-describedby={receitaDiferente("logradouro") ? "fiscal-logradouro-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("logradouro") && (
                            <Sugestao id="fiscal-logradouro-receita" campo="logradouro" valor={receita!.logradouro!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, logradouro: receita?.logradouro || "" }))} />
                          )}
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-numero">Número *</label>
                          <input id="fiscal-numero" value={fiscalConfig.numero || ""} onChange={e => setFiscalConfig(p => ({ ...p, numero: e.target.value }))} placeholder='Sem número? "S/N"' aria-describedby={receitaDiferente("numero") ? "fiscal-numero-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("numero") && (
                            <Sugestao id="fiscal-numero-receita" campo="número" valor={receita!.numero!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, numero: receita?.numero || "" }))} />
                          )}
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-complemento">Complemento</label>
                          <input id="fiscal-complemento" value={fiscalConfig.complemento || ""} onChange={e => setFiscalConfig(p => ({ ...p, complemento: e.target.value }))} placeholder="Loja, sala, bloco (opcional)" aria-describedby={receitaDiferente("complemento") ? "fiscal-complemento-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("complemento") && (
                            <Sugestao id="fiscal-complemento-receita" campo="complemento" valor={receita!.complemento!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, complemento: receita?.complemento || "" }))} />
                          )}
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-bairro">Bairro *</label>
                          <input id="fiscal-bairro" value={fiscalConfig.bairro || ""} onChange={e => setFiscalConfig(p => ({ ...p, bairro: e.target.value }))} aria-describedby={receitaDiferente("bairro") ? "fiscal-bairro-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("bairro") && (
                            <Sugestao id="fiscal-bairro-receita" campo="bairro" valor={receita!.bairro!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, bairro: receita?.bairro || "" }))} />
                          )}
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-cep">CEP *</label>
                          <input id="fiscal-cep" value={fiscalConfig.cep || ""} onChange={e => setFiscalConfig(p => ({ ...p, cep: e.target.value }))} placeholder="00000-000" aria-describedby={receitaDiferente("cep") ? "fiscal-cep-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("cep") && (
                            <Sugestao id="fiscal-cep-receita" campo="CEP" valor={receita!.cep!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, cep: receita?.cep || "" }))} />
                          )}
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-municipio">Município *</label>
                          <input id="fiscal-municipio" value={fiscalConfig.municipio || ""} onChange={e => setFiscalConfig(p => ({ ...p, municipio: e.target.value }))} aria-describedby={receitaDiferente("municipio") ? "fiscal-municipio-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          {receitaDiferente("municipio") && (
                            <Sugestao id="fiscal-municipio-receita" campo="município" valor={receita!.municipio!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, municipio: receita?.municipio || "" }))} />
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
                          <div>
                            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-codigo-ibge">Código IBGE *</label>
                            <input id="fiscal-codigo-ibge" value={fiscalConfig.codigoMunicipio} onChange={e => setFiscalConfig(p => ({ ...p, codigoMunicipio: e.target.value }))} placeholder="7 dígitos" aria-describedby={receitaDiferente("codigoMunicipio") ? "fiscal-codigo-ibge-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                            {receitaDiferente("codigoMunicipio") && (
                              <Sugestao id="fiscal-codigo-ibge-receita" campo="código IBGE" valor={receita!.codigoMunicipio!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, codigoMunicipio: receita?.codigoMunicipio || "" }))} />
                            )}
                          </div>
                          <div>
                            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }} htmlFor="fiscal-uf">UF *</label>
                            <input id="fiscal-uf" value={fiscalConfig.uf} maxLength={2} onChange={e => setFiscalConfig(p => ({ ...p, uf: e.target.value.toUpperCase() }))} placeholder="RJ" aria-describedby={receitaDiferente("uf") ? "fiscal-uf-receita" : undefined} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", textTransform: "uppercase" }} />
                            {receitaDiferente("uf") && (
                              <Sugestao id="fiscal-uf-receita" campo="UF" valor={receita!.uf!} origem="Receita Federal" onUsar={() => setFiscalConfig(p => ({ ...p, uf: receita?.uf || "" }))} />
                            )}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => saveFiscalConfig()} style={{ marginTop: 14, padding: "8px 18px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Endereço</button>
                    </div>
                  )}
                </div>

                {/* Accordion: Cadastro na Focus NFe — certificado A1 e CSC.
                    Substitui os três acordeões antigos (Provedor, Certificado e
                    Ambiente). Antes o lojista abria conta própria na Focus,
                    subia o certificado no painel de lá e colava aqui um token
                    por ambiente: nenhuma loja chegou ao fim. Agora o FireHub
                    cadastra a empresa pela conta de revenda e recebe os dois
                    tokens de uma vez. O caminho manual continua, recolhido,
                    para quem já tem conta na Focus. Só aparece quando a Focus é
                    o emissor escolhido: no emissor do FireHub, o certificado e o
                    CSC são os do cartão "Emissor do FireHub". */}
                {!emissorProprioAtivo && (
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setOpenConfigSection(openConfigSection === "focus" ? null : "focus")}
                    aria-expanded={openConfigSection === "focus"}
                    aria-controls="fiscal-secao-focus"
                    style={ESTILO_DO_CABECALHO}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: fiscalConfig.cadastradoNaFocus ? "#F0FDFA" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {fiscalConfig.cadastradoNaFocus ? <Check size={20} color="#0F766E" /> : <Lock size={18} color="#64748B" />}
                      </div>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B", display: "block" }}>Cadastro na Focus NFe (certificado e CSC)</span>
                        <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                          {fiscalConfig.cadastradoNaFocus
                            ? `Cadastrada${fiscalConfig.certificado ? ` · certificado até ${fmtData(fiscalConfig.certificado.validoAte)}` : ""}`
                            : fiscalConfig.temTokenManual || fiscalConfig.temToken?.homologacao || fiscalConfig.temToken?.producao
                              ? "Conta própria na Focus (token colado)"
                              : "Ainda não cadastrada"}
                        </span>
                      </div>
                    </div>
                    <ChevronRight aria-hidden size={18} color="#94A3B8" style={{ transform: openConfigSection === "focus" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </button>

                  {openConfigSection === "focus" && (() => {
                    const uf = String(fiscalConfig.uf || "").toUpperCase();
                    const guia = PASSO_A_PASSO_POR_UF[uf] || PASSO_A_PASSO_GENERICO;
                    const cadastrada = Boolean(fiscalConfig.cadastradoNaFocus);
                    const podeEnviar = ehTitular && cadastroAutomaticoDisponivel && !provisionando;
                    const rotulo = { fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 } as const;
                    const campo = { width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" } as const;
                    const csc = fiscalConfig.cscNaFocus;
                    return (
                      <div id="fiscal-secao-focus" style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                        {cadastrada && (
                          <div style={{ marginTop: 12, padding: "10px 14px", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 10, fontSize: "0.82rem", color: "#134E4A", lineHeight: 1.6 }}>
                            <strong>Empresa cadastrada na Focus NFe</strong>
                            {fiscalConfig.cadastradoNaFocusEm ? ` em ${fmtData(fiscalConfig.cadastradoNaFocusEm)}` : ""}.
                            {fiscalConfig.certificado && <> Certificado A1 válido até <strong>{fmtData(fiscalConfig.certificado.validoAte)}</strong>.</>}
                            <br />
                            CSC de homologação: {csc?.homologacao ? `ID ${csc.homologacao.id}, final ••••${csc.homologacao.final}` : "não cadastrado"} ·
                            CSC de produção: {csc?.producao ? `ID ${csc.producao.id}, final ••••${csc.producao.final}` : "não cadastrado"}
                          </div>
                        )}

                        <div style={{ marginTop: 14 }}>
                          <p style={{ fontSize: "0.85rem", fontWeight: 800, color: "#1E293B", margin: 0 }}>Antes de começar, tenha em mãos:</p>
                          <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: "0.8rem", color: "#475569", lineHeight: 1.6 }}>
                            <li>
                              <strong>Certificado digital A1 (e-CNPJ)</strong> — o arquivo <strong>.pfx</strong> ou <strong>.p12</strong> e a senha dele.
                              Compra-se numa certificadora e vale 1 ano. O A3 (cartão ou token USB) não serve.
                            </li>
                            <li><strong>Inscrição Estadual ativa</strong> — quem emite NFC-e precisa de IE; &quot;isento&quot; não vale para o emitente.</li>
                            <li><strong>Credenciamento de NFC-e na SEFAZ{uf ? `-${uf}` : ""}</strong> — {guia.credenciamento}</li>
                            <li><strong>CSC e ID do CSC</strong> (um de homologação e um de produção) — {guia.csc}</li>
                          </ol>
                          {"aviso" in guia && guia.aviso && (
                            <p style={{ fontSize: "0.8rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", margin: "10px 0 0", lineHeight: 1.5 }}>
                              <strong>Atenção ({uf}):</strong> {guia.aviso}
                            </p>
                          )}
                          {!uf && (
                            <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "6px 0 0" }}>
                              Preencha a UF no endereço fiscal para ver o passo a passo do seu estado.
                            </p>
                          )}
                        </div>

                        {!cadastroAutomaticoDisponivel && (
                          <p style={{ fontSize: "0.8rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", margin: "14px 0 0", lineHeight: 1.5 }}>
                            O cadastro automático ainda não está disponível: o FireHub ainda não tem conta de revenda na
                            Focus NFe. Se você já tem conta própria na Focus, use <strong>&quot;Já tenho conta na Focus NFe&quot;</strong> logo abaixo.
                          </p>
                        )}

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                          <div>
                            <label htmlFor="fiscal-certificado" style={rotulo}>
                              Certificado A1 (.pfx ou .p12) {cadastrada ? <span style={{ color: "#94A3B8", fontWeight: 500 }}>— só para trocar</span> : "*"}
                            </label>
                            <input
                              id="fiscal-certificado"
                              key={chaveDoArquivo}
                              type="file"
                              accept=".pfx,.p12,application/x-pkcs12"
                              disabled={!podeEnviar}
                              onChange={e => { setArquivoCertificado(e.target.files?.[0] || null); setResultadoDoCadastro(null); }}
                              style={{ ...campo, padding: "6px 8px", background: "#fff" }}
                            />
                          </div>
                          <div>
                            <label htmlFor="fiscal-senha-certificado" style={rotulo}>Senha do certificado {arquivoCertificado ? "*" : ""}</label>
                            <input
                              id="fiscal-senha-certificado"
                              type="password"
                              autoComplete="new-password"
                              value={senhaCertificado}
                              disabled={!podeEnviar}
                              onChange={e => setSenhaCertificado(e.target.value)}
                              placeholder="A senha definida ao baixar o certificado"
                              style={campo}
                            />
                          </div>
                          <div>
                            <label htmlFor="fiscal-id-csc-homologacao" style={rotulo}>ID do CSC de homologação</label>
                            <input id="fiscal-id-csc-homologacao" value={idCscHomologacaoInput} disabled={!podeEnviar} onChange={e => setIdCscHomologacaoInput(e.target.value)} placeholder={csc?.homologacao ? `Atual: ${csc.homologacao.id}` : "Ex.: 000001"} style={campo} />
                          </div>
                          <div>
                            <label htmlFor="fiscal-csc-homologacao" style={rotulo}>CSC de homologação</label>
                            <input id="fiscal-csc-homologacao" type="password" autoComplete="off" value={cscHomologacaoInput} disabled={!podeEnviar} onChange={e => setCscHomologacaoInput(e.target.value)} placeholder={csc?.homologacao ? `Atual: ••••${csc.homologacao.final}` : "Código gerado no portal da SEFAZ"} style={campo} />
                          </div>
                          <div>
                            <label htmlFor="fiscal-id-csc-producao" style={rotulo}>ID do CSC de produção</label>
                            <input id="fiscal-id-csc-producao" value={idCscProducaoInput} disabled={!podeEnviar} onChange={e => setIdCscProducaoInput(e.target.value)} placeholder={csc?.producao ? `Atual: ${csc.producao.id}` : "Ex.: 000002"} style={campo} />
                          </div>
                          <div>
                            <label htmlFor="fiscal-csc-producao" style={rotulo}>CSC de produção</label>
                            <input id="fiscal-csc-producao" type="password" autoComplete="off" value={cscProducaoInput} disabled={!podeEnviar} onChange={e => setCscProducaoInput(e.target.value)} placeholder={csc?.producao ? `Atual: ••••${csc.producao.final}` : "Código gerado no portal da SEFAZ"} style={campo} />
                          </div>
                        </div>
                        <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "8px 0 0", lineHeight: 1.5 }}>
                          O certificado, a senha e o CSC vão direto para a Focus NFe, que assina e transmite as notas.
                          O FireHub não guarda nenhum deles — fica só a validade do certificado e o final do CSC, para você conferir.
                          Os dados da empresa enviados são os salvos em &quot;Dados da empresa&quot; e &quot;Endereço fiscal&quot;.
                        </p>
                        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            onClick={handleProvisionar}
                            disabled={!podeEnviar}
                            style={{ padding: "9px 18px", background: podeEnviar ? "#1C1917" : "#CBD5E1", color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, cursor: podeEnviar ? "pointer" : "not-allowed" }}
                          >
                            {provisionando ? "Enviando para a Focus…" : cadastrada ? "Atualizar cadastro na Focus" : "Cadastrar na Focus NFe"}
                          </button>
                          {!ehTitular && papelDoUsuario && (
                            <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Só o responsável pela loja envia o certificado.</span>
                          )}
                        </div>
                        {resultadoDoCadastro && (
                          <p style={{
                            fontSize: "0.82rem", lineHeight: 1.5, margin: "10px 0 0", padding: "8px 12px", borderRadius: 8,
                            color: resultadoDoCadastro.ok ? "#134E4A" : "#B71C1C",
                            background: resultadoDoCadastro.ok ? "#F0FDFA" : "#FEF2F2",
                            border: `1px solid ${resultadoDoCadastro.ok ? "#99F6E4" : "#FECACA"}`,
                          }}>
                            {resultadoDoCadastro.mensagem}
                          </p>
                        )}

                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed #E2E8F0", display: "flex", alignItems: "flex-end", gap: 12 }}>
                          <div style={{ width: 140 }}>
                            <label htmlFor="fiscal-serie" style={rotulo}>Série da NFC-e *</label>
                            <input
                              id="fiscal-serie"
                              type="number"
                              min={1}
                              value={fiscalConfig.serie}
                              onChange={e => setFiscalConfig(p => ({ ...p, serie: Number(e.target.value) || 1 }))}
                              style={campo}
                            />
                          </div>
                          <button onClick={() => saveFiscalConfig()} style={{ padding: "8px 16px", background: "#fff", color: "#1C1917", border: "1.5px solid #1C1917", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar série</button>
                          <span style={{ fontSize: "0.75rem", color: "#94A3B8", flex: 1 }}>Normalmente 1. Trocar a série no meio da operação abre uma numeração nova na SEFAZ.</span>
                        </div>

                        <button
                          type="button"
                          aria-expanded={mostrarCadastroManual}
                          aria-controls="fiscal-cadastro-manual"
                          onClick={() => setMostrarCadastroManual(v => !v)}
                          style={{ marginTop: 16, background: "none", border: "none", padding: 0, color: "#334155", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                        >
                          {mostrarCadastroManual ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          Já tenho conta na Focus NFe (colar token)
                        </button>
                        {mostrarCadastroManual && (
                          <div id="fiscal-cadastro-manual" style={{ marginTop: 10, padding: 14, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10 }}>
                            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0, lineHeight: 1.5 }}>
                              Para quem já tem a empresa, o certificado e o CSC cadastrados no painel da própria conta na Focus.
                              Cole os tokens de acesso de cada ambiente — ficam guardados cifrados e nunca voltam para a tela.
                            </p>
                            {fiscalConfig.temTokenManual && (() => {
                              // O token colado na tela antiga era um só e servia para os
                              // dois ambientes — inclusive para passar para produção com o
                              // de homologação. Agora vale só no ambiente dele, e a tela diz.
                              const doToken = fiscalConfig.ambienteDoTokenManual === "producao" ? "PRODUÇÃO" : "HOMOLOGAÇÃO";
                              const outro = fiscalConfig.ambienteDoTokenManual === "producao" ? "homologação" : "produção";
                              const outroCoberto = fiscalConfig.ambienteDoTokenManual === "producao" ? fiscalConfig.temToken?.homologacao : fiscalConfig.temToken?.producao;
                              return (
                                <p style={{ fontSize: "0.78rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", margin: "10px 0 0", lineHeight: 1.5 }}>
                                  Há um token colado à mão na configuração antiga: ele vale <strong>só em {doToken}</strong>.
                                  {outroCoberto ? "" : ` Para emitir em ${outro}, cole abaixo o token de ${outro}.`}
                                </p>
                              );
                            })()}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                              <div>
                                <label htmlFor="fiscal-provedor" style={rotulo}>Provedor</label>
                                <select
                                  id="fiscal-provedor"
                                  value={fiscalConfig.provedor || ""}
                                  onChange={e => setFiscalConfig(p => ({ ...p, provedor: e.target.value || null }))}
                                  style={{ ...campo, background: "#fff" }}
                                >
                                  <option value="">Selecione…</option>
                                  <option value="focusnfe">Focus NFe</option>
                                </select>
                              </div>
                              <div />
                              <div>
                                <label htmlFor="fiscal-token-homologacao" style={rotulo}>
                                  Token de homologação {fiscalConfig.temToken?.homologacao && <span style={{ color: "#0F766E" }}>— cadastrado ✓</span>}
                                </label>
                                <input id="fiscal-token-homologacao" type="password" autoComplete="off" value={tokenHomologacaoInput} onChange={e => setTokenHomologacaoInput(e.target.value)} placeholder={fiscalConfig.temToken?.homologacao ? "Preencher só para trocar" : "Cole o token aqui"} style={campo} />
                              </div>
                              <div>
                                <label htmlFor="fiscal-token-producao" style={rotulo}>
                                  Token de produção {fiscalConfig.temToken?.producao && <span style={{ color: "#0F766E" }}>— cadastrado ✓</span>}
                                </label>
                                <input id="fiscal-token-producao" type="password" autoComplete="off" value={tokenProducaoInput} onChange={e => setTokenProducaoInput(e.target.value)} placeholder={fiscalConfig.temToken?.producao ? "Preencher só para trocar" : "Cole o token aqui"} style={campo} />
                              </div>
                              <div>
                                <label htmlFor="fiscal-csc-id-manual" style={rotulo}>ID do CSC (idToken)</label>
                                <input id="fiscal-csc-id-manual" value={fiscalConfig.cscId} onChange={e => setFiscalConfig(p => ({ ...p, cscId: e.target.value }))} placeholder="Ex.: 000001" style={campo} />
                              </div>
                              <div>
                                <label htmlFor="fiscal-csc-manual" style={rotulo}>
                                  CSC {fiscalConfig.temCsc && <span style={{ color: "#0F766E" }}>— cadastrado{fiscalConfig.cscFinal ? ` (final ••••${fiscalConfig.cscFinal})` : ""} ✓</span>}
                                </label>
                                <input id="fiscal-csc-manual" type="password" autoComplete="off" value={cscInput} onChange={e => setCscInput(e.target.value)} placeholder={fiscalConfig.temCsc ? "Preencher só para trocar" : "O mesmo cadastrado no painel da Focus"} style={campo} />
                              </div>
                            </div>
                            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                              <input
                                type="checkbox"
                                checked={Boolean(fiscalConfig.temCertificado)}
                                disabled={!ehTitular}
                                onChange={e => {
                                  gravarCampos({ temCertificado: e.target.checked }).then(r => {
                                    if (!r.ok) explicarRecusa(r.dados, "Não consegui salvar.");
                                  });
                                }}
                                style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2 }}
                              />
                              <span>
                                Já enviei o certificado A1 (.pfx) no painel da Focus.
                                <span style={{ display: "block", fontSize: "0.75rem", color: "#94A3B8", fontWeight: 400, marginTop: 2 }}>
                                  O FireHub não vê o certificado da sua conta — quem confirma de verdade é a primeira emissão em homologação.
                                </span>
                              </span>
                            </label>
                            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                              <button onClick={() => saveFiscalConfig()} style={{ padding: "8px 18px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar tokens</button>
                              <button onClick={() => handleTestarConexao(2)} disabled={testandoConexao} style={{ padding: "8px 14px", background: "#fff", color: "#1C1917", border: "1.5px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer", opacity: testandoConexao ? 0.6 : 1 }}>Testar homologação</button>
                              <button onClick={() => handleTestarConexao(1)} disabled={testandoConexao} style={{ padding: "8px 14px", background: "#fff", color: "#1C1917", border: "1.5px solid #CBD5E1", borderRadius: 8, fontWeight: 700, cursor: "pointer", opacity: testandoConexao ? 0.6 : 1 }}>Testar produção</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                )}

              </div>

              {/* Right Column: FAQ Box */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 800, color: "#1E293B" }}>
                  Dúvidas Frequentes sobre o Módulo Fiscal
                </h3>
                <div style={{ position: "relative", marginBottom: 14 }}>
                  <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                  <input value={faqSearch} onChange={e => setFaqSearch(e.target.value)} placeholder="Pesquise por palavras-chave" style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.8rem" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredFaq.map((faq, idx) => (
                    <div key={idx} style={{ borderBottom: "1px solid #F1F5F9", paddingBottom: 8 }}>
                      <button onClick={() => setOpenFaqIdx(openFaqIdx === idx ? null : idx)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", textTransform: "none", textAlign: "left", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                        {faq.q}
                        <ChevronDown size={14} color="#94A3B8" style={{ transform: openFaqIdx === idx ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                      </button>
                      {openFaqIdx === idx && (
                        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#64748B", lineHeight: 1.4 }}>{faq.a}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── NAV 2: CONFIGURAÇÕES FISCAIS DOS PRODUTOS & COMBOS ── */}
        {activeNav === "products" && (
          <div>
            <AvisoDoEstadoFiscal />
            <AvisoDeHomologacao />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
                Configurações fiscais dos produtos
              </h1>
              {pendingProductsCount > 0 && (
                <div style={{ background: "#FFF4EF", border: "1px solid #FFD3C2", borderRadius: 10, padding: "6px 14px", fontSize: "0.82rem", color: "#E8590C", fontWeight: 700 }}>
                  Você possui <strong>{pendingProductsCount} produtos</strong> com dados pendentes
                </div>
              )}
            </div>

            {/* Sub-tabs: PRODUTOS | ENGENHARIA DE COMBOS */}
            <div role="group" aria-label="Produtos ou engenharia de combos" style={{ display: "flex", gap: 16, borderBottom: "2px solid #E2E8F0", marginBottom: 16, flexWrap: "wrap" }}>
              <button type="button" aria-pressed={productsTab === "produtos"} onClick={() => setProductsTab("produtos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "produtos" ? 800 : 600, color: productsTab === "produtos" ? "#1C1917" : "#64748B", borderBottom: productsTab === "produtos" ? "3px solid #1C1917" : "3px solid transparent", cursor: "pointer" }}>
                PRODUTOS
              </button>
              <button type="button" aria-pressed={productsTab === "combos"} onClick={() => setProductsTab("combos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "combos" ? 800 : 600, color: productsTab === "combos" ? "#1C1917" : "#64748B", borderBottom: productsTab === "combos" ? "3px solid #1C1917" : "3px solid transparent", cursor: "pointer" }}>
                ENGENHARIA DE COMBOS
              </button>
            </div>

            {productsTab === "produtos" ? (
              <>
              {products.length > 0 && (
                <NcmAssistido
                  sugestoes={sugestoesDeNcm}
                  marcas={marcasDoNcm}
                  ehTitular={ehTitular}
                  papelDoUsuario={papelDoUsuario}
                  aoAtualizar={fetchProducts}
                />
              )}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                    <Search size={14} aria-hidden style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                    <input aria-label="Pesquisar produto" value={searchProduct} onChange={e => setSearchProduct(e.target.value)} placeholder="Pesquise pelo produto" style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" }} />
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#F1F5F9", textTransform: "uppercase", fontSize: "0.7rem", color: "#475569" }}>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "left" }}>Categoria</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "left" }}>Produto</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "right" }}>Preço</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>Situação</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>NCM</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>CEST</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>CFOP</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>CSOSN/CST</th>
                        <th scope="col" style={{ padding: "8px 10px", textAlign: "center" }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map(p => {
                        const isRegular = p.ncm && p.ncm !== "Indefinido";
                        // "Marcar o que é sugestão": o NCM que o lote aplicou e
                        // ninguém revisou aparece como tal, não como "Regular".
                        const sugestaoAplicada = isRegular && ehSugestaoAplicada(p);
                        const sugestao = sugestaoPorProduto.get(p.id);
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{p.category}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1E293B" }}>{p.name}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{fmt(p.price)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <span
                                title={sugestaoAplicada ? "NCM aplicado pela sugestão — revisar com o contador" : undefined}
                                style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: sugestaoAplicada ? "#FFF7E6" : isRegular ? "#F0FDFA" : "#FFF4EF", color: sugestaoAplicada ? "#B45309" : isRegular ? "#0F766E" : "#E8590C" }}
                              >
                                {sugestaoAplicada ? "Sugestão aplicada" : isRegular ? "Regular" : "Pendente"}
                              </span>
                              {sugestaoAplicada && <span style={{ display: "block", fontSize: "0.65rem", color: "#B45309", marginTop: 2 }}>revisar com o contador</span>}
                              {!isRegular && sugestao && sugestao.opcoes.length > 0 && (
                                <span style={{ display: "block", fontSize: "0.65rem", color: "#64748B", marginTop: 2 }}>
                                  sugestão: {sugestao.opcoes.length > 1 ? `${sugestao.opcoes.map(o => ncmComPontos(o.ncm)).join(" ou ")} (escolha)` : ncmComPontos(sugestao.opcoes[0].ncm)}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.ncm || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cest || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cfop || "5102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.csosn || "102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <button type="button" onClick={() => setEditingProduct(p)} aria-label={`Editar a tributação de ${p.name}`} style={{ background: "none", border: "none", cursor: "pointer", color: "#1C1917", fontWeight: 700 }}>Editar ✏️</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              </>
            ) : (
              /* Sub-tab Engenharia de Combos */
              <div style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, display: "grid" }}>
                {combosList.map(combo => (
                  <div key={combo.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 800 }}>{combo.name}</h3>
                    <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "#0F766E" }}>{fmt(combo.price)}</span>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "6px 0 12px" }}>
                      {combo.fiscalBreakdown ? "🟢 Engenharia Discriminada Ativa" : "⚪ Valor Único Padrão"}
                    </p>
                    <button onClick={() => { setEditingCombo(combo); setFiscalItemsDraft(combo.fiscalBreakdown || []); setPrecoFiscalPorItem({}); fetchComboDetails(combo.id); }} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #1C1917", background: "#FAF6F2", color: "#1C1917", fontWeight: 700, cursor: "pointer" }}>
                      Configurar Engenharia Fiscal
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── NAV 3: NOTAS FISCAIS (STYLE CARDÁPIO WEB SCREENSHOT 3) ── */}
        {activeNav === "invoices" && (
          <div>
            <AvisoDoEstadoFiscal />
            <AvisoDeHomologacao />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
                Notas fiscais
              </h1>

              {/* Action buttons matching screenshot 3 red arrows */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => {
                    // Cancelado NÃO entra no lote: emitir NFC-e de venda
                    // cancelada é pagar imposto sobre venda que não houve.
                    // Nota em processamento também fica de fora — reemitir
                    // duplicaria; o caminho dela é "Consultar situação".
                    // Rodada de MESA também fica de fora da pré-seleção: a nota
                    // é da conta inteira (uma por mesa), e pré-marcar as treze
                    // rodadas de uma mesa grande pedia treze vezes a mesma nota.
                    // Quem quiser a nota da conta marca uma rodada da mesa.
                    // Nota cancelada também: emitir outra é decisão caso a caso.
                    const pendingIds = orders
                      .filter(o =>
                        o.fiscalStatus !== "EMITTED" &&
                        o.fiscalStatus !== "CANCELED" &&
                        o.orderStatus !== "CANCELADO" &&
                        !o.fiscalInfo?.processando &&
                        !o.tableSessionId
                      )
                      .map(o => o.id);
                    setSelectedBatchOrderIds(pendingIds);
                    setShowBatchEmitModal(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#fff",
                    color: "#334155",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  <Receipt size={15} /> Emissão em lote
                </button>

                <button
                  onClick={() => {
                    // Pelo PROXY do servidor, não pela URL do Focus.
                    //
                    // O link salvo no pedido aponta direto para o Focus, que
                    // exige autenticação Basic com o token da loja: aberto no
                    // navegador ele responde 401 e nenhum arquivo baixava. O
                    // botão do DANFE já fazia certo; este ficou para trás.
                    const comXml = (orders as any[]).filter(o => o.fiscalInfo?.xmlUrl);
                    if (comXml.length === 0) {
                      alert("Nenhuma nota autorizada no período — não há XML para baixar.");
                      return;
                    }
                    comXml.forEach(o => window.open(`/api/store/fiscal/danfe?orderId=${encodeURIComponent(o.id)}&tipo=xml`, "_blank"));
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#fff",
                    color: "#334155",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  <Download size={15} /> Baixar XMLs
                </button>
              </div>
            </div>

            {/* Pedido cancelado pelo parceiro (iFood, 99Food, Brendi, JotaJá,
                disputa) com a NFC-e de pé: o cancelamento do parceiro não passa
                pela trava da nota — então ele avisa aqui, e o aviso fica até a
                nota ser cancelada ou a devolução ser registrada. */}
            {pedidosComAlerta.length > 0 && (
              <div role="alert" style={{ margin: "0 0 16px", padding: "12px 16px", background: "#FEF2F2", border: "1px solid #FECACA", borderLeft: "6px solid #B91C1C", borderRadius: 12 }}>
                <strong style={{ fontSize: "0.88rem", color: "#991B1B" }}>
                  {pedidosComAlerta.length} pedido(s) cancelado(s) com NFC-e que continua valendo
                </strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "0.8rem", color: "#7F1D1D", lineHeight: 1.5 }}>
                  {pedidosComAlerta.slice(0, 6).map(o => (
                    <li key={o.id}>Nº {o.dailyOrderNumber}: {o.alerta?.mensagem}</li>
                  ))}
                  {pedidosComAlerta.length > 6 && <li>e mais {pedidosComAlerta.length - 6}.</li>}
                </ul>
              </div>
            )}

            {/* Filter Bar: Input + Date Range + Filter */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                <input
                  value={searchOrder}
                  onChange={e => setSearchOrder(e.target.value)}
                  placeholder="Número do pedido"
                  style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: "0 10px" }}>
                <Calendar size={14} color="#64748B" />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: "none", fontSize: "0.8rem", outline: "none" }} />
                <span>~</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: "none", fontSize: "0.8rem", outline: "none" }} />
              </div>
            </div>

            {/* 4 Summary Cards (Exact Cardápio Web Screenshot 3) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
              {/* Card 1: Total de Vendas */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FAF6F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DollarSign size={22} color="#1C1917" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Total de vendas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#1E293B" }}>{orderStats.totalVendas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{fmt(orderStats.valVendas)}</span>
                </div>
              </div>

              {/* Card 2: Notas Autorizadas */}
              <div style={{ background: "#fff", border: "1px solid #99F6E4", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#F0FDFA", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={22} color="#0F766E" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#0F766E", fontWeight: 700, textTransform: "uppercase" }}>Notas autorizadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#0F766E" }}>{orderStats.countAutorizadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#0F766E" }}>{fmt(orderStats.valAutorizadas)}</span>
                </div>
              </div>

              {/* Card 3: Notas Negadas */}
              <div style={{ background: "#fff", border: "1px solid #FFD3C2", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF4EF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HelpCircle size={22} color="#E8590C" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#9A3412", fontWeight: 700, textTransform: "uppercase" }}>Notas negadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#9A3412" }}>{orderStats.countNegadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#9A3412" }}>{fmt(orderStats.valNegadas)}</span>
                </div>
              </div>

              {/* Card 4: Notas Canceladas */}
              <div style={{ background: "#fff", border: "1px solid #FECACA", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <AlertTriangle size={22} color="#C92E09" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#B71C1C", fontWeight: 700, textTransform: "uppercase" }}>Notas canceladas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#B71C1C" }}>{orderStats.countCanceladas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#B71C1C" }}>{fmt(orderStats.valCanceladas)}</span>
                </div>
              </div>
            </div>

            {/* Table of Orders & Invoices (Exact Cardápio Web Table Format) */}
            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F1F5F9", textTransform: "uppercase", fontSize: "0.7rem", color: "#475569" }}>
                    <th style={{ padding: "10px", textAlign: "left" }}>Pedido</th>
                    <th style={{ padding: "10px", textAlign: "left" }}>Data do pedido</th>
                    <th style={{ padding: "10px", textAlign: "right" }}>Total</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Status do pedido</th>
                    <th style={{ padding: "10px", textAlign: "left" }}>Formas de pagamento</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Tipo</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Série/Número</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Data de emissão</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Status da nota</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => {
                    const createdDate = new Date(order.createdAt);
                    const dateStr = createdDate.toLocaleDateString("pt-BR") + " " + createdDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const isEmitted = order.fiscalStatus === "EMITTED";
                    /**
                     * Nota emitida em HOMOLOGAÇÃO não vale nada fiscalmente —
                     * é o ambiente de teste da SEFAZ. O campo `ambiente` já era
                     * gravado e já vinha da API, mas não era exibido em lugar
                     * nenhum: a linha mostrava badge verde "Autorizada", chave
                     * de 44 dígitos e protocolo, idêntica à de produção. O
                     * lojista testava, esquecia de virar a chave, e passava a
                     * ver uma tela cheia de notas "autorizadas" sem uma única
                     * nota válida — descobrindo na fiscalização.
                     */
                    const isHomologacao = isEmitted && Number(order.fiscalInfo?.ambiente) === 2;
                    // "Processando": a SEFAZ recebeu e ainda não respondeu —
                    // reemitir duplicaria; o caminho certo é consultar.
                    const isProcessing = !isEmitted && Boolean(order.fiscalInfo?.processando);
                    const isFailed = !isEmitted && !isProcessing && order.fiscalStatus === "FAILED";
                    const isNotaCancelada = order.fiscalStatus === "CANCELED";
                    const isPedidoCancelado = order.orderStatus === "CANCELADO";
                    // Contingência: EMITTED (o DANFE vale e aparece), marcada à parte.
                    const isContingencia = isEmitted && order.fiscalInfo?.contingencia === true;
                    const daMesa = Boolean(order.tableSessionId);
                    const devolucao = isEmitted ? order.fiscalInfo?.devolucao ?? null : null;
                    const emittedAtStr = order.fiscalInfo?.emittedAt
                      ? new Date(order.fiscalInfo.emittedAt).toLocaleDateString("pt-BR") + " " +
                        new Date(order.fiscalInfo.emittedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                      : null;

                    return (
                      <tr key={order.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px", fontWeight: 700, color: "#1E293B" }}>
                          Nº {order.dailyOrderNumber}
                          <span style={{ fontSize: "0.68rem", color: "#94A3B8", display: "block" }}>#{order.id.slice(-8)}</span>
                          {daMesa && (
                            <span style={{ fontSize: "0.68rem", color: "#0F766E", display: "block", fontWeight: 700 }}>
                              {order.mesa?.nome || (order.mesa?.numero != null ? `Mesa ${order.mesa.numero}` : "Mesa")}
                              {order.fiscalInfo?.notaDaConta?.pedidos
                                ? ` · nota da conta (${order.fiscalInfo.notaDaConta.pedidos} pedidos)`
                                : order.mesa && !order.mesa.contaFechada ? " · conta aberta" : " · nota da conta"}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px", color: "#475569" }}>{dateStr}</td>
                        <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmt(order.totalAmount)}</td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          {/* Antes era "Concluído" carimbado em TODA linha —
                              inclusive pedido cancelado. */}
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: isPedidoCancelado ? "#FEE2E2" : "#F0FDFA", color: isPedidoCancelado ? "#B71C1C" : "#0F766E" }}>
                            {isPedidoCancelado ? "Cancelado" : "Concluído"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: "#334155" }}>{order.paymentMethod}</td>
                        <td style={{ padding: "10px", textAlign: "center", color: "#64748B" }}>{order.deliveryType || "—"}</td>
                        <td style={{ padding: "10px", textAlign: "center", color: isEmitted ? "#1E293B" : "#94A3B8" }}>
                          {isEmitted ? `${order.fiscalInfo?.serie}/${order.fiscalInfo?.nfceNumber}` : "Indefinido"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center", color: isEmitted ? "#475569" : "#94A3B8" }}>
                          {/* Data da EMISSÃO (fiscalInfo.emittedAt), não a do
                              pedido — eram mostradas como a mesma coisa. */}
                          {isEmitted ? (emittedAtStr || dateStr) : "—"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          <span
                            title={
                              isFailed
                                ? (order.fiscalInfo?.ultimoErro || "") +
                                  (order.fiscalInfo?.pendencias || []).map((p) => `\n• ${pendenciaEmTexto(p)}`).join("")
                                : isHomologacao
                                ? "Emitida no ambiente de HOMOLOGAÇÃO da SEFAZ (teste). Não tem valor fiscal e não serve para o cliente nem para o contador."
                                : undefined
                            }
                            style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                              background: isHomologacao || isContingencia ? "#FFF7E6" : isEmitted ? "#F0FDFA" : isProcessing ? "#FFF7E6" : isFailed ? "#FEE2E2" : "#F1F5F9",
                              color: isHomologacao || isContingencia ? "#92400E" : isEmitted ? "#0F766E" : isProcessing ? "#B45309" : isFailed ? "#B71C1C" : "#64748B",
                            }}
                          >
                            {isHomologacao ? "TESTE — sem valor fiscal"
                              : isContingencia ? "Contingência — aguardando SEFAZ"
                              : isEmitted ? (devolucao ? "Autorizada · devolução registrada" : "Autorizada")
                              : isNotaCancelada ? "Nota cancelada" : isProcessing ? "Processando" : isFailed ? "Falhou" : "Não emitida"}
                          </span>
                          {isContingencia && (
                            <span style={{ display: "block", fontSize: "0.68rem", color: "#92400E", marginTop: 4, maxWidth: 220, marginInline: "auto", lineHeight: 1.35 }}>
                              Vale para o cliente (imprima o DANFE); a SEFAZ ainda vai receber — a consulta automática acompanha.
                            </span>
                          )}
                          {order.alerta && (
                            <span style={{ display: "block", fontSize: "0.68rem", color: "#B91C1C", fontWeight: 700, marginTop: 4 }}>
                              ⚠ cancelado ({order.alerta.origem}) com nota de pé
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          {isEmitted ? (
                            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                              <button onClick={() => setSelectedOrderForDanfe(order)} style={{ background: "none", border: "none", cursor: "pointer" }} title="Espelho simplificado (conferência rápida)">
                                📄 Espelho
                              </button>
                              {/* DANFCe oficial via servidor. É HTML (não PDF): a rota
                                  servia como application/pdf e o navegador não abria. */}
                              <button onClick={() => window.open(`/api/store/fiscal/danfe?orderId=${order.id}`, "_blank")} style={{ background: "none", border: "none", cursor: "pointer" }} title="DANFCe oficial (cupom com QR Code, pronto para imprimir)">
                                🧾 DANFE
                              </button>
                              {isContingencia ? (
                                // A nota off-line não cancela antes de a SEFAZ efetivar;
                                // consultar não desfaz nada (lib/fiscal-automatico → sincronizarNota).
                                <button onClick={() => handleConsultarSituacao(order)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B45309" }} title="Ver se a SEFAZ já efetivou a nota emitida em contingência">
                                  ↻ Consultar
                                </button>
                              ) : order.fiscalInfo?.podeCancelar !== false ? (
                                <button onClick={() => handleCancelarNota(order)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B71C1C" }} title="Cancelar a nota na SEFAZ — só enquanto a mercadoria não saiu e em até 30 min da autorização">
                                  ✕ Cancelar
                                </button>
                              ) : !devolucao && !isHomologacao ? (
                                <button
                                  onClick={() => handleRegistrarDevolucao(order)}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "#475569" }}
                                  title={order.fiscalInfo?.semCancelamentoPorque === "saiu"
                                    ? "A mercadoria já saiu: a nota não cancela mais. Registre aqui a devolução/estorno que o contador fez para liberar o pedido."
                                    : "Passaram os 30 minutos: a nota não cancela mais. Registre aqui a devolução/estorno que o contador fez para liberar o pedido."}
                                >
                                  ↩ Registrar devolução
                                </button>
                              ) : null}
                            </div>
                          ) : isNotaCancelada && !isPedidoCancelado ? (
                            // A nota foi cancelada (emitida errado, por exemplo) e o
                            // pedido continua valendo: sai uma nota NOVA, com número e
                            // ref novos; a cancelada fica guardada para o contador.
                            <button
                              onClick={() => { setSelectedOrderForEmit(order); setEmitCpfInput(order.customerCpfCnpj || ""); }}
                              title={`Nota ${order.fiscalInfo?.nfceNumber ? `nº ${order.fiscalInfo.nfceNumber} ` : ""}cancelada. Emitir uma nova NFC-e para este pedido.`}
                              style={{ background: "#fff", border: "1px solid #94A3B8", color: "#334155", borderRadius: 6, padding: "4px 8px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              {daMesa ? "Emitir nova nota da conta" : "Emitir nova nota"}
                            </button>
                          ) : isNotaCancelada ? (
                            <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>—</span>
                          ) : isPedidoCancelado ? (
                            <span title="Pedido cancelado: não se emite nota de venda que não aconteceu." style={{ fontSize: "0.72rem", color: "#94A3B8" }}>
                              Sem emissão
                            </span>
                          ) : isProcessing ? (
                            <button
                              onClick={() => handleConsultarSituacao(order)}
                              title="A SEFAZ recebeu a nota e ainda não respondeu. Consulte em vez de reemitir."
                              style={{ background: "#FFF7E6", border: "1px solid #B45309", color: "#B45309", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Consultar situação
                            </button>
                          ) : (
                            // Rodada de mesa: o botão emite a nota da CONTA inteira
                            // (api/store/fiscal/emitir → emitirNfceDaMesa manual). Com a
                            // conta aberta não há nota a emitir ainda.
                            <button
                              onClick={() => { setSelectedOrderForEmit(order); setEmitCpfInput(order.customerCpfCnpj || ""); }}
                              disabled={daMesa && order.mesa ? !order.mesa.contaFechada : false}
                              title={daMesa ? (order.mesa && !order.mesa.contaFechada ? "A conta desta mesa ainda está aberta: feche em Mesas para emitir a nota da conta." : "Emite UMA nota para a conta inteira da mesa (todas as rodadas).") : undefined}
                              style={{ background: "#FAF6F2", border: "1px solid #1C1917", color: "#1C1917", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", fontWeight: 700, cursor: daMesa && order.mesa && !order.mesa.contaFechada ? "not-allowed" : "pointer", opacity: daMesa && order.mesa && !order.mesa.contaFechada ? 0.5 : 1 }}
                            >
                              {daMesa ? "Emitir nota da conta" : "Emitir"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── NAV 4: INUTILIZAÇÕES DE NUMERAÇÃO ── */}
        {activeNav === "inutilizacao" && (
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.5rem", maxWidth: 600 }}>
            <h1 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
              Inutilização de Numeração Fiscal
            </h1>
            <p style={{ margin: "0 0 1.25rem", fontSize: "0.82rem", color: "#64748B" }}>
              Solicite à SEFAZ a inutilização de uma faixa de números de NFC-e que não foram utilizados devido a falhas técnicas ou saltos de numeração.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Série da Nota *</label>
                <input value={inutilSerie} onChange={e => setInutilSerie(e.target.value)} style={{ width: 120, padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Número Inicial *</label>
                  <input type="number" value={inutilNumIni} onChange={e => setInutilNumIni(e.target.value)} placeholder="Ex: 100" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Número Final *</label>
                  <input type="number" value={inutilNumFin} onChange={e => setInutilNumFin(e.target.value)} placeholder="Ex: 105" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Justificativa (Mínimo 15 caracteres) *</label>
                <textarea rows={3} value={inutilJustif} onChange={e => setInutilJustif(e.target.value)} placeholder="Ex: Falha de conexão durante emissão no PDV gerando salto de sequência." style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
              </div>

              <button onClick={handleInutilizar} disabled={inutilizing} style={{ padding: "10px 18px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
                {inutilizing ? "Inutilizando na SEFAZ..." : "Confirmar Inutilização"}
              </button>
            </div>
          </div>
        )}

        {/* ── NAV 5: CONTADOR ── */}
        {activeNav === "contador" && (
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1E293B", margin: "0 0 4px" }}>Contador</h1>
            <p style={{ color: "#64748B", fontSize: "0.88rem", margin: "0 0 1.25rem" }}>
              Baixe o pacote fiscal do período ou deixe ele ir sozinho para o seu contador todo mês.
            </p>
            <AvisoDeHomologacao />

            {/* O QUE VAI NO PACOTE — explicado antes de o lojista clicar */}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <FileArchive size={17} color="#1C1917" />
                <strong style={{ fontSize: "0.92rem", color: "#334155" }}>O que vai dentro do pacote</strong>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: "0.84rem", color: "#475569", lineHeight: 1.5 }}>
                <div><strong>xml/</strong> — um arquivo XML por nota autorizada, nomeado pela chave de acesso. É o que o contador lança na escrituração; o resto é conferência.</div>
                <div><strong>relacao-de-notas.csv</strong> — uma linha por nota (número, série, chave, protocolo, valor, forma de pagamento). Abre no Excel com duplo clique.</div>
                <div><strong>vendas-sem-nota.csv</strong> — os pedidos do período que <strong>não</strong> tiveram nota, com o motivo. É a diferença entre o que a loja vendeu e o que ela declarou — o arquivo que ninguém pede e todo mundo precisa.</div>
              </div>
              <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
                Notas emitidas em <strong>homologação</strong> (teste) ficam de fora do pacote. Elas não valem
                fiscalmente, e mandá-las junto é o jeito mais rápido de alguém lançar um documento de teste
                na contabilidade da empresa.
              </div>
            </div>

            {/* BAIXAR AGORA */}
            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.25rem", marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "1rem", fontWeight: 800, color: "#334155" }}>Baixar ou enviar um período</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>De</label>
                  <input type="date" value={periodoContador.de} onChange={e => setPeriodoContador(p => ({ ...p, de: e.target.value }))}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "inherit" }} />
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Até</label>
                  <input type="date" value={periodoContador.ate} onChange={e => setPeriodoContador(p => ({ ...p, ate: e.target.value }))}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "inherit" }} />
                </div>
                <a
                  href={`/api/store/fiscal/contador/exportar?de=${periodoContador.de}&ate=${periodoContador.ate}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "1px solid #1C1917", background: "#FAF6F2", color: "#1C1917", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none" }}
                >
                  <Download size={15} /> Baixar pacote (.zip)
                </a>
                <button
                  onClick={async () => {
                    if (!contador.email) { alert("Cadastre o e-mail do contador abaixo antes de enviar."); return; }
                    if (!confirm(`Enviar o pacote de ${periodoContador.de.split("-").reverse().join("/")} a ${periodoContador.ate.split("-").reverse().join("/")} para ${contador.email}?`)) return;
                    setEnviandoContador(true);
                    try {
                      const r = await fetch("/api/store/fiscal/contador/enviar", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(periodoContador),
                      });
                      const d = await r.json();
                      alert(d.ok ? `✅ ${d.mensagem}` : `❌ ${d.mensagem || d.error}`);
                      if (d.ok) setContador((c: any) => ({ ...c, ultimoEnvioEm: new Date().toISOString(), ultimoEnvioResultado: d.mensagem }));
                    } catch { alert("Falha ao enviar."); }
                    finally { setEnviandoContador(false); }
                  }}
                  disabled={enviandoContador}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: "#1C1917", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", opacity: enviandoContador ? 0.6 : 1 }}
                >
                  <Send size={15} /> {enviandoContador ? "Enviando..." : "Enviar agora por e-mail"}
                </button>
              </div>
              <p style={{ margin: "10px 0 0", fontSize: "0.76rem", color: "#94A3B8" }}>
                O download pode demorar num mês cheio: cada XML é buscado no provedor, um por um.
              </p>
            </div>

            {/* ENVIO AUTOMÁTICO */}
            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Mail size={17} color="#1C1917" />
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#334155" }}>Envio automático todo mês</h3>
              </div>
              <p style={{ margin: "0 0 14px", fontSize: "0.83rem", color: "#64748B" }}>
                Cadastre o e-mail do contador e escolha o dia. O pacote sai sozinho, sem você lembrar.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, maxWidth: 560 }}>
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>E-mail do contador</label>
                  <input
                    type="email"
                    value={contador.email || ""}
                    onChange={e => setContador((c: any) => ({ ...c, email: e.target.value }))}
                    placeholder="contabilidade@escritorio.com.br"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.88rem", fontFamily: "inherit", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>Quando enviar</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { k: "DIA_1", rotulo: "Todo dia 1º", ajuda: "Manda o mês anterior inteiro, já fechado." },
                      { k: "ULTIMO_DIA", rotulo: "No último dia do mês", ajuda: "Manda o mês corrente até o último dia — serve para 28, 30 ou 31." },
                      { k: "DIA_FIXO", rotulo: "Num dia fixo", ajuda: "Manda o mês anterior fechado, no dia que você escolher." },
                      { k: "DATA_CERTA", rotulo: "Numa data marcada", ajuda: "Uma vez, na data escolhida." },
                    ].map(op => (
                      <button
                        key={op.k}
                        onClick={() => setContador((c: any) => ({ ...c, quando: op.k }))}
                        title={op.ajuda}
                        style={{
                          padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                          border: `1.5px solid ${contador.quando === op.k ? "#1C1917" : "#E2E8F0"}`,
                          background: contador.quando === op.k ? "#1C1917" : "#fff",
                          color: contador.quando === op.k ? "#fff" : "#475569",
                          fontWeight: 700, fontSize: "0.8rem",
                        }}
                      >
                        {op.rotulo}
                      </button>
                    ))}
                  </div>
                  {/* A explicação da opção escolhida fica embaixo, sempre visível.
                      Tooltip só aparece para quem passa o mouse e sabe que existe. */}
                  <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#1C1917", background: "#FAF6F2", borderRadius: 8, padding: "7px 10px" }}>
                    {contador.quando === "DIA_1" && "Todo dia 1º sai o mês anterior inteiro, já fechado. É o que a maioria dos contadores pede."}
                    {contador.quando === "ULTIMO_DIA" && "Sai no último dia do mês, com o mês corrente até ali. O sistema entende sozinho se o mês tem 28, 29, 30 ou 31 dias."}
                    {contador.quando === "DIA_FIXO" && "Sai no dia que você escolher, com o mês anterior fechado. Vai até 28, porque dia 29, 30 e 31 não existem em todo mês — e o envio sumiria justo em fevereiro."}
                    {contador.quando === "DATA_CERTA" && "Sai uma vez, na data marcada."}
                  </p>
                </div>

                {contador.quando === "DIA_FIXO" && (
                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Dia do mês (1 a 28)</label>
                    <input type="number" min={1} max={28} value={contador.dia}
                      onChange={e => setContador((c: any) => ({ ...c, dia: Math.min(28, Math.max(1, Number(e.target.value) || 1)) }))}
                      style={{ width: 110, padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.88rem", fontFamily: "inherit" }} />
                  </div>
                )}

                {contador.quando === "DATA_CERTA" && (
                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Data do envio</label>
                    <input type="date" value={contador.data || ""}
                      onChange={e => setContador((c: any) => ({ ...c, data: e.target.value }))}
                      style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.88rem", fontFamily: "inherit" }} />
                  </div>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "#334155", cursor: "pointer" }}>
                  <input type="checkbox" checked={contador.copiaParaLoja}
                    onChange={e => setContador((c: any) => ({ ...c, copiaParaLoja: e.target.checked }))}
                    style={{ width: 16, height: 16, cursor: "pointer" }} />
                  Mandar uma cópia para o e-mail da loja (para você conferir que chegou)
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem", fontWeight: 700, color: contador.automatico ? "#0F766E" : "#64748B", cursor: "pointer", background: contador.automatico ? "#F0FDFA" : "#F8FAFC", border: `1px solid ${contador.automatico ? "#99F6E4" : "#E2E8F0"}`, borderRadius: 10, padding: "10px 12px" }}>
                  <input type="checkbox" checked={contador.automatico}
                    onChange={e => setContador((c: any) => ({ ...c, automatico: e.target.checked }))}
                    style={{ width: 17, height: 17, cursor: "pointer" }} />
                  {contador.automatico ? "Envio automático LIGADO" : "Envio automático desligado"}
                </label>

                <div>
                  <button
                    onClick={async () => {
                      setSalvandoContador(true);
                      try {
                        const r = await fetch("/api/store/fiscal/contador", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(contador),
                        });
                        const d = await r.json();
                        if (r.ok) { setContador(d.contador); alert("✅ Salvo."); }
                        else alert(`❌ ${d.mensagem || d.error}`);
                      } catch { alert("Falha ao salvar."); }
                      finally { setSalvandoContador(false); }
                    }}
                    disabled={salvandoContador}
                    style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#1C1917", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", opacity: salvandoContador ? 0.6 : 1 }}
                  >
                    {salvandoContador ? "Salvando..." : "Salvar"}
                  </button>
                </div>

                {contador.ultimoEnvioEm && (
                  <div style={{ fontSize: "0.8rem", color: "#64748B", background: "#F8FAFC", borderRadius: 8, padding: "9px 12px" }}>
                    <strong>Último envio:</strong>{" "}
                    {new Date(contador.ultimoEnvioEm).toLocaleString("pt-BR")} — {contador.ultimoEnvioResultado}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL 1: EMISSÃO FISCAL INDIVIDUAL (CARDÁPIO WEB SCREENSHOT 4) ── */}
      {selectedOrderForEmit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderForEmit(null)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>Emissão fiscal</h2>
              <button onClick={() => setSelectedOrderForEmit(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <div style={{ padding: "1.25rem" }}>
              {/* O aviso de teste vem ANTES do botão, não depois da emissão.
                  O único lugar onde o ambiente aparecia era um alert exibido
                  uma vez, já com a nota emitida. */}
              {emHomologacao && (
                <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderLeft: "6px solid #B45309", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#92400E", lineHeight: 1.45 }}>
                  <strong>Modo TESTE (homologação).</strong> Esta nota vai para o ambiente de teste
                  da SEFAZ: ela <strong>não tem valor fiscal</strong> e não serve para o cliente nem
                  para o contador. Para emitir de verdade, mude o ambiente em Configuração.
                </div>
              )}

              {/* A conta da mesa: o que este botão emite de verdade. */}
              {selectedOrderForEmit.tableSessionId && (
                <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", borderLeft: "6px solid #0F766E", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#134E4A", lineHeight: 1.45 }}>
                  <strong>Pedido de mesa — a nota é da CONTA inteira.</strong> Sai uma NFC-e só para a mesa, com todas as
                  rodadas, o desconto da conta e as formas em que a mesa pagou. Não existe nota só deste pedido: ela
                  repetiria os itens na nota da conta. Se algum pedido da mesa já tiver nota própria (antiga), sai a nota
                  do restante.
                  {selectedOrderForEmit.mesa && !selectedOrderForEmit.mesa.contaFechada && (
                    <strong style={{ display: "block", marginTop: 6, color: "#B45309" }}>A conta ainda está aberta: feche em Mesas antes de emitir.</strong>
                  )}
                </div>
              )}
              {selectedOrderForEmit.fiscalStatus === "CANCELED" && (
                <div style={{ background: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#334155", lineHeight: 1.45 }}>
                  <strong>Nova nota.</strong> A nota anterior{selectedOrderForEmit.fiscalInfo?.nfceNumber ? ` (nº ${selectedOrderForEmit.fiscalInfo.nfceNumber})` : ""} foi
                  cancelada. Esta emissão gera uma NFC-e nova, com número novo; a cancelada continua registrada e vai no pacote do contador.
                </div>
              )}

              {/* Alert 1: Azul */}
              <div style={{ background: "#FAF6F2", border: "1px solid #E7DDD3", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#1C1917", lineHeight: 1.4 }}>
                Pedido com NFC-e autorizada fica travado para editar e cancelar. A nota só cancela enquanto a mercadoria não saiu e em até 30 minutos da autorização; depois disso a devolução é com o contador — e você registra aqui para liberar o pedido.
              </div>

              {/* Alert 2: Laranja */}
              <div style={{ background: "#FFF4EF", border: "1px solid #FFD3C2", borderRadius: 10, padding: "12px", marginBottom: 16, fontSize: "0.82rem", color: "#9A3412", lineHeight: 1.4 }}>
                Pedido de <strong>delivery</strong> sai na nota como <strong>entrega a domicílio</strong>; retirada, balcão, mesa e totem saem como <strong>operação presencial</strong>. Informar o CPF do cliente é opcional, mas é o que permite a ele usar a nota depois.
              </div>

              <p style={{ fontSize: "0.9rem", color: "#1E293B", margin: "0 0 16px", lineHeight: 1.5 }}>
                {selectedOrderForEmit.tableSessionId
                  ? <>Emissão da <strong>NFC-e da conta da mesa</strong>{selectedOrderForEmit.mesa?.numero != null ? <> <strong>{selectedOrderForEmit.mesa.nome || `Mesa ${selectedOrderForEmit.mesa.numero}`}</strong></> : null}, que inclui o pedido <strong>{selectedOrderForEmit.dailyOrderNumber}</strong> ({fmt(selectedOrderForEmit.totalAmount)} nesta rodada), feito no dia</>
                  : <>Emissão da <strong>NFC-e</strong> do pedido <strong>{selectedOrderForEmit.dailyOrderNumber}</strong> no valor de <strong>{fmt(selectedOrderForEmit.totalAmount)}</strong> feito no dia</>} <strong>{new Date(selectedOrderForEmit.createdAt).toLocaleDateString("pt-BR")} às {new Date(selectedOrderForEmit.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
              </p>

              {/* CPF / CNPJ Input (Roxo) */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1C1917", display: "block", marginBottom: 4 }}>CPF/CNPJ na nota</label>
                <input
                  value={emitCpfInput}
                  onChange={e => setEmitCpfInput(e.target.value)}
                  placeholder="Deixe em branco caso não queira informar"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #1C1917", fontSize: "0.88rem", outline: "none" }}
                />
              </div>

              {/* Footer Buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => handleEmitSingle(true)} disabled={emitting} style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid #1C1917", background: "#fff", color: "#1C1917", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  EMITIR E IMPRIMIR
                </button>
                <button onClick={() => handleEmitSingle(false)} disabled={emitting} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#1C1917", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  {emitting ? "EMITINDO..." : "EMITIR"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: EMISSÃO EM LOTE (SCREENSHOT 5 RED ARROW) ── */}
      {showBatchEmitModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowBatchEmitModal(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 540, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>Emissão em lote de notas fiscais</h2>
              <button onClick={() => setShowBatchEmitModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <div style={{ padding: "1.25rem" }}>
              <p style={{ fontSize: "0.85rem", color: "#475569", margin: "0 0 12px" }}>
                Selecione os pedidos abaixo para emitir todas as NFC-e simultaneamente junto à SEFAZ:
              </p>

              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 10, padding: 8, marginBottom: 16 }}>
                {orders.filter(o => o.fiscalStatus !== "EMITTED").map(order => {
                  const checked = selectedBatchOrderIds.includes(order.id);
                  return (
                    <label key={order.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 6, background: checked ? "#FAF6F2" : "#fff", cursor: "pointer", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedBatchOrderIds(prev => checked ? prev.filter(id => id !== order.id) : [...prev, order.id])} style={{ accentColor: "#1C1917", width: 16, height: 16 }} />
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                          Pedido #{order.dailyOrderNumber} — {order.customerName}
                          {order.tableSessionId && <span style={{ fontWeight: 600, color: "#0F766E" }}> (mesa: sai a nota da conta)</span>}
                        </span>
                      </div>
                      <strong style={{ fontSize: "0.85rem", color: "#0F766E" }}>{fmt(order.totalAmount)}</strong>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>{selectedBatchOrderIds.length} pedidos selecionados</span>
                <button onClick={handleBatchEmit} disabled={batchEmitting || selectedBatchOrderIds.length === 0} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#1C1917", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  {batchEmitting ? "EMITINDO EM LOTE..." : `EMITIR ${selectedBatchOrderIds.length} NOTAS`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: ESPELHO DANFE NFC-E COMPLETO ── */}
      {selectedOrderForDanfe && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderForDanfe(null)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 70px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderBottom: "2px solid #0F172A", paddingBottom: 8 }}>
              <div>
                <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748B" }}>DOCUMENTO AUXILIAR DA NFC-E</span>
                {/* Sem número inventado: "15493" fixo aparecia como fallback
                    e virava "número da nota" aos olhos do lojista. */}
                <h2 style={{ margin: "2px 0 0", fontSize: "1.1rem", fontWeight: 900 }}>DANFE NFC-e nº {selectedOrderForDanfe.fiscalInfo?.nfceNumber ?? "—"}</h2>
              </div>
              <button onClick={() => setSelectedOrderForDanfe(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            {/* O espelho mostra chave de acesso e protocolo — as duas coisas
                que fazem uma nota "parecer real". Se ela saiu do ambiente de
                teste, isso precisa estar escrito antes deles, não depois. */}
            {Number(selectedOrderForDanfe.fiscalInfo?.ambiente) === 2 && (
              <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderLeft: "6px solid #B45309", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <strong style={{ fontSize: "0.85rem", color: "#92400E" }}>⚠️ NOTA DE TESTE — SEM VALOR FISCAL</strong>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#78350F", lineHeight: 1.45 }}>
                  Emitida no ambiente de <strong>homologação</strong> da SEFAZ. A chave e o protocolo
                  abaixo são reais nesse ambiente de teste, mas o documento não vale para o cliente,
                  para o contador nem para o Fisco.
                </p>
              </div>
            )}

            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px", marginBottom: 12, fontSize: "0.8rem" }}>
              <p style={{ margin: "0 0 4px" }}><strong>Emitente:</strong> {storeName} (CNPJ: {fiscalConfig.cnpj || cpfCnpj})</p>
              <p style={{ margin: "0 0 4px" }}><strong>Chave de Acesso:</strong> <code style={{ fontSize: "0.7rem" }}>{selectedOrderForDanfe.fiscalInfo?.nfceKey}</code></p>
              <p style={{ margin: 0 }}><strong>Protocolo:</strong> {selectedOrderForDanfe.fiscalInfo?.protocol}</p>
            </div>

            <h4 style={{ margin: "0 0 6px", fontSize: "0.85rem", fontWeight: 800 }}>Itens do Documento Fiscal</h4>
            <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: 10, marginBottom: 14, fontSize: "0.8rem" }}>
              {(selectedOrderForDanfe.fiscalInfo?.items || []).map((it: any, idx: number) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span>{it.quantity}x {it.name}</span>
                  <strong>{fmt(it.totalPrice)}</strong>
                </div>
              ))}
            </div>

            {/* Este espelho NÃO é o DANFE: é uma conferência montada pela tela,
                com cara de nota (chave, protocolo, itens). O que se entrega ao
                cliente é o DANFCe oficial da Focus (botão 🧾 DANFE da lista).
                Papel impresso com cara de nota e sem ser nota tem de dizer que
                não é documento fiscal — e o botão dizia "Imprimir DANFE". */}
            <p style={{ margin: "0 0 12px", padding: "8px 10px", border: "2px solid #0F172A", borderRadius: 8, fontSize: "0.8rem", fontWeight: 900, textAlign: "center", letterSpacing: "0.3px" }}>
              ESPELHO PARA CONFERÊNCIA — NÃO É DOCUMENTO FISCAL
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => window.open(`/api/store/fiscal/danfe?orderId=${selectedOrderForDanfe.id}`, "_blank")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                🧾 Abrir o DANFE oficial
              </button>
              <button onClick={() => window.print()} style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid #0F172A", background: "#fff", color: "#0F172A", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                🖨️ Imprimir espelho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 4: EDITAR DADOS TRIBUTÁRIOS DO PRODUTO (NCM, CEST, CFOP, CSOSN) ── */}
      {editingProduct && (() => {
        const sugestao = sugestaoPorProduto.get(editingProduct.id);
        const usarOpcao = (i: number) => {
          const o = sugestao?.opcoes[i];
          if (!o || !sugestao) return;
          setEditingProduct({
            ...editingProduct,
            ncm: ncmComPontos(o.ncm),
            cest: o.cest ? cestComPontos(o.cest) : "",
            ...(sugestao.cfop ? { cfop: sugestao.cfop } : {}),
            ...(sugestao.csosn ? { csosn: sugestao.csosn } : {}),
          });
        };
        return (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setEditingProduct(null)}
          onKeyDown={e => { if (e.key === "Escape") setEditingProduct(null); }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="produto-tributacao-titulo" style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", padding: "1.25rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid #E2E8F0", paddingBottom: 8 }}>
              <h2 id="produto-tributacao-titulo" style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#1E293B" }}>Tributação do Produto</h2>
              <button type="button" aria-label="Fechar" onClick={() => setEditingProduct(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <p style={{ margin: "0 0 14px", fontSize: "0.85rem", fontWeight: 700, color: "#1C1917" }}>
              {editingProduct.name} ({editingProduct.category}) — {fmt(editingProduct.price)}
            </p>

            {/* A sugestão do NCM assistido para ESTE produto, com a fonte:
                "Usar" só preenche o formulário — grava no "Salvar Tributação". */}
            {sugestao && sugestao.opcoes.length > 0 && (
              <div style={{ margin: "0 0 14px", padding: "10px 12px", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 10, fontSize: "0.78rem", color: "#78350F", lineHeight: 1.5 }}>
                <strong>Sugestão (NCM assistido): {sugestao.rotulo}</strong>
                {sugestao.pergunta && <span style={{ display: "block", marginTop: 2 }}>{sugestao.pergunta.texto}</span>}
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {sugestao.opcoes.map((o, i) => (
                    <button
                      key={o.chave}
                      type="button"
                      onClick={() => usarOpcao(i)}
                      style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #B45309", background: "#fff", color: "#78350F", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", textAlign: "left" }}
                    >
                      {sugestao.opcoes.length > 1 ? `${o.rotulo}: ` : "Usar "}NCM {ncmComPontos(o.ncm)}{o.cest ? ` · CEST ${cestComPontos(o.cest)}` : ""}
                    </button>
                  ))}
                </span>
                <span style={{ display: "block", marginTop: 6 }}>
                  CFOP {sugestao.cfop ?? "—"} · CSOSN {sugestao.csosn ?? "CST (com o contador)"} · confiança {sugestao.confianca}
                </span>
                {sugestao.avisos.slice(0, 3).map(a => <span key={a} style={{ display: "block", marginTop: 4 }}>{a}</span>)}
                <span style={{ display: "block", marginTop: 4, color: "#92400E" }}>Revise com o contador antes de emitir em produção.</span>
              </div>
            )}

            <div className="fiscal-grade-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label htmlFor="produto-ncm" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>NCM *</label>
                <input id="produto-ncm" value={editingProduct.ncm || ""} onChange={e => setEditingProduct({ ...editingProduct, ncm: e.target.value })} placeholder="8 dígitos, ex.: 1905.90.90" inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
              <div>
                <label htmlFor="produto-cest" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CEST</label>
                <input id="produto-cest" value={editingProduct.cest || ""} onChange={e => setEditingProduct({ ...editingProduct, cest: e.target.value })} placeholder="7 dígitos (vazio se não se aplica)" inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
              <div>
                <label htmlFor="produto-cfop" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CFOP *</label>
                <input id="produto-cfop" value={editingProduct.cfop || "5102"} onChange={e => setEditingProduct({ ...editingProduct, cfop: e.target.value })} inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
              <div>
                <label htmlFor="produto-csosn" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CSOSN / CST *</label>
                <input id="produto-csosn" value={editingProduct.csosn || "102"} onChange={e => setEditingProduct({ ...editingProduct, csosn: e.target.value })} inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
              <div>
                <label htmlFor="produto-pis" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST PIS</label>
                <input id="produto-pis" value={editingProduct.pis || "49"} onChange={e => setEditingProduct({ ...editingProduct, pis: e.target.value })} inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
              <div>
                <label htmlFor="produto-cofins" style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST COFINS</label>
                <input id="produto-cofins" value={editingProduct.cofins || "49"} onChange={e => setEditingProduct({ ...editingProduct, cofins: e.target.value })} inputMode="numeric" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2, boxSizing: "border-box" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setEditingProduct(null)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button type="button" onClick={handleSaveProductTax} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#1C1917", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Salvar Tributação</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── MODAL 5: ENGENHARIA FISCAL DO COMBO ── */}
      {editingCombo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setEditingCombo(null); setComboDetails(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", padding: "1.5rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "2px solid #1C1917", paddingBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>🔧 Engenharia Fiscal do Combo</h2>
                <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#64748B" }}>Configure como cada item sai na nota fiscal</p>
              </div>
              <button onClick={() => { setEditingCombo(null); setComboDetails(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
            </div>

            {/* Combo info */}
            <div style={{ background: "#FAF6F2", border: "1px solid #E7DDD3", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1C1917" }}>{editingCombo.name}</div>
                <div style={{ fontSize: "0.78rem", color: "#1C1917" }}>Preço do combo para o cliente</div>
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F766E" }}>{fmt(editingCombo.price)}</div>
            </div>

            {/* Groups from comboDetails */}
            {comboDetails?.comboGroups?.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#334155" }}>📦 Grupos do Combo</h3>
                  <button
                    onClick={() => {
                      // ── RATEIO DO PREÇO DO COMBO ENTRE AS ESCOLHAS ──────────
                      // A conta era `preço do combo / group.maxQty` aplicada a
                      // CADA opção do grupo. Num combo de R$ 100 com um grupo de
                      // 2 escolhas e 5 opções, mais um grupo de 1 escolha e 3
                      // opções, saíam 8 linhas somando 5×50 + 3×100 = R$ 550 —
                      // cinco vezes e meia o que o cliente paga.
                      //
                      // O certo é dividir o preço pelo total de escolhas que o
                      // combo exige, não por grupo. Cada opção é ALTERNATIVA
                      // dentro do grupo, não item somado: as opções de um grupo
                      // de 2 escolhas valem o mesmo, e são duas que entram.
                      const escolhasExigidas = comboDetails.comboGroups.reduce(
                        (soma: number, g: any) => soma + Math.max(1, Number(g.maxQty) || 1),
                        0
                      );
                      const porEscolha =
                        escolhasExigidas > 0 ? editingCombo.price / escolhasExigidas : editingCombo.price;

                      const items: any[] = [];
                      for (const group of comboDetails.comboGroups) {
                        for (const gi of group.items) {
                          const addPrice = gi.additionalPrice || 0;
                          // O valor digitado pelo lojista manda; sem ele, o
                          // rateio automático.
                          const digitado = precoFiscalPorItem[gi.id];
                          items.push({
                            name: gi.menuProduct?.name || gi.name || "Item",
                            price: parseFloat(
                              (Number.isFinite(digitado) ? digitado : porEscolha + addPrice).toFixed(2)
                            ),
                            basePrice: parseFloat(porEscolha.toFixed(2)),
                            additionalPrice: addPrice,
                            category: gi.menuProduct?.category || editingCombo.category || "Lanches",
                            // Sem NCM de mentira: se o componente não tem o dele,
                            // o campo fica vazio e a linha aparece pendente. O
                            // "2106.90.90" que ficava aqui fazia o combo inteiro
                            // parecer classificado sem ninguém ter classificado.
                            ncm: gi.menuProduct?.ncm || editingCombo.ncm || "",
                            cfop: editingCombo.cfop || "5102",
                            csosn: editingCombo.csosn || "102",
                            groupTitle: group.title,
                            groupMaxQty: group.maxQty,
                          });
                        }
                      }
                      setFiscalItemsDraft(items);
                    }}
                    style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #1C1917", background: "#FAF6F2", color: "#1C1917", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <Sparkles size={13} /> Auto-preencher itens fiscais
                  </button>
                </div>

                {comboDetails.comboGroups.map((group: any) => {
                  // Mesmo rateio do botão de auto-preencher: pelo total de
                  // escolhas do combo, não por grupo. Se a etiqueta mostrasse
                  // uma conta e o botão gravasse outra, o lojista não teria
                  // como saber qual das duas é a que vale.
                  const escolhasExigidas = comboDetails.comboGroups.reduce(
                    (soma: number, g: any) => soma + Math.max(1, Number(g.maxQty) || 1),
                    0
                  );
                  const basePrice =
                    escolhasExigidas > 0 ? editingCombo.price / escolhasExigidas : editingCombo.price;
                  return (
                    <div key={group.id} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#334155" }}>{group.title}</span>
                        <span style={{ fontSize: "0.72rem", color: "#64748B", background: "#E2E8F0", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>Qtd: {group.maxQty} · Base: {fmt(basePrice)}/un</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {group.items.map((gi: any) => {
                          const addPrice = gi.additionalPrice || 0;
                          const sugerido = Number((basePrice + addPrice).toFixed(2));
                          const digitado = precoFiscalPorItem[gi.id];
                          const foiAlterado = Number.isFinite(digitado);
                          const fiscalPrice = foiAlterado ? digitado : sugerido;
                          return (
                            <div key={gi.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 8px", background: "#fff", borderRadius: 6, fontSize: "0.82rem" }}>
                              <span style={{ color: "#334155", flex: 1, minWidth: 0 }}>{gi.menuProduct?.name || "Item"}</span>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {addPrice > 0 && <span style={{ color: "#E8590C", fontWeight: 600, fontSize: "0.72rem" }}>+{fmt(addPrice)}</span>}
                                {/* Editável: era texto fixo com o rateio igual,
                                    e rateio igual quase nunca é o que interessa
                                    — o refrigerante e o lanche têm tributação
                                    diferente, que é o motivo desta tela existir. */}
                                <span style={{ color: "#64748B", fontSize: "0.75rem" }}>R$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={fiscalPrice}
                                  onChange={(e) => {
                                    const v = Number.isFinite(parseFloat(e.target.value)) ? parseFloat(e.target.value) : 0;
                                    setPrecoFiscalPorItem((prev) => ({ ...prev, [gi.id]: v }));
                                    // Reflete na lista "Itens na Nota Fiscal" na
                                    // hora. Sem isto o lojista digitaria aqui,
                                    // salvaria, e o valor antigo iria para a
                                    // nota — só mudaria depois de ele descobrir
                                    // que precisava clicar em "Auto-preencher".
                                    const nome = gi.menuProduct?.name || gi.name || "Item";
                                    setFiscalItemsDraft((atual) => {
                                      const i = atual.findIndex((it: any) => it.name === nome);
                                      if (i < 0) return atual;
                                      const copia = [...atual];
                                      copia[i] = { ...copia[i], price: v };
                                      return copia;
                                    });
                                  }}
                                  title="Quanto deste combo é este item, para efeito de nota fiscal"
                                  style={{
                                    width: 78, padding: "3px 6px", borderRadius: 6, textAlign: "right",
                                    border: `1.5px solid ${foiAlterado ? "#1C1917" : "#CBD5E1"}`,
                                    background: foiAlterado ? "#FAF6F2" : "#fff",
                                    fontWeight: 800, color: foiAlterado ? "#1C1917" : "#0F766E",
                                    fontSize: "0.8rem", fontFamily: "inherit",
                                  }}
                                />
                                {foiAlterado && (
                                  <button
                                    onClick={() => setPrecoFiscalPorItem((prev) => {
                                      const copia = { ...prev };
                                      delete copia[gi.id];
                                      return copia;
                                    })}
                                    title={`Voltar ao rateio automático (${fmt(sugerido)})`}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
                                  >
                                    ↺
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {/* Explicação no lugar onde a dúvida nasce: o lojista
                            olha a soma, vê que não bate com o preço do combo e
                            acha que fez algo errado. Não fez — o que a nota usa
                            é a PROPORÇÃO entre os itens. */}
                        <div style={{ marginTop: 4, fontSize: "0.7rem", color: "#64748B", lineHeight: 1.4 }}>
                          Estes valores dizem <strong>quanto de cada item</strong> a nota vai considerar.
                          Se a soma não fechar com {fmt(editingCombo.price)}, tudo bem: o que vale é a
                          proporção entre eles — a nota sempre sai com o total que o cliente pagou.
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 10, padding: "1.5rem", textAlign: "center", marginBottom: 16, color: "#64748B", fontSize: "0.85rem" }}>
                <RefreshCw size={20} style={{ margin: "0 auto 8px", animation: comboDetails === null ? "spin 1s linear infinite" : "none" }} />
                {comboDetails === null ? "Carregando grupos do combo..." : "Nenhum grupo encontrado. Cadastre os itens do combo no cardápio primeiro."}
              </div>
            )}

            {/* ── Itens fiscais configurados ── */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#334155" }}>📋 Itens na Nota Fiscal</h3>
                <button
                  onClick={() => setFiscalItemsDraft([...fiscalItemsDraft, { name: "", price: 0, category: editingCombo.category || "Lanches", ncm: editingCombo.ncm || "", cfop: "5102", csosn: "102" }])}
                  style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Plus size={12} /> Adicionar item
                </button>
              </div>

              {fiscalItemsDraft.length === 0 ? (
                <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 10, padding: "1rem", textAlign: "center", fontSize: "0.82rem", color: "#92400E" }}>
                  ⚠️ Nenhum item fiscal configurado. Clique em "Auto-preencher" acima para gerar automaticamente a partir dos grupos do combo.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {fiscalItemsDraft.map((item: any, idx: number) => (
                    <div key={idx} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 600 }}>
                          {item.groupTitle ? `${item.groupTitle}` : `Item ${idx + 1}`}
                        </span>
                        <button onClick={() => setFiscalItemsDraft(fiscalItemsDraft.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", cursor: "pointer", color: "#C92E09", padding: 2 }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 6 }}>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>Nome na NF</label>
                          <input
                            value={item.name}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              setFiscalItemsDraft(updated);
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>Preço NF (R$)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.price}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], price: parseFloat(e.target.value) || 0 };
                              setFiscalItemsDraft(updated);
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>NCM</label>
                          <input
                            value={item.ncm || ""}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], ncm: e.target.value };
                              setFiscalItemsDraft(updated);
                            }}
                            placeholder="2106.90.90"
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>Categoria</label>
                          <input
                            value={item.category || ""}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], category: e.target.value };
                              setFiscalItemsDraft(updated);
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>CFOP</label>
                          <input
                            value={item.cfop || "5102"}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], cfop: e.target.value };
                              setFiscalItemsDraft(updated);
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#475569" }}>CSOSN</label>
                          <input
                            value={item.csosn || "102"}
                            onChange={e => {
                              const updated = [...fiscalItemsDraft];
                              updated[idx] = { ...updated[idx], csosn: e.target.value };
                              setFiscalItemsDraft(updated);
                            }}
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.8rem", boxSizing: "border-box" }}
                          />
                        </div>
                      </div>
                      {item.additionalPrice > 0 && (
                        <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#E8590C", fontWeight: 600 }}>
                          ⚠️ Inclui acréscimo de {fmt(item.additionalPrice)} (base {fmt(item.basePrice || 0)} + extra {fmt(item.additionalPrice)})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Validação / Resumo ── */}
            {fiscalItemsDraft.length > 0 && (() => {
              // As linhas de um MESMO grupo são ALTERNATIVAS (o cliente escolhe
              // maxQty entre elas), não itens somados. A conta antiga somava
              // TODAS as opções e comparava com o preço do combo — combo de
              // R$ 100 com 5 opções acusava "R$ 500 ≠ R$ 100" em vermelho,
              // divergência falsa em praticamente todo combo real. A conta
              // certa é a MENOR seleção válida: por grupo, a opção mais barata
              // × quantidade de escolhas; linha avulsa (sem grupo) soma direto.
              const grupos = new Map<string, { menor: number; qtd: number }>();
              let avulsos = 0;
              fiscalItemsDraft.forEach((it: any, i: number) => {
                const preco = it.price || 0;
                if (it.groupTitle) {
                  const g = grupos.get(it.groupTitle);
                  const qtd = Math.max(1, Number(it.groupMaxQty) || 1);
                  if (!g || preco < g.menor) grupos.set(it.groupTitle, { menor: preco, qtd });
                } else {
                  avulsos += preco;
                }
              });
              const totalFiscal = Number(
                ([...grupos.values()].reduce((s, g) => s + g.menor * g.qtd, 0) + avulsos).toFixed(2)
              );
              const diff = totalFiscal - editingCombo.price;
              const isValid = Math.abs(diff) < 0.02; // tolerância de centavos
              return (
                <div style={{ background: isValid ? "#F0FDFA" : "#FEF2F2", border: `1px solid ${isValid ? "#99F6E4" : "#FECACA"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: isValid ? "#0F766E" : "#B71C1C" }}>
                      {isValid ? "✅ Valores batendo!" : "⚠️ Valores divergentes!"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: "0.82rem" }}>
                    <div>
                      <div style={{ color: "#64748B", fontSize: "0.72rem" }}>Preço combo (cliente)</div>
                      <div style={{ fontWeight: 800, color: "#334155" }}>{fmt(editingCombo.price)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748B", fontSize: "0.72rem" }}>Menor seleção possível ({fiscalItemsDraft.length} opções)</div>
                      <div style={{ fontWeight: 800, color: isValid ? "#0F766E" : "#C92E09" }}>{fmt(totalFiscal)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748B", fontSize: "0.72rem" }}>Diferença</div>
                      <div style={{ fontWeight: 800, color: isValid ? "#0F766E" : "#C92E09" }}>{diff > 0 ? "+" : ""}{fmt(diff)}</div>
                    </div>
                  </div>
                  {!isValid && (
                    <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#B71C1C", lineHeight: 1.4 }}>
                      ⚠️ <strong>Atenção:</strong> A soma dos itens fiscais está diferente do preço base do combo. Isso é normal quando o combo tem itens com acréscimo — o valor final na NF irá refletir a escolha real do cliente. Certifique-se que o preço base por item está correto.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setEditingCombo(null); setComboDetails(null); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              {fiscalItemsDraft.length > 0 && (
                <button onClick={() => { setFiscalItemsDraft([]); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#C92E09", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                  <Trash2 size={14} style={{ marginRight: 4 }} /> Limpar tudo
                </button>
              )}
              <button onClick={handleSaveComboFiscal} disabled={savingCombo || fiscalItemsDraft.length === 0} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: fiscalItemsDraft.length === 0 ? "#CBD5E1" : "#1C1917", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: fiscalItemsDraft.length === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {savingCombo ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Salvando...</> : <><CheckCircle2 size={14} /> Salvar engenharia fiscal</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 6: JUSTIFICATIVA DO CANCELAMENTO / DESCRIÇÃO DA DEVOLUÇÃO ──
          Era window.prompt + window.confirm. O `key` zera o texto quando o
          modal troca de nota ou passa do cancelamento para a devolução. */}
      {justificativaDaNota && (() => {
        const { tipo, order } = justificativaDaNota;
        const qual = `${order.fiscalInfo?.nfceNumber ? ` nº ${order.fiscalInfo.nfceNumber}` : ""} do pedido ${order.dailyOrderNumber ?? order.id.slice(-5)}`;
        const fechar = () => { setJustificativaDaNota(null); setErroDaJustificativa(null); };
        return tipo === "cancelar" ? (
          <ModalDeJustificativa
            key={`cancelar-${order.id}`}
            id="nota-cancelamento"
            titulo={`Cancelar a NFC-e${qual}`}
            rotulo="Justificativa do cancelamento"
            ajuda={`Mínimo ${JUSTIFICATIVA_DO_CANCELAMENTO.minimo} caracteres — exigência da SEFAZ (máximo ${JUSTIFICATIVA_DO_CANCELAMENTO.maximo}). Diga o motivo, por exemplo: "Pedido cancelado pelo cliente antes da saída".`}
            regra={JUSTIFICATIVA_DO_CANCELAMENTO}
            aviso={
              <>
                O cancelamento é <strong>definitivo</strong>: a nota é cancelada na SEFAZ e não volta. Só cabe enquanto a
                mercadoria não saiu e em até 30 minutos da autorização.
                {order.tableSessionId ? " É a nota da CONTA da mesa: todos os pedidos da conta ficam com a nota cancelada." : ""}
              </>
            }
            textoDoBotao="Cancelar a nota na SEFAZ"
            perigosa
            enviando={enviandoJustificativa}
            erro={erroDaJustificativa?.mensagem ?? null}
            outraAcao={erroDaJustificativa?.podeRegistrarDevolucao ? { texto: "↩ Registrar a devolução feita pelo contador", aoClicar: () => handleRegistrarDevolucao(order) } : null}
            aoConfirmar={(texto) => cancelarNota(order, texto)}
            aoFechar={fechar}
          />
        ) : (
          <ModalDeJustificativa
            key={`devolucao-${order.id}`}
            id="nota-devolucao"
            titulo={`Registrar a devolução da NFC-e${qual}`}
            rotulo="Devolução/ajuste feito pelo contador"
            ajuda={`Descreva (mínimo ${OBSERVACAO_DA_DEVOLUCAO.minimo} caracteres): o número da NF-e de devolução/estorno, a data e quem fez.`}
            regra={OBSERVACAO_DA_DEVOLUCAO}
            aviso={
              <>
                O registro libera o pedido para editar e cancelar no FireHub. Ele <strong>NÃO emite nada na SEFAZ</strong> e
                fica no histórico do pedido.
              </>
            }
            declaracao="Confirmo que o contador JÁ fez a devolução/estorno desta NFC-e."
            textoDoBotao="Registrar a devolução"
            enviando={enviandoJustificativa}
            erro={erroDaJustificativa?.mensagem ?? null}
            aoConfirmar={(texto) => registrarDevolucao(order, texto)}
            aoFechar={fechar}
          />
        );
      })()}
    </div>
  );
}
