/**
 * Configurações centralizadas do servidor vcall.
 *
 * Antes de iniciar o servidor, edite:
 *  - ANNOUNCED_IP: defina o IP do servidor na rede Radmin VPN (ex: "26.x.x.x")
 *  - PORT: porta HTTPS (padrão 3000)
 *  - RTC_MIN_PORT / RTC_MAX_PORT: faixa de portas UDP para WebRTC
 */

const ANNOUNCED_IP = process.env.ANNOUNCED_IP || '26.232.54.30';

module.exports = {
  // ─── Servidor HTTP/HTTPS ────────────────────────────────────────────────────
  PORT: 3000,

  // IP que o servidor anuncia ao cliente para conexões WebRTC.
  // Em V-LAN via Radmin VPN, use o IP virtual do servidor (ex: "26.x.x.x").
  // Se quiser testar localmente, use "127.0.0.1".
  ANNOUNCED_IP,

  // ─── mediasoup Workers ──────────────────────────────────────────────────────
  // Quantidade de Workers (processos C++ do mediasoup).
  // Recomendado: número de cores lógicos da CPU.
  NUM_WORKERS: require('os').cpus().length,

  // ─── mediasoup Router ───────────────────────────────────────────────────────
  ROUTER_MEDIA_CODECS: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 1000,
      },
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
      },
    },
  ],

  // ─── WebRTC Transport ───────────────────────────────────────────────────────
  WEBRTC_TRANSPORT_OPTIONS: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: ANNOUNCED_IP,
        portRange: { min: 40000, max: 49999 },
      },
      {
        protocol: 'tcp',
        ip: '0.0.0.0',
        announcedAddress: ANNOUNCED_IP,
        portRange: { min: 40000, max: 49999 },
      },
    ],
    initialAvailableOutgoingBitrate: 800000,
    minimumAvailableOutgoingBitrate: 100000,
    maxSctpMessageSize: 262144,
  },
};
