export const INSPIRATION_CATEGORIES = Object.freeze([
  { id: "all", label: "随便一张" },
  { id: "story", label: "共创故事" },
  { id: "daily", label: "轻聊日常" },
  { id: "together", label: "一起体验" },
  { id: "play", label: "脑洞游戏" },
]);

export const COMPANION_INSPIRATIONS = Object.freeze([
  { id: "story", category: "story", symbol: "✦", title: "一分钟接龙", hint: "一人一句，看看故事会走向哪里。", draft: "我们来玩一分钟故事接龙吧。一盏不会熄灭的灯出现在夜市里，你先写一句开头，我接下一句。" },
  { id: "colors", category: "daily", symbol: "◒", title: "今天是什么颜色", hint: "用一个颜色分享此刻的心情。", draft: "我想用一个颜色描述今天的心情。你先选一个颜色，说说为什么，然后我们一起给今天起个名字。" },
  { id: "music", category: "together", symbol: "♫", title: "交换一首歌", hint: "找一首适合现在一起听的歌。", draft: "我想和你一起听歌。帮我找一首适合现在的歌，我们听完再各说一句喜欢它的原因。" },
  { id: "question", category: "play", symbol: "?", title: "脑洞二选一", hint: "没有正确答案，跟着直觉选。", draft: "陪我玩一个脑洞二选一吧：如果能拥有一间漂浮在云上的小屋，或一艘停在海边的小船，你会选哪一个？先说你的选择，再问我。" },
  { id: "movie", category: "together", symbol: "▷", title: "今晚的放映厅", hint: "一起挑个短视频或电影。", draft: "我想和你一起看点东西。先问我今晚想看轻松、冒险还是有点悬念的，再帮我挑一个。" },
  { id: "small", category: "daily", symbol: "☼", title: "收藏一个小瞬间", hint: "聊一件今天很小、却值得记住的事。", draft: "今天有个很小的瞬间，我想慢慢讲给你听。你也讲一个属于你这个角色的小瞬间吧，我们轮流说。" },
  { id: "detective", category: "story", symbol: "◇", title: "双人侦探", hint: "你发现线索，伴侣负责把谜团接下去。", draft: "我们来共创一个虚构的双人侦探故事。海边书店收到一封没有寄件人的信，你先给出一个线索，再让我决定下一步，先不要揭晓谜底。" },
  { id: "three-words", category: "story", symbol: "✧", title: "三词接龙", hint: "把不相干的词，接成一段冒险。", draft: "陪我玩三词故事接龙：星光、车站、旧钥匙。你用这三个词写两句开头，然后我们一人两句继续，让我也能改变故事走向。" },
  { id: "postcard", category: "daily", symbol: "▱", title: "寄给未来的明信片", hint: "给未来留一句现在想说的话。", draft: "我们各写一张寄给未来的虚构明信片吧。你先以当前角色的口吻写三句话，再邀请我写自己的。先在聊天里分享，由我决定要不要收藏。" },
  { id: "interview", category: "play", symbol: "◌", title: "角色小采访", hint: "互相问一个有趣、没有标准答案的问题。", draft: "我们来玩角色小采访。先问我一个轻松、有点脑洞的问题，我回答后换我采访你。你的回答沿用我们现在的角色设定。" },
  { id: "design-shop", category: "together", symbol: "⌂", title: "一起开一家小店", hint: "从名字到招牌，两个人轮流决定。", draft: "我们来想象一起开一家小店吧。你先提两个不同风格让我选，然后我们轮流决定名字、招牌和店里最特别的一样东西。" },
  { id: "reverse-choice", category: "play", symbol: "↔", title: "奇怪物品交换会", hint: "为一个普通物品编一个奇妙用途。", draft: "陪我玩虚构的奇怪物品交换会。你先拿出一个普通物品，给它编一个出人意料的用途，再问我要拿什么来换。一轮一个物品，我们轮流来。" },
].map(Object.freeze));

export function pickCompanionInspiration(previousId, random = Math.random) {
  return drawCompanionInspiration({ previousId }, random).card;
}

export function drawCompanionInspiration({ category = "all", previousId, seenIds = [] } = {}, random = Math.random) {
  const selection = COMPANION_INSPIRATIONS.filter(item => category === "all" || item.category === category);
  const eligible = selection.length ? selection : COMPANION_INSPIRATIONS;
  const seen = new Set(Array.isArray(seenIds) ? seenIds : []);
  let pool = eligible.filter(item => item.id !== previousId && !seen.has(item.id));
  const restarted = pool.length === 0;
  if (restarted) pool = eligible.filter(item => item.id !== previousId);
  if (!pool.length) pool = eligible;
  const value = Number(random());
  const index = Math.floor(Math.max(0, Math.min(Number.isFinite(value) ? value : 0, 0.999999)) * pool.length);
  const card = pool[index];
  return { card, seenIds: restarted ? [card.id] : [...eligible.filter(item => seen.has(item.id)).map(item => item.id), card.id], restarted };
}
