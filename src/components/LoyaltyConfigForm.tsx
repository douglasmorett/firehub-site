"use client";
import { useEffect, useState } from "react";
import {
  Gift, Info, TrendingUp, Award, Users, Cake, Crown, Check, Sparkles, AlertCircle, HelpCircle
} from "lucide-react";
import {
  CAMPANHA_PADRAO,
  VERSAO_ASSISTENTE_COM_CAMPANHA,
  formatarPremio,
  lerCampanha,
  normalizarCodigo,
  versaoAtende,
  type CampanhaConverterConfig,
} from "@/lib/campanha-converter";

export type LoyaltyConfig = {
  active: boolean;
  // Campanha "Converter para site próprio": prêmio + QR no fim da comanda do
  // iFood/99Food (lib/campanha-converter.ts).
  converter: CampanhaConverterConfig;
  // Program 1: Cashback
  cashbackActive: boolean;
  rate: number;
  minOrderValue: number;
  maxRedeemPercent: number;
  expiresInDays: number;
  // Program 2: Carimbos (Cartão Fidelidade)
  stampsActive: boolean;
  stampGoal: number; // Ex: 10 carimbos
  stampMinOrder: number; // Ex: R$ 30
  stampRewardType: "discount" | "product"; // "discount" | "product"
  stampRewardValue: number; // Ex: R$ 25 off
  // Program 3: Indique e Ganhe
  referralActive: boolean;
  friendDiscount: number; // Ex: R$ 10 off para o amigo
  referrerReward: number; // Ex: R$ 10 de volta para quem indicou
  referralMinOrder: number; // Ex: R$ 35
  // Program 4: Aniversariantes
  birthdayActive: boolean;
  birthdayRewardType: "coupon" | "double_cashback";
  birthdayDiscount: number; // Ex: R$ 20 off
  birthdayMinOrder: number; // Ex: R$ 40
  // Program 5: Níveis VIP
  vipActive: boolean;
  bronzeCashback: number; // Ex: 1%
  silverMinSpend: number; // Ex: R$ 150/mês
  silverCashback: number; // Ex: 2%
  goldMinSpend: number; // Ex: R$ 350/mês
  goldCashback: number; // Ex: 3%
};

const DEFAULT_LOYALTY: LoyaltyConfig = {
  active: true,
  converter: CAMPANHA_PADRAO,
  cashbackActive: true,
  rate: 5,
  minOrderValue: 20,
  maxRedeemPercent: 50,
  expiresInDays: 30,

  stampsActive: false,
  stampGoal: 10,
  stampMinOrder: 30,
  stampRewardType: "discount",
  stampRewardValue: 25,

  referralActive: false,
  friendDiscount: 10,
  referrerReward: 10,
  referralMinOrder: 35,

  birthdayActive: false,
  birthdayRewardType: "coupon",
  birthdayDiscount: 15,
  birthdayMinOrder: 40,

  vipActive: false,
  bronzeCashback: 1,
  silverMinSpend: 150,
  silverCashback: 2,
  goldMinSpend: 350,
  goldCashback: 3,
};

const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export default function LoyaltyConfigForm({
  initialConfig,
  onSave,
}: {
  initialConfig?: Partial<LoyaltyConfig>;
  onSave: (config: LoyaltyConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState<LoyaltyConfig>({
    ...DEFAULT_LOYALTY,
    ...initialConfig,
    // O que está salvo pode ser parcial (campo novo, string onde era número):
    // normaliza uma vez, na entrada.
    converter: lerCampanha(initialConfig),
  });
  const [activeTab, setActiveTab] = useState<"converter" | "cashback" | "stamps" | "referral" | "birthday" | "vip">("converter");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (key: keyof LoyaltyConfig, val: any) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  // ── CAMPANHA "CONVERTER PARA SITE PRÓPRIO" ──────────────────────────────
  //
  // O prêmio sai IMPRESSO, e quem imprime é o Assistente de Impressão no PC
  // da loja. Sem ele conectado não há o que configurar — a tela pede para
  // instalar antes, em vez de deixar a loja ativar uma campanha que nunca
  // sairia no papel. O estado vem de /api/store/print-queue/status (o que o
  // Assistente contou de si na última consulta à fila) e a lista de
  // impressoras é a que o Windows daquele PC enxerga, mais as cadastradas.
  type EstadoDoAssistente = {
    ultimoPoll: string | null;
    paradoHaSegundos: number | null;
    versaoAssistente: string | null;
    impressorasNoPc: string[];
  };
  const [assistente, setAssistente] = useState<EstadoDoAssistente | null>(null);
  const [impressorasCadastradas, setImpressorasCadastradas] = useState<string[]>([]);
  const [slugDaLoja, setSlugDaLoja] = useState("");
  const [verificando, setVerificando] = useState(true);
  const [erroConv, setErroConv] = useState("");

  const verificarAssistente = async () => {
    setVerificando(true);
    try {
      const [st, pc] = await Promise.all([
        fetch("/api/store/print-queue/status").then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/store/printer-config").then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      setAssistente(st);
      setImpressorasCadastradas(
        Array.isArray(pc?.printers) ? pc.printers.map((p: any) => String(p?.name || "")).filter(Boolean) : []
      );
      setSlugDaLoja(String(pc?.storeSlug || ""));
    } finally {
      setVerificando(false);
    }
  };
  useEffect(() => { verificarAssistente(); }, []);

  const conv = config.converter;
  const setConv = (patch: Partial<CampanhaConverterConfig>) =>
    setConfig(prev => ({ ...prev, converter: { ...prev.converter, ...patch } }));

  // Três estados, de propósito. NUNCA se conectou = não está instalado: a
  // tela trava e manda instalar. Já se conectou mas está fechado agora (o
  // dono configurando de casa, à noite, com o PC da loja desligado) = pode
  // configurar e ativar, com o aviso de que o prêmio só sai com ele aberto.
  // Conectou nos últimos 10 min = está aberto neste momento.
  const assistenteJaConectou = !!assistente?.ultimoPoll;
  const assistenteOnline =
    assistenteJaConectou && assistente!.paradoHaSegundos !== null && assistente!.paradoHaSegundos <= 10 * 60;
  // A versão é a da última consulta — vale mesmo com o Assistente fechado.
  const versaoOk = assistenteJaConectou && versaoAtende(assistente?.versaoAssistente, VERSAO_ASSISTENTE_COM_CAMPANHA);
  const impressoras = Array.from(new Set([
    ...(assistente?.impressorasNoPc || []),
    ...impressorasCadastradas,
    ...(conv.impressora ? [conv.impressora] : []),
  ]));
  const fmtR = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

  const alternarCampanha = () => {
    if (conv.active) { setConv({ active: false }); setErroConv(""); return; }
    if (!assistenteJaConectou) { setErroConv("Instale e abra o Assistente de Impressão no PC da loja antes de ativar — é ele que imprime o prêmio."); return; }
    if (!versaoOk) { setErroConv(`Atualize o Assistente para a versão ${VERSAO_ASSISTENTE_COM_CAMPANHA} antes de ativar — é ela que desenha o QR code na comanda.`); return; }
    if (!conv.impressora) { setErroConv("Escolha em qual impressora o prêmio vai sair."); return; }
    if (!(conv.valor > 0)) { setErroConv("Informe o valor do prêmio."); return; }
    if (!conv.codigo) { setErroConv("Informe o código do cupom (só letras e números)."); return; }
    setErroConv("");
    setConv({ active: true });
  };

  const handleSave = async () => {
    // Campanha ligada sem impressora não sai em lugar nenhum: não deixa salvar
    // assim, e leva a pessoa para a aba certa com o motivo na tela.
    if (config.converter.active && !config.converter.impressora) {
      setActiveTab("converter");
      setErroConv("Escolha a impressora do prêmio antes de salvar.");
      return;
    }
    setSaving(true);
    await onSave(config);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const exampleOrder = 80;
  const exampleCashback = config.cashbackActive && exampleOrder >= config.minOrderValue
    ? (exampleOrder * config.rate) / 100 : 0;

  return (
    <div style={{ background: "#fff", borderRadius: "20px", border: "1.5px solid #E2E8F0", overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>
      {/* Banner Topo Limpo e Informativo (Sem botão redundante) */}
      <div
        style={{
          padding: "1.25rem 1.5rem",
          background: "linear-gradient(135deg, #6D28D9, #4C1D95)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Gift size={24} color="#fff" />
          </div>
          <div>
            <h2 style={{ color: "#fff", fontWeight: 900, fontSize: "1.1rem", margin: 0 }}>
              🎁 Promoções & Fidelidade da Loja
            </h2>
            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.78rem", margin: "2px 0 0" }}>
              Cada programa pode ser ativado individualmente e já passa a funcionar no seu cardápio.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.12)", padding: "6px 14px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700 }}>
          <Sparkles size={14} color="#FDE047" /> Controle por Módulo
        </div>
      </div>

      {/* Navegação por Sub-Programas (Abas) */}
      <div style={{ display: "flex", flexWrap: "wrap", background: "#F8FAFC", borderBottom: "1.5px solid #E2E8F0", padding: "6px 12px", gap: "6px" }}>
        {[
          { key: "converter", label: "🧾 Converter iFood/99 → Site", badge: config.converter.active ? "Ativo" : "Novo", badgeRoxo: !config.converter.active },
          { key: "cashback", label: "💸 Cashback Automático", badge: config.cashbackActive ? "Ativo" : null },
          { key: "stamps", label: "🎫 Cartão de Carimbos", badge: config.stampsActive ? "Ativo" : null },
          { key: "referral", label: "🎁 Indique e Ganhe", badge: config.referralActive ? "Ativo" : null },
          { key: "birthday", label: "🎂 Aniversariantes & Chatbot", badge: config.birthdayActive ? "Ativo" : null },
          { key: "vip", label: "👑 Níveis VIP", badge: config.vipActive ? "Ativo" : null },
        ].map((tab: { key: string; label: string; badge: string | null; badgeRoxo?: boolean }) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "none",
              background: activeTab === tab.key ? "#EDE9FE" : "transparent",
              fontSize: "0.85rem",
              fontWeight: activeTab === tab.key ? 800 : 600,
              color: activeTab === tab.key ? "#6D28D9" : "#64748B",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            {tab.label}
            {tab.badge && (
              <span style={{ fontSize: "0.65rem", padding: "1px 6px", borderRadius: 10, background: tab.badgeRoxo ? "#EDE9FE" : "#DCFCE7", color: tab.badgeRoxo ? "#6D28D9" : "#15803D", fontWeight: 800 }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* CONTEÚDO DAS ABAS */}
      <div style={{ padding: "1.5rem" }}>
        {/* TAB 0: CONVERTER IFOOD/99 → SITE PRÓPRIO */}
        {activeTab === "converter" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🧾 Campanha: Converter clientes do iFood e do 99Food para o seu site
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  No fim da comanda dos pedidos do iFood e do 99Food sai, bem grande, <strong>“VOCÊ GANHOU {formatarPremio(conv)}”</strong> com um
                  QR code. O cliente escaneia em casa e o próximo pedido dele entra pelo seu cardápio — sem comissão de aplicativo.
                </p>
              </div>

              <button
                type="button"
                onClick={alternarCampanha}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: conv.active ? "#DCFCE7" : "#F1F5F9",
                  color: conv.active ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {conv.active ? "🟢 Campanha Ativa" : "⚪ Desativada — clique para ativar"}
              </button>
            </div>

            {erroConv && (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: "0.82rem", color: "#B91C1C", fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
                <AlertCircle size={16} /> {erroConv}
              </div>
            )}

            {/* ── O ASSISTENTE DE IMPRESSÃO: sem ele, nada sai no papel ── */}
            {verificando ? (
              <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: 14, marginBottom: 20, fontSize: "0.82rem", color: "#475569", fontWeight: 600 }}>
                🔎 Verificando se o Assistente de Impressão está conectado no PC da loja…
              </div>
            ) : !assistenteJaConectou ? (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14, padding: 16, marginBottom: 20 }}>
                <strong style={{ color: "#B91C1C", fontSize: "0.95rem", display: "block", marginBottom: 6 }}>
                  🖨️ Antes de configurar: instale o Assistente de Impressão FireHub no PC da loja
                </strong>
                <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "#7F1D1D", lineHeight: 1.5 }}>
                  O prêmio sai <strong>impresso na comanda</strong>, e quem imprime é o Assistente. Ele nunca se conectou a esta
                  loja: instale no PC do caixa, com a impressora ligada, e volte aqui para escolher onde o prêmio sai.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href="/downloads/FireHub-Assistente-Impressao-Setup.exe"
                    download
                    style={{ padding: "8px 14px", borderRadius: 10, background: "#DC2626", color: "#fff", fontWeight: 800, fontSize: "0.8rem", textDecoration: "none" }}
                  >
                    ⬇️ Baixar o Assistente (Windows)
                  </a>
                  <button
                    type="button"
                    onClick={verificarAssistente}
                    style={{ padding: "8px 14px", borderRadius: 10, background: "#fff", color: "#B91C1C", border: "1.5px solid #FECACA", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}
                  >
                    🔄 Já instalei — verificar de novo
                  </button>
                </div>
              </div>
            ) : !versaoOk ? (
              <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: 16, marginBottom: 20 }}>
                <strong style={{ color: "#92400E", fontSize: "0.95rem", display: "block", marginBottom: 6 }}>
                  ⬆️ Atualize o Assistente de Impressão para a versão {VERSAO_ASSISTENTE_COM_CAMPANHA}
                </strong>
                <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "#78350F", lineHeight: 1.5 }}>
                  O Assistente deste PC está na versão <strong>{assistente?.versaoAssistente || "antiga"}</strong>, que não sabe desenhar o QR code
                  do prêmio. Baixe e instale por cima — as impressoras configuradas continuam como estão. Você já pode preencher a campanha;
                  ela só liga quando a versão nova estiver rodando.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href="/downloads/FireHub-Assistente-Impressao-Setup.exe"
                    download
                    style={{ padding: "8px 14px", borderRadius: 10, background: "#D97706", color: "#fff", fontWeight: 800, fontSize: "0.8rem", textDecoration: "none" }}
                  >
                    ⬇️ Baixar a versão {VERSAO_ASSISTENTE_COM_CAMPANHA}
                  </a>
                  <button
                    type="button"
                    onClick={verificarAssistente}
                    style={{ padding: "8px 14px", borderRadius: 10, background: "#fff", color: "#92400E", border: "1.5px solid #FDE68A", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}
                  >
                    🔄 Já atualizei — verificar de novo
                  </button>
                </div>
              </div>
            ) : !assistenteOnline ? (
              <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "12px 14px", marginBottom: 20, fontSize: "0.82rem", color: "#78350F", lineHeight: 1.5 }}>
                <strong style={{ color: "#92400E", display: "block", marginBottom: 4 }}>
                  ⏸️ O Assistente {assistente?.versaoAssistente} está fechado agora (última conexão há {Math.max(1, Math.round((assistente?.paradoHaSegundos || 0) / 60))} min)
                </strong>
                Pode configurar e ativar normalmente: a campanha fica salva e o prêmio passa a sair assim que o Assistente estiver
                aberto no PC da loja — é ele que imprime.
                <button type="button" onClick={verificarAssistente} style={{ marginLeft: 8, background: "none", border: "none", color: "#92400E", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer" }}>
                  🔄 verificar de novo
                </button>
              </div>
            ) : (
              <div style={{ background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: 14, padding: "10px 14px", marginBottom: 20, fontSize: "0.82rem", color: "#166534", fontWeight: 700, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Check size={16} /> Assistente {assistente?.versaoAssistente} conectado no PC da loja
                {impressoras.length > 0 ? ` · ${impressoras.length} impressora${impressoras.length > 1 ? "s" : ""} encontrada${impressoras.length > 1 ? "s" : ""}` : ""}
                <button type="button" onClick={verificarAssistente} style={{ marginLeft: "auto", background: "none", border: "none", color: "#15803D", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>
                  🔄 verificar de novo
                </button>
              </div>
            )}

            {/* ── Como funciona, sem letra miúda ── */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <HelpCircle size={20} color="#7C3AED" />
                <strong style={{ color: "#0F172A", fontSize: "0.92rem" }}>Como funciona</strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: "#475569", lineHeight: 1.6 }}>
                <li>🧾 Sai <strong>só na comanda de pedido do iFood e do 99Food</strong>. Nunca em pedido do site, do WhatsApp, do balcão ou da mesa — esse cliente já é seu, não faz sentido dar o desconto.</li>
                <li>🖨️ Sai <strong>na impressora que você escolher</strong>, no fim da comanda, depois do resumo do pedido. A via da cozinha (sem valores) não leva o prêmio.</li>
                <li>📱 O QR abre o seu cardápio <strong>já com o cupom aplicado</strong>. Quem não escaneia digita o código na sacola.</li>
                <li>✅ O site confere sozinho o pedido mínimo e, se marcado, o <strong>“só no primeiro pedido”</strong> (pelo telefone do cliente).</li>
                <li>💡 Grampeie a comanda no saco kraft: é assim que o prêmio chega à mesa do cliente.</li>
              </ul>
            </div>

            <fieldset disabled={!assistenteJaConectou} style={{ border: "none", padding: 0, margin: 0, opacity: assistenteJaConectou ? 1 : 0.55 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
                {/* Configuração */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 6 }}>O prêmio é</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {([["fixo", "💵 Valor fixo (R$)"], ["percentual", "％ do pedido"]] as const).map(([tipo, rotulo]) => (
                        <button
                          key={tipo}
                          type="button"
                          onClick={() => setConv({ tipo })}
                          style={{ flex: 1, padding: "9px 10px", borderRadius: 10, border: `1.5px solid ${conv.tipo === tipo ? "#7C3AED" : "#E2E8F0"}`, background: conv.tipo === tipo ? "#EDE9FE" : "#fff", color: conv.tipo === tipo ? "#6D28D9" : "#475569", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 4 }}>
                        {conv.tipo === "percentual" ? "Desconto (%)" : "Valor do prêmio (R$)"}
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={conv.tipo === "percentual" ? 1 : 0.5}
                        value={conv.valor === 0 ? "" : conv.valor}
                        onChange={e => setConv({ valor: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0) })}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 800 }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 4 }}>Pedido mínimo no site (R$)</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="0 = sem mínimo"
                        value={conv.pedidoMinimo === 0 ? "" : conv.pedidoMinimo}
                        onChange={e => setConv({ pedidoMinimo: e.target.value === "" ? 0 : Math.max(0, parseFloat(e.target.value) || 0) })}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 800 }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 6 }}>Quem pode usar</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {([[true, "🥇 Só no primeiro pedido pelo site"], [false, "♾️ Sempre que pedir pelo site"]] as const).map(([so, rotulo]) => (
                        <button
                          key={String(so)}
                          type="button"
                          onClick={() => setConv({ somentePrimeiroPedido: so })}
                          style={{ flex: 1, padding: "9px 10px", borderRadius: 10, border: `1.5px solid ${conv.somentePrimeiroPedido === so ? "#7C3AED" : "#E2E8F0"}`, background: conv.somentePrimeiroPedido === so ? "#EDE9FE" : "#fff", color: conv.somentePrimeiroPedido === so ? "#6D28D9" : "#475569", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer" }}
                        >
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#64748B" }}>
                      {conv.somentePrimeiroPedido
                        ? "O site reconhece pelo telefone: quem já pediu pelo site não consegue usar o cupom de novo."
                        : "Todo pedido pelo site com este cupom ganha o desconto — inclusive de quem já é cliente do site."}
                    </p>
                  </div>

                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 4 }}>Código do cupom (sai impresso, para quem não escaneia)</label>
                    <input
                      type="text"
                      value={conv.codigo}
                      maxLength={20}
                      onChange={e => setConv({ codigo: normalizarCodigo(e.target.value) })}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 4 }}>🖨️ Impressora em que o prêmio sai</label>
                    {impressoras.length > 0 ? (
                      <select
                        value={conv.impressora}
                        onChange={e => { setConv({ impressora: e.target.value }); setErroConv(""); }}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${conv.impressora ? "#CBD5E1" : "#F59E0B"}`, fontSize: "0.9rem", fontWeight: 700, background: "#fff" }}
                      >
                        <option value="">Escolha a impressora…</option>
                        {impressoras.map(nome => (
                          <option key={nome} value={nome}>{nome}</option>
                        ))}
                      </select>
                    ) : (
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#B45309", fontWeight: 700, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
                        O Assistente ainda não informou as impressoras deste PC. Atualize-o para a versão {VERSAO_ASSISTENTE_COM_CAMPANHA} ou cadastre a impressora em Impressoras e clique em “verificar de novo”.
                      </p>
                    )}
                    <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#64748B" }}>
                      Escolha a impressora da comanda que vai grampeada no saco (normalmente a do balcão/expedição), não a da cozinha.
                    </p>
                  </div>
                </div>

                {/* Prévia da comanda */}
                <div>
                  <label style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", display: "block", marginBottom: 6 }}>Assim vai sair no fim da comanda</label>
                  <div style={{ fontFamily: "'Courier New', Courier, monospace", background: "#fff", border: "1px dashed #94A3B8", borderRadius: 6, padding: "14px 12px", textAlign: "center", color: "#111", maxWidth: 300, margin: "0 auto", boxShadow: "0 8px 20px rgba(0,0,0,0.08)" }}>
                    <div style={{ color: "#94A3B8", fontSize: "0.68rem" }}>… resumo do pedido, total, pagamento …</div>
                    <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />
                    <div style={{ fontWeight: 900, fontSize: "1.55rem", lineHeight: 1.1, letterSpacing: 1 }}>VOCE GANHOU</div>
                    <div style={{ fontWeight: 900, fontSize: "1.55rem", lineHeight: 1.1, letterSpacing: 1 }}>{formatarPremio(conv)}</div>
                    <div style={{ fontWeight: 700, fontSize: "0.78rem", marginTop: 4 }}>para lanchar conosco pelo nosso site!</div>
                    <div
                      title="Aqui sai o QR code de verdade"
                      style={{ width: 92, height: 92, margin: "10px auto", background: "repeating-conic-gradient(#111 0 25%, #fff 0 50%) 0 0 / 14px 14px", border: "4px solid #fff", outline: "1px solid #111" }}
                    />
                    <div style={{ fontWeight: 700, fontSize: "0.76rem" }}>Escaneie e faca seu proximo pedido</div>
                    <div style={{ fontSize: "0.76rem" }}>ou use o cupom {conv.codigo || "……"}</div>
                    <div style={{ fontSize: "0.76rem" }}>em firehubfood.com.br/loja/{slugDaLoja || "sua-loja"}</div>
                    <div style={{ fontSize: "0.72rem", marginTop: 4 }}>{conv.somentePrimeiroPedido ? "Valido no seu PRIMEIRO pedido pelo site" : "Valido em todo pedido pelo site"}</div>
                    {conv.pedidoMinimo > 0 && <div style={{ fontSize: "0.72rem" }}>Pedido minimo: {fmtR(conv.pedidoMinimo)}</div>}
                    <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />
                    <div style={{ fontSize: "0.7rem" }}>Obrigado pela preferencia!</div>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: "#64748B", textAlign: "center" }}>
                    “VOCE GANHOU” e o valor saem em letra dobrada; o QR sai grande, para a câmera do celular ler de longe.
                  </p>
                </div>
              </div>
            </fieldset>
          </div>
        )}

        {/* TAB 1: CASHBACK AUTOMÁTICO */}
        {activeTab === "cashback" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  💸 Cashback Automático
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Devolva uma porcentagem das compras do cliente como crédito em saldo para os próximos pedidos.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("cashbackActive", !config.cashbackActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.cashbackActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.cashbackActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                {config.cashbackActive ? "🟢 Cashback Habilitado" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Simulation Card */}
            <div
              style={{
                background: config.cashbackActive ? "#F5F3FF" : "#F8FAFC",
                border: `1.5px solid ${config.cashbackActive ? "#DDD6FE" : "#CBD5E1"}`,
                borderRadius: 14,
                padding: "14px 16px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: config.cashbackActive ? "#7C3AED" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <TrendingUp size={22} color="#fff" />
              </div>
              <div>
                <strong style={{ fontSize: "0.9rem", color: config.cashbackActive ? "#5B21B6" : "#475569", display: "block" }}>
                  Simulador de Exemplo: Pedido de R$ {exampleOrder},00
                </strong>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>
                  {config.cashbackActive
                    ? `O cliente ganha ${fmt(exampleCashback)} de volta (${config.rate}% do pedido) para gastar em compras futuras.`
                    : "Ative o Cashback Automático para ver o cálculo."}
                </span>
              </div>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Porcentagem de Cashback (%)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="0"
                    value={config.rate === 0 ? "" : config.rate}
                    onChange={e => update("rate", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                  />
                  <span style={{ fontWeight: 800, color: "#7C3AED" }}>%</span>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo para Acumular (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.minOrderValue === 0 ? "" : config.minOrderValue}
                  onChange={e => update("minOrderValue", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Limite de Resgate por Pedido (%)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    step="5"
                    placeholder="50"
                    value={config.maxRedeemPercent === 0 ? "" : config.maxRedeemPercent}
                    onChange={e => update("maxRedeemPercent", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                  />
                  <span style={{ fontWeight: 800, color: "#7C3AED" }}>%</span>
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Expiração dos Créditos (dias)
                </label>
                <input
                  type="number"
                  placeholder="0 (nunca expira)"
                  value={config.expiresInDays === 0 ? "" : config.expiresInDays}
                  onChange={e => update("expiresInDays", e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>

            {/* Seção Integrada: Níveis VIP & Bônus de Cashback */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1.5px dashed #CBD5E1" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Crown size={20} color="#CA8A04" />
                    <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#0F172A" }}>
                      👑 Níveis VIP & Bônus Extra de Cashback
                    </h4>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: "0.76rem", color: "#64748B" }}>
                    Os clientes sobem de nível conforme o gasto no mês e somam uma porcentagem extra ao cashback base ({config.rate}%).
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => update("vipActive", !config.vipActive)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: "none",
                    background: config.vipActive ? "#DCFCE7" : "#F1F5F9",
                    color: config.vipActive ? "#15803D" : "#64748B",
                    fontWeight: 800,
                    fontSize: "0.78rem",
                    cursor: "pointer",
                  }}
                >
                  {config.vipActive ? "🟢 Níveis VIP Ativos" : "⚪ Desativado"}
                </button>
              </div>

              {/* Tabela Comparativa de Cashback Base + VIP Bônus */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
                {/* Bronze */}
                <div style={{ background: "#FFF7ED", border: "1.5px solid #FFEDD5", borderRadius: 12, padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ color: "#C2410C", fontSize: "0.86rem" }}>🥉 Nível Bronze</strong>
                    <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#C2410C", background: "#FFEDD5", padding: "1px 6px", borderRadius: 4 }}>Iniciante</span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", display: "block", marginBottom: 8 }}>
                    Gasto até {fmt(config.silverMinSpend)}/mês
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, fontSize: "0.76rem" }}>
                    <span style={{ color: "#475569" }}>Bônus Extra:</span>
                    <strong style={{ color: "#C2410C" }}>+{config.bronzeCashback}%</strong>
                  </div>
                  <div style={{ background: "#FFFFFF", borderRadius: 6, padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #FED7AA" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Total:</span>
                    <strong style={{ fontSize: "0.85rem", color: "#C2410C" }}>{config.rate + config.bronzeCashback}%</strong>
                  </div>
                </div>

                {/* Prata */}
                <div style={{ background: "#F1F5F9", border: "1.5px solid #CBD5E1", borderRadius: 12, padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ color: "#475569", fontSize: "0.86rem" }}>🥈 Nível Prata</strong>
                    <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#475569", background: "#E2E8F0", padding: "1px 6px", borderRadius: 4 }}>Frequente</span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", display: "block", marginBottom: 8 }}>
                    Gasto de {fmt(config.silverMinSpend)} a {fmt(config.goldMinSpend)}/mês
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, fontSize: "0.76rem" }}>
                    <span style={{ color: "#475569" }}>Bônus Extra:</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="1"
                        value={config.silverCashback === 0 ? "" : config.silverCashback}
                        onChange={e => update("silverCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                        style={{ width: "45px", padding: "2px 4px", borderRadius: 4, border: "1px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 800, textAlign: "center" }}
                      />
                      <span style={{ fontWeight: 800, color: "#475569" }}>%</span>
                    </div>
                  </div>
                  <div style={{ background: "#FFFFFF", borderRadius: 6, padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #CBD5E1" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Total:</span>
                    <strong style={{ fontSize: "0.85rem", color: "#475569" }}>{config.rate + config.silverCashback}%</strong>
                  </div>
                </div>

                {/* Ouro */}
                <div style={{ background: "#FEF3C7", border: "1.5px solid #FCD34D", borderRadius: 12, padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ color: "#92400E", fontSize: "0.86rem" }}>🥇 Nível Ouro</strong>
                    <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#92400E", background: "#FDE68A", padding: "1px 6px", borderRadius: 4 }}>Top VIP</span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "#78350F", display: "block", marginBottom: 8 }}>
                    Gasto acima de {fmt(config.goldMinSpend)}/mês
                  </span>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, fontSize: "0.76rem" }}>
                    <span style={{ color: "#78350F" }}>Bônus Extra:</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="2"
                        value={config.goldCashback === 0 ? "" : config.goldCashback}
                        onChange={e => update("goldCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                        style={{ width: "45px", padding: "2px 4px", borderRadius: 4, border: "1px solid #FCD34D", fontSize: "0.8rem", fontWeight: 800, textAlign: "center" }}
                      />
                      <span style={{ fontWeight: 800, color: "#92400E" }}>%</span>
                    </div>
                  </div>
                  <div style={{ background: "#FFFFFF", borderRadius: 6, padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #FCD34D" }}>
                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#78350F" }}>Cashback Total:</span>
                    <strong style={{ fontSize: "0.85rem", color: "#92400E" }}>{config.rate + config.goldCashback}%</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CARTÃO FIDELIDADE (CARIMBOS) */}
        {activeTab === "stamps" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎫 Cartão Fidelidade por Carimbos (Digital)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Substitua os cartões de papel por selos digitais marcados a cada pedido finalizado.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("stampsActive", !config.stampsActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.stampsActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.stampsActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.stampsActive ? "🟢 Carimbos Habilitados" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Cartela de Carimbos Visual */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "16px", marginBottom: 20 }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Simulador da Cartela Digital do Cliente ({config.stampGoal} Carimbos):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                {Array.from({ length: config.stampGoal || 10 }).map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: idx < 4 ? "#7C3AED" : "#fff",
                      border: `2px ${idx < 4 ? "solid #7C3AED" : "dashed #CBD5E1"}`,
                      color: idx < 4 ? "#fff" : "#94A3B8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                    }}
                  >
                    {idx < 4 ? <Award size={20} /> : idx + 1}
                  </div>
                ))}
                <div style={{ marginLeft: "auto", background: "#FEF3C7", border: "1.5px solid #FCD34D", padding: "8px 14px", borderRadius: 10, fontSize: "0.82rem", fontWeight: 800, color: "#92400E" }}>
                  🎁 Prêmio Final: {fmt(config.stampRewardValue)} OFF
                </div>
              </div>
            </div>

            {/* Inputs Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Meta de Carimbos para Completar
                </label>
                <select
                  value={config.stampGoal}
                  onChange={e => update("stampGoal", parseInt(e.target.value) || 10)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                >
                  <option value={5}>5 Carimbos</option>
                  <option value={8}>8 Carimbos</option>
                  <option value={10}>10 Carimbos</option>
                  <option value={12}>12 Carimbos</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo por Carimbo (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.stampMinOrder === 0 ? "" : config.stampMinOrder}
                  onChange={e => update("stampMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Valor do Prêmio ao Completar (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.stampRewardValue === 0 ? "" : config.stampRewardValue}
                  onChange={e => update("stampRewardValue", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INDIQUE E GANHE */}
        {activeTab === "referral" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎁 Indique e Ganhe (Recompensa por Indicação)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Transforme seus clientes em divulgadores ativando cupons para quem indica e quem é indicado.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("referralActive", !config.referralActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.referralActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.referralActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.referralActive ? "🟢 Indicação Habilitada" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Flow Banner */}
            <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 14, padding: "14px 16px", marginBottom: 20, fontSize: "0.82rem", color: "#1E40AF" }}>
              <strong>Como Funciona o Fluxo de Indicação:</strong>
              <ol style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
                <li>O cliente copia o link único no cardápio digital (ex: <code>loja.com.br?ref=CARLOS10</code>).</li>
                <li>O amigo indicado ganha <strong>{fmt(config.friendDiscount)} de desconto</strong> no 1º pedido.</li>
                <li>Assim que o amigo compra, o indicador recebe <strong>{fmt(config.referrerReward)} de recompensa</strong>!</li>
              </ol>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Desconto para o Amigo Indicado (R$)
                </label>
                <input
                  type="number"
                  step="2"
                  placeholder="0"
                  value={config.friendDiscount === 0 ? "" : config.friendDiscount}
                  onChange={e => update("friendDiscount", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Recompensa para quem Indicou (R$)
                </label>
                <input
                  type="number"
                  step="2"
                  placeholder="0"
                  value={config.referrerReward === 0 ? "" : config.referrerReward}
                  onChange={e => update("referrerReward", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo do Amigo (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.referralMinOrder === 0 ? "" : config.referralMinOrder}
                  onChange={e => update("referralMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ANIVERSARIANTES */}
        {activeTab === "birthday" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  🎂 Presente de Aniversário
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Fidelize clientes concedendo mimos e cupons no mês de aniversário.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("birthdayActive", !config.birthdayActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.birthdayActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.birthdayActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.birthdayActive ? "🟢 Presente Habilitado" : "⚪ Desabilitado"}
              </button>
            </div>

            <div style={{ background: "#FDF2F8", border: "1.5px solid #FBCFE8", borderRadius: 14, padding: "14px 16px", marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#DB2777", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Cake size={24} color="#fff" />
              </div>
              <div>
                <strong style={{ fontSize: "0.9rem", color: "#831843", display: "block" }}>
                  Disparo Automático via Chatbot & WhatsApp
                </strong>
                <span style={{ fontSize: "0.78rem", color: "#9D174D" }}>
                  No dia do aniversário do cliente cadastrado, o Chatbot IA envia automaticamente os parabéns com um cupom especial de presente!
                </span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Tipo de Recompensa
                </label>
                <select
                  value={config.birthdayRewardType}
                  onChange={e => update("birthdayRewardType", e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                >
                  <option value="coupon">Cupom de Desconto em R$</option>
                  <option value="double_cashback">Cashback em Dobro no Mês</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Valor do Cupom de Presente (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.birthdayDiscount === 0 ? "" : config.birthdayDiscount}
                  onChange={e => update("birthdayDiscount", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>
                  Pedido Mínimo para Usar (R$)
                </label>
                <input
                  type="number"
                  step="5"
                  placeholder="0"
                  value={config.birthdayMinOrder === 0 ? "" : config.birthdayMinOrder}
                  onChange={e => update("birthdayMinOrder", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, outline: "none" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: NÍVEIS VIP (CLUBE DE MEMBROS) */}
        {activeTab === "vip" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
                  👑 Níveis de Clientes VIP (Clube de Membros por Gasto Mensal)
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
                  Recompense clientes fiéis com medalhas e vantagens baseadas no quanto eles gastam no mês com você.
                </p>
              </div>

              <button
                type="button"
                onClick={() => update("vipActive", !config.vipActive)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  border: "none",
                  background: config.vipActive ? "#DCFCE7" : "#F1F5F9",
                  color: config.vipActive ? "#15803D" : "#64748B",
                  fontWeight: 800,
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                {config.vipActive ? "🟢 Níveis VIP Habilitados" : "⚪ Desabilitado"}
              </button>
            </div>

            {/* Box Didático Explicativo de Como Funciona o Nível VIP */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: "14px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <HelpCircle size={20} color="#7C3AED" />
                <strong style={{ color: "#0F172A", fontSize: "0.92rem" }}>
                  Como funciona a medalha e o cálculo dos Níveis VIP?
                </strong>
              </div>
              <p style={{ fontSize: "0.82rem", color: "#475569", lineHeight: 1.5, margin: "0 0 10px 0" }}>
                O sistema calcula <strong>automaticamente todo dia a soma dos gastos que cada cliente realizou nos últimos 30 dias (último mês)</strong> com a sua loja:
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", fontSize: "0.78rem" }}>
                <div style={{ background: "#FFF7ED", border: "1px solid #FFEDD5", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#C2410C", display: "block", marginBottom: "3px" }}>🥉 Nível Bronze (Iniciante)</strong>
                  <span>Cliente que gastou até <strong>{fmt(config.silverMinSpend)}</strong> no mês. Recebe o cashback padrão da categoria.</span>
                </div>
                <div style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#475569", display: "block", marginBottom: "3px" }}>🥈 Nível Prata (Frequente)</strong>
                  <span>Cliente que somou entre <strong>{fmt(config.silverMinSpend)}</strong> e <strong>{fmt(config.goldMinSpend)}</strong> no mês. Ganha mais cashback!</span>
                </div>
                <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: "10px", padding: "10px" }}>
                  <strong style={{ color: "#92400E", display: "block", marginBottom: "3px" }}>🥇 Nível Ouro / VIP (Top Clientes)</strong>
                  <span>Cliente que superou <strong>{fmt(config.goldMinSpend)}</strong> no mês. Ganha a medalha de Ouro e o maior benefício!</span>
                </div>
              </div>
              <p style={{ fontSize: "0.74rem", color: "#64748B", margin: "10px 0 0 0" }}>
                💡 <em>Vantagem para a sua loja: Estimula o cliente a comprar toda semana para manter a medalha e não perder o cashback VIP!</em>
              </p>
            </div>

            {/* VIP Tiers Config Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {/* Bronze */}
              <div style={{ background: "#FFF7ED", border: "1.5px solid #FFEDD5", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#C2410C", fontSize: "0.9rem", display: "block" }}>🥉 Nível Bronze</strong>
                <span style={{ fontSize: "0.75rem", color: "#64748B", display: "block", marginBottom: 10 }}>
                  Gasto acumulado no mês até {fmt(config.silverMinSpend)}
                </span>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Bronze (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.bronzeCashback === 0 ? "" : config.bronzeCashback}
                  onChange={e => update("bronzeCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>

              {/* Prata */}
              <div style={{ background: "#F1F5F9", border: "1.5px solid #CBD5E1", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#475569", fontSize: "0.9rem", display: "block" }}>🥈 Nível Prata</strong>
                <span style={{ fontSize: "0.75rem", color: "#64748B", display: "block", marginBottom: 6 }}>
                  De {fmt(config.silverMinSpend)} até {fmt(config.goldMinSpend)}/mês
                </span>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Gasto Mínimo Prata (R$)</label>
                  <input
                    type="number"
                    step="10"
                    placeholder="0"
                    value={config.silverMinSpend === 0 ? "" : config.silverMinSpend}
                    onChange={e => update("silverMinSpend", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 700, marginTop: 2 }}
                  />
                </div>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569" }}>Cashback Prata (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.silverCashback === 0 ? "" : config.silverCashback}
                  onChange={e => update("silverCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>

              {/* Ouro */}
              <div style={{ background: "#FEF3C7", border: "1.5px solid #FCD34D", borderRadius: 12, padding: "14px" }}>
                <strong style={{ color: "#92400E", fontSize: "0.9rem", display: "block" }}>🥇 Nível Ouro / VIP</strong>
                <span style={{ fontSize: "0.75rem", color: "#78350F", display: "block", marginBottom: 6 }}>
                  Gasto mensal acima de {fmt(config.goldMinSpend)}
                </span>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#78350F" }}>Gasto Mínimo VIP (R$)</label>
                  <input
                    type="number"
                    step="10"
                    placeholder="0"
                    value={config.goldMinSpend === 0 ? "" : config.goldMinSpend}
                    onChange={e => update("goldMinSpend", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                    style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 700, marginTop: 2 }}
                  />
                </div>
                <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#78350F" }}>Cashback VIP (%)</label>
                <input
                  type="number"
                  step="0.5"
                  placeholder="0"
                  value={config.goldCashback === 0 ? "" : config.goldCashback}
                  onChange={e => update("goldCashback", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)}
                  style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 800, marginTop: 2 }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Action Button Footer */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "13px",
            background: saved ? "#16A34A" : "linear-gradient(135deg, #7C3AED, #6D28D9)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontSize: "0.92rem",
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            transition: "all 0.3s",
            boxShadow: "0 4px 14px rgba(109, 40, 217, 0.25)"
          }}
        >
          {saved ? "✅ Configurações de Fidelidade Salvas!" : saving ? "Salvando..." : "💾 Salvar Programa de Fidelidade"}
        </button>
      </div>
    </div>
  );
}
