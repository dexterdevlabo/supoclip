// ASS (Advanced SubStation Alpha) generator.
// libass handles every script ffmpeg can render: Latin, Cyrillic, Greek, CJK,
// Arabic/Hebrew (bidi), Devanagari, Thai, Khmer, Ethiopic, emoji...

const CENTI = 100;

/** #rrggbb + alpha(0..1) -> &HAABBGGRR */
export function assColor(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff').trim());
  const rgb = m ? m[1] : 'ffffff';
  const r = rgb.slice(0, 2), g = rgb.slice(2, 4), b = rgb.slice(4, 6);
  const a = Math.round((1 - Math.min(1, Math.max(0, Number(alpha)))) * 255);
  return ('&H' + a.toString(16).padStart(2, '0') + b + g + r).toUpperCase();
}

export function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

function escapeText(t) {
  return String(t)
    .replace(/\\/g, '\\​')     // keep literal backslashes from being tags
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r/g, '');
}

/** Split text into segments, script-aware (works for CJK/Thai with no spaces). */
function segment(text, locale, granularity) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter(locale || undefined, { granularity });
      return [...seg.segment(text)].map((s) => ({ text: s.segment, wordLike: !!s.isWordLike }));
    } catch { /* fall through */ }
  }
  if (granularity === 'grapheme') return [...text].map((c) => ({ text: c, wordLike: /\S/.test(c) }));
  return text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, wordLike: /\S/.test(t) }));
}

/** Wrap one logical line to maxChars, respecting word boundaries of any script. */
export function wrapText(text, maxChars, locale) {
  const limit = Math.max(6, Number(maxChars) || 42);
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const seg of segment(para, locale, 'word')) {
      const candidate = line + seg.text;
      if ([...candidate].length > limit && line.trim()) {
        out.push(line.trimEnd());
        line = seg.wordLike ? seg.text : '';
      } else {
        line = candidate;
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

/** Anchor point for a given ASS alignment (1..9) in PlayRes coordinates. */
function anchorPoint(style, W, H) {
  const a = Number(style.alignment) || 2;
  const ml = style.marginL, mr = style.marginR, mv = style.marginV;
  const col = ((a - 1) % 3); // 0 left, 1 center, 2 right
  const row = Math.floor((a - 1) / 3); // 0 bottom, 1 middle, 2 top
  const x = col === 0 ? ml : col === 2 ? W - mr : W / 2;
  const y = row === 0 ? H - mv : row === 2 ? mv : H / 2;
  return { x: Math.round(x), y: Math.round(y), an: a };
}

export const TRANSITIONS = [
  'none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right',
  'pop', 'bounce', 'blur-in', 'zoom-out', 'typewriter', 'word-pop', 'karaoke',
];

/** Override tags that open a cue, for the simple (whole-line) transitions. */
function transitionTags(kind, style, W, H, durMs) {
  const t = Math.min(420, Math.max(90, Number(style.transitionMs) || 260));
  const fade = `\\fad(${t},${Math.min(t, 200)})`;
  const { x, y, an } = anchorPoint(style, W, H);
  const d = Math.round(H * 0.06);
  switch (kind) {
    case 'none': return '';
    case 'fade': return fade;
    case 'slide-up': return `\\an${an}\\move(${x},${y + d},${x},${y},0,${t})${fade}`;
    case 'slide-down': return `\\an${an}\\move(${x},${y - d},${x},${y},0,${t})${fade}`;
    case 'slide-left': return `\\an${an}\\move(${x + d * 2},${y},${x},${y},0,${t})${fade}`;
    case 'slide-right': return `\\an${an}\\move(${x - d * 2},${y},${x},${y},0,${t})${fade}`;
    case 'pop': return `${fade}\\fscx55\\fscy55\\t(0,${t},\\fscx${style.scaleX}\\fscy${style.scaleY})`;
    case 'bounce':
      return `${fade}\\fscx118\\fscy118\\t(0,${Math.round(t * 0.55)},\\fscx92\\fscy92)` +
             `\\t(${Math.round(t * 0.55)},${t},\\fscx${style.scaleX}\\fscy${style.scaleY})`;
    case 'blur-in': return `${fade}\\blur6\\t(0,${t},\\blur0)`;
    case 'zoom-out':
      return `${fade}\\fscx135\\fscy135\\t(0,${Math.round(durMs)},\\fscx${style.scaleX}\\fscy${style.scaleY})`;
    default: return fade;
  }
}

function normStyle(raw, W, H) {
  const s = raw || {};
  const pct = (v, fallback, base) => Math.round(((Number(v) ?? fallback) / 100) * base);
  return {
    fontName: s.fontName || 'DejaVu Sans',
    fontSize: Math.max(8, pct(s.fontSizePct, 5.6, H)),
    primary: assColor(s.textColor, s.textOpacity ?? 1),
    secondary: assColor(s.highlightColor || '#ffd400', 1),
    outlineColor: assColor(s.outlineColor, s.outlineOpacity ?? 1),
    backColor: assColor(s.boxColor || '#000000', s.boxOpacity ?? 0.6),
    bold: s.bold ? -1 : 0,
    italic: s.italic ? -1 : 0,
    underline: s.underline ? -1 : 0,
    strike: s.strike ? -1 : 0,
    scaleX: Math.round(Number(s.scaleX ?? 100)),
    scaleY: Math.round(Number(s.scaleY ?? 100)),
    spacing: Number(s.spacing ?? 0),
    angle: Number(s.angle ?? 0),
    borderStyle: s.boxStyle === 'box' ? 3 : s.boxStyle === 'none' ? 1 : 1,
    outline: s.boxStyle === 'none' ? 0 : Number(s.outlineWidth ?? 3),
    shadow: Number(s.shadowWidth ?? 0),
    alignment: Number(s.alignment ?? 2),
    marginL: pct(s.marginXPct, 6, W),
    marginR: pct(s.marginXPct, 6, W),
    marginV: pct(s.marginYPct, 7, H),
    uppercase: !!s.uppercase,
    maxChars: Number(s.maxChars ?? 38),
    transitionMs: Number(s.transitionMs ?? 260),
    locale: s.locale || undefined,
    highlightHex: s.highlightColor || '#ffd400',
    textHex: s.textColor || '#ffffff',
  };
}

function dialogue(start, end, text, layer = 0) {
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Default,,0,0,0,,${text}`;
}

/**
 * Build a full .ass document.
 * cues: [{ start, end, text, transition?, locale? }]
 */
export function buildAss({ cues = [], style = {}, transition = 'fade', width = 1920, height = 1080 }) {
  const W = Math.max(16, Math.round(width));
  const H = Math.max(16, Math.round(height));
  const st = normStyle(style, W, H);

  const header = [
    '[Script Info]',
    '; Generated by Caption Studio',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,' +
      ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline,' +
      ' Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default', st.fontName, st.fontSize, st.primary, st.secondary, st.outlineColor, st.backColor,
      st.bold, st.italic, st.underline, st.strike, st.scaleX, st.scaleY, st.spacing, st.angle,
      st.borderStyle, st.outline, st.shadow, st.alignment, st.marginL, st.marginR, st.marginV, 1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = [];
  for (const cue of cues) {
    const start = Number(cue.start) || 0;
    const end = Math.max(start + 0.05, Number(cue.end) || start + 1);
    let raw = String(cue.text ?? '').trim();
    if (!raw) continue;
    if (st.uppercase) raw = raw.toLocaleUpperCase(cue.locale || st.locale || undefined);
    const locale = cue.locale || st.locale;
    const lines = wrapText(raw, st.maxChars, locale);
    const body = lines.map(escapeText).join('\\N');
    const kind = cue.transition || transition || 'fade';
    const durMs = (end - start) * 1000;

    if (kind === 'karaoke') {
      // Unsung text uses SecondaryColour, sung uses PrimaryColour -> swap inline.
      const pieces = [];
      for (const line of lines) {
        const words = segment(line, locale, 'word').filter((s) => s.text.length);
        const wordCount = words.filter((w) => w.wordLike).length || 1;
        const per = Math.max(4, Math.round((durMs / wordCount) / 10)); // centiseconds
        let out = '';
        for (const w of words) {
          out += w.wordLike ? `{\\kf${per}}${escapeText(w.text)}` : escapeText(w.text);
        }
        pieces.push(out);
      }
      const head = `{\\1c${assColor(st.highlightHex, 1)}\\2c${assColor(st.textHex, 1)}\\fad(90,90)}`;
      events.push(dialogue(start, end, head + pieces.join('\\N')));
      continue;
    }

    if (kind === 'typewriter' || kind === 'word-pop') {
      const gran = kind === 'typewriter' ? 'grapheme' : 'word';
      const units = segment(lines.join('\n'), locale, gran).filter((s) => s.text.length);
      const visible = units.filter((u) => u.wordLike || gran === 'grapheme');
      const steps = Math.max(1, visible.length);
      const step = (end - start) / steps;
      let shown = '';
      let i = 0;
      const hide = `{\\alpha&HFF&}`;
      const full = units.map((u) => u.text).join('');
      for (const u of units) {
        shown += u.text;
        const isVisibleUnit = u.wordLike || gran === 'grapheme';
        if (!isVisibleUnit) continue;
        i += 1;
        const segStart = start + step * (i - 1);
        const segEnd = i === steps ? end : start + step * i;
        const rest = full.slice(shown.length);
        const body2 = escapeText(shown).replace(/\n/g, '\\N') +
          (rest ? hide + escapeText(rest).replace(/\n/g, '\\N') : '');
        events.push(dialogue(segStart, segEnd, `{\\fad(60,0)}${body2}`));
      }
      continue;
    }

    const tags = transitionTags(kind, st, W, H, durMs);
    events.push(dialogue(start, end, tags ? `{${tags}}${body}` : body));
  }

  return header.concat(events).join('\n') + '\n';
}

function srtTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${sec},${ms}`;
}

export function buildSrt(cues = [], { maxChars = 38, locale } = {}) {
  return cues
    .filter((c) => String(c.text ?? '').trim())
    .map((c, i) => {
      const lines = wrapText(String(c.text).trim(), maxChars, c.locale || locale);
      return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${lines.join('\n')}`;
    })
    .join('\n\n') + '\n';
}

export function buildVtt(cues = [], opts = {}) {
  const body = buildSrt(cues, opts).replace(/,(\d{3})/g, '.$1');
  return 'WEBVTT\n\n' + body;
}
