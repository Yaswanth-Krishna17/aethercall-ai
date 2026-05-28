document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;
  let socket = null;

  // UI Navigation / Details selection
  const userDisplayName = document.getElementById('user-display-name');
  const userHandle = document.getElementById('user-handle');
  const userAvatar = document.getElementById('user-avatar');
  const welcomeMessage = document.getElementById('welcome-message');
  const meetingsContainer = document.getElementById('meetings-container');
  
  // Scheduler elements
  const createMeetingForm = document.getElementById('create-meeting-form');
  const schedulerError = document.getElementById('scheduler-error');
  const schedulerSuccess = document.getElementById('scheduler-success');

  // Modal elements
  const inviteModal = document.getElementById('invite-modal');
  const inviteDetails = document.getElementById('invite-details');
  const btnAcceptInvite = document.getElementById('btn-accept-invite');
  const btnDeclineInvite = document.getElementById('btn-decline-invite');
  
  // Action buttons
  const btnLogout = document.getElementById('btn-logout');

  // --- 1. Load User Session ---
  async function loadUserProfile() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) {
        // Not authenticated, redirect to landing
        window.location.href = 'index.html';
        return;
      }
      
      currentUser = await res.json();
      
      // Update UI Widgets
      userDisplayName.textContent = currentUser.fullName;
      userHandle.textContent = `@${currentUser.username}`;
      userAvatar.textContent = currentUser.fullName.charAt(0).toUpperCase();
      welcomeMessage.innerHTML = `Welcome back, <span style="color: var(--accent-primary);">${currentUser.fullName}</span>!`;

      // Establish real-time WebSocket connection
      initializeRealtimeNetwork(currentUser.username);
      
      // Load meetings list
      fetchMeetings();
    } catch (err) {
      console.error('Failed to load user profile.', err);
      window.location.href = 'index.html';
    }
  }

  // --- 2. Initialize Sockets & Live Signals ---
  function initializeRealtimeNetwork(username) {
    // Establish connection to Server
    socket = io();

    socket.on('connect', () => {
      console.log('Real-time signaling network connected successfully.');
      // Register socket ID to user identity on backend
      socket.emit('register-user', { username });
    });

    // Listen for live linkless meeting invitation popup
    socket.on('meeting-invite', (data) => {
      showIncomingCallModal(data);
    });
  }

  // --- 3. Retrieve Scheduled Meetings ---
  async function fetchMeetings() {
    try {
      const res = await fetch('/api/meetings');
      if (!res.ok) throw new Error('Meetings list fetch failed.');

      const list = await res.json();
      
      if (list.length === 0) {
        meetingsContainer.innerHTML = `
          <div style="text-align: center; padding: 25px; color: var(--text-muted);">
            <span style="font-size: 2.2rem; display: block; margin-bottom: 8px;">📅</span>
            No scheduled meetings found. Create one above to get started!
          </div>
        `;
        return;
      }

      // Sort: Active meetings first, then Scheduled, then Ended
      list.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (a.status !== 'active' && b.status === 'active') return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      meetingsContainer.innerHTML = list.map(m => {
        const isHost = m.host === currentUser.username;
        const statusBadgeClass = `status-${m.status}`;
        
        let actionBtnHTML = '';
        if (m.status === 'ended') {
          actionBtnHTML = `<span style="font-size: 0.85rem; color: var(--text-muted);">Completed</span>`;
        } else {
          // Dynamic button that changes look for active call vs scheduled
          const btnClass = m.status === 'active' ? 'btn-primary' : 'btn-secondary';
          actionBtnHTML = `
            <button class="btn ${btnClass} btn-sm" onclick="joinMeetingCall('${m.id}')">
              ${m.status === 'active' ? '⚡ Join Live' : 'Start Call'}
            </button>
          `;
        }

        return `
          <div class="meeting-row">
            <div class="meeting-title-col">
              <span class="meeting-title">${escapeHTML(m.title)}</span>
              <div class="meeting-meta">
                <span>👤 Host: ${isHost ? 'You' : `@${escapeHTML(m.host)}`}</span>
                <span>🔑 Room ID: ${m.id}</span>
                <span>👥 ${m.invitees.length} Invited</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
              <span class="status-badge ${statusBadgeClass}">${m.status}</span>
              ${actionBtnHTML}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      meetingsContainer.innerHTML = `<p style="color: var(--danger);">Failed to load meetings. Try refreshing.</p>`;
    }
  }

  // Define global click router for join buttons
  window.joinMeetingCall = (meetingId) => {
    window.location.href = `meeting.html?id=${meetingId}`;
  };

  // --- 4. Meeting Creation Submission ---
  createMeetingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    schedulerError.style.display = 'none';
    schedulerSuccess.style.display = 'none';

    const title = document.getElementById('meet-title').value.trim();
    const rawInvitees = document.getElementById('meet-invitees').value;
    
    // Parse comma separated invitees
    const invitees = rawInvitees.split(',')
      .map(i => i.trim())
      .filter(i => i !== '');

    if (!title || invitees.length === 0) {
      showError(schedulerError, 'Title and at least one invited username are required.');
      return;
    }

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, invitees })
      });

      const data = await res.json();
      if (!res.ok) {
        showError(schedulerError, data.error || 'Failed to create meeting.');
      } else {
        // Created successfully
        schedulerSuccess.textContent = 'Meeting scheduled! Online invitees notified.';
        schedulerSuccess.style.display = 'flex';
        createMeetingForm.reset();
        
        // Refresh local dashboard list
        fetchMeetings();
      }
    } catch (err) {
      showError(schedulerError, 'Connection timed out. Please try again.');
    }
  });

  // --- 5. Incoming Invitation Modal Interactions ---
  let pendingMeetingId = null;

  function showIncomingCallModal(data) {
    pendingMeetingId = data.meetingId;
    inviteDetails.innerHTML = `
      <span style="color: var(--accent-primary); font-weight: 600;">${escapeHTML(data.host)}</span> 
      is inviting you to join 
      <br>
      <strong style="font-size: 1.15rem; color: #fff; display: block; margin-top: 10px;">"${escapeHTML(data.title)}"</strong>
    `;
    inviteModal.classList.add('active');
  }

  btnAcceptInvite.addEventListener('click', () => {
    if (pendingMeetingId) {
      window.location.href = `meeting.html?id=${pendingMeetingId}`;
    }
  });

  btnDeclineInvite.addEventListener('click', () => {
    inviteModal.classList.remove('active');
    pendingMeetingId = null;
  });

  // --- 6. Logout Handling ---
  btnLogout.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/logout', { method: 'POST' });
      if (res.ok) {
        window.location.href = 'index.html';
      }
    } catch (err) {
      alert('Logout connection failed.');
    }
  });

  // XSS protection escape helper
  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }

  // Scheduler alert display helper
  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'flex';
  }

  // Initial trigger
  loadUserProfile();
});
