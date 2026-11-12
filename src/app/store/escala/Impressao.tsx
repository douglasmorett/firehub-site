"use client";

/**
 * O papel da parede: a escala do dia, da semana ou do mês numa tabela A4
 * limpa (nome da loja, período, um bloco por dia, quem vem em letra grande),
 * e o cartaz com o QR do link.
 *
 * Vai para o <body> por portal e o CSS de impressão esconde todo o resto do
 * body: o painel tem menu lateral, faixas de aviso e botões flutuantes que
 * não podem sair no papel — e esconder um por um esquece o próximo que
 * alguém criar.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { diaPorExtenso, horarioDoTurno, situacaoDasVagas, tituloDoPeriodo, type Visao } from "@/lib/escala-da-equipe/regras";
import { SELO_DO_TIPO, type Turno } from "./ui";
import { enderecoDoLink, useQrDoLink } from "./LinkDeInscricao";

export type O_QUE_IMPRIMIR = "escala" | "cartaz";

export default function Impressao({ oQue, visao, data, turnos, nomeDaLoja, codigo, onPronto }: {
  oQue: O_QUE_IMPRIMIR; visao: Visao; data: string; turnos: Turno[]; nomeDaLoja: string; codigo: string; onPronto: () => void;
}) {
  const [montado, setMontado] = useState(false);
  const qr = useQrDoLink(enderecoDoLink(codigo), 520);
  const imprimiu = useRef(false);
  useEffect(() => setMontado(true), []);
  // Imprime uma vez, quando o papel está pronto (o cartaz espera o QR), e some depois.
  useEffect(() => {
    if (!montado || imprimiu.current || (oQue === "cartaz" && !qr)) return;
    const t = setTimeout(() => {
      imprimiu.current = true;
      window.addEventListener("afterprint", () => onPronto(), { once: true });
      window.print();
    }, 150);
    return () => clearTimeout(t);
  }, [montado, oQue, qr, onPronto]);
  if (!montado) return null;

  const dias = [...new Set(turnos.map((t) => t.data))].sort();
  const impressoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return createPortal(
    <div className="esc-papel">
      <style>{CSS_DO_PAPEL}</style>
      {oQue === "cartaz" ? (
        <div className="esc-cartaz">
          <div className="loja">{nomeDaLoja}</div>
          <h1>Escala da equipe</h1>
          <p className="chamada">Escolha o seu turno pelo celular</p>
          {qr && <img src={qr} alt="QR do link" />}
          <ol>
            <li>Aponte a câmera para o QR</li>
            <li>Entre com o seu WhatsApp</li>
            <li>Toque em <b>Quero esta vaga</b></li>
          </ol>
          <div className="link">{enderecoDoLink(codigo)}</div>
        </div>
      ) : (
        <>
          <div className="cabeca">
            <div>
              <div className="loja">{nomeDaLoja}</div>
              <h1>Escala da equipe — {tituloDoPeriodo(visao, data)}</h1>
            </div>
            <div className="impresso">Impresso em {impressoEm}</div>
          </div>
          {dias.length === 0 ? <p>Nenhum turno neste período.</p> : (
            <table>
              <thead>
                <tr><th style={{ width: "17%" }}>Dia</th><th style={{ width: "15%" }}>Horário</th><th style={{ width: "15%" }}>Função</th><th style={{ width: "9%" }}>Vagas</th><th>Quem vem</th></tr>
              </thead>
              {dias.map((d) => {
                const doDia = turnos.filter((t) => t.data === d);
                return (
                  <tbody key={d} className="bloco">
                    {doDia.map((t, k) => {
                      const v = situacaoDasVagas(t.inscritos.length, t.vagas);
                      return (
                        <tr key={t.id}>
                          {k === 0 && <td rowSpan={doDia.length} className="dia">{diaPorExtenso(d)}</td>}
                          <td className="hora">{horarioDoTurno(t.inicio, t.fim)}</td>
                          <td><b>{t.funcao}</b>{t.obs && <div className="obs">{t.obs}</div>}</td>
                          <td className={v.faltam > 0 ? "falta" : ""}>{v.preenchidas}/{v.vagas}</td>
                          <td className="nomes">
                            {t.inscritos.map((i) => <span key={i.id} className="nome">{i.nome}<small> ({SELO_DO_TIPO[i.pessoaTipo].rotulo.toLowerCase()})</small></span>)}
                            {Array.from({ length: v.faltam }, (_, j) => <span key={`v${j}`} className="vaga">vaga aberta</span>)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

const CSS_DO_PAPEL = `
.esc-papel { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  body > *:not(.esc-papel) { display: none !important; }
  body { background: #fff !important; }
  .esc-papel { display: block !important; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .esc-papel .cabeca { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
  .esc-papel .loja { font-size: 13pt; font-weight: 700; }
  .esc-papel h1 { font-size: 17pt; margin: 2px 0 0; }
  .esc-papel .impresso { font-size: 8.5pt; color: #444; }
  .esc-papel table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  .esc-papel th { text-align: left; background: #eee; border: 1px solid #999; padding: 5px 6px; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .esc-papel td { border: 1px solid #999; padding: 5px 6px; vertical-align: top; }
  .esc-papel .bloco { break-inside: avoid; page-break-inside: avoid; }
  .esc-papel .dia { font-weight: 700; text-transform: capitalize; background: #f6f6f6; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .esc-papel .hora { white-space: nowrap; }
  .esc-papel .obs { font-size: 8.5pt; color: #444; margin-top: 2px; }
  .esc-papel .falta { font-weight: 700; }
  .esc-papel .nomes .nome { display: inline-block; font-size: 12pt; font-weight: 700; margin-right: 14px; }
  .esc-papel .nomes small { font-weight: 400; font-size: 8pt; color: #444; }
  .esc-papel .vaga { display: inline-block; border: 1px dashed #777; border-radius: 4px; padding: 0 8px; margin-right: 8px; font-size: 9pt; color: #555; min-width: 90px; }
  .esc-cartaz { text-align: center; padding-top: 20mm; }
  .esc-cartaz .loja { font-size: 22pt; }
  .esc-cartaz h1 { font-size: 40pt; margin: 6mm 0 2mm; }
  .esc-cartaz .chamada { font-size: 18pt; margin: 0 0 10mm; }
  .esc-cartaz img { width: 110mm; height: 110mm; }
  .esc-cartaz ol { display: inline-block; text-align: left; font-size: 16pt; margin: 10mm 0 6mm; line-height: 1.6; }
  .esc-cartaz .link { font-size: 12pt; color: #333; word-break: break-all; }
}
`;
