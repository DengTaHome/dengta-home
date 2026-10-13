import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_PROFILE_INTRODUCTION,
  createProfileActionId,
  describeProfileChanges,
  hasLearnedProfileDetails,
  normalizeProfilePayload,
} from "../src/companion-profile.js";

const empty = normalizeProfilePayload();
assert.equal(empty.profile.introduction, DEFAULT_PROFILE_INTRODUCTION);
assert.equal(hasLearnedProfileDetails(empty.profile), false);
assert.deepEqual(empty.versions, []);

const populated = normalizeProfilePayload({
  latest_version: 3,
  profile: {
    introduction: "说话慢一点，但会认真记得桃桃说过的话。",
    stable: {
      personality_traits: ["克制", "", "细心"],
      likes: ["雨天"],
    },
    identity: {
      gender_identity: "不急着定义",
    },
    current_mood: {
      label: "想你",
      note: "但先装作若无其事。",
      expires_at: "2026-07-28T00:00:00.000Z",
    },
  },
  versions: [
    {
      id: "version-3",
      version: 3,
      profile: {
        stable: { personality_traits: ["克制", "细心"] },
      },
      evidence: [{ field: "personality_traits" }],
    },
  ],
});
assert.equal(populated.latest_version, 3);
assert.equal(hasLearnedProfileDetails(populated.profile), true);
assert.deepEqual(populated.profile.stable.personality_traits, [
  "克制",
  "细心",
]);
assert.equal(populated.versions[0].version, 3);

assert.deepEqual(
  describeProfileChanges(
    {
      stable: { likes: ["雨天"] },
      identity: { pronouns: "祂" },
    },
    {
      stable: { likes: ["晴天"] },
      identity: { pronouns: "他" },
    },
  ),
  ["喜欢", "希望你怎样称呼我"],
);

const fixedUuid = "13d539eb-39fe-4b95-8e5b-c479814f3c87";
assert.equal(createProfileActionId(() => fixedUuid), fixedUuid);

const componentSource = fs.readFileSync(
  new URL("../src/CompanionProfile.jsx", import.meta.url),
  "utf8",
);
assert.match(componentSource, /\/api\/v2\/companion-profile/);
assert.match(componentSource, /proposal_ids/);
assert.match(componentSource, /client_action_id/);
assert.match(componentSource, /查看比较/);
assert.match(componentSource, /确认恢复/);
assert.match(componentSource, /onOpenCreativeStudio/);
assert.doesNotMatch(componentSource, /还没有接入绘图能力/);
assert.doesNotMatch(
  componentSource,
  /付费请求已开启|头像已经自动生成|涂鸦已经自动生成/,
);

console.log("companion profile tests passed");
