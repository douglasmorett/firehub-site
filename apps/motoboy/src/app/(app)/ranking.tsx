/**
 * "Ranking": quem está em primeiro, a posição do entregador e os números dele
 * contra a equipe (api/motoboys/ranking → lib/relatorios/ranking-de-entregadores.ts
 * no site, a MESMA conta da tela Motoboys › Ranking da loja).
 *
 * A aba só aparece se a loja ligou (padrão desligado — _layout.tsx pergunta).
 * Sem dinheiro: entregas, tempos, prazo e o score, para ele entender onde
 * está ganhando e onde está perdendo ponto.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { cor, raio } from "@/components/tema";
import { chamar, ErroDaApi } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

type Linha = {
  motoboyId: string;
  nome: string;
  posicao: number | null;
  score: number | null;
  entregas: number;
  canceladas: number;
  conclusaoPct: number | null;
  entregaMedianaMin: number | null;
  noPrazoPct: number | null;
  comPrazo: number;
  noPrazo: number;
  coletaMedianaMin: number | null;
  voltaMedianaMin: number | null;
  voltas: number;
  notas: { conclusao: number | null; prazo: number | null; entrega: number | null; volta: number | null; coleta: number | null };
};

type Resposta =
  | { ativo: false }
  | {
      ativo: true;
      voce: string;
      periodo: { de: string; ate: string };
      pesos: { conclusao: number; prazo: number; entrega: number; volta: number; coleta: number };
      linhas: Linha[];
      equipe: { entregaMedianaMin: number | null; noPrazoPct: number | null; coletaMedianaMin: number | null; voltaMedianaMin: number | null; conclusaoPct: number | null };
    };

type Periodo = "hoje" | "7d" | "30d";

const MEDALHAS = ["🥇", "🥈", "🥉"];
const min = (n: number | null | undefined) => (n == null ? "—" : `${String(Math.round(n * 10) / 10).replace(".", ",")} min`);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${String(Math.round(n * 10) / 10).replace(".", ",")}%`);
const corDoScore = (n: number | null) => (n == null ? cor.textoApagado : n >= 85 ? cor.verde : n >= 70 ? cor.ambar : cor.vermelho);

/** A medida que mais tira ponto dele, dita como conselho. */
function comoSubir(l: Linha): string | null {
  const dicas: { nota: number | null; texto: string }[] = [
    { nota: l.notas.prazo, texto: "Entregar dentro do prazo prometido ao cliente é o que mais pesa agora." },
    { nota: l.notas.volta, texto: "Voltar mais rápido para a loja depois da última entrega da rota sobe o seu score." },
    { nota: l.notas.entrega, texto: "O seu tempo da saída até a entrega está acima da equipe." },
    { nota: l.notas.conclusao, texto: "Pedido cancelado depois de sair com você derruba a sua conclusão." },
    { nota: l.notas.coleta, texto: "Sair logo depois que o pedido fica pronto ajuda na coleta." },
  ];
  const pior = dicas.filter((d) => d.nota != null && d.nota < 90).sort((a, b) => (a.nota as number) - (b.nota as number))[0];
  return pior ? pior.texto : null;
}

export default function Ranking() {
  const { sessao, sair } = useSessao();
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(
    async (p: Periodo = periodo) => {
      if (!sessao) return;
      setCarregando(true);
      setErro(null);
      try {
        setDados(await chamar<Resposta>(`/api/motoboys/ranking?periodo=${p}`, { token: sessao.token }));
      } catch (e) {
        if (e instanceof ErroDaApi && e.tipo === "sessao") return sair("Sua entrada terminou. Entre de novo.");
        setErro((e as Error)?.message || "Não consegui buscar agora.");
      } finally {
        setCarregando(false);
      }
    },
    [sessao, sair, periodo],
  );

  useFocusEffect(
    useCallback(() => {
      buscar();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const escolher = (p: Periodo) => {
    setPeriodo(p);
    buscar(p);
  };

  const ativo = dados && dados.ativo ? dados : null;
  const eu = ativo?.linhas.find((l) => l.motoboyId === ativo.voce) || null;
  const lider = ativo?.linhas.find((l) => l.posicao === 1) || null;
  const dica = eu ? comoSubir(eu) : null;

  return (
    <SafeAreaView style={s.tela} edges={["top"]}>
      <View style={s.topo}>
        <Text style={s.titulo}>🏆 Ranking</Text>
        <Text style={s.subtitulo}>Quem está em primeiro e os seus números.</Text>
      </View>
      <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={carregando && Boolean(dados)} onRefresh={() => buscar()} />}>
        <View style={s.chips}>
          {([["hoje", "Hoje"], ["7d", "7 dias"], ["30d", "30 dias"]] as [Periodo, string][]).map(([p, rotulo]) => (
            <Pressable key={p} onPress={() => escolher(p)} accessibilityRole="radio" accessibilityState={{ selected: periodo === p }} style={[s.chip, periodo === p && s.chipAtivo]}>
              <Text style={[s.chipTexto, periodo === p && s.chipTextoAtivo]}>{rotulo}</Text>
            </Pressable>
          ))}
        </View>

        {erro ? <Text style={s.erro}>⚠️ {erro}</Text> : null}
        {!dados && carregando ? <ActivityIndicator style={{ marginTop: 24 }} color={cor.azul} /> : null}
        {dados && !dados.ativo ? <Text style={s.vazio}>A loja não está mostrando o ranking no app.</Text> : null}

        {ativo && ativo.linhas.length === 0 ? <Text style={s.vazio}>Nenhuma entrega no período.</Text> : null}

        {ativo && eu ? (
          <View style={[s.cartao, s.cartaoEu]}>
            <Text style={s.rotulo}>VOCÊ</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={s.posicaoGrande}>
                {eu.posicao == null ? "Sem posição" : eu.posicao <= 3 ? `${MEDALHAS[eu.posicao - 1]} ${eu.posicao}º lugar` : `${eu.posicao}º lugar`}
              </Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[s.score, { color: corDoScore(eu.score) }]}>{eu.score ?? "—"}</Text>
                <Text style={s.rotuloPequeno}>SCORE</Text>
              </View>
            </View>
            {eu.posicao == null ? <Text style={s.dica}>Faça pelo menos 3 entregas no período para entrar no ranking.</Text> : null}
            {lider && eu.posicao != null && eu.posicao > 1 && lider.score != null && eu.score != null ? (
              <Text style={s.dica}>Faltam {lider.score - eu.score} ponto(s) para o 1º lugar ({lider.nome}).</Text>
            ) : null}
            {dica ? <Text style={s.conselho}>💡 {dica}</Text> : null}

            <View style={s.grade}>
              {[
                { t: "ENTREGAS", v: String(eu.entregas), e: `${eu.canceladas} cancelado(s) com você` },
                { t: "CONCLUSÃO", v: pct(eu.conclusaoPct), e: `equipe ${pct(ativo.equipe.conclusaoPct)}` },
                { t: "ENTREGA", v: min(eu.entregaMedianaMin), e: `equipe ${min(ativo.equipe.entregaMedianaMin)}` },
                { t: "NO PRAZO", v: pct(eu.noPrazoPct), e: eu.comPrazo ? `${eu.noPrazo} de ${eu.comPrazo} · equipe ${pct(ativo.equipe.noPrazoPct)}` : "sem prazo no período" },
                { t: "VOLTA À LOJA", v: min(eu.voltaMedianaMin), e: `equipe ${min(ativo.equipe.voltaMedianaMin)}` },
                { t: "COLETA", v: min(eu.coletaMedianaMin), e: `equipe ${min(ativo.equipe.coletaMedianaMin)}` },
              ].map((c) => (
                <View key={c.t} style={s.numero}>
                  <Text style={s.rotuloPequeno}>{c.t}</Text>
                  <Text style={s.valor}>{c.v}</Text>
                  <Text style={s.extra}>{c.e}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {ativo && ativo.linhas.length > 0 ? (
          <View style={s.cartao}>
            <Text style={s.rotulo}>A EQUIPE</Text>
            {ativo.linhas.map((l) => {
              const souEu = l.motoboyId === ativo.voce;
              return (
                <View key={l.motoboyId} style={[s.linha, souEu && s.linhaEu]}>
                  <Text style={s.lugar}>{l.posicao == null ? "—" : l.posicao <= 3 ? MEDALHAS[l.posicao - 1] : `${l.posicao}º`}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.nome} numberOfLines={1}>{l.nome}{souEu ? " (você)" : ""}</Text>
                    <Text style={s.extra}>{l.entregas} entregas · {min(l.entregaMedianaMin)} · {pct(l.noPrazoPct)} no prazo</Text>
                  </View>
                  <Text style={[s.scoreLinha, { color: corDoScore(l.score) }]}>{l.score ?? "—"}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {ativo ? (
          <View style={s.cartao}>
            <Text style={s.rotulo}>COMO O SCORE É FEITO</Text>
            <Text style={s.explica}>
              Conclusão {ativo.pesos.conclusao} · no prazo {ativo.pesos.prazo} · entrega {ativo.pesos.entrega} · volta {ativo.pesos.volta} · coleta {ativo.pesos.coleta} pontos.
            </Text>
            <Text style={s.explica}>• Conclusão: pedidos entregues contra os cancelados depois de sair com você.</Text>
            <Text style={s.explica}>• No prazo: entregue até a hora prometida ao cliente.</Text>
            <Text style={s.explica}>• Entrega: da saída da loja até a entrega.</Text>
            <Text style={s.explica}>• Volta: da última entrega da rota até você pegar o próximo pedido.</Text>
            <Text style={s.explica}>• Coleta: do pedido pronto até você sair com ele.</Text>
            <Text style={s.explica}>Os tempos são comparados com a equipe: igual ou melhor que a equipe vale nota cheia.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  topo: { backgroundColor: cor.topo, paddingHorizontal: 18, paddingVertical: 14 },
  titulo: { color: "#fff", fontSize: 20, fontWeight: "900" },
  subtitulo: { color: "#CBD5E1", fontSize: 13, marginTop: 2 },
  conteudo: { padding: 14, gap: 12, paddingBottom: 40 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: cor.bordaForte, backgroundColor: cor.cartao },
  chipAtivo: { backgroundColor: cor.topo, borderColor: cor.topo },
  chipTexto: { fontWeight: "800", color: cor.texto },
  chipTextoAtivo: { color: "#fff" },
  erro: { color: cor.vermelho, fontWeight: "700" },
  vazio: { color: cor.textoApagado, textAlign: "center", marginTop: 24, fontWeight: "600" },
  cartao: { backgroundColor: cor.cartao, borderRadius: raio.grande, borderWidth: 1, borderColor: cor.borda, padding: 14, gap: 8 },
  cartaoEu: { borderColor: "#D4A017", borderWidth: 2, backgroundColor: "#FFFBEB" },
  rotulo: { fontSize: 12, fontWeight: "900", color: cor.textoApagado, letterSpacing: 0.5 },
  rotuloPequeno: { fontSize: 10, fontWeight: "900", color: cor.textoApagado, letterSpacing: 0.4 },
  posicaoGrande: { fontSize: 22, fontWeight: "900", color: cor.texto },
  score: { fontSize: 34, fontWeight: "900", lineHeight: 36 },
  dica: { fontSize: 13, color: cor.textoSuave, fontWeight: "600" },
  conselho: { fontSize: 13, color: cor.ambar, fontWeight: "800", backgroundColor: cor.ambarClaro, borderRadius: raio.pequeno, padding: 10 },
  grade: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  numero: { width: "48%", backgroundColor: cor.cartao, borderRadius: raio.medio, borderWidth: 1, borderColor: cor.borda, padding: 10 },
  valor: { fontSize: 18, fontWeight: "900", color: cor.texto, marginTop: 2 },
  extra: { fontSize: 11, color: cor.textoApagado, marginTop: 2 },
  linha: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: cor.borda },
  linhaEu: { backgroundColor: cor.azulClaro, borderRadius: raio.pequeno, paddingHorizontal: 6 },
  lugar: { width: 34, fontSize: 16, fontWeight: "900", textAlign: "center", color: cor.texto },
  nome: { fontSize: 15, fontWeight: "800", color: cor.texto },
  scoreLinha: { fontSize: 20, fontWeight: "900", minWidth: 36, textAlign: "right" },
  explica: { fontSize: 13, color: cor.textoSuave, lineHeight: 19 },
});
