"use client";

import React, { useState, useEffect } from "react";
import { 
  Package, Database, History, ClipboardList, Plus, 
  Trash2, ArrowUpRight, ArrowDownRight, AlertTriangle, 
  Settings, Check, X, Search, Info, RefreshCw
} from "lucide-react";

interface EstoqueClientProps {
  userName: string;
  storeName: string;
}

interface StockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  minQuantity: number | null;
}

interface Transaction {
  id: string;
  createdAt: string;
  quantity: number;
  type: string;
  notes: string | null;
  stockItem: {
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

export default function EstoqueClient({ userName, storeName }: EstoqueClientProps) {
  const [activeTab, setActiveTab] = useState<"items" | "history" | "recipes">("items");
  const [loading, setLoading] = useState<boolean>(true);
  
  // Data States
  const [items, setItems] = useState<StockItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  
  // Search & Filter
  const [itemSearch, setItemSearch] = useState<string>("");
  const [productSearch, setProductSearch] = useState<string>("");

  // Modais
  const [showItemModal, setShowItemModal] = useState<boolean>(false);
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showRecipeModal, setShowRecipeModal] = useState<boolean>(false);

  // Form States - Novo Item
  const [newItemName, setNewItemName] = useState<string>("");
  const [newItemQty, setNewItemQty] = useState<string>("");
  const [newItemUnit, setNewItemUnit] = useState<string>("g");
  const [newItemMin, setNewItemMin] = useState<string>("");

  // Form States - Movimentação
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [moveQty, setMoveQty] = useState<string>("");
  const [moveType, setMoveType] = useState<string>("INPUT"); // INPUT, OUTPUT, WASTE
  const [moveNotes, setMoveNotes] = useState<string>("");

  // Form States - Receita / Ficha Técnica
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(null);
  const [recipeIngredients, setRecipeIngredients] = useState<Array<{ stockItemId: string; quantityConsumed: string }>>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "items") {
        const res = await fetch("/api/store/estoque/items");
        const data = await res.json();
        if (data.success) setItems(data.items);
      } else if (activeTab === "history") {
        const res = await fetch("/api/store/estoque/transactions");
        const data = await res.json();
        if (data.success) setTransactions(data.transactions);
      } else if (activeTab === "recipes") {
        const res = await fetch("/api/store/estoque/recipes");
        const data = await res.json();
        if (data.success) {
          setProducts(data.menuProducts);
          setItems(data.stockItems); // Mantém estoque atualizado para o dropdown
        }
      }
    } catch (err) {
      console.error("Erro ao carregar dados do estoque:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Handler - Criar Ingrediente
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
          minQuantity: newItemMin ? parseFloat(newItemMin) : null
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
      loadData();
    } catch (err) {
      alert("Erro ao enviar dados.");
    }
  };

  // Handler - Excluir Ingrediente
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

  // Handler - Registrar Movimentação
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

  // Abrir Modal de Ficha Técnica
  const openRecipeEditor = (product: MenuProduct) => {
    setSelectedProduct(product);
    const existingRecipe = product.recipeItems.map(ri => ({
      stockItemId: ri.stockItemId,
      quantityConsumed: String(ri.quantityConsumed)
    }));
    setRecipeIngredients(existingRecipe.length > 0 ? existingRecipe : [{ stockItemId: "", quantityConsumed: "" }]);
    setShowRecipeModal(true);
  };

  // Adicionar Linha de Receita
  const addRecipeRow = () => {
    setRecipeIngredients([...recipeIngredients, { stockItemId: "", quantityConsumed: "" }]);
  };

  // Remover Linha de Receita
  const removeRecipeRow = (index: number) => {
    const next = [...recipeIngredients];
    next.splice(index, 1);
    setRecipeIngredients(next.length > 0 ? next : [{ stockItemId: "", quantityConsumed: "" }]);
  };

  // Atualizar Linha de Receita
  const updateRecipeRow = (index: number, field: "stockItemId" | "quantityConsumed", val: string) => {
    const next = [...recipeIngredients];
    next[index][field] = val;
    setRecipeIngredients(next);
  };

  // Handler - Salvar Receita
  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    // Filtra apenas linhas válidas
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

  const getTransactionBadge = (type: string) => {
    switch (type) {
      case "INPUT":
        return <span className="badge badge-success">Entrada</span>;
      case "OUTPUT":
        return <span className="badge badge-error">Saída</span>;
      case "WASTE":
        return <span className="badge badge-warning">Desperdício</span>;
      case "SALE":
        return <span className="badge badge-sale">Venda</span>;
      default:
        return <span className="badge">{type}</span>;
    }
  };

  const formatQuantity = (qty: number, unit: string) => {
    return `${qty.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`;
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const filteredProducts = products.filter(prod => 
    prod.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <div className="estoque-container">
      {/* BANNER HEADER */}
      <div className="header-card">
        <div className="header-glow"></div>
        <div className="header-content">
          <div className="header-info">
            <span className="badge-exclusive">📦 MÓDULO INTEGRADO</span>
            <h1>Controle de Estoque</h1>
            <p>Ajuste saldo de insumos, gerencie receitas e acompanhe baixas automáticas de vendas de <strong>{storeName}</strong>.</p>
          </div>
          <div className="header-actions">
            <button className="btn-refresh" onClick={loadData}>
              <RefreshCw size={16} />
            </button>
            <button className="btn-primary" onClick={() => setShowItemModal(true)}>
              <Plus size={16} /> Novo Insumo
            </button>
          </div>
        </div>
      </div>

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
          className={`tab-link ${activeTab === "history" ? "active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          <History size={16} />
          Histórico de Movimentações
        </button>
        <button 
          className={`tab-link ${activeTab === "recipes" ? "active" : ""}`}
          onClick={() => setActiveTab("recipes")}
        >
          <ClipboardList size={16} />
          Ficha Técnica (Receitas)
        </button>
      </div>

      {/* SEARCH AND LOADING STATEMENTS */}
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Carregando registros de estoque...</p>
        </div>
      ) : (
        <div className="tab-body">
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
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map(item => {
                        const isLow = item.minQuantity !== null && item.quantity <= item.minQuantity;
                        return (
                          <tr key={item.id} className={isLow ? "low-stock-tr" : ""}>
                            <td className="name-col">{item.name}</td>
                            <td className="qty-col">{formatQuantity(item.quantity, item.unit)}</td>
                            <td>{item.minQuantity !== null ? formatQuantity(item.minQuantity, item.unit) : "—"}</td>
                            <td>
                              {isLow ? (
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

          {/* TAB 2: HISTORY */}
          {activeTab === "history" && (
            <>
              {transactions.length === 0 ? (
                <div className="empty-state">
                  <History size={48} />
                  <h3>Nenhuma movimentação registrada</h3>
                  <p>Movimentações manuais ou automáticas por vendas aparecerão listadas aqui.</p>
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
                      {transactions.map(t => {
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

          {/* TAB 3: RECIPES */}
          {activeTab === "recipes" && (
            <>
              <div className="search-bar">
                <Search size={18} className="search-icon" />
                <input 
                  type="text" 
                  placeholder="Pesquisar produto do cardápio..." 
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                />
              </div>

              {filteredProducts.length === 0 ? (
                <div className="empty-state">
                  <ClipboardList size={48} />
                  <h3>Nenhum produto encontrado</h3>
                  <p>Certifique-se de cadastrar produtos no Cardápio da sua loja antes de configurar receitas.</p>
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

              <div className="form-group">
                <label>Estoque Mínimo (Alerta)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  min="0"
                  placeholder="Ex: 200 (Alerta abaixo de 200g)" 
                  value={newItemMin}
                  onChange={e => setNewItemMin(e.target.value)}
                />
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
                    📈 Entrada (Compra)
                  </label>
                  <label className={`radio-label ${moveType === "OUTPUT" ? "selected" : ""}`}>
                    <input 
                      type="radio" 
                      name="moveType" 
                      value="OUTPUT" 
                      checked={moveType === "OUTPUT"}
                      onChange={e => setMoveType(e.target.value)}
                    />
                    📉 Saída (Ajuste)
                  </label>
                  <label className={`radio-label ${moveType === "WASTE" ? "selected" : ""}`}>
                    <input 
                      type="radio" 
                      name="moveType" 
                      value="WASTE" 
                      checked={moveType === "WASTE"}
                      onChange={e => setMoveType(e.target.value)}
                    />
                    🗑️ Desperdício
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

        /* SEARCH BAR */
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

        /* TABLES */
        .items-table-wrapper {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 1rem;
          overflow: hidden;
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

        .items-table tr.low-stock-tr {
          background: #fffbeb;
        }

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

        .status-ok {
          background: #dcfce7;
          color: #15803d;
        }

        .status-low {
          background: #fef3c7;
          color: #b45309;
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

        .btn-move {
          background: #eff6ff;
          color: #2563eb;
        }

        .btn-move:hover {
          background: #dbeafe;
        }

        .btn-delete {
          background: #fee2e2;
          color: #dc2626;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.45rem;
        }

        .btn-delete:hover {
          background: #fecaca;
        }

        /* RECIPES CONFIG GRID */
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

        .card-header-prod h3 {
          margin: 0.25rem 0 0 0;
          font-size: 1rem;
          font-weight: 800;
          color: #0f172a;
        }

        .prod-category {
          font-size: 0.65rem;
          font-weight: 800;
          text-transform: uppercase;
          color: #64748b;
          letter-spacing: 0.05em;
        }

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

        .btn-configure:hover {
          border-color: #2563eb;
          color: #2563eb;
        }

        .card-body-recipe {
          padding: 1.25rem;
          flex: 1;
        }

        .card-body-recipe h4 {
          margin: 0 0 0.75rem 0;
          font-size: 0.78rem;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .no-ingredients {
          font-size: 0.8rem;
          color: #94a3b8;
          font-style: italic;
          margin: 0.5rem 0;
          line-height: 1.4;
        }

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

        .ingredients-list li:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

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

        .empty-state h3 {
          margin: 0.75rem 0 0.25rem 0;
          font-weight: 800;
          color: #334155;
        }

        .empty-state p {
          font-size: 0.85rem;
          margin: 0;
        }

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
        }

        .modal-card.modal-large {
          max-width: 720px;
        }

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

        .btn-close:hover {
          background: #f1f5f9;
        }

        .modal-card h2 {
          font-size: 1.25rem;
          font-weight: 900;
          color: #0f172a;
          margin: 0 0 1.25rem 0;
        }

        .modal-subtitle {
          font-size: 0.88rem;
          color: #475569;
          margin: -0.85rem 0 1.25rem 0;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          margin-bottom: 1.15rem;
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .form-group label {
          font-size: 0.78rem;
          font-weight: 700;
          color: #475569;
          text-transform: uppercase;
        }

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

        .form-group input:focus,
        .form-group select:focus {
          border-color: #2563eb;
          background: white;
        }

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

        .btn-submit:hover {
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

        .radio-group-types {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .radio-label {
          flex: 1;
          min-width: 120px;
          display: flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.7rem 0.5rem;
          border: 1.5px solid #e2e8f0;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          background: #f8fafc;
          justify-content: center;
        }

        .radio-label input {
          display: none;
        }

        .radio-label.selected {
          border-color: #2563eb;
          background: #eff6ff;
          color: #2563eb;
        }

        /* RECIPE EDITOR */
        .recipe-rows-container {
          max-height: 350px;
          overflow-y: auto;
          margin-bottom: 1.25rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.75rem;
        }

        .recipe-editor-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }

        .recipe-editor-table th {
          background: #f8fafc;
          padding: 0.75rem 1rem;
          font-weight: 700;
          color: #475569;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
        }

        .recipe-editor-table td {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid #f1f5f9;
        }

        .recipe-editor-table select,
        .recipe-editor-table input {
          width: 100%;
          padding: 0.6rem;
          border-radius: 0.38rem;
          border: 1.5px solid #cbd5e1;
          font-size: 0.82rem;
          font-weight: 600;
          outline: none;
        }

        .qty-input-unit {
          position: relative;
          display: flex;
          align-items: center;
        }

        .qty-input-unit input {
          padding-right: 2.25rem;
        }

        .unit-label {
          position: absolute;
          right: 0.6rem;
          font-size: 0.75rem;
          font-weight: 800;
          color: #64748b;
          pointer-events: none;
        }

        .btn-remove-row {
          background: none;
          border: none;
          color: #dc2626;
          cursor: pointer;
          padding: 0.4rem;
          border-radius: 0.38rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-remove-row:hover {
          background: #fee2e2;
        }

        .recipe-footer-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .btn-add-ingredient {
          border: 1.5px dashed #2563eb;
          background: none;
          color: #2563eb;
          font-weight: 700;
          font-size: 0.82rem;
          padding: 0.55rem 1.1rem;
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-add-ingredient:hover {
          background: #eff6ff;
        }

        .footer-right-buttons {
          display: flex;
          gap: 0.5rem;
        }

        .btn-secondary {
          background: #f1f5f9;
          color: #475569;
          border: none;
          padding: 0.6rem 1.25rem;
          border-radius: 0.5rem;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
        }

        .btn-secondary:hover {
          background: #e2e8f0;
        }

        .btn-submit-recipe {
          background: #2563eb;
          color: white;
          border: none;
          padding: 0.6rem 1.25rem;
          border-radius: 0.5rem;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
        }

        .btn-submit-recipe:hover {
          background: #1d4ed8;
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            align-items: flex-start;
          }
          .header-actions {
            width: 100%;
          }
          .btn-primary {
            flex: 1;
            justify-content: center;
          }
          .form-row {
            grid-template-columns: 1fr;
            gap: 0;
          }
        }
      `}</style>
    </div>
  );
}
