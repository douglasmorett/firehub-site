"use client";

/**
 * "Como a nota é emitida" — a escolha que decide se o FireHub emite sozinho
 * ou se a pessoa emite pelo pedido (lib/fiscal-modo).
 *
 * Mora fora de page.tsx pelo mesmo motivo do EmissorProprio: a tela fiscal
 * passa de 3 mil linhas. Tudo o que a escolha quer dizer vem das funções que
 * o servidor usa (resumoDaEmissao, formasDoCanal): a frase "Como vai ficar"
 * é a regra da emissão, não uma cópia dela.
 *
 * Grava num botão só, e não a cada clique: com uma coluna por integração, o
 * clique solto gravava metade de uma decisão. O rascunho mostra o resumo
 * enquanto a pessoa marca, e só vale depois do Salvar.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, Hand, Zap } from "lucide-react";
import {
  documentoNaEntrega,
  formasDoCanal,
  INTEGRACOES_DA_NOTA,
  modoDaEmissao,
  nomeDaIntegracao,
  ORDEM_DAS_FORMAS,
  resumoDaEmissao,
  type DocumentoNaEntrega,
  type IntegracaoDaNota,
  type ModoDaEmissao,
} from "@/lib/fiscal-modo";
import { listaDaEmissaoAutomatica, type ChaveDePagamento } from "@/lib/fiscal-momento";

/** Quando a nota sai — os três valores que lib/fiscal-momento lê. */
export const MOMENTOS_DA_EMISSAO = [
  {
    valor: "saida",
    nome: "Na saída (recomendado)",
    explicacao:
      "Entrega: quando o pedido sai (botão Saiu, rota despachada, motoboy puxando, despacho do parceiro). Retirada, " +
      "balcão e totem: na conclusão, quando o cliente leva. É o que a regra pede — NFC-e autorizada antes de a mercadoria sair.",
  },
  {
    valor: "aceite",
    nome: "No aceite",
    explicacao:
      "A nota sai quando a loja aceita o pedido. O mais seguro quanto ao “antes da saída” e o mais caro no cancelamento: " +
      "pedido cancelado depois dos 30 minutos fica com uma nota que não se cancela mais (devolução com o contador).",
  },
  {
    valor: "conclusao",
    nome: "Na conclusão",
    explicacao:
      "Tudo no ENTREGUE (o comportamento antigo). A nota da entrega sai depois de a comida chegar — só use se o seu contador pedir.",
  },
];

const DETALHE_DA_FORMA: Record<ChaveDePagamento, { rotulo: string; detalhe: string }> = {
  MONEY: { rotulo: "💵 Dinheiro", detalhe: "espécie, no balcão ou na entrega" },
  PIX: { rotulo: "⚡ Pix", detalhe: "QR no balcão ou chave" },
  CREDIT_CARD: { rotulo: "💳 Crédito", detalhe: "maquininha ou link" },
  DEBIT_CARD: { rotulo: "💳 Débito", detalhe: "maquininha" },
  VOUCHER: { rotulo: "🎟️ Vale-refeição", detalhe: "VR, VA, Alelo, Sodexo, Ticket" },
  ONLINE: { rotulo: "🌐 Pago online", detalhe: "no app do iFood/99 ou no site" },
};

/** Os atalhos que resolvem a maioria das lojas num clique. */
const ATALHOS: { nome: string; formas: ChaveDePagamento[] }[] = [
  { nome: "Todas as formas", formas: [...ORDEM_DAS_FORMAS] },
  { nome: "Só cartão, Pix e online", formas: ["PIX", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER", "ONLINE"] },
  { nome: "Nenhuma", formas: [] },
];

export type EscolhaDaEmissao = {
  enabled?: boolean;
  modoDaEmissao?: string;
  autoEmitPaymentMethods?: string[];
  formasPorIntegracao?: Partial<Record<string, string[]>> | null;
  cpfNaEntrega?: string;
  momentoDaEmissao?: string;
};

type Rascunho = {
  modo: ModoDaEmissao;
  loja: ChaveDePagamento[];
  integracoes: Partial<Record<IntegracaoDaNota, ChaveDePagamento[]>>;
  cpfNaEntrega: DocumentoNaEntrega;
  momento: string;
};

/** O rascunho a partir do gravado: cada integração da tela com a lista que vale hoje para ela. */
function rascunhoDo(config: EscolhaDaEmissao, integracoes: IntegracaoDaNota[]): Rascunho {
  const porIntegracao: Partial<Record<IntegracaoDaNota, ChaveDePagamento[]>> = {};
  for (const canal of integracoes) porIntegracao[canal] = formasDoCanal(config, canal);
  return {
    modo: modoDaEmissao(config),
    loja: listaDaEmissaoAutomatica(config.autoEmitPaymentMethods),
    integracoes: porIntegracao,
    cpfNaEntrega: documentoNaEntrega(config),
    momento: ["aceite", "saida", "conclusao"].includes(String(config.momentoDaEmissao)) ? String(config.momentoDaEmissao) : "saida",
  };
}

const mesmaLista = (a: ChaveDePagamento[], b: ChaveDePagamento[]) =>
  a.length === b.length && a.every((f) => b.includes(f));

/**
 * O rascunho em texto, na ordem da tela: marcar e desmarcar a mesma caixa
 * muda a ordem da lista, e sem isto o "ainda não salvo" não sumia.
 */
function canonico(r: Rascunho): string {
  const ordem = (l: ChaveDePagamento[] | undefined) => ORDEM_DAS_FORMAS.filter((f) => (l ?? []).includes(f));
  return JSON.stringify([
    r.modo,
    ordem(r.loja),
    INTEGRACOES_DA_NOTA.map((i) => (r.integracoes[i.canal] ? ordem(r.integracoes[i.canal]) : null)),
    r.cpfNaEntrega,
    r.momento,
  ]);
}

const colunaPresa: CSSProperties = { position: "sticky", left: 0, zIndex: 1, minWidth: 130 };
const titulo: CSSProperties = { fontSize: "0.9rem", fontWeight: 800, color: "#1E293B", margin: "20px 0 4px", display: "block" };
const ajuda: CSSProperties = { display: "block", fontSize: "0.76rem", color: "#64748B", fontWeight: 400, lineHeight: 1.5, margin: "2px 0 0" };

export default function ComoANotaEEmitida({
  config,
  integracoesDaLoja,
  podeMudar,
  aoSalvar,
}: {
  config: EscolhaDaEmissao;
  /** As integrações que a loja usa (as outras continuam iguais às vendas da loja). */
  integracoesDaLoja: IntegracaoDaNota[];
  /** Só o titular muda: o servidor recusa estes campos do funcionário. */
  podeMudar: boolean;
  aoSalvar: (campos: Record<string, unknown>) => Promise<{ ok: boolean; dados: any }>;
}) {
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const integracoes = useMemo<IntegracaoDaNota[]>(
    () => (mostrarTodas ? INTEGRACOES_DA_NOTA.map((i) => i.canal) : INTEGRACOES_DA_NOTA.map((i) => i.canal).filter((c) => integracoesDaLoja.includes(c))),
    [mostrarTodas, integracoesDaLoja]
  );

  const gravado = useMemo(() => rascunhoDo(config, integracoes), [config, integracoes]);
  const [rascunho, setRascunho] = useState<Rascunho>(gravado);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  // O gravado mudou (outra aba salvou, a tela recarregou): o rascunho segue,
  // a não ser que a pessoa esteja no meio de uma mudança.
  const [baseDoRascunho, setBaseDoRascunho] = useState(gravado);
  useEffect(() => {
    setRascunho((atual) => (canonico(atual) === canonico(baseDoRascunho) ? gravado : { ...atual, integracoes: { ...gravado.integracoes, ...atual.integracoes } }));
    setBaseDoRascunho(gravado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravado]);

  const mudou = canonico(rascunho) !== canonico(gravado);

  // O resumo lê o rascunho no MESMO formato do fiscalConfig — as funções do servidor.
  const comoFica = useMemo(
    () =>
      resumoDaEmissao(
        {
          modoDaEmissao: rascunho.modo,
          autoEmitPaymentMethods: rascunho.loja,
          formasPorIntegracao: rascunho.integracoes,
          cpfNaEntrega: rascunho.cpfNaEntrega,
        },
        integracoes
      ),
    [rascunho, integracoes]
  );

  const alternar = (coluna: "loja" | IntegracaoDaNota, forma: ChaveDePagamento) => {
    if (!podeMudar) return;
    setMensagem(null);
    setRascunho((r) => {
      const atual = coluna === "loja" ? r.loja : r.integracoes[coluna] ?? [];
      const nova = atual.includes(forma) ? atual.filter((f) => f !== forma) : [...atual, forma];
      return coluna === "loja" ? { ...r, loja: nova } : { ...r, integracoes: { ...r.integracoes, [coluna]: nova } };
    });
  };

  const aplicarAtalho = (formas: ChaveDePagamento[]) => {
    if (!podeMudar) return;
    setMensagem(null);
    setRascunho((r) => {
      const integracoesNovas: Partial<Record<IntegracaoDaNota, ChaveDePagamento[]>> = {};
      for (const canal of integracoes) integracoesNovas[canal] = [...formas];
      return { ...r, loja: [...formas], integracoes: { ...r.integracoes, ...integracoesNovas } };
    });
  };

  const salvar = async () => {
    if (!podeMudar || salvando) return;
    setSalvando(true);
    setMensagem(null);
    try {
      // Cada integração que passou pela tela vai com a lista dela (a que a
      // pessoa viu e confirmou); as que nunca apareceram ficam como estavam
      // no banco — seguindo as vendas da loja, se nunca tiveram lista.
      const formasPorIntegracao: Record<string, string[]> = {};
      for (const [canal, lista] of Object.entries(config.formasPorIntegracao || {})) {
        if (Array.isArray(lista)) formasPorIntegracao[canal] = lista;
      }
      for (const [canal, lista] of Object.entries(rascunho.integracoes)) formasPorIntegracao[canal] = lista ?? [];
      const r = await aoSalvar({
        modoDaEmissao: rascunho.modo,
        autoEmitPaymentMethods: rascunho.loja,
        formasPorIntegracao,
        cpfNaEntrega: rascunho.cpfNaEntrega,
        momentoDaEmissao: rascunho.momento,
      });
      if (!r.ok) {
        setMensagem({ ok: false, texto: r.dados?.mensagem || r.dados?.error || "Não consegui salvar. Nada foi alterado." });
      } else if (Array.isArray(r.dados?.camposIgnorados) && r.dados.camposIgnorados.length > 0) {
        setMensagem({ ok: false, texto: "Só o dono da loja muda como a nota é emitida — nada foi alterado." });
      } else {
        setMensagem({ ok: true, texto: rascunho.modo === "manual" ? "Salvo: as notas agora saem pelo pedido." : "Salvo: a nota sai sozinha como no resumo." });
      }
    } catch {
      setMensagem({ ok: false, texto: "Não consegui falar com o servidor. Nada foi alterado." });
    } finally {
      setSalvando(false);
    }
  };

  const cartao = (escolhido: boolean): CSSProperties => ({
    flex: "1 1 240px",
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: 12,
    border: `2px solid ${escolhido ? "#1C1917" : "#E2E8F0"}`,
    background: escolhido ? "#FAF6F2" : "#fff",
    cursor: podeMudar ? "pointer" : "not-allowed",
    font: "inherit",
    color: "inherit",
  });

  const colunas: ("loja" | IntegracaoDaNota)[] = ["loja", ...integracoes];
  const integracoesEscondidas = INTEGRACOES_DA_NOTA.length - integracoes.length;

  return (
    <div>
      {config.enabled !== true && (
        <p style={{ ...ajuda, margin: "12px 0 0", padding: "8px 12px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, color: "#475569" }}>
          A emissão está <strong>desligada</strong>: você já pode escolher, e passa a valer quando ligar a emissão.
        </p>
      )}
      {!podeMudar && (
        <p style={{ ...ajuda, margin: "12px 0 0", color: "#92400E" }}>Só o dono da loja muda como a nota é emitida.</p>
      )}

      {/* ── As duas formas ── */}
      <div role="radiogroup" aria-label="Como a nota é emitida" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
        <button type="button" role="radio" aria-checked={rascunho.modo === "automatico"} disabled={!podeMudar} onClick={() => { setMensagem(null); setRascunho((r) => ({ ...r, modo: "automatico" })); }} style={cartao(rascunho.modo === "automatico")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: "0.95rem", color: "#1E293B" }}>
            <Zap size={18} color="#B45309" aria-hidden /> Automática
            {rascunho.modo === "automatico" && <CheckCircle2 size={16} color="#0F766E" aria-hidden style={{ marginLeft: "auto" }} />}
          </span>
          <span style={{ ...ajuda, marginTop: 6 }}>
            O FireHub emite a nota <strong>sozinho</strong>, na hora certa, nas formas de pagamento que você marcar — nas vendas da loja e em
            cada integração. O site, o robô do WhatsApp, o balcão e o totem já perguntam o <strong>CPF/CNPJ</strong> no pedido.
          </span>
          <span style={{ ...ajuda, marginTop: 6, color: "#475569" }}>Bom para quem quer nota em toda venda (ou em todo cartão e Pix) sem ter de lembrar.</span>
        </button>
        <button type="button" role="radio" aria-checked={rascunho.modo === "manual"} disabled={!podeMudar} onClick={() => { setMensagem(null); setRascunho((r) => ({ ...r, modo: "manual" })); }} style={cartao(rascunho.modo === "manual")}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: "0.95rem", color: "#1E293B" }}>
            <Hand size={18} color="#0F766E" aria-hidden /> Manual (pelo pedido)
            {rascunho.modo === "manual" && <CheckCircle2 size={16} color="#0F766E" aria-hidden style={{ marginLeft: "auto" }} />}
          </span>
          <span style={{ ...ajuda, marginTop: 6 }}>
            <strong>Nenhuma nota sai sozinha.</strong> Quando o cliente pedir, você abre o pedido, digita o CPF/CNPJ e clica em Emitir
            NFC-e. O pedido não pergunta nada ao cliente.
          </span>
          <span style={{ ...ajuda, marginTop: 6, color: "#475569" }}>Bom para quem emite nota só quando o cliente pede.</span>
        </button>
      </div>

      {rascunho.modo === "manual" ? (
        <>
          <span style={titulo}>Como emitir pelo pedido</span>
          <ol style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {[
              ["1", "Em Pedidos, clique no 🧾 do card (ou em Ver pedido → Nota fiscal)."],
              ["2", "Digite o CPF/CNPJ se o cliente quiser. Na entrega ele é obrigatório: sem o documento a SEFAZ recusa a nota."],
              ["3", "Clique em Emitir NFC-e. O cupom fiscal sai na impressora, e a nota fica em Fiscal → Notas fiscais."],
            ].map(([n, texto]) => (
              <li key={n} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.82rem", color: "#334155", lineHeight: 1.45 }}>
                <span aria-hidden style={{ flex: "0 0 24px", height: 24, borderRadius: "50%", background: "#1C1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.75rem" }}>{n}</span>
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          {/* ── 1. As formas, por canal ── */}
          <span style={titulo}>1. Em quais vendas a nota sai sozinha?</span>
          <p style={ajuda}>
            Marque as formas de pagamento. Basta uma forma do pedido estar marcada: no pagamento dividido a nota é da venda inteira.
            {integracoes.length > 0 ? " Cada integração tem a própria coluna — a nota do iFood pode sair em todo pedido e a do balcão só no cartão, por exemplo." : ""}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 8px" }}>
            <span style={{ fontSize: "0.74rem", color: "#64748B", alignSelf: "center" }}>Atalhos:</span>
            {ATALHOS.map((a) => (
              <button
                key={a.nome}
                type="button"
                disabled={!podeMudar}
                onClick={() => aplicarAtalho(a.formas)}
                style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.74rem", fontWeight: 700, color: "#334155", cursor: podeMudar ? "pointer" : "not-allowed" }}
              >
                {a.nome}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto", border: "1px solid #E2E8F0", borderRadius: 10 }}>
            {/* No celular a tabela rola dentro da caixa, com a coluna das formas
                presa à esquerda: rolando para ver o Wabiz, o "Pix" continua à vista. */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 150 + colunas.length * 66 }}>
              <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Formas de pagamento com nota automática, por canal de venda
              </caption>
              <thead>
                <tr style={{ background: "#F8FAFC" }}>
                  <th scope="col" style={{ ...colunaPresa, background: "#F8FAFC", textAlign: "left", padding: "8px 10px", color: "#475569", fontWeight: 700 }}>Forma de pagamento</th>
                  {colunas.map((c) => (
                    <th key={c} scope="col" style={{ padding: "8px 6px", color: "#1E293B", fontWeight: 800, textAlign: "center", whiteSpace: "nowrap" }}>
                      {c === "loja" ? (
                        <>
                          Vendas da loja
                          <span style={{ display: "block", fontSize: "0.66rem", fontWeight: 500, color: "#64748B", whiteSpace: "normal" }}>balcão, mesa, site, robô, totem</span>
                        </>
                      ) : (
                        nomeDaIntegracao(c)
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ORDEM_DAS_FORMAS.map((forma) => (
                  <tr key={forma} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <th scope="row" style={{ ...colunaPresa, background: "#fff", textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#334155" }}>
                      {DETALHE_DA_FORMA[forma].rotulo}
                      <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 400, color: "#64748B" }}>{DETALHE_DA_FORMA[forma].detalhe}</span>
                    </th>
                    {colunas.map((c) => {
                      const lista = c === "loja" ? rascunho.loja : rascunho.integracoes[c] ?? [];
                      const nomeDaColuna = c === "loja" ? "vendas da loja" : nomeDaIntegracao(c);
                      return (
                        <td key={c} style={{ textAlign: "center", padding: "6px" }}>
                          <input
                            type="checkbox"
                            checked={lista.includes(forma)}
                            disabled={!podeMudar}
                            onChange={() => alternar(c, forma)}
                            aria-label={`${DETALHE_DA_FORMA[forma].rotulo.replace(/^\S+\s/, "")} — ${nomeDaColuna}`}
                            style={{ width: 18, height: 18, accentColor: "#1C1917", cursor: podeMudar ? "pointer" : "not-allowed" }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(integracoesEscondidas > 0 || mostrarTodas) && (
            <button
              type="button"
              onClick={() => setMostrarTodas((v) => !v)}
              style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: "#1D4ED8", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
            >
              {mostrarTodas ? "Mostrar só as integrações que a loja usa" : `Mostrar as outras integrações (${integracoesEscondidas})`}
            </button>
          )}
          {integracoes.length > 0 && integracoes.some((c) => !mesmaLista(rascunho.integracoes[c] ?? [], rascunho.loja)) && (
            <p style={{ ...ajuda, marginTop: 6 }}>As colunas das integrações estão diferentes das vendas da loja — é de propósito? O resumo abaixo diz como fica.</p>
          )}

          {/* ── 2. Quando ── */}
          <span style={titulo}>2. Em que momento a nota sai?</span>
          <div role="radiogroup" aria-label="Momento da emissão">
            {MOMENTOS_DA_EMISSAO.map((m) => (
              <label key={m.valor} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8, cursor: podeMudar ? "pointer" : "not-allowed", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                <input
                  type="radio"
                  name="fiscal-momento-da-emissao"
                  checked={rascunho.momento === m.valor}
                  disabled={!podeMudar}
                  onChange={() => { setMensagem(null); setRascunho((r) => ({ ...r, momento: m.valor })); }}
                  style={{ accentColor: "#1C1917", marginTop: 3 }}
                />
                <span>{m.nome}<span style={ajuda}>{m.explicacao}</span></span>
              </label>
            ))}
          </div>
          <p style={{ ...ajuda, marginTop: 8 }}>Mesa: sempre uma nota por CONTA, no fechamento — as rodadas não têm nota própria.</p>

          {/* ── 3. O CPF ── */}
          <span style={titulo}>3. O CPF/CNPJ do cliente</span>
          <p style={ajuda}>
            O site, o robô, o balcão e o totem perguntam <strong>“CPF ou CNPJ na nota?”</strong>. No balcão, na retirada e na mesa ele é
            opcional — a nota sai sem. Na <strong>entrega</strong>, a SEFAZ só aceita a nota com o CPF/CNPJ e o endereço de quem recebe.
          </p>
          <div role="radiogroup" aria-label="CPF na entrega">
            {(
              [
                {
                  valor: "opcional" as const,
                  nome: "Pedir, sem obrigar (recomendado para começar)",
                  explicacao:
                    "O cliente pode pular. A entrega sem CPF fica sem nota, em “Falta CPF” — se ele pedir depois, você emite pelo pedido.",
                },
                {
                  valor: "obrigatorio" as const,
                  nome: "Obrigatório na entrega",
                  explicacao:
                    "O site, o robô e o balcão só fecham o pedido de entrega com o CPF/CNPJ (nas formas com nota automática). Toda entrega sai com nota — e todo cliente de entrega precisa informar o documento.",
                },
              ]
            ).map((o) => (
              <label key={o.valor} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 8, cursor: podeMudar ? "pointer" : "not-allowed", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                <input
                  type="radio"
                  name="fiscal-cpf-na-entrega"
                  checked={rascunho.cpfNaEntrega === o.valor}
                  disabled={!podeMudar}
                  onChange={() => { setMensagem(null); setRascunho((r) => ({ ...r, cpfNaEntrega: o.valor })); }}
                  style={{ accentColor: "#1C1917", marginTop: 3 }}
                />
                <span>{o.nome}<span style={ajuda}>{o.explicacao}</span></span>
              </label>
            ))}
          </div>
          <p style={{ ...ajuda, marginTop: 8 }}>
            Pedidos do iFood, 99Food e das outras integrações chegam com o CPF só quando o cliente pôs no app — o FireHub não tem como perguntar.
          </p>
        </>
      )}

      {/* ── Como vai ficar ── */}
      <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: 10, background: "#F0FDFA", border: "1px solid #99F6E4" }} aria-live="polite">
        <strong style={{ fontSize: "0.82rem", color: "#134E4A" }}>{mudou ? "Como vai ficar (ainda não salvo)" : "Como está"}</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
          {comoFica.map((linha) => (
            <li key={linha} style={{ fontSize: "0.78rem", color: "#134E4A", lineHeight: 1.45 }}>{linha}</li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
        <button
          type="button"
          onClick={salvar}
          disabled={!podeMudar || !mudou || salvando}
          style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: podeMudar && mudou ? "#1C1917" : "#CBD5E1", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: podeMudar && mudou && !salvando ? "pointer" : "not-allowed" }}
        >
          {salvando ? "Salvando…" : "Salvar como a nota é emitida"}
        </button>
        {mudou && (
          <button
            type="button"
            onClick={() => { setRascunho(gravado); setMensagem(null); }}
            style={{ padding: "9px 14px", borderRadius: 8, border: "1.5px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
          >
            Desfazer
          </button>
        )}
        {mensagem && (
          <span role="status" style={{ fontSize: "0.78rem", fontWeight: 700, color: mensagem.ok ? "#0F766E" : "#B71C1C" }}>{mensagem.texto}</span>
        )}
      </div>
    </div>
  );
}
