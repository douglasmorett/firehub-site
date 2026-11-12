"use client";

/**
 * Cotação automática — a tela do lojista (/store/cotacao).
 *
 * Douglas, 07/11/2026: "Tem que estar tudo muito intuitivo, fácil de fazer e
 * dinâmico, capricha demais."
 *
 * Desligado: o que é, como funciona, o preço À PARTE da mensalidade e o
 * "Testar 7 dias grátis" (termo em lib/cotacao/termo.ts).
 * Ligado: o liga/desliga (dono), a faixa da agenda com "Pedir cotação agora",
 * o passo a passo enquanto falta cadastro, e as abas — o Comparativo primeiro,
 * que é a tela que ele vai abrir toda semana.
 */

import { useCallback, useEffect, useState } from "react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { CLAUSULAS_DO_TERMO_DA_COTACAO, TITULO_DO_TERMO_DA_COTACAO, VERSAO_DO_TERMO_DA_COTACAO } from "@/lib/cotacao/termo";
import { horaFalada, NOMES_DOS_DIAS, type HorarioDaCotacao } from "@/lib/cotacao/agenda";
import { AvisoNoTopo, COR, COR_CLARA, S, VERDE, diaCurto, pedir, reais, type Aviso } from "./ui";
import Comparativo from "./Comparativo";
import Fornecedores from "./Fornecedores";
import Produtos from "./Produtos";
import Agenda from "./Agenda";
import Pedidos from "./Pedidos";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; desligaEm: string | null; fimDoMes: string | null };
export type DadosDaCotacao = {
  estado: Estado;
  podeContratar: boolean;
  preco: number;
  diasDeTeste: number;
  loja: { nome: string; telefoneDoDono: string | null };
  config: { agenda: HorarioDaCotacao[]; horasParaResumo: number; compradorTelefone: string | null; compradorNome: string | null };
  frase: string;
  proximo: { dia: string; diaDaSemana: number; hora: string } | null;
  contagens: { fornecedores: number; produtos: number };
  mensalidade: { percentual: number; minimo: number; teto: number };
};
type Aba = "comparativo" | "fornecedores" | "produtos" | "agenda" | "pedidos";
const ABAS: Array<[Aba, string]> = [
  ["comparativo", "📊 Comparativo"], ["fornecedores", "🚚 Fornecedores"], ["produtos", "📦 Produtos"], ["agenda", "🗓️ Agenda"], ["pedidos", "🧾 Pedidos"],
];
const CHAVE_DA_ABA = "cotacao:aba";

export default function CotacaoClient() {
  const [dados, setDados] = useState<DadosDaCotacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [aba, setAba] = useState<Aba>("comparativo");
  /** Muda quando algo que o comparativo mostra foi salvo em outra aba. */
  const [versao, setVersao] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setDados(await pedir<DadosDaCotacao>("/api/store/cotacao"));
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    try { const a = localStorage.getItem(CHAVE_DA_ABA) as Aba | null; if (a && ABAS.some(([x]) => x === a)) setAba(a); } catch {}
  }, []);
  const irPara = useCallback((a: Aba) => {
    setAba(a);
    try { localStorage.setItem(CHAVE_DA_ABA, a); } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const mudou = useCallback(() => { setVersao((v) => v + 1); carregar(); }, [carregar]);

  async function ligar(ligar: boolean) {
    if (!dados) return;
    setSalvando(true);
    const antes = dados.estado;
    try {
      const j = await pedir("/api/store/cotacao", "POST", ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DA_COTACAO } } : { ligar });
      const estado: Estado = j.estado;
      setDados({ ...dados, estado });
      setTermoAberto(false);
      setAviso(ligar
        ? antes.ativo && antes.desligaEm
          ? { tipo: "ok", titulo: "A cotação continua ligada.", detalhe: "O desligamento da virada do mês foi cancelado; a cobrança segue normal." }
          : { tipo: "ok", titulo: "Cotação automática ligada!", detalhe: estado.isento ? "Agora cadastre os fornecedores." : estado.emTeste && estado.testeAte ? `Grátis até ${diaCurto(estado.testeAte)}. Agora cadastre os fornecedores.` : `Este mês já entra inteiro no boleto (${reais(dados.preco)}), à parte da mensalidade.` }
        : estado.ativo && estado.desligaEm
          ? { tipo: "ok", titulo: `A cotação desliga em ${diaCurto(estado.desligaEm)}.`, detalhe: "Este mês já está pago: até lá ela continua funcionando, e o mês que vem não é cobrado." }
          : { tipo: "ok", titulo: "Cotação desligada.", detalhe: "Você estava no teste grátis: nada foi cobrado." });
      if (ligar) await carregar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={{ padding: 24, color: "#B71C1C", fontWeight: 700 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;
  const e = dados.estado;

  return (
    <div className="cot-pagina" style={{ maxWidth: e.ativo ? 1240 : 900, margin: "0 auto", padding: "18px 16px 120px" }}>
      <style>{CSS_DA_PAGINA}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div className="cot-sem-impressao" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#0F172A" }}>🛒 Cotação automática</h1>
        {e.ativo && (
          <span style={{ ...S.chip, background: "#DCFCE7", color: "#166534" }}>
            {e.isento ? "LIBERADO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${diaCurto(e.testeAte)}` : "ATIVO"}
          </span>
        )}
      </div>
      {!e.ativo && (
        <p style={{ ...S.texto, marginTop: 6, fontSize: 15.5 }}>
          A sua loja pede os preços aos fornecedores pelo WhatsApp, lê o que eles mandam e mostra quem está mais barato em cada
          item. Você marca o que quer comprar e manda o pedido com um toque.
        </p>
      )}

      {e.ativo ? (
        <>
          {dados.podeContratar && (
            <div className="cot-sem-impressao">
              <InterruptorDoModulo nome="o módulo Cotação automática" preco={dados.preco} estado={e} salvando={salvando}
                onLigar={() => {}} onDesligar={() => ligar(false)} onContinuar={() => ligar(true)} />
            </div>
          )}
          {/* Loja isenta (demonstração do vendedor): liberada, mas mostra o que o lojista vê e paga. */}
          {e.isento && (
            <div className="cot-sem-impressao">
              <p style={{ ...S.texto, marginTop: 6, fontWeight: 700, color: "#0F172A" }}>Na sua conta está liberado sem custo. Para o lojista é assim:</p>
              <Oferta dados={dados} salvando={salvando} onAtivar={() => {}} />
              <ResumoDaCobranca preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste paraOLojista />
              <ComoFunciona />
            </div>
          )}
          <FaixaDaAgenda dados={dados} onAviso={setAviso} onAgenda={() => irPara("agenda")} onPediu={mudou} />
          <PassoAPasso dados={dados} irPara={irPara} />

          <nav className="cot-sem-impressao cot-abas" aria-label="Partes da cotação">
            {ABAS.map(([id, nome]) => (
              <button key={id} type="button" onClick={() => irPara(id)} aria-current={aba === id ? "page" : undefined}
                className={aba === id ? "ativa" : ""}>
                {nome}
                {id === "fornecedores" && dados.contagens.fornecedores > 0 && <span className="conta">{dados.contagens.fornecedores}</span>}
                {id === "produtos" && dados.contagens.produtos > 0 && <span className="conta">{dados.contagens.produtos}</span>}
              </button>
            ))}
          </nav>

          <div style={{ marginTop: 14 }}>
            {aba === "comparativo" && <Comparativo versao={versao} onAviso={setAviso} irPara={irPara} onMudou={mudou} lojaNome={dados.loja.nome} />}
            {aba === "fornecedores" && <Fornecedores onAviso={setAviso} onMudou={mudou} />}
            {aba === "produtos" && <Produtos onAviso={setAviso} onMudou={mudou} />}
            {aba === "agenda" && <Agenda dados={dados} onAviso={setAviso} onSalvou={(d) => setDados(d)} />}
            {aba === "pedidos" && <Pedidos versao={versao} onAviso={setAviso} />}
          </div>
        </>
      ) : (
        <>
          <Oferta dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
          <ComoFunciona />
          <Perguntas />
        </>
      )}

      {termoAberto && (
        <Termo preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste={!e.jaTestou && !e.isento}
          salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />
      )}
    </div>
  );
}

// ─── Ligado: a faixa da agenda e o passo a passo ─────────────────────────

function FaixaDaAgenda({ dados, onAviso, onAgenda, onPediu }: { dados: DadosDaCotacao; onAviso: (a: Aviso) => void; onAgenda: () => void; onPediu: () => void }) {
  const [pedindo, setPedindo] = useState(false);
  const temAgenda = dados.config.agenda.length > 0;
  async function pedirAgora() {
    setPedindo(true);
    try {
      const j = await pedir("/api/store/cotacao/rodada", "POST");
      onAviso({
        tipo: "ok",
        titulo: `Pedindo os preços a ${j.naFila} fornecedor${j.naFila === 1 ? "" : "es"}.`,
        detalhe: `As mensagens saem pelo WhatsApp da loja, uma de cada vez (leva uns ${j.minutos} min). As respostas aparecem no comparativo sozinhas.${j.semTelefone ? `\n${j.semTelefone} sem WhatsApp cadastrado ficaram de fora.` : ""}`,
      });
      onPediu();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para pedir agora", detalhe: e.message });
    } finally {
      setPedindo(false);
    }
  }
  return (
    <section className="cot-sem-impressao" style={{ ...S.cartao, marginTop: 4, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", borderColor: "#C7D2FE", background: `linear-gradient(90deg, ${COR_CLARA}, #fff)` }}>
      <div style={{ fontSize: 30 }} aria-hidden>🗓️</div>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "#1E1B4B", fontSize: 15 }}>{dados.frase}</div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>
          {dados.proximo
            ? <>Próxima: <b>{NOMES_DOS_DIAS[dados.proximo.diaDaSemana]}, {dados.proximo.dia.slice(8, 10)}/{dados.proximo.dia.slice(5, 7)} às {horaFalada(dados.proximo.hora)}</b>. </>
            : null}
          <button type="button" onClick={onAgenda} style={{ border: 0, background: "none", padding: 0, color: COR, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
            {temAgenda ? "Mudar dias e horários" : "Marcar dias e horários"}
          </button>
        </div>
      </div>
      <button type="button" onClick={pedirAgora} disabled={pedindo} style={{ ...S.botao, height: 46, fontSize: 15 }}>
        {pedindo ? "Pedindo…" : "📨 Pedir cotação agora"}
      </button>
    </section>
  );
}

function PassoAPasso({ dados, irPara }: { dados: DadosDaCotacao; irPara: (a: Aba) => void }) {
  const passos: Array<{ feito: boolean; titulo: string; texto: string; aba: Aba; botao: string }> = [
    { feito: dados.contagens.fornecedores > 0, titulo: "Cadastre os fornecedores", texto: "Nome, WhatsApp, pedido mínimo e dias de entrega. Dá para colar uma lista.", aba: "fornecedores", botao: "Cadastrar fornecedores" },
    { feito: dados.contagens.produtos > 0, titulo: "Diga o que você compra", texto: "Digite, cole a lista, mande a foto da nota ou grave um áudio.", aba: "produtos", botao: "Cadastrar produtos" },
    { feito: dados.config.agenda.length > 0, titulo: "Marque quando cotar", texto: "Os dias e a hora em que a loja pede os preços.", aba: "agenda", botao: "Marcar a agenda" },
  ];
  if (passos.every((p) => p.feito)) return null;
  const feitos = passos.filter((p) => p.feito).length;
  return (
    <section className="cot-sem-impressao" style={{ ...S.cartao, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={S.h2}>Para começar</h2>
        <span style={{ ...S.chip, background: COR_CLARA, color: COR }}>{feitos} de 3</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10, marginTop: 10 }}>
        {passos.map((p, i) => (
          <div key={p.aba} style={{ borderRadius: 12, padding: 12, border: `1.5px solid ${p.feito ? "#BBF7D0" : "#E2E8F0"}`, background: p.feito ? "#F0FDF4" : "#F8FAFC" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13, background: p.feito ? VERDE : COR, color: "#fff" }}>{p.feito ? "✓" : i + 1}</span>
              <b style={{ color: "#0F172A" }}>{p.titulo}</b>
            </div>
            <div style={{ fontSize: 13, color: "#475569", margin: "6px 0 8px", lineHeight: 1.5 }}>{p.texto}</div>
            {!p.feito && <button type="button" onClick={() => irPara(p.aba)} style={{ ...S.botaoPequeno, borderColor: COR, color: COR }}>{p.botao} →</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Desligado: a página de venda ────────────────────────────────────────

function Oferta({ dados, salvando, onAtivar }: { dados: DadosDaCotacao; salvando: boolean; onAtivar: () => void }) {
  const m = dados.mensalidade;
  const comTeste = !dados.estado.jaTestou;
  return (
    <section style={{ ...S.cartao, marginTop: 16, borderColor: "#C7D2FE", background: `linear-gradient(180deg, ${COR_CLARA}, #fff)`, padding: "22px 22px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 900, color: COR, letterSpacing: ".04em" }}>COMPRE SEMPRE DO MAIS BARATO</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#0F172A", lineHeight: 1.25, marginTop: 6 }}>
            Os preços de todos os fornecedores, lado a lado, sem você ligar para ninguém.
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <span style={{ fontSize: 36, fontWeight: 900, color: COR }}>{reais(dados.preco)}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>por mês · {comTeste ? `${dados.diasDeTeste} dias grátis para testar` : "sem taxa de instalação"}</span>
          </div>
          {dados.estado.isento ? null : dados.podeContratar ? (
            <button type="button" onClick={onAtivar} disabled={salvando} style={{ ...S.botao, marginTop: 16, width: "100%", height: 52, fontSize: 17, fontWeight: 900 }}>
              {comTeste ? `Testar ${dados.diasDeTeste} dias grátis` : "Ativar a cotação automática"}
            </button>
          ) : (
            <p style={{ ...S.texto, marginTop: 12, fontWeight: 700 }}>Quem ativa a cotação é o dono da loja.</p>
          )}
          <p style={{ ...S.texto, marginTop: 10, fontSize: 12.5 }}>
            À parte da mensalidade do FireHub ({m.percentual}% do faturamento, mínimo de {reais(m.minimo)} e teto de {reais(m.teto)}).
            Desligou no teste, não paga nada.
          </p>
        </div>
        <ExemploDoComparativo />
      </div>
      <ul style={{ margin: "18px 0 0", paddingLeft: 20, color: "#334155", fontSize: 14.5, lineHeight: 1.9 }}>
        <li><b>Fornecedores ilimitados</b>, com pedido mínimo, dias de entrega, prazo e forma de pagamento.</li>
        <li>No dia e hora que você marcar, <b>a loja pede a tabela ou o encarte</b> a cada um pelo WhatsApp dela.</li>
        <li>O fornecedor responde do jeito dele — <b>texto, foto do encarte, PDF ou áudio</b> — e a loja entende.</li>
        <li><b>Comparativo</b> com o mais barato marcado, o preço anterior e o quanto subiu ou caiu. Exporta para Excel.</li>
        <li>Marque o que vai comprar e <b>mande o pedido a cada fornecedor</b> num toque, já com o total e a entrega.</li>
        <li>Pedido recebido <b>entra no estoque</b> com o custo, e você recebe no WhatsApp o resumo de cada cotação.</li>
      </ul>
    </section>
  );
}

/** A miniatura do comparativo na página de venda: mostra em 3 segundos o que o módulo faz. */
function ExemploDoComparativo() {
  const linhas: Array<[string, number[], number]> = [["Tomate (kg)", [7.9, 7.5, 8.4], 1], ["Mussarela (kg)", [38.9, 41.5, 36.9], 2], ["Coca lata (cx)", [42, 39.9, 44], 1]];
  return (
    <div aria-hidden style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2E8F0", boxShadow: "0 12px 30px rgba(67,56,202,.12)", overflow: "hidden", fontSize: 13 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(3, 1fr)", background: "#F8FAFC", fontWeight: 800, color: "#475569" }}>
        {["Produto", "Ceasa", "Hortifruti", "Atacado"].map((t) => <div key={t} style={{ padding: "8px 10px" }}>{t}</div>)}
      </div>
      {linhas.map(([nome, ps, melhor]) => (
        <div key={nome} style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(3, 1fr)", borderTop: "1px solid #F1F5F9" }}>
          <div style={{ padding: "9px 10px", fontWeight: 700, color: "#0F172A" }}>{nome}</div>
          {ps.map((p, i) => (
            <div key={i} style={{ padding: "9px 10px", whiteSpace: "nowrap", fontWeight: i === melhor ? 900 : 600, color: i === melhor ? VERDE : "#334155", background: i === melhor ? "#ECFDF5" : undefined }}>
              {reais(p)}{i === melhor ? " ✓" : ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ComoFunciona() {
  const passos = [
    ["🚚", "Cadastre", "Os fornecedores e o que você compra (digitando, colando, pela foto da nota ou por áudio)."],
    ["🗓️", "Agende", "Marque os dias e a hora. Ex.: toda segunda e quinta às 8h."],
    ["📨", "A loja pede", "Cada fornecedor recebe pelo WhatsApp da loja um pedido educado da tabela de preços."],
    ["🧠", "A loja entende", "Texto, foto do encarte, PDF ou áudio viram preço no comparativo, sozinhos."],
    ["✅", "Você compra", "Marca os itens, confere o total e o mínimo de cada um e manda o pedido."],
  ];
  return (
    <section style={{ ...S.cartao, marginTop: 16 }}>
      <h2 style={{ ...S.h2, marginBottom: 12 }}>Como funciona</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 12 }}>
        {passos.map(([icone, titulo, t], i) => (
          <div key={titulo} style={{ background: "#F8FAFC", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 26 }}>{icone}</div>
            <div style={{ fontWeight: 800, color: "#0F172A", marginTop: 4 }}>{i + 1}. {titulo}</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 2, lineHeight: 1.5 }}>{t}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Perguntas() {
  const qs: Array<[string, string]> = [
    ["A mensagem sai de qual número?", "Do WhatsApp da sua loja, o mesmo conectado ao robô. O fornecedor vê o nome da loja e responde ali mesmo."],
    ["E se o fornecedor mandar áudio ou foto?", "A loja lê do mesmo jeito: texto, foto do encarte, PDF ou áudio. O que ela não tiver certeza fica marcado para você confirmar com um toque."],
    ["O robô vai oferecer cardápio para o fornecedor?", "Não. Número cadastrado como fornecedor vai direto para a cotação; o robô de atendimento não responde a ele."],
    ["Corre risco de bloquear o WhatsApp?", "As mensagens saem uma de cada vez, com intervalo, só para os fornecedores que você cadastrou e só nos horários que você marcou."],
  ];
  return (
    <section style={{ ...S.cartao, marginTop: 16 }}>
      <h2 style={{ ...S.h2, marginBottom: 6 }}>Perguntas comuns</h2>
      {qs.map(([q, r]) => (
        <details key={q} style={{ borderTop: "1px solid #F1F5F9", padding: "10px 0" }}>
          <summary style={{ fontWeight: 800, color: "#0F172A", cursor: "pointer" }}>{q}</summary>
          <p style={{ ...S.texto, marginTop: 6 }}>{r}</p>
        </details>
      ))}
    </section>
  );
}

function Termo({ preco, diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  preco: number; diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DA_COTACAO}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", paddingBottom: 16 }}>
        <div style={{ padding: "18px 20px 0" }}>
          <strong style={{ fontSize: 17 }}>{TITULO_DO_TERMO_DA_COTACAO}</strong>
          <div style={{ fontSize: 13, color: "#64748B" }}>{reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DA_COTACAO.split("-").reverse().join("/")}</div>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: "14px 20px 0", paddingLeft: 20, fontSize: 13.5, color: "#334155", lineHeight: 1.6 }}>
          {CLAUSULAS_DO_TERMO_DA_COTACAO.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 20px 0", fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
          <input type="checkbox" checked={concordo} onChange={(ev) => setConcordo(ev.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, margin: "16px 20px 0" }}>
          <button type="button" onClick={onCancelar} disabled={salvando} style={{ ...S.botaoLeve, flex: 1 }}>Agora não</button>
          <button type="button" onClick={onAceitar} disabled={!concordo || salvando} style={{ ...S.botao, flex: 2, background: concordo ? COR : "#CBD5E1", cursor: concordo ? "pointer" : "default" }}>
            {salvando ? "Ativando…" : "Concordo e ativar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const CSS_DA_PAGINA = `
.cot-abas { display: flex; gap: 6px; margin-top: 16px; overflow-x: auto; padding-bottom: 2px; border-bottom: 1px solid #E2E8F0; }
.cot-abas button { border: 0; background: none; padding: 10px 14px; font-weight: 800; font-size: 14.5px; color: #64748B; cursor: pointer; font-family: inherit; border-bottom: 3px solid transparent; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
.cot-abas button.ativa { color: ${COR}; border-bottom-color: ${COR}; }
.cot-abas .conta { font-size: 11px; background: #EEF2FF; color: ${COR}; border-radius: 999px; padding: 1px 7px; }
@media print {
  .cot-sem-impressao, aside, nav, header, [data-sem-impressao] { display: none !important; }
  .cot-pagina { max-width: none !important; padding: 0 !important; }
  .cot-tabela-rolagem { overflow: visible !important; max-height: none !important; }
  body { background: #fff !important; }
}
`;
