"use client";

/**
 * Bill, seu assessor — a tela do dono. Não se chama "Meu Assessor": essa marca
 * é da Tittanium (Felipe Titto) no INPI, processos 939197650 (classe 9) e
 * 939133610 (classe 42). "Bill" é o mesmo assistente do FireCheck.
 *
 * Desligado: a oferta (o que faz, exemplos, R$ 49,90/mês) e, ao ligar, o
 * termo de contratação (lib/assessor/termo.ts) — só liga com o "concordo".
 * Ligado: de quais números falar, a conversa de teste (texto, áudio gravado
 * no navegador e foto — o mesmo assessor do WhatsApp, gravando de verdade) e
 * o histórico do que ele lançou.
 */

import { useCallback, useEffect, useState } from "react";
import ConversaComOBill, { AVATAR_DO_BILL } from "@/components/bill/ConversaComOBill";
import { EVENTO_BILL_LIGADO } from "@/components/bill/BillFlutuante";
import { VERSAO_DO_TERMO_DO_BILL, TITULO_DO_TERMO_DO_BILL, CLAUSULAS_DO_TERMO_DO_BILL } from "@/lib/assessor/termo";
import { Mic, Camera, Package, Wallet, Receipt, Undo2, CheckCircle2, MessageCircle, PauseCircle, Store } from "lucide-react";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento?: boolean };
type Registro = { id: string; tipo: string; resumo: string; canal: string; desfeitoEm: string | null; criadoEm: string };
type Dados = { estado: Estado; preco: number; diasDeTeste: number; numerosDoDono: string[]; numeroDoRobo: string | null; registros: Registro[] };
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

const VERDE = "#059669";
const fmtR = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fone = (d: string) => {
  const n = d.replace(/^55/, "");
  return n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : d;
};
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const ROTULO: Record<string, { texto: string; cor: string }> = {
  COMPRA: { texto: "Compra", cor: "#2563EB" },
  SAIDA: { texto: "Saída", cor: "#D97706" },
  DESPESA: { texto: "Despesa", cor: "#DC2626" },
  CONTA: { texto: "Conta a pagar", cor: "#7C3AED" },
  CONTA_PAGA: { texto: "Conta paga", cor: VERDE },
  PAUSADO: { texto: "Pausado", cor: "#B45309" },
  REATIVADO: { texto: "Reativado", cor: "#0891B2" },
  SITE: { texto: "Site", cor: "#475569" },
};

export default function BillClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/assessor", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function ligar(ligar: boolean) {
    setSalvando(true);
    setConfirmarDesligar(false);
    try {
      const r = await fetch("/api/store/assessor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DO_BILL } } : { ligar }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      setAviso(ligar
        ? { tipo: "ok", titulo: "Bill ligado!", detalhe: "Mande um áudio do seu WhatsApp para o número da loja e veja a mágica." }
        : { tipo: "ok", titulo: "Bill desligado.", detalhe: "O mês que vem não é cobrado. Se este mês já passou dos dias grátis, ele continua no boleto." });
      setTermoAberto(false);
      // A carinha do Bill no canto aparece (ou some) sem atualizar a página.
      window.dispatchEvent(new CustomEvent(EVENTO_BILL_LIGADO, { detail: ligar }));
      await carregar();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;

  const { estado } = dados;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px" }}>
      {aviso && (
        <div role="status" onClick={() => setAviso(null)} style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          width: "min(440px, calc(100vw - 24px))", background: aviso.tipo === "ok" ? "#ECFDF5" : "#FEF2F2",
          borderLeft: `4px solid ${aviso.tipo === "ok" ? VERDE : "#DC2626"}`, borderRadius: 12, padding: "12px 14px",
          boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
        }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
          {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <img src={AVATAR_DO_BILL} alt="" width={44} height={44} style={{ borderRadius: 999, border: "2px solid #22D3EE" }} />
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", margin: 0 }}>Bill, seu assessor</h1>
        {estado.ativo && (
          <span style={{ fontSize: 12, fontWeight: 800, color: VERDE, background: "#ECFDF5", padding: "4px 10px", borderRadius: 999 }}>
            {estado.isento ? "LIGADO · ISENTO" : estado.emTeste && estado.testeAte ? `GRÁTIS até ${new Date(estado.testeAte).toLocaleDateString("pt-BR")}` : "LIGADO"}
          </span>
        )}
      </div>
      <p style={{ color: "#475569", margin: "0 0 20px", fontSize: 15 }}>
        Eu sou o Bill: cuido do seu estoque, do seu financeiro e do seu cardápio pelo WhatsApp. Mande um áudio, um texto ou a foto da nota — eu lanço no sistema na hora.
      </p>

      {termoAberto && <Termo preco={dados.preco} salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />}

      {!estado.ativo ? <Oferta dados={dados} salvando={salvando} onLigar={() => setTermoAberto(true)} /> : (
        <>
          <ComoUsar dados={dados} />
          <div style={{ border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden", marginBottom: 22 }}>
            <div style={{ background: "#0B1220", color: "white", padding: "10px 14px", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <img src={AVATAR_DO_BILL} alt="" width={30} height={30} style={{ borderRadius: 999, border: "1.5px solid #22D3EE" }} />
              Converse com o Bill — a mesma conversa do WhatsApp (lança de verdade)
            </div>
            <ConversaComOBill altura={420} aoGravar={carregar} />
          </div>
          <Historico registros={dados.registros} />
          <div style={{ marginTop: 28, padding: 16, border: "1px solid #E2E8F0", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "#475569" }}>
              {estado.isento
                ? <><b>Conta isenta:</b> o Bill fica sempre ligado nesta loja e não entra no boleto.</>
                : estado.emTeste && estado.testeAte
                ? <>Grátis até <b>{new Date(estado.testeAte).toLocaleDateString("pt-BR")}</b>. Depois, <b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub (o mês em que fica ativo é cobrado inteiro).</>
                : <><b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub — o mês em que o Bill fica ativo é cobrado inteiro.{estado.cobradoEsteMes && <> Este mês já está no boleto.</>}</>}
              {!estado.isento && <>{" "}Desligando, o mês seguinte não é cobrado.</>}
            </div>
            {!estado.isento && <button disabled={salvando} onClick={() => { if (confirmarDesligar) ligar(false); else setConfirmarDesligar(true); }}
              onBlur={() => setConfirmarDesligar(false)}
              style={{ background: confirmarDesligar ? "#DC2626" : "white", border: "1px solid", borderColor: confirmarDesligar ? "#DC2626" : "#CBD5E1", color: confirmarDesligar ? "white" : "#475569", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
              {confirmarDesligar ? "Toque de novo para desligar" : "Desligar"}
            </button>}
          </div>
        </>
      )}
    </div>
  );
}

function Oferta({ dados, salvando, onLigar }: { dados: Dados; salvando: boolean; onLigar: () => void }) {
  const exemplos = [
    { icone: Mic, titulo: "Manda um áudio", fala: "“Comprei 10 Coca lata no Atacadão, paguei 45 no Pix.”", resultado: "📦 +10 Coca-Cola Lata no estoque\n💰 R$ 45,00 no financeiro" },
    { icone: PauseCircle, titulo: "Controla o cardápio", fala: "“Acabou a esfirra de frango, pausa. E me diz o que está pausado.”", resultado: "⏸️ Pausada no site, robô, balcão, totem e combos\n📋 Lista dos itens pausados" },
    { icone: Camera, titulo: "Tira foto da nota", fala: "Foto da nota do fornecedor", resultado: "📦 Todos os itens no estoque, com custo\n💰 Conta paga ou a prazo" },
    { icone: Wallet, titulo: "Fala do gasto", fala: "“Paguei o gás, 130 reais.”", resultado: "💰 Despesa Gás R$ 130,00 no DRE" },
    { icone: Receipt, titulo: "Boleto e conta", fala: "“Paguei o boleto da Enel.”", resultado: "✅ Conta marcada como paga" },
    { icone: Package, titulo: "Perda e consumo", fala: "“Joguei fora 2 kg de queijo, estragou.”", resultado: "📦 Saída de 2 kg (perda) com o valor perdido" },
    { icone: Store, titulo: "Abre e fecha a loja", fala: "“Tô sem motoboy, fecha o site.”", resultado: "🏪 Site e robô param de aceitar pedido" },
    { icone: MessageCircle, titulo: "Pergunta o que quiser", fala: "“Quanto tem de Coca? Quanto vendi hoje?”", resultado: "Resposta com o número do sistema" },
  ];
  return (
    <div>
      <div style={{ background: "linear-gradient(135deg,#064E3B,#065F46)", color: "white", borderRadius: 16, padding: "24px 22px", marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>Você cuida da loja. Eu cuido da papelada.</div>
        <div style={{ fontSize: 14, opacity: 0.9, maxWidth: 620 }}>
          Chegou mercadoria? Pagou uma conta? Acabou um sabor? Fala com o WhatsApp da sua loja, do seu número, como falaria com um gerente. A quantidade vai para o estoque, o valor vai para o financeiro e o que acabou sai do cardápio — numa mensagem só.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={onLigar} disabled={salvando} style={{ background: "#FACC15", color: "#0F172A", border: 0, borderRadius: 10, padding: "12px 20px", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>
            {salvando ? "Ligando…" : dados.estado.isento ? "Ativar o Bill (conta isenta)" : dados.estado.jaTestou ? `Ativar o Bill por ${fmtR(dados.preco)}/mês` : `Testar ${dados.diasDeTeste} dias grátis`}
          </button>
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            {dados.estado.jaTestou
              ? <><b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub (os 7 dias grátis já foram usados). Desligou, o mês seguinte não é cobrado.</>
              : <>Depois, <b>{fmtR(dados.preco)} por mês</b> no boleto do FireHub. Os 7 dias grátis valem só na primeira ativação.</>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
        {exemplos.map((e) => (
          <div key={e.titulo} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 14, background: "white" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
              <e.icone size={18} color={VERDE} /> {e.titulo}
            </div>
            <div style={{ background: "#DCF8C6", borderRadius: 10, padding: "8px 10px", fontSize: 13, color: "#0F172A", marginBottom: 6 }}>{e.fala}</div>
            <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "8px 10px", fontSize: 13, color: "#334155", whiteSpace: "pre-line" }}>{e.resultado}</div>
          </div>
        ))}
      </div>
      {dados.numerosDoDono.length === 0 && (
        <p style={{ marginTop: 16, fontSize: 13, color: "#B45309" }}>
          ⚠️ Cadastre o seu WhatsApp em <b>Minha Loja</b> (WhatsApp do proprietário): é por ele que o Bill sabe que é você.
        </p>
      )}
    </div>
  );
}

function ComoUsar({ dados }: { dados: Dados }) {
  return (
    <div style={{ border: "1px solid #BBF7D0", background: "#F0FDF4", borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <div style={{ fontWeight: 800, color: "#065F46", marginBottom: 6 }}>Como usar pelo WhatsApp</div>
      {dados.numerosDoDono.length > 0 ? (
        <div style={{ fontSize: 14, color: "#065F46" }}>
          Do {dados.numerosDoDono.length > 1 ? "seus números" : "seu número"} <b>{dados.numerosDoDono.map(fone).join(", ")}</b>, mande mensagem para o WhatsApp da loja
          {dados.numeroDoRobo ? <> (<b>{fone(dados.numeroDoRobo)}</b>)</> : " conectado no Chatbot IA"}. Áudio, texto ou foto. Errou? Manda <b>desfaz</b>.
          <div style={{ fontSize: 12, marginTop: 4, color: "#047857" }}>Outros números (sócio, gerente) entram em Chatbot IA › Notificações.</div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: "#B45309" }}>
          Falta o seu número: cadastre o WhatsApp do proprietário em <b>Minha Loja</b>. Enquanto isso, use a conversa aqui embaixo.
        </div>
      )}
    </div>
  );
}

function Historico({ registros }: { registros: Registro[] }) {
  return (
    <div>
      <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 8, fontSize: 16 }}>O que o Bill lançou</div>
      {registros.length === 0 ? (
        <div style={{ color: "#64748B", fontSize: 14, padding: 14, border: "1px dashed #CBD5E1", borderRadius: 12 }}>
          Nada ainda. Os lançamentos aparecem aqui e também em Estoque e Financeiro, como se você tivesse digitado.
        </div>
      ) : (
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          {registros.map((r) => {
            const rot = ROTULO[r.tipo] || { texto: r.tipo, cor: "#475569" };
            return (
              <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderBottom: "1px solid #F1F5F9", background: "white", opacity: r.desfeitoEm ? 0.55 : 1 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: rot.cor, background: `${rot.cor}14`, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{rot.texto}</span>
                <div style={{ flex: 1, fontSize: 14, color: "#0F172A", textDecoration: r.desfeitoEm ? "line-through" : "none" }}>{r.resumo}</div>
                <div style={{ fontSize: 12, color: "#64748B", whiteSpace: "nowrap", textAlign: "right" }}>
                  {dataHora(r.criadoEm)}
                  <div>{r.desfeitoEm ? <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}><Undo2 size={11} /> desfeito</span>
                    : <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}><CheckCircle2 size={11} color={VERDE} /> {r.canal === "PAINEL" ? "painel" : "WhatsApp"}</span>}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** O termo de contratação: só liga marcando o "concordo" (texto em lib/assessor/termo.ts). */
function Termo({ preco, salvando, onCancelar, onAceitar }: { preco: number; salvando: boolean; onCancelar: () => void; onAceitar: () => void }) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_BILL}
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}>
      <div style={{ background: "white", borderRadius: 16, width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "1px solid #E2E8F0" }}>
          <img src={AVATAR_DO_BILL} alt="" width={40} height={40} style={{ borderRadius: 999, border: "2px solid #22D3EE" }} />
          <div>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#0F172A" }}>{TITULO_DO_TERMO_DO_BILL}</div>
            <div style={{ fontSize: 13, color: "#475569" }}>{fmtR(preco)} por mês · versão de {VERSAO_DO_TERMO_DO_BILL.slice(0, 10).split("-").reverse().join("/")}</div>
          </div>
        </div>
        <ol style={{ margin: 0, padding: "16px 20px 4px 40px", display: "grid", gap: 10, fontSize: 14, color: "#1E293B", lineHeight: 1.5 }}>
          {CLAUSULAS_DO_TERMO_DO_BILL.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "12px 20px 0", padding: 12, background: "#F8FAFC", borderRadius: 10, cursor: "pointer", fontSize: 14, color: "#0F172A", fontWeight: 700 }}>
          <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
          Li e concordo com o termo e autorizo a cobrança de {fmtR(preco)} por mês no boleto do FireHub.
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "16px 20px 20px", flexWrap: "wrap" }}>
          <button onClick={onCancelar} disabled={salvando} style={{ background: "white", border: "1px solid #CBD5E1", color: "#475569", borderRadius: 10, padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Agora não</button>
          <button onClick={onAceitar} disabled={!concordo || salvando}
            style={{ background: concordo ? "#059669" : "#94A3B8", border: 0, color: "white", borderRadius: 10, padding: "10px 18px", fontWeight: 900, cursor: concordo ? "pointer" : "not-allowed" }}>
            {salvando ? "Ativando…" : "Concordo e ativar o Bill"}
          </button>
        </div>
      </div>
    </div>
  );
}
