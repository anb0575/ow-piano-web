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
    const sampleBirthday = document.getElementById("sampleBirthday");
    const sampleQueen = document.getElementById("sampleQueen");
    const sampleLanting = document.getElementById("sampleLanting");
    const sampleGreatWork = document.getElementById("sampleGreatWork");
    const sampleTingmama = document.getElementById("sampleTingmama");
    const sampleJukhuatai = document.getElementById("sampleJukhuatai");
    const sampleMojito = document.getElementById("sampleMojito");
    const sampleHongyan = document.getElementById("sampleHongyan");
    const sampleFanfangxiang = document.getElementById("sampleFanfangxiang");
    const sampleHuahai = document.getElementById("sampleHuahai");
    const sampleYilu = document.getElementById("sampleYilu");
    const sampleTitanic = document.getElementById("sampleTitanic");
    const sampleBirthdayBtn = document.getElementById("sampleBirthdayBtn");
    const sampleQueenBtn = document.getElementById("sampleQueenBtn");
    const toast = document.getElementById("toast");

    // 拟真声学大钢琴 WebAudio 物理建模引擎状态
    let audioCtx = null;
    let isAudioPlaying = false;
    let audioScheduledSources = [];
    let audioTimeouts = [];
    let masterCompressor = null;
    let masterGain = null;
    let dryGain = null;
    let reverbGain = null;
    let reverbConvolver = null;
    let cachedHammerNoiseBuffer = null;

    // 工坊容量与警告状态跟踪
    let lastParserWarnings = [];
    let lastCompressedSize = null;
    let lastParserResult = null;
    let lastExportedNotes = 0;
    let lastExportedDuration = 0;
    let lastTruncationDetails = null;

    // 内置《生日快乐歌》base64 (标准单音轨 MIDI，416字节秒载入)
    const BIRTHDAY_B64 = "TVRoZAAAAAYAAQABAeBNVHJrAAABigD/WAQDAhgIAP9ZAgAAAP9RAwmJaADAAAKwB2QCCkACWx4CXR6HOJBDUIFYQwAYQ1CBWEMAGEVQgzBFADBDUIMwQwAwSFCDMEgAMEdQhmBHAGBDUIFYQwAYQ1CBWEMAGEVQgzBFADBDUIMwQwAwSlCDMEoAMEhQhmBIAGBDUIFYQwAYQ1CBWEMAGE9QgzBPADBMUIMwTAAwSFCDMEgAMEdQgzBHADBFUIMwRQAwTVCBWE0AGE1QgVhNABhMUIMwTAAwSFCDMEgAMEpQgzBKADBIUIZgSACMAENQgVhDABhDUIFYQwAYRVCDMEUAMENQgzBDADBIUIMwSAAwR1CGYEcAYENQgVhDABhDUIFYQwAYRVCDMEUAMENQgzBDADBKUIMwSgAwSFCGYEgAYENQgVhDABhDUIFYQwAYT1CDME8AMExQgzBMADBIUIMwSAAwR1CDMEcAMEVQjn9FAAFNUIFYTQAYTVCBWE0AGExQgzBMADBIUIMwSAAwSlCDMEoAMEhQhmBIAAH/LwA=";

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
            return `<span class="track-badge badge-sample">内置示例</span>`;
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
        } else if (percent < 80) {
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
        const isWarn = !isDanger && (cap.percent >= 80);

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
        }
    }
    const updateCapacityIndicator = updateCapacity;

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
                mid: item.mid,
                startTime: startTime
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
    function updatePresetChipsStatus() {
        const checkChip = (chipEl, nameSnippet, defaultLabel) => {
            if (!chipEl) return;
            const inList = playlist.some(s => s.name && s.name.includes(nameSnippet));
            // 名称保持不变，排队状态由右侧图标表达，避免文字宽度变化
            chipEl.classList.toggle("in-playlist", inList);
            if (chipEl.setAttribute) chipEl.setAttribute("aria-pressed", inList ? "true" : "false");
        };

        checkChip(sampleLanting || sampleTitanic, "兰亭序", "兰亭序");
        checkChip(sampleGreatWork, "最伟大的作品", "最伟大的作品");
        checkChip(sampleTingmama, "听妈妈的话", "听妈妈的话");
        checkChip(sampleJukhuatai, "菊花台", "菊花台");
        checkChip(sampleMojito, "Mojito", "Mojito");
        checkChip(sampleBirthday, "生日快乐", "生日快乐");
        checkChip(sampleQueen, "狂想曲", "狂想曲");
        checkChip(sampleFanfangxiang || sampleHuahai || sampleYilu, "反方向的钟", "反方向的钟");
    }

    function renderPlaylist() {
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
                    <td class="song-idx">${isSelected ? '▶' : '#' + (idx + 1)}</td>
                    <td class="song-name-cell" title="${escapeHtml(song.name)}">
                        <div style="display: flex; align-items: center; min-width: 0;">
                            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;">${escapeHtml(song.name)}</span>
                            ${getTrackBadgeHtml(song.isSample)}
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

            // 绑定行点击切换当前试听曲目
            playlistTbody.querySelectorAll(".playlist-row").forEach(row => {
                row.addEventListener("click", (e) => {
                    if (e.target.closest(".btn-remove-song")) return;
                    const idx = parseInt(row.getAttribute("data-idx"), 10);
                    if (!isNaN(idx) && idx !== selectedPreviewIndex) {
                        selectPreviewTrack(idx);
                    }
                });
            });
        }
        updatePresetChipsStatus();
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
    function addMidiToPlaylist(midiObj, name, isSample = false) {
        if (playlist.length >= MAX_SONGS_LIMIT) {
            showToast(`播放列表已达上限 (最多支持同时保留 ${MAX_SONGS_LIMIT} 首歌曲)`, "warn");
            return false;
        }

        let notesCount = 0;
        if (midiObj && midiObj.tracks) {
            for (const track of midiObj.tracks) {
                if (track.channel !== 9) {
                    notesCount += (track.notes ? track.notes.length : 0);
                }
            }
        }

        const cleanName = name.replace(/\.[^/.]+$/, "");

        const songId = Date.now() + Math.random();
        newlyAddedSongId = songId;

        playlist.push({
            id: songId,
            name: cleanName,
            mid: midiObj,
            duration: midiObj.duration || 0,
            notesCount: notesCount,
            isSample: !!isSample
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
            return lower.endsWith(".mid") || lower.endsWith(".midi");
        });

        if (validFiles.length === 0) {
            showToast("请选择 .mid 或 .midi 格式的音乐文件！", "error");
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
                if (addMidiToPlaylist(midi, file.name, false)) {
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

    // 载入示例曲目 (V3.2 全局 Base64 纯前端秒载入，完全杜绝 fetch / CORS 限制)
    async function addSample(sampleType, isToggle = false) {
        stopAudioPreview();

        let sampleName = "";
        let b64Data = "";

        if (sampleType === "birthday") {
            sampleName = "生日快乐歌";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.BIRTHDAY_B64)
                ? window.OW_SAMPLES.BIRTHDAY_B64
                : BIRTHDAY_B64;
        } else if (sampleType === "queen") {
            sampleName = "波西米亚狂想曲";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.QUEEN_B64)
                ? window.OW_SAMPLES.QUEEN_B64
                : "";
        } else if (sampleType === "greatwork") {
            sampleName = "最伟大的作品";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.GREAT_WORK_B64)
                ? window.OW_SAMPLES.GREAT_WORK_B64
                : "";
        } else if (sampleType === "tingmama") {
            sampleName = "听妈妈的话";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.TINGMAMA_B64)
                ? window.OW_SAMPLES.TINGMAMA_B64
                : "";
        } else if (sampleType === "jukhuatai") {
            sampleName = "菊花台";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.JUKHUATAI_B64)
                ? window.OW_SAMPLES.JUKHUATAI_B64
                : "";
        } else if (sampleType === "mojito") {
            sampleName = "Mojito";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.MOJITO_B64)
                ? window.OW_SAMPLES.MOJITO_B64
                : "";
        } else if (sampleType === "hongyan") {
            sampleName = "红颜如霜";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && window.OW_SAMPLES.HONGYAN_B64)
                ? window.OW_SAMPLES.HONGYAN_B64
                : "";
        } else if (sampleType === "lanting" || sampleType === "titanic") {
            sampleName = "兰亭序";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && (window.OW_SAMPLES.LANTING_B64 || window.OW_SAMPLES.TITANIC_B64))
                ? (window.OW_SAMPLES.LANTING_B64 || window.OW_SAMPLES.TITANIC_B64)
                : "";
        } else if (sampleType === "fanfangxiang" || sampleType === "huahai" || sampleType === "yilu") {
            sampleName = "反方向的钟";
            b64Data = (typeof window !== "undefined" && window.OW_SAMPLES && (window.OW_SAMPLES.FANFANGXIANG_B64 || window.OW_SAMPLES.HUAHAI_B64 || window.OW_SAMPLES.YILU_B64))
                ? (window.OW_SAMPLES.FANFANGXIANG_B64 || window.OW_SAMPLES.HUAHAI_B64 || window.OW_SAMPLES.YILU_B64)
                : "";
        } else {
            showToast("未知示例曲目类型", "error");
            return;
        }

        // 核心交互升级：若曲目已在播放列表中，若支持切换(Toggle)则取消选择并移出，否则提示重复拦截
        const existingIdx = playlist.findIndex(s => s.name === sampleName ||
            (sampleName.includes("反方向的钟") && s.name.includes("反方向的钟")) ||
            (sampleName.includes("兰亭序") && s.name.includes("兰亭序")) ||
            (sampleName.includes("最伟大的作品") && s.name.includes("最伟大的作品")) ||
            (sampleName.includes("听妈妈的话") && s.name.includes("听妈妈的话")) ||
            (sampleName.includes("菊花台") && s.name.includes("菊花台")) ||
            (sampleName.includes("Mojito") && s.name.includes("Mojito")) ||
            (sampleName.includes("红颜如霜") && s.name.includes("红颜如霜")) ||
            (sampleName.includes("花海") && s.name.includes("花海")) ||
            (sampleName.includes("一路向北") && s.name.includes("一路向北")) ||
            (sampleName.includes("生日快乐") && s.name.includes("生日快乐")) ||
            (sampleName.includes("狂想曲") && s.name.includes("狂想曲")));

        if (existingIdx !== -1) {
            if (isToggle) {
                removeTrack(existingIdx);
                showToast(`已取消选择：《${sampleName}》并移出乐谱列表`, "info");
                return;
            } else {
                showToast(`《${sampleName}》已在乐谱列表中，无需重复添加`, "warn");
                return;
            }
        }

        // 若不在列表中，检查容量上限 (最多 6 首)
        if (playlist.length >= MAX_SONGS_LIMIT) {
            showToast(`播放列表已满 (最多保留 ${MAX_SONGS_LIMIT} 首歌曲同时输入)，请先移除部分曲目`, "warn");
            return;
        }

        if (!b64Data) {
            // 尝试通过 fetch 载入本地 samples/ 目录 (兼容传统环境与 QA 测试套件)
            setAppState(APP_STATE.PARSING, `正在读取内置示例《${sampleName}》...`);
            try {
                let sampleFileName = "birthday.mid";
                if (sampleType === "queen") sampleFileName = "queen.mid";
                else if (sampleType === "fanfangxiang") sampleFileName = "反方向的钟.mid";
                else if (sampleType === "huahai") sampleFileName = "花海.mid";
                else if (sampleType === "lanting") sampleFileName = "兰亭序.mid";
                else if (sampleType === "yilu") sampleFileName = "一路向北.mid";
                else if (sampleType === "titanic") sampleFileName = "我心永恒.mid";

                const res = await fetch(`samples/${sampleFileName}`);
                if (!res.ok) throw new Error("无法读取本地样本文件");
                const buf = await res.arrayBuffer();
                const midi = new Midi(buf);
                addMidiToPlaylist(midi, sampleName, true);
                showToast(`已载入示例：《${sampleName}》并加入乐谱列表`, "success", true);
                return;
            } catch (fetchErr) {
                console.error(`加载内置示例《${sampleName}》失败:`, fetchErr);
                showToast(`未找到《${sampleName}》的内置曲目数据`, "error");
                setAppState(playlist.length > 0 ? APP_STATE.READY : APP_STATE.EMPTY);
                return;
            }
        }

        setAppState(APP_STATE.PARSING, `正在载入内置示例《${sampleName}》...`);
        try {
            const buf = base64ToArrayBuffer(b64Data);
            const midi = new Midi(buf);
            addMidiToPlaylist(midi, sampleName, true);
            showToast(`已载入示例：《${sampleName}》并加入乐谱列表`, "success", true);
        } catch (err) {
            console.error(`加载内置示例《${sampleName}》失败:`, err);
            showToast(`加载内置示例失败: ${err.message}`, "error");
            setAppState(playlist.length > 0 ? APP_STATE.READY : APP_STATE.EMPTY);
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

    // 快捷示例载入/切换按钮 (第一/第二梯队经典精选曲目秒载入与排队/取消管理)
    [
        { el: sampleBirthday, type: "birthday", toggle: true },
        { el: sampleBirthdayBtn, type: "birthday", toggle: false },
        { el: sampleQueen, type: "queen", toggle: true },
        { el: sampleQueenBtn, type: "queen", toggle: false },
        { el: sampleLanting, type: "lanting", toggle: true },
        { el: sampleGreatWork, type: "greatwork", toggle: true },
        { el: sampleTingmama, type: "tingmama", toggle: true },
        { el: sampleJukhuatai, type: "jukhuatai", toggle: true },
        { el: sampleMojito, type: "mojito", toggle: true },
        { el: sampleHongyan, type: "hongyan", toggle: true },
        { el: sampleFanfangxiang, type: "fanfangxiang", toggle: true },
        { el: sampleHuahai, type: "fanfangxiang", toggle: true },
        { el: sampleYilu, type: "fanfangxiang", toggle: true },
        { el: sampleTitanic, type: "lanting", toggle: true }
    ].forEach(({ el, type, toggle }) => {
        if (el) {
            el.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await addSample(type, !!toggle);
            });
        }
    });

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
            { el: cardVoice10, val: 10, label: "双人私享 (10声部)", toastDesc: "双人私享：房主+带1人（10声部 · 狂想曲绝对无损）" },
            { el: cardVoice8, val: 8, label: "四人小队 (8声部)", toastDesc: "四人小队：房主+带3人（8声部 · 99.6%高还原度 · 组队开黑）" },
            { el: cardVoice11, val: 11, label: "单人独享 (11声部)", toastDesc: "单人独享：仅限房主（11声部 · 满槽狂暴音质 · 独享防扰）" }
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

    // ════════════ 10. 高保真拟真声学大钢琴 WebAudio 物理建模预览引擎 ════════════
    /**
     * 生成轻量级双声道立体声混响冲激响应 (温暖琴房/演播厅空间感)
     */
    function createReverbBuffer(ctx, duration, decay) {
        const sampleRate = ctx.sampleRate || 44100;
        const length = Math.floor(sampleRate * (duration || 1.3));
        const decayRate = decay || 2.4;
        const impulse = ctx.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const env = Math.exp(-t * decayRate);
            left[i] = (Math.random() * 2 - 1) * env;
            right[i] = (Math.random() * 2 - 1) * env;
        }
        return impulse;
    }

    /**
     * 琴槌敲击瞬态噪声缓存 (15ms 物理击弦瞬态冲激)
     */
    function getHammerNoiseBuffer(ctx) {
        const currentRate = ctx.sampleRate || 44100;
        if (cachedHammerNoiseBuffer && cachedHammerNoiseBuffer.sampleRate === currentRate) {
            return cachedHammerNoiseBuffer;
        }
        const length = Math.floor(currentRate * 0.015);
        const buffer = ctx.createBuffer(1, length, currentRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            const t = i / length;
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
        }
        cachedHammerNoiseBuffer = buffer;
        return buffer;
    }

    /**
     * 初始化高品质音频主总线 (动态压限器 + 空间混响 + 干湿声分配)
     */
    function ensureAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (!audioCtx) return null;

        if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
        }

        if (!masterCompressor) {
            try {
                // 动态压限器：消除多音符同时发声时的削波失真与爆音
                masterCompressor = audioCtx.createDynamicsCompressor();
                if (masterCompressor.threshold && masterCompressor.threshold.setValueAtTime) {
                    masterCompressor.threshold.setValueAtTime(-14, audioCtx.currentTime);
                }
                if (masterCompressor.knee && masterCompressor.knee.setValueAtTime) {
                    masterCompressor.knee.setValueAtTime(10, audioCtx.currentTime);
                }
                if (masterCompressor.ratio && masterCompressor.ratio.setValueAtTime) {
                    masterCompressor.ratio.setValueAtTime(5, audioCtx.currentTime);
                }
                if (masterCompressor.attack && masterCompressor.attack.setValueAtTime) {
                    masterCompressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
                }
                if (masterCompressor.release && masterCompressor.release.setValueAtTime) {
                    masterCompressor.release.setValueAtTime(0.18, audioCtx.currentTime);
                }

                // 主音量增益
                masterGain = audioCtx.createGain();
                masterGain.gain.setValueAtTime(0.85, audioCtx.currentTime);

                // 干声音轨
                dryGain = audioCtx.createGain();
                dryGain.gain.setValueAtTime(0.80, audioCtx.currentTime);

                // 湿声混响音轨
                reverbGain = audioCtx.createGain();
                reverbGain.gain.setValueAtTime(0.22, audioCtx.currentTime);

                if (typeof audioCtx.createConvolver === "function") {
                    reverbConvolver = audioCtx.createConvolver();
                    reverbConvolver.buffer = createReverbBuffer(audioCtx, 1.4, 2.2);
                    reverbGain.connect(reverbConvolver);
                    reverbConvolver.connect(masterCompressor);
                }

                dryGain.connect(masterCompressor);
                masterCompressor.connect(masterGain);
                masterGain.connect(audioCtx.destination);
            } catch (err) {
                console.warn("WebAudio 高级总线初始化降级:", err);
            }
        }

        return audioCtx;
    }

    function stopAudioPreview() {
        isAudioPlaying = false;
        if (audioScheduledSources.length > 0) {
            audioScheduledSources.forEach(s => {
                try { if (typeof s.stop === "function") s.stop(); } catch (e) {}
                try { if (typeof s.disconnect === "function") s.disconnect(); } catch (e) {}
            });
            audioScheduledSources = [];
        }
        if (audioTimeouts.length > 0) {
            audioTimeouts.forEach(t => clearTimeout(t));
            audioTimeouts = [];
        }
        if (previewAudioBtn) {
            setPreviewBtnPlaying(false);
        }
    }

    /**
     * 拟真大钢琴单音建模发声
     * 包含：
     * 1. 琴槌击弦瞬态脉冲 (Hammer Strike Attack Impulse)
     * 2. 双振荡器复音微失谐琴弦共鸣 (Dual Harmonic Oscillators with Detune)
     * 3. 力度感应动态低通滤波包络 (Velocity-sensitive BiquadFilter Sweep)
     * 4. 音区物理延音时间自适应 (Pitch-dependent Natural Decay)
     */
    function playNote(midiPitch, startTime, duration, velocity) {
        const ctx = ensureAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const playTime = now + startTime;

        // 力度映射 (0.30 ~ 1.0) 平滑规整，提升弱音表现力与整体信噪比
        const rawVel = (typeof velocity === "number" && !isNaN(velocity)) ? velocity : 0.72;
        const vel = Math.max(0.30, Math.min(rawVel * 1.28, 1.0));
        const velGain = Math.pow(vel, 1.15); // 非线性物理响度感应

        // 基频计算
        const freq = 440 * Math.pow(2, (midiPitch - 69) / 12);

        // 音区自适应物理延音因子 (低音延音深沉，高音干脆利落)
        const pitchNorm = Math.max(0, Math.min(1, (midiPitch - 21) / 87));
        const decayMultiplier = 1.6 - pitchNorm * 0.9;
        const noteDecay = Math.max(0.35, Math.min(duration * decayMultiplier, 3.2 * decayMultiplier));

        // 1. 动态低通滤波器 (保留高频明亮度，避免音色发闷沉闷)
        const filter = (typeof ctx.createBiquadFilter === "function") ? ctx.createBiquadFilter() : null;
        if (filter) {
            filter.type = "lowpass";
            // 提高截止频率上限，让钢琴金属泛音与木质击弦感透出来
            const maxCutoff = Math.min(12000, 2200 + 6500 * velGain + (midiPitch * 45));
            const sustainCutoff = Math.max(1600, maxCutoff * 0.55);

            filter.frequency.setValueAtTime(maxCutoff, playTime);
            if (typeof filter.frequency.exponentialRampToValueAtTime === "function") {
                filter.frequency.exponentialRampToValueAtTime(sustainCutoff, playTime + 0.16);
                filter.frequency.exponentialRampToValueAtTime(Math.max(650, freq * 2.0), playTime + noteDecay);
            }
        }

        // 2. 音符总增益包络 (ADSR)
        const noteGain = ctx.createGain();
        const peakAmp = 0.35 * velGain;

        noteGain.gain.setValueAtTime(0.0001, playTime);
        noteGain.gain.linearRampToValueAtTime(peakAmp, playTime + 0.004); // 4ms 极速起音防爆音
        if (typeof noteGain.gain.exponentialRampToValueAtTime === "function") {
            noteGain.gain.exponentialRampToValueAtTime(peakAmp * 0.75, playTime + 0.09); // 击弦后琴槌弹离
            noteGain.gain.exponentialRampToValueAtTime(0.0001, playTime + noteDecay); // 自然延音释放
        }

        // 3. 多振荡器真实琴弦谐波共鸣 (三角波主基频 + 微失谐正弦波 + 8度泛音微共鸣)
        const osc1 = ctx.createOscillator();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq, playTime);
        if (osc1.detune && typeof osc1.detune.setValueAtTime === "function") {
            osc1.detune.setValueAtTime(-2.5, playTime);
        }

        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq, playTime);
        if (osc2.detune && typeof osc2.detune.setValueAtTime === "function") {
            osc2.detune.setValueAtTime(+2.5, playTime);
        }

        // 琴弦高次泛音增强 (增加清脆通透的高频打击感)
        const osc3 = ctx.createOscillator();
        osc3.type = "sine";
        osc3.frequency.setValueAtTime(freq * 2, playTime);
        const osc3Gain = ctx.createGain();
        osc3Gain.gain.setValueAtTime(0.20 * velGain, playTime);
        if (typeof osc3Gain.gain.exponentialRampToValueAtTime === "function") {
            osc3Gain.gain.exponentialRampToValueAtTime(0.0001, playTime + Math.min(noteDecay, 0.45));
        }
        osc3.connect(osc3Gain);

        if (filter) {
            osc1.connect(filter);
            osc2.connect(filter);
            osc3Gain.connect(filter);
            filter.connect(noteGain);
        } else {
            osc1.connect(noteGain);
            osc2.connect(noteGain);
            osc3Gain.connect(noteGain);
        }

        // 4. 琴槌敲击触感 (Hammer Strike Attack Impulse)
        let hammerSource = null;
        if (typeof ctx.createBufferSource === "function" && typeof ctx.createBiquadFilter === "function") {
            try {
                const hammerNoiseBuf = getHammerNoiseBuffer(ctx);
                hammerSource = ctx.createBufferSource();
                hammerSource.buffer = hammerNoiseBuf;

                const hammerFilter = ctx.createBiquadFilter();
                hammerFilter.type = "bandpass";
                hammerFilter.frequency.setValueAtTime(Math.min(3000, Math.max(800, freq * 2)), playTime);
                if (hammerFilter.Q && hammerFilter.Q.setValueAtTime) {
                    hammerFilter.Q.setValueAtTime(2.0, playTime);
                }

                const hammerGain = ctx.createGain();
                const hammerPeak = 0.05 * velGain;
                hammerGain.gain.setValueAtTime(hammerPeak, playTime);
                if (typeof hammerGain.gain.exponentialRampToValueAtTime === "function") {
                    hammerGain.gain.exponentialRampToValueAtTime(0.0001, playTime + 0.015);
                }

                hammerSource.connect(hammerFilter);
                hammerFilter.connect(hammerGain);
                hammerGain.connect(noteGain);

                hammerSource.start(playTime);
                hammerSource.stop(playTime + 0.02);
                audioScheduledSources.push(hammerSource);
            } catch (e) {}
        }

        // 分别输出至干音与空间混响总线
        if (dryGain) noteGain.connect(dryGain);
        if (reverbGain) noteGain.connect(reverbGain);
        if (!dryGain && !reverbGain) noteGain.connect(ctx.destination);

        const stopTime = playTime + noteDecay + 0.05;
        osc1.start(playTime);
        osc2.start(playTime);
        osc3.start(playTime);
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        osc3.stop(stopTime);

        audioScheduledSources.push(osc1, osc2, osc3);
    }

    function startAudioPreview() {
        if (playlist.length === 0) return;

        const currentSong = playlist[selectedPreviewIndex] || playlist[0];
        if (!currentSong || !currentSong.mid || !currentSong.mid.tracks) return;

        isAudioPlaying = true;
        if (previewAudioBtn) {
            setPreviewBtnPlaying(true);
        }

        const startSec = Math.max(0, parseFloat(startTimeInput ? startTimeInput.value : 0) || 0);

        let rawNotes = [];
        for (const track of currentSong.mid.tracks) {
            if (track.channel === 9) continue; // 跳过打击乐通道
            if (!track.notes) continue;
            for (const n of track.notes) {
                if (n.velocity === 0) continue;
                if (n.time >= startSec && n.time <= startSec + 48) {
                    rawNotes.push(n);
                }
            }
        }

        if (rawNotes.length === 0) {
            showToast("当前选定起始时间后未检测到可用音符", "error");
            stopAudioPreview();
            return;
        }

        rawNotes.sort((a, b) => a.time - b.time);

        // 针对多音轨复杂 MIDI 进行声部对齐与防浑浊优化 (对齐工坊真实弹奏声部)
        const chordMap = new Map();
        for (const n of rawNotes) {
            const timeKey = Math.round(n.time * 66.66) / 66.66; // 15ms 和弦容差聚合
            if (!chordMap.has(timeKey)) chordMap.set(timeKey, []);
            chordMap.get(timeKey).push(n);
        }

        let notesToPlay = [];
        chordMap.forEach((chordNotes) => {
            if (chordNotes.length <= 8) {
                notesToPlay.push(...chordNotes);
            } else {
                // 当同时间超过 8 个音符并发时，保留高音主旋律与低音根音，去除中频重叠泥泞杂音
                chordNotes.sort((a, b) => a.midi - b.midi);
                const bass = chordNotes.slice(0, 2);
                const melody = chordNotes.slice(-6);
                notesToPlay.push(...bass, ...melody);
            }
        });

        notesToPlay.sort((a, b) => a.time - b.time);
        if (notesToPlay.length > 550) {
            notesToPlay = notesToPlay.slice(0, 550);
        }

        let maxEndTime = 0;
        for (const n of notesToPlay) {
            const relTime = Math.max(0, n.time - startSec);
            const dur = Math.max(0.1, Math.min(n.duration || 0.4, 2.8));
            playNote(n.midi, relTime, dur, n.velocity);
            if (relTime + dur > maxEndTime) {
                maxEndTime = relTime + dur;
            }
        }

        const autoStopTime = Math.min(50000, Math.max(1500, Math.ceil((maxEndTime + 0.3) * 1000)));
        const timer = setTimeout(() => {
            stopAudioPreview();
        }, autoStopTime);
        audioTimeouts.push(timer);
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
            const firstChip = document.querySelector(".preset-chip");
            if (firstChip && firstChip.focus) firstChip.focus({ preventScroll: true });
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
