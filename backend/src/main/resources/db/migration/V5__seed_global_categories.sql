-- The 5 system categories every household starts with (push/pull split by upper and
-- lower body, per the product requirements' movement-pattern taxonomy). Households can
-- add their own custom categories on top of these via Admin.
IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Upper Push' AND account_id IS NULL)
    INSERT INTO categories (account_id, name) VALUES (NULL, 'Upper Push');

IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Upper Pull' AND account_id IS NULL)
    INSERT INTO categories (account_id, name) VALUES (NULL, 'Upper Pull');

IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Lower Push' AND account_id IS NULL)
    INSERT INTO categories (account_id, name) VALUES (NULL, 'Lower Push');

IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Lower Pull' AND account_id IS NULL)
    INSERT INTO categories (account_id, name) VALUES (NULL, 'Lower Pull');

IF NOT EXISTS (SELECT 1 FROM categories WHERE name = 'Core' AND account_id IS NULL)
    INSERT INTO categories (account_id, name) VALUES (NULL, 'Core');
