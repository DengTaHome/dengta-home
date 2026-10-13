export const GUIDE_STEPS = [
  { id: "hello", title: "先聊一句", action: "去聊天", text: "在底部输入框写一句你想说的话，再点发送。等伴侣回复，就完成了一次对话。不知道说什么，可以先试试“你好，今天想和你认识一下”。" },
  { id: "connect", title: "需要时再接入", action: "看看连接设置", text: "如果已经能聊天，这步可以跳过。如果提示尚未接入，打开连接设置，选择你使用的模型服务，按页面填写服务提供的地址和密钥。密钥是服务给你的访问凭证，不要发进聊天。" },
  { id: "explore", title: "挑一个喜欢的玩法", action: "去挑一个开场", text: "回到聊天，点输入框旁的“更多输入功能”，展开“一起玩”。挑个故事或小任务，改成自己的说法，放进输入框后再发送。选卡片不会自动发消息。" },
  { id: "keepsake", title: "留一份小纪念", action: "收下入门纪念", text: "完成第一次对话后，可以收下入门纪念。其他步骤按自己的需要体验就好；跳过不影响聊天，也不会失去已有成就。" },
];

export function guideStorageKey(account, companion) {
  return account && companion ? `dengta_guide_v2:${JSON.stringify([account, companion])}` : null;
}

export function readGuidePreferences(key) {
  try {
    const raw = key ? JSON.parse(globalThis.localStorage?.getItem(key) || "{}") : {};
    return {
      collapsed: raw.collapsed !== false,
      step: GUIDE_STEPS.some(item => item.id === raw.step) ? raw.step : "hello",
      visited: Array.isArray(raw.visited) ? raw.visited.filter(id => GUIDE_STEPS.some(item => item.id === id)) : [],
    };
  } catch { return { collapsed: true, step: "hello", visited: [] }; }
}

export function saveGuidePreferences(key, value) {
  try { if (key) globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can keep progress in memory. */ }
}

export const ACHIEVEMENT_ACTIONS = {
  first_chat: { label: "去聊一句", view: "chat" },
  onboarding_1: { label: "看看入门路线", view: "guide" },
  moment_1: { label: "去写动态", view: "moments" },
  music_1: { label: "去保存音乐分析", view: "music" },
  watch_1: { label: "去一起看", view: "together" },
};

export function freshAchievements(previous, items) {
  if (!previous) return [];
  const known = new Set(previous);
  return items.filter(item => item.unlocked && !known.has(item.code || item.id));
}
