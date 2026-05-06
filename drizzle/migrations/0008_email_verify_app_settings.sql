ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "email_verify_from_email" text;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "email_verify_hello_name" text;
