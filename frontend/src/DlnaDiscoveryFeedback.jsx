const ERRORS = {
  dlna_network_unavailable: ["没有找到可用的局域网地址。", "连接 Wi-Fi 后重新开启投屏接收。"],
  dlna_ssdp_bind_failed: ["投屏发现端口无法监听。", "关闭后重新开启；若仍失败，检查是否有其他投屏服务占用端口。"],
  dlna_multicast_join_failed: ["无法加入投屏发现组播。", "检查 Wi-Fi 网络是否允许设备发现，再重新开启。"],
  dlna_http_bind_failed: ["投屏接收服务端口无法启动。", "重新开启投屏接收；若仍失败，用错误代码检查接收服务。"],
  dlna_ssdp_receive_failed: ["投屏发现监听中断。", "重新开启投屏接收。"],
  dlna_http_receive_failed: ["投屏接收连接中断。", "重新开启投屏接收。"],
  dlna_state_unavailable: ["暂时无法读取投屏接收状态。", "重新开启投屏接收并检查状态。"],
};
export default function DlnaDiscoveryFeedback({ state }) {
  if (state.discoveryStatus === "starting") return <p role="status">正在启动投屏发现与接收服务，尚未就绪…</p>;
  if (state.discoveryStatus === "error" || state.errorCode) {
    const known = ERRORS[state.errorCode], code = known ? state.errorCode : "dlna_discovery_failed";
    return <p role="alert">{known?.[0] || "投屏发现服务未成功启动。"} {known?.[1] || "重新开启投屏接收；若仍失败，检查接收服务。"}<small>错误代码：{code}</small></p>;
  }
  if (!state.active) return null;
  return <p role="status">发现与接收服务已就绪。发送设备需在同一局域网；如果列表仍为空，请检查发送 App 是否支持 DLNA，以及路由器是否隔离设备。</p>;
}
