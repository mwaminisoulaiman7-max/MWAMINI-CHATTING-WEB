import { supabase } from './config.js';

let currentUser = null; 
let activeTargetId = null; // Can be a Room ID or User ID
let isTargetRoom = false;
let messageSubscriptionChannel = null;
let presenceChannel = null;
const onlineUsers = new Set();

let audioMediaRecorder = null;
let recordedAudioChunks = [];

async function initDashboardPage() {
    // 1. Authenticate Securely
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = "index.html";
        return; 
    }

    const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (!profile) return;
    
    currentUser = profile;
    document.getElementById("current-user-title").textContent = currentUser.name;
    document.getElementById("my-status-display").textContent = currentUser.status_text;

    // 2. Setup Presence (replaces Postgres boolean pinging)
    setupPresence();

    // 3. UI Event Bindings
    bindGroupCreation();
    bindStatusUpdate();
    bindSearch();
    bindMessaging();
    bindVoiceRecording();
    
    document.getElementById("logout-btn").addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "index.html";
    });

    // Initial Load
    executeTargetSearchQuery(""); 
}

function setupPresence() {
    presenceChannel = supabase.channel('global-presence', {
        config: { presence: { key: currentUser.id } }
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            onlineUsers.clear();
            for (const id in state) {
                onlineUsers.add(state[id][0].user_id);
            }
            updateSidebarPresenceUI();
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ user_id: currentUser.id, status: currentUser.status_text });
            }
        });
}

function updateSidebarPresenceUI() {
    document.querySelectorAll('.wa-user-item').forEach(el => {
        const uid = el.dataset.uid;
        if (!uid || el.dataset.isRoom === "true") return;
        
        const dot = el.querySelector('.presence-dot');
        if (dot) {
            if (onlineUsers.has(uid)) {
                dot.classList.replace('badge-offline', 'badge-online');
            } else {
                dot.classList.replace('badge-online', 'badge-offline');
            }
        }
    });
}

function bindGroupCreation() {
    const typeSelect = document.getElementById("group-type-select");
    const passwordField = document.getElementById("group-password-input");
    
    typeSelect.addEventListener("change", (e) => {
        if (e.target.value === "protected") passwordField.classList.remove("hidden");
        else passwordField.classList.add("hidden");
    });

    document.getElementById("create-group-btn").addEventListener("click", async () => {
        const title = document.getElementById("group-name-input").value.trim();
        const type = typeSelect.value;
        const pass = passwordField.value.trim();

        if (!title) return alert("Please declare a room name.");
        
        try {
            await supabase.from("rooms").insert([{
                name: title,
                group_type: type,
                passcode: pass,
                created_by: currentUser.id
            }]);
            
            document.getElementById("group-name-input").value = "";
            passwordField.value = "";
            executeTargetSearchQuery(""); 
        } catch (err) {
            alert("Room composition failure: " + err.message);
        }
    });
}

function bindStatusUpdate() {
    document.getElementById("update-status-btn").addEventListener("click", async () => {
        const status = document.getElementById("status-input").value.trim();
        if (!status) return;
        
        await supabase.from("profiles").update({ status_text: status }).eq("id", currentUser.id);
        document.getElementById("my-status-display").textContent = status;
        document.getElementById("status-input").value = "";
        
        if (presenceChannel) {
            await presenceChannel.track({ user_id: currentUser.id, status: status });
        }
    });
}

function bindSearch() {
    document.getElementById("search-users").addEventListener("input", (e) => {
        executeTargetSearchQuery(e.target.value.trim());
    });
}

async function executeTargetSearchQuery(keyword) {
    const canvas = document.getElementById("users-container");
    canvas.innerHTML = "";

    // 1. Fetch Rooms
    let roomQuery = supabase.from("rooms").select("*");
    if (keyword) roomQuery = roomQuery.ilike("name", `%${keyword}%`);
    const { data: rooms } = await roomQuery;

    rooms?.forEach(room => buildSidebarItem(room, true));

    // 2. Fetch Users
    let userQuery = supabase.from("profiles").select("*").neq("id", currentUser.id);
    if (keyword) userQuery = userQuery.ilike("name", `%${keyword}%`);
    const { data: users } = await userQuery;

    users?.forEach(user => buildSidebarItem(user, false));
    updateSidebarPresenceUI();
}

function buildSidebarItem(data, isRoom) {
    const canvas = document.getElementById("users-container");
    const row = document.createElement("div");
    row.className = "wa-user-item";
    row.dataset.uid = data.id;
    row.dataset.isRoom = isRoom;

    const avatarBox = document.createElement("div");
    avatarBox.className = "wa-avatar-container";
    
    const avatar = document.createElement("div");
    avatar.className = "wa-avatar";
    avatar.style.background = isRoom ? '#008069' : '#00a884';
    avatar.textContent = isRoom ? '👥' : data.name.charAt(0).toUpperCase();
    
    avatarBox.appendChild(avatar);

    if (!isRoom) {
        const dot = document.createElement("div");
        dot.className = "presence-dot badge-offline";
        avatarBox.appendChild(dot);
    }

    const infoBox = document.createElement("div");
    infoBox.className = "wa-user-info";

    const nameEl = document.createElement("h4");
    nameEl.textContent = data.name; // Secure text insertion

    const subEl = document.createElement("p");
    subEl.className = "wa-user-status-text";
    subEl.textContent = isRoom ? (data.group_type === "protected" ? "🔒 Protected" : "🌐 Public") : (data.status_text || 'Available');

    infoBox.appendChild(nameEl);
    infoBox.appendChild(subEl);
    row.appendChild(avatarBox);
    row.appendChild(infoBox);

    row.addEventListener("click", () => openChat(data.id, data.name, isRoom, data));
    canvas.appendChild(row);
}

function openChat(id, name, isRoom, fullData) {
    if (isRoom && fullData.group_type === "protected") {
        const pass = prompt(`Enter password to access "${name}":`);
        if (pass !== fullData.passcode) {
            alert("Authorization Denied.");
            return;
        }
    }

    activeTargetId = id;
    isTargetRoom = isRoom;

    document.getElementById("no-chat-selected").classList.add("hidden");
    document.getElementById("active-chat-area").classList.remove("hidden");
    document.getElementById("chat-header-name").textContent = name;
    document.getElementById("chat-header-group-meta").textContent = isRoom ? "CHANNEL" : "DIRECT MESSAGE";

    bindLiveMessageStream();
}

async function bindLiveMessageStream() {
    if (messageSubscriptionChannel) supabase.removeChannel(messageSubscriptionChannel);
    
    const chatBox = document.getElementById("message-stream");
    chatBox.innerHTML = "";

    // Load History
    let query = supabase.from("messages").select("*, profiles(name)").order("created_at", { ascending: true });
    
    if (isTargetRoom) {
        query = query.eq("room_id", activeTargetId);
    } else {
        // Complex OR clause for direct messaging
        query = query.or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${activeTargetId}),and(sender_id.eq.${activeTargetId},recipient_id.eq.${currentUser.id})`);
    }

    const { data } = await query;
    data?.forEach(renderMessage);

    // Live Subscribe
    let filterStr = isTargetRoom ? `room_id=eq.${activeTargetId}` : '';
    
    messageSubscriptionChannel = supabase
        .channel(`chat:${activeTargetId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: filterStr }, async (payload) => {
            const msg = payload.new;
            // Filter DMs client side if no strict pg filter
            if (!isTargetRoom && (msg.sender_id !== activeTargetId && msg.recipient_id !== activeTargetId)) return;
            
            const { data: sender } = await supabase.from('profiles').select('name').eq('id', msg.sender_id).single();
            msg.profiles = sender;
            renderMessage(msg);
        })
        .subscribe();
}

function renderMessage(data) {
    const chatBox = document.getElementById("message-stream");
    const isMe = data.sender_id === currentUser.id;
    
    const row = document.createElement("div");
    row.className = `wa-message-row ${isMe ? 'row-sent' : 'row-received'}`;
    
    const bubble = document.createElement("div");
    bubble.className = "wa-bubble";

    if (!isMe && isTargetRoom) {
        const senderLabel = document.createElement("div");
        senderLabel.style.fontWeight = "bold";
        senderLabel.style.color = "#008069";
        senderLabel.style.fontSize = "11px";
        senderLabel.style.marginBottom = "4px";
        senderLabel.textContent = data.profiles?.name || "Unknown";
        bubble.appendChild(senderLabel);
    }

    if (data.type === "audio") {
        const audio = document.createElement("audio");
        audio.src = data.file_url;
        audio.controls = true;
        bubble.appendChild(audio);
    } else {
        const textLabel = document.createElement("div");
        textLabel.className = "bubble-text";
        textLabel.textContent = data.text; // Native XSS Protection
        bubble.appendChild(textLabel);
    }

    row.appendChild(bubble);
    chatBox.appendChild(row);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function bindMessaging() {
    document.getElementById("message-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("message-input");
        const text = input.value.trim();
        if (!text || !activeTargetId) return;

        input.value = "";
        
        const payload = {
            sender_id: currentUser.id,
            text: text,
            type: "text"
        };
        
        if (isTargetRoom) payload.room_id = activeTargetId;
        else payload.recipient_id = activeTargetId;

        await supabase.from("messages").insert([payload]);
    });
}

function bindVoiceRecording() {
    const btn = document.getElementById("voice-record-btn");
    const status = document.getElementById("voice-recording-status");

    btn.addEventListener("click", async () => {
        if (!activeTargetId) return;
        
        if (!audioMediaRecorder) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioMediaRecorder = new MediaRecorder(stream);
                audioMediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedAudioChunks.push(e.data); };
                audioMediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(recordedAudioChunks, { type: "audio/ogg; codecs=opus" });
                    recordedAudioChunks = [];
                    status.classList.add("hidden");
                    btn.style.color = "initial";

                    const filePath = `memos/${currentUser.id}_${Date.now()}.ogg`;
                    const { error } = await supabase.storage.from('chat-media').upload(filePath, audioBlob);
                    
                    if (!error) {
                        const { data } = supabase.storage.from('chat-media').getPublicUrl(filePath);
                        const payload = { sender_id: currentUser.id, file_url: data.publicUrl, type: "audio" };
                        if (isTargetRoom) payload.room_id = activeTargetId;
                        else payload.recipient_id = activeTargetId;
                        
                        await supabase.from("messages").insert([payload]);
                    }
                };
            } catch (err) {
                return alert("Audio device access denied.");
            }
        }

        if (audioMediaRecorder.state === "inactive") {
            audioMediaRecorder.start();
            status.classList.remove("hidden");
            btn.style.color = "#ea0038";
        } else {
            audioMediaRecorder.stop();
        }
    });
}

document.addEventListener("DOMContentLoaded", initDashboardPage);
