// Supabase Configuration
const SUPABASE_URL = 'https://sggecrklzmnzyelbsgkk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNnZ2Vjcmtsem1uenllbGJzZ2trIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MzA1MDAsImV4cCI6MjA4NDQwNjUwMH0.lmAGMCODydb5qh8fIEwVN97IiYc1Vu3XSKndplHiSpQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State Management
let currentUser = null;
let isAdmin = false;
let messages = [];
let userVotes = {};
let sortByVotes = false;
let pollingInterval = null;
let lastMessageCount = 0;

// Touch swipe state
let touchStartX = 0;
let touchStartY = 0;
let currentSwipeElement = null;

// DOM Elements
const loadingScreen = document.getElementById('loadingScreen');
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const nameInput = document.getElementById('nameInput');
const rollInput = document.getElementById('rollInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const sortToggle = document.getElementById('sortToggle');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const headerName = document.getElementById('headerName');
const userAvatar = document.getElementById('userAvatar');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    setupEventListeners();
});

// Check if user is already logged in
async function checkSession() {
    const savedUser = localStorage.getItem('discussionUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        await checkAdminStatus();
        showMainScreen();
    } else {
        loadingScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    }
}

// Setup Event Listeners
function setupEventListeners() {
    loginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    sendBtn.addEventListener('click', handleSendMessage);
    sortToggle.addEventListener('click', toggleSort);
    
    rollInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    
    
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
    });

    // Add keyboard handling for mobile
    const handleInputScroll = () => {
        setTimeout(() => {
            // Scroll the messages container to bottom to reveal input
            messagesContainer.scrollTop = messagesContainer.scrollHeight + 200;
        }, 100);
    };

    messageInput.addEventListener('focus', handleInputScroll);
    messageInput.addEventListener('click', handleInputScroll);
    messageInput.addEventListener('touchstart', handleInputScroll);
    // Refresh when user returns to tab
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && currentUser) {
            silentRefresh();
        }
    });
    
}

// Handle Login
async function handleLogin() {
    const name = nameInput.value.trim();
    const roll = rollInput.value.trim();
    
    if (!name || name.length < 2) {
        alert('Please enter your name');
        return;
    }
    
    // Update this validation:
    if (roll.length !== 8) {
        alert('Roll number must be exactly 8 digits');
        return;
    }
    
    // To this:
    if (roll.length !== 8) {
        alert('Roll number must be exactly 8 characters');
        return;
    }
    
    currentUser = { name, roll_number: roll };
    localStorage.setItem('discussionUser', JSON.stringify(currentUser));
    
    await checkAdminStatus();
    showMainScreen();
}

// Check if user is admin
async function checkAdminStatus() {
    try {
        const { data, error } = await supabaseClient
            .from('admins')
            .select('roll_number')
            .eq('roll_number', currentUser.roll_number)
            .maybeSingle();
        
        isAdmin = !!data;
    } catch (error) {
        isAdmin = false;
    }
}

// Handle Logout
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        // Stop polling
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        
        localStorage.removeItem('discussionUser');
        currentUser = null;
        isAdmin = false;
        messages = [];
        userVotes = {};
        
        loginScreen.classList.remove('hidden');
        mainScreen.classList.add('hidden');
        
        nameInput.value = '';
        rollInput.value = '';
    }
}

// Show Main Screen
function showMainScreen() {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    
    headerName.textContent = currentUser.name;
    userAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
    
    loadMessages();
    setupRealtime();
    loadUserVotes();
    
    // Start background polling every 15 seconds
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    pollingInterval = setInterval(silentRefresh, 15000);
}

// Load all messages
async function loadMessages() {
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select(`
                *,
                votes (vote_type)
            `)
            .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        messages = data.map(msg => ({
            ...msg,
            upvotes: msg.votes.filter(v => v.vote_type === 'upvote').length,
            downvotes: msg.votes.filter(v => v.vote_type === 'downvote').length
        }));
        
        renderMessages();
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

// Silent background refresh - checks for new messages without disrupting UI
async function silentRefresh() {
    // Don't refresh if user is actively typing
    if (document.activeElement === messageInput) {
        return;
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('messages')
            .select(`
                *,
                votes (vote_type)
            `)
            .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        // Check if there are actually new messages
        if (data.length === messages.length) {
            return; // No new messages, skip update
        }
        
        const wasAtBottom = isScrolledToBottom();
        const scrollPos = messagesContainer.scrollTop;
        
        // Create a map of existing message IDs for quick lookup
        const existingIds = new Set(messages.map(m => m.id));
        
        // Process new data
        const newMessages = data.map(msg => ({
            ...msg,
            upvotes: msg.votes.filter(v => v.vote_type === 'upvote').length,
            downvotes: msg.votes.filter(v => v.vote_type === 'downvote').length
        }));
        
        // Only add truly new messages
        const addedMessages = newMessages.filter(msg => !existingIds.has(msg.id));
        
        if (addedMessages.length > 0) {
            // Merge new messages
            messages = newMessages;
            lastMessageCount = messages.length;
            
            // Render without disrupting scroll
            renderMessages();
            
            // Restore exact scroll position (only auto-scroll if user was at bottom)
            if (wasAtBottom) {
                scrollToBottom();
            } else {
                messagesContainer.scrollTop = scrollPos;
            }
        }
        
    } catch (error) {
        console.error('Silent refresh error:', error);
        // Fail silently - don't alert user
    }
}


// Load user's votes
async function loadUserVotes() {
    try {
        const { data, error } = await supabaseClient
            .from('votes')
            .select('message_id, vote_type')
            .eq('roll_number', currentUser.roll_number);
        
        if (error) throw error;
        
        userVotes = {};
        data.forEach(vote => {
            userVotes[vote.message_id] = vote.vote_type;
        });
        
        renderMessages();
    } catch (error) {
        console.error('Error loading votes:', error);
    }
}

// Setup Realtime Subscription
function setupRealtime() {
    supabaseClient
        .channel('messages-channel')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'messages' }, 
            handleNewMessage
        )
        .on('postgres_changes', 
            { event: 'DELETE', schema: 'public', table: 'messages' }, 
            handleDeletedMessage
        )
        .subscribe();
    
    supabaseClient
        .channel('votes-channel')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'votes' }, 
            handleVoteChange
        )
        .subscribe();
}

// Handle new message from realtime
async function handleNewMessage(payload) {
    const newMsg = payload.new;
    
    if (messages.find(m => m.id === newMsg.id)) {
        return;
    }
    
    const wasAtBottom = isScrolledToBottom();
    
    const { data: votes } = await supabaseClient
        .from('votes')
        .select('vote_type')
        .eq('message_id', newMsg.id);
    
    const messageWithVotes = {
        ...newMsg,
        votes: votes || [],
        upvotes: votes ? votes.filter(v => v.vote_type === 'upvote').length : 0,
        downvotes: votes ? votes.filter(v => v.vote_type === 'downvote').length : 0
    };
    
    messages.push(messageWithVotes);
    renderMessages();
    
    if (wasAtBottom) {
        scrollToBottom();
    }
}

// Handle deleted message from realtime
function handleDeletedMessage(payload) {
    const deletedId = payload.old.id;
    messages = messages.filter(m => m.id !== deletedId);
    renderMessages();
}

// Handle vote change from realtime
async function handleVoteChange() {
    await loadMessages();
}

// Toggle sort mode
function toggleSort() {
    sortByVotes = !sortByVotes;
    sortToggle.classList.toggle('active', sortByVotes);
    renderMessages();
}

// Render all messages
function renderMessages() {
    const wasAtBottom = isScrolledToBottom();
    const scrollPos = messagesContainer.scrollTop;
    
    let displayMessages = [...messages];
    
    if (sortByVotes) {
        const grouped = [];
        let currentGroup = [];
        
        displayMessages.forEach(msg => {
            if (msg.is_question) {
                if (currentGroup.length > 0) {
                    grouped.push(currentGroup);
                    currentGroup = [];
                }
                grouped.push([msg]);
            } else {
                currentGroup.push(msg);
            }
        });
        
        if (currentGroup.length > 0) {
            grouped.push(currentGroup);
        }
        
        displayMessages = grouped.flatMap(group => {
            if (group[0]?.is_question) {
                return group;
            } else {
                return group.sort((a, b) => {
                    const aScore = a.upvotes - a.downvotes;
                    const bScore = b.upvotes - b.downvotes;
                    return bScore - aScore;
                });
            }
        });
    }
    
    messagesContainer.innerHTML = displayMessages.map(msg => createMessageHTML(msg)).join('');
    
    displayMessages.forEach(msg => {
        attachMessageListeners(msg);
    });
    
    if (wasAtBottom) {
        scrollToBottom();
    } else {
        messagesContainer.scrollTop = scrollPos;
    }
}

// Create message HTML
function createMessageHTML(msg) {
    const userVote = userVotes[msg.id];
    const isQuestion = msg.is_question;
    
    return `
        <div class="message-card ${isQuestion ? 'question' : ''}" data-id="${msg.id}" ${!isQuestion ? `data-user-message="true" ${userVote === 'upvote' ? 'data-voted="true"' : ''}` : 'data-admin-message="true"'}>
            <div class="message-content">
                ${msg.content}
                <div class="message-bottom-bar">
                    <div class="message-author-attribution">${msg.name}</div>
                    ${!isQuestion ? `
                        <div class="vote-section">
                            <svg class="vote-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <polyline points="18 15 12 9 6 15"></polyline>
                            </svg>
                            <span class="vote-count">${msg.upvotes}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

// Attach event listeners to message elements with swipe gestures
function attachMessageListeners(msg) {
    const messageCard = messagesContainer.querySelector(`.message-card[data-id="${msg.id}"]`);
    if (!messageCard) return;
    
    // Swipe gesture handlers
    messageCard.addEventListener('touchstart', handleTouchStart, { passive: true });
    messageCard.addEventListener('touchmove', handleTouchMove, { passive: true });
    messageCard.addEventListener('touchend', (e) => handleTouchEnd(e, msg), { passive: true });
    
    // Desktop fallback - double click to vote on user messages
    if (!msg.is_question) {
        messageCard.addEventListener('dblclick', () => {
            handleVote(msg.id, 'upvote');
        });
    }
    
    // Long press to delete (admin only)
    if (isAdmin) {
        let pressTimer;
        
        const startPress = (e) => {
            pressTimer = setTimeout(() => {
                handleDeleteMessage(msg.id);
            }, 600);
        };
        
        const cancelPress = () => {
            clearTimeout(pressTimer);
        };
        
        messageCard.addEventListener('touchstart', startPress);
        messageCard.addEventListener('touchend', cancelPress);
        messageCard.addEventListener('touchmove', cancelPress);
        
        messageCard.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handleDeleteMessage(msg.id);
        });
    }
}

// Touch gesture handlers
function handleTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    currentSwipeElement = e.currentTarget;
}

function handleTouchMove(e) {
    if (!currentSwipeElement) return;
    
    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    const deltaX = touchX - touchStartX;
    const deltaY = touchY - touchStartY;
    
    // Only handle horizontal swipes
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        e.preventDefault();
    }
}

function handleTouchEnd(e, msg) {
    if (!currentSwipeElement) return;
    
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    // Only trigger on horizontal swipes (not vertical scrolling)
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX < 0 && !msg.is_question) {
            // Swipe left on user message - upvote
            handleVote(msg.id, 'upvote');
        } else if (deltaX > 0 && isAdmin) {
            // Swipe right (admin only) - delete
            handleDeleteMessage(msg.id);
        }
    }
    
    currentSwipeElement = null;
}

// Handle sending message
async function handleSendMessage() {
    const content = messageInput.value.trim();
    
    if (!content) return;
    
    try {
        const { error } = await supabaseClient
            .from('messages')
            .insert({
                name: currentUser.name,
                roll_number: currentUser.roll_number,
                content: content,
                is_question: isAdmin
            });
        
        if (error) throw error;
        
        messageInput.value = '';
        messageInput.style.height = 'auto';
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message');
    }
}

// Handle delete message
async function handleDeleteMessage(messageId) {
    if (!isAdmin) return;
    
    if (!confirm('Delete this message?')) return;
    
    try {
        const { error } = await supabaseClient
            .from('messages')
            .delete()
            .eq('id', messageId);
        
        if (error) throw error;
    } catch (error) {
        console.error('Error deleting message:', error);
        alert('Failed to delete message');
    }
}

// Handle vote
async function handleVote(messageId, voteType) {
    const currentVote = userVotes[messageId];
    
    // Optimistic UI update
    const messageCard = messagesContainer.querySelector(`.message-card[data-id="${messageId}"]`);
    if (messageCard) {
        const voteCountEl = messageCard.querySelector('.vote-count');
        const currentMsg = messages.find(m => m.id === messageId);
        
        if (currentVote === voteType) {
            // Removing vote
            userVotes[messageId] = null;
            delete userVotes[messageId];
            messageCard.removeAttribute('data-voted');
            if (voteCountEl && currentMsg) {
                voteCountEl.textContent = Math.max(0, currentMsg.upvotes - 1);
            }
        } else {
            // Adding vote
            userVotes[messageId] = voteType;
            messageCard.setAttribute('data-voted', 'true');
            if (voteCountEl && currentMsg) {
                const adjustment = currentVote ? 0 : 1;
                voteCountEl.textContent = currentMsg.upvotes + adjustment;
            }
        }
    }
    
    try {
        if (currentVote === voteType) {
            const { error } = await supabaseClient
                .from('votes')
                .delete()
                .eq('message_id', messageId)
                .eq('roll_number', currentUser.roll_number);
            
            if (error) throw error;
        } else {
            if (currentVote) {
                const { error } = await supabaseClient
                    .from('votes')
                    .update({ vote_type: voteType })
                    .eq('message_id', messageId)
                    .eq('roll_number', currentUser.roll_number);
                
                if (error) throw error;
            } else {
                const { error } = await supabaseClient
                    .from('votes')
                    .insert({
                        message_id: messageId,
                        roll_number: currentUser.roll_number,
                        vote_type: voteType
                    });
                
                if (error) throw error;
            }
        }
    } catch (error) {
        console.error('Error voting:', error);
        // Revert optimistic update on error
        await loadMessages();
    }
}

// Utility functions
function isScrolledToBottom() {
    const threshold = 150;
    const position = messagesContainer.scrollTop + messagesContainer.clientHeight;
    const height = messagesContainer.scrollHeight;
    return position >= height - threshold;
}

function scrollToBottom() {
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}
