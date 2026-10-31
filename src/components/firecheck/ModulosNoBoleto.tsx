"use client";

/**
 * Checklist e Controle de ponto do FireCheck ligados aqui e cobrados no boleto
 * da mensalidade (api/store/firecheck/modulos). Douglas, 28/10/2026: "o cara
 * só ativar e ser cobrado no pagamento do mês dele". O liga/desliga e o quadro
 * da cobrança são os de todo módulo pago (components/modulos/).
 *
 * As três caixas (Só Checklist, os dois, Só Ponto) são os planos da landing do
 * FireCheck (Douglas, 31/10/2026: "tem que ter aquelas três caixinhas"). Sem
 * FireCheck conectado, o "concordo" do termo já cria a conta (a senha aparece
 * uma vez) antes de ligar; quem já tem conta conecta no quadro do fim da página.
 */
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { NOME_DO_MODULO, type ModuloDoFirecheck } from "@/lib/firecheck-modulos/preco";
import { CLAUSULAS_DO_TERMO_DO_FIRECHECK, TITULO_DO_TERMO_DO_FIRECHECK, VERSAO_DO_TERMO_DO_FIRECHECK } from "@/lib/firecheck-modulos/termo";

type EstadoDoModulo = { ativo: boolean; emTeste: boolean; testeAte: string | null; isento: boolean; jaTestou: boolean; desligaEm: string | null; fimDoMes: string | null; preco: number };
type Dados = {
  estado: { isento: boolean; modulos: Record<ModuloDoFirecheck, EstadoDoModulo>; valorEsteMes: number };
  conectado: { storeName: string; email: string } | null;
  podeContratar: boolean;
  precos: { porModulo: Record<ModuloDoFirecheck, number>; combo: number; diasDeTeste: number };
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Plano = { id: string; titulo: string; alvos: ModuloDoFirecheck[]; destaque?: string; itens: string[] };
const PLANOS: Plano[] = [
  {
    id: "checklists", titulo: "Só Checklist", alvos: ["checklists"],
    itens: ["Checklists ilimitados", "Até 30 pessoas na equipe", "IA monta e confere as fotos", "Estoque, compras, frota, descarte e ranking", "Avisos no WhatsApp da sua loja"],
  },
  {
    id: "combo", titulo: "Checklist + Ponto", alvos: ["checklists", "ponto"], destaque: "MAIS COMPLETO",
    itens: ["Tudo do Só Checklist", "Ponto com reconhecimento facial e GPS", "Até 50 pessoas na equipe", "Resumo do ponto todo dia no WhatsApp"],
  },
  {
    id: "ponto", titulo: "Só Ponto", alvos: ["ponto"],
    itens: ["Até 30 pessoas na equipe", "Reconhecimento facial e GPS", "Aviso de atraso e ausência no WhatsApp", "Banco de horas e espelho para o contador"],
  },
];

export default function ModulosNoBoleto({ onConectou }: { onConectou: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [salvando, setSalvando] = useState<ModuloDoFirecheck | "conta" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [termoDe, setTermoDe] = useState<Plano | null>(null);
  const [contaNova, setContaNova] = useState<{ email: string; senha: string } | null>(null);

  const carregar = () =>
    fetch("/api/store/firecheck/modulos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDados(d))
      .catch(() => null);

  useEffect(() => { carregar(); }, []);

  async function enviar(corpo: Record<string, unknown>, quem: ModuloDoFirecheck | "conta") {
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

  // O "concordo" do termo: cria a conta se a loja ainda não tem FireCheck e liga
  // os módulos do plano que estão desligados.
  async function ligarPlano(plano: Plano) {
    if (!dados) return;
    if (!dados.conectado) {
      const j = await enviar({ acao: "criar-conta" }, "conta");
      if (!j?.conta) { setTermoDe(null); return; }
      setContaNova({ email: j.conta.email, senha: j.conta.senha });
      onConectou();
    }
    for (const modulo of plano.alvos.filter((m) => !dados.estado.modulos[m].ativo)) {
      // Recusou (ex.: já paga pela Cakto): para aqui e o aviso aparece.
      if (!(await enviar({ modulo, ligar: true, aceite: { versao: VERSAO_DO_TERMO_DO_FIRECHECK } }, modulo))) break;
    }
    setTermoDe(null);
    await carregar();
  }

  async function religar(modulo: ModuloDoFirecheck) {
    if (await enviar({ modulo, ligar: true }, modulo)) await carregar();
  }

  async function desligar(modulo: ModuloDoFirecheck) {
    if (await enviar({ modulo, ligar: false }, modulo)) await carregar();
  }

  if (!dados) return null;
  const { estado, precos, conectado } = dados;
  const doisLigados = estado.modulos.checklists.ativo && estado.modulos.ponto.ativo;
  const ligados = (["checklists", "ponto"] as ModuloDoFirecheck[]).filter((m) => estado.modulos[m].ativo);
  const precoDo = (p: Plano) => (p.alvos.length === 2 ? precos.combo : precos.porModulo[p.alvos[0]]);
  // Os que este plano ainda liga, e se todos eles têm o teste grátis.
  const faltam = (p: Plano) => p.alvos.filter((m) => !estado.modulos[m].ativo);
  const comTeste = (p: Plano) => faltam(p).every((m) => !estado.modulos[m].jaTestou);

  const caixa: React.CSSProperties = { background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "18px 20px", marginBottom: "1.5rem", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" };

  return (
    <div id="planos-firecheck" style={{ scrollMarginTop: 40, marginBottom: "2.5rem" }}>
      <h2 style={{ fontSize: "clamp(1.3rem, 3vw, 1.6rem)", fontWeight: 900, color: "#0F172A", margin: "0 0 6px", letterSpacing: "-0.3px" }}>
        Escolha o plano. <span style={{ color: "#FF4D00" }}>{precos.diasDeTeste} dias grátis.</span>
      </h2>
      <p style={{ fontSize: "0.95rem", color: "#475569", margin: "0 0 18px", lineHeight: 1.55 }}>
        Cobrado no boleto da mensalidade do FireHub, numa linha própria. Sem cartão. Desligou durante o teste, não paga nada.
        {estado.isento && <> <b>Sua conta não é cobrada.</b></>}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "1rem", alignItems: "stretch" }}>
        {PLANOS.map((p) => {
          const ligado = faltam(p).length === 0;
          const teste = comTeste(p);
          const destaque = !!p.destaque;
          return (
            <div key={p.id} style={{ position: "relative", display: "flex", flexDirection: "column", background: destaque ? "#0F172A" : "#FFF", color: destaque ? "#FFF" : "#0F172A", border: destaque ? "2px solid #FF4D00" : "1px solid #E2E8F0", borderRadius: 18, padding: "22px 20px 20px", boxShadow: destaque ? "0 18px 40px rgba(255,77,0,0.18)" : "0 4px 6px rgba(0,0,0,0.02)" }}>
              {p.destaque && (
                <span style={{ position: "absolute", top: -12, left: 20, background: "#FF4D00", color: "#FFF", fontSize: "0.72rem", fontWeight: 900, padding: "4px 12px", borderRadius: 999, letterSpacing: "0.4px" }}>{p.destaque}</span>
              )}
              <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>{p.titulo}</div>
              <div style={{ margin: "10px 0 2px", display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: "2.1rem", fontWeight: 900, letterSpacing: "-1px" }}>{reais(precoDo(p))}</span>
                <span style={{ fontSize: "0.85rem", color: destaque ? "#94A3B8" : "#64748B" }}>/mês</span>
              </div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: destaque ? "#FF7A38" : "#64748B", marginBottom: 14 }}>
                {p.alvos.length === 2 ? `Economize ${reais(precos.porModulo.checklists + precos.porModulo.ponto - precos.combo)} por mês` : "Sem fidelidade"}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px", display: "grid", gap: 8, flex: 1 }}>
                {p.itens.map((i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: "0.88rem", lineHeight: 1.4, color: destaque ? "#E2E8F0" : "#334155" }}>
                    <Check size={16} color="#16A34A" style={{ flexShrink: 0, marginTop: 2 }} /> {i}
                  </li>
                ))}
              </ul>
              {ligado ? (
                <div style={{ height: 46, borderRadius: 12, background: "#DCFCE7", color: "#166534", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Check size={18} /> Ligado
                </div>
              ) : dados.podeContratar ? (
                <>
                  <button onClick={() => { setErro(null); setTermoDe(p); }} disabled={salvando !== null}
                    style={{ height: 46, borderRadius: 12, border: "none", background: "#FF4D00", color: "#FFF", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer", boxShadow: "0 8px 18px rgba(255,77,0,0.3)" }}>
                    {teste ? `Começar ${precos.diasDeTeste} dias grátis` : "Ligar agora"}
                  </button>
                  <div style={{ fontSize: "0.76rem", color: destaque ? "#94A3B8" : "#64748B", textAlign: "center", marginTop: 8, lineHeight: 1.4 }}>
                    {teste ? "Sem cartão. Desligou no teste, não paga nada." : "O teste grátis já foi usado: o mês entra inteiro no boleto."}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "0.85rem", color: destaque ? "#94A3B8" : "#64748B", textAlign: "center" }}>Quem liga é o dono da loja.</div>
              )}
            </div>
          );
        })}
      </div>

      {!conectado && dados.podeContratar && (
        <p style={{ fontSize: "0.85rem", color: "#64748B", margin: "12px 0 0", lineHeight: 1.5 }}>
          Ainda não tem FireCheck? A conta é criada na hora em que você liga, já conectada a esta loja. Já tem? Conecte com o e-mail e a senha dele no quadro do fim da página.
        </p>
      )}

      {erro && <div role="alert" style={{ ...caixa, marginTop: 14, background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontWeight: 600, fontSize: "0.9rem" }}>{erro}</div>}

      {contaNova && (
        <div style={{ ...caixa, marginTop: 14, background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
          <div style={{ fontWeight: 900, color: "#14532D", marginBottom: 6 }}>Conta do FireCheck criada</div>
          <div style={{ fontSize: "0.92rem", color: "#1E293B", lineHeight: 1.7 }}>
            Entre em <b>firecheckapp.com.br</b> com:<br />
            E-mail: <b>{contaNova.email}</b><br />
            Senha: <b style={{ fontFamily: "monospace", fontSize: "1.05rem", background: "#FFF", padding: "2px 8px", borderRadius: 6, border: "1px solid #BBF7D0" }}>{contaNova.senha}</b>
          </div>
          <div style={{ fontSize: "0.82rem", color: "#92400E", marginTop: 8 }}>Anote agora: esta senha não aparece de novo. Você pode trocá-la depois, dentro do FireCheck.</div>
        </div>
      )}

      {ligados.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 900, color: "#0F172A", fontSize: "1.05rem" }}>Seus módulos</div>
          {ligados.map((m) => (
            <InterruptorDoModulo key={m} nome={NOME_DO_MODULO[m]} preco={estado.modulos[m].preco} estado={estado.modulos[m]} salvando={salvando === m}
              onLigar={() => setTermoDe(PLANOS.find((p) => p.id === m)!)}
              onDesligar={() => desligar(m)}
              onContinuar={() => religar(m)} />
          ))}
          {doisLigados && !estado.isento && (
            <p style={{ fontSize: "0.88rem", color: "#0F766E", fontWeight: 700, margin: "6px 0 0" }}>
              Os dois ligados: no mês em que os dois forem cobrados, o boleto traz {reais(precos.combo)} pelos dois, não {reais(precos.porModulo.checklists + precos.porModulo.ponto)}.
            </p>
          )}
        </div>
      )}

      {termoDe && (
        <Termo plano={termoDe} modulos={faltam(termoDe)} preco={precoDo(termoDe)} combo={precos.combo} diasDeTeste={precos.diasDeTeste}
          comTeste={comTeste(termoDe)} criaConta={!conectado} salvando={salvando !== null}
          onCancelar={() => setTermoDe(null)} onAceitar={() => ligarPlano(termoDe)} />
      )}
    </div>
  );
}

function Termo({ plano, modulos, preco, combo, diasDeTeste, comTeste, criaConta, salvando, onCancelar, onAceitar }: {
  plano: Plano; modulos: ModuloDoFirecheck[]; preco: number; combo: number; diasDeTeste: number; comTeste: boolean; criaConta: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  const nomes = modulos.map((m) => NOME_DO_MODULO[m].replace(/^o\s+/, "")).join(" + ");
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_FIRECHECK}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10060, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "#FFF", borderRadius: 18, width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", paddingBottom: 18, boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ padding: "18px 20px 0" }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: "#0F172A" }}>{TITULO_DO_TERMO_DO_FIRECHECK}</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>Ligar: {nomes} · {plano.titulo} por {reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DO_FIRECHECK.split("-").reverse().join("/")}</div>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        {criaConta && (
          <div style={{ margin: "10px 20px 0", fontSize: 13.5, color: "#334155", lineHeight: 1.5 }}>
            Esta loja ainda não tem FireCheck: ao concordar, a conta é criada já conectada a ela, e a senha aparece na tela uma vez.
          </div>
        )}
        <ol style={{ margin: "14px 20px 0", paddingLeft: 20, fontSize: 13.5, color: "#334155", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {CLAUSULAS_DO_TERMO_DO_FIRECHECK.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 20px 0", fontSize: 14, color: "#0F172A", fontWeight: 600, lineHeight: 1.45 }}>
          <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} style={{ marginTop: 3 }} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês ({reais(combo)} com os dois módulos) no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", margin: "16px 20px 0" }}>
          <button onClick={onCancelar} disabled={salvando} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" }}>Agora não</button>
          <button onClick={onAceitar} disabled={!concordo || salvando} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: 0, background: concordo ? "#16A34A" : "#94A3B8", color: "#fff", fontWeight: 800, cursor: concordo ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {salvando && <Loader2 size={16} className="animate-spin" />}{salvando ? "Ligando…" : "Concordo e ligar"}
          </button>
        </div>
      </div>
    </div>
  );
}
