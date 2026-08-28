"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  TrendingUp, Star, ChevronRight, ArrowLeft, Check, X, Zap, Target,
  BarChart2, MapPin, Clock, Shield, Pause, Play, DollarSign, RefreshCw,
  AlertTriangle, CheckCircle, Settings, ExternalLink, Upload, ImageIcon,
  Sparkles, Edit3, Eye, Bot, Wifi
} from "lucide-react";

/* ── Dados de social proof ── */
const SOCIAL_PROOF = [
  { name: "Burger Carioca", invested: 150, earned: 847, stars: 5 },
  { name: "Pizza do Bairro", invested: 200, earned: 1230, stars: 5 },
  { name: "Sushi Express", invested: 100, earned: 480, stars: 5 },
  { name: "Frango & Cia", invested: 150, earned: 720, stars: 5 },
  { name: "Lanches Top", invested: 100, earned: 394, stars: 5 },
  { name: "Açaí Premium", invested: 150, earned: 1435, stars: 5 },
  { name: "Churrasco RS", invested: 200, earned: 3222, stars: 5 },
  { name: "Tapioca Fit", invested: 100, earned: 560, stars: 4 },
  { name: "Esfiharia Top", invested: 250, earned: 1890, stars: 5 },
  { name: "Poke Natural", invested: 100, earned: 612, stars: 5 },
  { name: "Cantina Italiana", invested: 300, earned: 2415, stars: 5 },
  { name: "Dog & Burger", invested: 150, earned: 980, stars: 5 },
  { name: "Temaki House", invested: 200, earned: 1550, stars: 5 },
  { name: "Pastelaria Mineira", invested: 100, earned: 430, stars: 4 },
];

const FEATURES = [
  { icon: Zap, label: "100% automático", desc: "IA cria e otimiza os anúncios" },
  { icon: Target, label: "Só sua cidade", desc: "Raio de entrega exato" },
  { icon: BarChart2, label: "Painel em tempo real", desc: "ROI, pedidos e investimento" },
  { icon: MapPin, label: "Seus criativos", desc: "Fotos do seu cardápio" },
  { icon: Clock, label: "Otimização contínua", desc: "IA melhora toda semana" },
  { icon: Shield, label: "Sem surpresas", desc: "Você define o valor" },
];

type Step = "hero" | "terms" | "method" | "invest" | "commitment" | "connect" | "creative" | "dashboard";

interface Campaign {
  id: string; weeklyBudget: number; status: string;
  spend?: number; impressions?: number; clicks?: number;
  ordersGenerated?: number; revenue?: number; feeAccrued?: number;
  adCopy?: string; adImageUrl?: string; createdAt?: string;
}

interface ProductImage {
  name: string; imageUrl: string; price: number;
}

/* Aviso da tela. O `acao` existe porque quase todo erro deste módulo — token
   vencido, conta de anúncios que não existe, painel que não carregou — só se
   resolve reconectando o Facebook ou tentando de novo, e a tela não tinha
   NENHUM botão para isso: a mensagem mandava reconectar e não havia onde. */
interface Aviso {
  type: "success" | "error" | "info";
  message: string;
  acao?: { rotulo: string; aoClicar: () => void };
}

/* Motivos de /api/meta-ads/status que só se resolvem refazendo o OAuth — para
   estes o link do Ads Manager não serve de nada. */
const RECONECTAR_RESOLVE = ["conectar_facebook", "conta_nao_encontrada", "sem_pagina"];

/* O servidor grava "ENDED" quando a Meta reporta a campanha arquivada/encerrada.
   A tela só conhecia ACTIVE e PAUSED e imprimia o valor cru em inglês, sem
   nenhuma ação — o lojista via um estado que não entende e nada para fazer. */
const ROTULO_DE_STATUS: Record<string, string> = {
  ACTIVE: "✅ Ativo",
  PAUSED: "⏸️ Pausado",
  ENDED: "🏁 Encerrada",
  CREATING: "⏳ Criando...",
};

export default function TrafegoPagoPage({ user }: { user: any }) {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("hero");
  const [investment, setInvestment] = useState(100);
  const [agreed, setAgreed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);
  /* Caixa de texto dos termos — ver `useEffect` da trava de leitura, abaixo. */
  const termsBoxRef = useRef<HTMLDivElement | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<Aviso | null>(null);
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [newBudget, setNewBudget] = useState(100);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [connected, setConnected] = useState(false);
  /* `connected` significa só "existe string na coluna do token". Uma conexão
     SERVE quando também existe conta de anúncios: o OAuth de quem ainda não
     tinha conta grava o token e volta com erro, e a partir daí a tela achava
     que estava tudo pronto e pulava a conexão PARA SEMPRE — o lojista criava a
     conta no Facebook e não tinha mais como refazer o OAuth. O GET já devolvia
     estas duas flags e a tela descartava as duas. */
  const [temContaDeAnuncios, setTemContaDeAnuncios] = useState(false);
  const [temPagina, setTemPagina] = useState(false);
  /* A Meta recusou os números desta rodada: o painel está exibindo dado velho
     como se fosse de agora. É o primeiro sintoma visível de token morto. */
  const [metricasVelhas, setMetricasVelhas] = useState(false);
  /* Falha ao carregar o painel. Sem este estado o lojista com campanha gastando
     caía na página de vendas, sem erro e sem caminho para pausar. */
  const [erroDeCarga, setErroDeCarga] = useState(false);

  // Creative step state
  const [imageTab, setImageTab] = useState<"upload" | "menu" | "ai">("menu");
  const [selectedImage, setSelectedImage] = useState<string>("");
  const [uploadPreview, setUploadPreview] = useState<string>("");
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [gerandoImagem, setGerandoImagem] = useState(false);
  const [descricaoIA, setDescricaoIA] = useState("");
  const [cotaRestante, setCotaRestante] = useState<number | null>(null);
  const [contaMeta, setContaMeta] = useState<any>(null);
  /* Contas de anúncio que o Facebook conectado alcança — o lojista escolhe de
     qual delas sai o dinheiro. Ver o seletor no painel. */
  const [contasDisponiveis, setContasDisponiveis] = useState<any[]>([]);
  const [contaSelecionada, setContaSelecionada] = useState<string>("");
  const [trocandoConta, setTrocandoConta] = useState(false);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  /* Separa "ainda não busquei as fotos" de "busquei e o cardápio não tem
     nenhuma". Sem essa distinção a tela reapresentava o botão "Carregar fotos
     do cardápio" depois da busca já ter voltado vazia: o lojista clicava, o
     botão voltava igual, e nada explicava que o problema era o cardápio. */
  const [cardapioCarregado, setCardapioCarregado] = useState(false);
  const [adCopy, setAdCopy] = useState("");
  const [adDescription, setAdDescription] = useState("");
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* O valor escolhido acompanha o OAuth para voltar preenchido. Fica num ref
     porque o botão de reconectar agora também é acionado de dentro de banners
     guardados em estado — uma closure velha mandaria sempre R$ 100. */
  const investimentoRef = useRef(investment);
  useEffect(() => { investimentoRef.current = investment; }, [investment]);

  // A URL do OAuth é montada NO SERVIDOR (/api/meta-ads/auth).
  //
  // Antes era montada aqui, com o state em base64 contendo o franchiseeId — e o
  // callback confiava nesse valor. Trocando o id no state dava para desviar a
  // conexão de outro lojista e passar a gastar a verba da conta de anúncios
  // dele. Agora a loja vem da sessão e o state é assinado; o navegador não
  // decide mais nada.
  //
  // Isso também acaba com a divergência de redirect_uri (com e sem "www", que
  // a Meta exige idêntico) — a origem passou a sair de um lugar só.
  //
  // Sobe para cá porque deixou de ser exclusivo da tela `connect`: é a saída de
  // TODO estado de erro do módulo (ver os botões "Reconectar Facebook").
  const handleConnectFacebook = useCallback(() => {
    const valor = investimentoRef.current;
    const qs = valor ? `?investment=${encodeURIComponent(String(valor))}` : "";
    window.location.href = `/api/meta-ads/auth${qs}`;
  }, []);

  /* Carga do painel. Virou função nomeada porque agora existe "Tentar de novo":
     antes o fetch morava dentro do useEffect e não havia como repeti-lo. */
  const carregarCampanhas = useCallback(async (irParaOPainel: boolean) => {
    setErroDeCarga(false);
    try {
      const r = await fetch("/api/meta-ads/campaign");
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (d?.needsSetup) setNeedsSetup(true);
      if (d?.connected) setConnected(true);
      setTemContaDeAnuncios(Boolean(d?.hasAdAccount));
      setTemPagina(Boolean(d?.hasPage));
      setMetricasVelhas(Boolean(d?.metricasDesatualizadas));
      if (d?.campaigns?.length > 0) {
        setCampaigns(d.campaigns);
        if (irParaOPainel) setStep("dashboard");
      }
    } catch {
      /* Engolir a falha deixava o step no "hero": quem já paga R$ 50/semana via
         a PÁGINA DE VENDAS, sem aviso nenhum, e sem caminho para pausar a
         campanha que estava gastando naquele instante. Agora o erro é explícito
         e a tela de erro carrega as duas saídas (tentar de novo / ver painel). */
      setErroDeCarga(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carregar campanha existente + query params do OAuth
  useEffect(() => {
    const connectedParam = searchParams.get("connected");
    const error = searchParams.get("error");
    const budgetParam = searchParams.get("budget");

    if (error) {
      const msgs: Record<string, string> = {
        facebook_denied: "Você negou a autorização no Facebook. Tente novamente.",
        missing_params: "Parâmetros faltando no retorno do Facebook.",
        token_exchange_failed: "Erro ao conectar com o Facebook. Tente novamente.",
        sessao_expirada: "Sua sessão expirou durante a conexão. Entre de novo e reconecte o Facebook.",
        link_expirado: "O link de conexão expirou. Clique em Conectar Facebook de novo.",
        state_invalido: "A conexão não pôde ser validada por segurança. Tente conectar de novo.",
        loja_divergente: "Esta conexão pertence a outra loja. Entre com a conta certa e tente de novo.",
        sem_conta_de_anuncios: "Seu Facebook conectou, mas não tem uma conta de anúncios. Crie uma no Gerenciador de Anúncios do Facebook e reconecte.",
        // O callback devolve este código e a tabela não o tinha: o lojista lia
        // "Erro desconhecido." exatamente no ponto em que precisava saber que
        // basta criar uma Página do restaurante e conectar de novo.
        sem_pagina_do_facebook: "Seu Facebook conectou, mas não encontramos uma Página do restaurante. O anúncio precisa ser publicado por uma Página — crie a sua no Facebook e conecte de novo.",
        modulo_nao_configurado: "O Tráfego Pago ainda não está configurado neste servidor. Fale com o suporte do FireHub.",
      };
      /* TODAS estas mensagens mandam "tente de novo" / "reconecte" — e não havia
         botão nenhum na tela para isso, porque o callback já tinha gravado o
         token antes de redirecionar com o erro. O caso `sem_conta_de_anuncios`
         era terminal: o lojista criava a conta no Facebook, voltava, e a tela
         achava que ele já estava conectado. O banner leva a saída junto. */
      setNotification({
        type: "error",
        message: msgs[error] || "Erro desconhecido.",
        acao: { rotulo: "Conectar Facebook de novo", aoClicar: handleConnectFacebook },
      });
    }

    if (connectedParam === "true") {
      setConnected(true);
      setNotification({ type: "success", message: "✅ Facebook conectado! Agora configure seu primeiro anúncio." });
      if (budgetParam) setInvestment(Number(budgetParam) || 100);
      // Ir direto pro wizard de criativo
      setStep("creative");
    }

    // Buscar campanhas existentes
    void carregarCampanhas(connectedParam !== "true");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live counter
  useEffect(() => {
    if (step !== "hero") return;
    const interval = setInterval(() => setTick(t => t + 1), 1200);
    return () => clearInterval(interval);
  }, [step]);

  /* ── A TRAVA DE LEITURA DOS TERMOS ────────────────────────────────────────
   *
   * Era `onScroll={handleTermsScroll}` no próprio div. Em produção isso
   * simplesmente NÃO dispara: medido no navegador, na página real, o elemento
   * recebeu 6 eventos `scroll` NATIVOS e confiáveis, a condição de fim de
   * rolagem passou a valer — e o `setTermsScrolled(true)` nunca rodou. Como o
   * botão "Aceito os termos" só liga com esse estado, o lojista lia tudo até o
   * fim e ficava preso na porta: o módulo inteiro era inalcançável, e de fora
   * parecia que o Tráfego Pago "não funciona".
   *
   * `scroll` é um evento que não borbulha, e é exatamente aí que a delegação
   * do React se perde. Ouvir direto no elemento é o caminho que comprovadamente
   * funciona — foi assim que o teste capturou os eventos.
   *
   * Três garantias, porque prender o cliente na tela de contratação é o pior
   * defeito possível desta página:
   *   1. listener nativo no elemento (o caminho normal, de roda e de toque);
   *   2. um sentinela no fim do texto — libera mesmo quando a rolagem vem de
   *      teclado, de lupa de acessibilidade ou do "ir para o fim" de um leitor
   *      de tela, que nem sempre passam pelo caso 1;
   *   3. se o texto couber inteiro sem rolagem (tela grande, zoom menor), não
   *      há o que rolar: libera na hora, senão a trava nunca abriria.
   */
  useEffect(() => {
    if (step !== "terms") return;
    const el = termsBoxRef.current;
    if (!el) return;

    const liberar = () => setTermsScrolled(true);
    const chegouAoFim = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 30;

    if (el.scrollHeight <= el.clientHeight + 30 || chegouAoFim()) {
      liberar();
      return;
    }

    const aoRolar = () => { if (chegouAoFim()) liberar(); };
    el.addEventListener("scroll", aoRolar, { passive: true });

    let observador: IntersectionObserver | null = null;
    const fim = el.querySelector("[data-fim-dos-termos]");
    if (fim && typeof IntersectionObserver !== "undefined") {
      observador = new IntersectionObserver(
        (entradas) => { if (entradas.some((e) => e.isIntersecting)) liberar(); },
        { root: el, threshold: 0.1 }
      );
      observador.observe(fim);
    }

    return () => {
      el.removeEventListener("scroll", aoRolar);
      if (observador) observador.disconnect();
    };
  }, [step]);

  // Dashboard auto-refresh a cada 60s
  useEffect(() => {
    if (step !== "dashboard") return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch("/api/meta-ads/campaign");
        const d = await r.json();
        if (d?.campaigns) setCampaigns(d.campaigns);
        setMetricasVelhas(Boolean(d?.metricasDesatualizadas));
      } catch { /* silencioso */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, [step]);

  // Prontidão da conta de anúncios.
  //
  // Rodava SÓ no painel — ou seja, a checagem de "esta conta consegue veicular?"
  // só acontecia DEPOIS de a campanha existir e os R$ 50 da semana já estarem
  // na fatura. Numa conta pré-paga zerada a Meta aceita criar e ativar tudo e
  // simplesmente não entrega: cobrança sem serviço, que é o defeito que este
  // módulo não pode ter. Agora roda também no passo do criativo, ANTES do botão
  // Publicar — que é onde o dinheiro é lançado.
  const atualizarProntidao = useCallback(async () => {
    try {
      const r = await fetch("/api/meta-ads/status");
      const d = await r.json();
      setContaMeta(d);
    } catch { /* a tela não pode travar por causa da consulta de prontidão */ }
  }, []);

  useEffect(() => {
    if (step !== "dashboard" && step !== "creative") return;
    void atualizarProntidao();
    const t = setInterval(() => { void atualizarProntidao(); }, 120_000);
    return () => clearInterval(t);
  }, [step, atualizarProntidao]);

  /**
   * As contas de anúncio que a conta do Facebook conectada alcança.
   *
   * Só faz sentido perguntar "de qual conta sai o dinheiro" quando existe mais
   * de uma — por isso o seletor só aparece nesse caso. A lista vem do
   * diagnóstico, que já traz o estado de cada conta em português.
   */
  const carregarContasDeAnuncio = useCallback(async () => {
    try {
      const r = await fetch("/api/meta-ads/diagnostico");
      if (!r.ok) return;
      const d = await r.json();
      const lista = Array.isArray(d?.contas) ? d.contas : [];
      setContasDisponiveis(lista);
      if (d?.contaSalvaHoje) setContaSelecionada(d.contaSalvaHoje);
      else if (lista.length > 0) setContaSelecionada(lista[0].id);
    } catch { /* a tela funciona sem o seletor */ }
  }, []);

  useEffect(() => {
    if (step !== "dashboard") return;
    void carregarContasDeAnuncio();
  }, [step, carregarContasDeAnuncio]);

  // Auto-gerar copy ao entrar no step creative (se ainda não tem)
  const hasAutoGenerated = useRef(false);
  useEffect(() => {
    if (step === "creative" && !adCopy && !generatingCopy && !hasAutoGenerated.current) {
      hasAutoGenerated.current = true;
      handleGenerateCopy();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveReceita = 2_847_392.18 + tick * 3.47;
  const liveInvestido = 412_580 + tick * 0.58;
  const livePedidos = 41_893 + tick;

  // Gerar copy com IA.
  //
  // `preservarTexto` protege o que o lojista escreveu: este mesmo handler é o
  // botão "Carregar fotos do cardápio", e ele sobrescrevia sem dó o anúncio já
  // ajustado à mão.
  const handleGenerateCopy = async (preservarTexto = false) => {
    const textoFallback = `🍔 Peça agora em ${user.storeName || "nosso restaurante"}! Entrega rápida. Clique e aproveite!`;
    setGeneratingCopy(true);
    try {
      const res = await fetch("/api/meta-ads/generate-creative", { method: "POST" });
      const data = await res.json().catch(() => ({} as any));
      // Era o ÚNICO fetch do arquivo sem checar `res.ok`. Um 401 (sessão que
      // expirou com a aba aberta) responde JSON válido, então o catch abaixo
      // NÃO dispara: adCopy ficava vazio, a grade de fotos vazia, nenhum aviso,
      // e o botão Publicar cinza sem uma palavra de explicação.
      if (!res.ok) {
        setNotification({
          type: "error",
          message: data?.error || "Não consegui gerar o texto agora. Escreva o seu ou tente de novo.",
        });
        setCardapioCarregado(true);
        if (!adCopy.trim()) setAdCopy(textoFallback);
        return;
      }
      if (data.adCopy && !(preservarTexto && adCopy.trim())) setAdCopy(data.adCopy);
      if (data.adDescription && !(preservarTexto && adDescription.trim())) setAdDescription(data.adDescription);
      if (data.productImages?.length > 0) setProductImages(data.productImages);
      // Marca que a busca terminou: é o que distingue "ainda não carreguei" de
      // "carreguei e o cardápio não tem foto nenhuma".
      setCardapioCarregado(true);
    } catch {
      setNotification({
        type: "error",
        message: "Não consegui falar com o servidor para gerar o texto. Confira a internet e tente de novo.",
      });
      setCardapioCarregado(true);
      if (!adCopy.trim()) setAdCopy(textoFallback);
      if (!adDescription.trim()) setAdDescription("Delivery rápido com cardápio completo. Peça pelo nosso site!");
    } finally {
      setGeneratingCopy(false);
    }
  };

  // Upload imagem
  // O arquivo vai para o servidor e volta como URL pública.
  //
  // Antes virava data URI (readAsDataURL) e era isso que ia como adImageUrl —
  // mas a Meta BAIXA a imagem para montar o criativo, e "data:image/..." não é
  // endereço que ela consiga buscar. O upload nunca funcionou de verdade.
  // O servidor também padroniza em 1080x1080, senão a Meta recusa foto pequena.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Limpa o input JÁ: sem isso, escolher o MESMO arquivo depois de um erro não
    // dispara o onChange — a tela fica inerte justamente no gesto de retentar.
    e.target.value = "";
    if (!file) return;
    // Sem esta trava dois envios corriam juntos e quem respondesse por último
    // ganhava o `selectedImage`: dava para publicar a foto que o lojista NÃO
    // escolheu por último. A área de upload agora também fica bloqueada.
    if (enviandoImagem) return;

    setEnviandoImagem(true);
    try {
      const corpo = new FormData();
      corpo.append("imagem", file);
      const res = await fetch("/api/meta-ads/imagem", { method: "POST", body: corpo });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setNotification({ type: "error", message: data?.error || "Não consegui enviar a imagem." });
        return;
      }
      setUploadPreview(data.url);
      setSelectedImage(data.url);
    } catch {
      setNotification({ type: "error", message: "Falha ao enviar a imagem. Tente de novo." });
    } finally {
      setEnviandoImagem(false);
    }
  };

  // Geração por IA — 10 por semana no pacote.
  // Busca a cota ao abrir a aba, para o número já aparecer certo em vez de
  // mostrar "10 incluídas" para quem já usou 7.
  useEffect(() => {
    if (imageTab !== "ai" || cotaRestante !== null) return;
    fetch("/api/meta-ads/gerar-imagem")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.restantes === "number") setCotaRestante(d.restantes); })
      .catch(() => {});
  }, [imageTab, cotaRestante]);

  const handleGerarImagemIA = async () => {
    const descricao = descricaoIA.trim();
    if (!descricao) {
      setNotification({ type: "error", message: "Descreva o que você quer na imagem." });
      return;
    }
    setGerandoImagem(true);
    try {
      const res = await fetch("/api/meta-ads/gerar-imagem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotification({ type: "error", message: data.mensagem || "Não consegui gerar a imagem." });
        if (typeof data.restantes === "number") setCotaRestante(data.restantes);
        return;
      }
      setUploadPreview(data.url);
      setSelectedImage(data.url);
      setCotaRestante(data.restantes);
    } catch {
      setNotification({ type: "error", message: "Falha ao gerar a imagem. Tente de novo." });
    } finally {
      setGerandoImagem(false);
    }
  };

  /* ── ESTADO DA CONTA DE ANÚNCIOS, LIDO EM UM LUGAR SÓ ─────────────────────
   *
   * /api/meta-ads/status responde com DUAS chaves de link diferentes:
   * `linkParaRecarregar` no caminho feliz e `linkParaResolver` nos ramos de
   * falha (sem forma de pagamento, conta desativada, conta inacessível). A tela
   * lia só a primeira — ou seja, exatamente quando o lojista estava pagando
   * R$ 50/semana e o anúncio não rodava, o card vermelho aparecia SEM botão
   * nenhum para ir consertar, e o link já calculado no servidor era jogado fora.
   */
  const linkDaConta: string | undefined = contaMeta?.linkParaRecarregar || contaMeta?.linkParaResolver;
  const proximoPasso: string = contaMeta?.proximoPasso || "";
  const contaNaoPronta = contaMeta?.pronto === false;
  /* Reconectar é a única saída destes estados — inclusive do pior deles, o
     "conectou mas não tinha conta de anúncios", que o GET já denunciava em
     hasAdAccount e a tela descartava. */
  const precisaReconectar =
    contaMeta?.conectado === false ||
    RECONECTAR_RESOLVE.includes(proximoPasso) ||
    (connected && (!temContaDeAnuncios || !temPagina));
  /* Ter token não é ter conexão utilizável: sem conta de anúncios ou sem Página
     o servidor recusa a publicação, e o wizard mandava o lojista montar o
     criativo inteiro para nada. Mandar para a tela de conexão é o certo — é lá
     que ele lê o que falta criar no Facebook e refaz o OAuth. */
  const conexaoUtilizavel = connected && temContaDeAnuncios && temPagina;

  /* Motivo pelo qual publicar AGORA seria cobrar por um anúncio que não vai
     rodar. Null quando não há impedimento conhecido — nunca bloqueia por dúvida:
     se a consulta de prontidão falhou, quem está com tudo certo publica. */
  const bloqueioDaConta: string | null =
    contaNaoPronta
      ? (contaMeta?.mensagem || "Resolva a pendência da sua conta de anúncios antes de publicar.")
      : connected && !temContaDeAnuncios
        ? "Seu Facebook está conectado, mas nenhuma conta de anúncios foi encontrada nele. Crie uma no Gerenciador de Anúncios e conecte de novo."
        : connected && !temPagina
          ? "Sua conta não tem uma Página do Facebook vinculada, e o anúncio precisa ser publicado por uma Página. Crie a Página do restaurante e conecte de novo."
          : null;

  /* Rótulo honesto do card da conta. Sem isto, QUALQUER problema (cartão
     recusado, conta desativada, token morto) era anunciado como "sem saldo",
     porque o ramo de falha do status nem devolve `carteira`. */
  const ROTULO_DO_PROBLEMA: Record<string, string> = {
    sem_saldo: "sem saldo — os anúncios não vão rodar",
    sem_forma_de_pagamento: "sem forma de pagamento — os anúncios não vão rodar",
    conta_desativada: "conta desativada no Facebook — os anúncios não vão rodar",
    conta_nao_encontrada: "não conseguimos acessar sua conta de anúncios",
    sem_pagina: "falta uma Página do Facebook para publicar o anúncio",
    conectar_facebook: "Facebook não conectado",
  };

  // Criar campanha
  const handleCreateCampaign = async () => {
    if (!selectedImage && !uploadPreview) {
      setNotification({ type: "error", message: "Selecione uma imagem para o anúncio." });
      return;
    }
    if (!adCopy.trim()) {
      setNotification({ type: "error", message: "Escreva o texto do anúncio." });
      return;
    }
    /* Publicar lança R$ 50 de gestão na fatura NA HORA. Se a conta do Facebook
       não consegue veicular (sem forma de pagamento, desativada, ou pré-paga com
       saldo zero), a Meta ACEITA criar e ativar a campanha e simplesmente não
       entrega nada: seria cobrar por serviço que não acontece. Só barra quando o
       servidor AFIRMOU que não está pronto — se a consulta falhou, quem está com
       tudo certo não pode ficar impedido de anunciar. */
    if (bloqueioDaConta) {
      setNotification({
        type: "error",
        message: `${bloqueioDaConta} Nada foi cobrado.`,
        acao: precisaReconectar
          ? { rotulo: "Reconectar Facebook", aoClicar: handleConnectFacebook }
          : linkDaConta
            ? { rotulo: "Resolver no Facebook", aoClicar: () => window.open(linkDaConta, "_blank", "noopener") }
            : undefined,
      });
      return;
    }
    setCreatingCampaign(true);
    try {
      const res = await fetch("/api/meta-ads/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weeklyBudget: investment,
          adCopy: adCopy.trim(),
          // A descrição editada ia para o estado e morria lá — nunca chegava
          // ao criativo do anúncio.
          adDescription: adDescription.trim() || undefined,
          adImageUrl: selectedImage || uploadPreview,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok && data.campaign) {
        setCampaigns(prev => [data.campaign, ...prev]);
        setStep("dashboard");
        setNotification({ type: "success", message: "🎉 Campanha criada! Seus anúncios já estão rodando no Facebook e Instagram." });
      } else {
        /* A recusa do servidor vem com o caminho de conserto (`linkParaResolver`
           para o Ads Manager, ou "reconecte"). Mostrar só o texto deixava o
           lojista lendo o que fazer sem ter onde clicar. */
        const reconectar = RECONECTAR_RESOLVE.includes(String(data?.proximoPasso || ""));
        const link: string | undefined = data?.linkParaResolver;
        setNotification({
          type: "error",
          message: data?.error || "Erro ao criar campanha.",
          acao: reconectar
            ? { rotulo: "Reconectar Facebook", aoClicar: handleConnectFacebook }
            : link
              ? {
                  rotulo: link.startsWith("/") ? "Abrir" : "Resolver no Facebook",
                  aoClicar: () => { if (link.startsWith("/")) window.location.href = link; else window.open(link, "_blank", "noopener"); },
                }
              : undefined,
        });
        // O motivo pode ter mudado desde a última consulta — relê para o aviso
        // do passo do criativo refletir o estado real.
        void atualizarProntidao();
      }
    } catch {
      setNotification({ type: "error", message: "Erro de conexão. Tente novamente." });
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Ações do dashboard
  const handleAction = async (campaignId: string, action: string, extraData?: any) => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/meta-ads/campaign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaignId, ...extraData }),
      });
      if (res.ok) {
        const resposta = await res.json().catch(() => ({} as any));
        const r = await fetch("/api/meta-ads/campaign");
        const d = await r.json();
        if (d?.campaigns) setCampaigns(d.campaigns);
        setMetricasVelhas(Boolean(d?.metricasDesatualizadas));
        /* Retomar pode lançar a semana de gestão na fatura no mesmo toque, e
           pausar depois não estorna. Responder só "Campanha retomada!" escondia
           do lojista que aquele clique custou dinheiro — ele só descobriria na
           fatura do mês seguinte. Quando o servidor informa (`cobrou`/`valor`),
           o recibo é exato; enquanto não informar, o aviso diz a regra em vez
           de omitir a cobrança. */
        const valorDaGestao = Number(resposta?.valorCobrado ?? resposta?.valor ?? 50);
        const msgs: Record<string, string> = {
          pause: "⏸️ Campanha pausada. Nenhuma nova taxa de gestão é lançada enquanto ela estiver parada.",
          resume: typeof resposta?.cobrou === "boolean"
            ? (resposta.cobrou
                ? `▶️ Campanha retomada — R$ ${valorDaGestao} de gestão lançados na sua fatura.`
                : "▶️ Campanha retomada — a semana atual já estava paga, nada novo foi cobrado.")
            : "▶️ Campanha retomada. A taxa de gestão da semana entra na sua fatura, como avisado antes de confirmar.",
          update_budget: "💰 Orçamento atualizado.",
        };
        setNotification({ type: "success", message: msgs[action] || "✅" });
        setEditingBudget(null);
        // O motivo de a conta não veicular muda com estas ações — relê para o
        // card do painel não continuar mostrando um estado vencido.
        void atualizarProntidao();
      } else {
        // O servidor explica o que travou ("Token expirado", "orçamento
        // recusado pelo Facebook"...) — engolir isso deixava o botão mudo.
        const d = await res.json().catch(() => ({} as any));
        /* "Token expirado" era uma frase sem saída: pausar falhava, a campanha
           seguia gastando na Meta e não havia botão de reconectar em lugar
           nenhum da tela. Agora o próprio erro carrega a saída. */
        const textoDoErro = String(d?.error || "");
        const ofereceReconexao =
          RECONECTAR_RESOLVE.includes(String(d?.proximoPasso || "")) ||
          /token|reconect|permiss/i.test(textoDoErro);
        setNotification({
          type: "error",
          message: textoDoErro || "Não consegui executar a ação. Tente de novo.",
          acao: ofereceReconexao ? { rotulo: "Reconectar Facebook", aoClicar: handleConnectFacebook } : undefined,
        });
      }
    } catch {
      setNotification({ type: "error", message: "Erro de conexão." });
    } finally {
      setActionLoading(false);
    }
  };

  /* Retomar é ação PAGA e irreversível: lança a semana de gestão na fatura na
     hora e pausar em seguida não estorna. Um botão de 4px de padding, num painel
     usado no celular, não pode fazer isso sem perguntar. */
  const confirmarRetomada = (c: Campaign) => {
    const ok = window.confirm(
      "Retomar esta campanha?\n\n" +
      `• Investimento: R$ ${c.weeklyBudget}/semana, cobrado pelo Facebook na sua conta de anúncios.\n` +
      "• Gestão FireHub: R$ 50 pela semana, lançados na sua fatura ao ativar.\n" +
      "  (Se a semana atual já estiver paga, nada novo é cobrado.)\n\n" +
      "Pausar depois não estorna a semana."
    );
    if (!ok) return;
    void handleAction(c.id, "resume");
  };

  // Notification
  const Banner = () => {
    if (!notification) return null;
    const cfg = {
      success: { bg: "#F0FDF4", border: "#BBF7D0", color: "#166534", Icon: CheckCircle },
      error: { bg: "#FEF2F2", border: "#FECACA", color: "#991B1B", Icon: AlertTriangle },
      info: { bg: "#EFF6FF", border: "#BFDBFE", color: "#1E40AF", Icon: Zap },
    }[notification.type];
    return (
      <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12, padding: "12px 16px", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <cfg.Icon size={18} color={cfg.color} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: "0.88rem", color: cfg.color, fontWeight: 600, flex: "1 1 200px" }}>{notification.message}</span>
        {/* A saída vai JUNTO da mensagem. Antes o banner mandava "reconecte" e
            não existia botão de reconectar em tela nenhuma do módulo. */}
        {notification.acao && (
          <button onClick={notification.acao.aoClicar}
            style={{ background: cfg.color, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
            {notification.acao.rotulo}
          </button>
        )}
        <button onClick={() => setNotification(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}><X size={16} color={cfg.color} /></button>
      </div>
    );
  };

  /* Botão de reconexão do Facebook.
   *
   * Existia UM só, dentro do passo `connect` — e a única porta para esse passo
   * estava atrás de `connected === false`. Como nada no sistema jamais limpa o
   * token, `connected` fica true para sempre depois do primeiro OAuth: token
   * vencido (60 dias) ou app revogado deixavam o módulo INUTILIZÁVEL, com a
   * campanha gastando na Meta, publicar falhando e pausar falhando. Agora ele
   * aparece no painel, nos estados de erro e na tela de falha de carga. */
  const BotaoReconectar = ({ destaque = false, rotulo = "Reconectar Facebook" }: { destaque?: boolean; rotulo?: string }) => (
    <button type="button" onClick={handleConnectFacebook} disabled={needsSetup}
      title={needsSetup ? "Módulo não configurado neste servidor" : "Refazer a conexão com o Facebook"}
      style={{
        background: needsSetup ? "#E5E7EB" : destaque ? "#1877F2" : "transparent",
        color: needsSetup ? "#9CA3AF" : destaque ? "#fff" : "#1877F2",
        border: destaque ? "none" : "1.5px solid #1877F2",
        borderRadius: 10, padding: destaque ? "11px 18px" : "8px 14px",
        fontSize: "0.82rem", fontWeight: 800, cursor: needsSetup ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
      }}>
      <RefreshCw size={14} /> {rotulo}
    </button>
  );

  /* Módulo sem credencial da Meta no servidor. O GET já avisava e a tela
     descartava o aviso: o lojista percorria o funil inteiro e o botão Conectar
     devolvia uma página de erro 500 crua, sem explicação. */
  const AvisoDeConfiguracao = () => !needsSetup ? null : (
    <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "1rem 1.15rem", marginBottom: "1.5rem" }}>
      <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.9rem", marginBottom: 4 }}>⚙️ Tráfego Pago ainda não está configurado neste servidor</div>
      <div style={{ fontSize: "0.82rem", color: "#92400E", lineHeight: 1.5 }}>
        Não é nada do seu lado — falta uma credencial da Meta na instalação do FireHub. Conectar o
        Facebook não vai funcionar até isso ser resolvido.{" "}
        <a href="https://wa.me/5522998851680?text=Oi%20o%20trafego%20pago%20aparece%20como%20nao%20configurado%20no%20meu%20firehub" target="_blank" rel="noopener noreferrer" style={{ color: "#92400E", fontWeight: 800 }}>
          Avisar o suporte
        </a>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, border: "4px solid #E5E7EB", borderTopColor: "#2563EB", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
        <p style={{ color: "#6B7280" }}>Carregando...</p>
      </div>
    </div>
  );

  /* ═══════ FALHA AO CARREGAR ═══════
   *
   * Antes esta falha era engolida: o step ficava em "hero" e quem já pagava
   * R$ 50/semana via a PÁGINA DE VENDAS, sem erro nenhum, e sem caminho para
   * pausar a campanha que estava gastando naquele instante — refazer o funil
   * termina no criativo e o servidor recusa com "você já tem uma campanha
   * ativa". Toda tela de erro deste módulo precisa ter saída; esta tem três. */
  if (erroDeCarga && step === "hero") return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "2rem 1rem 4rem", textAlign: "center" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ textAlign: "left" }}><Banner /></div>
      <AlertTriangle size={40} color="#EF4444" style={{ margin: "0 auto 12px" }} />
      <h2 style={{ fontSize: "1.25rem", fontWeight: 900, marginBottom: 8 }}>Não consegui carregar suas campanhas</h2>
      <p style={{ color: "#6B7280", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
        Pode ter sido a internet ou uma instabilidade momentânea. <strong>Sua campanha não foi
        alterada</strong> — se ela estava rodando, continua rodando. Tente de novo para abrir o painel
        e poder pausar.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={() => { setLoading(true); void carregarCampanhas(true); }}
          style={{ background: "#EF4444", color: "#fff", border: "none", padding: "12px 22px", borderRadius: 12, fontSize: "0.95rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <RefreshCw size={16} /> Tentar de novo
        </button>
        {campaigns.length > 0 && (
          <button onClick={() => setStep("dashboard")}
            style={{ background: "#fff", border: "1.5px solid #E5E7EB", padding: "12px 22px", borderRadius: 12, fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", color: "#374151" }}>
            Ver meu painel
          </button>
        )}
        <button onClick={() => window.open("https://wa.me/5522998851680?text=Oi%20nao%20consigo%20abrir%20o%20painel%20de%20trafego%20pago%20e%20preciso%20pausar%20minha%20campanha", "_blank")}
          style={{ background: "#fff", border: "1.5px solid #E5E7EB", padding: "12px 22px", borderRadius: 12, fontSize: "0.95rem", fontWeight: 700, cursor: "pointer", color: "#374151", display: "inline-flex", alignItems: "center", gap: 8 }}>
          💬 Preciso pausar agora <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );

  /* ═══════ HERO ═══════ */
  if (step === "hero") return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <AvisoDeConfiguracao />
      {/* Quem já tem campanha e caiu aqui por uma falha de carga precisa de uma
          porta para o painel — é lá que fica o botão de pausar. */}
      {campaigns.length > 0 && (
        <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
          <button onClick={() => setStep("dashboard")}
            style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "9px 18px", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", color: "#374151" }}>
            Já tenho campanha — ver meu painel
          </button>
        </div>
      )}
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}.social-track{display:flex;gap:.75rem;width:max-content;animation:marquee 28s linear infinite}.social-track:hover{animation-play-state:paused}@keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse-glow{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}@media(max-width:640px){.hero-stats-grid{grid-template-columns:repeat(2,1fr)!important}.hero-live-row{flex-direction:column!important;gap:1rem!important}.hero-steps-grid{grid-template-columns:1fr!important}}`}</style>
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99, letterSpacing: 1 }}>TRÁFEGO PAGO + FIREHUB</span>
      </div>
      <h1 style={{ textAlign: "center", fontSize: "clamp(1.6rem,4vw,2.5rem)", fontWeight: 900, lineHeight: 1.2, marginBottom: "0.75rem", animation: "fadeInUp 0.6s ease" }}>
        Conecte, invista e a IA<br />cuida do resto
      </h1>
      <p style={{ textAlign: "center", color: "#6B7280", fontSize: "1rem", marginBottom: "2rem", lineHeight: 1.6 }}>
        Anúncios no <strong>Facebook</strong> e <strong>Instagram</strong> 100% automáticos.<br />
        Você não precisa entender nada de marketing. <strong>Só receba os pedidos.</strong>
      </p>

      {/* ── 3 Passos visuais ── */}
      <div className="hero-steps-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1rem", marginBottom: "2rem" }}>
        {[
          { step: "1", emoji: "📱", title: "Conecte o Facebook", desc: "Login em 1 clique. Sem complicação.", color: "#1877F2" },
          { step: "2", emoji: "💰", title: "Escolha o investimento", desc: "A partir de R$100/semana. Você decide.", color: "#16A34A" },
          { step: "3", emoji: "🤖", title: "IA faz tudo por você", desc: "Cria, publica e otimiza os anúncios.", color: "#EF4444" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.25rem", textAlign: "center", position: "relative", animation: `fadeInUp ${0.4 + i * 0.15}s ease` }}>
            <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: s.color, color: "#fff", width: 24, height: 24, borderRadius: "50%", fontSize: "0.72rem", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.step}</div>
            <div style={{ fontSize: "2rem", marginBottom: 8, marginTop: 4 }}>{s.emoji}</div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.4 }}>{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Métricas */}
      <div className="hero-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem", marginBottom: "2rem" }}>
        {/* Antes havia aqui "ROAS médio 4,72x", "133 mil visualizações" e
            "37 pedidos/semana" — todos escritos no código, sem nenhum dado real
            por trás. Prometer resultado que não se pode sustentar é o caminho
            mais curto para o lojista pedir o dinheiro de volta. Trocado pelo
            que é verdade e verificável sobre o serviço. */}
        {[
          { label: "Onde aparece", value: "Facebook e Instagram" },
          { label: "Quem vê", value: "Só quem você entrega" },
          { label: "Gestão FireHub", value: "R$ 50/semana" },
          { label: "Fidelidade", value: "Sem contrato" },
        ].map(s => (
          <div key={s.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#111" }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <button onClick={() => setStep("terms")} style={{ background: "#EF4444", color: "#fff", border: "none", padding: "16px 40px", borderRadius: 12, fontSize: "1.1rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, animation: "pulse-glow 2s infinite" }}>
          Ativar para meu restaurante <ChevronRight size={20} />
        </button>
        <p style={{ color: "#9CA3AF", fontSize: "0.8rem", marginTop: 8 }}>⚡ Configuração em menos de 5 minutos · Sem contrato</p>
      </div>
      {/* O carrossel de "depoimentos" mostrava 14 restaurantes que NÃO EXISTEM
          ("Burger Carioca investiu R$150 e faturou R$847"), com cinco estrelas
          e tudo. Isso é depoimento fabricado — some até haver resultado real de
          cliente real para mostrar, com autorização dele. */}
      {false && (
      <div style={{ overflow: "hidden", marginBottom: "2rem", userSelect: "none" }}>
        <div className="social-track">
          {[...SOCIAL_PROOF, ...SOCIAL_PROOF].map((r, i) => (
            <div key={i} style={{ flexShrink: 0, background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "0.85rem 1rem", minWidth: 200 }}>
              <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>{Array(r.stars).fill(0).map((_, j) => <Star key={j} size={12} fill="#F59E0B" color="#F59E0B" />)}</div>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4 }}>{r.name}</div>
              <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>Investiu <strong>R${r.invested}</strong> — Faturou <span style={{ color: "#16A34A", fontWeight: 800 }}>R${r.earned.toLocaleString("pt-BR")}</span></div>
            </div>
          ))}
        </div>
      </div>
      )}
      {false && (
      <div className="hero-live-row" style={{ display: "flex", justifyContent: "center", gap: "3rem", borderTop: "1px solid #E5E7EB", paddingTop: "1.5rem" }}>
        {[
          { label: "Receita Gerada", value: `R$ ${liveReceita.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: "Valor Investido", value: `R$ ${liveInvestido.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` },
          { label: "Pedidos Gerados", value: livePedidos.toLocaleString("pt-BR") },
        ].map(s => (
          <div key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#16A34A", fontVariantNumeric: "tabular-nums", transition: "all 0.3s ease" }}>{s.value}</div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
      )}
      {/* Os contadores "ao vivo" acima (Receita Gerada / Valor Investido /
          Pedidos) eram uma fórmula: 2.847.392,18 + tick × 3,47. Nada vinha do
          banco. Ficam ocultos até existir número real para somar. */}
    </div>
  );

  /* ═══════ TERMS ═══════ */
  if (step === "terms") {
    // A liberação da leitura mora no useEffect lá em cima (listener nativo +
    // sentinela): o onScroll do React que ficava aqui nunca disparava.
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 1rem 4rem" }}>
        <Banner />
        <button onClick={() => setStep("hero")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
        <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📜</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, marginBottom: "0.25rem" }}>Termos do Tráfego Pago</h2>
          <p style={{ color: "#6B7280", fontSize: "0.88rem" }}>Leia com atenção antes de prosseguir. Role até o final para aceitar.</p>
        </div>

        <div ref={termsBoxRef} style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", maxHeight: 400, overflowY: "auto", marginBottom: "1.5rem", fontSize: "0.88rem", lineHeight: 1.8, color: "#374151" }}>
          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>1. Taxa de Gestão</h3>
          <p>O módulo de Tráfego Pago cobra <strong>R$ 50,00/semana</strong> pelo <strong>serviço de gestão de campanhas</strong> (criação, otimização e monitoramento dos seus anúncios).</p>

          <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 10, padding: "0.85rem", margin: "0.75rem 0" }}>
            <strong style={{ color: "#991B1B" }}>🔴 IMPORTANTE:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: "1.2rem", color: "#991B1B" }}>
              <li><strong>Ativou a campanha = a semana inteira é cobrada.</strong> Se ativar e pausar no dia seguinte, os R$ 50,00 daquela semana são devidos do mesmo jeito</li>
              <li>A taxa é cobrada <strong>independente do retorno em vendas</strong></li>
              <li>O FireHub <strong>NÃO garante</strong> resultados específicos de vendas ou ROAS</li>
              <li>O retorno depende de fatores como: <strong>qualidade do produto, atendimento, preços, fotos do cardápio e mercado local</strong></li>
            </ul>
          </div>

          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "0.85rem", margin: "0.75rem 0" }}>
            <strong style={{ color: "#92400E" }}>💡 Impostos do Facebook (não é cobrança do FireHub):</strong>
            <p style={{ margin: "4px 0 0", color: "#92400E" }}>
              Desde janeiro de 2026 a Meta repassa impostos ao anunciante — cerca de
              <strong> 12,5%</strong> sobre o valor de mídia. Isso vai para o governo, não para nós,
              e aparece assim:
            </p>
            <ul style={{ margin: "6px 0 0", paddingLeft: "1.2rem", color: "#92400E" }}>
              <li><strong>Cartão de crédito:</strong> a fatura vem maior que o orçamento. Definiu R$ 200 de mídia, o Facebook cobra cerca de R$ 225</li>
              <li><strong>Pix ou boleto:</strong> o imposto sai do crédito. Depositou R$ 200, cerca de R$ 175 viram anúncio</li>
            </ul>
          </div>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", marginTop: "1.25rem" }}>2. Cobrança</h3>
          <ul style={{ paddingLeft: "1.2rem", margin: "0 0 0.75rem" }}>
            <li>A taxa de R$50/semana é acumulada e <strong>incluída na fatura do mês seguinte</strong></li>
            <li>Se pausar todas as campanhas, a taxa <strong>para imediatamente</strong></li>
            <li>Nenhuma campanha ativa no mês = R$0 de taxa</li>
          </ul>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>3. Investimento em Mídia</h3>
          <ul style={{ paddingLeft: "1.2rem", margin: "0 0 0.75rem" }}>
            <li>O valor investido em anúncios vai <strong>direto para a Meta (Facebook/Instagram)</strong> na sua conta</li>
            <li>O FireHub <strong>não retém</strong> nenhuma parte do investimento em mídia</li>
            <li>Você define o orçamento semanal e pode alterar a qualquer momento</li>
          </ul>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem" }}>4. Resultados e ROAS</h3>
          <p>O <strong>ROAS</strong> (Retorno sobre o Investimento em Anúncios) varia de acordo com:</p>
          <ul style={{ paddingLeft: "1.2rem", margin: "4px 0 0.75rem" }}>
            <li>Qualidade e apresentação do seu cardápio (fotos, descrições)</li>
            <li>Atendimento ao cliente e velocidade de entrega</li>
            <li>Preços competitivos para a sua região</li>
            <li>Demanda do mercado local e concorrência</li>
          </ul>
          <p>Os primeiros dias são de <strong>aprendizado do algoritmo</strong>. Recomendamos manter a campanha ativa por pelo menos <strong>30 dias</strong> antes de avaliar os resultados.</p>

          <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.75rem", marginTop: "1.25rem" }}>5. Exemplos Práticos</h3>
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "0.85rem" }}>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "#92400E" }}>
              <li>Ativou campanha na segunda e pausou na quinta (4 dias) → <strong>R$50</strong></li>
              <li>Manteve campanha ativa por 3 semanas → <strong>R$150</strong></li>
              <li>Nenhuma campanha ativa no mês → <strong>R$0</strong></li>
            </ul>
          </div>
          {/* Sentinela do fim do texto: quando ela aparece, a leitura está
              cumprida. É o que libera a trava por qualquer forma de rolagem. */}
          <div data-fim-dos-termos style={{ height: 1 }} />
        </div>

        {!termsScrolled && (
          <div style={{ textAlign: "center", fontSize: "0.82rem", color: "#9CA3AF", marginBottom: "0.75rem" }}>↓ Role até o final para aceitar os termos</div>
        )}

        {/* O <label> não tinha htmlFor nem input dentro, e o onClick vivia só no
            quadrado de 22x22 — irmão do texto, não ancestral. Tocar na frase (o
            alvo natural, e o único confortável no celular) não fazia nada, e não
            havia caminho de teclado nenhum: quem usa teclado ou leitor de tela
            ficava trancado fora do módulo, num portão obrigatório. O handler sobe
            para a linha inteira e o div vira um checkbox de verdade para o
            teclado e para a acessibilidade. */}
        <div
          role="checkbox"
          aria-checked={termsAccepted}
          aria-disabled={!termsScrolled}
          tabIndex={termsScrolled ? 0 : -1}
          onClick={() => termsScrolled && setTermsAccepted(v => !v)}
          onKeyDown={(e) => {
            if (!termsScrolled) return;
            if (e.key === " " || e.key === "Enter") { e.preventDefault(); setTermsAccepted(v => !v); }
          }}
          style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", cursor: termsScrolled ? "pointer" : "not-allowed", opacity: termsScrolled ? 1 : 0.5, background: "#fff", border: `1.5px solid ${termsAccepted ? "#EF4444" : "#E5E7EB"}`, borderRadius: 12, padding: "1rem", marginBottom: "1rem", userSelect: "none" }}
        >
          <div aria-hidden style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${termsAccepted ? "#EF4444" : "#D1D5DB"}`, background: termsAccepted ? "#EF4444" : "#fff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s", marginTop: 2 }}>
            {termsAccepted && <Check size={13} color="#fff" />}
          </div>
          <span style={{ fontSize: "0.88rem", lineHeight: 1.6 }}>Li e aceito os termos acima. Entendo que a <strong>taxa de R$50/semana é pelo serviço de gestão</strong>, não por resultados. O ROAS depende da qualidade do meu produto, atendimento e mercado local.</span>
        </div>

        <button onClick={() => setStep("method")} disabled={!termsAccepted}
          style={{ width: "100%", background: termsAccepted ? "#EF4444" : "#E5E7EB", color: termsAccepted ? "#fff" : "#9CA3AF", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: termsAccepted ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
          Aceito os termos — Continuar →
        </button>
      </div>
    );
  }

  /* ═══════ METHOD ═══════ */
  if (step === "method") return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("terms")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}><span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "4px 12px", borderRadius: 99 }}>TRÁFEGO PAGO + FIREHUB</span></div>
      <h2 style={{ textAlign: "center", fontSize: "1.8rem", fontWeight: 900, marginBottom: "0.5rem" }}>Como deseja configurar?</h2>
      <p style={{ textAlign: "center", color: "#6B7280", marginBottom: "2rem" }}>Escolha a modalidade que funciona melhor pra você.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
        {[
          { title: "Configuração Acompanhada", desc: "Um especialista FireHub configura com você via WhatsApp", href: "https://wa.me/5522998851680?text=Oi%20quero%20ajuda%20para%20configurar%20o%20trafego%20pago%20do%20firehub%20na%20minha%20loja" },
          { title: "Configurar Sozinho", desc: "Configure no seu ritmo, passo a passo em menos de 5 minutos", action: () => setStep("invest") },
        ].map((opt, i) => (
          <div key={i} onClick={() => opt.action ? opt.action() : window.open(opt.href, "_blank")}
            style={{ border: "1.5px solid #E5E7EB", borderRadius: 14, padding: "1.25rem", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", transition: "border-color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "#EF4444")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#E5E7EB")}>
            <div><div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: 4 }}>{opt.title}</div><div style={{ fontSize: "0.82rem", color: "#6B7280" }}>{opt.desc}</div></div>
            <ChevronRight size={18} color="#9CA3AF" style={{ flexShrink: 0, marginLeft: 8 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem" }}>
        {FEATURES.map(f => (
          <div key={f.label} style={{ background: "#F9FAFB", borderRadius: 10, padding: "0.6rem 0.75rem", display: "flex", alignItems: "center", gap: 8 }}>
            <f.icon size={15} color="#EF4444" style={{ flexShrink: 0 }} />
            <div><div style={{ fontSize: "0.78rem", fontWeight: 700 }}>{f.label}</div><div style={{ fontSize: "0.7rem", color: "#6B7280" }}>{f.desc}</div></div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ═══════ INVEST ═══════ */
  const BUDGET_PRESETS = [100, 150, 200, 300, 500, 1000];
  if (step === "invest") return (
    <div style={{ maxWidth: 500, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <button onClick={() => setStep("method")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>Investimento semanal</h2>
      <p style={{ color: "#6B7280", marginBottom: "2rem" }}>Quanto você quer investir por semana? A IA otimiza cada real.</p>
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "2rem", textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ marginBottom: "0.25rem", color: "#6B7280", fontSize: "0.85rem" }}>Investimento semanal em anúncios</div>
        <div style={{ fontSize: "3rem", fontWeight: 900, color: "#111", marginBottom: "1rem" }}>R$ <span>{investment}</span></div>
        {/* Presets rápidos */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: "1.25rem" }}>
          {BUDGET_PRESETS.map(v => (
            <button key={v} onClick={() => setInvestment(v)}
              style={{
                padding: "6px 14px", borderRadius: 8, border: investment === v ? "2px solid #EF4444" : "1.5px solid #E5E7EB",
                background: investment === v ? "#FEF2F2" : "#fff", fontWeight: 700, fontSize: "0.82rem",
                cursor: "pointer", color: investment === v ? "#EF4444" : "#374151", transition: "all 0.15s",
                position: "relative",
              }}>
              R${v}
              {v === 150 && <span style={{ position: "absolute", top: -8, right: -4, background: "#16A34A", color: "#fff", fontSize: "0.55rem", fontWeight: 800, padding: "1px 5px", borderRadius: 6, whiteSpace: "nowrap" }}>⭐ Popular</span>}
            </button>
          ))}
        </div>
        <input type="range" min={100} max={2000} step={50} value={investment} onChange={e => setInvestment(Number(e.target.value))} style={{ width: "100%", accentColor: "#EF4444", height: 6, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#9CA3AF", marginTop: 6 }}><span>R$ 100</span><span>R$ 2.000</span></div>
      </div>
      {/* Estimativas */}
      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem", marginBottom: "0.75rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
          {/* "Retorno estimado = investimento × 4,72" saiu daqui.
              Era promessa de resultado financeiro calculada sobre um ROAS
              inventado no código — quem investisse R$ 200 lia "≈ R$ 944". Sem
              nenhum dado por trás, isso é o tipo de número que volta como
              reclamação, e com razão.
              O alcance fica, porque é estimativa de ENTREGA (quantas pessoas o
              valor alcança), não de retorno — e é a conta que a própria Meta
              usa. Mesmo assim vai marcado como estimativa. */}
          <div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>Alcance estimado</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#3B82F6" }}>≈ {(investment * 85).toLocaleString("pt-BR")}</div>
            <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>pessoas na sua região</div>
          </div>
          <div>
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>Gestão FireHub</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#111" }}>R$ 50<span style={{ fontSize: "0.8rem", fontWeight: 600 }}>/semana</span></div>
            <div style={{ fontSize: "0.65rem", color: "#9CA3AF" }}>cobrado só enquanto ativo</div>
          </div>
        </div>
        <div style={{ fontSize: "0.68rem", color: "#9CA3AF", marginTop: 8, lineHeight: 1.4, borderTop: "1px solid #BBF7D0", paddingTop: 8, textAlign: "center" }}>
          ⚠️ O alcance é uma estimativa e varia com concorrência e público. Não prometemos
          número de pedidos: o resultado depende das suas <strong>fotos</strong>, <strong>preços</strong> e
          <strong> mercado local</strong>. Você acompanha os números reais aqui no painel.
        </div>
      </div>
      <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 12, padding: "0.85rem 1rem", marginBottom: "1.5rem", fontSize: "0.82rem", color: "#991B1B", lineHeight: 1.6 }}>
        🔴 <strong>Taxa de gestão:</strong> R$ 50/semana pelo serviço de criação, otimização e monitoramento. <strong>Ativou = cobra</strong>, independente do retorno em vendas.
      </div>
      {/* Duas correções nesta porta:
          1. O gate era `connected` — presença de token na coluna. Quem fez o
             OAuth sem ter conta de anúncios recebia o token gravado e o erro
             "crie a conta e reconecte": ao voltar, esta linha o mandava direto
             ao criativo, ele montava tudo e a publicação era recusada. Agora o
             gate exige conta de anúncios, então a tela de conexão volta a ser
             alcançável — é ela que refaz o OAuth.
          2. `handleGenerateCopy()` rodava incondicionalmente. Quem escrevia o
             próprio anúncio, voltava só para ajustar o valor e avançava, perdia
             o texto para uma sugestão nova da IA, sem aviso e sem desfazer. A
             auto-geração da primeira visita continua no useEffect. */}
      <button onClick={() => conexaoUtilizavel ? (handleGenerateCopy(true), setStep("creative")) : setStep("connect")} style={{ width: "100%", background: "#EF4444", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        Confirmar R$ {investment}/semana <ChevronRight size={18} />
      </button>
    </div>
  );
  /* ═══════ CONNECT ═══════ */
  if (step === "connect") return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <AvisoDeConfiguracao />
      <button onClick={() => setStep("invest")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 900, marginBottom: "0.25rem" }}>{connected ? "Reconectar Facebook" : "Conectar Facebook"}</h2>
      <p style={{ color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Conecte sua página do Facebook para que a IA crie os anúncios na <strong>sua conta</strong>.</p>
      {/* Este é o estado que travava o módulo no DIA UM: o callback grava o
          token e só depois volta com o erro, então a tela passava a achar que
          estava tudo conectado e nunca mais oferecia a conexão. O lojista cria o
          que falta no Facebook e volta aqui para refazer o OAuth. */}
      {connected && (!temContaDeAnuncios || !temPagina) && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "0.9rem 1rem", marginBottom: "1rem", fontSize: "0.84rem", color: "#92400E", lineHeight: 1.55 }}>
          Seu Facebook está conectado, mas falta o seguinte para o anúncio poder ser publicado:
          <ul style={{ margin: "6px 0 8px", paddingLeft: "1.2rem" }}>
            {!temContaDeAnuncios && (
              <li>
                <strong>uma conta de anúncios</strong> —{" "}
                <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noopener noreferrer" style={{ color: "#92400E", fontWeight: 800 }}>
                  crie no Gerenciador de Anúncios
                </a>
              </li>
            )}
            {!temPagina && (
              <li>
                <strong>uma Página do Facebook</strong> para o restaurante — o anúncio é publicado por
                uma Página.{" "}
                <a href="https://www.facebook.com/pages/create" target="_blank" rel="noopener noreferrer" style={{ color: "#92400E", fontWeight: 800 }}>
                  criar Página
                </a>
              </li>
            )}
          </ul>
          Depois de criar, volte aqui e conecte de novo — é o botão abaixo.
        </div>
      )}
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          {[
            { n: "1", title: "Conecte sua página", desc: "Faça login no Facebook" },
            { n: "2", title: "Autorize o FireHub", desc: "Permita que a IA gerencie seus anúncios" },
            { n: "3", title: "Configure seu anúncio", desc: "Escolha imagem, confirme o texto e publique" },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < 2 ? "1rem" : 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#EF4444", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 800, flexShrink: 0 }}>{s.n}</div>
              <div><div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.title}</div><div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{s.desc}</div></div>
            </div>
          ))}
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "0.6rem 0.85rem", marginBottom: "1rem", fontSize: "0.82rem", color: "#166534", fontWeight: 600 }}>
          ✅ O pagamento dos anúncios é feito direto pela sua conta do Meta
        </div>
        {/* `disabled` quando falta credencial no servidor: sem isto o clique
            levava a uma página de erro 500 crua do Next, sem explicação. */}
        <button onClick={handleConnectFacebook} disabled={needsSetup} style={{ width: "100%", background: needsSetup ? "#E5E7EB" : "#1877F2", color: needsSetup ? "#9CA3AF" : "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: needsSetup ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "0.75rem" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          {connected ? "Conectar de novo com o Facebook" : "Conectar com Facebook"}
        </button>
        <div style={{ fontSize: "0.72rem", color: "#9CA3AF", textAlign: "center" }}>🔒 Seus dados são seguros. O FireHub nunca publica nada sem sua autorização.</div>
      </div>
      <div style={{ marginTop: "1.5rem", background: "#F9FAFB", borderRadius: 12, padding: "1rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.75rem" }}>Perguntas frequentes</div>
        {[
          { q: "Quem paga os anúncios?", a: "Você. O valor é cobrado pela Meta na sua conta. O FireHub cobra R$50/semana de gestão." },
          { q: "Preciso ter uma página no Facebook?", a: "Sim. Se não tiver, crie uma em 2 minutos." },
          { q: "Posso pausar?", a: "Sim! Pause ou cancele direto pelo painel, sem multas." },
        ].map((faq, i) => (
          <div key={i} style={{ marginBottom: i < 2 ? "0.75rem" : 0 }}>
            <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#374151" }}>{faq.q}</div>
            <div style={{ fontSize: "0.78rem", color: "#6B7280", lineHeight: 1.5 }}>{faq.a}</div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ═══════ CREATIVE (NOVO!) ═══════ */
  if (step === "creative") return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      {/* "commitment" está no union mas nunca teve tela: voltar para lá caía
          no dashboard vazio. O passo anterior real do criativo é o investimento. */}
      <button onClick={() => setStep("invest")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#6B7280", marginBottom: "1.5rem", fontSize: "0.9rem" }}><ArrowLeft size={16} /> Voltar</button>
      <h2 style={{ fontSize: "1.6rem", fontWeight: 900, marginBottom: "0.25rem" }}>Configure seu anúncio</h2>
      <p style={{ color: "#6B7280", marginBottom: "2rem", fontSize: "0.9rem" }}>Escolha a imagem e confirme o texto. A IA já sugeriu um texto otimizado para você.</p>

      {/* ── A CONTA CONSEGUE VEICULAR? ────────────────────────────────────────
          Esta checagem só existia no painel — DEPOIS de publicar e DEPOIS de os
          R$ 50 da semana já estarem na fatura. Numa conta pré-paga com saldo
          zero, ou sem forma de pagamento, a Meta aceita criar e ativar tudo e
          simplesmente não entrega: o lojista pagava pela gestão de um anúncio
          que nunca apareceu para ninguém. Agora o aviso vem ANTES do botão que
          cobra, com o caminho de conserto do lado. */}
      {bloqueioDaConta && (
        <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 14, padding: "1rem 1.15rem", marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, color: "#991B1B", fontSize: "0.92rem", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} /> Sua conta do Facebook ainda não consegue veicular
          </div>
          <div style={{ fontSize: "0.84rem", color: "#991B1B", lineHeight: 1.55, marginBottom: 10 }}>
            {bloqueioDaConta}
            <br />
            <strong>Nada foi cobrado.</strong> Publicar agora criaria uma campanha que não sairia no ar —
            e a gestão de R$ 50 seria lançada do mesmo jeito.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {precisaReconectar && <BotaoReconectar destaque />}
            {!precisaReconectar && linkDaConta && (
              <a href={linkDaConta} target="_blank" rel="noopener noreferrer"
                style={{ background: "#DC2626", color: "#fff", padding: "11px 18px", borderRadius: 10, fontSize: "0.85rem", fontWeight: 800, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}>
                Resolver no Facebook <ExternalLink size={14} />
              </a>
            )}
            <button type="button" onClick={() => { void atualizarProntidao(); }}
              style={{ background: "#fff", border: "1.5px solid #FCA5A5", color: "#991B1B", padding: "11px 18px", borderRadius: 10, fontSize: "0.85rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}>
              <RefreshCw size={14} /> Já resolvi — verificar de novo
            </button>
          </div>
        </div>
      )}

      {/* ── Imagem ── */}
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
          <ImageIcon size={18} color="#EF4444" /> Imagem do anúncio
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: "1rem", background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
          {([
            { key: "menu" as const, label: "Do cardápio", icon: "🍔" },
            { key: "upload" as const, label: "Upload", icon: "📸" },
            { key: "ai" as const, label: "Gerar com IA", icon: "🤖" },
          ]).map(t => (
            <button key={t.key} onClick={() => setImageTab(t.key)}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "none", background: imageTab === t.key ? "#fff" : "transparent", fontWeight: imageTab === t.key ? 700 : 500, fontSize: "0.82rem", cursor: "pointer", boxShadow: imageTab === t.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Menu */}
        {imageTab === "menu" && (
          <div>
            {/* A aba padrão é esta, e a busca das fotos já rodou sozinha ao abrir
                o passo. Reapresentar "Carregar fotos do cardápio" depois de a
                busca ter voltado VAZIA era um laço: o lojista clicava, o botão
                voltava igual, e nada dizia que o cardápio dele não tem foto
                nenhuma — enquanto o Publicar exige imagem. Cardápio sem fotos é
                o caso comum, não a exceção. */}
            {productImages.length === 0 && !generatingCopy && cardapioCarregado ? (
              <div style={{ textAlign: "center", padding: "1.5rem 1rem", color: "#6B7280" }}>
                <ImageIcon size={30} color="#D1D5DB" style={{ margin: "0 auto 10px" }} />
                <div style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>Seu cardápio ainda não tem fotos</div>
                <div style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: 14 }}>
                  O anúncio precisa de uma imagem. Envie uma foto do seu celular ou gere uma com IA —
                  as duas opções funcionam agora, sem mexer no cardápio.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={() => setImageTab("upload")}
                    style={{ background: "#EF4444", color: "#fff", border: "none", padding: "10px 18px", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}>
                    📸 Enviar uma foto
                  </button>
                  <button onClick={() => setImageTab("ai")}
                    style={{ background: "#fff", border: "1.5px solid #8B5CF6", color: "#8B5CF6", padding: "10px 18px", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}>
                    🤖 Gerar com IA
                  </button>
                </div>
              </div>
            ) : productImages.length === 0 && !generatingCopy ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6B7280" }}>
                <button onClick={() => handleGenerateCopy(true)} style={{ background: "#EF4444", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}>
                  Carregar fotos do cardápio
                </button>
              </div>
            ) : generatingCopy ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#6B7280" }}>
                <div style={{ width: 32, height: 32, border: "3px solid #E5E7EB", borderTopColor: "#EF4444", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Carregando fotos...
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 8 }}>
                {productImages.map((p, i) => (
                  <div key={i} onClick={() => { setSelectedImage(p.imageUrl); setUploadPreview(""); }}
                    style={{ border: `2px solid ${selectedImage === p.imageUrl ? "#EF4444" : "#E5E7EB"}`, borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color 0.2s", position: "relative" }}>
                    <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: 100, objectFit: "cover" }} />
                    <div style={{ padding: "6px 8px", fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    {selectedImage === p.imageUrl && (
                      <div style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", background: "#EF4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={13} color="#fff" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Upload */}
        {imageTab === "upload" && (
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
            {/* `enviandoImagem` existia e nunca era lido: durante o envio (upload
                da foto do celular + redimensionamento para 1080x1080 no servidor,
                vários segundos no 4G) a área ficava IDÊNTICA a antes do clique.
                O lojista achava que não funcionou e tocava de novo, disparando um
                segundo envio concorrente. */}
            {enviandoImagem ? (
              <div style={{ border: "2px dashed #EF4444", borderRadius: 12, padding: "2.5rem", textAlign: "center", background: "#FEF2F2" }}>
                <div style={{ width: 32, height: 32, border: "3px solid #FECACA", borderTopColor: "#EF4444", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                <div style={{ fontWeight: 700, color: "#991B1B", marginBottom: 4 }}>Enviando imagem...</div>
                <div style={{ fontSize: "0.78rem", color: "#B91C1C" }}>Estamos ajustando a foto para o formato do anúncio. Não feche a página.</div>
              </div>
            ) : uploadPreview ? (
              <div style={{ textAlign: "center" }}>
                <img src={uploadPreview} alt="Preview" style={{ maxHeight: 200, borderRadius: 12, marginBottom: 12, border: "2px solid #EF4444" }} />
                <br />
                <button onClick={() => fileInputRef.current?.click()} style={{ background: "#F1F5F9", border: "none", padding: "8px 16px", borderRadius: 8, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" }}>Trocar imagem</button>
              </div>
            ) : (
              <div onClick={() => fileInputRef.current?.click()}
                style={{ border: "2px dashed #D1D5DB", borderRadius: 12, padding: "2.5rem", textAlign: "center", cursor: "pointer", transition: "border-color 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "#EF4444")} onMouseLeave={e => (e.currentTarget.style.borderColor = "#D1D5DB")}>
                <Upload size={32} color="#9CA3AF" style={{ margin: "0 auto 8px" }} />
                <div style={{ fontWeight: 700, color: "#374151", marginBottom: 4 }}>Clique para enviar uma imagem</div>
                <div style={{ fontSize: "0.78rem", color: "#9CA3AF" }}>JPG, PNG ou WEBP — máx 5MB</div>
              </div>
            )}
          </div>
        )}

        {/* Tab: IA — 10 gerações por semana incluídas no pacote */}
        {imageTab === "ai" && (
          <div style={{ padding: "1.25rem", background: "#F9FAFB", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Sparkles size={20} color="#8B5CF6" />
              <div style={{ fontWeight: 700 }}>Criar imagem com IA</div>
            </div>

            <div style={{ fontSize: "0.8rem", color: "#6B7280", marginBottom: 12, lineHeight: 1.5 }}>
              Descreva a cena que você quer. A IA cria uma foto de apresentação para o anúncio.
              <br />
              <strong style={{ color: "#B45309" }}>Importante:</strong> a imagem é ilustrativa. Para mostrar
              o prato exato que você entrega, prefira a foto do seu cardápio — anunciar um prato
              diferente do real gera reclamação do cliente.
            </div>

            <textarea
              value={descricaoIA}
              onChange={(e) => setDescricaoIA(e.target.value.slice(0, 300))}
              placeholder="Ex.: hambúrguer artesanal com fritas, sobre tábua de madeira"
              rows={2}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E5E7EB", fontSize: "0.86rem", fontFamily: "inherit", resize: "vertical", marginBottom: 10 }}
            />

            <button
              onClick={handleGerarImagemIA}
              disabled={gerandoImagem || cotaRestante === 0}
              style={{ width: "100%", background: (gerandoImagem || cotaRestante === 0) ? "#E5E7EB" : "#8B5CF6", color: (gerandoImagem || cotaRestante === 0) ? "#9CA3AF" : "#fff", border: "none", padding: "12px", borderRadius: 10, fontWeight: 700, fontSize: "0.9rem", cursor: (gerandoImagem || cotaRestante === 0) ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {gerandoImagem ? "Criando imagem..." : cotaRestante === 0 ? "Cota da semana esgotada" : "✨ Gerar imagem"}
            </button>

            <div style={{ fontSize: "0.74rem", color: "#9CA3AF", marginTop: 8, textAlign: "center" }}>
              {cotaRestante === null
                ? "10 imagens por semana incluídas no seu plano"
                : `${cotaRestante} de 10 imagens restantes nesta semana`}
              {cotaRestante === 0 && " · a cota volta na segunda-feira"}
            </div>

            <div style={{ fontSize: "0.74rem", color: "#6B7280", marginTop: 10, textAlign: "center" }}>
              Fotos do cardápio e imagens que você envia <strong>não têm limite</strong>.
            </div>
          </div>
        )}
      </div>

      {/* ── Texto do anúncio ── */}
      <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <Edit3 size={18} color="#EF4444" /> Texto do anúncio
          </div>
          {/* Aqui a sobrescrita é o que o lojista PEDIU — passa sem preservar.
              (Sem a arrow, o onClick entregaria o evento como primeiro argumento
              e o texto seria preservado justamente onde ele quer um novo.) */}
          <button onClick={() => handleGenerateCopy()} disabled={generatingCopy}
            style={{ background: "#F1F5F9", border: "none", padding: "6px 12px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: generatingCopy ? 0.5 : 1 }}>
            <Sparkles size={13} /> {generatingCopy ? "Gerando..." : "Gerar com IA"}
          </button>
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.78rem", color: "#6B7280", fontWeight: 600, display: "block", marginBottom: 4 }}>Texto principal</label>
          <textarea value={adCopy} onChange={e => setAdCopy(e.target.value)} rows={3}
            placeholder="Ex: 🍔 Peça agora! Entrega rápida na sua região..."
            style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={{ fontSize: "0.78rem", color: "#6B7280", fontWeight: 600, display: "block", marginBottom: 4 }}>Descrição curta</label>
          <input value={adDescription} onChange={e => setAdDescription(e.target.value)}
            placeholder="Ex: Delivery rápido com cardápio completo..."
            style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>
      </div>

      {/* ── Preview do anúncio ── */}
      {(selectedImage || uploadPreview) && adCopy && (
        <div style={{ background: "#fff", border: "1.5px solid #E5E7EB", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 8 }}>
            <Eye size={18} color="#EF4444" /> Preview do anúncio
          </div>
          <div style={{ border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", maxWidth: 400, margin: "0 auto" }}>
            <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#EF4444", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.8rem" }}>
                {(user.storeName || "R")[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{user.storeName || "Restaurante"}</div>
                <div style={{ fontSize: "0.7rem", color: "#6B7280" }}>Patrocinado · 🌐</div>
              </div>
            </div>
            <div style={{ padding: "0 12px 8px", fontSize: "0.85rem", lineHeight: 1.5 }}>{adCopy}</div>
            <img src={selectedImage || uploadPreview} alt="Ad preview" style={{ width: "100%", height: 200, objectFit: "cover" }} />
            <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #E5E7EB" }}>
              <div style={{ fontSize: "0.78rem", color: "#6B7280" }}>{adDescription || "Saiba mais"}</div>
              <button style={{ background: "#EF4444", color: "#fff", border: "none", padding: "6px 16px", borderRadius: 6, fontSize: "0.78rem", fontWeight: 700 }}>Pedir agora</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resumo + Publicar ── */}
      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>💰 Investimento semanal:</span><strong>R$ {investment}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span>🔧 Taxa de gestão FireHub:</span><strong>R$ 50/semana</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #BBF7D0", paddingTop: 8, marginTop: 4 }}><span style={{ fontWeight: 700 }}>Total semanal:</span><strong style={{ color: "#16A34A" }}>R$ {investment + 50}</strong></div>
        {/* O valor sai daqui direto para a Meta e para a fatura. Se o lojista
            chegou por "+ Nova campanha" e o número não é o que ele quer, o
            conserto tem que estar ao lado do total — não escondido no Voltar. */}
        <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: 8, lineHeight: 1.5, borderTop: "1px solid #BBF7D0", paddingTop: 8 }}>
          Ao publicar, os R$ 50 de gestão desta semana entram na sua fatura.{" "}
          <button type="button" onClick={() => setStep("invest")}
            style={{ background: "none", border: "none", padding: 0, color: "#15803D", fontWeight: 800, textDecoration: "underline", cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit" }}>
            Alterar o investimento
          </button>
        </div>
      </div>

      {/* `bloqueioDaConta` entra no disabled: o botão que lança a cobrança não
          pode ficar clicável quando o servidor já respondeu que a conta não
          veicula — seria cobrar por um anúncio que nunca apareceria. */}
      <button onClick={handleCreateCampaign} disabled={creatingCampaign || Boolean(bloqueioDaConta) || (!selectedImage && !uploadPreview) || !adCopy.trim()}
        style={{ width: "100%", background: (bloqueioDaConta || (!selectedImage && !uploadPreview) || !adCopy.trim()) ? "#E5E7EB" : "#EF4444", color: (bloqueioDaConta || (!selectedImage && !uploadPreview) || !adCopy.trim()) ? "#9CA3AF" : "#fff", border: "none", padding: "16px", borderRadius: 12, fontSize: "1.1rem", fontWeight: 800, cursor: (bloqueioDaConta || (!selectedImage && !uploadPreview) || !adCopy.trim()) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}>
        {creatingCampaign ? (
          <><RefreshCw size={18} style={{ animation: "spin 1s linear infinite" }} /> Criando campanha...</>
        ) : bloqueioDaConta ? (
          <>Resolva a pendência da conta para publicar</>
        ) : (
          <>🚀 Publicar campanha</>
        )}
      </button>
    </div>
  );

  /* ═══════ DASHBOARD ═══════ */
  const activeCampaigns = campaigns.filter(c => c.status === "ACTIVE");
  const pausedCampaigns = campaigns.filter(c => c.status === "PAUSED");
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const totalOrders = campaigns.reduce((s, c) => s + (c.ordersGenerated ?? 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.revenue ?? 0), 0);
  const roasNum = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const overallRoas = totalSpend > 0 ? roasNum.toFixed(1) : "—";
  const roasBarPct = Math.min(roasNum / 6 * 100, 100); // 6x = barra cheia

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 4rem" }}>
      <Banner />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:640px){.dash-kpis{grid-template-columns:repeat(2,1fr)!important}.dash-campaign-metrics{grid-template-columns:repeat(2,1fr)!important}.dash-info-grid{grid-template-columns:1fr!important}}`}</style>

      {/* Header */}
      <div style={{ background: activeCampaigns.length > 0 ? "linear-gradient(135deg,#EF4444,#DC2626)" : "linear-gradient(135deg,#F59E0B,#D97706)", borderRadius: 16, padding: "1.5rem", color: "#fff", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Zap size={20} />
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1.2rem" }}>Tráfego Pago {activeCampaigns.length > 0 ? "🔥" : "⏸️"}</h2>
              <span style={{ background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: 6, fontSize: "0.65rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                <Bot size={11} /> Gerenciado por IA
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.85 }}>
              {activeCampaigns.length} campanha(s) ativa(s) · {pausedCampaigns.length} pausada(s)
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: "0.72rem", opacity: 0.7 }}><Wifi size={10} /> Atualiza a cada 60s</span>
            </p>
          </div>
          {/* Três defeitos neste botão:
              1. ia direto ao criativo, pulando o passo do valor — e `investment`
                 vale 100 num painel recém-carregado, então quem rodava R$ 300
                 publicava R$ 100 sem nunca ver uma tela de valor;
              2. com campanha ATIVA, o servidor só recusa no clique final: o
                 lojista montava o criativo inteiro e queimava cota de imagem por
                 IA para receber "você já tem uma campanha ativa";
              3. limpava a copy e as fotos antes de saber se ia poder publicar. */}
          <button
            disabled={activeCampaigns.length > 0}
            title={activeCampaigns.length > 0 ? "Pause a campanha ativa antes de criar outra" : "Criar uma nova campanha"}
            onClick={() => {
              hasAutoGenerated.current = false;
              setAdCopy(""); setAdDescription(""); setSelectedImage(""); setUploadPreview("");
              setProductImages([]); setCardapioCarregado(false);
              // Começa no valor que a loja já usa, não em R$ 100 fixos.
              const ultimo = campaigns[0]?.weeklyBudget;
              if (ultimo && ultimo > 0) { setInvestment(ultimo); setNewBudget(ultimo); }
              setStep("invest");
            }}
            style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, padding: "8px 16px", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: activeCampaigns.length > 0 ? "not-allowed" : "pointer", opacity: activeCampaigns.length > 0 ? 0.55 : 1, display: "flex", alignItems: "center", gap: 6 }}>
            + Nova campanha
          </button>
        </div>
        {activeCampaigns.length > 0 && (
          <div style={{ fontSize: "0.72rem", opacity: 0.85, marginTop: 10 }}>
            Só roda uma campanha por vez. Para criar outra, pause a que está ativa abaixo.
          </div>
        )}
      </div>

      {/* ── SAÍDA SEMPRE DISPONÍVEL ──────────────────────────────────────────
          O painel não tinha NENHUM botão de reconectar, e a única porta para a
          tela de conexão estava atrás de "ainda não conectou" — condição que
          nunca mais volta a ser verdadeira, porque nada limpa o token. Token
          vencido (60 dias) ou app revogado deixavam o módulo inutilizável: as
          métricas congelavam mostrando "✅ Ativo", publicar falhava, pausar
          falhava, e a campanha seguia gastando na Meta. */}
      {(precisaReconectar || metricasVelhas) && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "1rem 1.15rem", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontWeight: 800, color: "#92400E", fontSize: "0.88rem", marginBottom: 3 }}>
              {precisaReconectar ? "Sua conexão com o Facebook precisa ser refeita" : "Os números abaixo podem estar desatualizados"}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#92400E", lineHeight: 1.5 }}>
              {precisaReconectar
                ? "Enquanto ela não for refeita, pausar, retomar e publicar podem falhar — e a campanha continua rodando (e gastando) no Facebook."
                : "O Facebook não respondeu na última atualização. Se isso continuar, refaça a conexão."}
            </div>
          </div>
          <BotaoReconectar destaque={precisaReconectar} />
        </div>
      )}

      {/* KPIs totais */}
      <div className="dash-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        {[
          { label: "Total investido", value: `R$ ${totalSpend.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "#3B82F6", icon: DollarSign },
          { label: "Pedidos gerados", value: totalOrders.toLocaleString("pt-BR"), color: "#10B981", icon: CheckCircle },
          { label: "Receita atribuída", value: `R$ ${totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: "#8B5CF6", icon: TrendingUp },
          { label: "ROAS geral", value: `${overallRoas}x`, color: "#EF4444", icon: BarChart2 },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <k.icon size={14} color={k.color} />
              <span style={{ fontSize: "0.7rem", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</span>
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 900, color: k.color, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ROAS visual bar */}
      {totalSpend > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#374151" }}>💰 Retorno sobre Investimento (ROAS)</span>
            <span style={{ fontSize: "0.82rem", fontWeight: 800, color: roasNum >= 2 ? "#16A34A" : roasNum >= 1 ? "#F59E0B" : "#EF4444" }}>
              {overallRoas}x {roasNum >= 3 ? "🔥" : roasNum >= 1 ? "📈" : "⏳"}
            </span>
          </div>
          <div style={{ background: "#F1F5F9", borderRadius: 8, height: 12, overflow: "hidden", position: "relative" }}>
            <div style={{
              width: `${roasBarPct}%`, height: "100%", borderRadius: 8,
              background: roasNum >= 2 ? "linear-gradient(90deg,#22C55E,#16A34A)" : roasNum >= 1 ? "linear-gradient(90deg,#F59E0B,#D97706)" : "linear-gradient(90deg,#EF4444,#DC2626)",
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#9CA3AF", marginTop: 4 }}>
            <span>0x</span>
            <span>Investiu R${totalSpend.toFixed(0)} → Faturou R${totalRevenue.toFixed(0)}</span>
            <span>6x+</span>
          </div>
        </div>
      )}

      {/* ── SALDO DA CONTA DE ANÚNCIOS ────────────────────────────────────
          Sem isto o lojista só percebe que o crédito acabou quando estranha que
          parou de vender: o Facebook simplesmente para de veicular, sem avisar
          ninguém. E o pior — a gestão de R$50/semana continua sendo cobrada. */}
      {contaMeta?.conectado && (
        <div style={{
          background: contaMeta.pronto ? "#F0FDF4" : "#FEF2F2",
          border: `1.5px solid ${contaMeta.pronto ? "#BBF7D0" : "#FCA5A5"}`,
          borderRadius: 14, padding: "1rem 1.15rem", marginBottom: "1.25rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              {/* Os ramos de falha do /status NÃO devolvem `carteira`. Sem esta
                  guarda, "cartão recusado" e "conta desativada" caíam no ramo do
                  pré-pago e apareciam como saldo "R$ —" com a legenda "sem saldo",
                  contradizendo a explicação certa logo abaixo e mandando o lojista
                  procurar um problema que não era o dele. */}
              {contaMeta.carteira ? (
                <>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>
                    {contaMeta.carteira.cobrancaAutomatica ? "Forma de pagamento" : "Crédito na sua conta do Facebook"}
                  </div>
                  {contaMeta.carteira.cobrancaAutomatica ? (
                    <>
                      <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#166534" }}>
                        {contaMeta.carteira.formaDePagamento || "Cartão cadastrado"}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "#15803D" }}>
                        O Facebook cobra automaticamente — você não precisa recarregar
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: "1.6rem", fontWeight: 900, color: contaMeta.pronto ? "#166534" : "#991B1B" }}>
                        {typeof contaMeta.carteira.saldoDisponivel === "number"
                          ? `R$ ${contaMeta.carteira.saldoDisponivel.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "—"}
                      </div>
                      <div style={{ fontSize: "0.72rem", color: contaMeta.pronto ? "#15803D" : "#991B1B" }}>
                        {contaMeta.pronto ? "disponível para anúncios" : (ROTULO_DO_PROBLEMA[proximoPasso] || "os anúncios não vão rodar")}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: "0.72rem", color: "#6B7280", marginBottom: 2 }}>Conta de anúncios</div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 900, color: contaMeta.pronto ? "#166534" : "#991B1B", lineHeight: 1.35 }}>
                    {contaMeta.pronto ? "Pronta para veicular" : (ROTULO_DO_PROBLEMA[proximoPasso] || "Pendência na sua conta do Facebook")}
                  </div>
                </>
              )}

              {typeof contaMeta.carteira?.totalGasto === "number" && (
                <div style={{ fontSize: "0.7rem", color: "#9CA3AF", marginTop: 6 }}>
                  Total já investido em anúncios: R$ {contaMeta.carteira.totalGasto.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
            </div>

            {/* O botão lia SÓ `linkParaRecarregar`, que o /status devolve apenas
                no caminho feliz. Nos ramos de falha a chave é `linkParaResolver`
                — ou seja, exatamente quando o lojista pagava R$ 50/semana e nada
                veiculava, o card ficava vermelho e sem botão nenhum, com o link
                já calculado no servidor sendo jogado fora. */}
            {precisaReconectar ? (
              <div style={{ alignSelf: "center" }}><BotaoReconectar destaque /></div>
            ) : linkDaConta ? (
              <a href={linkDaConta} target="_blank" rel="noopener noreferrer"
                style={{
                  background: contaMeta.pronto ? "#F1F5F9" : "#DC2626",
                  color: contaMeta.pronto ? "#334155" : "#fff",
                  border: "none", padding: "10px 16px", borderRadius: 10,
                  fontSize: "0.85rem", fontWeight: 800, textDecoration: "none",
                  whiteSpace: "nowrap", alignSelf: "center",
                }}>
                {contaMeta.pronto ? "Gerenciar pagamento" : proximoPasso === "sem_saldo" ? "Adicionar saldo agora" : "Resolver no Facebook"}
              </a>
            ) : null}
          </div>

          {!contaMeta.pronto && contaMeta.mensagem && (
            <div style={{ fontSize: "0.8rem", color: "#991B1B", marginTop: 10, lineHeight: 1.5, borderTop: "1px solid #FCA5A5", paddingTop: 10 }}>
              ⚠️ {contaMeta.mensagem}
              {/* Quem está nesse estado precisa saber que a cobrança da gestão
                  não para sozinha: pausar é o que interrompe. */}
              {activeCampaigns.length > 0 && (
                <div style={{ marginTop: 6, fontWeight: 700 }}>
                  A gestão de R$ 50/semana continua correndo enquanto a campanha estiver ativa —
                  se preferir, pause abaixo até resolver.
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => { void atualizarProntidao(); }}
                  style={{ background: "#fff", border: "1.5px solid #FCA5A5", color: "#991B1B", padding: "7px 14px", borderRadius: 9, fontSize: "0.78rem", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={13} /> Já resolvi — verificar de novo
                </button>
              </div>
            </div>
          )}

          {!contaMeta.carteira?.cobrancaAutomatica && contaMeta.pronto && (
            <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 8, lineHeight: 1.5, borderTop: "1px solid #BBF7D0", paddingTop: 8 }}>
              💡 Você está no modo pré-pago: quando o crédito acabar, os anúncios param. Cadastrando
              um cartão, o Facebook cobra sozinho e você não precisa recarregar.
            </div>
          )}

          {/* ── DE QUAL CONTA SAI O DINHEIRO ───────────────────────────────
              Quem já anunciou tem várias contas no Facebook (a pessoal, a de
              uma agência antiga, a de outro negócio) e o FireHub não tem como
              adivinhar qual delas é a certa — errar aqui é gastar da conta
              errada, coisa que só aparece na fatura. Aparece apenas quando há
              mais de uma, para não virar pergunta desnecessária. */}
          {contasDisponiveis.length > 1 && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${contaMeta.pronto ? "#BBF7D0" : "#FCA5A5"}`, paddingTop: 10 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#374151", marginBottom: 6 }}>
                Conta de anúncios usada nas suas campanhas
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={contaSelecionada}
                  onChange={(e) => setContaSelecionada(e.target.value)}
                  disabled={trocandoConta}
                  style={{
                    flex: 1, minWidth: 240, padding: "9px 12px", borderRadius: 10,
                    border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontWeight: 600,
                    background: "#fff", color: "#111827",
                  }}
                >
                  {contasDisponiveis.map((c: any) => (
                    <option key={c.id} value={c.id} disabled={c.status !== 1}>
                      {c.nome}{c.status !== 1 ? ` — ${c.significado}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={trocandoConta || !contaSelecionada || contaSelecionada === contaMeta?.adAccountId}
                  onClick={async () => {
                    setTrocandoConta(true);
                    try {
                      const r = await fetch("/api/meta-ads/escolher-conta", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ adAccountId: contaSelecionada }),
                      });
                      const d = await r.json();
                      if (!r.ok) throw new Error(d?.error || "Não foi possível trocar a conta.");
                      // Relê o estado real em vez de assumir que deu certo.
                      const st = await fetch("/api/meta-ads/status").then((x) => x.json()).catch(() => null);
                      if (st) setContaMeta(st);
                      await carregarContasDeAnuncio();
                      setNotification({
                        type: d.aviso ? "info" : "success",
                        message: d.aviso || `Pronto! As campanhas passam a usar "${d.nome}".`,
                      });
                    } catch (e: any) {
                      setNotification({ type: "error", message: e?.message || "Falha ao trocar a conta." });
                    } finally {
                      setTrocandoConta(false);
                    }
                  }}
                  style={{
                    background: trocandoConta ? "#9CA3AF" : "#111827", color: "#fff", border: "none",
                    padding: "10px 16px", borderRadius: 10, fontSize: "0.82rem", fontWeight: 800,
                    cursor: trocandoConta ? "wait" : "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {trocandoConta ? "Trocando..." : "Usar esta conta"}
                </button>
              </div>
              <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: 6, lineHeight: 1.5 }}>
                É desta conta que o Facebook cobra o investimento em anúncios. Contas encerradas ou
                desativadas aparecem na lista, mas não podem ser escolhidas.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lista de campanhas */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.75rem" }}>Suas campanhas</h3>
        {campaigns.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", background: "#F9FAFB", borderRadius: 14, color: "#6B7280" }}>
            <Target size={40} color="#D1D5DB" style={{ margin: "0 auto 12px" }} />
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Nenhuma campanha criada</div>
            <div style={{ fontSize: "0.85rem" }}>Crie sua primeira campanha de tráfego pago.</div>
          </div>
        ) : campaigns.map(c => {
          const isActive = c.status === "ACTIVE";
          const isPaused = c.status === "PAUSED";
          const isEncerrada = c.status === "ENDED";
          const spend = c.spend ?? 0;
          const orders = c.ordersGenerated ?? 0;
          const revenue = c.revenue ?? 0;
          const roas = spend > 0 ? (revenue / spend).toFixed(1) : "—";
          const cpo = orders > 0 ? `R$ ${(spend / orders).toFixed(2)}` : "—";

          return (
            <div key={c.id} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 14, padding: "1.25rem", marginBottom: "0.75rem" }}>
              {/* Header campanha */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {c.adImageUrl && <img src={c.adImageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", display: "flex", alignItems: "center", gap: 6 }}>
                      R$ {c.weeklyBudget}/semana
                      <span style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", padding: "1px 6px", borderRadius: 5, fontSize: "0.6rem", fontWeight: 700, color: "#0284C7", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Bot size={9} /> IA
                      </span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>Criada em {c.createdAt ? new Date(c.createdAt).toLocaleDateString("pt-BR") : "—"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{
                    padding: "4px 10px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700,
                    background: isActive ? "#F0FDF4" : isPaused ? "#FEF9C3" : "#F1F5F9",
                    color: isActive ? "#166534" : isPaused ? "#92400E" : "#475569",
                    border: `1px solid ${isActive ? "#BBF7D0" : isPaused ? "#FDE68A" : "#E2E8F0"}`,
                  }}>
                    {/* O cron grava "ENDED" e a tela imprimia esse token cru, em
                        inglês, sem ação nenhuma ao lado. */}
                    {ROTULO_DE_STATUS[c.status] || c.status}
                  </span>
                  {isActive && (
                    <button onClick={() => handleAction(c.id, "pause")} disabled={actionLoading}
                      style={{ background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#92400E", display: "flex", alignItems: "center", gap: 4 }}>
                      <Pause size={12} /> Pausar
                    </button>
                  )}
                  {isPaused && (
                    // Retomar lança a semana de gestão na fatura e pausar depois
                    // não estorna: passa a pedir confirmação com o valor à vista.
                    <button onClick={() => confirmarRetomada(c)} disabled={actionLoading}
                      style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#166534", display: "flex", alignItems: "center", gap: 4 }}>
                      <Play size={12} /> Retomar
                    </button>
                  )}
                  {isEncerrada && (
                    <button
                      onClick={() => {
                        hasAutoGenerated.current = false;
                        setAdCopy(""); setAdDescription(""); setSelectedImage(""); setUploadPreview("");
                        setProductImages([]); setCardapioCarregado(false);
                        if (c.weeklyBudget > 0) { setInvestment(c.weeklyBudget); setNewBudget(c.weeklyBudget); }
                        setStep("invest");
                      }}
                      style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#1D4ED8", display: "flex", alignItems: "center", gap: 4 }}>
                      <Play size={12} /> Criar nova campanha
                    </button>
                  )}
                  {/* Os termos prometem "alterar o orçamento a qualquer momento"
                      — e não existia botão nenhum. O editor usa a rota
                      update_budget, que muda na Meta ANTES de gravar aqui. */}
                  {editingBudget === c.id ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input
                        type="number"
                        min={70}
                        value={newBudget}
                        onChange={e => setNewBudget(Number(e.target.value) || 0)}
                        style={{ width: 78, padding: "3px 6px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.72rem" }}
                      />
                      <button onClick={() => handleAction(c.id, "update_budget", { weeklyBudget: newBudget })} disabled={actionLoading}
                        style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "4px 8px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#1D4ED8" }}>
                        Salvar
                      </button>
                      <button onClick={() => setEditingBudget(null)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", color: "#6B7280" }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingBudget(c.id); setNewBudget(c.weeklyBudget || 100); }} disabled={actionLoading}
                      title="Alterar o investimento semanal (mínimo R$ 70)"
                      style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: "4px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#1D4ED8" }}>
                      💰 R$ {c.weeklyBudget || 100}/sem
                    </button>
                  )}
                </div>
              </div>

              {/* Métricas */}
              <div className="dash-campaign-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "0.5rem" }}>
                {[
                  { label: "Investido", value: `R$ ${spend.toFixed(2)}`, color: "#3B82F6" },
                  { label: "Impressões", value: (c.impressions ?? 0).toLocaleString("pt-BR"), color: "#8B5CF6" },
                  { label: "Cliques", value: (c.clicks ?? 0).toLocaleString("pt-BR"), color: "#F59E0B" },
                  { label: "Pedidos", value: orders.toString(), color: "#10B981" },
                  { label: "ROAS", value: `${roas}x`, color: "#EF4444" },
                ].map(m => (
                  <div key={m.label} style={{ background: "#F9FAFB", borderRadius: 8, padding: "8px", textAlign: "center" }}>
                    <div style={{ fontSize: "0.65rem", color: "#6B7280", textTransform: "uppercase", marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: "1rem", fontWeight: 800, color: m.color, fontVariantNumeric: "tabular-nums" }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Custo por pedido + Lucro estimado */}
              {orders > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: "1rem", fontSize: "0.78rem", color: "#6B7280" }}>
                  <span>📊 Custo/pedido: <strong style={{ color: "#111" }}>{cpo}</strong></span>
                  {revenue > spend && <span>💚 Lucro estimado: <strong style={{ color: "#16A34A" }}>R$ {(revenue - spend).toFixed(2)}</strong></span>}
                </div>
              )}

              {/* "ENDED" sozinho não diz nada a um dono de restaurante — e ele
                  precisa saber que a cobrança parou junto com a veiculação. */}
              {isEncerrada && (
                <div style={{ marginTop: 10, fontSize: "0.78rem", color: "#475569", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "9px 12px", lineHeight: 1.5 }}>
                  Esta campanha foi encerrada no Facebook e não veicula mais. <strong>Nenhuma taxa de
                  gestão é cobrada por ela</strong>. Os números acima são o resultado final do período.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info cards */}
      <div className="dash-info-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#1E40AF", fontWeight: 700, marginBottom: 6 }}>💰 Taxa de gestão (serviço)</div>
          <div style={{ fontSize: "0.78rem", color: "#3B82F6" }}>
            R$ 50/semana pelo serviço. Ativou campanha = cobra, independente do resultado.
          </div>
        </div>
        <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#166534", fontWeight: 700, marginBottom: 6 }}>🤖 Tudo automático</div>
          <div style={{ fontSize: "0.78rem", color: "#166534", lineHeight: 1.5 }}>
            A IA cria, otimiza e monitora seus anúncios 24h. Sem precisar fazer nada.
          </div>
        </div>
      </div>

      <div style={{ marginTop: "1rem", display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={() => window.open("https://wa.me/5522998851680?text=Oi%20quero%20ajuda%20para%20configurar%20o%20trafego%20pago%20do%20firehub%20na%20minha%20loja", "_blank")}
          style={{ background: "none", border: "1px solid #E5E7EB", borderRadius: 10, padding: "10px 20px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "#475569", display: "inline-flex", alignItems: "center", gap: 8 }}>
          💬 Falar com especialista <ExternalLink size={14} />
        </button>
        {/* Fica aqui SEMPRE, mesmo com tudo verde: o token da Meta vence sozinho
            em ~60 dias e o lojista pode revogar o app pelo Facebook sem que a
            gente saiba. Uma tela onde reconectar é impossível é uma tela onde o
            anúncio segue gastando e o dono não consegue mais parar. */}
        <BotaoReconectar />
      </div>
    </div>
  );
}
