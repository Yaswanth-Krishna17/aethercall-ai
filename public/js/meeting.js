document.addEventListener('DOMContentLoaded', () => {
  const meetingId = new URLSearchParams(window.location.search).get('id');
  if (!meetingId) {
    window.location.href = 'dashboard.html';
    return;
  }

  let currentUser = null;
  let meetingDetails = null;
  let socket = null;
  
  // Audio / Video Streams
  let localStream = null;
  let micEnabled = true;
  let camEnabled = true;

  // WebRTC Peer Connections Map: socketId => { peerConnection, wrapperEl, videoEl }
  const peers = new Map();
  const peerConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  // Speech-to-Text State
  let recognition = null;
  let sttActive = false;

  // UI Targets
  const roomTitle = document.getElementById('room-title');
  const roomIdSub = document.getElementById('room-id-sub');
  const videoGrid = document.getElementById('video-grid');
  
  // Local video nodes
  const localVideo = document.getElementById('local-video');
  const localVideoContainer = document.getElementById('local-video-container');
  const localPlaceholder = document.getElementById('local-placeholder');
  const localName = document.getElementById('local-name');
  const localAvatar = document.getElementById('local-avatar');
  const indicatorLocalMic = document.getElementById('indicator-local-mic');

  // Control Buttons
  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const btnToggleCam = document.getElementById('btn-toggle-cam');
  const btnToggleStt = document.getElementById('btn-toggle-stt');
  const btnToggleChat = document.getElementById('btn-toggle-chat');
  const btnEndCall = document.getElementById('btn-end-call');
  const chatSidePanel = document.querySelector('.chat-side-panel');

  // Host Analytics Widgets
  const hostStats = document.getElementById('host-stats');
  const hostAvgFocus = document.getElementById('host-avg-focus');
  const hostStudentCount = document.getElementById('host-student-count');
  const engagementAlert = document.getElementById('engagement-alert');
  const engagementAlertText = document.getElementById('engagement-alert-text');

  // Warnings Alerts
  const moderationToast = document.getElementById('moderation-toast');
  const moderationToastText = document.getElementById('moderation-toast-text');

  // Chat Widgets
  const chatMessages = document.getElementById('chat-messages');
  const chatSubmitForm = document.getElementById('chat-submit-form');
  const chatInputField = document.getElementById('chat-input-field');
  const chatParticipantIndicator = document.getElementById('chat-participant-indicator');

  // Hide overlay alerts on launch
  moderationToast.style.display = 'none';

  // --- 1. Session & Meeting Authorization Loader ---
  async function loadMeetingSession() {
    try {
      // Get User info
      let res = await fetch('/api/me');
      if (!res.ok) {
        window.location.href = 'index.html';
        return;
      }
      currentUser = await res.json();

      // Get Meeting detail
      res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) {
        alert('Unauthorized. You are not invited to join this room.');
        window.location.href = 'dashboard.html';
        return;
      }
      meetingDetails = await res.json();

      // Configure room headings
      roomTitle.textContent = escapeHTML(meetingDetails.title);
      roomIdSub.textContent = `Room ID: ${meetingId} | Host: @${escapeHTML(meetingDetails.host)}`;
      localName.textContent = `${currentUser.fullName} ${meetingDetails.host === currentUser.username ? '(Host)' : ''}`;
      localAvatar.textContent = currentUser.fullName.charAt(0).toUpperCase();

      // Setup device media streams
      await setupLocalMedia();

      // Initialize WebSocket Signaling Layer
      initializeSignaling();

      // Setup Speech Recognition Web API
      setupSpeechRecognition();
    } catch (err) {
      console.error(err);
      window.location.href = 'dashboard.html';
    }
  }

  // --- 2. Setup Web Browser Media Tracks ---
  async function setupLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360, frameRate: { ideal: 24 } },
        audio: true
      });
    } catch (err) {
      console.warn('Full media capture failed, attempting audio-only capture...', err);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Hide local video frame and display fallback avatar placeholder
        localVideo.style.display = 'none';
        localPlaceholder.style.display = 'flex';
        localPlaceholder.innerHTML = `
          <div id="local-avatar" class="avatar" style="background: linear-gradient(135deg, var(--success), #047857); font-size: 2rem;">${currentUser.fullName.charAt(0).toUpperCase()}</div>
          <span style="font-size: 0.88rem; color: var(--text-muted);">Your camera is turned off</span>
        `;
      } catch (audioErr) {
        console.error('All media capture devices blocked.', audioErr);
        // Both video and audio failed
        localVideo.style.display = 'none';
        localPlaceholder.style.display = 'flex';
        localPlaceholder.innerHTML = `
          <div class="avatar" style="background: var(--danger); font-size: 2rem;">🚫</div>
          <span style="font-size: 0.88rem; color: var(--danger);">No camera/mic access</span>
        `;
      }
    }

    if (localStream) {
      // Feed local preview tag if video tracks exist
      if (localStream.getVideoTracks().length > 0) {
        localVideo.srcObject = localStream;
        localVideo.play().catch(e => console.warn('Local preview video autoplay blocked:', e));
      } else {
        localVideo.style.display = 'none';
        localPlaceholder.style.display = 'flex';
        localPlaceholder.innerHTML = `
          <div id="local-avatar" class="avatar" style="background: linear-gradient(135deg, var(--success), #047857); font-size: 2rem;">${currentUser.fullName.charAt(0).toUpperCase()}</div>
          <span style="font-size: 0.88rem; color: var(--text-muted);">Your camera is turned off</span>
        `;
      }
      
      // Start local client-side MediaPipe analysis
      if (window.initializeFocusTracker) {
        window.initializeFocusTracker(localStream, (score, details) => {
          // Triggered on every telemetry heartbeat
          updateLocalTelemetryUI(score, details);
          
          // Send focus telemetry to WebSocket server
          if (socket && socket.connected) {
            socket.emit('focus-score', { score });
          }
        });
      }
    } else {
      // Trigger non-camera camera-less heuristics in focus.js
      if (window.initializeFocusTracker) {
        window.initializeFocusTracker(null, (score, details) => {
          updateLocalTelemetryUI(score, details);
          if (socket && socket.connected) {
            socket.emit('focus-score', { score });
          }
        });
      }
    }
  }

  function updateLocalTelemetryUI(score, details) {
    const telemetryLabel = document.getElementById('local-telemetry');
    if (!telemetryLabel) return;

    let alertClass = 'telemetry-focus';
    let statusText = 'Focused';

    if (details.drowsy) {
      alertClass = 'telemetry-drowsy';
      statusText = 'Drowsy';
      localVideoContainer.className = 'video-wrapper drowsy';
    } else if (details.distracted) {
      alertClass = 'telemetry-distracted';
      statusText = 'Looking Away';
      localVideoContainer.className = 'video-wrapper distracted';
    } else {
      localVideoContainer.className = 'video-wrapper';
    }

    telemetryLabel.className = `peer-telemetry-badge ${alertClass}`;
    telemetryLabel.innerHTML = `🔍 AI Focus: ${score}% (${statusText})`;
  }

  // --- 3. Sockets Signaling Relay Integrations ---
  function initializeSignaling() {
    socket = io();

    socket.on('connect', () => {
      socket.emit('register-user', { username: currentUser.username });
      socket.emit('join-meeting', { meetingId, username: currentUser.username });
    });

    // Handle initial peers in room
    socket.on('lobby-peers', (peersList) => {
      console.log(`Lobby has ${peersList.length} active caller(s). Constructing connections.`);
      peersList.forEach(peer => {
        initiatePeerConnection(peer.socketId, peer.username);
      });
    });

    // Handle new incoming peer connections
    socket.on('user-connected', ({ socketId, username }) => {
      console.log(`New peer connected: ${username} (Socket: ${socketId})`);
      // Create empty record wrapper. Connection negotiation will build actual RTCPeerConnection
      appendPeerVideoContainer(socketId, username);
      updateParticipantCount();
    });

    // Handle Relayed WebRTC Signal
    socket.on('signal', async ({ senderSocketId, signalData }) => {
      let peer = peers.get(senderSocketId);

      if (signalData.type === 'offer') {
        // Build answer RTCPeerConnection
        if (!peer) {
          peer = initiatePeerConnection(senderSocketId, 'Peer', false);
        }
        await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
        const answer = await peer.peerConnection.createAnswer();
        await peer.peerConnection.setLocalDescription(answer);
        
        socket.emit('signal', {
          targetSocketId: senderSocketId,
          signalData: answer
        });

      } else if (signalData.type === 'answer') {
        if (peer) {
          await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(signalData));
        }
      } else if (signalData.candidate) {
        if (peer) {
          try {
            await peer.peerConnection.addIceCandidate(new RTCIceCandidate(signalData));
          } catch (e) {
            console.error('Failed to append remote ICE candidate', e);
          }
        }
      }
    });

    // Handle Peer Disconnect / Eviction
    socket.on('user-disconnected', ({ socketId, username, kicked, reason }) => {
      console.log(`Peer left lobby: ${username}`);
      removePeerConnection(socketId);
      updateParticipantCount();

      if (kicked) {
        appendSystemMessage(`🚨 @${escapeHTML(username)} was forcefully kicked from the meeting. Reason: ${escapeHTML(reason)}`);
      }
    });

    // Live moderated chat broadcasts
    socket.on('chat-message', (msg) => {
      appendChatMessage(msg.sender, msg.text, msg.flagged);
    });

    // Warnings overlays for bad text
    socket.on('moderation-warning', ({ strikes, reason }) => {
      showSecurityWarnToast(`Strike ${strikes}/3 warning: ${reason}`);
    });

    // Host telemetry aggregates
    socket.on('focus-analytics-update', ({ averageFocus, participantCount, peerScores }) => {
      if (meetingDetails.host === currentUser.username) {
        // Make analytics widget visible
        hostStats.style.display = 'block';
        hostAvgFocus.textContent = `${averageFocus}%`;
        hostStudentCount.textContent = `${participantCount} Participant(s) Active`;

        if (averageFocus < 50 && participantCount > 0) {
          hostAvgFocus.className = 'analytics-metric low';
          engagementAlertText.textContent = `Average participant attention has collapsed to ${averageFocus}%!`;
          engagementAlert.classList.add('active');
        } else {
          hostAvgFocus.className = 'analytics-metric';
          engagementAlert.classList.remove('active');
        }

        // Apply visual telemetry frames to remote student overlays in the grid
        peerScores.forEach(peerScore => {
          updateRemotePeerTelemetryLabels(peerScore);
        });
      }
    });

    // Handle Kicked eviction
    socket.on('force-kick', ({ reason }) => {
      alert(`⚠️ SECURE KICK WARNING:\nYou have been disconnected from the meeting room. \nReason: ${reason}`);
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      window.location.href = 'dashboard.html';
    });

    socket.on('join-error', (err) => {
      alert(`Error joining call: ${err}`);
      window.location.href = 'dashboard.html';
    });
  }

  // --- 4. WebRTC Multi-Peer Mesh Handshakes Engine ---
  function initiatePeerConnection(targetSocketId, username, isOfferInitiator = true) {
    const pc = new RTCPeerConnection(peerConfiguration);
    const wrapper = appendPeerVideoContainer(targetSocketId, username);
    const video = wrapper.querySelector('video');

    // Attach local stream tracks to RTCPeerConnection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // ICE Candidate Negotiation
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('signal', {
          targetSocketId,
          signalData: event.candidate
        });
      }
    };

    // Receive Remote media tracks with cross-browser stream extraction fallback and programmatic play activation
    pc.ontrack = (event) => {
      let remoteStream = event.streams && event.streams[0];
      
      // Fallback: If event.streams[0] is null/empty, construct a new MediaStream from tracks
      if (!remoteStream) {
        if (!video.srcObject) {
          video.srcObject = new MediaStream();
        }
        video.srcObject.addTrack(event.track);
        remoteStream = video.srcObject;
      } else if (video.srcObject !== remoteStream) {
        video.srcObject = remoteStream;
      }

      // Ensure video is visible and placeholder avatar is hidden
      video.style.display = 'block';
      const placeholder = wrapper.querySelector('.video-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      // Explicitly trigger programmatic playback to bypass strict iOS/Android autoplay policies
      video.play().catch(playErr => {
        console.warn(`[WebRTC] Programmatic video.play() failed (awaiting user gesture):`, playErr);
      });
    };

    const peerRecord = {
      peerConnection: pc,
      wrapperEl: wrapper,
      videoEl: video
    };
    peers.set(targetSocketId, peerRecord);

    // If initiator, generate WebRTC offer
    if (isOfferInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', {
            targetSocketId,
            signalData: offer
          });
        } catch (e) {
          console.error('Failed negotiation step offer generation', e);
        }
      };
    }

    return peerRecord;
  }

  function removePeerConnection(socketId) {
    const peer = peers.get(socketId);
    if (peer) {
      peer.peerConnection.close();
      peer.wrapperEl.remove();
      peers.delete(socketId);
    }
  }

  // Visual layout manager appending elements to grid
  function appendPeerVideoContainer(socketId, username) {
    let existing = document.getElementById(`peer-${socketId}`);
    if (existing) return existing;

    const wrapper = document.createElement('div');
    wrapper.id = `peer-${socketId}`;
    wrapper.className = 'video-wrapper';

    wrapper.innerHTML = `
      <video autoplay playsinline style="display: none;"></video>
      
      <div class="video-placeholder">
        <div class="avatar">${username.charAt(0).toUpperCase()}</div>
        <span style="font-size: 0.88rem; color: var(--text-muted);">Camera turned off</span>
      </div>

      <div class="video-overlay">
        <div class="peer-name-container">
          <span class="peer-name">@${escapeHTML(username)}</span>
          <span id="telemetry-${socketId}" class="peer-telemetry-badge telemetry-focus">🔍 AI Focus: 100%</span>
        </div>
      </div>
    `;

    videoGrid.appendChild(wrapper);
    return wrapper;
  }

  // Update visual focus metrics on remote student templates
  function updateRemotePeerTelemetryLabels(peerScore) {
    // Find wrapper element using username mapping or peer connections
    let targetSocketId = null;
    peers.forEach((data, sid) => {
      // Find matching socket ID that belongs to this username
      const cleanUsername = document.getElementById(`peer-${sid}`)?.querySelector('.peer-name')?.textContent;
      if (cleanUsername && cleanUsername.includes(`@${peerScore.username}`)) {
        targetSocketId = sid;
      }
    });

    if (!targetSocketId) return;

    const badge = document.getElementById(`telemetry-${targetSocketId}`);
    const wrapper = document.getElementById(`peer-${targetSocketId}`);
    if (!badge || !wrapper) return;

    let alertClass = 'telemetry-focus';
    let statusText = 'Focused';

    if (peerScore.score < 40) {
      alertClass = 'telemetry-drowsy';
      statusText = 'Drowsy';
      wrapper.className = 'video-wrapper drowsy';
    } else if (peerScore.score < 70) {
      alertClass = 'telemetry-distracted';
      statusText = 'Distracted';
      wrapper.className = 'video-wrapper distracted';
    } else {
      wrapper.className = 'video-wrapper';
    }

    badge.className = `peer-telemetry-badge ${alertClass}`;
    badge.textContent = `🔍 AI Focus: ${peerScore.score}% (${statusText})`;
  }

  // --- 5. Browser-Native Web Speech Continuous STT Engine ---
  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      btnToggleStt.style.display = 'none'; // Speech API not supported on this browser
      console.warn('Continuous Speech Recognition API is unavailable on this browser.');
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const lastIndex = event.results.length - 1;
      const transcript = event.results[lastIndex][0].transcript.trim();
      
      if (transcript && socket && socket.connected) {
        console.log(`[STT TRANSCRIPT]: "${transcript}"`);
        // Push spoken text content to moderation pipeline
        socket.emit('speech-transcript', { text: transcript });
      }
    };

    recognition.onerror = (e) => {
      console.error('Speech engine warning: ', e);
    };

    recognition.onend = () => {
      // Loop execution if toggle is still active
      if (sttActive) {
        recognition.start();
      }
    };
  }

  // --- 6. Event Listeners & Active Controls toggles ---
  
  // Microphone track toggler
  btnToggleMic.addEventListener('click', () => {
    micEnabled = !micEnabled;
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = micEnabled;
      });
    }
    btnToggleMic.className = micEnabled ? 'control-btn' : 'control-btn active-off';
    indicatorLocalMic.textContent = micEnabled ? '🎤' : '🔇';
    indicatorLocalMic.style.color = micEnabled ? '#fff' : 'var(--danger)';
  });

  // Camera track toggler
  btnToggleCam.addEventListener('click', () => {
    camEnabled = !camEnabled;
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = camEnabled;
      });
    }
    btnToggleCam.className = camEnabled ? 'control-btn' : 'control-btn active-off';
    localVideo.style.display = camEnabled ? 'block' : 'none';
    localPlaceholder.style.display = camEnabled ? 'none' : 'flex';

    // Broadcast Camera status updates if needed
    // In our camera-off workaround, local processing handles calculations even when disabled!
  });

  // Voice analysis tracking toggler
  btnToggleStt.addEventListener('click', () => {
    if (!recognition) return;
    sttActive = !sttActive;

    if (sttActive) {
      recognition.start();
      btnToggleStt.className = 'control-btn';
      btnToggleStt.style.background = 'var(--success)';
      btnToggleStt.style.borderColor = 'var(--success)';
      appendSystemMessage('🎙️ Verbal swearing speech-recognition moderation activated.');
    } else {
      recognition.stop();
      btnToggleStt.className = 'control-btn active-off';
      btnToggleStt.style.background = '';
      btnToggleStt.style.borderColor = '';
      appendSystemMessage('🎙️ Swearing speech moderation deactivated.');
    }
  });

  // Chat message submit dispatcher
  chatSubmitForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInputField.value.trim();
    if (!text) return;

    if (socket && socket.connected) {
      socket.emit('chat-message', { text });
    }
    chatInputField.value = '';
  });

  // Chat sidebar panel visibility toggler
  btnToggleChat.addEventListener('click', () => {
    const isCollapsed = chatSidePanel.classList.toggle('collapsed');
    btnToggleChat.className = isCollapsed ? 'control-btn active-off' : 'control-btn';
  });

  // Disconnect button
  btnEndCall.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this call?')) {
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      window.location.href = 'dashboard.html';
    }
  });

  // --- 7. Chat Visual Append Helpers ---
  function appendChatMessage(sender, text, flagged) {
    const bubble = document.createElement('div');
    const isMine = sender === currentUser.username;
    
    bubble.className = `chat-bubble ${isMine ? 'mine' : ''}`;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedSender = isMine ? 'You' : `@${escapeHTML(sender)}`;

    const bodyClass = flagged ? 'chat-body flagged-censored' : 'chat-body';
    const textContent = flagged ? '🚫 [CENSORED - Abusive Language Flagged]' : escapeHTML(text);

    bubble.innerHTML = `
      <div class="chat-meta">
        <span class="chat-sender" style="font-weight:600;">${formattedSender}</span>
        <span>${timestamp}</span>
      </div>
      <div class="${bodyClass}">${textContent}</div>
    `;

    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendSystemMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.style.maxWidth = '100%';
    bubble.innerHTML = `
      <div class="chat-body" style="background: rgba(255, 255, 255, 0.03); color: var(--warning); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; font-size: 0.82rem; text-align: center; width: 100%;">
        ${escapeHTML(text)}
      </div>
    `;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // --- 8. Warning notification overlays manager ---
  let warningToastTimeout = null;

  function showSecurityWarnToast(message) {
    moderationToastText.textContent = message;
    moderationToast.style.transform = 'translateX(-50%) translateY(0)';
    moderationToast.style.display = 'flex';

    if (warningToastTimeout) clearTimeout(warningToastTimeout);

    warningToastTimeout = setTimeout(() => {
      moderationToast.style.transform = 'translateX(-50%) translateY(-100px)';
      moderationToast.style.display = 'none';
    }, 4500);
  }

  function updateParticipantCount() {
    const count = peers.size + 1;
    chatParticipantIndicator.textContent = `${count} User(s) online`;
  }

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

  // Launch initial checks
  loadMeetingSession();
});
