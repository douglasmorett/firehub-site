"use client";

import { FAIXA_DO_TIPO, textosDasDatas, type DadosDoPapel } from "@/lib/etiqueta-validade";
import type { MedidasDaEtiqueta } from "./etiqueta-css";

/**
 * A etiqueta PEQUENA: 100x60, 60x40, 50x30 mm e a bobina da comanda.
 *
 * Só o que a vigilância lê no pote — tipo, produto, data e hora da
 * manipulação, validade, conservação, responsável e lote (e marca/fornecedor
 * no produto aberto). Tabela nutricional e ingredientes ficam na de 4x6, que é
 * o rótulo de venda.
 *
 * Mesma regra da `EtiquetaPapel`: um componente só para a prévia e para o
 * papel, com o estilo inline (o iframe de impressão copia o HTML, não o CSS
 * do painel).
 */
export default function EtiquetaCompacta({
  medidas,
  etq,
  nomeDoProduto,
  dados,
  textoConservacao,
  mostrarQr,
  mostrarLote,
  nomeDaLoja,
}: {
  medidas: MedidasDaEtiqueta;
  etq: { code: string; qr: string };
  nomeDoProduto: string;
  dados: DadosDoPapel;
  textoConservacao: string;
  mostrarQr: boolean;
  mostrarLote: boolean;
  nomeDaLoja: string;
}) {
  const datas = textosDasDatas(dados);
  const t = medidas.textoMm;
  const qr = mostrarQr && medidas.qrMm > 0 && etq.qr;
  const lote = dados.lote || etq.code;

  return (
    <div
      className="label-page"
      style={{
        display: "flex",
        flexDirection: "column",
        width: medidas.largura,
        height: medidas.altura,
        padding: `${medidas.margemMm[0]}mm ${medidas.margemMm[1]}mm`,
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
        overflow: "hidden",
        fontSize: `${t}mm`,
        lineHeight: 1.2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1mm", marginBottom: "0.8mm" }}>
        <span style={{ background: "#000", color: "#fff", fontWeight: 900, padding: "0.3mm 1.2mm", fontSize: `${t * 0.95}mm`, letterSpacing: "0.15mm", whiteSpace: "nowrap" }}>
          {FAIXA_DO_TIPO[dados.tipo]}
        </span>
        {medidas.cabeLoja && nomeDaLoja && (
          <span style={{ fontWeight: 700, fontSize: `${t * 0.85}mm`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeDaLoja}</span>
        )}
      </div>

      <div style={{ fontSize: `${medidas.nomeMm}mm`, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, maxHeight: `${medidas.nomeMm * 2.25}mm`, overflow: "hidden" }}>
        {nomeDoProduto}
      </div>

      <div style={{ display: "flex", gap: "1.5mm", flex: 1, minHeight: 0, marginTop: "0.8mm" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.3mm", overflow: "hidden" }}>
          {dados.tipo === "ABERTO" && (dados.marca || dados.fornecedor) && (
            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[dados.marca && `Marca: ${dados.marca}`, dados.fornecedor && `Forn.: ${dados.fornecedor}`].filter(Boolean).join(" · ")}
            </div>
          )}
          <div>{datas.rotuloDaData}: <strong>{datas.data}</strong></div>
          <div style={{ fontWeight: 900, fontSize: `${t * 1.2}mm` }}>VAL: {datas.validade}</div>
          {textoConservacao && (
            <div style={{ overflow: "hidden", maxHeight: `${t * 2.5}mm` }}>{textoConservacao.split("\n").join(" · ")}</div>
          )}
          <div style={{ marginTop: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {dados.responsavel && <>Resp.: <strong>{dados.responsavel}</strong></>}
            {dados.responsavel && mostrarLote && lote && " · "}
            {mostrarLote && lote && <>Lote: <strong>{lote}</strong></>}
          </div>
        </div>
        {qr && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flexShrink: 0 }}>
            <img
              src={etq.qr}
              alt=""
              style={{ width: `${medidas.qrMm}mm`, height: `${medidas.qrMm}mm`, display: "block", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any}
            />
            <div style={{ fontSize: `${t * 0.85}mm`, fontFamily: "monospace", fontWeight: "bold" }}>{etq.code}</div>
          </div>
        )}
      </div>
    </div>
  );
}
