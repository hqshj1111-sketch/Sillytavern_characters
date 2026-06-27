/**
 * 角色卡 "露出直播" 专属MVU监护脚本
 * 包含：回合计数、日期/天气自动演进、阶段切换、事件推送、队列管理、跨越检测、直播人数更新、粉丝联动等
 */
const SCRIPT_NAME = '露出直播-MVU变量维护监护脚本';
const SCRIPT_VERSION = 'v1.0';

const scriptState = {
    initialized: false,
    retryCount: 0,
    maxRetries: 10,
    listeners: { onVariableUpdateEnded: null },
    previousData: null,
    eventProb: 0.1,
    lastProcessedTurn: 0,
    lastNpcEvent: null,
};

const eventNpcMap = {
    // 汐见真帆
    '妹妹深夜自慰事件': '汐见真帆',
    '妹妹白天自慰事件': '汐见真帆',
    '妹妹白丝舔足事件': '汐见真帆',
    '妹妹丝袜足交事件': '汐见真帆',
    '妹妹游戏惩罚事件': '汐见真帆',
    '妹妹早安咬事件': '汐见真帆',
    '妹妹漫展COS事件': '汐见真帆',
    '妹妹性爱邀约事件': '汐见真帆',
    '妹妹双人玩具事件': '汐见真帆',
    '妹妹远程遥控事件': '汐见真帆',
    '妹妹影院隐奸事件': '汐见真帆',
    '妹妹内裤自慰事件': '汐见真帆',
    '妹妹迅三人竞争事件': '汐见真帆',
    // 黑崎海斗
    '海斗更衣室自慰事件': '黑崎海斗',
    '海斗共同锻炼事件': '黑崎海斗',
    '海斗教室勃起事件': '黑崎海斗',
    '海斗汗臭吸引事件': '黑崎海斗',
    '海斗睡觉误入事件': '黑崎海斗',
    '海斗联谊装对象事件': '黑崎海斗',
    '海斗后穴开发事件': '黑崎海斗',
    '海斗性爱邀请事件': '黑崎海斗',
    '海斗赛后拜访事件': '黑崎海斗',
    // 冰室纱耶
    '老师约炮偶遇事件': '冰室纱耶',
    '老师自慰发现事件': '冰室纱耶',
    '老师跳蛋掉落事件': '冰室纱耶',
    '老师私人补习事件': '冰室纱耶',
    '老师温泉邀请事件': '冰室纱耶',
    '老师约炮邀请事件': '冰室纱耶',
    // 风见迅
    '快递错拿事件': '风见迅',
    '迅共同上学事件': '风见迅',
    '迅全裸守门事件': '风见迅',
    '迅共同直播事件': '风见迅',
    '迅直播配合事件': '风见迅',
    '迅遛狗PLAY事件': '风见迅',
    '迅远程遥控事件': '风见迅',
    // 多人 / 其他
    '海斗老师三人性爱事件': '多人',
    // 无特定 NPC 均映射为 '环境'
    '忠实粉丝事件': '环境',
    '电车之狼事件': '环境',
    '夜间电车事件': '环境',
    '厕所鸟洞事件': '环境',
    '催眠按摩事件': '环境',
    '梦中水仙事件': '环境',
};

// ---------- 工具函数 ----------
function getMvuInstance() {
    try { return window.Mvu || window.parent?.Mvu || window.top?.Mvu || null; } 
    catch (e) { console.warn(`[${SCRIPT_NAME}] 访问MVU实例时出错:`, e); return null; }
}

/**
 * 基于初始年月日时分和经过的分钟数，计算当前日期时间与星期
 */
function computeDateTime(initYear, initMonth, initDay, initHour, initMinute, timestampMinutes) {
    const totalMinutes = initHour * 60 + initMinute + timestampMinutes;
    const carryDays = Math.floor(totalMinutes / 1440);
    const remainMinutes = totalMinutes % 1440;
    const currentHour = Math.floor(remainMinutes / 60);
    const currentMinute = remainMinutes % 60;

    const baseDate = new Date(initYear, initMonth - 1, initDay);
    baseDate.setDate(baseDate.getDate() + carryDays);
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth() + 1;
    const day = baseDate.getDate();
    let week = baseDate.getDay(); // 0=周日, 1=周一...
    week = week === 0 ? 7 : week; // 转换为 1=周一...7=周日
    return { year, month, day, hour: currentHour, minute: currentMinute, week };
}

/**
 * 判断是否寒假（1月15-2月15）或暑假（7月1-8月31）
 */
function getHoliday(month, day) {
    const mdd = month * 100 + day;
    if (mdd >= 115 && mdd <= 215) return '寒假';
    if (mdd >= 701 && mdd <= 831) return '暑假';
    return '否';
}

/**
 * 获取季节
 */
function getSeason(month) {
    if (month >= 3 && month <= 5) return '春';
    if (month >= 6 && month <= 8) return '夏';
    if (month >= 9 && month <= 11) return '秋';
    return '冬';
}

/**
 * 根据季节随机天气
 */
function generateWeather(season) {
    const r = Math.random();
    if (season === '冬') {
        if (r < 0.7) return '晴';
        if (r < 0.9) return '小雪';
        return '大雪';
    } else {
        if (r < 0.7) return '晴';
        if (r < 0.9) return '小雨';
        return '大雨';
    }
}

/**
 * 将待处理事件移入同名事件队列，防止覆盖
 */
function enqueueExistingEvent(variables, eventName) {
    const pending = _.get(variables, 'stat_data.系统状态.待处理事件', {});
    if (!_.has(pending, eventName)) return;
    const oldValue = pending[eventName];
    let queue = _.get(variables, `stat_data.系统状态.同名事件队列.${eventName}`);
    if (!Array.isArray(queue)) {
        queue = [];
    }
    queue.push(oldValue);
    _.set(variables, `stat_data.系统状态.同名事件队列.${eventName}`, queue);
    _.unset(variables, `stat_data.系统状态.待处理事件.${eventName}`);
}

/**
 * 安全推送事件（处理排队）
 */
function pushEvent(variables, eventName, value) {
    enqueueExistingEvent(variables, eventName);
    _.set(variables, `stat_data.系统状态.待处理事件.${eventName}`, value);
    _.set(variables, 'stat_data.系统状态.事件等待处理中', true);
}

// ---------- 模块：日期与天气自动演进 ----------
function processDateTimeWeather(variables, prevData) {
    const initYear = parseInt(_.get(variables.stat_data, '进程.初始年份', 2025)) || 2025;
    const initMonth = parseInt(_.get(variables.stat_data, '进程.初始月份', 10)) || 10;
    const initDay = parseInt(_.get(variables.stat_data, '进程.初始日份', 15)) || 15;
    const initHour = parseInt(_.get(variables.stat_data, '进程.初始小时', 19)) || 19;
    const initMinute = parseInt(_.get(variables.stat_data, '进程.初始分钟', 0)) || 0;
    const timestamp = parseInt(_.get(variables.stat_data, '进程.当前时间戳', 0)) || 0;

    const cur = computeDateTime(initYear, initMonth, initDay, initHour, initMinute, timestamp);
    const prevMonth = parseInt(_.get(prevData, '进程.当前月份', initMonth)) || initMonth;
    const prevDay = parseInt(_.get(prevData, '进程.当前日份', initDay)) || initDay;

    // 写入新的年月日时分
    _.set(variables, 'stat_data.进程.当前年份', cur.year);
    _.set(variables, 'stat_data.进程.当前月份', cur.month);
    _.set(variables, 'stat_data.进程.当前日份', cur.day);
    _.set(variables, 'stat_data.进程.当前小时', cur.hour);
    _.set(variables, 'stat_data.进程.当前分钟', cur.minute);
    _.set(variables, 'stat_data.进程.当前周几', cur.week);

    // 假期判定
    const holiday = getHoliday(cur.month, cur.day);
    _.set(variables, 'stat_data.进程.当前假期', holiday);

    // 日份变化时更新天气
    if (cur.day !== prevDay || cur.month !== prevMonth) {
        const season = getSeason(cur.month);
        const weather = generateWeather(season);
        _.set(variables, 'stat_data.进程.当前天气', weather);

        // 大雨/大雪事件
        if (weather === '大雨') {
            pushEvent(variables, '今日大雨事件', true);
        } else if (weather === '大雪') {
            pushEvent(variables, '今日大雪事件', true);
        }
    }

    // 季节变化
    const prevSeason = getSeason(prevMonth);
    const curSeason = getSeason(cur.month);
    if (prevSeason !== curSeason) {
        const changeMap = {
            '冬春': '冬到春', '春夏': '春到夏', '夏秋': '夏到秋', '秋冬': '秋到冬',
            '春冬': '秋到冬', // 逆向不可能？只考虑正向
        };
        const key = prevSeason + curSeason;
        const eventVal = changeMap[key];
        if (eventVal) {
            pushEvent(variables, '季节变换事件', eventVal);
        }
    }
}

// ---------- 模块：数组维护与标签修复 ----------
/**
 * 数组维护：纠错、补回 extensible 标签（保留重复项，适用于弹幕等允许重复的数组）
 */
function maintainExtensibleArrays(variables) {
    const targetPaths = [
        '直播状态.当前直播间弹幕',    // 弹幕非常需要不去重
        '直播状态.当前直播间标签',
        '主角.当前状态.当前性行为',
        '主角.道具栏.已购道具列表'
    ];
    
    targetPaths.forEach(path => {
        let arr = _.get(variables.stat_data, path);
        
        // 1. 类型纠错：如果被 AI 写成了非数组，强制转为数组
        if (!Array.isArray(arr)) {
            arr = arr ? [arr] : [];
        }
        
        // 2. 仅清理冗余/错位的标签，保留所有内容（不去重）
        const cleanArr = arr.filter(item => item !== '$__META_EXTENSIBLE__$');
        
        // 3. 补回可扩展标签到末尾
        cleanArr.push('$__META_EXTENSIBLE__$');
        
        // 4. 变更检测
        if (!_.isEqual(arr, cleanArr)) {
            _.set(variables, `stat_data.${path}`, cleanArr);
        }
    });
}

// ---------- 模块：阶段切换监测 ----------
function processPhaseSwitch(variables, prevData) {
    const prevStreaming = _.get(prevData, '直播状态.是否正在直播', false);
    const curStreaming = _.get(variables.stat_data, '直播状态.是否正在直播', false);

    // 从 false -> true: 进入直播阶段
    if (!prevStreaming && curStreaming) {
        _.set(variables, 'stat_data.进程.阶段', '直播阶段');
        const currentTimestamp = _.get(variables, 'stat_data.进程.当前时间戳', 0);
        _.set(variables, 'stat_data.直播状态.当前直播开始时间戳', currentTimestamp);
        console.log(`[露出直播监控] 检测到开播，阶段切换为直播阶段，开始时间戳：${currentTimestamp}`);
    }

    // 直播结算事件从有变无：阶段切回日常，重置直播临时数据
    const prevSettlement = _.get(prevData, '系统状态.待处理事件.直播结算事件', undefined);
    const curSettlement = _.get(variables.stat_data, '系统状态.待处理事件.直播结算事件', undefined);
    console.log(`[露出直播监控] 阶段切换查看，${prevSettlement} + ${curSettlement}`);
    if (prevSettlement !== undefined && curSettlement === undefined) {
        const heat = _.get(variables.stat_data, '直播状态.当前直播间热度', 0) || 0;
        const shameReduce = Math.floor(Math.random() * 6) + 5; // 5～10
        const currentShame = parseInt(_.get(variables.stat_data, '主角.当前状态.羞耻度', 100)) || 100;
        const newShame = Math.max(0, currentShame - shameReduce);
        _.set(variables, 'stat_data.主角.当前状态.羞耻度', newShame);
        console.log(`[露出直播监控] 直播结算，热度 ${heat}，羞耻度 -${shameReduce} → ${newShame}`);
        const prevCount = parseInt(_.get(variables.stat_data, '主角.主播信息.直播总次数', 0)) || 0;
        _.set(variables, 'stat_data.主角.主播信息.直播总次数', prevCount + 1);
        _.set(variables, 'stat_data.进程.阶段', '日常阶段');
        // 重置直播间数据
        _.set(variables, 'stat_data.直播状态.当前直播间人数', 0);
        _.set(variables, 'stat_data.直播状态.当前直播间热度', 0);
        _.set(variables, 'stat_data.直播状态.当次直播高潮次数', 0);
        _.set(variables, 'stat_data.直播状态.当前直播间标题', '');
        _.set(variables, 'stat_data.直播状态.当前直播间标签', []);
        _.set(variables, 'stat_data.直播状态.当前直播开始时间戳', 0);
        _.set(variables, 'stat_data.直播状态.当前直播间弹幕', []);
        console.log('[露出直播监控] 直播结算完成，阶段切换为日常阶段并重置临时数据');
    }
}

// ---------- 模块：日常阶段事件随机推送 (需求4,5,6) ----------
function processEventPush(variables, prevData) {
    const phase = _.get(variables.stat_data, '进程.阶段', '日常阶段');
    if (phase !== '日常阶段') return;

    const isStreaming = _.get(variables.stat_data, '直播状态.是否正在直播', false);
    if (isStreaming) return;

    const sexActs = _.get(variables.stat_data, '主角.当前状态.当前性行为', []);
    if (Array.isArray(sexActs) && sexActs.length > 0) return;

    const eventWaiting = _.get(variables.stat_data, '系统状态.事件等待处理中', false);

    const randValue = Math.random();
    const prob = scriptState.eventProb;

    console.log(`[露出直播监控] 随机推送事件监测: ${eventWaiting} + ${randValue} vs ${prob}`);

    // 递增概率推送一个随机事件
    if (!eventWaiting && randValue < prob && scriptState.lastProcessedTurn === 0) {
        const eventCounters = _.get(variables.stat_data, '进程.事件计数', {});
        const eventKeys = Object.keys(eventCounters);
        
        // 过滤掉当前条件不满足的特殊事件
        const makoto = variables.stat_data?.NPC数据?.汐见真帆 || {};
        const kaido  = variables.stat_data?.NPC数据?.黑崎海斗 || {};
        const saya  = variables.stat_data?.NPC数据?.冰室纱耶 || {};
        const jin    = variables.stat_data?.NPC数据?.风见迅   || {};

        const filteredKeys = eventKeys.filter(key => {
            // 原有秘密发现限制
            if (key === '妹妹双人玩具事件' || key === '妹妹远程遥控事件' || key === '妹妹影院隐奸事件') {
                return _.get(makoto, '秘密发现', false);
            }
            if (key === '迅共同直播事件' || key === '迅直播配合事件') {
                return jin.秘密发现 && parseInt(jin.秘密察觉程度 || 0) >= 100;
            }
            if (key === '迅遛狗PLAY事件' || key === '迅远程遥控事件') {
                return _.get(jin, '秘密发现', false);
            }
            if (key === '迅共同上学事件') {
                return !_.get(jin, '秘密发现', false);
            }
          
            // 新增数值门槛
          
            // 汐见真帆
            if (key === '妹妹白丝舔足事件' || key === '妹妹丝袜足交事件' || key === '妹妹早安咬事件') {
                return (parseInt(makoto.淫乱度) || 0) >= 25;
            }
            if (key === '妹妹性爱邀约事件') {
                return (parseInt(makoto.淫乱度) || 0) >= 50;
            }
            if (key === '妹妹迅三人竞争事件') {
                return (parseInt(makoto.淫乱度) || 0) >= 75;
            }
          
            // 黑崎海斗
            if (key === '海斗教室勃起事件' || key === '海斗汗臭吸引事件' ||
                key === '海斗睡觉误入事件' || key === '海斗赛后拜访事件') {
                return (parseInt(kaido.淫乱度) || 0) >= 25;
            }
            if (key === '海斗联谊装对象事件' || key === '海斗后穴开发事件' ||
                key === '海斗性爱邀请事件') {
                return (parseInt(kaido.淫乱度) || 0) >= 50;
            }
          
            // 冰室纱耶
            if (key === '老师约炮偶遇事件' || key === '老师私人补习事件') {
                return (parseInt(saya.好感度) || 0) >= 25;
            }
            if (key === '老师约炮邀请事件') {
                return (parseInt(saya.好感度) || 0) >= 50;
            }
          
            // 风见迅
            if (key === '迅全裸守门事件') {
                return (parseInt(jin.好感度) || 0) >= 25 && (parseInt(jin.淫乱度) || 0) >= 25;
            }
          
            // 多 NPC
            if (key === '海斗老师三人性爱事件') {
                return (parseInt(kaido.淫乱度) || 0) >= 50;
            }
          
            return true;
        });

        // 根据上次触发的 NPC 再次过滤，避免连续同角色事件
        let selectedKeys = [...filteredKeys];
        if (scriptState.lastNpcEvent && filteredKeys.length > 1) {
            const avoidKeys = filteredKeys.filter(key => {
                const npc = eventNpcMap[key] || '环境';
                return npc !== scriptState.lastNpcEvent;
            });
            if (avoidKeys.length > 0) {
                selectedKeys = avoidKeys;
            }
        }
        
        // 优先“首次发现秘密”事件（零次计数）
        const discoveryEvents = [
            '妹妹深夜自慰事件', '妹妹白天自慰事件',
            '老师约炮偶遇事件', '老师跳蛋掉落事件', '老师自慰发现事件',
            '快递错拿事件', '迅共同上学事件'
        ];
        const zeroCountDiscovery = discoveryEvents.filter(key => {
            return selectedKeys.includes(key) && (eventCounters[key] || 0) === 0;
        });
        
        let chosen;
        if (zeroCountDiscovery.length > 0 && Math.random() < 0.6) {
            chosen = zeroCountDiscovery[Math.floor(Math.random() * zeroCountDiscovery.length)];
        } else if (selectedKeys.length > 0) {
            chosen = selectedKeys[Math.floor(Math.random() * selectedKeys.length)];
        } else {
            // 最终没有可用事件，概率重置并退出
            scriptState.eventProb = 0.1;
            return;
        }
        
        console.log(`[露出直播监控] 随机推送事件: ${chosen} (概率 ${prob.toFixed(2)})`);
        pushEvent(variables, chosen, true);
        scriptState.eventProb = 0.1;   // 触发后重置概率
        
        // 记录本次触发的 NPC 名
        scriptState.lastNpcEvent = eventNpcMap[chosen] || '环境';
    } else {
        scriptState.eventProb = Math.min(scriptState.eventProb + 0.05, 0.5);
        console.log(`[露出直播监控] 随机事件未触发，概率累计至 ${scriptState.eventProb.toFixed(2)}`);
    }

    // 处理队列：如果当前无待处理事件，从同名事件队列中取一个
    const pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    if (Object.keys(pending).length === 0) {
        let found = false;
        const queues = _.get(variables.stat_data, '系统状态.同名事件队列', {});
        for (const [key, value] of Object.entries(queues)) {
            if (Array.isArray(value) && value.length > 0) {
                // 取出第一个
                const item = value.shift();
                if (value.length === 0) {
                    _.unset(variables, `stat_data.系统状态.同名事件队列.${key}`);
                } else {
                    _.set(variables, `stat_data.系统状态.同名事件队列.${key}`, value);
                }
                _.set(variables, `stat_data.系统状态.待处理事件.${key}`, item);
                found = true;
                console.log(`[露出直播监控] 从队列取出事件: ${key}`);
                break;
            } else if (value && typeof value !== 'object') {
                // 为布尔或字符串，直接放入
                _.set(variables, `stat_data.系统状态.待处理事件.${key}`, value);
                _.unset(variables, `stat_data.系统状态.同名事件队列.${key}`);
                found = true;
                console.log(`[露出直播监控] 从队列取出事件: ${key}`);
                break;
            }
        }
        if (!found) {
            // 队列也为空，将事件等待处理中设为false
            _.set(variables, 'stat_data.系统状态.事件等待处理中', false);
        }
    }

    // 事件计数增加：监测从有变无的事件
    const prevPending = _.get(prevData, '系统状态.待处理事件', {});
    const curPending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    const eventCounters = _.get(variables.stat_data, '进程.事件计数', {});
    for (const key of Object.keys(prevPending)) {
        if (!_.has(curPending, key)) {
            // 此事件被移除了
            if (_.has(eventCounters, key) && scriptState.lastProcessedTurn === 0) {
                const oldVal = parseInt(_.get(variables.stat_data, `进程.事件计数.${key}`, 0)) || 0;
                _.set(variables, `stat_data.进程.事件计数.${key}`, oldVal + 1);
                console.log(`[露出直播监控] 事件计数+1: ${key} --> ${oldVal + 1}`);
            }
        }
    }
}

function processLewdIncreaseOnSexCount(variables, prevData) {
    const expPath = '主角.性经验记录';
    const currentExp = _.get(variables.stat_data, expPath, {});
    const previousExp = _.get(prevData, expPath, {});

    // 非插入行为：每+1 → 淫乱度+5
    const nonPenetrationFields = [
        '自慰次数', '情趣玩具使用次数',
        '主动手交次数', '被动手交次数',
        '主动足交次数', '被动足交次数',
        '主动口交次数', '被动口交次数',
        '被动乳交次数'
    ];
    // 插入行为：每+1 → 淫乱度+10
    const penetrationFields = [
        '小穴插入性爱次数',
        '后穴插入性爱次数',
        '后穴性爱次数'
    ];

    let totalIncrease = 0;

    const processFields = (fields, increment) => {
        fields.forEach(field => {
            const prev = parseInt(_.get(previousExp, field, 0)) || 0;
            const cur = parseInt(_.get(currentExp, field, 0)) || 0;
            const diff = cur - prev;
            if (diff > 0) {
                totalIncrease += diff * increment;
                console.log(`[露出直播监控] 性行为 ${field} 次数增加 +${diff} → 淫乱度 +${diff * increment}`);
            }
        });
    };

    processFields(nonPenetrationFields, 5);
    processFields(penetrationFields, 10);

    if (totalIncrease > 0 && scriptState.lastProcessedTurn === 0) {
        const currentLewd = parseInt(_.get(variables.stat_data, '主角.当前状态.淫乱度', 0)) || 0;
        const newLewd = Math.min(100, currentLewd + totalIncrease);
        _.set(variables, 'stat_data.主角.当前状态.淫乱度', newLewd);
        console.log(`[露出直播监控] 淫乱度总计 +${totalIncrease} → ${newLewd}`);
    }
}

// ---------- 模块：各种跨越阶段事件监测 (需求7) ----------
function processThresholdEvents(variables, prevData) {
    const prevStats = prevData || {};

    console.log(`[processThresholdEvents] previousData 关键值:`, {
      羞耻度: _.get(prevData, '主角.当前状态.羞耻度'),
      淫乱度: _.get(prevData, '主角.当前状态.淫乱度'),
      直播总次数: _.get(prevData, '主角.主播信息.直播总次数'),
      粉丝数: _.get(prevData, '主角.主播信息.粉丝数'),
      开发度: _.get(prevData, '主角.开发度'),
      NPC好感度: _.mapValues(_.get(prevData, 'NPC数据', {}), n => n.好感度),
      NPC淫乱度: _.mapValues(_.get(prevData, 'NPC数据', {}), n => n.淫乱度),
      NPC察觉程度: _.mapValues(_.get(prevData, 'NPC数据', {}), n => n.秘密察觉程度),
    });

    // 通用阈值检测辅助函数
    const checkThreshold = (prev, cur, thresholds) => {
        const triggered = [];
        for (const t of thresholds) {
            if (prev < t && cur >= t) triggered.push(t);
            else if (prev >= t && cur < t) triggered.push(t);
        }
        return triggered;
    };

    // 1. 身体开发度
    const devPaths = {
        '胸部': '/主角/开发度/胸部开发度',
        '肉棒': '/主角/开发度/肉棒开发度',
        '后穴': '/主角/开发度/后穴开发度'
    };
    const devStages = [3, 6, 10]; // 初步/中度/深度
    for (const [partLabel, path] of Object.entries(devPaths)) {
        const prev = parseInt(_.get(prevStats, path, 0)) || 0;
        const cur = parseInt(_.get(variables.stat_data, path, 0)) || 0;
        const crossings = checkThreshold(prev, cur, devStages);
        for (const t of crossings) {
            pushEvent(variables, '身体开发度升级事件', partLabel);
            console.log(`[露出直播监控] 开发度升级: ${partLabel} 跨越 ${t}`);
        }
    }

    // 2. 羞耻度 (下降跨越 75,50,25)
    const shamePrev = parseInt(_.get(prevStats, '主角.当前状态.羞耻度', 100)) || 100;
    const shameCur = parseInt(_.get(variables.stat_data, '主角.当前状态.羞耻度', 100)) || 100;
    const shameStages = [75, 50, 25];
    for (const t of shameStages) {
        if (shamePrev >= t && shameCur < t) {
            pushEvent(variables, '羞耻度升级事件', true);
            console.log(`[露出直播监控] 羞耻度下降跨越 ${t}`);
        }
    }

    // 3. 淫乱度 (上升跨越 25,50,75)
    const lewdPrev = parseInt(_.get(prevStats, '主角.当前状态.淫乱度', 0)) || 0;
    const lewdCur = parseInt(_.get(variables.stat_data, '主角.当前状态.淫乱度', 0)) || 0;
    const lewdStages = [25, 50, 75];
    for (const t of lewdStages) {
        if (lewdPrev < t && lewdCur >= t) {
            pushEvent(variables, '淫乱度升级事件', true);
            console.log(`[露出直播监控] 淫乱度上升跨越 ${t}`);
        }
    }

    // 4. NPC淫乱度升级
    const npcData = variables.stat_data?.NPC数据 || {};
    const prevNpcData = prevStats?.NPC数据 || {};
    const npcLewdStages = [25, 50, 75];
    const upgradedNpcsLewd = [];
    for (const npcName of Object.keys(npcData)) {
        const prevNpcLewd = parseInt(_.get(prevNpcData, `${npcName}.淫乱度`, 0)) || 0;
        const curNpcLewd = parseInt(_.get(npcData, `${npcName}.淫乱度`, 0)) || 0;
        const crossed = npcLewdStages.some(t => prevNpcLewd < t && curNpcLewd >= t);
        if (crossed) {
            upgradedNpcsLewd.push(npcName);
        }
    }
    if (upgradedNpcsLewd.length > 0) {
        pushEvent(variables, 'NPC淫乱度升级事件', upgradedNpcsLewd);
        console.log(`[露出直播监控] NPC淫乱度升级: ${upgradedNpcsLewd.join(', ')}`);
    }

    // 5. NPC好感度升级 (阈值 25,50,75)
    const npcAffStages = [25, 50, 75];
    const upgradedNpcsAff = [];
    for (const npcName of Object.keys(npcData)) {
        const prevAff = parseInt(_.get(prevNpcData, `${npcName}.好感度`, 0)) || 0;
        const curAff = parseInt(_.get(npcData, `${npcName}.好感度`, 0)) || 0;
        const crossed = npcAffStages.some(t => prevAff < t && curAff >= t);
        if (crossed) {
            upgradedNpcsAff.push(npcName);
        }
    }
    if (upgradedNpcsAff.length > 0) {
        pushEvent(variables, 'NPC好感度升级事件', upgradedNpcsAff);
        console.log(`[露出直播监控] NPC好感度升级: ${upgradedNpcsAff.join(', ')}`);
    }

    // 6. 秘密暴露 (察觉程度 >=90)
    for (const npcName of Object.keys(npcData)) {
        const prevSus = parseInt(_.get(prevNpcData, `${npcName}.秘密察觉程度`, 0)) || 0;
        const curSus = parseInt(_.get(npcData, `${npcName}.秘密察觉程度`, 0)) || 0;
        if (prevSus < 90 && curSus >= 90) {
            pushEvent(variables, '秘密暴露事件', npcName);
            console.log(`[露出直播监控] 秘密暴露: ${npcName}`);
        }
    }

    // 7. 直播态度变化 (总次数跨越 1,4,7,10)
    const prevStreamCount = parseInt(_.get(prevStats, '主角.主播信息.直播总次数', 0)) || 0;
    const curStreamCount = parseInt(_.get(variables.stat_data, '主角.主播信息.直播总次数', 0)) || 0;
    const streamThresholds = [1, 4, 7, 10];
    for (const t of streamThresholds) {
        if (prevStreamCount < t && curStreamCount >= t) {
            pushEvent(variables, '直播态度变化事件', true);
            console.log(`[露出直播监控] 直播态度变化 (总次数跨越 ${t})`);
            break; // 一次变化只触发一次
        }
    }

    // 8. 粉丝里程碑 (主角)
    const prevFans = parseInt(_.get(prevStats, '主角.主播信息.粉丝数', 0)) || 0;
    const curFans = parseInt(_.get(variables.stat_data, '主角.主播信息.粉丝数', 0)) || 0;
    const fanMilestones = [100, 500, 2000, 10000, 100000, 1000000];
    for (const m of fanMilestones) {
        if (prevFans < m && curFans >= m) {
            pushEvent(variables, '粉丝里程碑事件', m);
            console.log(`[露出直播监控] 粉丝里程碑: ${m}`);
            break;
        }
    }

    // 9. 迅的人气分享 (风见迅粉丝里程碑)
    const prevJinFans = parseInt(_.get(prevNpcData, '风见迅.主播信息.粉丝数', 0)) || 0;
    const curJinFans = parseInt(_.get(npcData, '风见迅.主播信息.粉丝数', 0)) || 0;
    const jinMilestones = [100, 500, 2000, 10000, 100000, 1000000];
    for (const m of jinMilestones) {
        if (prevJinFans < m && curJinFans >= m) {
            pushEvent(variables, '人气分享事件', m);
            console.log(`[露出直播监控] 迅的人气分享: 突破${m}粉丝`);
            break;
        }
    }

    // 10. NPC性爱次数里程碑（每3次推送身体开发事件）
    Object.keys(npcData).forEach(name => {
        const curCount = parseInt(_.get(npcData, `${name}.与主角做爱次数`, 0)) || 0;
        const prevCount = parseInt(_.get(prevNpcData, `${name}.与主角做爱次数`, 0)) || 0;
        if (curCount > 0 && curCount % 3 === 0 && curCount > prevCount) {
            pushEvent(variables, 'NPC身体开发事件', name);
            console.log(`[露出直播监控] ${name} 性爱次数达到 ${curCount}，推送身体开发事件`);
        }
    });
}

// ---------- 模块：直播人数更新 (需求8) ----------
function processLiveViewers(variables, prevData) {
    const isStreaming = _.get(variables.stat_data, '直播状态.是否正在直播', false);
    if (!isStreaming) return;

    const phase = _.get(variables.stat_data, '进程.阶段', '');
    if (phase !== '直播阶段') return;
    if (scriptState.lastProcessedTurn === 0) {
        const prevViewers = parseInt(_.get(variables.stat_data, '直播状态.当前直播间人数', 0)) || 0;
        const heat = parseInt(_.get(variables.stat_data, '直播状态.当前直播间热度', 0)) || 0;
        const baseGain = 8;
        const heatFactor = 2.2;
        const randomFactor = 0.8 + Math.random() * 0.4;
        const delta = Math.floor((baseGain + heat * heatFactor) * randomFactor) + _.random(0, 5);
        const newViewers = Math.max(0, prevViewers + delta);
        _.set(variables, 'stat_data.直播状态.当前直播间人数', newViewers);
        console.log(`[露出直播监控] 直播间人数更新: ${prevViewers} -> ${newViewers} (delta:${delta})`);  
    }
}

// ---------- 模块：直播结束记录最高数据 (需求9) ----------
function processStreamEndRecords(variables, prevData) {
    const prevStreaming = _.get(prevData, '直播状态.是否正在直播', false);
    const curStreaming = _.get(variables.stat_data, '直播状态.是否正在直播', false);
    if (!prevStreaming || curStreaming) return; // 不是从true变false则跳过

    const curViewers = parseInt(_.get(variables.stat_data, '直播状态.当前直播间人数', 0)) || 0;
    const curClimax = parseInt(_.get(variables.stat_data, '直播状态.当次直播高潮次数', 0)) || 0;
    const peakViewers = parseInt(_.get(variables.stat_data, '主角.主播信息.单次直播最高人数', 0)) || 0;
    const peakClimax = parseInt(_.get(variables.stat_data, '主角.主播信息.单次直播最高高潮次数', 0)) || 0;

    if (curViewers > peakViewers) {
        _.set(variables, 'stat_data.主角.主播信息.单次直播最高人数', curViewers);
        console.log(`[露出直播监控] 更新最高在线人数: ${curViewers}`);
    }
    if (curClimax > peakClimax) {
        _.set(variables, 'stat_data.主角.主播信息.单次直播最高高潮次数', curClimax);
        console.log(`[露出直播监控] 更新单次直播最高高潮次数: ${curClimax}`);
    }
}

// ---------- 模块：主角粉丝增长联动迅粉丝数 (需求10) ----------
function processFanSyncToJin(variables, prevData) {
    const prevFans = parseInt(_.get(prevData, '主角.主播信息.粉丝数', 0)) || 0;
    const curFans = parseInt(_.get(variables.stat_data, '主角.主播信息.粉丝数', 0)) || 0;
    if (curFans > prevFans) {
        const delta = curFans - prevFans;
        const coef = 0.8 + Math.random() * 0.3; // 0.8 ~ 1.1
        const jinGain = Math.floor(delta * coef);
        if (jinGain > 0 && scriptState.lastProcessedTurn === 0) {
            const curJinFans = parseInt(_.get(variables.stat_data, 'NPC数据.风见迅.主播信息.粉丝数', 0)) || 0;
            _.set(variables, 'stat_data.NPC数据.风见迅.主播信息.粉丝数', curJinFans + jinGain);
            console.log(`[露出直播监控] 主角粉丝+${delta}，迅粉丝同步增加 ${jinGain} (系数${coef.toFixed(2)})`);
        }
    }
}

// ---------- 核心事件分发器 ----------
function onVariableUpdateEnded(variables) {
    if (!variables?.stat_data?.进程) {
        scriptState.previousData = _.cloneDeep(variables?.stat_data);
        return;
    }

    // 首次调用，保存状态并返回
    if (!scriptState.previousData) {
        scriptState.previousData = _.cloneDeep(variables.stat_data);
        console.log(`[${SCRIPT_NAME}] 初始状态已建立`);
    }

    let flag = false;

    console.log(`[${SCRIPT_NAME}] 当前lastProcessedTurn为${scriptState.lastProcessedTurn}`);

    // 如果这个回合已经处理过了，直接忽略
    if (scriptState.lastProcessedTurn === 0) {
        flag = true;
    }

    console.log(`[${SCRIPT_NAME}] 当前lastProcessedTurn为${scriptState.lastProcessedTurn}`);

    //maintainExtensibleArrays(variables);

    const curTurn = _.get(variables.stat_data, '进程.当前回合数', 0);

    // 回合自增
    _.set(variables, 'stat_data.进程.当前回合数', curTurn + 1);
    console.log(`[${SCRIPT_NAME}] 回合 ${curTurn} -> ${curTurn + 1}`);

    // 1. 时间与天气
    processDateTimeWeather(variables, scriptState.previousData);

    // 2. 阶段切换
    processPhaseSwitch(variables, scriptState.previousData);

    // 3. 日常事件推送与队列管理
    processEventPush(variables, scriptState.previousData);

    processLewdIncreaseOnSexCount(variables, scriptState.previousData);
    
    // 4. 跨越阈值事件
    processThresholdEvents(variables, scriptState.previousData);

    // 5. 直播人数更新
    processLiveViewers(variables, scriptState.previousData);

    // 6. 直播结束记录
    processStreamEndRecords(variables, scriptState.previousData);

    // 7. 粉丝联动
    processFanSyncToJin(variables, scriptState.previousData);

    // 保存当前快照
    scriptState.previousData = _.cloneDeep(variables.stat_data);

    if (flag) {
      scriptState.lastProcessedTurn = 1;
    } else {
      scriptState.lastProcessedTurn = 0;
    }
}

// ---------- 生命周期管理 ----------
function initializeEventListeners() {
    if (scriptState.initialized) return;
    try {
        const Mvu = getMvuInstance();
        if (Mvu) {
            scriptState.listeners.onVariableUpdateEnded = onVariableUpdateEnded;
            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, scriptState.listeners.onVariableUpdateEnded);
            scriptState.initialized = true;
            console.log(`[${SCRIPT_NAME}] ${SCRIPT_VERSION} 初始化成功`);
            if (window.toastr) toastr.success(`${SCRIPT_NAME} 已启动`, '监护脚本');
        } else {
            scriptState.retryCount++;
            if (scriptState.retryCount < scriptState.maxRetries) {
                setTimeout(initializeEventListeners, 2000);
            } else {
                console.error(`[${SCRIPT_NAME}] MVU实例获取失败，停止重试`);
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
