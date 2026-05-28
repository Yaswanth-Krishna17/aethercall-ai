import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import nodemailer from 'nodemailer';

import * as db from './db.js';
import { moderateContent } from './moderator.js';

// In-Memory Secure OTP Store (Format: email => { otp, expiresAt })
const otpStore = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'AI_VIDEO_CONFERENCE_SUPER_SECRET';

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Access denied. Please login.' });

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid session token. Please re-login.' });
  }
};

// --- SECURE BACKEND-DRIVEN OTP ENDPOINTS ---

// Send OTP via Nodemailer (or Simulated fallback)
app.post('/api/otp/send', async (req, res) => {
  try {
    const { email, username, type } = req.body;
    if (!email || !type) {
      return res.status(400).json({ error: 'Email and verification type are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    
    // Alphanumeric checks on username for registration
    if (type === 'register') {
      if (!username) {
        return res.status(400).json({ error: 'Username is required for registration.' });
      }
      const cleanUsername = username.toLowerCase().trim();
      const existing = await db.getUserByUsername(cleanUsername);
      if (existing) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
    }

    // Verify username existence for password resets
    if (type === 'reset') {
      if (!username) {
        return res.status(400).json({ error: 'Username is required for password resets.' });
      }
      const cleanUsername = username.toLowerCase().trim();
      const user = await db.getUserByUsername(cleanUsername);
      if (!user) {
        return res.status(400).json({ error: 'Username does not exist.' });
      }
    }

    // Generate secure 6-digit OTP code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Cache in-memory with 5-minute expiration
    otpStore.set(cleanEmail, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    // Check if real SMTP credentials are set
    if (emailUser && emailPass) {
      console.log(`[OTP] Sending real verification email to: ${cleanEmail}`);
      
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailUser,
          pass: emailPass
        }
      });

      const actionText = type === 'register' ? 'activate your AetherCall AI account' : 'reset your AetherCall AI password';
      const mailOptions = {
        from: `"AetherCall AI Shield" <${emailUser}>`,
        to: cleanEmail,
        subject: `[AetherCall AI] OTP Verification Code: ${otp}`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background-color: #090b0f; color: #f8fafc; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
            <div style="text-align: center; margin-bottom: 25px;">
              <span style="font-size: 2.5rem; font-weight: bold; background: linear-gradient(135deg, #7c3aed, #4f46e5); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Æ AetherCall AI</span>
            </div>
            <h2 style="font-size: 1.4rem; font-weight: 600; text-align: center; margin-bottom: 10px; color: #fff;">Verify Your Identity</h2>
            <p style="font-size: 0.95rem; line-height: 1.6; color: #94a3b8; text-align: center; margin-bottom: 25px;">
              Use the secure 6-digit OTP code below to ${actionText}. This code will expire in 5 minutes.
            </p>
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 15px 25px; text-align: center; font-size: 2.2rem; font-weight: 700; letter-spacing: 6px; color: #fff; margin-bottom: 25px; font-family: monospace;">
              ${otp}
            </div>
            <p style="font-size: 0.8rem; color: #64748b; text-align: center; margin-top: 25px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 15px;">
              If you did not request this verification, please ignore this email safely.
            </p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true, simulated: false });
    } else {
      // Credentials not set, fall back to Simulated Development Mode
      console.log(`[OTP-MOCK] Simulated SMTP Relay generated OTP: ${otp} for ${cleanEmail}`);
      res.json({
        success: true,
        simulated: true,
        otp
      });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate and dispatch OTP.' });
  }
});

// Verify OTP
app.post('/api/otp/verify', (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const record = otpStore.get(cleanEmail);

    if (!record) {
      return res.status(400).json({ error: 'No active OTP verification session found. Request a new code.' });
    }

    // Check expiration (5 minutes)
    if (Date.now() > record.expiresAt) {
      otpStore.delete(cleanEmail);
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    if (record.otp === otp.trim()) {
      // Clear OTP on successful validation to prevent duplicate submissions/replays
      otpStore.delete(cleanEmail);
      res.json({ success: true, message: 'Identity verified successfully.' });
    } else {
      res.status(400).json({ error: 'Invalid verification code. Try again.' });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during verification.' });
  }
});

// --- AUTHENTICATION API ENDPOINTS ---

// Register standard account
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, fullName } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const existing = await db.getUserByUsername(cleanUsername);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await db.createUser(cleanUsername, passwordHash, fullName);
    res.status(201).json({ message: 'User registered successfully', username: newUser.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// Login and issue HTTP-only JWT Cookie
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const validPass = await bcrypt.compare(password, user.passwordHash);
    if (!validPass) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ username: user.username, fullName: user.fullName }, JWT_SECRET, { expiresIn: '24h' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // Set to true if running over HTTPS
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ message: 'Logged in successfully', username: user.username, fullName: user.fullName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// Authenticate / Register via simulated Google OAuth Payload
app.post('/api/login/google', async (req, res) => {
  try {
    const { email, fullName } = req.body;
    if (!email || !fullName) {
      return res.status(400).json({ error: 'Google authentication details missing.' });
    }

    // Convert Google email to a unique username (e.g. yaswanth@gmail.com -> yaswanth)
    const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if user already exists
    let user = await db.getUserByUsername(username);
    if (!user) {
      // Automatically create a new account in our DB with a random password
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(Math.random().toString(36), salt);
      user = await db.createUser(username, passwordHash, fullName);
      console.log(`[AUTH-GOOGLE] Registered new Google User: ${username} (${email})`);
    } else {
      console.log(`[AUTH-GOOGLE] Authenticated existing Google User: ${username} (${email})`);
    }

    // Issue JWT Session Token
    const token = jwt.sign({ username: user.username, fullName: user.fullName }, JWT_SECRET, { expiresIn: '24h' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({ message: 'Google authentication successful', username: user.username, fullName: user.fullName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during Google authentication.' });
  }
});

// Get current logged-in user profile
app.get('/api/me', authenticateToken, (req, res) => {
  res.json(req.user);
});

// Logout and clear authentication cookie
app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Reset standard account password with secure OTP validation on frontend
app.post('/api/reset-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: 'Username and new password are required.' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const user = await db.getUserByUsername(cleanUsername);
    if (!user) {
      return res.status(400).json({ error: 'Username does not exist.' });
    }

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    const updated = await db.updateUserPassword(cleanUsername, newPasswordHash);
    if (updated) {
      res.json({ message: 'Password updated successfully' });
    } else {
      res.status(500).json({ error: 'Failed to update password in database.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during password reset.' });
  }
});

// --- LINKLESS MEETINGS API ENDPOINTS ---

// Create / Schedule a Linkless Meeting
app.post('/api/meetings', authenticateToken, async (req, res) => {
  try {
    const { title, invitees } = req.body;
    if (!title) return res.status(400).json({ error: 'Meeting title is required.' });

    const host = req.user.username;
    
    // Filter out invalid/empty invitees and ensure the host is not invited twice
    const cleanInvitees = (invitees || [])
      .map(i => i.trim().toLowerCase())
      .filter(i => i && i !== host);

    // Verify all invited usernames exist in our Database
    const invalidUsers = [];
    for (const username of cleanInvitees) {
      const exists = await db.getUserByUsername(username);
      if (!exists) invalidUsers.push(username);
    }

    if (invalidUsers.length > 0) {
      return res.status(400).json({ error: `The following users do not exist: ${invalidUsers.join(', ')}` });
    }

    // Generate random 9-digit UUID/ID like standard meeting IDs: '123-456-789'
    const meetingId = Math.floor(100000000 + Math.random() * 900000000)
      .toString()
      .replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3');

    const newMeeting = await db.createMeeting(meetingId, title, host, cleanInvitees);
    
    // Trigger direct real-time WebSocket invitation popup for online invitees
    for (const invitee of cleanInvitees) {
      const sockets = activeSockets.get(invitee);
      if (sockets && sockets.length > 0) {
        sockets.forEach(sid => {
          io.to(sid).emit('meeting-invite', {
            meetingId,
            title,
            host: req.user.fullName,
            hostUsername: host
          });
        });
      }
    }

    res.status(201).json(newMeeting);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create meeting.' });
  }
});

// Retrieve all meetings associated with authenticated user
app.get('/api/meetings', authenticateToken, async (req, res) => {
  try {
    const list = await db.getUserMeetings(req.user.username);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch meetings.' });
  }
});

// Retrieve details for a specific meeting
app.get('/api/meetings/:id', authenticateToken, async (req, res) => {
  try {
    const meeting = await db.getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    // Enforce linkless security: Only allow Host or registered Invitees to join the call API
    const isHost = meeting.host === req.user.username;
    const isInvited = meeting.invitees.includes(req.user.username);

    if (!isHost && !isInvited) {
      return res.status(403).json({ error: 'Unauthorized. You are not invited to this meeting.' });
    }

    res.json(meeting);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch meeting.' });
  }
});

// Update meeting invitees list (Host only)
app.post('/api/meetings/:id/invitees', authenticateToken, async (req, res) => {
  try {
    const { invitees } = req.body;
    if (!invitees || !Array.isArray(invitees)) {
      return res.status(400).json({ error: 'Invitees list must be an array.' });
    }

    const meeting = await db.getMeeting(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    // Only host is allowed to modify invitees
    if (meeting.host !== req.user.username) {
      return res.status(403).json({ error: 'Unauthorized. Only the host can manage participants.' });
    }

    const host = meeting.host;
    
    // Filter invitees
    const cleanInvitees = invitees
      .map(i => i.trim().toLowerCase())
      .filter(i => i && i !== host);

    // Verify all invited usernames exist in Database
    const invalidUsers = [];
    for (const username of cleanInvitees) {
      const exists = await db.getUserByUsername(username);
      if (!exists) invalidUsers.push(username);
    }

    if (invalidUsers.length > 0) {
      return res.status(400).json({ error: `The following users do not exist: ${invalidUsers.join(', ')}` });
    }

    // Identify newly added invitees to notify them live via WebSockets
    const newlyAdded = cleanInvitees.filter(i => !meeting.invitees.includes(i));

    // Update meeting invitees in DB
    const updatedMeeting = await db.updateMeetingInvitees(req.params.id, cleanInvitees);

    // Notify newly added invitees who are currently online!
    newlyAdded.forEach(invitee => {
      const sockets = activeSockets.get(invitee);
      if (sockets && sockets.length > 0) {
        sockets.forEach(sid => {
          io.to(sid).emit('meeting-invite', {
            meetingId: meeting.id,
            title: meeting.title,
            host: req.user.fullName,
            hostUsername: host
          });
        });
      }
    });

    res.json(updatedMeeting);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update invitees list.' });
  }
});

// Fallback HTML page loading routing (SPA experience support)
app.get('*', (req, res, next) => {
  // If request is for an API endpoint, skip static HTML routing fallback
  if (req.url.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- REAL-TIME WEBSOCKET (SOCKET.IO) SIGNALING & MODERATION ROUTING ---

// In-Memory map to link Usernames to Web Socket ID arrays (supporting multi-tab logins)
const activeSockets = new Map();

// In-Memory registry tracking state of active meetings
// Format: meetingId => { host, title, participants: Map(socketId => { username, focusScore, strikes }) }
const activeRooms = new Map();

io.on('connection', (socket) => {
  let socketUsername = null;
  let activeMeetingId = null;

  // 1. Link active Socket connection with User's logged-in identity
  socket.on('register-user', ({ username }) => {
    if (!username) return;
    socketUsername = username.toLowerCase().trim();
    
    if (!activeSockets.has(socketUsername)) {
      activeSockets.set(socketUsername, []);
    }
    activeSockets.get(socketUsername).push(socket.id);
  });

  // 2. Multi-Peer WebRTC Room Join Router
  socket.on('join-meeting', async ({ meetingId, username }) => {
    if (!meetingId || !username) return;
    username = username.toLowerCase().trim();
    activeMeetingId = meetingId;

    // Fetch details to configure or validate room settings
    const meeting = await db.getMeeting(meetingId);
    if (!meeting) {
      return socket.emit('join-error', 'Meeting does not exist.');
    }

    // Verify authorized linkless entry
    const isHost = meeting.host === username;
    const isInvited = meeting.invitees.includes(username);
    if (!isHost && !isInvited) {
      return socket.emit('join-error', 'You are not authorized or invited to join this room.');
    }

    socket.join(meetingId);

    // Initialize meeting tracker room in-memory if first peer
    if (!activeRooms.has(meetingId)) {
      activeRooms.set(meetingId, {
        host: meeting.host,
        title: meeting.title,
        participants: new Map()
      });
      await db.updateMeetingStatus(meetingId, 'active');
    }

    const room = activeRooms.get(meetingId);
    room.participants.set(socket.id, {
      username,
      focusScore: 100, // Starts fully focused
      strikes: 0      // 0 strikes
    });

    // Notify other peers in room to trigger standard WebRTC signaling connections
    socket.to(meetingId).emit('user-connected', {
      socketId: socket.id,
      username
    });

    // Provide the newly joined client with a list of existing active peers in the room
    const otherPeers = [];
    room.participants.forEach((data, sid) => {
      if (sid !== socket.id) {
        otherPeers.push({
          socketId: sid,
          username: data.username
        });
      }
    });
    socket.emit('lobby-peers', otherPeers);
  });

  // 3. WebRTC Signal Relayer
  socket.on('signal', ({ targetSocketId, signalData }) => {
    // Relays the RTCPeerConnection Offer/Answer/ICE Candidate directly to target peer
    io.to(targetSocketId).emit('signal', {
      senderSocketId: socket.id,
      signalData
    });
  });

  // 4. Real-time Chat Moderation Router
  socket.on('chat-message', ({ text }) => {
    if (!activeMeetingId || !socketUsername) return;
    const room = activeRooms.get(activeMeetingId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    // Run abusive language model checks on text content
    const modResult = moderateContent(text);

    if (modResult.isAbusive) {
      participant.strikes += 1;
      
      // Notify the offender privately
      socket.emit('moderation-warning', {
        strikes: participant.strikes,
        reason: `Abusive phrase detected: "${modResult.matchedWords.join(', ')}"`
      });

      // Log moderation event
      console.log(`[MODERATION] User ${socketUsername} received strike ${participant.strikes}/3 in meeting ${activeMeetingId}`);

      // Broadcast the censored version of the message so the chat isn't disrupted, but mark it flagged
      io.to(activeMeetingId).emit('chat-message', {
        sender: socketUsername,
        text: modResult.cleanedText,
        flagged: true
      });

      // If offender reaches 3 strikes, kick them immediately from the meeting
      if (participant.strikes >= 3) {
        handleKickUser(activeMeetingId, socket.id, socketUsername, 'Exceeded abusive language strike limit (3/3).');
      }
    } else {
      // Clear message: broadcast to entire room
      io.to(activeMeetingId).emit('chat-message', {
        sender: socketUsername,
        text,
        flagged: false
      });
    }
  });

  // 5. Speech-to-Text Moderation Router
  socket.on('speech-transcript', ({ text }) => {
    if (!activeMeetingId || !socketUsername) return;
    const room = activeRooms.get(activeMeetingId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    const modResult = moderateContent(text);

    if (modResult.isAbusive) {
      participant.strikes += 1;

      console.log(`[MODERATION-SPEECH] User ${socketUsername} received strike ${participant.strikes}/3 via Audio in ${activeMeetingId}`);

      socket.emit('moderation-warning', {
        strikes: participant.strikes,
        reason: `Abusive speech phrase spoken: "${modResult.matchedWords.join(', ')}"`
      });

      if (participant.strikes >= 3) {
        handleKickUser(activeMeetingId, socket.id, socketUsername, 'Exceeded abusive verbal language strike limit (3/3).');
      }
    }
  });

  // 6. Focus Scoring Analytics Aggregator
  socket.on('focus-score', ({ score }) => {
    if (!activeMeetingId) return;
    const room = activeRooms.get(activeMeetingId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (!participant) return;

    // Update in-memory score
    participant.focusScore = Math.max(0, Math.min(100, score));

    // Calculate rolling average score of all active participants (excluding host)
    let totalScore = 0;
    let participantCount = 0;

    room.participants.forEach((data, sid) => {
      // Host's personal gaze focus score isn't averaged into student engagement telemetry
      if (data.username !== room.host) {
        totalScore += data.focusScore;
        participantCount++;
      }
    });

    if (participantCount > 0) {
      const averageFocus = Math.round(totalScore / participantCount);

      // Broadcast real-time focus statistical tracking payload to everyone in the room!
      io.to(activeMeetingId).emit('focus-analytics-update', {
        averageFocus,
        participantCount,
        peerScores: Array.from(room.participants.entries()).map(([sid, data]) => ({
          username: data.username,
          score: data.focusScore,
          strikes: data.strikes
        }))
      });
    }
  });

  // Kick logic handler helper
  function handleKickUser(meetingId, targetSocketId, username, reason) {
    console.log(`[KICK] Kicking ${username} from ${meetingId} due to: ${reason}`);
    
    // 1. Force the client to close the WebRTC streams and disconnect
    io.to(targetSocketId).emit('force-kick', { reason });
    
    // 2. Notify other room members of the eviction
    io.to(meetingId).emit('user-disconnected', {
      socketId: targetSocketId,
      username,
      kicked: true,
      reason
    });

    // 3. Clear participant from tracking registry
    const room = activeRooms.get(meetingId);
    if (room) {
      room.participants.delete(targetSocketId);
    }
  }

  // 7. Cleanup on WebSocket Connection Disconnect
  socket.on('disconnect', async () => {
    // A. Remove socket from registered user accounts map
    if (socketUsername && activeSockets.has(socketUsername)) {
      const list = activeSockets.get(socketUsername);
      const filtered = list.filter(sid => sid !== socket.id);
      if (filtered.length === 0) {
        activeSockets.delete(socketUsername);
      } else {
        activeSockets.set(socketUsername, filtered);
      }
    }

    // B. Clean up user from active video call room session
    if (activeMeetingId && activeRooms.has(activeMeetingId)) {
      const room = activeRooms.get(activeMeetingId);
      room.participants.delete(socket.id);

      socket.to(activeMeetingId).emit('user-disconnected', {
        socketId: socket.id,
        username: socketUsername
      });

      // If room is empty, flag database status and prune memory registry
      if (room.participants.size === 0) {
        await db.updateMeetingStatus(activeMeetingId, 'ended');
        activeRooms.delete(activeMeetingId);
        console.log(`[MEETING] Meeting ${activeMeetingId} closed and marked ended.`);
      }
    }
  });
});

// Run server
httpServer.listen(PORT, () => {
  console.log(`🚀 AI Video Conferencing Server running on http://localhost:${PORT}`);
});
