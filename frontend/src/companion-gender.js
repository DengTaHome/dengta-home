export const COMPANION_GENDERS = Object.freeze([
  { value: "unspecified", label: "未设置", pronoun: "TA" },
  { value: "male", label: "男性", pronoun: "他" },
  { value: "female", label: "女性", pronoun: "她" },
  { value: "transgender", label: "跨性别", pronoun: "TA" },
  { value: "mtf", label: "跨性别女性（MTF）", pronoun: "她" },
  { value: "ftm", label: "跨性别男性（FTM）", pronoun: "他" },
  { value: "non_binary", label: "非二元性别", pronoun: "TA" },
  { value: "other", label: "其他性别", pronoun: "TA" },
]);

export function companionPronoun(settings = {}) {
  const custom = String(settings.ai_pronouns || "").trim();
  return custom || COMPANION_GENDERS.find(({ value }) => value === settings.ai_gender)?.pronoun || "TA";
}
