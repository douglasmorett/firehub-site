"use client";

/**
 * A barra lateral do painel — o desenho que o lojista já conhece do iFood.
 *
 * ── Por que deixou de ser barra horizontal ──────────────────────────────────
 *
 * Eram 16 itens numa linha só. Para caber, a fonte encolhia por degraus de
 * media query até 0,58rem — "Validade & Etiquetas" virava um borrão, e em
 * telas menores a linha quebrava e o menu tomava duas faixas da tela. Em pé,
 * cada item tem a largura inteira: nome legível, ícone, selo, e espaço para o
 * título do grupo dizer onde procurar.
 *
 * Recolhida (só ícones) fica com 64px, e a escolha é lembrada por navegador —
 * quem opera o dia inteiro no KDS quer a tela, não o menu.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart2, Bike, BookOpen, Bot, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Home, LineChart, MapPin, Menu, Monitor, Package, PieChart, Printer, Puzzle, Receipt,
  Send, ShoppingBag, Store, TabletSmartphone, Tag, Truck, UtensilsCrossed, Users, Wallet,
  X, Zap, type LucideIcon,
} from "lucide-react";
import { menuDaLoja, type ItemDoMenu } from "@/lib/menu-do-painel";
import StoreSelector from "./StoreSelector";

const ICONES: Record<string, LucideIcon> = {
  BarChart2, Bike, BookOpen, Bot, CheckCircle2, ClipboardList, Home, LineChart, MapPin,
  Monitor, Package, PieChart, Printer, Puzzle, Receipt, Send, ShoppingBag, Store,
  TabletSmartphone, Tag, Truck, UtensilsCrossed, Users, Wallet, Zap,
};

const CHAVE_RECOLHIDA = "firehub_menu_recolhido";

export default function StoreSidebar({
  nomeDaLoja,
  logo,
  cidade,
  slug,
  mostrarAntecipacao = false,
  mostrarCompras = false,
  isAdmin = false,
}: {
  nomeDaLoja: string;
  /** A logo que a loja cadastrou. Sem ela, vale a chama do FireHub. */
  logo?: string | null;
  cidade?: string | null;
  slug?: string | null;
  mostrarAntecipacao?: boolean;
  mostrarCompras?: boolean;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [recolhida, setRecolhida] = useState(false);
  const [aberta, setAberta] = useState(false); // gaveta do celular
  const [logoFalhou, setLogoFalhou] = useState(false);
  /** Itens com sub-telas abertos agora (pelo href do pai). */
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [logoAtual, setLogoAtual] = useState<string | null>(logo || null);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const campoDeArquivo = useRef<HTMLInputElement>(null);

  /**
   * Trocar a logo daqui mesmo: escolher o arquivo, subir e gravar.
   *
   * A mesma dupla de rotas que a tela de Minha Loja usa — /api/upload-store-image
   * guarda o arquivo e /api/store-settings grava o endereço. Reaproveitar
   * evita duas formas diferentes de fazer a mesma coisa, que é como uma
   * delas envelhece sem ninguém notar.
   */
  const trocarLogo = async (arquivo: File) => {
    if (!arquivo.type.startsWith("image/")) {
      alert("Escolha uma imagem (PNG, JPG ou WEBP).");
      return;
    }
    setEnviandoLogo(true);
    try {
      const dados = new FormData();
      dados.append("file", arquivo);
      dados.append("type", "logo");
      const envio = await fetch("/api/upload-store-image", { method: "POST", body: dados });
      if (!envio.ok) throw new Error("upload");
      const { url } = await envio.json();
      const gravou = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeLogo: url }),
      });
      if (!gravou.ok) throw new Error("salvar");
      setLogoAtual(url);
      setLogoFalhou(false);
    } catch {
      alert("Não consegui trocar a logo agora. Tente de novo em instantes.");
    } finally {
      setEnviandoLogo(false);
      if (campoDeArquivo.current) campoDeArquivo.current.value = "";
    }
  };

  useEffect(() => {
    try {
      setRecolhida(localStorage.getItem(CHAVE_RECOLHIDA) === "1");
    } catch {}
  }, []);

  // ── CELULAR/TABLET EM PÉ: A BARRA É GAVETA ─────────────────────────────
  //
  // O mesmo corte de 900px do CSS, medido também em JS — porque quem esconde
  // os rótulos do menu é o React (`!recolhida`), não o CSS. Sem isto, quem
  // recolheu a barra no computador abria o celular e recebia uma gaveta de
  // 252px com ícones centralizados e nenhum nome: a largura vinha da media
  // query e os nomes continuavam escondidos pelo estado.
  const [ehCelular, setEhCelular] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const ler = () => setEhCelular(mq.matches);
    ler();
    mq.addEventListener("change", ler);
    return () => mq.removeEventListener("change", ler);
  }, []);
  /** Recolhida só faz sentido na barra fixa; na gaveta ela é sempre inteira. */
  const enxuta = recolhida && !ehCelular;

  // Gaveta aberta trava o fundo. Sem isto o dedo rolava a página atrás da
  // cortina e, ao fechar, a tela estava em outro lugar.
  useEffect(() => {
    if (!aberta) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, [aberta]);

  // Navegou: a gaveta fecha sozinha, senão o lojista escolhe uma tela e
  // continua olhando para o menu por cima dela.
  useEffect(() => { setAberta(false); }, [pathname]);

  const alternarRecolhida = () => {
    setRecolhida((r) => {
      const novo = !r;
      try { localStorage.setItem(CHAVE_RECOLHIDA, novo ? "1" : "0"); } catch {}
      return novo;
    });
  };

  const grupos = menuDaLoja({ antecipacao: mostrarAntecipacao, compras: mostrarCompras });

  // O caminho COM o # — é o que distingue "Entrega" de "Pagamento", que são
  // a mesma rota. `usePathname` não enxerga hash, então vem do próprio
  // navegador e é atualizado no `hashchange`.
  const [cru, setCru] = useState("");
  useEffect(() => {
    const ler = () => setCru(window.location.pathname + window.location.hash);
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, [pathname]);

  // O módulo de compras (IceBox) sempre rodou sem o menu do painel — ele tem
  // navegação própria. A barra lateral herda a mesma regra da barra antiga.
  //
  // ESTE RETURN FICA DEPOIS DE TODOS OS HOOKS, e não pode subir. A barra vive
  // no layout: ela não desmonta ao navegar. Com o return acima do `useState`
  // abaixo, ir de /store/mesas para /store/orders renderizava dois hooks a
  // menos na mesma instância — "Rendered fewer hooks than expected", tela
  // branca do painel inteiro, socorrida só pelo error.tsx.
  const ehCompras = pathname?.startsWith("/store/compras") || pathname?.startsWith("/store/orders");
  if (ehCompras) return null;

  const ehAtivo = (item: ItemDoMenu) => {
    const p = String(pathname || "");
    if (item.href === "/store") return p === "/store";
    return p.startsWith(item.href);
  };

  return (
    <>
      <style>{ESTILO}</style>

      {/* ── BARRA DE APLICATIVO (só no celular e no tablet em pé) ────────

          Era um botão solto, `position:fixed` no canto 10/10. Como flutuava
          sobre o documento, pousava em cima do primeiro controle de cada
          tela — no módulo de mesa tapava metade do botão "← Pedidos" — e a
          cada rolagem ia parar em cima de outra coisa.

          Agora é barra de largura inteira, fundo opaco, com o conteúdo
          empurrado para baixo dela (.fh-conteudo, no layout). Nada passa por
          trás do botão, e o lojista recupera o nome da loja no topo, que ele
          perdeu quando o menu virou gaveta. */}
      <div className="fh-menu-barra">
        <button className="fh-menu-botao" onClick={() => setAberta(true)} aria-label="Abrir menu">
          <Menu size={20} />
        </button>
        <span className="fh-menu-barra-nome">{nomeDaLoja || "Minha loja"}</span>
      </div>

      {aberta && <div className="fh-menu-cortina" onClick={() => setAberta(false)} />}

      <aside className={`fh-menu${enxuta ? " recolhida" : ""}${aberta ? " aberta" : ""}`}>
        <div className="fh-menu-topo">
          {/* A logo é BOTÃO: clicou, escolhe o arquivo e ela troca na hora.
              Antes, mudar a logo era achar Minha Loja → Dados da loja → caixa
              de upload. Aqui ela está na frente do lojista o dia inteiro. */}
          <button
            type="button"
            className="fh-menu-logo"
            onClick={() => campoDeArquivo.current?.click()}
            title={enviandoLogo ? "Enviando…" : "Trocar a logo da loja"}
            disabled={enviandoLogo}
          >
              <img
                src={logoAtual && !logoFalhou ? logoAtual : "/firehub-flame.png"}
                alt=""
                onError={() => setLogoFalhou(true)}
                ref={(el) => {
                  // A imagem do HTML do servidor pode falhar ANTES do React
                  // ligar o onError — o evento acontece e se perde, e o ícone
                  // de imagem quebrada fica na tela para sempre. Ao montar,
                  // pergunta ao próprio elemento: terminou de carregar com
                  // largura zero? Então não carregou.
                  if (el && el.complete && el.naturalWidth === 0) setLogoFalhou(true);
                }}
              />
            <span className="fh-menu-logo-troca">{enviandoLogo ? "…" : "✎"}</span>
          </button>
          <input
            ref={campoDeArquivo}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) trocarLogo(f); }}
          />
          {!enxuta && (
            <Link href="/store" className="fh-menu-nome">
              <b>{nomeDaLoja || "Minha loja"}</b>
              {cidade && <span>{cidade}</span>}
            </Link>
          )}
          <button className="fh-menu-fechar" onClick={() => setAberta(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>

        {/* Trocar de loja fica ao lado do nome da loja, não numa faixa
            separada lá em cima: quem tem mais de uma opera olhando para cá. */}
        {!enxuta && (
          <div style={{ padding: "0 12px 8px" }}>
            <StoreSelector variante="lateral" />
          </div>
        )}

        {slug && !enxuta && (
          <a href={`/loja/${slug}`} target="_blank" rel="noopener noreferrer" className="fh-menu-cardapio">
            Ver meu cardápio
          </a>
        )}

        <nav className="fh-menu-lista">
          {grupos.map((grupo) => (
            <div key={grupo.titulo} className="fh-menu-grupo">
              {!enxuta && <span className="fh-menu-grupo-titulo">{grupo.titulo}</span>}
              {grupo.itens.map((item) => {
                const Icone = ICONES[item.icone] || Home;
                const ativo = ehAtivo(item);
                // Abre sozinho quando já se está na tela dele: quem entrou em
                // Minha Loja vê na hora o que tem dentro.
                const temFilhos = !enxuta && !!item.filhos?.length;
                const aberto = temFilhos && (abertos[item.href] ?? ativo);
                return (
                  <div key={item.href}>
                    <div className={`fh-menu-linha${ativo ? " ativo" : ""}`}>
                      {/* `novaAba` sai como <a> com target: o Link do Next
                          navega na mesma guia e o lojista perdia a tela de
                          pedidos de onde veio. */}
                      <Link
                        href={item.href}
                        target={item.novaAba ? "_blank" : undefined}
                        rel={item.novaAba ? "noopener noreferrer" : undefined}
                        className={`fh-menu-item${ativo ? " ativo" : ""}${temFilhos ? " com-filhos" : ""}`}
                        title={enxuta ? item.label : undefined}
                      >
                        <Icone size={17} className="fh-menu-icone" />
                        {!enxuta && (
                          <>
                            <span className="fh-menu-label">{item.label}</span>
                            {item.destaque && <span className="fh-menu-ponto" />}
                            {item.selo && <span className={`fh-menu-selo${item.selo === "EM TESTES" ? " teste" : ""}`}>{item.selo}</span>}
                          </>
                        )}
                      </Link>
                      {temFilhos && (
                        <button
                          type="button"
                          className={`fh-menu-abrir${aberto ? " aberto" : ""}`}
                          onClick={() => setAbertos((a) => ({ ...a, [item.href]: !aberto }))}
                          title={aberto ? "Fechar" : "Ver o que tem dentro"}
                          aria-expanded={aberto}
                        >
                          <ChevronDown size={14} />
                        </button>
                      )}
                    </div>

                    {temFilhos && aberto && (
                      <div className="fh-menu-filhos">
                        {/* <a> de verdade, não <Link>: a tela de Minha Loja
                            escolhe a seção pelo # da URL, e o Link do Next troca
                            o hash por pushState — que NÃO dispara hashchange. O
                            endereço mudava e a tela ficava na seção anterior. */}
                        {item.filhos!.map((f) => (
                          <a
                            key={f.href}
                            href={f.href}
                            className={`fh-menu-filho${cru === f.href ? " ativo" : ""}`}
                          >
                            {f.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {isAdmin && (
            <div className="fh-menu-grupo">
              {!enxuta && <span className="fh-menu-grupo-titulo">Admin</span>}
              <Link href="/store/admin/lojistas" className={`fh-menu-item admin${pathname?.startsWith("/store/admin") ? " ativo" : ""}`} title={enxuta ? "Lojistas" : undefined}>
                <Store size={17} className="fh-menu-icone" />
                {!enxuta && <span className="fh-menu-label">Lojistas</span>}
              </Link>
            </div>
          )}
        </nav>

        <button className="fh-menu-recolher" onClick={alternarRecolhida} title={enxuta ? "Expandir menu" : "Recolher menu"}>
          {enxuta ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </aside>
    </>
  );
}

const ESTILO = `
:root{ --fh-barra-celular:50px; }
.fh-menu{
  width:248px; flex-shrink:0; background:#12161C; color:#CBD5E1;
  display:flex; flex-direction:column; position:sticky; top:0; height:100vh;
  /* containing block do botão redondo de recolher */
  border-right:1px solid #1F2731; z-index:60;
}
.fh-menu.recolhida{ width:64px; }

.fh-menu-topo{ display:flex; align-items:center; gap:9px; padding:14px 12px 10px; }
.fh-menu-topo{ position:relative; }
.fh-menu-nome{ display:flex; flex-direction:column; min-width:0; flex:1; text-decoration:none; color:inherit; }
.fh-menu-nome:hover b{ color:#fff; }
.fh-menu-logo{ position:relative; width:38px; height:38px; min-width:38px; border-radius:10px;
  background:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0;
  overflow:hidden; border:1px solid rgba(255,255,255,.16); padding:0; cursor:pointer; }
.fh-menu-logo:disabled{ cursor:progress; }
.fh-menu-logo img{ width:100%; height:100%; object-fit:cover; display:block; }
/* O lápis só aparece no hover: a logo é identidade, não um formulário. */
.fh-menu-logo-troca{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(15,23,42,.62); color:#fff; font-size:.9rem; opacity:0; transition:opacity .15s ease; }
.fh-menu-logo:hover .fh-menu-logo-troca,.fh-menu-logo:disabled .fh-menu-logo-troca{ opacity:1; }
.fh-menu-nome{ display:flex; flex-direction:column; min-width:0; }
.fh-menu-nome b{ font-size:.86rem; font-weight:800; color:#F8FAFC; line-height:1.25; }
.fh-menu-nome span{ font-size:.7rem; color:#94A3B8; line-height:1.3; }
.fh-menu-fechar{ display:none; background:none; border:none; color:#94A3B8; cursor:pointer; padding:4px; }

.fh-menu-cardapio{
  margin:0 12px 10px; padding:7px 10px; border-radius:9px; text-align:center;
  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
  color:#E2E8F0; font-size:.74rem; font-weight:700; text-decoration:none;
}
.fh-menu-cardapio:hover{ background:rgba(255,255,255,.12); }

.fh-menu-lista{ flex:1; overflow-y:auto; padding:2px 8px 8px; }
.fh-menu-lista::-webkit-scrollbar{ width:6px; }
.fh-menu-lista::-webkit-scrollbar-thumb{ background:#2A3441; border-radius:3px; }
.fh-menu-grupo{ margin-bottom:10px; }
.fh-menu-grupo-titulo{
  display:block; font-size:.62rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:#64748B; padding:8px 10px 5px;
}
.fh-menu-item{
  display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:9px;
  color:#CBD5E1; text-decoration:none; font-size:.8rem; font-weight:600; margin-bottom:1px;
  min-height:36px;
  transition:background .12s ease, color .12s ease;
}
.fh-menu-item:hover{ background:rgba(255,255,255,.07); color:#fff; }
.fh-menu-item.ativo{ background:#C62828; color:#fff; font-weight:800; }
.fh-menu-item.ativo .fh-menu-icone{ color:#fff; }
.fh-menu-icone{ flex-shrink:0; color:#94A3B8; }
.fh-menu-item:hover .fh-menu-icone{ color:#fff; }
/* O nome do item QUEBRA em duas linhas em vez de virar reticências.
   "Checklist e ponto" saía como "Checklist e p..." ao lado do selo
   FIRECHECK — menu que esconde o próprio nome não é menu. */
.fh-menu-label{ flex:1; min-width:0; white-space:normal; line-height:1.3; }
.fh-menu-linha{ display:flex; align-items:stretch; gap:2px; }
.fh-menu-linha .fh-menu-item{ flex:1; min-width:0; }
.fh-menu-abrir{ width:28px; border:none; background:none; color:#64748B; cursor:pointer;
  display:flex; align-items:center; justify-content:center; border-radius:8px; flex-shrink:0;
  transition:transform .15s ease, color .15s ease; font-family:inherit; }
.fh-menu-abrir:hover{ color:#fff; background:rgba(255,255,255,.07); }
.fh-menu-abrir.aberto{ transform:rotate(180deg); color:#CBD5E1; }
.fh-menu-linha.ativo .fh-menu-abrir{ color:#fff; }
/* Os filhos ficam recuados e presos por uma linha vertical: quem olha sabe
   que são as telas de dentro, não itens novos do menu. */
.fh-menu-filhos{ display:flex; flex-direction:column; margin:2px 0 6px 22px;
  padding-left:10px; border-left:1px solid #2A3441; }
.fh-menu-filho{ padding:6px 9px; border-radius:7px; color:#94A3B8; text-decoration:none;
  font-size:.755rem; font-weight:600; line-height:1.3; }
.fh-menu-filho:hover{ color:#fff; background:rgba(255,255,255,.06); }
.fh-menu-filho.ativo{ color:#fff; background:rgba(198,40,40,.35); font-weight:800; }
.fh-menu-ponto{ width:7px; height:7px; border-radius:50%; background:#EF4444; flex-shrink:0; }
.fh-menu-item.ativo .fh-menu-ponto{ background:#fff; }
.fh-menu-selo{
  font-size:.54rem; font-weight:900; padding:2px 5px; border-radius:4px; flex-shrink:0;
  align-self:center;
  background:#FEE2E2; color:#991B1B; letter-spacing:.03em;
}
.fh-menu-selo.teste{ background:#FEF08A; color:#854D0E; }
.fh-menu.recolhida .fh-menu-item{ justify-content:center; padding:10px 0; }
.fh-menu.recolhida .fh-menu-grupo{ margin-bottom:6px; border-top:1px solid #1F2731; padding-top:6px; }
.fh-menu.recolhida .fh-menu-grupo:first-child{ border-top:none; }

/* Redondo e na BORDA da barra, como o do iFood e o da Brendi: é onde a
   pessoa já procura, e continua alcançável com a barra recolhida — no
   rodapé, ele sumia justamente quando a barra estava estreita. */
/* DENTRO da barra, nunca pendurada para fora.

   Em -14px ela invadia a coluna do conteúdo e ficava atrás da faixa
   vermelha do topo — cortada em algumas telas e inteira em outras, porque
   depende de onde a faixa começa em cada largura. Botão que aparece
   diferente em cada PC é botão que o lojista não confia. */
.fh-menu-recolher{
  position:absolute; top:14px; right:10px;
  /* Largura E altura travadas nos dois sentidos: só width/height num filho
     de flex ainda estica, e a bolinha saía ovalada. */
  width:28px; min-width:28px; max-width:28px;
  height:28px; min-height:28px; max-height:28px;
  border-radius:999px; box-sizing:border-box; padding:0; line-height:0;
  display:flex; align-items:center; justify-content:center; flex:0 0 auto;
  background:#fff; border:1px solid #CBD5E1; color:#334155; cursor:pointer;
  box-shadow:0 2px 10px rgba(0,0,0,.25); z-index:61; font-family:inherit;
}
.fh-menu-recolher:hover{ background:#C62828; border-color:#C62828; color:#fff; }
/* No rail de 64px não cabe logo e seta lado a lado: a seta desce. */
.fh-menu.recolhida .fh-menu-recolher{ top:60px; right:18px; }
/* O nome da loja não passa por baixo da seta. */
.fh-menu-topo{ padding-right:46px; }
.fh-menu.recolhida .fh-menu-topo{ padding-right:12px; }

/* A barra de aplicativo do celular. Largura inteira e fundo opaco: o botao
   do menu tem casa propria e nunca mais pousa em cima do conteudo. */
.fh-menu-barra{
  display:none; position:fixed; left:0; right:0; top:0; z-index:70;
  height:var(--fh-barra-celular); align-items:center; gap:8px; padding:0 6px;
  background:#12161C; box-shadow:0 2px 10px rgba(0,0,0,.22);
  padding-top:env(safe-area-inset-top);
  box-sizing:content-box;
}
.fh-menu-barra-nome{
  color:#F8FAFC; font-weight:800; font-size:.92rem; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.fh-menu-botao{
  display:none; width:42px; height:42px; border-radius:10px; border:none; cursor:pointer;
  background:transparent; color:#fff; align-items:center; justify-content:center;
  flex-shrink:0; padding:0;
}
.fh-menu-botao:active{ background:rgba(255,255,255,.12); }
.fh-menu-cortina{ display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:59; }

@media (max-width: 900px){
  .fh-menu{
    position:fixed; left:0; top:0; bottom:0; height:100dvh; width:min(300px, 84vw);
    transform:translateX(-100%); transition:transform .2s ease;
  }
  .fh-menu.aberta{ transform:translateX(0); }
  .fh-menu.recolhida{ width:min(300px, 84vw); }
  .fh-menu-fechar{ display:block; padding:8px; }
  .fh-menu-recolher{ display:none; }
  .fh-menu-barra{ display:flex; }
  .fh-menu-botao{ display:flex; }
  .fh-menu-cortina{ display:block; }
  /* Alvo de dedo: 44px e o minimo para quem opera em pe, no salao. */
  .fh-menu-item{ min-height:44px; font-size:.86rem; }
  .fh-menu-filho{ min-height:40px; display:flex; align-items:center; font-size:.8rem; }
  .fh-menu-abrir{ width:44px; }
  .fh-menu-topo{ padding-right:12px; }
  /* O conteudo do painel comeca abaixo da barra de aplicativo. */
  .fh-conteudo{ padding-top:calc(var(--fh-barra-celular) + env(safe-area-inset-top)); }
}
`;
