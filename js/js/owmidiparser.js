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
            const safeTitle = (item.name || `Song ${sIdx + 1}`)
                .replace(/\{[0-9]+\}/g, '')
                .replace(/[\x00-\x1f\x7f{}"\\]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 40);

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
                    voices: settings.voices
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
                { songTitles, songTimeStarts, songTimeEnds, songPitchStarts }
            );
        }

        return {
            workshopRules,
            songTitles,
            songTimeStarts,
            songTimeEnds,
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
    function readMidiData(mid, settings) {
        let chords = new Map();
        let skippedNotes = 0;
        let transposedNotes = 0;
        let totalNotes = 0;

        for (const track of (mid.tracks || [])) {
            if (track.channel === 9) continue; // 跳过打击乐通道

            for (const note of (track.notes || [])) {
                if (typeof note.midi !== 'number' || isNaN(note.midi)) continue;
                totalNotes++;
                if (note.velocity === 0) continue;
                if (note.time < settings.startTime) continue;

                let notePitch = note.midi;
                if (notePitch < PIANO_RANGE.MIN || notePitch > PIANO_RANGE.MAX) {
                    transposedNotes += 1;
                    notePitch = transposePitch(notePitch);
                }

                notePitch -= PIANO_RANGE.MIN;
                const noteTime = roundToPlaces(note.time, NOTE_PRECISION);

                if (!chords.has(noteTime)) {
                    chords.set(noteTime, [notePitch]);
                } else {
                    if (!chords.get(noteTime).includes(notePitch)) {
                        if (chords.get(noteTime).length < settings.voices) {
                            chords.get(noteTime).push(notePitch);
                        } else {
                            skippedNotes += 1;
                        }
                    }
                }
            }
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

        const titlesFormatted = meta.songTitles.map(t => `Custom String("${t}")`).join(", ");
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
                        `Global.songPitchStarts = Array(${pitchStartsFormatted});\n`;

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

        firstRule += `}}\n`;
        workshopRules.push(firstRule);

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

    function roundToPlaces(value, decimalPlaces) {
        return Math.round(value * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
    }

    return {
        convertMidi,
        convertSongs,
        readMidiData,
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
