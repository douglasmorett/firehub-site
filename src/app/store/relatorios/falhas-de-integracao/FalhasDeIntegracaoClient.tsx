"use client";
/**
 * Pedidos com falha na integração — a tela. A conta mora em
 * lib/relatorios/falhas-de-integracao.ts; aqui são o período, os cartões e a
 * lista: quando, de qual app, o número do pedido no app, o que aconteceu em
 * linguagem de lojista e se o pedido entrou depois.
 *
 * O que o SWFast não diz e esta tela diz: o PORQUÊ (a conexão caiu, o app não
 * respondeu, erro nosso) e se o pedido acabou entrando sozinho — o que falta
 * conferir no portal do app é só o "Não entrou".
 */
import React from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia } from "@/lib/relatorios/base";
import type { LinhaDaFalha, ResultadoDasFalhas } from "@/lib/relatorios/falhas-de-integracao";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDasFalhas & {
  periodo: { de: string; ate: string };
  tz: string;
  avisos: { registradasDesde: string; periodoAntesDoRegistro: boolean; cortado: boolean };
};

const th: React.CSSProperties = { textAlign: "left", padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "9px 0.8rem", verticalAlign: "top" };
const cabecaDaTabela: React.CSSProperties = { color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` };
const suave: React.CSSProperties = { fontSize: "0.74rem", color: PALETA.areiaTinta, fontWeight: 500 };

function Situacao({ l }: { l: LinhaDaFalha }) {
  const c = l.entrou ? { cor: PALETA.ok, fundo: PALETA.okClaro } : { cor: PALETA.grave, fundo: PALETA.graveClaro };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 800, color: c.cor, background: c.fundo, whiteSpace: "nowrap" }}>
      {l.situacao}
    </span>
  );
}

export default function FalhasDeIntegracaoClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("falhas-de-integracao", query);
  const comDia = dados ? dados.periodo.de !== dados.periodo.ate : false;

  return (
    <ModeloDoRelatorio
      titulo="Pedidos com falha na integração"
      descricao="Pedido do iFood ou do 99Food que não entrou no FireHub: quando, qual pedido, por quê — e se ele entrou depois. Confira no portal do app só os que estão como “Não entrou”."
      slug="falhas-de-integracao" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje}
        visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados?.avisos.periodoAntesDoRegistro && (
        <p role="note" style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.carvao2, borderRadius: 12, padding: "0.7rem 1rem", fontSize: "0.84rem", margin: "0 0 1rem" }}>
          O FireHub registra as falhas desde <strong>{fmtDia(dados.avisos.registradasDesde)}</strong>: antes disso não há o que mostrar.
        </p>
      )}

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Não entraram" tom={dados.naoEntraram ? "grave" : "ok"} valor={dados.naoEntraram.toLocaleString("pt-BR")}
            detalhe={dados.naoEntraram ? "confira no portal do app — o pedido pode estar esperando lá" : "nenhum pedido ficou de fora"} />
          <Cartao rotulo="Entraram depois" tom="neutro" valor={dados.entraram.toLocaleString("pt-BR")}
            detalhe="falharam na chegada e entraram sozinhos numa nova tentativa" />
          {dados.porPlataforma.map((p) => (
            <Cartao key={p.plataforma} rotulo={p.nome} valor={p.total.toLocaleString("pt-BR")}
              detalhe={p.naoEntraram ? `${p.naoEntraram.toLocaleString("pt-BR")} não entraram` : "todas entraram depois"} />
          ))}
        </GradeDeCartoes>
      )}

      {dados && (
        <Bloco titulo="As falhas" subtitulo="A mais recente primeiro · a hora é a da primeira falha, no relógio da loja" semPadding>
          {dados.lista.length === 0 ? (
            <Vazio texto="Nenhum pedido de app falhou no período. Todo pedido do iFood e do 99Food entrou na primeira tentativa." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 760 }}>
                <thead>
                  <tr style={cabecaDaTabela}>
                    <th style={th}>Quando</th><th style={th}>App</th><th style={th}>Pedido no app</th>
                    <th style={th}>O que aconteceu</th><th style={th}>Situação hoje</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.lista.map((l) => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>
                        {comDia ? `${fmtDia(l.dia).slice(0, 5)} ` : ""}{l.hora}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{l.nomeDaPlataforma}</td>
                      <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 800 }} title={`Id no app: ${l.pedidoExterno}`}>{l.codigo}</td>
                      <td style={td}>
                        <div>{l.oQueAconteceu}</div>
                        <details style={{ marginTop: 2 }}>
                          <summary style={{ ...suave, cursor: "pointer" }}>detalhe para o suporte</summary>
                          <div style={{ ...suave, wordBreak: "break-word", marginTop: 2 }}>{l.detalhe}</div>
                        </details>
                      </td>
                      <td style={td}>
                        <Situacao l={l} />
                        {l.tentativas > 1 && l.entrou && <div style={suave}>{l.tentativas} tentativas</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dados.avisos.cortado && (
            <p style={{ ...suave, padding: "0.7rem 1rem", margin: 0 }}>Mostrando as {dados.lista.length.toLocaleString("pt-BR")} mais recentes. Escolha um período menor para ver as outras.</p>
          )}
          <p style={{ ...suave, fontSize: "0.76rem", padding: "0.8rem 1rem", margin: 0, lineHeight: 1.5 }}>
            O FireHub tenta de novo sozinho: o iFood devolve o pedido no próximo minuto e o 99Food reenvia. “Entrou depois” quer dizer que uma dessas tentativas deu certo e o pedido está no painel.
            {" "}“Não entrou” é o pedido que ainda não existe no FireHub — veja no portal do app se ele foi atendido por lá ou cancelado.
          </p>
        </Bloco>
      )}
    </ModeloDoRelatorio>
  );
}
