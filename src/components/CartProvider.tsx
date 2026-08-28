"use client";

import { createContext, useContext, useState, useEffect } from "react";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type CartContextType = {
  items: CartItem[];
  addToCart: (product: any, quantity: number) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  total: number;
  isLoaded: boolean;
  /** Itens cujo preço foi atualizado sozinho ao abrir o carrinho. */
  precosMudaram: { nome: string; de: number; para: number }[];
  limparAvisoDePreco: () => void;
};

const STORAGE_KEY = "icebox_cart";

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  /** O que mudou de preço desde que entrou no carrinho — a tela avisa. */
  const [precosMudaram, setPrecosMudaram] = useState<{ nome: string; de: number; para: number }[]>([]);

  // Carrega do localStorage ao montar (client-side only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setItems(parsed);
        }
      }
    } catch (_) {}
    setIsLoaded(true);
  }, []);

  // Salva no localStorage a cada alteração (somente após carregar a carga inicial)
  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (_) {}
  }, [items, isLoaded]);

  /**
   * ── O CARRINHO ATUALIZA O PREÇO SOZINHO ──────────────────────────────────
   *
   * O preço era gravado no localStorage no momento em que o item entrava no
   * carrinho e NUNCA mais mudava. Depois de um reajuste, o catálogo mostrava o
   * valor novo e o carrinho o velho — e o checkout recusava com "os preços
   * foram atualizados, recarregue a página e verifique seu carrinho".
   *
   * Só que recarregar não resolvia nada: o carrinho relê o mesmo localStorage e
   * volta com os mesmos preços velhos. O cliente ficava preso num laço, sem
   * nenhuma saída pela tela. Um reajuste travava o pedido de todo mundo que já
   * tinha aquele produto no carrinho — e ninguém ligava uma coisa na outra.
   *
   * Roda ao abrir e ao voltar para a aba: carrinho parado três dias não pode
   * finalizar com preço de três dias atrás.
   */
  useEffect(() => {
    if (!isLoaded) return;

    let cancelado = false;

    const atualizarPrecos = async () => {
      const ids = items.map((i) => i.id);
      if (ids.length === 0) return;
      try {
        const res = await fetch("/api/products/precos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) return;
        const d = await res.json();
        const atual = new Map<string, number>((d.produtos || []).map((p: any) => [p.id, p.price]));
        if (cancelado) return;

        const mudancas: { nome: string; de: number; para: number }[] = [];
        setItems((prev) => {
          let mexeu = false;
          const novos = prev.map((item) => {
            const preco = atual.get(item.id);
            if (preco === undefined || preco === item.price) return item;
            mudancas.push({ nome: item.name, de: item.price, para: preco });
            mexeu = true;
            return { ...item, price: preco };
          });
          return mexeu ? novos : prev;
        });
        if (mudancas.length > 0) setPrecosMudaram(mudancas);
      } catch (_) {
        // Sem rede: segue com o que tem. O checkout ainda protege — ele
        // recalcula pelo banco e recusa divergência.
      }
    };

    atualizarPrecos();
    const aoVoltar = () => { if (document.visibilityState === "visible") atualizarPrecos(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { cancelado = true; document.removeEventListener("visibilitychange", aoVoltar); };
    // Só na carga e ao voltar para a aba: depender de `items` faria a busca
    // rodar a cada clique de + e −.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const addToCart = (product: any, quantity: number) => {
    setItems((prev) => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + quantity, price: product.price } : item);
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, quantity }];
    });
  };

  const removeFromCart = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const clearCart = () => {
    setItems([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  };

  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, clearCart, total, isLoaded, precosMudaram, limparAvisoDePreco: () => setPrecosMudaram([]) }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}

