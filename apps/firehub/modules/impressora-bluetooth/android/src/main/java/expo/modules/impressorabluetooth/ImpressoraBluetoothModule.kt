package expo.modules.impressorabluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * A impressora térmica Bluetooth do celular da loja.
 *
 * A térmica comum (58/80 mm, "MPT-II", "PT-210", Knup, Elgin portátil) fala
 * Bluetooth CLÁSSICO, pelo perfil serial (SPP): pareia nas configurações do
 * Android e recebe os bytes ESC/POS por um socket RFCOMM. Os bytes já vêm
 * prontos do servidor (a mesma comanda do Assistente do PC); aqui é só abrir a
 * conexão e escrever.
 *
 * A conexão fica aberta entre uma comanda e outra (abrir leva 1 a 3 s). Se a
 * impressora desligou ou saiu de alcance, a escrita falha, a conexão é refeita
 * uma vez e, falhando de novo, o erro volta para o app — que guarda a comanda
 * e tenta de novo depois.
 */
class ImpressoraBluetoothModule : Module() {
  private val serial: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private var socket: BluetoothSocket? = null
  private var conectadoEm: String? = null
  private val trava = Any()

  private fun adaptador(): BluetoothAdapter? {
    val ctx = appContext.reactContext ?: return null
    val gerente = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return gerente?.adapter
  }

  private fun exigirAdaptador(): BluetoothAdapter {
    val a = adaptador() ?: throw CodedException("SEM_BLUETOOTH", "Este aparelho não tem Bluetooth.", null)
    if (!a.isEnabled) throw CodedException("BLUETOOTH_DESLIGADO", "Ligue o Bluetooth do celular.", null)
    return a
  }

  override fun definition() = ModuleDefinition {
    Name("ImpressoraBluetooth")

    Function("disponivel") {
      adaptador()?.isEnabled == true
    }

    // As impressoras já pareadas nas configurações do Android.
    AsyncFunction("pareadas") {
      try {
        exigirAdaptador().bondedDevices.map { mapOf("nome" to (it.name ?: it.address), "endereco" to it.address) }
      } catch (e: SecurityException) {
        throw CodedException("SEM_PERMISSAO", "Permita o acesso a \"Dispositivos por perto\" para o FireHub.", e)
      }
    }

    AsyncFunction("imprimir") { endereco: String, base64: String ->
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      synchronized(trava) {
        try {
          enviar(endereco, bytes)
        } catch (e: SecurityException) {
          throw CodedException("SEM_PERMISSAO", "Permita o acesso a \"Dispositivos por perto\" para o FireHub.", e)
        } catch (primeira: Exception) {
          // Conexão velha (impressora desligou e voltou): uma tentativa com conexão nova.
          fechar()
          try {
            enviar(endereco, bytes)
          } catch (e: Exception) {
            fechar()
            throw CodedException("NAO_IMPRIMIU", "A impressora não respondeu. Ela está ligada e perto do celular?", e)
          }
        }
      }
      true
    }

    AsyncFunction("desconectar") {
      synchronized(trava) { fechar() }
      true
    }

    OnDestroy {
      synchronized(trava) { fechar() }
    }
  }

  private fun enviar(endereco: String, bytes: ByteArray) {
    val saida = conectar(endereco).outputStream
    // Em pedaços: o buffer das térmicas baratas é pequeno, e um bloco grande
    // demais sai cortado no meio da comanda.
    var i = 0
    while (i < bytes.size) {
      val fim = minOf(i + 512, bytes.size)
      saida.write(bytes, i, fim - i)
      saida.flush()
      i = fim
      Thread.sleep(10)
    }
  }

  private fun conectar(endereco: String): BluetoothSocket {
    val atual = socket
    if (atual != null && atual.isConnected && conectadoEm == endereco) return atual
    fechar()
    val a = exigirAdaptador()
    a.cancelDiscovery()
    val aparelho = a.getRemoteDevice(endereco)
    val novo = try {
      aparelho.createRfcommSocketToServiceRecord(serial).also { it.connect() }
    } catch (e: Exception) {
      // Várias térmicas chinesas só aceitam o canal 1 direto.
      val metodo = aparelho.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
      (metodo.invoke(aparelho, 1) as BluetoothSocket).also { it.connect() }
    }
    socket = novo
    conectadoEm = endereco
    return novo
  }

  private fun fechar() {
    try {
      socket?.close()
    } catch (_: Exception) {
    }
    socket = null
    conectadoEm = null
  }
}
