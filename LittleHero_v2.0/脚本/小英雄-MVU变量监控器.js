/**
 * 小英雄 MVU 核心游戏引擎 - 现代化架构重构 (v23.8.6 LittleHero Ultimate Edition)
 * Designed by SillyTavern Master & Antigravity
 */
(function () {
  const SCRIPT_NAME = "小英雄MVU引擎";
  const SCRIPT_VERSION = "v23.8.6 Ultimate";

  const CONFIG = {
    KINK_THRESHOLDS: [
      { level: 4, xp: 1000 },
      { level: 3, xp: 500 },
      { level: 2, xp: 250 },
      { level: 1, xp: 100 },
      { level: 0, xp: 0 },
    ],
    VALID_PHASES: [
      "创角阶段",
      "幕间休息",
      "战斗准备",
      "战斗回合",
      "终结回合",
      "战斗胜利",
      "战斗败北",
      "战后处理",
      "被捕囚禁",
    ],
    VALID_POSTURES: [
      "非战斗",
      "战斗中",
      "劣势",
      "力尽待辱",
      "战后虚弱",
      "监禁受辱",
    ],
    TACTIC_SETS: {
      战斗回合: {
        valid: ["主动", "牵制", "诱惑", "推进", "危机", "必杀", "撤退", "投降"],
        def: "主动",
      },
      终结回合: {
        valid: ["主动", "牵制", "诱惑", "推进", "危机", "必杀"],
        def: "主动",
      },
      战斗准备: { valid: ["周旋", "探索", "交涉", "开战"], def: "周旋" },
      H事件: { valid: ["抗拒", "忍耐", "爆发", "迎合"], def: "忍耐" },
      校园催眠: { valid: ["怀疑", "忍耐", "顺从", "试探"], def: "怀疑" },
      校园催眠_完全催眠: {
        valid: ["受训", "助教", "侍奉", "同化"],
        def: "受训",
      },
      被捕囚禁_低自由度: {
        valid: ["观察", "挣扎", "休息", "思考"],
        def: "观察",
      },
      被捕囚禁_高自由度: {
        valid: ["对话", "探索", "休息", "思考"],
        def: "探索",
      },
      被捕囚禁_洗脑: { valid: ["反抗", "忍耐", "动摇", "顺从"], def: "反抗" },
    },
  };

  const Logger = {
    info: (msg) => console.log(`[${SCRIPT_NAME}] 🔵 ${msg}`),
    warn: (msg) => console.warn(`[${SCRIPT_NAME}] 🟡 ${msg}`),
    error: (msg) => {
      console.error(`[${SCRIPT_NAME}] 🔴 ${msg}`);
      if (window.toastr) toastr.error(msg, SCRIPT_NAME);
    },
    event: (msg) => console.log(`[${SCRIPT_NAME}] ✨ ${msg}`),
    toast: (msg, type = "success") => {
      console.log(`[${SCRIPT_NAME}] 💬 ${msg}`);
      if (window.toastr) toastr[type](msg, "小英雄状态更新");
    },
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

  class LittleHeroEngine {
    constructor() {
      this.initialized = false;
      this.baseTurnData = null;
      this.previousData = null;
      this.lastTurnSignature = "";
      this.lastMsgObject = null;
      this.retryCount = 0;
      this.MAX_RETRIES = 10;
      this.counters = { finisher: 0, victory: 0, defeatPersistence: 0 };
      this.repConfig = {
        decayInterval: 2,
        maxDecayPerTick: 5,
      };
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

        if (
          typeof eventOn === "function" &&
          Mvu.events?.VARIABLE_UPDATE_ENDED
        ) {
          eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (wrapper) => {
            this.tick(wrapper?.stat_data || wrapper);
          });
        } else if (window.eventSource) {
          window.eventSource.on("mvu_update", (eventData) => {
            const data =
              eventData?.data || (Mvu.getvar ? Mvu.getvar("stat_data") : null);
            if (data) this.tick(data);
          });
        }

        this.updateTimeline();
        this.initialized = true;
        if (window.toastr)
          toastr.success(
            `${SCRIPT_VERSION} 挂载完成，引擎全功率运转。`,
            SCRIPT_NAME,
          );
        Logger.event("🚀 核心引擎初始化完成，开始监听变量...");
      } catch (error) {
        Logger.error("引擎初始化遇到严重错误: " + error.message);
      }
    }

    tick(currentData) {
      if (!currentData || !currentData.进程) return;

      const chat = getChatContext();
      if (chat.length > 0) {
        const lastMsg = chat[chat.length - 1];
        if (lastMsg.is_user || lastMsg.is_system) {
          Logger.info("⏳ 侦测到非AI层变动，跳过游戏引擎计算以防止数据污染。");
          return;
        }
      }

      if (!this.previousData) {
        this.previousData = _.cloneDeep(currentData);
        this.baseTurnData = _.cloneDeep(currentData);
        Logger.info("📦 初始内存快照建立完毕。");
      }

      const isNewAiTurn = this.updateTimeline();
      if (isNewAiTurn && this.isSwipe) {
        Logger.warn("🔄 侦测到重新生成 (Swipe)，回滚内存快照防止数据污染。");
        this.previousData = _.cloneDeep(this.baseTurnData);
      } else if (isNewAiTurn && !this.isSwipe) {
        Logger.info("📝 新回合产生，提交上回合暂存数据，锁定基线快照。");
        this.baseTurnData = _.cloneDeep(this.previousData);
      }

      const ctx = this.buildContext(currentData, isNewAiTurn);
      this.runSanitizer(ctx);
      this.runReactiveSystem(ctx);
      this.runStateMachine(ctx);
      this.runMilestones(ctx);
      this._runReputationDecay(ctx);
      this._deriveReputation(ctx);
      this.previousData = _.cloneDeep(currentData);
    }

    updateTimeline() {
      const chat = getChatContext();
      if (!chat.length) return false;
      const lastMsg = chat[chat.length - 1];
      if (lastMsg.is_user || lastMsg.is_system) return false;

      const currentSignature = `${chat.length}_${lastMsg.swipe_id || 0}`;
      const isDifferentObject = this.lastMsgObject !== lastMsg;

      if (this.lastTurnSignature !== currentSignature || isDifferentObject) {
        this.isSwipe =
          this.lastTurnSignature.split("_")[0] === String(chat.length);

        if (isDifferentObject && this.isSwipe) {
          Logger.warn(
            `🗑️ 侦测到当前楼层被重写（索引：${chat.length}）。回滚至上一层安全快照以重置变量状态。`,
          );
        } else if (isDifferentObject && !this.isSwipe) {
          Logger.info(
            `⏳ 建立全新 AI 楼层实例关联（长度：${chat.length}）。基线已锁定。`,
          );
        }

        this.lastTurnSignature = currentSignature;
        this.lastMsgObject = lastMsg;
        return true;
      }
      return false;
    }

    buildContext(data, isNewTurn) {
      return {
        data: data,
        prev: this.previousData,
        isNewTurn: isNewTurn,
        phase: _.get(data, "进程.阶段", "创角阶段"),
        personality: _.get(data, "主角.核心状态.人格状态", "英雄"),
        events: _.get(data, "系统状态.待处理事件", {}),
        get: (path, def) => _.get(data, path, def),
        getPrev: (path, def) => _.get(this.previousData, path, def),
        set: (path, val) => _.set(data, path, val),
        unset: (path) => _.unset(data, path),
        add: (path, delta) => {
          const current = parseFloat(_.get(data, path, 0)) || 0;
          _.set(data, path, current + (parseFloat(delta) || 0));
        },
        clamp: (path, min, max) => {
          const val = _.get(data, path);
          if (typeof val === "number") {
            const clamped = Math.round(Math.max(min, Math.min(max, val)));
            if (clamped !== val) _.set(data, path, clamped);
          }
        },
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 1. 数据清洗与格式纠偏 (Data Sanitization & Format Rectification)
    // ══════════════════════════════════════════════════════════════════
    runSanitizer(ctx) {
      // 类型纠偏
      [
        "主角.核心状态.着装状态",
        "系统状态.主角创建完毕",
        "系统状态.幕间事件完成",
      ].forEach((p) => {
        const v = ctx.get(p);
        if (v === "true") ctx.set(p, true);
        if (v === "false") ctx.set(p, false);
      });

      // 阶段与姿态越界纠偏
      if (!CONFIG.VALID_PHASES.includes(ctx.get("进程.阶段"))) {
        ctx.set("进程.阶段", "幕间休息");
        Logger.warn("⚠️ 阶段越界，强制重置为 [幕间休息]");
      }
      if (
        !CONFIG.VALID_POSTURES.includes(ctx.get("主角.核心状态.当前战斗姿态"))
      ) {
        ctx.set("主角.核心状态.当前战斗姿态", "非战斗");
        Logger.warn("⚠️ 战斗姿态越界，重置为 [非战斗]");
      }

      // 属性数值限幅
      const maxHp = ctx.get("主角.核心状态.体力值.最大", 100);
      const maxMp = ctx.get("主角.核心状态.能量值.最大", 100);
      ctx.clamp("主角.核心状态.体力值.当前", 0, maxHp);
      ctx.clamp("主角.核心状态.能量值.当前", 0, maxMp);
      ctx.clamp("主角.快感状态.快感值", 0, 1000);
      ctx.clamp("主角.快感状态.侵蚀度", 0, 100);
      ctx.clamp("主角.核心状态.正义充能", 0, 100);
      ctx.clamp("主角.核心状态.混沌充能", 0, 100);
      ctx.clamp("世界.当前关卡.Boss韧性值", 0, 100);
      ctx.clamp("主角.黑暗印记.经验", 0, 9999);
      ctx.clamp("主角.囚禁状态.逃脱进度", 0, 100);
      ctx.clamp("主角.囚禁状态.洗脑进度", 0, 100);
      ctx.clamp("主角.囚禁状态.自由度加值", -40, 40);
      ctx.clamp("主角.生理状态.后穴状态.开发度", 0, 100);
      ctx.clamp("名声.知名度", 0, 100);
      ctx.clamp("名声.风评", -100, 100);
      ctx.clamp("世界.校园催眠.催眠进度", 0, 100);
      ctx.clamp("世界.校园催眠.疑心度", 0, 100);
      ctx.clamp("世界.校园催眠.今日在校回合", 0, 999);

      // 核心主题池去重与净化
      let themes = ctx.get("世界.当前关卡.核心主题", []);
      if (!Array.isArray(themes)) themes = themes ? [themes] : [];
      const cleanThemes = _.uniq(
        themes.filter((t) => t && t !== "$__META_EXTENSIBLE__$"),
      );
      cleanThemes.push("$__META_EXTENSIBLE__$");
      if (!_.isEqual(themes, cleanThemes)) {
        ctx.set("世界.当前关卡.核心主题", cleanThemes);
        Logger.info("🧹 核心主题数组已去重净化");
      }

      // 身体改造结构归一化与黑暗印记专属重定向
      const curMods = ctx.get("主角.永久性身体改造", {});
      const prevMods = ctx.getPrev("主角.永久性身体改造", {});
      const CURSE_KEY_REGEX = /(黑暗印记|烙印|刻印)/i;

      Object.keys(curMods).forEach((k) => {
        if (k === "$meta" || k === "$__META_EXTENSIBLE__$") return;
        const mod = curMods[k] || {};

        // 捕获误写入身体改造的黑暗印记并物理清理
        if (CURSE_KEY_REGEX.test(k)) {
          const isNewEntry = !prevMods[k];
          const modDetail =
            typeof mod === "string" ? mod : mod.详情 || mod.description || "";
          const curDesc = ctx.get("主角.黑暗印记.描述", "生成中……");

          if (
            (curDesc === "生成中……" ||
              curDesc === "待设定" ||
              curDesc === "无") &&
            modDetail &&
            modDetail !== "待设定"
          ) {
            ctx.set("主角.黑暗印记.描述", modDetail);
            Logger.event(
              `🩸 黑暗印记描述已从身体改造 [${k}] 迁移至专属变量：${modDetail}`,
            );
          }

          if (isNewEntry) {
            const curXp = ctx.get("主角.黑暗印记.经验", 0);
            const curLv = this._getCurseLv(curXp);
            if (curXp <= 0) {
              ctx.set("主角.黑暗印记.经验", 40);
              ctx.set("系统状态.待处理事件.黑暗印记显现事件", true);
              Logger.event(
                `🧬 检测到模型注入烙印 [${k}]，唤醒初始黑暗印记显现事件！`,
              );
            } else if (curLv < 3) {
              ctx.add("主角.黑暗印记.经验", 40);
              Logger.info(`🩸 同类烙印叠加 [${k}]，转化为经验 (+40 XP)`);
            } else {
              ctx.add("主角.黑暗印记.经验", 15);
              Logger.info(`🩸 印记满级后轻微吸收烙印 [${k}] (+15 XP)`);
            }
          }

          delete curMods[k];
          ctx.unset(`主角.永久性身体改造.${k}`);
          Logger.event(
            `🧹 [物理清理] 身体改造中的印记键 [${k}] 已吸收并从改造表中彻底销毁。`,
          );
          return;
        }

        if (!prevMods[k]) {
          if (typeof mod === "string") {
            ctx.set(`主角.永久性身体改造.${k}`, {
              部位: k,
              详情: mod,
              来源: "怪人组织",
            });
          } else {
            ctx.set(`主角.永久性身体改造.${k}`, {
              部位: mod.部位 || "待设定",
              详情: mod.详情 || "待设定",
              来源: mod.来源 || "怪人组织",
            });
          }
          Logger.event(`🧬 新增正规身体改造登记：[${k}]`);
        }
      });

      // 阶段化战术纠偏 (TACTIC_SETS)
      const curPhase = ctx.get("进程.阶段");
      const hEventName = ctx.get("世界.幕间H事件.名称", "无");
      const isHEventActive = curPhase === "幕间休息" && hEventName !== "无";
      const isCampusHypnosis =
        curPhase === "幕间休息" &&
        ctx.get("世界.校园催眠.主角在校", false) === true &&
        !ctx.get("世界.校园催眠.结界已破除", false);
      const isFullyHypnotized =
        isCampusHypnosis &&
        ctx.get("世界.校园催眠.完全催眠阶段", false) === true;
      const isBrainwashing =
        curPhase === "被捕囚禁" &&
        ctx.get("主角.囚禁状态.洗脑中", false) === true;

      let tacticCtx = null;
      if (curPhase === "战斗回合") tacticCtx = CONFIG.TACTIC_SETS["战斗回合"];
      else if (curPhase === "终结回合")
        tacticCtx = CONFIG.TACTIC_SETS["终结回合"];
      else if (curPhase === "战斗准备")
        tacticCtx = CONFIG.TACTIC_SETS["战斗准备"];
      else if (isHEventActive) tacticCtx = CONFIG.TACTIC_SETS["H事件"];
      else if (isCampusHypnosis) {
        tacticCtx = isFullyHypnotized
          ? CONFIG.TACTIC_SETS["校园催眠_完全催眠"]
          : CONFIG.TACTIC_SETS["校园催眠"];
      } else if (curPhase === "被捕囚禁") {
        if (isBrainwashing) {
          tacticCtx = CONFIG.TACTIC_SETS["被捕囚禁_洗脑"];
        } else {
          const freedom = ctx.get("主角.囚禁状态.自由度", "严密监禁");
          const isHighFreedom = ["半自由", "信任囚徒"].includes(freedom);
          tacticCtx = isHighFreedom
            ? CONFIG.TACTIC_SETS["被捕囚禁_高自由度"]
            : CONFIG.TACTIC_SETS["被捕囚禁_低自由度"];
        }
      }

      let currentTactic = ctx.get("主角.战斗临时.战斗方式", "主动");
      if (tacticCtx && !tacticCtx.valid.includes(currentTactic)) {
        ctx.set("主角.战斗临时.战斗方式", tacticCtx.def);
        currentTactic = tacticCtx.def;
        Logger.info(
          `🧹 Sanitizer: 阶段[${curPhase}]战斗方式越界，重置为 [${tacticCtx.def}]`,
        );
      }

      const isFallen = ctx.personality === "反派" || ctx.personality === "堕落";
      if (currentTactic === "牵制" && isFallen) {
        ctx.set("主角.战斗临时.战斗方式", "诱惑");
        currentTactic = "诱惑";
        Logger.info("⚖️ Sanitizer: 人格-战术纠偏 [牵制] -> [诱惑]");
      } else if (currentTactic === "诱惑" && !isFallen) {
        ctx.set("主角.战斗临时.战斗方式", "牵制");
        currentTactic = "牵制";
        Logger.info("⚖️ Sanitizer: 人格-战术纠偏 [诱惑] -> [牵制]");
      }

      if (
        ["战斗回合", "终结回合"].includes(curPhase) &&
        currentTactic === "必杀"
      ) {
        const ultCharge = isFallen
          ? ctx.get("主角.核心状态.混沌充能", 0)
          : ctx.get("主角.核心状态.正义充能", 0);
        if (ultCharge < 100) {
          ctx.set("主角.战斗临时.战斗方式", "主动");
          Logger.warn(
            "🛡️ Sanitizer: 必杀充能未满 100%，战斗方式回退至【主动】",
          );
        }
      }

      if (!tacticCtx && currentTactic !== "主动") {
        ctx.set("主角.战斗临时.战斗方式", "主动");
      }

      // 善堕备份：小英雄黑化事件首次挂起时保存英雄身份
      if (
        ctx.events["小英雄黑化"] &&
        !ctx.getPrev("系统状态.待处理事件.小英雄黑化")
      ) {
        const heroName = ctx.get("主角.基本信息.英雄名", "");
        const suit = ctx.get("主角.个人信息.紧身战衣", "");
        const color = ctx.get("主角.个人信息.代表色", "");
        const ability = ctx.get("主角.个人信息.核心能力", "");
        const trait = ctx.get("主角.个人信息.性格特质", "");
        if (heroName && heroName !== "待设定") {
          ctx.set("主角.核心状态.善堕备份", {
            英雄名: heroName,
            紧身战衣: suit,
            代表色: color,
            核心能力: ability,
            性格特质: trait,
          });
          Logger.info(`📦 善堕备份已保存原始英雄身份：${heroName}`);
        }
        ctx.add("记录.黑化次数", 1);
        Logger.event(`🖤 黑化计数 +1 (当前: ${ctx.get("记录.黑化次数", 0)})`);
      }

      // 恶堕备份：善堕事件首次挂起时保存反派身份
      if (
        ctx.events["善堕事件"] &&
        !ctx.getPrev("系统状态.待处理事件.善堕事件")
      ) {
        const fallenName = ctx.get("主角.基本信息.英雄名", "");
        const fallenSuit = ctx.get("主角.个人信息.紧身战衣", "");
        const fallenColor = ctx.get("主角.个人信息.代表色", "");
        const fallenAbility = ctx.get("主角.个人信息.核心能力", "");
        const fallenTrait = ctx.get("主角.个人信息.性格特质", "");
        const fallenMaster = ctx.get("主角.核心状态.主人", "无");
        const markData = ctx.get("主角.永久性身体改造.组织刻印", null);
        ctx.set("主角.核心状态.恶堕备份", {
          英雄名: fallenName,
          紧身战衣: fallenSuit,
          代表色: fallenColor,
          核心能力: fallenAbility,
          性格特质: fallenTrait,
          主人: fallenMaster,
          组织刻印: markData
            ? {
                部位: markData.部位 || "脸颊",
                详情: markData.详情 || "",
                来源: markData.来源 || "怪人组织",
              }
            : null,
        });
        Logger.info(
          `📦 恶堕备份已保存反派身份：${fallenName} (主人: ${fallenMaster})`,
        );
        ctx.add("记录.善堕次数", 1);
        Logger.event(`🤍 善堕计数 +1 (当前: ${ctx.get("记录.善堕次数", 0)})`);
      }

      // 跨回合战斗日志与撤退状态清理
      if (curPhase !== "战斗回合") {
        ctx.set("主角.战斗临时.撤退尝试", 0);
        ctx.set("主角.战斗临时.撤退成功", false);
        ctx.set("主角.战斗临时.投降", false);
      }
      const cLog = ctx.get("主角.战斗临时.当前战斗日志");
      if (
        cLog &&
        cLog !== "无" &&
        cLog === ctx.getPrev("主角.战斗临时.当前战斗日志")
      ) {
        ctx.set("主角.战斗临时.当前战斗日志", "无");
      }

      // 精液耗尽清理来源
      if (ctx.get("主角.生理状态.体液与分泌.能量核心内精液.存量", 0) <= 0) {
        const sources = ctx.get(
          "主角.生理状态.体液与分泌.能量核心内精液.来源",
          {},
        );
        if (Object.keys(sources).length > 0) {
          ctx.set("主角.生理状态.体液与分泌.能量核心内精液.来源", {});
          Logger.info("🧼 精液存量耗尽，清空来源记录");
        }
      }

      // 清理待处理事件中的 false
      const pendingEvents = ctx.get("系统状态.待处理事件", {});
      Object.keys(pendingEvents).forEach((evKey) => {
        if (
          pendingEvents[evKey] === false ||
          pendingEvents[evKey] === "false"
        ) {
          ctx.unset(`系统状态.待处理事件.${evKey}`);
        }
      });

      // ══════════════════════════════════════════════════════════════════
      // --- 幕间事件垃圾回收与状态重置 (GC Engine) ---
      // ══════════════════════════════════════════════════════════════════
      const isEventCompletedNow = ctx.get("系统状态.幕间事件完成") === true;
      const wasEventCompletedBefore =
        String(ctx.getPrev("系统状态.幕间事件完成")) === "true";
      const hNameNow = ctx.get("世界.幕间H事件.名称", "无");
      const isNewEventStarting =
        ctx.getPrev("世界.幕间H事件.名称", "无") === "无" && hNameNow !== "无";

      const prevHConclusion = ctx.getPrev("系统状态.待处理事件.H事件落幕");
      const justRemovedHEventConclusion =
        (prevHConclusion === true || prevHConclusion === "true") &&
        !ctx.events["H事件落幕"];

      const shouldFinalizeHEvent =
        !isNewEventStarting &&
        hNameNow !== "无" &&
        (isEventCompletedNow || justRemovedHEventConclusion);

      if (shouldFinalizeHEvent) {
        // 声望推送（在 GC 清空 H事件名/主题之前捕获判定素材）
        if (
          !ctx.events["小英雄黑化"] &&
          !ctx.events["善堕事件"] &&
          !ctx.events["声望结算事件"] &&
          !ctx.events["战后声望结算事件"]
        ) {
          const isCapturedPrison =
            curPhase === "被捕囚禁" ||
            ctx.getPrev("进程.阶段") === "被捕囚禁" ||
            ctx.get("主角.囚禁状态.逃脱进度", 0) >= 100 ||
            ctx.getPrev("主角.囚禁状态.逃脱进度", 0) >= 100;
          const hEventNameBeforeGC = hNameNow;
          const hThemesBeforeGC = [
            ...(ctx.get("世界.幕间H事件.核心主题", []) || []),
          ].filter((t) => t && t !== "$__META_EXTENSIBLE__$" && t !== "$meta");
          const wasCapturedScenario =
            isCapturedPrison ||
            hThemesBeforeGC.includes("监禁") ||
            hThemesBeforeGC.includes("苗床化") ||
            hThemesBeforeGC.includes("洗脑");

          const bossNameBeforeGC = ctx.get("世界.当前关卡.名称", "无");
          const bossTypeBeforeGC = ctx.get("世界.当前关卡.战斗类型", "无");
          const bossThemesBeforeGC = [
            ...(ctx.get("世界.当前关卡.核心主题", []) || []),
          ].filter((t) => t && !t.startsWith("$"));

          ctx.set(
            "系统状态.待处理事件.声望结算事件",
            JSON.stringify({
              source: wasCapturedScenario ? "被俘" : "H事件落幕",
              h_event_name: hEventNameBeforeGC,
              h_event_themes: hThemesBeforeGC,
              boss_name: bossNameBeforeGC,
              boss_type: bossTypeBeforeGC,
              boss_themes: bossThemesBeforeGC,
            }),
          );
          Logger.event(
            `📢 H事件落幕，推送声望结算（来源：${wasCapturedScenario ? "被俘" : "H事件落幕"}，事件：[${hEventNameBeforeGC}]）`,
          );
        }

        if (!wasEventCompletedBefore || justRemovedHEventConclusion) {
          ctx.set("系统状态.幕间回合计数", 0);
          Logger.info("🧹 GC Engine: 回合计数置零归位。");

          if (justRemovedHEventConclusion) {
            ctx.set("系统状态.幕间事件完成", true);
            Logger.warn(
              "🛡️ GC Engine 防御性纠偏: 检测到H事件已落幕，强制重置 [系统状态.幕间事件完成] 为 true。",
            );
          }

          if (ctx.get("进程.阶段") === "幕间休息") {
            ctx.add("主角.核心状态.体力值.当前", 30);
            Logger.info("✅ GC Engine: 日常 H 事件正常消退，恢复 30 点体力。");
          }
        }

        if (hNameNow !== "无") {
          ctx.set("世界.幕间H事件.名称", "无");
          Logger.info("🧹 GC Engine: 重置 [世界.幕间H事件.名称] -> 无");
        }
        if (ctx.get("世界.幕间H事件.逃脱进度", 0) !== 0) {
          ctx.set("世界.幕间H事件.逃脱进度", 0);
        }
        const hThemes = ctx.get("世界.幕间H事件.核心主题", []);
        if (
          Array.isArray(hThemes) &&
          hThemes.filter(
            (t) => t && t !== "$__META_EXTENSIBLE__$" && t !== "$meta",
          ).length > 0
        ) {
          ctx.set("世界.幕间H事件.核心主题", []);
          Logger.info("🧹 GC Engine: 幕间主题池已清空释放。");
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 2. 响应式事件与生理推演 (Reactive Events & Physiology)
    // ══════════════════════════════════════════════════════════════════
    runReactiveSystem(ctx) {
      let pleasure = ctx.get("主角.快感状态.快感值", 0);
      let threshold = ctx.get("主角.快感状态.高潮阈值", 100);

      // 幕间H事件逃脱/满足进度判定
      const hProgress = ctx.get("世界.幕间H事件.逃脱进度");
      const isEventCompleted = ctx.get("系统状态.幕间事件完成", true);
      if (
        hProgress !== undefined &&
        !isEventCompleted &&
        hProgress >= 100 &&
        !ctx.events["H事件落幕"]
      ) {
        ctx.set("系统状态.待处理事件.H事件落幕", true);
        Logger.event("✨ 幕间H事件逃脱/满足进度达100%，挂载H事件落幕结算。");
      }

      // 高潮事件结算与循环扣减
      if (
        ctx.getPrev("系统状态.待处理事件.高潮事件") &&
        !ctx.events["高潮事件"]
      ) {
        let loopSafety = 0;
        while (pleasure >= threshold && loopSafety < 10) {
          pleasure -= threshold;
          loopSafety++;
          if (
            ctx.get("进程.阶段") === "战斗回合" &&
            ctx.personality === "英雄"
          ) {
            const hpD = _.random(5, 10),
              mpD = _.random(10, 20),
              corrD = _.random(8, 15);
            ctx.add("主角.核心状态.体力值.当前", -hpD);
            ctx.add("主角.核心状态.能量值.当前", -mpD);
            ctx.add("主角.快感状态.侵蚀度", corrD);
            threshold += 20;
            ctx.set("主角.快感状态.高潮阈值", threshold);
            Logger.warn(
              `💢 英雄战斗高潮反噬：HP-${hpD}, 能量-${mpD}, 侵蚀度+${corrD}, 阈值升至 ${threshold}`,
            );
          }
        }
        ctx.set("主角.快感状态.快感值", pleasure);

        if (loopSafety > 0) {
          ctx.add("主角.快感状态.总高潮次数", loopSafety);
          Logger.event(
            `🌊 高潮结算完毕：绝顶 ${loopSafety} 次，剩余快感 ${pleasure}`,
          );

          if (
            ctx.get("世界.幕间H事件.名称", "无") !== "无" &&
            hProgress !== undefined
          ) {
            ctx.add("世界.幕间H事件.逃脱进度", loopSafety * 30);
          }
          if (ctx.get("主角.黑暗印记.经验", 0) > 0) {
            ctx.add("主角.黑暗印记.经验", _.random(10, 15));
          }
        }
      }

      // 快感突破阈值挂起高潮事件
      if (pleasure >= threshold && !ctx.events["高潮事件"]) {
        ctx.set("系统状态.待处理事件.高潮事件", true);
        Logger.event(
          `💥 快感突破阈值！挂载高潮事件 (${pleasure}/${threshold})`,
        );

        if (ctx.get("进程.阶段") === "战斗回合") {
          const bossThemes = ctx
            .get("世界.当前关卡.核心主题", [])
            .filter((t) => t && !t.startsWith("$"));
          if (bossThemes.length > 0) {
            const xpGain = _.random(25, 40);
            bossThemes.forEach((t) => {
              if (ctx.get(`主角.快感状态.性癖.${t}`)) {
                ctx.add(`主角.快感状态.性癖.${t}.经验`, xpGain);
                Logger.event(`🧠 战中高潮性癖印刻：[${t}] +${xpGain}XP`);
              }
            });
          }
        }
      }

      // 能量核心扩张与满溢事件
      if (
        ctx.getPrev("系统状态.待处理事件.体内满溢事件") &&
        !ctx.events["体内满溢事件"]
      ) {
        const cap = ctx.get("主角.生理状态.能量核心状态.最大容量", 50);
        if (cap < 200) {
          const expanded = Math.min(200, cap + _.random(10, 20));
          ctx.set("主角.生理状态.能量核心状态.最大容量", expanded);
          Logger.event(`🏺 能量核心适应扩张，最大容量提升至 ${expanded}ml`);
        }
      }

      const semenAmt = ctx.get(
        "主角.生理状态.体液与分泌.能量核心内精液.存量",
        0,
      );
      const coreCap = ctx.get("主角.生理状态.能量核心状态.最大容量", 50);
      if (semenAmt > coreCap && !ctx.events["体内满溢事件"]) {
        ctx.set("系统状态.待处理事件.体内满溢事件", true);
        Logger.warn(
          `💦 精液存量 (${semenAmt}ml) 突破核心容量 (${coreCap}ml)，触发体内满溢！`,
        );
      }

      const semenDelta =
        semenAmt -
        ctx.getPrev("主角.生理状态.体液与分泌.能量核心内精液.存量", 0);
      // 英雄线战中被内射增加侵蚀度
      if (
        semenDelta > 0 &&
        ctx.personality === "英雄" &&
        ctx.get("进程.阶段") === "战斗回合"
      ) {
        const cGain =
          _.random(3, 8) + Math.floor(semenDelta / 50) * _.random(1, 3);
        ctx.add("主角.快感状态.侵蚀度", cGain);
        Logger.warn(
          `☣️ 英雄线战斗内射惩罚：侵蚀度 +${cGain} (注入量: ${semenDelta}ml)`,
        );
      }

      // 反派×小英雄：纯洁能力净化堕落（1ml精液 = -1侵蚀度）
      const combatType = ctx.get("世界.当前关卡.战斗类型", "无");
      if (
        semenDelta > 0 &&
        ctx.personality === "反派" &&
        combatType === "小英雄" &&
        ["战斗败北", "战斗回合", "终结回合", "战后处理"].includes(
          ctx.get("进程.阶段"),
        )
      ) {
        const purifyAmount = Math.min(
          semenDelta,
          ctx.get("主角.快感状态.侵蚀度", 0),
        );
        ctx.add("主角.快感状态.侵蚀度", -purifyAmount);
        Logger.info(
          `🕊️ 小英雄纯洁能力净化：侵蚀度 -${purifyAmount} (注入量: ${semenDelta}ml)`,
        );

        if (
          ctx.get("主角.快感状态.侵蚀度", 0) <= 0 &&
          !ctx.events["善堕事件"]
        ) {
          ctx.set("主角.快感状态.侵蚀度", 0);
          ctx.set("系统状态.待处理事件.善堕事件", true);
          Logger.event(
            "✨ 侵蚀度归零！主角体内的黑暗被完全净化，善堕事件触发！",
          );
        }
      }

      // 精液彻底排空自洁
      const prevSemenAmt = ctx.getPrev(
        "主角.生理状态.体液与分泌.能量核心内精液.存量",
        0,
      );
      if (prevSemenAmt > 0 && semenAmt <= 0 && ctx.personality === "英雄") {
        ctx.add("主角.快感状态.侵蚀度", -5);
        const curXp = ctx.get("主角.黑暗印记.经验", 0);
        if (curXp > 0) ctx.set("主角.黑暗印记.经验", Math.max(0, curXp - 10));
        Logger.event("✨ 核心精液彻底排空！侵蚀度 -5，黑暗印记经验 -10XP");
      }

      // 日期跨天结算（YYYYMMDD 格式）
      const currentDay = ctx.get("世界.日期", 20400305);
      const previousDay = ctx.getPrev("世界.日期", 20400305);
      const daysPassed = this._daysBetween(previousDay, currentDay);

      if (daysPassed > 0) {
        const effectiveDays = Math.min(daysPassed, 30);
        ctx.set("主角.快感状态.高潮阈值", 100);

        // 监禁天数由日期推进驱动，跨天重置今日洗脑状态
        if (ctx.phase === "被捕囚禁") {
          ctx.add("主角.囚禁状态.监禁天数", daysPassed);
          ctx.set("主角.囚禁状态.今日已洗脑", false);
          Logger.info(
            `📅 监禁日期推进 ${daysPassed} 天（当前进入第 ${ctx.get("主角.囚禁状态.监禁天数")} 天），重置今日洗脑状态`,
          );
        }

        // 校园催眠跨天重置
        ctx.set("世界.校园催眠.今日在校回合", 0);
        if (ctx.get("世界.校园催眠.主角在校", false)) {
          ctx.set("世界.校园催眠.疑心度", 0);
        }

        // 季节变换检测与事件挂载
        const prevDateObj = this._parseDate(previousDay);
        const currDateObj = this._parseDate(currentDay);
        const prevMonth = prevDateObj.getMonth() + 1;
        const currMonth = currDateObj.getMonth() + 1;

        const getSeasonInfo = (m) => {
          if (m >= 3 && m <= 5)
            return { season: "春", atmosphere: "春暖花开，微风和煦" };
          if (m >= 6 && m <= 8)
            return { season: "夏", atmosphere: "盛夏蝉鸣，日光炙热" };
          if (m >= 9 && m <= 11)
            return { season: "秋", atmosphere: "秋高气爽，凉意渐浓" };
          return { season: "冬", atmosphere: "寒冬凛冽，朔风刺骨" };
        };

        const prevSeasonInfo = getSeasonInfo(prevMonth);
        const currSeasonInfo = getSeasonInfo(currMonth);

        if (
          prevSeasonInfo.season !== currSeasonInfo.season &&
          !Object.keys(ctx.events).some((k) => k.startsWith("季节变换·"))
        ) {
          ctx.set(
            `系统状态.待处理事件.季节变换·${currSeasonInfo.season}`,
            currSeasonInfo.atmosphere,
          );
          Logger.event(
            `🍂 季节更迭：进入【${currSeasonInfo.season}季】（${currSeasonInfo.atmosphere}），挂载季节变换事件！`,
          );
        }

        let corruptDelta = 0;
        const isFallen =
          ctx.personality === "反派" || ctx.personality === "堕落";
        const curseLv = this._getCurseLv(ctx.get("主角.黑暗印记.经验", 0));
        for (let i = 0; i < effectiveDays; i++) {
          if (isFallen && ctx.get("主角.快感状态.侵蚀度", 0) > 20) {
            corruptDelta -= _.random(5, 10);
          } else if (!isFallen && ctx.get("主角.快感状态.侵蚀度", 0) > 0) {
            corruptDelta -= 2;
          }
          if (curseLv >= 3) corruptDelta += 4;
        }
        if (corruptDelta !== 0) {
          ctx.add("主角.快感状态.侵蚀度", corruptDelta);
          Logger.info(
            `⏳ 跨日自然代谢：侵蚀度变动 ${corruptDelta > 0 ? "+" + corruptDelta : corruptDelta}`,
          );
        }
      }

      // 新回合能量消耗与黑暗印记生长
      if (ctx.isNewTurn) {
        // 着装能量维持消耗
        if (ctx.get("主角.核心状态.着装状态", false)) {
          const maxMpVal = ctx.get("主角.核心状态.能量值.最大", 100);
          const pRatio = threshold > 0 ? pleasure / threshold : 0;
          const isCombatRelated = [
            "战斗准备",
            "战斗回合",
            "终结回合",
            "战斗败北",
            "战后处理",
          ].includes(ctx.get("进程.阶段"));
          let drainAmt = isCombatRelated ? 2 : 1;
          if (pRatio > 0.5)
            drainAmt += Math.max(1, Math.floor(maxMpVal * 0.05 * pRatio));
          if (drainAmt > 0) {
            ctx.add("主角.核心状态.能量值.当前", -drainAmt);
            Logger.info(
              `⚡ 维持着装消耗能量: -${drainAmt}点 (剩余: ${ctx.get("主角.核心状态.能量值.当前")}MP)`,
            );
          }
        }

        // 黑暗印记被动经验流转
        let xpGain = 0;
        const phase = ctx.get("进程.阶段");
        const isCombatRelated = [
          "战斗准备",
          "战斗回合",
          "终结回合",
          "战斗败北",
          "战后处理",
        ].includes(phase);
        const corruption = ctx.get("主角.快感状态.侵蚀度", 0);

        if (corruption < 20 && !isCombatRelated) xpGain -= 1;
        else if (corruption > 70) xpGain += 2;
        else if (corruption > 50) xpGain += 1;

        if (semenAmt > 0) {
          let nourish = Math.floor(semenAmt / 20) || 1;
          nourish = Math.min(nourish, 5);
          xpGain += ctx.personality === "反派" ? nourish * 2 : nourish;
        } else if (!isCombatRelated) {
          xpGain -= 2;
        }

        if (ctx.events["高潮事件"]) xpGain += _.random(8, 12);

        if (xpGain !== 0) {
          const curXp = ctx.get("主角.黑暗印记.经验", 0);
          if (curXp > 0) {
            const finalXp = Math.max(0, curXp + xpGain);
            ctx.set("主角.黑暗印记.经验", finalXp);
            Logger.info(
              `📈 黑暗印记经验变动：${xpGain > 0 ? "+" + xpGain : xpGain}XP (当前: ${finalXp})`,
            );
          }
        }
      }

      // 黑暗印记 Lv.2 / Lv.3 被动反噬
      const curseLv = this._getCurseLv(ctx.get("主角.黑暗印记.经验", 0));
      if (curseLv >= 2) {
        const mpLoss =
          ctx.getPrev("主角.核心状态.能量值.当前", 0) -
          ctx.get("主角.核心状态.能量值.当前", 0);
        if (mpLoss > 0) {
          const gain = Math.max(1, Math.floor(mpLoss * 0.3));
          ctx.add("主角.快感状态.快感值", gain);
          Logger.warn(
            `😈 黑暗印记能量发情：能量流失 ${mpLoss} → 转化为快感 +${gain}`,
          );
        }
      }
      if (curseLv >= 3) {
        const hpLoss =
          ctx.getPrev("主角.核心状态.体力值.当前", 0) -
          ctx.get("主角.核心状态.体力值.当前", 0);
        if (hpLoss > 0) {
          const gain = Math.max(1, Math.floor(hpLoss * 0.5));
          ctx.add("主角.快感状态.快感值", gain);
          Logger.warn(
            `🩸 黑暗印记痛觉转化：体力损伤 ${hpLoss} → 转化为快感 +${gain}`,
          );
        }
      }

      // 侵蚀度 100% 黑化临界
      if (
        ctx.personality === "英雄" &&
        ctx.get("主角.快感状态.侵蚀度", 0) >= 100
      ) {
        if (!ctx.events["黑化临界"] && !ctx.events["小英雄黑化"]) {
          ctx.set("系统状态.待处理事件.黑化临界", true);
          Logger.error("💀 侵蚀度触及100%极限！触发【黑化临界】事件！");
        }
      }

      // 能量耗尽强制解除着装
      if (
        ctx.get("主角.核心状态.着装状态") &&
        ctx.get("主角.核心状态.能量值.当前", 0) <= 0
      ) {
        ctx.set("主角.核心状态.着装状态", false);
        ctx.set("系统状态.待处理事件.强制解除着装", true);
        Logger.warn("💔 能量彻底耗尽，着装状态被强制解除！");
      }

      // 被捕囚禁双子系统与洗脑会话推演
      if (ctx.phase === "被捕囚禁") {
        const prevPhase = ctx.getPrev("进程.阶段", "");
        const isEnteringCaptivity = prevPhase !== "被捕囚禁";

        if (isEnteringCaptivity) {
          ctx.set("主角.囚禁状态.监禁回合", 1);
          ctx.set("主角.囚禁状态.监禁天数", 1);
          ctx.set("主角.囚禁状态.逃脱进度", 0);
          ctx.set("主角.囚禁状态.自由度加值", 0);
          ctx.set("主角.囚禁状态.今日已洗脑", false);
          ctx.set("主角.囚禁状态.洗脑中", false);
          ctx.set("主角.囚禁状态.洗脑剩余回合", 0);
          ctx.set("主角.囚禁状态.本次已触发身体改造", false);
          ctx.add("主角.囚禁状态.总被俘次数", 1);
          ctx.set("系统状态.待处理事件.囚禁醒来事件", true);

          const maxH = ctx.get("主角.核心状态.体力值.最大", 100);
          const maxM = ctx.get("主角.核心状态.能量值.最大", 100);
          ctx.set("主角.核心状态.体力值.当前", maxH);
          ctx.set("主角.核心状态.能量值.当前", Math.floor(maxM / 2));
          ctx.set("主角.核心状态.着装状态", false);
          ctx.set("主角.核心状态.当前战斗姿态", "监禁受辱");
          Logger.event("⛓️ 主角被俘关入基地，自动触发【囚禁醒来事件】");
        } else if (ctx.isNewTurn) {
          ctx.add("主角.囚禁状态.监禁回合", 1);
        }

        const prisonTurn = ctx.get("主角.囚禁状态.监禁回合", 1);
        const prisonDays = ctx.get("主角.囚禁状态.监禁天数", 1);

        // 自由度计算 (侵蚀度 + 加值)
        const corruption = ctx.get("主角.快感状态.侵蚀度", 0);
        const freedomMod = ctx.get("主角.囚禁状态.自由度加值", 0);
        const totalScore = corruption + freedomMod;

        let freedom = "严密监禁";
        if (totalScore >= 80) freedom = "信任囚徒";
        else if (totalScore >= 60) freedom = "半自由";
        else if (totalScore >= 30) freedom = "有限活动";

        const lastFreedom = ctx.get("主角.囚禁状态.上次自由度", "严密监禁");
        ctx.set("主角.囚禁状态.自由度", freedom);

        if (freedom !== lastFreedom && prisonTurn > 1 && !isEnteringCaptivity) {
          const TIERS = ["严密监禁", "有限活动", "半自由", "信任囚徒"];
          const curIdx = TIERS.indexOf(freedom);
          const prevIdx = TIERS.indexOf(lastFreedom);
          const direction = curIdx >= prevIdx ? "提升" : "收紧";
          ctx.set("主角.囚禁状态.变动方向", direction);
          ctx.set("主角.囚禁状态.前次自由度", lastFreedom);
          ctx.set("主角.囚禁状态.上次自由度", freedom);
          ctx.set("系统状态.待处理事件.囚禁自由度变化事件", true);
          Logger.event(
            `⛓️ 自由度跃迁: [${lastFreedom}] -> [${freedom}] (${direction})`,
          );
        }

        // 洗脑会话流转
        let isBrainwashingNow = ctx.get("主角.囚禁状态.洗脑中", false);
        let remainingTurns = ctx.get("主角.囚禁状态.洗脑剩余回合", 0);

        if (isBrainwashingNow) {
          if (ctx.isNewTurn) {
            remainingTurns -= 1;
            ctx.set("主角.囚禁状态.洗脑剩余回合", Math.max(0, remainingTurns));
            ctx.add("主角.囚禁状态.洗脑进度", _.random(10, 20));
          }
          if (remainingTurns <= 0) {
            ctx.set("主角.囚禁状态.洗脑中", false);
            ctx.set("系统状态.待处理事件.囚禁洗脑结束事件", true);
            Logger.event("🧠 当日洗脑审讯结束，返回日常监禁状态");
          }
        } else if (!isEnteringCaptivity && prisonTurn > 1 && ctx.isNewTurn) {
          const todayBrainwashed = ctx.get("主角.囚禁状态.今日已洗脑", false);
          if (!todayBrainwashed) {
            const triggerRoll = Math.random();
            if (triggerRoll <= 0.35 || prisonTurn === 2) {
              ctx.set("主角.囚禁状态.洗脑中", true);
              ctx.set("主角.囚禁状态.今日已洗脑", true);
              ctx.set("主角.囚禁状态.洗脑剩余回合", 3);
              ctx.set("系统状态.待处理事件.囚禁洗脑开始事件", true);
              Logger.warn(`🧠 触发第 ${prisonDays} 天洗脑审讯！持续 3 回合`);
            }
          }

          // 低概率身体改造
          const bodyModTriggered = ctx.get(
            "主角.囚禁状态.本次已触发身体改造",
            false,
          );
          if (!bodyModTriggered && Math.random() <= 0.01) {
            ctx.set("主角.囚禁状态.本次已触发身体改造", true);
            ctx.set("系统状态.待处理事件.囚禁身体改造事件", true);
            Logger.warn("🧬 触发囚禁身体改造事件！");
          }
        }

        // 逃脱与黑化出口判定
        if (
          ctx.get("主角.囚禁状态.逃脱进度", 0) >= 100 &&
          !ctx.events["囚禁逃脱事件"]
        ) {
          ctx.set("系统状态.待处理事件.囚禁逃脱事件", true);
          Logger.event("🚪 逃脱进度已达100%，推送逃脱机会事件！");
        }
        if (ctx.get("主角.囚禁状态.洗脑进度", 0) >= 100) {
          ctx.set("系统状态.待处理事件.小英雄黑化", true);
          ctx.set("进程.阶段", "幕间休息");
          this._executeIntermissionHeal(ctx);
          Logger.error("💀 洗脑进度满值！强制触发【小英雄黑化】事件！");
        } else if (corruption >= 100) {
          ctx.set("系统状态.待处理事件.黑化临界", true);
          ctx.set("进程.阶段", "幕间休息");
          this._executeIntermissionHeal(ctx);
          Logger.error("💀 侵蚀度触及100%！触发【黑化临界】事件！");
        }
      }

      // 校园催眠结界状态流转与响应系统
      const isAtSchool = ctx.get("世界.校园催眠.主角在校", false) === true;
      const prevIsAtSchool =
        ctx.getPrev("世界.校园催眠.主角在校", false) === true;
      const isBarrierBroken =
        ctx.get("世界.校园催眠.结界已破除", false) === true;
      const prevIsBarrierBroken =
        ctx.getPrev("世界.校园催眠.结界已破除", false) === true;

      if (isBarrierBroken && !prevIsBarrierBroken) {
        this._breakCampusHypnosis(ctx, "BARRIER_BROKEN");
      }

      if (!isBarrierBroken) {
        // 进入校门瞬间重置疑心度与单日在校回合
        if (isAtSchool && !prevIsAtSchool) {
          ctx.set("世界.校园催眠.疑心度", 0);
          ctx.set("世界.校园催眠.今日在校回合", 0);
          Logger.event(
            "🏫 主角跨入校门，激活【校园催眠结界】，疑心度与单日在校回合重置为 0",
          );
        }

        // 离开校门脱离结界
        if (!isAtSchool && prevIsAtSchool) {
          Logger.event(
            "🏫 主角离开校门，脱离【校园催眠结界】，记忆模糊褪色并恢复普通高中生日常",
          );
        }

        if (isAtSchool && ctx.isNewTurn && ctx.phase === "幕间休息") {
          ctx.add("世界.校园催眠.今日在校回合", 1);
          const turnsToday = ctx.get("世界.校园催眠.今日在校回合", 0);

          // 每日在校满 10 回合自动挂载放学事件，结束今日校园洗脑生活阶段
          if (turnsToday >= 10 && !ctx.events["校园催眠放学事件"]) {
            ctx.set("系统状态.待处理事件.校园催眠放学事件", true);
            Logger.event(
              "🔔 校园催眠日常结束：今日在校满10回合，放学铃声响起，挂载【校园催眠放学事件】！",
            );
          }

          const isFullHypno =
            ctx.get("世界.校园催眠.完全催眠阶段", false) === true;
          const suspVal = ctx.get("世界.校园催眠.疑心度", 0);
          const hypnoVal = ctx.get("世界.校园催眠.催眠进度", 0);

          if (!isFullHypno) {
            if (suspVal >= 100 && !ctx.events["校园催眠识破事件"]) {
              ctx.set("系统状态.待处理事件.校园催眠识破事件", true);
              Logger.warn("👁️ 疑心度达到 100%！挂载【校园催眠识破事件】！");
            }
            if (hypnoVal >= 100 && !ctx.events["校园认知重塑事件"]) {
              ctx.set("系统状态.待处理事件.校园认知重塑事件", true);
              ctx.set("世界.校园催眠.完全催眠阶段", true);
              ctx.set("世界.校园催眠.疑心度", 0);
              Logger.error(
                "💀 催眠进度达到 100%！心智彻底沦陷，挂载【校园认知重塑事件】！",
              );
            }
          } else {
            // 完全催眠状态下疑心度锁定为 0
            if (suspVal !== 0) ctx.set("世界.校园催眠.疑心度", 0);

            // 低概率外部救援事件触发 (5% 概率)
            if (!ctx.events["校园外部救援事件"] && Math.random() < 0.05) {
              ctx.set("系统状态.待处理事件.校园外部救援事件", true);
              Logger.event(
                "🚨 潜伏的救援者打破宁静！挂载【校园外部救援事件】！",
              );
            }
          }
        }
      }

      // 小英雄名录内射联动与善恶堕演化
      const roster = ctx.get("世界.小英雄名录", {});
      const prevRoster = ctx.getPrev("世界.小英雄名录", {});
      Object.keys(roster).forEach((realName) => {
        if (realName === "$meta" || realName === "$__META_EXTENSIBLE__$")
          return;
        const hero = roster[realName] || {};
        const prevHero = prevRoster[realName] || null;

        // 如果是新录入的角色（上一回合不存在）
        if (!prevHero) {
          if (hero.恶堕进度 === undefined)
            ctx.set(`世界.小英雄名录.${realName}.恶堕进度`, 0);
          if (hero.善堕进度 === undefined)
            ctx.set(`世界.小英雄名录.${realName}.善堕进度`, 0);
          return; // 新录入角色跳过阵营演化事件判定
        }

        // 检测被主角内射次数增量
        const curInjected = hero.被主角内射次数 || 0;
        const prevInjected = prevHero.被主角内射次数 || 0;
        if (curInjected > prevInjected && ctx.isNewTurn) {
          const delta = curInjected - prevInjected;
          if (ctx.personality === "英雄" && hero.人格阵营 === "反派") {
            ctx.add(`世界.小英雄名录.${realName}.善堕进度`, delta * 50);
            Logger.info(
              `🕊️ ${realName} 被主角内射 +${delta}，善堕进度 +${delta * 50}`,
            );
          } else if (ctx.personality === "反派" && hero.人格阵营 === "英雄") {
            ctx.add(`世界.小英雄名录.${realName}.恶堕进度`, delta * 50);
            Logger.info(
              `💀 ${realName} 被主角内射 +${delta}，恶堕进度 +${delta * 50}`,
            );
          }
        }

        // 满值推送事件（严格判定当前阵营）
        const evilProg = ctx.get(`世界.小英雄名录.${realName}.恶堕进度`, 0);
        const goodProg = ctx.get(`世界.小英雄名录.${realName}.善堕进度`, 0);
        if (
          hero.人格阵营 === "英雄" &&
          evilProg >= 100 &&
          !ctx.events["名录小英雄恶堕事件"]
        ) {
          ctx.set("系统状态.待处理事件.名录小英雄恶堕事件", realName);
          Logger.error(`💀 ${realName} 恶堕进度满值！推送名录小英雄恶堕事件！`);
        }
        if (
          hero.人格阵营 === "反派" &&
          goodProg >= 100 &&
          !ctx.events["名录小英雄善堕事件"]
        ) {
          ctx.set("系统状态.待处理事件.名录小英雄善堕事件", realName);
          Logger.event(`✨ ${realName} 善堕进度满值！推送名录小英雄善堕事件！`);
        }

        // 阵营切换重置进度并累计计数
        const curAl = hero.人格阵营;
        const prevAl = prevHero.人格阵营;
        if (curAl !== prevAl && prevAl) {
          ctx.set(`世界.小英雄名录.${realName}.恶堕进度`, 0);
          ctx.set(`世界.小英雄名录.${realName}.善堕进度`, 0);
          if (curAl === "反派") {
            ctx.add(`世界.小英雄名录.${realName}.恶堕次数`, 1);
            Logger.info(`📋 ${realName} 阵营切换：英雄→反派，恶堕次数 +1`);
          } else {
            ctx.add(`世界.小英雄名录.${realName}.善堕次数`, 1);
            Logger.info(`📋 ${realName} 阵营切换：反派→英雄，善堕次数 +1`);
          }
        }
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 3. 游戏主状态机 (Main Game State Machine)
    // ══════════════════════════════════════════════════════════════════
    runStateMachine(ctx) {
      // 幕间H事件触发时初始化
      const prevHName = ctx.getPrev("世界.幕间H事件.名称", "无");
      const currHName = ctx.get("世界.幕间H事件.名称", "无");

      if (prevHName === "无" && currHName !== "无") {
        ctx.set("系统状态.幕间事件完成", false);
        ctx.set("世界.幕间H事件.逃脱进度", 0);
        ctx.set("系统状态.幕间回合计数", 0);
        Logger.event(`🎬 触发日常幕间H事件 [${currHName}]，执行日常H初始化...`);
      }

      // 首次进入幕间休息
      if (
        ctx.getPrev("进程.阶段") === "创角阶段" &&
        ctx.get("进程.阶段") === "幕间休息"
      ) {
        Logger.event("🎬 首次进入幕间休息，执行初始世界环境装填...");
        ctx.set(
          "主角.核心状态.体力值.当前",
          ctx.get("主角.核心状态.体力值.最大", 100),
        );
        ctx.set(
          "主角.核心状态.能量值.当前",
          ctx.get("主角.核心状态.能量值.最大", 100),
        );
        ctx.set("主角.核心状态.当前战斗姿态", "非战斗");
        ctx.set("系统状态.幕间回合计数", 0);

        const threatRoll = Math.random();
        const initialThreat = threatRoll < 0.3 ? 1 : threatRoll < 0.9 ? 2 : 3;
        ctx.set("世界.威胁等级", initialThreat);

        const themePool = ctx
          .get("系统状态.Boss生成主题池", [])
          .filter((t) => t !== "$__META_EXTENSIBLE__$");
        ctx.set(
          "世界.当前关卡.核心主题",
          themePool.length > 0 ? [_.sample(themePool)] : [],
        );

        const kinks = ctx.get("主角.快感状态.性癖", {});
        const validKinks = Object.keys(kinks).filter(
          (k) =>
            k !== "$meta" &&
            kinks[k] &&
            (kinks[k].等级 >= 1 || kinks[k].经验 >= 50),
        );
        const rosterForSeed = ctx.get("世界.小英雄名录", {});
        const rosterEntries = Object.keys(rosterForSeed).filter(
          (k) => k !== "$meta" && k !== "$__META_EXTENSIBLE__$",
        );

        if (
          rosterEntries.length > 0 &&
          (validKinks.length === 0 || Math.random() < 0.3)
        ) {
          const pickedName = _.sample(rosterEntries);
          const bondType = Math.random() < 0.5 ? "情欲" : "亲密";
          ctx.set(
            "系统状态.待处理事件.幕间牵绊事件",
            `${pickedName}|${bondType}`,
          );
          ctx.set("系统状态.幕间事件完成", false);
        } else if (validKinks.length > 0) {
          ctx.set("世界.幕间H事件.核心主题", [_.sample(validKinks)]);
          ctx.set("系统状态.幕间事件完成", false);
        } else {
          ctx.set("世界.幕间H事件.核心主题", []);
          ctx.set("系统状态.幕间事件完成", true);
        }
      }

      // 幕间休息闲置回合计数
      if (ctx.get("进程.阶段") === "幕间休息") {
        const isCampusHypnosisActive =
          ctx.get("世界.校园催眠.主角在校", false) === true &&
          !ctx.get("世界.校园催眠.结界已破除", false);
        const hasActiveEvent =
          ctx.get("世界.幕间H事件.名称", "无") !== "无" ||
          !!ctx.events["幕间牵绊事件"] ||
          isCampusHypnosisActive;
        if (!hasActiveEvent && ctx.isNewTurn) {
          ctx.add("系统状态.幕间回合计数", 1);
        }
        const notes = ctx.get("世界.世界观备注", {});
        const noteCount = Object.keys(notes).filter(
          (k) => !k.startsWith("$"),
        ).length;
        if (
          (ctx.get("系统状态.幕间回合计数", 0) === 5 || noteCount >= 10) &&
          !ctx.events["线索整理事件"]
        ) {
          ctx.set("系统状态.待处理事件.线索整理事件", true);
          Logger.event("🗂️ 幕间维护：触发线索整理维护事件");
        }
      }

      // 战斗准备阶段
      if (ctx.get("进程.阶段") === "战斗准备") {
        ctx.set("世界.当前关卡.Boss韧性值", 100);
        ctx.set("世界.当前关卡.Boss状态", "完好");
        if (ctx.get("世界.当前关卡.名称", "无") === "无") {
          ctx.set("世界.当前关卡.名称", "未知的威胁");
        }
        this.counters.defeatPersistence = 0;
        Logger.event(`⚔️ 锁定目标: [${ctx.get("世界.当前关卡.名称")}]`);
      }

      // 战斗回合判定
      if (ctx.get("进程.阶段") === "战斗回合") {
        const hp = ctx.get("主角.核心状态.体力值.当前", 100);
        const bossHp = ctx.get("世界.当前关卡.Boss韧性值", 100);
        const ultUsed =
          (ctx.get("主角.核心状态.正义充能") === 0 &&
            ctx.getPrev("主角.核心状态.正义充能", 0) >= 100) ||
          (ctx.get("主角.核心状态.混沌充能") === 0 &&
            ctx.getPrev("主角.核心状态.混沌充能", 0) >= 100);

        if (bossHp <= 0 || ultUsed) {
          ctx.set("进程.阶段", "战斗胜利");
          Logger.event(
            `🏆 战斗胜利判定通过！(Boss韧性: ${bossHp} | 必杀释放: ${ultUsed})`,
          );
        } else if (hp <= 0) {
          ctx.set("进程.阶段", "战斗败北");
          ctx.set("主角.核心状态.当前战斗姿态", "力尽待辱");
          ctx.add("记录.总战败次数", 1);
          Logger.warn("🥀 战斗败北！主角体力归零，陷入[力尽待辱]战姿。");
        } else {
          const oldPosture = ctx.get("主角.核心状态.当前战斗姿态");
          const newPosture = hp > 35 ? "战斗中" : "劣势";
          if (oldPosture !== newPosture) {
            ctx.set("主角.核心状态.当前战斗姿态", newPosture);
          }
          ctx.set("世界.当前关卡.Boss状态", bossHp > 50 ? "完好" : "动摇");
        }
      }

      // 战绩注册
      if (
        ctx.get("进程.阶段") === "战斗胜利" &&
        ctx.getPrev("进程.阶段") !== "战斗胜利"
      )
        this._registerCombat(ctx, "WIN");
      if (
        ctx.get("进程.阶段") === "战斗败北" &&
        ctx.getPrev("进程.阶段") !== "战斗败北"
      )
        this._registerCombat(ctx, "LOSE");

      // 战败滞留与俘虏结算（仅常规遭遇生效，校园催眠/救援战由专属事件接管）
      const curCombatType = ctx.get("世界.当前关卡.战斗类型", "魔物");
      const isCampusCombat = [
        "校园催眠识破",
        "校园外部救援",
        "校园催眠",
      ].includes(curCombatType);

      if (
        ctx.get("进程.阶段") === "战斗败北" &&
        ctx.isNewTurn &&
        !isCampusCombat
      ) {
        if (!ctx.events["彻底败北结算"]) {
          this.counters.defeatPersistence++;
          Logger.info(
            `⏳ 战败滞留倒计时：${this.counters.defeatPersistence}/3`,
          );

          if (this.counters.defeatPersistence >= 3) {
            const threatLv = parseInt(ctx.get("世界.威胁等级", 1), 10);
            let captureChance =
              threatLv >= 3 ? 0.8 : threatLv === 2 ? 0.5 : 0.2;
            if (ctx.get("主角.快感状态.侵蚀度", 0) > 80) captureChance += 0.2;

            if (Math.random() < captureChance) {
              ctx.set("进程.阶段", "被捕囚禁");
              Logger.error(`⛓️ 战败检定被俘！转入【被捕囚禁】阶段`);
            } else {
              ctx.set("系统状态.待处理事件.彻底败北结算", true);
              if (
                !ctx.events["声望结算事件"] &&
                !ctx.events["战后声望结算事件"] &&
                !ctx.events["小英雄黑化"] &&
                !ctx.events["善堕事件"]
              ) {
                ctx.set(
                  "系统状态.待处理事件.声望结算事件",
                  JSON.stringify({
                    source: "战斗败北",
                    h_event_name: "无",
                    h_event_themes: [],
                    boss_name: ctx.get("世界.当前关卡.名称", "无"),
                    boss_type: ctx.get("世界.当前关卡.战斗类型", "无"),
                    boss_themes: [
                      ...(ctx.get("世界.当前关卡.核心主题", []) || []),
                    ].filter((t) => t && !t.startsWith("$")),
                  }),
                );
                Logger.event(
                  "📢 彻底败北结算确立，推送声望结算（来源：战斗败北）",
                );
              }
              Logger.error("💀 战败倒计时归零！挂载彻底败北结算！");
            }
            this.counters.defeatPersistence = 0;
          }
        }
      }

      // 彻底败北事件首次挂起声望推送兜底
      if (
        ctx.events["彻底败北结算"] &&
        !ctx.getPrev("系统状态.待处理事件.彻底败北结算") &&
        !ctx.events["声望结算事件"] &&
        !ctx.events["战后声望结算事件"] &&
        !ctx.events["小英雄黑化"] &&
        !ctx.events["善堕事件"]
      ) {
        ctx.set(
          "系统状态.待处理事件.声望结算事件",
          JSON.stringify({
            source: "战斗败北",
            h_event_name: "无",
            h_event_themes: [],
            boss_name: ctx.get("世界.当前关卡.名称", "无"),
            boss_type: ctx.get("世界.当前关卡.战斗类型", "无"),
            boss_themes: [
              ...(ctx.get("世界.当前关卡.核心主题", []) || []),
            ].filter((t) => t && !t.startsWith("$")),
          }),
        );
        Logger.event("📢 彻底败北事件挂载，推送声望结算（来源：战斗败北）");
      }

      // 撤退脱离声望推送兜底
      if (
        (ctx.get("主角.战斗临时.撤退成功") === true ||
          ctx.getPrev("主角.战斗临时.撤退成功") === true) &&
        !ctx.events["声望结算事件"] &&
        !ctx.events["战后声望结算事件"] &&
        !ctx.events["小英雄黑化"] &&
        !ctx.events["善堕事件"]
      ) {
        this._registerCombat(ctx, "ESCAPE");
      }

      // 超时保护
      if (ctx.isNewTurn) {
        this.counters.finisher =
          ctx.get("进程.阶段") === "终结回合" ? this.counters.finisher + 1 : 0;
        this.counters.victory =
          ctx.get("进程.阶段") === "战斗胜利" ? this.counters.victory + 1 : 0;
      }
      if (this.counters.finisher >= 2) {
        ctx.set("进程.阶段", "战斗胜利");
        this.counters.finisher = 0;
        Logger.info("✨ 终结技超时，强制推进至战斗胜利。");
      }
      if (this.counters.victory >= 3) {
        ctx.set("进程.阶段", "战后处理");
        ctx.set("系统状态.待处理事件.状态演化事件", true);
        this.counters.victory = 0;
        Logger.info("⏭️ 胜利演出超时，强制推进至战后处理。");
      }

      if (ctx.get("进程.阶段") === "战后处理" && !ctx.events["状态演化事件"]) {
        ctx.set("系统状态.待处理事件.状态演化事件", true);
      }

      // 战后处理过渡回幕间
      if (
        ctx.get("进程.阶段") === "战后处理" &&
        ctx.getPrev("进程.阶段") === "战后处理"
      ) {
        this._executeIntermissionHeal(ctx);
        ctx.set("进程.阶段", "幕间休息");
        Logger.event("♻️ 战后过渡完成，系统重置归档，返回幕间休息");
      }

      // 从被捕囚禁回归日常
      if (
        ctx.get("进程.阶段") === "幕间休息" &&
        ctx.getPrev("进程.阶段") === "被捕囚禁"
      ) {
        if (
          !ctx.events["声望结算事件"] &&
          !ctx.events["战后声望结算事件"] &&
          !ctx.events["小英雄黑化"] &&
          !ctx.events["善堕事件"]
        ) {
          ctx.set(
            "系统状态.待处理事件.声望结算事件",
            JSON.stringify({
              source: "被俘",
              h_event_name: "无",
              h_event_themes: [],
              boss_name: ctx.get("世界.当前关卡.名称", "无"),
              boss_type: ctx.get("世界.当前关卡.战斗类型", "无"),
              boss_themes: [
                ...(ctx.get("世界.当前关卡.核心主题", []) || []),
              ].filter((t) => t && !t.startsWith("$")),
            }),
          );
          Logger.event("📢 从被捕囚禁脱出回归日常，推送声望结算（来源：被俘）");
        }
        if (!ctx.events["状态演化事件"]) {
          ctx.set("系统状态.待处理事件.状态演化事件", true);
        }
        Logger.info("🔧 从被捕囚禁回归日常，推送状态演化事件与声望结算");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 4. 里程碑与被动演化 (Milestones & Passive Evolution)
    // ══════════════════════════════════════════════════════════════════
    runMilestones(ctx) {
      // 基础强度里程碑
      const pStr = ctx.getPrev("主角.核心状态.基础强度", 50),
        cStr = ctx.get("主角.核心状态.基础强度", 50);
      if (cStr > pStr) {
        for (let t = 70; t <= 300; t += 20) {
          if (pStr < t && cStr >= t) {
            ctx.set("系统状态.待处理事件.武装升级事件", true);
            Logger.event(`💎 强度突破至 ${t}，触发武装升级事件！`);
            break;
          }
        }
      }

      // 知名度里程碑事件
      const pFame = ctx.getPrev("名声.知名度", 0),
        cFame = ctx.get("名声.知名度", 0);
      if (cFame > pFame) {
        let title = "";
        if (pFame < 15 && cFame >= 15) title = "都市传说";
        else if (pFame < 45 && cFame >= 45) title = "公众热议";
        else if (pFame < 85 && cFame >= 85) title = "无人不晓";
        if (title) {
          ctx.set("系统状态.待处理事件.知名度升级事件", title);
          Logger.event(`📣 知名度晋升为【${title}】！`);
        }
      }

      // 性癖经验与等级计算
      const kinks = ctx.get("主角.快感状态.性癖", {});
      Object.keys(kinks).forEach((k) => {
        if (k.startsWith("$")) return;
        const xp = parseInt(kinks[k].经验 || 0);
        const currLv = parseInt(kinks[k].等级 || 0);
        let newLv = 0;
        for (const t of CONFIG.KINK_THRESHOLDS) {
          if (xp >= t.xp) {
            newLv = t.level;
            break;
          }
        }
        if (newLv !== currLv) {
          ctx.set(`主角.快感状态.性癖.${k}.等级`, newLv);
          Logger.event(`🌟 性癖升级：[${k}] Lv.${currLv} ➜ Lv.${newLv}`);
        }
        if (
          newLv >= 3 &&
          !ctx.events["性癖觉醒事件"] &&
          !ctx.get(`世界.世界观备注.觉醒记录_${k}`)
        ) {
          ctx.set("系统状态.待处理事件.性癖觉醒事件", k);
          Logger.warn(`🧠 性癖 [${k}] 抵达 Lv.3，触发觉醒事件！`);
        }
      });

      // 黑暗印记等级跃迁判定
      const cxp = ctx.get("主角.黑暗印记.经验", 0);
      const pxp = ctx.getPrev("主角.黑暗印记.经验", 0);
      const curLv = this._getCurseLv(cxp);
      const prevLv = this._getCurseLv(pxp);

      const isCursePending =
        ctx.events["黑暗印记显现事件"] ||
        ctx.events["黑暗印记进化事件"] ||
        ctx.events["黑暗印记降级事件"];

      let logicalPrevLv = prevLv;
      if (
        ctx.getPrev("系统状态.待处理事件.黑暗印记显现事件") &&
        !ctx.events["黑暗印记显现事件"]
      )
        logicalPrevLv = Math.max(1, logicalPrevLv);
      if (
        ctx.getPrev("系统状态.待处理事件.黑暗印记进化事件") &&
        !ctx.events["黑暗印记进化事件"]
      )
        logicalPrevLv = curLv;
      if (
        ctx.getPrev("系统状态.待处理事件.黑暗印记降级事件") &&
        !ctx.events["黑暗印记降级事件"]
      )
        logicalPrevLv = curLv;

      if (!isCursePending) {
        const cCorr = ctx.get("主角.快感状态.侵蚀度", 0);
        const prevSemen = ctx.getPrev(
          "主角.生理状态.体液与分泌.能量核心内精液.存量",
          0,
        );
        const curSemen = ctx.get(
          "主角.生理状态.体液与分泌.能量核心内精液.存量",
          0,
        );
        const triggerByCorr =
          ctx.personality === "英雄" &&
          cCorr >= 30 &&
          curSemen > 0 &&
          prevSemen <= 0;
        const triggerByVillain =
          ctx.personality === "反派" &&
          cCorr >= 10 &&
          curSemen > 0 &&
          prevSemen <= 0;

        if (curLv > logicalPrevLv) {
          if (logicalPrevLv === 0) {
            ctx.set("系统状态.待处理事件.黑暗印记显现事件", true);
            Logger.warn(`👁️‍🗨️ 黑暗印记显现！(XP: ${cxp})`);
          } else {
            ctx.set("系统状态.待处理事件.黑暗印记进化事件", true);
            Logger.warn(`🔺 黑暗印记进化至 Lv.${curLv}！(XP: ${cxp})`);
          }
        } else if (curLv < logicalPrevLv) {
          const phase = ctx.get("进程.阶段");
          const isCombatRelated = [
            "战斗准备",
            "战斗回合",
            "终结回合",
            "战斗败北",
            "战后处理",
          ].includes(phase);
          if (isCombatRelated) {
            const safeXp =
              logicalPrevLv === 1 ? 1 : logicalPrevLv === 2 ? 150 : 400;
            ctx.set("主角.黑暗印记.经验", safeXp);
            Logger.info(`🛡️ 激战期印记等级保护，重置为 ${safeXp}XP`);
          } else {
            ctx.set("系统状态.待处理事件.黑暗印记降级事件", true);
            Logger.event(`🔻 黑暗印记降级至 Lv.${curLv}`);
          }
        } else if (curLv === 0 && (triggerByCorr || triggerByVillain)) {
          ctx.set("系统状态.待处理事件.黑暗印记显现事件", true);
          Logger.warn("👁️‍🗨️ 满足特殊环境诱发条件，唤醒黑暗印记！");
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 5. 声望派生与沉寂衰减 (Reputation Derivation & Decay)
    // ══════════════════════════════════════════════════════════════════
    _getFameLevel(fame) {
      if (fame < 15) return "默默无闻";
      if (fame < 45) return "都市传说";
      if (fame < 85) return "公众热议";
      return "无人不晓";
    }

    _getRepLevel(rep, isFallen) {
      if (isFallen) {
        if (rep <= -70) return "令人战栗的灾厄";
        if (rep <= -30) return "可怕的反派小英雄";
        if (rep < 30) return "一点也不可怕而且很色";
        return "国民级涩情偶像";
      } else {
        if (rep >= 70) return "圣洁的英雄";
        if (rep >= 30) return "可靠的守护者";
        if (rep > -30) return "争议小英雄";
        if (rep > -70) return "下流的骚货";
        return "公共肉便器";
      }
    }

    _runReputationDecay(ctx) {
      try {
        if (ctx.get("进程.阶段") !== "幕间休息") return;
        if (ctx.get("世界.幕间H事件.名称", "无") !== "无") return;

        const fameDelta =
          ctx.get("名声.知名度", 0) - ctx.getPrev("名声.知名度", 0);
        const repDelta = ctx.get("名声.风评", 0) - ctx.getPrev("名声.风评", 0);

        if (fameDelta !== 0 || repDelta !== 0) {
          if (ctx.get("名声.沉寂时间", 0) !== 0) {
            ctx.set("名声.沉寂时间", 0);
          }
          return;
        }

        const currDay = ctx.get("世界.日期", 20400305);
        const prevDay = ctx.getPrev("世界.日期", 20400305);
        const daysPassed = this._daysBetween(prevDay, currDay);
        if (daysPassed <= 0) return;

        ctx.add("名声.沉寂时间", daysPassed);
        const silent = ctx.get("名声.沉寂时间", 0);
        if (silent < this.repConfig.decayInterval) return;

        let times = Math.floor(silent / this.repConfig.decayInterval);
        if (times > this.repConfig.maxDecayPerTick)
          times = this.repConfig.maxDecayPerTick;

        let fame = ctx.get("名声.知名度", 0);
        let rep = ctx.get("名声.风评", 0);

        for (let i = 0; i < times; i++) {
          if (fame > 0) fame -= 1;
          if (rep > 0) rep -= 1;
          else if (rep < 0) rep += 1;
        }

        ctx.set("名声.知名度", fame);
        ctx.set("名声.风评", rep);
        ctx.set("名声.沉寂时间", silent - times * this.repConfig.decayInterval);
        Logger.info(`📉 声望沉寂衰减 ×${times}：知名度 ${fame}，风评 ${rep}`);
      } catch (e) {
        Logger.warn("声望衰减计算异常: " + e.message);
      }
    }

    _deriveReputation(ctx) {
      try {
        const isFallen =
          ctx.personality === "反派" || ctx.personality === "堕落";
        const fameLv = this._getFameLevel(ctx.get("名声.知名度", 0));
        const repLv = this._getRepLevel(ctx.get("名声.风评", 0), isFallen);

        if (ctx.get("名声.知名度等级") !== fameLv) {
          ctx.set("名声.知名度等级", fameLv);
        }
        if (ctx.get("名声.风评等级") !== repLv) {
          ctx.set("名声.风评等级", repLv);
        }
      } catch (e) {
        Logger.warn("声望派生计算异常: " + e.message);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ██ 6. 辅助工具方法 (Helpers)
    // ══════════════════════════════════════════════════════════════════
    _getCurseLv(xp) {
      return xp <= 0 ? 0 : xp < 150 ? 1 : xp < 400 ? 2 : 3;
    }

    _parseDate(d) {
      const raw = parseInt(d, 10) || 20400305;
      const y = Math.floor(raw / 10000);
      const m = Math.floor((raw % 10000) / 100);
      const day = raw % 100;
      return new Date(y, Math.max(0, m - 1), Math.max(1, day));
    }

    _daysBetween(fromD, toD) {
      if (!fromD || !toD || fromD === toD) return 0;
      const date1 = this._parseDate(fromD);
      const date2 = this._parseDate(toD);
      const diffTime = date2.getTime() - date1.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 0;
    }

    _advanceDate(raw, days = 1) {
      const date = this._parseDate(raw);
      date.setDate(date.getDate() + days);
      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const d = date.getDate();
      return y * 10000 + m * 100 + d;
    }

    _registerCombat(ctx, result) {
      const name = ctx.get("世界.当前关卡.名称", "未知敌人");
      const bossType = ctx.get("世界.当前关卡.战斗类型", "魔物");
      const bossThemes = [
        ...(ctx.get("世界.当前关卡.核心主题", []) || []),
      ].filter((t) => t && !t.startsWith("$"));

      // 1. 声望推送提前到 Boss 清空之前（确保携带完整的敌人快照）
      if (
        !ctx.events["声望结算事件"] &&
        !ctx.events["战后声望结算事件"] &&
        !ctx.events["小英雄黑化"] &&
        !ctx.events["善堕事件"]
      ) {
        if (result === "WIN") {
          ctx.set(
            "系统状态.待处理事件.声望结算事件",
            JSON.stringify({
              source: "战斗胜利",
              h_event_name: "无",
              h_event_themes: [],
              boss_name: name,
              boss_type: bossType,
              boss_themes: bossThemes,
            }),
          );
          Logger.event("📢 战斗胜利确立，推送声望结算（来源：战斗胜利）");
        } else if (result === "ESCAPE") {
          ctx.set(
            "系统状态.待处理事件.声望结算事件",
            JSON.stringify({
              source: "逃离",
              h_event_name: "无",
              h_event_themes: [],
              boss_name: name,
              boss_type: bossType,
              boss_themes: bossThemes,
            }),
          );
          Logger.event("📢 战术撤退确立，推送声望结算（来源：逃离）");
        }
      }

      if (name === "无" || name === "未知敌人") {
        Logger.warn(
          "⚠️ BOSS 名称为空，跳过生涯数据注册（声望结算已正常推送）。",
        );
        return;
      }

      const entry = {
        名称: name,
        核心主题: bossThemes,
        战斗类型: bossType,
        遭遇阵营: ctx.personality,
        结果: result,
      };
      _.set(ctx.data, ["记录", "已击败的Boss", name], entry);
      ctx.set("世界.当前关卡.Boss韧性值", 0);
      ctx.set("主角.核心状态.当前战斗姿态", "非战斗");

      const combatType = ctx.get("世界.当前关卡.战斗类型", "魔物");
      const isCampusBreakthrough =
        combatType === "校园催眠识破" ||
        combatType === "校园催眠" ||
        name.includes("教官");
      const isCampusRescue = combatType === "校园外部救援";

      if (result === "WIN") {
        ctx.add("记录.已击败Boss计数", 1);

        if (isCampusBreakthrough) {
          ctx.set("系统状态.待处理事件.校园催眠识破胜利事件", true);
          Logger.event("🏆 识破决战大获全胜！挂载【校园催眠识破胜利事件】！");
        } else if (isCampusRescue) {
          ctx.set("系统状态.待处理事件.校园救援同化事件", true);
          Logger.event(
            "😈 主角以精锐战斗员身份击败救援者，挂载【校园救援同化事件】！",
          );
        }

        if (
          ctx.personality === "英雄" &&
          ctx.get("主角.黑暗印记.经验", 0) > 0 &&
          !isCampusRescue
        ) {
          const cleanse = _.random(15, 25);
          ctx.set(
            "主角.黑暗印记.经验",
            Math.max(0, ctx.get("主角.黑暗印记.经验") - cleanse),
          );
          Logger.info(`👼 英雄线胜利结算：黑暗印记经验 -${cleanse}`);
        }
        const tl = parseInt(ctx.get("世界.威胁等级", 1), 10);
        let strGain = 0,
          hpGain = 0,
          mpGain = 0;
        if (tl === 3) {
          strGain = _.random(8, 13);
          hpGain = 10;
          mpGain = 10;
          ctx.set("系统状态.待处理事件.主角能力成长", "3");
        } else if (tl === 2) {
          strGain = _.random(4, 9);
          hpGain = 5;
          mpGain = 5;
          ctx.set("系统状态.待处理事件.主角能力成长", "2");
        } else {
          strGain = _.random(1, 6);
          hpGain = 3;
          mpGain = 3;
        }
        ctx.add("主角.核心状态.基础强度", strGain);
        ctx.add("主角.核心状态.体力值.最大", hpGain);
        ctx.add("主角.核心状态.能量值.最大", mpGain);
        Logger.event(
          `💪 战斗结算：强度+${strGain}, HP上限+${hpGain}, 能量上限+${mpGain}`,
        );
      }

      if (result === "LOSE") {
        if (isCampusBreakthrough) {
          ctx.set("系统状态.待处理事件.校园催眠识破败北事件", true);
          ctx.unset("系统状态.待处理事件.彻底败北结算");
          ctx.unset("系统状态.待处理事件.战败被俘结算");
          Logger.warn("🥀 识破决战败北！挂载【校园催眠识破败北事件】！");
        } else if (isCampusRescue) {
          ctx.set("系统状态.待处理事件.校园救援成功事件", true);
          ctx.unset("系统状态.待处理事件.彻底败北结算");
          ctx.unset("系统状态.待处理事件.战败被俘结算");
          Logger.event(
            "💥 外部救援英雄战胜主角并击碎结界！挂载【校园救援成功事件】！",
          );
        }
      }

      if (combatType === "小英雄") {
        const roster = ctx.get("世界.小英雄名录", {});
        const matchedKey = Object.keys(roster).find((k) => {
          if (k === "$meta" || k === "$__META_EXTENSIBLE__$") return false;
          return roster[k].英雄名 === name || roster[k].堕落英雄名 === name;
        });
        if (matchedKey) {
          if (result === "WIN")
            ctx.add(`世界.小英雄名录.${matchedKey}.败于主角次数`, 1);
          else ctx.add(`世界.小英雄名录.${matchedKey}.战胜主角次数`, 1);
          Logger.info(`📋 小英雄名录更新：${matchedKey} 战绩已记录`);
        }
      }
    }

    _breakCampusHypnosis(ctx, reason = "VICTORY") {
      ctx.set("世界.校园催眠.结界已破除", true);
      ctx.set("世界.校园催眠.主角在校", false);
      const loreNote =
        "虽然校园催眠结界已被彻底破除，但曾在教官支配下身穿漆黑全包紧身衣与紫色目镜、作为战斗员受训侍奉的淫乱记忆却被永久烙印在潜意识深处。每当穿上紧身战衣或面对强压时，身心与能量核心仍会泛起条件反射般的顺从快感与燥热。";
      ctx.set("世界.世界观备注.校园催眠后遗症", loreNote);

      // 赋予性癖经验成长
      const kinksToBoost = [
        "拘束&紧缚",
        "精神控制",
        "主动侍奉",
        "屈服&败北",
        "露出",
      ];
      kinksToBoost.forEach((k) => {
        if (ctx.get(`主角.快感状态.性癖.${k}`)) {
          ctx.add(`主角.快感状态.性癖.${k}.经验`, 80);
        }
      });
      Logger.event(
        `💥 校园催眠结界已破除 (${reason})！写入世界观后遗症备注并提升相关性癖经验 (+40 XP)`,
      );
    }

    _executeIntermissionHeal(ctx) {
      //const rawDate = ctx.get("世界.日期", 20400305);
      //ctx.set("世界.日期", this._advanceDate(rawDate, 1));
      ctx.set("系统状态.幕间回合计数", 0);
      ctx.set(
        "主角.核心状态.体力值.当前",
        ctx.get("主角.核心状态.体力值.最大", 100),
      );
      ctx.set(
        "主角.核心状态.能量值.当前",
        ctx.get("主角.核心状态.能量值.最大", 100),
      );
      ctx.set("主角.核心状态.着装状态", false);
      ctx.set("主角.核心状态.正义充能", 0);
      ctx.set("主角.核心状态.混沌充能", 0);
      ctx.set("主角.核心状态.当前战斗姿态", "非战斗");
      ctx.set("主角.快感状态.快感值", 0);

      ["面部", "胸部", "手臂", "腰腹", "臀部", "私处", "腿部"].forEach((p) => {
        ctx.set(`主角.身体部位状况.${p}`, "完好");
      });

      ctx.set("世界.当前关卡.名称", "无");
      ctx.set("世界.当前关卡.战斗类型", "无");
      ctx.set("世界.幕间H事件.名称", "无");

      const themePool = ctx
        .get("系统状态.Boss生成主题池", [])
        .filter((t) => t !== "$__META_EXTENSIBLE__$");
      ctx.set(
        "世界.当前关卡.核心主题",
        themePool.length > 0 ? [_.sample(themePool)] : [],
      );

      const kinks = ctx.get("主角.快感状态.性癖", {});
      const validKinks = Object.keys(kinks).filter(
        (k) =>
          k !== "$meta" &&
          kinks[k] &&
          (kinks[k].等级 >= 1 || kinks[k].经验 >= 50),
      );
      const rosterForSeed = ctx.get("世界.小英雄名录", {});
      const rosterEntries = Object.keys(rosterForSeed).filter(
        (k) => k !== "$meta" && k !== "$__META_EXTENSIBLE__$",
      );

      if (
        rosterEntries.length > 0 &&
        (validKinks.length === 0 || Math.random() < 0.3)
      ) {
        const pickedName = _.sample(rosterEntries);
        const bondType = Math.random() < 0.5 ? "情欲" : "亲密";
        ctx.set(
          "系统状态.待处理事件.幕间牵绊事件",
          `${pickedName}|${bondType}`,
        );
        ctx.set("系统状态.幕间事件完成", false);
      } else if (validKinks.length > 0) {
        ctx.set("世界.幕间H事件.核心主题", [_.sample(validKinks)]);
        ctx.set("系统状态.幕间事件完成", false);
      } else {
        ctx.set("世界.幕间H事件.核心主题", []);
        ctx.set("系统状态.幕间事件完成", true);
      }
      ctx.set("系统状态.待处理事件.幕间休息完全恢复", true);
      Logger.info("🛏️ 战后大洗牌：状态恢复满值，伤势完好，新雷达布防完毕。");
    }
  }

  $(() => {
    if (!window.LittleHeroEngineInstance) {
      window.LittleHeroEngineInstance = new LittleHeroEngine();
      setTimeout(() => window.LittleHeroEngineInstance.init(), 1000);
    }
  });

  $(window).on("unload", () => {});
})();
