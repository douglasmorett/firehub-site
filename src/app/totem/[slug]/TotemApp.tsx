"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Check,
  ChefHat,
  ChevronRight,
  Clock,
  CreditCard,
  MessageSquare,
  Minus,
  Nfc,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { minimoExigidoDoGrupo, precoUnitarioDoItem } from "@/lib/preco-combo";

/* ═══════════════════════════════════════════════════════════════════════════
 * TOTEM DE AUTOATENDIMENTO
 *
 * Quem usa esta tela está EM PÉ, com o dedo, e nunca viu o sistema antes. Três
 * regras valem mais que qualquer estética aqui:
 *
 *  1. Nada de alvo pequeno. Todo botão tem no mínimo ALVO_TOQUE de altura.
 *  2. Nada de promessa que o sistema não cumpre. Se não há cobrança PIX de
 *     verdade, não existe botão de PIX; se a maquininha não está vinculada à
 *     licença, a tela manda pagar no caixa em vez de fingir que cobra.
 *  3. Nada de tela travada. Todo fetch tem prazo e toda espera tem saída — um
 *     quiosque parado em "Carregando..." fica assim até alguém desligar da
 *     tomada.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Altura mínima de qualquer alvo de toque. Dedo em pé, não cursor de mouse. */
const ALVO_TOQUE = 60;

/**
 * Cliente novo herdava o pedido do anterior porque a sessão só se apagava
 * depois de 90s parada — tempo de sobra para alguém chegar, achar que o
 * carrinho é dele e pagar a comida de outro. 60s, com aviso antes de zerar.
 */
const INATIVIDADE_MS = 60_000;
const AVISO_ANTES_MS = 15_000;

/** Prazos de rede. Sem eles, a queda do Wi-Fi da loja congela o quiosque. */
const TIMEOUT_REDE_MS = 12_000;
const TIMEOUT_PEDIDO_MS = 25_000;
const TIMEOUT_CARREGAMENTO_MS = 25_000;

const INTERVALO_POLL_MS = 2_000;
const INTERVALO_HEARTBEAT_MS = 60_000;

/** Depois disto na maquininha sem resposta, a tela sugere chamar um atendente. */
const ESPERA_ATE_CHAMAR_ATENDENTE_MS = 120_000;

/**
 * Cliente que desistiu e foi embora com a cobrança acesa. Passado este tempo o
 * totem derruba a cobrança sozinho: a ordem no Mercado Pago só expira em 15
 * min, e até lá a maquininha não aceita o próximo cliente e o quiosque fica
 * preso nesta tela.
 */
const ESPERA_MAXIMA_NA_MAQUININHA_MS = 5 * 60_000;

/**
 * De quanto em quanto tempo o cancelamento automático insiste. Uma tentativa só
 * não basta: o Mercado Pago fora do ar por um minuto deixava o quiosque preso
 * na tela da maquininha para sempre, porque enquanto o pagamento não termina
 * nem a contagem de inatividade o resgata.
 */
const INTERVALO_NOVA_TENTATIVA_DE_CANCELAR_MS = 30_000;

/**
 * Logo depois de subir a cobrança, o status gravado ainda pode ser o da
 * tentativa anterior (recusa antiga que o servidor ainda não sobrescreveu).
 * Sem esta carência, apertar "Tentar de novo" voltava para "recusado" na hora.
 */
const CARENCIA_APOS_INICIAR_MS = 3_000;

const SEGUNDOS_NA_CONFIRMACAO = 12;
const SEGUNDOS_NA_TELA_DO_CAIXA = 25;
const SEGUNDOS_PARA_RECARREGAR_NO_ERRO = 30;

const CATEGORIA_SEM_NOME = "cat__sem_categoria";

type Tela =
  | "CARREGANDO"
  | "ERRO"
  | "FECHADA"
  | "CARDAPIO"
  | "CARRINHO"
  | "NOME"
  | "PAGAMENTO"
  | "ENVIANDO"
  | "MAQUININHA"
  | "CAIXA"
  | "CONFIRMADO";

/**
 * Telas em que o cliente já está com dinheiro em jogo — o pedido foi gravado, o
 * cartão pode estar passando e a senha já está na mão dele. Nenhum aviso
 * administrativo (licença desligada, módulo desativado) troca a tela por um
 * erro daqui: isso apagaria o número do pedido de quem acabou de pagar.
 */
const TELAS_DE_PAGAMENTO = new Set<Tela>(["ENVIANDO", "MAQUININHA", "CAIXA", "CONFIRMADO"]);

type EstadoDoPagamento =
  | "INICIANDO"
  | "AGUARDANDO_CARTAO"
  | "PROCESSANDO"
  | "RECUSADO"
  | "EXPIRADO"
  | "CANCELADO"
  | "FALHOU_INICIAR";

type Loja = {
  nome: string;
  logoUrl: string | null;
  mensagem: string | null;
};

/**
 * Três estados, não dois. "DESCONHECIDA" existe porque a resposta de
 * /api/totem/auth pode não falar nada sobre maquininha: nesse caso esconder o
 * botão tiraria o cartão de uma loja que TEM Point, e afirmar que existe seria
 * inventar. Mostramos a opção e, se o servidor disser que não há maquininha
 * vinculada, ela some pelo resto da sessão.
 */
type Maquininha = {
  estado: "SIM" | "NAO" | "DESCONHECIDA";
  rotulo: string | null;
};

type Categoria = {
  id: string;
  name: string;
  sortOrder?: number;
  emoji?: string | null;
  imageUrl?: string | null;
};

type OpcaoDeGrupo = {
  id: string;
  additionalPrice?: number | null;
  maxPerItem?: number | null;
  optionNote?: string | null;
  menuProduct?: { id: string; name: string; active?: boolean; imageUrl?: string | null; price?: number } | null;
};

/**
 * Os nomes vêm do banco (prisma/schema.prisma → ComboGroup / ComboGroupItem) e
 * a rota /api/totem/menu devolve exatamente estes campos. A tela lia
 * `name/required/minItems/maxItems/price`, que não existem em lugar nenhum:
 * `0 < undefined` é false, então o "+" nunca habilitava e nenhum combo do totem
 * podia ser montado.
 */
type GrupoDeCombo = {
  id: string;
  title?: string | null;
  minQty?: number | null;
  maxQty?: number | null;
  sortOrder?: number;
  items?: OpcaoDeGrupo[] | null;
};

type Produto = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  category?: string | null;
  isCombo?: boolean | null;
  comboGroups?: GrupoDeCombo[] | null;
  /** Calculados pela rota do cardápio com a mesma conta do PDV e do delivery. */
  precoMinimo?: number;
  precoAPartirDe?: boolean;
};

/** Escolhas na tela: { grupoId: { opcaoId: quantidade } }. */
type EscolhasNaTela = Record<string, Record<string, number>>;

/** Escolhas no envio: { grupoId: { nomeDoProduto: quantidade } } — formato do cardápio. */
type EscolhasParaEnvio = Record<string, Record<string, number>>;

type DetalheDaEscolha = { grupo: string; nome: string; quantidade: number; adicional: number };

type ItemDoCarrinho = {
  id: string;
  produto: Produto;
  quantidade: number;
  escolhas: EscolhasParaEnvio | null;
  detalhes: DetalheDaEscolha[];
  precoUnitario: number;
  /** Duas adições iguais viram uma linha só com quantidade 2. */
  assinatura: string;
};

type PedidoCriado = {
  id: string;
  numero: string;
  /** O valor que o SERVIDOR gravou — é ele que a maquininha vai cobrar. */
  valor: number;
  aguardandoPagamento: boolean;
  assinatura: string;
};

/* ────────────────────────── AUXILIARES PUROS ─────────────────────────────── */

const formatarPreco = (valor: number) => `R$ ${(Number(valor) || 0).toFixed(2).replace(".", ",")}`;

/**
 * Marcas de acento que o NFD separa da letra (U+0300 a U+036F). Montada a
 * partir de string para o arquivo não depender de caractere combinante solto
 * no código-fonte, que qualquer editor com encoding errado corrompe.
 */
const ACENTOS_SOLTOS = new RegExp("[\\u0300-\\u036F]", "g");

/** Busca sem acento: quem digita "acai" no teclado do quiosque acha "Açaí". */
const semAcento = (texto: string) => texto.normalize("NFD").replace(ACENTOS_SOLTOS, "").toLowerCase().trim();

/**
 * AbortSignal.timeout resolve em navegador atual; o AbortController manual
 * existe porque quiosque roda em Chrome velho travado pelo cliente, e ali o
 * fetch sem prazo é justamente o que trava a tela para sempre.
 */
function prazoDe(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controle = new AbortController();
  setTimeout(() => controle.abort(), ms);
  return controle.signal;
}

type Resposta = { ok: boolean; status: number; dados: any; falhaDeRede: boolean };

async function chamar(
  url: string,
  opcoes: { metodo?: "GET" | "POST"; corpo?: any; prazoMs?: number } = {}
): Promise<Resposta> {
  const { metodo = "GET", corpo, prazoMs = TIMEOUT_REDE_MS } = opcoes;
  try {
    const res = await fetch(url, {
      method: metodo,
      cache: "no-store",
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: prazoDe(prazoMs),
    });
    const dados = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, dados, falhaDeRede: false };
  } catch {
    return { ok: false, status: 0, dados: null, falhaDeRede: true };
  }
}

/** Hash curto e estável — entra na chave de idempotência do pedido. */
function hashCurto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function novaSessao(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Só a opção que existe e está ativa pode ser oferecida ao cliente. */
function opcoesUtilizaveis(grupo: GrupoDeCombo): OpcaoDeGrupo[] {
  return (grupo.items || []).filter((o) => o?.menuProduct?.name && o.menuProduct.active !== false);
}

function gruposDoProduto(produto: Produto): GrupoDeCombo[] {
  return [...(produto.comboGroups || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function precisaMontar(produto: Produto): boolean {
  return gruposDoProduto(produto).length > 0;
}

/**
 * Combo cujo grupo obrigatório ficou sem nenhuma opção ativa não pode ser
 * montado. Melhor marcar "indisponível" no card do que deixar o cliente entrar
 * no modal e descobrir que o botão nunca habilita.
 */
function comboMontavel(produto: Produto): boolean {
  for (const grupo of gruposDoProduto(produto)) {
    const exigido = minimoExigidoDoGrupo(grupo);
    if (exigido <= 0) continue;
    // Não basta existir opção ativa: o `maxPerItem` de cada uma limita quanto
    // ela consegue somar. Um grupo que exige 3 e só oferece uma opção com
    // `maxPerItem` 1 também nunca fecha — e o cliente abriria um modal cujo
    // botão de confirmar não habilita nunca.
    const capacidade = opcoesUtilizaveis(grupo).reduce((soma, o) => soma + tetoDaOpcao(grupo, o), 0);
    if (capacidade < exigido) return false;
  }
  return true;
}

function tetoDaOpcao(grupo: GrupoDeCombo, opcao: OpcaoDeGrupo): number {
  const tetoDoGrupo = Math.max(1, Number(grupo.maxQty) || 1);
  const proprio = Number(opcao.maxPerItem);
  if (!Number.isFinite(proprio) || proprio <= 0) return tetoDoGrupo;
  return Math.min(proprio, tetoDoGrupo);
}

function escolhidosNoGrupo(escolhas: EscolhasNaTela, grupoId: string): number {
  return Object.values(escolhas[grupoId] || {}).reduce((soma, qtd) => soma + (Number(qtd) || 0), 0);
}

/**
 * Converte o que está na tela ({grupoId: {opcaoId: qtd}}) para o formato que o
 * servidor, o KDS e a comanda entendem ({grupoId: {nomeDoProduto: qtd}}).
 * O grupoId precisa sobreviver: a mesma opção pode custar diferente em dois
 * grupos, e é por ele que `somaDosAdicionais` acha o adicional certo.
 */
function escolhasParaEnvio(produto: Produto, escolhas: EscolhasNaTela): EscolhasParaEnvio | null {
  const saida: EscolhasParaEnvio = {};
  for (const grupo of gruposDoProduto(produto)) {
    for (const opcao of opcoesUtilizaveis(grupo)) {
      const qtd = Number(escolhas[grupo.id]?.[opcao.id]) || 0;
      const nome = opcao.menuProduct?.name;
      if (!nome || qtd <= 0) continue;
      if (!saida[grupo.id]) saida[grupo.id] = {};
      saida[grupo.id][nome] = (saida[grupo.id][nome] || 0) + qtd;
    }
  }
  return Object.keys(saida).length > 0 ? saida : null;
}

function detalhesDaEscolha(produto: Produto, escolhas: EscolhasNaTela): DetalheDaEscolha[] {
  const lista: DetalheDaEscolha[] = [];
  for (const grupo of gruposDoProduto(produto)) {
    for (const opcao of opcoesUtilizaveis(grupo)) {
      const qtd = Number(escolhas[grupo.id]?.[opcao.id]) || 0;
      if (qtd <= 0) continue;
      lista.push({
        grupo: grupo.title || "Escolhas",
        nome: opcao.menuProduct?.name || "",
        quantidade: qtd,
        adicional: Number(opcao.additionalPrice) || 0,
      });
    }
  }
  return lista;
}

function precoDeVitrine(produto: Produto): number {
  return typeof produto.precoMinimo === "number" ? produto.precoMinimo : Number(produto.price) || 0;
}

/** Onde a licença guarda a maquininha muda conforme a rota de auth evolui. */
function extrairMaquininha(auth: any): Maquininha {
  const bruto =
    auth?.license?.posTerminal ??
    auth?.license?.maquininha ??
    auth?.posTerminal ??
    auth?.maquininha ??
    null;

  const campoId =
    auth?.license?.posTerminalId ?? auth?.posTerminalId ?? auth?.store?.posTerminalId ?? undefined;
  const id = campoId ?? bruto?.id ?? bruto?.externalId ?? undefined;
  const rotulo = bruto?.label ?? bruto?.rotulo ?? null;

  if (id) return { estado: "SIM", rotulo: rotulo ? String(rotulo) : null };
  // Campo presente e vazio é uma resposta: esta licença não tem maquininha.
  const respondeuQueNaoTem =
    campoId === null || bruto === null || auth?.license?.posTerminalId === null || auth?.posTerminal === null;
  const falouDoAssunto =
    auth?.license !== undefined &&
    ("posTerminalId" in (auth.license || {}) || "posTerminal" in (auth.license || {}) || "maquininha" in (auth.license || {}));

  if (falouDoAssunto && respondeuQueNaoTem) return { estado: "NAO", rotulo: null };
  return { estado: "DESCONHECIDA", rotulo: null };
}

/* ─────────────────────────── ESTILOS COMPARTILHADOS ──────────────────────── */

const vidro: React.CSSProperties = {
  background: "rgba(30, 41, 59, 0.7)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 16,
};

const botaoPrimario: React.CSSProperties = {
  background: "linear-gradient(135deg, #C62828, #E53935)",
  color: "white",
  border: "none",
  borderRadius: 16,
  padding: "0 32px",
  minHeight: ALVO_TOQUE + 12,
  fontSize: 22,
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  cursor: "pointer",
};

const botaoSecundario: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 16,
  padding: "0 28px",
  minHeight: ALVO_TOQUE,
  fontSize: 20,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  cursor: "pointer",
};

const botaoVoltar: React.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  border: "none",
  borderRadius: 20,
  width: ALVO_TOQUE + 4,
  height: ALVO_TOQUE + 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "white",
  cursor: "pointer",
  flexShrink: 0,
};

const telaEscura: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#0F172A",
  display: "flex",
  flexDirection: "column",
  color: "white",
};

/* ──────────────────────────── TECLADO VIRTUAL ────────────────────────────── */

const LINHA_NUMEROS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const LINHAS_LETRAS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ç"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];
/** Sem esta linha ninguém escreve "João", "Açaí" ou "Ronaldão" no quiosque. */
const LINHA_ACENTOS = ["Á", "À", "Â", "Ã", "É", "Ê", "Í", "Ó", "Ô", "Õ", "Ú"];

function TecladoVirtual({
  texto,
  onTexto,
  maxLen,
  comNumeros = false,
}: {
  texto: string;
  onTexto: (novo: string) => void;
  maxLen: number;
  comNumeros?: boolean;
}) {
  const tecla: React.CSSProperties = {
    minWidth: ALVO_TOQUE,
    height: ALVO_TOQUE + 8,
    padding: "0 8px",
    background: "rgba(255,255,255,0.1)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    color: "white",
    fontSize: 26,
    fontWeight: 700,
    cursor: "pointer",
  };

  const digitar = (caractere: string) => {
    if (texto.length >= maxLen) return;
    onTexto(texto + caractere);
  };

  const linhas = comNumeros ? [LINHA_NUMEROS, ...LINHAS_LETRAS] : LINHAS_LETRAS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", width: "100%" }}>
      {linhas.map((linha, i) => (
        <div key={i} style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {linha.map((k) => (
            <button key={k} type="button" onClick={() => digitar(k)} style={tecla}>
              {k}
            </button>
          ))}
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        {LINHA_ACENTOS.map((k) => (
          <button key={k} type="button" onClick={() => digitar(k)} style={{ ...tecla, background: "rgba(255,255,255,0.06)" }}>
            {k}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => onTexto("")} style={{ ...tecla, minWidth: 150, fontSize: 22 }}>
          Limpar
        </button>
        <button type="button" onClick={() => digitar(" ")} style={{ ...tecla, minWidth: 300, fontSize: 22 }}>
          Espaço
        </button>
        <button type="button" onClick={() => onTexto(texto.slice(0, -1))} style={{ ...tecla, minWidth: 150, fontSize: 22 }}>
          Apagar
        </button>
      </div>
    </div>
  );
}

function ModalDeTeclado({
  titulo,
  subtitulo,
  valorInicial,
  placeholder,
  maxLen,
  textoConfirmar,
  comNumeros,
  exigeTexto,
  onConfirmar,
  onFechar,
}: {
  titulo: string;
  subtitulo?: string;
  valorInicial: string;
  placeholder: string;
  maxLen: number;
  textoConfirmar: string;
  comNumeros?: boolean;
  exigeTexto?: boolean;
  onConfirmar: (texto: string) => void;
  onFechar: () => void;
}) {
  const [texto, setTexto] = useState(valorInicial);
  const podeConfirmar = !exigeTexto || texto.trim().length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
        <div>
          <h2 style={{ fontSize: 32, fontWeight: 800, color: "white", margin: 0 }}>{titulo}</h2>
          {subtitulo && <p style={{ fontSize: 18, color: "#94A3B8", margin: "6px 0 0" }}>{subtitulo}</p>}
        </div>
        <button type="button" onClick={onFechar} style={botaoVoltar} aria-label="Fechar">
          <X size={30} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 24px 24px", gap: 28 }}>
        <div
          style={{
            width: "100%",
            maxWidth: 900,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 20,
            padding: "20px 28px",
            fontSize: 36,
            fontWeight: 700,
            color: "white",
            textAlign: "center",
            minHeight: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            wordBreak: "break-word",
          }}
        >
          {texto || <span style={{ color: "rgba(255,255,255,0.25)" }}>{placeholder}</span>}
        </div>

        <TecladoVirtual texto={texto} onTexto={setTexto} maxLen={maxLen} comNumeros={comNumeros} />
      </div>

      <div style={{ padding: 24, background: "#0F172A", display: "flex", gap: 16 }}>
        <button type="button" onClick={onFechar} style={{ ...botaoSecundario, flex: 1 }}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={!podeConfirmar}
          onClick={() => onConfirmar(texto)}
          style={{ ...botaoPrimario, flex: 2, opacity: podeConfirmar ? 1 : 0.45 }}
        >
          {textoConfirmar}
        </button>
      </div>
    </div>
  );
}

/**
 * Saída sempre visível. Sem ela, o cliente que desistiu no meio do pedido só
 * conseguia limpar a tela item por item — ou ia embora e deixava o carrinho
 * montado para o próximo, que pagava a comida de outra pessoa.
 */
function BotaoCancelarPedido({ onCancelar }: { onCancelar: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancelar}
      style={{
        minHeight: ALVO_TOQUE,
        padding: "0 24px",
        borderRadius: 16,
        border: "2px solid #F87171",
        background: "transparent",
        color: "#F87171",
        fontSize: 18,
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <Ban size={22} /> Cancelar pedido
    </button>
  );
}

function ModalDeConfirmacao({
  titulo,
  descricao,
  textoSim,
  textoNao,
  onSim,
  onNao,
}: {
  titulo: string;
  descricao: string;
  textoSim: string;
  textoNao: string;
  onSim: () => void;
  onNao: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ ...vidro, background: "#1E293B", maxWidth: 720, width: "100%", padding: 40, textAlign: "center" }}>
        <h2 style={{ fontSize: 34, fontWeight: 800, color: "white", margin: 0 }}>{titulo}</h2>
        <p style={{ fontSize: 20, color: "#94A3B8", margin: "16px 0 32px", lineHeight: 1.45 }}>{descricao}</p>
        <div style={{ display: "flex", gap: 16 }}>
          <button type="button" onClick={onNao} style={{ ...botaoSecundario, flex: 1 }}>
            {textoNao}
          </button>
          <button type="button" onClick={onSim} style={{ ...botaoPrimario, flex: 1, background: "linear-gradient(135deg, #B91C1C, #DC2626)" }}>
            {textoSim}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════ COMPONENTE ═══════════════════════════════ */

export default function TotemApp({ slug, token }: { slug: string; token: string }) {
  const [tela, setTela] = useState<Tela>("CARREGANDO");
  const [erro, setErro] = useState("");
  const [loja, setLoja] = useState<Loja | null>(null);
  const [maquininha, setMaquininha] = useState<Maquininha>({ estado: "DESCONHECIDA", rotulo: null });
  const [lojaAberta, setLojaAberta] = useState(true);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categoriaAtiva, setCategoriaAtiva] = useState("");
  const [busca, setBusca] = useState("");

  const [carrinho, setCarrinho] = useState<ItemDoCarrinho[]>([]);
  const [nomeDoCliente, setNomeDoCliente] = useState("");
  const [observacao, setObservacao] = useState("");

  const [comboAberto, setComboAberto] = useState<Produto | null>(null);
  const [escolhas, setEscolhas] = useState<EscolhasNaTela>({});

  const [teclado, setTeclado] = useState<null | "BUSCA" | "OBSERVACAO">(null);
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const [avisoDeInatividade, setAvisoDeInatividade] = useState(false);
  const [segundosDoAviso, setSegundosDoAviso] = useState(Math.round(AVISO_ANTES_MS / 1000));

  const [pedido, setPedido] = useState<PedidoCriado | null>(null);
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  const [estadoDoPagamento, setEstadoDoPagamento] = useState<EstadoDoPagamento>("INICIANDO");
  const [detalheDoPagamento, setDetalheDoPagamento] = useState<string | null>(null);
  const [semRespostaDoServidor, setSemRespostaDoServidor] = useState(false);
  const [erroDoCancelamento, setErroDoCancelamento] = useState<string | null>(null);
  const [avisoNoCaixa, setAvisoNoCaixa] = useState<string | null>(null);
  const [cancelandoCobranca, setCancelandoCobranca] = useState(false);
  const [segundosNaEspera, setSegundosNaEspera] = useState(0);
  const [contagemRegressiva, setContagemRegressiva] = useState(0);

  const sessaoRef = useRef<string>(novaSessao());
  const lojaAbertaRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);
  const inicioDaCobrancaRef = useRef(0);
  const telaRef = useRef<Tela>("CARREGANDO");
  const desligamentoPendenteRef = useRef<string | null>(null);

  useEffect(() => {
    lojaAbertaRef.current = lojaAberta;
  }, [lojaAberta]);

  useEffect(() => {
    telaRef.current = tela;
  }, [tela]);

  /**
   * Tira o totem do ar por decisão do painel (licença desativada, módulo
   * desligado). Quem está no meio de um pagamento não é interrompido: o cartão
   * pode já ter passado e a tela de erro apagaria o número do pedido junto. O
   * desligamento fica guardado e cai assim que o atendimento termina.
   */
  const desligar = useCallback((mensagem: string) => {
    if (TELAS_DE_PAGAMENTO.has(telaRef.current)) {
      desligamentoPendenteRef.current = mensagem;
      return;
    }
    setErro(mensagem);
    setTela("ERRO");
  }, []);

  useEffect(() => {
    const pendente = desligamentoPendenteRef.current;
    if (!pendente || TELAS_DE_PAGAMENTO.has(tela)) return;
    desligamentoPendenteRef.current = null;
    setErro(pendente);
    setTela("ERRO");
  }, [tela]);

  /* ───────────────────────────── SOM ─────────────────────────────────────── */

  /**
   * Um AudioContext por bipe vazava um contexto de áudio a cada item do
   * carrinho; depois de algumas dezenas o navegador para de criar novos e o
   * totem fica mudo (Chrome limita a 6 por página). Um só, reaproveitado.
   */
  const bipar = useCallback(() => {
    try {
      const Construtor: typeof AudioContext | undefined =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Construtor) return;
      if (!audioRef.current) audioRef.current = new Construtor();
      const ctx = audioRef.current;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.connect(ganho);
      ganho.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 800;
      ganho.gain.setValueAtTime(0.1, ctx.currentTime);
      ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      /* quiosque sem áudio continua vendendo */
    }
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);

  /* ────────────────────────── SESSÃO DO CLIENTE ──────────────────────────── */

  /**
   * Zerar sessão é apagar TUDO: carrinho, nome, observação, busca, modal de
   * combo aberto, teclado, pedido em curso e a tela. Antes só o carrinho e o
   * nome saíam — o modal de combo do cliente anterior continuava aberto na
   * cara do próximo.
   */
  const reiniciarSessao = useCallback(() => {
    setCarrinho([]);
    setNomeDoCliente("");
    setObservacao("");
    setBusca("");
    setComboAberto(null);
    setEscolhas({});
    setTeclado(null);
    setConfirmarCancelamento(false);
    setAvisoDeInatividade(false);
    setPedido(null);
    setErroDoEnvio(null);
    setEstadoDoPagamento("INICIANDO");
    setDetalheDoPagamento(null);
    setErroDoCancelamento(null);
    setAvisoNoCaixa(null);
    setSemRespostaDoServidor(false);
    setCategoriaAtiva("");
    sessaoRef.current = novaSessao();
    setTela(lojaAbertaRef.current ? "CARDAPIO" : "FECHADA");
  }, []);

  /* ─────────────────────────── CARGA INICIAL ─────────────────────────────── */

  useEffect(() => {
    let vivo = true;

    async function iniciar() {
      if (!token) {
        setErro("Token de acesso do totem não informado. Abra a tela pelo link gerado no painel, em Totem.");
        setTela("ERRO");
        return;
      }

      let impressaoDigital = "";
      try {
        const partes = [
          window.screen.width,
          window.screen.height,
          navigator.userAgent,
          navigator.hardwareConcurrency || 1,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          navigator.language,
        ].join("|");
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(partes));
        impressaoDigital = Array.from(new Uint8Array(bytes))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      } catch {
        // Sem crypto.subtle (http sem TLS na rede da loja) o vínculo de
        // aparelho não é enviado. A rota trata fingerprint ausente.
        impressaoDigital = "";
      }
      if (!vivo) return;

      const auth = await chamar("/api/totem/auth", {
        metodo: "POST",
        corpo: { token, fingerprint: impressaoDigital || undefined },
      });
      if (!vivo) return;
      if (!auth.ok) {
        setErro(
          auth.falhaDeRede
            ? "Sem resposta do servidor. Confira a internet da loja."
            : auth.dados?.error || "Falha ao autenticar este totem."
        );
        setTela("ERRO");
        return;
      }

      const cardapio = await chamar(`/api/totem/menu?token=${encodeURIComponent(token)}`);
      if (!vivo) return;
      if (!cardapio.ok) {
        setErro(
          cardapio.falhaDeRede
            ? "Sem resposta do servidor ao carregar o cardápio."
            : cardapio.dados?.error || "Falha ao carregar o cardápio."
        );
        setTela("ERRO");
        return;
      }

      setLoja({
        nome: auth.dados?.store?.name || "Cardápio",
        logoUrl: auth.dados?.store?.logo || null,
        mensagem: auth.dados?.store?.config?.welcomeMessage || null,
      });
      setMaquininha(extrairMaquininha(auth.dados));

      // A resposta trazia `isOpen` e a tela jogava fora: o totem seguia
      // vendendo com a loja fechada e a cozinha recebia pedido de madrugada.
      const aberta = auth.dados?.store?.isOpen !== false;
      lojaAbertaRef.current = aberta;
      setLojaAberta(aberta);

      setCategorias(Array.isArray(cardapio.dados?.categories) ? cardapio.dados.categories : []);
      setProdutos(Array.isArray(cardapio.dados?.products) ? cardapio.dados.products : []);
      setTela(aberta ? "CARDAPIO" : "FECHADA");
    }

    void iniciar();

    let travaDeTela: WakeLockSentinel | null = null;
    (async () => {
      try {
        if ("wakeLock" in navigator) {
          travaDeTela = await (navigator as Navigator & { wakeLock: WakeLock }).wakeLock.request("screen");
        }
      } catch {
        /* sem wakeLock a tela apaga sozinha, mas o totem funciona */
      }
    })();

    return () => {
      vivo = false;
      travaDeTela?.release().catch(() => {});
    };
  }, [slug, token]);

  /**
   * Saída da tela de carregamento. Sem isto, uma resposta que nunca chega
   * (proxy da loja engolindo a requisição) deixa o quiosque girando o ícone
   * até alguém puxar da tomada.
   */
  useEffect(() => {
    if (tela !== "CARREGANDO") return;
    const id = setTimeout(() => {
      setErro("O servidor não respondeu. Verifique a internet da loja e toque em Tentar de novo.");
      setTela("ERRO");
    }, TIMEOUT_CARREGAMENTO_MS);
    return () => clearTimeout(id);
  }, [tela]);

  /** Quiosque não tem ninguém para apertar "Tentar de novo" de madrugada. */
  useEffect(() => {
    if (tela !== "ERRO") return;
    setContagemRegressiva(SEGUNDOS_PARA_RECARREGAR_NO_ERRO);
    const fim = Date.now() + SEGUNDOS_PARA_RECARREGAR_NO_ERRO * 1000;
    const id = setInterval(() => {
      const resta = Math.max(0, Math.ceil((fim - Date.now()) / 1000));
      setContagemRegressiva(resta);
      if (resta <= 0) {
        clearInterval(id);
        window.location.reload();
      }
    }, 250);
    return () => clearInterval(id);
  }, [tela]);

  /* ──────────────────────────── HEARTBEAT ────────────────────────────────── */

  /**
   * A resposta do heartbeat era descartada. Ela é o único canal que avisa o
   * totem de que a licença foi desligada no painel ou de que a loja fechou —
   * sem ler isso, a tela de venda continua no ar aceitando pedidos.
   */
  useEffect(() => {
    if (!token) return;

    let vivo = true;
    const bater = async () => {
      const r = await chamar("/api/totem/heartbeat", { metodo: "POST", corpo: { token }, prazoMs: 10_000 });
      if (!vivo) return;

      // Falha de rede não derruba um totem que está funcionando: a loja pode
      // ter perdido a internet por dez segundos no meio de um pedido.
      if (r.falhaDeRede) return;

      // Só 401 e 403 são resposta SOBRE A LICENÇA — é o que `autenticarTotem`
      // devolve para token desconhecido, licença desativada e módulo desligado.
      // Qualquer outro erro é do servidor (o 500 de "Erro interno" quando o
      // Postgres da Neon acorda de um sono, por exemplo), e derrubar o totem por
      // causa dele tirava o autoatendimento do ar sozinho, no meio do
      // movimento, sem ninguém ter mexido em nada no painel.
      if (!r.ok && r.status !== 401 && r.status !== 403) return;

      if (!r.ok || r.dados?.active === false) {
        desligar(r.dados?.error || "Esta licença de totem foi desativada. Fale com o gerente da loja.");
        return;
      }
      if (r.dados?.totemEnabled === false) {
        desligar("O módulo Totem foi desligado para esta loja.");
        return;
      }
      setLojaAberta(r.dados?.storeOpen !== false);
    };

    const id = setInterval(bater, INTERVALO_HEARTBEAT_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [token, desligar]);

  /**
   * Loja fechada durante a sessão: a venda para na hora. Não interrompemos quem
   * já está na maquininha ou já viu a senha — esse dinheiro já entrou.
   */
  useEffect(() => {
    const emVenda = tela === "CARDAPIO" || tela === "CARRINHO" || tela === "NOME" || tela === "PAGAMENTO";
    if (!lojaAberta && emVenda) {
      setCarrinho([]);
      setComboAberto(null);
      setTeclado(null);
      setTela("FECHADA");
    }
    if (lojaAberta && tela === "FECHADA") setTela("CARDAPIO");
  }, [lojaAberta, tela]);

  /* ─────────────────────────── INATIVIDADE ───────────────────────────────── */

  const pagamentoEncerrado =
    estadoDoPagamento === "RECUSADO" ||
    estadoDoPagamento === "EXPIRADO" ||
    estadoDoPagamento === "CANCELADO" ||
    estadoDoPagamento === "FALHOU_INICIAR";

  /**
   * A tela da maquininha entra na regra de inatividade SÓ depois que a cobrança
   * morreu. Enquanto há cobrança viva no visor, apagar a sessão sozinho jogaria
   * fora o pedido de quem está com o cartão na mão; depois que ela morre, o
   * quiosque precisa se liberar para o próximo cliente.
   */
  const telaDeSessao =
    tela === "CARDAPIO" ||
    tela === "CARRINHO" ||
    tela === "NOME" ||
    tela === "PAGAMENTO" ||
    (tela === "MAQUININHA" && pagamentoEncerrado);
  const temAlgoAPerder =
    carrinho.length > 0 || nomeDoCliente.length > 0 || busca.length > 0 || comboAberto !== null || observacao.length > 0;

  useEffect(() => {
    if (!telaDeSessao) {
      setAvisoDeInatividade(false);
      return;
    }

    let idAviso: ReturnType<typeof setTimeout> | null = null;
    let idFim: ReturnType<typeof setTimeout> | null = null;

    const armar = () => {
      if (idAviso) clearTimeout(idAviso);
      if (idFim) clearTimeout(idFim);
      setAvisoDeInatividade(false);
      if (temAlgoAPerder) {
        idAviso = setTimeout(() => setAvisoDeInatividade(true), INATIVIDADE_MS - AVISO_ANTES_MS);
      }
      idFim = setTimeout(() => reiniciarSessao(), INATIVIDADE_MS);
    };

    armar();
    window.addEventListener("pointerdown", armar);
    window.addEventListener("keydown", armar);
    return () => {
      if (idAviso) clearTimeout(idAviso);
      if (idFim) clearTimeout(idFim);
      window.removeEventListener("pointerdown", armar);
      window.removeEventListener("keydown", armar);
    };
  }, [telaDeSessao, temAlgoAPerder, reiniciarSessao]);

  useEffect(() => {
    if (!avisoDeInatividade) return;
    const fim = Date.now() + AVISO_ANTES_MS;
    setSegundosDoAviso(Math.round(AVISO_ANTES_MS / 1000));
    const id = setInterval(() => setSegundosDoAviso(Math.max(0, Math.ceil((fim - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, [avisoDeInatividade]);

  /* ─────────────────────── CATEGORIAS E PRODUTOS ─────────────────────────── */

  const categoriasVisiveis = useMemo(() => {
    // `sort` direto no array de estado reordenava o próprio estado durante o
    // render — cópia antes de ordenar.
    const lista = [...categorias].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "pt-BR")
    );

    const daCategoria = (c: Categoria) =>
      produtos.some((p) => semAcento(p.category || "") === semAcento(c.name));

    const comProduto = lista.filter(daCategoria);
    // Produto sem categoria cadastrada não pode sumir da tela por causa disso.
    if (produtos.some((p) => !semAcento(p.category || ""))) {
      comProduto.push({ id: CATEGORIA_SEM_NOME, name: "Outros", sortOrder: 999, emoji: "🍽️", imageUrl: null });
    }
    return comProduto;
  }, [categorias, produtos]);

  useEffect(() => {
    if (categoriasVisiveis.length === 0) return;
    if (!categoriasVisiveis.some((c) => c.id === categoriaAtiva)) {
      setCategoriaAtiva(categoriasVisiveis[0].id);
    }
  }, [categoriasVisiveis, categoriaAtiva]);

  const produtosNaTela = useMemo(() => {
    const termo = semAcento(busca);
    if (termo) {
      return produtos.filter(
        (p) => semAcento(p.name).includes(termo) || semAcento(p.description || "").includes(termo)
      );
    }
    const cat = categoriasVisiveis.find((c) => c.id === categoriaAtiva);
    if (!cat) return produtos;
    if (cat.id === CATEGORIA_SEM_NOME) return produtos.filter((p) => !semAcento(p.category || ""));
    return produtos.filter((p) => semAcento(p.category || "") === semAcento(cat.name));
  }, [produtos, busca, categoriasVisiveis, categoriaAtiva]);

  const total = useMemo(
    () => carrinho.reduce((soma, i) => soma + i.precoUnitario * i.quantidade, 0),
    [carrinho]
  );
  const quantidadeNoCarrinho = useMemo(
    () => carrinho.reduce((soma, i) => soma + i.quantidade, 0),
    [carrinho]
  );

  /* ──────────────────────────── CARRINHO ─────────────────────────────────── */

  const adicionarAoCarrinho = useCallback(
    (produto: Produto, paraEnvio: EscolhasParaEnvio | null, detalhes: DetalheDaEscolha[]) => {
      const precoUnitario = precoUnitarioDoItem(produto, paraEnvio);
      const assinatura = `${produto.id}|${JSON.stringify(paraEnvio ?? {})}`;
      setCarrinho((atual) => {
        const i = atual.findIndex((x) => x.assinatura === assinatura);
        if (i >= 0) {
          const copia = [...atual];
          copia[i] = { ...copia[i], quantidade: copia[i].quantidade + 1 };
          return copia;
        }
        return [
          ...atual,
          {
            id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
            produto,
            quantidade: 1,
            escolhas: paraEnvio,
            detalhes,
            precoUnitario,
            assinatura,
          },
        ];
      });
      bipar();
    },
    [bipar]
  );

  const abrirProduto = (produto: Produto) => {
    if (precisaMontar(produto)) {
      if (!comboMontavel(produto)) return;
      setComboAberto(produto);
      setEscolhas({});
      return;
    }
    adicionarAoCarrinho(produto, null, []);
  };

  /**
   * O "−" para em 1: quem quer tirar o item usa o botão Remover, que fica longe
   * e pede um toque deliberado. Deixar o "−" apagar a linha era o mesmo dedo
   * grosso do quiosque perdendo o item sem entender o que aconteceu.
   */
  const mudarQuantidade = (id: string, delta: number) => {
    setCarrinho((atual) =>
      atual.map((item) =>
        item.id === id ? { ...item, quantidade: Math.min(99, Math.max(1, item.quantidade + delta)) } : item
      )
    );
  };

  const removerItem = (id: string) => setCarrinho((atual) => atual.filter((i) => i.id !== id));

  /* ───────────────────────── MODAL DO COMBO ──────────────────────────────── */

  const gruposAbertos = useMemo(() => (comboAberto ? gruposDoProduto(comboAberto) : []), [comboAberto]);

  const faltandoNoCombo = useMemo(() => {
    if (!comboAberto) return [] as string[];
    const faltas: string[] = [];
    for (const grupo of gruposAbertos) {
      const exigido = minimoExigidoDoGrupo(grupo);
      const escolhido = escolhidosNoGrupo(escolhas, grupo.id);
      if (escolhido < exigido) {
        faltas.push(`${grupo.title || "Escolhas"} (faltam ${exigido - escolhido})`);
      }
    }
    return faltas;
  }, [comboAberto, gruposAbertos, escolhas]);

  const precoDoComboAberto = useMemo(() => {
    if (!comboAberto) return 0;
    return precoUnitarioDoItem(comboAberto, escolhasParaEnvio(comboAberto, escolhas));
  }, [comboAberto, escolhas]);

  const mudarEscolha = (grupo: GrupoDeCombo, opcao: OpcaoDeGrupo, delta: number) => {
    setEscolhas((atual) => {
      const doGrupo = { ...(atual[grupo.id] || {}) };
      const atualDaOpcao = Number(doGrupo[opcao.id]) || 0;
      const nova = atualDaOpcao + delta;

      if (nova < 0) return atual;
      if (delta > 0) {
        const totalNoGrupo = escolhidosNoGrupo(atual, grupo.id);
        if (totalNoGrupo >= Math.max(1, Number(grupo.maxQty) || 1)) return atual;
        if (nova > tetoDaOpcao(grupo, opcao)) return atual;
      }

      if (nova === 0) delete doGrupo[opcao.id];
      else doGrupo[opcao.id] = nova;
      return { ...atual, [grupo.id]: doGrupo };
    });
  };

  const confirmarCombo = () => {
    if (!comboAberto || faltandoNoCombo.length > 0) return;
    adicionarAoCarrinho(comboAberto, escolhasParaEnvio(comboAberto, escolhas), detalhesDaEscolha(comboAberto, escolhas));
    setComboAberto(null);
    setEscolhas({});
  };

  /* ───────────────────────────── PEDIDO ──────────────────────────────────── */

  const assinaturaDoCarrinho = useMemo(
    () =>
      carrinho
        .map((i) => `${i.produto.id}:${i.quantidade}:${JSON.stringify(i.escolhas ?? {})}`)
        .join("|") + `#${observacao.trim()}`,
    [carrinho, observacao]
  );

  /**
   * A chave é a mesma enquanto o carrinho não muda dentro da mesma sessão, e vai
   * no corpo do pedido para quando /api/totem/order souber deduplicar por ela.
   *
   * Hoje aquela rota IGNORA este campo: cada POST grava um pedido novo. Então a
   * única proteção real contra duplicidade é a daqui — enquanto o carrinho não
   * muda, o cliente reaproveita o pedido já criado e o POST não se repete. O
   * buraco que sobra é a resposta que nunca chega: o servidor pode ter gravado,
   * a tela não fica sabendo, e um segundo toque cria o segundo pedido. É por
   * isso que a mensagem de falha de rede manda chamar um atendente em vez de
   * prometer que nada foi duplicado.
   */
  const chaveDeIdempotencia = useMemo(
    () => `totem-${sessaoRef.current}-${hashCurto(assinaturaDoCarrinho)}`,
    [assinaturaDoCarrinho]
  );

  const criarPedido = useCallback(
    async (formaDePagamento: string): Promise<PedidoCriado | null> => {
      // Pedido já criado para exatamente este carrinho: reaproveita. Vale para
      // o caso de o cliente voltar da maquininha e tentar de novo.
      if (pedido && pedido.assinatura === assinaturaDoCarrinho) return pedido;

      setErroDoEnvio(null);
      setTela("ENVIANDO");

      const r = await chamar("/api/totem/order", {
        metodo: "POST",
        prazoMs: TIMEOUT_PEDIDO_MS,
        corpo: {
          token,
          idempotencyKey: chaveDeIdempotencia,
          customerName: nomeDoCliente.trim() || "Cliente Totem",
          notes: observacao.trim() || undefined,
          paymentMethod: formaDePagamento,
          items: carrinho.map((i) => ({
            menuProductId: i.produto.id,
            quantity: i.quantidade,
            comboSelections: i.escolhas,
          })),
        },
      });

      const dadosDoPedido = r.dados?.order;

      // 409 tem dois significados nesta rota: item que saiu do cardápio (sem
      // pedido no corpo) e reenvio da mesma chave (com o pedido já gravado).
      if (r.ok || (r.status === 409 && dadosDoPedido?.id)) {
        if (!dadosDoPedido?.id) {
          setErroDoEnvio("O servidor aceitou o pedido mas não devolveu o número. Chame um atendente.");
          setTela("PAGAMENTO");
          return null;
        }
        const valorGravado = Number(dadosDoPedido.totalAmount);
        const criado: PedidoCriado = {
          id: String(dadosDoPedido.id),
          numero: String(dadosDoPedido.numero ?? dadosDoPedido.dailyOrderNumber ?? ""),
          // O valor exibido daqui para frente é o do servidor: ele aplica o
          // piso de preço dos itens montados, e é ele que vai para o visor da
          // maquininha. Mostrar o total da tela seria prometer outro preço.
          valor: Number.isFinite(valorGravado) && valorGravado > 0 ? valorGravado : total,
          aguardandoPagamento: dadosDoPedido.status === "AGUARDANDO_PAGAMENTO",
          assinatura: assinaturaDoCarrinho,
        };
        setPedido(criado);
        return criado;
      }

      if (r.status === 409) {
        setErroDoEnvio(r.dados?.mensagem || "Alguns itens saíram do cardápio. Refaça o pedido.");
        setCarrinho([]);
        setPedido(null);
        setTela("CARDAPIO");
        return null;
      }

      setErroDoEnvio(
        r.falhaDeRede
          ? "Não sabemos se o pedido chegou a ser registrado. Chame um atendente antes de tentar de novo — tocar outra vez pode gerar dois pedidos."
          : r.dados?.error || r.dados?.mensagem || "Não foi possível registrar o pedido."
      );
      setTela("PAGAMENTO");
      return null;
    },
    [assinaturaDoCarrinho, carrinho, chaveDeIdempotencia, nomeDoCliente, observacao, pedido, token, total]
  );

  /* ─────────────────────── COBRANÇA NA MAQUININHA ────────────────────────── */

  const iniciarCobranca = useCallback(
    async (orderId: string) => {
      setEstadoDoPagamento("INICIANDO");
      setDetalheDoPagamento(null);
      setErroDoCancelamento(null);
      setSemRespostaDoServidor(false);
      setSegundosNaEspera(0);

      // A contagem de tentativas (que vira a X-Idempotency-Key do Mercado Pago)
      // é do servidor, tirada de CustomerOrder.posTentativas. Um contador em
      // memória aqui repetiria a chave depois de qualquer recarregamento da
      // página e o MP devolveria a cobrança velha em vez de acender a nova.
      const r = await chamar("/api/totem/payment/start", {
        metodo: "POST",
        prazoMs: 20_000,
        corpo: { token, orderId },
      });

      // A rota confirma o pagamento sozinha quando descobre no MP que o cartão
      // já passou e o webhook não chegou. Nesse caso não há o que esperar.
      if (r.dados?.pago === true) {
        bipar();
        setTela("CONFIRMADO");
        return;
      }

      if (!r.ok) {
        if (r.dados?.code === "TERMINAL_NAO_VINCULADO") {
          // Esta licença não tem maquininha: some com a opção para o próximo
          // cliente não bater na mesma parede.
          setMaquininha({ estado: "NAO", rotulo: null });
        }
        setEstadoDoPagamento("FALHOU_INICIAR");
        setDetalheDoPagamento(
          r.falhaDeRede
            ? "Não conseguimos falar com o servidor para acender a cobrança."
            : r.dados?.error || r.dados?.mensagem || "A maquininha não aceitou a cobrança."
        );
        return;
      }

      const rotulo = r.dados?.terminal?.label;
      if (rotulo) setMaquininha({ estado: "SIM", rotulo: String(rotulo) });

      inicioDaCobrancaRef.current = Date.now();
      setEstadoDoPagamento("AGUARDANDO_CARTAO");
    },
    [bipar, token]
  );

  const pagarNaMaquininha = async () => {
    const criado = await criarPedido("Cartão (Maquininha)");
    if (!criado) return;
    setTela("MAQUININHA");
    await iniciarCobranca(criado.id);
  };

  const pagarNoCaixa = async () => {
    const criado = await criarPedido("Pagar no caixa");
    if (!criado) return;
    setTela("CAIXA");
  };

  /** Polling do status. Só roda enquanto a cobrança pode mudar de estado. */
  useEffect(() => {
    if (tela !== "MAQUININHA" || !pedido?.id) return;
    if (estadoDoPagamento !== "AGUARDANDO_CARTAO" && estadoDoPagamento !== "PROCESSANDO") return;

    let vivo = true;
    let falhasSeguidas = 0;

    const consultar = async () => {
      const r = await chamar(
        `/api/totem/payment-status?token=${encodeURIComponent(token)}&orderId=${encodeURIComponent(pedido.id)}`,
        { prazoMs: 8_000 }
      );
      if (!vivo) return;

      if (!r.ok) {
        falhasSeguidas += 1;
        // Uma falha isolada é ruído de rede; duas seguidas o cliente precisa
        // saber, senão fica olhando uma tela que parou de contar.
        setSemRespostaDoServidor(falhasSeguidas >= 2);
        return;
      }
      falhasSeguidas = 0;
      setSemRespostaDoServidor(false);

      const d = r.dados || {};
      if (d.paid === true) {
        bipar();
        setTela("CONFIRMADO");
        return;
      }

      const dentroDaCarencia = Date.now() - inicioDaCobrancaRef.current < CARENCIA_APOS_INICIAR_MS;
      const statusDaMaquininha = String(d.posStatus || d.pos?.status || "").toLowerCase();

      if (statusDaMaquininha === "failed" || statusDaMaquininha === "rejected") {
        if (!dentroDaCarencia) setEstadoDoPagamento("RECUSADO");
        return;
      }
      if (statusDaMaquininha === "expired") {
        if (!dentroDaCarencia) setEstadoDoPagamento("EXPIRADO");
        return;
      }
      if (d.canceled === true || statusDaMaquininha === "canceled") {
        if (!dentroDaCarencia) setEstadoDoPagamento("CANCELADO");
        return;
      }
      if (statusDaMaquininha && statusDaMaquininha !== "created") {
        setEstadoDoPagamento("PROCESSANDO");
        return;
      }
      setEstadoDoPagamento("AGUARDANDO_CARTAO");
    };

    void consultar();
    const id = setInterval(() => void consultar(), INTERVALO_POLL_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [tela, pedido?.id, estadoDoPagamento, token, bipar]);

  /** Contador da espera: 40s de maquininha sem nada se mexendo parece travado. */
  useEffect(() => {
    if (tela !== "MAQUININHA") return;
    const inicio = Date.now();
    setSegundosNaEspera(0);
    const id = setInterval(() => setSegundosNaEspera(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(id);
  }, [tela, estadoDoPagamento]);

  const cancelarCobranca = async () => {
    if (!pedido?.id || cancelandoCobranca) return;
    setCancelandoCobranca(true);
    setErroDoCancelamento(null);

    const r = await chamar("/api/totem/payment/cancel", {
      metodo: "POST",
      prazoMs: 15_000,
      corpo: { token, orderId: pedido.id },
    });
    setCancelandoCobranca(false);

    // O cartão pode ter sido aprovado no instante entre o toque e o
    // cancelamento. A rota responde JA_PAGO e confirma o pedido — dizer
    // "cancelado" aqui mandaria o cliente embora achando que não pagou.
    if (r.dados?.pago === true) {
      bipar();
      setTela("CONFIRMADO");
      return;
    }

    if (r.ok) {
      setEstadoDoPagamento("CANCELADO");
      setDetalheDoPagamento(r.dados?.mensagem || "Cobrança cancelada. Nada foi cobrado do seu cartão.");
      return;
    }

    // Nunca dizer "cancelado" sem o servidor confirmar: o visor da maquininha
    // pode continuar cobrando, e o cliente iria embora achando que não pagou.
    setErroDoCancelamento(
      r.falhaDeRede
        ? "Não conseguimos falar com o servidor para cancelar. A cobrança pode continuar no visor da maquininha."
        : r.dados?.error || "Não foi possível cancelar a cobrança por aqui."
    );
  };

  /**
   * Saída da tela da maquininha para o caixa.
   *
   * Quando o start falhou sem conseguir CONFERIR a cobrança anterior
   * (MP_INDISPONIVEL), pode ter ficado cobrança viva no visor. Mandar o cliente
   * pagar no balcão sem derrubá-la é o caminho para ele pagar duas vezes — no
   * caixa e no cartão, quando alguém encostar na maquininha. Tentamos derrubar
   * antes; se não der, o aviso vai junto para a tela do caixa em vez de o totem
   * fingir que está tudo limpo.
   */
  const irParaOCaixa = async () => {
    if (estadoDoPagamento !== "FALHOU_INICIAR" || !pedido?.id || cancelandoCobranca) {
      setTela("CAIXA");
      return;
    }

    setCancelandoCobranca(true);
    const r = await chamar("/api/totem/payment/cancel", {
      metodo: "POST",
      prazoMs: 15_000,
      corpo: { token, orderId: pedido.id },
    });
    setCancelandoCobranca(false);

    // Cartão aprovado no meio do caminho: a rota confirma o pedido e devolve
    // `pago`. Mandar esse cliente para o caixa seria cobrá-lo duas vezes.
    if (r.dados?.pago === true) {
      bipar();
      setTela("CONFIRMADO");
      return;
    }

    // SEM_COBRANCA é a resposta de um pedido que nunca chegou a acender visor
    // nenhum: não há nada preso lá e o caminho para o caixa está limpo.
    if (!r.ok && r.dados?.code !== "SEM_COBRANCA") {
      setAvisoNoCaixa(
        "Pode ter ficado uma cobrança presa no visor da maquininha. Avise o atendente antes de pagar."
      );
    }
    setTela("CAIXA");
  };

  // A referência existe para o temporizador abaixo não reiniciar a cada render:
  // com a função nas dependências, o prazo de abandono nunca chegaria ao fim.
  const cancelarCobrancaRef = useRef(cancelarCobranca);
  useEffect(() => {
    cancelarCobrancaRef.current = cancelarCobranca;
  });

  useEffect(() => {
    if (tela !== "MAQUININHA" || pagamentoEncerrado) return;
    const limite = Date.now() + ESPERA_MAXIMA_NA_MAQUININHA_MS;
    // Insiste, não tenta uma vez só. Com um `setTimeout`, o cancelamento que
    // falhasse (Mercado Pago fora do ar por um minuto) deixava o quiosque
    // parado nesta tela indefinidamente: o pagamento não terminou, então nem a
    // contagem de inatividade o resgata, e de madrugada não há ninguém no salão
    // para tocar em nada.
    const id = setInterval(() => {
      if (Date.now() < limite) return;
      void cancelarCobrancaRef.current();
    }, INTERVALO_NOVA_TENTATIVA_DE_CANCELAR_MS);
    return () => clearInterval(id);
  }, [tela, pagamentoEncerrado]);

  /* ─────────────── CONTAGEM DAS TELAS DE FIM DE ATENDIMENTO ──────────────── */

  useEffect(() => {
    if (tela !== "CONFIRMADO" && tela !== "CAIXA") return;
    const segundos = tela === "CONFIRMADO" ? SEGUNDOS_NA_CONFIRMACAO : SEGUNDOS_NA_TELA_DO_CAIXA;
    setContagemRegressiva(segundos);
    const fim = Date.now() + segundos * 1000;
    const id = setInterval(() => {
      const resta = Math.max(0, Math.ceil((fim - Date.now()) / 1000));
      setContagemRegressiva(resta);
      if (resta <= 0) {
        clearInterval(id);
        reiniciarSessao();
      }
    }, 250);
    return () => clearInterval(id);
  }, [tela, reiniciarSessao]);

  /* ═════════════════════════════ RENDERIZAÇÃO ═══════════════════════════════ */

  const botaoCancelarPedido = <BotaoCancelarPedido onCancelar={() => setConfirmarCancelamento(true)} />;

  const sobreposicoes = (
    <>
      {teclado === "BUSCA" && (
        <ModalDeTeclado
          titulo="Buscar no cardápio"
          subtitulo="Digite parte do nome do produto"
          valorInicial={busca}
          placeholder="Ex.: esfirra"
          maxLen={30}
          textoConfirmar="Buscar"
          comNumeros
          onConfirmar={(t) => {
            setBusca(t);
            setTeclado(null);
          }}
          onFechar={() => setTeclado(null)}
        />
      )}

      {teclado === "OBSERVACAO" && (
        <ModalDeTeclado
          titulo="Observação do pedido"
          subtitulo="Ex.: sem cebola, ponto da carne, embalar para viagem"
          valorInicial={observacao}
          placeholder="Digite a observação"
          maxLen={140}
          textoConfirmar="Salvar observação"
          comNumeros
          onConfirmar={(t) => {
            setObservacao(t.trim());
            setTeclado(null);
          }}
          onFechar={() => setTeclado(null)}
        />
      )}

      {confirmarCancelamento && (
        <ModalDeConfirmacao
          titulo="Cancelar o pedido?"
          descricao="Tudo o que você escolheu será apagado e a tela volta para o começo."
          textoSim="Sim, cancelar"
          textoNao="Não, continuar"
          onSim={() => {
            setConfirmarCancelamento(false);
            reiniciarSessao();
          }}
          onNao={() => setConfirmarCancelamento(false)}
        />
      )}

      {avisoDeInatividade && telaDeSessao && !confirmarCancelamento && (
        <ModalDeConfirmacao
          titulo="Ainda está aí?"
          descricao={`Sem toque na tela, o pedido será apagado em ${segundosDoAviso}s para o próximo cliente.`}
          textoSim="Cancelar pedido"
          textoNao="Continuar pedindo"
          onSim={() => {
            setAvisoDeInatividade(false);
            reiniciarSessao();
          }}
          onNao={() => setAvisoDeInatividade(false)}
        />
      )}
    </>
  );

  /* ─────────────────────────── TELA: CARREGANDO ──────────────────────────── */

  if (tela === "CARREGANDO") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center" }}>
        <RefreshCw size={72} color="#E53935" style={{ animation: "girar 1.6s linear infinite" }} />
        <h2 style={{ marginTop: 24, fontSize: 26, fontWeight: 700 }}>Carregando cardápio...</h2>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes girar { 100% { transform: rotate(360deg); } }" }} />
      </div>
    );
  }

  /* ───────────────────────────── TELA: ERRO ──────────────────────────────── */

  if (tela === "ERRO") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <AlertCircle size={80} color="#E53935" />
        <h1 style={{ marginTop: 24, fontSize: 34, fontWeight: 800, color: "#F87171" }}>Terminal indisponível</h1>
        <p style={{ marginTop: 16, fontSize: 20, color: "#94A3B8", maxWidth: 820, lineHeight: 1.45 }}>{erro}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ ...botaoPrimario, marginTop: 40, minWidth: 320 }}>
          Tentar de novo
        </button>
        <p style={{ marginTop: 20, fontSize: 16, color: "#64748B" }}>
          Tentando sozinho em {contagemRegressiva}s
        </p>
      </div>
    );
  }

  /* ──────────────────────────── TELA: FECHADA ────────────────────────────── */

  if (tela === "FECHADA") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <Store size={80} color="#94A3B8" />
        <h1 style={{ marginTop: 24, fontSize: 40, fontWeight: 800 }}>Estamos fechados</h1>
        <p style={{ marginTop: 16, fontSize: 22, color: "#94A3B8", maxWidth: 720, lineHeight: 1.45 }}>
          O autoatendimento volta assim que a loja abrir. Para pedir agora, fale com um atendente no balcão.
        </p>
      </div>
    );
  }

  /* ─────────────────────────── TELA: CARDÁPIO ────────────────────────────── */

  if (tela === "CARDAPIO") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#F1F5F9", display: "flex", color: "#0F172A", overflow: "hidden" }}>
        {/* CATEGORIAS */}
        <div
          style={{
            width: 250,
            background: "white",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            height: "100%",
            boxShadow: "4px 0 24px rgba(0,0,0,0.06)",
            zIndex: 10,
          }}
        >
          <div
            style={{
              padding: "24px 16px",
              borderBottom: "1px solid #F1F5F9",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
            }}
          >
            {loja?.logoUrl ? (
              <img src={loja.logoUrl} alt={loja.nome} style={{ width: 110, height: 110, objectFit: "contain", borderRadius: 16 }} />
            ) : (
              <div
                style={{
                  width: 90,
                  height: 90,
                  background: "#F8FAFC",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #E2E8F0",
                }}
              >
                <ChefHat size={44} color="#E53935" />
              </div>
            )}
            <span style={{ fontSize: 15, fontWeight: 800, color: "#334155", textAlign: "center", lineHeight: 1.2 }}>{loja?.nome}</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
            {categoriasVisiveis.map((cat) => {
              const ativa = cat.id === categoriaAtiva && !busca;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    // Tocar numa categoria também SAI da busca. Antes o cliente
                    // ficava preso no resultado e achava que o cardápio sumiu.
                    setBusca("");
                    setCategoriaAtiva(cat.id);
                  }}
                  style={{
                    width: "100%",
                    minHeight: ALVO_TOQUE + 60,
                    padding: 14,
                    borderRadius: 18,
                    border: "none",
                    background: ativa ? "#E53935" : "transparent",
                    color: ativa ? "white" : "#475569",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    boxShadow: ativa ? "0 4px 12px rgba(229, 57, 53, 0.3)" : "none",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 16,
                      background: ativa ? "rgba(255,255,255,0.2)" : "#F1F5F9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundImage: cat.imageUrl ? `url(${cat.imageUrl})` : "none",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      fontSize: cat.imageUrl ? 0 : 30,
                    }}
                  >
                    {!cat.imageUrl && (cat.emoji || "🍽️")}
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 800, textAlign: "center", lineHeight: 1.2 }}>{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTEÚDO */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
          <div style={{ padding: "24px 32px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0 }}>
              {busca ? `Busca: "${busca}"` : categoriasVisiveis.find((c) => c.id === categoriaAtiva)?.name || "Cardápio"}
            </h1>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {busca && (
                <button
                  type="button"
                  onClick={() => setBusca("")}
                  style={{
                    minHeight: ALVO_TOQUE,
                    padding: "0 22px",
                    borderRadius: 16,
                    border: "1px solid #CBD5E1",
                    background: "white",
                    color: "#334155",
                    fontSize: 18,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                  }}
                >
                  <X size={22} /> Limpar busca
                </button>
              )}

              {/* Quiosque não tem teclado físico: a busca abre o teclado da tela. */}
              <button
                type="button"
                onClick={() => setTeclado("BUSCA")}
                style={{
                  minHeight: ALVO_TOQUE,
                  padding: "0 24px",
                  borderRadius: 16,
                  border: "1px solid #E2E8F0",
                  background: "white",
                  color: busca ? "#0F172A" : "#94A3B8",
                  fontSize: 20,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minWidth: 300,
                  cursor: "pointer",
                }}
              >
                <Search size={24} color="#94A3B8" />
                {busca || "Buscar no cardápio..."}
              </button>

              {temAlgoAPerder && botaoCancelarPedido}
            </div>
          </div>

          {/* Carrinho esvaziado por item fora do cardápio: sem este aviso o
              cliente volta para a grade sem entender por que perdeu o pedido. */}
          {erroDoEnvio && (
            <div
              style={{
                margin: "0 32px 16px",
                background: "#FEF2F2",
                border: "2px solid #FCA5A5",
                borderRadius: 16,
                padding: "16px 20px",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <AlertCircle size={28} color="#DC2626" />
              <span style={{ flex: 1, fontSize: 18, fontWeight: 700, color: "#991B1B" }}>{erroDoEnvio}</span>
              <button
                type="button"
                onClick={() => setErroDoEnvio(null)}
                style={{
                  minHeight: ALVO_TOQUE,
                  padding: "0 24px",
                  borderRadius: 14,
                  border: "none",
                  background: "#DC2626",
                  color: "white",
                  fontSize: 18,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Entendi
              </button>
            </div>
          )}

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 32px 160px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 22,
              alignContent: "start",
            }}
          >
            {produtosNaTela.map((p) => {
              const indisponivel = precisaMontar(p) && !comboMontavel(p);
              const preco = precoDeVitrine(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={indisponivel}
                  onClick={() => abrirProduto(p)}
                  aria-label={`${p.name}, ${formatarPreco(preco)}`}
                  style={{
                    background: "white",
                    borderRadius: 24,
                    padding: 18,
                    display: "flex",
                    flexDirection: "column",
                    textAlign: "left",
                    cursor: indisponivel ? "not-allowed" : "pointer",
                    border: "1px solid #E2E8F0",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
                    opacity: indisponivel ? 0.5 : 1,
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: 180,
                      background: "#F8FAFC",
                      borderRadius: 16,
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <ChefHat size={60} color="#CBD5E1" />
                    )}
                  </div>

                  <h3 style={{ fontSize: 21, fontWeight: 800, marginBottom: 6, lineHeight: 1.2 }}>{p.name}</h3>
                  <p
                    style={{
                      fontSize: 15,
                      color: "#64748B",
                      flex: 1,
                      marginBottom: 16,
                      lineHeight: 1.4,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {p.description}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "auto",
                      borderTop: "1px solid #F1F5F9",
                      paddingTop: 14,
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {/* `precoMinimo` vem calculado da rota: produto cujo valor
                          mora nas opções aparecia por R$ 0,00 no card. */}
                      {p.precoAPartirDe && (
                        <span style={{ fontSize: 13, color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>a partir de</span>
                      )}
                      <span style={{ fontSize: 24, fontWeight: 800, color: "#16A34A" }}>{formatarPreco(preco)}</span>
                    </div>

                    {indisponivel ? (
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#94A3B8" }}>Indisponível</span>
                    ) : (
                      <div
                        style={{
                          background: "#E53935",
                          borderRadius: "50%",
                          width: 52,
                          height: 52,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 4px 12px rgba(229, 57, 53, 0.3)",
                          flexShrink: 0,
                        }}
                      >
                        <Plus size={26} color="white" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}

            {produtosNaTela.length === 0 && (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 64, color: "#94A3B8" }}>
                <ChefHat size={64} style={{ opacity: 0.5, marginBottom: 16 }} />
                <h2 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Nenhum produto encontrado.</h2>
                {busca && (
                  <button type="button" onClick={() => setBusca("")} style={{ ...botaoPrimario, margin: "24px auto 0", minWidth: 300 }}>
                    Ver o cardápio inteiro
                  </button>
                )}
              </div>
            )}
          </div>

          {quantidadeNoCarrinho > 0 && (
            <div style={{ position: "absolute", bottom: 28, left: 32, right: 32, zIndex: 10 }}>
              <button
                type="button"
                onClick={() => setTela("CARRINHO")}
                style={{
                  ...botaoPrimario,
                  width: "100%",
                  minHeight: 88,
                  fontSize: 24,
                  borderRadius: 24,
                  justifyContent: "space-between",
                  boxShadow: "0 12px 32px rgba(229, 57, 53, 0.4)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <ShoppingCart size={30} />
                  Ver carrinho ({quantidadeNoCarrinho} {quantidadeNoCarrinho === 1 ? "item" : "itens"})
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <strong style={{ fontSize: 28 }}>{formatarPreco(total)}</strong>
                  <ChevronRight size={32} />
                </span>
              </button>
            </div>
          )}

          {/* ─────────────────────── MODAL DO COMBO ─────────────────────── */}
          {comboAberto && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 150, display: "flex", alignItems: "flex-end" }}>
              <div
                style={{
                  width: "100%",
                  height: "92%",
                  background: "#1E293B",
                  borderTopLeftRadius: 32,
                  borderTopRightRadius: 32,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    padding: "20px 28px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 20,
                    borderBottom: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <h2 style={{ fontSize: 30, fontWeight: 800, color: "white", margin: 0 }}>Montar {comboAberto.name}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setComboAberto(null);
                      setEscolhas({});
                    }}
                    style={botaoVoltar}
                    aria-label="Fechar"
                  >
                    <X size={30} />
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>
                  {gruposAbertos.map((grupo) => {
                    const opcoes = opcoesUtilizaveis(grupo);
                    const teto = Math.max(1, Number(grupo.maxQty) || 1);
                    const exigido = minimoExigidoDoGrupo(grupo);
                    const escolhido = escolhidosNoGrupo(escolhas, grupo.id);
                    const completo = escolhido >= exigido;

                    return (
                      <div key={grupo.id} style={{ marginBottom: 36 }}>
                        <div style={{ background: "rgba(255,255,255,0.05)", padding: 20, borderRadius: 16, marginBottom: 14 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                            <h3 style={{ fontSize: 24, fontWeight: 800, color: "white", margin: 0 }}>{grupo.title || "Escolhas"}</h3>
                            <span
                              style={{
                                fontSize: 15,
                                fontWeight: 800,
                                padding: "8px 16px",
                                borderRadius: 999,
                                background: completo ? "rgba(22,163,74,0.2)" : "rgba(229,57,53,0.2)",
                                color: completo ? "#4ADE80" : "#FCA5A5",
                              }}
                            >
                              {escolhido}/{teto} {completo ? "ok" : `— faltam ${exigido - escolhido}`}
                            </span>
                          </div>
                          <p style={{ fontSize: 17, color: "#94A3B8", margin: "8px 0 0" }}>
                            {exigido === 0
                              ? `Opcional — até ${teto} ${teto === 1 ? "opção" : "opções"}`
                              : exigido === teto
                                ? `Escolha ${teto} ${teto === 1 ? "opção" : "opções"}`
                                : `Escolha de ${exigido} a ${teto} opções`}
                          </p>
                        </div>

                        <div style={{ display: "grid", gap: 14 }}>
                          {opcoes.map((opcao) => {
                            const qtd = Number(escolhas[grupo.id]?.[opcao.id]) || 0;
                            const adicional = Number(opcao.additionalPrice) || 0;
                            const podeSomar = escolhido < teto && qtd < tetoDaOpcao(grupo, opcao);
                            const nome = opcao.menuProduct?.name || "";
                            return (
                              <div
                                key={opcao.id}
                                style={{ ...vidro, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <h4 style={{ fontSize: 21, fontWeight: 700, color: "white", margin: 0 }}>{nome}</h4>
                                  {opcao.optionNote && (
                                    <span style={{ fontSize: 15, color: "#94A3B8" }}>{opcao.optionNote}</span>
                                  )}
                                  {adicional > 0 && (
                                    <div style={{ fontSize: 17, color: "#4ADE80", fontWeight: 800 }}>+ {formatarPreco(adicional)}</div>
                                  )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
                                  <button
                                    type="button"
                                    onClick={() => mudarEscolha(grupo, opcao, -1)}
                                    disabled={qtd <= 0}
                                    aria-label={`Tirar um ${nome}`}
                                    style={{
                                      background: "rgba(255,255,255,0.1)",
                                      border: "none",
                                      width: ALVO_TOQUE,
                                      height: ALVO_TOQUE,
                                      borderRadius: "50%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: qtd > 0 ? "white" : "#475569",
                                      cursor: qtd > 0 ? "pointer" : "default",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Minus size={26} />
                                  </button>
                                  <span style={{ fontSize: 26, fontWeight: 800, color: "white", width: 32, textAlign: "center" }}>{qtd}</span>
                                  <button
                                    type="button"
                                    onClick={() => mudarEscolha(grupo, opcao, 1)}
                                    disabled={!podeSomar}
                                    aria-label={`Adicionar um ${nome}`}
                                    style={{
                                      background: podeSomar ? "#E53935" : "rgba(255,255,255,0.1)",
                                      border: "none",
                                      width: ALVO_TOQUE,
                                      height: ALVO_TOQUE,
                                      borderRadius: "50%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: podeSomar ? "white" : "#475569",
                                      cursor: podeSomar ? "pointer" : "default",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <Plus size={26} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ padding: 24, borderTop: "1px solid rgba(255,255,255,0.1)", background: "#0F172A" }}>
                  {faltandoNoCombo.length > 0 && (
                    <p style={{ margin: "0 0 14px", fontSize: 17, color: "#FCA5A5", fontWeight: 700 }}>
                      Falta escolher: {faltandoNoCombo.join(", ")}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={confirmarCombo}
                    disabled={faltandoNoCombo.length > 0}
                    style={{
                      ...botaoPrimario,
                      width: "100%",
                      minHeight: 80,
                      fontSize: 24,
                      justifyContent: "space-between",
                      opacity: faltandoNoCombo.length > 0 ? 0.45 : 1,
                    }}
                  >
                    <span>Adicionar ao carrinho</span>
                    <strong>{formatarPreco(precoDoComboAberto)}</strong>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {sobreposicoes}
      </div>
    );
  }

  /* ─────────────────────────── TELA: CARRINHO ────────────────────────────── */

  if (tela === "CARRINHO") {
    return (
      <div style={telaEscura}>
        <div
          style={{
            padding: "20px 28px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <button type="button" onClick={() => setTela("CARDAPIO")} style={botaoVoltar} aria-label="Voltar ao cardápio">
            <ArrowLeft size={30} />
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, flex: 1 }}>Seu pedido</h1>
          {temAlgoAPerder && botaoCancelarPedido}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 28 }}>
          {carrinho.length === 0 ? (
            <div style={{ textAlign: "center", padding: 64, color: "#94A3B8" }}>
              <ShoppingCart size={80} style={{ opacity: 0.5, marginBottom: 24 }} />
              <h2 style={{ fontSize: 30 }}>Seu carrinho está vazio</h2>
              <button type="button" onClick={() => setTela("CARDAPIO")} style={{ ...botaoPrimario, margin: "32px auto 0", minWidth: 320 }}>
                Voltar ao cardápio
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 20 }}>
              {carrinho.map((item) => (
                <div key={item.id} style={{ ...vidro, padding: 22, display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <h3 style={{ fontSize: 23, fontWeight: 800, margin: "0 0 6px" }}>{item.produto.name}</h3>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#4ADE80", marginBottom: 12 }}>
                      {formatarPreco(item.precoUnitario)}
                      {item.quantidade > 1 && (
                        <span style={{ fontSize: 16, color: "#94A3B8", fontWeight: 600 }}>
                          {"  •  "}
                          {item.quantidade} x = {formatarPreco(item.precoUnitario * item.quantidade)}
                        </span>
                      )}
                    </div>

                    {item.detalhes.length > 0 && (
                      <div style={{ background: "rgba(0,0,0,0.25)", padding: 14, borderRadius: 12 }}>
                        {item.detalhes.map((d, i) => (
                          <div key={`${item.id}-${i}`} style={{ fontSize: 16, color: "#CBD5E1", lineHeight: 1.6 }}>
                            <strong style={{ color: "#94A3B8" }}>{d.grupo}:</strong> {d.quantidade}x {d.nome}
                            {d.adicional > 0 ? ` (+${formatarPreco(d.adicional)})` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.3)", borderRadius: 999, padding: 6 }}>
                      <button
                        type="button"
                        onClick={() => mudarQuantidade(item.id, -1)}
                        aria-label="Diminuir quantidade"
                        style={{
                          background: "transparent",
                          border: "none",
                          width: ALVO_TOQUE,
                          height: ALVO_TOQUE,
                          color: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Minus size={26} />
                      </button>
                      <span style={{ fontSize: 26, fontWeight: 800, width: 56, textAlign: "center" }}>{item.quantidade}</span>
                      <button
                        type="button"
                        onClick={() => mudarQuantidade(item.id, 1)}
                        aria-label="Aumentar quantidade"
                        style={{
                          background: "transparent",
                          border: "none",
                          width: ALVO_TOQUE,
                          height: ALVO_TOQUE,
                          color: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <Plus size={26} />
                      </button>
                    </div>

                    {/* "Remover" era um alvo de 24px colado no "−": o dedo que
                        queria tirar uma unidade apagava o item inteiro. */}
                    <button
                      type="button"
                      onClick={() => removerItem(item.id)}
                      style={{
                        minHeight: ALVO_TOQUE,
                        padding: "0 24px",
                        borderRadius: 16,
                        border: "2px solid rgba(248,113,113,0.5)",
                        background: "transparent",
                        color: "#F87171",
                        fontSize: 18,
                        fontWeight: 800,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        cursor: "pointer",
                      }}
                    >
                      <Trash2 size={22} /> Remover
                    </button>
                  </div>
                </div>
              ))}

              {/* Observação do pedido: o cliente não tinha onde escrever "sem
                  cebola" e ia pedir no balcão, refazendo na mão o que o totem
                  deveria ter mandado para a cozinha. */}
              <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                <button
                  type="button"
                  onClick={() => setTeclado("OBSERVACAO")}
                  style={{
                    ...vidro,
                    flex: 1,
                    padding: 20,
                    minHeight: ALVO_TOQUE + 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    color: "white",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <MessageSquare size={26} color="#94A3B8" />
                  <span style={{ fontSize: 19, color: observacao ? "white" : "#94A3B8", flex: 1 }}>
                    {observacao || "Adicionar observação (sem cebola, ponto da carne...)"}
                  </span>
                </button>

                {observacao && (
                  <button
                    type="button"
                    onClick={() => setObservacao("")}
                    aria-label="Apagar observação"
                    style={{
                      ...vidro,
                      width: ALVO_TOQUE + 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#F87171",
                      cursor: "pointer",
                    }}
                  >
                    <X size={28} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {carrinho.length > 0 && (
          <div style={{ padding: 24, background: "#1E293B", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 22, color: "#94A3B8" }}>Total a pagar</span>
              <span style={{ fontSize: 40, fontWeight: 900 }}>{formatarPreco(total)}</span>
            </div>
            <button type="button" onClick={() => setTela("NOME")} style={{ ...botaoPrimario, width: "100%", minHeight: 84, fontSize: 26 }}>
              Continuar <ChevronRight size={32} />
            </button>
          </div>
        )}

        {sobreposicoes}
      </div>
    );
  }

  /* ────────────────────────────── TELA: NOME ─────────────────────────────── */

  if (tela === "NOME") {
    return (
      <div style={telaEscura}>
        <div style={{ padding: "20px 28px", display: "flex", alignItems: "center", gap: 16 }}>
          <button type="button" onClick={() => setTela("CARRINHO")} style={botaoVoltar} aria-label="Voltar ao carrinho">
            <ArrowLeft size={30} />
          </button>
          <div style={{ flex: 1 }} />
          {botaoCancelarPedido}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, gap: 28 }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, margin: 0, textAlign: "center" }}>Como podemos te chamar?</h2>
          <p style={{ fontSize: 20, color: "#94A3B8", margin: 0, textAlign: "center" }}>
            Seu nome será chamado quando o pedido estiver pronto.
          </p>

          <div
            style={{
              width: "100%",
              maxWidth: 700,
              background: "rgba(255,255,255,0.06)",
              borderRadius: 20,
              padding: "22px 28px",
              fontSize: 40,
              fontWeight: 800,
              textAlign: "center",
              minHeight: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {nomeDoCliente || <span style={{ color: "rgba(255,255,255,0.2)" }}>Digite seu nome</span>}
          </div>

          <TecladoVirtual texto={nomeDoCliente} onTexto={(t) => setNomeDoCliente(t.slice(0, 20))} maxLen={20} />
        </div>

        <div style={{ padding: 24, background: "#1E293B" }}>
          <button
            type="button"
            disabled={!nomeDoCliente.trim()}
            onClick={() => setTela("PAGAMENTO")}
            style={{ ...botaoPrimario, width: "100%", minHeight: 84, fontSize: 26, opacity: nomeDoCliente.trim() ? 1 : 0.45 }}
          >
            Ir para o pagamento <ChevronRight size={32} />
          </button>
        </div>

        {sobreposicoes}
      </div>
    );
  }

  /* ──────────────────────────── TELA: PAGAMENTO ──────────────────────────── */

  if (tela === "PAGAMENTO") {
    const mostrarMaquininha = maquininha.estado !== "NAO";

    return (
      <div style={telaEscura}>
        <div style={{ padding: "20px 28px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <button type="button" onClick={() => setTela("NOME")} style={botaoVoltar} aria-label="Voltar">
            <ArrowLeft size={30} />
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, flex: 1 }}>Como deseja pagar?</h1>
          {botaoCancelarPedido}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, gap: 28 }}>
          <div style={{ fontSize: 46, fontWeight: 900 }}>{formatarPreco(total)}</div>

          {erroDoEnvio && (
            <div
              style={{
                background: "rgba(229,57,53,0.15)",
                border: "1px solid rgba(248,113,113,0.5)",
                color: "#FCA5A5",
                borderRadius: 16,
                padding: "18px 24px",
                fontSize: 19,
                fontWeight: 700,
                maxWidth: 900,
                textAlign: "center",
              }}
            >
              {erroDoEnvio}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: mostrarMaquininha ? "1fr 1fr" : "1fr",
              gap: 24,
              width: "100%",
              maxWidth: 1000,
            }}
          >
            {/* Some de vez quando o servidor já respondeu que esta licença não
                tem maquininha: o botão mandaria a cobrança para o visor de
                outro totem do salão — ou para lugar nenhum. */}
            {mostrarMaquininha && (
              <button
                type="button"
                onClick={() => void pagarNaMaquininha()}
                style={{
                  ...vidro,
                  padding: 40,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                  border: "2px solid #3B82F6",
                  color: "white",
                  cursor: "pointer",
                  minHeight: 300,
                  font: "inherit",
                }}
              >
                <CreditCard size={72} color="#3B82F6" />
                <h2 style={{ fontSize: 30, fontWeight: 800, margin: 0 }}>Pagar na maquininha</h2>
                <p style={{ fontSize: 18, color: "#94A3B8", textAlign: "center", margin: 0, lineHeight: 1.4 }}>
                  A cobrança acende na maquininha {maquininha.rotulo ? `"${maquininha.rotulo}"` : "ao lado do totem"}.
                  <br />
                  Crédito, débito ou por aproximação.
                </p>
              </button>
            )}

            <button
              type="button"
              onClick={() => void pagarNoCaixa()}
              style={{
                ...vidro,
                padding: 40,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                border: "2px solid #F59E0B",
                color: "white",
                cursor: "pointer",
                minHeight: 300,
                font: "inherit",
              }}
            >
              <Store size={72} color="#F59E0B" />
              <h2 style={{ fontSize: 30, fontWeight: 800, margin: 0 }}>Pagar no caixa</h2>
              <p style={{ fontSize: 18, color: "#94A3B8", textAlign: "center", margin: 0, lineHeight: 1.4 }}>
                Você leva a senha ao balcão e paga com o atendente.
              </p>
            </button>
          </div>
        </div>

        {sobreposicoes}
      </div>
    );
  }

  /* ─────────────────────────── TELA: ENVIANDO ────────────────────────────── */

  if (tela === "ENVIANDO") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <RefreshCw size={72} color="#E53935" style={{ animation: "girar 1.6s linear infinite" }} />
        <h2 style={{ marginTop: 24, fontSize: 30, fontWeight: 800 }}>Registrando seu pedido...</h2>
        <p style={{ marginTop: 12, fontSize: 20, color: "#94A3B8" }}>Não toque na tela nem saia daqui.</p>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes girar { 100% { transform: rotate(360deg); } }" }} />
      </div>
    );
  }

  /* ────────────────────────── TELA: MAQUININHA ───────────────────────────── */

  if (tela === "MAQUININHA") {
    const acabou = pagamentoEncerrado;
    const demorando = !acabou && segundosNaEspera * 1000 > ESPERA_ATE_CHAMAR_ATENDENTE_MS;

    const titulo =
      estadoDoPagamento === "INICIANDO"
        ? "Preparando a maquininha..."
        : estadoDoPagamento === "AGUARDANDO_CARTAO"
          ? "Aproxime, insira ou passe o cartão"
          : estadoDoPagamento === "PROCESSANDO"
            ? "Processando o pagamento..."
            : estadoDoPagamento === "RECUSADO"
              ? "Pagamento recusado"
              : estadoDoPagamento === "EXPIRADO"
                ? "A cobrança expirou"
                : estadoDoPagamento === "CANCELADO"
                  ? "Cobrança cancelada"
                  : "Não foi possível cobrar na maquininha";

    const subtitulo =
      estadoDoPagamento === "INICIANDO"
        ? "Estamos subindo o valor no visor."
        : estadoDoPagamento === "AGUARDANDO_CARTAO"
          ? `Use a maquininha ${maquininha.rotulo ? `"${maquininha.rotulo}"` : "ao lado do totem"}. Não saia desta tela.`
          : estadoDoPagamento === "PROCESSANDO"
            ? "Aguarde a confirmação do banco. Isso pode levar alguns segundos."
            : estadoDoPagamento === "RECUSADO"
              ? "O cartão não foi aceito. Tente outro cartão ou pague no caixa."
              : estadoDoPagamento === "EXPIRADO"
                ? "Ninguém pagou dentro do prazo da cobrança."
                : estadoDoPagamento === "CANCELADO"
                  ? detalheDoPagamento || "A cobrança saiu do visor da maquininha."
                  : detalheDoPagamento || "";

    const cor =
      estadoDoPagamento === "RECUSADO" || estadoDoPagamento === "FALHOU_INICIAR" || estadoDoPagamento === "EXPIRADO"
        ? "#F87171"
        : estadoDoPagamento === "PROCESSANDO"
          ? "#FBBF24"
          : "#3B82F6";

    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", gap: 8 }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.06)",
            border: `3px solid ${cor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
            animation: acabou ? "none" : "pulsar 1.6s ease-in-out infinite",
          }}
        >
          {acabou ? <AlertCircle size={74} color={cor} /> : <Nfc size={74} color={cor} />}
        </div>

        <h1 style={{ fontSize: 42, fontWeight: 900, margin: 0 }}>{titulo}</h1>
        <p style={{ fontSize: 22, color: "#94A3B8", margin: "14px 0 0", maxWidth: 820, lineHeight: 1.45 }}>{subtitulo}</p>

        <div style={{ fontSize: 40, fontWeight: 900, margin: "24px 0 0" }}>{formatarPreco(pedido?.valor ?? total)}</div>
        {pedido?.numero && <div style={{ fontSize: 18, color: "#64748B" }}>Senha #{pedido.numero}</div>}

        {!acabou && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#64748B", fontSize: 17, marginTop: 18 }}>
            <Clock size={20} /> aguardando há {segundosNaEspera}s
          </div>
        )}

        {semRespostaDoServidor && (
          <p style={{ fontSize: 17, color: "#FBBF24", marginTop: 12 }}>
            Sem resposta do servidor. Continuamos tentando — não passe o cartão duas vezes.
          </p>
        )}

        {demorando && (
          <p style={{ fontSize: 17, color: "#FBBF24", marginTop: 12 }}>
            Está demorando mais que o normal. Se a maquininha não acendeu, chame um atendente.
          </p>
        )}

        {erroDoCancelamento && (
          <p style={{ fontSize: 17, color: "#F87171", marginTop: 16, maxWidth: 820 }}>{erroDoCancelamento}</p>
        )}

        <div style={{ display: "flex", gap: 16, marginTop: 32, flexWrap: "wrap", justifyContent: "center" }}>
          {(estadoDoPagamento === "RECUSADO" || estadoDoPagamento === "EXPIRADO" || estadoDoPagamento === "FALHOU_INICIAR" || estadoDoPagamento === "CANCELADO") && (
            <button
              type="button"
              onClick={() => pedido && void iniciarCobranca(pedido.id)}
              style={{ ...botaoPrimario, minWidth: 300 }}
            >
              <RefreshCw size={24} /> Tentar de novo
            </button>
          )}

          {acabou && (
            <button
              type="button"
              onClick={() => void irParaOCaixa()}
              disabled={cancelandoCobranca}
              style={{ ...botaoSecundario, minWidth: 300, opacity: cancelandoCobranca ? 0.5 : 1 }}
            >
              <Store size={24} /> {cancelandoCobranca ? "Liberando a maquininha..." : "Pagar no caixa"}
            </button>
          )}

          {!acabou && (
            <button
              type="button"
              onClick={() => void cancelarCobranca()}
              disabled={cancelandoCobranca}
              style={{ ...botaoSecundario, minWidth: 300, opacity: cancelandoCobranca ? 0.5 : 1 }}
            >
              <X size={24} /> {cancelandoCobranca ? "Cancelando..." : "Cancelar"}
            </button>
          )}

          {erroDoCancelamento && (
            <button type="button" onClick={reiniciarSessao} style={{ ...botaoSecundario, minWidth: 300 }}>
              Chamar atendente e sair
            </button>
          )}
        </div>

        <style
          dangerouslySetInnerHTML={{
            __html: "@keyframes pulsar { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.75; } }",
          }}
        />

        {sobreposicoes}
      </div>
    );
  }

  /* ──────────────────────── TELA: PAGAR NO CAIXA ─────────────────────────── */

  if (tela === "CAIXA") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <Store size={90} color="#F59E0B" />
        <h1 style={{ fontSize: 44, fontWeight: 900, margin: "24px 0 0" }}>Pague no caixa e retire seu pedido</h1>
        <p style={{ fontSize: 22, color: "#94A3B8", margin: "16px 0 0", maxWidth: 860, lineHeight: 1.45 }}>
          Leve esta senha ao balcão e pague com o atendente.
          {pedido?.aguardandoPagamento && " Seu pedido só entra na fila da cozinha depois que o caixa confirmar o pagamento."}
        </p>

        {avisoNoCaixa && (
          <p
            style={{
              marginTop: 20,
              maxWidth: 860,
              background: "rgba(251,191,36,0.12)",
              border: "1px solid rgba(251,191,36,0.5)",
              borderRadius: 16,
              padding: "16px 24px",
              fontSize: 19,
              fontWeight: 700,
              color: "#FBBF24",
            }}
          >
            {avisoNoCaixa}
          </p>
        )}

        <div style={{ background: "rgba(255,255,255,0.05)", padding: "32px 72px", borderRadius: 28, border: "2px dashed rgba(255,255,255,0.2)", marginTop: 32 }}>
          <div style={{ fontSize: 18, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Senha do pedido</div>
          <div style={{ fontSize: 88, fontWeight: 900, color: "#E53935", lineHeight: 1 }}>{pedido?.numero ? `#${pedido.numero}` : "--"}</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 12 }}>{formatarPreco(pedido?.valor ?? total)}</div>
        </div>

        <button type="button" onClick={reiniciarSessao} style={{ ...botaoPrimario, marginTop: 36, minWidth: 360 }}>
          Novo pedido
        </button>
        <p style={{ marginTop: 16, fontSize: 16, color: "#64748B" }}>A tela volta ao cardápio em {contagemRegressiva}s</p>
      </div>
    );
  }

  /* ───────────────────────── TELA: CONFIRMADO ────────────────────────────── */

  if (tela === "CONFIRMADO") {
    return (
      <div style={{ ...telaEscura, alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center" }}>
        <div
          style={{
            width: 150,
            height: 150,
            borderRadius: "50%",
            background: "#16A34A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 32,
            animation: "surgir 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
        >
          <Check size={80} color="white" strokeWidth={3} />
        </div>

        <h1 style={{ fontSize: 46, fontWeight: 900, margin: 0 }}>Pagamento aprovado!</h1>
        <p style={{ fontSize: 22, color: "#94A3B8", margin: "16px 0 32px" }}>
          Aguarde, logo chamaremos seu nome: <strong style={{ color: "white" }}>{nomeDoCliente}</strong>
        </p>

        <div style={{ background: "rgba(255,255,255,0.05)", padding: "32px 72px", borderRadius: 28, border: "2px dashed rgba(255,255,255,0.2)" }}>
          <div style={{ fontSize: 18, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Senha do pedido</div>
          <div style={{ fontSize: 92, fontWeight: 900, color: "#E53935", lineHeight: 1 }}>{pedido?.numero ? `#${pedido.numero}` : "--"}</div>
        </div>

        <button type="button" onClick={reiniciarSessao} style={{ ...botaoSecundario, marginTop: 36, minWidth: 320 }}>
          Fazer outro pedido
        </button>
        <p style={{ marginTop: 14, fontSize: 16, color: "#64748B" }}>A tela volta ao cardápio em {contagemRegressiva}s</p>

        <style
          dangerouslySetInnerHTML={{
            __html: "@keyframes surgir { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }",
          }}
        />
      </div>
    );
  }

  return null;
}
