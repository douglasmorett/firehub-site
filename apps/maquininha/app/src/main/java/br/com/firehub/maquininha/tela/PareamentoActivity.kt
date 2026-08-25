package br.com.firehub.maquininha.tela

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.CofreDoToken
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.TrabalhoDeTela
import br.com.firehub.maquininha.estado.EstadoDoTerminal
import br.com.firehub.maquininha.rede.ApiDoFireHub
import br.com.firehub.maquininha.rede.RespostaDaFila
import br.com.firehub.maquininha.servico.ServicoDeCobranca

/**
 * Liga esta maquininha a uma loja.
 *
 * Acontece uma vez, na instalação. O lojista gera o código no painel do FireHub
 * e digita aqui; a partir daí o aparelho se identifica sozinho.
 *
 * Nada é gravado antes de o servidor aceitar o código. Um código errado no cofre
 * deixaria o app em laço de 401 até alguém ir até a loja desinstalar o app.
 */
class PareamentoActivity : AppCompatActivity() {

    private lateinit var campo: EditText
    private lateinit var botao: Button
    private lateinit var mensagem: TextView

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        setContentView(R.layout.activity_pareamento)

        campo = findViewById(R.id.campoCodigo)
        botao = findViewById(R.id.botaoParear)
        mensagem = findViewById(R.id.mensagem)

        botao.setOnClickListener { tentarParear() }
    }

    private fun tentarParear() {
        val digitado = normalizar(campo.text?.toString())

        if (digitado.length != Ajustes.TAMANHO_DO_TOKEN) {
            val faltam = Ajustes.TAMANHO_DO_TOKEN - digitado.length
            avisar(
                if (faltam > 0) getString(R.string.pareamento_tamanho, faltam)
                else getString(R.string.pareamento_invalido),
            )
            return
        }

        trabalhando(true)
        avisar(getString(R.string.pareamento_validando))

        // Validar é literalmente perguntar pela fila com o código novo: 200
        // significa que o servidor conhece esta maquininha. Não existe rota só
        // de validação, e criar uma seria mais uma superfície para manter.
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoFireHub.buscarCobranca(digitado) },
            aoTerminar = { resultado ->
                trabalhando(false)
                resultado.fold(
                    onSuccess = { resposta -> tratar(digitado, resposta) },
                    onFailure = { erro ->
                        avisar(getString(R.string.pareamento_sem_rede, erro.message ?: ""))
                    },
                )
            },
        )
    }

    private fun tratar(token: String, resposta: RespostaDaFila) {
        when (resposta) {
            is RespostaDaFila.SemCobranca -> concluir(token, resposta.terminal)

            is RespostaDaFila.ComCobranca -> {
                // Azar de sincronia: o lojista pareou a maquininha no exato
                // momento em que havia pedido esperando, e a consulta de
                // validação levou a cobrança junto (a rota reserva o que
                // entrega). Descartar deixaria o cliente cinco minutos parado
                // até o servidor destravar. Fica guardada para o serviço cobrar
                // assim que subir.
                EstadoDoTerminal.cobrancaAdiantada = resposta.cobranca
                concluir(token, resposta.terminal)
            }

            is RespostaDaFila.CredencialInvalida -> avisar(
                when (resposta.codigo) {
                    "TERMINAL_DESATIVADO" -> getString(R.string.pareamento_desativado)
                    else -> getString(R.string.pareamento_desconhecido)
                },
            )

            is RespostaDaFila.FalhaDeRede ->
                avisar(getString(R.string.pareamento_sem_rede, resposta.mensagem))

            is RespostaDaFila.ErroDoServidor ->
                avisar(getString(R.string.pareamento_sem_rede, resposta.mensagem))
        }
    }

    private fun concluir(token: String, rotulo: String?) {
        CofreDoToken.guardar(this, token, rotulo)
        ServicoDeCobranca.ligar(this)
        avisar(getString(R.string.pareamento_ok, rotulo ?: getString(R.string.operacao_sem_nome)))
        finish()
    }

    /**
     * O gerador de código do FireHub produz hexadecimal minúsculo, e o servidor
     * compara o texto exato. Um código digitado em maiúsculo não bateria e o
     * lojista veria "maquininha não cadastrada" olhando para o código certo.
     * Espaços entram pela mesma porta: quem digita 64 caracteres separa em
     * blocos sem perceber.
     */
    private fun normalizar(texto: String?): String =
        texto.orEmpty().filter { caractere ->
            caractere in '0'..'9' || caractere in 'a'..'f' || caractere in 'A'..'F'
        }.lowercase()

    private fun trabalhando(ocupado: Boolean) {
        botao.isEnabled = !ocupado
        campo.isEnabled = !ocupado
    }

    private fun avisar(texto: String) {
        mensagem.text = texto
        mensagem.visibility = View.VISIBLE
    }
}
