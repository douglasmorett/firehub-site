"use client";

/**
 * A tela onde a loja monta a própria comanda.
 *
 * ── A régua é o ponto ───────────────────────────────────────────────────────
 *
 * O papel da direita é o papel: ele roda o MESMO código que o Assistente usa
 * para imprimir (lib/gerado/comanda-do-assistente.ts, cópia do server.js) e
 * desenha os bytes que sairiam para a impressora escolhida — largura da bobina,
 * colunas, letra alta, letra larga, tarja preta, QR (lib/previa-da-comanda.ts).
 *
 * Até 23/09/2026 a prévia era uma segunda implementação, e mentia: a Pizzaria do
 * Costa escolheu 58 mm aqui, viu um papel comportado e recebeu o número do
 * pedido em corpo triplo quebrando em três linhas, com a faixa da direita vazia.
 *
 * O que a prévia NÃO promete: o conteúdo de itens e totais. Aqui roda um pedido
 * de exemplo — e a tela diz isso, em vez de deixar o lojista achar que o nome
 * do cliente vai ser sempre "Larissa".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AJUDA_DO_BLOCO,
  AVISOS_DA_COMANDA,
  CORPOS_DO_BLOCO,
  corpoDoBloco,
  BLOCOS_OBRIGATORIOS,
  CAMPOS_DISPONIVEIS,
  NOME_DO_BLOCO,
  ROTULOS_DO_BLOCO,
  TAMANHOS,
  VERSAO_MINIMA_DOS_AVISOS,
  VERSAO_MINIMA_DOS_ROTULOS,
  negritoDoBloco,
  negritoPadrao,
  aceitaFormato,
  aceitaTitulo,
  lerModelo,
  modeloPadrao,
  rotuloDoBloco,
  rotuloPadrao,
  tamanhoValido,
  temRotuloTrocado,
  type Alinhamento,
  type Bloco,
  type ChaveDeAviso,
  type LinhaRica,
  type ParteDaLinha,
  type ModeloDeComanda,
  type TipoDeBloco,
} from "@/lib/comanda-modelo";
import { EXEMPLOS_DA_PREVIA, papelDaPrevia, type ExemploDaPrevia } from "@/lib/previa-da-comanda";
import { geometriaDaImpressora } from "@/lib/papel-da-impressora";
import { PALETA } from "@/lib/paleta-brasa";
import PapelDaComanda, { type AcaoDaLinha } from "./PapelDaComanda";

/**
 * Compara versão NÚMERO a número.
 *
 * Comparar como texto parece funcionar e mente na hora errada: "1.2.9" é
 * MAIOR que "1.2.11" em ordem alfabética, porque "9" vem depois de "1". Seria
 * exatamente a loja mais atrasada — a que mais precisa do aviso — a ficar sem
 * ele.
 */
function ehMaisVelha(instalada?: string, minima?: string): boolean {
  if (!instalada || !minima) return false;
  const a = instalada.split(".").map((n) => parseInt(n, 10) || 0);
  const b = minima.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

const VERMELHO = "#C92E09";
const BORDA = "1.5px solid #E2E8F0";

/**
 * A largura de reserva, para a loja que ainda não cadastrou impressora. Quem
 * cadastrou vê a prévia DA impressora — o botão de largura solto mudava só a
 * tela, e a loja achava que tinha configurado a impressora.
 */
const LARGURAS: { colunas: number; rotulo: string; paperWidth: "58mm" | "80mm" }[] = [
  { colunas: 48, rotulo: "80 mm · 48 colunas", paperWidth: "80mm" },
  { colunas: 42, rotulo: "Bematech · 42 colunas", paperWidth: "80mm" },
  { colunas: 32, rotulo: "58 mm · 32 colunas", paperWidth: "58mm" },
];

/** O que a prévia precisa saber de cada impressora cadastrada. */
export type ImpressoraDaPrevia = {
  id: string;
  nome: string;
  paperWidth?: string;
  columns?: number;
  modeloId?: string;
};

/** As colunas que o Assistente usa: a calibração, senão o padrão da bobina. */
function colunasDaImpressora(p: { paperWidth?: string; columns?: number }): number {
  const c = Number(p.columns);
  if (Number.isFinite(c) && c >= 24 && c <= 64) return Math.floor(c);
  return String(p.paperWidth || "").startsWith("58") ? 32 : 48;
}

/** Texto do jeito que o Assistente o põe no papel: sem acento, maiúsculo para comparar. */
const noPapel = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** As frases de aviso, para o clique no papel abrir a aba Avisos no aviso certo. */
const FRASES_DE_AVISO: { prefixo: string; chave: ChaveDeAviso }[] = [
  { prefixo: "!! COBRAR DO CLIENTE", chave: "cobrarDoCliente" },
  { prefixo: "(COBRAR NA ENTREGA)", chave: "cobrarNaEntrega" },
  { prefixo: "(PAGO VIA", chave: "pagoOnline" },
  { prefixo: "TROCO PARA", chave: "troco" },
  { prefixo: "!! OBSERVACAO", chave: "faixaObservacao" },
  { prefixo: "!! CONTEM BEBIDA", chave: "contemBebida" },
  { prefixo: "!! ATENCAO: POSSUI BEBIDA", chave: "contemBebida" },
  { prefixo: "OBRIGADO PELA PREFERENCIA", chave: "obrigado" },
];

type AlvoDaLinha =
  | { tipo: "rotulo"; bloco: number; chave: string }
  | { tipo: "bloco"; bloco: number }
  | { tipo: "aviso"; chave: ChaveDeAviso };

type Props = {
  modelo: unknown;
  nomeDaLoja: string;
  /** Versão do Assistente instalado nesta máquina, quando ele respondeu. */
  versaoInstalada?: string;
  /** Versão em que o modelo passou a ser lido pelo Assistente. */
  versaoMinima: string;
  /** As impressoras cadastradas (com nome), para a prévia sair na largura DELAS. */
  impressoras?: ImpressoraDaPrevia[];
  /** O modelo em edição ("" = padrão da loja): abre na impressora que o usa. */
  modeloEmEdicao?: string;
  /** A faixa de bebida segue a configuração da loja, como no papel. */
  autoBeverageTag?: boolean;
  customBeverageKeywords?: unknown;
  onChange: (modelo: ModeloDeComanda) => void;
  /** O modelo sai sempre SEM VALORES (ex.: "Cozinha sem valores"): só existe a via da cozinha. */
  soSemValores?: boolean;
};

export default function ComandaModeloEditor({
  modelo, nomeDaLoja, versaoInstalada, versaoMinima, impressoras = [], modeloEmEdicao = "",
  autoBeverageTag, customBeverageKeywords, onChange, soSemValores = false,
}: Props) {
  const atual = useMemo(() => lerModelo(modelo), [modelo]);
  const [via, setVia] = useState<"completo" | "cozinha">(soSemValores ? "cozinha" : "completo");
  // ── A IMPRESSORA DA PRÉVIA ─────────────────────────────────────────────
  //
  // Abre na impressora que usa o modelo em edição (a da cozinha, se o modelo é
  // dela); sem nenhuma, na primeira. A largura, as colunas e o tamanho da
  // letra saem dela — do mesmo cadastro que o Assistente lê.
  const [impressoraId, setImpressoraId] = useState<string>(
    () => (impressoras.find((p) => (p.modeloId || "") === modeloEmEdicao) || impressoras[0])?.id || "",
  );
  const [larguraDeReserva, setLarguraDeReserva] = useState(LARGURAS[0]);
  const [exemplo, setExemplo] = useState<ExemploDaPrevia>("entrega");
  const [aba, setAba] = useState<"blocos" | "avisos">("blocos");
  /** O aviso que o clique no papel apontou, para piscar na aba Avisos. */
  const [avisoApontado, setAvisoApontado] = useState<ChaveDeAviso | null>(null);
  /** A linha do papel que virou campo de edição. */
  const [linhaEmEdicao, setLinhaEmEdicao] = useState<number | null>(null);
  const impressora = impressoras.find((p) => p.id === impressoraId) || null;
  const paperWidth = impressora ? impressora.paperWidth || "80mm" : larguraDeReserva.paperWidth;
  const colunas = impressora ? colunasDaImpressora(impressora) : larguraDeReserva.colunas;
  const geometria = geometriaDaImpressora(paperWidth, colunas);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  /**
   * ── EDITAR CLICANDO NO PAPEL ───────────────────────────────────────────
   *
   * Pedido do dono (19/09/2026): "na Saipos o cara clica na comanda e muda o
   * que vai sair escrito". Até aqui o papel da direita era só desenho, e para
   * trocar uma palavra o lojista tinha que adivinhar qual card da esquerda
   * desenha aquela linha — quando a palavra era editável, o que quase nunca
   * era.
   *
   * `edicao` guarda a palavra aberta: o bloco e a chave do rótulo (ou
   * "@titulo", o título da seção, que já existia). O texto em edição fica num
   * estado à parte e só entra no modelo ao confirmar — digitar direto no
   * modelo remontava a comanda inteira a cada tecla e o cursor pulava para o
   * fim.
   */
  const [edicao, setEdicao] = useState<{ bloco: number; rotulo: string } | null>(null);
  const [rascunho, setRascunho] = useState("");
  /** O bloco que o clique no papel acabou de apontar, para o card piscar. */
  const [blocoApontado, setBlocoApontado] = useState<number | null>(null);
  const campoRef = useRef<HTMLInputElement | null>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (edicao) campoRef.current?.focus();
  }, [edicao]);

  // O realce do card apaga sozinho: piscar é para achar, não para marcar.
  useEffect(() => {
    if (blocoApontado == null) return;
    const t = setTimeout(() => setBlocoApontado(null), 1600);
    return () => clearTimeout(t);
  }, [blocoApontado]);

  const lista = atual[via];
  // O papel que a impressora escolhida imprimiria, pelo código do Assistente.
  const papel = useMemo(
    () => papelDaPrevia({
      lista, avisos: atual.avisos, via, exemplo, nomeDaLoja, colunas,
      autoBeverageTag, customBeverageKeywords,
    }),
    [lista, atual.avisos, via, exemplo, nomeDaLoja, colunas, autoBeverageTag, customBeverageKeywords],
  );

  // ── O QUE CADA LINHA DO PAPEL É ────────────────────────────────────────
  //
  // O papel agora vem dos BYTES do Assistente, que não dizem de qual bloco é
  // cada linha. Para o clique continuar trocando a palavra (pedido do dono de
  // 19/09/2026, "como na Saipos"), cada linha é reconhecida pelo texto: começa
  // com uma palavra editável de algum bloco ligado ("Estabelecimento:",
  // "Total:", o título "CLIENTE")? É ela. Frase de aviso? Abre a aba Avisos.
  // O resto pertence ao bloco da última palavra reconhecida acima — o nome do
  // cliente é do bloco Cliente, o item é da lista de itens.
  const alvos = useMemo<(AlvoDaLinha | null)[]>(() => {
    const nomeDoApp = exemplo === "ifood" ? "iFood" : "app";
    const candidatos: { texto: string; bloco: number; chave: string; noMeio: boolean }[] = [];
    lista.forEach((bl, i) => {
      if (bl.ligado === false) return;
      if (aceitaTitulo(bl.tipo) && bl.titulo) candidatos.push({ texto: noPapel(bl.titulo), bloco: i, chave: "@titulo", noMeio: false });
      for (const r of ROTULOS_DO_BLOCO[bl.tipo] || []) {
        const texto = noPapel(rotuloDoBloco(bl, r.chave).replace("{canal}", nomeDoApp));
        // "DELIVERY" vem depois do número: "(12) DELIVERY".
        if (texto) candidatos.push({ texto, bloco: i, chave: r.chave, noMeio: bl.tipo === "numeroPedido" });
      }
    });
    candidatos.sort((a, b) => b.texto.length - a.texto.length);
    const topo = lista.findIndex((b) => b.tipo === "numeroPedido" && b.ligado !== false);
    let blocoAtual: number | null = topo >= 0 ? topo : null;
    return papel.map((l) => {
      const texto = noPapel(l.trechos.map((t) => t.texto).join(""));
      if (!texto) return null;
      const c = candidatos.find((x) =>
        x.noMeio ? texto.includes(x.texto)
          // A palavra grande que quebrou em duas linhas ("RESUMO DO" / "PEDIDO")
          // ainda é reconhecida pela primeira metade.
          : texto.startsWith(x.texto) || (texto.length >= 4 && x.texto.startsWith(texto)),
      );
      if (c) { blocoAtual = c.bloco; return { tipo: "rotulo", bloco: c.bloco, chave: c.chave }; }
      const aviso = FRASES_DE_AVISO.find((a) => texto.startsWith(a.prefixo));
      if (aviso) return { tipo: "aviso", chave: aviso.chave };
      return blocoAtual != null ? { tipo: "bloco", bloco: blocoAtual } : null;
    });
  }, [papel, lista, exemplo]);

  const acoes = useMemo<(AcaoDaLinha | null)[]>(() => alvos.map((a) => {
    if (!a) return null;
    if (a.tipo === "rotulo") return { clicavel: true, destaque: true, titulo: "Clique para mudar esta palavra" };
    if (a.tipo === "aviso") return { clicavel: true, titulo: "Aviso — clique para ligar ou desligar na aba Avisos" };
    return { clicavel: true, titulo: `Sai de: ${NOME_DO_BLOCO[lista[a.bloco]?.tipo]}` };
  }), [alvos, lista]);

  const clicarLinha = (i: number) => {
    const a = alvos[i];
    if (!a) return;
    if (a.tipo === "rotulo") {
      setLinhaEmEdicao(i);
      abrirEdicao(a.bloco, a.chave);
    } else if (a.tipo === "aviso") {
      setAba("avisos");
      setAvisoApontado(a.chave);
    } else {
      // A aba precisa aparecer antes de o card rolar para a vista.
      setAba("blocos");
      setTimeout(() => apontarBloco(a.bloco), 30);
    }
  };

  // O aviso apontado pisca e apaga, como o card do bloco.
  useEffect(() => {
    if (!avisoApontado) return;
    const t = setTimeout(() => setAvisoApontado(null), 1800);
    return () => clearTimeout(t);
  }, [avisoApontado]);

  const alternarAviso = (chave: ChaveDeAviso) => {
    const desligados = { ...(atual.avisos || {}) };
    if (desligados[chave] === false) delete desligados[chave];
    else desligados[chave] = false;
    onChange({ ...atual, avisos: Object.keys(desligados).length ? desligados : undefined });
  };
  const avisosDesligados = AVISOS_DA_COMANDA.filter((a) => atual.avisos?.[a.chave] === false).length;

  const trocar = (novaLista: Bloco[]) => onChange({ ...atual, [via]: novaLista });
  const mexerNoBloco = (i: number, mudanca: Partial<Bloco>) =>
    trocar(lista.map((b, j) => (j === i ? { ...b, ...mudanca } : b)));

  /** O texto que está no papel para aquela palavra (o da loja ou o de fábrica). */
  const textoDoRotulo = (iBloco: number, chave: string): string => {
    const bloco = lista[iBloco];
    if (!bloco) return "";
    if (chave === "@titulo") return String(bloco.titulo ?? "");
    return rotuloDoBloco(bloco, chave);
  };

  /** Grava a palavra. Vazio volta ao texto de fábrica em vez de sumir do papel. */
  const gravarRotulo = (iBloco: number, chave: string, valor: string) => {
    const bloco = lista[iBloco];
    if (!bloco) return;
    const t = valor.trim();
    if (chave === "@titulo") {
      // Título aceita ficar vazio: é como se tira "CLIENTE" do papel sem
      // desligar a seção — comportamento que já existia antes desta tela.
      mexerNoBloco(iBloco, { titulo: t });
      return;
    }
    const rotulos = { ...(bloco.rotulos || {}) };
    if (!t || t === rotuloPadrao(bloco.tipo, chave)) delete rotulos[chave];
    else rotulos[chave] = t.slice(0, 60);
    mexerNoBloco(iBloco, { rotulos: Object.keys(rotulos).length ? rotulos : undefined });
  };

  /**
   * Liga e desliga o negrito daquela linha.
   *
   * Guarda `false` explícito quando a loja DESLIGA um negrito de fábrica —
   * "Forma de Pagamento:" e "Total:" já nascem em negrito no papel, e apagar a
   * chave em vez de gravar `false` faria o padrão voltar no próximo carregamento.
   * Quando a marcação volta a coincidir com a de fábrica, aí sim a chave sai:
   * modelo limpo é modelo que acompanha o dia em que mudarmos um padrão nosso.
   */
  const alternarNegrito = (iBloco: number, chave: string) => {
    const bloco = lista[iBloco];
    if (!bloco || chave === "@titulo") return;
    const novo = !negritoDoBloco(bloco, chave);
    const negritos = { ...(bloco.negritos || {}) };
    if (novo === negritoPadrao(bloco.tipo, chave)) delete negritos[chave];
    else negritos[chave] = novo;
    mexerNoBloco(iBloco, { negritos: Object.keys(negritos).length ? negritos : undefined });
  };

  const abrirEdicao = (iBloco: number, chave: string) => {
    setRascunho(textoDoRotulo(iBloco, chave));
    setEdicao({ bloco: iBloco, rotulo: chave });
  };
  /** Fecha a palavra aberta sem gravar: o papel vai mudar e a linha muda de lugar. */
  const fecharEdicao = () => { setEdicao(null); setLinhaEmEdicao(null); };
  const confirmarEdicao = () => {
    if (edicao) gravarRotulo(edicao.bloco, edicao.rotulo, rascunho);
    setEdicao(null);
    setLinhaEmEdicao(null);
  };

  /** Clique numa linha sem palavra editável: leva ao card que a desenha. */
  const apontarBloco = (iBloco: number) => {
    setBlocoApontado(iBloco);
    cardsRef.current[iBloco]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const mover = (de: number, para: number) => {
    if (para < 0 || para >= lista.length || de === para) return;
    const nova = [...lista];
    nova.splice(para, 0, nova.splice(de, 1)[0]);
    trocar(nova);
  };

  /** Mexe numa LINHA do bloco de texto rico. */
  const mexerNaLinha = (iBloco: number, iLinha: number, patch: Partial<LinhaRica>) =>
    trocar(lista.map((b, k) => (k !== iBloco ? b : {
      ...b,
      linhas: (b.linhas || []).map((ln, j) => (j === iLinha ? { ...ln, ...patch } : ln)),
    })));

  /** Mexe num PEDAÇO de uma linha. */
  const mexerNaParte = (iBloco: number, iLinha: number, iParte: number, patch: Partial<ParteDaLinha>) =>
    trocar(lista.map((b, k) => (k !== iBloco ? b : {
      ...b,
      linhas: (b.linhas || []).map((ln, j) => (j !== iLinha ? ln : {
        ...ln,
        partes: (ln.partes || []).map((p, q) => (q === iParte ? { ...p, ...patch } : p)),
      })),
    })));

  return (
    <div>
      <p style={{ fontSize: "0.84rem", color: "#64748B", margin: "0 0 14px", maxWidth: "62ch", lineHeight: 1.5 }}>
        Arraste para mudar a ordem, desligue o que não quer e escreva o que quiser.{" "}
        <b style={{ color: "#0F172A" }}>Clique direto no papel ao lado para trocar uma palavra</b>{" "}
        — as que dão para mudar ficam com um tracinho embaixo. O botão <b>N</b> que aparece junto
        deixa aquela linha em negrito. Apague tudo e tecle Enter para voltar ao texto de fábrica.
        O papel ao lado é desenhado pelo mesmo programa que imprime: largura, colunas e tamanho
        das letras são os da impressora escolhida.
      </p>

      {/* ── O ASSISTENTE VELHO IGNORA O MODELO, E ISSO PRECISA ESTAR ESCRITO ──
          Sem este aviso o lojista monta a comanda, vê a prévia certinha, manda
          imprimir e recebe o layout de fábrica — e conclui que a tela está
          quebrada. O papel continua saindo normal, que é o que importa; o que
          falta é só a atualização. */}
      {ehMaisVelha(versaoInstalada, versaoMinima) && (
        <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "10px 13px", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: "0.83rem", color: "#92400E", fontWeight: 700 }}>
            ⚠️ O Assistente desta máquina está na {versaoInstalada} e só lê o modelo a partir da {versaoMinima}.
          </p>
          <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#B45309", lineHeight: 1.5 }}>
            Pode montar a comanda à vontade: fica salva. Até o Assistente atualizar (ele faz
            isso sozinho em até 6 horas), o papel sai no layout de sempre.
          </p>
        </div>
      )}

      {/* ── AS PALAVRAS TROCADAS PEDEM UM ASSISTENTE MAIS NOVO ──────────────
          Aviso separado do de cima, e só para quem trocou alguma: quem apenas
          reordenou blocos está servido desde a 1.2.11, e cobrar atualização de
          quem não usa o recurso é o jeito mais rápido de ensinar a loja a
          ignorar os nossos avisos. */}
      {temRotuloTrocado(atual) && ehMaisVelha(versaoInstalada, VERSAO_MINIMA_DOS_ROTULOS) && (
        <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "10px 13px", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: "0.83rem", color: "#92400E", fontWeight: 700 }}>
            ⚠️ As palavras que você trocou pedem o Assistente {VERSAO_MINIMA_DOS_ROTULOS} — esta máquina está na {versaoInstalada}.
          </p>
          <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#B45309", lineHeight: 1.5 }}>
            Fica tudo salvo. Até ele atualizar sozinho (leva até 6 horas), a ordem e o tamanho já
            valem no papel, mas essas palavras saem no texto de fábrica.
          </p>
        </div>
      )}

      {/* ── Via e largura ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <label style={rotuloStyle}>QUAL VIA</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([
              { chave: "completo" as const, nome: "Completa (entrega)" },
              { chave: "cozinha" as const, nome: "Cozinha (sem valores)" },
            ]).filter((v) => !soSemValores || v.chave === "cozinha").map((v) => (
              <button key={v.chave} type="button" onClick={() => { fecharEdicao(); setVia(v.chave); }} style={botao(via === v.chave)}>
                {v.nome}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={rotuloStyle}>PRÉVIA DA IMPRESSORA</label>
          {impressoras.length > 0 ? (
            <select
              value={impressoraId}
              onChange={(e) => { fecharEdicao(); setImpressoraId(e.target.value); }}
              style={{ padding: "8px 10px", borderRadius: 9, border: BORDA, fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit", background: "#fff", color: "#0F172A", maxWidth: "100%" }}
            >
              {impressoras.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} — {String(p.paperWidth || "").startsWith("58") ? "58 mm" : "80 mm"} · {colunasDaImpressora(p)} colunas
                </option>
              ))}
            </select>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {LARGURAS.map((l) => (
                <button key={l.colunas} type="button" onClick={() => setLarguraDeReserva(l)} style={botao(larguraDeReserva.colunas === l.colunas)}>
                  {l.rotulo}
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label style={rotuloStyle}>PEDIDO DE EXEMPLO</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EXEMPLOS_DA_PREVIA.map((x) => (
              <button key={x.chave} type="button" onClick={() => { fecharEdicao(); setExemplo(x.chave); }} style={botao(exemplo === x.chave)}>
                {x.nome}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── COLUNAS A MENOS QUE A BOBINA ─────────────────────────────────
          Foi o caso da Pizzaria do Costa: 24 colunas numa POS-58, que imprime
          32. O papel sai em 3/4 da largura, com a faixa da direita vazia e o
          título fora do centro — e a loja acha que é a impressora. */}
      {impressora && geometria.estreitoDemais && (
        <div style={{ background: PALETA.atencaoClaro, border: `1.5px solid ${PALETA.atencaoBorda}`, borderRadius: 12, padding: "10px 13px", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: "0.83rem", color: PALETA.atencao, fontWeight: 700 }}>
            ⚠️ {impressora.nome} está com {colunas} colunas, mas papel de {String(paperWidth).startsWith("58") ? "58" : "80"} mm cabe {geometria.nativas}.
          </p>
          <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: PALETA.carvao2, lineHeight: 1.5 }}>
            A nota sai estreita, com a faixa da direita vazia (veja o papel ao lado). Em <b>Impressoras</b>, apague o
            número do campo &quot;colunas reais&quot; desta impressora ou use a régua para conferir.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)", gap: 18, alignItems: "start" }}
           className="comanda-grade">
        {/* ── A lista de blocos ────────────────────────────────────────── */}
        <div>
          {/* ── AS ABAS: BLOCOS E AVISOS ─────────────────────────────────
              A de Avisos nasce destacada, na cor da entrega: é recurso novo
              (23/09/2026) e o lojista que procura "tirar o COBRAR NA ENTREGA"
              precisa achar sem tutorial. */}
          <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button type="button" role="tab" aria-selected={aba === "blocos"} onClick={() => setAba("blocos")} style={botao(aba === "blocos")}>
              Blocos
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={aba === "avisos"}
              onClick={() => setAba("avisos")}
              style={{
                ...botao(aba === "avisos"),
                ...(aba === "avisos"
                  ? { background: PALETA.brasa, borderColor: PALETA.brasa, color: "#fff" }
                  : { background: PALETA.brasaClaro, borderColor: PALETA.brasaBorda, color: PALETA.brasaTinta }),
              }}
            >
              ⚠️ Avisos{avisosDesligados > 0 ? ` · ${avisosDesligados} desligado${avisosDesligados > 1 ? "s" : ""}` : ""}
            </button>
          </div>

          {aba === "avisos" && (
            <div>
              <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "0 0 10px", lineHeight: 1.5 }}>
                Os avisos que saem na comanda. <b style={{ color: "#0F172A" }}>Desmarque o que a sua loja não usa</b> — o papel ao lado muda na hora.
                Vale para as duas vias deste modelo.
              </p>
              {avisosDesligados > 0 && ehMaisVelha(versaoInstalada, VERSAO_MINIMA_DOS_AVISOS) && (
                <div style={{ background: PALETA.atencaoClaro, border: `1.5px solid ${PALETA.atencaoBorda}`, borderRadius: 10, padding: "8px 11px", marginBottom: 10, fontSize: "0.78rem", color: PALETA.atencao, lineHeight: 1.5 }}>
                  ⚠️ O Assistente desta máquina está na {versaoInstalada}; os avisos desligados somem do papel a partir da {VERSAO_MINIMA_DOS_AVISOS}.
                  Fica salvo — ele se atualiza sozinho.
                </div>
              )}
              <div style={{ border: BORDA, borderRadius: 12, overflow: "hidden" }}>
                {AVISOS_DA_COMANDA.map((a, i) => {
                  const ligado = atual.avisos?.[a.chave] !== false;
                  return (
                    <label
                      key={a.chave}
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", cursor: "pointer",
                        borderBottom: i === AVISOS_DA_COMANDA.length - 1 ? "none" : "1px solid #F1F5F9",
                        background: avisoApontado === a.chave ? "#FFF7E6" : ligado ? "#fff" : "#F8FAFC",
                        transition: "background 0.25s",
                      }}
                    >
                      <input type="checkbox" checked={ligado} onChange={() => alternarAviso(a.chave)} style={{ marginTop: 3, width: 16, height: 16, accentColor: PALETA.marca }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 700, fontSize: "0.86rem", color: ligado ? "#0F172A" : "#94A3B8" }}>{a.nome}</span>
                        <span style={{ display: "block", fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.74rem", color: ligado ? PALETA.carvao2 : "#94A3B8", marginTop: 2, textDecoration: ligado ? "none" : "line-through", overflowWrap: "anywhere" }}>
                          {a.exemplo}
                        </span>
                        {a.ajuda && <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>{a.ajuda}</span>}
                      </span>
                    </label>
                  );
                })}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "#F8FAFC", borderTop: "1px solid #F1F5F9" }}>
                  <span style={{ fontSize: "0.95rem" }}>🔒</span>
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: "0.86rem", color: "#0F172A" }}>Entrega parceira — NÃO USAR MOTOBOY DA LOJA</span>
                    <span style={{ display: "block", fontSize: "0.74rem", color: "#64748B", marginTop: 2, lineHeight: 1.45 }}>
                      Sempre sai: evita mandar o seu motoboy num pedido que já tem entregador do iFood ou do 99 a caminho.
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: aba === "blocos" ? "block" : "none" }}>
          <div style={{ border: BORDA, borderRadius: 12, overflow: "hidden" }}>
            {lista.map((bloco, i) => {
              const fixo = BLOCOS_OBRIGATORIOS.includes(bloco.tipo);
              const formatavel = aceitaFormato(bloco.tipo);
              return (
                <div
                  key={`${bloco.tipo}-${i}`}
                  ref={(el) => { cardsRef.current[i] = el; }}
                  draggable
                  onDragStart={() => setArrastando(i)}
                  onDragEnd={() => setArrastando(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (arrastando !== null) mover(arrastando, i); setArrastando(null); }}
                  style={{
                    display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 11px",
                    borderBottom: i === lista.length - 1 ? "none" : "1px solid #F1F5F9",
                    background: arrastando === i ? "#FEF2F2"
                      : blocoApontado === i ? "#FFF7E6"
                      : bloco.ligado ? "#fff" : "#F8FAFC",
                    opacity: arrastando === i ? 0.5 : 1,
                    transition: "background 0.25s",
                  }}
                >
                  <span title="Arraste para mudar a ordem" style={{ cursor: "grab", color: "#CBD5E1", fontSize: "1.05rem", lineHeight: 1.2, userSelect: "none" }}>⠿</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: bloco.ligado ? "#0F172A" : "#94A3B8", textDecoration: bloco.ligado ? "none" : "line-through" }}>
                      {NOME_DO_BLOCO[bloco.tipo]}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 1, lineHeight: 1.4 }}>
                      {AJUDA_DO_BLOCO[bloco.tipo]}
                    </div>

                    {aceitaTitulo(bloco.tipo) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 700 }}>Título:</span>
                        <input
                          value={bloco.titulo ?? ""}
                          onChange={(e) => mexerNoBloco(i, { titulo: e.target.value })}
                          placeholder="(sem título)"
                          style={{ flex: "1 1 140px", minWidth: 110, padding: "5px 8px", borderRadius: 7, border: BORDA, fontSize: "0.78rem", fontWeight: 700, fontFamily: "inherit" }}
                        />
                        {/* Título sem tamanho escolhido sai em 1,5 no papel (é o
                            padrão do Assistente) — o controle mostra o que sai. */}
                        {stepper(bloco.tamanho ? tamanhoValido(bloco.tamanho) : 1.5, (t) => mexerNoBloco(i, { tamanho: t }))}
                        {/* ── LINHAS COM CORPO PRÓPRIO (CORPOS_DO_BLOCO) ──────────
                            Hoje só a faixa CONTÉM BEBIDA. Ela nasce em 2x porque
                            bebida esquecida volta como entrega refeita, e no corpo
                            do resto do papel a tarja se perdia na pilha de comandas
                            (NIK, 21/09/2026). Fica AQUI, ao lado do tamanho do
                            bloco, porque é a mesma pergunta: "que tamanho isto sai?"
                            — e não num menu separado que ninguém acha. */}
                        {(CORPOS_DO_BLOCO[bloco.tipo] || []).map((c) => (
                          <span key={c.chave} title={c.ajuda} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>{c.rotulo}</span>
                            {stepper(corpoDoBloco(bloco, c.chave), (t) =>
                              mexerNoBloco(i, { corpos: { ...(bloco.corpos || {}), [c.chave]: t } }),
                            )}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* ── O DESFAZER DAS PALAVRAS TROCADAS ──────────────────
                        A troca acontece no papel, mas o desfazer não pode
                        depender de o lojista lembrar EM QUAL linha ele mexeu —
                        e uma palavra trocada por engano some justamente onde
                        ninguém procura. Aqui o card diz o que mudou e devolve
                        tudo ao de fábrica de uma vez. */}
                    {(() => {
                      const doBloco = ROTULOS_DO_BLOCO[bloco.tipo] || [];
                      const trocadas = doBloco.filter((r) => rotuloDoBloco(bloco, r.chave) !== r.padrao);
                      const marcadas = doBloco.filter((r) => negritoDoBloco(bloco, r.chave) !== (r.negritoPadrao === true));
                      if (!trocadas.length && !marcadas.length) return null;
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: "0.72rem", color: "#0F172A", fontWeight: 700 }}>
                            {trocadas.length > 0 && <>Suas palavras: {trocadas.map((r) => `"${rotuloDoBloco(bloco, r.chave)}"`).join(", ")}</>}
                            {trocadas.length > 0 && marcadas.length > 0 && " · "}
                            {marcadas.length > 0 && (
                              <>Negrito: {marcadas.map((r) => `${negritoDoBloco(bloco, r.chave) ? "" : "sem "}${rotuloDoBloco(bloco, r.chave)}`).join(", ")}</>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => mexerNoBloco(i, { rotulos: undefined, negritos: undefined })}
                            style={{ ...mini, width: "auto", padding: "0 7px" }}
                            title="Devolve as palavras e os negritos desta seção ao padrão de fábrica"
                          >
                            voltar ao padrão
                          </button>
                        </div>
                      );
                    })()}

                    {/* A única opção que uma seção tem: a linha da taxa.
                        Fica dentro do bloco dos valores porque é lá que ela
                        sai — procurar isso numa aba de configuração separada
                        seria adivinhação. */}
                    {bloco.tipo === "totais" && (
                      <label style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!bloco.ocultarTaxaEntrega}
                          onChange={(e) => mexerNoBloco(i, { ocultarTaxaEntrega: e.target.checked })}
                          style={{ marginTop: 2, width: 15, height: 15, accentColor: VERMELHO, cursor: "pointer", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: "0.78rem", color: "#334155", lineHeight: 1.4 }}>
                          <b>Não imprimir a linha da taxa de entrega.</b>{" "}
                          <span style={{ color: "#64748B" }}>O total continua o mesmo — some a linha, não o dinheiro.</span>
                        </span>
                      </label>
                    )}

                    {bloco.tipo === "textoLivre" && (
                      <>
                        <textarea
                          value={bloco.texto ?? ""}
                          onChange={(e) => mexerNoBloco(i, { texto: e.target.value })}
                          rows={2}
                          placeholder="Ex.: Obrigado, {cliente}! Volte sempre."
                          style={{ width: "100%", marginTop: 7, padding: "7px 9px", borderRadius: 8, border: BORDA, fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.8rem", resize: "vertical" }}
                        />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {CAMPOS_DISPONIVEIS.map((c) => (
                            <button
                              key={c.chave}
                              type="button"
                              title={`Insere ${c.rotulo.toLowerCase()} aqui`}
                              onClick={() => mexerNoBloco(i, { texto: `${bloco.texto || ""}{${c.chave}}` })}
                              style={{ border: "1px dashed #CBD5E1", background: "transparent", color: "#64748B", borderRadius: 6, padding: "2px 7px", fontSize: "0.7rem", fontFamily: "ui-monospace, Consolas, monospace", cursor: "pointer" }}
                            >
                              {`{${c.chave}}`}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* ── TEXTO COM VARIÁVEIS ────────────────────────────

                        Uma linha por vez, e cada pedaço da linha é OU texto
                        fixo OU um campo com o seu rótulo colado. É essa
                        colagem que faz "Ref: {endereço}" sumir inteiro num
                        pedido sem endereço, em vez de imprimir "Ref:" órfão
                        — que é o que o texto livre faz hoje. */}
                    {bloco.tipo === "textoRico" && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                        {(bloco.linhas || []).map((ln, li) => (
                          <div key={li} style={{ border: BORDA, borderRadius: 10, padding: "8px 9px", background: "#FAFAFA" }}>
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                              <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8" }}>LINHA {li + 1}</span>
                              <div style={{ flex: 1 }} />
                              <button type="button" title="Negrito" onClick={() => mexerNaLinha(i, li, { negrito: !ln.negrito })}
                                style={{ ...botao(!!ln.negrito), padding: "3px 9px", fontSize: "0.72rem", fontWeight: 900 }}>N</button>
                              {/* Tarja preta: o destaque que negrito não dá num papel térmico cheio de texto. */}
                              <button type="button" title="Marcar de preto (fundo preto, letra branca)" onClick={() => mexerNaLinha(i, li, { invertido: !ln.invertido })}
                                style={{ ...botao(!!ln.invertido), padding: "3px 9px", fontSize: "0.72rem", fontWeight: 900 }}>⬛</button>
                              {TAMANHOS.map((t) => (
                                <button key={t} type="button" title={`Tamanho ${t}x`} onClick={() => mexerNaLinha(i, li, { tamanho: t })}
                                  style={{ ...botao((ln.tamanho || 1) === t), padding: "3px 8px", fontSize: "0.72rem" }}>{t}x</button>
                              ))}
                              {(["esquerda", "centro", "direita"] as const).map((a) => (
                                <button key={a} type="button" title={a} onClick={() => mexerNaLinha(i, li, { alinhamento: a })}
                                  style={{ ...botao((ln.alinhamento || "esquerda") === a), padding: "3px 8px", fontSize: "0.72rem" }}>
                                  {a === "esquerda" ? "⬅" : a === "centro" ? "↔" : "➡"}
                                </button>
                              ))}
                              <button type="button" title="Apagar esta linha" onClick={() => mexerNoBloco(i, { linhas: (bloco.linhas || []).filter((_, k) => k !== li) })}
                                style={{ border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B71C1C", borderRadius: 6, padding: "3px 8px", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                            </div>

                            {(ln.partes || []).map((parte, pi) => (
                              <div key={pi} style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}>
                                <input
                                  value={parte.texto ?? ""}
                                  onChange={(e) => mexerNaParte(i, li, pi, { texto: e.target.value })}
                                  placeholder={parte.campo ? "rótulo (some junto)" : "texto fixo"}
                                  style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 7, border: BORDA, fontSize: "0.78rem", fontFamily: "inherit" }}
                                />
                                <select
                                  value={parte.campo ?? ""}
                                  onChange={(e) => mexerNaParte(i, li, pi, { campo: e.target.value || undefined })}
                                  style={{ padding: "5px 6px", borderRadius: 7, border: BORDA, fontSize: "0.74rem", fontFamily: "inherit", maxWidth: 170 }}
                                >
                                  <option value="">— só texto —</option>
                                  {CAMPOS_DISPONIVEIS.map((c) => (<option key={c.chave} value={c.chave}>{c.rotulo}</option>))}
                                </select>
                                <button type="button" title="Apagar este pedaço" onClick={() => mexerNaLinha(i, li, { partes: (ln.partes || []).filter((_, k) => k !== pi) })}
                                  style={{ border: "1px solid #E2E8F0", background: "#fff", color: "#94A3B8", borderRadius: 6, padding: "3px 7px", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                              </div>
                            ))}

                            <button type="button" onClick={() => mexerNaLinha(i, li, { partes: [...(ln.partes || []), { texto: "" }] })}
                              style={{ border: "1px dashed #CBD5E1", background: "transparent", color: "#64748B", borderRadius: 6, padding: "3px 9px", fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", marginTop: 2 }}>
                              + pedaço
                            </button>
                          </div>
                        ))}

                        <button type="button" onClick={() => mexerNoBloco(i, { linhas: [...(bloco.linhas || []), { partes: [{ texto: "" }] }] })}
                          style={{ ...botao(false), alignSelf: "flex-start", padding: "5px 11px", fontSize: "0.78rem" }}>
                          + Linha
                        </button>

                        <p style={{ fontSize: "0.73rem", color: "#64748B", margin: 0, lineHeight: 1.45 }}>
                          O <strong>rótulo</strong> só sai quando o campo tem valor. Escreva
                          <code style={{ background: "#F1F5F9", padding: "0 4px", borderRadius: 4 }}>Ref: </code>
                          no rótulo e escolha o campo ao lado: pedido sem aquele dado não imprime a linha.
                        </p>
                      </div>
                    )}

                    {formatavel && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, alignItems: "center" }}>
                        <button type="button" onClick={() => mexerNoBloco(i, { negrito: !bloco.negrito })} style={chip(!!bloco.negrito)}>
                          <b>N</b> negrito
                        </button>
                        <button type="button" title="Fundo preto com letra branca, na largura inteira" onClick={() => mexerNoBloco(i, { invertido: !bloco.invertido })} style={chip(!!bloco.invertido)}>
                          ⬛ marcado de preto
                        </button>
                        {stepper(tamanhoValido(bloco.tamanho), (t) => mexerNoBloco(i, { tamanho: t }))}
                        {(["esquerda", "centro", "direita"] as Alinhamento[]).map((a) => (
                          <button
                            key={a}
                            type="button"
                            title={`Alinhar à ${a}`}
                            onClick={() => mexerNoBloco(i, { alinhamento: a })}
                            style={chip((bloco.alinhamento || "esquerda") === a)}
                          >
                            {a === "esquerda" ? "⇤" : a === "centro" ? "↔" : "⇥"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", flexShrink: 0 }}>
                    <input
                      type="checkbox"
                      checked={bloco.ligado}
                      disabled={fixo}
                      title={fixo ? "Este bloco não pode ser desligado" : bloco.ligado ? "Não imprimir este bloco" : "Voltar a imprimir este bloco"}
                      onChange={(e) => mexerNoBloco(i, { ligado: e.target.checked })}
                      style={{ width: 17, height: 17, accentColor: VERMELHO, cursor: fixo ? "not-allowed" : "pointer" }}
                    />
                    <button type="button" title="Subir" onClick={() => mover(i, i - 1)} style={mini}>▲</button>
                    <button type="button" title="Descer" onClick={() => mover(i, i + 1)} style={mini}>▼</button>
                    {!fixo && (
                      <button type="button" title="Tirar da comanda" onClick={() => trocar(lista.filter((_, j) => j !== i))} style={mini}>✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" onClick={() => setMenuAberto((v) => !v)} style={botao(false)}>
              {menuAberto ? "Fechar" : "+ Adicionar bloco"}
            </button>
            <button
              type="button"
              onClick={() => { if (confirm("Voltar esta via ao modelo padrão do FireHub?")) onChange({ ...atual, [via]: modeloPadrao()[via] }); }}
              style={botao(false)}
            >
              Restaurar o padrão
            </button>
          </div>

          {menuAberto && (
            <div style={{ marginTop: 10, border: BORDA, borderRadius: 10, overflow: "hidden" }}>
              {(Object.keys(NOME_DO_BLOCO) as TipoDeBloco[]).map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => {
                    const novo: Bloco = { tipo, ligado: true };
                    if (tipo === "textoLivre") { novo.texto = "Obrigado pela preferência!"; novo.alinhamento = "centro"; }
                    trocar([...lista, novo]);
                    setMenuAberto(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #F1F5F9", background: "#fff", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.83rem", color: "#0F172A" }}>{NOME_DO_BLOCO[tipo]}</span>
                  <span style={{ display: "block", fontSize: "0.73rem", color: "#64748B", marginTop: 1 }}>{AJUDA_DO_BLOCO[tipo]}</span>
                </button>
              ))}
            </div>
          )}
          </div>
        </div>

        {/* ── O papel ──────────────────────────────────────────────────── */}
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ ...rotuloStyle, marginBottom: 6 }}>
            COMO VAI SAIR — {String(paperWidth).startsWith("58") ? "58 MM" : "80 MM"} · {colunas} COLUNAS
          </div>
          <div style={{ overflowX: "auto", background: "#F1F5F9", borderRadius: 12, padding: 12, display: "flex", justifyContent: "center" }}>
            {papel.length === 0 ? (
              <div style={{ color: "#94A3B8", fontSize: "0.85rem", padding: 12 }}>(nenhum bloco ligado)</div>
            ) : (
              <PapelDaComanda
                linhas={papel}
                pontos={geometria.pontos}
                celula={geometria.celula}
                escala={Math.min(0.85, 420 / geometria.pontos)}
                acoes={acoes}
                onClicarLinha={clicarLinha}
                linhaEmEdicao={edicao ? linhaEmEdicao : null}
                renderizarEdicao={() => edicao && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", width: "100%" }}>
                    <input
                      ref={campoRef}
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      onBlur={confirmarEdicao}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); confirmarEdicao(); }
                        if (e.key === "Escape") { e.preventDefault(); setEdicao(null); setLinhaEmEdicao(null); }
                      }}
                      maxLength={60}
                      style={{
                        font: "inherit", fontSize: "0.85rem", fontWeight: 700, flex: 1, minWidth: 0,
                        border: "none", borderBottom: `2px solid ${VERMELHO}`, background: "#FFF7E6",
                        color: "#1A1512", padding: "3px 4px", outline: "none", borderRadius: 2,
                      }}
                    />
                    {/* ── O NEGRITO FICA ONDE A PALAVRA ESTÁ ──────────────
                        Pedido do dono (19/09/2026): "forma de pagamento e
                        qualquer outra palavra tem que poder marcar em
                        negrito". `onMouseDown` com preventDefault: o clique não
                        pode tirar o foco do campo, senão o blur fecha a edição
                        antes de o botão ser ouvido. */}
                    {edicao.rotulo !== "@titulo" && (
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); alternarNegrito(edicao.bloco, edicao.rotulo); }}
                        title={negritoDoBloco(lista[edicao.bloco], edicao.rotulo) ? "Tirar o negrito desta linha" : "Deixar esta linha em negrito"}
                        style={{
                          fontFamily: "inherit", fontSize: "0.7rem", fontWeight: 900,
                          width: 22, height: 20, lineHeight: 1, padding: 0, borderRadius: 5, cursor: "pointer",
                          border: `1.5px solid ${negritoDoBloco(lista[edicao.bloco], edicao.rotulo) ? VERMELHO : "#CBD5E1"}`,
                          background: negritoDoBloco(lista[edicao.bloco], edicao.rotulo) ? VERMELHO : "#fff",
                          color: negritoDoBloco(lista[edicao.bloco], edicao.rotulo) ? "#fff" : "#64748B",
                          flexShrink: 0,
                        }}
                      >
                        N
                      </button>
                    )}
                  </span>
                )}
              />
            )}
          </div>
          <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "8px 2px 0", lineHeight: 1.5 }}>
            Pedido de exemplo, desenhado pelo mesmo programa que imprime, na largura da impressora escolhida.
            Clique numa palavra com tracejado para trocá-la, num aviso para ligar ou desligar.
            Os itens e os valores vêm do pedido de verdade na hora de imprimir.
          </p>
        </div>
      </div>

      {/* Em tela estreita a prévia vai para baixo da lista, em vez de espremer as duas. */}
      <style>{`
        @media (max-width: 900px) { .comanda-grade { grid-template-columns: 1fr !important; } }
        .linha-do-papel:hover { background: #FFF7E6; }
      `}</style>
    </div>
  );
}

/* ─── Peças de interface ─────────────────────────────────────── */

const rotuloStyle: React.CSSProperties = {
  fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8",
  letterSpacing: "0.06em", display: "block", marginBottom: 5,
};

const mini: React.CSSProperties = {
  border: BORDA, background: "#fff", color: "#64748B", borderRadius: 6,
  width: 24, height: 20, fontSize: "0.68rem", lineHeight: 1, cursor: "pointer", padding: 0, fontFamily: "inherit",
};

function botao(ativo: boolean): React.CSSProperties {
  return {
    padding: "7px 13px", borderRadius: 9,
    border: `1.5px solid ${ativo ? VERMELHO : "#E2E8F0"}`,
    background: ativo ? "#C6282810" : "#fff",
    color: ativo ? VERMELHO : "#64748B",
    fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
  };
}

function chip(ativo: boolean): React.CSSProperties {
  return {
    border: `1px solid ${ativo ? VERMELHO : "#E2E8F0"}`,
    background: ativo ? VERMELHO : "#F8FAFC",
    color: ativo ? "#fff" : "#64748B",
    borderRadius: 7, padding: "3px 8px", fontSize: "0.72rem",
    fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };
}

/**
 * O controle de tamanho da letra.
 *
 * Anda pela escada 1 / 1,5 / 2 / 3 em vez de aceitar número livre: são os
 * únicos degraus que a impressora térmica consegue de verdade (ver o comentário
 * de `Tamanho` em lib/comanda-modelo.ts). Deixar digitar 2,5 seria prometer o
 * que o papel não entrega.
 */
function stepper(valor: number, aoMudar: (t: (typeof TAMANHOS)[number]) => void) {
  const i = TAMANHOS.indexOf(valor as (typeof TAMANHOS)[number]);
  const passo: React.CSSProperties = {
    border: "none", background: "transparent", color: "#64748B",
    cursor: "pointer", padding: "0 3px", fontWeight: 800, fontSize: "0.8rem", lineHeight: 1, fontFamily: "inherit",
  };
  return (
    <span
      title="Tamanho da letra. A impressora só consegue estes degraus: 1x, 1,5x, 2x e 3x — quanto maior, menos letras cabem na linha."
      style={{ display: "inline-flex", alignItems: "center", gap: 4, border: BORDA, background: "#F8FAFC", borderRadius: 7, padding: "2px 6px" }}
    >
      <button type="button" onClick={() => aoMudar(TAMANHOS[Math.max(0, i - 1)])} style={passo}>A−</button>
      <b style={{ fontSize: "0.72rem", fontFamily: "ui-monospace, Consolas, monospace", minWidth: "2.4em", textAlign: "center", color: "#0F172A" }}>
        {String(valor).replace(".", ",")}×
      </b>
      <button type="button" onClick={() => aoMudar(TAMANHOS[Math.min(TAMANHOS.length - 1, i + 1)])} style={passo}>A+</button>
    </span>
  );
}
