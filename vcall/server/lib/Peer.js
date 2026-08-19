/**
 * Peer.js
 * Abstração de um participante conectado à aplicação.
 * Mantém referências aos seus Transports, Producers e Consumers.
 */

class Peer {
  constructor(socketId, displayName) {
    this.id = socketId;
    this.displayName = displayName;

    // Map de transports: transportId → transport
    this.transports = new Map();
    // Map de producers: producerId → producer
    this.producers = new Map();
    // Map de consumers: consumerId → consumer
    this.consumers = new Map();
  }

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId) {
    return this.transports.get(transportId);
  }

  addProducer(producer) {
    this.producers.set(producer.id, producer);
  }

  getProducer(producerId) {
    return this.producers.get(producerId);
  }

  removeProducer(producerId) {
    this.producers.delete(producerId);
  }

  addConsumer(consumer) {
    this.consumers.set(consumer.id, consumer);
  }

  getConsumer(consumerId) {
    return this.consumers.get(consumerId);
  }

  removeConsumer(consumerId) {
    this.consumers.delete(consumerId);
  }

  /**
   * Fecha todos os recursos do peer ao desconectar.
   */
  close() {
    for (const transport of this.transports.values()) {
      transport.close();
    }
  }

  /**
   * Retorna informações serializáveis do peer para enviar a outros clientes.
   */
  toJSON() {
    return {
      id: this.id,
      displayName: this.displayName,
      producers: Array.from(this.producers.values()).map((p) => ({
        id: p.id,
        kind: p.kind,
        appData: p.appData,
      })),
    };
  }
}

module.exports = Peer;
