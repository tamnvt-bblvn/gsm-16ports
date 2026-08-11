-- CreateTable
CREATE TABLE "sim_iccid_history" (
    "iccid" VARCHAR(22) NOT NULL,
    "last_port" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(30),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_iccid_history_pkey" PRIMARY KEY ("iccid")
);
