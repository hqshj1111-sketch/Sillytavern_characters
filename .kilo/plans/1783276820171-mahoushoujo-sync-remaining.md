# LittleHero ← Mahoushoujo v3.1.9 剩余同步计划

## 一、需要修改的文件（共6个）

### 1. 全局阶段广播（小幅修改）
**文件:** `LittleHero/世界书/[系统]_全局阶段广播.txt`
**改动:** `phaseMode` 中 `'巢穴经营/享乐'` → `'组织运作/享乐'`
**理由:** 小英雄男性主题适配

### 2. 综合生理状态监视器（完全重写）
**文件:** `LittleHero/世界书/[描述]_综合生理状态监视器.txt`
**目标:** 采用 Mahoushoujo v3.1.9 的数据组装模式（physicalBlocks/kinkBlocks push+join），但保留 LittleHero 特有模块。

**具体改动：**
- **新增 `getCurseState()`** → 适配为 `getDarkMarkState()`：展示黑暗印记实时战斗效果（发情影响/能量发情/受伤发情），按英雄/反派路线差分描述
- **升级 `getCapacityState()`** → Mahoushoujo 4级细腻描写（极限满溢→坠胀充实→温热沉积→少量残留），适配男性语境（子宫→能量核心，阴道→后穴与能量核心）
- **新增 `getKinkTraits(lv)`** → 采用 Mahoushoujo 分路线4级描述（英雄Lv4:本能烙印 vs 反派Lv4:本能渴求）
- **新增 `daily_narrative_discipline`** → 纯粹日常时提醒AI不要无端发情
- **保留 `getMentalState()`** → LittleHero 独有的心智侵蚀分层
- **删除** `getPregnancyState()` / `getPostpartumState()` → 已删除
- **采用** Mahoushoujo 的 `physicalBlocks/kinkBlocks` push+join 渲染模式
- **采用** Mahoushoujo 的 `hideKinks` 逻辑（含战后处理）

### 3. 最终输出协议（精简为 Mahoushoujo 格式）
**文件:** `LittleHero/世界书/[系统]_最终输出协议.txt`
**目标:** 从 LittleHero 增强版（96行，含3个场景示例）精简为 Mahoushoujo v3.1.9 格式（35行极简协议）。
**改动:** 删除 `master_protocol`/`story`/`UpdateVariable_block`/`examples_library`，改为单一 `variable_output_protocol`，示例路径适配到能量核心内精液/来源。

### 4. 声望系统（精简为 Mahoushoujo 格式）
**文件:** `LittleHero/世界书/[系统]_声望系统.txt`
**目标:** 从 LittleHero 分层YAML格式改为 Mahoushoujo v3.1.9 的平铺 `# 社会声望值及描写指导` 格式，术语适配（魔法少女→小英雄、善良→英雄、堕落→反派）。

### 5. 战斗准备处理器（精简为 Mahoushoujo 格式）
**文件:** `LittleHero/世界书/[系统]_战斗准备处理器.txt`
**目标:** 从 LittleHero 的 `JSON.stringify` 直接输出改为 Mahoushoujo v3.1.9 的 `formatPatchBlock()` 模式，术语适配。

### 6. 性癖明确觉醒（补缺失XP）
**文件:** `LittleHero/世界书/[事件]_性癖明确觉醒.txt`
**改动:** 在 `mandatory_data_sync` 的 `patch_code` 中补充：
```json
{ "op": "delta", "path": "/主角/黑暗印记/经验", "value": 30 }
```
**理由:** Mahoushoujo 版本有淫纹经验+30，LittleHero 缺失黑暗印记经验对应增长。

---

## 二、已确认合格的（无需改动）

- 战斗引擎仲裁结果 ✓
- 黑暗印记高潮修复 ✓
- 战后状态重评估 ✓
- 动态角色卡与世界观 ✓
- 第0楼层状态栏 ✓
- AI人格缩进优化 ✓
- MVU变量处理手册格式 ✓
- 幕间逻辑引擎缩进 ✓
- MVU当前系统变量状态缩进 ✓
- 战斗主题玩法指南 ✓
- 高潮事件 ✓
- 小英雄黑化 vs 魔法少女恶堕 ✓（有意的怪人组织叙事改写）
- 黑化临界处理 ✓
- 内部容量极限 ✓
- 黑暗印记完全系统 ✓
- 着装强制解除 ✓
- 战斗结束 ✓（保留 LittleHero 的怪人组织叙事版）
- 战后声望结算事件 ✓
- 幕间休息恢复事件 ✓
- 能力成长事件 ✓
- 武装升级变化 ✓
- 声望阶级突破 ✓
- 线索整理事件 ✓
- 状态变更_战斗启动 ✓
- 快感反应(英雄/反派) ✓
- 必杀技(终极闪光/暗黑降临) ✓
- BOSS目标生成器 ✓（保留三分池设计）
- 幕间H事件处理器 ✓（保留 LittleHero 设计）
- 叙事风格与滤镜 ✓
- 角色生成细节内容 ✓（已适配YYYYMMDD）
- 辅助输出__玩家选项生成 ✓（已适配）
- 敌方设计优化 ✓
- zod脚本 ✓
- MVU监控器 ✓
- 正则文件 ✓
- index.yaml版本号 ✓（已改为1.1 ZOD）

---

## 三、不变原则（重申）

- 所有男性化术语不受影响
- 删除的使魔/受孕/产后系统不受影响
- 怪人组织的叙事特色（黑化事件、败北叙事）保留
- BOSS主题池三分结构保留
