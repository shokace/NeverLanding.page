-- Remove the retired definition unless a historical award still references it.
-- It is absent from the displayed catalog in either case.
DELETE FROM achievements WHERE code = 'tld_mf'
AND NOT EXISTS (SELECT 1 FROM user_achievements WHERE achievement_id = achievements.id);
