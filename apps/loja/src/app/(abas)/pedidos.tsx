/**
 * Os pedidos feitos por este celular, com o andamento de cada um.
 * A lista vem do aparelho (lib/pedidos-guardados.ts); o status, do FireHub
 * (/api/app-da-loja/pedidos). Tocar abre o acompanhamento.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { estadoDosAvisos, type EstadoDosAvisos } from "@/lib/avisos";
import { marca, urlDoSite } from "@/lib/marca";
import { lerPedidos } from "@/lib/pedidos-guardados";

type Pedido = {
  id: string;
  status: string;
  numero: number | null;
  total: number;
  retirada: boolean;
  criadoEm: string;
  loja: string | null;
  slug: string | null;
  resumo: string;
};

/** O mesmo vocabulário da página de acompanhamento do site. */
function situacao(p: Pedido): { texto: string; cor: string; ativo: boolean } {
  const s = (p.status || "").toUpperCase();
  if (s === "CANCELADO" || s === "RECUSADO") return { texto: "Cancelado", cor: "#EF4444", ativo: false };
  if (s === "AGUARDANDO_PAGAMENTO") return { texto: "Aguardando pagamento", cor: "#F59E0B", ativo: true };
  if (s === "NOVO") return { texto: "Recebido", cor: "#3B82F6", ativo: true };
  if (s === "ACEITO") return { texto: "Confirmado", cor: "#10B981", ativo: true };
  if (s === "PREPARANDO") return { texto: "Em preparo", cor: "#F59E0B", ativo: true };
  if (s === "PRONTO") return p.retirada ? { texto: "Pronto para retirar", cor: "#8B5CF6", ativo: true } : { texto: "Pronto", cor: "#F59E0B", ativo: true };
  if (s === "SAIU_ENTREGA" || s === "SAIU_PARA_ENTREGA")
    return p.retirada ? { texto: "Pronto para retirar", cor: "#8B5CF6", ativo: true } : { texto: "Saiu para entrega", cor: "#8B5CF6", ativo: true };
  if (s === "ENTREGUE" || s === "FINALIZADO" || s === "CONCLUIDO")
    return { texto: p.retirada ? "Retirado" : "Entregue", cor: "#16A34A", ativo: false };
  return { texto: "Em andamento", cor: "#6B7280", ativo: true };
}

const reais = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

function quando(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}, ${hora}`;
}

export default function Pedidos() {
  const topo = useSafeAreaInsets().top;
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [avisos, setAvisos] = useState<EstadoDosAvisos>("indisponivel");
  const focada = useRef(false);

  const carregar = useCallback(async () => {
    const guardados = await lerPedidos();
    setAvisos(await estadoDosAvisos());
    if (guardados.length === 0) {
      setPedidos([]);
      return;
    }
    try {
      const res = await fetch(urlDoSite(`/api/app-da-loja/pedidos?ids=${guardados.map((g) => g.id).join(",")}`));
      const corpo = await res.json();
      const porId = new Map<string, Pedido>((corpo?.pedidos || []).map((p: Pedido) => [p.id, p]));
      // Na ordem em que foram feitos neste celular.
      setPedidos(guardados.map((g) => porId.get(g.id)).filter((p): p is Pedido => Boolean(p)));
    } catch {
      setPedidos((atual) => atual ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focada.current = true;
      carregar();
      return () => {
        focada.current = false;
      };
    }, [carregar]),
  );

  // Enquanto a aba está aberta e há pedido andando, o status se atualiza sozinho.
  useEffect(() => {
    const iv = setInterval(() => {
      if (focada.current && pedidos?.some((p) => situacao(p).ativo)) carregar();
    }, 20_000);
    return () => clearInterval(iv);
  }, [pedidos, carregar]);

  return (
    <View style={{ flex: 1, backgroundColor: "#F6F6F7" }}>
      <View style={{ paddingTop: topo, backgroundColor: marca.cor }}>
        <Text style={[estilos.cabecalho, { color: marca.corDoTexto }]}>Seus pedidos</Text>
      </View>

      {avisos === "desligados" && (
        <Pressable style={estilos.faixa} onPress={() => Linking.openSettings()}>
          <Ionicons name="notifications-off" size={20} color="#92400E" />
          <Text style={estilos.textoDaFaixa}>
            Os avisos estão desligados. Toque para ligar e saber quando o pedido sair para entrega.
          </Text>
        </Pressable>
      )}

      <FlatList
        data={pedidos ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            tintColor={marca.cor}
            onRefresh={async () => {
              setAtualizando(true);
              await carregar();
              setAtualizando(false);
            }}
          />
        }
        ListEmptyComponent={
          pedidos === null ? null : (
            <View style={estilos.vazio}>
              <Ionicons name="receipt-outline" size={48} color="#B0B0B0" />
              <Text style={estilos.tituloVazio}>Nenhum pedido ainda</Text>
              <Text style={estilos.textoVazio}>Os pedidos que você fizer pelo app aparecem aqui, com o andamento de cada um.</Text>
              <Pressable style={[estilos.botao, { backgroundColor: marca.cor }]} onPress={() => router.navigate("/")}>
                <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Ver cardápio</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => {
          const s = situacao(item);
          return (
            <Pressable
              style={estilos.cartao}
              onPress={() => router.push({ pathname: "/pedido/[id]", params: { id: item.id, slug: item.slug || "" } })}
            >
              <View style={estilos.linha}>
                <Text style={estilos.numero}>{item.numero ? `Pedido #${item.numero}` : "Pedido"}</Text>
                <View style={[estilos.selo, { backgroundColor: `${s.cor}1A` }]}>
                  <Text style={[estilos.textoDoSelo, { color: s.cor }]}>{s.texto}</Text>
                </View>
              </View>
              {!!item.resumo && (
                <Text style={estilos.resumo} numberOfLines={2}>
                  {item.resumo}
                </Text>
              )}
              <View style={estilos.linha}>
                <Text style={estilos.detalhe}>{quando(item.criadoEm)}</Text>
                <Text style={estilos.total}>{reais(item.total)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const estilos = StyleSheet.create({
  cabecalho: { fontSize: 20, fontWeight: "800", paddingHorizontal: 16, paddingVertical: 14 },
  faixa: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#FEF3C7", padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 12 },
  textoDaFaixa: { flex: 1, color: "#92400E", fontSize: 13 },
  cartao: { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  linha: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  numero: { fontSize: 16, fontWeight: "700", color: "#111" },
  selo: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  textoDoSelo: { fontSize: 12, fontWeight: "700" },
  resumo: { fontSize: 14, color: "#444" },
  detalhe: { fontSize: 13, color: "#777" },
  total: { fontSize: 15, fontWeight: "700", color: "#111" },
  vazio: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  tituloVazio: { fontSize: 18, fontWeight: "700", color: "#222" },
  textoVazio: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 8 },
  botao: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12 },
  textoDoBotao: { fontSize: 15, fontWeight: "700" },
});
