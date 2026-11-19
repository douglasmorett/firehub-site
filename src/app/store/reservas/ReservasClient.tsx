"use client";

/**
 * Reservas de mesa — a tela do dono (/store/reservas), lib/reservas.
 *
 * Douglas, 19/11/2026: "um módulo de reserva onde ele consiga enxergar as
 * reservas, colocar quantas reservas simultâneas, entender os horários das
 * reservas para fazer essa gestão, e ter isso muito claro no painel do dono".
 *
 * Desligado: a apresentação (./Oferta) com o preço e o termo.
 * Ligado: Dia (ocupação × capacidade, o salão ao longo da noite, a lista com as
 * ações), Semana, Mês, Resultados (o valor em R$) e Configurar.
 * Avisos no topo da tela, nunca alert().
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import { VERSAO_DO_TERMO_DAS_RESERVAS } from "@/lib/reservas/termo";
import { dataPorExtenso, somarDias, type ConfigDasReservas } from "@/lib/reservas/regras";
import {
  Calendar, CalendarClock, CalendarDays, CalendarRange, ChartColumn, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Flame, Plus, Settings, UserCheck, Users, type LucideIcon,
} from "lucide-react";
import {
  Botao, COR, CSS_DAS_RESERVAS, Numero, TINTA_3, cartao, corDaOcupacao, diaMes, h2, nomeDoMes, reais, texto,
  type Aviso, type Dados, type Estado, type ReservaDaTela,
} from "./comum";
import { Oferta, Termo } from "./Oferta";
import { IlustracaoDasReservas } from "./IlustracaoDasReservas";
import { ListaDoDia, OcupacaoDoDia, ProximasChegadas, RoboNoDia, SalaoAoLongoDaNoite, SituacaoDoDia, type AcaoDaLista } from "./VisaoDoDia";
import { VisaoDaSemana, VisaoDoMes } from "./VisaoSemanaMes";
import { Resultados } from "./Resultados";
import { Configuracao } from "./Configuracao";
import { FormularioDaReserva, type ModoDoFormulario } from "./FormularioDaReserva";

type Aba = "dia" | "semana" | "mes" | "resultados" | "configurar";
const ABAS: [Aba, string, LucideIcon][] = [["dia", "Dia", CalendarDays], ["semana", "Semana", CalendarRange], ["mes", "Mês", Calendar], ["resultados", "Resultados", ChartColumn], ["configurar", "Configurar", Settings]];

const FRASE_DA_ACAO: Record<AcaoDaLista, string> = { chegou: "chegou", nao_veio: "não veio", cancelar: "foi cancelada", confirmar: "voltou para confirmada" };

export default function ReservasClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("dia");
  const [salvando, setSalvando] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [formulario, setFormulario] = useState<ModoDoFormulario | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [filtroHora, setFiltroHora] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);
  useEffect(() => {
    if (!foco) return;
    const t = setTimeout(() => setFoco(null), 2500);
    return () => clearTimeout(t);
  }, [foco]);
  /** Leva até o cartão da reserva (vinda da agenda ou das próximas chegadas) e o destaca. */
  const abrirReserva = (r: ReservaDaTela) => {
    if (filtroHora && filtroHora !== r.hora) setFiltroHora(null);
    setFoco(r.id);
    setTimeout(() => document.getElementById(`reserva-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const carregar = useCallback(async (data?: string) => {
    try {
      const r = await fetch(`/api/store/reservas${data ? `?data=${data}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const irPara = (data: string) => { setFiltroHora(null); carregar(data); };

  async function ligar(ligar: boolean) {
    if (!dados) return;
    setSalvando(true);
    const antes = dados.estado;
    try {
      const r = await fetch("/api/store/reservas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DAS_RESERVAS } } : { ligar }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro");
      const estado: Estado = j.estado;
      setTermoAberto(false);
      setAviso(ligar
        ? antes.ativo && antes.desligaEm
          ? { tipo: "ok", titulo: "As reservas continuam ligadas.", detalhe: "O desligamento da virada do mês foi cancelado; a cobrança segue normal." }
          : { tipo: "ok", titulo: "Reservas ligadas! 🎉", detalhe: estado.emTeste && estado.testeAte
              ? `Grátis até ${diaMes(estado.testeAte)}. Confira os horários em Configurar: é o que o robô usa para reservar.`
              : `Este mês já entra no boleto (${reais(dados.preco)}), à parte da mensalidade. Confira os horários em Configurar.` }
        : estado.ativo && estado.desligaEm
          ? { tipo: "ok", titulo: `As reservas desligam em ${diaMes(estado.desligaEm)}.`, detalhe: "Este mês já está pago: até lá continuam liberadas, e o mês que vem não é cobrado." }
          : { tipo: "ok", titulo: "Reservas desligadas.", detalhe: "Você estava no teste grátis: nada foi cobrado. O robô volta a passar a reserva para a equipe." });
      if (ligar && !antes.ativo) setAba("configurar");
      await carregar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  async function salvarConfig(config: ConfigDasReservas) {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/reservas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao salvar");
      setAviso({ tipo: "ok", titulo: "Configuração salva.", detalhe: "O robô já usa os novos horários e a nova capacidade na próxima mensagem." });
      await carregar(dados?.data);
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  async function agir(r: ReservaDaTela, corpo: Record<string, unknown>, frase: string) {
    setOcupado(r.id);
    try {
      const resp = await fetch("/api/store/reservas/reserva", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, ...corpo }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error || "Erro");
      setAviso({ tipo: "ok", titulo: frase });
      await carregar(dados?.data);
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setOcupado(null);
    }
  }

  const resumoDoDia = useMemo(() => {
    const d = dados?.dia;
    if (!d) return null;
    const ativas = d.reservas.filter((r) => r.status !== "CANCELADA");
    const pico = d.horarios.reduce<{ hora: string; n: number } | null>((m, h) => (!m || h.ocupacao.reservas > m.n ? { hora: h.hora, n: h.ocupacao.reservas } : m), null);
    const comVaga = d.horarios.filter((h) => h.livre).length;
    const futuros = d.horarios.filter((h) => h.motivo !== "passou" && h.motivo !== "antecedencia").length;
    return { reservas: ativas.length, pessoas: ativas.reduce((t, r) => t + r.pessoas, 0), chegaram: ativas.filter((r) => r.status === "CHEGOU").length, pico, comVaga, futuros };
  }, [dados]);

  if (erro) return <div className="fh-tela"><div className="fh-aviso fh-aviso--erro" role="alert"><CircleAlert size={18} aria-hidden /> {erro}</div></div>;
  if (!dados) return <div className="fh-tela" style={{ background: "transparent", color: TINTA_3, font: "500 14px/1.5 Inter, system-ui, sans-serif" }}>Carregando as reservas…</div>;
  const e = dados.estado;
  const ativo = e.ativo && !!dados.config;
  const ehHoje = dados.data === dados.hoje;
  const ehPassado = !!dados.data && !!dados.hoje && (dados.data < dados.hoje || ehHoje);
  const cap = dados.config?.maxReservasSimultaneas || 1;
  const reservasDoDia = dados.dia?.reservas || [];
  const naoVieram = reservasDoDia.filter((r) => r.status === "NAO_VEIO").length;
  const canceladas = reservasDoDia.filter((r) => r.status === "CANCELADA").length;
  const seloDoEstado = e.isento ? "Liberado" : e.emTeste && e.testeAte ? `Ativo · grátis até ${diaMes(e.testeAte)}` : e.desligaEm ? `Ativo até ${diaMes(e.desligaEm)}` : "Ativo";
  const passo = aba === "dia" ? 1 : aba === "semana" ? 7 : 31;
  const deTotal = (n: number, total: number) => <>{n}<span style={{ fontSize: "0.55em", color: TINTA_3, fontWeight: 800 }}> de {total}</span></>;

  return (
    <div className="fh-tela rsv-tela">
      <style>{CSS_DAS_RESERVAS}</style>

      {aviso && (
        <div role="status" onClick={() => setAviso(null)} className={`fh-aviso ${aviso.tipo === "ok" ? "fh-aviso--ok" : "fh-aviso--erro"}`}
          style={{ position: "sticky", top: 8, zIndex: 50, cursor: "pointer", boxShadow: "0 4px 8px -2px rgba(15,23,42,.08), 0 16px 32px -12px rgba(15,23,42,.16)", borderLeftWidth: 1 }}>
          {aviso.tipo === "ok" ? <CircleCheck size={20} aria-hidden style={{ flex: "none" }} /> : <CircleAlert size={20} aria-hidden style={{ flex: "none" }} />}
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontWeight: 800 }}>{aviso.titulo}</strong>
            {aviso.detalhe && <span style={{ fontWeight: 500 }}>{aviso.detalhe}</span>}
          </div>
        </div>
      )}

      <header className="rsv-cabecalho">
        <span className="rsv-cabecalho__icone" aria-hidden><CalendarClock size={26} strokeWidth={2} /></span>
        <div style={{ minWidth: 0, flex: "1 1 280px", display: "grid", gap: 4 }}>
          {/* As reservas moram dentro de Mesas (botão "Controle de reservas" lá). */}
          <nav aria-label="Caminho" style={{ font: "800 13px/1.2 Inter, system-ui, sans-serif", color: TINTA_3, display: "flex", alignItems: "center", gap: 4 }}>
            <a href="/store/mesas" style={{ color: TINTA_3, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 2 }}><ChevronLeft size={15} aria-hidden />Mesas</a>
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1>Reservas de mesa</h1>
            {e.ativo && <span className="fh-estado fh-estado-ok" style={{ fontSize: 12 }}><i aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor" }} />{seloDoEstado}</span>}
          </div>
          <p className="rsv-cabecalho__sub" style={{ ...texto, fontSize: 14.5 }}>
            {ativo ? "O robô reserva sozinho, dentro da capacidade que você definir." : "Capacidade por horário, robô que reserva sozinho e o salão claro no painel."}
          </p>
        </div>
        {ativo && (
          <div className="rsv-cabecalho__acoes">
            <Botao onClick={() => setFormulario({ tipo: "nova", data: dados.data || dados.hoje! })}><Plus size={18} aria-hidden /> Nova reserva</Botao>
          </div>
        )}
      </header>

      {!ativo ? (
        <Oferta dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
      ) : (
        <>
          {/* As abas e, nas visões de calendário, o seletor de data. */}
          <div className="rsv-barra">
            <div role="tablist" aria-label="Visões das reservas" className="rsv-abas">
              {ABAS.map(([id, nome, Icone]) => (
                <button key={id} type="button" role="tab" data-aba={id} className="rsv-aba" onClick={() => setAba(id)} aria-selected={aba === id}>
                  <Icone size={17} strokeWidth={2.2} aria-hidden /> {nome}
                </button>
              ))}
            </div>
            {(aba === "dia" || aba === "semana" || aba === "mes") && (
              <div className="rsv-data">
                <Botao tipo="secundario" onClick={() => irPara(somarDias(dados.data!, aba === "mes" ? -28 : -passo))} title="Anterior" style={{ width: 44, padding: 0 }}><ChevronLeft size={20} aria-label="Anterior" /></Botao>
                <span className="rsv-data__nome">
                  {aba === "dia" ? dataPorExtenso(dados.data!) : aba === "semana" ? `Semana de ${diaMes(`${dados.semana?.[0]?.data}T12:00:00`)}` : nomeDoMes(dados.data!.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())}
                  {ehHoje && aba === "dia" && <span style={{ color: COR }}> · hoje</span>}
                </span>
                <Botao tipo="secundario" onClick={() => irPara(somarDias(dados.data!, passo))} title="Próximo" style={{ width: 44, padding: 0 }}><ChevronRight size={20} aria-label="Próximo" /></Botao>
                {!ehHoje && <Botao tipo="secundario" onClick={() => irPara(dados.hoje!)}>Hoje</Botao>}
                <input type="date" value={dados.data} onChange={(ev) => ev.target.value && irPara(ev.target.value)} aria-label="Escolher o dia" />
              </div>
            )}
          </div>

          {!dados.configurado && aba !== "configurar" && (
            <button type="button" onClick={() => setAba("configurar")} className="fh-aviso fh-aviso--atencao" style={{ width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", alignItems: "center" }}>
              <Settings size={18} aria-hidden style={{ flex: "none" }} />
              <span style={{ flex: 1 }}>Primeiro passo: confira os dias, os horários e quantas reservas cabem ao mesmo tempo.</span>
              <b style={{ whiteSpace: "nowrap" }}>Configurar →</b>
            </button>
          )}

          {aba === "dia" && dados.dia && resumoDoDia && (
            <>
              <div className="rsv-kpis rsv-entra">
                <Numero icone={CalendarDays} rotulo="Reservas no dia" valor={resumoDoDia.reservas}
                  sub={canceladas ? `${canceladas} cancelada${canceladas > 1 ? "s" : ""} fora da conta` : "canceladas não contam"} />
                <Numero icone={Users} rotulo="Pessoas" valor={resumoDoDia.pessoas}
                  sub={resumoDoDia.reservas ? `média de ${(resumoDoDia.pessoas / resumoDoDia.reservas).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por reserva` : "nas reservas do dia"} />
                <Numero icone={UserCheck} rotulo="Chegaram" valor={deTotal(resumoDoDia.chegaram, resumoDoDia.reservas)}
                  medidor={{ valor: resumoDoDia.reservas ? resumoDoDia.chegaram / resumoDoDia.reservas : 0 }}
                  sub={naoVieram ? `${naoVieram} não ${naoVieram > 1 ? "vieram" : "veio"}` : resumoDoDia.chegaram ? "ninguém faltou" : "ninguém chegou ainda"} />
                <Numero icone={Flame} rotulo="Horário mais cheio" valor={resumoDoDia.pico && resumoDoDia.pico.n ? resumoDoDia.pico.hora : "—"}
                  medidor={resumoDoDia.pico && resumoDoDia.pico.n ? { valor: resumoDoDia.pico.n / cap, cor: corDaOcupacao(resumoDoDia.pico.n / cap, resumoDoDia.pico.n >= cap).barra } : undefined}
                  sub={resumoDoDia.pico && resumoDoDia.pico.n ? `${resumoDoDia.pico.n} de ${cap} na mesa` : "nenhuma reserva ainda"} />
                <Numero icone={CircleCheck} rotulo="Horários com vaga" valor={deTotal(resumoDoDia.comVaga, dados.dia.horarios.length)}
                  sub={resumoDoDia.futuros < dados.dia.horarios.length ? "os que ainda dá para reservar" : "para reserva nova"} />
              </div>

              <div className="rsv-dia">
                <div className="rsv-dia__principal">
                  <section style={cartao} className="rsv-entra">
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                        <h2 style={h2}>Ocupação por horário</h2>
                        <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>Reservas na mesa em cada horário, contra as {cap} que cabem ao mesmo tempo. Toque num horário para ver quem chega.</p>
                      </div>
                      {filtroHora && <Botao pequeno onClick={() => setFormulario({ tipo: "nova", data: dados.data!, hora: filtroHora })} style={{ height: 40 }}><Plus size={16} aria-hidden /> Reservar às {filtroHora}</Botao>}
                    </div>
                    <OcupacaoDoDia horarios={dados.dia.horarios} agoraMin={ehHoje ? dados.agoraMin : null} selecionada={filtroHora}
                      onEscolher={(h) => setFiltroHora((x) => (x === h ? null : h))} />
                  </section>

                  <ListaDoDia reservas={dados.dia.reservas} mesas={dados.mesas || []} filtroHora={filtroHora} ocupado={ocupado} ehPassado={ehPassado} foco={foco}
                    onLimparFiltro={() => setFiltroHora(null)}
                    onNova={() => setFormulario({ tipo: "nova", data: dados.data!, hora: filtroHora })}
                    onAcao={(r, a) => agir(r, { acao: a }, `A reserva de ${r.nome} ${FRASE_DA_ACAO[a]}.`)}
                    onMesa={(r, mesaId) => agir(r, { acao: "mesa", mesaId }, mesaId ? `${dados.mesas?.find((m) => m.id === mesaId)?.nome} ligada à reserva de ${r.nome}.` : `Reserva de ${r.nome} sem mesa.`)}
                    onMover={(r) => setFormulario({ tipo: "mover", reserva: r })} />

                  {dados.dia.reservas.some((r) => r.status === "CONFIRMADA" || r.status === "CHEGOU") && (
                    <section style={cartao}>
                      <div style={{ marginBottom: 14 }}>
                        <h2 style={h2}>O salão ao longo do dia</h2>
                        <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>Quanto tempo cada reserva segura a mesa. Toque num bloco para achar a reserva na lista.</p>
                      </div>
                      <SalaoAoLongoDaNoite reservas={dados.dia.reservas} horarios={dados.dia.horarios} config={dados.config!} agoraMin={ehHoje ? dados.agoraMin : null} mesas={dados.mesas}
                        onAbrir={abrirReserva} />
                    </section>
                  )}
                </div>

                <aside className="rsv-dia__lado" aria-label="Resumo do dia">
                  <ProximasChegadas reservas={dados.dia.reservas} ehHoje={ehHoje} agoraMin={dados.agoraMin} onAbrir={abrirReserva} />
                  <SituacaoDoDia reservas={dados.dia.reservas} config={dados.config!} onConfigurar={() => setAba("configurar")} />
                  <RoboNoDia reservas={dados.dia.reservas} />
                </aside>
              </div>
            </>
          )}

          {aba === "semana" && <VisaoDaSemana dados={dados} onDia={(d) => { setAba("dia"); irPara(d); }} />}
          {aba === "mes" && <VisaoDoMes dados={dados} onDia={(d) => { setAba("dia"); irPara(d); }} />}
          {aba === "resultados" && <Resultados dados={dados} />}
          {aba === "configurar" && (
            <Configuracao key={JSON.stringify(dados.config)} inicial={dados.config!} configurado={!!dados.configurado} salvando={salvando} onSalvar={salvarConfig}
              lado={<>
                {dados.podeContratar && !e.isento && (
                  <InterruptorDoModulo nome="o módulo Reservas de mesa" preco={dados.preco} estado={e} salvando={salvando}
                    onLigar={() => setTermoAberto(true)} onDesligar={() => ligar(false)} onContinuar={() => ligar(true)} />
                )}
                {e.isento && <p style={{ ...texto, fontSize: 13 }}>Na sua conta as reservas estão liberadas sem custo. Para o lojista: {reais(dados.preco)}/mês à parte da mensalidade, {dados.diasDeTeste} dias grátis.</p>}
              </>}
              rodape={<IlustracaoDasReservas />} />
          )}

          <p style={{ ...texto, fontSize: 12.5, textAlign: "center" }}>
            O robô do WhatsApp usa esta configuração em toda conversa. Aviso de reserva nova chega no seu WhatsApp (Chatbot IA › Notificações).
          </p>
        </>
      )}

      {termoAberto && (
        <Termo preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste={!e.jaTestou && !e.isento}
          salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />
      )}
      {formulario && dados.config && (
        <FormularioDaReserva modo={formulario} dados={dados} onFechar={() => setFormulario(null)}
          onSalvou={async (r, mensagem) => {
            setFormulario(null);
            setAviso({ tipo: "ok", titulo: mensagem });
            setAba("dia");
            setFiltroHora(null);
            await carregar(r.data);
          }} />
      )}
    </div>
  );
}
