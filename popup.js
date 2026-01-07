document.getElementById('btnScan').addEventListener('click', async () => {
    const listaDiv = document.getElementById('lista');
    const loader = document.getElementById('loader');
    const badge = document.getElementById('badge');
    const btnScan = document.getElementById('btnScan');

    // UI: Estado de carga
    listaDiv.innerHTML = '';
    loader.style.display = 'block';
    btnScan.disabled = true;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Inyectamos el escáner en todos los frames (incluyendo iframes de reproductores)
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => {
                const found = [];
                // 1. Buscar en etiquetas de video/enlaces
                document.querySelectorAll('video, source, a, iframe').forEach(el => {
                    const url = el.src || el.href || el.getAttribute('data-src');
                    if (url && (url.includes('.mp4') || url.includes('.m3u8') || url.includes('get_video') || url.includes('.mkv'))) {
                        found.push(url);
                    }
                });
                // 2. Buscar en el código de los scripts (para URLs ocultas)
                document.querySelectorAll('script').forEach(s => {
                    const regex = /(https?:\/\/[^"']+\.(mp4|m3u8|mkv)[^"']*)/gi;
                    let match;
                    while ((match = regex.exec(s.textContent)) !== null) {
                        found.push(match[1]);
                    }
                });
                return found;
            }
        });

        // Limpiar duplicados de todos los frames
        const allUrls = [...new Set(results.flatMap(r => r.result))];
        
        loader.style.display = 'none';
        btnScan.disabled = false;
        badge.innerText = allUrls.length;

        if (allUrls.length > 0) {
            allUrls.forEach(url => {
                const card = document.createElement('div');
                card.className = 'video-card';
                card.innerHTML = `
                    <div class="url-info">${url}</div>
                    <div class="actions">
                        <button class="btn-action btn-copy" data-url="${url}">📋 Copiar</button>
                        <button class="btn-action btn-jd" data-url="${url}">🚀 JD2</button>
                        <button class="btn-action btn-download" data-url="${url}">🌐 Abrir</button>
                    </div>
                `;
                listaDiv.appendChild(card);
            });

            // Acción: Copiar al portapapeles
            document.querySelectorAll('.btn-copy').forEach(btn => {
                btn.onclick = (e) => {
                    const link = e.target.dataset.url;
                    navigator.clipboard.writeText(link);
                    const oldText = e.target.innerText;
                    e.target.innerText = "¡Listo!";
                    setTimeout(() => e.target.innerText = oldText, 1000);
                };
            });

            // Acción: Enviar a JDownloader 2
            document.querySelectorAll('.btn-jd').forEach(btn => {
                btn.onclick = async (e) => {
                    const link = e.target.dataset.url;
                    e.target.innerText = "Enviando...";
                    
                    try {
                        // Puerto estándar de JDownloader 9666
                        await fetch("http://127.0.0.1:9666/flashgot", {
                            method: 'POST',
                            body: new URLSearchParams({ 'urls': link }),
                            mode: 'no-cors'
                        });
                        e.target.innerText = "¡En JD2!";
                        e.target.style.background = "#22c55e";
                    } catch (err) {
                        alert("Error: Abre JDownloader 2 en tu PC.");
                        e.target.innerText = "Error";
                    }
                    setTimeout(() => {
                        e.target.innerText = "🚀 JD2";
                        e.target.style.background = "#f97316";
                    }, 2000);
                };
            });

            // Acción: Abrir en pestaña nueva
            document.querySelectorAll('.btn-download').forEach(btn => {
                btn.onclick = (e) => window.open(e.target.dataset.url, '_blank');
            });

        } else {
            listaDiv.innerHTML = '<div class="empty-msg">No se encontraron videos.<br>Prueba a darle al PLAY en el video primero.</div>';
        }
    } catch (err) {
        loader.style.display = 'none';
        btnScan.disabled = false;
        console.error("Error de inyección:", err);
    }
});