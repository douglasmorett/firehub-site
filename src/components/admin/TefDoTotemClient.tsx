"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Power, RefreshCw } from "lucide-react";
import { fetchAssistente } from "@/lib/fetch-assistente";
import { PORTAS_DO_ASSISTENTE } from "@/lib/tef-no-assistente";

/**
 * TEF no totem — pinpad PayGo ligado ao computador do totem, falado pelo
 * Assistente FireHub (firehub-print-assistant/tef). Ver lib/tef-do-totem.ts.
 *
 * Ligar gera a chave do Assistente e o segredo local, que vão UMA vez para o
 * Assistente DESTE computador (/tef/parear) — por isso o botão só funciona
 * com esta tela aberta no computador do totem, como o Modo Contingência.
 *
 * "Simulador" cobra de mentira (o motor JS do Assistente): é o que roda até o
 * kit PayGo e o pinpad chegarem. Trocar para "PayGo" é religar escolhendo.
 */

type Totem = { id: string; label: string };
type Ligado = { licencaId: string; ligadoEm: string; ultimoContato: string | null };
type Assistente = { porta: number; versao: string | null; tef: any } | null;

async function acharAssistente(): Promise<Assistente> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/status`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!r.ok) continue;
      const s = await r.json().catch(() => ({}));
      return { porta, versao: s?.versao || s?.version || null, tef: null };
    } catch {
      /* próxima porta */
    }
  }
  return null;
}

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca");

export default function TefDoTotemClient({ totens }: { totens: Totem[] }) {
  const [ligados, setLigados] = useState<Ligado[]>([]);
  const [assistente, setAssistente] = useState<Assistente | undefined>(undefined);
  const [motor, setMotor] = useState<"simulador" | "paygo">("simulador");
  const [ocupado, setOcupado] = useState("");
  const [mensagem, setMensagem] = useState("");

  const atualizar = useCallback(async () => {
    const r = await fetch("/api/store/totem/tef", { cache: "no-store" }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    setLigados(Array.isArray(d?.ligados) ? d.ligados : []);
    setAssistente(await acharAssistente());
  }, []);

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  async function ligar(t: Totem) {
    if (!assistente) {
      setMensagem("⚠️ Não achei o Assistente FireHub neste computador. Abra esta tela NO computador do totem, com o Assistente aberto.");
      return;
    }
    const jaLigado = ligados.some((l) => l.licencaId === t.id);
    if (jaLigado && !confirm(`Religar o TEF de "${t.label}" neste computador? O computador pareado antes deixa de cobrar.`)) return;
    setOcupado(t.id);
    setMensagem("");
    try {
      const r = await fetch("/api/store/totem/tef", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licencaId: t.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não foi possível ligar o TEF.");
      const p = await fetchAssistente(`http://127.0.0.1:${assistente.porta}/tef/parear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licencaId: d.licencaId, chave: d.chave, segredoLocal: d.segredoLocal, nuvem: d.nuvem, motor }),
      });
      if (!p.ok) {
        const erro = (await p.json().catch(() => ({})))?.error;
        throw new Error(
          p.status === 404
            ? "O Assistente deste computador é antigo e não tem TEF. Atualize o Assistente (1.2.38 ou mais novo)."
            : erro || "O Assistente não aceitou o pareamento.",
        );
      }
      setMensagem(
        motor === "simulador"
          ? `✅ TEF ligado em "${t.label}" no modo SIMULADOR (não cobra de verdade). Abra o totem de novo (F5) para ele enxergar o pinpad.`
          : `✅ TEF ligado em "${t.label}" com a PayGo. Abra o totem de novo (F5) para ele enxergar o pinpad.`,
      );
      await atualizar();
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message || "Não foi possível ligar o TEF."}`);
    } finally {
      setOcupado("");
    }
  }

  async function desligar(t: Totem) {
    if (!confirm(`Desligar o TEF de "${t.label}"? O totem volta a cobrar pela maquininha.`)) return;
    setOcupado(t.id);
    setMensagem("");
    try {
      const r = await fetch("/api/store/totem/tef", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ licencaId: t.id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Não foi possível desligar.");
      if (assistente) {
        await fetchAssistente(`http://127.0.0.1:${assistente.porta}/tef/desparear`, { method: "POST" }).catch(() => null);
      }
      setMensagem(`TEF desligado em "${t.label}".`);
      await atualizar();
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message || "Não foi possível desligar."}`);
    } finally {
      setOcupado("");
    }
  }

  if (!totens.length) return null;

  return (
    <div style={{ marginTop: 32, background: "white", borderRadius: 16, border: "1px solid #F1F5F9", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
          <CreditCard size={22} color="#C92E09" /> TEF no totem (pinpad)
        </h2>
        <button
          type="button"
          onClick={() => void atualizar()}
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #E2E8F0", background: "white", cursor: "pointer", display: "flex", gap: 6, alignItems: "center" }}
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>
      <p style={{ color: "#64748B", fontSize: 14, margin: "8px 0 16px" }}>
        O cliente paga no pinpad ligado ao computador do totem, sem maquininha separada. Ligue com esta tela aberta{" "}
        <strong>no computador do totem</strong>, com o Assistente FireHub aberto.{" "}
        {assistente === undefined
          ? "Procurando o Assistente..."
          : assistente
            ? `Assistente encontrado neste computador${assistente.versao ? ` (versão ${assistente.versao})` : ""}.`
            : "Assistente NÃO encontrado neste computador."}
      </p>

      <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        Ao ligar, usar:
        <select value={motor} onChange={(e) => setMotor(e.target.value as any)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1" }}>
          <option value="simulador">Simulador (teste — não cobra)</option>
          <option value="paygo">PayGo (pinpad de verdade)</option>
        </select>
      </label>

      <div style={{ display: "grid", gap: 10 }}>
        {totens.map((t) => {
          const l = ligados.find((x) => x.licencaId === t.id);
          return (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 12, background: "#F8FAFC", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t.label}</div>
                <div style={{ fontSize: 13, color: l ? "#0F766E" : "#64748B" }}>
                  {l ? `TEF ligado · último contato do pinpad: ${quando(l.ultimoContato)}` : "Sem TEF (cobra pela maquininha)"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={!!ocupado}
                  onClick={() => void ligar(t)}
                  style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#C92E09", color: "white", fontWeight: 700, cursor: ocupado ? "not-allowed" : "pointer" }}
                >
                  {ocupado === t.id ? "Aguarde..." : l ? "Religar neste computador" : "Ligar neste computador"}
                </button>
                {l && (
                  <button
                    type="button"
                    disabled={!!ocupado}
                    onClick={() => void desligar(t)}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0", background: "white", cursor: ocupado ? "not-allowed" : "pointer" }}
                    title="Desligar TEF"
                  >
                    <Power size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {mensagem && <p style={{ marginTop: 14, fontSize: 14, fontWeight: 600 }}>{mensagem}</p>}
    </div>
  );
}
