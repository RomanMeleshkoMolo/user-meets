const mongoose = require('mongoose');
const User = require('../models/userModel');
const Seen = require('../models/seenModel');

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'eu-central-1';
const BUCKET = process.env.S3_BUCKET || 'molo-user-photos';
const PRESIGNED_TTL_SEC = Number(process.env.S3_GET_TTL_SEC || 3600);

const s3 = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// Получить userId из запроса
function getReqUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    req.auth?.userId ||
    req.regUserId ||
    req.userId
  );
}

// Генерация presigned URL для S3
async function getGetObjectUrl(key, expiresInSec = PRESIGNED_TTL_SEC) {
  if (!key) return null;
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

// Преобразование пользователя в формат для отправки
function toMeetUser(user) {
  return {
    _id: user._id,
    id: user._id,
    name: user.name,
    age: user.age,
    gender: user.gender,
    interests: user.interests || null,
    userLocation: user.userLocation,
    userPhoto: user.userPhoto || [],
    wishUser: user.wishUser,
    userSex: user.userSex,
    isOnline: user.isOnline || false,
    lastSeen: user.lastSeen || null,
  };
}

// Добавить presigned URLs к фотографиям
async function enrichUserWithPhotos(user) {
  const meetUser = toMeetUser(user);

  if (meetUser.userPhoto && meetUser.userPhoto.length > 0) {
    const approvedPhotos = meetUser.userPhoto.filter(
      (p) => !p.status || p.status === 'approved'
    );

    meetUser.photoUrls = await Promise.all(
      approvedPhotos.map(async (photo) => {
        if (photo && typeof photo === 'object' && photo.key) {
          return await getGetObjectUrl(photo.key);
        }
        if (typeof photo === 'string' && photo.length > 0) {
          if (photo.startsWith('http')) {
            return photo;
          }
          return await getGetObjectUrl(photo);
        }
        return null;
      })
    );
    meetUser.photoUrls = meetUser.photoUrls.filter(Boolean);
  } else {
    meetUser.photoUrls = [];
  }

  return meetUser;
}

/**
 * GET /meets - Получить пользователей для свайпа (не просмотренных)
 */
async function getMeets(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    // Получаем текущего пользователя
    const currentUser = await User.findById(userObjectId).lean();
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Получаем ID просмотренных пользователей
    const seenUsers = await Seen.find({ userId: userObjectId })
      .select('seenUserId')
      .lean();
    const seenUserIds = seenUsers.map(s => s.seenUserId);

    // Строим фильтр
    const filter = {
      _id: {
        $ne: userObjectId,
        $nin: seenUserIds,
      },
    };

    // Фильтр по предпочтениям (опционально)
    // if (currentUser.wishUser && currentUser.wishUser !== 'all') {
    //   filter['gender.id'] = currentUser.wishUser;
    // }

    // Получаем пользователей
    const users = await User.find(filter)
      .limit(limit)
      .lean();

    // Обогащаем фотографиями
    const enrichedUsers = await Promise.all(
      users.map(enrichUserWithPhotos)
    );

    console.log(`[meets] getMeets for user ${userId}: found ${enrichedUsers.length}`);

    return res.json({ users: enrichedUsers });
  } catch (e) {
    console.error('[meets] getMeets error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /meets/:userId - Получить профиль конкретного пользователя
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
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const enrichedUser = await enrichUserWithPhotos(user);

    return res.json({ user: enrichedUser });
  } catch (e) {
    console.error('[meets] getUserProfile error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /meets/:userId/pass - Пропустить пользователя
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
    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    // Сохраняем пропуск
    await Seen.findOneAndUpdate(
      { userId: currentUserObjectId, seenUserId: targetUserObjectId },
      {
        userId: currentUserObjectId,
        seenUserId: targetUserObjectId,
        action: 'pass',
        createdAt: new Date(),
      },
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
 * POST /meets/:userId/view - Отметить просмотр пользователя
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
    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    // Сохраняем просмотр (не перезаписываем если уже есть like/pass)
    await Seen.findOneAndUpdate(
      { userId: currentUserObjectId, seenUserId: targetUserObjectId },
      {
        $setOnInsert: {
          userId: currentUserObjectId,
          seenUserId: targetUserObjectId,
          action: 'view',
          createdAt: new Date(),
        }
      },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (e) {
    console.error('[meets] markViewed error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * DELETE /meets/history - Сбросить историю просмотров (для тестирования)
 */
async function resetHistory(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    await Seen.deleteMany({ userId: userObjectId });

    console.log(`[meets] History reset for user ${userId}`);

    return res.json({ success: true });
  } catch (e) {
    console.error('[meets] resetHistory error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getMeets,
  getUserProfile,
  passUser,
  markViewed,
  resetHistory,
};
