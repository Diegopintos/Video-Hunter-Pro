let videoStore = {};

// 1. Escuchar mensajes del Content Script (DOM)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "videosEncontrados" && sender.tab) {
    saveVideo(sender.tab.id, request.urls);
  }
  if (request.action === "getVideos") {
    sendResponse({ videos: Array.from(videoStore[request.tabId] || []) });
  }
  return true;
});

// 2. INTERCEPTOR DE RED (Captura lo que el navegador descarga)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    // Filtro avanzado: mp4, m3u8, master, playlist, get_video, etc.
    if (/(.mp4|.m3u8|.m4s|.mkv|master|playlist|get_video|stream|delivery)/i.test(url)) {
      if (details.tabId >= 0) {
        saveVideo(details.tabId, [url]);
      }
    }
  },
  { urls: ["<all_urls>"] }
);

function saveVideo(tabId, urls) {
  if (!videoStore[tabId]) videoStore[tabId] = new Set();
  
  urls.forEach(url => {
    // Evitamos capturar archivos muy pequeños que suelen ser fragmentos (.ts)
    if (!url.includes('.ts') || url.includes('master')) {
        videoStore[tabId].add(url);
    }
  });

  chrome.action.setBadgeText({ text: videoStore[tabId].size.toString(), tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: "#2ecc71", tabId: tabId });
}