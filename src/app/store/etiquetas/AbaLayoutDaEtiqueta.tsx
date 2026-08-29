"use client";

import { Lock, PencilLine } from "lucide-react";
import {
  CHAVES_DE_CAMPO,
  NOME_DO_PRESET,
  EXPLICACAO_DO_PRESET,
  seloAltoEmSuprimido,
  type ChaveDeCampo,
  type PresetDaEtiqueta,
  type CamposResolvidos,
} from "@/lib/etiqueta-campos";

/**
 * "O que sai no papel" — a aba que o dono pediu.
 *
 * A ordem dos grupos é a ORDEM FÍSICA na folha, de cima para baixo. Se a lista
 * não seguir o papel, a correspondência se perde e a aba deixa de ensinar: o
 * lojista liga um interruptor e procura a mudança no lugar errado da prévia.
 */

type Grupo = { titulo: string; chaves: ChaveDeCampo[] };

const GRUPOS: Grupo[] = [
  { titulo: "Topo da etiqueta", chaves: ["peso"] },
  { titulo: "Miolo", chaves: ["modoPreparo", "conservacao", "tabelaNutricional"] },
  { titulo: "Texto obrigatório", chaves: ["ingredientes", "alergicos"] },
  { titulo: "Rodapé", chaves: ["loteInterno", "qr", "logo", "nomeDaLoja", "cnpj", "endereco"] },
];

const ROTULO: Record<ChaveDeCampo, { titulo: string; ajuda: string }> = {
  peso: { titulo: "Peso da embalagem", ajuda: "Sai logo abaixo do nome do produto." },
  modoPreparo: { titulo: "Modo de preparo", ajuda: "Sai no miolo, do lado esquerdo." },
  conservacao: { titulo: "Como conservar", ajuda: "A caixinha com as temperaturas, no miolo." },
  tabelaNutricional: { titulo: "Tabela nutricional", ajuda: "A tabela no canto direito do miolo." },
  ingredientes: { titulo: "Ingredientes", ajuda: "Sai na faixa de baixo, antes dos alérgicos." },
  alergicos: { titulo: "Alérgicos", ajuda: "A linha em caixa alta no fim do miolo." },
  loteInterno: { titulo: "Número do lote", ajuda: "Sai no rodapé, junto com as datas." },
  qr: { titulo: "QR de rastreio", ajuda: "O código que a cozinha escaneia para dar entrada e baixa." },
  logo: { titulo: "Logo da loja", ajuda: "No rodapé. Não sai junto com o QR — os dois disputam o mesmo canto." },
  nomeDaLoja: { titulo: "Nome da loja", ajuda: "Centralizado no rodapé." },
  cnpj: { titulo: "CNPJ", ajuda: "Centralizado no rodapé, abaixo do nome." },
  endereco: { titulo: "Endereço", ajuda: "A última linha da etiqueta." },
};

function Switch({ ligado, onChange, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string }) {
  return (
    <span className="fh-sw-caixa">
      {/* Checkbox nativo escondido por baixo, nunca <div onClick>: no desktop o
          dono usa teclado, e a aba inteira ficaria inacessível por Tab/Espaço. */}
      <input
        type="checkbox"
        checked={ligado}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={rotulo}
      />
      <span className="fh-sw" data-on={ligado ? "true" : "false"} aria-hidden="true">
        <i />
      </span>
    </span>
  );
}

export default function AbaLayoutDaEtiqueta({
  preset,
  resolvido,
  ligados,
  onAlternar,
  onTrocarPreset,
  onIrParaFicha,
  temSeloAltoEm,
  temTransgenico,
  salvando,
}: {
  preset: PresetDaEtiqueta;
  resolvido: CamposResolvidos;
  ligados: Record<ChaveDeCampo, boolean>;
  onAlternar: (chave: ChaveDeCampo, valor: boolean) => void;
  onTrocarPreset: (p: PresetDaEtiqueta) => void;
  onIrParaFicha: () => void;
  temSeloAltoEm: boolean;
  temTransgenico: boolean;
  salvando: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--fh-s6)" }}>

      {/* ── Para que serve esta etiqueta ─────────────────────────────────── */}
      <div className="fh-card">
        <div className="fh-card__head">
          <div>
            <h2 className="fh-h2">Para que serve esta etiqueta?</h2>
            <p className="fh-corpo" style={{ marginTop: 4 }}>
              A resposta muda o que a lei exige no papel. Escolha e o resto se ajusta sozinho.
            </p>
          </div>
        </div>
        <div className="fh-card__body" style={{ display: "grid", gap: 10 }}>
          {(["cozinha", "venda", "fornecimento"] as PresetDaEtiqueta[]).map((p) => {
            const ativo = preset === p;
            return (
              <button
                key={p}
                onClick={() => onTrocarPreset(p)}
                disabled={salvando}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  borderRadius: "var(--fh-r3)",
                  cursor: salvando ? "default" : "pointer",
                  minHeight: "var(--fh-alvo-toque)",
                  border: ativo ? "2px solid var(--fh-marca-topo)" : "1px solid var(--fh-linha)",
                  background: ativo ? "var(--fh-marca-claro)" : "var(--fh-n1)",
                }}
              >
                <div style={{ font: "800 15px/1.3 Inter, system-ui, sans-serif", color: ativo ? "var(--fh-marca-tinta)" : "var(--fh-t1)" }}>
                  {NOME_DO_PRESET[p]}
                </div>
                <div style={{ font: "500 13px/1.45 Inter, system-ui, sans-serif", color: "var(--fh-t3)", marginTop: 3 }}>
                  {EXPLICACAO_DO_PRESET[p]}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Os blocos ────────────────────────────────────────────────────── */}
      <div className="fh-card">
        <div className="fh-card__head">
          <div>
            <h2 className="fh-h2">O que sai no papel</h2>
            <p className="fh-corpo" style={{ marginTop: 4 }}>
              Ligue e desligue à vontade: a etiqueta ao lado muda na hora. A ordem aqui é a mesma ordem da folha,
              de cima para baixo.
            </p>
          </div>
        </div>

        <div style={{ padding: "0 4px 12px" }}>
          {GRUPOS.map((g) => (
            <div key={g.titulo}>
              <div className="fh-grupo-titulo">{g.titulo}</div>

              {/* O selo "ALTO EM" e o transgênico entram como ESPELHO logo no
                  topo: são dado da ficha do produto, não configuração de
                  layout. Duplicar a verdade em dois lugares é como o papel e a
                  tela passam a discordar. */}
              {g.titulo === "Topo da etiqueta" && !seloAltoEmSuprimido(preset) && (
                <div className="fh-linha-bloco fh-linha-bloco--travada">
                  <div>
                    <div className="fh-linha-bloco__titulo">Selo &quot;ALTO EM&quot;</div>
                    <div className="fh-linha-bloco__ajuda">
                      {temSeloAltoEm
                        ? "Está marcado na ficha do produto, então sai no canto de cima."
                        : "Não está marcado na ficha do produto, então não sai."}
                    </div>
                  </div>
                  <span className="fh-palavra-estado fh-palavra-estado--nao">FICHA</span>
                  <button className="fh-btn fh-btn--fantasma" onClick={onIrParaFicha} style={{ height: 44 }}>
                    <PencilLine size={16} /> editar na ficha
                  </button>
                </div>
              )}

              {g.chaves.map((chave) => {
                const trava = resolvido.travas[chave];
                const sai = resolvido.campos[chave];

                if (trava) {
                  return (
                    <div key={chave} className="fh-linha-bloco fh-linha-bloco--travada">
                      <div>
                        <div className="fh-linha-bloco__titulo">{ROTULO[chave].titulo}</div>
                        {/* O porquê fica escrito ao lado. Trava sem motivo
                            visível vira "o sistema não deixa" — e o lojista
                            liga para o suporte para perguntar o que fazer. */}
                        <div className="fh-linha-bloco__ajuda">{trava.motivo}</div>
                      </div>
                      <span className="fh-palavra-estado fh-palavra-estado--sai">SAI</span>
                      <span className="fh-chip">
                        <Lock size={14} /> SEMPRE
                      </span>
                    </div>
                  );
                }

                return (
                  <label key={chave} className="fh-linha-bloco">
                    <div>
                      <div className="fh-linha-bloco__titulo">{ROTULO[chave].titulo}</div>
                      <div className="fh-linha-bloco__ajuda">{ROTULO[chave].ajuda}</div>
                    </div>
                    <span
                      className={`fh-palavra-estado ${sai ? "fh-palavra-estado--sai" : "fh-palavra-estado--nao"} fh-linha-bloco__estado`}
                    >
                      {sai ? "SAI" : "NÃO SAI"}
                    </span>
                    <Switch
                      ligado={ligados[chave]}
                      onChange={(v) => onAlternar(chave, v)}
                      rotulo={ROTULO[chave].titulo}
                    />
                  </label>
                );
              })}

              {g.titulo === "Texto obrigatório" && (
                <div className="fh-linha-bloco fh-linha-bloco--travada">
                  <div>
                    <div className="fh-linha-bloco__titulo">Aviso de transgênico</div>
                    <div className="fh-linha-bloco__ajuda">
                      {temTransgenico
                        ? "Está marcado na ficha do produto, então o símbolo T sai na faixa de baixo."
                        : "Não está marcado na ficha do produto, então não sai."}
                    </div>
                  </div>
                  <span className="fh-palavra-estado fh-palavra-estado--nao">FICHA</span>
                  <button className="fh-btn fh-btn--fantasma" onClick={onIrParaFicha} style={{ height: 44 }}>
                    <PencilLine size={16} /> editar na ficha
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
