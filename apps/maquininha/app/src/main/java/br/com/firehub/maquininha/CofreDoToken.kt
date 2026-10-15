package br.com.firehub.maquininha

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import br.com.firehub.maquininha.rede.IdentidadeDoTerminal

/**
 * Onde mora o crachá desta maquininha.
 *
 * O token de 64 caracteres não é uma preferência: é a credencial que autoriza
 * confirmar pagamento em nome da loja. Quem copiar esse texto consegue marcar
 * pedido como pago no FireHub daquele franqueado. Por isso ele fica em
 * EncryptedSharedPreferences, com a chave mestra dentro do Android Keystore —
 * que é o que o guia de boas práticas do PagBank exige, e o que impede que um
 * `adb pull` do arquivo de preferências entregue o crachá em texto puro.
 */
object CofreDoToken {

    private const val ETIQUETA = "CofreDoToken"
    private const val ARQUIVO = "cofre_do_terminal"

    private const val CHAVE_TOKEN = "token_do_terminal"
    private const val CHAVE_ROTULO = "rotulo_do_terminal"

    @Volatile
    private var cofre: SharedPreferences? = null

    /**
     * Abre (ou recria) o cofre.
     *
     * O Keystore pode perder a chave mestra: acontece em atualização de sistema
     * malsucedida e em reset de fábrica parcial. Quando isso ocorre, a abertura
     * estoura e o conteúdo antigo vira lixo indecifrável para sempre — não
     * adianta tentar de novo. A saída é apagar o arquivo e começar limpo, o que
     * derruba o app na tela de pareamento. É melhor pedir o código de novo ao
     * lojista do que ficar em laço de exceção sem nunca dizer o que houve.
     */
    @Synchronized
    private fun abrir(context: Context): SharedPreferences? {
        cofre?.let { return it }

        val app = context.applicationContext
        return try {
            criar(app).also { cofre = it }
        } catch (erro: Exception) {
            Log.e(ETIQUETA, "Cofre ilegível; recriando do zero.", erro)
            try {
                app.deleteSharedPreferences2(ARQUIVO)
                criar(app).also { cofre = it }
            } catch (erroFinal: Exception) {
                Log.e(ETIQUETA, "Não foi possível abrir o cofre nem depois de recriar.", erroFinal)
                null
            }
        }
    }

    private fun criar(app: Context): SharedPreferences {
        val chaveMestra = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        return EncryptedSharedPreferences.create(
            ARQUIVO,
            chaveMestra,
            app,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * deleteSharedPreferences só existe a partir da API 24, e o SK800 roda
     * Android 6 (API 23). Apagar o arquivo na mão cobre os dois casos.
     */
    private fun Context.deleteSharedPreferences2(nome: String) {
        val pasta = java.io.File(applicationInfo.dataDir, "shared_prefs")
        java.io.File(pasta, "$nome.xml").delete()
        java.io.File(pasta, "$nome.xml.bak").delete()
    }

    fun token(context: Context): String? {
        val valor = abrir(context)?.getString(CHAVE_TOKEN, null)
        return if (valor.isNullOrBlank()) null else valor
    }

    fun estaPareada(context: Context): Boolean = token(context) != null

    /**
     * Só chame depois que o servidor tiver respondido 200 para este token. Um
     * código errado gravado aqui deixa o app em laço de 401 até alguém ir até a
     * loja desinstalar.
     */
    fun guardar(context: Context, token: String, rotulo: String?) {
        val cofre = abrir(context) ?: return
        cofre.edit()
            .putString(CHAVE_TOKEN, token.trim())
            .putString(CHAVE_ROTULO, rotulo)
            .apply()
    }

    /**
     * O nome que o lojista deu à maquininha no painel, guardado para a tela de
     * ocioso ter o que mostrar antes da primeira resposta do servidor — inclusive
     * quando o app abre sem rede.
     */
    fun rotulo(context: Context): String? = abrir(context)?.getString(CHAVE_ROTULO, null)

    fun atualizarRotulo(context: Context, rotulo: String?) {
        if (rotulo.isNullOrBlank()) return
        if (rotulo == this.rotulo(context)) return
        abrir(context)?.edit()?.putString(CHAVE_ROTULO, rotulo)?.apply()
    }

    // ------------------------------------------------- identidade no FireHub

    private const val CHAVE_TERMINAL_ID = "id_do_terminal"
    private const val CHAVE_LOJA_SLUG = "slug_da_loja"

    /**
     * Cópia em memória do que está no disco. O polling chama atualizarIdentidade
     * a cada volta (de 2 em 2 segundos no Wi-Fi), e decifrar o arquivo toda vez
     * só para descobrir que nada mudou seria trabalho à toa.
     */
    @Volatile
    private var identidadeEmMemoria: IdentidadeDoTerminal? = null

    /** O id desta maquininha no FireHub, se o servidor já informou. */
    fun terminalId(context: Context): String? = identidade(context).terminalId

    /** O slug da loja a que esta maquininha pertence (usado no login do garçom). */
    fun lojaSlug(context: Context): String? = identidade(context).lojaSlug

    private fun identidade(context: Context): IdentidadeDoTerminal {
        identidadeEmMemoria?.let { return it }
        val cofre = abrir(context)
        val lida = IdentidadeDoTerminal(
            terminalId = cofre?.getString(CHAVE_TERMINAL_ID, null)?.ifBlank { null },
            lojaSlug = cofre?.getString(CHAVE_LOJA_SLUG, null)?.ifBlank { null },
        )
        identidadeEmMemoria = lida
        return lida
    }

    /**
     * Grava o que o polling contou. Campo nulo (servidor antigo, sem o campo)
     * NÃO apaga o que já estava gravado: sumir com o id por causa de uma
     * resposta incompleta deixaria o garçom sem conseguir cobrar.
     */
    fun atualizarIdentidade(context: Context, nova: IdentidadeDoTerminal?) {
        if (nova == null || (nova.terminalId == null && nova.lojaSlug == null)) return
        val atual = identidade(context)
        val mesclada = IdentidadeDoTerminal(
            terminalId = nova.terminalId ?: atual.terminalId,
            lojaSlug = nova.lojaSlug ?: atual.lojaSlug,
        )
        if (mesclada == atual) return
        identidadeEmMemoria = mesclada
        abrir(context)?.edit()
            ?.putString(CHAVE_TERMINAL_ID, mesclada.terminalId)
            ?.putString(CHAVE_LOJA_SLUG, mesclada.lojaSlug)
            ?.apply()
    }

    // NÃO existe aqui um "esquecer o token", e a ausência é deliberada.
    //
    // A tentação é apagar o crachá quando o servidor responde
    // TERMINAL_DESCONHECIDO. Só que, no exato momento em que isso acontece, pode
    // haver resultado de cartão preso na fila esperando ser enviado — e apagar o
    // token não o desprenderia, apenas tiraria a única pista de qual maquininha
    // ele é. O caminho que funciona é o lojista gerar um código novo no painel:
    // ele pertence à mesma maquininha, `guardar` sobrescreve o antigo, e a fila
    // drena sozinha logo depois do repareamento.
}
