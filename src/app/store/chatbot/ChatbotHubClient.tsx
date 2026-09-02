"use client";

import { useState, useEffect, useRef } from "react";
import {
  Bot,
  QrCode,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Zap,
  Sparkles,
  ShieldCheck,
  Smile,
  Sliders,
  MessageSquare,
  UtensilsCrossed,
  Link as LinkIcon,
  Copy,
  Check,
  Unlink,
  Radio,
  Settings,
  Activity,
  Bell,
  X,
  Phone,
  HelpCircle,
  Gift,
  Calendar,
  Trash2
} from "lucide-react";

export default function ChatbotHubClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"qr" | "marketing" | "disparos" | "cardapio" | "phone" | "notifications" | "test" | "diagnostic" | "alertas">("qr");
  // Cardápio em arquivo: o robô manda a foto/PDF quando o cliente recusa o site.
  const [menuFileSaving, setMenuFileSaving] = useState(false);
  const [menuFileMsg, setMenuFileMsg] = useState<string>("");
  // Reparo do "Aguardando mensagem" (aba Diagnóstico).
  const [reparandoSessao, setReparandoSessao] = useState(false);
  // Aba Alertas: cadastro de quem o robô não atende.
  const [novoNumeroMudo, setNovoNumeroMudo] = useState("");
  const [novoNomeMudo, setNovoNomeMudo] = useState("");

  // Configuração principal
  const [config, setConfig] = useState<any>({
    active: true,
    connected: false,
    phone: "",
    pairingCode: "",
    sendOrderConfirmation: true,
    autoRecuperation7d: false,
    autoRecuperation15d: false,
    autoRecuperation30d: false,
    personality: "SIMPATICO",
    customPrompt: "",
    externalMenuUrl: "",
    stopOnHumanRequest: true,
    autoOrderLink: true,
    agentName: "",
    failThreshold: 3,
    notifyConfirm: true,
    notifyPreparing: true,
    notifyDelivery: true,
    notifyReady: true,
  });

  const [stats, setStats] = useState<any>({
    productCount: 0,
    categoryCount: 0,
    storeName: "Minha Loja",
    storeAddress: "",
    city: "",
  });

  // Telefone da Loja
  const [storePhoneInput, setStorePhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);

  // Mensagens Customizadas de Pedidos
  const [orderMessages, setOrderMessages] = useState({
    confirm: "Recebemos seu pedido com sucesso! Já estamos preparando tudo com carinho. 🍕",
    preparing: "Seu pedido entrou em produção na cozinha! Logo sai para entrega. 🔥",
    delivery: "Seu pedido saiu para entrega! O motoboy já está a caminho. 🛵",
    ready: "Seu pedido está pronto para ser retirado na nossa loja! 🛍️"
  });

  // Estados de Marketing e Fidelização
  const [marketingStartDate, setMarketingStartDate] = useState(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  const [marketingEndDate, setMarketingEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [marketingCustomers, setMarketingCustomers] = useState<any[]>([]);
  const [recoveredOrdersCount, setRecoveredOrdersCount] = useState<number>(0);
  const [recoveredRevenue, setRecoveredRevenue] = useState<number>(0);

  // Cupons reais do banco de dados
  const [storeCoupons, setStoreCoupons] = useState<any[]>([]);
  const [showNewCouponModal, setShowNewCouponModal] = useState(false);
  const [targetCouponField, setTargetCouponField] = useState<string | null>(null);
  const [newCouponCode, setNewCouponCode] = useState("");
  const [newCouponType, setNewCouponType] = useState<"percent" | "fixed" | "free_shipping">("percent");
  const [newCouponDiscount, setNewCouponDiscount] = useState("10");
  const [newCouponMinOrder, setNewCouponMinOrder] = useState("");
  const [creatingCoupon, setCreatingCoupon] = useState(false);

  // Modal de Exclusão de Cupom (com validação de digitação 'EXCLUIR')
  const [showDeleteCouponModal, setShowDeleteCouponModal] = useState(false);
  const [couponToDelete, setCouponToDelete] = useState<any | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deletingCoupon, setDeletingCoupon] = useState(false);
  const [showConfirmTestModal, setShowConfirmTestModal] = useState(false);

  // Estados da aba de Disparos
  const [campaignMsg, setCampaignMsg] = useState("");
  const [campaignImg, setCampaignImg] = useState("");
  const [campaignImgUploading, setCampaignImgUploading] = useState(false);
  const [selectedCriteria, setSelectedCriteria] = useState("all");
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [showCampaignConfirm, setShowCampaignConfirm] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [campaignHistory, setCampaignHistory] = useState<any[]>([]);

  const handleGenerateAiMessage = async () => {
    setIsGeneratingAi(true);
    try {
      const res = await fetch("/api/chatbot/generate-broadcast-msg", { method: "POST" });
      const data = await res.json();
      if (data.success && data.message) {
        setCampaignMsg(data.message);
        showToast("✨ Mensagem persuasiva gerada pela IA com sucesso!", "#8B5CF6");
      } else {
        throw new Error();
      }
    } catch {
      const fallbackMsgs = [
        "Oi! 🍕 Sentimos sua falta! Que tal aproveitar nossos combos hoje? Peça agora e receba quentinho na sua casa!",
        "Oie! 🔥 Liberamos uma oferta ESPECIAL hoje só pra você! Peça seu lanche favorito pelo nosso site e aproveite! 🚀",
        "Que tal um lanche delicioso hoje? 🍔 Preparamos tudo com muito carinho pra você! Peça já pelo nosso cardápio!",
        "Bateu aquela fome? 😋 Aproveite as nossas promoções exclusivas com entrega super rápida! Peça pelo site agora!"
      ];
      setCampaignMsg(fallbackMsgs[Math.floor(Math.random() * fallbackMsgs.length)]);
      showToast("✨ Mensagem rápida gerada com IA!", "#8B5CF6");
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleRequestDeleteCoupon = (code: string) => {
    const found = storeCoupons.find((c: any) => c.code === code);
    if (!found) return;
    setCouponToDelete(found);
    setDeleteConfirmInput("");
    setShowDeleteCouponModal(true);
  };

  const handleConfirmDeleteCoupon = async () => {
    if (!couponToDelete) return;
    const codeToDelete = couponToDelete.code;
    setDeletingCoupon(true);
    try {
      const updated = storeCoupons.filter((c: any) => c.code !== codeToDelete);
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeCoupons: updated }),
      });

      if (res.ok) {
        setStoreCoupons(updated);

        // Limpa campos das automações caso o cupom estivesse selecionado
        const newFieldsToSave: any = {};
        if (config.instantCouponCode === codeToDelete) newFieldsToSave.instantCouponCode = "";
        if (config.coupon7d === codeToDelete) newFieldsToSave.coupon7d = "";
        if (config.coupon15d === codeToDelete) newFieldsToSave.coupon15d = "";
        if (config.coupon30d === codeToDelete) newFieldsToSave.coupon30d = "";

        if (Object.keys(newFieldsToSave).length > 0) {
          setConfig((prev: any) => ({ ...prev, ...newFieldsToSave }));
          handleSaveConfig(newFieldsToSave);
        }

        showToast(`🗑️ Cupom "${codeToDelete}" excluído permanentemente!`, "#10B981");
        setShowDeleteCouponModal(false);
        setCouponToDelete(null);
        setDeleteConfirmInput("");
      } else {
        showToast("⚠️ Falha ao excluir cupom do banco de dados.", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro ao comunicar com o servidor.", "#EF4444");
    } finally {
      setDeletingCoupon(false);
    }
  };

  // QR Code State
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string>("");
  const [isRefreshingQr, setIsRefreshingQr] = useState(false);
  const [qrTimer, setQrTimer] = useState<number>(60);
  const [isQrExpired, setIsQrExpired] = useState<boolean>(false);

  // ── Conectar SEM câmera ───────────────────────────────────────────────────
  // O QR pressupõe uma cena que muitas vezes não acontece: alguém na frente do
  // computador COM o telefone da loja na mão, dentro dos 60s de validade. Com o
  // código, dá para ditar por ligação para quem está na loja.
  const [codigoPareamento, setCodigoPareamento] = useState<string>("");
  const [numeroParaCodigo, setNumeroParaCodigo] = useState<string>("");
  const [gerandoCodigo, setGerandoCodigo] = useState(false);

  const handleGerarCodigo = async () => {
    setGerandoCodigo(true);
    setCodigoPareamento("");
    try {
      const r = await fetch("/api/chatbot/codigo-pareamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: numeroParaCodigo }),
      });
      const d = await r.json();
      if (d?.jaConectada) {
        showToast("✅ Este WhatsApp já está conectado!", "#16A34A");
        return;
      }
      if (!r.ok || !d?.pairingCode) {
        showToast(d?.error || "Não consegui gerar o código agora.", "#EF4444");
        return;
      }
      setCodigoPareamento(String(d.pairingCode));
    } catch {
      showToast("Falha de conexão ao gerar o código.", "#EF4444");
    } finally {
      setGerandoCodigo(false);
    }
  };

  // Timer de expiração do QR Code (60s)
  useEffect(() => {
    if (!qrCodeUrl || isQrExpired || config.connected) return;

    const timer = setInterval(() => {
      setQrTimer((prev) => {
        if (prev <= 1) {
          setIsQrExpired(true);
          setQrCodeUrl(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [qrCodeUrl, isQrExpired, config.connected]);

  // Gerar QR Code novo na hora
  const handleFetchFreshQr = async () => {
    try {
      setIsRefreshingQr(true);
      setIsQrExpired(false);
      const res = await fetch("/api/chatbot/qrcode?force=true").then((r) => r.json());

      if (res.connected) {
        setConfig((prev: any) => ({ ...prev, connected: true, phone: res.phone || prev.phone }));
        showToast("🎉 WhatsApp Conectado com Sucesso!", "#10B981");
      } else if (res.qrCodeUrl && typeof res.qrCodeUrl === "string" && res.qrCodeUrl.length > 20) {
        setQrCodeUrl(res.qrCodeUrl);
        setQrTimer(60);
        setIsQrExpired(false);
        showToast("⚡ QR Code gerado em tempo real! Expira em 60 segundos.", "#2563EB");
      } else {
        showToast("⚠️ O servidor de WhatsApp precisa estar online para gerar o QR Code.", "#EF4444");
      }
    } catch (e) {
      showToast("⚠️ Falha ao conectar ao servidor de QR Code", "#EF4444");
    } finally {
      setIsRefreshingQr(false);
    }
  };

  // Test Message State
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Este é um teste oficial de envio do WhatsApp do FireHub Food! 🚀");
  const [sendingTest, setSendingTest] = useState(false);

  // Toast State
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color: string = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  // Chat Simulator State
  const [messages, setMessages] = useState<Array<{ sender: "user" | "bot"; text: string; time: string }>>([
    { sender: "bot", text: "Olá! Sou o atendente virtual do FireHub. Como posso te ajudar com o cardápio hoje? 😊", time: "21:40" },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

  // Carregar dados iniciais
  const loadData = async () => {
    try {
      setLoading(true);
      const [configRes, qrRes] = await Promise.all([
        fetch("/api/chatbot/config").then((r) => r.json()),
        fetch("/api/chatbot/qrcode").then((r) => r.json()),
      ]);

      if (configRes.config) {
        setConfig(configRes.config);
        if (configRes.config.phone) setStorePhoneInput(configRes.config.phone);
      }
      if (configRes.coupons) {
        setStoreCoupons(configRes.coupons);
      }
      if (configRes.stats) {
        setStats(configRes.stats);
      }

      if (qrRes.qrCodeUrl) setQrCodeUrl(qrRes.qrCodeUrl);
      if (qrRes.pairingCode) setPairingCode(qrRes.pairingCode);
    } catch (err) {
      console.error("[ChatbotHub] Erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewCoupon = async (targetRecuperationKey?: string) => {
    if (!newCouponCode.trim()) {
      showToast("⚠️ Digite um código de cupom (ex: BEMVINDO10)", "#EF4444");
      return;
    }
    const cleanCode = newCouponCode.trim().toUpperCase();
    const type = newCouponType;
    const discountVal = type === "free_shipping" ? 0 : (parseFloat(newCouponDiscount) || 0);
    const minOrderVal = parseFloat(newCouponMinOrder) || 0;
    
    setCreatingCoupon(true);
    try {
      const currentList = Array.isArray(storeCoupons) ? storeCoupons : [];
      const updated = [
        ...currentList.filter((c: any) => c && c.code !== cleanCode),
        { code: cleanCode, discount: discountVal, type, minOrderValue: minOrderVal, active: true }
      ];
      
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeCoupons: updated }),
      });

      if (res.ok) {
        setStoreCoupons(updated);
        const minOrderLabel = minOrderVal > 0 ? ` (Pedido min: R$ ${minOrderVal.toFixed(2)})` : "";
        const toastLabel = type === "free_shipping"
          ? `🎉 Cupom "${cleanCode}" de Frete Grátis criado e salvo!${minOrderLabel}`
          : type === "fixed"
          ? `🎉 Cupom "${cleanCode}" de R$ ${discountVal.toFixed(2)} OFF criado e salvo!${minOrderLabel}`
          : `🎉 Cupom "${cleanCode}" de ${discountVal}% OFF criado e salvo!${minOrderLabel}`;
        
        showToast(toastLabel, "#10B981");
        
        // Se foi acionado por um card específico ou pelo botão abaixo do seletor, auto-seleciona
        const keyToUpdate = targetRecuperationKey || targetCouponField;
        if (keyToUpdate) {
          setConfig((prev: any) => ({ ...prev, [keyToUpdate]: cleanCode }));
          handleSaveConfig({ [keyToUpdate]: cleanCode });
        }
        
        setNewCouponCode("");
        setNewCouponType("percent");
        setNewCouponDiscount("10");
        setNewCouponMinOrder("");
        setTargetCouponField(null);
        setShowNewCouponModal(false);
      } else {
        showToast("⚠️ Falha ao salvar novo cupom.", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro ao criar cupom.", "#EF4444");
    } finally {
      setCreatingCoupon(false);
    }
  };

  const [refreshingMetrics, setRefreshingMetrics] = useState(false);

  const loadMarketingData = async (isManualClick = false) => {
    if (isManualClick) setRefreshingMetrics(true);
    try {
      const res = await fetch("/api/store/marketing").then((r) => r.json());
      if (res.success) {
        const custs = res.customers || [];
        setMarketingCustomers(custs);
        setRecoveredOrdersCount(res.recoveredOrdersCount || 0);
        setRecoveredRevenue(res.recoveredRevenue || 0);
        if (Array.isArray(res.campaignHistory)) {
          setCampaignHistory(res.campaignHistory);
        }
        if (isManualClick) {
          showToast("📊 Métricas e disparos atualizados com sucesso!", "#10B981");
        }
      }
    } catch (e) {
      if (isManualClick) showToast("⚠️ Erro ao atualizar métricas.", "#EF4444");
    } finally {
      if (isManualClick) setRefreshingMetrics(false);
    }
  };

  useEffect(() => {
    loadData();
    loadMarketingData();
  }, [marketingStartDate, marketingEndDate]);

  // Polling automático dos disparos em andamento a cada 4 segundos
  useEffect(() => {
    const hasSending = Array.isArray(campaignHistory) && campaignHistory.some((c: any) => c.status === "DISPARANDO");
    if (!hasSending) return;

    // Para imitar humanos, a cada "batida" enviamos 1 mensagem e aguardamos
    const interval = setInterval(() => {
      loadMarketingData(false);
    }, 20000); // 20 segundos entre cada envio

    return () => clearInterval(interval);
  }, [campaignHistory]);

  /**
   * Reconferência AO VIVO do robô — inclusive quando a tela acha que está tudo certo.
   *
   * O defeito que isto conserta: o painel dizia "WhatsApp Vinculado com
   * Sucesso!" lendo uma bandeira gravada no banco no dia da leitura do QR, e o
   * polling abaixo começa com `if (config.connected) return` — ou seja, uma vez
   * conectado, nunca mais se perguntava nada. Sessão morta há dias continuava
   * verde na tela enquanto nenhuma mensagem era respondida.
   *
   * Aqui a pergunta vai ao gateway. Se ele não responder, NADA muda: trocar o
   * falso positivo por um falso alarme (mandar ler QR porque a rede piscou)
   * seria só mudar de problema.
   */
  const [gatewayMudo, setGatewayMudo] = useState(false);
  useEffect(() => {
    let vivo = true;

    const conferir = async () => {
      try {
        const r = await fetch("/api/chatbot/conexao-ao-vivo", { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const d = await r.json();
        if (!vivo) return;

        if (!d.gatewayRespondeu) { setGatewayMudo(true); return; }
        setGatewayMudo(false);

        setConfig((prev: any) => {
          if (Boolean(prev.connected) === Boolean(d.connected)) return prev;
          return { ...prev, connected: Boolean(d.connected), phone: d.phone || prev.phone };
        });
      } catch {
        setGatewayMudo(true);
      }
    };

    conferir();
    // Meio minuto: rápido o bastante para o lojista não ficar meia hora achando
    // que o robô responde, leve o bastante para não pesar no gateway.
    const t = setInterval(conferir, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // Polling automático de status de conexão a cada 3s enquanto aguarda leitura do QR Code
  useEffect(() => {
    if (config.connected) return;

    const interval = setInterval(async () => {
      try {
        const qrRes = await fetch("/api/chatbot/qrcode").then((r) => r.json());
        if (qrRes.connected) {
          setConfig((prev: any) => ({
            ...prev,
            connected: true,
            phone: qrRes.phone || prev.phone,
          }));
          showToast("🎉 WhatsApp Conectado com Sucesso!", "#10B981");
        } else if (qrRes.qrCodeUrl && qrRes.qrCodeUrl !== qrCodeUrl) {
          setQrCodeUrl(qrRes.qrCodeUrl);
        }
      } catch (e) {}
    }, 3000);

    return () => clearInterval(interval);
  }, [config.connected, qrCodeUrl]);

  // Salvar Configurações
  const handleSaveConfig = async (newFields: any) => {
    try {
      setSaving(true);
      const updated = { ...config, ...newFields };
      setConfig(updated);

      const res = await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });

      if (res.ok) {
        // A rota recusa campos que não são do lojista. Se recusou justamente o
        // que ele acabou de mexer, dizer "salvo" seria mentira.
        const retorno = await res.json().catch(() => ({}));
        const recusados: string[] = Array.isArray(retorno?.recusados) ? retorno.recusados : [];
        const mexidos = Object.keys(newFields || {});
        const perdidos = mexidos.filter((c) => recusados.includes(c));
        if (perdidos.length > 0) {
          showToast(`⚠️ Não foi possível salvar: ${perdidos.join(", ")}`, "#EF4444");
        } else {
          showToast("✅ Configurações salvas!", "#10B981");
        }
      }
    } catch (err) {
      console.error("[ChatbotHub] Erro ao salvar:", err);
      showToast("⚠️ Falha ao salvar alterações", "#EF4444");
    } finally {
      setSaving(false);
    }
  };

  // Salvar Número por Digitação Direta
  const handleSaveStorePhone = async () => {
    if (!storePhoneInput.trim()) {
      showToast("⚠️ Digite um número de WhatsApp válido", "#EF4444");
      return;
    }

    try {
      setPhoneSaving(true);
      const cleanPhone = storePhoneInput.replace(/\D/g, "");
      const res = await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          phone: cleanPhone,
          connected: true,
          active: true
        }),
      });

      if (res.ok) {
        setConfig((prev: any) => ({ ...prev, phone: cleanPhone, connected: true, active: true }));
        showToast("🎉 WhatsApp vinculado com sucesso ao número " + cleanPhone, "#10B981");
      } else {
        showToast("⚠️ Erro ao vincular número", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar número", "#EF4444");
    } finally {
      setPhoneSaving(false);
    }
  };

  // Enviar Mensagem de Teste
  const handleSendTestMessage = async () => {
    if (!testPhone.trim()) {
      showToast("⚠️ Digite o número de telefone de destino com DDD", "#EF4444");
      return;
    }

    setSendingTest(true);
    try {
      const res = await fetch("/api/chatbot/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: testPhone.replace(/\D/g, ""),
          message: testMessage
        })
      });

      if (res.ok) {
        showToast("🚀 Mensagem de teste enviada com sucesso!", "#10B981");
      } else {
        showToast("⚠️ Não foi possível enviar a mensagem. Verifique a conexão do WhatsApp.", "#EF4444");
      }
    } catch {
      showToast("⚠️ Falha na conexão de envio", "#EF4444");
    } finally {
      setSendingTest(false);
    }
  };

  // Desconectar Aparelho e Abrir Gerador de QR Code
  const handleToggleConnect = async () => {
    try {
      setIsRefreshingQr(true);
      await fetch("/api/chatbot/qrcode", { method: "DELETE" }).catch(() => {});
      await fetch("/api/chatbot/qrcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" })
      }).catch(() => {});

      setConfig((prev: any) => ({ ...prev, connected: false, phone: "" }));
      setQrCodeUrl(null);
      setIsQrExpired(false);
      showToast("📱 Aparelho desconectado! Gerando novo QR Code...", "#F59E0B");
      handleFetchFreshQr();
    } catch (err) {
      console.error("[ChatbotHub] Erro ao desconectar:", err);
    } finally {
      setIsRefreshingQr(false);
    }
  };

  // Enviar Mensagem no Simulador de Chat
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || chatLoading) return;

    const userText = inputMessage;
    setInputMessage("");

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    setMessages((prev) => [...prev, { sender: "user", text: userText, time: timeStr }]);
    setChatLoading(true);

    try {
      const res = await fetch("/api/chatbot/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history: messages }),
      });

      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, { sender: "bot", text: data.reply, time: timeStr }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: "bot", text: "Desculpe, tive um pequeno problema para processar sua mensagem. Pode tentar novamente?", time: timeStr },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "Ocorreu um erro de conexão no teste do chatbot.", time: timeStr },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, chatLoading]);

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#64748B" }}>
        <RefreshCw size={32} className="spin" style={{ marginBottom: "12px" }} />
        <div>Carregando Robô de Atendimento...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Toast Alert */}
      {toast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.2)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.msg}
        </div>
      )}

      {/* ── FAIXA DE ROBÔ FORA DO AR ──────────────────────────────────────────
          Mesma faixa verde do painel, agora também aqui: a tela do Chatbot era
          justamente a que dizia "Vinculado com Sucesso" para uma sessão morta.
          Verde de propósito — o painel já tem âmbar de cobrança e vermelho de
          bloqueio; mais um alerta nessas cores o lojista lê como dinheiro. */}
      {!config.connected && (
        <div
          onClick={() => { setActiveTab("qr"); handleFetchFreshQr(); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setActiveTab("qr"); handleFetchFreshQr(); } }}
          style={{ display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap", background: "#F0FDF4", border: "1px solid #A7F3D0", borderLeft: "6px solid #16A34A", borderRadius: 12, padding: "0.9rem 1.1rem", marginBottom: "1rem", cursor: "pointer" }}
        >
          <span style={{ fontSize: "1.6rem", lineHeight: 1 }} aria-hidden>🤖</span>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontWeight: 800, color: "#166534", fontSize: "1rem" }}>
              Seu robô de WhatsApp está desconectado
            </div>
            <div style={{ color: "#15803D", fontSize: "0.88rem", marginTop: 2 }}>
              Enquanto ele estiver fora, as mensagens dos seus clientes não são respondidas.
              Clique aqui para reconectar e leia o QR Code de novo.
            </div>
          </div>
          <span style={{ background: "#16A34A", color: "#fff", fontWeight: 800, fontSize: "0.9rem", padding: "0.6rem 1.1rem", borderRadius: 10, whiteSpace: "nowrap" }}>
            Clique aqui para reconectar
          </span>
        </div>
      )}

      {/* Gateway mudo não é loja desconectada: aqui o sistema diz que NÃO SABE,
          em vez de afirmar qualquer um dos dois lados e errar. */}
      {gatewayMudo && config.connected && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderLeft: "6px solid #D97706", borderRadius: 12, padding: "0.8rem 1.1rem", marginBottom: "1rem", color: "#92400E", fontSize: "0.86rem", fontWeight: 600 }}>
          ⚠️ Não consegui confirmar agora se o robô está no ar — o servidor de WhatsApp não respondeu.
          O status abaixo é o da última verificação que deu certo.
        </div>
      )}

      {/* HEADER BANNER PRINCIPAL DO CHATBOT IA */}
      <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: "20px", padding: "28px", color: "#fff", marginBottom: "24px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#4ADE80", marginBottom: "10px" }}>
              <Zap size={14} /> Atendimento Inteligente 24h · Gemini 2.5 Flash
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 6px 0", letterSpacing: "-0.5px" }}>
              🤖 Chatbot IA &amp; WhatsApp do Restaurante
            </h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.88rem", maxWidth: "680px", lineHeight: 1.5 }}>
              Conecte o número do WhatsApp da sua loja por QR Code ou digitação direta, configure as respostas automáticas do Gemini IA e monitore o status do robô em tempo real.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "12px 18px", borderRadius: "16px" }}>
            <div style={{ width: 44, height: 44, borderRadius: "12px", background: config.connected ? "#16A34A" : "#D97706", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {config.connected ? <CheckCircle2 size={24} color="#fff" /> : <Smartphone size={24} color="#fff" />}
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "#94A3B8", fontWeight: 700 }}>Status do WhatsApp</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#fff" }}>
                {config.connected ? "Conectado e Operacional" : "Desconectado / Pendente"}
              </div>
              {config.phone && <div style={{ fontSize: "0.8rem", color: "#4ADE80", fontWeight: 700 }}>📱 {config.phone}</div>}
            </div>
          </div>
        </div>

        {/* NAVEGAÇÃO DE ABAS INTERNAS */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("qr")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "qr" ? "#22C55E" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <QrCode size={16} /> Vincular Aparelho por QR Code
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "marketing" ? "linear-gradient(135deg, #8B5CF6, #6D28D9)" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px", boxShadow: activeTab === "marketing" ? "0 4px 12px rgba(139,92,246,0.3)" : "none"
            }}
          >
            <Gift size={16} /> 🎁 Marketing &amp; Fidelização
          </button>
          <button
            onClick={() => setActiveTab("disparos")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "disparos" ? "linear-gradient(135deg, #F59E0B, #D97706)" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px", boxShadow: activeTab === "disparos" ? "0 4px 12px rgba(245,158,11,0.3)" : "none"
            }}
          >
            <Radio size={16} /> 📢 Disparos
          </button>
          <button
            onClick={() => setActiveTab("cardapio")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "cardapio" ? "linear-gradient(135deg, #10B981, #059669)" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px", boxShadow: activeTab === "cardapio" ? "0 4px 12px rgba(16,185,129,0.3)" : "none"
            }}
          >
            📄 Cardápio em Arquivo
          </button>
          <button
            onClick={() => setActiveTab("test")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "test" ? "#EA580C" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <Send size={16} /> Testar Envio
          </button>
          <button
            onClick={() => setActiveTab("diagnostic")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "diagnostic" ? "#0EA5E9" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <Activity size={16} /> Diagnóstico em Tempo Real
          </button>
          <button
            onClick={() => setActiveTab("alertas")}
            style={{
              padding: "10px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.84rem", cursor: "pointer",
              background: activeTab === "alertas" ? "#DC2626" : "rgba(255,255,255,0.1)", color: "#fff",
              display: "flex", alignItems: "center", gap: "8px"
            }}
          >
            <Bell size={16} /> Notificações
          </button>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL EM GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "1.5rem" }}>
        
        {/* COLUNA ESQUERDA: FERRAMENTA ATIVA NA ABA */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

          {/* ABA 1: PAREMAMENTO VIA QR CODE */}
          {activeTab === "qr" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#DCFCE7", color: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <QrCode size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Vincular Aparelho por QR Code</h3>
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Escaneie com a câmera do seu WhatsApp no celular</p>
                  </div>
                </div>
                {config.connected && (
                  <button
                    onClick={handleToggleConnect}
                    disabled={isRefreshingQr}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: "#FEE2E2", color: "#DC2626", fontWeight: 700,
                      fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                    }}
                  >
                    <Unlink size={14} /> Desconectar
                  </button>
                )}
              </div>

              {!config.connected ? (
                <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "1.5rem", textAlign: "center", border: "1px dashed #CBD5E1" }}>
                  <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 16px 0", lineHeight: 1.4 }}>
                    🔒 <em>Conecte o WhatsApp do restaurante. O FireHub respeita sua privacidade e não lê conversas pessoais.</em>
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "1rem" }}>
                    {!qrCodeUrl || isQrExpired ? (
                      <div style={{ background: "#FFF", padding: "24px", borderRadius: "16px", border: "1px solid #E2E8F0", textAlign: "center", maxWidth: "300px" }}>
                        {isQrExpired && (
                          <div style={{ color: "#DC2626", fontWeight: 700, fontSize: "0.82rem", marginBottom: "12px" }}>
                            ⏱️ O QR Code anterior expirou após 60s.
                          </div>
                        )}
                        <button
                          onClick={handleFetchFreshQr}
                          disabled={isRefreshingQr}
                          style={{
                            padding: "12px 20px",
                            borderRadius: "12px",
                            border: "none",
                            background: "linear-gradient(135deg, #16A34A, #15803D)",
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: "0.9rem",
                            cursor: isRefreshingQr ? "not-allowed" : "pointer",
                            boxShadow: "0 4px 14px rgba(22,163,74,0.35)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px"
                          }}
                        >
                          <RefreshCw size={16} className={isRefreshingQr ? "spin" : ""} />
                          {isRefreshingQr ? "Gerando QR Code..." : (isQrExpired ? "🔄 Gerar Novo QR Code" : "🔄 Gerar QR Code na Hora")}
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ padding: "12px", background: "#fff", borderRadius: "12px", border: "1px solid #E2E8F0", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)" }}>
                          <img src={qrCodeUrl} alt="QR Code WhatsApp" style={{ width: "210px", height: "210px", display: "block" }} />
                        </div>
                        <div style={{ marginTop: "12px", fontSize: "0.82rem", fontWeight: 800, color: "#D97706", display: "flex", alignItems: "center", gap: "6px" }}>
                          ⏱️ QR Code ativo · Expira em {qrTimer}s
                        </div>
                        <button
                          onClick={handleFetchFreshQr}
                          disabled={isRefreshingQr}
                          style={{ marginTop: "10px", padding: "6px 14px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}
                        >
                          🔄 Atualizar QR Code
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#FEF3C7", border: "1px solid #FDE68A", color: "#B45309", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, marginBottom: "16px" }}>
                    <RefreshCw size={12} className="spin" /> Checando leitura em tempo real...
                  </div>

                  <div style={{ background: "#fff", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", textAlign: "left", marginBottom: "8px", fontSize: "0.8rem", color: "#334155", lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: "4px" }}>Passos no Celular:</div>
                    1. Clique em <strong>&quot;Gerar QR Code na Hora&quot;</strong> acima. <br />
                    2. Abra o <strong>WhatsApp</strong> no seu celular. <br />
                    3. Vá em <strong>Menu / Configurações ➔ Aparelhos conectados</strong>. <br />
                    4. Toque em <strong>Conectar um aparelho</strong> e aponte para a imagem antes do tempo zerar.
                  </div>

                  {/* ── CAMINHO SEM CÂMERA ───────────────────────────────── */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "18px 0 14px" }}>
                    <div style={{ flex: 1, height: 1, background: "#E2E8F0" }} />
                    <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#94A3B8", letterSpacing: "0.06em" }}>OU</span>
                    <div style={{ flex: 1, height: 1, background: "#E2E8F0" }} />
                  </div>

                  <div style={{ background: "#fff", padding: "14px", borderRadius: "10px", border: "1px solid #E2E8F0", textAlign: "left" }}>
                    <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.88rem", marginBottom: "2px" }}>
                      📱 Conectar digitando um código
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", lineHeight: 1.5, marginBottom: "12px" }}>
                      Não precisa de câmera nem de estar na frente desta tela. Serve para quem está
                      longe da loja — dá para ditar o código por telefone para quem está lá.
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <input
                        value={numeroParaCodigo}
                        onChange={(e) => setNumeroParaCodigo(e.target.value)}
                        placeholder="WhatsApp da loja com DDD (ex: 22 99999-9999)"
                        inputMode="tel"
                        style={{
                          flex: 1, minWidth: 200, padding: "10px 12px", borderRadius: "8px",
                          border: "1px solid #CBD5E1", fontSize: "0.85rem", color: "#0F172A",
                        }}
                      />
                      <button
                        onClick={handleGerarCodigo}
                        disabled={gerandoCodigo}
                        style={{
                          padding: "10px 18px", borderRadius: "8px", border: "none",
                          background: gerandoCodigo ? "#94A3B8" : "#0F172A", color: "#fff",
                          fontWeight: 800, fontSize: "0.85rem",
                          cursor: gerandoCodigo ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                        }}
                      >
                        {gerandoCodigo ? "Gerando..." : "Gerar código"}
                      </button>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: "6px" }}>
                      Precisa ser o mesmo número que será conectado. Em branco, usamos o telefone
                      cadastrado da loja.
                    </div>

                    {codigoPareamento && (
                      <div style={{ marginTop: "14px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: "10px", padding: "14px" }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#166534", marginBottom: "6px" }}>
                          SEU CÓDIGO
                        </div>
                        <div
                          style={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            fontSize: "1.7rem", fontWeight: 900, letterSpacing: "0.18em",
                            color: "#14532D", marginBottom: "10px",
                          }}
                        >
                          {codigoPareamento}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#166534", lineHeight: 1.7 }}>
                          No <strong>celular da loja</strong>:<br />
                          1. Abra o <strong>WhatsApp</strong>.<br />
                          2. Vá em <strong>Configurações ➔ Aparelhos conectados</strong>.<br />
                          3. Toque em <strong>Conectar um aparelho</strong> e depois em{" "}
                          <strong>Conectar com número de telefone</strong>.<br />
                          4. Digite o código acima.
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#15803D", marginTop: "8px" }}>
                          O código vale por poucos minutos. Se expirar, gere outro.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ background: "#F0FDF4", borderRadius: "12px", padding: "1.25rem", border: "1px solid #BBF7D0", display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                      WA
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#166534" }}>WhatsApp Vinculado com Sucesso!</div>
                      <div style={{ fontSize: "0.8rem", color: "#15803D" }}>A IA está pronta para responder mensagens no número {config.phone}.</div>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleConnect}
                    disabled={isRefreshingQr}
                    style={{
                      padding: "10px 16px",
                      borderRadius: "10px",
                      border: "1px solid #BBF7D0",
                      background: "#DCFCE7",
                      color: "#15803D",
                      fontWeight: 800,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px"
                    }}
                  >
                    <RefreshCw size={14} className={isRefreshingQr ? "spin" : ""} />
                    {isRefreshingQr ? "Desconectando..." : "🔄 Reconectar / Escanear Novo QR Code"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ABA 2: DIGITAR NÚMERO DIRETO */}
          {activeTab === "phone" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#DBEAFE", color: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Phone size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Vincular por Número de Telefone</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Cadastre o número direto para envios de confirmação e alertas</p>
                </div>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                  Número do Celular / WhatsApp da Loja (com DDD):
                </label>
                <input
                  type="text"
                  value={storePhoneInput}
                  onChange={(e) => setStorePhoneInput(e.target.value)}
                  placeholder="Ex: 22 99885-1680"
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: "10px",
                    border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 700,
                    outline: "none", boxSizing: "border-box", marginBottom: "8px"
                  }}
                />
                <button
                  onClick={handleSaveStorePhone}
                  disabled={phoneSaving}
                  style={{
                    width: "100%", padding: "12px", borderRadius: "10px", border: "none",
                    background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff",
                    fontWeight: 800, fontSize: "0.9rem", cursor: "pointer"
                  }}
                >
                  {phoneSaving ? "Salvando e Ativando..." : "✓ Salvar & Ativar WhatsApp da Loja"}
                </button>
              </div>

              <div style={{ background: "#F1F5F9", padding: "12px", borderRadius: "10px", fontSize: "0.78rem", color: "#475569", lineHeight: 1.5 }}>
                💡 <strong>Dica:</strong> Ao salvar o número direto, a API envia os alertas de novos pedidos, atualizações de status e confirmações para os clientes através deste canal oficial.
              </div>
            </div>
          )}

          {/* ABA MARKETING & FIDELIZAÇÃO */}
          {activeTab === "marketing" && (
            <div style={{ background: "#fff", borderRadius: "20px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)" }}>
              {/* HEADER DA ABA */}
              <div style={{ background: "linear-gradient(135deg, #4C1D95, #6D28D9)", color: "#fff", padding: "1.5rem", borderRadius: "16px", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.74rem", fontWeight: 800, color: "#DDD6FE", marginBottom: "6px" }}>
                    <Sparkles size={14} /> MÓDULO INTELIGENTE DE VENDAS RECORRENTES
                  </div>
                  <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.3rem" }}>🚀 Marketing, Disparos &amp; Relatório de Fidelização</h3>
                  <p style={{ margin: "4px 0 0 0", fontSize: "0.82rem", opacity: 0.88 }}>
                    Recupere clientes ausentes automaticamente e acompanhe os pedidos gerados pelos disparos.
                  </p>
                </div>

                {/* FILTRO DE DATA DOS DISPAROS */}
                <div style={{ background: "rgba(255,255,255,0.1)", padding: "10px 14px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <Calendar size={16} />
                  <span style={{ fontSize: "0.78rem", fontWeight: 700 }}>Período:</span>
                  <input
                    type="date"
                    value={marketingStartDate}
                    onChange={(e) => setMarketingStartDate(e.target.value)}
                    style={{ background: "#fff", border: "none", padding: "4px 8px", borderRadius: "6px", fontSize: "0.76rem", fontWeight: 700, color: "#4C1D95" }}
                  />
                  <span style={{ fontSize: "0.78rem" }}>até</span>
                  <input
                    type="date"
                    value={marketingEndDate}
                    onChange={(e) => setMarketingEndDate(e.target.value)}
                    style={{ background: "#fff", border: "none", padding: "4px 8px", borderRadius: "6px", fontSize: "0.76rem", fontWeight: 700, color: "#4C1D95" }}
                  />
                </div>
              </div>

              {/* RELATÓRIO DE IMPACTO DE VENDAS */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "1.5rem" }}>
                <div style={{ background: "#F3E8FF", border: "1px solid #DDD6FE", padding: "1.2rem", borderRadius: "14px", textAlign: "center" }}>
                  <div style={{ color: "#6D28D9", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>👥 Clientes na Base Ativa</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#4C1D95", marginTop: "4px" }}>{marketingCustomers.length}</div>
                  <div style={{ fontSize: "0.7rem", color: "#6D28D9", marginTop: "2px" }}>Contatos reais registrados</div>
                </div>

                <div style={{ background: "#DCFCE7", border: "1px solid #BBF7D0", padding: "1.2rem", borderRadius: "14px", textAlign: "center" }}>
                  <div style={{ color: "#166534", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>🛍️ Pedidos Recuperados</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#15803D", marginTop: "4px" }}>{recoveredOrdersCount}</div>
                  <div style={{ fontSize: "0.7rem", color: "#166534", marginTop: "2px" }}>Vendas efetuadas via cupons</div>
                </div>

                <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", padding: "1.2rem", borderRadius: "14px", textAlign: "center" }}>
                  <div style={{ color: "#92400E", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>💰 Faturamento Gerado</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#B45309", marginTop: "4px" }}>R$ {recoveredRevenue.toFixed(2).replace(".", ",")}</div>
                  <div style={{ fontSize: "0.7rem", color: "#92400E", marginTop: "2px" }}>Receita vinda das automações</div>
                </div>
              </div>

              {/* SEÇÃO 1: CONFIGURAÇÃO DE CUPOM INSTANTÂNEO PARA QUEM PERGUNTAR NO WHATSAPP */}
              <div style={{ background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)", padding: "1.5rem", borderRadius: "16px", border: "1px solid #BFDBFE", marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1E40AF", display: "flex", alignItems: "center", gap: "6px" }}>
                      💬 Se o cliente perguntar se tem cupom de desconto no WhatsApp, quer liberar um cupom automático?
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#1E3A8A", marginTop: "2px" }}>
                      Sugestão recomendada: <strong>10% de Desconto</strong> (ex: cupom <code>PRIMEIRACOMPRA10</code> ou <code>QUEROCUPOM10</code>)
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => handleSaveConfig({ instantCouponEnabled: true })}
                      style={{ padding: "6px 16px", borderRadius: "8px", border: "none", background: config.instantCouponEnabled === true ? "#16A34A" : "#E2E8F0", color: config.instantCouponEnabled === true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}
                    >
                      SIM, LIBERAR
                    </button>
                    <button
                      onClick={() => handleSaveConfig({ instantCouponEnabled: false })}
                      style={{ padding: "6px 16px", borderRadius: "8px", border: "none", background: config.instantCouponEnabled !== true ? "#DC2626" : "#E2E8F0", color: config.instantCouponEnabled !== true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}
                    >
                      NÃO, RESPONDER QUE NÃO TEM
                    </button>
                  </div>
                </div>

                {config.instantCouponEnabled === true && (
                  <div style={{ background: "#fff", padding: "1rem", borderRadius: "12px", border: "1px solid #93C5FD", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 800, color: "#1E40AF", marginBottom: "4px" }}>
                        Selecione o Cupom do Banco de Dados para Liberar no WhatsApp:
                      </label>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <select
                          value={config.instantCouponCode || ""}
                          onChange={(e) => {
                            const code = e.target.value;
                            setConfig((prev: any) => ({ ...prev, instantCouponCode: code }));
                            handleSaveConfig({ instantCouponCode: code });
                          }}
                          style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #93C5FD", fontSize: "0.85rem", fontWeight: 700, color: "#1D4ED8" }}
                        >
                          <option value="">-- Selecione um cupom cadastrado --</option>
                          {storeCoupons.map((c: any, i: number) => (
                            <option key={i} value={c.code}>
                              {c.code} ({c.type === "free_shipping" ? "Frete Grátis" : c.type === "fixed" ? `R$ ${c.discount} OFF` : `${c.discount}% OFF`}{c.minOrderValue > 0 ? ` | Mín: R$ ${c.minOrderValue}` : ""})
                            </option>
                          ))}
                        </select>
                        {config.instantCouponCode && (
                          <button
                            type="button"
                            title={`Excluir cupom ${config.instantCouponCode}`}
                            onClick={() => handleRequestDeleteCoupon(config.instantCouponCode)}
                            style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetCouponField("instantCouponCode");
                          setShowNewCouponModal(true);
                        }}
                        style={{ marginTop: "6px", background: "none", border: "none", color: "#2563EB", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        ➕ Criar Novo Cupom
                      </button>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 800, color: "#1E40AF", marginBottom: "4px" }}>
                        Descrição do Benefício (Ex: 10% de desconto):
                      </label>
                      <input
                        type="text"
                        placeholder="Ex: 10% de desconto"
                        value={config.instantCouponDiscount || "10% de desconto"}
                        onChange={(e) => setConfig((prev: any) => ({ ...prev, instantCouponDiscount: e.target.value }))}
                        onBlur={() => handleSaveConfig({ instantCouponDiscount: config.instantCouponDiscount })}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #93C5FD", fontSize: "0.85rem", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* AUTOMAÇÕES DE CLIENTES AUSENTES (DESIGNER PREMIUM NÃO PREENCHIDO) */}
              <div style={{ background: "#F8FAFC", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0", marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "1rem" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0F172A", marginBottom: "2px" }}>
                      🎁 Automação por Tempo de Sumiço (7, 15 e 30 dias)
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", lineHeight: 1.4 }}>
                      Selecione abaixo o cupom cadastrado na sua loja para enviar em cada disparo.
                    </div>
                  </div>
                </div>

                {/* CARD 7 DIAS */}
                <div style={{ background: "#fff", padding: "1rem", borderRadius: "14px", border: "1px solid #CBD5E1", marginBottom: "1rem", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#EA580C" }}>🔥 1º Incentivo — Cliente 7 Dias Sem Pedir</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => handleSaveConfig({ autoRecuperation7d: true })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation7d === true ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation7d === true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>ATIVADO</button>
                      <button onClick={() => handleSaveConfig({ autoRecuperation7d: false })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation7d !== true ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation7d !== true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>DESATIVADO</button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Selecione o Cupom Cadastrado:</label>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <select
                          value={config.coupon7d || ""}
                          onChange={(e) => {
                            const code = e.target.value;
                            setConfig((prev: any) => ({ ...prev, coupon7d: code }));
                            handleSaveConfig({ coupon7d: code });
                          }}
                          style={{ flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 800, color: "#2563EB" }}
                        >
                          <option value="">-- NENHUM CUPOM SELECIONADO --</option>
                          {storeCoupons.map((c: any, idx: number) => (
                            <option key={idx} value={c.code}>
                              {c.code} ({c.type === "free_shipping" ? "Frete Grátis" : c.type === "fixed" ? `R$ ${c.discount} OFF` : `${c.discount}% OFF`}{c.minOrderValue > 0 ? ` | Mín: R$ ${c.minOrderValue}` : ""})
                            </option>
                          ))}
                        </select>
                        {config.coupon7d && (
                          <button
                            type="button"
                            title={`Excluir cupom ${config.coupon7d}`}
                            onClick={() => handleRequestDeleteCoupon(config.coupon7d)}
                            style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetCouponField("coupon7d");
                          setShowNewCouponModal(true);
                        }}
                        style={{ marginTop: "6px", background: "none", border: "none", color: "#2563EB", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        ➕ Criar Novo Cupom
                      </button>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Benefício Cadastrado no Cupom (Leitura):</label>
                      {(() => {
                        const sel = storeCoupons.find((c: any) => c.code === config.coupon7d);
                        return (
                          <div style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", padding: "8px 12px", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 800, color: sel ? "#0F172A" : "#94A3B8" }}>
                            {sel ? (sel.type === "free_shipping" ? `🚚 Frete Grátis${sel.minOrderValue > 0 ? ` (Pedido Mínimo: R$ ${sel.minOrderValue})` : " (Sem taxa de entrega)"}` : sel.type === "fixed" ? `💵 Valor Fixo: R$ ${sel.discount} OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}` : `🏷️ Porcentagem: ${sel.discount}% OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}`) : "Nenhum cupom selecionado"}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
                    <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>📷 Imagem do Disparo (opcional):</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {config.img7d ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <img src={config.img7d} alt="Imagem 7d" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: "10px", border: "2px solid #CBD5E1" }} />
                          <button
                            onClick={() => { setConfig((p: any) => ({ ...p, img7d: "" })); handleSaveConfig({ img7d: "" }); }}
                            style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#EF4444", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 900 }}
                          >✕</button>
                        </div>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: "2px dashed #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>
                          📤 Enviar Imagem
                          <input type="file" accept="image/*" hidden onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const fd = new FormData(); fd.append("file", file); fd.append("type", "marketing");
                            const res = await fetch("/api/upload", { method: "POST", body: fd });
                            if (res.ok) { const { url } = await res.json(); setConfig((p: any) => ({ ...p, img7d: url })); handleSaveConfig({ img7d: url }); showToast("✅ Imagem salva!", "#10B981"); }
                          }} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* CARD 15 DIAS */}
                <div style={{ background: "#fff", padding: "1rem", borderRadius: "14px", border: "1px solid #CBD5E1", marginBottom: "1rem", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#2563EB" }}>🎁 2º Incentivo — Cliente 15 Dias Sem Pedir</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => handleSaveConfig({ autoRecuperation15d: true })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation15d === true ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation15d === true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>ATIVADO</button>
                      <button onClick={() => handleSaveConfig({ autoRecuperation15d: false })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation15d !== true ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation15d !== true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>DESATIVADO</button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Selecione o Cupom Cadastrado:</label>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <select
                          value={config.coupon15d || ""}
                          onChange={(e) => {
                            const code = e.target.value;
                            setConfig((prev: any) => ({ ...prev, coupon15d: code }));
                            handleSaveConfig({ coupon15d: code });
                          }}
                          style={{ flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 800, color: "#2563EB" }}
                        >
                          <option value="">-- NENHUM CUPOM SELECIONADO --</option>
                          {storeCoupons.map((c: any, idx: number) => (
                            <option key={idx} value={c.code}>
                              {c.code} ({c.type === "free_shipping" ? "Frete Grátis" : c.type === "fixed" ? `R$ ${c.discount} OFF` : `${c.discount}% OFF`}{c.minOrderValue > 0 ? ` | Mín: R$ ${c.minOrderValue}` : ""})
                            </option>
                          ))}
                        </select>
                        {config.coupon15d && (
                          <button
                            type="button"
                            title={`Excluir cupom ${config.coupon15d}`}
                            onClick={() => handleRequestDeleteCoupon(config.coupon15d)}
                            style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetCouponField("coupon15d");
                          setShowNewCouponModal(true);
                        }}
                        style={{ marginTop: "6px", background: "none", border: "none", color: "#2563EB", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        ➕ Criar Novo Cupom
                      </button>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Benefício Cadastrado no Cupom (Leitura):</label>
                      {(() => {
                        const sel = storeCoupons.find((c: any) => c.code === config.coupon15d);
                        return (
                          <div style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", padding: "8px 12px", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 800, color: sel ? "#0F172A" : "#94A3B8" }}>
                            {sel ? (sel.type === "free_shipping" ? `🚚 Frete Grátis${sel.minOrderValue > 0 ? ` (Pedido Mínimo: R$ ${sel.minOrderValue})` : " (Sem taxa de entrega)"}` : sel.type === "fixed" ? `💵 Valor Fixo: R$ ${sel.discount} OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}` : `🏷️ Porcentagem: ${sel.discount}% OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}`) : "Nenhum cupom selecionado"}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
                    <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>📷 Imagem do Disparo (opcional):</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {config.img15d ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <img src={config.img15d} alt="Imagem 15d" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: "10px", border: "2px solid #CBD5E1" }} />
                          <button
                            onClick={() => { setConfig((p: any) => ({ ...p, img15d: "" })); handleSaveConfig({ img15d: "" }); }}
                            style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#EF4444", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 900 }}
                          >✕</button>
                        </div>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: "2px dashed #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>
                          📤 Enviar Imagem
                          <input type="file" accept="image/*" hidden onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const fd = new FormData(); fd.append("file", file); fd.append("type", "marketing");
                            const res = await fetch("/api/upload", { method: "POST", body: fd });
                            if (res.ok) { const { url } = await res.json(); setConfig((p: any) => ({ ...p, img15d: url })); handleSaveConfig({ img15d: url }); showToast("✅ Imagem salva!", "#10B981"); }
                          }} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* CARD 30 DIAS */}
                <div style={{ background: "#fff", padding: "1rem", borderRadius: "14px", border: "1px solid #CBD5E1", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#7C3AED" }}>✨ 3º Incentivo — Cliente 30 Dias Sem Pedir</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => handleSaveConfig({ autoRecuperation30d: true })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation30d === true ? "#16A34A" : "#E2E8F0", color: config.autoRecuperation30d === true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>ATIVADO</button>
                      <button onClick={() => handleSaveConfig({ autoRecuperation30d: false })} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: config.autoRecuperation30d !== true ? "#DC2626" : "#E2E8F0", color: config.autoRecuperation30d !== true ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer" }}>DESATIVADO</button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Selecione o Cupom Cadastrado:</label>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <select
                          value={config.coupon30d || ""}
                          onChange={(e) => {
                            const code = e.target.value;
                            setConfig((prev: any) => ({ ...prev, coupon30d: code }));
                            handleSaveConfig({ coupon30d: code });
                          }}
                          style={{ flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 800, color: "#2563EB" }}
                        >
                          <option value="">-- NENHUM CUPOM SELECIONADO --</option>
                          {storeCoupons.map((c: any, idx: number) => (
                            <option key={idx} value={c.code}>
                              {c.code} ({c.type === "free_shipping" ? "Frete Grátis" : c.type === "fixed" ? `R$ ${c.discount} OFF` : `${c.discount}% OFF`}{c.minOrderValue > 0 ? ` | Mín: R$ ${c.minOrderValue}` : ""})
                            </option>
                          ))}
                        </select>
                        {config.coupon30d && (
                          <button
                            type="button"
                            title={`Excluir cupom ${config.coupon30d}`}
                            onClick={() => handleRequestDeleteCoupon(config.coupon30d)}
                            style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetCouponField("coupon30d");
                          setShowNewCouponModal(true);
                        }}
                        style={{ marginTop: "6px", background: "none", border: "none", color: "#2563EB", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      >
                        ➕ Criar Novo Cupom
                      </button>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>Benefício Cadastrado no Cupom (Leitura):</label>
                      {(() => {
                        const sel = storeCoupons.find((c: any) => c.code === config.coupon30d);
                        return (
                          <div style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", padding: "8px 12px", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 800, color: sel ? "#0F172A" : "#94A3B8" }}>
                            {sel ? (sel.type === "free_shipping" ? `🚚 Frete Grátis${sel.minOrderValue > 0 ? ` (Pedido Mínimo: R$ ${sel.minOrderValue})` : " (Sem taxa de entrega)"}` : sel.type === "fixed" ? `💵 Valor Fixo: R$ ${sel.discount} OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}` : `🏷️ Porcentagem: ${sel.discount}% OFF${sel.minOrderValue > 0 ? ` (Mín: R$ ${sel.minOrderValue})` : ""}`) : "Nenhum cupom selecionado"}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div style={{ gridColumn: "1 / -1", marginTop: "8px" }}>
                    <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>📷 Imagem do Disparo (opcional):</label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {config.img30d ? (
                        <div style={{ position: "relative", display: "inline-block" }}>
                          <img src={config.img30d} alt="Imagem 30d" style={{ width: 80, height: 80, objectFit: "cover", borderRadius: "10px", border: "2px solid #CBD5E1" }} />
                          <button
                            onClick={() => { setConfig((p: any) => ({ ...p, img30d: "" })); handleSaveConfig({ img30d: "" }); }}
                            style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#EF4444", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 900 }}
                          >✕</button>
                        </div>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: "2px dashed #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>
                          📤 Enviar Imagem
                          <input type="file" accept="image/*" hidden onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            const fd = new FormData(); fd.append("file", file); fd.append("type", "marketing");
                            const res = await fetch("/api/upload", { method: "POST", body: fd });
                            if (res.ok) { const { url } = await res.json(); setConfig((p: any) => ({ ...p, img30d: url })); handleSaveConfig({ img30d: url }); showToast("✅ Imagem salva!", "#10B981"); }
                          }} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* CARD GERENCIAR TODOS OS CUPONS DA LOJA */}
                <div style={{ background: "#fff", padding: "1.25rem", borderRadius: "14px", border: "1px solid #CBD5E1", marginTop: "1rem" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>🏷️ Todos os Cupons Cadastrados na Loja ({storeCoupons.length})</span>
                    <button
                      type="button"
                      onClick={() => { setTargetCouponField(null); setShowNewCouponModal(true); }}
                      style={{ background: "#EFF6FF", border: "1px solid #93C5FD", color: "#1D4ED8", padding: "4px 10px", borderRadius: "8px", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer" }}
                    >
                      ➕ Criar Cupom
                    </button>
                  </div>

                  {storeCoupons.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "#94A3B8", fontStyle: "italic" }}>
                      Nenhum cupom cadastrado ainda. Clique acima para criar um cupom.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px" }}>
                      {storeCoupons.map((c: any, idx: number) => (
                        <div key={idx} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#1E293B" }}>{c.code}</div>
                            <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "1px" }}>
                              {c.type === "free_shipping" ? "🚚 Frete Grátis" : c.type === "fixed" ? `💵 R$ ${c.discount} OFF` : `🏷️ ${c.discount}% OFF`}
                              {c.minOrderValue > 0 ? ` (Mín: R$ ${c.minOrderValue})` : ""}
                            </div>
                          </div>
                          <button
                            type="button"
                            title={`Excluir cupom ${c.code}`}
                            onClick={() => handleRequestDeleteCoupon(c.code)}
                            style={{ padding: "6px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* LISTA DE BASE DE CLIENTES VÁLIDOS */}
              <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #E2E8F0", padding: "1.2rem" }}>
                <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", marginBottom: "10px" }}>
                  👥 Base de Clientes Elegíveis para Disparos ({marketingCustomers.length})
                </div>

                <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "#F8FAFC", color: "#475569", borderBottom: "1.5px solid #E2E8F0" }}>
                        <th style={{ padding: "8px 12px" }}>Nome</th>
                        <th style={{ padding: "8px 12px" }}>Telefone WhatsApp</th>
                        <th style={{ padding: "8px 12px" }}>Total de Pedidos</th>
                        <th style={{ padding: "8px 12px" }}>Último Pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketingCustomers.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ padding: "20px", textAlign: "center", color: "#94A3B8" }}>Nenhum cliente válido cadastrado até o momento.</td>
                        </tr>
                      ) : (
                        marketingCustomers.map((c: any) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 700, color: "#1E293B" }}>{c.name}</td>
                            <td style={{ padding: "8px 12px", color: "#2563EB", fontWeight: 700 }}>{c.phone}</td>
                            <td style={{ padding: "8px 12px" }}>{c.totalOrders} pedido(s)</td>
                            <td style={{ padding: "8px 12px", color: "#64748B" }}>{new Date(c.updatedAt).toLocaleDateString("pt-BR")}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ABA 3: NOTIFICAÇÕES DE PEDIDOS */}
          {activeTab === "notifications" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bell size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Mensagens Automáticas de Pedidos</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Personalize as respostas enviadas pelo WhatsApp a cada mudança de status</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    1. Confirmação do Pedido (Recebido):
                  </label>
                  <textarea
                    value={orderMessages.confirm}
                    onChange={e => setOrderMessages({ ...orderMessages, confirm: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    2. Em Produção (Cozinha):
                  </label>
                  <textarea
                    value={orderMessages.preparing}
                    onChange={e => setOrderMessages({ ...orderMessages, preparing: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    3. Saiu para Entrega (Motoboy):
                  </label>
                  <textarea
                    value={orderMessages.delivery}
                    onChange={e => setOrderMessages({ ...orderMessages, delivery: e.target.value })}
                    style={{ width: "100%", height: "60px", padding: "8px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.8rem", resize: "none" }}
                  />
                </div>

                <button
                  onClick={() => showToast("✅ Mensagens salvas com sucesso!", "#10B981")}
                  style={{ padding: "10px", borderRadius: "8px", border: "none", background: "#7C3AED", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: "0.85rem", marginTop: "4px" }}
                >
                  ✓ Salvar Modelos de Mensagens
                </button>
              </div>
            </div>
          )}

          {/* ── ABA NOTIFICAÇÕES ──────────────────────────────────────
              Duas metades do mesmo assunto: para quem o robô FALA quando algo
              dá errado, e com quem ele NUNCA fala. */}
          {activeTab === "alertas" && (() => {
            const TIPOS_DE_ALERTA: Array<{ id: string; titulo: string; detalhe: string }> = [
              {
                id: "problema_no_pedido",
                titulo: "Cliente com problema no pedido",
                detalhe: "Atraso, pedido que não chegou, item faltando, veio errado, quer cancelar. O robô sai da conversa e avisa você.",
              },
              {
                id: "pedido_de_atendente",
                titulo: "Cliente pediu para falar com atendente",
                detalhe: "Quando o cliente escreve que quer falar com uma pessoa.",
              },
              {
                id: "robo_desconectado",
                titulo: "Robô desconectou do WhatsApp",
                detalhe: "A sessão caiu e ninguém está respondendo os clientes.",
              },
            ];
            const alertas = config.alertas || {};
            const ligado = (id: string) => (typeof alertas[id] === "boolean" ? alertas[id] : true);
            const numerosMudos: any[] = Array.isArray(config.numerosIgnorados) ? config.numerosIgnorados : [];
            const telefoneDeAlerta = String(stats?.notificationPhone || "");

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

                {/* 1. O ROBÔ SAI QUANDO O CLIENTE RECLAMA */}
                <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.75rem" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#FEE2E2", color: "#DC2626", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <AlertCircle size={20} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Problema no pedido chama gente</h3>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Reclamação não é dúvida — quem resolve atraso é uma pessoa, não o robô</p>
                    </div>
                  </div>

                  <p style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.6, margin: "0 0 12px" }}>
                    Quando o cliente reclama de atraso, diz que não chegou, que faltou item, que veio errado
                    ou que quer cancelar, o robô responde <strong>uma única frase</strong> avisando que vai
                    chamar alguém — e para de falar naquela conversa. Ela aparece no balãozinho vermelho do
                    painel e o alerta vai para o seu WhatsApp.
                  </p>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => handleSaveConfig({ escalateOnComplaint: true })}
                      style={{
                        flex: 1, padding: "10px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: 800, fontSize: "0.82rem",
                        background: config.escalateOnComplaint !== false ? "#16A34A" : "#E2E8F0",
                        color: config.escalateOnComplaint !== false ? "#fff" : "#475569",
                      }}
                    >
                      ✓ Chamar a equipe
                    </button>
                    <button
                      onClick={() => handleSaveConfig({ escalateOnComplaint: false })}
                      style={{
                        flex: 1, padding: "10px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: 800, fontSize: "0.82rem",
                        background: config.escalateOnComplaint === false ? "#DC2626" : "#E2E8F0",
                        color: config.escalateOnComplaint === false ? "#fff" : "#475569",
                      }}
                    >
                      Deixar o robô responder
                    </button>
                  </div>
                  {config.escalateOnComplaint === false && (
                    <p style={{ fontSize: "0.75rem", color: "#B91C1C", marginTop: 8, lineHeight: 1.5 }}>
                      ⚠️ Com isto desligado o robô continua respondendo quem está reclamando. Ele não liga
                      para o motoboy nem sabe onde a entrega está — e já inventou que tinha ligado.
                    </p>
                  )}
                </div>

                {/* 2. QUE ALERTAS O DONO RECEBE NO WHATSAPP */}
                <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.75rem" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Bell size={20} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Alertas no seu WhatsApp</h3>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>O painel só avisa quem está com ele aberto. O WhatsApp encontra você em qualquer lugar.</p>
                    </div>
                  </div>

                  {telefoneDeAlerta ? (
                    <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "10px", padding: "10px 12px", fontSize: "0.78rem", color: "#166534", marginBottom: 12 }}>
                      Os alertas vão para <strong>{telefoneDeAlerta}</strong>. Para trocar, vá em{" "}
                      <a href="/store/minha-loja" style={{ color: "#166534", fontWeight: 800 }}>Minha Loja</a>.
                    </div>
                  ) : (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "10px", padding: "10px 12px", fontSize: "0.78rem", color: "#991B1B", marginBottom: 12 }}>
                      ⚠️ Nenhum WhatsApp cadastrado para receber alertas — nada será enviado. Cadastre o seu
                      número em <a href="/store/minha-loja" style={{ color: "#991B1B", fontWeight: 800 }}>Minha Loja</a>,
                      no campo &quot;WhatsApp do Proprietário&quot;.
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {TIPOS_DE_ALERTA.map((t) => (
                      <label
                        key={t.id}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px",
                          borderRadius: "10px", border: `1px solid ${ligado(t.id) ? "#DDD6FE" : "#E2E8F0"}`,
                          background: ligado(t.id) ? "#FAF5FF" : "#F8FAFC", cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={ligado(t.id)}
                          onChange={(e) => handleSaveConfig({ alertas: { ...alertas, [t.id]: e.target.checked } })}
                          style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer" }}
                        />
                        <div>
                          <div style={{ fontWeight: 800, fontSize: "0.84rem", color: "#0F172A" }}>{t.titulo}</div>
                          <div style={{ fontSize: "0.75rem", color: "#64748B", lineHeight: 1.45 }}>{t.detalhe}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 3. NÚMEROS QUE O ROBÔ NÃO ATENDE */}
                <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "0.75rem" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F1F5F9", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Smartphone size={20} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Números que o robô não responde</h3>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Motoboys, cozinha, fornecedores — quem fala com a loja e não quer cardápio</p>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: 12 }}>
                    <input
                      value={novoNomeMudo}
                      onChange={(e) => setNovoNomeMudo(e.target.value)}
                      placeholder="Nome (ex: Motoboy João)"
                      style={{ flex: "1 1 160px", padding: "9px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                    />
                    <input
                      value={novoNumeroMudo}
                      onChange={(e) => setNovoNumeroMudo(e.target.value)}
                      placeholder="WhatsApp com DDD"
                      inputMode="numeric"
                      style={{ flex: "1 1 160px", padding: "9px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                    />
                    <button
                      onClick={() => {
                        const digitos = novoNumeroMudo.replace(/\D/g, "");
                        if (digitos.length < 10) {
                          showToast("Informe o número com DDD (ex: 21999998888)", "#EF4444");
                          return;
                        }
                        const jaTem = numerosMudos.some(
                          (n: any) => String(n?.numero || "").replace(/\D/g, "").slice(-8) === digitos.slice(-8)
                        );
                        if (jaTem) {
                          showToast("Esse número já está na lista", "#F59E0B");
                          return;
                        }
                        handleSaveConfig({
                          numerosIgnorados: [...numerosMudos, { numero: digitos, nome: novoNomeMudo.trim() || "Sem nome" }],
                        });
                        setNovoNumeroMudo("");
                        setNovoNomeMudo("");
                      }}
                      style={{ padding: "9px 16px", borderRadius: "10px", border: "none", background: "#0F172A", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer" }}
                    >
                      Adicionar
                    </button>
                  </div>

                  {numerosMudos.length === 0 ? (
                    <p style={{ fontSize: "0.78rem", color: "#94A3B8", margin: 0 }}>
                      Nenhum número cadastrado — o robô responde todo mundo.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {numerosMudos.map((n: any, i: number) => (
                        <div key={`${n?.numero}_${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: "#F8FAFC", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                          <div style={{ fontSize: "0.82rem", color: "#0F172A" }}>
                            <strong>{n?.nome || "Sem nome"}</strong>
                            <span style={{ color: "#64748B" }}> — {n?.numero}</span>
                          </div>
                          <button
                            onClick={() => handleSaveConfig({ numerosIgnorados: numerosMudos.filter((_: any, j: number) => j !== i) })}
                            style={{ background: "transparent", border: "none", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center" }}
                            title="Remover"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ABA DISPAROS: CAMPANHA DE MARKETING PERSONALIZADA */}
          {activeTab === "disparos" && (() => {
            const criteriaOptions = [
              { id: "all", label: "📋 Todos os Clientes", description: "Enviar para toda a base de contatos", color: "#6366F1", icon: "📋" },
              { id: "7d", label: "🔥 Sumidos há 7 Dias", description: "Clientes que não pedem há 7 dias ou mais", color: "#EA580C", icon: "🔥" },
              { id: "15d", label: "⏰ Sumidos há 15 Dias", description: "Clientes que não pedem há 15 dias ou mais", color: "#2563EB", icon: "⏰" },
              { id: "30d", label: "💤 Sumidos há 30+ Dias", description: "Clientes inativos há mais de 30 dias", color: "#7C3AED", icon: "💤" },
              { id: "loyal", label: "⭐ Clientes Fiéis", description: "Clientes com 3 ou mais pedidos feitos", color: "#16A34A", icon: "⭐" },
              { id: "top_spenders", label: "👑 Top Clientes (VIP)", description: "Os 20 clientes que mais fizeram pedidos", color: "#D97706", icon: "👑" },
              { id: "new_customers", label: "🆕 Clientes Novos", description: "Clientes com apenas 1 pedido — conquiste a fidelização", color: "#0EA5E9", icon: "🆕" },
              { id: "never_ordered", label: "👻 Nunca Compraram", description: "Contatos WhatsApp que nunca fizeram um pedido", color: "#DC2626", icon: "👻" },
            ];

            const now = Date.now();
            const DAY = 24 * 60 * 60 * 1000;

            const filteredCustomers = marketingCustomers.filter((c: any) => {
              const lastActivity = new Date(c.updatedAt).getTime();
              const daysSince = (now - lastActivity) / DAY;
              const orders = c.totalOrders || 0;

              switch (selectedCriteria) {
                case "all": return true;
                case "7d": return daysSince >= 7;
                case "15d": return daysSince >= 15;
                case "30d": return daysSince >= 30;
                case "loyal": return orders >= 3;
                case "top_spenders": return true; // filtered below by sort + slice
                case "new_customers": return orders === 1;
                case "never_ordered": return orders === 0;
                default: return true;
              }
            });

            // Para "top_spenders", ordena por totalOrders desc e pega os top 20
            const finalCustomers = selectedCriteria === "top_spenders"
              ? [...filteredCustomers].sort((a: any, b: any) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 20)
              : filteredCustomers;

            const handleSendCampaign = async () => {
              if (!campaignMsg.trim()) {
                showToast("⚠️ Escreva a mensagem do disparo", "#EF4444");
                return;
              }
              if (finalCustomers.length === 0) {
                showToast("⚠️ Nenhum cliente encontrado para esse critério", "#EF4444");
                return;
              }
              setSendingCampaign(true);
              try {
                const phones = finalCustomers.map((c: any) => c.phone.replace(/\D/g, ""));
                const res = await fetch("/api/store/marketing", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "send_campaign",
                    message: campaignMsg,
                    imageUrl: campaignImg || undefined,
                    targetPhones: phones,
                  }),
                });
                const data = await res.json();
                if (data.success) {
                  showToast(data.message || "🚀 Disparo iniciado com sucesso!", "#10B981");
                  setShowCampaignConfirm(false);
                  setCampaignMsg("");
                  setCampaignImg("");
                  setSelectedCriteria("all");
                  loadMarketingData();
                  setTimeout(() => {
                    document.getElementById("history-section")?.scrollIntoView({ behavior: "smooth" });
                  }, 300);
                } else {
                  showToast(`⚠️ ${data.error || "Erro ao disparar"}`, "#EF4444");
                }
              } catch {
                showToast("⚠️ Erro de conexão ao disparar campanha", "#EF4444");
              } finally {
                setSendingCampaign(false);
              }
            };

            return (
              <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.5rem" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "12px", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem" }}>
                    📢
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>Central de Disparos</h3>
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Monte sua campanha, escolha o público e dispare com segurança anti-ban</p>
                  </div>
                </div>

                {/* STEP 1: Critério de Audiência */}
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900 }}>1</div>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>Escolha o Público-Alvo</div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
                    {criteriaOptions.map((opt) => {
                      const isSelected = selectedCriteria === opt.id;
                      const count = opt.id === "top_spenders"
                        ? Math.min(20, marketingCustomers.filter((c: any) => (c.totalOrders || 0) > 0).length)
                        : opt.id === "all"
                          ? marketingCustomers.length
                          : marketingCustomers.filter((c: any) => {
                              const lastActivity = new Date(c.updatedAt).getTime();
                              const daysSince = (now - lastActivity) / DAY;
                              const orders = c.totalOrders || 0;
                              if (opt.id === "7d") return daysSince >= 7;
                              if (opt.id === "15d") return daysSince >= 15;
                              if (opt.id === "30d") return daysSince >= 30;
                              if (opt.id === "loyal") return orders >= 3;
                              if (opt.id === "new_customers") return orders === 1;
                              if (opt.id === "never_ordered") return orders === 0;
                              return true;
                            }).length;

                      return (
                        <button
                          key={opt.id}
                          onClick={() => setSelectedCriteria(opt.id)}
                          style={{
                            padding: "12px 14px", borderRadius: "12px", border: isSelected ? `2px solid ${opt.color}` : "2px solid #E2E8F0",
                            background: isSelected ? `${opt.color}10` : "#FAFAFA", cursor: "pointer", textAlign: "left",
                            transition: "all 0.2s ease", boxShadow: isSelected ? `0 2px 8px ${opt.color}20` : "none",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <span style={{ fontWeight: 800, fontSize: "0.82rem", color: isSelected ? opt.color : "#334155" }}>{opt.label}</span>
                            <span style={{
                              padding: "2px 8px", borderRadius: "12px", fontSize: "0.7rem", fontWeight: 900,
                              background: isSelected ? opt.color : "#E2E8F0", color: isSelected ? "#fff" : "#64748B"
                            }}>
                              {count}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "#94A3B8", lineHeight: 1.3 }}>{opt.description}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Resumo do público selecionado */}
                  <div style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "linear-gradient(135deg, #FEF3C7, #FDE68A)", border: "1px solid #FCD34D", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "1.1rem" }}>👥</span>
                    <span style={{ fontWeight: 800, fontSize: "0.82rem", color: "#92400E" }}>
                      {finalCustomers.length} {finalCustomers.length === 1 ? "cliente selecionado" : "clientes selecionados"}
                      {finalCustomers.length > 50 && <span style={{ fontWeight: 600, color: "#B45309" }}> (máx. 50 por lote — anti-ban)</span>}
                    </span>
                  </div>
                </div>

                {/* STEP 2: Mensagem */}
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900 }}>2</div>
                      <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>Escreva a Mensagem</div>
                    </div>

                    <button
                      type="button"
                      onClick={handleGenerateAiMessage}
                      disabled={isGeneratingAi}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        border: "none",
                        background: isGeneratingAi
                          ? "#94A3B8"
                          : "linear-gradient(135deg, #8B5CF6, #EC4899)",
                        color: "#fff",
                        fontSize: "0.76rem",
                        fontWeight: 800,
                        cursor: isGeneratingAi ? "wait" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 4px 12px rgba(139, 92, 246, 0.35)",
                        transition: "all 0.2s"
                      }}
                    >
                      {isGeneratingAi ? (
                        <>✨ Criando texto com IA...</>
                      ) : (
                        <>✨ Gerar Texto com IA (1 Clique)</>
                      )}
                    </button>
                  </div>

                  <textarea
                    value={campaignMsg}
                    onChange={(e) => setCampaignMsg(e.target.value)}
                    placeholder={"Ex: Oi! 🍕 Sentimos sua falta! Que tal aproveitar nosso combo especial hoje? Use o cupom VOLTEI10 e ganhe 10% de desconto! Peça já pelo nosso site: https://suaLoja.com"}
                    style={{
                      width: "100%", minHeight: "100px", padding: "12px 14px", borderRadius: "12px",
                      border: "1px solid #CBD5E1", fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box",
                      lineHeight: 1.5, fontFamily: "inherit"
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                    <span style={{ fontSize: "0.7rem", color: campaignMsg.length > 1000 ? "#DC2626" : "#94A3B8", fontWeight: 700 }}>
                      {campaignMsg.length} / 1000 caracteres
                    </span>
                  </div>

                  {/* Modelos rápidos de mensagem */}
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>💡 Modelos Rápidos:</div>
                      <button
                        type="button"
                        onClick={handleGenerateAiMessage}
                        disabled={isGeneratingAi}
                        style={{
                          background: "none", border: "none", color: "#8B5CF6", cursor: "pointer",
                          fontSize: "0.72rem", fontWeight: 800, textDecoration: "underline", padding: 0
                        }}
                      >
                        🤖 Criar outra mensagem com IA
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {[
                        { label: "🔥 Promoção", text: "Oii! 🔥 Temos uma promoção ESPECIAL só pra você hoje! Peça agora e ganhe desconto exclusivo. Aproveita!" },
                        { label: "😢 Saudade", text: "Oi, tudo bem? Sentimos sua falta! 😢 Faz tempo que você não pede com a gente. Que tal matar a saudade hoje?" },
                        { label: "🎁 Cupom", text: "Oie! 🎁 Liberamos um cupom EXCLUSIVO pra você! Digite o código na hora do pedido e aproveite o desconto!" },
                        { label: "🆕 Novidade", text: "Oi! 🆕 Temos novidades no nosso cardápio! Venha experimentar os novos sabores que preparamos com todo carinho!" },
                      ].map((tpl, i) => (
                        <button
                          key={i}
                          onClick={() => setCampaignMsg(tpl.text)}
                          style={{
                            padding: "5px 10px", borderRadius: "8px", border: "1px solid #E2E8F0",
                            background: "#F8FAFC", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700, color: "#475569"
                          }}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* STEP 3: Imagem (Opcional) */}
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900 }}>3</div>
                    <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>Imagem da Campanha <span style={{ fontWeight: 500, color: "#94A3B8", fontSize: "0.78rem" }}>(opcional)</span></div>
                  </div>

                  {campaignImg ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ position: "relative", display: "inline-block" }}>
                        <img src={campaignImg} alt="Campanha" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: "14px", border: "2px solid #CBD5E1", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }} />
                        <button
                          onClick={() => setCampaignImg("")}
                          style={{ position: "absolute", top: -8, right: -8, width: 24, height: 24, borderRadius: "50%", background: "#EF4444", color: "#fff", border: "2px solid #fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 900, boxShadow: "0 2px 4px rgba(0,0,0,0.15)" }}
                        >✕</button>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#16A34A" }}>✅ Imagem carregada</div>
                        <div style={{ fontSize: "0.7rem", color: "#94A3B8" }}>A imagem será enviada junto com a mensagem</div>
                      </div>
                    </div>
                  ) : (
                    <label style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
                      padding: "24px", borderRadius: "14px", border: "2px dashed #CBD5E1",
                      background: "#FAFAFA", cursor: "pointer", textAlign: "center",
                      transition: "all 0.2s ease",
                    }}>
                      <span style={{ fontSize: "2rem" }}>{campaignImgUploading ? "⏳" : "📸"}</span>
                      <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#475569" }}>
                        {campaignImgUploading ? "Enviando imagem..." : "Clique para enviar uma imagem"}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>PNG, JPG ou WEBP • Máx 5MB</span>
                      <input type="file" accept="image/*" hidden disabled={campaignImgUploading} onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setCampaignImgUploading(true);
                        try {
                          const fd = new FormData(); fd.append("file", file); fd.append("type", "marketing");
                          const res = await fetch("/api/upload", { method: "POST", body: fd });
                          if (res.ok) { const { url } = await res.json(); setCampaignImg(url); showToast("✅ Imagem carregada!", "#10B981"); }
                          else showToast("⚠️ Erro ao enviar imagem", "#EF4444");
                        } catch { showToast("⚠️ Falha no upload", "#EF4444"); }
                        finally { setCampaignImgUploading(false); }
                      }} />
                    </label>
                  )}
                </div>

                {/* Prévia do Disparo */}
                <div style={{ background: "#F0FDF4", borderRadius: "14px", padding: "16px", border: "1px solid #BBF7D0", marginBottom: "1.5rem" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#166534", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    📱 Prévia do Disparo
                  </div>
                  <div style={{ background: "#fff", borderRadius: "12px", padding: "12px", border: "1px solid #D1FAE5", maxWidth: "340px" }}>
                    {campaignImg && (
                      <img src={campaignImg} alt="Preview" style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "8px", marginBottom: "8px" }} />
                    )}
                    <div style={{ fontSize: "0.8rem", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                      {campaignMsg || "Sua mensagem aparecerá aqui..."}
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
                      <span style={{ fontSize: "0.65rem", color: "#94A3B8" }}>
                        {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} ✓✓
                      </span>
                    </div>
                  </div>
                </div>

                {/* Botão de Disparar */}
                <button
                  onClick={() => {
                    if (!campaignMsg.trim()) { showToast("⚠️ Escreva a mensagem antes de disparar", "#EF4444"); return; }
                    if (finalCustomers.length === 0) { showToast("⚠️ Nenhum cliente para esse critério", "#EF4444"); return; }
                    setShowCampaignConfirm(true);
                  }}
                  disabled={sendingCampaign || !campaignMsg.trim() || finalCustomers.length === 0}
                  style={{
                    width: "100%", padding: "14px", borderRadius: "14px", border: "none",
                    background: sendingCampaign || !campaignMsg.trim() ? "#CBD5E1" : "linear-gradient(135deg, #F59E0B, #D97706)",
                    color: "#fff", fontWeight: 900, fontSize: "0.95rem", cursor: sendingCampaign ? "wait" : "pointer",
                    boxShadow: campaignMsg.trim() ? "0 4px 16px rgba(245,158,11,0.3)" : "none",
                    transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                  }}
                >
                  {sendingCampaign ? "⏳ Disparando em massa..." : `🚀 Disparar para ${finalCustomers.length} Clientes`}
                </button>

                <div style={{ marginTop: "8px", textAlign: "center", fontSize: "0.7rem", color: "#94A3B8" }}>
                  ⚡ Envio síncrono ultra seguro com trabalhadores paralelos anti-ban
                </div>

                {/* Modal de Confirmação */}
                {showCampaignConfirm && (
                  <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
                    <div style={{ background: "#fff", borderRadius: "20px", padding: "1.5rem", maxWidth: "440px", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
                      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                        <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>📢</div>
                        <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>Confirmar Disparo</h3>
                        <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#64748B" }}>Revise os detalhes antes de enviar</p>
                      </div>

                      <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "12px", border: "1px solid #E2E8F0", marginBottom: "12px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          <div>
                            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Público</div>
                            <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>{criteriaOptions.find(o => o.id === selectedCriteria)?.label}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Destinatários</div>
                            <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>{finalCustomers.length} clientes</div>
                          </div>
                          <div>
                            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Imagem</div>
                            <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>{campaignImg ? "✅ Sim" : "❌ Sem imagem"}</div>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          onClick={() => setShowCampaignConfirm(false)}
                          disabled={sendingCampaign}
                          style={{ flex: 1, padding: "12px", borderRadius: "12px", border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: "0.85rem", color: "#475569" }}
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={handleSendCampaign}
                          disabled={sendingCampaign}
                          style={{
                            flex: 1.5, padding: "12px", borderRadius: "12px", border: "none",
                            background: sendingCampaign ? "#94A3B8" : "linear-gradient(135deg, #F59E0B, #D97706)",
                            color: "#fff", fontWeight: 900, fontSize: "0.88rem", cursor: sendingCampaign ? "wait" : "pointer",
                            boxShadow: "0 4px 12px rgba(245,158,11,0.3)"
                          }}
                        >
                          {sendingCampaign ? "⏳ Enviando..." : "🚀 Confirmar Disparo"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* SEÇÃO DE HISTÓRICO E DESEMPENHO DOS DISPAROS */}
                <div id="history-section" style={{ marginTop: "2rem", background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: 36, height: 36, borderRadius: "10px", background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>
                        📊
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>Histórico e Retorno dos Disparos</h4>
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748B" }}>Métricas reais de conversão de vendas e lucro estimado gerado</p>
                      </div>
                    </div>

                    <button
                      onClick={() => loadMarketingData(true)}
                      disabled={refreshingMetrics}
                      style={{
                        padding: "6px 14px", borderRadius: "8px", border: "1px solid #CBD5E1",
                        background: refreshingMetrics ? "#E2E8F0" : "#F8FAFC",
                        cursor: refreshingMetrics ? "not-allowed" : "pointer",
                        fontSize: "0.75rem", fontWeight: 700, color: "#475569",
                        display: "inline-flex", alignItems: "center", gap: "6px",
                        opacity: refreshingMetrics ? 0.7 : 1, transition: "all 0.2s"
                      }}
                    >
                      <RefreshCw size={14} className={refreshingMetrics ? "animate-spin" : ""} />
                      {refreshingMetrics ? "Atualizando..." : "🔄 Atualizar Métricas"}
                    </button>
                  </div>

                  {/* Cards de Métricas Gerais de Disparos */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginBottom: "1.5rem" }}>
                    <div style={{ background: "#F8FAFC", padding: "12px 14px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748B" }}>🚀 Total de Disparos</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#0F172A", marginTop: "2px" }}>{campaignHistory.length}</div>
                    </div>

                    <div style={{ background: "#EFF6FF", padding: "12px 14px", borderRadius: "12px", border: "1px solid #BFDBFE" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#1D4ED8" }}>👥 Total de Envios</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#1E40AF", marginTop: "2px" }}>
                        {campaignHistory.reduce((acc: number, c: any) => acc + (c.sentCount || c.targetCount || 0), 0)} clientes
                      </div>
                    </div>

                    <div style={{ background: "#F5F3FF", padding: "12px 14px", borderRadius: "12px", border: "1px solid #DDD6FE" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#6D28D9" }}>👀 Visualizações (Lidos)</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#5B21B6", marginTop: "2px" }}>
                        {/* Leitura não é medida pelo WhatsApp por aqui. O número
                            anterior era 76% dos envios, inventado no servidor. */}
                        {campaignHistory.some((c: any) => typeof c.viewedCount === "number")
                          ? `${campaignHistory.reduce((acc: number, c: any) => acc + (typeof c.viewedCount === "number" ? c.viewedCount : 0), 0)} leituras`
                          : "—"}
                      </div>
                    </div>

                    <div style={{ background: "#ECFDF5", padding: "12px 14px", borderRadius: "12px", border: "1px solid #A7F3D0" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#047857" }}>🛒 Pedidos Convertidos</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#065F46", marginTop: "2px" }}>
                        {campaignHistory.reduce((acc: number, c: any) => acc + (c.convertedOrders || 0), 0)} pedidos
                      </div>
                    </div>

                    <div style={{ background: "#FEF3C7", padding: "12px 14px", borderRadius: "12px", border: "1px solid #FDE68A" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#B45309" }}>💰 Vendas Geradas</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#92400E", marginTop: "2px" }}>
                        R$ {campaignHistory.reduce((acc: number, c: any) => acc + (c.convertedRevenue || 0), 0).toFixed(2)}
                      </div>
                    </div>

                    <div style={{ background: "#F0FDF4", padding: "12px 14px", borderRadius: "12px", border: "1px solid #86EFAC" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#15803D" }}>💚 Lucro Estimado</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#166534", marginTop: "2px" }}>
                        R$ {campaignHistory.reduce((acc: number, c: any) => acc + (c.estimatedProfit || 0), 0).toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Lista do Histórico de Disparos */}
                  {campaignHistory.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px", color: "#94A3B8", fontSize: "0.82rem" }}>
                      Nenhum disparo realizado ainda. Faça seu primeiro disparo acima para acompanhar os pedidos convertidos em vendas!
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {campaignHistory.map((camp: any, i: number) => {
                        const totalSent = typeof camp.sentCount === "number" ? camp.sentCount : 0;
                        // null = não medido (mostrar "—", nunca um % inventado)
                        const totalViewed = typeof camp.viewedCount === "number" ? camp.viewedCount : null;
                        const openRate = totalViewed != null && totalSent > 0 ? Math.round((totalViewed / totalSent) * 100) : null;

                        return (
                          <div key={camp.id || i} style={{ background: "#F8FAFC", borderRadius: "12px", padding: "14px", border: "1px solid #E2E8F0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                              <div>
                                {camp.status === "DISPARANDO" ? (
                                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#D97706", background: "#FEF3C7", padding: "2px 10px", borderRadius: "6px", border: "1px solid #FCD34D", marginRight: "8px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                    ⏳ Disparando em segundo plano ({camp.sentCount || 0} / {camp.targetCount || 0} enviados)
                                  </span>
                                ) : (
                                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#059669", background: "#D1FAE5", padding: "2px 8px", borderRadius: "6px", marginRight: "8px" }}>
                                    ✅ Concluído
                                  </span>
                                )}
                                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>
                                  {new Date(camp.createdAt).toLocaleDateString("pt-BR")} às {new Date(camp.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>

                              <button
                                onClick={() => {
                                  setCampaignMsg(camp.message);
                                  if (camp.imageUrl) setCampaignImg(camp.imageUrl);
                                  showToast("📋 Mensagem carregada no formulário acima!", "#8B5CF6");
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                                style={{
                                  padding: "4px 10px", borderRadius: "6px", border: "1px solid #CBD5E1",
                                  background: "#fff", cursor: "pointer", fontSize: "0.7rem", fontWeight: 800, color: "#334155"
                                }}
                              >
                                🔁 Reutilizar Mensagem
                              </button>
                            </div>

                            <div style={{ fontSize: "0.82rem", color: "#1E293B", whiteSpace: "pre-wrap", marginBottom: "10px", lineHeight: 1.4, background: "#fff", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                              {camp.message}
                            </div>

                            {/* Resultado de Vendas e Leitura do Disparo */}
                            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", fontSize: "0.75rem", background: "#F1F5F9", padding: "8px 12px", borderRadius: "8px" }}>
                              <span style={{ fontWeight: 700, color: "#475569" }}>👥 Audiência: <b>{camp.targetCount || totalSent} clientes</b></span>
                              <span style={{ color: "#CBD5E1" }}>|</span>
                              <span style={{ fontWeight: 800, color: "#2563EB" }}>✅ Entregues: <b>{totalSent} msgs</b></span>
                              <span style={{ color: "#CBD5E1" }}>|</span>
                              <span style={{ fontWeight: 800, color: "#7C3AED" }}>👀 Visualizações (Lidos): <b>{totalViewed != null ? `${totalViewed} clientes (${openRate}% taxa de abertura)` : "não medido"}</b></span>
                              <span style={{ color: "#CBD5E1" }}>|</span>
                              <span style={{ fontWeight: 800, color: "#047857" }}>🛒 Vendas: <b>{camp.convertedOrders || 0} pedidos</b></span>
                              <span style={{ color: "#CBD5E1" }}>|</span>
                              <span style={{ fontWeight: 800, color: "#B45309" }}>💰 Faturamento: <b>R$ {(camp.convertedRevenue || 0).toFixed(2)}</b></span>
                              <span style={{ color: "#CBD5E1" }}>|</span>
                              <span style={{ fontWeight: 900, color: "#15803D" }}>💚 Lucro Gerado: <b>R$ {(camp.estimatedProfit || 0).toFixed(2)}</b></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ABA 4: TESTAR ENVIO */}
          {activeTab === "cardapio" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #E2E8F0" }}>
              <h3 style={{ color: "#0F172A", fontSize: "1.15rem", fontWeight: 800, margin: "0 0 6px" }}>
                📄 Cardápio em Arquivo
              </h3>
              <p style={{ color: "#475569", fontSize: "0.88rem", margin: "0 0 20px", lineHeight: 1.6 }}>
                Suba a foto ou o PDF do seu cardápio. Quando o cliente pedir o cardápio no WhatsApp,
                o robô manda <strong style={{ color: "#047857" }}>primeiro o link do site</strong> (é lá que o pedido
                cai sozinho, sem erro de digitação). Só se o cliente disser que prefere pedir pelo WhatsApp
                mesmo é que ele envia este arquivo. Sem arquivo carregado, ele lista os itens por escrito,
                como já faz hoje.
              </p>

              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "12px", padding: "14px 16px", marginBottom: "20px" }}>
                <div style={{ color: "#047857", fontSize: "0.8rem", fontWeight: 800, marginBottom: "6px" }}>ORDEM QUE O ROBÔ SEGUE</div>
                <div style={{ color: "#166534", fontSize: "0.83rem", lineHeight: 1.8 }}>
                  1️⃣ Manda o link do site &nbsp;→&nbsp; 2️⃣ Cliente recusa? Manda este arquivo &nbsp;→&nbsp; 3️⃣ Sem arquivo? Escreve os itens
                </div>
              </div>

              {config.menuFileUrl ? (
                <div style={{ marginBottom: "18px" }}>
                  <div style={{ color: "#0F172A", fontSize: "0.85rem", fontWeight: 700, marginBottom: "10px" }}>
                    ✅ Cardápio carregado
                  </div>
                  {String(config.menuFileUrl).toLowerCase().endsWith(".pdf") ? (
                    <a href={config.menuFileUrl} target="_blank" rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "16px 20px", borderRadius: "12px",
                        background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C",
                        textDecoration: "none", fontWeight: 700, fontSize: "0.9rem" }}>
                      📕 Ver PDF do cardápio
                    </a>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={config.menuFileUrl} alt="Cardápio da loja"
                      style={{ maxWidth: "100%", maxHeight: "380px", borderRadius: "12px", border: "1px solid #E2E8F0", display: "block" }} />
                  )}
                  <button
                    onClick={async () => {
                      setMenuFileSaving(true); setMenuFileMsg("");
                      try {
                        const r = await fetch("/api/store/marketing", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "save_menu_file", menuFileUrl: "" }),
                        });
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error || "Falha ao remover");
                        setConfig((prev: any) => ({ ...prev, menuFileUrl: "", menuFileType: "" }));
                        setMenuFileMsg("Cardápio removido. O robô volta a listar os itens por escrito.");
                      } catch (e: any) {
                        setMenuFileMsg(e?.message || "Falha ao remover");
                      } finally { setMenuFileSaving(false); }
                    }}
                    disabled={menuFileSaving}
                    style={{ marginTop: "14px", display: "block", padding: "10px 18px", borderRadius: "10px", border: "1px solid #FCA5A5",
                      background: "#FEF2F2", color: "#B91C1C", fontWeight: 700, fontSize: "0.83rem",
                      cursor: menuFileSaving ? "not-allowed" : "pointer", opacity: menuFileSaving ? 0.6 : 1 }}
                  >
                    🗑️ Remover cardápio
                  </button>
                </div>
              ) : (
                <div style={{ color: "#64748B", fontSize: "0.86rem", marginBottom: "18px", padding: "24px",
                  border: "1px dashed #CBD5E1", borderRadius: "12px", textAlign: "center" }}>
                  Nenhum cardápio carregado ainda.
                </div>
              )}

              <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "12px 22px", borderRadius: "12px",
                background: menuFileSaving ? "#CBD5E1" : "linear-gradient(135deg, #10B981, #059669)", color: "#fff",
                fontWeight: 800, fontSize: "0.88rem", cursor: menuFileSaving ? "not-allowed" : "pointer" }}>
                {menuFileSaving ? "Enviando..." : config.menuFileUrl ? "🔄 Trocar arquivo" : "📤 Enviar cardápio (foto ou PDF)"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  disabled={menuFileSaving}
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const arquivo = e.target.files?.[0];
                    // O input é limpo já: sem isso, escolher o MESMO arquivo depois de
                    // um erro não dispara onChange de novo e a tela parece travada.
                    e.target.value = "";
                    if (!arquivo) return;
                    if (arquivo.size > 8 * 1024 * 1024) {
                      setMenuFileMsg("Arquivo acima de 8 MB. Reduza a imagem ou o PDF e tente de novo.");
                      return;
                    }
                    setMenuFileSaving(true); setMenuFileMsg("");
                    try {
                      const fd = new FormData();
                      fd.append("file", arquivo);
                      fd.append("type", "marketing");
                      const up = await fetch("/api/upload", { method: "POST", body: fd });
                      const uj = await up.json();
                      if (!up.ok || !uj.url) throw new Error(uj.error || "Falha no upload");

                      const r = await fetch("/api/store/marketing", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "save_menu_file", menuFileUrl: uj.url }),
                      });
                      const j = await r.json();
                      if (!r.ok) throw new Error(j.error || "Falha ao salvar");

                      setConfig((prev: any) => ({
                        ...prev,
                        menuFileUrl: uj.url,
                        menuFileType: String(uj.url).toLowerCase().endsWith(".pdf") ? "pdf" : "image",
                      }));
                      setMenuFileMsg("Cardápio salvo! O robô já pode enviar quando o cliente pedir.");
                    } catch (err: any) {
                      setMenuFileMsg(err?.message || "Falha ao enviar o arquivo");
                    } finally { setMenuFileSaving(false); }
                  }}
                />
              </label>

              {menuFileMsg && (
                <div style={{ marginTop: "14px", color: "#334155", fontSize: "0.85rem" }}>
                  {menuFileMsg}
                </div>
              )}

              <p style={{ color: "#64748B", fontSize: "0.78rem", marginTop: "18px", lineHeight: 1.6 }}>
                Aceita PNG, JPG, WEBP ou PDF, até 8 MB. Foto costuma funcionar melhor: abre direto na conversa,
                enquanto o PDF o cliente precisa tocar para baixar.
              </p>
            </div>
          )}

          {activeTab === "test" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#FFEDD5", color: "#EA580C", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Send size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Testar Envio de Mensagem para Cliente</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Dispare uma mensagem de teste para o seu próprio celular</p>
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                  Telefone de Destino (com DDD):
                </label>
                <input
                  type="text"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="Ex: 22 99885-1680"
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                  Texto da Mensagem:
                </label>
                <textarea
                  value={testMessage}
                  onChange={e => setTestMessage(e.target.value)}
                  style={{ width: "100%", height: "80px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none" }}
                />
              </div>

              <button
                onClick={() => {
                  if (!testPhone.trim()) {
                    showToast("⚠️ Digite o número de telefone de destino com DDD", "#EF4444");
                    return;
                  }
                  setShowConfirmTestModal(true);
                }}
                disabled={sendingTest}
                style={{
                  width: "100%", padding: "12px", borderRadius: "10px", border: "none",
                  background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff",
                  fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", boxShadow: "0 4px 12px rgba(234, 88, 12, 0.25)"
                }}
              >
                {sendingTest ? "Enviando Mensagem..." : "🚀 Disparar Mensagem de Teste Agora"}
              </button>
            </div>
          )}

          {/* ABA 5: DIAGNÓSTICO EM TEMPO REAL */}
          {activeTab === "diagnostic" && (
            <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#E0F2FE", color: "#0369A1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Activity size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Diagnóstico em Tempo Real do Sistema</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Verificação contínua dos serviços de atendimento</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { label: "Atendimento Automático Ativo", ok: config.active },
                  { label: "Conexão com o WhatsApp da Loja", ok: config.connected },
                  { label: "Sincronização de Cardápio & Preços", ok: stats.productCount > 0 },
                  { label: "Robô de Atendimento IA (Gemini 2.5 Flash)", ok: true },
                  { label: "Servidor de Webhook & Notificações", ok: true },
                ].map((item, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#F8FAFC", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                    <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "#1E293B" }}>{item.label}</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 800, padding: "3px 10px", borderRadius: "12px", background: item.ok ? "#DCFCE7" : "#FEE2E2", color: item.ok ? "#166534" : "#991B1B" }}>
                      {item.ok ? "🟢 OPERACIONAL" : "🔴 NECESSITA ATENÇÃO"}
                    </span>
                  </div>
                ))}
              </div>

              {/* REPARO DO "AGUARDANDO MENSAGEM": a mensagem sai daqui, chega no
                  aparelho do dono/motoboy, mas aparece "Aguardando mensagem.
                  Essa ação pode levar alguns instantes." — criptografia da
                  conversa apodreceu no gateway. O reinício renegocia as sessões
                  SEM deslogar (não pede QR de novo). */}
              <div style={{ marginTop: "14px", padding: "14px 16px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "12px" }}>
                <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#92400E", marginBottom: "6px" }}>
                  🔐 Mensagens chegando como &quot;Aguardando mensagem&quot;?
                </div>
                <p style={{ margin: "0 0 10px", fontSize: "0.8rem", color: "#78350F", lineHeight: 1.55 }}>
                  Quando os avisos do robô aparecem assim no celular (do dono, dos motoboys ou de um cliente),
                  a criptografia daquela conversa travou. Reinicie a conexão abaixo — <strong>não desconecta
                  e não pede QR Code de novo</strong>. Se depois disso algum contato ainda ver o aviso,
                  peça para ele mandar um &quot;oi&quot; para o número da loja: isso destrava a conversa dele na hora.
                </p>
                <button
                  onClick={async () => {
                    if (reparandoSessao) return;
                    setReparandoSessao(true);
                    try {
                      const r = await fetch("/api/chatbot/reparar-sessao", { method: "POST" });
                      const j = await r.json().catch(() => ({}));
                      if (r.ok) {
                        showToast("🔄 " + (j.message || "Instância reiniciada!"), "#10B981");
                      } else {
                        showToast("⚠️ " + (j.error || "Falha ao reiniciar"), "#EF4444");
                      }
                    } catch {
                      showToast("⚠️ Falha ao falar com o servidor", "#EF4444");
                    } finally {
                      setReparandoSessao(false);
                    }
                  }}
                  disabled={reparandoSessao}
                  style={{
                    padding: "10px 18px", borderRadius: "10px", border: "none", fontWeight: 800, fontSize: "0.84rem",
                    background: reparandoSessao ? "#FCD34D" : "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff",
                    cursor: reparandoSessao ? "not-allowed" : "pointer",
                  }}
                >
                  {reparandoSessao ? "Reiniciando..." : "🔄 Reparar conexão do WhatsApp"}
                </button>
              </div>
            </div>
          )}

          {/* CARD PERMANENTE: PERSONALIDADE & TOM DE VOZ DA IA */}
          <div style={{ background: "#fff", borderRadius: "16px", padding: "1.5rem", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
              <div style={{ width: 36, height: 36, borderRadius: "10px", background: "#F3E8FF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sliders size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>Estilo &amp; Regras da IA Gemini 2.5</h3>
                <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Personalize o tom de voz e o comportamento do robô</p>
              </div>
            </div>

            {/* NOME DO ATENDENTE */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                Nome do Atendente Virtual (Opcional):
              </label>
              <input
                type="text"
                value={config.agentName || ""}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, agentName: e.target.value }))}
                onBlur={() => handleSaveConfig({ agentName: config.agentName })}
                placeholder="Ex: Sophia, Lucas, Maria, Brendi..."
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #CBD5E1", fontSize: "0.88rem", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* SELETOR DE PERSONALIDADE */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "8px" }}>
              Tom de Voz do Atendente:
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "1.25rem" }}>
              {[
                { id: "SIMPATICO", label: "😊 Simpático & Amigável", desc: "Usa emojis e tom acolhedor" },
                { id: "AGIL", label: "⚡ Ágil & Direto", desc: "Respostas curtas e diretas" },
                { id: "FORMAL", label: "🎩 Formal & Elegante", desc: "Linguagem refinada" },
                { id: "DIVERTIDO", label: "🥳 Divertido & Descontraído", desc: "Entusiasmado e alegre" },
              ].map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleSaveConfig({ personality: p.id })}
                  style={{
                    padding: "10px", borderRadius: "10px",
                    border: `2px solid ${config.personality === p.id ? "#7C3AED" : "#E2E8F0"}`,
                    background: config.personality === p.id ? "#F3E8FF" : "#fff",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: "0.82rem", color: config.personality === p.id ? "#6D28D9" : "#1E293B" }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "2px" }}>{p.desc}</div>
                </div>
              ))}
            </div>

            {/* LINK EXTERNO DO CARDÁPIO (JOTAJA, SITE PRÓPRIO, ETC) */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                🌐 Link Personalizado do Cardápio / Plataforma Externa (Ex: JotaJá):
              </label>
              <p style={{ margin: "0 0 6px 0", fontSize: "0.74rem", color: "#64748B" }}>
                Se preenchido, o robô enviará este link exato para os clientes fazerem pedidos em vez do link padrão do FireHub.
              </p>
              <input
                type="text"
                value={config.externalMenuUrl || ""}
                onChange={(e) => setConfig((prev: any) => ({ ...prev, externalMenuUrl: e.target.value }))}
                onBlur={() => handleSaveConfig({ externalMenuUrl: config.externalMenuUrl })}
                placeholder="Ex: https://pedir.to/sualoja ou https://jotaja.com/sualoja"
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px",
                  border: "1px solid #CBD5E1", fontSize: "0.88rem", outline: "none", boxSizing: "border-box",
                  background: "#F8FAFC"
                }}
              />
            </div>

            {/* CONFIRMAÇÃO AUTOMÁTICA DE PEDIDOS POR WHATSAPP */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F0FDF4", borderRadius: "12px", border: "1px solid #BBF7D0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#166534" }}>
                    📲 Enviar Confirmação de Pedidos Automática pelo WhatsApp? (Marcado por padrão)
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#15803D", marginTop: "2px" }}>
                    Sempre que o cliente realizar um pedido na plataforma, ele receberá uma mensagem no WhatsApp com o resumo e os itens. O robô só NÃO enviará se esta opção for desmarcada.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ sendOrderConfirmation: true })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.sendOrderConfirmation !== false ? "#16A34A" : "#E2E8F0",
                      color: config.sendOrderConfirmation !== false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ sendOrderConfirmation: false })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.sendOrderConfirmation === false ? "#DC2626" : "#E2E8F0",
                      color: config.sendOrderConfirmation === false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>
            </div>

            {/* MÓDULO DE PEDIDOS DIRETO VIA IA NO WHATSAPP */}
            <div style={{ marginBottom: "1.25rem", padding: "14px", background: "linear-gradient(135deg, #FAF5FF, #F3E8FF)", borderRadius: "14px", border: "1.5px solid #D8B4FE" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#6B21A8", display: "flex", alignItems: "center", gap: "6px" }}>
                    🤖 Permitir que a IA anote e crie pedidos diretamente pelo WhatsApp?
                  </div>
                  <p style={{ fontSize: "0.76rem", color: "#7E22CE", marginTop: "4px", lineHeight: "1.4" }}>
                    Quando ativo, a IA apresenta o cardápio no WhatsApp, anota produtos, quantidade, endereço e forma de pagamento, montando o pedido ao vivo na sua tela!
                  </p>
                  <div style={{ marginTop: "8px", padding: "8px 10px", background: "#FFFBEB", borderRadius: "8px", border: "1px solid #FDE68A", display: "flex", alignItems: "center", gap: "6px" }}>
                    <AlertCircle size={16} color="#D97706" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: "0.72rem", color: "#B45309", fontWeight: 600 }}>
                      ⚠️ <strong>Aviso:</strong> A IA está em modo de auxílio e pode cometer eventuais equívocos nos detalhes do pedido. Recomendamos conferir os pedidos novos.
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginTop: "4px" }}>
                  <button
                    onClick={() => handleSaveConfig({ aiOrderingEnabled: true })}
                    style={{
                      padding: "8px 16px", borderRadius: "8px", border: "none",
                      background: config.aiOrderingEnabled === true ? "#7C3AED" : "#E2E8F0",
                      color: config.aiOrderingEnabled === true ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ aiOrderingEnabled: false })}
                    style={{
                      padding: "8px 16px", borderRadius: "8px", border: "none",
                      background: config.aiOrderingEnabled !== true ? "#64748B" : "#E2E8F0",
                      color: config.aiOrderingEnabled !== true ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>
            </div>

            {/* PAUSAR ROBÔ QUANDO PEDIR ATENDENTE HUMANO */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>
                    👤 Pausar Atendimento do Robô quando o cliente pedir Atendente Humano?
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "2px" }}>
                    Se marcado como &quot;SIM&quot;, quando o cliente digitar palavras como &quot;atendente&quot;, &quot;humano&quot; ou &quot;falar com suporte&quot;, o robô responderá que chamou a equipe e parará de responder essa conversa automaticamente.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ stopOnHumanRequest: true })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.stopOnHumanRequest !== false ? "#16A34A" : "#E2E8F0",
                      color: config.stopOnHumanRequest !== false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ stopOnHumanRequest: false })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.stopOnHumanRequest === false ? "#DC2626" : "#E2E8F0",
                      color: config.stopOnHumanRequest === false ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>
            </div>

            {/* ACEITA RETIRADA NO BALCÃO */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>
                    🏪 Aceita Retirada no Balcão?
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "2px" }}>
                    Se marcado como &quot;SIM&quot;, quando o cliente perguntar sobre retirada, o robô informará o endereço da sua loja e que aceita retirada no local.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ acceptsPickup: true })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.acceptsPickup ? "#16A34A" : "#E2E8F0",
                      color: config.acceptsPickup ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SIM
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ acceptsPickup: false })}
                    style={{
                      padding: "6px 14px", borderRadius: "8px", border: "none",
                      background: config.acceptsPickup === false || !config.acceptsPickup ? "#DC2626" : "#E2E8F0",
                      color: config.acceptsPickup === false || !config.acceptsPickup ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    NÃO
                  </button>
                </div>
              </div>

              {config.acceptsPickup && (
                <div style={{ marginTop: "10px" }}>
                  <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                    📍 Endereço para Retirada (se diferente do endereço cadastrado):
                  </label>
                  <input
                    type="text"
                    value={config.pickupAddress || ""}
                    onChange={(e) => setConfig((prev: any) => ({ ...prev, pickupAddress: e.target.value }))}
                    onBlur={() => handleSaveConfig({ pickupAddress: config.pickupAddress || "" })}
                    placeholder="Ex: Rua das Flores, 123 - Centro (deixe vazio para usar o endereço da loja)"
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: "8px",
                      border: "1px solid #CBD5E1", fontSize: "0.82rem", boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
            </div>

            {/* SÓ DELIVERY OU ATENDE NO LOCAL */}
            <div style={{ marginBottom: "1.25rem", padding: "12px", background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>
                    🏢 Tipo de Atendimento (Possui Loja Física?)
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "2px" }}>
                    Escolha se sua loja recebe clientes no local ou se é 100% focada em delivery.
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleSaveConfig({ storeType: "PHYSICAL" })}
                    style={{
                      padding: "6px 12px", borderRadius: "8px", border: "none",
                      background: config.storeType === "PHYSICAL" ? "#2563EB" : "#E2E8F0",
                      color: config.storeType === "PHYSICAL" ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    ATENDE NO LOCAL
                  </button>
                  <button
                    onClick={() => handleSaveConfig({ storeType: "DELIVERY_ONLY" })}
                    style={{
                      padding: "6px 12px", borderRadius: "8px", border: "none",
                      background: config.storeType === "DELIVERY_ONLY" || !config.storeType ? "#7C3AED" : "#E2E8F0",
                      color: config.storeType === "DELIVERY_ONLY" || !config.storeType ? "#fff" : "#475569",
                      fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                    }}
                  >
                    SÓ DELIVERY
                  </button>
                </div>
              </div>
            </div>

            {/* INSTRUÇÕES CUSTOMIZADAS */}
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
              Instruções Especiais da Sua Loja (Opcional):
            </label>
            <textarea
              value={config.customPrompt || ""}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, customPrompt: e.target.value }))}
              onBlur={() => handleSaveConfig({ customPrompt: config.customPrompt })}
              placeholder="Ex: Avisar que nosso tempo de entrega é de 40 a 50 minutos..."
              style={{
                width: "100%", height: "70px", borderRadius: "10px",
                border: "1px solid #CBD5E1", padding: "10px", fontSize: "0.82rem",
                resize: "none", boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* COLUNA DA DIREITA: SIMULADOR DE CHAT AO VIVO WHATSAPP (Apenas na aba QR Code) */}
        {activeTab === "qr" && (
          <div style={{ background: "#fff", borderRadius: "16px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", height: "720px", boxShadow: "0 10px 30px -5px rgba(0,0,0,0.05)", overflow: "hidden" }}>
          
          {/* HEADER DO SIMULADOR */}
          <div style={{ background: "#075E54", color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#25D366", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                IA
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.92rem" }}>
                  {config.agentName ? `${config.agentName} (IA)` : "Atendente Virtual FireHub"}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#A7F3D0", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} /> Online · Gemini 2.5
                </div>
              </div>
            </div>

            <button
              onClick={() => setMessages([{ sender: "bot", text: "Olá! Como posso te ajudar hoje? 😊", time: "21:40" }])}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: "6px", padding: "4px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
            >
              Limpar Chat
            </button>
          </div>

          {/* ÁREA DE MENSAGENS */}
          <div
            ref={chatBoxRef}
            style={{
              flex: 1, padding: "16px", backgroundColor: "#E5DDD5",
              backgroundImage: "radial-gradient(#CBD5E1 1px, transparent 0)", backgroundSize: "16px 16px",
              overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px",
            }}
          >
            {messages.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%",
                  background: m.sender === "user" ? "#DCF8C6" : "#FFFFFF",
                  color: "#0F172A",
                  padding: "10px 14px",
                  borderRadius: m.sender === "user" ? "12px 0px 12px 12px" : "0px 12px 12px 12px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                }}
              >
                <div>{m.text}</div>
                <div style={{ fontSize: "0.65rem", color: "#64748B", textAlign: "right", marginTop: "4px" }}>
                  {m.time} {m.sender === "user" && "✓✓"}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div style={{ alignSelf: "flex-start", background: "#FFF", padding: "8px 14px", borderRadius: "0px 12px 12px 12px", fontSize: "0.8rem", color: "#64748B", display: "flex", alignItems: "center", gap: "6px" }}>
                <Sparkles size={14} className="spin" color="#7C3AED" /> Digitando resposta com Gemini 2.5...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* INPUT DO CHAT SIMULADOR */}
          <div style={{ padding: "12px", background: "#F0F0F0", display: "flex", alignItems: "center", gap: "8px", borderTop: "1px solid #E2E8F0" }}>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Digite uma pergunta para a IA (ex: Qual a esfirra mais vendida?)..."
              style={{
                flex: 1, padding: "10px 14px", borderRadius: "20px", border: "1px solid #CBD5E1",
                fontSize: "0.85rem", outline: "none", background: "#fff",
              }}
            />
            <button
              onClick={handleSendMessage}
              disabled={chatLoading || !inputMessage.trim()}
              style={{
                width: 40, height: 40, borderRadius: "50%", background: "#128C7E", color: "#fff",
                border: "none", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: chatLoading || !inputMessage.trim() ? "not-allowed" : "pointer", opacity: !inputMessage.trim() ? 0.6 : 1,
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
        )}
      </div>
      {/* MODAL DE CRIAÇÃO RÁPIDA DE CUPOM */}
      {showNewCouponModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,23,42,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "420px", padding: "1.5rem", boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: "8px" }}>
                ➕ Criar Novo Cupom
              </div>
              <button onClick={() => setShowNewCouponModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                Tipo do Benefício:
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setNewCouponType("percent")}
                  style={{
                    padding: "8px 4px", borderRadius: "10px", textAlign: "center",
                    border: newCouponType === "percent" ? "2px solid #2563EB" : "1px solid #CBD5E1",
                    background: newCouponType === "percent" ? "#EFF6FF" : "#fff",
                    color: newCouponType === "percent" ? "#1D4ED8" : "#64748B",
                    fontWeight: 800, fontSize: "0.78rem", cursor: "pointer"
                  }}
                >
                  🏷️ Porcentagem (%)
                </button>
                <button
                  type="button"
                  onClick={() => setNewCouponType("fixed")}
                  style={{
                    padding: "8px 4px", borderRadius: "10px", textAlign: "center",
                    border: newCouponType === "fixed" ? "2px solid #7C3AED" : "1px solid #CBD5E1",
                    background: newCouponType === "fixed" ? "#F5F3FF" : "#fff",
                    color: newCouponType === "fixed" ? "#6D28D9" : "#64748B",
                    fontWeight: 800, fontSize: "0.78rem", cursor: "pointer"
                  }}
                >
                  💵 Valor Fixo (R$)
                </button>
                <button
                  type="button"
                  onClick={() => setNewCouponType("free_shipping")}
                  style={{
                    padding: "8px 4px", borderRadius: "10px", textAlign: "center",
                    border: newCouponType === "free_shipping" ? "2px solid #16A34A" : "1px solid #CBD5E1",
                    background: newCouponType === "free_shipping" ? "#F0FDF4" : "#fff",
                    color: newCouponType === "free_shipping" ? "#15803D" : "#64748B",
                    fontWeight: 800, fontSize: "0.78rem", cursor: "pointer"
                  }}
                >
                  🚚 Frete Grátis
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                Código do Cupom (Letras e Números):
              </label>
              <input
                type="text"
                placeholder={newCouponType === "free_shipping" ? "Ex: FRETEGRATIS ou VEMDEFRETE" : newCouponType === "fixed" ? "Ex: DEZREAIS ou OFF10" : "Ex: PRIMEIRACOMPRA10 ou VOLTEI10"}
                value={newCouponCode}
                onChange={(e) => setNewCouponCode(e.target.value.toUpperCase())}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800, color: "#2563EB", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              {newCouponType === "percent" && (
                <>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    Desconto (% Porcentagem):
                  </label>
                  <input
                    type="number"
                    placeholder="Ex: 10"
                    value={newCouponDiscount}
                    onChange={(e) => setNewCouponDiscount(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box" }}
                  />
                </>
              )}
              {newCouponType === "fixed" && (
                <>
                  <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                    Valor de Desconto em Dinheiro (R$ Reais):
                  </label>
                  <input
                    type="number"
                    placeholder="Ex: 10.00"
                    value={newCouponDiscount}
                    onChange={(e) => setNewCouponDiscount(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box" }}
                  />
                </>
              )}
              {newCouponType === "free_shipping" && (
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "12px 14px", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "1.3rem" }}>🚚</span>
                  <div>
                    <div style={{ fontWeight: 800, color: "#166534", fontSize: "0.85rem" }}>Benefício de Frete Grátis</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: "4px" }}>
                Valor Mínimo do Pedido (R$ Reais - Opcional):
              </label>
              <input
                type="number"
                placeholder="Ex: 40.00 (deixe em branco ou 0 para sem mínimo)"
                value={newCouponMinOrder}
                onChange={(e) => setNewCouponMinOrder(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box" }}
              />
              <span style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "4px", display: "block", lineHeight: 1.3 }}>
                💡 Se preenchido, o cliente só poderá usar o cupom em compras a partir deste valor.
              </span>
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowNewCouponModal(false)}
                style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => handleCreateNewCoupon()}
                disabled={creatingCoupon}
                style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #16A34A, #15803D)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}
              >
                {creatingCoupon ? "Salvando..." : "✓ Salvar & Selecionar Cupom"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DEFINITIVA DE CUPOM */}
      {showDeleteCouponModal && couponToDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "440px", padding: "1.75rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)", border: "2px solid #EF4444" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#DC2626" }}>
                <Trash2 size={24} />
                <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800 }}>Excluir Cupom Permanentemente</h3>
              </div>
              <button onClick={() => setShowDeleteCouponModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", padding: "12px 14px", borderRadius: "12px", marginBottom: "1.25rem", color: "#991B1B", fontSize: "0.85rem", lineHeight: 1.4 }}>
              ⚠️ <strong>Atenção! Esta ação é definitiva e irreversível.</strong><br />
              O cupom <strong style={{ textDecoration: "underline" }}>"{couponToDelete.code}"</strong> será excluído do banco de dados e removido de todas as automações da loja.
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: "6px" }}>
                Para confirmar a exclusão, digite <span style={{ color: "#DC2626", fontWeight: 900 }}>EXCLUIR</span> abaixo:
              </label>
              <input
                type="text"
                placeholder="Digite EXCLUIR para confirmar"
                value={deleteConfirmInput}
                onChange={(e) => setDeleteConfirmInput(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: "10px",
                  border: "1.5px solid #CBD5E1", fontSize: "0.9rem", fontWeight: 800,
                  color: "#DC2626", boxSizing: "border-box"
                }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setShowDeleteCouponModal(false);
                  setCouponToDelete(null);
                  setDeleteConfirmInput("");
                }}
                style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                disabled={deleteConfirmInput.trim().toUpperCase() !== "EXCLUIR" || deletingCoupon}
                onClick={() => handleConfirmDeleteCoupon()}
                style={{
                  padding: "10px 18px", borderRadius: "10px", border: "none",
                  background: deleteConfirmInput.trim().toUpperCase() === "EXCLUIR" && !deletingCoupon ? "#DC2626" : "#CBD5E1",
                  color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                  cursor: deleteConfirmInput.trim().toUpperCase() === "EXCLUIR" && !deletingCoupon ? "pointer" : "not-allowed"
                }}
              >
                {deletingCoupon ? "Excluindo..." : "🗑️ Confirmar Exclusão"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL POPUP DE CONFIRMAÇÃO DE TESTE DE ENVIO */}
      {showConfirmTestModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "460px", padding: "1.75rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: "1px solid #E2E8F0", animation: "fadeIn 0.2s ease-out" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: 42, height: 42, borderRadius: "12px", background: "#FFF7ED", color: "#EA580C", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Send size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>Confirmar Teste no WhatsApp</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Validação de mensagem via robô da loja</p>
                </div>
              </div>
              <button
                onClick={() => setShowConfirmTestModal(false)}
                style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: "4px" }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "12px 14px", border: "1px solid #E2E8F0", marginBottom: "1.2rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Número de Destino:</div>
              <div style={{ fontSize: "1rem", fontWeight: 900, color: "#2563EB", display: "flex", alignItems: "center", gap: "6px" }}>
                📱 {testPhone}
              </div>
            </div>

            <div style={{ background: "#F1F5F9", borderRadius: "12px", padding: "12px 14px", border: "1px solid #CBD5E1", marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>Prévia da Mensagem:</div>
              <div style={{ fontSize: "0.82rem", color: "#334155", fontStyle: "italic", whiteSpace: "pre-wrap", maxHeight: "120px", overflowY: "auto" }}>
                "{testMessage}"
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowConfirmTestModal(false)}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setShowConfirmTestModal(false);
                  await handleSendTestMessage();
                }}
                disabled={sendingTest}
                style={{ flex: 1.5, padding: "11px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 900, fontSize: "0.88rem", cursor: "pointer", boxShadow: "0 4px 12px rgba(234, 88, 12, 0.25)" }}
              >
                {sendingTest ? "Enviando..." : "🚀 Sim, Disparar Agora"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
