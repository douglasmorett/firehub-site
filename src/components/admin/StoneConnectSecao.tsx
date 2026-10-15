"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, Plus, CheckCircle2, AlertTriangle, Copy, Power } from "lucide-react";

/**
 * Stone pela nuvem (Connect 2.0) — dentro de Totem › Maquininhas.
 *
 * A maquininha Stone recebe a cobrança da nuvem da Pagar.me, sem o app do
 * FireHub instalado nela. O lojista cola a secret key da conta Stone/Pagar.me
 * (sk_...), que vai cifrada e nunca volta para a tela, e cadastra cada POS pelo
 * número de série da etiqueta.
 */

type Maquininha = { id: string; label: string; serial: string; active: boolean; totens: { id: string; label: string }[] };
type Situacao = {
  conectada: boolean;
  finalDaChave: string | null;
  fluxo: "LISTADO" | "DIRETO";
  tipoDireto: string;
  servidorPronto: boolean;
  webhookUrl: string;
  podeEditar: boolean;
  maquininhas: Maquininha[];
};

const TIPOS: Record<string, string> = { credit: "Crédito à vista", debit: "Débito", pix: "Pix", voucher: "Voucher" };

const campo: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 14, fontFamily: "inherit", background: "#fff",
};
const botao: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 8, border: "none", background: "#0F766E", color: "#fff",
  fontWeight: 700, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
};
const botaoLeve: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC",
  fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
};

export default function StoneConnectSecao({ totens }: { totens: { id: string; label: string }[] }) {
  const [s, setS] = useState<Situacao | null>(null);
  const [chave, setChave] = useState("");
  const [fluxo, setFluxo] = useState<"LISTADO" | "DIRETO">("LISTADO");
  const [tipoDireto, setTipoDireto] = useState("credit");
  const [serial, setSerial] = useState("");
  const [nome, setNome] = useState("");
  const [totem, setTotem] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);

  const mostrar = (texto: string, erro = false) => {
    setAviso({ texto, erro });
    setTimeout(() => setAviso(null), 6000);
  };

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/store/pos/stone-connect");
      if (!res.ok) return;
      const d = await res.json();
      setS(d);
      setFluxo(d.fluxo);
      setTipoDireto(d.tipoDireto);
    } catch { /* fica a tela anterior */ }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (url: string, metodo: string, corpo?: unknown) => {
    setOcupado(true);
    try {
      const res = await fetch(url, {
        method: metodo,
        headers: { "Content-Type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { mostrar(d.error || "Não deu certo.", true); return null; }
      await carregar();
      return d;
    } catch {
      mostrar("Erro de conexão.", true);
      return null;
    } finally {
      setOcupado(false);
    }
  };

  const conectar = async () => {
    const d = await enviar("/api/store/pos/stone-connect", "POST", { chave: chave.trim() || undefined, fluxo, tipoDireto });
    if (d) {
      setChave("");
      mostrar(d.aviso || (chave.trim() ? "Stone conectada." : "Configuração salva."), Boolean(d.aviso));
    }
  };

  const desconectar = async () => {
    if (!confirm("Desconectar a Stone? O totem e as mesas param de cobrar nas maquininhas Stone pela nuvem.")) return;
    if (await enviar("/api/store/pos/stone-connect", "DELETE")) mostrar("Stone desconectada.");
  };

  const cadastrar = async () => {
    const d = await enviar("/api/store/pos/stone-connect/maquininhas", "POST", {
      serial: serial.trim(), label: nome.trim(), totemLicenseId: totem || undefined,
    });
    if (d) { setSerial(""); setNome(""); setTotem(""); mostrar("Maquininha cadastrada."); }
  };

  const alterar = (id: string, mudanca: Record<string, unknown>) =>
    enviar("/api/store/pos/stone-connect/maquininhas", "PATCH", { id, ...mudanca });

  if (!s) return null;
  const pode = s.podeEditar;

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <Cloud size={20} color="#0F766E" />
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Stone pela nuvem (Connect)</h3>
        {s.conectada && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
            color: "#0F766E", background: "#F0FDFA", padding: "3px 10px", borderRadius: 20,
          }}><CheckCircle2 size={13} /> conectada{s.finalDaChave ? ` · chave …${s.finalDaChave}` : ""}</span>
        )}
      </div>
      <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 14px" }}>
        Maquininha Stone <strong>sem</strong> o app do FireHub: o totem e as mesas mandam a cobrança pela nuvem da
        Stone direto para ela. Precisa do Connect Stone ativado na sua conta Stone.
      </p>

      {aviso && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: 14, fontWeight: 600,
          background: aviso.erro ? "#FEF2F2" : "#F0FDFA", color: aviso.erro ? "#B71C1C" : "#0F766E",
          border: `1px solid ${aviso.erro ? "#FECACA" : "#99F6E4"}`,
        }}>{aviso.texto}</div>
      )}

      {!s.servidorPronto && (
        <div style={{ display: "flex", gap: 8, padding: 12, borderRadius: 10, background: "#FFF7E6", border: "1px solid #FDE68A", marginBottom: 14, fontSize: 13, color: "#92400E" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          A Stone pela nuvem ainda não foi liberada no servidor do FireHub. Fale com o suporte antes de configurar.
        </div>
      )}

      {pode && (
        <div style={{ padding: 16, borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            {s.conectada ? "Conexão" : "1. Cole a chave da Stone"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={s.conectada ? "Nova secret key (só para trocar)" : "Secret key — começa com sk_"}
              type="password"
              autoComplete="off"
              style={{ ...campo, flex: "1 1 260px" }}
            />
            <select value={fluxo} onChange={(e) => setFluxo(e.target.value as "LISTADO" | "DIRETO")} style={{ ...campo, flex: "0 1 220px" }}>
              <option value="LISTADO">Lista de pedidos na maquininha</option>
              <option value="DIRETO">Pagamento direto</option>
            </select>
            {fluxo === "DIRETO" && (
              <select value={tipoDireto} onChange={(e) => setTipoDireto(e.target.value)} style={{ ...campo, flex: "0 1 160px" }}>
                {Object.entries(TIPOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            )}
            <button onClick={conectar} disabled={ocupado || (!s.conectada && !chave.trim())} style={{ ...botao, opacity: ocupado ? 0.6 : 1 }}>
              {s.conectada && !chave.trim() ? "Salvar" : "Conectar"}
            </button>
            {s.conectada && (
              <button onClick={desconectar} disabled={ocupado} style={botaoLeve}><Power size={14} /> Desconectar</button>
            )}
          </div>
          <p style={{ fontSize: 12, color: "#64748B", margin: "10px 0 0" }}>
            A chave fica no Dashboard Pagar.me › Desenvolvimento › Chaves (ou Partner Hub). Ela é guardada cifrada e não
            aparece de novo. Use o mesmo fluxo que a Stone ativou na sua conta: <strong>lista</strong> (o pedido aparece
            na lista da maquininha e quem paga escolhe crédito, débito ou Pix) ou <strong>direto</strong> (a maquininha
            já abre a tela de pagamento).
          </p>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            Webhook (Dashboard Pagar.me › Configurações › Webhooks, eventos charge.* e order.*):
            <code style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 6, padding: "2px 6px" }}>{s.webhookUrl}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(s.webhookUrl); mostrar("Endereço copiado."); }}
              style={{ ...botaoLeve, padding: "3px 8px", fontSize: 12 }}
            ><Copy size={12} /> Copiar</button>
          </div>
        </div>
      )}

      {s.maquininhas.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {s.maquininhas.map((m) => (
            <div key={m.id} style={{
              padding: 14, borderRadius: 12, border: "1px solid #E2E8F0", opacity: m.active ? 1 : 0.6,
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {m.label}
                  <span style={{ fontWeight: 600, fontSize: 12, color: "#64748B" }}> · Stone (nuvem) · série {m.serial}</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  {m.active ? "Ativa" : "Desligada"}
                  {m.totens.length > 0 && ` · totem: ${m.totens.map((t) => t.label).join(", ")}`}
                </div>
              </div>
              {pode && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {m.active && totens.length > 0 && (
                    <select
                      value={m.totens[0]?.id || ""}
                      onChange={(e) => alterar(m.id, { totemLicenseId: e.target.value || null })}
                      style={{ ...campo, padding: "6px 10px", fontSize: 13 }}
                    >
                      <option value="">Sem totem</option>
                      {totens.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  )}
                  <button onClick={() => alterar(m.id, { active: !m.active })} disabled={ocupado} style={botaoLeve}>
                    <Power size={14} /> {m.active ? "Desligar" : "Ligar"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pode && s.conectada && (
        <div style={{ padding: 16, borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Cadastrar maquininha Stone</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Número de série (etiqueta, ex.: 6C582505)" style={{ ...campo, flex: "1 1 220px" }} />
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Stone do totem)" style={{ ...campo, flex: "1 1 200px" }} />
            {totens.length > 0 && (
              <select value={totem} onChange={(e) => setTotem(e.target.value)} style={{ ...campo, flex: "0 1 200px" }}>
                <option value="">Não vincular a um totem</option>
                {totens.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
            <button onClick={cadastrar} disabled={ocupado || !serial.trim()} style={{ ...botao, opacity: ocupado || !serial.trim() ? 0.6 : 1 }}>
              <Plus size={16} /> Cadastrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
