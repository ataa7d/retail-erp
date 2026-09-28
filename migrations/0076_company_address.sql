-- branches and stores already carry their own address/city (migration
-- 0003) but the company itself never got one -- useful as the fallback
-- seller address on a printed invoice when a branch hasn't set its own,
-- and just generally missing from what should be basic company profile
-- data.
ALTER TABLE companies ADD COLUMN address TEXT;
