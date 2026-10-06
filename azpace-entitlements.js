(function () {
    "use strict";

    const auth = window.AZpaceAuth;

    async function hasProAccess() {
        await auth.ready;
        if (!auth.user) return false;
        const { data, error } = await auth.client.rpc("has_pro_access");
        if (error) throw error;
        return Boolean(data);
    }

    async function isFeatureAvailable(featureName) {
        await auth.ready;
        if (!auth.user) return false;
        const { data, error } = await auth.client.rpc("is_feature_available", {
            p_feature_name: String(featureName)
        });
        if (error) throw error;
        return Boolean(data);
    }

    async function isAdmin() {
        await auth.ready;
        if (!auth.user) return false;
        const { data, error } = await auth.client.rpc("is_admin");
        if (error) throw error;
        return Boolean(data);
    }

    async function redeemPromoCode(code) {
        await auth.ready;
        if (!auth.user) throw new Error("Sign in to redeem a promo code.");
        const { error } = await auth.client.rpc("redeem_promo_code", {
            p_code: String(code || "").trim()
        });
        if (error) throw error;
        return auth.getAccount();
    }

    window.AZpaceEntitlements = {
        hasProAccess,
        isFeatureAvailable,
        isAdmin,
        redeemPromoCode
    };
    window.hasProAccess = hasProAccess;
    window.isFeatureAvailable = isFeatureAvailable;
}());
