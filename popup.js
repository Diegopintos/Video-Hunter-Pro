/**
 * POPUP.JS
 * 1. Consulta al background los videos ya capturados por red (webRequest).
 * 2. Lanza un escaneo inline en todos los frames.
 * 3. Fusiona y deduplica ambas fuentes.
 */

document.getElementById('btnScan').addEventListener('click', scan);

async function scan() {
  const listaDiv = document.getElementById('lista');
  const loader   = document.getElementById('loader');
  const badge    = document.getElementById('badge');
  const btnScan  = document.getElementById('btnScan');

  listaDiv.innerHTML = '';
  loader.style.display = 'block';
  btnScan.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // ── Fuente 1: videos ya capturados por webRequest en background ───────────
    let storedVideos = [];
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getVideos', tabId: tab.id });
      storedVideos = res.videos || [];
    } catch (e) { /* background puede no estar listo aún */ }

    // ── Fuente 2: escaneo inline en todos los frames ──────────────────────────
    let frameResults = [];
    try {
      frameResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const found = [];

          // Elementos multimedia
          document.querySelectorAll('video, audio, source, track').forEach(el => {
            ['src', 'currentSrc'].forEach(prop => {
              if (el[prop]) found.push({ url: el[prop], source: 'dom' });
            });
            ['data-src', 'data-video-src', 'data-url', 'data-file'].forEach(attr => {
              const v = el.getAttribute(attr);
              if (v && v.startsWith('http')) found.push({ url: v, source: 'dom' });
            });
          });

          // Iframes y embeds
          document.querySelectorAll('iframe[src], embed[src], object[data]').forEach(el => {
            const v = el.src || el.data;
            if (v) found.push({ url: v, source: 'dom' });
          });

          // Scripts: regex ampliada que soporta barras escapadas
          const PATTERNS = /https?:(?:\\\/\\\/|\/\/)[^"'\s<>]+\.(?:mp4|m3u8|mpd|mkv|webm|m4s)(?:[^"'\s<>]*)?/gi;
          const KW_PATTERNS = /https?:(?:\\\/\\\/|\/\/)[^"'\s<>]*(?:get_video|videoplayback|videodelivery\.net|jwplatform\.com|akamaihd\.net|b-cdn\.net|master\.m3u8|index\.m3u8)[^"'\s<>]*/gi;

          document.querySelectorAll('script:not([src])').forEach(s => {
            const text = s.textContent;
            let m;
            while ((m = PATTERNS.exec(text))  !== null) found.push({ url: m[0].replace(/\\\//g, '/'), source: 'script' });
            PATTERNS.lastIndex = 0;
            while ((m = KW_PATTERNS.exec(text)) !== null) found.push({ url: m[0].replace(/\\\//g, '/'), source: 'script' });
            KW_PATTERNS.lastIndex = 0;
          });

          // JSON-LD
          document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            try {
              const text = JSON.stringify(JSON.parse(s.textContent));
              let m;
              while ((m = PATTERNS.exec(text)) !== null) found.push({ url: m[0].replace(/\\\//g, '/'), source: 'json-ld' });
              PATTERNS.lastIndex = 0;
            } catch (e) {}
          });

          // Meta OG
          document.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]').forEach(el => {
            const v = el.getAttribute('content');
            if (v) found.push({ url: v, source: 'meta' });
          });

          return found;
        }
      });
    } catch (e) {
      console.error('Error en escaneo inline:', e);
    }

    const inlineVideos = frameResults.flatMap(r => r.result || []);

    // ── Fusionar y deduplicar ─────────────────────────────────────────────────
    const seen  = new Set();
    const allVideos = [];

    // Prioridad: primero los de red (más fiables), luego los del DOM
    for (const v of [...storedVideos, ...inlineVideos]) {
      const url = (v.url || v).split('#')[0].trim();
      if (!url || seen.has(url)) continue;
      // Filtrar fragmentos HLS pequeños
      const lurl = url.toLowerCase();
      if (lurl.endsWith('.ts') && !lurl.includes('master') && !lurl.includes('idx')) continue;
      seen.add(url);
      allVideos.push({ url, source: v.source || 'dom' });
    }

    loader.style.display = 'none';
    btnScan.disabled = false;
    badge.innerText = allVideos.length;

    if (allVideos.length === 0) {
      listaDiv.innerHTML = '<div class="empty-msg">No se encontraron videos.<br>Pulsa PLAY en el reproductor y vuelve a analizar.</div>';
      return;
    }

    allVideos.forEach(({ url, source }) => {
      const filename = url.split('/').pop().split('?')[0] || 'video';
      const sourceLabel = { network: '🌐 Red', dom: '🏷️ DOM', script: '📜 Script', 'xhr/fetch': '⚡ XHR', 'json-ld': '📋 JSON', meta: '🔖 Meta' }[source] || source;
      const card = document.createElement('div');
      card.className = 'video-card';

      // Sanitizar la URL para el atributo data- (evitar XSS)
      const safeUrl = url.replace(/"/g, '%22').replace(/'/g, '%27');

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;font-weight:600;color:#1e293b;word-break:break-all;max-width:260px">${escapeHtml(filename)}</span>
          <span style="font-size:9px;background:#e2e8f0;padding:2px 6px;border-radius:8px;color:#64748b;white-space:nowrap;margin-left:6px">${escapeHtml(sourceLabel)}</span>
        </div>
        <div class="url-info">${escapeHtml(url)}</div>
        <div class="actions">
          <button class="btn-action btn-copy"     data-url="${safeUrl}">📋 Copiar</button>
          <button class="btn-action btn-jd"       data-url="${safeUrl}">🚀 JD2</button>
          <button class="btn-action btn-download" data-url="${safeUrl}">🌐 Abrir</button>
        </div>
      `;
      listaDiv.appendChild(card);
    });

    // ── Acciones ──────────────────────────────────────────────────────────────

    listaDiv.querySelectorAll('.btn-copy').forEach(btn => {
      btn.onclick = (e) => {
        navigator.clipboard.writeText(e.currentTarget.dataset.url);
        const orig = e.currentTarget.innerText;
        e.currentTarget.innerText = '¡Copiado!';
        setTimeout(() => { e.currentTarget.innerText = orig; }, 1200);
      };
    });

    listaDiv.querySelectorAll('.btn-jd').forEach(btn => {
      btn.onclick = async (e) => {
        const link = e.currentTarget.dataset.url;
        const b = e.currentTarget;
        b.innerText = 'Enviando…';
        try {
          await fetch('http://127.0.0.1:9666/flashgot', {
            method: 'POST',
            body: new URLSearchParams({ urls: link }),
            mode: 'no-cors'
          });
          b.innerText = '¡En JD2!';
          b.style.background = '#22c55e';
        } catch {
          alert('Error: Abre JDownloader 2 primero.');
          b.innerText = 'Error';
        }
        setTimeout(() => { b.innerText = '🚀 JD2'; b.style.background = ''; }, 2500);
      };
    });

    listaDiv.querySelectorAll('.btn-download').forEach(btn => {
      btn.onclick = (e) => window.open(e.currentTarget.dataset.url, '_blank');
    });

  } catch (err) {
    loader.style.display = 'none';
    btnScan.disabled = false;
    console.error('Error en el popup:', err);
    listaDiv.innerHTML = `<div class="empty-msg">Error al escanear:<br>${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inicialización del popup ──────────────────────────────────────────────────
(async () => {
  // 1. Mostrar videos ya capturados por la red
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.runtime.sendMessage({ action: 'getVideos', tabId: tab.id });
    const count = (res.videos || []).length;
    if (count > 0) {
      document.getElementById('badge').innerText = count;
      document.getElementById('lista').innerHTML = `<div class="empty-msg">🎯 ${count} video(s) capturados por la red.<br>Pulsa "Analizar" para verlos todos.</div>`;
    }
  } catch (e) {}

  // 2. Comprobar si hay actualización pendiente y mostrar el banner
  showUpdateBanner();
})();

// ── Lógica del banner de actualización ───────────────────────────────────────

async function showUpdateBanner() {
  try {
    const data = await chrome.storage.local.get('updateAvailable');
    const info = data.updateAvailable;
    if (!info || !info.version) return;

    const banner  = document.getElementById('updateBanner');
    const verSpan = document.getElementById('updateVersion');
    const notesEl = document.getElementById('updateNotes');

    verSpan.textContent = 'v' + info.version;
    if (info.notes) notesEl.textContent = info.notes;

    banner.classList.add('visible');

    // Botón "Actualizar" → abre la página de releases
    document.getElementById('btnUpdate').onclick = () => {
      const url = info.releaseUrl || info.downloadUrl;
      if (url) chrome.tabs.create({ url });
    };

    // Botón "✕" → cierra el banner y descarta este aviso hasta la próxima comprobación
    document.getElementById('btnDismiss').onclick = async () => {
      banner.classList.remove('visible');
      await chrome.storage.local.remove('updateAvailable');
    };
  } catch (e) {}
}