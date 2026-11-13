"use client";

/**
 * A projeção do mês das lojas DELE (lib/parceiro/projecao-do-parceiro.ts): a
 * mesma da aba Projeção do admin, só com as lojas da carteira/indicação dele,
 * e a comissão sobre o boleto previsto. O servidor já manda recortado — a
 * tela nunca recebe número de loja de fora.
 */
import { useState } from "react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import type { ProjecaoDoParceiro as Projecao } from "@/lib/parceiro/projecao-do-parceiro";

const SITUACAO: Record<string, string> = { PAGANDO: "Pagando", TESTE_ACABA: "Teste acaba no mês", SO_USO: "Mínimo sem venda" };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeDoMes = (ym: string) => MESES[Number(ym.split("-")[1]) - 1] || ym;

export default function ProjecaoDoParceiro({ projecao, modo }: { projecao: Projecao; modo: "PARCEIRO" | "ADMIN" }) {
  const dinheiro = useDinheiro();
  const [aberta, setAberta] = useState(false);
  const voce = modo === "ADMIN" ? "dele" : "sua";
  const linhas = [...projecao.linhas].sort((a, b) => b.comissao * b.chance - a.comissao * a.chance || b.total - a.total);

  return (
    <section className="pp-painel" aria-labelledby="pp-projecao-titulo" style={{ marginBottom: 16 }}>
      <header className="pp-painel-cabeca">
        <div>
          <h2 id="pp-projecao-titulo" className="pp-h2">Projeção de {nomeDoMes(projecao.mes)}</h2>
          <p className="pp-sub">
            Quanto {modo === "ADMIN" ? "as lojas dele" : "as suas lojas"} devem pagar de mensalidade no fim do mês, no ritmo de venda dos últimos 7 dias,
            e a {voce} comissão sobre isso. A aposta pesa a chance de cada boleto ser pago.
          </p>
        </div>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, padding: "0 18px 16px" }}>
        <div>
          <span className="pp-rotulo">Comissão projetada (aposta)</span>
          <div className="pp-num" style={{ fontSize: "1.6rem", fontWeight: 800, color: "var(--pp-ok)" }}>{dinheiro(projecao.comissao.aposta)}</div>
          <span className="pp-rotulo">entre {dinheiro(projecao.comissao.garantido)} garantido e {dinheiro(projecao.comissao.seTodas)} se todas pagarem</span>
        </div>
        <div>
          <span className="pp-rotulo">Mensalidade das lojas (aposta)</span>
          <div className="pp-num" style={{ fontSize: "1.6rem", fontWeight: 800 }}>{dinheiro(projecao.mensalidade.aposta)}</div>
          <span className="pp-rotulo">{dinheiro(projecao.mensalidade.seTodas)} se todas pagarem</span>
        </div>
        <div>
          <span className="pp-rotulo">Boletos previstos</span>
          <div className="pp-num" style={{ fontSize: "1.6rem", fontWeight: 800 }}>{projecao.boletos} <span style={{ fontSize: "0.9rem", color: "var(--pp-cinza)" }}>de {projecao.lojas} lojas</span></div>
          <span className="pp-rotulo">essas lojas já venderam {dinheiro(projecao.vendidoNoMes)} no mês</span>
        </div>
      </div>
      {projecao.semRepasse > 0 && (
        <p className="pp-aviso-linha" style={{ padding: "0 18px 12px", margin: 0 }}>
          {dinheiro(projecao.semRepasse)} não entram na comissão: o repasse dessas lojas não cai (carteira do Asaas, pausa ou teto do split).
        </p>
      )}
      {linhas.length > 0 && (
        <div style={{ borderTop: "1px solid var(--pp-linha)", padding: "10px 18px 14px" }}>
          <button type="button" className="pp-botao" onClick={() => setAberta((a) => !a)} aria-expanded={aberta}>
            {aberta ? "Esconder as lojas" : `Ver as ${linhas.length} lojas da projeção`}
          </button>
          {aberta && (
            <div className="pp-rolagem" style={{ marginTop: 10, padding: 0 }}>
              <table className="pp-matriz" style={{ minWidth: 560 }}>
                <thead>
                  <tr><th style={{ textAlign: "left" }}>Loja</th><th style={{ textAlign: "left" }}>Situação</th><th>Chance</th><th>Boleto previsto</th><th>Comissão</th></tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 700 }}>{l.loja}</td>
                      <td title={l.porque}>{SITUACAO[l.situacao] || l.situacao}</td>
                      <td className="pp-num" style={{ textAlign: "center" }}>{Math.round(l.chance * 100)}%</td>
                      <td className="pp-num" style={{ textAlign: "right" }}>{dinheiro(l.total)}</td>
                      <td className="pp-num" style={{ textAlign: "right", fontWeight: 800 }}>
                        {l.repasseCai ? `${dinheiro(l.comissao)} · ${l.percentual}%` : "repasse não cai"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
