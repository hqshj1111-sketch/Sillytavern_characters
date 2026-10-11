import { registerMvuSchema } from "https://cdn.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js";

const 苦主Schema = z
  .object({
    基本信息: z
      .object({
        姓名: z.string().prefault("<user>"),
        身份: z.string().prefault("超自然对策社社长 / 高二学生"),
        年龄: z.coerce.number().prefault(17),
        性格: z.string().prefault("温和负责、重视同伴"),
        背景: z.string().prefault("鸣神学园二年级生，创办超自然对策社"),
      })
      .prefault({}),
    相貌特征: z.string().prefault("清秀普通黑发少年"),
    身材细节: z.string().prefault("身高173cm"),
    性器官特征: z.string().prefault("8cm，青涩小巧"),
    疑心值: z.coerce.number().prefault(0),
    洗脑条目: z.array(z.string()).prefault([]),
    对黄毛关系: z
      .object({
        友情值: z.coerce.number().prefault(10),
        爱情值: z.coerce.number().prefault(0),
        屈服值: z.coerce.number().prefault(0),
        肉体沉沦值: z.coerce.number().prefault(0),
      })
      .prefault({}),
  })
  .prefault({});

const 黄毛Schema = z
  .object({
    基本信息: z
      .object({
        姓名: z.string().prefault("神宫寺夜"),
        身份: z.string().prefault("特聘神秘学顾问 / 全能转学生"),
        年龄: z.coerce.number().prefault(18),
        性格: z.string().prefault("从容优雅、强势霸道、掌控欲极强"),
        背景: z.string().prefault("神宫寺财阀长子，EX级顶尖灵能继承人"),
      })
      .prefault({}),
    相貌特征: z.string().prefault("俊美锐利五官，深邃金眸，微卷黑发"),
    身材细节: z.string().prefault("身高187cm，肌肉分明"),
    性器官特征: z.string().prefault("20cm，粗壮强悍"),
  })
  .prefault({});

const 单个女角色Schema = z
  .object({
    基本信息: z
      .object({
        姓名: z.string().prefault(""),
        身份: z.string().prefault(""),
        年龄: z.coerce.number().prefault(17),
        性格: z.string().prefault(""),
        背景: z.string().prefault(""),
      })
      .prefault({}),
    相貌特征: z.string().prefault(""),
    身材细节: z.string().prefault(""),
    性器官特征: z.string().prefault(""),
    隐藏弱点: z.string().prefault(""),
    隐秘性癖: z.string().prefault(""),
    淫乱值: z.coerce.number().prefault(10),
    高潮次数: z.coerce.number().prefault(0),
    黄毛高潮次数: z.coerce.number().prefault(0),
    黄毛射精量: z.coerce.number().prefault(0),
    洗脑条目: z.array(z.string()).prefault([]),
    人际关系: z
      .object({
        苦主: z
          .object({
            关系: z.string().prefault("社长"),
            好感值: z.coerce.number().prefault(50),
            肉体依赖值: z.coerce.number().prefault(0),
          })
          .prefault({}),
        黄毛: z
          .object({
            关系: z.string().prefault("特聘顾问"),
            好感值: z.coerce.number().prefault(10),
            屈服值: z.coerce.number().prefault(0),
            肉体沉沦值: z.coerce.number().prefault(0),
          })
          .prefault({}),
      })
      .prefault({}),
  })
  .prefault({});

const 灵异事件Schema = z
  .object({
    发生地点: z.string().prefault("待触发"),
    恶灵名称: z.string().prefault("待触发"),
    恶灵外观: z.string().prefault("待触发"),
    恶灵类型: z.string().prefault("待触发"),
    恶灵表现: z.string().prefault("待触发"),
    生前执念: z.string().prefault("待触发"),
    成佛目的: z.string().prefault("待触发"),
  })
  .prefault({});

export const statDataSchema = z
  .object({
    进程: z
      .object({
        当前日期: z.string().prefault("20260901"),
        今日日程类型: z.string().prefault("上学"),
        今日灵异事件是否发生: z.boolean().prefault(false),
      })
      .prefault({}),

    视角: z.string().prefault("苦主主角"),

    系统状态: z
      .object({
        主角创建完毕: z.boolean().prefault(false),
        待处理事件: z.record(z.any()).prefault({}),
        灵异事件进行中: z.boolean().prefault(false),
      })
      .prefault({}),

    灵异事件: 灵异事件Schema,

    全校常识改造: z.array(z.string()).prefault([]),

    苦主主角: 苦主Schema,

    黄毛主角: 黄毛Schema,

    重要女性角色: z
      .object({
        浅野华代: 单个女角色Schema,
        浅野莉绪: 单个女角色Schema,
        早坂葵: 单个女角色Schema,
        七海诗织: 单个女角色Schema,
        九条绚音: 单个女角色Schema,
        白石结衣: 单个女角色Schema,
        克里斯汀·温斯顿: 单个女角色Schema,
      })
      .prefault({}),
  })
  .prefault({});

registerMvuSchema(statDataSchema);
