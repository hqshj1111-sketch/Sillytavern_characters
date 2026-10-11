/**
 * 赛博擂台 MVU 核心引擎
 * Designed for CyberArena card
 */
(function () {
    const SCRIPT_NAME = '赛博擂台MVU引擎';
    const SCRIPT_VERSION = 'v2.0';

    // 缓存 textarea 输入 — pre-gen 时 chat 数组未更新，必须从 DOM 缓存读取
    (function setupInputCache() {
        function tryBind() {
            var ta = window.parent.document.querySelector('#send_textarea');
            if (ta) {
                ta.addEventListener('input', function() { var v = ta.value; if (v.trim()) { window.__CYA_LAST_INPUT = v; } });
                window.__CYA_LAST_INPUT = ta.value || '';
                console.info('[赛博擂台MVU引擎] 输入缓存已绑定 send_textarea');
            } else {
                console.warn('[赛博擂台MVU引擎] 未找到 #send_textarea，300ms后重试');
                setTimeout(tryBind, 300);
            }
        }
        tryBind();
    })();

    const CONFIG = {
        VALID_PHASES: ['创角阶段', '幕间日常', '赛前准备', '性斗入场', '性斗阶段', '胜利享用', '败北惩罚', '平局收场', '擂台结算'],
        RANK_TIERS: ['公猪', '公狗', '野猫', '鬣狗', '猎豹', '猛虎', '雄狮'],
        RANK_THRESHOLDS: [0, 500, 1000, 1500, 2000, 2500, 3000],
        TIER_BONUSES: { '公猪': 0, '公狗': 10, '野猫': 30, '鬣狗': 60, '猎豹': 100, '猛虎': 200, '雄狮': 500 },
        APPEARANCE_FEES: { '公猪': 50, '公狗': 50, '野猫': 150, '鬣狗': 150, '猎豹': 300, '猛虎': 300, '雄狮': 600 },
        FEE_MULTIPLIERS: { '公猪': 1, '公狗': 1, '野猫': 1, '鬣狗': 1, '猎豹': 1.5, '猛虎': 1.5, '雄狮': 3 },
        EJACULATION_ENERGY_COST: 15,
        MAX_BODY_MOD_SLOTS: 6,
        MAX_ARENA_ROUNDS: 20,
        MAX_ARENA_SCORE: 99999
    };

    const Logger = {
        info: (msg) => console.log(`[${SCRIPT_NAME}] ${msg}`),
        warn: (msg) => console.warn(`[${SCRIPT_NAME}] ${msg}`),
        error: (msg) => console.error(`[${SCRIPT_NAME}] ${msg}`),
        event: (msg) => console.log(`[${SCRIPT_NAME}] ${msg}`)
    };

    const getChatContext = () => {
        try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext()?.chat || [] : (window.SillyTavern ? window.SillyTavern.getContext()?.chat || [] : []); } catch (e) { return []; }
    };

    function getVariables(opts) {
        try {
            var Mvu = window.Mvu || window.parent?.Mvu || window.top?.Mvu;
            if (!Mvu) return {};
            return Mvu.getVariables(opts || {}) || {};
        } catch (e) { return {}; }
    }
    function replaceVariables(vars, opts) {
        try {
            var Mvu = window.Mvu || window.parent?.Mvu || window.top?.Mvu;
            if (!Mvu) return;
            Mvu.replaceVariables(vars, opts || {});
        } catch (e) {}
    }

    // PRE-gen: 提示词发送前，解析用户输入推送事件
    function onBeforeGeneration() {
        try {
            console.info('[赛博擂台MVU引擎] PRE-GEN 钩子已触发');
            var state = safeGetChatState();
            var text = state.text, msgId = state.msgId;
            if (!text || !msgId) return;

            // ---- 指令: 前往打工 ----
            var workMatch = text.match(/前往打工·(体力活|脑力活|出卖肉体)/);
            if (workMatch) {
                var vars = getVariables();
                _.set(vars, 'stat_data.系统状态.待处理事件.前往打工事件', workMatch[1]);
                replaceVariables(vars);
                Logger.info('预解析: 前往打工·' + workMatch[1]);
            }

            // ---- 指令: 前往擂台 ----
            var arenaMatch = text.match(/前往擂台·(观赛|下注|社交|闲逛)/);
            if (arenaMatch) {
                var vars = getVariables();
                _.set(vars, 'stat_data.系统状态.待处理事件.前往擂台事件', arenaMatch[1]);
                replaceVariables(vars);
                Logger.info('预解析: 前往擂台·' + arenaMatch[1]);
            }

            // ---- 指令: 前往训练 ----
            var trainMatch = text.match(/前往训练·(单人|双人)·(性技|忍耐度|快感阈值|体力|精力)/);
            if (trainMatch) {
                var vars = getVariables();
                _.set(vars, 'stat_data.系统状态.待处理事件.前往训练事件', { type: trainMatch[1], direction: trainMatch[2] });
                replaceVariables(vars);
                Logger.info('预解析: 前往训练·' + trainMatch[1] + '·' + trainMatch[2]);
            }

            // ---- 指令: 请求休息 ----
            var restMatch = text.match(/请求休息/);
            if (restMatch) {
                var vars = getVariables();
                _.set(vars, 'stat_data.擂台状态.是否休息回合', true);
                replaceVariables(vars);
                Logger.info("预解析: 请求休息");
            }

            // ---- 指令: 添加性斗士·"姓名" ----
            var addFighterMatch = text.match(/添加性斗士[·\s]*[「「"](.+?)[」」"]/);
            if (addFighterMatch) {
                var vars = getVariables();
                _.set(vars, 'stat_data.系统状态.待处理事件.性斗士名录维护事件', addFighterMatch[1].trim());
                replaceVariables(vars);
                Logger.info('预解析: 添加性斗士·"' + addFighterMatch[1].trim() + '"');
            }
        } catch (e) { Logger.error('onBeforeGeneration错误: ' + e.message); }
    }

    function safeGetChatState() {
        try {
            var cached = window.__CYA_LAST_INPUT;
            if (cached && cached.trim()) {
                console.info('[赛博擂台MVU引擎] PRE-GEN 使用缓存输入(len=' + cached.length + '): ' + (cached.length > 80 ? cached.slice(0, 80) + '...' : cached));
                window.__CYA_LAST_INPUT = '';
                return { text: cached, msgId: 'latest' };
            }
            console.info('[赛博擂台MVU引擎] PRE-GEN 无缓存输入');
            return { text: '', msgId: null };
        } catch (e) { console.warn('[赛博擂台MVU引擎] safeGetChatState错误: ' + e.message); return { text: '', msgId: null }; }
    }



    class CyberArenaEngine {
        constructor() {
            this.initialized = false;
            this.previousData = null;
            this.baseTurnData = null;
            this.lastTurnSignature = '';
            this.retryCount = 0;
            this.MAX_RETRIES = 10;
            this.settlementPending = false;
            this.growthFightCount = 0;
        }

        init() {
            try {
                const Mvu = window.Mvu || window.parent?.Mvu || window.top?.Mvu;
                if (!Mvu) {
                    this.retryCount++;
                    if (this.retryCount < this.MAX_RETRIES) setTimeout(() => this.init(), 2000);
                    else Logger.error('未检测到MVU框架，核心引擎无法启动！');
                    return;
                }
                // POST-gen: 变量更新后
                eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (wrapper) => { this.tick(wrapper?.stat_data || wrapper); });
                // PRE-gen: 提示词发送前（解析用户输入推送事件）
                eventMakeFirst(tavern_events.GENERATION_AFTER_COMMANDS, onBeforeGeneration);
                this.initialized = true;
                if (window.toastr) toastr.success(`${SCRIPT_VERSION} 挂载完成。`, SCRIPT_NAME);
                Logger.event('核心引擎初始化完成，开始监听变量...');
            } catch (error) { Logger.error('引擎初始化遇到错误: ' + error.message); }
        }

        tick(currentData) {
            if (!currentData || !currentData.进程) return;

            const chat = getChatContext();
            if (chat.length > 0) {
                const lastMsg = chat[chat.length - 1];
                if (lastMsg.is_user || lastMsg.is_system) {
                    return;
                }
            }

            if (!this.previousData) { this.previousData = _.cloneDeep(currentData); this.baseTurnData = _.cloneDeep(currentData); }

            const isNewAiTurn = this.updateTimeline();
            if (isNewAiTurn && this.isSwipe) {
                this.previousData = _.cloneDeep(this.baseTurnData);
            } else if (isNewAiTurn && !this.isSwipe) {
                this.baseTurnData = _.cloneDeep(this.previousData);
            }

            const ctx = this.buildContext(currentData, isNewAiTurn);
            this.runSanitizer(ctx);
            this.runPreMatchInit(ctx);
            this.runSystemEvents(ctx);
            this.runStateMachine(ctx);
            this.previousData = _.cloneDeep(currentData);
        }

        updateTimeline() {
            const chat = getChatContext();
            if (!chat.length) return false;
            const lastMsg = chat[chat.length - 1];
            if (lastMsg.is_user || lastMsg.is_system) return false;
            const currentSignature = `${chat.length}_${lastMsg.swipe_id || 0}`;
            if (this.lastTurnSignature !== currentSignature) {
                this.isSwipe = this.lastTurnSignature.split('_')[0] === String(chat.length);
                this.lastTurnSignature = currentSignature;
                return true;
            }
            return false;
        }

        buildContext(data, isNewTurn) {
            return {
                data: data, prev: this.previousData, isNewTurn: isNewTurn,
                phase: _.get(data, '进程.阶段', '创角阶段'),
                events: _.get(data, '系统状态.待处理事件', {}),
                get: (path, def) => _.get(data, path, def),
                getPrev: (path, def) => _.get(this.previousData, path, def),
                set: (path, val) => _.set(data, path, val),
                add: (path, delta) => { const current = parseFloat(_.get(data, path, 0)) || 0; _.set(data, path, current + (parseFloat(delta) || 0)); }
            };
        }

        // ============================================================
        // 1. runSanitizer — 数据清洗与合法性检查
        // ============================================================
        runSanitizer(ctx) {
            // 布尔值修正
            ['系统状态.主角创建完毕'].forEach(p => {
                const v = ctx.get(p); if (v === 'true') ctx.set(p, true); if (v === 'false') ctx.set(p, false);
            });

            // 阶段合法性
            if (!CONFIG.VALID_PHASES.includes(ctx.get('进程.阶段'))) {
                ctx.set('进程.阶段', '幕间日常');
                Logger.warn('非法阶段值，已强制重置为幕间日常');
            }

            // 擂台积分限幅
            const score = ctx.get('主角.擂台数据.擂台积分');
            if (typeof score === 'number') {
                const clampedScore = Math.round(Math.max(0, Math.min(CONFIG.MAX_ARENA_SCORE, score)));
                if (clampedScore !== score) ctx.set('主角.擂台数据.擂台积分', clampedScore);
            }

            // 主角擂台状态限幅（体力/精力不超过最大）
            const mcMaxStamina = ctx.get('主角.性斗数据.最大体力值', 100);
            const mcMaxEnergy = ctx.get('主角.性斗数据.最大精力值', 100);
            const clampMCRules = [
                ['擂台状态.主角当前体力', 0, mcMaxStamina],
                ['擂台状态.主角当前精力', 0, mcMaxEnergy],
                ['擂台状态.主角当前快感值', 0, 9999],
                ['擂台状态.主角本场射精次数', 0, 999]
            ];
            clampMCRules.forEach(([p, min, max]) => {
                const val = ctx.get(p);
                if (typeof val === 'number') {
                    const clamped = Math.round(Math.max(min, Math.min(max, val)));
                    if (clamped !== val) ctx.set(p, clamped);
                }
            });

            // 对手擂台状态限幅
            const clampOppRules = [
                ['擂台状态.对手当前体力', 0, 9999],
                ['擂台状态.对手当前精力', 0, 9999],
                ['擂台状态.对手当前快感值', 0, 9999],
                ['擂台状态.对手本场射精次数', 0, 999]
            ];
            clampOppRules.forEach(([p, min, max]) => {
                const val = ctx.get(p);
                if (typeof val === 'number') {
                    const clamped = Math.round(Math.max(min, Math.min(max, val)));
                    if (clamped !== val) ctx.set(p, clamped);
                }
            });

            // 回合数限幅
            const turnCount = ctx.get('擂台状态.当前擂台回合数');
            if (typeof turnCount === 'number') {
                const maxRounds = ctx.get('擂台状态.最大擂台回合数', CONFIG.MAX_ARENA_ROUNDS);
                const clamped = Math.round(Math.max(0, Math.min(maxRounds, turnCount)));
                if (clamped !== turnCount) ctx.set('擂台状态.当前擂台回合数', clamped);
            }

            // 性斗数据限幅
            const sexDataClamp = [
                ['主角.性斗数据.性技', 0, 9999],
                ['主角.性斗数据.忍耐度', 0, 9999],
                ['主角.性斗数据.快感阈值', 1, 9999]
            ];
            sexDataClamp.forEach(([p, min, max]) => {
                const val = ctx.get(p);
                if (typeof val === 'number') {
                    const clamped = Math.round(Math.max(min, Math.min(max, val)));
                    if (clamped !== val) ctx.set(p, clamped);
                }
            });

            // 经济限幅
            const credits = ctx.get('主角.经济.信用点');
            if (typeof credits === 'number' && credits < 0) {
                ctx.set('主角.经济.信用点', 0);
            }
            const debt = ctx.get('主角.经济.债务');
            if (typeof debt === 'number' && debt < 0) {
                ctx.set('主角.经济.债务', 0);
            }

            // 身体改造槽位上限检查
            const installedMods = ctx.get('主角.身体改造.已安装', {});
            const modCount = Object.keys(installedMods).filter(k => k !== '$meta' && k !== '$__META_EXTENSIBLE__$').length;
            if (modCount > CONFIG.MAX_BODY_MOD_SLOTS) {
                Logger.warn(`身体改造数量(${modCount})超过槽位上限(${CONFIG.MAX_BODY_MOD_SLOTS})！`);
            }

            // 战斗日志跨阶段清理
            if (ctx.get('进程.阶段') !== '性斗阶段') {
                if (ctx.get("擂台状态.当前性斗日志").length > 0)
                  ctx.set("擂台状态.当前性斗日志", []);
            } else {
                const cLog = ctx.get('擂台状态.当前性斗日志');
                if (
                  cLog.length > 0 &&
                  cLog === ctx.getPrev("擂台状态.当前性斗日志")
                ) {
                  ctx.set("擂台状态.当前性斗日志", []);
                }
            }
        }

        // ============================================================
        // 2. runPreMatchInit — 赛前初始化
        // ============================================================
        runPreMatchInit(ctx) {
            const prevPhase = ctx.getPrev('进程.阶段', '');
            const curPhase = ctx.get('进程.阶段', '');

            if ((curPhase === '赛前准备' || curPhase === '性斗入场') && prevPhase !== curPhase) {
                Logger.event('检测到进入赛前准备/性斗入场，执行赛前数据同步...');

                const heroSexTech = ctx.get('主角.性斗数据.性技', 50);
                const heroEndurance = ctx.get('主角.性斗数据.忍耐度', 50);
                const heroMaxStamina = ctx.get('主角.性斗数据.最大体力值', 100);
                const heroMaxEnergy = ctx.get('主角.性斗数据.最大精力值', 100);
                const heroThreshold = ctx.get('主角.性斗数据.快感阈值', 100);

                const mods = ctx.get('主角.身体改造.已安装', {});
                let techBonus = 0, endBonus = 0, stamBonus = 0, energyBonus = 0, threshBonus = 0;
                Object.keys(mods).forEach(k => {
                    if (k === '$meta' || k === '$__META_EXTENSIBLE__$') return;
                    const mod = mods[k] || {};
                    techBonus += parseInt(mod.性技加成 || 0);
                    endBonus += parseInt(mod.忍耐度加成 || 0);
                    stamBonus += parseInt(mod.最大体力值加成 || 0);
                    energyBonus += parseInt(mod.最大精力值加成 || 0);
                    threshBonus += parseInt(mod.快感阈值加成 || 0);
                });

                ctx.set('擂台状态.主角性技', heroSexTech + techBonus);
                ctx.set('擂台状态.主角忍耐度', heroEndurance + endBonus);
                ctx.set('擂台状态.主角当前体力', heroMaxStamina + stamBonus);
                ctx.set('擂台状态.主角当前精力', heroMaxEnergy + energyBonus);
                ctx.set('擂台状态.主角当前快感值', 0);
                ctx.set('擂台状态.主角本场射精次数', 0);
                ctx.set('擂台状态.主角当前人气', ctx.get('主角.擂台数据.人气', 0));

                Logger.info(`赛前数据同步: 主角性技=${heroSexTech + techBonus} 忍耐度=${heroEndurance + endBonus} 体力=${heroMaxStamina + stamBonus} 精力=${heroMaxEnergy + energyBonus}`);
            }
        }

        // ============================================================
        // runSystemEvents — 系统事件（催债等）
        // ============================================================
        runSystemEvents(ctx) {
            // ---- 催债检测 ----
            const debt = parseInt(ctx.get('主角.经济.债务', 0)) || 0;
            if (debt > 0) {
                const debtDate = ctx.get('主角.经济.债务到期日期', '');
                if (debtDate) {
                    const curY = parseInt(ctx.get('进程.当前年份', 2087));
                    const curM = parseInt(ctx.get('进程.当前月份', 1));
                    const curD = parseInt(ctx.get('进程.当前日份', 1));
                    const parsed = debtDate.match(/(\d+)年(\d+)月(\d+)日/);
                    if (parsed) {
                        const dueY = parseInt(parsed[1]), dueM = parseInt(parsed[2]), dueD = parseInt(parsed[3]);
                        const curDays = curY * 365 + curM * 30 + curD;
                        const dueDays = dueY * 365 + dueM * 30 + dueD;
                        if (curDays >= dueDays) {
                            const isUrged = String(ctx.get('主角.经济.是否催债', false)) === 'true';
                            const pending = ctx.get('系统状态.待处理事件', {});
                            if (!isUrged && !pending['催债事件']) {
                                ctx.set('系统状态.待处理事件.催债事件', true);
                                Logger.warn('催债事件触发: 债务' + debt + '信用点逾期');
                            }
                        }
                    }
                }
            }

            // ---- 好感度里程碑: 100触发表露真心 ----
            const phase = ctx.get('进程.阶段', '');
            if (phase !== '幕间日常' && phase !== '赛前准备') return;

            const pendingEvents = ctx.get('系统状态.待处理事件', {});
            if (pendingEvents['表露真心事件']) return;

            // 检查性斗士名录 — 仅当跨过100时触发
            const roster = ctx.get('记录.性斗士名录', {});
            Object.keys(roster).forEach(name => {
                if (name === '$meta' || name === '$__META_EXTENSIBLE__$') return;
                const curVal = parseInt(_.get(roster, name + '.好感度', 0)) || 0;
                const prevVal = parseInt(ctx.getPrev('记录.性斗士名录.' + name + '.好感度', 0)) || 0;
                if (curVal >= 100 && prevVal < 100) {
                    ctx.set('系统状态.待处理事件.表露真心事件', { type: '性斗士', name: name, alias: roster[name].擂台代号 || name });
                    Logger.event('表露真心: 性斗士 ' + (roster[name].擂台代号 || name) + ' 好感度从' + prevVal + '→' + curVal);
                }
            });

            // 检查一般NPC名录 — 仅当跨过100时触发
            const npcs = ctx.get('记录.一般NPC名录', {});
            Object.keys(npcs).forEach(name => {
                if (name === '$meta' || name === '$__META_EXTENSIBLE__$') return;
                const curVal = parseInt(_.get(npcs, name + '.好感度', 0)) || 0;
                const prevVal = parseInt(ctx.getPrev('记录.一般NPC名录.' + name + '.好感度', 0)) || 0;
                if (curVal >= 100 && prevVal < 100) {
                    ctx.set('系统状态.待处理事件.表露真心事件', { type: '一般NPC', name: name });
                    Logger.event('表露真心: 一般NPC ' + name + ' 好感度从' + prevVal + '→' + curVal);
                }
            });
        }

        // ============================================================
        // 5. runStateMachine — 阶段状态机
        // ============================================================
        runStateMachine(ctx) {
            const prevPhase = ctx.getPrev('进程.阶段', '创角阶段');
            const curPhase = ctx.get('进程.阶段', '创角阶段');

            // --- 创角 → 幕间日常 ---
            if (prevPhase === '创角阶段' && curPhase === '幕间日常') {
                Logger.event('首次进入幕间日常，执行初始环境装填...');
                ctx.set('系统状态.幕间回合计数', 0);
            }

            // --- 幕间日常回合计数 ---
            if (curPhase === '幕间日常' && ctx.isNewTurn) {
                const hasActiveEvent = Object.keys(ctx.events).some(k =>
                    k !== '$meta' && k !== '$__META_EXTENSIBLE__$' && String(ctx.events[k]) === 'true'
                );
                if (!hasActiveEvent) {
                    ctx.add('系统状态.幕间回合计数', 1);
                }
            }

            // --- 性斗阶段：回合轮替与胜负判定 ---
            if (curPhase === '性斗阶段') {
                const isRest = String(ctx.get('擂台状态.是否休息回合')) === 'true';

                if (ctx.isNewTurn && !isRest) {
                    const curAttacker = ctx.get('擂台状态.当前进攻方', '主角');
                    const nextAttacker = curAttacker === '主角' ? '对手' : '主角';
                    ctx.set('擂台状态.当前进攻方', nextAttacker);
                    ctx.add('擂台状态.当前擂台回合数', 1);
                    Logger.info(`回合轮替: 进攻方→${nextAttacker}, 回合数→${ctx.get('擂台状态.当前擂台回合数')}`);
                }

                const mcEnergy = ctx.get('擂台状态.主角当前精力', 100);
                const oppEnergy = ctx.get('擂台状态.对手当前精力', 100);
                const turnCount = ctx.get('擂台状态.当前擂台回合数', 0);
                const maxTurns = ctx.get('擂台状态.最大擂台回合数', CONFIG.MAX_ARENA_ROUNDS);

                if (oppEnergy <= 0) {
                    ctx.set('进程.阶段', '胜利享用');
                    Logger.event('对手精力归零，转入胜利享用阶段');
                } else if (mcEnergy <= 0) {
                    ctx.set('进程.阶段', '败北惩罚');
                    Logger.warn('主角精力归零，转入败北惩罚阶段');
                } else if (turnCount >= maxTurns) {
                    ctx.set('进程.阶段', '平局收场');
                    Logger.info('回合上限到达，转入平局收场阶段');
                }
            }

            // --- 擂台结算 → 幕间日常 过渡 ---
            // 结算数值和阶段切换由擂台结算词条通过JSONPatch完成
            // 监控器仅做擂台状态重置
            if (curPhase === '幕间日常' && ['擂台结算', '胜利享用', '败北惩罚', '平局收场'].includes(prevPhase)) {
                ctx.set('系统状态.幕间回合计数', 0);
                this._executeArenaReset(ctx);
                this.growthFightCount = (this.growthFightCount || 0) + 1;
                if (this.growthFightCount >= 3) {
                    ctx.set('系统状态.待处理事件.性技成长事件', '已推送');
                    this.growthFightCount = 0;
                    Logger.event('已累计3场比赛，推送性技成长事件');
                }
                Logger.event('擂台流程结束，擂台状态已重置，幕间回合计数归零');
            }
        }

        // ============================================================
        // 5a. _executeArenaReset — 擂台状态重置
        // ============================================================
        _executeArenaReset(ctx) {
            const mcMaxStamina = ctx.get('主角.性斗数据.最大体力值', 100);
            const mcMaxEnergy = ctx.get('主角.性斗数据.最大精力值', 100);

            ctx.set('擂台状态.主角当前体力', mcMaxStamina);
            ctx.set('擂台状态.主角当前精力', mcMaxEnergy);
            ctx.set('擂台状态.主角当前快感值', 0);
            ctx.set('擂台状态.主角本场射精次数', 0);
            ctx.set('擂台状态.对手当前体力', 100);
            ctx.set('擂台状态.对手当前精力', 100);
            ctx.set('擂台状态.对手当前快感值', 0);
            ctx.set('擂台状态.对手本场射精次数', 0);
            ctx.set('擂台状态.当前擂台回合数', 1);
            ctx.set('擂台状态.当前进攻方', '主角');
            ctx.set('擂台状态.是否休息回合', false);
            ctx.set('擂台状态.当前性斗日志', []);
            ctx.set("擂台状态.当前擂台叙事", "");
            ctx.set('擂台状态.对手名字', '');
            ctx.set('擂台状态.对手积分', 0);
            ctx.set('擂台状态.对手段位', '公猪');
            ctx.set('擂台状态.对手性技', 0);
            ctx.set('擂台状态.对手忍耐度', 0);
            ctx.set('擂台状态.主角赔率', 1.0);
            ctx.set('擂台状态.对手赔率', 1.0);
            ctx.set('擂台状态.主角当前人气', 0);
            ctx.set('擂台状态.对手当前人气', 0);
            ctx.set('擂台状态.性斗日期', '');
            ctx.set('擂台状态.当前弹幕列表', []);
            Logger.info('擂台状态已重置');
        }
    }

    try {
        const engine = new CyberArenaEngine();
        engine.init();
    } catch (e) {
        console.error(`[${SCRIPT_NAME}] 启动失败: ${e.message}`);
    }
})();
