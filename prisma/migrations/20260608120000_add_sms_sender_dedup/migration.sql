ALTER TABLE "sms_messages" ADD COLUMN "sender" VARCHAR(30);

CREATE UNIQUE INDEX "sms_messages_dedup_key"
ON "sms_messages"("modem_port", "sender", "message", "received_at");
