/**
 * Busca da central de tutoriais: "aplicativo do motoboy" → o vídeo de
 * Motoboys, no capítulo em que a voz fala do aplicativo.
 *
 * Procura no título do vídeo, no título de cada capítulo e no que a voz diz
 * (tutoriais-busca.json, gerado por tutoriais/indexar-busca.mjs). Quem procura
 * escreve do próprio jeito, então:
 * - sem acento e sem maiúscula ("garcom" acha "Garçons");
 * - palavra começando igual vale ("motoboy" acha "motoboys");
 * - palavras de ligação não contam ("como", "do", "de"...);
 * - sinônimos do dia a dia de loja (app = aplicativo, entregador = motoboy...).
 *
 * Toda palavra que conta tem que aparecer em algum lugar do vídeo; o capítulo
 * entra na lista quando tem pelo menos uma delas.
 */
import type { Tutorial } from "./tutoriais";

export type IndiceDaBusca = Record<string, { em: number; texto: string }[]>;

export type ResultadoDaBusca = {
  tutorial: Tutorial;
  capitulos: { em: number; titulo: string }[];
};

const LIGACAO = new Set(
  "a o as os de da do das dos e em no na nos nas um uma uns umas para pra pro com como que qual onde quando por pelo pela se eu meu minha sua seu ao aos tem ter fazer faz usar uso ver".split(" "),
);

const SINONIMOS: string[][] = [
  ["app", "aplicativo", "aplicativos", "apps", "celular"],
  ["motoboy", "motoboys", "entregador", "entregadores", "motoqueiro", "motoqueiros", "moto"],
  ["nota", "notas", "nfce", "nfc", "fiscal", "cupom"],
  ["garcom", "garcons", "atendente"],
  ["cardapio", "menu", "produto", "produtos", "item", "itens"],
  ["promocao", "promocional", "promocoes", "desconto", "oferta"],
  ["impressora", "impressoras", "imprimir", "impressao", "comanda"],
  ["entrega", "frete", "taxa"],
  ["robo", "chatbot", "whatsapp", "zap", "bot"],
  ["cozinha", "kds"],
  ["balcao", "pdv"],
  ["ifood", "99food", "integracao", "integracoes", "marketplace"],
  ["senha", "login", "acesso"],
  ["pix", "cartao", "dinheiro", "pagamento", "pagamentos"],
  ["horario", "horarios", "funcionamento", "expediente"],
  ["rota", "rotas", "roteirizacao", "mapa"],
];
const GRUPO = new Map<string, string[]>();
for (const g of SINONIMOS) for (const p of g) GRUPO.set(p, g);

export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A palavra (já normalizada) e os sinônimos dela — o robô do atendimento usa a mesma régua (lib/atendimento/videos.ts). */
export function formasDaPalavra(palavra: string): string[] {
  return GRUPO.get(palavra) || [palavra];
}

export function ehPalavraDeLigacao(palavra: string): boolean {
  return LIGACAO.has(palavra);
}

function palavrasDaBusca(busca: string): string[][] {
  return normalizar(busca)
    .split(" ")
    .filter((p) => p.length >= 2 && !LIGACAO.has(p))
    .map((p) => GRUPO.get(p) || [p]);
}

/** Alguma palavra do texto começa com alguma das formas? */
function aparece(palavrasDoTexto: string[], formas: string[]): boolean {
  return palavrasDoTexto.some((w) => formas.some((f) => w.startsWith(f)));
}

export function buscarNosTutoriais(busca: string, tutoriais: Tutorial[], indice: IndiceDaBusca): ResultadoDaBusca[] {
  const termos = palavrasDaBusca(busca);
  if (!termos.length) return [];
  const resultados: (ResultadoDaBusca & { pontos: number })[] = [];
  for (const t of tutoriais) {
    const titulo = normalizar(t.titulo).split(" ");
    const caps = t.capitulos.map((c, i) => ({
      em: c.em,
      titulo: c.titulo,
      doTitulo: normalizar(c.titulo).split(" "),
      daFala: normalizar(indice[t.id]?.[i]?.texto || "").split(" "),
    }));
    let pontos = 0;
    let todos = true;
    for (const formas of termos) {
      const peso = aparece(titulo, formas) ? 3
        : caps.some((c) => aparece(c.doTitulo, formas)) ? 2
        : caps.some((c) => aparece(c.daFala, formas)) ? 1 : 0;
      if (!peso) { todos = false; break; }
      pontos += peso;
    }
    if (!todos) continue;
    const capitulos = caps
      .map((c) => ({
        c,
        acertos: termos.filter((f) => aparece(c.doTitulo, f)).length * 2 + termos.filter((f) => aparece(c.daFala, f)).length,
      }))
      .filter((x) => x.acertos > 0)
      .sort((a, b) => b.acertos - a.acertos || a.c.em - b.c.em)
      .slice(0, 3)
      .map((x) => ({ em: x.c.em, titulo: x.c.titulo }));
    resultados.push({ tutorial: t, capitulos, pontos: pontos + (capitulos.length ? 0.5 : 0) });
  }
  return resultados.sort((a, b) => b.pontos - a.pontos).map(({ tutorial, capitulos }) => ({ tutorial, capitulos }));
}
