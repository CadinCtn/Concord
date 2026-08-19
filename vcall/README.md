# vcall — Vídeo-chamada em V-LAN

Aplicação de vídeo-chamadas multi-party com áudio, vídeo, compartilhamento de tela e chat de texto.  
Construída com **WebRTC + mediasoup (SFU) + Socket.IO + Node.js**.

---

## Pré-requisitos

| Ferramenta | Versão mínima | Download |
|-----------|--------------|---------|
| Node.js | 18 LTS | https://nodejs.org |
| Visual Studio Build Tools | 2019+ | https://aka.ms/vs/17/release/vs_BuildTools.exe |
| OpenSSL (ou mkcert) | qualquer | https://slproweb.com/products/Win32OpenSSL.html |
| Radmin VPN | qualquer | https://www.radmin-vpn.com |

> **Por quê o Visual Studio Build Tools?**  
> O mediasoup compila código C++ nativo. No Windows ele precisa do compilador MSVC.

---

## Instalação

### 1. Instalar dependências Node.js

```bash
cd vcall
npm install
```

A compilação do mediasoup pode levar alguns minutos na primeira vez.

---

### 2. Gerar o certificado HTTPS (auto-assinado)

Browsers **exigem HTTPS** para acessar câmera/microfone quando o acesso é feito via IP (não localhost).

#### Opção A — mkcert (recomendada, mais simples)

```bash
# Instalar mkcert (via winget)
winget install FiloSottile.mkcert

# Instalar a CA local (executa uma vez)
mkcert -install

# Gerar certificado para o IP do servidor na Radmin VPN
# Substitua 26.x.x.x pelo seu IP real
mkcert -key-file server/ssl/key.pem -cert-file server/ssl/cert.pem 26.x.x.x localhost 127.0.0.1
```

Com mkcert, o browser **não mostrará aviso de certificado** para os outros usuários da rede, desde que eles também executem `mkcert -install` em suas máquinas.

#### Opção B — OpenSSL

```bash
mkdir server\ssl

openssl req -x509 -newkey rsa:2048 ^
  -keyout server/ssl/key.pem ^
  -out server/ssl/cert.pem ^
  -days 365 -nodes ^
  -subj "/CN=26.x.x.x"
```

Neste caso os clientes verão um aviso de certificado no browser — clique em "Avançado" → "Continuar assim mesmo".

---

### 3. Configurar o IP do servidor

Abra `server/config.js` e ajuste o `ANNOUNCED_IP`:

```js
ANNOUNCED_IP: '26.x.x.x',  // ← IP do servidor na rede Radmin VPN
```

Ou defina a variável de ambiente antes de iniciar:

```bash
set ANNOUNCED_IP=26.x.x.x
node server/index.js
```

---

### 4. Abrir as portas no Firewall do Windows

O mediasoup usa UDP na faixa 40000–49999 e a porta 3000 TCP (HTTPS).

```powershell
# Executar como Administrador
netsh advfirewall firewall add rule name="vcall HTTPS" protocol=TCP dir=in localport=3000 action=allow
netsh advfirewall firewall add rule name="vcall WebRTC UDP" protocol=UDP dir=in localport=40000-49999 action=allow
```

---

### 5. Iniciar o servidor

```bash
node server/index.js
```

Você verá:
```
╔══════════════════════════════════════════╗
║         vcall - Servidor iniciado        ║
╠══════════════════════════════════════════╣
║  URL: https://26.x.x.x:3000             ║
║  IP anunciado: 26.x.x.x                 ║
╚══════════════════════════════════════════╝
```

---

## Acesso pelos outros usuários

1. Conectar ao mesmo grupo do **Radmin VPN**
2. Abrir o browser (Chrome ou Edge recomendado)
3. Acessar: `https://26.x.x.x:3000`
4. Se aparecer aviso de certificado: clique em **Avançado** → **Continuar**
5. Digitar o nome e o ID da sala → **Entrar na Sala**

> Todos que entrarem na mesma ID de sala estarão na mesma chamada.

---

## Funcionalidades

| Funcionalidade | Como usar |
|---------------|----------|
| 🎤 Microfone | Botão Mic na barra inferior |
| 📷 Câmera | Botão Câmera na barra inferior |
| 🖥️ Compartilhar tela | Botão Tela — abre seletor do sistema |
| 💬 Chat | Botão Chat (direita) — abre painel lateral |
| 📞 Sair | Botão vermelho — retorna à tela inicial |

---

## Estrutura do Projeto

```
vcall/
├── server/
│   ├── index.js              # Entry point, Express + HTTPS + Socket.IO
│   ├── config.js             # ← EDITAR: IP do servidor
│   ├── lib/
│   │   ├── Room.js           # Gerenciamento de salas
│   │   ├── Peer.js           # Abstração de participante
│   │   └── mediasoupManager.js  # Workers mediasoup
│   └── ssl/
│       ├── key.pem           # Chave privada (gerar conforme instruções)
│       └── cert.pem          # Certificado
├── public/
│   ├── index.html            # Tela de entrada
│   ├── room.html             # Tela da chamada
│   ├── css/style.css         # Estilos
│   └── js/
│       ├── app.js            # Orquestrador principal
│       ├── mediasoupClient.js # Wrapper mediasoup-client
│       └── ui.js             # Manipulação de interface
└── package.json
```

---

## Solução de Problemas

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| `npm install` falha com erro C++ | Build tools ausente | Instalar Visual Studio Build Tools |
| Browser não abre câmera | Sem HTTPS | Gerar certificado e acessar via `https://` |
| Outros não ouvem/veem | IP anunciado errado | Verificar `ANNOUNCED_IP` no config.js |
| Conexão recusada na porta 3000 | Firewall bloqueando | Adicionar regra de firewall conforme passo 4 |
| Vídeo congelado / sem áudio | Portas UDP fechadas | Abrir faixa 40000-49999 UDP no firewall |

---

## Desenvolvimento

Para reiniciar automaticamente ao salvar arquivos:

```bash
npm run dev
```

Requer `nodemon` (já incluído nas devDependencies).
