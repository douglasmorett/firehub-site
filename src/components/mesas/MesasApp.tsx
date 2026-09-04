"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import ComboModal from "@/components/customer/ComboModal";
import { precoMinimoDoProduto, precoVariaPorEscolha } from "@/lib/preco-combo";
import { idsSoDeOpcaoDeCombo } from "@/lib/cardapio-interno";
import type { PagamentoDaMesa } from "@/lib/pagamentos-da-mesa";
import { printOrder } from "@/lib/print";
import { impressoraAtendeModulo } from "@/lib/modulo-do-pedido";

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
    quantity: number;
    price: number;
    menuProduct: { name: string };
    /** Quem, na mesa, pediu este item. Nulo = lançado para a mesa toda. */
    tableGuestId?: string | null;
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
    .mesa-detalhe {
      width: 100% !important;
      border-left: none !important;
      border-top: 2px solid #E2E8F0;
      max-height: 46vh;
    }
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
  .mesa-quem-pede::-webkit-scrollbar-thumb { background: #DDD6FE; border-radius: 4px; }

  /* Uma linha de pagamento por vez em tela estreita: nome, forma e valor lado
     a lado viram três campos de 60px, impossíveis de acertar com o dedo. */
  @media (max-width: 520px) {
    .mesa-pagador { flex-wrap: wrap; }
    .mesa-pagador input:first-child { flex: 1 1 100% !important; }
  }

  /* 44px é o alvo de toque recomendado. Num tablet de garçom, errar o botão
     significa lançar o item errado na comanda de um cliente. */
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
      try {
        const me = await fetch("/api/garcom/me", { cache: "no-store" });
        const d = await me.json().catch(() => ({}));
        if (!me.ok && typeof d?.codigo === "string") motivo = d.codigo;
      } catch { /* fica o genérico */ }
      window.location.assign(`/garcom/${encodeURIComponent(slug)}?motivo=${encodeURIComponent(motivo)}`);
    }
    return res;
  };

  // Data
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuCategories, setMenuCategories] = useState<string[]>([]);

  // UI State
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [view, setView] = useState<"grid" | "order">("grid"); // grid=mapa, order=fazendo pedido
  const [toast, setToast] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [tick, setTick] = useState(0);

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
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<TableItem | null>(null);
  const [editNumber, setEditNumber] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [showFreeConfirm, setShowFreeConfirm] = useState(false);
  const [imprimindoConta, setImprimindoConta] = useState(false);

  // Open table form
  const [openCustomerName, setOpenCustomerName] = useState("");
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
  const [serviceFee, setServiceFee] = useState(10);
  const [useServiceFee, setUseServiceFee] = useState(true);
  const [waiterTip, setWaiterTip] = useState(0);

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
          const isIntegration = (p: any) => {
            if (p.id?.startsWith("ifood-") || p.id?.startsWith("jotaja-") || p.id?.startsWith("99food-")) return true;
            return HIDDEN_CATS.has((p.category || "").toUpperCase().trim());
          };

          // Adicionais e sabores são MenuProduct de R$ 0,00 que existem só para
          // preencher a pergunta do combo. Viravam card no cardápio do garçom.
          const soOpcaoDeCombo = idsSoDeOpcaoDeCombo(data);

          const items = data
            .filter((p: any) => p.active !== false && !isIntegration(p))
            // O cadastro tem um interruptor por canal e esta tela era a única
            // que ignorava o dela: o que a loja desligava para a mesa continuava
            // aparecendo aqui. Balcão já olha activePDV, totem já olha activeTotem.
            .filter((p: any) => p.activeGarcom !== false)
            .filter((p: any) => !soOpcaoDeCombo.has(p.id))
            .map((p: any) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              category: p.isCombo ? "Combos" : (p.category || "Outros"),
              isCombo: p.isCombo,
              imageUrl: p.imageUrl || null,
              comboGroups: p.comboGroups,
              comboConfig: p.comboConfig
            }));
          setMenuItems(items);
          const cats = ["Todos", ...Array.from(new Set(items.map((i: MenuItem) => i.category || "Outros")))];
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
      const res = await chamar(`/api/store/table-sessions/${sessionId}/conta?taxa=${taxa}&gorjeta=${gorjeta}`);
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
          waiterId: waiterIdEscolhido,
          waiterName: selectedWaiter ? selectedWaiter.name : ""
        })
      });
      if (res.ok) {
        showToast(`✅ Mesa ${confirmOpen.number} ocupada!`);
        setConfirmOpen(null);
        setOpenCustomerName("");
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
   * Garçons). Sem garçom vinculado, ou sem comissão, 10% — o que a casa
   * costuma cobrar. O gerente pode mudar no modal; aqui é só o ponto de
   * partida, para não ter que lembrar de cabeça a taxa de cada garçom.
   */
  const taxaSugeridaDaMesa = (t: TableItem | null): number => {
    const padrao = 10;
    if (ehGarcom && garcom?.commissionRate != null) return Number(garcom.commissionRate) || padrao;
    const waiterId = t?.openSession?.waiterId;
    const w = waiterId ? waiters.find((x) => x.id === waiterId) : null;
    return w && w.commissionRate != null ? Number(w.commissionRate) || padrao : padrao;
  };

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
        body: JSON.stringify({ taxa, gorjeta }),
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
            // Conta é papel do caixa: impressora do salão que tira a comanda
            // inteira. Nem a só-de-bebida, nem a que filtra por categoria.
            const doSalao = (cfg.printers || []).filter((p: any) =>
              p?.name && impressoraAtendeModulo(p.modulos, "salao") && p.somenteBebidas !== true);
            const doCaixa = doSalao.filter((p: any) => !(Array.isArray(p.categories) && p.categories.length > 0));
            const escolhidas = (doCaixa.length > 0 ? doCaixa : doSalao).map((p: any) => ({ ...p, categories: [] }));
            const r = await printOrder(data.cupom as any, cfg.storeName || "FIREHUB", { ...cfg, printers: escolhidas }, {}, false);
            saiuLocal = r.success;
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
    // Sugere a taxa cadastrada do garçom da mesa; o gerente ajusta se quiser.
    const taxa = taxaSugeridaDaMesa(selectedTable);
    setServiceFee(taxa);
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
          waiterTip
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
      addToCart(item);
    }
  };

  const addToCart = (item: MenuItem, comboSelections?: any[], extraSum: number = 0) => {
    const unitPrice = item.price + extraSum;
    const dono = pessoaAtiva;
    setCart(prev => {
      const uid = `${item.id}-${prev.length}-${dono || "mesa"}`;
      if (comboSelections && comboSelections.length > 0) {
        return [...prev, { uid, item, qty: 1, comboSelections, unitPrice, guestId: dono }];
      }
      // Só junta na mesma linha se for o mesmo produto E da mesma pessoa: duas
      // cervejas de pessoas diferentes precisam continuar separadas para a
      // conta sair certa no fim.
      const ex = prev.find(i => i.item.id === item.id && !i.comboSelections && (i.guestId || null) === dono);
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
    if (!selectedTable?.openSession) return;
    setActionLoading(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${selectedTable.openSession.id}/transferir`, {
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
      setShowTransferModal(false);
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

  // ─── Computed ──────────────────────────────────────────────────────────────
  const occupiedTables = tables.filter(t => t.openSession);
  const freeTables = tables.filter(t => !t.openSession);
  const totalConsumo = occupiedTables.reduce((s, t) => s + (t.openSession?.totalAmount || 0), 0);

  const filteredMenu = useMemo(() => {
    return menuItems.filter(m => {
      const matchSearch = m.name.toLowerCase().includes(menuSearch.toLowerCase());
      const matchCat = menuCat === "Todos" || m.category === menuCat;
      return matchSearch && matchCat;
    });
  }, [menuItems, menuSearch, menuCat]);

  // unitPrice, não item.price: combo com adicionais custa mais que o preço de
  // tabela, e era esse o valor enviado ao servidor. O carrinho mostrava menos
  // do que a mesa era realmente cobrada.
  const cartTotal = cart.reduce((s, c) => s + (c.unitPrice ?? c.item.price) * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const sessionTotal = sessionDetail?.orders.reduce((s, o) => s + o.totalAmount, 0) || selectedTable?.openSession?.totalAmount || 0;

  // ─── Fechamento ───────────────────────────────────────────────────────────
  // O consumo vem da conta do servidor quando ela já chegou. É o mesmo número
  // que o fechamento vai usar para validar — inclusive descontando pedidos
  // cancelados, que o total da comanda ainda soma.
  const consumoFechamento = conta?.consumo ?? sessionTotal;
  const taxaFechamento = useServiceFee ? consumoFechamento * serviceFee / 100 : 0;
  const totalFechamento = consumoFechamento + taxaFechamento + (Number(waiterTip) || 0);

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

  // Taxa e gorjeta entram no rateio, então mexer nelas muda quanto cada pessoa
  // deve. O debounce evita uma requisição por tecla digitada na gorjeta.
  useEffect(() => {
    const sessionId = selectedTable?.openSession?.id;
    if (!showCloseModal || !sessionId) return;
    const t = setTimeout(() => {
      const taxa = useServiceFee ? serviceFee : 0;
      chamar(`/api/store/table-sessions/${sessionId}/conta?taxa=${taxa}&gorjeta=${Number(waiterTip) || 0}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) setConta(d); })
        .catch(() => { /* mantém a conta anterior */ });
    }, 400);
    return () => clearTimeout(t);
  }, [showCloseModal, serviceFee, useServiceFee, waiterTip, selectedTable?.openSession?.id]);

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
      onConfirm={(selections, extraSum, qty) => {
        // O ComboModal devolve { grupoId: { nome: qtd } }; o carrinho das
        // mesas guarda lista [{ name, quantity }]. Converte preservando a
        // quantidade escolhida.
        const lista: { name: string; quantity: number }[] = [];
        for (const porGrupo of Object.values(selections || {})) {
          for (const [nome, quantidade] of Object.entries((porGrupo || {}) as Record<string, number>)) {
            if (Number(quantidade) > 0) lista.push({ name: nome, quantity: Number(quantidade) });
          }
        }
        for (let i = 0; i < Math.max(1, qty || 1); i++) {
          addToCart(comboProduct, lista, extraSum);
        }
        setComboProduct(null);
      }}
    />
  ) : null;

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, background: "#7C3AED",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 32, margin: "0 auto 16px", boxShadow: "0 8px 32px rgba(124,58,237,0.3)",
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
            padding: "14px 20px", background: "#7C3AED",
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
                  background: menuCat === cat ? "#7C3AED" : "#F1F5F9",
                  color: menuCat === cat ? "#fff" : "#64748B",
                }}>{cat}</button>
              ))}
            </div>
          </div>

          {/* ─── QUEM ESTÁ PEDINDO ───────────────────────────────────────
              A escolha vale para os próximos toques no cardápio. É o que
              transforma "a mesa consumiu R$ 300" em "o João consumiu R$ 62" —
              sem isso, na hora de rachar a conta ninguém lembra quem pediu o quê. */}
          <div className="mesa-quem-pede" style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
            background: "#F5F3FF", borderBottom: "1px solid #E9D5FF", overflowX: "auto",
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#6D28D9", whiteSpace: "nowrap", flexShrink: 0 }}>
              Lançar para:
            </span>

            <button onClick={() => setPessoaAtiva(null)} className="mesa-chip" style={{
              padding: "8px 14px", borderRadius: 20, cursor: "pointer", flexShrink: 0,
              fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
              border: pessoaAtiva === null ? "2px solid #7C3AED" : "1px solid #E2E8F0",
              background: pessoaAtiva === null ? "#7C3AED" : "#fff",
              color: pessoaAtiva === null ? "#fff" : "#64748B",
            }}>🍽️ Mesa</button>

            {pessoas.map(pes => (
              <button key={pes.id} onClick={() => setPessoaAtiva(pes.id)} className="mesa-chip" style={{
                padding: "8px 14px", borderRadius: 20, cursor: "pointer", flexShrink: 0,
                fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
                border: pessoaAtiva === pes.id ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                background: pessoaAtiva === pes.id ? "#7C3AED" : "#fff",
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
              border: "1.5px dashed #A78BFA", background: "#fff", color: "#7C3AED",
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
                  style={{ background: "#fff", border: `2px solid ${inCart ? "#C62828" : "#E2E8F0"}`, borderRadius: 14, padding: 10, cursor: "pointer", transition: "all 0.15s", position: "relative", userSelect: "none" }}
                  onMouseEnter={e => { if (!inCart) e.currentTarget.style.borderColor = "#FCA5A5"; }}
                  onMouseLeave={e => { if (!inCart) e.currentTarget.style.borderColor = "#E2E8F0"; }}>
                  {inCart && (
                    <div style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, background: "#C62828", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
                  <div style={{ color: "#C62828", fontWeight: 800, fontSize: 14 }}>
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
              fontSize: 13, fontWeight: 800, color: "#7C3AED",
              background: "#F5F3FF", padding: "6px 12px", borderRadius: 20,
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
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#7C3AED" }}>{fmt((c.unitPrice ?? c.item.price) * c.qty)}</div>
                    {pessoas.length > 0 && (
                      <div style={{ fontSize: 11, color: c.guestId ? "#0369A1" : "#94A3B8", fontWeight: 700, marginTop: 2 }}>
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
                      width: 28, height: 28, borderRadius: 7, border: "1px solid #E2E8F0",
                      background: "#F8FAFC", cursor: "pointer", fontWeight: 700, fontSize: 16,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>−</button>
                    <span style={{ fontWeight: 800, fontSize: 14, minWidth: 18, textAlign: "center" }}>{c.qty}</span>
                    <button onClick={() => setCart(prev => prev.map(x => x.uid === c.uid ? { ...x, qty: x.qty + 1 } : x))}
                      style={{
                        width: 28, height: 28, borderRadius: 7, border: "none",
                        background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 16,
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
                <span style={{ color: "#7C3AED" }}>{fmt(cartTotal)}</span>
              </div>
              <button onClick={addOrderToSession} disabled={actionLoading} style={{
                width: "100%", background: "#16A34A", color: "#fff", border: "none", borderRadius: 12,
                padding: "14px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
                opacity: actionLoading ? 0.6 : 1,
                boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
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

  // ─── GRID VIEW (main view) ────────────────────────────────────────────────
  return (
    <div className="mesa-tela" style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{ESTILO_TABLET}</style>
      {/* ─── Header ─── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", background: "#fff",
        borderBottom: "1px solid #E2E8F0", flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!ehGarcom && (
            <button onClick={() => router.push("/store/pedidos-clientes")} style={{
              background: "none", border: "1px solid #E2E8F0", borderRadius: 8,
              padding: "5px 10px", cursor: "pointer", fontSize: 13, color: "#64748B",
            }}>← Pedidos</button>
          )}
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: "#7C3AED",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 2px 8px rgba(124,58,237,0.2)",
          }}>🍽️</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: "#0F172A", margin: 0 }}>Mesas</h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
              <span style={{ color: "#16A34A", fontWeight: 700 }}>🟢 {freeTables.length} livres</span>
              <span style={{ color: "#DC2626", fontWeight: 700 }}>🔴 {occupiedTables.length} ocupadas</span>
              {totalConsumo > 0 && <span style={{ color: "#D97706", fontWeight: 700 }}>{fmt(totalConsumo)} em consumo</span>}
            </div>
          </div>
        </div>
        {ehGarcom ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span title={garcom?.name} style={{
              display: "inline-block", maxWidth: 160,
              background: "#F0EDFF", color: "#6D28D9", borderRadius: 999,
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
              background: "#7C3AED", color: "#fff", border: "none", borderRadius: 10,
              padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
              boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
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
        <div style={{
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
                    background: "#7C3AED", color: "#fff", border: "none", borderRadius: 12,
                    padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
                  }}>Criar 10 mesas padrão</button>
                </>
              )}
            </div>
          ) : (
            tables.map(table => {
              const occupied = !!table.openSession;
              const isSelected = selectedTable?.id === table.id;
              const hasValue = occupied && (table.openSession?.totalAmount || 0) > 0;
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
                  style={{
                    background: isSelected
                      ? "linear-gradient(135deg, #7C3AED, #6D28D9)"
                      : occupied
                        ? hasValue ? "#FEF2F2" : "#FFF7ED"
                        : "#fff",
                    border: `2px solid ${isSelected ? "#7C3AED" : occupied ? (hasValue ? "#FECACA" : "#FED7AA") : "#E2E8F0"}`,
                    borderRadius: 16, padding: "14px 10px", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 4, transition: "all 0.15s",
                    boxShadow: isSelected
                      ? "0 4px 20px rgba(124,58,237,0.35)"
                      : occupied
                        ? "0 2px 8px rgba(220,38,38,0.08)"
                        : "0 1px 3px rgba(0,0,0,0.04)",
                    minHeight: 120, position: "relative",
                  }}
                >
                  {/* Number */}
                  <span style={{
                    fontSize: 26, fontWeight: 900, letterSpacing: "-0.5px",
                    color: isSelected ? "#fff" : occupied ? "#DC2626" : "#334155",
                  }}>
                    {table.label || table.number.toString().padStart(2, "0")}
                  </span>

                  {/* Status indicator */}
                  <span style={{ fontSize: 18 }}>{occupied ? "🔴" : "🟢"}</span>

                  {occupied ? (
                    <>
                      <span style={{
                        fontSize: 14, fontWeight: 800,
                        color: isSelected ? "#E9D5FF" : "#DC2626",
                      }}>
                        {fmt(table.openSession!.totalAmount)}
                      </span>
                      <span style={{
                        fontSize: 10, color: isSelected ? "#C4B5FD" : "#9CA3AF",
                        fontWeight: 600,
                      }}>
                        {table.openSession!.orderCount} ped. · {elapsed(table.openSession!.openedAt)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A" }}>Livre</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* ─── Side Panel ─── */}
        {selectedTable && selectedTable.openSession && (
          <div className="mesa-detalhe" style={{
            borderLeft: "1px solid #E2E8F0", background: "#fff",
            display: "flex", flexDirection: "column", flexShrink: 0,
            boxShadow: "-4px 0 20px rgba(0,0,0,0.04)",
          }}>
            {/* Panel Header */}
            <div style={{
              padding: "14px 18px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
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
                background: "#16A34A", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(22,163,74,0.2)",
              }}>+ Novo Pedido</button>
              <button onClick={abrirFechamento} style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#DC2626", color: "#fff", fontWeight: 800, fontSize: 13,
                cursor: "pointer", boxShadow: "0 2px 6px rgba(220,38,38,0.2)",
              }}>💰 Fechar Conta</button>
              <button onClick={() => imprimirConta()} disabled={imprimindoConta} style={{
                padding: "10px 0", borderRadius: 10, border: "1.5px solid #C4B5FD",
                background: "#F5F3FF", color: "#6D28D9", fontWeight: 800, fontSize: 13,
                cursor: "pointer", gridColumn: "1 / -1", opacity: imprimindoConta ? 0.6 : 1,
              }}>{imprimindoConta ? "Enviando conta..." : `🧾 Imprimir Conta (taxa ${taxaSugeridaDaMesa(selectedTable)}%)`}</button>
              <button onClick={() => setShowTransferModal(true)} disabled={freeTables.length === 0}
                title={freeTables.length === 0 ? "Nenhuma mesa livre" : "Mover a conta para outra mesa"} style={{
                padding: "10px 0", borderRadius: 10, border: "1.5px solid #E2E8F0",
                background: "#F8FAFC", color: "#475569", fontWeight: 800, fontSize: 13,
                cursor: freeTables.length === 0 ? "not-allowed" : "pointer", gridColumn: "1 / -1",
                opacity: freeTables.length === 0 ? 0.5 : 1,
              }}>↔️ Transferir para outra mesa</button>
              {(selectedTable.openSession.totalAmount === 0) && (
                <button onClick={() => setShowFreeConfirm(true)} style={{
                  padding: "10px 0", borderRadius: 10, border: "1.5px solid #F59E0B",
                  background: "#FFFBEB", color: "#D97706", fontWeight: 800, fontSize: 13,
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
                        padding: "4px 10px", borderRadius: 8, border: "1px solid #DDD6FE",
                        background: "#F5F3FF", color: "#7C3AED", fontSize: 12, fontWeight: 700, cursor: "pointer",
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
                            <span style={{ color: "#7C3AED", marginLeft: 6 }}>{fmt(pes.total)}</span>
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
                    padding: "5px 12px", borderRadius: 20, border: "1.5px dashed #A78BFA",
                    background: "#fff", color: "#7C3AED", fontSize: 12, fontWeight: 800, cursor: "pointer",
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
                      padding: "6px 12px", borderRadius: 8, border: "none", background: "#7C3AED",
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
                sessionDetail.orders.map((order, i) => (
                  <div key={order.id} style={{
                    padding: "10px 12px", marginBottom: 6, borderRadius: 10,
                    background: "#F8FAFC", border: "1px solid #F1F5F9",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "#334155" }}>
                        Pedido #{order.dailyOrderNumber || "—"}
                      </span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: "#7C3AED" }}>
                        {fmt(order.totalAmount)}
                      </span>
                    </div>
                    {order.items.map((item, j) => {
                      // Pedido lançado antes de existir gente cadastrada na mesa
                      // não tem dono, e é isso mesmo: ele é da mesa toda.
                      const dono = item.tableGuestId
                        ? pessoas.find(p => p.id === item.tableGuestId)
                        : null;
                      return (
                        <div key={j} style={{ fontSize: 12, color: "#64748B", paddingLeft: 4 }}>
                          {item.quantity}x {item.menuProduct.name} — {fmt(item.price * item.quantity)}
                          <span style={{
                            marginLeft: 6, fontSize: 11, fontWeight: 700,
                            color: item.tableGuestId ? "#0369A1" : "#94A3B8",
                          }}>
                            {item.tableGuestId ? `👤 ${dono?.name || "cliente"}` : "🍽️ mesa"}
                          </span>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 4 }}>
                      {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: "center", padding: 30, color: "#CBD5E1" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 13 }}>Nenhum pedido ainda</div>
                  <div style={{ fontSize: 12 }}>Toque em &quot;+ Novo Pedido&quot;</div>
                </div>
              )}
            </div>

            {/* Panel Footer - Total */}
            <div style={{
              padding: "14px 18px", borderTop: "2px solid #E2E8F0",
              background: "#FAFAFE",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 20, fontWeight: 900, color: "#0F172A",
              }}>
                <span>Total</span>
                <span style={{ color: "#7C3AED" }}>{fmt(sessionTotal)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                {selectedTable.openSession.orderCount} pedido{selectedTable.openSession.orderCount !== 1 ? "s" : ""} · Aberta há {elapsed(selectedTable.openSession.openedAt)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── CONFIRM OPEN TABLE MODAL ─── */}
      {confirmOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenWaiterId(garcomFixo); }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, width: "90%", maxWidth: 420,
            padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: "#F0EDFF",
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
                  marginTop: 8, background: "none", border: "none", color: "#7C3AED",
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

            <div style={{ marginBottom: 20 }}>
              {ehGarcom ? (
                <>
                  <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>
                    Garçom
                  </label>
                  <div style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, boxSizing: "border-box",
                    border: "1.5px solid #DDD6FE", fontSize: 14, background: "#F5F3FF",
                    color: "#4C1D95", fontWeight: 700,
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
                  <a href="/store/garcons" target="_blank" style={{ fontSize: 12, color: "#3B82F6", textDecoration: "none", display: "inline-block", marginTop: 6, fontWeight: 600 }}>
                    + adicionar garçom
                  </a>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setConfirmOpen(null); setOpenCustomerName(""); setOpenWaiterId(garcomFixo); }}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}>Cancelar</button>
              <button onClick={openTable} disabled={actionLoading}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "#7C3AED", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
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
                width: 48, height: 48, borderRadius: 14, background: "#F0EDFF",
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
                  background: "#7C3AED", color: "#fff", fontWeight: 800, fontSize: 14,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
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
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={useServiceFee} onChange={e => setUseServiceFee(e.target.checked)} style={{ accentColor: "#7C3AED", width: 18, height: 18 }} />
                  Taxa de serviço
                  <input type="number" value={serviceFee} onChange={e => setServiceFee(Number(e.target.value))}
                    style={{ width: 54, padding: "6px 8px", borderRadius: 6, border: "1px solid #E2E8F0", textAlign: "center", fontFamily: "inherit" }} />%
                  {useServiceFee && (
                    <span style={{ marginLeft: "auto", fontWeight: 700, color: "#D97706" }}>{fmt(taxaFechamento)}</span>
                  )}
                </label>
                <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, marginTop: 8, cursor: "pointer", color: "#64748B" }}>
                  <span>Gorjeta extra (R$)</span>
                  <input type="number" min="0" step="0.5" value={waiterTip} onChange={e => setWaiterTip(Number(e.target.value))}
                    style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid #E2E8F0", textAlign: "right", fontFamily: "inherit" }} />
                </label>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 900, marginTop: 12, paddingTop: 12, borderTop: "2px solid #E2E8F0" }}>
                  <span>TOTAL</span>
                  <span style={{ color: "#7C3AED" }}>{fmt(totalFechamento)}</span>
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
                    <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700 }}>
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
                              <span style={{ fontSize: 15, fontWeight: 800, color: "#7C3AED" }}>{fmt(pes.aPagar)}</span>
                              <button
                                onClick={() => { setDonoPagamento(pes.id); setValorPagamento(paraCampo(faltaDaPessoa(pes))); }}
                                title="Registrar o pagamento desta pessoa"
                                className="mesa-chip"
                                style={{
                                  border: "1px solid #DDD6FE", background: "#F5F3FF", color: "#7C3AED",
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
                  <span style={{ marginLeft: 6, color: "#16A34A" }}>({fmt(totalRecebido)})</span>
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
                      background: "#F0FDF4",
                    }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#166534", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.guestName ? `👤 ${p.guestName}` : "🍽️ Da mesa"}
                      </span>
                      <span style={{ fontSize: 12, color: "#15803D", fontWeight: 600 }}>{p.method}</span>
                      {p.por && (
                        <span title={`Registrado por ${p.por}`} style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap" }}>· {p.por}</span>
                      )}
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#15803D" }}>{fmt(p.amount)}</span>
                      <button
                        onClick={() => apagarPagamento(p.uid)}
                        title="Apagar este pagamento"
                        style={{
                          border: "none", background: "#FEF2F2", color: "#DC2626", borderRadius: 8,
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
                        border: donoPagamento === null ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                        background: donoPagamento === null ? "#F5F3FF" : "#fff",
                        color: donoPagamento === null ? "#6D28D9" : "#475569",
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
                            border: escolhida ? "2px solid #7C3AED" : "1px solid #E2E8F0",
                            background: escolhida ? "#F5F3FF" : quitada ? "#F0FDF4" : "#fff",
                            color: escolhida ? "#6D28D9" : quitada ? "#15803D" : "#475569",
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
                        background: "#16A34A", color: "#fff", fontSize: 13, fontWeight: 900,
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
              background: faltaPagar > 0.01 ? "#FFFBEB" : "#F0FDF4",
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
                  color: "#15803D", paddingTop: 8, borderTop: "1px solid #BBF7D0", marginBottom: 12,
                }}>
                  <span>{troco > 0.01 ? "💵 Troco" : "✅ Conta fechada"}</span>
                  <span>{troco > 0.01 ? fmt(troco) : fmt(totalRecebido)}</span>
                </div>
              )}

              <button onClick={() => imprimirConta(useServiceFee ? serviceFee : 0, Number(waiterTip) || 0)}
                disabled={imprimindoConta} style={{
                width: "100%", background: "#fff", color: "#6D28D9",
                border: "1.5px solid #C4B5FD", borderRadius: 12, padding: "12px 0", fontWeight: 800, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit", marginBottom: 8, opacity: imprimindoConta ? 0.6 : 1,
              }}>
                {imprimindoConta ? "Enviando conta..." : `🧾 Imprimir conta para o cliente${useServiceFee ? ` (taxa ${serviceFee}%)` : " (sem taxa)"}`}
              </button>
              <button onClick={closeSession} disabled={actionLoading || !podeFechar} style={{
                width: "100%", background: podeFechar ? "#DC2626" : "#CBD5E1", color: "#fff",
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
      {showTransferModal && selectedTable?.openSession && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }} onClick={() => setShowTransferModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 420,
            maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          }}>
            <h3 style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 18, color: "#0F172A" }}>
              ↔️ Transferir a Mesa {selectedTable.number}
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748B" }}>
              A conta inteira (pedidos, pessoas e pagamentos) vai para a mesa escolhida. Nada é relançado na cozinha.
            </p>
            {freeTables.length === 0 ? (
              <p style={{ color: "#B45309", fontWeight: 700, fontSize: 14 }}>Nenhuma mesa livre no momento.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {freeTables.map(t => (
                  <button key={t.id} onClick={() => transferTable(t.id)} disabled={actionLoading} style={{
                    padding: "14px 6px", borderRadius: 12, border: "2px solid #E2E8F0", background: "#fff",
                    fontWeight: 800, fontSize: 15, color: "#0F172A", cursor: "pointer",
                    opacity: actionLoading ? 0.6 : 1,
                  }}>
                    Mesa {t.number}
                    {t.label && <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", marginTop: 2 }}>{t.label}</div>}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowTransferModal(false)} style={{
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
                width: 48, height: 48, borderRadius: 14, background: "#F0EDFF",
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
              width: "100%", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 12,
              padding: "12px 0", fontWeight: 800, fontSize: 15, cursor: "pointer",
              opacity: actionLoading ? 0.6 : 1,
              boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
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
                    {table.label && <span style={{ color: "#9CA3AF", fontSize: 13, marginLeft: 8 }}>({table.label})</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button onClick={() => {
                      setEditNumber(table.number.toString());
                      setEditLabel(table.label || "");
                      setShowEditModal(table);
                      setShowConfigModal(false);
                    }} style={{
                      padding: "4px 10px", borderRadius: 6, border: "1px solid #DDD6FE",
                      background: "#F5F3FF", color: "#7C3AED", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}>✏️ Editar</button>
                    {table.openSession ? (
                      <span style={{ fontSize: 12, color: "#D97706", fontWeight: 700 }}>🔴 Ocupada</span>
                    ) : (
                      <button onClick={() => deleteTable(table.id)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA",
                        background: "#FEF2F2", color: "#DC2626", fontSize: 12, fontWeight: 700, cursor: "pointer",
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
              width: 56, height: 56, borderRadius: 16, background: "#FEF3C7",
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
                background: "#F59E0B", color: "#fff", fontWeight: 800, fontSize: 14,
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
                padding: "15px 16px", borderRadius: 12, border: "none", background: "#7C3AED",
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
                padding: "15px 16px", borderRadius: 12, border: "1.5px solid #16A34A",
                background: "#F0FDF4", color: "#15803D", fontSize: 15, fontWeight: 800,
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
                  background: "#FEF2F2", color: "#DC2626", fontSize: 13, fontWeight: 700,
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
