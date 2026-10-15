package br.com.firehub.maquininha

import android.app.Application
import br.com.firehub.maquininha.pagamento.Adquirente

/**
 * Existe por um motivo só: dar ao cobrador da adquirente (o SDK do PagBank, ou
 * a ponte de deeplink nas outras) um Context que vive enquanto o processo
 * viver.
 *
 * O PlugPag se liga ao serviço do PagBank por AIDL e tem que ser instanciado uma
 * única vez no processo. Se cada Activity criasse o seu, o vínculo seria
 * refeito a cada giro de tela e a maquininha responderia SV03 ("serviço ocupado
 * com outra operação") no meio de uma venda.
 */
class AplicacaoDaMaquininha : Application() {
    override fun onCreate() {
        super.onCreate()
        // Só guarda o Context. A ligação com o serviço do PagBank acontece na
        // primeira chamada de verdade, que sempre vem de uma thread de trabalho:
        // construir o PlugPag aqui bloquearia a subida do processo.
        Adquirente.cobrador.guardarContexto(this)
    }
}
