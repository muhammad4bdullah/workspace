(function () {
    "use strict";

    const auth = window.AZpaceAuth;

    function message(text, kind) {
        const node = document.getElementById("login-message");
        node.textContent = text || "";
        node.dataset.kind = kind || "";
    }

    function showMode(mode) {
        document.querySelectorAll("[data-auth-form]").forEach(form => {
            form.hidden = form.dataset.authForm !== mode;
        });
        document.querySelectorAll("[data-auth-show]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.authShow === mode));
        });
        message("", "");
    }

    function nextPage() {
        return auth.safeNext();
    }

    document.addEventListener("DOMContentLoaded", async () => {
        const params = new URLSearchParams(location.search);
        const error = params.get("error");
        if (error) message(error, "error");
        const recovery = params.get("mode") === "recovery" ||
            window.location.hash.includes("type=recovery");
        showMode(recovery ? "recovery" : "login");
        if (recovery) {
            document.getElementById("login-description").textContent =
                "Choose a new password for your A-Zpace account.";
        }

        document.querySelectorAll("[data-auth-show]").forEach(button => {
            button.addEventListener("click", () => showMode(button.dataset.authShow));
        });

        const loginForm = document.getElementById("login-form");
        loginForm.addEventListener("submit", async event => {
            event.preventDefault();
            const button = loginForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const { error: loginError } = await auth.client.auth.signInWithPassword({
                    email: loginForm.elements.email.value.trim(),
                    password: loginForm.elements.password.value
                });
                if (loginError) throw loginError;
                location.replace(nextPage());
            } catch (loginError) {
                message(loginError.message || "Could not sign in.", "error");
            } finally {
                button.disabled = false;
            }
        });

        const signupForm = document.getElementById("signup-form");
        signupForm.addEventListener("submit", async event => {
            event.preventDefault();
            const button = signupForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const { data, error: signupError } = await auth.client.auth.signUp({
                    email: signupForm.elements.email.value.trim(),
                    password: signupForm.elements.password.value,
                    options: {
                        data: { display_name: signupForm.elements.display_name.value.trim() },
                        emailRedirectTo: new URL("login.html", location.href).href
                    }
                });
                if (signupError) throw signupError;
                if (data.session) location.replace(nextPage());
                else message("Check your email to confirm your account, then sign in.", "success");
            } catch (signupError) {
                message(signupError.message || "Could not create your account.", "error");
            } finally {
                button.disabled = false;
            }
        });

        const resetForm = document.getElementById("reset-form");
        resetForm.addEventListener("submit", async event => {
            event.preventDefault();
            const button = resetForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const redirectTo = new URL("login.html?mode=recovery", location.href).href;
                const { error: resetError } = await auth.client.auth.resetPasswordForEmail(
                    resetForm.elements.email.value.trim(),
                    { redirectTo }
                );
                if (resetError) throw resetError;
                message("If an account exists for that address, a password reset link has been sent.", "success");
            } catch (resetError) {
                message(resetError.message || "Could not send the reset email.", "error");
            } finally {
                button.disabled = false;
            }
        });

        const recoveryForm = document.getElementById("recovery-form");
        recoveryForm.addEventListener("submit", async event => {
            event.preventDefault();
            const button = recoveryForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const password = recoveryForm.elements.password.value;
                if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
                const { error: updateError } = await auth.client.auth.updateUser({ password });
                if (updateError) throw updateError;
                showMode("login");
                message("Password updated. You can now sign in.", "success");
            } catch (updateError) {
                message(updateError.message || "Could not update your password.", "error");
            } finally {
                button.disabled = false;
            }
        });

        await auth.ready;
        if (auth.error) message(auth.error.message, "error");
        if (params.has("error") && auth.user) {
            document.querySelectorAll("form button").forEach(button => { button.disabled = true; });
            document.getElementById("auth-error-actions").hidden = false;
            document.getElementById("retry-workspace").addEventListener("click", () => {
                location.replace(nextPage());
            });
            document.getElementById("error-signout").addEventListener("click", async event => {
                event.currentTarget.disabled = true;
                try {
                    await auth.logout();
                } catch (logoutError) {
                    message(logoutError.message || "Could not log out.", "error");
                    event.currentTarget.disabled = false;
                }
            });
            message("The signed-in account could not open the workspace: " + params.get("error"), "error");
        }
        if (!window.supabase || !auth.client) {
            document.querySelectorAll("form button").forEach(button => { button.disabled = true; });
            return;
        }
        if (recovery) {
            const { data } = await auth.client.auth.getSession();
            if (!data.session) {
                message("This password reset link is invalid or has expired. Request a new link.", "error");
            }
        }
    });
}());
