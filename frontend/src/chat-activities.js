export const ACTIVITY_CATEGORIES = [
  { id: "story", label: "共同故事" },
  { id: "little-step", label: "一起做件小事" },
  { id: "game", label: "接力游戏" },
];

export const CHAT_ACTIVITIES = [
  { id: "rain-bookshop", category: "story", icon: "☂", title: "雨夜的无人书店", detail: "一封信，一个只在雨天出现的地址。",
    prompt: "我们一起编个故事：雨夜，我们躲进一家无人书店，柜台上放着写给我们的信。沿用我们的角色设定，你先写一个简短开场，留一个让我决定的动作，等我接下去。" },
  { id: "cotton-spaceship", category: "story", icon: "✧", title: "小棉花的纸箱飞船", detail: "让桌宠成为我们故事里的小伙伴。",
    prompt: "来编一个虚构的小故事：桌宠小棉花发现一只纸箱飞船，要带我们去寻找失落的星星。沿用我们的角色设定，你先写起飞前的一幕，把下一步选择留给我，我们轮流续写。" },
  { id: "tiny-tidy", category: "little-step", icon: "✿", title: "只整理一个小角落", detail: "从一件东西开始，不用列一长串计划。",
    prompt: "陪我整理一个小角落吧。先问我想整理哪里，然后每次只陪我做一个小步骤，等我告诉你做完了再继续。我今天只想轻松完成一点点。" },
  { id: "tiny-discovery", category: "little-step", icon: "◉", title: "今天的微小发现", detail: "找一处颜色、声音或有趣的小细节。",
    prompt: "我们玩一次小小的观察寻宝吧。你先给我一个身边就能找的小线索，等我用文字或照片告诉你发现了什么，再接着聊。先从一个简单的颜色线索开始。" },
  { id: "three-words", category: "game", icon: "✎", title: "三个词，一段奇遇", detail: "你出三个词，我们每人接一句。",
    prompt: "我们玩三个词的故事接龙：你先给三个意想不到的词，再用一句话开头；之后我们每人只接一句，等对方继续。故事风格可以跟着我们聊天的感觉走。" },
  { id: "twenty-questions", category: "game", icon: "?", title: "二十问猜一猜", detail: "我来想，你来问，看几次能猜中。",
    prompt: "我们玩二十问：我在心里想一个普通物品，你每轮只问一个可以用“是、不是、不确定”回答的问题，最多问二十次。等我回答后再问下一题，先等我说准备好了。" },
];

export function appendActivityDraft(current, activity) {
  if (!String(activity || "").trim()) return current;
  return current ? `${current}\n\n${activity}` : activity;
}

export function pickActivity(previousId, random = Math.random) {
  const pool = CHAT_ACTIVITIES.filter(item => item.id !== previousId);
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))];
}
