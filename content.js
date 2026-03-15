/**
 * CONTENT.JS — Detector inyectado en cada página e iframe.
 * Estrategia multi-capa:
 *   1. Interceptar fetch/XHR en contexto de página — incluso respuestas (Doodstream, etc.)
 *   2. Escanear el DOM (video, source, iframe, scripts, JSON-LD, meta)
 *   3. Decodificar P,A,C,K,E,R (Filemoon, Streamwish) y ofuscación hex/base64 (Netu/HQQ)
 *   4. Extractores específicos por servidor: Doodstream, Filemoon, Streamwish, Netu/HQQ
 *   5. Detectar configs de players conocidos (JW Player, Video.js, Plyr, Flowplayer)
 *   6. Observar cambios del DOM con MutationObserver
 */

// ── Patrones de video ─────────────────────────────────────────────────────────

const VIDEO_PATTERNS = [
  // Extensiones directas
  '.mp4', '.m3u8', '.mpd', '.mkv', '.webm', '.m4s', '.avi', '.mov', '.flv',
  // Keywords genéricas
  'get_video', 'videoplayback', '/stream', 'delivery',
  'master.m3u8', 'playlist.m3u8', 'manifest.mpd', 'index.m3u8',
  // CDN genéricos
  'videodelivery.net', 'b-cdn.net', 'jwplatform.com', 'jwpsrv.com',
  'akamaihd.net', 'cloudfront.net/video', 'video.twimg.com',
  'fbcdn.net/v/t', 'cdn.jwplayer.com',
  // Doodstream y mirrors (2026)
  '/pass_md5', 'doodstream', 'doodcdn.com', 'doods.pro',
  'dood.la', 'dood.pm', 'dood.sh', 'dood.so', 'dood.to',
  'dood.watch', 'dood.wf', 'dood.ws', 'dood.cx', 'dood.re', 'dood.yt',
  'd0000d.xyz', 'ds2play.com', 'dooood.com',
  // Filemoon y mirrors
  'filemoon.sx', 'filemoon.in', 'filemoon.to', 'filemoon.io',
  'mooncdn.com', 'kerapoxy.cc',
  // FileLions y mirrors
  'filelions.online', 'filelions.to', 'filelions.live', 'filelions.site',
  // Streamwish y mirrors
  'streamwish.com', 'streamwish.to', 'streamwish.site',
  'wishfast.top', 'swdyu.com', 'strmwsh', 'sfastwish.com',
  'dwish.eu', 'awish.eu', 'rwish.eu',
  // Streamtape
  'streamtape.com/get_video', 'streamtape.net', 'streamtape.xyz',
  'stape.fun', 'streamta.pe',
  // Netu / HQQ
  'netu.ac', 'hqq.tv', 'hqq.to', 'waaw.tv',
  // Vidguard / Vgfplay / Vidhide
  'vidguard.to', 'vgfplay.com', 'listeamed.net', 'bembed.net', 'vidhide.com',
  // Powvideo
  'powvideo.net', 'powv.net',
  // StreamHide / StreamVid / Smashystream
  'streamhide.to', 'streamvid.net', 'smashy.stream', 'guccihide.com',
  'sheepstream.com', 'smoothpre.com',
  // VOE
  'voe.sx', 'voe-network.net',
  // Otros
  'upstream.to', 'up-load.io',
  'mixdrop.co', 'mixdrop.to', 'mixdrop.ag',
  'vidoza.net', 'streamlare.com', 'vudeo.net',
  'luluvdo.com', 'turbovid.me',
  'ok.ru/videoembed', 'vk.com/video_ext'
];

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const clean = url.split('?')[0].toLowerCase();
  // debe empezar por http o ser relativo
  if (!url.startsWith('http') && !url.startsWith('//') && !url.startsWith('/')) return false;
  return VIDEO_PATTERNS.some(p => clean.includes(p) || url.toLowerCase().includes(p));
}

function normalizeUrl(url) {
  if (!url) return null;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) {
    try { return window.location.origin + url; } catch (e) { return null; }
  }
  return url;
}

// ── Conjunto local para no reportar duplicados ────────────────────────────────

const reported = new Set();

function report(urls, source = 'dom') {
  const fresh = [];
  for (let url of urls) {
    url = normalizeUrl(url);
    if (!url || !isVideoUrl(url) || reported.has(url)) continue;
    reported.add(url);
    fresh.push(url);
  }
  if (fresh.length > 0) {
    chrome.runtime.sendMessage({ action: 'videosEncontrados', urls: fresh, source });
  }
}

// ── 1. INYECCIÓN EN CONTEXTO DE PÁGINA (intercepta fetch/XHR/src) ─────────────
// Se ejecuta en el contexto real de la página (mismo scope que el JS del sitio)
// y se comunica de vuelta vía postMessage.

function injectPageInterceptor() {
  const script = document.createElement('script');
  script.id = '__video_hunter_interceptor__';
  script.textContent = `(function() {
    if (window.__videoHunterInjected) return;
    window.__videoHunterInjected = true;

    const PATTERNS = [
      '.mp4','.m3u8','.mpd','.mkv','.webm','.m4s',
      'get_video','videoplayback','/stream','delivery',
      'master.m3u8','playlist.m3u8','manifest.mpd','index.m3u8',
      'videodelivery.net','b-cdn.net','jwplatform','jwpsrv','akamaihd.net',
      // Doodstream
      '/pass_md5','doodcdn','doods.pro','dood.la','dood.to','dood.watch','ds2play','dooood',
      // Filemoon / FileLions
      'mooncdn','kerapoxy','filemoon','filelions',
      // Streamwish
      'streamwish','wishfast','sfastwish','dwish.eu','awish.eu',
      // Streamtape
      'streamtape.com/get_video','stape.fun','streamta.pe',
      // Vidguard
      'vidguard','vgfplay','listeamed','bembed','vidhide',
      // Powvideo
      'powvideo','powv.net',
      // StreamHide / Smashystream
      'streamhide','streamvid','smashy.stream','guccihide',
      // VOE
      'voe.sx','voe-network',
      // Otros
      'luluvdo','turbovid','mixdrop','vidoza','vudeo','streamlare',
      'ok.ru/videoembed','vk.com/video_ext'
    ];

    function isVid(url) {
      if (!url || typeof url !== 'string' || url.startsWith('blob:') || url.startsWith('data:')) return false;
      const l = url.toLowerCase();
      return PATTERNS.some(p => l.includes(p));
    }
    function send(url) {
      if (isVid(url)) window.postMessage({ __videoHunter: true, url }, '*');
    }

    // Interceptar fetch (incluye respuestas para Doodstream)
    const _fetch = window.fetch;
    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      send(url);
      return _fetch.apply(this, args).then(r => {
        send(r.url);
        // Doodstream: capturar respuesta de /pass_md5/ para construir URL final
        if (r.url && r.url.includes('/pass_md5/')) {
          r.clone().text().then(text => {
            const base = text.trim();
            if (base && base.startsWith('http')) {
              const token = window._doodToken || getDoodToken();
              const final = base + (token ? token + '?token=' + token + '&expiry=' + (Math.floor(Date.now()/1000) + 7200) : '');
              send(final.replace('?token=', '?').replace('&expiry=', '&expiry='));
              // También enviar la base por si no tenemos token
              send(base + '?type=mp4');
            }
          }).catch(() => {});
        }
        return r;
      });
    };

    // Interceptar XHR (incluye respuestas para Doodstream)
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, url, ...r) {
      this._vhUrl = url;
      send(url);
      return _open.call(this, m, url, ...r);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      if (this._vhUrl && this._vhUrl.includes('/pass_md5/')) {
        this.addEventListener('load', function() {
          const base = this.responseText && this.responseText.trim();
          if (base && base.startsWith('http')) {
            const token = window._doodToken || getDoodToken();
            const expiry = Math.floor(Date.now()/1000) + 7200;
            if (token) {
              window.postMessage({ __videoHunter: true, url: base + token + '?token=' + token + '&expiry=' + expiry }, '*');
            }
            window.postMessage({ __videoHunter: true, url: base + '?type=mp4' }, '*');
          }
        });
      }
      return _send.apply(this, args);
    };

    // Leer token de Doodstream del JS de la página
    function getDoodToken() {
      try {
        // Busca patrones como: var md5 = 'XXXXX' o token:'XXXX'
        const html = document.documentElement.innerHTML;
        const m = html.match(/["']?(?:md5p?|token)["']?\s*(?::|=)\s*["']([a-zA-Z0-9]{10,})["']/i);
        if (m) { window._doodToken = m[1]; return m[1]; }
      } catch(e) {}
      return '';
    }

    // Interceptar asignación de src en elementos <video> y <source>
    ['HTMLVideoElement', 'HTMLSourceElement', 'HTMLAudioElement'].forEach(name => {
      const proto = window[name] && window[name].prototype;
      if (!proto) return;
      const desc = Object.getOwnPropertyDescriptor(proto, 'src');
      if (desc && desc.set) {
        Object.defineProperty(proto, 'src', {
          set(v) { send(v); desc.set.call(this, v); },
          get() { return desc.get.call(this); },
          configurable: true
        });
      }
    });

    // Detectar JW Player (incluye Filemoon / Streamwish que lo usan)
    function checkJwPlayer() {
      try {
        if (window.jwplayer && typeof window.jwplayer === 'function') {
          // Método 1: instancias registradas
          const instances = window.jwplayer.instances || [];
          instances.forEach(p => {
            try {
              (p.getPlaylist() || []).forEach(item => {
                (item.sources || []).forEach(s => send(s.file || s.src));
                if (item.file) send(item.file);
              });
              // También currentSrc si ya está reproduciendo
              const src = typeof p.getSrc === 'function' ? p.getSrc() : null;
              if (src) send(typeof src === 'string' ? src : (src.file || src));
            } catch(e) {}
          });
          // Método 2: jwplayer('player').getPlaylistItem() en el contexto global
          try {
            const pl = window.jwplayer().getPlaylist && window.jwplayer().getPlaylist();
            if (pl) pl.forEach(item => {
              (item.sources || []).forEach(s => send(s.file || s.src));
              if (item.file) send(item.file);
            });
          } catch(e) {}
        }
      } catch(e) {}
    }

    // Detectar Video.js
    function checkVideoJs() {
      try {
        if (window.videojs && window.videojs.players) {
          Object.values(window.videojs.players).forEach(p => {
            if (!p) return;
            try {
              const src = p.currentSrc();
              if (src) send(src);
              const sources = p.currentSources ? p.currentSources() : [];
              sources.forEach(s => send(s.src));
            } catch(e) {}
          });
        }
      } catch(e) {}
    }

    // Detectar Flowplayer
    function checkFlowplayer() {
      try {
        if (window.flowplayer) {
          document.querySelectorAll('.flowplayer').forEach(el => {
            const fp = window.flowplayer(el);
            if (fp && fp.video) send(fp.video.src || fp.video.url);
          });
        }
      } catch(e) {}
    }

    // Detectar variables globales con URLs de video
    // Netu/HQQ, Powvideo, Vidguard y otros las exponen como window.file / window.sources
    function checkGlobalVars() {
      const candidates = [
        'file','videoUrl','videoSrc','streamUrl','playerSrc','sources','playlist',
        'hls','hlsUrl','m3u8','stream','source','videoFile','mp4','hlsSource',
        'o','flashvars','playerConfig','config','opts','player_data',
        'vhls','video_url','vid_url','media','mediaUrl','videoLink'
      ];
      candidates.forEach(v => {
        try {
          const val = window[v];
          if (!val) return;
          if (typeof val === 'string') { send(val); return; }
          if (Array.isArray(val)) {
            val.forEach(i => {
              if (typeof i === 'string') send(i);
              else if (i && typeof i === 'object') send(i.file || i.src || i.url || i.source);
            });
            return;
          }
          if (typeof val === 'object') {
            ['file','src','url','source','hls','mp4','stream','link'].forEach(k => {
              if (val[k] && typeof val[k] === 'string') send(val[k]);
            });
            if (Array.isArray(val.sources)) val.sources.forEach(s => send(s.file || s.src));
            if (Array.isArray(val.playlist)) val.playlist.forEach(p => send(p.file || p.src));
          }
        } catch(e) {}
      });
    }

    // Detectar Plyr / elementos <video> activos
    function checkPlyr() {
      try {
        document.querySelectorAll('video').forEach(el => {
          if (el.src) send(el.src);
          if (el.currentSrc) send(el.currentSrc);
          el.querySelectorAll('source').forEach(s => send(s.src));
        });
      } catch(e) {}
    }

    // Detectar Streamtape: construye la URL a partir de var soblink / robotlink
    function checkStreamtape() {
      try {
        const html = document.documentElement.innerHTML;
        // Patrón moderno: var soblink = '/get_video?...'
        const m1 = html.match(/var\s+soblink\s*=\s*["'](\/get_video[^"']+)["']/);
        if (m1) {
          ['https://streamtape.com','https://streamtape.net','https://stape.fun'].forEach(h => send(h + m1[1]));
        }
        // Patrón antiguo: robotlink + substring(4)
        const m2 = html.match(/var\s+robotlink\s*=\s*["']([^"']+)["']/);
        if (m2) {
          const v = m2[1];
          if (v.startsWith('http')) send(v);
          else if (v.startsWith('/')) {
            ['https://streamtape.com','https://streamtape.net'].forEach(h => send(h + v));
          }
          if (v.length > 4 && v.substring(4).startsWith('/get_video')) {
            send('https://streamtape.com' + v.substring(4));
          }
        }
        // Patrón de string directa con /get_video
        const m3 = html.match(/["'](https?:\/\/[^"']+\/get_video[^"']+)["']/);
        if (m3) send(m3[1]);
      } catch(e) {}
    }

    // Detectar Vidguard / Vgfplay / Vidhide: atob() + sustitución de caracteres
    function checkVidguard() {
      try {
        document.querySelectorAll('script:not([src])').forEach(s => {
          const text = s.textContent;
          const atobRe = /atob\(["']([A-Za-z0-9+/=]{20,})["']\)/g;
          let m;
          while ((m = atobRe.exec(text)) !== null) {
            try {
              let decoded = atob(m[1]);
              // Buscar URL directamente en el resultado
              const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)[^\s"'<>]*/i);
              if (urlMatch) send(urlMatch[0]);
              else if (decoded.startsWith('http')) send(decoded.trim());
            } catch(e) {}
          }
        });
      } catch(e) {}
    }

    // Detectar Powvideo / _0x obfuscation: decodificar strings base64 del array _0x
    function checkPowvideo() {
      try {
        document.querySelectorAll('script:not([src])').forEach(s => {
          const text = s.textContent;
          if (!text.includes('_0x')) return;
          const b64re = /["']([A-Za-z0-9+/]{20,}={0,2})["']/g;
          let m;
          while ((m = b64re.exec(text)) !== null) {
            try {
              const decoded = atob(m[1]);
              if (decoded.startsWith('http') && (
                decoded.includes('.m3u8') || decoded.includes('.mp4') ||
                decoded.includes('/stream') || decoded.includes('/video') ||
                decoded.includes('powvideo')
              )) send(decoded.trim());
            } catch(e) {}
          }
        });
      } catch(e) {}
    }

    function runAll() {
      checkJwPlayer(); checkVideoJs(); checkFlowplayer();
      checkGlobalVars(); checkPlyr();
      checkStreamtape(); checkVidguard(); checkPowvideo();
    }

    setTimeout(() => runAll(), 800);
    setTimeout(() => { runAll(); getDoodToken(); }, 2500);
    setTimeout(() => runAll(), 5000);
    // Intento tardío para reproductores lentos
    setTimeout(() => runAll(), 9000);
  })();`;

  (document.documentElement || document.head || document).prepend(script);
  script.remove();
}

injectPageInterceptor();

// Escuchar mensajes del script inyectado
window.addEventListener('message', (event) => {
  if (event.data && event.data.__videoHunter && event.data.url) {
    report([event.data.url], 'xhr/fetch');
  }
});

// ── 2. ESCANEO DOM ────────────────────────────────────────────────────────────

function scanDOM() {
  const urls = [];

  // Etiquetas multimedia estándar
  document.querySelectorAll('video, audio, source, track').forEach(el => {
    ['src', 'currentSrc', 'data-src', 'data-video-src', 'data-url'].forEach(attr => {
      const v = el[attr] || el.getAttribute(attr);
      if (v) urls.push(v);
    });
  });

  // Iframes y embeds
  document.querySelectorAll('iframe, embed, object').forEach(el => {
    const v = el.src || el.data || el.getAttribute('src');
    if (v) urls.push(v);
  });

  // Anchors y elementos genéricos con atributos de video
  document.querySelectorAll('[src],[data-src],[data-video],[data-file],[data-stream]').forEach(el => {
    ['src', 'data-src', 'data-video', 'data-file', 'data-stream'].forEach(attr => {
      const v = el.getAttribute(attr);
      if (v) urls.push(v);
    });
  });

  report(urls, 'dom');
}

// ── 3. BÚSQUEDA EN SCRIPTS Y JSON (con desofuscación) ────────────────────────

/**
 * Desempaqueta scripts codificados con el packer de Dean Edwards:
 * eval(function(p,a,c,k,e,d|r){ ... }('ENCODED',BASE,COUNT,'w|o|r|d|s'.split('|'),0,{}))
 * Usado por Filemoon, Streamwish, y muchos otros.
 */
function unpackPacker(source) {
  try {
    // Extraer los argumentos del packer
    const match = source.match(/eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]+?\}\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/m);
    if (!match) return null;
    let [, p, a, c, k] = match;
    // Desescapar comillas simples escapadas dentro del encoded string
    p = p.replace(/\\'/g, "'");
    a = parseInt(a); c = parseInt(c);
    const dict = k.split('|');
    function toBase(n) {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return (n < a ? '' : toBase(Math.floor(n / a))) + chars[n % a];
    }
    let i = c;
    while (i--) {
      if (dict[i]) p = p.replace(new RegExp('\\b' + toBase(i) + '\\b', 'g'), dict[i]);
    }
    return p;
  } catch (e) { return null; }
}

/**
 * Decodifica secuencias \xNN (hex) en una cadena JS.
 * Usado por Netu/HQQ y scripts ofuscados con _0x variables.
 */
function decodeHexEscapes(text) {
  try { return text.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); }
  catch (e) { return text; }
}

/**
 * Decodifica Unicode escapes \uXXXX.
 */
function decodeUnicodeEscapes(text) {
  try { return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, u) => String.fromCharCode(parseInt(u, 16))); }
  catch (e) { return text; }
}

/**
 * Extrae y decodifica strings base64 que parezcan URLs de video.
 * Netu/HQQ a veces almacenan la URL en base64.
 */
function decodeBase64Urls(text) {
  const urls = [];
  const b64re = /["'][A-Za-z0-9+/]{24,}={0,2}["']/g;
  let m;
  while ((m = b64re.exec(text)) !== null) {
    try {
      const decoded = atob(m[0].slice(1, -1));
      if (decoded.startsWith('http') && isVideoUrl(decoded)) urls.push(decoded);
    } catch (e) {}
  }
  return urls;
}

/**
 * Extrae URLs de código de configuración de JW Player:
 * jwplayer("id").setup({ sources: [{ file: "URL" }] })
 */
function extractJwPlayerSetup(text) {
  const urls = [];
  const fileRe = /["']?file["']?\s*:\s*["']([^"']{10,})["']/gi;
  const srcRe  = /["']?src["']?\s*:\s*["']([^"']{10,})["']/gi;
  let m;
  while ((m = fileRe.exec(text)) !== null) {
    const u = m[1].replace(/\\\//g, '/');
    if (isVideoUrl(u)) urls.push(u);
  }
  while ((m = srcRe.exec(text)) !== null) {
    const u = m[1].replace(/\\\//g, '/');
    if (isVideoUrl(u)) urls.push(u);
  }
  return urls;
}

/**
 * Extractor específico para Doodstream.
 * Detecta el endpoint /pass_md5/ y el token para reconstruir la URL final.
 */
function extractDoodstream(text) {
  const urls = [];
  // Detectar rutas /pass_md5/HASH
  const passMd5Matches = text.match(/\/pass_md5\/[a-zA-Z0-9_-]+/g);
  if (passMd5Matches) {
    passMd5Matches.forEach(path => {
      urls.push(normalizeUrl(path));
    });
  }
  // Capturar token del JS de la página
  const tokenMatch = text.match(/var\s+(?:md5p?|token|_token|t)\s*=\s*["']([a-zA-Z0-9]{8,})["']/i);
  if (tokenMatch) window._doodToken = tokenMatch[1];

  return urls.filter(Boolean);
}

/**
 * Extrae y decodifica todas las llamadas atob('...') en el texto fuente.
 * Útil para Vidguard, Powvideo y cualquier servidor que codifique URLs en base64.
 */
function extractAtobCalls(text) {
  const urls = [];
  const atobRe = /atob\(["']([A-Za-z0-9+/]{16,}={0,2})["']\)/g;
  let m;
  while ((m = atobRe.exec(text)) !== null) {
    try {
      const decoded = atob(m[1]);
      if (decoded.startsWith('http') && isVideoUrl(decoded)) {
        urls.push(decoded.trim());
        continue;
      }
      // Resultado: código JS que contiene URLs
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd|mkv|webm)[^\s"'<>]*/gi);
      if (urlMatch) urls.push(...urlMatch);
      // Intentar desempaquetar si el resultado contiene otro packer
      if (decoded.includes('eval(function(p,a,c,k,e,')) {
        const sub = unpackPacker(decoded);
        if (sub) {
          const subMatch = sub.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd|mkv|webm)[^\s"'<>]*/gi);
          if (subMatch) urls.push(...subMatch);
        }
      }
    } catch(e) {}
  }
  return urls;
}

/**
 * Extrae strings del array _0x típico de obfuscator.io (Powvideo, etc.).
 * No ejecuta el código, pero decodifica los strings base64 del array.
 */
function extract0xStrings(text) {
  const urls = [];
  if (!text.includes('_0x')) return urls;
  // Extraer el array de strings: var _0xXXXX = ['s1','s2',...]
  const arrayRe = /var\s+_0x[0-9a-f]+\s*=\s*\[([^\]]{50,})\]/gi;
  let m;
  while ((m = arrayRe.exec(text)) !== null) {
    const strRe = /["']([A-Za-z0-9+/]{16,}={0,2})["']/g;
    let s;
    while ((s = strRe.exec(m[1])) !== null) {
      try {
        const decoded = atob(s[1]);
        if (decoded.startsWith('http') && isVideoUrl(decoded)) urls.push(decoded);
      } catch(e) {}
    }
  }
  // También buscar strings individuales b64 en el texto completo
  const b64re = /["']([A-Za-z0-9+/]{24,}={0,2})["']/g;
  while ((m = b64re.exec(text)) !== null) {
    try {
      const decoded = atob(m[1]);
      if (decoded.startsWith('http') && isVideoUrl(decoded)) urls.push(decoded);
    } catch(e) {}
  }
  return urls;
}

/**
 * Extractor específico para Streamtape.
 * Construye la URL a partir de var soblink / robotlink presentes en el HTML/JS.
 */
function extractStreamtape(text) {
  const urls = [];
  const TAPE_HOSTS = ['https://streamtape.com','https://streamtape.net','https://stape.fun','https://streamta.pe'];
  // Patrón moderno: var soblink = '/get_video?...'
  const m1 = text.match(/var\s+soblink\s*=\s*["'](\/get_video[^"']+)["']/);
  if (m1) TAPE_HOSTS.forEach(h => urls.push(h + m1[1]));

  // Patrón antiguo: robotlink + (opcionalmente) substring(4)
  const m2 = text.match(/var\s+robotlink\s*=\s*["']([^"']+)["']/);
  if (m2) {
    const v = m2[1];
    if (v.startsWith('http')) urls.push(v);
    else if (v.startsWith('/')) TAPE_HOSTS.forEach(h => urls.push(h + v));
    if (v.length > 4 && v.substring(4).startsWith('/get_video')) {
      TAPE_HOSTS.forEach(h => urls.push(h + v.substring(4)));
    }
  }
  // String literal directa con /get_video en el script
  const m3 = text.match(/["'](https?:\/\/[^"']+\/get_video[^"']{5,})["']/);
  if (m3) urls.push(m3[1]);

  return urls;
}

/**
 * Extractor para Vidguard / Vgfplay / Vidhide.
 * Decodifica atob() y busca URLs de sus CDNs conocidos.
 */
function extractVidguard(text) {
  const urls = [];
  // atob directo con URL resultante
  extractAtobCalls(text).forEach(u => { if (isVideoUrl(u)) urls.push(u); });
  // Dominios propios de Vidguard en el texto plano
  const domains = ['vidguard.to','vgfplay.com','listeamed.net','bembed.net','vidhide.com'];
  const reVG = new RegExp('(https?:\\/\\/(?:' + domains.map(d => d.replace('.','\\.')).join('|') + ')[^"\'\\s<>]*\\.(?:m3u8|mp4|mpd)(?:[^"\'\\s<>]*)?)', 'gi');
  let m;
  while ((m = reVG.exec(text)) !== null) urls.push(m[1]);
  return urls;
}

function scanScripts() {
  const urls = [];

  const reExt     = /https?:\/\/[^"'\s<>]+\.(?:mp4|m3u8|mpd|mkv|webm|m4s)(?:[^"'\s<>]*)?/gi;
  const reEscaped = /https?:\\\/\\\/[^"'\s<>]+\.(?:mp4|m3u8|mpd|mkv|webm|m4s)(?:[^"'\s<>]*)?/gi;
  const reKeyword = /https?:\/\/[^"'\s<>]*(?:get_video|videoplayback|videodelivery\.net|jwplatform\.com|akamaihd\.net|doods?\.pro|dood\.[a-z]{2,4}\/|doodcdn|dooood|mooncdn|kerapoxy|filemoon|filelions|wishfast|streamwish|sfastwish|dwish\.eu|awish\.eu|stape\.fun|streamtape|streamta\.pe|netu\.ac|hqq\.tv|hqq\.to|waaw\.tv|vidguard|vgfplay|vidhide|listeamed|powvideo|powv\.net|streamhide|streamvid|smashy\.stream|guccihide|voe\.sx|voe-network|upstream\.to|luluvdo|turbovid|mixdrop|vidoza|vudeo|ok\.ru\/videoembed|vk\.com\/video_ext)[^"'\s<>]*/gi;

  function extractFromText(text) {
    let m;
    while ((m = reExt.exec(text)) !== null) urls.push(m[0].replace(/\\\//g, '/'));
    reExt.lastIndex = 0;
    while ((m = reEscaped.exec(text)) !== null) urls.push(m[0].replace(/\\\//g, '/'));
    reEscaped.lastIndex = 0;
    while ((m = reKeyword.exec(text)) !== null) urls.push(m[0].replace(/\\\//g, '/'));
    reKeyword.lastIndex = 0;
    extractJwPlayerSetup(text).forEach(u => urls.push(u));
    decodeBase64Urls(text).forEach(u => urls.push(u));
  }

  document.querySelectorAll('script:not([src])').forEach(s => {
    const rawText = s.textContent;
    if (!rawText || rawText.length < 10) return;

    // 1. Texto original
    extractFromText(rawText);

    // 2. Decodificar \xNN hex — Netu/HQQ y ofuscaciones _0x
    if (rawText.includes('\\x')) {
      const hexDecoded = decodeHexEscapes(rawText);
      extractFromText(hexDecoded);
    }

    // 3. Decodificar \uXXXX — ofuscaciones unicode
    if (rawText.includes('\\u')) {
      const uniDecoded = decodeUnicodeEscapes(rawText);
      extractFromText(uniDecoded);
    }

    // 4. Desempaquetar P,A,C,K,E,R — Filemoon / Streamwish / Netu
    if (rawText.includes('eval(function(p,a,c,k,e,')) {
      const unpacked = unpackPacker(rawText);
      if (unpacked) {
        extractFromText(unpacked);
        if (unpacked.includes('\\x')) extractFromText(decodeHexEscapes(unpacked));
        if (unpacked.includes('\\u')) extractFromText(decodeUnicodeEscapes(unpacked));
        // Aplicar también extractores especializados al texto desempaquetado
        extractAtobCalls(unpacked).forEach(u => urls.push(u));
        extractStreamtape(unpacked).forEach(u => urls.push(u));
        extractVidguard(unpacked).forEach(u => urls.push(u));
      }
    }

    // 5. Extractor específico Doodstream (/pass_md5)
    if (rawText.includes('/pass_md5/') || window.location.hostname.includes('dood')) {
      extractDoodstream(rawText).forEach(u => urls.push(u));
    }

    // 6. Extractor atob() — Vidguard, Powvideo, y cualquier base64 inline
    if (rawText.includes('atob(')) {
      extractAtobCalls(rawText).forEach(u => urls.push(u));
      extractVidguard(rawText).forEach(u => urls.push(u));
    }

    // 7. Extractor _0x — Powvideo y obfuscator.io
    if (rawText.includes('_0x')) {
      extract0xStrings(rawText).forEach(u => urls.push(u));
    }

    // 8. Extractor Streamtape — var soblink / var robotlink
    const host = window.location.hostname;
    if (host.includes('streamtape') || host.includes('stape') ||
        rawText.includes('soblink') || rawText.includes('robotlink')) {
      extractStreamtape(rawText).forEach(u => urls.push(u));
    }
  });

  // JSON-LD
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { extractFromText(JSON.stringify(JSON.parse(s.textContent))); }
    catch (e) {}
  });

  // Meta tags OG / Twitter
  document.querySelectorAll([
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]'
  ].join(',')).forEach(el => {
    const v = el.getAttribute('content');
    if (v) urls.push(v);
  });

  report(urls, 'script');
}

// ── 4. ESCANEO COMPLETO ───────────────────────────────────────────────────────

function fullScan() {
  scanDOM();
  scanScripts();
}

// ── DISPARADORES ──────────────────────────────────────────────────────────────

// Escaneo inmediato (captura lo que ya está en el DOM al cargarse)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fullScan);
} else {
  fullScan();
}

// Cuando la página termina de cargar (incluye recursos tardíos)
window.addEventListener('load', fullScan);

// Click del usuario (reactiva players que inicializan al hacer clic)
document.addEventListener('click', () => setTimeout(fullScan, 1200), { passive: true });

// Encuesta periódica (para páginas que cargan contenido dinámicamente)
setInterval(fullScan, 5000);

// MutationObserver: detecta nuevos elementos inyectados en el DOM
let mutationTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(fullScan, 500);
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });
}