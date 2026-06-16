// ========================================================
// SUPABASE REALTIME WORKSPACE IMPLEMENTATION (SQL MIGRATED)
// ========================================================

const SUPABASE_URL = "https://flricibvmgkmtkptzwck.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZscmljaWJ2bWdrbXRrcHR6d2NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mzg5NzIsImV4cCI6MjA5NzIxNDk3Mn0.XIBhapnKgGSE3m15Q5AJYN8lkekdfeFrlLbEGQ5ul-M";

window.supabase = window.supabase || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabase = window.supabase;

let currentUser = null; 
let activeChatId = null;
let selectedChatObject = null; 
let messageSubscriptionChannel = null;

let audioMediaRecorder = null;
let recordedAudioChunks = [];

async function initDashboardPage() {
    if (!document.getElementById("users-container") && !document.getElementById("message-form")) return; 

    const savedUid = localStorage.getItem("session_uid");
    const savedName = localStorage.getItem("session_name");

    if (!savedUid) {
        window.location.href = "index.html";
        return; 
    }

    currentUser = { uid: savedUid, name: savedName };

    // Broadcast Online Presence
    await supabase.from("users").update({ is_online: true, last_seen: new Date().toISOString() }).eq("uid", currentUser.uid);

    // Keep UI Header names in sync dynamically
    supabase
        .channel(`public:users:uid=eq.${currentUser.uid}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `uid=eq.${currentUser.uid}` }, payload => {
            if(document.getElementById("current-user-title")) document.getElementById("current-user-title").innerText = payload.new.name;
            if(document.getElementById("my-status-display")) document.getElementById("my-status-display").innerText = payload.new.status_text || "Available";
        }).subscribe();

    // --- INSTANT GROUP CREATION (Normalized) ---
    const createGroupActionBtn = document.getElementById("create-group-btn");
    if (createGroupActionBtn) {
        createGroupActionBtn.addEventListener("click", async () => {
            const groupNameInput = document.getElementById("group-name-input");
            const title = groupNameInput ? groupNameInput.value.trim() : "";

            if (!title) return alert("Please declare a room name.");

            try {
                // 1. Create the Chat Record
                const { data: chatData, error: chatError } = await supabase.from("chats").insert([{
                    is_group: true,
                    group_name: title,
                    created_by: currentUser.uid
                }]).select().single();

                if (chatError) throw chatError;

                // 2. Add creator as Admin in chat_members
                await supabase.from("chat_members").insert([{
                    chat_id: chatData.id,
                    user_id: currentUser.uid,
                    role: 'admin'
                }]);

                alert(`Group "${title}" created successfully!`);
                if(groupNameInput) groupNameInput.value = "";
                executeTargetSearchQuery(""); 
            } catch (err) {
                alert("Room composition failure: " + err.message);
            }
        });
    }

    // --- 72-HOUR STATUS UPDATES ---
    const updateStatusBtn = document.getElementById("update-status-btn");
    if (updateStatusBtn) {
        updateStatusBtn.addEventListener("click", async () => {
            const statusInput = document.getElementById("status-input");
            if(!statusInput || !statusInput.value.trim()) return;

            await supabase.from("status_updates").insert([{
                user_id: currentUser.uid,
                type: 'text',
                content: statusInput.value.trim()
                // expires_at is automatically handled by Postgres default (+72 hours)
            }]);
            statusInput.value = "";
            alert("Status posted. It will disappear in 72 hours.");
        });
    }

    // Initialize Search & Forms
    const searchField = document.getElementById("search-users");
    if (searchField) {
        searchField.addEventListener("input", (e) => executeTargetSearchQuery(e.target.value.trim()));
    }
    executeTargetSearchQuery(""); 

    const messageForm = document.getElementById("message-form");
    if (messageForm) {
        messageForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const input = document.getElementById("message-input");
            const isDisappearingMode = document.getElementById("disappearing-toggle")?.checked || false;

            if (!input || !input.value.trim() || !activeChatId) return;

            const text = input.value.trim();
            input.value = "";

            await supabase.from("messages").insert([{
                chat_id: activeChatId,
                text: text,
                type: "text",
                sender_id: currentUser.uid,
                is_disappearing: isDisappearingMode
            }]);
        });
    }
}

async function executeTargetSearchQuery(keyword) {
    const listCanvas = document.getElementById("users-container");
    if (!listCanvas) return;
    listCanvas.innerHTML = "";

    let { data: usersList } = await supabase.from("users").select("*").ilike("name", `%${keyword}%`);
    let { data: groupsList } = await supabase.from("chats").select("*").eq("is_group", true).ilike("group_name", `%${keyword}%`);

    if (groupsList) groupsList.forEach(group => buildSidebarRow(group, true));
    if (usersList) {
        usersList.forEach(user => {
            if(user.uid !== currentUser.uid) buildSidebarRow(user, false);
        });
    }
}

function buildSidebarRow(data, isGroup) {
    const canvas = document.getElementById("users-container");
    let rowElement = document.createElement("div");
    rowElement.style = "display:flex; align-items:center; padding:12px 16px; cursor:pointer; border-bottom:1px solid #f8f9fa;";

    const displayName = isGroup ? data.group_name : data.name;
    const initial = isGroup ? '👥' : displayName.charAt(0).toUpperCase();

    rowElement.innerHTML = `
        <div style="background:#00a884; color:white; width:44px; height:44px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:18px; margin-right: 12px;">
            ${initial}
        </div>
        <div style="flex:1;">
            <h4 style="margin:0; font-size:14px; color:#111b21;">${displayName}</h4>
        </div>
    `;

    rowElement.addEventListener("click", async () => {
        // Logic to ensure a 1-on-1 chat record exists if clicking a user
        if (!isGroup) {
            // Find existing chat or create new
            const { data: existingChat } = await supabase.rpc('get_direct_chat', { user1: currentUser.uid, user2: data.uid });
            if (existingChat) {
                activeChatId = existingChat;
            } else {
                const { data: newChat } = await supabase.from('chats').insert([{ is_group: false }]).select().single();
                await supabase.from('chat_members').insert([
                    { chat_id: newChat.id, user_id: currentUser.uid },
                    { chat_id: newChat.id, user_id: data.uid }
                ]);
                activeChatId = newChat.id;
            }
        } else {
            activeChatId = data.id;
        }

        document.getElementById("no-chat-selected").classList.add("hidden");
        document.getElementById("active-chat-area").classList.remove("hidden");
        document.getElementById("chat-header-name").innerText = displayName;

        bindLiveIsolatedMessageStreams(activeChatId);
    });
    
    canvas.appendChild(rowElement);
}

function bindLiveIsolatedMessageStreams(chatId) {
    if (messageSubscriptionChannel) supabase.removeChannel(messageSubscriptionChannel);

    const chatBoxWindow = document.getElementById("message-stream");
    chatBoxWindow.innerHTML = "";

    // 1. Fetch history
    supabase.from("messages").select("*, users(name)").eq("chat_id", chatId).order("created_at", { ascending: true })
        .then(({ data }) => {
            if(data) {
                data.forEach(msg => renderSingleMessageBubble(msg));
                markMessagesAsSeen(data); // Trigger the 3-minute countdown for unread disappearing messages
            }
        });

    // 2. Subscribe to live stream
    messageSubscriptionChannel = supabase
        .channel(`room:${chatId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, payload => {
            // Fetch sender name joined data manually since realtime payload lacks relations
            supabase.from('users').select('name').eq('uid', payload.new.sender_id).single().then(({data}) => {
                payload.new.users = data;
                renderSingleMessageBubble(payload.new);
                if (payload.new.sender_id !== currentUser.uid && payload.new.is_disappearing) {
                    markMessagesAsSeen([payload.new]);
                }
            });
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, payload => {
            // Handle visual removal of expiring messages triggered by pg_cron
            const bubble = document.getElementById(`msg-${payload.old.id}`);
            if(bubble) bubble.remove();
        })
        .subscribe();
}

async function markMessagesAsSeen(messages) {
    const unreadDisappearingIds = messages
        .filter(m => m.is_disappearing && m.sender_id !== currentUser.uid && !m.seen_at)
        .map(m => m.id);

    if (unreadDisappearingIds.length > 0) {
        await supabase
            .from('messages')
            .update({ seen_at: new Date().toISOString() })
            .in('id', unreadDisappearingIds);
    }
}

function renderSingleMessageBubble(data) {
    const chatBoxWindow = document.getElementById("message-stream");
    const bubbleRow = document.createElement("div");
    const isMe = data.sender_id === currentUser.uid;
    bubbleRow.id = `msg-${data.id}`;
    
    bubbleRow.style = `display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'}; margin-bottom:12px;`;
    
    let content = data.type === "audio" 
        ? `<audio src="${data.file_url}" controls style="max-width:250px;"></audio>`
        : `<p style="margin:0; font-size:14px; color:#111b21;">${data.text}</p>`;

    let disappearingIcon = data.is_disappearing ? `<span style="font-size:10px; color:#ea0038;"> ⏱️ (3m)</span>` : '';

    bubbleRow.innerHTML = `
        <div style="background:${isMe ? '#d9fdd3' : '#ffffff'}; padding:9px 14px; border-radius:10px; max-width:68%;">
            <div style="font-size:11px; margin-bottom:3px; font-weight:bold; color:#008069;">
                ${data.users?.name || 'Unknown'} ${disappearingIcon}
            </div>
            ${content}
        </div>`;
        
    chatBoxWindow.appendChild(bubbleRow);
    chatBoxWindow.scrollTop = chatBoxWindow.scrollHeight;
}

document.addEventListener("DOMContentLoaded", initDashboardPage);
