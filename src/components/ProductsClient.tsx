"use client";

import { useState, useRef } from "react";
import { createProduct, updateProduct } from "@/app/actions/product";
import DeleteProductButton from "./DeleteProductButton";
import { Plus, ImagePlus, X, Edit, Save, ExternalLink } from "lucide-react";
import Image from "next/image";


export default function ProductsClient({ products }: { products: any[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const startEdit = (product: any) => {
    setEditingId(product.id);
    setPreview(product.imageUrl || null);
    setUploadedUrl(product.imageUrl || "");
    
    // Fill the form fields
    if (formRef.current) {
      const form = formRef.current;
      (form.elements.namedItem("name") as HTMLInputElement).value = product.name;
      (form.elements.namedItem("description") as HTMLTextAreaElement).value = product.description;
      (form.elements.namedItem("price") as HTMLInputElement).value = product.price.toString();
      const catSelect = form.elements.namedItem("category") as HTMLSelectElement;
      if (catSelect) catSelect.value = product.category || "Outros";
    }
    
    // Scroll to form
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPreview(null);
    setUploadedUrl("");
    formRef.current?.reset();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview local
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    // Upload para o Vercel Blob
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) {
        setUploadedUrl(data.url);
      } else {
        alert("Erro ao fazer upload da imagem.");
      }
    } catch {
      alert("Erro ao fazer upload da imagem.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.set("imageUrl", uploadedUrl);
      
      if (editingId) {
        await updateProduct(editingId, fd);
        alert("Produto atualizado com sucesso!");
        cancelEdit();
      } else {
        await createProduct(fd);
        setPreview(null);
        setUploadedUrl("");
        formRef.current?.reset();
        alert("Produto cadastrado com sucesso!");
      }
    } catch (error: any) {
      alert("Erro: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <h1 className="font-bold" style={{ fontSize: "2rem" }}>Insumos e Produtos</h1>
        <a 
          href="/store" 
          target="_blank" 
          rel="noopener noreferrer"
          className="btn"
          style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: "0.5rem", 
            padding: "0.6rem 1.2rem", 
            backgroundColor: "rgba(99, 102, 241, 0.1)", 
            color: "#6366f1", 
            borderRadius: "10px",
            fontWeight: "bold",
            fontSize: "0.9rem",
            textDecoration: "none",
            border: "1px solid rgba(99, 102, 241, 0.2)"
          }}
        >
          <ExternalLink size={18} />
          Ver Site do Franqueado
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem" }}>

        {/* Formulário de Cadastro */}
        <div className="card" style={{ alignSelf: "start" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px", marginBottom: "1rem" }}>
            <h2 className="font-semibold" style={{ fontSize: "1.2rem" }}>
              {editingId ? "Editar Insumo" : "Novo Insumo"}
            </h2>
            {editingId && (
              <button onClick={cancelEdit} className="btn" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", color: "var(--text-muted)", backgroundColor: "var(--surface-2)" }}>
                Cancelar Edição
              </button>
            )}
          </div>
          <form ref={formRef} onSubmit={handleSubmit}>
            <div className="input-group">
              <label htmlFor="name">Nome do Insumo</label>
              <input type="text" id="name" name="name" className="input-field" required placeholder="Ex: Copo 500ml" />
            </div>

            <div className="input-group">
              <label htmlFor="description">Descrição</label>
              <textarea id="description" name="description" className="input-field" rows={3} placeholder="Detalhes do pacote/caixa..." />
            </div>

            <div className="input-group">
              <label htmlFor="category">Categoria</label>
              <select id="category" name="category" className="input-field" required style={{ backgroundColor: "var(--surface-1)", cursor: "pointer" }}>
                <option value="Congelados">Congelados</option>
                <option value="Resfriados">Resfriados</option>
                <option value="Doces">Doces</option>
                <option value="Embalagens">Embalagens</option>
                <option value="Outros">Outros</option>
              </select>
            </div>

            <div className="input-group">
              <label htmlFor="price">Preço de Venda (R$)</label>
              <input type="number" id="price" name="price" step="0.01" className="input-field" required placeholder="0.00" />
            </div>

            {/* Upload de Imagem */}
            <div className="input-group">
              <label>Imagem do Produto</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "1rem",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "border-color 0.2s",
                  position: "relative",
                  minHeight: "120px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: "0.5rem"
                }}
              >
                {preview ? (
                  <>
                    <img src={preview} alt="Preview" style={{ maxHeight: "100px", maxWidth: "100%", borderRadius: "8px", objectFit: "contain" }} />
                    {uploading && <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Enviando imagem...</p>}
                    {uploadedUrl && <p style={{ fontSize: "0.75rem", color: "#10b981" }}>✓ Imagem pronta!</p>}
                  </>
                ) : (
                  <>
                    <ImagePlus size={32} style={{ color: "var(--text-muted)" }} />
                    <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Clique ou tire uma foto</p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>JPG, PNG até 5MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
              {preview && (
                <button
                  type="button"
                  onClick={() => { setPreview(null); setUploadedUrl(""); }}
                  style={{ marginTop: "0.5rem", fontSize: "0.8rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.25rem" }}
                >
                  <X size={14} /> Remover imagem
                </button>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary mt-4"
              style={{ width: "100%", backgroundColor: editingId ? "#10b981" : undefined }}
              disabled={submitting || uploading}
            >
              {editingId ? <Save size={18} style={{ marginRight: "0.5rem" }} /> : <Plus size={18} style={{ marginRight: "0.5rem" }} />}
              {submitting ? "Salvando..." : (editingId ? "Salvar Alterações" : "Cadastrar Insumo")}
            </button>
          </form>
        </div>

        {/* Listagem de Produtos */}
        <div>
          <div className="card">
            <h2 className="font-semibold mb-4" style={{ fontSize: "1.2rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "10px" }}>Cadastrados ({products.length})</h2>

            {products.length === 0 ? (
              <p className="text-muted text-center py-8">Nenhum insumo cadastrado ainda.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {products.map(product => (
                  <div key={product.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", gap: "1rem" }}>
                    {product.imageUrl ? (
                      <div style={{ position: "relative", width: "56px", height: "56px", flexShrink: 0 }}>
                        <Image src={product.imageUrl} alt={product.name} fill style={{ objectFit: "cover", borderRadius: "8px" }} sizes="56px" />
                      </div>
                    ) : (
                      <div style={{ width: "56px", height: "56px", borderRadius: "8px", backgroundColor: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <ImagePlus size={20} style={{ color: "var(--text-muted)" }} />
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <h3 className="font-semibold">{product.name}</h3>
                      <p className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.2rem" }}>{product.category || "Sem categoria"}</p>
                      <p className="font-bold" style={{ fontSize: "0.95rem", color: "var(--primary)" }}>R$ {product.price.toFixed(2)}</p>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button 
                        onClick={() => startEdit(product)}
                        className="btn" 
                        style={{ padding: "0.4rem", color: "#6366f1", backgroundColor: "rgba(99,102,241,0.1)", borderRadius: "8px" }}
                        title="Editar Produto"
                      >
                        <Edit size={18} />
                      </button>
                      <DeleteProductButton id={product.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
