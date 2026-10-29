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
    private const val CHAVE_ID = "motoboy_id"
    private const val CHAVE_TROCAR_SENHA = "trocar_senha"

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

    /**
     * O id do cadastro, para trocar a senha. A sessão aberta na 1.0.4 não o
     * guardou: sai do próprio token (v1.<motoboyId>.<loja>.<validade>.<assinatura>).
     */
    fun motoboyId(context: Context): String? =
        abrir(context)?.getString(CHAVE_ID, null)?.ifBlank { null }
            ?: token(context)?.split(".")?.takeIf { it.size == 5 && it[0] == "v1" }?.get(1)?.ifBlank { null }

    /** Ainda na senha padrão (`mustChangePassword` do login): a lista pede a troca. */
    fun trocarSenha(context: Context): Boolean = abrir(context)?.getBoolean(CHAVE_TROCAR_SENHA, false) ?: false

    fun guardar(context: Context, token: String, nome: String?, login: String, motoboyId: String?, trocarSenha: Boolean) {
        abrir(context)?.edit()
            ?.putString(CHAVE_TOKEN, token)
            ?.putString(CHAVE_NOME, nome)
            ?.putString(CHAVE_LOGIN, login)
            ?.putString(CHAVE_ID, motoboyId)
            ?.putBoolean(CHAVE_TROCAR_SENHA, trocarSenha)
            ?.apply()
    }

    /**
     * Senha trocada: o token antigo deixou de valer e o servidor devolveu um
     * novo. Sem guardá-lo, a maquininha cai no próximo pedido de lista.
     */
    fun senhaTrocada(context: Context, tokenNovo: String?) {
        val edicao = abrir(context)?.edit() ?: return
        if (!tokenNovo.isNullOrBlank()) edicao.putString(CHAVE_TOKEN, tokenNovo)
        edicao.putBoolean(CHAVE_TROCAR_SENHA, false).apply()
    }

    fun sair(context: Context) {
        abrir(context)?.edit()?.remove(CHAVE_TOKEN)?.remove(CHAVE_NOME)?.remove(CHAVE_ID)?.remove(CHAVE_TROCAR_SENHA)?.apply()
    }
}
