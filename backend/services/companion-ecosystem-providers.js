const PROVIDERS = Object.freeze([
    {
        id: "custom_sticker",
        category: "asset",
        status: "ready",
        authType: "none",
        capabilities: ["upload", "list", "delete"],
        userConsentRequired: true
    },
    {
        id: "user_avatar",
        category: "asset",
        status: "ready",
        authType: "none",
        capabilities: ["upload", "set", "delete"],
        userConsentRequired: true
    },
    {
        id: "companion_avatar",
        category: "asset",
        status: "ready",
        authType: "none",
        capabilities: ["upload", "set", "delete"],
        userConsentRequired: true
    },
    {
        id: "chat_background",
        category: "asset",
        status: "ready",
        authType: "none",
        capabilities: ["upload", "set", "delete"],
        userConsentRequired: true
    },
    {
        id: "local_playlist",
        category: "music",
        status: "ready",
        authType: "none",
        capabilities: ["import", "playlists", "player"],
        userConsentRequired: true
    },
    {
        id: "netease",
        category: "music",
        status: "planned",
        authType: "oauth",
        capabilities: ["playlists", "player"],
        userConsentRequired: true,
        connectionStatus: "unconnected",
        officialOnly: true
    },
    {
        id: "generic_mcp",
        category: "music",
        status: "ready",
        authType: "mcp",
        capabilities: ["playlists", "player"],
        userConsentRequired: true
    },
    {
        id: "direct_https",
        category: "music",
        status: "ready",
        authType: "none",
        capabilities: ["open", "player"],
        userConsentRequired: true
    },
    {
        id: "cast_receiver",
        category: "media",
        status: "ready",
        authType: "none",
        capabilities: ["pair", "receive", "playback_sync"],
        userConsentRequired: true
    },
    {
        id: "chromecast",
        category: "media",
        status: "planned",
        authType: "none",
        capabilities: ["cast"],
        userConsentRequired: true
    },
    {
        id: "dlna",
        category: "media",
        status: "planned",
        authType: "none",
        capabilities: ["cast"],
        userConsentRequired: true
    },
    {
        id: "mcp_generic",
        category: "external",
        status: "ready",
        authType: "mcp",
        capabilities: ["tools", "resources", "prompts"],
        userConsentRequired: true
    },
    {
        id: "xiaohongshu_mcp",
        category: "external",
        status: "planned",
        authType: "mcp",
        capabilities: ["search", "publish"],
        userConsentRequired: true
    }
].map((provider) =>
    Object.freeze({
        ...provider,
        capabilities: Object.freeze([...provider.capabilities])
    })
));

function publicProvider(provider) {
    return provider
        ? { ...provider, capabilities: [...provider.capabilities] }
        : null;
}

function providerError(code, message) {
    return { ok: false, error: { code, message } };
}

function listProviders() {
    return PROVIDERS.map(publicProvider);
}

function providerById(providerId) {
    const normalizedId = String(providerId || "").trim();
    return publicProvider(
        PROVIDERS.find((provider) => provider.id === normalizedId)
    );
}

function validateProviderOperation(providerId, capability) {
    const provider = providerById(providerId);
    if (!provider) {
        return providerError(
            "PROVIDER_NOT_FOUND",
            "The requested ecosystem provider does not exist."
        );
    }
    if (provider.status !== "ready") {
        return providerError(
            "PROVIDER_NOT_READY",
            "The requested ecosystem provider is not ready."
        );
    }
    const normalizedCapability = String(capability || "").trim();
    if (!provider.capabilities.includes(normalizedCapability)) {
        return providerError(
            "CAPABILITY_NOT_SUPPORTED",
            "The ecosystem provider does not support this capability."
        );
    }
    return { ok: true, provider, capability: normalizedCapability };
}

module.exports = {
    listProviders,
    providerById,
    validateProviderOperation
};
