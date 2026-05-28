import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

// Helper to ensure database folder exists
async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Read database contents
async function readDB() {
  try {
    await ensureDir(DB_PATH);
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    const initial = { users: [], meetings: [] };
    await fs.writeFile(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

// Write database contents atomically
async function writeDB(data) {
  await ensureDir(DB_PATH);
  const tempPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempPath, DB_PATH);
}

// Query user by username (case-insensitive)
export async function getUserByUsername(username) {
  if (!username) return null;
  const db = await readDB();
  return db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

// Create new user account
export async function createUser(username, passwordHash, fullName, email) {
  const db = await readDB();
  const newUser = {
    username: username.toLowerCase().trim(),
    passwordHash,
    fullName: fullName.trim(),
    email: email ? email.toLowerCase().trim() : '',
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  await writeDB(db);
  return newUser;
}

// Create scheduled linkless meeting record
export async function createMeeting(id, title, host, invitees) {
  const db = await readDB();
  const newMeeting = {
    id,
    title: title.trim(),
    host: host.toLowerCase().trim(),
    invitees: invitees.map(i => i.toLowerCase().trim()),
    createdAt: new Date().toISOString(),
    status: 'scheduled' // 'scheduled', 'active', 'ended'
  };
  db.meetings.push(newMeeting);
  await writeDB(db);
  return newMeeting;
}

// Fetch single meeting detail
export async function getMeeting(id) {
  const db = await readDB();
  return db.meetings.find(m => m.id === id);
}

// Update meeting state
export async function updateMeetingStatus(id, status) {
  const db = await readDB();
  const meeting = db.meetings.find(m => m.id === id);
  if (meeting) {
    meeting.status = status;
    await writeDB(db);
  }
  return meeting;
}

// Get all meetings a user is associated with (either hosting or invited to)
export async function getUserMeetings(username) {
  const db = await readDB();
  const lowerUser = username.toLowerCase().trim();
  return db.meetings.filter(m => m.host === lowerUser || m.invitees.includes(lowerUser));
}

// Update a user's password
export async function updateUserPassword(username, newPasswordHash) {
  const db = await readDB();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  if (user) {
    user.passwordHash = newPasswordHash;
    await writeDB(db);
    return true;
  }
  return false;
}

// Update meeting invitees list
export async function updateMeetingInvitees(id, invitees) {
  const db = await readDB();
  const meeting = db.meetings.find(m => m.id === id);
  if (meeting) {
    meeting.invitees = invitees.map(i => i.toLowerCase().trim());
    await writeDB(db);
    return meeting;
  }
  return null;
}
