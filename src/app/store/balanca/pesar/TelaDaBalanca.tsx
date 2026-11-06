"use client";

/**
 * A TELA DA BALANÇA — fica ligada no tablet (ou PC) ao lado da balança, em
 * tela cheia, e o próprio cliente usa:
 *
 *   1. "Coloque o prato" — a tela pergunta o peso à balança a cada ~300 ms;
 *   2. o peso firma (a balança parou de mexer e repetiu o valor) — mostra o
 *      peso × o preço do quilo e pede o cartão;
 *   3. o leitor lê o cartão ("digita" o número e um Enter) — lança na comanda
 *      (POST /api/store/balanca/pesar, que recalcula o preço no servidor);
 *   4. "Retire o prato" — só volta ao começo quando a balança zera, para o
 *      mesmo prato não ser lançado duas vezes.
 *
 * Inmetro (Portaria 157/2022): o peso aqui é uma cópia; o que vale é o visor
 * da balança, que o cliente tem que ver. Por isso o "Não verificado" ao lado.
 *
 * `simular`: uma Prix 3 Fit de mentira (lib/balanca/leitor-serial.ts) e NADA é
 * lançado — serve para treinar a equipe e mostrar ao cliente sem gerar pedido
 * (pedido de teste contaria no caixa e na mensalidade).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { LeitorDaBalanca, PortaSimulada, conectarNaBalanca, serialDoNavegador, type PortaSerial } from "@/lib/balanca/leitor-serial";
import { PESO_MINIMO_KG, pesoFirme, textoDoPeso, valorDoPeso, type LeituraDaBalanca } from "@/lib/balanca/protocolo-toledo";
import { numeroLidoDoCartao } from "@/lib/comanda";

type Produto = { id: string; nome: string; precoDoQuilo: number };
type Fase =
  | { tipo: "esperando" }
  | { tipo: "lancando"; kg: number }
  | { tipo: "lancado"; kg: number; comanda: number; valor: number; total: number | null }
  | { tipo: "erro"; kg: number; mensagem: string };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const CHAVE_VELOCIDADE = "firehub_balanca_velocidade";
const CHAVE_PRODUTO = "firehub_balanca_produto";
const INTERVALO_MS = 300;
/** Perguntas seguidas sem resposta até a tela dizer que a balança caiu (~3 s). */
const SEM_RESPOSTA_PARA_CAIR = 10;

const ler = (chave: string) => { try { return localStorage.getItem(chave); } catch { return null; } };
const gravar = (chave: string, valor: string) => { try { localStorage.setItem(chave, valor); } catch {} };

export default function TelaDaBalanca({ ligada, simular, nomeDaLoja, produtos }: {
  ligada: boolean; simular: boolean; nomeDaLoja: string; produtos: Produto[];
}) {
  const [conexao, setConexao] = useState<"desligada" | "conectando" | "conectada" | "sem_suporte" | "caiu">("desligada");
  const [leitura, setLeitura] = useState<LeituraDaBalanca | null>(null);
  const [firme, setFirme] = useState<number | null>(null);
  const [fase, setFase] = useState<Fase>({ tipo: "esperando" });
  const [produtoId, setProdutoId] = useState<string>(() => produtos[0]?.id ?? "");
  const [cartao, setCartao] = useState("");
  const leitorRef = useRef<LeitorDaBalanca | null>(null);
  const simuladaRef = useRef<PortaSimulada | null>(null);
  const ultimasRef = useRef<LeituraDaBalanca[]>([]);
  const faseRef = useRef(fase);
  faseRef.current = fase;
  const campoRef = useRef<HTMLInputElement>(null);

  const produto = produtos.find((p) => p.id === produtoId) ?? produtos[0];

  useEffect(() => {
    const salvo = ler(CHAVE_PRODUTO);
    if (salvo && produtos.some((p) => p.id === salvo)) setProdutoId(salvo);
  }, [produtos]);

  // A tela não pode apagar no meio do almoço.
  useEffect(() => {
    let trava: any = null;
    const pedir = async () => { try { trava = await (navigator as any).wakeLock?.request("screen"); } catch {} };
    pedir();
    const voltou = () => { if (document.visibilityState === "visible") pedir(); };
    document.addEventListener("visibilitychange", voltou);
    return () => { document.removeEventListener("visibilitychange", voltou); try { trava?.release(); } catch {} };
  }, []);

  const conectar = useCallback(async (porta: PortaSerial) => {
    setConexao("conectando");
    const preferida = Number(ler(CHAVE_VELOCIDADE)) || null;
    const leitor = await conectarNaBalanca(porta, preferida);
    if (!leitor) { setConexao("caiu"); return; }
    if (leitor.velocidade) gravar(CHAVE_VELOCIDADE, String(leitor.velocidade));
    leitorRef.current = leitor;
    setConexao("conectada");
  }, []);

  // Liga sozinho: simulada, ou a porta que este navegador já tem permissão.
  useEffect(() => {
    if (!ligada) return;
    if (simular) {
      const p = new PortaSimulada();
      simuladaRef.current = p;
      conectar(p);
      return;
    }
    const serial = serialDoNavegador();
    if (!serial) { setConexao("sem_suporte"); return; }
    serial.getPorts().then((portas) => { if (portas[0]) conectar(portas[0]); }).catch(() => {});
    return () => { leitorRef.current?.fechar(); };
  }, [ligada, simular, conectar]);

  async function escolherPorta() {
    const serial = serialDoNavegador();
    if (!serial) { setConexao("sem_suporte"); return; }
    try {
      await leitorRef.current?.fechar();
      conectar(await serial.requestPort());
    } catch {
      // Fechou a janela sem escolher.
    }
  }

  // Pergunta o peso o tempo todo.
  useEffect(() => {
    if (conexao !== "conectada") return;
    let vivo = true;
    let semResposta = 0;
    (async () => {
      while (vivo) {
        const l = await leitorRef.current?.pedirPeso();
        if (!vivo) break;
        if (!l) {
          semResposta++;
          if (semResposta >= SEM_RESPOSTA_PARA_CAIR) { setConexao("caiu"); break; }
        } else {
          semResposta = 0;
          ultimasRef.current = [...ultimasRef.current.slice(-4), l];
          setLeitura(l);
          setFirme(pesoFirme(ultimasRef.current));
          // Prato retirado depois do lançamento (ou do erro): volta ao começo.
          const f = faseRef.current;
          const vazia = l.tipo === "peso" ? l.kg < PESO_MINIMO_KG : l.tipo === "negativo";
          if ((f.tipo === "lancado" || f.tipo === "erro") && vazia) setFase({ tipo: "esperando" });
        }
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
      }
    })();
    return () => { vivo = false; };
  }, [conexao]);

  // Peso firme e esperando: o campo do cartão pega o foco (o leitor "digita" nele).
  const prontoParaCartao = fase.tipo === "esperando" && firme !== null && !!produto;
  useEffect(() => { if (prontoParaCartao) campoRef.current?.focus(); }, [prontoParaCartao]);

  async function lancar(texto: string) {
    setCartao("");
    if (!produto || firme === null || fase.tipo !== "esperando") return;
    const kg = firme;
    const comanda = numeroLidoDoCartao(texto);
    if (!comanda) { setFase({ tipo: "erro", kg, mensagem: "Cartão não lido. Retire o prato e pese de novo." }); return; }
    if (simular) {
      setFase({ tipo: "lancado", kg, comanda, valor: valorDoPeso(kg, produto.precoDoQuilo), total: null });
      return;
    }
    setFase({ tipo: "lancando", kg });
    try {
      const r = await fetch("/api/store/balanca/pesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comanda, produtoId: produto.id, pesoKg: kg }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || j.mensagem || "Não lançou. Chame um atendente.");
      setFase({ tipo: "lancado", kg, comanda, valor: j.valor, total: j.totalDaComanda ?? null });
    } catch (e: any) {
      setFase({ tipo: "erro", kg, mensagem: `${e.message} O prato NÃO foi lançado.` });
    }
  }

  // ─── Desenho ───────────────────────────────────────────────────────────
  const fundo: React.CSSProperties = {
    // Por cima de tudo do painel, inclusive os botões flutuantes de contato: quem
    // usa esta tela é o cliente do self-service.
    position: "fixed", inset: 0, zIndex: 2147483000, background: "#0F172A", color: "#fff",
    display: "flex", flexDirection: "column", fontFamily: "inherit",
  };

  if (!ligada || produtos.length === 0) {
    return (
      <div style={{ ...fundo, alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 16 }}>
        <div style={{ fontSize: 56 }}>⚖️</div>
        <h1 style={{ margin: 0, fontSize: 26 }}>{!ligada ? "O módulo Balança está desligado" : "Nenhum produto por quilo escolhido"}</h1>
        <p style={{ margin: 0, color: "#CBD5E1", fontSize: 17, maxWidth: 520 }}>
          {!ligada ? "O dono da loja ativa em Balança, no menu do painel." : "Marque o produto do self-service em Balança › Produtos vendidos por quilo."}
        </p>
        <a href="/store/balanca" style={{ color: "#5EEAD4", fontWeight: 800, fontSize: 17 }}>Ir para Balança →</a>
      </div>
    );
  }

  const kgNaTela = leitura?.tipo === "peso" ? leitura.kg : null;
  const valorNaTela = firme !== null && produto ? valorDoPeso(firme, produto.precoDoQuilo) : null;

  let titulo: string;
  let subtitulo = "";
  let cor = "#E2E8F0";
  if (conexao === "sem_suporte") {
    titulo = "Este navegador não lê a balança";
    subtitulo = "Abra esta tela no Chrome (no computador, o Edge também serve). Dentro do app do FireHub não funciona.";
    cor = "#FCA5A5";
  } else if (conexao === "desligada" || conexao === "caiu") {
    titulo = conexao === "caiu" ? "A balança não está respondendo" : "Conecte a balança";
    subtitulo = conexao === "caiu"
      ? "Confira o cabo (ou o Bluetooth) e se a saída serial da balança está ligada para PDV. Depois toque em Conectar."
      : "Toque em Conectar e escolha a porta da balança (no tablet, o adaptador Bluetooth pareado).";
    cor = "#FCD34D";
  } else if (conexao === "conectando") {
    titulo = "Conectando na balança…";
  } else if (fase.tipo === "lancando") {
    titulo = "Lançando…";
  } else if (fase.tipo === "lancado") {
    titulo = `✅ ${reais(fase.valor)} na comanda ${fase.comanda}`;
    subtitulo = `${simular ? "SIMULAÇÃO — nada foi lançado. " : ""}${fase.total !== null ? `Total da comanda: ${reais(fase.total)}. ` : ""}Retire o prato.`;
    cor = "#86EFAC";
  } else if (fase.tipo === "erro") {
    titulo = "⚠️ Não lançou";
    subtitulo = fase.mensagem;
    cor = "#FCA5A5";
  } else if (leitura?.tipo === "sobrecarga") {
    titulo = "Peso acima da capacidade da balança";
    cor = "#FCA5A5";
  } else if (leitura?.tipo === "negativo") {
    titulo = "Balança abaixo de zero";
    subtitulo = "Peça ao atendente para zerar a tara na balança.";
    cor = "#FCD34D";
  } else if (firme !== null) {
    titulo = "Passe o cartão da comanda";
    cor = "#5EEAD4";
  } else if ((kgNaTela !== null && kgNaTela >= PESO_MINIMO_KG) || leitura?.tipo === "instavel") {
    titulo = "Aguarde o peso firmar…";
  } else {
    titulo = "Coloque o prato na balança";
  }

  return (
    <div style={fundo}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #1E293B", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 18 }}>⚖️ {nomeDaLoja}</strong>
        {simular && <span style={{ background: "#F59E0B", color: "#111827", fontWeight: 900, fontSize: 12, padding: "3px 8px", borderRadius: 6 }}>SIMULAÇÃO — NÃO LANÇA</span>}
        <span style={{ flex: 1 }} />
        {produtos.length > 1 && produtos.map((p) => (
          <button key={p.id} type="button" onClick={() => { setProdutoId(p.id); gravar(CHAVE_PRODUTO, p.id); }} style={{
            padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer", fontWeight: 800, fontFamily: "inherit",
            background: p.id === produto?.id ? "#14B8A6" : "#1E293B", color: "#fff",
          }}>{p.nome} · {reais(p.precoDoQuilo)}/kg</button>
        ))}
        {produtos.length === 1 && <span style={{ color: "#94A3B8", fontWeight: 700 }}>{produto?.nome} · {reais(produto?.precoDoQuilo ?? 0)}/kg</span>}
        {!simular && (conexao === "desligada" || conexao === "caiu" || conexao === "conectada") && (
          <button type="button" onClick={escolherPorta} style={{
            padding: "8px 14px", borderRadius: 10, border: "1px solid #334155", background: conexao === "conectada" ? "transparent" : "#14B8A6",
            color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
          }}>{conexao === "conectada" ? "Trocar balança" : "Conectar balança"}</button>
        )}
        <a href="/store/balanca" style={{ color: "#94A3B8", fontSize: 14 }}>Sair</a>
      </header>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 900, color: cor, lineHeight: 1.15 }}>{titulo}</div>
        {subtitulo && <div style={{ fontSize: "clamp(16px, 2.4vw, 22px)", color: "#CBD5E1", maxWidth: 760 }}>{subtitulo}</div>}

        {conexao === "conectada" && (
          <div style={{ display: "flex", gap: 28, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
            <div>
              <div style={{ fontSize: "clamp(56px, 11vw, 120px)", fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {kgNaTela !== null ? textoDoPeso(kgNaTela) : leitura?.tipo === "instavel" ? "…" : "—"}
              </div>
              <div style={{ fontSize: 13, color: "#94A3B8", marginTop: 16 }}>
                Não verificado — o peso que vale é o do visor da balança
              </div>
            </div>
            {valorNaTela !== null && fase.tipo === "esperando" && (
              <div style={{ fontSize: "clamp(40px, 7vw, 80px)", fontWeight: 900, color: "#5EEAD4", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {reais(valorNaTela)}
              </div>
            )}
          </div>
        )}

        {prontoParaCartao && (
          <form onSubmit={(e) => { e.preventDefault(); lancar(cartao); }} style={{ display: "flex", gap: 10, width: "100%", maxWidth: 520, marginTop: 8 }}>
            <input ref={campoRef} value={cartao} onChange={(e) => setCartao(e.target.value)} inputMode="numeric"
              placeholder="Nº do cartão" aria-label="Número do cartão da comanda" autoComplete="off"
              style={{ flex: 1, minWidth: 0, padding: "16px 18px", borderRadius: 14, border: "3px solid #14B8A6", background: "#0B1220", color: "#fff", fontSize: 28, fontWeight: 900, textAlign: "center", fontFamily: "inherit" }} />
            <button type="submit" style={{ padding: "0 26px", borderRadius: 14, border: "none", background: "#14B8A6", color: "#0F172A", fontSize: 22, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Lançar</button>
          </form>
        )}
      </main>

      {simular && conexao === "conectada" && (
        <footer style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", padding: 16, borderTop: "1px solid #1E293B", background: "#111827" }}>
          <span style={{ alignSelf: "center", color: "#FCD34D", fontWeight: 800 }}>Balança de teste:</span>
          {[0.312, 0.452, 0.687].map((kg) => (
            <button key={kg} type="button" onClick={() => simuladaRef.current?.pesar(kg)} style={botaoDeTeste}>Pôr prato de {textoDoPeso(kg)}</button>
          ))}
          <button type="button" onClick={() => simuladaRef.current?.tirar()} style={botaoDeTeste}>Tirar o prato</button>
        </footer>
      )}
    </div>
  );
}

const botaoDeTeste: React.CSSProperties = {
  padding: "10px 16px", borderRadius: 10, border: "1px solid #F59E0B", background: "transparent", color: "#FCD34D",
  fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
