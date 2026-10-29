/**
 * 守望先锋钢琴工坊 - MIDI 数据解析与压缩转换核心 (owmidiparser.js)
 * 
 * 专为《守望先锋2》优化，支持：
 * 1. 单曲与多曲目合并打包 (Playlist 多歌切歌系统)
 * 2. 7位定长数据压缩算法 (突破工坊 20,000 元素上限)
 * 3. 跨曲目时间重置 (每首曲目首个和弦 delta time = 0，切歌秒弹)
 */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.OWMidiParser = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // 守望先锋钢琴 65 个琴键范围 (MIDI 24=C1 到 88=E6)
    const PIANO_RANGE = Object.freeze({ MIN: 24, MAX: 88 });
    const OCTAVE = 12;

    const CONVERTER_SETTINGS_INFO = Object.freeze({
        startTime: { MIN: 0, MAX: Infinity, DEFAULT: 0 },
        voices:    { MIN: 6, MAX: 11,       DEFAULT: 10 },
    });

    const DEFAULT_SETTINGS = {
        startTime: CONVERTER_SETTINGS_INFO.startTime.DEFAULT,
        voices:    CONVERTER_SETTINGS_INFO.voices.DEFAULT,
    };

    const MAX_OW_ARRAY_SIZE = 1000;
    const MAX_TOTAL_ARRAY_ELEMENTS = 9000;
    const NOTE_PRECISION = 3;
    const MAX_TIME_INTERVAL = 9999;

    const SONG_DATA_ELEMENT_LENGTHS = {
        pitchArrays: 2,   // 00-64 (2位)
        timeArrays:  4,   // 0000-9999 (4位)
        chordArrays: 2    // 01-11 (2位)
    };

    const COMPRESSED_ELEMENT_LENGTH = 7;

    /**
     * 单曲转换兼容接口
     */
    function convertMidi(mid, settings = {}, isCompressionEnabled = true) {
        return convertSongs([{ name: "Track 1", mid: mid, startTime: settings.startTime || 0 }], settings, isCompressionEnabled);
    }

    /**
     * 多曲目播放列表转换核心接口
     * 
     * @param {Array} songList - [{ name: string, mid: TonejsMidi, startTime: number }]
     * @param {object} settings - { startTime: 0, voices: 6 }
     * @param {boolean} isCompressionEnabled - 默认开启 7 位压缩
     */
    function convertSongs(songList, settings = {}, isCompressionEnabled = true) {
        settings = { ...DEFAULT_SETTINGS, ...settings };

        const owArrays = {
            pitchArrays: [],
            timeArrays: [],
            chordArrays: []
        };

        const songTitles = [];
        const songTimeStarts = [];
        const songTimeEnds = [];
        const songDurations = [];
        // 游戏内字幕（歌词 / 背景介绍）：按曲目展开为扁平数组，songSubStarts/Ends 为每首的区间
        const subTimes = [];
        const subTexts = [];
        const songSubStarts = [];
        const songSubEnds = [];
        const songPitchStarts = [];

        let totalSkippedNotes = 0;
        let totalTransposedNotes = 0;
        let totalNotesCount = 0;
        let totalExportedNotes = 0;
        let totalDuration = 0;
        let totalExportedDuration = 0;

        let totalTimeElements = 0;
        let totalPitchElements = 0;
        let truncated = false;
        let truncationDetails = null;
        const excludedSongs = [];
        const allWarnings = [];
        const allErrors = [];

        for (let sIdx = 0; sIdx < songList.length; sIdx++) {
            const item = songList[sIdx];

            if (!item || !item.mid) {
                allErrors.push(`曲目 [${item && item.name ? item.name : sIdx + 1}] 缺少有效 MIDI 数据`);
                continue;
            }

            // P1: Song name sanitization — strip format placeholders {0}, control chars, { } " \ and normalize spaces, then truncate to 40 chars
            const safeTitle = cleanSubtitleText(item.name || `Song ${sIdx + 1}`);

            // 如果前面的曲目已经触发截断，后续曲目整首无法导入
            if (truncated) {
                allWarnings.push(`曲目 [${safeTitle}] 因工坊容量耗尽未能导入`);
                excludedSongs.push(safeTitle);
                if (truncationDetails) {
                    truncationDetails.excludedSongs = excludedSongs;
                }
                continue;
            }

            try {
                const songSettings = {
                    startTime: item.startTime !== undefined ? item.startTime : settings.startTime,
                    voices: settings.voices,
                    trackMask: item.trackMask
                };

                const midiInfo = readMidiData(item.mid, songSettings);
                totalSkippedNotes += midiInfo.skippedNotes;
                totalTransposedNotes += midiInfo.transposedNotes;
                totalNotesCount += midiInfo.totalNotes;
                // P1: Duration NaN guard
                const origDur = Number.isFinite(item.mid.duration) ? item.mid.duration : 0;
                totalDuration += origDur;

                if (midiInfo.warnings.length) allWarnings.push(...midiInfo.warnings);

                if (midiInfo.chords.size === 0) {
                    allErrors.push(`曲目 [${safeTitle}] 未找到有效音符`);
                    continue;
                }

                // P0-1: Track whether at least one chord was written for this song
                let songWritten = false;
                let isSongTruncated = false;
                let songExportedNotes = 0;
                let lastExportedChordTime = 0;
                const songTimeStart = totalTimeElements;
                const songPitchStart = totalPitchElements;

                let prevTime = midiInfo.chords.keys().next().value;
                const firstChordTime = prevTime;
                let isFirstChord = true;

                for (const [currentChordTime, pitches] of midiInfo.chords.entries()) {
                    const pitchCount = pitches.length;

                    // P0-3: Handle long rests by pre-computing split continuation chords needed
                    let gapMs = isFirstChord ? 0 : roundToPlaces((currentChordTime - prevTime) * 1000, 0);
                    let splitChordsBefore = 0;
                    if (!isFirstChord && gapMs > MAX_TIME_INTERVAL) {
                        let remainingGap = gapMs;
                        while (remainingGap > MAX_TIME_INTERVAL) {
                            splitChordsBefore++;
                            remainingGap -= MAX_TIME_INTERVAL;
                        }
                        gapMs = remainingGap;
                    }

                    // P0-1: Pre-check with candidate values BEFORE committing any state
                    const nextP = totalPitchElements + pitchCount;
                    const nextT = totalTimeElements + splitChordsBefore + 1;

                    const estimatedElements =
                        Math.ceil(nextP / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.pitchArrays) +
                        Math.ceil(nextT / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.timeArrays) +
                        Math.ceil(nextT / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.chordArrays);

                    const uncompressedSize = nextP + nextT * 2;

                    if ((isCompressionEnabled ? estimatedElements : uncompressedSize) > MAX_TOTAL_ARRAY_ELEMENTS) {
                        truncated = true;
                        isSongTruncated = true;
                        const truncSec = Math.max(0, Math.round(currentChordTime - (songSettings.startTime || 0)));
                        const m = Math.floor(truncSec / 60);
                        const s = truncSec % 60;
                        const timeStr = `${m}:${String(s).padStart(2, '0')}`;

                        if (songWritten) {
                            allWarnings.push(`曲目 [${safeTitle}] 尾部在 ${timeStr} 处达到容量上限并截断`);
                            truncationDetails = {
                                type: 'tail',
                                songName: safeTitle,
                                timeStr: timeStr,
                                excludedSongs: excludedSongs
                            };
                        } else {
                            allWarnings.push(`曲目 [${safeTitle}] 因工坊容量耗尽未能导入`);
                            excludedSongs.push(safeTitle);
                            truncationDetails = {
                                type: 'excluded',
                                songName: safeTitle,
                                timeStr: '0:00',
                                excludedSongs: excludedSongs
                            };
                        }
                        break;
                    }

                    // Capacity passed: write split continuation chords for long rests (P0-3)
                    if (!isFirstChord && splitChordsBefore > 0) {
                        for (let s = 0; s < splitChordsBefore; s++) {
                            owArrays.timeArrays.push(MAX_TIME_INTERVAL);
                            owArrays.chordArrays.push(0); // 0 notes in this continuation chord
                        }
                    }

                    // Commit actual element counts only after passing the check
                    totalPitchElements = nextP;
                    totalTimeElements = nextT;

                    // 时间间隔：每首曲目的第一个和弦 delta time 为 0，保证切歌或开局立刻发声！
                    owArrays.timeArrays.push(isFirstChord ? 0 : gapMs);
                    owArrays.chordArrays.push(pitchCount);

                    // P1: sort with numeric comparator
                    for (const p of pitches.sort((a, b) => a - b)) {
                        owArrays.pitchArrays.push(p);
                    }

                    songExportedNotes += pitchCount;
                    lastExportedChordTime = currentChordTime;

                    if (isFirstChord) {
                        isFirstChord = false;
                    }
                    songWritten = true;
                    prevTime = currentChordTime;
                }

                // P0-1: Only add to index tables if at least one chord was written for this song
                if (songWritten) {
                    songTitles.push(safeTitle);
                    songTimeStarts.push(songTimeStart);
                    songPitchStarts.push(songPitchStart);
                    songTimeEnds.push(totalTimeElements);
                    // 游戏内 HUD 进度：首个音符到最后一个已导出音符的时长（秒）
                    songDurations.push(Math.max(1, Math.round(lastExportedChordTime - firstChordTime)));
                    // 字幕时间换算为“相对首个音符”的乐谱时间，与工坊中的 songElapsed 同口径；截断后的字幕一并丢弃
                    songSubStarts.push(subTimes.length);
                    const allSubs = normalizeSubtitles(item.subtitles);
                    const selected = allSubs.filter(sub => sub.t >= firstChordTime && sub.t <= lastExportedChordTime);
                    // 中途开始只带入最近仍可能有效的一句，绝不把历史字幕全部挤到零秒。
                    const previous = allSubs.filter(sub => sub.t < firstChordTime).at(-1);
                    if (previous && firstChordTime - previous.t <= 6 && (!selected.length || selected[0].t - firstChordTime >= 4)) {
                        selected.unshift({ t: firstChordTime, text: previous.text });
                    }
                    if (!selected.length) selected.push({ t: firstChordTime, text: cleanSubtitleText([safeTitle, item.artist].filter(Boolean).join(' - ')) });
                    const remaining = Math.max(0, Math.min(MAX_SUBTITLES_PER_SONG, MAX_OW_ARRAY_SIZE - subTimes.length));
                    if (selected.length > remaining) allWarnings.push(`曲目 [${safeTitle}] 字幕容量不足，保留 ${remaining}/${selected.length} 条；音符数据不变`);
                    const subs = selected.slice(0, remaining);
                    for (const sub of subs) {
                        subTimes.push(Math.round((sub.t - firstChordTime) * 1000) / 1000);
                        subTexts.push(sub.text);
                    }
                    songSubEnds.push(subTimes.length);
                    totalExportedNotes += songExportedNotes;
                    const songDur = isSongTruncated
                        ? Math.max(1, (lastExportedChordTime - (songSettings.startTime || 0)))
                        : (origDur > 0 ? origDur : lastExportedChordTime);
                    totalExportedDuration += songDur;
                }

            } catch (err) {
                // P1: try/catch per song — on error, log and continue to next song
                allErrors.push(`曲目 [${item.name || sIdx}] 处理异常: ${err.message}`);
                continue;
            }
        }

        // Compute actual used array elements (real data, not estimate)
        const usedElements =
            Math.ceil(totalPitchElements / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.pitchArrays) +
            Math.ceil(totalTimeElements / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.timeArrays) +
            Math.ceil(totalTimeElements / COMPRESSED_ELEMENT_LENGTH * SONG_DATA_ELEMENT_LENGTHS.chordArrays);

        let workshopRules = "";
        if (owArrays.timeArrays.length > 0) {
            workshopRules = writeWorkshopRulesMulti(
                owArrays,
                settings.voices,
                isCompressionEnabled,
                { songTitles, songTimeStarts, songTimeEnds, songPitchStarts, songDurations, subTimes, subTexts, songSubStarts, songSubEnds }
            );
        }

        return {
            workshopRules,
            songTitles,
            songTimeStarts,
            songTimeEnds,
            songDurations,
            subtitleCounts: songSubStarts.map((start, i) => songSubEnds[i] - start),
            songPitchStarts,
            totalSongs: songTitles.length,
            totalNotes: totalNotesCount,
            exportedNotes: totalExportedNotes,
            duration: totalDuration,
            exportedDuration: totalExportedDuration,
            warnings: allWarnings,
            errors: allErrors,
            truncated,
            truncationDetails,
            usedElements
        };
    }

    /**
     * 读取 MIDI 音轨，按时间对齐聚合为和弦 Map
     */
    // 乐器在“钢琴缩谱”里的重要性：和弦超出声部数、不得不舍弃音符时，先保住旋律与低音，最后才舍弃铺底
    function programWeight(program) {
        if (program <= 7) return 2.0;            // 钢琴类
        if (program <= 15) return 1.5;           // 色彩打击乐（钟琴、颤音琴等）
        if (program <= 23) return 1.2;           // 风琴
        if (program <= 31) return 1.6;           // 吉他
        if (program <= 39) return 2.2;           // 贝斯
        if (program <= 43) return 1.8;           // 提琴类
        if (program <= 46) return 1.4;           // 颤弓 / 拨弦 / 竖琴
        if (program <= 51) return 1.0;           // 弦乐合奏
        if (program <= 54) return 1.6;           // 合唱 / 人声
        if (program <= 55) return 1.0;           // 管弦乐重击
        if (program <= 63) return 1.8;           // 铜管
        if (program <= 79) return 2.0;           // 簧管 / 笛类（常担任旋律）
        if (program <= 87) return 2.3;           // 合成主音（常担任旋律）
        if (program <= 95) return 0.8;           // 合成铺底
        return 1.0;
    }

    const GHOST_VELOCITY = 0.05;        // 力度低于此值的音在原曲里几乎听不见，放进游戏却是满音量，会变成噪音
    const CROSS_TRACK_FLAM_SEC = 0.045; // 不同音轨在 45ms 内弹同一个音（如吉他与钢琴同奏一条旋律）视为同一个音，避免同一琴键被连敲两次

    function readMidiData(mid, settings) {
        // 音轨选择：trackMask 为参与演奏的音轨序号；不传则使用全部非打击乐音轨
        const mask = settings.trackMask ? new Set(settings.trackMask) : null;
        let transposedNotes = 0;
        let totalNotes = 0;

        const all = [];
        (mid.tracks || []).forEach((track, trackIndex) => {
            if (track.channel === 9) return; // 跳过打击乐通道
            if (mask && !mask.has(trackIndex)) return;
            const weight = programWeight((track.instrument && typeof track.instrument.number === 'number') ? track.instrument.number : 0);

            for (const note of (track.notes || [])) {
                if (typeof note.midi !== 'number' || isNaN(note.midi)) continue;
                totalNotes++;
                if (note.velocity === 0 || note.velocity < GHOST_VELOCITY) continue;
                if (note.time < settings.startTime) continue;

                let notePitch = note.midi;
                if (notePitch < PIANO_RANGE.MIN || notePitch > PIANO_RANGE.MAX) {
                    transposedNotes += 1;
                    notePitch = transposePitch(notePitch);
                }
                all.push({ time: note.time, pitch: notePitch - PIANO_RANGE.MIN, weight: weight + 0.4 * (note.velocity || 0), track: trackIndex });
            }
        });

        // 跨音轨去重：同一音高在 45ms 内又被另一条音轨弹响，只保留最早的那一个
        all.sort((x, y) => x.time - y.time);
        const lastByPitch = new Map();
        const chordNotes = new Map(); // 时间 → (音高 → 权重)
        for (const n of all) {
            const last = lastByPitch.get(n.pitch);
            if (last && last.track !== n.track && n.time - last.time < CROSS_TRACK_FLAM_SEC) {
                const prevChord = chordNotes.get(last.key);
                if (prevChord && prevChord.has(n.pitch)) prevChord.set(n.pitch, Math.max(prevChord.get(n.pitch), n.weight));
                continue;
            }
            const key = roundToPlaces(n.time, NOTE_PRECISION);
            let chord = chordNotes.get(key);
            if (!chord) { chord = new Map(); chordNotes.set(key, chord); }
            if (!chord.has(n.pitch)) chord.set(n.pitch, n.weight);
            else chord.set(n.pitch, Math.max(chord.get(n.pitch), n.weight));
            lastByPitch.set(n.pitch, { time: n.time, track: n.track, key });
        }

        // 同一时刻的音多于声部数时的取舍：最低的两个音（低音线）与最高音（旋律）优先，其余按乐器重要性取舍
        let skippedNotes = 0;
        let chords = new Map();
        for (const [time, notes] of chordNotes) {
            if (notes.size <= settings.voices) {
                chords.set(time, [...notes.keys()]);
                continue;
            }
            const sortedPitches = [...notes.keys()].sort((x, y) => x - y);
            const lowest = new Set(sortedPitches.slice(0, Math.min(2, Math.max(0, settings.voices - 1))));
            const highest = sortedPitches[sortedPitches.length - 1];
            const ranked = sortedPitches
                .map(p => ({ p, score: notes.get(p) + (lowest.has(p) ? 10 : 0) + (p === highest ? 6 : 0) + p * 0.001 }))
                .sort((x, y) => y.score - x.score)
                .slice(0, settings.voices)
                .map(x => x.p);
            skippedNotes += notes.size - ranked.length;
            chords.set(time, ranked);
        }

        let warnings = [];
        let errors = [];

        if (chords.size === 0) {
            errors.push("未找到有效音符");
        } else {
            chords = new Map([...chords.entries()].sort((a, b) => {
                return roundToPlaces(parseFloat(a[0]) - parseFloat(b[0]), NOTE_PRECISION);
            }));
        }

        return { chords, skippedNotes, transposedNotes, totalNotes, warnings, errors };
    }

    // ════════════ 音轨分析与智能选轨 ════════════
    // 很多 MIDI 是整支乐队的编曲（吉他、贝斯、弦乐、合唱、铜管……）。把所有音轨合并到同一架钢琴上会非常拥挤、混乱。
    // 这里分析每条音轨，并给出一个“钢琴化”的默认选择：优先钢琴音轨，必要时补一条旋律轨，去掉重复音轨与不适合钢琴的音色。
    const PROGRAM_FAMILIES = ['钢琴', '色彩打击乐', '风琴', '吉他', '贝斯', '弦乐', '合奏 / 合唱', '铜管', '簧管', '笛类', '合成主音', '合成铺底', '合成效果', '民族乐器', '打击乐', '音效'];
    const PROGRAM_NAMES_ZH = {
        0: '大钢琴', 1: '明亮钢琴', 2: '电子大钢琴', 3: '酒吧钢琴', 4: '电钢琴', 5: '电钢琴 2', 6: '羽管键琴', 7: '击弦古钢琴',
        8: '钢片琴', 9: '钟琴', 10: '八音盒', 11: '颤音琴', 12: '马林巴', 13: '木琴', 14: '管钟', 16: '风琴', 19: '教堂管风琴',
        24: '尼龙弦吉他', 25: '钢弦吉他', 26: '爵士电吉他', 27: '清音电吉他', 28: '闷音电吉他', 29: '过载吉他', 30: '失真吉他',
        32: '原声贝斯', 33: '指弹电贝斯', 34: '拨片电贝斯', 35: '无品贝斯', 36: '击勾贝斯', 38: '合成贝斯',
        40: '小提琴', 41: '中提琴', 42: '大提琴', 43: '低音提琴', 44: '颤弓弦乐', 45: '拨弦', 46: '竖琴', 47: '定音鼓',
        48: '弦乐合奏', 49: '弦乐合奏 2', 50: '合成弦乐', 52: '合唱', 53: '人声“啊”', 54: '合成人声', 55: '管弦乐重击',
        56: '小号', 57: '长号', 58: '大号', 60: '圆号', 61: '铜管组', 62: '合成铜管', 64: '高音萨克斯', 65: '中音萨克斯', 66: '次中音萨克斯',
        68: '双簧管', 69: '英国管', 70: '巴松管', 71: '单簧管', 72: '短笛', 73: '长笛', 74: '竖笛', 75: '排箫', 79: '陶笛',
        80: '方波主音', 81: '锯齿波主音', 88: '合成铺底', 89: '暖色铺底', 90: '复音铺底', 91: '合唱铺底', 92: '弓弦铺底', 95: '扫频铺底'
    };

    function describeProgram(program, isDrum) {
        if (isDrum) return '鼓组';
        if (PROGRAM_NAMES_ZH[program]) return PROGRAM_NAMES_ZH[program];
        return PROGRAM_FAMILIES[Math.floor(program / 8)] || '乐器';
    }

    function analyzeTracks(mid) {
        const out = [];
        (mid.tracks || []).forEach((track, index) => {
            const notes = track.notes || [];
            if (!notes.length) return;
            const events = [];
            let low = 127, high = 0, sum = 0;
            for (const n of notes) {
                events.push([n.time, 1], [n.time + n.duration, -1]);
                low = Math.min(low, n.midi); high = Math.max(high, n.midi); sum += n.midi;
            }
            events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            let cur = 0, maxPoly = 0;
            for (const e of events) { cur += e[1]; maxPoly = Math.max(maxPoly, cur); }
            const program = (track.instrument && typeof track.instrument.number === 'number') ? track.instrument.number : 0;
            const drum = track.channel === 9 || !!(track.instrument && track.instrument.percussion);
            out.push({
                index, name: track.name || '', channel: track.channel, program,
                instrument: (track.instrument && track.instrument.name) || '', label: describeProgram(program, drum),
                notes: notes.length, low, high, avgPitch: sum / notes.length, maxPoly, drum
            });
        });
        return out;
    }

    function selectableNotes(mid, mask) {
        const set = mask ? new Set(mask) : null;
        let n = 0;
        (mid.tracks || []).forEach((track, i) => {
            if (track.channel === 9) return;
            if (set && !set.has(i)) return;
            n += (track.notes || []).length;
        });
        return n;
    }

    // ════ 推荐编曲：钢琴上的最大还原 ════
    // 保留全部有音高的乐器声部（旋律、和声、低音、对位、铺底），只去掉：鼓 / 定音鼓 / 音效、重复声道、几乎没有音符的音轨。
    // 机器人数量（10~11）并不是瓶颈：整支乐队合并后 10 声部的还原度也在 98% 以上。
    // 清晰度由 readMidiData 保证：跨音轨去重（避免同一琴键被连敲两次）、过滤听不见的幽灵音、
    // 和弦超限时按乐器重要性取舍（先保旋律与低音）。
    // 唯一的硬约束是“机器人忙得过来”：10 声部还原度低于 98.5% 时，才依次舍弃最不重要的音轨（铺底 → 弦乐合奏 → ……）。
    function autoSelectTracks(mid, mode = 'rich', voices = 10) {
        const lean = selectLeanTracks(mid);
        if (mode === 'lean') return lean;
        const info = analyzeTracks(mid);
        const tracks = mid.tracks || [];
        const isExcluded = a => a.drum || a.program === 47 || (a.program >= 96 && a.program <= 103) || a.program >= 112;
        const key = n => Math.round(n.time * 25) + ':' + n.midi;
        const dupRatio = (a, b) => {
            const set = new Set(tracks[b.index].notes.map(key));
            let m = 0;
            for (const n of tracks[a.index].notes) if (set.has(key(n))) m++;
            return m / a.notes;
        };
        const kept = [];
        for (const a of [...info.filter(x => !isExcluded(x) && x.notes >= 12)].sort((x, y) => y.notes - x.notes || x.index - y.index)) {
            if (!kept.some(k => dupRatio(a, k) >= 0.7)) kept.push(a);
        }
        let cands = kept.sort((x, y) => x.index - y.index);
        if (!cands.length) return lean;

        const fidelityOf = (list) => estimateFidelity([{ mid, trackMask: list.map(a => a.index) }], voices).ratio;
        // 最不重要的先舍弃：乐器重要性 × 音符量
        const importance = a => programWeight(a.program) * Math.log10(a.notes + 10);
        while (cands.length > 1 && fidelityOf(cands) < 0.985) {
            const drop = [...cands].sort((x, y) => importance(x) - importance(y))[0];
            cands = cands.filter(a => a !== drop);
        }
        return cands.map(a => a.index);
    }

    function selectLeanTracks(mid) {
        const info = analyzeTracks(mid);
        const tracks = mid.tracks || [];
        const isExcluded = a => a.drum || a.program === 47 || (a.program >= 96 && a.program <= 103) || a.program >= 112;
        const isPiano = a => a.program >= 0 && a.program <= 7;
        const key = n => Math.round(n.time * 25) + ':' + n.midi;
        const dupRatio = (a, b) => {
            const set = new Set(tracks[b.index].notes.map(key));
            let m = 0;
            for (const n of tracks[a.index].notes) if (set.has(key(n))) m++;
            return m / a.notes;
        };

        // 1. 去掉鼓 / 定音鼓 / 效果音，并去重：与已保留音轨 ≥70% 相同的视为重复（如同一旋律被两个声道重复演奏）
        const playable = info.filter(a => !isExcluded(a));
        const kept = [];
        for (const a of [...playable].sort((x, y) => y.notes - x.notes || x.index - y.index)) {
            if (!kept.some(k => dupRatio(a, k) >= 0.7)) kept.push(a);
        }
        const cands = kept.sort((x, y) => x.index - y.index);
        if (!cands.length) return info.filter(a => !a.drum).map(a => a.index);
        // 编制很小（≤3 条音轨）：没有必要删减
        if (cands.length <= 3) return cands.map(a => a.index);

        const windows = new Set();
        for (const a of cands) for (const n of tracks[a.index].notes) windows.add(Math.floor(n.time / 4));
        const coverageOf = (list) => {
            const hit = new Set();
            for (const a of list) for (const n of tracks[a.index].notes) hit.add(Math.floor(n.time / 4));
            let c = 0;
            for (const w of windows) if (hit.has(w)) c++;
            return windows.size ? c / windows.size : 1;
        };
        const isMelodic = a => a.program === 40 || a.program === 41 || (a.program >= 52 && a.program <= 54) || (a.program >= 56 && a.program <= 87);
        const melodyScore = a => (a.avgPitch / 12) + Math.log10(a.notes) + ((a.program >= 80 && a.program <= 87) || (a.program >= 52 && a.program <= 54) ? 1.5 : 0);

        let sel = cands.filter(isPiano);
        const rest = () => cands.filter(a => !sel.includes(a));
        if (sel.length) {
            // 钢琴编曲里缺少一条贯穿全曲的旋律线时，补一条最合适的旋律音轨
            const pianoNotes = sel.reduce((n, a) => n + a.notes, 0);
            const pianoHigh = Math.max(...sel.map(a => a.avgPitch));
            const mel = rest()
                .filter(a => isMelodic(a) && a.maxPoly <= 3 && a.notes >= 100 && a.avgPitch >= pianoHigh + 3
                    && (coverageOf([a]) >= 0.4 || a.notes >= pianoNotes * 0.25))
                .sort((x, y) => melodyScore(y) - melodyScore(x))[0];
            if (mel) sel.push(mel);
        } else {
            // 没有钢琴：取一条旋律 + 一条低音 + 一条和声
            const mel = rest().filter(a => a.maxPoly <= 2 && a.notes >= 60 && a.avgPitch >= 57).sort((x, y) => melodyScore(y) - melodyScore(x))[0];
            if (mel) sel.push(mel);
            const bass = rest().filter(a => a.avgPitch < 50 && a.notes >= 60).sort((x, y) => y.notes - x.notes)[0];
            if (bass) sel.push(bass);
            const harm = rest().filter(a => a.maxPoly >= 2 && a.notes >= 60).sort((x, y) => y.notes - x.notes)[0];
            if (harm) sel.push(harm);
        }
        // 保证时间线覆盖：选出的音轨在整首曲子里不能留下大段空白
        let cov = coverageOf(sel);
        for (let k = 0; k < 2 && cov < 0.9; k++) {
            const next = rest().map(a => ({ a, gain: coverageOf([...sel, a]) - cov })).sort((x, y) => y.gain - x.gain)[0];
            if (!next || next.gain < 0.03) break;
            sel.push(next.a);
            cov = coverageOf(sel);
        }
        if (!sel.length) sel = cands.slice(0, 1);
        return sel.map(a => a.index).sort((x, y) => x - y);
    }

    /**
     * 7位数字打包压缩
     */
    function compressSongArrays(owArrays) {
        const compressedArrays = {
            pitchArrays: [],
            timeArrays: [],
            chordArrays: []
        };

        for (const [arrayName, songArray] of Object.entries(owArrays)) {
            const paddedArray = songArray.map(x =>
                x.toString().padStart(SONG_DATA_ELEMENT_LENGTHS[arrayName], "0")
            );
            const stringBuffer = paddedArray.join("");

            for (let i = 0; i < stringBuffer.length; i += COMPRESSED_ELEMENT_LENGTH) {
                compressedArrays[arrayName].push(stringBuffer.slice(i, i + COMPRESSED_ELEMENT_LENGTH));
            }
        }

        return compressedArrays;
    }

    /**
     * 生成工坊规则文本 (支持多曲目元数据)
     */
    function writeWorkshopRulesMulti(owArrays, maxVoices, isCompressionEnabled, meta) {
        const workshopRules = [];

        const titlesFormatted = meta.songTitles.map(t => `Custom String("${cleanSubtitleText(t)}")`).join(", ");
        const timeStartsFormatted = meta.songTimeStarts.join(", ");
        const timeEndsFormatted = meta.songTimeEnds.join(", ");
        const pitchStartsFormatted = meta.songPitchStarts.join(", ");

        // 首条规则：乐谱全局元数据与切歌索引表
        let firstRule = `rule("General song data"){event{Ongoing-Global;}actions{\n` +
                        `Global.maxBots = ${maxVoices};\n` +
                        `Global.maxArraySize = ${MAX_OW_ARRAY_SIZE};\n` +
                        `Global.isCompressionEnabled = ${isCompressionEnabled};\n` +
                        `Global.currentSongIndex = 0;\n` +
                        `Global.songTitles = Array(${titlesFormatted});\n` +
                        `Global.songTimeStarts = Array(${timeStartsFormatted});\n` +
                        `Global.songTimeEnds = Array(${timeEndsFormatted});\n` +
                        `Global.songPitchStarts = Array(${pitchStartsFormatted});\n` +
                        `Global.songDurations = Array(${(meta.songDurations || meta.songTitles.map(() => 1)).join(", ")});\n`;

        if (isCompressionEnabled) {
            owArrays = compressSongArrays(owArrays);

            firstRule += `Global.compressedElementLength = ${COMPRESSED_ELEMENT_LENGTH};\n` +
                `Global.compressionInfo = Array(Array(${owArrays.pitchArrays.slice(-1)[0].length},` +
                `${owArrays.timeArrays.slice(-1)[0].length},` +
                `${owArrays.chordArrays.slice(-1)[0].length}),` +
                `Array(${SONG_DATA_ELEMENT_LENGTHS.pitchArrays},` +
                `${SONG_DATA_ELEMENT_LENGTHS.timeArrays},` +
                `${SONG_DATA_ELEMENT_LENGTHS.chordArrays}));`;
        }

        const subStarts = meta.songSubStarts || meta.songTitles.map(() => 0);
        const subEnds = meta.songSubEnds || meta.songTitles.map(() => 0);
        firstRule += `Global.subStarts = Array(${subStarts.join(", ")});\n` +
                      `Global.subEnds = Array(${subEnds.join(", ")});\n`;

        firstRule += `}}\n`;
        workshopRules.push(firstRule);

        // 字幕数据：每 40 条一组追加，避免单个 Array() 字面量过长
        const subTimes = meta.subTimes || [];
        const subTexts = meta.subTexts || [];
        let subRule = `rule("Subtitles"){event{Ongoing-Global;}actions{\nGlobal.subTimes = Empty Array;\nGlobal.subTexts = Empty Array;\n`;
        for (let i = 0; i < subTimes.length; i += 40) {
            const times = subTimes.slice(i, i + 40);
            const texts = subTexts.slice(i, i + 40).map(t => `Custom String("${cleanSubtitleText(t)}")`);
            subRule += `Modify Global Variable(subTimes, Append To Array, Array(${times.join(", ")}));\n` +
                       `Modify Global Variable(subTexts, Append To Array, Array(${texts.join(", ")}));\n`;
        }
        subRule += `}}\n`;
        workshopRules.push(subRule);

        // 写入 pitchArrays, timeArrays, chordArrays，每 1000 个元素切分一条规则
        for (const [arrayName, songArray] of Object.entries(owArrays)) {
            let owArrayIndex = 0;
            let index = 0;

            while (index < songArray.length) {
                let actions = `Global.${arrayName}[${owArrayIndex}] = Array(${songArray[index]}`;
                owArrayIndex += 1;
                index += 1;

                for (let j = 0; j < MAX_OW_ARRAY_SIZE - 1; j++) {
                    if (index >= songArray.length) break;
                    actions += `, ${songArray[index]}`;
                    index += 1;
                }

                workshopRules.push(
                    `rule("${arrayName}"){event{Ongoing-Global;}actions{${actions});}}` + "\n"
                );
            }
        }

        return workshopRules.join("");
    }

    function transposePitch(pitch) {
        while (pitch < PIANO_RANGE.MIN) pitch += OCTAVE;
        while (pitch > PIANO_RANGE.MAX) pitch -= OCTAVE;
        return pitch;
    }

    // 机器人忙碌模拟：每次按键约占用 0.112 秒；按轮询顺序分配，被分到的机器人仍在按键时该音丢失
    function simulateBusy(chords, bots, speedPercent = 100) {
        const BUSY = 0.112, TICK = 0.016;
        const speed = (speedPercent || 100) / 100;
        const busyUntil = new Array(bots).fill(-1);
        let botIdx = 0, played = 0;
        for (const [time, pitches] of chords.entries()) {
            const t = Math.ceil(parseFloat(time) / speed / TICK) * TICK;
            const usedThisTick = new Set();
            for (let k = 0; k < pitches.length; k++) {
                const b = botIdx;
                botIdx = (botIdx + 1) % bots;
                if (busyUntil[b] > t + 1e-9 || usedThisTick.has(b)) continue;
                busyUntil[b] = t + BUSY;
                usedThisTick.add(b);
                played++;
            }
        }
        return played;
    }

    /**
     * 估算指定声部数下的游戏内音符还原度（与工坊播放逻辑同口径）
     * 两类丢音：① 同一时刻和弦音数超过声部数被截断（保旋律与低音）；② 机器人轮询分配时仍在按键（约 0.112s）导致后续音符丢失
     * @returns {{ total: number, played: number, ratio: number }}
     */
    function estimateFidelity(songList, voices, speedPercent = 100) {
        let total = 0, played = 0;
        for (const item of (songList || [])) {
            if (!item || !item.mid) continue;
            const full = readMidiData(item.mid, { startTime: 0, voices: Number.MAX_SAFE_INTEGER, trackMask: item.trackMask });
            const cut = readMidiData(item.mid, { startTime: 0, voices, trackMask: item.trackMask });
            for (const pitches of full.chords.values()) total += pitches.length;
            played += simulateBusy(cut.chords, voices, speedPercent);
        }
        return { total, played, ratio: total ? played / total : 1 };
    }

    const MAX_SUBTITLES_PER_SONG = 1000;
    const MAX_SUBTITLE_LENGTH = 48;

    // 字幕只允许“游戏字体里一定有字形”的字符：汉字、ASCII 可打印字符、最常用的中文标点。
    // 其余字符（带重音的拉丁字母、书名号、各种破折号 / 省略号、emoji、控制字符等）要么先映射为基础字符，要么删除，
    // 避免 Small Message 出现方块、问号或整行空白。
    const SUBTITLE_PUNCT_MAP = [
        [/[《〈«]/g, '“'], [/[》〉»]/g, '”'], [/[「『]/g, '“'], [/[」』]/g, '”'],
        [/[…⋯]/g, '...'], [/[—–―－]/g, '-'], [/[～〜]/g, '~'], [/[‘’`´＇]/g, "'"],
        [/[\u3000\u00a0\u2000-\u200a]/g, ' '], [/[：]/g, '：'], [/[•・‧∙]/g, '·']
    ];
    const SUBTITLE_ALLOWED = /[\u4e00-\u9fff\u0020-\u007e，。！？、：；（）“”·]/;

    function cleanSubtitleText(text) {
        let t = String(text == null ? '' : text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
            .replace(/<[^>]*>/g, '').replace(/\{[0-9]+\}/g, '');
        for (const [re, to] of SUBTITLE_PUNCT_MAP) t = t.replace(re, to);
        // Custom String 不能包含的字符：{ } " \ < >，以及控制字符 / 零宽字符
        t = t.replace(/[\x00-\x1f\x7f-\x9f{}"\\<>\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ');
        // 白名单之外的字符一律删除（不是替换成空格，避免产生多余空白）
        t = [...t].filter(c => SUBTITLE_ALLOWED.test(c)).join('');
        t = t.replace(/\s+/g, ' ').trim();
        // 按码点截断，不切开代理对
        const chars = [...t];
        return chars.length > MAX_SUBTITLE_LENGTH ? chars.slice(0, MAX_SUBTITLE_LENGTH - 1).join('') + '...' : chars.join('');
    }

    function normalizeSubtitles(list) {
        if (!Array.isArray(list)) return [];
        const result = [], seen = new Set();
        const sorted = list.map(item => Array.isArray(item) ? { t: Number(item[0]), text: item[1] } : { t: Number(item && item.t), text: item && item.text })
            .filter(item => Number.isFinite(item.t) && item.t >= 0)
            .map(item => ({ t: item.t, text: cleanSubtitleText(item.text) }))
            .filter(item => item.text).sort((a, b) => a.t - b.t);
        for (const item of sorted) {
            const key = `${item.t.toFixed(3)}\u0000${item.text}`;
            if (!seen.has(key)) { result.push(item); seen.add(key); }
        }
        return result;
    }

    function decodeText(bytes, encoding = 'utf-8') {
        try { return new TextDecoder(encoding).decode(bytes); }
        catch (e) { return Array.from(bytes, b => String.fromCharCode(b)).join(''); }
    }

    // 有界读取 SMF。轨道坏数据只使该轨歌词失效，不干扰音符解析器。
    function extractEmbeddedLyrics(input, midi) {
        if (!midi || !midi.header || typeof midi.header.ticksToSeconds !== 'function') return [];
        const b = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (b.length < 14 || String.fromCharCode(...b.slice(0, 4)) !== 'MThd') return [];
        const read32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
        if (read32(4) < 6 || 8 + read32(4) > b.length) return [];
        // SMF format 2 的独立序列不能用同一个全局秒时间轴合并。
        if (((b[8] << 8) | b[9]) === 2 || (b[12] & 0x80)) return [];
        const candidates = [];
        for (let p = 8 + read32(4), trackId = 0; p + 8 <= b.length; trackId++) {
            const end = p + 8 + read32(p + 4);
            if (end > b.length) break;
            if (String.fromCharCode(...b.slice(p, p + 4)) !== 'MTrk') { p = end; continue; }
            let q = p + 8, tick = 0, running = 0, name = '', events = [], malformed = false;
            const vlq = () => {
                let value = 0;
                for (let i = 0; i < 4; i++) {
                    if (q >= end) throw new Error('Incomplete MIDI VLQ');
                    const c = b[q++]; value = value * 128 + (c & 127);
                    if (!(c & 128)) return value;
                }
                throw new Error('Oversized MIDI VLQ');
            };
            try {
                while (q < end) {
                    tick += vlq();
                    if (q >= end) throw new Error('Missing MIDI event');
                    const st = b[q];
                    if (st === 0xff) {
                        if (q + 2 > end) throw new Error('Incomplete meta event');
                        const type = b[q + 1]; q += 2;
                        const len = vlq();
                        if (q + len > end) throw new Error('Incomplete meta payload');
                        if (type === 1 || type === 5) events.push({ tick, type, bytes: b.slice(q, q + len) });
                        if (type === 3) name = decodeText(b.slice(q, q + len));
                        q += len; running = 0;
                        if (type === 0x2f) break;
                    } else if (st === 0xf0 || st === 0xf7) {
                        q++;
                        // 必须先读取长度，再移动指针；q += vlq() 会丢失 VLQ 自身的长度。
                        const len = vlq();
                        if (q + len > end) throw new Error('Incomplete SysEx payload');
                        q += len; running = 0;
                    } else {
                        if (st & 128) { if (st >= 0xf0) throw new Error('Invalid SMF status'); running = st; q++; }
                        if (running < 0x80) throw new Error('Missing running status');
                        const len = (running & 0xf0) === 0xc0 || (running & 0xf0) === 0xd0 ? 1 : 2;
                        if (q + len > end || Array.from(b.slice(q, q + len)).some(v => v & 128)) throw new Error('Invalid channel event');
                        q += len;
                    }
                }
            } catch (e) { malformed = true; }
            p = end;
            if (malformed || !events.length) continue;
            let encoding = 'utf-8';
            try { for (const e of events) new TextDecoder('utf-8', { fatal: true }).decode(e.bytes); }
            catch (e) { encoding = 'gbk'; }
            const decoded = events.map(e => ({ ...e, text: decodeText(e.bytes, encoding) }))
                .filter(e => !/^\s*@/.test(e.text));
            for (const type of [5, 1]) {
                const source = decoded.filter(e => e.type === type);
                const karaoke = source.some(e => /^[\/\\\r\n]/.test(e.text));
                const meaningful = source.filter(e => cleanSubtitleText(e.text.replace(/[\/\\\r\n]/g, '')));
                const named = /lyric|word|vocal|歌词|歌詞/i.test(name);
                if (!meaningful.length || (type === 1 && !karaoke && !named && meaningful.length < 4)) continue;
                if (type === 1 && meaningful.at(-1).tick === meaningful[0].tick) continue;
                if (meaningful.every(e => e.tick === 0) && !karaoke && meaningful.length === 1) continue;
                if (meaningful.some(e => (e.text.match(/\ufffd/g) || []).length > e.text.length * 0.15)) continue;
                const lines = [];
                let current = null, lastTick = 0;
                const flush = () => { if (current && cleanSubtitleText(current.text)) lines.push(current); current = null; };
                for (const ev of source) {
                    const before = /^[\/\\\r\n]/.test(ev.text), after = /[\r\n]$/.test(ev.text);
                    const text = ev.text.replace(/[\/\\\r\n]/g, '');
                    const t = midi.header.ticksToSeconds(ev.tick);
                    if (!Number.isFinite(t) || t < 0) continue;
                    if (before) flush();
                    if (!cleanSubtitleText(text)) { if (after) flush(); continue; }
                    // 普通 TextEvent 默认逐条成句；KAR/标准 Lyrics 保留音节拼接。
                    const cjkPhraseBreak = !karaoke && current && /[\u3400-\u9fff]/.test(current.text)
                        && (([...current.text].length >= 5 && t - midi.header.ticksToSeconds(lastTick) > 0.5) || [...current.text].length >= 18);
                    if (current && ((!karaoke && type === 1) || cjkPhraseBreak || (!karaoke && t - midi.header.ticksToSeconds(lastTick) > 1.8)
                        || [...(current.text + text)].length > MAX_SUBTITLE_LENGTH)) flush();
                    if (!current) current = { t, text: '' }; // 空换页标记绝不占用起唱时间。
                    current.text += text; lastTick = ev.tick;
                    if (after) flush();
                }
                flush();
                const clean = normalizeSubtitles(lines);
                if (clean.length) candidates.push({ trackId, type, lines: clean, score: clean.length + (karaoke ? 20 : 0) + (type === 5 ? 10 : 0) + (named ? 5 : 0) });
            }
        }
        candidates.sort((a, b) => b.score - a.score);
        if (!candidates.length) return [];
        // 主轨优先；其他轨只补充没有时间覆盖的段落，避免双语/重复轨串词。
        let lines = candidates[0].lines.slice();
        for (const candidate of candidates.slice(1)) {
            const first = lines[0].t, last = lines.at(-1).t;
            const complement = candidate.lines.filter(l => l.t < first - 8 || l.t > last + 8);
            lines = normalizeSubtitles(lines.concat(complement));
        }
        return lines;
    }

    // 所有输入/输出都使用 MIDI 绝对秒。介绍只占有足够阅读间隔的前奏。
    function scheduleSongSubtitles(lyrics, intro, firstNote, lastNote, presentation = {}) {
        if (!Number.isFinite(firstNote) || !Number.isFinite(lastNote) || lastNote < firstNote) return [];
        const lines = normalizeSubtitles(lyrics).filter(s => s.t >= firstNote && s.t <= lastNote);
        const descriptions = (Array.isArray(intro) ? intro : []).map(cleanSubtitleText).filter(Boolean);
        const extra = [];
        // 精选曲目的介绍只顺序播放一次。按真实音符窗口均匀安排，不通过取模回到开头。
        // 文案库负责提供足够的新内容；这里不重复刷新 Small Message，也不改音乐时钟。
        if (presentation && presentation.mode === 'one-pass-background' && !lines.length && descriptions.length) {
            const cards = [...new Set(descriptions)];
            const lead = Math.min(1, Math.max(0, Number(presentation.leadIn) || 0));
            const start = firstNote + Math.min(lead, (lastNote - firstNote) / 4);
            const end = Math.max(start, lastNote - 0.05);
            const step = cards.length > 1 ? (end - start) / (cards.length - 1) : 0;
            return normalizeSubtitles(cards.slice(0, MAX_SUBTITLES_PER_SONG)
                .map((text, i) => ({ t: start + i * step, text })));
        }
        // 无可靠歌词时，介绍随当前 MIDI 演奏窗口连续轮换；不改变音符与工坊时钟。
        // 有歌词时不进入此分支，仍通过已确认的空窗安排说明。
        if (presentation && presentation.mode === 'continuous-background' && !lines.length && descriptions.length) {
            const requested = Number(presentation.cadence);
            const cadence = Number.isFinite(requested) ? Math.min(10, Math.max(3, requested)) : 4;
            const requestedLead = Number(presentation.leadIn);
            const lead = Number.isFinite(requestedLead) ? Math.min(3, Math.max(0, requestedLead)) : 1;
            const start = firstNote + Math.min(lead, (lastNote - firstNote) / 4);
            const outro = (Array.isArray(presentation.outro) ? presentation.outro : []).map(cleanSubtitleText).filter(Boolean);
            const count = Math.min(1000, Math.floor((lastNote - start) / cadence) + 1);
            for (let i = 0; i < count; i++) {
                const remaining = count - i;
                const text = outro.length && count > outro.length + 2 && remaining <= outro.length
                    ? outro[outro.length - remaining]
                    : descriptions[i % descriptions.length];
                extra.push({ t: start + i * cadence, text });
            }
            return normalizeSubtitles(extra);
        }
        // 空窗必须由该编曲明确标注；不能把两句歌词之间的距离自动当成间奏。
        // 不循环重复短介绍，也不修改音乐时钟或 Small Message 的游戏内生命周期。
        if (presentation && presentation.mode === 'background-windows') {
            const cadence = Math.min(12, Math.max(4, Number(presentation.cadence) || 6));
            const windows = (Array.isArray(presentation.windows) ? presentation.windows : [])
                .filter(w => Array.isArray(w) && w.length >= 2 && Number.isFinite(w[0]) && Number.isFinite(w[1]) && w[1] > w[0])
                .map(w => [Math.max(firstNote, w[0]), Math.min(lastNote, w[1])])
                .filter(w => w[1] > w[0]).sort((a, b) => a[0] - b[0]);
            let card = 0, previous = -Infinity;
            for (const [start, end] of windows) {
                for (let t = start; t <= end && card < descriptions.length; t += cadence) {
                    if (t - previous < cadence || lines.some(l => Math.abs(l.t - t) < 6)) continue;
                    extra.push({ t, text: descriptions[card++] });
                    previous = t;
                }
            }
            return normalizeSubtitles(lines.concat(extra)).filter(s => s.t <= lastNote);
        }
        if (lines.length) {
            const limit = Math.min(lastNote, lines[0].t - 8);
            for (let i = 0, t = firstNote + 3; i < descriptions.length && t <= limit; i++, t += 9) extra.push({ t, text: descriptions[i] });
        } else if (descriptions.length) {
            const duration = lastNote - firstNote;
            const count = Math.min(descriptions.length, Math.max(1, Math.floor(duration / 9)));
            for (let i = 0; i < count; i++) extra.push({ t: firstNote + Math.min(3, duration / 4) + i * Math.max(9, (duration * 0.72 - 3) / Math.max(1, count - 1)), text: descriptions[i] });
        }
        return normalizeSubtitles(lines.concat(extra)).filter(s => s.t <= lastNote);
    }

    /** LRC 的全局 offset 无论写在哪一行，都对整首生效。 */
    function parseLrc(text, extraOffset = 0) {
        const rows = String(text || '').split(/\r?\n/), out = [];
        let offset = 0;
        for (const raw of rows) {
            const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
            if (off) offset = Number(off[1]) / 1000;
        }
        for (const raw of rows) {
            const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
            const lyric = raw.replace(/\[[^\]]*\]/g, '').trim();
            if (!lyric) continue;
            for (const tag of tags) {
                const seconds = Number(tag[2].replace(':', '.'));
                if (seconds >= 60) continue;
                out.push({ t: Number(tag[1]) * 60 + seconds + offset + (Number(extraOffset) || 0), text: lyric });
            }
        }
        return normalizeSubtitles(out);
    }


    function roundToPlaces(value, decimalPlaces) {
        return Math.round(value * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
    }

    return {
        convertMidi,
        convertSongs,
        readMidiData,
        analyzeTracks,
        autoSelectTracks,
        selectLeanTracks,
        selectableNotes,
        estimateFidelity,
        extractEmbeddedLyrics,
        parseLrc,
        normalizeSubtitles,
        scheduleSongSubtitles,
        cleanSubtitleText,
        compressSongArrays,
        transposePitch,
        roundToPlaces,
        PIANO_RANGE,
        MAX_OW_ARRAY_SIZE,
        MAX_TOTAL_ARRAY_ELEMENTS,
        SONG_DATA_ELEMENT_LENGTHS,
        COMPRESSED_ELEMENT_LENGTH,
        DEFAULT_SETTINGS,
        CONVERTER_SETTINGS_INFO
    };
}));
