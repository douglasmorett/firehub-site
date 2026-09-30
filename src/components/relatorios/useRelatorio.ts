"use client";
/**
 * Os ganchos que toda tela de relatório usa: buscar os números da rota do
 * relatório quando o filtro muda, e as opções dos filtros uma vez só.
 *
 * O filtro também vai para a URL (?de=…&ate=…): recarregar a página ou mandar
 * o link para o sócio abre o MESMO relatório. Na Saipos, recarregar perde tudo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  filtrosParaQuery, lerFiltros, periodoDoAtalho, type AtalhoDePeriodo, type FiltrosDoRelatorio,
} from "@/lib/relatorios/base";

export type OpcoesDosFiltros = {
  hoje: string;
  lojas: string[];
  lojasDaConta: { id: string; nome: string }[];
  tipos: { chave: string; rotulo: string }[];
  canais: { chave: string; rotulo: string }[];
  marcas: { chave: string; rotulo: string }[];
  categorias: string[];
  produtos: { id: string; nome: string; categoria: string }[];
};

/** As opções dos filtros (categorias, produtos, canais, marcas, lojas). */
export function useOpcoesDosFiltros() {
  const [opcoes, setOpcoes] = useState<OpcoesDosFiltros | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/store/relatorios/opcoes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j) setOpcoes(j); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return opcoes;
}

/**
 * De onde a tela começa: a query da URL e o "hoje" da loja, decididos NO
 * SERVIDOR (lib/relatorios/pagina.ts). Servidor e navegador desenham a partir
 * do mesmo ponto — ler window.location aqui dava erro de hidratação.
 */
export type InicioDosFiltros = { query: string; hoje: string };

/**
 * O estado dos filtros, começando pela URL (ou pelo atalho padrão) e voltando
 * para a URL a cada mudança. `extras` são os parâmetros do relatório (os
 * agrupamentos do Itens vendidos, por exemplo).
 */
export function useFiltros(inicio: InicioDosFiltros, padrao: AtalhoDePeriodo = "7d", extrasPadrao: Record<string, string> = {}) {
  const [filtros, setFiltros] = useState<FiltrosDoRelatorio>(() => {
    const sp = new URLSearchParams(inicio.query);
    if (!sp.get("de")) {
      const p = periodoDoAtalho(padrao, inicio.hoje);
      sp.set("de", p.de);
      sp.set("ate", p.ate);
    }
    return lerFiltros(sp, inicio.hoje);
  });
  const [extras, setExtras] = useState<Record<string, string>>(() => {
    const sp = new URLSearchParams(inicio.query);
    const e: Record<string, string> = { ...extrasPadrao };
    for (const k of Object.keys(extrasPadrao)) { const v = sp.get(k); if (v !== null) e[k] = v; }
    return e;
  });

  const query = filtrosParaQuery(filtros, extras);
  useEffect(() => {
    try { window.history.replaceState(null, "", `${window.location.pathname}?${query}`); } catch {}
  }, [query]);

  const mudar = useCallback((parcial: Partial<FiltrosDoRelatorio>) => setFiltros((f) => ({ ...f, ...parcial })), []);
  const mudarExtra = useCallback((k: string, v: string) => setExtras((e) => ({ ...e, [k]: v })), []);
  return { filtros, mudar, extras, mudarExtra, query };
}

/** Busca o relatório na rota dele sempre que a query muda (com um respiro de 250 ms). */
export function useRelatorio<T>(slug: string, query: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const controle = useRef<AbortController | null>(null);

  useEffect(() => {
    const espera = setTimeout(() => {
      controle.current?.abort();
      const c = new AbortController();
      controle.current = c;
      setCarregando(true);
      setErro(null);
      fetch(`/api/store/relatorios/${slug}?${query}`, { cache: "no-store", signal: c.signal })
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
          return j as T;
        })
        .then((j) => { setDados(j); setCarregando(false); })
        .catch((e) => {
          if (e?.name === "AbortError") return;
          setErro(e?.message || "Não foi possível carregar o relatório.");
          setCarregando(false);
        });
    }, 250);
    return () => clearTimeout(espera);
  }, [slug, query, versao]);

  return { dados, carregando, erro, recarregar: () => setVersao((v) => v + 1) };
}
