"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Package, Database, History, ClipboardList, Plus, 
  Trash2, ArrowUpRight, ArrowDownRight, AlertTriangle, 
  Settings, Check, X, Search, Info, RefreshCw,
  Camera, Upload, Sparkles, TrendingDown, FileText,
  ChevronDown, ChevronUp, Eye, EyeOff, BarChart3, ScanLine, Clock
} from "lucide-react";
import TrilhaDoQr from "@/components/estoque/TrilhaDoQr";
import EscanearQrModal from "@/components/estoque/EscanearQrModal";

interface EstoqueClientProps {
  userName: string;
  storeName: string;
  /** Os três números que a trilha do QR relata. Vêm do servidor no primeiro
      render: buscar por fetch faria a trilha piscar "nenhuma etiqueta criada"
      na cara de quem já criou trezentas. */
  fluxo: { criadas: number; recebidos: number; baixas: number; disponivel: boolean };
}

interface StockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  minQuantity: number | null;
  unitCost: number | null;
  supplier: string | null;
}

interface Transaction {
  id: string;
  createdAt: string;
  quantity: number;
  type: string;
  notes: string | null;
  stockItem: {
    id: string;
    name: string;
    unit: string;
  };
}

interface MenuProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  recipeItems: Array<{
    id: string;
    stockItemId: string;
    quantityConsumed: number;
    stockItem: {
      name: string;
      unit: string;
    };
  }>;
}

interface NfeItem {
  nome: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  stockItemId: string; // '' = unlinked, 'NEW' = create new
  newItemName: string;
  newItemUnit: string;
}

export default function EstoqueClient({ userName, storeName, fluxo = { criadas: 0, recebidos: 0, baixas: 0, disponivel: false } }: EstoqueClientProps) {
  const [activeTab, setActiveTab] = useState<"items" | "lotes" | "nfe" | "history" | "recipes">("items");
  const [mostrarScanner, setMostrarScanner] = useState(false);
  const [lotes, setLotes] = useState<any[]>([]);
  const [contadoresDeLote, setContadoresDeLote] = useState<any>({ aguardando: 0, geladeira: 0, vencendo: 0, vencidos: 0 });
  const [filtroDeLote, setFiltroDeLote] = useState<"todos" | "aguardando" | "geladeira" | "vencendo" | "vencidos">("todos");
  const [carregandoLotes, setCarregandoLotes] = useState(false);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState<boolean>(true);
  const [expandedKpi, setExpandedKpi] = useState<"low" | "negative" | null>(null);

  // Data States
  const [items, setItems] = useState<StockItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  
  // Search & Filter
  const [itemSearch, setItemSearch] = useState<string>("");
  const [productSearch, setProductSearch] = useState<string>("");
  const [showOnlyWithoutRecipe, setShowOnlyWithoutRecipe] = useState<boolean>(false);

  // History Filters
  const [histType, setHistType] = useState<string>("ALL");
  const [histItem, setHistItem] = useState<string>("ALL");
  const [histDateStart, setHistDateStart] = useState<string>("");
  const [histDateEnd, setHistDateEnd] = useState<string>("");

  // Modais
  const [showItemModal, setShowItemModal] = useState<boolean>(false);
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showRecipeModal, setShowRecipeModal] = useState<boolean>(false);

  // Form States - Novo Item
  const [newItemName, setNewItemName] = useState<string>("");
  const [newItemQty, setNewItemQty] = useState<string>("");
  const [newItemUnit, setNewItemUnit] = useState<string>("g");
  const [newItemMin, setNewItemMin] = useState<string>("");
  const [newItemCost, setNewItemCost] = useState<string>("");

  // Form States - Movimentação
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [moveQty, setMoveQty] = useState<string>("");
  const [moveType, setMoveType] = useState<string>("INPUT"); // INPUT, OUTPUT, WASTE, NFE
  const [moveNotes, setMoveNotes] = useState<string>("");

  // Form States - Receita / Ficha Técnica
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(null);
  const [recipeIngredients, setRecipeIngredients] = useState<Array<{ stockItemId: string; quantityConsumed: string }>>([]);

  // NF-e States
  const [nfeImage, setNfeImage] = useState<string | null>(null);
  const [nfeProcessing, setNfeProcessing] = useState(false);
  const [nfeScanResult, setNfeScanResult] = useState<any>(null);
  const [nfeItems, setNfeItems] = useState<NfeItem[]>([]);
  const [nfeConfirming, setNfeConfirming] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Busca os lotes só quando a aba abre, e de novo a cada troca de filtro.
   *
   * Fora do `loadData` de propósito: ele roda na montagem da tela e a lista de
   * lotes é a única coisa aqui que não interessa a quem veio ver o saldo dos
   * insumos. Uma consulta a mais no caminho de abertura atrasa a tela inteira
   * por causa de uma aba que talvez ninguém abra.
   */
  const carregarLotes = async (filtro: string) => {
    setCarregandoLotes(true);
    try {
      const r = await fetch(`/api/store/estoque/lotes?filtro=${filtro}`);
      const d = await r.json();
      setLotes(d.lotes || []);
      setContadoresDeLote(d.contadores || { aguardando: 0, geladeira: 0, vencendo: 0, vencidos: 0 });
    } catch {
      setLotes([]);
    } finally {
      setCarregandoLotes(false);
    }
  };

  useEffect(() => {
    if (activeTab === "lotes") carregarLotes(filtroDeLote);
  }, [activeTab, filtroDeLote]);

  // ── DE ONDE A PESSOA VEIO ────────────────────────────────────────────────
  //
  // A tela do QR, no celular, manda para cá com o que ela já sabe: `?scan=1`
  // quando o funcionário quer ler a próxima etiqueta, `?tab=lotes&code=XXX`
  // quando o lote precisa ser vinculado a um insumo. Sem ler isso aqui, os dois
  // botões de lá desembocam na tela genérica e a pessoa tem que adivinhar o
  // resto — que é exatamente o beco que eles tinham antes.
  const [codigoDestacado, setCodigoDestacado] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("scan") === "1") setMostrarScanner(true);
    const aba = q.get("tab");
    if (aba === "lotes") setActiveTab("lotes");
    const filtro = q.get("filtro");
    if (filtro && ["todos", "aguardando", "geladeira", "vencendo", "vencidos"].includes(filtro)) {
      setFiltroDeLote(filtro as any);
    }
    const code = q.get("code");
    if (code) {
      setCodigoDestacado(code.trim().toUpperCase());
      setActiveTab("lotes");
    }
  }, []);

  // Os contadores alimentam o aviso na própria aba ("3 vencendo"), então eles
  // precisam existir ANTES de alguém abrir a aba — senão o número que faria a
  // pessoa clicar só aparece depois que ela clica.
  useEffect(() => {
    carregarLotes("todos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load all data on mount
      const [itemsRes, transRes, recipesRes] = await Promise.all([
        fetch("/api/store/estoque/items"),
        fetch("/api/store/estoque/transactions"),
        fetch("/api/store/estoque/recipes")
      ]);

      const itemsData = await itemsRes.json();
      const transData = await transRes.json();
      const recipesData = await recipesRes.json();

      if (itemsData.success) setItems(itemsData.items);
      if (transData.success) setTransactions(transData.transactions);
      if (recipesData.success) {
        setProducts(recipesData.menuProducts);
        // We only use the initial items fetch to avoid conflict, but we could update here if needed.
      }
    } catch (err) {
      console.error("Erro ao carregar dados do estoque:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const dismissed = localStorage.getItem("estoque-onboarding-dismissed");
    if (dismissed === "true") {
      setShowOnboarding(false);
    }
    loadData();
  }, []);

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem("estoque-onboarding-dismissed", "true");
  };

  // KPIs Calculation
  const totalItemsCount = items.length;
  const negativeStockItems = items.filter(i => i.quantity < 0);
  const lowStockItems = items.filter(i => i.minQuantity !== null && i.quantity <= i.minQuantity && i.quantity >= 0);
  
  const validProducts = products.filter(p => !isHiddenIntegrationItem(p));
  const productsWithRecipe = validProducts.filter(p => p.recipeItems.length > 0);
  const recipeCoveragePct = validProducts.length > 0 
    ? Math.round((productsWithRecipe.length / validProducts.length) * 100) 
    : 0;

  // Handlers - Items
  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName) return;

    try {
      const res = await fetch("/api/store/estoque/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newItemName,
          quantity: parseFloat(newItemQty) || 0,
          unit: newItemUnit,
          minQuantity: newItemMin ? parseFloat(newItemMin) : null,
          unitCost: newItemCost ? parseFloat(newItemCost) : null
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao criar item.");
        return;
      }
      setShowItemModal(false);
      setNewItemName("");
      setNewItemQty("");
      setNewItemMin("");
      setNewItemCost("");
      loadData();
    } catch (err) {
      alert("Erro ao enviar dados.");
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este ingrediente do estoque? Isso também afetará receitas vinculadas.")) return;
    try {
      const res = await fetch(`/api/store/estoque/items?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        loadData();
      } else {
        const d = await res.json();
        alert(d.error || "Erro ao deletar.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Handlers - Transactions
  const handleRegisterMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || !moveQty) return;

    try {
      const res = await fetch("/api/store/estoque/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockItemId: selectedItem.id,
          quantity: parseFloat(moveQty),
          type: moveType,
          notes: moveNotes
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao lançar transação.");
        return;
      }
      setShowMoveModal(false);
      setMoveQty("");
      setMoveNotes("");
      loadData();
    } catch (err) {
      alert("Erro ao registrar movimentação.");
    }
  };

  // Handlers - Recipes
  const openRecipeEditor = (product: MenuProduct) => {
    setSelectedProduct(product);
    const existingRecipe = product.recipeItems.map(ri => ({
      stockItemId: ri.stockItemId,
      quantityConsumed: String(ri.quantityConsumed)
    }));
    setRecipeIngredients(existingRecipe.length > 0 ? existingRecipe : [{ stockItemId: "", quantityConsumed: "" }]);
    setShowRecipeModal(true);
  };

  const addRecipeRow = () => setRecipeIngredients([...recipeIngredients, { stockItemId: "", quantityConsumed: "" }]);
  
  const removeRecipeRow = (index: number) => {
    const next = [...recipeIngredients];
    next.splice(index, 1);
    setRecipeIngredients(next.length > 0 ? next : [{ stockItemId: "", quantityConsumed: "" }]);
  };

  const updateRecipeRow = (index: number, field: "stockItemId" | "quantityConsumed", val: string) => {
    const next = [...recipeIngredients];
    next[index][field] = val;
    setRecipeIngredients(next);
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    const validIngredients = recipeIngredients.filter(
      ri => ri.stockItemId && parseFloat(ri.quantityConsumed) > 0
    );

    try {
      const res = await fetch("/api/store/estoque/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menuProductId: selectedProduct.id,
          ingredients: validIngredients
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao salvar receita.");
        return;
      }
      setShowRecipeModal(false);
      loadData();
    } catch (err) {
      alert("Erro ao salvar receita.");
    }
  };

  // NF-e AI Handlers
  const triggerFileInput = () => fileInputRef.current?.click();

  const processNFEFile = async (file: File) => {
    if (!file) return;
    setNfeProcessing(true);
    setNfeScanResult(null);
    setNfeItems([]);

    try {
      // 1. Upload
      const formData = new FormData();
      formData.append("file", file);
      // "invoices" é uma das pastas permitidas em src/lib/storage.ts, e é onde a
      // rota de leitura procura o arquivo depois.
      formData.append("type", "invoice");

      // Era "/api/upload-image", rota que nunca existiu neste projeto (existem
      // /api/upload e /api/upload-store-image). O 404 fazia o fluxo morrer em
      // "Falha ao enviar imagem" antes de qualquer leitura — a foto da nota
      // fiscal nunca chegou a ser processada uma vez sequer.
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      const uploadData = await uploadRes.json();
      
      if (!uploadRes.ok) throw new Error(uploadData.error || "Falha ao enviar imagem");

      const imageUrl = uploadData.url;
      setNfeImage(imageUrl);

      // 2. Scan with AI
      const scanRes = await fetch("/api/store/estoque/nfe-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl })
      });
      const scanData = await scanRes.json();

      if (!scanRes.ok) throw new Error(scanData.error || "Falha ao analisar NF-e");

      setNfeScanResult(scanData.data);
      
      // Map scanned items to our state format
      const mappedItems: NfeItem[] = (scanData.data.itens || []).map((it: any) => {
        // Try to guess a match
        const match = items.find(stockIt => 
          stockIt.name.toLowerCase() === it.nome.toLowerCase() || 
          stockIt.name.toLowerCase().includes(it.nome.toLowerCase())
        );

        return {
          nome: it.nome,
          quantidade: it.quantidade || 0,
          unidade: it.unidade || "un",
          valorUnitario: it.valorUnitario || 0,
          valorTotal: it.valorTotal || 0,
          stockItemId: match ? match.id : "",
          newItemName: it.nome,
          newItemUnit: it.unidade || "un"
        };
      });

      setNfeItems(mappedItems);
    } catch (err: any) {
      alert(err.message || "Erro no processamento da Nota Fiscal.");
      setNfeImage(null);
    } finally {
      setNfeProcessing(false);
    }
  };

  const handleNfeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processNFEFile(file);
  };

  const handleNfeDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processNFEFile(file);
    }
  };

  const updateNfeItem = (index: number, field: keyof NfeItem, val: any) => {
    const next = [...nfeItems];
    next[index] = { ...next[index], [field]: val };
    setNfeItems(next);
  };

  const handleConfirmNfe = async () => {
    if (nfeItems.length === 0) return;
    
    // Validate
    const invalid = nfeItems.some(it => !it.stockItemId || (it.stockItemId === 'NEW' && !it.newItemName));
    if (invalid) {
      alert("Por favor, vincule todos os itens a um insumo existente ou configure-os como novo insumo.");
      return;
    }

    setNfeConfirming(true);
    try {
      const res = await fetch("/api/store/estoque/nfe-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: nfeItems,
          invoiceData: nfeScanResult ? {
            fornecedor: nfeScanResult.fornecedor,
            numeroNF: nfeScanResult.numeroNF,
            dataEmissao: nfeScanResult.dataEmissao,
            valorTotal: nfeScanResult.valorTotal,
          } : null,
          imageUrl: nfeImage,
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao confirmar NF-e");
      
      alert("Nota fiscal processada e estoque atualizado com sucesso!");
      setNfeImage(null);
      setNfeScanResult(null);
      setNfeItems([]);
      setActiveTab("items");
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setNfeConfirming(false);
    }
  };

  // Utilities
  const getTransactionBadge = (type: string) => {
    switch (type) {
      case "INPUT": return <span className="badge badge-success">Entrada</span>;
      case "OUTPUT": return <span className="badge badge-error">Saída</span>;
      case "WASTE": return <span className="badge badge-warning">Desperdício</span>;
      case "SALE": return <span className="badge badge-sale">Venda</span>;
      case "NFE": return <span className="badge badge-nfe">NF-e</span>;
      default: return <span className="badge">{type}</span>;
    }
  };

  const formatQuantity = (qty: number, unit: string) => {
    return `${qty.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`;
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  function isHiddenIntegrationItem(p: MenuProduct) {
    const catUpper = (p.category || "").toUpperCase().trim();
    const nameUpper = (p.name || "").toUpperCase().trim();
    if (["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE", "COMPLEMENTO", "COMPLEMENTOS", "OPCIONAL", "OPCIONAIS", "ADICIONAL", "ADICIONAIS", "INSUMO", "INSUMOS", "OCULTO"].some(h => catUpper.includes(h))) {
      return true;
    }
    if (["IFOOD |", "JOTAJÁ |", "JOTAJA |", "COMBOS |", "PRODUTO (R$"].some(prefix => nameUpper.startsWith(prefix))) {
      return true;
    }
    return false;
  }

  // Derived Filtered Data
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const filteredProducts = validProducts.filter(prod => {
    const matchesSearch = prod.name.toLowerCase().includes(productSearch.toLowerCase());
    const matchesCoverage = showOnlyWithoutRecipe ? prod.recipeItems.length === 0 : true;
    return matchesSearch && matchesCoverage;
  });

  const filteredTransactions = transactions.filter(t => {
    if (histType !== "ALL" && t.type !== histType) return false;
    if (histItem !== "ALL" && t.stockItem?.id !== histItem) return false;
    
    const tDate = new Date(t.createdAt);
    if (histDateStart) {
      const sDate = new Date(histDateStart);
      sDate.setHours(0,0,0,0);
      if (tDate < sDate) return false;
    }
    if (histDateEnd) {
      const eDate = new Date(histDateEnd);
      eDate.setHours(23,59,59,999);
      if (tDate > eDate) return false;
    }
    return true;
  });

  return (
    <div className="estoque-container fh-tela">
      {/* ONBOARDING BANNER */}
      {/* ── CABEÇALHO DO MÓDULO ──────────────────────────────────────────
          O mesmo componente da tela de Etiquetas, de propósito: é a repetição
          que faz as duas telas parecerem o mesmo produto.

          Saíram daqui, no mesmo commit em que isto entrou (nunca em dois, ou
          existiria uma versão da tela em que 340px de conteúdo simplesmente
          sumiram): o banner roxo escuro de quatro passos fixos, o header em
          gradiente e o badge "MÓDULO INTEGRADO". O banner prometia progresso e
          não sabia nada sobre a loja; o badge se autoelogiava sem informar
          nada; e as duas superfícies escuras viram espelho e mapa de digitais
          num tablet engordurado sob a luz da cozinha. */}
      <header className="fh-cabecalho">
        <span className="fh-cabecalho__icone"><Package size={24} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="fh-micro">MÓDULO · ESTOQUE</div>
          <h1 className="fh-h1">Controle de estoque</h1>
          <p className="fh-corpo">
            Saldo dos insumos, fichas técnicas e a baixa automática de cada venda de <strong>{storeName}</strong>.
          </p>
        </div>
        <div className="fh-cabecalho__acoes">
          <button className="fh-btn fh-btn--secundario" onClick={() => setMostrarScanner(true)}>
            <ScanLine size={18} /> Escanear etiqueta
          </button>
          <button className="fh-btn fh-btn--secundario fh-btn--icone" onClick={loadData} aria-label="Atualizar">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
          <button className="fh-btn fh-btn--primario" onClick={() => setShowItemModal(true)}>
            <Plus size={18} /> Novo insumo
          </button>
        </div>
      </header>

      {/* ── A TRILHA DO QR ───────────────────────────────────────────────── */}
      <TrilhaDoQr fluxo={fluxo} aoEscanear={() => setMostrarScanner(true)} />

      <EscanearQrModal aberto={mostrarScanner} aoFechar={() => setMostrarScanner(false)} />

      {/* No celular, o botão de escanear do cabeçalho fica longe depois de
          rolar a lista — e escanear é justamente o que se faz de pé, com a
          caixa na mão. O alvo tem 60px porque é uso de cozinha. */}
      <button
        className="fab-escanear"
        onClick={() => setMostrarScanner(true)}
        aria-label="Escanear etiqueta"
      >
        <ScanLine size={24} />
      </button>

      {/* KPI DASHBOARD */}
      {!loading && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon-wrapper blue"><Database size={20} /></div>
            <div className="kpi-info">
              <span className="kpi-label">Total de Insumos</span>
              <span className="kpi-value">{totalItemsCount}</span>
            </div>
          </div>
          <div 
            className="kpi-card warning clickable" 
            onClick={() => setExpandedKpi(expandedKpi === "low" ? null : "low")}
          >
            <div className="kpi-icon-wrapper yellow"><AlertTriangle size={20} /></div>
            <div className="kpi-info">
              <span className="kpi-label">Estoque Baixo</span>
              <span className="kpi-value">{lowStockItems.length}</span>
            </div>
            {expandedKpi === "low" ? <ChevronUp size={16} className="kpi-chevron"/> : <ChevronDown size={16} className="kpi-chevron"/>}
          </div>
          <div 
            className="kpi-card danger clickable"
            onClick={() => setExpandedKpi(expandedKpi === "negative" ? null : "negative")}
          >
            <div className="kpi-icon-wrapper red pulse"><TrendingDown size={20} /></div>
            <div className="kpi-info">
              <span className="kpi-label">Estoque Negativo</span>
              <span className="kpi-value">{negativeStockItems.length}</span>
            </div>
            {expandedKpi === "negative" ? <ChevronUp size={16} className="kpi-chevron"/> : <ChevronDown size={16} className="kpi-chevron"/>}
          </div>
          <div className="kpi-card">
            <div className="kpi-icon-wrapper purple"><ClipboardList size={20} /></div>
            <div className="kpi-info">
              <span className="kpi-label">Fichas Técnicas</span>
              <span className="kpi-value">{recipeCoveragePct}% <span className="kpi-subtext">({productsWithRecipe.length}/{validProducts.length})</span></span>
            </div>
          </div>
        </div>
      )}

      {/* ── OS DOIS NÚMEROS DO LOTE ──────────────────────────────────────────
          Só aparecem quando existe lote: numa loja que nunca imprimiu etiqueta,
          dois mostradores zerados a mais só empurram a lista de insumos para
          baixo. E são clicáveis — número que não leva a lugar nenhum obriga o
          lojista a procurar sozinho de onde ele saiu. */}
      {!loading && (contadoresDeLote.aguardando > 0 || contadoresDeLote.vencendo > 0 || contadoresDeLote.vencidos > 0) && (
        <div className="kpi-grid" style={{ marginTop: "-0.5rem" }}>
          {contadoresDeLote.aguardando > 0 && (
            <div className="kpi-card clickable" onClick={() => { setActiveTab("lotes"); setFiltroDeLote("aguardando"); }}>
              <div className="kpi-icon-wrapper" style={{ background: "var(--fh-marca-claro)", color: "var(--fh-marca)" }}><Clock size={20} /></div>
              <div className="kpi-info">
                <span className="kpi-label">Aguardando entrada</span>
                <span className="kpi-value">{contadoresDeLote.aguardando}</span>
              </div>
              <ChevronDown size={16} className="kpi-chevron" style={{ transform: "translateY(-50%) rotate(-90deg)" }} />
            </div>
          )}
          {contadoresDeLote.vencendo > 0 && (
            <div className="kpi-card clickable warning" onClick={() => { setActiveTab("lotes"); setFiltroDeLote("vencendo"); }}>
              <div className="kpi-icon-wrapper yellow"><AlertTriangle size={20} /></div>
              <div className="kpi-info">
                <span className="kpi-label">Vencendo em 3 dias</span>
                <span className="kpi-value">{contadoresDeLote.vencendo}</span>
              </div>
              <ChevronDown size={16} className="kpi-chevron" style={{ transform: "translateY(-50%) rotate(-90deg)" }} />
            </div>
          )}
          {contadoresDeLote.vencidos > 0 && (
            <div className="kpi-card clickable danger" onClick={() => { setActiveTab("lotes"); setFiltroDeLote("vencidos"); }}>
              <div className="kpi-icon-wrapper red"><TrendingDown size={20} /></div>
              <div className="kpi-info">
                <span className="kpi-label">Lotes vencidos</span>
                <span className="kpi-value">{contadoresDeLote.vencidos}</span>
              </div>
              <ChevronDown size={16} className="kpi-chevron" style={{ transform: "translateY(-50%) rotate(-90deg)" }} />
            </div>
          )}
        </div>
      )}

      {/* EXPANDABLE KPI LISTS */}
      {expandedKpi === "low" && lowStockItems.length > 0 && (
        <div className="kpi-expanded-panel warning-panel">
          <h4>Itens com Estoque Baixo</h4>
          <ul>
            {lowStockItems.map(it => (
              <li key={it.id}>
                <span>{it.name}</span>
                <strong>{formatQuantity(it.quantity, it.unit)} <span className="min-label">(Min: {it.minQuantity}{it.unit})</span></strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {expandedKpi === "negative" && negativeStockItems.length > 0 && (
        <div className="kpi-expanded-panel danger-panel">
          <h4>Itens com Estoque Negativo</h4>
          <ul>
            {negativeStockItems.map(it => (
              <li key={it.id}>
                <span>{it.name}</span>
                <strong>{formatQuantity(it.quantity, it.unit)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* DASHBOARD TABS */}
      <div className="tabs-container">
        <button 
          className={`tab-link ${activeTab === "items" ? "active" : ""}`}
          onClick={() => setActiveTab("items")}
        >
          <Database size={16} />
          Insumos em Estoque
        </button>
        <button 
          className={`tab-link ${activeTab === "nfe" ? "active nfe-tab" : ""}`}
          onClick={() => setActiveTab("nfe")}
        >
          <Sparkles size={16} />
          Entrada com IA
        </button>
        <button 
          className={`tab-link ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          <History size={16} />
          Histórico
        </button>
        <button 
          className={`tab-link ${activeTab === "lotes" ? "active" : ""}`}
          onClick={() => setActiveTab("lotes")}
        >
          <ScanLine size={16} />
          Lotes &amp; Validade
          {contadoresDeLote.vencendo + contadoresDeLote.vencidos > 0 && (
            <span className="fh-chip" style={{ marginLeft: 6, height: 20, padding: "0 7px" }}>
              {contadoresDeLote.vencendo + contadoresDeLote.vencidos}
            </span>
          )}
        </button>
        <button 
          className={`tab-link ${activeTab === "recipes" ? "active" : ""}`}
          onClick={() => setActiveTab("recipes")}
        >
          <ClipboardList size={16} />
          Fichas Técnicas
        </button>
      </div>

      {/* LOADING STATE */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Carregando registros de estoque...</p>
        </div>
      ) : (
        <div className="tab-body">
          
          {/* TAB LOTES: o que foi etiquetado, e o que está vencendo ─────────
              Até aqui o lote existia no banco, o QR funcionava e o scan dava
              entrada e saída — e mesmo assim NENHUMA tela do produto mostrava
              um lote sequer. Quem imprimia etiqueta não tinha como saber se
              alguém tinha escaneado. */}
          {activeTab === "lotes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([
                  ["todos", "Todos"],
                  ["aguardando", `Aguardando entrada (${contadoresDeLote.aguardando})`],
                  ["geladeira", `No meu estoque (${contadoresDeLote.geladeira})`],
                  ["vencendo", `Vencendo (${contadoresDeLote.vencendo})`],
                  ["vencidos", `Vencidos (${contadoresDeLote.vencidos})`],
                ] as const).map(([v, rotulo]) => (
                  <button
                    key={v}
                    onClick={() => setFiltroDeLote(v as any)}
                    className={`fh-btn ${filtroDeLote === v ? "fh-btn--primario" : "fh-btn--secundario"}`}
                    style={{ height: 44, boxShadow: filtroDeLote === v ? "var(--fh-e-marca)" : undefined }}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              {carregandoLotes ? (
                <div className="loading-state"><div className="spinner"></div><p>Carregando os lotes...</p></div>
              ) : lotes.length === 0 ? (
                <div className="fh-vazio">
                  <ScanLine size={44} style={{ color: "var(--fh-t-inerte)" }} />
                  <div className="fh-vazio__titulo">
                    {filtroDeLote === "todos" ? "Nenhum lote ainda" : "Nada neste filtro"}
                  </div>
                  <div className="fh-vazio__texto">
                    {filtroDeLote === "todos"
                      ? "Cada etiqueta que você imprime no módulo de etiquetas vira um lote aqui, com validade e saldo próprios. Imprima a primeira e escaneie o QR para dar entrada."
                      : "Troque o filtro acima para ver os outros lotes."}
                  </div>
                  {filtroDeLote === "todos" && (
                    <a href="/store/etiquetas" className="fh-btn fh-btn--primario" style={{ marginTop: 8 }}>
                      Criar minha primeira etiqueta
                    </a>
                  )}
                </div>
              ) : (
                <div className="items-table-wrapper">
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Código</th>
                        <th>Validade</th>
                        <th>Saldo do lote</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotes.map((l: any) => {
                        const destacado = !!codigoDestacado && l.code === codigoDestacado;
                        const cor = l.estadoDePrazo === "vencido" ? "var(--fh-grave)"
                          : l.estadoDePrazo === "hoje" ? "var(--fh-hoje)"
                          : l.estadoDePrazo === "atencao" ? "var(--fh-atencao)"
                          : "var(--fh-ok)";
                        return (
                          <tr key={l.id} style={destacado ? { background: "var(--fh-marca-claro)", outline: "2px solid var(--fh-marca-topo)" } : undefined}>
                            <td style={{ fontWeight: 700 }}>
                              {l.productName}
                              {destacado && (
                                <span className="fh-chip" style={{ marginLeft: 8, background: "var(--fh-marca-claro)", borderColor: "var(--fh-marca-borda)", color: "var(--fh-marca-tinta)" }}>
                                  a etiqueta que você escaneou
                                </span>
                              )}
                            </td>
                            <td style={{ fontFamily: "monospace", letterSpacing: "0.06em" }}>{l.code}</td>
                            {/* Cor + PALAVRA, nunca só a cor: a gordura na tela
                                destrói o matiz antes de destruir a luminância. */}
                            <td style={{ color: cor, fontWeight: 800 }}>{l.textoDePrazo}</td>
                            <td>{l.quantidadeRestante} {l.unit}</td>
                            <td>
                              {l.aguardandoRecebimento ? (
                                <span className="fh-chip" style={{ color: "var(--fh-atencao-tinta)", background: "var(--fh-atencao-claro)", borderColor: "var(--fh-atencao-borda)" }}>
                                  <Clock size={13} /> Aguardando entrada
                                </span>
                              ) : (
                                <span className="fh-chip" style={{ color: "var(--fh-ok-tinta)", background: "var(--fh-ok-claro)", borderColor: "var(--fh-ok-borda)" }}>
                                  <Check size={13} /> No estoque
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: ITEMS */}
          {activeTab === "items" && (
            <>
              <div className="search-bar">
                <Search size={18} className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Pesquisar insumo (ex: Queijo, Carne moída)..." 
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                />
              </div>

              {filteredItems.length === 0 ? (
                <div className="empty-state">
                  <Package size={48} />
                  <h3>Nenhum insumo encontrado</h3>
                  <p>Cadastre um novo insumo clicando no botão "Novo Insumo" no topo da página.</p>
                </div>
              ) : (
                <div className="items-table-wrapper">
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>Nome do Insumo</th>
                        <th>Saldo Atual</th>
                        <th>Estoque Mínimo</th>
                        <th>Custo Unit.</th>
                        <th>Valor em Estoque</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(item => {
                        const isNegative = item.quantity < 0;
                        const isLow = !isNegative && item.minQuantity !== null && item.quantity <= item.minQuantity;
                        const unitCost = item.unitCost || 0;
                        const stockValue = item.quantity > 0 ? (item.quantity * unitCost) : 0;

                        return (
                          <tr key={item.id} className={`${isNegative ? "negative-stock-tr" : ""} ${isLow ? "low-stock-tr" : ""}`}>
                            <td className="name-col">{item.name}</td>
                            <td className="qty-col">{formatQuantity(item.quantity, item.unit)}</td>
                            <td>{item.minQuantity !== null ? formatQuantity(item.minQuantity, item.unit) : "—"}</td>
                            <td>{unitCost > 0 ? formatCurrency(unitCost) : "—"}</td>
                            <td>{stockValue > 0 ? formatCurrency(stockValue) : "—"}</td>
                            <td>
                              {isNegative ? (
                                <span className="status-label status-negative">
                                  <AlertTriangle size={12} /> Estoque Negativo
                                </span>
                              ) : isLow ? (
                                <span className="status-label status-low">
                                  <AlertTriangle size={12} /> Estoque Baixo
                                </span>
                              ) : (
                                <span className="status-label status-ok">Ok</span>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <div className="action-buttons">
                                <button 
                                  className="btn-action btn-move" 
                                  onClick={() => { setSelectedItem(item); setShowMoveModal(true); }}
                                >
                                  Movimentar
                                </button>
                                <button 
                                  className="btn-action btn-delete" 
                                  onClick={() => handleDeleteItem(item.id)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* TAB 2: NF-E (ENTRADA COM IA) */}
          {activeTab === "nfe" && (
            <div className="nfe-container">
              {!nfeImage && !nfeProcessing && (
                <div 
                  className="nfe-upload-zone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleNfeDrop}
                  onClick={triggerFileInput}
                >
                  <input 
                    type="file" 
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleNfeFileSelect}
                    style={{ display: "none" }}
                  />
                  <div className="upload-icons">
                    <Upload size={32} className="text-blue-500" />
                    <Camera size={32} className="text-slate-400" />
                  </div>
                  <h3>Enviar Nota Fiscal</h3>
                  <p>Arraste e solte a foto da NF-e aqui, ou clique para fazer upload.</p>
                  <div className="upload-hints">
                    <span>Formatos aceitos: JPG, PNG, WEBP, HEIC</span>
                  </div>
                  <button className="btn-primary mt-4">
                    <Camera size={16} /> Abrir Câmera / Galeria
                  </button>
                </div>
              )}

              {nfeProcessing && (
                <div className="nfe-processing-zone">
                  <div className="spinner large"></div>
                  <h3>🤖 IA processando nota fiscal...</h3>
                  <p>Extraindo itens, quantidades e valores da imagem. Aguarde um instante.</p>
                </div>
              )}

              {nfeScanResult && (
                <div className="nfe-results-card">
                  <div className="nfe-results-header">
                    <div className="nfe-meta">
                      <h4>Resumo da Nota</h4>
                      <p><strong>Fornecedor:</strong> {nfeScanResult.fornecedor || "Não identificado"}</p>
                      <p><strong>Número NF-e:</strong> {nfeScanResult.numeroNF || "Não identificado"}</p>
                      <p><strong>Data:</strong> {nfeScanResult.dataEmissao || "Não identificado"}</p>
                      <p><strong>Valor Total:</strong> {nfeScanResult.valorTotal ? formatCurrency(nfeScanResult.valorTotal) : "Não identificado"}</p>
                    </div>
                    <div className="nfe-actions">
                      <button className="btn-secondary" onClick={() => { setNfeScanResult(null); setNfeImage(null); setNfeItems([]); }}>
                        Cancelar
                      </button>
                    </div>
                  </div>

                  <div className="nfe-items-table-wrapper">
                    <h4>Itens Detectados ({nfeItems.length})</h4>
                    <table className="nfe-items-table">
                      <thead>
                        <tr>
                          <th>Item na Nota</th>
                          <th>Qtd</th>
                          <th>UN</th>
                          <th>V. Unit.</th>
                          <th>V. Total</th>
                          <th>Vincular ao Estoque</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nfeItems.map((item, idx) => (
                          <tr key={idx}>
                            <td><strong>{item.nome}</strong></td>
                            <td>{item.quantidade}</td>
                            <td>{item.unidade}</td>
                            <td>{formatCurrency(item.valorUnitario)}</td>
                            <td>{formatCurrency(item.valorTotal)}</td>
                            <td className="linking-col">
                              <select 
                                value={item.stockItemId}
                                onChange={(e) => updateNfeItem(idx, 'stockItemId', e.target.value)}
                                className={!item.stockItemId ? "unlinked" : ""}
                              >
                                <option value="">⚠️ Selecionar Insumo...</option>
                                <option value="NEW">+ Criar novo insumo</option>
                                <optgroup label="Insumos Existentes">
                                  {items.map(it => (
                                    <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                                  ))}
                                </optgroup>
                              </select>

                              {item.stockItemId === 'NEW' && (
                                <div className="new-item-inline">
                                  <input 
                                    type="text" 
                                    placeholder="Nome do novo insumo" 
                                    value={item.newItemName}
                                    onChange={(e) => updateNfeItem(idx, 'newItemName', e.target.value)}
                                  />
                                  <select 
                                    value={item.newItemUnit}
                                    onChange={(e) => updateNfeItem(idx, 'newItemUnit', e.target.value)}
                                    className="small-select"
                                  >
                                    <option value="g">g</option>
                                    <option value="kg">kg</option>
                                    <option value="un">un</option>
                                    <option value="ml">ml</option>
                                    <option value="l">l</option>
                                  </select>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="nfe-confirm-bar">
                    <button 
                      className="btn-submit" 
                      onClick={handleConfirmNfe}
                      disabled={nfeConfirming}
                    >
                      {nfeConfirming ? "Confirmando..." : "✅ Confirmar Entrada"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: HISTORY */}
          {activeTab === "history" && (
            <>
              <div className="filter-controls">
                <div className="form-group mb-0">
                  <label>Tipo de Movimentação</label>
                  <select value={histType} onChange={e => setHistType(e.target.value)}>
                    <option value="ALL">Todas</option>
                    <option value="INPUT">Entrada</option>
                    <option value="OUTPUT">Saída</option>
                    <option value="SALE">Venda</option>
                    <option value="WASTE">Desperdício</option>
                    <option value="NFE">NF-e</option>
                  </select>
                </div>
                <div className="form-group mb-0 flex-1">
                  <label>Insumo</label>
                  <select value={histItem} onChange={e => setHistItem(e.target.value)}>
                    <option value="ALL">Todos os insumos</option>
                    {items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                  </select>
                </div>
                <div className="form-group mb-0">
                  <label>Data Início</label>
                  <input type="date" value={histDateStart} onChange={e => setHistDateStart(e.target.value)} />
                </div>
                <div className="form-group mb-0">
                  <label>Data Fim</label>
                  <input type="date" value={histDateEnd} onChange={e => setHistDateEnd(e.target.value)} />
                </div>
              </div>

              {filteredTransactions.length === 0 ? (
                <div className="empty-state">
                  <History size={48} />
                  <h3>Nenhuma movimentação encontrada</h3>
                  <p>Ajuste os filtros ou aguarde novas movimentações.</p>
                </div>
              ) : (
                <div className="items-table-wrapper">
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>Data/Hora</th>
                        <th>Insumo</th>
                        <th>Tipo</th>
                        <th>Quantidade</th>
                        <th>Observação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map(t => {
                        const isNegative = t.quantity < 0;
                        return (
                          <tr key={t.id}>
                            <td>{new Date(t.createdAt).toLocaleString("pt-BR")}</td>
                            <td className="name-col">{t.stockItem?.name || "Desconhecido"}</td>
                            <td>{getTransactionBadge(t.type)}</td>
                            <td className={`qty-col ${isNegative ? "text-red" : "text-green"}`}>
                              {isNegative ? "" : "+"}
                              {formatQuantity(t.quantity, t.stockItem?.unit || "")}
                            </td>
                            <td className="notes-col">{t.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* TAB 4: RECIPES */}
          {activeTab === "recipes" && (
            <>
              <div className="coverage-bar">
                <div className="coverage-info">
                  <BarChart3 size={18} />
                  <strong>{productsWithRecipe.length} de {validProducts.length} produtos</strong> com ficha técnica configurada ({recipeCoveragePct}%)
                </div>
                <div className="coverage-track">
                  <div className="coverage-fill" style={{ width: `${recipeCoveragePct}%` }}></div>
                </div>
              </div>

              <div className="search-bar" style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <Search size={18} className="search-icon" />
                  <input 
                    type="text" 
                    placeholder="Pesquisar produto do cardápio..." 
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                  />
                </div>
                <button 
                  className={`btn-secondary ${showOnlyWithoutRecipe ? 'active' : ''}`}
                  onClick={() => setShowOnlyWithoutRecipe(!showOnlyWithoutRecipe)}
                >
                  {showOnlyWithoutRecipe ? <EyeOff size={16} /> : <Eye size={16} />}
                  Sem ficha técnica
                </button>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="empty-state">
                  <ClipboardList size={48} />
                  <h3>Nenhum produto encontrado</h3>
                  <p>Revise os filtros ou verifique o cadastro de produtos.</p>
                </div>
              ) : (
                <div className="products-grid">
                  {filteredProducts.map(prod => (
                    <div key={prod.id} className="product-recipe-card">
                      <div className="card-header-prod">
                        <div>
                          <span className="prod-category">{prod.category}</span>
                          <h3>{prod.name}</h3>
                        </div>
                        <button 
                          className="btn-configure"
                          onClick={() => openRecipeEditor(prod)}
                        >
                          <Settings size={14} /> Ficha Técnica
                        </button>
                      </div>
                      
                      <div className="card-body-recipe">
                        <h4>Ingredientes consumidos por unidade:</h4>
                        {prod.recipeItems.length === 0 ? (
                          <p className="no-ingredients">Nenhum insumo vinculado. O estoque não sofrerá baixa nas vendas.</p>
                        ) : (
                          <ul className="ingredients-list">
                            {prod.recipeItems.map(ri => (
                              <li key={ri.id}>
                                <span>{ri.stockItem.name}</span>
                                <strong>{formatQuantity(ri.quantityConsumed, ri.stockItem.unit)}</strong>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* MODAL: NOVO INSUMO */}
      {showItemModal && (
        <div className="modal-overlay" onClick={() => setShowItemModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="btn-close" onClick={() => setShowItemModal(false)}><X size={20} /></button>
            <h2>Novo Insumo de Estoque</h2>
            <form onSubmit={handleCreateItem}>
              <div className="form-group">
                <label>Nome do Ingrediente *</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Ex: Queijo Muçarela, Carne moída, Massa de Esfiha" 
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Estoque Inicial</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    placeholder="Ex: 1000" 
                    value={newItemQty}
                    onChange={e => setNewItemQty(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Unidade</label>
                  <select value={newItemUnit} onChange={e => setNewItemUnit(e.target.value)}>
                    <option value="g">g (Grama)</option>
                    <option value="kg">kg (Quilograma)</option>
                    <option value="un">un (Unidade)</option>
                    <option value="ml">ml (Mililitro)</option>
                    <option value="l">l (Litro)</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Estoque Mínimo (Alerta)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    placeholder="Ex: 200" 
                    value={newItemMin}
                    onChange={e => setNewItemMin(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Custo Unitário (R$)</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0"
                    placeholder="Ex: 25.50" 
                    value={newItemCost}
                    onChange={e => setNewItemCost(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="btn-submit">
                Cadastrar Insumo
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOVIMENTAR INSUMO */}
      {showMoveModal && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <button className="btn-close" onClick={() => setShowMoveModal(false)}><X size={20} /></button>
            <h2>Registrar Movimentação de Estoque</h2>
            <div className="item-summary-badge">
              <span>Item selecionado:</span>
              <strong>{selectedItem.name} (Saldo: {formatQuantity(selectedItem.quantity, selectedItem.unit)})</strong>
            </div>

            <form onSubmit={handleRegisterMove}>
              <div className="form-group">
                <label>Tipo de Lançamento</label>
                <div className="radio-group-types">
                  <label className={`radio-label ${moveType === "INPUT" ? "selected" : ""}`}>
                    <input 
                      type="radio" 
                      name="moveType" 
                      value="INPUT" 
                      checked={moveType === "INPUT"}
                      onChange={e => setMoveType(e.target.value)}
                    />
                    📈 Entrada
                  </label>
                  <label className={`radio-label ${moveType === "OUTPUT" ? "selected" : ""}`}>
                    <input 
                      type="radio" 
                      name="moveType" 
                      value="OUTPUT" 
                      checked={moveType === "OUTPUT"}
                      onChange={e => setMoveType(e.target.value)}
                    />
                    📉 Saída
                  </label>
                  <label className={`radio-label ${moveType === "WASTE" ? "selected" : ""}`}>
                    <input 
                      type="radio" 
                      name="moveType" 
                      value="WASTE" 
                      checked={moveType === "WASTE"}
                      onChange={e => setMoveType(e.target.value)}
                    />
                    🗑️ Perda
                  </label>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Quantidade *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="0.01"
                    required
                    placeholder={`Ex: 500`} 
                    value={moveQty}
                    onChange={e => setMoveQty(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Unidade</label>
                  <input type="text" disabled value={selectedItem.unit} />
                </div>
              </div>

              <div className="form-group">
                <label>Observação / Justificativa</label>
                <input 
                  type="text" 
                  placeholder="Ex: Compra quinzenal, Perda por validade" 
                  value={moveNotes}
                  onChange={e => setMoveNotes(e.target.value)}
                />
              </div>

              <button type="submit" className="btn-submit">
                Confirmar Lançamento
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: FICHA TÉCNICA */}
      {showRecipeModal && selectedProduct && (
        <div className="modal-overlay" onClick={() => setShowRecipeModal(false)}>
          <div className="modal-card modal-large" onClick={e => e.stopPropagation()}>
            <button className="btn-close" onClick={() => setShowRecipeModal(false)}><X size={20} /></button>
            <h2>Configurar Ficha Técnica</h2>
            <p className="modal-subtitle">Produto: <strong>{selectedProduct.name}</strong></p>

            <form onSubmit={handleSaveRecipe}>
              <div className="recipe-rows-container">
                <table className="recipe-editor-table">
                  <thead>
                    <tr>
                      <th>Ingrediente Insumo</th>
                      <th>Qtd. Consumida por un. de venda</th>
                      <th style={{ width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeIngredients.map((row, index) => (
                      <tr key={index}>
                        <td>
                          <select 
                            value={row.stockItemId}
                            required
                            onChange={e => updateRecipeRow(index, "stockItemId", e.target.value)}
                          >
                            <option value="">Selecione o ingrediente...</option>
                            {items.map(it => (
                              <option key={it.id} value={it.id}>
                                {it.name} ({it.unit})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="qty-input-unit">
                            <input 
                              type="number" 
                              step="0.001"
                              min="0.001"
                              required
                              placeholder="Ex: 50"
                              value={row.quantityConsumed}
                              onChange={e => updateRecipeRow(index, "quantityConsumed", e.target.value)}
                            />
                            <span className="unit-label">
                              {items.find(it => it.id === row.stockItemId)?.unit || "un"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <button 
                            type="button" 
                            className="btn-remove-row"
                            onClick={() => removeRecipeRow(index)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="recipe-footer-actions">
                <button type="button" className="btn-add-ingredient" onClick={addRecipeRow}>
                  + Adicionar Ingrediente
                </button>
                <div className="footer-right-buttons">
                  <button type="button" className="btn-secondary" onClick={() => setShowRecipeModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-submit-recipe">
                    Salvar Ficha Técnica
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COMPONENT CSS */}
      <style jsx global>{`
        .estoque-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 1.5rem;
          font-family: Inter, system-ui, sans-serif;
          color: #1e293b;
          animation: fadeIn 0.4s ease-out;
        }
        
        .flex-1 { flex: 1; }
        .mb-0 { margin-bottom: 0 !important; }
        .mt-4 { margin-top: 1rem; }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* ONBOARDING BANNER */
        .onboarding-banner {
          background: linear-gradient(135deg, #0f172a, #1e293b);
          border-radius: 1.25rem;
          padding: 1.5rem 2rem;
          color: white;
          margin-bottom: 1.5rem;
          position: relative;
          box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.4);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          overflow: hidden;
        }

        .onboarding-content {
          position: relative;
          z-index: 2;
        }

        .onboarding-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }
        
        .onboarding-header h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 800;
          background: linear-gradient(to right, #60a5fa, #a78bfa);
          -webkit-background-clip: text;
          color: transparent;
        }

        .onboarding-icon {
          color: #a78bfa;
        }

        .onboarding-text {
          color: #cbd5e1;
          font-size: 0.95rem;
          margin: 0 0 1.25rem 0;
          max-width: 800px;
          line-height: 1.5;
        }

        .onboarding-steps {
          display: flex;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        .step {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          font-size: 0.85rem;
          color: #94a3b8;
          max-width: 250px;
        }

        .step-num {
          background: rgba(255,255,255,0.1);
          color: white;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          font-size: 0.7rem;
          font-weight: 800;
          flex-shrink: 0;
        }

        .step strong { color: white; }

        .btn-onboarding-dismiss {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 9999px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.25rem;
          transition: background 0.2s;
          position: relative;
          z-index: 2;
        }

        .btn-onboarding-dismiss:hover {
          background: rgba(255,255,255,0.2);
        }

        /* HEADER */
        .header-card {
          position: relative;
          background: linear-gradient(135deg, #1e293b, #0f172a);
          border-radius: 1.25rem;
          padding: 2.25rem;
          color: white;
          overflow: hidden;
          margin-bottom: 1.5rem;
          box-shadow: 0 10px 30px -10px rgba(15, 23, 42, 0.3);
        }

        .header-glow {
          position: absolute;
          top: -20%;
          right: -10%;
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, rgba(37, 99, 235, 0.4) 0%, rgba(0,0,0,0) 70%);
          pointer-events: none;
        }

        .header-content {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1.5rem;
        }

        .header-info h1 {
          font-size: 2rem;
          font-weight: 850;
          margin: 0.5rem 0;
          letter-spacing: -0.025em;
        }

        .header-info p {
          color: #94a3b8;
          font-size: 0.95rem;
          margin: 0;
          max-width: 700px;
        }

        .badge-exclusive {
          display: inline-block;
          background: rgba(37, 99, 235, 0.2);
          border: 1px solid rgba(37, 99, 235, 0.4);
          color: #60a5fa;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.25rem 0.65rem;
          border-radius: 9999px;
          letter-spacing: 0.05em;
        }

        .header-actions {
          display: flex;
          gap: 0.5rem;
        }

        .btn-refresh {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 0.75rem;
          border-radius: 0.75rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        
        .btn-refresh .spin {
          animation: spin 1s linear infinite;
        }

        .btn-refresh:hover {
          background: rgba(255, 255, 255, 0.18);
        }

        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: white;
          font-weight: 700;
          font-size: 0.88rem;
          padding: 0.75rem 1.25rem;
          border: none;
          border-radius: 0.75rem;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
          filter: brightness(1.1);
        }
        
        .btn-primary:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        /* KPI GRID */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .kpi-card {
          /* Era rgba(255,255,255,.7) com backdrop-filter blur sobre borda
             branca: vidro fosco, que só tem efeito quando existe algo colorido
             atrás — e atrás daqui é o cinza da página. O custo era real (blur é
             composição por frame, no tablet da cozinha) e o ganho, zero.
             Fundo sólido, hairline e a mesma sombra do resto do painel. */
          background: var(--fh-n1);
          border: 1px solid var(--fh-linha);
          border-radius: var(--fh-r4);
          padding: 1.25rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          box-shadow: var(--fh-e1);
          position: relative;
          transition: box-shadow var(--fh-d-base) var(--fh-move);
        }

        .kpi-card.clickable {
          cursor: pointer;
        }
        /* Sem translateY no hover: num painel que também roda em tablet, o
           card "pula" ao encostar o dedo e nada acontece — o movimento sugere
           uma ação que o toque não completa. */
        .kpi-card.clickable:hover {
          box-shadow: var(--fh-e2);
        }

        .kpi-card.warning {
          background: var(--fh-atencao-claro);
          border-color: var(--fh-atencao-borda);
        }

        .kpi-card.danger {
          background: var(--fh-grave-claro);
          border-color: var(--fh-grave-borda);
        }

        .kpi-chevron {
          position: absolute;
          right: 1rem;
          top: 50%;
          transform: translateY(-50%);
          /* #94a3b8 dá 2,56:1 e reprova até como elemento não-textual — e este
             chevron é o único sinal de que o card abre. */
          color: var(--fh-t4);
        }

        .kpi-icon-wrapper {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* As quatro famílias semânticas do produto, as MESMAS da tela que o
           QR abre no celular: neutro, atenção, grave e info. O roxo e o azul
           que estavam aqui não existiam em nenhuma outra tela do painel — eram
           um dialeto de um arquivo só, e é isso que fazia o módulo parecer
           colado de outro sistema. Os tons novos também passam no contraste
           mínimo, o que #d97706 e #9333ea não faziam. */
        .kpi-icon-wrapper.blue { background: var(--fh-neutro-claro); color: var(--fh-neutro-tinta); }
        .kpi-icon-wrapper.yellow { background: var(--fh-atencao-claro); color: var(--fh-atencao-tinta); }
        .kpi-icon-wrapper.red { background: var(--fh-grave-claro); color: var(--fh-grave-tinta); }
        .kpi-icon-wrapper.purple { background: var(--fh-info-claro); color: var(--fh-info-tinta); }

        @keyframes pulse-red {
          0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
          70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
          100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }

        .pulse {
          animation: pulse-red 2s infinite;
        }

        .kpi-info {
          display: flex;
          flex-direction: column;
        }

        .kpi-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }

        .kpi-value {
          font-size: 1.5rem;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.1;
          margin-top: 0.25rem;
        }

        .kpi-subtext {
          font-size: 0.85rem;
          font-weight: 600;
          color: #94a3b8;
        }

        .kpi-expanded-panel {
          background: white;
          border-radius: 1rem;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          animation: slideUp 0.3s ease-out;
        }

        .kpi-expanded-panel.warning-panel { border: 1px solid #fde68a; }
        .kpi-expanded-panel.danger-panel { border: 1px solid #fecaca; }

        .kpi-expanded-panel h4 {
          margin: 0 0 1rem 0;
          font-size: 0.95rem;
          color: #0f172a;
        }

        .kpi-expanded-panel ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
        }

        .kpi-expanded-panel li {
          display: flex;
          justify-content: space-between;
          padding: 0.75rem;
          background: #f8fafc;
          border-radius: 0.5rem;
          font-size: 0.85rem;
        }
        
        .min-label {
          font-size: 0.75rem;
          color: #94a3b8;
          font-weight: normal;
        }

        /* TABS */
        .tabs-container {
          display: flex;
          background: #e2e8f0;
          padding: 0.35rem;
          border-radius: 0.85rem;
          gap: 0.25rem;
          margin-bottom: 1.5rem;
          overflow-x: auto;
        }

        .tab-link {
          border: none;
          background: none;
          padding: 0.65rem 1.25rem;
          border-radius: 0.65rem;
          font-size: 0.88rem;
          font-weight: 700;
          color: #475569;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          white-space: nowrap;
        }

        .tab-link.active {
          background: white;
          color: #2563eb;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
        }

        .tab-link.nfe-tab {
          background: linear-gradient(to right, #fdf4ff, #faf5ff);
          color: #9333ea;
        }
        .tab-link.active.nfe-tab {
          background: white;
          border-bottom: 2px solid #a855f7;
        }

        /* SEARCH BAR & FILTERS */
        .search-bar {
          position: relative;
          margin-bottom: 1.25rem;
        }

        .search-icon {
          position: absolute;
          left: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
        }

        .search-bar input {
          width: 100%;
          padding: 0.85rem 1rem 0.85rem 2.75rem;
          border: 1.5px solid #cbd5e1;
          border-radius: 0.75rem;
          font-size: 0.95rem;
          font-weight: 550;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-bar input:focus {
          border-color: #2563eb;
        }

        .filter-controls {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.25rem;
          background: white;
          padding: 1rem;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          flex-wrap: wrap;
        }

        .filter-controls .form-group {
          min-width: 150px;
        }

        /* TABLES */
        .fab-escanear {
          display: none;
        }
        @media (max-width: 767px) {
          .fab-escanear {
            display: grid;
            place-items: center;
            position: fixed;
            /* Acima da barra do navegador no celular, e à esquerda do widget de
               contato que já mora no canto direito. */
            left: 16px;
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            width: 60px;
            height: 60px;
            border-radius: 9999px;
            border: none;
            background: var(--fh-marca);
            color: #fff;
            box-shadow: var(--fh-e-marca);
            cursor: pointer;
            z-index: 900;
          }
        }

        .items-table-wrapper {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 1rem;
          /* Rolagem em vez de overflow hidden: no celular a tabela é mais
             larga que a tela, e o hidden não escondia elegantemente — cortava a
             última coluna, que na aba de lotes é justamente a situação do lote.
             A tabela rola dentro da própria caixa; a página, nunca. */
          overflow-x: auto;
          overflow-y: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.88rem;
        }

        .items-table th {
          background: #f8fafc;
          padding: 1rem;
          font-weight: 700;
          color: #475569;
          border-bottom: 2px solid #e2e8f0;
        }

        .items-table td {
          padding: 1.1rem 1rem;
          border-bottom: 1px solid #f1f5f9;
        }

        .items-table tr:last-child td {
          border-bottom: none;
        }

        .items-table tr.low-stock-tr { background: #fffbeb; }
        .items-table tr.negative-stock-tr { background: #fef2f2; }

        .name-col {
          font-weight: 700;
          color: #0f172a;
          font-size: 0.92rem;
        }

        .qty-col {
          font-weight: 800;
          color: #0f172a;
        }

        .notes-col {
          color: #64748b;
          font-style: italic;
        }

        .text-green { color: #16a34a; }
        .text-red { color: #dc2626; }

        /* STATUS BADGES */
        .status-label {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 0.25rem 0.6rem;
          border-radius: 9999px;
        }

        .status-ok { background: #dcfce7; color: #15803d; }
        .status-low { background: #fef3c7; color: #b45309; }
        .status-negative { 
          background: #fee2e2; 
          color: #b91c1c;
          animation: pulse-red 2s infinite;
        }

        .badge {
          display: inline-block;
          font-size: 0.72rem;
          font-weight: 800;
          padding: 0.2rem 0.5rem;
          border-radius: 9999px;
          text-transform: uppercase;
        }

        .badge-success { background: #dcfce7; color: #15803d; }
        .badge-error { background: #fee2e2; color: #b91c1c; }
        .badge-warning { background: #fef3c7; color: #b45309; }
        .badge-sale { background: #eff6ff; color: #1d4ed8; }
        .badge-nfe { background: #f3e8ff; color: #9333ea; border: 1px solid #d8b4fe; }

        /* ACTION BUTTONS */
        .action-buttons {
          display: flex;
          justify-content: flex-end;
          gap: 0.4rem;
        }

        .btn-action {
          padding: 0.45rem 0.85rem;
          font-size: 0.78rem;
          font-weight: 750;
          border-radius: 0.5rem;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }

        .btn-move { background: #eff6ff; color: #2563eb; }
        .btn-move:hover { background: #dbeafe; }
        .btn-delete { background: #fee2e2; color: #dc2626; display: flex; align-items: center; justify-content: center; padding: 0.45rem; }
        .btn-delete:hover { background: #fecaca; }

        /* NFE TAB CSS */
        .nfe-container {
          animation: fadeIn 0.4s ease-out;
        }

        .nfe-upload-zone {
          border: 2px dashed #cbd5e1;
          border-radius: 1rem;
          padding: 4rem 2rem;
          text-align: center;
          background: #f8fafc;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .nfe-upload-zone:hover {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .upload-icons {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        
        .text-blue-500 { color: #3b82f6; }
        .text-slate-400 { color: #94a3b8; }

        .nfe-upload-zone h3 { margin: 0 0 0.5rem 0; color: #0f172a; font-size: 1.25rem; font-weight: 800; }
        .nfe-upload-zone p { color: #64748b; margin: 0 0 1rem 0; font-size: 0.95rem; }
        
        .upload-hints {
          display: inline-block;
          background: white;
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          color: #94a3b8;
          border: 1px solid #e2e8f0;
        }

        .nfe-processing-zone {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 4rem 2rem;
          background: white;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          text-align: center;
        }

        .spinner.large {
          width: 60px;
          height: 60px;
          border-width: 4px;
        }

        .nfe-processing-zone h3 { margin: 1.5rem 0 0.5rem 0; color: #0f172a; }
        .nfe-processing-zone p { color: #64748b; }

        .nfe-results-card {
          background: white;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
        }

        .nfe-results-header {
          padding: 1.5rem;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .nfe-meta h4 {
          margin: 0 0 1rem 0;
          font-size: 1.1rem;
          color: #0f172a;
        }

        .nfe-meta p {
          margin: 0.25rem 0;
          font-size: 0.9rem;
          color: #475569;
        }

        .nfe-items-table-wrapper {
          padding: 1.5rem;
        }
        
        .nfe-items-table-wrapper h4 { margin: 0 0 1rem 0; }

        .nfe-items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }

        .nfe-items-table th {
          background: #f1f5f9;
          padding: 0.75rem;
          text-align: left;
          color: #475569;
          font-weight: 700;
        }

        .nfe-items-table td {
          padding: 0.75rem;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: middle;
        }

        .linking-col select {
          width: 100%;
          padding: 0.5rem;
          border-radius: 0.5rem;
          border: 1px solid #cbd5e1;
          font-size: 0.8rem;
          font-weight: 600;
          background: #f8fafc;
          outline: none;
        }
        
        .linking-col select.unlinked {
          border-color: #fbbf24;
          background: #fffbeb;
          color: #b45309;
        }
        
        .new-item-inline {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
        
        .new-item-inline input {
          flex: 1;
          padding: 0.4rem;
          border: 1px dashed #3b82f6;
          border-radius: 0.25rem;
          font-size: 0.8rem;
        }
        
        .new-item-inline .small-select {
          width: 60px;
          padding: 0.4rem;
        }

        .nfe-confirm-bar {
          padding: 1.5rem;
          background: #f8fafc;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: flex-end;
        }

        /* RECIPES CONFIG GRID & COVERAGE */
        .coverage-bar {
          background: white;
          padding: 1.25rem;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          margin-bottom: 1.25rem;
        }
        
        .coverage-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: #475569;
          margin-bottom: 0.75rem;
        }
        
        .coverage-track {
          height: 8px;
          background: #f1f5f9;
          border-radius: 9999px;
          overflow: hidden;
        }
        
        .coverage-fill {
          height: 100%;
          background: linear-gradient(to right, #3b82f6, #10b981);
          border-radius: 9999px;
          transition: width 1s ease-out;
        }

        .products-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1.25rem;
        }

        .product-recipe-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 1rem;
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
        }

        .card-header-prod {
          padding: 1.25rem;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .card-header-prod h3 { margin: 0.25rem 0 0 0; font-size: 1rem; font-weight: 800; color: #0f172a; }
        .prod-category { font-size: 0.65rem; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }

        .btn-configure {
          background: white;
          border: 1.5px solid #cbd5e1;
          color: #475569;
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.4rem 0.75rem;
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          transition: all 0.2s;
        }

        .btn-configure:hover { border-color: #2563eb; color: #2563eb; }

        .card-body-recipe { padding: 1.25rem; flex: 1; }
        .card-body-recipe h4 { margin: 0 0 0.75rem 0; font-size: 0.78rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.025em; }
        .no-ingredients { font-size: 0.8rem; color: #94a3b8; font-style: italic; margin: 0.5rem 0; line-height: 1.4; }

        .ingredients-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }

        .ingredients-list li {
          display: flex;
          justify-content: space-between;
          font-size: 0.82rem;
          color: #334155;
          padding-bottom: 0.45rem;
          border-bottom: 1px dashed #f1f5f9;
        }

        .ingredients-list li:last-child { border-bottom: none; padding-bottom: 0; }

        /* LOADING & EMPTY STATES */
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 5rem 2rem;
          background: white;
          border-radius: 1rem;
          border: 1px solid #e2e8f0;
          text-align: center;
        }

        .spinner {
          width: 40px;
          height: 40px;
          border: 3.5px solid #f1f5f9;
          border-top-color: #2563eb;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-bottom: 1.25rem;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem 2rem;
          background: white;
          border: 1px dashed #cbd5e1;
          border-radius: 1rem;
          text-align: center;
          color: #64748b;
        }

        .empty-state h3 { margin: 0.75rem 0 0.25rem 0; font-weight: 800; color: #334155; }
        .empty-state p { font-size: 0.85rem; margin: 0; }

        /* MODALS */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
        }

        .modal-card {
          background: white;
          border-radius: 1.25rem;
          width: 100%;
          max-width: 480px;
          padding: 1.75rem;
          position: relative;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          animation: slideUp 0.3s ease-out;
          max-height: 90vh;
          overflow-y: auto;
        }

        .modal-card.modal-large { max-width: 720px; }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .btn-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: none;
          border: none;
          cursor: pointer;
          color: #64748b;
          padding: 0.25rem;
          border-radius: 0.25rem;
        }

        .btn-close:hover { background: #f1f5f9; }

        .modal-card h2 { font-size: 1.25rem; font-weight: 900; color: #0f172a; margin: 0 0 1.25rem 0; }
        .modal-subtitle { font-size: 0.88rem; color: #475569; margin: -0.85rem 0 1.25rem 0; }

        .form-group { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1.15rem; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }

        .form-group label { font-size: 0.78rem; font-weight: 700; color: #475569; text-transform: uppercase; }

        .form-group input,
        .form-group select {
          padding: 0.7rem 0.85rem;
          border-radius: 0.5rem;
          border: 1.5px solid #cbd5e1;
          font-size: 0.88rem;
          font-weight: 600;
          outline: none;
          background: #f8fafc;
        }

        .form-group input:focus, .form-group select:focus { border-color: #2563eb; background: white; }

        .btn-submit {
          width: 100%;
          padding: 0.85rem;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: white;
          font-weight: 800;
          font-size: 0.95rem;
          border: none;
          border-radius: 0.65rem;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.2);
          transition: all 0.2s;
        }

        .btn-submit:hover:not(:disabled) {
          filter: brightness(1.08);
          box-shadow: 0 6px 14px rgba(37, 99, 235, 0.3);
        }

        .item-summary-badge {
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 0.65rem;
          padding: 0.75rem 1rem;
          font-size: 0.85rem;
          display: flex;
          justify-content: space-between;
          margin-bottom: 1.25rem;
        }

        .item-summary-badge span { color: #1e40af; }
        .item-summary-badge strong { color: #1e3a8a; }

        .radio-group-types { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .radio-label {
          flex: 1; min-width: 100px; display: flex; align-items: center; gap: 0.35rem;
          padding: 0.7rem 0.5rem; border: 1.5px solid #e2e8f0; border-radius: 0.5rem;
          font-size: 0.75rem; font-weight: 700; cursor: pointer; transition: all 0.2s;
          background: #f8fafc; justify-content: center;
        }
        .radio-label input { display: none; }
        .radio-label.selected { border-color: #2563eb; background: #eff6ff; color: #2563eb; }

        /* RECIPE EDITOR */
        .recipe-rows-container {
          max-height: 350px; overflow-y: auto; margin-bottom: 1.25rem;
          border: 1px solid #e2e8f0; border-radius: 0.75rem;
        }

        .recipe-editor-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        .recipe-editor-table th { background: #f8fafc; padding: 0.75rem 1rem; font-weight: 700; color: #475569; border-bottom: 1px solid #e2e8f0; text-align: left; }
        .recipe-editor-table td { padding: 0.75rem 1rem; border-bottom: 1px solid #f1f5f9; }
        
        .recipe-editor-table select, .recipe-editor-table input {
          width: 100%; padding: 0.6rem; border-radius: 0.38rem; border: 1.5px solid #cbd5e1;
          font-size: 0.82rem; font-weight: 600; outline: none;
        }

        .qty-input-unit { position: relative; display: flex; align-items: center; }
        .qty-input-unit input { padding-right: 2.25rem; }
        .unit-label { position: absolute; right: 0.6rem; font-size: 0.75rem; font-weight: 800; color: #64748b; pointer-events: none; }

        .btn-remove-row {
          background: none; border: none; color: #dc2626; cursor: pointer;
          padding: 0.4rem; border-radius: 0.38rem; display: flex; align-items: center; justify-content: center;
        }
        .btn-remove-row:hover { background: #fee2e2; }

        .recipe-footer-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }
        .btn-add-ingredient {
          border: 1.5px dashed #2563eb; background: none; color: #2563eb;
          font-weight: 700; font-size: 0.82rem; padding: 0.55rem 1.1rem; border-radius: 0.5rem;
          cursor: pointer; transition: all 0.2s;
        }
        .btn-add-ingredient:hover { background: #eff6ff; }

        .footer-right-buttons { display: flex; gap: 0.5rem; }
        
        .btn-secondary {
          background: #f1f5f9; color: #475569; border: none; padding: 0.6rem 1.25rem;
          border-radius: 0.5rem; font-weight: 700; font-size: 0.85rem; cursor: pointer;
          display: inline-flex; align-items: center; gap: 0.5rem;
        }
        .btn-secondary:hover, .btn-secondary.active { background: #e2e8f0; }
        
        .btn-secondary.active {
          background: #e0e7ff;
          color: #4f46e5;
        }

        .btn-submit-recipe {
          background: #2563eb; color: white; border: none; padding: 0.6rem 1.25rem;
          border-radius: 0.5rem; font-weight: 700; font-size: 0.85rem; cursor: pointer;
        }
        .btn-submit-recipe:hover { background: #1d4ed8; }

        @media (max-width: 768px) {
          .header-content { flex-direction: column; align-items: flex-start; }
          .header-actions { width: 100%; }
          .btn-primary { flex: 1; justify-content: center; }
          .form-row { grid-template-columns: 1fr; gap: 0; }
          .onboarding-banner { flex-direction: column; gap: 1rem; }
        }
      `}</style>
    </div>
  );
}
