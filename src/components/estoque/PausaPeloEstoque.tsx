"use client";
/**
 * O interruptor do topo da tela de Estoque: "Pausar sozinho o que usa um item
 * quando ele acabar" (lib/pausa-pelo-estoque.ts). Nasce DESLIGADO.
 *
 * Embaixo, a lista do que está pausado agora pelo estoque, com o item que
 * falta — "X-Bacon · falta Bacon (0 g)". Desligado, mostra quantos produtos
 * pausariam se ligasse agora, para ninguém levar susto.
 *
 * `versao` muda quando a tela recarrega os saldos (movimentação, compra,
 * desperdício): a lista se atualiza junto.
 */
import { useCallback, useEffect, useState } from "react";
import { PauseCircle } from "lucide-react";

type Faltando = { id: string; nome: string; saldo: number; unidade: string };
type Estado = {
  disponivel: boolean;
  ligado: boolean;
  podeMudar: boolean;
  pausados: { produtoId: string; produto: string; faltando: Faltando[] }[];
  pausariaAoLigar: string[];
};

const COR = { ok: "#0F766E", okFundo: "#F0FDFA", okBorda: "#99F6E4", tinta: "#0F172A", apagado: "#64748B", borda: "#E2E8F0", fundo: "#FFFFFF", etiqueta: "#FEF3C7", etiquetaTinta: "#92400E" };

const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","));

type Recado = { tipo: "ok" | "erro" | "info"; titulo: string; detalhe?: string };

export default function PausaPeloEstoque({ versao = 0 }: { versao?: number }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(true);
  // O retorno do clique fica aqui mesmo, embaixo do interruptor, e some sozinho
  // (nada de alert()).
  const [recado, setRecado] = useState<Recado | null>(null);
  useEffect(() => {
    if (!recado) return;
    const t = setTimeout(() => setRecado(null), recado.tipo === "erro" ? 12000 : 7000);
    return () => clearTimeout(t);
  }, [recado]);
  const aoMudar = setRecado;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/estoque/pausa-automatica", { cache: "no-store" });
      if (r.ok) setEstado(await r.json());
    } catch {}
  }, []);

  useEffect(() => { carregar(); }, [carregar, versao]);

  if (!estado || !estado.disponivel) return null;

  const alternar = async () => {
    if (salvando || !estado.podeMudar) return;
    const ligar = !estado.ligado;
    setSalvando(true);
    try {
      const r = await fetch("/api/store/estoque/pausa-automatica", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligado: ligar }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        aoMudar({ tipo: "erro", titulo: "Não consegui salvar", detalhe: d?.error });
        return;
      }
      setEstado(d);
      const pausadosAgora: string[] = d?.pausadosAgora || [];
      aoMudar(
        ligar
          ? {
              tipo: "ok",
              titulo: "Pausa automática ligada",
              detalhe: pausadosAgora.length
                ? `Pausei agora ${pausadosAgora.length} produto(s) com item zerado: ${pausadosAgora.slice(0, 5).join(", ")}${pausadosAgora.length > 5 ? "…" : ""}`
                : "Quando um item acabar, o que usa ele sai do cardápio sozinho.",
            }
          : { tipo: "info", titulo: "Pausa automática desligada", detalhe: "O que já está pausado continua pausado: reative pelo Cardápio." },
      );
    } catch {
      aoMudar({ tipo: "erro", titulo: "Sem conexão", detalhe: "Tente de novo." });
    } finally {
      setSalvando(false);
    }
  };

  const { ligado, pausados, pausariaAoLigar } = estado;

  return (
    <section
      aria-label="Pausa automática pelo estoque"
      style={{
        background: ligado ? COR.okFundo : COR.fundo,
        border: `1px solid ${ligado ? COR.okBorda : COR.borda}`,
        borderRadius: 14, padding: "12px 16px", margin: "0 0 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PauseCircle size={22} color={ligado ? COR.ok : COR.apagado} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: COR.tinta }}>Pausar sozinho o que usa um item quando ele acabar</div>
          <div style={{ fontSize: 13, color: COR.apagado, marginTop: 2 }}>
            Zerou um item, os produtos que levam ele na ficha técnica saem do cardápio. Repôs, voltam sozinhos — o que você pausou na mão continua pausado.
            {!ligado && pausariaAoLigar.length > 0 && (
              <> <strong style={{ color: COR.etiquetaTinta }}>Hoje {pausariaAoLigar.length} produto(s) usam item zerado e pausariam ao ligar.</strong></>
            )}
            {!estado.podeMudar && <> Só o dono da loja liga ou desliga.</>}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label="Pausar sozinho o que usa um item quando ele acabar"
          disabled={salvando || !estado.podeMudar}
          onClick={alternar}
          style={{
            position: "relative", width: 52, height: 28, borderRadius: 20, border: "none", flexShrink: 0,
            background: ligado ? COR.ok : "#CBD5E1", cursor: salvando || !estado.podeMudar ? "not-allowed" : "pointer",
            opacity: salvando ? 0.6 : 1, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          <span style={{ position: "absolute", top: 3, left: ligado ? 27 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,0.2)", transition: "left .2s ease" }} />
        </button>
      </div>

      {recado && (
        <div role={recado.tipo === "erro" ? "alert" : "status"} style={{ marginTop: 8, fontSize: 13, color: recado.tipo === "erro" ? "#B91C1C" : COR.tinta }}>
          <strong>{recado.titulo}.</strong> {recado.detalhe}
        </div>
      )}

      {pausados.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 13, color: COR.etiquetaTinta, fontFamily: "inherit" }}
            aria-expanded={aberto}
          >
            ⏸ {pausados.length} produto(s) pausado(s) por falta de item {aberto ? "▲" : "▼"}
          </button>
          {aberto && (
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {pausados.map((p) => (
                <li
                  key={p.produtoId}
                  style={{ background: COR.etiqueta, color: COR.etiquetaTinta, borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontWeight: 600 }}
                >
                  {p.produto} · falta {p.faltando.map((f) => `${f.nome} (${qtd(f.saldo)}${f.unidade ? " " + f.unidade : ""})`).join(", ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
