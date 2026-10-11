import { registerMvuSchema } from 'https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js';

// --- 复用结构定义 ---

// 数值条
const BarSchema = z.object({
  当前: z.coerce.number().prefault(100),
  最大: z.coerce.number().prefault(100)
}).prefault({});

// 身体部位
const BodyPartSchema = z.string().prefault("完好");

// 性癖等级
const FetishSchema = z.object({
  经验: z.coerce.number().prefault(0),
  等级: z.coerce.number().prefault(0)
}).prefault({});

const EntityMap = z.record(
    z.string(),
    z.object({}).passthrough()
).prefault({});

// --- 主 Schema ---

export const Schema = z.object({
  进程: z.object({
    阶段: z.string().prefault("创角阶段")
  }).prefault({}),

  世界: z.object({
    日期: z.coerce.number().prefault(20400305),
    世界观备注: z.preprocess(
      (val) => {
        if (Array.isArray(val)) {
            const acc = {};
            val.forEach((item, index) => {
                if(!item || item === '$__META_EXTENSIBLE__$') return;
                // 尝试提取标签
                const match = item.match(/^【(.*?)】(.*)/);
                if (match) { acc[match[1]] = match[2]; } // 有标签用标签
                else { acc[`设定_${index}`] = item; }    // 无标签用序号
            });
            return acc;
        }
        // 兼容B: 如果是旧版字符串
        if (typeof val === 'string') return { "基础设定": val };
        // 默认空状态
        if (!val) return { "基础设定": "无任何特殊设定。" };
        return val;
      },
      z.record(z.string(), z.string()).prefault({ "基础设定": "无任何特殊设定。" })
    ),
    当前关卡: z.object({
      名称: z.string().prefault("无"),
      战斗类型: z.string().prefault("无"),
      Boss状态: z.string().prefault("完好"),
      Boss韧性值: z.coerce.number().prefault(100),
      Boss基础强度: z.coerce.number().prefault(50),
      核心主题: z.array(z.string()).prefault([])
    }).prefault({}),
    幕间H事件: z.object({
      名称: z.string().prefault("无"),
      核心主题: z.array(z.string()).prefault([])
    }).prefault({}),
    威胁等级: z.coerce.number().prefault(1),
    小英雄名录: z.record(
      z.string(),
      z.object({
        表面身份: z.string().prefault(""),
        人格阵营: z.enum(["英雄", "反派"]).prefault("英雄"),
        英雄名: z.string().prefault(""),
        堕落英雄名: z.string().prefault(""),
        英雄核心能力: z.string().prefault(""),
        反派核心能力: z.string().prefault(""),
        英雄代表色: z.string().prefault(""),
        反派代表色: z.string().prefault(""),
        英雄性格特质: z.string().prefault(""),
        反派性格特质: z.string().prefault(""),
        外貌身材: z.string().prefault(""),
        与主角关系: z.string().prefault(""),
        内射主角次数: z.coerce.number().prefault(0),
        被主角内射次数: z.coerce.number().prefault(0),
        恶堕进度: z.coerce.number().prefault(0),
        善堕进度: z.coerce.number().prefault(0),
        恶堕次数: z.coerce.number().prefault(0),
        善堕次数: z.coerce.number().prefault(0),
        战胜主角次数: z.coerce.number().prefault(0),
        败于主角次数: z.coerce.number().prefault(0)
      }).prefault({})
    ).prefault({}),
    一般NPC名录: z.record(z.string(), z.string()).prefault({})
  }).prefault({}),

  系统状态: z.object({
    主角创建完毕: z.boolean().prefault(false),
    幕间回合计数: z.coerce.number().prefault(1),
    幕间事件完成: z.boolean().prefault(true),
    待处理事件: z.record(
        z.string(),
        z.union([z.boolean(), z.string()])
    ).prefault({}),

    Boss生成主题池: z.array(z.string()).prefault([
      "催眠&洗脑", "身体改造", "言语侵犯", "媚药", "乳头玩弄",
      "虫奸", "能量吸收", "感官遮断", "产卵", "常识色情化",
      "分身", "石化", "时间停止", "透明人", "催情&媚药",
      "群交", "公开调教", "监禁", "触手", "史莱姆",
      "兽人", "兽人化", "哥布林", "机械奸", "寄生",
      "黑暗印记", "丸吞", "睡眠奸", "壁尻", "情趣玩具",
      "巨根化", "疼痛", "窒息", "换装", "痴汉",
      "精浴", "蔷薇", "高潮寸止", "正太化", "道德困境",
      "服装活体化", "胁迫侍奉", "环境陷阱", "苗床化",
      "肛交", "强制露出", "植物奸", "赌博游戏",
      "商品化", "直播", "隐奸NTR", "附身",
      "耳交", "深吻", "共感链接", "胶兽",
      "胶兽化", "身体交换", "诚实结界", "妖兽/妖狐", "言辞秽转"
    ])
  }).prefault({}),

  记录: z.object({
    已击败的Boss: EntityMap,
    已击败Boss计数: z.coerce.number().prefault(0),
     总战败次数: z.coerce.number().prefault(0),
     黑化次数: z.coerce.number().prefault(0),
     善堕次数: z.coerce.number().prefault(0)
  }).prefault({}),

  名声: z.object({
    知名度: z.coerce.number().prefault(0),
    风评: z.coerce.number().prefault(0)
  }).prefault({}),

  主角: z.object({
    基本信息: z.object({
      姓名: z.string().prefault("待设定"),
      // 容错：允许输入数字，自动转为字符串
      年龄: z.coerce.string().prefault("待设定"),
      英雄名: z.string().prefault("待设定")
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
      体脂率: z.string().prefault("待设定")
    }).prefault({}),

    个人信息: z.preprocess((val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        if (val["身份"] && val["身份"]["职业"]) {
          return { ...val, "身份&职业": val["身份"]["职业"] };
        }
      }
      return val;
    }, z.object({
      "身份&职业": z.string().prefault("待设定"),
      性格特质: z.string().prefault("待设定"),
      代表色: z.string().prefault("待设定"),
      武装: z.string().prefault("暂无"),
      紧身战衣: z.string().prefault("待设定"),
      核心能力: z.string().prefault("未觉醒")
    })).prefault({}),

    性器官特征: z.object({
      胸部形态: z.string().prefault("待设定"),
      乳头颜色: z.string().prefault("待设定"),
      阴茎形态: z.string().prefault("待设定"),
      后穴形态: z.string().prefault("待设定"),
      体毛状况: z.string().prefault("待设定"),
      天生敏感度: z.string().prefault("标准")
    }).prefault({}),

    核心状态: z.object({
      能量值: BarSchema,
      体力值: BarSchema,
      基础强度: z.coerce.number().prefault(50),
      着装状态: z.boolean().prefault(false),
      正义充能: z.coerce.number().prefault(0),
      人格状态: z.enum(["英雄", "反派"]).prefault("英雄"),
      混沌充能: z.coerce.number().prefault(0),
      主人: z.string().prefault("无"),
      善堕备份: z.object({
        英雄名: z.string().prefault(""),
        紧身战衣: z.string().prefault(""),
        代表色: z.string().prefault(""),
        核心能力: z.string().prefault(""),
        性格特质: z.string().prefault("")
      }).prefault({}),
      恶堕备份: z.object({
        英雄名: z.string().prefault(""),
        紧身战衣: z.string().prefault(""),
        代表色: z.string().prefault(""),
        核心能力: z.string().prefault(""),
        性格特质: z.string().prefault(""),
        主人: z.string().prefault("无"),
        组织刻印: z.object({
          部位: z.string().prefault("脸颊"),
          详情: z.string().prefault(""),
          来源: z.string().prefault("怪人组织")
        }).nullable().prefault(null)
      }).prefault({}),
      当前战斗姿态: z.string().prefault("非战斗")
    }).prefault({}),

    战斗临时: z.object({
      当前战斗日志: z.string().prefault("无")
    }).prefault({}),
    囚禁状态: z.object({
      逃脱进度: z.coerce.number().prefault(0),
      洗脑进度: z.coerce.number().prefault(0),
      自由度: z.string().prefault("严密监禁"),
      监禁回合: z.coerce.number().prefault(0)
    }).prefault({}),
    性行为统计: z.object({
      总性交次数: z.coerce.number().prefault(0),
      总内射接收次数: z.coerce.number().prefault(0),
      总内射他人次数: z.coerce.number().prefault(0),
      总为他人口交次数: z.coerce.number().prefault(0),
      总被他人口交次数: z.coerce.number().prefault(0),
      总自己手淫次数: z.coerce.number().prefault(0),
      总给他人手淫次数: z.coerce.number().prefault(0),
      总被他手淫次数: z.coerce.number().prefault(0)
    }).prefault({}),
    身体部位状况: z.object({
      面部: BodyPartSchema,
      胸部: BodyPartSchema,
      手臂: BodyPartSchema,
      腰腹: BodyPartSchema,
      臀部: BodyPartSchema,
      私处: BodyPartSchema,
      腿部: BodyPartSchema
    }).prefault({}),

    黑暗印记: z.object({
      描述: z.string().prefault("生成中……"),
      经验: z.coerce.number().prefault(0)
    }).prefault({}),

    道具栏: z.record(
        z.string(),
        z.union([
            z.string(),
            z.number(),
            z.boolean()
        ])
    ).prefault({}),

    永久性身体改造: z.record(
      z.string(), // <--- 关键修改：显式指定 Key 必须是字符串
      z.object({
        部位: z.string().prefault("待设定"),
        详情: z.string().prefault("待设定"),
        来源: z.string().prefault("未知")
      }).passthrough()
    ).prefault({}),

    生理状态: z.object({
      当前生理动态: z.string().prefault("呼吸平稳"),
      // --- 关键修改：子宫 -> 能量核心 ---
      能量核心状态: z.object({
        最大容量: z.coerce.number().prefault(50)
      }).prefault({}),

      能量核心内异物: z.object({
        异物列表: z.record(
          z.string(), // Key: 异物名称
          z.union([z.string(), z.object({}).passthrough()]) // Value: 描述或详情对象
        ).prefault({}),
        当前动态: z.string().prefault("无")
      }).prefault({}),

      // --- 关键修改：阴道 -> 阴茎 ---
      阴茎状态: z.object({
        当前状态: z.string().prefault("疲软")
      }).prefault({}),

      后穴状态: z.object({
        当前状态: z.string().prefault("紧闭"),
        开发度: z.coerce.number().prefault(0),
        湿润度: z.string().prefault("干燥"),
        内部异物: z.record(
          z.string(),
          z.union([z.string(), z.object({}).passthrough()])
        ).prefault({})
      }).prefault({}),

      体液与分泌: z.object({
        能量核心内精液: z.object({
          存量: z.coerce.number().prefault(0),
          来源: z.record(
            z.string(), // Key 必须是字符串
            z.any()     // Value 可以是任何东西 (字符串/数字)
          ).prefault({}),
        }).prefault({})
      }).prefault({}),
    }).prefault({}),

    快感状态: z.object({
      快感值: z.coerce.number().prefault(0),
      高潮阈值: z.coerce.number().prefault(100),
      侵蚀度: z.coerce.number().prefault(0),
      总高潮次数: z.coerce.number().prefault(0),
      性癖: z.object({
        "屈服&败北": FetishSchema,
        "露出": FetishSchema,
        "主动侍奉": FetishSchema,
        "背德感": FetishSchema,
        "言语羞辱": FetishSchema,
        "精神控制": FetishSchema,
        "NTR": FetishSchema,
        "蔷薇": FetishSchema,
        "疼痛&M属性": FetishSchema,
        "快感寸止": FetishSchema,
        "感官遮断": FetishSchema,
        "爱抚&前戏": FetishSchema,
        "情趣玩具": FetishSchema,
        "身体改造": FetishSchema,
        "体格差&压制": FetishSchema,
        "自慰": FetishSchema,
        "口腔开发": FetishSchema,
        "乳头开发": FetishSchema,
        "阴茎开发": FetishSchema,
        "后庭开发": FetishSchema,
        "群交&轮奸": FetishSchema,
        "腔内射精": FetishSchema,
        "精液成瘾": FetishSchema,
        "榨精&溢液": FetishSchema,
        "媚药浸染": FetishSchema,
        "触手play": FetishSchema,
        "异种奸": FetishSchema,
        "机械奸": FetishSchema,
        "拘束&紧缚": FetishSchema,
        "睡眠奸": FetishSchema,
        "产卵&排出": FetishSchema,
        "自攻自受": FetishSchema,
       "兽人化": FetishSchema,
       "偷奸&隐奸": FetishSchema,
       "胶兽化": FetishSchema
      }).prefault({}),
    }).prefault({})
  }).prefault({})
});

$(() => {
  registerMvuSchema(Schema);
});
