-- Add webhook tables for SACP token revocation notifications

-- MerchantWebhook: Stores webhook registrations for merchants (e.g., SSIM)
CREATE TABLE "merchant_webhooks" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_webhooks_pkey" PRIMARY KEY ("id")
);

-- WebhookDeliveryLog: Tracks webhook delivery attempts
CREATE TABLE "webhook_delivery_logs" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "webhook_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- Unique index on merchantId (one webhook per merchant)
CREATE UNIQUE INDEX "merchant_webhooks_merchantId_key" ON "merchant_webhooks"("merchantId");

-- Indexes for delivery logs
CREATE INDEX "webhook_delivery_logs_webhookId_idx" ON "webhook_delivery_logs"("webhookId");
CREATE INDEX "webhook_delivery_logs_eventType_idx" ON "webhook_delivery_logs"("eventType");
CREATE INDEX "webhook_delivery_logs_attemptedAt_idx" ON "webhook_delivery_logs"("attemptedAt");

-- Foreign key constraint
ALTER TABLE "webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "merchant_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
