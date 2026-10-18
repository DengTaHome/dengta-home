import { useCallback, useEffect, useRef, useState } from "react";
import { useMemoryUiRequest } from "./memory-ui-feedback.js";
import { locateForSurpriseMap, mapRadarPoint, surpriseMapError } from "./surprise-map.js";
import { recordOperationFailure } from "./operation-diagnostics.js";
import SurpriseLetterMap from "./SurpriseLetterMap.jsx";
import { displayMapArea } from "./surprise-map-display.js";
import "./surprise-map.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalidReceipt = () => Object.assign(new Error("Invalid map receipt"), { code: "surprise_map_receipt_invalid" });
function validLetter(letter) {
  return letter && UUID.test(letter.id) && typeof letter.title === "string" && letter.title.trim() &&
    displayMapArea(letter.area) &&
    (!letter.claimed || (typeof letter.body === "string" && letter.body.trim()));
}
function readLetters(data) {
  if (data?.ok !== true || !Array.isArray(data.letters) || !data.letters.every(validLetter)) throw invalidReceipt();
  return data.letters;
}

export default function SurpriseMap({ scopeKey, aiName = "伴侣" }) {
  const { request, isCurrent } = useMemoryUiRequest(scopeKey);
  return <SurpriseMapContent key={scopeKey} request={request} isCurrent={isCurrent} aiName={aiName} scopeKey={scopeKey} />;
}

export function SurpriseMapContent({ request, isCurrent, aiName = "伴侣", scopeKey = "", locatePosition = locateForSurpriseMap }) {
  const [letters, setLetters] = useState([]), [publicLetters, setPublicLetters] = useState([]);
  const [view, setView] = useState("private"), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(""), [feedback, setFeedback] = useState("");
  const [position, setPosition] = useState(null), [revealed, setRevealed] = useState(null);
  const [draft, setDraft] = useState({ title: "", body: "", place_label: "", radius_m: 100 });
  const [publication, setPublication] = useState(null), [confirmPublic, setConfirmPublic] = useState(false);
  const [basemap, setBasemap] = useState(false), [selectedId, setSelectedId] = useState(null);
  const createReceipt = useRef(null);
  const mapArea = useRef(null);
  const loadSequence = useRef(0);
  const operation = useRef(null), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current = null; }; }, []);
  const current = useCallback(() => alive.current && isCurrent(), [isCurrent]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const results = await Promise.allSettled([request("/api/v2/surprise-map/letters").then(readLetters), request("/api/v2/surprise-map/public").then(readLetters)]);
    if (!current() || sequence !== loadSequence.current) return;
    const [mine, shared] = results;
    if (mine.status === "fulfilled") setLetters(mine.value);
    if (shared.status === "fulfilled") setPublicLetters(shared.value);
    const failed = results.find(result => result.status === "rejected");
    if (failed) setFeedback(surpriseMapError(failed.reason));
    setLoading(false);
  }, [current, request]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return load(); }); return () => { active = false; }; }, [load]);
  async function perform(name, action) {
    if (!current() || operation.current) return;
    const token = {}; operation.current = token; setBusy(name); setFeedback("");
    const owns = () => current() && operation.current === token;
    try { await action(owns); }
    catch (error) { if (owns()) { recordOperationFailure(scopeKey, "/api/v2/surprise-map", error); setFeedback(surpriseMapError(error)); } }
    finally { if (owns()) { operation.current = null; setBusy(""); } }
  }
  const items = view === "private" ? letters : publicLetters;
  const selected = items.find(letter => letter.id === selectedId);
  const center = selected?.area || position || items[0]?.area || null;
  async function locate(owns) {
    const value = await locatePosition();
    if (!owns()) return null;
    setPosition(value); return value;
  }
  const choosePublication = letter => {
    setConfirmPublic(false);
    setPublication({ id: letter.id, public_title: "", public_text: "", public_place: "", public_latitude: "", public_longitude: "" });
  };
  return <section className="feature-page surprise-map-page">
    <header className="section-intro"><span className="eyebrow">沿途有信</span><h2>把惊喜留在某个地方</h2>
      <p>{aiName}可以先写一封信，你选一个地方藏好。走近后打开，也能发现别人愿意公开的问候。</p></header>
    <div className="surprise-map-tabs" role="group" aria-label="地图范围">
      <button type="button" aria-pressed={view === "private"} onClick={() => setView("private")}>我们的信</button>
      <button type="button" aria-pressed={view === "public"} onClick={() => setView("public")}>公共惊喜</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void perform("refresh", load)}>刷新</button>
    </div>
    <div className="surprise-map-basemap-choice">
      <p>开启街道地图后，会向 OpenStreetMap 请求当前查看区域的地图图片，服务方可获得 IP 和区域信息。不会发送信件正文或本次精确定位；定位只用于灯塔内核对距离。</p>
      <button type="button" aria-pressed={basemap} onClick={() => setBasemap(value => !value)}>{basemap ? "切回方位图，关闭在线地图" : "本次开启街道地图"}</button>
    </div>
    <div ref={mapArea}>{basemap ? <SurpriseLetterMap items={items} position={position} selectedId={selected?.id || null} onSelect={setSelectedId} /> : <div className="surprise-map-radar" role="img" aria-label="信件方位示意图，非导航地图">
      <span className="surprise-map-compass">N</span><span className="surprise-map-center">✦</span>
      {items.map(letter => { const point = mapRadarPoint(letter.area, center); return point && <span key={letter.id} className="surprise-map-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} title={letter.title}>✉</span>; })}
      <small>附近方位示意 · 位置已模糊</small>
    </div>}</div>
    {selected && <div className="surprise-map-selected" role="status"><strong>{selected.title}</strong><p>{selected.place_label || selected.public_place || "附近的一处地方"} · 图中显示模糊范围，走近后仍需重新定位领取。</p><button type="button" onClick={() => setSelectedId(null)}>收起地图选中项</button></div>}
    <p className="surprise-map-location">定位仅在你点击时进行，不持续记录轨迹。{position ? `本次精度约 ${Math.ceil(position.accuracy)} 米。` : "还未使用本次位置。"}</p>
    <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void perform("locate", locate)}>{busy === "locate" ? "正在定位…" : "使用本次精确位置"}</button>
    {feedback && <p role="alert" className="surprise-map-feedback">{feedback}</p>}
    <div className="surprise-map-list" aria-busy={loading}>
      {loading && <p role="status">正在寻找信件…</p>}
      {!loading && !items.length && <p>{view === "private" ? "还没有藏好的信，先让伴侣写一封吧。" : "这里还没有公开的惊喜。私人信件不会自动出现在这里。"}</p>}
      {items.map(letter => <article className="surprise-map-card" key={letter.id}>
        <span className="eyebrow">{letter.claimed ? "已经打开" : "等待相遇"}</span><h3>{letter.title}</h3>
        <p>{letter.place_label || letter.public_place || "附近的一处地方"}</p>
        <button type="button" aria-pressed={selected?.id === letter.id} onClick={() => { setSelectedId(letter.id); mapArea.current?.scrollIntoView({ block: "center", behavior: "auto" }); }}>查看这封信的范围</button>
        <div className="surprise-map-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void perform(`claim:${letter.id}`, async owns => {
          if (letter.claimed && typeof letter.body === "string") { setRevealed(letter); return; }
          const fresh = await locate(owns); if (!fresh) return;
          const data = await request(`/api/v2/surprise-map/${view === "private" ? "letters" : "public"}/${encodeURIComponent(letter.id)}/claim`, { method: "POST", body: fresh });
          if (!owns()) return;
          if (data?.ok !== true || !validLetter(data.letter) || data.letter.id !== letter.id || data.letter.claimed !== true) throw invalidReceipt();
          setRevealed(data.letter); await load();
        })}>{letter.claimed ? "再读这封信" : "走近了，打开信"}</button>
        {view === "private" && <button type="button" disabled={Boolean(busy)} onClick={() => choosePublication(letter)}>另写公开版本</button>}
        {view === "private" && letter.publication?.state === "published" && <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`withdraw:${letter.publication.id}`, async owns => {
          const data = await request(`/api/v2/surprise-map/public/${encodeURIComponent(letter.publication.id)}`, { method: "DELETE" });
          if (!owns()) return;
          if (data?.ok !== true || data.id !== letter.publication.id || data.state !== "withdrawn") throw invalidReceipt();
          await load();
        })}>撤回公开</button>}
        {view === "public" && letter.owned === true && <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`withdraw:${letter.id}`, async owns => {
          const data = await request(`/api/v2/surprise-map/public/${encodeURIComponent(letter.id)}`, { method: "DELETE" });
          if (!owns()) return;
          if (data?.ok !== true || data.id !== letter.id || data.state !== "withdrawn") throw invalidReceipt();
          await load();
        })}>撤回公开</button>}</div>
      </article>)}
    </div>
    {revealed && <article className="surprise-map-opened" aria-label="打开的信"><button type="button" onClick={() => setRevealed(null)}>收起信件</button><h3>{revealed.title}</h3><p>{revealed.body}</p></article>}
    {view === "private" && <form className="surprise-map-form" onSubmit={event => {
      event.preventDefault(); void perform("create", async owns => {
        const fingerprint = JSON.stringify(draft);
        if (createReceipt.current?.fingerprint !== fingerprint) {
          const fresh = await locate(owns); if (!fresh) return;
          createReceipt.current = { fingerprint, body: { ...draft, ...fresh, client_request_id: crypto.randomUUID() } };
        } else if (createReceipt.current.refreshPosition) {
          const fresh = await locate(owns); if (!fresh) return;
          createReceipt.current = { ...createReceipt.current, body: { ...createReceipt.current.body, ...fresh }, refreshPosition: false };
        }
        const receipt = createReceipt.current;
        let saved;
        try { saved = await request("/api/v2/surprise-map/letters", { method: "POST", body: receipt.body }); }
        catch (error) {
          if (owns() && ["surprise_map_location_stale", "surprise_map_location_invalid", "surprise_map_location_inaccurate"].includes(error?.code)) receipt.refreshPosition = true;
          throw error;
        }
        if (!owns()) return;
        if (saved?.ok !== true || !validLetter(saved.letter) || saved.letter.title !== receipt.body.title || saved.published !== false) throw invalidReceipt();
        createReceipt.current = null;
        setDraft(currentDraft => JSON.stringify(currentDraft) === fingerprint ? ({ ...currentDraft, title: "", body: "" }) : currentDraft);
        await load(); if (owns()) setFeedback(saved?.replayed ? "已确认上次选择的落点和来信，没有重复留信或更换地点。" : "信已藏在本次选择的位置，默认只有你们能发现。 ");
      });
    }}><h3>藏一封新信</h3><label>地点提示<input disabled={Boolean(busy)} value={draft.place_label} maxLength={120} placeholder="例如：下次散步的公园" onChange={event => setDraft({ ...draft, place_label: event.target.value })} /></label>
      <button type="button" disabled={Boolean(busy)} onClick={() => void perform("draft", async owns => {
        const data = await request("/api/v2/surprise-map/draft", { method: "POST", timeoutMs: 90000, body: { place_label: draft.place_label || "沿途的一处地方", mood: "沿途的小惊喜" } });
        if (!owns()) return;
        if (!data?.draft?.title || !data?.draft?.body) throw Object.assign(new Error("Invalid draft"), { code: "surprise_map_draft_invalid" });
        setDraft(value => JSON.stringify(value) === JSON.stringify(draft) ? ({ ...value, title: data.draft.title, body: data.draft.body }) : value);
      })}>{busy === "draft" ? "正在写信…" : `请${aiName}写一封`}</button>
      <label>信的标题<input disabled={Boolean(busy)} required value={draft.title} maxLength={120} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>信里写着<textarea disabled={Boolean(busy)} required rows={5} value={draft.body} maxLength={6000} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      <label>靠近多少米可打开<select disabled={Boolean(busy)} value={draft.radius_m} onChange={event => setDraft({ ...draft, radius_m: Number(event.target.value) })}><option value={50}>50 米</option><option value={100}>100 米</option><option value={300}>300 米</option><option value={1000}>1000 米</option></select></label>
      <small>保存时重新定位，将信留在你当前的位置。默认只属于当前账号和伴侣。写信会使用你当前的模型接口。</small>
      <button className="primary-button" disabled={Boolean(busy)}>{busy === "create" ? "正在藏好…" : "在这里藏好，只给我们"}</button>
    </form>}
    {publication && <form className="surprise-map-form" aria-label="公开信预览" onSubmit={event => {
      event.preventDefault(); if (!confirmPublic) return; void perform("publish", async owns => {
        const { id, ...publicDraft } = publication;
        const data = await request(`/api/v2/surprise-map/letters/${encodeURIComponent(id)}/publish`, { method: "POST", body: { ...publicDraft, public_latitude: Number(publication.public_latitude), public_longitude: Number(publication.public_longitude), confirm_publication: confirmPublic } });
        if (!owns()) return;
        if (data?.ok !== true || !validLetter(data.publication) || data.publication.title !== publicDraft.public_title) throw invalidReceipt();
        setPublication(null); setView("public"); await load();
      });
    }}><h3>一封可被陌生人发现的信</h3><p>请重新填写公开文案及公共地点。不会复制私人信件或本次精确位置。发布后所有已登录用户都能发现。</p>
      {[['public_title','公开标题'],['public_text','公开文案'],['public_place','公共地点名称'],['public_latitude','公共地点纬度'],['public_longitude','公共地点经度']].map(([field, label]) => <label key={field}>{label}{field === "public_text"
        ? <textarea disabled={Boolean(busy)} required rows={4} value={publication[field]} maxLength={2000} onChange={event => { setConfirmPublic(false); setPublication({ ...publication, [field]: event.target.value }); }} />
        : <input disabled={Boolean(busy)} required type={field.endsWith('latitude') || field.endsWith('longitude') ? "number" : "text"} step="any" value={publication[field]} maxLength={120} onChange={event => { setConfirmPublic(false); setPublication({ ...publication, [field]: event.target.value }); }} />}</label>)}
      <small>请填公共公园、广场等地点，不要填写住所。位置会取整到约 1 公里范围。</small>
      <label className="surprise-map-consent"><input disabled={Boolean(busy)} type="checkbox" checked={confirmPublic} onChange={event => setConfirmPublic(event.target.checked)} />我已核对上述公开文案和公共地点，同意公开发布</label>
      <div className="surprise-map-actions"><button className="primary-button" disabled={Boolean(busy) || !confirmPublic}>确认发布公开版本</button><button type="button" disabled={Boolean(busy)} onClick={() => setPublication(null)}>取消</button></div>
    </form>}
  </section>;
}
