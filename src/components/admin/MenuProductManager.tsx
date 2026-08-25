"use client";
import { useState, useEffect, useMemo } from "react";
import { ehProdutoDeIntegracao } from "@/lib/cardapio-interno";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit3, X, Image as ImageIcon, Pause, Play, Package, Monitor, Truck, Tablet, UtensilsCrossed, Search, ClipboardList, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronUp, ChevronsUp, ChevronsDown, Eye, Layers, Check, Sparkles } from "lucide-react";

const CHANNELS = [
  { key: "activePDV",      label: "PDV",      icon: "🖥️",  color: "#3B82F6", desc: "Atendimento no balcão/caixa" },
  { key: "activeDelivery", label: "Delivery", icon: "🛵",  color: "#10B981", desc: "Pedidos online pelo site" },
  { key: "activeTotem",    label: "Totem",    icon: "📲",  color: "#8B5CF6", desc: "Autoatendimento no totem" },
  { key: "activeGarcom",   label: "Garçom",   icon: "🍽️", color: "#F59E0B", desc: "Cardápio do garçom/mesa" },
];

function ChannelBadges({ product, onToggle }: { product: any; onToggle: (key: string, val: boolean) => void }) {
  return (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
      {CHANNELS.map(ch => {
        const active = product[ch.key] ?? false;
        return (
          <button key={ch.key} onClick={() => onToggle(ch.key, !active)} title={ch.desc}
            style={{
              padding: "2px 8px", borderRadius: "20px", fontSize: "0.68rem", fontWeight: 700,
              border: `1.5px solid ${active ? ch.color : "#E2E8F0"}`,
              background: active ? ch.color + "18" : "#F8FAFC",
              color: active ? ch.color : "#94A3B8",
              cursor: "pointer", transition: "all 0.15s",
            }}>
            {ch.icon} {ch.label}
          </button>
        );
      })}
    </div>
  );
}

export default function MenuProductManager({
  products,
  availableItems,
  categories: initialCategories = [],
}: {
  products: any[];
  availableItems: any[];
  categories?: { id: string; name: string; emoji: string; color: string; sortOrder: number }[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"all" | "items" | "combos">("all");

  // Helper para identificar categorias de integração ocultas
  /**
   * Categoria que só existe por causa de integração — não é cardápio.
   *
   * Passa a usar a regra única de src/lib/cardapio-interno.ts, em vez da lista
   * local que havia aqui. A lista daqui escondia também COMPLEMENTO, OPCIONAL,
   * ADICIONAL, INSUMO e OCULTO, e escondia por PALAVRA: a Brasa Burguer tem uma
   * categoria de verdade chamada "Complementos", que o cliente vê e pede, e ela
   * sumia inteira do painel — a batata aparecia para quem compra e não aparecia
   * para quem precisa editar.
   *
   * A regra que vale é simples: se o cliente consegue pedir, a loja consegue
   * editar. E manter a lista num arquivo só evita que a próxima integração
   * entre em três telas e esqueça a quarta — que foi como esta divergiu.
   */
  const isIntegrationCategory = (catName: string) => ehProdutoDeIntegracao(catName);

  // Categorias dinâmicas (inicia com as do servidor combinadas com quaisquer categorias presentes nos produtos)
  const [dynCategories, setDynCategories] = useState(() => {
    const existingMap = new Map((initialCategories || []).map(c => [(c.name || "").toLowerCase().trim(), c]));
    const list = [...(initialCategories || [])];
    (products || []).forEach(p => {
      const catName = (p.category || "").trim();
      if (!catName || isIntegrationCategory(catName)) return;
      if (!existingMap.has(catName.toLowerCase())) {
        const newCat = {
          id: `virtual-${catName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
          name: catName,
          emoji: "🍽️",
          color: "#64748B",
          sortOrder: list.length,
        };
        list.push(newCat);
        existingMap.set(catName.toLowerCase(), newCat);
      }
    });
    return list;
  });

  // Re-sincronizar categorias sempre que initialCategories ou products mudarem
  useEffect(() => {
    setDynCategories(prev => {
      const existingMap = new Map(prev.map(c => [(c.name || "").toLowerCase().trim(), c]));
      let next = [...prev];
      let changed = false;

      (initialCategories || []).forEach(ic => {
        const key = (ic.name || "").toLowerCase().trim();
        if (!key) return;
        if (!existingMap.has(key)) {
          next.push(ic);
          existingMap.set(key, ic);
          changed = true;
        } else {
          // Atualizar dados se existentes
          const cur = existingMap.get(key);
          if (cur && cur.id?.startsWith("virtual-") && ic.id && !ic.id.startsWith("virtual-")) {
            const idx = next.findIndex(c => (c.name || "").toLowerCase().trim() === key);
            if (idx !== -1) {
              next[idx] = ic;
              changed = true;
            }
          }
        }
      });

      (products || []).forEach(p => {
        const catName = (p.category || "").trim();
        if (!catName || isIntegrationCategory(catName)) return;
        const key = catName.toLowerCase();
        if (!existingMap.has(key)) {
          const newCat = {
            id: `virtual-${catName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
            name: catName,
            emoji: "🍽️",
            color: "#64748B",
            sortOrder: next.length,
          };
          next.push(newCat);
          existingMap.set(key, newCat);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [initialCategories, products]);

  // Reordenação de Categorias (Modal & Inline)
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [reorderList, setReorderList] = useState<any[]>([]);
  const [savingReorder, setSavingReorder] = useState(false);
  /** Categoria aberta na tela de reordenar (só uma por vez, para não virar sopa). */
  const [expandedReorderCat, setExpandedReorderCat] = useState<string | null>(null);
  /** Produtos por categoria, em edição. Chave = nome da categoria em minúsculas. */
  const [reorderProducts, setReorderProducts] = useState<Record<string, any[]>>({});
  /** Só as categorias mexidas vão para o banco — salvar o cardápio inteiro seria centenas de updates à toa. */
  const [categoriasMexidas, setCategoriasMexidas] = useState<Set<string>>(new Set());
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [editingCat, setEditingCat] = useState<{ id: string; name: string } | null>(null);
  const [savingRename, setSavingRename] = useState(false);

  // Mini-modal de nova categoria
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("🍽️");
  const [newCatColor, setNewCatColor] = useState("#E8360C");
  const [newCatSaving, setNewCatSaving] = useState(false);

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setNewCatSaving(true);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim(), emoji: newCatEmoji, color: newCatColor }),
      });
      if (res.ok) {
        const created = await res.json();
        setDynCategories(prev => [...prev, created]);
        setCategory(created.name);
        setShowNewCat(false);
        setNewCatName(""); setNewCatEmoji("🍽️"); setNewCatColor("#E8360C");
        showToast("Categoria criada!");
      } else {
        showToast("Erro ao criar categoria", "#EF4444");
      }
    } catch {
      showToast("Erro ao criar categoria", "#EF4444");
    } finally {
      setNewCatSaving(false);
    }
  };

  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<"file" | "url">("file");
  const [uploadingImage, setUploadingImage] = useState(false);

  /**
   * Reduz a imagem no navegador antes de enviar.
   * As fotos que estavam no cardapio eram PNG 1024x1024 sem compressao, ~1,8 MB
   * CADA. Card de produto renderiza em ~200px, entao 900px de largura com JPEG
   * de qualidade 0,82 e mais que suficiente e derruba o peso em ~95%.
   */
  const comprimirImagem = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 900;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const escala = Math.min(MAX / width, MAX / height);
          width = Math.round(width * escala);
          height = Math.round(height * escala);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas indisponível"));
        // Fundo branco: JPEG não tem transparência, e PNG com alpha viraria preto.
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Falha ao comprimir"))),
          "image/jpeg",
          0.82
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler a imagem"));
      };
      img.src = url;
    });

  /**
   * ANTES: readAsDataURL gravava a imagem inteira em base64 dentro da coluna
   * imageUrl. O cardapio publico chegou a 18,7 MB, sendo 18,5 MB só de 10 fotos
   * — por isso balcao, mesa e cardapio demoravam a abrir. Agora a foto e
   * comprimida e enviada para /api/upload; no banco fica só a URL.
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert("A imagem selecionada é muito grande (máximo 8MB).");
      return;
    }

    setUploadingImage(true);
    try {
      const comprimida = await comprimirImagem(file);

      const fd = new FormData();
      fd.append("file", new File([comprimida], `${Date.now()}.jpg`, { type: "image/jpeg" }));
      fd.append("type", "produtos");

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Falha no envio da imagem");
      }

      setImageUrl(data.url);
      const kb = Math.round((data.size || comprimida.size) / 1024);
      showToast(`📷 Foto enviada (${kb} KB)`);
    } catch (err: any) {
      alert(err?.message || "Erro ao enviar a imagem.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteCategory = async (catId: string, catName: string) => {
    if (!confirm(`Tem certeza que deseja excluir a categoria "${catName}"?`)) return;
    setDeletingCatId(catId);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: catId }),
      });
      if (res.ok) {
        setDynCategories(prev => prev.filter(c => c.id !== catId));
        if (category === catName) {
          const nextCat = dynCategories.find(c => c.id !== catId)?.name || "";
          setCategory(nextCat);
        }
        showToast(`🗑️ Categoria "${catName}" excluída!`);
      } else {
        showToast("Erro ao excluir categoria", "#EF4444");
      }
    } catch {
      showToast("Erro ao excluir categoria", "#EF4444");
    } finally {
      setDeletingCatId(null);
    }
  };

  const openReorderModal = () => {
    // Garantir lista completa de todas as categorias existentes
    const existingMap = new Map(dynCategories.map(c => [(c.name || "").toLowerCase().trim(), c]));
    const fullList = [...dynCategories];
    (products || []).forEach(p => {
      const catName = (p.category || "").trim();
      if (!catName || isIntegrationCategory(catName)) return;
      const key = catName.toLowerCase();
      if (!existingMap.has(key)) {
        const newCat = {
          id: `virtual-${catName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
          name: catName,
          emoji: "🍽️",
          color: "#64748B",
          sortOrder: fullList.length,
        };
        fullList.push(newCat);
        existingMap.set(key, newCat);
      }
    });

    setReorderList(fullList);

    // Fotografa os produtos de cada categoria na ordem em que estão hoje. A
    // edição acontece toda nessa cópia; o banco só é tocado no Salvar, e só nas
    // categorias que a pessoa realmente abriu e mexeu.
    const porCategoria: Record<string, any[]> = {};
    (products || []).forEach(p => {
      if (isHiddenIntegrationItem(p)) return;
      const chave = (p.category || "").toLowerCase().trim();
      if (!porCategoria[chave]) porCategoria[chave] = [];
      porCategoria[chave].push(p);
    });
    setReorderProducts(porCategoria);
    setCategoriasMexidas(new Set());
    setExpandedReorderCat(null);
    setShowReorderModal(true);
  };

  /** Move um produto dentro da própria categoria. */
  const moveProductInCat = (catName: string, fromIdx: number, toIdx: number) => {
    const chave = catName.toLowerCase().trim();
    const lista = reorderProducts[chave] || [];
    if (toIdx < 0 || toIdx >= lista.length) return;

    const atualizada = [...lista];
    const item = atualizada.splice(fromIdx, 1)[0];
    atualizada.splice(toIdx, 0, item);

    setReorderProducts(prev => ({ ...prev, [chave]: atualizada }));
    setCategoriasMexidas(prev => new Set(prev).add(chave));
  };

  /** Volta a categoria para a ordem alfabética — o padrão de quem nunca mexeu. */
  const resetProductOrder = (catName: string) => {
    const chave = catName.toLowerCase().trim();
    const lista = [...(reorderProducts[chave] || [])].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "pt-BR")
    );
    setReorderProducts(prev => ({ ...prev, [chave]: lista }));
    setCategoriasMexidas(prev => new Set(prev).add(chave));
  };

  const moveReorderItem = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= reorderList.length) return;
    const updated = [...reorderList];
    const item = updated.splice(fromIdx, 1)[0];
    updated.splice(toIdx, 0, item);
    setReorderList(updated);
  };

  const moveReorderToTop = (idx: number) => {
    if (idx <= 0) return;
    moveReorderItem(idx, 0);
  };

  const moveReorderToBottom = (idx: number) => {
    if (idx >= reorderList.length - 1) return;
    moveReorderItem(idx, reorderList.length - 1);
  };

  // ─── ARRASTAR PARA REORDENAR ────────────────────────────────────────────
  /**
   * O que está sendo arrastado agora: em qual das duas listas e em que posição.
   *
   * A posição muda DURANTE o arrasto: quando o dedo (ou o mouse) passa por cima
   * de outra linha, a lista já se reordena de verdade e `idx` acompanha o item.
   * É o que faz a lista se mexer embaixo do dedo em vez de só desenhar uma
   * linha de destino e reordenar no soltar.
   */
  const [arrasto, setArrasto] = useState<{ lista: "categoria" | "produto"; idx: number } | null>(null);

  /**
   * Enquanto arrasta, os ouvintes ficam na JANELA, não na linha.
   *
   * Preso à linha, o arrasto morreria assim que o ponteiro saísse dela — que é
   * exatamente o que acontece ao arrastar rápido. Na janela, o gesto continua
   * mesmo com o ponteiro fora de qualquer linha, e só termina no soltar.
   */
  useEffect(() => {
    if (!arrasto) return;

    const chaveAberta = expandedReorderCat;

    const aoMover = (e: PointerEvent) => {
      const sob = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const linha = sob?.closest("[data-ordem-idx]") as HTMLElement | null;
      if (!linha) return;
      if (linha.getAttribute("data-ordem-lista") !== arrasto.lista) return;

      const destino = Number(linha.getAttribute("data-ordem-idx"));
      if (!Number.isFinite(destino) || destino === arrasto.idx) return;

      if (arrasto.lista === "categoria") {
        moveReorderItem(arrasto.idx, destino);
      } else {
        const cat = reorderList.find(c => (c.name || "").toLowerCase().trim() === chaveAberta);
        if (!cat) return;
        moveProductInCat(cat.name, arrasto.idx, destino);
      }
      setArrasto({ lista: arrasto.lista, idx: destino });
    };

    const aoSoltar = () => setArrasto(null);

    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
    return () => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrasto, expandedReorderCat, reorderList, reorderProducts]);

  const handleSaveReorder = async (listToSave = reorderList) => {
    setSavingReorder(true);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedCategories: listToSave.map((c, idx) => ({
            id: c.id && !c.id.startsWith("virtual-") ? c.id : undefined,
            name: c.name,
            emoji: c.emoji || "🍽️",
            color: c.color || "#64748B",
            sortOrder: idx,
          })),
          orderedIds: listToSave.map(c => c.id).filter(id => id && !id.startsWith("virtual-")),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.categories && Array.isArray(data.categories)) {
          setDynCategories(data.categories);
        } else {
          setDynCategories(listToSave);
        }

        // Ordem dos produtos, só das categorias que foram mexidas. Uma categoria
        // que falhar não impede as outras: o aviso diz quais não entraram, em
        // vez de dizer "erro" e deixar a pessoa sem saber o que salvou.
        const falhas: string[] = [];
        for (const chave of Array.from(categoriasMexidas)) {
          const lista = reorderProducts[chave] || [];
          const ids = lista.map(p => p.id).filter(Boolean);
          if (ids.length === 0) continue;
          try {
            const r = await fetch("/api/admin/menu-products", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderedIds: ids }),
            });
            if (!r.ok) falhas.push(chave);
          } catch {
            falhas.push(chave);
          }
        }

        setShowReorderModal(false);
        if (falhas.length > 0) {
          showToast(`Ordem salva, mas ${falhas.length} categoria(s) falharam`, "#F59E0B");
        } else {
          showToast("✅ Ordem do cardápio salva com sucesso!");
        }
        router.refresh();
      } else {
        showToast("Erro ao salvar ordem", "#EF4444");
      }
    } catch {
      showToast("Erro ao salvar ordem", "#EF4444");
    } finally {
      setSavingReorder(false);
    }
  };

  const handleMoveCategoryDirect = async (catName: string, direction: "up" | "down") => {
    const currentIdx = dynCategories.findIndex(c => (c.name || "").toLowerCase().trim() === catName.toLowerCase().trim());
    if (currentIdx === -1) return;
    const targetIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
    if (targetIdx < 0 || targetIdx >= dynCategories.length) return;
    const newCats = [...dynCategories];
    const temp = newCats[currentIdx];
    newCats[currentIdx] = newCats[targetIdx];
    newCats[targetIdx] = temp;
    setDynCategories(newCats);
    await handleSaveReorder(newCats);
  };

  const handleRenameCategory = async () => {
    if (!editingCat || !editingCat.name.trim()) return;
    setSavingRename(true);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingCat.id, name: editingCat.name.trim() }),
      });
      if (res.ok) {
        setDynCategories(prev => prev.map(c => c.id === editingCat.id ? { ...c, name: editingCat.name.trim() } : c));
        setEditingCat(null);
        showToast("✅ Categoria renomeada com sucesso!");
        router.refresh();
      } else {
        showToast("Erro ao renomear", "#EF4444");
      }
    } catch {
      showToast("Erro ao renomear", "#EF4444");
    } finally {
      setSavingRename(false);
    }
  };

  const toggleCollapse = (catId: string) => {
    setCollapsedCats(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Modal de confirmação customizado
  const [confirmModal, setConfirmModal] = useState<{ id: string; name: string; affectedCombos?: any[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [softDeletedName, setSoftDeletedName] = useState<string | null>(null);

  // Smart Pause — pausar item que está em combos
  const [pauseModal, setPauseModal] = useState<{ id: string; name: string; affectedCombos: any[]; newActive: boolean } | null>(null);
  const [pausing, setPausing] = useState(false);

  const handleDelete = (id: string, name: string) => {
    setDeleteConfirmText("");
    const product = products.find(p => p.id === id);
    let affectedCombos: any[] = [];
    if (product && !product.isCombo) {
      affectedCombos = products.filter(comb =>
        comb.isCombo &&
        comb.comboGroups?.some((g: any) =>
          g.items?.some((i: any) => i.menuProduct?.id === id || i.menuProductId === id)
        )
      );
    }
    setConfirmModal({ id, name, affectedCombos });
  };
  const [toastMsg, setToastMsg] = useState<{ text: string; color: string } | null>(null);

  const showToast = (text: string, color = "#10B981") => {
    setToastMsg({ text, color });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const WEEKDAYS = [
    { key: "SEG", label: "Seg", full: "Segunda-feira" },
    { key: "TER", label: "Ter", full: "Terça-feira" },
    { key: "QUA", label: "Qua", full: "Quarta-feira" },
    { key: "QUI", label: "Qui", full: "Quinta-feira" },
    { key: "SEX", label: "Sex", full: "Sexta-feira" },
    { key: "SAB", label: "Sáb", full: "Sábado" },
    { key: "DOM", label: "Dom", full: "Domingo" },
  ];

  const [availableDaysMode, setAvailableDaysMode] = useState<"all" | "specific">("all");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("Esfihas Salgadas");
  const [imageUrl, setImageUrl] = useState("");
  const [active, setActive] = useState(true);
  const [cost, setCost] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isCombo, setIsCombo] = useState(false);
  const [isBeverage, setIsBeverage] = useState(false);
  const [activePDV, setActivePDV] = useState(true);
  const [activeDelivery, setActiveDelivery] = useState(true);
  const [activeTotem, setActiveTotem] = useState(true);
  const [activeGarcom, setActiveGarcom] = useState(true);
  const [comboGroups, setComboGroups] = useState<{ title: string; maxQty: number; minQty: number | null; items: { id: string; additionalPrice: number; maxPerItem: number | null; optionNote: string | null }[] }[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("TODAS");

  // === FICHA TÉCNICA (Recipe) State ===
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipeProductId, setRecipeProductId] = useState<string | null>(null);
  const [recipeProductName, setRecipeProductName] = useState("");
  const [recipeStockItems, setRecipeStockItems] = useState<Array<{ id: string; name: string; unit: string }>>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<Array<{ stockItemId: string; quantityConsumed: string; newItemName: string; newItemUnit: string }>>([]);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [productsWithRecipe, setProductsWithRecipe] = useState<Set<string>>(new Set());

  // Load which products have recipes configured (on mount)
  useEffect(() => {
    fetch("/api/store/estoque/recipes")
      .then(r => r.json())
      .then(data => {
        if (data.success && data.menuProducts) {
          const withRecipe = new Set<string>();
          data.menuProducts.forEach((p: any) => {
            if (p.recipeItems && p.recipeItems.length > 0) withRecipe.add(p.id);
          });
          setProductsWithRecipe(withRecipe);
        }
      })
      .catch(() => {});
  }, []);

  const openRecipeModal = async (productId: string, productName: string) => {
    setRecipeProductId(productId);
    setRecipeProductName(productName);
    setRecipeLoading(true);
    setShowRecipeModal(true);
    try {
      const res = await fetch(`/api/store/estoque/recipes?menuProductId=${productId}`);
      const data = await res.json();
      if (data.success) {
        setRecipeStockItems(data.stockItems || []);
        const existing = (data.recipe || []).map((r: any) => ({
          stockItemId: r.stockItemId,
          quantityConsumed: String(r.quantityConsumed),
          newItemName: "",
          newItemUnit: "g",
        }));
        setRecipeIngredients(existing.length > 0 ? existing : [{ stockItemId: "", quantityConsumed: "", newItemName: "", newItemUnit: "g" }]);
      }
    } catch {
      showToast("Erro ao carregar ficha técnica", "#EF4444");
    } finally {
      setRecipeLoading(false);
    }
  };

  const handleSaveRecipe = async () => {
    if (!recipeProductId) return;
    setRecipeSaving(true);
    try {
      const validIngredients = recipeIngredients.filter(
        ri => (ri.stockItemId || ri.stockItemId === 'NEW') && parseFloat(ri.quantityConsumed) > 0
      );
      if (validIngredients.length === 0) {
        showToast("Adicione pelo menos um ingrediente", "#EF4444");
        setRecipeSaving(false);
        return;
      }
      const res = await fetch("/api/store/estoque/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menuProductId: recipeProductId,
          ingredients: validIngredients.map(ri => ({
            stockItemId: ri.stockItemId,
            quantityConsumed: parseFloat(ri.quantityConsumed),
            newItemName: ri.newItemName?.trim() || undefined,
            newItemUnit: ri.newItemUnit || "g",
          })),
        }),
      });
      if (res.ok) {
        showToast("✅ Ficha técnica salva!");
        setShowRecipeModal(false);
        setProductsWithRecipe(prev => new Set([...prev, recipeProductId!]));
      } else {
        const d = await res.json();
        showToast(d.error || "Erro ao salvar", "#EF4444");
      }
    } catch {
      showToast("Erro ao salvar ficha técnica", "#EF4444");
    } finally {
      setRecipeSaving(false);
    }
  };

  const handleToggleDestaque = async (p: any) => {
    try {
      let currentTags: string[] = [];
      try { currentTags = p.tags ? JSON.parse(p.tags) : []; } catch { currentTags = []; }
      const hasDestaque = currentTags.some(t => t.includes("Destaque"));
      const newTags = hasDestaque
        ? currentTags.filter(t => !t.includes("Destaque"))
        : [...currentTags, "⭐ Destaque"];

      const res = await fetch("/api/admin/menu-products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, tags: newTags.length > 0 ? newTags : null }),
      });
      if (res.ok) {
        showToast(hasDestaque ? `Item removido dos destaques` : `⭐ "${p.name}" marcado como Destaque da Casa!`);
        router.refresh();
      }
    } catch {
      showToast("Erro ao atualizar destaque", "#EF4444");
    }
  };


  const resetForm = () => {
    setName(""); setDescription(""); setPrice(""); setCost(""); setTags([]);
    setCategory(dynCategories[0]?.name || "");
    setImageUrl(""); setActive(true); setIsCombo(false); setIsBeverage(false); setComboGroups([]);
    setActivePDV(true); setActiveDelivery(true); setActiveTotem(true); setActiveGarcom(true);
    setAvailableDaysMode("all"); setSelectedDays([]);
    setNovaOpcao(null); setSeletorAberto(null); setBuscaOpcao("");
    setShowForm(false); setEditingId(null);
  };

  const openEdit = (p: any) => {
    setName(p.name); setDescription(p.description); setPrice(String(p.price));
    setCost(p.cost != null && p.cost > 0 ? String(p.cost) : "");
    try { setTags(p.tags ? JSON.parse(p.tags) : []); } catch { setTags([]); }
    
    let parsedDays: string[] = [];
    try {
      if (p.availableDays) {
        parsedDays = typeof p.availableDays === "string" ? JSON.parse(p.availableDays) : p.availableDays;
      }
    } catch {}
    if (parsedDays && Array.isArray(parsedDays) && parsedDays.length > 0) {
      setAvailableDaysMode("specific");
      setSelectedDays(parsedDays);
    } else {
      setAvailableDaysMode("all");
      setSelectedDays([]);
    }

    setCategory(p.category); setImageUrl(p.imageUrl || ""); setActive(p.active);
    setIsCombo(p.isCombo); setIsBeverage(p.isBeverage ?? false);
    setActivePDV(p.activePDV ?? true);
    setActiveDelivery(p.activeDelivery ?? true);
    setActiveTotem(p.activeTotem ?? true);
    setActiveGarcom(p.activeGarcom ?? true);
    if (p.isCombo && p.comboGroups) {
      setComboGroups(p.comboGroups.map((g: any) => ({
        title: g.title, maxQty: g.maxQty,
        // Nulo tem significado (= regra antiga, exige exatamente maxQty) e por
        // isso não vira 0 aqui: carregar como 0 transformaria todo grupo antigo
        // em opcional no primeiro salvamento pela tela.
        minQty: g.minQty === null || g.minQty === undefined ? null : Number(g.minQty),
        items: (g.items || []).map((i: any) => ({
          id: i.menuProduct?.id || i.menuProductId || i.id,
          additionalPrice: Number(i.additionalPrice) || 0,
          maxPerItem: i.maxPerItem === null || i.maxPerItem === undefined ? null : Number(i.maxPerItem),
          optionNote: i.optionNote ?? null,
        }))
      })));
    } else { setComboGroups([]); }
    setNovaOpcao(null); setSeletorAberto(null); setBuscaOpcao("");
    setEditingId(p.id); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!name || !description || !price) { alert("Preencha nome, descrição e preço."); return; }
    if (dynCategories.length === 0) { alert("Cadastre pelo menos uma categoria antes de salvar."); return; }
    if (!category || category.trim() === "") { alert("Selecione uma categoria válida."); return; }
    setLoading(true);

    try {
      const availableDaysPayload = availableDaysMode === "specific" && selectedDays.length > 0 ? selectedDays : null;

      const res = await fetch("/api/admin/menu-products", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId, name, description, price: parseFloat(price),
          cost: cost ? parseFloat(cost) : 0,
          tags: tags.length > 0 ? tags : null,
          availableDays: availableDaysPayload,
          category,
          imageUrl: imageUrl || null, active, isCombo, isBeverage,
          activePDV, activeDelivery, activeTotem, activeGarcom,
          comboGroups: isCombo ? comboGroups : undefined
        })
      });
      if (res.ok) { resetForm(); router.refresh(); } else alert("Erro ao salvar.");
    } catch { alert("Erro."); }
    finally { setLoading(false); }
  };



  const confirmDelete = async () => {
    if (!confirmModal) return;
    setDeleting(true);
    const res = await fetch("/api/admin/menu-products", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: confirmModal.id, name: confirmModal.name })
    });
    const data = await res.json();
    setDeleting(false);
    setConfirmModal(null);
    if (data.softDeleted) {
      // Mostrar aviso suave (não precisa de alert nativo)
      setSoftDeletedName(confirmModal.name);
      setTimeout(() => setSoftDeletedName(null), 4000);
    }
    router.refresh();
  };

  const handleToggle = (id: string, cur: boolean) => {
    const product = products.find(p => p.id === id);
    const newActive = !cur;

    // Se estiver PAUSANDO um item avulso, verificar se há combos que o contêm
    if (!newActive && product && !product.isCombo) {
      const affectedCombos = products.filter(p =>
        p.isCombo &&
        p.comboGroups?.some((g: any) =>
          g.items?.some((i: any) => i.menuProduct?.id === id || i.menuProductId === id)
        )
      );
      if (affectedCombos.length > 0) {
        setPauseModal({ id, name: product.name, affectedCombos, newActive });
        return;
      }
    }
    // Sem combos afetados: toggle direto
    doToggle(id, newActive);
  };

  const doToggle = async (id: string, newActive: boolean, alsoComboIds?: string[]) => {
    setPausing(true);
    await fetch("/api/admin/menu-products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active: newActive })
    });
    if (alsoComboIds && alsoComboIds.length > 0) {
      await Promise.all(alsoComboIds.map(cid =>
        fetch("/api/admin/menu-products", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: cid, active: newActive })
        })
      ));
    }
    setPausing(false);
    setPauseModal(null);
    router.refresh();
  };

  // Toggle de canal diretamente na lista (sem abrir form)
  const handleChannelToggle = async (id: string, channelKey: string, val: boolean) => {
    await fetch("/api/admin/menu-products", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [channelKey]: val })
    });
    router.refresh();
  };

  const addGroup = () => setComboGroups(prev => [...prev, { title: "", maxQty: 1, minQty: 1, items: [] }]);
  const removeGroup = (idx: number) => setComboGroups(prev => prev.filter((_, i) => i !== idx));
  const updateGroup = (idx: number, key: string, val: any) => {
    setComboGroups(prev => prev.map((g, i) => i === idx ? { ...g, [key]: val } : g));
  };
  const addGroupItem = (gIdx: number, itemId: string) => {
    if (!itemId) return;
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      if (g.items.some((it: any) => it.id === itemId)) return g;
      return { ...g, items: [...g.items, { id: itemId, additionalPrice: 0, maxPerItem: null, optionNote: null }] };
    }));
  };
  const removeGroupItem = (gIdx: number, itemId: string) => {
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      return { ...g, items: g.items.filter((it: any) => it.id !== itemId) };
    }));
  };
  const updateGroupItemPrice = (gIdx: number, itemId: string, price: number) => {
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      return {
        ...g,
        items: g.items.map((it: any) => it.id === itemId ? { ...it, additionalPrice: price } : it)
      };
    }));
  };
  const updateGroupItemField = (gIdx: number, itemId: string, key: string, val: any) => {
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      return {
        ...g,
        items: g.items.map((it: any) => it.id === itemId ? { ...it, [key]: val } : it)
      };
    }));
  };

  // ─── PERGUNTAS DO COMBO ─────────────────────────────────────────────────
  // Estado da tela nova. Antes só dava para escolher item que JÁ existia no
  // cardápio: para pôr um "Adicional de Catupiry" no combo, a loja tinha que
  // abandonar o formulário, cadastrar o produto e voltar a montar o combo do
  // zero. Agora cadastra ali mesmo.

  /** Formulário de item novo aberto neste grupo (índice). */
  const [novaOpcao, setNovaOpcao] = useState<{ gIdx: number; nome: string; acrescimo: string; obs: string } | null>(null);
  const [salvandoOpcao, setSalvandoOpcao] = useState(false);
  /** Seletor de item existente aberto neste grupo, com a busca digitada. */
  const [seletorAberto, setSeletorAberto] = useState<number | null>(null);
  const [buscaOpcao, setBuscaOpcao] = useState("");
  /**
   * Itens criados sem sair da tela. `availableItems` chega por prop e só se
   * renova no router.refresh() — sem esta lista, o item recém-criado apareceria
   * como "Item excluído do cardápio" até a página recarregar.
   */
  const [opcoesCriadas, setOpcoesCriadas] = useState<any[]>([]);

  /**
   * Cardápio + o que foi criado agora, sem repetição.
   *
   * A deduplicação por id importa: depois do router.refresh() o item criado
   * volta dentro de `availableItems` e continua em `opcoesCriadas`. Seriam dois
   * registros com o mesmo id na mesma lista — duas linhas idênticas no seletor
   * e aviso de chave duplicada no React.
   */
  const catalogoDeOpcoes = useMemo(() => {
    const porId = new Map<string, any>();
    for (const p of [...availableItems, ...opcoesCriadas]) {
      if (p?.id) porId.set(String(p.id), p);
    }
    return [...porId.values()];
  }, [availableItems, opcoesCriadas]);

  const moverGrupo = (idx: number, passo: number) => {
    setComboGroups(prev => {
      const destino = idx + passo;
      if (destino < 0 || destino >= prev.length) return prev;
      const copia = [...prev];
      [copia[idx], copia[destino]] = [copia[destino], copia[idx]];
      return copia;
    });
  };

  const moverItemDoGrupo = (gIdx: number, itemId: string, passo: number) => {
    setComboGroups(prev => prev.map((g, i) => {
      if (i !== gIdx) return g;
      const pos = g.items.findIndex((it: any) => it.id === itemId);
      const destino = pos + passo;
      if (pos < 0 || destino < 0 || destino >= g.items.length) return g;
      const itens = [...g.items];
      [itens[pos], itens[destino]] = [itens[destino], itens[pos]];
      return { ...g, items: itens };
    }));
  };

  /**
   * Cadastra a opção e já pendura na pergunta.
   *
   * Nasce com preço ZERO de propósito: o que a loja cobra por um adicional é o
   * acréscimo do ComboGroupItem, não o preço de tabela do produto. Preço zero é
   * também o que mantém a opção fora dos cardápios de venda — `idsSoDeOpcaoDeCombo`
   * esconde exatamente isso, e é o que impede que "Adicional de Catupiry" vire
   * um card de R$ 0,00 na tela do garçom.
   */
  const criarOpcaoNaHora = async () => {
    if (!novaOpcao) return;
    const nome = novaOpcao.nome.trim();
    if (!nome) { alert("Dê um nome ao item."); return; }

    setSalvandoOpcao(true);
    try {
      const categoriaDeOpcoes =
        dynCategories.find(c => c.name.trim().toLowerCase() === "adicionais")?.name || "Adicionais";

      const res = await fetch("/api/admin/menu-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          description: novaOpcao.obs.trim() || nome,
          price: 0,
          category: categoriaDeOpcoes,
          active: true,
          isCombo: false,
          isBeverage: false,
        }),
      });
      if (!res.ok) { alert("Não consegui cadastrar o item."); return; }

      const criado = await res.json();
      if (!criado?.id) { alert("O item foi criado mas voltou sem id."); return; }

      setOpcoesCriadas(prev => [...prev, criado]);

      const acrescimo = parseFloat(novaOpcao.acrescimo.replace(",", ".")) || 0;
      const gIdx = novaOpcao.gIdx;
      setComboGroups(prev => prev.map((g, i) => {
        if (i !== gIdx) return g;
        if (g.items.some((it: any) => it.id === criado.id)) return g;
        return { ...g, items: [...g.items, { id: criado.id, additionalPrice: acrescimo, maxPerItem: null, optionNote: null }] };
      }));

      // Mantém o formulário aberto: quem cadastra adicional cadastra vários
      // seguidos, e fechar a cada um obrigaria a reabrir quatro vezes.
      setNovaOpcao({ gIdx, nome: "", acrescimo: "", obs: "" });
    } catch {
      alert("Não consegui cadastrar o item.");
    } finally {
      setSalvandoOpcao(false);
    }
  };

  const isHiddenIntegrationItem = (p: any) => {
    const cat = (p.category || "").trim();
    if (isIntegrationCategory(cat)) return true;

    // Fora as de integração, quem manda é o cadastro de categorias da loja.
    if (dynCategories && dynCategories.length > 0) {
      const validCatNames = new Set(dynCategories.map((c: any) => (c.name || "").toUpperCase().trim()));
      return !validCatNames.has(cat.toUpperCase());
    }
    return false;
  };

  const itemProducts = products.filter(p => !p.isCombo && !isHiddenIntegrationItem(p));
  const comboProducts = products.filter(p => p.isCombo && !isHiddenIntegrationItem(p));
  const noPhotoCount = products.filter(p => !p.imageUrl && !isHiddenIntegrationItem(p)).length;

  const handleCleanNoPhoto = async () => {
    if (!confirm("Deseja excluir todos os produtos que não possuem foto? (Eles serão removidos do cardápio e desvinculados de todos os combos automaticamente)")) return;
    try {
      const res = await fetch("/api/admin/clean-no-photo-products");
      const data = await res.json();
      if (data.ok) {
        showToast(`✅ ${data.count} produtos sem foto foram excluídos!`, "#10B981");
        router.refresh();
      } else {
        alert("Erro ao excluir: " + (data.error || "tente novamente"));
      }
    } catch {
      alert("Erro ao processar exclusão.");
    }
  };

  return (
    <div>
      {/* ===== MODAL DE CONFIRMAÇÃO CUSTOMIZADO ===== */}
      {confirmModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: "16px",
            padding: "2rem", maxWidth: "420px", width: "92%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            border: "1px solid #E2E8F0",
          }}>
            {/* Ícone */}
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(239,68,68,0.1)", border: "2px solid #EF4444",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.5rem",
              }}>🗑️</div>
            </div>

            <h3 style={{ textAlign: "center", fontWeight: 800, fontSize: "1.1rem", marginBottom: "0.4rem", color: "#111827" }}>
              Excluir produto permanentemente?
            </h3>
            <p style={{ textAlign: "center", color: "#6B7280", fontSize: "0.88rem", marginBottom: "1rem", lineHeight: 1.6 }}>
              Você está prestes a excluir 
              <strong style={{ color: "#111827" }}>“{confirmModal.name}”</strong>.
            </p>

            {/* Aviso de Vinculação a Combos */}
            {confirmModal.affectedCombos && confirmModal.affectedCombos.length > 0 && (
              <div style={{
                background: "#FFF7ED", border: "1.5px solid #FDBA74", borderRadius: "12px",
                padding: "0.85rem 1rem", marginBottom: "1.25rem",
              }}>
                <p style={{ color: "#C2410C", fontSize: "0.85rem", fontWeight: 700, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
                  ⚠️ Atenção! Este item está vinculado em {confirmModal.affectedCombos.length} combo(s):
                </p>
                <ul style={{ margin: "0 0 8px 18px", padding: 0, color: "#9A3412", fontSize: "0.82rem", fontWeight: 600 }}>
                  {confirmModal.affectedCombos.map((comb: any) => (
                    <li key={comb.id} style={{ marginBottom: 2 }}>{comb.name}</li>
                  ))}
                </ul>
                <p style={{ color: "#9A3412", fontSize: "0.78rem", fontWeight: 700, margin: 0, borderTop: "1px solid #FED7AA", paddingTop: 6 }}>
                  💡 Se você excluir este item, ele <strong>sairá de todos esses combos automaticamente</strong>.
                </p>
              </div>
            )}

            {/* Aviso de irreversibilidade */}
            <div style={{
              background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "10px",
              padding: "0.75rem 1rem", marginBottom: "1.25rem",
            }}>
              <p style={{ color: "#B91C1C", fontSize: "0.82rem", fontWeight: 600, margin: 0, lineHeight: 1.5 }}>
                ⚠️ <strong>Esta ação é irreversível.</strong> Uma vez excluído, o produto
                não pode ser recuperado. O histórico de pedidos que contêm este item
                será preservado, mas o produto não aparecerá mais no cardápio.
              </p>
            </div>

            {/* Campo de confirmação */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "0.4rem" }}>
                Para confirmar, digite <strong style={{ color: "#EF4444" }}>excluir</strong> no campo abaixo:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Digite: excluir"
                autoFocus
                style={{
                  width: "100%", padding: "0.6rem 0.9rem", borderRadius: "8px", fontSize: "0.95rem",
                  border: `2px solid ${deleteConfirmText === "excluir" ? "#10B981" : "#D1D5DB"}`,
                  outline: "none", color: "#111827", boxSizing: "border-box",
                  background: deleteConfirmText === "excluir" ? "#F0FDF4" : "#fff",
                  transition: "border-color 0.2s, background 0.2s",
                  fontFamily: "inherit",
                }}
              />
              {deleteConfirmText.length > 0 && deleteConfirmText !== "excluir" && (
                <p style={{ color: "#EF4444", fontSize: "0.75rem", marginTop: "4px" }}>
                  Digite exatamente: <strong>excluir</strong>
                </p>
              )}
              {deleteConfirmText === "excluir" && (
                <p style={{ color: "#10B981", fontSize: "0.75rem", marginTop: "4px", fontWeight: 600 }}>
                  ✓ Confirmado — botão liberado
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => { setConfirmModal(null); setDeleteConfirmText(""); }}
                style={{
                  flex: 1, padding: "0.65rem", borderRadius: "10px", fontWeight: 700,
                  border: "1.5px solid #D1D5DB",
                  background: "#F9FAFB", color: "#374151",
                  cursor: "pointer", fontSize: "0.9rem",
                }}>
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || deleteConfirmText !== "excluir"}
                style={{
                  flex: 1, padding: "0.65rem", borderRadius: "10px", fontWeight: 800,
                  border: "none",
                  background: deleteConfirmText !== "excluir" ? "#FCA5A5" : deleting ? "#B91C1C" : "#EF4444",
                  color: "#fff",
                  cursor: (deleting || deleteConfirmText !== "excluir") ? "not-allowed" : "pointer",
                  fontSize: "0.9rem", transition: "background 0.2s",
                  opacity: deleteConfirmText !== "excluir" ? 0.7 : 1,
                }}>
                {deleting ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST genérico */}
      {(toastMsg || softDeletedName) && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9998,
          background: toastMsg?.color || "#F59E0B", color: toastMsg?.color === "#EF4444" ? "#fff" : "#000",
          fontWeight: 700, padding: "0.75rem 1.25rem", borderRadius: "12px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: "0.85rem",
        }}>
          {toastMsg ? toastMsg.text : `⚠️ "${softDeletedName}" foi desativado (tem pedidos vinculados).`}
        </div>
      )}

      {/* ===== MODAL PAUSE INTELIGENTE ===== */}
      {pauseModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: "18px",
            padding: "2rem", maxWidth: "460px", width: "92%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
            border: "1px solid #E2E8F0",
          }}>
            {/* Ícone */}
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{
                width: 60, height: 60, borderRadius: "50%",
                background: "rgba(245,158,11,0.1)", border: "2px solid #F59E0B",
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "1.8rem",
              }}>⏸️</div>
            </div>

            <h3 style={{ textAlign: "center", fontWeight: 900, fontSize: "1.15rem", color: "#111827", marginBottom: "0.4rem" }}>
              Pausar item vinculado a combos
            </h3>
            <p style={{ textAlign: "center", color: "#6B7280", fontSize: "0.88rem", marginBottom: "1rem", lineHeight: 1.5 }}>
              <strong style={{ color: "#B45309" }}>“{pauseModal.name}”</strong> faz parte de{" "}
              <strong style={{ color: "#111827" }}>{pauseModal.affectedCombos.length} combo{pauseModal.affectedCombos.length > 1 ? "s" : ""}</strong>:
            </p>

            {/* Lista de combos afetados */}
            <div style={{
              background: "#F3F4F6", borderRadius: "10px", padding: "0.6rem 1rem",
              marginBottom: "1.25rem", maxHeight: "120px", overflowY: "auto",
              border: "1px solid #E5E7EB",
            }}>
              {pauseModal.affectedCombos.map((c: any) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0", fontSize: "0.85rem", color: "#374151" }}>
                  <span style={{ fontSize: "0.7rem", background: "#F59E0B", color: "#fff", borderRadius: "4px", padding: "1px 6px", fontWeight: 700 }}>COMBO</span>
                  {c.name}
                </div>
              ))}
            </div>

            {/* Três opções */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <button
                onClick={() => { doToggle(pauseModal.id, false); showToast(`✅ Só “${pauseModal.name}” foi pausado.`); }}
                disabled={pausing}
                style={{
                  padding: "0.7rem 1rem", borderRadius: "10px", fontWeight: 700, border: "1.5px solid #F59E0B",
                  background: "#FFFBEB", color: "#92400E", cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
                }}>
                ⏸️ Pausar só este item
                <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 400, color: "#B45309", marginTop: "2px" }}>
                  Os combos continuarão ativos (mas sem este item disponível)
                </span>
              </button>

              <button
                onClick={() => {
                  doToggle(pauseModal.id, false, pauseModal.affectedCombos.map((c: any) => c.id));
                  showToast(`✅ “${pauseModal.name}” e ${pauseModal.affectedCombos.length} combo(s) foram pausados.`);
                }}
                disabled={pausing}
                style={{
                  padding: "0.7rem 1rem", borderRadius: "10px", fontWeight: 700, border: "1.5px solid #EF4444",
                  background: "#FEF2F2", color: "#B91C1C", cursor: "pointer", fontSize: "0.9rem", textAlign: "left",
                }}>
                ⏸️ Pausar este item + todos os {pauseModal.affectedCombos.length} combo(s)
                <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 400, color: "#DC2626", marginTop: "2px" }}>
                  Recomendado quando o item é essencial para o combo
                </span>
              </button>

              <button
                onClick={() => setPauseModal(null)}
                style={{
                  padding: "0.55rem", borderRadius: "10px", fontWeight: 600,
                  border: "1px solid #D1D5DB", background: "#F9FAFB",
                  color: "#6B7280", cursor: "pointer", fontSize: "0.85rem",
                }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TABS E BOTÕES DE AÇÃO SUPERIOR (iFood style) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setTab("all")} className={`btn ${tab === "all" ? "btn-primary" : "btn-outline"}`} style={{ fontSize: "0.88rem", fontWeight: 800 }} title="Ver cardápio completo com itens e combos agrupados por categoria, exatamente como no site e no iFood">
            📋 Cardápio Completo ({products.filter(p => !isHiddenIntegrationItem(p)).length})
          </button>
          <button onClick={() => setTab("items")} className={`btn ${tab === "items" ? "btn-primary" : "btn-outline"}`} style={{ fontSize: "0.88rem", fontWeight: 700 }}>
            🍔 Apenas Itens ({itemProducts.length})
          </button>
          <button onClick={() => setTab("combos")} className={`btn ${tab === "combos" ? "btn-primary" : "btn-outline"}`} style={{ fontSize: "0.88rem", fontWeight: 700 }}>
            <Package size={16} style={{ marginRight: "4px" }} /> Apenas Combos ({comboProducts.length})
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowNewCat(true)}
            className="btn btn-outline"
            style={{ fontSize: "0.85rem", background: "#FFF", borderColor: "#CBD5E1", color: "#334155", fontWeight: 700 }}
          >
            <Plus size={16} style={{ marginRight: "4px" }} /> Adicionar Categoria
          </button>
          <button
            onClick={openReorderModal}
            className="btn btn-outline"
            style={{ fontSize: "0.85rem", background: "#F5F3FF", borderColor: "#7C3AED", color: "#6D28D9", fontWeight: 800, boxShadow: "0 2px 6px rgba(124,58,237,0.12)" }}
            title="Ordenar as categorias e os produtos dentro de cada uma"
          >
            <ArrowUpDown size={15} style={{ marginRight: "4px" }} /> Reordenar Cardápio
          </button>
          <button
            onClick={() => { resetForm(); setIsCombo(false); setCategory(dynCategories[0]?.name || ""); setShowForm(true); }}
            className="btn btn-outline"
            style={{ fontSize: "0.85rem", background: "#FFF", borderColor: "#E8360C", color: "#E8360C", fontWeight: 700 }}
          >
            <Plus size={16} style={{ marginRight: "4px" }} /> Novo Item
          </button>
          <button
            onClick={() => { resetForm(); setIsCombo(true); setCategory(dynCategories.find(c => c.name === "Combos")?.name || dynCategories[0]?.name || ""); setShowForm(true); }}
            className="btn btn-primary"
            style={{ fontSize: "0.85rem" }}
          >
            <Plus size={16} style={{ marginRight: "4px" }} /> Novo Combo
          </button>
        </div>
      </div>

      {/* BARRA DE BUSCA E FILTRO DE CATEGORIAS */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between",
        marginBottom: "1.25rem", padding: "0.75rem 1rem", backgroundColor: "#FFFFFF", borderRadius: "14px",
        border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)"
      }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: 1, minWidth: "260px" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={18} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
            <input
              type="text"
              placeholder="🔍 Buscar produto por nome, descrição ou categoria..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: "100%", padding: "9px 12px 9px 38px", borderRadius: "10px",
                border: "1.5px solid #CBD5E1", fontSize: "0.88rem", outline: "none",
                backgroundColor: "#F8FAFC", fontFamily: "inherit", fontWeight: 600
              }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8" }}>
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            value={selectedCategoryFilter}
            onChange={e => setSelectedCategoryFilter(e.target.value)}
            style={{
              padding: "9px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1",
              fontSize: "0.85rem", fontWeight: 700, backgroundColor: "#FFF", color: "#1E293B", cursor: "pointer"
            }}
          >
            <option value="TODAS">📁 Todas Categorias ({dynCategories.length})</option>
            {dynCategories
              .filter(c => !["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE"].includes(c.name.toUpperCase()))
              .map(c => (
                <option key={c.id} value={c.name}>{c.emoji || "🍽️"} {c.name}</option>
              ))}
          </select>
        </div>
      </div>

      {/* FORM MODAL OVERLAY */}
      {showForm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "1rem",
        }}>
          <div style={{
            background: "#FFFFFF", borderRadius: "24px",
            width: "100%", maxWidth: "780px", maxHeight: "90vh", overflowY: "auto",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.4)",
            border: "1px solid #E2E8F0", padding: "1.75rem", position: "relative"
          }}>
            {/* Header com botão Fechar X */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", borderBottom: "1px solid #F1F5F9", paddingBottom: "1rem" }}>
              <div>
                <span style={{ fontSize: "0.72rem", background: "#FEF2F2", color: "#DC2626", fontWeight: 800, padding: "3px 10px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {editingId ? "✏️ Editar Produto" : "✨ Novo Produto"}
                </span>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0F172A", margin: "6px 0 0", letterSpacing: "-0.5px" }}>
                  {editingId ? (name || "Editar Produto") : (isCombo ? "Novo Combo" : "Novo Produto")}
                </h2>
              </div>
              <button
                type="button"
                onClick={resetForm}
                style={{
                  width: "36px", height: "36px", borderRadius: "50%",
                  background: "#F1F5F9", border: "none", color: "#64748B",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", transition: "all 0.2s"
                }}
                title="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            {/* PREVIEW HERO COM A FOTO DESTACADA DO PRODUTO & CONTROLES DE FOTO DIRETO AO LADO */}
            <div style={{
              background: "linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)",
              border: "1.5px solid #E2E8F0", borderRadius: "18px",
              padding: "1.15rem", marginBottom: "1.5rem"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
                {/* THUMBNAIL DA FOTO */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                  {imageUrl && imageUrl.trim() !== "" ? (
                    <div style={{ position: "relative" }}>
                      <img
                        src={imageUrl}
                        alt={name || "Prévia"}
                        style={{ width: "90px", height: "90px", objectFit: "cover", borderRadius: "16px", border: "2.5px solid #FFF", boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }}
                        onError={(e: any) => { e.target.style.display = 'none'; }}
                      />
                      <span style={{ position: "absolute", bottom: "-6px", left: "50%", transform: "translateX(-50%)", background: "#16A34A", color: "#FFF", fontSize: "0.58rem", fontWeight: 800, padding: "1px 6px", borderRadius: "10px", whiteSpace: "nowrap" }}>
                        FOTO ATIVA
                      </span>
                    </div>
                  ) : (
                    <div style={{
                      width: "90px", height: "90px", borderRadius: "16px",
                      background: "#E2E8F0", border: "2px dashed #94A3B8",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      color: "#64748B"
                    }}>
                      <ImageIcon size={30} />
                      <span style={{ fontSize: "0.62rem", fontWeight: 700, marginTop: "2px" }}>SEM FOTO</span>
                    </div>
                  )}
                </div>

                {/* INFORMAÇÕES E BOTÕES DE INSERIR FOTO PERTO DA FOTO */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h4 style={{ margin: "0 0 2px", fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>
                        {name || "Digite o nome do produto..."}
                      </h4>
                      <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "#64748B" }}>
                        {category ? `📁 ${category}` : "Sem categoria"} • R$ {price ? parseFloat(price).toFixed(2).replace(".", ",") : "0,00"}
                      </p>
                    </div>
                  </div>

                  {/* BOTOES DE INSERIR FOTO DIRETO AO LADO DA FOTO */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "4px" }}>
                    <input
                      type="file"
                      id="hero-photo-file-input"
                      accept="image/*"
                      onChange={handleFileChange}
                      style={{ display: "none" }}
                    />
                    <label
                      htmlFor="hero-photo-file-input"
                      style={{
                        padding: "6px 14px", borderRadius: "8px", background: "#0F172A", color: "#FFF",
                        fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "inline-flex",
                        alignItems: "center", gap: "6px", boxShadow: "0 2px 6px rgba(0,0,0,0.15)"
                      }}
                    >
                      📷 Inserir Foto (Upload)
                    </label>

                    <button
                      type="button"
                      onClick={() => setImageMode(prev => prev === "url" ? "file" : "url")}
                      style={{
                        padding: "6px 14px", borderRadius: "8px", background: imageMode === "url" ? "#E2E8F0" : "#FFF",
                        color: "#334155", border: "1.5px solid #CBD5E1", fontSize: "0.78rem", fontWeight: 700,
                        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px"
                      }}
                    >
                      🔗 Inserir Link / URL Externa
                    </button>

                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => setImageUrl("")}
                        style={{
                          padding: "6px 10px", borderRadius: "8px", background: "#FEF2F2",
                          color: "#DC2626", border: "1px solid #FCA5A5", fontSize: "0.75rem",
                          fontWeight: 700, cursor: "pointer"
                        }}
                      >
                        🗑️ Remover Foto
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* CAMPO PARA DIGITAR OU COLAR A URL SE CLICOU EM INSERIR LINK */}
              {imageMode === "url" && (
                <div style={{ marginTop: "12px", borderTop: "1px dashed #CBD5E1", paddingTop: "10px" }}>
                  <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    Cole a URL / Link externo da imagem:
                  </label>
                  <input
                    className="input-field"
                    style={{ height: "40px", fontSize: "0.85rem", background: "#FFF" }}
                    placeholder="https://imagens.jotaja.com/produtos/..."
                    value={imageUrl}
                    onChange={e => setImageUrl(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* GRID DE CAMPOS DE EDIÇÃO */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem 1rem" }}>
              {/* LINHA 1: NOME & PREÇO */}
              <div className="input-group" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ height: "24px", display: "flex", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ fontWeight: 700, color: "#334155", fontSize: "0.85rem", margin: 0 }}>Nome do Produto</label>
                </div>
                <input className="input-field" style={{ height: "44px", boxSizing: "border-box" }} placeholder="Ex: Esfirra de Carne" value={name} onChange={e => setName(e.target.value)} />
              </div>

              <div className="input-group" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ height: "24px", display: "flex", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ fontWeight: 700, color: "#334155", fontSize: "0.85rem", margin: 0 }}>Preço de Venda (R$)</label>
                </div>
                <input className="input-field" style={{ height: "44px", boxSizing: "border-box" }} type="number" step="0.01" placeholder="Ex: 9.90" value={price} onChange={e => setPrice(e.target.value)} />
              </div>

              {/* LINHA 2: CATEGORIA & CUSTO (ALINHAMENTO 100% PERFEITO EM LINHA RETA) */}
              <div className="input-group" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ height: "24px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <label style={{ fontWeight: 700, color: "#334155", fontSize: "0.85rem", margin: 0 }}>Categoria</label>
                  <button
                    type="button"
                    onClick={() => setShowNewCat(prev => !prev)}
                    style={{ fontSize: "0.72rem", color: "#E8360C", background: "none", border: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}
                  >
                    {showNewCat ? "✕ Fechar" : "⚙️ Gerenciar / Nova Categoria"}
                  </button>
                </div>
                {dynCategories.length === 0 ? (
                  <div style={{ padding: "10px 12px", background: "#FFF5F3", border: "1.5px dashed #FCA5A5", borderRadius: 10, fontSize: "0.8rem", color: "#DC2626" }}>
                    ⚠️ Cadastre sua primeira categoria abaixo para poder salvar produtos:
                  </div>
                ) : (
                  <select className="input-field" style={{ height: "44px", boxSizing: "border-box" }} value={category} onChange={e => setCategory(e.target.value)}>
                    {dynCategories.map(c => (
                      <option key={c.id} value={c.name}>{c.emoji} {c.name}</option>
                    ))}
                  </select>
                )}

                {/* PAINEL DE GERENCIAMENTO DE CATEGORIAS (INCLUIR & EXCLUIR) */}
                {(showNewCat || dynCategories.length === 0) && (
                  <div style={{
                    marginTop: 10, padding: "14px", background: "#F8FAFC",
                    border: "1.5px solid #E2E8F0", borderRadius: 14,
                    display: "flex", flexDirection: "column", gap: 12
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>
                        📁 Gerenciar Categorias
                      </p>
                      {dynCategories.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { setShowNewCat(false); setNewCatName(""); }}
                          style={{ fontSize: "0.75rem", color: "#64748B", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
                        >
                          ✕ Fechar
                        </button>
                      )}
                    </div>

                    {/* FORM PARA CRIAR NOVA CATEGORIA */}
                    <div style={{ background: "#FFF", padding: "10px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                      <p style={{ margin: "0 0 6px", fontSize: "0.75rem", fontWeight: 700, color: "#475569" }}>+ Adicionar Nova Categoria</p>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input
                          placeholder="Emoji (ex: 🍟)"
                          value={newCatEmoji}
                          onChange={e => setNewCatEmoji(e.target.value)}
                          style={{ width: 65, padding: "8px", border: "1.5px solid #E2E8F0", borderRadius: 8, fontSize: "1rem", textAlign: "center" }}
                        />
                        <input
                          placeholder="Nome da categoria"
                          value={newCatName}
                          onChange={e => setNewCatName(e.target.value)}
                          style={{ flex: 1, padding: "8px 12px", border: "1.5px solid #E2E8F0", borderRadius: 8, fontSize: "0.88rem" }}
                        />
                        <input
                          type="color"
                          value={newCatColor}
                          onChange={e => setNewCatColor(e.target.value)}
                          title="Cor da categoria"
                          style={{ width: 40, height: 38, border: "1.5px solid #E2E8F0", borderRadius: 8, cursor: "pointer", padding: 2 }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateCategory}
                        disabled={newCatSaving || !newCatName.trim()}
                        style={{
                          width: "100%", padding: "8px", background: "#16A34A", color: "#fff",
                          border: "none", borderRadius: 8, fontWeight: 700, fontSize: "0.82rem",
                          cursor: newCatSaving || !newCatName.trim() ? "not-allowed" : "pointer",
                          opacity: newCatSaving || !newCatName.trim() ? 0.6 : 1
                        }}
                      >
                        {newCatSaving ? "Criando..." : "✓ Adicionar Categoria"}
                      </button>
                    </div>

                    {/* LISTA DE CATEGORIAS EXISTENTES COM OPÇÃO DE EXCLUIR */}
                    <div>
                      <p style={{ margin: "0 0 6px", fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>
                        Categorias Atuais ({dynCategories.length}):
                      </p>
                      <div style={{ maxHeight: "150px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {dynCategories.map(c => (
                          <div
                            key={c.id}
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              padding: "6px 10px", background: "#FFF", borderRadius: "8px",
                              border: "1px solid #E2E8F0", fontSize: "0.82rem"
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontSize: "1rem" }}>{c.emoji}</span>
                              <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.color || "#64748B" }}></span>
                              <span style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(c.id, c.name)}
                              disabled={deletingCatId === c.id}
                              style={{
                                border: "none", background: "#FEF2F2", color: "#DC2626",
                                borderRadius: "6px", padding: "4px 8px", cursor: "pointer",
                                fontSize: "0.75rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px"
                              }}
                              title={`Excluir categoria ${c.name}`}
                            >
                              <Trash2 size={13} /> {deletingCatId === c.id ? "Excluindo..." : "Excluir"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Campo Custo */}
              <div className="input-group" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ height: "24px", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <label style={{ fontWeight: 700, color: "#334155", fontSize: "0.85rem", margin: 0 }}>Custo do Produto (R$)</label>
                  <span style={{ fontSize: "0.68rem", background: "#FEF3C7", color: "#92400E", padding: "1px 6px", borderRadius: "4px", fontWeight: 700, lineHeight: 1 }}>
                    Usado no CMV
                  </span>
                </div>
                <input
                  className="input-field"
                  style={{ height: "44px", boxSizing: "border-box" }}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Ex: 4.50"
                  value={cost}
                  onChange={e => setCost(e.target.value)}
                />
                {cost && parseFloat(price) > 0 && parseFloat(cost) > 0 && (
                  <p style={{ fontSize: "0.72rem", color: "#16A34A", marginTop: "4px", fontWeight: 600 }}>
                    Margem bruta: {(((parseFloat(price) - parseFloat(cost)) / parseFloat(price)) * 100).toFixed(1)}%
                  </p>
                )}
              </div>

              {/* DESCRIÇÃO */}
              <div className="input-group" style={{ gridColumn: "span 2" }}>
                <label style={{ fontWeight: 700, color: "#334155", fontSize: "0.85rem" }}>Descrição do Produto</label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="Escreva os detalhes, ingredientes ou observações do produto..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </div>
            </div>

            {/* TAGS DE PRODUTO */}
            {!isCombo && (
              <div style={{ marginTop: "1.25rem", padding: "0.875rem 1rem", background: "#FFF7ED", borderRadius: "14px", border: "1.5px solid #FCD34D" }}>
                <p style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.6rem", color: "#92400E" }}>🏷️ Tags do Produto <span style={{ fontSize: "0.7rem", fontWeight: 400, color: "#B45309" }}>(aparecem no cardápio digital)</span></p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {[
                    { label: "🔥 Mais Vendido", color: "#EF4444" },
                    { label: "✨ Novo", color: "#8B5CF6" },
                    { label: "🏷️ Promoção", color: "#10B981" },
                    { label: "🌱 Vegano", color: "#16A34A" },
                    { label: "🌶️ Picante", color: "#F59E0B" },
                    { label: "⭐ Destaque", color: "#F59E0B" },
                    { label: "❄️ Gelado", color: "#3B82F6" },
                    { label: "🎉 Especial do Dia", color: "#EC4899" },
                  ].map(tag => {
                    const active = tags.includes(tag.label);
                    return (
                      <button
                        key={tag.label}
                        type="button"
                        onClick={() => setTags(prev => active ? prev.filter(t => t !== tag.label) : [...prev, tag.label])}
                        style={{
                          padding: "5px 14px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700,
                          border: `2px solid ${active ? tag.color : "#E2E8F0"}`,
                          background: active ? tag.color + "18" : "#FFF",
                          color: active ? tag.color : "#64748B",
                          cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
                        }}
                      >{tag.label}</button>
                    );
                  })}
                </div>
                {tags.length > 0 && (
                  <p style={{ fontSize: "0.72rem", color: "#92400E", marginTop: "6px" }}>
                    ✅ {tags.length} tag{tags.length > 1 ? "s" : ""} selecionada{tags.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {/* DISPONIBILIDADE POR DIAS DA SEMANA */}
            <div style={{ marginTop: "1.25rem", padding: "0.875rem 1rem", background: "#F8FAFC", borderRadius: "14px", border: "1.5px solid #E2E8F0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <p style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F172A", margin: 0 }}>
                  📅 Dias de Disponibilidade no Cardápio
                </p>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, background: availableDaysMode === "all" ? "#DCFCE7" : "#FEF3C7", color: availableDaysMode === "all" ? "#166534" : "#92400E", padding: "2px 8px", borderRadius: "6px" }}>
                  {availableDaysMode === "all" ? "🟢 Sempre Ativo" : `📅 ${selectedDays.length} dia(s) selecionado(s)`}
                </span>
              </div>

              {/* OPÇÕES: TODOS OS DIAS OU DIAS ESPECÍFICOS */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: availableDaysMode === "specific" ? "0.875rem" : 0 }}>
                <button
                  type="button"
                  onClick={() => setAvailableDaysMode("all")}
                  style={{
                    padding: "10px 14px", borderRadius: "10px", fontSize: "0.82rem", fontWeight: 700,
                    border: `1.5px solid ${availableDaysMode === "all" ? "#16A34A" : "#CBD5E1"}`,
                    background: availableDaysMode === "all" ? "#F0FDF4" : "#FFF",
                    color: availableDaysMode === "all" ? "#15803D" : "#64748B",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "8px",
                    textAlign: "left"
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>🟢</span>
                  <div>
                    <div style={{ fontWeight: 800 }}>Sempre Ativo</div>
                    <div style={{ fontSize: "0.68rem", fontWeight: 400, color: "#64748B" }}>Disponível todos os dias da semana</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAvailableDaysMode("specific");
                    if (selectedDays.length === 0) setSelectedDays(["SEG","TER","QUA","QUI","SEX","SAB","DOM"]);
                  }}
                  style={{
                    padding: "10px 14px", borderRadius: "10px", fontSize: "0.82rem", fontWeight: 700,
                    border: `1.5px solid ${availableDaysMode === "specific" ? "#E8360C" : "#CBD5E1"}`,
                    background: availableDaysMode === "specific" ? "#FEF2F2" : "#FFF",
                    color: availableDaysMode === "specific" ? "#DC2626" : "#64748B",
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "8px",
                    textAlign: "left"
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>📅</span>
                  <div>
                    <div style={{ fontWeight: 800 }}>Dias Específicos</div>
                    <div style={{ fontSize: "0.68rem", fontWeight: 400, color: "#64748B" }}>Escolha em quais dias aparece no cardápio</div>
                  </div>
                </button>
              </div>

              {/* SELETOR DOS 7 DIAS DA SEMANA */}
              {availableDaysMode === "specific" && (
                <div style={{ padding: "10px", background: "#FFF", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                  <p style={{ margin: "0 0 8px", fontSize: "0.75rem", fontWeight: 700, color: "#475569" }}>
                    Selecione os dias em que o produto estará ATIVO:
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "6px" }}>
                    {WEEKDAYS.map(day => {
                      const active = selectedDays.includes(day.key);
                      return (
                        <button
                          key={day.key}
                          type="button"
                          title={day.full}
                          onClick={() => {
                            setSelectedDays(prev =>
                              active ? prev.filter(d => d !== day.key) : [...prev, day.key]
                            );
                          }}
                          style={{
                            padding: "8px 2px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 800,
                            border: `2px solid ${active ? "#16A34A" : "#E2E8F0"}`,
                            background: active ? "#DCFCE7" : "#F8FAFC",
                            color: active ? "#15803D" : "#94A3B8",
                            cursor: "pointer", textAlign: "center", transition: "all 0.15s"
                          }}
                        >
                          {day.label}
                          <div style={{ fontSize: "0.6rem", marginTop: "2px", fontWeight: 700 }}>
                            {active ? "✓" : "✕"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedDays.length === 0 && (
                    <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#DC2626", fontWeight: 700 }}>
                      ⚠️ Selecione pelo menos 1 dia da semana para o produto ficar visível.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* CANAIS DE VENDA */}
            <div style={{ marginTop: "1.25rem", padding: "0.875rem 1rem", background: "#F8FAFC", borderRadius: "14px", border: "1.5px solid #E2E8F0" }}>
              <p style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.6rem", color: "#0F172A" }}>📡 Canais de Venda Disponíveis</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                {CHANNELS.map(ch => {
                  const stateMap: Record<string, [boolean, (v: boolean) => void]> = {
                    activePDV: [activePDV, setActivePDV],
                    activeDelivery: [activeDelivery, setActiveDelivery],
                    activeTotem: [activeTotem, setActiveTotem],
                    activeGarcom: [activeGarcom, setActiveGarcom],
                  };
                  const [val, setter] = stateMap[ch.key];
                  return (
                    <label key={ch.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", borderRadius: "10px", border: `1.5px solid ${val ? ch.color : "#E2E8F0"}`, background: val ? ch.color + "10" : "#fff", cursor: "pointer" }}>
                      <input type="checkbox" checked={val} onChange={e => setter(e.target.checked)} style={{ accentColor: ch.color }} />
                      <span style={{ fontSize: "0.85rem" }}>{ch.icon}</span>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.82rem", color: val ? ch.color : "#64748B", margin: 0 }}>{ch.label}</p>
                        <p style={{ fontSize: "0.68rem", color: "#94A3B8", margin: 0 }}>{ch.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* SINALIZAÇÃO DE BEBIDA NA COMANDA */}
            <div style={{ marginTop: "1.25rem", padding: "0.875rem 1rem", background: isBeverage ? "#EFF6FF" : "#F8FAFC", borderRadius: "14px", border: `1.5px solid ${isBeverage ? "#3B82F6" : "#E2E8F0"}`, transition: "all 0.2s" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isBeverage}
                  onChange={e => setIsBeverage(e.target.checked)}
                  style={{ width: "20px", height: "20px", accentColor: "#2563EB", cursor: "pointer" }}
                />
                <div>
                  <p style={{ fontWeight: 800, fontSize: "0.88rem", color: isBeverage ? "#1D4ED8" : "#0F172A", margin: 0 }}>
                    🥤 Sinalizar como BEBIDA na comanda impressa
                  </p>
                  <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "2px 0 0" }}>
                    Imprime o carimbo em destaque preto no papel térmico <strong style={{ color: "#1D4ED8" }}>[ ◄=== BEBIDA ]</strong> para garantir que o item não seja esquecido no pedido.
                  </p>
                </div>
              </label>
            </div>

            {/* ─── PERGUNTAS DO COMBO ──────────────────────────────────────
                A tela era um "Construtor de Combo": título, mínimo e máximo
                espremidos numa linha e um <select> com o cardápio inteiro para
                achar o item. Quem monta cardápio conhece o modelo do iFood, e é
                ele que está aqui: cada grupo é uma PERGUNTA ("Escolha seus
                sabores", "Deseja adicionais?"), marcada obrigatória ou
                opcional, e o item entra por dois caminhos — o que já existe no
                cardápio, ou um novo cadastrado ali mesmo.

                O segundo caminho é o que faltava: para pôr um "Adicional de
                Catupiry" no combo, a loja precisava abandonar o formulário,
                cadastrar o produto no cardápio e voltar a montar o combo do
                zero. */}
            {isCombo && (
              <div style={{ marginTop: "1.25rem", padding: "1rem", backgroundColor: "#F8FAFC", borderRadius: "14px", border: "2px dashed #CBD5E1" }}>
                <div style={{ marginBottom: "0.9rem" }}>
                  <h4 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: "#0F172A" }}>📦 Perguntas do combo</h4>
                  <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "4px 0 0" }}>
                    Cada pergunta é uma escolha que o cliente faz. A ordem aqui é a ordem em que ele vê.
                  </p>
                </div>

                {comboGroups.length === 0 && (
                  <div style={{ padding: "1.1rem", background: "#FFF", border: "1px dashed #CBD5E1", borderRadius: "12px", textAlign: "center", marginBottom: "0.9rem" }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#475569", margin: 0 }}>Nenhuma pergunta ainda.</p>
                    <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "4px 0 0" }}>
                      Ex: &quot;Escolha seus sabores&quot; (obrigatória) e &quot;Deseja adicionais?&quot; (opcional).
                    </p>
                  </div>
                )}

                {comboGroups.map((group, gIdx) => {
                  const minimoDoGrupo = group.minQty ?? group.maxQty;
                  const obrigatorio = minimoDoGrupo > 0;
                  const formularioAberto = novaOpcao?.gIdx === gIdx;
                  const seletorDesteGrupo = seletorAberto === gIdx;
                  const candidatos = catalogoDeOpcoes
                    .filter(item => item.id !== editingId)
                    .filter(item => !group.items.some((it: any) => it.id === item.id))
                    .filter(item => (item.name || "").toLowerCase().includes(buscaOpcao.trim().toLowerCase()));

                  return (
                    <div key={gIdx} style={{ marginBottom: "1rem", padding: "1rem", backgroundColor: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 2px 6px rgba(0,0,0,0.03)" }}>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "0.6rem" }}>
                        <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#EFF6FF", color: "#1D4ED8", fontSize: "0.7rem", fontWeight: 800 }}>
                          Pergunta {gIdx + 1}
                        </span>
                        <div style={{ flex: 1 }} />
                        <button type="button" onClick={() => moverGrupo(gIdx, -1)} disabled={gIdx === 0} title="Subir pergunta"
                          style={{ padding: "5px", borderRadius: "7px", border: "1px solid #E2E8F0", background: "#F8FAFC", color: gIdx === 0 ? "#CBD5E1" : "#475569", cursor: gIdx === 0 ? "default" : "pointer" }}>
                          <ArrowUp size={14} />
                        </button>
                        <button type="button" onClick={() => moverGrupo(gIdx, 1)} disabled={gIdx === comboGroups.length - 1} title="Descer pergunta"
                          style={{ padding: "5px", borderRadius: "7px", border: "1px solid #E2E8F0", background: "#F8FAFC", color: gIdx === comboGroups.length - 1 ? "#CBD5E1" : "#475569", cursor: gIdx === comboGroups.length - 1 ? "default" : "pointer" }}>
                          <ArrowDown size={14} />
                        </button>
                        <button type="button" onClick={() => removeGroup(gIdx)} title="Remover pergunta"
                          style={{ padding: "5px", borderRadius: "7px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#EF4444", cursor: "pointer" }}>
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#334155" }}>O que o cliente escolhe aqui?</label>
                      <input
                        className="input-field"
                        value={group.title}
                        onChange={e => updateGroup(gIdx, "title", e.target.value)}
                        placeholder="Ex: Escolha seus sabores"
                      />

                      <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-end", marginTop: "0.7rem", flexWrap: "wrap" }}>
                        <div>
                          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: "4px" }}>Resposta</label>
                          <div style={{ display: "flex", border: "1.5px solid #E2E8F0", borderRadius: "9px", overflow: "hidden" }}>
                            <button type="button"
                              onClick={() => { if (!obrigatorio) updateGroup(gIdx, "minQty", 1); }}
                              style={{ padding: "8px 14px", border: "none", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", background: obrigatorio ? "#2563EB" : "#FFF", color: obrigatorio ? "#FFF" : "#64748B" }}>
                              Obrigatória
                            </button>
                            <button type="button"
                              onClick={() => { if (obrigatorio) updateGroup(gIdx, "minQty", 0); }}
                              style={{ padding: "8px 14px", border: "none", fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", background: !obrigatorio ? "#2563EB" : "#FFF", color: !obrigatorio ? "#FFF" : "#64748B" }}>
                              Opcional
                            </button>
                          </div>
                        </div>

                        {obrigatorio && (
                          <div style={{ width: "92px" }}>
                            <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#334155" }}>Escolhe mín.</label>
                            <input
                              className="input-field"
                              type="number"
                              min={1}
                              value={minimoDoGrupo}
                              onChange={e => updateGroup(gIdx, "minQty", Math.max(1, parseInt(e.target.value) || 1))}
                            />
                          </div>
                        )}

                        <div style={{ width: "92px" }}>
                          <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#334155" }}>No máx.</label>
                          <input
                            className="input-field"
                            type="number"
                            min={1}
                            value={group.maxQty}
                            onChange={e => updateGroup(gIdx, "maxQty", parseInt(e.target.value) || 1)}
                          />
                        </div>
                      </div>

                      <div style={{ fontSize: "0.73rem", color: "#64748B", margin: "0.5rem 0 0.85rem" }}>
                        {!obrigatorio
                          ? `Opcional — o cliente pode seguir sem escolher nada (até ${group.maxQty}).`
                          : minimoDoGrupo === group.maxQty
                            ? `Obrigatória — exige exatamente ${group.maxQty} ${group.maxQty === 1 ? "escolha" : "escolhas"}.`
                            : `Obrigatória — de ${minimoDoGrupo} a ${group.maxQty} escolhas.`}
                      </div>

                      {group.items.length === 0 ? (
                        <div style={{ fontSize: "0.78rem", color: "#94A3B8", fontStyle: "italic", padding: "10px", background: "#F8FAFC", borderRadius: "8px", marginBottom: "8px" }}>
                          Nenhum item nesta pergunta ainda.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "8px" }}>
                          {group.items.map((it: any, iIdx: number) => {
                            const produto = catalogoDeOpcoes.find(p => p.id === it.id);
                            return (
                              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", background: "#F8FAFC", borderRadius: "8px", border: "1px solid #E2E8F0", flexWrap: "wrap" }}>
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                  <button type="button" onClick={() => moverItemDoGrupo(gIdx, it.id, -1)} disabled={iIdx === 0} title="Subir item"
                                    style={{ background: "none", border: "none", padding: 0, lineHeight: 0, cursor: iIdx === 0 ? "default" : "pointer", color: iIdx === 0 ? "#CBD5E1" : "#64748B" }}>
                                    <ArrowUp size={12} />
                                  </button>
                                  <button type="button" onClick={() => moverItemDoGrupo(gIdx, it.id, 1)} disabled={iIdx === group.items.length - 1} title="Descer item"
                                    style={{ background: "none", border: "none", padding: 0, lineHeight: 0, cursor: iIdx === group.items.length - 1 ? "default" : "pointer", color: iIdx === group.items.length - 1 ? "#CBD5E1" : "#64748B" }}>
                                    <ArrowDown size={12} />
                                  </button>
                                </div>

                                <span style={{ flex: 1, minWidth: "120px", fontSize: "0.82rem", fontWeight: 700, color: produto ? "#1E293B" : "#EF4444" }}>
                                  {produto ? produto.name : "Item excluído do cardápio"} {produto && produto.active === false && "⏸️"}
                                </span>

                                <input
                                  type="text"
                                  placeholder="obs. (ex: 13cm)"
                                  value={it.optionNote || ""}
                                  onChange={e => updateGroupItemField(gIdx, it.id, "optionNote", e.target.value || null)}
                                  title="Linha curta sob o nome da opção no cardápio."
                                  style={{ width: "104px", padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1", fontSize: "0.78rem" }}
                                />
                                <label style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>+R$</label>
                                <input
                                  type="number"
                                  step="0.50"
                                  min="0"
                                  placeholder="0.00"
                                  value={it.additionalPrice || 0}
                                  onChange={e => updateGroupItemPrice(gIdx, it.id, parseFloat(e.target.value) || 0)}
                                  title="Quanto este item soma ao preço do combo."
                                  style={{ width: "76px", padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 700, textAlign: "right" }}
                                />
                                <label style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>Máx</label>
                                <input
                                  type="number"
                                  min="1"
                                  placeholder="—"
                                  value={it.maxPerItem ?? ""}
                                  onChange={e => updateGroupItemField(gIdx, it.id, "maxPerItem", e.target.value ? Math.max(1, parseInt(e.target.value)) : null)}
                                  title="Quantas vezes ESTE item pode ser repetido. Vazio = só o limite da pergunta."
                                  style={{ width: "56px", padding: "4px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 700, textAlign: "right" }}
                                />
                                <button type="button" onClick={() => removeGroupItem(gIdx, it.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#EF4444" }} title="Tirar item da pergunta">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button type="button"
                          onClick={() => { setSeletorAberto(seletorDesteGrupo ? null : gIdx); setBuscaOpcao(""); setNovaOpcao(null); }}
                          style={{ flex: 1, minWidth: "180px", padding: "9px 12px", borderRadius: "9px", border: "1.5px solid #3B82F6", background: seletorDesteGrupo ? "#3B82F6" : "#EFF6FF", color: seletorDesteGrupo ? "#FFF" : "#1D4ED8", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}>
                          <Search size={13} style={{ marginRight: "5px", verticalAlign: "-2px" }} />
                          Item que já existe
                        </button>
                        <button type="button"
                          onClick={() => { setNovaOpcao(formularioAberto ? null : { gIdx, nome: "", acrescimo: "", obs: "" }); setSeletorAberto(null); }}
                          style={{ flex: 1, minWidth: "180px", padding: "9px 12px", borderRadius: "9px", border: "1.5px solid #16A34A", background: formularioAberto ? "#16A34A" : "#F0FDF4", color: formularioAberto ? "#FFF" : "#15803D", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}>
                          <Sparkles size={13} style={{ marginRight: "5px", verticalAlign: "-2px" }} />
                          Cadastrar item novo
                        </button>
                      </div>

                      {seletorDesteGrupo && (
                        <div style={{ marginTop: "8px", padding: "10px", background: "#F8FAFC", border: "1px solid #BFDBFE", borderRadius: "10px" }}>
                          <input
                            autoFocus
                            value={buscaOpcao}
                            onChange={e => setBuscaOpcao(e.target.value)}
                            placeholder="Buscar no cardápio..."
                            style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.82rem", marginBottom: "8px" }}
                          />
                          <div style={{ maxHeight: "190px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                            {candidatos.slice(0, 60).map(item => (
                              <button key={item.id} type="button"
                                onClick={() => { addGroupItem(gIdx, item.id); setBuscaOpcao(""); }}
                                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "7px 10px", borderRadius: "7px", border: "1px solid #E2E8F0", background: "#FFF", cursor: "pointer", textAlign: "left" }}>
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1E293B" }}>
                                  {item.name} {item.active === false && " [Pausado]"}
                                </span>
                                <span style={{ fontSize: "0.75rem", color: "#64748B", whiteSpace: "nowrap" }}>
                                  {item.price ? `R$ ${Number(item.price).toFixed(2)}` : "—"}
                                </span>
                              </button>
                            ))}
                            {candidatos.length === 0 && (
                              <p style={{ fontSize: "0.78rem", color: "#94A3B8", margin: "4px 2px", fontStyle: "italic" }}>
                                Nada com esse nome. Use &quot;Cadastrar item novo&quot; ao lado.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {formularioAberto && novaOpcao && (
                        <div style={{ marginTop: "8px", padding: "12px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "10px" }}>
                          <p style={{ fontSize: "0.74rem", color: "#15803D", margin: "0 0 8px", fontWeight: 700 }}>
                            O item entra só nesta pergunta — não vira produto avulso no cardápio.
                          </p>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
                            <div style={{ flex: 2, minWidth: "160px" }}>
                              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#334155" }}>Nome do item</label>
                              <input
                                autoFocus
                                value={novaOpcao.nome}
                                onChange={e => setNovaOpcao(prev => prev ? { ...prev, nome: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); criarOpcaoNaHora(); } }}
                                placeholder="Ex: Adicional de Catupiry"
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.82rem" }}
                              />
                            </div>
                            <div style={{ width: "108px" }}>
                              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#334155" }}>Acréscimo R$</label>
                              <input
                                value={novaOpcao.acrescimo}
                                onChange={e => setNovaOpcao(prev => prev ? { ...prev, acrescimo: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); criarOpcaoNaHora(); } }}
                                placeholder="0,00"
                                inputMode="decimal"
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 700, textAlign: "right" }}
                              />
                            </div>
                            <div style={{ flex: 2, minWidth: "160px" }}>
                              <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#334155" }}>Descrição (opcional)</label>
                              <input
                                value={novaOpcao.obs}
                                onChange={e => setNovaOpcao(prev => prev ? { ...prev, obs: e.target.value } : prev)}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); criarOpcaoNaHora(); } }}
                                placeholder="Ex: 40g de catupiry cremoso"
                                style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.82rem" }}
                              />
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                            <button type="button" onClick={criarOpcaoNaHora} disabled={salvandoOpcao}
                              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#16A34A", color: "#FFF", fontWeight: 800, fontSize: "0.8rem", cursor: salvandoOpcao ? "default" : "pointer", opacity: salvandoOpcao ? 0.6 : 1 }}>
                              {salvandoOpcao ? "Cadastrando..." : "Cadastrar e adicionar"}
                            </button>
                            <button type="button" onClick={() => setNovaOpcao(null)}
                              style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#FFF", color: "#64748B", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                              Fechar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <button type="button" onClick={addGroup} className="btn btn-outline" style={{ width: "100%", fontSize: "0.85rem", borderRadius: "10px" }}>
                  <Plus size={14} style={{ marginRight: "4px" }} /> Adicionar pergunta
                </button>
              </div>
            )}

            {/* BOTOES DE AÇÃO */}
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.75rem", borderTop: "1px solid #F1F5F9", paddingTop: "1.25rem" }}>
              <button
                type="button"
                onClick={resetForm}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px",
                  background: "#F1F5F9", color: "#64748B", border: "none",
                  fontWeight: 700, fontSize: "0.9rem", cursor: "pointer"
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  flex: 2, padding: "12px", borderRadius: "12px",
                  background: "linear-gradient(135deg, #E8360C, #C62828)",
                  color: "#FFF", border: "none", fontWeight: 800,
                  fontSize: "0.95rem", cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.7 : 1, boxShadow: "0 4px 14px rgba(232,54,12,0.35)"
                }}
              >
                {loading ? "Salvando Alterações..." : (editingId ? "✓ Salvar Alterações" : "✓ Cadastrar Produto")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT LIST AGRUPADO POR CATEGORIAS (iFood style) */}
      {(() => {
        // A aba "Cardápio Completo" (tab === "all") caía no ramo dos combos por
        // não ter ramo próprio. Numa loja sem combo nenhum — a Brasa Burguer
        // tem zero — ela mostrava a tela de "nenhum produto encontrado", apesar
        // do contador no botão dizer 14.
        const rawProducts =
          tab === "items" ? itemProducts :
          tab === "combos" ? comboProducts :
          [...itemProducts, ...comboProducts];
        const displayedProducts = rawProducts.filter(p => {
          // Ocultar produtos temporários de integração (iFood, Jotajá, ONLINE) do painel visual de cardápio
          const catUpper = (p.category || "").toUpperCase();
          if (["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE"].includes(catUpper)) return false;

          if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            const matchesName = p.name.toLowerCase().includes(term);
            const matchesDesc = p.description?.toLowerCase().includes(term);
            const matchesCategory = p.category?.toLowerCase().includes(term);
            if (!matchesName && !matchesDesc && !matchesCategory) return false;
          }
          if (selectedCategoryFilter !== "TODAS") {
            if (p.category !== selectedCategoryFilter) return false;
          }
          return true;
        });

        if (displayedProducts.length === 0) {
          return (
            <div style={{ textAlign: "center", padding: "3rem 1rem", backgroundColor: "#FFF", borderRadius: "16px", border: "1px dashed #CBD5E1" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🔍</div>
              <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#334155" }}>Nenhum produto encontrado</h3>
              <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "4px 0 12px" }}>
                {searchTerm ? `Nenhum resultado para "${searchTerm}"` : "Nenhum produto nesta categoria"}
              </p>
              {(searchTerm || selectedCategoryFilter !== "TODAS") && (
                <button
                  onClick={() => { setSearchTerm(""); setSelectedCategoryFilter("TODAS"); }}
                  style={{ padding: "6px 14px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#F8FAFC", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}
                >
                  Limpar Filtros
                </button>
              )}
            </div>
          );
        }

        // Filtra as categorias ativas a exibir
        const categoriesToDisplay = dynCategories
          .filter(c => !["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE"].includes(c.name.toUpperCase()))
          .filter(c => selectedCategoryFilter === "TODAS" || c.name === selectedCategoryFilter);

        // Produtos sem categoria cadastrada ou em categoria avulsa
        const knownCatNames = new Set(dynCategories.map(c => c.name.toLowerCase().trim()));
        const uncategorizedProducts = displayedProducts.filter(p => !knownCatNames.has((p.category || "").toLowerCase().trim()));

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {categoriesToDisplay.map((cat, catIdx) => {
              const catProds = displayedProducts.filter(p => (p.category || "").toLowerCase().trim() === cat.name.toLowerCase().trim());
              if (selectedCategoryFilter === "TODAS" && searchTerm.trim() && catProds.length === 0) {
                return null; // Oculta categoria vazia durante busca específica
              }

              const isCollapsed = !!collapsedCats[cat.id];

              return (
                <div
                  key={cat.id}
                  style={{
                    background: "#FFFFFF",
                    borderRadius: "16px",
                    border: "1.5px solid #E2E8F0",
                    overflow: "hidden",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
                  }}
                >
                  {/* Cabeçalho da Categoria (iFood style) */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 18px",
                      background: "#F8FAFC",
                      borderBottom: isCollapsed ? "none" : "1.5px solid #E2E8F0",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <button
                        onClick={() => toggleCollapse(cat.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", display: "flex", alignItems: "center", padding: 0 }}
                        title={isCollapsed ? "Expandir itens" : "Recolher itens"}
                      >
                        {isCollapsed ? <ChevronDown size={22} color="#0F172A" /> : <ChevronUp size={22} color="#0F172A" />}
                      </button>

                      <div
                        onClick={() => setEditingCat({ id: cat.id, name: cat.name })}
                        style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                        title="Clique para renomear esta categoria"
                      >
                        <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>
                          {cat.emoji || "🍽️"} {cat.name}
                        </span>
                        <span style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 600 }}>
                          ({catProds.length} {catProds.length === 1 ? "item" : "itens"})
                        </span>
                        <Edit3 size={13} color="#94A3B8" />
                      </div>
                    </div>

                    {/* Ações da Categoria */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => { resetForm(); setIsCombo(true); setCategory(cat.name); setShowForm(true); }}
                        style={{ padding: "6px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", background: "#FFF", fontSize: "0.78rem", fontWeight: 700, color: "#334155", cursor: "pointer" }}
                      >
                        + Criar combo
                      </button>
                      <button
                        onClick={() => { resetForm(); setIsCombo(false); setCategory(cat.name); setShowForm(true); }}
                        style={{ padding: "6px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", background: "#FFF", fontSize: "0.78rem", fontWeight: 700, color: "#334155", cursor: "pointer" }}
                      >
                        + Criar item
                      </button>

                      <div style={{ display: "flex", gap: "3px", marginLeft: "4px" }}>
                        <button
                          onClick={() => handleMoveCategoryDirect(cat.name, "up")}
                          disabled={catIdx === 0}
                          style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid #CBD5E1", background: "#FFF", cursor: catIdx === 0 ? "not-allowed" : "pointer", opacity: catIdx === 0 ? 0.3 : 1 }}
                          title="Mover categoria para cima"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          onClick={() => handleMoveCategoryDirect(cat.name, "down")}
                          disabled={catIdx === categoriesToDisplay.length - 1}
                          style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid #CBD5E1", background: "#FFF", cursor: catIdx === categoriesToDisplay.length - 1 ? "not-allowed" : "pointer", opacity: catIdx === categoriesToDisplay.length - 1 ? 0.3 : 1 }}
                          title="Mover categoria para baixo"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>

                      <button
                        onClick={() => handleDeleteCategory(cat.id, cat.name)}
                        style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#EF4444", cursor: "pointer" }}
                        title="Excluir categoria"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Lista de Itens da Categoria */}
                  {!isCollapsed && (
                    <div style={{ padding: "10px 14px" }}>
                      {catProds.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "1.5rem", color: "#94A3B8", fontSize: "0.85rem", fontStyle: "italic" }}>
                          Nenhum produto cadastrado em <strong>"{cat.name}"</strong> ainda. Clique nos botões acima para cadastrar.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          {catProds.map(p => (
                            <div
                              key={p.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 14px",
                                background: p.active ? "#FFFFFF" : "#F8FAFC",
                                borderRadius: "12px",
                                border: !p.active ? "1.5px dashed #EF4444" : "1px solid #E2E8F0",
                                opacity: p.active ? 1 : 0.65,
                                gap: "12px",
                                flexWrap: "wrap",
                                transition: "all 0.15s ease",
                              }}
                            >
                              {/* Imagem e Detalhes */}
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: "1 1 280px", minWidth: 0 }}>
                                {p.imageUrl ? (
                                  <img src={p.imageUrl} alt={p.name} style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "10px", flexShrink: 0, border: "1px solid #E2E8F0" }} />
                                ) : (
                                  <div style={{ width: "56px", height: "56px", backgroundColor: "#F1F5F9", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <ImageIcon size={20} color="#94A3B8" />
                                  </div>
                                )}
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 800, color: "#0F172A" }}>{p.name}</h4>
                                    {p.isCombo ? (
                                      <span style={{ fontSize: "0.68rem", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: "#EFF6FF", color: "#1D4ED8", border: "1.5px solid #93C5FD", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        📦 COMBO {p.comboGroups?.length ? `• ${p.comboGroups.length} grupos` : ""}
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 6px", borderRadius: "6px", background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}>
                                        🍔 ITEM
                                      </span>
                                    )}
                                    {!p.active && (
                                      <span style={{ fontSize: "0.65rem", fontWeight: 800, padding: "2px 6px", borderRadius: "6px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>
                                        ⏸️ PAUSADO
                                      </span>
                                    )}
                                  </div>

                                  {p.description && (
                                    <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "450px" }}>
                                      {p.description}
                                    </p>
                                  )}

                                  {/* Tags e margem */}
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                                    {p.tags && (() => { try { const t = JSON.parse(p.tags); return t.map((tag: string) => (
                                      <span key={tag} style={{ fontSize: "0.62rem", fontWeight: 700, padding: "1px 6px", borderRadius: "12px", background: tag.includes("Destaque") ? "#FEF3C7" : "#F1F5F9", color: tag.includes("Destaque") ? "#92400E" : "#475569", border: `1px solid ${tag.includes("Destaque") ? "#FCD34D" : "#CBD5E1"}` }}>
                                        {tag}
                                      </span>
                                    )); } catch { return null; } })()}
                                    
                                    {p.cost > 0 && !p.isCombo && (
                                      <span style={{ fontSize: "0.62rem", background: "#F0FDF4", color: "#16A34A", border: "1px solid #BBF7D0", borderRadius: "4px", padding: "1px 5px", fontWeight: 700 }}>
                                        Margem: {(((p.price - p.cost) / p.price) * 100).toFixed(0)}%
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Canais */}
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <ChannelBadges product={p} onToggle={(key, val) => handleChannelToggle(p.id, key, val)} />
                              </div>

                              {/* Preço e Botões */}
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                                <span style={{ fontSize: "1rem", fontWeight: 900, color: "#E8360C", whiteSpace: "nowrap", marginRight: "6px" }}>
                                  R$ {p.price.toFixed(2).replace(".", ",")}
                                </span>

                                <button
                                  onClick={() => handleToggleDestaque(p)}
                                  className="btn btn-outline"
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: "0.72rem",
                                    borderColor: (p.tags && p.tags.includes("Destaque")) ? "#F59E0B" : "#CBD5E1",
                                    background: (p.tags && p.tags.includes("Destaque")) ? "#FEF3C7" : "#FFF",
                                    color: (p.tags && p.tags.includes("Destaque")) ? "#92400E" : "#64748B",
                                    fontWeight: (p.tags && p.tags.includes("Destaque")) ? 800 : 600,
                                    borderRadius: "8px",
                                  }}
                                  title="Exibir na vitrine de Destaques da Casa"
                                >
                                  ⭐ {(p.tags && p.tags.includes("Destaque")) ? "Destacado" : "Destacar"}
                                </button>

                                <button
                                  onClick={() => openRecipeModal(p.id, p.name)}
                                  className="btn btn-outline"
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: "0.72rem",
                                    borderRadius: "8px",
                                    borderColor: productsWithRecipe.has(p.id) ? "#10B981" : "#F59E0B",
                                    color: productsWithRecipe.has(p.id) ? "#10B981" : "#92400E",
                                    background: productsWithRecipe.has(p.id) ? "#F0FDF4" : "#FFFBEB",
                                    fontWeight: 700,
                                  }}
                                  title="Ficha técnica do produto"
                                >
                                  <ClipboardList size={12} style={{ marginRight: 2 }} /> {productsWithRecipe.has(p.id) ? "Ficha" : "Ficha"}
                                </button>

                                <button
                                  onClick={() => handleToggle(p.id, p.active)}
                                  className="btn btn-outline"
                                  style={{ padding: "4px 8px", fontSize: "0.72rem", borderRadius: "8px" }}
                                  title={p.active ? "Pausar vendas" : "Ativar vendas"}
                                >
                                  {p.active ? <Pause size={12} color="#64748B" /> : <Play size={12} color="#16A34A" />}
                                </button>

                                <button
                                  onClick={() => openEdit(p)}
                                  className="btn btn-outline"
                                  style={{ padding: "4px 8px", fontSize: "0.72rem", borderRadius: "8px" }}
                                  title="Editar produto"
                                >
                                  <Edit3 size={12} />
                                </button>

                                <button
                                  onClick={() => handleDelete(p.id, p.name)}
                                  className="btn btn-outline"
                                  style={{ padding: "4px 8px", fontSize: "0.72rem", borderRadius: "8px", color: "var(--danger)" }}
                                  title="Excluir produto"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Se houver produtos sem categoria correspondente */}
            {uncategorizedProducts.length > 0 && (
              <div style={{ background: "#FFFFFF", borderRadius: "16px", border: "1.5px solid #E2E8F0", overflow: "hidden" }}>
                <div style={{ padding: "12px 18px", background: "#F8FAFC", borderBottom: "1.5px solid #E2E8F0" }}>
                  <h4 style={{ margin: 0, fontWeight: 800, color: "#475569" }}>Outros Produtos ({uncategorizedProducts.length})</h4>
                </div>
                <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {uncategorizedProducts.map(p => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {p.imageUrl ? <img src={p.imageUrl} alt={p.name} style={{ width: "50px", height: "50px", objectFit: "cover", borderRadius: "8px" }} /> : null}
                        <div>
                          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800 }}>{p.name}</h4>
                          <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{p.category || "Sem categoria"}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 900, color: "#E8360C" }}>R$ {p.price.toFixed(2)}</span>
                        <button onClick={() => openEdit(p)} className="btn btn-outline" style={{ padding: "4px 8px", fontSize: "0.72rem" }}><Edit3 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* MODAL: REORDENAR CATEGORIAS */}
      {/* ─── MODAL: REORDENAR CARDÁPIO ─────────────────────────────────────
          Eram cartões de categoria empilhados numa coluna só, cada um abrindo
          os produtos dentro de si como sanfona. Com 9 categorias a lista não
          cabia — e como o contêiner era `flex-direction: column` com
          `overflow-y: auto` SEM `flex-shrink: 0` nos filhos, os cartões eram
          espremidos abaixo da altura natural: o texto de um vazava por cima do
          outro e a tela ficava ilegível.

          Agora são duas colunas: a barra de categorias à esquerda e, ao clicar
          numa delas, os produtos daquela categoria ao lado. Cada coluna rola
          por conta própria, e as linhas não encolhem mais.

          Reordenar tem os dois caminhos: as setas, e arrastar segurando a alça
          — que funciona com mouse e com o dedo, porque usa Pointer Events. */}
      {showReorderModal && (() => {
        const chaveSelecionada =
          expandedReorderCat ?? (reorderList[0] ? (reorderList[0].name || "").toLowerCase().trim() : null);
        const catSelecionada = reorderList.find(
          c => (c.name || "").toLowerCase().trim() === chaveSelecionada
        );
        // Amarrado à categoria ENCONTRADA, não só à chave: se a categoria for
        // renomeada ou removida com o modal aberto, a chave continua apontando
        // para produtos que não têm mais dona — e as setas chamariam
        // `catSelecionada.name` num undefined.
        const produtosDaCat = catSelecionada && chaveSelecionada ? (reorderProducts[chaveSelecionada] || []) : [];

        const estiloAlca = {
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "26px", height: "26px", flexShrink: 0,
          borderRadius: "7px", border: "1px solid #E2E8F0", background: "#F8FAFC",
          color: "#94A3B8", cursor: "grab",
          // Sem isto o navegador entende o gesto como rolagem e o arrasto nunca
          // começa num tablet.
          touchAction: "none" as const,
        };

        const estiloSeta = (desativada: boolean) => ({
          padding: "4px 6px", borderRadius: "6px", border: "1px solid #CBD5E1",
          background: "#FFF", cursor: desativada ? "not-allowed" : "pointer",
          opacity: desativada ? 0.3 : 1, display: "flex", alignItems: "center",
        });

        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.75)", backdropFilter: "blur(8px)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ background: "#FFFFFF", borderRadius: "24px", width: "100%", maxWidth: "980px", height: "min(88vh, 780px)", padding: "1.5rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)", position: "relative", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <style>{`
              .reordenar-corpo {
                display: grid;
                grid-template-columns: 300px 1fr;
                gap: 12px;
                flex: 1;
                min-height: 0;
              }
              .reordenar-coluna {
                display: flex;
                flex-direction: column;
                min-height: 0;
                border: 1.5px solid #E2E8F0;
                border-radius: 14px;
                overflow: hidden;
                background: #FFF;
              }
              .reordenar-lista {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                padding: 8px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                /* Arrastar com o mouse selecionaria o texto das linhas pelo
                   caminho, pintando a lista de azul enquanto o gesto acontece —
                   parece defeito. Numa lista que só serve para ordenar, não há
                   nada para selecionar. */
                user-select: none;
                -webkit-user-select: none;
              }
              /* Duas colunas não cabem em tablet retrato: vira uma só, cada
                 metade com altura própria para as duas continuarem visíveis. */
              @media (max-width: 860px) {
                .reordenar-corpo { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
              }
              /* 44px é o alvo de toque recomendado — o mesmo que a tela de mesas
                 já adota. Setas de 24px são impossíveis de acertar com o dedo. */
              @media (pointer: coarse) {
                .reordenar-lista button { min-height: 44px; }
              }
            `}</style>

            <button onClick={() => setShowReorderModal(false)} style={{ position: "absolute", top: "1.1rem", right: "1.1rem", background: "#F1F5F9", border: "none", borderRadius: "50%", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748B", zIndex: 2 }}>
              <X size={18} />
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "13px", background: "linear-gradient(135deg, #EDE9FE, #DDD6FE)", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <ArrowUpDown size={21} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
                  Reordenar Cardápio
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Arraste pela alça <ArrowUpDown size={11} style={{ verticalAlign: "-1px" }} /> ou use as setas. Clique numa categoria para ordenar o que está dentro dela.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "0.75rem 0", padding: "7px 12px", background: "#F8FAFC", borderRadius: "10px", border: "1px solid #E2E8F0", fontSize: "0.76rem", fontWeight: 700, color: "#475569", flexShrink: 0, flexWrap: "wrap" }}>
              <span>📁 {reorderList.length} categorias</span>
              <span>•</span>
              <span>🍔 {products.filter(p => !p.isCombo && !isHiddenIntegrationItem(p)).length} itens</span>
              <span>•</span>
              <span>📦 {products.filter(p => p.isCombo && !isHiddenIntegrationItem(p)).length} combos</span>
              {categoriasMexidas.size > 0 && (
                <span style={{ marginLeft: "auto", color: "#059669", background: "#D1FAE5", padding: "2px 8px", borderRadius: "6px", fontWeight: 900 }}>
                  {categoriasMexidas.size} {categoriasMexidas.size === 1 ? "categoria alterada" : "categorias alteradas"}
                </span>
              )}
            </div>

            <div className="reordenar-corpo">

              {/* ── Coluna 1: as categorias ── */}
              <div className="reordenar-coluna">
                <div style={{ padding: "9px 12px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", fontSize: "0.76rem", fontWeight: 900, color: "#334155", flexShrink: 0 }}>
                  CATEGORIAS
                </div>
                <div className="reordenar-lista">
                  {reorderList.map((cat, idx) => {
                    const chave = (cat.name || "").toLowerCase().trim();
                    const selecionada = chave === chaveSelecionada;
                    const arrastando = arrasto?.lista === "categoria" && arrasto.idx === idx;
                    const qtd = (reorderProducts[chave] || []).length;

                    return (
                      <div
                        key={cat.id || cat.name}
                        data-ordem-lista="categoria"
                        data-ordem-idx={idx}
                        onClick={() => setExpandedReorderCat(chave)}
                        style={{
                          display: "flex", alignItems: "center", gap: "7px",
                          padding: "7px 8px", borderRadius: "10px",
                          border: selecionada ? "1.5px solid #7C3AED" : "1.5px solid #E2E8F0",
                          background: selecionada ? "#F5F3FF" : "#FFF",
                          cursor: "pointer",
                          // O que faltava: sem isto o flex espreme as linhas
                          // abaixo da altura natural e um texto vaza sobre o outro.
                          flexShrink: 0,
                          opacity: arrastando ? 0.45 : 1,
                          boxShadow: arrastando ? "0 6px 18px rgba(124,58,237,0.25)" : "none",
                        }}
                      >
                        <span
                          onPointerDown={e => { e.stopPropagation(); setArrasto({ lista: "categoria", idx }); }}
                          title="Segure e arraste para mover"
                          style={estiloAlca}
                        >
                          <ArrowUpDown size={13} />
                        </span>

                        <span style={{ fontSize: "0.72rem", fontWeight: 900, color: "#7C3AED", background: "#EDE9FE", padding: "3px 6px", borderRadius: "6px", flexShrink: 0 }}>
                          {idx + 1}º
                        </span>

                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>
                          {cat.emoji || "🍽️"} {cat.name}
                          <span style={{ marginLeft: "6px", fontSize: "0.7rem", fontWeight: 600, color: "#94A3B8" }}>
                            {qtd}
                          </span>
                          {categoriasMexidas.has(chave) && (
                            <span style={{ marginLeft: "5px", fontSize: "0.62rem", fontWeight: 900, color: "#059669", background: "#D1FAE5", padding: "1px 5px", borderRadius: "5px" }}>
                              ✓
                            </span>
                          )}
                        </span>

                        <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                          <button type="button" title="Subir 1 posição" disabled={idx === 0}
                            onClick={e => { e.stopPropagation(); moveReorderItem(idx, idx - 1); }}
                            style={estiloSeta(idx === 0)}>
                            <ArrowUp size={13} />
                          </button>
                          <button type="button" title="Descer 1 posição" disabled={idx === reorderList.length - 1}
                            onClick={e => { e.stopPropagation(); moveReorderItem(idx, idx + 1); }}
                            style={estiloSeta(idx === reorderList.length - 1)}>
                            <ArrowDown size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Coluna 2: os produtos da categoria escolhida ── */}
              <div className="reordenar-coluna">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 12px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", flexShrink: 0, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.76rem", fontWeight: 900, color: "#334155", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {catSelecionada ? `${catSelecionada.emoji || "🍽️"} ${(catSelecionada.name || "").toUpperCase()}` : "SELECIONE UMA CATEGORIA"}
                  </span>
                  {catSelecionada && produtosDaCat.length > 0 && (
                    <>
                      <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 700 }}>
                        {produtosDaCat.length} {produtosDaCat.length === 1 ? "produto" : "produtos"}
                      </span>
                      <button
                        type="button"
                        onClick={() => resetProductOrder(catSelecionada.name)}
                        title="Voltar à ordem alfabética"
                        style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: "7px", border: "1px solid #CBD5E1", background: "#FFF", fontSize: "0.7rem", fontWeight: 800, color: "#64748B", cursor: "pointer" }}
                      >
                        A→Z
                      </button>
                    </>
                  )}
                </div>

                <div className="reordenar-lista">
                  {!catSelecionada && (
                    <p style={{ margin: "auto", fontSize: "0.82rem", color: "#94A3B8", textAlign: "center" }}>
                      Clique numa categoria ao lado.
                    </p>
                  )}
                  {catSelecionada && produtosDaCat.length === 0 && (
                    <p style={{ margin: "auto", fontSize: "0.82rem", color: "#94A3B8", textAlign: "center" }}>
                      Nenhum produto nesta categoria.
                    </p>
                  )}

                  {produtosDaCat.map((prod, pIdx) => {
                    const arrastando = arrasto?.lista === "produto" && arrasto.idx === pIdx;
                    return (
                      <div
                        key={prod.id}
                        data-ordem-lista="produto"
                        data-ordem-idx={pIdx}
                        style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "6px 8px", background: "#FFF",
                          border: "1.5px solid #E9E5F8", borderRadius: "10px",
                          flexShrink: 0,
                          opacity: arrastando ? 0.45 : 1,
                          boxShadow: arrastando ? "0 6px 18px rgba(124,58,237,0.25)" : "none",
                        }}
                      >
                        <span
                          onPointerDown={() => setArrasto({ lista: "produto", idx: pIdx })}
                          title="Segure e arraste para mover"
                          style={estiloAlca}
                        >
                          <ArrowUpDown size={13} />
                        </span>

                        <span style={{ fontSize: "0.72rem", fontWeight: 900, color: "#6D28D9", minWidth: "24px", flexShrink: 0 }}>
                          {pIdx + 1}º
                        </span>

                        {prod.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={prod.imageUrl} alt="" style={{ width: "28px", height: "28px", borderRadius: "7px", objectFit: "cover", flexShrink: 0 }} />
                        )}

                        <span style={{ flex: 1, minWidth: 0, fontSize: "0.83rem", fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {prod.name}
                          {prod.isCombo && (
                            <span style={{ marginLeft: "6px", fontSize: "0.62rem", fontWeight: 800, color: "#7C3AED", background: "#EDE9FE", padding: "1px 5px", borderRadius: "5px" }}>
                              COMBO
                            </span>
                          )}
                        </span>

                        <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                          <button type="button" title="Mover para o topo" disabled={pIdx === 0}
                            onClick={() => moveProductInCat(catSelecionada.name, pIdx, 0)}
                            style={estiloSeta(pIdx === 0)}>
                            <ChevronsUp size={13} />
                          </button>
                          <button type="button" title="Subir 1 posição" disabled={pIdx === 0}
                            onClick={() => moveProductInCat(catSelecionada.name, pIdx, pIdx - 1)}
                            style={estiloSeta(pIdx === 0)}>
                            <ArrowUp size={13} />
                          </button>
                          <button type="button" title="Descer 1 posição" disabled={pIdx === produtosDaCat.length - 1}
                            onClick={() => moveProductInCat(catSelecionada.name, pIdx, pIdx + 1)}
                            style={estiloSeta(pIdx === produtosDaCat.length - 1)}>
                            <ArrowDown size={13} />
                          </button>
                          <button type="button" title="Mover para o fim" disabled={pIdx === produtosDaCat.length - 1}
                            onClick={() => moveProductInCat(catSelecionada.name, pIdx, produtosDaCat.length - 1)}
                            style={estiloSeta(pIdx === produtosDaCat.length - 1)}>
                            <ChevronsDown size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "0.9rem", paddingTop: "0.75rem", borderTop: "1px solid #E2E8F0", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowReorderModal(false)}
                style={{ flex: 1, padding: "11px", borderRadius: "12px", border: "1.5px solid #CBD5E1", background: "#FFF", fontWeight: 700, color: "#64748B", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleSaveReorder()}
                disabled={savingReorder}
                style={{ flex: 2, padding: "11px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #7C3AED, #6D28D9)", color: "#FFF", fontWeight: 900, cursor: savingReorder ? "not-allowed" : "pointer", boxShadow: "0 4px 14px rgba(124,58,237,0.35)", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              >
                {savingReorder ? (
                  <>
                    <div style={{ width: "16px", height: "16px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#FFF", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                    Salvando no Cardápio...
                  </>
                ) : (
                  "💾 Salvar Ordem do Cardápio"
                )}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* MODAL: RENOMEAR CATEGORIA */}
      {editingCat && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ background: "#FFFFFF", borderRadius: "20px", width: "100%", maxWidth: "420px", padding: "1.75rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 1rem", fontSize: "1.15rem", fontWeight: 800, color: "#0F172A" }}>
              ✏️ Renomear Categoria
            </h3>
            <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "6px" }}>
              Nome da Categoria
            </label>
            <input
              type="text"
              value={editingCat.name}
              onChange={e => setEditingCat({ ...editingCat, name: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 700, outline: "none", boxSizing: "border-box" }}
              autoFocus
            />
            <div style={{ display: "flex", gap: "10px", marginTop: "1.5rem" }}>
              <button
                onClick={() => setEditingCat(null)}
                style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1.5px solid #CBD5E1", background: "#FFF", fontWeight: 700, color: "#64748B", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleRenameCategory}
                disabled={savingRename}
                style={{ flex: 1.5, padding: "10px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #E8360C, #C62828)", color: "#FFF", fontWeight: 800, cursor: savingRename ? "not-allowed" : "pointer" }}
              >
                {savingRename ? "Salvando..." : "Salvar Nome"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FICHA TÉCNICA (Recipe Editor) */}
      {showRecipeModal && recipeProductId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={() => setShowRecipeModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "1.25rem", width: "100%", maxWidth: "680px", padding: "1.75rem", position: "relative", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", animation: "slideUpFade 0.3s ease-out", maxHeight: "90vh", overflowY: "auto" }}>
            <button onClick={() => setShowRecipeModal(false)} style={{ position: "absolute", top: "1rem", right: "1rem", background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: "0.25rem", borderRadius: "0.25rem" }}><X size={20} /></button>
            
            <div style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0f172a", margin: 0 }}>📋 Ficha Técnica</h2>
              <p style={{ fontSize: "0.88rem", color: "#475569", margin: "0.35rem 0 0 0" }}>Produto: <strong>{recipeProductName}</strong></p>
              <p style={{ fontSize: "0.75rem", color: "#94a3b8", margin: "0.25rem 0 0 0" }}>Defina os insumos consumidos por unidade vendida deste produto. Isso permite a baixa automática do estoque a cada venda.</p>
            </div>

            {recipeLoading ? (
              <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
                <div style={{ width: "36px", height: "36px", border: "3px solid #f1f5f9", borderTopColor: "#2563eb", borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 1rem" }} />
                <p style={{ color: "#64748b", fontSize: "0.85rem" }}>Carregando...</p>
              </div>
            ) : (
              <>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "0.75rem", overflow: "hidden", marginBottom: "1rem", maxHeight: "320px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>Ingrediente/Insumo</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 700, color: "#475569", borderBottom: "1px solid #e2e8f0", textAlign: "left", width: "180px" }}>Qtd. por Venda</th>
                        <th style={{ padding: "0.75rem", borderBottom: "1px solid #e2e8f0", width: "40px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipeIngredients.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: "0.65rem 1rem", borderBottom: "1px solid #f1f5f9" }}>
                            <select
                              value={row.stockItemId}
                              onChange={e => {
                                const next = [...recipeIngredients];
                                next[idx].stockItemId = e.target.value;
                                if (e.target.value !== 'NEW') { next[idx].newItemName = ""; }
                                setRecipeIngredients(next);
                              }}
                              style={{ width: "100%", padding: "0.5rem", borderRadius: "0.38rem", border: "1.5px solid #cbd5e1", fontSize: "0.82rem", fontWeight: 600, background: "#f8fafc" }}
                            >
                              <option value="">Selecione...</option>
                              {recipeStockItems.map(si => (
                                <option key={si.id} value={si.id}>{si.name} ({si.unit})</option>
                              ))}
                              <option value="NEW">➕ Criar novo insumo...</option>
                            </select>
                            {row.stockItemId === 'NEW' && (
                              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                                <input
                                  type="text" placeholder="Nome do insumo"
                                  value={row.newItemName}
                                  onChange={e => { const n = [...recipeIngredients]; n[idx].newItemName = e.target.value; setRecipeIngredients(n); }}
                                  style={{ flex: 1, padding: "0.45rem 0.6rem", border: "1.5px solid #cbd5e1", borderRadius: "0.38rem", fontSize: "0.8rem", fontWeight: 600 }}
                                />
                                <select
                                  value={row.newItemUnit}
                                  onChange={e => { const n = [...recipeIngredients]; n[idx].newItemUnit = e.target.value; setRecipeIngredients(n); }}
                                  style={{ width: "80px", padding: "0.45rem", border: "1.5px solid #cbd5e1", borderRadius: "0.38rem", fontSize: "0.8rem", fontWeight: 600 }}
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
                          <td style={{ padding: "0.65rem 1rem", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                              <input
                                type="number" step="0.001" min="0.001" placeholder="Ex: 50"
                                value={row.quantityConsumed}
                                onChange={e => { const n = [...recipeIngredients]; n[idx].quantityConsumed = e.target.value; setRecipeIngredients(n); }}
                                style={{ width: "100%", padding: "0.5rem", paddingRight: "2rem", borderRadius: "0.38rem", border: "1.5px solid #cbd5e1", fontSize: "0.82rem", fontWeight: 600 }}
                              />
                              <span style={{ position: "absolute", right: "0.6rem", fontSize: "0.72rem", fontWeight: 800, color: "#64748b", pointerEvents: "none" }}>
                                {row.stockItemId === 'NEW' ? row.newItemUnit : (recipeStockItems.find(s => s.id === row.stockItemId)?.unit || "un")}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: "0.65rem 0.5rem", borderBottom: "1px solid #f1f5f9" }}>
                            <button onClick={() => {
                              const n = [...recipeIngredients];
                              n.splice(idx, 1);
                              setRecipeIngredients(n.length > 0 ? n : [{ stockItemId: "", quantityConsumed: "", newItemName: "", newItemUnit: "g" }]);
                            }} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: "0.3rem", borderRadius: "0.25rem", display: "flex" }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
                  <button onClick={() => setRecipeIngredients([...recipeIngredients, { stockItemId: "", quantityConsumed: "", newItemName: "", newItemUnit: "g" }])}
                    style={{ border: "1.5px dashed #2563eb", background: "none", color: "#2563eb", fontWeight: 700, fontSize: "0.82rem", padding: "0.5rem 1rem", borderRadius: "0.5rem", cursor: "pointer" }}>
                    + Adicionar Ingrediente
                  </button>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button onClick={() => setShowRecipeModal(false)}
                      style={{ background: "#f1f5f9", color: "#475569", border: "none", padding: "0.55rem 1.1rem", borderRadius: "0.5rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                      Cancelar
                    </button>
                    <button onClick={handleSaveRecipe} disabled={recipeSaving}
                      style={{ background: "#2563eb", color: "white", border: "none", padding: "0.55rem 1.1rem", borderRadius: "0.5rem", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", opacity: recipeSaving ? 0.6 : 1 }}>
                      {recipeSaving ? "Salvando..." : "💾 Salvar Ficha Técnica"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
