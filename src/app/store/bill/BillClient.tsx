"use client";

/**
 * Bill, seu assessor — a tela do dono. Não se chama "Meu Assessor": essa marca
 * é da Tittanium (Felipe Titto) no INPI, processos 939197650 (classe 9) e
 * 939133610 (classe 42). "Bill" é o mesmo assistente do FireCheck.
 *
 * Desligado: a apresentação (celular com a conversa tocando, o que faz,
 * preço, dúvidas) e, ao ligar, o
 * termo de contratação (lib/assessor/termo.ts) — só liga com o "concordo".
 * Ligado: o painel do Bill (PainelDoBill.tsx) — visão geral do que ele fez,
 * a conversa (a mesma do WhatsApp, gravando de verdade) com exemplos, o
 * histórico com filtros e desfazer, e a configuração (números, assinatura,
 * desligar).
 */

import { useCallback, useEffect, useState } from "react";
import RostoDoBill, { type EmocaoDoBill } from "@/components/bill/RostoDoBill";
import { EVENTO_BILL_LIGADO } from "@/components/bill/BillFlutuante";
import { VERSAO_DO_TERMO_DO_BILL, TITULO_DO_TERMO_DO_BILL, CLAUSULAS_DO_TERMO_DO_BILL } from "@/lib/assessor/termo";
import { Mic, Camera, Package, Wallet, Receipt, CheckCircle2, PauseCircle, Store } from "lucide-react";
import PainelDoBill, { type DadosDoBill, type AvisoDoBill } from "./PainelDoBill";

type Dados = DadosDoBill;
type Aviso = AvisoDoBill;

const VERDE = "#059669";
const fmtR = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fone = (d: string) => {
  const n = d.replace(/^55/, "");
  return n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : d;
};

export default function BillClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
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
    try {
      const r = await fetch("/api/store/assessor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DO_BILL } } : { ligar }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      setAviso(ligar
        ? { tipo: "ok", titulo: "Bill ligado!", detalhe: dados?.estado.isento
            ? "Mande um áudio do seu WhatsApp para o número da loja e veja a mágica."
            : `Mande um áudio do seu WhatsApp para o número da loja e veja a mágica. Depois dos ${dados?.diasDeTeste ?? 7} dias grátis, se você não desligar, ${fmtR(dados?.preco ?? 0)} por mês vem no boleto da mensalidade do FireHub.` }
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

      {termoAberto && <Termo preco={dados.preco} salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />}

      {estado.ativo ? (
        <PainelDoBill dados={dados} setAviso={setAviso} salvando={salvando} onDesligar={() => ligar(false)} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
            <RostoDoBill tamanho={52} seguirMouse emocao="normal" />
            <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", margin: 0 }}>Bill, seu assessor</h1>
          </div>
          <div style={{ height: 14 }} />
          <Oferta dados={dados} salvando={salvando} onLigar={() => setTermoAberto(true)} />
        </>
      )}
    </div>
  );
}

/**
 * A apresentação do Bill para quem ainda não ligou (Douglas, 17/10/2026: "a
 * tela para quem não testou linda, interativa, apresentando o Bill e o que ele
 * faz"). Um celular com a conversa do WhatsApp tocando sozinha, cena por cena;
 * tocar num exemplo põe aquela cena no celular. Só mostra o que as ferramentas
 * do Bill fazem de verdade (lib/assessor/ferramentas.ts) — o card antigo
 * "Quanto vendi hoje?" prometia uma consulta que o Bill não tem.
 */
type Fala = { de: "dono" | "bill"; texto: string; tipo?: "audio" | "foto" };
type Cena = { icone: typeof Mic; titulo: string; resumo: string; falas: Fala[] };

const CENAS: Cena[] = [
  {
    icone: Mic, titulo: "Manda um áudio", resumo: "Compra vai para o estoque e o valor para o financeiro.",
    falas: [
      { de: "dono", tipo: "audio", texto: "Comprei 10 Coca lata no Atacadão, paguei 45 no Pix." },
      { de: "bill", texto: "Lancei ✅\n📦 +10 Coca-Cola Lata no estoque\n💰 R$ 45,00 · Atacadão · Pix\nErrou? Manda *desfaz*." },
    ],
  },
  {
    icone: Camera, titulo: "Foto da nota", resumo: "Todos os itens da nota de uma vez, com o custo.",
    falas: [
      { de: "dono", tipo: "foto", texto: "Nota da distribuidora" },
      { de: "bill", texto: "Li a nota: 6 itens, R$ 387,40.\n📦 Estoque atualizado com o custo de cada item\n💰 Conta a pagar lançada no financeiro" },
    ],
  },
  {
    icone: PauseCircle, titulo: "Pausa o que acabou", resumo: "Sai do site, do robô, do balcão e dos combos.",
    falas: [
      { de: "dono", texto: "Acabou a esfirra de frango, pausa" },
      { de: "bill", texto: "⏸️ Esfirra de Frango pausada no site, no robô, no balcão e dentro dos combos.\nQuando voltar, é só falar *volta a esfirra*." },
    ],
  },
  {
    icone: Wallet, titulo: "Fala do gasto", resumo: "Despesa no financeiro, na categoria certa.",
    falas: [
      { de: "dono", texto: "Paguei o gás, 130 reais" },
      { de: "bill", texto: "💰 Despesa Gás · R$ 130,00 lançada no financeiro." },
    ],
  },
  {
    icone: Receipt, titulo: "Contas e boletos", resumo: "Anota o boleto, avisa o que vence, dá baixa.",
    falas: [
      { de: "dono", texto: "O que vence essa semana?" },
      { de: "bill", texto: "📅 Esta semana:\n• Enel · R$ 412,30 · sexta\n• Aluguel · R$ 2.500,00 · sábado\nPagou? Me fala que eu dou baixa." },
    ],
  },
  {
    icone: Store, titulo: "Abre e fecha a loja", resumo: "Sem motoboy? Fecha o site e o robô na hora.",
    falas: [
      { de: "dono", texto: "Tô sem motoboy, fecha o site" },
      { de: "bill", texto: "🏪 Loja fechada no site e no robô.\nPara abrir de novo: *abre a loja*." },
    ],
  },
  {
    icone: Package, titulo: "Pergunta do estoque", resumo: "Quanto tem, o que acabou, o que perdeu.",
    falas: [
      { de: "dono", texto: "Quanto tem de Coca lata?" },
      { de: "bill", texto: "📦 Coca-Cola Lata: 34 unidades no estoque." },
    ],
  },
];

const PERGUNTAS: [string, string][] = [
  ["Preciso instalar alguma coisa?", "Não. Você manda mensagem do seu WhatsApp para o WhatsApp da loja que já está conectado no FireHub. O Bill reconhece o seu número e atende só você (e quem você cadastrar)."],
  ["E se ele lançar errado?", "Manda “desfaz” e ele desfaz o último lançamento. Tudo o que ele lança aparece no Estoque e no Financeiro como se você tivesse digitado, e dá para corrigir pelo painel."],
  ["Meus clientes vão falar com o Bill?", "Não. Cliente continua falando com o robô de atendimento da loja. O Bill só responde os números do dono."],
  ["Como cancelo?", "Aqui nesta tela, em “Desligar”. No mês seguinte não é cobrado nada."],
];

function Oferta({ dados, salvando, onLigar }: { dados: Dados; salvando: boolean; onLigar: () => void }) {
  const [cena, setCena] = useState(0);
  const [passo, setPasso] = useState(0); // 0 nada · 1 fala do dono · 2 digitando · 3 resposta do Bill
  const [pergunta, setPergunta] = useState<number | null>(0);
  const [semMovimento, setSemMovimento] = useState(false);
  // O Bill grande reage à cena do celular (ouve, pensa, comemora) e sorri
  // quando o ponteiro chega no botão de ativar.
  const [ctaSobre, setCtaSobre] = useState(false);
  const humor: EmocaoDoBill = ctaSobre ? "feliz" : passo === 1 ? "ouvindo" : passo === 2 ? "pensando" : passo === 3 ? "feliz" : "normal";

  useEffect(() => {
    try { setSemMovimento(window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch {}
  }, []);

  // A cena toca sozinha: fala do dono, "digitando…", resposta do Bill, pausa e a próxima.
  useEffect(() => {
    if (semMovimento) { setPasso(3); return; }
    setPasso(0);
    const ts = [
      setTimeout(() => setPasso(1), 350),
      setTimeout(() => setPasso(2), 1300),
      setTimeout(() => setPasso(3), 2600),
      setTimeout(() => setCena((c) => (c + 1) % CENAS.length), 7600),
    ];
    return () => ts.forEach(clearTimeout);
  }, [cena, semMovimento]);

  const botao = salvando ? "Ligando…"
    : dados.estado.isento ? "Ativar o Bill (conta isenta)"
    : dados.estado.jaTestou ? `Ativar o Bill por ${fmtR(dados.preco)}/mês`
    : `Testar ${dados.diasDeTeste} dias grátis`;
  const porDia = fmtR(Math.floor((dados.preco / 30) * 100) / 100);
  const atual = CENAS[cena];

  return (
    <div className="bill-oferta">
      <style>{CSS_DA_OFERTA}</style>

      {/* ── Topo: a promessa + o celular tocando ── */}
      <section className="bo-hero">
        <div className="bo-hero-texto">
          <span className="bo-selo">Novo · funciona pelo WhatsApp</span>
          <h2>Você cuida da loja.<br /><span>Eu cuido da papelada.</span></h2>
          <p>
            Chegou mercadoria, pagou uma conta, acabou um sabor? Fale com o WhatsApp da sua loja como falaria com um gerente.
            Eu lanço no estoque, no financeiro e no cardápio — na hora, numa mensagem só.
          </p>
          <div className="bo-acoes">
            <button className="bo-cta" onClick={onLigar} disabled={salvando} onPointerEnter={() => setCtaSobre(true)} onPointerLeave={() => setCtaSobre(false)}>{botao}</button>
            <div className="bo-preco-curto">
              {dados.estado.isento ? <>Conta isenta: sem cobrança.</>
                : dados.estado.jaTestou ? <><b>{fmtR(dados.preco)}/mês</b> no boleto do FireHub · desliga quando quiser</>
                : <>Depois dos {dados.diasDeTeste} dias, <b>se você não desligar, {fmtR(dados.preco)}/mês</b> vem junto com a mensalidade do FireHub, no mesmo boleto. Sem fidelidade.</>}
            </div>
          </div>
          <ul className="bo-garantias">
            <li><CheckCircle2 size={15} /> Áudio, texto ou foto</li>
            <li><CheckCircle2 size={15} /> Errou? “desfaz”</li>
            <li><CheckCircle2 size={15} /> Só o seu número fala com ele</li>
          </ul>
        </div>

        <div className="bo-palco">
          <div className="bo-bill-grande"><RostoDoBill tamanho={190} seguirMouse emocao={humor} /></div>
        <div className="bo-celular" aria-label={`Exemplo de conversa: ${atual.titulo}`}>
          <div className="bo-cel-topo">
            <RostoDoBill tamanho={34} emocao={humor} piscar={false} />
            <div>
              <b>Bill · sua loja</b>
              <small>{passo === 2 ? "digitando…" : "online"}</small>
            </div>
          </div>
          <div className="bo-cel-conversa" key={cena}>
            {passo >= 1 && <Balao fala={atual.falas[0]} />}
            {passo === 2 && <div className="bo-balao bo-bill bo-digitando"><i /><i /><i /></div>}
            {passo >= 3 && <Balao fala={atual.falas[1]} />}
          </div>
          <div className="bo-cel-pontos">
            {CENAS.map((c, i) => (
              <button key={c.titulo} aria-label={c.titulo} className={i === cena ? "on" : ""} onClick={() => setCena(i)} />
            ))}
          </div>
        </div>
        </div>
      </section>

      {/* ── O que ele faz: tocar num card põe a cena no celular ── */}
      <section>
        <h3 className="bo-titulo">O que o Bill faz por você</h3>
        <p className="bo-sub">Toque num exemplo para ver a conversa no celular.</p>
        <div className="bo-cards">
          {CENAS.map((c, i) => (
            <button key={c.titulo} className={`bo-card${i === cena ? " on" : ""}`}
              onClick={() => { setCena(i); document.querySelector(".bo-celular")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
              <span className="bo-card-icone"><c.icone size={20} /></span>
              <b>{c.titulo}</b>
              <span>{c.resumo}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Antes e depois ── */}
      <section className="bo-antes-depois">
        <div className="bo-antes">
          <b>Sem o Bill</b>
          <ul>
            <li>Nota amassada no balcão esperando alguém lançar</li>
            <li>Estoque que nunca bate</li>
            <li>Conta que vence e ninguém lembra</li>
            <li>Cliente pedindo sabor que acabou</li>
          </ul>
        </div>
        <div className="bo-depois">
          <b>Com o Bill</b>
          <ul>
            <li>Um áudio no caminho do mercado e está lançado</li>
            <li>Estoque e custo atualizados a cada compra</li>
            <li>Contas a pagar na ponta da língua</li>
            <li>O que acabou sai do cardápio na hora</li>
          </ul>
        </div>
      </section>

      {/* ── Como começar ── */}
      <section>
        <h3 className="bo-titulo">Começa em 1 minuto</h3>
        <ol className="bo-passos">
          <li><span>1</span><div><b>Ative aqui</b>Aceite o termo e pronto{!dados.estado.jaTestou && !dados.estado.isento ? ` — ${dados.diasDeTeste} dias grátis. Depois, se não desligar, entra no boleto da mensalidade` : ""}.</div></li>
          <li><span>2</span><div><b>Mande do seu WhatsApp</b>Para o número da loja{dados.numeroDoRobo ? `, ${fone(dados.numeroDoRobo)}` : ""}.</div></li>
          <li><span>3</span><div><b>Confira no painel</b>Tudo aparece em Estoque e Financeiro.</div></li>
        </ol>
        {dados.numerosDoDono.length === 0 && (
          <p className="bo-alerta">
            ⚠️ Cadastre o seu WhatsApp em <b>Minha Loja</b> (WhatsApp do proprietário): é por ele que o Bill sabe que é você.
          </p>
        )}
      </section>

      {/* ── Preço ── */}
      {!dados.estado.isento && (
        <section className="bo-preco">
          <div>
            <div className="bo-preco-valor">{fmtR(dados.preco)}<small>/mês</small></div>
            <div className="bo-preco-dia">menos de {porDia} por dia · no boleto que você já paga</div>
          </div>
          <ul>
            {!dados.estado.jaTestou && <li><CheckCircle2 size={15} /> {dados.diasDeTeste} dias grátis na primeira ativação — depois, se você não desligar, vem cobrado junto com a mensalidade do FireHub</li>}
            <li><CheckCircle2 size={15} /> Sem fidelidade: desligou, o mês seguinte não é cobrado</li>
            <li><CheckCircle2 size={15} /> Sem cartão e sem cadastro novo</li>
          </ul>
          <button className="bo-cta" onClick={onLigar} disabled={salvando}>{botao}</button>
        </section>
      )}

      {/* ── Dúvidas ── */}
      <section>
        <h3 className="bo-titulo">Dúvidas</h3>
        <div className="bo-faq">
          {PERGUNTAS.map(([p, r], i) => (
            <div key={p} className={`bo-faq-item${pergunta === i ? " on" : ""}`}>
              <button aria-expanded={pergunta === i} onClick={() => setPergunta(pergunta === i ? null : i)}>
                {p}<span>{pergunta === i ? "−" : "+"}</span>
              </button>
              {pergunta === i && <p>{r}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Balao({ fala }: { fala: Fala }) {
  const lado = fala.de === "dono" ? "bo-dono" : "bo-bill";
  if (fala.tipo === "audio") {
    return (
      <div className={`bo-balao ${lado}`}>
        <div className="bo-audio"><Mic size={16} /><span className="bo-onda">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: 4 + ((i * 7) % 13) }} />)}</span><small>0:07</small></div>
        <em>“{fala.texto}”</em>
      </div>
    );
  }
  if (fala.tipo === "foto") {
    return (
      <div className={`bo-balao ${lado} bo-foto`}>
        <div className="bo-nota"><Receipt size={26} /><span /><span /><span /><span /></div>
        <small>📷 {fala.texto}</small>
      </div>
    );
  }
  // *negrito* do WhatsApp
  const partes = fala.texto.split(/(\*[^*]+\*)/g);
  return (
    <div className={`bo-balao ${lado}`}>
      {partes.map((p, i) => (p.startsWith("*") && p.endsWith("*") ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>))}
    </div>
  );
}

const CSS_DA_OFERTA = `
.bill-oferta { display: grid; gap: 36px; color: #0F172A; }
.bill-oferta section { min-width: 0; }
.bo-hero { display: grid; grid-template-columns: minmax(0,1.15fr) minmax(0,.85fr); gap: 28px; align-items: center;
  background: radial-gradient(120% 140% at 0% 0%, #0E7490 0%, #0B1220 55%); color: white; border-radius: 22px; padding: 32px; overflow: hidden; }
.bo-selo { display: inline-block; font-size: 12px; font-weight: 800; letter-spacing: .02em; color: #A5F3FC; background: rgba(34,211,238,.14);
  border: 1px solid rgba(34,211,238,.35); padding: 5px 11px; border-radius: 999px; }
.bo-hero h2 { font-size: clamp(26px, 4vw, 38px); line-height: 1.08; font-weight: 900; margin: 14px 0 12px; letter-spacing: -.02em; }
.bo-hero h2 span { color: #FACC15; }
.bo-hero p { font-size: 15.5px; line-height: 1.55; opacity: .9; margin: 0; max-width: 520px; }
.bo-acoes { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 22px; }
.bo-cta { background: #FACC15; color: #0F172A; border: 0; border-radius: 12px; padding: 14px 22px; font-weight: 900; font-size: 15.5px; cursor: pointer;
  box-shadow: 0 8px 24px rgba(250,204,21,.35); transition: transform .15s ease, box-shadow .15s ease; }
.bo-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(250,204,21,.45); }
.bo-cta:active:not(:disabled) { transform: translateY(0) scale(.98); }
.bo-cta:disabled { opacity: .7; cursor: wait; }
.bo-preco-curto { font-size: 13px; opacity: .9; }
.bo-garantias { list-style: none; padding: 0; margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; opacity: .92; }
.bo-garantias li { display: inline-flex; align-items: center; gap: 6px; }
.bo-garantias svg { color: #34D399; }

.bo-palco { display: grid; justify-items: center; width: 100%; }
.bo-bill-grande { margin-bottom: -30px; position: relative; z-index: 2; filter: drop-shadow(0 18px 28px rgba(34,211,238,.28)); animation: bo-flutua 4s ease-in-out infinite; }
@keyframes bo-flutua { 50% { transform: translateY(-6px); } }
.bo-celular { background: #0B141A; border-radius: 28px; border: 6px solid #1F2C34; box-shadow: 0 30px 60px rgba(0,0,0,.45); overflow: hidden;
  width: 100%; max-width: 330px; justify-self: center; }
.bo-cel-topo { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #1F2C34; }
.bo-cel-topo b { display: block; font-size: 14px; }
.bo-cel-topo small { font-size: 11.5px; color: #8696A0; }
.bo-cel-conversa { display: flex; flex-direction: column; gap: 8px; padding: 16px 12px; min-height: 270px;
  background: #0B141A url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23ffffff10'/%3E%3C/svg%3E"); }
.bo-balao { max-width: 86%; padding: 8px 10px; border-radius: 10px; font-size: 13.5px; line-height: 1.45; white-space: pre-line;
  animation: bo-entra .32s cubic-bezier(.2,.8,.2,1) both; }
.bo-dono { align-self: flex-end; background: #005C4B; border-top-right-radius: 3px; }
.bo-bill { align-self: flex-start; background: #202C33; border-top-left-radius: 3px; }
.bo-balao em { display: block; font-size: 12px; opacity: .75; margin-top: 4px; }
.bo-audio { display: flex; align-items: center; gap: 8px; min-width: 190px; }
.bo-onda { display: flex; align-items: center; gap: 2px; flex: 1; }
.bo-onda i { display: block; width: 3px; border-radius: 2px; background: #9FE5D3; }
.bo-audio small { font-size: 11px; opacity: .8; }
.bo-foto { padding: 5px; }
.bo-nota { width: 170px; height: 110px; border-radius: 7px; background: #F8FAFC; color: #64748B; display: grid; place-items: center; align-content: center; gap: 5px; }
.bo-nota span { display: block; width: 110px; height: 4px; border-radius: 2px; background: #CBD5E1; }
.bo-nota span:nth-child(odd) { width: 80px; }
.bo-foto small { display: block; font-size: 11.5px; padding: 4px 4px 1px; opacity: .85; }
.bo-digitando { display: flex; gap: 4px; padding: 12px 14px; }
.bo-digitando i { width: 7px; height: 7px; border-radius: 999px; background: #8696A0; animation: bo-pula 1s infinite ease-in-out; }
.bo-digitando i:nth-child(2) { animation-delay: .15s; }
.bo-digitando i:nth-child(3) { animation-delay: .3s; }
.bo-cel-pontos { display: flex; justify-content: center; gap: 6px; padding: 10px 0 14px; background: #0B141A; }
.bo-cel-pontos button { width: 7px; height: 7px; border-radius: 999px; border: 0; padding: 0; background: #2A3942; cursor: pointer; transition: width .2s ease, background .2s ease; }
.bo-cel-pontos button.on { width: 20px; background: #22D3EE; }

.bo-titulo { font-size: 22px; font-weight: 900; margin: 0 0 4px; letter-spacing: -.01em; }
.bo-sub { margin: 0 0 14px; color: #64748B; font-size: 14px; }
.bo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
.bo-card { text-align: left; display: grid; gap: 6px; background: white; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; cursor: pointer;
  font: inherit; color: inherit; transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.bo-card:hover { border-color: #67E8F9; box-shadow: 0 8px 22px rgba(14,116,144,.10); transform: translateY(-2px); }
.bo-card.on { border-color: #0E7490; box-shadow: 0 0 0 3px rgba(34,211,238,.25); }
.bo-card b { font-size: 15px; }
.bo-card > span:last-child { font-size: 13px; color: #64748B; line-height: 1.4; }
.bo-card-icone { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: #ECFEFF; color: #0E7490; }

.bo-antes-depois { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bo-antes, .bo-depois { border-radius: 16px; padding: 20px; }
.bo-antes { background: #F8FAFC; border: 1px solid #E2E8F0; color: #475569; }
.bo-depois { background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; }
.bo-antes b, .bo-depois b { font-size: 16px; }
.bo-antes ul, .bo-depois ul { margin: 10px 0 0; padding-left: 18px; display: grid; gap: 7px; font-size: 14px; }
.bo-antes li::marker { content: "✕  "; color: #94A3B8; }
.bo-depois li::marker { content: "✓  "; color: #059669; font-weight: 900; }

.bo-passos { list-style: none; padding: 0; margin: 12px 0 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.bo-passos li { display: flex; gap: 12px; align-items: flex-start; background: white; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; font-size: 13.5px; color: #475569; }
.bo-passos li b { display: block; color: #0F172A; font-size: 15px; margin-bottom: 2px; }
.bo-passos li > span { flex: none; width: 30px; height: 30px; border-radius: 999px; background: #0B1220; color: #FACC15; font-weight: 900; display: grid; place-items: center; }
.bo-alerta { margin: 14px 0 0; font-size: 13px; color: #B45309; }

.bo-preco { display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: center; background: #0B1220; color: white; border-radius: 20px; padding: 24px 28px; }
.bo-preco-valor { font-size: 36px; font-weight: 900; letter-spacing: -.02em; }
.bo-preco-valor small { font-size: 15px; font-weight: 700; opacity: .7; margin-left: 2px; }
.bo-preco-dia { font-size: 13px; color: #A5F3FC; }
.bo-preco ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13.5px; opacity: .92; }
.bo-preco li { display: flex; align-items: center; gap: 7px; }
.bo-preco svg { color: #34D399; flex: none; }

.bo-faq { display: grid; gap: 8px; margin-top: 10px; }
.bo-faq-item { border: 1px solid #E2E8F0; border-radius: 12px; background: white; overflow: hidden; }
.bo-faq-item button { width: 100%; display: flex; justify-content: space-between; gap: 12px; background: none; border: 0; padding: 14px 16px; font: inherit;
  font-weight: 800; font-size: 14.5px; color: #0F172A; text-align: left; cursor: pointer; }
.bo-faq-item button span { color: #0E7490; font-size: 18px; line-height: 1; }
.bo-faq-item p { margin: 0; padding: 0 16px 14px; font-size: 14px; color: #475569; line-height: 1.5; }
.bo-faq-item.on { border-color: #A5F3FC; }

@keyframes bo-entra { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes bo-pula { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .bo-balao, .bo-digitando i, .bo-bill-grande { animation: none; }
  .bo-card, .bo-cta { transition: none; }
}
@media (max-width: 760px) {
  .bo-hero { grid-template-columns: 1fr; padding: 22px 18px; }
  .bo-antes-depois, .bo-passos { grid-template-columns: 1fr; }
  .bo-preco { grid-template-columns: 1fr; gap: 16px; padding: 22px 18px; }
  .bo-cta { width: 100%; }
}
`;

/** O termo de contratação: só liga marcando o "concordo" (texto em lib/assessor/termo.ts). */
function Termo({ preco, salvando, onCancelar, onAceitar }: { preco: number; salvando: boolean; onCancelar: () => void; onAceitar: () => void }) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_BILL}
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}>
      <div style={{ background: "white", borderRadius: 16, width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "1px solid #E2E8F0" }}>
          <RostoDoBill tamanho={44} emocao="feliz" />
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
