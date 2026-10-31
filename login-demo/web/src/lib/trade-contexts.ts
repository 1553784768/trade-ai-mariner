export const CONTEXTS: Record<string, { title: string; skill: string; intro: string; prompts: string[] }> = {
  daily: {
    title: "今日简报",
    skill: "b2b-daily-automation",
    intro: "整理今天最值得处理的客户、订单和跟进事项。",
    prompts: ["生成今天的早安简报", "总结本周客户跟进进度", "今天应该优先联系哪些客户？"],
  },
  lead: {
    title: "客户开发",
    skill: "b2b-lead-generation",
    intro: "告诉我你卖什么、目标市场，以及想找哪类客户。",
    prompts: ["帮我制定本周客户开发计划", "根据产品定位筛选目标客户类型", "生成一套多通道获客流程"],
  },
  platform: {
    title: "网站诊断",
    skill: "b2b-platform",
    intro: "粘贴 B2B 平台、公司官网或独立站链接，分析内容和转化问题。",
    prompts: ["分析我的产品页有什么转化问题", "为独立站设计询盘优化方案", "评估阿里国际站产品标题"],
  },
  social: {
    title: "社媒营销",
    skill: "b2b-social-media",
    intro: "规划 Facebook、Instagram、TikTok、YouTube 等渠道内容。",
    prompts: ["生成本周社媒内容日历", "把产品卖点改成短视频选题", "设计一组客户案例帖子"],
  },
  linkedin: {
    title: "LinkedIn 营销",
    skill: "b2b-linkedin-marketing",
    intro: "优化 LinkedIn 主页、内容计划和客户开发流程。",
    prompts: ["优化我的 LinkedIn Profile", "生成一个月 LinkedIn 内容计划", "设计 LinkedIn 客户开发六步流程"],
  },
  customs: {
    title: "海关数据",
    skill: "b2b-customs-data",
    intro: "描述要分析的市场、产品或上传的数据；涉及实时数据时会说明需要核验。",
    prompts: ["分析欧洲水泵采购市场", "设计海关数据分析维度", "如何用进口记录筛选采购商？"],
  },
  docgen: {
    title: "文档生成",
    skill: "b2b-doc-generation",
    intro: "描述要生成的报价单、PI、合同或业务方案。",
    prompts: ["生成一份报价单内容", "起草一份 PI", "为欧洲客户准备商业提案"],
  },
  docs: {
    title: "文档库问答",
    skill: "b2b-document",
    intro: "选择当前文档库中的资料后提问，或直接粘贴需要分析的内容。",
    prompts: ["概括所选文档的重点", "从产品资料中提取报价参数", "分析合同中的付款和交期条款"],
  },
};
