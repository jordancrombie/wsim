/**
 * Push Notification Service
 *
 * Handles sending push notifications to mwsim mobile app users.
 * Uses direct APNs for iOS (per AD6 architecture revision).
 *
 * Flow: TransferSim webhook → WSIM notification service → APNs/FCM → mwsim
 */

import apn from '@parse/node-apn';
import { prisma } from '../config/database';

// =============================================================================
// APNs CONFIGURATION
// =============================================================================

/**
 * APNs configuration from environment variables
 * For development, we provide sensible defaults that will be overridden in production
 */
const apnsConfig = {
  keyId: process.env.APNS_KEY_ID || '',
  teamId: process.env.APNS_TEAM_ID || '',
  keyPath: process.env.APNS_KEY_PATH || '',
  bundleId: process.env.APNS_BUNDLE_ID || 'com.banksim.mwsim',
  production: process.env.APNS_PRODUCTION === 'true',
};

/**
 * Lazy-initialized APNs provider
 * Only created when actually sending notifications
 */
let apnProvider: apn.Provider | null = null;

function getApnProvider(): apn.Provider | null {
  if (apnProvider) {
    return apnProvider;
  }

  // Check if APNs is configured
  if (!apnsConfig.keyId || !apnsConfig.teamId || !apnsConfig.keyPath) {
    console.warn('[Notification] APNs not configured - push notifications disabled');
    console.warn('[Notification] Set APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH to enable');
    return null;
  }

  try {
    apnProvider = new apn.Provider({
      token: {
        key: apnsConfig.keyPath,
        keyId: apnsConfig.keyId,
        teamId: apnsConfig.teamId,
      },
      production: apnsConfig.production,
    });
    console.log(`[Notification] APNs provider initialized (production=${apnsConfig.production})`);
    return apnProvider;
  } catch (error) {
    console.error('[Notification] Failed to initialize APNs provider:', error);
    return null;
  }
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Notification types for categorization and logging
 */
export type NotificationType =
  | 'transfer.received'
  | 'transfer.sent'
  | 'payment.approved'
  | 'payment.completed'
  | 'auth.challenge'
  | 'system.announcement';

/**
 * Notification payload for sending to devices
 */
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string; // Android notification channel
}

/**
 * Result of sending notifications
 */
export interface NotificationResult {
  success: boolean;
  totalDevices: number;
  successCount: number;
  failureCount: number;
  tickets: ApnsSendResult[];
  errors: Array<{ deviceId: string; error: string }>;
}

/**
 * Individual APNs send result
 */
interface ApnsSendResult {
  device: string;
  status: 'ok' | 'error';
  error?: string;
}

// =============================================================================
// NOTIFICATION FUNCTIONS
// =============================================================================

/**
 * Send push notification to all active devices for a user.
 * Per AD3: Notify all registered devices for the user.
 *
 * @param userId - WSIM user ID
 * @param notificationType - Type of notification for logging
 * @param payload - Notification content
 * @param sourceId - Optional source ID for idempotency (e.g., transferId)
 */
export async function sendNotificationToUser(
  userId: string,
  notificationType: NotificationType,
  payload: NotificationPayload,
  sourceId?: string
): Promise<NotificationResult> {
  // Check for duplicate notification (idempotency)
  if (sourceId) {
    const existing = await prisma.notificationLog.findFirst({
      where: {
        sourceId,
        notificationType,
        status: { in: ['sent', 'delivered'] },
      },
    });

    if (existing) {
      console.log(`[Notification] Duplicate detected for sourceId=${sourceId}, skipping`);
      return {
        success: true,
        totalDevices: 0,
        successCount: 0,
        failureCount: 0,
        tickets: [],
        errors: [],
      };
    }
  }

  // Get all active devices with push tokens for this user
  const devices = await prisma.mobileDevice.findMany({
    where: {
      userId,
      pushTokenActive: true,
      pushToken: { not: null },
    },
    select: {
      id: true,
      deviceId: true,
      pushToken: true,
      pushTokenType: true,
      deviceName: true,
    },
  });

  if (devices.length === 0) {
    console.log(`[Notification] No active devices for user=${userId}`);

    // Log the notification attempt
    await prisma.notificationLog.create({
      data: {
        userId,
        notificationType,
        title: payload.title,
        body: payload.body,
        data: payload.data as object | undefined,
        status: 'failed',
        errorMessage: 'No active devices with push tokens',
        sourceType: 'webhook',
        sourceId,
      },
    });

    return {
      success: false,
      totalDevices: 0,
      successCount: 0,
      failureCount: 0,
      tickets: [],
      errors: [{ deviceId: 'none', error: 'No active devices' }],
    };
  }

  // Group devices by token type
  const apnsDevices = devices.filter(d => d.pushTokenType === 'apns');
  const fcmDevices = devices.filter(d => d.pushTokenType === 'fcm');
  const expoDevices = devices.filter(d => d.pushTokenType === 'expo');

  const allResults: ApnsSendResult[] = [];
  const allErrors: Array<{ deviceId: string; error: string }> = [];

  // Send to APNs devices (iOS)
  if (apnsDevices.length > 0) {
    const results = await sendApnsNotifications(apnsDevices, payload);
    allResults.push(...results.tickets);
    allErrors.push(...results.errors);
  }

  // FCM devices (Android) - not yet implemented
  if (fcmDevices.length > 0) {
    console.log(`[Notification] FCM not yet implemented, skipping ${fcmDevices.length} Android devices`);
    for (const device of fcmDevices) {
      allErrors.push({ deviceId: device.deviceId, error: 'FCM not yet implemented' });
    }
  }

  // Expo tokens - no longer supported
  if (expoDevices.length > 0) {
    console.log(`[Notification] Expo tokens deprecated, skipping ${expoDevices.length} devices`);
    for (const device of expoDevices) {
      allErrors.push({ deviceId: device.deviceId, error: 'Expo tokens no longer supported - please re-register' });
    }
  }

  const successCount = allResults.filter(r => r.status === 'ok').length;
  const failureCount = allResults.filter(r => r.status === 'error').length + allErrors.length;

  // Log the notification
  await prisma.notificationLog.create({
    data: {
      userId,
      notificationType,
      title: payload.title,
      body: payload.body,
      data: payload.data as object | undefined,
      status: failureCount === devices.length ? 'failed' : 'sent',
      errorMessage: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
      sourceType: 'webhook',
      sourceId,
      sentAt: new Date(),
    },
  });

  console.log(
    `[Notification] Sent to user=${userId}: ${successCount}/${devices.length} devices successful`
  );

  return {
    success: successCount > 0,
    totalDevices: devices.length,
    successCount,
    failureCount,
    tickets: allResults,
    errors: allErrors,
  };
}

/**
 * Send APNs notifications to iOS devices
 */
async function sendApnsNotifications(
  devices: Array<{ deviceId: string; pushToken: string | null; pushTokenType: string | null }>,
  payload: NotificationPayload
): Promise<{ tickets: ApnsSendResult[]; errors: Array<{ deviceId: string; error: string }> }> {
  const provider = getApnProvider();
  const tickets: ApnsSendResult[] = [];
  const errors: Array<{ deviceId: string; error: string }> = [];

  if (!provider) {
    // APNs not configured
    for (const device of devices) {
      errors.push({ deviceId: device.deviceId, error: 'APNs not configured' });
    }
    return { tickets, errors };
  }

  for (const device of devices) {
    if (!device.pushToken) {
      errors.push({ deviceId: device.deviceId, error: 'No push token' });
      continue;
    }

    try {
      // Build APNs notification
      const notification = new apn.Notification();
      notification.alert = {
        title: payload.title,
        body: payload.body,
      };
      // Only set sound if not explicitly silenced
      if (payload.sound !== null) {
        notification.sound = 'default';
      }
      notification.badge = payload.badge ?? 1;
      notification.topic = apnsConfig.bundleId;
      notification.priority = payload.priority === 'high' ? 10 : 5;

      // Add custom data payload
      if (payload.data) {
        notification.payload = payload.data;
      }

      // Send to device
      const result = await provider.send(notification, device.pushToken);

      if (result.failed.length > 0) {
        const failure = result.failed[0];
        const errorReason = failure.response?.reason || 'Unknown error';

        tickets.push({
          device: device.deviceId,
          status: 'error',
          error: errorReason,
        });
        errors.push({ deviceId: device.deviceId, error: errorReason });

        // Handle specific error codes
        if (errorReason === 'BadDeviceToken' || errorReason === 'Unregistered') {
          // Mark device token as inactive
          await prisma.mobileDevice.updateMany({
            where: { deviceId: device.deviceId },
            data: { pushTokenActive: false },
          });
          console.log(`[Notification] Deactivated token for unregistered device=${device.deviceId}`);
        }
      } else {
        tickets.push({
          device: device.deviceId,
          status: 'ok',
        });
      }
    } catch (error) {
      console.error(`[Notification] APNs error for device=${device.deviceId}:`, error);
      tickets.push({
        device: device.deviceId,
        status: 'error',
        error: String(error),
      });
      errors.push({ deviceId: device.deviceId, error: String(error) });
    }
  }

  return { tickets, errors };
}

/**
 * Send notification to a specific device
 */
export async function sendNotificationToDevice(
  deviceId: string,
  notificationType: NotificationType,
  payload: NotificationPayload,
  sourceId?: string
): Promise<NotificationResult> {
  const device = await prisma.mobileDevice.findUnique({
    where: { deviceId },
    select: {
      id: true,
      deviceId: true,
      userId: true,
      pushToken: true,
      pushTokenType: true,
      pushTokenActive: true,
    },
  });

  if (!device || !device.pushToken || !device.pushTokenActive) {
    console.log(`[Notification] Device not found or inactive: ${deviceId}`);
    return {
      success: false,
      totalDevices: 0,
      successCount: 0,
      failureCount: 1,
      tickets: [],
      errors: [{ deviceId, error: 'Device not found or inactive' }],
    };
  }

  // Check token type
  if (device.pushTokenType === 'apns') {
    const result = await sendApnsNotifications([device], payload);
    const success = result.tickets.some(t => t.status === 'ok');

    // Log the notification
    await prisma.notificationLog.create({
      data: {
        userId: device.userId,
        deviceId,
        notificationType,
        title: payload.title,
        body: payload.body,
        data: payload.data as object | undefined,
        status: success ? 'sent' : 'failed',
        errorMessage: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
        sourceType: 'webhook',
        sourceId,
        sentAt: new Date(),
      },
    });

    return {
      success,
      totalDevices: 1,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      tickets: result.tickets,
      errors: result.errors,
    };
  } else if (device.pushTokenType === 'fcm') {
    console.log(`[Notification] FCM not yet implemented for device=${deviceId}`);
    return {
      success: false,
      totalDevices: 1,
      successCount: 0,
      failureCount: 1,
      tickets: [],
      errors: [{ deviceId, error: 'FCM not yet implemented' }],
    };
  } else {
    console.log(`[Notification] Unsupported token type for device=${deviceId}: ${device.pushTokenType}`);
    return {
      success: false,
      totalDevices: 1,
      successCount: 0,
      failureCount: 1,
      tickets: [],
      errors: [{ deviceId, error: `Unsupported token type: ${device.pushTokenType}` }],
    };
  }
}

/**
 * Shutdown the APNs provider (for graceful shutdown)
 */
export function shutdownNotificationService(): void {
  if (apnProvider) {
    apnProvider.shutdown();
    apnProvider = null;
    console.log('[Notification] APNs provider shutdown');
  }
}
