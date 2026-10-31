import { t } from "@/i18n/runtime";
function localized<T extends Record<string, string>>(values: T): T {
  return new Proxy(values, { get: (target, key: string) => t(target[key] || key) });
}
export const decisionLabels = localized({
  pending: "待处理",
  adopted: "已采纳",
  dismissed: "不处理",
  needs_detail: "需补充",
});
export const checkLabels: Record<string, string> = localized({
  rules_confirmed: "规则已人工确认",
  evidence: "原文引用命中",
  hts_exists: "税号存在",
  baseline_match: "基准税率一致",
  unverified_fields: "未核实字段",
});
export const validationLabels: Record<string, string> = localized({
  V1: "原文引用逐字命中",
  V2: "字段均有引用",
  V3: "日期合理",
  V4: "税率范围",
  V5: "第99章税号存在",
  V6: "目标税号存在",
  V7: "与已确认规则冲突",
  V8: "新增措施字段完整",
  V9: "排除到期日必填",
});
export const statusLabels: Record<string, string> = localized({
  pass: "通过",
  warn: "注意",
  fail: "不通过",
  "n/a": "不适用",
  pending: "等待",
  running: "运行中",
  succeeded: "完成",
  failed: "失败",
  partial: "部分完成",
  skipped_no_fixture: "无夹具跳过",
});
export const agentLabels: Record<string, string> = localized({
  collector_fr: "联邦公报采集",
  collector_pi: "公开预览采集",
  collector_usitc: "税则版本检查",
  collector: "政策采集",
  triage: "分诊",
  extract: "抽取",
  validate: "校验",
  brief: "日报",
  impact: "计算引擎",
  human: "你（待决定）",
});
export const legalLabels: Record<string, string> = localized({
  in_force: "已生效",
  signed_pending: "已签署待生效",
  scheduled_expiry: "按期到期",
  proposed: "拟议",
  investigation: "调查中",
  negotiation_no_tariff: "谈判中（无税率）",
  court_ruling: "法院裁决",
  procedural: "程序性",
});
export const draftLabels: Record<string, string> = localized({
  draft: "待确认",
  needs_detail: "需补充",
  approved: "已确认",
  rejected: "已驳回",
});
export const changeLabels: Record<string, string> = localized({
  program_add: "新增措施",
  program_update: "修改措施",
  hts_profile_update: "修改税号规则",
  watch_item_upsert: "观察项",
  no_rate_change: "无税率变化",
});
export const auditLabels: Record<string, string> = localized({
  KB_EDITED: "编辑知识",
  KB_RESTORED: "恢复知识",
  KB_CREATED: "新建知识",
  KB_DELETED: "删除知识",
  KB_UNDELETED: "恢复知识",
  CHAT_DELETED: "删除对话",
  TRADE_LINK_CHANGED: "关联客户",
  CHAT_ORDER_DATA_SENT: "对话外发订单",
  IMPORT_SENT_TO_MODEL: "文件外发识别",
  ORDERS_IMPORTED: "导入",
  RUN_CREATED: "重算",
  COLLECTED: "采集",
  TRIAGED: "分诊",
  EXTRACTED: "抽取",
  VALIDATED: "校验",
  RULE_APPROVED: "确认规则",
  RULE_REJECTED: "驳回规则",
  RULE_NEEDS_DETAIL: "规则需补充",
  BRIEF_PUBLISHED: "日报",
  DECIDED: "决策",
  LLM_SETTINGS_CHANGED: "模型配置",
});
