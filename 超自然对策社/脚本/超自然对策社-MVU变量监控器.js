/**
 * 超自然对策社 MVU 变量监控器
 * Designed for 超自然对策社 (Supernatural Countermeasure Club) card
 *
 * 职责:
 *   1. runSanitizer           数据清洗：布尔修正、数值限幅(0~100)、视角校验、数组兜底、日程类型自动同步
 *   2. runPerspectiveState    视角状态机：检测视角切换并记录
 *   3. runGhostIncident       今日灵异事件：仅当「今日灵异事件是否发生」为 false 且无进行中/待处理事件时判定推送事件；当「当前日期」发生变化时重置为 false
 */
(function () {
  const SCRIPT_NAME = "超自然对策社MVU引擎";
  const SCRIPT_VERSION = "v1.3";

  // 缓存 textarea 输入 — pre-gen 时 chat 数组未更新，需从 DOM 缓存读取
  (function setupInputCache() {
    function tryBind() {
      try {
        var doc = window.parent?.document || window.document;
        var ta =
          doc && typeof doc.querySelector === "function"
            ? doc.querySelector("#send_textarea")
            : null;
        if (ta) {
          ta.addEventListener("input", function () {
            var v = ta.value;
            if (v.trim()) {
              window.__SN_LAST_INPUT = v;
            }
          });
          window.__SN_LAST_INPUT = ta.value || "";
          console.info("[超自然对策社MVU引擎] 输入缓存已绑定 send_textarea");
        } else {
          setTimeout(tryBind, 500);
        }
      } catch (e) {}
    }
    tryBind();
  })();

  const CONFIG = {
    FEMALE_NAMES: [
      "浅野华代",
      "浅野莉绪",
      "早坂葵",
      "七海诗织",
      "九条绚音",
      "白石结衣",
      "克里斯汀·温斯顿",
    ],
    VALID_PERSPECTIVES: [
      "苦主主角",
      "神宫寺夜",
      "浅野华代",
      "浅野莉绪",
      "早坂葵",
      "七海诗织",
      "九条绚音",
      "白石结衣",
      "克里斯汀·温斯顿",
    ],
    GHOST_TYPES: [
      "附身型",
      "场地附着型",
      "道具诅咒型",
      "迷因魅惑型",
      "实体怨灵型",
      "诅咒型",
    ],
    VALID_SCHEDULES: ["上学", "周末", "假期", "特殊外出"],
    // 今日灵异事件触发概率（20%）
    GHOST_INCIDENT_CHANCE: 0.2,
  };

  // 各区域可发生灵异事件的中立与核心地点（与地图设定严格同步）
  const REGION_LOCATIONS = {
    学院区: [
      "超自然对策社活动室",
      "高二(3)班教室",
      "学生会办公室与风纪室",
      "贵宾接待室",
      "家政料理教室",
      "体育器材储藏室与更衣室",
      "旧校舍天台",
    ],
    商业中心区: [
      "中央商业街与综合百货",
      "24小时综合健身房「Apex Fitness」",
      "影城与电玩娱乐城",
      "鸣神中央公园",
    ],
    繁华夜生活与红灯区: [
      "鸣神町歌舞伎一番街 (繁华红灯街)",
      "主题情人旅馆街「Love Hotel Street」",
      "深夜居酒屋与清吧「Black Lotus」",
      "24小时街角便利店与后巷",
    ],
    海滨度假与休闲区: [
      "鸣神黄金海岸度假沙滩",
      "海滨浴场更衣室与海之家里屋",
      "鸣神旧港口与海防堤防",
    ],
    住宅区: ["浅野咖啡馆「Komano Cafe」", "高层景观公寓「Skyline Tower」"],
    神社与旧城区: [
      "鸣神神社",
      "旧城动漫商业街",
      "后山天然温泉旅馆",
      "旧城区废弃大楼与烂尾工坊",
    ],
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

  function toNum(v, def) {
    var n = parseFloat(v);
    return isNaN(n) ? def : n;
  }
  function clampNum(n, min, max) {
    return Math.round(Math.max(min, Math.min(max, n)));
  }

  class SupernaturalEngine {
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
      this.runGhostIncident(ctx);

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
        perspective: _.get(data, "视角", "苦主主角"),
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
      [
        "系统状态.主角创建完毕",
        "系统状态.灵异事件进行中",
        "进程.今日灵异事件是否发生",
      ].forEach((p) => {
        const v = ctx.get(p);
        if (v === "true") ctx.set(p, true);
        if (v === "false") ctx.set(p, false);
      });

      // 视角合法性
      const curView = ctx.get("视角", "苦主主角");
      if (CONFIG.VALID_PERSPECTIVES.indexOf(curView) === -1) {
        ctx.set("视角", "苦主主角");
        Logger.warn(`[Sanitizer] 非法视角值(${curView})，已强制重置为苦主主角`);
      }

      // 今日日程类型校验兜底（由叙事驱动更新：上学/周末/假期/特殊外出）
      const curSchedule = ctx.get("进程.今日日程类型", "上学");
      if (CONFIG.VALID_SCHEDULES.indexOf(curSchedule) === -1) {
        ctx.set("进程.今日日程类型", "上学");
        Logger.warn(
          `[Sanitizer] 今日日程类型非法(${curSchedule})，已重置为上学`,
        );
      }

      // 全校常识改造规则类型校验（支持无限条目）
      const commonSense = ctx.get("全校常识改造");
      if (!Array.isArray(commonSense)) {
        ctx.set("全校常识改造", []);
      }

      // 苦主主角数值限幅 0~100 与洗脑条目校验
      const mcSuspicion = toNum(ctx.get("苦主主角.疑心值"), 0);
      ctx.set("苦主主角.疑心值", clampNum(mcSuspicion, 0, 100));

      const mcBrainwash = ctx.get("苦主主角.洗脑条目");
      if (!Array.isArray(mcBrainwash)) {
        ctx.set("苦主主角.洗脑条目", []);
      }

      ["友情值", "爱情值", "屈服值", "肉体沉沦值"].forEach((k) => {
        const v = toNum(ctx.get(`苦主主角.对黄毛关系.${k}`), 0);
        ctx.set(`苦主主角.对黄毛关系.${k}`, clampNum(v, 0, 100));
      });

      // 重要女性角色数值限幅与洗脑条目校验
      const femaleChars = ctx.get("重要女性角色", {});
      if (femaleChars && typeof femaleChars === "object") {
        Object.keys(femaleChars).forEach((name) => {
          const base = `重要女性角色.${name}`;
          const lewd = toNum(ctx.get(`${base}.淫乱值`), 0);
          ctx.set(`${base}.淫乱值`, clampNum(lewd, 0, 100));

          // 保证洗脑条目为数组（支持无限条目）
          const brainwash = ctx.get(`${base}.洗脑条目`);
          if (!Array.isArray(brainwash)) {
            ctx.set(`${base}.洗脑条目`, []);
          }

          // 苦主关系 (好感上限200，肉体依赖100)
          const kAff = toNum(ctx.get(`${base}.人际关系.苦主.好感值`), 0);
          const kDep = toNum(ctx.get(`${base}.人际关系.苦主.肉体依赖值`), 0);
          ctx.set(`${base}.人际关系.苦主.好感值`, clampNum(kAff, 0, 200));
          ctx.set(`${base}.人际关系.苦主.肉体依赖值`, clampNum(kDep, 0, 100));

          // 黄毛关系
          ["好感值", "屈服值", "肉体沉沦值"].forEach((k) => {
            const v = toNum(ctx.get(`${base}.人际关系.黄毛.${k}`), 0);
            ctx.set(`${base}.人际关系.黄毛.${k}`, clampNum(v, 0, 100));
          });
        });
      }

      Logger.info("[1. Sanitizer] 数据清洗完成");
    }

    // ============================================================
    // 2. runPerspectiveState — 视角状态机
    // ============================================================
    runPerspectiveState(ctx) {
      Logger.info("[2. PerspectiveState] 检查视角状态...");
      const prevView = ctx.getPrev("视角", "");
      const curView = ctx.get("视角", "苦主主角");
      if (prevView && prevView !== curView) {
        Logger.event(`[PerspectiveState] 视角切换: ${prevView} → ${curView}`);
      } else {
        Logger.info(`[PerspectiveState] 当前视角: ${curView} (未发生切换)`);
      }
    }

    // ============================================================
    // 3. runGhostIncident — 今日灵异事件调度与推送
    // ============================================================
    runGhostIncident(ctx) {
      Logger.info("[3. GhostIncident] 开始检查今日灵异事件...");

      // 1. 日期切换：重置今日灵异事件是否发生为 false
      const prevDate = ctx.getPrev("进程.当前日期", "");
      const curDate = ctx.get("进程.当前日期", "");
      if (prevDate && curDate && prevDate !== curDate) {
        ctx.set("进程.今日灵异事件是否发生", false);
        Logger.event(
          `[GhostIncident] 日期切换 ${prevDate} → ${curDate}，重置今日灵异事件是否发生=false`,
        );
      }

      // 2. 仅当「今日灵异事件是否发生」为 false 且无进行中/待处理事件时判定推送
      const occurred = ctx.get("进程.今日灵异事件是否发生", false) === true;
      const ongoing = ctx.get("系统状态.灵异事件进行中", false) === true;
      const pending = ctx.get("系统状态.待处理事件.灵异事件发生");

      if (!occurred && !ongoing && !pending) {
        const roll = Math.random();
        const chance = CONFIG.GHOST_INCIDENT_CHANCE;
        const isTriggered = roll < chance;

        Logger.info(
          `[GhostIncident 判定] 今日已发生: false | 随机值: ${roll.toFixed(4)} vs 阈值: ${chance} | 判定结果: ${isTriggered ? "🎉 触发灵异事件！" : "❌ 未触发"}`,
        );

        if (isTriggered) {
          const regions = Object.keys(REGION_LOCATIONS);
          const region = _.sample(regions);
          const locations = REGION_LOCATIONS[region] || [];
          const location = _.sample(locations);
          const ghostType = _.sample(CONFIG.GHOST_TYPES);

          // 仅推送 [区域, 地点, 恶灵类型]，由世界书词条与AI创意生成恶灵内容
          ctx.set("系统状态.待处理事件.灵异事件发生", [
            region,
            location,
            ghostType,
          ]);
          Logger.event(
            `[GhostIncident] 推送灵异事件: [${region}, ${location}, ${ghostType}]`,
          );
        }
      } else {
        Logger.info(
          `[GhostIncident] 跳过灵异事件判定（今日已发生: ${occurred}，正在进行中: ${ongoing}，队列待处理: ${Boolean(pending)}）`,
        );
      }
      Logger.info("[3. GhostIncident] 灵异事件检查完成");
    }
  }

  try {
    const engine = new SupernaturalEngine();
    engine.init();
  } catch (e) {
    console.error(`[${SCRIPT_NAME}] 启动失败: ${e.message}`);
  }
})();
