"use client";
/**
 * Minha Loja › API Aberta & Webhooks › "Open Delivery (logística)".
 *
 * A credencial que a loja entrega ao app de entregadores parceiro (Bem Dito):
 * client_id, client_secret, URL do token e URL base da API, mais a URL de
 * webhook do parceiro e o liga/desliga. Rota: /api/store/integracoes/open-delivery-saida.
 */
import { useEffect, useState } from "react";
import { Bike, Copy, Check, Eye, RefreshCw, Power } from "lucide-react";
import { AvisoNoTopo, type Aviso } from "@/components/mesas/SelecionarItensParaImpressao";

type Estado = {
  integracao: null | {
    parceiro: string;
    clientId: string;
    merchantId: string;
    webhookUrl: string | null;
    ativo: boolean;
    ligadoEm: string;
    ultimoUsoEm: string | null;
  };
  urls: { token: string; base: string };
  webhookPadrao: boolean;
  fila: { pendentes: number; desistiu: number; ultimoErro: string | null } | null;
  podeEditar: boolean;
};

const ROTA = "/api/store/integracoes/open-delivery-saida";

function Linha({ rotulo, valor, segredo }: { rotulo: string; valor: string; segredo?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", marginBottom: 3 }}>{rotulo}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          readOnly
          value={valor}
          style={{ flex: 1, minWidth: 0, padding: "8px 12px", borderRadius: 8, border: `1px solid ${segredo ? "#FCA5A5" : "#CBD5E1"}`, fontFamily: "monospace", fontSize: "0.85rem", background: "#F8FAFC", color: "#0F172A" }}
        />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(valor).catch(() => {});
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 12px", background: "#1C1917", color: "#FFF", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
        >
          {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

export function OpenDeliveryLogistica() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch(ROTA);
      const d = await r.json();
      if (r.ok) {
        setEstado(d);
        setUrl(d.integracao?.webhookUrl || "");
      } else setAviso({ tipo: "erro", titulo: "Não carregou a integração", detalhe: d.error });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não carregou a integração", detalhe: e?.message });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function acao(corpo: Record<string, unknown>, sucesso: string) {
    setOcupado(true);
    try {
      const r = await fetch(ROTA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const d = await r.json();
      if (!r.ok) {
        setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: d.error });
        return;
      }
      if (d.clientSecret) setSegredo(d.clientSecret);
      setAviso({ tipo: "ok", titulo: sucesso });
      await carregar();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e?.message });
    } finally {
      setOcupado(false);
    }
  }

  const integ = estado?.integracao;
  const botao = (cor: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", background: cor, color: "#FFF",
    border: "none", borderRadius: 10, fontWeight: 700, cursor: ocupado ? "wait" : "pointer", fontSize: "0.85rem", opacity: ocupado ? 0.7 : 1,
  });

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 16, padding: "1.5rem", border: "1px solid #E2E8F0", marginBottom: "2rem", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
      <AvisoNoTopo aviso={aviso} onFechar={() => setAviso(null)} />
      <h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0F172A", margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <Bike size={18} color="#B45309" /> Open Delivery (logística)
      </h3>
      <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "0 0 1rem" }}>
        Para o app de entregadores parceiro (ex.: Bem Dito) receber os pedidos de <b>entrega</b> desta loja no padrão Open Delivery
        e devolver "pronto", "saiu" e "entregue". Vão só os pedidos do seu canal (site, robô, PDV) — iFood, 99, Keeta, Brendi e JotaJá ficam de fora.
      </p>

      {carregando && !estado ? (
        <p style={{ fontSize: "0.85rem", color: "#64748B" }}>Carregando…</p>
      ) : !integ ? (
        <div style={{ textAlign: "center", padding: "1.5rem", background: "#FFFBEB", borderRadius: 12, border: "1px dashed #FCD34D" }}>
          <p style={{ fontSize: "0.9rem", color: "#92400E", margin: "0 0 12px" }}>Nenhuma credencial gerada para esta loja.</p>
          {estado?.podeEditar ? (
            <button disabled={ocupado} onClick={() => acao({ acao: "gerar" }, "Credencial gerada")} style={botao("#B45309")}>
              Gerar credenciais Open Delivery
            </button>
          ) : (
            <p style={{ fontSize: "0.8rem", color: "#92400E", margin: 0 }}>Só o dono da loja gera a credencial.</p>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ padding: "4px 10px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 800, background: integ.ativo ? "#DCFCE7" : "#F1F5F9", color: integ.ativo ? "#166534" : "#475569" }}>
              {integ.ativo ? "LIGADA" : "DESLIGADA"}
            </span>
            <span style={{ fontSize: "0.8rem", color: "#64748B" }}>
              Parceiro: <b>{integ.parceiro}</b> · Último acesso: {integ.ultimoUsoEm ? new Date(integ.ultimoUsoEm).toLocaleString("pt-BR") : "nunca"}
            </span>
          </div>

          <Linha rotulo="URL do token (OAuth2 client_credentials)" valor={estado!.urls.token} />
          <Linha rotulo="URL base da API" valor={estado!.urls.base} />
          <Linha rotulo="client_id" valor={integ.clientId} />
          <Linha rotulo="Merchant ID (X-App-MerchantId)" valor={integ.merchantId} />
          {segredo ? (
            <>
              <Linha rotulo="client_secret — guarde e passe só ao parceiro" valor={segredo} segredo />
            </>
          ) : null}

          {estado?.podeEditar && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 16px" }}>
              {!segredo && (
                <button disabled={ocupado} onClick={() => acao({ acao: "mostrarSegredo" }, "Segredo exibido")} style={botao("#334155")}>
                  <Eye size={15} /> Mostrar client_secret
                </button>
              )}
              <button
                disabled={ocupado}
                onClick={() => {
                  if (!confirm("Gerar um novo client_secret? O parceiro perde o acesso até receber o novo.")) return;
                  acao({ acao: "novoSegredo" }, "Novo segredo gerado — passe ao parceiro");
                }}
                style={botao("#9A3412")}
              >
                <RefreshCw size={15} /> Gerar novo segredo
              </button>
              <button
                disabled={ocupado}
                onClick={() => acao({ acao: "salvar", ativo: !integ.ativo }, integ.ativo ? "Integração desligada" : "Integração ligada")}
                style={botao(integ.ativo ? "#64748B" : "#15803D")}
              >
                <Power size={15} /> {integ.ativo ? "Desligar" : "Ligar"}
              </button>
            </div>
          )}

          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "1rem" }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>Webhook do parceiro (opcional)</div>
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 8px" }}>
              O FireHub faz POST de cada evento nesta URL, com X-App-MerchantId e X-App-Signature (HMAC-SHA256 do corpo com o client_secret).
              {estado?.webhookPadrao ? " Em branco, vale a URL padrão do parceiro configurada no servidor." : " Em branco, o parceiro busca pelo polling."}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="url"
                value={url}
                disabled={!estado?.podeEditar}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://parceiro.com/api/opendelivery/webhook"
                style={{ flex: 1, minWidth: 240, padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }}
              />
              {estado?.podeEditar && (
                <button disabled={ocupado} onClick={() => acao({ acao: "salvar", webhookUrl: url }, "Webhook salvo")} style={botao("#0F766E")}>
                  Salvar
                </button>
              )}
            </div>
            {estado?.fila && (estado.fila.pendentes > 0 || estado.fila.desistiu > 0) && (
              <p style={{ fontSize: "0.78rem", color: "#B45309", margin: "8px 0 0" }}>
                {estado.fila.pendentes} evento(s) esperando nova tentativa
                {estado.fila.desistiu > 0 ? ` · ${estado.fila.desistiu} sem entrega nas últimas 24 h (seguem no polling)` : ""}
                {estado.fila.ultimoErro ? ` · último erro: ${estado.fila.ultimoErro}` : ""}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
