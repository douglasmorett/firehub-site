"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminUpdateOrderItems } from "@/app/actions/adminOrderEdit";
import { Trash2, Plus, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function EditOrderForm({ order, products }: { order: any, products: any[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState(order.items.map((i: any) => ({
    id: i.id, // we can keep id if existing
    productId: i.productId,
    quantity: i.quantity,
    price: i.price,
    product: i.product
  })));

  const handleAddProduct = () => {
    if (products.length === 0) return;
    setItems([...items, {
      id: `new-${Date.now()}`,
      productId: products[0].id,
      quantity: 1,
      price: products[0].price,
      product: products[0]
    }]);
  };

  const handleProductChange = (index: number, productId: string) => {
    const newItems = [...items];
    const p = products.find(prod => prod.id === productId);
    if (p) {
      newItems[index].productId = p.id;
      newItems[index].price = p.price;
      newItems[index].product = p;
    }
    setItems(newItems);
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const newItems = [...items];
    newItems[index].quantity = quantity;
    setItems(newItems);
  };

  const handlePriceChange = (index: number, price: number) => {
    const newItems = [...items];
    newItems[index].price = price;
    setItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const currentTotal = items.reduce((acc: number, it: any) => acc + (it.price * it.quantity), 0);

  const handleSave = async () => {
    if (!confirm("Tem certeza que deseja salvar estas alterações? O valor será atualizado e o boleto (se houver) será ajustado.")) return;
    setLoading(true);
    try {
      await adminUpdateOrderItems(order.id, items.map((i: any) => ({ productId: i.productId, quantity: i.quantity, price: i.price })));
      alert("Pedido atualizado com sucesso!");
      router.push("/admin/orders");
    } catch (e: any) {
      alert("Erro ao atualizar pedido: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="mb-6 flex gap-4 items-center">
        <Link href="/admin/orders" className="btn btn-outline" style={{ padding: "0.5rem" }}>
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h3 className="font-bold">Cliente: {order.user.name}</h3>
          <p className="text-muted">Total Atual: R$ {order.totalAmount.toFixed(2)}</p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {items.map((item: any, index: number) => (
          <div key={item.id} style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <div style={{ flex: 2 }}>
              <select 
                className="input" 
                value={item.productId} 
                onChange={e => handleProductChange(index, e.target.value)}
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (R$ {p.price.toFixed(2)})</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="font-bold">Qtd:</span>
              <input 
                type="number" 
                min="1" 
                className="input" 
                style={{ width: "70px" }}
                value={item.quantity} 
                onChange={e => handleQuantityChange(index, parseInt(e.target.value) || 1)} 
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className="font-bold">R$</span>
              <input 
                type="number" 
                step="0.01" 
                min="0" 
                className="input" 
                style={{ width: "110px" }}
                value={item.price} 
                onChange={e => handlePriceChange(index, parseFloat(e.target.value) || 0)} 
              />
            </div>
            <div style={{ width: "120px", textAlign: "right", fontWeight: "bold", whiteSpace: "nowrap" }}>
              = R$ {(item.price * item.quantity).toFixed(2)}
            </div>
            <button onClick={() => handleRemoveItem(index)} className="btn btn-outline" style={{ padding: "0.5rem", color: "var(--danger)" }}>
              <Trash2 size={20} />
            </button>
          </div>
        ))}
      </div>

      <button onClick={handleAddProduct} className="btn btn-outline mt-4" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Plus size={16} /> Adicionar Item
      </button>

      <div className="mt-8" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p className="text-muted">Novo Total Calculado</p>
          <h2 className="font-extrabold gradient-text" style={{ fontSize: "2rem" }}>R$ {currentTotal.toFixed(2)}</h2>
        </div>
        <button onClick={handleSave} disabled={loading || items.length === 0} className="btn btn-primary" style={{ padding: "1rem 2rem", fontSize: "1.1rem" }}>
          {loading ? "Salvando..." : "Salvar Alterações"}
        </button>
      </div>
    </div>
  );
}
