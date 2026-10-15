package br.com.firehub.maquininha.garcom

import android.util.Log
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * As conversas do modo garçom com o FireHub.
 *
 * Nenhuma rota nova: são as MESMAS que a tela web do garçom
 * (/garcom/<slug>/mesas) usa, com a mesma credencial — o cookie de
 * /api/garcom/login — e o mesmo cabeçalho `x-operador: garcom`, que obriga o
 * servidor a operar com o cookie do garçom e nada mais (lib/garcom-auth.ts,
 * `resolverOperadorDaMesa`).
 *
 * Tudo aqui é BLOQUEANTE: nunca chamar da thread principal.
 */
object ApiDoGarcom {

    private const val ETIQUETA = "ApiDoGarcom"
    private val IDENTIFICACAO = "FireHubMaquininha/" + BuildConfig.VERSAO_DO_APP + " (Android; garcom)"

    /** O nome do cookie muda com HTTPS (`__Secure-`); os dois terminam assim. */
    private const val FIM_DO_NOME_DO_COOKIE = "firehub_garcom"

    sealed class Resposta {
        /** 2xx. `corpo` é o texto cru; `json`/`lista` quando for JSON. */
        data class Ok(val status: Int, val json: JSONObject?, val lista: JSONArray?) : Resposta()

        /** 401: cookie vencido, senha trocada, caixa fechado. Volta ao login. */
        data class SessaoExpirada(val mensagem: String?) : Resposta()

        /** O servidor entendeu e disse não (400, 403, 404, 409, 500...). */
        data class Recusada(val status: Int, val codigo: String?, val mensagem: String) : Resposta()

        data class SemRede(val mensagem: String) : Resposta()
    }

    sealed class Entrada {
        data class Ok(val cookie: String, val nome: String?) : Entrada()
        data class Recusada(val mensagem: String) : Entrada()
        data class SemRede(val mensagem: String) : Entrada()
    }

    // ------------------------------------------------------------------ login

    fun entrar(slug: String, login: String, senha: String): Entrada {
        val corpo = JSONObject().apply {
            put("slug", slug)
            put("login", login)
            put("senha", senha)
        }
        val r = try {
            chamar("/api/garcom/login", "POST", corpo.toString(), cookie = null)
        } catch (erro: Exception) {
            return Entrada.SemRede(descreverFalha(erro))
        }
        val json = r.json()
        if (r.status !in 200..299) {
            return Entrada.Recusada(
                json?.let { mensagemDe(it) } ?: ("O servidor respondeu " + r.status + "."),
            )
        }
        val cookie = r.cookieDoGarcom
            ?: return Entrada.Recusada("O FireHub aceitou o login mas não devolveu a sessão. Tente de novo.")
        val nome = json?.optJSONObject("garcom")?.let { texto(it, "name") }
        return Entrada.Ok(cookie, nome)
    }

    fun sair(cookie: String) {
        try {
            chamar("/api/garcom/logout", "POST", "{}", cookie)
        } catch (erro: Exception) {
            // Sair é local de qualquer jeito: o cookie é apagado do cofre.
            Log.i(ETIQUETA, "Logout sem rede; a sessão foi apagada só no aparelho.")
        }
    }

    // --------------------------------------------------------------- genérico

    fun get(caminho: String, cookie: String): Resposta = executar(caminho, "GET", null, cookie)

    fun post(caminho: String, corpo: JSONObject, cookie: String): Resposta =
        executar(caminho, "POST", corpo.toString(), cookie)

    fun delete(caminho: String, cookie: String): Resposta = executar(caminho, "DELETE", null, cookie)

    fun codificar(valor: String): String = URLEncoder.encode(valor, "UTF-8")

    private fun executar(caminho: String, metodo: String, corpo: String?, cookie: String): Resposta {
        val r = try {
            chamar(caminho, metodo, corpo, cookie)
        } catch (erro: Exception) {
            return Resposta.SemRede(descreverFalha(erro))
        }
        val texto = r.corpo.trim()
        val json = r.json()
        val lista = if (texto.startsWith("[")) {
            try { JSONArray(texto) } catch (e: Exception) { null }
        } else null

        return when {
            r.status in 200..299 -> Resposta.Ok(r.status, json, lista)
            r.status == 401 -> Resposta.SessaoExpirada(json?.let { mensagemDe(it) })
            else -> Resposta.Recusada(
                status = r.status,
                // `{ error: "TERMINAL_OFFLINE", mensagem }`: nessa forma o código
                // está em `error`, e só vale como código se parecer um.
                codigo = json?.let {
                    texto(it, "codigo") ?: texto(it, "code")
                        ?: texto(it, "error")?.takeIf { e -> e.matches(Regex("^[A-Z_]{3,}$")) }
                },
                mensagem = json?.let { mensagemDe(it) }
                    ?: if (r.status >= 500) "O FireHub teve um problema (" + r.status + "). Tente de novo."
                    else "O FireHub recusou (" + r.status + ").",
            )
        }
    }

    /**
     * As rotas de mesa respondem erro de dois jeitos: `{ error: "texto" }` e
     * `{ error: "CODIGO", mensagem: "texto" }`. A mensagem legível vence.
     */
    private fun mensagemDe(json: JSONObject): String? =
        texto(json, "mensagem") ?: texto(json, "erro") ?: texto(json, "error")

    // ---------------------------------------------------------------- interno

    private class Bruta(val status: Int, val corpo: String, val cookieDoGarcom: String?) {
        fun json(): JSONObject? = try {
            val t = corpo.trim()
            if (t.startsWith("{")) JSONObject(t) else null
        } catch (erro: Exception) {
            null
        }
    }

    private fun chamar(caminho: String, metodo: String, corpo: String?, cookie: String?): Bruta {
        val conexao = URL(Ajustes.ENDERECO_DO_FIREHUB + caminho).openConnection() as HttpURLConnection
        conexao.requestMethod = metodo
        conexao.connectTimeout = Ajustes.TEMPO_DE_CONEXAO_MS
        conexao.readTimeout = Ajustes.TEMPO_DE_LEITURA_MS
        conexao.useCaches = false
        conexao.instanceFollowRedirects = false
        conexao.setRequestProperty("Accept", "application/json")
        conexao.setRequestProperty("User-Agent", IDENTIFICACAO)
        // A tela do garçom se identifica em toda chamada: com isto o servidor
        // só aceita o cookie do garçom (nunca uma sessão do painel).
        conexao.setRequestProperty("x-operador", "garcom")
        if (cookie != null) conexao.setRequestProperty("Cookie", cookie)

        if (corpo != null) {
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = corpo.toByteArray(Charsets.UTF_8)
            conexao.setFixedLengthStreamingMode(bytes.size)
            conexao.outputStream.use { it.write(bytes) }
        }

        val status = conexao.responseCode
        val novoCookie = conexao.headerFields
            ?.filterKeys { it != null && it.equals("Set-Cookie", ignoreCase = true) }
            ?.values?.flatten()
            ?.map { it.substringBefore(';').trim() }
            ?.firstOrNull { it.substringBefore('=').endsWith(FIM_DO_NOME_DO_COOKIE) && it.substringAfter('=', "").isNotEmpty() }

        val fonte: InputStream? = if (status in 200..399) conexao.inputStream else conexao.errorStream
        val texto = fonte?.use { it.bufferedReader(Charsets.UTF_8).readText() } ?: ""
        return Bruta(status, texto, novoCookie)
    }

    private fun descreverFalha(erro: Exception): String = when (erro) {
        is java.net.SocketTimeoutException -> "O FireHub demorou para responder."
        is java.net.UnknownHostException -> "Sem internet: não foi possível encontrar o FireHub."
        is javax.net.ssl.SSLException -> "Falha na conexão segura com o FireHub."
        is java.io.IOException -> "Sem conexão com o FireHub."
        else -> erro.message ?: "Falha inesperada de rede."
    }
}

/** optString devolve "null" para campo nulo; este não. */
internal fun texto(json: JSONObject, chave: String): String? {
    if (!json.has(chave) || json.isNull(chave)) return null
    return json.optString(chave, "").ifBlank { null }
}

internal fun numero(json: JSONObject, chave: String): Double? {
    if (!json.has(chave) || json.isNull(chave)) return null
    val v = json.optDouble(chave)
    return if (v.isNaN()) null else v
}
