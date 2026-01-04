/**
 * Push Notification Service
 *
 * Handles sending push notifications to mwsim mobile app users.
 * Uses Expo Push Notification service for Phase 1 (per AD2).
 *
 * Flow: TransferSim webhook → WSIM notification service → Expo Push → APNs/FCM → mwsim
 */

import Expo, { ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from 'expo-server-sdk';
import { prisma } from '../config/database';

// Singleton Expo client
const expo = new Expo();

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
  tickets: ExpoPushTicket[];
  errors: Array<{ deviceId: string; error: string }>;
}

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

  // Build Expo push messages
  const messages: ExpoPushMessage[] = [];
  const deviceMap = new Map<number, string>(); // index -> deviceId

  for (const device of devices) {
    const pushToken = device.pushToken!;

    // Validate Expo push token format
    if (!Expo.isExpoPushToken(pushToken)) {
      console.warn(`[Notification] Invalid Expo token for device=${device.deviceId}: ${pushToken}`);
      continue;
    }

    messages.push({
      to: pushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: payload.sound ?? 'default',
      priority: payload.priority ?? 'high',
      channelId: payload.channelId ?? 'default',
      badge: payload.badge,
    });

    deviceMap.set(messages.length - 1, device.deviceId);
  }

  if (messages.length === 0) {
    console.log(`[Notification] No valid Expo tokens for user=${userId}`);
    return {
      success: false,
      totalDevices: devices.length,
      successCount: 0,
      failureCount: devices.length,
      tickets: [],
      errors: devices.map((d: { deviceId: string }) => ({ deviceId: d.deviceId, error: 'Invalid push token format' })),
    };
  }

  // Send notifications in chunks (Expo recommends max 100 per request)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  const errors: Array<{ deviceId: string; error: string }> = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error(`[Notification] Failed to send chunk:`, error);
      // Mark all devices in this chunk as failed
      for (let i = 0; i < chunk.length; i++) {
        const deviceId = deviceMap.get(tickets.length + i);
        if (deviceId) {
          errors.push({ deviceId, error: String(error) });
        }
      }
    }
  }

  // Process tickets and handle errors
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const deviceId = deviceMap.get(i);

    if (ticket.status === 'ok') {
      successCount++;
    } else {
      failureCount++;
      const errorMessage = ticket.message || 'Unknown error';
      const errorCode = ticket.details?.error;

      if (deviceId) {
        errors.push({ deviceId, error: `${errorCode}: ${errorMessage}` });

        // Handle specific error codes
        if (errorCode === 'DeviceNotRegistered') {
          // Mark device token as inactive
          await prisma.mobileDevice.updateMany({
            where: { deviceId },
            data: { pushTokenActive: false },
          });
          console.log(`[Notification] Deactivated token for unregistered device=${deviceId}`);
        }
      }
    }
  }

  // Log the notification
  await prisma.notificationLog.create({
    data: {
      userId,
      notificationType,
      title: payload.title,
      body: payload.body,
      data: payload.data as object | undefined,
      status: failureCount === devices.length ? 'failed' : 'sent',
      errorMessage: errors.length > 0 ? JSON.stringify(errors) : null,
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
    tickets,
    errors,
  };
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

  if (!Expo.isExpoPushToken(device.pushToken)) {
    console.warn(`[Notification] Invalid Expo token for device=${deviceId}`);
    return {
      success: false,
      totalDevices: 1,
      successCount: 0,
      failureCount: 1,
      tickets: [],
      errors: [{ deviceId, error: 'Invalid push token format' }],
    };
  }

  try {
    const tickets = await expo.sendPushNotificationsAsync([
      {
        to: device.pushToken,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        sound: payload.sound ?? 'default',
        priority: payload.priority ?? 'high',
        channelId: payload.channelId ?? 'default',
        badge: payload.badge,
      },
    ]);

    const ticket = tickets[0];
    const success = ticket.status === 'ok';

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
        errorMessage: success ? null : (ticket as { message?: string }).message,
        sourceType: 'webhook',
        sourceId,
        sentAt: new Date(),
      },
    });

    if (!success && (ticket as { details?: { error?: string } }).details?.error === 'DeviceNotRegistered') {
      await prisma.mobileDevice.update({
        where: { deviceId },
        data: { pushTokenActive: false },
      });
    }

    return {
      success,
      totalDevices: 1,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      tickets,
      errors: success ? [] : [{ deviceId, error: (ticket as { message?: string }).message || 'Unknown error' }],
    };
  } catch (error) {
    console.error(`[Notification] Failed to send to device=${deviceId}:`, error);

    await prisma.notificationLog.create({
      data: {
        userId: device.userId,
        deviceId,
        notificationType,
        title: payload.title,
        body: payload.body,
        data: payload.data as object | undefined,
        status: 'failed',
        errorMessage: String(error),
        sourceType: 'webhook',
        sourceId,
      },
    });

    return {
      success: false,
      totalDevices: 1,
      successCount: 0,
      failureCount: 1,
      tickets: [],
      errors: [{ deviceId, error: String(error) }],
    };
  }
}

/**
 * Check push notification receipts for delivery status.
 * Should be called periodically to update notification logs.
 */
export async function checkNotificationReceipts(ticketIds: string[]): Promise<Map<string, ExpoPushReceipt>> {
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  const receipts = new Map<string, ExpoPushReceipt>();

  for (const chunk of receiptIdChunks) {
    try {
      const chunkReceipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(chunkReceipts)) {
        receipts.set(id, receipt);
      }
    } catch (error) {
      console.error(`[Notification] Failed to get receipts:`, error);
    }
  }

  return receipts;
}
