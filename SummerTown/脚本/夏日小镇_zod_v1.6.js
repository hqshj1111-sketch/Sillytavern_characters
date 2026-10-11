import { registerMvuSchema } from 'https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

// --- 复用结构定义 ---

// NPC 泛用 Schema (兼容所有角色的位置、心理、动作及经验开发)
const NpcFullSchema = z.object({
  // === 静态身份信息 ===
  身份信息: z.object({
    年龄: z.string().prefault(""),
    身份: z.string().prefault(""),
    儿时印象: z.string().prefault("")
  }).prefault({}),
  // === 外貌与身体 ===
  外貌: z.object({
    脸型与发型: z.string().prefault(""),
    眼睛: z.string().prefault(""),
    皮肤: z.string().prefault("")
  }).prefault({}),
  身体: z.object({
    身高: z.string().prefault(""),
    三围: z.string().prefault(""),
    体态: z.string().prefault(""),
    体毛: z.string().prefault(""),
    性器官描述: z.string().prefault("")
  }).prefault({}),
  着装: z.object({
    居家: z.string().prefault(""),
    外出: z.string().prefault(""),
    泳装: z.string().prefault("")
  }).prefault({}),
  // === 性格与习惯 ===
  性格: z.object({
    外在: z.string().prefault(""),
    内在: z.string().prefault("")
  }).prefault({}),
  爱好: z.array(z.string()).prefault([]),
  日程: z.object({
    上午: z.string().prefault(""),
    下午: z.string().prefault(""),
    晚上: z.string().prefault("")
  }).prefault({}),
  // === 性相关特质 ===
  性特质: z.object({
    阶段1: z.array(z.string()).prefault([]),
    阶段2: z.array(z.string()).prefault([]),
    阶段3: z.array(z.string()).prefault([]),
    阶段4: z.array(z.string()).prefault([])
  }).prefault({}),
  // === 动态状态（原独立变量） ===
  今日完成事项列表: z.array(z.string()).prefault([]),
  当前性别: z.string().prefault("男"),
  当前状态: z.object({
    当前区域: z.string().prefault("未知"),
    当前地点: z.string().prefault("未知"),
    当前生理: z.string().prefault("未知"),
    当前目标: z.string().prefault("未知"),
    当前目标预计用时: z.string().prefault("未知"),
    当前目标开始时间: z.coerce.number().prefault(0),
    当前动作: z.string().prefault("未知"),
    当前动作开始时间: z.coerce.number().prefault(0),
    当前地点开始回合: z.coerce.number().prefault(0)
  }).prefault({}),
  主角关系: z.object({
    亲密度: z.coerce.number().prefault(0),
    情欲度: z.coerce.number().prefault(0),
    当前关系: z.string().prefault("待设定"),
    称谓: z.object({
      阶段1: z.string().prefault("待设定"),
      阶段2: z.string().prefault("待设定"),
      阶段3: z.string().prefault("待设定"),
      阶段4: z.string().prefault("待设定")
    }).prefault({})
  }).prefault({}),
  性经验记录: z.object({
    肉棒童贞状态: z.boolean().optional(),
    小穴童贞状态: z.boolean().optional(),
    后穴童贞状态: z.boolean().optional(),
    口腔开发度: z.coerce.number().prefault(0),
    胸部开发度: z.coerce.number().prefault(0),
    双手开发度: z.coerce.number().prefault(0),
    双足开发度: z.coerce.number().prefault(0),
    肉棒开发度: z.coerce.number().optional(),
    小穴开发度: z.coerce.number().optional(),
    后穴开发度: z.coerce.number().prefault(0)
  }).passthrough().prefault({}),
  看法矩阵: z.object({
    "0-0": z.string().prefault(""),
    "0-1": z.string().prefault(""),
    "0-2": z.string().prefault(""),
    "0-3": z.string().prefault(""),
    "1-0": z.string().prefault(""),
    "1-1": z.string().prefault(""),
    "1-2": z.string().prefault(""),
    "1-3": z.string().prefault(""),
    "2-0": z.string().prefault(""),
    "2-1": z.string().prefault(""),
    "2-2": z.string().prefault(""),
    "2-3": z.string().prefault(""),
    "3-0": z.string().prefault(""),
    "3-1": z.string().prefault(""),
    "3-2": z.string().prefault(""),
    "3-3": z.string().prefault("")
  }).prefault({}),
  秘密发现: z.boolean().prefault(false),
  初次见面: z.boolean().prefault(false)
}).prefault({});

// --- 主 Schema ---

export const Schema = z.object({
  进程: z.object({
    阶段: z.string().prefault("创角阶段"),
    暑假天数: z.coerce.number().prefault(1),
    当日天气: z.string().prefault("晴天"),
    当日气温: z.coerce.number().prefault(32),
    当前回合数: z.coerce.number().prefault(0),
    上一回合结束时间: z.string().prefault("无"),
    当前时间戳: z.coerce.number().prefault(0),
    累积晴天数: z.coerce.number().prefault(1),
    露出直播准备: z.boolean().default(false),
    露出直播进行中: z.boolean().default(false),
    直播间人数: z.coerce.number().default(0),
    直播间热度: z.coerce.number().default(0)
  }).prefault({}),

  系统状态: z.object({
    主角创建完毕: z.boolean().prefault(false),
    特殊事件进行中: z.boolean().prefault(false),
    待处理事件: z.record(
      z.string(), 
      z.union([z.boolean(), z.array(z.string()), z.array(z.array(z.string())), z.string(), z.object({}).passthrough()])
    ).prefault({})
  }).prefault({}),

  特殊事件: z.object({
    名称: z.string().prefault("无"),
    对象: z.array(z.string()).prefault([]),
    类型: z.string().prefault("无"), // 比如：亲密度、情欲度、告白
    主题: z.string().prefault("无"),
    地点: z.string().prefault("无"),
    增长区间: z.string().prefault("无"),
    叙事基调: z.string().prefault("无")
  }).prefault({}),

  主角: z.object({
    基本信息: z.object({
      姓名: z.string().prefault("待设定"),
      年龄: z.coerce.string().prefault("待设定"),
      性格: z.string().prefault("待设定"),
      背景: z.string().prefault("待设定")
    }).prefault({}),

    相貌特征: z.object({
      脸型: z.string().prefault("待设定"),
      五官: z.string().prefault("待设定"),
      发型与发色: z.string().prefault("待设定"),
      眼睛颜色: z.string().prefault("待设定"),
      特殊记号: z.string().prefault("待设定")
    }).prefault({}),

    身材细节: z.object({
      身高: z.string().prefault("待设定"),
      三围: z.string().prefault("待设定"),
      体态: z.string().prefault("待设定"),
      皮肤状态: z.string().prefault("待设定"),
      肌肉线条: z.string().prefault("待设定")
    }).prefault({}),

    性器官特征: z.object({
      后穴形态: z.string().prefault("待设定"),
      乳头形态: z.string().prefault("待设定"),
      阴茎形态: z.string().prefault("待设定"),
      体毛状况: z.string().prefault("待设定")
    }).prefault({}),

    特殊物品栏: z.record(
      z.string(), 
      z.object({
        描述: z.string().prefault(""),
        来源: z.string().prefault("")
      }).passthrough()
    ).prefault({}),

    性经验记录: z.object({
      肉棒童贞状态: z.boolean().prefault(true),
      后穴童贞状态: z.boolean().prefault(true),
      肉棒童贞对象: z.string().prefault("无"),
      后穴童贞对象: z.string().prefault("无"),
      小穴插入性爱次数: z.coerce.number().prefault(0),
      后穴插入性爱次数: z.coerce.number().prefault(0),
      后穴性爱次数: z.coerce.number().prefault(0),
      自慰次数: z.coerce.number().prefault(0),
      主动手交次数: z.coerce.number().prefault(0),
      被动手交次数: z.coerce.number().prefault(0),
      主动足交次数: z.coerce.number().prefault(0),
      被动足交次数: z.coerce.number().prefault(0),
      主动口交次数: z.coerce.number().prefault(0),
      被动口交次数: z.coerce.number().prefault(0),
      被动乳交次数: z.coerce.number().prefault(0),
      野外露出次数: z.coerce.number().prefault(0)
    }).prefault({}),

    当前状态: z.object({
      当前区域: z.string().prefault("待设定"),
      当前地点: z.string().prefault("待设定"),
      当前生理动态: z.string().prefault("待设定"),
      当前着装: z.string().prefault("待设定"),
      当前性行为: z.array(
        z.object({
          对象: z.string().prefault(""),
          行为: z.string().prefault("")
        }).passthrough()
      ).prefault([]),
      快感值: z.coerce.number().prefault(0),
      性欲值: z.coerce.number().prefault(0)
    }).prefault({}),

    露出主播: z.object({
      主播名字: z.string().default("待设定"),
      粉丝数: z.coerce.number().default(0),
      直播次数: z.coerce.number().default(0),
      态度: z.string().default("被意外拉入陌生的世界，站在镜头前不知所措，内心满是迷茫与羞耻。"),
      注册: z.boolean().default(false)
    }).default({}),
  }).prefault({}),

  活动日历: z.array(z.object({
    日期: z.coerce.number(),
    名称: z.string(),
    地点: z.string(),
    描述: z.string(),
    持续时间: z.string()
  })).prefault([]),

  NPC数据: z.record(z.string(), NpcFullSchema).prefault({})

}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});