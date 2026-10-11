/**
 * 迷香恶堕 MVU 变量监控器
 * Designed for 迷香恶堕 (smell corruption furry hero) card
 *
 * 职责（无阶段状态机）:
 *   1. runSanitizer           数据清洗：布尔修正、沉溺度/污染度限幅、枚举校验、难度校验、基地沦陷进度限幅
 *   2. runPerspectiveState    视角状态机：检测视角切换并重置切换到的角色目标
 *   3. runGoalBookkeeping     目标记录：检测当前目标变化时写入开始时间
 *   4. runSeductionSettlement 沉溺度变化结算：推导阶段/阵营、彻底恶堕时强制身份认知，并在跨阶段/污染分档/彻底恶堕时推送待处理事件
 *   5. runSystemEvents        系统事件：警戒等级/氛围升级、沦陷/性生活评估事件推送
 *   6. runMonsterIncident     今日怪人事件：日期切换时重置并随机起始时段，条件满足时按 15% 概率推送怪人事件
 */
(function () {
  const SCRIPT_NAME = "迷香恶堕MVU引擎";
  const SCRIPT_VERSION = "v1.2";

  // 缓存 textarea 输入 — pre-gen 时 chat 数组未更新，需从 DOM 缓存读取
  (function setupInputCache() {
    function tryBind() {
      var ta = window.parent.document.querySelector("#send_textarea");
      if (ta) {
        ta.addEventListener("input", function () {
          var v = ta.value;
          if (v.trim()) {
            window.__MXE_LAST_INPUT = v;
          }
        });
        window.__MXE_LAST_INPUT = ta.value || "";
        console.info("[迷香恶堕MVU引擎] 输入缓存已绑定 send_textarea");
      } else {
        setTimeout(tryBind, 300);
      }
    }
    tryBind();
  })();

  const CONFIG = {
    HERO_NAMES: ["夜守真白", "虎渡太阳", "槌谷陆", "风祭优羽"],
    VALID_PERSPECTIVES: [
      "怪人主角",
      "夜守真白",
      "虎渡太阳",
      "槌谷陆",
      "风祭优羽",
    ],
    VALID_STAGES: ["无感", "好奇", "渴望", "上瘾", "沉迷", "臣服"],
    VALID_CAMPS: ["正义", "内应", "彻底恶堕"],
    VALID_COGNITIONS: ["未知", "怀疑", "已识破"],
    VALID_DIFFICULTIES: ["简单", "困难"],
    POLLUTION_THRESHOLD: 100,
    // 警戒等级 / 氛围升级阈值（进度 0-100）
    WARNING_THRESHOLDS: [30, 60],
    // 今日怪人事件触发概率（15%）
    MONSTER_INCIDENT_CHANCE: 0.15,
  };

  // 时段顺序（用于判断「当前时段 > 起始发生时段」）
  const PERIOD_ORDER = { 早: 0, 午: 1, 晚: 2, 夜: 3 };

  // 各城区可发生怪人事件的地点（已排除角色住所）
  const REGION_LOCATIONS = {
    中心区: [
      "中央商业街",
      "新星市政广场",
      "中央公园",
      "繁华步行街",
      "百货大楼",
      "街角咖啡店",
    ],
    港区: ["海港码头", "滨海步道", "废弃仓库区", "海岸防波堤", "海鲜市场"],
    旧城区: ["旧城暗巷", "老旧公寓区", "地下商业街", "废弃工厂", "深夜网吧"],
    学院区: ["星辉大学", "大学体育馆", "大学图书馆", "大学天台"],
    山区: ["山间神社", "山镜湖", "温泉度假村", "登山步道"],
  };

  const Logger = {
    info: (msg) => console.log(`[${SCRIPT_NAME}] ${msg}`),
    warn: (msg) => console.warn(`[${SCRIPT_NAME}] ${msg}`),
    error: (msg) => console.error(`[${SCRIPT_NAME}] ${msg}`),
    event: (msg) => console.log(`[${SCRIPT_NAME}] ${msg}`),
  };

  const getChatContext = () => {
    try {
      const st =
        (typeof SillyTavern !== "undefined" && SillyTavern.getContext
          ? SillyTavern
          : null) ||
        (window.parent?.SillyTavern?.getContext
          ? window.parent.SillyTavern
          : null) ||
        (window.top?.SillyTavern?.getContext ? window.top.SillyTavern : null) ||
        (window.SillyTavern?.getContext ? window.SillyTavern : null);
      if (st && typeof st.getContext === "function") {
        const ctx = st.getContext();
        return ctx?.chat || [];
      }
      return [];
    } catch (e) {
      return [];
    }
  };

  function getVariables(opts) {
    try {
      var Mvu = window.Mvu || window.parent?.Mvu || window.top?.Mvu;
      if (!Mvu) return {};
      return Mvu.getVariables(opts || {}) || {};
    } catch (e) {
      return {};
    }
  }

  // 由沉溺度推导阶段（沉溺度是主数据，阶段是标签）
  function deriveStage(addiction) {
    if (addiction < 20) return "无感";
    if (addiction < 40) return "好奇";
    if (addiction < 60) return "渴望";
    if (addiction < 80) return "上瘾";
    if (addiction < 100) return "沉迷";
    return "臣服";
  }

  // 由污染度推导污染分档（0-100，25/50/75 分档，100 为彻底恶堕）
  function derivePollutionStage(pollution) {
    if (pollution >= 75) return "重度污染";
    if (pollution >= 50) return "中度污染";
    if (pollution >= 25) return "轻微污染";
    return "未污染";
  }

  // 由阶段 + 污染度推导阵营
  function deriveCamp(stage, pollution) {
    if (pollution >= CONFIG.POLLUTION_THRESHOLD) return "彻底恶堕";
    if (stage === "臣服") return "内应";
    return "正义";
  }

  // 由当前时间推导当前时段（早≈06:00-11:59、午≈12:00-17:59、晚≈18:00-23:59、夜≈00:00-05:59）
  function derivePeriodFromTime(timeStr) {
    if (timeStr === undefined || timeStr === null) return null;
    const str = String(timeStr).replace(/[^0-9]/g, "");
    if (!str) return null;
    let num = parseInt(str, 10);
    if (isNaN(num)) return null;

    if (str.length <= 2) {
      num = num * 100;
    }

    if (num >= 600 && num < 1200) return "早";
    if (num >= 1200 && num < 1800) return "午";
    if (num >= 1800 && num < 2400) return "晚";
    if (num >= 0 && num < 600) return "夜";
    if (num >= 2400) return "夜";
    return "早";
  }

  // 由当前日期（如 "20360810"）推导今日日程类型（上学 / 休息）
  // 周一至周五 = 上学，周六周日 = 休息
  function deriveScheduleType(dateStr) {
    if (!dateStr) return "上学";
    const str = String(dateStr).replace(/[^0-9]/g, "");
    if (str.length < 8) return "上学";
    const y = parseInt(str.slice(0, 4), 10);
    const m = parseInt(str.slice(4, 6), 10) - 1;
    const d = parseInt(str.slice(6, 8), 10);
    const dayOfWeek = new Date(y, m, d).getDay(); // 0: 周日, 6: 周六
    return dayOfWeek === 0 || dayOfWeek === 6 ? "休息" : "上学";
  }

  // 时段名称映射（早/午/晚/夜 -> 上午/下午/晚上/深夜）
  const PERIOD_MAP = { 早: "上午", 午: "下午", 晚: "晚上", 夜: "深夜" };

  function pickScheduleGoal(ctx, name) {
    const curPeriod = ctx.get("进程.当前时段", "早");
    const periodKey = PERIOD_MAP[curPeriod] || "上午";
    if (name === "怪人主角") {
      const list = ctx.get(`怪人主角.日程.${periodKey}`, []);
      return Array.isArray(list) && list.length > 0
        ? _.sample(list)
        : "以伪装身份处理日常事务";
    } else {
      const scheduleType = ctx.get("进程.今日日程类型", "上学");
      const list = ctx.get(
        `小英雄.${name}.日程.${scheduleType}.${periodKey}`,
        [],
      );
      return Array.isArray(list) && list.length > 0
        ? _.sample(list)
        : "在城区自主活动";
    }
  }

  function deriveWarning(progress) {
    if (progress >= CONFIG.WARNING_THRESHOLDS[1])
      return { 警戒等级: "戒严", 氛围: "混乱" };
    if (progress >= CONFIG.WARNING_THRESHOLDS[0])
      return { 警戒等级: "警惕", 氛围: "人心惶惶" };
    return { 警戒等级: "日常", 氛围: "日常" };
  }

  function toNum(v, def) {
    var n = parseFloat(v);
    return isNaN(n) ? def : n;
  }
  function clampNum(n, min, max) {
    return Math.round(Math.max(min, Math.min(max, n)));
  }
  // 向 系统状态.待处理事件 的某个事件队列追加一个元素（数组/二元组）
  function pushEvent(ctx, path, item) {
    const current = ctx.get(path, []);
    const list = Array.isArray(current) ? current : [];
    list.push(item);
    ctx.set(path, list);
  }

  class MxEngine {
    constructor() {
      this.initialized = false;
      this.previousData = null;
      this.baseTurnData = null;
      this.lastTurnSignature = "";
      this.isSwipe = false;
      this.retryCount = 0;
      this.MAX_RETRIES = 10;
    }

    init() {
      try {
        const Mvu = window.Mvu || window.parent?.Mvu || window.top?.Mvu;
        if (!Mvu) {
          this.retryCount++;
          if (this.retryCount < this.MAX_RETRIES) {
            setTimeout(() => this.init(), 2000);
          } else {
            Logger.error("未检测到MVU框架，核心引擎无法启动！");
          }
          return;
        }

        const handleUpdate = (wrapper) => {
          try {
            const data =
              wrapper?.stat_data ||
              wrapper?.detail?.stat_data ||
              wrapper?.detail ||
              wrapper;
            this.tick(data);
          } catch (err) {
            Logger.error("Tick 执行异常: " + err.message + "\n" + err.stack);
          }
        };

        const eventName =
          Mvu.events?.VARIABLE_UPDATE_ENDED || "VARIABLE_UPDATE_ENDED";
        let bound = false;

        // 1. global eventOn
        const fnEventOn =
          window.eventOn || window.parent?.eventOn || window.top?.eventOn;
        if (typeof fnEventOn === "function") {
          try {
            fnEventOn(eventName, handleUpdate);
            bound = true;
            Logger.info("通过 global eventOn 绑定事件");
          } catch (e) {}
        }

        // 2. eventSource
        const es =
          window.eventSource ||
          window.parent?.eventSource ||
          window.top?.eventSource;
        if (es && typeof es.on === "function") {
          try {
            es.on(eventName, handleUpdate);
            bound = true;
            Logger.info("通过 eventSource 绑定事件");
          } catch (e) {}
        }

        // 3. document DOM CustomEvent
        [
          window.document,
          window.parent?.document,
          window.top?.document,
        ].forEach((doc) => {
          if (doc && doc.addEventListener) {
            try {
              doc.addEventListener(eventName, (e) => {
                handleUpdate(e?.detail?.stat_data || e?.detail || e);
              });
              bound = true;
            } catch (e) {}
          }
        });

        if (!bound) {
          Logger.warn("未找到标准事件发射源，挂载默认 document 监听器");
          document.addEventListener(eventName, (e) => {
            handleUpdate(e?.detail?.stat_data || e?.detail || e);
          });
        }

        this.initialized = true;
        const toast =
          window.toastr || window.parent?.toastr || window.top?.toastr;
        if (toast && typeof toast.success === "function") {
          toast.success(`${SCRIPT_VERSION} 挂载完成。`, SCRIPT_NAME);
        }
        Logger.event("核心引擎初始化完成，开始监听变量...");
      } catch (error) {
        Logger.error("引擎初始化遇到错误: " + error.message);
      }
    }

    tick(rawPayload) {
      Logger.info("========== [Tick] 收到变量更新信号 ==========");
      let currentData =
        rawPayload?.stat_data ||
        rawPayload?.detail?.stat_data ||
        rawPayload?.detail ||
        rawPayload;

      if (!currentData || !currentData.进程) {
        const vars = getVariables();
        if (vars && vars.进程) {
          currentData = vars;
        }
      }

      if (!currentData || !currentData.进程) {
        Logger.warn(
          "[Tick] 未能提取到有效的变量数据(缺少 进程 根对象)，跳过本次 Tick",
        );
        return;
      }

      // 检查聊天上下文（若最后一条是用户/系统消息，则跳过AI结算）
      const chat = getChatContext();
      if (chat && chat.length > 0) {
        const lastMsg = chat[chat.length - 1];
        if (lastMsg.is_user || lastMsg.is_system) {
          Logger.info(
            `[Tick] 当前最后一条消息是用户/系统消息 (is_user: ${lastMsg.is_user}, is_system: ${lastMsg.is_system})，跳过 AI 回合结算`,
          );
          return;
        }
      }

      if (!this.previousData) {
        this.previousData = _.cloneDeep(currentData);
        this.baseTurnData = _.cloneDeep(currentData);
        Logger.info("[Tick] 首次运行，初始化 previousData 与 baseTurnData");
      }

      const isNewAiTurn = this.updateTimeline();
      Logger.info(
        `[Tick] 回合状态: isNewAiTurn=${isNewAiTurn}, isSwipe=${this.isSwipe}, lastTurnSignature=${this.lastTurnSignature}`,
      );

      if (isNewAiTurn && this.isSwipe) {
        this.previousData = _.cloneDeep(this.baseTurnData);
        Logger.info(
          "[Tick] Swipe 重新生成触发，previousData 从 baseTurnData 回滚",
        );
      } else if (isNewAiTurn && !this.isSwipe) {
        this.baseTurnData = _.cloneDeep(this.previousData);
        Logger.info(
          "[Tick] 新回合推进触发，baseTurnData 捕获上一回合 previousData",
        );
      }

      const ctx = this.buildContext(currentData, isNewAiTurn);

      this.runSanitizer(ctx);
      this.runPerspectiveState(ctx);
      this.runGoalScheduler(ctx);
      this.runSeductionSettlement(ctx);
      this.runSystemEvents(ctx);
      this.runMonsterIncident(ctx);

      this.previousData = _.cloneDeep(currentData);
      Logger.info(
        "========== [Tick] 所有子系统处理完毕，同步最新数据 ==========",
      );
    }

    updateTimeline() {
      const chat = getChatContext();
      if (!chat || !chat.length) {
        Logger.info(
          "[Timeline] 无法直接读取 chat 消息列表，默认视为有效更新回合",
        );
        return true;
      }
      const lastMsg = chat[chat.length - 1];
      if (lastMsg.is_user || lastMsg.is_system) {
        Logger.info(
          `[Timeline] 最后一条消息是用户/系统消息(is_user:${lastMsg.is_user}, is_system:${lastMsg.is_system})，不触发AI回合结算`,
        );
        return false;
      }
      const currentSignature = `${chat.length}_${lastMsg.swipe_id || 0}`;
      if (this.lastTurnSignature !== currentSignature) {
        this.isSwipe =
          this.lastTurnSignature.split("_")[0] === String(chat.length);
        this.lastTurnSignature = currentSignature;
        Logger.info(
          `[Timeline] 检测到新回合: signature=${currentSignature}, isSwipe=${this.isSwipe}`,
        );
        return true;
      }
      Logger.info(
        `[Timeline] 消息 signature 未变(${currentSignature})，视为同一回合内更新`,
      );
      return true;
    }

    buildContext(data, isNewTurn) {
      return {
        data: data,
        prev: this.previousData,
        isNewTurn: isNewTurn,
        perspective: _.get(data, "视角", "怪人主角"),
        get: (path, def) => _.get(data, path, def),
        getPrev: (path, def) => _.get(this.previousData, path, def),
        set: (path, val) => _.set(data, path, val),
        add: (path, delta) => {
          const current = toNum(_.get(data, path, 0), 0);
          _.set(data, path, current + toNum(delta, 0));
        },
      };
    }

    // ============================================================
    // 1. runSanitizer — 数据清洗
    // ============================================================
    runSanitizer(ctx) {
      Logger.info("[1. Sanitizer] 开始数据清洗与合法性校验...");
      // 布尔值修正
      ["系统状态.主角创建完毕"].forEach((p) => {
        const v = ctx.get(p);
        if (v === "true") ctx.set(p, true);
        if (v === "false") ctx.set(p, false);
      });

      // 视角合法性
      const curView = ctx.get("视角", "怪人主角");
      if (CONFIG.VALID_PERSPECTIVES.indexOf(curView) === -1) {
        ctx.set("视角", "怪人主角");
        Logger.warn(`[Sanitizer] 非法视角值(${curView})，已强制重置为怪人主角`);
      }

      // 游戏难度合法性
      const curDifficulty = ctx.get("系统状态.游戏难度", "简单");
      if (CONFIG.VALID_DIFFICULTIES.indexOf(curDifficulty) === -1) {
        ctx.set("系统状态.游戏难度", "简单");
        Logger.warn(
          `[Sanitizer] 非法游戏难度值（${curDifficulty}），已重置为简单`,
        );
      }

      // 根据当前时间自动同步当前时段
      const curTime = ctx.get("进程.当前时间");
      const curPeriod = ctx.get("进程.当前时段");
      const derivedPeriod = derivePeriodFromTime(curTime);
      if (derivedPeriod && derivedPeriod !== curPeriod) {
        ctx.set("进程.当前时段", derivedPeriod);
        Logger.event(
          `[Sanitizer] 时段根据当前时间(${curTime})自动同步: ${curPeriod} → ${derivedPeriod}`,
        );
      }

      // 今日日程类型（上学 / 休息）自动推算与同步
      const curDate = ctx.get("进程.当前日期");
      const derivedSchedule = deriveScheduleType(curDate);
      const curSchedule = ctx.get("进程.今日日程类型");
      if (curSchedule !== derivedSchedule) {
        ctx.set("进程.今日日程类型", derivedSchedule);
        Logger.event(
          `[Sanitizer] 今日日程类型根据日期(${curDate})自动同步: ${curSchedule} → ${derivedSchedule}`,
        );
      }

      // 基地沦陷进度限幅
      const collapse = toNum(ctx.get("组织.正义联盟.基地沦陷进度"), 0);
      const clampedCollapse = clampNum(collapse, 0, 100);

      // 每位小英雄的清洗
      CONFIG.HERO_NAMES.forEach((name) => {
        const base = `小英雄.${name}`;

        // 沉溺度限幅 0-100
        const addiction = toNum(ctx.get(`${base}.恶堕状态.气味沉溺度`), 0);
        const clampedAddiction = clampNum(addiction, 0, 100);
        if (clampedAddiction !== addiction)
          ctx.set(`${base}.恶堕状态.气味沉溺度`, clampedAddiction);

        // 污染度限幅 0-100
        const pollution = toNum(ctx.get(`${base}.恶堕状态.欲望之泥污染度`), 0);
        const clampedPollution = clampNum(pollution, 0, 100);
        if (clampedPollution !== pollution)
          ctx.set(`${base}.恶堕状态.欲望之泥污染度`, clampedPollution);

        // 身份认知枚举校验
        const cognition = ctx.get(`${base}.人际关系.怪人主角.身份认知`, "未知");
        if (CONFIG.VALID_COGNITIONS.indexOf(cognition) === -1) {
          ctx.set(`${base}.人际关系.怪人主角.身份认知`, "未知");
          Logger.warn(
            `[Sanitizer] ${name} 身份认知非法（${cognition}），已重置为未知`,
          );
        }

        // 是否见面布尔修正
        const met = ctx.get(`${base}.人际关系.怪人主角.是否见面`);
        if (met === "true") ctx.set(`${base}.人际关系.怪人主角.是否见面`, true);
        if (met === "false")
          ctx.set(`${base}.人际关系.怪人主角.是否见面`, false);

        // 阶段枚举兜底：非法时按沉溺度重算
        const stage = ctx.get(`${base}.恶堕状态.气味沉溺阶段`, "无感");
        if (CONFIG.VALID_STAGES.indexOf(stage) === -1) {
          const recalStage = deriveStage(clampedAddiction);
          ctx.set(`${base}.恶堕状态.气味沉溺阶段`, recalStage);
          Logger.warn(
            `[Sanitizer] ${name} 沉溺阶段非法（${stage}），已按沉溺度重算为 ${recalStage}`,
          );
        }
        // 阵营枚举兜底：非法时按阶段+污染度重算
        const camp = ctx.get(`${base}.恶堕状态.阵营归属`, "正义");
        if (CONFIG.VALID_CAMPS.indexOf(camp) === -1) {
          const curStage = ctx.get(`${base}.恶堕状态.气味沉溺阶段`, "无感");
          const recalCamp = deriveCamp(curStage, clampedPollution);
          ctx.set(`${base}.恶堕状态.阵营归属`, recalCamp);
          Logger.warn(
            `[Sanitizer] ${name} 阵营非法（${camp}），已重算为 ${recalCamp}`,
          );
        }
      });
      Logger.info("[1. Sanitizer] 数据清洗完成");
    }

    // ============================================================
    // 2. runPerspectiveState — 视角状态机
    // ============================================================
    runPerspectiveState(ctx) {
      Logger.info("[2. PerspectiveState] 检查视角状态...");
      const prevView = ctx.getPrev("视角", "");
      const curView = ctx.get("视角", "怪人主角");
      if (prevView && prevView !== curView) {
        Logger.event(
          `[PerspectiveState] 视角切换: ${prevView} → ${curView}（保持各自独立作息）`,
        );
      } else {
        Logger.info(`[PerspectiveState] 当前视角: ${curView} (未发生切换)`);
      }
    }

    // ============================================================
    // 3. runGoalScheduler — 目标调度机（智能日常流转与接力）
    // ============================================================
    runGoalScheduler(ctx) {
      Logger.info("[3. GoalScheduler] 开始检查各角色目标与日常调度...");
      const targets = ["怪人主角"].concat(CONFIG.HERO_NAMES);
      const prevPeriod = ctx.getPrev("进程.当前时段", "");
      const curPeriod = ctx.get("进程.当前时段", "早");
      const isPeriodChanged = prevPeriod && prevPeriod !== curPeriod;
      if (isPeriodChanged) {
        Logger.info(
          `[GoalScheduler] 检测到时段发生推进: ${prevPeriod} → ${curPeriod}`,
        );
      }

      targets.forEach((name) => {
        const base = name === "怪人主角" ? "怪人主角" : `小英雄.${name}`;
        const prevGoal = ctx.getPrev(`${base}.当前状态.当前目标`, "待设定");
        const curGoal = ctx.get(`${base}.当前状态.当前目标`, "待设定");
        const isGoalModifiedByAi = curGoal !== prevGoal;

        const prevDone = ctx.getPrev(`${base}.今日已完成目标`, []);
        const curDone = ctx.get(`${base}.今日已完成目标`, []);
        const prevDoneLen = Array.isArray(prevDone) ? prevDone.length : 0;
        const curDoneLen = Array.isArray(curDone) ? curDone.length : 0;
        const hasNewDoneGoal = curDoneLen > prevDoneLen;

        // 1. 待设定兜底：若目标为空或待设定，自动指派一个
        if (!curGoal || curGoal === "待设定") {
          const newGoal = pickScheduleGoal(ctx, name);
          ctx.set(`${base}.当前状态.当前目标`, newGoal);
          Logger.event(
            `[GoalScheduler] ${name} 目标初始/兜底指派: "${newGoal}"`,
          );
          return;
        }

        // 2. 如果 AI 在本回合显式给出了新的剧情目标，完全尊重 AI，不进行覆盖
        if (isGoalModifiedByAi) {
          Logger.info(
            `[GoalScheduler] ${name} 目标由剧情显式设定: "${prevGoal}" → "${curGoal}" (尊重AI，保留)`,
          );
          return;
        }

        // 3. 情况 A：本回合「今日已完成目标」有新增，且 AI 未修改当前目标 → 从当前时段自动指派下一个日程
        if (hasNewDoneGoal) {
          const newGoal = pickScheduleGoal(ctx, name);
          ctx.set(`${base}.当前状态.当前目标`, newGoal);
          Logger.event(
            `[GoalScheduler] ${name} 目标完成归档(已完成数:${curDoneLen})，自动接力新目标: "${newGoal}"`,
          );
          return;
        }

        // 4. 情况 B：时段发生推进/切换，且 AI 未修改当前目标 → 自动从新时段日程换班
        if (isPeriodChanged) {
          const newGoal = pickScheduleGoal(ctx, name);
          ctx.set(`${base}.当前状态.当前目标`, newGoal);
          Logger.event(
            `[GoalScheduler] 时段流转(${prevPeriod}→${curPeriod})，${name} 自动切换作息: "${newGoal}"`,
          );
          return;
        }

        Logger.info(`[GoalScheduler] ${name} 目标保持不变: "${curGoal}"`);
      });
      Logger.info("[3. GoalScheduler] 目标调度检查完成");
    }

    // ============================================================
    // 4. runSeductionSettlement — 沉溺度变化结算 + 阶段突破事件推送
    // ============================================================
    runSeductionSettlement(ctx) {
      Logger.info(
        "[4. SeductionSettlement] 检查沉溺度/污染度状态与突破事件...",
      );
      CONFIG.HERO_NAMES.forEach((name) => {
        const base = `小英雄.${name}`;
        const addiction = toNum(ctx.get(`${base}.恶堕状态.气味沉溺度`), 0);
        const pollution = toNum(ctx.get(`${base}.恶堕状态.欲望之泥污染度`), 0);
        const prevAddiction = toNum(
          ctx.getPrev(`${base}.恶堕状态.气味沉溺度`),
          0,
        );
        const prevPollution = toNum(
          ctx.getPrev(`${base}.恶堕状态.欲望之泥污染度`),
          0,
        );

        // 1. 气味沉溺阶段：由沉溺度推导并保证一致；跨阶段时推送二元组事件 [英雄名, 新阶段]
        const prevStage = ctx.get(`${base}.恶堕状态.气味沉溺阶段`, "无感");
        const newStage = deriveStage(addiction);
        if (newStage !== prevStage) {
          ctx.set(`${base}.恶堕状态.气味沉溺阶段`, newStage);
          pushEvent(ctx, "系统状态.待处理事件.气味沉溺阶段突破", [
            name,
            newStage,
          ]);
          Logger.event(
            `[SeductionSettlement] ${name} 气味沉溺阶段突破: ${prevStage} → ${newStage}（沉溺度 ${addiction}），已推送事件`,
          );
        }

        // 2. 污染度分档突破：跨档时推送二元组事件 [英雄名, 新分档]（25/50/75）
        const prevPollStage = derivePollutionStage(prevPollution);
        const newPollStage = derivePollutionStage(pollution);
        if (newPollStage !== prevPollStage && newPollStage !== "未污染") {
          pushEvent(ctx, "系统状态.待处理事件.污染阶段突破", [
            name,
            newPollStage,
          ]);
          Logger.event(
            `[SeductionSettlement] ${name} 污染阶段突破: 污染度 ${prevPollution}→${pollution}，达到「${newPollStage}」，已推送事件`,
          );
        }

        // 3. 彻底恶堕：污染度达到阈值时推送事件（英雄名）
        if (
          prevPollution < CONFIG.POLLUTION_THRESHOLD &&
          pollution >= CONFIG.POLLUTION_THRESHOLD
        ) {
          pushEvent(ctx, "系统状态.待处理事件.彻底恶堕", name);
          Logger.warn(
            `[SeductionSettlement] ${name} 污染度达到 ${pollution}，触发彻底恶堕事件`,
          );
        }

        // 4. 阵营归属：由阶段+污染度推导并保证一致
        const prevCamp = ctx.get(`${base}.恶堕状态.阵营归属`, "正义");
        const newCamp = deriveCamp(newStage, pollution);
        if (newCamp !== prevCamp) {
          ctx.set(`${base}.恶堕状态.阵营归属`, newCamp);
          Logger.event(
            `[SeductionSettlement] ${name} 阵营变化: ${prevCamp} → ${newCamp}（阶段 ${newStage}，污染度 ${pollution}）`,
          );
        }

        // 5. 不变量：彻底恶堕 → 身份认知=已识破（臣服时的身份揭晓交由【气味沉溺度变化】事件叙事处理，不在此强制）
        if (newCamp === "彻底恶堕") {
          const cognition = ctx.get(
            `${base}.人际关系.怪人主角.身份认知`,
            "未知",
          );
          if (cognition !== "已识破") {
            ctx.set(`${base}.人际关系.怪人主角.身份认知`, "已识破");
            Logger.warn(
              `[SeductionSettlement] ${name} 彻底恶堕，强制身份认知=已识破`,
            );
          }
        }
      });
      Logger.info("[4. SeductionSettlement] 沉溺度结算检查完成");
    }

    // ============================================================
    // 5. runSystemEvents — 系统事件（警戒等级/氛围 + 事件推送）
    // ============================================================
    runSystemEvents(ctx) {
      Logger.info("[5. SystemEvents] 检查系统与组织态势事件...");
      // 依据进度升级警戒等级与氛围（彻底沦陷后固定为终值）
      const progress = clampNum(
        toNum(ctx.get("组织.正义联盟.基地沦陷进度"), 0),
        0,
        100,
      );
      const collapsed = ctx.get("组织.正义联盟.是否彻底沦陷", false) === true;
      const curWarning = ctx.get("组织.正义联盟.警戒等级", "日常");
      const curAtmosphere = ctx.get("组织.正义联盟.基地当前氛围", "日常");
      const derived = deriveWarning(progress);
      const targetWarning = collapsed ? "沦陷" : derived.警戒等级;
      const targetAtmosphere = collapsed ? "沦陷" : derived.氛围;
      let postureChanged = false;
      if (curWarning !== targetWarning) {
        ctx.set("组织.正义联盟.警戒等级", targetWarning);
        Logger.event(
          `[SystemEvents] 警戒等级变化: ${curWarning} → ${targetWarning}（进度 ${progress}${collapsed ? "，已彻底沦陷" : ""}）`,
        );
        postureChanged = true;
      }
      if (curAtmosphere !== targetAtmosphere) {
        ctx.set("组织.正义联盟.基地当前氛围", targetAtmosphere);
        Logger.event(
          `[SystemEvents] 基地氛围变化: ${curAtmosphere} → ${targetAtmosphere}`,
        );
        postureChanged = true;
      }

      // 当警戒等级或氛围发生阶级变化且未彻底沦陷时，推送「组织态势变化」事件
      if (postureChanged && !collapsed && progress < 100) {
        ctx.set("系统状态.待处理事件.组织态势变化", [
          targetWarning,
          targetAtmosphere,
        ]);
        Logger.warn(
          `[SystemEvents] 推送组织态势变化事件: [${targetWarning}, ${targetAtmosphere}]`,
        );
      }

      // 基地沦陷进度第一次达到 100 → 推送正义组织沦陷事件
      const prevProgress = toNum(ctx.getPrev("组织.正义联盟.基地沦陷进度"), 0);
      if (prevProgress < 100 && progress >= 100) {
        ctx.set("系统状态.待处理事件.正义组织沦陷", true);
        Logger.warn(
          "[SystemEvents] 基地沦陷进度达到 100，推送正义组织沦陷事件",
        );
      }

      // 性生活情况评估事件（累计天数每满 7 天推送一次）
      const prevDays = toNum(ctx.getPrev("进程.累计天数"), 0);
      const curDays = toNum(ctx.get("进程.累计天数"), 0);
      if (Math.floor(curDays / 7) > Math.floor(prevDays / 7)) {
        ctx.set("系统状态.待处理事件.性生活情况评估", true);
        Logger.event(`[SystemEvents] 第 ${curDays} 天，推送性生活情况评估事件`);
      }
      Logger.info(
        `[5. SystemEvents] 系统事件检查完成 (基地沦陷进度: ${progress}%, 警戒: ${targetWarning}, 氛围: ${targetAtmosphere})`,
      );
    }

    // ============================================================
    // 6. runMonsterIncident — 今日怪人事件
    // ============================================================
    runMonsterIncident(ctx) {
      Logger.info("[6. MonsterIncident] 开始检查今日怪人事件...");

      // 1. 日期切换：重置今日怪人事件，随机起始发生时段（早/午/晚）
      const prevDate = ctx.getPrev("进程.当前日期", "");
      const curDate = ctx.get("进程.当前日期", "");
      if (prevDate && curDate && prevDate !== curDate) {
        ctx.set("进程.今日怪人事件是否发生", false);
        const startPeriod = _.sample(["早", "午", "晚"]);
        ctx.set("进程.进入怪人事件起始发生时段", startPeriod);
        // 随机设置当前天气
        const weather = _.sample(["晴", "阴", "雨", "风"]);
        ctx.set("进程.当前天气", weather);
        // 清空今日已完成目标
        ctx.set("怪人主角.今日已完成目标", []);
        CONFIG.HERO_NAMES.forEach((name) => {
          ctx.set(`小英雄.${name}.今日已完成目标`, []);
        });
        Logger.event(
          `[MonsterIncident] 日期切换 ${prevDate} → ${curDate}，重置今日怪人事件、随机天气=${weather}、随机起始时段=${startPeriod}、清空今日已完成目标`,
        );
      }

      // 2. 推送怪人事件（15% 概率）
      const occurred = ctx.get("进程.今日怪人事件是否发生", false) === true;
      const pending = ctx.get("系统状态.待处理事件.怪人事件发生");
      const startPeriod = ctx.get("进程.进入怪人事件起始发生时段", "早");
      const curPeriod = ctx.get("进程.当前时段", "早");
      const startOrder =
        PERIOD_ORDER[startPeriod] !== undefined ? PERIOD_ORDER[startPeriod] : 0;
      const curOrder =
        PERIOD_ORDER[curPeriod] !== undefined ? PERIOD_ORDER[curPeriod] : 0;

      if (!occurred && !pending) {
        const isPeriodEligible = curOrder >= startOrder;
        const roll = Math.random();
        const chance = CONFIG.MONSTER_INCIDENT_CHANCE;
        const isTriggered = isPeriodEligible && roll < chance;

        Logger.info(
          `[MonsterIncident 判定] 当前时段: ${curPeriod}(权重${curOrder}) vs 起始时段: ${startPeriod}(权重${startOrder}) | 时段满足: ${isPeriodEligible} | 随机值: ${roll.toFixed(4)} vs 阈值: ${chance} | 判定结果: ${isTriggered ? "🎉 触发怪人事件！" : "❌ 未触发"}`,
        );

        if (isTriggered) {
          const regions = Object.keys(REGION_LOCATIONS);
          const region = _.sample(regions);
          const locations = REGION_LOCATIONS[region] || [];
          const location = _.sample(locations);
          ctx.set("系统状态.待处理事件.怪人事件发生", [region, location]);
          Logger.event(
            `[MonsterIncident] 推送怪人事件: [${region}, ${location}]`,
          );
        }
      } else {
        Logger.info(
          `[MonsterIncident] 跳过怪人事件判定（今日已发生: ${occurred}，队列待处理: ${Boolean(pending)}，当前时段: ${curPeriod}，起始时段: ${startPeriod}）`,
        );
      }
      Logger.info("[6. MonsterIncident] 怪人事件检查完成");
    }
  }

  try {
    const engine = new MxEngine();
    engine.init();
  } catch (e) {
    console.error(`[${SCRIPT_NAME}] 启动失败: ${e.message}`);
  }
})();
