package br.com.firehub.maquininha.garcom

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/**
 * Onde mora a sessão do garçom: o cookie que /api/garcom/login devolve.
 *
 * O cookie é a credencial do garçom por 30 dias (lib/garcom-auth.ts no
 * servidor): quem o copiar abre mesa e lança item em nome dele. Por isso vai no
 * mesmo tipo de cofre do token da maquininha (EncryptedSharedPreferences com a
 * chave no Android Keystore), mas num ARQUIVO SEPARADO: sair do modo garçom
 * apaga este arquivo inteiro e não pode, nem por engano, encostar no crachá da
 * maquininha.
 */
object CofreDoGarcom {

    private const val ETIQUETA = "CofreDoGarcom"
    private const val ARQUIVO = "cofre_do_garcom"

    private const val CHAVE_COOKIE = "cookie"
    private const val CHAVE_NOME = "nome"
    private const val CHAVE_SLUG = "slug"
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
            // Chave mestra perdida: o conteúdo antigo é lixo. O garçom só
            // precisa entrar de novo.
            Log.e(ETIQUETA, "Cofre do garçom ilegível; recriando.", erro)
            try {
                val pasta = java.io.File(app.applicationInfo.dataDir, "shared_prefs")
                java.io.File(pasta, "$ARQUIVO.xml").delete()
                java.io.File(pasta, "$ARQUIVO.xml.bak").delete()
                criar(app).also { cofre = it }
            } catch (erroFinal: Exception) {
                Log.e(ETIQUETA, "Não foi possível abrir o cofre do garçom.", erroFinal)
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

    /** "nome=valor", pronto para o cabeçalho Cookie. Nulo = ninguém logado. */
    fun cookie(context: Context): String? = abrir(context)?.getString(CHAVE_COOKIE, null)?.ifBlank { null }

    fun nome(context: Context): String? = abrir(context)?.getString(CHAVE_NOME, null)?.ifBlank { null }

    /** A loja em que o garçom entrou. Se a maquininha mudar de loja, a sessão não vale. */
    fun slug(context: Context): String? = abrir(context)?.getString(CHAVE_SLUG, null)?.ifBlank { null }

    /** O último usuário digitado, para o garçom não redigitar a cada turno. */
    fun ultimoLogin(context: Context): String? = abrir(context)?.getString(CHAVE_LOGIN, null)?.ifBlank { null }

    fun guardar(context: Context, cookie: String, nome: String?, slug: String, login: String) {
        abrir(context)?.edit()
            ?.putString(CHAVE_COOKIE, cookie)
            ?.putString(CHAVE_NOME, nome)
            ?.putString(CHAVE_SLUG, slug)
            ?.putString(CHAVE_LOGIN, login)
            ?.apply()
    }

    fun atualizarNome(context: Context, nome: String?) {
        if (nome.isNullOrBlank() || nome == nome(context)) return
        abrir(context)?.edit()?.putString(CHAVE_NOME, nome)?.apply()
    }

    /** Sai: apaga o cookie e o nome, guarda só o último usuário digitado. */
    fun esquecerSessao(context: Context) {
        abrir(context)?.edit()
            ?.remove(CHAVE_COOKIE)
            ?.remove(CHAVE_NOME)
            ?.apply()
    }
}
