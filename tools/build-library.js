#!/usr/bin/env node
/**
 * 曲库构建脚本
 *
 * 扫描 midi_library/<分类>/*.mid(i)，解析音符数与时长，
 * 并将全部 MIDI 以 Base64 打包进 js/samplesData.js（离线、免跨域、秒载入）。
 *
 * 用法：  node tools/build-library.js
 * 新增曲目：把 .mid 放入 midi_library/ 下任意分类文件夹（新文件夹即新分类），重新运行即可。
 * 精选置顶、分类顺序、艺术家与检索关键词见 tools/library.config.json。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'midi_library');
const OUT_FILE = path.join(ROOT, 'js', 'samplesData.js');
const CONFIG_FILE = path.join(__dirname, 'library.config.json');

const { Midi } = require(path.join(ROOT, 'js', 'midi.min.js'));
const Parser = require(path.join(ROOT, 'js', 'owmidiparser.js'));
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
const songMeta = config.songs || {};

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(LIB_DIR)) fail(`未找到曲库目录 ${LIB_DIR}`);

// 稳定 ID：基于“分类/曲名”的短哈希，曲目重新排序或增删时不变
const makeId = (category, title) =>
  's' + crypto.createHash('sha1').update(`${category}/${title}`).digest('hex').slice(0, 8);

const categoryDirs = fs.readdirSync(LIB_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
  .map(d => d.name);

const order = config.categoryOrder || [];
categoryDirs.sort((a, b) => {
  const ia = order.indexOf(a), ib = order.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
  return a.localeCompare(b, 'zh-Hans-CN');
});

const songs = [];
const data = {};
const titles = new Map();
const warnings = [];

for (const category of categoryDirs) {
  const files = fs.readdirSync(path.join(LIB_DIR, category))
    .filter(f => /\.midi?$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  for (const file of files) {
    const title = file.replace(/\.midi?$/i, '').trim();
    const buf = fs.readFileSync(path.join(LIB_DIR, category, file));

    let midi;
    try {
      midi = new Midi(buf);
    } catch (e) {
      warnings.push(`跳过无法解析的文件 ${category}/${file}：${e.message}`);
      continue;
    }

    const meta = songMeta[title] || {};
    // 参与演奏的音轨：配置里指定的优先，否则“智能钢琴化”自动选择（见 owmidiparser.autoSelectTracks）
    const trackMask = Array.isArray(meta.tracks) ? meta.tracks : Parser.autoSelectTracks(midi);
    const notes = Parser.selectableNotes(midi, trackMask);
    const notesAll = Parser.selectableNotes(midi);
    if (notes === 0) {
      warnings.push(`跳过不含有效音符的文件 ${category}/${file}`);
      continue;
    }

    if (titles.has(title)) {
      warnings.push(`曲名重复：「${title}」同时存在于 ${titles.get(title)} 与 ${category}，两者都会保留`);
    }
    titles.set(title, category);

    const id = makeId(category, title);

    // 显式校准 LRC > 配置歌词 > 内嵌歌词；介绍服从实际 MIDI 演奏窗口。
    let firstNote = Infinity, lastNote = 0;
    for (const track of midi.tracks) {
      if (track.channel === 9) continue;
      for (const n of track.notes || []) { if (n.velocity === 0) continue; firstNote = Math.min(firstNote, n.time); lastNote = Math.max(lastNote, n.time); }
    }
    let subs = [];
    let subKind = '';
    const embedded = meta.subtitlePolicy === 'background-only' ? [] : Parser.extractEmbeddedLyrics(buf, midi);
    const lrcFile = path.join(LIB_DIR, category, file.replace(/\.midi?$/i, '.lrc'));
    let subtitleSource = '';
    if (meta.subtitlePolicy !== 'background-only' && fs.existsSync(lrcFile)) {
      subs = Parser.parseLrc(fs.readFileSync(lrcFile, 'utf8'), Number(meta.lrcOffset) || 0);
      if (subs.length) subtitleSource = 'lrc';
      else warnings.push(`${category}/${path.basename(lrcFile)} 没有有效时间标签，尝试其他字幕来源`);
    }
    if (meta.subtitlePolicy !== 'background-only' && !subs.length && Array.isArray(meta.lyrics) && meta.lyrics.length) {
      subs = Parser.normalizeSubtitles(meta.lyrics.map(([t, text]) => [firstNote + Number(t), text]));
      if (subs.length) subtitleSource = 'config';
    }
    if (!subs.length && embedded.length) { subs = embedded; subtitleSource = 'embedded'; }
    const lyricCount = subs.filter(s => s.t >= firstNote && s.t <= lastNote).length;
    const intro = Array.isArray(meta.intro) && meta.intro.length ? meta.intro : [[title, meta.artist || (config.categoryArtist || {})[category]].filter(Boolean).join(' - ')];
    if (meta.subtitleTiming === 'midi-window-v7') {
      subs = Parser.scheduleSongSubtitles(subs, intro, firstNote, lastNote, meta.subtitlePresentation);
    } else if (!subs.length) {
      const gap = Math.min(12, Math.max(7, (lastNote - firstNote) / (intro.length + 1)));
      subs = Parser.normalizeSubtitles(intro.map((text, i) => [firstNote + 3 + i * gap, text])).filter(s => s.t <= lastNote);
    }
    subKind = lyricCount ? 'lyrics' : 'intro';
    if (!subtitleSource) subtitleSource = 'intro';
    songs.push({
      id,
      title,
      artist: meta.artist || (config.categoryArtist || {})[category] || '',
      category,
      keywords: meta.keywords || '',
      notes,
      notesAll,
      tracks: trackMask,
      duration: Math.round(midi.duration * 10) / 10,
      subKind,
      subtitleSource,
      subtitleStatus: meta.subtitleStatus || "NOT_AUDITIONED",
      lyricCount,
      subs: subs.map(sub => [Math.round(sub.t * 1000) / 1000, sub.text]),
      bytes: buf.length
    });
    data[id] = buf.toString('base64');
  }
}

if (songs.length === 0) fail('曲库为空：midi_library/ 下没有可用的 MIDI 文件');

const featured = [];
for (const title of config.featured || []) {
  const song = songs.find(s => s.title === title);
  if (song) featured.push(song.id);
  else warnings.push(`精选曲目「${title}」未在曲库中找到，已忽略`);
}

const categories = categoryDirs
  .map(name => ({ name, count: songs.filter(s => s.category === name).length }))
  .filter(c => c.count > 0);

const library = { version: 1, total: songs.length, categories, featured, songs };

const banner = `/**
 * 内置曲库数据 —— 由 tools/build-library.js 自动生成，请勿手动编辑。
 * 来源：midi_library/（${songs.length} 首 · ${categories.length} 个分类）
 * 精选置顶：${featured.map(id => songs.find(s => s.id === id).title).join('、')}
 * 全部 MIDI 以 Base64 内联，离线、免跨域、秒载入。
 */`;

const out = `${banner}
(function (root) {
    'use strict';

    root.OW_LIBRARY = ${JSON.stringify(library, null, 2).replace(/\n/g, '\n    ')};

    root.OW_LIBRARY_DATA = {
${Object.entries(data).map(([id, b64]) => `        ${id}: '${b64}'`).join(',\n')}
    };
})(typeof window !== 'undefined' ? window : this);
`;

fs.writeFileSync(OUT_FILE, out);

const totalBytes = songs.reduce((n, s) => n + s.bytes, 0);
console.log(`✓ 已生成 ${path.relative(ROOT, OUT_FILE)}`);
console.log(`  ${songs.length} 首曲目 · ${categories.length} 个分类 · MIDI ${(totalBytes / 1024).toFixed(0)} KB → 输出 ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`);
for (const c of categories) console.log(`  · ${c.name.padEnd(6, '　')} ${c.count} 首`);
console.log(`  精选置顶 ${featured.length} 首`);
const kinds = { lyrics: songs.filter(s => s.subKind === 'lyrics'), intro: songs.filter(s => s.subKind === 'intro'), none: songs.filter(s => !s.subKind) };
console.log(`  字幕：歌词 ${kinds.lyrics.length} 首（${kinds.lyrics.map(s => s.title).join('、') || '无'}）· 背景介绍 ${kinds.intro.length} 首 · 无字幕 ${kinds.none.length} 首${kinds.none.length ? '（' + kinds.none.map(s => s.title).join('、') + '）' : ''}`);
for (const w of warnings) console.warn(`  ⚠ ${w}`);
