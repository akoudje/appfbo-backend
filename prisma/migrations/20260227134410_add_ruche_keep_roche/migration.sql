-- Fix: add missing enum value
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'PRODUIT_DE_LA_RUCHE';