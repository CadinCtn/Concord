/**
 * mediasoupClient.js
 * Wrapper do mediasoup-client para abstrair a lógica de Device,
 * Transports, Producers e Consumers.
 */

const MSClient = (() => {
  let device = null;
  let sendTransport = null;
  let recvTransport = null;
  let socket = null;

  // Callbacks registrados externamente
  let onNewConsumer = null;

  // ─── Inicialização ──────────────────────────────────────────────────────────

  /**
   * Inicializa o Device mediasoup com as capabilities do Router.
   */
  async function init(socketRef, routerRtpCapabilities) {
    socket = socketRef;
    const Device = window.mediasoupClient?.Device || window.mediasoupClient?.default?.Device || window.mediasoupDevice;
    if (!Device) {
      throw new Error('mediasoupClient.Device não encontrado no bundle. Verifique se mediasoup-bundle.js foi carregado.');
    }
    device = new Device();
    await device.load({ routerRtpCapabilities });
  }

  // ─── Transports ─────────────────────────────────────────────────────────────

  /**
   * Cria o SendTransport (para enviar mídia ao servidor).
   */
  async function createSendTransport() {
    const params = await emit('createTransport', { direction: 'send' });
    if (params.error) throw new Error(params.error);

    sendTransport = device.createSendTransport(params);

    // Evento 'connect': enviar parâmetros DTLS ao servidor
    sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        const res = await emit('connectTransport', {
          transportId: sendTransport.id,
          dtlsParameters,
        });
        if (res.error) errback(new Error(res.error));
        else callback();
      } catch (err) {
        errback(err);
      }
    });

    // Evento 'produce': servidor cria o Producer e retorna o ID
    sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { producerId, error } = await emit('produce', {
          transportId: sendTransport.id,
          kind,
          rtpParameters,
          appData,
        });
        if (error) errback(new Error(error));
        else callback({ id: producerId });
      } catch (err) {
        errback(err);
      }
    });

    return sendTransport;
  }

  /**
   * Cria o RecvTransport (para receber mídia do servidor).
   */
  async function createRecvTransport() {
    const params = await emit('createTransport', { direction: 'recv' });
    if (params.error) throw new Error(params.error);

    recvTransport = device.createRecvTransport(params);

    recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        const res = await emit('connectTransport', {
          transportId: recvTransport.id,
          dtlsParameters,
        });
        if (res.error) errback(new Error(res.error));
        else callback();
      } catch (err) {
        errback(err);
      }
    });

    return recvTransport;
  }

  // ─── Producers ──────────────────────────────────────────────────────────────

  /**
   * Produz áudio a partir de uma MediaStreamTrack.
   */
  async function produceAudio(track) {
    if (!sendTransport) throw new Error('SendTransport não criado');
    return sendTransport.produce({
      track,
      codecOptions: { opusStereo: true, opusDtx: true },
      appData: { type: 'audio' },
    });
  }

  /**
   * Produz vídeo de câmera.
   */
  async function produceVideo(track) {
    if (!sendTransport) throw new Error('SendTransport não criado');
    return sendTransport.produce({
      track,
      encodings: [
        { maxBitrate: 100000 },
        { maxBitrate: 300000 },
        { maxBitrate: 900000 },
      ],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { type: 'camera' },
    });
  }

  /**
   * Produz vídeo de compartilhamento de tela.
   */
  async function produceScreen(track) {
    if (!sendTransport) throw new Error('SendTransport não criado');
    return sendTransport.produce({
      track,
      encodings: [{ maxBitrate: 1500000 }],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { type: 'screen' },
    });
  }

  // ─── Consumers ──────────────────────────────────────────────────────────────

  /**
   * Consome um producer remoto e retorna o MediaStreamTrack.
   */
  async function consumeProducer(producerId) {
    if (!recvTransport) throw new Error('RecvTransport não criado');

    const params = await emit('consume', {
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    });

    if (params.error) throw new Error(params.error);

    const consumer = await recvTransport.consume({
      id: params.consumerId,
      producerId: params.producerId,
      kind: params.kind,
      rtpParameters: params.rtpParameters,
    });

    // Avisar ao servidor para despausar agora que o cliente está pronto para receber
    await emit('resumeConsumer', { consumerId: consumer.id });

    return { consumer, track: consumer.track };
  }

  // ─── Utilitários ────────────────────────────────────────────────────────────

  /**
   * Wrapper de socket.emit com Promise para suportar callbacks.
   */
  function emit(event, data = {}) {
    return new Promise((resolve) => {
      socket.emit(event, data, resolve);
    });
  }

  // ─── Exposição pública ───────────────────────────────────────────────────────

  return {
    init,
    createSendTransport,
    createRecvTransport,
    produceAudio,
    produceVideo,
    produceScreen,
    consumeProducer,
    emit,
  };
})();
