import { readAccountStorage, writeAccountStorage } from "./account-storage.js";

const CATEGORY_HELP = {
  appearance: {
    description: "调整主题、气泡、头像和动效",
    keywords: "皮肤 字体 颜色 壁纸 外观 头像 theme",
  },
  persona: {
    description: "写下偏好，管理记忆与主动消息",
    keywords: "个性化 指令 提示词 人设 详情 长期 稳定 记忆 关系 主动消息 prompt memory",
  },
  services: {
    description: "连接模型接口，查看服务状态",
    keywords: "模型 接口 api key 密钥 供应商 服务 生图 创作",
  },
  voice: {
    description: "设置语音输入、朗读和情绪理解",
    keywords: "语音 麦克风 声音 朗读 播放 情绪 tts",
  },
  devices: {
    description: "管理通知、活动感知、共看与工具连接",
    keywords: "设备 通知 屏幕 感知 共看 一起看 投屏 工具 mcp",
  },
  fun: {
    description: "发现成就、纪念日和生活玩法",
    keywords: "趣味 成就 纪念日 玩法 外卖 小红书 登录",
  },
  "data-import": {
    description: "带入已有的世界书和聊天记录",
    keywords: "导入 数据 世界书 聊天记录 历史 import",
  },
  "data-export": {
    description: "导出聊天、设定与记忆备份",
    keywords: "导出 数据 备份 聊天 设定 记忆 export backup",
  },
  "music-import": {
    description: "导入网易云歌单，也可搜索音乐",
    keywords: "音乐 网易云 歌单 导入 搜索 一起听 music",
  },
  logs: {
    description: "查看错误记录和排查线索",
    keywords: "错误 报错 日志 排查 失败 超时 连接 error log",
  },
};

export const SETTINGS_GROUPS = [
  {
    id: "conversation",
    label: "聊天与陪伴",
    description: "从表达偏好到聊天体验",
    categoryIds: ["persona", "appearance", "voice"],
  },
  {
    id: "connections",
    label: "连接与工具",
    description: "让模型、设备与服务连接起来",
    categoryIds: ["services", "devices"],
  },
  {
    id: "explore",
    label: "一起探索",
    description: "听音乐，发现生活里的小玩法",
    categoryIds: ["fun", "music-import"],
  },
  {
    id: "data",
    label: "数据与排查",
    description: "带入记录、保留备份、查看问题",
    categoryIds: ["data-import", "data-export", "logs"],
  },
];

export const SETTINGS_QUICK_LINKS = [
  { categoryId: "persona", label: "写下偏好" },
  { categoryId: "services", label: "连接模型" },
  { categoryId: "fun", label: "发现玩法" },
];

export const SETTINGS_QUICK_LINK_LIMIT = 4;
export const SETTINGS_QUICK_LINKS_STORAGE_KEY = "dengta.settings-quick-links.v1";

export function normalizeSettingsQuickLinks(value, categories = []) {
  const available = new Set(categories.map((category) => category.id));
  const ids = Array.isArray(value) ? value : SETTINGS_QUICK_LINKS.map((link) => link.categoryId);
  return [...new Set(ids.filter((id) => typeof id === "string" && available.has(id)))].slice(0, SETTINGS_QUICK_LINK_LIMIT);
}

export function readSettingsQuickLinks(categories = [], preferenceScope = "", storage) {
  if (!String(preferenceScope || "").trim()) return normalizeSettingsQuickLinks(null, categories);
  try {
    const raw = readAccountStorage(storage ?? globalThis.localStorage, SETTINGS_QUICK_LINKS_STORAGE_KEY, preferenceScope);
    return normalizeSettingsQuickLinks(raw === null ? null : JSON.parse(raw), categories);
  } catch {
    return normalizeSettingsQuickLinks(null, categories);
  }
}

export function writeSettingsQuickLinks(ids, categories = [], preferenceScope = "", storage) {
  const normalized = normalizeSettingsQuickLinks(ids, categories);
  if (!String(preferenceScope || "").trim()) return { ids: normalized, persisted: false };
  try {
    const target = storage ?? globalThis.localStorage;
    if (typeof target?.setItem !== "function") return { ids: normalized, persisted: false };
    writeAccountStorage(target, SETTINGS_QUICK_LINKS_STORAGE_KEY, preferenceScope, JSON.stringify(normalized));
    return { ids: normalized, persisted: true };
  } catch {
    return { ids: normalized, persisted: false };
  }
}

export const SETTINGS_STARTER_STEPS = [
  {
    categoryId: "services",
    label: "连接一个模型",
    description: "选择接口和模型；已有可用配置时，可以直接聊天。",
  },
  {
    categoryId: "persona",
    label: "写下你的偏好",
    description: "填写希望采用的称呼、表达方式和背景。",
  },
  {
    categoryId: "appearance",
    label: "调整聊天体验",
    description: "选一个喜欢的主题，语音等功能可以按需要再配置。",
  },
];

function normalizeSearch(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
}

export function buildSettingsGroups(categories = [], query = "") {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const entries = categories.map((category) => {
    const help = CATEGORY_HELP[category.id];
    return {
      ...category,
      description: help?.description || category.description || "打开查看可用选项",
      searchText: normalizeSearch([
        category.label,
        category.description,
        help?.description,
        help?.keywords,
      ].filter(Boolean).join(" ")),
    };
  });
  const groupedIds = new Set(SETTINGS_GROUPS.flatMap((group) => group.categoryIds));
  const definitions = [
    ...SETTINGS_GROUPS,
    {
      id: "more",
      label: "更多设置",
      description: "其他可用功能",
      categoryIds: entries.filter((entry) => !groupedIds.has(entry.id)).map((entry) => entry.id),
    },
  ];

  return definitions.map((group) => ({
    ...group,
    categories: group.categoryIds
      .map((id) => entries.find((entry) => entry.id === id))
      .filter((entry) => entry && terms.every((term) => entry.searchText.includes(term))),
  })).filter((group) => group.categories.length > 0);
}
