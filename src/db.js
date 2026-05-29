import mongoose from 'mongoose';

// Connect to local MongoDB instance
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-video-conference';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('🚀 Successfully connected to MongoDB database.'))
  .catch((err) => console.error('❌ MongoDB database connection error:', err));

// User Schema & Model
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, lowercase: true, trim: true, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Meeting Schema & Model
const meetingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true, trim: true },
  host: { type: String, required: true, lowercase: true, trim: true },
  invitees: [{ type: String, lowercase: true, trim: true }],
  status: { type: String, enum: ['scheduled', 'active', 'ended'], default: 'scheduled' },
  createdAt: { type: Date, default: Date.now }
});

const Meeting = mongoose.model('Meeting', meetingSchema);

// Query user by username (case-insensitive)
export async function getUserByUsername(username) {
  if (!username) return null;
  return await User.findOne({ username: username.toLowerCase().trim() }).lean();
}

// Create new user account
export async function createUser(username, passwordHash, fullName, email) {
  const newUser = new User({
    username: username.toLowerCase().trim(),
    passwordHash,
    fullName: fullName.trim(),
    email: email ? email.toLowerCase().trim() : ''
  });
  const saved = await newUser.save();
  return saved.toObject();
}

// Create scheduled linkless meeting record
export async function createMeeting(id, title, host, invitees) {
  const newMeeting = new Meeting({
    id,
    title: title.trim(),
    host: host.toLowerCase().trim(),
    invitees: invitees.map(i => i.toLowerCase().trim())
  });
  const saved = await newMeeting.save();
  return saved.toObject();
}

// Fetch single meeting detail
export async function getMeeting(id) {
  if (!id) return null;
  return await Meeting.findOne({ id }).lean();
}

// Update meeting state
export async function updateMeetingStatus(id, status) {
  return await Meeting.findOneAndUpdate(
    { id },
    { $set: { status } },
    { new: true }
  ).lean();
}

// Get all meetings a user is associated with (either hosting or invited to)
export async function getUserMeetings(username) {
  const lowerUser = username.toLowerCase().trim();
  return await Meeting.find({
    $or: [
      { host: lowerUser },
      { invitees: lowerUser }
    ]
  }).lean();
}

// Update a user's password
export async function updateUserPassword(username, newPasswordHash) {
  const result = await User.updateOne(
    { username: username.toLowerCase().trim() },
    { $set: { passwordHash: newPasswordHash } }
  );
  return result.modifiedCount > 0;
}

// Update meeting invitees list
export async function updateMeetingInvitees(id, invitees) {
  const cleanInvitees = invitees.map(i => i.toLowerCase().trim());
  return await Meeting.findOneAndUpdate(
    { id },
    { $set: { invitees: cleanInvitees } },
    { new: true }
  ).lean();
}
