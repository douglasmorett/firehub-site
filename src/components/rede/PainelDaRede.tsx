"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import VitrineDaRede from "./VitrineDaRede";
import { CONFIG_PADRAO, fotosDisponiveis, gravarConfig, lerConfig, type BannerDaRede, type ConfigDaRede, type MarcaDaRede } from "@/lib/rede/config";
import s from "./PainelDaRede.module.css";

/**
 * PRÉVIA — o painel do dono da rede: nome e cor, banners de oferta e as lojas
 * (ordem, nome, tipo, mostrar/ocultar). À direita, a página como o cliente vê
 * no celular, mudando enquanto edita. "Salvar" grava no aparelho e a página
 * aberta em outra aba atualiza sozinha.
 */

const CORES = ["#E8590C", "#C92A2A", "#1F1F23", "#2B8A3E", "#1864AB", "#862E9C", "#F08C00"];

function mover<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j], nova[i]];
  return nova;
}

export default function PainelDaRede() {
  const [config, setConfig] = useState<ConfigDaRede>(CONFIG_PADRAO);
  const [salvo, setSalvo] = useState(true);
  const [aviso, setAviso] = useState("");
  const fotos = fotosDisponiveis();

  useEffect(() => { setConfig(lerConfig()); }, []);

  function mudar(nova: ConfigDaRede) { setConfig(nova); setSalvo(false); }
  function mudarBanner(i: number, campo: Partial<BannerDaRede>) {
    mudar({ ...config, banners: config.banners.map((b, k) => (k === i ? { ...b, ...campo } : b)) });
  }
  function mudarMarca(i: number, campo: Partial<MarcaDaRede>) {
    mudar({ ...config, marcas: config.marcas.map((m, k) => (k === i ? { ...m, ...campo } : m)) });
  }
  function salvar() {
    gravarConfig(config);
    setSalvo(true);
    setAviso("Salvo. A página da rede já mostra as mudanças.");
    setTimeout(() => setAviso(""), 3000);
  }

  return (
    <div className={s.painel}>
      <header className={s.topo}>
        <div>
          <span className={s.etiqueta}>Prévia</span>
          <h1>Página da sua rede</h1>
          <p>Banners de oferta e as lojas que aparecem para o cliente. Um link só para todas as marcas.</p>
        </div>
        <div className={s.acoesTopo}>
          <a className={s.botaoSecundario} href="/rede/previa" target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir a página</a>
          <button className={s.botaoPrincipal} disabled={salvo} onClick={salvar}>{salvo ? "Salvo" : "Salvar"}</button>
        </div>
      </header>
      {aviso && <div className={s.aviso} role="status">{aviso}</div>}

      <div className={s.colunas}>
        <div className={s.formulario}>
          <section className={s.bloco}>
            <h2>Identidade da rede</h2>
            <label className={s.campo}>Nome da rede
              <input value={config.nome} maxLength={40} onChange={(e) => mudar({ ...config, nome: e.target.value })} />
            </label>
            <label className={s.campo}>Frase
              <input value={config.frase} maxLength={100} onChange={(e) => mudar({ ...config, frase: e.target.value })} />
            </label>
            <div className={s.campo}>Cor
              <div className={s.cores}>
                {CORES.map((c) => (
                  <button key={c} className={c === config.cor ? s.corAtiva : s.cor} style={{ background: c }} onClick={() => mudar({ ...config, cor: c })} aria-label={c} />
                ))}
              </div>
            </div>
            <div className={s.linhaDeCampos}>
              <label className={s.campo}>Taxa de entrega (R$)
                <input inputMode="decimal" value={String(config.entrega.taxa).replace(".", ",")}
                  onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (!Number.isNaN(v)) mudar({ ...config, entrega: { ...config.entrega, taxa: v } }); }} />
              </label>
              <label className={s.campo}>Pedido mínimo (R$)
                <input inputMode="decimal" value={String(config.entrega.minimo).replace(".", ",")}
                  onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (!Number.isNaN(v)) mudar({ ...config, entrega: { ...config.entrega, minimo: v } }); }} />
              </label>
            </div>
            <p className={s.dica}>Na versão real a taxa sai das áreas de entrega da loja, pelo endereço do cliente — uma só, mesmo com várias marcas no pedido.</p>
          </section>

          <section className={s.bloco}>
            <div className={s.blocoTopo}>
              <h2>Banners de oferta</h2>
              <button className={s.botaoSecundario} onClick={() => mudar({
                ...config,
                banners: [...config.banners, { id: `b${Date.now()}`, titulo: "Nova oferta", texto: "", imagem: fotos[0]?.foto ?? null, marca: config.marcas[0]?.id ?? null, ativo: true }],
              })}><Plus size={16} /> Banner</button>
            </div>
            {config.banners.map((b, i) => (
              <div key={b.id} className={`${s.item} ${b.ativo ? "" : s.itemApagado}`}>
                <div className={s.itemTopo}>
                  {b.imagem ? <img src={b.imagem} alt="" className={s.miniatura} /> : <span className={s.miniatura} />}
                  <input className={s.inputTitulo} value={b.titulo} maxLength={50} onChange={(e) => mudarBanner(i, { titulo: e.target.value })} />
                  <div className={s.botoesDoItem}>
                    <button onClick={() => mudar({ ...config, banners: mover(config.banners, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                    <button onClick={() => mudar({ ...config, banners: mover(config.banners, i, 1) })} aria-label="Descer"><ArrowDown size={15} /></button>
                    <button onClick={() => mudarBanner(i, { ativo: !b.ativo })} aria-label={b.ativo ? "Esconder" : "Mostrar"}>{b.ativo ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                    <button onClick={() => mudar({ ...config, banners: config.banners.filter((_, k) => k !== i) })} aria-label="Apagar"><Trash2 size={15} /></button>
                  </div>
                </div>
                <label className={s.campo}>Texto menor
                  <input value={b.texto} maxLength={70} onChange={(e) => mudarBanner(i, { texto: e.target.value })} />
                </label>
                <div className={s.linhaDeCampos}>
                  <label className={s.campo}>Leva para
                    <select value={b.marca ?? ""} onChange={(e) => mudarBanner(i, { marca: e.target.value || null })}>
                      <option value="">Só aviso (não abre loja)</option>
                      {config.marcas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </label>
                  <label className={s.campo}>Foto
                    <select value={b.imagem ?? ""} onChange={(e) => mudarBanner(i, { imagem: e.target.value || null })}>
                      <option value="">Sem foto (cor da loja)</option>
                      {fotos.map((f) => <option key={f.foto} value={f.foto}>{f.nome}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
            <p className={s.dica}>Na versão real: enviar a arte do banner (1600 × 800) e marcar dia e horário em que ele aparece.</p>
          </section>

          <section className={s.bloco}>
            <h2>Lojas da rede</h2>
            {config.marcas.map((m, i) => (
              <div key={m.id} className={`${s.item} ${m.oculta ? s.itemApagado : ""}`}>
                <div className={s.itemTopo}>
                  <span className={s.letra} style={{ background: m.cor }}>{m.nome.slice(0, 1)}</span>
                  <input className={s.inputTitulo} value={m.nome} maxLength={40} onChange={(e) => mudarMarca(i, { nome: e.target.value })} />
                  <div className={s.botoesDoItem}>
                    <button onClick={() => mudar({ ...config, marcas: mover(config.marcas, i, -1) })} aria-label="Subir"><ArrowUp size={15} /></button>
                    <button onClick={() => mudar({ ...config, marcas: mover(config.marcas, i, 1) })} aria-label="Descer"><ArrowDown size={15} /></button>
                    <button onClick={() => mudarMarca(i, { oculta: !m.oculta })} aria-label={m.oculta ? "Mostrar" : "Esconder"}>{m.oculta ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                </div>
                <div className={s.linhaDeCampos}>
                  <label className={s.campo}>Tipo de comida
                    <input value={m.tipo} maxLength={20} onChange={(e) => mudarMarca(i, { tipo: e.target.value })} />
                  </label>
                  <label className={s.campo}>Cor
                    <input type="color" value={m.cor} onChange={(e) => mudarMarca(i, { cor: e.target.value })} />
                  </label>
                  <label className={s.campoCheck}>
                    <input type="checkbox" checked={m.aberta} onChange={(e) => mudarMarca(i, { aberta: e.target.checked })} /> Aberta
                  </label>
                </div>
              </div>
            ))}
            <p className={s.dica}>Na versão real: logo e capa de cada loja, quais categorias do cardápio são dela, e horário próprio.</p>
          </section>

          <button className={s.restaurar} onClick={() => mudar(CONFIG_PADRAO)}><RotateCcw size={14} /> Voltar ao exemplo inicial</button>
        </div>

        <aside className={s.previa} aria-label="Como o cliente vê">
          <span className={s.previaRotulo}>Como o cliente vê</span>
          <div className={s.telefone}>
            <VitrineDaRede config={config} embutida />
          </div>
        </aside>
      </div>
    </div>
  );
}
