-- Flat-rate price book: each saved item can carry the hours and the parts
-- it takes, so its sell price is computed instead of typed.
--
--   sell = max(minimum, ceil5(hours * rate + marked-up materials))
--
-- materials is a list of {item_no, name, qty, cost}, cost being Jake's
-- Ferguson account price. material_cost is the raw sum, before markup.
-- Items without hours keep their typed price, so the old book still works.
-- The rate, markup and minimum live in settings, so one change reprices
-- the whole book.

alter table saved_items add column if not exists hours numeric(5,2);
alter table saved_items add column if not exists material_cost numeric(10,2);
alter table saved_items add column if not exists materials jsonb;

insert into settings (key, value) values
  ('pricebook_rate', '285'),
  ('pricebook_markup', '1.5'),
  ('pricebook_markup_small', '2'),
  ('pricebook_small_under', '20'),
  ('pricebook_minimum', '225')
on conflict (key) do nothing;
