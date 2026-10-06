(function () {
    "use strict";

    document.documentElement.classList.add("azpace-auth-pending");

    const config = window.AZPACE_SUPABASE_CONFIG || {};
    const pageName = location.pathname.split("/").pop() || "index.html";
    const isLoginPage = pageName === "login.html";
    const native = {
        getItem: Storage.prototype.getItem,
        setItem: Storage.prototype.setItem,
        removeItem: Storage.prototype.removeItem,
        clear: Storage.prototype.clear,
        key: Storage.prototype.key
    };

    const state = {
        client: null,
        user: null,
        profile: null,
        cache: new Map(),
        pending: new Map(),
        legacy: new Map(),
        migrationAvailable: false,
        flushTimer: null,
        flushPromise: null,
        failure: null,
        ready: null
    };

    document.addEventListener("DOMContentLoaded", () => {
        if (!document.documentElement.classList.contains("azpace-auth-pending")) return;
        const loading = document.createElement("div");
        loading.id = "azpace-auth-loading";
        loading.setAttribute("role", "status");
        loading.setAttribute("aria-live", "polite");
        loading.textContent = "Checking your A-Zpace session…";
        document.body.append(loading);
    }, { once: true });

    function nativeKeys(storage) {
        const keys = [];
        for (let i = 0; i < storage.length; i += 1) {
            const key = native.key.call(storage, i);
            if (key) keys.push(key);
        }
        return keys;
    }

    function isSupabaseKey(key) {
        return key.startsWith("sb-") || key === "supabase.auth.token";
    }

    function setPendingMessage(message, kind) {
        const node = document.getElementById("azpace-auth-status") ||
            document.getElementById("login-message");
        if (!node) return;
        node.textContent = message || "";
        node.dataset.kind = kind || "";
    }

    function loginUrl() {
        const next = location.pathname.split("/").pop() + location.search;
        return "login.html?next=" + encodeURIComponent(next);
    }

    function revealPage() {
        document.documentElement.classList.remove("azpace-auth-pending");
        document.documentElement.classList.add("azpace-authenticated");
        document.getElementById("azpace-auth-loading")?.remove();
    }

    function explainFailure(error) {
        if (!isLoginPage) {
            const query = new URLSearchParams();
            if (error && error.message) query.set("error", error.message.slice(0, 240));
            query.set("next", location.pathname.split("/").pop() + location.search);
            location.replace("login.html?" + query.toString());
            return;
        }
        revealPage();
        setPendingMessage(
            error && error.message ? error.message : "Could not connect to the authentication service.",
            "error"
        );
    }

    function cacheKey(userId, key) {
        return "azpace:cache:" + userId + ":" + key;
    }

    function readLocalCache(key) {
        const raw = native.getItem.call(window.localStorage, cacheKey(state.user.id, key));
        if (!raw) return null;
        try {
            const value = JSON.parse(raw);
            return value && typeof value === "object" ? value : null;
        } catch (error) {
            console.error("Could not read the local workspace sync queue:", error);
            return null;
        }
    }

    function writeLocalCache(key, value, pending) {
        try {
            native.setItem.call(window.localStorage, cacheKey(state.user.id, key), JSON.stringify({
                value,
                pending: Boolean(pending),
                removed: value === null,
                savedAt: Date.now()
            }));
        } catch (error) {
            console.error("Could not cache the workspace sync queue:", error);
            setPendingMessage("Local browser storage is full; cloud sync may be delayed.", "error");
        }
    }

    async function loadCloudWorkspace() {
        const { data, error } = await state.client
            .from("workspace_items")
            .select("item_key,item_value,updated_at");
        if (error) throw error;

        const cloud = new Map(data.map(row => [row.item_key, row.item_value]));
        const prefix = "azpace:cache:" + state.user.id + ":";
        for (const key of nativeKeys(window.localStorage)) {
            if (!key.startsWith(prefix)) continue;
            const itemKey = key.slice(prefix.length);
            const local = readLocalCache(itemKey);
            if (!local) continue;
            if (local.pending) {
                if (local.removed) {
                    cloud.delete(itemKey);
                    state.pending.set(itemKey, null);
                } else {
                    cloud.set(itemKey, String(local.value));
                    state.pending.set(itemKey, String(local.value));
                }
            }
        }

        state.cache = cloud;
        for (const [key, value] of cloud) {
            const local = readLocalCache(key);
            if (!local || !local.pending) writeLocalCache(key, value, false);
        }
        for (const [key, value] of state.pending) {
            if (value === null) state.cache.delete(key);
            else state.cache.set(key, value);
        }
        scheduleFlush(0);
    }

    function installStorageAdapter() {
        const appStorage = storage => storage === window.localStorage;
        const nativeAppKeys = nativeKeys(window.localStorage)
            .filter(key => !isSupabaseKey(key) && !key.startsWith("azpace:cache:"));
        state.legacy = new Map(nativeAppKeys.map(key => [
            key,
            native.getItem.call(window.localStorage, key)
        ]));
        state.migrationAvailable = state.legacy.size > 0;

        Object.defineProperties(Storage.prototype, {
            getItem: {
                configurable: true,
                value: function (key) {
                    const itemKey = String(key);
                    if (!appStorage(this) || isSupabaseKey(itemKey)) {
                        return native.getItem.call(this, itemKey);
                    }
                    return state.cache.has(itemKey) ? state.cache.get(itemKey) : null;
                }
            },
            setItem: {
                configurable: true,
                value: function (key, value) {
                    const itemKey = String(key);
                    const itemValue = String(value);
                    if (!appStorage(this) || isSupabaseKey(itemKey)) {
                        return native.setItem.call(this, itemKey, itemValue);
                    }
                    state.cache.set(itemKey, itemValue);
                    state.pending.set(itemKey, itemValue);
                    writeLocalCache(itemKey, itemValue, true);
                    scheduleFlush();
                }
            },
            removeItem: {
                configurable: true,
                value: function (key) {
                    const itemKey = String(key);
                    if (!appStorage(this) || isSupabaseKey(itemKey)) {
                        return native.removeItem.call(this, itemKey);
                    }
                    state.cache.delete(itemKey);
                    state.pending.set(itemKey, null);
                    writeLocalCache(itemKey, null, true);
                    scheduleFlush();
                }
            },
            clear: {
                configurable: true,
                value: function () {
                    if (!appStorage(this)) return native.clear.call(this);
                    for (const key of state.cache.keys()) {
                        state.pending.set(key, null);
                        writeLocalCache(key, null, true);
                    }
                    state.cache.clear();
                    scheduleFlush();
                }
            },
            key: {
                configurable: true,
                value: function (index) {
                    if (!appStorage(this)) return native.key.call(this, index);
                    return [...state.cache.keys()][Number(index)] || null;
                }
            },
            length: {
                configurable: true,
                get: function () {
                    if (!appStorage(this)) {
                        let count = 0;
                        while (native.key.call(this, count) !== null) count += 1;
                        return count;
                    }
                    return state.cache.size;
                }
            }
        });
    }

    async function flush() {
        if (state.flushPromise) return state.flushPromise;
        if (!state.client || !state.user || state.pending.size === 0) return true;
        const operation = (async () => {
            const batch = new Map(state.pending);
            const upserts = [...batch]
                .filter(([, value]) => value !== null)
                .map(([item_key, item_value]) => ({
                    user_id: state.user.id,
                    item_key,
                    item_value,
                    updated_at: new Date().toISOString()
                }));
            const removals = [...batch]
                .filter(([, value]) => value === null)
                .map(([key]) => key);

            if (upserts.length) {
                const { error } = await state.client
                    .from("workspace_items")
                    .upsert(upserts, { onConflict: "user_id,item_key" });
                if (error) {
                    setPendingMessage("Cloud save failed. Your changes are queued on this device.", "error");
                    console.error("Could not sync workspace changes:", error);
                    return false;
                }
            }

            if (removals.length) {
                const { error } = await state.client
                    .from("workspace_items")
                    .delete()
                    .eq("user_id", state.user.id)
                    .in("item_key", removals);
                if (error) {
                    setPendingMessage("Cloud delete failed. Your changes are queued on this device.", "error");
                    console.error("Could not sync workspace deletions:", error);
                    return false;
                }
            }

            for (const [key, value] of batch) {
                if (state.pending.get(key) !== value) continue;
                state.pending.delete(key);
                if (value === null) {
                    native.removeItem.call(window.localStorage, cacheKey(state.user.id, key));
                } else {
                    writeLocalCache(key, value, false);
                }
            }
            setPendingMessage(state.pending.size ? "Some changes are still syncing." : "", "");
            if (state.pending.size) scheduleFlush(0);
            return true;
        })();
        state.flushPromise = operation;
        try {
            return await operation;
        } finally {
            state.flushPromise = null;
        }
    }

    function scheduleFlush(delay) {
        clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(() => {
            flush().catch(error => {
                console.error("Workspace sync failed:", error);
                setPendingMessage("Cloud sync failed. Please check your connection.", "error");
            });
        }, delay === undefined ? 180 : delay);
    }

    async function loadProfile() {
        const { data, error } = await state.client
            .from("profiles")
            .select("id,email,display_name,avatar_url,created_at,updated_at,plan,plan_status,pro_expires_at,pro_source")
            .eq("id", state.user.id)
            .single();
        if (error) throw error;
        state.profile = data;
    }

    async function start() {
        if (!config.url || !config.anonKey ||
            config.url.includes("YOUR_PROJECT_REF") ||
            config.anonKey.includes("YOUR_SUPABASE_PUBLISHABLE")) {
            throw new Error("Supabase is not configured. Add your project URL and publishable/anon key to supabase-config.js.");
        }
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            throw new Error("The Supabase client library did not load. Check your internet connection and content security policy.");
        }

        state.client = window.supabase.createClient(config.url, config.anonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: "pkce"
            }
        });

        const { data, error } = await state.client.auth.getSession();
        if (error) throw error;
        state.user = data.session && data.session.user || null;
        state.client.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT" && state.user && !isLoginPage) {
                location.replace("login.html");
                return;
            }
            if (session && session.user) state.user = session.user;
            document.dispatchEvent(new CustomEvent("azpace:auth-state", {
                detail: { event, user: state.user }
            }));
        });

        if (!state.user) {
            if (!isLoginPage) location.replace(loginUrl());
            else revealPage();
            return null;
        }
        if (isLoginPage && new URLSearchParams(location.search).get("mode") !== "recovery") {
            if (new URLSearchParams(location.search).has("error")) {
                revealPage();
                return null;
            }
            location.replace(safeNext());
            return null;
        }

        await loadProfile();
        await loadCloudWorkspace();
        installStorageAdapter();
        revealPage();
        document.dispatchEvent(new CustomEvent("azpace:ready", {
            detail: { user: state.user, profile: state.profile }
        }));
        return { user: state.user, profile: state.profile };
    }

    function safeNext() {
        const candidate = new URLSearchParams(location.search).get("next") || "index.html";
        if (!/^(index|word|sheets|ppt|pdf|notes|admin)\.html(?:\?[\w%=&.-]*)?$/.test(candidate)) {
            return "index.html";
        }
        return candidate;
    }

    async function getAccount() {
        if (!state.user) throw new Error("Sign in to view your account.");
        const { data, error } = await state.client
            .from("profiles")
            .select("id,email,display_name,avatar_url,created_at,updated_at,plan,plan_status,pro_expires_at,pro_source")
            .eq("id", state.user.id)
            .single();
        if (error) throw error;
        const { data: hasPro, error: entitlementError } = await state.client.rpc("has_pro_access");
        if (entitlementError) throw entitlementError;
        state.profile = data;
        return { profile: data, hasPro: Boolean(hasPro) };
    }

    async function updateProfile(values) {
        const allowed = {};
        if (typeof values.display_name === "string") allowed.display_name = values.display_name.trim().slice(0, 80) || null;
        if (typeof values.avatar_url === "string") allowed.avatar_url = values.avatar_url.trim().slice(0, 2048) || null;
        const { data, error } = await state.client
            .from("profiles")
            .update(allowed)
            .eq("id", state.user.id)
            .select("id,email,display_name,avatar_url,created_at,updated_at,plan,plan_status,pro_expires_at,pro_source")
            .single();
        if (error) throw error;
        state.profile = data;
        return data;
    }

    async function migrateDeviceData() {
        if (!state.user || state.legacy.size === 0) {
            throw new Error("No unimported device workspace data was found.");
        }
        const rows = [...state.legacy].map(([item_key, item_value]) => ({
            user_id: state.user.id,
            item_key,
            item_value: String(item_value),
            updated_at: new Date().toISOString()
        }));
        for (let offset = 0; offset < rows.length; offset += 10) {
            const { error } = await state.client
                .from("workspace_items")
                .upsert(rows.slice(offset, offset + 10), { onConflict: "user_id,item_key" });
            if (error) throw error;
        }
        for (const [key, value] of state.legacy) {
            state.cache.set(key, String(value));
            native.removeItem.call(window.localStorage, key);
        }
        state.legacy.clear();
        state.migrationAvailable = false;
        location.reload();
    }

    function redirectToLogin() {
        state.client.auth.signOut().catch(error => console.error("Could not sign out:", error));
        location.replace("login.html");
    }

    state.ready = start().catch(error => {
        state.failure = error;
        console.error("A-Zpace authentication setup failed:", error);
        explainFailure(error);
        return null;
    });

    window.AZpaceAuth = {
        get client() { return state.client; },
        get user() { return state.user; },
        get profile() { return state.profile; },
        get error() { return state.failure; },
        get legacyDataAvailable() { return state.migrationAvailable; },
        get legacyDataCount() { return state.legacy.size; },
        ready: state.ready,
        safeNext,
        getAccount,
        updateProfile,
        migrateDeviceData,
        flush,
        redirectToLogin,
        async logout() {
            if (state.client) {
                await flush();
                const { error } = await state.client.auth.signOut();
                if (error) throw error;
            }
            state.user = null;
            state.profile = null;
            state.cache.clear();
            state.pending.clear();
            location.replace("login.html");
        }
    };

    if (!isLoginPage) {
        window.addEventListener("pagehide", () => {
            if (state.pending.size) {
                flush().catch(error => {
                    console.error("Could not flush workspace changes while leaving:", error);
                });
            }
        });
    }
}());
