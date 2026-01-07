/**
 * CONTENT.JS - El detector inyectado
 * Este script corre dentro de la web principal y de cada iframe.
 */

// Función principal de escaneo
function extractMedia() {
    const detectedUrls = new Set();

    // 1. Buscar en etiquetas HTML estándar
    const tags = document.querySelectorAll('video, source, iframe, a, embed, object');
    tags.forEach(el => {
        const src = el.src || el.href || el.getAttribute('data-src') || el.getAttribute('data-video-src');
        if (isValidVideoUrl(src)) {
            detectedUrls.add(src);
        }
    });

    // 2. BUSQUEDA PROFUNDA: Analizar el código interno de los <script>
    // Muchos sitios ocultan la URL en variables de JS ofuscadas
    const scripts = document.querySelectorAll('script');
    scripts.forEach(s => {
        const content = s.textContent;
        if (content) {
            // Buscamos patrones de URLs que terminen en .mp4, .m3u8, .mkv, etc.
            const regex = /(https?:\/\/[^"']+\.(mp4|m3u8|mkv|webm|m4s)[^"']*)/gi;
            let match;
            while ((match = regex.exec(content)) !== null) {
                detectedUrls.add(match[1]);
            }
        }
    });

    // 3. Enviar resultados si encontramos algo nuevo
    if (detectedUrls.size > 0) {
        chrome.runtime.sendMessage({
            action: "videosEncontrados",
            urls: Array.from(detectedUrls)
        });
    }
}

// Filtro para saber si una URL "parece" un video
function isValidVideoUrl(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    
    const videoPatterns = [
        '.mp4', '.m3u8', '.mkv', '.webm', '.m4s', 
        'get_video', 'stream', 'delivery', 'master', 'playlist'
    ];
    
    return videoPatterns.some(pattern => url.toLowerCase().includes(pattern));
}

// --- DISPARADORES DE ESCANEO ---

// A. Escaneo por intervalos (por si la web carga cosas nuevas)
setInterval(extractMedia, 3000);

// B. Escaneo al hacer click (ideal para cuando saltan popups o el player se activa)
document.addEventListener('click', () => {
    // Esperamos un poco a que el reproductor reaccione al click
    setTimeout(extractMedia, 1000);
});

// C. Escaneo cuando el DOM cambia (nuevos elementos inyectados)
const observer = new MutationObserver((mutations) => {
    extractMedia();
});
observer.observe(document.body, { childList: true, subtree: true });

// Ejecución inmediata al cargar
extractMedia();

console.log("Detector Ultra inyectado correctamente en: " + window.location.href);