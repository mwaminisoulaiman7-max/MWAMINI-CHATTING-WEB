// ========================================================
// SUPABASE NATIVE AUTHENTICATION GATEWAY
// ========================================================

let isLoginMode = false;

export function initAuthGateway() {
    const submitBtn = document.getElementById("auth-submit-btn");
    const switchLink = document.getElementById("auth-switch-link");
    const nameGroup = document.getElementById("name-group");
    const switchText = document.getElementById("auth-switch-text");
    const errorDisplay = document.getElementById("error-message");
    const guestBtn = document.getElementById("guest-login-btn");

    if (!submitBtn) return;

    // --- INTERFACE MODE VIEW TOGGLE SWITCH ---
    switchLink.addEventListener("click", () => {
        isLoginMode = !isLoginMode;
        errorDisplay.innerText = "";
        
        if (isLoginMode) {
            submitBtn.innerText = "Login";
            switchLink.innerText = "Register here";
            switchText.innerText = "Don't have an account?";
            nameGroup.style.display = "none";
        } else {
            submitBtn.innerText = "Register";
            switchLink.innerText = "Login here";
            switchText.innerText = "Already have an account?";
            nameGroup.style.display = "block";
        }
    });

    // --- FORM TRANSACTION HANDLING ROUTINE ---
    submitBtn.addEventListener("click", async () => {
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value.trim();
        const name = document.getElementById("auth-name")?.value.trim();

        errorDisplay.innerText = "";

        if (!email || !password || (!isLoginMode && !name)) {
            errorDisplay.innerText = "Please complete all fields correctly.";
            return;
        }

        try {
            if (isLoginMode) {
                // 1. Supabase Sign-In
                const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;

                const { data: userProfile } = await window.supabase
                    .from("users")
                    .select("name, account_mode")
                    .eq("uid", data.user.id)
                    .single();

                const sessionName = userProfile ? userProfile.name : email.split("@")[0];
                const sessionMode = userProfile ? userProfile.account_mode : "standard";

                saveSessionAndProceed(data.user.id, sessionName, sessionMode);
            } else {
                // 2. Supabase Registration
                const { data, error } = await window.supabase.auth.signUp({ email, password });
                if (error) throw error;

                // Provision new user profile in public.users table
                await window.supabase.from("users").insert([{
                    uid: data.user.id,
                    name: name,
                    email: email,
                    status_text: "Hey there! I am using Mwamini Chat.",
                    account_mode: "standard",
                    is_online: true
                }]);

                saveSessionAndProceed(data.user.id, name, "standard");
            }
        } catch (err) {
            errorDisplay.innerText = err.message;
        }
    });

    // --- GUEST AUTHENTICATION ACTION LINK ROUTINE ---
    guestBtn.addEventListener("click", async () => {
        try {
            errorDisplay.innerText = "";
            const { data, error } = await window.supabase.auth.signInAnonymously();
            if (error) throw error;
            
            const uniqueTailId = data.user.id.substring(0, 5).toUpperCase();
            const guestUserTag = `GUEST_${uniqueTailId}`;
            
            await window.supabase.from("users").insert([{
                uid: data.user.id,
                name: guestUserTag,
                email: `guest_${Date.now()}@mwamini.local`,
                status_text: "Browsing chat updates via temporary guest channel access.",
                account_mode: "guest",
                is_online: true
            }]);

            saveSessionAndProceed(data.user.id, guestUserTag, "guest");
        } catch (err) {
            errorDisplay.innerText = "Guest login system failure: " + err.message;
        }
    });
}

function saveSessionAndProceed(uid, name, mode) {
    localStorage.setItem("session_uid", uid);
    localStorage.setItem("session_name", name);
    localStorage.setItem("session_account_mode", mode);
    window.location.href = "dashboard.html";
}
