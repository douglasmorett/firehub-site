/**
 * Uma entrega da lista. O entregador olha de relance, na moto: o número do
 * painel em destaque, o endereço, e — com borda verde — quanto receber na
 * porta. "Pago online" e "receber R$ 87,00" têm de ser distinguíveis sem ler.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActionSheetIOS, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

import type { Pedido } from "@/lib/api";
import { CORES_DA_URGENCIA, textoDaUrgencia, urgenciaDaEntrega, type LimitesDaUrgencia } from "@/lib/urgencia";
import { Botao } from "./Botao";
import { cor, raio, reais } from "./tema";

/**
 * "Abrir com…" (Lucas, Frangoso, 03/10/2026: "no outro você clica no
 * endereço e ele pergunta qual navegador abrir"). No Android, o geo: chama a
 * lista do próprio sistema com todo app de mapa instalado; no iPhone, a folha
 * nativa com Apple Maps, Google Maps e Waze.
 */
function abrirCom(p: Pedido) {
  if (!p.destino) return;
  const exato = p.destino.ponto;
  const alvo = exato ? `${exato.lat},${exato.lng}` : p.destino.texto;
  if (Platform.OS === "android") {
    const geo = exato ? `geo:${exato.lat},${exato.lng}?q=${exato.lat},${exato.lng}` : `geo:0,0?q=${encodeURIComponent(p.destino.texto)}`;
    Linking.openURL(geo).catch(() => Linking.openURL(linkDoMapa(p, "google")!));
    return;
  }
  const opcoes = [
    { rotulo: "Apple Maps", url: `https://maps.apple.com/?daddr=${encodeURIComponent(alvo)}&dirflg=d` },
    { rotulo: "Google Maps", url: linkDoMapa(p, "google")! },
    { rotulo: "Waze", url: linkDoMapa(p, "waze")! },
  ];
  ActionSheetIOS.showActionSheetWithOptions(
    { title: "Abrir com…", message: p.endereco, options: [...opcoes.map((o) => o.rotulo), "Cancelar"], cancelButtonIndex: opcoes.length },
    (i) => {
      if (i < opcoes.length) Linking.openURL(opcoes[i].url).catch(() => {});
    },
  );
}

function linkDoMapa(p: Pedido, app: "google" | "waze"): string | null {
  if (!p.destino) return null;
  const { ponto, texto } = p.destino;
  if (app === "google") {
    const destino = ponto ? `${ponto.lat},${ponto.lng}` : encodeURIComponent(texto);
    return `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving&dir_action=navigate`;
  }
  return ponto
    ? `https://waze.com/ul?ll=${ponto.lat},${ponto.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(texto)}&navigate=yes`;
}

export function CartaoDoPedido({
  pedido,
  ordem,
  agora,
  limites,
  aoEntregar,
  aoDevolver,
  ocupado,
}: {
  pedido: Pedido;
  ordem: number;
  /** O relógio da tela (o cartão não lê o relógio sozinho durante o desenho). */
  agora: number;
  /** Os minutos de amarelo/vermelho da loja (os do KDS). */
  limites: LimitesDaUrgencia | null;
  aoEntregar: () => void;
  aoDevolver: () => void;
  ocupado: boolean;
}) {
  const [sacolaAberta, setSacolaAberta] = useState(false);
  const [mapaAberto, setMapaAberto] = useState(false);
  const cobranca = pedido.cobrarNaEntrega;
  const google = linkDoMapa(pedido, "google");
  const waze = linkDoMapa(pedido, "waze");
  // O telefone já vem pronto do servidor: o 0800 do iFood sem o localizador,
  // o ID à parte e o WhatsApp só para celular.
  const tel = pedido.telefone;
  const whatsapp = tel?.whatsapp
    ? `https://wa.me/${tel.whatsapp}?text=${encodeURIComponent("Olá! Sou o entregador da loja e estou a caminho do seu endereço!")}`
    : null;
  // Liga para o 0800 e, depois de uma pausa, digita o ID do pedido (como o
  // outro app que o Lucas usa).
  const ligar = tel ? `tel:${tel.discar}${tel.id ? `,,${tel.id}` : ""}` : null;
  const urgencia = urgenciaDaEntrega(pedido.previsaoEntrega?.em, agora, limites);
  const corUrg = urgencia ? CORES_DA_URGENCIA[urgencia.faixa] : null;
  const podeDevolver = pedido.podeDevolverAte ? new Date(pedido.podeDevolverAte).getTime() > agora : false;
  const trocoSemCobranca = !cobranca && (pedido.changeAmount || /troco/i.test(pedido.observacao));

  return (
    <View style={[s.cartao, corUrg ? { borderColor: corUrg.borda } : null]}>
      <View style={s.cabeca}>
        <View style={s.ordem}>
          <Text style={s.ordemTexto}>{ordem}º</Text>
        </View>
        <Text style={s.numero}>#{pedido.numero}</Text>
        {pedido.refDaPlataforma ? (
          <View style={s.etiqueta}>
            <Text style={s.etiquetaTexto}>app {pedido.refDaPlataforma}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {pedido.routeSchedule?.routeNumber ? (
          <View style={[s.rota, { backgroundColor: pedido.routeSchedule.color || cor.azul }]}>
            <Text style={s.rotaTexto}>{pedido.routeSchedule.routeNumber}</Text>
          </View>
        ) : null}
        <View style={s.canal}>
          <Text style={s.canalTexto}>{pedido.source || "Direto"}</Text>
        </View>
      </View>

      {urgencia && corUrg ? (
        <View style={[s.urgencia, { backgroundColor: corUrg.fundo, borderColor: corUrg.borda }]}>
          <Ionicons name="time" size={18} color={corUrg.texto} />
          <Text style={[s.urgenciaTexto, { color: corUrg.texto }]}>{textoDaUrgencia(urgencia)}</Text>
        </View>
      ) : null}

      <Text style={s.cliente}>{pedido.customerName}</Text>
      <Pressable
        onPress={() => abrirCom(pedido)}
        disabled={!pedido.destino}
        accessibilityRole="button"
        accessibilityHint="Abre o endereço no app de mapa"
        style={({ pressed }) => [s.endereco, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="location" size={18} color={cor.azulEscuro} />
        <View style={{ flex: 1 }}>
          <Text style={s.enderecoTexto}>{pedido.endereco}</Text>
          {pedido.destino ? <Text style={s.enderecoDica}>Toque para abrir no app de mapa</Text> : null}
        </View>
      </Pressable>

      {pedido.mapa ? (
        <View style={{ gap: 6 }}>
          <Botao
            titulo={mapaAberto ? "Fechar o mapa" : "Ver no mapa"}
            variante={mapaAberto ? "escuro" : "contorno"}
            pequeno
            icone={<Ionicons name="map" size={17} color={mapaAberto ? "#FFFFFF" : cor.azulEscuro} />}
            aoTocar={() => setMapaAberto((v) => !v)}
          />
          {mapaAberto ? (
            <View style={s.mapa}>
              <WebView
                source={{ uri: `https://maps.google.com/maps?q=${pedido.mapa.lat},${pedido.mapa.lng}&z=16&output=embed` }}
                style={{ flex: 1 }}
                // O mapa fica no cartão; tocar num link dele não troca a tela do app.
                onShouldStartLoadWithRequest={(r) => r.url.startsWith("https://maps.google.com") || r.url.startsWith("https://www.google.com/maps")}
                nestedScrollEnabled
              />
              {pedido.mapa.aproximado ? (
                <Text style={s.mapaAviso}>Ponto aproximado (pelo bairro). Confira o número na rua.</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[s.pagamento, cobranca ? s.pagamentoCobrar : null]}>
        {cobranca ? (
          <Text style={s.pagamentoTexto}>
            Receber <Text style={s.valorGrande}>{reais(cobranca.valor)}</Text> em <Text style={s.forte}>{cobranca.metodo}</Text>
          </Text>
        ) : (
          <Text style={s.pagamentoTexto}>
            Pagamento: <Text style={s.forte}>{pedido.paymentMethod || "Na entrega"}</Text> — {reais(pedido.totalAmount)}
          </Text>
        )}
        {cobranca?.trocoPara ? (
          <View style={s.troco}>
            <Text style={s.trocoTexto}>
              💵 Levar {reais(cobranca.levarDeTroco)} de troco{" "}
              <Text style={{ fontWeight: "700" }}>(cliente paga com {reais(cobranca.trocoPara)})</Text>
            </Text>
          </View>
        ) : trocoSemCobranca ? (
          <View style={s.troco}>
            <Text style={s.trocoTexto}>
              💵 {pedido.changeAmount ? `Levar troco para ${reais(pedido.changeAmount)}` : `Atenção: ${pedido.observacao}`}
            </Text>
          </View>
        ) : null}
      </View>

      {pedido.observacao && !/troco/i.test(pedido.observacao) ? (
        <View style={s.obs}>
          <Text style={s.obsTexto}>
            📌 <Text style={s.forte}>Obs/Ref:</Text> {pedido.observacao}
          </Text>
        </View>
      ) : null}

      {pedido.sacola.linhas.length > 0 ? (
        <View>
          <Pressable
            onPress={() => setSacolaAberta((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: sacolaAberta }}
            style={[s.sacolaBotao, sacolaAberta && s.sacolaBotaoAberto]}
          >
            <Ionicons name="bag-handle" size={18} color={sacolaAberta ? "#FFFFFF" : cor.texto} />
            <Text style={[s.sacolaTitulo, sacolaAberta && { color: "#FFFFFF" }]}>Ver pedido</Text>
            <View style={{ flex: 1 }} />
            <Text style={[s.sacolaResumo, sacolaAberta && { color: "#E2E8F0" }]}>
              {pedido.sacola.bebidas > 0 ? "🥤 " : ""}
              {pedido.sacola.resumo}
            </Text>
            <Ionicons name={sacolaAberta ? "chevron-up" : "chevron-down"} size={18} color={sacolaAberta ? "#FFFFFF" : cor.textoApagado} />
          </Pressable>
          {sacolaAberta ? (
            <View style={{ gap: 6, marginTop: 6 }}>
              {pedido.sacola.linhas.map((l, i) => (
                <View key={i} style={[s.item, l.bebida && s.itemBebida]}>
                  <Text style={s.itemNome}>
                    <Text style={{ color: cor.azul }}>{l.quantidade}x </Text>
                    {l.bebida ? "🥤 " : ""}
                    {l.nome}
                  </Text>
                  {l.escolhas.length > 0 ? (
                    <Text style={s.itemEscolhas}>
                      {l.quantidade > 1 ? <Text style={s.forte}>cada: </Text> : null}
                      {l.escolhas.map((e, j) => (
                        <Text key={j} style={e.bebida ? { color: cor.azulEscuro, fontWeight: "800" } : undefined}>
                          {j > 0 ? " · " : ""}
                          {e.bebida ? "🥤 " : ""}
                          {e.quantidade > 1 ? `${e.quantidade}x ` : ""}
                          {e.nome}
                        </Text>
                      ))}
                    </Text>
                  ) : null}
                  {l.obs ? <Text style={s.itemObs}>✏️ {l.obs}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {google && waze ? (
        <View style={s.linha}>
          <Botao
            titulo="Google Maps"
            pequeno
            icone={<Ionicons name="navigate" size={18} color="#FFFFFF" />}
            aoTocar={() => Linking.openURL(google)}
            estilo={[s.metade, { backgroundColor: cor.googleMaps, borderColor: cor.googleMaps }]}
          />
          <Botao
            titulo="Waze"
            pequeno
            icone={<Ionicons name="car" size={18} color={cor.texto} />}
            aoTocar={() => Linking.openURL(waze)}
            estilo={[s.metade, { backgroundColor: cor.waze, borderColor: cor.waze }]}
            variante="contorno"
          />
        </View>
      ) : null}

      {ligar ? (
        <View style={{ gap: 4 }}>
          <View style={s.linha}>
            <Botao
              titulo="Ligar"
              pequeno
              variante="contorno"
              icone={<Ionicons name="call" size={18} color={cor.texto} />}
              aoTocar={() => Linking.openURL(ligar)}
              estilo={s.metade}
            />
            {whatsapp ? (
              <Botao
                titulo="WhatsApp"
                pequeno
                icone={<Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />}
                aoTocar={() => Linking.openURL(whatsapp)}
                estilo={[s.metade, { backgroundColor: cor.whatsapp, borderColor: cor.whatsapp }]}
              />
            ) : null}
          </View>
          {tel?.id ? (
            <Text style={s.idDoPedido}>
              📞 O Ligar já digita o ID depois do 0800. Se a central pedir de novo: <Text style={s.forte}>{tel.id}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}

      <Botao
        titulo="Confirmar entrega"
        variante="verde"
        carregando={ocupado}
        icone={<Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />}
        aoTocar={aoEntregar}
        estilo={{ minHeight: 58 }}
      />

      {podeDevolver ? <Botao titulo="Não vou levar este pedido" variante="perigo" pequeno aoTocar={aoDevolver} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  cartao: {
    backgroundColor: cor.cartao,
    borderRadius: raio.grande,
    borderWidth: 2,
    borderColor: cor.azul,
    padding: 14,
    gap: 10,
    boxShadow: "0 4px 10px rgba(37,99,235,0.12)",
  },
  cabeca: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ordem: { width: 30, height: 30, borderRadius: 15, backgroundColor: cor.azul, alignItems: "center", justifyContent: "center" },
  ordemTexto: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 },
  numero: { fontSize: 22, fontWeight: "900", color: cor.texto, fontVariant: ["tabular-nums"] },
  etiqueta: { backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: cor.borda, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  etiquetaTexto: { fontSize: 11, fontWeight: "800", color: cor.textoSuave },
  rota: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  rotaTexto: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
  canal: { backgroundColor: cor.azulClaro, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  canalTexto: { color: cor.azulEscuro, fontWeight: "800", fontSize: 12 },
  cliente: { fontSize: 17, fontWeight: "800", color: cor.texto },
  endereco: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: cor.azulClaro,
    borderWidth: 1,
    borderColor: cor.azulBorda,
    borderRadius: raio.pequeno,
    padding: 10,
  },
  enderecoTexto: { fontSize: 16, fontWeight: "800", color: cor.azulEscuro, lineHeight: 22 },
  enderecoDica: { fontSize: 12, fontWeight: "700", color: "#3B82F6", marginTop: 2 },
  urgencia: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: raio.pequeno, paddingHorizontal: 10, paddingVertical: 8 },
  urgenciaTexto: { fontSize: 15, fontWeight: "900", flexShrink: 1 },
  mapa: { height: 240, borderRadius: raio.medio, overflow: "hidden", borderWidth: 1, borderColor: cor.bordaForte },
  mapaAviso: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: cor.ambarClaro, color: cor.ambar, fontSize: 12, fontWeight: "700", padding: 6 },
  idDoPedido: { fontSize: 13, fontWeight: "700", color: cor.textoSuave, textAlign: "center" },
  pagamento: { backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: cor.borda, borderRadius: raio.pequeno, padding: 10, gap: 6 },
  pagamentoCobrar: { backgroundColor: cor.verdeClaro, borderColor: cor.verdeBorda, borderWidth: 2 },
  pagamentoTexto: { fontSize: 15, fontWeight: "700", color: "#334155" },
  valorGrande: { fontSize: 19, fontWeight: "900", color: cor.verdeEscuro },
  forte: { fontWeight: "900", color: cor.texto },
  troco: { backgroundColor: "#FEF3C7", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, alignSelf: "flex-start" },
  trocoTexto: { color: cor.ambar, fontWeight: "900", fontSize: 14 },
  obs: { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 9 },
  obsTexto: { fontSize: 14, fontWeight: "600", color: cor.textoSuave },
  sacolaBotao: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: raio.pequeno,
    borderWidth: 1.5,
    borderColor: cor.bordaForte,
    backgroundColor: "#F8FAFC",
  },
  sacolaBotaoAberto: { backgroundColor: cor.topo, borderColor: cor.topo },
  sacolaTitulo: { fontWeight: "900", fontSize: 15, color: cor.texto },
  sacolaResumo: { fontSize: 13, fontWeight: "700", color: cor.textoSuave },
  item: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: cor.borda, borderRadius: raio.pequeno, padding: 9, gap: 3 },
  itemBebida: { backgroundColor: cor.azulClaro, borderColor: cor.azulBorda },
  itemNome: { fontWeight: "900", fontSize: 15, color: cor.texto },
  itemEscolhas: { fontSize: 13, color: cor.textoSuave, fontWeight: "600", lineHeight: 19 },
  itemObs: { fontSize: 13, color: cor.ambar, fontWeight: "700" },
  linha: { flexDirection: "row", gap: 8 },
  metade: { flex: 1 },
});
