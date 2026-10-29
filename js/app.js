/**
 * 守望先锋钢琴工坊 - 前端业务架构与状态机引擎 (app.js - V3 Architecture)
 * 
 * 核心架构特性：
 * 1. 严格响应式状态机驱动 (EMPTY, PARSING, READY, GENERATING, COPIED, ERROR)
 * 2. 配置与列表变更自动重新生成 (100ms 防抖，杜绝脏代码)
 * 3. 导出列表 (Export Playlist) 与 当前试听 (Selected Preview) 双概念分离
 * 4. 真实数据指标展示 (去伪存真，零曲目时展示引导卡片而非虚假 0 统计)
 * 5. 纯前端高品质 WebAudio 钢琴合成器试听
 * 6. 3 秒剪贴板复制动效反馈与游戏内导入指引联动高亮
 */

(function () {
    "use strict";

    // ════════════ 1. 状态机状态定义 ════════════
    const APP_STATE = Object.freeze({
        EMPTY: "EMPTY",               // 0. 无曲目：显示 #emptyStateView 引导，隐藏指标展台
        PARSING: "PARSING",           // 1. 解析中：正在读取或解码 MIDI 音轨
        READY: "READY",               // 2. 已就绪：代码生成完毕，展示真实数据与橙色复制按钮
        OVER_CAPACITY: "OVER_CAPACITY", // 2.5 截断：超出 9,000 音符上限，展示已截断有效代码复制
        GENERATING: "GENERATING",     // 3. 生成中：配置或列表发生变动，后台防抖重算
        COPIED: "COPIED",             // 4. 已复制：瞬态反馈，高亮 #inGameGuideSection
        ERROR: "ERROR",               // 5. 异常：解析或转换失败，显示错误提示与恢复建议

        // 兼容别名
        READY_COPY: "READY",
        LOADED: "READY",
        DIRTY: "GENERATING"
    });

    let currentState = APP_STATE.EMPTY;

    // ════════════ 2. 数据模型与全局运行时变量 ════════════
    // 播放列表数据结构：[{ id, name, mid, duration, notesCount, isSample }]
    let playlist = [];
    let selectedPreviewIndex = 0;
    let generatedCode = "";
    let isCodeExpanded = false;
    let copyTimeoutId = null;
    let toastTimeoutId = null;
    let regenDebounceTimer = null;
    let lastErrorMessage = "";
    let currentGenVersion = 0;
    let hasConfigChanged = false;
    let newlyAddedSongId = null;
    let lastIsTruncated = false;

    const MAX_TOTAL_ARRAY_ELEMENTS = 9000;
    const MAX_SONGS_LIMIT = 6; // 最多保留 6 首歌曲同时输入

    // ════════════ 3. DOM 元素缓存 (含防御式空检查) ════════════
    const card1_musicManage = document.getElementById("card1_musicManage");
    const tabPresetLibrary = document.getElementById("tabPresetLibrary");
    const tabPlaylist = document.getElementById("tabPlaylist");
    const tabPlaylistBadge = document.getElementById("tabPlaylistBadge");
    const card1Viewport = document.getElementById("card1Viewport");
    const tabPanePresets = document.getElementById("tabPanePresets");
    const tabPanePlaylist = document.getElementById("tabPanePlaylist");
    const playlistEmptyNotice = document.getElementById("playlistEmptyNotice");
    const btnGotoPresets = document.getElementById("btnGotoPresets");
    const capacityNormalBar = document.getElementById("capacityNormalBar");
    const capacityBarFill = document.getElementById("capacityBarFill");
    const capacityBarText = document.getElementById("capacityBarText");
    const capacitySegments = document.getElementById("capacitySegments");

    const dropzone = document.getElementById("dropzone");
    const midiFileInput = document.getElementById("midiFileInput");
    const playlistContainer = document.getElementById("playlistContainer");
    const playlistTable = document.getElementById("playlistTable");
    const playlistTbody = document.getElementById("playlistTbody");
    const playlistCount = document.getElementById("playlistCount");
    const capacityIndicator = document.getElementById("capacityIndicator");
    const capacityAlertBanner = document.getElementById("capacityAlertBanner");
    const capacityAlertIcon = document.getElementById("capacityAlertIcon");
    const capacityAlertTitle = document.getElementById("capacityAlertTitle");
    const capacityAlertDesc = document.getElementById("capacityAlertDesc");
    const clearPlaylistBtn = document.getElementById("clearPlaylistBtn");

    const startTimeInput = document.getElementById("startTimeInput");
    const voicesSelect = document.getElementById("voicesSelect");
    const cardVoice10 = document.getElementById("cardVoice10");
    const cardVoice8 = document.getElementById("cardVoice8");
    const cardVoice11 = document.getElementById("cardVoice11");
    const summaryRoomPill = document.getElementById("summaryRoomPill");

    // V3 状态展示视图卡片
    const emptyStateView = document.getElementById("emptyStateView");
    const processingStateView = document.getElementById("processingStateView");
    const processingText = document.getElementById("processingText");
    const readyStateView = document.getElementById("readyStateView");
    const inGameGuideSection = document.getElementById("inGameGuideSection");

    // 指标展台与曲目信息
    const displaySongTitle = document.getElementById("displaySongTitle");
    const previewSongName = document.getElementById("previewSongName");
    const readyStatusPill = document.getElementById("readyStatusPill");
    const dispTotalSongs = document.getElementById("dispTotalSongs");
    const dispNotes = document.getElementById("dispNotes");
    const dispDuration = document.getElementById("dispDuration");
    const dispPoint = document.getElementById("dispPoint");
    const dispBotMode = document.getElementById("dispBotMode");
    const dispControlPerm = document.getElementById("dispControlPerm");

    // 行动按钮组
    const coreActionBtn = document.getElementById("coreActionBtn");
    const coreActionText = document.getElementById("coreActionText");
    const coreActionSubline = document.getElementById("coreActionSubline");
    const downloadBtn = document.getElementById("downloadBtn");
    const previewAudioBtn = document.getElementById("previewAudioBtn");
    const toggleCodeBtn = document.getElementById("toggleCodeBtn");
    const codeWrapper = document.getElementById("codeWrapper");
    const codePreview = document.getElementById("codePreview");

    // 模式与预设
    const botInvisibleBtn = document.getElementById("botInvisibleBtn");
    const botVisibleBtn = document.getElementById("botVisibleBtn");
    const controlHostOnlyBtn = document.getElementById("controlHostOnlyBtn");
    const controlAllPlayersBtn = document.getElementById("controlAllPlayersBtn");
    // 内置曲库（数据由 tools/build-library.js 生成到 js/samplesData.js）
    const LIBRARY = (typeof window !== "undefined" && window.OW_LIBRARY) || { total: 0, categories: [], featured: [], songs: [] };
    const LIBRARY_DATA = (typeof window !== "undefined" && window.OW_LIBRARY_DATA) || {};
    const librarySongById = new Map(LIBRARY.songs.map(song => [song.id, song]));
    // 旧版示例类型名 → 曲名，兼容旧接口与测试脚本
    const LEGACY_SAMPLE_ALIASES = {
        birthday: "生日快乐", queen: "波西米亚狂想曲", lanting: "兰亭序", greatwork: "最伟大的作品",
        tingmama: "听妈妈的话", fanfangxiang: "反方向的钟", huahai: "花海", yilu: "一路向北", titanic: "我心永恒"
    };
    const libraryList = document.getElementById("libraryList");
    const librarySearch = document.getElementById("librarySearch");
    const librarySearchClear = document.getElementById("librarySearchClear");
    const libraryFilters = document.getElementById("libraryFilters");
    const libraryCount = document.getElementById("libraryCount");
    const toast = document.getElementById("toast");

    // 拟真声学大钢琴 WebAudio 物理建模引擎状态
    let audioCtx = null;
    let isAudioPlaying = false;

    // 工坊容量与警告状态跟踪
    let lastParserWarnings = [];
    let lastCompressedSize = null;
    let lastParserResult = null;
    let lastExportedNotes = 0;
    let lastExportedDuration = 0;
    let lastTruncationDetails = null;


    // ════════════ 4. 辅助与工具函数 ════════════
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return "00:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    }

    function formatNumber(num) {
        if (typeof num !== "number" || isNaN(num)) return "0";
        return num.toLocaleString("en-US");
    }

    function getTrackBadgeHtml(isSample) {
        if (isSample) {
            return `<span class="track-badge badge-sample">曲库</span>`;
        } else {
            return `<span class="track-badge badge-uploaded">本地上传</span>`;
        }
    }

    const ICON_PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
    const ICON_STOP = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>';
    const ICON_EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';

    function setPreviewBtnPlaying(playing) {
        if (!previewAudioBtn) return;
        previewAudioBtn.innerHTML = playing
            ? `<span>${ICON_STOP}停止试听</span>`
            : `<span>${ICON_PLAY}试听选中曲目</span>`;
        if (previewAudioBtn.classList) previewAudioBtn.classList.toggle("is-playing", playing);
        const bar = document.querySelector(".now-bar");
        if (bar) bar.classList.toggle("is-playing", playing);
        syncRowPlayState();
        if (trackPopEl) renderTrackPicker(trackPopEl);
    }

    // 列表行的播放状态：正在试听的那一行显示均衡器动画，悬停时变为停止键
    function syncRowPlayState() {
        if (!playlistTbody) return;
        playlistTbody.querySelectorAll(".playlist-row").forEach(row => {
            const idx = parseInt(row.getAttribute("data-idx"), 10);
            const playing = isAudioPlaying && idx === selectedPreviewIndex;
            row.classList.toggle("is-playing", playing);
            const btn = row.querySelector(".btn-row-play");
            if (btn) {
                const name = (playlist[idx] && playlist[idx].name) || "";
                btn.setAttribute("aria-label", `${playing ? "停止试听" : "试听"} ${name}`);
                btn.title = playing ? "停止试听" : "试听这首";
                btn.setAttribute("aria-pressed", playing ? "true" : "false");
            }
        });
    }

    function setCodeToggleLabel(expanded) {
        if (!toggleCodeBtn) return;
        toggleCodeBtn.innerHTML = `${ICON_EYE}${expanded ? "收起代码原文" : "查看代码原文"}`;
    }

    function showToast(message, type = "success", quiet = false) {
        if (!toast) return;
        toast.textContent = message;
        if (quiet) {
            // R5: Suppress visible popup for single-song additions to reduce visual noise,
            // while preserving element textContent for automated regression tests
            return;
        }
        toast.className = `toast show ${type}`;
        if (toastTimeoutId) {
            clearTimeout(toastTimeoutId);
        }
        toastTimeoutId = setTimeout(() => {
            toast.className = "toast";
        }, 3000);
    }

    // 同步地图点位与机器人模式文本展示
    function syncSettingsDisplay() {
        const checkedPiano = document.querySelector("input[name='piano']:checked");
        if (checkedPiano && dispPoint) {
            dispPoint.textContent = checkedPiano.value === "pointA" ? "巴黎·点位A" : "巴黎·点位B";
        }
        const checkedBot = document.querySelector("input[name='botVisibility']:checked");
        const voicesVal = parseInt(voicesSelect ? voicesSelect.value : 10, 10) || 10;
        let voicesDesc = "10声部(双人私享)";
        if (voicesVal === 8) voicesDesc = "8声部(四人小队)";
        else if (voicesVal === 11) voicesDesc = "11声部(单人独享)";
        if (checkedBot && dispBotMode) {
            const botType = checkedBot.value === "invisible" ? "幽灵隐形" : "实体显形";
            dispBotMode.textContent = `${botType} · ${voicesVal}声部`;
        }
        if (summaryRoomPill) {
            if (voicesVal === 8) summaryRoomPill.textContent = "四人小队 (8声部)";
            else if (voicesVal === 11) summaryRoomPill.textContent = "单人独享 (11声部)";
            else summaryRoomPill.textContent = "双人私享 (10声部)";
        }
        const checkedControl = document.querySelector("input[name='pianoControl']:checked");
        if (checkedControl && dispControlPerm) {
            dispControlPerm.textContent = checkedControl.value === "hostOnly" ? "仅房主" : "全员共享";
        }
    }

    // 计算工坊预算容量 (支持真实解析压缩元素数与预估音符估算)
    function calculateCapacity(targetList, actualElements) {
        const list = targetList || playlist;
        if (!list || list.length === 0) {
            return {
                percent: 0,
                elements: 0,
                text: "预估容量: 0% · 空间充足",
                color: "var(--text-dim)",
                level: "normal"
            };
        }

        let totalNotes = 0;
        for (const song of list) {
            totalNotes += song.notesCount || 0;
        }

        // 7位压缩下平均每个音符占用约 0.77~0.80 个数组元素
        const estimatedElements = Math.round(totalNotes * 0.78);
        const finalElements = (typeof actualElements === "number" && actualElements > 0) ? actualElements : estimatedElements;
        const percent = Math.round((finalElements / MAX_TOTAL_ARRAY_ELEMENTS) * 100);

        let statusText = "";
        let color = "var(--text-dim)";
        let level = "normal";
        if (lastIsTruncated || percent > 100) {
            statusText = `预估容量: ${percent > 100 ? '>100%' : '100%'} · 超出容量限制 (已截断)`;
            color = "var(--danger-red, #EF4444)";
            level = "danger";
        } else if (percent < 90) {
            statusText = `预估容量: ${percent}% · 空间充足`;
            color = "var(--text-dim)";
            level = "normal";
        } else {
            statusText = `预估容量: ${percent}% · 接近上限`;
            color = "var(--warn-amber, #F59E0B)";
            level = "warn";
        }

        return { percent, elements: finalElements, text: statusText, color, level };
    }

    function updateCapacity() {
        const cap = calculateCapacity(null, lastCompressedSize);
        if (capacityIndicator) {
            capacityIndicator.textContent = cap.text;
            capacityIndicator.style.color = cap.color;
        }

        // P0-2: 严格根据真实截断标记或元素超额触发 danger，杜绝由于音阶移调等正常 warning 产生超限误报
        const isDanger = (lastIsTruncated === true) || cap.percent > 100;
        const isWarn = !isDanger && (cap.percent >= 90);

        // 1. 20-Segment Capacity Bar 支持
        const segs = document.getElementById("capacitySegments") || capacitySegments;
        if (segs) {
            const numOn = Math.min(20, Math.round((cap.percent / 100) * 20));
            segs.className = isDanger ? 'cap-segments over' : (isWarn ? 'cap-segments warn' : 'cap-segments');
            if (segs.children) {
                for (let idx = 0; idx < segs.children.length; idx++) {
                    segs.children[idx].className = (idx < numOn) ? 'on' : '';
                }
            }
        }

        // 向后兼容现存测试与普通进度条
        if (capacityBarFill) {
            capacityBarFill.style.width = `${Math.min(cap.percent, 100)}%`;
        }
        if (capacityBarText) {
            capacityBarText.textContent = `工坊容量: ${cap.percent}% · ${isDanger ? '超出上限已截断' : (isWarn ? '接近上限' : '空间充足')}`;
        }

        if (capacityNormalBar) {
            if (playlist.length === 0) {
                capacityNormalBar.style.display = "none";
            } else if (isDanger || isWarn) {
                capacityNormalBar.style.display = "none";
            } else {
                capacityNormalBar.style.display = "flex";
            }
        }

        if (capacityAlertBanner) {
            if (playlist.length === 0) {
                capacityAlertBanner.style.display = "none";
            } else if (isDanger) {
                capacityAlertBanner.className = "capacity-alert-banner danger";
                capacityAlertBanner.style.display = "flex";
                if (capacityAlertTitle) capacityAlertTitle.textContent = `已达 9,000 上限并安全截断`;
                if (capacityAlertDesc) {
                    const td = lastTruncationDetails;
                    if (td) {
                        if (td.type === 'tail') {
                            if (td.excludedSongs && td.excludedSongs.length > 0) {
                                capacityAlertDesc.textContent = `《${td.songName}》在 ${td.timeStr} 处达到上限截断，后续 ${td.excludedSongs.length} 首曲目未能导入。导出的工坊代码完全有效可用。`;
                            } else {
                                capacityAlertDesc.textContent = `《${td.songName}》在 ${td.timeStr} 处达到 9,000 数组元素上限并截断尾部音符。导出的工坊代码完全有效可用。`;
                            }
                        } else if (td.type === 'excluded') {
                            const exclList = td.excludedSongs && td.excludedSongs.length > 0 ? td.excludedSongs.join('》《') : td.songName;
                            capacityAlertDesc.textContent = `曲目《${exclList}》因达到 9,000 上限未能导入。导出的工坊代码完全有效可用。`;
                        } else {
                            capacityAlertDesc.textContent = "已自动截断保留前 9,000 数组元素，导出的工坊代码完全有效可用。";
                        }
                    } else {
                        capacityAlertDesc.textContent = "已自动截断保留前 9,000 数组元素，导出的工坊代码完全有效可用。";
                    }
                }
            } else if (isWarn) {
                capacityAlertBanner.className = "capacity-alert-banner warn";
                capacityAlertBanner.style.display = "flex";
                if (capacityAlertTitle) capacityAlertTitle.textContent = `工坊容量预警：容量已达 ${cap.percent}% (接近上限)`;
                if (capacityAlertDesc) {
                    capacityAlertDesc.textContent = `当前排队曲目数据量较大（已占用 ${cap.elements.toLocaleString()} / 9,000 数组元素）。若继续添加高密度长曲将触发截断。`;
                }
            } else {
                capacityAlertBanner.style.display = "none";
            }
            // 横幅高度固定，完整说明通过悬浮提示查看
            if (capacityAlertDesc) capacityAlertBanner.title = capacityAlertDesc.textContent;
            refreshLeanButton(capacityAlertBanner.style.display !== "none");
        }
    }
    const updateCapacityIndicator = updateCapacity;

    // 容量吃紧时：把所有多音轨歌曲改为“精简钢琴”编曲（只留钢琴与旋律）
    function leanMaskOf(song) {
        if (!song.leanTracks && window.OWMidiParser) song.leanTracks = window.OWMidiParser.autoSelectTracks(song.mid, "lean");
        return song.leanTracks || song.trackMask;
    }
    const sameMask = (x, y) => x.length === y.length && x.every(v => y.includes(v));
    function refreshLeanButton(bannerVisible) {
        const btn = document.getElementById("capacityLeanBtn");
        if (!btn) return;
        const canLean = bannerVisible && playlist.some(sg => sg.tracks && sg.tracks.length > 1 && !sameMask(sg.trackMask, leanMaskOf(sg)));
        btn.hidden = !canLean;
    }
    const leanBtnEl = document.getElementById("capacityLeanBtn");
    if (leanBtnEl) {
        leanBtnEl.addEventListener("click", () => {
            stopAudioPreview();
            let changed = 0;
            for (const sg of playlist) {
                if (!sg.tracks || sg.tracks.length < 2) continue;
                const lean = leanMaskOf(sg);
                if (sameMask(sg.trackMask, lean)) continue;
                sg.trackMask = lean.slice().sort((p, q) => p - q);
                sg.trackMode = "lean";
                sg.notesCount = window.OWMidiParser.selectableNotes(sg.mid, sg.trackMask);
                changed++;
            }
            if (changed) {
                hasConfigChanged = true;
                renderPlaylist();
                triggerAutoRegenerate(false);
                showToast(`已将 ${changed} 首歌改为精简钢琴编曲，占用的工坊容量更少`, "info");
            }
        });
    }

    function updateCoreActionSubline() {
        const subline = document.getElementById("coreActionSubline") || coreActionSubline;
        if (!subline) return;
        const durText = (dispDuration && dispDuration.textContent) ? dispDuration.textContent : "00:00";
        if (currentState === APP_STATE.OVER_CAPACITY) {
            const expNotes = (lastParserResult && typeof lastParserResult.exportedNotes === 'number')
                ? lastParserResult.exportedNotes
                : playlist.reduce((acc, s) => acc + (s.notesCount || 0), 0);
            const expSongs = (lastParserResult && lastParserResult.songTitles)
                ? lastParserResult.songTitles.length
                : playlist.length;
            subline.textContent = `导出 ${expSongs} 首曲目 · 实际写入 ${formatNumber(expNotes)} 个音符 · 时长 ${durText} · 代码有效可用`;
        } else if (currentState === APP_STATE.READY) {
            const totalNotes = playlist.reduce((acc, s) => acc + (s.notesCount || 0), 0);
            subline.textContent = `包含 ${playlist.length} 首曲目 · 共 ${formatNumber(totalNotes)} 个音符 · 时长 ${durText}`;
        } else if (currentState === APP_STATE.COPIED) {
            if (lastIsTruncated) {
                const expNotes = (lastParserResult && typeof lastParserResult.exportedNotes === 'number')
                    ? lastParserResult.exportedNotes
                    : playlist.reduce((acc, s) => acc + (s.notesCount || 0), 0);
                const expSongs = (lastParserResult && lastParserResult.songTitles)
                    ? lastParserResult.songTitles.length
                    : playlist.length;
                subline.textContent = `导出 ${expSongs} 首曲目 · 实际写入 ${formatNumber(expNotes)} 个音符 · 时长 ${durText} · 代码有效可用`;
            } else {
                const totalNotes = playlist.reduce((acc, s) => acc + (s.notesCount || 0), 0);
                subline.textContent = `包含 ${playlist.length} 首曲目 · 共 ${formatNumber(totalNotes)} 个音符 · 时长 ${durText}`;
            }
        } else {
            subline.textContent = "";
        }
    }

    // ════════════ 5. 核心状态机驱动与视图渲染 ════════════
    function setAppState(newState, extraInfo) {
        if (copyTimeoutId && newState !== APP_STATE.COPIED) {
            clearTimeout(copyTimeoutId);
            copyTimeoutId = null;
        }

        currentState = newState;

        // 1. 控制右栏主视图与乐谱列表容器的显隐切换及上传区域自适应折叠 (V3.2 自适应折叠与展开)
        if (playlist.length === 0) {
            if (dropzone) {
                dropzone.classList.remove("compact");
                dropzone.classList.add("dropzone-expanded");
            }
            if (playlistContainer) playlistContainer.style.display = "none";
            if (playlistEmptyNotice) playlistEmptyNotice.style.display = "flex";
            if (tabPlaylistBadge) tabPlaylistBadge.textContent = "(0)";
            if (emptyStateView) emptyStateView.style.display = (newState === APP_STATE.PARSING) ? "none" : "flex";
            if (processingStateView) processingStateView.style.display = (newState === APP_STATE.PARSING) ? "flex" : "none";
            if (readyStateView) readyStateView.style.display = "none";
        } else {
            if (dropzone) {
                dropzone.classList.add("compact");
                dropzone.classList.remove("dropzone-expanded");
            }
            if (playlistContainer) playlistContainer.style.display = "block";
            if (playlistEmptyNotice) playlistEmptyNotice.style.display = "none";
            if (tabPlaylistBadge) tabPlaylistBadge.textContent = `(${playlist.length})`;
            if (emptyStateView) emptyStateView.style.display = "none";
            if (processingStateView) processingStateView.style.display = (newState === APP_STATE.PARSING) ? "flex" : "none";
            if (readyStateView) {
                const showReady = (newState === APP_STATE.READY || newState === APP_STATE.OVER_CAPACITY || newState === APP_STATE.GENERATING || newState === APP_STATE.COPIED || newState === APP_STATE.ERROR);
                readyStateView.style.display = showReady ? "flex" : "none";
            }
        }

        // 2. 根据状态刷新状态徽章、行动按钮与辅助工具
        const coreActionSubline = document.getElementById("coreActionSubline");
        const ctaWrap = document.querySelector(".cta-wrap");

        switch (newState) {
            case APP_STATE.EMPTY:
                lastParserWarnings = [];
                lastCompressedSize = null;
                lastIsTruncated = false;
                if (capacityAlertBanner) capacityAlertBanner.style.display = "none";
                if (capacityNormalBar) capacityNormalBar.style.display = "none";
                if (playlistContainer) playlistContainer.style.display = "none";
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill waiting";
                    readyStatusPill.textContent = "等待文件";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-disabled";
                    coreActionBtn.disabled = true;
                    if (coreActionBtn.removeAttribute) coreActionBtn.removeAttribute("data-state");
                }
                if (coreActionText) {
                    coreActionText.textContent = "第一步：请在左侧上传 MIDI 乐谱文件";
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "等待在左侧选择示例或载入 MIDI 乐谱";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap disabled";
                }
                if (playlistCount) playlistCount.textContent = `已载入 0 / ${MAX_SONGS_LIMIT} 首`;
                if (dispTotalSongs) dispTotalSongs.textContent = "0 首";
                if (dispNotes) dispNotes.textContent = "0 个";
                if (dispDuration) dispDuration.textContent = "00:00";
                if (previewAudioBtn) {
                    previewAudioBtn.disabled = true;
                    setPreviewBtnPlaying(false);
                }
                if (downloadBtn) downloadBtn.disabled = true;
                if (toggleCodeBtn) toggleCodeBtn.disabled = true;
                if (inGameGuideSection) inGameGuideSection.classList.remove("guide-highlighted");
                break;

            case APP_STATE.PARSING:
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill generating";
                    readyStatusPill.textContent = "正在解析 MIDI...";
                }
                if (processingText) {
                    processingText.textContent = extraInfo || "正在解析音轨数据并分配机器人声部...";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-disabled";
                    coreActionBtn.disabled = true;
                    if (coreActionBtn.removeAttribute) coreActionBtn.removeAttribute("data-state");
                }
                if (coreActionText) {
                    coreActionText.textContent = "正在解析 MIDI 文件...";
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "正在计算琴键物理击打三维向量与多声部排队...";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap disabled";
                }
                if (previewAudioBtn) previewAudioBtn.disabled = true;
                if (downloadBtn) downloadBtn.disabled = true;
                if (toggleCodeBtn) toggleCodeBtn.disabled = true;
                break;

            case APP_STATE.GENERATING:
                if (playlistContainer) playlistContainer.style.display = "block";
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill generating";
                    readyStatusPill.textContent = "正在重新生成代码...";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-disabled";
                    coreActionBtn.disabled = true;
                    if (coreActionBtn.removeAttribute) coreActionBtn.removeAttribute("data-state");
                }
                if (coreActionText) {
                    coreActionText.textContent = "正在更新工坊代码...";
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "正在计算琴键物理击打三维向量与多声部排队...";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap disabled";
                }
                if (previewAudioBtn) previewAudioBtn.disabled = false;
                if (downloadBtn) downloadBtn.disabled = true;
                if (toggleCodeBtn) toggleCodeBtn.disabled = true;
                break;

            case APP_STATE.READY:
                lastIsTruncated = false;
                if (playlistContainer) playlistContainer.style.display = "block";
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill ready";
                    readyStatusPill.textContent = `已就绪 (${playlist.length} 首曲目)`;
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-ready-copy";
                    coreActionBtn.disabled = false;
                    if (coreActionBtn.setAttribute) {
                        coreActionBtn.setAttribute("data-state", "ready");
                    }
                }
                if (coreActionText) {
                    if (hasConfigChanged) {
                        coreActionText.textContent = "复制工坊规则代码 (最新)";
                    } else {
                        coreActionText.textContent = playlist.length > 1
                            ? `复制工坊规则代码 (共 ${playlist.length} 首)`
                            : `复制工坊规则代码`;
                    }
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "点击自动复制到剪贴板 · 进入守望先锋自定比赛 [从剪贴板粘贴]";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap";
                }
                if (previewAudioBtn) previewAudioBtn.disabled = false;
                if (downloadBtn) downloadBtn.disabled = false;
                if (toggleCodeBtn) toggleCodeBtn.disabled = false;
                if (inGameGuideSection) inGameGuideSection.classList.remove("guide-highlighted");
                break;

            case APP_STATE.OVER_CAPACITY:
                lastIsTruncated = true;
                if (playlistContainer) playlistContainer.style.display = "block";
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill over-capacity";
                    readyStatusPill.textContent = "容量超限 (已截断)";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-over-capacity";
                    coreActionBtn.disabled = false;
                    if (coreActionBtn.setAttribute) {
                        coreActionBtn.setAttribute("data-state", "over");
                    }
                }
                if (coreActionText) {
                    coreActionText.textContent = "复制截断代码 (前 9,000 元素)";
                }
                updateCoreActionSubline();
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap over-capacity";
                }
                if (previewAudioBtn) previewAudioBtn.disabled = false;
                if (downloadBtn) downloadBtn.disabled = false;
                if (toggleCodeBtn) toggleCodeBtn.disabled = false;
                if (inGameGuideSection) inGameGuideSection.classList.remove("guide-highlighted");
                break;

            case APP_STATE.COPIED:
                if (playlistContainer) playlistContainer.style.display = "block";
                const isTruncatedCopy = lastIsTruncated;
                if (readyStatusPill) {
                    readyStatusPill.className = isTruncatedCopy ? "status-pill over-capacity" : "status-pill ready";
                    readyStatusPill.textContent = isTruncatedCopy ? "已复制已截断代码" : "已复制到剪贴板";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-copied";
                    coreActionBtn.disabled = false;
                    if (coreActionBtn.setAttribute) coreActionBtn.setAttribute("data-state", "copied");
                }
                if (coreActionText) {
                    coreActionText.textContent = isTruncatedCopy ? "已复制已截断代码！" : "已复制到剪贴板！";
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "代码已复制！进入游戏导入规则时文本语言须为 English";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap copied";
                }
                // 高亮游戏内导入指引 (不发生跳屏突变，杜绝强制展开和自动滚动)
                if (inGameGuideSection) {
                    inGameGuideSection.classList.add("guide-highlighted");
                }
                break;

            case APP_STATE.ERROR:
                lastErrorMessage = extraInfo || "未知错误";
                if (readyStatusPill) {
                    readyStatusPill.className = "status-pill error";
                    readyStatusPill.textContent = "生成异常";
                }
                if (coreActionBtn) {
                    coreActionBtn.className = "btn-core-action state-dirty";
                    coreActionBtn.disabled = false;
                    if (coreActionBtn.removeAttribute) coreActionBtn.removeAttribute("data-state");
                }
                if (coreActionText) {
                    coreActionText.textContent = "生成异常 · 点击重新尝试";
                }
                if (coreActionSubline) {
                    coreActionSubline.textContent = "生成异常 · 请检查 MIDI 文件音轨后重试";
                }
                if (ctaWrap) {
                    ctaWrap.className = "cta-wrap disabled";
                }
                if (previewAudioBtn) previewAudioBtn.disabled = false;
                if (downloadBtn) downloadBtn.disabled = true;
                if (toggleCodeBtn) toggleCodeBtn.disabled = true;
                break;
        }
    }

    // ════════════ 6. 防抖自动生成核心 (V3.2 版本防竞态与一致性保证) ════════════
    function triggerAutoRegenerate(immediate = false) {
        if (playlist.length === 0) {
            if (regenDebounceTimer) {
                clearTimeout(regenDebounceTimer);
                regenDebounceTimer = null;
            }
            currentGenVersion++;
            generatedCode = "";
            setAppState(APP_STATE.EMPTY);
            return;
        }

        // 立即作废旧的已复制瞬态反馈
        if (copyTimeoutId) {
            clearTimeout(copyTimeoutId);
            copyTimeoutId = null;
        }

        // 递增版本号，防御异步竞争
        const thisVersion = ++currentGenVersion;

        if (regenDebounceTimer) {
            clearTimeout(regenDebounceTimer);
            regenDebounceTimer = null;
        }

        setAppState(APP_STATE.GENERATING);

        if (immediate) {
            executeGenerateSync(thisVersion);
        } else {
            regenDebounceTimer = setTimeout(() => {
                executeGenerateSync(thisVersion);
            }, 100);
        }
    }

    function executeGenerateSync(expectedVersion) {
        if (expectedVersion !== undefined && expectedVersion !== currentGenVersion) {
            return; // 放弃过期的旧版本任务
        }

        if (playlist.length === 0) {
            setAppState(APP_STATE.EMPTY);
            return;
        }

        try {
            const checkedPiano = document.querySelector("input[name='piano']:checked");
            const selectedPiano = checkedPiano ? checkedPiano.value : "pointB";

            const checkedBot = document.querySelector("input[name='botVisibility']:checked");
            const invisibleBots = checkedBot ? checkedBot.value === "invisible" : true;

            const checkedControl = document.querySelector("input[name='pianoControl']:checked");
            const hostOnly = checkedControl ? checkedControl.value === "hostOnly" : true;

            const startTime = Math.max(0, parseFloat(startTimeInput ? startTimeInput.value : 0) || 0);
            const voices = parseInt(voicesSelect ? voicesSelect.value : 10, 10) || 10;

            const songsPayload = playlist.map(item => ({
                name: item.name,
                artist: item.artist || "",
                mid: item.mid,
                startTime: startTime,
                trackMask: item.trackMask,
                subtitles: item.subtitles || []
            }));

            if (!window.OWMidiParser || !window.OWWorkshopTemplate) {
                throw new Error("工坊解析核心或模板引擎尚未正确载入");
            }

            const parserResult = window.OWMidiParser.convertSongs(songsPayload, {
                startTime: startTime,
                voices: voices
            }, true);

            if (expectedVersion !== undefined && expectedVersion !== currentGenVersion) {
                return; // 异步或耗时操作后再次校验版本
            }

            if (parserResult.errors && parserResult.errors.length > 0) {
                showToast(parserResult.errors[0], "error");
                setAppState(APP_STATE.ERROR, parserResult.errors[0]);
                return;
            }

            lastParserWarnings = parserResult.warnings || [];
            lastParserResult = parserResult;
            lastExportedNotes = parserResult.exportedNotes || 0;
            lastExportedDuration = parserResult.exportedDuration || 0;
            lastTruncationDetails = parserResult.truncationDetails || null;

            // P0-2: Use real usedElements from convertSongs instead of estimate
            lastCompressedSize = (typeof parserResult.usedElements === 'number' && parserResult.usedElements > 0)
                ? parserResult.usedElements : null;

            const newCode = window.OWWorkshopTemplate.generateFullSettings(parserResult.workshopRules, {
                piano: selectedPiano,
                maxVoices: voices,
                invisibleBots: invisibleBots,
                hostOnly: hostOnly,
                songTitles: parserResult.songTitles
            });

            if (expectedVersion !== undefined && expectedVersion !== currentGenVersion) {
                return; // 最终写入前再次校验版本
            }

            generatedCode = newCode;

            if (codePreview) {
                codePreview.value = generatedCode;
            }

            // P0-2: OVER_CAPACITY only when truncated===true (not based on percentage estimate)
            lastIsTruncated = (parserResult.truncated === true);
            if (lastIsTruncated) {
                setAppState(APP_STATE.OVER_CAPACITY);
                // 截断时：统计格和副行改用解析器实际写入的音符数与时长，避免误导用户
                if (dispNotes && typeof parserResult.exportedNotes === 'number') {
                    dispNotes.textContent = `${formatNumber(parserResult.exportedNotes)} 个`;
                }
                if (dispDuration && typeof parserResult.exportedDuration === 'number') {
                    dispDuration.textContent = formatTime(parserResult.exportedDuration);
                }
                updateCoreActionSubline();
            } else {
                setAppState(APP_STATE.READY);
                const totalNotes = playlist.reduce((acc, s) => acc + (s.notesCount || 0), 0);
                const totalDuration = playlist.reduce((acc, s) => acc + (s.duration || 0), 0);
                if (dispNotes) dispNotes.textContent = `${formatNumber(totalNotes)} 个`;
                if (dispDuration) dispDuration.textContent = formatTime(totalDuration);
                updateCoreActionSubline();
            }
            updateCapacityIndicator();

        } catch (err) {
            if (expectedVersion !== undefined && expectedVersion !== currentGenVersion) {
                return;
            }
            console.error("生成失败:", err);
            showToast("生成失败: " + err.message, "error");
            setAppState(APP_STATE.ERROR, err.message);
        }
    }

    // ════════════ 7. 播放列表渲染与双概念管理 ════════════
    // 声部卡片：按当前歌单实时估算 8 / 10 / 11 声部下的音符还原度
    const fidelityCache = new Map();
    function updateVoiceFidelity() {
        const cards = [[cardVoice8, 8], [cardVoice10, 10], [cardVoice11, 11]];
        const parser = typeof window !== "undefined" ? window.OWMidiParser : null;
        const results = {};
        if (playlist.length && parser && parser.estimateFidelity) {
            for (const [, v] of cards) {
                const key = playlist.map(s => s.id + ":" + (s.trackMask || []).join(",")).join("|") + "@" + v;
                if (!fidelityCache.has(key)) {
                    fidelityCache.set(key, parser.estimateFidelity(playlist.map(s => ({ mid: s.mid, trackMask: s.trackMask })), v));
                }
                results[v] = fidelityCache.get(key);
            }
        }
        for (const [el, v] of cards) {
            const sub = el && el.querySelector(".choice-subdesc");
            if (!sub) continue;
            const r = results[v];
            if (!r) {
                sub.textContent = "加入曲目后估算";
                sub.removeAttribute("title");
                sub.classList.remove("is-lossless", "is-lossy");
                continue;
            }
            const pct = r.ratio * 100;
            const lost = r.total - r.played;
            sub.textContent = lost === 0 ? "无损 100%" : `还原 ${pct >= 99.95 ? "99.9" : pct.toFixed(1)}%`;
            sub.title = `当前歌单共 ${formatNumber(r.total)} 个音符，${v} 声部下预计可弹出 ${formatNumber(r.played)} 个${lost ? `，丢失 ${formatNumber(lost)} 个（密集和弦或快速连音时机器人不够用）` : ""}`;
            sub.classList.toggle("is-lossless", lost === 0);
            sub.classList.toggle("is-lossy", pct < 97);
        }
    }

    function updatePresetChipsStatus() {
        updateVoiceFidelity();
        if (!libraryList) return;
        libraryList.querySelectorAll(".preset-chip[data-song-id]").forEach(chipEl => {
            const song = librarySongById.get(chipEl.getAttribute("data-song-id"));
            const inList = !!song && findPlaylistIndexForSong(song) !== -1;
            chipEl.classList.toggle("in-playlist", inList);
            chipEl.setAttribute("aria-pressed", inList ? "true" : "false");
        });
        // 分组标题上显示“已选 n”，折叠时也能看到这一组有没有选过歌
        libraryList.querySelectorAll(".lib-section").forEach(sec => {
            const badge = sec.querySelector(".lib-section-picked");
            if (!badge) return;
            const n = sec.querySelectorAll(".preset-chip.in-playlist").length;
            badge.textContent = n ? `已选 ${n}` : "";
        });
    }

    // ════════════ 音轨选择：智能钢琴化 + 手动勾选 ════════════
    let trackPopEl = null;
    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const midiNoteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

    function trackChipHtml(song, idx) {
        if (!song.tracks || song.tracks.length < 2) return "";
        const total = song.tracks.length;
        const picked = song.tracks.filter(t => song.trackMask.includes(t.index)).length;
        const custom = song.trackMode === "custom";
        return `<button type="button" class="btn-tracks${custom ? " is-custom" : ""}" data-idx="${idx}" aria-haspopup="dialog" title="这首歌有 ${total} 条音轨，当前 ${picked} 条参与演奏。点击选择">音轨 ${picked}/${total}</button>`;
    }

    function closeTrackPicker() {
        if (!trackPopEl) return;
        trackPopEl.remove();
        trackPopEl = null;
        document.removeEventListener("mousedown", onTrackPickerOutside, true);
        document.removeEventListener("keydown", onTrackPickerKey, true);
    }
    function onTrackPickerOutside(e) {
        if (trackPopEl && !trackPopEl.contains(e.target) && !e.target.closest(".btn-tracks")) closeTrackPicker();
    }
    function onTrackPickerKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); closeTrackPicker(); }
    }

    // 应用新的音轨选择：重新统计音符数、停止试听、重新生成工坊代码
    function applyTrackMask(idx, mask, mode) {
        const song = playlist[idx];
        const parser = window.OWMidiParser;
        if (!song || !parser) return;
        stopAudioPreview();
        song.trackMask = mask.slice().sort((a, b) => a - b);
        song.trackMode = mode;
        song.notesCount = parser.selectableNotes(song.mid, song.trackMask);
        hasConfigChanged = true;
        renderPlaylist();
        triggerAutoRegenerate(false);
    }

    function renderTrackPicker(pop) {
        const idx = parseInt(pop.dataset.idx, 10);
        const song = playlist[idx];
        if (!song) { closeTrackPicker(); return; }
        const maxNotes = Math.max(...song.tracks.map(t => t.notes), 1);
        const picked = song.tracks.filter(t => song.trackMask.includes(t.index));
        const modeText = { curated: "推荐编曲", auto: "推荐编曲", lean: "精简钢琴", custom: "手动选择", all: "全部音轨" }[song.trackMode] || "";
        pop.innerHTML = `
            <div class="tp-head">
                <div class="tp-title">${escapeHtml(song.name)}</div>
                <div class="tp-sub">参与演奏 ${picked.length}/${song.tracks.length} 条 · ${formatNumber(song.notesCount)} 个音符 · <b>${modeText}</b></div>
            </div>
            <div class="tp-actions">
                <button type="button" class="tp-act" data-act="recommended" title="钢琴上的最大还原：保留全部有音高的声部，去掉鼓、重复声道和听不见的幽灵音">推荐编曲</button>
                <button type="button" class="tp-act" data-act="lean" title="只保留钢琴与旋律，最干净">精简钢琴</button>
                <button type="button" class="tp-act" data-act="all" title="全部音轨原样合并（含重复声道、定音鼓等）">全部音轨</button>
            </div>
            <div class="tp-list">${song.tracks.map(t => {
                const on = song.trackMask.includes(t.index);
                const tip = `${t.instrument || t.label} · 通道 ${t.channel + 1}${t.name ? " · " + t.name : ""}`;
                const soloing = isAudioPlaying && pianoSession && pianoSession.solo === t.index && String(pianoSession.soloSongId) === String(song.id);
                return `<div class="tp-row${on ? " on" : ""}${soloing ? " soloing" : ""}">
                    <label class="tp-check" title="${escapeHtml(tip)}">
                        <input type="checkbox" data-track="${t.index}" ${on ? "checked" : ""}>
                        <span class="tp-main"><span class="tp-name">${escapeHtml(t.label)}</span><span class="tp-meta">${formatNumber(t.notes)} 音 · ${midiNoteName(t.low)}–${midiNoteName(t.high)}</span></span>
                        <span class="tp-bar"><i style="width:${Math.max(4, Math.round(t.notes / maxNotes * 100))}%"></i></span>
                    </label>
                    <button type="button" class="tp-solo" data-solo="${t.index}" title="${soloing ? "停止试听" : "只听这一条音轨"}" aria-label="${soloing ? "停止" : "单独试听"} ${escapeHtml(t.label)}" aria-pressed="${soloing}">${soloing
                        ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>'
                        : '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>'}</button>
                </div>`;
            }).join("")}</div>
            <div class="tp-foot">推荐编曲 = 钢琴上的最大还原：保留全部有音高的声部，去掉鼓、重复声道和听不见的幽灵音。点每条音轨右边的 ▶ 可以单独试听，听出哪一条不合适就取消勾选。</div>`;
    }

    function openTrackPicker(idx, anchor) {
        const song = playlist[idx];
        if (!song || !song.tracks || song.tracks.length < 2) return;
        const reopening = trackPopEl && trackPopEl.dataset.songId === String(song.id);
        closeTrackPicker();
        if (reopening) return; // 再点一次同一个按钮 = 关闭
        const pop = document.createElement("div");
        pop.className = "track-pop";
        pop.setAttribute("role", "dialog");
        pop.setAttribute("aria-label", "音轨选择");
        pop.dataset.idx = String(idx);
        pop.dataset.songId = String(song.id);
        renderTrackPicker(pop);
        document.body.appendChild(pop);
        trackPopEl = pop;

        // 定位：优先放在按钮下方，放不下就放上方，并限制在视口内
        const r = anchor.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
        let top = r.bottom + 8;
        if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;

        pop.addEventListener("click", (e) => {
            const solo = e.target.closest(".tp-solo");
            if (solo) {
                const i = parseInt(pop.dataset.idx, 10);
                const trackIndex = parseInt(solo.dataset.solo, 10);
                const cur = playlist[i];
                if (!cur) return;
                if (isAudioPlaying && pianoSession && pianoSession.solo === trackIndex && String(pianoSession.soloSongId) === String(cur.id)) {
                    stopAudioPreview();
                } else {
                    if (i !== selectedPreviewIndex) selectPreviewTrack(i);
                    startAudioPreview([trackIndex]);
                }
                return;
            }
            const btn = e.target.closest(".tp-act");
            if (!btn) return;
            const cur = playlist[parseInt(pop.dataset.idx, 10)];
            if (!cur) return;
            const i = parseInt(pop.dataset.idx, 10);
            const parser = window.OWMidiParser;
            if (btn.dataset.act === "all") applyTrackMask(i, cur.tracks.map(t => t.index), "all");
            else if (btn.dataset.act === "lean") applyTrackMask(i, parser.autoSelectTracks(cur.mid, "lean"), "lean");
            else applyTrackMask(i, cur.curatedTracks || parser.autoSelectTracks(cur.mid), cur.curatedTracks ? "curated" : "auto");
            renderTrackPicker(pop);
        });
        pop.addEventListener("change", (e) => {
            const box = e.target.closest("input[data-track]");
            if (!box) return;
            const i = parseInt(pop.dataset.idx, 10);
            const cur = playlist[i];
            if (!cur) return;
            const set = new Set(cur.trackMask);
            const t = parseInt(box.dataset.track, 10);
            if (box.checked) set.add(t); else set.delete(t);
            if (set.size === 0) {
                box.checked = true;
                showToast("至少保留一条音轨", "warn");
                return;
            }
            applyTrackMask(i, [...set], "custom");
            renderTrackPicker(pop);
        });
        document.addEventListener("mousedown", onTrackPickerOutside, true);
        document.addEventListener("keydown", onTrackPickerKey, true);
    }

    function renderPlaylist() {
        if (trackPopEl && !playlist.some(s => String(s.id) === trackPopEl.dataset.songId)) closeTrackPicker();
        if (playlistCount) {
            const isFull = playlist.length >= MAX_SONGS_LIMIT;
            playlistCount.textContent = `已载入 ${playlist.length} / ${MAX_SONGS_LIMIT} 首${isFull ? " (已满)" : ""}`;
            playlistCount.style.borderColor = isFull ? "var(--ow-orange)" : "var(--border-subtle)";
        }

        if (playlistContainer) {
            playlistContainer.style.display = playlist.length > 0 ? "block" : "none";
        }
        if (dropzone && dropzone.classList) {
            if (playlist.length > 0) {
                dropzone.classList.add("compact");
            } else {
                dropzone.classList.remove("compact");
            }
        }

        // 列表为空时的复位
        if (playlist.length === 0) {
            stopAudioPreview();
            generatedCode = "";
            if (codePreview) codePreview.value = "";
            if (tabPlaylistBadge) tabPlaylistBadge.textContent = "(0)";
            if (playlistEmptyNotice) playlistEmptyNotice.style.display = "flex";
            if (playlistContainer) playlistContainer.style.display = "none";
            if (playlistTbody) {
                playlistTbody.innerHTML = `<tr><td colspan="4" class="playlist-empty-tip">暂无排队曲目，请在上方点击【经典精选曲库】或拖入本地 MIDI</td></tr>`;
            }
            updateCapacityIndicator();
            if (displaySongTitle) {
                displaySongTitle.style.display = "";
                displaySongTitle.textContent = "尚未添加曲目";
            }
            if (previewSongName) {
                previewSongName.innerHTML = `<strong>网页端试听</strong>: 点击列表曲目可切换试听`;
            }
            if (dispTotalSongs) dispTotalSongs.textContent = "0 首";
            if (dispNotes) dispNotes.textContent = "0 个";
            if (dispDuration) dispDuration.textContent = "00:00";
            syncSettingsDisplay();
            setAppState(APP_STATE.EMPTY);
            updatePresetChipsStatus();
            return;
        }

        // 校验试听指针边界
        if (selectedPreviewIndex < 0 || selectedPreviewIndex >= playlist.length) {
            selectedPreviewIndex = 0;
        }

        if (tabPlaylistBadge) tabPlaylistBadge.textContent = `(${playlist.length})`;
        if (playlistEmptyNotice) playlistEmptyNotice.style.display = "none";
        if (playlistContainer) playlistContainer.style.display = "block";

        let totalNotes = 0;
        let totalDuration = 0;
        let html = "";

        playlist.forEach((song, idx) => {
            totalNotes += song.notesCount;
            totalDuration += (song.duration || 0);
            const isSelected = (idx === selectedPreviewIndex);
            const isNewlyAdded = (song.id && song.id === newlyAddedSongId);
            html += `
                <tr class="playlist-row ${isSelected ? 'selected' : ''} ${isNewlyAdded ? 'row-highlight-new' : ''}" data-idx="${idx}">
                    <td class="song-idx">
                        <button type="button" class="btn-row-play" data-idx="${idx}" title="试听这首" aria-label="试听 ${escapeHtml(song.name)}" aria-pressed="false">
                            <span class="rp-num">${idx + 1}</span>
                            <svg class="rp-play" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>
                            <svg class="rp-stop" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
                            <span class="rp-eq" aria-hidden="true"><i></i><i></i><i></i></span>
                        </button>
                    </td>
                    <td class="song-name-cell" title="${escapeHtml(song.name)}">
                        <div style="display: flex; align-items: center; min-width: 0;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;">${escapeHtml(song.name)}</span>
                            ${getTrackBadgeHtml(song.isSample)}${song.subKind === "lyrics" ? `<span class="track-badge badge-sub" title="游戏内同步显示歌词（${song.subtitles.length} 行）">歌词</span>` : song.subKind === "intro" ? `<span class="track-badge badge-sub badge-intro" title="游戏内显示 ${song.subtitles.length} 条曲目背景介绍">介绍</span>` : ""}${trackChipHtml(song, idx)}
                        </div>
                    </td>
                    <td class="song-meta-cell">${formatTime(song.duration)} · ${formatNumber(song.notesCount)} 音符</td>
                    <td style="text-align: right;">
                        <button class="btn-remove-song" data-idx="${idx}" title="从列表移除">✕</button>
                    </td>
                </tr>
            `;
        });

        if (playlistTbody) {
            playlistTbody.innerHTML = html;
        }
        newlyAddedSongId = null;

        updateCapacityIndicator();

        // 概念 1：导出总览展台 (Export Playlist)
        const titleText = playlist.length > 1
            ? `${playlist[0].name} 等 ${playlist.length} 首`
            : playlist[0].name;

        let showcaseBadge = "";
        const allSample = playlist.every(s => s.isSample);
        const allUploaded = playlist.every(s => !s.isSample);
        if (allSample) {
            showcaseBadge = getTrackBadgeHtml(true);
        } else if (allUploaded) {
            showcaseBadge = getTrackBadgeHtml(false);
        } else {
            showcaseBadge = `${getTrackBadgeHtml(false)} ${getTrackBadgeHtml(true)}`;
        }

        if (displaySongTitle) {
            displaySongTitle.style.display = "inline-flex";
            displaySongTitle.style.alignItems = "center";
            displaySongTitle.style.minWidth = "0";
            displaySongTitle.innerHTML = `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;">${escapeHtml(titleText)}</span> ${showcaseBadge}`;
        }

        if (dispTotalSongs) dispTotalSongs.textContent = `${playlist.length} 首`;
        if (lastIsTruncated && lastParserResult) {
            const expNotes = (typeof lastParserResult.exportedNotes === 'number')
                ? lastParserResult.exportedNotes : totalNotes;
            const expDur = (typeof lastParserResult.exportedDuration === 'number')
                ? lastParserResult.exportedDuration : totalDuration;
            if (dispNotes) dispNotes.textContent = `${formatNumber(expNotes)} 个`;
            if (dispDuration) dispDuration.textContent = formatTime(expDur);
        } else {
            if (dispNotes) dispNotes.textContent = `${formatNumber(totalNotes)} 个`;
            if (dispDuration) dispDuration.textContent = formatTime(totalDuration);
        }
        updateCoreActionSubline();
        syncSettingsDisplay();

        // 概念 2：当前试听曲目 (Selected Preview Track)
        const currentPreviewSong = playlist[selectedPreviewIndex] || playlist[0];
        if (previewSongName && currentPreviewSong) {
            previewSongName.innerHTML = `<span><strong>当前试听</strong>: ${escapeHtml(currentPreviewSong.name)} (${formatTime(currentPreviewSong.duration)})</span>`;
        }

        // 绑定删除按钮
        if (playlistTbody) {
            playlistTbody.querySelectorAll(".btn-remove-song").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const idx = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
                    removeTrack(idx);
                });
            });

            // 绑定行点击切换当前试听曲目；序号处的播放键 / 双击整行：直接试听
            playlistTbody.querySelectorAll(".playlist-row").forEach(row => {
                const idx = parseInt(row.getAttribute("data-idx"), 10);
                row.addEventListener("click", (e) => {
                    if (e.target.closest(".btn-remove-song") || e.target.closest(".btn-row-play")) return;
                    if (!isNaN(idx) && idx !== selectedPreviewIndex) {
                        selectPreviewTrack(idx);
                    }
                });
                row.addEventListener("dblclick", (e) => {
                    if (e.target.closest(".btn-remove-song")) return;
                    previewTrackAt(idx, true);
                });
                const tracksBtn = row.querySelector(".btn-tracks");
                if (tracksBtn) {
                    tracksBtn.addEventListener("click", (e) => { e.stopPropagation(); openTrackPicker(idx, tracksBtn); });
                    tracksBtn.addEventListener("dblclick", (e) => e.stopPropagation());
                }
                const playBtn = row.querySelector(".btn-row-play");
                if (playBtn) {
                    playBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        previewTrackAt(idx, false);
                    });
                }
            });
            syncRowPlayState();
        }
        updatePresetChipsStatus();
    }

    // 试听指定曲目：正在播放这一首时再点一次为停止（forcePlay 时一律重新播放，用于双击）
    function previewTrackAt(index, forcePlay) {
        if (isNaN(index) || index < 0 || index >= playlist.length) return;
        if (isAudioPlaying && index === selectedPreviewIndex && !forcePlay) {
            stopAudioPreview();
            return;
        }
        if (index !== selectedPreviewIndex) selectPreviewTrack(index);
        startAudioPreview();
    }

    function selectPreviewTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        if (index === selectedPreviewIndex) return;

        stopAudioPreview();
        selectedPreviewIndex = index;
        renderPlaylist();
    }

    // 移除单个曲目
    function removeTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        stopAudioPreview();
        lastParserWarnings = [];
        lastCompressedSize = null;
        const removed = playlist.splice(index, 1);
        if (selectedPreviewIndex >= playlist.length) {
            selectedPreviewIndex = Math.max(0, playlist.length - 1);
        }
        renderPlaylist();
        if (playlist.length === 0) {
            clearPlaylist();
        } else {
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
            if (removed && removed[0]) {
                showToast(`已移除曲目: ${removed[0].name}`, "success");
            }
        }
    }

    // 清空全部播放列表
    function clearPlaylist() {
        stopAudioPreview();
        lastParserWarnings = [];
        lastCompressedSize = null;
        lastParserResult = null;
        lastExportedNotes = 0;
        lastExportedDuration = 0;
        lastTruncationDetails = null;
        lastIsTruncated = false;
        if (capacityAlertBanner) capacityAlertBanner.style.display = "none";
        if (regenDebounceTimer) {
            clearTimeout(regenDebounceTimer);
            regenDebounceTimer = null;
        }
        currentGenVersion++;
        hasConfigChanged = false;
        playlist = [];
        selectedPreviewIndex = 0;
        generatedCode = "";
        if (codePreview) codePreview.value = "";
        renderPlaylist();
        setAppState(APP_STATE.EMPTY);
    }

    // 内部将解析好的 Tone.js Midi 对象加入播放列表
    function addMidiToPlaylist(midiObj, name, isSample = false, libraryId = null, subtitles = null, subKind = "", artist = "", curatedTracks = null) {
        if (playlist.length >= MAX_SONGS_LIMIT) {
            showToast(`播放列表已达上限 (最多支持同时保留 ${MAX_SONGS_LIMIT} 首歌曲)`, "warn");
            return false;
        }

        // 音轨：曲库里人工确认过的编曲优先，否则“智能钢琴化”自动选择（优先钢琴音轨，去掉重复轨、鼓和不适合钢琴的音色）
        const parser = window.OWMidiParser;
        const trackInfo = parser ? parser.analyzeTracks(midiObj).filter(t => !t.drum) : [];
        let trackMask, trackMode;
        if (Array.isArray(curatedTracks) && curatedTracks.length) { trackMask = curatedTracks.slice(); trackMode = "curated"; }
        else if (parser) { trackMask = parser.autoSelectTracks(midiObj); trackMode = "auto"; }
        else { trackMask = trackInfo.map(t => t.index); trackMode = "all"; }
        const notesCount = parser ? parser.selectableNotes(midiObj, trackMask) : 0;

        const cleanName = name.replace(/\.[^/.]+$/, "");

        const songId = Date.now() + Math.random();
        newlyAddedSongId = songId;

        playlist.push({
            id: songId,
            name: cleanName,
            artist: artist || "",
            mid: midiObj,
            duration: midiObj.duration || 0,
            notesCount: notesCount,
            tracks: trackInfo,          // 全部可演奏音轨的分析（不含鼓）
            curatedTracks: (trackMode === "curated") ? trackMask.slice() : null,
            trackMask: trackMask,       // 参与演奏的音轨序号
            trackMode: trackMode,       // curated 人工确认 / auto 智能 / custom 手动 / all 全部
            isSample: !!isSample,
            libraryId: libraryId,
            // 游戏内字幕：[[秒, 文本], ...]（MIDI 时间轴），subKind 为 lyrics / intro
            subtitles: Array.isArray(subtitles) ? subtitles : [],
            subKind: subKind || ""
        });

        selectedPreviewIndex = playlist.length - 1;
        hasConfigChanged = false;
        renderPlaylist();
        triggerAutoRegenerate(false);
        return true;
    }

    // ════════════ 8. 文件解析与曲目导入 (支持多文件与去重) ════════════
    async function addTracks(files) {
        if (!files || files.length === 0) return 0;

        if (playlist.length >= MAX_SONGS_LIMIT) {
            showToast(`播放列表已满 (最多保留 ${MAX_SONGS_LIMIT} 首歌曲同时输入)`, "warn");
            return 0;
        }

        const fileArray = Array.from(files);
        const validFiles = fileArray.filter(f => {
            const lower = f.name.toLowerCase();
            return lower.endsWith(".mid") || lower.endsWith(".midi") || lower.endsWith(".kar");
        });
        // 与 MIDI 同名的 .lrc 歌词文件会自动配对为游戏内字幕
        const lrcByBase = new Map();
        for (const f of fileArray) {
            if (f.name.toLowerCase().endsWith(".lrc")) lrcByBase.set(f.name.replace(/\.lrc$/i, "").toLowerCase(), f);
        }

        if (validFiles.length === 0) {
            if (lrcByBase.size > 0) {
                showToast("请把 .lrc 歌词文件与同名的 MIDI 文件一起拖入", "warn");
            } else {
                showToast("请选择 .mid 或 .midi 格式的音乐文件！", "error");
            }
            return 0;
        }

        stopAudioPreview();
        setAppState(APP_STATE.PARSING, `正在解析 ${validFiles.length} 首 MIDI 乐谱...`);

        let addedCount = 0;
        let duplicateCount = 0;
        let overflowCount = 0;

        for (const file of validFiles) {
            if (playlist.length >= MAX_SONGS_LIMIT) {
                overflowCount++;
                continue;
            }

            const cleanName = file.name.replace(/\.[^/.]+$/, "");
            // 查重：同名曲目去重保护
            if (playlist.some(song => song.name === cleanName)) {
                duplicateCount++;
                continue;
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                const midi = new Midi(arrayBuffer);
                let subtitles = [];
                let subKind = "";
                const parser = window.OWMidiParser;
                const lrcFile = lrcByBase.get(cleanName.toLowerCase());
                if (parser && lrcFile) {
                    subtitles = parser.parseLrc(await lrcFile.text()).map(sub => [sub.t, sub.text]);
                }
                if (parser && !subtitles.length) {
                    subtitles = parser.extractEmbeddedLyrics(new Uint8Array(arrayBuffer), midi).map(sub => [sub.t, sub.text]);
                }
                if (subtitles.length) subKind = "lyrics";
                if (addMidiToPlaylist(midi, file.name.replace(/\.kar$/i, ".mid"), false, null, subtitles, subKind)) {
                    addedCount++;
                }
            } catch (err) {
                console.error("解析文件失败:", file.name, err);
                showToast(`曲目 [${file.name}] 解析异常: ${err.message}`, "error");
            }
        }

        if (overflowCount > 0) {
            showToast(`最多保留 ${MAX_SONGS_LIMIT} 首歌曲同时输入，已载入前 ${addedCount} 首 (超出 ${overflowCount} 首已忽略)`, "warn");
        } else if (duplicateCount > 0 && addedCount === 0) {
            showToast(`已跳过 ${duplicateCount} 首同名重复曲目`, "warn");
            if (playlist.length > 0) {
                setAppState(lastIsTruncated ? APP_STATE.OVER_CAPACITY : APP_STATE.READY);
            } else {
                setAppState(APP_STATE.EMPTY);
            }
        } else if (addedCount > 0) {
            const dupMsg = duplicateCount > 0 ? ` (已跳过 ${duplicateCount} 首重复)` : "";
            showToast(`已成功载入 ${addedCount} 首曲目！${dupMsg}`, "success");
        }

        if (addedCount > 0) {
            switchTab("playlist");
        }

        if (dropzone && dropzone.classList) {
            if (playlist.length > 0) {
                dropzone.classList.add("compact");
            } else {
                dropzone.classList.remove("compact");
            }
        }

        return addedCount;
    }

    function base64ToArrayBuffer(b64) {
        const binary = atob(b64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function resolveLibrarySong(key) {
        if (!key) return null;
        if (librarySongById.has(key)) return librarySongById.get(key);
        const title = LEGACY_SAMPLE_ALIASES[key] || key;
        return LIBRARY.songs.find(song => song.title === title) || null;
    }

    function findPlaylistIndexForSong(song) {
        return playlist.findIndex(item => item.libraryId === song.id || item.name === song.title);
    }

    // 从内置曲库载入曲目（Base64 内联数据，离线免跨域）。key 可为曲目 ID、曲名或旧版示例类型名
    async function addSample(key, isToggle = false) {
        stopAudioPreview();

        const song = resolveLibrarySong(key);
        if (!song || !LIBRARY_DATA[song.id]) {
            showToast("曲库中未找到该曲目", "error");
            return false;
        }

        const existingIdx = findPlaylistIndexForSong(song);
        if (existingIdx !== -1) {
            if (isToggle) {
                removeTrack(existingIdx);
                showToast(`已将《${song.title}》移出播放列表`, "info");
            } else {
                showToast(`《${song.title}》已在播放列表中`, "warn");
            }
            return false;
        }

        if (playlist.length >= MAX_SONGS_LIMIT) {
            showToast(`播放列表已满（最多 ${MAX_SONGS_LIMIT} 首），请先移除部分曲目`, "warn");
            return false;
        }

        setAppState(APP_STATE.PARSING, `正在载入《${song.title}》...`);
        try {
            const midi = new Midi(base64ToArrayBuffer(LIBRARY_DATA[song.id]));
            const added = addMidiToPlaylist(midi, song.title, true, song.id, song.subs || [], song.subKind || "", song.artist || "", song.tracks || null);
            showToast(`已载入《${song.title}》并加入播放列表`, "success", true);
            return added;
        } catch (err) {
            console.error(`载入曲库曲目《${song.title}》失败:`, err);
            showToast(`载入《${song.title}》失败: ${err.message}`, "error");
            setAppState(playlist.length > 0 ? APP_STATE.READY : APP_STATE.EMPTY);
            return false;
        }
    }

    // ════════════ 8.5 曲库浏览：分类筛选、检索与渲染 ════════════
    const CATEGORY_ICONS = {
        featured: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>',
        "周杰伦": '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>',
        "华语流行": '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
        "欧美流行": '<path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>',
        "影视主题": '<rect x="2" y="2" width="20" height="20" rx="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line>',
        "动漫游戏": '<line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="6"></rect>',
        "经典钢琴": '<rect x="2" y="3" width="20" height="18" rx="2"></rect><line x1="7" y1="3" x2="7" y2="13"></line><line x1="12" y1="3" x2="12" y2="13"></line><line x1="17" y1="3" x2="17" y2="13"></line><line x1="2" y1="13" x2="22" y2="13"></line>',
        "古典名曲": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>'
    };
    const categoryIcon = (name) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${CATEGORY_ICONS[name] || CATEGORY_ICONS["华语流行"]}</svg>`;

    const featuredIds = new Set(LIBRARY.featured);
    let libraryFilter = "all";
    let libraryQuery = "";

    const normalizeSearch = (str) => String(str || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s·・.'’"“”\-_,，、:：!！?？()（）《》]/g, "");

    function scoreSong(song, q) {
        const title = normalizeSearch(song.title);
        if (title === q) return 100;
        if (title.startsWith(q)) return 90;
        if (title.includes(q)) return 70;
        if (normalizeSearch(song.artist).includes(q)) return 50;
        const words = String(song.keywords || "").toLowerCase().split(/\s+/).map(normalizeSearch).filter(Boolean);
        if (words.some(w => w.startsWith(q))) return 45;
        if (normalizeSearch(song.keywords).includes(q)) return 35;
        if (normalizeSearch(song.category).includes(q)) return 20;
        return 0;
    }

    function highlightTitle(title) {
        if (!libraryQuery) return escapeHtml(title);
        const idx = title.toLowerCase().indexOf(libraryQuery.trim().toLowerCase());
        if (idx === -1 || !libraryQuery.trim()) return escapeHtml(title);
        const end = idx + libraryQuery.trim().length;
        return `${escapeHtml(title.slice(0, idx))}<mark>${escapeHtml(title.slice(idx, end))}</mark>${escapeHtml(title.slice(end))}`;
    }

    function songItemHtml(song, iconKey) {
        const meta = [song.artist, `${formatNumber(song.notes)} 音符`].filter(Boolean).join(" · ");
        const tip = `${song.title}${song.artist ? " — " + song.artist : ""} · ${song.category} · ${formatTime(song.duration)} · ${formatNumber(song.notes)} 音符` + (song.notesAll && song.notesAll > song.notes ? `（原曲 ${formatNumber(song.notesAll)} 个音符，已精选钢琴 / 旋律音轨）` : "");
        return `
            <button type="button" class="preset-chip" data-song-id="${song.id}" title="${escapeHtml(tip)}" aria-pressed="false">
                <span class="preset-chip-icon">${categoryIcon(iconKey || song.category)}</span>
                <span class="preset-chip-text">
                    <span class="preset-chip-name">${highlightTitle(song.title)}</span>
                    <span class="preset-chip-meta">${escapeHtml(meta)}</span>
                </span>
                <span class="preset-chip-side">
                    <span class="preset-chip-time">${formatTime(song.duration)}</span>
                    <span class="preset-chip-state" aria-hidden="true"></span>
                </span>
            </button>`;
    }

    // 分组：key 用于记忆展开状态；collapsible=false 时为普通标题（筛选 / 搜索视图）
    const libraryOpen = new Set(["featured"]);
    function sectionHtml(title, songs, iconKey, opts = {}) {
        if (!songs.length) return "";
        const { key = title, collapsible = false, total = songs.length } = opts;
        const collapsed = collapsible && !libraryOpen.has(key);
        const hint = songs.slice(0, 3).map(song => song.title).join("、") + (songs.length > 3 ? "…" : "");
        const chevron = '<svg class="lib-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        const head = collapsible
            ? `<button type="button" class="lib-section-head" data-toggle aria-expanded="${!collapsed}">${chevron}<span class="lib-section-name">${escapeHtml(title)}</span><span class="lib-section-count">${total}</span><span class="lib-section-picked"></span><span class="lib-section-hint">${escapeHtml(hint)}</span></button>`
            : `<div class="lib-section-head"><span class="lib-section-name">${escapeHtml(title)}</span><span class="lib-section-count">${total}</span><span class="lib-section-picked"></span></div>`;
        return `
            <section class="lib-section${collapsed ? " is-collapsed" : ""}" data-key="${escapeHtml(key)}">
                ${head}
                <div class="lib-section-body"><div class="lib-section-inner">
                    <div class="preset-chips-grid">${songs.map(song => songItemHtml(song, iconKey)).join("")}</div>
                </div></div>
            </section>`;
    }

    function renderLibraryFilters() {
        if (!libraryFilters) return;
        const items = [
            { key: "all", label: "全部", count: LIBRARY.total },
            { key: "featured", label: "精选", count: LIBRARY.featured.length },
            ...LIBRARY.categories.map(c => ({ key: c.name, label: c.name, count: c.count }))
        ];
        libraryFilters.innerHTML = items.map(item => `
            <button type="button" class="filter-chip${item.key === libraryFilter ? " active" : ""}" data-filter="${escapeHtml(item.key)}" role="tab" aria-selected="${item.key === libraryFilter}">
                ${escapeHtml(item.label)}<span class="filter-chip-count">${item.count}</span>
            </button>`).join("");
    }

    function renderLibrary() {
        if (!libraryList) return;
        const q = normalizeSearch(libraryQuery);
        let html = "";

        if (q) {
            const results = LIBRARY.songs
                .map(song => ({ song, score: scoreSong(song, q) }))
                .filter(r => r.score > 0)
                .sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title, "zh-Hans-CN"))
                .map(r => r.song);
            html = results.length
                ? sectionHtml(`搜索结果`, results)
                : `<div class="lib-empty">
                        <div class="lib-empty-title">没有找到「${escapeHtml(libraryQuery.trim())}」</div>
                        <div class="lib-empty-sub">试试歌手名或拼音首字母（如 ylxb）。<br>也可以上传你自己的 MIDI 文件。</div>
                        <button type="button" class="btn-goto-presets lib-empty-upload">上传本地 MIDI</button>
                   </div>`;
        } else if (libraryFilter === "featured") {
            html = sectionHtml("精选", LIBRARY.featured.map(id => librarySongById.get(id)).filter(Boolean), "featured");
        } else if (libraryFilter !== "all") {
            html = sectionHtml(libraryFilter, LIBRARY.songs.filter(song => song.category === libraryFilter));
        } else {
            // 全部：精选默认展开，各分类默认折叠（点标题展开）；精选曲目不再在分类中重复出现
            html = sectionHtml("精选", LIBRARY.featured.map(id => librarySongById.get(id)).filter(Boolean), "featured", { key: "featured", collapsible: true });
            for (const cat of LIBRARY.categories) {
                html += sectionHtml(cat.name, LIBRARY.songs.filter(song => song.category === cat.name && !featuredIds.has(song.id)), undefined, { key: cat.name, collapsible: true, total: cat.count });
            }
        }

        libraryList.innerHTML = html;
        if (libraryFilters) libraryFilters.classList.toggle("is-muted", !!q);
        updatePresetChipsStatus();
    }

    function setLibraryFilter(key) {
        libraryFilter = key;
        if (libraryFilters) {
            libraryFilters.querySelectorAll(".filter-chip").forEach(chip => {
                const active = chip.getAttribute("data-filter") === key;
                chip.classList.toggle("active", active);
                chip.setAttribute("aria-selected", active ? "true" : "false");
            });
        }
        if (libraryQuery) setLibraryQuery("");
        else renderLibrary();
        const scroller = document.getElementById("libraryScroll");
        if (scroller) scroller.scrollTop = 0;
    }

    function setLibraryQuery(value) {
        libraryQuery = value;
        if (librarySearch && librarySearch.value !== value) librarySearch.value = value;
        if (librarySearchClear) librarySearchClear.hidden = !value;
        renderLibrary();
        const scroller = document.getElementById("libraryScroll");
        if (scroller) scroller.scrollTop = 0;
    }

    function initLibrary() {
        if (libraryCount) libraryCount.textContent = `${LIBRARY.total} 首`;
        renderLibraryFilters();
        renderLibrary();

        if (libraryFilters) {
            libraryFilters.addEventListener("click", (e) => {
                const chip = e.target.closest(".filter-chip");
                if (chip) setLibraryFilter(chip.getAttribute("data-filter"));
            });
        }

        if (librarySearch) {
            librarySearch.addEventListener("input", () => setLibraryQuery(librarySearch.value));
            librarySearch.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && librarySearch.value) {
                    e.stopPropagation();
                    setLibraryQuery("");
                } else if (e.key === "ArrowDown" || e.key === "Enter") {
                    const first = libraryList && libraryList.querySelector(".preset-chip");
                    if (first) {
                        e.preventDefault();
                        if (e.key === "Enter") first.click();
                        else first.focus();
                    }
                }
            });
        }
        if (librarySearchClear) {
            librarySearchClear.addEventListener("click", () => {
                setLibraryQuery("");
                if (librarySearch) librarySearch.focus();
            });
        }

        // 按 / 快速聚焦搜索
        document.addEventListener("keydown", (e) => {
            if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
            const tag = (document.activeElement && document.activeElement.tagName) || "";
            if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
            if (librarySearch) {
                e.preventDefault();
                librarySearch.focus();
                librarySearch.select();
            }
        });

        if (libraryList) {
            const pending = new Set();
            libraryList.addEventListener("click", async (e) => {
                const head = e.target.closest(".lib-section-head[data-toggle]");
                if (head) {
                    const sec = head.closest(".lib-section");
                    const key = sec.getAttribute("data-key");
                    const collapsed = sec.classList.toggle("is-collapsed");
                    head.setAttribute("aria-expanded", String(!collapsed));
                    if (collapsed) libraryOpen.delete(key); else libraryOpen.add(key);
                    return;
                }
                if (e.target.closest(".lib-empty-upload")) {
                    if (midiFileInput) midiFileInput.click();
                    return;
                }
                const chip = e.target.closest(".preset-chip[data-song-id]");
                if (!chip) return;
                const id = chip.getAttribute("data-song-id");
                if (pending.has(id)) return;
                pending.add(id);
                try {
                    await addSample(id, true);
                } finally {
                    pending.delete(id);
                }
            });
            // 上下方向键在曲目间移动
            libraryList.addEventListener("keydown", (e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                const chips = [...libraryList.querySelectorAll(".preset-chip")];
                const idx = chips.indexOf(document.activeElement);
                if (idx === -1) return;
                e.preventDefault();
                if (e.key === "ArrowUp" && idx === 0 && librarySearch) librarySearch.focus();
                else {
                    const next = chips[Math.max(0, Math.min(chips.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
                    if (next) next.focus();
                }
            });
        }
    }

    // ════════════ 9. 用户交互与事件监听 ════════════
    // 拖拽与点击上传
    if (dropzone && midiFileInput) {
        dropzone.addEventListener("click", (e) => {
            if (e.target.closest("a, button, input")) {
                if (e.target.closest(".btn-select-file")) {
                    midiFileInput.click();
                }
                return;
            }
            midiFileInput.click();
        });

        midiFileInput.addEventListener("change", (e) => {
            if (e.target.files && e.target.files.length) {
                addTracks(e.target.files);
            }
            midiFileInput.value = ""; // 重置以便再次选择
        });

        dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropzone.classList.add("dragover");
        });

        dropzone.addEventListener("dragleave", () => {
            dropzone.classList.remove("dragover");
        });

        dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropzone.classList.remove("dragover");
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                addTracks(e.dataTransfer.files);
            }
        });
    }

    // 在线乐谱网站直达
    document.querySelectorAll(".site-chip").forEach(chip => {
        chip.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    });

    initLibrary();

    // 清空播放列表按钮
    if (clearPlaylistBtn) {
        clearPlaylistBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            clearPlaylist();
            showToast("已清空全部排队曲目", "success");
        });
    }

    // 地图与点位切换 (自动重算代码)
    const pianoChoices = document.querySelectorAll(".piano-choice:not(.disabled)");
    pianoChoices.forEach(choice => {
        choice.addEventListener("click", () => {
            pianoChoices.forEach(c => c.classList.remove("selected"));
            choice.classList.add("selected");
            const radio = choice.querySelector("input[type='radio']");
            if (radio) radio.checked = true;
            syncSettingsDisplay();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });
    });

    // 机器人模式切换 (自动重算代码)
    if (botInvisibleBtn && botVisibleBtn) {
        botInvisibleBtn.addEventListener("click", () => {
            botInvisibleBtn.classList.add("selected");
            botVisibleBtn.classList.remove("selected");
            const radio = botInvisibleBtn.querySelector("input");
            if (radio) radio.checked = true;
            syncSettingsDisplay();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });

        botVisibleBtn.addEventListener("click", () => {
            botVisibleBtn.classList.add("selected");
            botInvisibleBtn.classList.remove("selected");
            const radio = botVisibleBtn.querySelector("input");
            if (radio) radio.checked = true;
            syncSettingsDisplay();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });
    }

    // 钢琴操控权限切换 (自动重算代码)
    if (controlHostOnlyBtn && controlAllPlayersBtn) {
        controlHostOnlyBtn.addEventListener("click", () => {
            controlHostOnlyBtn.classList.add("selected");
            controlAllPlayersBtn.classList.remove("selected");
            const radio = controlHostOnlyBtn.querySelector("input");
            if (radio) radio.checked = true;
            syncSettingsDisplay();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });

        controlAllPlayersBtn.addEventListener("click", () => {
            controlAllPlayersBtn.classList.add("selected");
            controlHostOnlyBtn.classList.remove("selected");
            const radio = controlAllPlayersBtn.querySelector("input");
            if (radio) radio.checked = true;
            syncSettingsDisplay();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });
    }

    // 键盘无障碍：方向键在卡片单选组之间无缝切换
    if (typeof document !== 'undefined' && document.querySelectorAll) {
        document.querySelectorAll('[role="radiogroup"], .map-grid, .bot-mode-grid, .perm-grid, .voice-mode-grid').forEach(group => {
            group.addEventListener('keydown', (e) => {
                const labels = [...group.querySelectorAll('label')];
                const activeLabel = labels.find(l => l.contains(document.activeElement) || l === document.activeElement);
                if (!activeLabel) return;
                const idx = labels.indexOf(activeLabel);
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextLabel = labels[(idx + 1) % labels.length];
                    const input = nextLabel.querySelector('input[type="radio"]');
                    if (input) { input.focus(); } else { nextLabel.focus(); }
                    nextLabel.click();
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prevLabel = labels[(idx - 1 + labels.length) % labels.length];
                    const input = prevLabel.querySelector('input[type="radio"]');
                    if (input) { input.focus(); } else { prevLabel.focus(); }
                    prevLabel.click();
                }
            });
        });
    }

    // 起始时间与声部上限切换 (自动重算代码)
    if (startTimeInput) {
        startTimeInput.addEventListener("input", () => {
            stopAudioPreview();
            hasConfigChanged = true;
            triggerAutoRegenerate(false);
        });
    }

    function updateVoiceSelection(val, triggerToast = true) {
        const numVal = parseInt(val, 10) || 10;
        const voiceCards = [
            { el: cardVoice10, val: 10, label: "双人私享 (10声部)", toastDesc: "双人私享：房主 + 1 位好友（10 声部）" },
            { el: cardVoice8, val: 8, label: "四人小队 (8声部)", toastDesc: "四人小队：房主 + 3 位好友（8 声部）" },
            { el: cardVoice11, val: 11, label: "单人独享 (11声部)", toastDesc: "单人独享：仅房主（11 声部）" }
        ];

        let matched = null;
        voiceCards.forEach(item => {
            if (!item.el) return;
            const isMatch = item.val === numVal;
            if (isMatch) {
                matched = item;
                item.el.classList.add("selected");
                const radio = item.el.querySelector("input[type='radio']");
                if (radio) radio.checked = true;
            } else {
                item.el.classList.remove("selected");
                const radio = item.el.querySelector("input[type='radio']");
                if (radio) radio.checked = false;
            }
        });

        if (voicesSelect && voicesSelect.value !== String(numVal)) {
            voicesSelect.value = String(numVal);
        }

        if (summaryRoomPill && matched) {
            summaryRoomPill.textContent = matched.label;
        }

        if (triggerToast && matched) {
            showToast(`已选择房间模式：${matched.toastDesc}`, "info");
        }

        syncSettingsDisplay();
        hasConfigChanged = true;
        triggerAutoRegenerate(false);
    }

    [
        { el: cardVoice10, val: 10 },
        { el: cardVoice8, val: 8 },
        { el: cardVoice11, val: 11 }
    ].forEach(({ el, val }) => {
        if (el) {
            el.addEventListener("click", (e) => {
                e.preventDefault();
                updateVoiceSelection(val, true);
            });
        }
    });

    if (voicesSelect) {
        voicesSelect.addEventListener("change", () => {
            updateVoiceSelection(voicesSelect.value, false);
        });
    }

    // 🌟 核心行动按钮主点击事件 (复制代码 / 重试) 🌟
    if (coreActionBtn) {
        coreActionBtn.addEventListener("click", async () => {
            if (currentState === APP_STATE.EMPTY || currentState === APP_STATE.PARSING || currentState === APP_STATE.GENERATING) {
                return;
            }

            if (currentState === APP_STATE.ERROR) {
                triggerAutoRegenerate(true);
                return;
            }

            // 就绪、已截断或已复制状态：执行复制代码
            if (currentState === APP_STATE.READY || currentState === APP_STATE.OVER_CAPACITY || currentState === APP_STATE.COPIED) {
                if (!generatedCode) {
                    triggerAutoRegenerate(true);
                    return;
                }

                let copySuccess = false;
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(generatedCode);
                        copySuccess = true;
                    } else {
                        throw new Error("Clipboard API not available");
                    }
                } catch (err) {
                    if (codePreview) {
                        try {
                            codePreview.select();
                            copySuccess = document.execCommand("copy");
                        } catch (execErr) {
                            copySuccess = false;
                        }
                    }
                }

                if (copySuccess) {
                    hasConfigChanged = false;
                    const wasOverCapacity = (currentState === APP_STATE.OVER_CAPACITY || (lastParserWarnings && lastParserWarnings.length > 0) || lastIsTruncated);
                    setAppState(APP_STATE.COPIED);
                    showToast("已复制工坊代码！请进入《守望先锋》自定比赛粘贴规则 (文本语言须为 English)", "success");

                    if (copyTimeoutId) {
                        clearTimeout(copyTimeoutId);
                    }
                    copyTimeoutId = setTimeout(() => {
                        if (currentState === APP_STATE.COPIED) {
                            if (wasOverCapacity) {
                                setAppState(APP_STATE.OVER_CAPACITY);
                            } else {
                                setAppState(APP_STATE.READY);
                            }
                        }
                    }, 2000);
                } else {
                    showToast("复制失败，请在下方展开代码框手动全选复制", "error");
                }
            }
        });
    }

    // 另存为 .txt 代码文件
    if (downloadBtn) {
        downloadBtn.addEventListener("click", () => {
            if (!generatedCode) return;
            const firstName = playlist[0] ? playlist[0].name : "piano_workshop";
            const filename = `${firstName}_共${playlist.length}首_OW2工坊规则代码.txt`;
            const blob = new Blob([generatedCode], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`已成功下载代码文件：${filename}`, "success");
        });
    }

    // 展开/折叠代码原文预览 (独立模态弹窗)
    if (toggleCodeBtn && codeWrapper) {
        toggleCodeBtn.addEventListener("click", () => {
            isCodeExpanded = !isCodeExpanded;
            if (isCodeExpanded) {
                codeWrapper.style.display = "flex";
                setCodeToggleLabel(true);
            } else {
                codeWrapper.style.display = "none";
                setCodeToggleLabel(false);
            }
        });
    }

    const closeCodeModalBtn = document.getElementById("closeCodeModalBtn");
    if (closeCodeModalBtn && codeWrapper && toggleCodeBtn) {
        closeCodeModalBtn.addEventListener("click", () => {
            isCodeExpanded = false;
            codeWrapper.style.display = "none";
            setCodeToggleLabel(false);
        });
        codeWrapper.addEventListener("click", (e) => {
            if (e.target === codeWrapper) {
                isCodeExpanded = false;
                codeWrapper.style.display = "none";
                setCodeToggleLabel(false);
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && isCodeExpanded) {
                isCodeExpanded = false;
                codeWrapper.style.display = "none";
                setCodeToggleLabel(false);
            }
        });
    }

    // 游戏导入指引常驻展开与快速聚焦
    const guideTriggerLink = document.getElementById("guideTriggerLink");
    if (inGameGuideSection) {
        const guideSummary = inGameGuideSection.querySelector("summary");
        if (guideSummary) {
            guideSummary.addEventListener("click", (e) => {
                // 确保点击 summary 时不会折叠收起，永久保持展开
                e.preventDefault();
                inGameGuideSection.open = true;
            });
        }
    }
    if (guideTriggerLink && inGameGuideSection) {
        guideTriggerLink.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            inGameGuideSection.open = true;
            inGameGuideSection.classList.add("guide-highlighted");
            inGameGuideSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
            setTimeout(() => {
                inGameGuideSection.classList.remove("guide-highlighted");
            }, 1500);
        });
    }

    // ════════════ 10. 钢琴试听引擎（WebAudio） ════════════
    // 设计要点：
    //  · 弦振动：每个音用「按音高生成的泛音表 + 两根微失谐琴弦」合成，带击弦点陷波，贴近真实琴弦的拍频与音色
    //  · 双段衰减：先快速衰到“前音”，再沿长尾“余音”缓慢衰减；低音更长、高音更短
    //  · 力度感应：力度越大音越亮，击弦后高频迅速回落；曲内力度整体归一，并对和弦高音 / 低音做轻微强调
    //  · 延音踏板：读取 MIDI 的 CC64；没有踏板数据的曲目按低音更换自动踏板
    //  · 前瞻调度：按时间窗口逐批排程，整首曲子完整播放，不再只播前 48 秒
    const PIANO_LOOKAHEAD_SEC = 0.7;
    const PIANO_SCHEDULER_MS = 70;
    const PIANO_MAX_VOICES = 48;
    const pianoWaveCaches = new WeakMap();
    const pianoNoiseCaches = new WeakMap();
    let pianoBus = null;
    let pianoSession = null;
    // 音质 / 性能档位（可在运行时调整，用于性能对比）
    const pianoTuning = { hammer: true, strings: 2, panner: true, maxVoices: PIANO_MAX_VOICES, stopDb: 52, adaptiveAt: 22, reverb: true, irSeconds: 1.3 };
    const nowBarEl = document.querySelector(".now-bar");
    const nowProgressEl = document.getElementById("nowProgress");

    const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const lerpNum = (a, b, t) => a + (b - a) * t;

    /** 立体声混响冲激响应：带预延迟、随时间变暗的尾音（木质琴房感，而非白噪声嘶嘶声） */
    function createReverbBuffer(ctx, duration, decay) {
        const sampleRate = ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * (duration || 1.8));
        const decayRate = decay || 2.6;
        const preDelay = Math.floor(sampleRate * 0.014);
        const impulse = ctx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            let lp = 0;
            for (let i = preDelay; i < length; i++) {
                const t = (i - preDelay) / sampleRate;
                const env = Math.exp(-t * decayRate);
                // 单极低通：尾音越往后越暗
                const k = clampNum(0.55 - t * 0.28, 0.12, 0.55);
                lp += ((Math.random() * 2 - 1) - lp) * k;
                data[i] = lp * env * (t < 0.08 ? 0.6 + t * 5 : 1);
            }
        }
        return impulse;
    }

    /** 琴槌击弦噪声：按低 / 中 / 高三个音区预先做好带通滤波（逐样本一次性计算，播放时没有任何滤波节点） */
    const HAMMER_BANDS = [650, 1500, 3300];
    function getHammerNoiseBuffer(ctx, band) {
        let cache = pianoNoiseCaches.get(ctx);
        if (!cache) { cache = []; pianoNoiseCaches.set(ctx, cache); }
        if (!cache[band]) {
            const rate = ctx.sampleRate || 44100;
            const length = Math.floor(rate * 0.024);
            const buffer = ctx.createBuffer(1, length, rate);
            const data = buffer.getChannelData(0);
            // 二阶谐振带通（RBJ）：y = b0*x - b2*x2 - a1*y1 - a2*y2
            const w0 = 2 * Math.PI * HAMMER_BANDS[band] / rate, q = 1.3, alpha = Math.sin(w0) / (2 * q);
            const a0 = 1 + alpha, b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
            let x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0;
            for (let i = 0; i < length; i++) {
                const x = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
                const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
                x2 = x1; x1 = x; y2 = y1; y1 = y;
                data[i] = y; peak = Math.max(peak, Math.abs(y));
            }
            for (let i = 0; i < length; i++) data[i] /= (peak || 1);
            cache[band] = buffer;
        }
        return cache[band];
    }

    /** 主总线：干声 + 混响发送 → 压限 → 主音量（可用于真实或离线音频上下文） */
    function buildPianoBus(ctx) {
        const t = ctx.currentTime || 0;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-16, t);
        compressor.knee.setValueAtTime(12, t);
        compressor.ratio.setValueAtTime(3.5, t);
        compressor.attack.setValueAtTime(0.006, t);
        compressor.release.setValueAtTime(0.22, t);

        const master = ctx.createGain();
        master.gain.setValueAtTime(0.9, t);
        // 琴箱共鸣：轻微抬高中低频，削掉刺耳的超高频
        const body = ctx.createBiquadFilter();
        body.type = "peaking"; body.frequency.setValueAtTime(240, t); body.gain.setValueAtTime(1.0, t); body.Q.setValueAtTime(0.8, t);
        // 中低频“浑浊区”轻微凹陷：让低音与中音更容易分开
        const mud = ctx.createBiquadFilter();
        mud.type = "peaking"; mud.frequency.setValueAtTime(330, t); mud.gain.setValueAtTime(-2.2, t); mud.Q.setValueAtTime(0.9, t);
        const air = ctx.createBiquadFilter();
        air.type = "lowpass"; air.frequency.setValueAtTime(11500, t); air.Q.setValueAtTime(0.5, t);

        const dry = ctx.createGain(); dry.gain.setValueAtTime(0.85, t);
        const send = ctx.createGain(); send.gain.setValueAtTime(0.16, t);
        dry.connect(compressor);
        if (pianoTuning.reverb) {
            // 低频不送入混响：低音 / 中音一旦进混响就会糊在一起
            const sendHp = ctx.createBiquadFilter();
            sendHp.type = "highpass"; sendHp.frequency.setValueAtTime(260, t); sendHp.Q.setValueAtTime(0.6, t);
            const convolver = ctx.createConvolver();
            convolver.buffer = createReverbBuffer(ctx, pianoTuning.irSeconds, 2.6 * 1.9 / pianoTuning.irSeconds);
            send.connect(sendHp);
            sendHp.connect(convolver);
            convolver.connect(compressor);
        }
        compressor.connect(body);
        body.connect(mud);
        mud.connect(air);
        air.connect(master);
        master.connect(ctx.destination);
        return { dry, send, master };
    }

    /** 每个音高一张泛音表（击弦点约在弦长 1/8 处，对应泛音被削弱） */
    function getPianoWave(ctx, midiPitch) {
        let cache = pianoWaveCaches.get(ctx);
        if (!cache) { cache = new Map(); pianoWaveCaches.set(ctx, cache); }
        // 每 4 个半音共用一张泛音表：不同波形的振荡器越多，浏览器查表开销越大
        const key = Math.floor(Math.round(midiPitch) / 4) * 4 + 2;
        let wave = cache.get(key);
        if (!wave) {
            const freq = 440 * Math.pow(2, (key + 2 - 69) / 12); // 以档内最高音为准决定泛音数，避免超过奈奎斯特
            const count = clampNum(Math.floor(9000 / freq), 6, 26);
            const real = new Float32Array(count + 1);
            const imag = new Float32Array(count + 1);
            const strikePos = 0.125 + (key - 60) * 0.0004;
            const bassBoost = clampNum((60 - key) / 40, 0, 1); // 低音区基频偏弱、2~4 次泛音更强
            for (let k = 1; k <= count; k++) {
                const strike = Math.abs(Math.sin(Math.PI * k * strikePos));
                let amp = Math.pow(k, -1.28) * (0.35 + 0.65 * strike);
                if (k === 1) amp *= 1 - 0.45 * bassBoost;
                if (k >= 2 && k <= 4) amp *= 1 + 0.5 * bassBoost;
                imag[k] = amp;
            }
            wave = ctx.createPeriodicWave(real, imag);
            cache.set(key, wave);
        }
        return wave;
    }

    /**
     * 排程一个钢琴音
     * @param note { midi, vel(0~1 已归一), hold(按键+踏板维持的秒数), pan }
     * @returns voice 句柄，用于提前淡出
     */
    function schedulePianoNote(ctx, bus, note, playTime) {
        const midiPitch = note.midi;
        const freq = 440 * Math.pow(2, (midiPitch - 69) / 12);
        const pitchNorm = clampNum((midiPitch - 21) / 87, 0, 1);
        const vel = clampNum(note.vel, 0.03, 1);
        const hold = Math.max(0.04, note.hold);
        const keyHold = clampNum(note.keyHold || hold, 0.04, hold);

        const peak = 0.30 * Math.pow(vel, 1.4) * lerpNum(1.0, 0.82, pitchNorm);
        // 衰减速度参考真实钢琴：低音（C2）约 -1.5dB/s，中央 C 约 -4dB/s，高音（C6）约 -9dB/s
        const tauFast = lerpNum(0.5, 0.1, pitchNorm);             // 前音：击弦后的快速回落
        const tauSlow = 6.5 * Math.exp(-2.25 * pitchNorm);         // 余音：缓慢的长尾
        const promptLevel = lerpNum(0.55, 0.36, pitchNorm);       // 前音结束时保留的比例
        const pedalTau = 2.4;                                      // 踏板延音时，松键后的音仍会比自由弦衰减得更快（阻尼不完全）
        const attack = lerpNum(0.007, 0.0025, vel);
        const releaseTau = lerpNum(0.2, 0.045, pitchNorm);
        const offTime = playTime + hold;
        const naturalEnd = playTime + attack + tauFast * 1.2 + tauSlow * (pianoTuning.stopDb / 8.7); // 衰减到约 -stopDb
        const stopTime = Math.min(offTime + releaseTau * 7, naturalEnd);

        // 振荡器：中高音区两根微失谐琴弦，低音区单弦；高音区略拉伸调音
        const stretch = midiPitch > 60 ? Math.pow(midiPitch - 60, 1.2) * 0.05 : -Math.pow(60 - midiPitch, 1.2) * 0.05;
        const strings = note.strings || pianoTuning.strings;
        const beat = (midiPitch < 40 || strings < 2) ? 0 : lerpNum(0.8, 0.5, pitchNorm) + Math.random() * 0.3;
        const wave = getPianoWave(ctx, midiPitch);
        const oscillators = [];
        const mix = ctx.createGain();
        mix.gain.setValueAtTime(beat === 0 ? 1 : 0.55, playTime);
        const detunes = beat === 0 ? [0] : [-beat, beat];
        for (const d of detunes) {
            const osc = ctx.createOscillator();
            osc.setPeriodicWave(wave);
            osc.frequency.setValueAtTime(freq, playTime);
            osc.detune.setValueAtTime(d + stretch, playTime);
            osc.connect(mix);
            oscillators.push(osc);
        }

        // 力度感应低通：弹得重更亮，击弦后高频很快回落
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.Q.setValueAtTime(0.4, playTime);
        const cutoff0 = clampNum(freq * (2.2 + 7 * vel), 700, 12000);
        const cutoff1 = clampNum(freq * (1.9 + 2.0 * vel) + 300, 500, 5000);
        const cutoff2 = clampNum(freq * 1.5 + 220, 400, 2400);
        // 注意：滤波器频率必须用有终点的斜坡，不要用 setTargetAtTime（它永不结束，浏览器会在整个音的时长内逐采样重算系数，开销约高 20 倍）
        filter.frequency.setValueAtTime(cutoff0, playTime);
        filter.frequency.exponentialRampToValueAtTime(cutoff1, playTime + 0.35);
        // 高次泛音比基音衰减得更快：声音随时间越来越“圆”，而不是一直保持明亮
        filter.frequency.exponentialRampToValueAtTime(Math.min(cutoff1, cutoff2), playTime + 2.4);

        // 双段衰减包络
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.0001, playTime);
        env.gain.linearRampToValueAtTime(peak, playTime + attack);
        env.gain.setTargetAtTime(peak * promptLevel, playTime + attack, tauFast * 0.3);
        env.gain.setTargetAtTime(0, playTime + attack + tauFast * 1.2, tauSlow);

        // 阻尼器：松键后若被踏板托住，先以较快速度衰减；松踏板（或无踏板时松键）时阻尼器落下
        const release = ctx.createGain();
        release.gain.setValueAtTime(1, playTime);
        if (hold - keyHold > 0.06) release.gain.setTargetAtTime(0, playTime + keyHold + 0.04, pedalTau);
        release.gain.setTargetAtTime(0, offTime, releaseTau);

        const panner = (pianoTuning.panner && typeof ctx.createStereoPanner === "function") ? ctx.createStereoPanner() : null;
        if (panner) panner.pan.setValueAtTime(clampNum(note.pan, -0.6, 0.6), playTime);

        mix.connect(filter);
        filter.connect(env);
        env.connect(release);
        const out = panner || release;
        if (panner) release.connect(panner);
        out.connect(bus.dry);
        out.connect(bus.send);

        // 琴槌击弦噪声：只在击弦瞬间出现，不受松键影响
        const nodes = [mix, filter, env, release];
        if (panner) nodes.push(panner);
        if (pianoTuning.hammer) {
            try {
                const hammer = ctx.createBufferSource();
                hammer.buffer = getHammerNoiseBuffer(ctx, midiPitch < 48 ? 0 : (midiPitch < 72 ? 1 : 2));
                const hg = ctx.createGain();
                hg.gain.setValueAtTime(0.11 * Math.pow(vel, 1.5), playTime);
                hammer.connect(hg);
                hg.connect(panner || bus.dry);
                hammer.start(playTime);
                hammer.onended = () => { try { hammer.disconnect(); hg.disconnect(); } catch (e) {} };
            } catch (e) { /* 击弦噪声只是点缀，失败不影响主音 */ }
        }

        for (const osc of oscillators) { osc.start(playTime); osc.stop(stopTime); }
        const voice = { ctx, oscillators, release, stopTime, nodes, done: false };
        oscillators[0].onended = () => {
            voice.done = true;
            for (const n of nodes) { try { n.disconnect(); } catch (e) {} }
            if (pianoSession) pianoSession.voices.delete(voice);
        };
        return voice;
    }

    /** 在指定时刻把一个音压下去（同一根弦被再次击响时，旧音要先被抑制） */
    function dampPianoVoiceAt(voice, time, tau) {
        if (!voice || voice.done) return;
        try {
            voice.release.gain.cancelScheduledValues(time);
            voice.release.gain.setTargetAtTime(0, time, tau);
            const end = time + tau * 7;
            for (const osc of voice.oscillators) osc.stop(end);
            voice.stopTime = Math.min(voice.stopTime, end);
        } catch (e) { /* 已经结束的音不需要处理 */ }
    }

    /** 快速淡出一个仍在发声的音（停止试听 / 复音数过多时抢占） */
    function fadePianoVoice(voice, tau = 0.04) {
        if (!voice || voice.done) return;
        const ctx = voice.ctx;
        const now = ctx.currentTime;
        try {
            voice.release.gain.cancelScheduledValues(now);
            voice.release.gain.setValueAtTime(voice.release.gain.value, now);
            voice.release.gain.setTargetAtTime(0, now, tau);
            for (const osc of voice.oscillators) { try { osc.stop(now + tau * 7); } catch (e) {} }
        } catch (e) {}
    }

    /** 力度归一：把曲目的 90 分位力度拉到中等强度，避免整体过弱或过强 */
    function normalizeVelocities(notes) {
        if (!notes.length) return;
        const sorted = notes.map(n => n.vel).sort((a, b) => a - b);
        const p90 = Math.max(0.3, sorted[Math.floor(sorted.length * 0.9)] || 0.7);
        const scale = clampNum(0.72 / p90, 0.8, 2.4);
        for (const n of notes) n.vel = clampNum(n.vel * scale, 0.05, 1);
    }

    /** 无踏板数据时的自动踏板：随低音更换，最长 2.2 秒，更换时短暂抬起 */
    function buildAutoPedal(notes, endTime) {
        const bass = notes.filter(n => n.midi <= 52).map(n => n.t).sort((a, b) => a - b);
        const changes = [0];
        for (const t of bass) if (t - changes[changes.length - 1] >= 0.35) changes.push(t);
        const dense = [];
        for (let i = 0; i < changes.length; i++) {
            dense.push(changes[i]);
            const next = i + 1 < changes.length ? changes[i + 1] : endTime + 3;
            for (let t = changes[i] + 1.6; t < next - 0.4; t += 1.6) dense.push(t);
        }
        const intervals = [];
        for (let i = 0; i < dense.length; i++) {
            const down = dense[i];
            const up = (i + 1 < dense.length ? dense[i + 1] : endTime + 0.5) - 0.09;
            if (up > down) intervals.push([down, up]);
        }
        return intervals;
    }

    function pedalIntervalsFromEvents(events) {
        events.sort((a, b) => a.t - b.t);
        const intervals = [];
        let down = null;
        for (const e of events) {
            if (e.down && down === null) down = e.t;
            else if (!e.down && down !== null) { intervals.push([down, e.t]); down = null; }
        }
        if (down !== null) intervals.push([down, down + 8]);
        return intervals;
    }

    /** 把 MIDI 转成可直接排程的音符事件（含踏板、力度归一、和弦强调） */
    function buildPianoEvents(mid, startSec, trackMask) {
        const notes = [];
        const pedalEvents = new Map();
        let pedalCount = 0;
        const mask = trackMask ? new Set(trackMask) : null;
        ((mid && mid.tracks) || []).forEach((track, trackIndex) => {
            if (track.channel === 9) return;
            const ch = track.channel;
            const cc = track.controlChanges && track.controlChanges[64];
            if (cc && cc.length) {
                const list = pedalEvents.get(ch) || [];
                for (const e of cc) list.push({ t: e.time, down: e.value >= 0.5 });
                pedalEvents.set(ch, list);
                pedalCount += cc.length;
            }
            // 踏板来自所有音轨（踏板常写在某一条钢琴轨上）；音符只取所选音轨
            if (mask && !mask.has(trackIndex)) return;
            for (const n of (track.notes || [])) {
                if (n.velocity === 0 || n.duration <= 0) continue;
                notes.push({ t: n.time, end: n.time + n.duration, midi: n.midi, vel: n.velocity, ch });
            }
        });
        if (!notes.length) return { events: [], duration: 0, autoPedal: false };
        normalizeVelocities(notes);

        let songEnd = 0;
        for (const n of notes) songEnd = Math.max(songEnd, n.end);
        // 踏板按声道记录；某声道没有踏板数据时沿用“主踏板”（踩下最多的声道），因为真实钢琴只有一个踏板
        const perChannel = new Map();
        let primary = null, primaryLen = 0;
        for (const [ch, list] of pedalEvents) {
            const intervals = pedalIntervalsFromEvents(list);
            perChannel.set(ch, intervals);
            const len = intervals.reduce((a, [d, u]) => a + (u - d), 0);
            if (len > primaryLen) { primaryLen = len; primary = intervals; }
        }
        // 踏板覆盖不足整首的 15%（如只有“抬起”事件、或整首只踩了一两下）视为没有踏板数据，改用自动踏板
        // 另外要求踏板有合理的更换频率（约每 12 秒至少一次）且不能几乎一直踩着；
        // 只在开头踩下、结尾才抬起的“整首踩死”数据会让声音糊成一团，同样视为无效
        const hasPedal = pedalCount >= 4 && primary !== null
            && primaryLen >= songEnd * 0.15 && primaryLen <= songEnd * 0.97
            && primary.length >= songEnd / 12;
        const auto = hasPedal ? null : buildAutoPedal(notes, songEnd);
        const findUp = (intervals, t) => {
            let lo = 0, hi = intervals.length - 1;
            while (lo <= hi) {
                const mid2 = (lo + hi) >> 1;
                const [d, u] = intervals[mid2];
                if (t < d) hi = mid2 - 1; else if (t >= u) lo = mid2 + 1; else return u;
            }
            return -1;
        };

        // 和弦强调：同一时刻的最高音略突出（旋律），最低音略突出（低音线）
        notes.sort((a, b) => a.t - b.t);
        for (let i = 0; i < notes.length;) {
            let j = i;
            while (j < notes.length && notes[j].t - notes[i].t < 0.02) j++;
            if (j - i > 1) {
                let hi = i, lo = i;
                for (let k = i; k < j; k++) { if (notes[k].midi > notes[hi].midi) hi = k; if (notes[k].midi < notes[lo].midi) lo = k; }
                notes[hi].vel = Math.min(1, notes[hi].vel * 1.10);
                notes[lo].vel = Math.min(1, notes[lo].vel * 1.04);
                for (let k = i; k < j; k++) if (k !== hi && k !== lo) notes[k].vel *= 0.93;
            }
            i = j;
        }

        const events = [];
        for (const n of notes) {
            if (n.t < startSec) continue;
            const intervals = hasPedal ? (perChannel.get(n.ch) || primary) : auto;
            let offAt = n.end + 0.03;
            if (intervals) {
                const up = findUp(intervals, n.end);
                if (up > 0) offAt = Math.max(offAt, Math.min(up, n.end + 7));
            }
            // 曲终后最多再托 0.8 秒，避免最后一个音拖出一条长尾
            offAt = Math.min(offAt, songEnd + 0.8);
            // 极短的音不低于一次击弦的最短持续
            const hold = Math.max(0.09, offAt - n.t);
            events.push({
                t: n.t - startSec,
                keyHold: Math.min(hold, Math.max(0.09, n.end + 0.03 - n.t)),
                midi: n.midi,
                vel: clampNum(n.vel * (0.96 + Math.random() * 0.08), 0.04, 1),
                hold,
                pan: clampNum((n.midi - 64) / 40 * 0.5, -0.5, 0.5)
            });
        }
        events.sort((a, b) => a.t - b.t);
        return { events, duration: Math.max(0, songEnd - startSec), autoPedal: !hasPedal };
    }

    function ensureAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (!audioCtx) return null;
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        if (!pianoBus) {
            try { pianoBus = buildPianoBus(audioCtx); }
            catch (err) { console.warn("钢琴音频总线初始化失败:", err); return null; }
        }
        return audioCtx;
    }

    function setPreviewProgress(fraction) {
        if (nowProgressEl) nowProgressEl.style.transform = `scaleX(${clampNum(fraction, 0, 1).toFixed(4)})`;
    }

    function stopAudioPreview() {
        const session = pianoSession;
        pianoSession = null;
        isAudioPlaying = false;
        if (session) {
            clearInterval(session.timer);
            for (const voice of [...session.voices]) fadePianoVoice(voice, 0.035);
            session.voices.clear();
            // 手动停止：主音量快速收掉，连混响尾巴一起切干净
            if (pianoBus && session.ctx) {
                const now = session.ctx.currentTime;
                pianoBus.master.gain.cancelScheduledValues(now);
                pianoBus.master.gain.setTargetAtTime(0, now, 0.04);
            }
        }
        setPreviewProgress(0);
        setPreviewBtnPlaying(false);
    }

    function pianoSchedulerTick() {
        const s = pianoSession;
        if (!s) return;
        const ctx = s.ctx;
        const now = ctx.currentTime;
        const horizon = now - s.t0 + PIANO_LOOKAHEAD_SEC;
        while (s.index < s.events.length && s.events[s.index].t <= horizon) {
            const ev = s.events[s.index++];
            if (s.voices.size >= pianoTuning.maxVoices) {
                // 复音过多：抢占最早的音，避免 CPU 爆满
                const oldest = s.voices.values().next().value;
                fadePianoVoice(oldest, 0.03);
                s.voices.delete(oldest);
            }
            const playTime = Math.max(s.t0 + ev.t, now + 0.004);
            // 密集段落自动降为单弦：声音厚重时双弦拍频听不出来，却能把 CPU 压在安全范围
            if (s.voices.size >= pianoTuning.adaptiveAt) ev.strings = 1;
            const previous = s.lastByPitch.get(ev.midi);
            if (previous) dampPianoVoiceAt(previous, playTime, 0.06);
            const voice = schedulePianoNote(ctx, pianoBus, ev, playTime);
            s.lastByPitch.set(ev.midi, voice);
            s.voices.add(voice);
        }
        setPreviewProgress((now - s.t0) / Math.max(1, s.duration));
        if (s.index >= s.events.length && !s.ending && now - s.t0 > s.duration + 0.9) {
            // 全部排程完毕：曲终后自然收尾——整体淡出，混响尾巴一并收掉，不拖长音
            s.ending = true;
            s.endAt = now + 0.9;
            for (const voice of s.voices) fadePianoVoice(voice, 0.22);
            if (pianoBus) { pianoBus.master.gain.cancelScheduledValues(now); pianoBus.master.gain.setTargetAtTime(0, now, 0.28); }
        }
        if (s.ending && now >= s.endAt) stopAudioPreview();
    }

    function startAudioPreview(maskOverride) {
        if (playlist.length === 0) return;
        const currentSong = playlist[selectedPreviewIndex] || playlist[0];
        if (!currentSong || !currentSong.mid || !currentSong.mid.tracks) return;

        stopAudioPreview();
        const ctx = ensureAudioContext();
        if (!ctx) {
            showToast("当前浏览器不支持网页试听", "error");
            return;
        }
        const startSec = Math.max(0, parseFloat(startTimeInput ? startTimeInput.value : 0) || 0);
        const built = buildPianoEvents(currentSong.mid, startSec, Array.isArray(maskOverride) ? maskOverride : currentSong.trackMask);
        if (!built.events.length) {
            showToast("当前选定起始时间后未检测到可用音符", "error");
            return;
        }
        isAudioPlaying = true;
        pianoSession = {
            ctx, events: built.events, index: 0, duration: built.duration,
            t0: ctx.currentTime + 0.15, voices: new Set(), timer: null,
            lastByPitch: new Map(), ending: false, endAt: 0,
            solo: Array.isArray(maskOverride) ? maskOverride[0] : null,
            soloSongId: currentSong.id
        };
        // 上一次停止时主音量被收到 0：新一轮播放开始前恢复
        pianoBus.master.gain.cancelScheduledValues(ctx.currentTime);
        pianoBus.master.gain.setValueAtTime(0.9, ctx.currentTime + 0.01);
        pianoSession.timer = setInterval(pianoSchedulerTick, PIANO_SCHEDULER_MS);
        pianoSchedulerTick();
        setPreviewBtnPlaying(true);
    }

    if (previewAudioBtn) {
        previewAudioBtn.addEventListener("click", () => {
            if (isAudioPlaying) {
                stopAudioPreview();
            } else {
                startAudioPreview();
            }
        });
    }

    // ════════════ 11. 选项卡与高级浮层交互挂载 ════════════
    function switchTab(tabKey) {
        if (tabKey === "presets") {
            if (tabPresetLibrary) {
                tabPresetLibrary.classList.add("active");
                if (tabPresetLibrary.setAttribute) tabPresetLibrary.setAttribute("aria-selected", "true");
            }
            if (tabPlaylist) {
                tabPlaylist.classList.remove("active");
                if (tabPlaylist.setAttribute) tabPlaylist.setAttribute("aria-selected", "false");
            }
            if (tabPanePresets) tabPanePresets.classList.add("active");
            if (tabPanePlaylist) tabPanePlaylist.classList.remove("active");
        } else if (tabKey === "playlist") {
            if (tabPlaylist) {
                tabPlaylist.classList.add("active");
                if (tabPlaylist.setAttribute) tabPlaylist.setAttribute("aria-selected", "true");
            }
            if (tabPresetLibrary) {
                tabPresetLibrary.classList.remove("active");
                if (tabPresetLibrary.setAttribute) tabPresetLibrary.setAttribute("aria-selected", "false");
            }
            if (tabPanePlaylist) tabPanePlaylist.classList.add("active");
            if (tabPanePresets) tabPanePresets.classList.remove("active");
        }
    }

    if (tabPresetLibrary) tabPresetLibrary.addEventListener("click", () => switchTab("presets"));
    if (tabPlaylist) tabPlaylist.addEventListener("click", () => switchTab("playlist"));
    if (btnGotoPresets) {
        btnGotoPresets.addEventListener("click", () => {
            switchTab("presets");
            // 三栏布局下曲库常驻可见：轻闪曲库面板并聚焦第一首
            const libraryPane = document.getElementById("card1_musicManage");
            if (libraryPane && libraryPane.classList) {
                libraryPane.classList.remove("pane-flash");
                void libraryPane.offsetWidth;
                libraryPane.classList.add("pane-flash");
            }
            if (librarySearch && librarySearch.focus) librarySearch.focus({ preventScroll: true });
        });
    }

    // 整个播放列表面板均可接收 MIDI 拖放
    const playlistPane = document.getElementById("playlistPane");
    if (playlistPane) {
        let dragDepth = 0;
        const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
        playlistPane.addEventListener("dragenter", (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            dragDepth++;
            playlistPane.classList.add("drag-active");
        });
        playlistPane.addEventListener("dragover", (e) => {
            if (hasFiles(e)) e.preventDefault();
        });
        playlistPane.addEventListener("dragleave", () => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) playlistPane.classList.remove("drag-active");
        });
        playlistPane.addEventListener("drop", (e) => {
            e.preventDefault();
            dragDepth = 0;
            playlistPane.classList.remove("drag-active");
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                addTracks(e.dataTransfer.files);
            }
        });
    }

    // 上传区键盘可达
    if (dropzone && midiFileInput) {
        dropzone.addEventListener("keydown", (e) => {
            if ((e.key === "Enter" || e.key === " ") && e.target === dropzone) {
                e.preventDefault();
                midiFileInput.click();
            }
        });
    }

    // 高级设置 Popover 浮层点击外部自动收起 (0px 向下挤压)
    const advancedDetails = document.querySelector(".advanced-settings-details");
    if (advancedDetails) {
        const advancedSummary = advancedDetails.querySelector("summary");
        const advancedContent = advancedDetails.querySelector(".advanced-settings-content");
        const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let closeTimer = null;

        const isInline = () => advancedDetails.classList.contains("voices-inline");

        const closeAdvanced = () => {
            if (isInline()) return;
            if (!advancedDetails.open || advancedDetails.classList.contains("is-closing")) return;
            if (reduceMotion || !advancedContent) {
                advancedDetails.open = false;
                return;
            }
            advancedDetails.classList.add("is-closing");
            const finish = () => {
                clearTimeout(closeTimer);
                advancedContent.removeEventListener("animationend", finish);
                advancedDetails.classList.remove("is-closing");
                advancedDetails.open = false;
            };
            advancedContent.addEventListener("animationend", finish);
            closeTimer = setTimeout(finish, 260);
        };

        if (advancedSummary) {
            advancedSummary.addEventListener("click", (e) => {
                if (isInline()) {
                    e.preventDefault();
                    return;
                }
                if (advancedDetails.open) {
                    e.preventDefault();
                    closeAdvanced();
                }
            });
        }
        document.addEventListener("click", (e) => {
            if (advancedDetails.open && !advancedDetails.contains(e.target)) {
                closeAdvanced();
            }
        });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closeAdvanced();
        });

        // 屏幕足够高时，声部选项直接内联展示，无需展开浮层
        if (window.matchMedia) {
            const tallQuery = window.matchMedia("(min-height: 1070px) and (min-width: 1101px)");
            const applyVoiceLayout = () => {
                advancedDetails.classList.remove("is-closing");
                if (tallQuery.matches) {
                    advancedDetails.classList.add("voices-inline");
                    advancedDetails.open = true;
                } else if (isInline()) {
                    advancedDetails.classList.remove("voices-inline");
                    advancedDetails.open = false;
                }
            };
            applyVoiceLayout();
            if (tallQuery.addEventListener) tallQuery.addEventListener("change", applyVoiceLayout);
        }
    }

    // 核心按钮按压涟漪
    if (coreActionBtn) {
        coreActionBtn.addEventListener("pointerdown", (e) => {
            if (coreActionBtn.disabled || !coreActionBtn.getBoundingClientRect) return;
            const rect = coreActionBtn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height) * 2;
            const ripple = document.createElement("span");
            ripple.className = "ripple";
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
            coreActionBtn.appendChild(ripple);
            ripple.addEventListener("animationend", () => ripple.remove());
        });
    }

    syncSettingsDisplay();
    renderPlaylist();

    // ════════════ 12. 导出 QA 与测试接口 (window.OWApp & window.OWPianoApp) ════════════
    const publicApi = {
        APP_STATE,
        MAX_SONGS_LIMIT,
        getState: () => currentState,
        getPlaylist: () => playlist,
        getSelectedPreviewIndex: () => selectedPreviewIndex,
        setSelectedPreviewIndex: (idx) => selectPreviewTrack(idx),
        executeGenerate: () => {
            executeGenerateSync();
            return generatedCode;
        },
        triggerAutoRegenerate,
        addTracks,
        addSample,
        removeTrack,
        clearPlaylist,
        stopAudioPreview,
        startAudioPreview,
        getGeneratedCode: () => generatedCode,
        setAppState,
        renderPlaylist,
        syncSettingsDisplay,
        calculateCapacity,
        updateCapacity,
        updateCapacityIndicator,
        getGenVersion: () => currentGenVersion,
        hasConfigChanged: () => hasConfigChanged,
        getLastParserResult: () => lastParserResult,
        getLastTruncationDetails: () => lastTruncationDetails,
        switchTab,
        previewTrackAt,
        openTrackPicker,
        setTrackMask: (idx, mask, mode = "custom") => applyTrackMask(idx, mask, mode),
        isPreviewPlaying: () => isAudioPlaying,
        pianoEngine: { buildPianoBus, schedulePianoNote, buildPianoEvents, dampPianoVoiceAt, tuning: pianoTuning },
        getLibrary: () => LIBRARY,
        addLibrarySong: (key) => addSample(key, false),
        searchLibrary: (query) => setLibraryQuery(query || ""),
        filterLibrary: (key) => setLibraryFilter(key || "all"),
        // 兼容测试挂钩
        addMidiToPlaylist: (midi, name, isSample) => {
            addMidiToPlaylist(midi, name, isSample);
        }
    };

    if (typeof window !== "undefined") {
        window.OWApp = publicApi;
        window.OWPianoApp = publicApi;
    }

})();
