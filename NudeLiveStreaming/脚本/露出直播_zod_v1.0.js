import { registerMvuSchema } from 'https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  进程: z.object({
    阶段: z.string().prefault("创角阶段"),
    初始年份: z.coerce.number().prefault(2025),
    初始月份: z.coerce.number().prefault(10),
    初始日份: z.coerce.number().prefault(15),
    初始小时: z.coerce.number().prefault(19),
    初始分钟: z.coerce.number().prefault(0),
    当前年份: z.coerce.number().prefault(2025),
    当前月份: z.coerce.number().prefault(10),
    当前日份: z.coerce.number().prefault(15),
    当前小时: z.coerce.number().prefault(19),
    当前分钟: z.coerce.number().prefault(0),
    当前时间戳: z.coerce.number().prefault(0),
    当前天气: z.string().prefault("晴"),
    当前假期: z.string().prefault("否"),
    当前周几: z.coerce.number().prefault(3),
    当前回合数: z.coerce.number().prefault(0),
    事件计数: z.record(z.string(), z.coerce.number().prefault(0)).prefault({})
  }).prefault({}),

  系统状态: z.object({
    主角创建完毕: z.boolean().prefault(false),
    同名事件队列: z.record(z.union([z.boolean(), z.string(), z.array(z.string())])).prefault({}),
    事件等待处理中: z.boolean().prefault(false),
    待处理事件: z.record(
      z.string(), 
      z.union([z.boolean(), z.array(z.string()), z.array(z.array(z.string())), z.string(), z.object({}).passthrough()])
    ).prefault({})
  }).prefault({}),

  直播状态: z.object({
    是否正在直播: z.boolean().prefault(false),
    当前直播间人数: z.coerce.number().prefault(0),
    当前直播间热度: z.coerce.number().prefault(0),
    当次直播高潮次数: z.coerce.number().prefault(0),
    当前直播间标题: z.string().prefault(""),
    当前直播间标签: z.array(z.string()).prefault([]),
    当前直播开始时间戳: z.coerce.number().prefault(0),
    当前直播间弹幕: z.array(z.array(z.string())).prefault([])
  }).prefault({}),

  主角: z.object({
    基本信息: z.object({
      姓名: z.string().prefault("待设定"),
      年龄: z.string().prefault("待设定"),
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

    当前状态: z.object({
      当前区域: z.string().prefault("待设定"),
      当前地点: z.string().prefault("待设定"),
      当前生理状态: z.string().prefault("体温正常，呼吸平稳"),
      当前着装: z.string().prefault("待设定"),
      当前性行为: z.array(z.object({
        对象: z.string().prefault(""),
        性别: z.string().prefault(""),
        部位: z.string().prefault(""),
        行为: z.string().prefault("")
      })).prefault([]),
      当前佩戴: z.record(
        z.string(),
        z.object({
          位置: z.string(),
          描述: z.string()
        })
      ).prefault({}),
      快感值: z.coerce.number().prefault(0),
      性欲值: z.coerce.number().prefault(0),
      羞耻度: z.coerce.number().prefault(100),
      淫乱度: z.coerce.number().prefault(0)
    }).prefault({}),

    性经验记录: z.object({
      与陌生人做爱次数: z.coerce.number().prefault(0),
      总高潮次数: z.coerce.number().prefault(0),
      自慰次数: z.coerce.number().prefault(0),
      情趣玩具使用次数: z.coerce.number().prefault(0),
      主动手交次数: z.coerce.number().prefault(0),
      被动手交次数: z.coerce.number().prefault(0),
      主动足交次数: z.coerce.number().prefault(0),
      被动足交次数: z.coerce.number().prefault(0),
      主动口交次数: z.coerce.number().prefault(0),
      被动口交次数: z.coerce.number().prefault(0),
      被动乳交次数: z.coerce.number().prefault(0),
      小穴插入性爱次数: z.coerce.number().prefault(0),
      后穴插入性爱次数: z.coerce.number().prefault(0),
      后穴性爱次数: z.coerce.number().prefault(0)
    }).prefault({}),

    开发度: z.object({
      口腔开发度: z.coerce.number().prefault(0),
      胸部开发度: z.coerce.number().prefault(0),
      双手开发度: z.coerce.number().prefault(0),
      双足开发度: z.coerce.number().prefault(0),
      肉棒开发度: z.coerce.number().prefault(0),
      后穴开发度: z.coerce.number().prefault(0)
    }).prefault({}),

    主播信息: z.object({
      主播名字: z.string().prefault("待设定"),
      直播总次数: z.coerce.number().prefault(0),
      单次直播最高人数: z.coerce.number().prefault(0),
      单次直播最高高潮次数: z.coerce.number().prefault(0),
      直播点数: z.coerce.number().prefault(0),
      粉丝数: z.coerce.number().prefault(0),
      主播态度: z.string().prefault("对自己露出主播的身份尚无实感，感觉像一场荒诞的梦境。")
    }).prefault({}),

    道具栏: z.object({
      已购道具列表: z.array(z.string()).prefault([])
    }).prefault({})
  }).prefault({}),

  NPC数据: z.record(z.string(), z.object({
    身份信息: z.object({
      年龄: z.string().prefault(""),
      身份: z.string().prefault(""),
      与主角关系: z.string().prefault("")
    }).prefault({}),

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
      日常: z.string().prefault("")
    }).prefault({}),

    性格: z.object({
      外在: z.string().prefault(""),
      内在: z.string().prefault("")
    }).prefault({}),

    爱好: z.string().prefault(""),
    偏好性行为: z.string().prefault(""),
    住处: z.string().prefault(""),
    活跃区域: z.array(z.string()).prefault([]),
    好感度: z.coerce.number().prefault(0),
    淫乱度: z.coerce.number().prefault(0),
    淫乱度阶段: z.object({
      阶段1: z.string().prefault("青涩懵懂，对性事毫无概念。"),
      阶段2: z.string().prefault("初窥门径，开始对肉体产生好奇。"),
      阶段3: z.string().prefault("食髓知味，主动寻求更刺激的体验。"),
      阶段4: z.string().prefault("淫乱入骨，沉溺于肉欲不可自拔。")
    }).prefault({}),
    与主角做爱次数: z.coerce.number().prefault(0),
    秘密察觉程度: z.coerce.number().prefault(0),
    秘密发现: z.boolean().prefault(false),
    主播信息: z.object({
      粉丝数: z.coerce.number().prefault(0),
      主播名字: z.string().prefault("")
    }).prefault({})
      
  }).prefault({})).prefault({})

}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});