/**
 * 小英雄 MVU 核心游戏引擎 - 架构重构 (v23.5 Ultimate Log Edition)
 * Designed by SillyTavern Master
 */
(function () {
    const SCRIPT_NAME = '小英雄MVU引擎';
    const SCRIPT_VERSION = 'v23.5 Log Enhanced';

    const CONFIG = {
        KINK_THRESHOLDS: [
            { level: 4, xp: 1000 }, { level: 3, xp: 500 },
            { level: 2, xp: 250 },  { level: 1, xp: 100 }, { level: 0, xp: 0 }
        ],
        VALID_PHASES: ['创角阶段', '幕间休息', '战斗准备', '战斗回合', '终结回合', '战斗胜利', '战斗败北', '战后处理', '被捕囚禁'],
        VALID_POSTURES: ['非战斗', '战斗中', '劣势', '力尽待辱', '战后虚弱']
    };

    const Logger = {
        info: (msg) => console.log(`[${SCRIPT_NAME}] 🔵 ${msg}`),
        warn: (msg) => console.warn(`[${SCRIPT_NAME}] 🟡 ${msg}`),
        error: (msg) => { console.error(`[${SCRIPT_NAME}] 🔴 ${msg}`); if (window.toastr) toastr.error(msg, SCRIPT_NAME); },
        event: (msg) => console.log(`[${SCRIPT_NAME}] ✨ ${msg}`),
        toast: (msg, type = 'success') => { console.log(`[${SCRIPT_NAME}] 💬 ${msg}`); if (window.toastr) toastr[type](msg, '状态更新'); }
    };

    const getChatContext = () => {
        try { return (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext()?.chat || [] : (window.SillyTavern ? window.SillyTavern.getContext()?.chat || [] : []); } catch (e) { return []; }
    };

    class MagicBoyEngine {
        constructor() {
            this.initialized = false;
            this.baseTurnData = null;  
            this.previousData = null;  
            this.lastTurnSignature = '';
            this.retryCount = 0;
            this.MAX_RETRIES = 10;
            this.counters = { finisher: 0, victory: 0, defeatPersistence: 0 };
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
                eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, (wrapper) => { this.tick(wrapper?.stat_data || wrapper); });
                this.updateTimeline();
                this.initialized = true;
                if (window.toastr) toastr.success(`${SCRIPT_VERSION} 挂载完成，引擎全功率运转。`, SCRIPT_NAME);
                Logger.event('🚀 核心引擎初始化完成，开始监听变量...');
            } catch (error) { Logger.error('引擎初始化遇到严重错误: ' + error.message); }
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

            if (!this.previousData) { this.previousData = _.cloneDeep(currentData); this.baseTurnData = _.cloneDeep(currentData); }

            const isNewAiTurn = this.updateTimeline();
            if (isNewAiTurn && this.isSwipe) {
                Logger.warn('🔄 侦测到重新生成 (Swipe)，回滚内存快照防止数据污染。');
                this.previousData = _.cloneDeep(this.baseTurnData);
            } else if (isNewAiTurn && !this.isSwipe) {
                this.baseTurnData = _.cloneDeep(this.previousData);
            }

            const ctx = this.buildContext(currentData, isNewAiTurn);
            this.runSanitizer(ctx);        
            this.runReactiveSystem(ctx);   
            this.runStateMachine(ctx);     
            this.runMilestones(ctx);       
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
                phase: _.get(data, '进程.阶段', '幕间休息'),
                personality: _.get(data, '主角.核心状态.人格状态', '英雄'),
                events: _.get(data, '系统状态.待处理事件', {}),
                get: (path, def) => _.get(data, path, def),
                getPrev: (path, def) => _.get(this.previousData, path, def),
                set: (path, val) => _.set(data, path, val),
                add: (path, delta) => { const current = parseFloat(_.get(data, path, 0)) || 0; _.set(data, path, current + (parseFloat(delta) || 0)); }
            };
        }

        runSanitizer(ctx) {
            ['主角.核心状态.着装状态', '系统状态.主角创建完毕', '系统状态.幕间事件完成'].forEach(p => {
                const v = ctx.get(p); if (v === 'true') ctx.set(p, true); if (v === 'false') ctx.set(p, false);
            });

            if (!CONFIG.VALID_PHASES.includes(ctx.get('进程.阶段'))) {
                ctx.set('进程.阶段', '幕间休息');
                Logger.warn(`⚠️ 非法阶段值，已强制重置为幕间休息`);
            }
            if (!CONFIG.VALID_POSTURES.includes(ctx.get('主角.核心状态.当前战斗姿态'))) {
                ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
                Logger.warn(`⚠️ 非法战斗姿态，已重置为非战斗`);
            }

            const maxHp = ctx.get('主角.核心状态.体力值.最大', 100), maxMp = ctx.get('主角.核心状态.能量值.最大', 100);
            const clampRules = [
                ['主角.核心状态.体力值.当前', 0, maxHp], ['主角.核心状态.能量值.当前', 0, maxMp],
                ['主角.快感状态.快感值', 0, 9999], ['主角.快感状态.侵蚀度', 0, 100],
                ['主角.核心状态.正义充能', 0, 100], ['主角.核心状态.混沌充能', 0, 100],
                ['世界.当前关卡.Boss韧性值', 0, 100], ['主角.黑暗印记.经验', 0, 9999]
            ];
            clampRules.forEach(([p, min, max]) => {
                const val = ctx.get(p);
                if (typeof val === 'number') { const clamped = Math.round(Math.max(min, Math.min(max, val))); if (clamped !== val) ctx.set(p, clamped); }
            });

            let themes = ctx.get('世界.当前关卡.核心主题', []);
            if (!Array.isArray(themes)) themes = themes ? [themes] : [];
            const cleanThemes = _.uniq(themes.filter(t => t !== '$__META_EXTENSIBLE__$'));
            cleanThemes.push('$__META_EXTENSIBLE__$');
            if (!_.isEqual(themes, cleanThemes)) {
                ctx.set('世界.当前关卡.核心主题', cleanThemes);
                Logger.info('🧹 核心主题数组已净化去重');
            }

            const curMods = ctx.get('主角.永久性身体改造', {});
            const prevMods = ctx.getPrev('主角.永久性身体改造', {});
            Object.keys(curMods).forEach(k => {
                if (k === '$meta') return;
                if (!prevMods[k]) {
                    const mod = curMods[k] || {};
                    ctx.set(`主角.永久性身体改造.${k}`, { "部位": mod.部位 || "待设定", "详情": mod.详情 || "待设定", "来源": mod.来源 || "未知" });
                    Logger.event(`🧬 新增身体改造登记：[${k}]`);
                    
                    if (k.includes('黑暗印记') || k.includes('烙印') || k.includes('刻印')) {
                        const prevCurseXp = ctx.getPrev('主角.黑暗印记.经验', 0);
                        const currentCurseXp = ctx.get('主角.黑暗印记.经验', 0);
                        const curseLv = currentCurseXp <= 0 ? 0 : (currentCurseXp < 150 ? 1 : (currentCurseXp < 400 ? 2 : 3));
                        
                        if (prevCurseXp <= 0) {
                            if (!ctx.events['黑暗印记显现事件'] && !ctx.events['黑暗印记复苏事件']) {
                                ctx.set('系统状态.待处理事件.黑暗印记显现事件', true);
                                Logger.warn(`🩸 身体改造触发关联: 强制诱发黑暗印记显现`);
            }

                        } else if (curseLv < 3) {
                            ctx.add('主角.黑暗印记.经验', 40);
                            Logger.info(`🩸 身体改造叠加: 吸收同类烙印转化为经验 (+40XP)`);
                        } else {
                            ctx.add('主角.黑暗印记.经验', 15);
                            Logger.info(`🩸 身体改造叠加: 黑暗印记已达极限(Lv.3)，默默吞噬新烙印 (+15XP)`);
                }
            }

            // 善堕备份：小英雄黑化事件首次创建时保存原始英雄身份
            if (ctx.events['小英雄黑化'] && !ctx.getPrev('系统状态.待处理事件.小英雄黑化')) {
                const heroName = ctx.get('主角.基本信息.英雄名', '');
                const suit = ctx.get('主角.个人信息.紧身战衣', '');
                const color = ctx.get('主角.个人信息.代表色', '');
                const ability = ctx.get('主角.个人信息.核心能力', '');
                const trait = ctx.get('主角.个人信息.性格特质', '');
                if (heroName && heroName !== '待设定') {
                    ctx.set('主角.核心状态.善堕备份', {
                        英雄名: heroName,
                        紧身战衣: suit,
                        代表色: color,
                        核心能力: ability,
                        性格特质: trait
                    });
                    Logger.info(`📦 善堕备份已保存原始英雄身份：${heroName}`);
                }
                ctx.add('记录.黑化次数', 1);
                Logger.event(`🖤 黑化计数 +1 (当前: ${ctx.get('记录.黑化次数', 0)})`);
            }

            // 恶堕备份：善堕事件首次创建时保存当前反派身份（供下次黑化恢复）
            if (ctx.events['善堕事件'] && !ctx.getPrev('系统状态.待处理事件.善堕事件')) {
                const fallenName = ctx.get('主角.基本信息.英雄名', '');
                const fallenSuit = ctx.get('主角.个人信息.紧身战衣', '');
                const fallenColor = ctx.get('主角.个人信息.代表色', '');
                const fallenAbility = ctx.get('主角.个人信息.核心能力', '');
                const fallenTrait = ctx.get('主角.个人信息.性格特质', '');
                const fallenMaster = ctx.get('主角.核心状态.主人', '无');
                const markData = ctx.get('主角.永久性身体改造.组织刻印', null);
                ctx.set('主角.核心状态.恶堕备份', {
                    英雄名: fallenName,
                    紧身战衣: fallenSuit,
                    代表色: fallenColor,
                    核心能力: fallenAbility,
                    性格特质: fallenTrait,
                    主人: fallenMaster,
                    组织刻印: markData ? { 部位: markData.部位 || '脸颊', 详情: markData.详情 || '', 来源: markData.来源 || '怪人组织' } : null
                });
                Logger.info(`📦 恶堕备份已保存当前反派身份：${fallenName} (主人: ${fallenMaster})`);
                ctx.add('记录.善堕次数', 1);
                Logger.event(`🤍 善堕计数 +1 (当前: ${ctx.get('记录.善堕次数', 0)})`);
            }
        }
            });

            if (ctx.get('进程.阶段') !== '战斗回合') {
                if (ctx.get('主角.战斗临时.当前战斗日志') !== '无') ctx.set('主角.战斗临时.当前战斗日志', '无');
            } else {
                const cLog = ctx.get('主角.战斗临时.当前战斗日志');
                if (cLog !== '无' && cLog === ctx.getPrev('主角.战斗临时.当前战斗日志')) {
                    ctx.set('主角.战斗临时.当前战斗日志', '无');
                    Logger.info('📝 战斗日志跨回合自动清理');
                }
            }

            if (ctx.get('主角.生理状态.体液与分泌.能量核心内精液.存量', 0) <= 0) {
                const sources = ctx.get('主角.生理状态.体液与分泌.能量核心内精液.来源', {});
                if (Object.keys(sources).length > 0) {
                    ctx.set('主角.生理状态.体液与分泌.能量核心内精液.来源', {});
                    Logger.info('🧼 精液存量耗尽，已清空能量核心内来源记录');
                }
            }
            ctx.set('主角.战斗临时.临时强度加值', 0);
            
            const bossName = ctx.get('世界.当前关卡.名称', '无');
            if (ctx.get('进程.阶段') === '幕间休息' && (bossName === '无' || bossName === '预警威胁') && cleanThemes.length <= 1) {
                const pool = ctx.get('系统状态.Boss生成主题池', []).filter(t => t !== '$__META_EXTENSIBLE__$');
                if (pool.length > 0) {
                    const chosen = _.sample(pool);
                    ctx.set('世界.当前关卡.核心主题', [chosen]);
                    Logger.info(`📡 幕间雷达：自动装填潜伏威胁主题 -> [${chosen}]`);
                }
            }
        }

        runReactiveSystem(ctx) {
            let pleasure = ctx.get('主角.快感状态.快感值', 0);
            let threshold = ctx.get('主角.快感状态.高潮阈值', 100);
            
            if (ctx.getPrev('系统状态.待处理事件.高潮事件') && !ctx.events['高潮事件']) {
                let loopSafety = 0;
                while (pleasure >= threshold && loopSafety < 10) {
                    pleasure -= threshold; 
                    loopSafety++;
                    if (ctx.get('进程.阶段') === '战斗回合' && ctx.personality === '英雄') {
                        const hpD = _.random(5, 10), mpD = _.random(10, 20), corrD = _.random(8, 15);
                        ctx.add('主角.核心状态.体力值.当前', -hpD);
                        ctx.add('主角.核心状态.能量值.当前', -mpD);
                        ctx.add('主角.快感状态.侵蚀度', corrD);
                        threshold += 20; 
                        ctx.set('主角.快感状态.高潮阈值', threshold);
                        Logger.warn(`💢 战斗高潮惩罚结算：HP-${hpD}, MP-${mpD}, 侵蚀度+${corrD}`);
                    }
                }
                ctx.set('主角.快感状态.快感值', pleasure);
                
                if (loopSafety > 0) {
                    ctx.add('主角.快感状态.总高潮次数', loopSafety);
                    Logger.event(`🌊 高潮事件已由AI结算完毕：共计绝顶 ${loopSafety} 次，剩余快感 ${pleasure}`);
                }
                if (ctx.get('主角.黑暗印记.经验', 0) > 0) {
                    ctx.add('主角.黑暗印记.经验', _.random(10, 15));
                }
            }

            if (pleasure >= threshold && !ctx.events['高潮事件']) {
                ctx.set('系统状态.待处理事件.高潮事件', true);
                Logger.event(`💥 快感突破阈值！挂载高潮事件 (快感: ${pleasure} / 阈值: ${threshold})`);
                if (ctx.get('进程.阶段') === '战斗回合') {
                    const bossThemes = ctx.get('世界.当前关卡.核心主题', []).filter(t => !t.startsWith('$'));
                    if (bossThemes.length > 0) {
                        const xpGain = _.random(25, 40);
                        bossThemes.forEach(t => { if (ctx.get(`主角.快感状态.性癖.${t}`)) ctx.add(`主角.快感状态.性癖.${t}.经验`, xpGain); });
                    }
                }
            }

            if (ctx.getPrev('系统状态.待处理事件.体内满溢事件') && !ctx.events['体内满溢事件']) {
                const cap = ctx.get('主角.生理状态.能量核心状态.最大容量', 50);
                if (cap < 200) {
                    const expanded = Math.min(200, cap + _.random(10, 20));
                    ctx.set('主角.生理状态.能量核心状态.最大容量', expanded);
                    Logger.event(`🏺 能量核心适应了扩张，最大容量提升至 ${expanded}ml`);
                }
            }

            const semenAmt = ctx.get('主角.生理状态.体液与分泌.能量核心内精液.存量', 0);
            if (semenAmt > ctx.get('主角.生理状态.能量核心状态.最大容量', 50) && !ctx.events['体内满溢事件']) {
                ctx.set('系统状态.待处理事件.体内满溢事件', true);
                Logger.warn(`💦 精液存量 (${semenAmt}ml) 撑破极限，触发体内满溢事件！`);
            }

            const semenDelta = semenAmt - ctx.getPrev('主角.生理状态.体液与分泌.能量核心内精液.存量', 0);
            if (semenDelta > 0 && ctx.personality === '英雄' && ctx.get('进程.阶段') === '战斗回合') {
                const cGain = _.random(3, 8) + Math.floor(semenDelta / 50) * _.random(1, 3);
                ctx.add('主角.快感状态.侵蚀度', cGain);
                Logger.warn(`☣️ 英雄线战斗内射惩罚：侵蚀度激增 +${cGain} (注入量: ${semenDelta}ml)`);
            }

            // 反派×小英雄：纯洁能力净化堕落（1ml精液 = -1侵蚀度）
            const combatType = ctx.get('世界.当前关卡.战斗类型', '无');
            if (semenDelta > 0 && ctx.personality === '反派' && combatType === '小英雄' && ['战斗败北', '战斗回合', '终结回合', '战后处理'].includes(ctx.get('进程.阶段'))) {
                const purifyAmount = Math.min(semenDelta, ctx.get('主角.快感状态.侵蚀度', 0));
                ctx.add('主角.快感状态.侵蚀度', -purifyAmount);
                Logger.info(`🕊️ 小英雄的纯洁能力净化堕落：侵蚀度 -${purifyAmount} (注入量: ${semenDelta}ml)`);
                
                if (ctx.get('主角.快感状态.侵蚀度', 0) <= 0 && !ctx.events['善堕事件']) {
                    ctx.set('主角.快感状态.侵蚀度', 0);
                    ctx.set('系统状态.待处理事件.善堕事件', true);
                    Logger.event('✨ 侵蚀度归零！主角体内的黑暗被完全净化，善堕事件触发！');
                }
            }

            // 日期跨天结算
            const currentDay = ctx.get('世界.日期', 20260305), previousDay = ctx.getPrev('世界.日期', 20260305);
            if (currentDay > previousDay) {
                Logger.event(`🌅 日历翻篇，新的一天！重置高潮阈值并计算侵蚀度衰减...`);
                ctx.set('主角.快感状态.高潮阈值', 100); 
                let corruptDelta = 0;
                if (ctx.personality === '反派' && ctx.get('主角.快感状态.侵蚀度', 0) > 20) corruptDelta -= _.random(5, 10);
                else if (ctx.personality === '英雄' && ctx.get('主角.快感状态.侵蚀度', 0) > 0) corruptDelta -= 2;
                if (this._getCurseLv(ctx.get('主角.黑暗印记.经验', 0)) >= 3) {
                    corruptDelta += 4; 
                    Logger.warn(`👿 黑暗印记Lv.3散发荷尔蒙，每日侵蚀加剧 +4`);
                }
                if (corruptDelta !== 0) {
                    ctx.add('主角.快感状态.侵蚀度', corruptDelta);
                    Logger.info(`⏳ 每日侵蚀度变动结算：${corruptDelta > 0 ? '+'+corruptDelta : corruptDelta}`);
                }
            }

            // 黑暗印记每回合经验结算
            if (ctx.isNewTurn) {
                let xpGain = 0;
                let logDetails = [];
                
                const phase = ctx.get('进程.阶段');
                const isCombatRelated = ['战斗准备', '战斗回合', '终结回合', '战斗败北', '战后处理'].includes(phase);
                
                const corruption = ctx.get('主角.快感状态.侵蚀度', 0);
                if (corruption < 20) { 
                    if (!isCombatRelated) { xpGain -= 1; logDetails.push("纯洁排斥(-1)"); }
                }
                else if (corruption > 70) { xpGain += 2; logDetails.push("重度侵蚀共鸣(+2)"); }
                else if (corruption > 50) { xpGain += 1; logDetails.push("侵蚀共鸣(+1)"); }
                
                const semenAmt2 = ctx.get('主角.生理状态.体液与分泌.能量核心内精液.存量', 0);
                if (semenAmt2 > 0) {
                    let nourish = Math.floor(semenAmt2 / 20) || 1;
                    if (nourish > 5) nourish = 5;
                    const finalNourish = (ctx.personality === '反派') ? nourish * 2 : nourish;
                    xpGain += finalNourish; logDetails.push(`精液滋养(+${finalNourish})`);
                    Logger.info(`🍼 体内残留精液(${semenAmt2}ml)滋养黑暗印记: +${finalNourish} XP`);
                } else {
                    if (!isCombatRelated) {
                        xpGain -= 2; logDetails.push("能量核心空虚(-2)");
                        Logger.warn(`💧 能量核心空虚，黑暗印记缺乏白浊滋养，开始衰退: -2 XP`);
                    } else { logDetails.push("高压期(暂缓衰退)"); }
                }
                
                if (ctx.events['高潮事件']) {
                    const climaxBonus = _.random(8, 12);
                    xpGain += climaxBonus; logDetails.push(`高潮激化(+${climaxBonus})`);
                }

                if (xpGain !== 0) {
                    const curXp = ctx.get('主角.黑暗印记.经验', 0);
                    if (curXp > 0) {
                        const finalXp = Math.max(0, curXp + xpGain);
                        if (finalXp !== curXp) {
                            ctx.set('主角.黑暗印记.经验', finalXp);
                            const diff = finalXp - curXp;
                            Logger.info(`📈 黑暗印记经验结算 [${logDetails.join(', ')}]：${diff > 0 ? '+'+diff : diff} (当前总计: ${finalXp})`);
                        }
                    } else {
                        Logger.info(`🛡️ 黑暗印记尚未觉醒，免疫本次常规高潮/体液经验累积: ${xpGain > 0 ? '+'+xpGain : xpGain} XP`);
                    }
                }
            }

            const curseLv = this._getCurseLv(ctx.get('主角.黑暗印记.经验', 0));
            if (curseLv >= 2) {
                const mpLoss = ctx.getPrev('主角.核心状态.能量值.当前', 0) - ctx.get('主角.核心状态.能量值.当前', 0);
                if (mpLoss > 0) {
                    const gain = Math.max(1, Math.floor(mpLoss * 0.3));
                    ctx.add('主角.快感状态.快感值', gain);
                    Logger.warn(`😈 黑暗印记能量发情：能量流失 ${mpLoss} → 强行转化为快感 +${gain}`);
                }
            }
            if (curseLv >= 3) {
                const hpLoss = ctx.getPrev('主角.核心状态.体力值.当前', 0) - ctx.get('主角.核心状态.体力值.当前', 0);
                if (hpLoss > 0) {
                    const gain = Math.max(1, Math.floor(hpLoss * 0.5));
                    ctx.add('主角.快感状态.快感值', gain);
                    Logger.warn(`🩸 黑暗印记痛觉转化：体力损伤 ${hpLoss} → 强行转化为快感 +${gain}`);
                }
            }

            if (ctx.personality === '英雄' && ctx.get('主角.快感状态.侵蚀度', 0) >= 100) {
                if (!ctx.events['黑化临界'] && !ctx.events['小英雄黑化']) {
                    ctx.set('系统状态.待处理事件.黑化临界', true);
                    Logger.error('💀 侵蚀度触及100%极限临界点！堕落危机即将爆发！');
                }
            }

            if (ctx.get('主角.核心状态.着装状态') && ctx.get('主角.核心状态.能量值.当前', 0) <= 0) {
                ctx.set('主角.核心状态.着装状态', false); 
                ctx.set('系统状态.待处理事件.强制解除着装', true);
                Logger.warn('💔 能量彻底耗尽，着装状态被强制解除！');
            }

            if (ctx.get('系统状态.幕间事件完成', true)) {
                if (String(ctx.getPrev('系统状态.幕间事件完成', true)) === 'false') {
                    ctx.set('系统状态.幕间回合计数', 0);
                    Logger.info('✅ 幕间事件已清算完成，重置待机回合计数。');
                }
                if (ctx.get('世界.幕间H事件.名称') !== '无') ctx.set('世界.幕间H事件.名称', '无');
                const hThemes = ctx.get('世界.幕间H事件.核心主题', []);
                if (hThemes.length > 1 || hThemes[0] !== '$__META_EXTENSIBLE__$') {
                    ctx.set('世界.幕间H事件.核心主题', []);
                }
            }

            // === 小英雄名录：内射 → 恶堕/善堕进度 ===
            const roster = ctx.get('世界.小英雄名录', {});
            const prevRoster = ctx.getPrev('世界.小英雄名录', {});
            Object.keys(roster).forEach(realName => {
                if (realName === '$meta' || realName === '$__META_EXTENSIBLE__$') return;
                const hero = roster[realName] || {};
                const prevHero = prevRoster[realName] || {};

                // 进度累积：检测被主角内射次数增量
                const curInjected = hero.被主角内射次数 || 0;
                const prevInjected = prevHero.被主角内射次数 || 0;
                if (curInjected > prevInjected && ctx.isNewTurn) {
                    const delta = curInjected - prevInjected;
                    if (ctx.personality === '英雄' && hero.人格阵营 === '反派') {
                        ctx.add(`世界.小英雄名录.${realName}.善堕进度`, delta * 50);
                        Logger.info(`🕊️ ${realName} 被主角内射 +${delta}，善堕进度 +${delta * 50}`);
                    } else if (ctx.personality === '反派' && hero.人格阵营 === '英雄') {
                        ctx.add(`世界.小英雄名录.${realName}.恶堕进度`, delta * 50);
                        Logger.info(`💀 ${realName} 被主角内射 +${delta}，恶堕进度 +${delta * 50}`);
                    }
                }

                // 满值推送事件（仅推送，不重置不计数）
                const evilProg = ctx.get(`世界.小英雄名录.${realName}.恶堕进度`, 0);
                const goodProg = ctx.get(`世界.小英雄名录.${realName}.善堕进度`, 0);
                if (evilProg >= 100 && !ctx.events['名录小英雄恶堕事件']) {
                    ctx.set('系统状态.待处理事件.名录小英雄恶堕事件', realName);
                    Logger.error(`💀 ${realName} 恶堕进度满值！推送名录小英雄恶堕事件！`);
                }
                if (goodProg >= 100 && !ctx.events['名录小英雄善堕事件']) {
                    ctx.set('系统状态.待处理事件.名录小英雄善堕事件', realName);
                    Logger.event(`✨ ${realName} 善堕进度满值！推送名录小英雄善堕事件！`);
                }

                // 阵营已切换 → 重置进度 + 增加计数
                const curAl = hero.人格阵营;
                const prevAl = prevHero.人格阵营;
                if (curAl !== prevAl && prevAl) {
                    ctx.set(`世界.小英雄名录.${realName}.恶堕进度`, 0);
                    ctx.set(`世界.小英雄名录.${realName}.善堕进度`, 0);
                    if (curAl === '反派') {
                        ctx.add(`世界.小英雄名录.${realName}.恶堕次数`, 1);
                        Logger.info(`📋 ${realName} 阵营切换：英雄→反派，恶堕次数 +1`);
                    } else {
                        ctx.add(`世界.小英雄名录.${realName}.善堕次数`, 1);
                        Logger.info(`📋 ${realName} 阵营切换：反派→英雄，善堕次数 +1`);
                    }
                }
            });
        }

        runStateMachine(ctx) {
            if (ctx.getPrev('进程.阶段') === '创角阶段' && ctx.get('进程.阶段') === '幕间休息') {
                Logger.event('🎬 首次进入幕间休息，执行初始世界环境装填...');
                ctx.set('主角.核心状态.体力值.当前', ctx.get('主角.核心状态.体力值.最大', 100));
                ctx.set('主角.核心状态.能量值.当前', ctx.get('主角.核心状态.能量值.最大', 100));
                ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
                ctx.set('系统状态.幕间回合计数', 0); 
                
                const themePool = ctx.get('系统状态.Boss生成主题池', []).filter(t => t !== '$__META_EXTENSIBLE__$');
                ctx.set('世界.当前关卡.核心主题', themePool.length > 0 ? [_.sample(themePool)] : []);
                
                const kinks = ctx.get('主角.快感状态.性癖', {});
                const validKinks = Object.keys(kinks).filter(k => k !== '$meta' && kinks[k] && (kinks[k].等级 >= 1 || kinks[k].经验 >= 50));
                const rosterForSeed = ctx.get('世界.小英雄名录', {});
                const rosterEntries = Object.keys(rosterForSeed).filter(k => k !== '$meta' && k !== '$__META_EXTENSIBLE__$');
                let useBond = false;
                if (rosterEntries.length > 0) {
                    if (validKinks.length === 0) { useBond = true; }
                    else if (Math.random() < 0.3) { useBond = true; }
                }
                if (useBond) {
                    const pickedName = _.sample(rosterEntries);
                    const bondType = Math.random() < 0.5 ? '情欲' : '亲密';
                    ctx.set('系统状态.待处理事件.幕间牵绊事件', `${pickedName}|${bondType}`);
                    ctx.set('系统状态.幕间事件完成', false);
                    Logger.info(`💞 幕间牵绊事件触发：${pickedName} (${bondType})`);
                } else if (validKinks.length > 0) {
                    ctx.set('世界.幕间H事件.核心主题', [_.sample(validKinks)]);
                    ctx.set('系统状态.幕间事件完成', false);
                    Logger.info(`🎭 侦测到初始激活性癖，预埋幕间H事件种子`);
                } else {
                    ctx.set('世界.幕间H事件.核心主题', []);
                    ctx.set('系统状态.幕间事件完成', true);
                    Logger.info('🛡️ 无初始激活性癖且无名录英雄，开局幕间处于安全状态');
                }
            }

            if (ctx.get('进程.阶段') === '幕间休息') {
                const hasActiveEvent = ctx.get('世界.幕间H事件.名称', '无') !== '无' || !!ctx.events['幕间牵绊事件'];
                if (!hasActiveEvent && ctx.isNewTurn) {
                    ctx.add('系统状态.幕间回合计数', 1);
                    const count = ctx.get('系统状态.幕间回合计数', 0);
                    if (count % 3 === 0) Logger.info(`⏳ 幕间闲置回合推进：${count}`);
                }
                if (ctx.get('系统状态.幕间回合计数', 0) === 5 && !ctx.events['线索整理事件']) {
                    ctx.set('系统状态.待处理事件.线索整理事件', true);
                    Logger.event('🗂️ 幕间第5回合，触发线索整理维护事件');
                }
            }

            if (ctx.get('进程.阶段') === '战斗准备') {
                ctx.set('世界.当前关卡.Boss韧性值', 100); ctx.set('世界.当前关卡.Boss状态', '完好');
                if (ctx.get('世界.当前关卡.名称', '无') === '无') {
                    ctx.set('世界.当前关卡.名称', '未知的威胁');
                }
                this.counters.defeatPersistence = 0;
                Logger.event(`⚔️ 进入战斗准备阶段，锁定目标: [${ctx.get('世界.当前关卡.名称')}]`);
            }

            if (ctx.get('进程.阶段') === '战斗回合') {
                const hp = ctx.get('主角.核心状态.体力值.当前', 100), bossHp = ctx.get('世界.当前关卡.Boss韧性值', 100);
                const ultUsed = (ctx.get('主角.核心状态.正义充能') === 0 && ctx.getPrev('主角.核心状态.正义充能', 0) >= 100) ||
                                (ctx.get('主角.核心状态.混沌充能') === 0 && ctx.getPrev('主角.核心状态.混沌充能', 0) >= 100);
                
                if (bossHp <= 0 || ultUsed) { 
                    ctx.set('进程.阶段', '战斗胜利'); 
                    Logger.event(`🏆 战斗胜利判定通过！(Boss韧性: ${bossHp} | 必杀技释放: ${ultUsed})`);
                } 
                else if (hp <= 0) { 
                    ctx.set('进程.阶段', '战斗败北'); 
                    ctx.set('主角.核心状态.当前战斗姿态', '力尽待辱'); 
                    ctx.add('记录.总战败次数', 1); 
                    Logger.warn(`🥀 战斗败北判定！主角体力归零，陷入[力尽待辱]状态。`);
                } 
                else {
                    const oldPosture = ctx.get('主角.核心状态.当前战斗姿态');
                    const newPosture = hp > 35 ? '战斗中' : '劣势';
                    if (oldPosture !== newPosture) {
                        ctx.set('主角.核心状态.当前战斗姿态', newPosture);
                        Logger.info(`📉 主角战斗姿态切换：${oldPosture} -> ${newPosture}`);
                    }
                    ctx.set('世界.当前关卡.Boss状态', bossHp > 50 ? '完好' : '动摇');
                }
            }

            if (ctx.get('进程.阶段') === '战斗胜利' && ctx.getPrev('进程.阶段') !== '战斗胜利') this._registerCombat(ctx, 'WIN');
            if (ctx.get('进程.阶段') === '战斗败北' && ctx.getPrev('进程.阶段') !== '战斗败北') this._registerCombat(ctx, 'LOSE');

            if (ctx.get('进程.阶段') === '战斗败北' && ctx.isNewTurn) {
                if (!ctx.events['彻底败北结算']) {
                    this.counters.defeatPersistence++;
                    Logger.info(`⏳ 彻底败北倒计时：${this.counters.defeatPersistence}/3`);
                    if (this.counters.defeatPersistence >= 3) {
                        ctx.set('系统状态.待处理事件.彻底败北结算', true); 
                        this.counters.defeatPersistence = 0;
                        Logger.error('💀 彻底败北倒计时归零！挂载彻底败北坏结局结算！');
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
                Logger.info('✨ 终结技演出回合过长，强制推进至战斗胜利。');
            }
            if (this.counters.victory >= 3) { 
                ctx.set('进程.阶段', '战后处理'); 
                ctx.set('系统状态.待处理事件.状态演化事件', true); 
                this.counters.victory = 0; 
                Logger.info('⏭️ 胜利结算演出回合过长，强制推进至战后处理。');
            }

            if (ctx.get('进程.阶段') === '战后处理' && !ctx.events['状态演化事件']) {
                ctx.set('系统状态.待处理事件.状态演化事件', true);
                Logger.info('🔧 战后处理阶段缺少状态演化事件，已自动补挂');
            }
            
            if (ctx.get('进程.阶段') === '战后处理' && ctx.getPrev('进程.阶段') === '战后处理') {
                ctx.set('系统状态.待处理事件.战后声望结算事件', true); 
                this._executeIntermissionHeal(ctx); 
                ctx.set('进程.阶段', '幕间休息');
                Logger.event('♻️ 战后过渡完成，系统重置归档，返回幕间休息');
            }

            // === 被捕囚禁阶段 ===
            if (ctx.get('进程.阶段') === '被捕囚禁' && ctx.getPrev('进程.阶段') !== '被捕囚禁') {
                Logger.warn('🔒 英雄被俘，转入被捕囚禁阶段...');
                ctx.set('主角.核心状态.体力值.当前', ctx.get('主角.核心状态.体力值.最大', 100));
                ctx.set('主角.核心状态.能量值.当前', ctx.get('主角.核心状态.能量值.最大', 100));
                ctx.set('主角.核心状态.着装状态', false);
                ctx.set('主角.核心状态.当前战斗姿态', '非战斗');
                ctx.set('主角.囚禁状态.逃脱进度', 0);
                ctx.set('主角.囚禁状态.洗脑进度', 0);
                ctx.set('主角.囚禁状态.自由度', '严密监禁');
                ctx.set('主角.囚禁状态.监禁回合', 0);
                this.counters.defeatPersistence = 0;
            }

            if (ctx.get('进程.阶段') === '被捕囚禁' && ctx.isNewTurn) {
                ctx.add('主角.囚禁状态.监禁回合', 1);
                const prisonTurn = ctx.get('主角.囚禁状态.监禁回合', 0);
                const corruption = ctx.get('主角.快感状态.侵蚀度', 0);

                // 1. 根据侵蚀度更新自由度
                let freedom;
                if (corruption < 30) freedom = '严密监禁';
                else if (corruption < 60) freedom = '有限活动';
                else if (corruption < 80) freedom = '半自由';
                else freedom = '信任囚徒';
                ctx.set('主角.囚禁状态.自由度', freedom);

                // 2. 逃脱进度 (正比自由度, 小数累积)
                const escapeRanges = { '严密监禁': [1, 3], '有限活动': [2, 5], '半自由': [3, 7], '信任囚徒': [4, 9] };
                const [escMin, escMax] = escapeRanges[freedom];
                ctx.add('主角.囚禁状态.逃脱进度', _.random(escMin, escMax));

                // 3. 洗脑事件 (累计概率, 每回合递增1%)
                const brainRoll = Math.random() * 100;
                if (brainRoll <= prisonTurn) {
                    const brainGain = _.random(10, 20);
                    ctx.add('主角.囚禁状态.洗脑进度', brainGain);
                    ctx.set('系统状态.待处理事件.囚禁洗脑事件', true);
                    Logger.warn(`🧠 洗脑事件触发！洗脑进度 +${brainGain} (当前: ${ctx.get('主角.囚禁状态.洗脑进度', 0)} | 概率: ${prisonTurn}%)`);
                }

                const escProgress = ctx.get('主角.囚禁状态.逃脱进度', 0);
                if (escProgress >= 100 && !ctx.events['囚禁逃脱机会']) {
                    ctx.set('系统状态.待处理事件.囚禁逃脱机会', true);
                    Logger.event(`🚪 逃脱进度已达100%，推送逃脱机会事件！`);
                }

                // 3.5. 低概率身体改造事件 (每回合1%)
                if (!ctx.events['囚禁身体改造事件'] && Math.random() < 0.01) {
                    ctx.set('系统状态.待处理事件.囚禁身体改造事件', true);
                    Logger.warn(`🔧 身体改造事件触发！怪人组织对主角进行了不可逆的改造实验。`);
                }

                // 3.6. 低概率奇迹救援事件 (每回合1%)
                if (Math.random() < 0.01) {
                    ctx.set('系统状态.待处理事件.奇迹救援事件', true);
                    Logger.event(`🌟 奇迹救援事件触发！同伴找到了主角的位置！`);
                }

                // 4. 出口判定
                if (ctx.get('主角.囚禁状态.洗脑进度', 0) >= 100) {
                    ctx.set('系统状态.待处理事件.小英雄黑化', true);
                    ctx.set('进程.阶段', '幕间休息');
                    this._executeIntermissionHeal(ctx);
                    Logger.error('💀 洗脑进度满值！强制触发小英雄黑化事件！');
                } else if (corruption >= 100) {
                    ctx.set('系统状态.待处理事件.黑化临界', true);
                    ctx.set('进程.阶段', '幕间休息');
                    this._executeIntermissionHeal(ctx);
                    Logger.error('💀 侵蚀度触及100%！触发黑化临界事件！');
                }
            }
        }

        runMilestones(ctx) {
            const pStr = ctx.getPrev('主角.核心状态.基础强度', 50), cStr = ctx.get('主角.核心状态.基础强度', 50);
            if (cStr > pStr) {
                for (let t = 70; t <= 300; t += 20) { 
                    if (pStr < t && cStr >= t) { 
                        ctx.set('系统状态.待处理事件.武装升级事件', true); 
                        Logger.event(`💎 里程碑达成：强度突破至 ${t}，触发武装升级事件！`);
                        break; 
            }

            // 被捕囚禁转幕间时，推送状态演化事件
            if (ctx.get('进程.阶段') === '幕间休息' && ctx.getPrev('进程.阶段') === '被捕囚禁' && !ctx.events['状态演化事件']) {
                ctx.set('系统状态.待处理事件.状态演化事件', true);
                Logger.info('🔧 从被捕囚禁回归日常，推送状态演化事件以结算永久变化。');
            }
        }
            }

            const pFame = ctx.getPrev('名声.知名度', 0), cFame = ctx.get('名声.知名度', 0);
            if (cFame > pFame) {
                let title = "";
                if (pFame < 15 && cFame >= 15) title = "都市传说";
                else if (pFame < 45 && cFame >= 45) title = "公众热议";
                else if (pFame < 85 && cFame >= 85) title = "无人不晓";
                if (title) {
                    ctx.set('系统状态.待处理事件.知名度升级事件', title);
                    Logger.event(`📣 里程碑达成：社会知名度晋升为【${title}】！`);
                }
            }

            const kinks = ctx.get('主角.快感状态.性癖', {});
            Object.keys(kinks).forEach(k => {
                if (k.startsWith('$')) return;
                const xp = parseInt(kinks[k].经验 || 0), currLv = parseInt(kinks[k].等级 || 0);
                let newLv = 0;
                for (const t of CONFIG.KINK_THRESHOLDS) { if (xp >= t.xp) { newLv = t.level; break; } }
                if (newLv !== currLv) {
                    ctx.set(`主角.快感状态.性癖.${k}.等级`, newLv);
                    Logger.event(`🌟 性癖深度变化：[${k}] Lv.${currLv} ➜ Lv.${newLv}`);
                }
                if (newLv >= 3 && !ctx.events['性癖觉醒事件'] && !ctx.get(`世界.世界观备注.觉醒记录_${k}`)) {
                    ctx.set('系统状态.待处理事件.性癖觉醒事件', k);
                    Logger.warn(`🧠 精神污染加深：性癖 [${k}] 首次抵达 Lv.3，触发深度觉醒事件！`);
                }
            });

            const cxp = ctx.get('主角.黑暗印记.经验', 0);
            const pxp = ctx.getPrev('主角.黑暗印记.经验', 0);
            const curLv = this._getCurseLv(cxp);
            const prevLv = this._getCurseLv(pxp);
            
            const curseDesc = ctx.get('主角.黑暗印记.描述', '无');
            const isManifested = curseDesc !== '无' && curseDesc !== '生成中……' && curseDesc !== '待设定';

            if (curLv > prevLv) {
                if (prevLv !== 0) ctx.add('主角.黑暗印记.经验', 5); 
            } else if (curLv < prevLv) {
                const phase = ctx.get('进程.阶段');
                const isCombatRelated = ['战斗准备', '战斗回合', '终结回合', '战斗败北', '战后处理'].includes(phase);
                if (isCombatRelated) {
                    if (isManifested) {
                        const safeXp = prevLv === 1 ? 1 : (prevLv === 2 ? 150 : 400);
                        ctx.set('主角.黑暗印记.经验', safeXp);
                        Logger.info(`🛡️ 激战期锁定已显现黑暗印记等级不掉落 (已重置为 ${safeXp}XP)`);
                    } else {
                        Logger.info(`💧 潜伏状态的黑暗印记允许在战斗中自然消退，不触发锁血`);
                    }
                } else {
                    if (curLv !== 0) ctx.add('主角.黑暗印记.经验', -5);
                }
            }

            const finalCxp = ctx.get('主角.黑暗印记.经验', 0);
            const finalCurLv = this._getCurseLv(finalCxp);

            const isCursePending = ctx.events['黑暗印记显现事件'] || ctx.events['黑暗印记进化事件'] || ctx.events['黑暗印记降级事件'];

            let logicalPrevLv = prevLv;
            if (ctx.getPrev('系统状态.待处理事件.黑暗印记显现事件') && !ctx.events['黑暗印记显现事件']) {
                logicalPrevLv = Math.max(1, logicalPrevLv); 
            }
            if (ctx.getPrev('系统状态.待处理事件.黑暗印记进化事件') && !ctx.events['黑暗印记进化事件']) {
                logicalPrevLv = finalCurLv; 
            }
            if (ctx.getPrev('系统状态.待处理事件.黑暗印记降级事件') && !ctx.events['黑暗印记降级事件']) {
                logicalPrevLv = finalCurLv; 
            }
            
            if (!isCursePending) {
                const cCorr = ctx.get('主角.快感状态.侵蚀度', 0);
                const prevSemenAmt = ctx.getPrev('主角.生理状态.体液与分泌.能量核心内精液.存量', 0);
                const semenAmt = ctx.get('主角.生理状态.体液与分泌.能量核心内精液.存量', 0);

                const triggerByCorr_Good = (ctx.personality === '英雄') && (cCorr >= 30) && (semenAmt > 0) && (prevSemenAmt <= 0);
                const triggerByLust_Fallen = (ctx.personality === '反派') && (cCorr >= 10) && (semenAmt > 0) && (prevSemenAmt <= 0);

                if (finalCurLv > logicalPrevLv) {
                    if (logicalPrevLv === 0) {
                        ctx.set('系统状态.待处理事件.黑暗印记显现事件', true);
                        Logger.warn(`👁️‍🗨️ 触发黑暗印记显现/死灰复燃事件！(当前XP: ${finalCxp})`);
                    } else {
                        ctx.set('系统状态.待处理事件.黑暗印记进化事件', true);
                        Logger.warn(`🔺 触发黑暗印记向上进化事件！(升至 Lv.${finalCurLv}, 当前XP: ${finalCxp})`);
                    }
                } else if (finalCurLv < logicalPrevLv) {
                    if (isManifested) {
                        ctx.set('系统状态.待处理事件.黑暗印记降级事件', true);
                        Logger.event(`🔻 触发黑暗印记衰退/克服降级事件！(Lv.${logicalPrevLv} ➜ Lv.${finalCurLv}, 剩余XP: ${finalCxp})`);
                    } else {
                        Logger.info(`🔻 潜伏期XP自然归零，无需触发降级事件。`);
                    }
                } else if (finalCurLv === 0 && (triggerByCorr_Good || triggerByLust_Fallen)) {
                    ctx.set('系统状态.待处理事件.黑暗印记显现事件', true);
                    Logger.warn(`👁️‍🗨️ 满足特殊环境诱发条件，强制唤醒黑暗印记！`);
                }
            }
        }

        _getCurseLv(xp) { return xp <= 0 ? 0 : (xp < 150 ? 1 : (xp < 400 ? 2 : 3)); }
        
        _registerCombat(ctx, result) {
            const name = ctx.get('世界.当前关卡.名称', '未知敌人');
            if (name === '无' || name === '未知敌人') return;

            const entry = { "名称": name, "核心主题": ctx.get('世界.当前关卡.核心主题', []).filter(t => !t.startsWith('$')), "战斗类型": ctx.get('世界.当前关卡.战斗类型', '魔物'), "遭遇阵营": ctx.personality, "结果": result };
            _.set(ctx.data, ['记录', '已击败的Boss', name], entry);
            ctx.set('世界.当前关卡.Boss韧性值', 0); ctx.set('主角.核心状态.当前战斗姿态', '非战斗');

            if (result === 'WIN') {
                ctx.add('记录.已击败Boss计数', 1);
                if (ctx.personality === '英雄' && ctx.get('主角.黑暗印记.经验', 0) > 0) {
                    const cleanse = _.random(15, 25);
                    ctx.set('主角.黑暗印记.经验', Math.max(0, ctx.get('主角.黑暗印记.经验') - cleanse));
                    Logger.info(`👼 英雄线胜利结算：能量洗涤，黑暗印记经验 -${cleanse}`);
                }
                const tl = parseInt(ctx.get('世界.威胁等级', 1), 10);
                let strGain = 0, hpGain = 0, mpGain = 0;
                if (tl === 3) { strGain = _.random(8, 13); hpGain = 10; mpGain = 10; ctx.set('系统状态.待处理事件.主角能力成长', '3'); } 
                else if (tl === 2) { strGain = _.random(4, 9); hpGain = 5; mpGain = 5; ctx.set('系统状态.待处理事件.主角能力成长', '2'); } 
                else { strGain = _.random(1, 6); hpGain = 3; mpGain = 3; }
                ctx.add('主角.核心状态.基础强度', strGain); ctx.add('主角.核心状态.体力值.最大', hpGain); ctx.add('主角.核心状态.能量值.最大', mpGain);
                Logger.event(`💪 战斗经验沉淀：威胁Lv${tl} 带来 强度+${strGain}, HP上限+${hpGain}, MP上限+${mpGain}`);
            }

            // 小英雄名录战绩更新
            const combatType = ctx.get('世界.当前关卡.战斗类型', '魔物');
            if (combatType === '小英雄') {
                const roster = ctx.get('世界.小英雄名录', {});
                const matchedKey = Object.keys(roster).find(k => {
                    if (k === '$meta' || k === '$__META_EXTENSIBLE__$') return false;
                    return roster[k].英雄名 === name || roster[k].堕落英雄名 === name;
                });
                if (matchedKey) {
                    if (result === 'WIN') ctx.add(`世界.小英雄名录.${matchedKey}.败于主角次数`, 1);
                    else ctx.add(`世界.小英雄名录.${matchedKey}.战胜主角次数`, 1);
                    Logger.info(`📋 小英雄名录更新：${matchedKey} 战绩已记录`);
                }
            }
        }

        _executeIntermissionHeal(ctx) {
            const raw = ctx.get('世界.日期', 20260305);
            let y = Math.floor(raw / 10000), m = Math.floor((raw % 10000) / 100), d = raw % 100 + 1;
            const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
            const days = [0,31,isLeap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
            if (d > days[m]) { d = 1; if (++m > 12) { m = 1; y++; } }
            ctx.set('世界.日期', y * 10000 + m * 100 + d); ctx.set('系统状态.幕间回合计数', 0);
            ctx.set('主角.核心状态.体力值.当前', ctx.get('主角.核心状态.体力值.最大', 100));
            ctx.set('主角.核心状态.能量值.当前', ctx.get('主角.核心状态.能量值.最大', 100));
            ctx.set('主角.核心状态.着装状态', false); ctx.set('主角.核心状态.正义充能', 0); ctx.set('主角.核心状态.混沌充能', 0);
            ctx.set('主角.核心状态.当前战斗姿态', '非战斗'); ctx.set('主角.快感状态.快感值', 0);
            ['面部','胸部','手臂','腰腹','臀部','私处','腿部'].forEach(p => ctx.set(`主角.身体部位状况.${p}`, '完好'));
            ctx.set('世界.当前关卡.名称', '无'); ctx.set('世界.当前关卡.战斗类型', '无'); ctx.set('世界.幕间H事件.名称', '无');
            
            const themePool = ctx.get('系统状态.Boss生成主题池', []).filter(t => t !== '$__META_EXTENSIBLE__$');
            ctx.set('世界.当前关卡.核心主题', themePool.length > 0 ? [_.sample(themePool)] : []);
            
            const kinks = ctx.get('主角.快感状态.性癖', {});
            const validKinks = Object.keys(kinks).filter(k => k !== '$meta' && kinks[k] && (kinks[k].等级 >= 1 || kinks[k].经验 >= 50));
            const rosterForSeed2 = ctx.get('世界.小英雄名录', {});
            const rosterEntries2 = Object.keys(rosterForSeed2).filter(k => k !== '$meta' && k !== '$__META_EXTENSIBLE__$');
            let useBond2 = false;
            if (rosterEntries2.length > 0) {
                if (validKinks.length === 0) { useBond2 = true; }
                else if (Math.random() < 0.3) { useBond2 = true; }
            }
            if (useBond2) {
                const pickedName = _.sample(rosterEntries2);
                const bondType = Math.random() < 0.5 ? '情欲' : '亲密';
                ctx.set('系统状态.待处理事件.幕间牵绊事件', `${pickedName}|${bondType}`);
                ctx.set('系统状态.幕间事件完成', false);
            } else if (validKinks.length > 0) {
                ctx.set('世界.幕间H事件.核心主题', [_.sample(validKinks)]); 
                ctx.set('系统状态.幕间事件完成', false);
            } else {
                ctx.set('世界.幕间H事件.核心主题', []); 
                ctx.set('系统状态.幕间事件完成', true);
            }
            ctx.set('系统状态.待处理事件.幕间休息完全恢复', true);
            Logger.info('🛏️ 战后大洗牌：状态恢复满值，异常清理，新雷达布防完毕。');
        }
    }

    $(() => { if (!window.MagicBoyEngineInstance) { window.MagicBoyEngineInstance = new MagicBoyEngine(); setTimeout(() => window.MagicBoyEngineInstance.init(), 1500); } });
    $(window).on('unload', () => {});
})();
