// 伴侣社交记忆服务：放映厅内的认识关系追踪 + 房间记忆。
// 所有表都是跨租户表，需用原始 admin Supabase（不经过 scope.db 白名单）。

const RELATIONSHIP_TIERS = Object.freeze({
    STRANGER: "stranger",
    ACQUAINTANCE: "acquaintance",
    FRIEND: "friend",
    CLOSE_FRIEND: "close_friend",
    BEST_FRIEND: "best_friend",
    PARTNER: "partner",
    CRUSH: "crush",
    FLIRT: "flirt"
});

/**
 * 记录一次「会面」：owner 伴侣认识了 target 伴侣（同厅观影/互动）。
 * 首次 = meet_count 1 + stranger；再次 = meet_count+1，根据次数升级关系。
 * 关系升级阶梯：stranger(1) → acquaintance(2-4) → friend(5+) → close_friend(10+)
 */
async function recordRoomMeeting({
    database,
    ownerCompanionId,
    targetCompanionId,
    targetUserId,
    targetDisplayName,
    targetAiName,
    roomId,
    relationshipHint = null
}) {
    if (!database || typeof database.from !== "function") {
        throw new TypeError("A raw admin database is required.");
    }
    if (!ownerCompanionId || !targetCompanionId || ownerCompanionId === targetCompanionId) {
        return null;
    }
    const now = new Date().toISOString();
    const { data: existing } = await database
        .from("companion_acquaintances")
        .select("*")
        .eq("owner_companion_id", ownerCompanionId)
        .eq("target_companion_id", targetCompanionId)
        .maybeSingle();

    if (existing) {
        const meetCount = Number(existing.meet_count || 0) + 1;
        // 高级关系（partner/crush/best_friend/flirt）不应被 meetCount 覆盖降级
        let relationship = relationshipHint || existing.relationship;
        if (!relationshipHint && shouldAutoTier(existing.relationship)) {
            relationship = tierForMeetCount(meetCount, existing.relationship);
        }
        const { data: updated, error } = await database
            .from("companion_acquaintances")
            .update({
                meet_count: meetCount,
                relationship,
                target_display_name: targetDisplayName || existing.target_display_name,
                target_ai_name: targetAiName || existing.target_ai_name,
                last_met_room_id: roomId,
                last_met_at: now,
                meeting_context: existing.meeting_context || "同厅观影",
                updated_at: now
            })
            .eq("id", existing.id)
            .select()
            .single();
        if (error) throw error;
        return updated;
    }

    const { data: created, error } = await database
        .from("companion_acquaintances")
        .insert({
            owner_companion_id: ownerCompanionId,
            target_companion_id: targetCompanionId,
            target_user_id: targetUserId,
            target_display_name: targetDisplayName || "朋友",
            target_ai_name: targetAiName || "TA的伴侣",
            meet_count: 1,
            relationship: relationshipHint || RELATIONSHIP_TIERS.STRANGER,
            affinity_score: 0,
            meeting_context: "同厅观影",
            last_met_room_id: roomId,
            last_met_at: now,
            notes: ""
        })
        .select()
        .single();
    if (error) throw error;
    return created;
}

/** 根据见面次数推导关系等级（可被 relationshipHint 覆盖）。 */
function tierForMeetCount(meetCount, previous = null) {
    if (meetCount >= 10) return RELATIONSHIP_TIERS.CLOSE_FRIEND;
    if (meetCount >= 5) return RELATIONSHIP_TIERS.FRIEND;
    if (meetCount >= 2) return RELATIONSHIP_TIERS.ACQUAINTANCE;
    return previous || RELATIONSHIP_TIERS.STRANGER;
}

/** 高级关系（手工设定）不应被自动等级覆盖。 */
function shouldAutoTier(current) {
    return current === (RELATIONSHIP_TIERS.STRANGER)
        || current === (RELATIONSHIP_TIERS.ACQUAINTANCE)
        || current === (RELATIONSHIP_TIERS.FRIEND)
        || current === (RELATIONSHIP_TIERS.CLOSE_FRIEND);
}

/** 记录一条房间记忆（伴侣视角）。 */
async function recordRoomMemory({
    database,
    roomId,
    ownerCompanionId,
    memoryType,
    content,
    mediaPositionSeconds = 0
}) {
    if (!database || typeof database.from !== "function") return null;
    if (!roomId || !ownerCompanionId || !content) return null;
    const { data, error } = await database
        .from("co_watch_room_memories")
        .insert({
            room_id: roomId,
            owner_companion_id: ownerCompanionId,
            memory_type: memoryType,
            content: String(content).slice(0, 4000),
            media_position_seconds: Math.max(0, Math.min(604800, Number(mediaPositionSeconds) || 0))
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

/** 加载 owner 的认识名单（含关系等级），用于 prompt 注入。 */
async function loadAcquaintanceContext(database, ownerCompanionId, limit = 12) {
    if (!ownerCompanionId) return [];
    const { data, error } = await database
        .from("companion_acquaintances")
        .select("*")
        .eq("owner_companion_id", ownerCompanionId)
        .order("updated_at", { ascending: false })
        .limit(Math.min(50, Math.max(1, Number(limit) || 12)));
    if (error) throw error;
    return (data || []).map((row) => ({
        targetCompanionId: row.target_companion_id,
        targetUserId: row.target_user_id,
        targetDisplayName: row.target_display_name || "",
        targetAiName: row.target_ai_name || "",
        meetCount: Number(row.meet_count) || 0,
        relationship: row.relationship || "stranger",
        affinityScore: Number(row.affinity_score) || 0,
        lastMetAt: row.last_met_at,
        notes: row.notes || ""
    }));
}

/** 加载 owner 在某个房间+历史房间的记忆摘要（最近 N 条，合并同房间）。 */
async function loadRoomMemoryContext(database, ownerCompanionId, roomId = null, limit = 8) {
    if (!ownerCompanionId) return { currentRoom: [], history: [] };
    let builder = database
        .from("co_watch_room_memories")
        .select("*")
        .eq("owner_companion_id", ownerCompanionId)
        .order("created_at", { ascending: false })
        .limit(Math.min(30, Math.max(1, Number(limit) || 8)));
    if (roomId) {
        // 当前房间的记忆单独取，历史房间记忆也一起返回（跨厅延续）
        const { data: all, error } = await builder;
        if (error) throw error;
        const current = (all || []).filter((m) => m.room_id === roomId);
        const history = (all || []).filter((m) => m.room_id !== roomId);
        return { currentRoom: current, history };
    }
    const { data, error } = await builder;
    if (error) throw error;
    return { currentRoom: [], history: data || [] };
}

/** 汇总一段文本为「认识名单提示词片段」：谁是谁、见过几次、什么关系。 */
function acquaintancePromptBlock(acquaintances = []) {
    if (!acquaintances.length) return "";
    const lines = acquaintances.slice(0, 12).map((a) => {
        const relLabel = relationshipLabel(a.relationship);
        return `- ${a.targetDisplayName}（伴侣：${a.targetAiName || "未命名"}）· ${relLabel}· 见过${a.meetCount}次${a.notes ? " · " + a.notes : ""}`;
    });
    return "你认识的其他人（由过往同厅观影记忆整理）：\n" + lines.join("\n");
}

/** 汇总房间记忆为提示词片段。 */
function roomMemoryPromptBlock(memories = []) {
    const all = [...(memories.currentRoom || []), ...(memories.history || [])];
    if (!all.length) return "";
    const lines = all.slice(0, 8).map((m) => {
        const label = memoryTypeLabel(m.memory_type);
        return `- ${label}${m.media_position_seconds ? `（播放到 ${Math.floor(m.media_position_seconds / 60)}:${String(Math.floor(m.media_position_seconds % 60)).padStart(2, "0")}）` : ""}：${String(m.content || "").slice(0, 180)}`;
    });
    return "放映厅记忆（此前同厅观看/聊天的总结）：\n" + lines.join("\n");
}

function relationshipLabel(rel) {
    const map = {
        stranger: "陌生人",
        acquaintance: "见过面",
        friend: "朋友",
        close_friend: "好朋友",
        best_friend: "挚友",
        partner: "伴侣",
        crush: "心动的对象",
        flirt: "暧昧对象"
    };
    return map[rel] || rel;
}

function memoryTypeLabel(type) {
    const map = {
        video_watched: "看过的视频",
        conversation_summary: "聊天总结",
        interaction_note: "互动记录",
        participant_intro: "人物介绍"
    };
    return map[type] || type;
}

module.exports = {
    RELATIONSHIP_TIERS,
    recordRoomMeeting,
    recordRoomMemory,
    loadAcquaintanceContext,
    loadRoomMemoryContext,
    acquaintancePromptBlock,
    roomMemoryPromptBlock,
    tierForMeetCount
};