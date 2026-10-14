const FEATURE_COPY = Object.freeze({
  art: { eyebrow: "ART", title: "灵感", script: "a little something for you", label: "涂鸦画室" },
  moments: {
    eyebrow: "MOMENTS",
    title: "此刻",
    script: "little things we keep",
    label: "动态空间",
  },
  diary: {
    eyebrow: "DIARY",
    title: "手记",
    script: "written under the same light",
    label: "记忆手记",
  },
  memory: {
    eyebrow: "MEMORY",
    title: "记忆",
    script: "things we keep",
    label: "长期记忆",
  },
});

export default function FeatureAtmosphere({ kind }) {
  const copy = FEATURE_COPY[kind] || FEATURE_COPY.memory;

  return (
    <section
      className={`feature-atmosphere feature-atmosphere--${kind}`}
      aria-label={copy.label}
    >
      <div className="feature-atmosphere-copy">
        <span>{copy.eyebrow}</span>
        <strong>{copy.title}</strong>
        <em>{copy.script}</em>
      </div>
      {kind === "diary" || kind === "memory" ? (
        <img className="feature-atmosphere-coast" src="/assets/journal-coast.webp" alt="" decoding="async" aria-hidden="true" />
      ) : <div className="feature-atmosphere-art" aria-hidden="true">
        <i className="feature-cloud cloud-back" />
        <i className="feature-cloud cloud-anchor">
          <i className="feature-anchor-object" />
        </i>
        <i className="feature-spark spark-one" />
        <i className="feature-spark spark-two" />
        <i className="feature-orbit" />
        <i className="feature-chibi">
          <i className="feature-chibi-ear ear-left" />
          <i className="feature-chibi-ear ear-right" />
          <i className="feature-chibi-face">
            <i />
            <i />
          </i>
        </i>
      </div>}
    </section>
  );
}
