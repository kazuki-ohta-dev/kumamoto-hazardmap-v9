'use strict';
/* くまもとハザードマップ v9 — 高校生が「平時に、自分の危険を体感して備える」ための地図
   柱：①知る（検索・判定）②体感する（自分の身長・住まいで深さを描く／水が引くまでの時間／家ごと流される区域）③備える（避難場所・避難カード） */

// ================= 定数 =================
const BASE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const DEM_URL  = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';   // 標高（海＝値なし）
const HZ_ROOT  = 'https://disaportaldata.gsi.go.jp/raster/';
const MIN_SAVE_Z = 10, HZ_MAX_Z = 17, DEM_MAX_Z = 14, PREF_MAX_Z = 12, PLACE_MAX_Z = 16;
const KB_PER_TILE = { 10: 75, 11: 75, 12: 75, 13: 44, 14: 44, 15: 40, 16: 25 };
const P = 'hm9-';                                                  // 保存データの名前（v1〜v8と分ける）

// 浸水深の凡例（ハザードマップポータルサイトの凡例画像から取得）[R,G,B, ラベル, 下限m, 上限m]
const DEPTH = [
  [255,255,179,'0.3m未満',0,0.3], [255,255,178,'0.3m未満',0,0.3], [247,245,169,'0.5m未満',0,0.5],
  [248,225,166,'0.5〜1m',0.5,1], [255,216,192,'0.5〜3m',0.5,3], [255,183,183,'3〜5m',3,5],
  [255,145,145,'5〜10m',5,10], [242,133,201,'10〜20m',10,20], [220,122,220,'20m以上',20,24],
];
const LEGEND_DEPTH = [DEPTH[2], DEPTH[4], DEPTH[5], DEPTH[6], DEPTH[7], DEPTH[8]];
// 浸水継続時間（水が引くまで）[R,G,B, ラベル, 時間の上限h]
const DURATION = [
  [160,210,255,'12時間未満',12], [0,65,255,'12時間〜1日',24], [250,245,0,'1〜3日',72], [255,153,0,'3日〜1週間',168],
  [255,40,0,'1〜2週間',336], [180,0,104,'2週間以上',672], [96,0,96,'4週間以上',1000],
];
// 土砂災害警戒区域の色 [R,G,B, 特別警戒区域か, 指定予定か]
const DOSHA_COLORS = {
  '05_dosekiryukeikaikuiki': [[165,0,33,1,0],[183,51,77,1,1],[230,200,50,0,0],[235,211,91,0,1]],
  '05_kyukeishakeikaikuiki': [[250,40,0,1,0],[251,83,51,1,1],[250,230,0,0,0],[251,235,51,0,1]],
  '05_jisuberikeikaikuiki':  [[180,0,40,1,0],[195,51,83,1,1],[255,153,0,0,0],[255,173,51,0,1]],
};
const L_KEIZOKU = '01_flood_l2_keizoku_data';
const L_HANRAN  = '01_flood_l2_kaokutoukai_hanran_data';
const L_KAGAN   = '01_flood_l2_kaokutoukai_kagan_data';
const L_NAISUI  = '02_naisui_data';

const LAYERS = {
  flood:    { label:'洪水', kind:'depth', paths:['01_flood_l2_shinsuishin_data'], swatch:'#ffb7b7', shelterBit:1,
              title:'川があふれたときの浸水の深さ', note:'1000年に1回程度の大雨で川があふれた場合の想定' },
  dosha:    { label:'土砂災害', kind:'zone', paths:Object.keys(DOSHA_COLORS), names:['土石流','がけ崩れ','地すべり'], swatch:'#e6c832', shelterBit:2,
              title:'土砂災害警戒区域', note:'大雨のときは区域の外の頑丈な建物へ早めに避難' },
  tsunami:  { label:'津波', kind:'depth', paths:['04_tsunami_newlegend_data'], swatch:'#ff9191', shelterBit:8,
              title:'津波の浸水の深さ', note:'最大クラスの津波が来た場合の想定' },
  takashio: { label:'高潮', kind:'depth', paths:['03_hightide_l2_shinsuishin_data'], swatch:'#f285c9', shelterBit:4,
              title:'高潮の浸水の深さ', note:'想定最大規模の台風で高潮が起きた場合の想定' },
};
const ALL_HZ_PATHS = [...Object.values(LAYERS).flatMap(l => l.paths), L_KEIZOKU, L_HANRAN, L_KAGAN, L_NAISUI];

const STOPS = [
  { m: 20,  label: '20m',  sub: '7階〜',   words: '7階建て以上が水につかる' },
  { m: 10,  label: '10m',  sub: '4〜6階',  words: '4〜6階建てが水につかる' },
  { m: 5,   label: '5m',   sub: '2階屋根', words: '2階建ての屋根をこえる' },
  { m: 3,   label: '3m',   sub: '1階天井', words: '1階が天井まで水につかる' },
  { m: 1,   label: '1m',   sub: '腰',      words: '大人の腰より深い' },
  { m: 0.5, label: '0.5m', sub: 'ひざ',    words: '大人のひざより深い' },
  { m: null, label: '全部', sub: '色分け', words: '' },
];
const TIMINGS = [
  { id: 'l3', t: '高齢者等避難が出たら', s: '警戒レベル3　暗くなる前に動ける' },
  { id: 'l4', t: '避難指示が出たら', s: '警戒レベル4　危ない場所の人は全員避難' },
  { id: 'eve', t: '大雨予報の前の晩に', s: '家族そろって早めに移動' },
];

// ================= アイコン（Lucide・ISC License） =================
const ICONS = {"triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /> <path d=\"M12 9v4\" /> <path d=\"M12 17h.01\" />", "info": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 16v-4\" /> <path d=\"M12 8h.01\" />", "check": "<path d=\"M20 6 9 17l-5-5\" />", "navigation-2": "<polygon points=\"12 2 19 21 12 17 5 21 12 2\" />", "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />", "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />", "house": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" /> <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />"};
const ic = (n, cls = 'ic s') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

// ================= 小物 =================
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms); }
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const hzTpl = path => HZ_ROOT + path + '/{z}/{x}/{y}.png';
const fmtMB = b => !b ? '0MB' : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + 'GB' : Math.max(0.1, b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0) + 'MB';
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
const fmtM = m => (Math.round(m * 10) / 10).toString().replace(/\.0$/, '') + 'm';
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const DIR8 = ['北','北東','東','南東','南','南西','西','北西'];
const dirName = deg => DIR8[Math.round(deg / 45) % 8];
const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch {} },
};

// ================= 状態 =================
let activeLayer = store.get('layer', 'flood');
let quality = store.get('quality', 15);
let threshold = null;
let me = store.get('me', { height: 165, home: 'h2', floor: 3 });      // 身長cm／住まい h1=平屋 h2=2階建て apt=マンション
let cards = store.get('cards', []);
let munis = [], shelters = [];
const jobs = {};
let saved = store.get('saved', {});
const saveLedger = () => store.set('saved', saved);

// ================= 地図 =================
const KUMAMOTO_BOUNDS = [[32.09, 129.95], [33.20, 131.34]];
const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 18, tapHold: true });
const savedView = store.get('view', null);
if (savedView) map.setView(savedView.c, savedView.z); else map.setView([32.62, 130.76], 9);
map.attributionControl.setPrefix(false);
L.tileLayer(BASE_URL, {
  maxNativeZoom: 18, maxZoom: 18,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>｜出典：<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータルサイト</a>・<a href="https://www.gsi.go.jp/bousaichiri/hinanbasho.html" target="_blank">指定緊急避難場所データ</a>',
}).addTo(map);
map.createPane('mask'); map.getPane('mask').style.zIndex = 350; map.getPane('mask').style.pointerEvents = 'none';
map.createPane('places'); map.getPane('places').style.zIndex = 420;
map.createPane('shelters'); map.getPane('shelters').style.zIndex = 640;
const hazardGroup = L.layerGroup().addTo(map);
const placeGroup = L.layerGroup().addTo(map);
const shelterDots = L.layerGroup().addTo(map);
const routeGroup = L.layerGroup().addTo(map);
const routeLines = L.layerGroup().addTo(map);

// ================= タイル画素の読み取り =================
const pixCache = new Map(), PIX_MAX = 600;
const pxCanvas = document.createElement('canvas');
const pxCtx = pxCanvas.getContext('2d', { willReadFrequently: true });
addEventListener('online', () => pixCache.clear());
function getTilePixels(url) {
  if (pixCache.has(url)) { const p = pixCache.get(url); pixCache.delete(url); pixCache.set(url, p); return p; }
  const p = (async () => {
    let res;
    try { res = await fetch(url, { mode: 'cors' }); } catch { return { state: 'missing' }; }
    if (res.headers.get('X-HM-Missing')) return { state: 'missing' };
    if (res.status === 404 || res.headers.get('X-HM-Empty')) return { state: 'empty' };
    if (!res.ok) return { state: 'missing' };
    try {
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      pxCanvas.width = bmp.width; pxCanvas.height = bmp.height;
      pxCtx.clearRect(0, 0, bmp.width, bmp.height); pxCtx.drawImage(bmp, 0, 0);
      return { state: 'img', w: bmp.width, h: bmp.height, data: pxCtx.getImageData(0, 0, bmp.width, bmp.height).data };
    } catch { return { state: 'missing' }; }
  })();
  pixCache.set(url, p);
  p.then(v => { if (v.state === 'missing' && navigator.onLine) pixCache.delete(url); });
  if (pixCache.size > PIX_MAX) pixCache.delete(pixCache.keys().next().value);
  return p;
}
async function pixelAt(tpl, lat, lng, maxZ) {
  for (let z = maxZ; z >= MIN_SAVE_Z; z--) {
    const fx = lon2x(lng, z), fy = lat2y(lat, z), x = Math.floor(fx), y = Math.floor(fy);
    const v = await getTilePixels(tileUrl(tpl, z, x, y));
    if (v.state === 'missing') continue;
    if (v.state === 'empty') return { state: 'none', z };
    const px = Math.min(v.w - 1, Math.floor((fx - x) * v.w)), py = Math.min(v.h - 1, Math.floor((fy - y) * v.h));
    const i = (py * v.w + px) * 4, d = v.data;
    return { state: 'img', rgba: [d[i], d[i + 1], d[i + 2], d[i + 3]], z };
  }
  return { state: 'unknown' };
}
async function sample(path, lat, lng) {
  const r = await pixelAt(hzTpl(path), lat, lng, HZ_MAX_Z);
  if (r.state !== 'img') return r;
  return r.rgba[3] < 40 ? { state: 'none', z: r.z } : { state: 'hit', rgba: r.rgba, z: r.z };
}
// 標高：{state:'land', h} | {state:'sea'} | {state:'unknown'}
async function elevation(lat, lng) {
  const r = await pixelAt(DEM_URL, lat, lng, DEM_MAX_Z);
  if (r.state === 'none') return { state: 'sea' };
  if (r.state !== 'img') return { state: 'unknown' };
  const [R, G, B] = r.rgba, x = R * 65536 + G * 256 + B;
  if (x === 8388608) return { state: 'sea' };
  return { state: 'land', h: (x < 8388608 ? x : x - 16777216) * 0.01 };
}
const near3 = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
function nearest(table, rgba, tol = 45) {
  let best = null, bd = 1e9;
  for (const row of table) { const d = near3(row, rgba); if (d < bd) { bd = d; best = row; } }
  return bd <= tol ? best : null;
}
const classifyDepth = rgba => nearest(DEPTH, rgba);
const classifyDuration = rgba => nearest(DURATION, rgba, 60);
function classifyDosha(path, rgba) {
  const c = nearest(DOSHA_COLORS[path], rgba, 40);
  if (c) return { special: !!c[3], planned: !!c[4] };
  if (rgba[2] > 100 && rgba[0] < 60) return null;                     // 指定予定の点線（紺色）は区域の枠なので数えない
  return { special: rgba[0] > 150 && rgba[1] < 90, planned: false };   // 中間色は赤みで判断
}

// ================= 深さスライダー（洪水のみ） =================
const COL_RED = [206, 0, 0, 200], COL_ORANGE = [251, 91, 1, 185], COL_GRAY = [102, 102, 102, 55];   // red-900／orange-600／gray-600
let classMemo = new Map();
function thresholdColor(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let c = classMemo.get(key);
  if (c === undefined) {
    const d = classifyDepth([r, g, b]);
    c = !d ? COL_ORANGE : d[4] >= threshold ? COL_RED : d[5] > threshold ? COL_ORANGE : COL_GRAY;
    classMemo.set(key, c);
  }
  return c;
}
const ThresholdLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const dz = Math.max(0, coords.z - HZ_MAX_Z), sz = coords.z - dz, scale = 1 << dz;
    const sx = coords.x >> dz, sy = coords.y >> dz;
    const ox = (coords.x - (sx << dz)) * 256 / scale, oy = (coords.y - (sy << dz)) * 256 / scale;
    getTilePixels(tileUrl(hzTpl(this.options.path), sz, sx, sy)).then(v => {
      if (v.state === 'img') {
        const ctx = c.getContext('2d'), out = ctx.createImageData(256, 256), o = out.data, src = v.data, f = v.w / 256;
        for (let y = 0; y < 256; y++) {
          const syy = Math.min(v.h - 1, Math.floor((oy + y / scale) * f));
          for (let x = 0; x < 256; x++) {
            const i = (syy * v.w + Math.min(v.w - 1, Math.floor((ox + x / scale) * f))) * 4;
            if (src[i + 3] < 40) continue;
            const col = thresholdColor(src[i], src[i + 1], src[i + 2]), j = (y * 256 + x) * 4;
            o[j] = col[0]; o[j + 1] = col[1]; o[j + 2] = col[2]; o[j + 3] = col[3];
          }
        }
        ctx.putImageData(out, 0, 0);
      }
      done(null, c);
    });
    return c;
  },
});
let sliderOpen = false;
function renderSlider() {
  const show = activeLayer === 'flood';
  $('#dsToggle').hidden = !show || sliderOpen;
  $('#depthSlider').hidden = !show || !sliderOpen;
  if (!show) { $('#dsBanner').hidden = true; return; }
  $('#dsTrack').innerHTML = STOPS.map((s, i) =>
    `<div class="ds-stop${s.m === threshold ? ' on' : ''}${s.m === null ? ' off' : ''}" data-i="${i}"><b>${s.label}</b><small>${s.sub}</small></div>`).join('');
  const b = $('#dsBanner');
  if (threshold === null || !sliderOpen) { b.hidden = true; return; }
  const s = STOPS.find(x => x.m === threshold);
  b.innerHTML = `<b>${s.label}以上（${s.words}）</b><br>
    <span class="k"><i style="background:rgb(${COL_RED.slice(0, 3)})"></i>${s.label}以上</span><span class="k"><i style="background:rgb(${COL_ORANGE.slice(0, 3)})"></i>以上かも</span><span class="k"><i style="background:rgba(102,102,102,.35)"></i>未満</span>`;
  b.hidden = false;
}
function setThreshold(m) { if (m === threshold) return; threshold = m; classMemo = new Map(); showLayer(activeLayer, true); }
$('#dsToggle').onclick = () => { sliderOpen = true; if (threshold === null) setThreshold(3); else renderSlider(); };
$('#dsClose').onclick = () => { sliderOpen = false; setThreshold(null); renderSlider(); };
(() => {
  const track = $('#dsTrack');
  const pick = e => {
    let best = 0, bd = 1e9;
    [...track.querySelectorAll('.ds-stop')].forEach((el, i) => { const r = el.getBoundingClientRect(), d = Math.abs(e.clientY - (r.top + r.height / 2)); if (d < bd) { bd = d; best = i; } });
    setThreshold(STOPS[best].m);
  };
  let dragging = false;
  track.addEventListener('pointerdown', e => { dragging = true; track.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); });
  track.addEventListener('pointermove', e => { if (dragging) pick(e); });
  track.addEventListener('pointerup', () => dragging = false);
  track.addEventListener('pointercancel', () => dragging = false);
})();

// ================= レイヤー =================
function showLayer(key, keepSheet) {
  activeLayer = key; store.set('layer', key);
  hazardGroup.clearLayers();
  const l = LAYERS[key];
  if (key === 'flood' && threshold !== null) new ThresholdLayer({ path: l.paths[0], maxZoom: 18 }).addTo(hazardGroup);
  else for (const p of l.paths) L.tileLayer(hzTpl(p), { maxNativeZoom: HZ_MAX_Z, maxZoom: 18, opacity: 0.78, crossOrigin: true }).addTo(hazardGroup);
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.key === key));
  renderLegend(); renderSlider(); drawShelterDots();
  if (lastTap && !keepSheet) inspect(lastTap);
}
for (const [key, l] of Object.entries(LAYERS)) {
  const b = document.createElement('button');
  b.className = 'chip'; b.dataset.key = key;
  b.innerHTML = `<i style="background:${l.swatch}"></i>${esc(l.label)}`;
  b.onclick = () => showLayer(key);
  $('#layerChips').appendChild(b);
}
function renderLegend() {
  const l = LAYERS[activeLayer];
  const sw = (c, t) => `<div class="row"><span class="sw" style="background:${c}"></span>${t}</div>`;
  let rows;
  if (l.kind === 'depth') rows = LEGEND_DEPTH.slice().reverse().map(d => sw(`rgb(${d[0]},${d[1]},${d[2]})`, d[3])).join('');
  else rows = sw('rgb(165,0,33)', '土石流・特別警戒区域') + sw('rgb(230,200,50)', '土石流・警戒区域') + sw('rgb(250,40,0)', 'がけ崩れ・特別警戒区域') +
              sw('rgb(250,230,0)', 'がけ崩れ・警戒区域') + sw('rgb(180,0,40)', '地すべり・特別警戒区域') + sw('rgb(255,153,0)', '地すべり・警戒区域') +
              `<div class="note">点線の区域は指定予定</div>`;
  rows += `<div class="row" style="margin-top:6px"><span class="shel-dot"></span>避難場所（${esc(l.label)}に対応）</div>
           <div class="note">色のない場所も安全とは限りません<br>小さな川や下水があふれる浸水は含まれていません</div>`;
  $('#legend').innerHTML = `<h3>${esc(l.label)}の色の見かた</h3>${rows}`;
}
$('#btnLegend').onclick = () => { const g = $('#legend'); g.hidden = !g.hidden; $('#btnLegend').classList.toggle('active', !g.hidden); };

// ================= 市町村 =================
let muniLayer;
function muniStyle(f) {
  const s = saved['m:' + f.properties.code];
  return s && s.done ? { color: '#0017c1', weight: 1.6, opacity: .8, fill: true, fillColor: '#0017c1', fillOpacity: .04, interactive: false }
                     : { color: '#666666', weight: .8, opacity: .55, fill: false, interactive: false };
}
const refreshMuniStyle = () => { if (muniLayer) muniLayer.setStyle(muniStyle); };
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(f, lon, lat) {
  const b = f.properties.bbox;
  if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
  return f.geometry.coordinates.some(poly => pointInRing(lon, lat, poly[0]));
}
const muniAt = (lat, lon) => munis.find(f => inFeature(f, lon, lat));
function updatePlace() {
  const c = map.getCenter();
  store.set('view', { c: [c.lat, c.lng], z: map.getZoom() });
  if (map.getZoom() < 10) { $('#placeName').textContent = '熊本県'; return; }
  const f = muniAt(c.lat, c.lng);
  $('#placeName').textContent = f ? f.properties.name : '熊本県外';
}
map.on('moveend', () => { updatePlace(); drawShelterDots(); });

// ================= 避難場所 =================
const shelterIcon = L.divIcon({ className: '', html: '<div class="shel-dot"></div>', iconSize: [12, 12] });
function drawShelterDots() {
  shelterDots.clearLayers();
  if (!shelters.length || map.getZoom() < 13) return;
  const b = map.getBounds().pad(0.1), bit = LAYERS[activeLayer].shelterBit;
  for (const s of shelters) {
    if (!(s[4] & bit) || !b.contains([s[2], s[3]])) continue;
    L.marker([s[2], s[3]], { icon: shelterIcon, pane: 'shelters' }).bindPopup(`<b>${esc(s[0])}</b><br><small>${esc(s[1])}</small>`)
      .on('click', function () { if (flow.step === 2 && flow.picking) { this.closePopup(); pickShelter(s); } }).addTo(shelterDots);
  }
}
function nearestShelters(lat, lng, bit, n) {
  const out = [];
  for (const s of shelters) {
    if (!(s[4] & bit)) continue;
    const d = distM(lat, lng, s[2], s[3]);
    if (out.length < n || d < out[out.length - 1].d) { out.push({ s, d }); out.sort((a, b) => a.d - b.d); if (out.length > n) out.pop(); }
  }
  return out;
}
// 直線上に海があるか（標高データで判定。判定できなければ false）
async function crossesSea(lat1, lon1, lat2, lon2) {
  const d = distM(lat1, lon1, lat2, lon2), steps = Math.min(60, Math.max(3, Math.ceil(d / 150)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, e = await elevation(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t);
    if (e.state === 'sea') return true;
  }
  return false;
}
async function maxDepthAlong(path, lat1, lon1, lat2, lon2) {
  const d = distM(lat1, lon1, lat2, lon2), steps = Math.min(120, Math.max(4, Math.ceil(d / 40)));
  let worst = null;
  for (let i = 1; i < steps; i++) {
    const t = i / steps, r = await sample(path, lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t);
    if (r.state === 'hit') { const c = classifyDepth(r.rgba); if (c && (!worst || c[5] > worst[5])) worst = c; }
  }
  return worst;
}
async function doshaAt(lat, lng) {
  const hits = [];
  for (const [i, p] of LAYERS.dosha.paths.entries()) {
    const r = await sample(p, lat, lng);
    if (r.state === 'hit') { const c = classifyDosha(p, r.rgba); if (c) hits.push({ name: LAYERS.dosha.names[i], ...c }); }
  }
  return hits;
}
// 海を越えない、近い順3件
async function pickShelters(lat, lng, bit) {
  const cand = nearestShelters(lat, lng, bit, 10), out = [];
  for (const c of cand) {
    if (out.length >= 3) break;
    if (await crossesSea(lat, lng, c.s[2], c.s[3])) continue;
    out.push(c);
  }
  return out;
}
const arrowSVG = deg => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${deg}deg)">${ICONS['navigation-2']}</svg>`;
let lastShelters = [];
async function renderShelters(latlng, seq, ctx) {
  const el = $('#shelters'); if (!el) return;
  const l = LAYERS[activeLayer];
  if (!shelters.length) { el.innerHTML = '<div class="shel-info">避難場所データを読み込み中です</div>'; return; }
  const near = await pickShelters(latlng.lat, latlng.lng, l.shelterBit);
  if (seq !== inspectSeq) return;
  lastShelters = near;
  routeGroup.clearLayers();
  if (!near.length) { el.innerHTML = `<h4>近くの避難場所</h4><div class="shel-info">海を渡らずに行ける${esc(l.label)}の避難場所が見つかりません</div>`; return; }
  near.forEach((n, i) => {
    const ll = [n.s[2], n.s[3]];
    L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="shel-pin">${i + 1}</div>`, iconSize: [24, 24] }), pane: 'shelters', zIndexOffset: 1000 })
      .bindPopup(`<b>${esc(n.s[0])}</b><br><small>${esc(n.s[1])}</small>`).addTo(routeGroup);
  });
  el.innerHTML = `<h4>近くの避難場所（${esc(l.label)}に対応・番号は地図のピン）</h4>` + near.map((n, i) => {
    const deg = bearingDeg(latlng.lat, latlng.lng, n.s[2], n.s[3]);
    return `<div class="shel-item"><button class="shel-row" data-i="${i}"><span class="shel-no">${i + 1}</span><span class="shel-main">
      <div class="shel-name">${esc(n.s[0])}</div>
      <div class="shel-dist">${arrowSVG(deg)}${dirName(deg)}へ ${fmtDist(n.d)}（直線）</div>
      <div class="shel-info" id="shi${i}">${esc(n.s[1])}</div><div class="shel-warn" id="shw${i}"></div></span></button>
      <button class="btn-sub" data-route="${i}">道のりを見る</button><div id="shr${i}"></div></div>`;
  }).join('');
  el.querySelectorAll('.shel-row').forEach(b => b.onclick = () => {
    const n = near[+b.dataset.i];
    map.fitBounds(L.latLngBounds([latlng, [n.s[2], n.s[3]]]).pad(0.35), { paddingBottomRight: [0, $('#sheet').offsetHeight * 0.6] });
  });
  el.querySelectorAll('[data-route]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.route, n = near[i], box = $('#shr' + i);
    box.innerHTML = '<div class="shel-info">道のりを計算しています…</div>';
    b.disabled = true;
    const R = await computeRoutes({ lat: latlng.lat, lng: latlng.lng }, { lat: n.s[2], lng: n.s[3] }, activeLayer);
    b.disabled = false;
    if (!$('#shr' + i)) return;
    box.innerHTML = routeSummaryHTML(R);
    routeLines.clearLayers(); drawRoutes(R, routeLines);
    if (!R.error) map.fitBounds(L.latLngBounds([...R.fast.pts, ...(R.safe ? R.safe.pts : [])]).pad(0.15), { paddingBottomRight: [0, $('#sheet').offsetHeight * 0.6] });
  });
  for (let i = 0; i < near.length; i++) {
    const n = near[i], info = $('#shi' + i), warn = $('#shw' + i);
    if (l.kind === 'depth') {
      const [here, worst] = await Promise.all([sample(l.paths[0], n.s[2], n.s[3]), maxDepthAlong(l.paths[0], latlng.lat, latlng.lng, n.s[2], n.s[3])]);
      if (seq !== inspectSeq) return;
      const c = here.state === 'hit' ? classifyDepth(here.rgba) : null;
      if (c) info.textContent = `この避難場所の敷地も浸水想定 ${c[3]}（上の階へ避難する施設の場合があります）`;
      if (worst && worst[5] > Math.max(ctx.originHi || 0, c ? c[5] : 0)) warn.innerHTML = `${ic('triangle-alert')}<span>途中にここより深い${esc(worst[3])}の浸水想定あり<br>浸水が始まる前に移動</span>`;
    } else {
      const hits = await doshaAt(n.s[2], n.s[3]);
      if (seq !== inspectSeq) return;
      if (hits.length) warn.innerHTML = `${ic('triangle-alert')}<span>この避難場所も土砂災害の${hits.some(h => h.special) ? '特別' : ''}警戒区域内<br>市町村の案内を確認</span>`;
    }
  }
}

// ================= 道のりの計算（平時に計算し、避難カードに保存する） =================
// 道路：国土地理院 道路中心線（ベクトルタイル z16）。浸水想定0.5m以上・家屋倒壊等氾濫想定区域（洪水）・土砂の特別警戒区域を「通れない」とする
const RD_URL = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/{x}/{y}.geojson';
const RD_Z = 16, WALK_M_PER_MIN = 60, ROUTE_MAX_M = 5000, ROUTE_DEPTH_LIMIT = 0.5, CAR_DEPTH_LIMIT = 0.3;   // 車は水深30cmでもエンジンが止まるおそれ（JAFの実験）
const fmtWalk = m => `歩いて約${Math.max(1, Math.round(m / WALK_M_PER_MIN))}分`;
const routeCache = {};
function tileRange(b, z) {
  return { x0: Math.floor(lon2x(b.w, z)), x1: Math.floor(lon2x(b.e, z)), y0: Math.floor(lat2y(b.n, z)), y1: Math.floor(lat2y(b.s, z)) };
}
async function loadRoadGraph(b, mode = 'walk') {
  const r = tileRange(b, RD_Z), urls = [];
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) urls.push(tileUrl(RD_URL, RD_Z, x, y));
  if (urls.length > 120) throw new Error('too-large');
  const feats = []; let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < urls.length) { const u = urls[i++]; try { const res = await fetch(u, { mode: 'cors' }); if (res.ok && !res.headers.get('X-HM-Missing')) feats.push(...((await res.json()).features || [])); } catch {} }
  }));
  const lat = [], lon = [], adj = [], edges = [], key = new Map();
  const node = (x, y) => {
    const k = Math.round(x * 1e5) + ',' + Math.round(y * 1e5);   // 約1mでつなぐ（タイルの境目の誤差を吸収）
    let id = key.get(k);
    if (id === undefined) { id = lat.length; key.set(k, id); lat.push(y); lon.push(x); adj.push([]); }
    return id;
  };
  for (const f of feats) {
    if (/高速/.test(f.properties?.rdCtg || '')) continue;                  // 高速道路は使わない
    const g = f.geometry; if (!g) continue;
    const slow = mode === 'car' && f.properties?.rnkWidth === '3m未満' ? 4 : 1;   // 車のときは幅3m未満の道をなるべく使わない（4倍の重み）
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const ln of lines) for (let k = 1; k < ln.length; k++) {
      const a = node(ln[k - 1][0], ln[k - 1][1]), c = node(ln[k][0], ln[k][1]);
      if (a === c) continue;
      const e = edges.length, len = distM(lat[a], lon[a], lat[c], lon[c]);
      edges.push({ a, b: c, len, cost: len * slow, block: false });
      adj[a].push(e); adj[c].push(e);
    }
  }
  return { lat, lon, adj, edges };
}
// 範囲内のハザードタイルを先に読み込み、すぐに引ける形にする
async function hazardGrid(paths, b, z) {
  const r = tileRange(b, z), list = [], tiles = new Map();
  for (const p of paths) for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) list.push([p, x, y]);
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < list.length) { const [p, x, y] = list[i++]; tiles.set(p + '/' + x + '/' + y, await getTilePixels(tileUrl(hzTpl(p), z, x, y))); }
  }));
  return (p, la, lo) => {
    const fx = lon2x(lo, z), fy = lat2y(la, z), x = Math.floor(fx), y = Math.floor(fy);
    const v = tiles.get(p + '/' + x + '/' + y);
    if (!v || v.state !== 'img') return null;
    const px = Math.min(v.w - 1, Math.floor((fx - x) * v.w)), py = Math.min(v.h - 1, Math.floor((fy - y) * v.h)), k = (py * v.w + px) * 4;
    return v.data[k + 3] < 40 ? null : [v.data[k], v.data[k + 1], v.data[k + 2], 255];
  };
}
function blockTester(layerKey, at, mode = 'walk') {
  const l = LAYERS[layerKey];
  if (l.kind === 'depth') return (la, lo) => {
    const c = at(l.paths[0], la, lo);
    if (c) {
      const d = classifyDepth(c);
      if (mode === 'car' ? (!d || d[5] > CAR_DEPTH_LIMIT) : (d && d[4] >= ROUTE_DEPTH_LIMIT)) return true;   // 車は0.3mをこえるおそれがある区分をすべて避ける
    }
    return layerKey === 'flood' && !!(at(L_HANRAN, la, lo) || at(L_KAGAN, la, lo));
  };
  return (la, lo) => l.paths.some(p => { const c = at(p, la, lo); if (!c) return false; const k = classifyDosha(p, c); return !!(k && k.special); });
}
function dijkstra(G, s, t, avoidBlocked) {
  const n = G.lat.length, dist = new Float64Array(n).fill(Infinity), prevN = new Int32Array(n).fill(-1), prevE = new Int32Array(n).fill(-1);
  const hk = [], hv = [];                                   // 二分ヒープ（距離, 点）
  const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [k, v]; };
  dist[s] = 0; push(0, s);
  while (hk.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === t) break;
    for (const ei of G.adj[u]) {
      const e = G.edges[ei];
      if (avoidBlocked && e.block) continue;
      const v = e.a === u ? e.b : e.a, nd = d + e.cost;
      if (nd < dist[v]) { dist[v] = nd; prevN[v] = u; prevE[v] = ei; push(nd, v); }
    }
  }
  if (!isFinite(dist[t])) return null;
  const nodes = [], es = [];
  for (let u = t; u !== -1; u = prevN[u]) { nodes.push(u); if (prevE[u] >= 0) es.push(prevE[u]); }
  es.reverse();
  return { nodes: nodes.reverse(), edges: es, len: es.reduce((a, ei) => a + G.edges[ei].len, 0) };
}
function dijkstraAll(G, s) {
  const n = G.lat.length, dist = new Float64Array(n).fill(Infinity), prevN = new Int32Array(n).fill(-1), lenTo = new Float64Array(n).fill(Infinity);
  const hk = [], hv = [];
  const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [k, v]; };
  dist[s] = 0; lenTo[s] = 0; push(0, s);
  while (hk.length) {
    const [d, u] = pop(); if (d > dist[u]) continue;
    for (const ei of G.adj[u]) { const e = G.edges[ei]; if (e.block) continue; const v = e.a === u ? e.b : e.a, nd = d + e.cost; if (nd < dist[v]) { dist[v] = nd; lenTo[v] = lenTo[u] + e.len; prevN[v] = u; push(nd, v); } }
  }
  return { dist, prevN, lenTo };
}
// 浸水後も道でたどり着ける避難場所を、出発地から半径2km以内で探す
async function findSafeShelter(from, layerKey, mode = 'walk') {
  const R = 2000, kx = 111320 * Math.cos(from.lat * Math.PI / 180), ky = 110570;
  const b = { s: from.lat - R / ky, n: from.lat + R / ky, w: from.lng - R / kx, e: from.lng + R / kx };
  let G; try { G = await loadRoadGraph(b, mode); } catch { return null; }
  if (!G.edges.length) return null;
  const l = LAYERS[layerKey];
  const paths = l.kind === 'depth' ? [l.paths[0], ...(layerKey === 'flood' ? [L_HANRAN, L_KAGAN] : [])] : l.paths;
  const blocked = blockTester(layerKey, await hazardGrid(paths, b, RD_Z), mode);
  markBlocked(G, blocked);
  const s = nearestNodeOf(G, from.lat, from.lng); if (s < 0) return null;
  const { dist, prevN, lenTo } = dijkstraAll(G, s);
  let best = null;
  for (const sh of shelters) {
    if (!(sh[4] & l.shelterBit) || sh[2] < b.s || sh[2] > b.n || sh[3] < b.w || sh[3] > b.e) continue;
    const t = nearestNodeOf(G, sh[2], sh[3]); if (t < 0 || !isFinite(dist[t])) continue;
    if (distM(sh[2], sh[3], G.lat[t], G.lon[t]) > 150) continue;
    const len = lenTo[t] + distM(from.lat, from.lng, G.lat[s], G.lon[s]);
    if (!best || dist[t] < best.cost) best = { name: sh[0], lat: sh[2], lng: sh[3], len, t, cost: dist[t] };
  }
  if (!best) return null;
  const pts = [];
  for (let u = best.t; u !== -1; u = prevN[u]) pts.push([+G.lat[u].toFixed(5), +G.lon[u].toFixed(5)]);
  pts.reverse(); pts.unshift([+from.lat.toFixed(5), +from.lng.toFixed(5)]); pts.push([+best.lat.toFixed(5), +best.lng.toFixed(5)]);
  return { name: best.name, lat: best.lat, lng: best.lng, len: Math.round(best.len), pts };
}
function markBlocked(G, blocked) {
  for (const e of G.edges) {
    const n = Math.max(1, Math.ceil(e.len / 20));       // 20mごとに調べる
    for (let k = 0; k < n && !e.block; k++) { const t = (k + .5) / n; if (blocked(G.lat[e.a] + (G.lat[e.b] - G.lat[e.a]) * t, G.lon[e.a] + (G.lon[e.b] - G.lon[e.a]) * t)) e.block = true; }
  }
}
function nearestNodeOf(G, la, lo) {
  let best = -1, bd = Infinity; const c = Math.cos(la * Math.PI / 180);
  for (let i = 0; i < G.lat.length; i++) { if (!G.adj[i].length) continue; const dd = (G.lat[i] - la) ** 2 + ((G.lon[i] - lo) * c) ** 2; if (dd < bd) { bd = dd; best = i; } }
  return best;
}
async function computeRoutes(from, to, layerKey, mode = 'walk') {
  const ck = [from.lat.toFixed(5), from.lng.toFixed(5), to.lat.toFixed(5), to.lng.toFixed(5), layerKey, mode].join('|');
  if (routeCache[ck]) return routeCache[ck];
  const d = distM(from.lat, from.lng, to.lat, to.lng);
  if (d > ROUTE_MAX_M) return { error: 'far' };
  if (!navigator.onLine) return { error: 'offline' };
  const pad = Math.max(400, d * 0.35), kx = 111320 * Math.cos(from.lat * Math.PI / 180), ky = 110570;
  const b = { s: Math.min(from.lat, to.lat) - pad / ky, n: Math.max(from.lat, to.lat) + pad / ky, w: Math.min(from.lng, to.lng) - pad / kx, e: Math.max(from.lng, to.lng) + pad / kx };
  let G;
  try { G = await loadRoadGraph(b, mode); } catch { return { error: 'roads' }; }
  if (!G.edges.length) return { error: 'roads' };
  const l = LAYERS[layerKey];
  const paths = l.kind === 'depth' ? [l.paths[0], ...(layerKey === 'flood' ? [L_HANRAN, L_KAGAN] : [])] : l.paths;
  const blocked = blockTester(layerKey, await hazardGrid(paths, b, RD_Z), mode);
  markBlocked(G, blocked);
  const s = nearestNodeOf(G, from.lat, from.lng), t = nearestNodeOf(G, to.lat, to.lng);
  if (s < 0 || t < 0) return { error: 'roads' };
  const sOff = distM(from.lat, from.lng, G.lat[s], G.lon[s]), tOff = distM(to.lat, to.lng, G.lat[t], G.lon[t]);
  if (sOff > 300 || tOff > 300) return { error: 'noroad' };
  const fast = dijkstra(G, s, t, false);
  if (!fast) return { error: 'noroute' };
  const safe = dijkstra(G, s, t, true);
  const P = i => [+G.lat[i].toFixed(5), +G.lon[i].toFixed(5)];
  const pts = rt => [[+from.lat.toFixed(5), +from.lng.toFixed(5)], ...rt.nodes.map(P), [+to.lat.toFixed(5), +to.lng.toFixed(5)]];
  const deep = []; let deepLen = 0, cur = null;
  for (let k = 0; k < fast.edges.length; k++) {
    const e = G.edges[fast.edges[k]];
    if (e.block) { deepLen += e.len; if (!cur) { cur = [P(fast.nodes[k])]; deep.push(cur); } cur.push(P(fast.nodes[k + 1])); } else cur = null;
  }
  const out = {
    layer: layerKey, mode, date: Date.now(),
    fast: { len: Math.round(fast.len + sOff + tOff), pts: pts(fast), deepLen: Math.round(deepLen), deep },
    safe: safe ? { len: Math.round(safe.len + sOff + tOff), pts: pts(safe) } : null,
    startBlocked: G.adj[s].every(ei => G.edges[ei].block),
    endBlocked: G.adj[t].every(ei => G.edges[ei].block),
    alt: null,
  };
  if (!safe && !out.startBlocked) out.alt = await findSafeShelter(from, layerKey, mode);
  routeCache[ck] = out;
  return out;
}
const routeWords = layer => LAYERS[layer].kind === 'depth'
  ? { safe: '浸水後も通れる道', bad: `浸水${ROUTE_DEPTH_LIMIT}m以上の想定` }
  : { safe: '特別警戒区域を通らない道', bad: '土砂災害の特別警戒区域' };
function drawRoutes(R, group) {
  if (!R || R.error) return;
  L.polyline(R.fast.pts, { color: '#0017c1', weight: 4, dashArray: '8 8', opacity: .9, interactive: false }).addTo(group);
  for (const seg of R.fast.deep) L.polyline(seg, { color: '#ce0000', weight: 8, opacity: .8, interactive: false }).addTo(group);
  if (R.safe) L.polyline(R.safe.pts, { color: '#197a4b', weight: 6, opacity: .95, interactive: false }).addTo(group);
  if (R.alt) {
    L.polyline(R.alt.pts, { color: '#197a4b', weight: 6, opacity: .95, interactive: false }).addTo(group);
    L.marker([R.alt.lat, R.alt.lng], { icon: L.divIcon({ className: '', html: `<div class="shel-pin">${ic('check', 'ic s')}</div>`, iconSize: [28, 28] }), pane: 'shelters' })
      .bindTooltip(esc(R.alt.name), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -14] }).addTo(group);
  }
}
function routeErrorText(err) {
  return { far: '5km以上離れているため道のりは計算しません', offline: '道のりの計算には電波が必要<br>ふだんのうちに避難カードに保存しておく',
           roads: '道路のデータを読み込めませんでした', noroad: '近くに道路のデータがありません', noroute: '道路でつながる道のりが見つかりません' }[err] || '道のりを計算できませんでした';
}
function routeSummaryHTML(R) {
  if (R.error) return `<div class="shel-info">${routeErrorText(R.error)}</div>`;
  const w = routeWords(R.layer), same = R.safe && R.fast.deepLen === 0;
  let h = '<div class="routebox">';
  if (same) {
    h += `<div class="route-row"><i class="rl safe"></i><span><b>最短の道</b>${fmtDist(R.fast.len)}・${fmtWalk(R.fast.len)}<br>${w.bad}の区間なし</span></div>`;
  } else {
    const why = R.startBlocked ? '出発地のまわりが通れなくなる想定<br>浸水前に移動するか上の階へ'
              : R.endBlocked ? 'この避難場所のまわりも通れなくなる想定<br>浸水が始まる前に着く必要あり'
              : '見つかりません<br>浸水が始まる前に移動';
    h += `<div class="route-row"><i class="rl safe"></i><span><b>${w.safe}</b>${R.safe ? `${fmtDist(R.safe.len)}・${fmtWalk(R.safe.len)}` : why}</span></div>`;
    if (R.alt) h += `<div class="route-row"><i class="rl safe"></i><span><b>浸水後も道で行ける避難場所</b>${esc(R.alt.name)}　${fmtDist(R.alt.len)}・${fmtWalk(R.alt.len)}</span></div>`;
    h += `<div class="route-row"><i class="rl fast"></i><span><b>最短の道</b>${fmtDist(R.fast.len)}・${fmtWalk(R.fast.len)}<br><span class="deep"><i class="rl deepline"></i>うち約${fmtDist(R.fast.deepLen)}が${w.bad}<br>浸水後は通れない</span></span></div>`;
  }
  return h + `<p class="res-note">1分60mで計算した目安<br>アンダーパス・がれき・通行止めは考慮していません<br>実際に歩いて確かめておきましょう</p></div>`;
}

// ================= 自分の住まい（体感の自分ごと化） =================
const HOME_LABEL = { h1: '平屋', h2: '2階建て', apt: 'マンション・アパート' };
const floorLevel = n => me.home === 'apt' ? 0.5 + 3 * (n - 1) : 0.5 + 2.8 * (n - 1);   // その階の床の高さ（地面から）
const myTopFloor = () => me.home === 'h1' ? 1 : me.home === 'h2' ? 2 : me.floor;
const homeText = () => me.home === 'apt' ? `マンション・アパートの${me.floor}階` : HOME_LABEL[me.home];
function myStory(lo, hi) {
  const F = myTopFloor(), L0 = floorLevel(F), head = L0 + me.height / 100;
  const where = me.home === 'apt' ? `${F}階の自分の部屋` : `家の${F === 1 ? '中' : 'いちばん上の' + F + '階'}`;
  if (lo >= head) return { level: 'red', text: `<b>${where}でも頭の上まで浸水するおそれ</b><br>家の中では命を守れません<br>浸水が始まる前に避難場所へ` };
  if (hi > L0 + 0.3) return { level: 'red', text: `<b>${where}の床の上まで浸水するおそれ</b><br>床の高さ約${fmtM(L0)}　想定${fmtM(lo)}〜${fmtM(hi)}` };
  return { level: 'blue', text: `<b>${where}までは浸水しない想定</b><br>床の高さ約${fmtM(L0)}<br>1階や道路は浸水して外に出られなくなる` };
}
function settingsForm(onDone) {
  let h = me.height, home = me.home, fl = me.floor;
  const render = () => {
    openSheet(`<div class="res-title">自分の住まい</div>
      <p class="res-desc" style="margin:2px 0 6px">入力した内容はこの端末の中だけに保存します</p>
      <label class="lbl">身長</label><div class="numrow"><input class="field" id="meH" type="number" inputmode="numeric" min="90" max="210" value="${h}"><span>cm</span></div>
      <label class="lbl">住まい</label>
      <div class="chipsel">${Object.entries(HOME_LABEL).map(([k, v]) => `<button data-home="${k}" class="${k === home ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${home === 'apt' ? `<label class="lbl">住んでいる階</label><div class="numrow"><input class="field" id="meF" type="number" inputmode="numeric" min="1" max="60" value="${fl}"><span>階</span></div>` : ''}
      <button class="btn-main" id="meSave">これで表示する</button>`);
    $('#meH').oninput = e => h = e.target.value;
    if ($('#meF')) $('#meF').oninput = e => fl = e.target.value;
    document.querySelectorAll('[data-home]').forEach(b => b.onclick = () => { home = b.dataset.home; render(); });
    $('#meSave').onclick = () => {
      me = { height: Math.min(210, Math.max(90, +h || 165)), home, floor: Math.min(60, Math.max(1, Math.round(+fl || 1))) };
      store.set('me', me); store.set('meSet', true); onDone && onDone();
    };
  };
  render();
}

// 水の深さを、自分（身長）と自分の住まいに並べて描く
function depthSVG(lo, hi) {
  const W = 320, H = 180, G = 160, myH = me.height / 100;
  const floors = me.home === 'h1' ? 1 : me.home === 'h2' ? 2 : Math.max(me.floor + 1, 3);
  const storyH = me.home === 'apt' ? 3 : 2.8;
  const bTop = 0.5 + storyH * floors + (me.home === 'apt' ? 0 : 1.4);
  const top = Math.max(7.5, hi * 1.12, Math.min(bTop + 0.6, 40));
  const k = (G - 14) / top, yAt = m => G - m * k;
  const hx = me.home === 'apt' ? 170 : 160, hw = me.home === 'apt' ? 92 : 100;
  let bld = '';
  if (me.home === 'apt') {
    const wallTop = yAt(0.5 + storyH * floors);
    bld += `<rect x="${hx}" y="${wallTop}" width="${hw}" height="${G - wallTop}" fill="#fff" stroke="#666666" stroke-width="1.5"/>`;
    for (let f = 1; f <= floors; f++) {
      const y0 = yAt(floorLevel(f)), y1 = yAt(floorLevel(f) + storyH);
      if (y1 < 0) break;
      const mine = f === me.floor;
      if (mine) bld += `<rect x="${hx + 1}" y="${y1}" width="${hw - 2}" height="${y0 - y1}" fill="#fff0b3"/>`;
      bld += `<line x1="${hx}" y1="${y0}" x2="${hx + hw}" y2="${y0}" stroke="#949494" stroke-width="1"/>`;
      if (y0 - y1 > 9 && (f <= 3 || mine || f === floors)) bld += `<text x="${hx + hw + 4}" y="${(y0 + y1) / 2 + 4}" font-size="10" fill="${mine ? '#927200' : '#4d4d4d'}" font-weight="${mine ? 700 : 400}">${f}階${mine ? '（自分）' : ''}</text>`;
    }
  } else {
    const wallTop = yAt(0.5 + storyH * floors), roof = yAt(0.5 + storyH * floors + 1.4);
    bld += `<g stroke="#666666" stroke-width="1.5" fill="#fff"><rect x="${hx}" y="${wallTop}" width="${hw}" height="${G - wallTop}"/>
      <path d="M${hx - 8} ${wallTop} L${hx + hw / 2} ${roof} L${hx + hw + 8} ${wallTop} Z" fill="#f2f2f2"/></g>`;
    for (let f = 1; f <= floors; f++) {
      const y0 = yAt(floorLevel(f));
      bld += `<line x1="${hx}" y1="${y0}" x2="${hx + hw}" y2="${y0}" stroke="#949494" stroke-dasharray="3 3"/>
              <text x="${hx + hw + 4}" y="${yAt(floorLevel(f) + 1.2)}" font-size="10" fill="#4d4d4d">${f}階</text>`;
    }
  }
  const px = 82, ph = myH * k;
  const person = `<g fill="#333333"><circle cx="${px}" cy="${G - ph + ph * 0.09}" r="${ph * 0.09}"/>
      <rect x="${px - ph * 0.085}" y="${G - ph + ph * 0.2}" width="${ph * 0.17}" height="${ph * 0.42}" rx="${ph * 0.05}"/>
      <rect x="${px - ph * 0.08}" y="${G - ph * 0.4}" width="${ph * 0.07}" height="${ph * 0.4}"/>
      <rect x="${px + ph * 0.01}" y="${G - ph * 0.4}" width="${ph * 0.07}" height="${ph * 0.4}"/></g>
      <text x="${px + ph * 0.16 + 2}" y="${G - ph + 6}" font-size="10" fill="#4d4d4d">${store.get('meSet', false) ? '自分' : '人'} ${me.height}cm</text>`;
  const water = `<rect x="0" y="${yAt(hi)}" width="${W}" height="${G - yAt(hi)}" fill="#39abff" opacity=".22"/>
      <rect x="0" y="${yAt(lo)}" width="${W}" height="${G - yAt(lo)}" fill="#39abff" opacity=".38"/>
      <line x1="0" y1="${yAt(hi)}" x2="${W}" y2="${yAt(hi)}" stroke="#0066be" stroke-width="2"/>
      <text x="8" y="${yAt(hi) - 5}" font-size="12" font-weight="700" fill="#0066be">最大 ${hi >= 24 ? '20m以上' : hi + 'm'}</text>`;
  return `<svg class="depthviz" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="浸水の深さと、自分・自分の住まいの比較">
    <rect width="${W}" height="${H}" fill="#f2f2f2"/>${bld}${person}${water}
    <line x1="0" y1="${G}" x2="${W}" y2="${G}" stroke="#666666" stroke-width="2"/><rect x="0" y="${G}" width="${W}" height="${H - G}" fill="#e6e6e6"/></svg>`;
}

// ================= 地点を調べる =================
let lastTap = null, tapMarker = null, inspectSeq = 0, lastResult = null;
function depthWords(hi) {
  if (hi <= 0.5) return '大人のひざくらいまで<br>床下浸水のおそれ';
  if (hi <= 1)   return '大人の腰の高さまで<br>1階が床上浸水するおそれ';
  if (hi <= 3)   return '1階の天井近くまで<br>1階が水につかるおそれ';
  if (hi <= 5)   return '2階の床の上まで浸水するおそれ';
  if (hi <= 10)  return '2階建ての屋根をこえる深さ';
  if (hi <= 20)  return '4〜6階建てに相当する深さ';
  return '7階建て以上に相当する深さ';
}
const coarseNote = z => z !== undefined && z <= PREF_MAX_Z ? `<p class="res-note">電波がないため県全体の概略地図で判定<br>境界付近は誤差があります</p>` : '';
const outsideNote = `<p class="res-note">色のない場所も安全とは限りません<br>国や県の想定がない小さな川や下水の浸水は含まれていません</p>`;

let shelterPromise = Promise.resolve();
async function inspect(latlng, opts = {}) {
  lastTap = latlng;
  const seq = ++inspectSeq;
  store.set('hinted', true); $('#startHint').hidden = true;
  if (!tapMarker) tapMarker = L.circleMarker(latlng, { radius: 9, color: '#fff', weight: 3, fillColor: '#ce0000', fillOpacity: 1 }).addTo(map);
  else tapMarker.setLatLng(latlng);
  routeGroup.clearLayers(); routeLines.clearLayers();
  const m = muniAt(latlng.lat, latlng.lng);
  const place = opts.label || (m ? m.properties.name : '');
  openSheet(`<div class="res-place">${esc(place)}</div><div class="spinner"></div>`);
  keepPointVisible(latlng);

  const elev = await elevation(latlng.lat, latlng.lng);
  if (seq !== inspectSeq) return;
  if (elev.state === 'sea') {
    openSheet(`<div class="res-place">${esc(place)}</div><p class="res-depth neutral">ここは海の上です</p><p class="res-desc">陸の上をタップしてください</p>`);
    return;
  }
  const l = LAYERS[activeLayer];
  const res = { lat: latlng.lat, lng: latlng.lng, place: place || '選んだ地点', layer: activeLayer, elev: elev.state === 'land' ? elev.h : null };
  // 1段目：知る・体感する（一度にそろえてから表示＝あとから画面がずれない）
  let top = `<div class="res-place">${esc(place)}${res.elev !== null ? `　海抜 約${fmtM(Math.max(0, res.elev))}` : ''}</div>
             <div class="res-title">${esc(l.title)}</div>`;
  let compact = '';
  if (l.kind === 'depth') {
    const [r, dur, hanran, kagan] = await Promise.all([
      sample(l.paths[0], latlng.lat, latlng.lng),
      activeLayer === 'flood' ? sample(L_KEIZOKU, latlng.lat, latlng.lng) : null,
      activeLayer === 'flood' ? sample(L_HANRAN, latlng.lat, latlng.lng) : null,
      activeLayer === 'flood' ? sample(L_KAGAN, latlng.lat, latlng.lng) : null,
    ]);
    if (seq !== inspectSeq) return;
    if (r.state === 'hit') {
      const d = classifyDepth(r.rgba);
      if (d) {
        res.depth = d[3]; res.lo = d[4]; res.hi = d[5];
        top += `<p class="res-depth">${d[3]}</p><p class="res-desc">${depthWords(d[5])}</p>`;
        top += depthSVG(d[4], d[5]);
        if (store.get('meSet', false)) {
          const st = myStory(d[4], d[5]);
          top += `<div class="mine"><h4><span>自分の家（${esc(homeText())}）だと</span><button class="edit" id="editMe">住まいを変える</button></h4>${st.text}</div>`;
        } else {
          top += `<div class="ask"><b>自分の家で見る</b>身長と住まいを入れると図と説明が自分の家に合わせて変わります<br><button class="btn-sub" id="askMe">${ic('house')}住まいを入れる</button></div>`;
        }
      } else top += `<p class="res-depth">浸水の想定あり</p><p class="res-desc">深さの区分を読み取れませんでした</p>`;
      top += coarseNote(r.z);
    } else if (r.state === 'none') {
      top += `<p class="res-depth neutral">${esc(l.label)}の想定区域に入っていません</p>${outsideNote}${coarseNote(r.z)}`;
    } else {
      top += `<p class="res-depth unknown">判定できません</p><p class="res-desc">電波がなくこの地域の地図も保存されていません</p>`;
    }
    if (hanran?.state === 'hit' || kagan?.state === 'hit') {
      res.kaoku = true;
      compact += `<div class="alert red" role="alert"><div class="ah">${ic('triangle-alert')}家ごと流される・倒れるおそれのある区域</div>2階に上がるのではなく<b>区域の外へ避難</b></div>`;
    }
    if (dur?.state === 'hit') {
      const c = classifyDuration(dur.rgba);
      if (c) { res.duration = c[3]; compact += `<div class="alert blue"><div class="ah">${ic('info')}水が引くまで${c[3]}</div>${c[4] >= 24 ? '電気・水道・トイレが使えず家から出られなくなるおそれ' : 'その間は外に出られません'}</div>`; }
    }
  } else {
    const hits = await doshaAt(latlng.lat, latlng.lng);
    if (seq !== inspectSeq) return;
    if (hits.length) {
      const special = hits.some(h => h.special), planned = hits.every(h => h.planned);
      res.depth = special ? '土砂災害特別警戒区域' : '土砂災害警戒区域';
      top += `<p class="res-depth" style="color:${special ? '#ce0000' : '#927200'}">${special ? '特別警戒区域' : '警戒区域'}${planned ? '（指定予定）' : ''}</p>
              <p class="res-desc">${hits.map(h => esc(h.name)).join('・')}のおそれがある区域${special ? '<br>建物がこわれ命に危険がおよぶおそれ' : ''}</p>`;
    } else {
      top += `<p class="res-depth neutral">土砂災害警戒区域に入っていません</p><p class="res-note">がけや山のそばでは区域外でも大雨に注意</p>`;
    }
  }
  lastResult = res;
  // 2段目：くわしく見る（避難場所・ほかの災害など）
  const html = top + (compact ? `<div class="compact">${compact}</div>` : '') +
    `<button class="btn-main" id="makeCard">この場所の避難カードをつくる</button>
     <details class="more" id="more"><summary><span>くわしく見る</span><small id="moreSum">近くの避難場所・ほかの災害</small></summary>
       <div class="block" id="shelters" style="border-top:0;margin-top:0;padding-top:0"><div class="spinner"></div></div>
       <div class="block" id="othersBlock" hidden><h4>ほかの災害</h4><div class="others" id="others" style="margin-top:0"></div></div>
       <p class="res-note">${esc(l.note)}<br>避難の判断は市町村の発表に従ってください</p>
       <button class="btn-line" id="savePlaceHere">この周りの地図を端末に保存</button>
     </details>`;
  openSheet(html);
  keepPointVisible(latlng);
  if ($('#editMe')) $('#editMe').onclick = () => settingsForm(() => inspect(latlng, opts));
  if ($('#askMe')) $('#askMe').onclick = () => settingsForm(() => inspect(latlng, opts));
  $('#makeCard').onclick = () => startCardFlow(L.latLng(lastResult.lat, lastResult.lng));
  $('#savePlaceHere').onclick = () => openSaveSheet(latlng);
  shelterPromise = renderShelters(latlng, seq, { originHi: res.hi || 0 });
  Promise.all([shelterPromise, summarizeOthers(latlng, seq)]).then(() => {
    if (seq !== inspectSeq || !$('#moreSum')) return;
    const n = lastShelters.length, o = (lastResult && lastResult.others) || [];
    $('#moreSum').textContent = `近くの避難場所 ${n}か所${o.length ? `・ほかの災害 ${o.length}件` : ''}`;
  });
}
async function summarizeOthers(latlng, seq) {
  const tags = [];
  for (const [key, l] of Object.entries(LAYERS)) {
    if (key === activeLayer) continue;
    if (l.kind === 'depth') { const r = await sample(l.paths[0], latlng.lat, latlng.lng); if (r.state === 'hit') { const d = classifyDepth(r.rgba); tags.push(`${l.label} ${d ? d[3] : 'あり'}`); } }
    else { const h = await doshaAt(latlng.lat, latlng.lng); if (h.length) tags.push(`${l.label} ${h.some(x => x.special) ? '特別警戒区域' : '警戒区域'}`); }
  }
  const n = await sample(L_NAISUI, latlng.lat, latlng.lng);
  if (n.state === 'hit') { const d = classifyDepth(n.rgba); tags.push(`下水があふれる浸水 ${d ? d[3] : 'あり'}`); }
  if (seq !== inspectSeq) return;
  if (lastResult) lastResult.others = tags;
  const el = $('#others');
  if (el && tags.length) { el.innerHTML = tags.map(t => `<span>${esc(t)}</span>`).join(''); $('#othersBlock').hidden = false; }
}

// ================= 結果シート =================
function keepPointVisible(latlng) {
  const sh = $('#sheet'); if (sh.hidden) return;
  const top = 110, visibleBottom = window.innerHeight - sh.offsetHeight;
  if (visibleBottom - top < 80) return;
  const want = top + (visibleBottom - top) * 0.5, cp = map.latLngToContainerPoint(latlng);
  if (Math.abs(cp.y - want) > 24 || cp.x < 30 || cp.x > window.innerWidth - 30) map.panBy([cp.x - window.innerWidth / 2, cp.y - want], { animate: true, duration: 0.3 });
}
function openSheet(html, mode) {
  $('#sheetBody').innerHTML = html;
  const s = $('#sheet'); s.hidden = false; s.scrollTop = 0;
  s.classList.toggle('full', mode === 'full'); s.classList.remove('peek');
  document.body.classList.add('sheet-open');
}
function closeSheet() {
  $('#sheet').hidden = true; document.body.classList.remove('sheet-open');
  lastTap = null; inspectSeq++; routeGroup.clearLayers(); routeLines.clearLayers();
  if (tapMarker) { map.removeLayer(tapMarker); tapMarker = null; }
}
$('#sheetClose').onclick = () => flow.step ? endFlow() : closeSheet();
(() => {     // つまみ：タップで大きさを切り替え、下に引くとたたむ・閉じる
  const g = $('#grab'), s = $('#sheet');
  let y0 = null, moved = 0;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; moved = 0; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', e => { if (y0 !== null) moved = e.clientY - y0; });
  g.addEventListener('pointerup', () => {
    if (y0 === null) return; y0 = null;
    if (Math.abs(moved) < 8) { const full = s.classList.contains('full'); s.classList.toggle('full', !full); s.classList.remove('peek'); return; }
    if (moved > 0) { if (s.classList.contains('peek')) closeSheet(); else if (s.classList.contains('full')) s.classList.remove('full'); else s.classList.add('peek'); }
    else { if (s.classList.contains('peek')) s.classList.remove('peek'); else s.classList.add('full'); }
  });
})();
map.on('click', e => { $('#legend').hidden = true; if (flow.step === 1) { setHome(e.latlng); return; } if (flow.step > 1) return; inspect(e.latlng); });
map.on('contextmenu', e => { if (!flow.step) openSaveSheet(e.latlng); });

// ================= 現在地 =================
let meMarker = null;
$('#btnLocate').onclick = () => {
  if (!navigator.geolocation) return toast('この端末では現在地を取得できません');
  toast('現在地を取得しています…', 1500);
  navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }) }).addTo(map);
    else meMarker.setLatLng(ll);
    map.setView(ll, Math.max(map.getZoom(), 16));
    inspect(L.latLng(ll), { label: '現在地' });
  }, () => toast('現在地を取得できませんでした\n位置情報の許可を確認してください'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
};

// ================= 検索 =================
let searchTimer = null;
function openSearch() { $('#search').hidden = false; $('#searchInput').focus(); renderSearch(''); }
function closeSearch() { $('#search').hidden = true; $('#searchInput').blur(); }
$('#btnSearch').onclick = openSearch;
$('#searchClose').onclick = closeSearch;
$('#searchInput').addEventListener('input', e => { clearTimeout(searchTimer); const q = e.target.value.trim(); searchTimer = setTimeout(() => renderSearch(q), 350); });
async function renderSearch(q) {
  const ul = $('#searchResults');
  if (!q) { ul.innerHTML = `<li class="rhead">住所や学校・公民館などの名前で探せます</li>`; return; }
  const items = [];
  for (const f of munis) if (f.properties.name.includes(q)) { const b = f.properties.bbox; items.push({ t: f.properties.name, s: '市町村', bounds: [[b[1], b[0]], [b[3], b[2]]] }); }
  for (const s of shelters) if (s[0].includes(q)) { items.push({ t: s[0], s: s[1] + '（避難場所）', ll: [s[2], s[3]] }); if (items.length > 12) break; }
  let html = items.length ? `<li class="rhead">この中から</li>` + items.slice(0, 10).map((it, i) => `<li data-i="l${i}"><b>${esc(it.t)}</b><small>${esc(it.s)}</small></li>`).join('') : '';
  ul.innerHTML = html + (navigator.onLine ? `<li class="rhead">住所を探しています…</li>` : `<li class="rhead">電波がないため住所の検索はできません</li>`);
  bindResults(items, []);
  if (!navigator.onLine) return;
  let addr = [];
  try {
    const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
    addr = (await r.json()).slice(0, 8).map(a => ({ t: a.properties.title, s: '住所', ll: [a.geometry.coordinates[1], a.geometry.coordinates[0]] }));
  } catch {}
  if ($('#searchInput').value.trim() !== q) return;
  html += addr.length ? `<li class="rhead">住所</li>` + addr.map((it, i) => `<li data-i="a${i}"><b>${esc(it.t)}</b><small>番地まで一致しないことがあります</small></li>`).join('') : `<li class="rhead">住所が見つかりませんでした</li>`;
  ul.innerHTML = html;
  bindResults(items, addr);
}
function bindResults(items, addr) {
  document.querySelectorAll('#searchResults li[data-i]').forEach(li => li.onclick = () => {
    const k = li.dataset.i, it = k[0] === 'l' ? items[+k.slice(1)] : addr[+k.slice(1)];
    closeSearch();
    if (it.bounds) { map.fitBounds(it.bounds); return; }
    if (flow.step === 1) { setHome(it.ll, 18); return; }
    map.setView(it.ll, 17);
    inspect(L.latLng(it.ll[0], it.ll[1]), { label: it.t });
  });
}

// ================= 避難カード =================
// ================= 避難カード（3つの手順でつくる） =================
const EVENT_WORD = { flood: '大雨', dosha: '大雨', tsunami: '津波', takashio: '台風' };
const BAD_WORD = { depth: '早めに水につかる', zone: '土砂災害のおそれがある' };
const walkMin = m => Math.max(1, Math.round(m / WALK_M_PER_MIN));
const flow = { step: 0, token: 0, home: null, pin: null, res: null, cands: null, canStay: false, choice: 0, timing: 'l3', name: '自宅', saveMap: true, layer: 'flood', mode: 'walk', picking: false, q: '' };
const moveText = (mode, len) => mode === 'car' ? `車で約${(len / 1000).toFixed(1)}km` : `歩いて約${walkMin(len)}分`;

async function analyzeHome(lat, lng, layerKey) {
  const l = LAYERS[layerKey], res = { layer: layerKey };
  if (l.kind === 'depth') {
    const isFlood = layerKey === 'flood';
    const [r, dur, h1, h2] = await Promise.all([
      sample(l.paths[0], lat, lng),
      isFlood ? sample(L_KEIZOKU, lat, lng) : null, isFlood ? sample(L_HANRAN, lat, lng) : null, isFlood ? sample(L_KAGAN, lat, lng) : null,
    ]);
    if (r.state === 'hit') { const d = classifyDepth(r.rgba); if (d) { res.depth = d[3]; res.lo = d[4]; res.hi = d[5]; } }
    if (dur?.state === 'hit') { const c = classifyDuration(dur.rgba); if (c) { res.duration = c[3]; res.durH = c[4]; } }
    res.kaoku = h1?.state === 'hit' || h2?.state === 'hit';
  } else {
    const hits = await doshaAt(lat, lng);
    if (hits.length) res.dosha = hits.some(h => h.special) ? '特別警戒区域' : '警戒区域';
  }
  return res;
}

// カードの文（アプリの画面なので句読点を使わず、短い言葉を行で分ける）
const cardWhen = card => TIMINGS.find(x => x.id === card.timing)?.t || '';
const cardWhat = card => card.stay ? `家の${card.stay}階へ` : `${card.dest ? card.dest.t : '避難場所'}へ${card.mode === 'car' ? '車で' : ''}避難`;
const cardMain = card => `${cardWhen(card)}\n${cardWhat(card)}`;
function cardSubLines(card) {
  if (card.stay) return ['水と食べもの・明かりを用意しておく'];
  const rt = card.route;
  if (!rt) return card.dest ? [card.mode === 'car' ? 'ふだんのうちに道を確かめておく' : 'ふだんのうちに道を歩いて確かめておく'] : [];
  const depth = LAYERS[rt.layer].kind === 'depth', car = rt.mode === 'car', m = moveText(rt.mode, rt.len);
  const carNotes = car ? ['冠水した道には入らず引き返す', 'アンダーパスは通らない', '避難先に車を停められるか確かめておく'] : [];
  if (rt.safe && rt.detour) return [m, depth ? '近道は先に浸水するので緑の道を通る' : '近道は土砂災害のおそれがあるので緑の道を通る', ...carNotes];
  if (rt.safe) return [m, ...carNotes];
  return [m, depth ? '赤い道は先に浸水するので雨が強まる前に出る' : '赤い道は土砂災害のおそれがあるので早めに出る', ...carNotes];
}
function cardRiskLines(card) {
  const r = card.risk || {}, l = LAYERS[card.layer], n = card.name;
  if (l.kind === 'zone') return [r.dosha ? `${n}のあたりは土砂災害の${r.dosha}` : `${n}のあたりは土砂災害警戒区域の外`];
  const cause = { flood: '洪水で', tsunami: '津波で', takashio: '高潮で' }[card.layer];
  const out = [r.depth ? `${n}のあたりは${cause}${r.depth}浸水する想定` : `${n}のあたりは${l.label}の想定区域の外`];
  if (r.duration) out.push(`水が引くまで${r.duration}`);
  if (r.kaoku) out.push('家ごと流されるおそれのある区域');
  return out;
}

// ---------- 手順の画面 ----------
const homeIcon = () => L.divIcon({ className: '', html: `<div class="home-pin">${ic('house', 'ic s')}</div>`, iconSize: [40, 40], iconAnchor: [20, 40] });
function startCardFlow(latlng) {
  closeRouteView();
  $('#cardPanel').hidden = true; $('#startHint').hidden = true; $('#legend').hidden = true;
  Object.assign(flow, { step: 1, token: flow.token + 1, layer: activeLayer, home: latlng || map.getCenter(), res: null, cands: null, choice: 0, timing: 'l3', name: '自宅', mode: 'walk', picking: false, q: '', pickedList: [] });
  routeGroup.clearLayers(); routeLines.clearLayers();
  if (tapMarker) { map.removeLayer(tapMarker); tapMarker = null; }
  if (flow.pin) map.removeLayer(flow.pin);
  flow.pin = L.marker(flow.home, { draggable: true, icon: homeIcon(), zIndexOffset: 3000 }).addTo(map);
  flow.pin.on('dragend', () => { flow.home = flow.pin.getLatLng(); });
  map.setView(flow.home, Math.max(map.getZoom(), 17));
  renderFlow();
}
function endFlow() {
  flow.step = 0; flow.token++;
  if (flow.pin) { map.removeLayer(flow.pin); flow.pin = null; }
  routeGroup.clearLayers(); routeLines.clearLayers();
  $('#sheet').classList.remove('flowsheet');
  closeSheet();
}
function setHome(ll, zoom) { flow.home = L.latLng(ll); flow.pin.setLatLng(flow.home); map.setView(flow.home, zoom || Math.max(map.getZoom(), 17)); }

function renderFlow() {
  const head = (no, back) => `<div class="flow-head"><span class="flow-no">${no} / 3</span><button class="textbtn" id="${back ? 'flowBack' : 'flowCancel'}">${back ? '戻る' : 'やめる'}</button></div>`;
  let html = '';
  if (flow.step === 1) {
    html = head(1) + `<h3 class="flow-title">自宅の場所</h3>
      <p class="res-desc">ピンを動かすか地図をタップして自宅の位置に合わせてください</p>
      <div class="flow-row"><button class="btn-sub" id="fLoc">現在地にする</button><button class="btn-sub" id="fSearch">住所で探す</button></div>
      <button class="btn-main" id="fNext1">この場所にする</button>`;
  } else if (flow.step === 2 && flow.picking) {
    html = head(2, true) + `<h3 class="flow-title">ほかの避難場所から選ぶ</h3>
      <input class="field" id="fPickQ" type="search" placeholder="名前で絞り込む" value="${esc(flow.q)}" autocomplete="off">
      <p class="res-note">地図の緑の点をタップしても選べます</p>
      <ul class="results" id="fPickList"></ul>`;
  } else if (flow.step === 2) {
    const kind = LAYERS[flow.layer].kind, car = flow.mode === 'car';
    html = head(2, true) + `<h3 class="flow-title">避難先</h3>
      <div class="seg" role="radiogroup" aria-label="移動のしかた"><button data-mode="walk" class="${car ? '' : 'on'}">歩く</button><button data-mode="car" class="${car ? 'on' : ''}">車</button></div>
      ${car ? `<p class="res-note">${flow.layer === 'tsunami' ? '津波のときは原則として歩いて避難します<br>' : ''}車は浸水が少しでも想定される道を避け　細い道はなるべく使わずに調べます</p>` : ''}`;
    if (!flow.cands) {
      html += `<p class="res-desc">近くの避難場所までの道を調べています<br>10秒ほどかかります</p><div class="spinner"></div>`;
    } else {
      if (flow.cands.length && !flow.cands.some(c => c.safe))
        html += `<p class="res-note">${kind === 'depth' ? '浸水してからではどの避難場所にも道でたどり着けない想定<br>雨が強まる前に出る前提で選んでください' : 'どの避難場所へも土砂災害のおそれがある道を通る想定<br>早めに出る前提で選んでください'}</p>`;
      const recIdx = flow.cands.findIndex(c => c.safe && !c.picked);
      html += `<div class="optlist">` + flow.cands.map((c, i) => {
        const why = !c.R ? (c.err === 'far' ? `直線で約${(c.len / 1000).toFixed(1)}km　遠いため道のりは調べていません` : routeErrorText(c.err))
          : c.safe ? `${kind === 'depth' ? '浸水しても通れる道あり' : '危ない場所を通らずに行ける'}　${moveText(flow.mode, c.len)}`
          : `${kind === 'depth' ? '途中の道が先に浸水' : '途中に土砂災害のおそれ'}　早く出れば${moveText(flow.mode, c.len)}`;
        return `<button class="opt ${flow.choice === i ? 'on' : ''}" data-c="${i}"><span class="dot"></span><span><b>${esc(c.name)}${i === recIdx ? '<em class="rec">おすすめ</em>' : ''}${c.picked ? '<em class="picked">自分で選んだ場所</em>' : ''}</b><small>${esc(why)}</small></span></button>`;
      }).join('') + (flow.canStay ? `<button class="opt ${flow.choice === 'stay' ? 'on' : ''}" data-c="stay"><span class="dot"></span><span><b>家の${myTopFloor()}階に上がる</b><small>${myTopFloor()}階までは浸水しない想定</small></span></button>` : '') + `</div>
        <button class="addbtn" id="fPick">${ic('search')}ほかの避難場所から選ぶ</button>`;
      if (!flow.cands.length && !flow.canStay) html += `<p class="res-desc">近くに対応する避難場所が見つかりませんでした</p>`;
      html += `<button class="btn-main" id="fNext2" ${flow.cands.length || flow.canStay ? '' : 'disabled'}>この避難先にする</button>`;
    }
  } else if (flow.step === 3) {
    const covered = Object.values(saved).some(p => p.kind === 'place' && p.done && distM(p.lat, p.lon, flow.home.lat, flow.home.lng) < p.r * 1000 - 800);
    flow.covered = covered;
    html = head(3, true) + `<h3 class="flow-title">逃げ始めるとき</h3>
      <div class="optlist">${TIMINGS.map(o => `<button class="opt ${o.id === flow.timing ? 'on' : ''}" data-t="${o.id}"><span class="dot"></span><span><b>${esc(o.t)}</b><small>${esc(o.s)}</small></span></button>`).join('')}</div>
      <label class="lbl" for="fName">場所の名前</label><input class="field" id="fName" value="${esc(flow.name)}" maxlength="16">
      ${covered ? '' : `<label class="check"><input type="checkbox" id="fSave" ${flow.saveMap ? 'checked' : ''}><span>まわり2kmの地図も保存して電波がなくても見られるようにする<br><small>4MBほど　Wi‑Fiのときがおすすめ</small></span></label>`}
      <button class="btn-main" id="fMake">カードをつくる</button>`;
  }
  openSheet(html);
  $('#sheet').classList.add('flowsheet');
  if ($('#flowCancel')) $('#flowCancel').onclick = endFlow;
  if ($('#flowBack')) $('#flowBack').onclick = () => { if (flow.picking) { flow.picking = false; renderFlow(); drawFlowChoice(); return; } flow.step--; if (flow.step === 1) { routeGroup.clearLayers(); routeLines.clearLayers(); flow.token++; } renderFlow(); if (flow.step === 2) drawFlowChoice(); };
  if (flow.step === 1) {
    $('#fLoc').onclick = () => navigator.geolocation?.getCurrentPosition(p => setHome([p.coords.latitude, p.coords.longitude], 18), () => toast('現在地を取得できませんでした'), { enableHighAccuracy: true, timeout: 12000 });
    $('#fSearch').onclick = openSearch;
    $('#fNext1').onclick = () => { flow.home = flow.pin.getLatLng(); flow.step = 2; flow.cands = null; renderFlow(); computeCandidates(); };
  }
  if (flow.step === 2 && flow.picking) {
    renderPickList();
    $('#fPickQ').oninput = e => { flow.q = e.target.value.trim(); renderPickList(); };
  } else if (flow.step === 2) {
    document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { flow.choice = b.dataset.c === 'stay' ? 'stay' : +b.dataset.c; renderFlow(); drawFlowChoice(); });
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (flow.mode === b.dataset.mode) return; flow.mode = b.dataset.mode; flow.cands = null; renderFlow(); computeCandidates(); });
    if ($('#fPick')) $('#fPick').onclick = () => { flow.picking = true; flow.q = ''; renderFlow(); routeLines.clearLayers(); };
    if ($('#fNext2')) $('#fNext2').onclick = () => { flow.step = 3; renderFlow(); };
  }
  if (flow.step === 3) {
    document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { flow.timing = b.dataset.t; renderFlow(); });
    $('#fName').oninput = e => flow.name = e.target.value;
    if ($('#fSave')) $('#fSave').onchange = e => flow.saveMap = e.target.checked;
    $('#fMake').onclick = makeCard;
  }
}
async function computeCandidates() {
  const tok = ++flow.token, h = flow.home, l = LAYERS[flow.layer];
  if (!navigator.onLine) { flow.cands = []; flow.res = await analyzeHome(h.lat, h.lng, flow.layer); toast('避難先までの道を調べるには電波が必要です'); renderFlow(); return; }
  const res = await analyzeHome(h.lat, h.lng, flow.layer);
  const near = await pickShelters(h.lat, h.lng, l.shelterBit);
  const list = []; let alt = null;
  for (const n of near) {
    const R = await computeRoutes({ lat: h.lat, lng: h.lng }, { lat: n.s[2], lng: n.s[3] }, flow.layer, flow.mode);
    if (tok !== flow.token) return;
    if (R.error) { list.push({ name: n.s[0], lat: n.s[2], lng: n.s[3], R: null, err: R.error, safe: false, len: n.d }); continue; }
    if (R.alt && !alt) alt = R.alt;
    list.push({ name: n.s[0], lat: n.s[2], lng: n.s[3], R, safe: !!R.safe, len: R.safe ? R.safe.len : R.fast.len });
  }
  if (alt) {
    const altR = { layer: flow.layer, mode: flow.mode, fast: { len: alt.len, pts: alt.pts, deepLen: 0, deep: [] }, safe: { len: alt.len, pts: alt.pts }, alt: null };
    const same = list.find(c => c.name === alt.name);
    if (same) Object.assign(same, { R: altR, safe: true, len: alt.len }); else list.push({ name: alt.name, lat: alt.lat, lng: alt.lng, R: altR, safe: true, len: alt.len });
  }
  list.sort((a, b) => (b.safe - a.safe) || (!!b.R - !!a.R) || (a.len - b.len));
  for (const p of flow.pickedList || []) {                  // 自分で選んだ場所は、移動手段を変えても残す
    if (list.some(c => c.name === p.name)) continue;
    const R = await computeRoutes({ lat: h.lat, lng: h.lng }, { lat: p.lat, lng: p.lng }, flow.layer, flow.mode);
    if (tok !== flow.token) return;
    list.unshift(R.error ? { ...p, picked: true, R: null, err: R.error, safe: false, len: distM(h.lat, h.lng, p.lat, p.lng) }
                         : { ...p, picked: true, R, safe: !!(R.safe || R.alt && R.alt.name === p.name), len: R.safe ? R.safe.len : R.fast.len });
  }
  if (tok !== flow.token) return;
  flow.res = res; flow.cands = list; flow.choice = list.length ? 0 : 'stay';
  flow.canStay = res.hi !== undefined && !res.kaoku && res.hi <= floorLevel(myTopFloor()) && !(res.durH >= 168);
  if (!list.length && !flow.canStay) flow.choice = 0;
  renderFlow(); drawFlowChoice();
}
function toCardRoute(c) {
  const R = c.R; if (!R) return null;
  const mode = R.mode || 'walk';
  if (c.safe && R.safe) return { layer: R.layer, mode, safe: true, len: R.safe.len, pts: R.safe.pts, deep: R.fast.deepLen > 0 ? R.fast.deep : [], detour: R.fast.deepLen > 0 };
  return { layer: R.layer, mode, safe: false, len: R.fast.len, pts: R.fast.pts, deep: R.fast.deep, detour: false };
}
// ほかの避難場所の一覧（近い順・名前で絞り込み）
function renderPickList() {
  const ul = $('#fPickList'); if (!ul) return;
  const h = flow.home, bit = LAYERS[flow.layer].shelterBit, q = flow.q;
  const list = shelters.filter(s => (s[4] & bit) && (!q || s[0].includes(q) || s[1].includes(q)))
    .map(s => ({ s, d: distM(h.lat, h.lng, s[2], s[3]) })).sort((a, b) => a.d - b.d).slice(0, 40);
  ul.innerHTML = list.length ? list.map((x, i) => `<li data-p="${i}"><b>${esc(x.s[0])}</b><small>${esc(x.s[1])}　直線で約${(x.d / 1000).toFixed(1)}km</small></li>`).join('')
    : '<li class="rhead">見つかりませんでした</li>';
  ul.querySelectorAll('[data-p]').forEach(li => li.onclick = () => pickShelter(list[+li.dataset.p].s));
}
async function pickShelter(s) {
  const p = { name: s[0], lat: s[2], lng: s[3] };
  flow.pickedList = [...(flow.pickedList || []).filter(x => x.name !== p.name), p];
  flow.picking = false;
  const existing = flow.cands.findIndex(c => c.name === p.name);
  if (existing >= 0) { flow.choice = existing; renderFlow(); drawFlowChoice(); return; }
  openSheet(`<div class="flow-head"><span class="flow-no">2 / 3</span></div><h3 class="flow-title">${esc(p.name)}</h3><p class="res-desc">道を調べています</p><div class="spinner"></div>`);
  const h = flow.home, tok = flow.token;
  const R = await computeRoutes({ lat: h.lat, lng: h.lng }, { lat: p.lat, lng: p.lng }, flow.layer, flow.mode);
  if (tok !== flow.token) return;
  flow.cands.unshift(R.error ? { ...p, picked: true, R: null, err: R.error, safe: false, len: distM(h.lat, h.lng, p.lat, p.lng) }
                             : { ...p, picked: true, R, safe: !!R.safe, len: R.safe ? R.safe.len : R.fast.len });
  flow.choice = 0;
  renderFlow(); drawFlowChoice();
}
function drawCardRoute(rt, group) {
  if (!rt) return;
  for (const seg of rt.deep || []) L.polyline(seg, { color: '#ce0000', weight: 8, opacity: .75, interactive: false }).addTo(group);
  L.polyline(rt.pts, { color: rt.safe ? '#197a4b' : '#0017c1', weight: 6, opacity: .95, interactive: false }).addTo(group);
}
const destIcon = () => L.divIcon({ className: '', html: `<div class="shel-pin">${ic('check', 'ic s')}</div>`, iconSize: [28, 28] });
function drawFlowChoice() {
  routeGroup.clearLayers(); routeLines.clearLayers();
  if (flow.step !== 2 || !flow.cands || flow.choice === 'stay') return;
  const c = flow.cands[flow.choice]; if (!c) return;
  const rt = toCardRoute(c);
  drawCardRoute(rt, routeLines);
  L.marker([c.lat, c.lng], { icon: destIcon(), pane: 'shelters' }).bindTooltip(esc(c.name), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -14] }).addTo(routeGroup);
  const pts = [[flow.home.lat, flow.home.lng], [c.lat, c.lng], ...(rt ? rt.pts : [])];
  map.fitBounds(L.latLngBounds(pts).pad(0.15), { paddingTopLeft: [0, 110], paddingBottomRight: [0, $('#sheet').offsetHeight] });
}
function makeCard() {
  const c = flow.choice === 'stay' ? null : flow.cands[flow.choice];
  const card = {
    id: Date.now().toString(36), created: Date.now(), name: (flow.name || '自宅').trim() || '自宅',
    lat: +flow.home.lat.toFixed(6), lng: +flow.home.lng.toFixed(6), layer: flow.layer, risk: flow.res || {},
    timing: flow.timing, msg: '', meet: '', me: { ...me }, mode: flow.choice === 'stay' ? 'walk' : flow.mode,
    dest: c ? { t: c.name, lat: c.lat, lng: c.lng } : null, stay: flow.choice === 'stay' ? myTopFloor() : null,
    route: c ? toCardRoute(c) : null,
  };
  cards.unshift(card); store.set('cards', cards.slice(0, 20));
  if (flow.saveMap && !flow.covered) downloadArea('p:' + Date.now().toString(36), { kind: 'place', name: card.name, lat: card.lat, lon: card.lng, r: 2, maxZ: PLACE_MAX_Z });
  endFlow();
  openCards(card.id);
}

// ---------- カード画像（いつ・どこへ を一番上に、経路の地図を入れる） ----------
function wrapText(ctx, text, maxW) {
  // 読点の後ろで区切ったまとまりを、できるだけ行の途中で割らずに並べる（地名・施設名を途中で折らない）
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const chunk of para.split(/(?<=[、。])/)) {
      if (ctx.measureText(line + chunk).width <= maxW) { line += chunk; continue; }
      if (line && ctx.measureText(chunk).width <= maxW) { out.push(line); line = chunk; continue; }
      for (const ch of chunk) {                                   // まとまりが1行に収まらないときだけ文字単位で折る
        if (ctx.measureText(line + ch).width > maxW && line) {
          if (/^[、。，．・」』）〉》】々ーぁぃぅぇぉっゃゅょァィゥェォッャュョ]$/.test(ch)) { out.push(line.slice(0, -1)); line = line.slice(-1) + ch; }
          else { out.push(line); line = ch; }
        } else line += ch;
      }
    }
    out.push(line);
  }
  return out.filter((l, i) => l !== '' || i < out.length - 1);
}
async function loadTileBitmap(url) {
  try { const r = await fetch(url, { mode: 'cors' }); if (!r.ok || r.headers.get('X-HM-Missing') || r.headers.get('X-HM-Empty')) return null; return await createImageBitmap(await r.blob()); } catch { return null; }
}
async function drawRouteMap(g, card, X, Y, W, H) {
  const pts = [[card.lat, card.lng]];
  if (card.dest) pts.push([card.dest.lat, card.dest.lng]);
  if (card.route) pts.push(...card.route.pts);
  const S = 2, pw = W / S, ph = H / S;                  // 地図の文字が読める大きさにするため、2倍に拡大して描く
  let z = 17;
  for (; z > 10; z--) {
    const xs = pts.map(p => lon2x(p[1], z) * 256), ys = pts.map(p => lat2y(p[0], z) * 256);
    if (Math.max(...xs) - Math.min(...xs) < pw - 70 && Math.max(...ys) - Math.min(...ys) < ph - 70) break;
  }
  const xs = pts.map(p => lon2x(p[1], z) * 256), ys = pts.map(p => lat2y(p[0], z) * 256);
  const ox = (Math.max(...xs) + Math.min(...xs)) / 2 - pw / 2, oy = (Math.max(...ys) + Math.min(...ys)) / 2 - ph / 2;
  const tx0 = Math.floor(ox / 256), tx1 = Math.floor((ox + pw) / 256), ty0 = Math.floor(oy / 256), ty1 = Math.floor((oy + ph) / 256);
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#f2f2f2'; g.fillRect(X, Y, W, H);
  const l = LAYERS[card.layer], jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push([tx, ty]);
  const base = await Promise.all(jobs.map(([tx, ty]) => loadTileBitmap(tileUrl(BASE_URL, z, tx, ty))));
  base.forEach((b, i) => { if (b) g.drawImage(b, X + (jobs[i][0] * 256 - ox) * S, Y + (jobs[i][1] * 256 - oy) * S, 256 * S, 256 * S); });
  g.globalAlpha = 0.55;
  for (const p of l.paths) {
    const hz = await Promise.all(jobs.map(([tx, ty]) => loadTileBitmap(tileUrl(hzTpl(p), z, tx, ty))));
    hz.forEach((b, i) => { if (b) g.drawImage(b, X + (jobs[i][0] * 256 - ox) * S, Y + (jobs[i][1] * 256 - oy) * S, 256 * S, 256 * S); });
  }
  g.globalAlpha = 1;
  const P = ([la, lo]) => [X + (lon2x(lo, z) * 256 - ox) * S, Y + (lat2y(la, z) * 256 - oy) * S];
  const line = (arr, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); arr.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  if (card.route) {
    for (const seg of card.route.deep || []) line(seg, 'rgba(206,0,0,.8)', 16);
    line(card.route.pts, '#ffffff', 16); line(card.route.pts, card.route.safe ? '#197a4b' : '#0017c1', 10);
  }
  const label = (x, y, text) => { g.font = `700 28px ${CARD_FONT}`; const w = g.measureText(text).width + 20; g.fillStyle = '#ffffff'; g.fillRect(x - w / 2, y - 66, w, 40); g.strokeStyle = '#333333'; g.lineWidth = 2; g.strokeRect(x - w / 2, y - 66, w, 40); g.fillStyle = '#1a1a1a'; g.fillText(text, x - w / 2 + 10, y - 36); };
  if (card.dest) { const [x, y] = P([card.dest.lat, card.dest.lng]); g.fillStyle = '#197a4b'; g.strokeStyle = '#fff'; g.lineWidth = 5; g.fillRect(x - 18, y - 18, 36, 36); g.strokeRect(x - 18, y - 18, 36, 36); label(x, y - 6, card.dest.t); }
  { const [x, y] = P([card.lat, card.lng]); g.fillStyle = '#0017c1'; g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill(); g.stroke(); label(x, y - 6, card.name); }
  g.restore();
  g.strokeStyle = '#949494'; g.lineWidth = 2; g.strokeRect(X, Y, W, H);
}
const CARD_FONT = '"Noto Sans JP","Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif';
async function renderCardImage(card) {
  const W = 1080, c = document.createElement('canvas'); c.width = W; c.height = 3400;
  const g = c.getContext('2d'), F = CARD_FONT, M = 56, TW = W - M * 2;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, c.height);
  g.fillStyle = '#0017c1'; g.fillRect(0, 0, W, 150);
  g.fillStyle = '#ffffff'; g.font = `700 56px ${F}`; g.fillText(`${EVENT_WORD[card.layer] || '大雨'}のときの避難`, M, 92);
  g.font = `400 28px ${F}`; g.fillText(`${card.name}から　${new Date(card.created).toLocaleDateString('ja-JP')}作成`, M, 132);
  let y = 230;
  const text = (t, size, color, weight, gap = 1.45) => { g.fillStyle = color; g.font = `${weight} ${size}px ${F}`; for (const ln of wrapText(g, t, TW)) { g.fillText(ln, M, y); y += size * gap; } };
  text(cardWhen(card), 36, '#333333', 700, 1.35);
  y += 34;
  text(cardWhat(card), 62, '#1a1a1a', 700, 1.3);
  y += 4;
  for (const ln of cardSubLines(card)) text(ln, 34, '#333333', 400, 1.45);
  if (card.route || card.dest) {
    y += 10;
    await drawRouteMap(g, card, M, y, TW, 640);
    y += 640 + 44;
    g.font = `400 26px ${F}`; g.fillStyle = '#333333';
    let lx = M;
    const key = (color, label) => { g.fillStyle = color; g.fillRect(lx, y - 12, 44, 10); lx += 54; g.fillStyle = '#333333'; g.fillText(label, lx, y); lx += g.measureText(label).width + 36; };
    if (card.route) { key(card.route.safe ? '#197a4b' : '#0017c1', '通る道'); if ((card.route.deep || []).length) key('#ce0000', LAYERS[card.route.layer].kind === 'depth' ? '先に浸水する道' : '土砂災害のおそれがある道'); }
    y += 70;
  }
  if (card.msg) text(card.msg, 34, '#1a1a1a', 400);
  if (card.meet) text(`はぐれたら${card.meet}で待つ`, 34, '#1a1a1a', 400);
  y += 14;
  g.fillStyle = '#949494'; g.fillRect(M, y, TW, 2); y += 48;
  for (const ln of cardRiskLines(card)) text(ln, 30, '#333333', 400, 1.45);
  y += 6;
  for (const ln of ['浸水の想定　国土交通省 ハザードマップポータルサイト', '地図と避難場所　国土地理院', 'くまもとハザードマップ　NPO法人plus mirai']) text(ln, 22, '#4d4d4d', 400, 1.5);
  const H = Math.ceil(y + 24), out = document.createElement('canvas'); out.width = W; out.height = H;
  out.getContext('2d').drawImage(c, 0, 0, W, H, 0, 0, W, H);
  return await new Promise(r => out.toBlob(b => r(b), 'image/png'));
}

// ---------- 共有リンク（経路をURLに入れる） ----------
function encNum(v) { v = v < 0 ? ~(v << 1) : (v << 1); let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); }
function encPoly(pts) { let out = '', pa = 0, pb = 0; for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); out += encNum(a - pa) + encNum(b - pb); pa = a; pb = b; } return out; }
function decPoly(str) {
  const pts = []; let i = 0, la = 0, lo = 0;
  while (i < str.length) { const v = [0, 0]; for (let k = 0; k < 2; k++) { let r = 0, sh = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); v[k] = (r & 1) ? ~(r >> 1) : (r >> 1); } la += v[0]; lo += v[1]; pts.push([la / 1e5, lo / 1e5]); }
  return pts;
}
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function cardLink(card) {
  const r = card.route, k = card.risk || {};
  const p = { v: 1, w: card.mode === 'car' ? 'c' : 'w', n: card.name, a: [card.lat, card.lng], l: card.layer, t: card.timing, m: card.msg || '', g: card.meet || '', s: card.stay || 0,
    d: card.dest ? [card.dest.t, card.dest.lat, card.dest.lng] : 0,
    r: r ? { s: r.safe ? 1 : 0, o: r.detour ? 1 : 0, n: r.len, p: encPoly(r.pts), d: (r.deep || []).map(encPoly) } : 0,
    k: { d: k.depth || '', u: k.duration || '', h: k.kaoku ? 1 : 0, z: k.dosha || '' } };
  return location.origin + location.pathname + '#c=' + b64u(JSON.stringify(p));
}
function cardFromLink(hash) {
  try {
    const p = JSON.parse(unb64u(hash.slice(3)));
    return { id: Date.now().toString(36), created: Date.now(), shared: true, mode: p.w === 'c' ? 'car' : 'walk', name: p.n, lat: p.a[0], lng: p.a[1], layer: p.l, timing: p.t, msg: p.m, meet: p.g, stay: p.s || null,
      dest: p.d ? { t: p.d[0], lat: p.d[1], lng: p.d[2] } : null,
      route: p.r ? { layer: p.l, mode: p.w === 'c' ? 'car' : 'walk', safe: !!p.r.s, detour: !!p.r.o, len: p.r.n, pts: decPoly(p.r.p), deep: p.r.d.map(decPoly) } : null,
      risk: { depth: p.k.d || undefined, duration: p.k.u || undefined, kaoku: !!p.k.h, dosha: p.k.z || undefined }, me: { ...me } };
  } catch { return null; }
}

// ---------- カードの一覧・送る・書き足す ----------
const cardFiles = {};
async function openCards(focusId) {
  $('#cardPanel').hidden = false;
  const body = $('#cardBody');
  if (!cards.length) {
    body.innerHTML = `<p class="panel-lead">自宅の場所・避難先・逃げ始めるときを決めると家族に送れるカードができます</p><button class="btn-main" id="cNew">避難カードをつくる</button>`;
    $('#cNew').onclick = () => startCardFlow(meMarker ? meMarker.getLatLng() : map.getCenter());
    return;
  }
  const card = cards.find(c => c.id === focusId) || cards[0];
  body.innerHTML = `<div class="spinner"></div>`;
  const blob = await renderCardImage(card);
  const file = new File([blob], `避難カード-${card.name}.png`, { type: 'image/png' });
  cardFiles[card.id] = file;
  const url = URL.createObjectURL(blob), link = cardLink(card);
  const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  body.innerHTML = `<button class="btn-main" id="cOpenRoute">避難経路を地図で開く<small class="sub2">電波がなくても開けます</small></button>
    <img class="cardimg" src="${url}" alt="避難カード ${esc(cardWhen(card))} ${esc(cardWhat(card))}">
    <p class="share-note">カードとリンクには自宅の位置が入っています<br>家族など知っている人だけに送ってください</p>
    <button class="btn-line" id="cShare">家族に送る</button>
    <button class="btn-line" id="cCopy">経路のリンクをコピーする</button>
    ${canShareFile ? '' : '<p class="res-note">画像は長押しで保存できます</p>'}
    <details class="more" id="cAdd"><summary><span>書き足す</span><small>ひとこと・待つ場所</small></summary>
      <label class="lbl" for="cMsg">家族へのひとこと</label><textarea class="field" id="cMsg" maxlength="60" placeholder="例　先に着いたらLINEで「着いた」と送る">${esc(card.msg || '')}</textarea>
      <label class="lbl" for="cMeet">はぐれたときに待つ場所</label><input class="field" id="cMeet" maxlength="20" value="${esc(card.meet || '')}" placeholder="例　城西小学校の正門">
      <button class="btn-sub" id="cAddSave">カードに書き足す</button>
    </details>
    <h3 class="sec">つくったカード</h3>
    <ul class="cardlist">${cards.map(c => `<li><div class="meta"><b>${esc(c.name)}</b><small>${esc(c.dest ? c.dest.t : c.stay ? `家の${c.stay}階` : '避難先なし')}・${new Date(c.created).toLocaleDateString('ja-JP')}</small></div>
      <button class="dlbtn" data-open="${c.id}"><span>${c.id === card.id ? '表示中' : '見る'}</span></button><button class="dlbtn danger" data-del="${c.id}"><span>削除</span></button></li>`).join('')}</ul>
    <button class="addbtn" id="cNew">${ic('plus')}新しくつくる</button>`;
  $('#cOpenRoute').onclick = () => openRouteView(card);
  $('#cShare').onclick = () => {
    const text = `${card.name}からの避難経路\n${cardWhen(card)} ${cardWhat(card)}\n\n地図で開く\n${link}`;
    if (canShareFile) navigator.share({ files: [cardFiles[card.id]], text }).catch(() => {});
    else if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast('送る文をコピーしました\nLINEに貼りつけてください'));
  };
  $('#cCopy').onclick = () => navigator.clipboard?.writeText(link).then(() => toast('リンクをコピーしました')).catch(() => toast('コピーできませんでした'));
  $('#cAddSave').onclick = () => { card.msg = $('#cMsg').value.trim(); card.meet = $('#cMeet').value.trim(); store.set('cards', cards); openCards(card.id); };
  $('#cNew').onclick = () => startCardFlow(L.latLng(card.lat, card.lng));
  body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCards(b.dataset.open));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const c = cards.find(x => x.id === b.dataset.del);
    if (!confirm(`「${c.name}」のカードを削除しますか？`)) return;
    cards = cards.filter(x => x.id !== c.id); store.set('cards', cards); openCards();
  });
}
$('#btnCards').onclick = () => openCards();
$('#cardClose').onclick = () => { $('#cardPanel').hidden = true; };

function openSharedFromHash() {
  if (!location.hash.startsWith('#c=')) return;
  const shared = cardFromLink(location.hash);
  history.replaceState(null, '', location.pathname);
  if (shared) { if (LAYERS[shared.layer]) showLayer(shared.layer); openRouteView(shared); } else toast('リンクを読み込めませんでした');
}

// ================= 緊急時：保存した避難経路を開く（計算はしない・電波不要） =================
let watchId = null;
function openRouteView(card) {
  $('#cardPanel').hidden = true; closeSheet();
  $('#startHint').hidden = true;
  routeGroup.clearLayers(); routeLines.clearLayers();
  const pts = [[card.lat, card.lng]];
  L.marker([card.lat, card.lng], { icon: homeIcon(), zIndexOffset: 2000 }).bindTooltip(esc(card.name), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -40] }).addTo(routeGroup);
  if (card.dest) {
    pts.push([card.dest.lat, card.dest.lng]);
    L.marker([card.dest.lat, card.dest.lng], { icon: destIcon(), pane: 'shelters' }).bindTooltip(esc(card.dest.t), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -14] }).addTo(routeGroup);
  }
  if (card.route) { drawCardRoute(card.route, routeLines); pts.push(...card.route.pts); }
  map.fitBounds(L.latLngBounds(pts).pad(0.2), { paddingTopLeft: [0, 200] });
  $('#routeBanner').innerHTML = `<div class="rb-main"><span class="rb-when">${esc(cardWhen(card))}</span><b>${esc(cardWhat(card))}</b>${cardSubLines(card).map(t => `<span>${esc(t)}</span>`).join('')}
    ${card.shared ? '<button class="btn-sub" id="rbSave">自分の避難カードに入れる</button>' : ''}</div>
    <button class="textbtn" id="rbEnd">終了</button>`;
  $('#routeBanner').hidden = false;
  $('#rbEnd').onclick = closeRouteView;
  if ($('#rbSave')) $('#rbSave').onclick = () => { const c = { ...card, shared: false }; cards.unshift(c); store.set('cards', cards.slice(0, 20)); $('#rbSave').remove(); toast('避難カードに入れました'); };
  if (navigator.geolocation) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition(p => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }) }).addTo(map);
      else meMarker.setLatLng(ll);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 });
  }
}
function closeRouteView() {
  $('#routeBanner').hidden = true;
  routeGroup.clearLayers(); routeLines.clearLayers();
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// ================= オンライン表示 =================
function updateNet() { $('#netBadge').hidden = navigator.onLine; }
addEventListener('online', updateNet);
addEventListener('offline', () => { updateNet(); toast('オフラインです\n保存した地域だけ表示できます'); });
updateNet();

// ================= オフライン保存 =================
const TILE_CACHE = P + 'tiles-v1';
const EMPTY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0));
function tilesForFeature(f, maxZ) {
  const out = [], [w, s, e, n] = f.properties.bbox, rings = f.geometry.coordinates.map(p => p[0]);
  const inside = (lon, lat) => rings.some(r => pointInRing(lon, lat, r));
  for (let z = MIN_SAVE_Z; z <= maxZ; z++) {
    const x0 = Math.floor(lon2x(w, z)), x1 = Math.floor(lon2x(e, z)), y0 = Math.floor(lat2y(n, z)), y1 = Math.floor(lat2y(s, z));
    const vset = new Set();
    for (const r of rings) for (const [lon, lat] of r) vset.add(Math.floor(lon2x(lon, z)) + ',' + Math.floor(lat2y(lat, z)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (z <= 11 || vset.has(x + ',' + y)) { out.push([z, x, y]); continue; }
      const lw = x2lon(x, z), le = x2lon(x + 1, z), ln = y2lat(y, z), ls = y2lat(y + 1, z);
      if (inside((lw + le) / 2, (ln + ls) / 2) || inside(lw, ln) || inside(le, ln) || inside(lw, ls) || inside(le, ls)) out.push([z, x, y]);
    }
  }
  return out;
}
function tilesForCircle(lat, lon, rKm, maxZ) {
  const out = [], kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  for (let z = MIN_SAVE_Z; z <= maxZ; z++) {
    const x0 = Math.floor(lon2x(lon - rKm / kx, z)), x1 = Math.floor(lon2x(lon + rKm / kx, z));
    const y0 = Math.floor(lat2y(lat + rKm / ky, z)), y1 = Math.floor(lat2y(lat - rKm / ky, z));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const lw = x2lon(x, z), le = x2lon(x + 1, z), ln = y2lat(y, z), ls = y2lat(y + 1, z);
      const cx = Math.max(lw, Math.min(lon, le)), cy = Math.max(ls, Math.min(lat, ln));
      if (Math.hypot((cx - lon) * kx, (cy - lat) * ky) <= rKm) out.push([z, x, y]);
    }
  }
  return out;
}
function tilesForPref() {
  const seen = new Set(), out = [];
  for (const f of munis) for (const t of tilesForFeature(f, PREF_MAX_Z)) { const k = t.join('/'); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}
function tilesForEntry(e) {
  if (e.kind === 'pref') return tilesForPref();
  if (e.kind === 'place') return tilesForCircle(e.lat, e.lon, e.r, e.maxZ);
  const f = munis.find(m => m.properties.code === e.code);
  return f ? tilesForFeature(f, e.maxZ) : [];
}
function urlsForTiles(tiles) {
  const urls = [];
  for (const [z, x, y] of tiles) {
    urls.push(tileUrl(BASE_URL, z, x, y));
    if (z <= DEM_MAX_Z) urls.push(tileUrl(DEM_URL, z, x, y));
    if (z <= HZ_MAX_Z) for (const p of ALL_HZ_PATHS) urls.push(tileUrl(hzTpl(p), z, x, y));
  }
  return urls;
}
const estTilesBytes = tiles => tiles.reduce((a, [z]) => a + (KB_PER_TILE[z] || 30) * 1024, 0) * 1.15;
const estCache = {};
const estFor = (k, fn) => estCache[k] ??= estTilesBytes(fn());
async function downloadArea(key, entry) {
  if (jobs[key]) return;
  if (!navigator.onLine) return toast('保存にはインターネット接続が必要です');
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const cache = await caches.open(TILE_CACHE);
  const tiles = tilesForEntry(entry), urls = urlsForTiles(tiles);
  const job = jobs[key] = { cancel: false, done: 0, total: urls.length, bytes: 0, failed: 0 };
  saved[key] = { ...entry, date: Date.now(), tiles: tiles.length, bytes: saved[key]?.bytes || 0, done: false, partial: false };
  saveLedger(); renderPanel(); drawPlaces();
  let i = 0;
  const worker = async () => {
    while (i < urls.length && !job.cancel) {
      const url = urls[i++];
      try {
        if (!(await cache.match(url))) {
          let ok = false;
          for (let a = 0; a < 3 && !ok; a++) {
            try {
              const r = await fetch(url, { mode: 'cors' });
              if (r.ok) { const buf = await r.arrayBuffer(); job.bytes += buf.byteLength; await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'image/png' } })); ok = true; }
              else if (r.status === 404) { await cache.put(url, new Response(EMPTY_PNG, { headers: { 'Content-Type': 'image/png', 'X-HM-Empty': '1' } })); ok = true; }
            } catch { await new Promise(r => setTimeout(r, 400 * (a + 1))); }
          }
          if (!ok) job.failed++;
        }
      } catch (e) { job.failed++; if (e && e.name === 'QuotaExceededError') { job.cancel = true; toast('端末の空き容量が足りません'); } }
      job.done++;
      if (job.done % 40 === 0) renderPanel();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const cancelled = job.cancel; delete jobs[key];
  if (!saved[key]) return;
  saved[key].bytes += job.bytes; saved[key].failed = job.failed;
  saved[key].done = !cancelled && job.failed === 0; saved[key].partial = !saved[key].done;
  saveLedger(); pixCache.clear(); refreshMuniStyle(); drawPlaces(); renderPanel(); updateStorage();
  if (cancelled) toast(`${entry.name}の保存を中断しました（もう一度押すと続きから再開）`);
  else if (job.failed) toast(`${entry.name}の${job.failed}件を取得できませんでした\nもう一度押すと再試行します`);
  else toast(`${entry.name}を保存しました\n電波がなくても見られます`);
}
async function deleteArea(key) {
  const e = saved[key]; if (!e) return;
  if (jobs[key]) jobs[key].cancel = true;
  const keep = new Set();
  for (const [k, s] of Object.entries(saved)) if (k !== key) for (const u of urlsForTiles(tilesForEntry(s))) keep.add(u);
  const urls = urlsForTiles(tilesForEntry(e));
  delete saved[key]; saveLedger();
  const cache = await caches.open(TILE_CACHE);
  for (const u of urls) if (!keep.has(u)) await cache.delete(u);
  pixCache.clear(); refreshMuniStyle(); drawPlaces(); renderPanel(); updateStorage();
  toast(`${e.name}の保存データを削除しました`);
}
const savePref = () => downloadArea('pref', { kind: 'pref', name: '熊本県全体の概略地図', maxZ: PREF_MAX_Z });

const NAME_PRESETS = ['自宅', '学校', '実家', '塾・バイト先'];
function openSaveSheet(latlng) {
  inspectSeq++;
  if (!tapMarker) tapMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', weight: 3, fillColor: '#0017c1', fillOpacity: 1 }).addTo(map);
  else tapMarker.setLatLng(latlng);
  routeGroup.clearLayers();
  let name = NAME_PRESETS[0], r = 2;
  const preview = L.circle(latlng, { radius: r * 1000, color: '#0017c1', weight: 2, dashArray: '6 6', fillOpacity: .06, interactive: false }).addTo(routeGroup);
  const sizeOf = rr => fmtMB(estFor(`c${rr}@${latlng.lat.toFixed(2)}`, () => tilesForCircle(latlng.lat, latlng.lng, rr, PLACE_MAX_Z)));
  const render = () => {
    openSheet(`<div class="res-title">この地点の周りを保存</div>
      <p class="res-desc" style="margin:2px 0 4px">電波がなくてもこの周りの地図とハザード情報を見られるようにします</p>
      <div class="chipsel">${NAME_PRESETS.map(n => `<button data-n="${n}" class="${n === name ? 'on' : ''}">${n}</button>`).join('')}</div>
      <input class="field" id="placeName2" placeholder="名前を入力　例 祖母の家" value="${NAME_PRESETS.includes(name) ? '' : esc(name)}">
      <label class="lbl">保存する範囲</label>
      <div class="seg">${[1, 2, 3].map(x => `<button data-r="${x}" class="${x === r ? 'on' : ''}">半径${x}km<small>約${sizeOf(x)}</small></button>`).join('')}</div>
      <button class="btn-main" id="doSavePlace">保存する</button>`);
    document.querySelectorAll('.chipsel [data-n]').forEach(b => b.onclick = () => { name = b.dataset.n; render(); });
    $('#placeName2').oninput = e => { const v = e.target.value.trim(); name = v || NAME_PRESETS[0]; };
    document.querySelectorAll('.seg [data-r]').forEach(b => b.onclick = () => { r = +b.dataset.r; preview.setRadius(r * 1000); render(); });
    $('#doSavePlace').onclick = () => {
      const id = 'p:' + Date.now().toString(36);
      closeSheet();
      downloadArea(id, { kind: 'place', name, lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6), r, maxZ: PLACE_MAX_Z });
      toast(`${name}のまわり${r}kmを保存しています`);
    };
  };
  render();
  map.fitBounds(preview.getBounds(), { paddingBottomRight: [0, 320] });
}
function drawPlaces() {
  placeGroup.clearLayers();
  for (const e of Object.values(saved)) {
    if (e.kind !== 'place') continue;
    L.circle([e.lat, e.lon], { radius: e.r * 1000, pane: 'places', color: '#0017c1', weight: 1.5, opacity: .7, dashArray: e.done ? null : '4 6', fillOpacity: .03, interactive: false }).addTo(placeGroup);
    L.marker([e.lat, e.lon], { pane: 'places', icon: L.divIcon({ className: '', html: '', iconSize: [0, 0] }), interactive: false })
      .bindTooltip(esc(e.name) + (e.done ? '' : '（保存中）'), { permanent: true, direction: 'top', className: 'place-label', offset: [0, -4] }).addTo(placeGroup);
  }
}
function statusBtn(key, e) {
  const j = jobs[key];
  if (j) { const pct = Math.floor(j.done / j.total * 100); return { sub: `保存中… ${pct}%（${fmtMB(j.bytes)}）`, btn: `<button class="dlbtn busy" data-act="stop" data-key="${key}"><i class="prog" style="width:${pct}%"></i><span>中断</span></button>` }; }
  if (e && e.done) return { sub: null, btn: `<button class="dlbtn saved" data-act="menu" data-key="${key}">${ic('check')}<span>保存済み</span></button>` };
  if (e && e.partial) return { sub: `途中まで保存（${fmtMB(e.bytes)}）`, btn: `<button class="dlbtn" data-act="resume" data-key="${key}"><span>続きから</span></button>` };
  return null;
}
const dateStr = t => new Date(t).toLocaleDateString('ja-JP');
function renderPanel() {
  if ($('#dlPanel').hidden) return;
  const e = saved.pref, st = statusBtn('pref', e), est = munis.length ? estFor('pref', tilesForPref) : 0;
  $('#prefList').innerHTML = `<li><div class="meta"><div class="name">熊本県全体</div><div class="sub">${st?.sub ?? (e?.done ? `保存済み・${fmtMB(e.bytes)}・${dateStr(e.date)}` : `約${fmtMB(est)}・県内のおおよその想定がわかる`)}</div></div>${st?.btn ?? `<button class="dlbtn" data-act="pref"><span>保存</span></button>`}</li>`;
  const places = Object.entries(saved).filter(([, x]) => x.kind === 'place');
  $('#placeList').innerHTML = places.length ? places.map(([k, x]) => { const s2 = statusBtn(k, x); return `<li><div class="meta"><div class="name">${esc(x.name)}</div><div class="sub">${s2?.sub ?? `半径${x.r}km・${fmtMB(x.bytes)}・${dateStr(x.date)}`}</div></div>${s2?.btn ?? ''}</li>`; }).join('')
    : `<li><div class="meta"><div class="sub">まだありません<br>自宅や学校を保存すると電波がなくても道路まで見られます</div></div></li>`;
  if ($('#muniDetails').open) renderMuniList();
}
function renderMuniList() {
  const q = $('#dlSearch').value.trim(), c = map.getCenter(), here = muniAt(c.lat, c.lng), hereCode = here ? here.properties.code : null;
  const list = munis.filter(f => !q || f.properties.name.includes(q)).sort((a, b) => (b.properties.code === hereCode) - (a.properties.code === hereCode));
  $('#dlList').innerHTML = list.map(f => {
    const p = f.properties, key = 'm:' + p.code, e = saved[key], st = statusBtn(key, e);
    const sub = st?.sub ?? (e?.done ? `保存済み・${e.maxZ >= 16 ? '詳細' : '標準'}・${fmtMB(e.bytes)}` : `約${fmtMB(estFor(key + '@' + quality, () => tilesForFeature(f, quality)))}`);
    return `<li><div class="meta"><div class="name">${esc(p.name)}${p.code === hereCode ? '<em>表示中</em>' : ''}</div><div class="sub">${sub}</div></div>${st?.btn ?? `<button class="dlbtn" data-act="muni" data-key="${key}"><span>保存</span></button>`}</li>`;
  }).join('');
}
$('#muniDetails').addEventListener('toggle', () => { if ($('#muniDetails').open) renderMuniList(); });
$('#dlPanel').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const act = b.dataset.act, key = b.dataset.key;
  if (act === 'pref') savePref();
  else if (act === 'muni') { const f = munis.find(m => 'm:' + m.properties.code === key); downloadArea(key, { kind: 'muni', code: f.properties.code, name: f.properties.name, maxZ: quality }); }
  else if (act === 'resume') downloadArea(key, saved[key]);
  else if (act === 'stop') jobs[key].cancel = true;
  else if (act === 'menu') {
    const s = saved[key];
    if (confirm(`「${s.name}」の保存データを削除しますか？\n（「キャンセル」で地図に移動します）`)) deleteArea(key);
    else {
      $('#dlPanel').hidden = true;
      if (s.kind === 'place') map.fitBounds(L.latLng(s.lat, s.lon).toBounds(s.r * 2000));
      else if (s.kind === 'muni') { const bb = munis.find(m => m.properties.code === s.code).properties.bbox; map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]); }
      else map.fitBounds(KUMAMOTO_BOUNDS);
    }
  }
});
$('#addPlace').onclick = () => { $('#dlPanel').hidden = true; toast('地図を長押しするか\n地点の「くわしく見る」から保存できます', 4500); };
$('#dlSearch').addEventListener('input', renderMuniList);
document.querySelectorAll('#muniDetails .seg button').forEach(b => {
  b.classList.toggle('on', +b.dataset.q === quality);
  b.onclick = () => { quality = +b.dataset.q; store.set('quality', quality); document.querySelectorAll('#muniDetails .seg button').forEach(x => x.classList.toggle('on', x === b)); renderMuniList(); };
});
$('#btnDownload').onclick = () => { $('#dlPanel').hidden = false; renderPanel(); updateStorage(); };
$('#dlClose').onclick = () => { $('#dlPanel').hidden = true; };
async function updateStorage() {
  const total = Object.values(saved).reduce((a, s) => a + (s.bytes || 0), 0);
  let line = `保存済み ${fmtMB(total)}`, bar = '';
  try { const est = await navigator.storage.estimate(); if (est.quota) { line += `<span style="float:right;color:var(--sub)">空き 約${fmtMB(est.quota - est.usage)}</span>`; bar = `<div class="bar"><i style="width:${Math.min(100, est.usage / est.quota * 100).toFixed(1)}%"></i></div>`; } } catch {}
  $('#storageInfo').innerHTML = line + bar;
}

// ================= はじめに（1画面） =================
function openOnboard() { $('#onboard').hidden = false; }
$('#obNext').onclick = () => {
  const wantSave = $('#obSave')?.checked;
  $('#onboard').hidden = true; store.set('agreed', true);
  if (wantSave) savePref();
  showStartHint();
};
$('#btnHelp').onclick = openOnboard;

// ================= 起動 =================
Promise.all([
  fetch('data/kumamoto_municipalities.geojson').then(r => r.json()),
  fetch('data/shelters_kumamoto.json').then(r => r.json()),
]).then(([g, sh]) => {
  munis = g.features; shelters = sh.items;
  muniLayer = L.geoJSON(g, { style: muniStyle, interactive: false }).addTo(map);
  const holes = munis.flatMap(f => f.geometry.coordinates.map(p => p[0].map(([x, y]) => [y, x])));
  L.polygon([[[-85, -180], [-85, 180], [85, 180], [85, -180]], ...holes], { pane: 'mask', stroke: false, fillColor: '#f2f2f2', fillOpacity: 0.62, interactive: false }).addTo(map);
  updatePlace(); drawShelterDots(); drawPlaces(); renderPanel();
  openSharedFromHash();
  addEventListener('hashchange', openSharedFromHash);
});
showLayer(LAYERS[activeLayer] ? activeLayer : 'flood');
function showStartHint() { $('#startHint').hidden = !!store.get('hinted', false) || !$('#sheet').hidden || !$('#routeBanner').hidden; }
$('#hintSearch').onclick = () => openSearch();
if (!store.get('agreed', false)) openOnboard(); else showStartHint();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
