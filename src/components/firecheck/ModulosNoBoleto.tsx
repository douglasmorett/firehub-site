"use client";

/**
 * Checklist e Controle de ponto do FireCheck ligados aqui e cobrados no boleto
 * da mensalidade (api/store/firecheck/modulos). Douglas, 28/10/2026: "o cara
 * só ativar e ser cobrado no pagamento do mês dele". O liga/desliga e o quadro
 * da cobrança são os de todo módulo pago (components/modulos/).
 *
 * Sem FireCheck conectado, ligar já cria a conta, com o e-mail da loja e a
 * senha do FireHub (lib/firecheck-modulos/mesma-conta.ts): "deveria ser só
 * ativar mesmo" (Douglas, 30/10/2026). "Abrir o FireCheck" entra direto, sem
 * senha. Quem já tem FireCheck com este e-mail conecta uma vez no quadro acima.
 */
import { useEffect, useState } from "react";
import { ClipboardCheck, Clock, ExternalLink, Loader2 } from "lucide-react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { NOME_DO_MODULO, type ModuloDoFirecheck } from "@/lib/firecheck-modulos/preco";
import { CLAUSULAS_DO_TERMO_DO_FIRECHECK, TITULO_DO_TERMO_DO_FIRECHECK, VERSAO_DO_TERMO_DO_FIRECHECK } from "@/lib/firecheck-modulos/termo";

type EstadoDoModulo = { ativo: boolean; emTeste: boolean; testeAte: string | null; isento: boolean; jaTestou: boolean; desligaEm: string | null; fimDoMes: string | null; preco: number };
type Dados = {
  estado: { isento: boolean; modulos: Record<ModuloDoFirecheck, EstadoDoModulo>; valorEsteMes: number };
  conectado: { storeName: string; email: string; mesmoLogin: boolean } | null;
  podeContratar: boolean;
  precos: { porModulo: Record<ModuloDoFirecheck, number>; combo: number; diasDeTeste: number };
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MODULOS: { id: ModuloDoFirecheck; titulo: string; texto: string; icone: React.ReactNode }[] = [
  { id: "checklists", titulo: "Checklist", texto: "Checklists ilimitados com foto na hora, auditoria por IA e alerta no WhatsApp. Até 30 colaboradores.", icone: <ClipboardCheck size={20} /> },
  { id: "ponto", titulo: "Controle de ponto", texto: "Ponto com reconhecimento facial e GPS, banco de horas e espelho para o contador. Até 30 colaboradores.", icone: <Clock size={20} /> },
];

export default function ModulosNoBoleto({ onConectou }: { onConectou: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [salvando, setSalvando] = useState<ModuloDoFirecheck | "abrir" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [termoDe, setTermoDe] = useState<ModuloDoFirecheck | null>(null);

  const carregar = () =>
    fetch("/api/store/firecheck/modulos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDados(d))
      .catch(() => null);

  useEffect(() => { carregar(); }, []);

  async function enviar(corpo: Record<string, unknown>, quem: ModuloDoFirecheck | "abrir") {
    setErro(null);
    setSalvando(quem);
    try {
      const r = await fetch("/api/store/firecheck/modulos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não deu para salvar. Tente de novo."); return null; }
      return j;
    } catch {
      setErro("Sem conexão. Tente de novo.");
      return null;
    } finally {
      setSalvando(null);
    }
  }

  // A aba abre já no clique (senão o navegador barra a janela que abre depois
  // da espera) e vai para o FireCheck quando o link chega.
  async function abrirFirecheck() {
    const aba = window.open("", "_blank");
    const j = await enviar({ acao: "abrir" }, "abrir");
    if (!j?.url) { aba?.close(); return; }
    if (aba) { aba.opener = null; aba.location.href = j.url; } else window.location.href = j.url;
    if (!dados?.conectado) onConectou();
  }

  async function ligar(modulo: ModuloDoFirecheck, comTermo: boolean) {
    const j = await enviar(comTermo ? { modulo, ligar: true, aceite: { versao: VERSAO_DO_TERMO_DO_FIRECHECK } } : { modulo, ligar: true }, modulo);
    // Recusou (ex.: já paga pela Cakto): o termo fecha para o aviso aparecer.
    setTermoDe(null);
    if (!j) return;
    // Ligou sem FireCheck: a conta acabou de nascer, e o quadro de conexão acima também muda.
    if (!dados?.conectado) onConectou();
    else await carregar();
  }

  async function desligar(modulo: ModuloDoFirecheck) {
    if (await enviar({ modulo, ligar: false }, modulo)) await carregar();
  }

  if (!dados) return null;
  const { estado, precos, conectado } = dados;
  const doisLigados = estado.modulos.checklists.ativo && estado.modulos.ponto.ativo;
  const algumLigado = estado.modulos.checklists.ativo || estado.modulos.ponto.ativo;

  const caixa: React.CSSProperties = { background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "18px 20px", marginBottom: "1.5rem", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" };

  return (
    <div id="planos-firecheck" style={{ scrollMarginTop: 40, marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>Ligue e pague no boleto do FireHub</h2>
      <p style={{ fontSize: "0.92rem", color: "#475569", margin: "0 0 16px", lineHeight: 1.55 }}>
        Cada módulo custa <b>{reais(precos.porModulo.checklists)} por mês</b>. Os dois ligados saem por <b>{reais(precos.combo)}</b> (até 50 colaboradores).
        A primeira vez de cada um tem <b>{precos.diasDeTeste} dias grátis</b>. A cobrança vem na mensalidade do FireHub, numa linha própria, sem cartão.
        {estado.isento && <> <b>Sua conta não é cobrada.</b></>}
      </p>

      {dados.podeContratar && (conectado || algumLigado) && (
        <div style={{ ...caixa, background: "#F0FDF4", border: "1px solid #BBF7D0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.9rem", color: "#1E293B", lineHeight: 1.55, flex: "1 1 260px" }}>
            <div style={{ fontWeight: 900, color: "#14532D", marginBottom: 2 }}>Sua conta do FireCheck</div>
            {conectado && !conectado.mesmoLogin
              ? <>No app e no site do FireCheck, entre com <b>{conectado.email}</b> e a senha do FireCheck.</>
              : <>No app e no site do FireCheck, entre com <b>o mesmo e-mail e a mesma senha do FireHub</b>{conectado ? <> ({conectado.email})</> : null}. Daqui, o botão entra direto.</>}
          </div>
          <button onClick={abrirFirecheck} disabled={salvando === "abrir"}
            style={{ background: "#FF4D00", color: "#FFF", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {salvando === "abrir" ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />} Abrir o FireCheck
          </button>
        </div>
      )}

      {erro && <div role="alert" style={{ ...caixa, background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontWeight: 600, fontSize: "0.9rem" }}>{erro}</div>}

      {MODULOS.map((m) => (
        <div key={m.id} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: "#FFF4EF", color: "#E8590C", display: "grid", placeItems: "center" }}>{m.icone}</span>
            <div>
              <div style={{ fontWeight: 800, color: "#0F172A" }}>{m.titulo}</div>
              <div style={{ fontSize: "0.82rem", color: "#64748B" }}>{m.texto}</div>
            </div>
          </div>
          {dados.podeContratar ? (
            <InterruptorDoModulo nome={NOME_DO_MODULO[m.id]} preco={estado.modulos[m.id].preco} estado={estado.modulos[m.id]} salvando={salvando === m.id}
              onLigar={() => { setErro(null); setTermoDe(m.id); }}
              onDesligar={() => desligar(m.id)}
              onContinuar={() => ligar(m.id, false)} />
          ) : (
            <p style={{ fontSize: "0.85rem", color: "#64748B" }}>{estado.modulos[m.id].ativo ? "Ligado." : "Desligado."} Ligar e desligar é com o dono da loja.</p>
          )}
        </div>
      ))}

      {doisLigados && !estado.isento && (
        <p style={{ fontSize: "0.88rem", color: "#0F766E", fontWeight: 700, margin: "6px 0 0" }}>
          Os dois ligados: no mês em que os dois forem cobrados, o boleto traz {reais(precos.combo)} pelos dois, não {reais(precos.porModulo.checklists + precos.porModulo.ponto)}.
        </p>
      )}

      {termoDe && (
        <Termo modulo={termoDe} preco={estado.modulos[termoDe].preco} combo={precos.combo} diasDeTeste={precos.diasDeTeste}
          comTeste={!estado.modulos[termoDe].jaTestou} salvando={salvando === termoDe}
          onCancelar={() => setTermoDe(null)} onAceitar={() => ligar(termoDe, true)} />
      )}
    </div>
  );
}

function Termo({ modulo, preco, combo, diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  modulo: ModuloDoFirecheck; preco: number; combo: number; diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  const nome = NOME_DO_MODULO[modulo].replace(/^o\s+/, "");
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_FIRECHECK}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10060, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "#FFF", borderRadius: 18, width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", paddingBottom: 18, boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: "#0F172A" }}>{TITULO_DO_TERMO_DO_FIRECHECK}</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>Ligar: {nome} · {reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DO_FIRECHECK.split("-").reverse().join("/")}</div>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: "14px 20px 0", paddingLeft: 20, fontSize: 13.5, color: "#334155", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {CLAUSULAS_DO_TERMO_DO_FIRECHECK.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 20px 0", fontSize: 14, color: "#0F172A", fontWeight: 600, lineHeight: 1.45 }}>
          <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} style={{ marginTop: 3 }} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês ({reais(combo)} com os dois módulos) no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", margin: "16px 20px 0" }}>
          <button onClick={onCancelar} disabled={salvando} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Agora não</button>
          <button onClick={onAceitar} disabled={!concordo || salvando} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: 0, background: concordo ? "#16A34A" : "#94A3B8", color: "#fff", fontWeight: 800, cursor: concordo ? "pointer" : "default" }}>{salvando ? "Ligando…" : "Concordo e ligar"}</button>
        </div>
      </div>
    </div>
  );
}
