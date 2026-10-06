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
        openPlans(featureName);
    }

    async function openPlans(featureName) {
        const { modal, dialog, close } = createModal();
        const title = make("h2", "", "A-Zpace Pro");
        const description = make("p", "", featureName
            ? (entitlements.proFeatureLabels[featureName] || "This feature") + " is part of A-Zpace Pro."
            : "Compare what is included in each plan.");
        const grid = make("div", "azpace-plan-grid");
        const free = make("article", "azpace-plan-card");
        const freeTitle = make("h3", "", "Free");
        const freePrice = make("div", "azpace-plan-price", "Free");
        const freeText = make("p", "", "All current workspace essentials.");
        const freeList = make("ul", "azpace-feature-list");
        [
            "Writer, Sheets, Slides, PDF and Notes",
            "Everyday editing and account sync",
            "Current import and export basics"
        ].forEach(item => freeList.append(make("li", "", item)));
        free.append(freeTitle, freePrice, freeText, freeList);

        const pro = make("article", "azpace-plan-card featured");
        const proTitle = make("h3", "", "A-Zpace Pro");
        const proPrice = make("div", "azpace-plan-price", "Monthly and yearly plans");
        const monthlyPrice = make("p", "azpace-monthly-price", "Monthly: price coming soon");
        const yearlyPrice = make("p", "azpace-yearly-price", "Yearly: price coming soon");
        const proText = make("p", "", "Advanced tools across your workspace.");
        const proList = make("ul", "azpace-feature-list");
        Object.values(entitlements.proFeatureLabels).forEach(item => {
            proList.append(make("li", "", item));
        });
        pro.append(proTitle, proPrice, monthlyPrice, yearlyPrice, proText, proList);
        grid.append(free, pro);

        const note = make("p", "azpace-account-muted",
            "The private beta is free. Paid monthly and yearly checkout is not configured yet; you will not be charged.");
        if (featureName) {
            note.textContent = "This feature requires Pro. The private beta is free and paid checkout is not configured yet.";
        }

        const actions = make("div", "azpace-dialog-actions");
        const later = make("button", "", "Maybe later");
        later.type = "button";
        later.addEventListener("click", close);
        actions.append(later);
        dialog.replaceChildren(title, description, grid, note, actions);
        modal.hidden = false;
        later.focus();
        try {
            const { data, error } = await auth.client
                .from("subscription_plans")
                .select("plan_key,display_name,amount_minor_units,currency,is_available")
                .eq("is_available", true);
            if (error) throw error;
            if (data && data.length) {
                const prices = new Map(data.map(plan => {
                    const amount = (plan.amount_minor_units / 100).toFixed(2);
                    return [plan.plan_key, plan.currency + " " + amount + " / " +
                        (plan.plan_key === "monthly" ? "month" : "year")];
                }));
                if (prices.has("monthly")) monthlyPrice.textContent = "Monthly: " + prices.get("monthly");
                if (prices.has("yearly")) yearlyPrice.textContent = "Yearly: " + prices.get("yearly");
                if (prices.size) {
                    note.textContent = "Pricing shown is informational. Secure checkout is not connected; no payment will be taken.";
                }
            }
        } catch (error) {
            console.error("Could not load published plan pricing:", error);
            note.textContent = "Plan pricing is temporarily unavailable. No payment will be taken.";
        }
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
    let referralCard;

    async function refreshReferral() {
        if (!referralCard) return;
        try {
            const summary = await entitlements.getReferralSummary();
            const referralUrl = new URL("login.html", location.href);
            referralUrl.searchParams.set("ref", summary.code);
            referralCard.querySelector(".azpace-referral-code").textContent = summary.code;
            referralCard.querySelector(".azpace-referral-link").value = referralUrl.href;
            const progress = summary.verified_referrals % 15;
            const towardNext = summary.verified_referrals > 0 && progress === 0 ? 15 : progress;
            referralCard.querySelector(".azpace-referral-progress").textContent =
                summary.verified_referrals + " verified signup(s) · " + towardNext +
                "/15 toward your next free Pro month.";
            referralCard.querySelector(".azpace-referral-earned").textContent =
                summary.months_earned + " free 30-day Pro month(s) earned.";
            const bar = referralCard.querySelector("progress");
            bar.value = towardNext;
            bar.max = 15;
        } catch (error) {
            status(statusNode, error.message || "Could not load your referral code.", "error");
        }
    }

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
            await refreshReferral();
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

        const upgrade = make("button", "primary azpace-upgrade-button", "View Free and Pro plans");
        upgrade.type = "button";
        upgrade.addEventListener("click", () => openPaywall());
        referralCard = make("section", "azpace-referral-card");
        const referralTitle = make("strong", "", "Invite friends · earn free Pro");
        const referralHelp = make("span", "azpace-account-muted",
            "Earn 30 days of Pro for every 15 new users who verify their email.");
        const referralCode = make("span", "azpace-referral-code", "Loading your code…");
        const referralLink = make("input", "azpace-referral-link");
        referralLink.readOnly = true;
        referralLink.setAttribute("aria-label", "Your referral link");
        const referralActions = make("div", "azpace-account-promo");
        const copyReferral = make("button", "", "Copy invite link");
        copyReferral.type = "button";
        copyReferral.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(referralLink.value);
                status(statusNode, "Referral link copied.", "success");
            } catch (error) {
                referralLink.focus();
                referralLink.select();
                status(statusNode, "Clipboard unavailable. Copy the selected link.", "error");
            }
        });
        const referralProgress = make("span", "azpace-account-muted azpace-referral-progress");
        const referralBar = make("progress");
        referralBar.max = 15;
        referralBar.value = 0;
        const referralEarned = make("span", "azpace-account-muted azpace-referral-earned");
        referralActions.append(copyReferral);
        referralCard.append(
            referralTitle,
            referralHelp,
            referralCode,
            referralLink,
            referralActions,
            referralProgress,
            referralBar,
            referralEarned
        );
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
        actions.append(upgrade, referralCard, promoForm, migrate, admin, logout);
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
        guardMarkedControls();
    }

    function guardMarkedControls() {
        document.querySelectorAll("[data-azpace-pro]").forEach(element => {
            const featureName = element.dataset.azpacePro;
            if (element.dataset.azpaceProGuarded === "true") return;
            element.dataset.azpaceProGuarded = "true";
            try {
                window.AZpacePaywall.decorate(element, featureName);
            } catch (error) {
                console.error("Could not protect Pro feature:", featureName, error);
                element.disabled = true;
            }
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
            if (!entitlements.proFeatureLabels[featureName]) {
                throw new Error("Unknown Pro feature: " + featureName);
            }
            element.classList.add("azpace-pro-control");
            const badge = make("span", "azpace-pro-badge", "PRO");
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
