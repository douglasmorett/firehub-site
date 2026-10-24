package br.com.firehub.maquininha.pagamento.ponte

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Tela transparente que existe só para abrir o app de pagamento da adquirente
 * e receber a resposta. Não desenha nada.
 *
 * Por que precisa existir: o serviço não pode chamar startActivityForResult
 * (Getnet), e o deeplink de volta da Stone e da Cielo precisa cair numa
 * Activity. A ponte faz as duas coisas e entrega tudo ao [CanalDaPonte], que
 * é onde a thread do serviço está esperando.
 *
 * launchMode singleTop (no manifesto de cada flavor): a volta por deeplink
 * reaproveita a ponte que está no topo, por onNewIntent. Mas o código não
 * depende disso — se o Android criar uma ponte nova para a volta (o app da
 * adquirente pode chamar o deeplink de dentro da tarefa dele), ela entrega a
 * resposta em onCreate do mesmo jeito, e o canal fecha a ponte original.
 *
 * Herda de Activity, e não de AppCompatActivity, para poder usar o tema
 * translúcido do sistema sem AppCompat reclamar. E não fixa orientação: no
 * Android 8.0, Activity translúcida com orientação fixa estoura na abertura.
 */
class PonteDaAdquirenteActivity : Activity() {

    companion object {
        const val EXTRA_CHAMADA = "br.com.firehub.maquininha.CHAMADA"
        private const val PEDIDO_AO_APP_DA_ADQUIRENTE = 4710
        private const val ETIQUETA = "PonteDaAdquirente"
        private const val ESTADO_JA_LANCOU = "ja_lancou"
    }

    private var idDaChamada: Long? = null
    private var jaLancou = false

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        jaLancou = estadoSalvo?.getBoolean(ESTADO_JA_LANCOU, false) ?: false
        idDaChamada = intent.getLongExtra(EXTRA_CHAMADA, -1L).takeIf { it > 0 }
        tratar(intent, criando = true)
    }

    override fun onNewIntent(novo: Intent) {
        super.onNewIntent(novo)
        setIntent(novo)
        tratar(novo, criando = false)
    }

    override fun onSaveInstanceState(estado: Bundle) {
        super.onSaveInstanceState(estado)
        estado.putBoolean(ESTADO_JA_LANCOU, jaLancou)
    }

    private fun tratar(recebido: Intent, criando: Boolean) {
        // Volta por deeplink (Stone, Cielo).
        val dados = recebido.data
        if (dados != null && recebido.action == Intent.ACTION_VIEW) {
            Log.i(ETIQUETA, "Resposta por deeplink: " + dados.scheme + "://" + dados.host)
            CanalDaPonte.entregar(null, CanalDaPonte.Resposta.PorUri(dados))
            finish()
            return
        }

        if (!criando) return

        val id = idDaChamada
        val chamada = id?.let { CanalDaPonte.chamada(it) }

        if (jaLancou) {
            // Recriada (giro, memória) com o app da adquirente já aberto: a
            // resposta da Getnet ainda chega aqui por onActivityResult. Se a
            // chamada não existe mais, ninguém espera nada e a ponte sai.
            if (chamada == null) finish()
            return
        }
        if (chamada == null) {
            // Ponte recriada depois de o processo morrer, ou aberta por engano.
            // Não há quem espere resposta: abrir o app de pagamento agora seria
            // cobrar sem ninguém registrar.
            finish()
            return
        }

        if (!CanalDaPonte.podeLancar(chamada, this)) {
            finish()
            return
        }
        jaLancou = true

        try {
            if (chamada.porResultado) {
                startActivityForResult(chamada.saida, PEDIDO_AO_APP_DA_ADQUIRENTE)
            } else {
                startActivity(chamada.saida)
            }
        } catch (erro: ActivityNotFoundException) {
            Log.e(ETIQUETA, "App de pagamento não encontrado.", erro)
            CanalDaPonte.naoAbriu(chamada, "O aplicativo de pagamento não está neste aparelho.")
            finish()
        } catch (erro: SecurityException) {
            Log.e(ETIQUETA, "App de pagamento recusou a abertura.", erro)
            CanalDaPonte.naoAbriu(chamada, "O aplicativo de pagamento recusou a abertura.")
            finish()
        }
    }

    // A mensagem do @Deprecated vai compilada para o APK: não citar adquirente
    // nela (cada uma reprova APK que cite a concorrente). Quem usa é a Getnet.
    @Deprecated("startActivityForResult é o que o app de pagamento entende.")
    override fun onActivityResult(pedido: Int, codigo: Int, dados: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(pedido, codigo, dados)
        if (pedido != PEDIDO_AO_APP_DA_ADQUIRENTE) return
        CanalDaPonte.entregar(idDaChamada, CanalDaPonte.Resposta.PorResultado(codigo, dados))
        finish()
    }

    override fun onDestroy() {
        CanalDaPonte.ponteFechou(this)
        super.onDestroy()
    }
}
