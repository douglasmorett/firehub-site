"use client";

import { useState, useEffect } from "react";
import { Check, Loader2, Info, BellRing, Users } from "lucide-react";
import { BALCAO_CONFIG_PADRAO, lerBalcaoConfig, type BalcaoConfig, type CaixaParaPedidosOnline } from "@/lib/balcao-config";
import { AVISO_AO_LIGAR_CAIXA_POR_USUARIO } from "@/lib/caixa-por-usuario-regras";

/**
 * Minha Loja › Balcão, Pager & Caixa.
 *
 * Duas chaves do pager — é obrigatório no balcão? e na mesa? —, a escolha do
 * que fazer com pedido do site e do robô quando o caixa está fechado e o
 * "Cada usuário tem o seu próprio caixa" (lib/caixa-por-usuario-regras.ts).
 * A tela precisa responder sozinha o que acontece ao ligar cada uma — o
 * lojista não tem manual, e "obrigatório" sem dizer ONDE trava deixaria ele
 * descobrir na hora da fila.
 *
 * Grava a cada clique, sem botão Salvar: são dois interruptores, e um botão
 * Salvar só cria a chance de marcar a caixinha, sair da tela e o papel
 * continuar do mesmo jeito.
 */

type Chave = "pagerObrigatorioBalcao" | "pagerObrigatorioMesa";

// Pedido do site e do robô com o caixa fechado (lib/balcao-config.ts). Três
// escolhas, e a primeira é a de sempre — quem nunca abriu a tela fica nela.
const OPCOES_DO_CAIXA: { valor: CaixaParaPedidosOnline; titulo: string; ajuda: string }[] = [
  {
    valor: null,
    titulo: "Aceitar normalmente (como hoje)",
    ajuda: "O pedido entra mesmo com o caixa fechado. Você recebe um aviso no WhatsApp quando a loja começa a vender sem caixa.",
  },
  {
    valor: "travar",
    titulo: "Só aceitar pedidos do site e do robô com o caixa aberto",
    ajuda: "Com o caixa fechado, o site avisa que a loja ainda não abriu o caixa e o robô não fecha o pedido. iFood e outras plataformas continuam entrando.",
  },
  {
    valor: "abrir_sozinho",
    titulo: "Vender mesmo com o caixa fechado (abrir o caixa sozinho)",
    ajuda: "O primeiro pedido do site ou do robô abre o caixa com o troco do último fechamento, e você recebe um aviso no WhatsApp.",
  },
];

const CHAVES: { chave: Chave; titulo: string; ligado: string; desligado: string; ajuda: string }[] = [
  {
    chave: "pagerObrigatorioBalcao",
    titulo: "Exigir pager no Balcão",
    ligado: "SIM — balcão não fecha sem pager",
    desligado: "NÃO — pager é opcional no balcão",
    ajuda: "Ligue se toda venda de balcão entrega um aparelhinho ao cliente. Com isto ligado, o pedido da aba Balcão não é registrado sem o número — nem pelo atendente com pressa.",
  },
  {
    chave: "pagerObrigatorioMesa",
    titulo: "Exigir pager na Mesa",
    ligado: "SIM — mesa não fecha sem pager",
    desligado: "NÃO — pager é opcional na mesa",
    ajuda: "Mesmo comportamento para o pedido lançado na aba Mesa da venda presencial. Com isto ligado, o número da mesa passa a ser opcional: o cliente é chamado pelo pager.",
  },
];

export default function BalcaoConfigManager() {
  const [config, setConfig] = useState<BalcaoConfig>({ ...BALCAO_CONFIG_PADRAO });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<Chave | "caixa" | "caixaPorUsuario" | null>(null);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState(false);
  // O caixa por usuário só o dono troca (api/store-settings/balcao).
  const [souDono, setSouDono] = useState(false);
  // Ligar mostra o aviso ANTES de gravar: muda de quem é o dinheiro de cada gaveta.
  const [confirmarCaixaPorUsuario, setConfirmarCaixaPorUsuario] = useState(false);

  useEffect(() => {
    fetch("/api/store-settings/balcao")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setConfig(lerBalcaoConfig(d)); setSouDono(d.souDono === true); } })
      .catch(() => { /* fica no padrão: nada obrigatório */ })
      .finally(() => setCarregando(false));
  }, []);

  const alternar = (chave: Chave) => salvar({ ...config, [chave]: !config[chave] }, chave);

  const salvar = async (novo: BalcaoConfig, chave: Chave | "caixa" | "caixaPorUsuario") => {
    // A tela vira ANTES da resposta e volta atrás se o servidor recusar: são
    // dois interruptores, e esperar a rede em cada clique faz a chave parecer
    // travada.
    const anterior = config;
    setConfig(novo);
    setSalvando(chave);
    setErro("");
    setSalvo(false);
    try {
      const res = await fetch("/api/store-settings/balcao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novo),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        setConfig(anterior);
        setErro(e?.error || "Não consegui salvar. Tente de novo.");
      } else {
        setSalvo(true);
        setTimeout(() => setSalvo(false), 2500);
      }
    } catch {
      setConfig(anterior);
      setErro("Sem conexão com o servidor. A marcação não foi salva.");
    } finally {
      setSalvando(null);
    }
  };

  if (carregando) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2rem", color: "#64748B", fontSize: "0.9rem" }}>
        <Loader2 className="animate-spin" size={18} /> Carregando…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "#FFF7E6", borderRadius: 16, padding: "1rem 1.25rem", border: "1px solid #FDE68A", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <BellRing size={20} color="#B45309" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "0.85rem", color: "#92400E", lineHeight: 1.55 }}>
          <b>O pager é o aparelhinho numerado</b> que a loja entrega a quem espera o pedido. O número digitado na venda aparece no card do painel e sai na comanda impressa, para o atendente saber quem chamar quando o pedido fica pronto.
        </div>
      </div>

      {CHAVES.map(({ chave, titulo, ligado, desligado, ajuda }) => {
        const marcado = config[chave];
        return (
          <div key={chave} style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.25rem 1.5rem", border: `1px solid ${marcado ? "#FDE68A" : "#E2E8F0"}`, boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>{titulo}</h3>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 }}>{ajuda}</p>
            </div>
            <button
              type="button"
              onClick={() => alternar(chave)}
              disabled={salvando !== null}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 16px", borderRadius: 30, border: "none",
                background: marcado ? "#B45309" : "#64748B", color: "#FFFFFF",
                fontWeight: 800, fontSize: "0.84rem",
                cursor: salvando !== null ? "wait" : "pointer",
                boxShadow: marcado ? "0 4px 12px rgba(180,83,9,0.25)" : "none",
                transition: "all 0.2s ease", whiteSpace: "nowrap",
              }}
            >
              {salvando === chave
                ? <Loader2 className="animate-spin" size={18} />
                : marcado ? <><Check size={18} /> {ligado}</> : <>{desligado}</>}
            </button>
          </div>
        );
      })}

      <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "1rem 1.25rem", border: "1px solid #E2E8F0", display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Info size={18} color="#64748B" style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.55 }}>
          Desligado, o campo do pager continua existindo na venda presencial e é opcional — que é como está hoje. A regra vale no lançamento do PDV (<b>Venda Presencial</b>), abas Balcão e Mesa. A mesa aberta pelo garçom no app de Mesas não pede pager.
        </div>
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.25rem 1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>Pedidos do site e do robô com o caixa fechado</h3>
        <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 }}>
          O balcão já não vende sem caixa. Aqui você decide o que acontece com o pedido que chega pelo site ou pelo robô do WhatsApp antes de alguém abrir o caixa.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {OPCOES_DO_CAIXA.map(({ valor, titulo, ajuda }) => {
            const marcado = config.caixaParaPedidosOnline === valor;
            return (
              <label key={String(valor)} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "0.75rem 1rem", borderRadius: 12, border: `1px solid ${marcado ? "#FDE68A" : "#E2E8F0"}`, background: marcado ? "#FFFBEB" : "#FFFFFF", cursor: salvando !== null ? "wait" : "pointer" }}>
                <input
                  type="radio"
                  name="caixaParaPedidosOnline"
                  checked={marcado}
                  disabled={salvando !== null}
                  onChange={() => salvar({ ...config, caixaParaPedidosOnline: valor }, "caixa")}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <b style={{ fontSize: "0.9rem", color: "#0F172A" }}>{titulo}</b>
                  <span style={{ display: "block", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.5 }}>{ajuda}</span>
                </span>
              </label>
            );
          })}
        </div>
        {salvando === "caixa" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: "#64748B", fontSize: "0.8rem" }}>
            <Loader2 className="animate-spin" size={14} /> Salvando…
          </div>
        )}
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "1.25rem 1.5rem", border: `1px solid ${config.caixaPorUsuario ? "#FDE68A" : "#E2E8F0"}`, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1rem", fontWeight: 800, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={18} color="#B45309" /> Cada usuário tem o seu próprio caixa
            </h3>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 }}>
              Desligado, a loja tem um caixa só, para todos os logins (como hoje). Ligado, cada login (você e cada pessoa da equipe) abre, movimenta e fecha o seu próprio caixa, e as vendas que cada um lança caem no caixa dele.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (config.caixaPorUsuario) salvar({ ...config, caixaPorUsuario: false }, "caixaPorUsuario");
              else setConfirmarCaixaPorUsuario(true);
            }}
            disabled={salvando !== null || !souDono}
            title={souDono ? undefined : "Só o login do dono da loja muda esta opção."}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 16px", borderRadius: 30, border: "none",
              background: config.caixaPorUsuario ? "#B45309" : "#64748B", color: "#FFFFFF",
              fontWeight: 800, fontSize: "0.84rem",
              cursor: !souDono ? "not-allowed" : salvando !== null ? "wait" : "pointer",
              opacity: souDono ? 1 : 0.6,
              whiteSpace: "nowrap",
            }}
          >
            {salvando === "caixaPorUsuario"
              ? <Loader2 className="animate-spin" size={18} />
              : config.caixaPorUsuario ? <><Check size={18} /> SIM — cada um com o seu caixa</> : <>NÃO — um caixa para a loja</>}
          </button>
        </div>
        {!souDono && (
          <p style={{ margin: "10px 0 0", fontSize: "0.78rem", color: "#92400E" }}>Só o login do dono da loja liga ou desliga esta opção.</p>
        )}
        {confirmarCaixaPorUsuario && (
          <div style={{ marginTop: 12, background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 12, padding: "0.9rem 1rem" }}>
            <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.9rem", marginBottom: 6 }}>⚠️ Antes de ligar, leia:</div>
            <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "#92400E", lineHeight: 1.55 }}>{AVISO_AO_LIGAR_CAIXA_POR_USUARIO}</p>
            <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#92400E", lineHeight: 1.5 }}>
              Para ligar, todos os caixas precisam estar fechados. Você vê os caixas de todos em <b>Caixa › Histórico de caixas</b>.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setConfirmarCaixaPorUsuario(false); salvar({ ...config, caixaPorUsuario: true }, "caixaPorUsuario"); }}
                style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#B45309", color: "#FFFFFF", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer" }}
              >
                Entendi, ligar
              </button>
              <button
                type="button"
                onClick={() => setConfirmarCaixaPorUsuario(false)}
                style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #E2E8F0", background: "#FFFFFF", color: "#334155", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {config.caixaPorUsuario && (
          <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
            Os caixas de cada um — abertos agora e já fechados — ficam em{" "}
            <a href="/store/caixa/historico" style={{ color: "#B45309", fontWeight: 700 }}>Caixa › Histórico de caixas</a>.
          </p>
        )}
      </div>

      {erro && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B71C1C", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.85rem", fontWeight: 700 }}>
          ❌ {erro}
        </div>
      )}
      {salvo && !erro && (
        <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", color: "#0F766E", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.85rem", fontWeight: 700 }}>
          ✓ Salvo. Vale no próximo pedido lançado.
        </div>
      )}
    </div>
  );
}
