"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Monitor,
  KeyRound,
  Bike,
  MessageCircle,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { AbasDoChrome, BarraDoChrome, FichaDaLoja, Fluxo, Pilula, PopupLogin, PopupRobo } from "./ilustracoes";

/**
 * /store/extensao-ifood — como o lojista instala e usa a extensão de prazo
 * (firehub-ifood-extension/). Tudo o que esta página promete tem de existir na
 * extensão: ela escreve SÓ no iFood, pelo portal (não há API de prazo), NÃO
 * pausa a loja sozinha e NUNCA abre aba sozinha (decisão de 04/09/2026). Até
 * 25/09/2026 a página dizia o contrário nos três pontos e tinha um botão
 * "Conectar iFood via API Oficial" que não levava a lugar nenhum.
 */

// O ID sai do painel da Chrome Web Store quando o item é criado. Enquanto ele
// não estiver na env, o passo 1 manda para o suporte em vez de link quebrado.
const EXTENSION_ID = process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID || "";
const STORE_URL = EXTENSION_ID
  ? `https://chromewebstore.google.com/detail/${EXTENSION_ID}`
  : "";

// A mesma tela que o background.js procura (SETTINGS_URL). Outra página do
// portal não serve: a extensão só trabalha na aba que estiver neste endereço.
const TELA_DE_ENTREGA_IFOOD = "https://portal.ifood.com.br/merchant-delivery-core-portal-experience";

const SUPORTE = `https://wa.me/5522981118514?text=${encodeURIComponent(
  "Oi! Preciso de ajuda com a extensão de prazo automático do iFood no FireHub."
)}`;

/** Mesma tabela do background.js (calculateAndApply) e de /api/store/dynamic-eta. */
function prazoDaFila(pedidos: number, motoboys: number) {
  if (pedidos <= motoboys) return { faixa: 0, minutos: 28 };
  if (pedidos <= motoboys * 2) return { faixa: 1, minutos: 38 };
  if (pedidos <= motoboys * 3) return { faixa: 2, minutos: 58 };
  if (pedidos <= motoboys * 4) return { faixa: 3, minutos: 78 };
  return { faixa: 4, minutos: 78 };
}

const FAIXAS = [
  { minutos: "28 min", nome: "Cozinha tranquila", fundo: "#F0FDFA", borda: "#99F6E4", cor: "#0F766E" },
  { minutos: "38 min", nome: "Movimento normal", fundo: "#F0FDFA", borda: "#99F6E4", cor: "#0E7490" },
  { minutos: "58 min", nome: "Cozinha cheia", fundo: "#FEFCE8", borda: "#FDE047", cor: "#B45309" },
  { minutos: "78 min", nome: "Muito cheia", fundo: "#FFF4EF", borda: "#FFD3C2", cor: "#9A3412" },
  { minutos: "78 min + aviso", nome: "Passou do limite", fundo: "#FEF2F2", borda: "#FCA5A5", cor: "#B71C1C" },
];

const cartao: CSSProperties = {
  background: "#FFF",
  borderRadius: 22,
  padding: "2rem",
  border: "1px solid #E2E8F0",
  boxShadow: "0 6px 20px rgba(15,23,42,0.04)",
  marginBottom: "2rem",
};

const selo: CSSProperties = {
  display: "inline-block",
  fontSize: "0.72rem",
  fontWeight: 900,
  letterSpacing: 0.4,
  color: "#E8360C",
  background: "#FFF1F0",
  padding: "4px 12px",
  borderRadius: 999,
};

const titulo2: CSSProperties = { fontSize: "1.5rem", fontWeight: 900, color: "#0F172A", margin: "10px 0 6px", letterSpacing: "-0.3px" };
const texto: CSSProperties = { fontSize: "0.95rem", color: "#475569", lineHeight: 1.6, margin: 0 };

const botaoLaranja: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 20px",
  borderRadius: 12,
  background: "linear-gradient(135deg, #E8360C 0%, #E8590C 100%)",
  color: "#FFF",
  fontWeight: 900,
  fontSize: "0.95rem",
  textDecoration: "none",
  boxShadow: "0 6px 18px rgba(232,54,12,0.3)",
  border: "none",
  cursor: "pointer",
};

const botaoClaro: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 18px",
  borderRadius: 12,
  background: "#FFF",
  color: "#0F172A",
  fontWeight: 800,
  fontSize: "0.9rem",
  textDecoration: "none",
  border: "1.5px solid #CBD5E1",
};

function Passo({ numero, titulo, children, desenho, feito }: { numero: number; titulo: string; children: ReactNode; desenho: ReactNode; feito?: boolean }) {
  return (
    <div className="eta-passo" style={{ padding: "1.75rem 0", borderTop: numero === 1 ? "none" : "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            background: feito ? "#0F766E" : "#E8360C",
            color: "#FFF",
            fontWeight: 900,
            fontSize: "1.2rem",
            display: "grid",
            placeItems: "center",
            boxShadow: feito ? "0 6px 16px rgba(15, 118, 110,0.3)" : "0 6px 16px rgba(232,54,12,0.3)",
          }}
        >
          {feito ? <CheckCircle2 size={22} /> : numero}
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: "1.15rem", fontWeight: 900, color: "#0F172A", margin: "8px 0 8px" }}>{titulo}</h3>
          <div style={{ ...texto, display: "grid", gap: 10 }}>{children}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>{desenho}</div>
    </div>
  );
}

function Pergunta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="eta-pergunta" style={{ border: "1px solid #E2E8F0", borderRadius: 14, background: "#FFF" }}>
      <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", cursor: "pointer", fontWeight: 800, color: "#0F172A", fontSize: "0.95rem", listStyle: "none" }}>
        {titulo}
        <ChevronDown className="eta-pergunta-seta" size={18} color="#64748B" style={{ flexShrink: 0 }} />
      </summary>
      <div style={{ ...texto, padding: "0 16px 16px", display: "grid", gap: 8, fontSize: "0.9rem" }}>{children}</div>
    </details>
  );
}

export default function ExtensaoIfoodPage() {
  const [motoboys, setMotoboys] = useState(3);
  const [pedidos, setPedidos] = useState(7);
  const [versaoInstalada, setVersaoInstalada] = useState<string | null>(null);

  // A extensão carimba data-firehub-extension no <html> pelo content script.
  useEffect(() => {
    const checar = () => {
      const versao = document.documentElement.getAttribute("data-firehub-extension");
      setVersaoInstalada(versao || null);
    };
    checar();
    window.addEventListener("firehub-extension-ready", checar);
    const timer = setInterval(checar, 2000);
    return () => {
      window.removeEventListener("firehub-extension-ready", checar);
      clearInterval(timer);
    };
  }, []);

  const instalada = Boolean(versaoInstalada);
  const limite = motoboys * 4;
  const maxPedidos = limite + 3;
  const pedidosNaTela = Math.min(pedidos, maxPedidos);
  const resultado = prazoDaFila(pedidosNaTela, motoboys);
  const estourou = resultado.faixa === 4;

  const faixasDePedidos = [
    `0 a ${motoboys}`,
    `${motoboys + 1} a ${motoboys * 2}`,
    `${motoboys * 2 + 1} a ${motoboys * 3}`,
    `${motoboys * 3 + 1} a ${limite}`,
    `${limite + 1} ou mais`,
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <style>{`
        .eta-hero { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 2rem; align-items: center; }
        .eta-passo { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 1.75rem; align-items: center; }
        .eta-grade-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
        .eta-grade-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.9rem; }
        .eta-faixas { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.6rem; }
        .eta-seta-baixo { display: none; }
        .eta-pergunta summary::-webkit-details-marker { display: none; }
        .eta-pergunta[open] .eta-pergunta-seta { transform: rotate(180deg); }
        .eta-pergunta-seta { transition: transform 0.2s; }
        .eta-alcance { width: 100%; accent-color: #E8360C; }
        @media (max-width: 860px) {
          .eta-hero, .eta-passo, .eta-grade-2 { grid-template-columns: 1fr; }
          .eta-grade-4 { grid-template-columns: 1fr 1fr; }
          .eta-faixas { grid-template-columns: 1fr; }
          .eta-fluxo { flex-direction: column; }
          .eta-seta-lado { display: none; }
          .eta-seta-baixo { display: block; }
        }
      `}</style>

      {/* Barra do topo */}
      <div style={{ background: "linear-gradient(90deg, #E8360C 0%, #E8590C 100%)", color: "#FFF", padding: "0.85rem 1.25rem", boxShadow: "0 4px 12px rgba(232, 54, 12, 0.25)" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Link
            href="/store/pedidos-clientes"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#FFF", textDecoration: "none", fontSize: "0.85rem", fontWeight: 800, background: "rgba(255,255,255,0.18)", padding: "5px 12px", borderRadius: 8 }}
          >
            <ArrowLeft size={16} /> Voltar ao Painel
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, fontSize: "0.95rem" }}>
            <Flame size={20} /> PRAZO AUTOMÁTICO NO IFOOD
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1rem" }}>

        {/* O QUE É */}
        <div className="eta-hero" style={{ ...cartao, padding: "2.25rem" }}>
          <div>
            <span style={selo}>EXTENSÃO PARA O GOOGLE CHROME</span>
            <h1 style={{ fontSize: "2.1rem", fontWeight: 900, lineHeight: 1.15, color: "#0F172A", margin: "12px 0 12px", letterSpacing: "-0.6px" }}>
              O tempo de entrega do iFood muda sozinho, conforme a fila da sua cozinha
            </h1>
            <p style={{ ...texto, fontSize: "1.02rem" }}>
              Encheu de pedido, o prazo no iFood sobe. A cozinha esvaziou, ele desce. Você não precisa largar o atendimento para
              mexer no Portal do Parceiro. Quem mexe é a extensão, no computador do caixa.
            </p>

            <div style={{ marginTop: "1.25rem", display: "grid", gap: 10 }}>
              {instalada ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 14, background: "#F0FDFA", border: "1.5px solid #99F6E4", color: "#0F766E", fontWeight: 800, fontSize: "0.92rem" }}>
                  <CheckCircle2 size={20} style={{ flexShrink: 0 }} />
                  <span>A extensão já está instalada neste computador (v{versaoInstalada}). Continue do passo 2.</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 14, background: "#FFF4EF", border: "1.5px solid #FFD3C2", color: "#9A3412", fontWeight: 800, fontSize: "0.92rem" }}>
                  <Monitor size={20} style={{ flexShrink: 0 }} />
                  <span>A extensão ainda não está neste computador. Comece pelo passo 1.</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href="#passo-a-passo" style={botaoLaranja}>Ver o passo a passo</a>
                <a href="#regra" style={botaoClaro}>Como o prazo é escolhido</a>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <PopupRobo />
            <Pilula texto="FireHub: 58 min · 7 ped. (🤖 Auto)" />
          </div>
        </div>

        {/* COMO FUNCIONA */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
            <span style={selo}>COMO FUNCIONA</span>
            <h2 style={titulo2}>Três coisas acontecendo sozinhas, o dia inteiro</h2>
          </div>
          <Fluxo />
          <p style={{ ...texto, textAlign: "center", marginTop: "1rem", fontSize: "0.88rem" }}>
            A extensão confere a fila a cada minuto e só mexe no iFood quando o prazo precisa mudar de faixa.
          </p>
        </div>

        {/* O QUE PRECISA */}
        <div style={cartao}>
          <span style={selo}>ANTES DE COMEÇAR</span>
          <h2 style={titulo2}>O que você precisa ter em mãos</h2>
          <div className="eta-grade-4" style={{ marginTop: "1rem" }}>
            {[
              { icone: <Monitor size={20} />, t: "O computador do caixa", d: "Com Google Chrome. É nele que a extensão trabalha, não no celular." },
              { icone: <KeyRound size={20} />, t: "Seu login do FireHub", d: "O mesmo e-mail e senha que você usa para entrar neste painel." },
              { icone: <span style={{ fontWeight: 900, fontSize: 15 }}>iF</span>, t: "O login do iFood", d: "Do Portal do Parceiro da loja: portal.ifood.com.br." },
              { icone: <Bike size={20} />, t: "Quantos motoboys tem hoje", d: "O prazo é calculado com esse número. Dá para mudar a qualquer hora." },
            ].map((item) => (
              <div key={item.t} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1rem" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "#FFF1F0", color: "#E8360C", display: "grid", placeItems: "center", marginBottom: 10 }}>{item.icone}</div>
                <div style={{ fontWeight: 900, fontSize: "0.95rem", marginBottom: 4 }}>{item.t}</div>
                <div style={{ fontSize: "0.84rem", color: "#64748B", lineHeight: 1.45 }}>{item.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* PASSO A PASSO */}
        <div id="passo-a-passo" style={{ ...cartao, scrollMarginTop: 16 }}>
          <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
            <span style={selo}>PASSO A PASSO</span>
            <h2 style={titulo2}>Configure uma vez, em 5 passos</h2>
            <p style={{ ...texto, fontSize: "0.9rem" }}>Faça tudo no computador do caixa. Depois, no dia a dia, você só ajusta os motoboys.</p>
          </div>

          <Passo numero={1} titulo="Instale a extensão no Chrome" feito={instalada} desenho={<FichaDaLoja />}>
            {instalada ? (
              <p style={{ margin: 0 }}>
                <b style={{ color: "#0F766E" }}>Já feito neste computador</b> (versão {versaoInstalada}). Pule para o passo 2.
              </p>
            ) : STORE_URL ? (
              <>
                <p style={{ margin: 0 }}>
                  Clique no botão abaixo. Abre a página da extensão na loja oficial do Google. Lá, clique em <b>Usar no Chrome</b> e depois em <b>Adicionar extensão</b>.
                </p>
                <p style={{ margin: 0, fontSize: "0.85rem" }}>Não precisa baixar arquivo nenhum. A extensão se atualiza sozinha.</p>
                <div>
                  <a href={STORE_URL} target="_blank" rel="noopener noreferrer" style={botaoLaranja}>
                    <ExternalLink size={16} /> Abrir na Chrome Web Store
                  </a>
                </div>
              </>
            ) : (
              <>
                <p style={{ margin: 0 }}>
                  A extensão está em aprovação na loja do Google. Enquanto isso, <b>a nossa equipe instala junto com você</b>: chame no WhatsApp,
                  com o computador do caixa ligado.
                </p>
                <p style={{ margin: 0, fontSize: "0.85rem" }}>
                  Quando a loja do Google liberar, o botão de instalar aparece aqui e a instalação passa a ser de 1 clique, como no desenho.
                </p>
                <div>
                  <a href={SUPORTE} target="_blank" rel="noopener noreferrer" style={{ ...botaoLaranja, background: "#0F766E", boxShadow: "0 6px 18px rgba(15, 118, 110,0.3)" }}>
                    <MessageCircle size={16} /> Pedir a instalação no WhatsApp
                  </a>
                </div>
              </>
            )}
          </Passo>

          <Passo numero={2} titulo="Deixe o ícone 🔥 sempre à vista" desenho={<BarraDoChrome />}>
            <p style={{ margin: 0 }}>
              No canto de cima, à direita do Chrome, clique na <b>peça de quebra-cabeça</b> (Extensões). Na lista, clique no <b>alfinete</b> ao lado de
              <b> FireHub — Prazo Automático de Entrega</b>.
            </p>
            <p style={{ margin: 0 }}>O ícone 🔥 passa a ficar fixo ao lado da barra de endereço. É por ele que você abre a extensão.</p>
          </Passo>

          <Passo numero={3} titulo="Entre com o seu login do FireHub" desenho={<PopupLogin />}>
            <p style={{ margin: 0 }}>
              Clique no ícone 🔥. Digite o <b>mesmo e-mail e senha</b> que você usa aqui no painel e clique em <b>Entrar e Conectar Loja</b>.
            </p>
            <p style={{ margin: 0 }}>
              É assim que a extensão sabe de qual loja contar os pedidos. Você só faz isso uma vez: ela continua conectada depois que você fecha o Chrome.
            </p>
          </Passo>

          <Passo numero={4} titulo="Abra a tela de entrega do iFood e deixe a aba aberta" desenho={<AbasDoChrome />}>
            <p style={{ margin: 0 }}>
              Clique no botão abaixo. Ele abre o Portal do Parceiro <b>direto na tela de Entrega</b>, que é onde a extensão muda o prazo.
              Se o iFood pedir, entre com o login da loja.
            </p>
            <p style={{ margin: 0 }}>
              <b>Não feche essa aba.</b> Ela pode ficar atrás das outras, não precisa estar na tela. Deixe também esta aba de pedidos do FireHub aberta:
              com ela aberta, a extensão vê cada pedido novo na hora.
            </p>
            <div>
              <a href={TELA_DE_ENTREGA_IFOOD} target="_blank" rel="noopener noreferrer" style={{ ...botaoLaranja, background: "linear-gradient(135deg, #EA1D2C 0%, #B71C1C 100%)", boxShadow: "0 6px 18px rgba(234,29,44,0.3)" }}>
                <ExternalLink size={16} /> Abrir a tela de Entrega do iFood
              </a>
            </div>
          </Passo>

          <Passo numero={5} titulo="Diga quantos motoboys tem e ligue o robô" desenho={<PopupRobo />}>
            <p style={{ margin: 0 }}>
              Clique no 🔥 de novo. Na aba <b>🤖 Automático</b>, use o <b>−</b> e o <b>+</b> para deixar o número de <b>motoboys na casa</b> agora.
            </p>
            <p style={{ margin: 0 }}>
              Depois ligue a chave <b>Robô Automático</b>: ela fica <b style={{ color: "#0F766E" }}>verde</b>. Pronto, a partir daqui o prazo do iFood acompanha a sua cozinha.
            </p>
          </Passo>

          {/* CONFERIR */}
          <div style={{ marginTop: "0.5rem", background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: 18, padding: "1.25rem 1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900, color: "#0F766E", fontSize: "1.05rem", marginBottom: 10 }}>
              <CheckCircle2 size={20} /> Como saber que está funcionando
            </div>
            <div className="eta-grade-2">
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: "0.9rem", color: "#134E4A", lineHeight: 1.5 }}>
                  No canto da tela de pedidos do FireHub aparece esta <b>pílula</b>, com o prazo e a quantidade de pedidos em produção:
                </div>
                <div><Pilula texto="FireHub: 38 min · 5 ped. (🤖 Auto)" /></div>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: "0.9rem", color: "#134E4A", lineHeight: 1.5 }}>
                  No ícone 🔥, o quadro <b>PORTAL IFOOD</b> mostra a bolinha verde e o horário da última vez que ela conferiu o prazo no iFood:
                </div>
                <div>
                  <span style={{ display: "inline-block", background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: "6px 14px", textAlign: "center" }}>
                    <span style={{ display: "block", fontSize: 10, color: "#94A3B8", fontWeight: 700 }}>PORTAL IFOOD</span>
                    <span style={{ display: "block", fontSize: 12, color: "#5EEAD4", fontWeight: 800 }}>🟢 19:42</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* A REGRA */}
        <div id="regra" style={{ ...cartao, scrollMarginTop: 16 }}>
          <div style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 1.5rem" }}>
            <span style={selo}>COMO O PRAZO É ESCOLHIDO</span>
            <h2 style={titulo2}>Cada motoboy dá conta de até 4 pedidos na fila</h2>
            <p style={{ ...texto, fontSize: "0.9rem" }}>
              Mexa nos dois controles e veja qual prazo o iFood recebe. É a mesma conta que a extensão faz no modo Automático.
            </p>
          </div>

          <div className="eta-grade-2" style={{ marginBottom: "1.5rem" }}>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1rem 1.25rem" }}>
              <div style={{ fontWeight: 900, fontSize: "0.9rem", marginBottom: 10 }}>🛵 Motoboys na casa</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[1, 2, 3, 4, 5, 6].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMotoboys(m)}
                    style={{
                      width: 44,
                      height: 40,
                      borderRadius: 10,
                      border: motoboys === m ? "2px solid #E8360C" : "1.5px solid #CBD5E1",
                      background: motoboys === m ? "#E8360C" : "#FFF",
                      color: motoboys === m ? "#FFF" : "#475569",
                      fontWeight: 900,
                      fontSize: "0.95rem",
                      cursor: "pointer",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1rem 1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "0.9rem", marginBottom: 10 }}>
                <span>🔥 Pedidos em produção</span>
                <span style={{ color: "#E8360C" }}>{pedidosNaTela}</span>
              </div>
              <input
                className="eta-alcance"
                type="range"
                min={0}
                max={maxPedidos}
                value={pedidosNaTela}
                onChange={(e) => setPedidos(Number(e.target.value))}
                aria-label="Pedidos em produção"
              />
            </div>
          </div>

          <div style={{ textAlign: "center", marginBottom: "1.25rem", padding: "1rem", borderRadius: 16, background: FAIXAS[resultado.faixa].fundo, border: `1.5px solid ${FAIXAS[resultado.faixa].borda}` }}>
            <div style={{ fontSize: "0.9rem", color: "#475569", fontWeight: 700 }}>
              {pedidosNaTela} {pedidosNaTela === 1 ? "pedido" : "pedidos"} e {motoboys} {motoboys === 1 ? "motoboy" : "motoboys"}: o iFood fica em
            </div>
            <div style={{ fontSize: "2.2rem", fontWeight: 900, color: FAIXAS[resultado.faixa].cor, lineHeight: 1.2 }}>{resultado.minutos} min</div>
            {estourou && (
              <div style={{ fontSize: "0.88rem", color: "#B71C1C", fontWeight: 800, marginTop: 4 }}>
                e a pílula fica vermelha avisando para você pausar a loja no iFood
              </div>
            )}
          </div>

          <div className="eta-faixas">
            {FAIXAS.map((f, i) => {
              const ativa = i === resultado.faixa;
              return (
                <div
                  key={i}
                  style={{
                    background: f.fundo,
                    border: ativa ? `2.5px solid ${f.cor}` : `1.5px solid ${f.borda}`,
                    borderRadius: 14,
                    padding: "0.85rem",
                    textAlign: "center",
                    opacity: ativa ? 1 : 0.6,
                    transform: ativa ? "scale(1.03)" : "none",
                    transition: "all 0.2s",
                  }}
                >
                  <div style={{ fontSize: "1.15rem", fontWeight: 900, color: f.cor }}>{f.minutos}</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginTop: 4 }}>{faixasDePedidos[i]} pedidos</div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>{f.nome}</div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "1.25rem", display: "flex", gap: 10, alignItems: "flex-start", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 14, padding: "12px 14px" }}>
            <AlertTriangle size={18} color="#B71C1C" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ ...texto, fontSize: "0.87rem", color: "#B71C1C" }}>
              <b>A extensão não pausa a loja sozinha.</b> Passou de 4 pedidos por motoboy, ela deixa o prazo no máximo (78 min) e a pílula fica
              vermelha. Pausar ou não é decisão sua, no próprio iFood. Quando a fila baixar, o prazo volta a descer sozinho.
            </p>
          </div>
        </div>

        {/* AUTOMÁTICO x MANUAL */}
        <div className="eta-grade-2" style={{ marginBottom: "2rem" }}>
          <div style={{ ...cartao, marginBottom: 0, padding: "1.5rem" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, marginBottom: 4 }}>🤖 Automático <span style={{ fontSize: "0.75rem", color: "#0F766E", fontWeight: 800 }}>(recomendado)</span></div>
            <p style={{ ...texto, fontSize: "0.9rem" }}>
              Você só informa os motoboys. O prazo segue a tabela acima. É o modo para usar no dia a dia.
            </p>
          </div>
          <div style={{ ...cartao, marginBottom: 0, padding: "1.5rem" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, marginBottom: 4 }}>✍️ Manual</div>
            <p style={{ ...texto, fontSize: "0.9rem" }}>
              Para quem quer a própria tabela. Na aba <b>✍️ Manual</b>, clique em <b>Adicionar Faixa de Métrica</b> e diga, por exemplo,
              &quot;até 5 pedidos, 40 min&quot;. Depois ligue a chave <b>Robô Manual</b>. Só um dos dois robôs fica ligado por vez.
            </p>
          </div>
        </div>

        {/* NO DIA A DIA */}
        <div style={cartao}>
          <span style={selo}>NO DIA A DIA</span>
          <h2 style={titulo2}>O que fazer em cada turno</h2>
          <div className="eta-grade-2" style={{ marginTop: "1rem" }}>
            {[
              { t: "Ao abrir a loja", d: "Ligue o computador do caixa, abra o Chrome com a aba de pedidos do FireHub e a tela de Entrega do iFood. Confira no 🔥 se o número de motoboys está certo." },
              { t: "Quando um motoboy sai ou chega", d: "Abra o 🔥 e ajuste o − / +. O número fica salvo até alguém mudar de novo, mesmo se desligar o computador." },
              { t: "Quando a pílula ficar vermelha", d: "A cozinha passou do limite. O prazo já está em 78 min. Se precisar, pause a loja no iFood até a fila baixar." },
              { t: "Se desligar o computador", d: "O prazo do iFood fica parado no último valor. Ao ligar de novo, abra as duas abas que a extensão volta a trabalhar." },
            ].map((item) => (
              <div key={item.t} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem" }}>
                <Clock size={18} color="#E8360C" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 900, fontSize: "0.95rem", marginBottom: 3 }}>{item.t}</div>
                  <div style={{ fontSize: "0.87rem", color: "#475569", lineHeight: 1.5 }}>{item.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SE ALGO DER ERRADO */}
        <div style={cartao}>
          <span style={selo}>SE APARECER UM AVISO</span>
          <h2 style={titulo2}>O que cada aviso quer dizer</h2>
          <div style={{ display: "grid", gap: 10, marginTop: "1rem" }}>
            <Pergunta titulo="“O Portal iFood foi desconectado!”">
              <p style={{ margin: 0 }}>
                O iFood deslogou a aba (acontece de tempos em tempos). Clique no botão <b>Reconectar no iFood</b> do próprio aviso, entre com o login
                da loja e deixe a aba na tela de Entrega. Enquanto estiver deslogado, o prazo não muda.
              </p>
            </Pergunta>
            <Pergunta titulo="“Abra o portal iFood para o prazo mudar”">
              <p style={{ margin: 0 }}>
                A aba do iFood foi fechada ou saiu da tela de Entrega. Clique em <b>Abrir a tela de entrega</b>, no próprio aviso, ou no botão do passo 4 desta página. A extensão
                nunca abre aba sozinha, de propósito: assim ela não enche o Chrome de abas repetidas.
              </p>
            </Pergunta>
            <Pergunta titulo="O ícone 🔥 mostra um aviso vermelho embaixo dos motoboys">
              <p style={{ margin: 0 }}>
                O número de motoboys não foi salvo e o prazo continua calculado com o número antigo. Clique em <b>[ Sair ]</b>, no rodapé do 🔥,
                entre de novo com o e-mail e a senha do FireHub e ajuste os motoboys outra vez.
              </p>
            </Pergunta>
            <Pergunta titulo="O prazo do iFood não está mudando">
              <p style={{ margin: 0 }}>Confira, nesta ordem:</p>
              <ol style={{ margin: 0, paddingLeft: "1.2rem", display: "grid", gap: 4 }}>
                <li>O Chrome está aberto no computador do caixa.</li>
                <li>A chave do robô está <b>verde</b> no ícone 🔥.</li>
                <li>A aba do iFood está aberta, logada e na tela de Entrega (passo 4).</li>
                <li>O número de motoboys está certo. Com poucos pedidos, o prazo pode continuar na mesma faixa, e aí não há nada para mudar.</li>
              </ol>
            </Pergunta>
            <Pergunta titulo="A extensão muda o prazo do meu site próprio também?">
              <p style={{ margin: 0 }}>
                Não. Ela muda só o tempo de entrega do iFood. O tempo do seu cardápio próprio continua o que você configurou no painel.
              </p>
            </Pergunta>
          </div>
        </div>

        {/* AJUDA */}
        <div style={{ textAlign: "center", padding: "0.5rem 0 2.5rem" }}>
          <p style={{ ...texto, marginBottom: 12 }}>Travou em algum passo? A gente configura junto com você.</p>
          <a href={SUPORTE} target="_blank" rel="noopener noreferrer" style={{ ...botaoLaranja, background: "#0F766E", boxShadow: "0 6px 18px rgba(15, 118, 110,0.3)" }}>
            <MessageCircle size={18} /> Chamar no WhatsApp
          </a>
        </div>

      </div>
    </div>
  );
}
