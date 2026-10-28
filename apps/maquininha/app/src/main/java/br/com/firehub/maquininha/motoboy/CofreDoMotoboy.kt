package br.com.firehub.maquininha.motoboy

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * A sessão do motoboy na maquininha: o mesmo token do app do celular (Bearer,
 * 30 dias, cai se a senha mudar). Cifrado como o do garçom.
 */
object CofreDoMotoboy {

    private const val ETIQUETA = "CofreDoMotoboy"
    private const val ARQUIVO = "cofre_do_motoboy"
    private const val CHAVE_TOKEN = "token"
    private const val CHAVE_NOME = "nome"
    private const val CHAVE_LOGIN = "login"

    @Volatile
    private var cofre: SharedPreferences? = null

    @Synchronized
    private fun abrir(context: Context): SharedPreferences? {
        cofre?.let { return it }
        val app = context.applicationContext
        return try {
            criar(app).also { cofre = it }
        } catch (erro: Exception) {
            // Chave mestra perdida: o motoboy só precisa entrar de novo.
            Log.e(ETIQUETA, "Cofre do motoboy ilegível; recriando.", erro)
            try {
                val pasta = java.io.File(app.applicationInfo.dataDir, "shared_prefs")
                java.io.File(pasta, "$ARQUIVO.xml").delete()
                criar(app).also { cofre = it }
            } catch (erroFinal: Exception) {
                null
            }
        }
    }

    private fun criar(app: Context): SharedPreferences =
        EncryptedSharedPreferences.create(
            ARQUIVO,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            app,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )

    fun token(context: Context): String? = abrir(context)?.getString(CHAVE_TOKEN, null)?.ifBlank { null }
    fun nome(context: Context): String? = abrir(context)?.getString(CHAVE_NOME, null)?.ifBlank { null }
    fun ultimoLogin(context: Context): String? = abrir(context)?.getString(CHAVE_LOGIN, null)?.ifBlank { null }

    fun guardar(context: Context, token: String, nome: String?, login: String) {
        abrir(context)?.edit()
            ?.putString(CHAVE_TOKEN, token)
            ?.putString(CHAVE_NOME, nome)
            ?.putString(CHAVE_LOGIN, login)
            ?.apply()
    }

    fun sair(context: Context) {
        abrir(context)?.edit()?.remove(CHAVE_TOKEN)?.remove(CHAVE_NOME)?.apply()
    }
}
