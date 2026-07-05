/**
 * 角色卡 "露出直播" 专属MVU监护脚本
 * 包含：回合计数、日期/天气自动演进、阶段切换、事件推送、队列管理、跨越检测、直播人数更新、粉丝联动等
 */
const SCRIPT_NAME = "露出直播-MVU变量维护监护脚本";
const SCRIPT_VERSION = "v1.0";

const scriptState = {
  initialized: false,
  retryCount: 0,
  maxRetries: 10,
  listeners: { onBeforeGeneration: null, onVariableUpdateEnded: null },
  previousData: null,
  eventProb: 0.1,
  lastNpcEvent: null,
};

// ============================================================
//  缓存：监听 textarea 输入，pre-generation 时拿到最新消息
// ============================================================
(function setupInputCache() {
    function tryBind() {
        try {
            var ta = window.parent.document.querySelector('#send_textarea');
            if (ta) {
                ta.addEventListener('input', function() { var v = ta.value; if (v.trim()) { window.top.__IDF_LAST_STREAM_INPUT = v; } });
                window.top.__IDF_LAST_STREAM_INPUT = ta.value || '';
                console.info('[' + SCRIPT_NAME + '] 输入缓存已绑定 send_textarea');
            } else {
                console.warn('[' + SCRIPT_NAME + '] 未找到 send_textarea，300ms后重试');
                setTimeout(tryBind, 300);
            }
        } catch(e) {
            console.warn('[' + SCRIPT_NAME + '] 访问父窗口失败:', e.message);
            setTimeout(tryBind, 300);
        }
    }
    tryBind();
})();

const eventNpcMap = {
  // 汐见真帆
  妹妹深夜自慰事件: "汐见真帆",
  妹妹白天自慰事件: "汐见真帆",
  妹妹白丝舔足事件: "汐见真帆",
  妹妹丝袜足交事件: "汐见真帆",
  妹妹游戏惩罚事件: "汐见真帆",
  妹妹早安咬事件: "汐见真帆",
  妹妹漫展COS事件: "汐见真帆",
  妹妹性爱邀约事件: "汐见真帆",
  妹妹双人玩具事件: "汐见真帆",
  妹妹远程遥控事件: "汐见真帆",
  妹妹影院隐奸事件: "汐见真帆",
  妹妹内裤自慰事件: "汐见真帆",
  妹妹迅三人竞争事件: "汐见真帆",
  // 黑崎海斗
  海斗更衣室自慰事件: "黑崎海斗",
  海斗共同锻炼事件: "黑崎海斗",
  海斗教室勃起事件: "黑崎海斗",
  海斗汗臭吸引事件: "黑崎海斗",
  海斗睡觉误入事件: "黑崎海斗",
  海斗联谊装对象事件: "黑崎海斗",
  海斗后穴开发事件: "黑崎海斗",
  海斗性爱邀请事件: "黑崎海斗",
  海斗赛后拜访事件: "黑崎海斗",
  海斗擦药事件: "黑崎海斗",
  // 冰室纱耶
  老师约炮偶遇事件: "冰室纱耶",
  老师自慰发现事件: "冰室纱耶",
  老师跳蛋掉落事件: "冰室纱耶",
  老师私人补习事件: "冰室纱耶",
  老师温泉邀请事件: "冰室纱耶",
  老师约炮邀请事件: "冰室纱耶",
  老师共锁事件: "冰室纱耶",
  老师试纱事件: "冰室纱耶",
  老师触诊事件: "冰室纱耶",
  老师乳交事件: "冰室纱耶",
  // 风见迅
  快递错拿事件: "风见迅",
  迅共同上学事件: "风见迅",
  迅全裸守门事件: "风见迅",
  迅共同直播事件: "风见迅",
  迅直播配合事件: "风见迅",
  迅遛狗PLAY事件: "风见迅",
  迅远程遥控事件: "风见迅",
  迅硬挑事件: "风见迅",
  迅偷衣事件: "风见迅",
  迅足扰事件: "风见迅",
  迅身份发现事件: "风见迅",
  // 多人 / 其他
  海斗老师三人性爱事件: "多人",
  // 无特定 NPC 均映射为 '环境'
  忠实粉丝事件: "环境",
  电车之狼事件: "环境",
  夜间电车事件: "环境",
  厕所鸟洞事件: "环境",
  催眠按摩事件: "环境",
  梦中水仙事件: "环境",
  洗衣遗物事件: "环境",
  湿衣事件: "环境",
  引员事件: "环境",
  试镜事件: "环境",
};

// ---------- 工具函数 ----------
function getMvuInstance() {
  try {
    return window.Mvu || window.parent?.Mvu || window.top?.Mvu || null;
  } catch (e) {
    console.warn(`[${SCRIPT_NAME}] 访问MVU实例时出错:`, e);
    return null;
  }
}

/**
 * 判断是否寒假（1月15-2月15）或暑假（7月1-8月31）
 */
function getHoliday(month, day) {
  const mdd = month * 100 + day;
  if (mdd >= 115 && mdd <= 215) return "寒假";
  if (mdd >= 701 && mdd <= 831) return "暑假";
  return "否";
}

/**
 * 获取季节
 */
function getSeason(month) {
  if (month >= 3 && month <= 5) return "春";
  if (month >= 6 && month <= 8) return "夏";
  if (month >= 9 && month <= 11) return "秋";
  return "冬";
}

/**
 * 根据季节随机天气
 */
function generateWeather(season) {
  const r = Math.random();
  if (season === "冬") {
    if (r < 0.7) return "晴";
    if (r < 0.9) return "小雪";
    return "大雪";
  } else {
    if (r < 0.7) return "晴";
    if (r < 0.9) return "小雨";
    return "大雨";
  }
}

/**
 * 将待处理事件移入同名事件队列，防止覆盖
 */
function enqueueExistingEvent(variables, eventName) {
  const pending = _.get(variables, "stat_data.系统状态.待处理事件", {});
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
  _.set(variables, "stat_data.系统状态.事件等待处理中", true);
}

// ---------- 模块：日期与天气自动演进 ----------
function processDateTimeWeather(variables, prevData) {
  const curMonth = parseInt(_.get(variables.stat_data, "进程.当前月份", 10)) || 10;
  const curDay = parseInt(_.get(variables.stat_data, "进程.当前日份", 15)) || 15;
  const prevMonth = parseInt(_.get(prevData, "进程.当前月份", curMonth)) || curMonth;
  const prevDay = parseInt(_.get(prevData, "进程.当前日份", curDay)) || curDay;

  // 假期判定
  const holiday = getHoliday(curMonth, curDay);
  _.set(variables, "stat_data.进程.当前假期", holiday);

  // 日份变化时更新天气与周几
  if (curDay !== prevDay || curMonth !== prevMonth) {
    const curYear = parseInt(_.get(variables.stat_data, "进程.当前年份", 2025)) || 2025;
    const date = new Date(curYear, curMonth - 1, curDay);
    var w = date.getDay();
    w = w === 0 ? 7 : w;
    _.set(variables, "stat_data.进程.当前周几", w);

    const season = getSeason(curMonth);
    const weather = generateWeather(season);
    _.set(variables, "stat_data.进程.当前天气", weather);

    if (weather === "大雨") { pushEvent(variables, "今日大雨事件", true); }
    else if (weather === "大雪") { pushEvent(variables, "今日大雪事件", true); }

    const prevSeason = getSeason(prevMonth);
    const curSeason = getSeason(curMonth);
    if (prevSeason !== curSeason) {
      var changeMap = { 冬春: "冬到春", 春夏: "春到夏", 夏秋: "夏到秋", 秋冬: "秋到冬" };
      var eventVal = changeMap[prevSeason + curSeason];
      if (eventVal) { pushEvent(variables, "季节变换事件", eventVal); }
    }
  }
}

// ---------- 模块：社交媒体每日动态推送 ----------
function processSocialMedia(variables, prevData) {
  const curDay = (parseInt(_.get(variables.stat_data, "进程.当前日份", 15)) || 15);
  const curMonth = (parseInt(_.get(variables.stat_data, "进程.当前月份", 10)) || 10);
  const curYear = (parseInt(_.get(variables.stat_data, "进程.当前年份", 2025)) || 2025);
  const prevDay = (parseInt(_.get(prevData, "进程.当前日份", curDay)) || curDay);
  const prevMonth = (parseInt(_.get(prevData, "进程.当前月份", curMonth)) || curMonth);
  if (curDay === prevDay && curMonth === prevMonth) return;

  const dateStr = curYear + "年" + curMonth + "月" + curDay + "日";
  const slot = _.get(variables.stat_data, "进程.当前时段", "晚上");
  const sm = _.get(variables.stat_data, "社交媒体", {});
  const missing = [];
  Object.keys(sm).forEach(function(name) {
    var list = _.get(sm[name], "动态列表", []);
    if (!Array.isArray(list)) list = [];
    if (list.length === 0) { missing.push(name); return; }
    if (list[list.length - 1].日期 !== dateStr) { missing.push(name); }
  });
  if (missing.length > 0) {
    pushEvent(variables, "社交媒体更新事件", missing);
    console.log("[露出直播监控] 社交媒体缺失动态: " + missing.join(", "));
  }
}

// ---------- 模块：数组维护与标签修复 ----------
/**
 * 数组维护：纠错、补回 extensible 标签（保留重复项，适用于弹幕等允许重复的数组）
 */
function maintainExtensibleArrays(variables) {
  const targetPaths = [
    "直播状态.当前直播间弹幕", // 弹幕非常需要不去重
    "直播状态.当前直播间标签",
    "主角.当前状态.当前性行为",
    "主角.道具栏.已购道具列表",
  ];

  targetPaths.forEach((path) => {
    let arr = _.get(variables.stat_data, path);

    // 1. 类型纠错：如果被 AI 写成了非数组，强制转为数组
    if (!Array.isArray(arr)) {
      arr = arr ? [arr] : [];
    }

    // 2. 仅清理冗余/错位的标签，保留所有内容（不去重）
    const cleanArr = arr.filter((item) => item !== "$__META_EXTENSIBLE__$");

    // 3. 补回可扩展标签到末尾
    cleanArr.push("$__META_EXTENSIBLE__$");

    // 4. 变更检测
    if (!_.isEqual(arr, cleanArr)) {
      _.set(variables, `stat_data.${path}`, cleanArr);
    }
  });
}

// ---------- 模块：阶段切换监测 ----------
function processPhaseSwitch(variables, prevData) {
  const prevStreaming = _.get(prevData, "直播状态.是否正在直播", false);
  const curStreaming = _.get(
    variables.stat_data,
    "直播状态.是否正在直播",
    false,
  );

  // 从 false -> true: 进入直播阶段
  if (!prevStreaming && curStreaming) {
    _.set(variables, "stat_data.进程.阶段", "直播阶段");
    const curTurn = _.get(variables, "stat_data.进程.当前回合数", 0);
    _.set(variables, "stat_data.直播状态.当前直播开始回合", curTurn);
    console.log(
      `[露出直播监控] 检测到开播，阶段切换为直播阶段，开始回合：${curTurn}`,
    );
  }

  // 从 true -> false: 关播触发，阶段切回日常
  if (prevStreaming && !curStreaming) {
    const curSett = _.get(variables.stat_data, "系统状态.待处理事件.直播结算事件", undefined);
    // 如果结算事件已被世界书处理完毕（消失），说明关播流程走完了
    if (curSett === undefined) {
      _.set(variables, "stat_data.进程.阶段", "日常阶段");
      // 重置直播间数据
      _.set(variables, "stat_data.直播状态.当前直播间人数", 0);
      _.set(variables, "stat_data.直播状态.当前直播间热度", 0);
      _.set(variables, "stat_data.直播状态.当次直播高潮次数", 0);
      _.set(variables, "stat_data.直播状态.当前直播间标题", "");
      _.set(variables, "stat_data.直播状态.当前直播间标签", []);
      _.set(variables, "stat_data.直播状态.当前直播开始回合", 0);
      _.set(variables, "stat_data.直播状态.当前直播间弹幕", []);
      console.log("[露出直播监控] 检测到关播，阶段切换为日常阶段并重置临时数据");
    }
  }

  // 直播结算事件从有变无：阶段切回日常，重置直播临时数据
  const prevSettlement = _.get(
    prevData,
    "系统状态.待处理事件.直播结算事件",
    undefined,
  );
  const curSettlement = _.get(
    variables.stat_data,
    "系统状态.待处理事件.直播结算事件",
    undefined,
  );
  console.log(
    `[露出直播监控] 阶段切换查看，${prevSettlement} + ${curSettlement}`,
  );
  if (prevSettlement !== undefined && curSettlement === undefined) {
    const heat = _.get(variables.stat_data, "直播状态.当前直播间热度", 0) || 0;
    const shameReduce = Math.floor(Math.random() * 6) + 5; // 5～10
    const currentShame =
      parseInt(_.get(variables.stat_data, "主角.当前状态.羞耻度", 100)) || 100;
    const newShame = Math.max(0, currentShame - shameReduce);
    _.set(variables, "stat_data.主角.当前状态.羞耻度", newShame);
    console.log(
      `[露出直播监控] 直播结算，热度 ${heat}，羞耻度 -${shameReduce} → ${newShame}`,
    );
    const prevCount =
      parseInt(_.get(variables.stat_data, "主角.主播信息.直播总次数", 0)) || 0;
    _.set(variables, "stat_data.主角.主播信息.直播总次数", prevCount + 1);
    _.set(variables, "stat_data.进程.阶段", "日常阶段");
    // 重置直播间数据
    _.set(variables, "stat_data.直播状态.当前直播间人数", 0);
    _.set(variables, "stat_data.直播状态.当前直播间热度", 0);
    _.set(variables, "stat_data.直播状态.当次直播高潮次数", 0);
    _.set(variables, "stat_data.直播状态.当前直播间标题", "");
    _.set(variables, "stat_data.直播状态.当前直播间标签", []);
    _.set(variables, "stat_data.直播状态.当前直播开始回合", 0);
    _.set(variables, "stat_data.直播状态.当前直播间弹幕", []);
    console.log(
      "[露出直播监控] 直播结算完成，阶段切换为日常阶段并重置临时数据",
    );
  }
}

// ---------- 模块：日常阶段事件随机推送 (需求4,5,6) ----------
function processEventPush(variables, prevData) {
  const phase = _.get(variables.stat_data, "进程.阶段", "日常阶段");
  if (phase !== "日常阶段") return;

  const isStreaming = _.get(
    variables.stat_data,
    "直播状态.是否正在直播",
    false,
  );
  if (isStreaming) return;

  const sexActs = _.get(variables.stat_data, "主角.当前状态.当前性行为", []);
  if (Array.isArray(sexActs) && sexActs.length > 0) return;

  const eventWaiting = _.get(
    variables.stat_data,
    "系统状态.事件等待处理中",
    false,
  );

  const randValue = Math.random();
  const prob = scriptState.eventProb;

  console.log(
    `[露出直播监控] 随机推送事件监测: ${eventWaiting} + ${randValue} vs ${prob}`,
  );

  // 递增概率推送一个随机事件
  if (
    !eventWaiting &&
    randValue < prob
  ) {
    const eventCounters = _.get(variables.stat_data, "进程.事件计数", {});
    const eventKeys = Object.keys(eventCounters);

    // 过滤掉当前条件不满足的特殊事件
    const makoto = variables.stat_data?.NPC数据?.汐见真帆 || {};
    const kaido = variables.stat_data?.NPC数据?.黑崎海斗 || {};
    const saya = variables.stat_data?.NPC数据?.冰室纱耶 || {};
    const jin = variables.stat_data?.NPC数据?.风见迅 || {};

    const filteredKeys = eventKeys.filter((key) => {
      // 原有秘密发现限制
      if (
        key === "妹妹双人玩具事件" ||
        key === "妹妹远程遥控事件" ||
        key === "妹妹影院隐奸事件"
      ) {
        return _.get(makoto, "秘密发现", false);
      }
      if (key === "迅共同直播事件" || key === "迅直播配合事件") {
        return jin.秘密发现 && parseInt(jin.疑心 || 0) >= 100;
      }
      if (key === "迅遛狗PLAY事件" || key === "迅远程遥控事件") {
        return _.get(jin, "秘密发现", false);
      }
      if (key === "迅共同上学事件") {
        return !_.get(jin, "秘密发现", false);
      }

      // 新增数值门槛

      // 汐见真帆
      if (
        key === "妹妹白丝舔足事件" ||
        key === "妹妹丝袜足交事件" ||
        key === "妹妹早安咬事件"
      ) {
        return (parseInt(makoto.淫乱度) || 0) >= 25;
      }
      if (key === "妹妹性爱邀约事件") {
        return (parseInt(makoto.淫乱度) || 0) >= 50;
      }
      if (key === "妹妹迅三人竞争事件") {
        return (parseInt(makoto.淫乱度) || 0) >= 75;
      }

      // 黑崎海斗
      if (
        key === "海斗教室勃起事件" ||
        key === "海斗汗臭吸引事件" ||
        key === "海斗睡觉误入事件" ||
        key === "海斗赛后拜访事件"
      ) {
        return (parseInt(kaido.淫乱度) || 0) >= 25;
      }
      if (
        key === "海斗联谊装对象事件" ||
        key === "海斗后穴开发事件" ||
        key === "海斗性爱邀请事件"
      ) {
        return (parseInt(kaido.淫乱度) || 0) >= 50;
      }

      // 冰室纱耶
      if (key === "老师约炮偶遇事件" || key === "老师私人补习事件") {
        return (parseInt(saya.好感度) || 0) >= 25;
      }
      if (key === "老师约炮邀请事件") {
        return (parseInt(saya.好感度) || 0) >= 50;
      }
      if (key === "老师共锁事件") {
        return (parseInt(saya.淫乱度) || 0) >= 50;
      }
      if (key === "老师试纱事件") {
        return (parseInt(saya.好感度) || 0) >= 75 && (parseInt(saya.疑心) || 0) >= 25;
      }
      if (key === "老师触诊事件") {
        return (parseInt(saya.淫乱度) || 0) >= 25 && (parseInt(saya.好感度) || 0) >= 25;
      }

      // 风见迅
      if (key === "迅全裸守门事件") {
        return (
          (parseInt(jin.好感度) || 0) >= 25 && (parseInt(jin.淫乱度) || 0) >= 25
        );
      }
      if (key === "迅硬挑事件") {
        return (parseInt(jin.淫乱度) || 0) >= 50;
      }
      if (key === "迅足扰事件") {
        return (parseInt(jin.淫乱度) || 0) >= 50;
      }
      if (key === "迅偷衣事件") {
        return (parseInt(jin.淫乱度) || 0) >= 25 && _.get(jin, "秘密发现", false);
      }
      if (key === "迅身份发现事件") {
        return (parseInt(eventCounters["快递错拿事件"] || 0) >= 1 &&
                parseInt(eventCounters["迅共同上学事件"] || 0) >= 1 &&
                !_.get(jin, "秘密发现", false));
      }

      // 多 NPC
      if (key === "海斗老师三人性爱事件") {
        return (parseInt(kaido.淫乱度) || 0) >= 50;
      }

      return true;
    });

    // 根据上次触发的 NPC 再次过滤，避免连续同角色事件
    let selectedKeys = [...filteredKeys];
    if (scriptState.lastNpcEvent && filteredKeys.length > 1) {
      const avoidKeys = filteredKeys.filter((key) => {
        const npc = eventNpcMap[key] || "环境";
        return npc !== scriptState.lastNpcEvent;
      });
      if (avoidKeys.length > 0) {
        selectedKeys = avoidKeys;
      }
    }

    // 优先“首次发现秘密”事件（零次计数）
    const discoveryEvents = [
      "妹妹深夜自慰事件",
      "妹妹白天自慰事件",
      "老师约炮偶遇事件",
      "教师跳蛋掉落事件",
      "老师自慰发现事件",
      "快递错拿事件",
      "迅共同上学事件",
      "迅身份发现事件",
    ];
    const zeroCountDiscovery = discoveryEvents.filter((key) => {
      return selectedKeys.includes(key) && (eventCounters[key] || 0) === 0;
    });

    let chosen;
    if (zeroCountDiscovery.length > 0 && Math.random() < 0.6) {
      chosen =
        zeroCountDiscovery[
          Math.floor(Math.random() * zeroCountDiscovery.length)
        ];
    } else if (selectedKeys.length > 0) {
      chosen = selectedKeys[Math.floor(Math.random() * selectedKeys.length)];
    } else {
      // 最终没有可用事件，概率重置并退出
      scriptState.eventProb = 0.1;
      return;
    }

    console.log(
      `[露出直播监控] 随机推送事件: ${chosen} (概率 ${prob.toFixed(2)})`,
    );
    pushEvent(variables, chosen, true);
    scriptState.eventProb = 0.1; // 触发后重置概率

    // 记录本次触发的 NPC 名
    scriptState.lastNpcEvent = eventNpcMap[chosen] || "环境";
  } else {
    scriptState.eventProb = Math.min(scriptState.eventProb + 0.05, 0.5);
    console.log(
      `[露出直播监控] 随机事件未触发，概率累计至 ${scriptState.eventProb.toFixed(2)}`,
    );
  }

  // 处理队列：如果当前无待处理事件，从同名事件队列中取一个
  const pending = _.get(variables.stat_data, "系统状态.待处理事件", {});
  if (Object.keys(pending).length === 0) {
    let found = false;
    const queues = _.get(variables.stat_data, "系统状态.同名事件队列", {});
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
      } else if (value && typeof value !== "object") {
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
      _.set(variables, "stat_data.系统状态.事件等待处理中", false);
    }
  }

  // 事件计数增加：监测从有变无的事件
  const prevPending = _.get(prevData, "系统状态.待处理事件", {});
  const curPending = _.get(variables.stat_data, "系统状态.待处理事件", {});
  const eventCounters = _.get(variables.stat_data, "进程.事件计数", {});
  for (const key of Object.keys(prevPending)) {
    if (!_.has(curPending, key)) {
      // 此事件被移除了
      if (_.has(eventCounters, key)) {
        const oldVal =
          parseInt(_.get(variables.stat_data, `进程.事件计数.${key}`, 0)) || 0;
        _.set(variables, `stat_data.进程.事件计数.${key}`, oldVal + 1);
        console.log(`[露出直播监控] 事件计数+1: ${key} --> ${oldVal + 1}`);
      }
    }
  }
}

function processLewdIncreaseOnSexCount(variables, prevData) {
  const expPath = "主角.性经验记录";
  const currentExp = _.get(variables.stat_data, expPath, {});
  const previousExp = _.get(prevData, expPath, {});

  // 非插入行为：每+1 → 淫乱度+5
  const nonPenetrationFields = [
    "自慰次数",
    "情趣玩具使用次数",
    "主动手交次数",
    "被动手交次数",
    "主动足交次数",
    "被动足交次数",
    "主动口交次数",
    "被动口交次数",
    "被动乳交次数",
  ];
  // 插入行为：每+1 → 淫乱度+10
  const penetrationFields = [
    "小穴插入性爱次数",
    "后穴插入性爱次数",
    "后穴性爱次数",
  ];

  let totalIncrease = 0;

  const processFields = (fields, increment) => {
    fields.forEach((field) => {
      const prev = parseInt(_.get(previousExp, field, 0)) || 0;
      const cur = parseInt(_.get(currentExp, field, 0)) || 0;
      const diff = cur - prev;
      if (diff > 0) {
        totalIncrease += diff * increment;
        console.log(
          `[露出直播监控] 性行为 ${field} 次数增加 +${diff} → 淫乱度 +${diff * increment}`,
        );
      }
    });
  };

  processFields(nonPenetrationFields, 5);
  processFields(penetrationFields, 10);

  if (totalIncrease > 0) {
    const currentLewd =
      parseInt(_.get(variables.stat_data, "主角.当前状态.淫乱度", 0)) || 0;
    const newLewd = Math.min(100, currentLewd + totalIncrease);
    _.set(variables, "stat_data.主角.当前状态.淫乱度", newLewd);
    console.log(`[露出直播监控] 淫乱度总计 +${totalIncrease} → ${newLewd}`);
  }
}

// ---------- 模块：NPC淫乱度自动增长 ----------
function processNpcLewdIncrease(variables, prevData) {
  const prevNpc = _.get(prevData, 'NPC数据', {});
  const curNpc = _.get(variables.stat_data, 'NPC数据', {});

  // A. 性行为次数变化：与主角做爱次数每 +1 → 淫乱度 +15
  Object.keys(curNpc).forEach(function(name) {
    const prevCount = parseInt(_.get(prevNpc, name + '.与主角做爱次数', 0)) || 0;
    const curCount = parseInt(_.get(curNpc, name + '.与主角做爱次数', 0)) || 0;
    if (curCount > prevCount) {
      const curLewd = parseInt(_.get(curNpc, name + '.淫乱度', 0)) || 0;
      const delta = (curCount - prevCount) * 15;
      _.set(variables, 'stat_data.NPC数据.' + name + '.淫乱度', Math.min(100, curLewd + delta));
      console.log('[' + SCRIPT_NAME + '] NPC淫乱度: ' + name + ' +' + delta + ' (性行为' + (curCount - prevCount) + '次) → ' + Math.min(100, curLewd + delta));
    }
  });

  // B. NPC特殊事件落幕：事件标记被移除 → 淫乱度 +5
  const prevEvents = _.get(prevData, '系统状态.待处理事件', {});
  const curEvents = _.get(variables.stat_data, '系统状态.待处理事件', {});
  Object.keys(eventNpcMap).forEach(function(evtKey) {
    if (_.has(prevEvents, evtKey) && !_.has(curEvents, evtKey)) {
      var npcName = eventNpcMap[evtKey];
      if (npcName && npcName !== '环境') {
        const curLewd = parseInt(_.get(curNpc, npcName + '.淫乱度', 0)) || 0;
        _.set(variables, 'stat_data.NPC数据.' + npcName + '.淫乱度', Math.min(100, curLewd + 5));
        console.log('[' + SCRIPT_NAME + '] NPC淫乱度: ' + npcName + ' +5 (事件结束: ' + evtKey + ') → ' + Math.min(100, curLewd + 5));
      }
    }
  });
}

// ---------- 模块：各种跨越阶段事件监测 (需求7) ----------
function processThresholdEvents(variables, prevData) {
  const prevStats = prevData || {};

  console.log(`[processThresholdEvents] previousData 关键值:`, {
    羞耻度: _.get(prevData, "主角.当前状态.羞耻度"),
    淫乱度: _.get(prevData, "主角.当前状态.淫乱度"),
    直播总次数: _.get(prevData, "主角.主播信息.直播总次数"),
    粉丝数: _.get(prevData, "主角.主播信息.粉丝数"),
    开发度: _.get(prevData, "主角.开发度"),
    NPC好感度: _.mapValues(_.get(prevData, "NPC数据", {}), (n) => n.好感度),
    NPC淫乱度: _.mapValues(_.get(prevData, "NPC数据", {}), (n) => n.淫乱度),
    NPC察觉程度: _.mapValues(
      _.get(prevData, "NPC数据", {}),
      (n) => n.疑心,
    ),
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
    胸部: "主角.开发度.胸部开发度",
    肉棒: "主角.开发度.肉棒开发度",
    后穴: "主角.开发度.后穴开发度",
  };
  const devStages = [3, 6, 10]; // 初步/中度/深度
  for (const [partLabel, path] of Object.entries(devPaths)) {
    const prev = parseInt(_.get(prevStats, path, 0)) || 0;
    const cur = parseInt(_.get(variables.stat_data, path, 0)) || 0;
    const crossings = checkThreshold(prev, cur, devStages);
    for (const t of crossings) {
      pushEvent(variables, "身体开发度升级事件", partLabel);
      console.log(`[露出直播监控] 开发度升级: ${partLabel} 跨越 ${t}`);
    }
  }

  // 2. 羞耻度 (下降跨越 75,50,25)
  const shamePrev =
    parseInt(_.get(prevStats, "主角.当前状态.羞耻度", 100)) || 100;
  const shameCur =
    parseInt(_.get(variables.stat_data, "主角.当前状态.羞耻度", 100)) || 100;
  const shameStages = [75, 50, 25];
  for (const t of shameStages) {
    if (shamePrev >= t && shameCur < t) {
      pushEvent(variables, "羞耻度升级事件", true);
      console.log(`[露出直播监控] 羞耻度下降跨越 ${t}`);
    }
  }

  // 3. 淫乱度 (上升跨越 25,50,75)
  const lewdPrev = parseInt(_.get(prevStats, "主角.当前状态.淫乱度", 0)) || 0;
  const lewdCur =
    parseInt(_.get(variables.stat_data, "主角.当前状态.淫乱度", 0)) || 0;
  const lewdStages = [25, 50, 75];
  for (const t of lewdStages) {
    if (lewdPrev < t && lewdCur >= t) {
      pushEvent(variables, "淫乱度升级事件", true);
      console.log(`[露出直播监控] 淫乱度上升跨越 ${t}`);
    }
  }

  // 4. NPC淫乱度升级
  const npcData = variables.stat_data?.NPC数据 || {};
  const prevNpcData = prevStats?.NPC数据 || {};
  const npcLewdStages = [25, 50, 75];
  const upgradedNpcsLewd = [];
  for (const npcName of Object.keys(npcData)) {
    const prevNpcLewd =
      parseInt(_.get(prevNpcData, `${npcName}.淫乱度`, 0)) || 0;
    const curNpcLewd = parseInt(_.get(npcData, `${npcName}.淫乱度`, 0)) || 0;
    const crossed = npcLewdStages.some(
      (t) => prevNpcLewd < t && curNpcLewd >= t,
    );
    if (crossed) {
      upgradedNpcsLewd.push(npcName);
    }
  }
  if (upgradedNpcsLewd.length > 0) {
    pushEvent(variables, "NPC淫乱度升级事件", upgradedNpcsLewd);
    console.log(`[露出直播监控] NPC淫乱度升级: ${upgradedNpcsLewd.join(", ")}`);
  }

  // 5. NPC好感度升级 (阈值 25,50,75)
  const npcAffStages = [25, 50, 75];
  const upgradedNpcsAff = [];
  for (const npcName of Object.keys(npcData)) {
    const prevAff = parseInt(_.get(prevNpcData, `${npcName}.好感度`, 0)) || 0;
    const curAff = parseInt(_.get(npcData, `${npcName}.好感度`, 0)) || 0;
    const crossed = npcAffStages.some((t) => prevAff < t && curAff >= t);
    if (crossed) {
      upgradedNpcsAff.push(npcName);
    }
  }
  if (upgradedNpcsAff.length > 0) {
    pushEvent(variables, "NPC好感度升级事件", upgradedNpcsAff);
    console.log(`[露出直播监控] NPC好感度升级: ${upgradedNpcsAff.join(", ")}`);
  }

  // 6. 秘密暴露 (察觉程度 >=90)
  for (const npcName of Object.keys(npcData)) {
    const prevSus =
      parseInt(_.get(prevNpcData, `${npcName}.疑心`, 0)) || 0;
    const curSus = parseInt(_.get(npcData, `${npcName}.疑心`, 0)) || 0;
    if (prevSus < 90 && curSus >= 90) {
      pushEvent(variables, "秘密暴露事件", npcName);
      console.log(`[露出直播监控] 秘密暴露: ${npcName}`);
    }
  }

  // 7. 直播态度变化 (总次数跨越 1,4,7,10)
  const prevStreamCount =
    parseInt(_.get(prevStats, "主角.主播信息.直播总次数", 0)) || 0;
  const curStreamCount =
    parseInt(_.get(variables.stat_data, "主角.主播信息.直播总次数", 0)) || 0;
  const streamThresholds = [1, 4, 7, 10];
  for (const t of streamThresholds) {
    if (prevStreamCount < t && curStreamCount >= t) {
      pushEvent(variables, "直播态度变化事件", true);
      console.log(`[露出直播监控] 直播态度变化 (总次数跨越 ${t})`);
      break; // 一次变化只触发一次
    }
  }

  // 8. 粉丝里程碑 (主角)
  const prevFans = parseInt(_.get(prevStats, "主角.主播信息.粉丝数", 0)) || 0;
  const curFans =
    parseInt(_.get(variables.stat_data, "主角.主播信息.粉丝数", 0)) || 0;
  const fanMilestones = [100, 500, 2000, 10000, 100000, 1000000];
  for (const m of fanMilestones) {
    if (prevFans < m && curFans >= m) {
      pushEvent(variables, "粉丝里程碑事件", String(m));
      console.log(`[露出直播监控] 粉丝里程碑: ${m}`);
      break;
    }
  }

  // 9. 迅的人气分享 (风见迅粉丝里程碑)
  const prevJinFans =
    parseInt(_.get(prevNpcData, "风见迅.主播信息.粉丝数", 0)) || 0;
  const curJinFans = parseInt(_.get(npcData, "风见迅.主播信息.粉丝数", 0)) || 0;
  const jinMilestones = [100, 500, 2000, 10000, 100000, 1000000];
  for (const m of jinMilestones) {
    if (prevJinFans < m && curJinFans >= m) {
      pushEvent(variables, "人气分享事件", String(m));
      console.log(`[露出直播监控] 迅的人气分享: 突破${m}粉丝`);
      break;
    }
  }

  // 10. NPC性爱次数里程碑（每3次推送身体开发事件）
  Object.keys(npcData).forEach((name) => {
    const curCount = parseInt(_.get(npcData, `${name}.与主角做爱次数`, 0)) || 0;
    const prevCount =
      parseInt(_.get(prevNpcData, `${name}.与主角做爱次数`, 0)) || 0;
    if (curCount > 0 && curCount % 3 === 0 && curCount > prevCount) {
      pushEvent(variables, "NPC身体开发事件", name);
      console.log(
        `[露出直播监控] ${name} 性爱次数达到 ${curCount}，推送身体开发事件`,
      );
    }
  });
}

// ---------- 模块：直播结束记录最高数据 (需求9) ----------
function processStreamEndRecords(variables, prevData) {
  const prevStreaming = _.get(prevData, "直播状态.是否正在直播", false);
  const curStreaming = _.get(
    variables.stat_data,
    "直播状态.是否正在直播",
    false,
  );
  if (!prevStreaming || curStreaming) return; // 不是从true变false则跳过

  const curViewers =
    parseInt(_.get(variables.stat_data, "直播状态.当前直播间人数", 0)) || 0;
  const curClimax =
    parseInt(_.get(variables.stat_data, "直播状态.当次直播高潮次数", 0)) || 0;
  const peakViewers =
    parseInt(_.get(variables.stat_data, "主角.主播信息.单次直播最高人数", 0)) ||
    0;
  const peakClimax =
    parseInt(
      _.get(variables.stat_data, "主角.主播信息.单次直播最高高潮次数", 0),
    ) || 0;

  if (curViewers > peakViewers) {
    _.set(variables, "stat_data.主角.主播信息.单次直播最高人数", curViewers);
    console.log(`[露出直播监控] 更新最高在线人数: ${curViewers}`);
  }
  if (curClimax > peakClimax) {
    _.set(variables, "stat_data.主角.主播信息.单次直播最高高潮次数", curClimax);
    console.log(`[露出直播监控] 更新单次直播最高高潮次数: ${curClimax}`);
  }
}

// ---------- 模块：主角粉丝增长联动迅粉丝数 (需求10) ----------
function processFanSyncToJin(variables, prevData) {
  const prevFans = parseInt(_.get(prevData, "主角.主播信息.粉丝数", 0)) || 0;
  const curFans =
    parseInt(_.get(variables.stat_data, "主角.主播信息.粉丝数", 0)) || 0;
  if (curFans > prevFans) {
    const delta = curFans - prevFans;
    const coef = 0.8 + Math.random() * 0.3; // 0.8 ~ 1.1
    const jinGain = Math.floor(delta * coef);
    if (jinGain > 0) {
      const curJinFans =
        parseInt(
          _.get(variables.stat_data, "NPC数据.风见迅.主播信息.粉丝数", 0),
        ) || 0;
      _.set(
        variables,
        "stat_data.NPC数据.风见迅.主播信息.粉丝数",
        curJinFans + jinGain,
      );
      console.log(
        `[露出直播监控] 主角粉丝+${delta}，迅粉丝同步增加 ${jinGain} (系数${coef.toFixed(2)})`,
      );
    }
  }
}

// ---------- PRE-生成：用户指令预解析 ----------
function onBeforeGeneration() {
    var cached = window.top.__IDF_LAST_STREAM_INPUT;
    if (!cached || !cached.trim()) {
        console.info('[' + SCRIPT_NAME + '] PRE-GEN: 缓存为空，跳过');
        return;
    }
    window.top.__IDF_LAST_STREAM_INPUT = '';
    var text = cached;
    var lastLine = text.split('\n').pop().trim();
    console.info('[' + SCRIPT_NAME + '] PRE-GEN 收到(len=' + text.length + '): ' + text.slice(0, 120));
    console.info('[' + SCRIPT_NAME + '] PRE-GEN lastLine: ' + lastLine.slice(0, 80));

    // 关播指令
    var endMatch = text.match(/(关播|结束直播|下播)/);

    // 直播人数增长（移到 pre-generation，AI 生成时看到的就是最新数据）
    try {
        var vars = getVariables({ type: 'message', message_id: 'latest' });
        var isLv = _.get(vars, 'stat_data.直播状态.是否正在直播', false);
        var lvPhase = _.get(vars, 'stat_data.进程.阶段', '');
        if (isLv && lvPhase === '直播阶段') {
            var prevV = parseInt(_.get(vars, 'stat_data.直播状态.当前直播间人数', 0)) || 0;
            var curH = parseInt(_.get(vars, 'stat_data.直播状态.当前直播间热度', 0)) || 0;
            var d = Math.floor((8 + curH * 2.5 + prevV * 0.08) * (0.8 + Math.random() * 0.4));
            _.set(vars, 'stat_data.直播状态.当前直播间人数', Math.max(0, prevV + d));
            replaceVariables(vars, { type: 'message', message_id: 'latest' });
            console.log('[' + SCRIPT_NAME + '] 直播人数更新: ' + prevV + ' -> ' + (prevV + d) + ' (delta:' + d + ')');
        }
    } catch (e) { console.error('[' + SCRIPT_NAME + '] 直播人数预更新失败:', e); }

    // 关播指令
    var endMatch = text.match(/(关播|结束直播|下播)/);
    if (endMatch) {
        console.info('[' + SCRIPT_NAME + '] 预解析: 关播');
        try {
            var vars = getVariables({ type: 'message', message_id: 'latest' });
            _.set(vars, 'stat_data.直播状态.是否正在直播', false);
            _.set(vars, 'stat_data.系统状态.待处理事件.直播结算事件', true);
            replaceVariables(vars, { type: 'message', message_id: 'latest' });
            if (window.toastr) toastr.success('直播已结束，结算中');
        } catch (e) {
            console.error('[' + SCRIPT_NAME + '] 关播变量写入失败:', e);
        }
        return;
    }

    // 休整指令: 休整，天数:N，
    var restMatch = lastLine.match(/休整[，,]\s*天数[：:]\s*(\d+)/);
    if (restMatch) {
        var restDays = parseInt(restMatch[1]) || 1;
        restDays = Math.min(Math.max(restDays, 1), 30);
        console.info('[' + SCRIPT_NAME + '] 休整: ' + restDays + '天');
        try {
            var vars = getVariables({ type: 'message', message_id: 'latest' });
            _.set(vars, 'stat_data.系统状态.待处理事件.休整事件', { 跳过天数: restDays });
            replaceVariables(vars, { type: 'message', message_id: 'latest' });
            if (window.toastr) toastr.success('休整 ' + restDays + ' 天');
        } catch (e) { console.error('[' + SCRIPT_NAME + '] 休整失败:', e); }
        return;
    }

    // 房产购买指令: 购买房产类物品：xxx（xxx），同居:[NPC]+[NPC]，
    var houseMatch = lastLine.match(/^购买房产类物品：(.+?)（(.+?)），同居:(.+?)[，,]/);
    if (houseMatch) {
        var houseName = houseMatch[1].trim();
        var houseDesc = houseMatch[2].trim();
        var cohabitants = houseMatch[3].split('+').map(function(s){return s.trim();}).filter(Boolean);
        console.info('[' + SCRIPT_NAME + '] 购买房产: ' + houseName + ' → 同居: ' + cohabitants.join(','));
        try {
            var vars = getVariables({ type: 'message', message_id: 'latest' });
            var oldHome = _.get(vars, 'stat_data.主角.住所', {});
            _.set(vars, 'stat_data.主角.住所.名字', houseName);
            _.set(vars, 'stat_data.主角.住所.描述', houseDesc);
            _.set(vars, 'stat_data.系统状态.待处理事件.购置房产事件', {
                房产: houseName, 描述: houseDesc, 同居NPC: cohabitants, 旧住所: oldHome
            });
            replaceVariables(vars, { type: 'message', message_id: 'latest' });
            if (window.toastr) toastr.success('已购置: ' + houseName);
        } catch (e) { console.error('[' + SCRIPT_NAME + '] 房产购买失败:', e); }
        return;
    }

    // 购买指令: 支持多行购买
    var buyRe = /购买(上衣|下衣|内衣|袜子|鞋子|套装|COS服|配饰|道具|家居)类物品：(.+?)（(.+?)）[，,]/g;
    var CAT_BASE = {
        '上衣': '主角.衣橱.上衣', '下衣': '主角.衣橱.下衣',
        '内衣': '主角.衣橱.内衣', '袜子': '主角.衣橱.袜子',
        '鞋子': '主角.衣橱.鞋子', '套装': '主角.衣橱.套装',
        'COS服': '主角.衣橱.COS服', '配饰': '主角.衣橱.配饰',
        '道具': '主角.道具栏.已购道具列表', '家居': '主角.家居布置'
    };
    var buyMatch, hasBuy = false;
    var vars = null;
    while ((buyMatch = buyRe.exec(text)) !== null) {
        hasBuy = true;
        var itemCat = buyMatch[1];
        var itemName = buyMatch[2].trim();
        var itemDesc = buyMatch[3].trim();
        var basePath = CAT_BASE[itemCat];
        if (basePath) {
            console.info('[' + SCRIPT_NAME + '] 购买: ' + itemName + ' → ' + itemCat);
            if (!vars) vars = getVariables({ type: 'message', message_id: 'latest' });
            var arr = _.get(vars, 'stat_data.' + basePath, []);
            if (!Array.isArray(arr)) arr = [];
            arr.push(itemName);
            _.set(vars, 'stat_data.' + basePath, arr);
        }
    }
    if (hasBuy) {
        replaceVariables(vars, { type: 'message', message_id: 'latest' });
        if (window.toastr) toastr.success('购买完成');
        return;
    }

    // 开播指令: 开播，地点:xxx·xxx，时段:xxx，穿着:xxx，道具:xxx，联动:xxx，
    var streamMatch = lastLine.match(/开播，/);
    console.info('[' + SCRIPT_NAME + '] 开播匹配: ' + !!streamMatch);
    if (streamMatch) {
        var locMatch = lastLine.match(/地点:([^，]+)/);
        var slotMatch = lastLine.match(/时段:([^，]+)/);
        var wearMatch = lastLine.match(/穿着:([^，]+)/);
        var propMatch = lastLine.match(/道具:([^，]+)/);
        var collabMatch = lastLine.match(/联动:([^，]+)/);
        var eventData = {
            类型: '开播准备事件',
            地点: locMatch ? locMatch[1] : '',
            时段: slotMatch ? slotMatch[1] : '',
            穿着: wearMatch ? wearMatch[1] : '',
            道具: propMatch ? propMatch[1].split('+').map(function(s){return s.trim();}).filter(Boolean) : [],
            联动: collabMatch ? collabMatch[1].split('+').map(function(s){return s.trim();}).filter(Boolean) : []
        };
        console.info('[' + SCRIPT_NAME + '] 预解析: 开播 → ' + JSON.stringify(eventData));
        try {
            var vars = getVariables({ type: 'message', message_id: 'latest' });
            console.info('[' + SCRIPT_NAME + '] getVariables 成功');
            _.set(vars, 'stat_data.系统状态.待处理事件.开播准备事件', eventData);
            replaceVariables(vars, { type: 'message', message_id: 'latest' });
            console.info('[' + SCRIPT_NAME + '] replaceVariables 成功');
            if (window.toastr) toastr.success('开播准备中: ' + (eventData.地点 || ''));
        } catch (e) { console.error('[' + SCRIPT_NAME + '] 开播解析失败:', e); }
        return;
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
    return;
  }

  // 仅 AI 输出触发后续处理
  var isAssistant = false;
  try {
    var chat = SillyTavern.getContext().chat;
    if (Array.isArray(chat) && chat.length > 0) {
      var lm = chat[chat.length - 1];
      isAssistant = lm && (lm.role === 'assistant' || lm.is_user === false);
    }
  } catch (e) {}
  if (!isAssistant) {
    scriptState.previousData = _.cloneDeep(variables.stat_data);
    return;
  }

  const curTurn = _.get(variables.stat_data, "进程.当前回合数", 0);

  // 回合自增
  _.set(variables, "stat_data.进程.当前回合数", curTurn + 1);
  console.log(`[${SCRIPT_NAME}] 回合 ${curTurn} -> ${curTurn + 1}`);

  // 1. 时间与天气
  processDateTimeWeather(variables, scriptState.previousData);
  processSocialMedia(variables, scriptState.previousData);

  // 2. 直播结束记录（阶段切换前运行，此时数据尚未清零）
  processStreamEndRecords(variables, scriptState.previousData);

  // 3. 阶段切换
  processPhaseSwitch(variables, scriptState.previousData);

  // 3. 日常事件推送与队列管理
  processEventPush(variables, scriptState.previousData);

  processLewdIncreaseOnSexCount(variables, scriptState.previousData);
  processNpcLewdIncrease(variables, scriptState.previousData);

  // 4. 跨越阈值事件
  processThresholdEvents(variables, scriptState.previousData);

  // 7. 粉丝联动
  processFanSyncToJin(variables, scriptState.previousData);

  // 数值边界维护
  clampNumericValues(variables);

  // 保存当前快照
  scriptState.previousData = _.cloneDeep(variables.stat_data);
}

// ---------- 数值边界维护 ----------
function clampNumericValues(variables) {
  // 主角 0-100 字段
  var mcStatus = _.get(variables.stat_data, '主角.当前状态', {});
  var clampKeys = ['快感值', '性欲值', '羞耻度', '淫乱度'];
  clampKeys.forEach(function(k) {
    if (mcStatus[k] !== undefined) {
      mcStatus[k] = Math.max(0, Math.min(100, Number(mcStatus[k]) || 0));
    }
  });

  // 主角开发度 ≥0，无上限
  var dev = _.get(variables.stat_data, '主角.开发度', {});
  Object.keys(dev || {}).forEach(function(k) {
    dev[k] = Math.max(0, Number(dev[k]) || 0);
  });

  // NPC 字段 0-100
  var npcs = _.get(variables.stat_data, 'NPC数据', {});
  Object.keys(npcs || {}).forEach(function(name) {
    var npc = npcs[name];
    if (npc.好感度 !== undefined) npc.好感度 = Math.max(0, Math.min(100, Number(npc.好感度) || 0));
    if (npc.淫乱度 !== undefined) npc.淫乱度 = Math.max(0, Math.min(100, Number(npc.淫乱度) || 0));
    if (npc.疑心 !== undefined) npc.疑心 = Math.max(0, Math.min(100, Number(npc.疑心) || 0));
  });

  // 直播人数/热度 ≥0
  var live = _.get(variables.stat_data, '直播状态', {});
  if (live.当前直播间人数 !== undefined) live.当前直播间人数 = Math.max(0, Number(live.当前直播间人数) || 0);
  if (live.当前直播间热度 !== undefined) live.当前直播间热度 = Math.max(0, Number(live.当前直播间热度) || 0);
}

// ---------- 生命周期管理 ----------
function initializeEventListeners() {
  if (scriptState.initialized) return;
  try {
    const Mvu = getMvuInstance();
    if (Mvu) {
      scriptState.listeners.onBeforeGeneration = onBeforeGeneration;
      eventMakeFirst(tavern_events.GENERATION_AFTER_COMMANDS, scriptState.listeners.onBeforeGeneration);
      scriptState.listeners.onVariableUpdateEnded = onVariableUpdateEnded;
      eventOn(
        Mvu.events.VARIABLE_UPDATE_ENDED,
        scriptState.listeners.onVariableUpdateEnded,
      );
      scriptState.initialized = true;
      console.log(`[${SCRIPT_NAME}] ${SCRIPT_VERSION} 初始化成功`);
      if (window.toastr) toastr.success(`${SCRIPT_NAME} 已启动`, "监护脚本");
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
    if (scriptState.listeners.onBeforeGeneration) {
      eventRemoveListener(
        tavern_events.GENERATION_AFTER_COMMANDS,
        scriptState.listeners.onBeforeGeneration,
      );
    }
    if (Mvu && scriptState.listeners.onVariableUpdateEnded) {
      eventRemoveListener(
        Mvu.events.VARIABLE_UPDATE_ENDED,
        scriptState.listeners.onVariableUpdateEnded,
      );
    }
    scriptState.initialized = false;
    scriptState.previousData = null;
  } catch (error) {}
}

$(() => {
  setTimeout(initializeEventListeners, 1500);
});
$(window).on("unload", cleanup);
