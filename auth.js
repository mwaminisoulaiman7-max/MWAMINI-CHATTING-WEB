import { supabase } from './config.js';

let isLoginMode = false;

// UI Elements
const form = document.getElementById("auth-form-fields");
const submitBtn = document.getElementById("auth-submit-btn");
const switchLink = document.getElementById("auth-switch-link");
const nameGroup = document.getElementById("name-group");
const switchText = document.getElementById("auth-switch-text");
const errorDisplay = document.getElementById("error-message");
const guestBtn = document.getElementById("guest-login-btn");
const forgotPasswordContainer = document.getElementById("forgot-password-container");

// Prevent logged-in users from seeing the auth page
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) window.location.href = "dashboard.html";
});

switchLink.addEventListener("click", () => {
    isLoginMode = !isLoginMode;
    errorDisplay.textContent = "";
    
    if (isLoginMode) {
        submitBtn.textContent = "Login";
        switchLink.textContent = "Register here";
        switchText.textContent = "Don't have an account?";
        nameGroup.classList.add("hidden");
        forgotPasswordContainer.classList.remove("hidden");
        document.getElementById("auth-name").removeAttribute("required");
    } else {
        submitBtn.textContent = "Register";
        switchLink.textContent = "Login here";
        switchText.textContent = "Already have an account?";
        nameGroup.classList.remove("hidden");
        forgotPasswordContainer.classList.add("hidden");
        document.getElementById("auth-name").setAttribute("required", "true");
    }
});

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value.trim();
    const name = document.getElementById("auth-name").value.trim();

    errorDisplay.textContent = "Authenticating...";
    errorDisplay.style.color = "#005c4b";

    try {
        if (isLoginMode) {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            window.location.href = "dashboard.html";
        } else {
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;

            if (data.user) {
                // Provision profile safely
                const { error: profileError } = await supabase.from("profiles").insert([{
                    id: data.user.id,
                    name: name,
                    email: email
                }]);
                if (profileError) throw profileError;
                
                errorDisplay.textContent = "Registration successful! Please check your email to verify (if required) or log in.";
            }
        }
    } catch (err) {
        errorDisplay.textContent = err.message;
        errorDisplay.style.color = "#ea0038";
    }
});

guestBtn.addEventListener("click", async () => {
    try {
        errorDisplay.textContent = "Connecting as guest...";
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;

        if (data.user) {
            const guestTag = "GUEST_" + data.user.id.substring(0, 5).toUpperCase();
            await supabase.from("profiles").insert([{
                id: data.user.id,
                name: guestTag,
                email: "guest@mwamini.local",
                account_mode: "guest"
            }]);
            window.location.href = "dashboard.html";
        }
    } catch (err) {
        errorDisplay.textContent = "Guest failure: " + err.message;
        errorDisplay.style.color = "#ea0038";
    }
});
