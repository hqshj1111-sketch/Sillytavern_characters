import { registerMvuSchema } from "https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js";

// --- 复用结构定义 ---

// 恶堕状态（每个小英雄的核心推进轴）
const 恶堕状态Schema = z
  .object({
    气味沉溺度: z.coerce.number().prefault(0),
    气味沉溺阶段: z
      .enum(["无感", "好奇", "渴望", "上瘾", "沉迷", "臣服"])
      .prefault("无感"),
    欲望之泥污染度: z.coerce.number().prefault(0),
    阵营归属: z.enum(["正义", "内应", "彻底恶堕"]).prefault("正义"),
  })
  .prefault({});

// 对怪人主角的关系（含身份认知枚举）
const 对怪人主角关系Schema = z
  .object({
    是否见面: z.boolean().prefault(false),
    当前关系: z.string().prefault(""),
    身份认知: z.enum(["未知", "怀疑", "已识破"]).prefault("未知"),
    伪装称呼: z.string().prefault("待设定"),
  })
  .prefault({});

// 单个小英雄的完整结构
const 小英雄Schema = z
  .object({
    基本信息: z
      .object({
        姓名: z.string().prefault(""),
        英雄名: z.string().prefault(""),
        物种: z.string().prefault(""),
        年龄: z.coerce.number().prefault(0),
        性格: z.string().prefault(""),
        背景: z.string().prefault(""),
      })
      .prefault({}),

    相貌特征: z
      .object({
        脸型五官: z.string().prefault(""),
        毛发: z.string().prefault(""),
      })
      .prefault({}),

    身材细节: z
      .object({
        身高: z.string().prefault(""),
        体态: z.string().prefault(""),
        肌肉线条: z.string().prefault(""),
      })
      .prefault({}),

    性器官特征: z
      .object({
        阴茎形态: z.string().prefault(""),
        后穴形态: z.string().prefault(""),
        乳头形态: z.string().prefault(""),
        体毛状况: z.string().prefault(""),
      })
      .prefault({}),

    性生活情况: z.string().prefault(""),

    能力: z.string().prefault(""),
    紧身战衣: z.string().prefault(""),
    常服: z.string().prefault(""),
    内衣: z.string().prefault(""),
    隐秘性癖: z.string().prefault(""),
    住处: z.string().prefault(""),
    爱好: z.array(z.string()).prefault([]),

    日程: z
      .object({
        上学: z
          .object({
            上午: z.array(z.string()).prefault([]),
            下午: z.array(z.string()).prefault([]),
            晚上: z.array(z.string()).prefault([]),
            深夜: z.array(z.string()).prefault([]),
          })
          .prefault({}),
        休息: z
          .object({
            上午: z.array(z.string()).prefault([]),
            下午: z.array(z.string()).prefault([]),
            晚上: z.array(z.string()).prefault([]),
            深夜: z.array(z.string()).prefault([]),
          })
          .prefault({}),
      })
      .prefault({}),

    人际关系: z
      .object({
        怪人主角: 对怪人主角关系Schema,
      })
      .passthrough()
      .prefault({}),

    长期目标: z.string().prefault(""),
    怪人组织任务: z.string().prefault("无"),
    今日已完成目标: z.array(z.string()).prefault([]),
    怪人主角已知信息: z
      .array(z.string())
      .prefault(["基本信息", "相貌", "身材", "能力", "紧身战衣", "日常常服"]),

    当前状态: z
      .object({
        当前区域: z.string().prefault("待设定"),
        当前地点: z.string().prefault("待设定"),
        当前动作: z.string().prefault("待设定"),
        当前生理动态: z.string().prefault("待设定"),
        当前着装: z.string().prefault("待设定"),
        当前目标: z.string().prefault("待设定"),
        当前目标开始时间: z.string().prefault("待设定"),
        当前目标预计用时: z.coerce.number().prefault(0),
      })
      .prefault({}),

    恶堕性格: z.string().prefault("待设定"),
    恶堕战衣: z.string().prefault("待设定"),
    恶堕能力: z.string().prefault("待设定"),
    恶堕印记: z.string().prefault("待设定"),
    恶堕代号: z.string().prefault("待设定"),
    恶堕状态: 恶堕状态Schema,
  })
  .prefault({});

// --- 主 Schema ---

export const Schema = z.object({
  进程: z
    .object({
      当前日期: z.string().prefault("20360810"),
      当前时间: z.string().prefault("1700"),
      当前时段: z.string().prefault("晚"),
      当前天气: z.string().prefault("晴"),
      累计天数: z.coerce.number().prefault(1),
      今日怪人事件是否发生: z.boolean().prefault(false),
      进入怪人事件起始发生时段: z.string().prefault("早"),
    })
    .prefault({}),

  视角: z
    .enum(["怪人主角", "夜守真白", "虎渡太阳", "槌谷陆", "风祭优羽"])
    .prefault("怪人主角"),

  显示: z.boolean().prefault(true),

  系统状态: z
    .object({
      主角创建完毕: z.boolean().prefault(false),
      游戏难度: z.enum(["简单", "困难"]).prefault("简单"),
      待处理事件: z
        .record(
          z.string(),
          z.union([
            z.boolean(),
            z.string(),
            z.array(z.string()),
            z.array(z.array(z.string())),
            z.object({}).passthrough(),
          ]),
        )
        .prefault({}),
    })
    .prefault({}),

  怪人主角: z
    .object({
      基本信息: z
        .object({
          姓名: z.string().prefault("待设定"),
          物种: z.string().prefault("待设定"),
          年龄: z.string().prefault("待设定"),
          背景: z.string().prefault(""),
          性格: z.string().prefault("待设定"),
        })
        .prefault({}),

      伪装姓名: z.string().prefault("待设定"),
      伪装职业: z.string().prefault("待设定"),
      代号: z.string().prefault("待设定"),
      气味特征: z.string().prefault("待设定"),
      住处: z.string().prefault(""),

      相貌特征: z
        .object({
          脸型五官: z.string().prefault("待设定"),
          毛发: z.string().prefault("待设定"),
        })
        .prefault({}),

      身体: z
        .object({
          身高: z.string().prefault("待设定"),
          体态: z.string().prefault("待设定"),
          肌肉线条: z.string().prefault("待设定"),
        })
        .prefault({}),

      当前状态: z
        .object({
          当前区域: z.string().prefault("待设定"),
          当前地点: z.string().prefault("待设定"),
          当前动作: z.string().prefault("待设定"),
          当前生理动态: z.string().prefault("待设定"),
          当前着装: z.string().prefault("待设定"),
          当前目标: z.string().prefault("待设定"),
          当前目标开始时间: z.string().prefault("待设定"),
          当前目标预计用时: z.coerce.number().prefault(0),
        })
        .prefault({}),

      日程: z
        .object({
          上午: z.array(z.string()).prefault([]),
          下午: z.array(z.string()).prefault([]),
          晚上: z.array(z.string()).prefault([]),
          深夜: z.array(z.string()).prefault([]),
        })
        .prefault({}),

      长期目标: z.string().prefault(""),
      今日已完成目标: z.array(z.string()).prefault([]),
    })
    .prefault({}),

  小英雄: z
    .object({
      夜守真白: 小英雄Schema,
      虎渡太阳: 小英雄Schema,
      槌谷陆: 小英雄Schema,
      风祭优羽: 小英雄Schema,
    })
    .prefault({}),

  组织: z
    .object({
      怪人组织: z
        .object({
          博士: z
            .object({
              物种: z.string().prefault(""),
              外貌身材: z.string().prefault(""),
              描述: z.string().prefault(""),
              秘密: z.string().prefault(""),
            })
            .prefault({}),
        })
        .prefault({}),

      正义联盟: z
        .object({
          基地沦陷进度: z.coerce.number().prefault(0),
          基地当前氛围: z.string().prefault("日常"),
          警戒等级: z.string().prefault("日常"),
          已恶堕角色: z.array(z.string()).prefault([]),
          是否彻底沦陷: z.boolean().prefault(false),
          关键人物: z
            .record(
              z.string(),
              z
                .object({
                  身份: z.string().prefault(""),
                  物种: z.string().prefault(""),
                  外貌身材: z.string().prefault(""),
                  描述: z.string().prefault(""),
                  秘密: z.string().prefault(""),
                })
                .passthrough()
                .prefault({}),
            )
            .prefault({}),
        })
        .prefault({}),
    })
    .prefault({}),
});

$(() => {
  registerMvuSchema(Schema);
});
