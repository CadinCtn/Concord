/**
 * app.js — Orquestrador principal do cliente
 *
 * Fluxo de entrada em uma sala:
 *  1. Parsear parâmetros da URL
 *  2. Conectar ao Socket.IO
 *  3. Obter câmera/microfone
 *  4. Entrar na sala (joinRoom)
 *  5. Inicializar mediasoup Device
 *  6. Criar SendTransport e RecvTransport
 *  7. Produzir áudio e vídeo
 *  8. Consumir os producers dos peers já na sala
 *  9. Registrar listeners para novos peers / novos producers
 */

(async () => {
  // ── 1. Parâmetros da URL ──────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  const displayName = params.get('name');

  if (!roomId || !displayName) {
    window.location.href = '/';
    return;
  }

  UI.setRoomName(roomId);

  // Estado local
  let localStream = null;   // MediaStream da câmera/mic
  let audioProducer = null;
  let videoProducer = null;
  let screenProducer = null;
  let localPeerId = null;
  let micEnabled = true;
  let camEnabled = true;
  let sharingScreen = false;

  // Map: producerId → { peerId, kind, appData }
  const producerMap = new Map();

  // ── 2. Conectar Socket.IO ─────────────────────────────────────────────────
  const socket = io({ transports: ['websocket'] });

  // ── 3. Capturar câmera e microfone ────────────────────────────────────────
  UI.setLoadingText('Solicitando acesso à câmera e microfone...');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  } catch (err) {
    console.warn('[app] Sem câmera/mic:', err);
    // Continuar sem vídeo/áudio (apenas receber)
    localStream = null;
  }

  // Exibir vídeo local imediatamente
  const localVideo = UI.addVideoCard('local', displayName, true);
  if (localStream) {
    localVideo.srcObject = localStream;
    // Detectar atividade de voz local
    startVoiceDetection(localStream, 'local');
  } else {
    UI.setCamState('local', false);
  }

  // ── 4. Entrar na sala ─────────────────────────────────────────────────────
  UI.setLoadingText('Entrando na sala...');

  const { existingPeers, error: joinError } = await new Promise((resolve) => {
    socket.emit('joinRoom', { roomId, displayName }, resolve);
  });

  if (joinError) {
    alert('Erro ao entrar na sala: ' + joinError);
    window.location.href = '/';
    return;
  }

  localPeerId = socket.id;

  // ── 5. Inicializar mediasoup Device ───────────────────────────────────────
  UI.setLoadingText('Configurando mídia...');

  // Usar o socket diretamente aqui, pois MSClient ainda não foi inicializado
  const { rtpCapabilities } = await new Promise((resolve) => {
    socket.emit('getRouterCapabilities', {}, resolve);
  });
  await MSClient.init(socket, rtpCapabilities);

  // ── 6. Criar Transports ───────────────────────────────────────────────────
  await MSClient.createSendTransport();
  await MSClient.createRecvTransport();

  // ── 7. Produzir áudio e vídeo ─────────────────────────────────────────────
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];

    if (audioTrack) audioProducer = await MSClient.produceAudio(audioTrack);
    if (videoTrack) videoProducer = await MSClient.produceVideo(videoTrack);
  }

  // ── 8. Consumir peers já na sala ──────────────────────────────────────────
  for (const peer of existingPeers) {
    // Criar card de vídeo para o peer
    const videoEl = UI.addVideoCard(peer.id, peer.displayName);
    UI.addSystemMessage(`${peer.displayName} já está na sala`);

    // Consumir cada producer do peer
    for (const prod of peer.producers) {
      producerMap.set(prod.id, { peerId: peer.id, displayName: peer.displayName, ...prod });
      await consumeAndAttach(prod.id, peer.id, peer.displayName, videoEl, prod.appData);
    }
  }

  // ── 9. Registrar listeners ────────────────────────────────────────────────

  // Novo peer entrou na sala
  socket.on('peerJoined', (peer) => {
    UI.addVideoCard(peer.id, peer.displayName);
    UI.addSystemMessage(`${peer.displayName} entrou na sala`);
    UI.addChatMessage(null, null, `${peer.displayName} entrou na sala`, Date.now(), localPeerId);
  });

  // Peer saiu da sala
  socket.on('peerLeft', ({ peerId }) => {
    // Descobrir o nome antes de remover
    const card = document.querySelector(`[data-peer-id="${peerId}"]`);
    const name = card?.querySelector('.peer-name')?.textContent?.replace(' (você)', '') || peerId;
    UI.removeVideoCard(peerId);
    UI.addSystemMessage(`${name} saiu da sala`);
  });

  // Novo producer disponível (peer ativou câmera, mic ou tela)
  socket.on('newProducer', async ({ peerId, displayName: peerName, producerId, kind, appData }) => {
    producerMap.set(producerId, { peerId, displayName: peerName, kind, appData });

    // Encontrar o elemento de vídeo existente do peer
    const existingCard = document.querySelector(`[data-peer-id="${peerId}"]`);
    let videoEl;
    if (appData && appData.type === 'screen') {
      videoEl = UI.addScreenCard(peerId, peerName);
    } else {
      videoEl = existingCard?.querySelector('video') || UI.addVideoCard(peerId, peerName).querySelector('video');
    }

    await consumeAndAttach(producerId, peerId, peerName, videoEl, appData);
  });

  // Producer fechado (peer desligou câmera, tela etc.)
  socket.on('producerClosed', ({ producerId, peerId }) => {
    const info = producerMap.get(producerId);
    if (!info) return;
    producerMap.delete(producerId);
    if (info.appData && info.appData.type === 'screen') {
      UI.removeVideoCard(`${peerId}-screen`);
    }
  });

  // Mensagem de chat
  socket.on('chatMessage', ({ peerId, displayName: senderName, message, timestamp }) => {
    UI.addChatMessage(peerId, senderName, message, timestamp, localPeerId);
  });

  // ── Pronto ────────────────────────────────────────────────────────────────
  UI.hideLoading();

  // ────────────────────────────────────────────────────────────────────────────
  // Funções auxiliares
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Consome um producer remoto e anexa o track ao elemento de vídeo correto.
   */
  async function consumeAndAttach(producerId, peerId, peerName, videoEl, appData) {
    try {
      const { track, consumer } = await MSClient.consumeProducer(producerId);

      if (appData && appData.type === 'screen') {
        // Tela: elemento dedicado
        if (videoEl) {
          videoEl.srcObject = new MediaStream([track]);
          videoEl.play().catch((e) => console.log('Screen autoplay warning:', e));
        }
      } else if (consumer.kind === 'audio') {
        // Áudio: elemento de áudio no DOM
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.srcObject = new MediaStream([track]);
        document.body.appendChild(audio);
        audio.play().catch((e) => console.log('Audio autoplay warning:', e));
        // Detectar voz para animação de borda
        startVoiceDetection(new MediaStream([track]), peerId);
      } else if (consumer.kind === 'video') {
        // Vídeo da câmera
        const card = document.querySelector(`[data-peer-id="${peerId}"]`);
        const targetVideo = card?.querySelector('video') || videoEl;
        if (targetVideo) {
          targetVideo.srcObject = new MediaStream([track]);
          targetVideo.play().catch((e) => console.log('Video autoplay warning:', e));
          UI.setCamState(peerId, true);
        }
      }
    } catch (err) {
      console.error(`[consume] Erro ao consumir producer ${producerId}:`, err);
    }
  }

  /**
   * Voice Activity Detection via Web Audio API.
   * Atualiza a borda de "falando" no card do peer.
   */
  function startVoiceDetection(stream, peerId) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let isSpeaking = false;

      setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const nowSpeaking = avg > 12;
        if (nowSpeaking !== isSpeaking) {
          isSpeaking = nowSpeaking;
          UI.setSpeaking(peerId, isSpeaking);
        }
      }, 100);
    } catch (e) {
      // Web Audio não suportado — silenciosamente ignorar
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Botões de controle
  // ────────────────────────────────────────────────────────────────────────────

  // ── Microfone ───────────────────────────────────────────────────────────────
  document.getElementById('btn-mic').addEventListener('click', () => {
    micEnabled = !micEnabled;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
    }
    UI.setControlState('btn-mic', micEnabled);
    UI.setMicState('local', !micEnabled);
  });

  // ── Câmera ───────────────────────────────────────────────────────────────────
  document.getElementById('btn-cam').addEventListener('click', async () => {
    camEnabled = !camEnabled;

    if (localStream) {
      localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
    }

    if (videoProducer) {
      if (camEnabled) videoProducer.resume();
      else videoProducer.pause();
    }

    UI.setCamState('local', camEnabled);
    UI.setControlState('btn-cam', camEnabled);
  });

  // ── Compartilhar Tela ─────────────────────────────────────────────────────────
  document.getElementById('btn-screen').addEventListener('click', async () => {
    if (sharingScreen) {
      // Parar compartilhamento
      if (screenProducer) {
        screenProducer.close();
        socket.emit('closeProducer', { producerId: screenProducer.id });
        screenProducer = null;
      }
      sharingScreen = false;
      UI.setControlState('btn-screen', false);
      // Remover card de tela local
      UI.removeVideoCard('local-screen');
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15 }, cursor: 'always' },
          audio: false,
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        // Mostrar preview local da tela
        const screenVideo = UI.addScreenCard('local', `${displayName} (você)`);
        screenVideo.srcObject = screenStream;

        // Produzir para o servidor
        screenProducer = await MSClient.produceScreen(screenTrack);
        sharingScreen = true;
        UI.setControlState('btn-screen', true);

        // Parar automaticamente se o usuário fechar a janela de seleção
        screenTrack.onended = () => {
          document.getElementById('btn-screen').click();
        };
      } catch (err) {
        console.warn('[screen] Compartilhamento cancelado ou não suportado:', err);
      }
    }
  });

  // ── Sair da Chamada ─────────────────────────────────────────────────────────
  document.getElementById('btn-leave').addEventListener('click', () => {
    socket.disconnect();
    window.location.href = '/';
  });

  // ── Chat toggle ────────────────────────────────────────────────────────────
  document.getElementById('btn-chat-toggle').addEventListener('click', () => {
    UI.toggleChat();
  });

  // ── Envio de mensagem de chat ──────────────────────────────────────────────
  function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chatMessage', { message: msg });
    input.value = '';
  }

  document.getElementById('btn-send').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // ── Fechar com aviso ───────────────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    socket.disconnect();
  });

})();
