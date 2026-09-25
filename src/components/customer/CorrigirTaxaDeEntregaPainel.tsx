"use client";
import { useState } from "react";
import { avaliarEdicao, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { FORMAS_DE_PAGAMENTO_NA_ENTREGA, formaCanonica } from "@/lib/pagamento-na-entrega";
import { quantoFalta, somarPartes, type ParteDoPagamento } from "@/lib/pagamento-dividido";

/**
 * "Corrigir taxa de entrega" — no modal Ver pedido do painel, ao lado da troca
 * de pagamento. É a tela da rota /api/store/orders/[id]/taxa-de-entrega.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 25/09/2026 a Divinos Burger (modo ROTA) cobrou R$ 12 — a faixa mais cara
 * — de quatro clientes a 0,5–0,9 km, porque o mapa não achou o endereço na
 * hora do pedido. A mensagem dizia "a loja confirma a entrega", mas não havia
 * onde a loja confirmar nada: a edição de itens mantém a taxa, e o total, o
 * relatório e o acerto do motoboy ficavam com o valor errado para sempre.
 *
 * ── O que a tela faz pela pessoa ────────────────────────────────────────────
 *
 * Abre com o que está gravado (taxa, total, distância, repasse), a tabela de
 * faixas da loja e a SUGESTÃO do servidor — a faixa que a distância gravada
 * paga. Um toque numa faixa preenche a taxa; quem mediu no mapa digita a
 * distância certa e a tela diz em que faixa ela cai. O MOTIVO é obrigatório:
 * é o contrapeso de mexer em dinheiro de pedido fechado, e vai para o rastro
 * e para a observação do pedido.
 *
 * Pedido pago DIVIDIDO: o servidor recusa (409 `precisaDividir`) gravar
 * partes que não fecham com o total novo — sobra fantasma no caixa. A tela já
 * pede a divisão nova quando sabe que o pedido é dividido, e também quando o
 * 409 chega (a divisão foi feita por outra tela enquanto esta estava aberta).
 * A diferença cai sozinha numa das formas; a pessoa confere, não calcula.
 *
 * Depois de salvar, o AVISO da resposta fica na tela até a pessoa dar OK:
 * "devolva R$ 7 ao cliente" não pode sumir num toast de 4 segundos.
 *
 * ── Quando o botão aparece ──────────────────────────────────────────────────
 *
 * Só pedido de ENTREGA, não cancelado, que a loja pode editar — a MESMA régua
 * da rota (`avaliarEdicao` + a lista de retirada), senão existiria botão que o
 * servidor recusa. Marketplace fica de fora: a taxa do iFood/99Food é dinheiro
 * do app e tem que continuar batendo com o repasse dele.
 */

/** Os tipos que a rota trata como retirada (api/store/orders/[id]/taxa-de-entrega, RETIRADA). */
const TIPOS_DE_RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA"];
/** Os tetos da rota: R$ 300 de taxa e 60 km de distância. */
const TETO_DA_TAXA = 300;
const TETO_DA_DISTANCIA_KM = 60;

export type FaixaDaTaxa = { km: number; taxa: number; repasse: number | null; tempoMin: number | null };

/** O GET da rota, já lido com defesa (número que não é número vira null). */
export type DadosDaTaxa = {
  deliveryFee: number;
  totalAmount: number;
  motoboyFee: number | null;
  deliveryDistance: number | null;
  separaRepasse: boolean;
  faixas: FaixaDaTaxa[];
  pagamentoDividido: ParteDoPagamento[];
  sugestao: FaixaDaTaxa | null;
};

/** O que volta para o painel depois de salvar: os campos do pedido, com o "antes" junto. */
export type ResultadoDaCorrecao = {
  semMudanca: boolean;
  deliveryFee: number;
  totalAmount: number;
  motoboyFee: number | null;
  deliveryDistance: number | null;
  paymentMethods?: ParteDoPagamento[];
  paymentMethod?: string;
  taxaAntes: number;
  totalAntes: number;
  /** O texto do rastro que o servidor gravou ("Taxa de entrega R$ 12,00 → R$ 5,00; ... — motivo: ..."). */
  descricao?: string;
  /** O que fazer com a diferença de dinheiro (api: avisoDaDiferencaDeTotal). */
  aviso?: string;
};

export type LinhaDaDivisao = { method: string; valor: string };

/** O que a pessoa já digitou — sobrevive à releitura quando o pedido muda no meio. */
export type RascunhoDaCorrecao = { taxaTexto?: string; distanciaTexto?: string; motivo?: string };

const centavos = (n: number) => Math.round(n * 100) / 100;
export const dinheiro = (v: number) => `R$ ${centavos(Number(v) || 0).toFixed(2).replace(".", ",")}`;
const kmNaTela = (n: number) => String(centavos(n)).replace(".", ",");
const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Mesma lista da rota: o que não é retirada é entrega (inclusive tipo vazio). */
export function pedidoDeEntrega(pedido: any): boolean {
  return !TIPOS_DE_RETIRADA.includes(String(pedido?.deliveryType || "").trim().toUpperCase());
}

/** O botão aparece? Entrega, não cancelado, e a edição COMPLETA (não marketplace, não mesa, com permissão). */
export function podeCorrigirTaxa(pedido: any, operador: OperadorDaEdicao): boolean {
  if (!pedido?.id || !pedidoDeEntrega(pedido)) return false;
  if ((STATUS_CANCELADOS as readonly string[]).includes(String(pedido.status || "").toUpperCase())) return false;
  return avaliarEdicao(pedido, operador).modo === "COMPLETO";
}

/**
 * "5", "5,50", "R$ 5.50" → número; vazio ou lixo → null. Aceita vírgula e
 * ponto porque o balcão digita dos dois jeitos; "1.234,56" não é taxa de
 * bairro e cai em null em vez de virar 1,23.
 */
export function lerNumero(texto: string): number | null {
  const limpo = String(texto ?? "").replace(/[^\d,.]/g, "").replace(",", ".");
  if (!limpo || limpo === "." || !/^\d*\.?\d*$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? centavos(n) : null;
}

/** A taxa digitada, se estiver na faixa que a rota aceita (R$ 0 a R$ 300). */
export function taxaValida(texto: string): number | null {
  const n = lerNumero(texto);
  return n != null && n >= 0 && n <= TETO_DA_TAXA ? n : null;
}

/** A distância digitada, se estiver na faixa que a rota aceita (0 a 60 km). */
export function distanciaValida(texto: string): number | null {
  const n = lerNumero(texto);
  return n != null && n >= 0 && n <= TETO_DA_DISTANCIA_KM ? n : null;
}

/**
 * O total depois: muda exatamente a diferença da taxa — a mesma conta de
 * `ajusteDaTaxa` (lib/entrega-do-pedido.ts), que não dá para importar aqui
 * (a lib puxa a assinatura da cotação, que usa `crypto` do Node). É só a
 * prévia: quem grava é o servidor, e a tela mostra o que ele devolveu.
 */
export function totalComTaxaNova(totalAntes: number, taxaAntes: number, taxaNova: number): number {
  return centavos(Math.max(0, (Number(totalAntes) || 0) - (Number(taxaAntes) || 0) + (Number(taxaNova) || 0)));
}

/**
 * A faixa em que uma distância DIGITADA cai — a regra R5 de
 * `faixaDaDistancia` (lib/entrega-do-pedido.ts), sobre as faixas que o GET
 * já devolveu em ordem: limite inclusivo, folga de 50 m só na última, acima
 * disso nenhuma.
 */
export function faixaDaDistanciaNaTela(faixas: FaixaDaTaxa[], km: number | null): FaixaDaTaxa | null {
  if (km == null || !faixas.length) return null;
  const d = centavos(km);
  const faixa = faixas.find((f) => d <= f.km);
  if (faixa) return faixa;
  const ultima = faixas[faixas.length - 1];
  return d <= centavos(ultima.km + 0.05) ? ultima : null;
}

function lerFaixa(f: any): FaixaDaTaxa | null {
  const km = numeroOuNulo(f?.km);
  const taxa = numeroOuNulo(f?.taxa);
  if (km == null || km <= 0 || taxa == null) return null;
  return { km, taxa, repasse: numeroOuNulo(f?.repasse), tempoMin: numeroOuNulo(f?.tempoMin) };
}

function lerPartesDaResposta(bruto: unknown): ParteDoPagamento[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((p: any) => ({ method: String(p?.method ?? "").trim(), amount: centavos(Number(p?.amount) || 0) }))
    .filter((p) => p.method && p.amount > 0);
}

/** O corpo do GET → `DadosDaTaxa`, sem confiar em tipo nenhum. */
export function lerDadosDaTaxa(data: any): DadosDaTaxa {
  const faixas = (Array.isArray(data?.faixas) ? data.faixas : [])
    .map(lerFaixa)
    .filter((f: FaixaDaTaxa | null): f is FaixaDaTaxa => f != null)
    .sort((a: FaixaDaTaxa, b: FaixaDaTaxa) => a.km - b.km);
  return {
    deliveryFee: centavos(numeroOuNulo(data?.deliveryFee) ?? 0),
    totalAmount: centavos(numeroOuNulo(data?.totalAmount) ?? 0),
    motoboyFee: numeroOuNulo(data?.motoboyFee),
    deliveryDistance: numeroOuNulo(data?.deliveryDistance),
    separaRepasse: data?.separaRepasse === true,
    faixas,
    pagamentoDividido: lerPartesDaResposta(data?.pagamentoDividido),
    sugestao: data?.sugestao ? lerFaixa(data.sugestao) : null,
  };
}

/**
 * A divisão nova, já preenchida: as partes gravadas com a DIFERENÇA do total
 * na última forma (ou na maior, se a última não comporta). Pix 20 + Dinheiro
 * 22 com a taxa de 12 → 5 vira Pix 20 + Dinheiro 15: a pessoa confere com o
 * cliente e ajusta, nunca faz a conta de cabeça — a mesma ideia da troca de
 * pagamento (TrocaDePagamentoPainel).
 */
export function divisaoInicial(partes: ParteDoPagamento[], totalDepois: number): LinhaDaDivisao[] {
  if (!partes.length) return [];
  const valores = partes.map((p) => Math.round((Number(p.amount) || 0) * 100));
  const diferenca = Math.round((Number(totalDepois) || 0) * 100) - valores.reduce((s, v) => s + v, 0);
  if (diferenca !== 0) {
    let i = valores.length - 1;
    if (valores[i] + diferenca <= 0) i = valores.indexOf(Math.max(...valores));
    if (valores[i] + diferenca > 0) valores[i] += diferenca;
  }
  return partes.map((p, i) => ({
    // A forma gravada no formato do seletor: "Crédito" do balcão antigo vira
    // "Cartão Crédito"; o servidor recusa forma fora da lista.
    method: formaCanonica(p.method) || "",
    valor: (valores[i] / 100).toFixed(2).replace(".", ","),
  }));
}

/** As linhas que valem (forma escolhida e valor > 0), no formato do PATCH. */
export function partesDaDivisao(linhas: LinhaDaDivisao[]): ParteDoPagamento[] {
  return linhas
    .map((l) => ({ method: l.method, amount: lerNumero(l.valor) ?? 0 }))
    .filter((p) => p.method && p.amount > 0);
}

/** A divisão fecha com o total? Duas formas no mínimo e 2 centavos de tolerância (a do servidor). */
export function divisaoFecha(linhas: LinhaDaDivisao[], total: number): boolean {
  const partes = partesDaDivisao(linhas);
  return partes.length >= 2 && Math.abs(quantoFalta(partes, total)) <= 0.02;
}

export type CorpoDaCorrecao = {
  taxa: number;
  motivo: string;
  distanciaKm?: number;
  repassePelaTaxa?: boolean;
  paymentMethods?: ParteDoPagamento[];
};

export type RespostaDaCorrecao =
  | { tipo: "ok"; dados: any }
  /** 409 (ou 400 da validação) `precisaDividir`: pedir a divisão nova. `partes` só vem no 409. */
  | { tipo: "dividir"; erro: string; totalDepois: number | null; partes: ParteDoPagamento[] | null }
  /** `mudou`: o pedido foi mexido por outra tela no meio — reler antes de tentar de novo. */
  | { tipo: "erro"; erro: string; mudou: boolean };

/** O PATCH, com as respostas da rota já separadas no que a tela faz com cada uma. */
export async function enviarCorrecao(
  pedidoId: string,
  corpo: CorpoDaCorrecao,
  buscar: typeof fetch = fetch,
): Promise<RespostaDaCorrecao> {
  try {
    const res = await buscar(`/api/store/orders/${encodeURIComponent(pedidoId)}/taxa-de-entrega`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok) return { tipo: "ok", dados: data };
    if (data?.precisaDividir) {
      return {
        tipo: "dividir",
        erro: data.error || "Este pedido foi pago dividido: informe como fica a divisão com o total novo.",
        totalDepois: numeroOuNulo(data.totalDepois),
        partes: Array.isArray(data.pagamentoDividido) ? lerPartesDaResposta(data.pagamentoDividido) : null,
      };
    }
    return {
      tipo: "erro",
      erro: data?.error || `Erro ${res.status} ao corrigir a taxa.`,
      // O único 409 sem `precisaDividir` é a trava de concorrência da rota.
      mudou: res.status === 409,
    };
  } catch {
    return { tipo: "erro", erro: "Sem conexão. Tente de novo.", mudou: false };
  }
}

/* ── Estilo: o mesmo das caixas do modal (TrocaDePagamentoPainel) ─────── */
const caixa: React.CSSProperties = {
  marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
};
const caixaAberta: React.CSSProperties = { ...caixa, background: "#F0FDFA", border: "1.5px solid #99F6E4" };
const botaoLeve: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0",
  background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit",
};
const campo: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 8, border: "1.5px solid #99F6E4", fontFamily: "inherit", fontSize: "0.8rem",
  background: "#FFF", color: "#0F172A", boxSizing: "border-box",
};
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.74rem", fontWeight: 800, color: "#115E59", marginBottom: 4 };
const chip = (ativa: boolean): React.CSSProperties => ({
  padding: "5px 9px", borderRadius: 8, fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${ativa ? "#0F766E" : "#CCFBF1"}`, background: ativa ? "#CCFBF1" : "#FFF", color: ativa ? "#134E4A" : "#334155",
});

/** Os motivos que mais acontecem — um toque escreve, a pessoa completa. */
const MOTIVOS_RAPIDOS = [
  "O mapa não achou o endereço",
  "Conferi a distância no mapa",
  "Cortesia para o cliente",
];

export default function CorrigirTaxaDeEntregaPainel({
  pedido,
  operador,
  aoSalvar,
}: {
  pedido: any;
  operador: OperadorDaEdicao;
  /** Chamado só quando algo mudou: o painel atualiza o pedido na lista. */
  aoSalvar: (resultado: ResultadoDaCorrecao) => void | Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<DadosDaTaxa | null>(null);
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  /** Recado de quando os valores foram relidos no meio (o pedido mudou). */
  const [recado, setRecado] = useState<string | null>(null);
  /** Remonta o formulário a cada leitura: valores relidos não convivem com a conta velha. */
  const [versao, setVersao] = useState(0);
  const [resultado, setResultado] = useState<ResultadoDaCorrecao | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoDaCorrecao | null>(null);

  if (!podeCorrigirTaxa(pedido, operador)) return null;

  const ler = async (recadoNovo: string | null = null, digitado: RascunhoDaCorrecao | null = null) => {
    setCarregando(true);
    setErroDaLeitura(null);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(pedido.id)}/taxa-de-entrega`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDados(null);
        setErroDaLeitura(data?.error || `Erro ${res.status} ao ler a taxa do pedido.`);
        return;
      }
      setDados(lerDadosDaTaxa(data));
      setRascunho(digitado);
      setVersao((v) => v + 1);
      setRecado(recadoNovo);
    } catch {
      setErroDaLeitura("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  };

  const abrir = () => {
    setAberto(true);
    setResultado(null);
    setRecado(null);
    setRascunho(null);
    // Os dados da abertura anterior são de ANTES da correção que acabou de
    // ser gravada: a tela espera a leitura nova em vez de mostrá-los.
    setDados(null);
    void ler();
  };
  const fechar = () => {
    setAberto(false);
    setErroDaLeitura(null);
    setRecado(null);
  };

  const taxaAtual = Number(pedido?.deliveryFee) || 0;

  if (!aberto) {
    return (
      <>
        <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "#334155" }}>
            🛵 <b>Taxa de entrega:</b> {dinheiro(taxaAtual)}
          </span>
          <button type="button" onClick={abrir} style={botaoLeve}>
            Corrigir taxa de entrega
          </button>
        </div>
        {resultado && <CaixaDoResultado resultado={resultado} aoFechar={() => setResultado(null)} />}
      </>
    );
  }

  if (carregando && !dados) {
    return <div style={{ ...caixaAberta, fontSize: "0.78rem", color: "#115E59" }}>Lendo a taxa e as faixas da loja…</div>;
  }

  if (!dados) {
    return (
      <div style={caixaAberta}>
        <div style={{ fontSize: "0.78rem", color: "#B71C1C", fontWeight: 700, marginBottom: 8 }}>
          {erroDaLeitura || "Não consegui ler a taxa do pedido."}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button type="button" onClick={fechar} style={botaoLeve}>Fechar</button>
          <button type="button" onClick={() => void ler()} style={botaoLeve}>Tentar de novo</button>
        </div>
      </div>
    );
  }

  return (
    <FormularioDaTaxa
      key={versao}
      pedidoId={pedido.id}
      dados={dados}
      // Releitura que falhou (sem conexão) deixa o formulário de pé com os
      // valores antigos: o erro aparece no lugar do recado.
      recado={erroDaLeitura || recado}
      inicial={rascunho}
      aoCancelar={fechar}
      aoPedidoMudou={(msg, digitado) => void ler(msg, digitado)}
      aoConcluir={async (r) => {
        setAberto(false);
        setResultado(r);
        if (!r.semMudanca) await aoSalvar(r);
      }}
    />
  );
}

/** O que foi gravado e o que fazer com a diferença — fica até a pessoa dar OK. */
function CaixaDoResultado({ resultado, aoFechar }: { resultado: ResultadoDaCorrecao; aoFechar: () => void }) {
  if (resultado.semMudanca) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "0.76rem", color: "#334155" }}>Nada mudou: a taxa, a distância e o repasse já eram esses.</span>
        <button type="button" onClick={aoFechar} style={botaoLeve}>OK</button>
      </div>
    );
  }
  return (
    <div role="status" style={{ ...caixa, background: "#F0FDF4", border: "1.5px solid #86EFAC" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#166534", marginBottom: 4 }}>
        ✓ Taxa corrigida: {dinheiro(resultado.taxaAntes)} → {dinheiro(resultado.deliveryFee)} · total {dinheiro(resultado.totalAntes)} → {dinheiro(resultado.totalAmount)}
      </div>
      {resultado.descricao && (
        <div style={{ fontSize: "0.72rem", color: "#166534", marginBottom: 4 }}>{resultado.descricao}</div>
      )}
      {resultado.aviso && (
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 8px", margin: "6px 0" }}>
          ⚠️ {resultado.aviso}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={aoFechar} style={botaoLeve}>OK</button>
      </div>
    </div>
  );
}

/**
 * O formulário, com os dados do GET já lidos. Separado do botão para poder
 * ser remontado (key) quando os valores são relidos, e para o teste o
 * renderizar sem rede (scripts/teste-corrigir-taxa-de-entrega.tsx).
 */
export function FormularioDaTaxa({
  pedidoId,
  dados,
  recado,
  inicial,
  aoCancelar,
  aoConcluir,
  aoPedidoMudou,
  enviar = enviarCorrecao,
}: {
  pedidoId: string;
  dados: DadosDaTaxa;
  recado?: string | null;
  /** O que a pessoa tinha digitado antes da releitura (a conta é refeita com os valores novos). */
  inicial?: RascunhoDaCorrecao | null;
  aoCancelar: () => void;
  aoConcluir: (r: ResultadoDaCorrecao) => void | Promise<void>;
  aoPedidoMudou: (mensagem: string, digitado: RascunhoDaCorrecao) => void;
  enviar?: typeof enviarCorrecao;
}) {
  const [taxaTexto, setTaxaTexto] = useState(inicial?.taxaTexto ?? "");
  const [distanciaTexto, setDistanciaTexto] = useState(inicial?.distanciaTexto ?? "");
  const [repassePelaTaxa, setRepassePelaTaxa] = useState(false);
  const [motivo, setMotivo] = useState(inicial?.motivo ?? "");
  /** As partes gravadas: as do GET, ou as que o 409 trouxe. */
  const [partesGravadas, setPartesGravadas] = useState<ParteDoPagamento[]>(dados.pagamentoDividido);
  /** Enquanto a pessoa não mexe, a divisão acompanha a taxa digitada. */
  const [linhasEditadas, setLinhasEditadas] = useState<LinhaDaDivisao[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const taxaAntes = dados.deliveryFee;
  const totalAntes = dados.totalAmount;
  const taxaNova = taxaValida(taxaTexto);
  const totalDepois = taxaNova != null ? totalComTaxaNova(totalAntes, taxaAntes, taxaNova) : totalAntes;
  const totalMuda = Math.round(totalDepois * 100) !== Math.round(totalAntes * 100);

  const distanciaDigitada = distanciaTexto.trim() !== "";
  const distanciaNova = distanciaDigitada ? distanciaValida(distanciaTexto) : null;
  const faixaDaDistanciaNova = faixaDaDistanciaNaTela(dados.faixas, distanciaNova);

  // "A medida gravada estava errada" só faz sentido quando a loja separa o
  // repasse, há distância gravada e nenhuma nova foi digitada — com distância
  // nova o repasse já segue a faixa dela (ajusteDaTaxa, ordem 1).
  const mostraRepassePelaTaxa = dados.separaRepasse && dados.deliveryDistance != null && !distanciaDigitada;

  const precisaDividir = partesGravadas.length > 0 && taxaNova != null && totalMuda;
  const linhas = linhasEditadas ?? divisaoInicial(partesGravadas, totalDepois);
  const partesValidas = partesDaDivisao(linhas);
  const falta = quantoFalta(partesValidas, totalDepois);
  const fecha = divisaoFecha(linhas, totalDepois);

  const motivoOk = motivo.replace(/\s+/g, " ").trim().length >= 3;
  const podeSalvar =
    !salvando && taxaNova != null && motivoOk && (!distanciaDigitada || distanciaNova != null) && (!precisaDividir || fecha);

  const mexerNaLinha = (i: number, mudanca: Partial<LinhaDaDivisao>) =>
    setLinhasEditadas(linhas.map((l, j) => (j === i ? { ...l, ...mudanca } : l)));

  const usarMotivo = (texto: string) =>
    setMotivo((antes) => {
      const t = antes.trim();
      if (!t) return texto;
      return t.includes(texto) ? t : `${t}; ${texto}`;
    });

  const digitado: RascunhoDaCorrecao = { taxaTexto, distanciaTexto, motivo };

  const salvar = async () => {
    if (!podeSalvar || taxaNova == null) return;
    setSalvando(true);
    setErro(null);
    try {
      const corpo: CorpoDaCorrecao = { taxa: taxaNova, motivo: motivo.replace(/\s+/g, " ").trim() };
      if (distanciaNova != null) corpo.distanciaKm = distanciaNova;
      if (mostraRepassePelaTaxa && repassePelaTaxa) corpo.repassePelaTaxa = true;
      if (precisaDividir) corpo.paymentMethods = partesValidas;

      const r = await enviar(pedidoId, corpo);
      if (r.tipo === "ok") {
        const d = r.dados || {};
        const partes = lerPartesDaResposta(d.paymentMethods);
        await aoConcluir({
          semMudanca: d.semMudanca === true,
          deliveryFee: centavos(numeroOuNulo(d.deliveryFee) ?? taxaNova),
          totalAmount: centavos(numeroOuNulo(d.totalAmount) ?? totalDepois),
          motoboyFee: numeroOuNulo(d.motoboyFee),
          deliveryDistance: numeroOuNulo(d.deliveryDistance),
          ...(partes.length ? { paymentMethods: partes, paymentMethod: String(d.paymentMethod || "") } : {}),
          taxaAntes,
          totalAntes,
          descricao: typeof d.registro?.descricao === "string" ? d.registro.descricao : undefined,
          aviso: typeof d.aviso === "string" && d.aviso ? d.aviso : undefined,
        });
        return;
      }
      if (r.tipo === "dividir") {
        // O total que o servidor calculou não é o desta tela: o pedido mudou
        // depois que a correção abriu. Reler — dividir em cima do total velho
        // seria gravar partes que não fecham.
        if (r.totalDepois != null && Math.round(r.totalDepois * 100) !== Math.round(totalDepois * 100)) {
          aoPedidoMudou("O total do pedido mudou desde que você abriu a correção. Os valores foram relidos: confira e salve de novo.", digitado);
          return;
        }
        // 409: o pedido é dividido e esta tela não sabia (a divisão foi feita
        // em outra tela). A divisão nova já vem preenchida a partir das
        // partes que o servidor mandou. 400 da validação: mantém o que a
        // pessoa digitou e mostra o que não fechou.
        if (r.partes && r.partes.length) {
          setPartesGravadas(r.partes);
          setLinhasEditadas(null);
        }
        setErro(r.erro);
        return;
      }
      if (r.mudou) {
        // A frase da rota manda "abrir o pedido de novo" — aqui a tela já relê
        // sozinha, então o recado diz o que aconteceu e o que falta fazer.
        aoPedidoMudou("O pedido mudou enquanto você corrigia a taxa (outra tela mexeu nele). Os valores foram relidos: confira e salve de novo.", digitado);
        return;
      }
      setErro(r.erro);
    } finally {
      setSalvando(false);
    }
  };

  const sugestao = dados.sugestao;
  const ultimaFaixa = dados.faixas.length ? dados.faixas[dados.faixas.length - 1] : null;

  return (
    <div style={caixaAberta}>
      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#115E59", marginBottom: 4 }}>🛵 Corrigir a taxa de entrega</div>

      {recado && (
        <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 8px", marginBottom: 8 }}>
          {recado}
        </div>
      )}

      {/* O que está gravado hoje — o ponto de partida da conversa com o cliente. */}
      <div style={{ fontSize: "0.74rem", color: "#334155", marginBottom: 8, lineHeight: 1.5 }}>
        No pedido: taxa <b>{dinheiro(taxaAntes)}</b> · total <b>{dinheiro(totalAntes)}</b> ·{" "}
        {dados.deliveryDistance != null ? <>distância <b>{kmNaTela(dados.deliveryDistance)} km</b></> : "sem distância gravada"}
        {dados.separaRepasse && (
          <> · repasse do motoboy <b>{dados.motoboyFee != null ? dinheiro(dados.motoboyFee) : "pelo acordo do entregador"}</b></>
        )}
      </div>

      {/* A sugestão do servidor: a faixa da distância gravada. */}
      {sugestao ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#FFF", border: "1px solid #CCFBF1", borderRadius: 8, padding: "6px 8px", marginBottom: 8 }}>
          <span style={{ fontSize: "0.76rem", color: "#134E4A" }}>
            {Math.round(sugestao.taxa * 100) === Math.round(taxaAntes * 100)
              ? <>A taxa gravada já é a da faixa da distância (até {kmNaTela(sugestao.km)} km).</>
              : <>Pela distância gravada ({kmNaTela(dados.deliveryDistance ?? 0)} km), a faixa é <b>até {kmNaTela(sugestao.km)} km: {dinheiro(sugestao.taxa)}</b>.</>}
          </span>
          {Math.round(sugestao.taxa * 100) !== Math.round(taxaAntes * 100) && (
            <button type="button" onClick={() => setTaxaTexto(sugestao.taxa.toFixed(2).replace(".", ","))} style={{ ...botaoLeve, borderColor: "#0F766E", color: "#0F766E" }}>
              Usar {dinheiro(sugestao.taxa)}
            </button>
          )}
        </div>
      ) : dados.faixas.length > 0 ? (
        <div style={{ fontSize: "0.74rem", color: "#92400E", marginBottom: 8 }}>
          {dados.deliveryDistance == null
            ? "Este pedido não tem distância gravada: confira o endereço no mapa e, se medir, informe a distância abaixo."
            : `A distância gravada (${kmNaTela(dados.deliveryDistance)} km) passa da última faixa (${kmNaTela(ultimaFaixa?.km ?? 0)} km).`}
        </div>
      ) : null}

      {/* As faixas da loja: um toque preenche a taxa. */}
      {dados.faixas.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span style={rotulo}>Faixas da loja</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {dados.faixas.map((f) => (
              <button
                key={f.km}
                type="button"
                onClick={() => setTaxaTexto(f.taxa.toFixed(2).replace(".", ","))}
                title={f.tempoMin ? `${f.tempoMin} min` : undefined}
                style={chip(taxaNova != null && Math.round(taxaNova * 100) === Math.round(f.taxa * 100))}
              >
                até {kmNaTela(f.km)} km · {dinheiro(f.taxa)}
                {dados.separaRepasse && f.repasse != null ? ` (motoboy ${dinheiro(f.repasse)})` : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ flex: "1 1 120px" }}>
          <span style={rotulo}>Taxa certa (R$)</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Taxa de entrega certa"
            value={taxaTexto}
            onChange={(e) => setTaxaTexto(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder={taxaAntes.toFixed(2).replace(".", ",")}
            style={{ ...campo, width: "100%", textAlign: "right" }}
          />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <span style={rotulo}>Distância certa (km) — se mediu</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Distância certa em km"
            value={distanciaTexto}
            onChange={(e) => setDistanciaTexto(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="opcional"
            style={{ ...campo, width: "100%", textAlign: "right" }}
          />
        </label>
      </div>

      {taxaTexto.trim() !== "" && taxaNova == null && (
        <div style={{ fontSize: "0.72rem", color: "#B71C1C", marginBottom: 6 }}>Taxa inválida: de R$ 0,00 a {dinheiro(TETO_DA_TAXA)}.</div>
      )}
      {distanciaDigitada && distanciaNova == null && (
        <div style={{ fontSize: "0.72rem", color: "#B71C1C", marginBottom: 6 }}>Distância inválida: de 0 a {TETO_DA_DISTANCIA_KM} km.</div>
      )}
      {distanciaNova != null && dados.faixas.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "0.74rem", color: "#134E4A", marginBottom: 8 }}>
          {faixaDaDistanciaNova ? (
            <>
              <span>{kmNaTela(distanciaNova)} km cai na faixa até {kmNaTela(faixaDaDistanciaNova.km)} km: <b>{dinheiro(faixaDaDistanciaNova.taxa)}</b>.</span>
              {(taxaNova == null || Math.round(taxaNova * 100) !== Math.round(faixaDaDistanciaNova.taxa * 100)) && (
                <button type="button" onClick={() => setTaxaTexto(faixaDaDistanciaNova.taxa.toFixed(2).replace(".", ","))} style={botaoLeve}>
                  Usar {dinheiro(faixaDaDistanciaNova.taxa)}
                </button>
              )}
            </>
          ) : (
            <span style={{ color: "#92400E" }}>{kmNaTela(distanciaNova)} km passa da última faixa ({kmNaTela(ultimaFaixa?.km ?? 0)} km).</span>
          )}
        </div>
      )}
      {dados.separaRepasse && distanciaNova != null && (
        <div style={{ fontSize: "0.7rem", color: "#475569", marginBottom: 8 }}>O repasse do motoboy passa a seguir a faixa desta distância.</div>
      )}

      {mostraRepassePelaTaxa && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: "0.74rem", color: "#334155", marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={repassePelaTaxa} onChange={(e) => setRepassePelaTaxa(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            A distância gravada ({kmNaTela(dados.deliveryDistance ?? 0)} km) estava errada: o repasse do motoboy segue a faixa da taxa nova.
            <span style={{ color: "#64748B" }}> Sem marcar, desconto de cortesia não mexe no repasse — o que o motoboy rodou não mudou.</span>
          </span>
        </label>
      )}

      <label style={{ display: "block", marginBottom: 6 }}>
        <span style={rotulo}>Motivo (obrigatório)</span>
        <input
          type="text"
          aria-label="Motivo da correção"
          value={motivo}
          maxLength={300}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder='ex.: cliente mora a 800 m, faixa de R$ 5'
          style={{ ...campo, width: "100%" }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
        {MOTIVOS_RAPIDOS.map((m) => (
          <button key={m} type="button" onClick={() => usarMotivo(m)} style={chip(false)}>
            {m}
          </button>
        ))}
      </div>

      {taxaNova != null && (
        <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#134E4A", marginBottom: 8 }}>
          Total do pedido: {dinheiro(totalAntes)} → {dinheiro(totalDepois)}
          {taxaNova === 0 && <span style={{ fontWeight: 600, color: "#475569" }}> (entrega grátis)</span>}
        </div>
      )}

      {/* ── Pago dividido: a divisão nova, que TEM de fechar com o total novo ── */}
      {precisaDividir && (
        <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
          <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#92400E", marginBottom: 6 }}>
            Pago dividido — como fica a divisão com o total de {dinheiro(totalDepois)}?
          </div>
          {linhas.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <select
                aria-label={`Forma de pagamento ${i + 1}`}
                value={l.method}
                onChange={(e) => mexerNaLinha(i, { method: e.target.value })}
                style={{ ...campo, flex: 1, border: "1.5px solid #FDE68A" }}
              >
                <option value="">Escolha a forma…</option>
                {FORMAS_DE_PAGAMENTO_NA_ENTREGA.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <span style={{ fontSize: "0.76rem", color: "#78350F" }}>R$</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Valor da forma ${i + 1}`}
                value={l.valor}
                onChange={(e) => mexerNaLinha(i, { valor: e.target.value.replace(/[^\d.,]/g, "") })}
                placeholder="0,00"
                style={{ ...campo, width: 84, textAlign: "right", border: "1.5px solid #FDE68A" }}
              />
              {linhas.length > 2 && (
                <button
                  type="button"
                  onClick={() => setLinhasEditadas(linhas.filter((_, j) => j !== i))}
                  title="Tirar esta forma"
                  style={{ border: "none", background: "none", color: "#B71C1C", cursor: "pointer", fontSize: "1rem", fontWeight: 800, lineHeight: 1, padding: "0 4px" }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setLinhasEditadas([...linhas, { method: "", valor: "" }])}
              style={{ ...botaoLeve, border: "1.5px dashed #FDE68A", color: "#B45309" }}
            >
              + Adicionar forma
            </button>
            <span style={{ fontSize: "0.76rem", fontWeight: 800, color: fecha ? "#0F766E" : falta > 0 ? "#B45309" : "#B71C1C" }}>
              {fecha
                ? `✓ fecha em ${dinheiro(somarPartes(partesValidas))}`
                : falta > 0
                  ? `faltam ${dinheiro(falta)}`
                  : `passou ${dinheiro(Math.abs(falta))}`}
            </span>
          </div>
        </div>
      )}

      {erro && <div role="alert" style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={aoCancelar} style={{ ...botaoLeve, color: "#64748B" }}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={!podeSalvar}
          onClick={salvar}
          style={{
            padding: "6px 14px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 800, border: "none",
            background: podeSalvar ? "#0F766E" : "#94A3B8", color: "#FFF", cursor: podeSalvar ? "pointer" : "default", fontFamily: "inherit",
          }}
        >
          {salvando ? "Salvando…" : "Salvar correção"}
        </button>
      </div>
    </div>
  );
}
