"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { consultaDoBalcao, entregaNoPedidoDoBalcao, lerCotacaoNoBalcao } from "@/lib/entrega-no-checkout";
import { digitosNacionais, preencherBalcao, type ClienteSugerido } from "@/lib/busca-de-clientes";
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
 * Balcão/retirada que vira ENTREGA (Lapastine, 09/10/2026): endereço + taxa,
 * a taxa sugerida pela cotação do balcão.
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
  // Virar ENTREGA: o endereço e a taxa, como no PDV (venda-presencial): rua e
  // número, o bairro da lista quando a loja entrega por bairro, a taxa da
  // mesma cotação (/api/delivery-fee) e editável. "Balcão" no endereço é o
  // que o PDV grava na retirada — não é endereço.
  const { data: sessao } = useSession();
  const cidadeDaLoja = String((sessao?.user as any)?.city ?? "");
  const enderecoInicial = String(pedido?.customerAddress || "").trim();
  const [endereco, setEndereco] = useState<string>(/^(balc[aã]o|retirada.*)$/i.test(enderecoInicial) ? "" : enderecoInicial);
  const [bairrosDaLoja, setBairrosDaLoja] = useState<{ name: string; fee: number }[]>([]);
  const [bairro, setBairro] = useState("");
  /** O último endereço de entrega do cliente (a mesma busca do PDV), para um toque. */
  const [ultimoDoCliente, setUltimoDoCliente] = useState<ClienteSugerido | null>(null);
  const [taxaTexto, setTaxaTexto] = useState("");
  // Mexeu na taxa: a cotação não apaga o que foi combinado com o cliente,
  // até o endereço mudar (a mesma regra do PDV).
  const [taxaNaMao, setTaxaNaMao] = useState(false);
  const [cotacao, setCotacao] = useState<{ token: string; endereco: string } | null>(null);
  const [cotando, setCotando] = useState(false);
  const [avisoDaTaxa, setAvisoDaTaxa] = useState<string | null>(null);
  const enderecoDaEntrega = [endereco.trim(), bairro].filter(Boolean).join(" - ");

  // Os bairros da loja e o último endereço do cliente, uma vez, quando a
  // entrega é escolhida. Falhou: o campo livre continua.
  useEffect(() => {
    if (destino !== "DELIVERY") return;
    let vivo = true;
    fetch("/api/store-settings/balcao").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!vivo || !Array.isArray(d?.bairros)) return;
      setBairrosDaLoja(
        d.bairros
          .filter((b: any) => b && typeof b.name === "string" && b.name.trim())
          .map((b: any) => ({ name: b.name.trim(), fee: Number(b.fee) || 0 }))
          .filter((b: { name: string }, i: number, todos: { name: string }[]) => todos.findIndex((o) => o.name === b.name) === i)
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "pt-BR")),
      );
    }).catch(() => {});
    const digitos = digitosNacionais(pedido?.customerPhone);
    if (digitos.length >= 10 && !/^0+$/.test(digitos)) {
      fetch(`/api/store/clientes/buscar?q=${encodeURIComponent(digitos)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (!vivo) return;
        const c = (Array.isArray(d?.clientes) ? d.clientes : []).find((x: ClienteSugerido) => x.telefone === digitos) as ClienteSugerido | undefined;
        if (c && (c.endereco || c.enderecoTexto)) setUltimoDoCliente(c);
      }).catch(() => {});
    }
    return () => { vivo = false; };
  }, [destino, pedido?.customerPhone]);

  useEffect(() => { setTaxaNaMao(false); }, [enderecoDaEntrega]);

  useEffect(() => {
    if (destino !== "DELIVERY") return;
    const texto = enderecoDaEntrega;
    if (texto.length < 6 && !bairro) { setAvisoDaTaxa(null); setCotacao(null); return; }
    if (taxaNaMao) return;
    let vivo = true;
    const controle = new AbortController();
    setCotando(true);
    setCotacao(null);
    const agendado = setTimeout(async () => {
      try {
        const res = await fetch(`/api/delivery-fee?${consultaDoBalcao(texto, cidadeDaLoja)}`, { signal: controle.signal });
        const d = await res.json().catch(() => null);
        if (!vivo) return;
        const lida = lerCotacaoNoBalcao(res.ok ? d : null, d?.message);
        setTaxaTexto(lida.taxa != null ? String(lida.taxa).replace(".", ",") : "");
        setAvisoDaTaxa(lida.texto || null);
        setCotacao(lida.cotacao ? { token: lida.cotacao, endereco: texto } : null);
      } catch {
        if (vivo) setAvisoDaTaxa("Não consegui calcular a taxa. Digite o valor na mão.");
      } finally {
        if (vivo) setCotando(false);
      }
    }, 600);
    return () => { vivo = false; controle.abort(); clearTimeout(agendado); setCotando(false); };
  }, [destino, enderecoDaEntrega, bairro, taxaNaMao, cidadeDaLoja]);

  // A tela não tem todos os campos (pagamento confirmado, saída); a avaliação
  // daqui só decide se o botão aparece. Quem decide de verdade é o GET.
  const previa = avaliarTrocaDeTipo(pedido, operador);
  const tipoAtual = tipoAtualDoPedido(pedido);

  if (resultado) {
    return (
      <div style={caixaVerde}>
        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#14532D" }}>
          ✅ {resultado.mesa != null ? `Pedido na Mesa ${resultado.mesa}` : resultado.deliveryType === "DELIVERY" ? "Pedido virou entrega" : "Pedido no balcão"}
          {resultado.abriuAMesa ? " (mesa aberta no nome do cliente)" : ""}
        </div>
        <div style={{ fontSize: "0.78rem", color: "#166534", marginTop: 4 }}>
          {resultado.descricao}. Total agora: <b>{dinheiro(resultado.totalAmount)}</b>.
          {resultado.mesa != null ? " Ele é pago quando a mesa fechar." : ""}
        </div>
        {resultado.aviso && <div style={{ ...avisoAmarelo, marginTop: 6 }}>⚠️ {resultado.aviso}</div>}
        <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 6 }}>
          {resultado.deliveryType === "DELIVERY"
            ? "A comanda sai de novo, agora com o endereço. Escolha o motoboy no card."
            : "A comanda que já saiu impressa ainda diz delivery. Reimprima pela aba Comanda se a cozinha precisar."}
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
        body: JSON.stringify({
          destino,
          tableId: destino === "MESA" ? mesaId : undefined,
          ...(destino === "DELIVERY"
            ? { endereco: enderecoDaEntrega, taxa: taxaNumero, ...entregaNoPedidoDoBalcao(enderecoDaEntrega, cotacao, taxaNaMao, cidadeDaLoja) }
            : {}),
        }),
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
  const taxaNumero = Number(String(taxaTexto).replace(",", ".").trim());
  const taxaValida = String(taxaTexto).trim() !== "" && Number.isFinite(taxaNumero) && taxaNumero >= 0;
  const prontoParaConfirmar = !!destino
    && (destino !== "MESA" || !!mesaEscolhida)
    && (destino !== "DELIVERY" || (enderecoDaEntrega.length >= 6 && taxaValida));

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
                  {ICONE[d]} {ROTULO_DO_DESTINO[d]}
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

          {destino === "DELIVERY" && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {ultimoDoCliente && (
                <button
                  type="button"
                  style={{ ...botaoLeve, textAlign: "left", whiteSpace: "normal" }}
                  onClick={() => {
                    const p = preencherBalcao(ultimoDoCliente, bairrosDaLoja);
                    setEndereco(p.endereco);
                    setBairro(p.bairro);
                    setUltimoDoCliente(null);
                  }}
                >
                  📍 Usar o último endereço do cliente: {ultimoDoCliente.endereco?.texto || ultimoDoCliente.enderecoTexto}
                </button>
              )}
              <label style={{ fontSize: "0.74rem", fontWeight: 800, color: "#115E59" }}>
                {bairrosDaLoja.length > 0 ? "Rua e número (complemento)" : "Endereço de entrega"}
                <input
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  placeholder={bairrosDaLoja.length > 0 ? "Rua, número (complemento)" : "Rua, número - Bairro (complemento)"}
                  autoFocus
                  style={campoDeTexto}
                />
              </label>
              {bairrosDaLoja.length > 0 && (
                <label style={{ fontSize: "0.74rem", fontWeight: 800, color: "#115E59" }}>
                  Bairro
                  <select value={bairro} onChange={(e) => setBairro(e.target.value)} style={campoDeTexto}>
                    <option value="">Escolha o bairro…</option>
                    {bairrosDaLoja.map((b) => (
                      <option key={b.name} value={b.name}>{b.name} — {dinheiro(b.fee)}</option>
                    ))}
                  </select>
                </label>
              )}
              <label style={{ fontSize: "0.74rem", fontWeight: 800, color: "#115E59" }}>
                Taxa de entrega (R$)
                <input
                  value={taxaTexto}
                  onChange={(e) => { setTaxaTexto(e.target.value); setTaxaNaMao(true); }}
                  inputMode="decimal"
                  placeholder={cotando ? "calculando…" : "0,00"}
                  style={{ ...campoDeTexto, maxWidth: 140 }}
                />
              </label>
              {(cotando || avisoDaTaxa) && (
                <div style={{ fontSize: "0.72rem", color: "#475569" }}>{cotando ? "Calculando a taxa pela área de entrega…" : avisoDaTaxa}</div>
              )}
              {leitura && taxaValida && (
                <div style={{ fontSize: "0.78rem", color: "#334155" }}>
                  Total {dinheiro(leitura.totalAmount)} → <b>{dinheiro(Math.max(0, leitura.totalAmount - leitura.deliveryFee + taxaNumero))}</b>. Depois é só escolher o motoboy no card.
                </div>
              )}
            </div>
          )}

          {destino && destino !== "DELIVERY" && leitura && (
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
              {salvando ? "Trocando…" : destino === "MESA" && mesaEscolhida ? `Passar para a ${mesaEscolhida.label || `Mesa ${mesaEscolhida.number}`}` : destino === "BALCAO" ? "Passar para o balcão" : destino === "DELIVERY" ? "Passar para entrega" : "Escolha acima"}
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
const campoDeTexto: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4, padding: "7px 10px", borderRadius: 8, border: "1.5px solid #99F6E4",
  fontSize: "0.84rem", fontFamily: "inherit", color: "#0F172A", background: "#FFF", boxSizing: "border-box",
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
