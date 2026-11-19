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
  BORDA, Botao, COR, COR_CLARA, CSS_DAS_RESERVAS, Numero, TINTA, TINTA_2, TINTA_3, cartao, diaMes, h2, nomeDoMes, reais, texto,
  type Aviso, type Dados, type Estado, type ReservaDaTela,
} from "./comum";
import { Oferta, Termo } from "./Oferta";
import { IlustracaoDasReservas } from "./IlustracaoDasReservas";
import { ListaDoDia, OcupacaoDoDia, SalaoAoLongoDaNoite, type AcaoDaLista } from "./VisaoDoDia";
import { VisaoDaSemana, VisaoDoMes } from "./VisaoSemanaMes";
import { Resultados } from "./Resultados";
import { Configuracao } from "./Configuracao";
import { FormularioDaReserva, type ModoDoFormulario } from "./FormularioDaReserva";

type Aba = "dia" | "semana" | "mes" | "resultados" | "configurar";
const ABAS: [Aba, string][] = [["dia", "📅 Dia"], ["semana", "🗓️ Semana"], ["mes", "📆 Mês"], ["resultados", "💰 Resultados"], ["configurar", "⚙️ Configurar"]];

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

  if (erro) return <div style={{ padding: 24, color: "#B71C1C", fontWeight: 700 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;
  const e = dados.estado;
  const ativo = e.ativo && !!dados.config;
  const ehHoje = dados.data === dados.hoje;
  const ehPassado = !!dados.data && !!dados.hoje && (dados.data < dados.hoje || ehHoje);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 16px 70px", color: TINTA }}>
      <style>{CSS_DAS_RESERVAS}</style>

      {aviso && (
        <div role="status" onClick={() => setAviso(null)} className="rsv-entra" style={{
          position: "sticky", top: 8, zIndex: 50, marginBottom: 12, padding: "12px 16px", borderRadius: 14,
          background: aviso.tipo === "ok" ? "#ECFDF5" : "#FEF2F2", border: `1px solid ${aviso.tipo === "ok" ? "#A7F3D0" : "#FECACA"}`,
          color: aviso.tipo === "ok" ? "#065F46" : "#991B1B", display: "flex", flexDirection: "column", gap: 2, cursor: "pointer", boxShadow: "0 10px 24px rgba(15,23,42,.10)",
        }}>
          <strong>{aviso.titulo}</strong>
          {aviso.detalhe && <span style={{ fontSize: 14 }}>{aviso.detalhe}</span>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <span aria-hidden style={{ width: 46, height: 46, borderRadius: 14, background: `linear-gradient(135deg, ${COR}, #8B5CF6)`, display: "grid", placeItems: "center", fontSize: 24, boxShadow: "0 8px 18px rgba(91,33,182,.3)" }}>📅</span>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: "-0.02em" }}>Reservas de mesa</h1>
          <div style={{ fontSize: 13.5, color: TINTA_2, fontWeight: 600 }}>
            {ativo ? "O robô reserva sozinho, dentro da capacidade que você definir." : "Capacidade por horário, robô que reserva sozinho e o salão claro no painel."}
          </div>
        </div>
        {e.ativo && (
          <span style={{ fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: "#DCFCE7", color: "#166534" }}>
            {e.isento ? "LIBERADO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${diaMes(e.testeAte)}` : e.desligaEm ? `ATIVO até ${diaMes(e.desligaEm)}` : "ATIVO"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {ativo && <Botao onClick={() => setFormulario({ tipo: "nova", data: dados.data || dados.hoje! })} style={{ padding: "12px 18px", fontSize: 15, boxShadow: "0 8px 18px rgba(91,33,182,.3)" }}>+ Nova reserva</Botao>}
      </div>

      {!ativo ? (
        <div style={{ marginTop: 16 }}>
          <Oferta dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
        </div>
      ) : (
        <>
          {/* As abas */}
          <nav className="rsv-abas" style={{ margin: "16px 0", padding: 4, background: "#F1F5F9", borderRadius: 14, width: "fit-content", maxWidth: "100%" }} aria-label="Visões das reservas">
            {ABAS.map(([id, nome]) => (
              <button key={id} type="button" onClick={() => setAba(id)} aria-current={aba === id ? "page" : undefined}
                style={{ padding: "9px 16px", borderRadius: 10, border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  background: aba === id ? "#fff" : "transparent", color: aba === id ? COR : TINTA_2, boxShadow: aba === id ? "0 2px 6px rgba(15,23,42,.10)" : "none" }}>
                {nome}
              </button>
            ))}
          </nav>

          {!dados.configurado && aba !== "configurar" && (
            <button type="button" onClick={() => setAba("configurar")} style={{ ...cartao, width: "100%", textAlign: "left", marginBottom: 16, background: COR_CLARA, borderColor: "#C4B5FD", color: "#4C1D95", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>
              ⚙️ Primeiro passo: confira os dias, horários e quantas reservas cabem ao mesmo tempo. Toque aqui para configurar →
            </button>
          )}

          {(aba === "dia" || aba === "semana" || aba === "mes") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <Botao tipo="secundario" onClick={() => irPara(somarDias(dados.data!, aba === "dia" ? -1 : aba === "semana" ? -7 : -28))} title="Anterior">‹</Botao>
              <strong style={{ fontSize: 18, minWidth: 170, textAlign: "center" }}>
                {aba === "dia" ? dataPorExtenso(dados.data!) : aba === "semana" ? `Semana de ${diaMes(`${dados.semana?.[0]?.data}T12:00:00`)}` : ""}
                {aba === "mes" && nomeDoMes(dados.data!.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())}
                {ehHoje && aba === "dia" && <span style={{ color: COR }}> · hoje</span>}
              </strong>
              <Botao tipo="secundario" onClick={() => irPara(somarDias(dados.data!, aba === "dia" ? 1 : aba === "semana" ? 7 : 31))} title="Próximo">›</Botao>
              {!ehHoje && <Botao tipo="fantasma" onClick={() => irPara(dados.hoje!)} style={{ color: COR }}>Hoje</Botao>}
              <input type="date" value={dados.data} onChange={(ev) => ev.target.value && irPara(ev.target.value)} aria-label="Escolher o dia"
                style={{ padding: "8px 10px", borderRadius: 10, border: `1px solid ${BORDA}`, fontFamily: "inherit", fontSize: 14, color: TINTA }} />
            </div>
          )}

          {aba === "dia" && dados.dia && resumoDoDia && (
            <div style={{ display: "grid", gap: 16 }} className="rsv-entra">
              <div className="rsv-grade">
                <Numero icone="📅" rotulo="Reservas no dia" valor={resumoDoDia.reservas} sub={resumoDoDia.chegaram ? `${resumoDoDia.chegaram} já chegaram` : "confirmadas"} />
                <Numero icone="👥" rotulo="Pessoas" valor={resumoDoDia.pessoas} sub="nas reservas do dia" />
                <Numero icone="🔥" rotulo="Horário mais cheio" valor={resumoDoDia.pico && resumoDoDia.pico.n ? resumoDoDia.pico.hora : "—"}
                  sub={resumoDoDia.pico && resumoDoDia.pico.n ? `${resumoDoDia.pico.n} de ${dados.config!.maxReservasSimultaneas} na mesa` : "nenhuma reserva ainda"} />
                <Numero icone="🟢" rotulo="Horários com vaga" valor={`${resumoDoDia.comVaga} de ${dados.dia.horarios.length}`} sub={resumoDoDia.futuros < dados.dia.horarios.length ? "os que ainda dá para reservar" : "para reserva nova"} destaque={false} />
              </div>

              <section style={cartao}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                  <h2 style={h2}>Ocupação por horário</h2>
                  <span style={{ ...texto, fontSize: 13 }}>Reservas na mesa em cada horário × as {dados.config!.maxReservasSimultaneas} que cabem ao mesmo tempo. Toque num horário para ver quem chega.</span>
                  <span style={{ flex: 1 }} />
                  {filtroHora && <Botao onClick={() => setFormulario({ tipo: "nova", data: dados.data!, hora: filtroHora })}>+ Reservar às {filtroHora}</Botao>}
                </div>
                <OcupacaoDoDia horarios={dados.dia.horarios} agoraMin={ehHoje ? dados.agoraMin : null} selecionada={filtroHora}
                  onEscolher={(h) => setFiltroHora((x) => (x === h ? null : h))} />
              </section>

              {dados.dia.reservas.some((r) => r.status === "CONFIRMADA" || r.status === "CHEGOU") && (
                <section style={cartao}>
                  <h2 style={{ ...h2, marginBottom: 10 }}>O salão ao longo do dia</h2>
                  <SalaoAoLongoDaNoite reservas={dados.dia.reservas} horarios={dados.dia.horarios} config={dados.config!}
                    onAbrir={(r) => { setFiltroHora(r.hora); setTimeout(() => document.getElementById(`reserva-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }} />
                </section>
              )}

              <ListaDoDia reservas={dados.dia.reservas} mesas={dados.mesas || []} filtroHora={filtroHora} ocupado={ocupado} ehPassado={ehPassado}
                onLimparFiltro={() => setFiltroHora(null)}
                onAcao={(r, a) => agir(r, { acao: a }, `A reserva de ${r.nome} ${FRASE_DA_ACAO[a]}.`)}
                onMesa={(r, mesaId) => agir(r, { acao: "mesa", mesaId }, mesaId ? `${dados.mesas?.find((m) => m.id === mesaId)?.nome} ligada à reserva de ${r.nome}.` : `Reserva de ${r.nome} sem mesa.`)}
                onMover={(r) => setFormulario({ tipo: "mover", reserva: r })} />
            </div>
          )}

          {aba === "semana" && <VisaoDaSemana dados={dados} onDia={(d) => { setAba("dia"); irPara(d); }} />}
          {aba === "mes" && <VisaoDoMes dados={dados} onDia={(d) => { setAba("dia"); irPara(d); }} />}
          {aba === "resultados" && <Resultados dados={dados} />}
          {aba === "configurar" && (
            <div style={{ display: "grid", gap: 16 }}>
              <Configuracao key={JSON.stringify(dados.config)} inicial={dados.config!} configurado={!!dados.configurado} salvando={salvando} onSalvar={salvarConfig} />
              {dados.podeContratar && !e.isento && (
                <InterruptorDoModulo nome="o módulo Reservas de mesa" preco={dados.preco} estado={e} salvando={salvando}
                  onLigar={() => setTermoAberto(true)} onDesligar={() => ligar(false)} onContinuar={() => ligar(true)} />
              )}
              {e.isento && <p style={{ ...texto, fontSize: 13 }}>Na sua conta as reservas estão liberadas sem custo. Para o lojista: {reais(dados.preco)}/mês à parte da mensalidade, {dados.diasDeTeste} dias grátis.</p>}
              <IlustracaoDasReservas />
            </div>
          )}

          <p style={{ ...texto, fontSize: 12, color: TINTA_3, marginTop: 24, textAlign: "center" }}>
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
