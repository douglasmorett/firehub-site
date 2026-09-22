"use client";
import { useState, useEffect, useMemo } from "react";
import { ShoppingCart, Plus, Minus, Trash2, Check, Bike, UtensilsCrossed, Users, Search, ChevronRight } from "lucide-react";
import ComboModal from "@/components/customer/ComboModal";
import { diaDaSemanaEmSaoPaulo } from "@/lib/cardapio-interno";
import {
  MOTIVOS_COMUNS, SEM_DESCONTO, notaDoDesconto, problemaDoDesconto, valorDoDesconto,
  type DescontoManual,
} from "@/lib/desconto-manual";
import {
  lerDocumentoDoCliente, mascararDocumentoDigitado, problemaDoDocumento, tipoDoDocumento,
} from "@/lib/documento-do-cliente";
import {
  BALCAO_CONFIG_PADRAO, pagerEhObrigatorio, problemaDoPagerObrigatorio, type BalcaoConfig,
} from "@/lib/balcao-config";
import { MENSAGEM_CAIXA_FECHADO, CAMINHO_DO_CAIXA } from "@/lib/caixa-aberto";

const PAYMENT_METHODS = ["Dinheiro", "PIX", "Cartão Débito", "Cartão Crédito", "Voucher/Vale"];
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

type CartItem = { product: any; qty: number; unitPrice?: number; notes?: string; comboSelections?: { name: string; quantity: number }[] };
type OrderType = "BALCAO" | "MESA" | "DELIVERY";

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

export default function VendaPresencialPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("BALCAO");
  const [tableNum, setTableNum] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  /** Número do pager entregue a quem espera no balcão. Vazio = a loja não usa. */
  const [pager, setPager] = useState("");
  /** "CPF na nota": sai impresso na comanda e já preenche a NFC-e depois. */
  const [documento, setDocumento] = useState("");
  /** O que a loja marcou em Minha Loja › Balcão & Pager (lib/balcao-config.ts). */
  const [balcaoConfig, setBalcaoConfig] = useState<BalcaoConfig>({ ...BALCAO_CONFIG_PADRAO });
  /**
   * Tem caixa aberto? `null` = ainda perguntando.
   *
   * Começa como null e NÃO como false: mostrar "caixa fechado" no meio segundo
   * até a resposta chegar faria o atendente correr abrir um caixa que já
   * estava aberto.
   */
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null);
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Dinheiro");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [change, setChange] = useState(""); // troco
  // Pagamento dividido (metade no Pix, metade em dinheiro), igual à mesa.
  // Cada parte vai para a sua linha do fechamento de caixa; o resumo em
  // texto vai no paymentMethod da comanda.
  const [dividir, setDividir] = useState(false);
  const [partes, setPartes] = useState<{ metodo: string; valor: string }[]>([]);
  const valorDaParte = (p: { valor: string }) => Math.round((parseFloat(String(p.valor).replace(",", ".")) || 0) * 100) / 100;
  const [comboProduct, setComboProduct] = useState<any>(null);
  const [employeeAccountEnabled, setEmployeeAccountEnabled] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedEmployeeName, setSelectedEmployeeName] = useState("");

  useEffect(() => {
    // Balcão é canal SALÃO: o `price` já chega resolvido (preço do canal, se a
    // loja cadastrou; o normal, se não) e a tela não precisa saber a diferença.
    fetch("/api/admin/menu-products?canal=salao").then(r => r.json()).then(d => Array.isArray(d) && setProducts(d));
    fetch("/api/store-settings/payment").then(r => r.ok ? r.json() : null).then(d => d && setPaymentConfig(d.paymentFees));
    fetch("/api/store-settings/employee-account").then(r => r.ok ? r.json() : null).then(d => d && setEmployeeAccountEnabled(Boolean(d.employeeAccountEnabled)));
    fetch("/api/store/employees").then(r => r.ok ? r.json() : null).then(d => d?.employees && setEmployees(d.employees));
    // Falha aqui deixa a tela no padrão (nada obrigatório): a venda não pode
    // parar porque uma configuração não carregou. Quem tem a palavra final é
    // a rota do pedido, que lê a mesma regra do banco.
    fetch("/api/store-settings/balcao").then(r => r.ok ? r.json() : null)
      .then(d => d && setBalcaoConfig({ pagerObrigatorioBalcao: d.pagerObrigatorioBalcao === true, pagerObrigatorioMesa: d.pagerObrigatorioMesa === true }))
      .catch(() => { /* fica no padrão */ });
  }, []);

  // ── O CAIXA PRECISA ESTAR ABERTO (lib/caixa-aberto.ts) ───────────────────
  //
  // Pergunta ao abrir a tela e DE NOVO a cada 30s: o atendente costuma abrir o
  // caixa noutra aba e voltar para cá, e sem reperguntar ele ficaria olhando o
  // aviso vermelho num caixa já aberto, sem entender por quê. Também volta a
  // perguntar quando a aba ganha foco, que é o caminho mais comum.
  useEffect(() => {
    let vivo = true;
    const conferir = () => {
      fetch("/api/store/caixa-aberto")
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (vivo && d) setCaixaAberto(d.aberto === true); })
        .catch(() => { /* mantém o que já sabia; quem barra de verdade é a API do pedido */ });
    };
    conferir();
    const relogio = setInterval(conferir, 30_000);
    window.addEventListener("focus", conferir);
    return () => { vivo = false; clearInterval(relogio); window.removeEventListener("focus", conferir); };
  }, []);

  const getDisplayPrice = (p: any) => {
    if (p.price && p.price > 0) return fmt(p.price);
    const groups = getEffectiveComboGroups(p);
    if (groups && groups.length > 0) {
      let minPrice = Infinity;
      groups.forEach((g: any) => {
        (g.items || []).forEach((it: any) => {
          const pr = (Number(it.additionalPrice) || 0) + (it.menuProduct?.price || 0);
          if (pr > 0 && pr < minPrice) minPrice = pr;
        });
      });
      if (minPrice !== Infinity) return `a partir de ${fmt(minPrice)}`;
    }
    return fmt(0);
  };

  const DAY_ALIASES: Record<string, string[]> = {
    DOM: ["DOM", "DOMINGO", "0", "SUN", "SUNDAY"],
    SEG: ["SEG", "SEGUNDA", "SEGUNDA-FEIRA", "1", "MON", "MONDAY"],
    TER: ["TER", "TERCA", "TERÇA", "TERCA-FEIRA", "TERÇA-FEIRA", "2", "TUE", "TUESDAY"],
    QUA: ["QUA", "QUARTA", "QUARTA-FEIRA", "3", "WED", "WEDNESDAY"],
    QUI: ["QUI", "QUINTA", "QUINTA-FEIRA", "4", "THU", "THURSDAY"],
    SEX: ["SEX", "SEXTA", "SEXTA-FEIRA", "5", "FRI", "FRIDAY"],
    SAB: ["SAB", "SABADO", "SÁBADO", "6", "SAT", "SATURDAY"],
  };

  // Dia de SÃO PAULO: o tablet do balcão pode estar com o fuso errado, e no
  // render do servidor `new Date()` responde em UTC — depois das 21h de
  // Brasília a promoção de amanhã já aparecia no PDV.
  const currentDayCode = diaDaSemanaEmSaoPaulo();

  const parseAvailableDays = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return val.split(",").map(s => s.trim());
      }
    }
    return [];
  };

  const isAvailableToday = (p: any, dayCode: string): boolean => {
    const days = parseAvailableDays(p.availableDays);
    if (days.length === 0) return true;
    const allowedAliases = DAY_ALIASES[dayCode] || [dayCode];
    return days.some(d => {
      const clean = d.toUpperCase().trim();
      return allowedAliases.includes(clean) || allowedAliases.some(a => clean.startsWith(a) || a.startsWith(clean));
    });
  };

  // Esconde itens stub de integração (iFood, JotaJá, 99Food)
  const HIDDEN_CATEGORIES = new Set(["IFOOD", "JOTAJA", "JOTAJÁ", "99FOOD", "ONLINE", "OCULTO"]);
  // O prefixo do id diz como o registro NASCEU, não o que ele É hoje: cardápio
  // importado reaproveita ids `ifood-…` (ver SEM_PRODUTO_DE_INTEGRACAO em
  // cardapio-interno.ts — o servidor já filtra assim). Condenar por prefixo
  // escondia do balcão os mesmos 8 pastéis de carne que sumiam da mesa na
  // Pastelaria da Paulista. Prefixo só condena espelho não adotado: o inativo.
  const isIntegrationItem = (p: any) => {
    const temPrefixoDeEspelho =
      p.id?.startsWith("ifood-") || p.id?.startsWith("jotaja-") || p.id?.startsWith("99food-");
    if (temPrefixoDeEspelho && p.active === false) return true;
    const cat = (p.category || "").toUpperCase().trim();
    return HIDDEN_CATEGORIES.has(cat);
  };

  const categories = useMemo(() => {
    const activeTodayProducts = products.filter(p => {
      if (p.active === false || p.activePDV === false) return false;
      if (p.apenasOpcaoDeCombo === true) return false;
      if (!isAvailableToday(p, currentDayCode)) return false;
      if (isIntegrationItem(p)) return false;
      return true;
    });
    // A categoria REAL, sempre — mesma correção da mesa. Combo virava "Combos"
    // e apagava a aba da categoria dele; numa loja de cardápio no molde iFood,
    // onde quase tudo é combo, sobrava uma aba só com o cardápio inteiro dentro.
    const reais = Array.from(new Set(activeTodayProducts.map(p => p.category || "Outros"))).sort();
    const temCombo = activeTodayProducts.some(p => p.isCombo);
    const cats = [...(temCombo ? ["Combos"] : []), ...reais];
    return ["Todos", ...cats.sort()];
  }, [products, currentDayCode]);

  const filtered = products.filter(p => {
    if (p.active === false) return false;
    if (p.activePDV === false) return false;
    // Complemento nunca é item avulso — vale aqui como vale na mesa. O
    // servidor decide e manda a bandeira (menu-products com `?canal=`),
    // porque só lá os quatro preços e o carimbo `apenasEmCombo` existem.
    //
    // Na Pastelaria da Paulista o balcão já não os mostrava, mas por
    // coincidência do cadastro: os 101 adicionais dela estão com activePDV
    // desligado. Loja que criar complemento sem desligar o PDV via todos
    // eles como card de R$ 0,00.
    if (p.apenasOpcaoDeCombo === true) return false;
    if (!isAvailableToday(p, currentDayCode)) return false;
    if (isIntegrationItem(p)) return false;
    // "Combos" é aba transversal: o item aparece na categoria dele e também lá.
    if (selectedCategory !== "Todos") {
      const bate = selectedCategory === "Combos" ? !!p.isCombo : (p.category || "Outros") === selectedCategory;
      if (!bate) return false;
    }
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const voucherRate = useMemo(() => {
    if (!paymentConfig?.VOUCHER?.active) return 0;
    const brands: any[] = paymentConfig.VOUCHER.brands || [];
    if (brands.length === 0) return paymentConfig.VOUCHER.rate || 0;
    const activeBrands = brands.filter((b: any) => b.active);
    if (activeBrands.length === 0) return 0;
    return activeBrands.reduce((s: number, b: any) => s + b.rate, 0) / activeBrands.length;
  }, [paymentConfig]);

  // Desconto na mão: "faz 10% pra mim" e "tira 5 reais" são as duas
  // conversas do balcão; o motivo é o que explica o furo no fechamento.
  const [desconto, setDesconto] = useState<DescontoManual>(SEM_DESCONTO);
  const [mostrarDesconto, setMostrarDesconto] = useState(false);

  const isVoucher = paymentMethod === "Voucher/Vale";
  const subtotal = cart.reduce((s, i) => s + (i.unitPrice ?? i.product.price) * i.qty, 0);
  const voucherFee = isVoucher ? subtotal * (voucherRate / 100) : 0;
  // O desconto incide sobre os ITENS, antes da taxa do voucher: a taxa é o
  // custo da maquininha sobre o que foi cobrado, não sobre o que foi abatido.
  const descontoEmReais = valorDoDesconto(desconto, subtotal);
  const total = Math.max(0, subtotal - descontoEmReais + voucherFee);
  const somaPartes = Math.round(partes.reduce((s, p) => s + valorDaParte(p), 0) * 100) / 100;
  const faltaDividir = Math.round((total - somaPartes) * 100) / 100;
  const parteDinheiro = Math.round(partes.filter(p => p.metodo === "Dinheiro").reduce((s, p) => s + valorDaParte(p), 0) * 100) / 100;
  const limparDesconto = () => { setDesconto(SEM_DESCONTO); setMostrarDesconto(false); };

  const ligarDivisao = (ligar: boolean) => {
    setDividir(ligar);
    if (ligar) {
      setPaymentMethod("Dividido");
      // Duas linhas para começar; a segunda já com o que falta.
      setPartes([{ metodo: "Dinheiro", valor: "" }, { metodo: "PIX", valor: "" }]);
    } else {
      setPaymentMethod("Dinheiro");
      setPartes([]);
    }
    setChange("");
  };
  const setParte = (idx: number, patch: Partial<{ metodo: string; valor: string }>) =>
    setPartes(prev => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  // Preenche a linha com o que ainda falta — é o gesto mais comum ("o resto no Pix").
  const completarParte = (idx: number) =>
    setPartes(prev => {
      const outras = prev.reduce((s, p, i) => (i === idx ? s : s + valorDaParte(p)), 0);
      const resto = Math.max(0, Math.round((total - outras) * 100) / 100);
      return prev.map((p, i) => (i === idx ? { ...p, valor: resto.toFixed(2) } : p));
    });

  const handleProductClick = (product: any) => {
    const groups = getEffectiveComboGroups(product);
    if ((product.isCombo || groups.length > 0) && groups.length > 0) {
      setComboProduct({ ...product, comboGroups: groups });
    } else {
      addToCart(product);
    }
  };

  // `notes` é a observação do item ("tirar o milho da pizza"). O modal do
  // produto sempre perguntou "Alguma observação?" e devolvia a resposta — e
  // este balcão a jogava fora: o pedido chegava na cozinha e na comanda sem
  // ela (NIK Esfihas e Pizzas, 10/09/2026, ao vivo com o cliente). Item com
  // observação é uma linha própria: não se junta com o mesmo produto sem ela.
  const addToCart = (product: any, comboSelections?: { name: string; quantity: number }[], extraSum: number = 0, qty: number = 1, notes: string = "") => {
    const unitPrice = product.price + extraSum;
    const quantidade = Math.max(1, Number(qty) || 1);
    const obs = String(notes || "").trim();
    setCart(prev => {
      if ((comboSelections && comboSelections.length > 0) || obs) {
        return [...prev, { product, qty: quantidade, comboSelections: comboSelections && comboSelections.length > 0 ? comboSelections : undefined, unitPrice, notes: obs || undefined }];
      }
      const ex = prev.find(i => i.product.id === product.id && !i.comboSelections && !i.notes);
      if (ex) return prev.map(i => (i.product.id === product.id && !i.comboSelections && !i.notes) ? { ...i, qty: i.qty + quantidade } : i);
      return [...prev, { product, qty: quantidade, unitPrice }];
    });
  };

  const updateQtyByIndex = (index: number, newQty: number) => {
    setCart(prev => {
      if (newQty <= 0) return prev.filter((_, idx) => idx !== index);
      return prev.map((item, idx) => idx === index ? { ...item, qty: newQty } : item);
    });
  };

  const handleSubmit = async () => {
    // O caixa é a primeira pergunta: de nada adianta conferir o carrinho de um
    // pedido que não vai poder ser registrado. Quem barra de verdade é a API
    // (lib/caixa-aberto.ts) — aqui é para o atendente não perder a viagem.
    if (caixaAberto === false) return setMsg(`❌ ${MENSAGEM_CAIXA_FECHADO}`);
    if (cart.length === 0) return setMsg("❌ Adicione pelo menos um produto.");
    if (orderType === "MESA" && !tableNum) return setMsg("❌ Informe o número da mesa.");
    if (orderType === "DELIVERY" && !address) return setMsg("❌ Informe o endereço de entrega.");
    if (paymentMethod === "Conta Funcionário" && !selectedEmployeeId) {
      return setMsg("❌ Selecione o funcionário responsável pela conta.");
    }
    // O CPF na nota é opcional, mas digitado errado não passa: este número é o
    // destinatário da NFC-e depois (lib/documento-do-cliente.ts).
    const problemaNoDocumento = problemaDoDocumento(documento);
    if (problemaNoDocumento) return setMsg(`❌ ${problemaNoDocumento}`);
    // Pager obrigatório, se a loja marcou (lib/balcao-config.ts). A mesma
    // função roda na rota do pedido — aqui é para o atendente ver antes de
    // montar o carrinho inteiro, não é a trava.
    const problemaNoPager = problemaDoPagerObrigatorio(balcaoConfig, orderType, pager);
    if (problemaNoPager) return setMsg(`❌ ${problemaNoPager}`);

    if (dividir) {
      const validas = partes.filter(p => valorDaParte(p) > 0);
      if (validas.length < 2) return setMsg("❌ Para dividir, informe pelo menos duas formas com valor.");
      if (Math.abs(faltaDividir) > 0.01) {
        return setMsg(`❌ A soma das formas (${fmt(somaPartes)}) não bate com o total (${fmt(total)}). ${faltaDividir > 0 ? `Faltam ${fmt(faltaDividir)}.` : `Sobram ${fmt(-faltaDividir)}.`}`);
      }
      if (parteDinheiro > 0 && change && Number(change) < parteDinheiro) {
        return setMsg(`❌ O valor em dinheiro entregue (${fmt(Number(change))}) é menor que a parte em dinheiro (${fmt(parteDinheiro)}).`);
      }
    }

    setLoading(true); setMsg("");
    const partesValidas = dividir ? partes.filter(p => valorDaParte(p) > 0).map(p => ({ method: p.metodo, amount: valorDaParte(p) })) : null;
    // No pagamento dividido o troco é sobre a PARTE em dinheiro, não sobre o
    // total — então ele vai escrito na observação, e não em `change`, que a
    // comanda calcula contra o total do pedido.
    const trocoDividido = dividir && parteDinheiro > 0 && change && Number(change) > parteDinheiro
      ? ` [Dinheiro ${fmt(parteDinheiro)} · cliente deu ${fmt(Number(change))} · troco ${fmt(Number(change) - parteDinheiro)}]`
      : "";
    const body = {
      customerName: paymentMethod === "Conta Funcionário" && selectedEmployeeName
        ? `Func. ${selectedEmployeeName}`
        : customerName || (orderType === "MESA" ? `Mesa ${tableNum}` : orderType === "BALCAO" ? "Balcão" : "Cliente"),
      customerPhone: customerPhone || "00000000000",
      pagerNumber: pager.trim() || null,
      // "CPF na nota". Vai só com os dígitos; a máscara é coisa da tela.
      customerCpfCnpj: lerDocumentoDoCliente(documento),
      customerAddress: orderType === "DELIVERY" ? address : orderType === "MESA" ? `Mesa ${tableNum}` : "Balcão",
      deliveryType: orderType === "BALCAO" ? "RETIRADA" : orderType,
      paymentMethod,
      ...(partesValidas ? { paymentMethods: partesValidas } : {}),
      change: !dividir && paymentMethod === "Dinheiro" && change ? Number(change) : null,
      employeeId: selectedEmployeeId || null,
      employeeName: selectedEmployeeName || null,
      // O motivo do desconto vai na observação: sai impresso na comanda e
      // fica no histórico do pedido, sem coluna nova.
      notes: `${notes || ""}${trocoDividido} ${notaDoDesconto(desconto, subtotal)}`.trim(),
      totalAmount: total,
      // Registrado, não só abatido: a mensalidade é sobre o bruto do pedido
      // (lib/billing.ts) e sem isto a base de cobrança encolheria junto.
      ...(descontoEmReais > 0 ? { discountTotal: descontoEmReais, discountMerchant: descontoEmReais } : {}),
      deliveryFee: 0,
      items: cart.map(i => ({
        menuProductId: i.product.id,
        quantity: i.qty,
        price: i.unitPrice ?? i.product.price,
        comboSelections: i.comboSelections ? JSON.stringify(i.comboSelections) : null,
        notes: (i.notes || "").trim() || null,
      })),
    };

    const res = await fetch("/api/store/orders/presencial", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setLoading(false);
    if (res.ok) {
      setMsg("✅ Pedido registrado!");
      // TUDO DO CLIENTE SAI DAQUI, inclusive pager e documento. O que fica no
      // campo vai parar na comanda do PRÓXIMO cliente, e "PAGER 12" chamando a
      // pessoa errada ou o CPF de outro impresso na nota é o tipo de erro que
      // ninguém percebe até alguém reclamar. O pager já ficava para trás antes
      // deste campo existir — mesma falha, consertada junto.
      setCart([]); setCustomerName(""); setCustomerPhone(""); setAddress(""); setTableNum(""); setNotes(""); setChange(""); setPager(""); setDocumento("");
      if (dividir) ligarDivisao(false);
    } else {
      const err = await res.json();
      setMsg("❌ " + (err.error || "Erro ao registrar pedido."));
    }
  };

  const cartQty = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="pdv-layout" style={{ fontFamily: "'Inter', sans-serif", height: "calc(100vh - 145px)", maxHeight: "calc(100vh - 145px)", overflow: "hidden", position: "relative" }}>
      <style>{`
        /* ── LAYOUT ADAPTATIVO PARA TABLET ──────────────────────────────────
           O carrinho tinha 380px FIXOS. Num tablet em retrato (768px) sobravam
           388px para o cardápio, e com cards de 150px só cabia UMA coluna —
           o garçom via 4 produtos numa tela que comporta 12, e rolava a lista
           inteira para achar uma Coca.

           Agora a largura do carrinho acompanha a tela, e abaixo de 900px ele
           sai da lateral e vira uma barra no rodapé: o cardápio ocupa a tela
           toda, que é o que importa para quem está lançando pedido em pé. */
        .pdv-layout {
          display: grid;
          grid-template-columns: 1fr 380px;
        }
        .pdv-produtos {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 10px;
        }

        /* Tablet deitado e telas médias */
        @media (max-width: 1180px) {
          .pdv-layout { grid-template-columns: 1fr 300px; }
          .pdv-produtos { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
        }

        /* Tablet em pé: carrinho vai para o rodapé */
        @media (max-width: 900px) {
          .pdv-layout {
            grid-template-columns: 1fr;
            grid-template-rows: 1fr auto;
          }
          .pdv-produtos { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
          .pdv-carrinho {
            border-left: none !important;
            border-top: 2px solid #E2E8F0;
            max-height: 42vh;
          }
        }

        /* Alvo de toque: dedo não acerta botão de 24px com precisão.
           44px é a medida recomendada para toque, e num tablet de garçom
           errar o botão significa lançar o item errado na comanda. */
        @media (pointer: coarse) {
          .pdv-layout button { min-height: 44px; }
          .pdv-layout input, .pdv-layout select { min-height: 44px; font-size: 16px; }
        }

        #floating-contact-widget, .fcw-container, .fcw-backdrop, #contact-widget-fab,
        #hubspot-messages-iframe-container, iframe[src*="chat"], .crisp-client, div[class*="chat"], #chat-widget-container, div[class*="widget"], div[id*="chat"] {
          display: none !important;
          pointer-events: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
        button[data-btn="finalizar"] {
          position: relative !important;
          z-index: 9999999 !important;
          pointer-events: auto !important;
          cursor: pointer !important;
        }
        button[data-btn="finalizar"] * {
          pointer-events: none !important;
        }
      `}</style>

      {/* ===== LEFT: CARDÁPIO ===== */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #E2E8F0" }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..."
                style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }} />
            </div>
            <div style={{ background: "#C62828", color: "#fff", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}>
              <ShoppingCart size={15} /> {cartQty} {cartQty === 1 ? "item" : "itens"}
            </div>
          </div>
          {/* Categorias */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                style={{ padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem", whiteSpace: "nowrap", fontFamily: "inherit",
                  background: selectedCategory === cat ? "#C62828" : "#F1F5F9",
                  color: selectedCategory === cat ? "#fff" : "#64748B" }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid de produtos */}
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <div className="pdv-produtos">
            {filtered.map(p => {
              const inCart = cart.find(i => i.product.id === p.id);
              return (
                <div key={p.id} onClick={() => handleProductClick(p)}
                  style={{ background: "#fff", border: `2px solid ${inCart ? "#C62828" : "#E2E8F0"}`, borderRadius: 14, padding: 10, cursor: "pointer", transition: "all 0.15s", position: "relative", userSelect: "none" }}
                  onMouseEnter={e => { if (!inCart) e.currentTarget.style.borderColor = "#FCA5A5"; }}
                  onMouseLeave={e => { if (!inCart) e.currentTarget.style.borderColor = "#E2E8F0"; }}>
                  {inCart && (
                    <div style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, background: "#C62828", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#fff", fontSize: "0.65rem", fontWeight: 900 }}>{inCart.qty}</span>
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
                  <div style={{ color: "#C62828", fontWeight: 800, fontSize: "0.88rem" }}>{getDisplayPrice(p)}</div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "2rem", color: "#94A3B8" }}>Nenhum produto encontrado.</div>
            )}
          </div>
        </div>
      </div>

      {/* ===== RIGHT: PEDIDO ===== */}
      <div className="pdv-carrinho" style={{ display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden" }}>
        {/* Tipo de pedido */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
            {([
              { value: "BALCAO", label: "Balcão", icon: "🏠", color: "#3B82F6" },
              { value: "MESA", label: "Mesa", icon: "🍽️", color: "#8B5CF6" },
              { value: "DELIVERY", label: "Delivery", icon: "🛵", color: "#C62828" },
            ] as const).map(t => (
              <button key={t.value} onClick={() => setOrderType(t.value)}
                style={{ padding: "10px 4px", borderRadius: 10, border: `2px solid ${orderType === t.value ? t.color : "#E2E8F0"}`,
                  background: orderType === t.value ? t.color : "#F8FAFC",
                  color: orderType === t.value ? "#fff" : "#64748B",
                  fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 2 }}>{t.icon}</div>
                {t.label}
              </button>
            ))}
          </div>

          {/* Campos por tipo */}
          {orderType === "MESA" && (
            <input placeholder="Número da mesa *" value={tableNum} onChange={e => setTableNum(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #8B5CF6", fontSize: "0.9rem", outline: "none", fontFamily: "inherit" }} />
          )}
          {orderType === "DELIVERY" && (
            <input placeholder="Endereço de entrega *" value={address} onChange={e => setAddress(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #C62828", fontSize: "0.9rem", outline: "none", fontFamily: "inherit" }} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input placeholder={orderType === "BALCAO" ? "Nome (opcional)" : "Nome do cliente"} value={customerName} onChange={e => setCustomerName(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" }} />
            <input placeholder="Telefone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" }} />
          </div>

          {/* Pager: só onde o cliente ESPERA (balcão e mesa). Em delivery não
              existe pager, e um campo a mais só atrapalharia quem digita
              endereço com o cliente no telefone.

              Fica vazio por padrão — loja que não usa pager não digita nada e
              nada muda. Quem digita vê o número no card do painel e na
              comanda impressa. */}
          {(orderType === "BALCAO" || orderType === "MESA") && (() => {
            // A loja pode ter marcado o pager como OBRIGATÓRIO aqui
            // (Minha Loja › Balcão & Pager). Quando está, o campo tem que
            // dizer isso sozinho — borda vermelha e "obrigatório" no lugar de
            // "opcional" —, senão o atendente só descobre ao tentar finalizar,
            // com o cliente na frente dele.
            const pagerObrigatorio = pagerEhObrigatorio(balcaoConfig, orderType);
            const faltando = pagerObrigatorio && pager.trim() === "";
            return (
              <input
                placeholder={pagerObrigatorio ? "Pager * — obrigatório, ex: 12" : "Pager (opcional) — ex: 12"}
                value={pager}
                onChange={e => setPager(e.target.value.slice(0, 10))}
                maxLength={10}
                style={{ width: "100%", marginTop: 6, padding: "7px 10px", borderRadius: 8,
                  border: `1.5px solid ${faltando ? "#DC2626" : pager.trim() ? "#F59E0B" : "#E2E8F0"}`,
                  background: faltando ? "#FEF2F2" : pager.trim() ? "#FFFBEB" : "#FFF",
                  fontSize: "0.85rem", outline: "none", fontFamily: "inherit", fontWeight: pager.trim() ? 800 : 400 }}
              />
            );
          })()}

          {/* ── "CPF NA NOTA" ────────────────────────────────────────────────
              Só no BALCÃO: é ali que o cliente está na frente do atendente e
              pede. Em mesa e delivery o pedido é lançado sem a pessoa por
              perto, e um campo a mais só atrasaria quem digita endereço.

              Vazio por padrão — quem não pede, não digita, e nada muda. Quem
              digita vê o documento sair na comanda impressa, e o pedido chega
              na emissão da NFC-e com o destinatário já preenchido. */}
          {orderType === "BALCAO" && (
            <div style={{ marginTop: 6 }}>
              <input
                placeholder="CPF/CNPJ na nota (opcional)"
                value={documento}
                onChange={e => setDocumento(mascararDocumentoDigitado(e.target.value))}
                inputMode="numeric"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 8,
                  border: `1.5px solid ${problemaDoDocumento(documento) ? "#DC2626" : documento.trim() ? "#0EA5E9" : "#E2E8F0"}`,
                  background: problemaDoDocumento(documento) ? "#FEF2F2" : documento.trim() ? "#F0F9FF" : "#FFF",
                  fontSize: "0.85rem", outline: "none", fontFamily: "inherit", fontWeight: documento.trim() ? 800 : 400 }}
              />
              {/* O campo diz sozinho em que pé está: erro em vermelho enquanto
                  o número não fecha, confirmação em verde quando fecha. Sem
                  isso o atendente só descobriria o dígito trocado ao tentar
                  finalizar — com o cliente já indo embora. */}
              {documento.trim() !== "" && (
                <div style={{ fontSize: "0.72rem", marginTop: 3, fontWeight: 700,
                  color: problemaDoDocumento(documento) ? "#B91C1C" : "#15803D" }}>
                  {problemaDoDocumento(documento) || `✓ ${tipoDoDocumento(documento)} válido — sai na comanda`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Carrinho */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 16px" }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#CBD5E1" }}>
              <ShoppingCart size={40} style={{ margin: "0 auto 10px" }} />
              <p style={{ fontSize: "0.85rem" }}>Clique nos produtos para adicionar</p>
            </div>
          ) : cart.map((item, index) => (
            <div key={index} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{item.product.name}</div>
                {item.comboSelections && item.comboSelections.length > 0 && (
                  <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 2, background: "#F8FAFC", padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0" }}>
                    {item.comboSelections.map((s, sIdx) => (
                      <div key={sIdx}>• {s.quantity}x {s.name}</div>
                    ))}
                  </div>
                )}
                {/* Observação do item, editável na própria linha: produto sem
                    complemento não passa pelo modal, e "sem cebola" precisa
                    de um lugar para ser escrito. Vai para a cozinha e para a
                    comanda como Obs: do item. */}
                <input
                  value={item.notes || ""}
                  placeholder="📝 obs. do item (ex.: sem cebola)"
                  maxLength={140}
                  onChange={e => { const v = e.target.value; setCart(prev => prev.map((c, idx) => idx === index ? { ...c, notes: v } : c)); }}
                  style={{ width: "100%", marginTop: 4, padding: "4px 8px", borderRadius: 6, border: `1px solid ${item.notes ? "#F59E0B" : "#E2E8F0"}`, background: item.notes ? "#FFFBEB" : "#fff", fontSize: "0.74rem", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                />
                <div style={{ fontSize: "0.78rem", color: "#C62828", fontWeight: 700, marginTop: 2 }}>{fmt((item.unitPrice ?? item.product.price) * item.qty)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => updateQtyByIndex(index, item.qty - 1)}
                  style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #E2E8F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {item.qty === 1 ? <Trash2 size={12} color="#EF4444" /> : <Minus size={12} />}
                </button>
                <span style={{ width: 22, textAlign: "center", fontWeight: 800, fontSize: "0.9rem" }}>{item.qty}</span>
                <button onClick={() => updateQtyByIndex(index, item.qty + 1)}
                  style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #C62828", background: "#C62828", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer: pagamento + total */}
        <div style={{ padding: "10px 14px 75px 14px", borderTop: "1px solid #E2E8F0", background: "#FAFAFA", position: "relative", zIndex: 50, flexShrink: 0 }}>
          {/* Forma de pagamento */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.4px", display: "block", marginBottom: 3 }}>Pagamento</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[...PAYMENT_METHODS, ...(employeeAccountEnabled ? ["Conta Funcionário"] : [])].map(m => (
                <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                  style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${paymentMethod === m ? "#C62828" : "#CBD5E1"}`,
                    background: paymentMethod === m ? "#C62828" : "#fff",
                    color: paymentMethod === m ? "#fff" : "#334155",
                    fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {m === "Conta Funcionário" ? "👤 Conta Funcionário" : m}
                </button>
              ))}
              {/* Dividir entre formas, igual à mesa: metade no Pix, metade em dinheiro. */}
              <button type="button" onClick={() => ligarDivisao(!dividir)}
                style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${dividir ? "#7C3AED" : "#CBD5E1"}`,
                  background: dividir ? "#7C3AED" : "#fff", color: dividir ? "#fff" : "#334155",
                  fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}
                title="Receber em mais de uma forma (ex.: parte no Pix, parte em dinheiro)">
                ➗ Dividir
              </button>
            </div>
          </div>

          {dividir && (
            <div style={{ marginBottom: 6, background: "#F5F3FF", border: "1.5px solid #DDD6FE", borderRadius: 8, padding: "8px" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#5B21B6", marginBottom: 6 }}>
                Pagamento dividido — cada parte entra no caixa na sua forma
              </div>
              {partes.map((p, idx) => (
                <div key={idx} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                  <select value={p.metodo} onChange={e => setParte(idx, { metodo: e.target.value })}
                    style={{ flex: "1 1 90px", padding: "5px 6px", borderRadius: 6, border: "1px solid #C4B5FD", fontSize: "0.78rem", fontFamily: "inherit", background: "#fff" }}>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0,00" value={p.valor}
                    onChange={e => setParte(idx, { valor: e.target.value })}
                    style={{ width: 84, padding: "5px 6px", borderRadius: 6, border: "1px solid #C4B5FD", fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit" }} />
                  <button type="button" onClick={() => completarParte(idx)} title="Preencher com o que falta"
                    style={{ padding: "5px 7px", borderRadius: 6, border: "1px solid #C4B5FD", background: "#fff", color: "#5B21B6", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                    resto
                  </button>
                  {partes.length > 2 && (
                    <button type="button" onClick={() => setPartes(prev => prev.filter((_, i) => i !== idx))} title="Remover esta forma"
                      style={{ padding: "5px 7px", borderRadius: 6, border: "none", background: "#FEE2E2", color: "#DC2626", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 4 }}>
                <button type="button" onClick={() => setPartes(prev => [...prev, { metodo: "Cartão Crédito", valor: "" }])}
                  style={{ padding: "4px 8px", borderRadius: 6, border: "1px dashed #A78BFA", background: "#fff", color: "#5B21B6", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  + outra forma
                </button>
                <span style={{ fontSize: "0.76rem", fontWeight: 800, color: Math.abs(faltaDividir) <= 0.01 ? "#15803D" : "#B45309" }}>
                  {Math.abs(faltaDividir) <= 0.01 ? `✓ fecha ${fmt(total)}` : faltaDividir > 0 ? `faltam ${fmt(faltaDividir)}` : `sobram ${fmt(-faltaDividir)}`}
                </span>
              </div>
            </div>
          )}

          {/* Seleção do Funcionário quando forma for Conta Funcionário */}
          {paymentMethod === "Conta Funcionário" && (
            <div style={{ marginBottom: 6, background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 8, padding: "8px" }}>
              <label style={{ fontSize: "0.72rem", fontWeight: 800, color: "#991B1B", display: "block", marginBottom: 4 }}>
                Selecione o Funcionário *
              </label>
              {employees.length === 0 ? (
                <div style={{ fontSize: "0.75rem", color: "#7F1D1D" }}>
                  Nenhum funcionário cadastrado. Cadastre em <a href="/store/funcionarios" style={{ color: "#C62828", fontWeight: 700 }}>Funcionários</a>.
                </div>
              ) : (
                <select
                  value={selectedEmployeeId}
                  onChange={e => {
                    const empId = e.target.value;
                    setSelectedEmployeeId(empId);
                    const found = employees.find(emp => emp.id === empId);
                    setSelectedEmployeeName(found ? found.name : "");
                  }}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #C62828", fontSize: "0.85rem", fontWeight: 700, color: "#1E293B", outline: "none" }}
                >
                  <option value="">-- Escolha um colaborador --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.role || "Funcionário"}) — Dívida: R$ {(emp.currentDebt || 0).toFixed(2).replace(".", ",")}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Acréscimo voucher */}
          {isVoucher && (
            <div style={{ marginBottom: 6, fontSize: "0.72rem", color: "#D97706", background: "#FFFBEB", padding: "4px 8px", borderRadius: 6, border: "1px solid #FDE68A" }}>
              Taxa de vale ({voucherRate}%): <strong>+{fmt(voucherFee)}</strong>
            </div>
          )}

          {/* Troco (só Dinheiro — no dividido, sobre a parte em dinheiro) */}
          {(paymentMethod === "Dinheiro" || (dividir && parteDinheiro > 0)) && (
            <input type="number" placeholder={dividir ? `Cliente deu em dinheiro... (parte: ${fmt(parteDinheiro)})` : "Troco para... (opcional)"} value={change} onChange={e => setChange(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none", fontFamily: "inherit" }} />
          )}
          {(paymentMethod === "Dinheiro" || (dividir && parteDinheiro > 0)) && change && Number(change) > 0 && (
            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "4px 8px", marginBottom: 6, fontSize: "0.75rem", color: "#16A34A", fontWeight: 700 }}>
              💵 Troco: {fmt(Math.max(0, Number(change) - (dividir ? parteDinheiro : total)))}
            </div>
          )}

          {/* Obs */}
          <input placeholder="Observações do pedido (opcional)..." value={notes} onChange={e => setNotes(e.target.value)}
            style={{ width: "100%", marginBottom: 6, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none", fontFamily: "inherit" }} />

          {/* ── DESCONTO NA MÃO ──────────────────────────────────────────
              Porcentagem ou valor, com motivo. Sem motivo, o desconto vira
              furo de caixa que ninguém explica no fim do mês. */}
          {cart.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {!mostrarDesconto && descontoEmReais === 0 ? (
                <button type="button" onClick={() => setMostrarDesconto(true)}
                  style={{ width: "100%", padding: "7px", borderRadius: 9, border: "1.5px dashed #CBD5E1", background: "#F8FAFC", color: "#475569", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
                  🏷️ Dar desconto
                </button>
              ) : (
                <div style={{ border: "1.5px solid #FED7AA", background: "#FFFBF5", borderRadius: 11, padding: "9px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                    <b style={{ fontSize: "0.8rem", color: "#9A3412" }}>🏷️ Desconto</b>
                    <button type="button" onClick={limparDesconto}
                      style={{ marginLeft: "auto", background: "none", border: "none", color: "#94A3B8", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                      remover
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
                    {([
                      { t: "percent" as const, r: "%" },
                      { t: "valor" as const, r: "R$" },
                    ]).map((op) => (
                      <button key={op.t} type="button" onClick={() => setDesconto(d => ({ ...d, tipo: op.t }))}
                        style={{
                          padding: "7px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                          border: desconto.tipo === op.t ? "2px solid #C2410C" : "1.5px solid #E2E8F0",
                          background: desconto.tipo === op.t ? "#FFF7ED" : "#fff",
                          color: desconto.tipo === op.t ? "#9A3412" : "#64748B",
                          fontWeight: 800, fontSize: "0.84rem",
                        }}>
                        {op.r}
                      </button>
                    ))}
                    <input
                      type="number" min="0" step="0.5" inputMode="decimal"
                      placeholder={desconto.tipo === "percent" ? "10" : "5,00"}
                      value={desconto.valor === 0 ? "" : desconto.valor}
                      onChange={e => setDesconto(d => ({ ...d, valor: parseFloat(e.target.value) || 0 }))}
                      style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 9, border: "1.5px solid #FED7AA", background: "#fff", fontSize: "0.9rem", fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit" }}
                    />
                  </div>

                  <input
                    placeholder="Por que o desconto? (aparece na comanda)"
                    value={desconto.motivo || ""}
                    onChange={e => setDesconto(d => ({ ...d, motivo: e.target.value.slice(0, 60) }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 9, border: "1.5px solid #E2E8F0", fontSize: "0.8rem", outline: "none", fontFamily: "inherit", marginBottom: 6 }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {MOTIVOS_COMUNS.map(m => (
                      <button key={m} type="button" onClick={() => setDesconto(d => ({ ...d, motivo: m }))}
                        style={{ padding: "4px 9px", borderRadius: 999, border: "1px solid #E2E8F0", background: desconto.motivo === m ? "#FFF7ED" : "#fff", color: desconto.motivo === m ? "#9A3412" : "#64748B", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        {m}
                      </button>
                    ))}
                  </div>

                  {problemaDoDesconto(desconto, subtotal) && desconto.valor > 0 && (
                    <p style={{ margin: "7px 0 0", fontSize: "0.74rem", color: "#B91C1C", fontWeight: 700 }}>
                      {problemaDoDesconto(desconto, subtotal)}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Total */}
          {cart.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {(isVoucher && voucherRate > 0) || descontoEmReais > 0 ? (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#64748B", marginBottom: 2 }}>
                  <span>Subtotal</span><span>{fmt(subtotal)}</span>
                </div>
              ) : null}
              {descontoEmReais > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#C2410C", fontWeight: 800, marginBottom: 2 }}>
                  <span>Desconto{desconto.motivo ? ` (${desconto.motivo})` : ""}</span>
                  <span>- {fmt(descontoEmReais)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "1.05rem" }}>
                <span>TOTAL</span><span style={{ color: "#C62828" }}>{fmt(total)}</span>
              </div>
            </div>
          )}

          {msg && <div style={{ padding: "6px 10px", borderRadius: 8, marginBottom: 6, background: msg.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: msg.startsWith("✅") ? "#16a34a" : "#dc2626", fontSize: "0.8rem", fontWeight: 700 }}>{msg}</div>}

          {/* ── CAIXA FECHADO ────────────────────────────────────────────────
              Fica logo ACIMA do botão, que é onde o atendente vai clicar, e
              não no topo da tela: o carrinho rola, e um aviso lá em cima
              sumiria justamente no momento de finalizar.

              Traz o atalho para abrir o caixa em outra aba — o carrinho fica
              montado aqui, e ao voltar é só finalizar. Nada se perde. */}
          {caixaAberto === false && (
            <div style={{ padding: "12px 14px", borderRadius: 12, marginBottom: 8, background: "#FEF2F2", border: "1.5px solid #FECACA" }}>
              <div style={{ fontWeight: 900, fontSize: "0.9rem", color: "#B91C1C", marginBottom: 4 }}>
                🔒 Seu caixa está fechado
              </div>
              <div style={{ fontSize: "0.78rem", color: "#7F1D1D", lineHeight: 1.5, marginBottom: 8 }}>
                Abra o caixa primeiro para poder lançar pedidos — sem ele o dinheiro desta venda não entra no fechamento do dia. O que você já montou aqui não se perde.
              </div>
              <a
                href={CAMINHO_DO_CAIXA}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", padding: "8px 14px", borderRadius: 10, background: "#B91C1C", color: "#fff", fontWeight: 800, fontSize: "0.82rem", textDecoration: "none" }}
              >
                Abrir o caixa →
              </a>
            </div>
          )}

          <button type="button" data-btn="finalizar" onClick={handleSubmit} disabled={loading || cart.length === 0 || caixaAberto === false}
            style={{ width: "100%", padding: "14px", background: (cart.length === 0 || caixaAberto === false) ? "#CBD5E1" : "linear-gradient(135deg, #C62828, #E53935)", color: (cart.length === 0 || caixaAberto === false) ? "#64748B" : "#fff", border: "none", borderRadius: 14, fontWeight: 900, fontSize: "1.05rem", cursor: (cart.length === 0 || caixaAberto === false) ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: (cart.length > 0 && caixaAberto !== false) ? "0 4px 14px rgba(198,40,40,0.4)" : "none", position: "relative", zIndex: 9999 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
              {caixaAberto === false ? "🔒 Abra o caixa para lançar" : loading ? "Registrando..." : <><Check size={20} style={{ pointerEvents: "none" }} /> Finalizar Pedido</>}
            </span>
          </button>
        </div>
      </div>

      {/* COMBO SELECTION MODAL */}
      {comboProduct && (
        <ComboModal
          product={{
            id: comboProduct.id,
            name: comboProduct.name,
            price: comboProduct.price,
            imageUrl: comboProduct.imageUrl,
            comboGroups: comboProduct.comboGroups || []
          }}
          onClose={() => setComboProduct(null)}
          onConfirm={(selections, extraSum, qty, notes) => {
            const formatted: { name: string; quantity: number }[] = [];
            Object.values(selections).forEach(groupObj => {
              Object.entries(groupObj).forEach(([itemName, qty]) => {
                if (qty > 0) formatted.push({ name: itemName, quantity: qty });
              });
            });
            // Quantidade e observação do modal iam para o lixo: entrava 1
            // unidade, sem a observação que o atendente acabou de digitar.
            addToCart(comboProduct, formatted, extraSum, qty, notes);
            setComboProduct(null);
          }}
        />
      )}
    </div>
  );
}
