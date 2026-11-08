#!/usr/bin/env node
// Caption Studio - a local, dependency-free captioning studio.
// Everything stays on this machine: uploads live in .work/, ffmpeg does the burn-in.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAss, buildSrt, buildVtt, TRANSITIONS } from './lib/ass.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const WORK = process.env.CAPTION_STUDIO_WORK || path.join(__dirname, '.work');
const MEDIA = path.join(WORK, 'media');
const FONTS = path.join(WORK, 'fonts');
const JOBS = path.join(WORK, 'jobs');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 4 * 1024 * 1024 * 1024);

for (const d of [MEDIA, FONTS, JOBS]) await fsp.mkdir(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ass': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

const jobs = new Map(); // id -> { status, progress, error, out, kind, result }

/* ------------------------------- helpers -------------------------------- */

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }));
  });

const has = async (bin) => { try { await run(bin, ['-version']); return true; } catch { return false; } };
const hasWhisper = async () => { try { await run('whisper', ['--help']); return true; } catch { return false; } };

function json(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length });
  res.end(data);
}

function text(res, code, body, type = 'text/plain; charset=utf-8', filename) {
  const data = Buffer.from(body, 'utf8');
  const headers = { 'content-type': type, 'content-length': data.length };
  if (filename) headers['content-disposition'] = `attachment; filename="${filename}"`;
  res.writeHead(code, headers);
  res.end(data);
}

async function readBody(req, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const safeId = (s) => /^[A-Za-z0-9._-]{1,120}$/.test(String(s || '')) ? String(s) : null;

async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate',
    file,
  ]);
  const info = JSON.parse(stdout);
  const v = (info.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  const [num, den] = String(v.r_frame_rate || '0/1').split('/').map(Number);
  return {
    duration: Number(info.format?.duration) || 0,
    width: Number(v.width) || 1920,
    height: Number(v.height) || 1080,
    fps: den ? +(num / den).toFixed(3) : 0,
    videoCodec: v.codec_name || null,
    hasAudio: !!a,
  };
}

async function listFonts() {
  const families = new Set();
  try {
    const { stdout } = await run('fc-list', [':', 'family']);
    for (const line of stdout.split('\n')) {
      for (const fam of line.split(',')) {
        const f = fam.trim();
        if (f && !/[\u0000-\u001f]/.test(f)) families.add(f);
      }
    }
  } catch { /* fontconfig missing (bare Windows/macOS node) */ }
  // Fonts the user dropped into the studio are always offered.
  const custom = [];
  for (const f of await fsp.readdir(FONTS).catch(() => [])) {
    if (/\.(ttf|otf|ttc|woff2?)$/i.test(f)) {
      let fam = path.basename(f).replace(/\.[^.]+$/, '');
      try {
        const { stdout } = await run('fc-query', ['-f', '%{family[0]}', path.join(FONTS, f)]);
        if (stdout.trim()) fam = stdout.trim();
      } catch { /* keep filename */ }
      custom.push({ family: fam, file: f });
      families.add(fam);
    }
  }
  return { families: [...families].sort((a, b) => a.localeCompare(b)), custom };
}

/* -------------------------------- render -------------------------------- */

async function startRender(payload) {
  const id = safeId(payload.mediaId);
  if (!id) throw new Error('bad mediaId');
  const files = await fsp.readdir(MEDIA);
  const media = files.find((f) => f.startsWith(id + '.'));
  if (!media) throw new Error('media not found');
  const input = path.join(MEDIA, media);
  const meta = await probe(input);

  const jobId = crypto.randomUUID();
  const dir = path.join(JOBS, jobId);
  await fsp.mkdir(dir, { recursive: true });

  const ass = buildAss({
    cues: payload.cues || [],
    style: payload.style || {},
    transition: payload.transition || 'fade',
    width: meta.width,
    height: meta.height,
  });
  await fsp.writeFile(path.join(dir, 'subs.ass'), ass, 'utf8');

  const ext = payload.format === 'webm' ? 'webm' : 'mp4';
  const out = `captioned.${ext}`;
  const vf = `ass=filename=subs.ass:fontsdir=${path.relative(dir, FONTS).split(path.sep).join('/')}`;
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-vf', vf, '-map', '0:v:0'];
  if (meta.hasAudio) args.push('-map', '0:a:0?', '-c:a', ext === 'webm' ? 'libopus' : 'aac', '-b:a', '192k');
  if (ext === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0');
  else args.push('-c:v', 'libx264', '-preset', payload.preset || 'veryfast',
                 '-crf', String(Number(payload.crf) || 20), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  args.push(out);

  const job = { id: jobId, status: 'running', progress: 0, kind: 'render', dir, out, log: '', duration: meta.duration };
  jobs.set(jobId, job);

  const proc = spawn('ffmpeg', args, { cwd: dir });
  proc.stderr.on('data', (c) => {
    const s = c.toString();
    job.log = (job.log + s).slice(-8000);
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
    if (m && meta.duration) {
      const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
      job.progress = Math.min(99, Math.round((t / meta.duration) * 100));
    }
  });
  proc.on('error', (err) => { job.status = 'error'; job.error = err.message; });
  proc.on('close', (code) => {
    if (job.status === 'error') return;
    if (code === 0) { job.status = 'done'; job.progress = 100; }
    else { job.status = 'error'; job.error = `ffmpeg exited ${code}`; }
  });
  return { jobId, meta };
}

async function startTranscribe(payload) {
  const id = safeId(payload.mediaId);
  if (!id) throw new Error('bad mediaId');
  const files = await fsp.readdir(MEDIA);
  const media = files.find((f) => f.startsWith(id + '.'));
  if (!media) throw new Error('media not found');

  const jobId = crypto.randomUUID();
  const dir = path.join(JOBS, jobId);
  await fsp.mkdir(dir, { recursive: true });
  const wav = path.join(dir, 'audio.wav');
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-i', path.join(MEDIA, media),
                       '-vn', '-ac', '1', '-ar', '16000', wav]);

  const args = [wav, '--model', payload.model || 'small', '--output_format', 'srt',
                '--output_dir', dir, '--task', payload.translate ? 'translate' : 'transcribe'];
  if (payload.language && payload.language !== 'auto') args.push('--language', payload.language);

  const job = { id: jobId, status: 'running', progress: 0, kind: 'transcribe', dir, log: '' };
  jobs.set(jobId, job);
  const proc = spawn('whisper', args, { cwd: dir });
  const onOut = (c) => { job.log = (job.log + c.toString()).slice(-8000); };
  proc.stdout.on('data', onOut);
  proc.stderr.on('data', onOut);
  proc.on('error', (err) => { job.status = 'error'; job.error = err.message; });
  proc.on('close', async (code) => {
    if (job.status === 'error') return;
    if (code !== 0) { job.status = 'error'; job.error = `whisper exited ${code}`; return; }
    const srt = (await fsp.readdir(dir)).find((f) => f.endsWith('.srt'));
    if (!srt) { job.status = 'error'; job.error = 'no .srt produced'; return; }
    job.result = { srt: await fsp.readFile(path.join(dir, srt), 'utf8') };
    job.status = 'done';
    job.progress = 100;
  });
  return { jobId };
}

/* -------------------------------- routing ------------------------------- */

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveRange(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m[1] ? Number(m[1]) : 0;
      let end = m[2] ? Number(m[2]) : st.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` });
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        'content-type': type,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes',
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    /* ---- capabilities ---- */
    if (p === '/api/capabilities' && req.method === 'GET') {
      const [ffmpeg, ffprobe, whisper, fonts] = await Promise.all([
        has('ffmpeg'), has('ffprobe'), hasWhisper(), listFonts(),
      ]);
      return json(res, 200, {
        ffmpeg, ffprobe, whisper, transitions: TRANSITIONS,
        fonts: fonts.families, customFonts: fonts.custom,
        platform: `${os.type()} ${os.arch()}`, work: WORK,
      });
    }

    /* ---- upload video: raw PUT body, no multipart needed ---- */
    if (p === '/api/upload' && req.method === 'PUT') {
      const name = url.searchParams.get('name') || 'video.mp4';
      const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.mp4'])[0];
      const id = crypto.randomUUID();
      const dest = path.join(MEDIA, id + ext);
      await new Promise((resolve, reject) => {
        let size = 0;
        const ws = fs.createWriteStream(dest);
        req.on('data', (c) => {
          size += c.length;
          if (size > MAX_UPLOAD) { req.destroy(); ws.destroy(); reject(new Error('file too large')); }
        });
        req.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
        req.on('error', reject);
      });
      let meta;
      try { meta = await probe(dest); }
      catch (e) { await fsp.unlink(dest).catch(() => {}); return json(res, 400, { error: 'not a readable video file' }); }
      return json(res, 200, { id, name, url: `/api/media/${id}${ext}`, ...meta });
    }

    /* ---- stream uploaded media (Range for scrubbing) ---- */
    if (p.startsWith('/api/media/') && req.method === 'GET') {
      const f = safeId(p.slice('/api/media/'.length));
      if (!f) return json(res, 400, { error: 'bad name' });
      return serveRange(req, res, path.join(MEDIA, f));
    }

    /* ---- custom fonts: upload + serve for browser preview ---- */
    if (p === '/api/fonts' && req.method === 'PUT') {
      const name = path.basename(url.searchParams.get('name') || 'font.ttf');
      if (!/\.(ttf|otf|ttc|woff2?)$/i.test(name)) return json(res, 400, { error: 'need .ttf/.otf/.ttc/.woff2' });
      const buf = await readBody(req, 64 * 1024 * 1024);
      const file = name.replace(/[^A-Za-z0-9._-]/g, '_');
      await fsp.writeFile(path.join(FONTS, file), buf);
      const { custom } = await listFonts();
      const entry = custom.find((c) => c.file === file);
      return json(res, 200, { file, family: entry?.family || file.replace(/\.[^.]+$/, ''), url: `/api/fonts/${file}` });
    }
    if (p.startsWith('/api/fonts/') && req.method === 'GET') {
      const f = safeId(p.slice('/api/fonts/'.length));
      if (!f) return json(res, 400, { error: 'bad name' });
      return serveRange(req, res, path.join(FONTS, f));
    }

    /* ---- sidecar subtitle download ---- */
    if (p === '/api/subtitle' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString('utf8'));
      const fmt = body.format === 'srt' ? 'srt' : body.format === 'vtt' ? 'vtt' : 'ass';
      const opts = { maxChars: body.style?.maxChars ?? 38, locale: body.style?.locale };
      const out = fmt === 'ass'
        ? buildAss({ cues: body.cues || [], style: body.style || {}, transition: body.transition,
                     width: body.width || 1920, height: body.height || 1080 })
        : fmt === 'srt' ? buildSrt(body.cues || [], opts) : buildVtt(body.cues || [], opts);
      return text(res, 200, out, MIME['.' + fmt] || 'text/plain; charset=utf-8', `captions.${fmt}`);
    }

    /* ---- render / transcribe ---- */
    if (p === '/api/render' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString('utf8'));
      const { jobId } = await startRender(body);
      return json(res, 202, { jobId });
    }
    if (p === '/api/transcribe' && req.method === 'POST') {
      if (!await hasWhisper()) return json(res, 501, { error: 'whisper CLI not installed' });
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const { jobId } = await startTranscribe(body);
      return json(res, 202, { jobId });
    }
    if (p.startsWith('/api/job/') && req.method === 'GET') {
      const job = jobs.get(p.slice('/api/job/'.length));
      if (!job) return json(res, 404, { error: 'no such job' });
      return json(res, 200, {
        id: job.id, status: job.status, progress: job.progress, kind: job.kind,
        error: job.error || null, result: job.result || null,
        tail: job.status === 'error' ? job.log.slice(-1500) : undefined,
        download: job.status === 'done' && job.kind === 'render' ? `/api/download/${job.id}` : null,
      });
    }
    if (p.startsWith('/api/download/') && req.method === 'GET') {
      const job = jobs.get(p.slice('/api/download/'.length));
      if (!job || job.status !== 'done' || job.kind !== 'render') return json(res, 404, { error: 'not ready' });
      const file = path.join(job.dir, job.out);
      const st = await fsp.stat(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'content-length': st.size,
        'content-disposition': `attachment; filename="${job.out}"`,
      });
      return fs.createReadStream(file).pipe(res);
    }

    /* ---- shared subtitle engine, reused by the browser preview ---- */
    if (p === '/lib/ass.mjs' && req.method === 'GET') {
      const file = path.join(__dirname, 'lib', 'ass.mjs');
      const st = await fsp.stat(file);
      res.writeHead(200, { 'content-type': MIME['.mjs'], 'content-length': st.size, 'cache-control': 'no-cache' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res, p);
  } catch (err) {
    return json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, async () => {
  const ff = await has('ffmpeg');
  console.log(`\n  Caption Studio  ->  http://${HOST}:${PORT}\n`);
  console.log(`  work dir : ${WORK}`);
  console.log(`  ffmpeg   : ${ff ? 'found' : 'MISSING - install ffmpeg to export video'}`);
  console.log(`  whisper  : ${await hasWhisper() ? 'found (auto-captions enabled)' : 'not installed (import or type captions)'}\n`);
});
