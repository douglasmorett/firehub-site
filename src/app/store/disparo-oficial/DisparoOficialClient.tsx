"use client";

/**
 * Disparo oficial — promoção pelo WhatsApp da loja, pela API oficial da Meta
 * (lib/disparo-oficial). O número continua no celular e o robô continua
 * respondendo; só a promoção sai pela API, com crédito pré-pago.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Coins, Megaphone, MessageSquareText, RefreshCw, Send, ShieldCheck, Smartphone, Users } from "lucide-react";

type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

const reais = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (n: number) => (n || 0).toLocaleString("pt-BR");
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

const cartao: React.CSSProperties = { background: "#fff", padding: "1.25rem", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" };
const titulo: React.CSSProperties = { margin: "0 0 4px", fontWeight: 800, fontSize: "1.05rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 };
const sub: React.CSSProperties = { margin: "0 0 14px", fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 };
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#334155", marginBottom: 6 };
const campo: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box", outline: "none" };
const botao = (cor = "#0F766E", ativo = true): React.CSSProperties => ({
  padding: "10px 16px", borderRadius: 10, border: "none", background: ativo ? cor : "#E2E8F0", color: ativo ? "#fff" : "#94A3B8",
  fontWeight: 800, fontSize: "0.85rem", cursor: ativo ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 8,
});
const botaoLeve: React.CSSProperties = { padding: "8px 12px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" };

const SELO_DO_MODELO: Record<string, { texto: string; cor: string; fundo: string }> = {
  APROVADO: { texto: "Aprovada", cor: "#047857", fundo: "#D1FAE5" },
  PENDENTE: { texto: "Em análise na Meta", cor: "#B45309", fundo: "#FEF3C7" },
  REJEITADO: { texto: "Recusada", cor: "#B91C1C", fundo: "#FEE2E2" },
  PAUSADO: { texto: "Pausada pela Meta", cor: "#B45309", fundo: "#FEF3C7" },
};
const SELO_DA_CAMPANHA: Record<string, { texto: string; cor: string }> = {
  ENVIANDO: { texto: "Enviando", cor: "#2563EB" },
  CONCLUIDA: { texto: "Concluída", cor: "#047857" },
  CANCELADA: { texto: "Cancelada", cor: "#B91C1C" },
};
const QUALIDADE: Record<string, string> = { GREEN: "🟢 Alta", YELLOW: "🟡 Média", RED: "🔴 Baixa", UNKNOWN: "—" };

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

/** Carrega o SDK do Facebook uma vez (o cadastro incorporado roda nele). */
function carregarSdk(appId: string, versao: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao });
      resolve(window.FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Não consegui abrir o Facebook. Confira se o navegador não bloqueia."));
    document.body.appendChild(s);
  });
}

export default function DisparoOficialClient() {
  const [dados, setDados] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Conexão
  const [entendiQr, setEntendiQr] = useState(false);
  const sessaoDoCadastro = useRef<{ wabaId?: string; phoneNumberId?: string; businessId?: string }>({});

  // Recarga
  const [qtd, setQtd] = useState(500);
  const [pix, setPix] = useState<any>(null);

  // Modelo
  const [mTitulo, setMTitulo] = useState("");
  const [mTexto, setMTexto] = useState("Oi {nome}! 🍕 Hoje tem promoção especial aqui na loja. Peça já pelo nosso cardápio e aproveite!");
  const [mBotao, setMBotao] = useState(true);

  // Campanha
  const [modeloId, setModeloId] = useState("");
  const [publicoTipo, setPublicoTipo] = useState<"TODOS" | "SUMIDOS" | "RECENTES" | "TESTE">("TESTE");
  const [telefoneTeste, setTelefoneTeste] = useState("");
  const [dias, setDias] = useState(30);
  const [quantidade, setQuantidade] = useState<number | null>(null);
  const [aceite, setAceite] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [falhas, setFalhas] = useState<{ campanhaId: string; lista: any[] } | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const r = await fetch("/api/store/disparo-oficial", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não consegui carregar.");
      setDados(d);
    } catch (e: any) {
      if (!silencioso) setAviso({ tipo: "erro", titulo: "Não consegui carregar", detalhe: e?.message });
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const enviando = useMemo(() => (dados?.campanhas || []).some((c: any) => c.status === "ENVIANDO"), [dados]);
  const pixAberto = Boolean(pix && pix.status !== "PAGA");
  useEffect(() => {
    if (!enviando && !pixAberto) return;
    const t = setInterval(() => carregar(true), 10000);
    return () => clearInterval(t);
  }, [enviando, pixAberto, carregar]);

  // O Pix pago fecha sozinho.
  useEffect(() => {
    if (!pix?.id || !dados?.recargas) return;
    const r = dados.recargas.find((x: any) => x.id === pix.id);
    if (r?.status === "PAGA") {
      setPix(null);
      setAviso({ tipo: "ok", titulo: "Pix recebido!", detalhe: `${inteiro(r.disparos)} disparos entraram no seu saldo.` });
    }
  }, [dados, pix]);

  // Contagem do público ao trocar o filtro (não a cada recarga da tela).
  const temConexao = Boolean(dados?.liberada && dados?.conexao);
  useEffect(() => {
    if (!temConexao) return;
    let cancelado = false;
    setQuantidade(null);
    const t = setTimeout(async () => {
      const r = await fetch(`/api/store/disparo-oficial?publico=${publicoTipo}&dias=${dias}&telefone=${encodeURIComponent(telefoneTeste)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (!cancelado && r && typeof r.quantidade === "number") setQuantidade(r.quantidade);
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [publicoTipo, dias, telefoneTeste, temConexao]);

  const acao = async (nome: string, corpo: Record<string, unknown>) => {
    setOcupado(nome);
    try {
      const r = await fetch("/api/store/disparo-oficial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: nome, ...corpo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Não deu certo.");
      return d;
    } finally {
      setOcupado(null);
    }
  };

  // ── Conectar pelo cadastro incorporado da Meta ─────────────────────────────
  useEffect(() => {
    const ouvir = (ev: MessageEvent) => {
      let host = "";
      try {
        host = new URL(String(ev.origin || "")).hostname;
      } catch {
        return;
      }
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      try {
        const msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (msg?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(msg.event || "").startsWith("FINISH")) {
          sessaoDoCadastro.current = { wabaId: msg.data?.waba_id, phoneNumberId: msg.data?.phone_number_id, businessId: msg.data?.business_id };
        } else if (msg.event === "CANCEL" && msg.data?.error_message) {
          setAviso({ tipo: "erro", titulo: "A Meta recusou o cadastro", detalhe: String(msg.data.error_message) });
        }
      } catch {
        /* mensagem de outro tipo do Facebook */
      }
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  // O SDK carrega ANTES do clique: o FB.login tem de rodar no próprio clique,
  // senão o navegador bloqueia a janela do Facebook.
  const [sdkPronto, setSdkPronto] = useState(false);
  const cfgDoCadastro = dados?.cadastro as { appId: string; configId: string; versao: string } | null | undefined;
  useEffect(() => {
    if (!cfgDoCadastro?.appId) return;
    carregarSdk(cfgDoCadastro.appId, cfgDoCadastro.versao).then(
      () => setSdkPronto(true),
      (e) => setAviso({ tipo: "erro", titulo: "Não consegui abrir o Facebook", detalhe: e?.message })
    );
  }, [cfgDoCadastro?.appId, cfgDoCadastro?.versao]);

  const conectar = () => {
    const cfg = dados?.cadastro;
    if (!cfg || !window.FB) return;
    try {
      setOcupado("conectar");
      const FB = window.FB;
      sessaoDoCadastro.current = {};
      FB.login(
        (resposta: any) => {
          const codigo = resposta?.authResponse?.code;
          if (!codigo) {
            setOcupado(null);
            setAviso({ tipo: "atencao", titulo: "Cadastro não concluído", detalhe: "A janela do Facebook foi fechada antes do fim." });
            return;
          }
          // O evento com a conta pode chegar um instante depois do código; o
          // código vive 30 s, então espera no máximo 4 s.
          const inicio = Date.now();
          const tentar = async () => {
            const s = sessaoDoCadastro.current;
            if (!s.wabaId && Date.now() - inicio < 4000) return setTimeout(tentar, 250);
            try {
              const d = await acao("conectar", { codigo, wabaId: s.wabaId, phoneNumberId: s.phoneNumberId, businessId: s.businessId });
              setAviso({ tipo: "ok", titulo: "WhatsApp conectado à API oficial!", detalhe: `Número ${d.numero || ""}. Agora leia o QR do robô de novo em Chatbot IA.` });
              await carregar(true);
            } catch (e: any) {
              setAviso({ tipo: "erro", titulo: "Não consegui conectar", detalhe: e?.message });
            }
          };
          tentar();
        },
        {
          config_id: cfg.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
        }
      );
    } catch (e: any) {
      setOcupado(null);
      setAviso({ tipo: "erro", titulo: "Não consegui abrir o Facebook", detalhe: e?.message });
    }
  };

  if (carregando) return <div style={{ padding: "2rem", color: "#64748B" }}>Carregando…</div>;
  if (!dados) return <div style={{ padding: "2rem", color: "#64748B" }}>Não foi possível carregar o Disparo oficial.</div>;

  const preco: number = dados.preco || 0;
  const cabecalho = (
    <div style={{ marginBottom: "1.25rem" }}>
      <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, color: "#0F172A", display: "flex", alignItems: "center", gap: 10 }}>
        <Megaphone size={24} color="#0F766E" /> Disparo oficial
      </h1>
      <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.9rem", maxWidth: 760, lineHeight: 1.5 }}>
        Promoção no WhatsApp dos seus clientes pela <strong>API oficial da Meta</strong>, do número da sua loja. Sem o risco de banimento dos
        disparadores não oficiais: quem responde cai na conversa de sempre, com o seu robô atendendo.
      </p>
    </div>
  );

  if (!dados.liberada) {
    return (
      <div style={{ padding: "1.5rem", maxWidth: 900 }}>
        {cabecalho}
        <div style={cartao}>
          <p style={titulo}>
            <ShieldCheck size={18} color="#0F766E" /> Em breve na sua loja
          </p>
          <p style={{ ...sub, margin: 0 }}>
            Estamos liberando o Disparo oficial aos poucos. Cada mensagem entregue sai por {reais(preco)}, com crédito pré-pago por Pix — e só
            é cobrada a mensagem que chega no celular do cliente. Fale com o suporte do FireHub para entrar na lista.
          </p>
        </div>
      </div>
    );
  }

  const conexao = dados.conexao;
  const conectado = conexao?.status === "CONECTADO";
  const saldo = dados.saldo?.saldo || 0;
  const modelosAprovados = (dados.modelos || []).filter((m: any) => m.status === "APROVADO");
  const valorDaRecarga = Math.round(qtd * preco * 100) / 100;
  const modeloEscolhido = modelosAprovados.find((m: any) => m.id === modeloId);
  // "TIER_250", "TIER_2K", "TIER_100K", "TIER_UNLIMITED" (messaging_limit_tier da Meta).
  const limiteDoDia = (() => {
    const t = String(conexao?.limite || "").toUpperCase().match(/TIER_(\d+)(K?)/);
    return t ? Number(t[1]) * (t[2] ? 1000 : 1) : null;
  })();

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1100 }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      {cabecalho}

      {/* ── SALDO ───────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div style={{ ...cartao, background: "linear-gradient(135deg,#0F766E,#115E59)", color: "#fff", border: "none" }}>
          <div style={{ fontSize: "0.8rem", opacity: 0.85, fontWeight: 700 }}>Saldo</div>
          <div style={{ fontSize: "2rem", fontWeight: 900 }}>{inteiro(saldo)}</div>
          <div style={{ fontSize: "0.8rem", opacity: 0.85 }}>disparos · {reais(saldo * preco)}</div>
        </div>
        <div style={cartao}>
          <div style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 700 }}>Preço por mensagem entregue</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A" }}>{reais(preco)}</div>
          <div style={{ fontSize: "0.78rem", color: "#64748B" }}>Não entregou, o crédito volta sozinho.</div>
        </div>
        <div style={cartao}>
          <div style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 700 }}>Número</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 900, color: conectado ? "#047857" : "#B45309" }}>
            {conectado ? `✅ ${conexao.numero || "Conectado"}` : conexao?.status === "ERRO" ? "⚠️ Com problema" : "Não conectado"}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
            {conectado ? `Qualidade: ${QUALIDADE[conexao.qualidade] || conexao.qualidade || "—"}${conexao.limite ? ` · limite ${conexao.limite}` : ""}` : "Conecte abaixo"}
          </div>
        </div>
      </div>

      {/* ── 1. CONEXÃO ──────────────────────────────────────────────────── */}
      <div style={{ ...cartao, marginBottom: 16 }}>
        <p style={titulo}>
          <Smartphone size={18} color="#0F766E" /> 1. WhatsApp da loja na API oficial
        </p>
        {!conectado ? (
          <>
            {conexao?.erro && <p style={{ ...sub, color: "#B91C1C", fontWeight: 700 }}>⚠️ {conexao.erro}</p>}
            <p style={sub}>
              O número continua no celular, no <strong>WhatsApp Business</strong>, e o robô continua respondendo. A Meta só acrescenta a API
              oficial para a promoção sair por ela.
            </p>
            <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "#334155", fontSize: "0.85rem", lineHeight: 1.7 }}>
              <li>Precisa ser o app <strong>WhatsApp Business</strong> atualizado, no celular da loja, à mão para ler um código.</li>
              <li>
                Ao conectar, a Meta desliga os aparelhos conectados ao número (WhatsApp Web, o robô). <strong>Depois, leia o QR do robô de novo</strong>{" "}
                em <Link href="/store/chatbot" style={{ color: "#0F766E", fontWeight: 700 }}>Chatbot IA</Link>.
              </li>
              <li>Abra o WhatsApp Business no celular pelo menos a cada 13 dias, senão a Meta desliga a API.</li>
              <li>Lista de transmissão, grupos e ligações deixam de funcionar no celular — o disparo passa a ser por aqui.</li>
              <li>Número novo na API começa enviando para até 250 clientes por dia; a Meta aumenta conforme as mensagens são bem recebidas.</li>
            </ul>
            {dados.cadastro ? (
              <>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.85rem", color: "#334155", marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={entendiQr} onChange={(e) => setEntendiQr(e.target.checked)} style={{ marginTop: 3 }} />
                  Entendi: depois de conectar, vou ler o QR do robô de novo.
                </label>
                <button onClick={conectar} disabled={!entendiQr || !sdkPronto || ocupado === "conectar"} style={botao("#1877F2", entendiQr && sdkPronto && ocupado !== "conectar")}>
                  {ocupado === "conectar" ? "Conectando…" : sdkPronto ? "Conectar com o Facebook" : "Carregando o Facebook…"}
                </button>
                {ocupado === "conectar" && (
                  <button style={{ ...botaoLeve, marginLeft: 8 }} onClick={() => setOcupado(null)}>
                    Fechei a janela
                  </button>
                )}
              </>
            ) : (
              <p style={{ ...sub, color: "#B45309", fontWeight: 700, margin: 0 }}>
                A conexão com a Meta ainda não foi configurada no servidor do FireHub (falta o cadastro incorporado). Fale com o suporte.
              </p>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: "0.88rem", color: "#334155" }}>
              <strong>{conexao.nomeExibido || "Sua loja"}</strong> · {conexao.numero} · conectado em {dataHora(conexao.conectadoEm)}
            </span>
            <button
              style={botaoLeve}
              disabled={!!ocupado}
              onClick={async () => {
                try {
                  await acao("atualizar-numero", {});
                  await carregar(true);
                } catch (e: any) {
                  setAviso({ tipo: "erro", titulo: "Não consegui atualizar", detalhe: e?.message });
                }
              }}
            >
              <RefreshCw size={13} style={{ verticalAlign: -2 }} /> Atualizar qualidade
            </button>
            <button
              style={{ ...botaoLeve, color: "#B91C1C" }}
              disabled={!!ocupado}
              onClick={async () => {
                try {
                  await acao("desconectar", {});
                  setAviso({ tipo: "info", titulo: "Desconectado do FireHub", detalhe: "Para tirar o número da API na Meta, use o WhatsApp Business: Ferramentas comerciais > Aparelhos conectados." });
                  await carregar(true);
                } catch (e: any) {
                  setAviso({ tipo: "erro", titulo: "Não consegui desconectar", detalhe: e?.message });
                }
              }}
            >
              Desconectar
            </button>
          </div>
        )}
      </div>

      {/* ── 2. CRÉDITO ──────────────────────────────────────────────────── */}
      <div style={{ ...cartao, marginBottom: 16 }}>
        <p style={titulo}>
          <Coins size={18} color="#0F766E" /> 2. Crédito
        </p>
        <p style={sub}>
          Cada disparo é uma mensagem entregue no celular de um cliente: {reais(preco)}. Só desconta quando a Meta confirma a entrega — se não chegar, o
          crédito volta. Recarga mínima de {inteiro(dados.minimo)} disparos.
        </p>
        {!pix ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {[250, 500, 1000, 2000, 5000].map((n) => (
              <button key={n} onClick={() => setQtd(n)} style={{ ...botaoLeve, ...(qtd === n ? { borderColor: "#0F766E", color: "#0F766E", background: "#F0FDFA" } : {}) }}>
                {inteiro(n)}
              </button>
            ))}
            <input
              type="number"
              min={dados.minimo}
              value={qtd}
              onChange={(e) => setQtd(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              style={{ ...campo, width: 110 }}
            />
            <span style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>= {reais(valorDaRecarga)}</span>
            <button
              disabled={!!ocupado || qtd < dados.minimo}
              style={botao("#0F766E", !ocupado && qtd >= dados.minimo)}
              onClick={async () => {
                try {
                  const d = await acao("recarga", { disparos: qtd });
                  setPix({ ...d.recarga, status: "PENDENTE" });
                } catch (e: any) {
                  setAviso({ tipo: "erro", titulo: "Não consegui gerar o Pix", detalhe: e?.message });
                }
              }}
            >
              {ocupado === "recarga" ? "Gerando…" : "Gerar Pix"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
            {pix.imagem ? <img src={`data:image/png;base64,${pix.imagem}`} alt="QR Code do Pix" style={{ width: 180, height: 180, borderRadius: 12, border: "1px solid #E2E8F0" }} /> : null}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
                {inteiro(pix.disparos)} disparos · {reais(pix.valor)}
              </div>
              <textarea readOnly value={pix.copiaECola || ""} style={{ ...campo, height: 80, fontSize: "0.75rem", resize: "none" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  style={botao()}
                  onClick={() => {
                    navigator.clipboard?.writeText(pix.copiaECola || "").then(
                      () => setAviso({ tipo: "ok", titulo: "Pix copiado", detalhe: "Cole no app do banco." }),
                      () => setAviso({ tipo: "atencao", titulo: "Copie o código manualmente" })
                    );
                  }}
                >
                  Copiar Pix
                </button>
                <button style={botaoLeve} onClick={() => carregar(true)}>Já paguei</button>
                <button style={botaoLeve} onClick={() => setPix(null)}>Fechar</button>
              </div>
              <p style={{ ...sub, margin: "8px 0 0" }}>O saldo entra sozinho assim que o Pix cair (normalmente em segundos).</p>
            </div>
          </div>
        )}
        {(dados.recargas || []).length > 0 && (
          <div style={{ marginTop: 14, fontSize: "0.8rem", color: "#475569" }}>
            {(dados.recargas || []).slice(0, 5).map((r: any) => (
              <div key={r.id} style={{ display: "flex", gap: 10, padding: "4px 0", borderTop: "1px dashed #E2E8F0", alignItems: "center" }}>
                <span style={{ width: 92 }}>{dataHora(r.createdAt)}</span>
                <span style={{ flex: 1 }}>
                  {r.tipo === "AJUSTE" ? `🎁 ${r.descricao || "Crédito do FireHub"}` : "Pix"} · {inteiro(r.disparos)} disparos{r.valor ? ` · ${reais(r.valor)}` : ""}
                </span>
                <span style={{ fontWeight: 700, color: r.status === "PAGA" ? "#047857" : r.status === "PENDENTE" ? "#B45309" : "#94A3B8" }}>
                  {r.status === "PAGA" ? "Creditado" : r.status === "PENDENTE" ? "Aguardando" : "Cancelado"}
                </span>
                {r.status === "PENDENTE" && r.tipo === "PIX" && (
                  <button
                    style={{ ...botaoLeve, padding: "4px 8px" }}
                    onClick={async () => {
                      const d = await fetch(`/api/store/disparo-oficial?recarga=${r.id}`).then((x) => x.json()).catch(() => null);
                      if (d?.recarga) setPix(d.recarga);
                    }}
                  >
                    Ver Pix
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 3. MENSAGENS ────────────────────────────────────────────────── */}
      <div style={{ ...cartao, marginBottom: 16, opacity: conectado ? 1 : 0.55 }}>
        <p style={titulo}>
          <MessageSquareText size={18} color="#0F766E" /> 3. Mensagens
        </p>
        <p style={sub}>
          Toda promoção pela API oficial é um modelo que a Meta aprova antes (de minutos a algumas horas). Use <strong>{"{nome}"}</strong> para o primeiro nome
          do cliente — no meio do texto, nunca no começo nem no fim. O botão &quot;Parar promoções&quot; vai sempre: é ele que mantém o número com boa
          reputação.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          <div>
            <label style={rotulo}>Nome (só para você)</label>
            <input value={mTitulo} onChange={(e) => setMTitulo(e.target.value)} placeholder="Ex.: Quinta da pizza" style={{ ...campo, marginBottom: 10 }} />
            <label style={rotulo}>Mensagem</label>
            <textarea value={mTexto} onChange={(e) => setMTexto(e.target.value)} style={{ ...campo, height: 120, resize: "vertical" }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.85rem", color: "#334155", margin: "10px 0" }}>
              <input type="checkbox" checked={mBotao} onChange={(e) => setMBotao(e.target.checked)} /> Botão &quot;Quero pedir&quot; (o robô atende quem tocar)
            </label>
            <button
              disabled={!conectado || !!ocupado}
              style={botao("#0F766E", conectado && !ocupado)}
              onClick={async () => {
                try {
                  await acao("modelo", { titulo: mTitulo, texto: mTexto, botaoPedir: mBotao });
                  setAviso({ tipo: "ok", titulo: "Enviada para aprovação da Meta", detalhe: "Assim que aprovar, ela aparece para disparar." });
                  setMTitulo("");
                  await carregar(true);
                } catch (e: any) {
                  setAviso({ tipo: "erro", titulo: "A mensagem não foi aceita", detalhe: e?.message });
                }
              }}
            >
              {ocupado === "modelo" ? "Enviando…" : "Enviar para aprovação"}
            </button>
          </div>
          <div style={{ background: "#E7F5EF", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700, marginBottom: 6 }}>Como o cliente vê</div>
            <div style={{ background: "#fff", borderRadius: "4px 12px 12px 12px", padding: "10px 12px", fontSize: "0.85rem", color: "#0F172A", whiteSpace: "pre-wrap", boxShadow: "0 1px 1px rgba(0,0,0,.06)" }}>
              {mTexto.replace(/\{nome\}/gi, "Maria")}
              <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginTop: 6 }}>Sua loja · toque em Parar para não receber</div>
            </div>
            {mBotao && <div style={{ background: "#fff", borderRadius: 10, marginTop: 4, padding: 8, textAlign: "center", color: "#0284C7", fontWeight: 700, fontSize: "0.85rem" }}>↩ Quero pedir</div>}
            <div style={{ background: "#fff", borderRadius: 10, marginTop: 4, padding: 8, textAlign: "center", color: "#0284C7", fontWeight: 700, fontSize: "0.85rem" }}>↩ Parar promoções</div>
          </div>
        </div>
        {(dados.modelos || []).length > 0 && (
          <div style={{ marginTop: 16 }}>
            {(dados.modelos || []).map((m: any) => {
              const selo = SELO_DO_MODELO[m.status] || SELO_DO_MODELO.PENDENTE;
              return (
                <div key={m.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: "1px solid #F1F5F9", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.9rem" }}>{m.titulo}</div>
                    <div style={{ fontSize: "0.8rem", color: "#475569", whiteSpace: "pre-wrap" }}>{m.previa}</div>
                    {m.motivo && <div style={{ fontSize: "0.78rem", color: "#B91C1C", marginTop: 4 }}>Motivo da Meta: {m.motivo}</div>}
                  </div>
                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: selo.cor, background: selo.fundo, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{selo.texto}</span>
                  <button
                    style={{ ...botaoLeve, padding: "4px 8px", color: "#B91C1C" }}
                    disabled={!!ocupado}
                    onClick={async () => {
                      try {
                        await acao("apagar-modelo", { modeloId: m.id });
                        await carregar(true);
                      } catch (e: any) {
                        setAviso({ tipo: "erro", titulo: "Não consegui apagar", detalhe: e?.message });
                      }
                    }}
                  >
                    Apagar
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 4. DISPARAR ─────────────────────────────────────────────────── */}
      <div style={{ ...cartao, marginBottom: 16, opacity: conectado ? 1 : 0.55 }}>
        <p style={titulo}>
          <Users size={18} color="#0F766E" /> 4. Disparar
        </p>
        <p style={sub}>
          Vai para quem já pediu na sua loja (um por telefone, só celular), menos quem tocou em &quot;Parar promoções&quot;. Mande para quem conhece a
          loja: denúncia de spam derruba a qualidade do número e a Meta passa a limitar.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <div>
            <label style={rotulo}>Mensagem aprovada</label>
            <select value={modeloId} onChange={(e) => setModeloId(e.target.value)} style={campo}>
              <option value="">{modelosAprovados.length ? "Escolha…" : "Nenhuma aprovada ainda"}</option>
              {modelosAprovados.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={rotulo}>Para quem</label>
            <select value={publicoTipo} onChange={(e) => setPublicoTipo(e.target.value as any)} style={campo}>
              <option value="TESTE">Só um número (teste)</option>
              <option value="TODOS">Todos os clientes</option>
              <option value="SUMIDOS">Sumidos (não pedem há…)</option>
              <option value="RECENTES">Pediram nos últimos…</option>
            </select>
          </div>
          {publicoTipo === "TESTE" && (
            <div>
              <label style={rotulo}>Celular do teste</label>
              <input value={telefoneTeste} onChange={(e) => setTelefoneTeste(e.target.value)} placeholder="(22) 99999-9999" style={campo} />
            </div>
          )}
          {(publicoTipo === "SUMIDOS" || publicoTipo === "RECENTES") && (
            <div>
              <label style={rotulo}>Dias</label>
              <input type="number" min={1} max={365} value={dias} onChange={(e) => setDias(Math.max(1, Math.min(365, Math.round(Number(e.target.value) || 1))))} style={campo} />
            </div>
          )}
        </div>
        <div style={{ margin: "14px 0", padding: 12, borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: "0.88rem", color: "#334155" }}>
          {quantidade == null ? (
            "Contando os clientes…"
          ) : (
            <>
              <strong>{inteiro(quantidade)}</strong> clientes · usa até <strong>{inteiro(quantidade)}</strong> disparos ({reais(quantidade * preco)}) · seu saldo:{" "}
              <strong style={{ color: saldo >= quantidade ? "#047857" : "#B91C1C" }}>{inteiro(saldo)}</strong>
              {saldo < quantidade && <span style={{ color: "#B91C1C" }}> — recarregue {inteiro(quantidade - saldo)} disparos ou escolha um público menor</span>}
              {limiteDoDia != null && quantidade > limiteDoDia && (
                <div style={{ marginTop: 6, color: "#B45309" }}>
                  ⚠️ Hoje o seu número envia para até {inteiro(limiteDoDia)} clientes por dia (limite da Meta, que sobe com o uso). O que passar disso a Meta
                  recusa e o crédito volta — prefira um público menor, como os sumidos.
                </div>
              )}
            </>
          )}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.85rem", color: "#334155", marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} style={{ marginTop: 3 }} />
          Estes clientes compraram na minha loja e aceitam receber novidades dela pelo WhatsApp.
        </label>
        {!confirmando ? (
          <button
            disabled={!conectado || !modeloEscolhido || !aceite || !quantidade || saldo < (quantidade || 0) || !!ocupado}
            style={botao("#0F766E", conectado && !!modeloEscolhido && aceite && !!quantidade && saldo >= (quantidade || 0) && !ocupado)}
            onClick={() => setConfirmando(true)}
          >
            <Send size={15} /> Disparar
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#0F172A" }}>
              Enviar &quot;{modeloEscolhido?.titulo}&quot; para {inteiro(quantidade || 0)} clientes?
            </span>
            <button
              style={botao("#0F766E", !ocupado)}
              disabled={!!ocupado}
              onClick={async () => {
                try {
                  const d = await acao("campanha", { modeloId, publico: { tipo: publicoTipo, dias, telefone: telefoneTeste }, confirmouAceite: aceite });
                  setAviso({ tipo: "ok", titulo: "Disparo começou!", detalhe: `${inteiro(d.campanha.total)} mensagens na fila. Acompanhe abaixo.` });
                  setConfirmando(false);
                  await carregar(true);
                } catch (e: any) {
                  setAviso({ tipo: "erro", titulo: "Não consegui disparar", detalhe: e?.message });
                }
              }}
            >
              {ocupado === "campanha" ? "Disparando…" : "Sim, enviar"}
            </button>
            <button style={botaoLeve} onClick={() => setConfirmando(false)}>Voltar</button>
          </div>
        )}
      </div>

      {/* ── 5. CAMPANHAS ────────────────────────────────────────────────── */}
      <div style={cartao}>
        <p style={titulo}>
          <BadgeCheck size={18} color="#0F766E" /> Campanhas
        </p>
        {(dados.campanhas || []).length === 0 ? (
          <p style={{ ...sub, margin: 0 }}>Nenhuma campanha ainda.</p>
        ) : (
          (dados.campanhas || []).map((c: any) => {
            const n = c.contagem || {};
            const entregues = (n.ENTREGUE || 0) + (n.LIDO || 0);
            const saiu = (n.ENVIADO || 0) + (n.INCERTO || 0) + entregues;
            const falharam = (n.FALHOU || 0) + (n.EXPIRADO || 0);
            const naFila = (n.FILA || 0) + (n.PROCESSANDO || 0);
            const selo = SELO_DA_CAMPANHA[c.status] || SELO_DA_CAMPANHA.ENVIANDO;
            const pct = (v: number) => `${c.total ? Math.round((v / c.total) * 100) : 0}%`;
            return (
              <div key={c.id} style={{ padding: "12px 0", borderTop: "1px solid #F1F5F9" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: "#0F172A" }}>{c.nome}</strong>
                  <span style={{ fontSize: "0.75rem", fontWeight: 800, color: selo.cor }}>{selo.texto}</span>
                  <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>{dataHora(c.createdAt)}</span>
                  {c.status === "ENVIANDO" && (
                    <button
                      style={{ ...botaoLeve, padding: "4px 8px", color: "#B91C1C", marginLeft: "auto" }}
                      disabled={!!ocupado}
                      onClick={async () => {
                        try {
                          const d = await acao("cancelar-campanha", { campanhaId: c.id });
                          setAviso({ tipo: "info", titulo: "Campanha cancelada", detalhe: `${inteiro(d.devolvidos)} disparos voltaram ao saldo.` });
                          await carregar(true);
                        } catch (e: any) {
                          setAviso({ tipo: "erro", titulo: "Não consegui cancelar", detalhe: e?.message });
                        }
                      }}
                    >
                      Cancelar o que falta
                    </button>
                  )}
                </div>
                <div style={{ height: 8, background: "#F1F5F9", borderRadius: 999, overflow: "hidden", margin: "8px 0", display: "flex" }}>
                  <div style={{ width: pct(entregues), background: "#10B981" }} />
                  <div style={{ width: pct(n.ENVIADO || 0), background: "#93C5FD" }} />
                  <div style={{ width: pct(falharam), background: "#FCA5A5" }} />
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: "0.8rem", color: "#475569" }}>
                  <span>{inteiro(c.total)} clientes</span>
                  {naFila > 0 && <span>⏳ {inteiro(naFila)} na fila</span>}
                  <span>📤 {inteiro(saiu)} enviadas</span>
                  <span>✅ {inteiro(entregues)} entregues</span>
                  <span>👀 {inteiro(n.LIDO || 0)} lidas</span>
                  <span>💬 {inteiro(c.responderam || 0)} responderam</span>
                  {falharam + (n.CANCELADO || 0) > 0 && (
                    <button
                      style={{ background: "none", border: "none", padding: 0, color: "#B91C1C", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}
                      onClick={async () => {
                        if (falhas?.campanhaId === c.id) return setFalhas(null);
                        const d = await fetch(`/api/store/disparo-oficial?falhas=${c.id}`).then((x) => x.json()).catch(() => null);
                        setFalhas({ campanhaId: c.id, lista: d?.falhas || [] });
                      }}
                    >
                      ✖ {inteiro(falharam + (n.CANCELADO || 0))} não entregues (crédito devolvido)
                    </button>
                  )}
                </div>
                {c.motivo && <div style={{ fontSize: "0.78rem", color: "#B91C1C", marginTop: 4 }}>{c.motivo}</div>}
                {falhas && falhas.campanhaId === c.id && (
                  <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto", fontSize: "0.78rem", color: "#475569", background: "#F8FAFC", borderRadius: 10, padding: 8 }}>
                    {falhas.lista.length === 0
                      ? "Nada a mostrar."
                      : falhas.lista.map((f: any, i: number) => (
                          <div key={i}>
                            {f.nome || "Cliente"} · {f.telefone} — {f.erro || f.status}
                          </div>
                        ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
