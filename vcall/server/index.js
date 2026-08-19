/**
 * index.js — Entry point do servidor vcall
 *
 * Responsabilidades:
 *  - Servidor HTTPS (Express) servindo arquivos estáticos
 *  - Signaling via Socket.IO
 *  - Orquestração de Rooms e mediasoup
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { createWorkers, createRouter } = require('./lib/mediasoupManager');
const Room = require('./lib/Room');

// ─── Inicialização ────────────────────────────────────────────────────────────

const app = express();

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rotas simples de navegação
app.get('/', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/room', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'room.html')));

// ─── HTTPS ────────────────────────────────────────────────────────────────────

const sslDir = path.join(__dirname, 'ssl');
const sslOptions = {
  key: fs.readFileSync(path.join(sslDir, 'key.pem')),
  cert: fs.readFileSync(path.join(sslDir, 'cert.pem')),
};

const httpsServer = https.createServer(sslOptions, app);

// ─── Socket.IO ────────────────────────────────────────────────────────────────

const io = new Server(httpsServer, {
  cors: { origin: '*' },
});

// Mapa global de salas: roomId → Room
const rooms = new Map();

/**
 * Obtém ou cria uma sala pelo ID.
 */
async function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    const router = await createRouter();
    const room = new Room(roomId, router);
    rooms.set(roomId, room);
    console.log(`[Room] Sala "${roomId}" criada`);
  }
  return rooms.get(roomId);
}

// ─── Eventos Socket.IO ────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Cliente conectado: ${socket.id}`);

  let currentRoom = null; // Room à qual este socket pertence

  // ── joinRoom ──────────────────────────────────────────────────────────────
  socket.on('joinRoom', async ({ roomId, displayName }, callback) => {
    try {
      currentRoom = await getOrCreateRoom(roomId);

      // Registrar peer
      const peer = currentRoom.addPeer(socket.id, displayName);
      socket.join(roomId);

      // Notificar os outros peers que alguém entrou
      socket.to(roomId).emit('peerJoined', peer.toJSON());

      // Enviar ao novo peer a lista de peers já na sala (com seus producers)
      const existingPeers = currentRoom.getOtherPeers(socket.id).map((p) => p.toJSON());

      console.log(`[Room] "${displayName}" entrou na sala "${roomId}"`);
      callback({ existingPeers });
    } catch (err) {
      console.error('[joinRoom]', err);
      callback({ error: err.message });
    }
  });

  // ── getRouterCapabilities ─────────────────────────────────────────────────
  socket.on('getRouterCapabilities', (_, callback) => {
    try {
      callback({ rtpCapabilities: currentRoom.router.rtpCapabilities });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // ── createTransport ───────────────────────────────────────────────────────
  socket.on('createTransport', async ({ direction }, callback) => {
    try {
      const transport = await currentRoom.createWebRtcTransport(socket.id, direction);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error('[createTransport]', err);
      callback({ error: err.message });
    }
  });

  // ── connectTransport ──────────────────────────────────────────────────────
  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const peer = currentRoom.getPeer(socket.id);
      const transport = peer.getTransport(transportId);
      await transport.connect({ dtlsParameters });
      callback({ connected: true });
    } catch (err) {
      console.error('[connectTransport]', err);
      callback({ error: err.message });
    }
  });

  // ── produce ───────────────────────────────────────────────────────────────
  socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
    try {
      const producer = await currentRoom.createProducer(
        socket.id,
        transportId,
        rtpParameters,
        kind,
        appData || {}
      );

      // Notificar todos os outros peers sobre o novo producer
      const peer = currentRoom.getPeer(socket.id);
      socket.to(currentRoom.id).emit('newProducer', {
        peerId: socket.id,
        displayName: peer.displayName,
        producerId: producer.id,
        kind: producer.kind,
        appData: producer.appData,
      });

      callback({ producerId: producer.id });
    } catch (err) {
      console.error('[produce]', err);
      callback({ error: err.message });
    }
  });

  // ── consume ───────────────────────────────────────────────────────────────
  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const consumer = await currentRoom.createConsumer(
        socket.id,
        producerId,
        rtpCapabilities
      );

      callback({
        consumerId: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error('[consume]', err);
      callback({ error: err.message });
    }
  });

  // ── resumeConsumer ─────────────────────────────────────────────────────────
  socket.on('resumeConsumer', async ({ consumerId }, callback) => {
    try {
      if (currentRoom) {
        await currentRoom.resumeConsumer(socket.id, consumerId);
      }
      if (callback) callback({ resumed: true });
    } catch (err) {
      console.error('[resumeConsumer]', err);
      if (callback) callback({ error: err.message });
    }
  });

  // ── closeProducer ─────────────────────────────────────────────────────────
  socket.on('closeProducer', ({ producerId }) => {
    try {
      const peer = currentRoom.getPeer(socket.id);
      if (!peer) return;
      const producer = peer.getProducer(producerId);
      if (!producer) return;
      producer.close();
      peer.removeProducer(producerId);
      // Notificar os outros sobre o encerramento do producer
      socket.to(currentRoom.id).emit('producerClosed', { producerId, peerId: socket.id });
    } catch (err) {
      console.error('[closeProducer]', err);
    }
  });

  // ── chatMessage ───────────────────────────────────────────────────────────
  socket.on('chatMessage', ({ message }) => {
    if (!currentRoom) return;
    const peer = currentRoom.getPeer(socket.id);
    if (!peer) return;

    const payload = {
      peerId: socket.id,
      displayName: peer.displayName,
      message: message.trim().slice(0, 1000), // limitar tamanho
      timestamp: Date.now(),
    };

    // Enviar para todos na sala (incluindo o próprio remetente)
    io.to(currentRoom.id).emit('chatMessage', payload);
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[Socket] Cliente desconectado: ${socket.id}`);

    if (!currentRoom) return;

    // Notificar os outros peers
    socket.to(currentRoom.id).emit('peerLeft', { peerId: socket.id });

    // Remover peer e seus recursos
    currentRoom.removePeer(socket.id);

    // Limpar sala vazia
    if (currentRoom.isEmpty) {
      currentRoom.close();
      rooms.delete(currentRoom.id);
      console.log(`[Room] Sala "${currentRoom.id}" encerrada (vazia)`);
    }

    currentRoom = null;
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  // Criar Workers do mediasoup antes de aceitar conexões
  await createWorkers();

  httpsServer.listen(config.PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║         vcall - Servidor iniciado        ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  URL: https://${config.ANNOUNCED_IP}:${config.PORT}`.padEnd(44) + '║');
    console.log(`║  IP anunciado: ${config.ANNOUNCED_IP}`.padEnd(44) + '║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
  });
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar o servidor:', err);
  process.exit(1);
});
