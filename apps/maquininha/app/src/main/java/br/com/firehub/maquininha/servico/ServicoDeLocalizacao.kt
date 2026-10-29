package br.com.firehub.maquininha.servico

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.motoboy.ApiDoMotoboy
import br.com.firehub.maquininha.motoboy.CofreDoMotoboy
import java.util.concurrent.Executors

/**
 * A localização do motoboy, pela maquininha que ele leva (app FireHub Motoboy).
 *
 * A mesma rota do app do celular (POST /api/motoboys/location, a cada 12 s),
 * mas no GPS da maquininha: o motoboy não desliga o GPS do próprio telefone
 * para "sumir" do mapa. Serviço em primeiro plano (aviso fixo) porque é o que o
 * Android deixa rodar com a tela apagada; sobe no login e no boot.
 *
 * Fora do horário da loja o servidor não grava a posição e responde
 * `foraDoHorario`: o serviço para sozinho, como no celular. Quem religa é a
 * lista de entregas, quando o servidor disser que voltou o horário.
 */
class ServicoDeLocalizacao : Service(), LocationListener {

    private val envio = Executors.newSingleThreadExecutor()
    private var ultimoEnvio = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        criarCanal()
        val aviso = NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.nome_do_app))
            .setContentText("Localização ligada: a loja vê você no mapa das entregas.")
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(
            this, AVISO, aviso,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )

        if (CofreDoMotoboy.token(this) == null || !temPermissao(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val gps = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        var ouvindo = 0
        try {
            gps.removeUpdates(this)
            for (provedor in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (gps.isProviderEnabled(provedor)) {
                    gps.requestLocationUpdates(provedor, INTERVALO_MS, 0f, this, Looper.getMainLooper())
                    ouvindo++
                }
            }
        } catch (e: SecurityException) {
            Log.w(ETIQUETA, "Sem permissão de localização.", e)
            stopSelf()
        }
        // "Ligado" para a tela só com o GPS ouvindo de verdade: com a
        // localização desligada no aparelho, a lista religa quando ela voltar.
        if (ouvindo > 0 && !rodando) desde = System.currentTimeMillis()
        rodando = ouvindo > 0
        return START_STICKY
    }

    override fun onLocationChanged(local: Location) {
        // A distância até o cliente, na tela, usa a posição mais nova.
        ultimaPosicao = local
        // GPS e rede chegam juntos: um envio a cada 12 s basta (o servidor
        // também limita a 20 por minuto).
        val agora = System.currentTimeMillis()
        if (agora - ultimoEnvio < INTERVALO_MS - 1_000) return
        ultimoEnvio = agora
        val token = CofreDoMotoboy.token(this) ?: run { stopSelf(); return }
        envio.execute {
            val r = ApiDoMotoboy.localizacao(token, local.latitude, local.longitude)
            when {
                r is ApiDoMotoboy.Resposta.SessaoExpirada -> stopSelf()
                r is ApiDoMotoboy.Resposta.Ok && r.json.optBoolean("foraDoHorario") -> {
                    foraDoHorario = true
                    stopSelf()
                }
                r is ApiDoMotoboy.Resposta.Ok -> ultimaAceita = System.currentTimeMillis()
            }
        }
    }

    // LocationListener antigo (Android < 11) exige estes três.
    @Deprecated("API antiga do LocationListener")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    override fun onDestroy() {
        rodando = false
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        envio.shutdown()
        super.onDestroy()
    }

    private fun criarCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(CANAL, "Localização", NotificationManager.IMPORTANCE_LOW))
        }
    }

    companion object {
        private const val ETIQUETA = "ServicoDeLocalizacao"
        private const val CANAL = "localizacao"
        private const val AVISO = 4207
        private const val INTERVALO_MS = 12_000L

        /** Sem posição aceita há mais que isto, a tela avisa (o mesmo do celular). */
        private const val PARADO_MS = 120_000L

        /** Posição mais velha que isto não serve para dizer "1,2 km a nordeste". */
        private const val POSICAO_VALE_MS = 30 * 60_000L

        /** O GPS está ouvindo (o que a tela mostra como "GPS ligado"). */
        @Volatile
        var rodando = false
            private set

        @Volatile
        private var desde = 0L

        /** Quando o servidor aceitou a última posição. */
        @Volatile
        private var ultimaAceita = 0L

        @Volatile
        private var ultimaPosicao: Location? = null

        /**
         * Fora do horário da loja: o servidor disse (na posição ou na lista de
         * entregas, `gpsForaDoHorario`). A lista acerta este valor a cada busca.
         */
        @Volatile
        var foraDoHorario = false

        /** A localização do aparelho está ligada (GPS ou rede)? */
        fun aparelhoComLocalizacao(context: Context): Boolean {
            val gps = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            return try {
                gps.isProviderEnabled(LocationManager.GPS_PROVIDER) || gps.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
            } catch (e: Exception) {
                false
            }
        }

        /**
         * A posição mais nova que se tem (a do serviço ou a que o Android
         * guardou), se tiver menos de 30 min. Nula sem permissão ou sem posição.
         */
        fun posicaoRecente(context: Context): Location? {
            val candidatas = mutableListOf<Location>()
            ultimaPosicao?.let { candidatas.add(it) }
            if (temPermissao(context)) {
                val gps = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                for (provedor in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    try {
                        gps.getLastKnownLocation(provedor)?.let { candidatas.add(it) }
                    } catch (e: SecurityException) {
                    } catch (e: IllegalArgumentException) {
                    }
                }
            }
            val melhor = candidatas.maxByOrNull { it.time } ?: return null
            return if (System.currentTimeMillis() - melhor.time <= POSICAO_VALE_MS) melhor else null
        }

        /**
         * Há quanto tempo (ms) a loja não recebe a posição, com o GPS ligado.
         * Nulo quando está chegando normalmente ou o GPS não está ligado.
         */
        fun paradoHa(agora: Long): Long? {
            if (!rodando) return null
            val desdeQuando = maxOf(ultimaAceita, desde)
            return (agora - desdeQuando).takeIf { it > PARADO_MS }
        }

        fun temPermissao(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun ligar(context: Context) {
            if (CofreDoMotoboy.token(context) == null || !temPermissao(context)) return
            ContextCompat.startForegroundService(context, Intent(context, ServicoDeLocalizacao::class.java))
        }

        fun desligar(context: Context) {
            context.stopService(Intent(context, ServicoDeLocalizacao::class.java))
        }
    }
}
