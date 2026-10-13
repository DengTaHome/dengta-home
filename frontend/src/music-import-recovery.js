export function createMusicImportRecovery({ upload, save, requestId = () => crypto.randomUUID() }) {
  let receipt = null;
  function pending(scope) { return receipt && scope.current(receipt.token) ? receipt : null; }
  async function resume(scope, token) {
    const entry = pending(scope);
    if (!entry) throw Object.assign(new Error("没有可继续保存的音频，请重新选择文件。"), { code: "music_audio_recovery_missing" });
    scope.assertCurrent(token);
    const imported = await save(entry.payload, token.options);
    scope.assertCurrent(token);
    if (receipt === entry) receipt = null;
    return { audio: entry.audio, imported };
  }
  return {
    pending,
    clear() { receipt = null; },
    resume,
    async start(file, scope, token, onUploaded) {
      if (pending(scope)) throw Object.assign(new Error("已有上传完成的音频，请先继续保存歌单，或选择结束本次导入。"), { code: "music_audio_recovery_pending" });
      scope.assertCurrent(token);
      const audio = await upload(file, token.options);
      scope.assertCurrent(token);
      receipt = { audio, token, payload: { format: "txt", sourceName: "本机音频", name: `本机 · ${audio.title}`, content: audio.url, requestId: requestId() } };
      onUploaded?.(audio);
      return resume(scope, token);
    },
  };
}
