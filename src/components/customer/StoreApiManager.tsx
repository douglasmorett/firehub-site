"use client";
import { useState, useEffect } from "react";
import { Key, Webhook, Plus, Trash2, Copy, Check, ShieldCheck, ExternalLink, RefreshCw, Radio } from "lucide-react";

export function StoreApiManager() {
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingKey, setCreatingKey] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["order.created", "order.status_updated", "order.canceled"]);

  const EVENT_OPTIONS = [
    { id: "order.created", label: "Pedido Criado (order.created)" },
    { id: "order.status_updated", label: "Status do Pedido Alterado (order.status_updated)" },
    { id: "order.canceled", label: "Pedido Cancelado (order.canceled)" },
    { id: "menu.updated", label: "Cardápio Atualizado (menu.updated)" },
  ];

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [resKeys, resSubs] = await Promise.all([
        fetch("/api/store/api-keys"),
        fetch("/api/store/webhooks"),
      ]);
      const dataKeys = await resKeys.json();
      const dataSubs = await resSubs.json();

      if (dataKeys.apiKeys) setApiKeys(dataKeys.apiKeys);
      if (dataSubs.subscriptions) setWebhooks(dataSubs.subscriptions);
    } catch (e) {
      console.error("Erro ao carregar configurações de API:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;

    try {
      const res = await fetch("/api/store/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedRawKey(data.rawSecretKey);
        setKeyName("");
        setCreatingKey(false);
        fetchData();
      } else {
        alert(data.error || "Erro ao gerar chave de API");
      }
    } catch (err: any) {
      alert("Erro ao criar chave: " + err.message);
    }
  }

  async function handleRevokeKey(id: string) {
    if (!confirm("Tem certeza que deseja revogar esta Chave de API? Sistemas usando essa chave perderão o acesso imediatamente.")) return;

    try {
      const res = await fetch(`/api/store/api-keys?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Erro ao revogar chave.");
      }
    } catch (err: any) {
      alert("Erro ao revogar chave: " + err.message);
    }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim() || !webhookUrl.startsWith("http")) {
      alert("Por favor insira uma URL válida iniciando com http:// ou https://");
      return;
    }

    try {
      const res = await fetch("/api/store/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, events: selectedEvents }),
      });
      const data = await res.json();
      if (data.success) {
        setWebhookUrl("");
        setCreatingWebhook(false);
        fetchData();
      } else {
        alert(data.error || "Erro ao cadastrar webhook.");
      }
    } catch (err: any) {
      alert("Erro ao cadastrar webhook: " + err.message);
    }
  }

  async function handleDeleteWebhook(id: string) {
    if (!confirm("Tem certeza que deseja excluir esta assinatura de webhook?")) return;

    try {
      const res = await fetch(`/api/store/webhooks?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Erro ao excluir webhook.");
      }
    } catch (err: any) {
      alert("Erro ao excluir webhook: " + err.message);
    }
  }

  function handleCopyRawKey() {
    if (!createdRawKey) return;
    navigator.clipboard.writeText(createdRawKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 3000);
  }

  return (
    <div style={{ padding: "1rem 0" }}>
      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)", color: "#FFFFFF", borderRadius: 16, padding: "1.5rem", marginBottom: "2rem", boxShadow: "0 10px 25px -5px rgba(49,46,129,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", background: "rgba(255,255,255,0.15)", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
              <ShieldCheck size={14} color="#818CF8" /> API Aberta & Webhooks v1
            </span>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "8px 0 4px" }}>
              Conecte PDVs, ERPs e Sistemas Parceiros
            </h2>
            <p style={{ fontSize: "0.88rem", opacity: 0.9, margin: 0, maxWidth: 600 }}>
              Gerencie suas Chaves de API para integrações externas e cadastre Webhooks para receber atualizações de pedidos em tempo real.
            </p>
          </div>

          <a
            href="/api-docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#6366F1", color: "#FFFFFF", borderRadius: 12, fontWeight: 800, textDecoration: "none", fontSize: "0.9rem" }}
          >
            <ExternalLink size={16} /> Ver Documentação da API
          </a>
        </div>
      </div>

      {/* Modal / Alert de Exibição Única da Chave de API recém gerada */}
      {createdRawKey && (
        <div style={{ background: "#F0FDF4", border: "2px solid #22C55E", borderRadius: 16, padding: "1.25rem", marginBottom: "2rem", boxShadow: "0 4px 12px rgba(34,197,94,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#15803D", fontWeight: 900, marginBottom: 6 }}>
            <Key size={20} /> CHAVE DE API GERADA COM SUCESSO!
          </div>
          <p style={{ fontSize: "0.85rem", color: "#166534", margin: "0 0 12px" }}>
            <b>IMPORTANTE:</b> Copie e guarde esta chave agora. Por motivos de segurança, <b>ela não será exibida novamente</b>!
          </p>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={createdRawKey}
              style={{ flex: 1, padding: "10px 14px", background: "#FFFFFF", border: "1px solid #86EFAC", borderRadius: 8, fontFamily: "monospace", fontSize: "0.95rem", fontWeight: 700, color: "#0F172A" }}
            />
            <button
              onClick={handleCopyRawKey}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#16A34A", color: "#FFFFFF", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
            >
              {copiedKey ? <Check size={16} /> : <Copy size={16} />}
              {copiedKey ? "Copiado!" : "Copiar"}
            </button>
            <button
              onClick={() => setCreatedRawKey(null)}
              style={{ padding: "10px 14px", background: "#E2E8F0", color: "#475569", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* SEÇÃO 1: CHAVES DE API */}
      <div style={{ background: "#FFFFFF", borderRadius: 16, padding: "1.5rem", border: "1px solid #E2E8F0", marginBottom: "2rem", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
              <Key size={18} color="#6366F1" /> Chaves de API Ativas
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: 0 }}>
              Use estas chaves para autorizar requisições do seu PDV ou ERP no FireHub.
            </p>
          </div>

          <button
            onClick={() => setCreatingKey(!creatingKey)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#6366F1", color: "#FFFFFF", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
          >
            <Plus size={16} /> Nova Chave de API
          </button>
        </div>

        {creatingKey && (
          <form onSubmit={handleCreateKey} style={{ background: "#F8FAFC", padding: "1.25rem", borderRadius: 12, border: "1px solid #CBD5E1", marginBottom: "1.25rem" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 800, color: "#1E293B" }}>Gerar Nova Chave de API</h4>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Nome da chave (ex: PDV Caixa Balcão, Sistema Saipos)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                required
                style={{ flex: 1, minWidth: 260, padding: "10px 14px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.9rem" }}
              />
              <button
                type="submit"
                style={{ padding: "10px 20px", background: "#4F46E5", color: "#FFFFFF", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
              >
                Gerar Chave
              </button>
              <button
                type="button"
                onClick={() => setCreatingKey(false)}
                style={{ padding: "10px 16px", background: "#E2E8F0", color: "#475569", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ fontSize: "0.85rem", color: "#64748B", padding: "1rem 0" }}>Carregando chaves...</p>
        ) : apiKeys.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", background: "#F8FAFC", borderRadius: 12, border: "1px dashed #CBD5E1" }}>
            <p style={{ fontSize: "0.9rem", color: "#64748B", margin: 0 }}>Nenhuma chave de API gerada ainda.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E2E8F0", textAlign: "left", color: "#64748B" }}>
                  <th style={{ padding: "8px 12px" }}>NOME DA CHAVE</th>
                  <th style={{ padding: "8px 12px" }}>PREFIXO</th>
                  <th style={{ padding: "8px 12px" }}>CRIADA EM</th>
                  <th style={{ padding: "8px 12px" }}>ÚLTIMO USO</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr key={k.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "12px", fontWeight: 700, color: "#0F172A" }}>{k.name}</td>
                    <td style={{ padding: "12px", fontFamily: "monospace", color: "#4F46E5" }}>{k.keyPrefix}</td>
                    <td style={{ padding: "12px", color: "#64748B" }}>{new Date(k.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td style={{ padding: "12px", color: "#64748B" }}>
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("pt-BR") : "Nunca utilizada"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      <button
                        onClick={() => handleRevokeKey(k.id)}
                        style={{ padding: "6px 12px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <Trash2 size={14} /> Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SEÇÃO 2: WEBHOOKS DE SAÍDA */}
      <div style={{ background: "#FFFFFF", borderRadius: 16, padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
              <Webhook size={18} color="#059669" /> Webhooks de Saída (Notificações em Tempo Real)
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: 0 }}>
              Receba um POST no seu sistema sempre que um pedido for criado ou mudar de status.
            </p>
          </div>

          <button
            onClick={() => setCreatingWebhook(!creatingWebhook)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#059669", color: "#FFFFFF", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
          >
            <Plus size={16} /> Cadastrar Webhook
          </button>
        </div>

        {creatingWebhook && (
          <form onSubmit={handleCreateWebhook} style={{ background: "#F0FDF4", padding: "1.25rem", borderRadius: 12, border: "1px solid #A7F3D0", marginBottom: "1.25rem" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 800, color: "#065F46" }}>Cadastrar Novo Webhook de Saída</h4>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#047857", marginBottom: 4 }}>URL de Destino (HTTPS)</label>
              <input
                type="url"
                placeholder="https://seu-pdv-ou-servidor.com/webhooks/firehub"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                required
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #A7F3D0", fontSize: "0.9rem" }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#047857", marginBottom: 6 }}>Eventos Assinados</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {EVENT_OPTIONS.map((ev) => (
                  <label key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "#1E293B", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(ev.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEvents([...selectedEvents, ev.id]);
                        } else {
                          setSelectedEvents(selectedEvents.filter((id) => id !== ev.id));
                        }
                      }}
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="submit"
                style={{ padding: "10px 20px", background: "#059669", color: "#FFFFFF", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer" }}
              >
                Cadastrar Webhook
              </button>
              <button
                type="button"
                onClick={() => setCreatingWebhook(false)}
                style={{ padding: "10px 16px", background: "#E2E8F0", color: "#475569", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p style={{ fontSize: "0.85rem", color: "#64748B", padding: "1rem 0" }}>Carregando webhooks...</p>
        ) : webhooks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", background: "#F8FAFC", borderRadius: 12, border: "1px dashed #CBD5E1" }}>
            <p style={{ fontSize: "0.9rem", color: "#64748B", margin: 0 }}>Nenhum webhook de saída cadastrado.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #E2E8F0", textAlign: "left", color: "#64748B" }}>
                  <th style={{ padding: "8px 12px" }}>URL DE DESTINO</th>
                  <th style={{ padding: "8px 12px" }}>SEGREDO HMAC</th>
                  <th style={{ padding: "8px 12px" }}>EVENTOS</th>
                  <th style={{ padding: "8px 12px", textAlign: "right" }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "12px", fontWeight: 700, color: "#0F172A", wordBreak: "break-all" }}>{w.url}</td>
                    <td style={{ padding: "12px", fontFamily: "monospace", color: "#059669", fontSize: "0.8rem" }}>{w.secret}</td>
                    <td style={{ padding: "12px", color: "#64748B", fontSize: "0.8rem" }}>
                      {Array.isArray(w.events) ? w.events.join(", ") : "*"}
                    </td>
                    <td style={{ padding: "12px", textAlign: "right" }}>
                      <button
                        onClick={() => handleDeleteWebhook(w.id)}
                        style={{ padding: "6px 12px", background: "#FEE2E2", color: "#DC2626", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <Trash2 size={14} /> Excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
