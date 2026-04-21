const express = require('express');
const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');
const { Movements, pathfinder, goals } = require('mineflayer-pathfinder');
const config = require('./settings.json');

const app = express();
const webPort = Number(process.env.PORT || 3000);
let reconnectTimer = null;
let bot = null;

const status = {
  startedAt: new Date().toISOString(),
  connectionState: 'starting',
  connected: false,
  username: config['bot-account']?.username || 'unknown',
  server: `${config.server?.ip || 'unknown'}:${config.server?.port || 25565}`,
  version: config.server?.version || 'auto',
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastReconnectAt: null,
  reconnectCount: 0,
  lastKickReason: null,
  lastError: null
};

function formatDate(value) {
  if (!value) {
    return 'Never';
  }
  return new Date(value).toLocaleString();
}

function getUptime() {
  const seconds = Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderDashboard() {
  const online = status.connected;
  const badgeText = online ? 'Connected' : status.connectionState;
  const badgeClass = online ? 'online' : 'offline';
  const lastProblem = status.lastError || status.lastKickReason || 'No recent errors';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>AFK Bot Status</title>
  <style>
    body { margin: 0; min-height: 100vh; font-family: Arial, sans-serif; background: #0f172a; color: #e5e7eb; display: grid; place-items: center; padding: 24px; }
    .card { width: min(760px, 100%); background: #111827; border: 1px solid #334155; border-radius: 20px; padding: 28px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: center; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 32px; }
    .badge { padding: 10px 14px; border-radius: 999px; font-weight: 700; text-transform: capitalize; }
    .online { background: #064e3b; color: #a7f3d0; }
    .offline { background: #7f1d1d; color: #fecaca; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-top: 24px; }
    .item { background: #020617; border: 1px solid #1e293b; border-radius: 14px; padding: 16px; }
    .label { color: #94a3b8; font-size: 13px; margin-bottom: 7px; }
    .value { font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
    .footer { margin-top: 22px; color: #94a3b8; font-size: 14px; line-height: 1.5; }
    a { color: #93c5fd; }
  </style>
</head>
<body>
  <main class="card">
    <section class="top">
      <div>
        <h1>AFK Bot Status</h1>
        <div class="footer">This page refreshes automatically every 15 seconds.</div>
      </div>
      <div class="badge ${badgeClass}">${escapeHtml(badgeText)}</div>
    </section>
    <section class="grid">
      <div class="item"><div class="label">Bot</div><div class="value">${escapeHtml(status.username)}</div></div>
      <div class="item"><div class="label">Server</div><div class="value">${escapeHtml(status.server)}</div></div>
      <div class="item"><div class="label">Uptime</div><div class="value">${escapeHtml(getUptime())}</div></div>
      <div class="item"><div class="label">Last Connected</div><div class="value">${escapeHtml(formatDate(status.lastConnectedAt))}</div></div>
      <div class="item"><div class="label">Last Disconnected</div><div class="value">${escapeHtml(formatDate(status.lastDisconnectedAt))}</div></div>
      <div class="item"><div class="label">Last Reconnect</div><div class="value">${escapeHtml(formatDate(status.lastReconnectAt))}</div></div>
      <div class="item"><div class="label">Reconnect Count</div><div class="value">${status.reconnectCount}</div></div>
      <div class="item"><div class="label">Last Problem</div><div class="value">${escapeHtml(lastProblem)}</div></div>
    </section>
    <div class="footer">Raw status data is available at <a href="/api/status">/api/status</a>.</div>
  </main>
</body>
</html>`;
}

app.get('/', (req, res) => {
  res.type('html').send(renderDashboard());
});

app.get('/api/status', (req, res) => {
  res.json({
    ...status,
    uptime: getUptime()
  });
});

app.listen(webPort, '0.0.0.0', () => {
  console.log(`Web dashboard listening on port ${webPort}`);
});

function getAuthType() {
  const account = config['bot-account'] || {};
  if (!account.password) {
    return 'offline';
  }
  return account.type || 'mojang';
}

function scheduleReconnect(reason) {
  const utils = config.utils || {};
  if (!utils['auto-reconnect']) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  const delay = Number(utils['auto-reconnect-delay'] || 5000);
  status.connectionState = 'reconnecting';
  status.connected = false;
  status.lastReconnectAt = new Date().toISOString();
  status.reconnectCount += 1;
  console.log(`Reconnecting in ${delay}ms${reason ? ` after ${reason}` : ''}`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
}

function sendAuthCommands(botInstance) {
  const autoAuth = config.utils?.['auto-auth'];
  if (!autoAuth?.enabled || !autoAuth.password) {
    return;
  }

  setTimeout(() => {
    botInstance.chat(`/register ${autoAuth.password} ${autoAuth.password}`);
    botInstance.chat(`/login ${autoAuth.password}`);
    console.log('Sent auto-auth commands');
  }, 500);
}

function sendChatMessages(botInstance) {
  const chatMessages = config.utils?.['chat-messages'];
  if (!chatMessages?.enabled || !Array.isArray(chatMessages.messages)) {
    return;
  }

  if (chatMessages.repeat) {
    let index = 0;
    const delay = Number(chatMessages['repeat-delay'] || 25) * 1000;
    const interval = setInterval(() => {
      if (!botInstance.entity) {
        return;
      }
      botInstance.chat(chatMessages.messages[index]);
      index = (index + 1) % chatMessages.messages.length;
    }, delay);
    botInstance.once('end', () => clearInterval(interval));
    return;
  }

  chatMessages.messages.forEach((message) => botInstance.chat(message));
}

function moveToConfiguredPosition(botInstance) {
  const position = config.position;
  if (!position?.enabled) {
    return;
  }

  const mcData = minecraftData(botInstance.version);
  const movements = new Movements(botInstance, mcData);
  botInstance.pathfinder.setMovements(movements);
  botInstance.pathfinder.setGoal(new goals.GoalBlock(position.x, position.y, position.z));
  console.log(`Moving to ${position.x}, ${position.y}, ${position.z}`);
}

function enableAntiAfk(botInstance) {
  const antiAfk = config.utils?.['anti-afk'];
  if (!antiAfk?.enabled) {
    return;
  }

  botInstance.setControlState('jump', true);
  if (antiAfk.sneak) {
    botInstance.setControlState('sneak', true);
  }
  console.log('Anti-AFK enabled');
}

function createBot() {
  const account = config['bot-account'] || {};
  const server = config.server || {};

  if (!account.username || !server.ip) {
    status.connectionState = 'configuration error';
    status.connected = false;
    status.lastError = 'Missing bot username or server IP in settings.json';
    console.error(status.lastError);
    return;
  }

  status.connectionState = 'connecting';
  status.server = `${server.ip}:${server.port || 25565}`;
  status.version = server.version || 'auto';
  status.username = account.username;
  console.log(`Connecting ${account.username} to ${server.ip}:${server.port || 25565}`);

  bot = mineflayer.createBot({
    username: account.username,
    password: account.password || undefined,
    auth: getAuthType(),
    host: server.ip,
    port: Number(server.port || 25565),
    version: server.version || false
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    status.connectionState = 'connected';
    status.connected = true;
    status.lastConnectedAt = new Date().toISOString();
    status.lastError = null;
    console.log('Bot spawned');
    sendAuthCommands(bot);
    sendChatMessages(bot);
    moveToConfiguredPosition(bot);
    enableAntiAfk(bot);
  });

  bot.on('chat', (username, message) => {
    if (config.utils?.['chat-log']) {
      console.log(`<${username}> ${message}`);
    }
  });

  bot.on('kicked', (reason) => {
    status.lastKickReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log('Bot was kicked:', reason);
  });

  bot.on('end', () => {
    status.connectionState = 'disconnected';
    status.connected = false;
    status.lastDisconnectedAt = new Date().toISOString();
    console.log('Bot disconnected');
    scheduleReconnect('disconnect');
  });

  bot.on('error', (error) => {
    status.lastError = error.message || String(error);
    console.error('Bot error:', status.lastError);
  });
}

process.on('uncaughtException', (error) => {
  status.connectionState = 'error';
  status.connected = false;
  status.lastError = error.message || String(error);
  console.error('Uncaught error:', status.lastError);
  scheduleReconnect('uncaught error');
});

process.on('unhandledRejection', (error) => {
  status.lastError = error?.message || String(error);
  console.error('Unhandled rejection:', status.lastError);
});

createBot();
