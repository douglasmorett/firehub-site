package br.com.firehub.maquininha.motoboy

import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.BuildConfig
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * As conversas do app FireHub Motoboy com o FireHub: as MESMAS rotas do app do
 * celular (/api/motoboys/...), com a mesma sessão (Bearer). Só a cobrança na
 * porta é nova: /api/motoboys/orders/[id]/maquininha e /receber.
 *
 * Tudo BLOQUEANTE: nunca chamar da thread principal (TrabalhoDeTela.fazer).
 */
object ApiDoMotoboy {

    private val IDENTIFICACAO = "FireHubMotoboy/" + BuildConfig.VERSAO_DO_APP + " (Android)"

    sealed class Resposta {
        data class Ok(val json: JSONObject) : Resposta()
        data class SessaoExpirada(val mensagem: String?) : Resposta()
        data class Recusada(val status: Int, val mensagem: String) : Resposta()
        data class SemRede(val mensagem: String) : Resposta()
    }

    fun entrar(slug: String, telefoneOuNome: String, senha: String): Resposta =
        executar(
            "/api/motoboys/login", "POST",
            JSONObject().put("storeSlug", slug).put("phone", telefoneOuNome).put("password", senha).toString(),
            token = null,
        )

    fun entregas(token: String): Resposta = executar("/api/motoboys/orders?formato=app", "GET", null, token)

    fun localizacao(token: String, lat: Double, lng: Double): Resposta =
        executar("/api/motoboys/location", "POST", JSONObject().put("lat", lat).put("lng", lng).toString(), token)

    fun situacaoDoRecebimento(token: String, pedidoId: String): Resposta =
        executar("/api/motoboys/orders/" + cod(pedidoId) + "/maquininha", "GET", null, token)

    fun cobrarNaMaquininha(token: String, pedidoId: String, valorReais: Double, terminalId: String): Resposta =
        executar(
            "/api/motoboys/orders/" + cod(pedidoId) + "/maquininha", "POST",
            JSONObject().put("valor", valorReais).put("terminalId", terminalId).toString(), token,
        )

    fun situacaoDaCobranca(token: String, pedidoId: String, cobrancaId: String): Resposta =
        executar("/api/motoboys/orders/" + cod(pedidoId) + "/maquininha?cobranca=" + cod(cobrancaId), "GET", null, token)

    fun cancelarCobranca(token: String, pedidoId: String, cobrancaId: String): Resposta =
        executar("/api/motoboys/orders/" + cod(pedidoId) + "/maquininha?cobranca=" + cod(cobrancaId), "DELETE", null, token)

    fun receber(token: String, pedidoId: String, dinheiroReais: Double, trocoPara: Double?): Resposta {
        val corpo = JSONObject().put("dinheiro", dinheiroReais)
        if (trocoPara != null) corpo.put("trocoPara", trocoPara)
        return executar("/api/motoboys/orders/" + cod(pedidoId) + "/receber", "POST", corpo.toString(), token)
    }

    /**
     * Marca entregue (PATCH de sempre). `pagamento` só quando a forma mudou e
     * NADA passou na maquininha — mandar `pagamento` apaga as partes gravadas.
     */
    fun entregar(token: String, pedidoId: String, codigo: String?, pagamento: String?): Resposta {
        val corpo = JSONObject().put("orderId", pedidoId)
        if (!codigo.isNullOrBlank()) corpo.put("codigo", codigo)
        if (!pagamento.isNullOrBlank()) corpo.put("pagamento", pagamento)
        return executar("/api/motoboys/orders", "PATCH", corpo.toString(), token)
    }

    private fun cod(v: String) = URLEncoder.encode(v, "UTF-8")

    private fun executar(caminho: String, metodo: String, corpo: String?, token: String?): Resposta {
        val (status, texto) = try {
            chamar(caminho, metodo, corpo, token)
        } catch (erro: Exception) {
            return Resposta.SemRede(
                when (erro) {
                    is java.net.SocketTimeoutException -> "O FireHub demorou para responder."
                    is java.net.UnknownHostException -> "Sem internet: não foi possível encontrar o FireHub."
                    is java.io.IOException -> "Sem conexão com o FireHub."
                    else -> erro.message ?: "Falha inesperada de rede."
                },
            )
        }
        val json = try {
            if (texto.trim().startsWith("{")) JSONObject(texto) else null
        } catch (e: Exception) {
            null
        }
        val mensagem = json?.let { textoDe(it, "mensagem") ?: textoDe(it, "error") }
        return when {
            status in 200..299 -> Resposta.Ok(json ?: JSONObject())
            status == 401 && json?.optBoolean("precisaLogin") == true -> Resposta.SessaoExpirada(mensagem)
            else -> Resposta.Recusada(status, mensagem ?: "O FireHub recusou (" + status + ").")
        }
    }

    private fun chamar(caminho: String, metodo: String, corpo: String?, token: String?): Pair<Int, String> {
        val conexao = URL(Ajustes.ENDERECO_DO_FIREHUB + caminho).openConnection() as HttpURLConnection
        // O HttpURLConnection do Android recusa PATCH; o "entregue" do motoboy é
        // PATCH (a mesma rota do app do celular). definirMetodoPatch contorna.
        if (metodo == "PATCH") definirMetodoPatch(conexao) else conexao.requestMethod = metodo
        conexao.connectTimeout = Ajustes.TEMPO_DE_CONEXAO_MS
        conexao.readTimeout = Ajustes.TEMPO_DE_LEITURA_MS
        conexao.useCaches = false
        conexao.instanceFollowRedirects = false
        conexao.setRequestProperty("Accept", "application/json")
        conexao.setRequestProperty("User-Agent", IDENTIFICACAO)
        if (token != null) conexao.setRequestProperty("Authorization", "Bearer $token")
        if (corpo != null) {
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = corpo.toByteArray(Charsets.UTF_8)
            conexao.setFixedLengthStreamingMode(bytes.size)
            conexao.outputStream.use { it.write(bytes) }
        }
        val status = conexao.responseCode
        val fonte: InputStream? = if (status in 200..399) conexao.inputStream else conexao.errorStream
        return status to (fonte?.use { it.bufferedReader(Charsets.UTF_8).readText() } ?: "")
    }

    private fun definirMetodoPatch(conexao: HttpURLConnection) {
        try {
            conexao.requestMethod = "PATCH"
        } catch (e: java.net.ProtocolException) {
            // Android antigo: o campo `method` aceita PATCH se escrito direto.
            val campo = HttpURLConnection::class.java.getDeclaredField("method")
            campo.isAccessible = true
            campo.set(conexao, "PATCH")
        }
    }
}

internal fun textoDe(json: JSONObject, chave: String): String? {
    if (!json.has(chave) || json.isNull(chave)) return null
    return json.optString(chave, "").ifBlank { null }
}
