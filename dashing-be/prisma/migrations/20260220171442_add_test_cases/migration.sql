-- CreateEnum
CREATE TYPE "TestCategory" AS ENUM ('REQUIRED', 'BOUNDARY', 'NEGATIVE', 'FORMAT', 'SECURITY', 'ACCESSIBILITY');

-- CreateEnum
CREATE TYPE "TestPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "test_cases" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fieldId" TEXT,
    "fieldName" TEXT NOT NULL,
    "fieldSelector" TEXT,
    "category" "TestCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "testValue" TEXT,
    "expectedResult" TEXT,
    "priority" "TestPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "playwrightCode" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_cases_sessionId_idx" ON "test_cases"("sessionId");

-- CreateIndex
CREATE INDEX "test_cases_status_idx" ON "test_cases"("status");

-- CreateIndex
CREATE INDEX "test_cases_priority_idx" ON "test_cases"("priority");

-- CreateIndex
CREATE INDEX "test_cases_category_idx" ON "test_cases"("category");

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
