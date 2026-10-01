"use client";

/**
 * "MEUS NÚMEROS" — o relatório do parceiro (lib/parceiro/relatorio.ts).
 *
 * Pedido do Douglas (30/09/2026), a partir do Victor, que é embaixador e
 * vendedor: deixar muito claro em que papel ele está em cada loja, quanto vai
 * receber no mês até agora, quem está ativo e quem não está, e quem está
 * inadimplente — ele só recebe de quem paga, e às vezes vai lá cobrar.
 *
 * A cobrança sai do WhatsApp DELE (link wa.me), nunca do número do FireHub:
 * aquele número só responde (regra do Douglas, 30/09/2026).
 */
import { useMemo, useState } from "react";
import {
  ArrowUpDown, Briefcase, CircleCheck, CircleDollarSign, CirclePause, Clock, Copy, Check, ExternalLink,
  FileWarning, Handshake, Hourglass, Info, MessageCircle, Network, PhoneCall, Search, TriangleAlert, Undo2, UserCheck, X,
} from "lucide-react";
import type { LojaDoRelatorio, Papel, Repasse } from "@/lib/parceiro/regras";
import type { RelatorioDoParceiro } from "@/lib/parceiro/relatorio";

// ─── Formatos ───────────────────────────────────────────────────────────────

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesExtenso = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1] || ym;
const mesCurto = (ym: string) => mesExtenso(ym).slice(0, 3);
const Mes = (ym: string) => mesExtenso(ym).charAt(0).toUpperCase() + mesExtenso(ym).slice(1);
const dataCurta = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
const primeiroNome = (nome: string | null | undefined) => String(nome || "").trim().split(/\s+/)[0] || "";
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function linkDoWhatsApp(telefone: string | null, texto: string): string | null {
  const d = String(telefone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}?text=${encodeURIComponent(texto)}`;
}

// ─── Papéis ─────────────────────────────────────────────────────────────────

const PAPEL: Record<Papel, { nome: string; curto: string; classe: string; Icone: typeof Handshake; explica: (pct: number) => string }> = {
  EMBAIXADOR: { nome: "Você indicou", curto: "Indicação", classe: "emb", Icone: Handshake, explica: (p) => `${p}% da mensalidade das lojas que você indicou` },
  REDE: { nome: "Sua rede", curto: "Rede", classe: "rede", Icone: Network, explica: (p) => `${p}% das lojas dos embaixadores que você trouxe` },
  VENDEDOR: { nome: "Sua carteira", curto: "Carteira", classe: "vend", Icone: Briefcase, explica: (p) => `${p}% das lojas que a FireHub passou para você acompanhar` },
};

const REPASSE: Record<Exclude<Repasse, "CAI">, string> = {
  SEM_CARTEIRA: "Sem carteira Asaas: a sua parte não tem para onde cair.",
  PARCEIRO_INATIVO: "Sua conta está pausada: o split não inclui você.",
  INDICADOR_FORA: "O embaixador que indicou está sem carteira Asaas ou inativo — sem ele no split, a rede também fica de fora.",
  ACIMA_DO_TETO: "Os percentuais desta loja passam de 40%: o boleto sai sem split. Fale com a FireHub.",
};

// ─── Filtros ────────────────────────────────────────────────────────────────

type FiltroDeSituacao = "TODAS" | "VENDENDO" | "PARADAS" | "NUNCA" | "TESTE" | "ATRASADAS" | "AGUARDANDO" | "SEM_BOLETO";
type Ordem = "ATENCAO" | "COMISSAO" | "RECENTES" | "NOME";

const FILTROS: { chave: FiltroDeSituacao; rotulo: string; so?: (l: LojaDoRelatorio) => boolean }[] = [
  { chave: "TODAS", rotulo: "Todas" },
  { chave: "VENDENDO", rotulo: "Vendendo", so: (l) => l.uso.situacao === "ATIVA" },
  { chave: "PARADAS", rotulo: "Paradas", so: (l) => l.uso.situacao === "PARADA" },
  { chave: "NUNCA", rotulo: "Nunca venderam", so: (l) => l.uso.situacao === "NUNCA_VENDEU" },
  { chave: "TESTE", rotulo: "Em teste", so: (l) => l.teste.ativo },
  { chave: "ATRASADAS", rotulo: "Atrasadas", so: (l) => !!l.emAberto?.vencida },
  { chave: "AGUARDANDO", rotulo: "Esperando contato", so: (l) => l.carteira?.atendimento === "AGUARDANDO" },
  { chave: "SEM_BOLETO", rotulo: "Sem boleto", so: (l) => l.mesAnterior.situacao === "SEM_BOLETO" },
];

/** Quanto a loja pede atenção agora — a ordem padrão da lista. */
function urgencia(l: LojaDoRelatorio): number {
  if (l.emAberto?.vencida) return 1000 + l.emAberto.diasDeAtraso;
  if (l.carteira?.atendimento === "AGUARDANDO") return 800;
  if (l.mesAnterior.situacao === "SEM_BOLETO") return 600;
  if (l.uso.situacao === "PARADA" && !l.teste.ativo) return 400 + Math.min(99, l.uso.diasSemPedido || 0);
  if (l.teste.ativo && l.teste.diasRestantes <= 5) return 300 - l.teste.diasRestantes;
  if (l.uso.situacao === "NUNCA_VENDEU") return 200;
  return 0;
}

// ─── O relatório ────────────────────────────────────────────────────────────

export default function RelatorioDoParceiro({
  relatorio,
  modo,
  podeMarcarAtendimento,
}: {
  relatorio: RelatorioDoParceiro;
  modo: "PARCEIRO" | "ADMIN";
  podeMarcarAtendimento: boolean;
}) {
  const { parceiro, resumo, meses, rede } = relatorio;
  const [lojas, setLojas] = useState(relatorio.lojas);
  const [papel, setPapel] = useState<"TODOS" | Papel>("TODOS");
  const [situacao, setSituacao] = useState<FiltroDeSituacao>("TODAS");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("ATENCAO");
  const [salvando, setSalvando] = useState<string | null>(null);

  const quem = modo === "ADMIN" ? "a equipe da FireHub" : `${primeiroNome(parceiro.nome)}, da FireHub`;
  const papeis = parceiro.papeis.length ? parceiro.papeis : (["EMBAIXADOR"] as Papel[]);

  const filtrar = (p: "TODOS" | Papel, s: FiltroDeSituacao) => {
    setPapel(p);
    setSituacao(s);
    setBusca("");
    requestAnimationFrame(() => document.getElementById("pp-lojas")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const digitos = q.replace(/\D/g, "");
    const filtro = FILTROS.find((f) => f.chave === situacao)?.so;
    const lista = lojas.filter(
      (l) =>
        (papel === "TODOS" || l.papel === papel) &&
        (!filtro || filtro(l)) &&
        (!q ||
          [l.nome, l.dono, l.cidade, l.email, l.via?.nome].some((v) => String(v || "").toLowerCase().includes(q)) ||
          (digitos.length >= 4 && String(l.telefone || "").replace(/\D/g, "").includes(digitos)))
    );
    return [...lista].sort((a, b) => {
      if (ordem === "NOME") return a.nome.localeCompare(b.nome, "pt-BR");
      if (ordem === "RECENTES") return b.cadastradaEm.localeCompare(a.cadastradaEm);
      if (ordem === "COMISSAO") return b.mesAtual.comissao - a.mesAtual.comissao;
      return urgencia(b) - urgencia(a) || b.mesAtual.comissao - a.mesAtual.comissao;
    });
  }, [lojas, papel, situacao, busca, ordem]);

  const contagem = (s: FiltroDeSituacao) => {
    const f = FILTROS.find((x) => x.chave === s)?.so;
    return lojas.filter((l) => (papel === "TODOS" || l.papel === papel) && (!f || f(l))).length;
  };

  const marcar = async (l: LojaDoRelatorio, status: "ATENDIDO" | "AGUARDANDO") => {
    setSalvando(l.id);
    try {
      const r = await fetch(`/api/vendedor/clientes/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error || "Não consegui salvar. Tente de novo.");
        return;
      }
      const agora = new Date().toISOString();
      setLojas((prev) =>
        prev.map((x) => (x.id === l.id && x.carteira ? { ...x, carteira: { ...x.carteira, atendimento: status, atendidoEm: status === "ATENDIDO" ? agora : null } } : x))
      );
    } catch {
      alert("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  };

  const ant = resumo.mesAnterior;
  const totalAnterior = ant.recebido + ant.aVencer + ant.atrasado + ant.semBoleto;
  const hoje = dataCurta(relatorio.geradoEm);
  const semRepasseGeral = !parceiro.temCarteira || !parceiro.ativo;

  return (
    <div className="pp-relatorio">
      {semRepasseGeral && (
        <div className="pp-faixa pp-faixa-erro" role="alert">
          <TriangleAlert size={18} aria-hidden />
          <div>
            {!parceiro.ativo ? (
              <><strong>A conta {modo === "ADMIN" ? "deste parceiro" : "sua"} está pausada.</strong> Enquanto estiver assim, o split do Asaas não inclui {modo === "ADMIN" ? "ele" : "você"}.</>
            ) : (
              <><strong>{modo === "ADMIN" ? "Ele ainda não tem" : "Você ainda não tem"} carteira no Asaas cadastrada.</strong> Sem ela, a comissão não tem para onde cair. {modo === "ADMIN" ? "Cadastre o ID da carteira na aba Embaixadores ou Vendedores." : "Envie o ID da sua carteira Asaas para a FireHub."}</>
            )}
          </div>
        </div>
      )}

      {/* ── EXTRATO ─────────────────────────────────────────────────── */}
      <section className="pp-extrato" aria-labelledby="pp-extrato-titulo">
        <div className="pp-extrato-mes">
          <h2 id="pp-extrato-titulo" className="pp-h2">
            {Mes(meses.atual)} até agora <span className="pp-quando">atualizado em {hoje}</span>
          </h2>
          <p className="pp-total pp-num">{brl(resumo.mesAtual.comissao)}</p>
          <p className="pp-legenda">
            de comissão sobre as mensalidades de {mesExtenso(meses.atual)}. O mês fecha no dia 1º, o boleto vence no dia 5 e a sua parte cai
            no Asaas quando cada loja pagar.
          </p>
          {resumo.mesAtual.semRepasse > 0 && !semRepasseGeral && (
            <p className="pp-aviso-linha">
              <Info size={15} aria-hidden /> Mais {brl(resumo.mesAtual.semRepasse)} que a conta daria não caem — veja as lojas com o aviso de repasse.
            </p>
          )}

          <Composicao resumo={resumo} papeis={papeis} percentuais={parceiro.percentuais} aoFiltrar={(p) => filtrar(p, "TODAS")} />
        </div>

        <aside className="pp-extrato-anterior" aria-label={`Mensalidades de ${mesExtenso(meses.anterior)}`}>
          <h3 className="pp-h3">{Mes(meses.anterior)} <span className="pp-quando">mês fechado</span></h3>
          <ul className="pp-razao">
            <li className="pp-razao-linha ok">
              <span className="pp-razao-rotulo"><CircleCheck size={16} aria-hidden /> Recebido</span>
              <strong className="pp-num">{brl(ant.recebido)}</strong>
              <span className="pp-razao-sub">{plural(ant.lojas.pagas, "loja pagou", "lojas pagaram")}</span>
            </li>
            <li className="pp-razao-linha">
              <span className="pp-razao-rotulo"><Clock size={16} aria-hidden /> A vencer</span>
              <strong className="pp-num">{brl(ant.aVencer)}</strong>
              <span className="pp-razao-sub">{plural(ant.lojas.aVencer, "loja", "lojas")} · o boleto vence no dia 5</span>
            </li>
            <li>
              <button type="button" className="pp-razao-linha erro clicavel" onClick={() => filtrar("TODOS", "ATRASADAS")} disabled={ant.lojas.vencidas === 0}>
                <span className="pp-razao-rotulo"><TriangleAlert size={16} aria-hidden /> Atrasado</span>
                <strong className="pp-num">{brl(ant.atrasado)}</strong>
                <span className="pp-razao-sub">{plural(ant.lojas.vencidas, "loja", "lojas")}{ant.lojas.vencidas ? " · ver e cobrar" : ""}</span>
              </button>
            </li>
            {ant.lojas.semBoleto > 0 && (
              <li>
                <button type="button" className="pp-razao-linha alerta clicavel" onClick={() => filtrar("TODOS", "SEM_BOLETO")}>
                  <span className="pp-razao-rotulo"><FileWarning size={16} aria-hidden /> Sem boleto</span>
                  <strong className="pp-num">{brl(ant.semBoleto)}</strong>
                  <span className="pp-razao-sub">{plural(ant.lojas.semBoleto, "loja", "lojas")} · a cobrança não saiu</span>
                </button>
              </li>
            )}
          </ul>
          {totalAnterior > 0 && (
            <div className="pp-progresso" aria-label={`${Math.round((ant.recebido / totalAnterior) * 100)}% recebido`}>
              <span className="ok" style={{ width: `${(ant.recebido / totalAnterior) * 100}%` }} />
              <span className="atraso" style={{ width: `${(ant.atrasado / totalAnterior) * 100}%` }} />
            </div>
          )}
          <p className="pp-razao-rodape">
            {ant.lojas.semCobranca > 0 && <>{plural(ant.lojas.semCobranca, "loja não teve", "lojas não tiveram")} cobrança (teste, isenta ou sem venda). </>}
            {resumo.recebidoEsteMes > 0 && <>Entrou em {mesExtenso(meses.atual)}: <strong className="pp-num">{brl(resumo.recebidoEsteMes)}</strong>. </>}
          </p>
          <div className="pp-media">
            <div>
              <span className="pp-rotulo">Média dos últimos {resumo.media.meses.length} meses</span>
              <strong className="pp-num">{brl(resumo.media.valor)}</strong>
            </div>
            <ol className="pp-media-meses">
              {resumo.media.meses.map((m) => (
                <li key={m.yearMonth}>
                  <span>{mesCurto(m.yearMonth)}</span>
                  <b className="pp-num">{brl(m.valor)}</b>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </section>

      {/* ── O QUE PEDE ATENÇÃO ──────────────────────────────────────── */}
      <Atencao resumo={resumo} meses={meses} aoFiltrar={(s) => filtrar("TODOS", s)} />

      {/* ── ESTRUTURA ───────────────────────────────────────────────── */}
      <section className="pp-painel" aria-labelledby="pp-estrutura-titulo">
        <header className="pp-painel-cabeca">
          <div>
            <h2 id="pp-estrutura-titulo" className="pp-h2">Sua estrutura</h2>
            <p className="pp-sub">Quantas lojas você tem em cada papel e como elas estão. Clique num número para ver as lojas.</p>
          </div>
        </header>
        <div className="pp-rolagem">
          <table className="pp-matriz">
            <thead>
              <tr>
                <th scope="col">Papel</th>
                <th scope="col">Lojas</th>
                <th scope="col">Vendendo</th>
                <th scope="col">Paradas</th>
                <th scope="col">Nunca venderam</th>
                <th scope="col" className="pp-divisa">Em teste</th>
                <th scope="col">Atrasadas</th>
                <th scope="col">Comissão de {mesCurto(meses.atual)}.</th>
              </tr>
            </thead>
            <tbody>
              {papeis.map((p) => {
                const r = resumo.estrutura[p];
                const meta = PAPEL[p];
                const celula = (n: number, s: FiltroDeSituacao, classe = "") => (
                  <td>
                    <button type="button" className={`pp-celula ${classe} ${n === 0 ? "zero" : ""}`} onClick={() => filtrar(p, s)} disabled={n === 0}>
                      {n}
                    </button>
                  </td>
                );
                return (
                  <tr key={p}>
                    <th scope="row">
                      <span className={`pp-papel ${meta.classe}`}><meta.Icone size={14} aria-hidden /> {meta.nome}</span>
                      <span className="pp-papel-pct">{parceiro.percentuais[p]}%</span>
                    </th>
                    {celula(r.lojas, "TODAS", "forte")}
                    {celula(r.ativas, "VENDENDO", "ok")}
                    {celula(r.paradas, "PARADAS", "erro")}
                    {celula(r.nuncaVenderam, "NUNCA")}
                    <td className="pp-divisa">
                      <button type="button" className={`pp-celula ${r.emTeste === 0 ? "zero" : ""}`} onClick={() => filtrar(p, "TESTE")} disabled={r.emTeste === 0}>{r.emTeste}</button>
                    </td>
                    {celula(r.atrasadas, "ATRASADAS", "erro")}
                    <td className="pp-num pp-dinheiro">{brl(r.comissaoMes)}</td>
                  </tr>
                );
              })}
              {papeis.length > 1 && (
                <tr className="pp-total-linha">
                  <th scope="row">Total</th>
                  <td className="pp-num">{resumo.estrutura.TOTAL.lojas}</td>
                  <td className="pp-num">{resumo.estrutura.TOTAL.ativas}</td>
                  <td className="pp-num">{resumo.estrutura.TOTAL.paradas}</td>
                  <td className="pp-num">{resumo.estrutura.TOTAL.nuncaVenderam}</td>
                  <td className="pp-num pp-divisa">{resumo.estrutura.TOTAL.emTeste}</td>
                  <td className="pp-num">{resumo.estrutura.TOTAL.atrasadas}</td>
                  <td className="pp-num pp-dinheiro">{brl(resumo.estrutura.TOTAL.comissaoMes)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {resumo.nasDuas > 0 && (
          <p className="pp-regra">
            <Info size={16} aria-hidden />
            <span>
              <strong>
                {resumo.nasDuas === 1 ? "1 loja que é indicação sua também está" : `${resumo.nasDuas} lojas que são indicação sua também estão`} na sua carteira de vendas.
              </strong>{" "}
              Nelas vale só a comissão de embaixador ({parceiro.percentuais.EMBAIXADOR}%{papeis.includes("REDE") ? `, ou ${parceiro.percentuais.REDE}% quando é da sua rede` : ""}) — os {parceiro.percentuais.VENDEDOR}% de vendedor não somam.
              Na lista, elas levam a marca “também na carteira”.
            </span>
          </p>
        )}
        {rede.length > 0 && (
          <div className="pp-rede">
            <h3 className="pp-h3">Embaixadores que você trouxe</h3>
            <ul>
              {rede.map((r) => (
                <li key={r.id}>
                  <span className="pp-rede-nome">{r.nome}</span>
                  <span className="pp-rede-info">{plural(r.lojas, "loja", "lojas")} · código {r.codigo}</span>
                  {!r.ativo && <span className="pp-selo erro">inativo</span>}
                  {r.ativo && !r.temCarteira && <span className="pp-selo alerta" title="Sem a carteira dele no split, a sua parte da rede também não sai">sem carteira Asaas</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── LOJAS ───────────────────────────────────────────────────── */}
      <section className="pp-painel" id="pp-lojas" aria-labelledby="pp-lojas-titulo">
        <header className="pp-painel-cabeca">
          <div>
            <h2 id="pp-lojas-titulo" className="pp-h2">Lojas</h2>
            <p className="pp-sub">
              {plural(lojas.length, "loja", "lojas")} com você. A lista começa pelo que pede atenção: mensalidade atrasada, contato pendente, loja parada.
            </p>
          </div>
          <label className="pp-busca">
            <Search size={16} aria-hidden />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar loja, dono, cidade ou telefone" aria-label="Buscar loja" />
            {busca && (
              <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca"><X size={14} /></button>
            )}
          </label>
        </header>

        <div className="pp-ferramentas">
          {papeis.length > 1 && (
            <div className="pp-segmento" role="tablist" aria-label="Papel">
              {(["TODOS", ...papeis] as ("TODOS" | Papel)[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={papel === p}
                  className={papel === p ? "on" : ""}
                  onClick={() => setPapel(p)}
                >
                  {p === "TODOS" ? "Todas" : PAPEL[p].curto}
                  <span className="pp-num">{p === "TODOS" ? lojas.length : lojas.filter((l) => l.papel === p).length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="pp-chips" aria-label="Situação">
            {FILTROS.filter((f) => f.chave !== "AGUARDANDO" || papeis.includes("VENDEDOR")).map((f) => {
              const n = contagem(f.chave);
              if (f.chave !== "TODAS" && n === 0 && situacao !== f.chave) return null;
              return (
                <button key={f.chave} type="button" className={`pp-chip ${situacao === f.chave ? "on" : ""} ${f.chave === "ATRASADAS" ? "erro" : ""}`} onClick={() => setSituacao(f.chave)} aria-pressed={situacao === f.chave}>
                  {f.rotulo} <span className="pp-num">{n}</span>
                </button>
              );
            })}
          </div>
          <label className="pp-ordem">
            <ArrowUpDown size={14} aria-hidden />
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar">
              <option value="ATENCAO">O que pede atenção</option>
              <option value="COMISSAO">Maior comissão</option>
              <option value="RECENTES">Mais recentes</option>
              <option value="NOME">Nome</option>
            </select>
          </label>
        </div>

        {lojas.length === 0 ? (
          <div className="pp-vazio">
            <Handshake size={28} aria-hidden />
            <p><strong>{modo === "ADMIN" ? "Nenhuma loja com este parceiro ainda." : "Você ainda não tem lojas."}</strong></p>
            <p>Quando uma loja se cadastrar pelo link de indicação{parceiro.isVendedor ? ", ou a FireHub passar uma loja para acompanhar," : ""} ela aparece aqui.</p>
          </div>
        ) : visiveis.length === 0 ? (
          <div className="pp-vazio">
            <p><strong>Nenhuma loja neste filtro.</strong></p>
            <button type="button" className="pp-botao" onClick={() => { setPapel("TODOS"); setSituacao("TODAS"); setBusca(""); }}>Ver todas as lojas</button>
          </div>
        ) : (
          <div className="pp-lista" role="table" aria-label="Lojas">
            <div className="pp-linha pp-linha-cabeca" role="row">
              <span role="columnheader">Loja</span>
              <span role="columnheader">Papel</span>
              <span role="columnheader">Uso</span>
              <span role="columnheader">{Mes(meses.atual)} (até agora)</span>
              <span role="columnheader">Mensalidade de {mesExtenso(meses.anterior)}</span>
              <span role="columnheader" className="pp-direita">Ações</span>
            </div>
            {visiveis.map((l) => (
              <LinhaDaLoja
                key={l.id}
                l={l}
                meses={meses}
                quem={quem}
                podeMarcar={podeMarcarAtendimento}
                salvando={salvando === l.id}
                aoMarcar={marcar}
                percentualVendedor={parceiro.percentuais.VENDEDOR}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── INDICAÇÃO E REPASSE ─────────────────────────────────────── */}
      <div className="pp-rodape-grade">
        {(papeis.includes("EMBAIXADOR") || parceiro.percentuais.EMBAIXADOR > 0) && (
          <LinkDeIndicacao codigo={parceiro.codigo} percentual={parceiro.percentuais.EMBAIXADOR} modo={modo} />
        )}
        <ComoFunciona percentuais={parceiro.percentuais} papeis={papeis} temCarteira={parceiro.temCarteira} />
      </div>
    </div>
  );
}

// ─── Composição do mês por papel ────────────────────────────────────────────

function Composicao({
  resumo, papeis, percentuais, aoFiltrar,
}: {
  resumo: RelatorioDoParceiro["resumo"];
  papeis: Papel[];
  percentuais: Record<Papel, number>;
  aoFiltrar: (p: Papel) => void;
}) {
  const total = papeis.reduce((s, p) => s + resumo.mesAtual.porPapel[p].comissao, 0);
  return (
    <div className="pp-composicao">
      {total > 0 && (
        <div className="pp-barra" aria-hidden>
          {papeis.map((p) =>
            resumo.mesAtual.porPapel[p].comissao > 0 ? (
              <span key={p} className={PAPEL[p].classe} style={{ width: `${(resumo.mesAtual.porPapel[p].comissao / total) * 100}%` }} />
            ) : null
          )}
        </div>
      )}
      <ul className="pp-composicao-lista">
        {papeis.map((p) => {
          const r = resumo.mesAtual.porPapel[p];
          const meta = PAPEL[p];
          return (
            <li key={p}>
              <button type="button" onClick={() => aoFiltrar(p)}>
                <i className={`pp-ponto ${meta.classe}`} aria-hidden />
                <span className="pp-composicao-nome">
                  {meta.nome} <span className="pp-composicao-pct">{percentuais[p]}%</span>
                </span>
                <span className="pp-composicao-lojas">
                  {plural(r.lojas, "loja", "lojas")}
                  {r.lojas > 0 ? ` · ${r.cobraveis} com mensalidade` : ""}
                </span>
                <strong className="pp-num">{brl(r.comissao)}</strong>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── O que pede atenção ─────────────────────────────────────────────────────

function Atencao({
  resumo, meses, aoFiltrar,
}: {
  resumo: RelatorioDoParceiro["resumo"];
  meses: RelatorioDoParceiro["meses"];
  aoFiltrar: (s: FiltroDeSituacao) => void;
}) {
  const a = resumo.atencao;
  const itens: { chave: FiltroDeSituacao; classe: string; Icone: typeof Handshake; titulo: string; texto: string; acao: string }[] = [];
  if (a.atrasadas)
    itens.push({
      chave: "ATRASADAS", classe: "erro", Icone: TriangleAlert,
      titulo: `${plural(a.atrasadas, "loja", "lojas")} com mensalidade atrasada`,
      texto: a.comissaoParada > 0 ? `${brl(a.comissaoParada)} da sua comissão estão esperando elas pagarem.` : "A comissão só cai quando a loja paga.",
      acao: "Ver e cobrar",
    });
  if (a.aguardandoContato)
    itens.push({
      chave: "AGUARDANDO", classe: "alerta", Icone: PhoneCall,
      titulo: `${plural(a.aguardandoContato, "loja espera", "lojas esperam")} o seu primeiro contato`,
      texto: "Lojas que a FireHub passou para a sua carteira e ainda não foram atendidas.",
      acao: "Ver lojas",
    });
  if (a.semBoleto)
    itens.push({
      chave: "SEM_BOLETO", classe: "alerta", Icone: FileWarning,
      titulo: `${plural(a.semBoleto, "loja ficou", "lojas ficaram")} sem boleto de ${mesExtenso(meses.anterior)}`,
      texto: "Geralmente falta o CPF/CNPJ no cadastro da loja. Sem boleto não há pagamento — nem comissão.",
      acao: "Ver lojas",
    });
  if (a.paradas)
    itens.push({
      chave: "PARADAS", classe: "", Icone: CirclePause,
      titulo: `${plural(a.paradas, "loja está parada", "lojas estão paradas")} há 7 dias ou mais`,
      texto: "Loja que não vende não gera mensalidade. Uma ligação costuma destravar.",
      acao: "Ver lojas",
    });
  if (a.testesAcabando)
    itens.push({
      chave: "TESTE", classe: "", Icone: Hourglass,
      titulo: `${plural(a.testesAcabando, "teste acaba", "testes acabam")} em até 5 dias`,
      texto: "É a hora de ajudar a loja a vender pelo sistema antes da primeira mensalidade.",
      acao: "Ver lojas",
    });

  return (
    <section className="pp-painel pp-atencao" aria-labelledby="pp-atencao-titulo">
      <header className="pp-painel-cabeca">
        <h2 id="pp-atencao-titulo" className="pp-h2">O que pede atenção</h2>
      </header>
      {itens.length === 0 ? (
        <p className="pp-tudo-certo"><CircleCheck size={18} aria-hidden /> Nada pedindo atenção agora: ninguém atrasado, ninguém esperando contato.</p>
      ) : (
        <ul className="pp-atencao-lista">
          {itens.map((i) => (
            <li key={i.chave} className={i.classe}>
              <span className="pp-atencao-icone"><i.Icone size={18} aria-hidden /></span>
              <div>
                <strong>{i.titulo}</strong>
                <p>{i.texto}</p>
              </div>
              <button type="button" className="pp-botao" onClick={() => aoFiltrar(i.chave)}>{i.acao}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Uma loja ───────────────────────────────────────────────────────────────

function LinhaDaLoja({
  l, meses, quem, podeMarcar, salvando, aoMarcar, percentualVendedor,
}: {
  l: LojaDoRelatorio;
  meses: RelatorioDoParceiro["meses"];
  quem: string;
  podeMarcar: boolean;
  salvando: boolean;
  aoMarcar: (l: LojaDoRelatorio, status: "ATENDIDO" | "AGUARDANDO") => void;
  percentualVendedor: number;
}) {
  const meta = PAPEL[l.papel];
  const dono = primeiroNome(l.dono);
  const ola = `Olá${dono ? `, ${dono}` : ""}! Aqui é ${quem}.`;

  // A mensagem já vem pronta para o que a loja precisa agora.
  let mensagem = `${ola} Tudo certo com a ${l.nome}? Qualquer coisa no sistema, pode me chamar por aqui.`;
  let rotuloDoWhats = "WhatsApp";
  if (l.emAberto) {
    const ab = l.emAberto;
    const oQue = ab.meses > 1
      ? `as mensalidades da ${l.nome} somam ${brl(ab.valor)} em aberto (desde ${mesExtenso(ab.maisAntigo)})`
      : `a mensalidade de ${mesExtenso(ab.maisAntigo)} da ${l.nome} (${brl(ab.valor)}) ${ab.vencida ? "venceu e ainda está em aberto" : "vence no dia 5"}`;
    mensagem = `${ola} Passando para lembrar que ${oQue}. Consegue ver para mim?${ab.boletoUrl ? ` O boleto está aqui: ${ab.boletoUrl}` : ""}`;
    rotuloDoWhats = ab.vencida ? "Cobrar" : "Lembrar";
  } else if (l.carteira?.atendimento === "AGUARDANDO") {
    mensagem = `${ola} Vou acompanhar a ${l.nome} por aqui. Posso te ajudar a deixar tudo pronto para vender pelo sistema?`;
  } else if (l.uso.situacao === "PARADA" && l.uso.diasSemPedido) {
    mensagem = `${ola} Vi que a ${l.nome} está há ${l.uso.diasSemPedido} dias sem pedido pelo sistema. Está tudo certo? Posso te ajudar em alguma coisa?`;
  } else if (l.uso.situacao === "NUNCA_VENDEU") {
    mensagem = `${ola} Vi que a ${l.nome} ainda não fez o primeiro pedido pelo sistema. Quer que eu te ajude a colocar para rodar?`;
  }
  const whats = linkDoWhatsApp(l.telefone, mensagem);

  const atual = l.mesAtual;
  const ant = l.mesAnterior;

  return (
    <div className={`pp-linha ${l.emAberto?.vencida ? "atrasada" : ""}`} role="row">
      {/* Loja */}
      <div className="pp-c-loja" role="cell">
        <strong className="pp-loja-nome">{l.nome}</strong>
        <span className="pp-loja-info">
          {[l.dono && l.dono !== l.nome ? l.dono : null, l.cidade].filter(Boolean).join(" · ") || l.email}
        </span>
        <span className="pp-loja-info fraco">na FireHub desde {dataCurta(l.cadastradaEm)}</span>
      </div>

      {/* Papel */}
      <div className="pp-c-papel" role="cell">
        <span className={`pp-papel ${meta.classe}`} title={meta.explica(l.percentual)}>
          <meta.Icone size={13} aria-hidden /> {meta.curto} · {l.percentual}%
        </span>
        {l.via && <span className="pp-mini">via {l.via.nome}</span>}
        {l.tambemNaCarteira && (
          <span className="pp-mini destaque" title={`Você indicou e também acompanha: vale só a indicação, os ${percentualVendedor}% de vendedor não somam.`}>
            <Info size={12} aria-hidden /> também na carteira · vale só {l.papel === "REDE" ? "a rede" : "a indicação"}
          </span>
        )}
        {l.vendedorDaLoja && <span className="pp-mini">acompanhada por {l.vendedorDaLoja}</span>}
        {l.repasse !== "CAI" && (
          <span className="pp-mini erro" title={REPASSE[l.repasse]}>
            <TriangleAlert size={12} aria-hidden /> {l.repasse === "INDICADOR_FORA" ? "rede sem repasse" : l.repasse === "ACIMA_DO_TETO" ? "sem split (teto)" : "sem repasse"}
          </span>
        )}
      </div>

      {/* Uso */}
      <div className="pp-c-uso" role="cell">
        {l.uso.situacao === "ATIVA" && <span className="pp-uso ok"><i aria-hidden /> Vendendo</span>}
        {l.uso.situacao === "PARADA" && <span className="pp-uso erro"><i aria-hidden /> Parada há {l.uso.diasSemPedido} dias</span>}
        {l.uso.situacao === "NUNCA_VENDEU" && <span className="pp-uso neutro"><i aria-hidden /> Nunca vendeu</span>}
        {l.uso.situacao !== "NUNCA_VENDEU" && <span className="pp-mini">{plural(l.uso.pedidos7d, "pedido", "pedidos")} em 7 dias</span>}
        {l.teste.ativo && (
          <span className="pp-selo alerta"><Hourglass size={12} aria-hidden /> teste · {l.teste.diasRestantes === 0 ? "acaba hoje" : `${l.teste.diasRestantes} ${l.teste.diasRestantes === 1 ? "dia" : "dias"}`}</span>
        )}
        {l.carteira && (
          l.carteira.atendimento === "AGUARDANDO"
            ? <span className="pp-selo alerta"><PhoneCall size={12} aria-hidden /> esperando contato</span>
            : <span className="pp-selo ok"><UserCheck size={12} aria-hidden /> atendida{l.carteira.atendidoEm ? ` ${dataCurta(l.carteira.atendidoEm)}` : ""}</span>
        )}
      </div>

      {/* Mês atual */}
      <div className="pp-c-mes" role="cell" data-rotulo={`${Mes(meses.atual)} (até agora)`}>
        {l.isenta ? (
          <span className="pp-mini">loja isenta — não paga mensalidade</span>
        ) : atual.valor > 0 ? (
          <>
            <span className="pp-sua-parte pp-num">{brl(atual.comissao)}</span>
            <span className="pp-mini pp-num">de {brl(atual.valor)} de mensalidade</span>
          </>
        ) : l.teste.ativo ? (
          <span className="pp-mini">em teste até {dataCurta(l.teste.ate)} — sem mensalidade ainda</span>
        ) : (
          <span className="pp-mini">sem venda cobrável no mês</span>
        )}
      </div>

      {/* Mês anterior */}
      <div className="pp-c-anterior" role="cell" data-rotulo={`Mensalidade de ${mesExtenso(meses.anterior)}`}>
        <SituacaoDaMensalidade l={l} />
        {ant.valor > 0 && ant.situacao !== "SEM_COBRANCA" && (
          <span className="pp-mini pp-num">
            {brl(ant.valor)} · sua parte {brl(ant.comissao)}
          </span>
        )}
        {l.emAberto && l.emAberto.meses > 1 && (
          <span className="pp-mini erro pp-num">{brl(l.emAberto.valor)} em aberto em {l.emAberto.meses} meses</span>
        )}
      </div>

      {/* Ações */}
      <div className="pp-c-acoes" role="cell">
        {whats ? (
          <a className={`pp-botao ${l.emAberto?.vencida ? "cobrar" : "whats"}`} href={whats} target="_blank" rel="noreferrer">
            <MessageCircle size={15} aria-hidden /> {rotuloDoWhats}
          </a>
        ) : (
          <span className="pp-mini">sem telefone</span>
        )}
        {l.emAberto?.boletoUrl && (
          <a className="pp-botao leve" href={l.emAberto.boletoUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> Boleto
          </a>
        )}
        {podeMarcar && l.carteira && (
          l.carteira.atendimento === "AGUARDANDO" ? (
            <button type="button" className="pp-botao escuro" disabled={salvando} onClick={() => aoMarcar(l, "ATENDIDO")}>
              <UserCheck size={14} aria-hidden /> {salvando ? "Salvando…" : "Já atendi"}
            </button>
          ) : (
            <button type="button" className="pp-botao leve" disabled={salvando} onClick={() => aoMarcar(l, "AGUARDANDO")} title="Voltar para esperando contato">
              <Undo2 size={14} aria-hidden /> {salvando ? "Salvando…" : "Desfazer"}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function SituacaoDaMensalidade({ l }: { l: LojaDoRelatorio }) {
  const m = l.mesAnterior;
  switch (m.situacao) {
    case "PAGA":
      return <span className="pp-selo ok"><CircleCheck size={12} aria-hidden /> Paga{m.pagoEm ? ` em ${dataCurta(m.pagoEm)}` : ""}</span>;
    case "A_VENCER":
      return <span className="pp-selo neutro"><Clock size={12} aria-hidden /> Vence {dataCurta(m.venceEm)}</span>;
    case "VENCIDA":
      return (
        <span className="pp-selo erro" title={m.bloqueiaEm ? `O painel da loja trava em ${dataCurta(m.bloqueiaEm)} se não pagar.` : undefined}>
          <TriangleAlert size={12} aria-hidden /> Atrasada {plural(m.diasDeAtraso, "dia", "dias")}
        </span>
      );
    case "SEM_BOLETO":
      return <span className="pp-selo alerta" title={m.motivo || undefined}><FileWarning size={12} aria-hidden /> Sem boleto{l.semCpfCnpj ? " · falta CPF/CNPJ" : ""}</span>;
    case "EM_ANDAMENTO":
      return <span className="pp-selo neutro"><Clock size={12} aria-hidden /> Fechando</span>;
    default:
      return <span className="pp-selo neutro" title={m.motivo || undefined}>{l.isenta ? "Isenta" : m.motivo?.startsWith("Em período de teste") ? "Em teste — sem cobrança" : "Sem cobrança"}</span>;
  }
}

// ─── Link de indicação ──────────────────────────────────────────────────────

function LinkDeIndicacao({ codigo, percentual, modo }: { codigo: string; percentual: number; modo: "PARCEIRO" | "ADMIN" }) {
  const [copiado, setCopiado] = useState(false);
  const link = `https://firehubfood.com.br/cadastro?ref=${codigo}`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2200);
    } catch {
      prompt("Copie o link:", link);
    }
  };
  return (
    <section className="pp-painel pp-indicacao" aria-labelledby="pp-indicacao-titulo">
      <h2 id="pp-indicacao-titulo" className="pp-h2">{modo === "ADMIN" ? "Link de indicação dele" : "Seu link de indicação"}</h2>
      <p className="pp-sub">
        Loja que se cadastra por este link entra como indicação{modo === "ADMIN" ? " dele" : " sua"}: {percentual}% da mensalidade, todo mês, com 15 dias de teste grátis para a loja.
      </p>
      <div className="pp-link">
        <code>{link.replace("https://", "")}</code>
        <button type="button" className={`pp-botao ${copiado ? "ok" : "primario"}`} onClick={copiar}>
          {copiado ? <><Check size={15} aria-hidden /> Copiado</> : <><Copy size={15} aria-hidden /> Copiar link</>}
        </button>
      </div>
    </section>
  );
}

// ─── Como a conta funciona ──────────────────────────────────────────────────

function ComoFunciona({ percentuais, papeis, temCarteira }: { percentuais: Record<Papel, number>; papeis: Papel[]; temCarteira: boolean }) {
  return (
    <section className="pp-painel pp-como" aria-labelledby="pp-como-titulo">
      <h2 id="pp-como-titulo" className="pp-h2"><CircleDollarSign size={18} aria-hidden /> Como a sua comissão é calculada</h2>
      <ul>
        <li>A comissão é uma parte da <strong>mensalidade</strong> que a loja paga à FireHub: 1% do que ela vende no mês, no mínimo R$ 100 e no máximo R$ 400.</li>
        {papeis.map((p) => (
          <li key={p}><strong>{PAPEL[p].nome}:</strong> {PAPEL[p].explica(percentuais[p])}.</li>
        ))}
        {papeis.includes("VENDEDOR") && (papeis.includes("EMBAIXADOR") || papeis.includes("REDE")) && (
          <li>Loja que você indicou (ou é da sua rede) e também acompanha como vendedor conta <strong>só como indicação</strong> — os {percentuais.VENDEDOR}% de vendedor não somam.</li>
        )}
        <li>Nos dias de teste grátis a loja não paga mensalidade — por isso ainda não gera comissão.</li>
        <li>No dia 1º o mês fecha e o boleto sai com vencimento no dia 5. A sua parte cai {temCarteira ? "na sua carteira Asaas" : "na carteira Asaas cadastrada"} quando a loja paga. O que ainda não foi pago aparece pelo valor do boleto; no pagamento o Asaas desconta a tarifa dele antes de dividir, então o que cai é alguns centavos menor.</li>
      </ul>
    </section>
  );
}
