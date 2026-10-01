"use client";

/**
 * O PORTAL DO PARCEIRO — uma casa só para quem é embaixador, vendedor ou os
 * dois. /embaixador e /vendedor abrem este mesmo portal (o login é o mesmo);
 * o admin abre o relatório de qualquer parceiro em /admin/parceiros/[id].
 *
 *   Meus números  o relatório (RelatorioDoParceiro)
 *   Conversas     a caixa de atendimento do número do FireHub  ┐
 *   Contatos      o funil do CRM                               ├ só vendedor
 *   Agenda        a agenda compartilhada da equipe            ┘
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Briefcase, CalendarClock, ChartNoAxesColumn, Handshake, LogOut, MessageCircle, Network, Target } from "lucide-react";
import SairDaConta from "@/components/SairDaConta";
import { AtalhoDoOutroPainel } from "@/components/paineis/TrocarDePainel";
import CaixaDeAtendimento from "@/components/crm/CaixaDeAtendimento";
import FunilDoCrm from "@/components/crm/FunilDoCrm";
import AgendaDaEquipe from "@/components/crm/AgendaDaEquipe";
import RelatorioDoParceiro from "@/components/parceiro/RelatorioDoParceiro";
import type { Papel } from "@/lib/parceiro/regras";
import type { RelatorioDoParceiro as Relatorio } from "@/lib/parceiro/relatorio";

type Aba = "numeros" | "conversas" | "contatos" | "agenda";
const ABAS: { chave: Aba; rotulo: string; Icone: typeof Handshake; soVendedor: boolean }[] = [
  { chave: "numeros", rotulo: "Meus números", Icone: ChartNoAxesColumn, soVendedor: false },
  { chave: "conversas", rotulo: "Conversas", Icone: MessageCircle, soVendedor: true },
  { chave: "contatos", rotulo: "Contatos", Icone: Target, soVendedor: true },
  { chave: "agenda", rotulo: "Agenda", Icone: CalendarClock, soVendedor: true },
];

const PAPEL_NO_TOPO: Record<Papel, { nome: string; classe: string; Icone: typeof Handshake }> = {
  EMBAIXADOR: { nome: "Embaixador", classe: "emb", Icone: Handshake },
  REDE: { nome: "Rede", classe: "rede", Icone: Network },
  VENDEDOR: { nome: "Vendedor", classe: "vend", Icone: Briefcase },
};

export default function PortalDoParceiro({
  relatorio,
  modo = "PARCEIRO",
  saida = "/embaixador",
  voltarPara = "/admin?aba=vendedores",
}: {
  relatorio: Relatorio;
  modo?: "PARCEIRO" | "ADMIN";
  /** Para onde o "Sair" leva (PARCEIRO) — a tela de login da porta por onde ele entrou. */
  saida?: string;
  /** ADMIN: a aba de onde o relatório foi aberto. */
  voltarPara?: string;
}) {
  const p = relatorio.parceiro;
  const temCrm = modo === "PARCEIRO" && p.isVendedor;
  const abas = ABAS.filter((a) => !a.soVendedor || temCrm);
  const [aba, setAba] = useState<Aba>("numeros");
  const [contatoParaAbrir, setContatoParaAbrir] = useState<string | null>(null);
  const abrirConversa = (id: string) => {
    setContatoParaAbrir(id);
    setAba("conversas");
  };

  // /vendedor?aba=conversas&contato=… — o link que vai no aviso do vendedor.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pedida = q.get("aba") as Aba | null;
    if (pedida && abas.some((a) => a.chave === pedida)) setAba(pedida);
    const contato = q.get("contato");
    if (contato && temCrm) abrirConversa(contato);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pausado = <div className="pp-faixa pp-faixa-erro">Sua conta de vendedor está pausada. Fale com o administrador.</div>;

  return (
    <div className="pp">
      <style>{ESTILO_DO_PORTAL}</style>

      <header className="pp-topo">
        <div className="pp-topo-dentro">
          <div className="pp-marca">
            <img src="/firehub-flame.png" alt="" />
            <div style={{ minWidth: 0 }}>
              <div className="pp-marca-nome">{modo === "ADMIN" ? `Relatório de ${p.nome}` : "Portal do parceiro"}</div>
              <div className="pp-marca-sub">{modo === "ADMIN" ? p.email : `${p.nome} · ${p.email}`}</div>
            </div>
          </div>
          <div className="pp-topo-dir">
            {p.papeis.map((papel) => {
              const m = PAPEL_NO_TOPO[papel];
              return (
                <span key={papel} className={`pp-topo-papel ${m.classe}`} title={`${m.nome}: ${p.percentuais[papel]}% da mensalidade`}>
                  <i aria-hidden /> {m.nome} {p.percentuais[papel]}%
                </span>
              );
            })}
            {modo === "ADMIN" ? (
              <a className="pp-sair" href={voltarPara}>
                <ArrowLeft size={15} aria-hidden /> Voltar ao admin
              </a>
            ) : (
              <>
              {/* Parceiro que também tem loja (o Victor): abre a loja sem
                  sair. Some para quem só tem o portal. */}
              <AtalhoDoOutroPainel className="pp-sair" tamanhoDoIcone={15} />
              <SairDaConta callbackUrl={saida} className="pp-sair">
                <LogOut size={15} aria-hidden /> Sair
              </SairDaConta>
              </>
            )}
          </div>
        </div>
      </header>

      {abas.length > 1 && (
        <nav className="pp-abas" aria-label="Seções do portal">
          <div className="pp-abas-dentro">
            {abas.map((a) => (
              <button key={a.chave} type="button" className={`pp-aba ${aba === a.chave ? "on" : ""}`} onClick={() => setAba(a.chave)} aria-current={aba === a.chave ? "page" : undefined}>
                <a.Icone size={16} aria-hidden /> {a.rotulo}
              </button>
            ))}
          </div>
        </nav>
      )}

      {aba === "numeros" && (
        <main className="pp-wrap">
          <RelatorioDoParceiro relatorio={relatorio} modo={modo} podeMarcarAtendimento={modo === "PARCEIRO" && p.isVendedor && p.ativo} />
        </main>
      )}
      {aba === "conversas" && (
        <main className="pp-largo">{p.ativo ? <CaixaDeAtendimento modo="VENDEDOR" abrirContatoId={contatoParaAbrir} /> : pausado}</main>
      )}
      {aba === "contatos" && (
        <main className="pp-largo">{p.ativo ? <FunilDoCrm modo="VENDEDOR" aoAbrirConversa={abrirConversa} /> : pausado}</main>
      )}
      {aba === "agenda" && (
        <main className="pp-largo">{p.ativo ? <AgendaDaEquipe modo="VENDEDOR" aoAbrirConversa={abrirConversa} /> : pausado}</main>
      )}
    </div>
  );
}

/**
 * Areia e tinta, como a caixa de atendimento (components/crm/comum.tsx): o
 * Douglas pediu fundo com cor ("tudo branco tá ruim"). Papel em roxo para o
 * que é comissão de embaixador (indicação e, mais claro, rede) e azul para a
 * de vendedor — a mesma cor do papel na barra, no selo e na estrutura.
 */
const ESTILO_DO_PORTAL = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
.pp {
  --pp-fundo: #F3EEE5; --pp-papel: #FFFDF9; --pp-papel-2: #F9F4EC; --pp-linha: #E7DDCD; --pp-linha-forte: #D8CAB4;
  --pp-tinta: #1C1917; --pp-tinta-2: #44403C; --pp-cinza: #6F675E;
  --pp-laranja: #E8360C; --pp-laranja-escuro: #C92E09;
  --pp-emb: #6D28D9; --pp-emb-bg: #EFE9FD; --pp-emb-barra: #7C3AED;
  --pp-rede: #A21CAF; --pp-rede-bg: #F9E8FC; --pp-rede-barra: #C026D3;
  --pp-vend: #1D4ED8; --pp-vend-bg: #E3EBFD; --pp-vend-barra: #2563EB;
  --pp-ok: #15803D; --pp-ok-bg: #E3F4E7;
  --pp-alerta: #9A5B06; --pp-alerta-bg: #FBF0D9;
  --pp-erro: #B91C1C; --pp-erro-bg: #FCE8E6;
  --pp-neutro: #57534E; --pp-neutro-bg: #EFE8DD;
  min-height: 100vh; background: var(--pp-fundo); color: var(--pp-tinta);
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.45;
}
.pp *, .pp *::before, .pp *::after { box-sizing: border-box; }
.pp ::selection { background: #FBD3C4; color: #1C1917; }
.pp :focus-visible { outline: 2px solid var(--pp-laranja); outline-offset: 2px; }
.pp-num { font-variant-numeric: tabular-nums; }

.pp-topo { background: #1C1917; color: #FAFAF9; }
.pp-topo-dentro { max-width: 1240px; margin: 0 auto; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
.pp-marca { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pp-marca img { width: 30px; height: 30px; border-radius: 7px; flex-shrink: 0; }
.pp-marca-nome { font-weight: 800; font-size: 0.95rem; letter-spacing: -0.01em; }
.pp-marca-sub { font-size: 0.74rem; color: #A8A29E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pp-topo-dir { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pp-topo-papel { display: inline-flex; align-items: center; gap: 6px; font-size: 0.74rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; background: #2A2622; color: #E7E5E4; border: 1px solid #3A3531; font-variant-numeric: tabular-nums; }
.pp-topo-papel i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.pp-topo-papel.emb i { background: #A78BFA; } .pp-topo-papel.rede i { background: #E879F9; } .pp-topo-papel.vend i { background: #60A5FA; }
.pp-sair { background: #2A2622; color: #FAFAF9 !important; border: 1px solid #3A3531; border-radius: 8px; padding: 7px 12px; font-weight: 700; font-size: 0.8rem; display: inline-flex; gap: 6px; align-items: center; text-decoration: none; }
.pp-sair:hover { background: #3A3531; }

.pp-abas { background: var(--pp-papel); border-bottom: 1px solid var(--pp-linha); }
.pp-abas-dentro { max-width: 1240px; margin: 0 auto; padding: 0 8px; display: flex; gap: 2px; overflow-x: auto; }
.pp-aba { background: none; border: none; border-bottom: 3px solid transparent; padding: 12px 14px 11px; font: inherit; font-weight: 700; font-size: 0.86rem; color: var(--pp-cinza); cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 7px; }
.pp-aba:hover { color: var(--pp-tinta); }
.pp-aba.on { color: var(--pp-tinta); border-bottom-color: var(--pp-laranja); }

.pp-wrap { max-width: 1240px; margin: 0 auto; padding: 20px 16px 64px; }
.pp-largo { max-width: 1500px; margin: 0 auto; padding: 16px 16px 40px; }
.pp-relatorio { display: flex; flex-direction: column; gap: 16px; }

.pp-h2 { font-size: 1.02rem; font-weight: 800; margin: 0; letter-spacing: -0.01em; display: flex; align-items: baseline; gap: 4px 10px; flex-wrap: wrap; }
.pp-h2 svg { align-self: center; }
.pp-h3 { font-size: 0.92rem; font-weight: 800; margin: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pp-quando { font-size: 0.74rem; font-weight: 600; color: var(--pp-cinza); letter-spacing: 0; }
.pp-sub { margin: 4px 0 0; color: var(--pp-cinza); font-size: 0.84rem; max-width: 72ch; }
.pp-rotulo { display: block; font-size: 0.74rem; font-weight: 600; color: var(--pp-cinza); }

.pp-faixa { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; font-size: 0.86rem; }
.pp-faixa-erro { background: var(--pp-erro-bg); color: #7F1D1D; border: 1px solid #F3C4BF; }
.pp-faixa svg { flex-shrink: 0; margin-top: 1px; }

.pp-painel { background: var(--pp-papel); border: 1px solid var(--pp-linha); border-radius: 16px; box-shadow: 0 1px 2px rgba(28,25,23,.04); }
.pp-painel-cabeca { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px 16px; flex-wrap: wrap; padding: 16px 18px 12px; }

.pp-extrato { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); background: var(--pp-papel); border: 1px solid var(--pp-linha); border-radius: 16px; overflow: hidden; box-shadow: 0 1px 2px rgba(28,25,23,.04), 0 10px 28px -16px rgba(28,25,23,.18); }
.pp-extrato-mes { padding: 20px 22px 16px; }
.pp-total { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.03em; margin: 10px 0 4px; line-height: 1.05; }
.pp-legenda { margin: 0; color: var(--pp-tinta-2); font-size: 0.86rem; max-width: 62ch; }
.pp-aviso-linha { display: flex; gap: 6px; align-items: center; color: var(--pp-alerta); font-size: 0.8rem; font-weight: 600; margin: 8px 0 0; }
.pp-extrato-anterior { background: var(--pp-papel-2); border-left: 1px solid var(--pp-linha); padding: 20px 20px 16px; display: flex; flex-direction: column; gap: 10px; }

.pp-composicao { margin-top: 18px; }
.pp-barra { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--pp-neutro-bg); gap: 2px; }
.pp-barra span { display: block; height: 100%; min-width: 4px; }
.pp-barra .emb, .pp-ponto.emb { background: var(--pp-emb-barra); }
.pp-barra .rede, .pp-ponto.rede { background: var(--pp-rede-barra); }
.pp-barra .vend, .pp-ponto.vend { background: var(--pp-vend-barra); }
.pp-composicao-lista { list-style: none; margin: 10px 0 0; padding: 0; }
.pp-composicao-lista li + li { border-top: 1px solid var(--pp-linha); }
.pp-composicao-lista button { width: 100%; display: grid; grid-template-columns: auto minmax(0,1fr) auto; grid-template-areas: "ponto nome valor" "ponto lojas valor"; column-gap: 10px; row-gap: 1px; align-items: center; background: none; border: none; font: inherit; color: inherit; padding: 9px 6px; cursor: pointer; text-align: left; border-radius: 8px; }
.pp-composicao-lista button:hover { background: var(--pp-papel-2); }
.pp-ponto { grid-area: ponto; width: 10px; height: 10px; border-radius: 3px; display: inline-block; align-self: start; margin-top: 5px; }
.pp-composicao-nome { grid-area: nome; font-weight: 700; }
.pp-composicao-pct { color: var(--pp-cinza); font-weight: 600; margin-left: 4px; }
.pp-composicao-lojas { grid-area: lojas; color: var(--pp-cinza); font-size: 0.78rem; }
.pp-composicao-lista strong { grid-area: valor; font-size: 0.98rem; }

.pp-razao { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.pp-razao-linha { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 0 10px; padding: 9px 11px; border-radius: 10px; background: var(--pp-papel); border: 1px solid var(--pp-linha); width: 100%; font: inherit; color: inherit; text-align: left; }
.pp-razao-rotulo { display: inline-flex; gap: 7px; align-items: center; font-weight: 700; font-size: 0.86rem; }
.pp-razao-linha strong { font-size: 0.98rem; }
.pp-razao-sub { grid-column: 1 / -1; color: var(--pp-cinza); font-size: 0.76rem; padding-left: 23px; }
.pp-razao-linha.ok .pp-razao-rotulo { color: var(--pp-ok); }
.pp-razao-linha.erro .pp-razao-rotulo { color: var(--pp-erro); }
.pp-razao-linha.alerta .pp-razao-rotulo { color: var(--pp-alerta); }
.pp-razao-linha.clicavel { cursor: pointer; transition: border-color .15s, background .15s; }
.pp-razao-linha.clicavel:hover:not(:disabled) { border-color: var(--pp-linha-forte); background: #fff; }
.pp-razao-linha:disabled { cursor: default; }
.pp-razao-linha.erro:disabled .pp-razao-rotulo { color: var(--pp-neutro); }
.pp-progresso { display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: var(--pp-neutro-bg); }
.pp-progresso .ok { background: #22A55A; } .pp-progresso .atraso { background: #E5484D; }
.pp-razao-rodape { margin: 0; font-size: 0.76rem; color: var(--pp-cinza); }
.pp-razao-rodape:empty { display: none; }
.pp-media { border-top: 1px dashed var(--pp-linha-forte); padding-top: 10px; display: flex; justify-content: space-between; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.pp-media strong { font-size: 1.1rem; }
.pp-media-meses { list-style: none; margin: 0; padding: 0; display: flex; gap: 14px; }
.pp-media-meses li { display: flex; flex-direction: column; align-items: flex-end; font-size: 0.72rem; color: var(--pp-cinza); }
.pp-media-meses b { color: var(--pp-tinta-2); font-size: 0.8rem; }

.pp-atencao-lista { list-style: none; margin: 0; padding: 0 8px 8px; }
.pp-atencao-lista li { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 11px 10px; border-top: 1px solid var(--pp-linha); }
.pp-atencao-lista li:first-child { border-top: none; }
.pp-atencao-icone { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--pp-neutro-bg); color: var(--pp-tinta-2); }
.pp-atencao-lista li.erro .pp-atencao-icone { background: var(--pp-erro-bg); color: var(--pp-erro); }
.pp-atencao-lista li.alerta .pp-atencao-icone { background: var(--pp-alerta-bg); color: var(--pp-alerta); }
.pp-atencao-lista strong { font-size: 0.9rem; }
.pp-atencao-lista p { margin: 2px 0 0; font-size: 0.8rem; color: var(--pp-cinza); }
.pp-tudo-certo { display: flex; gap: 8px; align-items: center; margin: 0; padding: 0 18px 16px; color: var(--pp-ok); font-weight: 600; }

.pp-botao { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 9px; padding: 8px 12px; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; text-decoration: none; white-space: nowrap; border: 1px solid var(--pp-linha-forte); background: var(--pp-papel); color: var(--pp-tinta); transition: background .15s, border-color .15s, color .15s; }
.pp-botao:hover:not(:disabled) { background: #fff; border-color: #C9B89E; }
.pp-botao:disabled { opacity: .6; cursor: default; }
.pp-botao.primario { background: var(--pp-laranja); border-color: var(--pp-laranja); color: #fff; }
.pp-botao.primario:hover:not(:disabled) { background: var(--pp-laranja-escuro); border-color: var(--pp-laranja-escuro); }
.pp-botao.escuro { background: var(--pp-tinta); border-color: var(--pp-tinta); color: #fff; }
.pp-botao.escuro:hover:not(:disabled) { background: #2A2622; border-color: #2A2622; }
.pp-botao.whats { background: #E6F6EB; border-color: #BCE3C8; color: #14532D; }
.pp-botao.whats:hover:not(:disabled) { background: #D6F0DF; border-color: #97D2AA; }
.pp-botao.cobrar { background: var(--pp-erro); border-color: var(--pp-erro); color: #fff; }
.pp-botao.cobrar:hover:not(:disabled) { background: #991B1B; border-color: #991B1B; }
.pp-botao.leve { background: transparent; }
.pp-botao.ok { background: var(--pp-ok); border-color: var(--pp-ok); color: #fff; }

.pp-rolagem { overflow-x: auto; padding: 0 8px; }
.pp-matriz { width: 100%; border-collapse: collapse; min-width: 720px; }
.pp-matriz th, .pp-matriz td { padding: 7px 10px; text-align: right; border-top: 1px solid var(--pp-linha); white-space: nowrap; }
.pp-matriz thead th { border-top: none; font-size: 0.74rem; font-weight: 700; color: var(--pp-cinza); padding-top: 2px; }
.pp-matriz th[scope="row"], .pp-matriz thead th:first-child { text-align: left; }
.pp-matriz th[scope="row"] { font-weight: 700; }
.pp-matriz .pp-divisa { border-left: 1px dashed var(--pp-linha-forte); }
.pp-celula { min-width: 40px; background: none; border: 1px solid transparent; border-radius: 8px; padding: 4px 9px; font: inherit; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--pp-tinta); cursor: pointer; transition: background .15s, border-color .15s; }
.pp-celula:hover:not(:disabled) { background: var(--pp-papel-2); border-color: var(--pp-linha-forte); }
.pp-celula.zero { color: #B0A699; cursor: default; font-weight: 500; }
.pp-celula.ok:not(.zero) { color: var(--pp-ok); } .pp-celula.erro:not(.zero) { color: var(--pp-erro); } .pp-celula.forte { font-weight: 800; }
.pp-dinheiro { font-weight: 800; }
.pp-total-linha th, .pp-total-linha td { font-weight: 800; background: var(--pp-papel-2); }
.pp-papel { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; white-space: nowrap; }
.pp-papel.emb { background: var(--pp-emb-bg); color: var(--pp-emb); }
.pp-papel.rede { background: var(--pp-rede-bg); color: var(--pp-rede); }
.pp-papel.vend { background: var(--pp-vend-bg); color: var(--pp-vend); }
.pp-papel-pct { margin-left: 8px; font-size: 0.76rem; color: var(--pp-cinza); font-weight: 600; }
.pp-regra { display: flex; gap: 10px; align-items: flex-start; margin: 6px 18px 14px; padding: 11px 13px; border-radius: 12px; background: var(--pp-emb-bg); color: #3B1C86; font-size: 0.84rem; }
.pp-regra svg { flex-shrink: 0; margin-top: 2px; }
.pp-rede { padding: 4px 18px 16px; }
.pp-rede ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.pp-rede li { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 11px; border: 1px solid var(--pp-linha); border-radius: 10px; background: var(--pp-papel-2); font-size: 0.82rem; }
.pp-rede-nome { font-weight: 700; } .pp-rede-info { color: var(--pp-cinza); }

.pp-selo { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
.pp-selo.ok { background: var(--pp-ok-bg); color: var(--pp-ok); }
.pp-selo.erro { background: var(--pp-erro-bg); color: var(--pp-erro); }
.pp-selo.alerta { background: var(--pp-alerta-bg); color: var(--pp-alerta); }
.pp-selo.neutro { background: var(--pp-neutro-bg); color: var(--pp-neutro); }
.pp-linha .pp-selo { white-space: normal; max-width: 100%; }
.pp-mini { display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; color: var(--pp-cinza); }
.pp-mini.destaque { color: var(--pp-emb); font-weight: 600; }
.pp-mini.erro { color: var(--pp-erro); font-weight: 600; }

.pp-busca { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid var(--pp-linha-forte); border-radius: 10px; padding: 0 10px; width: min(340px, 100%); color: var(--pp-cinza); }
.pp-busca:focus-within { border-color: var(--pp-laranja); box-shadow: 0 0 0 3px rgba(232,54,12,.12); }
.pp-busca input { border: none; outline: none; background: transparent; font: inherit; color: var(--pp-tinta); padding: 9px 0; flex: 1; min-width: 0; }
.pp-busca input::placeholder { color: #968C80; }
.pp-busca button { background: none; border: none; color: var(--pp-cinza); cursor: pointer; display: grid; place-items: center; padding: 4px; border-radius: 6px; }
.pp-ferramentas { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 0 18px 12px; }
.pp-segmento { display: inline-flex; background: var(--pp-neutro-bg); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
.pp-segmento button { border: none; background: none; font: inherit; font-size: 0.8rem; font-weight: 700; color: var(--pp-tinta-2); padding: 6px 11px; border-radius: 8px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.pp-segmento button span { color: var(--pp-cinza); font-weight: 600; }
.pp-segmento button.on { background: var(--pp-papel); color: var(--pp-tinta); box-shadow: 0 1px 2px rgba(28,25,23,.14); }
.pp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pp-chip { border: 1px solid var(--pp-linha-forte); background: var(--pp-papel); color: var(--pp-tinta-2); border-radius: 999px; padding: 5px 11px; font: inherit; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; transition: background .15s, border-color .15s; }
.pp-chip span { color: var(--pp-cinza); font-weight: 600; }
.pp-chip:hover { border-color: #C9B89E; }
.pp-chip.on { background: var(--pp-tinta); border-color: var(--pp-tinta); color: #fff; }
.pp-chip.on span { color: #D6D3D1; }
.pp-chip.erro.on { background: var(--pp-erro); border-color: var(--pp-erro); }
.pp-ordem { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--pp-cinza); }
.pp-ordem select { font: inherit; font-size: 0.8rem; font-weight: 600; color: var(--pp-tinta); background: var(--pp-papel); border: 1px solid var(--pp-linha-forte); border-radius: 8px; padding: 6px 8px; cursor: pointer; }

.pp-lista { border-top: 1px solid var(--pp-linha); }
.pp-linha { display: grid; grid-template-columns: minmax(0,1.9fr) minmax(0,1.4fr) minmax(0,1.25fr) minmax(0,1.15fr) minmax(0,1.35fr) minmax(128px,auto); gap: 14px; padding: 13px 18px; border-bottom: 1px solid var(--pp-linha); align-items: start; }
.pp-linha:last-child { border-bottom: none; border-radius: 0 0 16px 16px; }
.pp-linha:not(.pp-linha-cabeca):hover { background: #FCF8F1; }
.pp-linha.atrasada { background: #FFF7F5; }
.pp-linha.atrasada:hover { background: #FFF1EE; }
.pp-linha-cabeca { padding-top: 9px; padding-bottom: 9px; background: var(--pp-papel-2); font-size: 0.74rem; font-weight: 700; color: var(--pp-cinza); align-items: center; }
.pp-linha > div { display: flex; flex-direction: column; gap: 4px; min-width: 0; align-items: flex-start; }
.pp-loja-nome { font-size: 0.92rem; font-weight: 800; overflow-wrap: anywhere; }
.pp-loja-info { font-size: 0.78rem; color: var(--pp-tinta-2); overflow-wrap: anywhere; }
.pp-loja-info.fraco { color: var(--pp-cinza); font-size: 0.74rem; }
.pp-uso { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 0.82rem; }
.pp-uso i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.pp-uso.ok { color: var(--pp-ok); } .pp-uso.ok i { background: #22A55A; }
.pp-uso.erro { color: var(--pp-erro); } .pp-uso.erro i { background: #E5484D; }
.pp-uso.neutro { color: var(--pp-neutro); } .pp-uso.neutro i { background: #B0A699; }
.pp-sua-parte { font-size: 1rem; font-weight: 800; }
.pp-linha > .pp-c-acoes { align-items: stretch; }
.pp-direita { text-align: right; }
.pp-vazio { padding: 36px 18px 40px; text-align: center; color: var(--pp-cinza); display: flex; flex-direction: column; align-items: center; gap: 8px; border-top: 1px solid var(--pp-linha); }
.pp-vazio p { margin: 0; max-width: 60ch; }
.pp-vazio strong { color: var(--pp-tinta); }

.pp-rodape-grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 16px; align-items: start; }
.pp-indicacao, .pp-como { padding: 16px 18px 18px; }
.pp-link { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.pp-link code { flex: 1 1 220px; min-width: 0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.82rem; background: var(--pp-papel-2); border: 1px solid var(--pp-linha); border-radius: 9px; padding: 9px 11px; overflow-wrap: anywhere; color: var(--pp-tinta-2); }
.pp-como ul { margin: 10px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 0.84rem; color: var(--pp-tinta-2); max-width: 75ch; }

@media (max-width: 1080px) {
  .pp-linha { grid-template-columns: minmax(0,1.5fr) minmax(0,1.2fr) minmax(0,1.2fr); }
  .pp-linha-cabeca { display: none; }
  .pp-c-mes::before, .pp-c-anterior::before { content: attr(data-rotulo); font-size: 0.7rem; font-weight: 700; color: var(--pp-cinza); }
  .pp-linha > .pp-c-acoes { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; align-items: center; }
}
@media (max-width: 880px) {
  .pp-extrato { grid-template-columns: 1fr; }
  .pp-extrato-anterior { border-left: none; border-top: 1px solid var(--pp-linha); }
  .pp-total { font-size: 2.2rem; }
}
@media (max-width: 640px) {
  .pp-wrap { padding: 14px 12px 48px; }
  .pp-linha { grid-template-columns: minmax(0,1fr) minmax(0,1fr); padding: 14px; gap: 12px; }
  .pp-c-loja { grid-column: 1 / -1; }
  .pp-ordem { margin-left: 0; }
  .pp-atencao-lista li { grid-template-columns: auto minmax(0,1fr); }
  .pp-atencao-lista li .pp-botao { grid-column: 2; justify-self: start; }
  .pp-painel-cabeca { padding: 14px 14px 10px; }
  .pp-ferramentas { padding: 0 14px 12px; }
  .pp-extrato-mes, .pp-extrato-anterior { padding: 16px; }
  .pp-busca { width: 100%; }
  .pp-regra { margin: 6px 14px 14px; }
  .pp-rede { padding: 4px 14px 14px; }
  .pp-topo-dir { width: 100%; }
  .pp-topo-dir .pp-sair { margin-left: auto; }
}
@media (prefers-reduced-motion: reduce) { .pp * { transition: none !important; scroll-behavior: auto !important; } }
`;
