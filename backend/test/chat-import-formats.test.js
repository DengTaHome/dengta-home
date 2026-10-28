/**
 * 自适应解析器新增格式测试：微信/QQ/WhatsApp/Telegram/Discord/DSH/MHT/XLSX。
 */
"use strict";

const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const JSZip = require("jszip");
const {
    extractText,
    parseDshJsonl,
    parseMessengerText,
    parseMht,
    parseXlsx,
    sniffMagic
} = require("../services/adaptive-file-parser");

const WECHAT_TXT = [
    "2024-01-01 12:00:00 小明",
    "今天好累啊，不想加班了",
    "2024-01-01 12:01:00 小美",
    "抱抱你，晚上早点睡，别熬太晚",
    "2024-01-01 12:02:00 小明",
    "嗯嗯，听你的 🥺"
].join("\n");

const QQ_TXT = [
    "2024-01-01 12:00:00 小明(12345678)",
    "晚上一起打游戏吗？",
    "2024-01-01 12:01:00 小美(87654321)",
    "好呀，等我洗完澡～"
].join("\n");

const WHATSAPP_TXT = [
    "[01/01/24, 12:00:00] Alice: 你好呀",
    "[01/01/24, 12:01:00] Bob: 你好，今天怎么样？",
    "[01/01/24, 12:02:00] Alice: 还不错，就是有点累"
].join("\n");

const TELEGRAM_JSON = JSON.stringify({
    messages: [
        { from: "Alice", date: 1704067200, text: "你好呀" },
        { from: "Bob", date: 1704067260, text: [{ type: "text", text: "今天怎么样？" }] }
    ]
});

const DISCORD_JSON = JSON.stringify({
    messages: [
        { author: { username: "Alice" }, content: "晚上好", timestamp: "2024-01-01T12:00:00+00:00" },
        { author: { username: "Bob" }, content: "晚上好呀", timestamp: "2024-01-01T12:01:00+00:00" }
    ]
});

const DSH_EVENTS = [
    { type: "user/message", seq: 1, time: 1704067200000, data: { message: { role: "user", content: [{ type: "text", text: "帮我看看这个 bug" }] } } },
    { type: "tool/call", seq: 2, time: 1704067201000, data: {} },
    { type: "assistant/message", seq: 3, time: 1704067202000, data: { message: { role: "assistant", content: [{ type: "text", text: "已经定位到日志里的异常了。" }] } } },
    { type: "assistant/message", seq: 4, time: 1704067203000, data: { message: { role: "assistant", content: [{ type: "text", text: "要不要我直接改？" }] } } }
];

const MHT_SAMPLE = [
    "MIME-Version: 1.0",
    'Content-Type: multipart/related; boundary="----=_NextPart_01"',
    "",
    "------=_NextPart_01",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<html><body><table><tr><td>2024-01-01 12:00:00</td><td>=E5=B0=8F=E6=98=8E</td><td>=E4=BD=A0=E5=A5=BD</td></tr></table></body></html>",
    "------=_NextPart_01--"
].join("\r\n");

async function makeXlsx() {
    const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>时间</t></si><si><t>发送者</t></si><si><t>内容</t></si>
  <si><t>2024-01-01 12:00:00</t></si><si><t>小明</t></si><si><t>你好呀</t></si>
  <si><t>2024-01-01 12:01:00</t></si><si><t>小美</t></si><si><t>晚上好</t></si>
</sst>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c></row>
  </sheetData>
</worksheet>`;
    const zip = new JSZip();
    zip.file("xl/sharedStrings.xml", sharedStrings);
    zip.file("xl/worksheets/sheet1.xml", sheet);
    return zip.generateAsync({ type: "nodebuffer" });
}

async function main() {
    // 1. 微信 TXT
    const wechat = await extractText("wechat.txt", Buffer.from(WECHAT_TXT, "utf8"));
    assert.equal(wechat.format, "chat-text");
    assert.match(wechat.text, /小明: 今天好累啊/);
    assert.match(wechat.text, /小美: 抱抱你/);
    assert.ok(!wechat.text.includes("2024-01-01 12:00:00"), "时间戳行不应进入正文");

    // 2. QQ TXT
    const qq = await extractText("qq.txt", Buffer.from(QQ_TXT, "utf8"));
    assert.match(qq.text, /小明: 晚上一起打游戏吗/);
    assert.match(qq.text, /小美: 好呀/);

    // 3. WhatsApp
    const whatsapp = await extractText("WhatsApp Chat.txt", Buffer.from(WHATSAPP_TXT, "utf8"));
    assert.match(whatsapp.text, /Alice: 你好呀/);
    assert.match(whatsapp.text, /Bob: 你好，今天怎么样/);

    // 4. Telegram JSON
    const telegram = await extractText("telegram.json", Buffer.from(TELEGRAM_JSON, "utf8"));
    assert.match(telegram.text, /Alice: 你好呀/);
    assert.match(telegram.text, /Bob: 今天怎么样/);

    // 5. Discord JSON
    const discord = await extractText("discord.json", Buffer.from(DISCORD_JSON, "utf8"));
    assert.match(discord.text, /Alice: 晚上好/);
    assert.match(discord.text, /Bob: 晚上好呀/);

    // 6. DSH JSONL（普通）
    const dsh = await extractText("session.v4.jsonl", Buffer.from(DSH_EVENTS.map((e) => JSON.stringify(e)).join("\n"), "utf8"));
    assert.equal(dsh.format, "dsh-jsonl");
    assert.match(dsh.text, /用户: 帮我看看这个 bug/);
    assert.match(dsh.text, /助手: 已经定位到日志里的异常了/);
    assert.ok(!dsh.text.includes("tool/call"), "工具事件不应进入聊天正文");
    assert.equal(parseDshJsonl(DSH_EVENTS.map((e) => JSON.stringify(e)).join("\n")).split("\n").length, 3);

    // 7. DSH JSONL.zstd
    const compressed = zlib.zstdCompressSync(Buffer.from(DSH_EVENTS.map((e) => JSON.stringify(e)).join("\n"), "utf8"));
    assert.equal(sniffMagic(compressed), "zstd");
    const dshZstd = await extractText("session.v4.jsonl.zstd", compressed);
    assert.equal(dshZstd.format, "dsh-jsonl");
    assert.match(dshZstd.text, /助手: 要不要我直接改/);

    // 8. MHT（quoted-printable 中文）
    const mht = parseMht(Buffer.from(MHT_SAMPLE, "utf8"));
    assert.match(mht, /小明/);
    assert.match(mht, /你好/);

    // 9. XLSX 聊天表（列名识别）
    const xlsxBuffer = await makeXlsx();
    const xlsxText = await parseXlsx(xlsxBuffer);
    assert.match(xlsxText, /小明: 你好呀/);
    assert.match(xlsxText, /小美: 晚上好/);
    const xlsxFile = await extractText("chat.xlsx", xlsxBuffer);
    assert.equal(xlsxFile.format, "xlsx");
    assert.match(xlsxFile.text, /小明: 你好呀/);

    // 10. 纯文本伪装 JSON（内容嗅探）
    const disguised = await extractText("log.txt", Buffer.from(TELEGRAM_JSON, "utf8"));
    assert.match(disguised.text, /Alice: 你好呀/);

    // 11. zstd 多帧拼接（真实 DSH session 是多个 zstd 帧串接）
    const frameA = zlib.zstdCompressSync(
        Buffer.from(JSON.stringify({ type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "第一帧消息" }] } } }) + "\n")
    );
    const frameB = zlib.zstdCompressSync(
        Buffer.from(JSON.stringify({ type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "第二帧回复" }] } } }) + "\n")
    );
    const multi = await extractText("session.v4.jsonl.zstd", Buffer.concat([frameA, frameB]));
    assert.equal(multi.format, "dsh-jsonl");
    assert.match(multi.text, /用户: 第一帧消息/);
    assert.match(multi.text, /助手: 第二帧回复/);

    // 12. DSH：系统提示词与 reasoning 段不进入聊天正文
    const dshFiltered = await extractText(
        "session.v4.jsonl",
        Buffer.from(
            [
                { type: "system/message", data: { message: { role: "system", content: "You are an AI agent" } } },
                { type: "user/message", data: { message: { role: "user", content: [{ type: "text", text: "帮我看看" }] } } },
                {
                    type: "assistant/message",
                    data: {
                        message: {
                            role: "assistant",
                            content: [
                                { type: "reasoning", text: "这是内部推理不应导入" },
                                { type: "text", text: "已经定位到问题" }
                            ]
                        }
                    }
                }
            ].map((event) => JSON.stringify(event)).join("\n"),
            "utf8"
        )
    );
    assert.match(dshFiltered.text, /助手: 已经定位到问题/);
    assert.ok(!dshFiltered.text.includes("AI agent"));
    assert.ok(!dshFiltered.text.includes("内部推理"));

    // 13. GBK/GB2312 MHT 不能乱码（base64 正文）
    const gbkMht = [
        "MIME-Version: 1.0",
        'Content-Type: multipart/related; boundary="----=_NextPart_01"',
        "",
        "------=_NextPart_01",
        'Content-Type: text/html; charset="gb2312"',
        "Content-Transfer-Encoding: base64",
        "",
        "0KHD96O6xOO6w9G9",
        "------=_NextPart_01--"
    ].join("\r\n");
    const gbkText = parseMht(Buffer.from(gbkMht, "utf8"));
    assert.match(gbkText, /小明/);
    assert.ok(!gbkText.includes("锟斤拷"));

    // 14. XLSX 联系人表（name/email）不能被误判成聊天
    const contactsZip = new JSZip();
    contactsZip.file(
        "xl/sharedStrings.xml",
        '<sst><si><t>Name</t></si><si><t>Email</t></si><si><t>Alice</t></si><si><t>alice@example.com</t></si></sst>'
    );
    contactsZip.file(
        "xl/worksheets/sheet1.xml",
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>'
    );
    const contacts = await contactsZip.generateAsync({ type: "nodebuffer" });
    await assert.rejects(() => extractText("contacts.xlsx", contacts), (error) => error.code === "import_xlsx_empty");

    // 15. 普通日志/会议纪要不能被误判成聊天
    const meeting = "会议纪要\n2024-05-01 09:00 服务启动\nListening on port 3000";
    const meetingParsed = await extractText("meeting.txt", Buffer.from(meeting, "utf8"));
    assert.notEqual(meetingParsed.format, "chat-text");
    assert.match(meetingParsed.text, /会议纪要/);

    console.log("chat import format tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
