import { Clipboard } from "@capacitor/clipboard";
import { useEffect, useRef, useState } from "react";
import {
  detectNeteaseShare,
  deleteMusicPlaylist,
  getNeteaseConnectionStatus,
  getNeteasePlaylist,
  getMusicPlaylist,
  importNeteaseShare,
  importMusicPlaylist,
  listNeteaseConnections,
  listNeteasePlaylists,
  listMusicPlaylists,
  requestExternalMusicPlayback,
  searchNeteaseMusic,
  uploadLocalMusicFile,
} from "./music-listening.js";
import { MAX_PLAYLIST_TEXT_LENGTH, readPlaylistTextFile } from "./playlist-file.js";
import { resolveMusicPlayback, MUSIC_PLAYBACK_MODES } from "./music-playback.js";
import { openNeteasePlayback } from "./netease-playback.js";
import MusicPagedList from "./MusicPagedList.jsx";
import { useMusicScope } from "./use-music-scope.js";
import { runMusicTask, musicErrorMessage } from "./music-operation-feedback.js";
import { launchExternalMusic, externalMusicFeedback } from "./music-external-launch.js";
import { createMusicImportRecovery } from "./music-import-recovery.js";
import { musicPlaylistStatus } from "./music-playlist-status.js";

const PROVIDERS = [
  ["local_playlist", "本地歌单", "ready", "可用"],
  ["direct_https", "HTTPS 音频直链", "ready", "可用"],
  ["netease", "网易云音乐 MCP", "unconnected", "等待用户自托管连接"],
];

const PLAYLIST_ACCEPT = ".json,.m3u,.m3u8,.txt,application/json,text/plain,audio/x-mpegurl,application/vnd.apple.mpegurl";
const AUDIO_ACCEPT = ".mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/opus,audio/flac";
const AUDIO_EXTENSION = /\.(?:mp3|m4a|aac|wav|ogg|opus|flac)$/i;

export default function MusicSettings(props) {
  return <MusicSettingsPanel key={JSON.stringify([props.accountScope || "", props.companionScope || ""])} {...props} />;
}

function MusicSettingsPanel({ providerStatus = null, onOpenMcpDeviceCenter, onImported, onBusyChange, compact = false, accountScope = "", companionScope = "" }) {
  const musicScope = useMusicScope(accountScope, companionScope);
  const [playlists, setPlaylists] = useState([]);
  const [selected, setSelected] = useState(null);
  const [format, setFormat] = useState("auto");
  const [name, setName] = useState("我的歌单");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const [localAudio, setLocalAudio] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [neteaseConnections, setNeteaseConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [neteaseStatus, setNeteaseStatus] = useState(null);
  const [remotePlaylists, setRemotePlaylists] = useState([]);
  const [remoteSelected, setRemoteSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [neteaseBusy, setNeteaseBusy] = useState("");

  const localAudioUrlRef = useRef("");
  const importRequestRef = useRef(null);
  const [recovery] = useState(() => createMusicImportRecovery({ upload: uploadLocalMusicFile, save: importMusicPlaylist }));
  const [pendingAudio, setPendingAudio] = useState(null);
  const neteaseShare = detectNeteaseShare(content);
  const canImport = Boolean(content.trim()) && !busy && !fileBusy && !pendingAudio;
  const neteaseLabel = [neteaseStatus?.display_name, neteaseStatus?.account_name, neteaseStatus?.status].find(value => typeof value === "string" && value.trim())
    || (neteaseBusy === "loading" ? "读取中…" : neteaseStatus?.logged_in === false ? "未登录" : "未知");
  useEffect(() => { onBusyChange?.(busy || fileBusy); }, [busy, fileBusy, onBusyChange]);

  async function refresh({ quiet = false } = {}) {
    const result = await runMusicTask(musicScope, "library", (token) => listMusicPlaylists(token.options), {
      replace: true,
      onStart: () => { setRefreshing(true); if (!quiet) setError(""); },
      onSuccess: setPlaylists,
      onError: (caught) => setError(musicErrorMessage(caught, "歌单暂时无法读取，请刷新重试。")),
      onFinish: () => setRefreshing(false),
    });
    return result.ok;
  }
  useEffect(() => {
    const token = musicScope.begin("library");
    if (!token) return;
    listMusicPlaylists(token.options).then((lists) => {
      if (!musicScope.current(token)) return;
      setPlaylists(lists);
    }).catch((caught) => { if (musicScope.current(token)) setError(musicErrorMessage(caught, "歌单读取失败，请刷新重试。")); }).finally(() => musicScope.finish(token));
    return () => musicScope.cancel(token);
  }, [musicScope]);
  useEffect(() => {
    const token = musicScope.capture();
    listNeteaseConnections(token.options).then(connections => {
      if (!musicScope.current(token)) return;
      setNeteaseConnections(connections); setConnectionId(current => current || String(connections[0]?.id || ""));
    }).catch(caught => { if (musicScope.current(token)) setError(musicErrorMessage(caught, "网易云连接读取失败，请重新打开设置重试。")); });
  }, [musicScope]);
  const finishRemote = () => setNeteaseBusy(musicScope.busy("remote-search") ? "search" : musicScope.busy("remote-detail") ? "playlist" : musicScope.busy("remote-source") ? "loading" : "");
  useEffect(() => {
    if (!connectionId) return;
    const token = musicScope.begin("remote-source", { replace: true });
    if (!token) return;
    Promise.resolve().then(() => {
      musicScope.assertCurrent(token); setNeteaseBusy("loading");
      return Promise.allSettled([getNeteaseConnectionStatus(connectionId, token.options), listNeteasePlaylists(connectionId, token.options)]);
    }).then(([statusResult, playlistsResult]) => {
      if (!musicScope.current(token)) return;
      if (statusResult.status === "fulfilled") setNeteaseStatus(statusResult.value);
      if (playlistsResult.status === "fulfilled") setRemotePlaylists(playlistsResult.value);
      const failure = statusResult.status === "rejected" ? statusResult.reason : playlistsResult.status === "rejected" ? playlistsResult.reason : null;
      if (failure) setError(musicErrorMessage(failure, "网易云账号状态或歌单读取失败，请检查连接后重试。"));
    }).catch((caught) => { if (musicScope.current(token)) setError(musicErrorMessage(caught, "网易云连接检查失败，请重试。")); })
      .finally(() => { musicScope.finish(token); if (musicScope.current(token)) setNeteaseBusy(musicScope.busy("remote-search") ? "search" : musicScope.busy("remote-detail") ? "playlist" : ""); });
    return () => musicScope.cancel(token);
  }, [connectionId, musicScope]);

  function selectNeteaseConnection(nextId) {
    for (const key of ["remote-search", "remote-detail", "remote-source"]) musicScope.cancelKey(key);
    setNeteaseBusy(""); setConnectionId(nextId); setNeteaseStatus(null); setRemotePlaylists([]); setRemoteSelected(null); setSearchResults([]);
  }
  useEffect(() => () => { if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current); }, []);

  async function notifyImported(imported, token) {
    if (!musicScope.current(token) || typeof onImported !== "function") return;
    try { await onImported(imported); }
    catch (caught) { if (musicScope.current(token)) setMessage(`歌单已保存；播放器刷新失败，可关闭此面板后手动刷新，无需重复导入。${musicErrorMessage(caught, "播放器读取失败。")} `); }
  }
  async function importPlaylist() {
    await runMusicTask(musicScope, "import", (token) => {
      if (neteaseShare) return importNeteaseShare(connectionId, content, token.options);
      const payload = { format, sourceName: fileName || "粘贴内容", name, content };
      const signature = JSON.stringify([token.generation, token.options.accountScope, token.options.companionScope, payload]);
      if (importRequestRef.current?.signature !== signature) importRequestRef.current = { signature, requestId: crypto.randomUUID() };
      return importMusicPlaylist({ ...payload, requestId: importRequestRef.current.requestId }, token.options);
    }, {
      onStart: () => { onBusyChange?.(true); setBusy(true); setError(""); setMessage(""); },
      onSuccess: async (imported, token) => {
        importRequestRef.current = null;
        setContent(current => current === content ? "" : current);
        setFileName(current => current === fileName ? "" : current);
        setSelected(imported);
        setMessage(`已导入“${imported.name}”，共 ${imported.itemCount} 首。可播放方式由歌曲的实际回执决定。`);
        await notifyImported(imported, token);
        if (musicScope.current(token) && !compact) void refresh({ quiet: true });
      },
      onError: (caught) => setError(musicErrorMessage(caught, "歌单导入失败，内容仍保留，请检查格式或连接后重试。")),
      onFinish: () => setBusy(false),
    });
  }
  async function searchNetease() {
    if (!connectionId || !searchQuery.trim()) return;
    await runMusicTask(musicScope, "remote-search", (token) => searchNeteaseMusic(connectionId, searchQuery, token.options), {
      replace: true, onStart: () => { setNeteaseBusy("search"); setError(""); },
      onSuccess: (items) => { setSearchResults(items); setRemoteSelected(null); },
      onError: (caught) => setError(musicErrorMessage(caught, "网易云搜索失败，请重试。")), onFinish: finishRemote,
    });
  }
  async function selectRemotePlaylist(id) {
    await runMusicTask(musicScope, "remote-detail", (token) => getNeteasePlaylist(connectionId, id, token.options), {
      replace: true, onStart: () => { setNeteaseBusy("playlist"); setError(""); }, onSuccess: setRemoteSelected,
      onError: (caught) => setError(musicErrorMessage(caught, "远端歌单读取失败，请重试。")), onFinish: finishRemote,
    });
  }
  async function selectSavedPlaylist(id) {
    if (selected?.id === id) { musicScope.cancelKey("selection"); setSelected(null); return; }
    await runMusicTask(musicScope, "selection", (token) => getMusicPlaylist(id, token.options), {
      replace: true, onStart: () => setError(""), onSuccess: setSelected,
      onError: (caught) => setError(musicErrorMessage(caught, "歌单读取失败，请重新选择或刷新。")),
    });
  }
  async function openExternal(item, resourceType = "song", fallbackId = "") {
    const playback = resolveMusicPlayback(item), resourceId = playback.resourceId || fallbackId;
    await runMusicTask(musicScope, "external-playback", (token) => launchExternalMusic({ scope: musicScope, token, resourceType, resourceId, open: openNeteasePlayback, request: requestExternalMusicPlayback }), {
      onStart: () => { setError(""); setMessage(""); },
      onSuccess: (result) => setMessage(externalMusicFeedback(result)),
      onError: (caught) => setError(musicErrorMessage(caught, "无法打开网易云播放，请检查设备和连接后重试。")),
    });
  }
  async function removePlaylist(id) {
    await runMusicTask(musicScope, "import", (token) => deleteMusicPlaylist(id, token.options), {
      onStart: () => { onBusyChange?.(true); setBusy(true); setError(""); },
      onSuccess: () => { musicScope.cancelKey("selection"); setSelected(null); setMessage("歌单已删除。"); void refresh({ quiet: true }); },
      onError: (caught) => setError(musicErrorMessage(caught, "删除失败，歌单仍保留，请重试。")), onFinish: () => setBusy(false),
    });
  }
  async function readClipboard() {
    await runMusicTask(musicScope, "clipboard", async (token) => {
      let value;
      try { value = String((await Clipboard.read())?.value || ""); } catch {
        musicScope.assertCurrent(token);
        if (!navigator.clipboard?.readText) throw new Error("当前设备不允许读取剪贴板，请长按输入框手动粘贴。");
        value = await navigator.clipboard.readText();
      }
      if (!value.trim()) throw new Error("剪贴板里没有可读取的文本，请复制歌单内容后重试。");
      if (value.length > MAX_PLAYLIST_TEXT_LENGTH) throw new Error("歌单文本不能超过 1 MiB，请精简后重试。");
      return value;
    }, {
      onStart: () => { setClipboardBusy(true); setError(""); },
      onSuccess: (value) => { setContent(value); setMessage("已从剪贴板读取文本，请确认识别状态后继续。"); },
      onError: (caught) => setError(musicErrorMessage(caught, "剪贴板读取失败，可以长按输入框手动粘贴。")), onFinish: () => setClipboardBusy(false),
    });
  }
  async function choosePlaylistFile(event) {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file) return;
    await runMusicTask(musicScope, "file", () => readPlaylistTextFile(file), {
      replace: true, onStart: () => { onBusyChange?.(true); setFileBusy(true); setError(""); },
      onSuccess: (value) => { const lower = file.name.toLowerCase(); setFileName(file.name); setFormat(lower.endsWith(".json") ? "json" : /\.m3u8?$/.test(lower) ? "m3u" : "txt"); setContent(value); setMessage(`已读取歌单文件：${file.name}`); },
      onError: (caught) => setError(musicErrorMessage(caught, "歌单文件读取失败，请重新选择。")), onFinish: () => setFileBusy(false),
    });
    input.value = "";
  }
  function chooseLocalAudio(event) {
    const input = event.currentTarget;
    setError("");
    try {
      const file = input.files?.[0]; if (!file) return;
      if (!AUDIO_EXTENSION.test(file.name) && !String(file.type).startsWith("audio/")) throw new Error("请选择 MP3、M4A、AAC、WAV、OGG、OPUS 或 FLAC 音频文件。");
      if (localAudioUrlRef.current) URL.revokeObjectURL(localAudioUrlRef.current);
      const url = URL.createObjectURL(file); localAudioUrlRef.current = url;
      setLocalAudio({ name: file.name, url, type: file.type }); setMessage(`已在本机载入：${file.name}`);
    } catch (caught) { setError(musicErrorMessage(caught, "本机音频选择失败，请重试。")); }
    finally { input.value = ""; }
  }
  async function saveLocalAudio(file) {
    await runMusicTask(musicScope, "import", token => file
      ? recovery.start(file, musicScope, token, setPendingAudio)
      : recovery.resume(musicScope, token), {
      onStart: () => { onBusyChange?.(true); setFileBusy(true); setError(""); setMessage(""); },
      onSuccess: async ({ audio, imported }, token) => {
        setPendingAudio(null); setSelected(imported);
        setMessage(`已把「${audio.title}」导入歌单「${imported.name}」。音频能否播放以播放器实际结果为准。`);
        await notifyImported(imported, token);
        if (musicScope.current(token) && !compact) void refresh({ quiet: true });
      },
      onError: caught => {
        const pending = recovery.pending(musicScope);
        setPendingAudio(pending?.audio || null);
        setError(`${pending ? "音频已上传；点击“继续保存歌单”重试，不会重复上传。" : ""}${musicErrorMessage(caught, "本机音频导入失败，请检查文件和网络后重试。")}`);
      },
      onFinish: () => setFileBusy(false),
    });
  }
  async function importLocalAudio(event) {
    const input = event.currentTarget, file = input.files?.[0]; if (!file) return;
    await saveLocalAudio(file); input.value = "";
  }

  return <section className={`music-settings settings-card${compact ? " is-import-sheet" : ""}`} aria-labelledby="music-settings-title">
    <div className="settings-card-heading"><div><span className="settings-kicker">LISTENING</span><h3 id="music-settings-title">一起听歌</h3><p>分享链接、歌单文件、本机音频都可以导入；能否播放以歌曲实际回执为准。</p></div><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "刷新中…" : "刷新"}</button></div>
    {!compact && <div className="music-provider-grid" aria-label="音乐 Provider 状态">
      {PROVIDERS.map(([id, label, fallbackStatus, fallbackText]) => {
        const remote = Array.isArray(providerStatus?.providers) ? providerStatus.providers.find((item) => item?.id === id) : null;
        const status = remote?.status || fallbackStatus;
        return <div className="music-provider-status" key={id}><strong>{label}</strong><span className={`provider-dot ${status}`}>{remote?.display_name || fallbackText}</span>{id === "netease" && <><small>通过用户自托管的 Code-MonkeyZhang/cloud-music-mcp 接入：元数据/歌单管理可用，Together 音频不可用。</small><button type="button" onClick={onOpenMcpDeviceCenter}>去连接网易云 MCP</button></>}</div>;
      })}
    </div>}
    <details className="music-netease-library" open={compact ? undefined : true} aria-label="网易云音乐连接与曲库">
      <summary>高级来源：自托管网易云 MCP</summary>
      <label>已保存 MCP 连接<select value={connectionId} onChange={(event) => selectNeteaseConnection(event.target.value)}><option value="">选择 provider_profile=netease_cloud_music 的连接</option>{neteaseConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
      {!neteaseConnections.length && <p>尚未保存网易云 Provider 连接。<button type="button" onClick={onOpenMcpDeviceCenter}>去 MCP 设备中心</button></p>}
      {connectionId && <div className="music-netease-status"><strong>账号状态</strong><span>{neteaseLabel}</span><small>登录只可在自托管管理页完成；DengTa 不调用 cloud_music_login，也不接收 Cookie。</small></div>}
      {connectionId && <><div className="music-remote-playlists"><strong>远端歌单</strong>{remotePlaylists.length ? remotePlaylists.map((playlist) => <button type="button" key={playlist.providerPlaylistId || playlist.id} onClick={() => void selectRemotePlaylist(playlist.providerPlaylistId || playlist.id)}><span>{playlist.name}</span><small>{playlist.itemCount} 首</small></button>) : <p>{neteaseBusy === "loading" ? "正在读取远端歌单…" : "没有可显示的远端歌单。"}</p>}</div>
      <div className="music-netease-search"><label>搜索网易云曲目<input value={searchQuery} maxLength={500} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchNetease(); } }} /></label><button type="button" disabled={!searchQuery.trim() || Boolean(neteaseBusy)} onClick={() => void searchNetease()}>{neteaseBusy === "search" ? "搜索中…" : "搜索"}</button></div></>}
      {(remoteSelected || searchResults.length > 0) && <div className="music-external-results"><strong>{remoteSelected ? remoteSelected.name : "搜索结果"}</strong>{(remoteSelected?.items || searchResults).map((item, index) => <div key={item.id || item.providerTrackId || index}><span><b>{item.title}</b><small>{item.artist || "未知艺术家"}</small></span><button type="button" onClick={() => void openExternal(item)}>在网易云播放</button></div>)}<p>普通歌曲、VIP 歌曲和版权可用性均由网易云判断。</p></div>}
    </details>
    <div className="music-import-grid">
      <label>歌单名称<input value={name} maxLength={180} onChange={(event) => setName(event.target.value)} /></label>
      <label>格式<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="auto">自动识别</option><option value="json">JSON</option><option value="m3u">M3U / M3U8</option><option value="txt">TXT</option></select></label>
      <label className="music-file-label">导入歌单文件（JSON/M3U/M3U8/TXT）<input type="file" accept={PLAYLIST_ACCEPT} disabled={busy || fileBusy} onChange={(event) => void choosePlaylistFile(event)} /></label>
      <label className="music-file-label">选择本机音频（MP3/M4A/AAC/WAV/OGG/OPUS/FLAC）<input type="file" accept={AUDIO_ACCEPT} disabled={fileBusy} onChange={chooseLocalAudio} /></label>
      <label className="music-file-label">上传本机音频到歌单（MP3/M4A/AAC/WAV/OGG/OPUS/FLAC，≤20MB）<input type="file" accept={AUDIO_ACCEPT} disabled={busy || fileBusy || Boolean(pendingAudio)} onChange={(event) => void importLocalAudio(event)} /></label>
      <label className="music-content-label">粘贴歌单文本<textarea value={content} maxLength={MAX_PLAYLIST_TEXT_LENGTH} onChange={(event) => setContent(event.target.value)} rows={7} placeholder="JSON、M3U、每行一个 HTTPS 音频地址，或网易云分享文本" aria-describedby="music-content-limit" /></label>
      <div className="music-clipboard-actions"><button type="button" disabled={clipboardBusy || busy} onClick={() => void readClipboard()}>{clipboardBusy ? "读取中…" : "读取剪贴板"}</button><span id="music-content-limit" role="status">{content.trim() ? `已输入 ${content.trim().length} 个字符（上限 ${MAX_PLAYLIST_TEXT_LENGTH}）。` : "等待粘贴或读取歌单文本，最大 1 MiB。"}</span></div>
    </div>
    {neteaseShare && <div className="music-share-recognition" role="status"><strong>{neteaseShare.provider}</strong><span>{neteaseShare.resourceType === "short" ? "已识别网易云短链" : `${neteaseShare.resourceType === "song" ? "Song" : "Playlist"} ID：${neteaseShare.resourceId}`}</span><span>标题提示：{neteaseShare.title}</span><p>{connectionId && neteaseShare.resourceType === "playlist" ? "将通过所选自托管连接导入歌单元数据与曲目。" : "将先保存链接元数据；无需 Cookie，仍可跳转网易云。"}</p>{neteaseShare.resourceId && <button type="button" onClick={() => void openExternal({}, neteaseShare.resourceType, neteaseShare.resourceId)}>在网易云打开</button>}{!connectionId && onOpenMcpDeviceCenter && <button type="button" onClick={onOpenMcpDeviceCenter}>连接 MCP 以补全歌单</button>}</div>}
    <button type="button" className="together-primary" disabled={!canImport} onClick={() => void importPlaylist()}>{busy ? "正在导入…" : neteaseShare ? `导入网易云${neteaseShare.resourceType === "song" ? "单曲" : "歌单"}` : "导入歌单"}</button>
    {pendingAudio && <section className="music-import-recovery" aria-label="音频导入恢复"><strong>待保存：{pendingAudio.title}</strong><p>上传已完成。继续保存会核对服务器回执并补齐曲目。关闭面板后不会保留此恢复入口；重新上传同一文件会复用存储文件。</p><div className="music-clipboard-actions"><button type="button" className="together-primary" disabled={busy || fileBusy} onClick={() => void saveLocalAudio()}>{fileBusy ? "正在确认保存…" : "继续保存歌单"}</button><button type="button" disabled={busy || fileBusy} onClick={() => { recovery.clear(); setPendingAudio(null); setError(""); setMessage("已结束本次导入；不会删除服务器中已经保存的文件或歌单，可刷新列表确认。"); }}>结束本次导入</button></div></section>}
    {localAudio && <section className="music-local-audio" aria-label="本机音频播放器"><strong>{localAudio.name}</strong><audio src={localAudio.url} controls playsInline preload="metadata" /><p>仅本机播放，不能投屏/跨设备同步；文件不会上传、发送后端或交给 AI。</p></section>}
    {error && <p className="music-feedback is-error" role="alert">{error}</p>}{message && <p className="music-feedback" role="status">{message}</p>}
    {!compact && <div className="music-playlist-list"><h4>歌单列表</h4>{playlists.length ? playlists.map((playlist) => <article key={playlist.id}><button type="button" className="music-playlist-summary" aria-expanded={selected?.id === playlist.id} onClick={() => void selectSavedPlaylist(playlist.id)}><strong>{playlist.name}</strong><span>{musicPlaylistStatus(playlist)} · 来源：{playlist.provider}</span></button><button type="button" className="danger" disabled={busy} onClick={() => void removePlaylist(playlist.id)}>删除</button></article>) : <p>还没有导入歌单。</p>}</div>}
    {!compact && selected && <section className="music-playlist-detail" aria-label="歌单详情"><h4>{selected.name}</h4><p>来源：{selected.provider} · {selected.itemCount} 首</p>{selected.providerPlaylistId && <button type="button" onClick={() => void openExternal({}, "playlist", selected.providerPlaylistId)}>在网易云打开歌单</button>}{selected.items.length ? <MusicPagedList key={selected.id} items={selected.items} label="歌单详情" renderItem={(item, index) => { const playback = resolveMusicPlayback(item); return <div key={item.id || index}><span>{index + 1}</span><span><strong>{item.title}</strong><small>{item.artist || "未知艺术家"} · 播放模式：{playback.mode}</small></span>{playback.mode === MUSIC_PLAYBACK_MODES.external ? <button type="button" onClick={() => void openExternal(item)}>在网易云打开</button> : <audio src={playback.url} controls preload="none" aria-label={`播放 ${item.title}`} />}</div>; }} /> : <p>此歌单已保存链接元数据，尚无曲目；可在网易云打开，或连接 MCP 后重新导入补全。</p>}</section>}
  </section>;
}
