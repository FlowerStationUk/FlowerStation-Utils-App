-- CreateEnum
CREATE TYPE "DiscountStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "masterDiscountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyId" TEXT,
    "code" TEXT NOT NULL,
    "masterDiscountId" TEXT NOT NULL,
    "discountSetId" TEXT,
    "status" "DiscountStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountSet_shop_idx" ON "DiscountSet"("shop");

-- CreateIndex
CREATE INDEX "Discount_shop_idx" ON "Discount"("shop");

-- CreateIndex
CREATE INDEX "Discount_shopifyId_idx" ON "Discount"("shopifyId");

-- CreateIndex
CREATE INDEX "Discount_discountSetId_idx" ON "Discount"("discountSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Discount_shop_code_key" ON "Discount"("shop", "code");

-- AddForeignKey
ALTER TABLE "Discount" ADD CONSTRAINT "Discount_discountSetId_fkey" FOREIGN KEY ("discountSetId") REFERENCES "DiscountSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
