/* 貼紙工廠 · service worker
 *
 * 目標：裝到主畫面之後可以完全離線使用。
 *
 * 分三種快取策略：
 *   1. app shell（HTML / manifest / 圖示）→ cache first，並在背景更新
 *   2. CDN 上的函式庫（transformers.js、JSZip）→ cache first，抓到就永久留著
 *   3. 模型權重（Hugging Face）→ 不碰，交給 transformers.js 自己的 Cache API 管理
 *      （它有自己的一套快取鍵，重複快取只會浪費配額，手機上配額很珍貴）
 */

const VERSION = 'v5';
const SHELL_CACHE = `sticker-shell-${VERSION}`;
const LIB_CACHE   = `sticker-lib-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      // 單一檔案失敗不要讓整個安裝掛掉
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('sticker-') && !k.endsWith(VERSION))
            .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 模型權重：完全不介入
  if (url.hostname.endsWith('huggingface.co') || url.hostname.endsWith('hf.co')) return;

  // CDN 函式庫：cache first
  if (LIB_HOSTS.includes(url.hostname)){
    e.respondWith(
      caches.open(LIB_CACHE).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => fetch(req))
    );
    return;
  }

  // 同源的 app shell：cache first + 背景更新
  if (url.origin === location.origin){
    e.respondWith(
      caches.open(SHELL_CACHE).then(async c => {
        const hit = await c.match(req, { ignoreSearch:true });
        const net = fetch(req).then(res => {
          if (res.ok) c.put(req, res.clone());
          return res;
        }).catch(() => null);
        // 導覽請求離線時退回首頁
        return hit || await net || await c.match('./index.html') || Response.error();
      })
    );
  }
});
