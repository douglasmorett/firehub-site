"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, Copy, RefreshCw, Wifi, WifiOff, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Maquininhas com app próprio (PagBank).
 *
 * O pareamento existia só como rota de API: para ligar uma maquininha o lojista
 * teria que chamar a API na mão. Esta tela é o que falta para o recurso existir
 * de verdade para quem usa o sistema.
 *
 * O código de pareamento aparece UMA vez, no momento em que é gerado. Depois
 * disso o servidor para de devolvê-lo — ele é credencial, e código de acesso
 * exposto num painel que fica aberto no balcão é convite para alguém fotografar.
 */

type Maquininha = {
  id: string;
  label: string;
  active: boolean;
  online: boolean;
  pareado: boolean;
  appVersion: string | null;
  lastSeenAt: string | null;
  codigoDePareamento: string | null;
  totens: { id: string; label: string }[];
};

export default function MaquininhasClient({ totens }: { totens: { id: string; label: string }[] }) {
  const [lista, setLista] = useState<Maquininha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState("");
  const [totemEscolhido, setTotemEscolhido] = useState("");
  const [codigoNovo, setCodigoNovo] = useState<{ codigo: string; label: string } | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);

  const mostrar = (texto: string, erro = false) => {
    setAviso({ texto, erro });
    setTimeout(() => setAviso(null), 4000);
  };

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/store/pos/parear");
      if (res.ok) {
        const dados = await res.json();
        setLista(dados.terminais || []);
      }
    } catch { /* a tela mostra a lista anterior */ } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // A maquininha marca presença ao perguntar pela fila, então o "online" muda
  // sozinho. Sem esta atualização o lojista pareia o aparelho e fica olhando
  // "Offline" sem saber se deu certo.
  useEffect(() => {
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, [carregar]);

  const criar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/store/pos/parear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nome.trim(), totemLicenseId: totemEscolhido || undefined }),
      });
      const dados = await res.json();
      if (!res.ok) { mostrar(dados.error || "Não consegui criar a maquininha.", true); return; }
      setCodigoNovo({ codigo: dados.codigoDePareamento, label: dados.terminal.label });
      setNome("");
      setTotemEscolhido("");
      carregar();
    } catch {
      mostrar("Erro de conexão.", true);
    } finally {
      setSalvando(false);
    }
  };

  const regerar = async (id: string, label: string) => {
    if (!confirm(`Gerar um código novo para "${label}"?\n\nO aparelho que está usando o código atual para de funcionar na hora.`)) return;
    try {
      const res = await fetch("/api/store/pos/parear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalId: id }),
      });
      const dados = await res.json();
      if (!res.ok) { mostrar(dados.error || "Não consegui gerar o código.", true); return; }
      setCodigoNovo({ codigo: dados.codigoDePareamento, label });
      carregar();
    } catch { mostrar("Erro de conexão.", true); }
  };

  const copiar = (texto: string) => {
    navigator.clipboard.writeText(texto);
    mostrar("Código copiado.");
  };

  const quandoFoi = (iso: string | null) => {
    if (!iso) return "nunca";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    return new Date(iso).toLocaleDateString("pt-BR");
  };

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, marginTop: 24, border: "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <CreditCard size={22} color="#7C3AED" />
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Maquininhas</h2>
      </div>
      <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 20px" }}>
        Maquininha com o app do FireHub instalado. O cliente fecha o pedido no totem e paga aqui;
        o pedido só vai para a cozinha depois que o cartão for aprovado.
      </p>

      {aviso && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: 600,
          background: aviso.erro ? "#FEF2F2" : "#F0FDF4",
          color: aviso.erro ? "#991B1B" : "#166534",
          border: `1px solid ${aviso.erro ? "#FECACA" : "#BBF7D0"}`,
        }}>{aviso.texto}</div>
      )}

      {/* O código só existe nesta tela, uma vez. Por isso ele ocupa o lugar
          inteiro em vez de virar uma linha discreta: quem fechar sem copiar
          precisa gerar outro, e o aparelho antigo para de funcionar. */}
      {codigoNovo && (
        <div style={{ padding: 18, borderRadius: 12, background: "#FFFBEB", border: "1.5px solid #FDE68A", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={18} color="#B45309" />
            <strong style={{ color: "#92400E", fontSize: 15 }}>
              Código de {codigoNovo.label} — anote agora
            </strong>
          </div>
          <p style={{ fontSize: 13, color: "#78350F", margin: "0 0 12px" }}>
            Digite no app da maquininha, na tela de pareamento. Este código não aparece de novo.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <code style={{
              flex: 1, padding: "12px 14px", background: "#fff", borderRadius: 8, border: "1px solid #FDE68A",
              fontFamily: "ui-monospace, monospace", fontSize: 13, wordBreak: "break-all", lineHeight: 1.5,
            }}>{codigoNovo.codigo}</code>
            <button onClick={() => copiar(codigoNovo.codigo)} style={{
              padding: "0 16px", borderRadius: 8, border: "none", background: "#B45309", color: "#fff",
              fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            }}><Copy size={16} /> Copiar</button>
          </div>
          <button onClick={() => setCodigoNovo(null)} style={{
            marginTop: 12, background: "none", border: "none", color: "#92400E",
            fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0,
          }}>Já anotei, fechar</button>
        </div>
      )}

      {carregando ? (
        <p style={{ color: "#94A3B8", fontSize: 14 }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div style={{ padding: 24, borderRadius: 12, border: "1.5px dashed #CBD5E1", textAlign: "center", marginBottom: 20 }}>
          <p style={{ color: "#64748B", fontSize: 14, margin: 0 }}>
            Nenhuma maquininha cadastrada. Cadastre uma abaixo e digite o código no app instalado nela.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {lista.map((m) => (
            <div key={m.id} style={{
              padding: 14, borderRadius: 12, border: "1px solid #E2E8F0",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {m.online
                  ? <Wifi size={20} color="#16A34A" />
                  : <WifiOff size={20} color="#94A3B8" />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                    {!m.pareado
                      ? "Ainda não pareada — digite o código no app"
                      : `${m.online ? "Conectada" : "Sem sinal"} · último contato ${quandoFoi(m.lastSeenAt)}`}
                    {m.appVersion && ` · app ${m.appVersion}`}
                    {m.totens.length > 0 && ` · totem: ${m.totens.map((t) => t.label).join(", ")}`}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {m.pareado && m.online && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
                    color: "#166534", background: "#F0FDF4", padding: "4px 10px", borderRadius: 20,
                  }}><CheckCircle2 size={13} /> pronta para cobrar</span>
                )}
                <button onClick={() => regerar(m.id, m.label)} title="Gerar código novo" style={{
                  padding: "7px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#F8FAFC",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                }}><RefreshCw size={14} /> Novo código</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: 16, borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Cadastrar maquininha</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome que você reconhece (ex: Maquininha do totem)"
            style={{
              flex: "1 1 260px", padding: "10px 14px", borderRadius: 8,
              border: "1px solid #CBD5E1", fontSize: 14, fontFamily: "inherit",
            }}
          />
          {totens.length > 0 && (
            <select
              value={totemEscolhido}
              onChange={(e) => setTotemEscolhido(e.target.value)}
              style={{
                flex: "0 1 200px", padding: "10px 12px", borderRadius: 8,
                border: "1px solid #CBD5E1", fontSize: 14, background: "#fff", fontFamily: "inherit",
              }}
            >
              <option value="">Não vincular a um totem</option>
              {totens.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
          <button onClick={criar} disabled={salvando || !nome.trim()} style={{
            padding: "10px 18px", borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff",
            fontWeight: 700, fontSize: 14, cursor: salvando || !nome.trim() ? "default" : "pointer",
            opacity: salvando || !nome.trim() ? 0.6 : 1, display: "flex", alignItems: "center", gap: 6,
          }}><Plus size={16} /> {salvando ? "Criando…" : "Cadastrar"}</button>
        </div>
        {totens.length > 0 && (
          <p style={{ fontSize: 12, color: "#64748B", margin: "10px 0 0" }}>
            Vincular ao totem faz a cobrança sair nesta maquininha quando a loja tem mais de uma.
          </p>
        )}
      </div>
    </div>
  );
}
