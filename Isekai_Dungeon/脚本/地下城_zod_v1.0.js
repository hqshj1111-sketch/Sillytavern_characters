import { registerMvuSchema } from 'https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

export const Schema = z.object({
  进程: z.object({
    阶段: z.string().prefault("创角阶段"),
    当前年份: z.coerce.number().prefault(384),
    当前月份: z.coerce.number().prefault(10),
    当前日份: z.coerce.number().prefault(15),
    当前时间段: z.string().prefault("早"),
    当前回合数: z.coerce.number().prefault(0)
  }).prefault({}),

  系统状态: z.object({
    主角创建完毕: z.boolean().prefault(false),
    待处理事件: z.record(
      z.string(),
      z.union([z.boolean(), z.array(z.string()), z.array(z.array(z.string())), z.string(), z.object({}).passthrough()])
    ).prefault({})
  }).prefault({}),

  大型事件: z.object({
    进行中: z.boolean().prefault(false),
    名称: z.string().prefault(""),
    已知线索: z.array(z.string()).prefault([]),
    真相: z.string().prefault(""),
    真相揭露: z.boolean().prefault(false),
    开始回合: z.coerce.number().prefault(0),
  }).prefault({}),

  大陆动态: z.object({
    龙脊联邦: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
    霜境王国: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
    密林双廷: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
    原野同盟: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
    金沙帝国: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
    潮汐联邦: z.array(z.object({ 年月: z.string(), 大事: z.array(z.string()) }).passthrough()).prefault([]),
  }).prefault({}),

  战斗状态: z.object({
    是否战斗中: z.boolean().prefault(false),
    是否战斗结算中: z.boolean().prefault(false),
    敌方名称: z.string().prefault(""),
    敌方种族: z.string().prefault(""),
    敌方等级: z.coerce.number().prefault(1),
    敌方数量: z.coerce.number().prefault(1),
    敌方HP: z.coerce.number().prefault(100),
    敌方最大HP: z.coerce.number().prefault(100),
    敌方攻击力: z.coerce.number().prefault(50),
    敌方防御力: z.coerce.number().prefault(50),
    敌方技能: z.array(z.string()).prefault([]),
    敌方buff: z.record(z.string(), z.unknown()).prefault({}),
    敌方debuff: z.record(z.string(), z.unknown()).prefault({})
  }).prefault({}),

  地下城攻略状态: z.object({
    是否准备完毕: z.boolean().prefault(false),
    是否休整中: z.boolean().prefault(false),
    是否攻略结算中: z.boolean().prefault(false),
    是否攻略败北中: z.boolean().prefault(false),
    当前地下城名称: z.string().prefault(""),
    当前所在层数: z.coerce.number().prefault(0),
    本层进度: z.coerce.number().prefault(0),
    本次攻略击杀数: z.coerce.number().prefault(0),
    本次攻略获得金币: z.coerce.number().prefault(0),
    本次攻略获得素材: z.record(z.string(), z.coerce.number()).prefault({}),
    本次攻略开始日期: z.string().prefault(""),
    本次攻略结束日期: z.string().prefault("")
  }).prefault({}),

  任务状态: z.object({
    是否任务进行中: z.boolean().prefault(false),
    任务列表: z.record(
      z.string(),
      z.object({
        任务内容: z.string().prefault(""),
        任务奖励: z.string().prefault(""),
        是否完成: z.boolean().prefault(false)
      })
    ).prefault({})
  }).prefault({}),

  地下城信息: z.record(
    z.string(),
    z.object({
      地下城描述: z.string().prefault(""),
      地下城等级: z.string().prefault(""),
      所在国家: z.string().prefault(""),
      所在城市: z.string().prefault(""),
      所在地点: z.string().prefault(""),
      boss名称: z.string().prefault(""),
      boss描述: z.string().prefault(""),
      总层数: z.coerce.number().prefault(0),
      每层区域类型: z.array(z.string()).prefault([]),
      每层区域描述: z.array(z.string()).prefault([]),
      每层区域危险等级: z.array(z.coerce.number()).prefault([]),
      被他人攻略次数: z.coerce.number().prefault(15),
      被主角攻略次数: z.coerce.number().prefault(0),
      被主角攻略失败次数: z.coerce.number().prefault(0)
    })
  ).prefault({}),

  队友信息: z.record(
    z.string(),
    z.object({
      最大HP: z.coerce.number().prefault(100),
      最大MP: z.coerce.number().prefault(50),
      最大SP: z.coerce.number().prefault(100),
      当前HP: z.coerce.number().prefault(100),
      当前MP: z.coerce.number().prefault(50),
      当前SP: z.coerce.number().prefault(100),
      当前buff: z.record(z.string(), z.unknown()).prefault({}),
      当前debuff: z.record(z.string(), z.unknown()).prefault({}),
      攻击力: z.coerce.number().prefault(10),
      防御力: z.coerce.number().prefault(5),
      速度: z.coerce.number().prefault(10),
      魔力: z.coerce.number().prefault(5),
      意志: z.coerce.number().prefault(5),
      幸运: z.coerce.number().prefault(5),
      装备: z.object({
        武器: z.string().prefault(""),
        护甲: z.string().prefault(""),
        饰品: z.string().prefault("")
      }).prefault({})
    })
  ).prefault({}),

  商城信息: z.object({
    是否购物中: z.boolean().prefault(false),
    商品列表: z.array(z.object({
      商品名称: z.string().prefault(""),
      商品类型: z.string().prefault(""),
      商品描述: z.string().prefault(""),
      商品属性: z.array(z.string()).prefault([]),
      商品对应增幅: z.array(z.string()).prefault([]),
      商品价格: z.coerce.number().prefault(0)
    })).prefault([])
  }).prefault({}),

  地理信息: z.record(
    z.string(),
    z.object({
      自然环境: z.string().prefault(""),
      社会结构: z.string().prefault(""),
      种族构成: z.string().prefault(""),
      公会名称: z.string().prefault(""),
      公会风格: z.string().prefault(""),
      简述: z.string().prefault(""),
      城市列表: z.record(
        z.string(),
        z.object({
          城市规模: z.string().prefault(""),
          种族构成: z.string().prefault(""),
          自然环境: z.string().prefault(""),
          整体氛围: z.object({
            春: z.string().prefault(""),
            夏: z.string().prefault(""),
            秋: z.string().prefault(""),
            冬: z.string().prefault("")
          }).prefault({}),
          简述: z.string().prefault(""),
          地点列表: z.record(
            z.string(),
            z.object({
              是否城内: z.boolean().prefault(true),
              方位: z.string().prefault(""),
              简述: z.string().prefault("")
            })
          ).prefault({})
        })
      ).prefault({})
    })
  ).prefault({}),

  主角: z.object({
     基本信息: z.object({
       姓名: z.string().prefault("待设定"),
       年龄: z.string().prefault("待设定"),
       种族: z.string().prefault("待设定"),
       身份: z.string().prefault("待设定"),
       性别: z.string().prefault("待设定"),
       职业: z.string().prefault("待设定"),
       性格: z.string().prefault("待设定"),
       故乡国家: z.string().prefault("待设定"),
       故乡城市: z.string().prefault("待设定")
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
      肌肉线条: z.string().prefault("待设定"),
      体毛状况: z.string().prefault("待设定")
    }).prefault({}),

    性器官特征: z.object({
      后穴形态: z.string().prefault("待设定"),
      小穴形态: z.string().prefault("待设定"),
      胸部形态: z.string().prefault("待设定"),
      乳头形态: z.string().prefault("待设定"),
      阴茎形态: z.string().prefault("待设定")
    }).prefault({}),

    当前状态: z.object({
      当前国家: z.string().prefault("待设定"),
      当前城市: z.string().prefault("待设定"),
      当前地点: z.string().prefault("待设定"),
      当前生理状态: z.string().prefault("体力充沛，精神饱满"),
      当前着装: z.string().prefault("待设定"),
      当前buff: z.record(z.string(), z.unknown()).prefault({}),
      当前debuff: z.record(z.string(), z.unknown()).prefault({}),
      当前HP: z.coerce.number().prefault(100),
      当前MP: z.coerce.number().prefault(50),
      当前SP: z.coerce.number().prefault(100),
      等级: z.coerce.number().prefault(1),
      经验值: z.coerce.number().prefault(0),
      金币: z.coerce.number().prefault(0)
    }).prefault({}),

    装备: z.object({
      武器: z.object({
        名称: z.string().prefault("待设定"),
        描述: z.string().prefault("待设定"),
        属性: z.array(z.string()).prefault([]),
        对应增幅: z.array(z.string()).prefault([])
      }).prefault({}),
      护甲: z.object({
        名称: z.string().prefault("待设定"),
        描述: z.string().prefault("待设定"),
        属性: z.array(z.string()).prefault([]),
        对应增幅: z.array(z.string()).prefault([])
      }).prefault({}),
      饰品: z.object({
        名称: z.string().prefault("待设定"),
        描述: z.string().prefault("待设定"),
        属性: z.array(z.string()).prefault([]),
        对应增幅: z.array(z.string()).prefault([])
      }).prefault({})
    }).prefault({}),

    特殊装备: z.array(z.string()).prefault([]),
    触手紧身衣穿戴日期: z.string().prefault(""),
    总高潮次数: z.coerce.number().prefault(0),
    影子分身获得日期: z.string().prefault(""),
    影子分身名字: z.string().prefault(""),
    影子分身性格: z.string().prefault(""),
    奴隶淫纹烙印日期: z.string().prefault(""),
    主角的主人: z.string().prefault(""),
     奴隶称呼: z.string().prefault(""),
     淫纹外观: z.string().prefault(""),
    伴侣列表: z.array(z.string()).prefault([]),
     历史纪要: z.array(z.object({
       日期: z.string(),
       事件: z.string()
     }).passthrough()).prefault([]),
     战斗纪要: z.array(z.object({
       阵营: z.string(),
       角色名: z.string(),
       类型: z.string(),
       旧值: z.union([z.string(), z.number()]),
       新值: z.union([z.string(), z.number()])
     }).passthrough()).prefault([]),
     房产: z.record(z.string(), z.object({
       所在国家: z.string(),
       所在城市: z.string(),
       简述: z.string()
     }).passthrough()).prefault({}),
    人格同化面具激活次数: z.coerce.number().prefault(0),
    认知扭曲目镜激活次数: z.coerce.number().prefault(0),
    同化胶核获得日期: z.string().prefault(""),

    战斗属性: z.object({
      最大HP: z.coerce.number().prefault(100),
      最大MP: z.coerce.number().prefault(50),
      最大SP: z.coerce.number().prefault(100),
      攻击力: z.coerce.number().prefault(10),
      防御力: z.coerce.number().prefault(5),
      速度: z.coerce.number().prefault(10),
      魔力: z.coerce.number().prefault(5),
      意志: z.coerce.number().prefault(5),
      幸运: z.coerce.number().prefault(5)
    }).prefault({}),

     冒险者信息: z.object({
       冒险者等级: z.string().prefault("F"),
       冒险者称号: z.string().prefault("新人冒险者"),
       知名度: z.coerce.number().prefault(0),
       升阶次数: z.coerce.number().prefault(0),
       所属公会: z.string().prefault(""),
       完成任务数: z.coerce.number().prefault(0),
       讨伐怪物总数: z.coerce.number().prefault(0),
       攻略地下城总数: z.coerce.number().prefault(0),
       公会评价: z.string().prefault("初出茅庐的新人，尚未建立任何功绩。"),
       攻略记录列表: z.array(z.object({
          地下城名称: z.string().prefault(""),
          开始日期: z.string().prefault(""),
          结束日期: z.string().prefault(""),
          击杀数: z.coerce.number().prefault(0),
          获得金币: z.coerce.number().prefault(0),
          攻略结果: z.string().prefault(""),
          队友名字列表: z.array(z.string()).prefault([])
        })).prefault([])
     }).prefault({}),

    技能列表: z.array(z.object({
      技能名称: z.string().prefault(""),
      技能描述: z.string().prefault(""),
      技能类型: z.string().prefault(""),
      技能倍率: z.coerce.number().prefault(0),
      技能属性: z.string().prefault(""),
      技能增幅: z.string().prefault("")
    })).prefault([]),

    道具栏: z.record(
      z.string(),
      z.object({
        类型: z.string().prefault(""),
        数量: z.coerce.number().prefault(0),
        描述: z.string().prefault("")
      })
    ).prefault({})
  }).prefault({}),

  一般NPC信息: z.record(
    z.string(),
    z.object({
      种族: z.string().prefault(""),
      性别: z.string().prefault(""),
      年龄: z.string().prefault(""),
      故乡国家: z.string().prefault(""),
      故乡城市: z.string().prefault(""),
      所在国家: z.string().prefault(""),
      所在城市: z.string().prefault(""),
      活动范围: z.string().prefault(""),
      位置更新日期: z.string().prefault(""),
      简述: z.string().prefault(""),
      是否胶兽: z.boolean().prefault(false)
    }).passthrough()
  ).prefault({}),

  重要NPC信息: z.record(
    z.string(),
    z.object({
      种族: z.string().prefault(""),
      性别: z.string().prefault(""),
      年龄: z.string().prefault(""),
      故乡国家: z.string().prefault(""),
      故乡城市: z.string().prefault(""),
      所在国家: z.string().prefault(""),
      所在城市: z.string().prefault(""),
      身份: z.string().prefault(""),
      职业: z.string().prefault(""),
      所属公会: z.string().prefault(""),
      冒险者等级: z.string().prefault(""),
      冒险者称号: z.string().prefault(""),
      外观: z.string().prefault(""),
      性格: z.string().prefault(""),
      身材: z.string().prefault(""),
      位置更新日期: z.string().prefault(""),
      最近互动日期: z.string().prefault(""),
      最近互动地点: z.string().prefault(""),
      最近互动事项: z.string().prefault(""),
      活动范围: z.string().prefault(""),
      简述: z.string().prefault(""),
      好感度: z.coerce.number().prefault(0),
      关系: z.string().prefault(""),
      最近升阶日期: z.string().prefault(""),
      是否胶兽: z.boolean().prefault(false)
    }).passthrough()
  ).prefault({})

}).prefault({});

$(() => {
  registerMvuSchema(Schema);
});
