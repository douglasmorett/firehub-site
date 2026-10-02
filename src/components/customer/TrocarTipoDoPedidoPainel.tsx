"use client";

import { useState } from "react";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import {
  ROTULO_DO_DESTINO,
  ROTULO_DO_TIPO,
  avaliarTrocaDeTipo,
  tipoAtualDoPedido,
  type AvaliacaoDaTroca,
  type TipoDeDestino,
} from "@/lib/troca-de-tipo";

/**
 * "Trocar tipo" — no lápis do card (aba Editar itens), acima da edição.
 *
 * Delivery que vira mesa ou balcão: o cliente está no salão e pediu pelo
 * cardápio do delivery (Ragnar, 01/10/2026). Mesa → escolhe a mesa (livre
 * abre no nome do cliente; ocupada, o pedido entra na conta dela). A regra é
 * lib/troca-de-tipo.ts, a mesma da rota api/store/orders/[id]/tipo.
 */

type Mesa = { id: string; number: number; label: string | null; ocupada: boolean; customerName: string | null; waiterName: string | null };

type Leitura = {
  avaliacao: AvaliacaoDaTroca;
  tipoAtual: keyof typeof ROTULO_DO_TIPO;
  deliveryFee: number;
  totalAmount: number;
  totalDepois: number;
  mesas: Mesa[];
};

export type ResultadoDaTroca = {
  deliveryType: string;
  mesa: number | null;
  abriuAMesa: boolean;
  totalAmount: number;
  descricao: string;
  aviso?: string;
};

const dinheiro = (n: number) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

const ICONE = { DELIVERY: "🛵", BALCAO: "🧍", MESA: "🍽️" } as const;

export default function TrocarTipoDoPedidoPainel({
  pedido,
  operador,
  aoTrocar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  /** Chamado depois de gravar: a tela relê os pedidos. */
  aoTrocar: (r: ResultadoDaTroca) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [destino, setDestino] = useState<TipoDeDestino | null>(null);
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaTroca | null>(null);

  // A tela não tem todos os campos (pagamento confirmado, saída); a avaliação
  // daqui só decide se o botão aparece. Quem decide de verdade é o GET.
  const previa = avaliarTrocaDeTipo(pedido, operador);
  const tipoAtual = tipoAtualDoPedido(pedido);

  if (resultado) {
    return (
      <div style={caixaVerde}>
        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#14532D" }}>
          ✅ {resultado.mesa != null ? `Pedido na Mesa ${resultado.mesa}` : "Pedido no balcão"}
          {resultado.abriuAMesa ? " (mesa aberta no nome do cliente)" : ""}
        </div>
        <div style={{ fontSize: "0.78rem", color: "#166534", marginTop: 4 }}>
          {resultado.descricao}. Total agora: <b>{dinheiro(resultado.totalAmount)}</b>.
          {resultado.mesa != null ? " Ele é pago quando a mesa fechar." : ""}
        </div>
        {resultado.aviso && <div style={{ ...avisoAmarelo, marginTop: 6 }}>⚠️ {resultado.aviso}</div>}
        <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 6 }}>
          A comanda que já saiu impressa ainda diz delivery. Reimprima pela aba Comanda se a cozinha precisar.
        </div>
        <div style={{ textAlign: "right", marginTop: 6 }}>
          <button type="button" style={botaoLeve} onClick={() => setResultado(null)}>OK</button>
        </div>
      </div>
    );
  }

  if (!previa.pode && tipoAtual === "MESA") return null;
  if (!previa.pode) {
    // Delivery que não troca (saiu, marketplace, nota): a linha diz o porquê
    // em vez de sumir — o atendente procura a opção que viu em outro pedido.
    return (
      <div style={caixa}>
        <span style={{ fontSize: "0.8rem", color: "#334155" }}>
          {ICONE[tipoAtual]} <b>Tipo:</b> {ROTULO_DO_TIPO[tipoAtual]}
        </span>
        <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 2 }}>{previa.motivo}</div>
      </div>
    );
  }

  const abrir = async () => {
    setAberto(true);
    setErro(null);
    setDestino(null);
    setMesaId(null);
    setCarregando(true);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/tipo`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.error || `Erro ${res.status} ao ler o pedido.`);
        return;
      }
      setLeitura(data as Leitura);
      const av = (data as Leitura).avaliacao;
      // Um destino só e liberado: já vem marcado.
      if (av.pode && av.destinos.length === 1 && !av.barrados[av.destinos[0]]) setDestino(av.destinos[0]);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  };

  const fechar = () => {
    setAberto(false);
    setLeitura(null);
    setErro(null);
  };

  const confirmar = async () => {
    if (!destino) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/tipo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destino, tableId: destino === "MESA" ? mesaId : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.error || data?.mensagem || `Erro ${res.status} ao trocar o tipo.`);
        return;
      }
      const r = data as ResultadoDaTroca;
      setAberto(false);
      setLeitura(null);
      setResultado(r);
      await aoTrocar(r);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  if (!aberto) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#334155" }}>
          {ICONE[tipoAtual]} <b>Tipo:</b> {ROTULO_DO_TIPO[tipoAtual]}
        </span>
        <button type="button" onClick={abrir} style={botaoLeve}>
          Trocar para {previa.destinos.map((d) => ROTULO_DO_DESTINO[d].split(" ")[0].toLowerCase()).join(" ou ")}
        </button>
      </div>
    );
  }

  const av = leitura?.avaliacao;
  const mesaEscolhida = leitura?.mesas.find((m) => m.id === mesaId) || null;
  const prontoParaConfirmar = !!destino && (destino !== "MESA" || !!mesaEscolhida);

  return (
    <div style={caixaAberta}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#115E59" }}>
          {ICONE[tipoAtual]} {ROTULO_DO_TIPO[tipoAtual]} → trocar para…
        </span>
        <button type="button" onClick={fechar} style={botaoLeve}>Cancelar</button>
      </div>

      {carregando && <div style={{ fontSize: "0.78rem", color: "#64748B" }}>Carregando…</div>}

      {av && !av.pode && <div style={avisoAmarelo}>{av.motivo}</div>}

      {av && av.pode && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {av.destinos.map((d) => {
              const barrado = av.barrados[d];
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!!barrado}
                  title={barrado || undefined}
                  onClick={() => { setDestino(d); setMesaId(null); }}
                  style={{ ...opcao(destino === d), ...(barrado ? { opacity: 0.45, cursor: "not-allowed" } : {}) }}
                >
                  {d === "MESA" ? ICONE.MESA : ICONE.BALCAO} {ROTULO_DO_DESTINO[d]}
                </button>
              );
            })}
          </div>
          {av.destinos.map((d) => av.barrados[d] && (
            <div key={d} style={{ fontSize: "0.74rem", color: "#92400E", marginTop: 6 }}>
              {ROTULO_DO_DESTINO[d]}: {av.barrados[d]}
            </div>
          ))}

          {destino === "MESA" && leitura && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#115E59", marginBottom: 6 }}>Qual mesa?</div>
              {leitura.mesas.length === 0 ? (
                <div style={avisoAmarelo}>A loja não tem mesas cadastradas. Cadastre em Mesas.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {leitura.mesas.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMesaId(m.id)}
                      style={mesaBotao(mesaId === m.id, m.ocupada)}
                      title={m.ocupada ? `Ocupada${m.customerName ? ` — ${m.customerName}` : ""}` : "Livre"}
                    >
                      <div style={{ fontWeight: 800, fontSize: "0.85rem" }}>{m.label || `Mesa ${m.number}`}</div>
                      <div style={{ fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.ocupada ? m.customerName || "Ocupada" : "Livre"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {destino && leitura && (
            <div style={{ fontSize: "0.78rem", color: "#334155", marginTop: 10, lineHeight: 1.45 }}>
              {leitura.deliveryFee > 0 && (
                <div>A taxa de entrega de <b>{dinheiro(leitura.deliveryFee)}</b> sai: total {dinheiro(leitura.totalAmount)} → <b>{dinheiro(leitura.totalDepois)}</b>.</div>
              )}
              {destino === "MESA" && mesaEscolhida && (
                <div>
                  {mesaEscolhida.ocupada
                    ? <>O pedido entra na conta da <b>{mesaEscolhida.label || `Mesa ${mesaEscolhida.number}`}</b>{mesaEscolhida.customerName ? ` (${mesaEscolhida.customerName})` : ""} e é pago quando ela fechar.</>
                    : <>A <b>{mesaEscolhida.label || `Mesa ${mesaEscolhida.number}`}</b> abre no nome de {pedido.customerName || "cliente"}, e o pedido é pago quando ela fechar.</>}
                </div>
              )}
              {destino === "BALCAO" && <div>O cliente retira no balcão. A forma de pagamento continua a mesma.</div>}
              {pedido.motoboyId && <div>O pedido sai do motoboy.</div>}
            </div>
          )}

          {erro && <div style={{ ...avisoVermelho, marginTop: 8 }}>{erro}</div>}

          <div style={{ textAlign: "right", marginTop: 10 }}>
            <button
              type="button"
              disabled={!prontoParaConfirmar || salvando}
              onClick={() => void confirmar()}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "none", fontWeight: 800, fontSize: "0.8rem", fontFamily: "inherit",
                background: prontoParaConfirmar ? "#0F766E" : "#CBD5E1", color: "#FFF",
                cursor: prontoParaConfirmar && !salvando ? "pointer" : "not-allowed",
              }}
            >
              {salvando ? "Trocando…" : destino === "MESA" && mesaEscolhida ? `Passar para a ${mesaEscolhida.label || `Mesa ${mesaEscolhida.number}`}` : destino === "BALCAO" ? "Passar para o balcão" : "Escolha acima"}
            </button>
          </div>
        </>
      )}

      {erro && !av && <div style={avisoVermelho}>{erro}</div>}
    </div>
  );
}

const caixa: React.CSSProperties = {
  marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
};
const caixaAberta: React.CSSProperties = { ...caixa, background: "#F0FDFA", border: "1.5px solid #99F6E4" };
const caixaVerde: React.CSSProperties = { ...caixa, background: "#F0FDF4", border: "1.5px solid #86EFAC" };
const avisoAmarelo: React.CSSProperties = {
  fontSize: "0.76rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 8px",
};
const avisoVermelho: React.CSSProperties = {
  fontSize: "0.76rem", color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "6px 8px",
};
const botaoLeve: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0",
  background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit",
};
const opcao = (ativa: boolean): React.CSSProperties => ({
  padding: "8px 14px", borderRadius: 8, fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${ativa ? "#0F766E" : "#CCFBF1"}`, background: ativa ? "#CCFBF1" : "#FFF", color: ativa ? "#134E4A" : "#334155",
});
const mesaBotao = (ativa: boolean, ocupada: boolean): React.CSSProperties => ({
  padding: "6px 4px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", textAlign: "center", minWidth: 0,
  border: `1.5px solid ${ativa ? "#0F766E" : ocupada ? "#FDBA74" : "#CBD5E1"}`,
  background: ativa ? "#CCFBF1" : ocupada ? "#FFF7ED" : "#FFF",
  color: ativa ? "#134E4A" : ocupada ? "#9A3412" : "#334155",
});
