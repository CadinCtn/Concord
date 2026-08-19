/**
 * mediasoupManager.js
 * Responsável por criar e gerenciar os Workers do mediasoup.
 * Workers são processos C++ que executam o processamento real de mídia.
 */

const mediasoup = require('mediasoup');
const config = require('../config');

let workers = [];
let nextWorkerIndex = 0;

/**
 * Cria os Workers do mediasoup (um por core de CPU).
 */
async function createWorkers() {
  const { NUM_WORKERS } = config;

  console.log(`[mediasoup] Criando ${NUM_WORKERS} worker(s)...`);

  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['rtp', 'srtp', 'rtcp'],
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    worker.on('died', (error) => {
      console.error(`[mediasoup] Worker ${worker.pid} morreu:`, error);
      // Em produção, considerar reinicialização automática
      process.exit(1);
    });

    workers.push(worker);
    console.log(`[mediasoup] Worker ${i + 1}/${NUM_WORKERS} criado (PID: ${worker.pid})`);
  }
}

/**
 * Retorna o próximo Worker via round-robin para balancear carga entre CPUs.
 */
function getNextWorker() {
  const worker = workers[nextWorkerIndex];
  nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
  return worker;
}

/**
 * Cria um Router mediasoup em um Worker (representa uma "sala" de mídia).
 */
async function createRouter() {
  const worker = getNextWorker();
  const router = await worker.createRouter({
    mediaCodecs: config.ROUTER_MEDIA_CODECS,
  });
  return router;
}

module.exports = { createWorkers, createRouter };
