import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";
import { settingsServiceErrorMessage } from "./settings-service-errors";

const EMPTY_DRAFT = {
  name: "",
  endpoint: "",
  auth_type: "none",
  auth_header: "X-API-Key",
  credential: "",
  protocol_version: "auto",
  provider_profile: "auto",
};

const NETEASE_MCP_PRESET = Object.freeze({
  ...EMPTY_DRAFT,
  name: "网易云音乐 MCP（Code-MonkeyZhang，自托管）",
  endpoint: "https://你的公网域名/mcp",
  auth_type: "bearer",
  provider_profile: "netease_cloud_music",
});

const NETEASE_TOOL_RISKS = Object.freeze({
  cloud_music_login: "登录与会话",
  cloud_music_status: "登录与会话",
  cloud_music_get_daily_recommend: "账户隐私读取",
  cloud_music_my_playlists: "账户隐私读取",
  cloud_music_playlist_detail: "公开查询",
  cloud_music_create_playlist: "账户写入",
  cloud_music_add_to_playlist: "账户写入",
  cloud_music_search: "公开查询",
  cloud_music_album_info: "公开查询",
  cloud_music_artist_info: "公开查询",
  cloud_music_my_subscriptions: "账户隐私读取",
  cloud_music_play: "启动外部应用",
});

function toolRiskLabel(toolName) {
  return NETEASE_TOOL_RISKS[toolName] || "外部工具";
}

async function mcpRequest(path, { method = "GET", body } = {}) {
  try {
    return await apiRequest(path, {
      method,
      timeoutMs: method === "GET" || method === "DELETE" ? 12_000 : 90_000,
      headers: { Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      settingsServiceErrorMessage(
        error,
        "无法连接 DengTa 后端，请稍后再试 / Unable to connect to the DengTa backend. Try again shortly.",
      ),
      { cause: error },
    );
  }
}

function policyLabel(value) {
  return value === "auto" ? "允许 AI 自动执行" : "禁止自动执行（默认）";
}

function userClickOnlyTool(toolName) {
  return toolName === "cloud_music_login" || toolName === "cloud_music_play";
}

function safeToolPolicies(policies = {}) {
  return Object.fromEntries(Object.entries(policies).map(([name, value]) => [name, userClickOnlyTool(name) ? "disabled" : value]));
}

const CAPABILITY_LABELS = Object.freeze({
  status: "登录状态",
  my_playlists: "读取歌单",
  playlist_detail: "读取曲目",
  search: "搜索歌曲",
});

export default function McpDeviceCenter() {
  const [status, setStatus] = useState({ checking: true });
  const [connections, setConnections] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [discovery, setDiscovery] = useState(null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    mcpRequest("/api/mcp/connections/status")
      .then((data) => setStatus({ ...data, checking: false }))
      .catch((error) => setStatus({ checking: false, available: false, message: error.message }));
    mcpRequest("/api/mcp/connections/manage")
      .then((data) => setConnections(data.connections || []))
      .catch((error) => setFeedback(error.message))
      .finally(() => setLoaded(true));
  }, []);

  const enabledTools = useMemo(
    () => connections.reduce(
      (total, connection) => total + Object.values(connection.tool_policies || {}).filter((value) => value === "auto").length,
      0,
    ),
    [connections],
  );

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setDiscovery(null);
  }

  function validateDraft() {
    let endpoint;
    try { endpoint = new URL(draft.endpoint); } catch { throw new Error("请填写完整的公网 HTTPS MCP 地址。"); }
    if (endpoint.protocol !== "https:") throw new Error("云端 MCP 只支持公网 HTTPS 端点。");
    if (draft.auth_type === "custom_header" && draft.auth_header.trim().toLowerCase() === "cookie") throw new Error("DengTa 绝不接收或转发 Cookie 请求头，请改用 MCP 服务自己的 Token/API Key（如有）。");
    if (/(?:MUSIC_U|__csrf|NETEASE_COOKIE)\s*=/i.test(draft.credential)) throw new Error("请不要向 DengTa 填写 MUSIC_U、__csrf、NETEASE_COOKIE 或任何 Cookie；它们只能配置在你自托管的 MCP 服务端。");
  }

  async function discover() {
    setBusy("discover");
    setFeedback("");
    try {
      validateDraft();
      const data = await mcpRequest("/api/mcp/connections/manage/discover", {
        method: "POST",
        body: draft,
      });
      setDiscovery(data);
      setDraft((current) => ({
        ...current,
        protocol_version: data.protocol_version || current.protocol_version,
        provider_profile: data.provider_profile || current.provider_profile,
      }));
      setFeedback(data.provider_profile === "netease_cloud_music"
        ? `连接成功，已自动识别网易云音乐接口和 ${data.tools?.length || 0} 个工具。`
        : `连接成功，发现 ${data.tools?.length || 0} 个工具。保存后可逐项授权给 AI 使用。`);
    } catch (error) {
      setDiscovery(null);
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function createConnection(event) {
    event.preventDefault();
    setBusy("create");
    setFeedback("");
    try {
      validateDraft();
      const data = await mcpRequest("/api/mcp/connections/manage", {
        method: "POST",
        body: draft,
      });
      setConnections((current) => [...current, data.connection]);
      setDraft(EMPTY_DRAFT);
      setDiscovery(null);
      setFeedback("连接已安全保存。所有工具仍默认禁止，请在下方逐项授权。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  function editConnection(id, transform) {
    setConnections((current) => current.map((item) => (item.id === id ? transform(item) : item)));
  }

  async function saveConnection(connection) {
    setBusy(`save-${connection.id}`);
    setFeedback("");
    try {
      const data = await mcpRequest(`/api/mcp/connections/manage/${connection.id}`, {
        method: "PUT",
        body: {
          name: connection.name,
          enabled: connection.enabled,
          auth_type: connection.auth_type,
          auth_header: connection.auth_header,
          protocol_version: connection.protocol_version,
          provider_profile: connection.provider_profile || "",
           tool_policies: safeToolPolicies(connection.tool_policies),
          ...(connection.credential ? { credential: connection.credential } : {}),
        },
      });
      editConnection(connection.id, () => data.connection);
      setFeedback("设备权限已经保存。之后只有标为“允许自动执行”的工具会交给模型选择。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function testConnection(connection) {
    setBusy(`test-${connection.id}`);
    setFeedback("");
    try {
      const data = await mcpRequest(`/api/mcp/connections/manage/${connection.id}/test`, {
        method: "POST",
      });
      editConnection(connection.id, () => data.connection);
      setFeedback(`测试成功，当前发现 ${data.connection.discovered_tools?.length || 0} 个工具。`);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  async function removeConnection(connection) {
    if (!window.confirm(`删除“${connection.name}”的 MCP 连接和加密凭据？`)) return;
    setBusy(`delete-${connection.id}`);
    setFeedback("");
    try {
      await mcpRequest(`/api/mcp/connections/manage/${connection.id}`, {
        method: "DELETE",
      });
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      setFeedback("连接和服务器保存的加密凭据已删除。 ");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-card mcp-device-center">
      <div className="mcp-device-heading">
        <div>
          <h3>自定义 MCP 连接</h3>
          <p className="card-hint">
            自行添加外部记忆、设备或其他 MCP 服务，无需管理员审批。填写服务地址与访问令牌，保存后选择允许 AI 使用的工具。
          </p>
        </div>
        <span className={`status-chip ${status.available ? "online" : "pending"}`}>
          {status.checking ? "检查中" : status.available ? `${connections.length} 个连接` : "待配置"}
        </span>
      </div>

      <div className="mcp-setup-required" role="note">
        <strong>连接外部 MCP 记忆</strong>
        <p>接口类型选择“外部记忆 MCP”，填写服务商提供的 Streamable HTTP 地址，测试并保存。启用连接，并分别授权记忆查询或写入工具。AI 可在聊天中按需使用；查询结果不会自动导入灯塔记忆库。</p>
        <p>记忆读写权限由你决定。服务器只提供加密保存和账号隔离，不需要人工确认连接。</p>
      </div>

      <div className="mcp-safety-note">
        <strong>默认零权限</strong>
        <p>新连接的所有工具均为“禁止自动执行”。你必须逐项改成允许并启用连接，聊天模型才看得到它。设备凭据只在后端加密保存，不会回传页面。</p>
      </div>

      <div className="mcp-setup-required netease-mcp-preset" role="note">
        <strong>网易云音乐 MCP · Code-MonkeyZhang/cloud-music-mcp</strong>
        <ol>
          <li>在每位用户独占的 Windows/macOS 主机实例中安装上游；它原生是 stdio，配置里的 <code>command</code>/<code>args</code> 不能直接填入 DengTa。</li>
          <li>用 <code>uv run fastmcp run "src/cloud_music_mcp/main.py:mcp" --transport http --host 127.0.0.1 --port 8000</code> 仅监听回环地址。</li>
          <li>在实例前增加带 Bearer 鉴权的包装层，再通过 HTTPS 反向代理公开为 <code>https://你的公网域名/mcp</code>；不要把无鉴权的 FastMCP 端口直接暴露到公网。</li>
          <li>扫码登录必须在运行 Python 的自托管主机完成，或通过另行保护的管理页完成。Cookie 明文只留在该用户实例，绝不填写到 DengTa。</li>
        </ol>
        <p><code>cloud_music_play</code> 只会启动或控制自托管主机上的网易云桌面客户端，不能控制 Android App，也不能为 Together 提供音频。DengTa 不抓取网易云网页、不解析音频直链、不绕过 DRM。</p>
        <p>发现的全部工具仍默认禁用。风险标签只用于解释影响，不构成授权；请按工具逐项审阅后再启用。</p>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setDraft(NETEASE_MCP_PRESET); setDiscovery(null); setFeedback("已填入网易云 MCP 安全预设，请把域名替换为你自托管的公网 HTTPS 地址。"); }}>使用网易云 MCP 预设</button>
      </div>

      <div className="mcp-setup-required" role="note">
        <strong>迁移后设备测试失败 / Device test fails after migration</strong>
        <p>无需删除连接。在对应卡片的“更新访问令牌”重新填写 Token，保存权限后再测试 / Re-enter the token on the existing connection, save it, then test again.</p>
      </div>

      {!status.checking && !status.configured && (
        <div className="mcp-setup-required">
          <strong>无需授权的 MCP 可以直接添加</strong>
          <p>只有选择 Bearer 或 API Key 时才需要服务器加密密钥；Token 绝不会明文保存。添加 MCP 时不需要再输入管理口令。</p>
        </div>
      )}

      {feedback && <div className="mcp-feedback" role="status">{feedback}</div>}

      {!loaded ? (
        <div className="mcp-empty">正在读取 MCP 连接…</div>
      ) : (
        <>
          <form className="mcp-connection-form" onSubmit={createConnection}>
            <h4>添加一个 MCP 连接</h4>
            <div className="mcp-form-grid">
              <label>
                显示名称
                <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="例如：家里的空调" />
              </label>
              <label>
                 接口类型
                 <select value={draft.provider_profile} onChange={(event) => updateDraft("provider_profile", event.target.value)}>
                   <option value="auto">自动识别（推荐）</option>
                   <option value="">通用 MCP</option>
                   <option value="memory_mcp">外部记忆 MCP</option>
                   <option value="netease_cloud_music">网易云音乐</option>
                </select>
              </label>
              <label>
                 协议版本
                 <select value={draft.protocol_version} onChange={(event) => updateDraft("protocol_version", event.target.value)}>
                   <option value="auto">自动识别（推荐）</option>
                   <option value="2025-11-25">2025-11-25</option>
                   <option value="2025-06-18">2025-06-18</option>
                   <option value="2025-03-26">2025-03-26</option>
                  <option value="2024-11-05">2024-11-05（兼容旧服务）</option>
                </select>
              </label>
              <label className="full-width">
                完整 MCP 地址
                <input value={draft.endpoint} onChange={(event) => updateDraft("endpoint", event.target.value)} placeholder="例如：https://你的-home-assistant.example.com/api/mcp" />
                <small>必须填写完整公网 HTTPS 端点；网易云预设必须以 /mcp 结尾。不要填网站首页、192.168.x.x、localhost 或 Cookie。</small>
              </label>
              <label>
                授权方式
                <select value={draft.auth_type} onChange={(event) => updateDraft("auth_type", event.target.value)}>
                  <option value="none">不需要授权（默认）</option>
                  <option value="bearer">Bearer 访问令牌</option>
                  <option value="custom_header">自定义请求头</option>
                </select>
              </label>
              {draft.auth_type === "custom_header" && (
                <label>
                  请求头名称
                    <input value={draft.auth_header} onChange={(event) => updateDraft("auth_header", event.target.value)} placeholder="X-API-Key（禁止 Cookie）" />
                </label>
              )}
              {draft.auth_type !== "none" && (
                <label className="full-width">
                  访问令牌 / API Key
                  <input type="password" autoComplete="off" value={draft.credential} onChange={(event) => updateDraft("credential", event.target.value)} placeholder="只会发送给 DengTa 后端并加密保存" />
                </label>
              )}
            </div>
            <div className="mcp-form-actions">
              <button type="button" className="secondary-button" onClick={discover} disabled={Boolean(busy) || !draft.endpoint.trim()}>
                {busy === "discover" ? "连接中" : "测试并读取工具"}
              </button>
              <button className="primary-button" disabled={Boolean(busy) || !draft.name.trim() || !draft.endpoint.trim()}>
                {busy === "create" ? "保存中" : "安全保存连接"}
              </button>
            </div>
            {discovery && (
              <div className="mcp-discovery-result">
                 <strong>{discovery.server_name || "MCP 服务"} 已响应</strong>
                 <span>{discovery.provider_profile === "netease_cloud_music" ? `网易云音乐 · ${discovery.adapter_id || "兼容接口"} · 置信度 ${Math.round((discovery.confidence || 0) * 100)}%` : discovery.provider_profile === "memory_mcp" ? "外部记忆 MCP" : "通用 MCP 接口"}</span>
                 {discovery.provider_profile === "netease_cloud_music" && discovery.capabilities && <div className="mcp-discovered-tools">{Object.entries(discovery.capabilities).map(([name, available]) => <span key={name}>{available ? "已识别" : "缺少"} · {CAPABILITY_LABELS[name] || name}</span>)}</div>}
                {(discovery.tools || []).length ? (
                  <div className="mcp-discovered-tools">
                    {discovery.tools.map((tool) => <span key={tool.name}><code>{tool.name}</code><span className="mcp-tool-risk">{toolRiskLabel(tool.name)}</span></span>)}
                  </div>
                ) : <span>没有公开工具</span>}
              </div>
            )}
          </form>

          <div className="mcp-connection-list">
            <div className="mcp-list-heading">
              <h4>已保存连接</h4>
              <span>{enabledTools} 个工具允许自动执行</span>
            </div>
            {connections.length === 0 ? (
              <div className="mcp-empty">还没有设备。先在上面测试并保存一个连接。</div>
            ) : connections.map((connection) => (
              <article className="mcp-connection-card" key={connection.id}>
                <div className="mcp-connection-title">
                  <div>
                    <strong>{connection.name}</strong>
                    <small>{connection.endpoint}</small>
                  </div>
                  <span className={`status-chip ${connection.last_status === "connected" ? "online" : "pending"}`}>
                    {connection.last_status === "connected" ? "已连接" : "需测试"}
                  </span>
                </div>
                <label className="mcp-enable-toggle">
                  <input type="checkbox" checked={connection.enabled === true} onChange={(event) => editConnection(connection.id, (current) => ({ ...current, enabled: event.target.checked }))} />
                  <span><strong>启用此连接</strong><small>关闭后，聊天模型看不到这里的任何工具</small></span>
                </label>
                {connection.auth_type !== "none" && (
                  <label className="mcp-credential-update">
                    更新访问令牌（可留空）
                    <input
                      type="password"
                      autoComplete="off"
                      value={connection.credential || ""}
                      onChange={(event) => editConnection(connection.id, (current) => ({ ...current, credential: event.target.value }))}
                      placeholder={connection.auth_configured ? "已加密保存；只在轮换密钥时填写新值" : "请填写访问令牌"}
                    />
                  </label>
                )}
                <div className="mcp-tool-list">
                  {(connection.discovered_tools || []).map((tool) => (
                    <label key={tool.name}>
                      <span><strong>{tool.name}</strong><span className="mcp-tool-risk">{toolRiskLabel(tool.name)}</span><small>{tool.description || "服务没有提供说明"}</small></span>
                      <select
                        aria-label={`${tool.name} 的自动执行权限`}
                        value={userClickOnlyTool(tool.name) ? "disabled" : connection.tool_policies?.[tool.name] || "disabled"}
                        disabled={userClickOnlyTool(tool.name)}
                        onChange={(event) => editConnection(connection.id, (current) => ({
                          ...current,
                          tool_policies: { ...current.tool_policies, [tool.name]: event.target.value },
                        }))}
                      >
                        <option value="disabled">{policyLabel("disabled")}</option>
                        <option value="auto" disabled={userClickOnlyTool(tool.name)}>{policyLabel("auto")}</option>
                      </select>
                      {userClickOnlyTool(tool.name) && <small>{tool.name === "cloud_music_login" ? "只能在自托管管理页完成登录，DengTa 不调用此工具。" : "只能由用户点击外部播放按钮触发，禁止 AI 自动执行。"}</small>}
                    </label>
                  ))}
                </div>
                <div className="mcp-card-actions">
                  <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => testConnection(connection)}>
                    {busy === `test-${connection.id}` ? "测试中" : "重新测试"}
                  </button>
                  <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => saveConnection(connection)}>
                    {busy === `save-${connection.id}` ? "保存中" : "保存权限"}
                  </button>
                  <button type="button" className="danger-outline-button" disabled={Boolean(busy)} onClick={() => removeConnection(connection)}>
                    删除连接
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <details className="mcp-tutorial">
        <summary>填写教程：空调、Home Assistant 和其他 MCP</summary>
        <div>
          <h4>最省事的空调接法：Home Assistant</h4>
          <ol>
            <li>先让空调接入 Home Assistant，并只公开你愿意让 AI 控制的实体。</li>
            <li>在 Home Assistant 中添加“Model Context Protocol Server”集成。</li>
            <li>在个人资料页打开“安全”，创建长期访问令牌；复制后填到上面的访问令牌。</li>
            <li>完整地址通常为 <code>https://你的公开域名/api/mcp</code>。如果只有 <code>http://192.168…</code>，Render 看不到它，需要先用 Home Assistant Cloud 或你信任的 HTTPS 隧道公开。</li>
            <li>点“测试并读取工具”，确认工具名后保存。最后只把调温等确实需要的工具改成“允许 AI 自动执行”。</li>
          </ol>
          <h4>市面上的其他 MCP</h4>
           <p>如果商家给你的是一个 HTTPS URL 和 Token，通常可以直接填。选择“自动识别”后，DengTa 会依次协商受支持的 MCP 协议版本，读取服务名称、工具与参数结构，并识别网易云元数据能力。每家端点路径、授权方式和工具名可能不同，并不存在所有设备共用的一条固定路径。为控制模型请求大小，每轮最多加载 32 个已授权工具。</p>
          <p>如果给你的是 JSON 里的 <code>command</code>、<code>args</code> 或本地程序，那是 stdio MCP，Render 不能直接运行你电脑上的命令；需要商家提供远程 Streamable HTTP 地址，或先部署一个 HTTPS MCP 网关。</p>
          <p>如果服务只支持网页登录 OAuth，目前这个自定义窗口不会代替你登录；请优先使用服务商提供的访问令牌。OAuth 配对可作为后续升级。</p>
        </div>
      </details>
    </div>
  );
}
