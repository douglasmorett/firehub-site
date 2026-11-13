"use client";

/**
 * As peças da tela da Escala da equipe: tipos do que a API devolve, cores,
 * aviso no topo (nunca alert() — Douglas, 30/09/2026), janela, confirmação e
 * o fetch com erro legível. Cópia local, como nas telas vizinhas (não há
 * componente compartilhado de aviso no master).
 */

import { useEffect } from "react";
import { pixParaCopiar, situacaoDoAceite, type PagamentoFeito, type SituacaoDasVagas, type SituacaoDoAceite, type SituacaoDoPagamento, type ValorDaDiaria } from "@/lib/escala-da-equipe/regras";

// ── O que a API devolve ─────────────────────────────────────────────────────

export type TipoDePessoa = "equipe" | "motoboy" | "freelancer";
export type Inscrito = {
  id: string; pessoaTipo: TipoDePessoa; pessoaId: string; nome: string; origem: "link" | "painel"; createdAt: string; diaria: number | null;
  /** Só para o dono (para o funcionário vem sempre vazio). */
  pagamento?: PagamentoFeito | null;
  acerto?: { id: string; em: string; dia: string } | null;
  /** O aceite pelo WhatsApp (13/11/2026). */
  aceitoEm: string | null; avisoEm: string | null; avisoStatus: string | null;
};
export type Turno = { id: string; data: string; inicio: string; fim: string; funcao: string; vagas: number; obs: string | null; inscritos: Inscrito[] };
export type Pessoa = {
  tipo: TipoDePessoa; id: string; nome: string; telefone: string | null; funcao: string | null; diaria: number | null;
  cpf: string | null; pix: string | null; pixTipo: string | null; pixOrigem: string | null; pixAtualizadoEm: string | null;
  obs: string | null; ativo: boolean; origem: "link" | "painel"; detalhe: string | null; diariaDaOrigem: number | null;
};
export type ConfigDoLink = { codigo: string; prazoInscricaoHoras: number; permiteDesistir: boolean; prazoDesistenciaHoras: number; funcoesNoLink: string[]; linkAtivo: boolean };
export type DadosDaEscala = {
  hoje: string; de: string; ate: string; ehDono: boolean;
  loja: { nome: string; logo: string | null };
  config: ConfigDoLink;
  turnos: Turno[];
  pessoas: Pessoa[];
  custo: { total: number; semValor: number; porPessoa: Array<{ nome: string; turnos: number; total: number }> } | null;
  /** Os valores da diária por função e por dia — só o dono. */
  valores: ValorDaDiaria[] | null;
};

// ── Cores e textos ──────────────────────────────────────────────────────────

export const COR = "#0F766E";
export const COR_CLARA = "#F0FDFA";
export const COR_BORDA = "#99F6E4";

/** A cor do turno pela situação das vagas: falta gente salta aos olhos. */
export const COR_DA_SITUACAO: Record<SituacaoDasVagas["estado"], { cor: string; fundo: string; borda: string; texto: string }> = {
  vazio: { cor: "#DC2626", fundo: "#FEF2F2", borda: "#FECACA", texto: "ninguém ainda" },
  falta: { cor: "#B45309", fundo: "#FFFBEB", borda: "#FDE68A", texto: "falta gente" },
  completo: { cor: "#047857", fundo: "#ECFDF5", borda: "#A7F3D0", texto: "completo" },
  excedido: { cor: "#1D4ED8", fundo: "#EFF6FF", borda: "#BFDBFE", texto: "gente a mais" },
};

export const SELO_DO_TIPO: Record<TipoDePessoa, { rotulo: string; icone: string; cor: string; fundo: string }> = {
  motoboy: { rotulo: "Motoboy", icone: "🛵", cor: "#C2410C", fundo: "#FFF7ED" },
  equipe: { rotulo: "Equipe", icone: "👤", cor: "#4338CA", fundo: "#EEF2FF" },
  freelancer: { rotulo: "Freelancer", icone: "⭐", cor: "#7E22CE", fundo: "#FAF5FF" },
};

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const reaisNoCampo = (v: number | null | undefined) => (v ? v.toFixed(2).replace(".", ",") : "");

export function SeloDoTipo({ tipo, compacto = false }: { tipo: TipoDePessoa; compacto?: boolean }) {
  const s = SELO_DO_TIPO[tipo];
  return (
    <span title={s.rotulo} style={{ ...S.chip, color: s.cor, background: s.fundo, padding: compacto ? "1px 6px" : "2px 8px", fontSize: compacto ? 10.5 : 11.5 }}>
      {s.icone}{!compacto && <> {s.rotulo}</>}
    </span>
  );
}

/** Cor fixa por pessoa (pelo nome): a mesma pessoa tem a mesma cor em toda a escala. */
const CORES_DO_AVATAR = ["#0F766E", "#C2410C", "#4338CA", "#7E22CE", "#BE123C", "#0369A1", "#A16207", "#15803D", "#9D174D", "#334155"];
export function corDaPessoa(nome: string): string {
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CORES_DO_AVATAR[h % CORES_DO_AVATAR.length];
}
const iniciais = (nome: string) => {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};

/** Bolinha com as iniciais e o ícone do tipo no canto (🛵 motoboy, 👤 equipe, ⭐ freelancer). */
export function Avatar({ nome, tipo, tamanho = 28 }: { nome: string; tipo: TipoDePessoa; tamanho?: number }) {
  return (
    <span title={`${nome} · ${SELO_DO_TIPO[tipo].rotulo}`} style={{
      position: "relative", flexShrink: 0, width: tamanho, height: tamanho, borderRadius: "50%", background: corDaPessoa(nome), color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: tamanho * 0.38, fontWeight: 900, letterSpacing: 0.2,
    }}>
      {iniciais(nome)}
      <span style={{ position: "absolute", right: -4, bottom: -4, fontSize: tamanho * 0.42, lineHeight: 1, filter: "drop-shadow(0 1px 1px rgba(0,0,0,.25))" }}>{SELO_DO_TIPO[tipo].icone}</span>
    </span>
  );
}

/**
 * O que está sendo arrastado na escala: uma pessoa da lista ao lado (escalar)
 * ou alguém que já está num turno (mudar de turno, ou soltar na lista = tirar).
 */
export type Arrasto =
  | { tipo: "pessoa"; pessoaTipo: TipoDePessoa; pessoaId: string; nome: string }
  | { tipo: "inscricao"; inscricaoId: string; turnoId: string; pessoaTipo: TipoDePessoa; pessoaId: string; nome: string };
export const TIPO_DO_ARRASTO = "application/x-firehub-escala";
// O dragover não pode ler o conteúdo (só o drop): a tela guarda aqui o que
// está no ar para pintar o destino certo enquanto passa por cima.
export const arrastoAtual: { valor: Arrasto | null } = { valor: null };
export function comecarArrasto(e: React.DragEvent, a: Arrasto) {
  arrastoAtual.valor = a;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(TIPO_DO_ARRASTO, JSON.stringify(a));
  e.dataTransfer.setData("text/plain", a.nome);
}
export function lerArrasto(e: React.DragEvent): Arrasto | null {
  try { return JSON.parse(e.dataTransfer.getData(TIPO_DO_ARRASTO)) as Arrasto; } catch { return arrastoAtual.valor; }
}

/** Onde o dono acerta o motoboy — o "pago no acerto" da escala leva para lá. */
export const LINK_DO_ACERTO = "/store/motoboys?aba=relatorio";

/** O selo discreto do pagamento (só o dono vê): pago, a pagar, pago no acerto do motoboy. */
export const SELO_DO_PAGAMENTO: Record<Exclude<SituacaoDoPagamento, "futuro">, { icone: string; rotulo: string; cor: string; fundo: string }> = {
  pago: { icone: "💰", rotulo: "Pago", cor: "#047857", fundo: "#ECFDF5" },
  acerto: { icone: "💰", rotulo: "Pago no acerto", cor: "#047857", fundo: "#ECFDF5" },
  pendente: { icone: "⏳", rotulo: "A pagar", cor: "#B45309", fundo: "#FFFBEB" },
};
export function SeloDoPagamento({ situacao, compacto = false, titulo }: { situacao: SituacaoDoPagamento; compacto?: boolean; titulo?: string }) {
  if (situacao === "futuro") return null;
  const s = SELO_DO_PAGAMENTO[situacao];
  return (
    <span title={titulo || s.rotulo} style={{ ...S.chip, color: s.cor, background: s.fundo, padding: compacto ? "0 4px" : "1px 7px", fontSize: compacto ? 11 : 11.5, flexShrink: 0 }}>
      {s.icone}{!compacto && <> {s.rotulo}</>}
    </span>
  );
}

/** "Copiar Pix": a chave no formato que o app do banco aceita colar. */
export function BotaoCopiarPix({ pix, pixTipo, nome, avisar, rotulo = "📋 Pix" }: { pix: string; pixTipo: string | null; nome: string; avisar: (a: Aviso) => void; rotulo?: string }) {
  return (
    <button type="button" title={`Copiar a chave Pix de ${nome}`}
      onClick={async (e) => {
        e.stopPropagation();
        avisar(await copiar(pixParaCopiar(pix, pixTipo)) ? { tipo: "ok", titulo: `Pix de ${nome} copiado` } : { tipo: "erro", titulo: "Não deu para copiar", detalhe: pix });
      }}
      style={{ ...S.botaoPequeno, height: 28, padding: "0 9px", fontSize: 12, borderColor: "#A7F3D0", color: "#047857", flexShrink: 0 }}>
      {rotulo}
    </button>
  );
}

/** "13/11 14:20" — a hora do aceite como o dono lê. */
export const diaEHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const SELO_DO_ACEITE: Record<SituacaoDoAceite, { icone: string; cor: string; fundo: string }> = {
  aceito: { icone: "✅", cor: "#047857", fundo: "#ECFDF5" },
  aguardando: { icone: "⏳", cor: "#B45309", fundo: "#FFFBEB" },
  "sem-whatsapp": { icone: "📵", cor: "#B91C1C", fundo: "#FEF2F2" },
  falhou: { icone: "⚠️", cor: "#B91C1C", fundo: "#FEF2F2" },
};

/** O texto do aceite: "aceito pelo funcionário em 13/11 14:20", "aguardando aceite"… */
export function textoDoAceite(i: Pick<Inscrito, "aceitoEm" | "avisoStatus" | "avisoEm">): string {
  const s = situacaoDoAceite(i);
  if (s === "aceito") return `aceito pelo funcionário em ${diaEHora(i.aceitoEm!)}`;
  if (s === "sem-whatsapp") return "sem WhatsApp cadastrado — não recebeu o pedido de aceite";
  if (s === "falhou") return "o WhatsApp da loja não enviou o pedido de aceite";
  return i.avisoEm ? `aguardando aceite (pedido em ${diaEHora(i.avisoEm)})` : "aguardando aceite";
}

/** O selo do aceite (prova de que a pessoa escolheu o turno). Compacto = só o ícone, com o texto no title. */
export function SeloDoAceite({ inscrito, compacto = false }: { inscrito: Pick<Inscrito, "aceitoEm" | "avisoStatus" | "avisoEm">; compacto?: boolean }) {
  const s = SELO_DO_ACEITE[situacaoDoAceite(inscrito)];
  const texto = textoDoAceite(inscrito);
  return (
    <span title={texto} style={{ ...S.chip, color: s.cor, background: s.fundo, padding: compacto ? "0 4px" : "1px 7px", fontSize: compacto ? 11 : 11.5, flexShrink: 0, whiteSpace: compacto ? "nowrap" : "normal" }}>
      {s.icone}{!compacto && <> {texto}</>}
    </span>
  );
}

export function SeloDoLink() {
  return <span title="Se inscreveu pelo link" style={{ ...S.chip, color: COR, background: COR_CLARA, padding: "1px 6px", fontSize: 10.5 }}>🔗 link</span>;
}

// ── Aviso, janela, confirmação ──────────────────────────────────────────────

export type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO = {
  ok: { cor: "#16A34A", fundo: "#F0FDF4" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: COR, fundo: COR_CLARA },
};

export function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div role={aviso.tipo === "erro" ? "alert" : "status"} onClick={onFechar} style={{
      position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10100,
      width: "min(460px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
      borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2, whiteSpace: "pre-line" }}>{aviso.detalhe}</div>}
    </div>
  );
}

export function Janela({ titulo, subtitulo, onFechar, children, largura = 560, rodape }: {
  titulo: React.ReactNode; subtitulo?: React.ReactNode; onFechar: () => void; children: React.ReactNode; largura?: number; rodape?: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: largura, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0F172A" }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>{subtitulo}</div>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: 0, background: "#F1F5F9", borderRadius: 10, width: 34, height: 34, fontSize: 18, cursor: "pointer", flexShrink: 0 }}>×</button>
        </div>
        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>{children}</div>
        {rodape && <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #F1F5F9", display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>{rodape}</div>}
      </div>
    </div>
  );
}

export type Confirmacao = { titulo: string; texto: string; botao: string; perigo?: boolean; acao: () => void | Promise<void> };

/** A pergunta antes do que não tem volta (no lugar do window.confirm). */
export function JanelaDeConfirmacao({ c, onFechar }: { c: Confirmacao | null; onFechar: () => void }) {
  if (!c) return null;
  return (
    <Janela titulo={c.titulo} onFechar={onFechar} largura={440} rodape={<>
      <button type="button" style={S.botaoLeve} onClick={onFechar}>Voltar</button>
      <button type="button" style={{ ...S.botao, background: c.perigo ? "#DC2626" : COR }} onClick={async () => { onFechar(); await c.acao(); }}>{c.botao}</button>
    </>}>
      <p style={{ ...S.texto, whiteSpace: "pre-line" }}>{c.texto}</p>
    </Janela>
  );
}

// ── Rede ────────────────────────────────────────────────────────────────────

export class ErroDaApi extends Error {
  constructor(mensagem: string, public status: number, public dados: any) { super(mensagem); }
}

export async function pedir<T = any>(url: string, metodo: "GET" | "POST" | "PUT" | "DELETE" = "GET", corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    cache: "no-store",
    headers: corpo !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroDaApi(j.error || "Não deu certo. Tente de novo.", r.status, j);
  return j as T;
}

/** Copia para a área de transferência — com o plano B do navegador antigo/sem HTTPS. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = texto;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ── Estilos ─────────────────────────────────────────────────────────────────

export const S: Record<string, React.CSSProperties> = {
  cartao: { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "16px 18px" },
  h2: { margin: 0, fontSize: 17, fontWeight: 800, color: "#0F172A" },
  texto: { margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.6 },
  rotulo: { display: "block", fontSize: 12.5, fontWeight: 800, color: "#334155", marginBottom: 5 },
  campo: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 15, fontFamily: "inherit", background: "#fff", color: "#0F172A" },
  botao: { height: 42, padding: "0 18px", borderRadius: 11, border: 0, background: COR, color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  botaoLeve: { height: 42, padding: "0 16px", borderRadius: 11, border: "1.5px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  botaoPequeno: { height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  chip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" },
};
