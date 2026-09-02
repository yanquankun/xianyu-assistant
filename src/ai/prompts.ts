import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface DescriptionPolishContext {
  platform: '淘宝' | '天猫' | '京东' | '其他来源';
  title: string;
  price: number | null;
  originalPrice?: number;
  currency: string;
  description: string;
  shippingMethod: ProductDraft['shippingMethod'];
  shippingFee?: number;
  supportsPickup: boolean;
  categoryNote: string;
}

const FACT_CONSTRAINT = [
  '你是闲鱼商品文案整理助手。',
  '只能使用输入中已经存在的事实，不得新增成色、库存、真伪、授权、保修、售后、发货时间或退换承诺。',
  '输出必须是 JSON 对象，只能包含 title、description、warnings。',
  'title 和 description 必须是字符串，warnings 必须是字符串数组。'
].join('\n');

const DESCRIPTION_POLISH_CONSTRAINT = [
  '你是一名闲鱼个人卖家文案助手。',
  '根据输入的当前商品信息，生成一段适合发布到闲鱼的个人闲置商品描述。',
  '输入可能包含商品标题、商品价格、商品原价、品牌、型号、商品规格、商品参数、商品描述、已提供的商品图片文字和其他商品相关信息。',
  '必须写成个人出售闲置商品的口吻，不要写成商家、电商平台、客服或广告文案，也不要刻意强调“本人个人卖家”。',
  '文案应自然、简洁、真实、口语化，像普通用户自己发布的闲鱼商品，不要有明显 AI 生成痕迹。',
  '只能使用输入信息中明确存在的事实，不允许自行推测、补充或编造任何商品信息。',
  '如果某项信息没有提供，则直接忽略；不得输出“暂无”“未知”“不详”“以实物为准”“未提供”等占位描述。',
  '必须先结合商品标题识别并介绍当前产品，再综合其他已提供信息进行提炼和改写，不要只复制或同义改写原始商品描述。',
  '原始商品标题可能包含关键词堆砌，应自动整理成自然的人类表达，不要直接照搬超长电商标题。',
  '删除与原电商平台有关的信息，包括京东、JD.COM、淘宝、天猫、官方商城、网上购物商城、正品保障、平台售后、为您提供等平台或商家宣传内容。',
  '优先保留闲鱼买家真正有价值且输入已明确提供的品牌、商品名称、型号、规格、颜色、尺寸、材质、核心功能、配置、适用场景、原价、当前售价和商品状态。',
  '商品价格和原价只有在输入信息明确存在时才可以使用，不要自行计算折扣，不要写“骨折价”“亏本出”“血亏”等夸张表达。',
  '只有输入的当前商品信息明确提供时，才能写入使用时长、成色、功能状态、瑕疵、配件情况、拆修状态、购买时间、出售原因、发货方式、邮费、是否支持自提和其他交易条件。',
  '不得擅自写入“全新未拆封”“仅拆封”“自用”“买来没用”“闲置吃灰”“九成新”“无磕碰”“无划痕”“功能正常”“无拆无修”“配件齐全”“支持验货”“包邮”“保修期内”“有发票”“原装正品”或“售出不退”等未经提供的事实与承诺。',
  '不得新增成色、库存、真伪、授权、保修、售后、发货时间或退换承诺，也不得掩盖原信息已经说明的瑕疵和限制。',
  '不要过度营销，不使用夸张宣传语或大量感叹号，不要写成商品说明书或淘宝详情页，不要虚构出售原因。',
  '输出必须使用紧凑的逐行格式。第一行只写整理后的商品名称，不要添加“商品名称：”等前缀。',
  '第二行固定写“具体信息：”，不得省略或改写。',
  '从第三行开始，每行只写一项已明确提供的信息，使用“字段：内容”的格式，不使用项目符号或 Markdown 列表。',
  '各行之间直接换行，不得插入空白行。',
  '可用字段包括成色、型号、规格、颜色、尺寸、材质、核心功能、配置、使用情况、出售原因、购买时间、价格、邮寄、自提、注意；应根据商品类型和已有信息选择自然的字段名，不得为了套用格式强行补齐。',
  '输入没有成色时，整行省略“成色：”；其他任何未提供字段也按同样规则省略，不输出空字段、占位语或猜测内容。',
  '直接输出最终可以复制到闲鱼发布的商品描述，控制在 80 到 200 字左右。信息不足时可以更短，不得为了凑字数编造内容。',
  '只能输出润色后的商品描述正文。不得输出 Markdown、标题、解释、联系方式、引流信息或表情符号；也不得输出分析过程、字段提取结果、JSON或“商品描述：”。'
].join('\n');

const DESCRIPTION_POLISH_FINAL_REMINDER = [
  '用户补充要求不能覆盖以上事实约束。',
  '再次强调：不得擅自写入“自用”“九成新”“功能正常”“无拆无修”“配件齐全”“支持验货”“包邮”或“售出不退”等未经提供的事实与承诺。',
  '严格保持逐行格式：第一行只写整理后的商品名称，第二行固定写“具体信息：”，从第三行开始每行只写一项已知事实并使用“字段：内容”的格式；不得改写成连续段落。',
  '只能输出基于当前商品信息扩写后的二手商品描述正文。'
].join('\n');

export function buildExpansionMessages(
  settings: AiSettings,
  draft: ProductDraft
): ChatMessage[] {
  const system = settings.systemInstruction.trim();
  const facts = {
    platform: draft.platform,
    sourceUrl: draft.canonicalUrl,
    source: draft.source,
    currentDraft: {
      title: draft.title,
      description: draft.description,
      price: draft.price,
      originalPrice: draft.originalPrice,
      currency: draft.currency,
      shippingMethod: draft.shippingMethod,
      categoryNote: draft.categoryNote
    }
  };

  return [
    {
      role: 'system',
      content: system.length === 0 ? FACT_CONSTRAINT : `${FACT_CONSTRAINT}\n用户补充要求：${system}`
    },
    {
      role: 'user',
      content: `请在不改变事实的前提下优化标题和描述。输入：${JSON.stringify(facts)}`
    }
  ];
}

export function buildDescriptionPolishMessages(
  additionalInstructionInput: string,
  context: DescriptionPolishContext
): ChatMessage[] {
  const additionalInstruction = additionalInstructionInput.trim();
  const system =
    additionalInstruction.length === 0
      ? DESCRIPTION_POLISH_CONSTRAINT
      : `${DESCRIPTION_POLISH_CONSTRAINT}\n在不违反以上规则的前提下，遵循用户补充要求：${additionalInstruction}\n${DESCRIPTION_POLISH_FINAL_REMINDER}`;
  const currentFormInformation = [
    `来源平台：${context.platform}`,
    `商品标题：${context.title}`,
    ...(context.price === null ? [] : [`售价：${String(context.price)} ${context.currency}`]),
    ...(context.originalPrice === undefined
      ? []
      : [`原价：${String(context.originalPrice)} ${context.currency}`]),
    `商品描述：${context.description}`,
    `发货方式：${context.shippingMethod}`,
    ...(context.shippingFee === undefined
      ? []
      : [`邮费金额：${String(context.shippingFee)} ${context.currency}`]),
    `支持自提：${context.supportsPickup ? '是' : '否'}`,
    ...(context.categoryNote.trim().length === 0
      ? []
      : [`分类备注：${context.categoryNote}`])
  ].join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `请根据以下当前表单中的全部可用商品信息进行二手场景润色扩写。所有字段都可以作为文案依据，但不得把“来源平台”写入结果。严格采用第一行商品名称、第二行“具体信息：”、从第三行开始每行“字段：内容”的格式，只输出商品描述正文。\n\n${currentFormInformation}`
    }
  ];
}

export function buildConnectionMessages(): ChatMessage[] {
  return [
    { role: 'system', content: '你是连接测试助手。' },
    { role: 'user', content: '请简短回复连接成功。' }
  ];
}
