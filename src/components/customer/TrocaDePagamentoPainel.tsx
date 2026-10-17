"use client";
import { useMemo, useState } from "react";
import { podeEditarPedidos, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { FORMAS_DE_PAGAMENTO_NA_ENTREGA, formaCanonica, podeTrocarPagamento } from "@/lib/pagamento-na-entrega";
import { lerPartes, quantoFalta, somarPartes, type ParteDoPagamento } from "@/lib/pagamento-dividido";
import { lerTrocoNoPix, textoDoTrocoNoPix, trocoNoPixDoPedido, type QuemFezOPix, type TrocoNoPix } from "@/lib/troco-no-pix";

/**
 * Trocar a forma de pagamento de um pedido, pelo painel — inteira ou DIVIDIDA.
 *
 * Mora no modal da comanda, FORA das abas de edição de propósito: a edição de
 * itens tem as regras dela (canal, modo), e esta troca vale em qualquer status
 * que não seja cancelado — inclusive finalizado — e em pedido de app. O que
 * decide se o botão aparece é a MESMA função que a API consulta
 * (`podeTrocarPagamento`), senão existiria botão que o servidor recusa.
 *
 * ── Por que dividir importa aqui ───────────────────────────────────────────
 *
 * O cliente escolhe "dinheiro" no pedido, chega no caixa e paga metade no
 * débito e metade no crédito. Registrando uma forma só, o fechamento cobra da
 * gaveta um valor que passou na maquininha — e a diferença aparece todo dia
 * sem explicação. O caixa já sabia somar pagamento dividido (as partes vão
 * cada uma para a sua linha da conferência); faltava a tela deixar registrar.
 *
 * ── O que faz ser fácil ────────────────────────────────────────────────────
 *
 * A pessoa nunca faz conta de cabeça: ao abrir a divisão, a primeira forma já
 * vem com o total inteiro; ao escolher a segunda, o que sobra cai nela sozinho;
 * e enquanto não fechar, a barra mostra "faltam R$ X" e o botão não salva.
 *
 * ── Troco feito pelo Pix ───────────────────────────────────────────────────
 *
 * Com dinheiro e "troco para" acima do valor, aparece "Troco feito pelo Pix":
 * o troco voltou ao cliente por Pix, da conta da loja ou do celular do
 * motoboy. Muda o que o caixa espera na gaveta e no Pix e o que o motoboy
 * entrega no acerto (lib/troco-no-pix.ts) — pedido do Allan, Delícia de Casa.
 */
export default function TrocaDePagamentoPainel({
  pedido,
  operador,
  aoSalvar,
  abrirDireto = false,
  aoFechar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  aoSalvar: (resultado: { paymentMethod: string; changeAmount: number | null; paymentMethods?: ParteDoPagamento[] | null; trocoNoPix?: TrocoNoPix | null }) => void | Promise<void>;
  /**
   * Quem abre a troca por um clique na própria forma de pagamento (relatório
   * de motoboys) já pediu para trocar: o painel nasce aberto, e "Cancelar"
   * devolve o controle por `aoFechar` em vez de voltar ao botão "Trocar".
   */
  abrirDireto?: boolean;
  aoFechar?: () => void;
}) {
  const total = Number(pedido?.totalAmount || 0);
  const partesAtuais = useMemo(() => lerPartes(pedido?.paymentMethods), [pedido?.paymentMethods]);

  const [aberto, setAberto] = useState(abrirDireto);
  const [dividido, setDividido] = useState(partesAtuais.length >= 2);
  const [forma, setForma] = useState<string>(formaCanonica(pedido?.paymentMethod) || "Dinheiro");
  const [partes, setPartes] = useState<{ method: string; valor: string }[]>(
    partesAtuais.length >= 2
      ? partesAtuais.map((p) => ({ method: p.method, valor: p.amount.toFixed(2) }))
      : [{ method: formaCanonica(pedido?.paymentMethod) || "Dinheiro", valor: total.toFixed(2) }, { method: "", valor: "" }]
  );
  const [trocoPara, setTrocoPara] = useState<string>(pedido?.changeAmount ? String(pedido.changeAmount) : "");
  // De quem foi o Pix do troco ("" = o troco saiu em dinheiro, como sempre).
  const [pixDoTroco, setPixDoTroco] = useState<"" | QuemFezOPix>(lerTrocoNoPix(pedido?.trocoNoPix)?.por ?? "");
  const ehEntrega = String(pedido?.deliveryType || "").toUpperCase() === "DELIVERY";
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = pedido?.paymentMethod || "não informado";
  const trocoAtual = Number(pedido?.changeAmount || 0);
  const trocoNoPixAtual = trocoNoPixDoPedido(pedido || {});
  const caixa: React.CSSProperties = {
    marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
  };
  const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

  const botaoFechar = aoFechar && (
    <button
      type="button"
      onClick={aoFechar}
      style={{ padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#FFF", color: "#64748B", cursor: "pointer", fontFamily: "inherit" }}
    >
      Fechar
    </button>
  );

  if (!podeEditarPedidos(operador)) {
    return (
      <div style={{ ...caixa, fontSize: "0.8rem", color: "#334155", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>
          💳 <b>Pagamento:</b> {atual}
          {/* Quem clicou para trocar precisa saber POR QUE não abriu — e com
              quem resolver. Sem isto, o clique parecia não fazer nada. */}
          {abrirDireto && (
            <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8", marginTop: 2 }}>
              Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe.
            </span>
          )}
        </span>
        {botaoFechar}
      </div>
    );
  }

  const avaliacao = podeTrocarPagamento(pedido, { pelaLoja: true });

  if (!aberto || !avaliacao.pode) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#334155" }}>
          💳 <b>Pagamento:</b> {atual}
          {trocoAtual > 0 ? ` · troco para ${dinheiro(trocoAtual)}` : ""}
          {trocoNoPixAtual && (
            <span style={{ display: "block", fontSize: "0.74rem", color: "#0F766E", fontWeight: 700, marginTop: 2 }}>
              {textoDoTrocoNoPix(trocoNoPixAtual.valor, trocoNoPixAtual.por)}
            </span>
          )}
        </span>
        {avaliacao.pode ? (
          <button
            type="button"
            onClick={() => setAberto(true)}
            style={{ padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit" }}
          >
            Trocar
          </button>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>{avaliacao.motivo}</span>
            {botaoFechar}
          </span>
        )}
      </div>
    );
  }

  /* ── A conta que a tela faz pela pessoa ─────────────────────────────── */
  const partesValidas: ParteDoPagamento[] = partes
    .filter((p) => p.method && Number(String(p.valor).replace(",", ".")) > 0)
    .map((p) => ({ method: p.method, amount: Number(String(p.valor).replace(",", ".")) }));
  const somado = somarPartes(partesValidas);
  const falta = quantoFalta(partesValidas, total);
  const fecha = Math.abs(falta) <= 0.02 && partesValidas.length >= 2;

  /** Ao escolher a forma de uma linha vazia, o que sobra cai nela sozinho. */
  const escolherForma = (i: number, m: string) => {
    setPartes((antes) => {
      const novo = antes.map((p, j) => (j === i ? { ...p, method: m } : p));
      if (!antes[i].valor) {
        const outros = novo
          .filter((_, j) => j !== i)
          .reduce((s, p) => s + (Number(String(p.valor).replace(",", ".")) || 0), 0);
        const sobra = Math.round((total - outros) * 100) / 100;
        if (sobra > 0) novo[i] = { ...novo[i], valor: sobra.toFixed(2) };
      }
      return novo;
    });
  };

  const temDinheiro = dividido
    ? partesValidas.some((p) => p.method === "Dinheiro")
    : forma === "Dinheiro";

  // O troco desta nota: o "troco para" menos o que o cliente pagou em
  // dinheiro (no dividido, só a parte em dinheiro) — a mesma conta do servidor.
  const notaDigitada = temDinheiro && trocoPara.trim() ? Number(trocoPara.replace(",", ".")) || 0 : 0;
  const baseEmDinheiro = dividido ? partesValidas.find((p) => p.method === "Dinheiro")?.amount ?? 0 : total;
  const trocoDaNota = Math.round((notaDigitada - baseEmDinheiro) * 100) / 100;
  const temTroco = notaDigitada > 0 && trocoDaNota > 0.005;
  // Sem troco, a marca não vale — e no balcão não há motoboy para fazer o Pix.
  const pixEscolhido: "" | QuemFezOPix = !temTroco ? "" : pixDoTroco === "MOTOBOY" && !ehEntrega ? "LOJA" : pixDoTroco;

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const troco = temDinheiro && trocoPara.trim() ? Number(trocoPara.replace(",", ".")) : null;
      const corpo: any = { changeAmount: troco, trocoNoPix: pixEscolhido || null };
      if (dividido) corpo.paymentMethods = partesValidas;
      else corpo.paymentMethod = forma;

      const res = await fetch(`/api/store/orders/${pedido.id}/pagamento`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.error || "Não consegui trocar a forma de pagamento.");
        return;
      }
      setAberto(false);
      await aoSalvar({
        paymentMethod: data.paymentMethod ?? forma,
        changeAmount: data.changeAmount ?? null,
        paymentMethods: data.paymentMethods ?? null,
        trocoNoPix: data.trocoNoPix ?? null,
      });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  const chip = (ativa: boolean): React.CSSProperties => ({
    padding: "6px 10px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
    border: `1.5px solid ${ativa ? "#B45309" : "#E2E8F0"}`, background: ativa ? "#FFF7E6" : "#FFF", color: ativa ? "#78350F" : "#334155",
  });

  return (
    <div style={{ ...caixa, background: "#FFF7E6", border: "1.5px solid #FDE68A" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#92400E", marginBottom: 6 }}>
        💳 Como o cliente pagou de verdade? <span style={{ fontWeight: 600, color: "#B45309" }}>(o pedido dizia: {atual})</span>
      </div>

      {/* Uma forma ou várias — a escolha que abre tudo o mais */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button type="button" onClick={() => setDividido(false)} style={{ ...chip(!dividido), flex: 1 }}>
          Uma forma só
        </button>
        <button type="button" onClick={() => setDividido(true)} style={{ ...chip(dividido), flex: 1 }}>
          Dividiu o pagamento
        </button>
      </div>

      {!dividido ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {FORMAS_DE_PAGAMENTO_NA_ENTREGA.map((f) => (
            <button key={f} type="button" onClick={() => setForma(f)} style={chip(forma === f)}>
              {f}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: "0.72rem", color: "#B45309", marginBottom: 6 }}>
            Total do pedido: <b>{dinheiro(total)}</b> — divida entre as formas que o cliente usou.
          </div>

          {partes.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <select
                value={p.method}
                onChange={(e) => escolherForma(i, e.target.value)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #FDE68A", fontFamily: "inherit", fontSize: "0.78rem", background: "#FFF", color: "#334155" }}
              >
                <option value="">Escolha a forma…</option>
                {FORMAS_DE_PAGAMENTO_NA_ENTREGA.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <span style={{ fontSize: "0.76rem", color: "#78350F" }}>R$</span>
              <input
                type="text"
                inputMode="decimal"
                value={p.valor}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.,]/g, "");
                  setPartes((antes) => antes.map((x, j) => (j === i ? { ...x, valor: v } : x)));
                }}
                placeholder="0,00"
                style={{ width: 84, padding: "6px 8px", borderRadius: 8, border: "1.5px solid #FDE68A", fontFamily: "inherit", fontSize: "0.78rem", textAlign: "right" }}
              />
              {partes.length > 2 && (
                <button
                  type="button"
                  onClick={() => setPartes((antes) => antes.filter((_, j) => j !== i))}
                  title="Tirar esta forma"
                  style={{ border: "none", background: "none", color: "#B71C1C", cursor: "pointer", fontSize: "1rem", fontWeight: 800, lineHeight: 1, padding: "0 4px" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setPartes((antes) => [...antes, { method: "", valor: "" }])}
              style={{ padding: "4px 10px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, border: "1.5px dashed #FDE68A", background: "#FFF", color: "#B45309", cursor: "pointer", fontFamily: "inherit" }}
            >
              + Adicionar forma
            </button>
            {/* A conta feita pela tela: a pessoa lê, não calcula. */}
            <span style={{ fontSize: "0.76rem", fontWeight: 800, color: fecha ? "#0F766E" : falta >= -0.02 ? "#B45309" : "#B71C1C" }}>
              {/* Soma certa com uma forma só ainda não é divisão: dizia
                  "passou R$ 0,00" logo ao abrir, antes da segunda forma. */}
              {fecha
                ? `✓ fecha em ${dinheiro(somado)}`
                : Math.abs(falta) <= 0.02
                  ? "escolha a segunda forma"
                  : falta > 0
                    ? `faltam ${dinheiro(falta)}`
                    : `passou ${dinheiro(Math.abs(falta))}`}
            </span>
          </div>
        </div>
      )}

      {temDinheiro && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.76rem", color: "#78350F", marginBottom: 8 }}>
          Troco para R$
          <input
            type="text"
            inputMode="decimal"
            value={trocoPara}
            onChange={(e) => setTrocoPara(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="opcional"
            style={{ width: 90, padding: "4px 8px", borderRadius: 6, border: "1px solid #FDE68A", fontFamily: "inherit", fontSize: "0.78rem" }}
          />
          {temTroco && <span style={{ color: "#B45309" }}>troco de {dinheiro(trocoDaNota)}</span>}
        </label>
      )}

      {/* ── TROCO FEITO PELO PIX ─────────────────────────────────────────
          Só com troco de verdade (nota acima do dinheiro do pedido). A frase
          de baixo diz o que muda no caixa e no acerto — quem marca precisa
          saber o que vai ver no fechamento. */}
      {temDinheiro && temTroco && (
        <div style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 8, background: "#FFF", border: "1px solid #FDE68A" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", fontWeight: 800, color: "#78350F", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={pixEscolhido !== ""}
              onChange={(e) => setPixDoTroco(e.target.checked ? "LOJA" : "")}
            />
            Troco feito pelo Pix ({dinheiro(trocoDaNota)})
          </label>
          {pixEscolhido !== "" && (
            <>
              {ehEntrega && (
                <div style={{ display: "flex", gap: 6, margin: "6px 0 4px" }}>
                  <button type="button" onClick={() => setPixDoTroco("LOJA")} style={{ ...chip(pixEscolhido === "LOJA"), flex: 1 }}>
                    Pix da loja
                  </button>
                  <button type="button" onClick={() => setPixDoTroco("MOTOBOY")} style={{ ...chip(pixEscolhido === "MOTOBOY"), flex: 1 }}>
                    Pix do motoboy
                  </button>
                </div>
              )}
              <div style={{ fontSize: "0.72rem", color: "#92400E", lineHeight: 1.35, marginTop: 4 }}>
                {pixEscolhido === "MOTOBOY"
                  ? `O motoboy fica com ${dinheiro(trocoDaNota)} da nota (paga o Pix que ele fez) e entrega ${dinheiro(baseEmDinheiro)} à loja. A gaveta conta só o valor do pedido.`
                  : `Nenhum troco sai da gaveta: a nota de ${dinheiro(notaDigitada)} fica no caixa e o Pix esperado cai ${dinheiro(trocoDaNota)} (saiu da conta da loja). O pedido continua valendo ${dinheiro(baseEmDinheiro)} no caixa.`}
              </div>
            </>
          )}
        </div>
      )}

      {erro && <div style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => { setErro(null); if (aoFechar) aoFechar(); else setAberto(false); }}
          style={{ padding: "6px 12px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#FFF", color: "#64748B", cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancelar
        </button>
        <button
          type="button"
          // Salvar divisão que não fecha é criar diferença de caixa que ninguém
          // vai achar depois — o servidor recusa, e a tela nem deixa tentar.
          disabled={salvando || (dividido && !fecha)}
          onClick={salvar}
          style={{
            padding: "6px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 800, border: "none",
            background: salvando || (dividido && !fecha) ? "#94A3B8" : "#B45309",
            color: "#FFF", cursor: salvando || (dividido && !fecha) ? "default" : "pointer", fontFamily: "inherit",
          }}
        >
          {salvando ? "Salvando…" : "Salvar pagamento"}
        </button>
      </div>
    </div>
  );
}
