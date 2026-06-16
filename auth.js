import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBtDMYBR0jcyK-JfgsYtET1SenPngzmQi4",
  authDomain: "mwamini-chatting-web.firebaseapp.com",
  projectId: "mwamini-chatting-web",
  storageBucket: "mwamini-chatting-web.firebasestorage.app",
  messagingSenderId: "640958885512",
  appId: "1:640958885512:web:2f9a636acc85534009b93d",
  measurementId: "G-SW9FBXX78G"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

let isLoginMode = false; // Registration layout state serves as default structural baseline

export function initAuthGateway() {
    const submitBtn = document.getElementById("auth-submit-btn");
    const switchLink = document.getElementById("auth-switch-link");
    const nameGroup = document.getElementById("name-group");
    const switchText = document.getElementById("auth-switch-text");
    const errorDisplay = document.getElementById("error-message");
    const guestBtn = document.getElementById("guest-login-btn");

    if (!submitBtn) return; // Prevent breakdown on secondary dashboard screens

    // --- INTERFACE MODE VIEW TOGGLE SWITCH ---
    switchLink.addEventListener("click", () => {
        isLoginMode = !isLoginMode;
        errorDisplay.innerText = "";
        
        if (isLoginMode) {
            submitBtn.innerText = "Login";
            switchLink.innerText = "Register here";
            switchText.innerText = "Don't have an account?";
            nameGroup.style.display = "none"; // Hide name field during direct Login sequences
        } else {
            submitBtn.innerText = "Register";
            switchLink.innerText = "Login here";
            switchText.innerText = "Already have an account?";
            nameGroup.style.display = "block"; // Re-expose name entry during signup sequences
        }
    });

    // --- FORM TRANSACTION HANDLING ROUTINE ---
    submitBtn.addEventListener("click", async () => {
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-password").value.trim();
        const name = document.getElementById("auth-name").value.trim();

        errorDisplay.innerText = "";

        if (!email || !password || (!isLoginMode && !name)) {
            errorDisplay.innerText = "Please complete all fields correctly.";
            return;
        }

        try {
            if (isLoginMode) {
                // 1. Fire Standard Authentication Sign-In Process
                const credential = await signInWithEmailAndPassword(auth, email, password);
                
                const userSnap = await getDoc(doc(db, "users", credential.user.uid));
                let sessionName = email.split("@")[0];
                let sessionMode = "standard";

                if (userSnap.exists()) {
                    sessionName = userSnap.data().name;
                    sessionMode = userSnap.data().accountMode || "standard";
                }

                saveSessionAndProceed(credential.user.uid, sessionName, sessionMode);
            } else {
                // 2. Fire New Account Registration Process
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                
                const profilePayload = {
                    uid: credential.user.uid,
                    name: name,
                    email: email,
                    status: "Hey there! I am using Mwamini Chat.",
                    accountMode: "standard",
                    isOnline: true,
                    avatarUrl: "",
                    createdAt: serverTimestamp()
                };

                await setDoc(doc(db, "users", credential.user.uid), profilePayload);
                saveSessionAndProceed(credential.user.uid, name, "standard");
            }
        } catch (err) {
            errorDisplay.innerText = err.message.replace("Firebase: ", "");
        }
    });

    // --- GUEST AUTHENTICATION ACTION LINK ROUTINE ---
    guestBtn.addEventListener("click", async () => {
        try {
            errorDisplay.innerText = "";
            const credential = await signInAnonymously(auth);
            
            const uniqueTailId = credential.user.uid.substring(0, 5).toUpperCase();
            const guestUserTag = `GUEST_${uniqueTailId}`;
            
            const guestPayload = {
                uid: credential.user.uid,
                name: guestUserTag,
                email: "guest@mwamini.local",
                status: "Browsing chat updates via temporary guest channel access.",
                accountMode: "standard",
                isOnline: true,
                avatarUrl: "",
                createdAt: serverTimestamp()
            };

            await setDoc(doc(db, "users", credential.user.uid), guestPayload);
            saveSessionAndProceed(credential.user.uid, guestUserTag, "standard");
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