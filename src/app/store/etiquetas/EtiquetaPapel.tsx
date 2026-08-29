"use client";

import { AlertTriangle } from "lucide-react";
import type { ChaveDeCampo } from "@/lib/etiqueta-campos";

/**
 * O papel. Uma folha de 4x6in, e nada mais.
 *
 * É o MESMO componente usado na prévia da tela e na cópia que vai para o
 * iframe de impressão — de propósito, e sem nenhum ramo `if (previa)` dentro.
 * Prévia com markup próprio é prévia que mente: basta um `&&` divergir para o
 * lojista aprovar na tela uma etiqueta que sai diferente no papel, e a tela que
 * existe para dar confiança passa a tirá-la.
 *
 * Quatro propriedades que antes só existiam no `<style>` do iframe estão aqui
 * no `style` inline: largura de 4in, fundo branco, texto preto e Arial. Sem
 * elas, no instante em que a `.print-area` deixou de ser `display:none`, a
 * etiqueta virava um bloco de largura automática, em Inter e no cinza-escuro
 * que o globals.css aplica no corpo do painel — e Inter e Arial quebram linha
 * em pontos diferentes, justamente nos campos compridos que a prévia existe
 * para vigiar.
 */

function dataDaEtiqueta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "--";
}

export type PropsDaEtiqueta = {
  etq: { code: string; qr: string };
  nomeDoProduto: string;
  config: any;
  campos: Record<ChaveDeCampo, boolean>;
  textoConservacao: string;
  textoTransgenico: string;
  textoPorcao: string;
  mostrarSeloAltoEm: boolean;
  storeLogo: string;
  nomeDaLoja: string;
  cnpj: string;
  endereco: string;
  fabDate: string;
  valDate: string;
  lote: string;
};

export default function EtiquetaPapel({
  etq,
  nomeDoProduto,
  config,
  campos,
  textoConservacao,
  textoTransgenico,
  textoPorcao,
  mostrarSeloAltoEm,
  storeLogo,
  nomeDaLoja,
  cnpj,
  endereco,
  fabDate,
  valDate,
  lote,
}: PropsDaEtiqueta) {
  const temAlerta = mostrarSeloAltoEm && (config.highSugar || config.highSodium || config.highFat);

  return (
    <div
      className="label-page"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "4in",
        height: "6in",
        padding: "0.12in",
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div className="label-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "0.5mm solid black", paddingBottom: "2mm", marginBottom: "3mm" }}>
          <div style={{ flex: 1, paddingRight: "2mm" }}>
            <div style={{ fontSize: "5mm", fontWeight: "900", textTransform: "uppercase", lineHeight: "1.15" }}>
              {nomeDoProduto}
            </div>
            {campos.peso && (
              <div style={{ fontSize: "3.5mm", fontWeight: "700", marginTop: "1mm" }}>{config.weightStr}</div>
            )}
          </div>
          {temAlerta && (
            <div style={{ border: "0.5mm solid black", borderRadius: "1mm", padding: "1.5mm 3mm", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <AlertTriangle size={16} color="black" style={{ marginRight: "1.5mm" }} />
              <div style={{ fontWeight: "900", fontSize: "3mm", lineHeight: "1.3" }}>
                ALTO EM<br />
                {config.highSugar && <span style={{ background: "black", color: "white", padding: "0.3mm 1mm", display: "inline-block", marginTop: "0.5mm" }}>AÇÚCAR</span>}
                {config.highSodium && <span style={{ background: "black", color: "white", padding: "0.3mm 1mm", display: "inline-block", marginTop: "0.5mm" }}>SÓDIO</span>}
                {config.highFat && <span style={{ background: "black", color: "white", padding: "0.3mm 1mm", display: "inline-block", marginTop: "0.5mm" }}>GORDURA</span>}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "3mm", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: "3mm", lineHeight: "1.4", display: "flex", flexDirection: "column" }}>
            {campos.modoPreparo && config.preparation && (
              <div style={{ marginBottom: "3mm" }}>
                <strong style={{ fontSize: "3.2mm" }}>MODO DE PREPARO:</strong><br />
                {config.preparation.split("\n").map((line: string, i: number) => <span key={i}>{line} </span>)}
              </div>
            )}
            {campos.conservacao && (
              <div style={{ borderTop: "0.3mm solid black", borderBottom: "0.3mm solid black", padding: "2mm 0", fontSize: "2.8mm", marginTop: "auto" }}>
                <strong style={{ display: "block", textAlign: "center", fontSize: "3mm", marginBottom: "1mm" }}>Conservação</strong>
                {textoConservacao.split("\n").map((linha, i) => <div key={i}>{linha}</div>)}
              </div>
            )}
          </div>

          {campos.tabelaNutricional && (
            <div style={{ width: "42mm", flexShrink: 0 }}>
              <div style={{ border: "0.5mm solid black" }}>
                <div style={{ borderBottom: "0.3mm solid black", padding: "1mm", textAlign: "center", fontWeight: "900", fontSize: "3mm" }}>INFORMAÇÃO NUTRICIONAL</div>
                <div style={{ display: "flex", borderBottom: "0.3mm solid black" }}>
                  <div style={{ flex: 1, borderRight: "0.3mm solid black", padding: "0.5mm 1mm", fontSize: "2.5mm", fontWeight: "bold" }}></div>
                  <div style={{ width: "14mm", padding: "0.5mm 1mm", textAlign: "center", fontSize: "2.5mm", fontWeight: "bold" }}>{textoPorcao}</div>
                </div>
                {[
                  ["Energia (kcal)", config.energy],
                  ["Carboidratos", config.carbs],
                  ["Açúcares tot.", config.sugars],
                  ["Açúcares adic.", config.addedSugars],
                  ["Proteínas", config.proteins],
                  ["Gorduras tot.", config.fatTotal],
                  ["Gorduras sat.", config.fatSat],
                  ["Sódio (mg)", config.sodium],
                ].map(([label, val], i, arr) => (
                  <div key={i} style={{ display: "flex", borderBottom: i < arr.length - 1 ? "0.3mm solid black" : "none" }}>
                    <div style={{ flex: 1, borderRight: "0.3mm solid black", padding: "0.8mm 1mm", fontSize: "2.5mm", whiteSpace: "nowrap", overflow: "hidden" }}>{label}</div>
                    <div style={{ width: "14mm", padding: "0.8mm 1mm", textAlign: "center", fontSize: "3mm", fontWeight: "bold" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ borderTop: "0.3mm solid black", paddingTop: "2mm", marginTop: "3mm", fontSize: "2.4mm", lineHeight: "1.2", flex: 1, overflow: "hidden" }}>
          {config.transgenic && (
            <div style={{ display: "flex", alignItems: "center", gap: "2mm", marginBottom: "2mm" }}>
              <div style={{ display: "inline-block", border: "0.4mm solid black", width: "5mm", height: "5mm", transform: "rotate(45deg)", position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%) rotate(-45deg)", fontWeight: "900", fontSize: "3.5mm" }}>T</span>
              </div>
              <span style={{ fontSize: "2.8mm" }}>{textoTransgenico}</span>
            </div>
          )}
          {/* Sem `|| "Não cadastrado."`: a etiqueta imprimia essa frase no lugar
              dos ingredientes, e "ALÉRGICOS: NÃO CADASTRADO" em caixa alta e
              negrito — que um consumidor alérgico pode ler como declaração de
              que não há alérgeno. Campo vazio agora some do papel, e a prévia
              diz por que ele sumiu. */}
          {campos.ingredientes && config.ingredients && (
            <div style={{ marginBottom: "1.5mm" }}>
              <strong>Ingredientes:</strong> {config.ingredients}
            </div>
          )}
          {campos.alergicos && config.allergens && (
            <div style={{ fontWeight: "bold", textTransform: "uppercase", fontSize: "2.4mm" }}>
              ALÉRGICOS: {config.allergens}
            </div>
          )}
        </div>

      </div>

      <div className="label-footer" style={{ borderTop: "0.5mm solid black", paddingTop: "2mm", marginTop: "auto", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1mm" }}>
          <div style={{ fontSize: "3.5mm", fontWeight: "bold", lineHeight: "1.5" }}>
            <div>Fab: {dataDaEtiqueta(fabDate)}</div>
            <div>Val: {dataDaEtiqueta(valDate)}</div>
            {campos.loteInterno && <div>Lote: {lote || "--"}</div>}
          </div>

          {/* O QR: 20mm de símbolo, com o código em texto embaixo.
              O texto não é redundância — é o que salva quando o QR está
              sujo de gordura ou molhado, e é o que o funcionário lê em
              voz alta no telefone com o suporte. */}
          {campos.qr && etq.qr && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5mm" }}>
              <img
                src={etq.qr}
                alt=""
                style={{
                  width: "20mm",
                  height: "20mm",
                  display: "block",
                  // Sem isto o Chrome "economiza tinta" no preto e o
                  // leitor perde contraste na térmica.
                  printColorAdjust: "exact",
                  WebkitPrintColorAdjust: "exact",
                } as any}
              />
              <div style={{ fontSize: "2.6mm", fontFamily: "monospace", fontWeight: "bold", letterSpacing: "0.3mm" }}>
                {etq.code}
              </div>
            </div>
          )}

          {/* Sem `|| "/logo.png"`: esse arquivo não existe em `public/` (só
              favicon.png, icon.png e firehub-flame.png), então o fallback
              imprimia o retângulo de imagem quebrada em papel térmico. */}
          {campos.logo && storeLogo && !(campos.qr && etq.qr) && (
            <img src={storeLogo} alt="" style={{ height: "8mm", filter: "grayscale(100%) brightness(0)", objectFit: "contain" }} />
          )}
        </div>
        {campos.nomeDaLoja && nomeDaLoja && (
          <div style={{ fontSize: "3mm", textAlign: "center", marginTop: "1mm", fontWeight: "bold" }}>
            {nomeDaLoja}
          </div>
        )}
        {campos.cnpj && cnpj && (
          <div style={{ fontSize: "2.5mm", textAlign: "center", borderTop: campos.nomeDaLoja && nomeDaLoja ? "none" : "0.2mm dashed black", paddingTop: campos.nomeDaLoja && nomeDaLoja ? "0" : "1mm" }}>
            <strong>CNPJ:</strong> {cnpj}
          </div>
        )}
        {campos.endereco && endereco && (
          <div style={{ fontSize: "2.5mm", textAlign: "center", lineHeight: "1.2" }}>
            <strong>Endereço:</strong> {endereco}
          </div>
        )}
      </div>
    </div>
  );
}
