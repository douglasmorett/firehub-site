"use client";
import { useState } from "react";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import {
  MAXIMO_DO_ENDERECO,
  enderecoParaGravar,
  mesmoEndereco,
  motivoParaNaoCorrigir,
  problemaDoEndereco,
} from "@/lib/correcao-de-endereco";

/**
 * "Corrigir endereço" — no modal Ver pedido do painel, ao lado da correção da
 * taxa. É a tela da rota /api/store/orders/[id]/endereco; a regra de quem
 * pode é lib/correcao-de-endereco.ts (a mesma da rota, para não existir
 * botão que o servidor recusa).
 *
 * Pedido do Flavio (Showrrascão, 17/10/2026): o cliente errou o endereço e a
 * loja não tinha onde acertar no pedido. Vale também em pedido do iFood/99Food
 * — o endereço muda aqui (comanda, mapa, app do motoboy), não no app.
 *
 * Depois de salvar, o resultado fica na tela até o OK: se o mapa não achou o
 * endereço novo, a pessoa precisa saber que o pedido está sem ponto.
 */

export type ResultadoDoEndereco = {
  customerAddress: string;
  achouNoMapa: boolean;
  distanciaKm: number | null;
  distanciaRefeita: boolean;
};

const kmNaTela = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export default function CorrigirEnderecoPainel({
  pedido,
  operador,
  aoSalvar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  aoSalvar: (r: ResultadoDoEndereco) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDoEndereco | null>(null);

  if (motivoParaNaoCorrigir(pedido, operador)) return null;

  const atual = String(pedido?.customerAddress || "");
  const abrir = () => {
    setTexto(atual);
    setErro(null);
    setResultado(null);
    setAberto(true);
  };

  const salvar = async () => {
    const endereco = enderecoParaGravar(texto);
    const problema = problemaDoEndereco(endereco);
    if (problema) return setErro(problema);
    if (mesmoEndereco(endereco, atual)) return setAberto(false);
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/endereco`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endereco }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Não consegui corrigir o endereço.");
      if (d.semMudanca) return setAberto(false);
      const r: ResultadoDoEndereco = {
        customerAddress: d.customerAddress,
        achouNoMapa: d.achouNoMapa === true,
        distanciaKm: typeof d.distanciaKm === "number" ? d.distanciaKm : null,
        distanciaRefeita: d.distanciaRefeita === true,
      };
      setAberto(false);
      setResultado(r);
      await aoSalvar(r);
    } catch (e: any) {
      setErro(e?.message || "Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  if (!aberto) {
    return (
      <>
        <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "#334155", minWidth: 0, flex: "1 1 180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            📍 <b>Endereço:</b> {atual || "—"}
          </span>
          <button type="button" onClick={abrir} style={botaoLeve}>
            Corrigir endereço
          </button>
        </div>
        {resultado && (
          <div style={{ ...caixaAberta, fontSize: "0.78rem", color: "#115E59" }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Endereço corrigido.</div>
            <div>
              {resultado.achouNoMapa
                ? resultado.distanciaRefeita && resultado.distanciaKm != null
                  ? `Achei no mapa: ${kmNaTela(resultado.distanciaKm)} km da loja. O motoboy e a roteirização já usam o endereço novo.`
                  : "Achei no mapa. O motoboy e a roteirização já usam o endereço novo."
                : "Não achei o endereço novo no mapa agora. O sistema tenta de novo sozinho; se precisar já, posicione o pedido no mapa da Roteirização."}
            </div>
            <div style={{ marginTop: 4 }}>
              A taxa de entrega não mudou. Se a comanda do motoboy já saiu, imprima de novo.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" onClick={() => setResultado(null)} style={botaoLeve}>OK</button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={caixaAberta}>
      <label style={rotulo} htmlFor={`endereco-${pedido.id}`}>Endereço de entrega (rua, número, bairro — e a referência)</label>
      <textarea
        id={`endereco-${pedido.id}`}
        autoFocus
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={MAXIMO_DO_ENDERECO}
        rows={3}
        style={{ ...campo, width: "100%", resize: "vertical" }}
      />
      {erro && <div style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginTop: 6 }}>{erro}</div>}
      <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 6 }}>
        Muda a comanda, o mapa e o app do motoboy. Pedido de app: o endereço muda só aqui, não no iFood/99Food.
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" onClick={() => setAberto(false)} disabled={salvando} style={botaoLeve}>Cancelar</button>
        <button type="button" onClick={() => void salvar()} disabled={salvando} style={{ ...botaoLeve, background: "#0F766E", borderColor: "#0F766E", color: "#FFF", opacity: salvando ? 0.6 : 1 }}>
          {salvando ? "Salvando e procurando no mapa…" : "Salvar endereço"}
        </button>
      </div>
    </div>
  );
}

const caixa: React.CSSProperties = {
  marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
};
const caixaAberta: React.CSSProperties = { ...caixa, background: "#F0FDFA", border: "1.5px solid #99F6E4" };
const botaoLeve: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0",
  background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit",
};
const campo: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 8, border: "1.5px solid #99F6E4", fontFamily: "inherit", fontSize: "0.8rem",
  background: "#FFF", color: "#0F172A", boxSizing: "border-box",
};
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.74rem", fontWeight: 800, color: "#115E59", marginBottom: 4 };
