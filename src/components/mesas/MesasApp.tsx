"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseComboSelections } from "@/lib/parse-combo";
import { useRouter } from "next/navigation";
import ComboModal from "@/components/customer/ComboModal";
import { precoMinimoDoProduto, precoVariaPorEscolha } from "@/lib/preco-combo";
import { idsSoDeOpcaoDeCombo } from "@/lib/cardapio-interno";
import type { PagamentoDaMesa } from "@/lib/pagamentos-da-mesa";
import { printOrder } from "@/lib/print";
import { impressorasDaContaDaMesa } from "@/lib/impressao-da-conta";
import { CAMINHO_DO_CAIXA } from "@/lib/caixa-aberto";
import {
  MOTIVOS_COMUNS, SEM_DESCONTO, problemaDoDesconto, valorDoDesconto,
  type DescontoManual,
} from "@/lib/desconto-manual";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface TableItem {
  id: string;
  number: number;
  label: string | null;
  capacity: number;
  isActive: boolean;
  openSession: {
    id: string;
    customerName: string | null;
    /** Observação escrita ao ocupar a mesa ("aniversário", "sem glúten"). */
    notes?: string | null;
    waiterName: string | null;
    waiterId?: string | null;
    openedAt: string;
    totalAmount: number;
    orderCount: number;
  } | null;
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category?: string;
  isCombo?: boolean;
  imageUrl?: string | null;
  comboGroups?: any[];
  comboConfig?: any;
}

interface SessionOrder {
  id: string;
  dailyOrderNumber: number | null;
  totalAmount: number;
  createdAt: string;
  status: string;
  items: {
    /** Necessário para EDITAR o item lançado (quantidade / remover). */
    id: string;
    quantity: number;
    price: number;
    menuProduct: { name: string };
    /** Quem, na mesa, pediu este item. Nulo = lançado para a mesa toda. */
    tableGuestId?: string | null;
    /** Escolhas do combo. É aqui que mora "2 pastéis" na Pastel da Paulista. */
    comboSelections?: unknown;
    /** Observação do item ("sem leite"), escrita no carrinho ou no modal. */
    notes?: string | null;
  }[];
}

/** Pessoa sentada na mesa. Vira uma coluna da conta na hora de rachar. */
interface Pessoa {
  id: string;
  name: string;
  total: number;
}

/** Conta já rateada, como vem de /api/store/table-sessions/[id]/conta. */
interface ContaDividida {
  consumo: number;
  taxaServico: { percentual: number; valor: number };
  gorjeta: number;
  total: number;
  itensDaMesa: { valor: number; itens: { nome: string; quantidade: number; valor: number }[] };
  pessoas: {
    id: string; nome: string; consumo: number; parteDaMesa: number;
    taxaEGorjeta: number; aPagar: number;
    itens: { nome: string; quantidade: number; valor: number }[];
  }[];
  porIgual: number;
}

interface SessionDetail {
  id: string;
  customerName: string | null;
  waiterName: string | null;
  openedAt: string;
  status: string;
  table: { number: number; label: string | null };
  orders: SessionOrder[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function elapsed(from: string) {
  const ms = Date.now() - new Date(from).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? ` ${m % 60}min` : ""}`;
}

const getEffectiveComboGroups = (prod: any) => {
  if (prod?.comboGroups && Array.isArray(prod.comboGroups) && prod.comboGroups.length > 0) {
    return prod.comboGroups;
  }
  if (!prod?.comboConfig) return [];
  try {
    const config = typeof prod.comboConfig === "string" ? JSON.parse(prod.comboConfig) : prod.comboConfig;
    if (Array.isArray(config)) return config;
    if (config.groups && Array.isArray(config.groups)) return config.groups;
    if (config.comboGroups && Array.isArray(config.comboGroups)) return config.comboGroups;
  } catch {}
  return [];
};

// ─── Component ─────────────────────────────────────────────────────────────────
/**
 * Layout para TABLET — é o aparelho que o garçom usa em pé, andando.
 *
 * Os painéis laterais tinham largura FIXA (340px na comanda, 370px no detalhe).
 * Num tablet em retrato sobrava uma faixa estreita para o cardápio: os produtos
 * caíam em coluna única e o garçom via 4 itens numa tela que comporta 12,
 * rolando a lista inteira para achar uma bebida.
 *
 * Abaixo de 900px o painel sai da lateral e vai para o rodapé — o cardápio ocupa
 * a tela toda, que é o que importa na hora de lançar.
 */
const ESTILO_TABLET = `
  /* 100vh no celular é a altura COM a barra do navegador escondida; com a barra
     visível o rodapé do painel da mesa (o Total) ficava atrás dela. dvh
     acompanha a barra; onde não existe, fica o 100vh de sempre. */
  @supports (height: 100dvh) { .mesa-tela { height: 100dvh !important; } }
  .mesa-lancar {
    display: grid;
    grid-template-columns: 1fr 340px;
    overflow: hidden;
  }
  .mesa-produtos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
  }
  .mesa-detalhe { width: 370px; }

  /* Nome e observação da mesa aberta: no máximo duas linhas no cartão (o
     texto inteiro está no painel da mesa) e uma no celular, mais abaixo. */
  .mesa-cartao-nome, .mesa-cartao-obs {
    max-width: 100%; box-sizing: border-box; text-align: center;
    overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical;
    -webkit-line-clamp: 2; overflow-wrap: anywhere;
  }

  @media (max-width: 1180px) {
    .mesa-lancar { grid-template-columns: 1fr 290px; }
    .mesa-produtos { grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); }
    .mesa-detalhe { width: 300px; }
  }

  @media (max-width: 900px) {
    .mesa-conteudo { flex-direction: column; }
    .mesa-lancar {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr auto;
    }
    .mesa-comanda {
      border-left: none !important;
      border-top: 2px solid #E2E8F0;
      max-height: 44vh;
    }
    /* Aberta, a comanda toma a tela: conferir sete itens é o que o garçom faz
       antes de mandar para a cozinha, e é a hora em que ele mais precisa ver. */
    .mesa-comanda.aberta { max-height: 86vh; }
    .mesa-comanda-acao { display: inline-flex; }
    .mesa-produtos { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
    /* O painel da mesa virou gaveta de rodape (regra mais abaixo); o que
       sobra aqui e so tirar a borda de coluna. */
    .mesa-detalhe { border-left: none !important; }
  }

  /* Em tela larga a comanda já é uma coluna inteira: não há o que expandir,
     e oferecer "ver tudo" ali só confunde. */
  .mesa-comanda-acao {
    display: none;
    align-items: center;
    gap: 6px;
  }

  /* A barra de "quem está pedindo" rola na horizontal: uma mesa de 8 pessoas
     não cabe na largura de um tablet, e quebrar linha empurraria o cardápio
     para fora da tela. */
  .mesa-quem-pede::-webkit-scrollbar { height: 4px; }
  .mesa-quem-pede::-webkit-scrollbar-thumb { background: #E2E8F0; border-radius: 4px; }

  /* Uma linha de pagamento por vez em tela estreita: nome, forma e valor lado
     a lado viram três campos de 60px, impossíveis de acertar com o dedo. */
  @media (max-width: 520px) {
    .mesa-pagador { flex-wrap: wrap; }
    .mesa-pagador input:first-child { flex: 1 1 100% !important; }
  }

  /* 44px é o alvo de toque recomendado. Num tablet de garçom, errar o botão
     significa lançar o item errado na comanda de um cliente. */
  /* ── O SALÃO NO CELULAR ────────────────────────────────────────────────

     O garçom trabalha com o aparelho na mão, em pé, com uma mão só. O mapa
     de mesas era desenhado para monitor: dois cartões por linha de 120px de
     altura, e o painel da mesa selecionada comendo 46vh da tela — sobravam
     duas fileiras e meia de mesas visíveis. Num salão de 20 mesas, achar a
     mesa 14 virava rolagem.

     Aqui o cartão encolhe para caber três (ou quatro) por linha e o painel
     da mesa sai do fluxo: vira gaveta de rodapé por cima do mapa, que é o
     gesto que todo aplicativo de celular usa. O mapa fica inteiro atrás.

     O dono autorizou cortar escrita NESTE módulo — "talvez devesse inclusive
     cortar as escritas" — e é o que o cartão faz: com 96px de largura, "1
     ped. · 193h 25min · +10%" não é informação, é ruído. O número da mesa, a
     bolinha e o valor ficam; o resto o garçom lê ao tocar. */
  @media (max-width: 900px) {
    /* A barra de aplicativo do painel fica em cima; sem descontar a altura
       dela o rodapé do mapa nasce fora da tela. Na rota do garçom não há
       barra e a variável não existe: o 0px do fallback deixa tudo como era. */
    .mesa-tela { height: calc(100dvh - var(--fh-barra-celular, 0px)) !important; }

    .mesa-topo { padding: 8px 10px !important; gap: 8px; }
    .mesa-topo h1 { font-size: 16px !important; }
    .mesa-topo-marca { display: none !important; }
    .mesa-topo-numeros { font-size: 11px !important; gap: 6px !important; }
    .mesa-voltar-texto { display: none; }

    .mesa-mapa { padding: 10px !important; gap: 8px !important;
      grid-template-columns: repeat(auto-fill, minmax(94px, 1fr)) !important; }
    .mesa-cartao { min-height: 92px !important; padding: 10px 6px !important; gap: 2px !important; }
    .mesa-cartao-numero { font-size: 22px !important; }
    .mesa-cartao-valor { font-size: 12.5px !important; }
    /* A linha miúda do cartão sai: ilegível em 94px e recuperável num toque. */
    .mesa-cartao-linha { display: none !important; }
    /* Nome e observação ficam — são o que o garçom procura de longe. O nome
       numa linha, cortado com "..."; a observação em até duas, porque numa
       só o cartão de 84px mostrava "aniversár..." e o recado se perdia. */
    .mesa-cartao-nome { -webkit-line-clamp: 1; }
    .mesa-cartao-nome { font-size: 11.5px !important; }
    .mesa-cartao-obs { font-size: 10.5px !important; padding: 1px 5px !important; }

    /* ── A GAVETA DA MESA ────────────────────────────────────────────
       Fora do fluxo: o mapa atrás continua inteiro e o garçom troca de mesa
       sem o painel comer metade da tela. 82dvh e não 82vh porque a barra do
       navegador some e volta — com vh, o botão Fechar Conta ficava atrás
       dela justamente quando a mesa ia fechar. */
    .mesa-detalhe {
      position: fixed !important; left: 0; right: 0; bottom: 0;
      width: auto !important; max-height: 82dvh !important;
      border-top: none !important; border-radius: 18px 18px 0 0;
      z-index: 900; box-shadow: 0 -12px 40px rgba(15,23,42,.28) !important;
      padding-bottom: env(safe-area-inset-bottom);
      animation: mesa-sobe .18s ease-out;
    }
    .mesa-cortina { display: block !important; }
  }
  @keyframes mesa-sobe { from { transform: translateY(14px); opacity: .7; } to { transform: none; opacity: 1; } }
  /* Só existe no celular: em tela larga o painel é uma coluna, não uma gaveta. */
  .mesa-cortina { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.38); z-index: 899; }

  /* Quatro por linha no aparelho pequeno de verdade: um salão de 20 mesas
     cabe em cinco fileiras, sem rolar. */
  @media (max-width: 430px) {
    .mesa-mapa { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)) !important; }
    .mesa-cartao { min-height: 84px !important; }
  }

  /* No toque, a regra de .mesa-lancar input abaixo passa por cima (16px). */
  .mesa-obs-item { font-size: 12px; }

  @media (pointer: coarse) {
    .mesa-lancar button, .mesa-detalhe button { min-height: 44px; }
    .mesa-lancar input, .mesa-lancar select { min-height: 44px; font-size: 16px; }
    .mesa-chip { min-height: 44px; }
    .mesa-modal-conta button { min-height: 44px; }
    /* 16px evita o zoom automático do iOS ao focar o campo — o teclado sobe,
       a página dá zoom e o garçom perde o resto da conta de vista. */
    .mesa-modal-conta input, .mesa-modal-conta select { font-size: 16px; }
  }
`;

/** Quem está usando a tela: o painel da loja ou o garçom pelo link próprio. */
export type ModoDaTela = "loja" | "garcom";

export default function MesasApp({
  modo = "loja",
  garcom = null,
  slug = "",
}: {
  modo?: ModoDaTela;
  /** Garçom logado pelo link. Só existe em modo "garcom". */
  garcom?: { id: string; name: string; commissionRate?: number | null } | null;
  /** Slug da loja, para o "Sair" do garçom voltar ao login certo. */
  slug?: string;
}) {
  const router = useRouter();
  // Em modo garçom a tela é a mesma, menos o que é gestão: cadastro de mesa,
  // configuração, atalho para o painel. O servidor recusa essas ações de
  // qualquer forma; aqui só se tira o botão para ninguém bater num 403.
  const ehGarcom = modo === "garcom" && !!garcom;
  /** Em modo garçom a mesa abre sempre em nome dele; no painel, quem escolhe é o gerente. */
  const garcomFixo = ehGarcom && garcom ? garcom.id : "";

  /**
   * Toda chamada de API da tela passa por aqui. Em modo garçom: (1) declara ao
   * servidor que é o garçom falando, para o cookie do painel — se houver no
   * mesmo navegador — não valer nesta tela; (2) 401 significa que o acesso
   * acabou (senha trocada, desativado, apagado, sessão vencida): em vez de
   * deixar a grade congelada com "Unauthorized", volta ao login dizendo por quê.
   */
  const chamar = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!ehGarcom) return fetch(input, init);
    const cabecalhos = new Headers(init?.headers || {});
    cabecalhos.set("x-operador", "garcom");
    const res = await fetch(input, { ...init, headers: cabecalhos });
    if (res.status === 401) {
      // Descobre o motivo (senha trocada, caixa fechado, desativado...) para
      // a tela de login explicar, em vez de só pedir a senha de novo.
      let motivo = "sessao";
      let sessaoVale = false;
      try {
        const me = await fetch("/api/garcom/me", { cache: "no-store" });
        const d = await me.json().catch(() => ({}));
        if (me.ok) sessaoVale = true;
        else if (typeof d?.codigo === "string") motivo = d.codigo;
      } catch { /* fica o genérico */ }
      if (sessaoVale) {
        // Sessão válida e mesmo assim 401: é uma rota que o garçom não alcança,
        // não o fim do turno. Redirecionar aqui viraria um laço login → mesas.
        showToast("❌ Esta ação não está disponível pelo acesso do garçom");
        return res;
      }
      window.location.assign(`/garcom/${encodeURIComponent(slug)}?motivo=${encodeURIComponent(motivo)}`);
    }
    return res;
  };

  // Data
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<string[]>([]);
  /**
   * Os itens que a tela escondeu por serem só opção de combo.
   *
   * Guardados, e não descartados, porque "sumiu do cardápio da mesa" era
   * impossível de investigar: o garçom via um cardápio menor que o do balcão e
   * ninguém tinha como saber o que faltava nem por quê. Agora a própria tela
   * responde — e deixa lançar, para o caso de a loja querer vender o item.
   */
  const [menuOcultos, setMenuOcultos] = useState<(MenuItem & { motivo: string })[]>([]);
  const [mostrarOcultos, setMostrarOcultos] = useState(false);

  // UI State
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [view, setView] = useState<"grid" | "order">("grid"); // grid=mapa, order=fazendo pedido
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [tick, setTick] = useState(0);
  /** Tem caixa aberto? `null` = ainda perguntando (ver lib/caixa-aberto.ts). */
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null);

  // Pessoas na mesa e conta dividida
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  // Quem está pedindo agora. null = "é da mesa" (couvert, entrada para dividir).
  const [pessoaAtiva, setPessoaAtiva] = useState<string | null>(null);
  const [conta, setConta] = useState<ContaDividida | null>(null);
  const [carregandoConta, setCarregandoConta] = useState(false);
  /** Baixas já gravadas no servidor para esta mesa. */
  const [pagamentosDaMesa, setPagamentosDaMesa] = useState<PagamentoDaMesa[]>([]);
  /** De quem é o pagamento que está sendo digitado. Nulo = da mesa toda. */
  const [donoPagamento, setDonoPagamento] = useState<string | null>(null);
  const [formaPagamento, setFormaPagamento] = useState("Dinheiro");
  const [valorPagamento, setValorPagamento] = useState("");
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);
  /** Menu de ações da pessoa tocada no painel da mesa. */
  const [acaoPessoa, setAcaoPessoa] = useState<{ id: string; nome: string } | null>(null);
  const [novaPessoa, setNovaPessoa] = useState("");
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const [verContaPorPessoa, setVerContaPorPessoa] = useState(true);

  // Modals
  const [confirmOpen, setConfirmOpen] = useState<TableItem | null>(null); // confirm open table
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showNewTableModal, setShowNewTableModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  /** Mesa de ORIGEM da transferência (nulo = modal fechado). */
  const [showTransferModal, setShowTransferModal] = useState<TableItem | null>(null);
  const [showEditModal, setShowEditModal] = useState<TableItem | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [showFreeConfirm, setShowFreeConfirm] = useState(false);
  const [imprimindoConta, setImprimindoConta] = useState(false);

  // Open table form
  const [openCustomerName, setOpenCustomerName] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [openWaiterId, setOpenWaiterId] = useState("");
  const [waiters, setWaiters] = useState<any[]>([]);

  // Load waiters
  useEffect(() => {
    if (ehGarcom && garcom) {
      // O garçom pelo link não escolhe garçom: a mesa é dele.
      setWaiters([{ id: garcom.id, name: garcom.name, active: true }]);
      setOpenWaiterId(garcom.id);
      return;
    }
    chamar("/api/store/waiters")
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) setWaiters(data.filter(w => w.active));
      })
      .catch(() => {});
  }, [ehGarcom, garcom]);

  // Order form
  // `uid` dá identidade própria a cada linha. Antes o carrinho era indexado
  // por item.id, então dois combos do mesmo produto com escolhas diferentes
  // viravam a mesma linha: mexer na quantidade de um mexia no outro.
  // `guestId` é o dono do item — é o que permite rachar a conta depois.
  const [cart, setCart] = useState<{
    uid: string; item: MenuItem; qty: number; unitPrice?: number;
    comboSelections?: any[]; guestId?: string | null;
    /* Observação do item ("sem cebola"): vem do modal do produto ou é
       escrita na própria linha do carrinho. */
    notes?: string;
  }[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCat, setMenuCat] = useState("Todos");
  const [comboProduct, setComboProduct] = useState<MenuItem | null>(null);
  /**
   * Comanda ocupando quase a tela toda.
   *
   * Em tablet a comanda vive no rodapé com 44vh, e desses sobram ~25vh para a
   * lista depois do cabeçalho, do total e do botão de enviar. Como cada linha
   * tem botão de 44px (alvo de toque), sete itens dão uns 450px de conteúdo
   * numa janela de 200px: o garçom precisava arrastar dentro de uma faixa de
   * dois dedos para conferir o que lançou.
   */
  const [comandaAberta, setComandaAberta] = useState(false);

  // Close form
  // A taxa começa no que a LOJA tem cadastrado (GET /api/store/tables). Antes
  // era 10 cravado aqui: a casa que cobra 12% redigitava a cada fechamento, e
  // redigitar na frente do cliente é onde o erro entra.
  const [serviceFee, setServiceFee] = useState(10);
  const [taxaSalva, setTaxaSalva] = useState(10);
  /** Espelho da taxa salva, para o refresh não apagar o que o garçom digitou. */
  const taxaSalvaRef = useRef(10);
  const [useServiceFee, setUseServiceFee] = useState(true);
  const [waiterTip, setWaiterTip] = useState(0);
  // Desconto da mesa: porcentagem ou valor, com motivo. O motivo é o que
  // explica o furo no fechamento do caixa no fim do dia.
  const [desconto, setDesconto] = useState<DescontoManual>(SEM_DESCONTO);
  const [mostrarDesconto, setMostrarDesconto] = useState(false);

  // ── DESCONTO E GORJETA SÃO DESTA MESA ────────────────────────────────────
  // Viviam na tela, não na mesa: fechar a mesa 4 com 10% de desconto e abrir
  // o fechamento da mesa 5 levava os 10% junto, e a gorjeta também. Trocou de
  // conta, zera. O id da sessão (e não o objeto da mesa) é a chave: o refresh
  // da lista recria o objeto a cada poucos segundos e apagaria o que o garçom
  // acabou de digitar.
  const sessaoDaConta = selectedTable?.openSession?.id ?? null;
  useEffect(() => {
    setDesconto(SEM_DESCONTO);
    setMostrarDesconto(false);
    setWaiterTip(0);
  }, [sessaoDaConta]);

  // New table
  const [newTableNumber, setNewTableNumber] = useState("");
  const [newTableLabel, setNewTableLabel] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Data Fetching ─────────────────────────────────────────────────────────
  const fetchTables = useCallback(async () => {
    try {
      const res = await chamar("/api/store/tables");
      if (res.ok) {
        const data = await res.json();
        setTables(data.tables || []);
        if (typeof data.taxaServicoPadrao === "number") {
          setTaxaSalva(data.taxaServicoPadrao);
          // Só encosta no campo enquanto o garçom não mexeu nele, senão o
          // refresh de 10 em 10 segundos apagaria o que ele acabou de digitar.
          setServiceFee((atual) => (atual === taxaSalvaRef.current ? data.taxaServicoPadrao : atual));
          taxaSalvaRef.current = data.taxaServicoPadrao;
        }
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchMenu = useCallback(async () => {
    try {
      // Mesa é canal SALÃO: `price` já vem resolvido pelo preço do canal.
      // Pelo link do garçom não há sessão do painel; a rota própria entrega o
      // mesmo cardápio (src/lib/cardapio-da-loja.ts).
      const res = await chamar(ehGarcom ? "/api/garcom/cardapio" : "/api/admin/menu-products?canal=salao");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          // Esconde itens stub de integração (iFood, JotaJá, 99Food)
          const HIDDEN_CATS = new Set(["IFOOD", "JOTAJA", "JOTAJÁ", "99FOOD", "ONLINE", "OCULTO"]);
          // O prefixo do id diz como o registro NASCEU, não o que ele É hoje:
          // cardápio importado do sistema antigo reaproveita ids `ifood-…` (o
          // porquê está em SEM_PRODUTO_DE_INTEGRACAO, cardapio-interno.ts — o
          // servidor já filtra assim). Condenar por prefixo escondia desta tela
          // 8 dos 13 pastéis de carne da Pastelaria da Paulista — ativos, com
          // categoria própria e combo montado — e sem aparecer nem no aviso de
          // ocultos, porque espelho fica fora dele de propósito. Prefixo só
          // condena o espelho que ninguém adotou: o inativo.
          const isIntegration = (p: any) => {
            const temPrefixoDeEspelho =
              p.id?.startsWith("ifood-") || p.id?.startsWith("jotaja-") || p.id?.startsWith("99food-");
            if (temPrefixoDeEspelho && p.active === false) return true;
            return HIDDEN_CATS.has((p.category || "").toUpperCase().trim());
          };

          // Adicionais e sabores são MenuProduct de R$ 0,00 que existem só para
          // preencher a pergunta do combo. Viravam card no cardápio do garçom.
          //
          // Quem decide isso é o SERVIDOR, em `apenasOpcaoDeCombo`. Aqui o
          // `price` já veio trocado pelo preço do salão, então um item que a
          // loja precificou só no delivery chega como zero — e calcular a regra
          // com esse número escondia item vendável da mesa, calado. O cálculo
          // local fica como reserva para um payload antigo, sem a bandeira.
          const temBandeira = data.some((p: any) => p.apenasOpcaoDeCombo !== undefined);
          const soOpcaoDeCombo = temBandeira
            ? new Set(data.filter((p: any) => p.apenasOpcaoDeCombo).map((p: any) => String(p.id)))
            : idsSoDeOpcaoDeCombo(data);

          const paraItem = (p: any) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            // A categoria REAL, sempre. Antes todo combo virava "Combos" e perdia
            // a dele — e numa loja onde quase todo item é combo (a Pastelaria da
            // Paulista tem 69 de 186) isso apagava as abas de "Pastéis de carne",
            // "Pastéis Doces", "Pastéis especiais"... O garçom procurava a aba,
            // não achava, e concluía que os pastéis não estavam no sistema.
            // Combo continua tendo aba própria: ela é montada à parte, abaixo.
            category: p.category || "Outros",
            isCombo: p.isCombo,
            imageUrl: p.imageUrl || null,
            comboGroups: p.comboGroups,
            comboConfig: p.comboConfig,
          });

          // Vendáveis de verdade: o que passa por todos os filtros.
          const items = data
            .filter((p: any) => p.active !== false && !isIntegration(p))
            // O cadastro tem um interruptor por canal e esta tela era a única
            // que ignorava o dela: o que a loja desligava para a mesa continuava
            // aparecendo aqui. Balcão já olha activePDV, totem já olha activeTotem.
            .filter((p: any) => p.activeGarcom !== false)
            .filter((p: any) => p.esgotado !== true)
            .filter((p: any) => !soOpcaoDeCombo.has(String(p.id)))
            .map(paraItem);
          setMenuItems(items);

          // ── TUDO que não entrou, e o motivo de cada um ──────────────────────
          //
          // Antes a tela só descartava. Quando a loja dizia "sumiu item do
          // cardápio da mesa", não havia como saber qual nem por quê sem abrir o
          // banco — e são quatro motivos diferentes, com consertos diferentes.
          // Espelho de integração fica de fora da lista de propósito: aquilo
          // nunca foi cardápio da loja e só faria ruído.
          const motivoDeOcultar = (p: any): string | null => {
            if (isIntegration(p)) return null;
            if (p.active === false) return "pausado no cardápio";
            if (p.activeGarcom === false) return "desligado para o garçom no cadastro";
            if (p.esgotado === true) return "estoque zerou — pausado até repor (Cardápio → 📦 Estoque)";
            if (p.apenasEmCombo === true) return "complemento de combo — aparece dentro da pergunta do combo";
            if (soOpcaoDeCombo.has(String(p.id))) return "sem preço em nenhum canal — não dá para lançar na comanda";
            return null;
          };

          setMenuOcultos(
            data
              .map((p: any) => {
                const motivo = motivoDeOcultar(p);
                return motivo ? { ...paraItem(p), motivo } : null;
              })
              .filter(Boolean) as (MenuItem & { motivo: string })[]
          );
          // "Combos" é uma aba TRANSVERSAL: o combo aparece na categoria dele e
          // também aqui, para quem quer ver só os montados. Só entra na lista se
          // a loja tiver algum.
          const reais = Array.from(new Set(items.map((i: MenuItem) => i.category || "Outros"))).sort();
          const temCombo = items.some((i: MenuItem) => i.isCombo);
          const cats = ["Todos", ...(temCombo ? ["Combos"] : []), ...reais];
          setMenuCategories(cats as string[]);
        }
      }
    } catch { /* silent */ }
  }, [ehGarcom]);

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const res = await chamar(`/api/store/table-sessions?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setSessionDetail(data);
      }
    } catch { /* silent */ }
  }, []);

  // ── EDITAR PEDIDO JÁ LANÇADO ───────────────────────────────────────────
  //
  // Garçom lança errado, cliente muda de ideia — e a comanda era leitura pura:
  // a única saída era fechar a conta com item que ninguém consumiu. Só em mesa
  // ABERTA (o servidor também recusa fechada); cancelar o pedido devolve o
  // estoque baixado, reduzir quantidade não (a devolução registrada é por
  // pedido — está avisado no confirm).
  const [editandoItem, setEditandoItem] = useState<string | null>(null);

  // Editor de quantidade de item já lançado. A quantidade é ABSOLUTA ("fica
  // com 3"), nunca um incremento, e só vai ao servidor no Confirmar.
  const [editorQtd, setEditorQtd] = useState<{
    orderId: string; itemId: string; nome: string; atual: number; novo: number; preco: number; ultimoDoPedido: boolean;
  } | null>(null);

  const editarQtdItem = useCallback(async (orderId: string, itemId: string, quantity: number, nome?: string, atual?: number) => {
    if (!selectedTable?.openSession || quantity < 1 || editandoItem) return;
    setEditandoItem(itemId);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: [{ itemId, quantity }] }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) alert(data.error || "Não consegui alterar o item.");
      else if (nome) showToast(`✅ ${nome}: ${atual ?? "?"}x → ${quantity}x · pedido ${fmt(Number(data.totalAmount) || 0)}`);
      await fetchSessionDetail(selectedTable.openSession.id);
      fetchTables();
    } catch { alert("Sem conexão — o item não foi alterado."); }
    finally { setEditandoItem(null); }
  }, [selectedTable, editandoItem, fetchSessionDetail, fetchTables]);

  const removerItemPedido = useCallback(async (orderId: string, itemId: string, nome: string, ultimo: boolean) => {
    if (!selectedTable?.openSession || editandoItem) return;
    const aviso = ultimo
      ? `Remover "${nome}"?\n\nÉ o último item: o PEDIDO INTEIRO será cancelado e o estoque devolvido.`
      : `Remover "${nome}" deste pedido?\n\n(O estoque deste item não volta sozinho — se precisar, ajuste no Estoque.)`;
    if (!confirm(aviso)) return;
    setEditandoItem(itemId);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removerItemIds: [itemId] }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) alert(data.error || "Não consegui remover o item.");
      await fetchSessionDetail(selectedTable.openSession.id);
      fetchTables();
    } catch { alert("Sem conexão — o item não foi removido."); }
    finally { setEditandoItem(null); }
  }, [selectedTable, editandoItem, fetchSessionDetail, fetchTables]);

  const cancelarPedidoMesa = useCallback(async (orderId: string, numero: string | number) => {
    if (!selectedTable?.openSession || editandoItem) return;
    if (!confirm(`Cancelar o pedido #${numero} inteiro?\n\nEle sai da conta da mesa e o estoque baixado é devolvido.`)) return;
    setEditandoItem(orderId);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/orders/${orderId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) alert(data.error || "Não consegui cancelar o pedido.");
      await fetchSessionDetail(selectedTable.openSession.id);
      fetchTables();
    } catch { alert("Sem conexão — o pedido não foi cancelado."); }
    finally { setEditandoItem(null); }
  }, [selectedTable, editandoItem, fetchSessionDetail, fetchTables]);

  /** Quem está sentado na mesa. Recarrega junto com a comanda. */
  const carregarPessoas = useCallback(async (sessionId: string) => {
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/guests`);
      if (res.ok) {
        const data = await res.json();
        setPessoas(data.guests || []);
      }
    } catch { /* silencioso: a mesa funciona sem pessoas cadastradas */ }
  }, []);

  /** A conta já rateada. Só é buscada quando o garçom vai fechar. */
  const carregarConta = useCallback(async (sessionId: string, taxa: number, gorjeta: number) => {
    setCarregandoConta(true);
    try {
      // A taxa e a gorjeta vão na primeira busca também: sem elas o modal
      // abriria mostrando um total sem taxa e se corrigiria meio segundo
      // depois — tempo suficiente para o garçom ler o número errado em voz alta.
      const res = await chamar(`/api/store/table-sessions/${sessionId}/conta?taxa=${taxa}&gorjeta=${gorjeta}${paramsDoDesconto()}`);
      if (res.ok) setConta(await res.json());
    } catch { /* o modal mostra o total simples se a conta não vier */ } finally {
      setCarregandoConta(false);
    }
  }, []);

  const adicionarPessoas = async (quantidade?: number, nome?: string) => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId) return;
    const res = await chamar(`/api/store/table-sessions/${sessionId}/guests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quantidade ? { quantidade } : { name: nome }),
    });
    if (res.ok) { setNovaPessoa(""); await carregarPessoas(sessionId); }
    else showToast("❌ Não consegui adicionar a pessoa");
  };

  const renomearPessoa = async (guestId: string, nome: string) => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId || !nome.trim()) return;
    const res = await chamar(`/api/store/table-sessions/${sessionId}/guests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, name: nome.trim() }),
    });
    if (res.ok) { setRenomeando(null); await carregarPessoas(sessionId); }
  };

  const removerPessoa = async (guestId: string) => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId) return;
    const res = await chamar(`/api/store/table-sessions/${sessionId}/guests?guestId=${guestId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      const data = await res.json();
      // Os itens dela não somem — voltam a ser da mesa e entram no rateio.
      if (data.itensLiberados > 0) {
        showToast(`ℹ️ ${data.itensLiberados} item(ns) voltaram para a conta da mesa`);
      }
      if (pessoaAtiva === guestId) setPessoaAtiva(null);
      await carregarPessoas(sessionId);
    }
  };

  // Trocar de mesa tem que limpar as pessoas da mesa anterior, senão o garçom
  // lança o pedido da mesa 5 no nome de quem está sentado na mesa 3.
  useEffect(() => {
    const sessionId = selectedTable?.openSession?.id;
    setPessoas([]);
    setPessoaAtiva(null);
    setConta(null);
    if (sessionId) carregarPessoas(sessionId);
  }, [selectedTable?.openSession?.id, carregarPessoas]);

  useEffect(() => { 
    fetchTables(); 
    fetchMenu();
  }, [fetchTables, fetchMenu]);

  useEffect(() => {
    const i = setInterval(fetchTables, 8000);
    return () => clearInterval(i);
  }, [fetchTables]);

  // Timer for elapsed display
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  // ── O CAIXA PRECISA ESTAR ABERTO (lib/caixa-aberto.ts) ────────────────────
  //
  // Repergunta a cada 30s e quando a aba ganha foco: quem abre o caixa é o
  // painel, noutra tela e quase sempre noutro aparelho. Sem reperguntar, o
  // garçom ficaria olhando a faixa vermelha num caixa já aberto.
  useEffect(() => {
    let vivo = true;
    const conferir = () => {
      chamar("/api/store/caixa-aberto")
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (vivo && d) setCaixaAberto(d.aberto === true); })
        .catch(() => { /* mantém o que já sabia; quem barra de verdade é o servidor */ });
    };
    conferir();
    const relogio = setInterval(conferir, 30_000);
    window.addEventListener("focus", conferir);
    return () => { vivo = false; clearInterval(relogio); window.removeEventListener("focus", conferir); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehGarcom]);

  // ─── Actions ───────────────────────────────────────────────────────────────
  const openTable = async () => {
    if (!confirmOpen) return;
    setActionLoading(true);
    try {
      const waiterIdEscolhido = garcomFixo || openWaiterId;
      const selectedWaiter = waiters.find(w => w.id === waiterIdEscolhido);
      const res = await chamar("/api/store/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: confirmOpen.id,
          customerName: openCustomerName,
          notes: openNotes,
          waiterId: waiterIdEscolhido,
          waiterName: selectedWaiter ? selectedWaiter.name : ""
        })
      });
      if (res.ok) {
        showToast(`✅ Mesa ${confirmOpen.number} ocupada!`);
        setConfirmOpen(null);
        setOpenCustomerName("");
        setOpenNotes("");
        setOpenWaiterId(garcomFixo);
        await fetchTables();
        // Select the now-opened table
        const updated = await chamar("/api/store/tables");
        if (updated.ok) {
          const data = await updated.json();
          const t = (data.tables || []).find((t: TableItem) => t.id === confirmOpen.id);
          if (t) {
            setSelectedTable(t);
            if (t.openSession) {
              fetchSessionDetail(t.openSession.id);
              // Recarrega para o consumo de cada pessoa aparecer atualizado
              // nos chips antes mesmo de o garçom ir fechar a conta.
              carregarPessoas(t.openSession.id);
            }
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao abrir mesa"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const freeTable = async () => {
    if (!selectedTable?.openSession) return;
    if ((selectedTable.openSession.totalAmount || 0) > 0) {
      showToast("❌ Não é possível liberar mesa com consumo. Feche a conta primeiro.");
      return;
    }
    setActionLoading(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethods: [], serviceFeePercent: 0 }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${selectedTable.number} liberada!`);
        setShowFreeConfirm(false);
        setSelectedTable(null);
        setSessionDetail(null);
        setView("grid");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const addOrderToSession = async () => {
    if (!selectedTable?.openSession || cart.length === 0) return;
    setActionLoading(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/add-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(c => ({
            menuProductId: c.item.id,
            quantity: c.qty,
            price: c.unitPrice ?? c.item.price,
            comboSelections: c.comboSelections ? JSON.stringify(c.comboSelections) : null,
            // Sem dono = item da mesa. O rateio divide esses por igual.
            tableGuestId: c.guestId || null,
            notes: (c.notes || "").trim() || null,
          })),
        }),
      });
      if (res.ok) {
        showToast(`✅ Pedido enviado para Mesa ${selectedTable.number}!`);
        setCart([]);
        setView("grid");
        await fetchTables();
        // Refresh selected table
        const updated = await chamar("/api/store/tables");
        if (updated.ok) {
          const data = await updated.json();
          const t = (data.tables || []).find((t: TableItem) => t.id === selectedTable.id);
          if (t) {
            setSelectedTable(t);
            if (t.openSession) fetchSessionDetail(t.openSession.id);
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao adicionar pedido"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  /** Abre o fechamento e busca a conta já rateada pelo servidor. */
  /**
   * Taxa de serviço sugerida: a comissão cadastrada do garçom da mesa (aba
   * Garçons). Sem garçom vinculado, ou sem comissão, cai na taxa padrão da
   * LOJA — antes caía em 10 cravado, e a casa que cobra 12% redigitava a cada
   * fechamento. O gerente pode mudar no modal ou na própria tela da mesa;
   * aqui é só o ponto de partida.
   */
  const taxaSugeridaDaMesa = (t: TableItem | null): number => {
    const padrao = taxaSalva;
    // 0% é comissão válida (garçom de salário fixo); só nulo/inválido cai no padrão.
    const valida = (v: unknown) => v != null && Number.isFinite(Number(v)) ? Number(v) : null;
    if (ehGarcom) return valida(garcom?.commissionRate) ?? padrao;
    const waiterId = t?.openSession?.waiterId;
    const w = waiterId ? waiters.find((x) => x.id === waiterId) : null;
    return valida(w?.commissionRate) ?? padrao;
  };

  /** Sessão para a qual a taxa já foi sugerida: reabrir o modal não desfaz o que o gerente ajustou. */
  const sessaoComTaxaSugerida = useRef<string | null>(null);

  /**
   * Manda a conta da mesa para a impressora. O servidor monta o cupom e o
   * deixa na fila da nuvem, que o Assistente do caixa puxa em até 3 s — o
   * mesmo caminho das comandas. No painel, ainda tenta a impressora local na
   * hora; o Assistente deduplica pelo id do cupom, então não sai duas vezes.
   */
  const imprimirConta = async (taxa?: number, gorjeta?: number) => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId || imprimindoConta) return;
    setImprimindoConta(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/imprimir-conta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // O desconto da mesa vai junto: sem ele o papel saía com o consumo
        // cheio e os 10% sobre ele, e não batia com o que o fechamento cobra.
        body: JSON.stringify({ taxa, gorjeta, desconto: Number(desconto.valor) > 0 ? desconto : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(`❌ ${data?.error || "Não foi possível imprimir a conta"}`);
        return;
      }

      let saiuLocal = false;
      if (!ehGarcom && data?.cupom) {
        try {
          const cfgRes = await chamar("/api/store/printer-config");
          const cfg = cfgRes.ok ? await cfgRes.json() : null;
          if (cfg) {
            // Quem recebe a conta é a mesma regra da fila da nuvem: as
            // impressoras marcadas na tela de Impressoras e, enquanto a loja
            // não marcar nenhuma, o palpite do caixa (lib/impressao-da-conta.ts).
            // Papel e nuvem escolhendo diferente sairia dobrado, em duas.
            const marcadas = impressorasDaContaDaMesa<any>(cfg.printers || []);
            const escolhidas = (marcadas || []).map((p: any) => ({ ...p, categories: [] }));
            // Sem impressora do salão cadastrada, o caminho local detectaria
            // uma impressora qualquer e a fila da nuvem mandaria para a
            // `currentConfig.printer` do Assistente: duas impressoras
            // diferentes, a mesma conta em papel dobrado. Nesse caso, só a fila.
            if (escolhidas.length > 0) {
              const r = await printOrder(data.cupom as any, cfg.storeName || "FIREHUB", { ...cfg, printers: escolhidas }, {}, false);
              saiuLocal = r.success;
            }
          }
        } catch { /* sem Assistente nesta máquina: a fila da nuvem entrega */ }
      }
      showToast(saiuLocal
        ? `🧾 Conta impressa (taxa ${data?.taxaPct ?? "?"}%)`
        : `🧾 Conta enviada para a impressora do caixa (taxa ${data?.taxaPct ?? "?"}%)`);
    } catch {
      showToast("❌ Erro de conexão");
    } finally {
      setImprimindoConta(false);
    }
  };

  const abrirFechamento = async () => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId) return;
    // Sugere a taxa cadastrada do garçom da mesa UMA vez por mesa: se o
    // gerente mudou para 0% e fechou o modal para lançar um item, reabrir
    // não pode voltar para 10% por baixo dele.
    let taxa = useServiceFee ? serviceFee : 0;
    if (sessaoComTaxaSugerida.current !== sessionId) {
      sessaoComTaxaSugerida.current = sessionId;
      taxa = taxaSugeridaDaMesa(selectedTable);
      setServiceFee(taxa);
    }
    setShowCloseModal(true);
    setValorPagamento("");
    await Promise.all([
      carregarConta(sessionId, useServiceFee ? taxa : 0, Number(waiterTip) || 0),
      carregarPagamentos(sessionId),
    ]);
  };

  const closeSession = async () => {
    if (!selectedTable?.openSession) return;

    // O servidor recusa se faltar dinheiro; conferir aqui evita a ida e volta
    // e deixa a mensagem mais clara para quem está com o cliente na frente.
    if (faltaPagar > 0.01) {
      showToast(`⚠️ Ainda faltam ${fmt(faltaPagar)} para fechar a mesa`);
      return;
    }

    setActionLoading(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // As baixas já estão gravadas na mesa, uma a uma. O servidor usa o
          // que está no banco e ignora esta lista quando há algo lá — mandar
          // junto só cobre a mesa liberada sem consumo nenhum.
          paymentMethods: pagamentosDaMesa,
          serviceFeePercent: useServiceFee ? serviceFee : 0,
          waiterTip,
          // O servidor recalcula do tipo e do valor — nunca aceita o número pronto.
          desconto: descontoDaMesa > 0 ? desconto : null
        }),
      });
      if (res.ok) {
        showToast(`✅ Mesa ${selectedTable.number} fechada com sucesso!`);
        setShowCloseModal(false);
        setSelectedTable(null);
        setSessionDetail(null);
        setWaiterTip(0);
        setPagamentosDaMesa([]);
        setDonoPagamento(null);
        setValorPagamento("");
        setConta(null);
        setView("grid");
        await fetchTables();
      } else {
        const err = await res.json();
        // O servidor manda `mensagem` explicando quanto falta; `error` é só o
        // código interno e não diz nada para o garçom.
        showToast(`❌ ${err.mensagem || err.error || "Erro ao fechar mesa"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  // ─── PAGAMENTOS DA MESA ───────────────────────────────────────────────────
  // Cada baixa é gravada no servidor no instante em que o garçom registra. As
  // linhas viviam só nesta tela e iam todas juntas no fechamento: fechar o
  // modal, o tablet reiniciar ou outro garçom assumir a mesa apagava o que já
  // tinha entrado, e a única cópia era a memória de quem estava lá.

  /** "12,5" vira 12.5. Vírgula é o separador que o teclado brasileiro entrega. */
  const lerValorDigitado = (texto: string) => {
    const limpo = [...texto].filter(c => (c >= "0" && c <= "9") || c === "," || c === ".").join("");

    // Com vírgula, ela é o decimal e o ponto é separador de milhar
    // ("1.234,50"). Sem vírgula, o ponto é o decimal — que é o que sai do
    // teclado numérico de um notebook.
    const normalizado = limpo.includes(",")
      ? limpo.split(".").join("").split(",").join(".")
      : limpo;

    return Number(normalizado) || 0;
  };

  const paraCampo = (v: number) => (v > 0 ? v.toFixed(2).replace(".", ",") : "");

  const carregarPagamentos = useCallback(async (sessionId: string) => {
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/pagamentos`);
      if (res.ok) {
        const data = await res.json();
        setPagamentosDaMesa(Array.isArray(data.pagamentos) ? data.pagamentos : []);
      }
    } catch { /* silencioso: a tela continua com o que já tinha */ }
  }, []);

  const registrarPagamento = async () => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId) return;

    const valor = lerValorDigitado(valorPagamento);
    if (valor <= 0) { showToast("⚠️ Informe quanto foi recebido"); return; }

    setRegistrandoPagamento(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/pagamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor, metodo: formaPagamento, guestId: donoPagamento }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPagamentosDaMesa(data.pagamentos || []);
        setValorPagamento("");
        const dono = donoPagamento ? pessoas.find(p => p.id === donoPagamento)?.name : null;
        showToast(`✅ ${fmt(valor)} de ${dono || "a mesa"} registrado`);
      } else {
        showToast(`❌ ${data.mensagem || "Não consegui registrar o pagamento"}`);
      }
    } catch {
      showToast("❌ Erro de conexão");
    } finally {
      setRegistrandoPagamento(false);
    }
  };

  /** Garçom digita errado. Sem isto, a saída seria fechar com valor que ninguém pagou. */
  const apagarPagamento = async (uid: string) => {
    const sessionId = selectedTable?.openSession?.id;
    if (!sessionId) return;
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/pagamentos?uid=${encodeURIComponent(uid)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPagamentosDaMesa(data.pagamentos || []);
      else showToast(`❌ ${data.mensagem || "Não consegui apagar"}`);
    } catch {
      showToast("❌ Erro de conexão");
    }
  };

  const handleProductClick = (item: MenuItem) => {
    const groups = getEffectiveComboGroups(item);
    if ((item.isCombo || groups.length > 0) && groups.length > 0) {
      setComboProduct({ ...item, comboGroups: groups });
    } else {
      // Cada toque no card soma UM. Dizer quantos ficaram evita o garçom tocar
      // de novo "para garantir" e depois somar outra vez no carrinho.
      // Mesma busca do addToCart: a linha com observação não recebe o toque.
      const ex = cart.find(i => i.item.id === item.id && !i.comboSelections && !i.notes && (i.guestId || null) === pessoaAtiva);
      addToCart(item);
      showToast(`${item.name}: ${(ex?.qty ?? 0) + 1}x no pedido`);
    }
  };

  // `notes`: a observação que o modal do produto pergunta ("Alguma
  // observação?") e que a mesa descartava — o item chegava na cozinha sem o
  // "sem cebola" que o garçom acabou de digitar. Item com observação é linha
  // própria: não se junta com o mesmo produto sem ela.
  const addToCart = (item: MenuItem, comboSelections?: any[], extraSum: number = 0, notes: string = "") => {
    const unitPrice = item.price + extraSum;
    const dono = pessoaAtiva;
    const obs = String(notes || "").trim();
    setCart(prev => {
      // Único de verdade: com `prev.length` no meio, apagar uma linha e somar
      // outra do mesmo produto repetia o uid — e a observação digitada numa
      // linha aparecia na outra.
      const uid = `${item.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${dono || "mesa"}`;
      if ((comboSelections && comboSelections.length > 0) || obs) {
        return [...prev, { uid, item, qty: 1, comboSelections: comboSelections && comboSelections.length > 0 ? comboSelections : undefined, unitPrice, guestId: dono, notes: obs || undefined }];
      }
      // Só junta na mesma linha se for o mesmo produto E da mesma pessoa: duas
      // cervejas de pessoas diferentes precisam continuar separadas para a
      // conta sair certa no fim.
      const ex = prev.find(i => i.item.id === item.id && !i.comboSelections && !i.notes && (i.guestId || null) === dono);
      if (ex) return prev.map(i => i.uid === ex.uid ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { uid, item, qty: 1, unitPrice, guestId: dono }];
    });
  };

  const updateTable = async () => {
    if (!showEditModal) return;
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = { id: showEditModal.id };
      if (editNumber) body.number = parseInt(editNumber);
      if (editLabel !== undefined) body.label = editLabel || null;
      const res = await chamar("/api/store/tables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast(`✅ Mesa atualizada!`);
        setShowEditModal(null);
        setEditNumber("");
        setEditLabel("");
        await fetchTables();
        // Update selected table if it was the one being edited
        if (selectedTable?.id === showEditModal.id) {
          const updated = await chamar("/api/store/tables");
          if (updated.ok) {
            const data = await updated.json();
            const t = (data.tables || []).find((t: TableItem) => t.id === showEditModal.id);
            if (t) setSelectedTable(t);
          }
        }
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro ao atualizar"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const createTable = async () => {
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (newTableNumber) body.number = parseInt(newTableNumber);
      if (newTableLabel) body.label = newTableLabel;
      const res = await chamar("/api/store/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast("✅ Mesa criada!");
        setShowNewTableModal(false);
        setNewTableNumber("");
        setNewTableLabel("");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error || "Erro"}`);
      }
    } catch { showToast("❌ Erro de conexão"); } finally {
      setActionLoading(false);
    }
  };

  const deleteTable = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover esta mesa?")) return;
    try {
      const res = await chamar(`/api/store/tables?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        showToast("✅ Mesa removida!");
        await fetchTables();
      } else {
        const err = await res.json();
        showToast(`❌ ${err.error}`);
      }
    } catch { showToast("❌ Erro"); }
  };

  /**
   * Move a conta inteira para outra mesa. Antes dizia "em breve", e a saída
   * era liberar a mesa errada e relançar tudo na certa — com o pedido saindo
   * de novo na cozinha.
   */
  const transferTable = async (toTableId: string) => {
    const origem = showTransferModal || selectedTable;
    if (!origem?.openSession) return;
    setActionLoading(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${origem.openSession.id}/transferir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toTableId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(`❌ ${data?.error || "Não foi possível transferir"}`);
        return;
      }
      showToast(`↔️ Conta movida da mesa ${data.de} para a mesa ${data.para}`);
      setShowTransferModal(null);
      await fetchTables();
      const updated = await chamar("/api/store/tables");
      if (updated.ok) {
        const d = await updated.json();
        const t = (d.tables || []).find((x: TableItem) => x.id === toTableId);
        if (t) setSelectedTable(t);
      }
    } catch {
      showToast("❌ Erro de conexão");
    } finally {
      setActionLoading(false);
    }
  };

  /** Sai do acesso do garçom: apaga o cookie e volta para o login da loja. */
  const sairDoGarcom = async () => {
    try {
      await chamar("/api/garcom/logout", { method: "POST" });
    } catch { /* o login recusa o cookie de qualquer jeito se ele ficou */ }
    window.location.assign(`/garcom/${encodeURIComponent(slug)}`);
  };

  // ── OCUPADAS NO TOPO ─────────────────────────────────────────────────────
  //
  // Pedido do dono (24/09/2026): num salão de 20 mesas com 4 ocupadas, quem
  // trabalha procura as ocupadas no meio das livres. Ligado, a grade vira dois
  // grupos — OCUPADAS e depois LIVRES, cada um em ordem de número. É opcional
  // e fica guardado NESTE aparelho: o celular do garçom não muda a tela do
  // caixa. Lido depois de montar, e não no useState, senão o HTML do servidor
  // (sem localStorage) e o do navegador divergem.
  const CHAVE_OCUPADAS_NO_TOPO = "firehub_mesas_ocupadas_no_topo";
  const [ocupadasNoTopo, setOcupadasNoTopo] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_OCUPADAS_NO_TOPO) === "1") setOcupadasNoTopo(true);
    } catch { /* aba anônima ou armazenamento bloqueado: fica a ordem de número */ }
  }, []);
  const trocarOcupadasNoTopo = () => {
    const ligar = !ocupadasNoTopo;
    setOcupadasNoTopo(ligar);
    try { localStorage.setItem(CHAVE_OCUPADAS_NO_TOPO, ligar ? "1" : "0"); } catch { /* só não lembra */ }
  };

  // ─── Computed ──────────────────────────────────────────────────────────────
  const occupiedTables = tables.filter(t => t.openSession);
  const freeTables = tables.filter(t => !t.openSession);
  const totalConsumo = occupiedTables.reduce((s, t) => s + (t.openSession?.totalAmount || 0), 0);

  const filteredMenu = useMemo(() => {
    return menuItems.filter(m => {
      const matchSearch = m.name.toLowerCase().includes(menuSearch.toLowerCase());
      const matchCat =
        menuCat === "Todos" ? true
          : menuCat === "Combos" ? !!m.isCombo
            : m.category === menuCat;
      return matchSearch && matchCat;
    });
  }, [menuItems, menuSearch, menuCat]);

  // unitPrice, não item.price: combo com adicionais custa mais que o preço de
  // tabela, e era esse o valor enviado ao servidor. O carrinho mostrava menos
  // do que a mesa era realmente cobrada.
  const cartTotal = cart.reduce((s, c) => s + (c.unitPrice ?? c.item.price) * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  // Cancelado fora da soma: o fechamento e a conta já o descontam no servidor
  // — mostrar um total maior aqui faria a tela discordar do caixa na frente do
  // cliente, exatamente na hora de pagar.
  const sessionTotal = sessionDetail?.orders
    .filter((o) => o.status !== "CANCELADO" && o.status !== "CANCELED" && o.status !== "CANCELLED")
    .reduce((s, o) => s + o.totalAmount, 0) || selectedTable?.openSession?.totalAmount || 0;

  /** O desconto na querystring da conta por pessoa — a mesma regra do servidor. */
  const paramsDoDesconto = () =>
    Number(desconto.valor) > 0
      ? `&descontoTipo=${desconto.tipo}&descontoValor=${desconto.valor}&descontoMotivo=${encodeURIComponent(desconto.motivo || "")}`
      : "";

  // ─── Fechamento ───────────────────────────────────────────────────────────
  // O consumo vem da conta do servidor quando ela já chegou. É o mesmo número
  // que o fechamento vai usar para validar — inclusive descontando pedidos
  // cancelados, que o total da comanda ainda soma.
  const consumoFechamento = conta?.consumo ?? sessionTotal;
  // Desconto dado na mesa. Sai do consumo ANTES da taxa de serviço, que é
  // sobre o que a mesa realmente paga pelos itens. O servidor recalcula do
  // tipo e do valor no fechamento — aqui é só o espelho para o garçom ver.
  const descontoDaMesa = valorDoDesconto(desconto, consumoFechamento);
  const consumoCobrado = Math.max(0, consumoFechamento - descontoDaMesa);
  const taxaFechamento = useServiceFee ? consumoCobrado * serviceFee / 100 : 0;
  const totalFechamento = consumoCobrado + taxaFechamento + (Number(waiterTip) || 0);

  // O rodapé do painel da mesa, com a mesma regra: desconto primeiro, taxa
  // sobre o que sobrou. Ele fazia os 10% sobre o consumo cheio e ignorava o
  // desconto — a tela dizia um total e o fechamento cobrava outro.
  const descontoNoPainel = valorDoDesconto(desconto, sessionTotal);
  const consumoCobradoNoPainel = Math.max(0, sessionTotal - descontoNoPainel);
  const taxaNoPainel = useServiceFee ? consumoCobradoNoPainel * serviceFee / 100 : 0;

  // O placar sai do que está GRAVADO, não do que está digitado na tela. É a
  // mesma lista que o servidor confere no fechamento, então a tela nunca
  // mostra a mesa zerada com o fechamento recusando por diferença.
  const totalRecebido = pagamentosDaMesa.reduce((soma, p) => soma + (Number(p.amount) || 0), 0);
  const faltaPagar = Math.max(0, totalFechamento - totalRecebido);
  const troco = Math.max(0, totalRecebido - totalFechamento);
  // Mesa sem consumo (aberta por engano) fecha sem pagamento nenhum — exigir
  // uma baixa de R$ 0,00 só sujaria o relatório do caixa.
  const podeFechar = faltaPagar <= 0.01 &&
    (pagamentosDaMesa.length > 0 || totalFechamento <= 0.01);

  /** Quanto já entrou em nome desta pessoa. */
  const pagoDaPessoa = (guestId: string) =>
    pagamentosDaMesa
      .filter(p => p.guestId === guestId)
      .reduce((soma, p) => soma + (Number(p.amount) || 0), 0);

  /** O que ainda falta esta pessoa pagar — é o que a mesa vai zerando. */
  const faltaDaPessoa = (pes: { id: string; aPagar: number }) =>
    Math.max(0, pes.aPagar - pagoDaPessoa(pes.id));

  // Taxa, gorjeta e DESCONTO entram no rateio, então mexer neles muda quanto
  // cada pessoa deve. O desconto faltava aqui: dar desconto não recarregava a
  // conta por pessoa, que seguia com a parte de cada um e os 10% sobre o valor
  // cheio. O debounce evita uma requisição por tecla digitada.
  useEffect(() => {
    const sessionId = selectedTable?.openSession?.id;
    if (!showCloseModal || !sessionId) return;
    const t = setTimeout(() => {
      const taxa = useServiceFee ? serviceFee : 0;
      chamar(`/api/store/table-sessions/${sessionId}/conta?taxa=${taxa}&gorjeta=${Number(waiterTip) || 0}${paramsDoDesconto()}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) setConta(d); })
        .catch(() => { /* mantém a conta anterior */ });
    }, 400);
    return () => clearTimeout(t);
  }, [showCloseModal, serviceFee, useServiceFee, waiterTip, selectedTable?.openSession?.id, desconto.tipo, desconto.valor, desconto.motivo]);

  // ─── MODAL DE COMBO ───────────────────────────────────────────────────────
  // Esta página tem DOIS returns: o de lançar pedido e o da grade de mesas. O
  // modal só era montado no da grade — então, na tela de pedido, tocar num
  // combo guardava o produto e não desenhava nada. Para o garçom o toque
  // simplesmente não pegava; o modal só aparecia depois do "Voltar", quando a
  // grade enfim renderizava. Como constante, ele entra nas duas telas.
  const modalDeCombo = comboProduct ? (
    <ComboModal
      product={comboProduct as any}
      onClose={() => setComboProduct(null)}
      onConfirm={(selections, extraSum, qty, notes) => {
        // O ComboModal devolve { grupoId: { nome: qtd } }; o carrinho das
        // mesas guarda lista [{ name, quantity }]. Converte preservando a
        // quantidade escolhida — e a observação, que antes se perdia aqui.
        const lista: { name: string; quantity: number }[] = [];
        for (const porGrupo of Object.values(selections || {})) {
          for (const [nome, quantidade] of Object.entries((porGrupo || {}) as Record<string, number>)) {
            if (Number(quantidade) > 0) lista.push({ name: nome, quantity: Number(quantidade) });
          }
        }
        for (let i = 0; i < Math.max(1, qty || 1); i++) {
          addToCart(comboProduct, lista, extraSum, notes || "");
        }
        setComboProduct(null);
      }}
    />
  ) : null;

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "linear-gradient(135deg, #F8FAFC 0%, #FAF6F2 100%)",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, background: "#475569",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, margin: "0 auto 16px", boxShadow: "0 8px 32px rgba(28, 25, 23,0.3)",
          }}>🍽️</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#64748B" }}>Carregando mesas...</div>
        </div>
      </div>
    );
  }

  if (view === "order" && selectedTable?.openSession) {
    // ─── A TELA DE PEDIDO TOMA A JANELA INTEIRA ──────────────────────────
    // Era `height: 100vh` dentro do layout de /store, que desenha antes o
    // cabeçalho da loja, a barra de caixa/site e o banner do teste grátis, e só
    // então <main>{children}</main>. A conta é simples: altura da página = tudo
    // isso + 100vh. O que ficava no fim dos 100vh — o carrinho e o botão de
    // enviar — nascia abaixo da dobra, e num tablet ninguém desconfia que
    // precisa rolar a PÁGINA, porque o cardápio ali dentro já rola sozinho.
    //
    // O garçom então tocava nos produtos, via o número subir no canto do card e
    // não encontrava como mandar para a mesa. Com combo dava certo por acidente:
    // o modal abre por cima e tem o próprio botão de confirmar.
    //
    // `fixed` com `inset: 0` resolve na raiz — a tela passa a valer a janela
    // real, não o que sobrou dela. É o que a tela do KDS já faz, pelo mesmo
    // motivo. O "← Voltar" continua sendo a saída, então nada fica preso.
    //
    // zIndex 900: acima do cabeçalho da loja e abaixo dos modais desta página
    // (fechamento 1000, ações da pessoa 1100, combo 9999).
    return (
      <div className="mesa-lancar" style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        background: "#F8FAFC",
      }}>
        <style>{ESTILO_TABLET}</style>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{
            padding: "14px 20px", background: "#475569",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <button onClick={() => { setView("grid"); setCart([]); setMenuSearch(""); setMenuCat("Todos"); setComboProduct(null); }}
              style={{
                background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                color: "#fff", padding: "6px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>← Voltar</button>
            <div style={{ color: "#fff" }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                Pedido — Mesa {selectedTable.number}
                {selectedTable.label ? ` (${selectedTable.label})` : ""}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {selectedTable.openSession.customerName || ""}
                {selectedTable.openSession.waiterName ? ` · Garçom: ${selectedTable.openSession.waiterName}` : ""}
                {selectedTable.openSession.notes ? ` · 📝 ${selectedTable.openSession.notes}` : ""}
              </div>
            </div>
          </div>

          <div style={{ padding: "12px 16px 8px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
            <input
              placeholder="🔍 Buscar no cardápio..."
              value={menuSearch}
              onChange={e => setMenuSearch(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: "1.5px solid #E2E8F0", fontSize: 14, outline: "none",
                fontFamily: "inherit", marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
              {menuCategories.map(cat => (
                <button key={cat} onClick={() => setMenuCat(cat)} style={{
                  padding: "5px 12px", borderRadius: 20, border: "none", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                  background: menuCat === cat ? "#475569" : "#F1F5F9",
                  color: menuCat === cat ? "#fff" : "#64748B",
                }}>{cat}</button>
              ))}
            </div>

            {/* ── O que a tela escondeu, e por quê ─────────────────────────
                Sem isto o garçom via um cardápio menor que o do balcão e não
                tinha como saber o que faltava — a queixa chegava como "sumiu
                item da mesa" e ninguém conseguia investigar. Agora a tela
                responde sozinha, e deixa lançar se a loja quiser vender. */}
            {menuOcultos.length > 0 && (
              <button
                onClick={() => setMostrarOcultos(v => !v)}
                style={{
                  marginTop: 6, padding: "5px 10px", borderRadius: 8,
                  border: "1px solid #E2E8F0", background: mostrarOcultos ? "#FFF7E6" : "#F8FAFC",
                  color: "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit", width: "100%", textAlign: "left",
                }}
              >
                {mostrarOcultos ? "▾" : "▸"} {menuOcultos.length} {menuOcultos.length === 1 ? "item do cardápio não aparece aqui" : "itens do cardápio não aparecem aqui"}
                <span style={{ fontWeight: 500 }}> — toque para ver quais e por quê</span>
              </button>
            )}

            {mostrarOcultos && menuOcultos.length > 0 && (
              <div style={{ marginTop: 6, padding: "8px 10px", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8 }}>
                {Array.from(new Set(menuOcultos.map(o => o.motivo))).map(motivo => {
                  const doMotivo = menuOcultos.filter(o => o.motivo === motivo);
                  const conserto =
                    motivo.startsWith("pausado")
                      ? "Conserto: reativar o item no cardápio."
                      : motivo.startsWith("desligado")
                        ? "Conserto: ligar o interruptor do garçom no cadastro do item."
                        : motivo.startsWith("complemento")
                        ? "Isto é o certo: complemento não se vende avulso. Se for um item de verdade, recadastre fora do combo."
                        : "Conserto: dar um preço de salão ao item. Sem preço ele somaria R$ 0,00 na comanda — por isso só aparece como opção dentro do combo.";
                  return (
                    <div key={motivo} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#92400E" }}>
                        {doMotivo.length} {doMotivo.length === 1 ? "item" : "itens"} — {motivo}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#B45309", marginBottom: 5 }}>{conserto}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {doMotivo.map(o => (
                          <span key={o.id} style={{ fontSize: 11, background: "#fff", border: "1px solid #FDE68A", borderRadius: 6, padding: "3px 7px", color: "#92400E" }}>
                            {o.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── QUEM ESTÁ PEDINDO ───────────────────────────────────────
              A escolha vale para os próximos toques no cardápio. É o que
              transforma "a mesa consumiu R$ 300" em "o João consumiu R$ 62" —
              sem isso, na hora de rachar a conta ninguém lembra quem pediu o quê. */}
          <div className="mesa-quem-pede" style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
            background: "#F8FAFC", borderBottom: "1px solid #E7DDD3", overflowX: "auto",
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#334155", whiteSpace: "nowrap", flexShrink: 0 }}>
              Lançar para:
            </span>

            <button onClick={() => setPessoaAtiva(null)} className="mesa-chip" style={{
              padding: "8px 14px", borderRadius: 20, cursor: "pointer", flexShrink: 0,
              fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
              border: pessoaAtiva === null ? "2px solid #475569" : "1px solid #E2E8F0",
              background: pessoaAtiva === null ? "#475569" : "#fff",
              color: pessoaAtiva === null ? "#fff" : "#64748B",
            }}>🍽️ Mesa</button>

            {pessoas.map(pes => (
              <button key={pes.id} onClick={() => setPessoaAtiva(pes.id)} className="mesa-chip" style={{
                padding: "8px 14px", borderRadius: 20, cursor: "pointer", flexShrink: 0,
                fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
                border: pessoaAtiva === pes.id ? "2px solid #475569" : "1px solid #E2E8F0",
                background: pessoaAtiva === pes.id ? "#475569" : "#fff",
                color: pessoaAtiva === pes.id ? "#fff" : "#64748B",
              }}>
                {pes.name}
                {pes.total > 0 && (
                  <span style={{ opacity: 0.75, marginLeft: 6, fontWeight: 600 }}>{fmt(pes.total)}</span>
                )}
              </button>
            ))}

            <button onClick={() => adicionarPessoas(1)} className="mesa-chip" style={{
              padding: "8px 14px", borderRadius: 20, cursor: "pointer", flexShrink: 0,
              fontSize: 13, fontWeight: 800, whiteSpace: "nowrap",
              border: "1.5px dashed #94A3B8", background: "#fff", color: "#475569",
            }}>+ Pessoa</button>
          </div>

          <div className="mesa-produtos" style={{ flex: 1, overflowY: "auto", padding: 12, alignContent: "start", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {filteredMenu.map(p => {
              // Soma todas as linhas: o mesmo produto pode estar no carrinho
              // em nome de pessoas diferentes.
              const qtdNoCarrinho = cart
                .filter(c => c.item.id === p.id && !c.comboSelections)
                .reduce((s, c) => s + c.qty, 0);
              const inCart = qtdNoCarrinho > 0;
              return (
                <div key={p.id} onClick={() => handleProductClick(p)}
                  style={{ background: "#fff", border: `2px solid ${inCart ? "#C92E09" : "#E2E8F0"}`, borderRadius: 14, padding: 10, cursor: "pointer", transition: "all 0.15s", position: "relative", userSelect: "none" }}
                  onMouseEnter={e => { if (!inCart) e.currentTarget.style.borderColor = "#FCA5A5"; }}
                  onMouseLeave={e => { if (!inCart) e.currentTarget.style.borderColor = "#E2E8F0"; }}>
                  {inCart && (
                    <div style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, background: "#C92E09", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#fff", fontSize: "0.65rem", fontWeight: 900 }}>{qtdNoCarrinho}</span>
                    </div>
                  )}
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: 75, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
                    : <div style={{ width: "100%", height: 75, background: "#F1F5F9", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                        {p.isCombo ? "🍱" : "🍔"}
                      </div>
                  }
                  <div style={{ fontWeight: 700, fontSize: "0.8rem", marginBottom: 2, lineHeight: 1.2 }}>{p.name}</div>
                  <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginBottom: 4 }}>{p.isCombo ? "Combo" : p.category}</div>
                  <div style={{ color: "#C92E09", fontWeight: 800, fontSize: 14 }}>
                    {(() => {
                      // Mesmo cálculo do cardápio: no "Nugget" (base R$ 0,00) o
                      // card anunciava "a partir de R$ 0,00".
                      const comGrupos = { ...p, comboGroups: getEffectiveComboGroups(p) } as any;
                      const minimo = precoMinimoDoProduto(comGrupos);
                      return precoVariaPorEscolha(comGrupos) ? `a partir de ${fmt(minimo)}` : fmt(minimo);
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`mesa-comanda${comandaAberta ? " aberta" : ""}`} style={{
          borderLeft: "1px solid #E2E8F0", background: "#fff",
          display: "flex", flexDirection: "column",
        }}>
          <button
            type="button"
            onClick={() => setComandaAberta(v => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              width: "100%", padding: "14px 18px", borderBottom: "1px solid #E2E8F0",
              background: "#fff", border: "none", borderRadius: 0, textAlign: "left",
              fontFamily: "inherit", fontWeight: 800, fontSize: 16, color: "#1E293B",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <span>🛒 Carrinho ({cartCount} {cartCount === 1 ? "item" : "itens"})</span>
            <span className="mesa-comanda-acao" style={{
              fontSize: 13, fontWeight: 800, color: "#475569",
              background: "#F8FAFC", padding: "6px 12px", borderRadius: 20,
              whiteSpace: "nowrap",
            }}>
              {comandaAberta ? "▼ Recolher" : "▲ Ver tudo"}
            </span>
          </button>

          {/* overscrollBehavior "contain": ao chegar no fim da lista, o gesto
              parava de rolar o carrinho e passava a rolar o cardápio atrás —
              o garçom tirava o dedo achando que a lista tinha acabado. */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {cart.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🍽️</div>
                <div style={{ fontSize: 14 }}>Toque nos produtos para adicionar</div>
              </div>
            ) : (
              cart.map((c, i) => (
                <div key={c.uid} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 0", borderBottom: i < cart.length - 1 ? "1px solid #F1F5F9" : "none",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{c.item.name}</div>
                    {/* Observação editável na própria linha, antes de enviar:
                        produto sem opção (o suco "sem leite" da Ragnar,
                        25/09/2026) entra com um toque e não passa pelo modal,
                        então não tinha onde escrever. Igual ao balcão. Vai
                        para a cozinha e para a comanda como Obs: do item. */}
                    <input
                      className="mesa-obs-item"
                      value={c.notes || ""}
                      placeholder="📝 obs. do item (ex.: sem leite)"
                      maxLength={140}
                      aria-label={`Observação de ${c.item.name}`}
                      onChange={(e) => { const v = e.target.value; setCart(prev => prev.map(x => x.uid === c.uid ? { ...x, notes: v } : x)); }}
                      style={{
                        width: "100%", marginTop: 4, padding: "5px 8px", borderRadius: 6,
                        border: `1px solid ${c.notes ? "#B45309" : "#E2E8F0"}`,
                        background: c.notes ? "#FFF7E6" : "#fff", color: c.notes ? "#B45309" : "#1E293B",
                        fontWeight: c.notes ? 700 : 400, outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                      }}
                    />
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>{fmt((c.unitPrice ?? c.item.price) * c.qty)}</div>
                    {pessoas.length > 0 && (
                      <div style={{ fontSize: 11, color: c.guestId ? "#1C1917" : "#94A3B8", fontWeight: 700, marginTop: 2 }}>
                        {c.guestId
                          ? `👤 ${pessoas.find(x => x.id === c.guestId)?.name || "Cliente"}`
                          : "🍽️ Da mesa"}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => {
                      if (c.qty <= 1) setCart(prev => prev.filter(x => x.uid !== c.uid));
                      else setCart(prev => prev.map(x => x.uid === c.uid ? { ...x, qty: x.qty - 1 } : x));
                    }} style={{
                      width: 38, height: 38, borderRadius: 9, border: "1px solid #E2E8F0",
                      background: "#F8FAFC", cursor: "pointer", fontWeight: 700, fontSize: 16,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>−</button>
                    {/* Número DIGITÁVEL e absoluto: quem quer 3 digita 3. Com o
                        número só de leitura, o jeito de chegar em 3 era tocar
                        "+" — e tocar "+" com 3 já marcados dava 6. */}
                    <input
                      type="number" inputMode="numeric" min={1} max={99} value={c.qty}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1)));
                        setCart(prev => prev.map(x => x.uid === c.uid ? { ...x, qty: n } : x));
                      }}
                      onFocus={(e) => e.target.select()}
                      aria-label={`Quantidade de ${c.item.name}`}
                      style={{ width: 46, height: 38, textAlign: "center", fontWeight: 900, fontSize: 16, color: "#1E293B", border: "1.5px solid #CBD5E1", borderRadius: 9, background: "#FAF6F2", outline: "none" }}
                    />
                    <button onClick={() => setCart(prev => prev.map(x => x.uid === c.uid ? { ...x, qty: x.qty + 1 } : x))}
                      style={{
                        width: 38, height: 38, borderRadius: 9, border: "none",
                        background: "#475569", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>+</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div style={{ padding: "14px 18px", borderTop: "2px solid #E2E8F0", background: "#FAFAFE" }}>
              <div style={{
                display: "flex", justifyContent: "space-between", marginBottom: 12,
                fontSize: 18, fontWeight: 900, color: "#1E293B",
              }}>
                <span>Total</span>
                <span style={{ color: "#475569" }}>{fmt(cartTotal)}</span>
              </div>
              <button onClick={addOrderToSession} disabled={actionLoading} style={{
                width: "100%", background: "#0F766E", color: "#fff", border: "none", borderRadius: 12,
                padding: "14px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
                opacity: actionLoading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(15, 118, 110,0.3)",
              }}>
                {actionLoading ? "Enviando..." : "✅ Enviar Pedido para Mesa"}
              </button>
            </div>
          )}
        </div>

        {modalDeCombo}
      </div>
    );
  }

  // ── O CARTÃO DA MESA ──────────────────────────────────────────────────────
  //
  // Função, e não JSX solto dentro do map: a grade desenha os cartões numa
  // lista só (ordem de número) ou em dois grupos (ocupadas no topo), e o
  // cartão tem de ser o mesmo nos dois jeitos.
  //
  // A mesa aberta mostra o NOME do cliente e a OBSERVAÇÃO escrita ao ocupar
  // a mesa, à vista de quem passa pelo salão (pedido do dono, 24/09/2026).
  // Texto longo é cortado no cartão; o inteiro está no painel da mesa.
  const cartaoDaMesa = (table: TableItem) => {
    const occupied = !!table.openSession;
    const isSelected = selectedTable?.id === table.id;
    const hasValue = occupied && (table.openSession?.totalAmount || 0) > 0;
    const nome = (table.openSession?.customerName || "").trim();
    const observacao = (table.openSession?.notes || "").trim();
    return (
      <button
        key={table.id}
        onClick={() => {
          if (occupied) {
            setSelectedTable(table);
            if (table.openSession) fetchSessionDetail(table.openSession.id);
          } else {
            // Show confirm modal
            setConfirmOpen(table);
          }
        }}
        className="mesa-cartao"
        style={{
          background: isSelected
            ? "linear-gradient(135deg, #475569, #334155)"
            : occupied
              ? hasValue ? "#FEF2F2" : "#FFF4EF"
              : "#fff",
          border: `2px solid ${isSelected ? "#475569" : occupied ? (hasValue ? "#FECACA" : "#FFD3C2") : "#E2E8F0"}`,
          borderRadius: 16, padding: "14px 10px", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 4, transition: "all 0.15s",
          boxShadow: isSelected
            ? "0 4px 20px rgba(28, 25, 23,0.35)"
            : occupied
              ? "0 2px 8px rgba(220,38,38,0.08)"
              : "0 1px 3px rgba(0,0,0,0.04)",
          minHeight: 120, position: "relative",
        }}
      >
        {/* Number */}
        <span className="mesa-cartao-numero" style={{
          fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px",
          color: isSelected ? "#fff" : occupied ? "#C92E09" : "#334155",
        }}>
          {table.label || table.number.toString().padStart(2, "0")}
        </span>

        {/* Status indicator */}
        <span style={{ fontSize: 18 }}>{occupied ? "🔴" : "🟢"}</span>

        {occupied ? (
          <>
            {nome && (
              <span className="mesa-cartao-nome" title={nome} style={{
                fontSize: 12.5, fontWeight: 800, lineHeight: 1.2,
                color: isSelected ? "#fff" : "#0F172A",
              }}>
                {nome}
              </span>
            )}
            <span className="mesa-cartao-valor" style={{
              fontSize: 14, fontWeight: 800,
              color: isSelected ? "#E7DDD3" : "#C92E09",
            }}>
              {fmt(table.openSession!.totalAmount)}
            </span>
            <span className="mesa-cartao-linha" style={{
              fontSize: 10, color: isSelected ? "#CBD5E1" : "#94A3B8",
              fontWeight: 600,
            }}>
              {table.openSession!.orderCount} ped. · {elapsed(table.openSession!.openedAt)}
              {useServiceFee && serviceFee > 0 ? ` · +${serviceFee}%` : ""}
            </span>
            {observacao && (
              <span className="mesa-cartao-obs" title={observacao} style={{
                fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                background: "#FEF3C7", color: "#92400E",
                border: "1px solid #FDE68A", borderRadius: 6, padding: "2px 6px",
              }}>
                {observacao}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 700, color: "#0F766E" }}>Livre</span>
        )}
      </button>
    );
  };
  const tituloDoGrupo = {
    gridColumn: "1 / -1", fontSize: 12, fontWeight: 800,
    letterSpacing: "0.06em", textTransform: "uppercase",
  } as const;

  // ─── GRID VIEW (main view) ────────────────────────────────────────────────
  return (
    <div className="mesa-tela" style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "linear-gradient(135deg, #F8FAFC 0%, #FAF6F2 100%)",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{ESTILO_TABLET}</style>

      {/* ── CAIXA FECHADO ──────────────────────────────────────────────────
          Faixa no topo, acima de tudo, e não um toast: com o caixa fechado
          NADA passa nesta tela — abrir mesa, lançar item, fechar conta e
          registrar pagamento estão todos barrados no servidor
          (lib/caixa-aberto.ts). O garçom precisa saber disso antes de ir até a
          mesa, não ao voltar com o pedido anotado.

          O garçom não tem a tela de caixa: por isso o texto manda AVISAR quem
          abre, em vez de mandar ele abrir. */}
      {caixaAberto === false && (
        <div style={{
          flexShrink: 0, padding: "10px 20px", background: "#B71C1C", color: "#fff",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 900, fontSize: "0.9rem" }}>O caixa está fechado</div>
            <div style={{ fontSize: "0.78rem", opacity: 0.95, lineHeight: 1.4 }}>
              Enquanto ele não abrir não dá para abrir mesa, lançar item, fechar conta nem registrar pagamento — o consumo não teria onde entrar no fechamento do dia.
              {ehGarcom ? " Avise quem abre o caixa na loja." : " Abra o caixa para liberar o salão."}
            </div>
          </div>
          {!ehGarcom && (
            <a href={CAMINHO_DO_CAIXA} style={{
              padding: "8px 14px", borderRadius: 10, background: "#fff", color: "#B71C1C",
              fontWeight: 800, fontSize: "0.82rem", textDecoration: "none", whiteSpace: "nowrap",
            }}>Abrir o caixa →</a>
          )}
        </div>
      )}

      {/* ─── Header ─── */}
      <header className="mesa-topo" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", background: "#fff",
        borderBottom: "1px solid #E2E8F0", flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!ehGarcom && (
            <button onClick={() => router.push("/store/pedidos-clientes")}
              title="Voltar para os pedidos" style={{
              background: "none", border: "1px solid #E2E8F0", borderRadius: 8,
              padding: "7px 10px", cursor: "pointer", fontSize: 13, color: "#64748B",
              flexShrink: 0, fontFamily: "inherit",
            }}>←<span className="mesa-voltar-texto"> Pedidos</span></button>
          )}
          <div className="mesa-topo-marca" style={{
            width: 36, height: 36, borderRadius: 10, background: "#475569",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 2px 8px rgba(28, 25, 23,0.2)",
          }}>🍽️</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: 0 }}>Mesas</h1>
            <div className="mesa-topo-numeros" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
              <span style={{ color: "#0F766E", fontWeight: 700 }}>🟢 {freeTables.length} livres</span>
              <span style={{ color: "#C92E09", fontWeight: 700 }}>🔴 {occupiedTables.length} ocupadas</span>
              {totalConsumo > 0 && <span style={{ color: "#B45309", fontWeight: 700 }}>{fmt(totalConsumo)} em consumo</span>}
            </div>
          </div>
        </div>
        {ehGarcom ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span title={garcom?.name} style={{
              display: "inline-block", maxWidth: 160,
              background: "#FAF6F2", color: "#334155", borderRadius: 999,
              padding: "6px 12px", fontWeight: 700, fontSize: 13,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>👤 {garcom?.name}</span>
            <button onClick={sairDoGarcom} style={{
              background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0", borderRadius: 10,
              padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>Sair</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowNewTableModal(true)} style={{
              background: "#475569", color: "#fff", border: "none", borderRadius: 10,
              padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(28, 25, 23,0.25)",
            }}>+ Nova Mesa</button>
            <button onClick={() => setShowConfigModal(true)} style={{
              background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0", borderRadius: 10,
              padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>⚙️</button>
          </div>
        )}
      </header>

      {/* ─── Content ─── */}
      <div className="mesa-conteudo" style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ─── Table Grid ─── */}
        <div className="mesa-mapa" style={{
          flex: 1, overflowY: "auto", padding: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(clamp(112px, 22vw, 145px), 1fr))",
          gap: 12, alignContent: "start",
        }}>
          {tables.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 60 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🍽️</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#334155", marginBottom: 8 }}>Nenhuma mesa cadastrada</h2>
              {ehGarcom ? (
                <p style={{ color: "#64748B", marginBottom: 20 }}>Peça ao gerente para cadastrar as mesas no painel.</p>
              ) : (
                <>
                  <p style={{ color: "#64748B", marginBottom: 20 }}>Comece criando suas mesas</p>
                  <button onClick={() => {
                    (async () => {
                      for (let i = 1; i <= 10; i++) {
                        await chamar("/api/store/tables", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ number: i }),
                        });
                      }
                      showToast("✅ 10 mesas criadas!");
                      fetchTables();
                    })();
                  }} style={{
                    background: "#475569", color: "#fff", border: "none", borderRadius: 12,
                    padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(28, 25, 23,0.3)",
                  }}>Criar 10 mesas padrão</button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Liga e desliga; cada aparelho lembra a sua escolha. */}
              <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={trocarOcupadasNoTopo} aria-pressed={ocupadasNoTopo}
                  className="mesa-chip"
                  title={ocupadasNoTopo ? "Voltar para a ordem de número" : "Mostrar as mesas ocupadas primeiro"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: 999, cursor: "pointer",
                    fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                    background: ocupadasNoTopo ? "#334155" : "#fff",
                    color: ocupadasNoTopo ? "#fff" : "#475569",
                    border: `1.5px solid ${ocupadasNoTopo ? "#334155" : "#E2E8F0"}`,
                  }}>
                  ⬆ Ocupadas no topo{ocupadasNoTopo ? " ✓" : ""}
                </button>
              </div>
              {ocupadasNoTopo ? (
                <>
                  {occupiedTables.length > 0 && (
                    <div style={{ ...tituloDoGrupo, color: "#C92E09" }}>Ocupadas · {occupiedTables.length}</div>
                  )}
                  {occupiedTables.map(cartaoDaMesa)}
                  {freeTables.length > 0 && (
                    <div style={{ ...tituloDoGrupo, color: "#0F766E", marginTop: occupiedTables.length > 0 ? 8 : 0 }}>
                      Livres · {freeTables.length}
                    </div>
                  )}
                  {freeTables.map(cartaoDaMesa)}
                </>
              ) : (
                tables.map(cartaoDaMesa)
              )}
            </>
          )}
        </div>

        {/* ─── Side Panel ─── */}
        {selectedTable && selectedTable.openSession && (
          <>
          {/* A cortina so existe no celular (CSS): e o toque fora que fecha a
              gaveta, que e como o garcom espera sair dela. */}
          <div className="mesa-cortina" onClick={() => { setSelectedTable(null); setSessionDetail(null); }} />
          <div className="mesa-detalhe" style={{
            borderLeft: "1px solid #E2E8F0", background: "#fff",
            display: "flex", flexDirection: "column", flexShrink: 0,
            boxShadow: "-4px 0 20px rgba(0,0,0,0.04)",
          }}>
            {/* Panel Header */}
            <div style={{
              padding: "14px 18px", background: "linear-gradient(135deg, #475569, #334155)",
              color: "#fff",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>
                    Mesa {selectedTable.number}
                    {selectedTable.label ? ` — ${selectedTable.label}` : ""}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                    ⏱ {elapsed(selectedTable.openSession.openedAt)}
                    {selectedTable.openSession.waiterName && ` · 👤 ${selectedTable.openSession.waiterName}`}
                    {selectedTable.openSession.customerName && ` · ${selectedTable.openSession.customerName}`}
                  </div>
                  {/* A observação inteira: no cartão ela pode sair cortada. */}
                  {selectedTable.openSession.notes && (
                    <div style={{
                      marginTop: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.3,
                      background: "#FEF3C7", color: "#92400E", borderRadius: 6,
                      padding: "4px 8px", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
                    }}>📝 {selectedTable.openSession.notes}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {!ehGarcom && (
                    <button onClick={() => {
                      setEditNumber(selectedTable.number.toString());
                      setEditLabel(selectedTable.label || "");
                      setShowEditModal(selectedTable);
                    }} style={{
                      background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                      color: "#fff", width: 32, height: 32, fontSize: 14, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>✏️</button>
                  )}
                  <button onClick={() => { setSelectedTable(null); setSessionDetail(null); }} style={{
                    background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8,
                    color: "#fff", width: 32, height: 32, fontSize: 18, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>✕</button>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
              padding: "10px 18px", borderBottom: "1px solid #E2E8F0",
            }}>
              <button onClick={() => { fetchMenu(); setView("order"); }} style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#0F766E", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(15, 118, 110,0.2)",
              }}>+ Novo Pedido</button>
              <button onClick={abrirFechamento} style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#C92E09", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(220,38,38,0.2)",
              }}>💰 Fechar Conta</button>
              {/* Lado a lado: no celular o painel tem 46vh e cada linha de botão
                  custa 44px; três linhas cheias empurravam o Total para fora. */}
              <button onClick={() => imprimirConta(taxaSugeridaDaMesa(selectedTable))} disabled={imprimindoConta}
                title={`Imprime a comanda da mesa com a taxa de serviço de ${taxaSugeridaDaMesa(selectedTable)}%`} style={{
                padding: "10px 4px", borderRadius: 10, border: "1.5px solid #CBD5E1",
                background: "#F8FAFC", color: "#334155", fontWeight: 800, fontSize: 13,
                cursor: "pointer", opacity: imprimindoConta ? 0.6 : 1,
              }}>{imprimindoConta ? "Enviando..." : "🧾 Imprimir comanda"}</button>
              <button onClick={() => setShowTransferModal(selectedTable)} disabled={freeTables.length === 0}
                title={freeTables.length === 0 ? "Nenhuma mesa livre para receber esta conta" : "Levar esta conta inteira para outra mesa"} style={{
                padding: "10px 4px", borderRadius: 10, border: "1.5px solid #E2E8F0",
                background: "#F8FAFC", color: "#475569", fontWeight: 800, fontSize: 13,
                cursor: freeTables.length === 0 ? "not-allowed" : "pointer",
                opacity: freeTables.length === 0 ? 0.5 : 1,
              }}>↔️ Mudar de mesa</button>
              {(selectedTable.openSession.totalAmount === 0) && (
                <button onClick={() => setShowFreeConfirm(true)} style={{
                  padding: "10px 0", borderRadius: 10, border: "1.5px solid #B45309",
                  background: "#FFF7E6", color: "#B45309", fontWeight: 800, fontSize: 13,
                  cursor: "pointer", gridColumn: "1 / -1",
                }}>🔓 Liberar Mesa</button>
              )}
            </div>

            {/* ─── PESSOAS NA MESA ───────────────────────────────────────── */}
            <div style={{ padding: "10px 18px", borderBottom: "1px solid #E2E8F0" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8,
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1 }}>
                  Pessoas ({pessoas.length})
                </span>
                {pessoas.length === 0 && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {[2, 3, 4].map(n => (
                      <button key={n} onClick={() => adicionarPessoas(n)} className="mesa-chip" style={{
                        padding: "4px 10px", borderRadius: 8, border: "1px solid #E2E8F0",
                        background: "#F8FAFC", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>{n}p</button>
                    ))}
                  </div>
                )}
              </div>

              {pessoas.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.4 }}>
                  Cadastre quem está na mesa para separar o que cada um pediu e
                  rachar a conta certinho no fim.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {pessoas.map(pes => (
                    <div key={pes.id} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 8px 5px 10px", borderRadius: 20,
                      background: "#F8FAFC", border: "1px solid #E2E8F0",
                    }}>
                      {renomeando?.id === pes.id ? (
                        <input
                          autoFocus
                          value={renomeando.nome}
                          onChange={e => setRenomeando({ id: pes.id, nome: e.target.value })}
                          onBlur={() => renomearPessoa(pes.id, renomeando.nome)}
                          onKeyDown={e => {
                            if (e.key === "Enter") renomearPessoa(pes.id, renomeando.nome);
                            if (e.key === "Escape") setRenomeando(null);
                          }}
                          style={{
                            width: 90, border: "none", background: "transparent", outline: "none",
                            fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                          }}
                        />
                      ) : (
                        <span onClick={() => setAcaoPessoa({ id: pes.id, nome: pes.name })}
                          title="Tocar para lançar itens ou receber o pagamento"
                          style={{ fontSize: 12, fontWeight: 700, color: "#334155", cursor: "pointer" }}>
                          {pes.name}
                          {pes.total > 0 && (
                            <span style={{ color: "#475569", marginLeft: 6 }}>{fmt(pes.total)}</span>
                          )}
                        </span>
                      )}
                      <button onClick={() => removerPessoa(pes.id)} title="Remover da mesa" style={{
                        border: "none", background: "none", color: "#CBD5E1",
                        cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px",
                      }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => adicionarPessoas(1)} className="mesa-chip" style={{
                    padding: "5px 12px", borderRadius: 20, border: "1.5px dashed #94A3B8",
                    background: "#fff", color: "#475569", fontSize: 12, fontWeight: 800, cursor: "pointer",
                  }}>+</button>
                </div>
              )}

              {pessoas.length > 0 && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input
                    placeholder="Nome (ex: João)"
                    value={novaPessoa}
                    onChange={e => setNovaPessoa(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && novaPessoa.trim()) adicionarPessoas(undefined, novaPessoa.trim()); }}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0",
                      fontSize: 12, fontFamily: "inherit", outline: "none",
                    }}
                  />
                  <button
                    onClick={() => novaPessoa.trim() && adicionarPessoas(undefined, novaPessoa.trim())}
                    disabled={!novaPessoa.trim()}
                    style={{
                      padding: "6px 12px", borderRadius: 8, border: "none", background: "#475569",
                      color: "#fff", fontSize: 12, fontWeight: 700,
                      cursor: novaPessoa.trim() ? "pointer" : "default", opacity: novaPessoa.trim() ? 1 : 0.4,
                    }}>Add</button>
                </div>
              )}
            </div>

            {/* Orders */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Pedidos da mesa
              </div>
              {sessionDetail?.orders && sessionDetail.orders.length > 0 ? (
                sessionDetail.orders.map((order, i) => {
                  // Cancelado fica visível — riscado — em vez de sumir: quem
                  // olha a comanda precisa ver que o pedido existiu e foi
                  // cancelado, não se perguntar para onde ele foi.
                  const cancelado = order.status === "CANCELADO" || order.status === "CANCELED" || order.status === "CANCELLED";
                  return (
                  <div key={order.id} style={{
                    padding: "10px 12px", marginBottom: 6, borderRadius: 10,
                    background: cancelado ? "#FEF2F2" : "#F8FAFC",
                    border: cancelado ? "1px solid #FECACA" : "1px solid #F1F5F9",
                    opacity: cancelado ? 0.75 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: cancelado ? "#B71C1C" : "#334155", textDecoration: cancelado ? "line-through" : "none" }}>
                        Pedido #{order.dailyOrderNumber || "—"}{cancelado ? " (cancelado)" : ""}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 13, color: cancelado ? "#B71C1C" : "#475569", textDecoration: cancelado ? "line-through" : "none" }}>
                          {fmt(order.totalAmount)}
                        </span>
                        {!cancelado && (
                          <button
                            onClick={() => cancelarPedidoMesa(order.id, order.dailyOrderNumber || "—")}
                            disabled={!!editandoItem}
                            title="Cancelar este pedido inteiro (devolve o estoque)"
                            style={{
                              border: "1px solid #FECACA", background: "#fff", color: "#C92E09",
                              borderRadius: 7, padding: "2px 8px", fontSize: 11, fontWeight: 800,
                              cursor: editandoItem ? "wait" : "pointer",
                            }}
                          >Cancelar</button>
                        )}
                      </span>
                    </div>
                    {order.items.map((item, j) => {
                      // Pedido lançado antes de existir gente cadastrada na mesa
                      // não tem dono, e é isso mesmo: ele é da mesa toda.
                      const dono = item.tableGuestId
                        ? pessoas.find(p => p.id === item.tableGuestId)
                        : null;
                      const travado = editandoItem === item.id;
                      return (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748B", paddingLeft: 4, marginBottom: 2, textDecoration: cancelado ? "line-through" : "none" }}>
                          {/* Quantidade EDITÁVEL: − / número / +. O total do
                              pedido é recalculado no servidor, nunca aqui. */}
                          {/* Quantidade: um TOQUE abre o editor, que só grava ao
                              confirmar. Antes eram botões −/+ de 20px que gravavam
                              no servidor a cada toque: na Pastel da Paulista o
                              garçom já tinha 3 lançados, tocou "+" três vezes
                              achando que estava marcando 3, e a mesa virou 6. */}
                          {!cancelado ? (
                            <button
                              onClick={() => setEditorQtd({
                                orderId: order.id, itemId: item.id, nome: item.menuProduct.name,
                                atual: item.quantity, novo: item.quantity, preco: item.price,
                                ultimoDoPedido: order.items.length === 1,
                              })}
                              disabled={!!editandoItem}
                              title="Alterar a quantidade"
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                                minHeight: 30, padding: "0 10px", borderRadius: 8,
                                border: "1px solid #E7DDD3", background: travado ? "#F1F5F9" : "#FAF6F2",
                                color: travado ? "#94A3B8" : "#3730A3", fontWeight: 900, fontSize: 13,
                                cursor: editandoItem ? "wait" : "pointer",
                              }}
                            >{item.quantity}x <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>✎</span></button>
                          ) : (
                            <span style={{ fontWeight: 800, flexShrink: 0 }}>{item.quantity}x</span>
                          )}
                          <span style={{ minWidth: 0 }}>
                            {item.menuProduct.name} — {fmt(item.price * item.quantity)}
                            {/* As escolhas do combo, com quantidade. Na Pastel da
                                Paulista "2 pastéis tradicionais" é UM item com
                                "Tradicional ×2" dentro: a tela dizia "1x" e o
                                garçom lia um pastel onde havia dois. */}
                            {(() => {
                              const escolhas = parseComboSelections(item.comboSelections, 1);
                              if (escolhas.length === 0) return null;
                              return (
                                <span style={{ display: "block", fontSize: 11, color: "#475569", fontWeight: 700, marginTop: 1 }}>
                                  {escolhas.map((e) => (e.quantity > 1 ? `${e.quantity}x ${e.name}` : e.name)).join(" · ")}
                                </span>
                              );
                            })()}
                            {/* O garçom confere depois de enviar que o "sem
                                leite" foi junto. */}
                            {item.notes && (
                              <span style={{ display: "block", fontSize: 11, color: "#B45309", fontWeight: 800, marginTop: 1 }}>
                                📝 {item.notes}
                              </span>
                            )}
                            <span style={{
                              marginLeft: 6, fontSize: 11, fontWeight: 700,
                              color: item.tableGuestId ? "#1C1917" : "#94A3B8",
                            }}>
                              {item.tableGuestId ? `👤 ${dono?.name || "cliente"}` : "🍽️ mesa"}
                            </span>
                          </span>
                          {!cancelado && (
                            <button
                              onClick={() => removerItemPedido(order.id, item.id, item.menuProduct.name, order.items.length === 1)}
                              disabled={!!editandoItem}
                              title="Remover este item"
                              style={{ marginLeft: "auto", border: "none", background: "none", color: "#C92E09", cursor: editandoItem ? "wait" : "pointer", fontSize: 13, flexShrink: 0, padding: "0 2px" }}
                            >🗑️</button>
                          )}
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 4 }}>
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  );
                })
              ) : (
                <div style={{ textAlign: "center", padding: 30, color: "#CBD5E1" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 13 }}>Nenhum pedido ainda</div>
                  <div style={{ fontSize: 12 }}>Toque em &quot;+ Novo Pedido&quot;</div>
                </div>
              )}
            </div>

            {/* Editor de quantidade (item já lançado). Botões grandes, número
                digitável, prévia do valor e UM Confirmar — nada grava antes. */}
            {editorQtd && (
              <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
                onClick={() => setEditorQtd(null)}>
                <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", background: "#fff", borderRadius: "16px 16px 0 0", padding: "16px 18px 18px", boxShadow: "0 -10px 30px rgba(0,0,0,0.2)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.4 }}>Quantidade</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#1E293B", marginTop: 2 }}>{editorQtd.nome}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 12 }}>Lançado: {editorQtd.atual}x · {fmt(editorQtd.preco)} cada</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
                    <button onClick={() => setEditorQtd({ ...editorQtd, novo: Math.max(0, editorQtd.novo - 1) })}
                      style={{ width: 52, height: 52, borderRadius: 14, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 26, fontWeight: 800, color: "#C92E09", cursor: "pointer" }}>−</button>
                    <input
                      type="number" inputMode="numeric" min={0} max={99} value={editorQtd.novo}
                      onChange={(e) => setEditorQtd({ ...editorQtd, novo: Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))) })}
                      onFocus={(e) => e.target.select()}
                      style={{ width: 84, height: 56, textAlign: "center", fontSize: 28, fontWeight: 900, color: "#1E293B", border: "2px solid #475569", borderRadius: 14, outline: "none" }}
                    />
                    <button onClick={() => setEditorQtd({ ...editorQtd, novo: Math.min(99, editorQtd.novo + 1) })}
                      style={{ width: 52, height: 52, borderRadius: 14, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 26, fontWeight: 800, color: "#0F766E", cursor: "pointer" }}>+</button>
                  </div>
                  <div style={{ textAlign: "center", marginTop: 10, fontSize: 13, color: editorQtd.novo === 0 ? "#C92E09" : "#475569", fontWeight: 700 }}>
                    {editorQtd.novo === 0
                      ? (editorQtd.ultimoDoPedido ? "Zero remove o item e CANCELA o pedido inteiro" : "Zero remove o item deste pedido")
                      : editorQtd.novo === editorQtd.atual
                        ? "Sem alteração"
                        : `Fica ${editorQtd.novo}x = ${fmt(editorQtd.preco * editorQtd.novo)} (antes ${fmt(editorQtd.preco * editorQtd.atual)})`}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button onClick={() => setEditorQtd(null)} style={{ flex: 1, height: 46, borderRadius: 12, border: "1px solid #E2E8F0", background: "#fff", fontWeight: 800, fontSize: 14, color: "#475569", cursor: "pointer" }}>Cancelar</button>
                    <button
                      disabled={editorQtd.novo === editorQtd.atual || !!editandoItem}
                      onClick={async () => {
                        const e = editorQtd; setEditorQtd(null);
                        if (e.novo === 0) removerItemPedido(e.orderId, e.itemId, e.nome, e.ultimoDoPedido);
                        else editarQtdItem(e.orderId, e.itemId, e.novo, e.nome, e.atual);
                      }}
                      style={{ flex: 2, height: 46, borderRadius: 12, border: "none", background: editorQtd.novo === editorQtd.atual ? "#CBD5E1" : (editorQtd.novo === 0 ? "#C92E09" : "#475569"), color: "#fff", fontWeight: 900, fontSize: 14, cursor: editorQtd.novo === editorQtd.atual ? "default" : "pointer" }}
                    >{editorQtd.novo === 0 ? "Remover" : `Confirmar ${editorQtd.novo}x`}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Panel Footer - Total */}
            <div style={{
              padding: "14px 18px", borderTop: "2px solid #E2E8F0",
              background: "#FAFAFE",
            }}>
              {/* Consumo, taxa e total — na tela, não só no papel.
                  A mesa mostrava "Total 60,00" e a comanda saía 66,00 porque a
                  taxa de 10% só entrava no fechamento. O caixa cobrava um
                  número que a tela nunca tinha mostrado. Agora os três aparecem
                  aqui, e a taxa se muda ou se desmarca no mesmo lugar. */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#475569" }}>
                <span>Consumo</span>
                <span style={{ fontWeight: 700 }}>{fmt(sessionTotal)}</span>
              </div>
              {descontoNoPainel > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#9A3412", fontWeight: 700, marginTop: 4 }}>
                  <span>Desconto{desconto.motivo ? ` (${desconto.motivo})` : ""}</span>
                  <span>- {fmt(descontoNoPainel)}</span>
                </div>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#475569", marginTop: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useServiceFee}
                  onChange={e => setUseServiceFee(e.target.checked)}
                  style={{ accentColor: "#475569", width: 16, height: 16 }}
                />
                Taxa de serviço
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={serviceFee}
                  onChange={e => setServiceFee(Number(e.target.value))}
                  disabled={!useServiceFee}
                  style={{
                    width: 48, padding: "3px 6px", borderRadius: 6, border: "1px solid #E2E8F0",
                    textAlign: "center", fontFamily: "inherit", fontSize: 13,
                    background: useServiceFee ? "#fff" : "#F1F5F9",
                  }}
                />%
                <span style={{ marginLeft: "auto", fontWeight: 700, color: useServiceFee ? "#B45309" : "#94A3B8" }}>
                  {useServiceFee ? fmt(taxaNoPainel) : "sem taxa"}
                </span>
              </label>
              {!ehGarcom && useServiceFee && serviceFee !== taxaSalva && (
                <button
                  onClick={async () => {
                    const r = await chamar("/api/store/tables", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ taxaServicoPadrao: serviceFee }),
                    });
                    if (r.ok) {
                      setTaxaSalva(serviceFee);
                      taxaSalvaRef.current = serviceFee;
                      showToast(`✅ ${serviceFee}% virou a taxa padrão da loja`);
                    }
                  }}
                  style={{
                    marginTop: 6, width: "100%", padding: "6px", borderRadius: 8,
                    border: "1px dashed #475569", background: "#FAF6F2", color: "#475569",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Salvar {serviceFee}% como padrão da loja (hoje: {taxaSalva}%)
                </button>
              )}
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 20, fontWeight: 900, color: "#0F172A",
                marginTop: 8, paddingTop: 8, borderTop: "1px solid #E2E8F0",
              }}>
                <span>Total</span>
                <span style={{ color: "#475569" }}>
                  {fmt(consumoCobradoNoPainel + taxaNoPainel)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                {selectedTable.openSession.orderCount} pedido{selectedTable.openSession.orderCount !== 1 ? "s" : ""} · Aberta há {elapsed(selectedTable.openSession.openedAt)}
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      {/* ─── CONFIRM OPEN TABLE MODAL ─── */}
      {confirmOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenNotes(""); setOpenWaiterId(garcomFixo); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 420,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: "#FAF6F2",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, margin: "0 auto 12px",
              }}>🍽️</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Ocupar Mesa {confirmOpen.number}?</h3>
              <p style={{ color: "#64748B", fontSize: 14, margin: "6px 0 0" }}>
                {confirmOpen.label ? `"${confirmOpen.label}" · ` : ""}Capacidade: {confirmOpen.capacity} pessoas
              </p>
              {!ehGarcom && (
                <button onClick={() => {
                  setEditNumber(confirmOpen.number.toString());
                  setEditLabel(confirmOpen.label || "");
                  setShowEditModal(confirmOpen);
                  setConfirmOpen(null);
                }} style={{
                  marginTop: 8, background: "none", border: "none", color: "#475569",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", textDecoration: "underline",
                }}>✏️ Editar número/nome da mesa</button>
              )}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                Nome do cliente (opcional)
              </label>
              <input value={openCustomerName} onChange={e => setOpenCustomerName(e.target.value)}
                placeholder="Ex: João, Família Silva..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit",
                }} />
            </div>

            {/* O recado da mesa sai no cartão, à vista de quem passa pelo
                salão. Sem este campo, a loja escrevia "Emerson BD mesa 3" no
                nome. */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                Observação (opcional)
              </label>
              <input value={openNotes} onChange={e => setOpenNotes(e.target.value)}
                maxLength={120}
                placeholder="Ex: aniversário, cadeirinha de bebê, sem glúten..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 10,
                  border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit",
                }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              {ehGarcom ? (
                <>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                    Garçom
                  </label>
                  <div style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, boxSizing: "border-box",
                    border: "1.5px solid #E2E8F0", fontSize: 14, background: "#F8FAFC",
                    color: "#0F172A", fontWeight: 700,
                  }}>👤 {garcom?.name}</div>
                </>
              ) : (
                <>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                    Garçom (opcional)
                  </label>
                  <select value={openWaiterId} onChange={e => setOpenWaiterId(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10,
                      border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit",
                      background: "#fff", cursor: "pointer"
                    }}>
                    <option value="">Sem garçom</option>
                    {waiters.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                  <a href="/store/garcons" target="_blank" style={{ fontSize: 12, color: "#1C1917", textDecoration: "none", display: "inline-block", marginTop: 6, fontWeight: 600 }}>
                    + adicionar garçom
                  </a>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenNotes(""); setOpenWaiterId(garcomFixo); }}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancelar</button>
              <button onClick={openTable} disabled={actionLoading}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "#475569", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(28, 25, 23,0.3)",
                  opacity: actionLoading ? 0.6 : 1,
                }}>
                {actionLoading ? "Abrindo..." : "✅ Ocupar Mesa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── EDIT TABLE MODAL ─── */}
      {showEditModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setShowEditModal(null); setEditNumber(""); setEditLabel(""); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 400,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, background: "#FAF6F2",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, margin: "0 auto 10px",
              }}>✏️</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Editar Mesa {showEditModal.number}</h3>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Número da Mesa</label>
              <input value={editNumber} onChange={e => setEditNumber(e.target.value)} type="number"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Nome/Label (opcional)</label>
              <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                placeholder="Ex: Varanda, VIP, Terraço"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit" }} />
            </div>
            {/* Mesa ocupada: dá para mover o cliente daqui mesmo, sem precisar
                voltar ao painel dela. Só aparece quando há mesa livre. */}
            {showEditModal.openSession && (
              <div style={{ marginBottom: 16, padding: 14, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                  Esta mesa está ocupada
                </div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
                  {showEditModal.openSession.customerName ? `${showEditModal.openSession.customerName} · ` : ""}
                  {fmt(showEditModal.openSession.totalAmount || 0)} em consumo. A conta inteira vai junto; nada é relançado na cozinha.
                </p>
                <button
                  onClick={() => {
                    const origem = showEditModal;
                    setShowEditModal(null);
                    setEditNumber("");
                    setEditLabel("");
                    setShowTransferModal(origem);
                  }}
                  disabled={freeTables.filter(t => t.id !== showEditModal.id).length === 0}
                  title={freeTables.filter(t => t.id !== showEditModal.id).length === 0 ? "Nenhuma mesa livre" : "Mover o cliente para uma mesa livre"}
                  style={{
                    width: "100%", padding: "11px 0", borderRadius: 10,
                    border: "1.5px solid #CBD5E1", background: "#F8FAFC", color: "#334155",
                    fontWeight: 800, fontSize: 13, fontFamily: "inherit",
                    cursor: freeTables.filter(t => t.id !== showEditModal.id).length === 0 ? "not-allowed" : "pointer",
                    opacity: freeTables.filter(t => t.id !== showEditModal.id).length === 0 ? 0.5 : 1,
                  }}
                >
                  ↔️ Transferir cliente para outra mesa
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setShowEditModal(null); setEditNumber(""); setEditLabel(""); }}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancelar</button>
              <button onClick={updateTable} disabled={actionLoading}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "#475569", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(28, 25, 23,0.3)",
                  opacity: actionLoading ? 0.6 : 1,
                }}>
                {actionLoading ? "Salvando..." : "Salvar Alterações"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CLOSE ACCOUNT MODAL ─── */}
      {/* ─── FECHAR CONTA / RACHAR A CONTA ────────────────────────────────
          A mesa só fecha quando a soma dos pagamentos bate com o total. Cada
          linha registra quem pagou, como e quanto — é o que permite conferir
          o caixa depois e é o que o cliente cobra na hora ("eu paguei 40"). */}
      {showCloseModal && selectedTable?.openSession && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }} onClick={() => setShowCloseModal(false)}>
          <div onClick={e => e.stopPropagation()} className="mesa-modal-conta" style={{
            background: "#fff", borderRadius: 20, width: "100%", maxWidth: 560,
            maxHeight: "92vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid #F1F5F9" }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 20, textAlign: "center" }}>
                💰 Fechar Conta — Mesa {selectedTable.number}
              </h3>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>

              {/* ─── Resumo da conta ─── */}
              <div style={{ background: "#F8FAFC", borderRadius: 14, padding: 16, marginBottom: 16, border: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 8 }}>
                  <span>Consumo</span>
                  <span style={{ fontWeight: 700 }}>{fmt(consumoFechamento)}</span>
                </div>

                {/* ── DESCONTO DA MESA ──────────────────────────────────
                    Porcentagem ou valor, com motivo. Entra antes da taxa de
                    serviço e é rateado entre as pessoas na proporção do que
                    cada uma consumiu — é assim que a mesa entende "10% pra
                    gente". Sem motivo, vira furo de caixa sem explicação. */}
                {!mostrarDesconto && descontoDaMesa === 0 ? (
                  <button type="button" onClick={() => setMostrarDesconto(true)}
                    style={{ width: "100%", padding: "7px", borderRadius: 9, border: "1.5px dashed #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginBottom: 8 }}>
                    🏷️ Dar desconto
                  </button>
                ) : (
                  <div style={{ border: "1.5px solid #FFD3C2", background: "#FFFBF5", borderRadius: 11, padding: "9px 10px", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                      <b style={{ fontSize: 13, color: "#9A3412" }}>🏷️ Desconto</b>
                      <button type="button" onClick={() => { setDesconto(SEM_DESCONTO); setMostrarDesconto(false); }}
                        style={{ marginLeft: "auto", background: "none", border: "none", color: "#94A3B8", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                        remover
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
                      {([{ t: "percent" as const, r: "%" }, { t: "valor" as const, r: "R$" }]).map(op => (
                        <button key={op.t} type="button" onClick={() => setDesconto(d => ({ ...d, tipo: op.t }))}
                          style={{
                            padding: "7px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                            border: desconto.tipo === op.t ? "2px solid #9A3412" : "1.5px solid #E2E8F0",
                            background: desconto.tipo === op.t ? "#FFF4EF" : "#fff",
                            color: desconto.tipo === op.t ? "#9A3412" : "#64748B", fontWeight: 800, fontSize: 14,
                          }}>
                          {op.r}
                        </button>
                      ))}
                      <input type="number" min="0" step="0.5" inputMode="decimal"
                        placeholder={desconto.tipo === "percent" ? "10" : "5,00"}
                        value={desconto.valor === 0 ? "" : desconto.valor}
                        onChange={e => setDesconto(d => ({ ...d, valor: parseFloat(e.target.value) || 0 }))}
                        style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 9, border: "1.5px solid #FFD3C2", background: "#fff", fontSize: 15, fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit" }} />
                    </div>
                    <input placeholder="Por que o desconto? (sai na conta)"
                      value={desconto.motivo || ""}
                      onChange={e => setDesconto(d => ({ ...d, motivo: e.target.value.slice(0, 60) }))}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", fontFamily: "inherit", marginBottom: 6 }} />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {MOTIVOS_COMUNS.map(m => (
                        <button key={m} type="button" onClick={() => setDesconto(d => ({ ...d, motivo: m }))}
                          style={{ padding: "4px 9px", borderRadius: 999, border: "1px solid #E2E8F0", background: desconto.motivo === m ? "#FFF4EF" : "#fff", color: desconto.motivo === m ? "#9A3412" : "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          {m}
                        </button>
                      ))}
                    </div>
                    {desconto.valor > 0 && problemaDoDesconto(desconto, consumoFechamento) && (
                      <p style={{ margin: "7px 0 0", fontSize: 12, color: "#B71C1C", fontWeight: 700 }}>
                        {problemaDoDesconto(desconto, consumoFechamento)}
                      </p>
                    )}
                  </div>
                )}

                {descontoDaMesa > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 8, color: "#9A3412", fontWeight: 800 }}>
                    <span>Desconto{desconto.motivo ? ` (${desconto.motivo})` : ""}</span>
                    <span>- {fmt(descontoDaMesa)}</span>
                  </div>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={useServiceFee} onChange={e => setUseServiceFee(e.target.checked)} style={{ accentColor: "#475569", width: 18, height: 18 }} />
                  Taxa de serviço
                  <input type="number" value={serviceFee} onChange={e => setServiceFee(Number(e.target.value))}
                    style={{ width: 54, padding: "6px 8px", borderRadius: 6, border: "1px solid #E2E8F0", textAlign: "center", fontFamily: "inherit" }} />%
                  {useServiceFee && (
                    <span style={{ marginLeft: "auto", fontWeight: 700, color: "#B45309" }}>{fmt(taxaFechamento)}</span>
                  )}
                </label>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 8, cursor: "pointer", color: "#64748B" }}>
                  <span>Gorjeta extra (R$)</span>
                  <input type="number" min="0" step="0.5" value={waiterTip} onChange={e => setWaiterTip(Number(e.target.value))}
                    style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid #E2E8F0", textAlign: "right", fontFamily: "inherit" }} />
                </label>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 900, marginTop: 12, paddingTop: 12, borderTop: "2px solid #E2E8F0" }}>
                  <span>TOTAL</span>
                  <span style={{ color: "#475569" }}>{fmt(totalFechamento)}</span>
                </div>
              </div>

              {/* ─── Conta por pessoa ─── */}
              {conta && conta.pessoas.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <button onClick={() => setVerContaPorPessoa(v => !v)} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                    background: "none", border: "none", padding: "0 0 8px", cursor: "pointer", fontFamily: "inherit",
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#334155" }}>
                      🧾 Conta por pessoa ({conta.pessoas.length})
                    </span>
                    <span style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>
                      {verContaPorPessoa ? "ocultar" : "ver"}
                    </span>
                  </button>

                  {verContaPorPessoa && (
                    <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
                      {conta.pessoas.map((pes, i) => (
                        <div key={pes.id} style={{
                          padding: "10px 12px",
                          borderBottom: i < conta.pessoas.length - 1 ? "1px solid #F1F5F9" : "none",
                          background: "#fff",
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>👤 {pes.nome}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: "#475569" }}>{fmt(pes.aPagar)}</span>
                              <button
                                onClick={() => { setDonoPagamento(pes.id); setValorPagamento(paraCampo(faltaDaPessoa(pes))); }}
                                title="Registrar o pagamento desta pessoa"
                                className="mesa-chip"
                                style={{
                                  border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#475569",
                                  borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer",
                                }}>+ pagar</button>
                            </div>
                          </div>
                          {pes.itens.length > 0 ? (
                            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, lineHeight: 1.5 }}>
                              {pes.itens.map((it, j) => (
                                <div key={j}>{it.quantidade}x {it.nome} — {fmt(it.valor)}</div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: "#CBD5E1", marginTop: 4 }}>Nada lançado no nome desta pessoa</div>
                          )}
                          {(pes.parteDaMesa > 0 || pes.taxaEGorjeta > 0) && (
                            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                              {pes.parteDaMesa > 0 && `+ ${fmt(pes.parteDaMesa)} da mesa `}
                              {pes.taxaEGorjeta > 0 && `+ ${fmt(pes.taxaEGorjeta)} taxa/gorjeta`}
                            </div>
                          )}
                        </div>
                      ))}
                      {/* O que foi lançado para a mesa, item a item. Só o valor
                          não bastava: na hora de conferir, alguém sempre pergunta
                          "que R$ 32 são esses?" — e a resposta tem que estar na tela,
                          não na memória do garçom. */}
                      {conta.itensDaMesa.valor > 0 && (
                        <div style={{ padding: "10px 12px", background: "#F8FAFC", borderTop: "1px solid #F1F5F9" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>🍽️ Lançado para a mesa toda</span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#475569" }}>{fmt(conta.itensDaMesa.valor)}</span>
                          </div>
                          {conta.itensDaMesa.itens.length > 0 && (
                            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, lineHeight: 1.5 }}>
                              {conta.itensDaMesa.itens.map((it, j) => (
                                <div key={j}>{it.quantidade}x {it.nome} — {fmt(it.valor)}</div>
                              ))}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                            Dividido igualmente entre as {conta.pessoas.length} pessoas da mesa.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {carregandoConta && !conta && (
                <div style={{ textAlign: "center", padding: 16, fontSize: 13, color: "#94A3B8" }}>
                  Calculando a conta...
                </div>
              )}

              {/* ─── Pagamentos recebidos ────────────────────────────────
                  Uma baixa por vez, gravada na hora. O garçom recebe do
                  Douglas, registra, a mesa desce; recebe da Isabela, registra,
                  a mesa desce de novo; e fecha quando zerar. */}
              <div style={{ fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 8 }}>
                💳 Pagamentos recebidos
                {pagamentosDaMesa.length > 0 && (
                  <span style={{ marginLeft: 6, color: "#0F766E" }}>({fmt(totalRecebido)})</span>
                )}
              </div>

              {pagamentosDaMesa.length === 0 ? (
                <div style={{
                  textAlign: "center", padding: 14, borderRadius: 12, border: "1.5px dashed #E2E8F0",
                  color: "#94A3B8", fontSize: 13, marginBottom: 12,
                }}>
                  Nenhum pagamento registrado ainda.
                </div>
              ) : (
                <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                  {pagamentosDaMesa.map((p, i) => (
                    <div key={p.uid} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                      borderBottom: i < pagamentosDaMesa.length - 1 ? "1px solid #F1F5F9" : "none",
                      background: "#F0FDFA",
                    }}>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0F766E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.guestName ? `👤 ${p.guestName}` : "🍽️ Da mesa"}
                        </span>
                        {p.por && (
                          <span title={`Registrado por ${p.por}`} style={{ fontSize: 11, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            por {p.por}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, color: "#0F766E", fontWeight: 600 }}>{p.method}</span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#0F766E" }}>{fmt(p.amount)}</span>
                      <button
                        onClick={() => apagarPagamento(p.uid)}
                        title="Apagar este pagamento"
                        style={{
                          border: "none", background: "#FEF2F2", color: "#C92E09", borderRadius: 8,
                          width: 30, height: 30, fontSize: 13, cursor: "pointer", flexShrink: 0,
                        }}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              {faltaPagar > 0.01 && (
                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#475569", marginBottom: 8 }}>
                    Registrar pagamento — de quem?
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    <button
                      onClick={() => { setDonoPagamento(null); setValorPagamento(paraCampo(faltaPagar)); }}
                      className="mesa-chip"
                      style={{
                        padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 800,
                        border: donoPagamento === null ? "2px solid #475569" : "1px solid #E2E8F0",
                        background: donoPagamento === null ? "#F8FAFC" : "#fff",
                        color: donoPagamento === null ? "#334155" : "#475569",
                      }}>
                      🍽️ A mesa toda
                    </button>

                    {conta?.pessoas.map(pes => {
                      const restante = faltaDaPessoa(pes);
                      const quitada = restante <= 0.01;
                      const escolhida = donoPagamento === pes.id;
                      return (
                        <button
                          key={pes.id}
                          onClick={() => { setDonoPagamento(pes.id); setValorPagamento(paraCampo(restante)); }}
                          className="mesa-chip"
                          style={{
                            padding: "8px 12px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 800,
                            border: escolhida ? "2px solid #475569" : "1px solid #E2E8F0",
                            background: escolhida ? "#F8FAFC" : quitada ? "#F0FDFA" : "#fff",
                            color: escolhida ? "#334155" : quitada ? "#0F766E" : "#475569",
                          }}>
                          👤 {pes.nome} {quitada ? "✓ pago" : fmt(restante)}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <select
                      value={formaPagamento}
                      onChange={e => setFormaPagamento(e.target.value)}
                      style={{
                        flex: "1 1 110px", padding: "11px 8px", borderRadius: 10, border: "1px solid #E2E8F0",
                        fontSize: 13, fontFamily: "inherit", background: "#fff", cursor: "pointer",
                      }}>
                      {["Dinheiro", "Pix", "Débito", "Crédito", "Voucher"].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={valorPagamento}
                      placeholder="0,00"
                      onChange={e => setValorPagamento(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") registrarPagamento(); }}
                      style={{
                        flex: "1 1 100px", minWidth: 0, padding: "11px 10px", borderRadius: 10,
                        border: "1.5px solid #E2E8F0", fontSize: 15, fontWeight: 800, textAlign: "right",
                        fontFamily: "inherit", outline: "none",
                      }}
                    />
                    <button
                      onClick={registrarPagamento}
                      disabled={registrandoPagamento}
                      style={{
                        flex: "1 1 120px", padding: "12px 14px", borderRadius: 10, border: "none",
                        background: "#0F766E", color: "#fff", fontSize: 13, fontWeight: 900,
                        cursor: registrandoPagamento ? "default" : "pointer", fontFamily: "inherit",
                        opacity: registrandoPagamento ? 0.6 : 1,
                      }}>
                      {registrandoPagamento ? "Registrando..." : "Registrar"}
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, alignSelf: "center" }}>Atalhos:</span>
                    <button onClick={() => setValorPagamento(paraCampo(faltaPagar))} className="mesa-chip" style={{
                      padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff",
                      color: "#475569", fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}>tudo que falta ({fmt(faltaPagar)})</button>
                    {[2, 3, 4].map(n => (
                      <button key={n} onClick={() => setValorPagamento(paraCampo(Math.floor((faltaPagar * 100) / n) / 100))}
                        className="mesa-chip" style={{
                          padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff",
                          color: "#475569", fontSize: 11, fontWeight: 700, cursor: "pointer",
                        }}>÷{n}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ─── Rodapé: o placar do que falta ─── */}
            <div style={{
              padding: "14px 24px 20px", borderTop: "2px solid #F1F5F9",
              background: faltaPagar > 0.01 ? "#FFF7E6" : "#F0FDFA",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748B", marginBottom: 4 }}>
                <span>Total da conta</span>
                <span style={{ fontWeight: 700, color: "#334155" }}>{fmt(totalFechamento)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748B", marginBottom: 8 }}>
                <span>Recebido ({pagamentosDaMesa.length} pagamento{pagamentosDaMesa.length !== 1 ? "s" : ""})</span>
                <span style={{ fontWeight: 700, color: "#334155" }}>{fmt(totalRecebido)}</span>
              </div>

              {faltaPagar > 0.01 ? (
                <div style={{
                  display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900,
                  color: "#B45309", paddingTop: 8, borderTop: "1px solid #FDE68A", marginBottom: 12,
                }}>
                  <span>⚠️ Falta</span>
                  <span>{fmt(faltaPagar)}</span>
                </div>
              ) : (
                <div style={{
                  display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900,
                  color: "#0F766E", paddingTop: 8, borderTop: "1px solid #99F6E4", marginBottom: 12,
                }}>
                  <span>{troco > 0.01 ? "💵 Troco" : "✅ Conta fechada"}</span>
                  <span>{troco > 0.01 ? fmt(troco) : fmt(totalRecebido)}</span>
                </div>
              )}

              <button onClick={() => imprimirConta(useServiceFee ? serviceFee : 0, Number(waiterTip) || 0)}
                disabled={imprimindoConta} style={{
                width: "100%", background: "#fff", color: "#334155",
                border: "1.5px solid #CBD5E1", borderRadius: 12, padding: "12px 0", fontWeight: 800, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit", marginBottom: 8, opacity: imprimindoConta ? 0.6 : 1,
              }}>
                {imprimindoConta ? "Enviando conta..." : `🧾 Imprimir conta para o cliente${useServiceFee ? ` (taxa ${serviceFee}%)` : " (sem taxa)"}`}
              </button>
              <button onClick={closeSession} disabled={actionLoading || !podeFechar} style={{
                width: "100%", background: podeFechar ? "#C92E09" : "#CBD5E1", color: "#fff",
                border: "none", borderRadius: 12, padding: "16px 0", fontWeight: 800, fontSize: 16,
                cursor: podeFechar ? "pointer" : "not-allowed", fontFamily: "inherit",
                opacity: actionLoading ? 0.6 : 1,
                boxShadow: podeFechar ? "0 4px 12px rgba(220,38,38,0.25)" : "none",
              }}>
                {actionLoading
                  ? "Fechando..."
                  : podeFechar
                    ? "Fechar Conta e Liberar Mesa"
                    : `Faltam ${fmt(faltaPagar)} para fechar`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TRANSFER MODAL ─── */}
      {showTransferModal?.openSession && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }} onClick={() => setShowTransferModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 420,
            maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <h3 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 18, color: "#0F172A" }}>
              ↔️ Mudar a Mesa {showTransferModal.number} para…
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748B" }}>
              <b style={{ color: "#0F172A" }}>Toque na mesa que vai receber esta conta.</b> Vai tudo junto: pedidos, pessoas e pagamentos. Nada é relançado na cozinha.
            </p>
            {freeTables.filter(t => t.id !== showTransferModal.id).length === 0 ? (
              <p style={{ color: "#B45309", fontWeight: 700, fontSize: 14 }}>Nenhuma mesa livre no momento.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {freeTables.filter(t => t.id !== showTransferModal.id).map(t => (
                  <button key={t.id} disabled={actionLoading} onClick={() => {
                    // Um toque errado levava a conta inteira para a mesa errada,
                    // sem volta pela tela. Confirmar custa um toque e evita isso.
                    const valor = fmt(showTransferModal.openSession?.totalAmount || 0);
                    if (confirm(`Levar a conta da Mesa ${showTransferModal.number} (${valor}) para a Mesa ${t.number}?`)) transferTable(t.id);
                  }} style={{
                    padding: "14px 6px", borderRadius: 12, border: "2px solid #E2E8F0", background: "#fff",
                    fontWeight: 800, fontSize: 15, color: "#0F172A", cursor: "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}>
                    Mesa {t.number}
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#0F766E", marginTop: 2 }}>{t.label || "livre"}</div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowTransferModal(null)} style={{
              marginTop: 16, width: "100%", padding: "12px 0", borderRadius: 12,
              border: "1.5px solid #E2E8F0", background: "#F8FAFC", color: "#64748B",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ─── NEW TABLE MODAL ─── */}
      {showNewTableModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowNewTableModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 400,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, background: "#FAF6F2",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, margin: "0 auto 10px",
              }}>➕</div>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Nova Mesa</h3>
            </div>
            <input placeholder="Número (auto se vazio)" value={newTableNumber} onChange={e => setNewTableNumber(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 10, fontFamily: "inherit" }} />
            <input placeholder="Nome/Label (ex: Varanda 1)" value={newTableLabel} onChange={e => setNewTableLabel(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: 14, marginBottom: 16, fontFamily: "inherit" }} />
            <button onClick={createTable} disabled={actionLoading} style={{
              width: "100%", background: "#475569", color: "#fff", border: "none", borderRadius: 12,
              padding: "12px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
              opacity: actionLoading ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(28, 25, 23,0.3)",
            }}>
              {actionLoading ? "Criando..." : "Criar Mesa"}
            </button>
          </div>
        </div>
      )}

      {/* ─── CONFIG MODAL ─── */}
      {showConfigModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowConfigModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 500,
            maxHeight: "80vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontWeight: 800 }}>⚙️ Gerenciar Mesas</h3>
              <button onClick={() => setShowConfigModal(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
              {tables.map(table => (
                <div key={table.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: "1px solid #F1F5F9",
                }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>Mesa {table.number}</span>
                    {table.label && <span style={{ color: "#94A3B8", fontSize: 13, marginLeft: 8 }}>({table.label})</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => {
                      setEditNumber(table.number.toString());
                      setEditLabel(table.label || "");
                      setShowEditModal(table);
                      setShowConfigModal(false);
                    }} style={{
                      padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0",
                      background: "#F8FAFC", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>✏️ Editar</button>
                    {table.openSession ? (
                      <span style={{ fontSize: 12, color: "#B45309", fontWeight: 700 }}>🔴 Ocupada</span>
                    ) : (
                      <button onClick={() => deleteTable(table.id)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA",
                        background: "#FEF2F2", color: "#C92E09", fontSize: 12, fontWeight: 700, cursor: "pointer",
                      }}>Remover</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── FREE TABLE CONFIRM MODAL ─── */}
      {showFreeConfirm && selectedTable && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowFreeConfirm(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 400,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", textAlign: "center",
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: "#FFF7E6",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, margin: "0 auto 14px",
            }}>🔓</div>
            <h3 style={{ margin: "0 0 8px", fontWeight: 800, fontSize: 20 }}>
              Liberar Mesa {selectedTable.number}?
            </h3>
            <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 20px", lineHeight: 1.5 }}>
              A mesa será liberada e ficará disponível para novos clientes.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowFreeConfirm(false)} style={{
                flex: 1, padding: "12px 0", borderRadius: 12,
                border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}>Cancelar</button>
              <button onClick={freeTable} disabled={actionLoading} style={{
                flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                background: "#B45309", color: "#fff", fontWeight: 800, fontSize: 14,
                cursor: "pointer", boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
                opacity: actionLoading ? 0.6 : 1,
              }}>
                {actionLoading ? "Liberando..." : "Sim, Liberar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ─── */}
      {/* ─── O QUE FAZER COM ESTA PESSOA ──────────────────────────────────
          Dava para cadastrar quem estava na mesa e escrever o nome, e o nome
          não levava a lugar nenhum: tocar nele só renomeava. A pessoa existia
          na tela sem servir para nada. Agora o toque abre o que o garçom
          realmente quer fazer com ela — lançar no nome dela, ou receber. */}
      {acaoPessoa && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100,
          display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12,
        }} onClick={() => setAcaoPessoa(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "100%", maxWidth: 460,
            padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ textAlign: "center", paddingBottom: 8, borderBottom: "1px solid #F1F5F9", marginBottom: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: "#1E293B" }}>👤 {acaoPessoa.nome}</div>
              <div style={{ fontSize: 12, color: "#94A3B8" }}>
                Mesa {selectedTable?.number}
                {(() => {
                  const p = pessoas.find(x => x.id === acaoPessoa.id);
                  return p && p.total > 0 ? ` · consumiu ${fmt(p.total)}` : " · ainda não pediu nada";
                })()}
              </div>
            </div>

            <button
              onClick={() => {
                setPessoaAtiva(acaoPessoa.id);
                setAcaoPessoa(null);
                fetchMenu();
                setView("order");
              }}
              style={{
                padding: "15px 16px", borderRadius: 12, border: "none", background: "#475569",
                color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer",
                fontFamily: "inherit", textAlign: "left",
              }}>
              🍽️ Lançar itens para {acaoPessoa.nome}
            </button>

            <button
              onClick={() => {
                setDonoPagamento(acaoPessoa.id);
                setAcaoPessoa(null);
                abrirFechamento();
              }}
              style={{
                padding: "15px 16px", borderRadius: 12, border: "1.5px solid #0F766E",
                background: "#F0FDFA", color: "#0F766E", fontSize: 15, fontWeight: 800,
                cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}>
              💵 Receber o pagamento de {acaoPessoa.nome}
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setRenomeando({ id: acaoPessoa.id, nome: acaoPessoa.nome }); setAcaoPessoa(null); }}
                style={{
                  flex: 1, padding: "13px 12px", borderRadius: 12, border: "1px solid #E2E8F0",
                  background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                ✏️ Renomear
              </button>
              <button
                onClick={() => { removerPessoa(acaoPessoa.id); setAcaoPessoa(null); }}
                style={{
                  flex: 1, padding: "13px 12px", borderRadius: 12, border: "1px solid #FECACA",
                  background: "#FEF2F2", color: "#C92E09", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                🚪 Tirar da mesa
              </button>
            </div>

            <button
              onClick={() => setAcaoPessoa(null)}
              style={{
                padding: "13px 12px", borderRadius: 12, border: "none", background: "#F1F5F9",
                color: "#64748B", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "#1E293B", color: "#fff", padding: "12px 24px", borderRadius: 12,
          fontWeight: 700, fontSize: 14, zIndex: 2000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          animation: "fadeIn 0.2s",
        }}>
          {toast}
        </div>
      )}

      {modalDeCombo}
    </div>
  );
}
