"use client";

/**
 * O LIGA/DESLIGA DE UM MÓDULO PAGO (Bill, Multimarcas e os próximos) — o mesmo
 * botão e as mesmas frases em toda tela que liga e desliga.
 *
 * Douglas, 18/10/2026: "tem que ter a opção de ativar e desativar, tipo um botão
 * de liga e desliga… e quando desativar: tem certeza? Como você já usou um dia,
 * vai ser cobrado esse mês já. Então fica liberado o mês todo e, quando virar o
 * mês, bloqueia sozinho… Tem que estar muito explicativo, pra depois não ficar
 * chorando." A regra mora em lib/modulo-pago.ts:
 * - no teste grátis, desligar para na hora e não cobra (o teste não volta);
 * - depois do teste, o mês já está no boleto: fica liberado até o fim do mês e
 *   desliga sozinho na virada; sem valor proporcional.
 */

import { useState } from "react";
import { AlertTriangle, CalendarClock, Check, Power } from "lucide-react";

export type EstadoDoModulo = {
  ativo: boolean;
  emTeste: boolean;
  testeAte: string | null;
  isento: boolean;
  jaTestou: boolean;
  /** Desligamento marcado para a virada do mês. */
  desligaEm: string | null;
  /** Início do mês seguinte (quando desligaria, fora do teste). */
  fimDoMes: string | null;
  /** Não cobrado por cortesia (ex.: Multimarcas com o Aplicativo da loja completo). */
  cortesia?: boolean;
};

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
/** O último dia do mês, a partir do início do mês seguinte. */
const ultimoDia = (inicioDoProximo: string) => dia(new Date(new Date(inicioDoProximo).getTime() - 60_000).toISOString());
const nomeDoMes = (iso: string, delta = 0) => {
  const d = new Date(new Date(iso).getTime() - 60_000);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return d.toLocaleDateString("pt-BR", { month: "long" });
};

export default function InterruptorDoModulo({ nome, preco, estado, salvando, onLigar, onDesligar, onContinuar }: {
  /** Como o módulo é chamado na frase: "o Bill", "o Multimarcas". */
  nome: string;
  preco: number;
  estado: EstadoDoModulo;
  salvando: boolean;
  /** Desligado → ligar: a tela abre o termo de contratação. */
  onLigar: () => void;
  onDesligar: () => void;
  /** Desmarca o desligamento da virada do mês. */
  onContinuar: () => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const e = estado;
  const fim = e.fimDoMes;
  const ligado = e.ativo;
  const marcado = ligado && !!e.desligaEm;

  let titulo: string;
  let texto: React.ReactNode;
  let cor = "#16A34A";
  if (e.isento) {
    titulo = `${cap(nome)} liberado`;
    texto = "Liberado para a sua conta, sem cobrança. Fica sempre ligado.";
  } else if (marcado) {
    cor = "#D97706";
    titulo = `${cap(nome)} desliga em ${dia(e.desligaEm!)}`;
    texto = <>Este mês já está pago, então ele continua <b>liberado até {ultimoDia(e.desligaEm!)}</b>. Na virada do mês ele desliga sozinho e o mês que vem <b>não é cobrado</b>. Mudou de ideia? Toque em “Continuar ligado”.</>;
  } else if (ligado && e.cortesia) {
    titulo = `${cap(nome)} ligado`;
    texto = "Cortesia: enquanto o Aplicativo da loja estiver ativo no Android e no iPhone, não é cobrado.";
  } else if (ligado && e.emTeste && e.testeAte) {
    titulo = `${cap(nome)} ligado · teste grátis`;
    texto = <>Grátis até <b>{dia(e.testeAte)}</b>. Depois disso, se continuar ligado, o mês entra <b>inteiro</b> no boleto: {reais(preco)}. Para não pagar nada, desligue antes de {dia(e.testeAte)}.</>;
  } else if (ligado) {
    titulo = `${cap(nome)} ligado`;
    texto = <>{reais(preco)} por mês, no boleto da mensalidade. {fim ? <>O mês de {nomeDoMes(fim)} já está no boleto (inteiro, sem valor proporcional).</> : null}</>;
  } else {
    cor = "#94A3B8";
    titulo = `${cap(nome)} desligado`;
    texto = e.jaTestou
      ? <>O teste grátis já foi usado: ligando, o mês entra inteiro no boleto ({reais(preco)}).</>
      : "Ligue quando quiser.";
  }

  function tocar() {
    if (salvando || e.isento) return;
    if (!ligado) return onLigar();
    if (marcado) return onContinuar();
    setConfirmar(true);
  }

  return (
    <section style={S.cartao}>
      <button type="button" role="switch" aria-checked={ligado && !marcado} aria-label={ligado ? `Desligar ${nome}` : `Ligar ${nome}`}
        onClick={tocar} disabled={salvando || e.isento} style={{ ...S.interruptor, background: ligado ? cor : "#CBD5E1", cursor: e.isento ? "default" : "pointer" }}>
        <span style={{ ...S.bolinha, transform: ligado && !marcado ? "translateX(26px)" : marcado ? "translateX(13px)" : "translateX(0)" }}>
          {marcado ? <CalendarClock size={14} color={cor} /> : ligado ? <Check size={14} color={cor} /> : <Power size={13} color="#94A3B8" />}
        </span>
      </button>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>{titulo}</div>
        <div style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.5, marginTop: 2 }}>{texto}</div>
      </div>
      {!e.isento && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!ligado && <button style={S.botaoLigar} onClick={onLigar} disabled={salvando}>{salvando ? "Ligando…" : "Ligar"}</button>}
          {marcado && <button style={S.botaoLigar} onClick={onContinuar} disabled={salvando}>{salvando ? "Salvando…" : "Continuar ligado"}</button>}
          {ligado && !marcado && <button style={S.botaoLeve} onClick={() => setConfirmar(true)} disabled={salvando}>Desligar</button>}
        </div>
      )}

      {confirmar && (
        <div role="dialog" aria-modal="true" aria-label={`Desligar ${nome}`} style={S.fundo} onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) setConfirmar(false); }}>
          <div style={S.janela}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={S.icone}><AlertTriangle size={22} /></span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#0F172A" }}>
                  {e.emTeste ? `Desligar ${nome}?` : `Tem certeza que quer desligar ${nome}?`}
                </div>
                {e.emTeste && e.testeAte ? (
                  <>
                    <p style={S.p}>Você está no <b>teste grátis</b> (até {dia(e.testeAte)}). Desligando agora, ele para <b>na hora</b> e <b>nada é cobrado</b>.</p>
                    <p style={S.alerta}>O teste grátis é uma vez só: se ligar de novo depois, o mês já entra inteiro no boleto ({reais(preco)}).</p>
                  </>
                ) : e.cortesia ? (
                  <p style={S.p}>Ele não está sendo cobrado (cortesia do Aplicativo da loja). Continua liberado até <b>{fim ? ultimoDia(fim) : "o fim do mês"}</b> e desliga sozinho na virada do mês.</p>
                ) : (
                  <>
                    <p style={S.p}>Como ele já foi usado este mês, <b>{fim ? nomeDoMes(fim) : "este mês"} já está no boleto</b> ({reais(preco)}). <b>Não existe cobrança proporcional</b>, nem devolução.</p>
                    <p style={S.p}>Por isso ele continua <b>liberado para você até {fim ? ultimoDia(fim) : "o fim do mês"}</b> e desliga sozinho na virada do mês. {fim ? <>Em {nomeDoMes(fim, 1)}</> : <>No mês que vem</>} não é cobrado nada.</p>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 16 }}>
              <button style={S.botaoLeve} onClick={() => setConfirmar(false)} disabled={salvando}>Manter ligado</button>
              <button style={S.botaoPerigo} disabled={salvando} onClick={() => { onDesligar(); setConfirmar(false); }}>
                {salvando ? "Desligando…" : e.emTeste ? "Desligar agora" : "Sim, desligar na virada do mês"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function cap(nome: string) {
  // "o Bill" → "Bill"; "o Multimarcas" → "Multimarcas".
  const sem = nome.replace(/^(o|a)\s+/i, "");
  return sem.charAt(0).toUpperCase() + sem.slice(1);
}

const S: Record<string, React.CSSProperties> = {
  cartao: { display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: 16, borderRadius: 16, background: "#fff", border: "1px solid #E2E8F0", margin: "14px 0" },
  interruptor: { position: "relative", width: 58, height: 32, borderRadius: 999, border: 0, padding: 3, flexShrink: 0, transition: "background .2s ease" },
  bolinha: { display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "transform .2s ease" },
  botaoLigar: { height: 40, padding: "0 16px", borderRadius: 10, border: 0, background: "#16A34A", color: "#fff", fontWeight: 800, cursor: "pointer" },
  botaoLeve: { height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, cursor: "pointer" },
  botaoPerigo: { height: 40, padding: "0 16px", borderRadius: 10, border: 0, background: "#DC2626", color: "#fff", fontWeight: 800, cursor: "pointer" },
  fundo: { position: "fixed", inset: 0, zIndex: 10060, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 16 },
  janela: { background: "#fff", borderRadius: 18, width: "min(520px, 100%)", padding: 20, boxShadow: "0 24px 60px rgba(2,6,23,.35)" },
  icone: { width: 42, height: 42, borderRadius: 12, background: "#FEF3C7", color: "#B45309", display: "grid", placeItems: "center", flexShrink: 0 },
  p: { margin: "8px 0 0", fontSize: 14.5, color: "#334155", lineHeight: 1.55 },
  alerta: { margin: "10px 0 0", fontSize: 13.5, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 10px", lineHeight: 1.5 },
};
