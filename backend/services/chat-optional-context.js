// All loaders operate on the caller's scoped database. Nothing is cached across users.
async function loadOptionalChatContext({ loaders, onError = () => {} }) {
    const entries = Object.entries(loaders);
    const settled = await Promise.allSettled(entries.map(([, load]) => Promise.resolve().then(load)));
    return Object.fromEntries(settled.map((result, index) => {
        const name = entries[index][0];
        if (result.status === "fulfilled") return [name, result.value];
        onError(name, result.reason?.code || "optional_context_failed");
        return [name, null];
    }));
}

module.exports = { loadOptionalChatContext };
