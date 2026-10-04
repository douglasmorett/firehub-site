/**
 * As entregas do entregador — a tela do dia inteiro.
 *
 * O que ela herda da página web (/loja/[slug]/motoboy), com os mesmos motivos:
 *   - a lista na ordem em que ele RODA: a sequência que a loja montou no mapa,
 *     depois o pedido mais antigo;
 *   - sincronização VISÍVEL: antes da primeira resposta a tela não diz
 *     "nenhuma entrega", e falha de rede vira tarja, não silêncio;
 *   - baixa confirmada há menos de 30 s não "ressuscita" com uma resposta
 *     velha da lista (a loja pode reverter; trava eterna esconderia isso);
 *   - puxar pela comanda (QR ou número), com a confirmação mostrando só o
 *     NÚMERO, nunca dados do cliente antes de o pedido ser dele.
 *
 * O que só o app tem: GPS com a tela apagada (lib/gps.ts) e o aviso de pedido
 * novo com o celular no bolso (lib/notificacoes.ts).
 */
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAviso } from "@/components/Aviso";
import { Botao } from "@/components/Botao";
import { CartaoDoPedido } from "@/components/CartaoDoPedido";
import { Folha } from "@/components/Folha";
import { FluxoDaEntrega, type ExtraDaBaixa, type ResultadoDaBaixa } from "@/components/FluxoDaEntrega";
import { LeitorDeQr } from "@/components/LeitorDeQr";
import { cor, raio, reais } from "@/components/tema";
import { chamar, ErroDaApi, type ListaDePedidos, type Pedido, type RespostaDaBaixa } from "@/lib/api";
import { ATUALIZAR_LISTA_MS } from "@/lib/config";
import { gravarGpsPausado, lerGpsPausado } from "@/lib/guardado";
import { desligarGps, gpsLigado, ligarGps, ouvirEnvios, registrarPosicaoAgora, ultimaPosicaoAceita } from "@/lib/gps";
import { lerComanda } from "@/lib/loja";
import { registrarAvisos } from "@/lib/notificacoes";
import { useSessao } from "@/lib/sessao";

const FORMAS_PADRAO = ["Dinheiro", "Cartão Débito", "Cartão Crédito", "Pix", "Vale-refeição"];
const FINALIZADO = (s: string) => s === "ENTREGUE" || s === "ENCERRADO";
const CANCELADO = (s: string) => s === "CANCELADO" || s === "CANCELED" || s === "CANCELLED";
const SESSAO_CAIU = "Sua entrada terminou (senha trocada ou acesso encerrado pela loja). Entre de novo.";

type EstadoDoGps = "ligando" | "ligado" | "pausado" | "negado" | "desligado-no-celular";

/**
 * Onde o GPS deve estar agora. Pausado pelo entregador fica pausado (a não
 * ser que ele mesmo toque em Ligar); fora isso, liga.
 */
async function resolverGps(peloEntregador: boolean): Promise<{ estado: EstadoDoGps; erro?: string }> {
  if (!peloEntregador && (await lerGpsPausado())) return { estado: "pausado" };
  if (!peloEntregador && (await gpsLigado())) return { estado: "ligado" };
  const r = await ligarGps();
  if (r.ok) {
    await gravarGpsPausado(false);
    return { estado: "ligado" };
  }
  return {
    estado: r.motivo === "desligado-no-celular" ? "desligado-no-celular" : "negado",
    erro: r.motivo === "erro" ? r.mensagem : undefined,
  };
}

export default function Entregas() {
  const { sessao, sair } = useSessao();
  const { avisar } = useAviso();
  const params = useLocalSearchParams<{ puxar?: string }>();

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [formas, setFormas] = useState<string[]>(FORMAS_PADRAO);
  /** Os minutos de amarelo/vermelho da loja e o que ela liberou no app. */
  const [limites, setLimites] = useState<ListaDePedidos["alertaDeTempo"] | null>(null);
  const [permitirSemCodigo, setPermitirSemCodigo] = useState(true);
  const [sincronizou, setSincronizou] = useState(false);
  const [erroSync, setErroSync] = useState<"rede" | "servidor" | null>(null);
  const [ultimaSync, setUltimaSync] = useState<Date | null>(null);
  const [puxandoParaAtualizar, setPuxandoParaAtualizar] = useState(false);
  const [verConcluidas, setVerConcluidas] = useState(false);

  const falhasSeguidas = useRef(0);
  const reqId = useRef(0);
  /** Baixas confirmadas há < 30 s: a lista não pode ressuscitá-las. */
  const baixasLocais = useRef(new Map<string, number>());
  /** Trava por pedido: baixa no ar não aceita segundo toque. */
  const baixandoAgora = useRef(new Set<string>());

  const [emEntrega, setEmEntrega] = useState<Pedido | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  // QR de comanda escaneado na tela de entrar já nasce como a confirmação do puxar.
  const [codigoPuxar, setCodigoPuxar] = useState<string | null>(() => lerComanda(String(params.puxar || "")));
  const [puxando, setPuxando] = useState(false);
  const [teclado, setTeclado] = useState(false);
  const [tecladoValor, setTecladoValor] = useState("");
  const [lendo, setLendo] = useState(false);

  const [gps, setGps] = useState<EstadoDoGps>("ligando");
  const [ultimoGps, setUltimoGps] = useState<number | null>(ultimaPosicaoAceita());
  const [agora, setAgora] = useState(() => Date.now());
  // O relógio também anda quando a lista chega: o "Não vou levar" some na hora certa.
  const marcarAgora = useCallback(() => setAgora(Date.now()), []);

  // ── A lista ────────────────────────────────────────────────────────────────

  const aplicarBaixasLocais = useCallback((lista: Pedido[]) => {
    const t = Date.now();
    for (const [id, quando] of baixasLocais.current) if (t - quando > 30_000) baixasLocais.current.delete(id);
    if (baixasLocais.current.size === 0) return lista;
    return lista.map((o) =>
      baixasLocais.current.has(o.id) && !FINALIZADO(o.status) ? { ...o, status: "ENTREGUE" } : o,
    );
  }, []);

  const quandoSessaoCai = useCallback(
    async (e: unknown) => {
      if (e instanceof ErroDaApi && e.tipo === "sessao") {
        await sair(SESSAO_CAIU);
        router.replace("/entrar");
        return true;
      }
      return false;
    },
    [sair],
  );

  const atualizar = useCallback(async () => {
    if (!sessao) return;
    const id = ++reqId.current;
    try {
      const r = await chamar<ListaDePedidos>("/api/motoboys/orders?formato=app", { token: sessao.token });
      if (id !== reqId.current) return;
      const lista = r.orders || [];
      for (const o of lista) if (FINALIZADO(o.status)) baixasLocais.current.delete(o.id);
      setPedidos(aplicarBaixasLocais(lista));
      if (r.formasDePagamento?.length) setFormas(r.formasDePagamento);
      if (r.alertaDeTempo) setLimites(r.alertaDeTempo);
      setPermitirSemCodigo(r.appConfig?.permitirSemCodigo !== false);
      setSincronizou(true);
      setErroSync(null);
      setUltimaSync(new Date());
      marcarAgora();
      falhasSeguidas.current = 0;
    } catch (e) {
      if (id !== reqId.current) return;
      if (await quandoSessaoCai(e)) return;
      // Um 500 solto de reinício se cura no tique seguinte: só pinta a tarja na
      // SEGUNDA falha seguida.
      falhasSeguidas.current++;
      if (falhasSeguidas.current >= 2) setErroSync(e instanceof ErroDaApi && e.tipo === "rede" ? "rede" : "servidor");
    }
  }, [sessao, aplicarBaixasLocais, quandoSessaoCai, marcarAgora]);

  // Com a tela na frente: atualiza agora e a cada 10 s. No bolso, quem acorda
  // o entregador é o aviso — não gastar o 4G dele a cada 10 s.
  useFocusEffect(
    useCallback(() => {
      atualizar();
      const t = setInterval(() => {
        if (AppState.currentState === "active") atualizar();
      }, ATUALIZAR_LISTA_MS);
      return () => clearInterval(t);
    }, [atualizar]),
  );

  // Relógio da tela (o aviso "posição parada há 3 min" precisa andar).
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── GPS e avisos ───────────────────────────────────────────────────────────

  // A conta do estado do GPS fica fora do React; a tela só aplica o resultado
  // quando ele chega (o React Compiler não aceita setState síncrono em efeito).
  const aplicarGps = useCallback(
    (r: { estado: EstadoDoGps; erro?: string }) => {
      setGps(r.estado);
      if (r.erro) avisar(`⚠️ ${r.erro}`, "erro", 6000);
    },
    [avisar],
  );

  const ligar = useCallback(() => {
    setGps("ligando");
    resolverGps(true).then(aplicarGps);
  }, [aplicarGps]);

  const conferirGps = useCallback(() => {
    resolverGps(false).then(aplicarGps);
  }, [aplicarGps]);

  useEffect(() => {
    conferirGps();
    return ouvirEnvios((quando) => setUltimoGps(quando));
  }, [conferirGps]);

  // Volta ao app: lista e GPS na hora (o serviço pode ter sido parado pelo
  // sistema, ou a permissão mudada nas configurações).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado !== "active") return;
      atualizar();
      conferirGps();
    });
    return () => sub.remove();
  }, [atualizar, conferirGps]);

  // Avisos de pedido novo: registra o aparelho uma vez por sessão.
  const tokenRegistrado = useRef<string | null>(null);
  useEffect(() => {
    if (!sessao || tokenRegistrado.current === sessao.token) return;
    tokenRegistrado.current = sessao.token;
    registrarAvisos(sessao.token).then((r) => {
      if (!r.ok) avisar(`🔕 ${r.mensagem}`, "alerta", 6000);
    });
  }, [sessao, avisar]);

  // Chegou aviso (com o app aberto) ou ele tocou num aviso: a lista na hora.
  useEffect(() => {
    const recebido = Notifications.addNotificationReceivedListener(() => atualizar());
    const tocado = Notifications.addNotificationResponseReceivedListener(() => atualizar());
    return () => {
      recebido.remove();
      tocado.remove();
    };
  }, [atualizar]);

  // ── Ações ──────────────────────────────────────────────────────────────────

  async function puxar(codigo: string) {
    if (!sessao || puxando) return;
    setPuxando(true);
    try {
      const r = await chamar<any>("/api/motoboys/orders", { metodo: "POST", token: sessao.token, corpo: { codigo } });
      setCodigoPuxar(null);
      avisar(r.jaEraSeu ? "✅ Este pedido já era seu!" : `✅ Pedido #${r.numero} é seu! Boa entrega.`, "ok");
      atualizar();
    } catch (e) {
      if (await quandoSessaoCai(e)) return;
      if (e instanceof ErroDaApi && e.tipo === "rede") {
        avisar("⚠️ Sem conexão — o pedido NÃO foi puxado. Tente de novo.", "erro", 4500);
      } else {
        setCodigoPuxar(null);
        avisar(`⚠️ ${(e as Error)?.message || "Não consegui puxar. Confirme com a loja."}`, "erro", 5000);
      }
    } finally {
      setPuxando(false);
    }
  }

  function devolver(p: Pedido) {
    Alert.alert(`Devolver o pedido #${p.numero}?`, "Ele volta para a loja e sai da sua lista.", [
      { text: "Não", style: "cancel" },
      {
        text: "Devolver",
        style: "destructive",
        onPress: async () => {
          if (!sessao) return;
          try {
            await chamar("/api/motoboys/orders", { metodo: "DELETE", token: sessao.token, corpo: { orderId: p.id } });
            avisar("↩️ Pedido devolvido para a loja.", "ok");
            atualizar();
          } catch (e) {
            if (await quandoSessaoCai(e)) return;
            avisar(`⚠️ ${(e as Error)?.message || "Não consegui devolver."}`, "erro", 4500);
          }
        },
      },
    ]);
  }

  async function baixar(p: Pedido, extra: ExtraDaBaixa): Promise<ResultadoDaBaixa> {
    if (!sessao || baixandoAgora.current.has(p.id)) return { ok: false };
    baixandoAgora.current.add(p.id);
    setBaixando(p.id);
    // Confirmar a entrega É uma posição conhecida (ele está na porta do
    // cliente): fica no mapa mesmo que o rastreio tenha falhado. Sem esperar.
    registrarPosicaoAgora();
    try {
      const r = await chamar<RespostaDaBaixa>("/api/motoboys/orders", {
        metodo: "PATCH",
        token: sessao.token,
        corpo: { orderId: p.id, ...extra },
        limite: 30_000,
      });
      baixasLocais.current.set(p.id, Date.now());
      setPedidos((lista) => lista.map((o) => (o.id === p.id ? { ...o, status: "ENTREGUE" } : o)));
      if (r.avisoCodigo) avisar(`⚠️ ${r.avisoCodigo}`, "alerta", 7000);
      else avisar(r.jaEntregue ? "✅ Este pedido já estava confirmado." : `✅ Pedido #${p.numero} entregue!`, "ok");
      return { ok: true };
    } catch (e) {
      if (await quandoSessaoCai(e)) return { ok: false };
      if (e instanceof ErroDaApi) {
        if (e.corpo?.precisaCodigo) return { ok: false, precisaCodigo: true, canalDoCodigo: e.corpo.canalDoCodigo };
        if (e.corpo?.codigoIncorreto || e.corpo?.ifoodIndisponivel || e.corpo?.parceiroIndisponivel) {
          return { ok: false, erroNoCodigo: e.message };
        }
        avisar(
          e.tipo === "rede" ? "⚠️ Sem conexão — a entrega NÃO foi confirmada. Tente de novo." : `⚠️ ${e.message}`,
          "erro",
          5000,
        );
      }
      return { ok: false, erro: (e as Error)?.message };
    } finally {
      baixandoAgora.current.delete(p.id);
      setBaixando(null);
    }
  }

  // ── O que mostrar ──────────────────────────────────────────────────────────

  const ativos = useMemo(
    () =>
      pedidos
        .filter((o) => !FINALIZADO(o.status) && !CANCELADO(o.status))
        .sort((a, b) => {
          const sa = a.routeSequence ?? Infinity;
          const sb = b.routeSequence ?? Infinity;
          if (sa !== sb) return sa - sb;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }),
    [pedidos],
  );
  const concluidos = useMemo(() => pedidos.filter((o) => FINALIZADO(o.status)), [pedidos]);

  const gpsParado = gps === "ligado" && ultimoGps !== null && agora - ultimoGps > 120_000;
  const corDoGps = gps === "ligado" ? "#22C55E" : gps === "ligando" ? "#F59E0B" : gps === "pausado" ? "#94A3B8" : "#EF4444";
  const textoDoGps =
    gps === "ligado" ? "GPS ligado" : gps === "ligando" ? "Ligando o GPS…" : gps === "pausado" ? "GPS pausado" : "GPS desligado";

  if (!sessao) return null;

  return (
    <SafeAreaView style={s.tela} edges={["top"]}>
      <View style={s.topo}>
        <View style={s.avatar}>
          <Text style={{ fontSize: 22 }}>🛵</Text>
          <View style={[s.bolinha, { backgroundColor: corDoGps }]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.nome} numberOfLines={1}>
            {sessao.motoboyNome}
          </Text>
          <Text style={s.loja} numberOfLines={1}>
            <Text style={{ color: corDoGps, fontWeight: "900" }}>{textoDoGps}</Text> · {sessao.lojaNome}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            if (gps === "ligado") {
              Alert.alert("Pausar a localização?", "A loja deixa de te ver no mapa até você ligar de novo.", [
                { text: "Continuar ligado", style: "cancel" },
                {
                  text: "Pausar",
                  style: "destructive",
                  onPress: async () => {
                    await gravarGpsPausado(true);
                    await desligarGps();
                    setGps("pausado");
                  },
                },
              ]);
            } else ligar();
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: gps === "ligado" }}
          accessibilityLabel="Localização para a loja"
          style={[s.chave, gps === "ligado" ? s.chaveLigada : null]}
        >
          <Ionicons name={gps === "ligado" ? "location" : "location-outline"} size={18} color={gps === "ligado" ? "#052E16" : "#E2E8F0"} />
          <Text style={[s.chaveTexto, gps === "ligado" && { color: "#052E16" }]}>{gps === "ligado" ? "Ligado" : "Ligar"}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={s.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={puxandoParaAtualizar}
            onRefresh={async () => {
              setPuxandoParaAtualizar(true);
              await atualizar();
              setPuxandoParaAtualizar(false);
            }}
          />
        }
      >
        {sessao.trocarSenha ? (
          <Pressable onPress={() => router.navigate("/conta")} style={[s.tarja, s.tarjaAlerta]}>
            <Text style={s.tarjaAlertaTexto}>🔑 Você ainda usa a senha padrão. Toque aqui para trocar.</Text>
          </Pressable>
        ) : null}

        {gps === "negado" || gps === "desligado-no-celular" ? (
          <View style={[s.tarja, s.tarjaErro]}>
            <Text style={s.tarjaErroTexto}>
              📍{" "}
              {gps === "negado"
                ? "A localização está bloqueada para o app. Sem ela, a loja não te vê no mapa."
                : "A localização do celular está desligada. Ligue para a loja te ver no mapa."}
            </Text>
            <Botao
              titulo={gps === "negado" ? "Abrir configurações" : "Tentar de novo"}
              variante="contorno"
              pequeno
              aoTocar={() => {
                if (gps === "negado") Linking.openSettings();
                else ligar();
              }}
            />
          </View>
        ) : null}
        {gpsParado ? (
          <View style={[s.tarja, s.tarjaAlerta]}>
            <Text style={s.tarjaAlertaTexto}>
              📍 A loja não recebe sua posição há {Math.floor((agora - (ultimoGps || agora)) / 60_000)} min. Confira o sinal de internet.
            </Text>
          </View>
        ) : null}

        <View style={s.linha}>
          <Botao
            titulo="Escanear comanda"
            variante="roxo"
            icone={<Ionicons name="qr-code" size={20} color="#FFFFFF" />}
            aoTocar={() => setLendo(true)}
            estilo={{ flex: 1 }}
          />
          <Botao
            titulo="# Digitar"
            variante="contorno"
            aoTocar={() => {
              setTecladoValor("");
              setTeclado(true);
            }}
            estilo={{ borderColor: cor.roxoBorda }}
          />
        </View>

        <View style={s.contadores}>
          <View style={s.contador}>
            <Text style={s.contadorRotulo}>PENDENTES</Text>
            <Text style={[s.contadorValor, { color: cor.azul }]}>{sincronizou ? ativos.length : "–"}</Text>
          </View>
          <Pressable style={[s.contador, s.contadorDireita]} onPress={() => router.navigate("/relatorio")}>
            <Text style={s.contadorRotulo}>CONCLUÍDAS HOJE</Text>
            <Text style={[s.contadorValor, { color: cor.verde }]}>{sincronizou ? concluidos.length : "–"}</Text>
          </Pressable>
        </View>

        {erroSync ? (
          <Pressable onPress={atualizar} style={[s.tarja, s.tarjaErro]}>
            <Text style={s.tarjaErroTexto}>
              ⚠️ {erroSync === "rede" ? "Sem conexão" : "Erro no servidor"} — a lista pode estar desatualizada.
              {ultimaSync
                ? ` Última atualização: ${ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
                : ""}{" "}
              Toque para tentar agora.
            </Text>
          </Pressable>
        ) : null}

        <Text style={s.secao}>Minhas entregas ({ativos.length})</Text>

        {!sincronizou ? (
          <View style={s.vazio}>
            <Text style={s.vazioTitulo}>Carregando suas entregas…</Text>
          </View>
        ) : ativos.length === 0 ? (
          <View style={s.vazio}>
            <Ionicons name="cube-outline" size={44} color="#94A3B8" />
            <Text style={s.vazioTitulo}>Nenhuma entrega pendente</Text>
            <Text style={s.vazioTexto}>Quando a loja passar um pedido para você, o celular avisa.</Text>
          </View>
        ) : (
          ativos.map((p, i) => (
            <CartaoDoPedido
              key={p.id}
              pedido={p}
              ordem={i + 1}
              agora={agora}
              limites={limites ?? null}
              ocupado={baixando === p.id}
              aoEntregar={() => setEmEntrega(p)}
              aoDevolver={() => devolver(p)}
            />
          ))
        )}

        {concluidos.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Pressable onPress={() => setVerConcluidas((v) => !v)} style={s.concluidasBotao}>
              <Text style={s.secao}>Concluídas hoje ({concluidos.length})</Text>
              <Ionicons name={verConcluidas ? "chevron-up" : "chevron-down"} size={20} color={cor.textoApagado} />
            </Pressable>
            {verConcluidas
              ? concluidos.map((p) => (
                  <View key={p.id} style={s.concluida}>
                    <Ionicons name="checkmark-circle" size={20} color={cor.verde} />
                    <Text style={s.concluidaTexto} numberOfLines={1}>
                      #{p.numero} · {p.customerName}
                    </Text>
                    <Text style={s.concluidaValor}>{reais(p.totalAmount)}</Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>

      {/* Montado só enquanto aberto: cada entrega começa do primeiro passo. */}
      {emEntrega ? (
        <FluxoDaEntrega pedido={emEntrega} formas={formas} permitirSemCodigo={permitirSemCodigo} aoFechar={() => setEmEntrega(null)} baixar={baixar} />
      ) : null}

      <LeitorDeQr
        aberto={lendo}
        titulo="QR da comanda"
        dica="Aponte para o QR impresso na comanda do pedido."
        aoFechar={() => setLendo(false)}
        textoAlternativo="# Digitar o número"
        aoAlternativo={() => {
          setLendo(false);
          setTecladoValor("");
          setTeclado(true);
        }}
        aoLer={(texto) => {
          const c = lerComanda(texto);
          if (!c) return false;
          setLendo(false);
          setCodigoPuxar(c);
          return true;
        }}
      />

      <Folha aberta={teclado} aoFechar={() => setTeclado(false)}>
        <Text style={s.folhaTitulo}>Número da comanda</Text>
        <Text style={s.folhaTexto}>É o número grande no topo do papel.</Text>
        <TextInput
          value={tecladoValor}
          onChangeText={(t) => setTecladoValor(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoFocus
          placeholder="Ex: 47"
          placeholderTextColor="#94A3B8"
          style={s.campoNumero}
          onSubmitEditing={() => {
            if (!tecladoValor) return;
            setTeclado(false);
            setCodigoPuxar(tecladoValor);
          }}
          accessibilityLabel="Número da comanda"
        />
        <Botao
          titulo="Puxar pedido"
          variante="roxo"
          desabilitado={!tecladoValor}
          aoTocar={() => {
            setTeclado(false);
            setCodigoPuxar(tecladoValor);
          }}
        />
      </Folha>

      <Folha aberta={Boolean(codigoPuxar)} aoFechar={() => !puxando && setCodigoPuxar(null)}>
        <Text style={{ fontSize: 44, textAlign: "center" }}>🛵</Text>
        <Text style={s.folhaTitulo}>
          Puxar o pedido #{codigoPuxar?.includes("-") ? codigoPuxar.split("-")[1] : codigoPuxar}?
        </Text>
        <Text style={s.folhaTexto}>Ele entra na sua lista, a loja vê o seu nome nele e o cliente fica sabendo que saiu.</Text>
        <Botao
          titulo="Sim, é minha entrega"
          variante="roxo"
          carregando={puxando}
          aoTocar={() => codigoPuxar && puxar(codigoPuxar)}
        />
        <Botao titulo="Cancelar" variante="claro" desabilitado={puxando} aoTocar={() => setCodigoPuxar(null)} />
      </Folha>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.topo },
  topo: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: cor.topo },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: cor.topoSuave, alignItems: "center", justifyContent: "center" },
  bolinha: { position: "absolute", right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: cor.topo },
  nome: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  loja: { color: "#94A3B8", fontSize: 13, fontWeight: "600" },
  chave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: cor.topoSuave,
    borderWidth: 1.5,
    borderColor: "#334155",
  },
  chaveLigada: { backgroundColor: "#4ADE80", borderColor: "#4ADE80" },
  chaveTexto: { color: "#E2E8F0", fontWeight: "900", fontSize: 14 },
  conteudo: { backgroundColor: cor.fundo, padding: 14, gap: 12, paddingBottom: 40, flexGrow: 1 },
  linha: { flexDirection: "row", gap: 8 },
  contadores: { flexDirection: "row", backgroundColor: cor.cartao, borderRadius: raio.medio, borderWidth: 1, borderColor: cor.borda, overflow: "hidden" },
  contador: { flex: 1, alignItems: "center", paddingVertical: 12 },
  contadorDireita: { borderLeftWidth: 1, borderLeftColor: cor.borda },
  contadorRotulo: { fontSize: 11, fontWeight: "800", color: cor.textoApagado, letterSpacing: 0.5 },
  contadorValor: { fontSize: 30, fontWeight: "900", fontVariant: ["tabular-nums"] },
  secao: { fontSize: 18, fontWeight: "900", color: cor.texto },
  vazio: { backgroundColor: cor.cartao, borderRadius: raio.medio, borderWidth: 1, borderColor: cor.borda, padding: 28, alignItems: "center", gap: 6 },
  vazioTitulo: { fontSize: 16, fontWeight: "800", color: "#334155" },
  vazioTexto: { fontSize: 14, color: cor.textoApagado, textAlign: "center" },
  tarja: { borderRadius: raio.medio, borderWidth: 1.5, padding: 12, gap: 8 },
  tarjaErro: { backgroundColor: cor.vermelhoClaro, borderColor: cor.vermelhoBorda },
  tarjaErroTexto: { color: cor.vermelho, fontWeight: "800", fontSize: 14, lineHeight: 20 },
  tarjaAlerta: { backgroundColor: cor.ambarClaro, borderColor: cor.ambarBorda },
  tarjaAlertaTexto: { color: cor.ambar, fontWeight: "800", fontSize: 14, lineHeight: 20 },
  concluidasBotao: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  concluida: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: cor.cartao, borderRadius: raio.pequeno, borderWidth: 1, borderColor: cor.borda, padding: 12 },
  concluidaTexto: { flex: 1, fontSize: 15, fontWeight: "700", color: cor.texto },
  concluidaValor: { fontSize: 14, fontWeight: "800", color: cor.textoSuave },
  folhaTitulo: { fontSize: 21, fontWeight: "900", color: cor.texto, textAlign: "center" },
  folhaTexto: { fontSize: 14, color: cor.textoApagado, textAlign: "center", fontWeight: "600" },
  campoNumero: {
    fontSize: 32,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
    borderWidth: 2,
    borderColor: cor.bordaForte,
    borderRadius: raio.medio,
    paddingVertical: 12,
    color: cor.texto,
  },
});
