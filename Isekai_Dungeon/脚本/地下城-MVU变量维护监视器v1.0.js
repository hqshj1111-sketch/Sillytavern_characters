/**
 * 角色卡 "地下城" 专属MVU监护脚本
 * 包含：用户指令预解析（决定攻略地下城<名称>）、回合计数、攻略记录、阶段维护、变量清理
 */
const SCRIPT_NAME = '地下城-MVU变量维护监护脚本';
const SCRIPT_VERSION = 'v1.16';

const scriptState = {
    initialized: false,
    retryCount: 0,
    maxRetries: 10,
    preGenListener: null,
    postUpdateListener: null,
    previousData: null,
};

// ============================================================
//  工具：获取 MVU 实例
// ============================================================
function getMvuInstance() {
    try { return window.Mvu || window.parent?.Mvu || window.top?.Mvu || null; }
    catch (e) { console.warn('[' + SCRIPT_NAME + '] 访问MVU实例出错:', e); return null; }
}

// ============================================================
//  PRE-生成：用户消息预解析
//  支持格式：决定攻略地下城<地下城名称>
// ============================================================
function onBeforeGeneration() {
    var messages = getChatMessages();
    var lastUserMsg = [].concat(messages).reverse().find(function (m) { return m.role === 'user'; });
    if (!lastUserMsg) return;

    var text = lastUserMsg.message;

    // ---- 指令: 决定攻略地下城<名称> ----
    var dungeonMatch = text.match(/决定攻略地下城(.+?)(?=[。，\s]|$)/);
    if (dungeonMatch) {
        var dungeonName = dungeonMatch[1].trim();

        console.info('[' + SCRIPT_NAME + '] 预解析: 地下城="' + dungeonName + '"');

        // 写入消息楼层变量
        var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
        _.set(vars, 'stat_data.地下城攻略状态.当前地下城名称', dungeonName);
        replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });

        if (window.toastr) toastr.success('已设定地下城: ' + dungeonName);
        return;
    }

    // ---- 指令: 接受特殊装备<名称> ----
    var acceptMatch = text.match(/接受特殊装备(.+?)(?=[。，\s]|$)/);
    if (acceptMatch) {
        var equipBaseName = acceptMatch[1].trim();
        var equipFullName = equipBaseName;
        var NAME_MAP = {
            '触手紧身衣': '触手紧身衣',
            '蜕生项圈': '蜕生项圈（初阶）',
            '认知扭曲目镜': '认知扭曲目镜（已激活）',
            '欲体晶核': '欲体晶核（已激活）',
            '影子分身': '影子分身（无心智）',
            '同化胶核': '同化胶核（转化初期）',
            '淫欲晶核': '淫欲晶核（已激活）',
            '人格同化面具': '人格同化面具（初阶激活）',
            '奴隶淫纹': '奴隶淫纹（初阶）'
        };
        if (NAME_MAP[equipBaseName]) {
            equipFullName = NAME_MAP[equipBaseName];
        }

        console.info('[' + SCRIPT_NAME + '] 预解析: 接受特殊装备=' + equipBaseName + ' → ' + equipFullName);

        var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });

        // 加入特殊装备列表
        var specialEquips = _.get(vars, 'stat_data.主角.特殊装备', []);
        if (!Array.isArray(specialEquips)) specialEquips = [];
        if (specialEquips.indexOf(equipFullName) === -1) {
            specialEquips.push(equipFullName);
        }
        _.set(vars, 'stat_data.主角.特殊装备', specialEquips);

        // 写入日期/次数变量
        var currentYearV = _.get(vars, 'stat_data.进程.当前年份', 384);
        var currentMonthV = _.get(vars, 'stat_data.进程.当前月份', 1);
        var currentDayV = _.get(vars, 'stat_data.进程.当前日份', 1);
        var dateStr = currentYearV + '年' + currentMonthV + '月' + currentDayV + '日';

        if (equipBaseName === '触手紧身衣') {
            _.set(vars, 'stat_data.主角.触手紧身衣穿戴日期', dateStr);
        } else if (equipBaseName === '奴隶淫纹') {
            _.set(vars, 'stat_data.主角.奴隶淫纹烙印日期', dateStr);
        } else if (equipBaseName === '影子分身') {
            _.set(vars, 'stat_data.主角.影子分身获得日期', dateStr);
            var shadowDirs = ['一致', '互补', '相反'];
            var shadowDir = shadowDirs[Math.floor(Math.random() * shadowDirs.length)];
            _.set(vars, 'stat_data.系统状态.待处理事件.影子分身性格方向', shadowDir);
        } else if (equipBaseName === '人格同化面具') {
            _.set(vars, 'stat_data.主角.人格同化面具激活次数', 1);
        } else if (equipBaseName === '同化胶核') {
            _.set(vars, 'stat_data.主角.同化胶核获得日期', dateStr);
        }

        // 推送初体验事件
        _.set(vars, 'stat_data.系统状态.待处理事件.特殊装备初体验', equipFullName);

        replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });

        if (window.toastr) toastr.success('已接受特殊装备: ' + equipFullName);
        return;
    }

    // ---- 指令: 戴上<名称> / 摘下<名称> (目镜/面具) ----
    var wearMatch = text.match(/(戴上|摘下)(.+?)(?=[。，\s]|$)/);
    if (wearMatch) {
        var wearAction = wearMatch[1];
        var wearTarget = wearMatch[2].trim();
        var VISOR_PAIR = ['认知扭曲目镜（未激活）', '认知扭曲目镜（已激活）'];
        var MASK_PAIRS = {
            '初阶': ['人格同化面具（初阶未激活）', '人格同化面具（初阶激活）'],
            '中阶': ['人格同化面具（中阶未激活）', '人格同化面具（中阶激活）']
        };

        var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
        var specialEquips = _.get(vars, 'stat_data.主角.特殊装备', []);
        if (!Array.isArray(specialEquips)) specialEquips = [];

        var oldState = '';
        var newState = '';
        var isActivating = wearAction === '戴上';
        var maskEventOverride = null;

        if (wearTarget === '认知扭曲目镜') {
            oldState = isActivating ? VISOR_PAIR[0] : VISOR_PAIR[1];
            newState = isActivating ? VISOR_PAIR[1] : VISOR_PAIR[0];
            if (isActivating) {
                var visorCount = _.get(vars, 'stat_data.主角.认知扭曲目镜激活次数', 0);
                _.set(vars, 'stat_data.主角.认知扭曲目镜激活次数', visorCount + 1);
            }
        } else if (wearTarget === '人格同化面具') {
            for (var stage in MASK_PAIRS) {
                var pair = MASK_PAIRS[stage];
                var offState = isActivating ? pair[0] : pair[1];
                var onState = isActivating ? pair[1] : pair[0];
                if (specialEquips.indexOf(offState) !== -1) {
                    oldState = offState;
                    newState = onState;
                    break;
                }
            }
        }
    }
}

// ---- 指令: 给影子分身起名为"<名字>" ----
var nameMatch = text.match(/给影子分身起名为["「](.+?)["」]/);
if (nameMatch) {
    var cloneName = nameMatch[1].trim();
    console.info('[' + SCRIPT_NAME + '] 预解析: 影子分身名字="' + cloneName + '"');
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.主角.影子分身名字', cloneName);
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('影子分身已命名为: ' + cloneName);
    return;
}

// ---- 指令: 前往外地"<国家>·<城市>" ----
var travelMatch = text.match(/前往外地["「](.+?)·(.+?)["」]/);
if (travelMatch) {
    var targetCountry = travelMatch[1].trim();
    var targetCity = travelMatch[2].trim();
    console.info('[' + SCRIPT_NAME + '] 预解析: 前往外地 → ' + targetCountry + '·' + targetCity);
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.前往外地事件', { 目标国家: targetCountry, 目标城市: targetCity });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('准备前往: ' + targetCountry + '·' + targetCity);
    return;
}

// ---- 指令: 前往训练·<类型> ----
var trainMatch = text.match(/前往训练·(.+?)(?=[。，\s]|$)/);
if (trainMatch) {
    var trainType = trainMatch[1].trim();
    var validTypes = ['学习技能', '基础提升'];
    if (validTypes.indexOf(trainType) === -1) trainType = '基础提升';
    console.info('[' + SCRIPT_NAME + '] 预解析: 前往训练 → ' + trainType);
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.前往训练事件', { 训练类型: trainType });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('准备训练: ' + trainType);
    return;
}

// ---- 指令: 前往猎艳("NPC名字" 或 酒馆/妓院) ----
var pleasureNamedMatch = text.match(/前往猎艳["「](.+?)["」]/);
var pleasureVenueMatch = text.match(/前往猎艳·(.+?)(?=[。，\s]|$)/);
var pleasureSolo = /前往猎艳/.test(text) && !pleasureNamedMatch && !pleasureVenueMatch;
if (pleasureNamedMatch || pleasureVenueMatch || pleasureSolo) {
    var pleasureType, pleasureTarget = '';
    if (pleasureNamedMatch) {
        pleasureType = '指定NPC';
        pleasureTarget = pleasureNamedMatch[1].trim();
    } else if (pleasureVenueMatch) {
        var venue = pleasureVenueMatch[1].trim();
        pleasureType = venue === '妓院' ? '妓院猎艳' : '酒馆猎艳';
    } else {
        pleasureType = '酒馆猎艳';
    }
    console.info('[' + SCRIPT_NAME + '] 预解析: 前往猎艳 → ' + pleasureType + (pleasureTarget ? ' (' + pleasureTarget + ')' : ''));
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.前往猎艳事件', { 类型: pleasureType, 目标名字: pleasureTarget });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('前往猎艳: ' + (pleasureTarget || pleasureType));
    return;
}

// ---- 指令: 邀请队友<名字1>·<名字2>·…… ----
var inviteMatch = text.match(/邀请队友(.+?)(?=[。，\s]|$)/);
if (inviteMatch) {
    var namesStr = inviteMatch[1].trim();
    var names = namesStr.split('·').map(function (n) { return n.trim(); }).filter(function (n) { return n.length > 0; });
    if (names.length === 0) return;
    console.info('[' + SCRIPT_NAME + '] 预解析: 邀请队友 → ' + names.join(', '));
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.队友邀请事件', { 邀请名单: names });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('已邀请: ' + names.join(', '));
    return;
}

// ---- 指令: 度假邀约<名字1>·<名字2>| <国家>·<城市> ----
var travelInviteMatch = text.match(/度假邀约(.+?)\|(.+?)·(.+?)(?=[。，\s]|$)/);
if (travelInviteMatch) {
    var namesStr = travelInviteMatch[1].trim();
    var names = namesStr.split('·').map(function (n) { return n.trim(); }).filter(function (n) { return n.length > 0; });
    var targetCountry = travelInviteMatch[2].trim();
    var targetCity = travelInviteMatch[3].trim();
    if (names.length === 0 || !targetCountry || !targetCity) return;
    console.info('[' + SCRIPT_NAME + '] 预解析: 度假邀约 → ' + names.join(', ') + ' 前往 ' + targetCountry + '·' + targetCity);
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.度假邀约事件', { 邀请名单: names, 目标国家: targetCountry, 目标城市: targetCity });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('度假邀约: ' + targetCountry + '·' + targetCity);
    return;
}

// ---- 指令: 结成伴侣<对象名字>| <国家>·<城市> ----
var partnerMatch = text.match(/结成伴侣(.+?)\|(.+?)·(.+?)(?=[。，\s]|$)/);
if (partnerMatch) {
    var partnerName = partnerMatch[1].trim();
    var targetCountry = partnerMatch[2].trim();
    var targetCity = partnerMatch[3].trim();
    if (!partnerName || !targetCountry || !targetCity) return;
    console.info('[' + SCRIPT_NAME + '] 预解析: 结成伴侣 → ' + partnerName + ' | ' + targetCountry + '·' + targetCity);
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    _.set(vars, 'stat_data.系统状态.待处理事件.结成伴侣事件', { 伴侣对象: partnerName, 目标国家: targetCountry, 目标城市: targetCity });
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success('结成伴侣: ' + partnerName + ' | ' + targetCountry + '·' + targetCity);
    return;
}

// ---- 指令: 激活<名称> / 解除<名称> (晶核) ----
var toggleMatch = text.match(/(激活|解除)(.+?)(?=[。，\s]|$)/);
if (toggleMatch) {
    var toggleAction = toggleMatch[1];
    var toggleTarget = toggleMatch[2].trim();
    var CRYSTAL_PAIRS = {
        '欲体晶核': ['欲体晶核（未激活）', '欲体晶核（已激活）'],
        '淫欲晶核': ['淫欲晶核（未激活）', '淫欲晶核（已激活）']
    };
    var crystalPair = CRYSTAL_PAIRS[toggleTarget];
    if (!crystalPair) return;
    var isActivate = toggleAction === '激活';
    var oldState = isActivate ? crystalPair[0] : crystalPair[1];
    var newState = isActivate ? crystalPair[1] : crystalPair[0];
    var vars = getVariables({ type: 'message', message_id: lastUserMsg.message_id });
    var specialEquips = _.get(vars, 'stat_data.主角.特殊装备', []);
    if (!Array.isArray(specialEquips)) specialEquips = [];
    var oldIdx = specialEquips.indexOf(oldState);
    if (oldIdx === -1) { if (window.toastr) toastr.warning('未持有对应状态的晶核'); return; }
    specialEquips.splice(oldIdx, 1, newState);
    _.set(vars, 'stat_data.主角.特殊装备', specialEquips);
    var eventName = isActivate ? '特殊装备激活' : '特殊装备解除';
    _.set(vars, 'stat_data.系统状态.待处理事件.' + eventName, newState);
    console.info('[' + SCRIPT_NAME + '] 预解析: ' + toggleAction + ' ' + toggleTarget + ' → ' + newState);
    replaceVariables(vars, { type: 'message', message_id: lastUserMsg.message_id });
    if (window.toastr) toastr.success(toggleAction + ' ' + toggleTarget + ' → ' + newState);
    return;
}

// ============================================================
//  模块：特殊装备阶段进阶
// ============================================================
function parseDateStr(dateStr) {
    if (!dateStr) return 0;
    var m = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
    if (!m) return 0;
    return parseInt(m[1]) * 360 + parseInt(m[2]) * 30 + parseInt(m[3]);
}

function processEquipProgression(variables) {
    var specialEquips = _.get(variables.stat_data, '主角.特殊装备', []);
    if (!Array.isArray(specialEquips)) return;

    var orgasmCount = _.get(variables.stat_data, '主角.总高潮次数', 0);
    var currentYearV = _.get(variables.stat_data, '进程.当前年份', 384);
    var currentMonthV = _.get(variables.stat_data, '进程.当前月份', 1);
    var currentDayV = _.get(variables.stat_data, '进程.当前日份', 1);
    var todayDays = currentYearV * 360 + currentMonthV * 30 + currentDayV;

    var advancements = [];

    // 蜕生项圈：高潮次数驱动
    if (orgasmCount >= 14) {
        if (specialEquips.indexOf('蜕生项圈（二阶）') !== -1) {
            advancements.push({ old: '蜕生项圈（二阶）', newE: '蜕生项圈（终阶）', label: '终阶' });
        }
    }
    if (orgasmCount >= 7) {
        if (specialEquips.indexOf('蜕生项圈（初阶）') !== -1) {
            advancements.push({ old: '蜕生项圈（初阶）', newE: '蜕生项圈（二阶）', label: '二阶' });
        }
    }

    // 触手紧身衣：时间驱动（穿着后1个月）
    var suitDate = parseDateStr(_.get(variables.stat_data, '主角.触手紧身衣穿戴日期', ''));
    if (suitDate > 0 && todayDays - suitDate >= 30) {
        if (specialEquips.indexOf('触手紧身衣') !== -1) {
            advancements.push({ old: '触手紧身衣', newE: '共生触手紧身衣', label: '共生' });
        }
    }

    // 同化胶核：时间驱动（获得后1个月）
    var latexDate = parseDateStr(_.get(variables.stat_data, '主角.同化胶核获得日期', ''));
    if (latexDate > 0 && todayDays - latexDate >= 30) {
        if (specialEquips.indexOf('同化胶核（转化初期）') !== -1) {
            advancements.push({ old: '同化胶核（转化初期）', newE: '同化胶核（转化中期）', label: '转化中期' });
        }
    }
    if (latexDate > 0 && todayDays - latexDate >= 60) {
        if (specialEquips.indexOf('同化胶核（转化中期）') !== -1) {
            advancements.push({ old: '同化胶核（转化中期）', newE: '同化胶核（转化完成）', label: '转化完成' });
        }
    }

    // 奴隶淫纹：时间驱动（烙印后1个月）
    var brandDate = parseDateStr(_.get(variables.stat_data, '主角.奴隶淫纹烙印日期', ''));
    if (brandDate > 0 && todayDays - brandDate >= 30) {
        if (specialEquips.indexOf('奴隶淫纹（初阶）') !== -1) {
            advancements.push({ old: '奴隶淫纹（初阶）', newE: '奴隶淫纹（进阶）', label: '进阶' });
        }
    }
    if (brandDate > 0 && todayDays - brandDate >= 60) {
        if (specialEquips.indexOf('奴隶淫纹（进阶）') !== -1) {
            advancements.push({ old: '奴隶淫纹（进阶）', newE: '奴隶淫纹（终阶）', label: '终阶' });
        }
    }

    // 影子分身：时间驱动（获得后1个月）
    var cloneDate = parseDateStr(_.get(variables.stat_data, '主角.影子分身获得日期', ''));
    if (cloneDate > 0 && todayDays - cloneDate >= 30) {
        if (specialEquips.indexOf('影子分身（无心智）') !== -1) {
            advancements.push({ old: '影子分身（无心智）', newE: '影子分身（基础心智）', label: '基础心智' });
        }
    }
    if (cloneDate > 0 && todayDays - cloneDate >= 60) {
        if (specialEquips.indexOf('影子分身（基础心智）') !== -1) {
            advancements.push({ old: '影子分身（基础心智）', newE: '影子分身（完整心智）', label: '完整心智' });
        }
    }

    for (var i = 0; i < advancements.length; i++) {
        var adv = advancements[i];
        var idx = specialEquips.indexOf(adv.old);
        if (idx !== -1) {
            specialEquips.splice(idx, 1, adv.newE);
            console.info('[' + SCRIPT_NAME + '] 特殊装备进阶: ' + adv.old + ' → ' + adv.newE);

            var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
            if (!pending['特殊装备进阶']) {
                pending['特殊装备进阶'] = [];
            }
            if (!Array.isArray(pending['特殊装备进阶'])) {
                pending['特殊装备进阶'] = [pending['特殊装备进阶']];
            }
            pending['特殊装备进阶'].push(adv.newE);
            _.set(variables, 'stat_data.系统状态.待处理事件.特殊装备进阶', pending['特殊装备进阶']);
        }
    }
    _.set(variables, 'stat_data.主角.特殊装备', specialEquips);
}

// ============================================================
//  模块：回合自增
// ============================================================
function processTurnIncrement(variables) {
    var curTurn = _.get(variables.stat_data, '进程.当前回合数', 0);
    _.set(variables, 'stat_data.进程.当前回合数', curTurn + 1);
}

// ============================================================
//  模块：购物结束 — 清空商品列表
// ============================================================
function processShoppingEnd(variables, prevData) {
    var prevShopping = _.get(prevData, '商城信息.是否购物中', false);
    var curShopping = _.get(variables.stat_data, '商城信息.是否购物中', false);
    if (prevShopping && !curShopping) {
        _.set(variables, 'stat_data.商城信息.商品列表', []);
        console.info('[' + SCRIPT_NAME + '] 购物结束，已清空商品列表');
    }
}

// ============================================================
//  模块：战斗结束 — 清空敌方数据
// ============================================================
function processCombatEnd(variables, prevData) {
    var prevCombat = _.get(prevData, '战斗状态.是否战斗中', false);
    var curCombat = _.get(variables.stat_data, '战斗状态.是否战斗中', false);
    if (!prevCombat || curCombat) return;

    _.set(variables, 'stat_data.战斗状态.敌方名称', '');
    _.set(variables, 'stat_data.战斗状态.敌方种族', '');
    _.set(variables, 'stat_data.战斗状态.敌方等级', 1);
    _.set(variables, 'stat_data.战斗状态.敌方数量', 1);
    _.set(variables, 'stat_data.战斗状态.敌方HP', 100);
    _.set(variables, 'stat_data.战斗状态.敌方最大HP', 100);
    _.set(variables, 'stat_data.战斗状态.敌方攻击力', 50);
    _.set(variables, 'stat_data.战斗状态.敌方防御力', 50);
    _.set(variables, 'stat_data.战斗状态.敌方技能', []);
    _.set(variables, 'stat_data.战斗状态.敌方buff', {});
    _.set(variables, 'stat_data.战斗状态.敌方debuff', {});
    console.info('[' + SCRIPT_NAME + '] 战斗结束，已清理敌方数据');
}

// ============================================================
//  模块：攻略结束 — 记录攻略 + 清理攻略状态 + 清空队友
// ============================================================
function processRaidEnd(variables, prevData) {
    var prevSettlement = _.get(prevData, '地下城攻略状态.是否攻略结算中', false);
    var curSettlement = _.get(variables.stat_data, '地下城攻略状态.是否攻略结算中', false);
    var prevDefeated = _.get(prevData, '地下城攻略状态.是否攻略败北中', false);
    var curDefeated = _.get(variables.stat_data, '地下城攻略状态.是否攻略败北中', false);

    var result = null;
    if (prevSettlement && !curSettlement) result = '成功';
    else if (prevDefeated && !curDefeated) result = '败北';
    if (!result) return;

    var dungeonName = _.get(variables.stat_data, '地下城攻略状态.当前地下城名称', '');
    var startDate = _.get(variables.stat_data, '地下城攻略状态.本次攻略开始日期', '');
    var endDate = _.get(variables.stat_data, '地下城攻略状态.本次攻略结束日期', '');
    var kills = _.get(variables.stat_data, '地下城攻略状态.本次攻略击杀数', 0);
    var gold = _.get(variables.stat_data, '地下城攻略状态.本次攻略获得金币', 0);
    var teammates = _.get(variables.stat_data, '队友信息', {});
    var teammateNames = Object.keys(teammates);

    // 记录攻略
    var records = _.get(variables.stat_data, '主角.冒险者信息.攻略记录列表', []);
    if (!Array.isArray(records)) records = [];
        records.push({
            地下城名称: dungeonName,
            开始日期: startDate,
            结束日期: endDate,
            击杀数: kills,
            获得金币: gold,
            攻略结果: result,
            队友名字列表: teammateNames
        });
    _.set(variables, 'stat_data.主角.冒险者信息.攻略记录列表', records);
    console.info('[' + SCRIPT_NAME + '] 攻略' + result + ': ' + dungeonName);

    // 清理攻略状态
    _.set(variables, 'stat_data.地下城攻略状态.是否准备完毕', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否休整中', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否攻略结算中', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否攻略败北中', false);
    _.set(variables, 'stat_data.地下城攻略状态.当前地下城名称', '');
    _.set(variables, 'stat_data.地下城攻略状态.当前所在层数', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本层进度', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略击杀数', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略获得金币', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略获得素材', {});
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略开始日期', '');
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略结束日期', '');

    // 清空队友
    _.set(variables, 'stat_data.队友信息', {});
    console.info('[' + SCRIPT_NAME + '] 已清理攻略状态并清空队友');
}

// ============================================================
//  模块：战斗结算中途 — 1%概率触发特殊装备发现
// ============================================================
const EQUIP_POOL = [
    '触手紧身衣',
    '蜕生项圈（初阶）',
    '认知扭曲目镜（未激活）',
    '欲体晶核（未激活）',
    '影子分身（无心智）',
    '同化胶核（转化初期）',
    '淫欲晶核（未激活）',
    '人格同化面具（初阶未激活）',
];

function processSpecialEquipDiscovery(variables, prevData) {
    var prevSettling = _.get(prevData, '战斗状态.是否战斗结算中', false);
    var curSettling = _.get(variables.stat_data, '战斗状态.是否战斗结算中', false);
    if (prevSettling || !curSettling) return;

    if (Math.random() >= 0.01) return;

    var owned = _.get(variables.stat_data, '主角.特殊装备', []);
    var available = EQUIP_POOL.filter(function (item) {
        return owned.indexOf(item) === -1;
    });

    if (owned.indexOf('触手紧身衣') !== -1 || owned.indexOf('共生触手紧身衣') !== -1) {
        available = available.filter(function (item) { return item.indexOf('同化胶核') === -1; });
    } else if (owned.indexOf('同化胶核（转化初期）') !== -1 || owned.indexOf('同化胶核（转化中期）') !== -1 || owned.indexOf('同化胶核（转化完成）') !== -1) {
        available = available.filter(function (item) { return item.indexOf('触手紧身衣') === -1; });
    }

    if (available.length === 0) return;

    var picked = available[Math.floor(Math.random() * available.length)];
    console.info('[' + SCRIPT_NAME + '] 特殊装备发现: ' + picked);
    _.set(variables, 'stat_data.系统状态.待处理事件.特殊装备发现', picked);
}

// ============================================================
//  模块：日常阶段 — 1%概率触发特殊装备发现（城镇偶遇）
// ============================================================
const DAILY_EQUIP_POOL = [
    '奴隶淫纹（初阶）',
    '人格同化面具（初阶未激活）',
    '认知扭曲目镜（未激活）',
];

function processDailyEquipDiscovery(variables, prevData) {
    var curPhase = _.get(variables.stat_data, '进程.阶段', '');
    if (curPhase !== '日常阶段') return;

    var isShopping = _.get(variables.stat_data, '商城信息.是否购物中', false);
    if (isShopping) return;

    var pendingEvents = _.get(variables.stat_data, '系统状态.待处理事件', {});
    if (pendingEvents['打造进行中事件'] || pendingEvents['训练进行中事件'] || pendingEvents['猎艳进行中事件']) return;

    if (Math.random() >= 0.01) return;

    var owned = _.get(variables.stat_data, '主角.特殊装备', []);
    var available = DAILY_EQUIP_POOL.filter(function (item) {
        return owned.indexOf(item) === -1;
    });

    if (available.length === 0) return;

    var picked = available[Math.floor(Math.random() * available.length)];
    console.info('[' + SCRIPT_NAME + '] 日常偶遇特殊装备: ' + picked);
    _.set(variables, 'stat_data.系统状态.待处理事件.特殊装备发现', picked);
}

// ============================================================
//  模块：转入日常阶段 — HP/MP/SP 回满
// ============================================================
function processPhaseEnterDaily(variables, prevData) {
    var prevPhase = _.get(prevData, '进程.阶段', '');
    var curPhase = _.get(variables.stat_data, '进程.阶段', '');
    if (prevPhase === curPhase || curPhase !== '日常阶段') return;

    var maxHP = _.get(variables.stat_data, '主角.战斗属性.最大HP', 100);
    var maxMP = _.get(variables.stat_data, '主角.战斗属性.最大MP', 50);
    var maxSP = _.get(variables.stat_data, '主角.战斗属性.最大SP', 100);
    _.set(variables, 'stat_data.主角.当前状态.当前HP', maxHP);
    _.set(variables, 'stat_data.主角.当前状态.当前MP', maxMP);
    _.set(variables, 'stat_data.主角.当前状态.当前SP', maxSP);
    console.info('[' + SCRIPT_NAME + '] 转入日常阶段，HP/MP/SP 已回满');
}

// ============================================================
//  模块：任务状态检查 — 列表为空则标记未进行
// ============================================================
function processTaskStatusCheck(variables) {
    var taskList = _.get(variables.stat_data, '任务状态.任务列表', {});
    var isActive = _.get(variables.stat_data, '任务状态.是否任务进行中', false);
    if (isActive && Object.keys(taskList).length === 0) {
        _.set(variables, 'stat_data.任务状态.是否任务进行中', false);
        console.info('[' + SCRIPT_NAME + '] 任务列表为空，已设置 是否任务进行中=false');
    }
}

// ============================================================
//  模块：年份切换 — NPC 跨城迁徙
// ============================================================
function processNpcMigration(variables, prevData) {
    var prevYear = _.get(prevData, '进程.当前年份', 0);
    var curYear = _.get(variables.stat_data, '进程.当前年份', 0);
    if (prevYear === curYear || !prevYear) return;

    console.info('[' + SCRIPT_NAME + '] 检测到年份变更: ' + prevYear + ' → ' + curYear + '，开始NPC迁徙');

    var mcCountry = _.get(variables.stat_data, '主角.当前状态.当前国家', '');
    var mcCity = _.get(variables.stat_data, '主角.当前状态.当前城市', '');
    var geography = _.get(variables.stat_data, '地理信息', {});

    ['一般NPC信息', '重要NPC信息'].forEach(function (npcType) {
        var npcs = _.get(variables.stat_data, npcType, {});
        Object.keys(npcs).forEach(function (name) {
            var npc = npcs[name];
            if (!npc) return;
            var npcCountry = npc.所在国家 || '';
            var npcCity = npc.所在城市 || '';
            var activityRange = npc.活动范围 || '';

            // 和主角同城则跳过
            if (npcCountry === mcCountry && npcCity === mcCity) return;
            // 50%概率不动
            if (Math.random() >= 0.5) return;

            if (activityRange === '本市') return;

            if (activityRange === '本国') {
                var countryData = geography[npcCountry];
                if (!countryData || !countryData.城市列表) return;
                var cities = Object.keys(countryData.城市列表);
                if (cities.length === 0) return;
                var newCity = cities[Math.floor(Math.random() * cities.length)];
                _.set(variables, 'stat_data.' + npcType + '.' + name + '.所在城市', newCity);
                console.info('[' + SCRIPT_NAME + '] 本国迁徙: ' + name + ' → ' + npcCountry + '/' + newCity);
            } else if (activityRange === '世界') {
                var countries = Object.keys(geography);
                if (countries.length === 0) return;
                var newCountry = countries[Math.floor(Math.random() * countries.length)];
                var newCountryData = geography[newCountry];
                if (!newCountryData || !newCountryData.城市列表) return;
                var newCities = Object.keys(newCountryData.城市列表);
                if (newCities.length === 0) return;
                var newCity = newCities[Math.floor(Math.random() * newCities.length)];
                _.set(variables, 'stat_data.' + npcType + '.' + name + '.所在国家', newCountry);
                _.set(variables, 'stat_data.' + npcType + '.' + name + '.所在城市', newCity);
                console.info('[' + SCRIPT_NAME + '] 世界迁徙: ' + name + ' → ' + newCountry + '/' + newCity);
            }
        });
    });
}

// ============================================================
//  模块：日常阶段 — 1%概率触发大型事件开幕
// ============================================================
const LARGE_EVENT_OPENINGS = ['意外卷入', '受人所托', '匿名密信', '目击现场'];
function processLargeEventTrigger(variables) {
    var phase = _.get(variables.stat_data, '进程.阶段', '');
    if (phase !== '日常阶段') return;

    var isActive = _.get(variables.stat_data, '大型事件.进行中', false);
    if (isActive) return;

    var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    if (pending['大型事件开幕']) return;

    if (Math.random() >= 0.01) return;

    var picked = LARGE_EVENT_OPENINGS[Math.floor(Math.random() * LARGE_EVENT_OPENINGS.length)];
    _.set(variables, 'stat_data.系统状态.待处理事件.大型事件开幕', picked);
    console.info('[' + SCRIPT_NAME + '] 大型事件开幕: ' + picked);
}

// ============================================================
//  模块：大型事件结束 — 变量复原
// ============================================================
function processLargeEventCleanup(variables, prevData) {
    var prevActive = _.get(prevData, '大型事件.进行中', false);
    var curActive = _.get(variables.stat_data, '大型事件.进行中', false);
    if (!prevActive || curActive) return;

    console.info('[' + SCRIPT_NAME + '] 大型事件已结束，清理相关变量');
    _.set(variables, 'stat_data.大型事件.名称', '');
    _.set(variables, 'stat_data.大型事件.已知线索', []);
    _.set(variables, 'stat_data.大型事件.真相', '');
    _.set(variables, 'stat_data.大型事件.真相揭露', false);
    _.set(variables, 'stat_data.大型事件.开始回合', 0);
}

// ============================================================
//  模块：NPC静默升阶检测 — 时间驱动
// ============================================================
function processNpcRankUp(variables) {
    var phase = _.get(variables.stat_data, '进程.阶段', '');
    if (phase !== '日常阶段') return;
    var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    if (pending['NPC升阶事件']) return;

    var importantNPCs = _.get(variables.stat_data, '重要NPC信息', {});
    var currentYear = _.get(variables.stat_data, '进程.当前年份', 384);
    var currentMonth = _.get(variables.stat_data, '进程.当前月份', 1);
    var currentDay = _.get(variables.stat_data, '进程.当前日份', 1);
    var todayDays = currentYear * 360 + currentMonth * 30 + currentDay;

    var RANK_ORDER = { F:1,E:2,D:3,C:4,B:5,A:6,S:7,SS:8,SSS:9,EX:10 };
    var candidates = [];
    Object.keys(importantNPCs).forEach(function (name) {
        var npc = importantNPCs[name];
        if (!npc.冒险者等级 || npc.冒险者等级 === 'EX') return;
        var lastDate = parseDateStr(npc.最近升阶日期 || '');
        if (lastDate > 0 && todayDays - lastDate < 60) return;

        var rankNum = RANK_ORDER[npc.冒险者等级] || 1;
        var chance = rankNum >= 7 ? 0.001 : 0.01;
        if (Math.random() < chance) {
            candidates.push({ name: name, oldRank: npc.冒险者等级 });
        }
    });
    if (candidates.length === 0) return;

    var picked = candidates[Math.floor(Math.random() * candidates.length)];
    var newRankNum = (RANK_ORDER[picked.oldRank] || 1) + 1;
    var NUM_TO_RANK = { 1:'F',2:'E',3:'D',4:'C',5:'B',6:'A',7:'S',8:'SS',9:'SSS',10:'EX' };
    var newRank = NUM_TO_RANK[newRankNum] || picked.oldRank;
    var dateStr = currentYear + '年' + currentMonth + '月' + currentDay + '日';

    // 后台直接更新等级和日期
    _.set(variables, 'stat_data.重要NPC信息.' + picked.name + '.冒险者等级', newRank);
    _.set(variables, 'stat_data.重要NPC信息.' + picked.name + '.最近升阶日期', dateStr);

    _.set(variables, 'stat_data.系统状态.待处理事件.NPC升阶事件', {
        NPC名字: picked.name,
        旧等级: picked.oldRank
    });
    console.info('[' + SCRIPT_NAME + '] NPC静默升阶: ' + picked.name + ' (' + picked.oldRank + ' → ' + newRank + ')');
}

// ============================================================
//  POST-生成：变量更新后维护 (仅 AI 消息触发)
// ============================================================
function onVariableUpdateEnded(variables) {
    var lastMsg = getChatMessages().at(-1);
    if (!lastMsg || lastMsg.role !== 'assistant') {
        scriptState.previousData = _.cloneDeep(variables && variables.stat_data);
        return;
    }
    if (!variables || !variables.stat_data || !variables.stat_data.进程) {
        scriptState.previousData = _.cloneDeep(variables && variables.stat_data);
        return;
    }
    if (!scriptState.previousData) {
        scriptState.previousData = _.cloneDeep(variables.stat_data);
        return;
    }

    // 1. 回合自增
    processTurnIncrement(variables);
    // 2. 购物结束
    processShoppingEnd(variables, scriptState.previousData);
    // 2.5. 战斗纪要
    processBattleLog(variables, scriptState.previousData);
    // 3. 战斗结束
    processCombatEnd(variables, scriptState.previousData);
    // 4. 攻略结束
    processRaidEnd(variables, scriptState.previousData);
    // 5. 战斗结算 — 特殊装备发现
    processSpecialEquipDiscovery(variables, scriptState.previousData);
    // 6. 日常偶遇 — 特殊装备发现
    processDailyEquipDiscovery(variables, scriptState.previousData);
    // 7. 特殊装备阶段进阶
    processEquipProgression(variables);
    // 8. 转入日常 — 完全恢复
    processPhaseEnterDaily(variables, scriptState.previousData);
    // 9. 任务状态检查
    processTaskStatusCheck(variables);
    // 10. 年份切换 — NPC迁徙
    processNpcMigration(variables, scriptState.previousData);
    // 11. NPC位置更新日期
    processNpcLocationDate(variables, scriptState.previousData);
    // 12. 好感度突破75 — 关系变化
    processRelationshipMilestone(variables, scriptState.previousData);
    // 13. 月份/季节 — 日历事件
    processCalendarEvents(variables, scriptState.previousData);
    // 14. 年份切换 — 年龄+1
    processAgeIncrement(variables, scriptState.previousData);
    // 15. 大型事件开幕触发
    processLargeEventTrigger(variables);
    // 16. 大型事件结束 — 清理
    processLargeEventCleanup(variables, scriptState.previousData);
    // 17. 历史纪要
    processHistoryLog(variables, scriptState.previousData);
    // 18. NPC静默升阶检测
    processNpcRankUp(variables);

    scriptState.previousData = _.cloneDeep(variables.stat_data);
}

// ============================================================
//  模块：回合自增
// ============================================================
function processTurnIncrement(variables) {
    var turn = _.get(variables.stat_data, '进程.当前回合数', 0);
    _.set(variables, 'stat_data.进程.当前回合数', turn + 1);
}

// ============================================================
//  模块：购物结束清理
// ============================================================
function processShoppingEnd(variables, prevData) {
    var prevShopping = _.get(prevData, '商城信息.是否购物中', false);
    var curShopping = _.get(variables.stat_data, '商城信息.是否购物中', false);
    if (prevShopping && !curShopping) {
        _.set(variables, 'stat_data.商城信息.商品列表', []);
    }
}

// ============================================================
//  模块：战斗纪要
// ============================================================
function battleLogEvent(variables, camp, name, type, oldVal, newVal) {
    var log = _.get(variables.stat_data, '主角.战斗纪要', []);
    if (!Array.isArray(log)) log = [];
    log.push({ 阵营: camp, 角色名: name, 类型: type, 旧值: oldVal, 新值: newVal });
    _.set(variables, 'stat_data.主角.战斗纪要', log);
}

function processBattleLog(variables, prevData) {
    var prevCombat = _.get(prevData, '战斗状态.是否战斗中', false);
    var curCombat = _.get(variables.stat_data, '战斗状态.是否战斗中', false);
    if (!prevCombat && !curCombat) return;

    // ---- 己方 buff ----
    function logBuffs(camp, name, prevBuffs, curBuffs) {
        var pB = prevBuffs || {};
        var cB = curBuffs || {};
        Object.keys(cB).forEach(function (b) {
            if (!pB[b]) battleLogEvent(variables, camp, name, 'buff', '无', b);
        });
        Object.keys(pB).forEach(function (b) {
            if (!cB[b]) battleLogEvent(variables, camp, name, 'buff', b, '无');
        });
    }

    // 主角 buff/debuff
    var prevMcBuffs = _.get(prevData, '主角.当前状态.当前buff', {}) || {};
    var curMcBuffs = _.get(variables.stat_data, '主角.当前状态.当前buff', {}) || {};
    logBuffs('己方', '主角', prevMcBuffs, curMcBuffs);
    var prevMcDebuffs = _.get(prevData, '主角.当前状态.当前debuff', {}) || {};
    var curMcDebuffs = _.get(variables.stat_data, '主角.当前状态.当前debuff', {}) || {};
    Object.keys(curMcDebuffs).forEach(function (b) { if (!prevMcDebuffs[b]) battleLogEvent(variables, '己方', '主角', 'debuff', '无', b); });
    Object.keys(prevMcDebuffs).forEach(function (b) { if (!curMcDebuffs[b]) battleLogEvent(variables, '己方', '主角', 'debuff', b, '无'); });

    // 队友 buff/debuff
    var prevTms = _.get(prevData, '队友信息', {}) || {};
    var curTms = _.get(variables.stat_data, '队友信息', {}) || {};
    Object.keys(curTms).forEach(function (name) {
        var pT = prevTms[name] || {};
        var cT = curTms[name] || {};
        logBuffs('己方', name, pT.当前buff || {}, cT.当前buff || {});
        Object.keys(cT.当前debuff || {}).forEach(function (b) { if (!(pT.当前debuff||{})[b]) battleLogEvent(variables, '己方', name, 'debuff', '无', b); });
        Object.keys(pT.当前debuff || {}).forEach(function (b) { if (!(cT.当前debuff||{})[b]) battleLogEvent(variables, '己方', name, 'debuff', b, '无'); });
    });
    Object.keys(prevTms).forEach(function (name) {
        if (curTms[name]) return;
        var pT = prevTms[name] || {};
        Object.keys(pT.当前buff || {}).forEach(function (b) { battleLogEvent(variables, '己方', name, 'buff', b, '无'); });
        Object.keys(pT.当前debuff || {}).forEach(function (b) { battleLogEvent(variables, '己方', name, 'debuff', b, '无'); });
    });

    // ---- 己方 HP ----
    var prevMcHp = _.get(prevData, '主角.当前状态.当前HP', 0);
    var curMcHp = _.get(variables.stat_data, '主角.当前状态.当前HP', 0);
    if (prevMcHp !== curMcHp) battleLogEvent(variables, '己方', '主角', 'hp', prevMcHp, curMcHp);
    Object.keys(curTms).forEach(function (name) {
        var prevHp = _.get(prevTms, name + '.当前HP', 0);
        var curHp = _.get(curTms, name + '.当前HP', 0);
        if (prevHp !== curHp) battleLogEvent(variables, '己方', name, 'hp', prevHp, curHp);
    });

    // ---- 敌方 buff/debuff ----
    var prevEBuffs = _.get(prevData, '战斗状态.敌方buff', []) || [];
    var curEBuffs = _.get(variables.stat_data, '战斗状态.敌方buff', []) || [];
    if (!Array.isArray(prevEBuffs)) prevEBuffs = [];
    if (!Array.isArray(curEBuffs)) curEBuffs = [];
    curEBuffs.forEach(function (b) { if (prevEBuffs.indexOf(b) === -1) battleLogEvent(variables, '敌方', '敌方', 'buff', '无', String(b)); });
    prevEBuffs.forEach(function (b) { if (curEBuffs.indexOf(b) === -1) battleLogEvent(variables, '敌方', '敌方', 'buff', String(b), '无'); });
    var prevEDebuffs = _.get(prevData, '战斗状态.敌方debuff', []) || [];
    var curEDebuffs = _.get(variables.stat_data, '战斗状态.敌方debuff', []) || [];
    if (!Array.isArray(prevEDebuffs)) prevEDebuffs = [];
    if (!Array.isArray(curEDebuffs)) curEDebuffs = [];
    curEDebuffs.forEach(function (d) { if (prevEDebuffs.indexOf(d) === -1) battleLogEvent(variables, '敌方', '敌方', 'debuff', '无', String(d)); });
    prevEDebuffs.forEach(function (d) { if (curEDebuffs.indexOf(d) === -1) battleLogEvent(variables, '敌方', '敌方', 'debuff', String(d), '无'); });

    // ---- 敌方 HP ----
    var prevEHp = _.get(prevData, '战斗状态.敌方HP', 0);
    var curEHp = _.get(variables.stat_data, '战斗状态.敌方HP', 0);
    if (prevEHp !== curEHp) battleLogEvent(variables, '敌方', '敌方', 'hp', prevEHp, curEHp);
}

// ============================================================
//  模块：战斗结束清理
// ============================================================
function processCombatEnd(variables, prevData) {
    var prevCombat = _.get(prevData, '战斗状态.是否战斗中', false);
    var curCombat = _.get(variables.stat_data, '战斗状态.是否战斗中', false);
    if (prevCombat && !curCombat) {
        _.set(variables, 'stat_data.战斗状态.敌方名称', '');
        _.set(variables, 'stat_data.战斗状态.敌方种族', '');
        _.set(variables, 'stat_data.战斗状态.敌方等级', 1);
        _.set(variables, 'stat_data.战斗状态.敌方数量', 1);
        _.set(variables, 'stat_data.战斗状态.敌方HP', 0);
        _.set(variables, 'stat_data.战斗状态.敌方最大HP', 0);
        _.set(variables, 'stat_data.战斗状态.敌方攻击力', 0);
        _.set(variables, 'stat_data.战斗状态.敌方防御力', 0);
        _.set(variables, 'stat_data.战斗状态.敌方技能', []);
        _.set(variables, 'stat_data.战斗状态.敌方buff', []);
        _.set(variables, 'stat_data.战斗状态.敌方debuff', []);
        _.set(variables, 'stat_data.主角.战斗纪要', []);
    }
}

// ============================================================
//  模块：攻略结束处理
// ============================================================
function processRaidEnd(variables, prevData) {
    var prevSettle = _.get(prevData, '地下城攻略状态.是否攻略结算中', false);
    var prevDefeat = _.get(prevData, '地下城攻略状态.是否攻略败北中', false);
    var curSettle = _.get(variables.stat_data, '地下城攻略状态.是否攻略结算中', false);
    var curDefeat = _.get(variables.stat_data, '地下城攻略状态.是否攻略败北中', false);
    if ((!prevSettle || curSettle) && (!prevDefeat || curDefeat)) return;

    var dungeonName = _.get(variables.stat_data, '地下城攻略状态.当前地下城名称', '');
    var kills = _.get(variables.stat_data, '地下城攻略状态.本次攻略击杀数', 0);
    var gold = _.get(variables.stat_data, '地下城攻略状态.本次攻略获得金币', 0);
    var startDate = _.get(variables.stat_data, '地下城攻略状态.本次攻略开始日期', '');
    var endDate = _.get(variables.stat_data, '地下城攻略状态.本次攻略结束日期', '');
    var currentYear = _.get(variables.stat_data, '进程.当前年份', 384);
    var currentMonth = _.get(variables.stat_data, '进程.当前月份', 1);
    var currentDay = _.get(variables.stat_data, '进程.当前日份', 1);
    var dateStr = currentYear + '年' + currentMonth + '月' + currentDay + '日';

    var recordList = _.get(variables.stat_data, '主角.冒险者信息.攻略记录列表', []);
    if (!Array.isArray(recordList)) recordList = [];
    recordList.push({ 地下城名称: dungeonName, 击杀数: kills, 获得金币: gold, 开始日期: startDate, 结束日期: endDate });
    _.set(variables, 'stat_data.主角.冒险者信息.攻略记录列表', recordList);

    // 重置
    _.set(variables, 'stat_data.地下城攻略状态.当前地下城名称', '');
    _.set(variables, 'stat_data.地下城攻略状态.是否准备完毕', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否休整中', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否攻略结算中', false);
    _.set(variables, 'stat_data.地下城攻略状态.是否攻略败北中', false);
    _.set(variables, 'stat_data.地下城攻略状态.当前所在层数', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本层进度', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略击杀数', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略获得金币', 0);
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略获得素材', {});
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略开始日期', '');
    _.set(variables, 'stat_data.地下城攻略状态.本次攻略结束日期', '');
    _.set(variables, 'stat_data.队友信息', {});
}

// ============================================================
//  模块：战斗结算 — 特殊装备发现 (1%)
// ============================================================
function processSpecialEquipDiscovery(variables, prevData) {
    var prevSettling = _.get(prevData, '战斗状态.是否战斗结算中', false);
    var curSettling = _.get(variables.stat_data, '战斗状态.是否战斗结算中', false);
    if (prevSettling || !curSettling) return;
    if (Math.random() >= 0.01) return;
    var specialEquips = _.get(variables.stat_data, '主角.特殊装备', []);
    var EQUIP_POOL = ['触手紧身衣', '欲体晶核', '淫欲晶核', '影子分身', '同化胶核', '蜕生项圈'];
    if (specialEquips.indexOf('触手紧身衣') !== -1) EQUIP_POOL = EQUIP_POOL.filter(function(e) { return e !== '同化胶核'; });
    if (specialEquips.indexOf('同化胶核') !== -1) EQUIP_POOL = EQUIP_POOL.filter(function(e) { return e !== '触手紧身衣'; });
    var picked = EQUIP_POOL[Math.floor(Math.random() * EQUIP_POOL.length)];
    _.set(variables, 'stat_data.系统状态.待处理事件.特殊装备发现', picked);
    console.info('[' + SCRIPT_NAME + '] 战斗结算触发特殊装备: ' + picked);
}

// ============================================================
//  模块：日常偶遇 — 特殊装备发现 (1%)
// ============================================================
function processDailyEquipDiscovery(variables, prevData) {
    var phase = _.get(variables.stat_data, '进程.阶段', '');
    if (phase !== '日常阶段') return;
    if (_.get(variables.stat_data, '商城信息.是否购物中', false)) return;
    var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    if (pending['前往训练事件'] || pending['训练进行中事件'] || pending['前往猎艳事件'] || pending['猎艳进行中事件'] || pending['特殊装备发现']) return;
    if (Math.random() >= 0.01) return;
    var specialEquips = _.get(variables.stat_data, '主角.特殊装备', []);
    var DAILY_POOL = ['奴隶淫纹', '人格同化面具', '认知扭曲目镜'];
    var picked = DAILY_POOL[Math.floor(Math.random() * DAILY_POOL.length)];
    _.set(variables, 'stat_data.系统状态.待处理事件.特殊装备发现', picked);
    console.info('[' + SCRIPT_NAME + '] 日常偶遇特殊装备: ' + picked);
}

// ============================================================
//  模块：转入日常 — HP/MP/SP 完全恢复
// ============================================================
function processPhaseEnterDaily(variables, prevData) {
    var prevPhase = _.get(prevData, '进程.阶段', '');
    var curPhase = _.get(variables.stat_data, '进程.阶段', '');
    if (prevPhase === curPhase || curPhase !== '日常阶段') return;
    var maxHp = _.get(variables.stat_data, '主角.战斗属性.最大HP', 100);
    var maxMp = _.get(variables.stat_data, '主角.战斗属性.最大MP', 50);
    var maxSp = _.get(variables.stat_data, '主角.战斗属性.最大SP', 100);
    _.set(variables, 'stat_data.主角.当前状态.当前HP', maxHp);
    _.set(variables, 'stat_data.主角.当前状态.当前MP', maxMp);
    _.set(variables, 'stat_data.主角.当前状态.当前SP', maxSp);
}

// ============================================================
//  模块：任务状态检查
// ============================================================
function processTaskStatusCheck(variables) {
    var tasks = _.get(variables.stat_data, '任务状态.任务列表', {});
    var isActive = _.get(variables.stat_data, '任务状态.是否任务进行中', false);
    if (isActive && Object.keys(tasks).length === 0) {
        _.set(variables, 'stat_data.任务状态.是否任务进行中', false);
    }
}

// ============================================================
//  模块：NPC 位置更新日期
// ============================================================
function processNpcLocationDate(variables, prevData) {
    var currentYearV = _.get(variables.stat_data, '进程.当前年份', 384);
    var currentMonthV = _.get(variables.stat_data, '进程.当前月份', 1);
    var currentDayV = _.get(variables.stat_data, '进程.当前日份', 1);
    var dateStr = currentYearV + '年' + currentMonthV + '月' + currentDayV + '日';
    ['一般NPC信息', '重要NPC信息'].forEach(function (npcType) {
        var npcs = _.get(variables.stat_data, npcType, {});
        var prevNpcs = _.get(prevData, npcType, {});
        Object.keys(npcs).forEach(function (name) {
            var npc = npcs[name];
            if (!npc) return;
            var curCity = npc.所在城市 || '';
            var curCountry = npc.所在国家 || '';
            var prevNpc = prevNpcs[name] || {};
            var prevCity = prevNpc.所在城市 || '';
            var prevCountry = prevNpc.所在国家 || '';
            if (curCity !== prevCity || curCountry !== prevCountry) {
                _.set(variables, 'stat_data.' + npcType + '.' + name + '.位置更新日期', dateStr);
            }
        });
    });
}

// ============================================================
//  模块：重要NPC好感度首次突破75 — 关系变化事件
// ============================================================
function processRelationshipMilestone(variables, prevData) {
    var prevImportant = _.get(prevData, '重要NPC信息', {});
    var curImportant = _.get(variables.stat_data, '重要NPC信息', {});
    Object.keys(curImportant).forEach(function (name) {
        var curNpc = curImportant[name];
        var prevNpc = prevImportant[name] || {};
        var prevAffection = parseInt(_.get(prevNpc, '好感度', 0)) || 0;
        var curAffection = parseInt(_.get(curNpc, '好感度', 0)) || 0;
        if (prevAffection < 75 && curAffection >= 75) {
            var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
            var existing = pending['关系变化事件'];
            if (existing && existing.NPC名字 === name) return;
            _.set(variables, 'stat_data.系统状态.待处理事件.关系变化事件', { NPC名字: name, 好感度: curAffection });
            console.info('[' + SCRIPT_NAME + '] 关系突破: ' + name + ' 好感度 ' + curAffection);
        }
    });
}

// ============================================================
//  模块：月份/季节切换 — 日历事件
// ============================================================
function processCalendarEvents(variables, prevData) {
    var prevMonth = parseInt(_.get(prevData, '进程.当前月份', 0)) || 0;
    var curMonth = parseInt(_.get(variables.stat_data, '进程.当前月份', 1)) || 1;
    if (prevMonth === curMonth || !prevMonth) return;
    var pending = _.get(variables.stat_data, '系统状态.待处理事件', {});
    var seasonOf = function (m) {
        if (m >= 3 && m <= 5) return '春季';
        if (m >= 6 && m <= 8) return '夏季';
        if (m >= 9 && m <= 11) return '秋季';
        return '冬季';
    };
    var prevSeason = seasonOf(prevMonth);
    var curSeason = seasonOf(curMonth);
    if (prevSeason !== curSeason && !pending['季节变换事件']) {
        _.set(variables, 'stat_data.系统状态.待处理事件.季节变换事件', curSeason);
    }
    if (Math.random() < 0.2 && !pending['节庆祭典事件']) {
        _.set(variables, 'stat_data.系统状态.待处理事件.节庆祭典事件', true);
    }
    if (Math.random() < 0.2 && !pending['旧友联系事件']) {
        var curCountry = _.get(variables.stat_data, '主角.当前状态.当前国家', '');
        var curCity = _.get(variables.stat_data, '主角.当前状态.当前城市', '');
        var importantNPCs = _.get(variables.stat_data, '重要NPC信息', {});
        var eligible = Object.keys(importantNPCs).filter(function (name) {
            var npc = importantNPCs[name];
            return npc.所在国家 !== curCountry || npc.所在城市 !== curCity;
        });
        if (eligible.length > 0) {
            var picked = eligible[Math.floor(Math.random() * eligible.length)];
            _.set(variables, 'stat_data.系统状态.待处理事件.旧友联系事件', picked);
        }
    }

    // 世界动态更新 — 每月推送
    if (!pending['世界动态更新事件']) {
        _.set(variables, 'stat_data.系统状态.待处理事件.世界动态更新事件', true);
        console.info('[' + SCRIPT_NAME + '] 月度世界动态更新');
    }
}

// ============================================================
//  模块：年份切换 — 全员年龄+1
// ============================================================
function incrementAgeStr(ageStr) {
    if (!ageStr || typeof ageStr !== 'string') return ageStr;
    var m = ageStr.match(/(\d+)/);
    if (!m) return ageStr;
    var num = parseInt(m[1]) + 1;
    return ageStr.replace(m[1], String(num));
}
function processAgeIncrement(variables, prevData) {
    var prevYear = _.get(prevData, '进程.当前年份', 0);
    var curYear = _.get(variables.stat_data, '进程.当前年份', 0);
    if (prevYear === curYear || !prevYear) return;
    var mcAge = _.get(variables.stat_data, '主角.基本信息.年龄', '');
    if (mcAge) { _.set(variables, 'stat_data.主角.基本信息.年龄', incrementAgeStr(mcAge)); }
    ['一般NPC信息', '重要NPC信息'].forEach(function (npcType) {
        var npcs = _.get(variables.stat_data, npcType, {});
        Object.keys(npcs).forEach(function (name) {
            var npc = npcs[name];
            if (!npc || !npc.年龄) return;
            _.set(variables, 'stat_data.' + npcType + '.' + name + '.年龄', incrementAgeStr(npc.年龄));
        });
    });
}

// ============================================================
//  模块：历史纪要 — 记录重大事件
// ============================================================
function logEvent(variables, eventText) {
    var currentYear = _.get(variables.stat_data, '进程.当前年份', 384);
    var currentMonth = _.get(variables.stat_data, '进程.当前月份', 1);
    var currentDay = _.get(variables.stat_data, '进程.当前日份', 1);
    var dateStr = currentYear + '年' + currentMonth + '月' + currentDay + '日';
    var log = _.get(variables.stat_data, '主角.历史纪要', []);
    if (!Array.isArray(log)) log = [];
    log.push({ 日期: dateStr, 事件: eventText });
    _.set(variables, 'stat_data.主角.历史纪要', log);
}

function processHistoryLog(variables, prevData) {
    var prevEquips = _.get(prevData, '主角.特殊装备', []) || [];
    var curEquips = _.get(variables.stat_data, '主角.特殊装备', []) || [];
    curEquips.forEach(function (e) {
        if (prevEquips.indexOf(e) !== -1) return;
        // 影子分身在命名时记录，此处跳过
        if (e.indexOf('影子分身') !== -1) return;

        // 特殊装备获得 — 特定装备附加额外信息
        if (e.indexOf('奴隶淫纹') !== -1) {
            var master = _.get(variables.stat_data, '主角.主角的主人', '');
            var slaveName = _.get(variables.stat_data, '主角.奴隶称呼', '');
            var extra = '';
            if (master) extra += '，主人为「' + master + '」';
            if (slaveName) extra += '，奴隶称谓「' + slaveName + '」';
            logEvent(variables, '获得特殊装备「奴隶淫纹」' + extra);
        } else {
            logEvent(variables, '获得特殊装备「' + e + '」');
        }
    });

    // 影子分身命名 — 延迟到起名时记录
    var prevCloneName = _.get(prevData, '主角.影子分身名字', '') || '';
    var curCloneName = _.get(variables.stat_data, '主角.影子分身名字', '') || '';
    if (!prevCloneName && curCloneName) {
        logEvent(variables, '获得影子分身「' + curCloneName + '」');
    }

    var prevPartners = _.get(prevData, '主角.伴侣列表', []) || [];
    var curPartners = _.get(variables.stat_data, '主角.伴侣列表', []) || [];
    curPartners.forEach(function (p) {
        if (prevPartners.indexOf(p) === -1) logEvent(variables, '与「' + p + '」缔结为正式伴侣');
    });

    // 胶兽同化检测
    ['重要NPC信息', '一般NPC信息'].forEach(function (npcType) {
        var prevNpcs = _.get(prevData, npcType, {});
        var curNpcs = _.get(variables.stat_data, npcType, {});
        Object.keys(curNpcs).forEach(function (name) {
            var prevAssim = _.get(prevNpcs, name + '.是否胶兽', false);
            var curAssim = _.get(curNpcs, name + '.是否胶兽', false);
            if (!prevAssim && curAssim) {
                logEvent(variables, '「' + name + '」被同化为胶兽眷属');
            }
        });
    });

    if (_.get(prevData, '地下城攻略状态.是否攻略结算中', false) && !_.get(variables.stat_data, '地下城攻略状态.是否攻略结算中', false)) {
        var name = _.get(prevData, '地下城攻略状态.当前地下城名称', '');
        if (name) logEvent(variables, '成功攻略地下城「' + name + '」');
    }

    if (_.get(prevData, '地下城攻略状态.是否攻略败北中', false) && !_.get(variables.stat_data, '地下城攻略状态.是否攻略败北中', false)) {
        var name = _.get(prevData, '地下城攻略状态.当前地下城名称', '');
        if (name) logEvent(variables, '攻略地下城「' + name + '」失败');
    }

    if (_.get(prevData, '大型事件.进行中', false) && !_.get(variables.stat_data, '大型事件.进行中', false)) {
        var name = _.get(prevData, '大型事件.名称', '');
        if (name) logEvent(variables, '解决大型事件「' + name + '」');
    }

    var prevRank = _.get(prevData, '主角.冒险者信息.冒险者等级', 'F');
    var curRank = _.get(variables.stat_data, '主角.冒险者信息.冒险者等级', 'F');
    if (prevRank !== curRank) logEvent(variables, '冒险者等级提升至 ' + curRank + ' 级');

    var fameTiers = [0, 50, 200, 500, 1500, 5000];
    var fameLabels = ['默默无闻', '小有名气', '崭露头角', '声名远播', '名震大陆', '传说级'];
    var prevFame = parseInt(_.get(prevData, '主角.冒险者信息.知名度', 0)) || 0;
    var curFame = parseInt(_.get(variables.stat_data, '主角.冒险者信息.知名度', 0)) || 0;
    var prevTier = 0, curTier = 0;
    for (var i = fameTiers.length - 1; i >= 0; i--) { if (prevFame >= fameTiers[i]) { prevTier = i; break; } }
    for (var j = fameTiers.length - 1; j >= 0; j--) { if (curFame >= fameTiers[j]) { curTier = j; break; } }
    if (curTier > prevTier) logEvent(variables, '知名度达到「' + fameLabels[curTier] + '」');

    curEquips.forEach(function (e) {
        if (prevEquips.indexOf(e) !== -1) return;
        var msg = '';
        if (e === '共生触手紧身衣') {
            msg = '与触手紧身衣达成共生';
        } else if (e === '同化胶核（转化完成）') {
            msg = '胶兽转化完成';
        } else if (e === '蜕生项圈（终阶）') {
            var race = _.get(variables.stat_data, '主角.基本信息.种族', '');
            msg = '完成蜕生，转化为' + race;
        } else if (e === '影子分身（完整心智）') {
            var cloneName = _.get(variables.stat_data, '主角.影子分身名字', '');
            msg = '影子分身' + (cloneName ? '「' + cloneName + '」' : '') + '获得完整心智';
        } else if (e === '人格同化面具（终阶）') {
            msg = '与面具人格完成同化';
        } else if (e === '奴隶淫纹（终阶）') {
            var master = _.get(variables.stat_data, '主角.主角的主人', '');
            msg = '奴隶淫纹达到终阶，彻底服从于主人' + (master ? '「' + master + '」' : '');
        } else if (e === '蜕生项圈（二阶）') {
            msg = '蜕生血脉进阶至二阶';
        }
        if (msg) logEvent(variables, msg);
    });
}

// ============================================================
//  生命周期管理
// ============================================================
function initializeEventListeners() {
    if (scriptState.initialized) return;
    try {
        // A. 注册 PRE-生成钩子（最优先执行）
        scriptState.preGenListener = onBeforeGeneration;
        eventMakeFirst(tavern_events.GENERATION_AFTER_COMMANDS, scriptState.preGenListener);

        // B. 注册 POST-生成钩子
        var Mvu = getMvuInstance();
        if (Mvu) {
            scriptState.postUpdateListener = onVariableUpdateEnded;
            eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, scriptState.postUpdateListener);
            scriptState.initialized = true;
            console.info('[' + SCRIPT_NAME + '] ' + SCRIPT_VERSION + ' 初始化成功');
            if (window.toastr) toastr.info(SCRIPT_NAME + ' 已启动', '监护脚本');
        } else {
            scriptState.retryCount++;
            if (scriptState.retryCount < scriptState.maxRetries) {
                setTimeout(initializeEventListeners, 2000);
            } else {
                console.error('[' + SCRIPT_NAME + '] MVU实例获取失败，停止重试');
            }
        }
    } catch (error) {
        console.error('[' + SCRIPT_NAME + '] 初始化失败:', error);
    }
}

function cleanup() {
    try {
        if (scriptState.preGenListener) {
            eventRemoveListener(tavern_events.GENERATION_AFTER_COMMANDS, scriptState.preGenListener);
        }
        var Mvu = getMvuInstance();
        if (Mvu && scriptState.postUpdateListener) {
            eventRemoveListener(Mvu.events.VARIABLE_UPDATE_ENDED, scriptState.postUpdateListener);
        }
        scriptState.initialized = false;
        scriptState.previousData = null;
    } catch (e) {}
}

$(function () { setTimeout(initializeEventListeners, 1500); });
$(window).on('pagehide', cleanup);
