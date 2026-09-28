"use client";
/**
 * Integrações → Asaas: "Pix e cartão pelo site".
 *
 * A loja conecta a PRÓPRIA conta Asaas colando a chave de API. Antes de
 * conectar, a tela mostra — sem rolar para achar — quanto custa, quando o
 * dinheiro chega, o que conferir no Asaas e as regras. O texto das regras mora
 * em lib/pix-online.ts, o mesmo que o servidor cumpre e que vai no WhatsApp.
 *
 * A chave nunca volta do servidor: depois de conectada, a tela só sabe que
 * existe (e o que ela abre).
 */
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Zap, Eye, EyeOff, RefreshCw, Unplug, CreditCard } from "lucide-react";
import {
  CONFERIR_NO_ASAAS,
  REGRAS_DO_PIX_ONLINE,
  SPLIT_FIREHUB_PERCENTUAL,
  TARIFA_ASAAS_PIX,
  TARIFA_ASAAS_PIX_PROMOCIONAL,
  TEXTO_TARIFA_CARTAO,
  liquidoDaLoja,
  reais,
  splitDoFireHub,
  tarifaDoAsaas,
  type FormaOnline,
} from "@/lib/pix-online";
import PassosNoAsaas, { Passo } from "@/components/customer/PassoAPassoAsaas";

export type EstadoPagamentoOnline = {
  conectado: boolean;
  ativo: boolean;
  pixAtivo: boolean;
  cartaoAtivo: boolean;
  /** A conta conectada é a mesma que recebe pelo FireHub: sem split. */
  mesmaContaDoFireHub?: boolean;
  podeEditar: boolean;
  splitPercentual: number;
  avisosNoWhatsApp: boolean;
  conta: null | {
    nome: string;
    documento: string | null;
    ambiente: "producao" | "sandbox";
    situacao: string;
    pendenciasDoCadastro: string[];
    chavePix: string | null;
    avisosDePagamento: boolean;
    conectadoEm: string | null;
    regrasAceitasEm: string | null;
    verificadoEm: string | null;
    desligadoMotivo: string | null;
  };
  ultimos30Dias: null | { pedidos: number; total: number };
};
/** Nome antigo. */
export type EstadoPixOnline = EstadoPagamentoOnline;

type Retorno = EstadoPagamentoOnline & { error?: string; aviso?: string | null; falta?: string[]; ligadoAgora?: boolean; chavePixCriada?: boolean };

const cor = {
  texto: "#0F172A",
  suave: "#64748B",
  borda: "#E2E8F0",
  verde: "#16A34A",
  verdeFundo: "#F0FDF4",
  ambar: "#B45309",
  ambarFundo: "#FFFBEB",
  vermelho: "#DC2626",
  vermelhoFundo: "#FEF2F2",
  azul: "#1D4ED8",
  azulFundo: "#EFF6FF",
};

const dataCurta = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

function mascararChavePix(chave: string | null): string {
  if (!chave) return "";
  if (chave.length <= 12) return chave;
  return `${chave.slice(0, 6)}…${chave.slice(-4)}`;
}

function Item({ ok, alerta, titulo, texto }: { ok?: boolean; alerta?: boolean; titulo: string; texto?: string }) {
  const Icone = ok ? CheckCircle2 : alerta ? AlertTriangle : XCircle;
  const c = ok ? cor.verde : alerta ? cor.ambar : cor.vermelho;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0" }}>
      <Icone size={17} color={c} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: "0.82rem", lineHeight: 1.45 }}>
        <strong style={{ color: cor.texto }}>{titulo}</strong>
        {texto && <div style={{ color: cor.suave }}>{texto}</div>}
      </div>
    </div>
  );
}

function Bloco({ titulo, children, fundo = "#fff" }: { titulo: string; children: React.ReactNode; fundo?: string }) {
  return (
    <div style={{ background: fundo, border: `1px solid ${cor.borda}`, borderRadius: 12, padding: "0.9rem 1rem", marginBottom: "0.85rem" }}>
      <div style={{ fontWeight: 800, fontSize: "0.86rem", color: cor.texto, marginBottom: 8 }}>{titulo}</div>
      {children}
    </div>
  );
}

/** Uma linha de exemplo: "Pedido de R$ 50" → Pix e cartão, quanto a loja recebe. */
function TabelaDeCustos() {
  const exemplos = [30, 50, 100];
  const linha = (v: number, forma: FormaOnline) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.76rem", color: cor.suave }}>
      <span>
        {forma === "pix" ? "Pix" : "Cartão"}: − {reais(tarifaDoAsaas(v, forma))} Asaas · − {reais(splitDoFireHub(v, forma))} taxa online
      </span>
      <strong style={{ color: cor.verde, whiteSpace: "nowrap" }}>{reais(liquidoDaLoja(v, forma))}</strong>
    </div>
  );
  // Linhas, não tabela: no celular a coluna "você recebe" — a que importa —
  // ficava escondida atrás da rolagem lateral.
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "0.7rem", color: cor.suave, marginBottom: 2 }}>você recebe</div>
      {exemplos.map((v) => (
        <div key={v} style={{ padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: "0.84rem", fontWeight: 700, color: cor.texto, marginBottom: 2 }}>Pedido de {reais(v)}</div>
          {linha(v, "pix")}
          {linha(v, "cartao")}
        </div>
      ))}
      <p style={{ fontSize: "0.74rem", color: cor.suave, margin: "6px 0 0", lineHeight: 1.5 }}>
        Tarifa do Asaas: {reais(TARIFA_ASAAS_PIX)} por Pix e {TEXTO_TARIFA_CARTAO} por cartão (nos 3 primeiros meses da sua conta Asaas, o Pix
        sai por {reais(TARIFA_ASAAS_PIX_PROMOCIONAL)}). Taxa do pagamento online: {SPLIT_FIREHUB_PERCENTUAL}% da venda paga pelo site.
        Sem mensalidade no Asaas. Pedido pago na entrega não tem taxa nenhuma.
      </p>
    </div>
  );
}

export default function PagamentoOnlineAsaas({ estadoInicial }: { estadoInicial?: EstadoPagamentoOnline }) {
  const [estado, setEstado] = useState<EstadoPagamentoOnline | null>(estadoInicial ?? null);
  const [carregando, setCarregando] = useState(!estadoInicial);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [verChave, setVerChave] = useState(false);
  const [aceitou, setAceitou] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro" | "aviso"; texto: string; itens?: string[] } | null>(null);
  const [verRegras, setVerRegras] = useState(false);

  useEffect(() => {
    if (estadoInicial) return;
    fetch("/api/store/asaas")
      .then((r) => r.json())
      .then((d) => setEstado(d))
      .catch(() => setMensagem({ tipo: "erro", texto: "Não foi possível carregar o pagamento pelo site." }))
      .finally(() => setCarregando(false));
  }, [estadoInicial]);

  async function chamar(acao: string, init: RequestInit, sucesso?: (d: Retorno) => void) {
    setEnviando(acao);
    setMensagem(null);
    try {
      const r = await fetch("/api/store/asaas", init);
      const d: Retorno = await r.json().catch(() => ({} as Retorno));
      if (d && typeof d.conectado === "boolean") setEstado(d);
      if (!r.ok) {
        setMensagem({ tipo: "erro", texto: d?.error || "Não deu certo. Tente de novo.", itens: d?.falta?.length ? d.falta : undefined });
        return;
      }
      sucesso?.(d);
      if (d?.aviso) setMensagem((m) => m ?? { tipo: "aviso", texto: d.aviso! });
    } catch {
      setMensagem({ tipo: "erro", texto: "Sem conexão com o servidor. Tente de novo." });
    } finally {
      setEnviando(null);
    }
  }

  const post = (corpo: object): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

  const conectar = () =>
    chamar("conectar", post({ acao: "conectar", chave, aceitouRegras: aceitou }), (d) => {
      setChave("");
      if (d.ligadoAgora) {
        const quais = [d.pixAtivo && "Pix", d.cartaoAtivo && "cartão"].filter(Boolean).join(" e ");
        setMensagem({
          tipo: d.falta?.length ? "aviso" : "ok",
          texto:
            `Conta conectada e ${quais} pelo site ligado no cardápio.` +
            (d.chavePixCriada ? " Criamos uma chave Pix aleatória na sua conta Asaas." : "") +
            (d.avisosNoWhatsApp ? " Mandamos o resumo das regras no seu WhatsApp." : ""),
          itens: d.falta?.length ? d.falta : undefined,
        });
      } else {
        setMensagem({ tipo: "aviso", texto: "Conta conectada, mas o pagamento pelo site ainda não pode ir ao cardápio:", itens: d.falta });
      }
    });

  const nomeDa = (forma: FormaOnline) => (forma === "pix" ? "Pix" : "Cartão");
  const ativar = (forma: FormaOnline) =>
    chamar(`ativar-${forma}`, post({ acao: "ativar", forma }), () =>
      setMensagem({ tipo: "ok", texto: `${nomeDa(forma)} pelo site ligado. Ele já aparece no cardápio.` }),
    );
  const desativar = (forma: FormaOnline) =>
    chamar(`desativar-${forma}`, post({ acao: "desativar", forma }), () =>
      setMensagem({ tipo: "ok", texto: `${nomeDa(forma)} pelo site desligado. O cardápio continua com o pagamento na entrega.` }),
    );
  const verificar = () =>
    chamar("verificar", post({ acao: "verificar" }), () => setMensagem({ tipo: "ok", texto: "Conta conferida no Asaas agora." }));

  const desconectar = () => {
    if (
      !window.confirm(
        "Desconectar a conta Asaas?\n\n• Pix e cartão pelo site saem do cardápio agora.\n• Pedidos esperando pagamento são cancelados.\n• Pedidos já pagos continuam normais.\n\nDepois, exclua a chave no Asaas (Integrações → Chaves de API).",
      )
    )
      return;
    chamar("desconectar", { method: "DELETE" }, (d) => setMensagem({ tipo: "ok", texto: d.aviso || "Conta desconectada." }));
  };

  const botao = (principal: boolean, desabilitado = false): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 14px",
    borderRadius: 10,
    border: principal ? "none" : `1.5px solid ${cor.borda}`,
    background: desabilitado ? "#E2E8F0" : principal ? "#059669" : "#fff",
    color: desabilitado ? "#94A3B8" : principal ? "#fff" : cor.texto,
    fontWeight: 700,
    fontSize: "0.82rem",
    cursor: desabilitado ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  });

  if (carregando) {
    return <div style={{ padding: "1rem", fontSize: "0.85rem", color: cor.suave }}>Carregando o pagamento pelo site…</div>;
  }

  const e = estado;
  const conta = e?.conta;
  const pill = e?.ativo
    ? { t: "Ligado no cardápio", bg: "#DCFCE7", c: "#166534" }
    : e?.conectado
      ? { t: "Conectado · desligado", bg: "#FEF3C7", c: "#92400E" }
      : { t: "Não conectado", bg: "#F1F5F9", c: "#475569" };

  const LinhaDaForma = ({ forma, ativo }: { forma: FormaOnline; ativo: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.82rem", lineHeight: 1.45 }}>
        {forma === "pix" ? <Zap size={17} color="#047857" style={{ marginTop: 1 }} /> : <CreditCard size={17} color="#1D4ED8" style={{ marginTop: 1 }} />}
        <div>
          <strong style={{ color: cor.texto }}>{forma === "pix" ? "Pix pelo site" : "Cartão pelo site"}</strong>{" "}
          <span style={{ color: ativo ? cor.verde : cor.suave, fontWeight: 700 }}>{ativo ? "· ligado" : "· desligado"}</span>
          <div style={{ color: cor.suave, fontSize: "0.76rem" }}>
            {forma === "pix" ? "Cai na sua conta Asaas na hora." : "Cliente paga na página segura do Asaas; o dinheiro cai em até 2 dias úteis."}
          </div>
        </div>
      </div>
      {e?.podeEditar &&
        (ativo ? (
          <button type="button" onClick={() => desativar(forma)} disabled={!!enviando} style={botao(false, !!enviando)}>
            {enviando === `desativar-${forma}` ? "Desligando…" : "Desligar"}
          </button>
        ) : (
          <button type="button" onClick={() => ativar(forma)} disabled={!!enviando} style={botao(true, !!enviando)}>
            {enviando === `ativar-${forma}` ? "Ligando…" : "Ligar"}
          </button>
        ))}
    </div>
  );

  return (
    <div style={{ background: "#F8FAFC", border: `1px solid ${cor.borda}`, borderRadius: 16, padding: "1.1rem", marginBottom: "1.5rem" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: "0.9rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#D1FAE5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Zap size={19} color="#047857" />
          </div>
          <div>
            <h4 style={{ fontWeight: 800, fontSize: "0.98rem", margin: 0, color: cor.texto }}>Pix e cartão pelo site (Asaas)</h4>
            <p style={{ fontSize: "0.8rem", color: cor.suave, margin: "2px 0 0", lineHeight: 1.45, maxWidth: 560 }}>
              O cliente paga na hora, no cardápio. O dinheiro cai na <strong>sua</strong> conta Asaas e o pedido só vai para a cozinha depois de
              pago.
            </p>
          </div>
        </div>
        <span style={{ padding: "4px 10px", borderRadius: 99, background: pill.bg, color: pill.c, fontSize: "0.74rem", fontWeight: 800, whiteSpace: "nowrap" }}>
          {pill.t}
        </span>
      </div>

      {/* Resultado da última ação */}
      {mensagem && (
        <div
          style={{
            background: mensagem.tipo === "ok" ? cor.verdeFundo : mensagem.tipo === "aviso" ? cor.ambarFundo : cor.vermelhoFundo,
            border: `1px solid ${mensagem.tipo === "ok" ? "#BBF7D0" : mensagem.tipo === "aviso" ? "#FDE68A" : "#FECACA"}`,
            color: mensagem.tipo === "ok" ? "#166534" : mensagem.tipo === "aviso" ? "#92400E" : "#991B1B",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: "0.82rem",
            lineHeight: 1.5,
            marginBottom: "0.85rem",
            fontWeight: 600,
          }}
        >
          {mensagem.texto}
          {mensagem.itens && (
            <ul style={{ margin: "4px 0 0", paddingLeft: "1.1rem", fontWeight: 500 }}>
              {mensagem.itens.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── CONECTADO ── */}
      {e?.conectado && conta && (
        <>
          <Bloco titulo="Sua conta Asaas">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <div style={{ fontSize: "0.86rem", color: cor.texto }}>
                <strong>{conta.nome}</strong>
                {conta.documento && <span style={{ color: cor.suave }}> · {conta.documento}</span>}
              </div>
              {conta.ambiente === "sandbox" && (
                <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#7C2D12", background: "#FFEDD5", padding: "2px 8px", borderRadius: 99 }}>
                  CONTA DE TESTE (Sandbox)
                </span>
              )}
            </div>
            <Item
              ok={conta.situacao === "APPROVED"}
              alerta={conta.situacao !== "APPROVED"}
              titulo={conta.situacao === "APPROVED" ? "Conta aprovada no Asaas" : "Conta ainda não aprovada no Asaas"}
              texto={
                conta.situacao === "APPROVED"
                  ? undefined
                  : conta.pendenciasDoCadastro.length
                    ? conta.pendenciasDoCadastro.join(" · ")
                    : "Termine o cadastro e envie os documentos no Asaas. Sem aprovação, o Asaas não deixa receber."
              }
            />
            <Item
              ok={Boolean(conta.chavePix)}
              titulo={conta.chavePix ? `Chave Pix ativa (${mascararChavePix(conta.chavePix)})` : "Nenhuma chave Pix ativa"}
              texto={conta.chavePix ? undefined : "O Pix precisa de uma chave. Cadastre em Pix → Minhas chaves no Asaas e clique em “Conferir de novo”."}
            />
            <Item
              ok={conta.avisosDePagamento}
              alerta={!conta.avisosDePagamento}
              titulo={conta.avisosDePagamento ? "Aviso automático de pagamento ligado" : "Aviso automático de pagamento não ligado"}
              texto={
                conta.avisosDePagamento
                  ? "O Asaas avisa o FireHub no segundo em que o pagamento cai."
                  : "Funciona assim mesmo: o FireHub confere pela tela do cliente e a cada 2 minutos."
              }
            />
            {e.mesmaContaDoFireHub ? (
              <Item ok titulo="Esta é a conta que recebe pelo FireHub" texto="Sem taxa do pagamento online nesta loja: o Asaas não divide com a própria conta." />
            ) : (
              <Item ok titulo={`Taxa do pagamento online: ${e.splitPercentual}%`} texto="Separada automaticamente em cada venda paga pelo site." />
            )}
            {conta.verificadoEm && (
              <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 4 }}>
                Conferida no Asaas em {new Date(conta.verificadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </Bloco>

          {conta.desligadoMotivo && !e.ativo && (
            <div style={{ background: cor.vermelhoFundo, border: "1px solid #FECACA", color: "#991B1B", borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
              <strong>Por que está desligado:</strong> {conta.desligadoMotivo}
            </div>
          )}

          <Bloco titulo="No cardápio" fundo={e.ativo ? cor.verdeFundo : "#fff"}>
            <LinhaDaForma forma="pix" ativo={e.pixAtivo} />
            <LinhaDaForma forma="cartao" ativo={e.cartaoAtivo} />
            {e.ultimos30Dias && e.ultimos30Dias.pedidos > 0 && (
              <div style={{ color: cor.suave, fontSize: "0.78rem", marginTop: 8 }}>
                Últimos 30 dias: {e.ultimos30Dias.pedidos} pedido(s) pagos pelo site · {reais(e.ultimos30Dias.total)}
              </div>
            )}
          </Bloco>

          {!e.avisosNoWhatsApp && (
            <div style={{ background: cor.azulFundo, border: "1px solid #BFDBFE", color: "#1E40AF", borderRadius: 10, padding: "10px 12px", fontSize: "0.8rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
              📲 Cadastre o <strong>WhatsApp do Proprietário</strong> (Minha Loja → Informações) para receber os avisos de estorno pendente e de
              chave do Asaas desativada.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "0.6rem" }}>
            {e.podeEditar && (
              <button type="button" onClick={verificar} disabled={!!enviando} style={botao(false, !!enviando)}>
                <RefreshCw size={14} /> {enviando === "verificar" ? "Conferindo…" : "Conferir de novo"}
              </button>
            )}
            <button type="button" onClick={() => setVerRegras((v) => !v)} style={botao(false)}>
              {verRegras ? "Esconder as regras" : "Ver as regras"}
            </button>
            {e.podeEditar && (
              <button type="button" onClick={desconectar} disabled={!!enviando} style={{ ...botao(false, !!enviando), color: enviando ? "#94A3B8" : cor.vermelho }}>
                <Unplug size={14} /> {enviando === "desconectar" ? "Desconectando…" : "Desconectar"}
              </button>
            )}
          </div>
          {conta.regrasAceitasEm && (
            <div style={{ fontSize: "0.72rem", color: "#94A3B8" }}>Regras aceitas em {dataCurta(conta.regrasAceitasEm)}.</div>
          )}
          {verRegras && (
            <div style={{ marginTop: "0.75rem" }}>
              <ListaDeRegras />
            </div>
          )}
        </>
      )}

      {/* ── NÃO CONECTADO ──
          Passo a passo com imagem e quase nada para ler (dono, 28/09/2026: "as
          pessoas não gostam de ler"). Valores, prazos e regras continuam aqui,
          recolhidos em "Ver valores, prazos e regras" — e o aceite continua
          obrigatório: é o dinheiro da loja. */}
      {e && !e.conectado && (
        <>
          {/* O resumo em três selos: o que o lojista quer saber antes de tudo. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.85rem" }}>
            {[
              { t: "⚡ Pix cai na hora", bg: "#ECFDF5", c: "#065F46" },
              { t: "💳 Cartão em até 2 dias úteis", bg: "#EFF6FF", c: "#1E40AF" },
              { t: `Taxa: ${SPLIT_FIREHUB_PERCENTUAL}% + tarifa do Asaas`, bg: "#F8FAFC", c: "#334155" },
            ].map((s) => (
              <span key={s.t} style={{ background: s.bg, color: s.c, fontWeight: 800, fontSize: "0.76rem", padding: "5px 10px", borderRadius: 99, border: "1px solid #E2E8F0" }}>
                {s.t}
              </span>
            ))}
          </div>

          <div style={{ background: "#fff", border: `1px solid ${cor.borda}`, borderRadius: 12, padding: "0.4rem 1rem 0.9rem", marginBottom: "0.85rem" }}>
            <PassosNoAsaas />
            <Passo n={4} titulo="Cole a chave aqui e conecte">
              {e.podeEditar ? (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                    <input
                      type={verChave ? "text" : "password"}
                      value={chave}
                      onChange={(ev) => setChave(ev.target.value)}
                      placeholder="Cole aqui: $aact_prod_..."
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Chave de API do Asaas"
                      style={{ flex: 1, minWidth: 0, padding: "11px 12px", borderRadius: 10, border: "2px solid #0030B9", fontSize: "0.9rem", fontFamily: "monospace", outline: "none" }}
                    />
                    <button type="button" onClick={() => setVerChave((v) => !v)} aria-label={verChave ? "Esconder a chave" : "Mostrar a chave"} style={{ ...botao(false), padding: "9px 10px" }}>
                      {verChave ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.84rem", color: cor.texto, cursor: "pointer", marginBottom: 10, lineHeight: 1.45 }}>
                    <input type="checkbox" checked={aceitou} onChange={(ev) => setAceitou(ev.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0 }} />
                    <span>
                      Aceito as regras e a taxa de {SPLIT_FIREHUB_PERCENTUAL}% por venda paga pelo site.{" "}
                      <button type="button" onClick={() => setVerRegras(true)} style={{ background: "none", border: "none", padding: 0, color: cor.azul, fontWeight: 700, cursor: "pointer", fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" }}>
                        Ver regras
                      </button>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={conectar}
                    disabled={!aceitou || !chave.trim() || !!enviando}
                    style={{ ...botao(true, !aceitou || !chave.trim() || !!enviando), padding: "11px 18px", fontSize: "0.9rem" }}
                  >
                    <Zap size={15} /> {enviando === "conectar" ? "Conferindo a conta no Asaas…" : "Conectar conta Asaas"}
                  </button>
                  <div style={{ fontSize: "0.74rem", color: cor.suave, marginTop: 8, lineHeight: 1.45 }}>
                    🔒 A chave fica guardada criptografada. Tudo certo na conta, Pix e cartão já entram no cardápio.
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "0.82rem", color: cor.suave }}>Só o titular da loja pode conectar a conta Asaas.</div>
              )}
            </Passo>
          </div>

          {!e.avisosNoWhatsApp && (
            <div style={{ background: cor.azulFundo, border: "1px solid #BFDBFE", color: "#1E40AF", borderRadius: 10, padding: "10px 12px", fontSize: "0.8rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
              📲 Cadastre o <strong>WhatsApp do Proprietário</strong> (Minha Loja → Informações) para receber os avisos no WhatsApp.
            </div>
          )}

          {/* Tudo o que é para LER fica aqui, recolhido. */}
          <button
            type="button"
            onClick={() => setVerRegras((v) => !v)}
            style={{ ...botao(false), width: "100%", justifyContent: "center" }}
            aria-expanded={verRegras}
          >
            {verRegras ? "Esconder valores, prazos e regras" : "Ver valores, prazos e regras"}
          </button>
          {verRegras && (
            <div style={{ marginTop: "0.85rem" }}>
              <Bloco titulo="💰 Quanto custa">
                <TabelaDeCustos />
              </Bloco>
              <Bloco titulo="⏱️ Quando o dinheiro chega">
                <p style={{ fontSize: "0.82rem", color: cor.texto, margin: 0, lineHeight: 1.55 }}>
                  <strong>Pix: na hora.</strong> <strong>Cartão de crédito à vista: em até 2 dias úteis.</strong> Para levar ao seu banco, faça um Pix de
                  saída no app do Asaas (imediato; conta PJ tem 30 grátis por mês, depois R$ 2,00 cada).
                </p>
              </Bloco>
              <Bloco titulo="✅ Se a conexão der erro, confira no Asaas">
                <ol style={{ margin: 0, paddingLeft: "1.15rem" }}>
                  {CONFERIR_NO_ASAAS.map((c) => (
                    <li key={c.titulo} style={{ fontSize: "0.82rem", marginBottom: 6, lineHeight: 1.5 }}>
                      <strong style={{ color: cor.texto }}>{c.titulo}.</strong> <span style={{ color: "#475569" }}>{c.texto}</span>
                    </li>
                  ))}
                </ol>
              </Bloco>
              <Bloco titulo="📋 Regras do pagamento pelo site">
                <ListaDeRegras />
              </Bloco>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ListaDeRegras() {
  return (
    <ol style={{ margin: 0, paddingLeft: "1.15rem" }}>
      {REGRAS_DO_PIX_ONLINE.map((r) => (
        <li key={r.titulo} style={{ fontSize: "0.82rem", marginBottom: 8, lineHeight: 1.5 }}>
          <strong style={{ color: cor.texto }}>{r.titulo}.</strong> <span style={{ color: "#475569" }}>{r.texto}</span>
        </li>
      ))}
    </ol>
  );
}
