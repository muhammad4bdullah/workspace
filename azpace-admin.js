(function () {
    "use strict";

    const auth = window.AZpaceAuth;
    const entitlements = window.AZpaceEntitlements;
    const statusNode = () => document.getElementById("admin-status");

    function status(message, kind) {
        const node = statusNode();
        node.textContent = message || "";
        node.dataset.kind = kind || "";
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function localDate(value) {
        return value ? new Date(value).toLocaleString() : "No expiration";
    }

    function sourceLabel(value) {
        return value
            ? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())
            : "—";
    }

    async function listUsers(query) {
        const { data, error } = await auth.client.rpc("admin_search_users", {
            p_query: query || ""
        });
        if (error) throw error;
        return data;
    }

    async function refreshUsers(query) {
        const container = document.getElementById("admin-users");
        container.replaceChildren(element("div", "", "Loading users…"));
        try {
            const users = await listUsers(query);
            container.replaceChildren();
            if (!users.length) {
                container.append(element("div", "", "No matching accounts."));
                return;
            }
            users.forEach(user => {
                const row = element("article", "admin-user");
                const identity = element("div");
                identity.append(
                    element("strong", "", user.display_name || user.email),
                    element("small", "", user.email),
                    element("small", "", "Source: " + sourceLabel(user.pro_source))
                );
                const plan = element("div", "", user.plan.toUpperCase() + " · " + user.plan_status);
                const expiry = element("div", "", localDate(user.pro_expires_at));
                const grant = element("button", "", "Grant / extend Pro");
                const revoke = element("button", "", "Revoke Pro");
                grant.type = "button";
                revoke.type = "button";
                grant.addEventListener("click", () => grantAccess(user));
                revoke.addEventListener("click", () => revokeAccess(user));
                row.append(identity, plan, expiry, grant, revoke);
                container.append(row);
            });
        } catch (error) {
            container.replaceChildren();
            status(error.message || "Could not search accounts.", "error");
        }
    }

    async function grantAccess(user) {
        const duration = prompt("Grant/extend for 7, 30, or 90 days, or type custom for an exact expiration date.", "30");
        if (duration === null) return;
        const source = prompt("Access source: founder_gift, beta_access, or admin.", "founder_gift");
        if (source === null) return;
        const validSources = new Set(["founder_gift", "beta_access", "admin"]);
        if (!validSources.has(source)) {
            status("Choose founder_gift, beta_access, or admin as the grant source.", "error");
            return;
        }

        let args;
        if (duration.trim().toLowerCase() === "custom") {
            const expiration = prompt("Enter a future expiration date and time in ISO format (for example, 2026-11-06T12:00:00Z).");
            if (!expiration) return;
            const parsed = new Date(expiration);
            if (!Number.isFinite(parsed.getTime()) || parsed <= new Date()) {
                status("Enter a valid expiration date in the future.", "error");
                return;
            }
            args = {
                p_user_id: user.id,
                p_duration_days: null,
                p_expires_at: parsed.toISOString(),
                p_source: source,
                p_source_detail: "Admin grant"
            };
        } else {
            const days = Number(duration);
            if (!Number.isInteger(days) || days < 1 || days > 36500) {
                status("Duration must be a whole number between 1 and 36500 days.", "error");
                return;
            }
            args = {
                p_user_id: user.id,
                p_duration_days: days,
                p_expires_at: null,
                p_source: source,
                p_source_detail: "Admin grant"
            };
        }

        try {
            const { error } = await auth.client.rpc("admin_grant_pro", args);
            if (error) throw error;
            status("Pro access granted/extended for " + user.email + ".", "success");
            await refreshUsers(document.querySelector('#admin-search [name="query"]').value);
        } catch (error) {
            status(error.message || "Could not grant Pro access.", "error");
        }
    }

    async function revokeAccess(user) {
        if (!confirm("Revoke Pro access for " + user.email + "?")) return;
        try {
            const { error } = await auth.client.rpc("admin_revoke_pro", {
                p_user_id: user.id
            });
            if (error) throw error;
            status("Pro access revoked for " + user.email + ".", "success");
            await refreshUsers(document.querySelector('#admin-search [name="query"]').value);
        } catch (error) {
            status(error.message || "Could not revoke Pro access.", "error");
        }
    }

    async function refreshPromos() {
        const container = document.getElementById("admin-promos");
        try {
            const { data, error } = await auth.client.rpc("admin_list_promos");
            if (error) throw error;
            container.replaceChildren();
            if (!data.length) {
                container.append(element("div", "", "No promo codes have been created."));
                return;
            }
            data.forEach(promo => {
                const row = element("article", "promo-row");
                row.append(
                    element("strong", "", promo.code),
                    element("span", "", promo.duration_days + " days"),
                    element("span", "", promo.redemption_count + " / " + promo.max_redemptions),
                    element("span", "", promo.expires_at ? localDate(promo.expires_at) : "No expiry")
                );
                const active = element("button", "", promo.is_active ? "Deactivate" : "Activate");
                active.type = "button";
                active.addEventListener("click", async () => {
                    active.disabled = true;
                    try {
                        const { error: updateError } = await auth.client.rpc("admin_set_promo_active", {
                            p_promo_id: promo.id,
                            p_is_active: !promo.is_active
                        });
                        if (updateError) throw updateError;
                        await refreshPromos();
                    } catch (error) {
                        status(error.message || "Could not update promo code.", "error");
                        active.disabled = false;
                    }
                });
                row.append(active);
                container.append(row);
            });
        } catch (error) {
            status(error.message || "Could not load promo codes.", "error");
        }
    }

    document.addEventListener("DOMContentLoaded", async () => {
        document.getElementById("admin-home").addEventListener("click", () => {
            location.href = "index.html";
        });

        const session = await auth.ready;
        if (!session) return;
        try {
            if (!await entitlements.isAdmin()) {
                status("Administrator access required. This account is not authorized to use these controls.", "error");
                document.querySelectorAll(".azpace-admin section").forEach(section => {
                    section.hidden = true;
                });
                return;
            }
        } catch (error) {
            status(error.message || "Could not verify administrator access.", "error");
            document.querySelectorAll(".azpace-admin section").forEach(section => {
                section.hidden = true;
            });
            return;
        }

        document.querySelectorAll(".azpace-admin section").forEach(section => {
            section.hidden = false;
        });

        document.getElementById("admin-search").addEventListener("submit", event => {
            event.preventDefault();
            refreshUsers(event.currentTarget.elements.query.value.trim());
        });

        document.getElementById("promo-form").addEventListener("submit", async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const button = form.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const expiresAt = form.elements.expires.value
                    ? new Date(form.elements.expires.value).toISOString()
                    : null;
                const { error } = await auth.client.rpc("admin_upsert_promo", {
                    p_code: form.elements.code.value.trim(),
                    p_duration_days: Number(form.elements.duration.value),
                    p_max_redemptions: Number(form.elements.limit.value),
                    p_expires_at: expiresAt,
                    p_is_active: true
                });
                if (error) throw error;
                status("Promo code saved.", "success");
                await refreshPromos();
            } catch (error) {
                status(error.message || "Could not save this promo code.", "error");
            } finally {
                button.disabled = false;
            }
        });

        await refreshUsers("");
        await refreshPromos();
    });
}());
