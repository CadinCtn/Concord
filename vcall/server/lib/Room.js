/**
 * Room.js
 * Representa uma sala de vídeo-chamada.
 * Gerencia os Peers conectados e o Router mediasoup.
 */

const config = require('../config');
const Peer = require('./Peer');

class Room {
  constructor(roomId, router) {
    this.id = roomId;
    this.router = router;
    // Map de peers: socketId → Peer
    this.peers = new Map();
  }

  // ─── Peers ────────────────────────────────────────────────────────────────

  addPeer(socketId, displayName) {
    const peer = new Peer(socketId, displayName);
    this.peers.set(socketId, peer);
    return peer;
  }

  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.close();
      this.peers.delete(socketId);
    }
  }

  hasPeer(socketId) {
    return this.peers.has(socketId);
  }

  get isEmpty() {
    return this.peers.size === 0;
  }

  /**
   * Retorna todos os outros peers (excluindo o solicitante).
   */
  getOtherPeers(excludeSocketId) {
    return Array.from(this.peers.values()).filter((p) => p.id !== excludeSocketId);
  }

  // ─── Transports ───────────────────────────────────────────────────────────

  /**
   * Cria um WebRtcTransport para um peer (send ou recv).
   */
  async createWebRtcTransport(peerId, direction) {
    const peer = this.getPeer(peerId);
    if (!peer) throw new Error(`Peer ${peerId} não encontrado`);

    const transport = await this.router.createWebRtcTransport({
      ...config.WEBRTC_TRANSPORT_OPTIONS,
      appData: { direction },
    });

    // Monitorar estado da conexão
    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') transport.close();
    });

    peer.addTransport(transport);
    return transport;
  }

  // ─── Producers ────────────────────────────────────────────────────────────

  /**
   * Cria um Producer (stream enviado por um peer).
   */
  async createProducer(peerId, transportId, rtpParameters, kind, appData) {
    const peer = this.getPeer(peerId);
    if (!peer) throw new Error(`Peer ${peerId} não encontrado`);

    const transport = peer.getTransport(transportId);
    if (!transport) throw new Error(`Transport ${transportId} não encontrado`);

    const producer = await transport.produce({ kind, rtpParameters, appData });

    producer.on('transportclose', () => {
      producer.close();
      peer.removeProducer(producer.id);
    });

    peer.addProducer(producer);
    return producer;
  }

  // ─── Consumers ────────────────────────────────────────────────────────────

  /**
   * Cria um Consumer para um peer receber a mídia de outro producer.
   */
  async createConsumer(consumerPeerId, producerId, rtpCapabilities) {
    const consumerPeer = this.getPeer(consumerPeerId);
    if (!consumerPeer) throw new Error(`Peer consumer ${consumerPeerId} não encontrado`);

    // Verificar se o router suporta as capabilities do cliente
    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Router não pode consumir este producer com as capabilities fornecidas');
    }

    // Buscar o transport de recebimento (recv) do consumer peer
    let recvTransport;
    for (const transport of consumerPeer.transports.values()) {
      // O transport recv tem appData.direction === 'recv'
      if (transport.appData && transport.appData.direction === 'recv') {
        recvTransport = transport;
        break;
      }
    }

    if (!recvTransport) {
      throw new Error(`Transport recv não encontrado para peer ${consumerPeerId}`);
    }

    const consumer = await recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    consumer.on('transportclose', () => {
      consumer.close();
      consumerPeer.removeConsumer(consumer.id);
    });

    consumer.on('producerclose', () => {
      consumer.close();
      consumerPeer.removeConsumer(consumer.id);
    });

    consumerPeer.addConsumer(consumer);
    return consumer;
  }

  /**
   * Despausa o Consumer quando o cliente já montou seu WebRTC local.
   */
  async resumeConsumer(peerId, consumerId) {
    const peer = this.getPeer(peerId);
    if (!peer) return;
    const consumer = peer.getConsumer(consumerId);
    if (consumer) {
      await consumer.resume();
    }
  }

  // ─── Utilitários ──────────────────────────────────────────────────────────

  /**
   * Fecha a sala e todos os seus recursos.
   */
  close() {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
    this.router.close();
  }
}

module.exports = Room;
