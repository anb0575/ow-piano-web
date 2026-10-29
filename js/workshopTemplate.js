/**
 * 守望先锋钢琴工坊 - 完整地图模式模板 (Rebuilt by ANB)
 * 
 * 专为中国玩家精简与优化：
 * 1. 左侧 HUD：歌曲信息栏 (NOW PLAYING、曲目名、音轨编号 [1/N])
 * 2. 右侧 HUD：快捷键指引与速度显示，避免遮挡顶部准星与比赛时间
 * 3. 连续播放：曲目播完自动播放下一首（列表循环），Ctrl+E / Ctrl+Shift 无缝切歌
 * 4. 默认内置机器人隐形 (幽灵演奏) 与开局模式选择
 * 5. 语言环境：与官方英文工坊规则完全兼容
 */

(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.OWWorkshopTemplate = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // 巴黎 65 个琴键的三维世界坐标 (0-64 对应 C1-E6)
    const PIANO_POSITIONS = {
        pointA: `rule("Note positions array init, Point A (Paris - Cabaret Luna)")
{
    event
    {
        Ongoing - Global;
    }

    actions
    {
        Global.notePositions = Array(
            Vector(-41.168, 12.876, 34.061), Vector(-41.223, 12.885, 34.038), 
            Vector(-41.168, 12.877, 34.017), Vector(-41.223, 12.885, 33.997), 
            Vector(-41.164, 12.876, 33.982), Vector(-41.161, 12.876, 33.937), 
            Vector(-41.226, 12.886, 33.913), Vector(-41.162, 12.876, 33.898), 
            Vector(-41.217, 12.885, 33.877), Vector(-41.163, 12.877, 33.859), 
            Vector(-41.222, 12.886, 33.834), Vector(-41.153, 12.874, 33.816), 
            Vector(-41.148, 12.875, 33.774), Vector(-41.217, 12.886, 33.753), 
            Vector(-41.153, 12.876, 33.731), Vector(-41.210, 12.885, 33.715), 
            Vector(-41.157, 12.877, 33.696), Vector(-41.143, 12.875, 33.655), 
            Vector(-41.212, 12.886, 33.626), Vector(-41.153, 12.877, 33.610), 
            Vector(-41.205, 12.885, 33.595), Vector(-41.151, 12.877, 33.577), 
            Vector(-41.208, 12.886, 33.551), Vector(-41.154, 12.878, 33.539), 
            Vector(-41.132, 12.874, 33.492), Vector(-41.215, 12.887, 33.465), 
            Vector(-41.151, 12.878, 33.444), Vector(-41.203, 12.886, 33.430), 
            Vector(-41.149, 12.876, 33.415), Vector(-41.146, 12.877, 33.371), 
            Vector(-41.203, 12.886, 33.348), Vector(-41.130, 12.875, 33.326), 
            Vector(-41.202, 12.886, 33.309), Vector(-41.129, 12.875, 33.290), 
            Vector(-41.201, 12.885, 33.271), Vector(-41.143, 12.878, 33.250), 
            Vector(-41.122, 12.875, 33.210), Vector(-41.185, 12.883, 33.184), 
            Vector(-41.139, 12.876, 33.163), Vector(-41.192, 12.886, 33.152), 
            Vector(-41.136, 12.878, 33.126), Vector(-41.132, 12.877, 33.086), 
            Vector(-41.186, 12.884, 33.061), Vector(-41.118, 12.875, 33.046), 
            Vector(-41.190, 12.887, 33.027), Vector(-41.112, 12.873, 33.010), 
            Vector(-41.184, 12.886, 32.986), Vector(-41.126, 12.877, 32.961), 
            Vector(-41.116, 12.876, 32.921), Vector(-41.185, 12.885, 32.902), 
            Vector(-41.116, 12.876, 32.886), Vector(-41.192, 12.888, 32.865), 
            Vector(-41.129, 12.878, 32.844), Vector(-41.120, 12.877, 32.802), 
            Vector(-41.180, 12.887, 32.778), Vector(-41.124, 12.878, 32.765), 
            Vector(-41.187, 12.888, 32.745), Vector(-41.108, 12.876, 32.729), 
            Vector(-41.181, 12.887, 32.704), Vector(-41.107, 12.876, 32.686), 
            Vector(-41.112, 12.877, 32.643), Vector(-41.172, 12.886, 32.620), 
            Vector(-41.108, 12.877, 32.604), Vector(-41.167, 12.887, 32.581), 
            Vector(-41.104, 12.876, 32.562));
        Set Global Variable(botSpawn, Vector(-41.016, 13.158, 33.314));
        Set Global Variable(playerSpawn, Vector(-34.5, 12, 32.3));
        Set Global Variable(banTpLocation, Vector(-10.008, 15.802, -40.435));
        Set Global Variable(defaultHorizontalFacingAngle, -92.554);
    }
}
`,
        pointB: `rule("Note positions array init, Point B (Paris - Maison Marat)")
{
    event
    {
        Ongoing - Global;
    }

    actions
    {
        Global.notePositions = Array(
            Vector(-85.410, 13.884, -108.012), Vector(-85.364, 13.896, -108.079), 
            Vector(-85.368, 13.886, -108.007), Vector(-85.328, 13.897, -108.078), 
            Vector(-85.325, 13.888, -108.008), Vector(-85.290, 13.887, -107.989), 
            Vector(-85.247, 13.897, -108.050), Vector(-85.256, 13.885, -107.965), 
            Vector(-85.217, 13.895, -108.021), Vector(-85.210, 13.888, -107.968), 
            Vector(-85.180, 13.895, -108.007), Vector(-85.184, 13.883, -107.928), 
            Vector(-85.147, 13.883, -107.916), Vector(-85.095, 13.895, -107.977), 
            Vector(-85.107, 13.883, -107.910), Vector(-85.063, 13.896, -107.973), 
            Vector(-85.066, 13.884, -107.902), Vector(-85.017, 13.886, -107.891), 
            Vector(-84.979, 13.896, -107.954), Vector(-84.987, 13.884, -107.866), 
            Vector(-84.943, 13.896, -107.938), Vector(-84.952, 13.884, -107.854), 
            Vector(-84.908, 13.896, -107.922), Vector(-84.902, 13.886, -107.851), 
            Vector(-84.871, 13.885, -107.836), Vector(-84.826, 13.895, -107.887), 
            Vector(-84.832, 13.885, -107.822), Vector(-84.787, 13.897, -107.894), 
            Vector(-84.795, 13.886, -107.812), Vector(-84.751, 13.888, -107.815), 
            Vector(-84.711, 13.895, -107.857), Vector(-84.720, 13.883, -107.769), 
            Vector(-84.681, 13.895, -107.835), Vector(-84.683, 13.882, -107.759), 
            Vector(-84.643, 13.895, -107.822), Vector(-84.637, 13.887, -107.770), 
            Vector(-84.604, 13.885, -107.745), Vector(-84.563, 13.894, -107.793), 
            Vector(-84.561, 13.888, -107.750), Vector(-84.523, 13.896, -107.791), 
            Vector(-84.524, 13.887, -107.729), Vector(-84.485, 13.884, -107.697), 
            Vector(-84.444, 13.895, -107.759), Vector(-84.445, 13.888, -107.711), 
            Vector(-84.415, 13.894, -107.750), Vector(-84.403, 13.888, -107.694), 
            Vector(-84.373, 13.896, -107.742), Vector(-84.375, 13.885, -107.661), 
            Vector(-84.339, 13.885, -107.649), Vector(-84.292, 13.896, -107.713), 
            Vector(-84.298, 13.886, -107.644), Vector(-84.256, 13.897, -107.715), 
            Vector(-84.262, 13.883, -107.613), Vector(-84.227, 13.883, -107.603), 
            Vector(-84.172, 13.897, -107.684), Vector(-84.183, 13.886, -107.606), 
            Vector(-84.146, 13.895, -107.657), Vector(-84.144, 13.886, -107.592), 
            Vector(-84.103, 13.896, -107.652), Vector(-84.104, 13.885, -107.571), 
            Vector(-84.068, 13.885, -107.560), Vector(-84.021, 13.896, -107.626), 
            Vector(-84.023, 13.886, -107.553), Vector(-83.985, 13.895, -107.598), 
            Vector(-83.987, 13.886, -107.539));
        Set Global Variable(botSpawn, Vector(-84.693, 13.873, -107.681));
        Set Global Variable(playerSpawn, Vector(-85.624, 14.349, -104.397));
        Set Global Variable(banTpLocation, Vector(-83.340, 13.248, -58.608));
        Set Global Variable(defaultHorizontalFacingAngle, 161.2);
    }
}
`
    };

    /**
     * 生成完整的守望先锋地图工坊代码
     *
     * @param {string} songRules - 由 owmidiparser 生成的乐谱数据规则
     * @param {object} options - {
     *     piano: 'pointA'|'pointB',
     *     maxVoices: 8|10|11,          // 演奏机器人数量上限（= 声部数）
     *     invisibleBots: boolean,
     *     hostOnly: boolean,
     *     songTitles: string[]
     * }
     * @returns {string} 完整的工坊代码文本
     */
    function generateFullSettings(songRules, options = {}) {
        const piano = options.piano || 'pointB';
        const maxVoices = options.maxVoices || 10;
        const invisibleBots = options.invisibleBots !== false; // 默认隐形
        const hostOnly = options.hostOnly !== false; // 默认仅房主可操控钢琴
        // 一局最多 12 名玩家（真人 + 演奏机器人）。大厅的队伍人数上限只限制真人加入，不限制机器人，
        // 因此按房间模式写入真人上限：单人 1 / 双人 2 / 四人 4，其余槽位留给机器人；多出的好友可以观战。
        const TEAM_SLOTS = 12;
        const humanQuota = Math.min(TEAM_SLOTS - 1, Math.max(1, TEAM_SLOTS - maxVoices));

        let songTitles = options.songTitles;
        if (!songTitles || !Array.isArray(songTitles) || songTitles.length === 0) {
            if (typeof songRules === 'string') {
                const match = songRules.match(/Global\.songTitles\s*=\s*Array\((.*?)\);/s);
                if (match) {
                    const rawTitles = match[1].match(/Custom String\("(.*?)"\)/g);
                    if (rawTitles) {
                        songTitles = rawTitles.map(s => s.replace(/^Custom String\("(.*)"\)$/, '$1'));
                    }
                }
            }
        }
        songTitles = (songTitles && songTitles.length > 0) ? songTitles : ["Track 1"];
        // 清洗曲名：去除格式占位符 {0}、控制字符、{ } " \ 并压缩空白
        songTitles = songTitles.map(t =>
            String(t || '')
                .replace(/\{[0-9]+\}/g, '')
                .replace(/[\x00-\x1f\x7f{}"\\]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 40)
        );
        const shortTitles = songTitles.map(t => t.length > 16 ? t.slice(0, 15) + '…' : t);
        const songCount = songTitles.length;

        const btnCond = (btn) => hostOnly
            ? `Is Button Held(Host Player, Button(${btn})) == True;`
            : `Is True For Any(All Players(All Teams), !Is Dummy Bot(Current Array Element) && Is Button Held(Current Array Element, Button(${btn}))) == True;`;

        const comboCond = (btn1, btn2) => hostOnly
            ? `Is Button Held(Host Player, Button(${btn1})) == True;\n        Is Button Held(Host Player, Button(${btn2})) == True;`
            : `Is True For Any(All Players(All Teams), !Is Dummy Bot(Current Array Element) && Is Button Held(Current Array Element, Button(${btn1})) && Is Button Held(Current Array Element, Button(${btn2}))) == True;`;

        const msgTarget = hostOnly ? 'Host Player' : 'All Players(All Teams)';
        const controllers = hostOnly ? 'Host Player' : 'All Players(All Teams)';
        const rulePrefix = hostOnly ? 'Host: ' : 'Anyone: ';

        const pianoScript = PIANO_POSITIONS[piano] || PIANO_POSITIONS.pointB;

        // ── HUD 配色与表达式 ──
        // 配色：近白（主要信息）/ 橙（强调：曲名、当前行、速度）/ 冷灰（次要）/ 暗灰（说明）/ 琥珀（提示）
        // 动态变色一律用“同一位置放两个版本、按条件显示其中一个”实现，只依赖已验证的 Visible To and String，
        // 不使用颜色重新求值。
        const CUR = 'Global.currentSongIndex';
        const PRIMARY = 'Custom Color(238, 241, 246, 255)';
        const ACCENT = 'Custom Color(255, 156, 74, 255)';
        const SOFT = 'Custom Color(178, 186, 200, 255)';
        const DIM = 'Custom Color(122, 130, 144, 255)';
        const WARN = 'Custom Color(255, 205, 100, 255)';
        const ALL = 'All Players(All Teams)';
        const when = (cond) => `(${cond}) ? ${ALL} : Empty Array`;
        const loadPct = 'Round To Integer((Global.decompressionPercentages[0] + Global.decompressionPercentages[1] + Global.decompressionPercentages[2]) / 3, Down)';
        const isLoading = '(Global.isCompressionEnabled && !Global.hasDecompressionFinished)';
        const dur = `Global.songDurations[${CUR}]`;
        const fmtTime = (x) => `(Round To Integer(${x}, Down) % 60 < 10 ? Custom String("{0}:0{1}", Round To Integer(${x} / 60, Down), Round To Integer(${x}, Down) % 60) : Custom String("{0}:{1}", Round To Integer(${x} / 60, Down), Round To Integer(${x}, Down) % 60))`;
        // 10 格进度条：■ 已播放 / □ 未播放
        const bars = Array.from({ length: 11 }, (_, i) => `Custom String("${'■'.repeat(i)}${'□'.repeat(10 - i)}")`).join(', ');
        const barIndex = `Min(10, Round To Integer(10 * Global.songElapsed / Max(1, ${dur}), Down))`;

        // 状态（三种互斥的显示条件）
        const stPlaying = 'Global.songPlayingState == 2';
        const stLoading = `(Global.songPlayingState == 1 || (Global.songPlayingState == 0 && ${isLoading}))`;
        const stStopped = `(Global.songPlayingState == 0 && !${isLoading})`;
        const textPlaying = `Custom String("▶ 正在演奏  ·  第 {0}/{1} 首", ${CUR} + 1, Count Of(Global.songTitles))`;
        const textLoading = `(Global.songPlayingState == 1 ? Custom String("准备中...") : Custom String("乐谱加载中 {0}%", ${loadPct}))`;
        const textStopped = `Custom String("■ 已停止  ·  第 {0}/{1} 首", ${CUR} + 1, Count Of(Global.songTitles))`;
        const textProgress = `Custom String("{0}   {1} / {2}", Array(${bars})[${barIndex}], ${fmtTime('Global.songElapsed')}, ${fmtTime(dur)})`;

        // 歌单：当前行（橙色 + ▶）与普通行（冷灰）各一个版本，按当前曲目互斥显示
        const LIST_SORT = 4;
        const playlistHuds = shortTitles.map((t, i) =>
            `        Create HUD Text(${when(`${CUR} == ${i}`)}, Null, Custom String("▶ ${i + 1}. ${t}"), Null, Left, ${LIST_SORT + i}, Color(White), ${ACCENT}, Color(White), Visible To and String, Default Visibility);\n` +
            `        Create HUD Text(${when(`${CUR} != ${i}`)}, Null, Custom String("${i + 1}. ${t}"), Null, Left, ${LIST_SORT + i}, Color(White), ${SOFT}, Color(White), Visible To and String, Default Visibility);`
        ).join('\n');
        const AFTER_LIST = LIST_SORT + shortTitles.length;

        // 声部与房间：真人超出或机器人不足时变为琥珀色
        const humanCount = 'Count Of(Filtered Array(All Players(All Teams), !Is Dummy Bot(Current Array Element)))';
        const voiceLine = `Custom String("声部 {0}  ·  机器人 {1}  ·  {2}", Global.maxBots, Global.songPlayingState == 2 ? Custom String("{0}/{1}", Count Of(Global.bots), Global.maxBots) : Custom String("待命"), Custom String("真人 {0}/{1}", ${humanCount}, ${humanQuota}))`;
        const voiceWarn = `${humanCount} > ${humanQuota} || (Global.songPlayingState == 2 && Count Of(Global.bots) < Global.maxBots)`;

        const controlsText = songCount > 1
            ? `F  开始 / 停止\\nCtrl+E  下一首    Ctrl+Shift  上一首\\nCtrl+R  从头播放\\nCtrl+左键 / 右键  加速 / 减速\\nCtrl+V  机器人显隐`
            : `F  开始 / 停止\\nCtrl+R  从头播放\\nCtrl+左键 / 右键  加速 / 减速\\nCtrl+V  机器人显隐`;
        const playModeText = songCount > 1 ? '播完自动连播 · 列表循环' : '单曲循环';
        const pianoHint = hostOnly ? '房主按 F 开始演奏' : '按 F 开始演奏';

        const switchSongRule = (name, comboA, comboB, direction, extraCond) => `rule("${rulePrefix}${name}")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${comboCond(comboA, comboB)}
        ${extraCond}
    }

    actions
    {
        If(Global.songPlayingState == 2);
            "演奏中：通知播放循环无缝切换，机器人保持在场"
            Global.skipDirection = ${direction};
            Global.skipRequested = True;
        Else If(Global.songPlayingState == 0);
            "已停止：切换曲目后自动开始演奏"
            Global.currentSongIndex = (Global.currentSongIndex + ${direction} + Count Of(Global.songTitles)) % Count Of(Global.songTitles);
            Global.timeArrayIndex = Global.songTimeStarts[Global.currentSongIndex];
            Global.pitchArrayIndex = Global.songPitchStarts[Global.currentSongIndex];
            Global.songElapsed = 0;
            Global.subIndex = Global.subStarts[Global.currentSongIndex];
            If(!Global.isCompressionEnabled || Global.hasDecompressionFinished);
                Call Subroutine(startPlayback);
            Else;
                Small Message(${msgTarget}, Custom String("已选中：{0}（乐谱加载完成后按 F 开始）", Global.songTitles[Global.currentSongIndex]));
            End;
        End;
        Wait(0.400, Ignore Condition);
    }
}

`;

        const header = `settings
{
    main
    {
        Description: "Overwatch Piano Workshop | Rebuilt by ANB"
    }

    lobby
    {
        Allow Players Who Are In Queue: Yes
        Match Voice Chat: Enabled
        Max Spectators: 12
        Max Team 1 Players: ${humanQuota}
        Max Team 2 Players: 0
        Return To Lobby: Never
    }

    modes
    {
        Skirmish
        {
            enabled maps
            {
                Paris
            }
        }

        General
        {
            Game Mode Start: Manual
            Hero Limit: Off
            Respawn Time Scalar: 30%
        }
    }

    heroes
    {
        General
        {
            Ability Cooldown Time: 0%
            No Ammunition Requirement: On
            Ultimate Generation: 250%
        }
    }
}

variables
{
    global:
        0: notePositions
        1: botSpawn
        2: bots
        3: speedPercent
        4: songPlayingState
        5: timeArrayIndex
        6: playerSpawn
        7: i
        8: pitchArrayIndex
        9: botScalar
        10: maxArraySize
        11: banTpLocation
        12: currentBotIndex
        13: waitTime
        14: timeArrays
        15: pitchArrays
        16: chordArrays
        17: maxBots
        18: defaultHorizontalFacingAngle
        19: areBotsInvisible
        20: currentSongIndex
        21: songTitles
        22: songTimeStarts
        23: songTimeEnds
        24: songPitchStarts
        25: skipRequested
        26: skipDirection
        27: songElapsed
        28: hasDecompressionFinished
        29: decompressionPercentages
        30: isCompressionEnabled
        31: numberArray
        32: decompressedValue
        33: compressedArrayLength
        34: decompressedArray
        35: compressedElementLength
        36: songDataElementLength
        37: compressedArray
        38: compressionInfo
        39: finalCompressedElementLength
        40: I
        41: J
        42: L
        43: songDurations
        44: subTimes
        45: subTexts
        46: subStarts
        47: subEnds
        48: subIndex
        49: nextElapsed

    player:
        1: playNote
        2: currentPitchIndex
        4: currentKeyPos
}

subroutines
{
    0: endSong
    1: decompressArray
    2: startPlayback
    3: showSubtitles
}

rule("Overwatch Piano Workshop - Rebuilt by ANB")
{
    event
    {
        Ongoing - Global;
    }
}

rule("Global init")
{
    event
    {
        Ongoing - Global;
    }

    actions
    {
        Disable Inspector Recording;
        Disable Built-In Game Mode Music;
        Global.bots = Empty Array;
        Global.maxBots = ${maxVoices};
        Global.speedPercent = 100;
        Global.areBotsInvisible = ${invisibleBots ? 'True' : 'False'};
        Global.currentSongIndex = 0;
        Global.songElapsed = 0;
        Global.skipRequested = False;
        Global.skipDirection = 1;
        Global.hasDecompressionFinished = False;
        Global.decompressionPercentages = Array(0, 0, 0);

        "左上：正在播放（曲名大字 / 状态 / 进度条与时间）——三行各自独立，排版整齐"
        Create HUD Text(${ALL}, Custom String("{0}", Global.songTitles[${CUR}]), Null, Null, Left, 0, ${ACCENT}, Color(White), Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${when(stPlaying)}, Null, ${textPlaying}, Null, Left, 1, Color(White), ${PRIMARY}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${when(stLoading)}, Null, ${textLoading}, Null, Left, 1, Color(White), ${WARN}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${when(stStopped)}, Null, ${textStopped}, Null, Left, 1, Color(White), ${DIM}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${ALL}, Null, ${textProgress}, Null, Left, 2, Color(White), ${PRIMARY}, Color(White), Visible To and String, Default Visibility);

        "左侧：播放列表（当前曲目橙色 + ▶ 高亮）"
        Create HUD Text(${ALL}, Null, Custom String("播放列表  ·  ${playModeText}"), Null, Left, 3, Color(White), ${DIM}, Color(White), Visible To and String, Default Visibility);
${playlistHuds}

        "左侧：声部与房间状态（游戏内可核对真实生效的声部数；异常时变琥珀色）"
        Create HUD Text(${when(`!(${voiceWarn})`)}, Null, ${voiceLine}, Null, Left, ${AFTER_LIST}, Color(White), ${DIM}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${when(voiceWarn)}, Null, ${voiceLine}, Null, Left, ${AFTER_LIST}, Color(White), ${WARN}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${ALL}, Null, Custom String("钢琴工坊 · Rebuilt by ANB"), Null, Left, ${AFTER_LIST + 1}, Color(White), ${DIM}, Color(White), Visible To and String, Default Visibility);

        "右侧：速度与操作说明（仅对有操控权限的玩家显示）"
        Create HUD Text(${controllers}, Null, Custom String("速度 {0}%  ·  ${hostOnly ? '仅房主可操控' : '全员可操控'}", Global.speedPercent), Null, Right, 0, Color(White), ${ACCENT}, Color(White), Visible To and String, Default Visibility);
        Create HUD Text(${controllers}, Null, Custom String("${controlsText}"), Null, Right, 1, Color(White), ${SOFT}, Color(White), Visible To and String, Default Visibility);
${hostOnly ? `        Create HUD Text(Remove From Array(All Players(All Teams), Host Player), Null, Custom String("由房主操控演奏  ·  速度 {0}%", Global.speedPercent), Null, Right, 0, Color(White), ${SOFT}, Color(White), Visible To and String, Default Visibility);\n` : ''}
        "钢琴上方：浮空提示"
        Create In-World Text(All Players(All Teams), Global.songPlayingState == 2 ? Custom String("▶ {0}", Global.songTitles[${CUR}]) : (${isLoading} ? Custom String("乐谱加载中 {0}%", ${loadPct}) : Custom String("${pianoHint}")), Global.botSpawn + Vector(0, 1.6, 0), 1.4, Do Not Clip, Visible To Position and String, ${ACCENT}, Default Visibility);
    }
}

rule("Player init")
{
    event
    {
        Ongoing - Each Player;
        All;
        All;
    }

    conditions
    {
        Is Dummy Bot(Event Player) != True;
        Has Spawned(Event Player) == True;
        Is Alive(Event Player) == True;
    }

    actions
    {
        Teleport(Event Player, Global.playerSpawn);
        Disable Movement Collision With Players(Event Player);
        Wait(0.016, Ignore Condition);
        Set Facing(Event Player, Direction From Angles(Global.defaultHorizontalFacingAngle, Vertical Facing Angle Of(Event Player)), To World);
        Preload Hero(Event Player, Hero(Symmetra));
    }
}

rule("Dummy init")
{
    event
    {
        Ongoing - Each Player;
        All;
        All;
    }

    conditions
    {
        Is Dummy Bot(Event Player) == True;
    }

    actions
    {
        Teleport(Event Player, Global.botSpawn);
        Disable Movement Collision With Environment(Event Player, False);
        Disable Movement Collision With Players(Event Player);
        Start Scaling Player(Event Player, 0.100, True);
        ${invisibleBots ? '"开局全员隐形 (幽灵演奏模式)"\n        Set Invisible(Event Player, All);' : '"开局机器人显形模式"'}
        Wait(0.016, Ignore Condition);
        Set Facing(Event Player, Direction From Angles(Global.defaultHorizontalFacingAngle, 89), To World);
    }
}

${songCount > 1 ? switchSongRule('Next song (Crouch + Ability 2 / E)', 'Crouch', 'Ability 2', 1, 'Count Of(Global.songTitles) > 1;') : ''}${songCount > 1 ? switchSongRule('Previous song (Crouch + Ability 1 / Shift)', 'Crouch', 'Ability 1', -1, 'Count Of(Global.songTitles) > 1;') : ''}rule("${rulePrefix}Restart current song (Crouch + Reload)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${comboCond('Crouch', 'Reload')}
    }

    actions
    {
        If(Global.songPlayingState == 2);
            Global.skipDirection = 0;
            Global.skipRequested = True;
        Else;
            Global.timeArrayIndex = Global.songTimeStarts[Global.currentSongIndex];
            Global.pitchArrayIndex = Global.songPitchStarts[Global.currentSongIndex];
            Global.songElapsed = 0;
            Global.subIndex = Global.subStarts[Global.currentSongIndex];
        End;
        Small Message(${msgTarget}, Custom String("从头播放：{0}", Global.songTitles[Global.currentSongIndex]));
        Wait(0.400, Ignore Condition);
    }
}

rule("${rulePrefix}Toggle dummy bot visibility (Crouch + Melee)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${comboCond('Crouch', 'Melee')}
    }

    actions
    {
        Global.areBotsInvisible = !Global.areBotsInvisible;
        If(Global.areBotsInvisible);
            Set Invisible(Global.bots, All);
            Small Message(${msgTarget}, Custom String("机器人已隐形 (幽灵演奏模式)"));
        Else;
            Set Invisible(Global.bots, None);
            Small Message(${msgTarget}, Custom String("机器人已显形"));
        End;
        Wait(0.500, Ignore Condition);
    }
}

rule("${rulePrefix}Increase speed (Crouch + Primary Fire / +5%)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${comboCond('Crouch', 'Primary Fire')}
        Global.speedPercent < 200;
    }

    actions
    {
        Global.speedPercent += 5;
        Wait(0.150, Ignore Condition);
    }
}

rule("${rulePrefix}Decrease speed (Crouch + Secondary Fire / -5%)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${comboCond('Crouch', 'Secondary Fire')}
        Global.speedPercent > 50;
    }

    actions
    {
        Global.speedPercent -= 5;
        Wait(0.150, Ignore Condition);
    }
}

rule("${rulePrefix}Start playing (Interact / F)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${btnCond('Interact')}
        Global.songPlayingState == 0;
        (!Global.isCompressionEnabled || Global.hasDecompressionFinished) == True;
    }

    actions
    {
        Call Subroutine(startPlayback);
    }
}

rule("${rulePrefix}Start pressed while score is loading")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${btnCond('Interact')}
        Global.songPlayingState == 0;
        Global.isCompressionEnabled == True;
        Global.hasDecompressionFinished == False;
    }

    actions
    {
        Small Message(${msgTarget}, Custom String("乐谱加载中 {0}%，请稍候", ${loadPct}));
        Wait(1, Ignore Condition);
    }
}

rule("${rulePrefix}Stop playing (Interact / F)")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        ${btnCond('Interact')}
        Global.songPlayingState == 2;
    }

    actions
    {
        Call Subroutine(endSong);
    }
}

rule("Subroutine: start playback")
{
    event
    {
        Subroutine;
        startPlayback;
    }

    actions
    {
        If(Global.songPlayingState == 0);
            "确保指针落在当前曲目有效区间内"
            If(Global.timeArrayIndex < Global.songTimeStarts[Global.currentSongIndex] || Global.timeArrayIndex >= Global.songTimeEnds[Global.currentSongIndex]);
                Global.timeArrayIndex = Global.songTimeStarts[Global.currentSongIndex];
                Global.pitchArrayIndex = Global.songPitchStarts[Global.currentSongIndex];
                Global.songElapsed = 0;
                Global.subIndex = Global.subStarts[Global.currentSongIndex];
            End;
            Global.songPlayingState = 1;
            Global.skipRequested = False;
            Global.skipDirection = 1;
            "从 11 号槽位向下遍历全部 12 个槽位，跳过真人占用的槽位，最多生成 maxBots 个演奏机器人"
            Global.i = 11;
            While(Count Of(Global.bots) < Global.maxBots && Global.i >= 0);
                If(!Entity Exists(Players In Slot(Global.i, All Teams)));
                    Create Dummy Bot(Hero(Symmetra), Team 1, Global.i, Global.botSpawn, Vector(0, 0, 0));
                    Modify Global Variable(bots, Append To Array, Last Created Entity);
                End;
                Global.i -= 1;
                Wait(0.016, Ignore Condition);
            End;
            If(Count Of(Global.bots) < Global.maxBots);
                Small Message(${msgTarget}, Custom String("房间真人较多：仅生成 {0}/{1} 个演奏机器人，复杂曲目可能少音", Count Of(Global.bots), Global.maxBots));
            End;
            Wait(0.500, Ignore Condition);
            Global.songPlayingState = 2;
        End;
    }
}

rule("Play loop")
{
    event
    {
        Ongoing - Global;
    }

    conditions
    {
        Global.songPlayingState == 2;
    }

    actions
    {
        Small Message(All Players(All Teams), Custom String("▶ 第 {0}/{1} 首：{2}", Global.currentSongIndex + 1, Count Of(Global.songTitles), Global.songTitles[Global.currentSongIndex]));
        While(Global.timeArrayIndex < Global.songTimeEnds[Global.currentSongIndex] && Global.songPlayingState == 2 && !Global.skipRequested);
            "乐谱时钟：等待期间逐帧推进（字幕与进度条平滑同步），到达和弦时校准为精确值"
            Global.nextElapsed = Global.songElapsed + Global.timeArrays[Round To Integer(Global.timeArrayIndex / Global.maxArraySize, Down)
                ][Global.timeArrayIndex % Global.maxArraySize] / 1000;
            Global.waitTime += (Global.timeArrays[Round To Integer(Global.timeArrayIndex / Global.maxArraySize, Down)
                ][Global.timeArrayIndex % Global.maxArraySize]) / (1000) * (100 / Global.speedPercent);
            "长休止期间也能即时响应切歌 / 停止"
            While(Global.waitTime >= 0.016 && !Global.skipRequested && Global.songPlayingState == 2);
                Wait(0.016, Ignore Condition);
                Global.waitTime -= 0.016;
                Global.songElapsed = Min(Global.nextElapsed, Global.songElapsed + 0.016 * Global.speedPercent / 100);
                Call Subroutine(showSubtitles);
            End;
            Abort If(Global.songPlayingState != 2);
            If(Global.skipRequested);
                Break;
            End;
            Global.songElapsed = Global.nextElapsed;
            Call Subroutine(showSubtitles);
            For Global Variable(i, 0, Global.chordArrays[Round To Integer(Global.timeArrayIndex / Global.maxArraySize, Down)
                ][Global.timeArrayIndex % Global.maxArraySize], 1);
                Global.bots[Global.currentBotIndex].currentPitchIndex = Global.pitchArrayIndex;
                Global.bots[Global.currentBotIndex].playNote = True;
                Global.currentBotIndex = (Global.currentBotIndex + 1) % Count Of(Global.bots);
                Global.pitchArrayIndex += 1;
            End;
            Global.timeArrayIndex += 1;
        End;
        Abort If(Global.songPlayingState != 2);
        "自然播完：曲间留白 2 秒（期间可切歌或按 F 停止），然后自动播放下一首"
        If(!Global.skipRequested);
            Wait Until(Global.skipRequested || Global.songPlayingState != 2, 2);
            Abort If(Global.songPlayingState != 2);
        End;
        If(!Global.skipRequested);
            Global.skipDirection = 1;
        End;
        Global.currentSongIndex = (Global.currentSongIndex + Global.skipDirection + Count Of(Global.songTitles)) % Count Of(Global.songTitles);
        Global.timeArrayIndex = Global.songTimeStarts[Global.currentSongIndex];
        Global.pitchArrayIndex = Global.songPitchStarts[Global.currentSongIndex];
        Global.songElapsed = 0;
        Global.subIndex = Global.subStarts[Global.currentSongIndex];
        Global.waitTime = 0;
        Global.skipRequested = False;
        Global.skipDirection = 1;
        Wait(0.250, Abort When False);
        Loop If Condition Is True;
    }
}

rule("Stop playing")
{
    event
    {
        Subroutine;
        endSong;
    }

    actions
    {
        For Global Variable(i, 0, 12, 1);
            Destroy Dummy Bot(Team 1, Global.i);
        End;
        Global.bots = Empty Array;
        Global.skipRequested = False;
        Wait(0.200, Ignore Condition);
        Global.songPlayingState = 0;
        Global.waitTime = 0;
    }
}

rule("Subroutine: show subtitles")
{
    event
    {
        Subroutine;
        showSubtitles;
    }

    actions
    {
        "字幕：歌词 / 背景介绍按乐谱时间弹出，调速后依然同步"
        While(Global.subIndex < Global.subEnds[Global.currentSongIndex]);
            If(Global.subTimes[Global.subIndex] > Global.songElapsed);
                Break;
            End;
            "越界保护：索引超出字幕数组时不显示，避免出现空白 / 0 之类的无意义内容"
            If(Global.subIndex >= Global.subStarts[Global.currentSongIndex] && Global.subIndex < Count Of(Global.subTexts));
                Small Message(All Players(All Teams), Global.subTexts[Global.subIndex]);
            End;
            Global.subIndex += 1;
        End;
    }
}

rule("Play note")
{
    event
    {
        Ongoing - Each Player;
        All;
        All;
    }

    conditions
    {
        Is Dummy Bot(Event Player) == True;
        Event Player.playNote == True;
    }

    actions
    {
        Event Player.currentKeyPos = Global.notePositions[Global.pitchArrays[Round To Integer(
            Event Player.currentPitchIndex / Global.maxArraySize, Down)][Event Player.currentPitchIndex % Global.maxArraySize]];
        Teleport(Event Player, Event Player.currentKeyPos);
        Wait(0.032, Ignore Condition);
        Start Holding Button(Event Player, Button(Primary Fire));
        Wait(0.064, Ignore Condition);
        Stop Holding Button(Event Player, Button(Primary Fire));
        Event Player.playNote = False;
    }
}

rule("Race condition workaround for very high playing speeds")
{
    event
    {
        Ongoing - Each Player;
        All;
        All;
    }

    conditions
    {
        Event Player.playNote == True;
    }

    actions
    {
        Wait(0.200, Abort When False);
        Event Player.playNote = False;
        Loop;
    }
}

rule("Decompress all arrays")
{
    event
    {
        Ongoing - Global;
    }

    actions
    {
        Wait(0.250, Ignore Condition);
        Abort If(!Global.isCompressionEnabled);
        For Global Variable(i, 0, 3, 1);
            Global.compressedArray = Empty Array;
            For Global Variable(I, 0, Count Of(Array(Global.pitchArrays, Global.timeArrays, Global.chordArrays)[Global.i]), 1);
                Global.compressedArray[Global.I] = Array(Global.pitchArrays, Global.timeArrays, Global.chordArrays)[Global.i][Global.I];
            End;
            Global.finalCompressedElementLength = Global.compressionInfo[0][Global.i];
            Global.songDataElementLength = Global.compressionInfo[1][Global.i];
            Call Subroutine(decompressArray);
            For Global Variable(I, 0, Count Of(Global.decompressedArray), 1);
                If(Global.i == 0);
                    Global.pitchArrays[Global.I] = Global.decompressedArray[Global.I];
                Else If(Global.i == 1);
                    Global.timeArrays[Global.I] = Global.decompressedArray[Global.I];
                Else If(Global.i == 2);
                    Global.chordArrays[Global.I] = Global.decompressedArray[Global.I];
                End;
            End;
            Global.compressedArray = Empty Array;
            Global.decompressionPercentages[Global.i] = 100;
        End;
        Global.decompressedArray = Empty Array;
        Global.hasDecompressionFinished = True;
    }
}

rule("Decompress array")
{
    event
    {
        Subroutine;
        decompressArray;
    }

    actions
    {
        Global.decompressedArray = Empty Array;
        Global.decompressedArray[0] = Empty Array;
        Global.L = 0;
        Global.numberArray = Empty Array;
        Global.compressedArrayLength = Global.maxArraySize * (Count Of(Global.compressedArray) - 1) + Count Of(Last Of(
            Global.compressedArray));
        For Global Variable(I, 0, Global.compressedArrayLength, 1);
            For Global Variable(J, 0,
                Global.I == Global.compressedArrayLength - 1 ? Global.finalCompressedElementLength : Global.compressedElementLength, 1);
                Modify Global Variable(numberArray, Append To Array, Round To Integer(Global.compressedArray[Round To Integer(
                    Global.I / Global.maxArraySize, Down)][Global.I % Global.maxArraySize] / 10 ^ ((
                    Global.I == Global.compressedArrayLength - 1 ? Global.finalCompressedElementLength : Global.compressedElementLength)
                    - 1 - Global.J), Down) % 10);
            End;
            While(Count Of(Global.numberArray) >= Global.songDataElementLength);
                Global.decompressedValue = 0;
                For Global Variable(J, 0, Global.songDataElementLength, 1);
                    Global.decompressedValue += First Of(Global.numberArray) * 10 ^ (Global.songDataElementLength - 1 - Global.J);
                    Modify Global Variable(numberArray, Remove From Array By Index, 0);
                End;
                Modify Global Variable At Index(decompressedArray, Global.L, Append To Array, Global.decompressedValue);
                If(Count Of(Global.decompressedArray[Global.L]) >= Global.maxArraySize);
                    Global.L += 1;
                    Global.decompressedArray[Global.L] = Empty Array;
                End;
            End;
            If(Global.I % 25 == 0);
                Wait(0.016, Ignore Condition);
                Global.decompressionPercentages[Global.i] = 100 * Global.I / Global.compressedArrayLength;
            End;
        End;
    }
}
`;

        return header + pianoScript + songRules;
    }

    return {
        generateFullSettings,
        PIANO_POSITIONS
    };
}));
