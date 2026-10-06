(function () {
    "use strict";

    const auth = window.AZpaceAuth;
    const entitlements = window.AZpaceEntitlements;
    const replayingClicks = new WeakSet();
    const date = value => value
        ? new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric"
        })
        : "No expiration set";
    const sourceLabel = value => value
        ? value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase())
        : "";

    function make(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function status(node, message, kind) {
        node.textContent = message || "";
        node.dataset.kind = kind || "";
    }

    function createModal() {
        const modal = make("div", "azpace-modal");
        modal.hidden = true;
        modal.setAttribute("role", "presentation");
        const dialog = make("section", "azpace-auth-dialog");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        modal.append(dialog);
        const close = () => {
            modal.remove();
            document.removeEventListener("keydown", onKeyDown);
        };
        modal.addEventListener("click", event => {
            if (event.target === modal) close();
        });
        const onKeyDown = event => {
            if (event.key === "Escape") close();
        };
        document.addEventListener("keydown", onKeyDown);
        document.body.append(modal);
        return { modal, dialog, close };
    }

    function openPaywall(featureName) {
        const { modal, dialog, close } = createModal();
        const title = make("h2", "", "A-Zpace Pro");
        const description = make("p", "", "Unlock advanced workspace features and tools.");
        if (featureName) {
            description.textContent += " This feature requires Pro.";
        }
        const actions = make("div", "azpace-dialog-actions");
        const upgrade = make("button", "primary", "Paid plans coming soon");
        const later = make("button", "", "Maybe later");
        upgrade.type = "button";
        upgrade.disabled = true;
        later.type = "button";
        later.addEventListener("click", close);
        actions.append(upgrade, later);
        dialog.replaceChildren(title, description, actions);
        modal.hidden = false;
        later.focus();
    }

    function addAccountSettings(menu) {
        const button = make("button", "", "Account Settings");
        button.type = "button";
        button.addEventListener("click", () => {
            menu.hidden = true;
            openSettings();
        });
        menu.querySelector(".azpace-account-actions").prepend(button);
    }

    function openSettings() {
        const { modal, dialog, close: closeModal } = createModal();
        const title = make("h2", "", "Account Settings");
        const form = make("form");
        const nameLabel = make("label", "", "Display name");
        const name = make("input");
        name.name = "display_name";
        name.maxLength = 80;
        name.autocomplete = "name";
        name.value = auth.profile.display_name || "";
        nameLabel.append(name);

        const passwordLabel = make("label", "", "New password (optional)");
        const password = make("input");
        password.type = "password";
        password.name = "password";
        password.autocomplete = "new-password";
        password.minLength = 8;
        passwordLabel.append(password);
        const note = make("p", "azpace-account-muted", auth.profile.email);
        const message = make("div", "azpace-account-notice");
        const actions = make("div", "azpace-dialog-actions");
        const save = make("button", "primary", "Save changes");
        const closeButton = make("button", "", "Cancel");
        save.type = "submit";
        closeButton.type = "button";
        closeButton.addEventListener("click", closeModal);
        actions.append(save, closeButton);

        form.append(nameLabel, passwordLabel, message, actions);
        form.addEventListener("submit", async event => {
            event.preventDefault();
            save.disabled = true;
            try {
                await auth.updateProfile({ display_name: name.value });
                if (password.value) {
                    if (password.value.length < 8) throw new Error("Use a password with at least 8 characters.");
                    const { error } = await auth.client.auth.updateUser({ password: password.value });
                    if (error) throw error;
                }
                password.value = "";
                status(message, "Account settings saved.", "success");
                refreshMenu();
            } catch (error) {
                status(message, error.message || "Could not update account settings.", "error");
            } finally {
                save.disabled = false;
            }
        });
        dialog.replaceChildren(title, note, form);
        modal.hidden = false;
        name.focus();
    }

    let menuNode;
    let statusNode;

    async function refreshMenu() {
        if (!menuNode) return;
        try {
            const account = await auth.getAccount();
            const profile = account.profile;
            const heading = menuNode.querySelector(".azpace-account-plan");
            heading.textContent = account.hasPro ? "✨ A-Zpace Pro" : "A-Zpace Free";
            const expiry = menuNode.querySelector(".azpace-account-expiry");
            expiry.textContent = account.hasPro
                ? "Active until: " + date(profile.pro_expires_at)
                : profile.pro_expires_at && new Date(profile.pro_expires_at) <= new Date()
                    ? "Pro access ended on " + date(profile.pro_expires_at)
                    : profile.pro_source
                        ? "Previous Pro source: " + sourceLabel(profile.pro_source)
                        : "Private beta · paid plans coming soon";
            const source = menuNode.querySelector(".azpace-account-source");
            source.textContent = account.hasPro && profile.pro_source
                ? "Granted through " + sourceLabel(profile.pro_source)
                : "";
            const email = menuNode.querySelector(".azpace-account-email");
            email.textContent = profile.email;
            const name = menuNode.querySelector(".azpace-account-display");
            name.textContent = profile.display_name || "";
            const upgrade = menuNode.querySelector(".azpace-upgrade-button");
            upgrade.hidden = account.hasPro;
        } catch (error) {
            status(statusNode, error.message || "Could not load account details.", "error");
        }
    }

    function createMenu() {
        if (!auth.user || document.querySelector(".azpace-account-trigger")) return;

        const trigger = make("button", "azpace-auth-control azpace-account-trigger");
        trigger.type = "button";
        trigger.setAttribute("aria-expanded", "false");
        trigger.setAttribute("aria-label", "Your A-Zpace account");
        const initials = make("strong", "", "AZ");
        const beta = make("span", "azpace-beta-tag", "PRIVATE BETA");
        trigger.append(initials, beta);

        menuNode = make("section", "azpace-auth-control azpace-account-menu");
        menuNode.hidden = true;
        menuNode.setAttribute("aria-label", "Your account");
        const title = make("h2", "", "Your Account");
        const name = make("div", "azpace-account-display");
        const email = make("div", "azpace-account-email");
        const plan = make("div", "azpace-account-plan");
        const expiry = make("div", "azpace-account-muted azpace-account-expiry");
        const source = make("div", "azpace-account-muted azpace-account-source");
        const actions = make("div", "azpace-account-actions");
        actions.className = "azpace-account-actions";

        const upgrade = make("button", "primary azpace-upgrade-button", "Upgrade to Pro");
        upgrade.type = "button";
        upgrade.addEventListener("click", () => openPaywall());
        const promoForm = make("form", "azpace-account-promo");
        const promoInput = make("input");
        promoInput.name = "promo_code";
        promoInput.placeholder = "Promo code";
        promoInput.setAttribute("aria-label", "Promo code");
        promoInput.maxLength = 64;
        const redeem = make("button", "", "Redeem");
        redeem.type = "submit";
        promoForm.append(promoInput, redeem);
        promoForm.addEventListener("submit", async event => {
            event.preventDefault();
            redeem.disabled = true;
            try {
                await entitlements.redeemPromoCode(promoInput.value);
                promoInput.value = "";
                status(statusNode, "Promo code applied to your account.", "success");
                await refreshMenu();
            } catch (error) {
                status(statusNode, error.message || "Could not redeem that promo code.", "error");
            } finally {
                redeem.disabled = false;
            }
        });

        const migrate = make("button", "", "Import device data to this account");
        migrate.type = "button";
        migrate.hidden = !auth.legacyDataAvailable;
        migrate.addEventListener("click", async () => {
            if (!confirm("Upload " + auth.legacyDataCount + " device-stored item(s) to this account? Items with matching names in the cloud will be replaced.")) return;
            migrate.disabled = true;
            try {
                await auth.migrateDeviceData();
            } catch (error) {
                status(statusNode, error.message || "Could not import device data.", "error");
                migrate.disabled = false;
            }
        });

        const admin = make("button", "", "Admin Console");
        admin.type = "button";
        admin.hidden = true;
        admin.addEventListener("click", () => { location.href = "admin.html"; });

        const logout = make("button", "danger", "Logout");
        logout.type = "button";
        logout.addEventListener("click", async () => {
            logout.disabled = true;
            try {
                await auth.logout();
            } catch (error) {
                status(statusNode, error.message || "Could not log out.", "error");
                logout.disabled = false;
            }
        });

        statusNode = make("div", "azpace-account-notice");
        statusNode.id = "azpace-auth-status";
        actions.append(upgrade, promoForm, migrate, admin, logout);
        menuNode.append(title, name, email, plan, expiry, source, statusNode, actions);

        trigger.addEventListener("click", async () => {
            menuNode.hidden = !menuNode.hidden;
            trigger.setAttribute("aria-expanded", String(!menuNode.hidden));
            if (!menuNode.hidden) await refreshMenu();
        });
        document.addEventListener("click", event => {
            if (!menuNode.contains(event.target) && !trigger.contains(event.target)) {
                menuNode.hidden = true;
                trigger.setAttribute("aria-expanded", "false");
            }
        });

        document.body.append(trigger, menuNode);
        addAccountSettings(menuNode);
        refreshMenu();
        entitlements.isAdmin().then(isAdmin => {
            admin.hidden = !isAdmin;
        }).catch(error => {
            console.error("Could not verify administrator access:", error);
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        if (location.pathname.split("/").pop() === "login.html") return;
        const session = await auth.ready;
        if (session) createMenu();
    });

    window.AZpacePaywall = {
        open: openPaywall,
        async require(featureName) {
            if (await entitlements.isFeatureAvailable(featureName)) return true;
            openPaywall(featureName);
            return false;
        },
        decorate(element, featureName) {
            if (!(element instanceof Element)) {
                throw new TypeError("Pass a DOM element to decorate a Pro feature.");
            }
            const badge = make("span", "azpace-beta-tag", "PRO");
            badge.setAttribute("aria-label", "A-Zpace Pro feature");
            element.append(badge);
            element.addEventListener("click", async event => {
                if (replayingClicks.has(element)) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                try {
                    if (!await entitlements.isFeatureAvailable(featureName)) {
                        openPaywall(featureName);
                        return;
                    }
                    replayingClicks.add(element);
                    element.click();
                    replayingClicks.delete(element);
                } catch (error) {
                    replayingClicks.delete(element);
                    console.error("Could not verify Pro access:", error);
                    if (statusNode) {
                        status(statusNode, "Could not verify Pro access. Please retry when online.", "error");
                    }
                }
            }, true);
            return element;
        }
    };
}());
