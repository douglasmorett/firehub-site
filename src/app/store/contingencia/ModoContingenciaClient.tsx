"use client";

/**
 * A tela do Modo Contingência (app/store/contingencia/page.tsx).
 *
 * Conversa com DOIS lados:
 *   - a nuvem (/api/contingencia/estado, /ativar): se a loja ativou, o último
 *     relato do computador, as quedas e os conflitos;
 *   - o Assistente DESTE computador (127.0.0.1:7899, lib/print.ts →
 *     fetchAssistente): ativar só faz sentido no computador do caixa, que é
 *     onde a contingência roda.
 *
 * Pedido do Douglas (13/10/2026): a tela tem que se explicar sozinha, para o
 * dono ativar sem chamar o suporte. Por isso o desenho do "Como funciona" e o
 * passo a passo que olha o estado de verdade (Assistente achado, versão nova,
 * ativado, cópia pronta, teste feito) e abre só o passo da vez, com o botão
 * certo dentro dele. Os `data-*` são as âncoras do vídeo
 * (tutoriais/roteiros/contingencia.mjs).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Check, CheckCircle2, Clock, Download, FlaskConical, LifeBuoy, Monitor, Pause, Printer,
  RefreshCw, Router, ShieldCheck, Smartphone, Tv, Wifi,
} from "lucide-react";
import { fetchAssistente } from "@/lib/print";
import TutorialDaTela from "@/components/TutorialDaTela";
import { useTutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { tutoriaisDaTela } from "@/lib/tutoriais";
import IlustracaoDaContingencia from "./IlustracaoDaContingencia";

const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];
/** Teste feito neste navegador: só para o passo 5 aparecer como feito. */
const CHAVE_TESTOU = "firehub_contingencia_testou";
/** Erro de rede do download, que o Assistente resolve sozinho na próxima tentativa. */
const ERRO_PASSAGEIRO = /→ \d{3}|fetch failed|timeout|timed out|ECONN|ETIMEDOUT|aborted|socket|network|incompleto/i;

type EstadoDaNuvem = {
  ativada: boolean;
  dono: boolean;
  slug?: string | null;
  ativadaEm?: string;
  ativadaPor?: string | null;
  ultimoContato?: string | null;
  relato?: {
    modo?: string;
    copiaEm?: string | null;
    pendentes?: number;
    versao?: string;
    ips?: string[];
    porta?: number;
    ultimoErro?: string | null;
  } | null;
  episodios?: { id: string; inicio: string | null; fim: string | null; subiuEm: string; linhas: number; pedidos: number; conflitos: number }[];
  conflitos?: { tabela: string; coluna: string | null; decisao: string; em: string }[];
};

type ContingenciaDoAssistente = {
  ativa: boolean;
  pronta?: boolean;
  testando?: boolean;
  modo?: string;
  etapa?: string;
  progresso?: number | null;
  erro?: string | null;
  memoriaTotalMb?: number;
};

type EstadoDoAssistente =
  | { achado: false }
  | { achado: true; porta: number; versao?: string; contingencia: null | ContingenciaDoAssistente };

const cor = {
  borda: "#E2E8F0", texto: "#0F172A", suave: "#64748B", fundo: "#F8FAFC",
  roxo: "#7C3AED", roxoEscuro: "#6D28D9", roxoClaro: "#F5F3FF", roxoBorda: "#DDD6FE",
  verde: "#16A34A", verdeClaro: "#F0FDF4",
};

const botaoRoxo: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  background: `linear-gradient(135deg,#8B5CF6,${cor.roxoEscuro})`, color: "#fff", border: 0, borderRadius: 12,
  padding: "12px 18px", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "inherit",
  boxShadow: "0 4px 14px rgba(109,40,217,.3)", textDecoration: "none",
};
const botaoClaro: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  background: "#fff", color: cor.texto, border: `1.5px solid ${cor.borda}`, borderRadius: 12,
  padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", textDecoration: "none",
};

function Cartao({ titulo, sub, children, ancora }: { titulo?: string; sub?: string; children: React.ReactNode; ancora?: string }) {
  return (
    <section
      data-secao={ancora}
      style={{ background: "#fff", border: `1.5px solid ${cor.borda}`, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}
    >
      {titulo && <h2 style={{ fontSize: 17, fontWeight: 900, margin: sub ? "0 0 2px" : "0 0 12px", color: cor.texto }}>{titulo}</h2>}
      {sub && <p style={{ margin: "0 0 14px", fontSize: 14, color: cor.suave }}>{sub}</p>}
      {children}
    </section>
  );
}

function haQuanto(iso?: string | null): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

function dataHora(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function acharAssistente(): Promise<EstadoDoAssistente> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/status`, { cache: "no-store" });
      if (!r.ok) continue;
      const status = await r.json().catch(() => ({}));
      let contingencia: ContingenciaDoAssistente | null = null;
      try {
        const c = await fetchAssistente(`http://127.0.0.1:${porta}/contingencia/estado`, { cache: "no-store" });
        if (c.ok) contingencia = await c.json();
      } catch {
        /* Assistente antigo: não conhece a contingência */
      }
      return { achado: true, porta, versao: status?.versao || status?.version, contingencia };
    } catch {
      /* próxima porta */
    }
  }
  return { achado: false };
}

type SituacaoDoPasso = "feito" | "agora" | "depois";

/** Um passo do "Ative em 5 passos": só o da vez abre, com o que fazer dentro. */
function Passo({ n, titulo, resumo, situacao, children }: {
  n: number; titulo: string; resumo: string; situacao: SituacaoDoPasso; children?: React.ReactNode;
}) {
  const aberto = situacao === "agora";
  return (
    <li
      data-passo={n}
      data-situacao={situacao}
      style={{
        listStyle: "none", display: "grid", gridTemplateColumns: "34px 1fr", gap: 12,
        padding: aberto ? "16px 16px 18px" : "12px 16px",
        borderRadius: 14, marginBottom: 10,
        border: `1.5px solid ${aberto ? cor.roxo : situacao === "feito" ? "#BBF7D0" : cor.borda}`,
        background: aberto ? cor.roxoClaro : situacao === "feito" ? cor.verdeClaro : "#fff",
        boxShadow: aberto ? "0 6px 20px rgba(124,58,237,.12)" : "none",
        transition: "background .3s ease, border-color .3s ease",
      }}
    >
      <div
        style={{
          width: 34, height: 34, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, fontSize: 15,
          background: situacao === "feito" ? cor.verde : aberto ? cor.roxo : "#E2E8F0",
          color: situacao === "depois" ? "#64748B" : "#fff",
        }}
      >
        {situacao === "feito" ? <Check size={18} strokeWidth={3} /> : n}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minHeight: 34 }}>
          <strong style={{ fontSize: 15.5, color: situacao === "depois" ? "#475569" : cor.texto }}>{titulo}</strong>
          {situacao === "feito" && <span style={{ fontSize: 12, fontWeight: 800, color: cor.verde }}>Feito</span>}
          {aberto && <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: cor.roxo, borderRadius: 999, padding: "2px 8px" }}>FAÇA AGORA</span>}
        </div>
        {situacao === "depois" && <p style={{ margin: "2px 0 0", fontSize: 13.5, color: cor.suave, lineHeight: 1.45 }}>{resumo}</p>}
        {aberto && <div style={{ marginTop: 6, fontSize: 14.5, lineHeight: 1.55, color: "#1E293B" }}>{children}</div>}
      </div>
    </li>
  );
}

function Requisito({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 12, borderRadius: 12, background: cor.fundo }}>
      <div style={{ flex: "0 0 auto", width: 40, height: 40, borderRadius: 11, background: cor.roxoClaro, color: cor.roxo, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icone}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: cor.texto }}>{titulo}</div>
        <div style={{ fontSize: 13, color: cor.suave, lineHeight: 1.45 }}>{texto}</div>
      </div>
    </div>
  );
}

const DUVIDAS: { p: string; r: string }[] = [
  { p: "Como abro o FireHub sem internet?", r: "Pelo ícone FireHub que aparece sozinho na área de trabalho do computador do caixa, ou pelo endereço de sempre. Sem internet, o navegador leva ao computador da loja já com você dentro, sem pedir senha." },
  { p: "E se ficar dias sem internet?", r: "A loja continua funcionando: pedidos, balcão, mesas, cozinha, abrir e fechar o caixa e impressão. A entrada guardada vale por até um ano sem nenhuma conexão. Quando a internet voltar, tudo sobe sozinho." },
  { p: "Preciso fazer alguma coisa quando a internet cair?", r: "Não. Em uns 15 segundos as telas passam sozinhas para o computador do caixa, e voltam sozinhas quando a internet volta." },
  { p: "E se o computador do caixa estiver desligado?", r: "Aí não tem contingência. Com internet, a TV e o celular do garçom continuam funcionando normalmente pela nuvem." },
  { p: "Os pedidos feitos na queda duplicam?", r: "Não. Cada pedido sobe uma vez só. Se alguma coisa foi mudada nos dois lugares ao mesmo tempo, ela aparece em \"Últimas quedas\", nesta tela." },
  { p: "Posso mexer pelo celular no 4G durante a queda?", r: "O 4G não alcança o computador da loja. Durante a queda, use as telas que estão no Wi-Fi da loja." },
  { p: "Troquei de computador. E agora?", r: "Abra esta tela no computador novo e clique em Ativar neste computador. O antigo para de receber a cópia." },
  { p: "Quanto custa?", r: "Está incluído no plano, sem custo a mais." },
];

export default function ModoContingenciaClient() {
  const [nuvem, setNuvem] = useState<EstadoDaNuvem | null>(null);
  const [assistente, setAssistente] = useState<EstadoDoAssistente | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [qr, setQr] = useState("");
  const [testou, setTestou] = useState(false);
  const videos = tutoriaisDaTela("/store/contingencia", useTutoriaisEnviados());

  const atualizar = useCallback(async () => {
    const r = await fetch("/api/contingencia/estado", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setNuvem(await r.json());
    setAssistente(await acharAssistente());
  }, []);

  useEffect(() => {
    atualizar();
    const t = setInterval(atualizar, 5000);
    return () => clearInterval(t);
  }, [atualizar]);

  useEffect(() => {
    try { setTestou(localStorage.getItem(CHAVE_TESTOU) === "1"); } catch {}
  }, []);

  const enderecos = useMemo(() => {
    const ips = nuvem?.relato?.ips || [];
    const porta = nuvem?.relato?.porta || 7890;
    return ips.map((ip) => `http://${ip}:${porta}`);
  }, [nuvem]);

  useEffect(() => {
    // O QR leva ao app do garçom PELO computador da loja: com internet, a
    // porta da loja manda para a nuvem; sem, atende ela mesma. Assim o
    // celular aprende o endereço da loja já no primeiro uso.
    if (!enderecos[0] || !nuvem?.slug) return setQr("");
    QRCode.toDataURL(`${enderecos[0]}/garcom/${nuvem.slug}`, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(""));
  }, [enderecos, nuvem?.slug]);

  const contingenciaAqui = assistente?.achado ? assistente.contingencia : null;
  const podeMexer = !!nuvem?.dono;
  const relato = nuvem?.relato;
  const online = nuvem?.ultimoContato && Date.now() - new Date(nuvem.ultimoContato).getTime() < 90_000;

  // ── Em que passo a loja está ──────────────────────────────────────────────
  // Ativada na nuvem vale como "computador achado e atualizado" mesmo vista do
  // celular: quem já ativou não tem por que voltar ao passo 1.
  const ativada = !!nuvem?.ativada;
  const emOutroComputador = ativada && !!contingenciaAqui && !contingenciaAqui.ativa;
  const feito = {
    1: !!assistente?.achado || ativada,
    2: !!contingenciaAqui || ativada,
    3: ativada && !emOutroComputador,
    4: ativada && !!relato?.copiaEm && (!contingenciaAqui?.ativa || contingenciaAqui.etapa === "pronta"),
    5: testou || (nuvem?.episodios?.length || 0) > 0,
  } as const;
  const daVez = nuvem ? (([1, 2, 3, 4, 5] as const).find((n) => !feito[n]) ?? null) : 1;
  const situacao = (n: 1 | 2 | 3 | 4 | 5): SituacaoDoPasso => (feito[n] ? "feito" : daVez === n ? "agora" : "depois");
  const memoriaGb = contingenciaAqui?.memoriaTotalMb ? contingenciaAqui.memoriaTotalMb / 1024 : null;
  const procurarDeNovo = () => { setAssistente(null); atualizar(); };

  async function ativar() {
    if (!assistente?.achado) return;
    setOcupado("ativar");
    setMensagem("");
    try {
      const r = await fetch("/api/contingencia/ativar", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não foi possível ativar.");
      const p = await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/parear`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lojaId: d.lojaId, chave: d.chave, segredoDoBilhete: d.segredoDoBilhete, nuvem: d.nuvem }),
      });
      if (!p.ok) throw new Error((await p.json().catch(() => ({})))?.error || "O Assistente não aceitou a ativação.");
      setMensagem("✅ Ativado neste computador. Agora o Assistente baixa o FireHub e faz a cópia da loja — acompanhe no passo 4.");
      await atualizar();
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message || "Não foi possível ativar."}`);
    } finally {
      setOcupado("");
    }
  }

  async function desativar() {
    if (!confirm("Desativar o Modo Contingência? Se a internet cair, a loja volta a parar como antes.")) return;
    setOcupado("desativar");
    try {
      await fetch("/api/contingencia/ativar", { method: "DELETE" });
      if (assistente?.achado) {
        await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/desparear`, { method: "POST" }).catch(() => null);
      }
      setMensagem("Modo Contingência desativado.");
      await atualizar();
    } finally {
      setOcupado("");
    }
  }

  async function testar() {
    if (!assistente?.achado) return;
    setOcupado("testar");
    setMensagem("");
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${assistente.porta}/contingencia/testar`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "O teste não começou.");
      try { localStorage.setItem(CHAVE_TESTOU, "1"); } catch {}
      setTestou(true);
      setMensagem("🧪 Teste começou: por 2 minutos este computador age como se a internet tivesse caído. Em uns 15 segundos as telas abertas NESTE computador vão para o computador da loja, com a faixa de aviso embaixo. Lance um pedido de teste no Balcão, se quiser — ele sobe sozinho no fim.");
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message}`);
    } finally {
      setOcupado("");
    }
  }

  const travaTroca = emOutroComputador && !!relato?.pendentes;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "20px 16px 60px", color: cor.texto, fontFamily: "inherit" }}>
      <header style={{ marginBottom: 18, display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 auto", width: 52, height: 52, borderRadius: 15, background: `linear-gradient(135deg,#8B5CF6,${cor.roxoEscuro})`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(109,40,217,.3)" }}>
          <LifeBuoy size={28} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Modo Contingência</h1>
            <span style={{ background: cor.roxo, color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 10px" }}>NOVO</span>
          </div>
          <p style={{ color: cor.suave, fontSize: 15, margin: "6px 0 0", lineHeight: 1.5 }}>
            A internet caiu? <strong style={{ color: cor.texto }}>Sua loja não para.</strong> O computador do caixa assume as mesmas telas
            e a mesma impressão, e quando a conexão volta tudo sobe sozinho. É opcional e está incluído no plano.
          </p>
        </div>
      </header>

      {mensagem && (
        <div style={{ background: cor.roxoClaro, border: `1.5px solid ${cor.roxoBorda}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.45 }}>
          {mensagem}
        </div>
      )}

      <Cartao titulo="Como funciona" sub="Veja o que acontece na sua loja em cada momento." ancora="como-funciona">
        <IlustracaoDaContingencia />
      </Cartao>

      <Cartao
        titulo={daVez === null ? "Sua loja está protegida" : "Ative em 5 passos"}
        sub={daVez === null
          ? "Está tudo pronto. Se a internet cair, ninguém precisa fazer nada. Para abrir o FireHub sem internet, use o ícone FireHub da área de trabalho."
          : "Esta lista acompanha o que você já fez. O passo da vez fica em roxo, com o botão dentro."}
        ancora="passos"
      >
        <ol style={{ margin: 0, padding: 0 }}>
          <Passo n={1} titulo="Abra esta tela no computador do caixa" resumo="O computador onde o Assistente de Impressão está instalado." situacao={situacao(1)}>
            {assistente === null ? (
              <p style={{ margin: 0, color: cor.suave }}>Procurando o Assistente neste computador…</p>
            ) : (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  O Modo Contingência roda no <strong>computador do caixa</strong>, o mesmo onde está o Assistente de Impressão que
                  imprime suas comandas. <strong>Não achamos o Assistente neste aparelho.</strong>
                </p>
                <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                  <li>Está no celular ou em outro computador? Abra o FireHub no computador do caixa e entre nesta mesma tela.</li>
                  <li>Ainda não tem o Assistente? Baixe e instale em Impressoras.</li>
                </ul>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <a href="/store/impressoras" style={botaoRoxo}><Download size={18} /> Baixar o Assistente</a>
                  <button type="button" onClick={procurarDeNovo} style={botaoClaro}><RefreshCw size={16} /> Já instalei, procurar de novo</button>
                </div>
              </>
            )}
          </Passo>

          <Passo n={2} titulo="Deixe o Assistente atualizado" resumo="A contingência vem na versão nova do Assistente." situacao={situacao(2)}>
            <p style={{ margin: "0 0 8px" }}>
              Achamos o Assistente{assistente?.achado && assistente.versao ? ` (versão ${assistente.versao})` : ""}, mas ele é de uma versão sem o Modo Contingência. Para atualizar:
            </p>
            <ol style={{ margin: "0 0 12px", paddingLeft: 20 }}>
              <li>No canto de baixo da tela, perto do relógio, ache o <strong>ícone do FireHub</strong> (se não aparecer, clique na setinha ^).</li>
              <li>Clique nele com o <strong>botão direito</strong> e escolha <strong>Procurar atualização agora</strong>.</li>
              <li>Espere uns minutos e clique no botão abaixo.</li>
            </ol>
            <button type="button" onClick={procurarDeNovo} style={botaoClaro}><RefreshCw size={16} /> Já atualizei, conferir</button>
          </Passo>

          <Passo n={3} titulo="Clique em Ativar neste computador" resumo="Um clique: o Assistente baixa o que precisa sozinho." situacao={situacao(3)}>
            {emOutroComputador ? (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  A contingência está ativada em <strong>outro computador</strong>. Para usar este no lugar dele, ative aqui — o outro deixa de receber a cópia.
                </p>
                {travaTroca && (
                  <p style={{ margin: "0 0 10px", color: "#B91C1C" }}>
                    O computador atual ainda tem {relato?.pendentes} mudança(s) para subir. Espere subir antes de trocar.
                  </p>
                )}
              </>
            ) : (
              <p style={{ margin: "0 0 10px" }}>
                Assistente encontrado. Ao ativar, ele baixa o FireHub para este computador (uns 250 MB na primeira vez; depois, só o que mudar)
                e faz a cópia da loja. <strong>Pode continuar trabalhando enquanto isso.</strong>
              </p>
            )}
            {memoriaGb !== null && memoriaGb < 3.8 && (
              <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "#B45309" }}>
                Este computador tem {memoriaGb.toFixed(1).replace(".", ",")} GB de memória. Funciona, mas o recomendado é 4 GB ou mais.
              </p>
            )}
            <button
              type="button"
              data-acao="ativar"
              disabled={!podeMexer || !!ocupado || travaTroca}
              onClick={ativar}
              style={{ ...botaoRoxo, opacity: !podeMexer || ocupado || travaTroca ? 0.6 : 1 }}
            >
              <LifeBuoy size={18} /> {ocupado === "ativar" ? "Ativando…" : "Ativar neste computador"}
            </button>
            {!podeMexer && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: cor.suave }}>Só o dono da loja pode ativar.</p>}
          </Passo>

          <Passo n={4} titulo="Espere a cópia da loja ficar pronta" resumo="Leva alguns minutos e você pode seguir usando o FireHub." situacao={situacao(4)}>
            {contingenciaAqui?.ativa ? (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  Agora: <strong>{contingenciaAqui.etapa && contingenciaAqui.etapa !== "pronta" ? contingenciaAqui.etapa : "copiando os dados da loja"}</strong>
                  {typeof contingenciaAqui.progresso === "number" ? ` — ${Math.round(contingenciaAqui.progresso)}%` : "…"}
                </p>
                <div style={{ height: 10, borderRadius: 999, background: "#EDE9FE", overflow: "hidden", marginBottom: 8 }}>
                  <div
                    data-barra-da-copia
                    style={{
                      height: "100%", borderRadius: 999, background: `linear-gradient(90deg,#8B5CF6,${cor.roxoEscuro})`,
                      width: `${typeof contingenciaAqui.progresso === "number" ? Math.max(4, Math.min(100, contingenciaAqui.progresso)) : 35}%`,
                      transition: "width .6s ease",
                    }}
                  />
                </div>
                {contingenciaAqui.erro && (
                  // Falha de rede no download (deploy trocando de servidor, internet
                  // piscando) se resolve sozinha: o Assistente tenta de novo a cada
                  // minuto e só baixa o que falta (contingencia.js, manter()). Visto
                  // na Hakim Centro em 14/10: o "→ 404" cru assustava.
                  ERRO_PASSAGEIRO.test(contingenciaAqui.erro) ? (
                    <p style={{ margin: "0 0 6px", color: "#92400E" }}>
                      A conexão piscou no meio do download. O Assistente tenta de novo sozinho em até 1 minuto, continuando de onde parou.
                      <span style={{ display: "block", fontSize: 11.5, color: cor.suave, wordBreak: "break-all" }}>Detalhe: {contingenciaAqui.erro}</span>
                    </p>
                  ) : (
                    <p style={{ margin: "0 0 6px", color: "#B91C1C" }}>
                      Problema: {contingenciaAqui.erro}. Se continuar, chame o suporte pelo WhatsApp.
                    </p>
                  )
                )}
              </>
            ) : (
              <p style={{ margin: "0 0 8px" }}>O computador do caixa está preparando a cópia da loja. Para acompanhar a porcentagem, abra esta tela nele.</p>
            )}
            <p style={{ margin: 0, fontSize: 13.5, color: cor.suave }}>
              <Clock size={14} style={{ verticalAlign: "-2px" }} /> Pode fechar esta tela e continuar trabalhando. O passo 5 libera quando terminar.
            </p>
          </Passo>

          <Passo n={5} titulo="Faça o teste de 2 minutos" resumo="Simula a queda da internet, sem tirar nenhum cabo." situacao={situacao(5)}>
            <p style={{ margin: "0 0 10px" }}>
              Por 2 minutos este computador age como se a internet tivesse caído. Em uns 15 segundos a tela troca sozinha para o computador
              da loja, com a faixa de aviso embaixo. Aproveite para lançar um pedido de teste no Balcão: ele sobe sozinho no fim.
            </p>
            {contingenciaAqui?.ativa ? (
              <button
                type="button"
                data-acao="testar"
                disabled={!!ocupado || !!contingenciaAqui.testando}
                onClick={testar}
                style={{ ...botaoRoxo, opacity: ocupado || contingenciaAqui.testando ? 0.6 : 1 }}
              >
                <FlaskConical size={18} /> {contingenciaAqui.testando ? "Teste em andamento…" : ocupado === "testar" ? "Começando…" : "Testar agora (2 min)"}
              </button>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: cor.suave }}>O botão do teste aparece quando você abre esta tela no computador do caixa.</p>
            )}
          </Passo>
        </ol>

        {ativada && (
          <div data-passo="tv" style={{ marginTop: 6, padding: "14px 16px", borderRadius: 14, border: `1.5px dashed ${cor.roxoBorda}`, background: "#FCFBFF" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <Tv size={18} color={cor.roxo} />
              <Smartphone size={18} color={cor.roxo} />
              <strong style={{ fontSize: 15.5 }}>TV da cozinha e celular do garçom</strong>
              <span style={{ fontSize: 11, fontWeight: 800, color: cor.suave, background: "#F1F5F9", borderRadius: 999, padding: "2px 8px" }}>SE TIVER</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 14.5, lineHeight: 1.55 }}>
              Com internet, eles usam o FireHub de sempre. Se cair, <strong>trocam sozinhos</strong> para o computador da loja — a TV que já deixa
              a tela da cozinha aberta não precisa de nada. Para isso, os dois precisam estar no <strong>Wi-Fi da loja</strong> e o computador
              precisa de um <strong>endereço fixo no roteador</strong> (se precisar, a gente faz por acesso remoto).
            </p>
            {enderecos.length ? (
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                {qr && <img src={qr} alt="QR do garçom" width={140} height={140} style={{ borderRadius: 12, border: `1px solid ${cor.borda}`, background: "#fff" }} />}
                <div style={{ fontSize: 14, lineHeight: 1.6, minWidth: 0 }}>
                  <div><strong>Garçom:</strong> aponte a câmera do celular para o QR e salve o atalho.</div>
                  <div style={{ marginTop: 6 }}><strong>TV</strong> (só se ela for ligada já sem internet e nunca tiver aberto o FireHub): digite uma vez e salve nos favoritos:</div>
                  {enderecos.map((e) => (
                    <div key={e} style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 800, wordBreak: "break-all" }}>{e}/tv</div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: cor.suave, fontSize: 14 }}>O endereço e o QR aparecem aqui assim que o computador da loja se conectar.</p>
            )}
          </div>
        )}
      </Cartao>

      {ativada && (
        <Cartao titulo="Situação agora" ancora="situacao">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 14 }}>
            <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
              <div style={{ color: cor.suave, fontSize: 12 }}>Computador da loja</div>
              <div style={{ fontWeight: 800 }}>{online ? "🟢 Conectado" : "🔴 Sem contato"}</div>
              <div style={{ color: cor.suave, fontSize: 12 }}>último contato {haQuanto(nuvem?.ultimoContato)}</div>
            </div>
            <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
              <div style={{ color: cor.suave, fontSize: 12 }}>Cópia da loja</div>
              <div style={{ fontWeight: 800 }}>{relato?.copiaEm ? `atualizada ${haQuanto(relato.copiaEm)}` : "preparando…"}</div>
              <div style={{ color: cor.suave, fontSize: 12 }}>{relato?.pendentes ? `${relato.pendentes} mudança(s) para subir` : "nada esperando para subir"}</div>
            </div>
            <div style={{ background: cor.fundo, borderRadius: 12, padding: 12 }}>
              <div style={{ color: cor.suave, fontSize: 12 }}>Modo</div>
              <div style={{ fontWeight: 800 }}>
                {relato?.modo === "contingencia" ? "Em contingência" : relato?.modo === "voltando" ? "⬆️ Subindo" : relato?.modo === "normal" ? "✅ Normal" : relato?.modo || "—"}
              </div>
              <div style={{ color: cor.suave, fontSize: 12 }}>versão {relato?.versao || "—"}</div>
            </div>
          </div>
          {relato?.ultimoErro && <p style={{ margin: "10px 0 0", fontSize: 13, color: "#B91C1C" }}>Último problema: {relato.ultimoErro}</p>}
          {podeMexer && (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                disabled={!!ocupado}
                onClick={desativar}
                style={{ background: "#fff", color: "#B91C1C", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "9px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                Desativar
              </button>
            </div>
          )}
        </Cartao>
      )}

      {ativada && (nuvem?.episodios?.length || 0) > 0 && (
        <Cartao titulo="Últimas quedas" ancora="quedas">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: cor.suave }}>
                  <th style={{ padding: "4px 6px" }}>Começou</th><th style={{ padding: "4px 6px" }}>Voltou</th>
                  <th style={{ padding: "4px 6px" }}>Pedidos</th><th style={{ padding: "4px 6px" }}>Mudanças</th><th style={{ padding: "4px 6px" }}>Conflitos</th>
                </tr>
              </thead>
              <tbody>
                {nuvem!.episodios!.map((e) => (
                  <tr key={e.id} style={{ borderTop: `1px solid ${cor.borda}` }}>
                    <td style={{ padding: "6px" }}>{dataHora(e.inicio)}</td><td style={{ padding: "6px" }}>{dataHora(e.fim)}</td>
                    <td style={{ padding: "6px" }}>{e.pedidos}</td><td style={{ padding: "6px" }}>{e.linhas}</td><td style={{ padding: "6px" }}>{e.conflitos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(nuvem?.conflitos?.length || 0) > 0 && (
            <details style={{ marginTop: 10, fontSize: 13 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Conflitos dos últimos 7 dias ({nuvem!.conflitos!.length})</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                {nuvem!.conflitos!.map((c, i) => (
                  <li key={i}>{dataHora(c.em)} — {c.tabela}{c.coluna ? ` · ${c.coluna}` : ""}: {c.decisao}</li>
                ))}
              </ul>
            </details>
          )}
        </Cartao>
      )}

      <Cartao titulo="O que você precisa" ancora="precisa">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <Requisito icone={<Monitor size={20} />} titulo="Computador Windows no caixa" texto="Ligado durante o expediente, com 4 GB de memória ou mais e 1 GB livre no disco." />
          <Requisito icone={<Printer size={20} />} titulo="Assistente de Impressão" texto="O mesmo que já imprime suas comandas, instalado nesse computador." />
          <Requisito icone={<Wifi size={20} />} titulo="TV e celulares no Wi-Fi da loja" texto="No 4G, o celular do garçom não alcança o computador." />
          <Requisito icone={<Router size={20} />} titulo="Endereço fixo no roteador" texto="Para a TV e o garçom acharem o computador. Se precisar, a gente faz por acesso remoto." />
          <Requisito icone={<ShieldCheck size={20} />} titulo="Clique em Permitir" texto="Na primeira vez, o Windows pergunta se libera o FireHub na rede da loja." />
        </div>
      </Cartao>

      <Cartao titulo="Durante a queda" ancora="queda">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <div style={{ borderRadius: 12, background: cor.verdeClaro, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, color: "#166534", marginBottom: 6 }}>
              <CheckCircle2 size={18} /> Continua funcionando
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              <li>Pedidos e Balcão</li>
              <li>Mesas e celular do garçom</li>
              <li>Tela da cozinha (KDS)</li>
              <li>Caixa</li>
              <li>Impressão das comandas</li>
            </ul>
          </div>
          <div style={{ borderRadius: 12, background: "#FFFBEB", padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, color: "#92400E", marginBottom: 6 }}>
              <Pause size={18} /> Espera a internet voltar
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.6 }}>
              <li><strong>iFood:</strong> pausado sozinho e reaberto na volta.</li>
              <li><strong>99Food, Keeta e Wabiz:</strong> os pedidos ficam como Novo, sem aceite automático.</li>
              <li><strong>Cardápio online e robô:</strong> avisam &quot;estamos com instabilidade, volte em alguns minutos&quot;.</li>
              <li><strong>Pix automático, cashback e cupom.</strong></li>
              <li><strong>Nota fiscal:</strong> os pedidos da queda ficam para emitir na volta.</li>
              <li><strong>App do motoboy e mapa:</strong> o motoboy sai com a comanda impressa.</li>
            </ul>
          </div>
        </div>
      </Cartao>

      <Cartao titulo="Dúvidas comuns" ancora="duvidas">
        {DUVIDAS.map((d) => (
          <details key={d.p} style={{ borderTop: `1px solid ${cor.borda}`, padding: "10px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 14.5 }}>{d.p}</summary>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#334155", lineHeight: 1.55 }}>{d.r}</p>
          </details>
        ))}
      </Cartao>

      <Cartao titulo="Vídeo explicativo" ancora="video">
        {videos.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p style={{ margin: 0, fontSize: 14, color: cor.suave, flex: "1 1 260px" }}>O passo a passo em vídeo, da instalação ao teste.</p>
            <TutorialDaTela tom="claro" rotulo="Assistir o vídeo" />
          </div>
        ) : (
          <p style={{ margin: 0, color: cor.suave, fontSize: 14 }}>Em breve: o passo a passo em vídeo, da instalação ao teste.</p>
        )}
      </Cartao>
    </div>
  );
}
