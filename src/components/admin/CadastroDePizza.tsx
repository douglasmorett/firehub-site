"use client";

/**
 * "Novo Item" → O QUE VOCÊ VAI CADASTRAR? → Pizza ou outro item.
 *
 * Pedido do Douglas (02/10/2026): o lojista não conseguia cadastrar pizza meio
 * a meio e o suporte vivia disso. "São três dinâmicas diferentes para cadastro
 * do item": a PIZZA tem um passo a passo próprio (este arquivo), o ITEM comum
 * vai para o formulário de sempre, e o COMBO só pelo botão Novo Combo — nada de
 * "mudar para combo" dentro do item. "Qualquer criança de 10 anos tem que
 * conseguir lançar isso aqui."
 *
 * O passo a passo faz uma pergunta por tela, do jeito que a pizzaria pensa:
 * tamanhos → fatias e sabores de cada um → como cobra o meio a meio → sabores e
 * o preço da pizza inteira → borda → conferir. Quem grava é
 * /api/admin/cardapio/pizzas; o modelo e as regras estão em
 * lib/pizza-por-tamanho.ts. A mesma tela edita o que ela montou ("adicionar
 * sabor, mudar preço"), sem refazer nada.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Trash2, X } from "lucide-react";
import {
  MAX_SABORES, TAMANHOS_SUGERIDOS, descricaoDoTamanho, errosDaMontagem, lerPreco, nomeDoTamanho,
  precoDoMeio, precoInicialDoTamanho, reais, type MontagemDaPizza, type RegraDaPizza,
} from "@/lib/pizza-por-tamanho";

export type PizzaJaMontada = MontagemDaPizza & { ativos: boolean[] };

const ESTILO = `
.fh-pz-fundo{position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}
.fh-pz-janela{background:#fff;border-radius:22px;width:min(880px,100%);max-height:100%;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,.45);color:#0F172A;overflow:hidden}
.fh-pz-janela.estreita{width:min(720px,100%)}
.fh-pz-topo{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;border-bottom:1px solid #F1F5F9}
.fh-pz-topo h2{margin:0;font-size:1.12rem;font-weight:800;flex:1;min-width:0}
.fh-pz-fechar{flex:none;width:36px;height:36px;border-radius:50%;border:0;background:#F1F5F9;color:#64748B;display:flex;align-items:center;justify-content:center;cursor:pointer}
.fh-pz-passos{display:flex;gap:6px;padding:12px 20px 0}
.fh-pz-passo{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px;border:0;background:none;padding:0;text-align:left;font-family:inherit;cursor:default}
.fh-pz-passo i{display:block;height:5px;border-radius:99px;background:#E2E8F0}
.fh-pz-passo.feito i,.fh-pz-passo.agora i{background:#E8360C}
.fh-pz-passo span{font-size:.68rem;font-weight:800;color:#94A3B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-pz-passo.agora span{color:#C92E09}
.fh-pz-passo.clicavel{cursor:pointer}
.fh-pz-passo.clicavel:hover span{color:#C92E09}
.fh-pz-corpo{padding:18px 20px 12px;overflow-y:auto;flex:1;min-height:0}
.fh-pz-num{display:inline-block;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#C2410C;margin-bottom:4px}
.fh-pz-pergunta{font-size:1.35rem;font-weight:800;margin:0 0 6px;letter-spacing:-.3px;line-height:1.25}
.fh-pz-ajuda{font-size:.92rem;color:#475569;margin:0 0 16px;line-height:1.5}
.fh-pz-rodape{display:flex;align-items:center;gap:10px;padding:12px 20px 16px;border-top:1px solid #F1F5F9;background:#fff;flex-wrap:wrap}
.fh-pz-aviso{flex:1;min-width:180px;font-size:.84rem;font-weight:700;color:#B45309;line-height:1.35}
.fh-pz-aviso.erro{color:#C92E09}
.fh-pz-btn{height:46px;padding:0 18px;border-radius:12px;font-weight:800;font-size:.95rem;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1.5px solid #CBD5E1;background:#fff;color:#334155}
.fh-pz-btn:hover{background:#F8FAFC}
.fh-pz-btn.sim{background:#E8360C;border-color:#E8360C;color:#fff}
.fh-pz-btn.sim:hover{background:#C92E09}
.fh-pz-btn.sim:disabled{background:#F4B9A8;border-color:#F4B9A8;cursor:not-allowed}
.fh-pz-btn.direita{margin-left:auto}
.fh-pz-tipos{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fh-pz-tipo{display:flex;flex-direction:column;gap:6px;text-align:left;padding:18px;border-radius:16px;border:2px solid #E2E8F0;background:#fff;cursor:pointer;font-family:inherit;color:#0F172A}
.fh-pz-tipo:hover{border-color:#E8360C;background:#FFF8F5}
.fh-pz-tipo .emoji{font-size:2.2rem;line-height:1}
.fh-pz-tipo b{font-size:1.15rem;font-weight:800}
.fh-pz-tipo span{font-size:.86rem;color:#475569;line-height:1.45}
.fh-pz-tipo em{font-style:normal;font-size:.8rem;font-weight:800;color:#C92E09;margin-top:auto;padding-top:6px}
.fh-pz-combo{display:flex;gap:10px;margin-top:14px;padding:12px 14px;border-radius:14px;background:#F0FDFA;border:1.5px solid #99F6E4;font-size:.84rem;color:#134E4A;line-height:1.5}
.fh-pz-combo b{color:#0F766E}
.fh-pz-tamanhos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.fh-pz-chip{position:relative;text-align:left;padding:14px 14px 12px;border-radius:14px;border:2px solid #E2E8F0;background:#fff;cursor:pointer;font-family:inherit;color:#0F172A;min-height:74px}
.fh-pz-chip:hover{border-color:#F0A584}
.fh-pz-chip b{display:block;font-size:1.05rem;font-weight:800;padding-right:26px}
.fh-pz-chip small{display:block;color:#64748B;font-size:.78rem;margin-top:3px}
.fh-pz-chip[aria-pressed="true"]{border-color:#E8360C;background:#FFF5F1}
.fh-pz-marca{position:absolute;top:12px;right:12px;width:22px;height:22px;border-radius:50%;border:2px solid #CBD5E1;display:flex;align-items:center;justify-content:center;color:#fff;background:#fff}
.fh-pz-chip[aria-pressed="true"] .fh-pz-marca{background:#E8360C;border-color:#E8360C}
.fh-pz-outro{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.fh-pz-campo{height:42px;padding:0 12px;border-radius:10px;border:1.5px solid #CBD5E1;font-size:.95rem;font-family:inherit;color:#0F172A;background:#fff;min-width:0;box-sizing:border-box}
.fh-pz-campo:focus{outline:none;border-color:#E8360C;box-shadow:0 0 0 3px rgba(232,54,12,.15)}
.fh-pz-campo.ruim{border-color:#DC2626;background:#FEF2F2}
.fh-pz-cartoes{display:flex;flex-direction:column;gap:10px}
.fh-pz-cartao{border:1.5px solid #E2E8F0;border-radius:14px;padding:14px;background:#fff}
.fh-pz-cartao h3{margin:0 0 10px;font-size:1.02rem;font-weight:800}
.fh-pz-linha{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;margin-top:8px}
.fh-pz-linha > span{font-size:.88rem;font-weight:700;color:#334155;min-width:200px}
.fh-pz-passos-num{display:inline-flex;align-items:center;border:1.5px solid #CBD5E1;border-radius:10px;overflow:hidden}
.fh-pz-passos-num button{width:38px;height:38px;border:0;background:#F8FAFC;cursor:pointer;color:#0F172A;display:flex;align-items:center;justify-content:center}
.fh-pz-passos-num button:disabled{color:#CBD5E1;cursor:default}
.fh-pz-passos-num b{min-width:44px;text-align:center;font-size:1rem}
.fh-pz-segmento{display:inline-flex;gap:6px;flex-wrap:wrap}
.fh-pz-segmento button{height:38px;padding:0 14px;border-radius:10px;border:1.5px solid #CBD5E1;background:#fff;font-weight:800;font-size:.88rem;cursor:pointer;font-family:inherit;color:#334155}
.fh-pz-segmento button[aria-pressed="true"]{background:#E8360C;border-color:#E8360C;color:#fff}
.fh-pz-nota{font-size:.82rem;color:#64748B;margin:12px 0 0;line-height:1.5}
.fh-pz-exemplo{padding:12px 14px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:.9rem;color:#334155;line-height:1.5;margin-bottom:14px}
.fh-pz-regras{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fh-pz-regra{text-align:left;padding:16px;border-radius:16px;border:2px solid #E2E8F0;background:#fff;cursor:pointer;font-family:inherit;color:#0F172A;display:flex;flex-direction:column;gap:6px;position:relative}
.fh-pz-regra:hover{border-color:#F0A584}
.fh-pz-regra[aria-pressed="true"]{border-color:#E8360C;background:#FFF5F1}
.fh-pz-regra b{font-size:1.05rem;font-weight:800;padding-right:26px}
.fh-pz-regra .valor{font-size:1.5rem;font-weight:900;color:#C92E09}
.fh-pz-regra span{font-size:.84rem;color:#475569;line-height:1.45}
.fh-pz-regra .selo{align-self:flex-start;font-size:.68rem;font-weight:800;color:#0F766E;background:#CCFBF1;padding:2px 8px;border-radius:99px}
.fh-pz-tabela{display:flex;flex-direction:column;gap:8px}
.fh-pz-cab,.fh-pz-grade{display:grid;grid-template-columns:minmax(150px,1fr) repeat(var(--n),92px) 38px;gap:8px;align-items:center}
.fh-pz-cab{font-size:.72rem;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:.04em;padding:0 11px}
.fh-pz-cab span:not(:first-child){text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-pz-sabor{position:relative;border:1.5px solid #E2E8F0;border-radius:12px;padding:9px 10px;background:#fff}
.fh-pz-sabor .fh-pz-campo{width:100%}
.fh-pz-ingredientes{margin-top:7px;height:36px;font-size:.86rem;color:#475569}
.fh-pz-celula{display:block;min-width:0}
.fh-pz-reais{position:relative;display:block}
.fh-pz-reais em{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-style:normal;font-size:.74rem;color:#94A3B8;font-weight:700;pointer-events:none}
.fh-pz-reais .fh-pz-campo{padding:0 9px 0 30px;text-align:right;width:100%}
.fh-pz-rotulo{display:none;font-size:.7rem;font-weight:800;color:#64748B;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh-pz-lixo{width:38px;height:38px;border-radius:10px;border:1px solid #FECACA;background:#FEF2F2;color:#C92E09;cursor:pointer;display:flex;align-items:center;justify-content:center}
.fh-pz-mais{margin-top:10px;width:100%;height:46px;border-radius:12px;border:2px dashed #E8360C;background:#FFF8F5;color:#C92E09;font-weight:800;font-size:.95rem;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px}
.fh-pz-simnao{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
.fh-pz-vitrine{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.fh-pz-item{border:1.5px solid #E2E8F0;border-radius:14px;padding:12px 14px;background:#fff}
.fh-pz-item b{display:block;font-size:1rem;font-weight:800}
.fh-pz-item small{display:block;font-size:.8rem;color:#64748B;margin-top:2px}
.fh-pz-item strong{display:block;margin-top:8px;font-size:.92rem;color:#0F766E}
.fh-pz-item.pausada{opacity:.6}
.fh-pz-secao{margin-bottom:18px}
.fh-pz-secao h3{margin:0 0 8px;font-size:.78rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748B}
.fh-pz-resumo{display:flex;flex-direction:column;gap:6px;font-size:.92rem;color:#334155;line-height:1.5}
.fh-pz-pronto{text-align:center;padding:24px 8px}
.fh-pz-pronto .ok{width:64px;height:64px;border-radius:50%;background:#16A34A;color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.fh-pz-existente{display:flex;align-items:center;gap:14px;flex-wrap:wrap;border:1.5px solid #E2E8F0;border-radius:14px;padding:14px;margin-bottom:10px}
.fh-pz-existente div{flex:1;min-width:200px}
.fh-pz-existente b{display:block;font-size:1rem}
.fh-pz-existente small{display:block;color:#64748B;font-size:.82rem;margin-top:2px;line-height:1.4}
@media (max-width:640px){
  .fh-pz-fundo{padding:8px}
  .fh-pz-topo{padding:12px 14px 10px}
  .fh-pz-passos{padding:10px 14px 0;gap:4px}
  .fh-pz-passo span{display:none}
  .fh-pz-corpo{padding:14px 14px 10px}
  .fh-pz-pergunta{font-size:1.15rem}
  .fh-pz-rodape{padding:10px 14px 12px}
  .fh-pz-tipos,.fh-pz-regras{grid-template-columns:1fr}
  .fh-pz-cab{display:none}
  .fh-pz-grade{grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}
  .fh-pz-grade .fh-pz-nome{grid-column:1/-1;padding-right:46px}
  .fh-pz-grade .fh-pz-lixo{position:absolute;top:9px;right:10px}
  .fh-pz-rotulo{display:block}
  .fh-pz-linha > span{min-width:0;width:100%}
  .fh-pz-btn{height:44px;padding:0 14px}
}
`;

/** Janela de fundo escuro, com Esc para fechar. */
function Janela({ titulo, estreita, onFechar, children }: { titulo: string; estreita?: boolean; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);
  return (
    <div className="fh-pz-fundo">
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      <div className={estreita ? "fh-pz-janela estreita" : "fh-pz-janela"} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="fh-pz-topo">
          <h2>{titulo}</h2>
          <button type="button" className="fh-pz-fechar" onClick={onFechar} aria-label="Fechar"><X size={19} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── 1. A PERGUNTA DO NOVO ITEM ────────────────────────────────────────────
export function EscolhaDoNovoItem({ temPizzas, onPizza, onItem, onFechar }: {
  temPizzas: boolean;
  onPizza: () => void;
  onItem: () => void;
  onFechar: () => void;
}) {
  return (
    <Janela titulo="Novo item" estreita onFechar={onFechar}>
      <div className="fh-pz-corpo">
        <h3 className="fh-pz-pergunta">O que você vai cadastrar?</h3>
        <p className="fh-pz-ajuda">Escolha uma opção. Cada uma tem o seu jeito de cadastrar.</p>
        <div className="fh-pz-tipos">
          <button type="button" className="fh-pz-tipo" onClick={onPizza}>
            <span className="emoji" aria-hidden="true">🍕</span>
            <b>Pizza</b>
            <span>Tem tamanhos (broto, média, grande…) e o cliente pode escolher mais de um sabor: o meio a meio.</span>
            <span>Você responde algumas perguntas e o sistema monta tudo.</span>
            <em>{temPizzas ? "Também para adicionar sabor ou mudar preço →" : "Cadastrar pizza →"}</em>
          </button>
          <button type="button" className="fh-pz-tipo" onClick={onItem}>
            <span className="emoji" aria-hidden="true">🍔</span>
            <b>Outro item</b>
            <span>Lanche, porção, bebida, prato, açaí, sobremesa… Tem nome, foto, descrição e preço.</span>
            <span>Se precisar, pode ter perguntas como tamanho, sabor ou adicionais.</span>
            <em>Cadastrar item →</em>
          </button>
        </div>
        <div className="fh-pz-combo">
          <span aria-hidden="true">📦</span>
          <span>
            <b>Quer vender itens juntos</b>, como lanche + batata + refrigerante? Isso é um <b>combo</b>: feche esta
            janela e use o botão <b>Novo Combo</b>. O combo é montado com itens que já estão no cardápio. Assim, quando
            um item acaba e você o pausa, o sistema oferece pausar também os combos que levam ele.
          </span>
        </div>
      </div>
      <div className="fh-pz-rodape">
        <button type="button" className="fh-pz-btn direita" onClick={onFechar}>Cancelar</button>
      </div>
    </Janela>
  );
}

// ─── 2. O PASSO A PASSO DA PIZZA ───────────────────────────────────────────
type TamanhoNaTela = { chave: string; id: string | null; nome: string; fatias: number | null; sabores: number; marcado: boolean; ativo: boolean };
type LinhaNaTela = { chave: string; id: string | null; nome: string; descricao: string; precos: Record<string, string> };

const PASSOS = [
  { id: "tamanhos", titulo: "Tamanhos" },
  { id: "detalhes", titulo: "Fatias e sabores" },
  { id: "regra", titulo: "Meio a meio" },
  { id: "sabores", titulo: "Sabores e preços" },
  { id: "borda", titulo: "Borda" },
  { id: "conferir", titulo: "Conferir" },
] as const;
type IdDoPasso = (typeof PASSOS)[number]["id"];
type Tela = IdDoPasso | "inicio" | "pronto";

const NOVA_CATEGORIA = "__nova__";
const chaveDoNome = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
let contador = 0;
const novaChave = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${(contador++).toString(36)}`;
const textoDoPreco = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));
const linhaVazia = (prefixo: string): LinhaNaTela => ({ chave: novaChave(prefixo), id: null, nome: "", descricao: "", precos: {} });

function telaInicial(m: PizzaJaMontada | null) {
  const tamanhos: TamanhoNaTela[] = TAMANHOS_SUGERIDOS.map((s) => ({
    chave: `s:${chaveDoNome(s.nome)}`, id: null, nome: s.nome, fatias: s.fatias, sabores: s.sabores, marcado: false, ativo: true,
  }));
  const chaveDoTamanho: string[] = [];
  m?.tamanhos.forEach((t, i) => {
    const linha: TamanhoNaTela = { chave: `p:${t.id}`, id: t.id || null, nome: t.nome, fatias: t.fatias, sabores: t.sabores, marcado: true, ativo: m.ativos[i] !== false };
    const k = tamanhos.findIndex((x) => !x.id && chaveDoNome(x.nome) === chaveDoNome(t.nome));
    if (k >= 0) tamanhos[k] = linha;
    else tamanhos.push(linha);
    chaveDoTamanho.push(linha.chave);
  });
  const linhas = (lista: { id?: string | null; nome: string; descricao?: string; precos: (number | null)[] }[], prefixo: string): LinhaNaTela[] =>
    lista.map((s) => ({
      chave: s.id ? `p:${s.id}` : novaChave(prefixo),
      id: s.id || null,
      nome: s.nome,
      descricao: s.descricao || "",
      precos: Object.fromEntries(s.precos.map((p, i) => [chaveDoTamanho[i], textoDoPreco(p)])),
    }));
  return {
    tamanhos,
    sabores: m ? [...linhas(m.sabores, "sabor"), linhaVazia("sabor")] : [linhaVazia("sabor"), linhaVazia("sabor"), linhaVazia("sabor")],
    bordas: m && m.bordas.length ? linhas(m.bordas, "borda") : [linhaVazia("borda")],
    temBorda: m ? m.bordas.length > 0 : null,
    regra: m ? m.regra : null,
  };
}

export default function CadastroDePizza({
  categorias, categoriaInicial, existentes, editar, onFechar, onSalvo, criarCategoria,
}: {
  categorias: { name: string; emoji?: string }[];
  /** A categoria do "+ Criar item" que abriu a pergunta. */
  categoriaInicial?: string;
  /** Pizzas que já existem neste modelo (lib/pizza-por-tamanho, pizzasJaMontadas). */
  existentes: PizzaJaMontada[];
  /** Abre direto na edição desta montagem (vindo do lápis de uma pizza). */
  editar?: PizzaJaMontada | null;
  onFechar: () => void;
  /** Gravou: o painel recarrega a lista (a janela fica aberta no "Pronto"). */
  onSalvo: () => void;
  /** Cria a categoria pela rota de sempre e devolve o nome gravado (null = falhou). */
  criarCategoria: (nome: string) => Promise<string | null>;
}) {
  const [montagem, setMontagem] = useState<PizzaJaMontada | null>(editar || null);
  const editando = !!montagem;
  const inicial = useMemo(() => telaInicial(editar || null), [editar]);
  const [tamanhos, setTamanhos] = useState<TamanhoNaTela[]>(inicial.tamanhos);
  const [sabores, setSabores] = useState<LinhaNaTela[]>(inicial.sabores);
  const [bordas, setBordas] = useState<LinhaNaTela[]>(inicial.bordas);
  const [temBorda, setTemBorda] = useState<boolean | null>(inicial.temBorda);
  const [regra, setRegra] = useState<RegraDaPizza | null>(inicial.regra);
  const [tela, setTela] = useState<Tela>(editar ? "sabores" : existentes.length ? "inicio" : "tamanhos");
  const [outroTamanho, setOutroTamanho] = useState("");
  const [tentouAvancar, setTentouAvancar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);
  const focarNome = useRef<string | null>(null);

  const categoriaPadrao = () => {
    const pizza = (n?: string) => !!n && /pizz/i.test(n);
    if (pizza(categoriaInicial)) return categoriaInicial!;
    return categorias.find((c) => pizza(c.name))?.name || NOVA_CATEGORIA;
  };
  const [categoria, setCategoria] = useState<string>(editar?.categoria || categoriaPadrao());
  const [novaCategoria, setNovaCategoria] = useState("Pizzas");

  const editarExistente = (m: PizzaJaMontada) => {
    const t = telaInicial(m);
    setMontagem(m);
    setTamanhos(t.tamanhos); setSabores(t.sabores); setBordas(t.bordas); setTemBorda(t.temBorda); setRegra(t.regra);
    setCategoria(m.categoria);
    setTela("sabores");
  };

  const marcados = tamanhos.filter((t) => t.marcado);
  const precisaDeRegra = marcados.some((t) => t.sabores >= 2);
  const passos = PASSOS.filter((p) => p.id !== "regra" || precisaDeRegra);
  const indiceDoPasso = passos.findIndex((p) => p.id === tela);

  // Cada passo novo começa do alto.
  useEffect(() => { corpoRef.current?.scrollTo({ top: 0 }); setTentouAvancar(false); }, [tela]);
  // "Adicionar sabor" leva o cursor direto para o nome do sabor novo.
  useEffect(() => {
    if (!focarNome.current) return;
    const campo = document.querySelector<HTMLInputElement>(`[data-nome="${focarNome.current}"]`);
    focarNome.current = null;
    campo?.focus();
  });

  const precoDe = (linha: LinhaNaTela, t: TamanhoNaTela) => lerPreco(linha.precos[t.chave]);
  const textoRuim = (txt: string | undefined, podeZero: boolean) => {
    const s = (txt || "").trim();
    if (!s) return false;
    const n = lerPreco(s);
    return n === null || (!podeZero && n <= 0);
  };

  const montagemAtual = (nomeDaCategoria: string): MontagemDaPizza => ({
    categoria: nomeDaCategoria,
    regra: regra || "MAIOR",
    tamanhos: marcados.map((t) => ({ id: t.id, nome: t.nome.trim(), fatias: t.fatias, sabores: t.sabores })),
    sabores: sabores.filter((s) => s.nome.trim()).map((s) => ({
      id: s.id, nome: s.nome.trim(), descricao: s.descricao.trim(),
      precos: marcados.map((t) => { const p = precoDe(s, t); return p !== null && p > 0 ? p : null; }),
    })),
    bordas: temBorda ? bordas.filter((b) => b.nome.trim()).map((b) => ({
      id: b.id, nome: b.nome.trim(),
      precos: marcados.map((t) => precoDe(b, t)),
    })) : [],
  });

  const problemaDoPasso = (p: Tela): string | null => {
    if (p === "tamanhos") return marcados.length ? null : "Toque em pelo menos um tamanho.";
    if (p === "regra") return precisaDeRegra && !regra ? "Escolha uma das duas formas de cobrar." : null;
    if (p === "sabores") {
      const comNome = sabores.filter((s) => s.nome.trim());
      if (sabores.some((s) => !s.nome.trim() && marcados.some((t) => (s.precos[t.chave] || "").trim()))) return "Tem preço digitado sem o nome do sabor.";
      if (!comNome.length) return "Escreva o nome de pelo menos um sabor e o preço dele.";
      const vistos = new Set<string>();
      for (const s of comNome) {
        if (vistos.has(chaveDoNome(s.nome))) return `O sabor "${s.nome.trim()}" está repetido.`;
        vistos.add(chaveDoNome(s.nome));
        const ruim = marcados.find((t) => textoRuim(s.precos[t.chave], false));
        if (ruim) return `Confira o preço de ${s.nome.trim()} na ${ruim.nome}: tem que ser um valor maior que zero, como 45,90.`;
        if (!marcados.some((t) => (precoDe(s, t) || 0) > 0)) return `Digite o preço de ${s.nome.trim()} em pelo menos um tamanho.`;
      }
      const vazio = marcados.find((t) => !comNome.some((s) => (precoDe(s, t) || 0) > 0));
      if (vazio) return `Nenhum sabor tem preço na pizza ${vazio.nome}. Digite pelo menos um, ou volte e desmarque esse tamanho.`;
      return null;
    }
    if (p === "borda") {
      if (temBorda === null) return "Responda: tem ou não tem borda recheada?";
      if (!temBorda) return null;
      const comNome = bordas.filter((b) => b.nome.trim());
      if (bordas.some((b) => !b.nome.trim() && marcados.some((t) => (b.precos[t.chave] || "").trim()))) return "Tem preço digitado sem o nome da borda.";
      if (!comNome.length) return "Escreva o nome de pelo menos uma borda, ou volte e marque que não tem.";
      const vistas = new Set<string>();
      for (const b of comNome) {
        if (vistas.has(chaveDoNome(b.nome))) return `A borda "${b.nome.trim()}" está repetida.`;
        vistas.add(chaveDoNome(b.nome));
        const ruim = marcados.find((t) => textoRuim(b.precos[t.chave], true));
        if (ruim) return `Confira o preço da borda ${b.nome.trim()} na ${ruim.nome}.`;
        if (!marcados.some((t) => precoDe(b, t) !== null)) return `Digite quanto a borda ${b.nome.trim()} soma em pelo menos um tamanho (0 se for grátis).`;
      }
      return null;
    }
    if (p === "conferir") {
      if (categoria === NOVA_CATEGORIA && !novaCategoria.trim()) return "Escreva o nome da categoria nova.";
      return errosDaMontagem(montagemAtual(categoria === NOVA_CATEGORIA ? novaCategoria : categoria))[0] || null;
    }
    return null;
  };

  const problema = problemaDoPasso(tela);
  const avancar = () => {
    if (problema) { setTentouAvancar(true); return; }
    const proximo = passos[indiceDoPasso + 1];
    if (proximo) setTela(proximo.id);
  };
  const voltar = () => {
    const anterior = passos[indiceDoPasso - 1];
    if (anterior) setTela(anterior.id);
    else if (existentes.length && !editar) { setMontagem(null); setTela("inicio"); }
  };
  // Na edição, dá para pular direto a qualquer passo pela barra do alto.
  const podePular = editando;

  const salvar = async () => {
    if (problema) { setTentouAvancar(true); return; }
    setSalvando(true);
    setErroAoSalvar(null);
    try {
      let nomeDaCategoria = categoria;
      if (categoria === NOVA_CATEGORIA) {
        const criada = await criarCategoria(novaCategoria.trim());
        if (!criada) { setErroAoSalvar("Não deu para criar a categoria. Tente de novo."); return; }
        nomeDaCategoria = criada;
        setCategoria(criada);
      }
      const pausar = tamanhos.filter((t) => t.id && !t.marcado).map((t) => t.id);
      const r = await fetch("/api/admin/cardapio/pizzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ montagem: montagemAtual(nomeDaCategoria), pausar }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErroAoSalvar(j?.error || "Não deu para salvar. Tente de novo."); return; }
      setTela("pronto");
      onSalvo();
    } catch {
      setErroAoSalvar("Sem conexão com o servidor. Confira a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  // ── edição das linhas ────────────────────────────────────────────────────
  const mudarTamanho = (chave: string, mudanca: Partial<TamanhoNaTela>) =>
    setTamanhos((lista) => lista.map((t) => (t.chave === chave ? { ...t, ...mudanca } : t)));
  const adicionarTamanho = () => {
    const nome = outroTamanho.trim();
    if (!nome) return;
    const igual = tamanhos.find((t) => chaveDoNome(t.nome) === chaveDoNome(nome));
    if (igual) mudarTamanho(igual.chave, { marcado: true });
    else setTamanhos((lista) => [...lista, { chave: novaChave("t"), id: null, nome, fatias: 8, sabores: 2, marcado: true, ativo: true }]);
    setOutroTamanho("");
  };
  const mudarLinha = (set: typeof setSabores, chave: string, mudanca: Partial<LinhaNaTela>) =>
    set((lista) => lista.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));
  const mudarPreco = (set: typeof setSabores, chave: string, tamanho: string, valor: string) =>
    set((lista) => lista.map((l) => (l.chave === chave ? { ...l, precos: { ...l.precos, [tamanho]: valor } } : l)));
  const arrumarPreco = (set: typeof setSabores, chave: string, tamanho: string, valor: string, podeZero: boolean) => {
    const n = lerPreco(valor);
    if (n !== null && (podeZero || n > 0)) mudarPreco(set, chave, tamanho, textoDoPreco(n));
  };
  const novaLinha = (set: typeof setSabores, prefixo: string) => {
    const l = linhaVazia(prefixo);
    focarNome.current = l.chave;
    set((lista) => [...lista, l]);
  };

  // ── o que a tela mostra ──────────────────────────────────────────────────
  const titulo = editando ? "🍕 Pizzas: adicionar sabor e mudar preço" : "🍕 Cadastrar pizza";

  if (tela === "inicio") {
    return (
      <Janela titulo="🍕 Pizza" estreita onFechar={onFechar}>
        <div className="fh-pz-corpo">
          <h3 className="fh-pz-pergunta">Você já tem pizzas no cardápio</h3>
          <p className="fh-pz-ajuda">Para pôr um sabor novo ou mudar um preço, abra as pizzas que já existem. Nada precisa ser cadastrado de novo.</p>
          {existentes.map((m) => (
            <div key={m.categoria} className="fh-pz-existente">
              <div>
                <b>🍕 {m.categoria}</b>
                <small>
                  {m.tamanhos.map((t) => nomeDoTamanho(t.nome)).join(", ")} · {m.sabores.length} {m.sabores.length === 1 ? "sabor" : "sabores"}
                  {m.bordas.length > 0 && ` · ${m.bordas.length} ${m.bordas.length === 1 ? "borda" : "bordas"}`}
                </small>
              </div>
              <button type="button" className="fh-pz-btn sim" onClick={() => editarExistente(m)}>Adicionar sabor ou mudar preço <ArrowRight size={16} /></button>
            </div>
          ))}
          <p className="fh-pz-nota">Vai cadastrar outro grupo de pizzas, em outra categoria (pizzas doces, por exemplo)?</p>
          <button type="button" className="fh-pz-btn" style={{ marginTop: 8 }} onClick={() => { setMontagem(null); setTela("tamanhos"); }}>
            <Plus size={16} /> Cadastrar pizzas do zero
          </button>
        </div>
        <div className="fh-pz-rodape">
          <button type="button" className="fh-pz-btn direita" onClick={onFechar}>Fechar</button>
        </div>
      </Janela>
    );
  }

  if (tela === "pronto") {
    return (
      <Janela titulo={titulo} estreita onFechar={onFechar}>
        <div className="fh-pz-corpo">
          <div className="fh-pz-pronto">
            <div className="ok"><Check size={34} strokeWidth={3} /></div>
            <h3 className="fh-pz-pergunta">{editando ? "Pronto! As mudanças já estão no cardápio." : "Pronto! Suas pizzas já estão no cardápio."}</h3>
            <p className="fh-pz-ajuda" style={{ margin: "8px auto 0", maxWidth: 460 }}>
              Cada tamanho virou uma pizza na categoria <b>{categoria === NOVA_CATEGORIA ? novaCategoria : categoria}</b>.
              Para pôr foto, clique no lápis da pizza. Para pausar um sabor que acabou, clique no ⏸ do sabor, dentro de Complementos.
              Para pôr um sabor novo depois, é só voltar em Novo Item › Pizza.
            </p>
          </div>
        </div>
        <div className="fh-pz-rodape">
          <button type="button" className="fh-pz-btn sim direita" onClick={onFechar}>Fechar</button>
        </div>
      </Janela>
    );
  }

  const aviso = tentouAvancar ? problema : null;
  const ultimo = tela === "conferir";

  return (
    <Janela titulo={titulo} onFechar={onFechar}>
      <div className="fh-pz-passos" aria-label="Passos">
        {passos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className={`fh-pz-passo${i < indiceDoPasso ? " feito" : ""}${i === indiceDoPasso ? " agora" : ""}${podePular ? " clicavel" : ""}`}
            onClick={() => { if (podePular) setTela(p.id); }}
            aria-current={i === indiceDoPasso ? "step" : undefined}
            tabIndex={podePular ? 0 : -1}
          >
            <i /><span>{i + 1}. {p.titulo}</span>
          </button>
        ))}
      </div>

      <div className="fh-pz-corpo" ref={corpoRef}>
        <span className="fh-pz-num">Passo {indiceDoPasso + 1} de {passos.length}</span>

        {tela === "tamanhos" && (
          <>
            <h3 className="fh-pz-pergunta">Quais tamanhos de pizza você vende?</h3>
            <p className="fh-pz-ajuda">Toque para marcar. Cada tamanho vira uma pizza no seu cardápio, e o cliente escolhe os sabores dentro dela.</p>
            <div className="fh-pz-tamanhos">
              {tamanhos.map((t) => (
                <button key={t.chave} type="button" className="fh-pz-chip" aria-pressed={t.marcado} onClick={() => mudarTamanho(t.chave, { marcado: !t.marcado })}>
                  <span className="fh-pz-marca">{t.marcado && <Check size={14} strokeWidth={3.5} />}</span>
                  <b>{t.nome}</b>
                  <small>{t.id ? (t.marcado ? (t.ativo ? "já está no cardápio" : "está pausada") : "vai ser pausada") : t.fatias ? `${t.fatias} fatias` : "tamanho seu"}</small>
                </button>
              ))}
            </div>
            <div className="fh-pz-outro">
              <input
                className="fh-pz-campo"
                style={{ flex: 1, minWidth: 200 }}
                value={outroTamanho}
                onChange={(e) => setOutroTamanho(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTamanho(); } }}
                placeholder="Outro tamanho? Escreva aqui (ex.: Média 35 cm)"
                aria-label="Nome de outro tamanho"
              />
              <button type="button" className="fh-pz-btn" onClick={adicionarTamanho} disabled={!outroTamanho.trim()}><Plus size={16} /> Adicionar tamanho</button>
            </div>
          </>
        )}

        {tela === "detalhes" && (
          <>
            <h3 className="fh-pz-pergunta">Como é cada tamanho?</h3>
            <p className="fh-pz-ajuda">Diga quantas fatias tem e até quantos sabores o cliente pode escolher. <b>1 sabor</b> é a pizza inteira de um sabor só. <b>2 sabores</b> é o meio a meio.</p>
            <div className="fh-pz-cartoes">
              {marcados.map((t) => (
                <div key={t.chave} className="fh-pz-cartao">
                  <h3>🍕 {nomeDoTamanho(t.nome)}</h3>
                  <div className="fh-pz-linha">
                    <span>Quantas fatias?</span>
                    <span className="fh-pz-passos-num">
                      <button type="button" aria-label="Menos fatias" disabled={!t.fatias} onClick={() => mudarTamanho(t.chave, { fatias: t.fatias && t.fatias > 1 ? t.fatias - 1 : null })}><Minus size={16} /></button>
                      <b>{t.fatias || "—"}</b>
                      <button type="button" aria-label="Mais fatias" disabled={(t.fatias || 0) >= 32} onClick={() => mudarTamanho(t.chave, { fatias: (t.fatias || 0) + 1 })}><Plus size={16} /></button>
                    </span>
                  </div>
                  <div className="fh-pz-linha">
                    <span>Até quantos sabores o cliente escolhe?</span>
                    <span className="fh-pz-segmento">
                      {Array.from({ length: MAX_SABORES }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" aria-pressed={t.sabores === n} onClick={() => mudarTamanho(t.chave, { sabores: n })}>
                          {n} {n === 1 ? "sabor" : "sabores"}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tela === "regra" && (
          <>
            <h3 className="fh-pz-pergunta">Quando o cliente escolhe 2 sabores, quanto ele paga?</h3>
            <p className="fh-pz-ajuda">Cada pizzaria cobra de um jeito. Escolha o seu.</p>
            <div className="fh-pz-exemplo">
              <b>Exemplo:</b> o cliente pede uma pizza <b>meia Calabresa e meia Camarão</b>. A pizza inteira de Calabresa custa <b>R$ 50,00</b> e a de Camarão, <b>R$ 70,00</b>.
            </div>
            <div className="fh-pz-regras">
              <button type="button" className="fh-pz-regra" aria-pressed={regra === "MAIOR"} onClick={() => setRegra("MAIOR")}>
                <span className="fh-pz-marca">{regra === "MAIOR" && <Check size={14} strokeWidth={3.5} />}</span>
                <b>Cobro o sabor mais caro</b>
                <span className="valor">{reais(precoDoMeio("MAIOR", [50, 70]))}</span>
                <span>O cliente paga o preço do sabor mais caro que escolheu.</span>
                <span className="selo">O mais comum, igual ao iFood</span>
              </button>
              <button type="button" className="fh-pz-regra" aria-pressed={regra === "MEDIA"} onClick={() => setRegra("MEDIA")}>
                <span className="fh-pz-marca">{regra === "MEDIA" && <Check size={14} strokeWidth={3.5} />}</span>
                <b>Cobro a metade de cada sabor</b>
                <span className="valor">{reais(precoDoMeio("MEDIA", [50, 70]))}</span>
                <span>Metade da Calabresa (R$ 25,00) mais metade do Camarão (R$ 35,00).</span>
              </button>
            </div>
            <p className="fh-pz-nota">Nos dois casos você só digita o preço da pizza <b>inteira</b> de cada sabor. A conta do meio a meio o sistema faz sozinho, e o cliente vê a regra escrita na hora de escolher.</p>
          </>
        )}

        {tela === "sabores" && (
          <>
            <h3 className="fh-pz-pergunta">Quais sabores você faz, e quanto custa cada pizza?</h3>
            <p className="fh-pz-ajuda">
              Digite o preço da pizza <b>inteira</b> de cada sabor, em cada tamanho. Deixe em branco o tamanho que o sabor não tem.
              {precisaDeRegra && <> O meio a meio o sistema calcula sozinho ({regra === "MEDIA" ? "metade de cada sabor" : "pelo sabor mais caro"}).</>}
            </p>
            <TabelaDePrecos
              linhas={sabores}
              tamanhos={marcados}
              nome="Sabor"
              exemploNome="Ex.: Calabresa"
              exemploDescricao="Ingredientes (o cliente lê): ex.: calabresa, cebola e azeitona"
              podeZero={false}
              mostrarRuim={tentouAvancar}
              onNome={(chave, v) => mudarLinha(setSabores, chave, { nome: v })}
              onDescricao={(chave, v) => mudarLinha(setSabores, chave, { descricao: v })}
              onPreco={(chave, t, v) => mudarPreco(setSabores, chave, t, v)}
              onArrumar={(chave, t, v) => arrumarPreco(setSabores, chave, t, v, false)}
              onTirar={(chave) => setSabores((l) => (l.length > 1 ? l.filter((x) => x.chave !== chave) : [linhaVazia("sabor")]))}
            />
            <button type="button" className="fh-pz-mais" onClick={() => novaLinha(setSabores, "sabor")}><Plus size={18} /> Adicionar sabor</button>
          </>
        )}

        {tela === "borda" && (
          <>
            <h3 className="fh-pz-pergunta">Você tem borda recheada?</h3>
            <p className="fh-pz-ajuda">Se tiver, o cliente escolhe a borda depois dos sabores, e o valor dela é somado ao preço da pizza.</p>
            <div className="fh-pz-simnao">
              <button type="button" className="fh-pz-chip" aria-pressed={temBorda === false} onClick={() => setTemBorda(false)}>
                <span className="fh-pz-marca">{temBorda === false && <Check size={14} strokeWidth={3.5} />}</span>
                <b>Não tenho borda</b><small>Pular esta parte</small>
              </button>
              <button type="button" className="fh-pz-chip" aria-pressed={temBorda === true} onClick={() => setTemBorda(true)}>
                <span className="fh-pz-marca">{temBorda === true && <Check size={14} strokeWidth={3.5} />}</span>
                <b>Tenho borda</b><small>Cadastrar as bordas</small>
              </button>
            </div>
            {temBorda && (
              <>
                <p className="fh-pz-ajuda" style={{ marginBottom: 10 }}>Digite quanto cada borda <b>soma</b> no preço, em cada tamanho. Digite 0 se for grátis. Deixe em branco o tamanho que não tem a borda.</p>
                <TabelaDePrecos
                  linhas={bordas}
                  tamanhos={marcados}
                  nome="Borda"
                  exemploNome="Ex.: Catupiry"
                  podeZero
                  mostrarRuim={tentouAvancar}
                  onNome={(chave, v) => mudarLinha(setBordas, chave, { nome: v })}
                  onPreco={(chave, t, v) => mudarPreco(setBordas, chave, t, v)}
                  onArrumar={(chave, t, v) => arrumarPreco(setBordas, chave, t, v, true)}
                  onTirar={(chave) => setBordas((l) => (l.length > 1 ? l.filter((x) => x.chave !== chave) : [linhaVazia("borda")]))}
                />
                <button type="button" className="fh-pz-mais" onClick={() => novaLinha(setBordas, "borda")}><Plus size={18} /> Adicionar borda</button>
              </>
            )}
          </>
        )}

        {tela === "conferir" && (
          <Conferir
            montagem={montagemAtual(categoria === NOVA_CATEGORIA ? novaCategoria : categoria)}
            precisaDeRegra={precisaDeRegra}
            categorias={categorias}
            categoria={categoria}
            novaCategoria={novaCategoria}
            onCategoria={setCategoria}
            onNovaCategoria={setNovaCategoria}
            pausadas={tamanhos.filter((t) => t.id && !t.marcado).map((t) => nomeDoTamanho(t.nome))}
            ativos={marcados.map((t) => t.ativo)}
            editando={editando}
          />
        )}
      </div>

      <div className="fh-pz-rodape">
        {(indiceDoPasso > 0 || (existentes.length > 0 && !editar)) && (
          <button type="button" className="fh-pz-btn" onClick={voltar}><ArrowLeft size={16} /> Voltar</button>
        )}
        <span className={erroAoSalvar ? "fh-pz-aviso erro" : "fh-pz-aviso"} role="status">{erroAoSalvar || aviso || ""}</span>
        {ultimo ? (
          <button type="button" className="fh-pz-btn sim direita" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : editando ? <><Check size={17} /> Salvar as mudanças</> : <><Check size={17} /> Cadastrar as pizzas</>}
          </button>
        ) : (
          <button type="button" className="fh-pz-btn sim direita" onClick={avancar}>Continuar <ArrowRight size={16} /></button>
        )}
      </div>
    </Janela>
  );
}

/** A tabela de sabores (e a de bordas): nome, ingredientes e um preço por tamanho. */
function TabelaDePrecos({
  linhas, tamanhos, nome, exemploNome, exemploDescricao, podeZero, mostrarRuim, onNome, onDescricao, onPreco, onArrumar, onTirar,
}: {
  linhas: LinhaNaTela[];
  tamanhos: TamanhoNaTela[];
  nome: string;
  exemploNome: string;
  exemploDescricao?: string;
  podeZero: boolean;
  mostrarRuim: boolean;
  onNome: (chave: string, valor: string) => void;
  onDescricao?: (chave: string, valor: string) => void;
  onPreco: (chave: string, tamanho: string, valor: string) => void;
  onArrumar: (chave: string, tamanho: string, valor: string) => void;
  onTirar: (chave: string) => void;
}) {
  const ruim = (txt: string | undefined) => {
    const s = (txt || "").trim();
    if (!s) return false;
    const n = lerPreco(s);
    return n === null || (!podeZero && n <= 0);
  };
  return (
    <div className="fh-pz-tabela" style={{ ["--n" as string]: tamanhos.length }}>
      <div className="fh-pz-cab" aria-hidden="true">
        <span>{nome}</span>
        {tamanhos.map((t) => <span key={t.chave} title={nomeDoTamanho(t.nome)}>{t.nome}</span>)}
        <span />
      </div>
      {linhas.map((l) => (
        <div key={l.chave} className="fh-pz-sabor">
          <div className="fh-pz-grade">
            <div className="fh-pz-nome">
              <input
                className="fh-pz-campo"
                data-nome={l.chave}
                value={l.nome}
                onChange={(e) => onNome(l.chave, e.target.value)}
                placeholder={exemploNome}
                aria-label={`Nome do ${nome.toLowerCase() === "borda" ? "borda" : "sabor"}`}
              />
            </div>
            {tamanhos.map((t) => (
              <label key={t.chave} className="fh-pz-celula">
                <span className="fh-pz-rotulo">{t.nome}</span>
                <span className="fh-pz-reais">
                  <em>R$</em>
                  <input
                    className={mostrarRuim && ruim(l.precos[t.chave]) ? "fh-pz-campo ruim" : "fh-pz-campo"}
                    inputMode="decimal"
                    value={l.precos[t.chave] || ""}
                    onChange={(e) => onPreco(l.chave, t.chave, e.target.value)}
                    onBlur={(e) => onArrumar(l.chave, t.chave, e.target.value)}
                    placeholder={podeZero ? "0,00" : "—"}
                    aria-label={`Preço ${l.nome ? `de ${l.nome}` : ""} na ${t.nome}`}
                  />
                </span>
              </label>
            ))}
            <button type="button" className="fh-pz-lixo" onClick={() => onTirar(l.chave)} title={`Tirar este ${nome.toLowerCase()}`} aria-label={`Tirar ${l.nome || `este ${nome.toLowerCase()}`}`}>
              <Trash2 size={16} />
            </button>
          </div>
          {onDescricao && (
            <input
              className="fh-pz-campo fh-pz-ingredientes"
              style={{ width: "100%" }}
              value={l.descricao}
              onChange={(e) => onDescricao(l.chave, e.target.value)}
              placeholder={exemploDescricao}
              aria-label={`Ingredientes ${l.nome ? `de ${l.nome}` : ""}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** O último passo: em qual categoria, e como o cliente vai ver. */
function Conferir({
  montagem, precisaDeRegra, categorias, categoria, novaCategoria, onCategoria, onNovaCategoria, pausadas, ativos, editando,
}: {
  montagem: MontagemDaPizza;
  precisaDeRegra: boolean;
  categorias: { name: string; emoji?: string }[];
  categoria: string;
  novaCategoria: string;
  onCategoria: (v: string) => void;
  onNovaCategoria: (v: string) => void;
  pausadas: string[];
  ativos: boolean[];
  editando: boolean;
}) {
  // O exemplo do meio a meio com os sabores DA LOJA: o tamanho de 2+ sabores
  // com a maior diferença entre dois sabores, que é onde a regra aparece.
  const exemplo = (() => {
    let melhor: { tamanho: string; a: string; b: string; pa: number; pb: number } | null = null;
    montagem.tamanhos.forEach((t, i) => {
      if (t.sabores < 2) return;
      const com = montagem.sabores.filter((s) => s.precos[i] !== null).map((s) => ({ nome: s.nome, preco: s.precos[i] as number }));
      if (com.length < 2) return;
      const barato = com.reduce((x, y) => (y.preco < x.preco ? y : x));
      const caro = com.reduce((x, y) => (y.preco > x.preco ? y : x));
      const par = barato === caro ? [com[0], com[1]] : [barato, caro];
      if (!melhor || Math.abs(par[1].preco - par[0].preco) > Math.abs(melhor.pb - melhor.pa)) {
        melhor = { tamanho: nomeDoTamanho(t.nome), a: par[0].nome, b: par[1].nome, pa: par[0].preco, pb: par[1].preco };
      }
    });
    return melhor as { tamanho: string; a: string; b: string; pa: number; pb: number } | null;
  })();

  return (
    <>
      <h3 className="fh-pz-pergunta">Confira e salve</h3>
      <p className="fh-pz-ajuda">É assim que as pizzas vão aparecer no seu cardápio.</p>

      <div className="fh-pz-secao">
        <h3>Categoria do cardápio</h3>
        <div className="fh-pz-outro" style={{ marginTop: 0 }}>
          <select className="fh-pz-campo" value={categoria} onChange={(e) => onCategoria(e.target.value)} aria-label="Categoria do cardápio" style={{ minWidth: 220 }}>
            {categorias.map((c) => <option key={c.name} value={c.name}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>)}
            <option value={NOVA_CATEGORIA}>+ Criar categoria nova</option>
          </select>
          {categoria === NOVA_CATEGORIA && (
            <input className="fh-pz-campo" style={{ flex: 1, minWidth: 180 }} value={novaCategoria} onChange={(e) => onNovaCategoria(e.target.value)} placeholder="Nome da categoria (ex.: Pizzas)" aria-label="Nome da categoria nova" />
          )}
        </div>
      </div>

      <div className="fh-pz-secao">
        <h3>No cardápio</h3>
        <div className="fh-pz-vitrine">
          {montagem.tamanhos.map((t, i) => {
            const inicial = precoInicialDoTamanho(montagem, i);
            const sabores = montagem.sabores.filter((s) => s.precos[i] !== null).length;
            const bordas = montagem.bordas.filter((b) => b.precos[i] !== null).length;
            return (
              <div key={`${t.nome}-${i}`} className={ativos[i] === false ? "fh-pz-item pausada" : "fh-pz-item"}>
                <b>{nomeDoTamanho(t.nome)}{ativos[i] === false ? " (pausada)" : ""}</b>
                <small>{descricaoDoTamanho(t)}</small>
                <small>{sabores} {sabores === 1 ? "sabor" : "sabores"}{bordas > 0 ? ` · ${bordas} ${bordas === 1 ? "borda" : "bordas"}` : ""}</small>
                {inicial !== null && <strong>a partir de {reais(inicial)}</strong>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="fh-pz-secao">
        <h3>Resumo</h3>
        <div className="fh-pz-resumo">
          {precisaDeRegra && (
            <span>
              🍕 <b>Meio a meio:</b> {montagem.regra === "MEDIA" ? "cobra a metade de cada sabor." : "cobra o sabor mais caro."}
              {exemplo && (
                <> Exemplo: {exemplo.tamanho}, meia {exemplo.a} ({reais(exemplo.pa)}) e meia {exemplo.b} ({reais(exemplo.pb)}) = <b>{reais(precoDoMeio(montagem.regra, [exemplo.pa, exemplo.pb]))}</b>.</>
              )}
            </span>
          )}
          <span>📋 <b>{montagem.sabores.length} {montagem.sabores.length === 1 ? "sabor" : "sabores"}:</b> {montagem.sabores.map((s) => s.nome).join(", ")}.</span>
          <span>🧀 <b>Borda:</b> {montagem.bordas.length ? montagem.bordas.map((b) => b.nome).join(", ") + "." : "não tem."}</span>
          {editando && pausadas.length > 0 && (
            <span style={{ color: "#B45309" }}>⏸ <b>Vão ser pausadas</b> (saem do cardápio, mas não são apagadas): {pausadas.join(", ")}.</span>
          )}
        </div>
      </div>
    </>
  );
}
