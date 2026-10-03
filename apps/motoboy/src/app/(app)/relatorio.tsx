/**
 * "Meu relatório": a mesma conta e o mesmo filtro do relatório da loja
 * (api/motoboys/relatorio → lib/relatorio-do-entregador.ts no site), para os
 * dois lados chegarem no mesmo número ("pra mim bate nove, pra ele bate dez",
 * Frangoso, 02/10/2026).
 *
 * Dia sem hora vale o expediente inteiro, das 5h às 5h. Com hora, fecha o
 * turno exato (18:00 do dia 1 às 02:00 do dia 2) — igual à loja.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Botao } from "@/components/Botao";
import { cor, raio, reais } from "@/components/tema";
import { chamar, ErroDaApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

type Resposta = {
  period: { from: string; to: string };
  stats: null | {
    totalDeliveries: number;
    uniqueDays: number;
    feeTotal: number;
    dailyTotal: number;
    totalWithDaily: number;
    cashCollectedSum: number;
    cashOrdersCount: number;
    changeGivenSum: number;
  };
  motoboy?: { dailyRate: number | null; entregasSemDistancia: number };
  cancelados: { qtd: number };
  orders: {
    id: string;
    createdAt: string;
    dailyOrderNumber: number | null;
    ifoodReference: string | null;
    openDeliveryReference: string | null;
    customerName: string | null;
    paymentMethod: string | null;
    cashToDeliver: number;
    ganhoDoMotoboy: number;
    cancelado?: boolean;
  }[];
};

/** O dia do EXPEDIENTE no relógio do celular: antes das 5h ainda é ontem. */
function diaDoExpediente(deslocarDias = 0): string {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  d.setDate(d.getDate() + deslocarDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** "1800" → "18:00". Vazio continua vazio (vale o expediente inteiro). */
function hora(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

type Periodo = "hoje" | "ontem" | "7dias";

export default function Relatorio() {
  const { sessao, sair } = useSessao();
  const [periodo, setPeriodo] = useState<Periodo>("hoje");
  const [deHora, setDeHora] = useState("");
  const [ateHora, setAteHora] = useState("");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(
    async (p: Periodo = periodo, hDe = deHora, hAte = ateHora) => {
      if (!sessao) return;
      const de = p === "hoje" ? diaDoExpediente(0) : p === "ontem" ? diaDoExpediente(-1) : diaDoExpediente(-6);
      const ate = p === "ontem" ? diaDoExpediente(-1) : diaDoExpediente(0);
      const valida = (h: string) => /^\d{2}:\d{2}$/.test(h);
      const q = new URLSearchParams({
        from: de + (valida(hDe) ? `T${hDe}` : ""),
        to: ate + (valida(hAte) ? `T${hAte}` : ""),
      });
      setCarregando(true);
      setErro(null);
      try {
        setDados(await chamar<Resposta>(`/api/motoboys/relatorio?${q}`, { token: sessao.token }));
      } catch (e) {
        if (e instanceof ErroDaApi && e.tipo === "sessao") return sair("Sua entrada terminou. Entre de novo.");
        setErro((e as Error)?.message || "Não consegui buscar agora.");
      } finally {
        setCarregando(false);
      }
    },
    [sessao, sair, periodo, deHora, ateHora],
  );

  useFocusEffect(
    useCallback(() => {
      buscar();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const s_ = dados?.stats;
  const escolher = (p: Periodo) => {
    setPeriodo(p);
    buscar(p);
  };

  return (
    <SafeAreaView style={s.tela} edges={["top"]}>
      <View style={s.topo}>
        <Text style={s.titulo}>Meu relatório</Text>
        <Text style={s.subtitulo}>A mesma conta que a loja vê.</Text>
      </View>
      <ScrollView
        contentContainerStyle={s.conteudo}
        refreshControl={<RefreshControl refreshing={carregando && Boolean(dados)} onRefresh={() => buscar()} />}
      >
        <View style={s.chips}>
          {(
            [
              ["hoje", "Hoje"],
              ["ontem", "Ontem"],
              ["7dias", "7 dias"],
            ] as [Periodo, string][]
          ).map(([p, rotulo]) => (
            <Pressable
              key={p}
              onPress={() => escolher(p)}
              accessibilityRole="radio"
              accessibilityState={{ selected: periodo === p }}
              style={[s.chip, periodo === p && s.chipAtivo]}
            >
              <Text style={[s.chipTexto, periodo === p && s.chipTextoAtivo]}>{rotulo}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.cartao}>
          <Text style={s.rotulo}>TURNO EXATO (opcional)</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <TextInput
              value={deHora}
              onChangeText={(t) => setDeHora(hora(t))}
              placeholder="18:00"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={5}
              style={s.campo}
              accessibilityLabel="Hora de início"
            />
            <Text style={{ fontWeight: "800", color: cor.textoSuave }}>até</Text>
            <TextInput
              value={ateHora}
              onChangeText={(t) => setAteHora(hora(t))}
              placeholder="02:00"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={5}
              style={s.campo}
              accessibilityLabel="Hora de fim"
            />
          </View>
          <Text style={s.dica}>Em branco vale o dia inteiro do expediente: das 5h até as 5h do dia seguinte.</Text>
          <Botao titulo="Ver relatório" variante="escuro" pequeno carregando={carregando} aoTocar={() => buscar()} />
        </View>

        {erro ? <Text style={s.erro}>⚠️ {erro}</Text> : null}
        {!dados && carregando ? <ActivityIndicator style={{ marginTop: 24 }} color={cor.azul} /> : null}

        {dados ? (
          <>
            <Text style={s.periodo}>
              {dataCurta(dados.period.from)} até {dataCurta(dados.period.to)}
            </Text>
            <View style={s.grade}>
              {[
                { t: "ENTREGAS", v: String(s_?.totalDeliveries ?? 0), c: cor.verde },
                { t: "A RECEBER", v: reais(s_?.totalWithDaily), c: cor.texto },
                { t: "POR ENTREGA", v: reais(s_?.feeTotal), c: "#334155" },
                {
                  t:
                    s_ && s_.uniqueDays > 0 && (dados.motoboy?.dailyRate || 0) > 0
                      ? `DIÁRIA (${s_.uniqueDays} dia${s_.uniqueDays > 1 ? "s" : ""})`
                      : "DIÁRIA",
                  v: reais(s_?.dailyTotal),
                  c: "#334155",
                },
              ].map((c) => (
                <View key={c.t} style={s.numero}>
                  <Text style={s.numeroRotulo}>{c.t}</Text>
                  <Text style={[s.numeroValor, { color: c.c }]}>{c.v}</Text>
                </View>
              ))}
            </View>

            {s_ && s_.cashOrdersCount > 0 ? (
              <View style={s.dinheiro}>
                <Text style={s.dinheiroTexto}>
                  Dinheiro para entregar na loja: {reais(s_.cashCollectedSum)} ({s_.cashOrdersCount} pedido
                  {s_.cashOrdersCount > 1 ? "s" : ""}
                  {s_.changeGivenSum > 0 ? `, ${reais(s_.changeGivenSum)} saíram de troco` : ""})
                </Text>
              </View>
            ) : null}
            {dados.cancelados.qtd > 0 ? (
              <Text style={s.nota}>
                {dados.cancelados.qtd} pedido{dados.cancelados.qtd > 1 ? "s" : ""} cancelado{dados.cancelados.qtd > 1 ? "s" : ""} com
                você no período — a corrida conta, sem dinheiro a entregar.
              </Text>
            ) : null}
            {(dados.motoboy?.entregasSemDistancia || 0) > 0 ? (
              <Text style={[s.nota, { color: "#B45309" }]}>
                {dados.motoboy!.entregasSemDistancia} entrega(s) sem distância calculada — confira com a loja.
              </Text>
            ) : null}

            <View style={{ gap: 6 }}>
              {dados.orders.map((o) => (
                <View key={o.id} style={s.pedido}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.pedidoNumero}>
                      #{o.dailyOrderNumber ?? o.ifoodReference ?? o.openDeliveryReference ?? "—"}{" "}
                      {o.cancelado ? <Text style={s.cancelado}> CANCELADO </Text> : null}
                      <Text style={s.pedidoHora}> {dataCurta(o.createdAt)}</Text>
                    </Text>
                    <Text style={s.pedidoCliente} numberOfLines={1}>
                      {o.customerName || "Cliente"} · {o.paymentMethod || "—"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.ganho}>{reais(o.ganhoDoMotoboy)}</Text>
                    {o.cashToDeliver > 0 ? <Text style={s.emDinheiro}>💵 {reais(o.cashToDeliver)}</Text> : null}
                  </View>
                </View>
              ))}
              {dados.orders.length === 0 ? <Text style={s.nota}>Nenhuma entrega nesse período.</Text> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.topo },
  topo: { paddingHorizontal: 16, paddingVertical: 14 },
  titulo: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  subtitulo: { color: "#94A3B8", fontSize: 14, fontWeight: "600" },
  conteudo: { backgroundColor: cor.fundo, padding: 14, gap: 12, paddingBottom: 40, flexGrow: 1 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, minHeight: 46, borderRadius: raio.pequeno, borderWidth: 1.5, borderColor: cor.bordaForte, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  chipAtivo: { backgroundColor: cor.topo, borderColor: cor.topo },
  chipTexto: { fontWeight: "800", fontSize: 15, color: cor.texto },
  chipTextoAtivo: { color: "#FFFFFF" },
  cartao: { backgroundColor: cor.cartao, borderRadius: raio.medio, borderWidth: 1, borderColor: cor.borda, padding: 12, gap: 8 },
  rotulo: { fontSize: 12, fontWeight: "800", color: cor.textoApagado },
  campo: { flex: 1, minWidth: 0, minHeight: 46, borderWidth: 1.5, borderColor: cor.bordaForte, borderRadius: raio.pequeno, paddingHorizontal: 12, fontSize: 17, fontWeight: "700", color: cor.texto, textAlign: "center" },
  dica: { fontSize: 12, color: cor.textoApagado, lineHeight: 17 },
  erro: { backgroundColor: cor.vermelhoClaro, color: cor.vermelho, padding: 10, borderRadius: raio.pequeno, fontWeight: "700", overflow: "hidden" },
  periodo: { textAlign: "center", fontSize: 13, color: cor.textoApagado },
  grade: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  numero: { flexBasis: "48%", flexGrow: 1, backgroundColor: cor.cartao, borderRadius: raio.pequeno, borderWidth: 1, borderColor: cor.borda, paddingVertical: 12, alignItems: "center" },
  numeroRotulo: { fontSize: 11, fontWeight: "800", color: cor.textoApagado },
  numeroValor: { fontSize: 21, fontWeight: "900", marginTop: 2, fontVariant: ["tabular-nums"] },
  dinheiro: { backgroundColor: cor.ambarClaro, borderWidth: 1, borderColor: cor.ambarBorda, borderRadius: raio.pequeno, padding: 10 },
  dinheiroTexto: { color: cor.ambar, fontWeight: "700", fontSize: 14 },
  nota: { fontSize: 13, color: cor.textoApagado, textAlign: "center" },
  pedido: { flexDirection: "row", gap: 8, backgroundColor: cor.cartao, borderRadius: raio.pequeno, borderWidth: 1, borderColor: cor.borda, padding: 11 },
  pedidoNumero: { fontWeight: "900", fontSize: 15, color: cor.texto },
  pedidoHora: { fontWeight: "600", color: cor.textoApagado, fontSize: 13 },
  pedidoCliente: { fontSize: 13, color: cor.textoSuave },
  cancelado: { backgroundColor: "#FEE2E2", color: cor.vermelho, fontSize: 11, fontWeight: "900" },
  ganho: { fontWeight: "900", fontSize: 15, color: cor.verde },
  emDinheiro: { fontSize: 12, color: cor.ambar, fontWeight: "700" },
});
