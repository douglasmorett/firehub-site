/**
 * Da porta do cliente até a baixa — a mesma fila da página web:
 *
 *   1. CÓDIGO do iFood/99: os 4 dígitos do cliente, conferidos com a
 *      plataforma ANTES de tudo, sem dar baixa. "Só abro a bag depois que
 *      tenho o código" (Lucas, Frangoso, 05/10/2026; o dono confirmou).
 *   2. RECEBER: quanto e em quê, com o troco já calculado. "Pagou de outro
 *      jeito" vai junto na baixa — o acerto não cobra dele um dinheiro que ele
 *      não recebeu.
 *   3. BEBIDAS: "você entregou a 2x Coca?" (a loja liga no painel), a última
 *      pergunta. "Ainda não" fecha sem baixa: ele volta, pega a bebida e
 *      confirma depois — o código aprovado fica valendo.
 *
 * Pedido sem nenhuma pergunta ainda passa por "Entregou?": no app, um toque
 * de bolso no botão verde mandaria o WhatsApp "seu pedido chegou" e fecharia
 * o pedido no iFood.
 *
 * Quem decide tudo isso é o servidor (o que vem em cada pedido); aqui só se
 * pergunta na ordem.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { Pedido } from "@/lib/api";
import { Botao } from "./Botao";
import { Folha } from "./Folha";
import { cor, raio, reais } from "./tema";

export type ExtraDaBaixa = { codigo?: string; semCodigo?: boolean; pagamento?: string };

export type ResultadoDaBaixa =
  | { ok: true }
  | { ok: false; precisaCodigo?: boolean; canalDoCodigo?: string | null; erroNoCodigo?: string; erro?: string };

/** O passo do código sozinho (PATCH com `apenasConferirCodigo`): aprova, não dá baixa. */
export type ResultadoDaConferencia = { ok: true } | { ok: false; erroNoCodigo?: string; erro?: string };

type Passo = "bebidas" | "cobranca" | "codigo" | "confirmar";

function primeiroPasso(p: Pedido): Passo {
  if (p.pedeCodigoEntrega) return "codigo";
  if (p.cobrarNaEntrega) return "cobranca";
  if (p.bebidasParaConferir.length > 0) return "bebidas";
  return "confirmar";
}

export function FluxoDaEntrega({
  pedido,
  formas,
  aoFechar,
  baixar,
  conferirCodigo,
}: {
  /** A tela monta este fluxo só enquanto há um pedido em entrega: cada abertura começa do zero. */
  pedido: Pedido;
  formas: string[];
  aoFechar: () => void;
  /** A baixa de verdade (PATCH). O fluxo só fecha quando ela confirma. */
  baixar: (pedido: Pedido, extra: ExtraDaBaixa) => Promise<ResultadoDaBaixa>;
  /** O primeiro passo: confere o código com o iFood/99, sem baixa. */
  conferirCodigo: (pedido: Pedido, codigo: string) => Promise<ResultadoDaConferencia>;
}) {
  const [passo, setPasso] = useState<Passo>(() => primeiroPasso(pedido));
  const [extra, setExtra] = useState<ExtraDaBaixa>({});
  const [formaEscolhida, setFormaEscolhida] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erroCodigo, setErroCodigo] = useState("");
  const [canal, setCanal] = useState<string | null>(pedido.canalDoCodigo);
  const [enviando, setEnviando] = useState(false);
  /** A baixa já tinha pagamento e bebida respondidos quando o servidor pediu o
      código (lista defasada): aprovado o código, volta direto a ela. */
  const [retomarBaixa, setRetomarBaixa] = useState(false);

  const fechar = () => {
    if (!enviando) aoFechar();
  };

  async function finalizar(extraFinal: ExtraDaBaixa) {
    if (enviando) return;
    setEnviando(true);
    try {
      const r = await baixar(pedido, extraFinal);
      if (r.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        aoFechar();
        return;
      }
      if (r.precisaCodigo) {
        // A lista estava defasada: o servidor sabe que este pedido pede código.
        setExtra(extraFinal);
        setCanal(r.canalDoCodigo || canal || "iFood");
        setCodigo("");
        setErroCodigo("");
        setRetomarBaixa(true);
        setPasso("codigo");
        return;
      }
      if (r.erroNoCodigo) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setErroCodigo(r.erroNoCodigo);
        setPasso("codigo");
        return;
      }
      // Falha comum: a tela da lista avisa (o aviso no topo) e o fluxo fecha.
      aoFechar();
    } finally {
      setEnviando(false);
    }
  }

  /** Avança para o próximo passo que este pedido tem, ou dá a baixa. */
  function seguirDepoisDe(atual: Passo, extraAtual: ExtraDaBaixa) {
    setExtra(extraAtual);
    if (atual === "codigo" && retomarBaixa) return finalizar(extraAtual);
    if (atual === "codigo" && pedido.cobrarNaEntrega) return setPasso("cobranca");
    if ((atual === "codigo" || atual === "cobranca") && pedido.bebidasParaConferir.length > 0) return setPasso("bebidas");
    finalizar(extraAtual);
  }

  /** O passo do código: só segue com a plataforma aprovando. */
  async function conferir() {
    if (enviando || codigo.length < 4) return;
    setEnviando(true);
    let aprovado = false;
    try {
      const r = await conferirCodigo(pedido, codigo);
      if (r.ok) {
        aprovado = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setErroCodigo("");
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setErroCodigo(r.erroNoCodigo || r.erro || "Não consegui conferir o código. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
    if (aprovado) seguirDepoisDe("codigo", extra);
  }

  const cobranca = pedido.cobrarNaEntrega;
  const formaDoPedido = pedido.formaDoPedido;
  const forma = formaEscolhida ?? formaDoPedido;

  return (
    <Folha aberta aoFechar={fechar}>
      {passo === "bebidas" ? (
        <>
          <Cabeca emoji="🥤" titulo="Atenção às bebidas!" subtitulo={`Pedido #${pedido.numero} · ${pedido.customerName}`} />
          <View style={s.lista}>
            {pedido.bebidasParaConferir.map((b, i) => (
              <View key={i} style={[s.linhaBebida, i > 0 && s.linhaTracejada]}>
                <Text style={s.bebidaNome}>🥤 {b.name}</Text>
                <View style={s.qtd}>
                  <Text style={s.qtdTexto}>{b.quantity}x</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={s.pergunta}>
            {pedido.bebidasParaConferir.length === 1
              ? `Você entregou ${pedido.bebidasParaConferir[0].quantity}x ${pedido.bebidasParaConferir[0].name}?`
              : `Você entregou TODAS essas ${pedido.bebidasParaConferir.reduce((t, b) => t + b.quantity, 0)} bebidas?`}
          </Text>
          <Duas
            nao="Ainda não"
            sim="Sim, entreguei"
            aoNao={fechar}
            aoSim={() => seguirDepoisDe("bebidas", extra)}
            carregando={enviando}
          />
          <Text style={s.rodape}>“Ainda não” mantém o pedido pendente — nada é finalizado.</Text>
        </>
      ) : null}

      {passo === "cobranca" && cobranca ? (
        <>
          <Cabeca emoji="💵" titulo="Receba antes de finalizar" subtitulo={`Pedido #${pedido.numero} · ${pedido.customerName}`} />
          <View style={s.valorCaixa}>
            <Text style={s.valorMetodo}>{cobranca.metodo}</Text>
            <Text style={s.valor}>{reais(cobranca.valor)}</Text>
          </View>

          <Text style={s.rotulo}>O CLIENTE PAGOU COM</Text>
          <View style={s.formas}>
            {formas.map((f) => {
              const ativa = forma === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    setFormaEscolhida(f);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: ativa }}
                  style={[s.forma, ativa && s.formaAtiva]}
                >
                  <Text style={[s.formaTexto, ativa && s.formaTextoAtiva]}>{f}</Text>
                </Pressable>
              );
            })}
          </View>
          {formaEscolhida && formaDoPedido && formaEscolhida !== formaDoPedido ? (
            <Text style={s.mudou}>
              O pedido dizia {formaDoPedido}. A loja vai ver que foi pago em {formaEscolhida}.
            </Text>
          ) : null}

          {cobranca.trocoPara && forma === "Dinheiro" ? (
            <View style={s.trocoCaixa}>
              <Text style={s.trocoLinha}>O cliente vai pagar com {reais(cobranca.trocoPara)}</Text>
              <Text style={s.trocoValor}>Devolva {reais(cobranca.levarDeTroco)} de troco</Text>
            </View>
          ) : null}

          <Duas
            nao="Ainda não"
            sim="Recebi"
            aoNao={fechar}
            carregando={enviando}
            aoSim={() => {
              // Só viaja se for DIFERENTE do que o pedido dizia: confirmar
              // "Dinheiro" num pedido em dinheiro não vira troca no histórico.
              const mudou = formaEscolhida && formaEscolhida !== formaDoPedido;
              seguirDepoisDe("cobranca", mudou ? { ...extra, pagamento: formaEscolhida! } : extra);
            }}
          />
          <Text style={s.rodape}>“Ainda não” mantém o pedido pendente — nada é finalizado.</Text>
        </>
      ) : null}

      {passo === "codigo" ? (
        <>
          <Cabeca
            emoji="🔐"
            titulo={`Código de entrega do ${canal || "iFood"}`}
            subtitulo={`Peça ao cliente o código de 4 dígitos que aparece no app do ${canal || "iFood"} dele. Só abra a bag depois que o código for aprovado.`}
          />
          <TextInput
            value={codigo}
            onChangeText={(t) => {
              setCodigo(t.replace(/\D/g, "").slice(0, 6));
              setErroCodigo("");
            }}
            keyboardType="number-pad"
            autoFocus
            maxLength={6}
            placeholder="• • • •"
            placeholderTextColor={cor.bordaForte}
            style={[s.codigo, erroCodigo ? { borderColor: cor.vermelho } : null]}
            onSubmitEditing={() => conferir()}
            accessibilityLabel="Código de entrega"
          />
          {erroCodigo ? <Text style={s.erro}>{erroCodigo}</Text> : null}
          <Botao
            titulo="Conferir código"
            variante="verde"
            desabilitado={codigo.length < 4}
            carregando={enviando}
            icone={<Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />}
            aoTocar={() => conferir()}
          />
          <Botao
            titulo="O cliente não tem o código"
            variante="claro"
            pequeno
            desabilitado={enviando}
            aoTocar={() =>
              Alert.alert(
                "Confirmar sem o código?",
                `O ${canal || "iFood"} pode não reconhecer a entrega. Só faça isso se o cliente realmente não tem o código.`,
                [
                  { text: "Voltar", style: "cancel" },
                  { text: "Confirmar sem código", style: "destructive", onPress: () => seguirDepoisDe("codigo", { ...extra, semCodigo: true }) },
                ],
              )
            }
          />
        </>
      ) : null}

      {passo === "confirmar" ? (
        <>
          <Cabeca emoji="📦" titulo={`Entregou o pedido #${pedido.numero}?`} subtitulo={pedido.customerName} />
          <Duas nao="Ainda não" sim="Sim, entreguei" aoNao={fechar} aoSim={() => finalizar(extra)} carregando={enviando} />
        </>
      ) : null}
    </Folha>
  );
}

function Cabeca({ emoji, titulo, subtitulo }: { emoji: string; titulo: string; subtitulo?: string }) {
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <Text style={{ fontSize: 40 }}>{emoji}</Text>
      <Text style={s.titulo}>{titulo}</Text>
      {subtitulo ? <Text style={s.subtitulo}>{subtitulo}</Text> : null}
    </View>
  );
}

function Duas({
  nao,
  sim,
  aoNao,
  aoSim,
  carregando,
}: {
  nao: string;
  sim: string;
  aoNao: () => void;
  aoSim: () => void;
  carregando: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Botao titulo={nao} variante="perigo" aoTocar={aoNao} desabilitado={carregando} estilo={{ flex: 1 }} />
      <Botao
        titulo={sim}
        variante="verde"
        aoTocar={aoSim}
        carregando={carregando}
        icone={<Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />}
        estilo={{ flex: 1.5 }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  titulo: { fontSize: 21, fontWeight: "900", color: cor.texto, textAlign: "center" },
  subtitulo: { fontSize: 14, color: cor.textoApagado, textAlign: "center", fontWeight: "600" },
  lista: { backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: cor.borda, borderRadius: raio.medio, paddingHorizontal: 14, paddingVertical: 4 },
  linhaBebida: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 9 },
  linhaTracejada: { borderTopWidth: 1, borderStyle: "dashed", borderTopColor: cor.bordaForte },
  bebidaNome: { fontSize: 16, fontWeight: "800", color: cor.texto, flex: 1 },
  qtd: { backgroundColor: cor.azul, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3 },
  qtdTexto: { color: "#FFFFFF", fontWeight: "900" },
  pergunta: { fontSize: 17, fontWeight: "900", color: cor.texto, textAlign: "center" },
  rodape: { fontSize: 12, color: "#94A3B8", textAlign: "center" },
  valorCaixa: { backgroundColor: cor.verdeClaro, borderWidth: 2, borderColor: cor.verdeBorda, borderRadius: raio.medio, padding: 14, alignItems: "center" },
  valorMetodo: { fontSize: 12, fontWeight: "800", color: "#15803D", letterSpacing: 1, textTransform: "uppercase" },
  valor: { fontSize: 38, fontWeight: "900", color: cor.verdeEscuro, fontVariant: ["tabular-nums"] },
  rotulo: { fontSize: 12, fontWeight: "800", color: cor.textoSuave, letterSpacing: 1 },
  formas: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  forma: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: raio.pequeno, borderWidth: 2, borderColor: cor.borda, backgroundColor: "#FFFFFF" },
  formaAtiva: { borderColor: cor.verde, backgroundColor: cor.verdeClaro },
  formaTexto: { fontWeight: "800", fontSize: 15, color: "#334155" },
  formaTextoAtiva: { color: cor.verdeEscuro },
  mudou: { fontSize: 13, color: "#B45309", fontWeight: "700" },
  trocoCaixa: { backgroundColor: cor.ambarClaro, borderWidth: 2, borderColor: cor.ambarBorda, borderRadius: raio.medio, padding: 12 },
  trocoLinha: { fontSize: 14, color: cor.ambar, fontWeight: "700" },
  trocoValor: { fontSize: 19, color: "#78350F", fontWeight: "900", marginTop: 2 },
  codigo: {
    fontSize: 34,
    letterSpacing: 14,
    textAlign: "center",
    fontWeight: "900",
    color: cor.texto,
    borderWidth: 2,
    borderColor: cor.bordaForte,
    borderRadius: raio.medio,
    paddingVertical: 12,
  },
  erro: { color: cor.vermelho, fontWeight: "800", fontSize: 14, textAlign: "center" },
});
