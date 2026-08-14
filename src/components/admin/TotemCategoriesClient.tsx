"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Check, Loader2, Play } from "lucide-react";

export default function TotemCategoriesClient({ categories, storeSlug }: { categories: any[], storeSlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleUploadImage = async (categoryId: string, file: File) => {
    try {
      setLoading(categoryId);
      const formData = new FormData();
      formData.append("file", file);
      
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Falha no upload");
      const { url } = await uploadRes.json();

      const updateRes = await fetch("/api/admin/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: categoryId, imageUrl: url })
      });
      
      if (!updateRes.ok) throw new Error("Falha ao salvar");
      router.refresh();
    } catch (e) {
      alert("Erro ao enviar imagem");
    } finally {
      setLoading(null);
    }
  };

  const openSimulator = () => {
    // Generate a temporary mock token to bypass the totem activation screen
    const mockToken = "SIMULATOR_MODE";
    window.open(`/totem/${storeSlug}?token=${mockToken}`, "_blank", "width=600,height=900");
  };

  return (
    <div style={{ marginTop: "40px", background: "white", padding: "24px", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0" }}>Imagens das Categorias (Totem)</h2>
          <p style={{ color: "#64748B", margin: 0 }}>Adicione fotos reais para o menu lateral do Totem. Se não houver foto, o emoji padrão será exibido.</p>
        </div>
        <button 
          onClick={openSimulator}
          style={{
            padding: "10px 20px", borderRadius: "12px", fontWeight: 700,
            cursor: "pointer", border: "none", background: "#F1F5F9", color: "#0F172A",
            display: "flex", alignItems: "center", gap: "8px"
          }}
        >
          <Play size={18} />
          Simular Totem
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "16px" }}>
        {categories.map(cat => (
          <div key={cat.id} style={{ border: "1px solid #E2E8F0", borderRadius: "12px", padding: "16px", textAlign: "center" }}>
            <div style={{ 
              width: "80px", height: "80px", margin: "0 auto 12px auto", borderRadius: "16px", 
              background: cat.imageUrl ? `url(${cat.imageUrl}) center/cover` : "#F8FAFC",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: cat.imageUrl ? "0" : "32px", border: "1px dashed #CBD5E1",
              position: "relative"
            }}>
              {!cat.imageUrl && cat.emoji}
              
              {loading === cat.id && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "16px" }}>
                  <Loader2 size={24} className="animate-spin" color="#C62828" />
                </div>
              )}
            </div>
            
            <h3 style={{ margin: "0 0 12px 0", fontSize: "15px", fontWeight: 600 }}>{cat.name}</h3>
            
            <label style={{
              display: "block", padding: "8px", background: "#F1F5F9", borderRadius: "8px", 
              fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "#475569"
            }}>
              <input 
                type="file" 
                accept="image/*" 
                style={{ display: "none" }} 
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleUploadImage(cat.id, e.target.files[0]);
                  }
                }} 
              />
              <ImageIcon size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              Trocar Foto
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
