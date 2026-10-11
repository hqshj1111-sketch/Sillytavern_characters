import { registerMvuSchema } from 'https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

const BarSchema = z.object({
  当前: z.coerce.number().prefault(100),
  最大: z.coerce.number().prefault(100)
}).prefault({});


export const Schema = z.object({
  进程: z
    .object({
      阶段: z.string().prefault("创角阶段"),
      当前年份: z.coerce.number().prefault(2087),
      当前月份: z.coerce.number().prefault(3),
      当前日份: z.coerce.number().prefault(15),
      当前时段: z.string().prefault("晚上"),
      当前天气: z.string().prefault("阴"),
    })
    .prefault({}),

  系统状态: z
    .object({
      主角创建完毕: z.boolean().prefault(false),
      幕间回合计数: z.coerce.number().prefault(0),
      待处理事件: z
        .record(
          z.string(),
          z.union([z.boolean(), z.string(), z.object({}).passthrough()]),
        )
        .prefault({}),
    })
    .prefault({}),

  擂台状态: z
    .object({
      当前擂台回合数: z.coerce.number().prefault(0),
      最大擂台回合数: z.coerce.number().prefault(20),
      当前进攻方: z.string().prefault("主角"),
      是否休息回合: z.boolean().prefault(false),
      当前性斗日志: z.array(z.string()).prefault([]),
      性斗日期: z.string().prefault(""),
      主角赔率: z.coerce.number().prefault(1.0),
      对手赔率: z.coerce.number().prefault(1.0),
      主角当前人气: z.coerce.number().prefault(0),
      对手当前人气: z.coerce.number().prefault(0),
      对手名字: z.string().prefault(""),
      对手积分: z.coerce.number().prefault(0),
      对手段位: z.string().prefault("公猪"),
      对手性技: z.coerce.number().prefault(0),
      对手忍耐度: z.coerce.number().prefault(0),
      对手当前体力: z.coerce.number().prefault(0),
      对手当前精力: z.coerce.number().prefault(0),
      对手当前快感值: z.coerce.number().prefault(0),
      主角性技: z.coerce.number().prefault(0),
      主角忍耐度: z.coerce.number().prefault(0),
      主角当前体力: z.coerce.number().prefault(0),
      主角当前精力: z.coerce.number().prefault(0),
      主角当前快感值: z.coerce.number().prefault(0),
      主角本场射精次数: z.coerce.number().prefault(0),
      对手本场射精次数: z.coerce.number().prefault(0),
      当前弹幕列表: z.array(z.string()).prefault([]),
      当前擂台叙事: z.string().prefault(""),
     })
    .prefault({}),

  主角: z
    .object({
      基本信息: z
        .object({
          姓名: z.string().prefault("待设定"),
          年龄: z.coerce.string().prefault("待设定"),
          种族: z.string().prefault("待设定"),
          擂台代号: z.string().prefault("待设定"),
          身份: z.string().prefault("待设定"),
          性格特质: z.string().prefault("待设定"),
        })
        .prefault({}),

      相貌特征: z
        .object({
          脸型: z.string().prefault("待设定"),
          五官: z.string().prefault("待设定"),
          发型与发色: z.string().prefault("待设定"),
          眼睛颜色: z.string().prefault("待设定"),
          特殊记号: z.string().prefault("待设定"),
        })
        .prefault({}),

      身材细节: z
        .object({
          身高: z.string().prefault("待设定"),
          三围: z.string().prefault("待设定"),
          体态: z.string().prefault("待设定"),
          皮肤状态: z.string().prefault("待设定"),
          肌肉线条: z.string().prefault("待设定"),
        })
        .prefault({}),

      性器官特征: z
        .object({
          胸部形态: z.string().prefault("待设定"),
          乳头颜色: z.string().prefault("待设定"),
          阴茎形态: z.string().prefault("待设定"),
          后穴形态: z.string().prefault("待设定"),
          体毛状况: z.string().prefault("待设定"),
        })
        .prefault({}),

      性斗数据: z
        .object({
          性技: z.coerce.number().prefault(50),
          忍耐度: z.coerce.number().prefault(50),
          最大体力值: z.coerce.number().prefault(100),
          最大精力值: z.coerce.number().prefault(100),
          快感阈值: z.coerce.number().prefault(100),
        })
        .prefault({}),

      当前生理: z.string().prefault("呼吸平稳"),
      当前穿着: z.string().prefault("待设定"),
      当前区域: z.string().prefault("废街"),
      当前地点: z.string().prefault("出租屋"),

      身体改造: z
        .object({
          已安装: z
            .record(
              z.string(),
              z
                .object({
                  部位: z.string().prefault(""),
                  品质: z.string().prefault("普通"),
                  外观描述: z.string().prefault(""),
                  来源: z.string().prefault(""),
                  性技加成: z.coerce.number().prefault(0),
                  忍耐度加成: z.coerce.number().prefault(0),
                  最大体力值加成: z.coerce.number().prefault(0),
                  最大精力值加成: z.coerce.number().prefault(0),
                  快感阈值加成: z.coerce.number().prefault(0),
                })
                .prefault({}),
            )
            .prefault({}),
          槽位上限: z.coerce.number().prefault(6),
        })
        .prefault({}),

      性行为统计: z
        .object({
          总射精次数: z.coerce.number().prefault(0),
          总接收内射次数: z.coerce.number().prefault(0),
          总内射他人次数: z.coerce.number().prefault(0),
          总口交次数主动: z.coerce.number().prefault(0),
          总口交次数被动: z.coerce.number().prefault(0),
          总手交次数主动: z.coerce.number().prefault(0),
          总手交次数被动: z.coerce.number().prefault(0),
          总插入性交次数: z.coerce.number().prefault(0),
        })
        .prefault({}),

      擂台数据: z
        .object({
          擂台积分: z.coerce.number().prefault(0),
          擂台段位: z.string().prefault("公猪"),
          人气: z.coerce.number().prefault(0),
          战绩: z
            .object({
              胜: z.coerce.number().prefault(0),
              负: z.coerce.number().prefault(0),
              平: z.coerce.number().prefault(0),
            })
            .prefault({}),
        })
        .prefault({}),

      经济: z
        .object({
          信用点: z.coerce.number().prefault(500),
          债务: z.coerce.number().prefault(0),
          债务到期日期: z.string().prefault(""),
          是否催债: z.boolean().prefault(false),
        })
        .prefault({}),

      道具栏: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .prefault({}),

      住所: z
        .object({
          名字: z.string().prefault("出租屋"),
          描述: z
            .string()
            .prefault(
              "一间窄小的胶囊公寓，墙面剥落，闪烁着故障霓虹的窗外是永远喧嚣的废街。",
            ),
          区域: z.string().prefault("废街"),
          地点: z.string().prefault("胶囊公寓群"),
        })
        .prefault({}),
    })
    .prefault({}),

  记录: z
    .object({
      性斗士名录: z
        .record(
          z.string(),
          z.object({
            姓名: z.string().prefault(""),
            擂台代号: z.string().prefault(""),
            擂台积分: z.coerce.number().prefault(0),
            擂台段位: z.string().prefault("公猪"),
            年龄: z.coerce.string().prefault(""),
            身份: z.string().prefault(""),
            种族: z.string().prefault(""),
            性格: z.string().prefault(""),
            外貌: z.string().prefault(""),
            身材: z.string().prefault(""),
            阴茎描述: z.string().prefault(""),
            后穴描述: z.string().prefault(""),
            性斗风格: z.string().prefault(""),
            性行为偏好: z.string().prefault(""),
            性技: z.coerce.number().prefault(0),
            忍耐度: z.coerce.number().prefault(0),
            体力上限: z.coerce.number().prefault(0),
            精力上限: z.coerce.number().prefault(0),
            快感阈值: z.coerce.number().prefault(0),
            身体改造: z.string().prefault(""),
            历史战绩: z
              .object({
                胜: z.coerce.number().prefault(0),
                负: z.coerce.number().prefault(0),
                平: z.coerce.number().prefault(0),
              })
              .prefault({}),
            与主角对战记录: z
              .object({
                胜: z.coerce.number().prefault(0),
                负: z.coerce.number().prefault(0),
                平: z.coerce.number().prefault(0),
              })
              .prefault({}),
            人气: z.coerce.number().prefault(0),
            好感度: z.coerce.number().prefault(0),
            与主角关系: z.string().prefault(""),
          }),
        )
        .prefault({}),
      一般NPC名录: z
        .record(
          z.string(),
          z.object({
            身份描述: z.string().prefault(""),
            种族: z.string().prefault(""),
            年龄: z.coerce.string().prefault(""),
            性格特质: z.string().prefault(""),
            外貌身材: z.string().prefault(""),
            与主角关系: z.string().prefault(""),
            好感度: z.coerce.number().prefault(0),
          }),
        )
        .prefault({}),
      历史性斗记录: z
        .array(
          z.object({
            对手名字: z.string().prefault(""),
            结果: z.string().prefault(""),
            对手段位: z.string().prefault(""),
            性斗日期: z.string().prefault(""),
            赛前积分: z.coerce.number().prefault(0),
            赛后积分: z.coerce.number().prefault(0),
            人气变化: z.coerce.number().prefault(0),
            信用点变化: z.coerce.number().prefault(0),
          }),
        )
        .prefault([]),
    })
    .prefault({}),
});

$(() => {
  registerMvuSchema(Schema);
});
