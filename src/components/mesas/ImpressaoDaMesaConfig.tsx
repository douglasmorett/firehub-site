"use client";

/**
 * Engrenagem das Mesas › 🖨️ Impressão — "Não imprimir as bebidas lançadas na
 * mesa" (lib/bebida-da-mesa.ts).
 *
 * Mora na tela de Mesas, e não na de Impressoras, porque é uma decisão sobre
 * a MESA: o dono da Delícia de Casa (02/10/2026) pensa "na mesa o garçom pega
 * a bebida na geladeira", não "a impressora X não recebe a categoria Y".
 *
 * Lê a config na hora de abrir (outra aba pode ter mudado) e grava SÓ a sua
 * chave: o PUT de /api/store/printer-config mescla por chave, e as telas de
 * Impressoras tiram esta chave do corpo delas — assim ninguém desliga a opção
 * salvando outra coisa.
 */
import { useEffect, useState } from "react";
import { CHAVE_MESA_SEM_BEBIDA } from "@/lib/bebida-da-mesa";

export default function ImpressaoDaMesaConfig() {
  const [ligada, setLigada] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    fetch("/api/store/printer-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setLigada(cfg?.[CHAVE_MESA_SEM_BEBIDA] === true))
      .catch(() => setLigada(false));
  }, []);

  const salvar = async (valor: boolean) => {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [CHAVE_MESA_SEM_BEBIDA]: valor }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setLigada(valor);
      setAviso({
        ok: true,
        texto: valor
          ? "Salvo: a partir do próximo lançamento, a bebida da mesa não sai mais na comanda."
          : "Salvo: a bebida da mesa volta a sair na comanda, como antes.",
      });
    } catch {
      setAviso({ ok: false, texto: "Não deu para salvar. Confira a internet e tente de novo." });
    } finally {
      setSalvando(false);
    }
  };

  if (ligada === null) {
    return <div style={{ padding: "18px 0", fontSize: 13, color: "#64748B" }}>Carregando...</div>;
  }

  return (
    <div style={{ padding: "10px 0 14px" }}>
      <label style={{
        display: "flex", alignItems: "flex-start", gap: 12, padding: "14px", borderRadius: 12,
        cursor: salvando ? "wait" : "pointer",
        border: `1.5px solid ${ligada ? "#334155" : "#E2E8F0"}`, background: ligada ? "#F8FAFC" : "#fff",
      }}>
        <input
          type="checkbox"
          checked={ligada}
          disabled={salvando}
          onChange={(e) => salvar(e.target.checked)}
          style={{ accentColor: "#334155", width: 22, height: 22, marginTop: 1, flexShrink: 0 }}
        />
        <span>
          <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "#0F172A" }}>
            Não imprimir as bebidas lançadas na mesa
          </span>
          <span style={{ display: "block", fontSize: 13, color: "#475569", marginTop: 4, lineHeight: 1.45 }}>
            {ligada
              ? "Ligado: refrigerante, suco, cerveja e água lançados na mesa não saem na comanda. Se o garçom lançar só bebida, não sai papel nenhum."
              : "Desligado: tudo o que é lançado na mesa sai na comanda, bebida inclusive."}
          </span>
        </span>
      </label>

      <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12, color: "#64748B", lineHeight: 1.6 }}>
        <li>A <strong>conta da mesa</strong> (Imprimir comanda e o fechamento) continua com as bebidas.</li>
        <li><strong>Delivery e balcão</strong> não mudam.</li>
        <li>Combo com refrigerante sai inteiro, como sempre.</li>
        <li>Precisa imprimir uma bebida mesmo assim? Na mesa, use <strong>🖨️ Selecionar itens para impressão</strong> e marque a bebida.</li>
        <li>Bebida é o produto marcado como bebida no cardápio ou que está numa categoria de bebidas (Bebidas, Refrigerantes, Sucos, Cervejas...).</li>
      </ul>

      {aviso && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: aviso.ok ? "#0F766E" : "#B71C1C" }}>
          {aviso.texto}
        </div>
      )}
    </div>
  );
}
