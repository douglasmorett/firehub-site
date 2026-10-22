import ExpoModulesCore

// iPhone: a térmica Bluetooth barata é Bluetooth clássico (SPP), e o iOS só
// abre Bluetooth clássico a acessório certificado pela Apple (MFi). Por isso
// aqui o módulo existe só para o app abrir e dizer que não imprime.
public class ImpressoraBluetoothModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImpressoraBluetooth")
    Function("disponivel") { false }
    AsyncFunction("pareadas") { () -> [[String: String]] in [] }
    AsyncFunction("imprimir") { (_ endereco: String, _ base64: String) -> Bool in false }
    AsyncFunction("desconectar") { () -> Bool in true }
  }
}
