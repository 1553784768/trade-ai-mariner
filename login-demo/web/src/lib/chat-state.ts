export type ChatState = { chatController?: AbortController | null; conversationId?: string | number | null };
export function isChatBusy(state: ChatState) {
  return Boolean(state.chatController);
}

export function contextNavigationState<T extends ChatState>(state: T, context: string) {
  return { ...state, context };
}

export function canOpenConversation(state: ChatState, conversationId: string | number) {
  if (!isChatBusy(state)) return true;
  return state.conversationId != null && String(state.conversationId) === String(conversationId);
}

const TOOL_INTENT =
  /(查|搜索|检索|浏览|网页|官网|链接|文件|下载|抓取|打开|search|browse|website|url|file|download|fetch)/i;
const CONTINUATION = /^(请)?(继续|接着|然后|往下|接着说|继续说|继续写|接着写|continue|goon|keepgoing)/i;

export function isContinuationRequest(content: string) {
  const text = String(content || "").trim();
  if (!text || text.length > 40 || TOOL_INTENT.test(text)) return false;
  return CONTINUATION.test(text.replace(/[\s，。！？,.!?;；:：]+/g, ""));
}

export function shouldUseHermesTools(enabled: boolean, content: string, retryFailedToolTurn = false) {
  return Boolean(enabled) && (Boolean(retryFailedToolTurn) || !isContinuationRequest(content));
}
