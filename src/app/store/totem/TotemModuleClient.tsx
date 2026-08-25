"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Monitor, Plus, Copy, Trash2, RotateCcw, Power, Wifi, WifiOff,
  Settings, Link as LinkIcon, X, CheckCircle2
} from "lucide-react";
import {
  toggleTotemModule, createTotemLicense, toggleTotemLicense,
  unbindTotemDevice, deleteTotemLicense, updateTotemConfig
} from "./actions";
import TotemCategoriesClient from "@/components/admin/TotemCategoriesClient";
import MaquininhasClient from "@/components/admin/MaquininhasClient";

export default function TotemModuleClient({ store, categories }: { store: any, categories?: any[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newTotemLabel, setNewTotemLabel] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  
  // Feedback state
  const [feedback, setFeedback] = useState<{message: string, type: "success" | "error"} | null>(null);

  const showFeedback = (message: string, type: "success" | "error" = "success") => {
    setFeedback({ message, type });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleToggleModule = async () => {
    try {
      setLoading(true);
      await toggleTotemModule(!store.totemEnabled);
      router.refresh();
      showFeedback(`Módulo Totem ${store.totemEnabled ? 'desativado' : 'ativado'} com sucesso!`);
    } catch (e) {
      showFeedback("Erro ao alterar módulo.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLicense = async () => {
    if (!newTotemLabel.trim()) return;
    try {
      setLoading(true);
      const res = await createTotemLicense(newTotemLabel);
      if (res.success) {
        setShowAddDialog(false);
        setNewTotemLabel("");
        router.refresh();
        showFeedback("Totem criado com sucesso!");
        
        // Show URL in prompt for immediate copy
        if (res.license?.url) {
           setTimeout(() => {
             prompt("URL do Totem criada! Copie abaixo:", res.license.url);
           }, 500);
        }
      }
    } catch (e: any) {
      showFeedback(e.message || "Erro ao criar totem", "error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (token: string) => {
    const url = `https://www.firehubfood.com.br/totem/${store.slug}?token=${token}`;
    navigator.clipboard.writeText(url);
    showFeedback("Link copiado para a área de transferência!");
  };

  const handleToggleLicense = async (id: string, currentActive: boolean) => {
    try {
      setLoading(true);
      await toggleTotemLicense(id, !currentActive);
      router.refresh();
      showFeedback(`Totem ${currentActive ? 'desativado' : 'ativado'}!`);
    } catch (e) {
      showFeedback("Erro ao alterar totem", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUnbind = async (id: string) => {
    if (!confirm("Tem certeza que deseja desvincular o dispositivo deste Totem? Ele precisará ler o QR Code ou usar o link novamente.")) return;
    try {
      setLoading(true);
      await unbindTotemDevice(id);
      router.refresh();
      showFeedback("Dispositivo desvinculado!");
    } catch (e) {
      showFeedback("Erro ao desvincular", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este Totem permanentemente?")) return;
    try {
      setLoading(true);
      await deleteTotemLicense(id);
      router.refresh();
      showFeedback("Totem excluído com sucesso!");
    } catch (e) {
      showFeedback("Erro ao excluir", "error");
    } finally {
      setLoading(false);
    }
  };
  
  const isOnline = (lastHeartbeat: Date | string | null) => {
    if (!lastHeartbeat) return false;
    const heartbeatTime = new Date(lastHeartbeat).getTime();
    const now = new Date().getTime();
    return (now - heartbeatTime) < 5 * 60 * 1000; // 5 minutes
  };

  const totems = store.totemLicenses || [];
  const onlineCount = totems.filter((t: any) => isOnline(t.lastHeartbeat)).length;
  const totalCost = totems.length * 100;

  return (
    <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto", fontFamily: "Inter, sans-serif", color: "#0F172A" }}>
      
      {/* Toast Feedback */}
      {feedback && (
        <div style={{
          position: "fixed", top: "20px", right: "20px", zIndex: 9999,
          background: feedback.type === "success" ? "#16A34A" : "#C62828",
          color: "white", padding: "12px 24px", borderRadius: "8px",
          display: "flex", alignItems: "center", gap: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontWeight: 500
        }}>
          <CheckCircle2 size={20} />
          {feedback.message}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: "12px" }}>
            <Monitor size={32} color="#C62828" />
            Módulo Totem
          </h1>
          <p style={{ color: "#64748B", margin: 0 }}>Gerencie as licenças e dispositivos de autoatendimento.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontWeight: 600, color: store.totemEnabled ? "#16A34A" : "#64748B" }}>
            {store.totemEnabled ? "Módulo Ativo" : "Módulo Inativo"}
          </span>
          <button 
            onClick={handleToggleModule}
            disabled={loading}
            style={{
              padding: "10px 20px",
              borderRadius: "12px",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              border: "none",
              background: store.totemEnabled ? "#FEE2E2" : "#16A34A",
              color: store.totemEnabled ? "#C62828" : "white",
              display: "flex", alignItems: "center", gap: "8px",
              opacity: loading ? 0.7 : 1
            }}
          >
            <Power size={18} />
            {store.totemEnabled ? "Desativar Módulo" : "Ativar Módulo"}
          </button>
        </div>
      </div>

      {!store.totemEnabled ? (
        <div style={{ 
          textAlign: "center", padding: "64px", background: "#F8FAFC", 
          borderRadius: "16px", border: "1px dashed #CBD5E1" 
        }}>
          <Monitor size={64} color="#94A3B8" style={{ margin: "0 auto 16px auto", opacity: 0.5 }} />
          <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px 0" }}>Autoatendimento Desativado</h2>
          <p style={{ color: "#64748B", maxWidth: "400px", margin: "0 auto" }}>
            Ative o módulo totem para criar licenças, gerenciar dispositivos e reduzir filas na sua loja.
          </p>
        </div>
      ) : (
        <>
          {/* Stats Bar */}
          <div style={{ 
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", 
            gap: "16px", marginBottom: "32px" 
          }}>
            <div style={{ 
              background: "white", padding: "20px", borderRadius: "16px", 
              border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" 
            }}>
              <p style={{ margin: "0 0 4px 0", color: "#64748B", fontSize: "14px", fontWeight: 500 }}>Total de Totens</p>
              <p style={{ margin: 0, fontSize: "28px", fontWeight: 800 }}>{totems.length}</p>
            </div>
            
            <div style={{ 
              background: "white", padding: "20px", borderRadius: "16px", 
              border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" 
            }}>
              <p style={{ margin: "0 0 4px 0", color: "#64748B", fontSize: "14px", fontWeight: 500 }}>Totens Online</p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <p style={{ margin: 0, fontSize: "28px", fontWeight: 800, color: onlineCount > 0 ? "#16A34A" : "inherit" }}>
                  {onlineCount}
                </p>
                <span style={{ color: "#64748B" }}>/ {totems.length}</span>
              </div>
            </div>

            <div style={{ 
              background: "white", padding: "20px", borderRadius: "16px", 
              border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" 
            }}>
              <p style={{ margin: "0 0 4px 0", color: "#64748B", fontSize: "14px", fontWeight: 500 }}>Custo Mensal (Est.)</p>
              <p style={{ margin: 0, fontSize: "28px", fontWeight: 800 }}>R$ {totalCost},00</p>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>Suas Licenças</h2>
            <button
              onClick={() => setShowAddDialog(true)}
              style={{
                padding: "10px 20px",
                borderRadius: "12px",
                fontWeight: 700,
                cursor: "pointer",
                border: "none",
                background: "#C62828",
                color: "white",
                display: "flex", alignItems: "center", gap: "8px"
              }}
            >
              <Plus size={18} />
              Adicionar Totem
            </button>
          </div>

          {/* Totems Grid */}
          {totems.length === 0 ? (
            <div style={{ 
              textAlign: "center", padding: "64px", background: "white", 
              borderRadius: "16px", border: "1px dashed #CBD5E1" 
            }}>
              <p style={{ color: "#64748B" }}>Você ainda não tem nenhum totem cadastrado.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "24px" }}>
              {totems.map((t: any) => {
                const online = isOnline(t.lastHeartbeat);
                return (
                  <div key={t.id} style={{ 
                    background: "white", borderRadius: "16px", border: "1px solid #F1F5F9", 
                    boxShadow: "0 2px 8px rgba(0,0,0,0.04)", padding: "24px",
                    display: "flex", flexDirection: "column", gap: "16px",
                    opacity: t.active ? 1 : 0.6
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <h3 style={{ margin: "0 0 4px 0", fontSize: "18px", fontWeight: 700 }}>{t.label}</h3>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500, color: online ? "#16A34A" : "#64748B" }}>
                          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                          {online ? "Online agora" : "Offline"}
                        </div>
                      </div>
                      <span style={{ 
                        padding: "4px 8px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                        background: t.active ? "#DCFCE7" : "#F1F5F9",
                        color: t.active ? "#166534" : "#64748B"
                      }}>
                        {t.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>

                    <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "12px", fontSize: "13px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ color: "#64748B" }}>Último acesso:</span>
                        <span style={{ fontWeight: 600 }}>
                          {t.lastHeartbeat ? new Date(t.lastHeartbeat).toLocaleString('pt-BR') : 'Nunca conectado'}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ color: "#64748B" }}>IP:</span>
                        <span style={{ fontWeight: 600 }}>{t.lastIp || '---'}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#64748B" }}>Mensalidade:</span>
                        <span style={{ fontWeight: 600, color: "#C62828" }}>R$ 100,00</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px", marginTop: "auto", flexWrap: "wrap" }}>
                      <button 
                        onClick={() => copyToClipboard(t.token)}
                        style={{
                          flex: 1, padding: "10px", borderRadius: "12px", fontWeight: 600,
                          cursor: "pointer", border: "1px solid #E2E8F0", background: "white",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                        }}
                        title="Copiar link de acesso"
                      >
                        <LinkIcon size={16} /> Link
                      </button>
                      
                      {t.deviceFingerprint && (
                        <button 
                          onClick={() => handleUnbind(t.id)}
                          disabled={loading}
                          style={{
                            flex: 1, padding: "10px", borderRadius: "12px", fontWeight: 600,
                            cursor: loading ? "not-allowed" : "pointer", border: "1px solid #E2E8F0", background: "white",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                            color: "#F59E0B"
                          }}
                          title="Desvincular dispositivo"
                        >
                          <RotateCcw size={16} /> Desvincular
                        </button>
                      )}

                      <button 
                        onClick={() => handleToggleLicense(t.id, t.active)}
                        disabled={loading}
                        style={{
                          width: "42px", padding: "10px", borderRadius: "12px", fontWeight: 600,
                          cursor: loading ? "not-allowed" : "pointer", border: "1px solid #E2E8F0", background: "white",
                          display: "flex", alignItems: "center", justifyContent: "center"
                        }}
                        title={t.active ? "Desativar" : "Ativar"}
                      >
                        <Power size={16} color={t.active ? "#64748B" : "#16A34A"} />
                      </button>

                      <button 
                        onClick={() => handleDelete(t.id)}
                        disabled={loading}
                        style={{
                          width: "42px", padding: "10px", borderRadius: "12px", fontWeight: 600,
                          cursor: loading ? "not-allowed" : "pointer", border: "1px solid #FEE2E2", background: "#FEF2F2",
                          display: "flex", alignItems: "center", justifyContent: "center", color: "#C62828"
                        }}
                        title="Excluir"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add Totem Dialog */}
      {showAddDialog && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{
            background: "white", padding: "32px", borderRadius: "24px",
            width: "100%", maxWidth: "400px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 800 }}>Novo Totem</h2>
              <button onClick={() => setShowAddDialog(false)} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                <X size={24} color="#64748B" />
              </button>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: 600, fontSize: "14px" }}>
                Nome de identificação
              </label>
              <input 
                type="text" 
                value={newTotemLabel}
                onChange={e => setNewTotemLabel(e.target.value)}
                placeholder="Ex: Totem Principal Entrada"
                style={{
                  width: "100%", padding: "12px 16px", borderRadius: "12px",
                  border: "1px solid #CBD5E1", fontSize: "16px", outline: "none", boxSizing: "border-box"
                }}
                autoFocus
              />
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button 
                onClick={() => setShowAddDialog(false)}
                style={{
                  flex: 1, padding: "12px", borderRadius: "12px", fontWeight: 700,
                  cursor: "pointer", border: "1px solid #CBD5E1", background: "white", color: "#64748B"
                }}
              >
                Cancelar
              </button>
              <button 
                onClick={handleCreateLicense}
                disabled={loading || !newTotemLabel.trim()}
                style={{
                  flex: 2, padding: "12px", borderRadius: "12px", fontWeight: 700,
                  cursor: (loading || !newTotemLabel.trim()) ? "not-allowed" : "pointer", 
                  border: "none", background: "#C62828", color: "white",
                  opacity: (loading || !newTotemLabel.trim()) ? 0.7 : 1
                }}
              >
                {loading ? "Criando..." : "Criar Totem"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Totem Categories Image Editor */}
      {store.totemEnabled && categories && (
        <TotemCategoriesClient categories={categories} storeSlug={store.slug} />
      )}

      {/* A maquininha fica aqui e não numa página própria porque ela existe em
          função do totem: é nela que o cliente paga o pedido que fecha na tela
          ao lado. Separar em outro menu obrigaria o lojista a descobrir sozinho
          que os dois se ligam. */}
      {store.totemEnabled && (
        <MaquininhasClient
          totens={(store.totemLicenses || []).map((l: any) => ({ id: l.id, label: l.label }))}
        />
      )}

    </div>
  );
}
