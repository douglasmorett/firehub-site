"use client";

import { useState } from "react";
import { Check, Printer, ScanLine, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp, Smartphone } from "lucide-react";
import Link from "next/link";

/**
 * A trilha: três passos que RELATAM o que a loja já fez.
 *
 * O que estava aqui antes era um cartaz com quatro passos fixos, numerados,
 * iguais no primeiro dia e no centésimo. Isso tem nome — fake stepper: tem a
 * aparência de progresso e nenhuma ligação com o estado da loja. Depois da
 * segunda visita virou ruído que o dono aprendeu a pular com os olhos, e foi
 * por isso que ele abriu a tela e disse que nada tinha mudado.
 *
 * Aqui cada passo lê uma contagem do banco. Um passo que sabe se você já fez
 * aquilo é software; um passo que não sabe é decoração.
 *
 * Nenhum passo bloqueia: os três são clicáveis sempre. Impedir alguém de
 * imprimir etiqueta porque "ainda não escaneou nada" seria travar a cozinha
 * para ensinar — e a comida está esfriando na bancada.
 */

export default function TrilhaDoQr({
  fluxo,
  aoEscanear,
}: {
  fluxo: { criadas: number; recebidos: number; baixas: number; disponivel: boolean };
  aoEscanear: () => void;
}) {
  const completo = fluxo.criadas > 0 && fluxo.recebidos > 0 && fluxo.baixas > 0;
  // Colapsa quando o fluxo fechou, mas NUNCA some: restaurante contrata gente
  // nova todo mês, e quem entrou ontem precisa do mesmo caminho.
  const [aberta, setAberta] = useState(!completo);

  const passos = [
    {
      n: 1,
      feito: fluxo.criadas > 0,
      icone: <Printer size={18} />,
      titulo: "Crie a etiqueta",
      texto: "No módulo Validade & Etiquetas: escolha o insumo, confira a prévia e imprima. Cada etiqueta já sai com um QR próprio.",
      relato: fluxo.criadas > 0
        ? `${fluxo.criadas} ${fluxo.criadas === 1 ? "etiqueta criada" : "etiquetas criadas"}`
        : "nenhuma etiqueta criada ainda",
      acao: (
        <Link href="/store/etiquetas" className="fh-btn fh-btn--secundario" style={{ height: 44 }}>
          Criar etiqueta
        </Link>
      ),
    },
    {
      n: 2,
      feito: fluxo.recebidos > 0,
      icone: <ArrowDownToLine size={18} />,
      titulo: "Escaneie para dar ENTRADA",
      texto: "Quando a mercadoria chegar ou o preparo sair da cozinha, escaneie o QR e confirme a quantidade. É esse escaneamento que põe o insumo no estoque.",
      relato: fluxo.recebidos > 0
        ? `${fluxo.recebidos} ${fluxo.recebidos === 1 ? "lote recebido" : "lotes recebidos"}`
        : "nenhuma entrada registrada ainda",
      acao: (
        <button className="fh-btn fh-btn--secundario" style={{ height: 44 }} onClick={aoEscanear}>
          <ScanLine size={16} /> Escanear agora
        </button>
      ),
    },
    {
      n: 3,
      feito: fluxo.baixas > 0,
      icone: <ArrowUpFromLine size={18} />,
      titulo: "Escaneie para dar BAIXA",
      texto: "Na hora de usar o produto, escaneie o mesmo QR e dê baixa em dois toques. O saldo do insumo cai sozinho.",
      relato: fluxo.baixas > 0
        ? `${fluxo.baixas} ${fluxo.baixas === 1 ? "baixa registrada" : "baixas registradas"}`
        : "nenhuma saída registrada ainda",
      acao: (
        <button className="fh-btn fh-btn--secundario" style={{ height: 44 }} onClick={aoEscanear}>
          <ScanLine size={16} /> Escanear agora
        </button>
      ),
    },
  ];

  const proximo = passos.find((p) => !p.feito);

  return (
    <div className="fh-card">
      <div className="fh-card__head" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setAberta((v) => !v)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span className="fh-cabecalho__icone" style={{ width: 40, height: 40 }}>
            <ScanLine size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="fh-h2">Etiqueta com QR: como o estoque anda sozinho</h2>
            <p className="fh-corpo" style={{ marginTop: 2 }}>
              {completo
                ? "Sua loja já usa o fluxo inteiro. Deixamos aqui para quem chegou agora."
                : proximo
                  ? `Próximo passo: ${proximo.titulo.toLowerCase()}.`
                  : "Três passos, e o estoque se atualiza sem ninguém digitar nada."}
            </p>
          </div>
        </div>
        <button className="fh-btn fh-btn--fantasma fh-btn--icone" aria-label={aberta ? "Recolher" : "Expandir"} aria-expanded={aberta}>
          {aberta ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
      </div>

      {aberta && (
        <>
          <div className="fh-trilha">
            {passos.map((p) => {
              const atual = !p.feito && proximo?.n === p.n;
              return (
                <div key={p.n} className={`fh-no ${p.feito ? "fh-no--feito" : ""} ${atual ? "fh-no--atual" : ""}`}>
                  <span className="fh-no__bola">{p.feito ? <Check size={20} /> : p.icone}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="fh-no__titulo">
                      {p.n}. {p.titulo}
                    </div>
                    <div className="fh-no__texto">{p.texto}</div>
                    {fluxo.disponivel && (
                      <div className="fh-no__relato" style={{ color: p.feito ? "var(--fh-ok)" : "var(--fh-t4)" }}>
                        {p.relato}
                      </div>
                    )}
                    <div style={{ marginTop: 10 }}>{p.acao}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex", gap: 12, alignItems: "flex-start",
              padding: "14px 20px", borderTop: "1px solid var(--fh-linha)", background: "var(--fh-n3)",
            }}
          >
            <Smartphone size={18} style={{ color: "var(--fh-t3)", flexShrink: 0, marginTop: 2 }} />
            <p className="fh-corpo" style={{ margin: 0 }}>
              <strong style={{ color: "var(--fh-t2)" }}>Na cozinha é ainda mais rápido:</strong> abra a câmera do
              próprio celular e aponte para o QR da etiqueta. Não precisa abrir o sistema nem procurar o item na
              lista — a tela certa abre direto, já com o produto, a validade e quanto resta do lote.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
