/**
 * A posição do entregador para o mapa da loja, COM A TELA APAGADA.
 *
 * É o motivo de o app nativo existir. Na página web, o navegador suspende o
 * JavaScript quando a tela apaga ou o entregador abre o Maps, e o rastreio
 * morre calado: "a localização dos caras para, mesmo que eles autorizem o
 * tempo todo; eles abrem o Maps e para" (lojista, 11/09/2026).
 *
 * Aqui a posição vem do serviço de localização do sistema:
 *   - Android: serviço em primeiro plano, com a notificação fixa "a loja está
 *     vendo sua localização". Ele segue com o Maps aberto e a tela apagada;
 *   - iPhone: atualização em segundo plano com o indicador azul no topo.
 *
 * Nos dois, basta a permissão "durante o uso": o serviço nasce de um toque do
 * entregador com o app na frente (expo-location, LocationModule.kt e
 * LocationModule.swift conferem isso). Não pedimos "permitir sempre", que é o
 * que mais trava a aprovação na Play e na App Store.
 *
 * A tarefa é definida no topo do módulo de propósito: o sistema pode acordar o
 * app só para entregar posições, sem tela nenhuma, e a tarefa tem de existir
 * antes de qualquer componente. Por isso o _layout importa este arquivo.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { chamar, ErroDaApi } from "./api";
import { INTERVALO_DO_GPS_MS, TAREFA_DO_GPS } from "./config";
import { lerSessao } from "./guardado";

let ultimoEnvio = 0;
let ultimaAceita: number | null = null;
const ouvintes = new Set<(quando: number) => void>();

/** A tela ouve para mostrar "posição enviada há 1 min". */
export function ouvirEnvios(fn: (quando: number) => void): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export const ultimaPosicaoAceita = () => ultimaAceita;

/**
 * Manda uma posição. `forcar` ignora o intervalo: a confirmação de entrega é
 * uma posição que vale a pena registrar sempre (o entregador está na porta).
 */
export async function enviarPosicao(lat: number, lng: number, forcar = false): Promise<void> {
  const agora = Date.now();
  if (!forcar && agora - ultimoEnvio < INTERVALO_DO_GPS_MS) return;
  ultimoEnvio = agora;
  const sessao = await lerSessao();
  if (!sessao) return;
  try {
    await chamar("/api/motoboys/location", { metodo: "POST", token: sessao.token, corpo: { lat, lng }, limite: 10_000 });
    ultimaAceita = Date.now();
    ouvintes.forEach((fn) => fn(ultimaAceita!));
  } catch (e) {
    // Sessão morta (senha trocada, cadastro desativado): o serviço para, senão
    // a notificação "a loja está vendo você" mentiria para sempre.
    if (e instanceof ErroDaApi && e.tipo === "sessao") await desligarGps();
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TAREFA_DO_GPS, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const maisRecente = data.locations[data.locations.length - 1];
  await enviarPosicao(maisRecente.coords.latitude, maisRecente.coords.longitude);
});

export type ResultadoDoGps =
  | { ok: true }
  | { ok: false; motivo: "negado" | "desligado-no-celular" | "erro"; mensagem: string };

/** Liga o rastreio. Tem de ser chamado com o app NA FRENTE (regra do Android 12+). */
export async function ligarGps(): Promise<ResultadoDoGps> {
  try {
    const servicos = await Location.hasServicesEnabledAsync();
    if (!servicos) {
      return { ok: false, motivo: "desligado-no-celular", mensagem: "A localização do celular está desligada. Ligue nas configurações rápidas." };
    }
    let permissao = await Location.getForegroundPermissionsAsync();
    if (!permissao.granted) permissao = await Location.requestForegroundPermissionsAsync();
    if (!permissao.granted) {
      return { ok: false, motivo: "negado", mensagem: "Sem a localização, a loja não te vê no mapa. Libere nas configurações do app." };
    }

    if (!(await Location.hasStartedLocationUpdatesAsync(TAREFA_DO_GPS).catch(() => false))) {
      await Location.startLocationUpdatesAsync(TAREFA_DO_GPS, {
        accuracy: Location.Accuracy.High,
        timeInterval: INTERVALO_DO_GPS_MS,
        distanceInterval: 25,
        activityType: Location.ActivityType.AutomotiveNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "Você está trabalhando",
          notificationBody: "A loja vê sua localização no mapa. Toque para abrir o app.",
          notificationColor: "#2563EB",
          killServiceOnDestroy: false,
        },
      });
    }

    // Uma posição já, sem esperar o primeiro movimento: é quando a loja mais
    // quer saber onde ele está.
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then((p) => enviarPosicao(p.coords.latitude, p.coords.longitude, true))
      .catch(() => {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, motivo: "erro", mensagem: `Não consegui ligar o GPS: ${e?.message || e}` };
  }
}

export async function desligarGps(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TAREFA_DO_GPS)) {
      await Location.stopLocationUpdatesAsync(TAREFA_DO_GPS);
    }
  } catch {
    // Já estava parado.
  }
}

export async function gpsLigado(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TAREFA_DO_GPS).catch(() => false);
}

/** Posição de agora, uma vez (a confirmação da entrega). Nunca lança. */
export async function registrarPosicaoAgora(): Promise<void> {
  try {
    const permissao = await Location.getForegroundPermissionsAsync();
    if (!permissao.granted) return;
    const p = await Location.getLastKnownPositionAsync({ maxAge: 30_000 }) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    if (p) await enviarPosicao(p.coords.latitude, p.coords.longitude, true);
  } catch {
    // A baixa não espera o GPS.
  }
}
