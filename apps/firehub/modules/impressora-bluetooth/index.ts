/**
 * A impressora térmica Bluetooth (módulo nativo em android/; no iPhone só
 * responde que não imprime — ver ios/ImpressoraBluetoothModule.swift).
 */
import { requireNativeModule } from "expo-modules-core";

export type ImpressoraPareada = { nome: string; endereco: string };

type Modulo = {
  disponivel(): boolean;
  pareadas(): Promise<ImpressoraPareada[]>;
  /** Manda os bytes ESC/POS (base64). Lança com a mensagem para a tela. */
  imprimir(endereco: string, base64: string): Promise<boolean>;
  desconectar(): Promise<boolean>;
};

export default requireNativeModule<Modulo>("ImpressoraBluetooth");
