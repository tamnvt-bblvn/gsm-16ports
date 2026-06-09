CREATE TABLE "sms_messages" (
    "id" BIGSERIAL NOT NULL,
    "modem_port" VARCHAR(20) NOT NULL,
    "phone_number" VARCHAR(30),
    "message" TEXT NOT NULL,
    "otp_code" VARCHAR(20),
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "modem_states" (
    "port" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(30),
    "status" VARCHAR(20) NOT NULL,
    "signal" INTEGER,
    "operator" VARCHAR(50),
    "sim_ready" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modem_states_pkey" PRIMARY KEY ("port")
);

CREATE INDEX "sms_messages_modem_port_received_at_idx" ON "sms_messages"("modem_port", "received_at");
CREATE INDEX "sms_messages_phone_number_received_at_idx" ON "sms_messages"("phone_number", "received_at");
