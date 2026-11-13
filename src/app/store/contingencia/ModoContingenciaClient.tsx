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
 * Refeita em 12/11/2026 (pedido do Douglas): explica que há DOIS modos de
 * contingência — "Na web", sem instalar nada, e "FireHub instalado no
 * computador", o que RECOMENDAMOS, que funciona até offline e até com o nosso
 * servidor fora — lado a lado, bem ilustrada (DesenhosDosModos.tsx), com o
 * botão grande de baixar o instalador e o passo a passo instalar → ativar →
 * pronto. Continua fazendo o que fazia: ativar, testar, desativar, situação ao
 * vivo, TV e garçom, últimas quedas.
 *
 * O passo a passo detalhado olha o estado de verdade (Assistente achado,
 * versão nova, ativado, cópia pronta, teste feito) e abre só o passo da vez.
 * Os `data-*` são as âncoras do vídeo (tutoriais/roteiros/contingencia.mjs).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  BarChart3, Camera, Check, CheckCircle2, Clock, CloudOff, Cpu, Download, FlaskConical, HardDrive, LifeBuoy,
  MemoryStick, Monitor, Pause, Power, Printer, RefreshCw, Router, ShieldCheck, Smartphone, Sparkles, Tv, Wifi,
} from "lucide-react";
import { fetchAssistente } from "@/lib/print";
import TutorialDaTela from "@/components/TutorialDaTela";
import { useTutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { tutoriaisDaTela } from "@/lib/tutoriais";
import type { EnderecoDoInstalador } from "@/lib/contingencia/instalador";
import IlustracaoDaContingencia from "./IlustracaoDaContingencia";
import { DesenhoDoPasso, DesenhoModoComputador, DesenhoModoWeb } from "./DesenhosDosModos";

const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];
/** Teste feito neste navegador: só para o passo 5 aparecer como feito. */
const CHAVE_TESTOU = "firehub_contingencia_testou";
/** Erro de rede do download, que o Assistente resolve sozinho na próxima tentativa. */
const ERRO_PASSAGEIRO = /→ \d{3}|fetch failed|timeout|timed out|ECONN|ETIMEDOUT|aborted|socket|network|incompleto/i;
/** O botão de baixar: a rota escolhe o instalador completo ou, sem ele, o Assistente de sempre. */
const BAIXAR = "/api/contingencia/instalador";

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
    /** IP público de onde o computador relata (api/contingencia/relato). */
    ipPublico?: string | null;
  } | null;
  /**
   * Há tela do painel abrindo o FireHub por outra internet que não a do
   * computador da contingência (lib/contingencia/rede-da-loja.ts). Só alerta.
   */
  redeDaLoja?: { ipDoComputador: string; outras: { ip: string; em: string; n: number; esteAparelho: boolean }[] } | null;
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
  /** Veio pelo instalador completo (FireHub-Completo-Setup.exe). */
  instalacaoCompleta?: boolean;
};

type EstadoDoAssistente =
  | { achado: false }
  | { achado: true; porta: number; versao?: string; contingencia: null | ContingenciaDoAssistente };

const cor = {
  borda: "#E2E8F0", texto: "#0F172A", suave: "#64748B", fundo: "#F8FAFC",
  roxo: "#7C3AED", roxoEscuro: "#6D28D9", roxoClaro: "#F5F3FF", roxoBorda: "#DDD6FE",
  verde: "#16A34A", verdeClaro: "#F0FDF4", ambar: "#B45309", vermelho: "#B91C1C",
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

const ESTILO = `
.fh-cg-modos{display:grid;grid-template-columns:1fr 1.15fr;gap:16px;align-items:stretch}
.fh-cg-passos3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.fh-cg-topo{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;align-items:center}
@media (max-width:820px){.fh-cg-modos,.fh-cg-topo{grid-template-columns:1fr}}
@media (max-width:620px){.fh-cg-passos3{grid-template-columns:1fr}}
.fh-cg-baixar:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(109,40,217,.42)}
.fh-cg-baixar{transition:transform .15s ease,box-shadow .15s ease}
`;

function Cartao({ titulo, sub, children, ancora }: { titulo?: string; sub?: string; children: React.ReactNode; ancora?: string }) {
  return (
    <section
      data-secao={ancora}
      style={{ background: "#fff", border: `1.5px solid ${cor.borda}`, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}
    >
      {titulo && <h2 style={{ fontSize: 17, fontWeight: 900, margin: sub ? "0 0 2px" : "0 0 12px", color: cor.texto }}>{titulo}</h2>}
      {sub && <p style={{ margin: "0 0 14px", fontSize: 14, color: cor.suave, lineHeight: 1.5 }}>{sub}</p>}
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

/** O botão grande de baixar. O texto de baixo diz se é o instalador completo ou o Assistente. */
function BotaoBaixar({ instalador, grande = true }: { instalador: EnderecoDoInstalador; grande?: boolean }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 6, maxWidth: "100%" }}>
      <a
        href={BAIXAR}
        data-acao="baixar"
        className="fh-cg-baixar"
        style={{
          ...botaoRoxo,
          padding: grande ? "15px 22px" : "12px 18px",
          fontSize: grande ? 16.5 : 15,
          borderRadius: 14,
          justifyContent: "center",
          boxShadow: "0 8px 22px rgba(109,40,217,.35)",
        }}
      >
        <Download size={grande ? 22 : 18} /> Baixar o FireHub para Windows
      </a>
      <span style={{ fontSize: 12.5, color: cor.suave, lineHeight: 1.4 }}>
        {instalador.completo
          ? `Instalador completo${instalador.tamanhoMb ? ` · ${instalador.tamanhoMb} MB` : ""} · Windows 10 ou 11 · já vem com tudo`
          : "Windows 10 ou 11 · depois de ativar, ele baixa o resto sozinho"}
      </span>
    </div>
  );
}

function ItemDaLista({ sim, children }: { sim: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45, margin: "0 0 7px" }}>
      <span
        style={{
          flex: "0 0 auto", width: 20, height: 20, borderRadius: 999, marginTop: 1,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: sim ? "#DCFCE7" : "#FEF3C7", color: sim ? cor.verde : cor.ambar,
        }}
      >
        {sim ? <Check size={13} strokeWidth={3.2} /> : <Pause size={11} strokeWidth={3} />}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </li>
  );
}

/** Um dos dois modos, lado a lado. */
function CartaoDoModo({
  numero, titulo, selo, frase, desenho, cobre, naoCobre, recomendado, rodape, ancora,
}: {
  numero: 1 | 2; titulo: string; selo: string; frase: string; desenho: React.ReactNode;
  cobre: React.ReactNode[]; naoCobre: React.ReactNode[]; recomendado?: boolean; rodape?: React.ReactNode; ancora: string;
}) {
  return (
    <article
      data-modo={ancora}
      style={{
        position: "relative", display: "flex", flexDirection: "column", minWidth: 0,
        background: recomendado ? "linear-gradient(180deg,#FDFCFF,#F7F3FF)" : "#fff",
        border: `${recomendado ? 2.5 : 1.5}px solid ${recomendado ? cor.roxo : cor.borda}`,
        borderRadius: 18, padding: "16px 16px 18px",
        boxShadow: recomendado ? "0 14px 36px rgba(124,58,237,.16)" : "none",
      }}
    >
      {recomendado && (
        <span
          style={{
            position: "absolute", top: -13, right: 16, display: "inline-flex", alignItems: "center", gap: 5,
            background: `linear-gradient(135deg,#8B5CF6,${cor.roxoEscuro})`, color: "#fff", fontSize: 11.5, fontWeight: 900,
            letterSpacing: ".04em", borderRadius: 999, padding: "5px 12px", boxShadow: "0 4px 12px rgba(109,40,217,.35)",
          }}
        >
          <Sparkles size={13} /> RECOMENDADO
        </span>
      )}
      <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>{desenho}</div>
      <div style={{ fontSize: 12, fontWeight: 900, color: recomendado ? cor.roxo : cor.suave, letterSpacing: ".05em" }}>MODO {numero}</div>
      <h3 style={{ margin: "2px 0 4px", fontSize: 19, fontWeight: 900, color: cor.texto, lineHeight: 1.25 }}>{titulo}</h3>
      <span
        style={{
          alignSelf: "flex-start", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 9px", marginBottom: 8,
          background: recomendado ? cor.roxoClaro : "#F1F5F9", color: recomendado ? cor.roxoEscuro : "#475569",
        }}
      >
        {selo}
      </span>
      <p style={{ margin: "0 0 12px", fontSize: 14.5, lineHeight: 1.5, color: "#1E293B", fontWeight: 600 }}>{frase}</p>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: "#166534", margin: "0 0 6px" }}>O QUE COBRE</div>
      <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
        {cobre.map((c, i) => <ItemDaLista key={i} sim>{c}</ItemDaLista>)}
      </ul>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: "#92400E", margin: "0 0 6px" }}>{recomendado ? "ESPERA A INTERNET VOLTAR" : "NÃO COBRE"}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {naoCobre.map((c, i) => <ItemDaLista key={i} sim={false}>{c}</ItemDaLista>)}
      </ul>
      {rodape && <div style={{ marginTop: "auto", paddingTop: 14 }}>{rodape}</div>}
    </article>
  );
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

const TRES_PASSOS: { n: 1 | 2 | 3; titulo: string; texto: string }[] = [
  { n: 1, titulo: "Instale", texto: "Baixe o FireHub para Windows no computador do caixa e abra o instalador. Ele já traz tudo e cria o ícone FireHub na área de trabalho." },
  { n: 2, titulo: "Ative", texto: "Abra o FireHub, entre com o seu login e, nesta tela, clique em Ativar neste computador. Ele copia a loja sozinho." },
  { n: 3, titulo: "Pronto", texto: "Daqui em diante ele funciona com ou sem internet, e até se o nosso servidor cair. Atualiza sozinho sempre que a internet volta." },
];

const DUVIDAS: { p: string; r: string }[] = [
  { p: "Qual modo eu escolho?", r: "O Modo 1 (na web) já vem ligado para todo mundo: ele protege seus clientes quando a internet da loja cai, mas a loja para. O Modo 2 (FireHub instalado no computador) é o que recomendamos: o sistema inteiro roda no computador do caixa e a loja continua vendendo, imprimindo e fechando o caixa, sem internet e até se o nosso servidor cair." },
  { p: "Funciona mesmo se o servidor do FireHub cair?", r: "Sim. No Modo 2 o FireHub roda inteiro no seu computador, com uma cópia da loja sempre atualizada. Se a nossa nuvem sair do ar, as telas passam para o computador em menos de 1 minuto. Quando ela volta, tudo sobe sozinho." },
  { p: "Preciso de internet para instalar?", r: "Para ativar, sim, uma vez: é quando o computador recebe a cópia da sua loja. O instalador completo já traz o sistema inteiro, então a ativação é rápida. Depois disso ele funciona sem internet pelo tempo que precisar." },
  { p: "Ele se atualiza sozinho?", r: "Sim. Sempre que tem internet o computador recebe a versão nova do FireHub (só o que mudou, sem pesar) e a cópia da loja fica em dia a cada poucos segundos. A troca de versão espera a loja ficar calma, para não atrapalhar o movimento." },
  { p: "Como abro o FireHub sem internet?", r: "Pelo ícone FireHub da área de trabalho do computador do caixa. Ele abre o sistema numa janela própria: com internet usa a nuvem, sem internet usa o computador, já com você dentro, sem pedir senha." },
  { p: "E se ficar dias sem internet?", r: "A loja continua funcionando: pedidos, balcão, mesas, cozinha, caixa, relatórios do último mês e impressão. A entrada guardada vale por até um ano sem nenhuma conexão. Quando a internet voltar, tudo sobe sozinho." },
  { p: "Preciso fazer alguma coisa quando a internet cair?", r: "Não. Em menos de 1 minuto as telas passam sozinhas para o computador do caixa, e voltam sozinhas quando a internet volta." },
  { p: "E se o computador do caixa estiver desligado?", r: "Aí não tem contingência. Com internet, a TV e o celular do garçom continuam funcionando normalmente pela nuvem." },
  { p: "Os pedidos feitos na queda duplicam?", r: "Não. Cada pedido sobe uma vez só. Se alguma coisa foi mudada nos dois lugares ao mesmo tempo, ela aparece em \"Últimas quedas\", nesta tela." },
  { p: "Posso mexer pelo celular no 4G durante a queda?", r: "O 4G não alcança o computador da loja. Durante a queda, use as telas que estão no Wi-Fi da loja." },
  { p: "Troquei de computador. E agora?", r: "Instale o FireHub no computador novo, abra esta tela nele e clique em Ativar neste computador. O antigo para de receber a cópia." },
  { p: "Quanto custa?", r: "Os dois modos estão incluídos no plano, sem custo a mais." },
];

export default function ModoContingenciaClient({ instalador }: { instalador: EnderecoDoInstalador }) {
  const [nuvem, setNuvem] = useState<EstadoDaNuvem | null>(null);
  const [assistente, setAssistente] = useState<EstadoDoAssistente | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [qr, setQr] = useState("");
  const [testou, setTestou] = useState(false);
  const [confirmarDesativar, setConfirmarDesativar] = useState(false);
  const [acabouDeInstalar, setAcabouDeInstalar] = useState(false);
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
    // A janela do FireHub abre aqui com ?instalado=1 logo depois do instalador (Assistente, main.js).
    try { setAcabouDeInstalar(new URLSearchParams(window.location.search).get("instalado") === "1"); } catch {}
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
  const protegida = ativada && daVez === null;

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
      setMensagem(
        contingenciaAqui?.instalacaoCompleta
          ? "✅ Ativado neste computador. O FireHub já veio no instalador: agora ele só faz a cópia da loja — acompanhe no passo 4."
          : "✅ Ativado neste computador. Agora o Assistente baixa o FireHub e faz a cópia da loja — acompanhe no passo 4.",
      );
      await atualizar();
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message || "Não foi possível ativar."}`);
    } finally {
      setOcupado("");
    }
  }

  async function desativar() {
    setConfirmarDesativar(false);
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
      setMensagem("🧪 Teste começou: por 2 minutos este computador age como se a internet tivesse caído. Em menos de 1 minuto as telas abertas NESTE computador vão para o computador da loja, com a faixa de aviso embaixo. Lance um pedido de teste no Balcão, se quiser — ele sobe sozinho no fim.");
    } catch (e: any) {
      setMensagem(`⚠️ ${e?.message}`);
    } finally {
      setOcupado("");
    }
  }

  const travaTroca = emOutroComputador && !!relato?.pendentes;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: cor.texto, fontFamily: "inherit" }}>
      <style>{ESTILO}</style>

      {/* ── O topo ─────────────────────────────────────────────────────────── */}
      <header
        data-secao="topo"
        className="fh-cg-topo"
        style={{
          background: "linear-gradient(135deg,#1E1B4B 0%,#4C1D95 55%,#6D28D9 100%)", color: "#fff",
          borderRadius: 22, padding: "22px 22px", marginBottom: 16, boxShadow: "0 18px 40px rgba(76,29,149,.28)", overflow: "hidden",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(255,255,255,.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LifeBuoy size={24} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>Modo Contingência</h1>
            <span style={{ background: "#FBBF24", color: "#422006", fontSize: 11, fontWeight: 900, borderRadius: 999, padding: "3px 10px" }}>NOVO</span>
          </div>
          <p style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.25, margin: "0 0 8px" }}>
            Sua loja não para. Nem sem internet, nem se o nosso servidor cair.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.55, margin: "0 0 16px", color: "#DDD6FE" }}>
            Instale o FireHub no computador do caixa: ele roda o sistema inteiro ali mesmo — pedidos, balcão, mesas, cozinha, caixa e
            impressão — e, quando a internet volta, sobe tudo sozinho para a nuvem. Incluído no plano.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a
              href={BAIXAR}
              data-acao="baixar-topo"
              className="fh-cg-baixar"
              style={{ ...botaoRoxo, background: "#fff", color: cor.roxoEscuro, padding: "14px 20px", fontSize: 16, borderRadius: 14, boxShadow: "0 8px 22px rgba(0,0,0,.25)" }}
            >
              <Download size={20} /> Baixar o FireHub para Windows
            </a>
            {protegida && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(22,163,74,.22)", border: "1px solid rgba(134,239,172,.5)", color: "#DCFCE7", borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 800 }}>
                <ShieldCheck size={16} /> Sua loja está protegida
              </span>
            )}
          </div>
        </div>
        <div style={{ minWidth: 0, borderRadius: 18, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
          <DesenhoModoComputador escuro />
        </div>
      </header>

      {acabouDeInstalar && !ativada && (
        <div role="status" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: cor.verdeClaro, border: "1.5px solid #86EFAC", borderRadius: 14, padding: "12px 14px", marginBottom: 14, fontSize: 14.5, lineHeight: 1.5 }}>
          <CheckCircle2 size={20} color={cor.verde} style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div><strong>FireHub instalado neste computador.</strong> Falta só um clique: desça até <strong>Ative neste computador</strong> e clique em <strong>Ativar neste computador</strong>.</div>
        </div>
      )}

      {mensagem && (
        <div style={{ background: cor.roxoClaro, border: `1.5px solid ${cor.roxoBorda}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 14, lineHeight: 1.45 }}>
          {mensagem}
        </div>
      )}

      {/* ── Os dois modos ──────────────────────────────────────────────────── */}
      <Cartao
        titulo="Dois modos de contingência"
        sub="Os dois estão incluídos no plano. O Modo 1 já vem ligado para todo mundo; o Modo 2 é o que recomendamos, porque a loja continua funcionando de verdade."
        ancora="dois-modos"
      >
        <div className="fh-cg-modos" style={{ paddingTop: 6 }}>
          <CartaoDoModo
            numero={1}
            ancora="web"
            titulo="Na web"
            selo="JÁ VEM LIGADO · SEM INSTALAR NADA"
            frase="Protege seus clientes quando a internet da loja cai. A loja para, mas ninguém fica esperando pedido que não vai chegar."
            desenho={<DesenhoModoWeb />}
            cobre={[
              <>Pausa o <strong>iFood</strong> sozinho e o <strong>site e o robô</strong> avisam &quot;volte em alguns minutos&quot;.</>,
              <><strong>99Food, Keeta e Wabiz</strong> param de aceitar sozinhos; os pedidos ficam esperando você.</>,
              <>Avisa você no <strong>WhatsApp</strong> na queda e na volta.</>,
              <>Tudo volta sozinho quando a internet volta. Dá para seguir pelo <strong>celular no 4G</strong>.</>,
            ]}
            naoCobre={[
              <>Sem internet na loja, as <strong>telas e a impressão param</strong>.</>,
              <>Se o <strong>servidor do FireHub</strong> cair, para tudo até ele voltar.</>,
              <>Precisa do Assistente de Impressão ligado no caixa (é por ele que sabemos que a loja caiu).</>,
            ]}
          />
          <CartaoDoModo
            numero={2}
            ancora="computador"
            recomendado
            titulo="FireHub instalado no computador"
            selo="FUNCIONA ATÉ OFFLINE"
            frase="O sistema completo no computador do caixa. Funciona sem internet e até se o nosso servidor cair — sua loja não para."
            desenho={<DesenhoModoComputador />}
            cobre={[
              <><strong>Pedidos, balcão, mesas e garçom</strong>, nas mesmas telas de sempre.</>,
              <><strong>Cozinha (KDS) e impressão</strong> das comandas, pela rede da loja.</>,
              <><strong>Caixa</strong>: abrir, lançar, sangria e <strong>fechar</strong>.</>,
              <><strong>Relatórios do último mês</strong> e as <strong>fotos do cardápio</strong>.</>,
              <>Sobe tudo sozinho na volta, sem duplicar, e <strong>se atualiza sozinho</strong>.</>,
            ]}
            naoCobre={[
              <>Receber pedidos do <strong>iFood, 99, Keeta, site e robô</strong> (pausam sozinhos e voltam).</>,
              <><strong>Pix automático, cashback e cupom</strong>.</>,
              <><strong>Nota fiscal (NFC-e)</strong>: os pedidos da queda ficam para emitir na volta.</>,
              <><strong>App do motoboy e mapa</strong>: ele sai com a comanda impressa.</>,
            ]}
            rodape={<BotaoBaixar instalador={instalador} />}
          />
        </div>
      </Cartao>

      {/* ── Instalar → ativar → pronto ─────────────────────────────────────── */}
      <Cartao titulo="Instale em 3 passos" sub="Leva poucos minutos. Faça no computador do caixa, o mesmo que imprime as comandas." ancora="tres-passos">
        <div className="fh-cg-passos3">
          {TRES_PASSOS.map((p) => (
            <div key={p.n} data-tres-passos={p.n} style={{ border: `1.5px solid ${cor.borda}`, borderRadius: 16, padding: 14, background: "#fff", minWidth: 0 }}>
              <DesenhoDoPasso n={p.n} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 4px" }}>
                <span style={{ width: 26, height: 26, borderRadius: 999, background: p.n === 3 ? cor.verde : cor.roxo, color: "#fff", fontWeight: 900, fontSize: 13.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{p.n}</span>
                <strong style={{ fontSize: 16.5 }}>{p.titulo}</strong>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#334155", lineHeight: 1.5 }}>{p.texto}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <BotaoBaixar instalador={instalador} />
        </div>
      </Cartao>

      <Cartao titulo="Como funciona" sub="Veja o que acontece na sua loja em cada momento." ancora="como-funciona">
        <IlustracaoDaContingencia />
      </Cartao>

      <Cartao
        titulo={daVez === null ? "Sua loja está protegida" : "Ative neste computador"}
        sub={daVez === null
          ? "Está tudo pronto. Se a internet cair, ninguém precisa fazer nada. Para abrir o FireHub sem internet, use o ícone FireHub da área de trabalho."
          : "Esta lista acompanha o que você já fez. O passo da vez fica em roxo, com o botão dentro."}
        ancora="passos"
      >
        <ol style={{ margin: 0, padding: 0 }}>
          <Passo n={1} titulo="Instale o FireHub no computador do caixa" resumo="O computador onde ficam a impressora e o caixa." situacao={situacao(1)}>
            {assistente === null ? (
              <p style={{ margin: 0, color: cor.suave }}>Procurando o FireHub neste computador…</p>
            ) : (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  O FireHub instalado roda no <strong>computador do caixa</strong>, o mesmo que imprime suas comandas.{" "}
                  <strong>Ainda não achamos o FireHub instalado neste aparelho.</strong>
                </p>
                <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                  <li>Está no celular ou em outro computador? Abra o FireHub no computador do caixa e entre nesta mesma tela.</li>
                  <li>Já usa o Assistente de Impressão? O instalador abaixo atualiza ele — não fica nada em dobro.</li>
                </ul>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <BotaoBaixar instalador={instalador} grande={false} />
                  <button type="button" onClick={procurarDeNovo} style={botaoClaro}><RefreshCw size={16} /> Já instalei, procurar de novo</button>
                </div>
              </>
            )}
          </Passo>

          <Passo n={2} titulo="Deixe o FireHub atualizado" resumo="A contingência vem na versão nova do Assistente." situacao={situacao(2)}>
            <p style={{ margin: "0 0 8px" }}>
              Achamos o Assistente{assistente?.achado && assistente.versao ? ` (versão ${assistente.versao})` : ""}, mas ele é de uma versão sem o Modo Contingência. O jeito mais rápido é instalar o FireHub por cima
              (o botão abaixo). Ou, para atualizar o que já está aí:
            </p>
            <ol style={{ margin: "0 0 12px", paddingLeft: 20 }}>
              <li>No canto de baixo da tela, perto do relógio, ache o <strong>ícone do FireHub</strong> (se não aparecer, clique na setinha ^).</li>
              <li>Clique nele com o <strong>botão direito</strong> e escolha <strong>Procurar atualização agora</strong>.</li>
              <li>Espere uns minutos e clique em conferir.</li>
            </ol>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <BotaoBaixar instalador={instalador} grande={false} />
              <button type="button" onClick={procurarDeNovo} style={botaoClaro}><RefreshCw size={16} /> Já atualizei, conferir</button>
            </div>
          </Passo>

          <Passo n={3} titulo="Clique em Ativar neste computador" resumo="Um clique: o computador prepara tudo sozinho." situacao={situacao(3)}>
            {emOutroComputador ? (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  A contingência está ativada em <strong>outro computador</strong>. Para usar este no lugar dele, ative aqui — o outro deixa de receber a cópia.
                </p>
                {travaTroca && (
                  <p style={{ margin: "0 0 10px", color: cor.vermelho }}>
                    O computador atual ainda tem {relato?.pendentes} mudança(s) para subir. Espere subir antes de trocar.
                  </p>
                )}
              </>
            ) : contingenciaAqui?.instalacaoCompleta ? (
              <p style={{ margin: "0 0 10px" }}>
                FireHub encontrado, com a <strong>instalação completa</strong>: o sistema já está neste computador. Ao ativar, ele só faz a cópia da loja.{" "}
                <strong>Pode continuar trabalhando enquanto isso.</strong>
              </p>
            ) : (
              <p style={{ margin: "0 0 10px" }}>
                Assistente encontrado. Ao ativar, ele baixa o FireHub para este computador (uns 250 MB na primeira vez; depois, só o que mudar)
                e faz a cópia da loja. <strong>Pode continuar trabalhando enquanto isso.</strong>
              </p>
            )}
            {memoriaGb !== null && memoriaGb < 3.8 && (
              <p style={{ margin: "0 0 10px", fontSize: 13.5, color: cor.ambar }}>
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
                    <p style={{ margin: "0 0 6px", color: cor.vermelho }}>
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
              Por 2 minutos este computador age como se a internet tivesse caído. Em menos de 1 minuto a tela troca sozinha para o computador
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
              <div style={{ color: cor.suave, fontSize: 12 }}>
                versão {relato?.versao || "—"}{contingenciaAqui?.instalacaoCompleta ? " · instalação completa" : ""}
              </div>
            </div>
          </div>
          {relato?.ultimoErro && <p style={{ margin: "10px 0 0", fontSize: 13, color: cor.vermelho }}>Último problema: {relato.ultimoErro}</p>}
          {nuvem?.redeDaLoja && (
            // Só alerta, nunca trava (14/10/2026: a contingência da Hakim Centro
            // estava no PC de casa do Douglas e as telas da loja pulavam para um
            // endereço que lá não existe).
            <div
              role="alert"
              data-alerta-rede
              style={{ margin: "12px 0 0", background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "10px 12px", fontSize: 13, lineHeight: 1.5, color: "#7F1D1D" }}
            >
              <strong>⚠️ O computador da contingência parece não estar na rede da loja.</strong>
              <div>
                Ele fala com o FireHub pela internet <code>{nuvem.redeDaLoja.ipDoComputador}</code>, mas há telas do painel abertas por outra internet:
              </div>
              <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                {nuvem.redeDaLoja.outras.map((o) => (
                  <li key={o.ip}>
                    <code>{o.ip}</code> — {haQuanto(o.em)}{o.esteAparelho ? " (este aparelho)" : ""}
                  </li>
                ))}
              </ul>
              <div>
                Se essas telas estão na loja, numa queda elas vão procurar um computador que não está lá. Ative a contingência no computador do
                caixa da loja. (Se é só você abrindo o painel de casa, pode ignorar.)
              </div>
            </div>
          )}
          {podeMexer && (
            <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {confirmarDesativar ? (
                <>
                  <span style={{ fontSize: 13.5, color: "#7F1D1D", fontWeight: 700 }}>
                    Desativar? Se a internet cair, a loja volta a parar como antes.
                  </span>
                  <button
                    type="button"
                    data-acao="desativar-sim"
                    disabled={!!ocupado}
                    onClick={desativar}
                    style={{ background: cor.vermelho, color: "#fff", border: 0, borderRadius: 12, padding: "9px 14px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Sim, desativar
                  </button>
                  <button type="button" onClick={() => setConfirmarDesativar(false)} style={botaoClaro}>Manter ativado</button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!!ocupado}
                  onClick={() => setConfirmarDesativar(true)}
                  style={{ background: "#fff", color: cor.vermelho, border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "9px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {ocupado === "desativar" ? "Desativando…" : "Desativar"}
                </button>
              )}
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

      <Cartao titulo="O computador que você precisa" sub="Não precisa ser novo nem caro: o computador que já fica no caixa costuma servir." ancora="precisa">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          <Requisito icone={<Monitor size={20} />} titulo="Windows 10 ou 11, 64 bits" texto="O computador do caixa, ligado durante o expediente." />
          <Requisito icone={<MemoryStick size={20} />} titulo="4 GB de memória ou mais" texto="Com 8 GB fica folgado. A tela avisa se o computador tiver menos." />
          <Requisito icone={<HardDrive size={20} />} titulo="2 GB livres no disco" texto="O sistema, o banco da loja e as fotos do cardápio." />
          <Requisito icone={<Cpu size={20} />} titulo="Qualquer processador de 64 bits" texto="De 2015 para cá serve. Ele fica leve enquanto a internet funciona." />
          <Requisito icone={<Wifi size={20} />} titulo="TV e celulares no Wi-Fi da loja" texto="No 4G, o celular do garçom não alcança o computador." />
          <Requisito icone={<Router size={20} />} titulo="Endereço fixo no roteador" texto="Para a TV e o garçom acharem o computador. Se precisar, a gente faz por acesso remoto." />
          <Requisito icone={<ShieldCheck size={20} />} titulo="Clique em Permitir" texto="Na primeira vez, o Windows pergunta se libera o FireHub na rede da loja." />
          <Requisito icone={<Power size={20} />} titulo="Não deixe o computador dormir" texto="O FireHub já impede o modo de espera do Windows durante o expediente." />
        </div>
      </Cartao>

      <Cartao titulo="Durante a queda, com o FireHub instalado" ancora="queda">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
          <div style={{ borderRadius: 12, background: cor.verdeClaro, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, color: "#166534", marginBottom: 6 }}>
              <CheckCircle2 size={18} /> Continua funcionando
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              <li>Pedidos e Balcão</li>
              <li>Mesas e celular do garçom</li>
              <li>Tela da cozinha (KDS)</li>
              <li>Caixa, do abrir ao fechar</li>
              <li>Impressão das comandas</li>
              <li><BarChart3 size={13} style={{ verticalAlign: "-2px" }} /> Relatórios do último mês</li>
              <li><Camera size={13} style={{ verticalAlign: "-2px" }} /> Fotos do cardápio</li>
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
        <p style={{ margin: "12px 0 0", fontSize: 13, color: cor.suave, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <CloudOff size={15} style={{ flex: "0 0 auto", marginTop: 1 }} />
          Sem o FireHub instalado (só o Modo 1), as telas da loja param durante a queda — os canais pausam e você é avisado.
        </p>
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
