import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadEntrypointCssCascade } from "./helpers/effective-css.js";
import {
  DEFAULT_CHAT_SKIN_PREFERENCES,
  chatSkinPreferencesApiPayload,
  getMessageSkinPresentation,
  normalizeChatSkinPreferences,
} from "../src/chat-skin.js";

test("chat skin preferences keep only supported user-facing choices", () => {
  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: false,
      reduceMotion: true,
      unexpected: "ignored",
    }),
    {
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: false,
      reduceMotion: true,
    },
  );

  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "unknown",
      ornamentActivity: "constant",
      dynamicComposerHint: "yes",
      reduceMotion: 1,
    }),
    DEFAULT_CHAT_SKIN_PREFERENCES,
  );
});

test("chat skin preferences convert between API and React field names", () => {
  assert.deepEqual(
    normalizeChatSkinPreferences({
      skin: "taotao-cream",
      ornament_activity: "quiet",
      dynamic_composer_hint: false,
      reduce_motion: true,
    }),
    {
      skin: "taotao-cream",
      ornamentActivity: "quiet",
      dynamicComposerHint: false,
      reduceMotion: true,
    },
  );
  assert.deepEqual(
    chatSkinPreferencesApiPayload({
      skin: "taotao-cream",
      ornamentActivity: "lively",
      dynamicComposerHint: true,
      reduceMotion: false,
    }),
    {
      skin: "taotao-cream",
      ornament_activity: "lively",
      dynamic_composer_hint: true,
      reduce_motion: false,
    },
  );
});

test("cream skin ornaments appear only at the start of a text message group", () => {
  const messages = [
    { id: "a1", role: "assistant", content: "第一句" },
    { id: "a2", role: "assistant", content: "接着说" },
    { id: "u1", role: "user", content: "好呀" },
    {
      id: "a3",
      role: "assistant",
      content: "",
      tool_calls: { sticker_id: "sleepy" },
    },
  ];

  assert.deepEqual(
    messages.map((_, index) =>
      getMessageSkinPresentation(messages, index, {
        skin: "taotao-cream",
        ornamentActivity: "natural",
      }),
    ),
    [
      { groupStart: true, groupEnd: false, showOrnament: true },
      { groupStart: false, groupEnd: true, showOrnament: false },
      { groupStart: true, groupEnd: true, showOrnament: true },
      { groupStart: true, groupEnd: true, showOrnament: false },
    ],
  );

  assert.equal(
    getMessageSkinPresentation(messages, 0, {
      skin: "taotao-cream",
      ornamentActivity: "quiet",
    }).showOrnament,
    false,
  );
  assert.equal(
    getMessageSkinPresentation(messages, 0, {
      skin: "classic-glass",
      ornamentActivity: "lively",
    }).showOrnament,
    false,
  );
});

test("the cream skin keeps local font, role-specific ornaments and reduced-motion fallback", () => {
  const css = fs.readFileSync(new URL("../src/native-feel.css", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const ornament = fs.readFileSync(
    new URL("../src/ChatSkinOrnament.jsx", import.meta.url),
    "utf8",
  );
  const fontLicense = fs.readFileSync(
    new URL("../public/fonts/OFL-ChillRound.txt", import.meta.url),
    "utf8",
  );
  assert.match(css, /ChillRoundF-v3\.0\.ttf/);
  assert.match(css, /data-chat-skin="taotao-cream"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /<ChatTranscript/);
  assert.match(fs.readFileSync(new URL("../src/ChatTranscript.jsx",import.meta.url),"utf8"), /getMessageSkinPresentation/);
  assert.match(app, /placeholder=\{[\s\S]*?composerHint/);
  assert.match(ornament, /isUser \? "is-cat" : "is-bear"/);
  assert.ok(
    (ornament.match(/className="ornament-ear"/g) || []).length >= 2,
    "the assistant's default bear must have two round ears",
  );
  assert.match(fontLicense, /SIL Open Font License, Version 1\.1/);
});

test("cream ornaments stay clear of the previous bubble and remain recognizable", () => {
  const cascade = loadEntrypointCssCascade(
    new URL("../src/main.jsx", import.meta.url),
    { width: 390, height: 844, reducedMotion: false },
  );
  const baseMessage = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-cream-message',
  );
  const groupStart = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-cream-message.group-start',
  );
  const ornament = cascade.declarations(
    '.app-shell[data-chat-skin="taotao-cream"] .chat-skin-ornament',
  );
  const pixels = (declaration) => Number.parseFloat(declaration?.value || "NaN");
  const previousBottomMargin = pixels(baseMessage["margin-block"]);
  const reservedTopSpace = pixels(groupStart["padding-top"]);
  const ornamentOffset = Math.abs(pixels(ornament.top));
  const ornamentHeight = pixels(ornament.height);

  assert.ok(
    reservedTopSpace >= ornamentOffset,
    "the ornament must stay inside the message row's paint-contained area",
  );
  assert.ok(
    previousBottomMargin * 2 + reservedTopSpace - ornamentOffset >= 0,
    "an ornament must not overlap the preceding message bubble",
  );
  assert.ok(
    ornamentOffset / ornamentHeight >= 0.8,
    "at least 80% of the character must sit above the bubble edge",
  );
});

test("the composer uses an original code-rendered iridescent mark", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const mark = fs.readFileSync(
    new URL("../src/RainbowAgentMark.jsx", import.meta.url),
    "utf8",
  );
  const css = fs.readFileSync(
    new URL("../src/sun-glass-ui.css", import.meta.url),
    "utf8",
  );

  assert.match(app, /<RainbowAgentMark\s*\/>/);
  assert.doesNotMatch(mark, /<img/);
  assert.match(mark, /rainbow-agent-mark-lens/);
  assert.match(mark, /rainbow-agent-mark-caustic/);
  assert.match(mark, /rainbow-agent-mark-star/);
  assert.match(mark, /rainbow-agent-mark-glint/);
  assert.match(css, /\.rainbow-agent-mark-caustic\s*\{/);
  assert.match(css, /\.rainbow-agent-mark-star\s*\{/);
  assert.doesNotMatch(mark, /Gemini/i);
});
