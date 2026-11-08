import { wrapText, TRANSITIONS } from '/lib/ass.mjs';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------- state ---------------------------------- */

const DEFAULT_STYLE = {
  fontName: 'DejaVu Sans', fontSizePct: 5.6, bold: true, italic: false, underline: false,
  uppercase: false, spacing: 0, textColor: '#ffffff', textOpacity: 1,
  outlineColor: '#000000', outlineWidth: 3, shadowWidth: 1.5,
  highlightColor: '#ffd400', boxColor: '#000000', boxOpacity: 0.55, boxStyle: 'outline',
  alignment: 2, marginXPct: 6, marginYPct: 9, maxChars: 32, transitionMs: 260, locale: 'en',
};

const PRESETS = [
  { name: 'Clean', sub: 'white + outline', style: {} },
  { name: 'Pop', sub: 'big & punchy', style: { fontSizePct: 7.4, outlineWidth: 5, maxChars: 18, boxStyle: 'outline', shadowWidth: 0 }, transition: 'pop' },
  { name: 'Sing-along', sub: 'word highlight', style: { fontSizePct: 6.8, highlightColor: '#ffe14d', outlineWidth: 4.5, maxChars: 24 }, transition: 'karaoke' },
  { name: 'Bar', sub: 'solid backing', style: { boxStyle: 'box', boxColor: '#000000', boxOpacity: 0.78, outlineWidth: 0, fontSizePct: 5, maxChars: 44 }, transition: 'fade' },
  { name: 'Neon', sub: 'glow accent', style: { textColor: '#8ef7ff', outlineColor: '#07213a', outlineWidth: 4, shadowWidth: 4, fontSizePct: 6.4, maxChars: 22 }, transition: 'blur-in' },
  { name: 'Headline', sub: 'top, all caps', style: { alignment: 8, uppercase: true, fontSizePct: 6, spacing: 2, marginYPct: 8, maxChars: 26 }, transition: 'slide-down' },
  { name: 'Typed', sub: 'typewriter', style: { fontSizePct: 5.2, maxChars: 38, boxStyle: 'box', boxOpacity: 0.5 }, transition: 'typewriter' },
  { name: 'Centre', sub: 'middle of frame', style: { alignment: 5, fontSizePct: 8, maxChars: 16, outlineWidth: 5 }, transition: 'bounce' },
];

const LOCALES = [
  ['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['it', 'Italiano'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['ro', 'Română'],
  ['sv', 'Svenska'], ['da', 'Dansk'], ['fi', 'Suomi'], ['cs', 'Čeština'], ['el', 'Ελληνικά'],
  ['ru', 'Русский'], ['uk', 'Українська'], ['sr', 'Српски'], ['ar', 'العربية'], ['he', 'עברית'],
  ['fa', 'فارسی'], ['ur', 'اردو'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['ta', 'தமிழ்'],
  ['te', 'తెలుగు'], ['mr', 'मराठी'], ['gu', 'ગુજરાતી'], ['pa', 'ਪੰਜਾਬੀ'], ['si', 'සිංහල'],
  ['th', 'ไทย'], ['lo', 'ລາວ'], ['km', 'ខ្មែរ'], ['my', 'မြန်မာ'], ['vi', 'Tiếng Việt'],
  ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['tl', 'Filipino'], ['sw', 'Kiswahili'],
  ['am', 'አማርኛ'], ['ha', 'Hausa'], ['yo', 'Yorùbá'], ['zh', '中文 (简体)'], ['zh-Hant', '中文 (繁體)'],
  ['ja', '日本語'], ['ko', '한국어'], ['ka', 'ქართული'], ['hy', 'Հայերեն'], ['az', 'Azərbaycan'],
  ['kk', 'Қазақша'], ['uz', 'Oʻzbekcha'], ['ne', 'नेपाली'], ['mn', 'Монгол'],
];
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ckb', 'yi']);

const state = {
  media: null,
  cues: [],
  style: { ...DEFAULT_STYLE },
  transition: 'slide-up',
  activePreset: 0,
  selected: -1,
  caps: { whisper: false, fonts: [], transitions: TRANSITIONS },
  wordsPerCue: 5,
};

/* ------------------------------ bootstrap -------------------------------- */

const video = $('video');

async function boot() {
  try {
    const caps = await (await fetch('/api/capabilities')).json();
    state.caps = { ...state.caps, ...caps };
    $('caps').textContent =
      `${caps.ffmpeg ? 'ffmpeg ✓' : 'ffmpeg ✗'} · ${caps.whisper ? 'auto-captions ✓' : 'auto-captions ✗'}`;
    $('btn-auto').disabled = !caps.whisper;
    $('btn-auto').title = caps.whisper ? 'Transcribe with local Whisper'
      : 'Install the Whisper CLI (pip install -U openai-whisper) to auto-caption';
    fillFonts(caps.fonts || [], caps.customFonts || []);
  } catch {
    $('caps').textContent = 'server unreachable';
  }
  buildPresets();
  buildTransitions();
  buildAlignGrid();
  fillLocales();
  bindStyleInputs();
  bindActions();
  syncInputs();
  renderCues();
  tick();
}

function fillFonts(families, custom) {
  const sel = $('fontName');
  sel.innerHTML = '';
  const seen = new Set();
  const add = (fam, group) => {
    if (seen.has(fam)) return;
    seen.add(fam);
    const o = document.createElement('option');
    o.value = fam; o.textContent = fam;
    (group || sel).appendChild(o);
  };
  if (custom.length) {
    const g = document.createElement('optgroup'); g.label = 'Added by you';
    custom.forEach((c) => { registerFont(c.family, c.url || `/api/fonts/${c.file}`); add(c.family, g); });
    sel.appendChild(g);
  }
  const g2 = document.createElement('optgroup'); g2.label = 'Installed on this machine';
  families.forEach((f) => add(f, g2));
  sel.appendChild(g2);
  if (!seen.has(state.style.fontName)) {
    const pick = families.find((f) => /dejavu sans$|^arial$|^helvetica$|^inter$|liberation sans/i.test(f));
    if (pick) state.style.fontName = pick;
  }
  sel.value = state.style.fontName;
}

function registerFont(family, url) {
  try {
    const ff = new FontFace(family, `url("${url}")`);
    ff.load().then((f) => document.fonts.add(f)).catch(() => {});
  } catch { /* ignore */ }
}

function buildPresets() {
  const host = $('presets');
  host.innerHTML = '';
  PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'preset' + (i === state.activePreset ? ' on' : '');
    b.innerHTML = `<b>${p.name}</b>${p.sub}`;
    b.onclick = () => {
      state.activePreset = i;
      state.style = { ...DEFAULT_STYLE, ...p.style, fontName: state.style.fontName, locale: state.style.locale };
      if (p.transition) state.transition = p.transition;
      buildPresets(); buildTransitions(); syncInputs(); drawCaption(true);
    };
    host.appendChild(b);
  });
}

const TRANSITION_LABELS = {
  none: 'None', fade: 'Fade', 'slide-up': 'Slide up', 'slide-down': 'Slide down',
  'slide-left': 'Slide ←', 'slide-right': 'Slide →', pop: 'Pop', bounce: 'Bounce',
  'blur-in': 'Blur in', 'zoom-out': 'Zoom out', typewriter: 'Typewriter',
  'word-pop': 'Word by word', karaoke: 'Karaoke',
};

function buildTransitions() {
  const host = $('transitions');
  host.innerHTML = '';
  (state.caps.transitions || TRANSITIONS).forEach((t) => {
    const b = document.createElement('button');
    b.className = 'chip' + (t === state.transition ? ' on' : '');
    b.textContent = TRANSITION_LABELS[t] || t;
    b.onclick = () => { state.transition = t; buildTransitions(); drawCaption(true); };
    host.appendChild(b);
  });
}

function buildAlignGrid() {
  const host = $('alignGrid');
  const labels = { 7: '↖', 8: '↑', 9: '↗', 4: '←', 5: '•', 6: '→', 1: '↙', 2: '↓', 3: '↘' };
  host.innerHTML = '';
  [7, 8, 9, 4, 5, 6, 1, 2, 3].forEach((a) => {
    const b = document.createElement('button');
    b.textContent = labels[a];
    b.className = state.style.alignment === a ? 'on' : '';
    b.onclick = () => { state.style.alignment = a; buildAlignGrid(); drawCaption(true); };
    host.appendChild(b);
  });
}

function fillLocales() {
  const sel = $('locale');
  sel.innerHTML = '';
  LOCALES.forEach(([code, label]) => {
    const o = document.createElement('option');
    o.value = code; o.textContent = `${label} (${code})`;
    sel.appendChild(o);
  });
  sel.value = state.style.locale;
  sel.onchange = () => { state.style.locale = sel.value; drawCaption(true); renderCues(); };
}

/* --------------------------- style bindings ------------------------------ */

const RANGES = ['fontSizePct', 'spacing', 'outlineWidth', 'shadowWidth', 'boxOpacity',
                'marginXPct', 'marginYPct', 'maxChars', 'transitionMs'];
const COLORS = ['textColor', 'outlineColor', 'highlightColor', 'boxColor'];

function bindStyleInputs() {
  RANGES.forEach((k) => {
    const el = $(k);
    el.oninput = () => {
      state.style[k] = Number(el.value);
      $(k + 'Out').value = el.value;
      drawCaption(k === 'transitionMs');
    };
  });
  COLORS.forEach((k) => { $(k).oninput = () => { state.style[k] = $(k).value; drawCaption(); }; });
  $('fontName').onchange = () => { state.style.fontName = $('fontName').value; drawCaption(); };
  $('boxStyle').onchange = () => { state.style.boxStyle = $('boxStyle').value; drawCaption(); };
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.toggle;
      state.style[k] = !state.style[k];
      b.classList.toggle('on', !!state.style[k]);
      drawCaption();
    };
  });
  $('wordsPerCue').oninput = () => {
    state.wordsPerCue = Number($('wordsPerCue').value);
    $('wordsPerCueOut').value = state.wordsPerCue;
  };
}

function syncInputs() {
  RANGES.forEach((k) => { $(k).value = state.style[k]; $(k + 'Out').value = state.style[k]; });
  COLORS.forEach((k) => { $(k).value = state.style[k]; });
  $('boxStyle').value = state.style.boxStyle;
  $('fontName').value = state.style.fontName;
  $('wordsPerCue').value = state.wordsPerCue;
  $('wordsPerCueOut').value = state.wordsPerCue;
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.classList.toggle('on', !!state.style[b.dataset.toggle]);
  });
  buildAlignGrid();
}

/* ------------------------------- preview -------------------------------- */

function videoRect() {
  const wrap = $('videoWrap').getBoundingClientRect();
  const r = video.getBoundingClientRect();
  return { left: r.left - wrap.left, top: r.top - wrap.top, width: r.width, height: r.height };
}

function syncLayer() {
  const r = videoRect();
  const layer = $('capLayer');
  layer.style.left = r.left + 'px';
  layer.style.top = r.top + 'px';
  layer.style.width = r.width + 'px';
  layer.style.height = r.height + 'px';
}

function activeCue(t) {
  for (let i = 0; i < state.cues.length; i++) {
    const c = state.cues[i];
    if (t >= c.start && t < c.end) return { cue: c, index: i };
  }
  return null;
}

function segments(text, locale, granularity) {
  if (window.Intl && Intl.Segmenter) {
    try {
      return [...new Intl.Segmenter(locale || undefined, { granularity }).segment(text)]
        .map((s) => ({ text: s.segment, wordLike: !!s.isWordLike }));
    } catch { /* fall through */ }
  }
  if (granularity === 'grapheme') return [...text].map((c) => ({ text: c, wordLike: /\S/.test(c) }));
  return text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, wordLike: /\S/.test(t) }));
}

let lastKey = '';

function drawCaption(forceRestart = false) {
  syncLayer();
  const box = $('capBox');
  const st = state.style;
  const r = videoRect();
  const H = r.height || 1;
  const hit = activeCue(video.currentTime || 0);
  const demo = !state.media || !hit;

  const cue = hit?.cue || (state.cues[Math.max(0, state.selected)] ||
    { start: 0, end: 3, text: 'Your captions preview here', locale: st.locale });
  const locale = cue.locale || st.locale;
  let raw = String(cue.text || '').trim();
  if (!raw) { box.innerHTML = ''; return; }
  if (st.uppercase) { try { raw = raw.toLocaleUpperCase(locale); } catch { raw = raw.toUpperCase(); } }
  const lines = wrapText(raw, st.maxChars, locale);

  // geometry
  const mx = (st.marginXPct / 100) * r.width;
  const my = (st.marginYPct / 100) * H;
  const a = st.alignment;
  const col = (a - 1) % 3, row = Math.floor((a - 1) / 3);
  box.style.left = col === 0 ? mx + 'px' : col === 1 ? mx + 'px' : 'auto';
  box.style.right = col === 2 ? mx + 'px' : mx + 'px';
  box.style.width = `calc(100% - ${mx * 2}px)`;
  box.style.top = row === 2 ? my + 'px' : row === 1 ? '50%' : 'auto';
  box.style.bottom = row === 0 ? my + 'px' : 'auto';
  box.style.transform = row === 1 ? 'translateY(-50%)' : 'none';
  box.style.alignItems = col === 0 ? 'flex-start' : col === 2 ? 'flex-end' : 'center';
  box.style.textAlign = col === 0 ? 'left' : col === 2 ? 'right' : 'center';

  // typography
  const fs = (st.fontSizePct / 100) * H;
  const ow = (st.outlineWidth / 100) * H * 0.55;
  const sh = (st.shadowWidth / 100) * H * 0.55;
  box.style.font = `${st.italic ? 'italic ' : ''}${st.bold ? '800' : '500'} ${fs}px/1.22 "${st.fontName}", "Noto Sans", sans-serif`;
  box.style.letterSpacing = (st.spacing / 100) * H * 0.3 + 'px';
  box.style.color = st.textColor;
  box.style.textDecoration = st.underline ? 'underline' : 'none';
  box.style.gap = fs * 0.12 + 'px';
  box.dir = RTL.has(String(locale).split('-')[0]) ? 'rtl' : 'auto';

  const stroke = st.boxStyle === 'none' ? 'none' : `${ow}px ${st.outlineColor}`;
  const shadow = st.boxStyle === 'none' || !sh ? 'none'
    : `${sh * 0.6}px ${sh}px ${sh * 0.9}px ${hexAlpha(st.outlineColor, 0.85)}`;

  const dur = st.transitionMs;
  const kind = cue.transition || state.transition;
  const key = `${hit ? hit.index : 'demo'}|${kind}|${dur}|${raw}|${st.maxChars}`;
  const restart = forceRestart || key !== lastKey;
  lastKey = key;

  const progress = clamp(((video.currentTime || 0) - cue.start) / Math.max(0.05, cue.end - cue.start), 0, 1);

  box.innerHTML = '';
  const animClass = ['typewriter', 'word-pop', 'karaoke', 'none'].includes(kind) ? '' : 'anim-' + kind;

  const makeLine = () => {
    const d = document.createElement('div');
    d.className = 'cap-line ' + animClass;
    d.style.webkitTextStroke = stroke === 'none' ? '' : stroke;
    d.style.paintOrder = 'stroke fill';
    d.style.textShadow = shadow;
    if (st.boxStyle === 'box') {
      d.style.background = hexAlpha(st.boxColor, st.boxOpacity);
      d.style.padding = `${fs * 0.1}px ${fs * 0.28}px`;
      d.style.borderRadius = fs * 0.14 + 'px';
    }
    d.style.setProperty('--tdur', dur + 'ms');
    d.style.setProperty('--cdur', Math.max(0.1, cue.end - cue.start) + 's');
    return d;
  };

  if (kind === 'karaoke' || kind === 'word-pop' || kind === 'typewriter') {
    const gran = kind === 'typewriter' ? 'grapheme' : 'word';
    const all = lines.map((l) => segments(l, locale, gran));
    const total = all.flat().filter((s) => s.wordLike || gran === 'grapheme').length || 1;
    let seen = 0;
    for (const lineSegs of all) {
      const d = makeLine();
      for (const s of lineSegs) {
        const el = document.createElement('span');
        el.className = 'w';
        el.textContent = s.text;
        const isUnit = s.wordLike || gran === 'grapheme';
        if (isUnit) {
          seen += 1;
          const reached = progress * total >= seen - 1;
          if (kind === 'karaoke') el.style.color = reached ? st.highlightColor : st.textColor;
          else el.style.visibility = reached ? 'visible' : 'hidden';
        }
        d.appendChild(el);
      }
      box.appendChild(d);
    }
  } else {
    for (const l of lines) {
      const d = makeLine();
      d.textContent = l || ' ';
      box.appendChild(d);
    }
  }
  if (restart) {
    box.querySelectorAll('.cap-line').forEach((el) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
  }
  box.style.opacity = demo ? 0.55 : 1;
}

function hexAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#000000'));
  const h = m ? m[1] : '000000';
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function tick() {
  drawCaption();
  drawPlayhead();
  updateTime();
  requestAnimationFrame(tick);
}

/* ------------------------------ timeline -------------------------------- */

function renderTimeline() {
  const host = $('timeline');
  const dur = state.media?.duration || video.duration || 0;
  host.querySelectorAll('.tl-cue').forEach((n) => n.remove());
  if (!dur) return;
  state.cues.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'tl-cue' + (i === state.selected ? ' on' : '');
    el.style.left = (c.start / dur) * 100 + '%';
    el.style.width = Math.max(0.4, ((c.end - c.start) / dur) * 100) + '%';
    el.textContent = c.text.slice(0, 40);
    el.title = `${c.start.toFixed(2)}s → ${c.end.toFixed(2)}s`;
    el.onclick = () => { select(i); video.currentTime = c.start + 0.01; };
    host.appendChild(el);
  });
}

function drawPlayhead() {
  const dur = state.media?.duration || video.duration || 0;
  let head = $('timeline').querySelector('.tl-head');
  if (!head) { head = document.createElement('div'); head.className = 'tl-head'; $('timeline').appendChild(head); }
  head.style.left = dur ? ((video.currentTime || 0) / dur) * 100 + '%' : '0%';
}

const fmt = (s) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function updateTime() {
  const dur = video.duration || state.media?.duration || 0;
  $('time').textContent = `${fmt(video.currentTime)} / ${fmt(dur)}`;
  if (dur) $('seek').value = String(((video.currentTime || 0) / dur) * 100);
}

/* ------------------------------- cue list -------------------------------- */

function select(i) {
  state.selected = i;
  renderCues();
  renderTimeline();
}

function renderCues() {
  const host = $('cues');
  host.innerHTML = '';
  $('capHint').classList.toggle('hidden', state.cues.length > 0);
  state.cues.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'cue' + (i === state.selected ? ' on' : '');
    const head = document.createElement('div');
    head.className = 'cue-head';
    head.innerHTML =
      `<input type="number" step="0.05" min="0" value="${c.start.toFixed(2)}" data-k="start" />` +
      `<span class="mono">→</span>` +
      `<input type="number" step="0.05" min="0" value="${c.end.toFixed(2)}" data-k="end" />` +
      `<span class="spacer"></span>` +
      `<button data-a="here" title="Set start to playhead">⏱</button>` +
      `<button data-a="play" title="Play this cue">▶</button>` +
      `<button data-a="split" title="Split in half">⇄</button>` +
      `<button data-a="del" class="danger" title="Delete">✕</button>`;
    const ta = document.createElement('textarea');
    ta.value = c.text;
    ta.dir = 'auto';
    ta.spellcheck = false;
    ta.oninput = () => { c.text = ta.value; renderTimeline(); drawCaption(true); };
    ta.onfocus = () => select(i);
    el.append(head, ta);

    head.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        const v = Math.max(0, Number(inp.value) || 0);
        c[inp.dataset.k] = v;
        if (c.end <= c.start) c.end = c.start + 0.4;
        normalise();
        renderCues(); renderTimeline();
      };
    });
    head.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'del') { state.cues.splice(i, 1); state.selected = -1; }
        else if (a === 'here') { const d = c.end - c.start; c.start = video.currentTime; c.end = c.start + d; }
        else if (a === 'play') { video.currentTime = c.start + 0.01; video.play(); }
        else if (a === 'split') {
          const mid = (c.start + c.end) / 2;
          const words = c.text.split(/\s+/);
          const half = Math.ceil(words.length / 2);
          const second = { start: mid, end: c.end, text: words.slice(half).join(' '), locale: c.locale };
          c.end = mid; c.text = words.slice(0, half).join(' ');
          state.cues.splice(i + 1, 0, second);
        }
        normalise(); renderCues(); renderTimeline(); drawCaption(true);
      };
    });
    el.onclick = (e) => { if (e.target === el) select(i); };
    host.appendChild(el);
  });
  renderTimeline();
}

function normalise() {
  state.cues.sort((a, b) => a.start - b.start);
  state.cues.forEach((c) => {
    c.start = Math.max(0, Number(c.start) || 0);
    c.end = Math.max(c.start + 0.2, Number(c.end) || c.start + 1);
  });
}

/* --------------------------- import / split ------------------------------ */

function parseTime(s) {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s) || /(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s);
  if (!m) return 0;
  if (m.length === 5) return +m[1] * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]);
  return +m[1] * 60 + +m[2] + +('0.' + m[3]);
}

function parseSubtitles(txt) {
  const clean = txt.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '');
  const cues = [];
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const tIdx = lines.findIndex((l) => l.includes('-->'));
    if (tIdx < 0) continue;
    const [a, b] = lines[tIdx].split('-->');
    const text = lines.slice(tIdx + 1).join('\n').trim();
    if (!text) continue;
    cues.push({ start: parseTime(a), end: parseTime(b), text, locale: state.style.locale });
  }
  return cues;
}

/** Re-chunk cues into n-word pieces, timing split by unit count. */
function resplit(cues, perCue, locale) {
  const out = [];
  for (const c of cues) {
    const units = segments(c.text.replace(/\n/g, ' '), locale, 'word').filter((s) => s.text.trim());
    const words = units.filter((u) => u.wordLike).map((u) => u.text);
    if (words.length <= perCue) { out.push({ ...c }); continue; }
    const chunks = [];
    for (let i = 0; i < words.length; i += perCue) chunks.push(words.slice(i, i + perCue));
    const dur = c.end - c.start;
    const totalW = words.length;
    let t = c.start;
    chunks.forEach((ch) => {
      const d = dur * (ch.length / totalW);
      const needsSpace = /\s/.test(c.text);
      out.push({ start: t, end: t + d, text: ch.join(needsSpace ? ' ' : ''), locale: c.locale });
      t += d;
    });
  }
  return out;
}

/* -------------------------------- actions -------------------------------- */

function modal(title, msg, { progress = null, log = null, download = null } = {}) {
  $('modal').classList.remove('hidden');
  $('modalTitle').textContent = title;
  $('modalMsg').textContent = msg || '';
  $('modalBar').style.width = (progress ?? 0) + '%';
  $('modalLog').classList.toggle('hidden', !log);
  if (log) $('modalLog').textContent = log;
  const dl = $('modalDl');
  dl.classList.toggle('hidden', !download);
  if (download) dl.href = download;
}

async function uploadVideo(file) {
  modal('Reading video…', file.name, { progress: 8 });
  const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' },
  });
  const data = await res.json();
  if (!res.ok) { modal('Upload failed', data.error || 'unknown error'); return; }
  state.media = data;
  video.src = data.url;
  $('dropzone').classList.add('hidden');
  $('player').classList.remove('hidden');
  $('btn-export').disabled = false;
  $('modal').classList.add('hidden');
  await video.play().catch(() => {});
  video.pause();
  renderTimeline();
}

async function poll(jobId, onProgress) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const j = await (await fetch('/api/job/' + jobId)).json();
    onProgress?.(j);
    if (j.status === 'done' || j.status === 'error') return j;
  }
}

function payload(extra = {}) {
  return {
    mediaId: state.media?.id,
    cues: state.cues,
    style: state.style,
    transition: state.transition,
    width: state.media?.width,
    height: state.media?.height,
    ...extra,
  };
}

function bindActions() {
  // upload
  const dz = $('dropzone');
  const onFiles = (files) => { const f = [...files].find((f) => /^video\//.test(f.type) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)); if (f) uploadVideo(f); };
  $('videoFile').onchange = (e) => onFiles(e.target.files);
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop') onFiles(e.dataTransfer.files); dz.classList.remove('hot'); }));

  // transport
  $('btn-play').onclick = () => (video.paused ? video.play() : video.pause());
  video.onplay = () => ($('btn-play').textContent = '❚❚');
  video.onpause = () => ($('btn-play').textContent = '▶');
  video.onloadedmetadata = () => { syncLayer(); renderTimeline(); };
  $('seek').oninput = () => {
    const dur = video.duration || 0;
    if (dur) video.currentTime = (Number($('seek').value) / 100) * dur;
    drawCaption(true);
  };
  $('timeline').onclick = (e) => {
    if (e.target !== $('timeline')) return;
    const r = $('timeline').getBoundingClientRect();
    const dur = video.duration || 0;
    if (dur) video.currentTime = ((e.clientX - r.left) / r.width) * dur;
  };
  window.addEventListener('resize', () => { syncLayer(); drawCaption(true); });
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    if (e.code === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 0.2));
    if (e.code === 'ArrowRight') video.currentTime += e.shiftKey ? 1 : 0.2;
  });

  // fonts
  $('fontFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const res = await fetch(`/api/fonts?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
    const d = await res.json();
    if (!res.ok) return modal('Font rejected', d.error || '');
    const caps = await (await fetch('/api/capabilities')).json();
    state.style.fontName = d.family;
    fillFonts(caps.fonts || [], caps.customFonts || []);
    registerFont(d.family, d.url);
    $('fontName').value = d.family;
    drawCaption(true);
  };

  // captions
  $('btn-add').onclick = () => {
    const t = video.currentTime || 0;
    state.cues.push({ start: t, end: t + 2, text: 'New caption', locale: state.style.locale });
    normalise();
    state.selected = state.cues.findIndex((c) => c.start === t);
    renderCues(); drawCaption(true);
  };
  $('btn-clear').onclick = () => { if (confirm('Remove all captions?')) { state.cues = []; state.selected = -1; renderCues(); } };
  $('subFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const txt = await f.text();
    let cues = parseSubtitles(txt);
    if (!cues.length) {
      // plain text: spread evenly across the video
      const dur = video.duration || state.media?.duration || 30;
      const parts = txt.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const each = dur / Math.max(1, parts.length);
      cues = parts.map((text, i) => ({ start: i * each, end: (i + 1) * each, text, locale: state.style.locale }));
    }
    state.cues = resplit(cues, state.wordsPerCue, state.style.locale);
    normalise(); renderCues(); drawCaption(true);
  };
  $('btn-resplit').onclick = () => {
    state.cues = resplit(state.cues, state.wordsPerCue, state.style.locale);
    normalise(); renderCues(); drawCaption(true);
  };
  $('btn-auto').onclick = async () => {
    if (!state.media) return modal('No video', 'Add a video first.');
    modal('Transcribing locally…', 'Whisper is running on this machine. Long videos take a while.', { progress: 5 });
    const res = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaId: state.media.id, language: state.style.locale || 'auto' }),
    });
    const d = await res.json();
    if (!res.ok) return modal('Auto-caption unavailable', d.error || '');
    let n = 5;
    const job = await poll(d.jobId, () => { n = Math.min(95, n + 3); $('modalBar').style.width = n + '%'; });
    if (job.status === 'error') return modal('Transcription failed', job.error || '', { log: job.tail });
    state.cues = resplit(parseSubtitles(job.result.srt), state.wordsPerCue, state.style.locale);
    normalise(); renderCues(); drawCaption(true);
    $('modal').classList.add('hidden');
  };

  // subtitle files
  const dlSub = async (format) => {
    const res = await fetch('/api/subtitle', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload({ format })),
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'captions.' + format;
    a.click();
  };
  $('btn-srt').onclick = () => dlSub('srt');
  $('btn-ass').onclick = () => dlSub('ass');

  // export
  $('btn-export').onclick = async () => {
    if (!state.media) return;
    if (!state.cues.length && !confirm('No captions yet — export anyway?')) return;
    modal('Burning captions in…', 'ffmpeg is rendering with libass.', { progress: 1 });
    const res = await fetch('/api/render', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()),
    });
    const d = await res.json();
    if (!res.ok) return modal('Export failed', d.error || '');
    const job = await poll(d.jobId, (j) => { $('modalBar').style.width = (j.progress || 0) + '%'; });
    if (job.status === 'error') return modal('Export failed', job.error || '', { log: job.tail });
    modal('Done', 'Captioned video is ready.', { progress: 100, download: job.download });
  };
  $('modalClose').onclick = () => $('modal').classList.add('hidden');

  // project files
  $('btn-save').onclick = () => {
    const blob = new Blob([JSON.stringify({
      version: 1, cues: state.cues, style: state.style, transition: state.transition,
      wordsPerCue: state.wordsPerCue, media: state.media?.name,
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'caption-project.json';
    a.click();
  };
  $('btn-load').onclick = () => $('projFile').click();
  $('projFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      state.cues = (p.cues || []).map((c) => ({ ...c, start: +c.start, end: +c.end }));
      state.style = { ...DEFAULT_STYLE, ...(p.style || {}) };
      state.transition = p.transition || state.transition;
      state.wordsPerCue = p.wordsPerCue || state.wordsPerCue;
      normalise(); syncInputs(); buildTransitions(); renderCues(); drawCaption(true);
    } catch (err) { modal('Could not open project', String(err.message || err)); }
  };
}

boot();
