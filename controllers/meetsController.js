const mongoose = require('mongoose');
const User = require('../models/userModel');
const Seen = require('../models/seenModel');
const Like = require('../models/likeModel');

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { buildLocationPattern } = require('../src/locationParser');

const REGION = process.env.AWS_REGION || 'eu-central-1';
const BUCKET = process.env.S3_BUCKET || 'molo-user-photos';
const PRESIGNED_TTL_SEC = Number(process.env.S3_GET_TTL_SEC || 3600);

const s3 = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined,
});

// Seen records older than this are ignored (shown again)
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getReqUserId(req) {
  return req.user?._id || req.user?.id || req.auth?.userId || req.regUserId || req.userId;
}

async function getGetObjectUrl(key, expiresInSec = PRESIGNED_TTL_SEC) {
  if (!key) return null;
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

function toMeetUser(user) {
  return {
    _id:          user._id,
    id:           user._id,
    name:         user.name,
    age:          user.age,
    gender:       user.gender,
    interests:    user.interests || null,
    userLocation: user.userLocation,
    userPhoto:    user.userPhoto || [],
    wishUser:     user.wishUser,
    userSex:      user.userSex,
    isOnline:     user.isOnline || false,
    lastSeen:     user.lastSeen || null,
    about:        user.about || null,
    work:         user.work || null,
    education:    user.education || null,
    lookingFor:   user.lookingFor || null,
    zodiac:       user.zodiac || null,
    languages:    user.languages || [],
  };
}

async function enrichUserWithPhotos(user) {
  const meetUser = toMeetUser(user);
  if (meetUser.userPhoto?.length > 0) {
    const approved = meetUser.userPhoto.filter(p => !p.status || p.status === 'approved');
    meetUser.photoUrls = (await Promise.all(approved.map(async (photo) => {
      if (photo?.key) return getGetObjectUrl(photo.key);
      if (photo?.url?.startsWith('http')) return photo.url;
      if (typeof photo === 'string') return photo.startsWith('http') ? photo : getGetObjectUrl(photo);
      return null;
    }))).filter(Boolean);
  } else {
    meetUser.photoUrls = [];
  }
  return meetUser;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
// Points breakdown:
//   +100  user liked me (pending like from them)
//   +40   online right now
//   +20   last seen < 1 hour ago
//   +10   last seen < 24 hours ago
//   +3    last seen < 7 days ago
//   0–20  profile completeness
function scoreUser(user, likedMeSet) {
  let score = 0;

  if (likedMeSet.has(String(user._id))) score += 100;

  if (user.isOnline) {
    score += 40;
  } else if (user.lastSeen) {
    const ageMs = Date.now() - new Date(user.lastSeen).getTime();
    if      (ageMs < 3_600_000)    score += 20;
    else if (ageMs < 86_400_000)   score += 10;
    else if (ageMs < 604_800_000)  score += 3;
  }

  // Profile completeness (max 20 pts)
  let cp = 0;
  const approved = (user.userPhoto || []).filter(p => !p.status || p.status === 'approved');
  if (approved.length >= 1) cp += 5;
  if (approved.length >= 3) cp += 3;
  if (user.about)              cp += 4;
  if (user.work)               cp += 2;
  if (user.education)          cp += 2;
  if ((user.interests?.length || 0) >= 2) cp += 2;
  if (user.lookingFor?.id)     cp += 2;
  score += Math.min(20, cp);

  return score;
}

/**
 * GET /meets
 */
async function getMeets(req, res) {
  try {
    const userId = getReqUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    const currentUser = await User.findById(userObjectId).lean();
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    // 1. Seen IDs (last 30 days only — old entries auto-expire and don't block)
    const seenCutoff = new Date(Date.now() - SEEN_TTL_MS);
    const seenDocs = await Seen.find({ userId: userObjectId, createdAt: { $gte: seenCutoff } })
      .select('seenUserId').lean();
    const seenIds = seenDocs.map(s => s.seenUserId);

    // 2. Who liked me (pending likes) — for boosting in ranking
    let likedMeSet = new Set();
    try {
      const likesForMe = await Like.find({ toUser: userObjectId, status: 'pending' })
        .select('fromUser').lean();
      likesForMe.forEach(l => likedMeSet.add(String(l.fromUser)));
    } catch (e) {
      console.warn('[meets] Could not fetch likes:', e.message);
    }

    // 3. Build filter
    const filter = {
      _id: { $ne: userObjectId, $nin: seenIds },
      onboardingComplete: true,
    };

    const q = req.query;
    if (q.lookingFor && q.lookingFor !== 'any') filter['gender.id'] = q.lookingFor;
    if (q.ageMin || q.ageMax) {
      filter.age = {};
      if (q.ageMin) filter.age.$gte = Number(q.ageMin);
      if (q.ageMax) filter.age.$lte = Number(q.ageMax);
    }
    if (q.online === 'true') filter.isOnline = true;
    if (q.orientation) filter.userSex = q.orientation;
    if (q.goals) {
      const goals = q.goals.split(',').filter(Boolean);
      if (goals.length) filter['lookingFor.id'] = { $in: goals };
    }
    if (q.zodiac) filter.zodiac = q.zodiac;
    if (q.languages) {
      const langs = q.languages.split(',').filter(Boolean);
      if (langs.length) filter.languages = { $in: langs };
    }
    if (q.children)      filter.children = q.children;
    if (q.pets) {
      const pets = q.pets.split(',').filter(Boolean);
      if (pets.length) filter.pets = { $in: pets };
    }
    if (q.smoking)       filter.smoking = q.smoking;
    if (q.alcohol)       filter.alcohol = q.alcohol;
    if (q.relationship)  filter.relationship = q.relationship;
    if (q.education)     filter.education = q.education;
    if (q.interests) {
      const ints = q.interests.split(',').filter(Boolean);
      if (ints.length) filter.interests = { $in: ints };
    }

    const expansionLevel = parseInt(q.expansionLevel) || 0;
    if (q.location) {
      const pattern = buildLocationPattern(q.location, expansionLevel);
      if (pattern) filter.userLocation = { $regex: pattern, $options: 'i' };
    }

    // 4. Fetch a larger pool to score and rank
    const poolSize = Math.min(80, limit * 4);
    const rawUsers = await User.find(filter).limit(poolSize).lean();

    // 5. Score, sort descending
    const scored = rawUsers.map(u => ({ user: u, score: scoreUser(u, likedMeSet) }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit).map(s => s.user);

    // 6. Enrich with photo URLs
    const enrichedUsers = await Promise.all(top.map(enrichUserWithPhotos));

    console.log(
      `[meets] getMeets user=${userId} pool=${rawUsers.length} returned=${enrichedUsers.length} ` +
      `likedMe=${likedMeSet.size} expansionLevel=${expansionLevel}`
    );

    return res.json({ users: enrichedUsers, expansionLevel });
  } catch (e) {
    console.error('[meets] getMeets error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /meets/:userId
 */
async function getUserProfile(req, res) {
  try {
    const currentUserId = getReqUserId(req);
    const { userId } = req.params;

    if (!currentUserId || !mongoose.Types.ObjectId.isValid(String(currentUserId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ user: await enrichUserWithPhotos(user) });
  } catch (e) {
    console.error('[meets] getUserProfile error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /meets/:userId/pass
 */
async function passUser(req, res) {
  try {
    const currentUserId = getReqUserId(req);
    const { userId: targetUserId } = req.params;

    if (!currentUserId || !mongoose.Types.ObjectId.isValid(String(currentUserId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(String(targetUserId))) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
    const targetUserObjectId  = new mongoose.Types.ObjectId(targetUserId);

    await Seen.findOneAndUpdate(
      { userId: currentUserObjectId, seenUserId: targetUserObjectId },
      { userId: currentUserObjectId, seenUserId: targetUserObjectId, action: 'pass', createdAt: new Date() },
      { upsert: true }
    );

    console.log(`[meets] User ${currentUserId} passed user ${targetUserId}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[meets] passUser error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /meets/:userId/view
 */
async function markViewed(req, res) {
  try {
    const currentUserId = getReqUserId(req);
    const { userId: targetUserId } = req.params;

    if (!currentUserId || !mongoose.Types.ObjectId.isValid(String(currentUserId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(String(targetUserId))) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
    const targetUserObjectId  = new mongoose.Types.ObjectId(targetUserId);

    await Seen.findOneAndUpdate(
      { userId: currentUserObjectId, seenUserId: targetUserObjectId },
      { $setOnInsert: { userId: currentUserObjectId, seenUserId: targetUserObjectId, action: 'view', createdAt: new Date() } },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (e) {
    console.error('[meets] markViewed error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * DELETE /meets/history
 */
async function resetHistory(req, res) {
  try {
    const userId = getReqUserId(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    await Seen.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
    console.log(`[meets] History reset for user ${userId}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[meets] resetHistory error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { getMeets, getUserProfile, passUser, markViewed, resetHistory };
