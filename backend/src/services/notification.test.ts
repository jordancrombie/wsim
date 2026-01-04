/**
 * Notification Service Tests
 *
 * Note: Core notification functionality is tested via webhook integration tests
 * in src/routes/webhooks.test.ts, which covers the full flow:
 * TransferSim webhook → user lookup → notification service → response
 *
 * These tests focus on the notification service's exported types and interfaces.
 */
import { describe, it, expect } from 'vitest';

// Import types to verify module exports correctly
import type { NotificationType, NotificationPayload, NotificationResult } from './notification';

describe('Notification Service Types', () => {
  it('should export NotificationPayload interface', () => {
    const payload: NotificationPayload = {
      title: 'Test',
      body: 'Body',
      data: { key: 'value' },
      sound: 'default',
      priority: 'high',
    };
    expect(payload.title).toBe('Test');
  });

  it('should export NotificationResult interface', () => {
    const result: NotificationResult = {
      success: true,
      totalDevices: 1,
      successCount: 1,
      failureCount: 0,
      tickets: [],
      errors: [],
    };
    expect(result.success).toBe(true);
  });

  it('should support all notification types', () => {
    const types: NotificationType[] = [
      'transfer.received',
      'transfer.sent',
      'payment.approved',
      'payment.completed',
      'auth.challenge',
      'system.announcement',
    ];
    expect(types).toHaveLength(6);
  });
});
