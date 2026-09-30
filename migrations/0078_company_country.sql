-- Free-text, matching suppliers.country's existing convention (migration
-- 0015) rather than an enum -- companies can be anywhere, and an enum
-- would need a migration every time a new one shows up. Needed so a
-- newly created company can record where it's based, alongside its own
-- base_currency (already existed), for the "add another company in a
-- different country/currency" flow.
ALTER TABLE companies ADD COLUMN country TEXT NOT NULL DEFAULT 'Saudi Arabia';
