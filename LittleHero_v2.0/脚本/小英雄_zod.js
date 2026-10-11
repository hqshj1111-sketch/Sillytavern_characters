import { registerMvuSchema } from "https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js";

// --- 复用结构定义 ---

// 数值条
const BarSchema = z
  .object({
    当前: z.coerce.number().prefault(100),
    最大: z.coerce.number().prefault(100),
  })
  .prefault({});

// 接收任意数值 → 静默钳制到 [min, max]
const ClampedNumber = (min, max, def = 0) =>
  z.coerce
    .number()
    .prefault(def)
    .transform((value) => _.clamp(value, min, max));

// 身体部位
const BodyPartSchema = z.string().prefault("完好");

// 性癖等级与经验
const FetishSchema = z
  .object({
    经验: z.coerce.number().prefault(0),
    等级: ClampedNumber(0, 4, 0),
  })
  .prefault({});

const EntityMap = z.record(z.string(), z.object({}).passthrough()).prefault({});

// --- 主 Schema ---
export const Schema = z.object({
  进程: z
    .object({
      阶段: z.string().prefault("创角阶段"),
    })
    .prefault({}),

  世界: z
    .object({
      日期: z.coerce.number().prefault(20400305),
      世界观备注: z.preprocess(
        (val) => {
          if (Array.isArray(val)) {
            const acc = {};
            val.forEach((item, index) => {
              if (!item || item === "$__META_EXTENSIBLE__$") return;
              const match = item.match(/^【(.*?)】(.*)/);
              if (match) {
                acc[match[1]] = match[2];
              } else {
                acc[`设定_${index}`] = item;
              }
            });
            return acc;
          }
          if (typeof val === "string") return { 基础设定: val };
          if (!val) return { 基础设定: "无任何特殊设定。" };
          return val;
        },
        z
          .record(z.string(), z.string())
          .prefault({ 基础设定: "无任何特殊设定。" }),
      ),
      当前关卡: z
        .object({
          名称: z.string().prefault("无"),
          战斗类型: z.string().prefault("无"),
          Boss状态: z.string().prefault("完好"),
          Boss韧性值: z.coerce.number().prefault(100),
          Boss基础强度: z.coerce.number().prefault(50),
          核心主题: z.array(z.string()).prefault([]),
        })
        .prefault({}),
      幕间H事件: z
        .object({
          名称: z.string().prefault("无"),
          逃脱进度: z.coerce.number().prefault(0),
          核心主题: z.array(z.string()).prefault([]),
        })
        .prefault({}),
      威胁等级: z.coerce.number().prefault(1),
      小英雄名录: z
        .record(
          z.string(),
          z
            .object({
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
              败于主角次数: z.coerce.number().prefault(0),
            })
            .prefault({}),
        )
        .prefault({}),
      一般NPC名录: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z
              .object({
                身份: z.string().prefault(""),
                关系: z.string().prefault(""),
                描述: z.string().prefault(""),
              })
              .passthrough(),
          ]),
        )
        .prefault({}),
      校园催眠: z
        .object({
          启用: z.boolean().prefault(true),
          主角在校: z.boolean().prefault(false),
          怪人代号: z.string().prefault("教官01号"),
          催眠进度: ClampedNumber(0, 100, 0),
          疑心度: ClampedNumber(0, 100, 0),
          结界已破除: z.boolean().prefault(false),
          完全催眠阶段: z.boolean().prefault(false),
          今日在校回合: z.coerce.number().prefault(0),
          今日已增催眠: z.boolean().prefault(false),
        })
        .prefault({}),
    })
    .prefault({}),

  系统状态: z
    .object({
      主角创建完毕: z.boolean().prefault(false),
      幕间回合计数: z.coerce.number().prefault(1),
      幕间事件完成: z.boolean().prefault(true),
      待处理事件: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.boolean(),
            z.number(),
            z.object({}).passthrough(),
          ]),
        )
        .prefault({}),
      Boss生成主题池: z
        .array(z.string())
        .prefault([
          "触手",
          "史莱姆",
          "兽人",
          "哥布林",
          "虫奸",
          "植物奸",
          "透明人",
          "丸吞",
          "机械奸",
          "情趣玩具",
          "环境陷阱",
          "壁尻",
          "监禁",
          "服装活体化",
          "苗床化",
          "标记&涂鸦",
          "催眠&洗脑",
          "附身",
          "催情&媚药",
          "感官遮断",
          "时间停止",
          "常识色情化",
          "睡眠奸",
          "痴汉",
          "耳交",
          "深吻",
          "言语侵犯",
          "公开调教",
          "直播",
          "换装",
          "强制露出",
          "道德困境",
          "商品化",
          "赌博游戏",
          "胁迫侍奉",
          "隐奸NTR",
          "绳艺",
          "能量吸收",
          "身体改造",
          "兽人化",
          "黑暗印记",
          "产卵",
          "寄生",
          "肉铠化",
          "能量核心开发",
          "前列腺榨取",
          "敏感化改造",
          "精浴",
          "强暴",
          "窒息",
          "疼痛",
          "高潮寸止",
          "群交",
          "分身",
          "肛交",
          "石化",
          "蔷薇",
          "共感链接",
          "正太化",
          "乳头玩弄",
          "巨根化",
          "胶兽",
          "胶兽化",
          "身体交换",
          "诚实结界",
          "言辞秽转",
        ]),
    })
    .prefault({}),

  记录: z
    .object({
      已击败的Boss: EntityMap,
      已击败Boss计数: z.coerce.number().prefault(0),
      总战败次数: z.coerce.number().prefault(0),
      黑化次数: z.coerce.number().prefault(0),
      善堕次数: z.coerce.number().prefault(0),
    })
    .prefault({}),

  名声: z
    .object({
      知名度: ClampedNumber(0, 100, 0),
      风评: ClampedNumber(-100, 100, 0),
      知名度等级: z.string().prefault("默默无闻"),
      风评等级: z.string().prefault("籍籍无名"),
      沉寂时间: ClampedNumber(0, 9999, 0),
      风评标签: z
        .object({
          表世界身份风评: z.string().prefault("待设定"),
          小英雄身份风评: z.string().prefault("待设定"),
          流言: z.string().prefault("待设定"),
        })
        .prefault({}),
    })
    .prefault({}),

  主角: z
    .object({
      基本信息: z
        .object({
          姓名: z.string().prefault("待设定"),
          年龄: z.coerce.string().prefault("待设定"),
          英雄名: z.string().prefault("待设定"),
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
          体脂率: z.string().prefault("待设定"),
        })
        .prefault({}),

      个人信息: z
        .preprocess(
          (val) => {
            if (val && typeof val === "object" && !Array.isArray(val)) {
              if (val["身份"] && val["身份"]["职业"]) {
                return { ...val, "身份&职业": val["身份"]["职业"] };
              }
            }
            return val;
          },
          z.object({
            "身份&职业": z.string().prefault("高中生 / 见习小英雄"),
            性格特质: z.string().prefault("正义勇敢，略带稚气，决不向邪恶低头"),
            代表色: z.string().prefault("纯白"),
            武装: z.string().prefault("暂无"),
            紧身战衣: z.string().prefault("特制紧身英雄战衣"),
            核心能力: z.string().prefault("光辉能量"),
          }),
        )
        .prefault({}),

      性器官特征: z
        .object({
          胸部形态: z.string().prefault("待设定"),
          乳头颜色: z.string().prefault("待设定"),
          阴茎形态: z.string().prefault("待设定"),
          后穴形态: z.string().prefault("待设定"),
          体毛状况: z.string().prefault("待设定"),
          天生敏感度: z.string().prefault("标准"),
        })
        .prefault({}),

      核心状态: z
        .object({
          能量值: BarSchema,
          体力值: BarSchema,
          基础强度: z.coerce.number().prefault(50),
          着装状态: z.boolean().prefault(false),
          正义充能: ClampedNumber(0, 100, 0),
          人格状态: z.enum(["英雄", "反派"]).prefault("英雄"),
          混沌充能: ClampedNumber(0, 100, 0),
          主人: z.string().prefault("无"),
          善堕备份: z
            .object({
              英雄名: z.string().prefault(""),
              紧身战衣: z.string().prefault(""),
              代表色: z.string().prefault(""),
              核心能力: z.string().prefault(""),
              性格特质: z.string().prefault(""),
            })
            .prefault({}),
          恶堕备份: z
            .object({
              英雄名: z.string().prefault(""),
              紧身战衣: z.string().prefault(""),
              代表色: z.string().prefault(""),
              核心能力: z.string().prefault(""),
              性格特质: z.string().prefault(""),
              主人: z.string().prefault("无"),
              组织刻印: z
                .object({
                  部位: z.string().prefault("脸颊"),
                  详情: z.string().prefault(""),
                  来源: z.string().prefault("怪人组织"),
                })
                .nullable()
                .prefault(null),
            })
            .prefault({}),
          当前战斗姿态: z.string().prefault("非战斗"),
        })
        .prefault({}),

      战斗临时: z
        .object({
          当前战斗日志: z.string().prefault("无"),
          撤退尝试: z.coerce.number().prefault(0),
          撤退成功: z.boolean().prefault(false),
          投降: z.boolean().prefault(false),
          战斗方式: z
            .enum([
              // 战斗回合
              "主动",
              "牵制",
              "诱惑",
              "推进",
              "危机",
              "必杀",
              "撤退",
              "投降",
              // 战斗准备
              "周旋",
              "探索",
              "交涉",
              "开战",
              // 幕间H事件
              "抗拒",
              "忍耐",
              "爆发",
              "迎合",
              // 校园催眠 - 常规潜伏
              "怀疑",
              "试探",
              // 校园催眠 - 完全催眠
              "受训",
              "助教",
              "侍奉",
              "同化",
              // 被捕囚禁 - 日常
              "观察",
              "挣扎",
              "对话",
              "休息",
              "思考",
              // 被捕囚禁 - 洗脑审讯
              "反抗",
              "忍耐",
              "动摇",
              "顺从",
            ])
            .prefault("主动"),
        })
        .passthrough()
        .prefault({}),

      囚禁状态: z
        .object({
          洗脑中: z.boolean().prefault(false),
          今日已洗脑: z.boolean().prefault(false),
          洗脑剩余回合: z.coerce.number().prefault(0),
          逃脱进度: ClampedNumber(0, 100, 0),
          洗脑进度: ClampedNumber(0, 100, 0),
          自由度: z.string().prefault("严密监禁"),
          自由度加值: z.coerce.number().prefault(0),
          上次自由度: z.string().prefault("严密监禁"),
          前次自由度: z.string().prefault("严密监禁"),
          变动方向: z.string().prefault("提升"),
          总被俘次数: z.coerce.number().prefault(0),
          本次已触发身体改造: z.boolean().prefault(false),
          监禁天数: z.coerce.number().prefault(1),
          监禁回合: z.coerce.number().prefault(0),
        })
        .prefault({}),

      性行为统计: z
        .object({
          总性交次数: z.coerce.number().prefault(0),
          总内射接收次数: z.coerce.number().prefault(0),
          总内射他人次数: z.coerce.number().prefault(0),
          总为他人口交次数: z.coerce.number().prefault(0),
          总被他人口交次数: z.coerce.number().prefault(0),
          总自己手淫次数: z.coerce.number().prefault(0),
          总给他人手淫次数: z.coerce.number().prefault(0),
          总被他手淫次数: z.coerce.number().prefault(0),
        })
        .prefault({}),

      身体部位状况: z
        .object({
          面部: BodyPartSchema,
          胸部: BodyPartSchema,
          手臂: BodyPartSchema,
          腰腹: BodyPartSchema,
          臀部: BodyPartSchema,
          私处: BodyPartSchema,
          腿部: BodyPartSchema,
        })
        .prefault({}),

      黑暗印记: z
        .object({
          描述: z.string().prefault("生成中……"),
          经验: z.coerce.number().prefault(0),
        })
        .prefault({}),

      道具栏: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.object({}).passthrough(),
          ]),
        )
        .prefault({}),

      永久性身体改造: z
        .record(
          z.string(),
          z
            .object({
              部位: z.string().prefault("待设定"),
              详情: z.string().prefault("待设定"),
              来源: z.string().prefault("未知"),
            })
            .passthrough(),
        )
        .prefault({}),

      生理状态: z
        .object({
          当前生理动态: z.string().prefault("呼吸平稳"),
          能量核心状态: z
            .object({
              最大容量: z.coerce.number().prefault(50),
            })
            .prefault({}),

          能量核心内异物: z
            .object({
              异物列表: z
                .record(
                  z.string(),
                  z.union([z.string(), z.object({}).passthrough()]),
                )
                .prefault({}),
              当前动态: z.string().prefault("无"),
            })
            .prefault({}),

          阴茎状态: z
            .object({
              当前状态: z.string().prefault("疲软"),
            })
            .prefault({}),

          后穴状态: z
            .object({
              当前状态: z.string().prefault("紧闭"),
              开发度: ClampedNumber(0, 100, 0),
              湿润度: z.string().prefault("干燥"),
              内部异物: z
                .record(
                  z.string(),
                  z.union([z.string(), z.object({}).passthrough()]),
                )
                .prefault({}),
            })
            .prefault({}),

          体液与分泌: z
            .object({
              能量核心内精液: z
                .object({
                  存量: z.coerce.number().prefault(0),
                  来源: z.record(z.string(), z.any()).prefault({}),
                })
                .prefault({}),
            })
            .prefault({}),
        })
        .prefault({}),

      快感状态: z
        .object({
          快感值: ClampedNumber(0, 1000, 0),
          高潮阈值: z.coerce.number().prefault(100),
          侵蚀度: ClampedNumber(0, 100, 0),
          总高潮次数: z.coerce.number().prefault(0),
          性癖: z
            .object({
              "屈服&败北": FetishSchema,
              露出: FetishSchema,
              主动侍奉: FetishSchema,
              背德感: FetishSchema,
              言语羞辱: FetishSchema,
              精神控制: FetishSchema,
              NTR: FetishSchema,
              蔷薇: FetishSchema,
              "疼痛&M属性": FetishSchema,
              快感寸止: FetishSchema,
              "爱抚&前戏": FetishSchema,
              情趣玩具: FetishSchema,
              "体格差&压制": FetishSchema,
              自慰: FetishSchema,
              口腔开发: FetishSchema,
              乳头开发: FetishSchema,
              阴茎开发: FetishSchema,
              后庭开发: FetishSchema,
              "群交&轮奸": FetishSchema,
              腔内射精: FetishSchema,
              精液成瘾: FetishSchema,
              "榨精&溢液": FetishSchema,
              媚药浸染: FetishSchema,
              触手play: FetishSchema,
              异种奸: FetishSchema,
              机械奸: FetishSchema,
              "拘束&紧缚": FetishSchema,
              "标记&涂鸦": FetishSchema,
              睡眠奸: FetishSchema,
              "产卵&排出": FetishSchema,
              "偷奸&隐奸": FetishSchema,
              能量核心开发: FetishSchema,
              自攻自受: FetishSchema,
              兽人化: FetishSchema,
              胶兽化: FetishSchema,
            })
            .prefault({}),
        })
        .prefault({}),
    })
    .prefault({}),
});

$(() => {
  registerMvuSchema(Schema);
});
