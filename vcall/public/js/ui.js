/**
 * ui.js — Manipulação da interface do usuário (room.html)
 * Não faz chamadas de rede, apenas manipula o DOM.
 */

const UI = (() => {
  const grid = document.getElementById('video-grid');
  const chatMessages = document.getElementById('chat-messages');
  const chatBadge = document.getElementById('chat-badge');
  const chatPanel = document.getElementById('chat-panel');

  let chatOpen = false;
  let unreadCount = 0;

  // ─── Utilitários ──────────────────────────────────────────────────────────

  function setLoadingText(text) {
    document.getElementById('loading-text').textContent = text;
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 500);
  }

  function setRoomName(name) {
    document.getElementById('room-name-display').textContent = name;
    document.title = `vcall — ${name}`;
  }

  // Gera iniciais para o avatar de quem está com câmera off
  function getInitials(name) {
    return name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }

  // Atualiza o atributo data-count do grid para ajustar o layout CSS
  function updateGridLayout() {
    const count = grid.children.length;
    grid.setAttribute('data-count', Math.min(count, 6));
  }

  // ─── Vídeos / Cards ───────────────────────────────────────────────────────

  /**
   * Cria e insere um card de vídeo no grid.
   * @param {string} peerId   - ID do peer (ou 'local')
   * @param {string} name     - Nome de exibição
   * @param {boolean} isLocal - Se é o vídeo local (mirrored)
   * @returns {HTMLVideoElement} - O elemento <video> dentro do card
   */
  function addVideoCard(peerId, name, isLocal = false) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.peerId = peerId;

    // Elemento de vídeo
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
      video.muted = true; // evita eco local
      video.style.transform = 'scaleX(-1)'; // espelhar visão local
    }

    // Avatar (quando câmera off)
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const circle = document.createElement('div');
    circle.className = 'avatar-circle';
    circle.textContent = getInitials(name);
    const avatarName = document.createElement('div');
    avatarName.className = 'avatar-name';
    avatarName.textContent = isLocal ? `${name} (você)` : name;
    avatar.appendChild(circle);
    avatar.appendChild(avatarName);

    // Nome sobre o vídeo
    const peerName = document.createElement('div');
    peerName.className = 'peer-name';
    peerName.textContent = isLocal ? `${name} (você)` : name;

    // Ícone de mic mudo
    const micMuted = document.createElement('div');
    micMuted.className = 'mic-muted-icon';
    micMuted.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
      <path d="M17 16.95A7 7 0 0 1 5 12v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>`;

    card.appendChild(video);
    card.appendChild(avatar);
    card.appendChild(peerName);
    card.appendChild(micMuted);
    grid.appendChild(card);
    updateGridLayout();

    return video;
  }

  /**
   * Adiciona um <video> extra a um card existente (para compartilhamento de tela).
   */
  function addScreenCard(peerId, name) {
    const card = document.createElement('div');
    card.className = 'video-card screen-card';
    card.dataset.peerId = `${peerId}-screen`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;

    const peerName = document.createElement('div');
    peerName.className = 'peer-name';
    peerName.textContent = `🖥️ Tela de ${name}`;

    card.appendChild(video);
    card.appendChild(peerName);
    grid.appendChild(card);
    updateGridLayout();

    return video;
  }

  /**
   * Remove um card de vídeo do grid.
   */
  function removeVideoCard(peerId) {
    const card = grid.querySelector(`[data-peer-id="${peerId}"]`);
    if (card) {
      card.remove();
      updateGridLayout();
    }
    // Também remover card de tela, se houver
    const screenCard = grid.querySelector(`[data-peer-id="${peerId}-screen"]`);
    if (screenCard) {
      screenCard.remove();
      updateGridLayout();
    }
  }

  /**
   * Marca/desmarca câmera off em um card.
   */
  function setCamState(peerId, isOn) {
    const card = grid.querySelector(`[data-peer-id="${peerId}"]`);
    if (!card) return;
    card.classList.toggle('cam-off', !isOn);
  }

  /**
   * Marca/desmarca mic mudo em um card.
   */
  function setMicState(peerId, isMuted) {
    const card = grid.querySelector(`[data-peer-id="${peerId}"]`);
    if (!card) return;
    const icon = card.querySelector('.mic-muted-icon');
    if (icon) icon.style.display = isMuted ? 'flex' : 'none';
  }

  /**
   * Marca o card como "falando" (borda verde).
   */
  function setSpeaking(peerId, isSpeaking) {
    const card = grid.querySelector(`[data-peer-id="${peerId}"]`);
    if (!card) return;
    card.classList.toggle('speaking', isSpeaking);
  }

  // ─── Controles ────────────────────────────────────────────────────────────

  /**
   * Atualiza o visual de um botão de controle (ativo/inativo).
   */
  function setControlState(btnId, isActive) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.classList.toggle('active', isActive);
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────

  function toggleChat() {
    chatOpen = !chatOpen;
    chatPanel.classList.toggle('open', chatOpen);
    const toggleBtn = document.getElementById('btn-chat-toggle');
    toggleBtn.classList.toggle('active', chatOpen);

    if (chatOpen) {
      unreadCount = 0;
      chatBadge.style.display = 'none';
      // Scroll para o fim
      chatMessages.scrollTop = chatMessages.scrollHeight;
      document.getElementById('chat-input').focus();
    }
  }

  /**
   * Renderiza uma mensagem de chat.
   * @param {string} peerId       - ID de quem enviou
   * @param {string} displayName  - Nome do remetente
   * @param {string} message      - Conteúdo da mensagem
   * @param {number} timestamp    - Timestamp Unix (ms)
   * @param {string} localPeerId  - ID do usuário local (para marcar mensagens próprias)
   */
  function addChatMessage(peerId, displayName, message, timestamp, localPeerId) {
    const isOwn = peerId === localPeerId;

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg${isOwn ? ' own' : ''}`;

    const time = new Date(timestamp).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const header = document.createElement('div');
    header.className = 'chat-msg-header';
    header.textContent = isOwn ? `Você · ${time}` : `${displayName} · ${time}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';
    bubble.textContent = message;

    msgEl.appendChild(header);
    msgEl.appendChild(bubble);
    chatMessages.appendChild(msgEl);

    // Scroll automático
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Badge de não lida
    if (!chatOpen && !isOwn) {
      unreadCount++;
      chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
      chatBadge.style.display = 'flex';
    }
  }

  /**
   * Adiciona mensagem de sistema (peer entrou/saiu).
   */
  function addSystemMessage(text) {
    const el = document.createElement('div');
    el.style.cssText = 'text-align:center;font-size:.75rem;color:#64748b;padding:4px 0;';
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ─── Exposição pública ────────────────────────────────────────────────────

  return {
    setLoadingText,
    hideLoading,
    setRoomName,
    addVideoCard,
    addScreenCard,
    removeVideoCard,
    setCamState,
    setMicState,
    setSpeaking,
    setControlState,
    toggleChat,
    addChatMessage,
    addSystemMessage,
  };
})();
