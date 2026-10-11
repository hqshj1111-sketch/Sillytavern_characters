/**
 * 迷香恶堕 MVU 变量监控器
 * Designed for 迷香恶堕 (smell corruption furry hero) card
 *
 * 职责（无阶段状态机）:
 *   1. runSanitizer           数据清洗：布尔修正、沉溺度/污染度限幅、枚举校验、基地沦陷进度限幅
 *   2. runPerspectiveState    视角状态机：检测视角切换并重置切换到的角色目标
 *   3. runGoalBookkeeping     目标记录：检测当前目标变化时写入开始时间
 *   4. runSeductionSettlement 沉溺度变化结算：推导阶段/阵营、彻底恶堕时强制身份认知，并在跨阶段/污染分档/彻底恶堕时推送待处理事件
 *   5. runAffectionEvents     好感度突破：检测角色对他人好感度首次达到 25/50/75/100 时推送事件
 *   6. runSystemEvents        系统事件：警戒等级/氛围升级、沦陷/性生活评估事件推送
 *   7. runMonsterIncident     今日怪人事件：日期切换时重置并随机起始时段，条件满足时按 10% 概率推送怪人事件
 */
(function () {
  const SCRIPT_NAME = "迷香恶堕MVU引擎";
  const SCRIPT_VERSION = "v1.0";

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
    VALID_STAGES: ["无感", "好奇", "渴望", "沉迷", "臣服"],
    VALID_CAMPS: ["正义", "内应", "彻底恶堕"],
    VALID_COGNITIONS: ["未知", "怀疑", "已识破"],
    POLLUTION_THRESHOLD: 100,
    // 警戒等级 / 氛围升级阈值（进度 0-100）
    WARNING_THRESHOLDS: [30, 60],
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
    学院区: ["星辉学园", "学校体育馆", "图书馆", "学校天台"],
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
      return typeof SillyTavern !== "undefined"
        ? SillyTavern.getContext()?.chat || []
        : window.SillyTavern
          ? window.SillyTavern.getContext()?.chat || []
          : [];
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
    if (addiction < 80) return "沉迷";
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

  // 好感度档位（25/50/75/100）
  function getAffectionTier(v) {
    if (v >= 100) return 100;
    if (v >= 75) return 75;
    if (v >= 50) return 50;
    if (v >= 25) return 25;
    return 0;
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
          if (this.retryCount < this.MAX_RETRIES)
            setTimeout(() => this.init(), 2000);
          else Logger.error("未检测到MVU框架，核心引擎无法启动！");
          return;
        }
        // POST-gen: 变量更新后
        eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (wrapper) => {
          this.tick(wrapper?.stat_data || wrapper);
        });
        this.initialized = true;
        if (window.toastr)
          toastr.success(`${SCRIPT_VERSION} 挂载完成。`, SCRIPT_NAME);
        Logger.event("核心引擎初始化完成，开始监听变量...");
      } catch (error) {
        Logger.error("引擎初始化遇到错误: " + error.message);
      }
    }

    tick(currentData) {
      if (!currentData || !currentData.进程) return;

      // 仅处理 AI 消息，忽略用户/系统消息
      const chat = getChatContext();
      if (chat.length > 0) {
        const lastMsg = chat[chat.length - 1];
        if (lastMsg.is_user || lastMsg.is_system) {
          return;
        }
      }

      if (!this.previousData) {
        this.previousData = _.cloneDeep(currentData);
        this.baseTurnData = _.cloneDeep(currentData);
      }

      const isNewAiTurn = this.updateTimeline();
      if (isNewAiTurn && this.isSwipe) {
        this.previousData = _.cloneDeep(this.baseTurnData);
      } else if (isNewAiTurn && !this.isSwipe) {
        this.baseTurnData = _.cloneDeep(this.previousData);
      }

      const ctx = this.buildContext(currentData, isNewAiTurn);
      this.runSanitizer(ctx);
      this.runPerspectiveState(ctx);
      this.runGoalBookkeeping(ctx);
      this.runSeductionSettlement(ctx);
      this.runAffectionEvents(ctx);
      this.runSystemEvents(ctx);
      this.runMonsterIncident(ctx);
      this.previousData = _.cloneDeep(currentData);
    }

    updateTimeline() {
      const chat = getChatContext();
      if (!chat.length) return false;
      const lastMsg = chat[chat.length - 1];
      if (lastMsg.is_user || lastMsg.is_system) return false;
      const currentSignature = `${chat.length}_${lastMsg.swipe_id || 0}`;
      if (this.lastTurnSignature !== currentSignature) {
        this.isSwipe =
          this.lastTurnSignature.split("_")[0] === String(chat.length);
        this.lastTurnSignature = currentSignature;
        return true;
      }
      return false;
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
      // 布尔值修正
      ["系统状态.主角创建完毕"].forEach((p) => {
        const v = ctx.get(p);
        if (v === "true") ctx.set(p, true);
        if (v === "false") ctx.set(p, false);
      });

      // 视角合法性
      if (CONFIG.VALID_PERSPECTIVES.indexOf(ctx.get("视角")) === -1) {
        ctx.set("视角", "怪人主角");
        Logger.warn("非法视角值，已强制重置为怪人主角");
      }

      // 根据当前时间自动同步当前时段
      const curTime = ctx.get("进程.当前时间");
      const curPeriod = ctx.get("进程.当前时段");
      const derivedPeriod = derivePeriodFromTime(curTime);
      if (derivedPeriod && derivedPeriod !== curPeriod) {
        ctx.set("进程.当前时段", derivedPeriod);
        Logger.info(
          `时段根据当前时间(${curTime})自动同步: ${curPeriod} → ${derivedPeriod}`,
        );
      }

      // 基地沦陷进度限幅
      const collapse = toNum(ctx.get("组织.正义联盟.基地沦陷进度"), 0);
      const clampedCollapse = clampNum(collapse, 0, 100);
      if (clampedCollapse !== collapse)
        ctx.set("组织.正义联盟.基地沦陷进度", clampedCollapse);

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
          Logger.warn(`${name} 身份认知非法（${cognition}），已重置为未知`);
        }

        // 是否见面布尔修正
        const met = ctx.get(`${base}.人际关系.怪人主角.是否见面`);
        if (met === "true") ctx.set(`${base}.人际关系.怪人主角.是否见面`, true);
        if (met === "false")
          ctx.set(`${base}.人际关系.怪人主角.是否见面`, false);

        // 阶段枚举兜底：非法时按沉溺度重算
        const stage = ctx.get(`${base}.恶堕状态.气味沉溺阶段`, "无感");
        if (CONFIG.VALID_STAGES.indexOf(stage) === -1) {
          ctx.set(
            `${base}.恶堕状态.气味沉溺阶段`,
            deriveStage(clampedAddiction),
          );
          Logger.warn(`${name} 沉溺阶段非法（${stage}），已按沉溺度重算`);
        }
        // 阵营枚举兜底：非法时按阶段+污染度重算
        const camp = ctx.get(`${base}.恶堕状态.阵营归属`, "正义");
        if (CONFIG.VALID_CAMPS.indexOf(camp) === -1) {
          const curStage = ctx.get(`${base}.恶堕状态.气味沉溺阶段`, "无感");
          ctx.set(
            `${base}.恶堕状态.阵营归属`,
            deriveCamp(curStage, clampedPollution),
          );
          Logger.warn(`${name} 阵营非法（${camp}），已重算`);
        }
      });
    }

    // ============================================================
    // 2. runPerspectiveState — 视角状态机（切换时重置目标）
    // ============================================================
    runPerspectiveState(ctx) {
      const prevView = ctx.getPrev("视角", "");
      const curView = ctx.get("视角", "怪人主角");
      if (prevView && prevView !== curView) {
        Logger.event(`视角切换: ${prevView} → ${curView}`);
        const targetBase =
          curView === "怪人主角" ? "怪人主角" : `小英雄.${curView}`;
        ctx.set(`${targetBase}.当前状态.当前目标`, "待设定");
        ctx.set(`${targetBase}.当前状态.当前目标开始时间`, "待设定");
        ctx.set(`${targetBase}.当前状态.当前目标预计用时`, 0);
        Logger.event(`已重置 ${curView} 的当前目标/开始时间/预计用时`);
      }
    }

    // ============================================================
    // 3. runGoalBookkeeping — 目标变化时记录开始时间
    // ============================================================
    runGoalBookkeeping(ctx) {
      const targets = ["怪人主角"].concat(CONFIG.HERO_NAMES);
      const curDate = String(ctx.get("进程.当前日期", ""));
      const curTime = String(ctx.get("进程.当前时间", "")).padStart(4, "0");
      const nowTs = curDate + curTime;
      targets.forEach((name) => {
        const base = name === "怪人主角" ? "怪人主角" : `小英雄.${name}`;
        const prevGoal = ctx.getPrev(`${base}.当前状态.当前目标`, "待设定");
        const curGoal = ctx.get(`${base}.当前状态.当前目标`, "待设定");
        if (curGoal !== prevGoal) {
          if (curGoal && curGoal !== "待设定") {
            ctx.set(`${base}.当前状态.当前目标开始时间`, nowTs);
            Logger.event(
              `${name} 目标更新: "${prevGoal}" → "${curGoal}"，开始时间 = ${nowTs}`,
            );
          } else {
            ctx.set(`${base}.当前状态.当前目标开始时间`, "待设定");
          }
        }
      });
    }

    // ============================================================
    // 4. runSeductionSettlement — 沉溺度变化结算 + 阶段突破事件推送
    // ============================================================
    runSeductionSettlement(ctx) {
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
            `${name} 气味沉溺阶段突破: ${prevStage} → ${newStage}（沉溺度 ${addiction}），已推送事件`,
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
            `${name} 污染阶段突破: 污染度 ${prevPollution}→${pollution}，达到「${newPollStage}」，已推送事件`,
          );
        }

        // 3. 彻底恶堕：污染度达到阈值时推送事件（英雄名）
        if (
          prevPollution < CONFIG.POLLUTION_THRESHOLD &&
          pollution >= CONFIG.POLLUTION_THRESHOLD
        ) {
          pushEvent(ctx, "系统状态.待处理事件.彻底恶堕", name);
          Logger.warn(`${name} 污染度达到 ${pollution}，触发彻底恶堕事件`);
        }

        // 4. 阵营归属：由阶段+污染度推导并保证一致
        const prevCamp = ctx.get(`${base}.恶堕状态.阵营归属`, "正义");
        const newCamp = deriveCamp(newStage, pollution);
        if (newCamp !== prevCamp) {
          ctx.set(`${base}.恶堕状态.阵营归属`, newCamp);
          Logger.event(
            `${name} 阵营变化: ${prevCamp} → ${newCamp}（阶段 ${newStage}，污染度 ${pollution}）`,
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
            Logger.warn(`${name} 彻底恶堕，强制身份认知=已识破`);
          }
        }
      });
    }

    // ============================================================
    // 5. runAffectionEvents — 好感度突破事件推送
    // ============================================================
    runAffectionEvents(ctx) {
      CONFIG.HERO_NAMES.forEach((name) => {
        const rels = ctx.get(`小英雄.${name}.人际关系`, {}) || {};
        Object.keys(rels).forEach((target) => {
          if (target === "$meta" || target === "$__META_EXTENSIBLE__$") return;
          const path = `小英雄.${name}.人际关系.${target}.好感度`;
          const cur = toNum(ctx.get(path, 0), 0);
          const prev = toNum(ctx.getPrev(path, 0), 0);
          const curTier = getAffectionTier(cur);
          const prevTier = getAffectionTier(prev);
          if (curTier > prevTier && curTier !== 0) {
            pushEvent(ctx, "系统状态.待处理事件.好感度突破", [
              name,
              target,
              String(curTier),
            ]);
            Logger.event(
              `${name} → ${target} 好感度突破 ${curTier}（${prev}→${cur}），已推送事件`,
            );
          }
        });
      });
    }

    // ============================================================
    // 6. runSystemEvents — 系统事件（警戒等级/氛围 + 事件推送）
    // ============================================================
    runSystemEvents(ctx) {
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
      const targetAtmosphere = collapsed ? "沦为怪人组织附庸" : derived.氛围;
      if (curWarning !== targetWarning) {
        ctx.set("组织.正义联盟.警戒等级", targetWarning);
        Logger.event(
          `警戒等级变化: ${curWarning} → ${targetWarning}（进度 ${progress}${collapsed ? "，已彻底沦陷" : ""}）`,
        );
      }
      if (curAtmosphere !== targetAtmosphere) {
        ctx.set("组织.正义联盟.基地当前氛围", targetAtmosphere);
        Logger.event(`基地氛围变化: ${curAtmosphere} → ${targetAtmosphere}`);
      }

      // 基地沦陷进度第一次达到 100 → 推送正义组织沦陷事件
      const prevProgress = toNum(ctx.getPrev("组织.正义联盟.基地沦陷进度"), 0);
      if (prevProgress < 100 && progress >= 100) {
        ctx.set("系统状态.待处理事件.正义组织沦陷", true);
        Logger.warn("基地沦陷进度达到 100，推送正义组织沦陷事件");
      }

      // 性生活情况评估事件（累计天数每满 7 天推送一次）
      const prevDays = toNum(ctx.getPrev("进程.累计天数"), 0);
      const curDays = toNum(ctx.get("进程.累计天数"), 0);
      if (Math.floor(curDays / 7) > Math.floor(prevDays / 7)) {
        ctx.set("系统状态.待处理事件.性生活情况评估", true);
        Logger.event(`第 ${curDays} 天，推送性生活情况评估事件`);
      }
    }

    // ============================================================
    // 7. runMonsterIncident — 今日怪人事件
    // ============================================================
    runMonsterIncident(ctx) {
      if (!ctx.isNewTurn) return;

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
          `日期切换 ${prevDate} → ${curDate}，重置今日怪人事件、随机天气=${weather}、清空今日已完成目标`,
        );
      }

      // 2. 推送怪人事件（10% 概率）
      const occurred = ctx.get("进程.今日怪人事件是否发生", false) === true;
      const pending = ctx.get("系统状态.待处理事件.怪人事件发生");
      if (!occurred && !pending) {
        const startPeriod = ctx.get("进程.进入怪人事件起始发生时段", "早");
        const curPeriod = ctx.get("进程.当前时段", "早");
        const startOrder =
          PERIOD_ORDER[startPeriod] !== undefined
            ? PERIOD_ORDER[startPeriod]
            : 0;
        const curOrder =
          PERIOD_ORDER[curPeriod] !== undefined ? PERIOD_ORDER[curPeriod] : 0;
        if (curOrder > startOrder && Math.random() < 0.1) {
          const regions = Object.keys(REGION_LOCATIONS);
          const region = _.sample(regions);
          const locations = REGION_LOCATIONS[region] || [];
          const location = _.sample(locations);
          ctx.set("系统状态.待处理事件.怪人事件发生", [region, location]);
          Logger.event(`推送怪人事件: ${region} - ${location}`);
        }
      }
    }
  }

  try {
    const engine = new MxEngine();
    engine.init();
  } catch (e) {
    console.error(`[${SCRIPT_NAME}] 启动失败: ${e.message}`);
  }
})();
