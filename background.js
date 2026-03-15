/**
 * BACKGROUND.JS — Service Worker
 * Persiste videos detectados usando chrome.storage.session para sobrevivir
 * a la suspensión del service worker en MV3.
 */

// ── Helpers de almacenamiento ────────────────────────────────────────────────

async function getStore() {
  const data = await chrome.storage.session.get('videoStore');
  return data.videoStore || {};
}

async function saveStore(store) {
  await chrome.storage.session.set({ videoStore: store });
}

async function saveVideo(tabId, urls, source = 'network') {
  const store = await getStore();
  const key = String(tabId);
  if (!store[key]) store[key] = [];

  const existing = new Set(store[key].map(v => v.url));
  let added = false;

  for (const rawUrl of urls) {
    const url = rawUrl.split('#')[0].trim(); // quitar fragmentos
    if (!url || existing.has(url)) continue;
    if (!isVideoUrl(url)) continue;

    // Descartar fragmentos .ts pequeños excepto los que son master o playlist
    const lurl = url.toLowerCase();
    if (lurl.includes('.ts') && !lurl.includes('master') && !lurl.includes('playlist') && !lurl.includes('index')) {
      continue;
    }

    existing.add(url);
    store[key].push({ url, source });
    added = true;
  }

  if (added) {
    await saveStore(store);
    const count = store[key].length;
    chrome.action.setBadgeText({ text: String(count), tabId: parseInt(key) });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId: parseInt(key) });
  }
}

function isVideoUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  const lurl = url.toLowerCase();
  return VIDEO_PATTERNS.some(p => lurl.includes(p));
}

const VIDEO_PATTERNS = [
  // Extensiones directas
  '.mp4', '.m3u8', '.mpd', '.mkv', '.webm', '.m4s', '.avi', '.mov', '.flv',
  // Keywords genéricas
  'get_video', 'videoplayback', 'delivery', 'master.m3u8',
  'playlist.m3u8', 'manifest.mpd',
  // CDN genéricos
  'videodelivery.net', 'b-cdn.net', 'jwplatform.com', 'jwpsrv.com',
  'akamaihd.net', 'cloudfront.net/video', 'video.twimg.com', 'fbcdn.net/v/t',
  // Doodstream (todos los mirrors conocidos a 2026)
  '/pass_md5', 'doodcdn.com', 'doods.pro',
  'dood.la', 'dood.pm', 'dood.sh', 'dood.so', 'dood.to',
  'dood.watch', 'dood.wf', 'dood.ws', 'dood.cx', 'dood.re', 'dood.yt',
  'd0000d.xyz', 'ds2play.com', 'dooood.com',
  // Filemoon
  'mooncdn.com', 'kerapoxy.cc', 'filemoon.sx', 'filemoon.in', 'filemoon.to',
  // FileLions
  'filelions.online', 'filelions.to', 'filelions.live', 'filelions.site',
  // Streamwish
  'wishfast.top', 'swdyu.com', 'streamwish.com', 'streamwish.to',
  'sfastwish.com', 'dwish.eu', 'awish.eu', 'rwish.eu',
  // Streamtape
  'streamtape.com/get_video', 'streamtape.net/get_video',
  'stape.fun', 'streamta.pe',
  // Netu / HQQ
  'netu.ac', 'hqq.tv', 'hqq.to', 'waaw.tv',
  // Vidguard / Vgfplay / Vidhide
  'vidguard.to', 'vgfplay.com', 'listeamed.net', 'bembed.net', 'vidhide.com',
  // Powvideo
  'powvideo.net', 'powv.net',
  // StreamHide / StreamVid / Smashystream
  'streamhide.to', 'streamvid.net', 'smashy.stream', 'guccihide.com',
  // VOE
  'voe.sx', 'voe-network.net',
  // Otros
  'upstream.to', 'up-load.io', 'mixdrop.co', 'mixdrop.to',
  'vidoza.net', 'streamlare.com', 'vudeo.net',
  'luluvdo.com', 'turbovid.me',
  'ok.ru/videoembed', 'vk.com/video_ext'
];

// ── Mensajes desde content script y popup ────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'videosEncontrados' && sender.tab) {
    saveVideo(sender.tab.id, request.urls, request.source || 'dom');
    sendResponse({ ok: true });
  }

  if (request.action === 'getVideos') {
    getStore().then(store => {
      const key = String(request.tabId);
      sendResponse({ videos: store[key] || [] });
    });
    return true; // respuesta asíncrona
  }

  if (request.action === 'clearVideos') {
    getStore().then(store => {
      delete store[String(request.tabId)];
      saveStore(store).then(() => {
        chrome.action.setBadgeText({ text: '', tabId: request.tabId });
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  return true;
});

// ── Interceptor de red (captura peticiones reales del navegador) ──────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (isVideoUrl(details.url)) {
      saveVideo(details.tabId, [details.url], 'network');
    }
  },
  { urls: ['<all_urls>'] }
);

// ── Limpiar datos al cerrar una pestaña ───────────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const store = await getStore();
  if (store[String(tabId)]) {
    delete store[String(tabId)];
    await saveStore(store);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-UPDATE CHECKER
// Comprueba cada 6 horas si existe una versión nueva en el repositorio.
// La URL apunta al archivo update.json alojado en GitHub (raw content).
// ═══════════════════════════════════════════════════════════════════════════════

const CURRENT_VERSION   = chrome.runtime.getManifest().version;
const UPDATE_CHECK_URL  = 'https://raw.githubusercontent.com/TU_USUARIO/Video-Hunter-Pro/main/update.json';
const UPDATE_ALARM_NAME = 'videoHunterUpdateCheck';
const UPDATE_INTERVAL_HOURS = 6;

/**
 * Compara dos strings de versión semántica (ej: "3.1" vs "3.2").
 * Devuelve true si remoteVersion es mayor que localVersion.
 */
function isNewerVersion(localVersion, remoteVersion) {
  const local  = localVersion.split('.').map(Number);
  const remote = remoteVersion.split('.').map(Number);
  const len = Math.max(local.length, remote.length);
  for (let i = 0; i < len; i++) {
    const l = local[i]  || 0;
    const r = remote[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/**
 * Descarga update.json del repositorio y guarda el resultado en storage.
 * Si hay una versión nueva, muestra una notificación del sistema.
 */
async function checkForUpdates() {
  try {
    const response = await fetch(UPDATE_CHECK_URL, { cache: 'no-store' });
    if (!response.ok) return;

    const data = await response.json();
    const remoteVersion = data.version;

    if (!remoteVersion) return;

    if (isNewerVersion(CURRENT_VERSION, remoteVersion)) {
      // Guardar info de actualización para que el popup la muestre
      await chrome.storage.local.set({
        updateAvailable: {
          version:     remoteVersion,
          releaseUrl:  data.release_url  || '',
          downloadUrl: data.download_url || '',
          notes:       data.notes        || '',
          checkedAt:   Date.now()
        }
      });

      // Notificación del sistema
      chrome.notifications.create('vhp-update', {
        type:    'basic',
        iconUrl: 'icons/48x48.png',
        title:   '🎬 Video Hunter Pro — Actualización disponible',
        message: `Versión ${remoteVersion} disponible. Haz clic para actualizar.`,
        priority: 1
      });
    } else {
      // Limpiar cualquier aviso de actualización obsoleto
      await chrome.storage.local.remove('updateAvailable');
    }
  } catch (e) {
    // Sin conexión o repositorio no disponible — ignorar silenciosamente
  }
}

// Abrir la página de releases al hacer clic en la notificación
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'vhp-update') {
    chrome.storage.local.get('updateAvailable', (data) => {
      const url = data.updateAvailable && data.updateAvailable.releaseUrl;
      if (url) chrome.tabs.create({ url });
    });
    chrome.notifications.clear('vhp-update');
  }
});

// Configurar la alarma periódica al instalar / actualizar la extensión
chrome.runtime.onInstalled.addListener(() => {
  // Comprobar inmediatamente al instalar
  checkForUpdates();
  // Programar comprobaciones periódicas
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes:  1,
    periodInMinutes: UPDATE_INTERVAL_HOURS * 60
  });
});

// También configurar la alarma al arrancar el navegador (por si se perdió)
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(UPDATE_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(UPDATE_ALARM_NAME, {
        delayInMinutes:  1,
        periodInMinutes: UPDATE_INTERVAL_HOURS * 60
      });
    }
  });
  checkForUpdates();
});

// Ejecutar la comprobación cuando se dispare la alarma
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) checkForUpdates();
});