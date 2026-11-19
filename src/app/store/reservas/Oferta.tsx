"use client";

/**
 * Reservas DESLIGADAS: a apresentação do módulo — o que muda para o dono, o
 * "como funciona" desenhado, um sábado de exemplo na tela de verdade, o preço
 * claro (R$ 49,90/mês à parte, 7 dias grátis) e as dúvidas. Ao ativar, o termo.
 */
import { useState } from "react";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { CLAUSULAS_DO_TERMO_DAS_RESERVAS, TITULO_DO_TERMO_DAS_RESERVAS, VERSAO_DO_TERMO_DAS_RESERVAS } from "@/lib/reservas/termo";
import { CONFIG_PADRAO, disponibilidadeDoDia, type ReservaParaConta } from "@/lib/reservas/regras";
import { IlustracaoDasReservas } from "./IlustracaoDasReservas";
import { OcupacaoDoDia } from "./VisaoDoDia";
import { Bot, CircleCheck, CircleDollarSign, Gauge, LayoutDashboard, MessageCircle, MoveRight, Plus, X, type LucideIcon } from "lucide-react";
import { BORDA, Botao, COR, TINTA, TINTA_2, TINTA_3, cartao, h2, reais, texto, type Dados } from "./comum";

/** Um sábado cheio de exemplo (rodado pela regra de verdade). */
function sabadoDeExemplo() {
  const config = { ...CONFIG_PADRAO, maxReservasSimultaneas: 10 };
  // Das 19:30 às 20:30 são 10 na mesa: lota (e quem chegaria das 18:00 às 20:30 também não cabe, porque ficaria na mesa até esse pico).
  const chegadas: [string, number][] = [["18:00", 2], ["18:30", 2], ["19:00", 3], ["19:30", 3], ["20:00", 2], ["20:30", 2], ["21:00", 1], ["21:30", 1]];
  const reservas: ReservaParaConta[] = chegadas.flatMap(([hora, n]) => Array.from({ length: n }, () => ({ hora, pessoas: 4, status: "CONFIRMADA" as const })));
  return disponibilidadeDoDia(config, reservas, "2026-11-21", { data: "2026-11-01", minutos: 0 }).filter((h) => h.hora >= "18:00");
}

const CSS_DA_OFERTA = `
.rsv-oferta__heroi{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:clamp(20px,3vw,48px);align-items:center}
.rsv-oferta__beneficios{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.rsv-oferta__beneficios>div+div{border-left:1px solid #E2E8F0}
.rsv-oferta__duvidas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:32px}
.rsv-oferta__duvidas summary{list-style:none}
.rsv-oferta__duvidas summary::-webkit-details-marker{display:none}
.rsv-oferta__duvidas details[open] .rsv-mais{transform:rotate(45deg)}
.rsv-mais{transition:transform .15s cubic-bezier(.2,0,.38,.9)}
@container rsv (max-width:1100px){.rsv-oferta__heroi{grid-template-columns:1fr}.rsv-oferta__beneficios{grid-template-columns:repeat(2,minmax(0,1fr))}.rsv-oferta__beneficios>div:nth-child(3){border-left:none}.rsv-oferta__beneficios>div:nth-child(n+3){border-top:1px solid #E2E8F0}}
@container rsv (max-width:640px){.rsv-oferta__beneficios{grid-template-columns:1fr}.rsv-oferta__beneficios>div+div{border-left:none;border-top:1px solid #E2E8F0}.rsv-oferta__duvidas{grid-template-columns:1fr}}
`;

const BENEFICIOS: [LucideIcon, string, string][] = [
  [Bot, "Consulta a mesa e reserva sozinho", "“Tem mesa sábado 20h pra 4?” O robô confere a vaga de verdade, responde, grava e confirma no WhatsApp. Também lista e cancela a reserva do cliente."],
  [Gauge, "Nunca passa da capacidade", "Você define quantas reservas cabem ao mesmo tempo e quanto dura cada uma. Lotou, ele oferece o horário livre mais perto."],
  [LayoutDashboard, "Tudo claro no painel", "Linha do tempo do dia, semana e mês, com cor por ocupação. Chegou, não veio, mover, cancelar: um toque."],
  [CircleDollarSign, "Resultado em reais", "Reservas e pessoas no mês, comparecimento e quanto as mesas reservadas consumiram."],
];

export function Oferta({ dados, salvando, onAtivar }: { dados: Dados; salvando: boolean; onAtivar: () => void }) {
  const comTeste = !dados.estado.jaTestou;
  const m = dados.mensalidade;
  const duvidas: [string, string][] = [
    ["E se o cliente quiser um horário lotado?", "O robô diz que está cheio e oferece até 3 horários livres mais perto, no mesmo dia ou nos próximos. Nunca confirma o que não cabe."],
    ["Grupo grande, festa, evento?", "Acima do limite de pessoas por reserva que você define, o robô passa a conversa para a equipe combinar."],
    ["O cliente consegue cancelar?", "Sim, pelo próprio WhatsApp. O robô cancela a reserva dele e você recebe o aviso; a vaga volta a ficar livre na hora."],
    ["E as reservas que chegam por telefone ou no balcão?", "Você lança pelo botão “Nova reserva”, com a mesma conferência de vaga. Se quiser apertar mais uma mesa, dá para encaixar."],
    ["Preciso ter o robô ligado?", "Não. Sem o robô você usa o painel para organizar as reservas; com o robô, ele também reserva sozinho."],
    ["E sem o módulo, o que o robô faz com pedido de reserva?", "Anota o pedido (nome, dia, horário, pessoas e observação) e passa para a sua equipe confirmar. Sem o módulo ele não sabe a ocupação, então nunca confirma nem diz se tem mesa."],
    ["O robô pode inventar regra, sinal ou taxa?", "Não. Ele só fala o que está na configuração e nos dados da loja. Sinal, consumação mínima, bolo de fora: se você não escreveu, ele chama a equipe."],
    ["Como é cobrado?", `${reais(dados.preco)} por mês no boleto do FireHub, à parte da mensalidade (${m.percentual}% das vendas, mínimo de ${reais(m.minimo)} e teto de ${reais(m.teto)}). ${comTeste ? `Os ${dados.diasDeTeste} primeiros dias são grátis; desligando dentro deles, nada é cobrado.` : ""} Depois do teste, desligar deixa liberado até o fim do mês, sem valor proporcional.`],
  ];
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <style>{CSS_DA_OFERTA}</style>
      <section className="rsv-entra" style={{ ...cartao, borderRadius: 24, padding: "clamp(20px, 3vw, 40px)" }}>
        <div className="rsv-oferta__heroi">
          <div style={{ display: "grid", gap: 16, alignContent: "center" }}>
            <h2 style={{ margin: 0, font: "900 clamp(28px, 3.2vw, 44px)/1.08 Inter, system-ui, sans-serif", letterSpacing: "-0.03em", color: TINTA, maxWidth: "16ch", textWrap: "balance" }}>
              O robô do WhatsApp consulta se tem mesa e já reserva sozinho.
            </h2>
            <p style={{ ...texto, fontSize: 16, lineHeight: 1.6, color: TINTA_2, maxWidth: "58ch" }}>
              Você diz quantas reservas cabem ao mesmo tempo e em que horários. O cliente pergunta no WhatsApp, o robô confere a vaga de verdade, confirma sozinho,
              oferece outro horário quando lota, e tudo aparece aqui num painel claro: o dia, a semana, o mês e quanto as reservas trouxeram.
            </p>
            <ol aria-label="Como funciona" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              {([[MessageCircle, "“Tem mesa sábado 20h pra 4?”"], [Bot, "O robô confere a vaga"], [CircleCheck, "Reservado e no painel"]] as [LucideIcon, string][]).map(([Icone, t], i) => (
                <li key={t} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {i > 0 && <MoveRight size={16} color={TINTA_3} aria-hidden />}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 12px", borderRadius: 99, background: i === 2 ? "#F0FDFA" : "#F1F5F9", border: `1px solid ${i === 2 ? "#99F6E4" : BORDA}`, color: i === 2 ? "#0F766E" : TINTA, font: "800 13.5px/1 Inter, system-ui, sans-serif" }}>
                    <Icone size={16} aria-hidden />{t}
                  </span>
                </li>
              ))}
            </ol>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingTop: 18, borderTop: `1px solid ${BORDA}` }}>
              <div>
                <span style={{ font: "900 38px/1 Inter, system-ui, sans-serif", letterSpacing: "-0.025em", color: TINTA, fontVariantNumeric: "tabular-nums" }}>{reais(dados.preco)}</span>
                <span style={{ font: "800 15px/1 Inter, system-ui, sans-serif", color: TINTA_3 }}> /mês</span>
                <div style={{ font: "500 13.5px/1.4 Inter, system-ui, sans-serif", color: TINTA_3, marginTop: 6 }}>{comTeste ? `${dados.diasDeTeste} dias grátis para testar · desliga quando quiser` : "sem taxa de instalação"}</div>
              </div>
              {dados.estado.isento ? null : dados.podeContratar ? (
                <Botao onClick={onAtivar} disabled={salvando} style={{ padding: "0 26px", fontSize: 16 }}>
                  {comTeste ? `Testar ${dados.diasDeTeste} dias grátis` : "Ativar as reservas"} <MoveRight size={18} aria-hidden />
                </Botao>
              ) : (
                <span className="fh-estado fh-estado-neutro" style={{ fontSize: 13, height: 36, padding: "0 14px" }}>Quem ativa é o dono da loja.</span>
              )}
            </div>
          </div>
          <div style={{ background: "#F8FAFC", border: `1px solid ${BORDA}`, borderRadius: 18, padding: "18px 18px 14px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <h3 style={{ ...h2, fontSize: 16 }}>Assim fica um sábado cheio no seu painel</h3>
              <span className="fh-estado fh-estado-neutro">Exemplo · 10 ao mesmo tempo · 2h cada</span>
            </div>
            <p style={{ ...texto, fontSize: 13, margin: "4px 0 8px" }}>
              Das 19:30 às 20:30 o salão lota: quem chegaria a partir das 18:00 pegaria esse pico, então o robô para de aceitar e oferece 21:00 em diante.
            </p>
            <OcupacaoDoDia horarios={sabadoDeExemplo()} compacta />
          </div>
        </div>
      </section>

      <section style={{ ...cartao, padding: 0 }}>
        <div className="rsv-oferta__beneficios">
          {BENEFICIOS.map(([Icone, titulo, t]) => (
            <div key={titulo} style={{ padding: "22px 24px", display: "grid", gap: 8, alignContent: "start" }}>
              <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "#FFF4EF", border: "1px solid #FFD3C2", color: COR }}><Icone size={20} /></span>
              <b style={{ font: "800 16px/1.3 Inter, system-ui, sans-serif", color: TINTA, marginTop: 4 }}>{titulo}</b>
              <p style={{ ...texto, fontSize: 14 }}>{t}</p>
            </div>
          ))}
        </div>
      </section>

      <IlustracaoDasReservas />

      <section style={cartao}>
        <h2 style={h2}>Dúvidas</h2>
        <div className="rsv-oferta__duvidas" style={{ marginTop: 6 }}>
          {duvidas.map(([p, r]) => (
            <details key={p} style={{ borderBottom: `1px solid ${BORDA}`, padding: "14px 2px" }}>
              <summary style={{ display: "flex", alignItems: "center", gap: 12, font: "800 15px/1.35 Inter, system-ui, sans-serif", color: TINTA, cursor: "pointer" }}>
                <span style={{ flex: 1 }}>{p}</span><Plus className="rsv-mais" size={18} color={TINTA_3} aria-hidden />
              </summary>
              <p style={{ ...texto, fontSize: 14, marginTop: 8, maxWidth: "70ch" }}>{r}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Termo({ preco, diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  preco: number; diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DAS_RESERVAS}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="rsv-entra" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 64px -16px rgba(15,23,42,.32)" }}>
        <div style={{ padding: "20px 22px 0", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <strong style={{ font: "800 18px/1.3 Inter, system-ui, sans-serif", color: TINTA }}>{TITULO_DO_TERMO_DAS_RESERVAS}</strong>
            <div style={{ font: "500 13px/1.4 Inter, system-ui, sans-serif", color: TINTA_3, marginTop: 2 }}>{reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DAS_RESERVAS.split("-").reverse().join("/")}</div>
          </div>
          <button type="button" onClick={onCancelar} aria-label="Fechar" className="fh-btn fh-btn--fantasma fh-btn--icone" style={{ height: 40, width: 40 }}><X size={20} /></button>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: "16px 22px 0", paddingLeft: 20, font: "500 14px/1.6 Inter, system-ui, sans-serif", color: TINTA_2 }}>
          {CLAUSULAS_DO_TERMO_DAS_RESERVAS.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
        </ol>
        <div style={{ position: "sticky", bottom: 0, background: "#fff", borderTop: `1px solid ${BORDA}`, marginTop: 16, padding: "14px 22px 18px", display: "grid", gap: 14 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", font: "800 14px/1.45 Inter, system-ui, sans-serif", color: TINTA, cursor: "pointer" }}>
            <input type="checkbox" checked={concordo} onChange={(ev) => setConcordo(ev.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: COR, flex: "none" }} />
            Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês no boleto do FireHub, à parte da mensalidade.
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <Botao tipo="secundario" onClick={onCancelar} disabled={salvando} style={{ flex: 1 }}>Agora não</Botao>
            <Botao onClick={onAceitar} disabled={!concordo || salvando} style={{ flex: 2 }}>{salvando ? "Ativando…" : "Concordo e ativar"}</Botao>
          </div>
        </div>
      </div>
    </div>
  );
}
