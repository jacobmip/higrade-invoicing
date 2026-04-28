-- HiGrade Invoicing — Seed Data
-- Run after 001_initial_schema.sql

insert into clients (name, email) values
  ('Jacob Petersen', 'jacobmip@gmail.com')
on conflict do nothing;

insert into saved_items (category, name, price) values
  ('Drain',        'Drain Clean – Snake',                    350),
  ('Drain',        'Drain Clean – Hydro Jet',                750),
  ('Toilet',       'Toilet Repair',                          295),
  ('Toilet',       'Toilet Replace (labor only)',            425),
  ('Toilet',       'Toilet Replace (supply + labor)',        750),
  ('Faucet',       'Faucet Repair',                         265),
  ('Faucet',       'Faucet Replace (labor only)',            325),
  ('Faucet',       'Faucet Replace (supply + labor)',        575),
  ('Water Heater', 'Water Heater – Electric 40gal',        1800),
  ('Water Heater', 'Water Heater – Gas 40gal',             2200),
  ('Water Heater', 'Tankless Water Heater',                4200),
  ('Sewer',        'Sewer Camera Inspection',               450),
  ('Sewer',        'Sewer Spot Repair',                    2800),
  ('Gas',          'Gas Line Repair',                      1200),
  ('Service',      'Service Call / Diagnostic',             225),
  ('Service',      'After Hours Emergency',                 385)
on conflict do nothing;
