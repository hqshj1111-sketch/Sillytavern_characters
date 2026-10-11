/**
 * 魔法少女 MVU 核心游戏引擎
 * v23.8.6
 */
(function () {
    const SCRIPT_NAME = '魔法少女MVU引擎';
    const SCRIPT_VERSION = 'v23.8.6';

    const CONFIG = {
        KINK_THRESHOLDS: [
            { level: 4, xp: 1000 },
            { level: 3, xp: 500 },
            { level: 2, xp: 250 },
            { level: 1, xp: 100 },
            { level: 0, xp: 0 }
        ],
        VALID_PHASES: [
            '创角阶段',
            '幕间休息',
            '战斗准备',
            '战斗回合',
            '终结回合',
            '战斗胜利',
            '战斗败北',
            '战后处理'
        ],
        VALID_POSTURES: [
            '非战斗',
            '战斗中',
            '劣势',
            '力尽待辱',
            '战后虚弱'
        ]
    };

    const Logger = {
        info: (msg) => console.log(`[${SCRIPT_NAME}] 🔵 ${msg}`),
        warn: (msg) => console.warn(`[${SCRIPT_NAME}] 🟡 ${msg}`),
        error: (msg) => {
            console.error(`[${SCRIPT_NAME}] 🔴 ${msg}`);
            if (window.toastr) toastr.error(msg, SCRIPT_NAME);
        },
        event: (msg) => console.log(`[${SCRIPT_NAME}] ✨ ${msg}`),
        toast: (msg, type = 'success') => {
            console.log(`[${SCRIPT_NAME}] 💬 ${msg}`);
            if (window.toastr) toastr[type](msg, '状态更新');
        }
    };

    const getChatContext = () => {
        try {
            return (typeof SillyTavern !== 'undefined')
                ? SillyTavern.getContext()?.chat || []
                : (window.SillyTavern ? window.SillyTavern.getContext()?.chat || [] : []);
        } catch (e) {
            return [];
        }
    };

    class MagicGirlEngine {
        constructor() {
            this.initialized = false;
            this.baseTurnData = null;
            this.previousData = null;
            this.lastTurnSignature = '';
            this.lastMsgObject = null;
            this.retryCount = 0;
            this.MAX_RETRIES = 10;
            this.counters = { finisher: 0, victory: 0, defeatPersistence: 0 };
            this.repConfig = {
                decayInterval: 2,
                maxDecayPerTick: 5
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
                        Logger.error('未检测到MVU框架，核心引擎无法启动！');
                    }
                    return;
                }

                eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (wrapper) => {
                    this.tick(wrapper?.stat_data || wrapper);
                });

                this.updateTimeline();
                this.initialized = true;
                if (window.toastr) toastr.success(`${SCRIPT_VERSION} 挂载完成，引擎全功率运转。`, SCRIPT_NAME);
                Logger.event('🚀 核心引擎初始化完成，开始监听变量...');
            } catch (error) {
                Logger.error('引擎初始化遇到严重错误: ' + error.message);
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
                Logger.warn('🔄 侦测到重新生成 (Swipe)，回滚内存快照防止数据污染。');
                this.previousData = _.cloneDeep(this.baseTurnData);
            } else if (isNewAiTurn && !this.isSwipe) {
                Logger.info('📝 新回合产生，提交上回合暂存数据，锁定基线快照。');
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
                this.isSwipe = this.lastTurnSignature.split('_')[0] === String(chat.length);

                if (isDifferentObject && this.isSwipe) {
                    Logger.warn(`🗑️ 侦测到当前楼层被删除并重写（索引：${chat.length}，消息对象已刷新）。回滚至上一层安全快照以重置变量状态。`);
                } else if (isDifferentObject && !this.isSwipe) {
                    Logger.info(`⏳ 建立全新 AI 楼层实例关联（长度：${chat.length}）。变量同步器已成功锁定历史基线，开启新回合。`);
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
                phase: _.get(data, '进程.阶段', '幕间休息'),
                personality: _.get(data, '主角.核心状态.人格状态', '善良'),
                events: _.get(data, '系统状态.待处理事件', {}),
                get: (path, def) => _.get(data, path, def),
                getPrev: (path, def) => _.get(this.previousData, path, def),
                set: (path, val) => _.set(data, path, val),
                unset: (path) => _.unset(data, path),
                add: (path, delta) => {
                    const current = parseFloat(_.get(data, path, 0)) || 0;
                    _.set(data, path, current + (parseFloat(delta) || 0));
                }
            };
        }


        // --- 1. 数据清洗与格式纠偏 ---
        runSanitizer(ctx) {
            ['主角.核心状态.变身状态', '系统状态.主角创建完毕', '系统状态.幕间事件完成'].forEach(p => {
                const v = ctx.get(p);
                if (v === 'true') {
                    ctx.set(p, true);
                    Logger.info(`⚖️ Sanitizer: 类型纠偏 [${p}] String -> Boolean (true)`);
                }
                if (v === 'false') {
                    ctx.set(p, false);
                    Logger.info(`⚖️ Sanitizer: 类型纠偏 [${p}] String -> Boolean (false)`);
                }
            });

            if (!CONFIG.VALID_PHASES.includes(ctx.get('进程.阶段'))) {
                Logger.warn(`⚖️ Sanitizer: 进程阶段越界 [${ctx.get('进程.阶段')}] -> 强制重置为: 幕间休息`);
                ctx.set('进程.阶段', '幕间休息');
            }
            if (!CONFIG.VALID_POSTURES.includes(ctx.get('主角.核心状态.当前战斗姿态'))) {
                Logger.warn(`⚖️ Sanitizer: 战斗姿态越界 [${ctx.get('主角.核心状态.当前战斗姿态')}] -> 强制重置为: 非战斗`);
                ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
            }

            const rawMaxHp = ctx.get('主角.核心状态.体力值.max', ctx.get('主角.核心状态.体力值.最大', 100));
            const isPregnant = ctx.get('主角.生理状态.子宫状态.受孕状态', '未受孕') !== '未受孕';
            const effectiveMaxHp = isPregnant ? Math.max(0, rawMaxHp - 20) : rawMaxHp;

            const maxMp = ctx.get('主角.核心状态.魔力值.max', ctx.get('主角.核心状态.魔力值.最大', 100));
            const clampRules = [
                ['主角.核心状态.体力值.当前', 0, effectiveMaxHp],
                ['主角.核心状态.魔力值.当前', 0, maxMp],
                ['主角.快感状态.快感值', 0, 9999],
                ['主角.快感状态.污染度', 0, 100],
                ['主角.核心状态.净化之力', 0, 100],
                ['主角.核心状态.污秽魔力', 0, 100],
                ['世界.当前关卡.Boss韧性值', 0, 100],
                ['主角.淫纹.经验', 0, 9999]
            ];

            clampRules.forEach(([p, min, max]) => {
                const val = ctx.get(p);
                if (typeof val === 'number') {
                    const clamped = Math.round(Math.max(min, Math.min(max, val)));
                    if (clamped !== val) {
                        ctx.set(p, clamped);
                        Logger.info(`⚖️ Sanitizer: 越界数值限幅纠偏 [${p}] 从 [${val}] 重构为 [${clamped}]`);
                    }
                }
            });

// 增强版旧存档无损迁移
const legacyCombatArchive = ctx.get('记录.已击败的Boss') || ctx.get('记录.已击败的BOSS');
const combatArchive = ctx.get('记录.战斗档案');
if (legacyCombatArchive && typeof legacyCombatArchive === 'object' &&
    (!combatArchive || typeof combatArchive !== 'object' || Object.keys(combatArchive).length === 0)) {
    ctx.set('记录.战斗档案', _.cloneDeep(legacyCombatArchive));
    ctx.unset('记录.已击败的Boss');
    ctx.unset('记录.已击败的BOSS');
    Logger.info('📚 存档迁移：已将旧版「已击败的Boss/BOSS」数据成功迁移至「战斗档案」。');
}

            let themes = ctx.get('世界.当前关卡.核心主题', []);
            if (!Array.isArray(themes)) themes = themes ? [themes] : [];
            const cleanThemes = _.uniq(themes.filter(t => t !== '$__META_EXTENSIBLE__$'));
            cleanThemes.push('$__META_EXTENSIBLE__$');
            if (!_.isEqual(themes, cleanThemes)) {
                ctx.set('世界.当前关卡.核心主题', cleanThemes);
                Logger.info(`⚖️ Sanitizer: 重构世界主题池去重: [${cleanThemes.filter(t => t !== '$__META_EXTENSIBLE__$').join(', ')}]`);
            }

            // --- 身体改造自愈、淫纹专属重定向与物理清理机制 ---
            const curMods = ctx.get('主角.永久性身体改造', {});
            const prevMods = ctx.getPrev('主角.永久性身体改造', {});
            const CURSE_KEY_REGEX = /(淫纹)/i;

            Object.keys(curMods).forEach(k => {
                if (k === '$meta' || k === '$__META_EXTENSIBLE__$') return;
                const mod = curMods[k] || {};

                if (CURSE_KEY_REGEX.test(k)) {
                    const isNewEntry = !prevMods[k];
                    const modDetail = typeof mod === 'string' ? mod : (mod.详情 || mod.description || '');
                    const currentCurseDesc = ctx.get('主角.淫纹.描述', '无');

                    if ((currentCurseDesc === '无' || currentCurseDesc === '生成中……' || currentCurseDesc === '待设定') && modDetail && modDetail !== '待设定') {
                        ctx.set('主角.淫纹.描述', modDetail);
                        Logger.event(`🩸 淫纹描述已从身体改造 [${k}] 自动继承迁移至专属变量：${modDetail}`);
                    }

                    if (isNewEntry) {
                        const hasBeenAwakened = ctx.get('主角.淫纹.已觉醒', false);
                        const currentCurseXp = ctx.get('主角.淫纹.经验', 0);
                        const curseLv = currentCurseXp <= 0 ? 0 : (currentCurseXp < 150 ? 1 : (currentCurseXp < 400 ? 2 : 3));

                        if (!hasBeenAwakened) {
                            ctx.set('主角.淫纹.已觉醒', true);
                            if (currentCurseXp <= 0) {
                                ctx.set('主角.淫纹.经验', 40);
                            }
                            ctx.set('系统状态.待处理事件.淫纹显现事件', '首次');
                            Logger.event(`🧬 检测到模型注入 [${k}]，激活初始淫纹显现事件，当前经验：${ctx.get('主角.淫纹.经验')} XP。`);
                        } else if (curseLv < 3) {
                            ctx.add('主角.淫纹.经验', 40);
                            Logger.info(`🩸 检测到同类烙印叠加 [${k}]，已自动转化为经验：+40 XP`);
                        } else {
                            ctx.add('主角.淫纹.经验', 15);
                            Logger.info(`🩸 检测到同类烙印叠加 [${k}]，满级后轻微吸收转化：+15 XP`);
                        }
                    }

                    delete curMods[k];
                    if (typeof _ !== 'undefined' && _.unset) {
                        _.unset(ctx.data, ['主角', '永久性身体改造', k]);
                    }
                    Logger.event(`🧹 [物理清理] 已将身体改造中的淫纹键 [${k}] 吸收并从变量树中彻底销毁。`);
                    return;
                }

                if (!prevMods[k]) {
                    ctx.set(`主角.永久性身体改造.${k}`, {
                        "部位": mod.部位 || "待设定",
                        "详情": mod.详情 || "待设定",
                        "来源": mod.来源 || "未知"
                    });
                    Logger.event(`🧬 新增正规身体改造登记：[${k}]`);
                }
            });

            // --- 阶段化战术纠偏 ---
            const curPhase = ctx.get('进程.阶段');
            const hEventName = ctx.get('世界.幕间H事件.名称', '无');
            const isHEventActive = curPhase === '幕间休息' && hEventName !== '无';

            const TACTIC_SETS = {
                '战斗回合': { valid: ['主动', '牵制', '诱惑', '推进', '危机', '必杀', '撤退', '投降'], def: '主动' },
                '终结回合': { valid: ['主动', '牵制', '诱惑', '推进', '危机', '必杀'], def: '主动' },
                '战斗准备': { valid: ['周旋', '探索', '交涉', '开战'], def: '周旋' },
                'H事件': { valid: ['抗拒', '忍耐', '魔力爆发', '迎合'], def: '忍耐' }
            };

            let tacticCtx = null;
            if (curPhase === '战斗回合') {
                tacticCtx = TACTIC_SETS['战斗回合'];
            } else if (curPhase === '终结回合') {
                // 终结回合使用独立战术表：不提供【撤退】（Entry 24 在终结回合不参与结算）
                tacticCtx = TACTIC_SETS['终结回合'];
            } else if (curPhase === '战斗准备') {
                tacticCtx = TACTIC_SETS['战斗准备'];
            } else if (isHEventActive) {
                tacticCtx = TACTIC_SETS['H事件'];
            }

            let currentTactic = ctx.get('主角.战斗临时.战斗方式', '主动');

            if (tacticCtx && !tacticCtx.valid.includes(currentTactic)) {
                ctx.set('主角.战斗临时.战斗方式', tacticCtx.def);
                currentTactic = tacticCtx.def;
                Logger.info(`🧹 Sanitizer: 阶段[${curPhase}]战斗方式越界，重置为 [${tacticCtx.def}]`);
            }

            if (currentTactic === '牵制' && ctx.personality === '堕落') {
                ctx.set('主角.战斗临时.战斗方式', '诱惑');
                currentTactic = '诱惑';
                Logger.info('⚖️ Sanitizer: 人格-战术纠偏 [牵制] -> [诱惑]');
            } else if (currentTactic === '诱惑' && ctx.personality === '善良') {
                ctx.set('主角.战斗临时.战斗方式', '牵制');
                currentTactic = '牵制';
                Logger.info('⚖️ Sanitizer: 人格-战术纠偏 [诱惑] -> [牵制]');
            }

            if (['战斗回合', '终结回合'].includes(curPhase) && currentTactic === '必杀') {
                const isFallen = ctx.personality === '堕落';
                const ultPower = parseInt(ctx.get(isFallen ? '主角.核心状态.污秽魔力' : '主角.核心状态.净化之力', 0), 10);
                if (ultPower < 100) {
                    ctx.set('主角.战斗临时.战斗方式', '主动');
                    Logger.warn('🛡️ Sanitizer: 必杀充能未满 100%，战斗方式自动由【必杀】回退至【主动】');
                }
            }

            if (!tacticCtx) {
                if (currentTactic !== '主动') {
                    ctx.set('主角.战斗临时.战斗方式', '主动');
                    Logger.info('🧹 Sanitizer: 脱离战术场景，战斗方式重置为: 主动');
                }
            }

            if (ctx.get('主角.生理状态.体液与分泌.子宫内精液.存量', 0) <= 0) {
                const sources = ctx.get('主角.生理状态.体液与分泌.子宫内精液.来源', {});
                if (Object.keys(sources).length > 0) {
                    ctx.set('主角.生理状态.体液与分泌.子宫内精液.来源', {});
                    Logger.info('🧹 Sanitizer: 宫内无精液，来源清空。');
                }
            }
            ctx.set('主角.战斗临时.临时强度加值', 0);

            // ── 撤退状态生命周期 ──
            // 撤退尝试计数只在战斗回合内累积。一旦离开战斗回合（胜利/败北/撤退脱身/GM强制转场），
            // 在此单点归零，杜绝下一场战斗继承追击惩罚。
            if (curPhase !== '战斗回合') {
                ctx.set('主角.战斗临时.撤退尝试', 0);
                ctx.set('主角.战斗临时.撤退成功', false);
                ctx.set('主角.战斗临时.投降', false);
            }

            // --- 幕间事件垃圾回收与状态重置 ---
            const isEventCompletedNow = ctx.get('系统状态.幕间事件完成') === true;
            const wasEventCompletedBefore = String(ctx.getPrev('系统状态.幕间事件完成')) === 'true';
            const hNameNow = ctx.get('世界.幕间H事件.名称', '无');
            const isNewEventStarting = ctx.getPrev('世界.幕间H事件.名称', '无') === '无' && hNameNow !== '无';

            const prevHConclusion = ctx.getPrev('系统状态.待处理事件.H事件落幕');
            const justRemovedHEventConclusion =
                (prevHConclusion === true || prevHConclusion === 'true') &&
                !ctx.events['H事件落幕'];

            const shouldFinalizeHEvent = !isNewEventStarting && hNameNow !== '无' && (
                isEventCompletedNow || justRemovedHEventConclusion
            );

            if (shouldFinalizeHEvent) {
                // 声望推送（在 GC 清空 H事件名/主题之前捕获判定素材）
                if (!ctx.events['魔法少女恶堕'] && !ctx.events['声望结算事件']) {
                    const capturedBeforeGC = ctx.get('系统状态.被俘状态') === true;
                    const hEventNameBeforeGC = hNameNow;
                    const hThemesBeforeGC = [...(ctx.get('世界.幕间H事件.核心主题', []) || [])]
                        .filter(t => t && t !== '$__META_EXTENSIBLE__$');
                    const wasCapturedScenario = capturedBeforeGC || hThemesBeforeGC.includes('监禁');

                    const bossNameBeforeGC = ctx.get('世界.当前关卡.名称', '无');
                    const bossTypeBeforeGC = ctx.get('世界.当前关卡.战斗类型', '无');
                    const bossThemesBeforeGC = [...(ctx.get('世界.当前关卡.核心主题', []) || [])]
                        .filter(t => t && !t.startsWith('$'));

                    ctx.set('系统状态.待处理事件.声望结算事件', JSON.stringify({
                        source: wasCapturedScenario ? '被俘' : 'H事件落幕',
                        h_event_name: hEventNameBeforeGC,
                        h_event_themes: hThemesBeforeGC,
                        boss_name: bossNameBeforeGC,
                        boss_type: bossTypeBeforeGC,
                        boss_themes: bossThemesBeforeGC
                    }));
                    Logger.event(`📢 H事件落幕，推送声望结算（来源：${wasCapturedScenario ? '被俘' : 'H事件落幕'}，事件：[${hEventNameBeforeGC}]）`);
                }

                if (!wasEventCompletedBefore || justRemovedHEventConclusion) {
                    ctx.set('系统状态.幕间回合计数', 0);
                    Logger.info('🧹 GC Engine: 回合计数置零归位。');

                    if (justRemovedHEventConclusion) {
                        ctx.set('系统状态.幕间事件完成', true);
                        Logger.warn('🛡️ GC Engine 防御性纠偏: 检测到H事件已落幕，强制重置 [系统状态.幕间事件完成] 为 true。');
                    }

                    if (ctx.get('系统状态.被俘状态') === true) {
                        ctx.set('系统状态.被俘状态', false);
                        Logger.info('🛡️ GC Engine: 战役退出，强制解冻被俘状态。');
                    }

                    if (ctx.get('进程.阶段') === '幕间休息') {
                        ctx.add('主角.核心状态.体力值.当前', 30);
                        Logger.info('✅ GC Engine: 日常 H 事件正常消退，恢复 30 点体力。');
                    } else {
                        Logger.info('✅ GC Engine: 战败囚禁阶段过渡完毕。');
                    }
                }

                if (hNameNow !== '无') {
                    ctx.set('世界.幕间H事件.名称', '无');
                    Logger.info('🧹 GC Engine: 重置 [世界.幕间H事件.名称] -> 无');
                }
                if (ctx.get('世界.幕间H事件.逃脱进度', 0) !== 0) {
                    ctx.set('世界.幕间H事件.逃脱进度', 0);
                }
                const hThemes = ctx.get('世界.幕间H事件.核心主题', []);
                if (hThemes.filter(t => t && t !== '$__META_EXTENSIBLE__$').length > 0) {
                    ctx.set('世界.幕间H事件.核心主题', []);
                    Logger.info('🧹 GC Engine: 幕间主题池已清空释放。');
                }
            }
        }

// --- 2. 响应式事件与生理推演 ---
runReactiveSystem(ctx) {
    // ═══════════════════════════════════════════════
    //  [新增] 分娩日期自动记录（兜底）
    // ═══════════════════════════════════════════════
    const prevPost = ctx.getPrev('主角.核心状态.产后状态', '无');
    const curPost  = ctx.get('主角.核心状态.产后状态', '无');
    if (prevPost === '无' && curPost === '恢复期') {
        ctx.set('主角.核心状态.产后日期', ctx.get('世界.日期', 305));
        Logger.event(`👶 分娩完成，记录产后日期：${ctx.get('世界.日期')}`);
    }

    let pleasure = ctx.get('主角.快感状态.快感值', 0);
    let threshold = ctx.get('主角.快感状态.高潮阈值', 100);

    const hProgress = ctx.get('世界.幕间H事件.逃脱进度');
    const isEventCompleted = ctx.get('系统状态.幕间事件完成', true);
    if (hProgress !== undefined && !isEventCompleted) {
        if (hProgress >= 100 && !ctx.events['H事件落幕']) {
            Logger.event('✨ 逃脱/满足进度达到100%！挂载幕间H事件落幕结算。');
            ctx.set('系统状态.待处理事件.H事件落幕', true);
        }
    }

    if (ctx.getPrev('系统状态.待处理事件.高潮事件') && !ctx.events['高潮事件']) {
        let loopSafety = 0;
        while (pleasure >= threshold && loopSafety < 10) {
            pleasure -= threshold;
            loopSafety++;
            if (ctx.get('进程.阶段') === '战斗回合' && ctx.personality === '善良') {
                const hpD = _.random(5, 10);
                const mpD = _.random(10, 20);
                const corruptD = _.random(8, 15);

                ctx.add('主角.核心状态.体力值.当前', -hpD);
                ctx.add('主角.核心状态.魔力值.当前', -mpD);
                ctx.add('主角.快感状态.污染度', corruptD);
                threshold += 20;
                ctx.set('主角.快感状态.高潮阈值', threshold);
                Logger.warn(`⚡ 纯洁意志抵抗高潮反噬：HP-${hpD}, MP-${mpD}, 污染度+${corruptD}, 高潮阈值提升至 ${threshold}`);
            }
        }
        ctx.set('主角.快感状态.快感值', pleasure);

        if (loopSafety > 0) {
            ctx.add('主角.快感状态.总高潮次数', loopSafety);
            Logger.event(`🌊 快感满溢高潮触发！连续高潮数: ${loopSafety} 次，剩余快感残留: ${pleasure}`);

            if (ctx.get('世界.幕间H事件.名称', '无') !== '无' && hProgress !== undefined) {
                ctx.add('世界.幕间H事件.逃脱进度', loopSafety * 30);
                const updatedHProgress = ctx.get('世界.幕间H事件.逃脱进度');
                Logger.info(`✨ 绝顶导致进度暴增：逃脱/满足进度 +${loopSafety * 30}% -> 当前: ${updatedHProgress}%`);

                const isEventCompletedNow = ctx.get('系统状态.幕间事件完成', true);
                if (updatedHProgress >= 100 && !isEventCompletedNow && !ctx.events['H事件落幕']) {
                    Logger.event('✨ 高潮直接导致逃脱进度溢出！立即挂载H事件落幕结算。');
                    ctx.set('系统状态.待处理事件.H事件落幕', true);
                }
            }

            if (ctx.get('主角.淫纹.经验', 0) > 0) {
                const curseXpGain = _.random(10, 15);
                ctx.add('主角.淫纹.经验', curseXpGain);
                Logger.info(`🩸 高潮刺激烙印生长：淫纹经验 +${curseXpGain} XP`);
            }
        }

        if (pleasure >= threshold && !ctx.events['高潮事件']) {
            ctx.set('系统状态.待处理事件.高潮事件', true);
            Logger.event('🌊 快感复压再次越界，补充高潮待处理事件。');

            if (ctx.get('进程.阶段') === '战斗回合') {
                const bossThemes = ctx.get('世界.当前关卡.核心主题', []).filter(t => !t.startsWith('$'));
                if (bossThemes.length > 0) {
                    const xpGain = _.random(25, 40);
                    bossThemes.forEach(t => {
                        if (ctx.get(`主角.快感状态.性癖.${t}`)) {
                            ctx.add(`主角.快感状态.性癖.${t}.经验`, xpGain);
                            Logger.event(`🧠 战中高潮印刻：性癖 [${t}] 获取经验 +${xpGain} XP`);
                        }
                    });
                }
            }
        }
    } else {
        if (pleasure >= threshold && !ctx.events['高潮事件']) {
            ctx.set('系统状态.待处理事件.高潮事件', true);
            Logger.event('🌊 临界状态高潮检测成功，推送高潮待处理事件');

            if (ctx.get('进程.阶段') === '战斗回合') {
                const bossThemes = ctx.get('世界.当前关卡.核心主题', []).filter(t => !t.startsWith('$'));
                if (bossThemes.length > 0) {
                    const xpGain = _.random(25, 40);
                    bossThemes.forEach(t => {
                        if (ctx.get(`主角.快感状态.性癖.${t}`)) {
                            ctx.add(`主角.快感状态.性癖.${t}.经验`, xpGain);
                            Logger.event(`🧠 战中高潮印刻：性癖 [${t}] 获取经验 +${xpGain} XP`);
                        }
                    });
                }
            }
        }
    }

    if (ctx.getPrev('系统状态.待处理事件.体内满溢事件') && !ctx.events['体内满溢事件']) {
        const cap = ctx.get('主角.生理状态.阴道状态.最大容量', 50);
        if (cap < 200) {
            const capGain = _.random(10, 20);
            ctx.set('主角.生理状态.阴道状态.最大容量', Math.min(200, cap + capGain));
            Logger.warn(`⚠️ 容器扩张：经历体内满溢并排出，容量极限提升 [${cap}ml] -> [${ctx.get('主角.生理状态.阴道状态.最大容量')}ml]`);
        }
    }

    const semenAmt = ctx.get('主角.生理状态.体液与分泌.子宫内精液.存量', 0);
    const cap = ctx.get('主角.生理状态.阴道状态.最大容量', 50);
    if (semenAmt > cap && !ctx.events['体内满溢事件']) {
        ctx.set('系统状态.待处理事件.体内满溢事件', true);
        Logger.warn(`⚠️ 超载！子宫积存精液 [${semenAmt}ml] 越过容量上限 [${cap}ml]，挂载体内满溢事件。`);
    }

    const prevSemenAmt = ctx.getPrev('主角.生理状态.体液与分泌.子宫内精液.存量', 0);
    if (prevSemenAmt > 0 && semenAmt <= 0 && ctx.personality === '善良') {
        ctx.add('主角.快感状态.污染度', -5);
        const curCurseXp = ctx.get('主角.淫纹.经验', 0);
        if (curCurseXp > 0) {
            ctx.set('主角.淫纹.经验', Math.max(0, curCurseXp - 10));
        }
        Logger.event('✨ 子宫内浊液彻底排空！污染度 -5%，淫纹经验 -10 XP');
    }

    const semenDelta = semenAmt - ctx.getPrev('主角.生理状态.体液与分泌.子宫内精液.存量', 0);
    if (semenDelta > 0 && ctx.personality === '善良' && ctx.get('进程.阶段') === '战斗回合') {
        const extraCorr = _.random(3, 8) + Math.floor(semenDelta / 50) * _.random(1, 3);
        ctx.add('主角.快感状态.污染度', extraCorr);
        Logger.warn(`🩸 纯洁肉体被异种体液灌注玷污：注入量 +${semenDelta}ml，被动精神污染值 +${extraCorr}%`);
    }

    if (ctx.get('主角.生理状态.子宫状态.受孕状态') === '未受孕' && semenDelta > 5) {
        const curseLv = this._getCurseLv(ctx.get('主角.淫纹.经验', 0));
        const chance = 0.30 + (curseLv * 0.15);
        const roll = Math.random();
        if (roll < chance) {
            const sources = Object.keys(ctx.get('主角.生理状态.体液与分泌.子宫内精液.来源', {})).filter(k => !k.startsWith('$'));
            ctx.set('主角.生理状态.子宫状态.受孕状态', '受孕中');
            ctx.set('主角.生理状态.子宫状态.孕育信息.孕育源', sources.length ? _.sample(sources) : '未知魔物');
            ctx.add('主角.生理状态.子宫状态.孕育信息.妊娠计数器', 1);
            ctx.set('系统状态.待处理事件.受孕事件', true);
            Logger.event(`🤰 受孕判定检定通过！(Rolled: ${roll.toFixed(2)} < Chance: ${chance.toFixed(2)})，宿体已建立，受精计数器步进。`);
        } else {
            Logger.info(`🤰 受孕检定未通过 (Rolled: ${roll.toFixed(2)} >= Chance: ${chance.toFixed(2)})，子宫抵御了此次着床。`);
        }
    }

    // ═══════════════════════════════════════════════
    //  [重构] 统一日期推进块
    //  · 跨年修复：入口改为 dayPassed > 0
    //  · 妊娠分级：按天数推进，超限封顶并推送快进事件
    //  · 产后流转：日期戳驱动，幂等
    // ═══════════════════════════════════════════════
    const currentDay = ctx.get('世界.日期', 305);
    const previousDay = ctx.getPrev('世界.日期', 305);
    const dayPassed = this._daysBetween(previousDay, currentDay);

    if (dayPassed > 0) {
        const effectiveDays = Math.min(dayPassed, 30);

        // ── 1. 高潮阈值重置 ──
        ctx.set('主角.快感状态.高潮阈值', 100);

        // ── 2. 妊娠推进（分级 + 封顶 + 快进事件） ──
        if (ctx.get('主角.生理状态.子宫状态.受孕状态') !== '未受孕') {
            const curCount = ctx.get('主角.生理状态.子宫状态.孕育信息.妊娠计数器', 1);
            const daysToBirth = Math.max(0, 8 - curCount);
            const actualAdvance = Math.min(dayPassed, daysToBirth);

            if (actualAdvance > 0) {
                ctx.add('主角.生理状态.子宫状态.孕育信息.妊娠计数器', actualAdvance);
            const newCount = ctx.get('主角.生理状态.子宫状态.孕育信息.妊娠计数器', 1);
                Logger.event(`🤰 孕育自然生长：时间流逝 ${dayPassed} 天 [妊娠计数: ${newCount}]`);
            }
        }

        // ── 3. 污染度自洁（按有效天数迭代） ──
        let corruptDelta = 0;
        const isFallen = ctx.personality === '堕落';
        const curseLvForClean = this._getCurseLv(ctx.get('主角.淫纹.经验', 0));
        for (let i = 0; i < effectiveDays; i++) {
            if (isFallen && ctx.get('主角.快感状态.污染度', 0) > 20) {
                corruptDelta -= _.random(5, 10);
            } else if (!isFallen && ctx.get('主角.快感状态.污染度', 0) > 0) {
                corruptDelta -= 2;
            }
            if (curseLvForClean >= 3) corruptDelta += 4;
        }
        if (corruptDelta !== 0) {
            ctx.add('主角.快感状态.污染度', corruptDelta);
        }

        // ── 4. 产后状态流转（日期戳驱动，幂等） ──
        const postState = ctx.get('主角.核心状态.产后状态', '无');
        if (postState !== '无') {
            const birthDate = ctx.get('主角.核心状态.产后日期', 0);

            if (birthDate === 0) {
                // 旧存档兼容：以当前日期为起点初始化
                ctx.set('主角.核心状态.产后日期', currentDay);
                Logger.warn('👶 检测到旧存档产后状态，自动初始化产后日期，本回合不推进流转。');
            } else {
                let daysSinceBirth = this._daysBetween(birthDate, currentDay);
                // 兜底：若日期异常导致返回 0 但实际已跨日，退化为按 1 天计
                if (daysSinceBirth === 0 && currentDay !== birthDate) {
                    daysSinceBirth = 1;
                }

                const RECOVERY_DAYS  = 7;
                const LACTATION_DAYS = 30;

                if (postState === '恢复期' && daysSinceBirth >= RECOVERY_DAYS) {
                    ctx.set('主角.核心状态.产后状态', '哺乳期');
                    ctx.set('系统状态.待处理事件.进入哺乳期事件', true);
                    Logger.event(`👶 产后恢复完成：距分娩 ${daysSinceBirth} 天，转入哺乳期`);
                } else if (postState === '哺乳期' && daysSinceBirth >= RECOVERY_DAYS + LACTATION_DAYS) {
                    ctx.set('主角.核心状态.产后状态', '无');
                    ctx.set('主角.核心状态.产后日期', 0);
                    ctx.set('系统状态.待处理事件.产后完全恢复事件', true);
                    Logger.event(`👶 哺乳期结束：距分娩 ${daysSinceBirth} 天，身体完全恢复`);
                }
            }
        }

        Logger.info(`📅 日期推进：${previousDay} → ${currentDay}（跨度 ${dayPassed} 天，有效 ${effectiveDays} 天）`);
    }

    // ═══════════════════════════════════════════════
    //  [保留] 以下逻辑与原代码完全一致
    // ═══════════════════════════════════════════════

    if (ctx.isNewTurn) {
        if (ctx.get('主角.核心状态.变身状态', false)) {
            const maxMp = ctx.get('主角.核心状态.魔力值.最大', 100);
            const pRatio = ctx.get('主角.快感状态.高潮阈值', 100) > 0
                ? (ctx.get('主角.快感状态.快感值', 0) / ctx.get('主角.快感状态.高潮阈值', 100))
                : 0;
            const isCombatRelated = ['战斗准备', '战斗回合', '终结回合', '战斗败北', '战后处理'].includes(ctx.get('进程.阶段'));
            let drainAmt = isCombatRelated ? 2 : 1;
            if (pRatio > 0.50) drainAmt += Math.max(1, Math.floor(maxMp * 0.05 * pRatio));
            if (drainAmt > 0) {
                ctx.add('主角.核心状态.魔力值.当前', -drainAmt);
                Logger.info(`⚡ 维持变身消耗: MP 减少 ${drainAmt}点 (当前: ${ctx.get('主角.核心状态.魔力值.当前')}MP) [快感干扰: ${Math.round(pRatio * 100)}%]`);
            }
        }

        let xpGain = 0;
        const phase = ctx.get('进程.阶段');
        const isCombatRelated = ['战斗准备', '战斗回合', '终结回合', '战斗败北', '战后处理'].includes(phase);
        const corruption = ctx.get('主角.快感状态.污染度', 0);

        if (corruption < 20 && !isCombatRelated) xpGain -= 1;
        else if (corruption > 70) xpGain += 2;
        else if (corruption > 50) xpGain += 1;

        const semenAmtForXp = ctx.get('主角.生理状态.体液与分泌.子宫内精液.存量', 0);
        if (semenAmtForXp > 0) {
            let nourish = Math.floor(semenAmtForXp / 20) || 1;
            xpGain += (ctx.personality === '堕落') ? Math.min(nourish, 5) * 2 : Math.min(nourish, 5);
        } else if (!isCombatRelated) {
            xpGain -= 2;
        }

        if (ctx.events['高潮事件']) xpGain += _.random(8, 12);

        if (xpGain !== 0) {
            const curXp = ctx.get('主角.淫纹.经验', 0);
            if (curXp > 0) {
                ctx.set('主角.淫纹.经验', Math.max(0, curXp + xpGain));
                Logger.info(`🩸 淫纹日常经验变动：${xpGain > 0 ? '+' : ''}${xpGain} XP (当前: ${ctx.get('主角.淫纹.经验')} XP)`);
            }
        }
    }

    const curseLv = this._getCurseLv(ctx.get('主角.淫纹.经验', 0));
    if (curseLv >= 2) {
        const mpLoss = ctx.getPrev('主角.核心状态.魔力值.current', ctx.getPrev('主角.核心状态.魔力值.当前', 0)) - ctx.get('主角.核心状态.魔力值.当前', 0);
        if (mpLoss > 0) {
            const pGain = Math.max(1, Math.floor(mpLoss * 0.3));
            ctx.add('主角.快感状态.快感值', pGain);
            Logger.warn(`🩸 淫纹中阶反噬「魔力发情」：魔力流失 -${mpLoss}MP 转化为感官快感值 +${pGain}`);
        }
    }
    if (curseLv >= 3) {
        const hpLoss = ctx.getPrev('主角.核心状态.体力值.current', ctx.getPrev('主角.核心状态.体力值.当前', 0)) - ctx.get('主角.核心状态.体力值.当前', 0);
        if (hpLoss > 0) {
            const pGain = Math.max(1, Math.floor(hpLoss * 0.5));
            ctx.add('主角.快感状态.快感值', pGain);
            Logger.warn(`🩸 淫纹高阶反噬「痛觉转换」：肉体承受伤害 -${hpLoss}HP 转化为顶峰快感值 +${pGain}`);
        }
    }

    if (ctx.personality === '善良' && ctx.get('主角.快感状态.污染度', 0) >= 100) {
        if (!ctx.events['堕落临界点'] && !ctx.events['魔法少女恶堕']) {
            ctx.set('系统状态.待处理事件.堕落临界点', true);
            Logger.error('🧬 纯洁魔法少女精神防线彻底崩溃！污染度已达100%极限！推送「堕落临界点事件」。');
        }
    }

    if (ctx.get('主角.核心状态.变身状态') && ctx.get('主角.核心状态.魔力值.当前', 0) <= 0) {
        ctx.set('系统状态.待处理事件.强制解除变身', true);
        Logger.error('⚡ 魔法少女魔力彻底枯竭！强制解除变身状态，推送解除变身事件！');
    }
}


        // --- 3. 游戏主状态机 ---
        runStateMachine(ctx) {
            const prevHName = ctx.getPrev('世界.幕间H事件.名称', '无');
            const currHName = ctx.get('世界.幕间H事件.名称', '无');

            if (prevHName === '无' && currHName !== '无') {
                ctx.set('系统状态.幕间事件完成', false);
                ctx.set('世界.幕间H事件.逃脱进度', 0);
                ctx.set('系统状态.幕间回合计数', 0);

                const wasDefeated = ['战斗败北', '战后处理'].includes(ctx.get('进程.阶段')) || ctx.getPrev('进程.阶段') === '战斗败北';
                const hasCaptureTag = ctx.getPrev('系统状态.待处理事件.战败被俘结算') || ctx.events['战败被俘结算'];

                if (wasDefeated || hasCaptureTag) {
                    ctx.set('进程.阶段', '幕间休息');
                    ctx.set('系统状态.被俘状态', true);
                    ctx.set('主角.核心状态.变身状态', false);
                    ctx.set('主角.核心状态.魔力值.当前', 15);
                    ctx.set('主角.核心状态.体力值.当前', 25);

                    if (ctx.events['战败被俘结算']) ctx.unset('系统状态.待处理事件.战败被俘结算');
                    Logger.error(`⛓️ 战败被俘确立！进入囚禁调教阶段 [${currHName}]`);
                } else {
                    Logger.event(`🎬 触发日常幕间H事件 [${currHName}]，执行日常H初始化...`);
                }
            }

            const prevPhaseForIntermission = ctx.getPrev('进程.阶段');
            const currPhaseForIntermission = ctx.get('进程.阶段');
            const isCapturedNow = ctx.get('系统状态.被俘状态', false) === true;

            if (
                prevPhaseForIntermission !== '幕间休息' &&
                prevPhaseForIntermission !== '创角阶段' && 
                currPhaseForIntermission === '幕间休息' &&
                !isCapturedNow
            ) {
                const existingHThemes = ctx.get('世界.幕间H事件.核心主题', []);
                const cleanExistingThemes = (Array.isArray(existingHThemes) ? existingHThemes : [])
                    .filter(t => t && t !== '$__META_EXTENSIBLE__$');

                if (cleanExistingThemes.length === 0) {
                    const kinkPool = ctx.get('主角.快感状态.性癖', {});
                    const validKinkKeys = Object.keys(kinkPool).filter(k =>
                        k !== '$meta' &&
                        k !== '$__META_EXTENSIBLE__$' &&
                        kinkPool[k] &&
                        ((kinkPool[k].等级 || 0) >= 1 || (kinkPool[k].经验 || 0) >= 50)
                    );

                    if (validKinkKeys.length > 0) {
                        const selectedKink = _.sample(validKinkKeys);
                        ctx.set('世界.幕间H事件.核心主题', [selectedKink, '$__META_EXTENSIBLE__$']);
                        ctx.set('系统状态.幕间事件完成', false);
                        Logger.event(`🎭 [进入幕间] 补登记 H 事件主题：[${selectedKink}]（来自 ${validKinkKeys.length} 个已觉醒性癖）`);
                    } else {
                        ctx.set('系统状态.幕间事件完成', true);
                        Logger.info('🎭 [进入幕间] 无有效性癖，维持纯洁日常线。');
                    }
                } else {
                    Logger.info(`🎭 [进入幕间] 检测到已有主题池，跳过补登记：[${cleanExistingThemes.join(', ')}]`);
                }
            }

            if (ctx.getPrev('进程.阶段') === '创角阶段' && ctx.get('进程.阶段') === '幕间休息') {
                Logger.event('🎬 首次进入幕间休息，执行初始世界环境装填...');
                ctx.set('主角.核心状态.体力值.当前', ctx.get('主角.核心状态.体力值.最大', 100));
                ctx.set('主角.核心状态.魔力值.当前', ctx.get('主角.核心状态.魔力值.最大', 100));
                ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
                ctx.set('系统状态.幕间回合计数', 0);

                const threatRoll = Math.random();
                const initialThreat = threatRoll < 0.3 ? 1 : (threatRoll < 0.9 ? 2 : 3);
                ctx.set('世界.威胁等级', initialThreat);
                Logger.info(`🎲 初始世界遭遇等级装填完毕: Lv.${initialThreat}`);

                const themePool = ctx.get('系统状态.Boss生成主题池', []).filter(t => t !== '$__META_EXTENSIBLE__$');
                ctx.set('世界.当前关卡.核心主题', themePool.length > 0 ? [_.sample(themePool)] : []);
            }

            if (ctx.get('进程.阶段') === '幕间休息') {
                if (ctx.get('世界.幕间H事件.名称', '无') === '无' && ctx.isNewTurn) {
                    const oldTurn = ctx.get('系统状态.幕间回合计数', 0);
                    ctx.add('系统状态.幕间回合计数', 1);
                    Logger.info(`🧭 幕间日常步进: 幕间日常计数器增进 [${oldTurn}] -> [${ctx.get('系统状态.幕间回合计数')}]`);
                }
                if (ctx.get('系统状态.幕间回合计数', 0) === 5 && !ctx.events['线索整理事件']) {
                    ctx.set('系统状态.待处理事件.线索整理事件', true);
                    Logger.event('🧭 幕间度过 5 天，自动推入「世界线索整理与数据清洗事件」。');
                }
            }

            if (ctx.get('进程.阶段') === '战斗准备') {
                ctx.set('世界.当前关卡.Boss韧性值', 100);
                ctx.set('世界.当前关卡.Boss状态', '完好');
                if (ctx.get('世界.当前关卡.名称', '无') === '无') {
                    ctx.set('世界.当前关卡.名称', '未知的威胁');
                }
                this.counters.defeatPersistence = 0;
                Logger.event(`⚔️ 战役锁定完毕: Boss [${ctx.get('世界.当前关卡.名称')}]，初始遭遇强度 [${ctx.get('世界.当前关卡.Boss基础强度')}]`);
            }

            if (ctx.get('进程.阶段') === '战斗回合') {
                const hp = ctx.get('主角.核心状态.体力值.当前', 100);
                const bossHp = ctx.get('世界.当前关卡.Boss韧性值', 100);
                const ultUsed = (ctx.get('主角.核心状态.净化之力') === 0 && ctx.getPrev('主角.核心状态.净化之力', 0) >= 100) ||
                                (ctx.get('主角.核心状态.污秽魔力') === 0 && ctx.getPrev('主角.核心状态.污秽魔力', 0) >= 100);
                // [MG_ESCROW_V3] fledFlag / surrenderedFlag 已随收口分支一并移除

                Logger.info(`⚔️ 战斗回合进行中... 主角体力: [${hp}/${ctx.get('主角.核心状态.体力值.最大')}] | Boss 韧性: [${bossHp}/100]`);

                if (bossHp <= 0 || ultUsed) {
                    ctx.set('进程.阶段', '战斗胜利');
                    Logger.event(`🏆 战斗胜利判定通过！(Boss残存韧性: ${bossHp}% | 必杀技释放: ${ultUsed})`);
                } else if (hp <= 0) {
                    ctx.set('进程.阶段', '战斗败北');
                    ctx.set('主角.核心状态.当前战斗姿态', '力尽待辱');
                    ctx.add('记录.总战败次数', 1);
                    Logger.warn(`🥀 战斗败北判定！主角体力彻底归零，战姿修正为：[力尽待辱]，已计入累计总战败。`);
                } else {
                    // [MG_ESCROW_V3] 原「撤退脱身 / 主动投降」两个收口分支已移除：
                    // 阶段切换与关卡核销已改由世界书 Entry 24 的 mandatory_patch 显式执行
                    // （见 _finalizeEscape / _finalizeSurrender 的删除）。
                    // 本引擎只负责数值合法性校验与被动清洗。
                    const oldPosture = ctx.get('主角.核心状态.当前战斗姿态');
                    const newPosture = hp > 35 ? '战斗中' : '劣势';
                    if (oldPosture !== newPosture) {
                        ctx.set('主角.核心状态.当前战斗姿态', newPosture);
                        Logger.warn(`⚔️ 战姿迁移：[${oldPosture}] -> [${newPosture}]`);
                    }
                    ctx.set('世界.当前关卡.Boss状态', bossHp > 50 ? '完好' : '动摇');
                }
            }

            if (ctx.get('进程.阶段') === '战斗胜利' && ctx.getPrev('进程.阶段') !== '战斗胜利') {
                this._registerCombat(ctx, 'WIN');
            }
            if (ctx.get('进程.阶段') === '战斗败北' && ctx.getPrev('进程.阶段') !== '战斗败北') {
                this._registerCombat(ctx, 'LOSE');
            }

            if (ctx.get('进程.阶段') === '战斗败北' && ctx.isNewTurn) {
                if (!ctx.events['彻底败北结算'] && !ctx.events['战败被俘结算']) {
                    this.counters.defeatPersistence++;
                    Logger.info(`🥀 处于力尽状态中，战败滞留倒计时: [${this.counters.defeatPersistence}/5] 轮`);

                    const justClimaxed = ctx.getPrev('系统状态.待处理事件.高潮事件') && !ctx.events['高潮事件'];

                    if (justClimaxed || this.counters.defeatPersistence >= 5) {
                        let triggerReason = justClimaxed ? "高潮防线彻底崩溃" : "力尽倒地过久";
                        Logger.event(`⏳ 战败结算触发！原因：${triggerReason}`);

                        const threatLv = parseInt(ctx.get('世界.威胁等级', 1), 10);
                        let captureChance = threatLv >= 3 ? 0.80 : (threatLv === 2 ? 0.50 : 0.10);

                        const corruption = ctx.get('主角.快感状态.污染度', 0);
                        if (corruption > 80) captureChance += 0.20;

                        if (Math.random() < captureChance) {
                            const combatType = ctx.get('世界.当前关卡.战斗类型', '魔物');
                            let captureTags = ['监禁'];
                            if (combatType === '魔物') captureTags.push('苗床化');
                            else if (combatType === '人类') captureTags.push('性奴隶化');
                            else if (combatType === '魔法少女') captureTags.push('百合');

                            ctx.set('世界.幕间H事件.核心主题', captureTags);
                            ctx.set('系统状态.待处理事件.战败被俘结算', true);
                            Logger.error(`⛓️ 判定检定被俘！概率: ${(captureChance * 100).toFixed(1)}%。 锁定监禁TAG: [${captureTags.join(', ')}]`);
                        } else {
                            ctx.set('系统状态.待处理事件.彻底败北结算', true);

                            if (!ctx.events['声望结算事件'] && !ctx.events['魔法少女恶堕']) {
                                ctx.set('系统状态.待处理事件.声望结算事件', JSON.stringify({
                                    source: '战斗败北',
                                    h_event_name: '无',
                                    h_event_themes: [],
                                    boss_name: ctx.get('世界.当前关卡.名称', '无'),
                                    boss_type: ctx.get('世界.当前关卡.战斗类型', '无'),
                                    boss_themes: [...(ctx.get('世界.当前关卡.核心主题', []) || [])].filter(t => t && !t.startsWith('$'))
                                }));
                                Logger.event('📢 彻底败北结算确立，推送声望结算（来源：战斗败北）');
                            }

                            Logger.error('🥀 判定直接释放结算！挂载「彻底败北结算事件」。');
                        }
                        this.counters.defeatPersistence = 0;
                    }
                }
            }

            if (ctx.isNewTurn) {
                this.counters.finisher = (ctx.get('进程.阶段') === '终结回合') ? this.counters.finisher + 1 : 0;
                this.counters.victory = (ctx.get('进程.阶段') === '战斗胜利') ? this.counters.victory + 1 : 0;
            }
            if (this.counters.finisher >= 2) {
                ctx.set('进程.阶段', '战斗胜利');
                this.counters.finisher = 0;
                Logger.info('🎯 终结技超时未宣告，系统强制切换至战斗胜利阶段。');
            }
            if (this.counters.victory >= 3) {
                ctx.set('进程.阶段', '战后处理');
                ctx.set('系统状态.待处理事件.状态演化事件', true);
                this.counters.victory = 0;
                Logger.info('🎯 胜利剧情超时，自动切换至「战后处理阶段」，推进身体更演状态评估。');
            }

            if (ctx.get('进程.阶段') === '战后处理' && !ctx.events['状态演化事件']) {
                ctx.set('系统状态.待处理事件.状态演化事件', true);
            }

            if (ctx.get('进程.阶段') === '战后处理' && ctx.getPrev('进程.阶段') === '战后处理') {
                this._executeIntermissionHeal(ctx);
                ctx.set('进程.阶段', '幕间休息');
                Logger.event('🧹 战后处理完毕，进入幕间休息。');
            }
        }

        // --- 4. 里程碑与被动演化 ---
        runMilestones(ctx) {
            const pStr = ctx.getPrev('主角.核心状态.基础强度', 50);
            const cStr = ctx.get('主角.核心状态.基础强度', 50);
            if (cStr > pStr) {
                for (let t = 70; t <= 300; t += 20) {
                    if (pStr < t && cStr >= t) {
                        ctx.set('系统状态.待处理事件.武装升级事件', true);
                        Logger.event(`⚔️ 武器装备达到升级门槛: [强度: ${pStr} -> ${cStr}]！挂载「武装升级事件」`);
                        break;
                    }
                }
            }

            const pFame = ctx.getPrev('名声.知名度', 0);
            const cFame = ctx.get('名声.知名度', 0);
            if (cFame > pFame) {
                let title = "";
                if (pFame < 15 && cFame >= 15) title = "都市传说";
                else if (pFame < 45 && cFame >= 45) title = "公众热议";
                else if (pFame < 85 && cFame >= 85) title = "无人不晓";
                if (title) {
                    ctx.set('系统状态.待处理事件.知名度升级事件', title);
                    Logger.event(`🏆 名声知名度晋阶：知名度上升 [${pFame}] -> [${cFame}]，触发称号演变事件: [${title}]`);
                }
            }

            const kinks = ctx.get('主角.快感状态.性癖', {});
            Object.keys(kinks).forEach(k => {
                if (k.startsWith('$')) return;
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
                    Logger.event(`🧠 性癖阶段晋阶变迁: 性癖 [${k}] 升级！ [Lv.${currLv}] -> [Lv.${newLv}]`);
                }
                if (newLv >= 3 && !ctx.events['性癖觉醒事件'] && !ctx.get(`世界.世界观备注.觉醒记录_${k}`)) {
                    ctx.set('系统状态.待处理事件.性癖觉醒事件', k);
                    Logger.event(`🧠 玩家身体深陷泥泞！性癖 [${k}] 抵达高级（Lv.${newLv}），推送性癖确立与觉醒事件！`);
                }
            });

            const cxp = ctx.get('主角.淫纹.经验', 0);
            const pxp = ctx.getPrev('主角.淫纹.经验', 0);
            const curLv = this._getCurseLv(cxp);
            const prevLv = this._getCurseLv(pxp);
            const hasBeenAwakened = ctx.get('主角.淫纹.已觉醒', false);

            const isManifested = hasBeenAwakened;

            if (curLv > prevLv) {
                if (prevLv !== 0) {
                    ctx.add('主角.淫纹.经验', 5);
                    Logger.info('🩸 淫纹阶段觉醒，伴随赠送 5 点共振经验奖励。');
                }
            } else if (curLv < prevLv) {
                const phase = ctx.get('进程.阶段');
                const isCombatRelated = ['战斗准备', '战斗回合', '终结回合', '战斗败北', '战后处理'].includes(phase);
                if (isCombatRelated) {
                    if (isManifested) {
                        const safeXp = prevLv === 1 ? 1 : (prevLv === 2 ? 150 : 400);
                        ctx.set('主角.淫纹.经验', safeXp);
                        Logger.warn(`🛡️ 战斗阻断：战中检测到数据退化，已被物理印迹阻断保护，锁死经验至原等级下限：[${safeXp} XP]`);
                    }
                } else {
                    if (curLv !== 0) {
                        ctx.add('主角.淫纹.经验', -5);
                        Logger.info('🛡️ 淫纹经验退化惩罚。');
                    }
                }
            }

            const finalCxp = ctx.get('主角.淫纹.经验', 0);
            const finalCurLv = this._getCurseLv(finalCxp);
            const isCursePending = ctx.events['淫纹显现事件'] || ctx.events['淫纹进化事件'] || ctx.events['淫纹降级事件'];

            if (!isCursePending && finalCxp <= 0 && hasBeenAwakened) {
                ctx.set('主角.淫纹.描述', '无');
                Logger.info('🩸 淫纹经验归零，描述已清空，但保留历史觉醒标记（用于复燃判定）。');
            }

            let logicalPrevLv = prevLv;
            if (ctx.getPrev('系统状态.待处理事件.淫纹显现事件') && !ctx.events['淫纹显现事件']) logicalPrevLv = Math.max(1, logicalPrevLv);
            if (ctx.getPrev('系统状态.待处理事件.淫纹进化事件') && !ctx.events['淫纹进化事件']) logicalPrevLv = finalCurLv;
            if (ctx.getPrev('系统状态.待处理事件.淫纹降级事件') && !ctx.events['淫纹降级事件']) logicalPrevLv = finalCurLv;

            if (!isCursePending) {
                const cCorr = ctx.get('主角.快感状态.污染度', 0);
                const prevSemenAmt = ctx.getPrev('主角.生理状态.体液与分泌.子宫内精液.存量', 0);
                const semenAmt = ctx.get('主角.生理状态.体液与分泌.子宫内精液.存量', 0);

                const triggerByCorr_Good = (ctx.personality === '善良') && (cCorr >= 30) && (semenAmt > 0) && (prevSemenAmt <= 0);
                const triggerByLust_Fallen = (ctx.personality === '堕落') && (cCorr >= 10) && (semenAmt > 0) && (prevSemenAmt <= 0);

                if (finalCurLv > logicalPrevLv) {
                    if (logicalPrevLv === 0) {
                        if (!hasBeenAwakened) {
                            ctx.set('主角.淫纹.已觉醒', true);
                            ctx.set('系统状态.待处理事件.淫纹显现事件', '首次');
                            Logger.event(`🩸 烙印初次显现：经验突破进化点 [${pxp} -> ${finalCxp} XP]，推送「淫纹显现事件（首次）」。`);
                        } else {
                            ctx.set('系统状态.待处理事件.淫纹显现事件', '复燃');
                            Logger.event(`🩸 烙印复燃：旧纹重新激活 [${pxp} -> ${finalCxp} XP]，推送「淫纹显现事件（复燃）」。`);
                        }
                    } else {
                        ctx.set('系统状态.待处理事件.淫纹进化事件', true);
                        Logger.event(`🩸 烙印晋级：经验突破 [${pxp} -> ${finalCxp} XP]，推送「淫纹进化事件」`);
                    }
                } else if (finalCurLv < logicalPrevLv) {
                    if (isManifested) {
                        ctx.set('系统状态.待处理事件.淫纹降级事件', true);
                        Logger.event(`🛡️ 烙印退化：经验掉落 [${pxp} -> ${finalCxp} XP]，推送「淫纹降级事件」`);
                    }
                } else if (finalCurLv === 0 && (triggerByCorr_Good || triggerByLust_Fallen)) {
                    if (!hasBeenAwakened) {
                        ctx.set('主角.淫纹.已觉醒', true);
                        ctx.set('系统状态.待处理事件.淫纹显现事件', '首次');
                        Logger.event('🩸 突发体液浸染，触发「淫纹初次显现事件」。');
                    } else {
                        ctx.set('系统状态.待处理事件.淫纹显现事件', '复燃');
                        Logger.event('🩸 突发体液浸染，旧纹复燃，推送「淫纹显现事件（复燃）」。');
                    }
                }
            }
        }

        _getCurseLv(xp) {
            return xp <= 0 ? 0 : (xp < 150 ? 1 : (xp < 400 ? 2 : 3));
        }

        _getFameLevel(fame) {
            if (fame < 15) return "默默无闻";
            if (fame < 45) return "都市传说";
            if (fame < 85) return "公众热议";
            return "无人不晓";
        }

        _getRepLevel(rep, isFallen) {
            if (isFallen) {
                if (rep <= -70) return "令人战栗的灾厄";
                if (rep <= -30) return "可怕的堕落魔法少女";
                if (rep < 30)   return "一点也不可怕而且很色";
                return "国民级涩情偶像";
            } else {
                if (rep >= 70)  return "圣洁的英雄";
                if (rep >= 30)  return "可靠的守护者";
                if (rep > -30)  return "争议魔法少女";
                if (rep > -70)  return "无能的荡妇";
                return "公共肉便器";
            }
        }

        _daysBetween(fromMMDD, toMMDD) {
            if (!fromMMDD || !toMMDD) return 0;
            if (fromMMDD === toMMDD) return 0;

            const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

            const toDayOfYear = (mmdd) => {
                const m = Math.floor(mmdd / 100);
                const d = mmdd % 100;
                if (m < 1 || m > 12 || d < 1 || d > 31) return 0;
                let sum = d;
                for (let i = 1; i < m; i++) sum += DAYS_IN_MONTH[i];
                return sum;
            };

            const fromDay = toDayOfYear(fromMMDD);
            const toDay = toDayOfYear(toMMDD);

            if (fromDay === 0 || toDay === 0) return 0;

            if (toDay >= fromDay) return toDay - fromDay;

            return (365 - fromDay) + toDay;
        }

        _runReputationDecay(ctx) {
            try {
                if (ctx.get('进程.阶段') !== '幕间休息') return;
                if (ctx.get('世界.幕间H事件.名称', '无') !== '无') return;
                if (ctx.get('系统状态.被俘状态') === true) return;

                const cfg = this.repConfig;

                const fameDelta = ctx.get('名声.知名度', 0) - ctx.getPrev('名声.知名度', 0);
                const repDelta  = ctx.get('名声.风评', 0)  - ctx.getPrev('名声.风评', 0);

if (fameDelta !== 0 || repDelta !== 0) {
    if (ctx.get('名声.沉寂时间', 0) !== 0) {
        ctx.set('名声.沉寂时间', 0);
        Logger.info('📈 声望被刷新，沉寂时间归零。');
    }
    return;
}


                const currDay = ctx.get('世界.日期', 101);
                const prevDay = ctx.getPrev('世界.日期', 101);
                if (currDay === prevDay) return;

                const dayPassed = this._daysBetween(prevDay, currDay);
                if (dayPassed <= 0) return;

                ctx.add('名声.沉寂时间', dayPassed);
                Logger.info(`📅 日期推进 ${dayPassed} 天，沉寂时间累加至 [${ctx.get('名声.沉寂时间')}] 天`);

                const silent = ctx.get('名声.沉寂时间', 0);
                if (silent < cfg.decayInterval) return;

                let times = Math.floor(silent / cfg.decayInterval);
                if (times > cfg.maxDecayPerTick) times = cfg.maxDecayPerTick;

                const fame = ctx.get('名声.知名度', 0);
                const rep  = ctx.get('名声.风评', 0);
                let newFame = fame, newRep = rep;

                for (let i = 0; i < times; i++) {
                    if (newFame > 0) newFame -= 1;
                    if (newRep > 0) newRep -= 1;
                    else if (newRep < 0) newRep += 1;
                }

                ctx.set('名声.知名度', newFame);
                ctx.set('名声.风评', newRep);
                ctx.set('名声.沉寂时间', silent - times * cfg.decayInterval);

                Logger.info(`📉 声望沉寂衰减 ×${times}：知名度 ${fame}→${newFame}，风评 ${rep}→${newRep}，剩余沉寂 [${ctx.get('名声.沉寂时间')}] 天`);
            } catch (e) {
                Logger.warn('声望衰减异常: ' + e.message);
            }
        }

        _deriveReputation(ctx) {
            try {
                const fameLv = this._getFameLevel(ctx.get('名声.知名度', 0));
                const repLv  = this._getRepLevel(ctx.get('名声.风评', 0), ctx.personality === '堕落');

                if (ctx.get('名声.知名度等级') !== fameLv) {
                    ctx.set('名声.知名度等级', fameLv);
                    Logger.info(`🏷️ 知名度等级 → [${fameLv}]`);
                }
                if (ctx.get('名声.风评等级') !== repLv) {
                    ctx.set('名声.风评等级', repLv);
                    Logger.info(`🏷️ 风评等级 → [${repLv}]`);
                }
            } catch (e) {
                Logger.warn('声望派生计算异常: ' + e.message);
            }
        }




        _registerCombat(ctx, result) {
            // 声望推送提前到守卫之前
            if (result === 'WIN' && !ctx.events['声望结算事件'] && !ctx.events['魔法少女恶堕']) {
                ctx.set('系统状态.待处理事件.声望结算事件', JSON.stringify({
                    source: '战斗胜利',
                    h_event_name: '无',
                    h_event_themes: [],
                    boss_name: ctx.get('世界.当前关卡.名称', '无'),
                    boss_type: ctx.get('世界.当前关卡.战斗类型', '无'),
                    boss_themes: [...(ctx.get('世界.当前关卡.核心主题', []) || [])].filter(t => t && !t.startsWith('$'))
                }));
                Logger.event('📢 战斗胜利确立，推送声望结算（来源：战斗胜利）');
            }

            if (ctx.get('主角.生理状态.子宫状态.受孕状态') !== '未受孕') {
                ctx.add('主角.生理状态.子宫状态.孕育信息.妊娠计数器', 1);
                const curCount = ctx.get('主角.生理状态.子宫状态.孕育信息.妊娠计数器', 1);
                Logger.event(`🤰 激战催化胎动：战斗的剧烈魔力与肉体激荡加速了胎儿成长 [妊娠计数: ${curCount}]`);
            }

            const name = ctx.get('世界.当前关卡.名称', '未知敌人');
            if (name === '无' || name === '未知敌人') {
                Logger.warn('⚠️ BOSS 名称为空，跳过生涯数据注册（声望结算已正常推送）。');
                return;
            }

            const entry = {
                "名称": name,
                "核心主题": ctx.get('世界.当前关卡.核心主题', []).filter(t => !t.startsWith('$')),
                "战斗类型": ctx.get('世界.当前关卡.战斗类型', '魔物'),
                "遭遇阵营": ctx.personality,
                "结果": result
            };
            _.set(ctx.data, ['记录', '战斗档案', name], entry);
            ctx.set('世界.当前关卡.Boss韧性值', 0);
            ctx.set('主角.核心状态.当前战斗姿态', '非战斗');

            Logger.event(`📊 战后生涯数据核销：已击杀 Boss [${name}] | 战况: [${result}] 注册完毕。`);

            if (result === 'WIN') {
                ctx.add('记录.已击败Boss计数', 1);

                if (ctx.personality === '善良' && ctx.get('主角.淫纹.经验', 0) > 0) {
                    const baseCleanXp = _.random(15, 25);
                    const unusedPurification = ctx.get('主角.核心状态.净化之力', 0);
                    const ultConversionXp = Math.floor(unusedPurification);
                    const totalCleanXp = baseCleanXp + ultConversionXp;

                    ctx.set('主角.淫纹.经验', Math.max(0, ctx.get('主角.淫纹.经验') - totalCleanXp));
                    Logger.event(`🛡️ 胜利与净化结晶压制：因胜利信念(-${baseCleanXp})与未释放净化之力转化(-${ultConversionXp})，共消融淫纹经验：-${totalCleanXp} XP (剩余净化之力: ${unusedPurification})`);
                }

                const tl = parseInt(ctx.get('世界.威胁等级', 1), 10);
                let strGain = 0, hpGain = 0, mpGain = 0;
                if (tl === 3) {
                    strGain = _.random(8, 13); hpGain = 10; mpGain = 10;
                    ctx.set('系统状态.待处理事件.主角能力成长', '3');
                } else if (tl === 2) {
                    strGain = _.random(4, 9); hpGain = 5; mpGain = 5;
                    ctx.set('系统状态.待处理事件.主角能力成长', '2');
                } else {
                    strGain = _.random(1, 6); hpGain = 3; mpGain = 3;
                }

                ctx.add('主角.核心状态.基础强度', strGain);
                ctx.add('主角.核心状态.体力值.最大', hpGain);
                ctx.add('主角.核心状态.魔力值.最大', mpGain);
                Logger.event(`✨ 胜利恩赐增长：基础强度+${strGain}, 最大生命上限+${hpGain}, 最大魔力上限+${mpGain}`);
            }
        }

        _executeIntermissionHeal(ctx) {
            // ── 1. 日历日期保持不变，但执行一次“周期性身心代谢” ──
            ctx.set('主角.快感状态.高潮阈值', 100);

            // (2) 污染度自然代谢自洁
            const isFallen = ctx.personality === '堕落';
            const curseLv = this._getCurseLv(ctx.get('主角.淫纹.经验', 0));
            let corruptDelta = 0;
            if (isFallen && ctx.get('主角.快感状态.污染度', 0) > 20) {
                corruptDelta -= _.random(5, 10);
            } else if (!isFallen && ctx.get('主角.快感状态.污染度', 0) > 0) {
                corruptDelta -= 2;
            }
            if (curseLv >= 3) corruptDelta += 4; // 高阶淫纹持续侵蚀
            if (corruptDelta !== 0) {
                ctx.add('主角.快感状态.污染度', corruptDelta);
                Logger.info(`✨ 战后休整代谢：污染度变动 ${corruptDelta > 0 ? '+' : ''}${corruptDelta}%`);
            }

            // ── 2. 重置幕间计数与全身状态 ──
            ctx.set('系统状态.幕间回合计数', 0);

            const rawMaxHp = ctx.get('主角.核心状态.体力值.最大', 100);
            const isPregnant = ctx.get('主角.生理状态.子宫状态.受孕状态', '未受孕') !== '未受孕';
            const healTargetHp = isPregnant ? Math.max(0, rawMaxHp - 20) : rawMaxHp;

            ctx.set('主角.核心状态.体力值.当前', healTargetHp);
            ctx.set('主角.核心状态.魔力值.当前', ctx.get('主角.核心状态.魔力值.最大', 100));
            ctx.set('主角.核心状态.变身状态', false);
            ctx.set('主角.核心状态.净化之力', 0);
            ctx.set('主角.核心状态.污秽魔力', 0);
            ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
            ctx.set('主角.快感状态.快感值', 0);

            ['面部', '胸部', '手臂', '腰腹', '臀部', '私处', '腿部'].forEach(p => {
                ctx.set(`主角.身体部位状况.${p}`, '完好');
            });

            ctx.set('世界.当前关卡.名称', '无');
            ctx.set('世界.当前关卡.战斗类型', '无');
            ctx.set('世界.幕间H事件.名称', '无');

            const themePool = ctx.get('系统状态.Boss生成主题池', []).filter(t => t !== '$__META_EXTENSIBLE__$');
            ctx.set('世界.当前关卡.核心主题', themePool.length > 0 ? [_.sample(themePool)] : []);

            const kinks = ctx.get('主角.快感状态.性癖', {});
            const validKinks = Object.keys(kinks).filter(k => k !== '$meta' && kinks[k] && (kinks[k].等级 >= 1 || kinks[k].经验 >= 50));
            if (validKinks.length > 0) {
                ctx.set('世界.幕间H事件.核心主题', [_.sample(validKinks)]);
                ctx.set('系统状态.幕间事件完成', false);
                Logger.info(`🎭 幕间事件重置完毕。检测到已有性癖倾向，开启突发日常事件计时线，锁定日常主题：[${ctx.get('世界.幕间H事件.核心主题').join(', ')}]`);
            } else {
                ctx.set('世界.幕间H事件.核心主题', []);
                ctx.set('系统状态.幕间事件完成', true);
                Logger.info('🎭 幕间日常重置完毕。无任何肉体执着，开始纯洁健康的和平日常线。');
            }
            ctx.set('系统状态.待处理事件.幕间休息完全恢复', true);
        }
    }

    $(() => {
        if (!window.MagicGirlEngineInstance) {
            window.MagicGirlEngineInstance = new MagicGirlEngine();
            setTimeout(() => window.MagicGirlEngineInstance.init(), 500);
        }
    });

    $(window).on('unload', () => {});
})();
