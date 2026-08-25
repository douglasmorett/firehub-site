package br.com.firehub.maquininha

/**
 * Números e endereços que alguém vai querer mudar sem ler o resto do app.
 */
object Ajustes {

    /**
     * A APN do chip do PagBank é privada: só sai pacote para endpoint que foi
     * declarado na homologação. Por isso o endereço é constante compilada e não
     * campo de tela — um servidor digitado pelo lojista simplesmente não teria
     * resposta no 4G, e o suporte gastaria horas procurando um bug que não
     * existe.
     */
    const val ENDERECO_DO_FIREHUB = "https://firehubfood.com.br"

    const val CAMINHO_DA_FILA = "/api/pos/terminal/pendente"
    const val CAMINHO_DO_RESULTADO = "/api/pos/terminal/resultado"

    /** O código de pareamento gerado no painel tem 32 bytes em hexadecimal. */
    const val TAMANHO_DO_TOKEN = 64

    const val TEMPO_DE_CONEXAO_MS = 10_000

    /**
     * Leitura mais folgada que a conexão porque o FireHub roda em contêiner que
     * pode estar frio: a primeira consulta depois de um deploy demora mais que
     * as seguintes, e cortar em 5 segundos faria o app declarar a rede caída
     * bem no momento em que ela voltou.
     */
    const val TEMPO_DE_LEITURA_MS = 15_000

    /**
     * Quanto o app espera o cliente escolher crédito, débito ou voucher antes de
     * devolver a cobrança para a fila.
     *
     * Fica abaixo dos cinco minutos que o servidor leva para destravar sozinho
     * uma cobrança presa (MINUTOS_ATE_DESTRAVAR, em terminal-app.ts). Se o app
     * devolvesse depois disso, haveria uma janela em que os dois lados acham que
     * mandam no mesmo pedido.
     */
    const val TEMPO_PARA_ESCOLHER_MS = 120_000L

    /**
     * O mesmo prazo, mas para um pedido que JÁ foi devolvido para a fila sem
     * ninguém escolher forma de pagamento.
     *
     * O servidor devolve o pedido recusado para a fila na hora e a fila é
     * atendida por ordem de criação, então o pedido abandonado é sempre o
     * próximo que esta maquininha recebe. Mantendo os dois minutos, um cliente
     * que desistiu e foi embora prende o terminal em ciclos de dois minutos —
     * e todo mundo que pediu depois dele fica sem pagar.
     *
     * Vinte segundos ainda é tempo de sobra para alguém que está de fato na
     * frente da maquininha tocar num botão, e é curto o bastante para o pedido
     * abandonado devolver o terminal rapidamente.
     */
    const val TEMPO_PARA_REESCOLHER_MS = 20_000L

    /**
     * Respiro depois do segundo abandono seguido do mesmo pedido.
     *
     * Sem ele o laço gira em vazio: devolve o pedido, pergunta de novo, recebe o
     * mesmo pedido, devolve outra vez. No Wi-Fi isso é só barulho; no chip é
     * franquia queimada por um cliente que já foi embora.
     */
    const val ESPERA_APOS_ABANDONO_MS = 30_000L

    /**
     * Espera entre duas perguntas ao terminal sobre um cartão cujo resultado
     * ficou em aberto.
     *
     * O motivo real de a pergunta falhar é o serviço do PagBank ainda estar
     * subindo depois de um boot, então a espera precisa ser fixa e não pode
     * herdar o ritmo do polling: no Wi-Fi o polling está em dois segundos e as
     * tentativas se esgotariam antes de o serviço do PagBank abrir.
     */
    const val ESPERA_ENTRE_CONFERENCIAS_MS = 5_000L

    /**
     * Espera entre tentativas de reenviar um resultado que o servidor ainda não
     * confirmou. Cresce até o teto para não martelar um servidor que já está com
     * problema, mas nunca desiste: do outro lado desse reenvio tem um cartão que
     * já foi debitado.
     */
    const val ESPERA_INICIAL_DE_REENVIO_MS = 3_000L
    const val ESPERA_MAXIMA_DE_REENVIO_MS = 60_000L

    /**
     * Degrau da escada de polling: a partir de quanto tempo parado este ritmo
     * vale, e de quanto em quanto tempo perguntar enquanto ele valer.
     */
    data class Degrau(val depoisDeParadoMs: Long, val intervaloMs: Long)

    /**
     * No Wi-Fi da loja o custo por consulta é irrelevante, então o app pergunta
     * de 2 em 2 segundos enquanto há movimento: esse intervalo é o tempo que o
     * cliente fica olhando para a maquininha sem nada acontecer depois de fechar
     * o pedido no totem.
     */
    val ESCADA_NO_WIFI = listOf(
        Degrau(0L, 2_000L),
        Degrau(2 * 60_000L, 5_000L),
        Degrau(10 * 60_000L, 15_000L),
        Degrau(30 * 60_000L, 30_000L),
    )

    /**
     * No chip a conta é outra. Cada consulta custa por volta de 1 KB quando a
     * conexão é reaproveitada, e passa de 2 KB quando o intervalo é longo o
     * bastante para o keep-alive cair e o TLS ter que ser renegociado. Perguntar
     * de 2 em 2 segundos o dia inteiro daria centenas de megabytes por mês.
     *
     * Os degraus abaixo trocam responsividade por franquia de forma consciente:
     * 5 segundos com movimento (o cliente espera um pouco mais), e três minutos
     * quando a loja está parada. A conta completa está no README.
     *
     * O chip é plano B. Loja com totem precisa de Wi-Fi na maquininha.
     */
    val ESCADA_NO_CHIP = listOf(
        Degrau(0L, 5_000L),
        Degrau(90_000L, 20_000L),
        Degrau(10 * 60_000L, 60_000L),
        Degrau(30 * 60_000L, 180_000L),
    )
}
