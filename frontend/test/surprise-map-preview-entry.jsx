import { createRoot } from "react-dom/client";
import { SurpriseMapContent } from "../src/SurpriseMap.jsx";
import "../src/index.css";

const privateLetters = [{ id: "11111111-1111-4111-8111-111111111111", title: "风来的时候，拆开我", place_label: "海边的那张长椅", claimed: false, area: { latitude: 0.005, longitude: 0.003, radius_m: 300 } }];
const publicLetters = [{ id: "22222222-2222-4222-8222-222222222222", title: "给路过这里的你", place_label: "虚构的灯塔广场", claimed: false, area: { latitude: 0.004, longitude: 0, radius_m: 2000 } }];
const request = async (path, options) => {
  if (path.endsWith("/draft")) return { draft: { title: "在海风里等你", body: "如果今天走得有点累，就在这儿歇一歇。你不必着急，我陪你看一会儿海。" } };
  if (path.endsWith("/claim")) { const letter = [...privateLetters, ...publicLetters].find(item => path.includes(item.id)); return { ok: true, letter: { ...letter, claimed: true, body: "这是一封虚构预览来信。愿你抬头时，正好有一片很轻的云。" } }; }
  if (options?.method === "POST" && path.endsWith("/letters")) { const letter = { id: crypto.randomUUID(), ...options.body, area: { latitude: 0, longitude: 0, radius_m: 300 } }; privateLetters.push(letter); return { ok: true, letter, published: false }; }
  if (options?.method === "POST") { const publication = { id: crypto.randomUUID(), title: options.body.public_title, owned: true, area: { latitude: Number(options.body.public_latitude), longitude: Number(options.body.public_longitude), radius_m: 2000 } }; publicLetters.push(publication); return { ok: true, publication }; }
  if (options?.method === "DELETE") { const id = path.split("/").at(-1), index = publicLetters.findIndex(letter => letter.id === id); if (index !== -1) publicLetters.splice(index, 1); return { ok: true, id, state: "withdrawn" }; }
  return { ok: true, letters: path.endsWith("/public") ? publicLetters : privateLetters };
};
createRoot(document.getElementById("root")).render(<><p style={{ padding: "10px 16px", margin: 0, background: "#fff3d8", color: "#70502e", fontSize: 12 }}>本地虚构预览 · 不获取真实定位、不调用模型、不上传内容</p><SurpriseMapContent request={request} isCurrent={() => true} aiName="小灯" locatePosition={async () => ({ latitude: 0, longitude: 0, accuracy: 8, captured_at: new Date().toISOString() })} /></>);
