"use client";

/**
 * "Qual loja você quer abrir?" — a pergunta do /login para quem tem mais de
 * uma loja no mesmo acesso (Douglas, 08/10/2026, Pizzaria 17 + Pizzaria 17
 * Aeroporto). Antes o login caía sempre na loja PRINCIPAL e a pessoa tinha de
 * achar o "Suas Lojas" no topo para ir à filial — e quem abria o painel na
 * filial para trabalhar começava o turno olhando os pedidos da outra loja.
 *
 * Mesmo visual e mesmo lugar da escolha loja × portal do parceiro
 * (EscolhaDePainel). A troca é a do seletor "Suas Lojas"
 * (lib/trocar-de-loja.ts).
 */
import { useEffect, useState } from "react";
import { ArrowRight, LayoutGrid, Store } from "lucide-react";
import { trocarDeLoja, type GrupoDeLojas } from "@/lib/trocar-de-loja";
import { ESTILO_DA_ESCOLHA } from "./EscolhaDePainel";

/** A última escolha deste navegador, só para marcar "Última usada". */
const CHAVE_ULTIMA = "fh_ultima_loja";

export default function EscolhaDeLoja({
  grupo,
  aoEntrarComOutraConta,
}: {
  grupo: GrupoDeLojas;
  aoEntrarComOutraConta: () => void;
}) {
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [ultima, setUltima] = useState<string | null>(null);

  useEffect(() => {
    try {
      setUltima(localStorage.getItem(CHAVE_ULTIMA));
    } catch {}
  }, []);

  const abrir = async (escolha: string) => {
    if (abrindo) return;
    setErro("");
    setAbrindo(escolha);
    const r = await trocarDeLoja(escolha, grupo.stores, grupo.sessaoLojaId);
    if (!r.ok) {
      setErro(r.erro);
      setAbrindo(null);
      return;
    }
    try {
      localStorage.setItem(CHAVE_ULTIMA, escolha);
    } catch {}
    window.location.href = "/store";
  };

  const n = grupo.stores.length;
  const opcoes = [
    ...grupo.stores.map((l) => ({
      id: l.id,
      rotulo: l.storeName || "Loja",
      detalhe: [l.isPrimaryStore ? "Principal" : null, l.city, l.storeOpen ? "Site aberto" : "Site fechado"].filter(Boolean).join(" · "),
      todas: false,
    })),
    { id: "all", rotulo: "Todas as lojas", detalhe: `Pedidos, Início e relatórios das ${n} lojas juntos`, todas: true },
  ];

  return (
    <div className="ep">
      <style>{ESTILO_DA_ESCOLHA + ESTILO}</style>
      <h1 className="ep-titulo">Qual loja você quer abrir?</h1>
      <p className="ep-sub">Você tem {n} lojas neste acesso.</p>

      <div className="ep-opcoes">
        {opcoes.map((o) => (
          <div key={o.id} className="ep-opcao">
            <button type="button" className="ep-botao" onClick={() => abrir(o.id)} disabled={abrindo !== null}>
              <span className={`ep-icone ${o.todas ? "todas" : "loja"}`}>
                {o.todas ? <LayoutGrid size={20} aria-hidden /> : <Store size={20} aria-hidden />}
              </span>
              <span className="ep-textos">
                <b>
                  {abrindo === o.id ? "Abrindo..." : o.rotulo}
                  {ultima === o.id && abrindo !== o.id && <span className="el-ultima">Última usada</span>}
                </b>
                <small>{o.detalhe}</small>
              </span>
              <ArrowRight size={18} className="ep-seta" aria-hidden />
            </button>
          </div>
        ))}
      </div>

      {erro && <p className="el-erro" role="alert">{erro}</p>}
      <p className="ep-dica">Depois dá para trocar em “Suas Lojas”, no topo do painel, sem sair.</p>
      <button type="button" className="ep-outra" onClick={aoEntrarComOutraConta} disabled={abrindo !== null}>
        Entrar com outra conta
      </button>
    </div>
  );
}

const ESTILO = `
.ep-icone.todas { background: #F1F5F9; color: #334155; }
.el-ultima { margin-left: 8px; padding: 1px 7px; border-radius: 6px; background: #F1F5F9; color: #475569; font-size: 0.66rem; font-weight: 700; vertical-align: 2px; white-space: nowrap; }
.el-erro { margin-top: 12px; text-align: center; font-size: 0.82rem; font-weight: 600; color: #B91C1C; }
`;
