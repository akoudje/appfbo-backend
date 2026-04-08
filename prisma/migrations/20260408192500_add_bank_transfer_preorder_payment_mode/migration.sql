-- Add BANK_TRANSFER as supported preorder payment mode
ALTER TYPE "PreorderPaymentMode" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';

