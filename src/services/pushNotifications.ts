import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';

/**
 * Push notification payload.
 */
interface PushPayload {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
}

/**
 * APNs HTTP/2 push notification response.
 */
interface APNsResponse {
  success: boolean;
  statusCode: number;
  reason?: string;
}

/**
 * Sends a push notification via Apple Push Notification service (APNs) using HTTP/2.
 *
 * Requires the following environment variables:
 * - APNS_KEY_ID: The key ID from Apple Developer
 * - APNS_TEAM_ID: The team ID from Apple Developer
 * - APNS_BUNDLE_ID: The app bundle identifier
 * - APNS_AUTH_KEY: The .p8 private key contents (base64 encoded)
 */
async function sendAPNsNotification(payload: PushPayload): Promise<APNsResponse> {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const authKey = process.env.APNS_AUTH_KEY;

  if (!keyId || !teamId || !bundleId || !authKey) {
    logger.warn('APNs not configured — skipping push notification');
    return { success: false, statusCode: 0, reason: 'APNs not configured' };
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const host = isProduction
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';

  const url = `${host}/3/device/${payload.deviceToken}`;

  const apnsPayload = {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      sound: 'default',
      ...(payload.badge !== undefined && { badge: payload.badge }),
    },
    ...(payload.data && { custom: payload.data }),
  };

  try {
    // Generate JWT for APNs authentication
    const jwt = await generateAPNsJWT(keyId, teamId, authKey);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify(apnsPayload),
    });

    if (response.status === 200) {
      return { success: true, statusCode: 200 };
    }

    const errorBody = await response.json().catch(() => ({})) as Record<string, string>;
    const reason = errorBody.reason ?? 'Unknown error';

    return { success: false, statusCode: response.status, reason };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err: message }, 'APNs request failed');
    return { success: false, statusCode: 0, reason: message };
  }
}

/**
 * Generates a JWT token for APNs authentication.
 * Uses ES256 signing with the Apple-provided .p8 key.
 */
async function generateAPNsJWT(
  keyId: string,
  teamId: string,
  authKeyBase64: string
): Promise<string> {
  const header = {
    alg: 'ES256',
    kid: keyId,
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: teamId,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  // Import the private key and sign
  const keyData = Buffer.from(authKeyBase64, 'base64');
  const pemString = keyData.toString('utf8');
  const pemBody = pemString
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBuffer = Buffer.from(pemBody, 'base64');

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  // Convert DER signature to raw r||s format for JWT
  const rawSignature = derToRaw(new Uint8Array(signature));
  const encodedSignature = base64UrlEncode(Buffer.from(rawSignature).toString('binary'));

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Converts a DER-encoded ECDSA signature to raw r||s format.
 */
function derToRaw(der: Uint8Array): Uint8Array {
  // If it's already 64 bytes, assume it's already raw format
  if (der.length === 64) return der;

  const raw = new Uint8Array(64);

  // DER format: 0x30 <len> 0x02 <r_len> <r> 0x02 <s_len> <s>
  let offset = 2; // skip 0x30 and total length
  if (der[0] !== 0x30) return der; // not DER, return as-is

  // R value
  offset++; // skip 0x02
  const rLen = der[offset++]!;
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;

  // S value
  offset++; // skip 0x02
  const sLen = der[offset++]!;
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);

  return raw;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'binary')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Removes an invalid device token from the database.
 */
async function removeInvalidToken(token: string): Promise<void> {
  try {
    await supabaseAdmin.from('device_tokens').delete().eq('token', token);
    logger.info({ token }, 'Removed invalid device token');
  } catch (err) {
    logger.error({ err, token }, 'Failed to remove invalid device token');
  }
}

/**
 * Sends a push notification to a specific user across all their registered devices.
 * Handles token invalidation automatically.
 */
/**
 * Notification type used to check user preferences before sending.
 */
export type NotificationType = 'likes' | 'comments' | 'friend_requests' | 'new_posts';

/**
 * Check whether a user has enabled a specific notification type.
 * Returns true if preferences are not set (defaults to enabled).
 */
async function isNotificationEnabled(
  userId: string,
  notificationType?: NotificationType
): Promise<boolean> {
  if (!notificationType) return true; // No type specified, always send

  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', userId)
      .single();

    if (!profile?.notification_preferences) return true; // No preferences set, default to enabled

    const prefs = profile.notification_preferences as Record<string, boolean>;
    return prefs[notificationType] !== false; // Default to true if not explicitly set to false
  } catch {
    return true; // On error, default to sending
  }
}

export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  badge?: number,
  notificationType?: NotificationType
): Promise<void> {
  try {
    // Check notification preferences before sending
    if (notificationType) {
      const enabled = await isNotificationEnabled(userId, notificationType);
      if (!enabled) {
        logger.info({ userId, notificationType }, 'Push notification skipped — disabled by user preferences');
        return;
      }
    }

    const { data: tokens, error } = await supabaseAdmin
      .from('device_tokens')
      .select('token, platform')
      .eq('user_id', userId);

    if (error || !tokens || tokens.length === 0) {
      return; // No tokens registered — nothing to do
    }

    const results = await Promise.allSettled(
      tokens.map(async (tokenRecord) => {
        if (tokenRecord.platform === 'ios') {
          const result = await sendAPNsNotification({
            deviceToken: tokenRecord.token,
            title,
            body,
            data,
            badge,
          });

          // Handle invalid tokens — APNs returns 410 for unregistered devices
          if (
            !result.success &&
            (result.statusCode === 410 ||
              result.reason === 'BadDeviceToken' ||
              result.reason === 'Unregistered')
          ) {
            await removeInvalidToken(tokenRecord.token);
          }

          return result;
        }
        // Android/other platforms can be added here in the future
        return { success: false, statusCode: 0, reason: 'Unsupported platform' };
      })
    );

    const failures = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)
    );

    if (failures.length > 0 && failures.length === results.length) {
      logger.warn({ userId }, 'All push notifications failed for user');
    }
  } catch (err) {
    // Push notifications should never break the app
    logger.error({ err, userId }, 'Failed to send push notification');
  }
}

/**
 * Sends push notifications to multiple users at once.
 * Skips users who have blocked the sender.
 */
export async function sendPushNotificationToMany(
  userIds: string[],
  senderId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    // Get users who have blocked the sender (check both friendships and user_blocks)
    const { data: blocks } = await supabaseAdmin
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'blocked')
      .or(`requester_id.eq.${senderId},addressee_id.eq.${senderId}`);

    const blockedByIds = new Set<string>();
    for (const block of blocks ?? []) {
      // Only exclude if the OTHER user blocked the sender
      if (block.addressee_id === senderId) {
        blockedByIds.add(block.requester_id);
      }
      if (block.requester_id === senderId) {
        blockedByIds.add(block.addressee_id);
      }
    }

    // Also check user_blocks table
    const { data: userBlocks } = await supabaseAdmin
      .from('user_blocks')
      .select('blocker_id')
      .eq('blocked_id', senderId);

    for (const ub of userBlocks ?? []) {
      blockedByIds.add(ub.blocker_id);
    }

    const eligibleUserIds = userIds.filter((id) => !blockedByIds.has(id));

    await Promise.allSettled(
      eligibleUserIds.map((userId) =>
        sendPushNotification(userId, title, body, data)
      )
    );
  } catch (err) {
    logger.error({ err, userCount: userIds.length }, 'Failed to send batch push notifications');
  }
}
