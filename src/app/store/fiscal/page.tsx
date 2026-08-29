"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText, ShieldCheck, Check, AlertTriangle, Search, Plus, Trash2,
  DollarSign, RefreshCw, Layers, Edit3, Settings, CheckCircle2, ChevronRight,
  Info, Sparkles, Receipt, Filter, ArrowUpRight, Calendar, Download, Printer, Copy,
  ExternalLink, Eye, ChevronDown, ChevronUp, Lock, HelpCircle, X, CheckSquare, Square,
  Send, Mail, FileArchive
} from "lucide-react";

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
  regimeTributario: number; // CRT: 1 Simples, 2 Simples c/ excesso, 3 Normal
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
  temCsc?: boolean;
  temCertificado?: boolean;
};

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
  fiscalBreakdown?: any[] | null;
  comboGroups?: any[];
};

type FiscalOrder = {
  id: string;
  dailyOrderNumber?: number | string | null;
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
  } | null;
};

const FAQ_ITEMS = [
  // A resposta anterior prometia "NFC-e e NF-e". NF-e (modelo 55) não existe
  // neste módulo — só NFC-e (modelo 65). Prometer na FAQ o que o botão não faz
  // é o mesmo tipo de mentira que o módulo fiscal falso antigo contava.
  { q: "Que tipos de notas podem ser emitidas?", a: "O sistema emite NFC-e (Nota Fiscal de Consumidor Eletrônica, modelo 65) — a nota do consumidor final, para delivery, balcão, mesa e totem. NF-e modelo 55 (para venda a outra empresa) ainda não é emitida por aqui." },
  // As três respostas abaixo descreviam um rateio por item que o código não
  // faz: desconto e taxa vão no TOTAL da nota. Descrever o que existe evita
  // que o lojista (ou o contador dele) conte com uma discriminação que não
  // aparece no XML.
  { q: "Como as recompensas de fidelidade aparecem na nota?", a: "Entram junto com os demais descontos, abatendo o total do documento (vDesc). Não são rateadas item a item." },
  { q: "Como as taxas de serviços e acréscimos aparecem na nota?", a: "A taxa de entrega vai como Outras Despesas Acessórias (vOutro), somando ao total. NFC-e não tem campo de frete, por isso a modalidade vai como 'sem frete'." },
  { q: "Como os descontos aparecem na nota?", a: "Cupons e descontos da loja reduzem o valor total do documento no campo vDesc." },
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
];

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

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
    regimeTributario: 1, // Simples Nacional: o caso da esmagadora maioria
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
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  });
  // Segredos digitados AGORA. Só entram no PUT quando preenchidos — mandar ""
  // apagaria o que já está salvo no servidor.
  const [tokenProvedorInput, setTokenProvedorInput] = useState("");
  const [cscInput, setCscInput] = useState("");
  const [testandoConexao, setTestandoConexao] = useState(false);

  // O que falta para esta loja emitir, conforme o servidor. Vazio = pronta.
  const [pendenciasFiscais, setPendenciasFiscais] = useState<{ campo: string; mensagem: string }[]>([]);
  const [podeEmitir, setPodeEmitir] = useState(false);

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
        // O servidor devolve a lista do que ainda falta para emitir. É ela que
        // alimenta o aviso do topo — antes a tela não tinha como saber se o
        // módulo estava pronto, então mostrava tudo verde de qualquer jeito.
        setPendenciasFiscais(Array.isArray(data.pendencias) ? data.pendencias : []);
        setPodeEmitir(Boolean(data.podeEmitir));
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
    const payload: any = {
      enabled: c.enabled,
      ambiente: c.ambiente,
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
      autoEmitPaymentMethods: c.autoEmitPaymentMethods,
      temCertificado: Boolean(c.temCertificado),
    };
    if (tokenProvedorInput.trim()) payload.tokenDoProvedor = tokenProvedorInput.trim();
    if (cscInput.trim()) payload.csc = cscInput.trim();

    try {
      const res = await fetch("/api/store/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const dados = await res.json().catch(() => ({}));
      if (res.ok) {
        setFiscalConfig({
          ...c,
          temTokenDoProvedor: c.temTokenDoProvedor || Boolean(payload.tokenDoProvedor),
          temCsc: c.temCsc || Boolean(payload.csc),
        });
        if (payload.tokenDoProvedor) setTokenProvedorInput("");
        if (payload.csc) setCscInput("");
        // O PUT devolve o retrato atualizado: mostrar na hora o que ainda
        // falta vale mais que um "salvo com sucesso" genérico.
        setPendenciasFiscais(dados.pendencias || []);
        setPodeEmitir(Boolean(dados.podeEmitir));
        alert(
          (dados.podeEmitir
            ? "Configurações salvas. Cadastro completo: esta loja PODE emitir NFC-e. ✅"
            : `Configurações salvas. Ainda faltam ${dados.pendencias?.length ?? 0} item(ns) — veja a lista no topo da tela.`) +
          (dados.aviso ? `\n\n${dados.aviso}` : "")
        );
      } else {
        alert(dados.mensagem || dados.error || "Erro ao salvar.");
      }
    } catch {
      alert("Erro ao salvar.");
    }
  };

  // Chama o provedor com o token salvo e traduz a resposta. Autenticou = o
  // token vale; recusou = o lojista descobre AQUI, não na primeira emissão.
  const handleTestarConexao = async () => {
    setTestandoConexao(true);
    try {
      const res = await fetch("/api/store/fiscal/testar-conexao", { method: "POST" });
      const dados = await res.json().catch(() => ({}));
      alert(dados.mensagem || (res.ok ? "Conexão OK." : "Falha na conexão com o provedor."));
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
          ? "\n\n" + dados.pendencias.map((x: any) => `• ${x.campo}: ${x.mensagem}`).join("\n")
          : "";
        alert(`${dados.mensagem || dados.error || "Não foi possível emitir."}${lista}`);
        return;
      }

      alert(
        `Nota autorizada.

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
      if (res.ok && dados.success) {
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
  const handleCancelarNota = async (order: any) => {
    const justificativa = window.prompt(
      "Justificativa do cancelamento (mínimo 15 caracteres — exigência da SEFAZ):"
    );
    if (justificativa === null) return;
    if (justificativa.trim().length < 15) {
      alert("A justificativa precisa ter pelo menos 15 caracteres.");
      return;
    }
    if (!window.confirm("Cancelar esta nota na SEFAZ? O cancelamento é definitivo.")) return;
    try {
      const res = await fetch("/api/store/fiscal/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, justificativa: justificativa.trim() }),
      });
      const dados = await res.json().catch(() => ({}));
      alert(dados.mensagem || dados.error || (res.ok ? "Nota cancelada." : "Não consegui cancelar."));
      fetchInvoices();
    } catch {
      alert("Não consegui falar com o servidor. Tente de novo.");
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
      for (const id of selectedBatchOrderIds) {
        const pedido = orders.find((o: any) => o.id === id);
        const res = await fetch("/api/store/fiscal/emitir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: id }),
        });
        const dados = await res.json().catch(() => ({}));
        // 202 (processando) não é autorizada: sem chave, sem protocolo. Conta
        // como pendente com instrução de consultar — nunca como sucesso.
        const autorizada = res.ok && res.status !== 202;
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
      alert(`${autorizadas.length} de ${resultados.length} nota(s) autorizada(s).${detalhe}`);

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
          ? "\n\n" + data.pendencias.slice(0, 6).map((x: any) => `• ${x.campo}: ${x.mensagem}`).join("\n")
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
    const autorizadas = filteredOrders.filter(o => o.fiscalStatus === "EMITTED");
    const valAutorizadas = autorizadas.reduce((s, o) => s + o.totalAmount, 0);
    const negadas = filteredOrders.filter(o => o.fiscalStatus === "FAILED");
    const valNegadas = negadas.reduce((s, o) => s + o.totalAmount, 0);
    const canceladas = filteredOrders.filter(o => o.fiscalStatus === "CANCELED");
    const valCanceladas = canceladas.reduce((s, o) => s + o.totalAmount, 0);

    return {
      totalVendas, valVendas,
      countAutorizadas: autorizadas.length, valAutorizadas,
      countNegadas: negadas.length, valNegadas,
      countCanceladas: canceladas.length, valCanceladas,
    };
  }, [filteredOrders]);

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
      <div style={{ margin: "0 0 1.25rem", padding: "1rem 1.25rem", background: "#FFFBEB", border: "1px solid #FDE68A", borderLeft: "6px solid #D97706", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="#D97706" />
          <strong style={{ fontSize: "0.92rem", color: "#92400E" }}>
            Modo TESTE (homologação) — as notas emitidas aqui NÃO têm valor fiscal
          </strong>
        </div>
        <p style={{ fontSize: "0.83rem", color: "#78350F", margin: "8px 0 0", lineHeight: 1.5 }}>
          Tudo funciona igual e a nota é aceita — mas pelo ambiente de <strong>teste</strong> da SEFAZ.
          Ela não serve para o cliente, não serve para o contador e não conta para o Fisco.
          Quando terminar de testar, vá em <strong>Configuração → Ambiente</strong> e mude para
          <strong> Produção</strong> (com o token de produção do Focus NFe).
        </p>
      </div>
    );

  const AvisoDoEstadoFiscal = () =>
    podeEmitir ? null : (
      <div style={{ margin: "0 0 1.25rem", padding: "1rem 1.25rem", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} color="#DC2626" />
          <strong style={{ fontSize: "0.92rem", color: "#991B1B" }}>
            Esta loja ainda não emite nota fiscal
          </strong>
        </div>
        <p style={{ fontSize: "0.83rem", color: "#7F1D1D", margin: "8px 0 0", lineHeight: 1.5 }}>
          Nenhuma NFC-e é transmitida à SEFAZ enquanto o cadastro abaixo não estiver completo.
          Os pedidos aparecem como <strong>pendentes</strong> — não há nota emitida para eles.
        </p>
        {pendenciasFiscais.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: "0.82rem", color: "#7F1D1D", lineHeight: 1.6 }}>
            {pendenciasFiscais.slice(0, 8).map((p, i) => (
              <li key={i}>
                <strong>{p.campo}</strong>: {p.mensagem}
              </li>
            ))}
            {pendenciasFiscais.length > 8 && (
              <li>e mais {pendenciasFiscais.length - 8} pendência(s).</li>
            )}
          </ul>
        )}
      </div>
    );

  return (
    <div style={{ background: "#F8FAFC", minHeight: "100vh", display: "flex", fontFamily: "'Inter', sans-serif" }}>
      {/* ── CARDÁPIO WEB STYLE SIDEBAR (FISCAL NAV) ── */}
      <div style={{ width: 220, background: "#fff", borderRight: "1px solid #E2E8F0", padding: "1.5rem 0", flexShrink: 0 }}>
        <div style={{ padding: "0 1.25rem 1rem", borderBottom: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "1px" }}>FISCAL</span>
        </div>

        <div style={{ padding: "0.75rem 0.5rem" }}>
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
                onClick={() => setActiveNav(item.key as any)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: active ? "#F3E8FF" : "transparent",
                  color: active ? "#7E22CE" : "#475569",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  transition: "0.15s",
                }}
              >
                <Icon size={16} color={active ? "#7E22CE" : "#64748B"} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── MAIN CONTENT AREA ── */}
      <div style={{ flex: 1, padding: "1.5rem 2rem", overflowX: "auto" }}>
        
        {/* ── NAV 1: CONFIGURAÇÕES FISCAIS (STYLE CARDÁPIO WEB) ── */}
        {activeNav === "config" && (
          <div>
            <AvisoDoEstadoFiscal />
            <AvisoDeHomologacao />
            <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
              Configurações fiscais
            </h1>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
              {/* Left Column: Accordion Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                
                {/* Accordion 1: Dados da Empresa */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "dados" ? null : "dados")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Dados da empresa</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "dados" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "dados" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>CNPJ / CPF *</label>
                          <input value={fiscalConfig.cnpj || cpfCnpj} onChange={e => setFiscalConfig(p => ({ ...p, cnpj: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Inscrição Estadual (IE)</label>
                          <input value={fiscalConfig.inscricaoEstadual} onChange={e => setFiscalConfig(p => ({ ...p, inscricaoEstadual: e.target.value }))} placeholder="Obrigatória para emitir NFC-e" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Razão Social</label>
                          <input value={fiscalConfig.razaoSocial} onChange={e => setFiscalConfig(p => ({ ...p, razaoSocial: e.target.value }))} placeholder="Razão Social MEI / LTDA" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Nome Fantasia</label>
                          <input value={fiscalConfig.nomeFantasia || storeName} onChange={e => setFiscalConfig(p => ({ ...p, nomeFantasia: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Regime tributário (CRT) *</label>
                          <select
                            value={fiscalConfig.regimeTributario}
                            onChange={e => setFiscalConfig(p => ({ ...p, regimeTributario: Number(e.target.value) }))}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", background: "#fff" }}
                          >
                            <option value={1}>1 — Simples Nacional</option>
                            <option value={2}>2 — Simples Nacional (excesso de sublimite)</option>
                            <option value={3} disabled>3 — Regime Normal (em breve)</option>
                          </select>
                        </div>
                      </div>
                      <button onClick={() => saveFiscalConfig()} style={{ marginTop: 14, padding: "8px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Dados</button>
                    </div>
                  )}
                </div>

                {/* Accordion 2: Configurações Fiscais Gerais */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "gerais" ? null : "gerais")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Configurações fiscais gerais</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "gerais" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "gerais" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 12 }}>Selecione as formas de pagamento com emissão automática de NFC-e:</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        {PAYMENT_OPTIONS.map(pm => {
                          const active = fiscalConfig.autoEmitPaymentMethods.includes(pm.key);
                          return (
                            <label key={pm.key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
                              <input type="checkbox" checked={active} onChange={() => {
                                const next = active ? fiscalConfig.autoEmitPaymentMethods.filter(k => k !== pm.key) : [...fiscalConfig.autoEmitPaymentMethods, pm.key];
                                saveFiscalConfig({ autoEmitPaymentMethods: next });
                              }} style={{ accentColor: "#7E22CE", width: 16, height: 16 }} />
                              {pm.label} — <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 400 }}>{pm.desc}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion: Endereço fiscal — vai no XML de toda NFC-e */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "endereco" ? null : "endereco")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Endereço fiscal da empresa</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "endereco" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "endereco" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 12 }}>
                        É o endereço que consta no CNPJ — ele vai dentro do XML de cada nota. O código IBGE do
                        município tem 7 dígitos e é diferente do CEP (busque por &quot;código IBGE + nome da cidade&quot;).
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Logradouro (rua/avenida) *</label>
                          <input value={fiscalConfig.logradouro} onChange={e => setFiscalConfig(p => ({ ...p, logradouro: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Número *</label>
                          <input value={fiscalConfig.numero} onChange={e => setFiscalConfig(p => ({ ...p, numero: e.target.value }))} placeholder='Sem número? "S/N"' style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Bairro *</label>
                          <input value={fiscalConfig.bairro} onChange={e => setFiscalConfig(p => ({ ...p, bairro: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>CEP *</label>
                          <input value={fiscalConfig.cep} onChange={e => setFiscalConfig(p => ({ ...p, cep: e.target.value }))} placeholder="00000-000" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Município *</label>
                          <input value={fiscalConfig.municipio} onChange={e => setFiscalConfig(p => ({ ...p, municipio: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
                          <div>
                            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Código IBGE *</label>
                            <input value={fiscalConfig.codigoMunicipio} onChange={e => setFiscalConfig(p => ({ ...p, codigoMunicipio: e.target.value }))} placeholder="7 dígitos" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                          </div>
                          <div>
                            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>UF *</label>
                            <input value={fiscalConfig.uf} maxLength={2} onChange={e => setFiscalConfig(p => ({ ...p, uf: e.target.value.toUpperCase() }))} placeholder="RJ" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", textTransform: "uppercase" }} />
                          </div>
                        </div>
                      </div>
                      <button onClick={() => saveFiscalConfig()} style={{ marginTop: 14, padding: "8px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Endereço</button>
                    </div>
                  )}
                </div>

                {/* Accordion: Provedor de emissão — quem assina e transmite à SEFAZ */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "provedor" ? null : "provedor")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Provedor de emissão (SEFAZ)</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "provedor" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "provedor" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 12, lineHeight: 1.5 }}>
                        A NFC-e é transmitida à SEFAZ por um provedor homologado. Crie sua conta no
                        provedor, cadastre lá a empresa e o certificado A1, e cole aqui o token de acesso
                        do ambiente escolhido (homologação e produção têm tokens diferentes).
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Provedor *</label>
                          <select
                            value={fiscalConfig.provedor || ""}
                            onChange={e => setFiscalConfig(p => ({ ...p, provedor: e.target.value || null }))}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", background: "#fff" }}
                          >
                            <option value="">Selecione…</option>
                            <option value="focusnfe">Focus NFe</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                            Token do provedor * {fiscalConfig.temTokenDoProvedor && <span style={{ color: "#16A34A" }}>— já cadastrado ✓</span>}
                          </label>
                          <input
                            type="password"
                            value={tokenProvedorInput}
                            onChange={e => setTokenProvedorInput(e.target.value)}
                            placeholder={fiscalConfig.temTokenDoProvedor ? "Preencher só para trocar" : "Cole o token aqui"}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Série da NFC-e *</label>
                          <input
                            type="number"
                            min={1}
                            value={fiscalConfig.serie}
                            onChange={e => setFiscalConfig(p => ({ ...p, serie: Number(e.target.value) || 1 }))}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>ID do CSC (idToken) *</label>
                          <input
                            value={fiscalConfig.cscId}
                            onChange={e => setFiscalConfig(p => ({ ...p, cscId: e.target.value }))}
                            placeholder="Ex.: 000001"
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
                            CSC — Código de Segurança do Contribuinte * {fiscalConfig.temCsc && <span style={{ color: "#16A34A" }}>— já cadastrado ✓</span>}
                          </label>
                          <input
                            type="password"
                            value={cscInput}
                            onChange={e => setCscInput(e.target.value)}
                            placeholder={fiscalConfig.temCsc ? "Preencher só para trocar" : "Obtido no portal da SEFAZ do seu estado"}
                            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
                          />
                          <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "4px 0 0" }}>
                            O CSC assina o QR Code da NFC-e. Ele é emitido no portal da SEFAZ do seu estado (não é o token do provedor).
                          </p>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button onClick={() => saveFiscalConfig()} style={{ padding: "8px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Provedor</button>
                        <button
                          onClick={handleTestarConexao}
                          disabled={testandoConexao}
                          style={{ padding: "8px 18px", background: "#fff", color: "#7E22CE", border: "1.5px solid #7E22CE", borderRadius: 8, fontWeight: 700, cursor: "pointer", opacity: testandoConexao ? 0.6 : 1 }}
                        >
                          {testandoConexao ? "Testando..." : "Testar conexão"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion 3: Certificado Digital A1 */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "cert" ? null : "cert")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Certificado digital modelo A1</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "cert" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "cert" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      {/* Aqui havia um <input type="file"> sem onChange e um campo de
                          senha sem state: o arquivo e a senha nunca saíam da tela. O
                          lojista selecionava o certificado, via o nome do arquivo
                          aparecer e ia embora achando que tinha enviado.

                          Não foi trocado por um upload que funciona, e sim removido:
                          o .pfx é a CHAVE PRIVADA da empresa. Quem tem o arquivo e a
                          senha assina documento fiscal em nome dela. Guardar isso no
                          FireHub significaria virar depositário da chave de cada
                          cliente — e um vazamento nosso viraria fraude fiscal deles.
                          O certificado vai direto para o provedor de emissão, que é
                          quem assina e transmite. */}
                      <div style={{ marginTop: 12, padding: 14, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10 }}>
                        <p style={{ fontSize: "0.85rem", color: "#92400E", fontWeight: 700, margin: 0 }}>
                          O certificado não é enviado ao FireHub
                        </p>
                        <p style={{ fontSize: "0.82rem", color: "#78350F", marginTop: 6, lineHeight: 1.5 }}>
                          O arquivo <strong>.pfx</strong> é a chave privada da sua empresa — quem tem
                          ele e a senha assina documento fiscal no seu nome. Por isso ele fica com o
                          <strong> provedor de emissão</strong>, que é quem assina e transmite para a
                          SEFAZ. Envie o certificado no painel do provedor e cole aqui apenas o token
                          de acesso, na seção <strong>Provedor de emissão</strong>.
                        </p>
                      </div>
                      {/* A confirmação é declaração do titular — o arquivo fica no
                          provedor e o FireHub não tem como "ver" o certificado. O que
                          confere de verdade é a primeira emissão em homologação. */}
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 14, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, color: "#334155" }}>
                        <input
                          type="checkbox"
                          checked={Boolean(fiscalConfig.temCertificado)}
                          onChange={e => saveFiscalConfig({ temCertificado: e.target.checked })}
                          style={{ accentColor: "#7E22CE", width: 16, height: 16, marginTop: 2 }}
                        />
                        <span>
                          Já enviei o certificado A1 (.pfx) no painel do provedor de emissão.
                          <span style={{ display: "block", fontSize: "0.75rem", color: "#94A3B8", fontWeight: 400, marginTop: 2 }}>
                            Marque somente depois de concluir o envio lá — sem o certificado no provedor, toda emissão será recusada.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Accordion 4: Ambiente de Emissão */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "amb" ? null : "amb")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Ambiente de emissão</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "amb" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "amb" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                        {/* 2 = homologação, 1 = produção — o número do XML, que é o
                            que o servidor grava. A string antiga era descartada. */}
                        {([2, 1] as const).map(amb => (
                          <button key={amb} onClick={() => saveFiscalConfig({ ambiente: amb })} style={{
                            padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${fiscalConfig.ambiente === amb ? "#7E22CE" : "#CBD5E1"}`,
                            background: fiscalConfig.ambiente === amb ? "#F3E8FF" : "#fff", color: fiscalConfig.ambiente === amb ? "#7E22CE" : "#475569", fontWeight: 700, cursor: "pointer"
                          }}>
                            {amb === 2 ? "🧪 Homologação (Testes)" : "🚀 Produção (Validade Jurídica)"}
                          </button>
                        ))}
                      </div>
                      <p style={{ fontSize: "0.78rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", marginTop: 12, lineHeight: 1.5 }}>
                        Nota emitida em <strong>homologação</strong> é teste e não tem valor fiscal.
                        Só mude para produção depois de emitir com sucesso em homologação — e lembre
                        que cada ambiente tem token e CSC próprios.
                      </p>
                    </div>
                  )}
                </div>

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
                <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "6px 14px", fontSize: "0.82rem", color: "#EA580C", fontWeight: 700 }}>
                  Você possui <strong>{pendingProductsCount} produtos</strong> com dados pendentes
                </div>
              )}
            </div>

            {/* Sub-tabs: PRODUTOS | ENGENHARIA DE COMBOS */}
            <div style={{ display: "flex", gap: 16, borderBottom: "2px solid #E2E8F0", marginBottom: 16 }}>
              <button onClick={() => setProductsTab("produtos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "produtos" ? 800 : 600, color: productsTab === "produtos" ? "#7E22CE" : "#64748B", borderBottom: productsTab === "produtos" ? "3px solid #7E22CE" : "3px solid transparent", cursor: "pointer" }}>
                PRODUTOS
              </button>
              <button onClick={() => setProductsTab("combos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "combos" ? 800 : 600, color: productsTab === "combos" ? "#7E22CE" : "#64748B", borderBottom: productsTab === "combos" ? "3px solid #7E22CE" : "3px solid transparent", cursor: "pointer" }}>
                ENGENHARIA DE COMBOS
              </button>
            </div>

            {productsTab === "produtos" ? (
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                    <input value={searchProduct} onChange={e => setSearchProduct(e.target.value)} placeholder="Pesquise pelo produto" style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" }} />
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#F1F5F9", textTransform: "uppercase", fontSize: "0.7rem", color: "#475569" }}>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Categoria</th>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Produto</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Preço</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Situação</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>NCM</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CEST</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CFOP</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CSOSN/CST</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map(p => {
                        const isRegular = p.ncm && p.ncm !== "Indefinido";
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{p.category}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1E293B" }}>{p.name}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{fmt(p.price)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: isRegular ? "#DCFCE7" : "#FFEDD5", color: isRegular ? "#16A34A" : "#EA580C" }}>
                                {isRegular ? "Regular" : "Pendente"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.ncm || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cest || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cfop || "5102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.csosn || "102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <button onClick={() => setEditingProduct(p)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7E22CE", fontWeight: 700 }}>Editar ✏️</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Sub-tab Engenharia de Combos */
              <div style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, display: "grid" }}>
                {combosList.map(combo => (
                  <div key={combo.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 800 }}>{combo.name}</h3>
                    <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "#16A34A" }}>{fmt(combo.price)}</span>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "6px 0 12px" }}>
                      {combo.fiscalBreakdown ? "🟢 Engenharia Discriminada Ativa" : "⚪ Valor Único Padrão"}
                    </p>
                    <button onClick={() => { setEditingCombo(combo); setFiscalItemsDraft(combo.fiscalBreakdown || []); setPrecoFiscalPorItem({}); fetchComboDetails(combo.id); }} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #7E22CE", background: "#F3E8FF", color: "#7E22CE", fontWeight: 700, cursor: "pointer" }}>
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
                    const pendingIds = orders
                      .filter(o =>
                        o.fiscalStatus !== "EMITTED" &&
                        o.orderStatus !== "CANCELADO" &&
                        !o.fiscalInfo?.processando
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
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DollarSign size={22} color="#0284C7" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Total de vendas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#1E293B" }}>{orderStats.totalVendas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{fmt(orderStats.valVendas)}</span>
                </div>
              </div>

              {/* Card 2: Notas Autorizadas */}
              <div style={{ background: "#fff", border: "1px solid #BBF7D0", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={22} color="#16A34A" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#166534", fontWeight: 700, textTransform: "uppercase" }}>Notas autorizadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#15803D" }}>{orderStats.countAutorizadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#166534" }}>{fmt(orderStats.valAutorizadas)}</span>
                </div>
              </div>

              {/* Card 3: Notas Negadas */}
              <div style={{ background: "#fff", border: "1px solid #FED7AA", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HelpCircle size={22} color="#EA580C" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#C2410C", fontWeight: 700, textTransform: "uppercase" }}>Notas negadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#C2410C" }}>{orderStats.countNegadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#C2410C" }}>{fmt(orderStats.valNegadas)}</span>
                </div>
              </div>

              {/* Card 4: Notas Canceladas */}
              <div style={{ background: "#fff", border: "1px solid #FECACA", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <AlertTriangle size={22} color="#DC2626" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#991B1B", fontWeight: 700, textTransform: "uppercase" }}>Notas canceladas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#991B1B" }}>{orderStats.countCanceladas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#991B1B" }}>{fmt(orderStats.valCanceladas)}</span>
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
                    const emittedAtStr = order.fiscalInfo?.emittedAt
                      ? new Date(order.fiscalInfo.emittedAt).toLocaleDateString("pt-BR") + " " +
                        new Date(order.fiscalInfo.emittedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                      : null;

                    return (
                      <tr key={order.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px", fontWeight: 700, color: "#1E293B" }}>
                          Nº {order.dailyOrderNumber}
                          <span style={{ fontSize: "0.68rem", color: "#94A3B8", display: "block" }}>#{order.id.slice(-8)}</span>
                        </td>
                        <td style={{ padding: "10px", color: "#475569" }}>{dateStr}</td>
                        <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmt(order.totalAmount)}</td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          {/* Antes era "Concluído" carimbado em TODA linha —
                              inclusive pedido cancelado. */}
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: isPedidoCancelado ? "#FEE2E2" : "#DCFCE7", color: isPedidoCancelado ? "#B91C1C" : "#15803D" }}>
                            {isPedidoCancelado ? "Cancelado" : "Concluído"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: "#334155" }}>{order.paymentMethod}</td>
                        <td style={{ padding: "10px", textAlign: "center", color: "#64748B" }}>{order.deliveryType || "Delivery"}</td>
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
                                ? (order.fiscalInfo?.ultimoErro || "")
                                : isHomologacao
                                ? "Emitida no ambiente de HOMOLOGAÇÃO da SEFAZ (teste). Não tem valor fiscal e não serve para o cliente nem para o contador."
                                : undefined
                            }
                            style={{
                              fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                              background: isHomologacao ? "#FEF3C7" : isEmitted ? "#DCFCE7" : isProcessing ? "#FEF3C7" : isFailed ? "#FEE2E2" : "#F1F5F9",
                              color: isHomologacao ? "#92400E" : isEmitted ? "#15803D" : isProcessing ? "#B45309" : isFailed ? "#B91C1C" : "#64748B",
                            }}
                          >
                            {isHomologacao ? "TESTE — sem valor fiscal" : isEmitted ? "Autorizada" : isNotaCancelada ? "Nota cancelada" : isProcessing ? "Processando" : isFailed ? "Falhou" : "Não emitida"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          {isEmitted ? (
                            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                              <button onClick={() => setSelectedOrderForDanfe(order)} style={{ background: "none", border: "none", cursor: "pointer" }} title="Espelho simplificado (conferência rápida)">
                                📄 Espelho
                              </button>
                              {/* DANFE oficial via servidor: o link direto do provedor
                                  exige autenticação e devolvia 401 no navegador. */}
                              <button onClick={() => window.open(`/api/store/fiscal/danfe?orderId=${order.id}`, "_blank")} style={{ background: "none", border: "none", cursor: "pointer" }} title="DANFE oficial (PDF com QR Code)">
                                🧾 DANFE
                              </button>
                              <button onClick={() => handleCancelarNota(order)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C" }} title="Cancelar a nota na SEFAZ (prazo curto — normalmente 30 min)">
                                ✕ Cancelar
                              </button>
                            </div>
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
                              style={{ background: "#FEF3C7", border: "1px solid #B45309", color: "#B45309", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Consultar situação
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSelectedOrderForEmit(order); setEmitCpfInput(order.customerCpfCnpj || ""); }}
                              style={{ background: "#F3E8FF", border: "1px solid #7E22CE", color: "#7E22CE", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Emitir
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

              <button onClick={handleInutilizar} disabled={inutilizing} style={{ padding: "10px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
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
                <FileArchive size={17} color="#7E22CE" />
                <strong style={{ fontSize: "0.92rem", color: "#334155" }}>O que vai dentro do pacote</strong>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: "0.84rem", color: "#475569", lineHeight: 1.5 }}>
                <div><strong>xml/</strong> — um arquivo XML por nota autorizada, nomeado pela chave de acesso. É o que o contador lança na escrituração; o resto é conferência.</div>
                <div><strong>relacao-de-notas.csv</strong> — uma linha por nota (número, série, chave, protocolo, valor, forma de pagamento). Abre no Excel com duplo clique.</div>
                <div><strong>vendas-sem-nota.csv</strong> — os pedidos do período que <strong>não</strong> tiveram nota, com o motivo. É a diferença entre o que a loja vendeu e o que ela declarou — o arquivo que ninguém pede e todo mundo precisa.</div>
              </div>
              <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
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
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "1px solid #7E22CE", background: "#F3E8FF", color: "#7E22CE", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none" }}
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
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", opacity: enviandoContador ? 0.6 : 1 }}
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
                <Mail size={17} color="#7E22CE" />
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
                          border: `1.5px solid ${contador.quando === op.k ? "#7E22CE" : "#E2E8F0"}`,
                          background: contador.quando === op.k ? "#7E22CE" : "#fff",
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
                  <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: "#7E22CE", background: "#FAF5FF", borderRadius: 8, padding: "7px 10px" }}>
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

                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem", fontWeight: 700, color: contador.automatico ? "#15803D" : "#64748B", cursor: "pointer", background: contador.automatico ? "#F0FDF4" : "#F8FAFC", border: `1px solid ${contador.automatico ? "#A7F3D0" : "#E2E8F0"}`, borderRadius: 10, padding: "10px 12px" }}>
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
                    style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", opacity: salvandoContador ? 0.6 : 1 }}
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
                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderLeft: "6px solid #D97706", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#92400E", lineHeight: 1.45 }}>
                  <strong>Modo TESTE (homologação).</strong> Esta nota vai para o ambiente de teste
                  da SEFAZ: ela <strong>não tem valor fiscal</strong> e não serve para o cliente nem
                  para o contador. Para emitir de verdade, mude o ambiente em Configuração.
                </div>
              )}

              {/* Alert 1: Azul */}
              <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#0369A1", lineHeight: 1.4 }}>
                Pedidos com nota fiscal emitida não podem ser alterados ou cancelados. Para cancelá-los, é necessário cancelar a nota primeiro, respeitando o prazo de até 30 minutos após a emissão.
              </div>

              {/* Alert 2: Laranja */}
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "12px", marginBottom: 16, fontSize: "0.82rem", color: "#C2410C", lineHeight: 1.4 }}>
                Pedido de <strong>delivery</strong> sai na nota como <strong>entrega a domicílio</strong>; retirada, balcão, mesa e totem saem como <strong>operação presencial</strong>. Informar o CPF do cliente é opcional, mas é o que permite a ele usar a nota depois.
              </div>

              <p style={{ fontSize: "0.9rem", color: "#1E293B", margin: "0 0 16px", lineHeight: 1.5 }}>
                Emissão da <strong>NFC-e</strong> do pedido <strong>{selectedOrderForEmit.dailyOrderNumber}</strong> no valor de <strong>{fmt(selectedOrderForEmit.totalAmount)}</strong> feito no dia <strong>{new Date(selectedOrderForEmit.createdAt).toLocaleDateString("pt-BR")} às {new Date(selectedOrderForEmit.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
              </p>

              {/* CPF / CNPJ Input (Roxo) */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#7E22CE", display: "block", marginBottom: 4 }}>CPF/CNPJ na nota</label>
                <input
                  value={emitCpfInput}
                  onChange={e => setEmitCpfInput(e.target.value)}
                  placeholder="Deixe em branco caso não queira informar"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #7E22CE", fontSize: "0.88rem", outline: "none" }}
                />
              </div>

              {/* Footer Buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => handleEmitSingle(true)} disabled={emitting} style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid #7E22CE", background: "#fff", color: "#7E22CE", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  EMITIR E IMPRIMIR
                </button>
                <button onClick={() => handleEmitSingle(false)} disabled={emitting} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
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
                    <label key={order.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 6, background: checked ? "#F3E8FF" : "#fff", cursor: "pointer", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedBatchOrderIds(prev => checked ? prev.filter(id => id !== order.id) : [...prev, order.id])} style={{ accentColor: "#7E22CE", width: 16, height: 16 }} />
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Pedido #{order.dailyOrderNumber} — {order.customerName}</span>
                      </div>
                      <strong style={{ fontSize: "0.85rem", color: "#16A34A" }}>{fmt(order.totalAmount)}</strong>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>{selectedBatchOrderIds.length} pedidos selecionados</span>
                <button onClick={handleBatchEmit} disabled={batchEmitting || selectedBatchOrderIds.length === 0} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
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
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderLeft: "6px solid #D97706", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
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

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => window.print()} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                🖨️ Imprimir DANFE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 4: EDITAR DADOS TRIBUTÁRIOS DO PRODUTO (NCM, CEST, CFOP, CSOSN) ── */}
      {editingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setEditingProduct(null)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, padding: "1.25rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid #E2E8F0", paddingBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#1E293B" }}>Tributação do Produto</h2>
              <button onClick={() => setEditingProduct(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <p style={{ margin: "0 0 14px", fontSize: "0.85rem", fontWeight: 700, color: "#7E22CE" }}>
              {editingProduct.name} ({editingProduct.category}) — {fmt(editingProduct.price)}
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>NCM *</label>
                <input value={editingProduct.ncm || ""} onChange={e => setEditingProduct({ ...editingProduct, ncm: e.target.value })} placeholder="Ex: 2106.90.90" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CEST</label>
                <input value={editingProduct.cest || ""} onChange={e => setEditingProduct({ ...editingProduct, cest: e.target.value })} placeholder="Ex: 28.062.00" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CFOP *</label>
                <input value={editingProduct.cfop || "5102"} onChange={e => setEditingProduct({ ...editingProduct, cfop: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CSOSN / CST *</label>
                <input value={editingProduct.csosn || "102"} onChange={e => setEditingProduct({ ...editingProduct, csosn: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST PIS</label>
                <input value={editingProduct.pis || "49"} onChange={e => setEditingProduct({ ...editingProduct, pis: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST COFINS</label>
                <input value={editingProduct.cofins || "49"} onChange={e => setEditingProduct({ ...editingProduct, cofins: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEditingProduct(null)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={handleSaveProductTax} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#7E22CE", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Salvar Tributação</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 5: ENGENHARIA FISCAL DO COMBO ── */}
      {editingCombo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => { setEditingCombo(null); setComboDetails(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700, maxHeight: "90vh", overflow: "auto", padding: "1.5rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "2px solid #7E22CE", paddingBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>🔧 Engenharia Fiscal do Combo</h2>
                <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#64748B" }}>Configure como cada item sai na nota fiscal</p>
              </div>
              <button onClick={() => { setEditingCombo(null); setComboDetails(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
            </div>

            {/* Combo info */}
            <div style={{ background: "#F3E8FF", border: "1px solid #D8B4FE", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1rem", color: "#581C87" }}>{editingCombo.name}</div>
                <div style={{ fontSize: "0.78rem", color: "#7E22CE" }}>Preço do combo para o cliente</div>
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#16A34A" }}>{fmt(editingCombo.price)}</div>
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
                    style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid #7E22CE", background: "#F3E8FF", color: "#7E22CE", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
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
                                {addPrice > 0 && <span style={{ color: "#EA580C", fontWeight: 600, fontSize: "0.72rem" }}>+{fmt(addPrice)}</span>}
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
                                    border: `1.5px solid ${foiAlterado ? "#7E22CE" : "#CBD5E1"}`,
                                    background: foiAlterado ? "#FAF5FF" : "#fff",
                                    fontWeight: 800, color: foiAlterado ? "#6B21A8" : "#16A34A",
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
                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "1rem", textAlign: "center", fontSize: "0.82rem", color: "#92400E" }}>
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
                        <button onClick={() => setFiscalItemsDraft(fiscalItemsDraft.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", cursor: "pointer", color: "#EF4444", padding: 2 }}>
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
                        <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#EA580C", fontWeight: 600 }}>
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
                <div style={{ background: isValid ? "#F0FDF4" : "#FEF2F2", border: `1px solid ${isValid ? "#BBF7D0" : "#FECACA"}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: isValid ? "#166534" : "#991B1B" }}>
                      {isValid ? "✅ Valores batendo!" : "⚠️ Valores divergentes!"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: "0.82rem" }}>
                    <div>
                      <div style={{ color: "#6B7280", fontSize: "0.72rem" }}>Preço combo (cliente)</div>
                      <div style={{ fontWeight: 800, color: "#334155" }}>{fmt(editingCombo.price)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#6B7280", fontSize: "0.72rem" }}>Menor seleção possível ({fiscalItemsDraft.length} opções)</div>
                      <div style={{ fontWeight: 800, color: isValid ? "#16A34A" : "#EF4444" }}>{fmt(totalFiscal)}</div>
                    </div>
                    <div>
                      <div style={{ color: "#6B7280", fontSize: "0.72rem" }}>Diferença</div>
                      <div style={{ fontWeight: 800, color: isValid ? "#16A34A" : "#EF4444" }}>{diff > 0 ? "+" : ""}{fmt(diff)}</div>
                    </div>
                  </div>
                  {!isValid && (
                    <p style={{ margin: "8px 0 0", fontSize: "0.75rem", color: "#991B1B", lineHeight: 1.4 }}>
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
                <button onClick={() => { setFiscalItemsDraft([]); }} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#EF4444", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" }}>
                  <Trash2 size={14} style={{ marginRight: 4 }} /> Limpar tudo
                </button>
              )}
              <button onClick={handleSaveComboFiscal} disabled={savingCombo || fiscalItemsDraft.length === 0} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: fiscalItemsDraft.length === 0 ? "#CBD5E1" : "#7E22CE", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: fiscalItemsDraft.length === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {savingCombo ? <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Salvando...</> : <><CheckCircle2 size={14} /> Salvar engenharia fiscal</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
