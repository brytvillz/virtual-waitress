-- 044_staff_reactivation.sql
-- Records who reactivated a suspended staff member and when.
-- suspended_at is already present from migration 041.

ALTER TABLE public.staff
  ADD COLUMN reactivated_at TIMESTAMPTZ,
  ADD COLUMN reactivated_by UUID;
