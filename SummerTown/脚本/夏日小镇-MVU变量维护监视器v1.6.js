/**
 * 角色卡 “夏日小镇” 专属MVU监护脚本
 * 包含：回合计数、概率事件推送、日期变动、关系质变拦截
 */
const SCRIPT_NAME = '夏日小镇-MVU监护脚本';
const SCRIPT_VERSION = 'v1.6';

const scriptState = {
    initialized: false,
    retryCount: 0,
    maxRetries: 10,
    listeners: { onVariableUpdateEnded: null },
    previousData: null,
    memoryCounters: {
        dailyTurn: 0,
        dailySpecialCount: 0,
        dailySpecialBound: 10,
        streamEndLastTurn: -1
    },
};

// 所有有效标准地点名称
const STANDARD_LOCATIONS = [
    // 西侧
    "早乙女家公共区域", "海斗的房间", "夏海的房间", "海水浴场", "防波堤与废弃灯塔", "海滨旧仓库",
    // 东侧
    "御神山神社公共区域", "莲的房间", "乐奈的房间", "祭典广场", "山顶观景台", "希克的秘密基地", "清凉溪流",
    // 中央
    "月下家公共区域", "阳太的房间", "雪乃的房间", "镇立图书馆", "汐见沢美食街", "风铃酒馆", "古早杂货铺",
    // 南侧
    "雨宫家老宅公共区域", "凉子的房间", "明日香的房间", "主角的房间", "夜灯台小公园", "镇民集会所与中古铺", "镇民公共浴场",
    // 北侧
    "汐见沢高校", "远郊电车站", "废弃列车厢", "乡间田野"
];

// 区域 -> 默认住宅映射
const REGION_HOME_MAP = {
    "西": "早乙女家公共区域",
    "南": "雨宫家老宅公共区域",
    "中": "月下家公共区域",
    "东": "御神山神社公共区域",
    "北": "汐见沢高校"
};

function getMvuInstance() {
    try { return window.Mvu || window.parent?.Mvu || window.top?.Mvu || null; } 
    catch (e) { console.warn(`[${SCRIPT_NAME}] 访问MVU实例时出错:`, e); return null; }
}

// 关系阶段阈值判断，依据世界书中的设定：25(朋友/暧昧), 50(知己/沉沦), 75(恋人/依赖)
function getRelTier(val) {
    if (val >= 75) return 3;
    if (val >= 50) return 2;
    if (val >= 25) return 1;
    return 0;
}

// --- 模块：联合状态回收逻辑 ---
function processStateRecovery(variables, prevData) {
    const prevSpec = _.get(prevData, '系统状态.特殊事件进行中', false);
    const curSpec = _.get(variables.stat_data, '系统状态.特殊事件进行中', false);

    if (prevSpec && !curSpec) {

        const eventType = _.get(variables.stat_data, '特殊事件.类型', '');

        if (eventType.startsWith('随机互动-')) {
            const baseType = eventType.split('-')[1]; // 亲密度 或 情欲度
            const targets = _.get(variables.stat_data, '特殊事件.对象', []);
            const rangeStr = _.get(variables.stat_data, '特殊事件.增长区间', '1-3');
            const [lo, hi] = rangeStr.split('-').map(Number);
            const bonus = _.random(lo, hi);

            _.forEach(targets, (npcName) => {
                const path = `NPC数据.${npcName}.主角关系.${baseType}`;
                const oldVal = _.get(variables.stat_data, path, 0);
                _.set(variables, `stat_data.${path}`, oldVal + bonus);
                console.log(`[${SCRIPT_NAME}] 特殊事件结算: ${npcName} ${baseType} +${bonus} (${lo}-${hi})`);
            });
        }

        console.log(`[${SCRIPT_NAME}] 事件已平息，重置底层特殊事件变量`);
        _.set(variables, 'stat_data.特殊事件.名称', '无');
        _.set(variables, 'stat_data.特殊事件.对象', []);
        _.set(variables, 'stat_data.特殊事件.类型', '无');
        _.set(variables, 'stat_data.特殊事件.主题', '无');
        _.set(variables, 'stat_data.特殊事件.地点', '无');
        _.set(variables, 'stat_data.特殊事件.叙事基调', '无');
        _.set(variables, 'stat_data.特殊事件.增长区间', '无');
    }
}

/**
 * 数值正确性检查与纠正函数
 * 递归遍历 stat_data，确保所有数值类型的变量不小于 0，若发现负数则自动重置为 0。
 * @param {Object} variables - 酒馆传入的全局变量对象
 */
function validateAndFixNumericVariables(variables) {
    if (!variables?.stat_data) return;

    const deepSanitize = (obj, path = 'stat_data') => {
        _.forOwn(obj, (value, key) => {
            const currentPath = `${path}.${key}`;
            
            if (typeof value === 'number') {
                if (value < 0) {
                    console.warn(`[${SCRIPT_NAME}] 逻辑冲突纠正: ${currentPath} 出现负值 (${value}), 已强制归零。`);
                    obj[key] = 0;
                }
            } else if (_.isPlainObject(value)) {
                // 仅对纯对象进行递归，避免处理数组或其他特殊类型
                deepSanitize(value, currentPath);
            }
        });
    };

    deepSanitize(variables.stat_data);
}

/**
 * 标准化一个地点文本，必要时参考角色所在区域的方向字（"南"/"西"/"中"/"东"/"北"）
 */
function normalizeLocationName(input, direction) {
    if (!input) return "未知";
    let str = String(input).trim();

    // 1. 已是标准地名，直接返回
    if (STANDARD_LOCATIONS.includes(str)) return str;

    // 2. 包含标准地名全称，提取出来
    for (const loc of STANDARD_LOCATIONS) {
        if (str.includes(loc)) return loc;
    }

    // 3. 静态关键词映射（精确度较高，不依赖区域）
    const STATIC_MAP = {
        "早乙女": "早乙女家公共区域", "海斗": "海斗的房间", "夏海": "夏海的房间",
        "海水浴": "海水浴场", "沙滩": "海水浴场", "海边": "海水浴场",
        "防波堤": "防波堤与废弃灯塔", "灯塔": "防波堤与废弃灯塔",
        "旧仓库": "海滨旧仓库", "仓库": "海滨旧仓库",
        "神社": "御神山神社公共区域", "御神山": "御神山神社公共区域", "社务所": "御神山神社公共区域",
        "莲": "莲的房间", "乐奈": "乐奈的房间",
        "祭典": "祭典广场", "广场": "祭典广场",
        "观景台": "山顶观景台", "山顶": "山顶观景台",
        "秘密基地": "希克的秘密基地", "希克": "希克的秘密基地",
        "溪流": "清凉溪流", "山泉": "清凉溪流", "深林": "清凉溪流",
        "月下": "月下家公共区域", "阳太": "阳太的房间", "雪乃": "雪乃的房间",
        "图书馆": "镇立图书馆", "美食街": "汐见沢美食街",
        "酒馆": "风铃酒馆", "居酒屋": "风铃酒馆",
        "杂货铺": "古早杂货铺", "小卖部": "古早杂货铺",
        "健身房": "汐风健身房", "铁馆": "汐风健身房",
        "雨宫": "雨宫家老宅公共区域", "老宅": "雨宫家老宅公共区域",
        "凉子": "凉子的房间", "明日香": "明日香的房间",
        "主角": "主角的房间", "自己的房间": "主角的房间",
        "夜灯台": "夜灯台小公园", "公园": "夜灯台小公园",
        "集会所": "镇民集会所与中古铺", "中古铺": "镇民集会所与中古铺",
        "浴场": "镇民公共浴场", "澡堂": "镇民公共浴场",
        "高校": "汐见沢高校", "学校": "汐见沢高校",
        "电车站": "远郊电车站", "车站": "远郊电车站",
        "列车厢": "废弃列车厢", "废轨": "废弃列车厢",
        "田野": "乡间田野", "稻田": "乡间田野"
    };
    for (const [keyword, standard] of Object.entries(STATIC_MAP)) {
        if (str.includes(keyword)) return standard;
    }

    const defaultHome = REGION_HOME_MAP[direction] || "雨宫家老宅";

    // 4. 区域相关的模糊公共区域词（如浴室、厨房、客厅等）
    const publicAreaKeywords = [
        "客厅", "厨房", "走廊", "浴室", "洗澡", "脱衣", "院子", "家里",
        "饭桌", "餐桌", "洗手间", "厕所", "泡澡", "起居室", "大厅"
    ];
    for (const kw of publicAreaKeywords) {
        if (str.includes(kw)) return defaultHome;
    }

    // 5. 模糊的卧室/房间类词语
    const bedroomKeywords = ["卧室", "床", "房间", "屋子", "屋内"];
    // 先检查是否夹杂具体角色名（已在 STATIC_MAP 处理过，但这里再兜底一次）
    const charRooms = {
        "海斗": "海斗的房间", "夏海": "夏海的房间",
        "凉子": "凉子的房间", "明日香": "明日香的房间",
        "莲": "莲的房间", "乐奈": "乐奈的房间",
        "阳太": "阳太的房间", "雪乃": "雪乃的房间",
        "希克": "希克的秘密基地"
    };
    for (const [name, room] of Object.entries(charRooms)) {
        if (str.includes(name)) return room;
    }
    if (str.includes("主角") || str.includes("自己") || str.includes("我") || str.includes("我的")) {
        return "主角的房间";
    }

    // 无具体人名时，若包含卧室相关词，按区域推定：
    for (const kw of bedroomKeywords) {
        if (str.includes(kw)) {
            // 南侧默认为主角的房间（主角借住在雨宫家）
            if (direction === '南') return "主角的房间";
            // 其他区域退而求其次返回该区域的公共住宅
            return defaultHome;
        }
    }

    // 6. 完全无法识别的，保留原值并输出调试警告
    console.warn(`[${SCRIPT_NAME}] 无法标准化地点: "${input}", 区域: ${direction}`);
    return str;
}

/**
 * 遍历主角和所有NPC，将其“当前地点”强制标准化
 */
function normalizeAllLocations(variables) {
    if (!variables?.stat_data) return;
    if (variables.stat_data.主角?.当前状态) {
        const raw = variables.stat_data.主角.当前状态.当前地点;
        const region = variables.stat_data.主角.当前状态.当前区域 || '';
        const dir = region.charAt(0); // 取“南/西/中/东/北”
        variables.stat_data.主角.当前状态.当前地点 = normalizeLocationName(raw, dir);
    }
    const npcData = variables.stat_data.NPC数据;
    if (npcData) {
        for (const name of Object.keys(npcData)) {
            const npc = npcData[name];
            if (npc?.当前状态) {
                const raw = npc.当前状态.当前地点;
                const region = npc.当前状态.当前区域 || '';
                const dir = region.charAt(0);
                npc.当前状态.当前地点 = normalizeLocationName(raw, dir);
            }
        }
    }
}

function ensureCalendarInitialized(variables) {
    const existing = _.get(variables, 'stat_data.活动日历');
    if (Array.isArray(existing) && existing.length > 0) return;

    const fixedEvents = [
        { 日期: 25, 名称: "汐见沢夏日祭", 地点: "祭典广场", 描述: "包含盆踊、摊位与海上烟火的夏日最高潮。", 持续时间: "17:00-22:00" },
        { 日期: 28, 名称: "海神愿望灯仪式", 地点: "防波堤与废弃灯塔", 描述: "点燃纸灯放入大海，祈求下半年平安顺遂。", 持续时间: "19:00-21:00" },
        { 日期: 30, 名称: "夏日终结·再见市集", 地点: "镇民集会所与中古铺", 描述: "在集会所外的空地交换夏季纪念品，正式告别这段难忘盛夏。", 持续时间: "10:00-17:00" }
    ];

    const flexibleDefs = [
        { 名称: "全镇清扫日", 地点: "镇民集会所与中古铺", 描述: "居民集体清扫街道与集会所，结束后分发免费波子汽水。", 持续时间: "8:00-12:00" },
        { 名称: "盛夏捕虫竞技赛", 地点: "清凉溪流", 描述: "捕捉林间珍稀甲虫，赢取限量版昆虫模型。", 持续时间: "9:00-15:00" },
        { 名称: "小镇大胃王挑战赛", 地点: "汐见沢美食街", 描述: "挑战特大份豚骨拉面，场面极度热闹且燥热。", 持续时间: "11:00-14:00" },
        { 名称: "仲夏夜露天电影会", 地点: "汐见沢高校", 描述: "在静谧操场架起幕布，微风中重温青春电影。", 持续时间: "19:00-23:00" },
        { 名称: "海之子·泳装选美大赛", 地点: "海水浴场", 描述: "展示健美身材，评选年度海滨最具人气者。", 持续时间: "14:00-17:00" },
        { 名称: "集体露出日", 地点: "全镇", 描述: "应对酷暑的古老习俗，居民全天回归原始，彻底全裸纳凉。", 持续时间: "全天" },
        { 名称: "御神山试胆大会", 地点: "御神山神社", 描述: "深夜寻访神社禁地，挑战胆量与禁忌心跳。", 持续时间: "21:00-01:00" },
        { 名称: "全镇水枪生存大乱斗", 地点: "镇民集会所与中古铺", 描述: "无论男女老少皆可参与的无差别水枪战，用清凉的水花洗刷夏日的高温与烦恼。", 持续时间: "14:00-16:00" },
        { 名称: "汐见沢写真散步", 地点: "全镇", 描述: "用拍立得或手机拍摄小镇最美的夏日角落，黄昏时在集会所投票选出最佳作品。", 持续时间: "9:00-18:00" }
    ];

    const fixedDays = new Set([25, 28, 30]);
    let success = false;
    let attempts = 0;
    const maxAttempts = 50;
    let finalAssigned = [];

    while (!success && attempts < maxAttempts) {
        attempts++;
        const assigned = [];
        const used = new Set(fixedDays);
        const shuffled = _.shuffle(flexibleDefs);
        let lastDay = null;
        let possible = true;

        for (const def of shuffled) {
            if (lastDay === null) {
                // 第一个活动：在2-22之间随机选一个不与固定日期冲突的日期，随机性由shuffle注入
                const candidates = [];
                for (let d = 2; d <= 22; d++) {
                    if (!used.has(d)) candidates.push(d);
                }
                if (candidates.length === 0) { possible = false; break; }
                const day = _.sample(candidates);
                used.add(day);
                assigned.push({ ...def, 日期: day });
                lastDay = day;
            } else {
                // 后续活动：间隔2或3（随机），且不超出22且不落在固定日期
                const steps = _.shuffle([2, 3]);
                let chosen = null;
                for (const step of steps) {
                    const candidate = lastDay + step;
                    if (candidate <= 22 && !used.has(candidate)) {
                        chosen = candidate;
                        break;
                    }
                }
                if (chosen === null) { possible = false; break; }
                used.add(chosen);
                assigned.push({ ...def, 日期: chosen });
                lastDay = chosen;
            }
        }

        if (possible) {
            success = true;
            finalAssigned = assigned;
        }
    }

    // 如果50次都失败，强制保底（理论上概率极低）
    if (!success) {
        console.warn(`[${SCRIPT_NAME}] 日历初始化多次失败，使用保底顺序生成。`);
        const sortedDefs = [...flexibleDefs]; // 不随机，按原顺序
        const assigned = [];
        const used = new Set(fixedDays);
        let lastDay = null;
        for (const def of sortedDefs) {
            if (lastDay === null) {
                let d = 2;
                while (used.has(d) && d <= 22) d++;
                used.add(d);
                assigned.push({ ...def, 日期: d });
                lastDay = d;
            } else {
                let d = lastDay + 2;
                while ((d > 22 || used.has(d)) && d <= 23) d++;
                if (d > 22) {
                    // 强行找第一个未使用日
                    d = 2;
                    while (used.has(d) && d <= 22) d++;
                }
                used.add(d);
                assigned.push({ ...def, 日期: d });
                lastDay = d;
            }
        }
        finalAssigned = assigned;
    }

    const fullCalendar = [...finalAssigned, ...fixedEvents].sort((a, b) => a.日期 - b.日期);
    _.set(variables, 'stat_data.活动日历', fullCalendar);
    console.log(`[${SCRIPT_NAME}] 活动日历初始化完成，共 ${fullCalendar.length} 个节日，尝试次数：${attempts}`);
}

// --- 模块 1：日期变动监测 ---
function processDateChange(variables, prevData) {
    const currentTimestamp = (parseInt(_.get(variables.stat_data, '进程.当前时间戳', 0)) || 0) + 540;
    const prevTimestamp = (parseInt(_.get(prevData, '进程.当前时间戳', 0)) || 0) + 540;

    // 计算当前天数：第1天 = 0-1439分钟, 第2天 = 1440-2879分钟, 以此类推
    const currentDay = Math.floor(currentTimestamp / 1440) + 1;
    const prevDay = Math.floor(prevTimestamp / 1440) + 1;

    if (currentTimestamp > prevTimestamp + 300) {
        _.set(variables, `stat_data.主角.当前状态.快感值`, 0);
        _.set(variables, `stat_data.主角.当前状态.性欲值`, 0);
    }
    
    // 若天数未变化，直接返回
    if (currentDay <= prevDay) return;
    const prevRecordedDay = parseInt(_.get(prevData, '进程.暑假天数', 1), 10) || 1;
    const newDay = prevRecordedDay + 1;
    
    console.log(`[${SCRIPT_NAME}] 检测到天数推进: 第${newDay}天 (时间戳 ${prevTimestamp} → ${currentTimestamp})`);

    // 1. 更新天数
    _.set(variables, 'stat_data.进程.暑假天数', newDay);
    
    // 2. 重置每日计数器
    scriptState.memoryCounters.dailyTurn = 0;
    scriptState.memoryCounters.dailySpecialCount = 0;
    
    // 3. 重置所有NPC的今日完成事项列表
    const npcData = variables.stat_data?.NPC数据;
    if (npcData) {
        Object.keys(npcData).forEach(name => {
            _.set(variables, `stat_data.NPC数据.${name}.今日完成事项列表`, []);
        });
    }
    
    // 4. 随机天气与气温
    let tempBase = 28, tempMax = 35;
    if (newDay > 10 && newDay <= 20) { tempBase = 30; tempMax = 37; }
    else if (newDay > 20) { tempBase = 32; tempMax = 40; }
    
    const newTemp = _.random(tempBase, tempMax);
    let weathers = ['晴天', '晴天', '晴天', '晴天', '多云', '阵雨'];
    if (newTemp >= 35) weathers = ['晴天', '晴天', '晴天', '雷阵雨'];
    const newWeather = _.sample(weathers);
    
    // 5. 推送日期变化事件
    _.set(variables, 'stat_data.系统状态.待处理事件.日期切换事件', true);
    
    // 6. 节日与终末狂欢检测
    const calendar = _.get(variables.stat_data, '活动日历', []);
    const festivalDays = new Set(calendar.map(event => event.日期));
    let isFestival = false;
    
    if (newDay === 30) {
        _.set(variables, 'stat_data.系统状态.待处理事件.最后的狂欢事件', true);
        _.set(variables, 'stat_data.系统状态.待处理事件.节日到来事件', true);
        isFestival = true;
    } else if (festivalDays.has(newDay)) {
        _.set(variables, 'stat_data.系统状态.待处理事件.节日到来事件', true);
        isFestival = true;
    } else {
        _.set(variables, 'stat_data.系统状态.待处理事件.节日预告事件', true);
    }
    
    // 7. 暴雨事件推演
    if (newDay > 10 && !isFestival) {
        const auntLust = parseInt(_.get(variables.stat_data, 'NPC数据.雨宫凉子.主角关系.情欲度', 0), 10) || 0;
        const cousinLust = parseInt(_.get(variables.stat_data, 'NPC数据.雨宫明日香.主角关系.情欲度', 0), 10) || 0;
        
        let rainTargets = [];
        if (auntLust > 50) rainTargets.push('雨宫凉子');
        if (cousinLust > 50) rainTargets.push('雨宫明日香');
        
        if (rainTargets.length > 0 && Math.random() < 0.15) {
            console.log(`[${SCRIPT_NAME}] ⛈️ 触发暴雨事件！`);
            newWeather = '暴雨';
            _.set(variables, 'stat_data.系统状态.待处理事件.暴雨事件', rainTargets);
        }
    }
    
    _.set(variables, 'stat_data.进程.当日气温', newTemp);
    _.set(variables, 'stat_data.进程.当日天气', newWeather);
    
    // 8. 累积晴天数
    if (newWeather === '晴天') {
        let sunnyDays = parseInt(_.get(variables.stat_data, '进程.累积晴天数', 0), 10) || 0;
        sunnyDays += 1;
        _.set(variables, 'stat_data.进程.累积晴天数', sunnyDays);
        
        if (sunnyDays === 7 || sunnyDays === 14) {
            console.log(`[${SCRIPT_NAME}] 触发晒黑事件`);
            _.set(variables, 'stat_data.系统状态.待处理事件.晒黑事件', true);
        }
    }
}


/**
 * 每回合自增全局回合数，并监控NPC地点/动作变化，记录开始回合与时间
 */
function processTurnCountAndNPCState(variables, prevData) {
    // 1. 自增全局回合数
    const prevTurn = parseInt(_.get(prevData, '进程.当前回合数', 0), 10) || 0;
    const newTurn = prevTurn + 1;
    _.set(variables, 'stat_data.进程.当前回合数', newTurn);
    console.log(`[${SCRIPT_NAME}] 全局回合数自增: ${prevTurn} -> ${newTurn}`);

    // 2. 计算当前绝对分钟（基于暑假天数 + HH:MM）
    const currentAbsoluteMinutes = parseInt(_.get(variables.stat_data, '进程.当前时间戳', 0)) || 0;

    // 3. 遍历NPC，监控变化
    const npcData = variables.stat_data?.NPC数据;
    const prevNpcData = prevData?.NPC数据;
    if (!npcData) return;

    Object.keys(npcData).forEach(name => {
        const npcState = npcData[name]?.当前状态;
        if (!npcState) return;
        const prevState = prevNpcData?.[name]?.当前状态;

        // 地点变化（或首次出现） → 记录开始回合
        const curLoc = npcState.当前地点 || '';
        const prevLoc = prevState?.当前地点 || '';
        if (curLoc !== prevLoc || !prevState) {
            npcState.当前地点开始回合 = newTurn;
            console.log(`[${SCRIPT_NAME}] NPC ${name} 地点变更: "${prevLoc}" -> "${curLoc}", 记录回合 ${newTurn}`);
        }

        // 动作变化（或首次出现） → 记录开始时间（绝对分钟）
        const curAct = npcState.当前动作 || '';
        const prevAct = prevState?.当前动作 || '';
        if (curAct !== prevAct || !prevState) {
            npcState.当前动作开始时间 = currentAbsoluteMinutes;
            console.log(`[${SCRIPT_NAME}] NPC ${name} 动作变更: "${prevAct}" -> "${curAct}", 记录时间 ${currentAbsoluteMinutes}分钟`);
        }

        // 目标变化（或首次出现） → 记录开始时间（绝对分钟）
        const curGoal = npcState.当前目标 || '';
        const prevGoal = prevState?.当前目标 || '';
        if (curGoal !== prevGoal || !prevState) {
            npcState.当前目标开始时间 = currentAbsoluteMinutes;
            console.log(`[${SCRIPT_NAME}] NPC ${name} 目标变更: "${prevGoal}" -> "${curGoal}", 记录时间 ${currentAbsoluteMinutes}分钟`);

            // 若旧目标非空且非未知，构造事项记录存入列表
            if (prevGoal && prevGoal !== '未知' && prevGoal !== '') {
                const startMin = parseInt(prevState?.当前目标开始时间, 10) || currentAbsoluteMinutes;
                const endMin = currentAbsoluteMinutes;
                const fmtTime = (mins) => {
                    const h = String(Math.floor(mins / 60) % 24).padStart(2, '0');
                    const m = String(mins % 60).padStart(2, '0');
                    return `${h}:${m}`;
                };
                const record = `[${prevGoal}]`;
                
                const listPath = `NPC数据.${name}.今日完成事项列表`;
                let taskList = _.get(variables, `stat_data.${listPath}`, []);
                if (!Array.isArray(taskList)) taskList = [];
                taskList.push(record);
                _.set(variables, `stat_data.${listPath}`, taskList);
                console.log(`[${SCRIPT_NAME}] NPC ${name} 记录事项: ${record}`);
            }
        }
    });
}

// --- 模块：每回合逻辑与数值监测 ---
function processTurnLogicAndEvents(variables, prevData) {
    let eventPushedThisTurn = false;
    const prevTurnEndTime = _.get(prevData, '进程.当前回合结束时间', '无');
    _.set(variables, 'stat_data.进程.上一回合结束时间', prevTurnEndTime);

    const isSpecialOngoing = _.get(variables.stat_data, '系统状态.特殊事件进行中', false);
    const specialType = _.get(variables.stat_data, '特殊事件.类型', "无");
    
    const currentSexActs = _.get(variables.stat_data, '主角.当前状态.当前性行为', []);
    const isSexActive = Array.isArray(currentSexActs) && currentSexActs.length > 0;
    const npcs = Object.keys(_.get(variables.stat_data, 'NPC数据', {}));

    // 1. 羁绊质变与告白检测 (无条件监测数值变化，立刻推入队列)
    for (const npc of npcs) {
        if (eventPushedThisTurn) break;
        const curIntimacy = parseInt(_.get(variables.stat_data, `NPC数据.${npc}.主角关系.亲密度`, 0), 10) || 0;
        const prevIntimacy = parseInt(_.get(prevData, `NPC数据.${npc}.主角关系.亲密度`, 0), 10) || 0;
        const curLust = parseInt(_.get(variables.stat_data, `NPC数据.${npc}.主角关系.情欲度`, 0), 10) || 0;
        const prevLust = parseInt(_.get(prevData, `NPC数据.${npc}.主角关系.情欲度`, 0), 10) || 0;

        const intCrossed = getRelTier(curIntimacy) > getRelTier(prevIntimacy);
        const lustCrossed = getRelTier(curLust) > getRelTier(prevLust);

        if (intCrossed || lustCrossed) {
            if (prevIntimacy < 75 && curIntimacy >= 75) {
                const existingEvent = _.get(variables, 'stat_data.系统状态.待处理事件.告白事件');
                if (!existingEvent) {
                    _.set(variables, 'stat_data.系统状态.待处理事件.告白事件', npc);
                }
            } else {
                const changeType = intCrossed ? '亲密度' : '情欲度';
                let existing = _.get(variables, 'stat_data.系统状态.待处理事件.关系变化事件', []);
                if (!Array.isArray(existing)) existing = [];
                existing.push([npc, changeType]);
                _.set(variables, 'stat_data.系统状态.待处理事件.关系变化事件', existing);
                console.log(`[${SCRIPT_NAME}] NPC ${npc} 关系变化： ${changeType}`);
            }
            eventPushedThisTurn = true; // 占用本回合的推送配额
            scriptState.memoryCounters.dailyTurn = 0;
        }
    }

    // --- 沙盒审计推送 (每5回合一次) ---
    const currentTurn = parseInt(_.get(variables.stat_data, '进程.当前回合数', 0), 10) || 0;
    if (currentTurn > 0 && currentTurn % 5 === 0) {
        _.set(variables, 'stat_data.系统状态.待处理事件.沙盒审计事件', true);
        console.log(`[${SCRIPT_NAME}] 📋 推送沙盒审计事件 (回合 ${currentTurn})`);
    }

    const prevSnowLust = parseInt(_.get(prevData, 'NPC数据.月下雪乃.主角关系.情欲度', 0), 10) || 0;
    const prevSnowInti = parseInt(_.get(prevData, 'NPC数据.月下雪乃.主角关系.亲密度', 0), 10) || 0;
    const curSnowLust = parseInt(_.get(variables.stat_data, 'NPC数据.月下雪乃.主角关系.情欲度', 0), 10) || 0;
    const curSnowInti = parseInt(_.get(variables.stat_data, 'NPC数据.月下雪乃.主角关系.亲密度', 0), 10) || 0;
    const isRegistered = _.get(variables.stat_data, '主角.露出主播.注册', false) === true;

    if (!isRegistered && (prevSnowLust + prevSnowInti) < 100 && (curSnowLust + curSnowInti) >= 100) {
        console.log(`[${SCRIPT_NAME}] 触发露出主播邀请事件！`);
        _.set(variables, 'stat_data.系统状态.待处理事件.露出主播邀请事件', true);
        eventPushedThisTurn = true;
    }

    // 2. 常规回合叠加与事件推送 (仅在特殊事件未进行，且无性行为时)
    if (!isSpecialOngoing  && !isSexActive) {
        scriptState.memoryCounters.dailyTurn += 1;
        let realTurnCount = scriptState.memoryCounters.dailyTurn;

        const temp = parseInt(_.get(variables.stat_data, '进程.当日气温', 32), 10) || 32;
        const probSpecial = Math.max(0, (realTurnCount - 1) / 28);
        const specialChance = Math.random();

        console.log(`[${SCRIPT_NAME}] 特殊随机数为为${specialChance}， 特殊事件概率为  ${probSpecial}。事件${eventPushedThisTurn}， 触发次数为 ${scriptState.memoryCounters.dailySpecialCount}，触发上限为 ${scriptState.memoryCounters.dailySpecialBound}`);

        // 特殊事件 (关键：只要 !eventPushedThisTurn 即可)
        if (!eventPushedThisTurn && 
            scriptState.memoryCounters.dailySpecialCount < scriptState.memoryCounters.dailySpecialBound && specialChance < probSpecial) {
            _.set(variables, 'stat_data.系统状态.待处理事件.特殊事件', true);
            console.log(`[${SCRIPT_NAME}] 推送特殊事件。`);
            scriptState.memoryCounters.dailySpecialCount += 1;
            scriptState.memoryCounters.dailyTurn = 0;
        }
    }
}

// --- 模块：露出直播处理 ---
function processExposureStreaming(variables, prevData) {
    const prevIsPreparing = _.get(prevData, '进程.露出直播准备', false) === true;
    const curIsPreparing = _.get(variables.stat_data, '进程.露出直播准备', false) === true;
    const prevIsStreaming = _.get(prevData, '进程.露出直播进行中', false) === true;
    const curIsStreaming = _.get(variables.stat_data, '进程.露出直播进行中', false) === true;

    // 1. 准备阶段变为 true: 初始化直播间
    if (!prevIsPreparing && curIsPreparing) {
        const baseFans = _.get(variables.stat_data, '主角.露出主播.粉丝数', 0) || 0;
        // 浮动率在 -20% 到 20% 之间
        const floatRate = (Math.random() * 0.4) - 0.2;
        const initialViewers = Math.max(0, Math.floor(baseFans * (1 + floatRate)));
        
        console.log(`[${SCRIPT_NAME}] 露出直播准备就绪，初始化直播间。基础粉丝: ${baseFans}，浮动后初始人数: ${initialViewers}`);
        _.set(variables, 'stat_data.进程.直播间人数', initialViewers);
        _.set(variables, 'stat_data.进程.直播间热度', 0);
    }

    // 2. 进行中: 根据热度累加更新人数 (新的平滑增长模型)
    if (curIsStreaming) {
        const prevViewers = parseInt(_.get(prevData, '进程.直播间人数', 0)) || 0;
        const currentHeat = _.get(variables.stat_data, '进程.直播间热度', 0) || 0;

        // 基础增量：固定引流 + 热度带来的自然增长
        const baseGain = 8;          // 平台每回合固定推流人数
        const heatFactor = 2.2;      // 每点热度额外带来的人数系数

        // 随机因子 0.8~1.2
        const randomFactor = 0.8 + Math.random() * 0.4;
        // 每回合增加人数
        const delta = Math.floor((baseGain + currentHeat * heatFactor) * randomFactor) + _.random(0, 5);

        const newViewers = Math.max(0, prevViewers + delta);
        _.set(variables, 'stat_data.进程.直播间人数', newViewers);
    }

    // 从进行中变为 false: 直播结束，增加次数并设置态度
    if (prevIsStreaming && !curIsStreaming) {
        const prevStreamCount = parseInt(_.get(prevData, '主角.露出主播.直播次数', 0), 10) || 0;
        const curStreamCount = parseInt(_.get(variables.stat_data, '主角.露出主播.直播次数', 0), 10) || 0;

        if (prevStreamCount === curStreamCount) {  // 确保是首次处理
            const currentTimes = curStreamCount + 1;
            _.set(variables, 'stat_data.主角.露出主播.直播次数', currentTimes);

            let newAttitude;
            if (currentTimes === 0) {
                newAttitude = "被意外拉入陌生的世界，站在镜头前不知所措，内心满是迷茫与羞耻。";
            } else if (currentTimes <= 3) {
                newAttitude = "磕磕绊绊中找到一丝隐秘的快乐，羞耻感尚未褪去，但期待已经开始萌芽。";
            } else if (currentTimes <= 6) {
                newAttitude = "与镜头和观众达成了默契，坦然接受自己露出主播的身份，表演愈发从容自信。";
            } else {
                newAttitude = "享受每一次心跳加速的展示，露出已成为生活的一部分，渴望更大胆的舞台。";
            }

            console.log(`[${SCRIPT_NAME}] 直播结束。当前总次数: ${currentTimes}，态度更新为: ${newAttitude}`);
            _.set(variables, 'stat_data.主角.露出主播.态度', newAttitude);
        }
    }
}

// --- 核心事件分发器 ---
function onVariableUpdateEnded(variables) {
    if (!variables?.stat_data?.进程 || !scriptState.previousData) {
        scriptState.previousData = _.cloneDeep(variables.stat_data);
        console.log(`[${SCRIPT_NAME}] 初始状态已建立。`);
        return;
    }

    ensureCalendarInitialized(variables);
    processStateRecovery(variables, scriptState.previousData);
    processDateChange(variables, scriptState.previousData);
    processTurnLogicAndEvents(variables, scriptState.previousData);
    processExposureStreaming(variables, scriptState.previousData);

    validateAndFixNumericVariables(variables);
    normalizeAllLocations(variables);
    processTurnCountAndNPCState(variables, scriptState.previousData);

    scriptState.previousData = _.cloneDeep(variables.stat_data);
}

// --- 生命周期管理 ---
function initializeEventListeners() {
    if (scriptState.initialized) return;
    try {
        const Mvu = getMvuInstance();
        if (Mvu) {
            scriptState.listeners.onVariableUpdateEnded = onVariableUpdateEnded;
            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, scriptState.listeners.onVariableUpdateEnded);
            scriptState.initialized = true;
            console.log(`[${SCRIPT_NAME}] ${SCRIPT_VERSION} 初始化成功。`);
            if (window.toastr) toastr.success(`${SCRIPT_NAME} 已启动`, '监护脚本');
        } else {
            scriptState.retryCount++;
            if (scriptState.retryCount < scriptState.maxRetries) {
                setTimeout(initializeEventListeners, 2000);
            }
        }
    } catch (error) {
        console.error(`[${SCRIPT_NAME}] 初始化失败:`, error);
    }
}

function cleanup() {
    try {
        const Mvu = getMvuInstance();
        if (Mvu && scriptState.listeners.onVariableUpdateEnded) {
            eventRemoveListener(Mvu.events.VARIABLE_UPDATE_ENDED, scriptState.listeners.onVariableUpdateEnded);
        }
        scriptState.initialized = false;
        scriptState.previousData = null;
    } catch (error) {}
}

$(() => { setTimeout(initializeEventListeners, 1500); });
$(window).on('unload', cleanup);