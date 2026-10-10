import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CartProvider } from "@/components/CartProvider";
import StoreTopNav from "@/components/customer/StoreTopNav";
import { ehLojaDeDemonstracao } from "@/lib/pedidos-simulados";
import StoreSidebar from "@/components/customer/StoreSidebar";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { prisma } from "@/lib/prisma";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";
import { bloqueioDoCiclo, diaEMes, diasAte, vencimentoDoBoleto } from "@/lib/prazo-da-mensalidade";
import HideOnCompras from "@/components/HideOnCompras";
import AvisoRoboDesconectado from "@/components/customer/AvisoRoboDesconectado";
import AvisoIaForaDoAr from "@/components/customer/AvisoIaForaDoAr";
import AvisoCaixaAberto24h from "@/components/customer/AvisoCaixaAberto24h";
import AvisoImpressaoParada from "@/components/customer/AvisoImpressaoParada";
import { AvisoDispensavel, BotaoNaoVerMais } from "@/components/customer/NaoVerMais";
import GlobalPrintListener from "@/components/customer/GlobalPrintListener";
import HumanSupportFloatingWidget from "@/components/HumanSupportFloatingWidget";
import CentralDeTutoriais from "@/components/CentralDeTutoriais";
import TutorialDaTela from "@/components/TutorialDaTela";
import { TutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { tutoriaisEnviados } from "@/lib/tutoriais-no-servidor";
import AceiteDosTermos from "@/components/termos/AceiteDosTermos";
import SairDaConta from "@/components/SairDaConta";
import { aceitouVersaoAtual } from "@/lib/termos-de-uso";
import { VERSAO_DOS_TERMOS } from "@/lib/termos-versao";

export const dynamic = "force-dynamic";

/**
 * Botão das faixas do topo: altura fixa e texto no centro. Sem isto o link
 * herdava a altura mínima do CSS global e o texto ficava no alto do botão.
 */
const BOTAO_DA_FAIXA: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 30, minHeight: 0, padding: "0 16px", boxSizing: "border-box", lineHeight: 1,
  borderRadius: 8, fontWeight: 700, fontSize: ".8rem", textDecoration: "none", whiteSpace: "nowrap",
};

// O painel se instala como app (ícone "Instalar" na barra do Chrome). O
// manifesto mora só aqui, no admin e no login: no cardápio do cliente
// (/loja/...) ele ofereceria instalar um app que abre no painel.
export const metadata = { manifest: "/painel.webmanifest" };

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    console.error("[StoreLayout] Erro ao obter sessão:", err);
    redirect("/login");
  }
  if (!session) redirect("/login");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  let user: any = null;
  try {
    user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, name: true, email: true, city: true, slug: true, role: true, ownerId: true, permissions: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true, trialEndsAt: true, storeName: true, storeLogo: true },
    });
    console.log("[StoreLayout] Session Email:", session.user?.email, "| User Email from DB:", user?.email);
  } catch (err) {
    console.error("[StoreLayout] Erro ao buscar usuário:", err);
  }

  let storeOwner = user;
  if (user?.ownerId) {
    try {
      const owner = await prisma.user.findUnique({
        where: { id: user.ownerId },
        select: { id: true, name: true, email: true, city: true, slug: true, role: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true, trialEndsAt: true, storeName: true, storeLogo: true },
      });
      if (owner) storeOwner = owner;
    } catch (e) {}
  }

  const isFranqueado = user?.role === "FRANCHISEE" || user?.role === "STAFF";
  const isAdmin = user?.role === "ADMIN";

  // === TRIAL / BENEFÍCIO: calcular dias restantes baseado na conta proprietária ===
  let trialDaysLeft = 0;
  let isInTrial = false;
  const ownerCreatedAt = storeOwner?.createdAt || user?.createdAt;
  const ownerTrialEndsAt = storeOwner?.trialEndsAt || user?.trialEndsAt;

  if (ownerTrialEndsAt) {
    const trialMsLeft = new Date(ownerTrialEndsAt).getTime() - Date.now();
    trialDaysLeft = Math.max(0, Math.ceil(trialMsLeft / (1000 * 60 * 60 * 24)));
    isInTrial = trialDaysLeft > 0;
  } else if (ownerCreatedAt) {
    const diffMs = Date.now() - new Date(ownerCreatedAt).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    trialDaysLeft = Math.max(0, FIREHUB_PLAN.TRIAL_DAYS - diffDays);
    isInTrial = trialDaysLeft > 0;
  }

  // === PAGAMENTO: verificar ciclo pendente da loja proprietária ===
  let pendingPayment: {
    amount: number; url: string | null; isOverdue: boolean;
    /** "05/10" — o vencimento impresso no boleto. */
    venceEm: string;
    /** "setembro de 2026" — o mês de uso que esta mensalidade cobra. */
    referenteA: string;
    /** Dias de calendário até o vencimento; negativo depois dele. */
    diasParaVencer: number;
    ocorrencia: string;
  } | null = null;
  const targetFranchiseeId = storeOwner?.id || user?.id;
  const userEmailClean = (storeOwner?.email || user?.email)?.toLowerCase().replace(/\s+/g, "");
  const isHakimStore = storeOwner?.isFranqueadoHakim === true || user?.isFranqueadoHakim === true || userEmailClean === "contatohakim@gmail.com";
  const isSpecialStore = isHakimStore || userEmailClean === "viniciusmenezes.ofc@gmail.com";

  if (isFranqueado && targetFranchiseeId && !isSpecialStore) {
    try {
      const closedCycle = await prisma.franchiseeBillingCycle.findFirst({
        where: {
          franchiseeId: targetFranchiseeId,
          status: "CLOSED",
          amountPending: { gt: 0 },
        },
        orderBy: { closedAt: "desc" },
      });

      if (closedCycle && closedCycle.amountPending > 0) {
        // O boleto VENCE no dia 5 e o painel só TRAVA depois do dia 10
        // (lib/prazo-da-mensalidade.ts). A faixa contava os dias até o
        // bloqueio e chamava isso de vencimento: com o boleto vencendo em
        // 05/10, a loja lia "faltam 9 dias". A folga até o dia 10 não aparece
        // para a loja — o prazo é o dia 5, e depois dele o boleto já cobra
        // juros e multa (dono, 02/10/2026).
        const venc = vencimentoDoBoleto(closedCycle.yearMonth);
        const bloqueio = bloqueioDoCiclo(closedCycle);
        const now = new Date();
        const isOverdue = now >= bloqueio;
        const diasParaVencer = diasAte(venc.dia, now);

        pendingPayment = {
          amount: closedCycle.amountPending,
          url: closedCycle.asaasBoletoUrl,
          isOverdue,
          venceEm: diaEMes(venc.dia),
          referenteA: (() => {
            const [ano, mes] = closedCycle.yearMonth.split("-").map(Number);
            const nome = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][mes - 1];
            return nome ? `${nome} de ${ano}` : closedCycle.yearMonth;
          })(),
          diasParaVencer,
          // Para o "não ver mais" (components/customer/NaoVerMais.tsx): cala
          // ESTA fatura — e volta uma vez perto do vencimento e outra depois
          // dele, porque o que vem em seguida é o bloqueio da conta, e
          // bloqueio sem aviso é pior para a loja do que uma faixa a mais.
          ocorrencia: `${closedCycle.id}:${diasParaVencer < 0 ? "vencida" : diasParaVencer <= 3 ? "reta-final" : "inicio"}`,
        };
      }
    } catch (err) {
      console.error("[StoreLayout] Erro ao verificar pagamento:", err);
    }
  }

  const isBlocked = pendingPayment?.isOverdue === true;

  // === TERMOS DE USO: o dono aceita a versão em vigor antes de usar o painel ===
  // Só o dono (sem ownerId): funcionário não assina pela empresa, e o suporte
  // que entrou pelo "Acessar" do admin não aceita pela loja. Ver
  // lib/termos-de-uso.ts — erro de banco ali responde "já aceitou".
  const ehDonoDaConta = user?.role === "FRANCHISEE" && !user?.ownerId && !(session.user as any)?.impersonatedBy;
  const precisaAceitarTermos = ehDonoDaConta && user?.id ? !(await aceitouVersaoAtual(user.id)) : false;
  // Conta criada depois desta versão (pelo robô ou pelo admin) nunca viu termo
  // nenhum: o título não pode dizer "atualizamos".
  const contaNovaParaOsTermos = !!user?.createdAt && new Date(user.createdAt) >= new Date(`${VERSAO_DOS_TERMOS}T00:00:00-03:00`);

  return (
    <CartProvider>
      <TutoriaisEnviados ids={tutoriaisEnviados()}>
      <GlobalPrintListener />
      {/* O aviso de cancelamento e disputa NÃO mora aqui: montado no layout,
          ele abria em cima do KDS e de qualquer outra tela. Fica só na tela
          de pedidos (app/store/pedidos-clientes/page.tsx). */}
      {/* ── BARRA LATERAL + CONTEÚDO ─────────────────────────────────────
          O menu era uma barra horizontal com 16 itens que encolhiam a fonte
          até 0,58rem para caber. Em pé, cada item tem a largura inteira e o
          conteúdo ganha a tela — que é o que o dono pediu ao comparar com o
          iFood. */}
      {/* `fh-painel` marca o que é PAINEL. As classes .btn/.btn-primary são as
          mesmas do site público (src/app/page.tsx), e o painel tem regra de cor
          própria: cheio só na ação principal. Sem esta marca, mexer no botão do
          painel repintaria a landing junto. Ver src/styles/fh-painel.css. */}
      <div className="fh-painel" style={{ minHeight: "100vh", display: "flex", backgroundColor: "#F5F5F5" }}>
        <StoreSidebar
          nomeDaLoja={storeOwner?.storeName || user?.storeName || session.user?.name || "Minha loja"}
          logo={storeOwner?.storeLogo || user?.storeLogo || null}
          cidade={(session.user as any)?.city || storeOwner?.city || user?.city || ""}
          slug={storeOwner?.slug || user?.slug}
          mostrarAntecipacao={session.user?.email?.toLowerCase() === "contatohakim@gmail.com" || storeOwner?.email?.toLowerCase() === "contatohakim@gmail.com"}
          mostrarCompras={storeOwner?.isFranqueadoHakim === true}
          isAdmin={isAdmin}
          caixaAberto={storeOwner?.cashOpen ?? false}
          permissoesDoFuncionario={user?.role === "STAFF" ? String(user?.permissions ?? "") : null}
        />
        {/* fh-conteudo: no celular o conteúdo começa ABAIXO da barra de
            aplicativo (a regra mora no CSS da StoreSidebar). Sem esta reserva,
            o botão do menu — que é fixo — cobre o primeiro controle de cada
            tela: foi ele que tapou o "← Pedidos" no módulo de mesa. */}
        <div className="fh-conteudo" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Só aparece quando a sessão nasceu do "Acessar" do admin. Fica ANTES
            da barra da loja porque o ponto é ser a primeira coisa que se vê:
            sem aviso, é questão de tempo até alguém do suporte fechar um caixa
            achando que está na própria conta. */}
        {(session.user as any)?.impersonatedBy && (
          <ImpersonationBanner storeName={storeOwner?.storeName || user?.storeName || session.user?.name || "esta loja"} />
        )}
        <StoreTopNav
          userName={session.user?.name || user?.name || ""}
          userCity={(session.user as any)?.city || storeOwner?.city || user?.city || ""}
          userSlug={storeOwner?.slug || user?.slug}
          showCompras={storeOwner?.isFranqueadoHakim === true}
          isAdmin={isAdmin}
          initialStoreOpen={storeOwner?.storeOpen ?? true}
          initialCashOpen={storeOwner?.cashOpen ?? false}
          showAntecipacao={session.user?.email?.toLowerCase() === "contatohakim@gmail.com" || storeOwner?.email?.toLowerCase() === "contatohakim@gmail.com"}
          semNavegacao
          lojaDeDemonstracao={ehLojaDeDemonstracao(storeOwner?.id || user?.id)}
        />
        {/* A tela de orientação com todos os vídeos, que abre depois do login
            e pelo botão "Tutoriais em vídeo" do menu lateral. Não abre SOZINHA
            para o suporte que entrou pelo "Acessar" do admin: quem precisa
            aprender o painel é a loja, não quem a está atendendo. */}
        {user?.id && (
          <CentralDeTutoriais
            // Com a tela dos Termos aberta, a central espera o próximo acesso.
            abrirSozinha={isFranqueado && !(session.user as any)?.impersonatedBy && !precisaAceitarTermos}
            usuarioId={user.id}
            // Conta antiga guarda o nome da LOJA em `name`: aí a saudação vai sem nome.
            primeiroNome={user.name && user.name.trim() !== (storeOwner?.storeName || user.storeName || "").trim() ? user.name.trim().split(/\s+/)[0] : ""}
            contaNova={!!ownerCreatedAt && Date.now() - new Date(ownerCreatedAt).getTime() < 30 * 24 * 60 * 60 * 1000}
          />
        )}

        {/* ── AVISOS DA OPERAÇÃO ────────────────────────────────────────
            Ficavam só no painel inicial (/store). Quem passa o expediente na
            tela de pedidos ou no KDS — que é onde a loja realmente fica —
            nunca via. Os dois casos que motivaram isto estavam acontecendo ao
            mesmo tempo em 29/08/2026: a Pastel da Paulista com o robô caído
            desde a véspera e com o caixa aberto havia 8 dias.

            Cada faixa decide sozinha se aparece, e as duas somem quando não há
            o que avisar: faixa que fica na tela à toa vira paisagem, e aí não
            serve no dia em que importa. */}
        {/* Fora do HideOnCompras de propósito: ele esconde os avisos em
            /store/orders, e é justamente na tela de pedidos que o caixa passa
            o expediente — o aviso de impressão parada precisa aparecer LÁ. O
            próprio componente se esconde em /store/compras. */}
        {/* "Tem um tutorial desta tela": a faixa no alto de cada tela que tem
            vídeo (some sozinha onde não tem). Acréscimo ao botão do topo e ao
            do menu lateral, que continuam. */}
        <TutorialDaTela variante="faixa" estilo={{ margin: "0.75rem 1.5rem 0" }} />
        <AvisoImpressaoParada />
        <HideOnCompras>
          <div style={{ padding: "1rem 1.5rem 0" }}>
            <AvisoCaixaAberto24h />
            <AvisoRoboDesconectado />
            <AvisoIaForaDoAr />
          </div>
        </HideOnCompras>

        {/* Banner: Trial ativo (esconde no módulo de compras via client-side) */}
        {isInTrial && isFranqueado && (
          <HideOnCompras>
            {/* Mesma regra da cobrança: calado no começo, volta uma vez nos 3
                últimos dias do teste. */}
            <AvisoDispensavel aviso="teste-gratis" ocorrencia={trialDaysLeft <= 3 ? "reta-final" : "inicio"}>
            {/* Paleta Brasa (proposta 23/09): o azul saiu do painel; o aviso
                do teste usa o laranja brasa claro, a mesma família da marca. */}
            <div style={{
              background: "#FFF4EF", borderBottom: "1px solid #FFD3C2",
              color: "#9A3412", padding: "10px 1.5rem", textAlign: "center",
              fontSize: ".85rem", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap",
            }}>
              🎁 Teste grátis — <strong>{trialDaysLeft} {trialDaysLeft === 1 ? "dia restante" : "dias restantes"}</strong>
              <span style={{ opacity: .8, fontSize: ".78rem", marginLeft: 4 }}>
                Aproveite todas as funcionalidades sem custo
              </span>
              <BotaoNaoVerMais compacto cor="#9A3412" borda="#FFD3C2" />
            </div>
            </AvisoDispensavel>
          </HideOnCompras>
        )}

        {/* Banner: Pagamento pendente DENTRO DO PRAZO */}
        {pendingPayment && !pendingPayment.isOverdue && !isInTrial && (
          <HideOnCompras>
            <AvisoDispensavel aviso="cobranca-pendente" ocorrencia={pendingPayment.ocorrencia}>
            <div style={{
              // Azul de propósito: a cobrança do FireHub não pode se confundir com as cores do painel (laranja/vermelho).
              background: "linear-gradient(135deg, #1D4ED8, #2563EB)",
              color: "white", padding: "10px 1.5rem", textAlign: "center",
              fontSize: ".85rem", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
            }}>
              <span>
                ⚠️ Mensalidade de R$ {pendingPayment.amount.toFixed(2).replace(".", ",")}{" "}
                {pendingPayment.diasParaVencer > 0 ? (
                  <>vence em <strong>{pendingPayment.venceEm}</strong> ({pendingPayment.diasParaVencer === 1 ? "falta 1 dia" : `faltam ${pendingPayment.diasParaVencer} dias`}).</>
                ) : pendingPayment.diasParaVencer === 0 ? (
                  <>vence <strong>hoje ({pendingPayment.venceEm})</strong>.</>
                ) : (
                  <>venceu em <strong>{pendingPayment.venceEm}</strong> e já está com juros e multa. Pague agora para evitar o bloqueio do sistema.</>
                )}
              </span>
              <a href="/store/financeiro#fatura" style={{ ...BOTAO_DA_FAIXA, background: "#fff", color: "#1D4ED8" }}>
                Ver Fatura
              </a>
              {pendingPayment.url && (
                <a href={pendingPayment.url} target="_blank" rel="noopener noreferrer" style={{ ...BOTAO_DA_FAIXA, background: "#fff", color: "#1D4ED8" }}>
                  Pagar Agora
                </a>
              )}
              <BotaoNaoVerMais compacto cor="#fff" borda="rgba(255,255,255,.6)" />
            </div>
            </AvisoDispensavel>
          </HideOnCompras>
        )}

        {precisaAceitarTermos && (
          <AceiteDosTermos
            nomeDaLoja={storeOwner?.storeName || user?.storeName || session.user?.name || "sua loja"}
            primeiraVez={contaNovaParaOsTermos}
          />
        )}

        {/* Tela de Bloqueio por Inadimplência — permite o login, mas bloqueia o uso até pagar */}
        {isBlocked && (
          // A tela INTEIRA: com top 60 a barra vermelha seguia clicável — dava
          // para ligar "Site aberto", abrir Integrações (Douglas, 09/10/2026:
          // "não deixa ele usar mais nada"). Sair da conta mora aqui dentro.
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(15, 23, 42, 0.88)", backdropFilter: "blur(8px)",
            zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", overflowY: "auto"
          }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "2.5rem", maxWidth: 500, width: "100%", textAlign: "center", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>🔒</div>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A", marginBottom: "0.5rem" }}>Sua conta está bloqueada</h2>
              {/* Sem o valor e sem falar de juros: tudo isso está no boleto. A
                  loja abre a fatura para ver quanto é — e o Asaas registra que
                  ela abriu (Douglas, 09/10/2026). */}
              <p style={{ color: "#64748B", fontSize: "0.95rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                A mensalidade referente a <strong>{pendingPayment!.referenteA}</strong> venceu em {pendingPayment!.venceEm} e não foi paga. Pague o boleto para liberar o sistema.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* Abre a FATURA do Asaas (boleto, Pix e cartão) em outra aba.
                    Levava a /store/financeiro#fatura — que fica debaixo deste
                    mesmo bloqueio e nem tem a seção: a loja clicava em pagar e
                    continuava presa, sem ver o boleto (09/10/2026). */}
                <a
                  href={pendingPayment!.url || "/store/financeiro"}
                  target={pendingPayment!.url ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  style={{ width: "100%", background: "#C92E09", color: "#fff", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, textDecoration: "none", display: "inline-block" }}
                >
                  ⚡ Pagar e Liberar Conta →
                </a>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
                  Pagando por <strong>Pix</strong> na fatura, o sistema libera sozinho em poucos minutos.
                  Boleto leva de 1 a 3 dias úteis para o banco compensar.
                </p>
                <a href="/store" style={{ color: "#0F766E", fontSize: "0.85rem", fontWeight: 700, textDecoration: "underline" }}>
                  Já paguei — conferir de novo
                </a>
                <a href="https://wa.me/5522998851680?text=Preciso+de+ajuda+com+minha+conta+bloqueada" target="_blank" rel="noopener noreferrer" style={{ color: "#64748B", fontSize: "0.85rem", textDecoration: "underline" }}>
                  Falar com suporte via WhatsApp
                </a>
                <SairDaConta style={{ color: "#94A3B8", fontSize: "0.8rem", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                  Sair da conta
                </SairDaConta>
              </div>
            </div>
          </div>
        )}

        <main style={{ flex: 1, minWidth: 0 }}>
          {children}
        </main>

        <HumanSupportFloatingWidget />
        </div>
      </div>
      </TutoriaisEnviados>
    </CartProvider>
  );
}
