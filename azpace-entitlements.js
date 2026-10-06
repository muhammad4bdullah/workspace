(function () {
    "use strict";

    const auth = window.AZpaceAuth;
    const proFeatureLabels = Object.freeze({
        writer_running_headers: "Writer headers",
        writer_running_footers: "Writer footers",
        writer_page_numbers: "Writer page numbers",
        pdf_merge: "PDF merge",
        pdf_signature: "PDF signatures",
        sheets_xlsx_export: "Excel workbook export",
        slides_pptx_export: "PowerPoint export",
        slides_png_export: "Slide image export"
    });

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

    async function getReferralSummary() {
        await auth.ready;
        if (!auth.user) throw new Error("Sign in to view referral details.");
        const { data, error } = await auth.client.rpc("my_referral_summary");
        if (error) throw error;
        return data;
    }

    window.AZpaceEntitlements = {
        hasProAccess,
        isFeatureAvailable,
        isAdmin,
        redeemPromoCode,
        getReferralSummary,
        proFeatureLabels
    };
    window.hasProAccess = hasProAccess;
    window.isFeatureAvailable = isFeatureAvailable;
}());
