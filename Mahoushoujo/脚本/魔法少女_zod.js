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
    日期: z.coerce.number().prefault(305),
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
      z.record(z.string(), z.string())
    ).prefault({ "基础设定": "无任何特殊设定。"}), 
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
    威胁等级: z.coerce.number().prefault(1)
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
      "催眠&洗脑", "身体改造", "言语侵犯", "催情&媚药", "榨乳", 
      "虫奸", "魔力吸收", "感官遮断", "产卵", "常识色情化", 
      "分身", "石化", "时间停止", "透明人", "绳艺", 
      "群交", "公开调教", "监禁", "触手", "史莱姆", 
      "兽人", "哥布林", "机械奸", "寄生", "淫纹", 
      "丸吞", "睡眠奸", "壁尻", "情趣玩具", "爆乳化", 
      "疼痛", "窒息", "标记&涂鸦", "换装", "痴汉", 
      "精浴", "百合", "高潮寸止", "幼女化", "道德困境", 
      "服装活体化", "强制怀孕", "胁迫侍奉", "环境陷阱", "苗床化", 
      "肛交", "子宫开发", "强制露出", "植物奸", "隐奸NTR", 
      "赌博游戏", "商品化", "直播", "共感链接", "深吻", 
      "兽耳化", "肉铠化", "耳交", "强暴", "附身"
    ])
  }).prefault({}),

  记录: z.object({
    已击败的Boss: EntityMap,
    已击败Boss计数: z.coerce.number().prefault(0),
    诞下的子嗣: EntityMap,
    总战败次数: z.coerce.number().prefault(0)
  }).prefault({}),

  名声: z.object({
    知名度: z.coerce.number().prefault(0),
    风评: z.coerce.number().prefault(0)
  }).prefault({}),

  主角: z.object({
    基本信息: z.object({
      姓名: z.string().prefault("待设定"),
      年龄: z.coerce.string().prefault("待设定"),
      魔法少女名: z.string().prefault("待设定")
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
      变身服: z.string().prefault("待设定"),
      核心能力: z.string().prefault("未觉醒"),
      使魔伙伴种类: z.string().prefault("待设定"),
      使魔伙伴性格: z.string().prefault("待设定"),
      使魔伙伴与主角关系: z.string().prefault("待设定") 
    })).prefault({}),

    性器官特征: z.object({
      乳房形状: z.string().prefault("待设定"),
      乳晕与乳头颜色: z.string().prefault("待设定"),
      阴唇形态: z.string().prefault("待设定"),
      体毛状况: z.string().prefault("待设定"),
      天生敏感度: z.string().prefault("标准")
    }).prefault({}),

    核心状态: z.object({
      魔力值: BarSchema,
      体力值: BarSchema,
      基础强度: z.coerce.number().prefault(50),
      变身状态: z.boolean().prefault(false),
      净化之力: z.coerce.number().prefault(0),
      人格状态: z.enum(["善良", "堕落"]).prefault("善良"),
      污秽魔力: z.coerce.number().prefault(0),
      主人: z.string().prefault("无"),
      产后状态: z.string().prefault("无"),
      当前战斗姿态: z.string().prefault("非战斗")
    }).prefault({}),

    战斗临时: z.object({
      当前战斗日志: z.string().prefault("无")
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

    淫纹: z.object({
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
      z.string(),
      z.object({
        部位: z.string().prefault("待设定"),
        详情: z.string().prefault("待设定"),
        来源: z.string().prefault("未知")
      }).passthrough()
    ).prefault({}), 

    生理状态: z.object({
      当前生理动态: z.string().prefault("呼吸平稳"),
      子宫状态: z.object({
        受孕状态: z.string().prefault("未受孕"),
        孕育信息: z.object({
          孕育源: z.string().prefault("无"),
          妊娠计数器: z.coerce.number().prefault(0)
        }).prefault({})
      }).prefault({}),
      子宫内异物: z.object({
        异物列表: z.record(
            z.string(), 
            z.union([z.string(), z.object({}).passthrough()]) 
        ).prefault({}),  
        当前动态: z.string().prefault("无")
      }).prefault({}),

      阴道状态: z.object({
        当前状态: z.string().prefault("放松"),
        湿润度: z.string().prefault("少量"),
        最大容量: z.coerce.number().prefault(50),
        内部异物: z.record(
            z.string(), 
            z.union([z.string(), z.object({}).passthrough()])
        ).prefault({}), 
      }).prefault({}),
      后穴状态: z.object({
        当前状态: z.string().prefault("紧闭"),
        开发度: z.coerce.number().prefault(0)
      }).prefault({}),
      体液与分泌: z.object({
        子宫内精液: z.object({
          存量: z.coerce.number().prefault(0),
          来源: z.record(
            z.string(), 
            z.any()     
          ).prefault({}),
        }).prefault({})
      }).prefault({}),
    }).prefault({}),

    快感状态: z.object({
      快感值: z.coerce.number().prefault(0),
      高潮阈值: z.coerce.number().prefault(100),
      污染度: z.coerce.number().prefault(0),
      总高潮次数: z.coerce.number().prefault(0),
      性癖: z.object({
        "屈服&败北": FetishSchema,
        "露出&服装破损": FetishSchema,
        "主动侍奉": FetishSchema,
        "背德感": FetishSchema,
        "言语羞辱": FetishSchema,
        "精神控制": FetishSchema,
        "NTR": FetishSchema,
        "百合": FetishSchema,
        "疼痛&M属性": FetishSchema,
        "快感寸止": FetishSchema,
        "感官遮断": FetishSchema,
        "爱抚&前戏": FetishSchema,
        "情趣玩具": FetishSchema,
        "体格差&压制": FetishSchema,
        "自慰": FetishSchema,
        "口腔开发": FetishSchema,
        "胸部开发": FetishSchema,
        "小穴开发": FetishSchema,
        "后庭开发": FetishSchema,
        "群交&轮奸": FetishSchema,
        "膣内射精": FetishSchema,
        "精液成瘾": FetishSchema,
        "榨乳&泌乳": FetishSchema,
        "媚药浸染": FetishSchema,
        "触手play": FetishSchema,
        "异种奸": FetishSchema,
        "机械奸": FetishSchema,
        "拘束&紧缚": FetishSchema,
        "标记&涂鸦": FetishSchema,
        "睡眠奸": FetishSchema,
        "产卵&排出": FetishSchema,
        "偷奸&隐奸": FetishSchema,
        "怀孕": FetishSchema
      }).prefault({}),
    }).prefault({})
  }).prefault({})
});

$(() => {
  registerMvuSchema(Schema);
});