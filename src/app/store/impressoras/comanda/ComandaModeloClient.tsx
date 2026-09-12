"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAssistente } from "@/lib/print";
import ComandaModeloEditor from "../ComandaModeloEditor";
import { VERSAO_MINIMA_DO_MODELO, type ModeloDeComanda } from "@/lib/comanda-modelo";

/**
 * A bancada de edição da comanda.
 *
 * Guarda o `printerConfig` INTEIRO e devolve ele inteiro no Salvar: a rota
 * `/api/store/printer-config` substitui o objeto completo, então mandar só o
 * `comandaModelo` apagaria as impressoras da loja. É o tipo de erro que só
 * aparece depois do deploy, com a loja sem imprimir.
 */
export default function ComandaModeloClient({
  storeName,
  initialConfig,
}: {
  storeName: string;
  initialConfig: any;
}) {
  const [config, setConfig] = useState<any>(initialConfig);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");
  const [versaoInstalada, setVersaoInstalada] = useState<string>("");

  // Pergunta ao Assistente desta máquina em que versão ele está, para a tela
  // avisar quando o modelo ainda não vai ser lido. Falha em silêncio: sem
  // Assistente aqui (o dono no celular, por exemplo) simplesmente não há aviso.
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const porta of [7899, 7900, 7901, 7891]) {
        try {
          const r = await fetchAssistente(`http://localhost:${porta}/status`, { signal: AbortSignal.timeout(1500) });
          const d = await r.json();
          if (d?.ok && d?.version && vivo) { setVersaoInstalada(String(d.version)); return; }
        } catch {}
      }
    })();
    return () => { vivo = false; };
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e: any) {
      setErro("Não consegui salvar. Confira a internet e tente de novo.");
      console.error("[ComandaModelo] salvar:", e);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "1.25rem 1rem 3rem", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Link
              href="/store/impressoras"
              style={{
                padding: "9px 14px", borderRadius: 11, border: "1.5px solid #E2E8F0", background: "#fff",
                color: "#475569", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              ← Voltar para Impressoras
            </Link>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontWeight: 900, fontSize: "1.25rem", margin: 0, color: "#0F172A" }}>🧾 Personalizar impressão</h1>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {storeName}
              </p>
            </div>
          </div>

          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              padding: "11px 26px", borderRadius: 12,
              background: salvo ? "#16A34A" : "linear-gradient(135deg,#B71C1C,#C62828)",
              color: "#fff", border: "none", fontWeight: 800, fontSize: "0.9rem",
              cursor: salvando ? "wait" : "pointer", fontFamily: "inherit",
            }}
          >
            {salvando ? "Salvando..." : salvo ? "✅ Salvo!" : "Salvar modelo"}
          </button>
        </div>

        {erro && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", color: "#B91C1C", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontWeight: 700, fontSize: "0.85rem" }}>
            {erro}
          </div>
        )}

        <div style={{ background: "#fff", borderRadius: 16, border: "1.5px solid #E2E8F0", padding: "1.25rem" }}>
          <ComandaModeloEditor
            modelo={config.comandaModelo}
            nomeDaLoja={storeName}
            versaoInstalada={versaoInstalada || undefined}
            versaoMinima={VERSAO_MINIMA_DO_MODELO}
            colunasDaLoja={
              (config.printers || []).find((p: any) => p?.name)?.columns
              ?? ((config.printers || []).find((p: any) => p?.name)?.paperWidth === "58mm" ? 32 : 48)
            }
            onChange={(comandaModelo: ModeloDeComanda) => setConfig((c: any) => ({ ...c, comandaModelo }))}
          />
        </div>
      </div>
    </div>
  );
}
