// Atualização pelo ar (EAS Update): mudança de tela chega sem passar pelas lojas.
//
// O nativo já baixa sozinho ao abrir, mas só APLICA na próxima vez que o app
// for aberto do zero — e a loja deixa o app aberto o dia inteiro. Aqui a gente
// procura e aplica quando o app abre e quando volta para a frente depois de um
// tempo fora (mesmo desenho do app do entregador, apps/motoboy).
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** Não procurar de novo antes disto: cada consulta é uma ida à rede. */
const INTERVALO_MS = 10 * 60 * 1000;

async function procurarEAplicar() {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return;
    const baixada = await Updates.fetchUpdateAsync();
    if (baixada.isNew) await Updates.reloadAsync();
  } catch {
    // Sem rede ou servidor fora: segue com a versão que já está no celular.
  }
}

export function useAtualizacaoAutomatica() {
  const ultima = useRef(0);
  useEffect(() => {
    const talvez = () => {
      if (Date.now() - ultima.current < INTERVALO_MS) return;
      ultima.current = Date.now();
      void procurarEAplicar();
    };
    talvez();
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") talvez();
    });
    return () => sub.remove();
  }, []);
}
