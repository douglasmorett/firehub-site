"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, ShieldCheck, Zap, Key, Store, Save, ExternalLink, RefreshCw, X, ArrowRight, Activity, CreditCard, Radio, Plus, Trash2, Loader2 } from "lucide-react";

export default function IntegracoesHubClient({
  ifoodMerchantId,
  ifoodClientId,
  ifoodWidgetId,
  ifoodConnected: initialIfoodConnected,
  userEmail,
  facebookPixelId: initialFacebookPixelId,
  pagarmeRecipientId,
  mpConnected,
  brendiClientId,
  brendiMerchantId,
  brendiConnected: initialBrendiConnected,
  brendiHasSecret,
  initialIfoodIntegrations,
}: {
  ifoodMerchantId?: string;
  ifoodClientId?: string;
  ifoodWidgetId?: string;
  ifoodConnected?: boolean;
  userEmail: string;
  facebookPixelId?: string;
  pagarmeRecipientId?: string;
  mpConnected?: boolean;
  brendiClientId?: string;
  brendiMerchantId?: string;
  brendiConnected?: boolean;
  brendiHasSecret?: boolean;
  initialIfoodIntegrations?: {id:string;label:string;merchantId:string;connected:boolean;active:boolean;widgetId?:string|null;createdAt:string}[];
}) {
  const [activeTab, setActiveTab] = useState<"all" | "channels" | "marketing" | "payments">("all");
  const [openModal, setOpenModal] = useState<"pixel" | "whatsapp" | "jotaja" | "ifood" | "pagarme" | "99food" | "brendi" | null>(null);

  // Meta Pixel state
  const [pixelId, setPixelId] = useState(initialFacebookPixelId || "");
  const [pixelSaving, setPixelSaving] = useState(false);
  // Token da API de Conversões. Nunca volta do servidor preenchido — é segredo
  // de escrita no Gerenciador de Eventos da loja. Vazio significa "não mexer".
  const [capiToken, setCapiToken] = useState("");
  const [capiTestando, setCapiTestando] = useState(false);
  const [capiResultado, setCapiResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleTestarCapi = async () => {
    setCapiTestando(true);
    setCapiResultado(null);
    try {
      const res = await fetch("/api/meta-ads/testar-capi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixelId, token: capiToken }),
      });
      const d = await res.json();
      setCapiResultado(
        res.ok && d.ok
          ? { ok: true, msg: `Deu certo. O Meta recebeu o evento de teste. Abra o Gerenciador de Eventos → Testar eventos e use o código ${d.testEventCode} para vê-lo aparecer.` }
          : { ok: false, msg: d.erro || d.error || "Não consegui enviar. Confira o pixel e o token." }
      );
    } catch {
      setCapiResultado({ ok: false, msg: "Sem conexão com o servidor. Tente de novo." });
    } finally {
      setCapiTestando(false);
    }
  };

  // WhatsApp state
  const [waConnected, setWaConnected] = useState(false);
  const [waPhone, setWaPhone] = useState("");

  // JotaJá credentials state
  const [jjClientId, setJjClientId] = useState("");
  const [jjClientSecret, setJjClientSecret] = useState("");
  const [jjMerchantId, setJjMerchantId] = useState("");
  const [jjConnected, setJjConnected] = useState(false);
  const [jjHasSecret, setJjHasSecret] = useState(false);
  const [jjLoading, setJjLoading] = useState(true);
  const [jjSaving, setJjSaving] = useState(false);

  // Brendi credentials state — mesmo desenho do JotaJá (Open Delivery por
  // loja): o lojista cola credenciais geradas no painel da Brendi. As props do
  // servidor pintam a tela de primeira (vêm de SQL cru no page.tsx, porque as
  // colunas brendi* ainda não vivem no Prisma Client); o GET no mount apenas
  // re-confere — o secret nunca viaja em prop nem em resposta nenhuma.
  const [brClientId, setBrClientId] = useState(brendiClientId || "");
  const [brClientSecret, setBrClientSecret] = useState("");
  const [brMerchantId, setBrMerchantId] = useState(brendiMerchantId || "");
  const [brConnected, setBrConnected] = useState(!!initialBrendiConnected);
  const [brHasSecret, setBrHasSecret] = useState(!!brendiHasSecret);
  const [brSaving, setBrSaving] = useState(false);

  // 99Food state — autoatendimento: quem responde se está conectado é o 99Food,
  // não um formulário salvo. `food99Connected` vem de /api/99food/conectar.
  const [food99Connected, setFood99Connected] = useState(false);
  const [food99Loading, setFood99Loading] = useState(true);
  const [food99Saving, setFood99Saving] = useState(false);
  const [food99Disponivel, setFood99Disponivel] = useState(true);
  const [food99Msg, setFood99Msg] = useState("");
  /** Qual loja do 99Food está ligada — nome, id e endereço, vindos do shop/detail. */
  const [food99Loja, setFood99Loja] = useState<{ nome: string | null; shopId: string | null; endereco: string | null } | null>(null);
  /** TODAS as lojas do 99Food desta conta. Uma conta pode ter várias. */
  const [food99Lojas, setFood99Lojas] = useState<{ appShopId: string; shopId: string | null; label: string | null }[]>([]);
  /** Fica preenchido depois que o lojista abre a autorização — é o gatilho do "Já autorizei". */
  const [food99Aguardando, setFood99Aguardando] = useState(false);
  /** Só aparece quando há mais de uma loja autorizada e não dá para adivinhar qual é a dele. */
  const [food99Candidatos, setFood99Candidatos] = useState<
    { appShopId: string; nome: string; shopId: string | null }[]
  >([]);

  // iFood multi-integration state
  const [ifMerchant, setIfMerchant] = useState(ifoodMerchantId || "");
  const [ifWidget, setIfWidget] = useState(ifoodWidgetId || "");
  const [ifSaving, setIfSaving] = useState(false);
  const [ifoodIntegrations, setIfoodIntegrations] = useState<{id:string;label:string;merchantId:string;connected:boolean;active:boolean;widgetId?:string|null;createdAt:string}[]>(initialIfoodIntegrations || []);
  const [ifoodLoading, setIfoodLoading] = useState(!initialIfoodIntegrations || initialIfoodIntegrations.length === 0);
  const [newIfLabel, setNewIfLabel] = useState("");
  const [newIfMerchantId, setNewIfMerchantId] = useState("");
  const [newIfWidgetId, setNewIfWidgetId] = useState("");
  const [ifAdding, setIfAdding] = useState(false);
  const [userCodeData, setUserCodeData] = useState<{ userCode: string; verificationUrl?: string } | null>(null);
  const [loadingUserCode, setLoadingUserCode] = useState(false);
  const [showAddIfoodForm, setShowAddIfoodForm] = useState(false);
  const [authCodeInput, setAuthCodeInput] = useState("");
  const [connectingAuthCode, setConnectingAuthCode] = useState(false);

  // Toast alert
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  // Auto-descobrir merchantId quando conectado mas sem merchantId
  useEffect(() => {
    if (initialIfoodConnected && !ifMerchant && ifoodIntegrations.length === 0) {
      fetch("/api/ifood/auth?step=discover-merchant")
        .then(r => r.json())
        .then(data => {
          if (data.success && data.merchantId) {
            setIfMerchant(data.merchantId);
            showToast(`🔍 Loja iFood descoberta: ${data.storeName || data.merchantId}${data.importedOrders > 0 ? ` — ${data.importedOrders} pedido(s) importado(s)!` : ""}`, "#10B981");
            setTimeout(() => window.location.reload(), 1500);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Carregar dados da integração JotaJá
  useEffect(() => {
    fetch("/api/store/integracoes/jotaja")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setJjClientId(data.clientId || "");
          setJjClientSecret(""); // o secret nunca volta do servidor
          setJjHasSecret(!!data.hasSecret);
          setJjMerchantId(data.merchantId || "");
          setJjConnected(!!data.connected);
        }
      })
      .catch(() => {})
      .finally(() => setJjLoading(false));

    // Estado da Brendi re-conferido no servidor. As props já pintaram a tela;
    // esta chamada existe porque a rota garante as colunas no boot
    // (ensureBrendiColumns) e porque `hasSecret` de verdade mora no banco —
    // se a rota ainda não existir/responder, as props seguem valendo.
    fetch("/api/store/integracoes/brendi")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setBrClientId(data.clientId || "");
          setBrClientSecret(""); // o secret nunca volta do servidor
          setBrHasSecret(!!data.hasSecret);
          setBrMerchantId(data.merchantId || "");
          setBrConnected(!!data.connected);
        }
      })
      .catch(() => {});

    // Estado real da conexão 99Food — perguntado ao 99Food, não ao nosso banco.
    // A rota antiga (/api/store/integracoes/99food) devolvia `connected` do
    // formulário salvo, e era isso que pintava "🟢 Conectado & Ativo" numa loja
    // que nunca havia recebido um pedido.
    carregar99Food();

    fetch("/api/chatbot/config")
      .then(r => r.json())
      .then(d => {
        if (d.config) {
          setWaConnected(d.config.connected || false);
          setWaPhone(d.config.phone || "");
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveJotaja = async () => {
    setJjSaving(true);
    try {
      const res = await fetch("/api/store/integracoes/jotaja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: jjClientId,
          clientSecret: jjClientSecret,
          merchantId: jjMerchantId,
          connected: true,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        // "Conectado" agora reflete o teste real da credencial no JotaJá,
        // não o simples fato de o formulário ter sido salvo.
        setJjConnected(!!data.autenticou);
        setJjHasSecret(true);
        setJjClientSecret("");
        showToast(
          data.autenticou ? "✅ Integração JotaJá salva e ativada!" : `⚠️ ${data.message}`,
          data.autenticou ? "#10B981" : "#F59E0B"
        );
        if (data.autenticou) setOpenModal(null);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao salvar JotaJá"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar JotaJá", "#EF4444");
    } finally {
      setJjSaving(false);
    }
  };

  const handleSaveBrendi = async () => {
    setBrSaving(true);
    try {
      const res = await fetch("/api/store/integracoes/brendi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: brClientId,
          clientSecret: brClientSecret,
          merchantId: brMerchantId,
          connected: true,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        // Verde = a Brendi autenticou a credencial de verdade (oauth/token no
        // servidor), nunca o simples fato de o formulário ter sido salvo —
        // lição do 99Food, que pintava "Conectado" em loja que nunca recebeu
        // um pedido.
        setBrConnected(!!data.autenticou);
        setBrHasSecret(true);
        setBrClientSecret("");
        showToast(
          data.autenticou ? "✅ Integração Brendi salva e ativada!" : `⚠️ ${data.message}`,
          data.autenticou ? "#10B981" : "#F59E0B"
        );
        if (data.autenticou) setOpenModal(null);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao salvar Brendi"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar Brendi", "#EF4444");
    } finally {
      setBrSaving(false);
    }
  };

  /**
   * Pergunta ao 99Food se a loja está conectada.
   *
   * `conectado` aqui é o token que o 99Food emitiu para esta loja — se ele não
   * existe, a tela diz que não existe. É a diferença entre esta versão e a
   * anterior, que escrevia "conectado" só porque alguém salvara um formulário.
   */
  const carregar99Food = async () => {
    setFood99Loading(true);
    try {
      const res = await fetch("/api/99food/conectar");
      const data = await res.json();
      setFood99Connected(!!data.conectado);
      setFood99Disponivel(data.disponivel !== false);
      setFood99Msg(data.mensagem || "");
      setFood99Loja(data.lojaNo99 || null);
      setFood99Lojas(data.lojas || []);
      setFood99Candidatos(data.candidatos || []);
      if (data.conectado) {
        setFood99Aguardando(false);
        setFood99Candidatos([]);
      }
    } catch {
      setFood99Msg("Não consegui falar com o servidor para checar o 99Food.");
    } finally {
      setFood99Loading(false);
    }
  };

  /** Só usado no caso raro de haver mais de uma loja autorizada sem dono. */
  const handleEscolher99Food = async (appShopId: string) => {
    setFood99Saving(true);
    try {
      const res = await fetch("/api/99food/conectar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appShopId }),
      });
      const data = await res.json();
      if (res.ok && data.conectado) {
        setFood99Connected(true);
        setFood99Candidatos([]);
        setFood99Aguardando(false);
        showToast("✅ " + data.mensagem, "#10B981");
      } else {
        showToast(`⚠️ ${data.error || "Não consegui conectar essa loja"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  /**
   * Abre a autorização do 99Food na conta do próprio lojista.
   *
   * A janela é aberta ANTES do await de propósito: navegador bloqueia
   * window.open que não nasce direto de um clique, e depois de um fetch o
   * gesto já se perdeu. Então abre-se em branco no clique e troca-se a URL
   * quando ela chega.
   */
  const handleConectar99Food = async () => {
    setFood99Saving(true);
    const janela = window.open("", "_blank");
    try {
      const res = await fetch("/api/99food/conectar", { method: "POST" });
      const data = await res.json();

      if (res.ok && data.url) {
        if (janela) janela.location.href = data.url;
        else window.location.href = data.url; // popup bloqueado: vai na mesma aba
        setFood99Aguardando(true);
        showToast("🔗 Autorize na aba que abriu — esta tela conecta sozinha", "#F59E0B");
      } else {
        janela?.close();
        showToast(`⚠️ ${data.error || "O 99Food não devolveu a página de autorização"}`, "#EF4444");
      }
    } catch {
      janela?.close();
      showToast("⚠️ Erro de conexão ao falar com o 99Food", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  /**
   * Conectar em UM clique: a tela confere sozinha enquanto o lojista autoriza.
   *
   * ── Por que não dá para fazer igual ao iFood ──────────────────────────────
   *
   * O iFood fecha o ciclo sozinho porque a autorização dele aceita
   * `redirect_uri` e volta em /api/ifood/auth/callback. O 99Food não tem isso:
   * o `/v1/auth/authorizationpage/getUrl` aceita SÓ `app_id` e `app_shop_id`
   * (conferido no swagger), e a página deles não devolve nada para cá.
   *
   * Sem callback, o que sobrava era pedir o segundo clique — "Já autorizei" —
   * e o lojista que fechasse a aba antes disso ficava desconectado sem saber
   * por quê. Então quem pergunta passa a ser a tela, não a pessoa.
   *
   * ── A cadência tem dois ritmos, e não é detalhe ───────────────────────────
   *
   * `GET /conectar` só consulta o token da loja: é barato e sem limite.
   * `?procurar=1` cai no `shop/list`, que aceita UMA chamada a cada 20s PARA O
   * APP INTEIRO — com duas lojas conectando ao mesmo tempo, insistir nele faria
   * as duas verem erro de excesso. Por isso o caro entra de 25 em 25s e o
   * barato cobre o resto.
   */
  useEffect(() => {
    if (!food99Aguardando || food99Connected || openModal !== "99food") return;

    let cancelado = false;
    let tentativas = 0;
    const LIMITE = 48; // ~4 minutos a cada 5s

    const conferir = async () => {
      if (cancelado) return;
      tentativas++;
      const procurar = tentativas % 5 === 0;
      try {
        const res = await fetch(`/api/99food/conectar${procurar ? "?procurar=1" : ""}`);
        const data = await res.json();
        if (cancelado) return;

        if (data.conectado) {
          setFood99Connected(true);
          setFood99Aguardando(false);
          setFood99Candidatos([]);
          setFood99Msg(data.mensagem || "");
          setFood99Loja(data.lojaNo99 || null);
          setFood99Lojas(data.lojas || []);
          showToast("✅ 99Food conectado! Os pedidos chegam automaticamente.", "#10B981");
          return;
        }

        // Mais de uma loja autorizada sem dono aqui dentro: só o lojista sabe
        // qual é a dele. Para o laço, senão a pergunta ficaria piscando embaixo
        // de quem está tentando responder.
        if (Array.isArray(data.candidatos) && data.candidatos.length > 0) {
          setFood99Candidatos(data.candidatos);
          setFood99Msg(data.mensagem || "");
          setFood99Loja(data.lojaNo99 || null);
          setFood99Lojas(data.lojas || []);
          setFood99Aguardando(false);
          return;
        }
      } catch {
        // Rede oscilou. O próximo tick tenta de novo — desistir na primeira
        // falha devolveria o lojista ao clique manual sem necessidade.
      }

      if (!cancelado && tentativas >= LIMITE) {
        setFood99Aguardando(false);
        setFood99Msg(
          "Não detectei a autorização. Se você já autorizou no 99Food, clique em Verificar agora."
        );
      }
    };

    const id = setInterval(conferir, 5000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [food99Aguardando, food99Connected, openModal]);

  /**
   * Desliga UMA loja do 99Food, sem tocar nas outras da conta.
   *
   * Diferente do "Desconectar", que desfaz o vínculo no 99Food e derruba a
   * conta inteira: aqui sai só a filial escolhida. Por isso a confirmação
   * nomeia a loja — desligar a errada só se descobre quando os pedidos dela
   * param de chegar.
   */
  const handleDesligarLoja99 = async (appShopId: string, nome: string) => {
    if (!confirm(`Desligar "${nome}" do FireHub?\n\nOs pedidos dela param de chegar. As outras lojas continuam funcionando.`)) return;
    setFood99Saving(true);
    try {
      const res = await fetch(`/api/99food/conectar?appShopId=${encodeURIComponent(appShopId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast(`✅ "${data.desligada}" desligada`, "#10B981");
        await carregar99Food();
      } else {
        showToast(`⚠️ ${data.error || "Não consegui desligar"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  /** Conferência manual — a automática acima cobre o caso normal. */
  const handleVerificar99Food = async () => {
    setFood99Saving(true);
    try {
      // `procurar=1` autoriza o servidor a consultar a lista de lojas do
      // 99Food, que só aceita uma chamada a cada 20s. Fica reservado para este
      // botão — abrir a tela não pode gastar a janela.
      const res = await fetch("/api/99food/conectar?procurar=1");
      const data = await res.json();
      setFood99Connected(!!data.conectado);
      setFood99Msg(data.mensagem || "");
      setFood99Loja(data.lojaNo99 || null);
      setFood99Lojas(data.lojas || []);
      setFood99Candidatos(data.candidatos || []);
      showToast(
        data.conectado ? "✅ 99Food conectado! Os pedidos chegam automaticamente." : `⏳ ${data.mensagem}`,
        data.conectado ? "#10B981" : "#F59E0B"
      );
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  const handleDisconnect99Food = async () => {
    // A confirmação nomeia a loja: é a última chance de perceber que se está
    // desligando a errada, e a partir daqui os pedidos dela param de chegar.
    const alvo = food99Loja?.nome ? `"${food99Loja.nome}"` : "esta loja";
    if (!confirm(`Desconectar ${alvo} do 99Food?\n\nOs pedidos dela param de chegar no FireHub até você conectar de novo.`)) return;
    setFood99Saving(true);
    try {
      const res = await fetch("/api/99food/auth?step=disconnect");
      if (res.ok) {
        setFood99Connected(false);
        setFood99Aguardando(false);
        showToast("✅ 99Food desconectado com sucesso", "#10B981");
        setOpenModal(null);
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  const handleSaveIfood = async () => {
    setIfSaving(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifoodMerchantId: ifMerchant,
          ifoodWidgetId: ifWidget
        })
      });
      if (res.ok) {
        showToast("✅ Configurações do iFood salvas!", "#10B981");
        setOpenModal(null);
      } else {
        showToast("⚠️ Erro ao salvar configurações iFood", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setIfSaving(false);
    }
  };

  // Carregar integrações iFood
  useEffect(() => {
    fetch("/api/ifood/integration/list")
      .then(r => r.json())
      .then(d => { if (d.integrations) setIfoodIntegrations(d.integrations); })
      .catch(() => {})
      .finally(() => setIfoodLoading(false));
  }, []);

  const handleConnectIfoodOAuth = () => {
    const clientId = "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a";
    const redirectUri = encodeURIComponent("https://firehubfood.com.br/api/ifood/auth/callback");
    const authUrl = `https://developer.ifood.com.br/oauth/userAuthorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}`;
    window.open(authUrl, "_blank");
  };

  const handleGenerateUserCode = async () => {
    setLoadingUserCode(true);
    try {
      const res = await fetch("/api/ifood/auth/code", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.userCode) {
        const targetUrl = data.verificationUrl || `https://portal.ifood.com.br/apps/code?c=${data.userCode}`;
        setUserCodeData({ userCode: data.userCode, verificationUrl: targetUrl });
        try { navigator.clipboard.writeText(data.userCode); } catch {}
        showToast("📋 Código copiado! Redirecionando para o iFood...", "#10B981");
        window.open(targetUrl, "_blank");
      } else {
        showToast(data.error || "Erro ao gerar código iFood", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setLoadingUserCode(false);
    }
  };

  const [needsMerchantId, setNeedsMerchantId] = useState(false);
  const [merchantIdInput, setMerchantIdInput] = useState("");

  const handleLinkAuthorizationCode = async () => {
    if (!authCodeInput.trim()) {
      showToast("⚠️ Digite o código de autorização gerado no iFood", "#EF4444");
      return;
    }
    setConnectingAuthCode(true);
    try {
      const res = await fetch("/api/ifood/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: authCodeInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("🎉 Loja iFood vinculada com sucesso!", "#10B981");
        const linkedMerchantId = data.merchantId || authCodeInput.trim();
        setIfMerchant(linkedMerchantId);
        setIfoodIntegrations(prev => [
          { id: "main", label: "Loja Principal", merchantId: linkedMerchantId, connected: true, active: true, createdAt: new Date().toISOString() },
          ...prev.filter(i => i.merchantId !== linkedMerchantId)
        ]);
        setOpenModal(null);
        setTimeout(() => { window.location.reload(); }, 600);
      } else if (data.hasToken) {
        // Token obtido mas merchantId não detectado — pedir UUID manualmente
        setNeedsMerchantId(true);
        showToast("✅ Autorização OK! Agora cole o Merchant ID da sua loja.", "#F59E0B");
      } else {
        showToast(data.error || "Código de autorização inválido ou expirado", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setConnectingAuthCode(false);
    }
  };

  const handleSubmitMerchantId = async () => {
    const uuid = merchantIdInput.trim();
    if (!uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      showToast("⚠️ Cole o Merchant ID no formato UUID (ex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)", "#EF4444");
      return;
    }
    setConnectingAuthCode(true);
    try {
      const res = await fetch("/api/ifood/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: uuid }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("🎉 Loja iFood vinculada com sucesso!", "#10B981");
        setIfMerchant(uuid);
        setIfoodIntegrations(prev => [
          { id: "main", label: "Loja Principal", merchantId: uuid, connected: true, active: true, createdAt: new Date().toISOString() },
          ...prev.filter(i => i.merchantId !== uuid)
        ]);
        setNeedsMerchantId(false);
        setOpenModal(null);
        setTimeout(() => { window.location.reload(); }, 600);
      } else {
        showToast(data.error || "Erro ao vincular Merchant ID", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setConnectingAuthCode(false);
    }
  };

  const handleAddIfoodIntegration = async () => {
    if (!newIfLabel.trim() || !newIfMerchantId.trim()) {
      showToast("⚠️ Nome e Merchant ID são obrigatórios", "#EF4444");
      return;
    }
    setIfAdding(true);
    try {
      const res = await fetch("/api/ifood/integration/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newIfLabel, merchantId: newIfMerchantId, widgetId: newIfWidgetId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.billingNotice || "✅ Integração iFood adicionada!", "#10B981");
        setIfoodIntegrations(prev => [...prev, data.integration]);
        setNewIfLabel(""); setNewIfMerchantId(""); setNewIfWidgetId("");
        setShowAddIfoodForm(false);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao adicionar"}`, "#EF4444");
      }
    } catch { showToast("⚠️ Erro de conexão", "#EF4444"); }
    finally { setIfAdding(false); }
  };

  const handleRemoveIfoodIntegration = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover esta integração iFood?")) return;
    try {
      const res = await fetch(`/api/ifood/integration/delete?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setIfoodIntegrations(prev => prev.filter(i => i.id !== id));
        showToast("✅ Integração removida", "#10B981");
      } else {
        showToast("⚠️ Erro ao remover", "#EF4444");
      }
    } catch { showToast("⚠️ Erro de conexão", "#EF4444"); }
  };

  const handleSavePixel = async () => {
    setPixelSaving(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facebookPixelId: pixelId,
          metaPixelId: pixelId,
          // Só envia quando o lojista digitou algo. Campo vazio significa
          // "não mexer" — o token nunca volta preenchido do servidor, então
          // mandar vazio apagaria um token já configurado.
          ...(capiToken ? { metaCapiToken: capiToken } : {}),
        })
      });
      if (res.ok) {
        showToast("✅ Pixel do Meta configurado com sucesso!", "#10B981");
        setOpenModal(null);
      } else {
        showToast("⚠️ Erro ao salvar Pixel do Meta", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar Pixel", "#EF4444");
    } finally {
      setPixelSaving(false);
    }
  };

  // Modern Integration Card Data
  const INTEGRATIONS = [
    {
      id: "pixel" as const,
      category: "marketing",
      title: "Meta Pixel & Conversões",
      subtitle: "Facebook / Instagram Ads",
      icon: "🎯",
      gradient: "linear-gradient(135deg, #1877F2, #0052CC)",
      badge: pixelId ? { text: `🟢 Pixel Ativo (${pixelId})`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Configurado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Rastreie PageView, Adicionar ao Carrinho e Vendas no seu cardápio via Pixel do Meta.",
    },
    {
      id: "whatsapp" as const,
      category: "marketing",
      title: "WhatsApp IA & Notificações",
      subtitle: "Robô Atendente 24/7 & Avisos",
      icon: "💬",
      gradient: "linear-gradient(135deg, #10B981, #059669)",
      badge: waConnected ? { text: `🟢 Conectado (${waPhone || "Ativo"})`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚡ Pendente QR Code", bg: "#FEF3C7", color: "#B45309", border: "#FDE68A" },
      description: "Robô inteligente com Gemini IA, envia avisos de entrega e aceita pedidos automaticamente.",
    },
    {
      id: "jotaja" as const,
      category: "channels",
      title: "JotaJá (Open Delivery)",
      subtitle: "API Oficial OpenDelivery",
      icon: "🛵",
      gradient: "linear-gradient(135deg, #2563EB, #1D4ED8)",
      badge: jjConnected ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Sincronização de pedidos e cardápio direto do seu painel JotaJá para o FireHub.",
    },
    {
      id: "ifood" as const,
      category: "channels",
      title: "iFood Merchant API",
      subtitle: "Loja Oficial iFood",
      icon: "🔴",
      gradient: "linear-gradient(135deg, #EA580C, #C2410C)",
      badge: (ifoodIntegrations.length > 0 || ifMerchant || initialIfoodConnected) ? { text: `🟢 ${ifoodIntegrations.length || 1} Integração(ões)`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Gerencie suas integrações iFood. Conecte múltiplas lojas e acompanhe o status.",
    },
    {
      id: "pagarme" as const,
      category: "payments",
      title: "Mercado Pago / Mercado Livre",
      subtitle: "PIX Instantâneo & Cartão Online",
      icon: "💙",
      gradient: "linear-gradient(135deg, #009EE3, #0072B1)",
      badge: mpConnected || pagarmeRecipientId ? { text: "🟢 Mercado Pago Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "🟢 PIX / Cartão Ativos", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" },
      description: "Processamento seguro de PIX instantâneo e Cartão de Crédito via Mercado Pago / Mercado Livre com repasse para sua conta.",
    },
    {
      id: "99food" as const,
      category: "channels",
      title: "99Food Delivery",
      subtitle: "Integração Open Delivery",
      icon: "🟡",
      gradient: "linear-gradient(135deg, #F59E0B, #D97706)",
      badge: food99Connected ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Integração direta com o 99Food para captura e gerenciamento automático de pedidos.",
    },
    {
      id: "brendi" as const,
      category: "channels",
      title: "Brendi",
      subtitle: "Cardápio digital + IA no WhatsApp",
      icon: "🤖",
      gradient: "linear-gradient(135deg, #8B5CF6, #6D28D9)",
      badge: brConnected ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Pedidos do cardápio e da IA da Brendi caem direto no FireHub via Open Delivery, com status sincronizado.",
    },
  ];

  const filteredIntegrations = INTEGRATIONS.filter(item => {
    if (activeTab === "all") return true;
    return item.category === activeTab;
  });

  return (
    <div style={{ maxWidth: "1150px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Toast alert */}
      {toast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.2)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.msg}
        </div>
      )}

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0F172A, #1E293B)", borderRadius: "24px", padding: "32px", color: "#fff", marginBottom: "28px", boxShadow: "0 12px 32px rgba(15,23,42,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#38BDF8", marginBottom: "12px" }}>
              🔌 Central de Integrações
            </div>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 900, margin: "0 0 8px 0" }}>
              Conecte Seus Canais & Ferramentas
            </h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.9rem", maxWidth: "650px", lineHeight: 1.5 }}>
              Clique na integração desejada para configurar credenciais, sincronizar pedidos e ativar rastreamento de tráfego.
            </p>
          </div>

          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "12px 18px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <ShieldCheck size={26} color="#10B981" />
            <div>
              <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>Conta Registrada</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#38BDF8" }}>{userEmail}</div>
            </div>
          </div>
        </div>

        {/* Tab Filters */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("all")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "all" ? "#38BDF8" : "rgba(255,255,255,0.08)", color: activeTab === "all" ? "#0F172A" : "#fff", transition: "all 0.2s" }}
          >
            Todas as Integrações ({INTEGRATIONS.length})
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "channels" ? "#3B82F6" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            🛵 Canais de Venda & Delivery
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "marketing" ? "#10B981" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            🎯 Marketing & Tráfego
          </button>
          <button
            onClick={() => setActiveTab("payments")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "payments" ? "#8B5CF6" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            💳 Pagamentos & PIX
          </button>
        </div>
      </div>

      {/* Grid of Compact Integration Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
        {filteredIntegrations.map((item) => (
          <div
            key={item.id}
            onClick={() => setOpenModal(item.id)}
            style={{
              background: "#fff",
              borderRadius: "20px",
              border: "1.5px solid #E2E8F0",
              padding: "20px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.03)",
              cursor: "pointer",
              transition: "all 0.2s ease-in-out",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.borderColor = "#94A3B8";
              e.currentTarget.style.boxShadow = "0 12px 28px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = "#E2E8F0";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.03)";
            }}
          >
            {/* Top row: Logo + Status Badge */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: item.gradient, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.6rem", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
                  {item.icon}
                </div>

                <span style={{ background: item.badge.bg, border: `1px solid ${item.badge.border}`, color: item.badge.color, padding: "4px 10px", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
                  {item.badge.text}
                </span>
              </div>

              {/* Title & Subtitle */}
              <h3 style={{ margin: "0 0 4px 0", fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>
                {item.title}
              </h3>
              <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#64748B", marginBottom: "10px" }}>
                {item.subtitle}
              </div>

              {/* Description */}
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {item.description}
              </p>
            </div>

            {/* Action Footer */}
            <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.74rem", color: "#94A3B8", fontWeight: 600 }}>Clique para configurar</span>
              <button
                type="button"
                style={{ background: "#F1F5F9", color: "#0F172A", border: "none", padding: "6px 12px", borderRadius: "10px", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
              >
                Configurar <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ================= MODAL DE CONFIGURAÇÃO DEDICADA ================= */}
      {openModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "24px", width: "100%", maxWidth: "560px", padding: "28px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", position: "relative", animation: "modalIn 0.2s ease-out" }}>
            
            {/* Close Button */}
            <button
              onClick={() => setOpenModal(null)}
              style={{ position: "absolute", top: "20px", right: "20px", background: "#F1F5F9", border: "none", borderRadius: "50%", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#475569" }}
            >
              <X size={18} />
            </button>

            {/* 🎯 MODAL: META PIXEL */}
            {openModal === "pixel" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #1877F2, #0052CC)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🎯
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Pixel do Meta (Facebook/Instagram)</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Rastreie conversões de tráfego pago no seu cardápio</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Insira o ID do seu Pixel do Meta abaixo. Nosso sistema injetará automaticamente o Pixel no seu cardápio digital para registrar eventos de <strong>PageView</strong>, <strong>AddToCart</strong> (Adicionar ao Carrinho), <strong>InitiateCheckout</strong> e <strong>Purchase</strong> (Venda Concluída).
                </p>

                <div style={{ background: "#F8FAFC", borderRadius: "14px", padding: "16px", border: "1px solid #E2E8F0", marginBottom: "20px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 800, color: "#1E293B", display: "block", marginBottom: "6px" }}>
                    ID do Pixel do Meta (somente números):
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 123456789012345"
                    value={pixelId}
                    onChange={(e) => setPixelId(e.target.value.replace(/\D/g, ""))}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontFamily: "monospace", outline: "none" }}
                  />
                  <span style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "6px", display: "block" }}>
                    Você encontra este ID no Gerenciador de Negócios da Meta em <em>Gerenciador de Eventos &rarr; Fontes de Dados</em>.
                  </span>
                </div>

                {/* ── API DE CONVERSÕES ────────────────────────────────────
                    O pixel do navegador perde de 30% a 50% dos eventos para
                    bloqueador de anúncio, iOS e Safari. O que se perde não é
                    relatório — é o SINAL que o Meta usa para decidir a quem
                    mostrar o anúncio. Explicado aqui, onde a dúvida aparece. */}
                <div style={{ background: "#F8FAFC", borderRadius: "14px", padding: "16px", border: "1px solid #E2E8F0", marginBottom: "20px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 800, color: "#1E293B", display: "block", marginBottom: "6px" }}>
                    Token da API de Conversões <span style={{ fontWeight: 600, color: "#64748B" }}>— opcional, mas muda muito</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Cole aqui o token gerado no Meta"
                    value={capiToken}
                    onChange={(e) => setCapiToken(e.target.value.trim())}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontFamily: "monospace", outline: "none" }}
                  />
                  <span style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "8px", display: "block", lineHeight: 1.5 }}>
                    Com ele, a venda é enviada ao Meta <strong>pelo nosso servidor</strong>, e não só pelo navegador do
                    cliente. Entre 30% e 50% das vendas não chegam pelo navegador (bloqueador de anúncio, iPhone,
                    Safari) — e o que não chega o Meta não usa para achar mais clientes parecidos.
                    <br /><br />
                    Onde pegar: <em>Gerenciador de Eventos &rarr; sua fonte de dados &rarr; Configurações &rarr;
                    API de Conversões &rarr; Gerar token de acesso</em>.
                  </span>

                  {pixelId && capiToken && (
                    <button
                      onClick={handleTestarCapi}
                      disabled={capiTestando}
                      style={{ marginTop: "12px", padding: "10px 16px", borderRadius: "10px", border: "1.5px solid #1877F2", background: "#fff", color: "#1877F2", fontWeight: 800, fontSize: "0.82rem", cursor: capiTestando ? "default" : "pointer", opacity: capiTestando ? 0.6 : 1 }}
                    >
                      {capiTestando ? "Enviando..." : "Enviar evento de teste"}
                    </button>
                  )}

                  {capiResultado && (
                    <div style={{
                      marginTop: "12px", padding: "12px 14px", borderRadius: "10px", fontSize: "0.8rem", lineHeight: 1.5,
                      background: capiResultado.ok ? "#ECFDF3" : "#FEF2F2",
                      border: `1px solid ${capiResultado.ok ? "#ABEFC6" : "#FECACA"}`,
                      color: capiResultado.ok ? "#15803D" : "#B71C1C",
                      fontWeight: 700,
                    }}>
                      {capiResultado.msg}
                    </div>
                  )}
                </div>

                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "12px", padding: "12px", fontSize: "0.78rem", color: "#1E40AF", marginBottom: "24px" }}>
                  <strong>💡 Eventos Rastreados Automáticos:</strong>
                  <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px" }}>
                    <li><code>PageView</code>: Sempre que alguém abre seu cardápio</li>
                    <li><code>AddToCart</code>: Quando o cliente escolhe um produto</li>
                    <li><code>InitiateCheckout</code>: Quando começa a finalizar</li>
                    <li><code>Purchase</code>: Quando o pedido é fechado — com o valor da venda</li>
                  </ul>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSavePixel}
                    disabled={pixelSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #1877F2, #0052CC)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(24,119,242,0.3)", opacity: pixelSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {pixelSaving ? "Salvando..." : "Salvar Pixel do Meta"}
                  </button>
                </div>
              </div>
            )}

            {/* 💬 MODAL: WHATSAPP IA */}
            {openModal === "whatsapp" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    💬
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>WhatsApp IA & Notificações</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Conexão 1-Clique e Atendimento Automático</span>
                  </div>
                </div>

                <div style={{ background: waConnected ? "#F0FDF4" : "#FEF3C7", border: `1px solid ${waConnected ? "#BBF7D0" : "#FDE68A"}`, padding: "14px", borderRadius: "14px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8, color: waConnected ? "#15803D" : "#B45309" }}>Status da Conexão:</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: waConnected ? "#15803D" : "#B45309" }}>
                      {waConnected ? `🟢 Conectado (${waPhone || "Ativo"})` : "⚡ Aguardando QR Code"}
                    </div>
                  </div>
                  <a
                    href="/store/chatbot"
                    style={{ padding: "8px 14px", background: "#10B981", color: "#fff", textDecoration: "none", borderRadius: "10px", fontWeight: 800, fontSize: "0.8rem" }}
                  >
                    Abrir QR Code / Robô &rarr;
                  </a>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  O módulo de WhatsApp sincroniza diretamente com a inteligência artificial do Gemini para responder aos clientes, informar taxa de entrega por bairro, confirmar pedidos do Jotajá/iFood e enviar notificações automáticas de status.
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                  <a
                    href="/store/chatbot"
                    style={{ padding: "10px 20px", borderRadius: "10px", background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", textDecoration: "none", display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    Configurar Robô no Chatbot &rarr;
                  </a>
                </div>
              </div>
            )}

            {/* 🛵 MODAL: JOTAJA */}
            {openModal === "jotaja" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🛵
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>JotaJá (Open Delivery)</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração oficial via API OpenDelivery</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Insira abaixo as credenciais fornecidas no seu painel JotaJá (em <strong>Configurações &rarr; Integrações / API OpenDelivery</strong>) para receber pedidos automaticamente no FireHub.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Key size={14} color="#2563EB" /> Client ID (JotaJá)
                    </label>
                    <input
                      type="text"
                      placeholder="Cole aqui o Client ID que o JotaJá forneceu"
                      value={jjClientId}
                      onChange={e => setJjClientId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <ShieldCheck size={14} color="#2563EB" /> Client Secret (JotaJá)
                    </label>
                    <input
                      type="password"
                      placeholder={jjHasSecret ? "•••••••• já configurado — deixe em branco para manter" : "Cole aqui o Client Secret do JotaJá"}
                      value={jjClientSecret}
                      onChange={e => setJjClientSecret(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                    {jjHasSecret && (
                      <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0" }}>
                        Campo em branco mantém o segredo atual — ele nunca é devolvido para o navegador.
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Store size={14} color="#2563EB" /> Store ID / Merchant ID (Código da Loja)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 22238"
                      value={jjMerchantId}
                      onChange={e => setJjMerchantId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveJotaja}
                    disabled={jjSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(37,99,235,0.3)", opacity: jjSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {jjSaving ? "Salvando..." : "Salvar e Ativar JotaJá"}
                  </button>
                </div>
              </div>
            )}

            {/* 🔴 MODAL: IFOOD */}
            {openModal === "ifood" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #EA580C, #C2410C)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🔴
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Integrações iFood</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Gerencie suas lojas iFood conectadas</span>
                  </div>
                </div>

                {/* Lista de integrações existentes */}
                {ifoodLoading ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#64748B" }}>
                    <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} /> Carregando...
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                    {ifoodIntegrations.length === 0 && !ifMerchant && !initialIfoodConnected && (
                      <div style={{ padding: "1.5rem", textAlign: "center", background: "#F8FAFC", borderRadius: 12, color: "#64748B", fontSize: "0.85rem" }}>
                        Nenhuma integração iFood cadastrada ainda.
                      </div>
                    )}

                    {/* Integração conectada (do banco User.ifoodConnected / ifoodMerchantId) */}
                    {(ifMerchant || initialIfoodConnected) && (
                      <div style={{
                        padding: "14px 16px", borderRadius: 14, border: "1.5px solid #BBF7D0",
                        background: "#F0FDF4", display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CheckCircle2 size={18} color="#16A34A" />
                        </div>
                        <div style={{ flex: 1 }}>
                          {/* Mostra o NOME da loja no iFood em vez de um rótulo
                              genérico. O nome vem da IfoodIntegration.label, que
                              recebe o merchantName na hora da conexão. Só cai no
                              texto genérico quando a label ainda é um
                              placeholder ("Loja Principal") ou não existe. */}
                          {(() => {
                            const rotulo = (ifoodIntegrations?.[0] as any)?.label?.trim();
                            const generico = !rotulo || /^loja principal$/i.test(rotulo) || /^loja ifood/i.test(rotulo);
                            const titulo = generico
                              ? (ifMerchant ? "Integração Principal" : "Loja iFood Conectada")
                              : rotulo;
                            return (
                              <>
                                <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>
                                  {titulo}
                                </div>
                                <div style={{ fontSize: "0.72rem", color: "#64748B", fontFamily: "monospace" }}>
                                  {ifMerchant || userEmail}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <span style={{ fontSize: "0.7rem", background: "#DCFCE7", color: "#15803D", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>🟢 Ativa</span>
                        <button
                          onClick={async () => {
                            if (!confirm("Deseja desconectar a integração iFood desta loja?")) return;
                            try {
                              const r = await fetch("/api/ifood/auth?step=disconnect");
                              if (r.ok) {
                                showToast("🔌 iFood desconectado com sucesso", "#F59E0B");
                                setTimeout(() => window.location.reload(), 500);
                              }
                            } catch { showToast("Erro ao desconectar", "#EF4444"); }
                          }}
                          style={{ background: "none", border: "1px solid #FCA5A5", cursor: "pointer", padding: "4px 8px", borderRadius: 8, color: "#EF4444", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}
                          title="Desconectar iFood"
                        >
                          <X size={14} /> Desconectar
                        </button>
                      </div>
                    )}

                    {/* Integrações adicionais (do modelo multi-loja IfoodIntegration) */}
                    {ifoodIntegrations.filter(i => i.merchantId !== ifMerchant).map((integ, idx) => (
                      <div key={integ.id} style={{
                        padding: "14px 16px", borderRadius: 14,
                        border: integ.active ? "1.5px solid #BBF7D0" : "1.5px solid #E2E8F0",
                        background: integ.active ? "#F0FDF4" : "#F8FAFC",
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: integ.active ? "#DCFCE7" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {integ.active ? <CheckCircle2 size={18} color="#16A34A" /> : <X size={18} color="#94A3B8" />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>{integ.label || `Loja iFood (${integ.merchantId.slice(0, 6)})`}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B", fontFamily: "monospace" }}>{integ.merchantId}</div>
                        </div>
                        <span style={{
                          fontSize: "0.7rem", padding: "3px 8px", borderRadius: 6, fontWeight: 700,
                          background: "#FEF3C7", color: "#92400E",
                        }}>
                          💰 +R$50/mês
                        </span>
                        <button
                          onClick={() => handleRemoveIfoodIntegration(integ.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#EF4444" }}
                          title="Remover integração"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulário para adicionar nova integração */}
                {showAddIfoodForm ? (
                  <div style={{ padding: "16px", borderRadius: 14, border: "1.5px dashed #CBD5E1", background: "#F8FAFC", marginBottom: "16px" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#334155", marginBottom: 12 }}>Nova Integração iFood</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Nome da Loja iFood *</label>
                        <input
                          type="text" placeholder="Ex: Hakim Praia, Loja Shopping..."
                          value={newIfLabel} onChange={e => setNewIfLabel(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "inherit", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Merchant ID (iFood) *</label>
                        <input
                          type="text" placeholder="Ex: 6a5fb96d-68bd-46af-ada4-456a9a160787"
                          value={newIfMerchantId} onChange={e => setNewIfMerchantId(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Widget ID (Chat) — opcional</label>
                        <input
                          type="text" placeholder="Cole o ID do widget..."
                          value={newIfWidgetId} onChange={e => setNewIfWidgetId(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                        />
                      </div>
                    </div>

                    {/* Aviso de cobrança */}
                    {(ifoodIntegrations.length > 0 || ifMerchant) && (
                      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "#FFF7ED", border: "1px solid #FDBA74", fontSize: "0.78rem", color: "#92400E" }}>
                        💰 <strong>+R$50,00/mês</strong> — Cada integração iFood adicional é cobrada R$50,00 por mês na sua fatura.
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => setShowAddIfoodForm(false)}
                        style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
                      >Cancelar</button>
                      <button
                        onClick={handleAddIfoodIntegration} disabled={ifAdding}
                        style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", opacity: ifAdding ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}
                      >
                        {ifAdding ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Adicionando...</> : <><Plus size={14} /> Adicionar</>}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Botão Principal de Conexão com 1-Clique */
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                    <button
                      onClick={handleGenerateUserCode}
                      disabled={loadingUserCode}
                      style={{
                        width: "100%", padding: "14px", borderRadius: 14,
                        border: "none", background: "linear-gradient(135deg, #EA580C 0%, #C2410C 100%)",
                        color: "#fff", fontWeight: 800, fontSize: "0.9rem",
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: "0 4px 14px rgba(234, 88, 12, 0.35)",
                        opacity: loadingUserCode ? 0.7 : 1,
                      }}
                    >
                      {loadingUserCode ? (
                        <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Abrindo iFood...</>
                      ) : (
                        <><Zap size={18} /> 1. Conectar e Autorizar no Portal iFood &rarr;</>
                      )}
                    </button>
                  </div>
                )}

                {/* Campo para colar o Código de Autorização ou Merchant UUID */}
                <div style={{ padding: "16px", borderRadius: 14, background: "#F0FDF4", border: "1.5px solid #86EFAC", marginBottom: "16px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#166534", marginBottom: 4 }}>
                    🔑 2. Cole o Código de Autorização OU Merchant ID do iFood:
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#15803D", marginBottom: 10 }}>
                    Cole o código gerado na janela <strong>"Aplicativo Autorizado"</strong> ou o <strong>Merchant UUID</strong> da sua loja no iFood (ex: <code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>).
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Ex: TMFG-KNLN ou ID da Loja (UUID)"
                      value={authCodeInput}
                      onChange={e => setAuthCodeInput(e.target.value.trim())}
                      style={{
                        flex: 1, padding: "10px 14px", borderRadius: 10,
                        border: "1.5px solid #86EFAC", fontSize: "0.88rem",
                        fontWeight: 700, fontFamily: "monospace",
                        outline: "none"
                      }}
                    />
                    <button
                      onClick={handleLinkAuthorizationCode}
                      disabled={connectingAuthCode}
                      style={{
                        padding: "10px 18px", borderRadius: 10, border: "none",
                        background: "linear-gradient(135deg, #16A34A, #15803D)",
                        color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 6,
                        opacity: connectingAuthCode ? 0.7 : 1,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {connectingAuthCode ? (
                        <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Vinculando...</>
                      ) : (
                        <><CheckCircle2 size={16} /> Concluir Vinculação</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Passo 3: Merchant ID manual (aparece quando auth OK mas merchantId não detectado) */}
                {needsMerchantId && (
                  <div style={{ padding: "16px", borderRadius: 14, background: "#FFFBEB", border: "2px solid #F59E0B", marginBottom: "16px", animation: "fadeIn 0.3s ease-in" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#92400E", marginBottom: 4 }}>
                      🆔 3. Cole o Merchant ID (UUID) da sua loja no iFood:
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#B45309", marginBottom: 10 }}>
                      A autorização foi concedida! Agora cole o <strong>ID da loja</strong> do seu Portal do Parceiro iFood.
                      Acesse <strong>portal.ifood.com.br</strong> → Configurações → copie o <strong>ID do restaurante</strong> (formato UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Ex: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                        value={merchantIdInput}
                        onChange={e => setMerchantIdInput(e.target.value.trim())}
                        style={{
                          flex: 1, padding: "10px 14px", borderRadius: 10,
                          border: "2px solid #F59E0B", fontSize: "0.88rem",
                          fontWeight: 700, fontFamily: "monospace",
                          outline: "none", background: "#FFFEF5"
                        }}
                      />
                      <button
                        onClick={handleSubmitMerchantId}
                        disabled={connectingAuthCode}
                        style={{
                          padding: "10px 18px", borderRadius: 10, border: "none",
                          background: "linear-gradient(135deg, #F59E0B, #D97706)",
                          color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 6,
                          opacity: connectingAuthCode ? 0.7 : 1,
                          whiteSpace: "nowrap"
                        }}
                      >
                        {connectingAuthCode ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Vinculando...</>
                        ) : (
                          <><CheckCircle2 size={16} /> Vincular Loja</>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Info de cobrança */}
                <div style={{ padding: "12px 14px", borderRadius: 12, background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: "0.78rem", color: "#1E40AF", lineHeight: 1.5, marginBottom: 16 }}>
                  ℹ️ A <strong>1ª integração iFood é gratuita</strong> e já está inclusa no seu plano FireHub.
                  Cada integração adicional custa <strong>+R$50,00/mês</strong> na sua fatura mensal.
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setOpenModal(null); setShowAddIfoodForm(false); }}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Fechar
                  </button>
                </div>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* 💳 MODAL: MERCADO PAGO */}
            {openModal === "pagarme" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #009EE3, #0072B1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    💙
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Mercado Pago / Mercado Livre</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Processamento de Pagamento Online no Cardápio</span>
                  </div>
                </div>

                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "0.75rem", color: "#15803D" }}>Status da Integração:</div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#15803D" }}>
                    🟢 Recebimento PIX Instantâneo e Cartão de Crédito Ativos no Cardápio
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "24px" }}>
                  Os pagamentos efetuados pelos seus clientes via PIX instantâneo e Cartão de Crédito no cardápio online do FireHub são processados com total segurança através do <strong>Mercado Pago / Mercado Livre</strong> com repasse direto para a sua conta.
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #009EE3, #0072B1)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Entendido
                  </button>
                </div>
              </div>
            )}

            {/* 🟡 MODAL: 99FOOD */}
            {openModal === "99food" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #F59E0B, #D97706)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🟡
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>99Food Delivery</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração Oficial 99Food</span>
                  </div>
                </div>

                {food99Loading ? (
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#475569" }}>Consultando o 99Food…</div>
                  </div>
                ) : food99Connected ? (
                  <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.75rem", color: "#15803D" }}>Status da Conexão:</div>
                    {/* Dizer QUAL loja está ligada. "Loja autorizada" sozinho não
                        deixa o lojista conferir se ligou a loja certa — e o erro
                        só apareceria com pedido caindo na cozinha errada. */}
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#15803D" }}>
                      🟢 {food99Loja?.nome ? `${food99Loja.nome} — autorizada no 99Food` : "Loja autorizada no 99Food"}
                    </div>
                    {(food99Loja?.shopId || food99Loja?.endereco) && (
                      <div style={{ fontSize: "0.73rem", color: "#166534", marginTop: 3, opacity: 0.9 }}>
                        {food99Loja.endereco ? `${food99Loja.endereco} · ` : ""}
                        <span style={{ fontFamily: "monospace" }}>ID {food99Loja.shopId}</span>
                      </div>
                    )}
                    <div style={{ fontSize: "0.78rem", color: "#166534", marginTop: 4 }}>
                      Os pedidos chegam sozinhos no painel. Não é preciso fazer mais nada.
                    </div>

                    {/* A lista só aparece com 2+ lojas: com uma, o cabeçalho
                        acima já diz qual é, e repetir vira ruído. */}
                    {food99Lojas.length > 1 && (
                      <div style={{ marginTop: 12, borderTop: "1px solid #BBF7D0", paddingTop: 10 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#15803D", marginBottom: 8 }}>
                          {food99Lojas.length} lojas do 99Food nesta conta
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {food99Lojas.map((l) => (
                            <div key={l.appShopId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #D1FAE5", borderRadius: 10, padding: "8px 10px" }}>
                              <div style={{ minWidth: "fit-content" }}>
                                <div style={{ fontSize: "0.83rem", fontWeight: 800, color: "#0F172A" }}>{l.label || "Loja 99Food"}</div>
                                {l.shopId && <div style={{ fontSize: "0.7rem", color: "#64748B", fontFamily: "monospace" }}>ID {l.shopId}</div>}
                              </div>
                              <button
                                onClick={() => handleDesligarLoja99(l.appShopId, l.label || "esta loja")}
                                disabled={food99Saving}
                                style={{ minWidth: "fit-content", padding: "5px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#fff", color: "#991B1B", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}
                              >
                                Desligar
                              </button>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#166534", marginTop: 8, lineHeight: 1.5 }}>
                          A 1ª loja é gratuita. Cada loja adicional custa <strong>+R$50,00/mês</strong> na sua fatura.
                        </div>
                      </div>
                    )}

                    {/* Mesmo fluxo de autorização: a loja nova entra AO LADO da
                        atual, em vez de substituí-la como acontecia antes. */}
                    <button
                      onClick={handleConectar99Food}
                      disabled={food99Saving || !food99Disponivel}
                      style={{ marginTop: 12, padding: "8px 14px", borderRadius: 10, border: "1.5px dashed #15803D", background: "#fff", color: "#15803D", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", minWidth: "fit-content" }}
                    >
                      ➕ Conectar outra loja do 99Food
                    </button>
                  </div>
                ) : (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.75rem", color: "#B45309" }}>Status da Conexão:</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#B45309" }}>
                      ⚪ Loja ainda não autorizada
                    </div>
                    {food99Msg && (
                      <div style={{ fontSize: "0.78rem", color: "#92400E", marginTop: 4 }}>{food99Msg}</div>
                    )}
                  </div>
                )}

                {!food99Connected && (
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>
                      Como conectar (leva menos de um minuto)
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: "#475569", lineHeight: 1.7 }}>
                      <li>Clique em <b>Conectar com o 99Food</b> — abre o site deles.</li>
                      <li>Entre com a <b>mesma conta 99Food onde você vê os pedidos</b> e autorize o FireHub.</li>
                      <li>Pronto. Esta tela detecta sozinha e fica verde — <b>não precisa clicar em mais nada</b>.</li>
                    </ol>
                    <div style={{ fontSize: "0.76rem", color: "#64748B", marginTop: 10 }}>
                      Você não precisa de código, App ID nem Secret. A autorização é feita na sua própria conta.
                    </div>
                  </div>
                )}

                {/* Sem isto o laço automático seria invisível e o lojista ficaria
                    olhando uma tela parada, achando que precisa fazer algo. */}
                {food99Aguardando && !food99Connected && (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", padding: "12px 14px", borderRadius: "12px", marginBottom: "16px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: "1.1rem" }}>⏳</span>
                    <div style={{ fontSize: "0.82rem", color: "#92400E", lineHeight: 1.5 }}>
                      <b>Esperando você autorizar no 99Food…</b><br />
                      Pode deixar esta tela aberta — ela conecta sozinha assim que você concluir lá.
                    </div>
                  </div>
                )}

                {/* Só aparece quando o 99Food tem mais de uma loja autorizada sem
                    dono aqui dentro. Adivinhar seria despejar pedido na cozinha
                    errada, então quem aponta é o lojista — e continua um clique. */}
                {!food99Connected && food99Candidatos.length > 0 && (
                  <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#1E3A8A", marginBottom: 10 }}>
                      Qual destas é a sua loja?
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {food99Candidatos.map((c) => (
                        <button
                          key={c.appShopId}
                          onClick={() => handleEscolher99Food(c.appShopId)}
                          disabled={food99Saving}
                          style={{ textAlign: "left", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #93C5FD", background: "#fff", cursor: "pointer" }}
                        >
                          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#1E3A8A" }}>{c.nome}</div>
                          {c.shopId && (
                            <div style={{ fontSize: "0.72rem", color: "#64748B", fontFamily: "monospace" }}>ID {c.shopId}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!food99Disponivel && (
                  <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", padding: "12px", borderRadius: "12px", marginBottom: "16px", fontSize: "0.8rem", color: "#991B1B" }}>
                    A integração 99Food ainda não foi habilitada no servidor. Fale com o suporte do FireHub.
                  </div>
                )}

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {food99Connected && (
                    <button
                      onClick={handleDisconnect99Food}
                      disabled={food99Saving}
                      style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                    >
                      {/* Nomear o que o botão desliga. "Desconectar 99Food" não
                          diz QUAL loja sai — e desligar a loja errada só se
                          descobre quando os pedidos param de chegar. */}
                      {food99Loja?.nome ? `Desconectar ${food99Loja.nome}` : "Desconectar 99Food"}
                    </button>
                  )}
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                  {/* Reserva do laço automático: cobre a aba fechada cedo demais
                      e o lojista que autorizou ontem e só voltou hoje. */}
                  {!food99Connected && food99Disponivel && food99Candidatos.length === 0 && (
                    <button
                      onClick={handleVerificar99Food}
                      disabled={food99Saving}
                      style={{ padding: "10px 18px", borderRadius: "10px", border: "1.5px solid #D97706", background: "#fff", color: "#B45309", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}
                    >
                      {food99Saving ? "Verificando…" : "Verificar agora"}
                    </button>
                  )}
                  {!food99Connected && (
                    <button
                      onClick={handleConectar99Food}
                      disabled={food99Saving || !food99Disponivel}
                      style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: food99Disponivel ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(245,158,11,0.3)", opacity: food99Saving || !food99Disponivel ? 0.7 : 1 }}
                    >
                      <Save size={16} /> {food99Saving ? "Abrindo…" : "Conectar com o 99Food"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 🤖 MODAL: BRENDI */}
            {openModal === "brendi" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #8B5CF6, #6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🤖
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Brendi</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Cardápio digital + IA no WhatsApp (Open Delivery)</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "16px" }}>
                  Gere as credenciais em <strong>app.brendi.com.br &rarr; Integrações &rarr; API Pública</strong> e cole abaixo.
                  A Brendi mostra o Client Secret <strong>uma única vez</strong> — cole aqui na mesma hora em que criar a integração.
                </p>

                {/* O webhook acelera a chegada do pedido, mas não é obrigatório:
                    o FireHub busca sozinho a cada minuto. Dizer isso aqui evita
                    o lojista achar que errou algo quando pular este passo. */}
                <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: "12px", padding: "12px", fontSize: "0.78rem", color: "#5B21B6", lineHeight: 1.5, marginBottom: "20px" }}>
                  <strong>📡 No painel da Brendi, cadastre este webhook:</strong>
                  <div style={{ fontFamily: "monospace", fontSize: "0.76rem", wordBreak: "break-all", margin: "4px 0" }}>
                    https://firehubfood.com.br/api/brendi/webhook
                  </div>
                  Ele faz o pedido chegar na hora — e mesmo sem ele o FireHub busca os pedidos sozinho a cada minuto.
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Key size={14} color="#8B5CF6" /> Client ID (Brendi)
                    </label>
                    <input
                      type="text"
                      placeholder="Cole aqui o Client ID gerado no painel da Brendi"
                      value={brClientId}
                      onChange={e => setBrClientId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <ShieldCheck size={14} color="#8B5CF6" /> Client Secret (Brendi)
                    </label>
                    <input
                      type="password"
                      placeholder={brHasSecret ? "•••••••• já configurado — deixe em branco para manter" : "Cole aqui o Client Secret (a Brendi mostra uma única vez)"}
                      value={brClientSecret}
                      onChange={e => setBrClientSecret(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                    {brHasSecret && (
                      <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0" }}>
                        Campo em branco mantém o segredo atual — ele nunca é devolvido para o navegador.
                      </p>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Store size={14} color="#8B5CF6" /> Merchant ID (Código da Loja na Brendi)
                    </label>
                    <input
                      type="text"
                      placeholder="Cole aqui o Merchant ID da sua loja"
                      value={brMerchantId}
                      onChange={e => setBrMerchantId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveBrendi}
                    disabled={brSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #8B5CF6, #6D28D9)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(139,92,246,0.3)", opacity: brSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {brSaving ? "Salvando..." : "Salvar e Ativar Brendi"}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
