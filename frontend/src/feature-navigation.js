export const FEATURE_GROUPS = [
  { label: "日常陪伴", ids: ["chat", "cotton", "moments", "diary", "art"] },
  { label: "一起体验", ids: ["together", "music", "duel", "nursery"] },
  { label: "记录与探索", ids: ["memories", "treasure", "achievements", "discover", "takeout", "workspace"] },
];
export const FEATURE_LABELS = { chat: "聊天", moments: "动态", diary: "日记", art: "涂鸦画室", nursery: "家庭", cotton: "小棉花", together: "一起看", music: "听歌", duel: "互动挑战", memories: "记忆", treasure: "藏宝地图", achievements: "成就", discover: "发现", takeout: "外卖", workspace: "工作区" };
export const QUICK_FEATURES = ["chat", "together", "cotton", "achievements"];

export const FEATURE_DETAILS = {
  chat: { hint: "接着聊，也能一起编故事", keywords: "对话 消息 故事 接龙 游戏 语音" },
  cotton: { hint: "摸摸它，陪它玩一会儿", keywords: "桌宠 宠物 猫 小猫 摸摸 飞船" },
  moments: { hint: "分享今天的小事", keywords: "朋友圈 分享 帖子 照片" },
  diary: { hint: "翻翻伴侣留下的日常", keywords: "日志 日常 回忆" },
  art: { hint: "画张涂鸦，或收到一份小礼物", keywords: "绘画 图片 画册 创作 自主 惊喜 头像 表情包" },
  together: { hint: "选个视频，一起看", keywords: "电影 视频 观影 放映厅 投屏 哔哩哔哩 B站" },
  music: { hint: "放一首歌，一起听", keywords: "音乐 歌单 网易云 一起听" },
  duel: { hint: "来一场互动挑战", keywords: "对决 比赛 游戏 duel" },
  nursery: { hint: "看看你们的小家庭", keywords: "养成 家人 孩子 宝宝 family" },
  memories: { hint: "查看和管理聊天记忆", keywords: "长期记忆 MCP Ombre ombrrbrain Kiwi 回忆" },
  treasure: { hint: "走近一封信，发现沿途小惊喜", keywords: "地图 定位 藏宝 来信 公共 惊喜 letter map" },
  achievements: { hint: "看看入门路线和小纪念", keywords: "引导 新手 教程 任务 奖励 徽章" },
  discover: { hint: "找找新的兴趣和灵感", keywords: "推荐 兴趣 探索 小红书" },
  takeout: { hint: "查看外卖任务与进度", keywords: "点餐 订单 吃饭 配送" },
  workspace: { hint: "查看笔记、文件和离线副本", keywords: "文件 笔记 代码 缓存 离线 下载" },
};

export function filterFeatures(items, query = "") {
  const terms = String(query).normalize("NFKC").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const details = FEATURE_DETAILS[item.id];
    const text = `${FEATURE_LABELS[item.id] || ""} ${item.label} ${details?.hint || ""} ${details?.keywords || ""}`.normalize("NFKC").toLowerCase();
    return terms.every(term => text.includes(term));
  });
}
