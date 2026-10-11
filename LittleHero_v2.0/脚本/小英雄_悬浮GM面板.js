/**
 * 小英雄契约 · 悬浮导演控制台 (Floating Director Console)
 * v2.0 - 多悬浮窗兼容版
 *
 * 特性：
 * 1. 悬浮球拖拽 + 边缘自动吸附（Pointer Capture）
 * 2. 面板智能随动定位（根据球位置决定展开方向）
 * 3. MVU 事件监听 + 轮询双保险，零延迟同步
 * 4. 完整保留原 GM 面板的所有功能
 * 5. 移动端自动全屏
 * 6. 状态指示：战斗/反派/被俘/待处理事件
 *
 * v2.0 优化：
 * - CSS 变量作用域隔离（不再污染 :root）
 * - z-index 可配置常量（LH_BASE_Z）
 * - Pointer Capture 拖拽（跨 iframe 不丢事件）
 * - 悬浮球自动避让（与其他悬浮窗共存）
 * - 轮询降频 1.5s → 5s（降低 CPU 开销）
 * - 全局命名空间私有化（__lhFloatingConsole__）
 */

const LH_HUD_ID = "lh-floating-console-wrapper";
const LH_STYLE_ID = "lh-floating-console-styles";
const LH_TOOLTIP_ID = "lh-floating-console-tooltip";

// ══════════════════════════════════════════════════════════════════
// ██ 可调参数
// ══════════════════════════════════════════════════════════════════
// 【层级冲突调整】若与其他悬浮窗发生层级冲突，直接调高此值即可
// 建议范围：2000000 ~ 2147483600
const LH_BASE_Z = 2147483000;

// 【命名冲突调整】全局 API 命名空间（加双下划线前缀，避免冲突）
const LH_GLOBAL_API = "__lhFloatingConsole__";

// 【性能调整】轮询兜底间隔（毫秒）。MVU 事件驱动为主，此值只作为事件丢失的兜底
const LH_POLL_INTERVAL = 5000;

// ── 窗口定位（优先挂载到顶层 document）──
let hud_win = window;
try {
  if (window.top && window.top.document) hud_win = window.top;
} catch (e) {
  try {
    if (window.parent && window.parent.document) hud_win = window.parent;
  } catch (err) {}
}
const hud_doc = hud_win.document;

// ── 全局状态 ──
let _currentData = null;
let _gmSnapshot = null;
let _lastStatJson = "";

// ── 工具函数 ──
const _handles = { timers: new Set(), listeners: [] };
function trackTimer(fn, delay) {
  const id = setTimeout(fn, delay);
  _handles.timers.add(id);
  return id;
}
function trackListener(target, event, fn, options) {
  target.addEventListener(event, fn, options);
  const un = () => {
    try {
      target.removeEventListener(event, fn, options);
    } catch {}
  };
  _handles.listeners.push(un);
  return un;
}
function cleanup() {
  for (const id of _handles.timers) clearTimeout(id);
  _handles.timers.clear();
  for (const un of _handles.listeners) {
    try {
      un();
    } catch {}
  }
  _handles.listeners.length = 0;
  for (const id of [LH_HUD_ID, LH_STYLE_ID, LH_TOOLTIP_ID]) {
    try {
      const el = hud_doc.getElementById(id);
      if (el) el.remove();
    } catch {}
  }
}

function getMvuInstance() {
  try {
    return (
      hud_win.Mvu || window.Mvu || (window.parent && window.parent.Mvu) || null
    );
  } catch {
    return window.Mvu || null;
  }
}

const safeGet = (obj, path, def = null) => {
  if (!obj) return def;
  const keys = path.split(".");
  let curr = obj;
  for (const k of keys) {
    if (curr === undefined || curr === null) return def;
    curr = curr[k];
  }
  return curr === undefined || curr === null ? def : curr;
};

/* ── 声望等级派生（复刻 MVU 监控器逻辑，保证同步一致性） ── */
function computeFameLevel(fame) {
  if (fame < 15) return "默默无闻";
  if (fame < 45) return "都市传说";
  if (fame < 85) return "公众热议";
  return "无人不晓";
}

function computeRepLevel(rep, isFallen) {
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

const setInp = (id, val) => {
  const el = hud_doc.getElementById(id);
  if (el && hud_doc.activeElement !== el) {
    el.value = typeof val === "number" ? Math.round(val) : (val ?? "");
  }
};
const setTxt = (id, val) => {
  const el = hud_doc.getElementById(id);
  if (el) el.innerText = val;
};
const setHtml = (id, html) => {
  const el = hud_doc.getElementById(id);
  if (el && el.innerHTML !== html) el.innerHTML = html;
};

const showToast = (msg, color = "#9ece6a", icon = "fa-check") => {
  const toast = hud_doc.getElementById("mg-toast");
  if (!toast) return;
  toast.innerHTML = `<i class="fa-solid ${icon}" style="color:${color}"></i> <span>${msg}</span>`;
  toast.style.borderColor = color;
  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(15px)";
  }, 2200);
};

/* ══════════════════════════════════════════
   ██ 样式注入（v2.0：变量作用域隔离）
   ══════════════════════════════════════════ */
function injectStyles() {
  const old = hud_doc.getElementById(LH_STYLE_ID);
  if (old) old.remove();
  const css = `
        #${LH_HUD_ID} {
    --mg-bg: rgba(26, 27, 38, 0.96);
    --mg-bg-solid: #1a1b26;
    --mg-panel-bg: #1a1b26;
    --mg-border: rgba(255, 255, 255, 0.08);
    --mg-border-hi: rgba(180, 190, 254, 0.35);
    --mg-accent: #b4befe;
    --mg-accent-glow: rgba(180, 190, 254, 0.25);
    --mg-blue: #7aa2f7;
    --mg-pink: #f7768e;
    --mg-gold: #e0af68;
    --mg-green: #9ece6a;
    --mg-red: #f87171;
    --mg-text: #c0caf5;
    --mg-text-dim: #787c99;
    --mg-font: 'Sarabun', 'Noto Serif SC', 'Segoe UI', sans-serif;
    --mg-mono: 'Consolas', 'JetBrains Mono', monospace;

    /* ── 响应式令牌 ── */
    --mg-panel-w: 420px;
    --mg-panel-max-h: 82vh;
    --mg-panel-margin: 8px;
    --mg-panel-radius: 14px;
    --mg-pad-h: 16px;
    --mg-pad-v: 14px;
    --mg-gap: 14px;
    --mg-font-sm: 10.5px;
    --mg-font-base: 11.5px;
    --mg-font-md: 12.5px;
    --mg-font-lg: 13.5px;
    --mg-orb-size: 52px;
    --mg-btn-min-h: 32px;
    --mg-mini-btn-min: 30px;
    --mg-input-num-w: 70px;
    --mg-input-mini-w: 55px;
    --mg-range-min-w: 60px;
}

/* ── 平板 / 大屏触屏 ── */
@media (max-width: 768px), (pointer: coarse) and (max-width: 900px) {
    #${LH_HUD_ID} {
        --mg-panel-margin: 6px;
        --mg-orb-size: 48px;
    }
}

/* ── 标准手机 ── */
@media (max-width: 480px) {
    #${LH_HUD_ID} {
        --mg-panel-margin: 5px;
        --mg-pad-h: 12px;
        --mg-pad-v: 12px;
        --mg-gap: 12px;
        --mg-font-md: 12px;
        --mg-font-lg: 13px;
        --mg-orb-size: 44px;
        --mg-input-num-w: 60px;
        --mg-input-mini-w: 50px;
    }
}

/* ── 窄屏手机 (iPhone SE / 小屏安卓) ── */
@media (max-width: 380px) {
    #${LH_HUD_ID} {
        --mg-panel-margin: 4px;
        --mg-pad-h: 10px;
        --mg-pad-v: 10px;
        --mg-gap: 10px;
        --mg-font-sm: 10px;
        --mg-font-base: 11px;
        --mg-font-md: 11.5px;
        --mg-font-lg: 12.5px;
        --mg-orb-size: 42px;
        --mg-btn-min-h: 30px;
        --mg-mini-btn-min: 28px;
        --mg-input-num-w: 54px;
        --mg-input-mini-w: 46px;
    }
    #${LH_HUD_ID} .mg-header-title { display: none; }
}

/* ── 极窄屏 (折叠屏窄模式 / 320px 及以下) ── */
@media (max-width: 320px) {
    #${LH_HUD_ID} {
        --mg-panel-margin: 3px;
        --mg-panel-radius: 10px;
        --mg-pad-h: 8px;
        --mg-pad-v: 8px;
        --mg-gap: 8px;
        --mg-font-md: 11px;
        --mg-input-num-w: 48px;
        --mg-input-mini-w: 42px;
    }
    #${LH_HUD_ID} .mg-btn-group { grid-template-columns: 1fr !important; }
    #${LH_HUD_ID} .mg-quick { flex-wrap: wrap; }
}

/* ── 横屏矮屏 (手机横放) ── */
@media (max-height: 500px) and (orientation: landscape) {
    #${LH_HUD_ID} {
        --mg-panel-margin: 4px;
        --mg-pad-v: 8px;
        --mg-gap: 8px;
        --mg-font-md: 12px;
    }
    #${LH_HUD_ID} .mg-header { padding: 8px var(--mg-pad-h); }
    #${LH_HUD_ID} .mg-tab { padding: 6px 0; }
    #${LH_HUD_ID} .mg-body { padding: 10px var(--mg-pad-h); }
    #${LH_HUD_ID} .mg-card { padding: 10px 12px; }
}

/* ══════════════════════════════════════════
   容器与悬浮球
   ══════════════════════════════════════════ */
#${LH_HUD_ID} {
    position: fixed; z-index: ${LH_BASE_Z};
    font-family: var(--mg-font);
    pointer-events: none;
    top: 0; left: 0; width: 100%; height: 100%;
    height: 100dvh;

    transform: translateZ(0);

    padding-top:    env(safe-area-inset-top, 0px);
    padding-right:  env(safe-area-inset-right, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    padding-left:   env(safe-area-inset-left, 0px);
    box-sizing: border-box;
}
.mg-orb {
    position: absolute;
    right: calc(22px + env(safe-area-inset-right, 0px));
    bottom: calc(110px + env(safe-area-inset-bottom, 0px));
    width: var(--mg-orb-size);
    height: var(--mg-orb-size);
    background: radial-gradient(circle at 35% 30%,
        rgba(180, 190, 254, 0.12),
        rgba(26, 27, 38, 0.98) 70%);
    border: 1.5px solid var(--mg-accent);
    border-radius: 50%;
    display: flex; justify-content: center; align-items: center;
    color: var(--mg-accent);
    font-size: calc(var(--mg-orb-size) * 0.38);
    cursor: grab; pointer-events: auto; touch-action: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5),
                inset 0 0 10px rgba(180, 190, 254, 0.08);
    backdrop-filter: blur(10px);
    transition: transform 0.2s, box-shadow 0.3s, border-color 0.3s;
    will-change: left, top, transform;
}
.mg-orb:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6),
                inset 0 0 14px rgba(180, 190, 254, 0.18);
}
.mg-orb.is-dragging {
    transition: none; transform: scale(0.95);
    cursor: grabbing; box-shadow: none;
}

.mg-orb.mode-combat {
    border-color: var(--mg-red); color: var(--mg-red);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5),
                0 0 14px rgba(248, 113, 113, 0.35);
    animation: mgOrbPulse 1.6s infinite;
}
.mg-orb.mode-fallen {
    border-color: var(--mg-pink); color: var(--mg-pink);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5),
                0 0 14px rgba(247, 118, 142, 0.3);
}
.mg-orb.mode-captured {
    border-color: var(--mg-red); color: var(--mg-red);
    animation: mgOrbShake 0.5s infinite alternate;
}

.mg-orb-dot {
    position: absolute; top: 0; right: 0;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--mg-gold);
    border: 2px solid #0f0e15;
    display: none;
}
.mg-orb.has-event .mg-orb-dot { display: block; animation: mgOrbDot 1.4s infinite; }

@keyframes mgOrbPulse {
    50% { box-shadow: 0 4px 14px rgba(0,0,0,0.5), 0 0 22px rgba(248,113,113,0.55); }
}
@keyframes mgOrbShake {
    100% { transform: translate(1px, -1px) scale(1.03); }
}
@keyframes mgOrbDot {
    50% { transform: scale(0.75); opacity: 0.7; }
}

/* ══════════════════════════════════════════
   主面板
   ══════════════════════════════════════════ */
.mg-panel {
    position: absolute;
    width: min(var(--mg-panel-w), calc(100vw - 32px));
    max-height: var(--mg-panel-max-h);
    max-height: min(var(--mg-panel-max-h), 100dvh - 32px);
    background: var(--mg-bg);
    border: 1px solid var(--mg-border);
    border-radius: var(--mg-panel-radius);
    box-shadow: 0 20px 50px rgba(0,0,0,0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    overflow: hidden;
    display: flex; flex-direction: column;
    opacity: 0; transform: scale(0.94); visibility: hidden;
    pointer-events: none;
    transition: all 0.28s cubic-bezier(0.22, 0.8, 0.24, 1);
}
#${LH_HUD_ID}.is-expanded .mg-orb { opacity: 0.25; transform: scale(0.55); }
#${LH_HUD_ID}.is-expanded .mg-orb:hover { opacity: 1; transform: scale(0.7); }
#${LH_HUD_ID}.is-expanded .mg-panel {
    opacity: 1; transform: scale(1); visibility: visible; pointer-events: auto;
}

/* ── 移动端全屏模式 ── */
@media (max-width: 768px), (pointer: coarse) and (max-width: 900px) {
    .mg-panel {
        position: absolute !important;
        top:    var(--mg-panel-margin) !important;
        left:   var(--mg-panel-margin) !important;
        right:  var(--mg-panel-margin) !important;
        bottom: var(--mg-panel-margin) !important;
        width: auto !important;
        max-height: none !important;
        min-height: 0 !important;
        transform-origin: center !important;
        border-radius: var(--mg-panel-radius);
    }
    #${LH_HUD_ID}.is-expanded .mg-orb { display: none; }
}


/* ── 头部 ── */
.mg-header {
    padding: 12px var(--mg-pad-h);
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--mg-border);
    display: flex; justify-content: space-between; align-items: center;
    color: var(--mg-accent);
    font-weight: 700;
    font-size: var(--mg-font-lg);
    letter-spacing: 1px;
    gap: 8px;
}
.mg-header-left {
    display: flex; align-items: center; gap: 8px;
    min-width: 0; flex: 1;
}
.mg-header-left > i { flex-shrink: 0; }
.mg-header-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}
.mg-phase-badge {
    font-size: var(--mg-font-sm);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(180, 190, 254, 0.08);
    color: var(--mg-accent);
    border: 1px solid var(--mg-border);
    letter-spacing: 0.5px;
    font-family: var(--mg-mono);
    flex-shrink: 0;
    white-space: nowrap;
}
.mg-header-right {
    display: flex; align-items: center; gap: 6px;
    flex-shrink: 0;
}
.mg-icon-btn {
    width: 28px; height: 28px;
    border-radius: 6px; border: none;
    background: rgba(255,255,255,0.05);
    color: var(--mg-text-dim);
    cursor: pointer; font-size: 12px;
    display: flex; justify-content: center; align-items: center;
    transition: 0.2s;
    flex-shrink: 0;
}
.mg-icon-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
.mg-close { color: var(--mg-pink); background: rgba(247,118,142,0.1); }
.mg-close:hover { background: rgba(247,118,142,0.25); color: #fff; }

/* ── Tabs ── */
.mg-tabs {
    display: flex; flex-shrink: 0;
    background: rgba(0,0,0,0.3);
    border-bottom: 1px solid var(--mg-border);
}
.mg-tab {
    flex: 1; min-width: 0;
    padding: 10px 4px;
    text-align: center;
    font-size: var(--mg-font-md);
    color: var(--mg-text-dim);
    cursor: pointer; font-weight: 600;
    display: flex; justify-content: center; align-items: center; gap: 6px;
    transition: 0.2s; user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mg-tab:hover { color: var(--mg-text); background: rgba(255,255,255,0.04); }
.mg-tab.active {
    color: var(--mg-accent);
    background: rgba(180, 190, 254, 0.06);
    border-bottom: 2px solid var(--mg-accent);
}

/* ── 内容区 ── */
.mg-body {
    padding: var(--mg-pad-v) var(--mg-pad-h);
    display: flex; flex-direction: column; gap: var(--mg-gap);
    flex: 1; min-height: 0;
    overflow-y: auto; overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
}
.mg-body::-webkit-scrollbar { width: 5px; }
.mg-body::-webkit-scrollbar-thumb {
    background: rgba(180, 190, 254, 0.25); border-radius: 3px;
}
.mg-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }

.mg-pane { display: none; flex-direction: column; gap: var(--mg-gap); }
.mg-pane.active { display: flex; }

/* ── 卡片 ── */
.mg-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--mg-border);
    border-radius: 10px;
    padding: 12px var(--mg-pad-h);
    transition: 0.2s;
    min-width: 0;
    overflow-wrap: break-word;
}
.mg-card:hover { border-color: rgba(255,255,255,0.13); }
.mg-card.accent-pink { border-left: 3px solid var(--mg-pink); }
.mg-card.accent-purple { border-left: 3px solid var(--mg-accent); }
.mg-card.accent-gold { border-left: 3px solid var(--mg-gold); }
.mg-card.accent-blue { border-left: 3px solid var(--mg-blue); }

.mg-card-title {
    color: var(--mg-accent);
    font-size: var(--mg-font-md);
    font-weight: 700;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px dashed rgba(255,255,255,0.08);
    display: flex; justify-content: space-between; align-items: center;
    letter-spacing: 0.5px;
    gap: 8px;
    min-width: 0;
}
.mg-card-title > span:first-child {
    display: flex; align-items: center; gap: 7px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mg-card-title > span:last-child { flex-shrink: 0; }
.mg-card-title.pink { color: var(--mg-pink); border-bottom-color: rgba(247,118,142,0.2); }
.mg-card-title.gold { color: var(--mg-gold); border-bottom-color: rgba(224,175,104,0.2); }
.mg-card-title.blue { color: var(--mg-blue); border-bottom-color: rgba(122,162,247,0.2); }

/* ── 行与控件 ── */
.mg-row {
    display: flex; align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    min-width: 0;
}
.mg-row:last-child { margin-bottom: 0; }
.mg-row .label {
    flex: 1;
    min-width: 0;
    color: var(--mg-text);
    font-size: var(--mg-font-md);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.mg-row .label.dim { color: var(--mg-text-dim); font-size: var(--mg-font-base); }

.mg-input {
    background: rgba(0,0,0,0.35);
    border: 1px solid var(--mg-border);
    border-radius: 6px;
    color: #fff;
    font-family: var(--mg-mono);
    font-size: var(--mg-font-md);
    padding: 6px 10px;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    outline: none;
    transition: 0.2s;
}
.mg-input:focus {
    border-color: var(--mg-accent);
    box-shadow: 0 0 0 2px rgba(180, 190, 254, 0.12);
}
.mg-input.num {
    width: var(--mg-input-num-w);
    text-align: center;
    font-weight: 700;
    flex-shrink: 0;
    padding-left: 4px;
    padding-right: 4px;
}
.mg-input.mini {
    width: var(--mg-input-mini-w);
    padding: 4px 6px;
    font-size: var(--mg-font-base);
}
.mg-input.full { width: 100%; }
.mg-input.mono { font-family: var(--mg-mono); }
.mg-input option { background: var(--mg-panel-bg); color: var(--mg-text); }
select.mg-input {
    appearance: none; -webkit-appearance: none;
    padding-right: 24px;
    background-image: url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23787c99' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 14px;
}
textarea.mg-input {
    resize: vertical;
    min-height: 52px;
    font-family: var(--mg-font);
    line-height: 1.5;
}

/* ── 按钮 ── */
.mg-btn-group {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(78px, 100%), 1fr));
    gap: 6px;
}
.mg-btn {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--mg-border);
    color: var(--mg-text);
    border-radius: 6px;
    padding: 8px 6px;
    min-height: var(--mg-btn-min-h);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--mg-font-base);
    font-weight: 600;
    display: flex; justify-content: center; align-items: center; gap: 5px;
    transition: 0.2s;
    white-space: nowrap;
    overflow: hidden;
    min-width: 0;
    box-sizing: border-box;
}
.mg-btn > span {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}
.mg-btn:hover:not(:disabled) { transform: translateY(-1px); }
.mg-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.mg-btn.purple { border-color: rgba(180, 190, 254, 0.35); color: var(--mg-accent); }
.mg-btn.purple:hover:not(:disabled) { background: rgba(180, 190, 254, 0.12); }
.mg-btn.pink { border-color: rgba(247,118,142,0.35); color: var(--mg-pink); }
.mg-btn.pink:hover:not(:disabled) { background: rgba(247,118,142,0.12); }
.mg-btn.gold { border-color: rgba(224,175,104,0.35); color: var(--mg-gold); }
.mg-btn.gold:hover:not(:disabled) { background: rgba(224,175,104,0.12); }
.mg-btn.green { border-color: rgba(158,206,106,0.35); color: var(--mg-green); }
.mg-btn.green:hover:not(:disabled) { background: rgba(158,206,106,0.12); }
.mg-btn.blue { border-color: rgba(122,162,247,0.35); color: var(--mg-blue); }
.mg-btn.blue:hover:not(:disabled) { background: rgba(122,162,247,0.12); }
.mg-btn.gray { border-color: rgba(255,255,255,0.1); color: var(--mg-text-dim); }
.mg-btn.gray:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; }
.mg-btn.red { border-color: rgba(248,113,113,0.4); color: var(--mg-red); }
.mg-btn.red:hover:not(:disabled) { background: rgba(248,113,113,0.12); }

.mg-mini-btn {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--mg-border);
    color: var(--mg-text-dim);
    border-radius: 4px;
    padding: 4px 6px;
    min-height: var(--mg-mini-btn-min);
    min-width: var(--mg-mini-btn-min);
    cursor: pointer;
    font-family: var(--mg-mono);
    font-size: var(--mg-font-sm);
    font-weight: 700;
    transition: 0.15s;
    flex-shrink: 0;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    box-sizing: border-box;
}
.mg-mini-btn:hover { color: #fff; border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.06); }
.mg-mini-btn.pink:hover { color: var(--mg-pink); border-color: var(--mg-pink); }
.mg-mini-btn.green:hover { color: var(--mg-green); border-color: var(--mg-green); }
.mg-mini-btn.blue:hover { color: var(--mg-blue); border-color: var(--mg-blue); }
.mg-mini-btn.gold:hover { color: var(--mg-gold); border-color: var(--mg-gold); }
.mg-mini-btn.purple:hover { color: var(--mg-accent); border-color: var(--mg-accent); }
.mg-mini-btn.red:hover { color: var(--mg-red); border-color: var(--mg-red); }

.mg-quick { display: flex; gap: 4px; flex-shrink: 0; }

/* ── 主题标签 ── */
.mg-tag-area {
    display: flex; flex-wrap: wrap; gap: 6px;
    min-height: 26px; margin-bottom: 6px;
}
.mg-tag {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(180, 190, 254, 0.08);
    border: 1px solid rgba(180, 190, 254, 0.28);
    color: var(--mg-text);
    padding: 3px 8px;
    border-radius: 5px;
    font-size: var(--mg-font-sm);
    font-family: var(--mg-mono);
    transition: 0.15s;
    max-width: 100%;
    overflow-wrap: break-word;
}
.mg-tag.h-event { background: rgba(247,118,142,0.08); border-color: rgba(247,118,142,0.32); }
.mg-tag.clickable { cursor: pointer; }
.mg-tag.clickable:hover { background: rgba(180, 190, 254, 0.18); }
.mg-tag .del { cursor: pointer; opacity: 0.6; font-weight: bold; margin-left: 2px; flex-shrink: 0; }
.mg-tag .del:hover { opacity: 1; color: var(--mg-pink); }
.mg-tag-empty { color: var(--mg-text-dim); font-style: italic; font-size: var(--mg-font-base); opacity: 0.6; }

/* ── 事件列表 ── */
.mg-event-list { display: flex; flex-direction: column; gap: 4px; }
.mg-event-item {
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.03);
    border-left: 2px solid var(--mg-accent);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: var(--mg-font-base);
    color: var(--mg-text);
    font-family: var(--mg-mono);
    min-width: 0;
}
.mg-event-item > span {
    flex: 1; min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.mg-event-item .del {
    cursor: pointer; color: var(--mg-pink);
    opacity: 0.6; padding-left: 8px;
    transition: 0.15s; flex-shrink: 0;
}
.mg-event-item .del:hover { opacity: 1; }
.mg-empty-hint {
    text-align: center; padding: 8px;
    color: var(--mg-text-dim);
    font-size: var(--mg-font-sm);
    opacity: 0.6; font-style: italic;
}

/* ── 状态行 ── */
.mg-status-block {
    background: rgba(0,0,0,0.25);
    padding: 8px 10px;
    border-radius: 6px;
    margin-bottom: 8px;
    font-size: var(--mg-font-md);
}
.mg-status-row {
    display: flex; justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 3px 0;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    min-width: 0;
}
.mg-status-row:last-child { border-bottom: none; }
.mg-status-row .k {
    color: var(--mg-text-dim);
    flex-shrink: 0;
    white-space: nowrap;
}
.mg-status-row .v {
    color: var(--mg-text);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
}
.mg-status-row .v.pink { color: var(--mg-pink); }
.mg-status-row .v.purple { color: var(--mg-accent); }
.mg-status-row .v.gold { color: var(--mg-gold); }
.mg-status-row .v.green { color: var(--mg-green); }
.mg-status-row .v.red { color: var(--mg-red); }

/* ── 世界观备注 ── */
.mg-note-list {
    display: flex; flex-direction: column; gap: 6px;
    max-height: 220px; overflow-y: auto;
}
.mg-note-list::-webkit-scrollbar { width: 4px; }
.mg-note-list::-webkit-scrollbar-thumb { background: rgba(180, 190, 254, 0.25); border-radius: 2px; }
.mg-note-item {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--mg-border);
    border-left: 2px solid var(--mg-accent);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: var(--mg-font-base);
    position: relative;
    min-width: 0;
}
.mg-note-key {
    color: var(--mg-accent);
    font-weight: 700;
    font-family: var(--mg-mono);
    font-size: var(--mg-font-sm);
    display: block;
    margin-bottom: 3px;
    padding-right: 46px;
    overflow-wrap: break-word;
}
.mg-note-val {
    color: var(--mg-text);
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    opacity: 0.9;
}
.mg-note-actions {
    position: absolute; top: 6px; right: 6px;
    display: flex; gap: 4px;
}
.mg-note-btn {
    width: 20px; height: 20px;
    border-radius: 4px; border: none;
    cursor: pointer;
    display: flex; justify-content: center; align-items: center;
    opacity: 0.55; transition: 0.15s;
    font-size: 10px;
}
.mg-note-btn:hover { opacity: 1; }
.mg-note-btn.edit { background: var(--mg-accent); color: #000; }
.mg-note-btn.del { background: var(--mg-pink); color: #fff; }

/* ── 滑条 ── */
input[type="range"].mg-range {
    -webkit-appearance: none; appearance: none;
    flex: 1;
    min-width: var(--mg-range-min-w);
    height: 4px; border-radius: 2px;
    background: rgba(255,255,255,0.1);
    outline: none; cursor: pointer;
}
input[type="range"].mg-range::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--mg-accent); cursor: pointer;
    border: 2px solid var(--mg-bg-solid);
    box-shadow: 0 0 4px rgba(180, 190, 254, 0.4);
}
input[type="range"].mg-range::-moz-range-thumb {
    width: 16px; height: 16px; border-radius: 50%;
    background: var(--mg-accent); cursor: pointer;
    border: 2px solid var(--mg-bg-solid);
}

/* ── Tooltip ── */
#${LH_TOOLTIP_ID} {
    position: fixed; z-index: ${LH_BASE_Z + 100};
    pointer-events: none;
    width: max-content;
    max-width: min(260px, calc(100vw - 24px));
    padding: 10px 12px; border-radius: 8px;
    background: rgba(26, 27, 38, 0.98);
    backdrop-filter: blur(14px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.8);
    border: 1px solid var(--mg-border);
    border-left: 3px solid var(--mg-accent);
    opacity: 0; visibility: hidden;
    transform: translateY(6px);
    transition: all 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
#${LH_TOOLTIP_ID}.active { opacity: 1; visibility: visible; transform: translateY(0); }
#${LH_TOOLTIP_ID} .tt-t {
    color: var(--mg-accent);
    font-weight: 700;
    font-size: var(--mg-font-md);
    margin-bottom: 5px; padding-bottom: 5px;
    border-bottom: 1px dashed rgba(180, 190, 254, 0.25);
    font-family: var(--mg-font);
}
#${LH_TOOLTIP_ID} .tt-d {
    color: var(--mg-text-dim);
    font-size: var(--mg-font-base);
    line-height: 1.55;
    font-family: var(--mg-font);
    white-space: pre-wrap;
    overflow-wrap: break-word;
}

/* ── Toast ── */
#mg-toast {
    position: fixed;
    bottom: calc(25px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%) translateY(15px);
    background: rgba(26, 27, 38, 0.98);
    border: 1px solid var(--mg-accent);
    color: #fff;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: var(--mg-font-md);
    font-weight: 600;
    box-shadow: 0 8px 25px rgba(0,0,0,0.7);
    z-index: ${LH_BASE_Z + 200};
    pointer-events: none;
    opacity: 0;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    display: flex; align-items: center; gap: 8px;
    font-family: var(--mg-font);
    overflow-wrap: break-word;
}
    `;
  const styleEl = hud_doc.createElement("style");
  styleEl.id = LH_STYLE_ID;
  styleEl.textContent = css;
  hud_doc.head.appendChild(styleEl);
}

/* ══════════════════════════════════════════
   ██ 悬浮球位置避让（v2.0 新增）
   ══════════════════════════════════════════ */
function findFreeOrbSpot() {
  // 默认位置（与 CSS 保持一致）
  let right = 22;
  let bottom = 110;

  try {
    // 扫描所有可能的悬浮元素（其他脚本的球、FAB、HUD）
    const candidates = hud_doc.querySelectorAll(
      '[class*="orb"],[id*="orb"],[class*="float"],[id*="float"],[class*="fab"],[class*="hud"]',
    );

    const conflicts = [];
    candidates.forEach((el) => {
      if (el.closest(`#${LH_HUD_ID}`)) return; // 跳过自己
      const rect = el.getBoundingClientRect();
      // 只关心小尺寸的悬浮元素
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < 120 &&
        rect.height < 120
      ) {
        conflicts.push({
          right: hud_win.innerWidth - rect.right,
          bottom: hud_win.innerHeight - rect.bottom,
          w: rect.width,
          h: rect.height,
        });
      }
    });

    // 如果和已有球体水平/垂直距离都太近，往上错开
    conflicts.forEach((c) => {
      const dx = Math.abs(c.right - right);
      const dy = Math.abs(c.bottom - bottom);
      if (dx < 70 && dy < 70) {
        bottom = Math.max(bottom, c.bottom + c.h + 20);
      }
    });

    // 边界钳制
    bottom = Math.min(bottom, hud_win.innerHeight - 100);
    right = Math.min(right, hud_win.innerWidth - 80);
  } catch (e) {}

  return { right, bottom };
}

/* ══════════════════════════════════════════
   ██ HTML 结构
   ══════════════════════════════════════════ */
function injectHTML() {
  const old = hud_doc.getElementById(LH_HUD_ID);
  if (old) old.remove();

  const wrapper = hud_doc.createElement("div");
  wrapper.id = LH_HUD_ID;
  wrapper.innerHTML = `
        <!-- 悬浮球 -->
        <div class="mg-orb" id="mg-orb-btn" title="点击展开 / 拖拽移动">
            <i class="fa-solid fa-film"></i>
            <span class="mg-orb-dot"></span>
        </div>

        <!-- 主面板 -->
        <div class="mg-panel" id="mg-panel">
            <div class="mg-header">
                <div class="mg-header-left">
                    <i class="fa-solid fa-film"></i>
                    <span class="mg-header-title">DIRECTOR CONSOLE</span>
                    <span class="mg-phase-badge" id="mg-phase-badge">--</span>
                </div>
                <div class="mg-header-right">
                    <button class="mg-icon-btn" onclick="window.${LH_GLOBAL_API}.restoreSnapshot()" title="撤销本次打开后的所有修改">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                    <button class="mg-icon-btn mg-close" onclick="window.${LH_GLOBAL_API}.close()" title="收起面板">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <div class="mg-tabs">
                <div class="mg-tab active" data-tab="lh-pane-narrative">
                    <i class="fa-solid fa-forward"></i> 叙事
                </div>
                <div class="mg-tab" data-tab="lh-pane-stats">
                    <i class="fa-solid fa-sliders"></i> 状态
                </div>
                <div class="mg-tab" data-tab="lh-pane-world">
                    <i class="fa-solid fa-globe"></i> 世界
                </div>
            </div>

            <div class="mg-body">

                <!-- ═══ Tab 1: 叙事 ═══ -->
                <div class="mg-pane active" id="lh-pane-narrative">

                    <!-- 强制转场 -->
                    <div class="mg-card accent-purple">
                        <div class="mg-card-title has-tt"
                             data-tt-t="强制转场"
                             data-tt-d="直接修改【进程.阶段】，跳过流程判定。慎用！">
                            <span><i class="fa-solid fa-forward"></i> 强制转场</span>
                            <span style="font-size:10.5px; color:var(--mg-text-dim); font-weight:normal;" id="mg-current-phase-display">--</span>
                        </div>
                        <select id="mg-phase-selector" class="mg-input full" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.进程.阶段', this.value)">
                            <option value="" disabled>-- 跳转至 --</option>
                            <option value="幕间休息">☕ 幕间休息 (Idle)</option>
                            <option value="战斗准备">⚠️ 战斗准备 (Prep)</option>
                            <option value="战斗回合">⚔️ 战斗回合 (Combat)</option>
                            <option value="终结回合">✨ 终结时刻 (Finish)</option>
                            <option value="战斗胜利">🏆 战斗胜利 (Win)</option>
                            <option value="战斗败北">💔 战斗败北 (Lose)</option>
                            <option value="战后处理">🧹 战后处理 (Cleanup)</option>
                        </select>
                    </div>

                    <!-- 主题注入 -->
                    <div class="mg-card accent-pink">
                        <div class="mg-card-title pink has-tt"
                             data-tt-t="主题注入器"
                             data-tt-d="向当前关卡或幕间H事件注入主题标签。\nAI会围绕这些主题展开剧情。">
                            <span><i class="fa-solid fa-syringe"></i> 主题注入</span>
                            <span style="font-size:10.5px; color:var(--mg-text-dim); font-weight:normal;" id="mg-theme-target-label">Target: --</span>
                        </div>
                        <div id="mg-theme-tags-container" class="mg-tag-area"></div>
                        <div style="display:flex; gap:6px;">
                            <input type="text" id="mg-new-theme-input" class="mg-input"
                                   placeholder="输入关键词（如：触手、纯爱）"
                                   onkeydown="if(event.key==='Enter') window.${LH_GLOBAL_API}.injectTheme()">
                            <button class="mg-btn purple" style="flex-shrink:0; padding:6px 12px;"
                                    onclick="window.${LH_GLOBAL_API}.injectTheme()">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </div>

                    <!-- 幕间H事件控制 -->
                    <div class="mg-card accent-pink" id="mg-panel-hevent" style="display:none;">
                        <div class="mg-card-title pink has-tt"
                             data-tt-t="幕间H事件控制"
                             data-tt-d="重随：基于性癖池重新随机主题\n强制：立即触发/开始事件\n跳过：直接结算并清空">
                            <span><i class="fa-solid fa-heart-crack"></i> 幕间H事件</span>
                            <span id="mg-hevent-turn-counter" style="font-size:10.5px; color:var(--mg-text-dim); font-weight:normal;">回合: 0/6</span>
                        </div>
                        <div class="mg-status-block">
                            <div class="mg-status-row">
                                <span class="k">当前状态</span>
                                <span class="v pink" id="mg-hevent-status-val">检测中...</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">锁定主题</span>
                                <span class="v" id="mg-hevent-theme-val" style="font-size:11px;">--</span>
                            </div>
                        </div>
                        <div id="mg-hevent-escape-wrapper" style="display:none; margin-bottom:8px; background:rgba(0,0,0,0.25); padding:8px 10px; border-radius:6px; border:1px solid rgba(247,118,142,0.2);">
                            <div class="mg-row" style="margin-bottom:0;">
                                <span class="label" style="color:var(--mg-pink); font-size:12px;">
                                    <i class="fa-solid fa-person-running"></i> 逃脱进度
                                </span>
                                <input type="number" id="mg-inp-hevent-escape" class="mg-input num mini"
                                       min="0" max="100"
                                       onchange="window.${LH_GLOBAL_API}.setHEventEscape(Number(this.value))">
                                <div class="mg-quick">
                                    <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.adjustHEventEscape(-25)">-25</button>
                                    <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.adjustHEventEscape(25)">+25</button>
                                    <button class="mg-mini-btn pink" onclick="window.${LH_GLOBAL_API}.finishHEventImmediately()">落幕</button>
                                </div>
                            </div>
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(3, 1fr);">
                            <button class="mg-btn gold" id="mg-btn-reroll-hevent" onclick="window.${LH_GLOBAL_API}.rerollHEvent()">
                                <i class="fa-solid fa-shuffle"></i> 重随
                            </button>
                            <button class="mg-btn pink" id="mg-btn-trigger-hevent" onclick="window.${LH_GLOBAL_API}.triggerHEvent()">
                                <i class="fa-solid fa-play"></i> <span>强制</span>
                            </button>
                            <button class="mg-btn blue" id="mg-btn-skip-hevent" onclick="window.${LH_GLOBAL_API}.skipHEvent()">
                                <i class="fa-solid fa-check"></i> 跳过
                            </button>
                        </div>
                    </div>

                    <!-- 威胁雷达 -->
                    <div class="mg-card accent-gold" id="mg-panel-threat" style="display:none;">
                        <div class="mg-card-title gold has-tt"
                             data-tt-t="威胁/狩猎雷达"
                             data-tt-d="战斗冷却计数器，达到 8/8 时下回合可遭遇新BOSS。\n可锁定目标类型与主题。">
                            <span id="mg-threat-panel-title"><i class="fa-solid fa-satellite-dish"></i> 威胁雷达</span>
                            <span id="mg-threat-turn-counter" style="font-size:10.5px; color:var(--mg-text-dim); font-weight:normal;">回合: 0/8</span>
                        </div>
                        <div id="mg-fallen-prey-selector" style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2); padding:6px 8px; border-radius:6px; margin-bottom:8px;">
                            <span id="mg-prey-selector-label" style="font-size:11.5px; color:var(--mg-text-dim);">🎯 目标类型:</span>
                            <div style="display:flex; gap:4px;">
                                <button id="mg-btn-prey-random" class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.lockPreyType('无')">随机</button>
                                <button id="mg-btn-prey-monster" class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.lockPreyType('魔物')">魔物</button>
                                <button id="mg-btn-prey-mg" class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.lockPreyType('小英雄')">小英雄</button>
                                <button id="mg-btn-prey-human" class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.lockPreyType('人类')">人类</button>
                            </div>
                        </div>
                        <div id="mg-threat-theme-area" style="background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:6px; margin-bottom:8px; font-size:11.5px;">
                            <div style="margin-bottom:6px;">
                                <span style="opacity:0.7;">主主题:</span>
                                <span id="mg-threat-main-theme" style="font-weight:bold; color:var(--mg-gold); margin-left:4px;">读取中...</span>
                            </div>
                            <div>
                                <div style="opacity:0.7; margin-bottom:4px; display:flex; justify-content:space-between;">
                                    <span>副主题选项:</span>
                                    <span id="mg-threat-sub-status" style="color:var(--mg-green);">[待选择]</span>
                                </div>
                                <div id="mg-threat-sub-options" class="mg-tag-area"></div>
                            </div>
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(3, 1fr);">
                            <button class="mg-btn gold has-tt"
                                    data-tt-t="重随主主题"
                                    data-tt-d="从 Boss 主题池随机抽一个作为主主题并锁定。\n副主题仍交由 AI 生成。"
                                    onclick="window.${LH_GLOBAL_API}.rerollThreatMainTheme()">
                                <i class="fa-solid fa-dice"></i> 重随
                            </button>
                            <button class="mg-btn green has-tt"
                                    data-tt-t="完全随机"
                                    data-tt-d="清空主主题与副主题的锁定。\n生成 BOSS 时由系统从主题池随机抽主主题，\n副主题交由 AI 发挥。"
                                    onclick="window.${LH_GLOBAL_API}.randomizeThreatThemes()">
                                <i class="fa-solid fa-shuffle"></i> 完全随机
                            </button>
                            <button class="mg-btn blue has-tt"
                                    data-tt-t="清空副主题"
                                    data-tt-d="保留已锁定的主主题，把副主题交回 AI 生成。"
                                    onclick="window.${LH_GLOBAL_API}.clearThreatSubTheme()">
                                <i class="fa-solid fa-eraser"></i> 副主题清理
                            </button>
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr); margin-top:6px;">
                            <button class="mg-btn purple has-tt"
                                    data-tt-t="手动填写主题"
                                    data-tt-d="自行指定主主题与副主题，写入后立即锁定。"
                                    onclick="window.${LH_GLOBAL_API}.toggleThreatThemeEditor()">
                                <i class="fa-solid fa-pen"></i> 手动填写
                            </button>
                            <button class="mg-btn pink has-tt"
                                    data-tt-t="强制遭遇"
                                    data-tt-d="立刻把幕间回合计数推到可遭遇状态。"
                                    onclick="window.${LH_GLOBAL_API}.forceThreatEncounter()">
                                <i class="fa-solid fa-forward-fast"></i> 强制遭遇
                            </button>
                        </div>

                        <!-- 手动填写主题（默认隐藏） -->
                        <div id="mg-threat-theme-editor" style="display:none; margin-top:8px; background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                            <div style="font-size:10.5px; color:var(--mg-text-dim); margin-bottom:4px;">主主题 (Main) — 必填</div>
                            <input type="text" id="mg-threat-main-input" class="mg-input" placeholder="例如: 触手 / 催眠&amp;洗脑 / 丸吞" style="margin-bottom:6px;">
                            <div style="font-size:10.5px; color:var(--mg-text-dim); margin-bottom:4px;">副主题 (Sub) — 可留空</div>
                            <input type="text" id="mg-threat-sub-input" class="mg-input" placeholder="留空则由 AI 自行发挥" style="margin-bottom:8px;">
                            <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr);">
                                <button class="mg-btn green" onclick="window.${LH_GLOBAL_API}.saveThreatThemes()">
                                    <i class="fa-solid fa-lock"></i> 应用并锁定
                                </button>
                                <button class="mg-btn gray" onclick="window.${LH_GLOBAL_API}.toggleThreatThemeEditor()">取消</button>
                            </div>
                        </div>
                    </div>

                    <!-- 战斗仲裁 -->
                    <div class="mg-card accent-pink" id="mg-panel-combat" style="display:none; border-left-color:var(--mg-red);">
                        <div class="mg-card-title pink has-tt"
                             data-tt-t="战斗仲裁"
                             data-tt-d="当前BOSS状态快速调整。\n韧性归零 → 战斗胜利\n充能拉满 → 可发动终结技">
                            <span><i class="fa-solid fa-skull-crossbones"></i> BOSS: <span id="mg-val-boss-name">?</span></span>
                        </div>
                        <div class="mg-row">
                            <span class="label">韧性 HP</span>
                            <input type="number" id="mg-inp-boss-hp" class="mg-input num" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss韧性值', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss韧性值', -20, 'add')">-20</button>
                                <button class="mg-mini-btn red" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss韧性值', 0)">Kill</button>
                            </div>
                        </div>
                        <div class="mg-row">
                            <span class="label">强度 ATK</span>
                            <input type="number" id="mg-inp-boss-str" class="mg-input num" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss基础强度', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss基础强度', -10, 'add')">-10</button>
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.当前关卡.Boss基础强度', 10, 'add')">+10</button>
                            </div>
                        </div>
                        <button class="mg-btn gold" id="mg-btn-charge-ult" style="width:100%; margin-top:6px;"
        onclick="window.${LH_GLOBAL_API}.chargeUltimate()">
    <i class="fa-solid fa-bolt"></i> 必杀充能 (Ultimate Ready)
</button>

                    </div>

                    <!-- 校园催眠控制 -->
                    <div class="mg-card accent-purple" id="mg-panel-campus-hypno" style="display:none;">
                        <div class="mg-card-title purple has-tt"
                             data-tt-t="校园催眠系统"
                             data-tt-d="高中校园被怪人结界笼罩。\n在校时穿紧身服受训并暂停常规事件。\n疑心达100%可识破决战，催眠达100%认知重塑。">
                            <span><i class="fa-solid fa-graduation-cap"></i> 校园催眠</span>
                            <span id="mg-campus-status-badge" style="font-size:10px; padding:2px 7px; border-radius:4px; font-weight:700;">离校</span>
                        </div>
                        <div class="mg-row" style="margin-bottom:6px;">
                            <span class="label" style="width:70px; flex:0 0 70px;">在校状态</span>
                            <button id="mg-btn-toggle-school" class="mg-btn blue" style="flex:1; padding:4px 8px; font-size:11px;"
                                    onclick="window.${LH_GLOBAL_API}.toggleCampusSchool()">
                                <i class="fa-solid fa-school"></i> <span>进入校园</span>
                            </button>
                        </div>
                        <div class="mg-row">
                            <span class="label" style="width:70px; flex:0 0 70px; color:var(--mg-purple);">催眠进度</span>
                            <input type="range" class="mg-range" min="0" max="100" step="5" id="mg-range-hypno"
                                   oninput="document.getElementById('mg-inp-hypno').value=this.value"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.校园催眠.催眠进度', Number(this.value))">
                            <input type="number" id="mg-inp-hypno" class="mg-input num mini"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.校园催眠.催眠进度', Number(this.value))">
                        </div>
                        <div class="mg-row">
                            <span class="label" style="width:70px; flex:0 0 70px; color:var(--mg-pink);">疑心度</span>
                            <input type="range" class="mg-range" min="0" max="100" step="5" id="mg-range-susp"
                                   oninput="document.getElementById('mg-inp-susp').value=this.value"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.校园催眠.疑心度', Number(this.value))">
                            <input type="number" id="mg-inp-susp" class="mg-input num mini"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.世界.校园催眠.疑心度', Number(this.value))">
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr); margin-top:6px;">
                            <button class="mg-btn pink" onclick="window.${LH_GLOBAL_API}.triggerCampusBreakthrough()" title="疑心100%并挑战教官">
                                <i class="fa-solid fa-bolt"></i> 触发识破
                            </button>
                            <button class="mg-btn purple" onclick="window.${LH_GLOBAL_API}.triggerCampusReshape()" title="催眠100%并完全沦陷">
                                <i class="fa-solid fa-brain"></i> 认知重塑
                            </button>
                            <button class="mg-btn blue" onclick="window.${LH_GLOBAL_API}.triggerCampusRescue()" title="外部英雄破门救援">
                                <i class="fa-solid fa-shield-halved"></i> 外部救援
                            </button>
                            <button class="mg-btn green" onclick="window.${LH_GLOBAL_API}.toggleCampusBarrier()" id="mg-btn-toggle-barrier">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> <span>破除结界</span>
                            </button>
                        </div>
                    </div>

                    <!-- 幕间节奏 -->
                    <div class="mg-card accent-blue" id="mg-panel-intermission" style="display:none;">
                        <div class="mg-card-title blue has-tt"
                             data-tt-t="幕间节奏 (Turn)"
                             data-tt-d="控制幕间日常回合计数。\n达到 6 → H事件就绪\n达到 8 → BOSS就绪\n锁定和平 → 设为 -999 永久抑制">
                            <span><i class="fa-solid fa-clock"></i> 幕间节奏</span>
                            <span id="mg-turn-status-badge" style="font-size:10px; padding:2px 7px; border-radius:4px; font-weight:700; letter-spacing:0.5px;">检测中</span>
                        </div>
                        <div class="mg-row">
                            <div style="display:flex; align-items:center; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:2px; width:100%; box-sizing:border-box;">
                                <button class="mg-icon-btn" onclick="window.${LH_GLOBAL_API}.adjustTurn(-1)" style="width:30px; height:30px; background:transparent; flex-shrink:0;">
                                    <i class="fa-solid fa-minus"></i>
                                </button>
                                <input type="number" id="mg-inp-turn" class="mg-input num"
                                       style="border:none; background:transparent; text-align:center; flex:1; min-width:0; height:30px; padding:0; box-shadow:none;"
                                       onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.系统状态.幕间回合计数', Number(this.value))">
                                <button class="mg-icon-btn" onclick="window.${LH_GLOBAL_API}.adjustTurn(1)" style="width:30px; height:30px; background:transparent; flex-shrink:0;">
                                    <i class="fa-solid fa-plus"></i>
                                </button>
                            </div>
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr); margin-top:6px;">
                            <button class="mg-btn blue" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.系统状态.幕间回合计数', -999)">
                                <i class="fa-solid fa-lock"></i> 锁定和平
                            </button>
                            <button class="mg-btn pink" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.系统状态.幕间回合计数', 10)">
                                <i class="fa-solid fa-angles-right"></i> 立即推进
                            </button>
                        </div>
                    </div>

                    <!-- 事件队列 -->
                    <div class="mg-card">
                        <div class="mg-card-title has-tt"
                             data-tt-t="事件队列"
                             data-tt-d="系统待处理事件列表。\n点击 × 可手动移除，或使用下方按钮一键清空。">
                            <span><i class="fa-solid fa-list-check"></i> 事件队列</span>
                            <i class="fa-solid fa-rotate-right" style="cursor:pointer; opacity:0.6;" onclick="window.${LH_GLOBAL_API}.render()" title="刷新"></i>
                        </div>
                        <div id="mg-event-list-container" class="mg-event-list"></div>
                        <button class="mg-btn gray" style="width:100%; margin-top:6px; font-size:10.5px; padding:5px;"
                                onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.系统状态.待处理事件', {})">
                            清空所有待处理事件
                        </button>
                    </div>
                </div>

                <!-- ═══ Tab 2: 状态 ═══ -->
                <div class="mg-pane" id="lh-pane-stats">

                    <!-- 核心数值 -->
                    <div class="mg-card accent-purple">
                        <div class="mg-card-title"><span><i class="fa-solid fa-sliders"></i> 核心数值</span></div>
                        <div class="mg-row">
                            <span class="label">体力 HP</span>
                            <input type="number" id="mg-inp-hp" class="mg-input num" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.体力值.当前', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.体力值.当前', -10, 'add')">-10</button>
                                <button class="mg-mini-btn green" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.体力值.当前', 999)">满</button>
                            </div>
                        </div>
                        <div class="mg-row">
                            <span class="label">能量 MP</span>
                            <input type="number" id="mg-inp-mp" class="mg-input num" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.能量值.当前', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.能量值.当前', -10, 'add')">-10</button>
                                <button class="mg-mini-btn blue" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.能量值.当前', 999)">满</button>
                            </div>
                        </div>
                        <div class="mg-row">
                            <span class="label" style="color:var(--mg-pink);">快感值</span>
                            <input type="number" id="mg-inp-pleasure" class="mg-input num" style="color:var(--mg-pink); border-color:var(--mg-pink);" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.快感值', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.快感值', -50, 'add')">-50</button>
                                <button class="mg-mini-btn pink" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.快感值', 9999)">崩坏</button>
                            </div>
                        </div>
                        <div class="mg-row">
                            <span class="label" style="color:var(--mg-purple);">侵蚀度</span>
                            <input type="number" id="mg-inp-corruption" class="mg-input num" style="color:var(--mg-purple); border-color:var(--mg-purple);" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.侵蚀度', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.侵蚀度', -10, 'add')">-10</button>
                                <button class="mg-mini-btn purple" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.快感状态.侵蚀度', 0)">净化</button>
                            </div>
                        </div>
                    </div>

                    <!-- 必杀技充能 -->
                    <div class="mg-card accent-gold">
                        <div class="mg-card-title gold"><span><i class="fa-solid fa-bolt"></i> 必杀技充能</span></div>
                        <div class="mg-row">
                            <span class="label" style="color:var(--mg-gold);">正义充能</span>
                            <input type="number" id="mg-inp-purification" class="mg-input num" style="color:var(--mg-gold); border-color:var(--mg-gold);" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.正义充能', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.正义充能', -20, 'add')">-20</button>
                                <button class="mg-mini-btn gold" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.正义充能', 100)">充能</button>
                            </div>
                        </div>
                        <div class="mg-row">
                            <span class="label" style="color:var(--mg-purple);">混沌充能</span>
                            <input type="number" id="mg-inp-corrupt_magic" class="mg-input num" style="color:var(--mg-purple); border-color:var(--mg-purple);" onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.混沌充能', Number(this.value))">
                            <div class="mg-quick">
                                <button class="mg-mini-btn" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.混沌充能', -20, 'add')">-20</button>
                                <button class="mg-mini-btn purple" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.核心状态.混沌充能', 100)">充能</button>
                            </div>
                        </div>
                    </div>

                    <!-- 一键维护 -->
                    <div class="mg-card">
                        <div class="mg-card-title has-tt"
                             data-tt-t="一键维护"
                             data-tt-d="修复衣物：恢复所有身体部位为【完好】\n身体净化：清空精液/异物/恢复能量">
                            <span><i class="fa-solid fa-wand-magic-sparkles"></i> 一键维护</span>
                        </div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr);">
                            <button class="mg-btn blue" onclick="window.${LH_GLOBAL_API}.repairClothing()">
                                <i class="fa-solid fa-shirt"></i> 修复衣物
                            </button>
                            <button class="mg-btn green" onclick="window.${LH_GLOBAL_API}.purifyBody()">
                                <i class="fa-solid fa-shower"></i> 身体净化
                            </button>
                        </div>
                    </div>

                    <!-- 状态速览 -->
                    <div class="mg-card">
                        <div class="mg-card-title"><span><i class="fa-solid fa-eye"></i> 状态速览</span></div>
                        <div class="mg-status-block">
                            <div class="mg-status-row">
                                <span class="k">人格状态</span>
                                <span class="v" id="mg-status-personality">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">着装状态</span>
                                <span class="v" id="mg-status-transformed">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">被俘状态</span>
                                <span class="v" id="mg-status-captured">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">黑暗印记经验</span>
                                <span class="v pink" id="mg-status-curse-xp">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">能量核心精液</span>
                                <span class="v gold" id="mg-status-pregnancy">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">主人</span>
                                <span class="v purple" id="mg-status-master">--</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ═══ Tab 3: 世界 ═══ -->
                <div class="mg-pane" id="lh-pane-world">

                    <!-- 声望控制 -->
                    <div class="mg-card accent-blue">
                        <div class="mg-card-title blue has-tt"
                             data-tt-t="声望控制"
                             data-tt-d="知名度：0-100，越高越被人熟知\n风评：-100~100，正负代表善恶倾向">
                            <span><i class="fa-solid fa-users"></i> 声望控制</span>
                        </div>
                        <div class="mg-row">
                            <span class="label" style="width:60px; flex:0 0 60px;">知名度</span>
                            <input type="range" class="mg-range" min="0" max="100" step="5" id="mg-range-fame"
                                   oninput="document.getElementById('mg-inp-fame').value=this.value"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.名声.知名度', Number(this.value))">
                            <input type="number" id="mg-inp-fame" class="mg-input num mini"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.名声.知名度', Number(this.value))">
                        </div>
                        <div class="mg-row">
                            <span class="label" style="width:60px; flex:0 0 60px;">风评</span>
                            <input type="range" class="mg-range" min="-100" max="100" step="5" id="mg-range-rep"
                                   oninput="document.getElementById('mg-inp-rep').value=this.value"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.名声.风评', Number(this.value))">
                            <input type="number" id="mg-inp-rep" class="mg-input num mini"
                                   onchange="window.${LH_GLOBAL_API}.gmUpdate('stat_data.名声.风评', Number(this.value))">
                        </div>
                        <div class="mg-status-block" style="margin-top:8px; margin-bottom:0;">
                            <div class="mg-status-row">
                                <span class="k">知名度等级</span>
                                <span class="v blue" id="mg-fame-level">--</span>
                            </div>
                            <div class="mg-status-row">
                                <span class="k">风评等级</span>
                                <span class="v pink" id="mg-rep-level">--</span>
                            </div>
                        </div>
                    </div>

                    <!-- 世界观备注 -->
                    <div class="mg-card accent-purple">
                        <div class="mg-card-title has-tt"
                             data-tt-t="世界观备注"
                             data-tt-d="剧情关键设定的持久化存储。\n支持添加/编辑/删除，AI可读取。">
                            <span><i class="fa-solid fa-book-bookmark"></i> 世界观备注</span>
                            <button class="mg-mini-btn blue" onclick="window.${LH_GLOBAL_API}.toggleNoteEditor()" title="添加新设定">+</button>
                        </div>
                        <div id="mg-note-list" class="mg-note-list"></div>
                        <div id="mg-note-editor" style="display:none; margin-top:8px; background:rgba(0,0,0,0.25); padding:10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                            <div style="font-size:10.5px; color:var(--mg-text-dim); margin-bottom:4px;">主题 (Key)</div>
                            <input type="text" id="mg-new-note-key" class="mg-input" placeholder="例如: 弱点_史莱姆 / 人际关系_小圆" style="margin-bottom:6px;">
                            <div style="font-size:10.5px; color:var(--mg-text-dim); margin-bottom:4px;">内容 (Value)</div>
                            <textarea id="mg-new-note-val" class="mg-input" rows="3" placeholder="输入设定详情..."></textarea>
                            <div class="mg-btn-group" style="margin-top:8px; grid-template-columns: repeat(2, 1fr);">
                                <button class="mg-btn green" onclick="window.${LH_GLOBAL_API}.saveWorldNote()">
                                    <i class="fa-solid fa-save"></i> 保存
                                </button>
                                <button class="mg-btn gray" onclick="window.${LH_GLOBAL_API}.toggleNoteEditor()">取消</button>
                            </div>
                        </div>
                    </div>

                    <!-- 杂项工具 -->
                    <div class="mg-card">
                        <div class="mg-card-title"><span><i class="fa-solid fa-toolbox"></i> 杂项工具</span></div>
                        <div class="mg-btn-group" style="grid-template-columns: repeat(2, 1fr);">
                            <button class="mg-btn gray" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.道具栏', {})">
                                <i class="fa-solid fa-box-open"></i> 清空道具
                            </button>
                            <button class="mg-btn gray" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.记录.总战败次数', 0)">
                                <i class="fa-solid fa-eraser"></i> 重置战败
                            </button>
                            <button class="mg-btn gray" style="grid-column: 1 / -1;" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.主角.黑暗印记.经验', 0)">
                                <i class="fa-solid fa-fire-flame-curved"></i> 重置黑暗印记经验
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>

        <!-- Tooltip 与 Toast -->
        <div id="${LH_TOOLTIP_ID}"></div>
        <div id="mg-toast"></div>
    `;
  hud_doc.body.appendChild(wrapper);
}

/* ══════════════════════════════════════════
   ██ MVU 数据交互
   ══════════════════════════════════════════ */

function broadcastVariableUpdate(statData) {
  const visited = new Set();
  const queue = [hud_win];
  const targets = [];

  while (queue.length > 0) {
    const win = queue.shift();
    if (!win || visited.has(win)) continue;
    visited.add(win);

    try {
      const doc = win.document;
      if (!doc) continue;
      targets.push({ win, doc });

      doc.querySelectorAll("iframe").forEach((f) => {
        try {
          if (f.contentWindow) queue.push(f.contentWindow);
        } catch (e) {}
      });
    } catch (e) {}
  }

  targets.forEach(({ win, doc }) => {
    try {
      const Mvu = win.Mvu;
      if (!Mvu || !Mvu.events || !Mvu.events.VARIABLE_UPDATE_ENDED) return;

      const evt = new CustomEvent(Mvu.events.VARIABLE_UPDATE_ENDED, {
        detail: { stat_data: statData },
        bubbles: true,
      });
      doc.dispatchEvent(evt);
    } catch (e) {}
  });
}

async function gmUpdate(path, value, mode = "set") {
  try {
    const Mvu = getMvuInstance();
    if (!Mvu) return;
    const mvuData = Mvu.getMvuData({ type: "message", message_id: -1 });
    if (!mvuData) return;

    if (typeof _ !== "undefined" && _.set) {
      if (mode === "remove") {
        _.unset(mvuData, path);
      } else if (mode === "add") {
        const old = _.get(mvuData, path) || 0;
        _.set(mvuData, path, Number(old) + Number(value));
      } else {
        _.set(mvuData, path, value);
      }
    }

    const statData = mvuData.stat_data || mvuData;
    const personality = _.get(statData, "主角.核心状态.人格状态", "英雄");
    const isFallen = personality === "反派";

    // 声望派生
    const fame = parseInt(_.get(statData, "名声.知名度", 0), 10) || 0;
    const rep = parseInt(_.get(statData, "名声.风评", 0), 10) || 0;
    _.set(statData, "名声.知名度等级", computeFameLevel(fame));
    _.set(statData, "名声.风评等级", computeRepLevel(rep, isFallen));

    await Mvu.replaceMvuData(mvuData, { type: "message", message_id: -1 });
    const cleanData = JSON.parse(JSON.stringify(statData));

    broadcastVariableUpdate(cleanData);
    _lastStatJson = "";
    render(cleanData);
    setTimeout(render, 60);
  } catch (e) {
    console.error("[MG Console Update]", e);
    showToast("更新失败：" + e.message, "#f7768e", "fa-triangle-exclamation");
  }
}

async function fetchStatData(eventData) {
  let stat = eventData?.stat_data || eventData?.detail?.stat_data;
  if (stat) return stat;

  try {
    const Mvu = getMvuInstance();
    if (!Mvu || typeof Mvu.getMvuData !== "function") return null;

    let wrapper = null;
    try {
      wrapper = Mvu.getMvuData({ type: "message", message_id: -1 });
    } catch (e) {
      try {
        wrapper = Mvu.getMvuData({ type: "message", message_id: 0 });
      } catch (e2) {}
    }

    if (wrapper?.stat_data) return wrapper.stat_data;
    if (wrapper) return wrapper;

    try {
      const stWin = hud_win;
      const ctx = stWin.SillyTavern?.getContext?.();
      if (ctx && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
        const start = Math.max(0, ctx.chat.length - 5);
        for (let i = ctx.chat.length - 1; i >= start; i--) {
          const msg = ctx.chat[i];
          if (!msg || msg.is_user || msg.is_system) continue;
          const floorStat = msg.extra?.stat_data || msg.data?.stat_data;
          if (floorStat) return floorStat;
        }
      }
    } catch (e) {}

    return null;
  } catch (e) {
    console.error("[MG Console Fetch]", e);
    return null;
  }
}

/* ══════════════════════════════════════════
   ██ 渲染主函数
   ══════════════════════════════════════════ */
async function render(eventData) {
  const stat = await fetchStatData(eventData);
  if (!stat) return;

  _currentData = stat;

  const jsonStr = JSON.stringify(stat);
  if (jsonStr === _lastStatJson) return;
  _lastStatJson = jsonStr;

  // 基础信息
  const phase = safeGet(stat, "进程.阶段", "幕间休息");
  const personality = safeGet(stat, "主角.核心状态.人格状态", "英雄");
  const isFallen = personality === "反派";
  const isCaptured = phase === "被捕囚禁";
  const isCombat = ["战斗准备", "战斗回合", "终结回合"].includes(phase);
  const isIntermission = phase === "幕间休息";

  // Header 状态徽章
  setTxt("mg-phase-badge", phase);
  setTxt("mg-current-phase-display", phase);
  setInp("mg-phase-selector", phase);

  // 悬浮球状态
  const orb = hud_doc.getElementById("mg-orb-btn");
  if (orb) {
    orb.className = "mg-orb";
    if (isCaptured) orb.classList.add("mode-captured");
    else if (isCombat) orb.classList.add("mode-combat");
    else if (isFallen) orb.classList.add("mode-fallen");

    const events = safeGet(stat, "系统状态.待处理事件", {});
    const eventCount = Object.keys(events).filter(
      (k) => k !== "$meta" && k !== "$__META_EXTENSIBLE__$",
    ).length;
    if (eventCount > 0) orb.classList.add("has-event");
  }

  // ── 通用数值 ──
  setInp("mg-inp-hp", safeGet(stat, "主角.核心状态.体力值.当前", 0));
  setInp("mg-inp-mp", safeGet(stat, "主角.核心状态.能量值.当前", 0));
  setInp("mg-inp-pleasure", safeGet(stat, "主角.快感状态.快感值", 0));
  setInp("mg-inp-corruption", safeGet(stat, "主角.快感状态.侵蚀度", 0));
  setInp("mg-inp-purification", safeGet(stat, "主角.核心状态.正义充能", 0));
  setInp("mg-inp-corrupt_magic", safeGet(stat, "主角.核心状态.混沌充能", 0));
  // 必杀充能按钮文案随阵营切换
  const btnCharge = hud_doc.getElementById("mg-btn-charge-ult");
  if (btnCharge) {
    btnCharge.innerHTML = isFallen
      ? '<i class="fa-solid fa-bolt"></i> 混沌充能 (Chaos Ultimate)'
      : '<i class="fa-solid fa-bolt"></i> 正义充能 (Justice Ultimate)';
  }

  // ── 主题注入 ──
  const heventName = safeGet(stat, "世界.幕间H事件.名称", "无");
  const isHEventActive = isIntermission && heventName !== "无";
  const themeTarget = isHEventActive
    ? "世界.幕间H事件.核心主题"
    : "世界.当前关卡.核心主题";
  setTxt(
    "mg-theme-target-label",
    isHEventActive ? "Target: 幕间事件" : "Target: 战斗/关卡",
  );

  const themes = safeGet(stat, themeTarget, []);
  const validThemes = Array.isArray(themes)
    ? themes.filter((t) => t !== "$__META_EXTENSIBLE__$")
    : [];
  const themeHtml =
    validThemes.length > 0
      ? validThemes
          .map(
            (t) =>
              `<div class="mg-tag ${isHEventActive ? "h-event" : ""}">${t} <span class="del" onclick="window.${LH_GLOBAL_API}.removeTheme('${themeTarget}', '${t.replace(/'/g, "\\'")}')">×</span></div>`,
          )
          .join("")
      : '<span class="mg-tag-empty">无主题</span>';
  setHtml("mg-theme-tags-container", themeHtml);

  // ── 幕间H事件面板 ──
  const panelHEvent = hud_doc.getElementById("mg-panel-hevent");
  if (panelHEvent) {
    if (isIntermission) {
      panelHEvent.style.display = "block";

      const turnCount =
        parseInt(safeGet(stat, "系统状态.幕间回合计数", 0), 10) || 0;
      const heventCompleted =
        safeGet(stat, "系统状态.幕间事件完成", true) === true;
      const escapeProgress = safeGet(stat, "世界.幕间H事件.逃脱进度", 0);

      const elStatus = hud_doc.getElementById("mg-hevent-status-val");
      const elTheme = hud_doc.getElementById("mg-hevent-theme-val");
      const btnReroll = hud_doc.getElementById("mg-btn-reroll-hevent");
      const btnTrigger = hud_doc.getElementById("mg-btn-trigger-hevent");
      const btnSkip = hud_doc.getElementById("mg-btn-skip-hevent");
      const escapeWrapper = hud_doc.getElementById("mg-hevent-escape-wrapper");

      const hThemes = safeGet(stat, "世界.幕间H事件.核心主题", []);
      const cleanHThemes = Array.isArray(hThemes)
        ? hThemes.filter((t) => t && t !== "$__META_EXTENSIBLE__$")
        : [];

      if (elTheme)
        elTheme.innerText =
          cleanHThemes.length > 0 ? cleanHThemes.join(" / ") : "无";

      if (heventName !== "无") {
        if (escapeWrapper) escapeWrapper.style.display = "block";
        setInp("mg-inp-hevent-escape", escapeProgress);
      } else {
        if (escapeWrapper) escapeWrapper.style.display = "none";
      }

      if (!heventCompleted && heventName === "无") {
        setTxt(
          "mg-hevent-turn-counter",
          `冷却: ${turnCount}/6 ${turnCount >= 6 ? "(Ready!)" : ""}`,
        );
      } else if (!heventCompleted) {
        setTxt("mg-hevent-turn-counter", "(进行中)");
      } else {
        setTxt("mg-hevent-turn-counter", "(休眠)");
      }

      if (heventName !== "无") {
        if (elStatus) {
          elStatus.innerText = `进行中: ${heventName.replace("EVENT：", "")}`;
          elStatus.style.color = "var(--mg-pink)";
        }
        if (btnReroll) {
          btnReroll.disabled = true;
          btnReroll.style.opacity = "0.4";
        }
        if (btnTrigger) {
          btnTrigger.disabled = true;
          btnTrigger.style.opacity = "0.4";
        }
        if (btnSkip) {
          btnSkip.disabled = false;
          btnSkip.style.opacity = "1";
        }
      } else if (!heventCompleted && cleanHThemes.length > 0) {
        if (elStatus) {
          elStatus.innerText = "预锁定 (待AI命名)";
          elStatus.style.color = "var(--mg-gold)";
        }
        if (btnReroll) {
          btnReroll.disabled = false;
          btnReroll.style.opacity = "1";
        }
        if (btnTrigger) {
          btnTrigger.disabled = false;
          btnTrigger.querySelector("span").innerText = "强制开始";
          btnTrigger.style.opacity = "1";
        }
        if (btnSkip) {
          btnSkip.disabled = false;
          btnSkip.style.opacity = "1";
        }
      } else {
        if (elStatus) {
          elStatus.innerText = "空闲";
          elStatus.style.color = "var(--mg-text-dim)";
        }
        if (btnReroll) {
          btnReroll.disabled = false;
          btnReroll.style.opacity = "1";
        }
        if (btnTrigger) {
          btnTrigger.disabled = false;
          btnTrigger.querySelector("span").innerText = "新建H事件";
          btnTrigger.style.opacity = "1";
        }
        if (btnSkip) {
          btnSkip.disabled = true;
          btnSkip.style.opacity = "0.5";
        }
      }
    } else {
      panelHEvent.style.display = "none";
    }
  }

  // ── 威胁雷达 ──
  const panelThreat = hud_doc.getElementById("mg-panel-threat");
  if (panelThreat) {
    if (isIntermission) {
      panelThreat.style.display = "block";

      const turnCount =
        parseInt(safeGet(stat, "系统状态.幕间回合计数", 0), 10) || 0;
      const heventCompleted =
        safeGet(stat, "系统状态.幕间事件完成", true) === true;
      const panelTitleEl = hud_doc.getElementById("mg-threat-panel-title");

      if (isFallen) {
        if (panelTitleEl)
          panelTitleEl.innerHTML =
            '<i class="fa-solid fa-crosshairs"></i> 狩猎雷达';
      } else {
        if (panelTitleEl)
          panelTitleEl.innerHTML =
            '<i class="fa-solid fa-satellite-dish"></i> 威胁雷达';
      }

      if (heventCompleted) {
        setTxt(
          "mg-threat-turn-counter",
          `冷却: ${turnCount}/8 ${turnCount >= 8 ? "(Ready!)" : ""}`,
        );
      } else {
        setTxt("mg-threat-turn-counter", "(等待H事件)");
      }

      const preySelector = hud_doc.getElementById("mg-fallen-prey-selector");
      const targetType = safeGet(stat, "世界.当前关卡.战斗类型", "无");
      const activeColor = isFallen ? "var(--mg-pink)" : "var(--mg-gold)";

      if (preySelector) preySelector.style.display = "flex";
      setTxt(
        "mg-prey-selector-label",
        isFallen ? "🎯 猎物类型:" : "🎯 威胁类型:",
      );

      const btnRandom = hud_doc.getElementById("mg-btn-prey-random");
      const btnMonster = hud_doc.getElementById("mg-btn-prey-monster");
      const btnMG = hud_doc.getElementById("mg-btn-prey-mg");
      const btnHuman = hud_doc.getElementById("mg-btn-prey-human");

      if (btnRandom)
        btnRandom.style.borderColor =
          targetType === "无" || targetType === "随机" ? activeColor : "";
      if (btnMonster)
        btnMonster.style.borderColor = targetType === "魔物" ? activeColor : "";
      if (btnMG)
        btnMG.style.borderColor = targetType === "小英雄" ? activeColor : "";
      if (btnHuman)
        btnHuman.style.borderColor = targetType === "人类" ? activeColor : "";

      const themeArea = hud_doc.getElementById("mg-threat-theme-area");
      if (isFallen && targetType === "小英雄") {
        if (themeArea) themeArea.style.display = "none";
      } else {
        if (themeArea) themeArea.style.display = "block";
        const t_themesRaw = safeGet(stat, "世界.当前关卡.核心主题", []);
        const t_validThemes = Array.isArray(t_themesRaw)
          ? t_themesRaw.filter((t) => t !== "$__META_EXTENSIBLE__$")
          : [];
        const t_mainTheme = t_validThemes[0] || null;
        const t_subTheme = t_validThemes[1] || null;

        setTxt(
          "mg-threat-main-theme",
          t_mainTheme || "🎲 完全随机（生成时从主题池抽取）",
        );
        const subContainer = hud_doc.getElementById("mg-threat-sub-options");
        const subStatus = hud_doc.getElementById("mg-threat-sub-status");

        if (t_subTheme) {
          if (subStatus) {
            subStatus.innerText = "[已锁定]";
            subStatus.style.color = "var(--mg-red)";
          }
          if (subContainer) {
            subContainer.innerHTML = `<div class="mg-tag" style="border-color:var(--mg-red); color:var(--mg-red);">${t_subTheme}</div>`;
          }
        } else if (t_mainTheme) {
          if (subStatus) {
            subStatus.innerText = "[留空交由AI生成]";
            subStatus.style.color = "var(--mg-green)";
          }
          const pool = safeGet(stat, "系统状态.Boss生成主题池", []).filter(
            (t) => t !== "$__META_EXTENSIBLE__$" && t !== t_mainTheme,
          );
          const shuffled = pool.sort(() => 0.5 - Math.random()).slice(0, 8);
          if (subContainer) {
            subContainer.innerHTML = shuffled
              .map(
                (t) =>
                  `<div class="mg-tag clickable" onclick="window.${LH_GLOBAL_API}.lockThreatSubTheme('${t.replace(/'/g, "\\'")}')">${t}</div>`,
              )
              .join("");
          }
        } else {
          if (subStatus) {
            subStatus.innerText = "[一并交由AI生成]";
            subStatus.style.color = "var(--mg-green)";
          }
          if (subContainer) {
            subContainer.innerHTML =
              '<span class="mg-tag-empty">主主题未锁定 → 副主题由 AI 一并发挥</span>';
          }
        }
      }
    } else {
      panelThreat.style.display = "none";
    }
  }

  // ── 战斗仲裁 ──
  const panelCombat = hud_doc.getElementById("mg-panel-combat");
  if (panelCombat) {
    if (isCombat) {
      panelCombat.style.display = "block";
      setTxt(
        "mg-val-boss-name",
        safeGet(stat, "世界.当前关卡.名称", "Unknown"),
      );
      setInp("mg-inp-boss-hp", safeGet(stat, "世界.当前关卡.Boss韧性值", 0));
      setInp("mg-inp-boss-str", safeGet(stat, "世界.当前关卡.Boss基础强度", 0));
    } else {
      panelCombat.style.display = "none";
    }
  }

  // ── 校园催眠控制 ──
  const panelCampus = hud_doc.getElementById("mg-panel-campus-hypno");
  if (panelCampus) {
    if (isIntermission) {
      panelCampus.style.display = "block";
      const isAtSchool =
        safeGet(stat, "世界.校园催眠.主角在校", false) === true;
      const isBroken =
        safeGet(stat, "世界.校园催眠.结界已破除", false) === true;
      const isFullHypno =
        safeGet(stat, "世界.校园催眠.完全催眠阶段", false) === true;
      const hypnoVal = safeGet(stat, "世界.校园催眠.催眠进度", 0);
      const suspVal = safeGet(stat, "世界.校园催眠.疑心度", 0);

      const badge = hud_doc.getElementById("mg-campus-status-badge");
      if (badge) {
        if (isBroken) {
          badge.innerText = "结界已破除";
          badge.style.color = "var(--mg-green)";
          badge.style.background = "rgba(158,206,106,0.15)";
        } else if (isFullHypno) {
          badge.innerText = "完全催眠";
          badge.style.color = "var(--mg-pink)";
          badge.style.background = "rgba(247,118,142,0.15)";
        } else if (isAtSchool) {
          badge.innerText = "在校受训中";
          badge.style.color = "var(--mg-purple)";
          badge.style.background = "rgba(187,154,247,0.15)";
        } else {
          badge.innerText = "离校/日常";
          badge.style.color = "var(--mg-blue)";
          badge.style.background = "rgba(122,162,247,0.15)";
        }
      }

      const btnSchool = hud_doc.getElementById("mg-btn-toggle-school");
      if (btnSchool) {
        btnSchool.innerHTML = isAtSchool
          ? '<i class="fa-solid fa-door-open"></i> <span>放学离校</span>'
          : '<i class="fa-solid fa-school"></i> <span>进入校园</span>';
        btnSchool.className = isAtSchool ? "mg-btn pink" : "mg-btn blue";
      }

      const btnBarrier = hud_doc.getElementById("mg-btn-toggle-barrier");
      if (btnBarrier) {
        btnBarrier.innerHTML = isBroken
          ? '<i class="fa-solid fa-rotate-left"></i> <span>重建结界</span>'
          : '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>破除结界</span>';
        btnBarrier.className = isBroken ? "mg-btn purple" : "mg-btn green";
      }

      setInp("mg-inp-hypno", hypnoVal);
      setInp("mg-range-hypno", hypnoVal);
      setInp("mg-inp-susp", suspVal);
      setInp("mg-range-susp", suspVal);
    } else {
      panelCampus.style.display = "none";
    }
  }

  // ── 幕间节奏 ──
  const panelIntermission = hud_doc.getElementById("mg-panel-intermission");
  if (panelIntermission) {
    if (isIntermission) {
      panelIntermission.style.display = "block";
      const turnVal =
        parseInt(safeGet(stat, "系统状态.幕间回合计数", 0), 10) || 0;
      const heventCompletedVal = safeGet(stat, "系统状态.幕间事件完成", true);
      const isEventCompleted =
        heventCompletedVal === true || String(heventCompletedVal) === "true";

      setInp("mg-inp-turn", turnVal);
      updateTurnBadge(turnVal, isEventCompleted);
    } else {
      panelIntermission.style.display = "none";
    }
  }

  // ── 事件队列 ──
  const events = safeGet(stat, "系统状态.待处理事件", {});
  const eventKeys = Object.keys(events).filter(
    (k) => k !== "$meta" && k !== "$__META_EXTENSIBLE__$",
  );
  const eventListHtml =
    eventKeys.length > 0
      ? eventKeys
          .map(
            (k) =>
              `<div class="mg-event-item">
                <span>${k}</span>
                <i class="fa-solid fa-xmark del" onclick="window.${LH_GLOBAL_API}.gmUpdate('stat_data.系统状态.待处理事件.${k}', null, 'remove')"></i>
            </div>`,
          )
          .join("")
      : '<div class="mg-empty-hint">(无待处理事件)</div>';
  setHtml("mg-event-list-container", eventListHtml);

  // ── 状态速览 ──
  setTxt("mg-status-personality", personality);
  setTxt(
    "mg-status-transformed",
    safeGet(stat, "主角.核心状态.着装状态", false) ? "已着装" : "未着装",
  );
  setTxt("mg-status-captured", isCaptured ? "被俘" : "自由");
  setTxt("mg-status-curse-xp", `${safeGet(stat, "主角.黑暗印记.经验", 0)} XP`);
  const coreSemen = safeGet(
    stat,
    "主角.生理状态.体液与分泌.能量核心内精液.存量",
    0,
  );
  setTxt("mg-status-pregnancy", `${coreSemen} ml`);
  setTxt("mg-status-master", safeGet(stat, "主角.核心状态.主人", "无"));

  // ── 声望 ──
  const fame = parseInt(safeGet(stat, "名声.知名度", 0), 10) || 0;
  const rep = parseInt(safeGet(stat, "名声.风评", 0), 10) || 0;
  setInp("mg-inp-fame", fame);
  setInp("mg-range-fame", fame);
  setInp("mg-inp-rep", rep);
  setInp("mg-range-rep", rep);
  setTxt("mg-fame-level", safeGet(stat, "名声.知名度等级", "默默无闻"));
  setTxt("mg-rep-level", safeGet(stat, "名声.风评等级", "籍籍无名"));

  // ── 世界观备注 ──
  renderWorldNotes(stat);
}

function updateTurnBadge(turnVal, isEventCompleted) {
  const badge = hud_doc.getElementById("mg-turn-status-badge");
  if (!badge) return;

  if (turnVal === -999) {
    badge.innerText = "🔒 和平";
    badge.style.color = "#7aa2f7";
    badge.style.background = "rgba(122,162,247,0.12)";
    badge.style.border = "1px solid rgba(122,162,247,0.3)";
  } else if (!isEventCompleted) {
    if (turnVal >= 6) {
      badge.innerText = "💗 H事件就绪";
      badge.style.color = "#f7768e";
      badge.style.background = "rgba(247,118,142,0.12)";
      badge.style.border = "1px solid rgba(247,118,142,0.3)";
    } else {
      badge.innerText = `🧭 日常 (${turnVal}/6T)`;
      badge.style.color = "#a9b1d6";
      badge.style.background = "rgba(255,255,255,0.03)";
      badge.style.border = "1px solid rgba(255,255,255,0.08)";
    }
  } else {
    if (turnVal >= 8) {
      badge.innerText = "⚠️ BOSS就绪";
      badge.style.color = "#e0af68";
      badge.style.background = "rgba(224,175,104,0.12)";
      badge.style.border = "1px solid rgba(224,175,104,0.3)";
    } else {
      badge.innerText = `🧭 日常 (${turnVal}/8T)`;
      badge.style.color = "#a9b1d6";
      badge.style.background = "rgba(255,255,255,0.03)";
      badge.style.border = "1px solid rgba(255,255,255,0.08)";
    }
  }
}

function renderWorldNotes(stat) {
  const notes = safeGet(stat, "世界.世界观备注", {});
  const container = hud_doc.getElementById("mg-note-list");
  if (!container) return;

  const entries = Object.entries(notes).filter(
    ([k]) => k !== "$meta" && k !== "$__META_EXTENSIBLE__$",
  );

  if (entries.length === 0) {
    container.innerHTML = '<div class="mg-empty-hint">暂无特殊设定</div>';
    return;
  }

  container.innerHTML = entries
    .map(
      ([k, v]) => `
        <div class="mg-note-item">
            <span class="mg-note-key">${k}</span>
            <div class="mg-note-val">${String(v).replace(/</g, "&lt;")}</div>
            <div class="mg-note-actions">
                <button class="mg-note-btn edit" onclick="window.${LH_GLOBAL_API}.editNote('${k.replace(/'/g, "\\'")}')" title="编辑">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="mg-note-btn del" onclick="window.${LH_GLOBAL_API}.deleteWorldNote('${k.replace(/'/g, "\\'")}')" title="删除">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    `,
    )
    .join("");
}

/* ══════════════════════════════════════════
   ██ Tooltip
   ══════════════════════════════════════════ */
let _ttTarget = null;
function showTooltip(el) {
  const box = hud_doc.getElementById(LH_TOOLTIP_ID);
  if (!box || !el) return;
  const t = el.getAttribute("data-tt-t");
  const d = el.getAttribute("data-tt-d");
  if (!t || !d) return;

  box.className = "active";
  box.innerHTML = `<div class="tt-t">${t}</div><div class="tt-d">${d}</div>`;

  const rect = el.getBoundingClientRect();
  const ww = hud_win.innerWidth;
  const wh = hud_win.innerHeight;

  box.style.top = "-9999px";
  box.style.left = "-9999px";
  const ttW = box.offsetWidth || 240;
  const ttH = box.offsetHeight || 60;

  let top = rect.top - ttH - 8;
  if (top < 10) top = rect.bottom + 8;
  if (top + ttH > wh - 10) top = Math.max(10, wh - ttH - 10);

  let left = rect.left + rect.width / 2 - ttW / 2;
  if (left < 10) left = 10;
  if (left + ttW > ww - 10) left = ww - ttW - 10;

  box.style.top = top + "px";
  box.style.left = left + "px";
}
function hideTooltip() {
  const box = hud_doc.getElementById(LH_TOOLTIP_ID);
  if (box) box.className = "";
}

/* ══════════════════════════════════════════
   ██ 面板定位（智能随动）
   ══════════════════════════════════════════ */
/* ── 布局模式判定（与 CSS 媒体查询严格对齐） ── */
function isMobileLayout() {
  const w = hud_win.innerWidth || hud_doc.documentElement.clientWidth || 0;
  return w <= 768;
}

function updatePanelPosition() {
  const orb = hud_doc.getElementById("mg-orb-btn");
  const panel = hud_doc.getElementById("mg-panel");
  if (!orb || !panel) return;

  // 移动端全屏模式：清空内联定位，交由 CSS 接管
  // v2.0：额外提升 z-index 以避免被其他悬浮窗遮挡
  if (isMobileLayout()) {
    panel.style.cssText = "";
    panel.style.zIndex = (LH_BASE_Z + 500).toString();
    return;
  }

  const ww = hud_win.innerWidth;
  const wh = hud_win.innerHeight;
  const oLeft = orb.offsetLeft;
  const oTop = orb.offsetTop;
  const oW = orb.offsetWidth;
  const oH = orb.offsetHeight;
  const pW = panel.offsetWidth || 420;
  const gap = 10;

  let pTop = "auto",
    pBottom = "auto",
    pLeft = "auto",
    pRight = "auto";
  let origin = "";
  let maxH = wh - 40;

  // 水平方向
  if (oLeft > ww / 2) {
    const rightDist = ww - (oLeft + oW);
    if (rightDist + pW > ww - gap) {
      pLeft = gap + "px";
      origin += "left";
    } else {
      pRight = rightDist + "px";
      origin += "right";
    }
  } else {
    const leftDist = oLeft;
    if (leftDist + pW > ww - gap) {
      pRight = gap + "px";
      origin += "right";
    } else {
      pLeft = leftDist + "px";
      origin += "left";
    }
  }

  // 垂直方向
  if (oTop > wh / 2) {
    const bottomDist = wh - oTop + gap;
    pBottom = bottomDist + "px";
    origin = "bottom " + origin;
    maxH = wh - bottomDist - gap;
  } else {
    const topDist = oTop + oH + gap;
    pTop = topDist + "px";
    origin = "top " + origin;
    maxH = wh - topDist - gap;
  }

  panel.style.left = pLeft;
  panel.style.right = pRight;
  panel.style.top = pTop;
  panel.style.bottom = pBottom;
  panel.style.maxHeight = Math.max(300, maxH) + "px";
  panel.style.transformOrigin = origin;
}

/* ══════════════════════════════════════════
   ██ 交互绑定（v2.0：Pointer Capture 拖拽）
   ══════════════════════════════════════════ */
function setupInteraction() {
  const wrap = hud_doc.getElementById(LH_HUD_ID);
  if (!wrap) return;
  const orb = hud_doc.getElementById("mg-orb-btn");
  if (!orb) return;

  let isDragging = false;
  let startX, startY, startLeft, startTop;
  let dragRAF = null;
  let justMoved = false;

  /* ── 通用：将球钳制在视口内（动态尺寸） ── */
  const clampOrb = (x, y) => {
    const size = orb.offsetWidth || 52;
    const margin = 4;
    const maxX = Math.max(margin, hud_win.innerWidth - size - margin);
    const maxY = Math.max(margin, hud_win.innerHeight - size - margin);
    const nx = Math.max(margin, Math.min(x, maxX));
    const ny = Math.max(margin, Math.min(y, maxY));
    orb.style.transition = "none";
    orb.style.left = nx + "px";
    orb.style.top = ny + "px";
    orb.style.right = "auto";
    orb.style.bottom = "auto";
    requestAnimationFrame(() => {
      orb.style.transition =
        "transform 0.2s, box-shadow 0.3s, border-color 0.3s";
    });
  };

  const updateOrbPos = (x, y) => {
    const size = orb.offsetWidth || 52;
    const margin = 4;
    const maxX = Math.max(margin, hud_win.innerWidth - size - margin);
    const maxY = Math.max(margin, hud_win.innerHeight - size - margin);
    orb.style.left = Math.max(margin, Math.min(x, maxX)) + "px";
    orb.style.top = Math.max(margin, Math.min(y, maxY)) + "px";
    orb.style.right = "auto";
    orb.style.bottom = "auto";
  };

  // ── 拖拽（v2.0：Pointer Capture + 局部监听）──
  orb.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    isDragging = true;
    justMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = orb.offsetLeft;
    startTop = orb.offsetTop;
    orb.classList.add("is-dragging");
    orb.style.left = startLeft + "px";
    orb.style.top = startTop + "px";
    orb.style.right = "auto";
    orb.style.bottom = "auto";

    // 关键：捕获指针，拖出 iframe 也不丢事件
    try {
      orb.setPointerCapture(e.pointerId);
    } catch (err) {}

    // 局部监听，不再全局注册
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 5)
        justMoved = true;
      if (dragRAF) cancelAnimationFrame(dragRAF);
      dragRAF = requestAnimationFrame(() => {
        updateOrbPos(
          startLeft + (ev.clientX - startX),
          startTop + (ev.clientY - startY),
        );
      });
    };

    const onUp = (ev) => {
      if (!isDragging) return;
      isDragging = false;
      orb.classList.remove("is-dragging");
      try {
        orb.releasePointerCapture(ev.pointerId);
      } catch (err) {}
      orb.removeEventListener("pointermove", onMove);
      orb.removeEventListener("pointerup", onUp);
      orb.removeEventListener("pointercancel", onUp);

      if (justMoved) {
        // 边缘吸附（尺寸动态）
        const ww = hud_win.innerWidth;
        const wh = hud_win.innerHeight;
        const size = orb.offsetWidth || 52;
        const margin = 22;
        const targetLeft =
          orb.offsetLeft + size / 2 > ww / 2
            ? Math.max(margin, ww - size - margin)
            : margin;
        const targetTop = Math.max(16, Math.min(orb.offsetTop, wh - size - 16));

        orb.style.transition = "left 0.3s ease-out, top 0.3s ease-out";
        orb.style.left = targetLeft + "px";
        orb.style.top = targetTop + "px";
        setTimeout(() => {
          orb.style.transition =
            "transform 0.2s, box-shadow 0.3s, border-color 0.3s";
        }, 300);
      } else {
        if (wrap.classList.contains("is-expanded")) {
          wrap.classList.remove("is-expanded");
          hideTooltip();
        } else {
          updatePanelPosition();
          wrap.classList.add("is-expanded");
        }
      }
    };

    orb.addEventListener("pointermove", onMove);
    orb.addEventListener("pointerup", onUp);
    orb.addEventListener("pointercancel", onUp);

    e.preventDefault();
    e.stopPropagation(); // v2.0：阻止事件冒泡到其他悬浮窗
  });

  // ── Tab 切换 ──
  hud_doc.querySelectorAll(`#${LH_HUD_ID} .mg-tab`).forEach((btn) => {
    btn.addEventListener("click", () => {
      hud_doc
        .querySelectorAll(`#${LH_HUD_ID} .mg-tab`)
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      hud_doc
        .querySelectorAll(`#${LH_HUD_ID} .mg-pane`)
        .forEach((p) => p.classList.remove("active"));
      const targetId = btn.getAttribute("data-tab");
      const target = hud_doc.getElementById(targetId);
      if (target) target.classList.add("active");
    });
  });

  // ── Tooltip 触发逻辑：桌面 hover / 触屏 tap ──
  const isCoarse = () => {
    try {
      return hud_win.matchMedia("(pointer: coarse)").matches;
    } catch (e) {
      return false;
    }
  };

  trackListener(wrap, "mouseover", (e) => {
    if (isCoarse()) return;
    const el = e.target.closest ? e.target.closest(".has-tt") : null;
    if (!el) {
      hideTooltip();
      _ttTarget = null;
      return;
    }
    if (el === _ttTarget) return;
    _ttTarget = el;
    showTooltip(el);
  });

  trackListener(wrap, "mouseout", (e) => {
    if (isCoarse()) return;
    const el = e.target.closest ? e.target.closest(".has-tt") : null;
    if (el === _ttTarget) {
      _ttTarget = null;
      hideTooltip();
    }
  });

  // 触屏：点击卡片标题 → 弹出提示，4s 后自动关闭
  trackListener(wrap, "click", (e) => {
    if (!isCoarse()) return;
    // 跳过交互元素
    if (
      e.target.closest &&
      e.target.closest("button, a, [onclick], input, select, textarea")
    )
      return;

    const el = e.target.closest ? e.target.closest(".has-tt") : null;
    if (!el) return;

    const tooltipEl = hud_doc.getElementById(LH_TOOLTIP_ID);
    const isCurrentlyActive =
      _ttTarget === el && tooltipEl && tooltipEl.classList.contains("active");

    if (isCurrentlyActive) {
      hideTooltip();
      _ttTarget = null;
    } else {
      _ttTarget = el;
      showTooltip(el);
      clearTimeout(el._ttTimer);
      el._ttTimer = setTimeout(() => {
        if (_ttTarget === el) {
          hideTooltip();
          _ttTarget = null;
        }
      }, 4000);
    }
  });

  // ── 视口变化：重排 ──
  trackListener(hud_win, "resize", () => {
    clampOrb(orb.offsetLeft, orb.offsetTop);
    if (wrap.classList.contains("is-expanded")) updatePanelPosition();
  });

  // ── 横竖屏切换：延迟重排（等浏览器更新视口） ──
  trackListener(hud_win, "orientationchange", () => {
    setTimeout(() => {
      clampOrb(orb.offsetLeft, orb.offsetTop);
      if (wrap.classList.contains("is-expanded")) updatePanelPosition();
    }, 180);
  });

  // ── 移动端软键盘弹起：tooltip 会被挤到错误位置，直接关闭 ──
  if (hud_win.visualViewport) {
    trackListener(hud_win.visualViewport, "resize", () => {
      hideTooltip();
      _ttTarget = null;
    });
  }
}

/* ══════════════════════════════════════════
   ██ 全局 API（v2.0：私有命名空间）
   ══════════════════════════════════════════ */
const MG_API = {
  // 基础
  close() {
    const wrap = hud_doc.getElementById(LH_HUD_ID);
    if (wrap) wrap.classList.remove("is-expanded");
    hideTooltip();
  },
  render,
  gmUpdate,

  // 快照
  async restoreSnapshot() {
    if (!_gmSnapshot) {
      showToast("无快照可恢复", "#f7768e", "fa-triangle-exclamation");
      return;
    }
    if (!confirm("确定撤销本次打开面板后的所有修改？")) return;
    await gmUpdate("stat_data", _gmSnapshot);
    showToast("已恢复到打开面板时的状态", "#9ece6a", "fa-rotate-left");
  },

  // 主题注入
  async injectTheme() {
    const input = hud_doc.getElementById("mg-new-theme-input");
    const val = input?.value.trim();
    if (!val) return;
    const isHEvent =
      safeGet(_currentData, "进程.阶段") === "幕间休息" &&
      safeGet(_currentData, "世界.幕间H事件.名称", "无") !== "无";
    const targetPath = isHEvent
      ? "stat_data.世界.幕间H事件.核心主题"
      : "stat_data.世界.当前关卡.核心主题";
    const currentRaw = safeGet(
      _currentData,
      targetPath.replace("stat_data.", ""),
      [],
    );
    const arr = Array.isArray(currentRaw) ? currentRaw : [];
    if (!arr.includes(val)) {
      const newArr = arr.filter((x) => x !== "$__META_EXTENSIBLE__$");
      newArr.push(val);
      await gmUpdate(targetPath, newArr);
      input.value = "";
      showToast("已注入：" + val, "#bb9af7", "fa-syringe");
    }
  },

  async removeTheme(rawPath, val) {
    const arr = safeGet(_currentData, rawPath, []);
    const newArr = (Array.isArray(arr) ? arr : []).filter((t) => t !== val);
    await gmUpdate("stat_data." + rawPath, newArr);
  },

  // H事件
  async rerollHEvent() {
    const allKinks = safeGet(_currentData, "主角.快感状态.性癖", {});
    const validKinks = Object.keys(allKinks).filter((k) => {
      const v = allKinks[k];
      return (
        k !== "$meta" &&
        k !== "$__META_EXTENSIBLE__$" &&
        v &&
        (v.等级 >= 1 || v.经验 >= 50)
      );
    });
    let newThemes = [];
    if (validKinks.length > 0) {
      const primary = validKinks[Math.floor(Math.random() * validKinks.length)];
      newThemes.push(primary);
      const remaining = validKinks.filter((k) => k !== primary);
      if (remaining.length > 0 && Math.random() > 0.3) {
        newThemes.push(remaining[Math.floor(Math.random() * remaining.length)]);
      }
    } else {
      const basics = ["敏感体质", "羞耻心", "被动"];
      newThemes.push(basics[Math.floor(Math.random() * basics.length)]);
    }
    newThemes.push("$__META_EXTENSIBLE__$");
    await gmUpdate("stat_data.世界.幕间H事件.核心主题", newThemes);
    await gmUpdate("stat_data.世界.幕间H事件.名称", "无");
    await gmUpdate("stat_data.系统状态.幕间事件完成", false);
    showToast("H事件主题已重随", "#e0af68", "fa-shuffle");
  },

  async triggerHEvent() {
    const heventName = safeGet(_currentData, "世界.幕间H事件.名称", "无");
    const heventThemes = safeGet(_currentData, "世界.幕间H事件.核心主题", []);
    const cleanThemes = (
      Array.isArray(heventThemes) ? heventThemes : []
    ).filter((t) => t && t !== "$__META_EXTENSIBLE__$");
    const isPreLocked =
      !safeGet(_currentData, "系统状态.幕间事件完成", true) &&
      heventName === "无" &&
      cleanThemes.length > 0;

    let targetName = "EVENT：强制触发";
    let targetThemes = cleanThemes;

    if (isPreLocked) {
      const proposedName = prompt(
        `预锁定主题: ${cleanThemes.join(" / ")}\n请命名H事件:`,
        "突发遭遇",
      );
      if (!proposedName) return;
      targetName = `EVENT：${proposedName}`;
    } else {
      const promptName = prompt("请输入H事件名称:", "意外事件");
      if (!promptName) return;
      targetName = `EVENT：${promptName}`;
      const promptTheme = prompt(
        "输入核心主题 (逗号分隔):",
        "身体改造,强制露出",
      );
      if (promptTheme) {
        targetThemes = promptTheme
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      } else {
        targetThemes = ["意外遭遇"];
      }
    }
    if (!targetThemes.includes("$__META_EXTENSIBLE__$"))
      targetThemes.push("$__META_EXTENSIBLE__$");
    await gmUpdate("stat_data.世界.幕间H事件.核心主题", targetThemes);
    await gmUpdate("stat_data.世界.幕间H事件.名称", targetName);
    await gmUpdate("stat_data.系统状态.幕间事件完成", false);
    showToast("H事件已启动", "#f7768e", "fa-play");
  },

  async skipHEvent() {
    if (!confirm("确定要强制结算并跳过当前幕间事件吗？")) return;
    await gmUpdate("stat_data.世界.幕间H事件.名称", "无");
    await gmUpdate("stat_data.世界.幕间H事件.核心主题", [
      "$__META_EXTENSIBLE__$",
    ]);
    await gmUpdate("stat_data.系统状态.幕间事件完成", true);
    showToast("已跳过当前事件", "#7aa2f7", "fa-check");
  },

  async adjustHEventEscape(delta) {
    const cur = safeGet(_currentData, "世界.幕间H事件.逃脱进度", 0);
    const target = Math.max(0, Math.min(100, Number(cur) + Number(delta)));
    await this.setHEventEscape(target);
  },

  async setHEventEscape(val) {
    const safeVal = Math.max(0, Math.min(100, Math.round(val)));
    await gmUpdate("stat_data.世界.幕间H事件.逃脱进度", safeVal);
    if (safeVal >= 100) {
      await gmUpdate("stat_data.系统状态.待处理事件.H事件落幕", true);
      showToast("逃脱已就绪（落幕触发）", "#9ece6a", "fa-check");
    } else {
      if (safeGet(_currentData, "系统状态.待处理事件.H事件落幕")) {
        await gmUpdate(
          "stat_data.系统状态.待处理事件.H事件落幕",
          null,
          "remove",
        );
      }
      showToast(`逃脱进度: ${safeVal}%`, "#f7768e", "fa-person-running");
    }
  },

  async finishHEventImmediately() {
    await gmUpdate("stat_data.世界.幕间H事件.逃脱进度", 100);
    await gmUpdate("stat_data.系统状态.待处理事件.H事件落幕", true);
    showToast("已触发 100% 落幕，发送消息即可结算", "#9ece6a", "fa-check");
  },

  // 威胁雷达
  async rerollThreatMainTheme() {
    const pool = safeGet(_currentData, "系统状态.Boss生成主题池", []).filter(
      (t) => t !== "$__META_EXTENSIBLE__$",
    );
    if (pool.length > 0) {
      const newMain = pool[Math.floor(Math.random() * pool.length)];
      await gmUpdate("stat_data.世界.当前关卡.核心主题", [
        newMain,
        "$__META_EXTENSIBLE__$",
      ]);
      showToast("主主题已重随", "#e0af68", "fa-dice");
    }
  },

  async lockThreatSubTheme(theme) {
    const themes = safeGet(_currentData, "世界.当前关卡.核心主题", []).filter(
      (t) => t !== "$__META_EXTENSIBLE__$",
    );
    if (themes.length === 0) {
      showToast(
        "尚未锁定主主题，请先用「重随」或「手动填写」",
        "#f7768e",
        "fa-triangle-exclamation",
      );
      return;
    }
    await gmUpdate("stat_data.世界.当前关卡.核心主题", [
      themes[0],
      theme,
      "$__META_EXTENSIBLE__$",
    ]);
    showToast("副主题已锁定：" + theme, "#bb9af7", "fa-lock");
  },

  async clearThreatSubTheme() {
    const themes = safeGet(_currentData, "世界.当前关卡.核心主题", []).filter(
      (t) => t !== "$__META_EXTENSIBLE__$",
    );
    if (themes.length === 0) {
      showToast(
        "尚未锁定主主题，无需清空副主题",
        "#f7768e",
        "fa-triangle-exclamation",
      );
      return;
    }
    await gmUpdate("stat_data.世界.当前关卡.核心主题", [
      themes[0],
      "$__META_EXTENSIBLE__$",
    ]);
    showToast("副主题已清空", "#7aa2f7", "fa-eraser");
  },

  // 完全随机：清空主/副主题锁定，交由 Boss 生成器从主题池抽取
  async randomizeThreatThemes() {
    await gmUpdate("stat_data.世界.当前关卡.核心主题", [
      "$__META_EXTENSIBLE__$",
    ]);
    const ed = hud_doc.getElementById("mg-threat-theme-editor");
    if (ed) ed.style.display = "none";
    showToast("已解除主题锁定 → 生成时完全随机", "#9ece6a", "fa-shuffle");
  },

  // 手动填写：展开/收起主副主题编辑区，展开时预填当前锁定值
  toggleThreatThemeEditor() {
    const el = hud_doc.getElementById("mg-threat-theme-editor");
    if (!el) return;
    if (el.style.display === "none") {
      const themes = safeGet(_currentData, "世界.当前关卡.核心主题", []).filter(
        (t) => t && t !== "$__META_EXTENSIBLE__$",
      );
      const mainEl = hud_doc.getElementById("mg-threat-main-input");
      const subEl = hud_doc.getElementById("mg-threat-sub-input");
      if (mainEl) mainEl.value = themes[0] || "";
      if (subEl) subEl.value = themes[1] || "";
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  },

  // 手动填写：写入 [主主题, 副主题?, 标记]
  async saveThreatThemes() {
    const mainEl = hud_doc.getElementById("mg-threat-main-input");
    const subEl = hud_doc.getElementById("mg-threat-sub-input");
    const main = (mainEl && mainEl.value ? mainEl.value : "").trim();
    const sub = (subEl && subEl.value ? subEl.value : "").trim();
    if (!main) {
      showToast(
        "主主题不能为空（要完全随机请点「完全随机」）",
        "#f7768e",
        "fa-triangle-exclamation",
      );
      return;
    }
    const arr = [main];
    if (sub) arr.push(sub);
    arr.push("$__META_EXTENSIBLE__$");
    await gmUpdate("stat_data.世界.当前关卡.核心主题", arr);
    const ed = hud_doc.getElementById("mg-threat-theme-editor");
    if (ed) ed.style.display = "none";
    showToast(
      sub
        ? `主题已锁定：${main} / ${sub}`
        : `主主题已锁定：${main}（副主题交AI）`,
      "#e0af68",
      "fa-lock",
    );
  },

  async forceThreatEncounter() {
    await gmUpdate("stat_data.系统状态.幕间回合计数", 10);
    showToast("已强制推进至可遭遇状态", "#f7768e", "fa-forward-fast");
  },

  async lockPreyType(type) {
    await gmUpdate("stat_data.世界.当前关卡.战斗类型", type);
    showToast(
      "已锁定: " + (type === "无" ? "随机" : type),
      "#e0af68",
      "fa-crosshairs",
    );
  },

  // 战斗
  async chargeUltimate() {
    const personality = safeGet(_currentData, "主角.核心状态.人格状态", "英雄");
    const isFallen = personality === "反派";
    const path = isFallen
      ? "stat_data.主角.核心状态.混沌充能"
      : "stat_data.主角.核心状态.正义充能";
    const label = isFallen ? "混沌充能" : "正义充能";

    // 先将另一阵营的充能清零，避免残留数值污染状态栏主题判定
    await gmUpdate(
      isFallen
        ? "stat_data.主角.核心状态.正义充能"
        : "stat_data.主角.核心状态.混沌充能",
      0,
    );
    await gmUpdate(path, 100);
    showToast(`${label} 已充能完毕`, "#e0af68", "fa-bolt");
  },

  adjustTurn(delta) {
    const input = hud_doc.getElementById("mg-inp-turn");
    if (!input) return;
    let val = Number(input.value) || 0;
    if (val === -999) {
      val = 0;
      delta = 0;
    }
    gmUpdate("stat_data.系统状态.幕间回合计数", val + delta);
  },

  // 维护
  async repairClothing() {
    const parts = ["面部", "胸部", "手臂", "腰腹", "臀部", "私处", "腿部"];
    for (const p of parts) {
      await gmUpdate(`stat_data.主角.身体部位状况.${p}`, "完好");
    }
    showToast("衣物已修复", "#7aa2f7", "fa-shirt");
  },

  async purifyBody() {
    await gmUpdate("stat_data.主角.生理状态.体液与分泌.能量核心内精液.存量", 0);
    await gmUpdate(
      "stat_data.主角.生理状态.体液与分泌.能量核心内精液.来源",
      {},
    );
    await gmUpdate("stat_data.主角.生理状态.后穴状态.内部异物", {});
    await gmUpdate("stat_data.主角.生理状态.能量核心内异物.异物列表", {});
    await gmUpdate("stat_data.主角.生理状态.能量核心内异物.当前动态", "无");
    await gmUpdate("stat_data.主角.生理状态.后穴状态.当前状态", "紧闭");
    await gmUpdate("stat_data.主角.生理状态.阴茎状态.当前状态", "疲软");
    await gmUpdate("stat_data.主角.生理状态.当前生理动态", "呼吸平稳");
    showToast("身体已净化", "#9ece6a", "fa-shower");
  },

  // 世界观备注
  toggleNoteEditor() {
    const el = hud_doc.getElementById("mg-note-editor");
    if (!el) return;
    if (el.style.display === "none") {
      el.style.display = "block";
      hud_doc.getElementById("mg-new-note-key").value = "";
      hud_doc.getElementById("mg-new-note-val").value = "";
    } else {
      el.style.display = "none";
    }
  },

  editNote(key) {
    const val = safeGet(_currentData, `世界.世界观备注.${key}`, "");
    const editor = hud_doc.getElementById("mg-note-editor");
    if (editor) editor.style.display = "block";
    const kEl = hud_doc.getElementById("mg-new-note-key");
    const vEl = hud_doc.getElementById("mg-new-note-val");
    if (kEl) kEl.value = key;
    if (vEl) vEl.value = val;
  },

  async saveWorldNote() {
    const k = hud_doc.getElementById("mg-new-note-key")?.value.trim();
    const v = hud_doc.getElementById("mg-new-note-val")?.value.trim();
    if (!k) {
      showToast("主题不能为空", "#f7768e", "fa-triangle-exclamation");
      return;
    }
    await gmUpdate(`stat_data.世界.世界观备注.${k}`, v);
    showToast("已保存: " + k, "#9ece6a", "fa-save");
    const editor = hud_doc.getElementById("mg-note-editor");
    if (editor) editor.style.display = "none";
  },

  async deleteWorldNote(key) {
    if (!confirm(`确定删除关于 [${key}] 的设定吗？`)) return;
    await gmUpdate(`stat_data.世界.世界观备注.${key}`, null, "remove");
    showToast("已删除", "#f7768e", "fa-trash");
  },

  // 校园催眠控制
  async toggleCampusSchool() {
    const cur = safeGet(_currentData, "世界.校园催眠.主角在校", false) === true;
    await gmUpdate("stat_data.世界.校园催眠.主角在校", !cur);
    showToast(
      !cur ? "已进入校园（催眠结界激活）" : "已离开校园（恢复日常）",
      "#bb9af7",
      "fa-school",
    );
  },

  async toggleCampusBarrier() {
    const cur =
      safeGet(_currentData, "世界.校园催眠.结界已破除", false) === true;
    await gmUpdate("stat_data.世界.校园催眠.结界已破除", !cur);
    showToast(
      !cur ? "催眠结界已破除" : "催眠结界已重建",
      "#9ece6a",
      "fa-wand-magic-sparkles",
    );
  },

  async triggerCampusBreakthrough() {
    await gmUpdate("stat_data.世界.校园催眠.疑心度", 100);
    await gmUpdate("stat_data.系统状态.待处理事件.校园催眠识破事件", true);
    showToast("已触发【校园催眠识破事件】", "#f7768e", "fa-bolt");
  },

  async triggerCampusReshape() {
    await gmUpdate("stat_data.世界.校园催眠.催眠进度", 100);
    await gmUpdate("stat_data.世界.校园催眠.完全催眠阶段", true);
    await gmUpdate("stat_data.世界.校园催眠.疑心度", 0);
    await gmUpdate("stat_data.系统状态.待处理事件.校园认知重塑事件", true);
    showToast("已触发【校园认知重塑事件】", "#bb9af7", "fa-brain");
  },

  async triggerCampusRescue() {
    await gmUpdate("stat_data.系统状态.待处理事件.校园外部救援事件", true);
    showToast("已触发【校园外部救援事件】", "#7aa2f7", "fa-shield-halved");
  },
};

// v2.0：挂载到私有全局命名空间
hud_win[LH_GLOBAL_API] = MG_API;
try {
  window[LH_GLOBAL_API] = MG_API;
} catch (e) {}

/* ══════════════════════════════════════════
   ██ 初始化与监听
   ══════════════════════════════════════════ */
function initConsole() {
  if (hud_doc.getElementById(LH_HUD_ID)) return false;

  injectStyles();
  injectHTML();
  setupInteraction();

  // v2.0：悬浮球位置避让
  try {
    const spot = findFreeOrbSpot();
    const orb = hud_doc.getElementById("mg-orb-btn");
    if (orb) {
      orb.style.right = spot.right + "px";
      orb.style.bottom = spot.bottom + "px";
    }
  } catch (e) {}

  // 建立初始快照（用于撤销）
  const trySnapshot = () => {
    const Mvu = getMvuInstance();
    if (!Mvu) {
      trackTimer(trySnapshot, 500);
      return;
    }
    const wrapper = Mvu.getMvuData({ type: "message", message_id: -1 });
    if (wrapper?.stat_data) {
      _gmSnapshot = JSON.parse(JSON.stringify(wrapper.stat_data));
    }
  };
  trySnapshot();

  // MVU 事件监听
  const Mvu = getMvuInstance();
  if (Mvu && Mvu.events) {
    hud_doc.addEventListener(Mvu.events.VARIABLE_UPDATE_ENDED, (e) => {
      if (e.detail && e.detail.stat_data) {
        _lastStatJson = ""; // 强制刷新
        render(e.detail.stat_data);
      }
    });
  }

  // 首次渲染
  trackTimer(() => render(), 300);

  // v2.0：轮询兜底降频（1.5s → 5s）
  // MVU 事件驱动为主，轮询仅作为事件丢失的兜底
  const poll = () => {
    render();
    trackTimer(poll, LH_POLL_INTERVAL);
  };
  trackTimer(poll, LH_POLL_INTERVAL);

  console.log("[MG Console] 悬浮导演控制台 v2.0 已加载");
  return true;
}

function boot() {
  if (getMvuInstance()) {
    initConsole();
  } else {
    trackTimer(boot, 500);
  }
}

// 1. 暴露手动卸载 API，便于调试或外部调用
MG_API.uninstall = cleanup;

// 2. 页面卸载时自动清理
try {
  hud_win.addEventListener("pagehide", cleanup);
  hud_win.addEventListener("beforeunload", cleanup);
  window.addEventListener("pagehide", cleanup);
} catch (e) {}

// 3. 监听 SillyTavern 聊天/角色切换（若事件源可用）
try {
  const stCtx = hud_win.SillyTavern?.getContext?.();
  const evtSrc = stCtx?.eventSource;
  const evtTypes = stCtx?.eventTypes || hud_win.event_types;
  if (evtSrc && evtTypes) {
    const resetEvents = [
      evtTypes.CHAT_CHANGED,
      evtTypes.CHARACTER_CHANGED,
    ].filter(Boolean);

    resetEvents.forEach((evt) => {
      evtSrc.on(evt, () => {
        // 先彻底清理旧的，再延迟重建，等待新环境就绪
        cleanup();
        _handles.listeners.length = 0; // 清空监听追踪，避免累积
        trackTimer(boot, 800);
      });
    });
  }
} catch (e) {}

// 3. 启动
cleanup();
trackTimer(boot, 500);
