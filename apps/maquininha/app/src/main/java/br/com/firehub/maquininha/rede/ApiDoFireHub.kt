package br.com.firehub.maquininha.rede

import android.util.Log
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.BuildConfig
import org.json.JSONObject
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * As duas únicas conversas que este app tem com o FireHub.
 *
 * Sem OkHttp e sem Retrofit: HttpURLConnection já vem no Android, e cada SDK de
 * terceiro a mais é uma pergunta a mais na análise de homologação do PagBank.
 * São duas rotas e dois JSONs pequenos.
 *
 * Tudo aqui é BLOQUEANTE. Nenhum método desta classe pode ser chamado da thread
 * principal.
 */
object ApiDoFireHub {

    private const val ETIQUETA = "ApiDoFireHub"
    private val IDENTIFICACAO = "FireHubMaquininha/" + BuildConfig.VERSAO_DO_APP + " (Android)"

    /**
     * Pergunta se tem cobrança esperando.
     *
     * Efeito colateral importante: se houver cobrança, esta chamada JÁ A RESERVA
     * no servidor. Não existe "só espiar". Quem chamar isto é responsável por
     * dar um destino à cobrança que voltar: cobrar, ou devolver para a fila com
     * um resultado recusado. Ignorar a resposta deixa o pedido preso por cinco
     * minutos, com o cliente esperando na frente do totem.
     */
    fun buscarCobranca(token: String): RespostaDaFila {
        val endereco = Ajustes.ENDERECO_DO_FIREHUB + Ajustes.CAMINHO_DA_FILA +
            "?token=" + URLEncoder.encode(token, "UTF-8") +
            "&versao=" + URLEncoder.encode(BuildConfig.VERSAO_DO_APP, "UTF-8")

        val resposta = try {
            chamar(endereco, "GET", null)
        } catch (erro: Exception) {
            return RespostaDaFila.FalhaDeRede(descreverFalha(erro))
        }

        val json = resposta.comoJson()

        return when {
            resposta.status == 200 && json != null -> {
                val terminal = json.textoOuNulo("terminal")
                val cobranca = json.optJSONObject("cobranca")
                if (cobranca == null) {
                    RespostaDaFila.SemCobranca(terminal)
                } else {
                    RespostaDaFila.ComCobranca(lerCobranca(cobranca), terminal)
                }
            }

            // 401 e 403 são as duas paradas definitivas: token que não existe
            // mais, e maquininha desativada no painel. Nos dois casos o app tem
            // que parar de perguntar, porque tentar de novo daqui a dois
            // segundos não muda nada e só queima franquia de dados.
            resposta.status == 401 || resposta.status == 403 ->
                RespostaDaFila.CredencialInvalida(
                    codigo = json?.textoOuNulo("code") ?: "SEM_CODIGO",
                    mensagem = json?.textoOuNulo("error") ?: "Credencial recusada pelo servidor.",
                )

            // 400 TOKEN_AUSENTE cai aqui: só acontece com token curto demais, o
            // que significa cofre corrompido. Tratar como credencial inválida
            // manda o app para a tela de pareamento, que é a única saída.
            resposta.status == 400 ->
                RespostaDaFila.CredencialInvalida(
                    codigo = json?.textoOuNulo("code") ?: "TOKEN_AUSENTE",
                    mensagem = json?.textoOuNulo("error") ?: "Token inválido.",
                )

            else -> RespostaDaFila.ErroDoServidor(
                status = resposta.status,
                mensagem = json?.textoOuNulo("error")
                    ?: ("O servidor respondeu " + resposta.status + "."),
            )
        }
    }

    private fun lerCobranca(json: JSONObject) = Cobranca(
        pedidoId = json.getString("pedidoId"),
        valorEmCentavos = json.getInt("valorEmCentavos"),
        descricao = json.textoOuNulo("descricao") ?: "Pedido",
        cliente = json.textoOuNulo("cliente"),
        tentativa = json.optInt("tentativa", 1),
        // Se o servidor um dia parar de mandar a referência, montar aqui é
        // melhor do que enviar vazio: esse campo é o que amarra este resultado a
        // esta tentativa quando o app reenvia depois de uma queda de rede.
        referencia = json.textoOuNulo("referencia")
            ?: (json.getString("pedidoId") + ":" + json.optInt("tentativa", 1)),
    )

    /**
     * Devolve o que aconteceu com o cartão.
     *
     * A rota é idempotente: reenviar um resultado já confirmado responde
     * jaConfirmado. É isso que autoriza o app a insistir para sempre num
     * resultado aprovado, sem medo de liberar o pedido duas vezes.
     */
    fun enviarResultado(token: String, resultado: ResultadoDeCobranca): RespostaDoResultado {
        val endereco = Ajustes.ENDERECO_DO_FIREHUB + Ajustes.CAMINHO_DO_RESULTADO

        val resposta = try {
            chamar(endereco, "POST", resultado.corpoDoPost(token).toString())
        } catch (erro: Exception) {
            return RespostaDoResultado.FalhaDeRede(descreverFalha(erro))
        }

        val json = resposta.comoJson()

        return when {
            resposta.status == 200 && json != null -> when {
                json.optBoolean("jaConfirmado", false) -> RespostaDoResultado.JaConfirmado
                json.optBoolean("aprovado", false) -> RespostaDoResultado.Confirmado(
                    numeroDoPedido = if (json.isNull("numero")) null else json.get("numero").toString(),
                )
                else -> RespostaDoResultado.RecusaRegistrada(
                    podeTentarDeNovo = json.optBoolean("podeTentarDeNovo", true),
                    motivo = json.textoOuNulo("motivo"),
                )
            }

            // O 403 desta rota é ambíguo: pode ser a maquininha desativada no
            // painel (que vem com "code"), ou o pedido ser de outra loja (que
            // vem sem). O primeiro caso pede repareamento; o segundo é um
            // resultado que nunca vai ser aceito e precisa de gente olhando.
            resposta.status == 401 || (resposta.status == 403 && json?.textoOuNulo("code") != null) ->
                RespostaDoResultado.CredencialInvalida(
                    codigo = json?.textoOuNulo("code") ?: "SEM_CODIGO",
                    mensagem = json?.textoOuNulo("error") ?: "Credencial recusada pelo servidor.",
                )

            // 400 (pedidoId faltando), 403 (pedido de outra loja), 404 (pedido
            // sumiu) e 409 (a cobrança foi parar em outra maquininha). O
            // servidor entendeu e disse não: reenviar amanhã dá a mesma
            // resposta, então insistir só gasta rede.
            resposta.status == 400 || resposta.status == 403 ||
                resposta.status == 404 || resposta.status == 409 ->
                RespostaDoResultado.RejeitadoDefinitivamente(
                    status = resposta.status,
                    mensagem = json?.textoOuNulo("error") ?: "O servidor recusou o resultado.",
                )

            // 500, e também qualquer resposta que não seja JSON (página de erro
            // do proxy, contêiner subindo). Entram como falha de rede porque são
            // exatamente isso: temporárias, e merecem reenvio.
            else -> RespostaDoResultado.FalhaDeRede("O servidor respondeu " + resposta.status + ".")
        }
    }

    // ---------------------------------------------------------------- interno

    private class Resposta(val status: Int, val corpo: String) {
        fun comoJson(): JSONObject? = try {
            if (corpo.isBlank()) null else JSONObject(corpo)
        } catch (erro: Exception) {
            // Acontece de verdade: enquanto o contêiner do FireHub está subindo,
            // o proxy devolve uma página HTML com status 502. Tratar como "sem
            // JSON" evita derrubar o laço de polling com exceção.
            Log.w(ETIQUETA, "Resposta não era JSON: " + corpo.take(120))
            null
        }
    }

    private fun chamar(endereco: String, metodo: String, corpo: String?): Resposta {
        val conexao = URL(endereco).openConnection() as HttpURLConnection
        conexao.requestMethod = metodo
        conexao.connectTimeout = Ajustes.TEMPO_DE_CONEXAO_MS
        conexao.readTimeout = Ajustes.TEMPO_DE_LEITURA_MS
        conexao.useCaches = false
        conexao.instanceFollowRedirects = false
        conexao.setRequestProperty("Accept", "application/json")
        conexao.setRequestProperty("User-Agent", IDENTIFICACAO)

        if (corpo != null) {
            conexao.doOutput = true
            conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            val bytes = corpo.toByteArray(Charsets.UTF_8)
            // Comprimento fixo em vez de chunked: com chunked o Android manda o
            // corpo em pedaços, cada um com cabeçalho próprio, e num POST de 300
            // bytes isso é peso puro na franquia do chip.
            conexao.setFixedLengthStreamingMode(bytes.size)
            conexao.outputStream.use { saida -> saida.write(bytes) }
        }

        val status = conexao.responseCode
        val fonte: InputStream? = if (status in 200..399) conexao.inputStream else conexao.errorStream
        val texto = fonte?.use { entrada -> lerTudo(entrada) } ?: ""

        // De propósito NÃO chamamos conexao.disconnect(). disconnect() fecha o
        // socket, e fechar o socket obriga a próxima consulta a refazer o
        // handshake TLS inteiro: cerca de 4 KB, contra os 800 bytes de uma
        // consulta em conexão reaproveitada. Num app que pergunta o dia inteiro,
        // essa única linha é a diferença entre caber e não caber na franquia do
        // chip. Lendo o corpo até o fim e fechando o stream, o Android devolve a
        // conexão para o pool sozinho.
        return Resposta(status, texto)
    }

    private fun lerTudo(entrada: InputStream): String =
        entrada.bufferedReader(Charsets.UTF_8).readText()

    /**
     * A mensagem vai para a tela do operador, então tem que dizer o que fazer.
     * "java.net.SocketTimeoutException" não ajuda quem está atrás do balcão.
     */
    private fun descreverFalha(erro: Exception): String = when (erro) {
        is java.net.SocketTimeoutException -> "O servidor demorou para responder."
        is java.net.UnknownHostException -> "Sem internet: não foi possível encontrar o servidor."
        is javax.net.ssl.SSLException -> "Falha na conexão segura com o servidor."
        is java.io.IOException -> "Sem conexão com o servidor."
        else -> erro.message ?: "Falha inesperada de rede."
    }
}
