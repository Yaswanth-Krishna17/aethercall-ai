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

  // Manage Invitees UI elements
  const manageInviteesModal = document.getElementById('manage-invitees-modal');
  const manageMeetingTitle = document.getElementById('manage-modal-meeting-title');
  const manageInviteesList = document.getElementById('manage-invitees-list');
  const manageAddUsername = document.getElementById('manage-add-username');
  const btnManageAdd = document.getElementById('btn-manage-add');
  const btnCloseManage = document.getElementById('btn-close-manage');
  const btnSaveManage = document.getElementById('btn-save-manage');
  const manageModalError = document.getElementById('manage-modal-error');
  const manageModalSuccess = document.getElementById('manage-modal-success');
  
  let currentInvitees = [];
  let activeMeetingIdForManage = null;

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

        // Render Manage Participants button exclusively for scheduled/active host meetings
        const canManage = isHost && m.status !== 'ended';
        const manageInviteesBtn = canManage ? `
          <button class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 0.72rem; border-radius: 6px; margin-left: 8px;" onclick="openManageInviteesModal('${m.id}', '${escapeHTML(m.title.replace(/'/g, "\\'"))}', '${m.invitees.join(',')}')">
            ✏️ Manage
          </button>
        ` : '';

        return `
          <div class="meeting-row">
            <div class="meeting-title-col">
              <span class="meeting-title">${escapeHTML(m.title)}</span>
              <div class="meeting-meta">
                <span>👤 Host: ${isHost ? 'You' : `@${escapeHTML(m.host)}`}</span>
                <span>🔑 Room ID: ${m.id}</span>
                <span>
                  👥 ${m.invitees.length} Invited
                  ${manageInviteesBtn}
                </span>
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

  // --- 7. Host Post-Scheduling Participant Management Modal Handlers ---
  window.openManageInviteesModal = (meetingId, title, inviteesStr) => {
    activeMeetingIdForManage = meetingId;
    manageMeetingTitle.textContent = title;
    
    currentInvitees = inviteesStr ? inviteesStr.split(',').filter(i => i !== '') : [];
    
    manageModalError.style.display = 'none';
    manageModalSuccess.style.display = 'none';
    manageAddUsername.value = '';

    renderManageInvitees();
    manageInviteesModal.classList.add('active');
  };

  function renderManageInvitees() {
    if (currentInvitees.length === 0) {
      manageInviteesList.innerHTML = `<span style="padding: 10px; color: var(--text-muted); font-size: 0.82rem; display: block; text-align: center;">No participants invited yet.</span>`;
      return;
    }
    manageInviteesList.innerHTML = currentInvitees.map((username, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
        <span style="font-size: 0.9rem; font-weight: 500; color: #fff;">@${escapeHTML(username)}</span>
        <button type="button" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.9rem; font-weight: bold;" onclick="removeInviteeAt(${idx})">❌</button>
      </div>
    `).join('');
  }

  window.removeInviteeAt = (index) => {
    currentInvitees.splice(index, 1);
    renderManageInvitees();
  };

  btnManageAdd.addEventListener('click', () => {
    manageModalError.style.display = 'none';
    const username = manageAddUsername.value.trim().toLowerCase();
    
    if (!username) return;

    if (username === currentUser.username.toLowerCase()) {
      showError(manageModalError, 'You cannot invite yourself as a participant.');
      return;
    }

    if (currentInvitees.includes(username)) {
      showError(manageModalError, 'User is already invited.');
      return;
    }

    currentInvitees.push(username);
    manageAddUsername.value = '';
    renderManageInvitees();
  });

  // Support Enter key press inside the username input
  manageAddUsername.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnManageAdd.click();
    }
  });

  // Dismiss modal
  btnCloseManage.addEventListener('click', () => {
    manageInviteesModal.classList.remove('active');
    activeMeetingIdForManage = null;
  });

  // Save changes
  btnSaveManage.addEventListener('click', async () => {
    manageModalError.style.display = 'none';
    manageModalSuccess.style.display = 'none';

    try {
      const res = await fetch(`/api/meetings/${activeMeetingIdForManage}/invitees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitees: currentInvitees })
      });

      const data = await res.json();
      if (!res.ok) {
        showError(manageModalError, data.error || 'Failed to update invitees.');
      } else {
        manageModalSuccess.textContent = 'Participants list updated successfully!';
        manageModalSuccess.style.display = 'flex';
        
        setTimeout(() => {
          manageInviteesModal.classList.remove('active');
          activeMeetingIdForManage = null;
          fetchMeetings(); // refresh lists on dashboard!
        }, 1200);
      }
    } catch (err) {
      showError(manageModalError, 'Database connection timed out.');
    }
  });

  // Initial trigger
  loadUserProfile();
});
