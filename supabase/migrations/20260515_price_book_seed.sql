-- Flat-rate price book seed for HI Grade Plumbing.
-- Adds a unique index on (owner_id, name) so ON CONFLICT DO NOTHING
-- actually deduplicates on re-run.
-- owner_id = Jake's auth UUID so items appear in his account under RLS.

create unique index if not exists saved_items_owner_name_uniq
  on saved_items (owner_id, name);

insert into saved_items (owner_id, category, name, description, price, taxable, unit) values

-- Service Calls & Labor
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Service Call / Diagnostic',             '',                             225,   false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Emergency Service Call (After Hours)',  '',                             425,   false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Additional Labor',                     'per hour after first',         195,   false, 'hr'),

-- Drains
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Sink/Tub/Shower Drain Unclog',          '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Kitchen Drain Unclog',                  '',    395,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Toilet Unclog',                         '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Urinal Snake',                          '',    285,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Main Sewer Line Snake',                 '',    595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Main Sewer Line Snake (Pull Toilet)',   '',    650,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Hydro Jet Main Line',                   '',   1200,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Drain Line Camera Inspection',          '',    595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Camera Inspection + Written Report',    '',    695,  false, 'each'),

-- Toilets
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Rebuild (Internals Only)',                       '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Replace (Labor Only, Customer-Supplied)',        '',    395,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Replace (Includes Standard Toilet)',             '',    750,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Flange Repair',                                  '',    450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Bidet Installation',                                    '',    325,  false, 'each'),

-- Water Heaters
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 40gal Electric (Labor Only)',  '',    750,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 50gal Electric (Labor Only)',  '',    850,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 40gal Gas (Labor Only)',       '',    850,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 50gal Gas (Labor Only)',       '',    950,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Tankless Water Heater Install (Labor Only)',        '',   1450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Flush & Service',                     '',    225,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Pressure Relief Valve Replace',                    '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Expansion Tank Install',                           '',    375,  false, 'each'),

-- Faucets & Fixtures
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Faucet Repair / Cartridge Replace',        '',    285,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Faucet Replace (Labor Only)',              '',    345,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Kitchen Faucet Replace (Labor Only)',      '',    375,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Shower Valve Repair',                      '',    395,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Shower Valve Replace (Labor Only)',        '',    595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Tub/Shower Trim Kit Install',              '',    345,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Hose Bib Replace',                         '',    285,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Garbage Disposal Install (Labor Only)',    '',    295,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Garbage Disposal Replace (Labor Only)',   '',    295,  false, 'each'),

-- Sinks & Supply Lines
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Sink Install (Labor Only)',          '',              375,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Kitchen Sink Install (Labor Only)',  '',              450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Supply Line Replace',               'per line',      165,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Angle Stop Valve Replace',          'per valve',     195,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'P-Trap Replace',                    '',              225,  false, 'each'),

-- Pipes & Leak Repair
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Minor Leak Repair (Accessible)',          '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Pipe Repair / Section Replace',           '',    450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Copper Repipe Per Fixture (Labor Only)',  '',    525,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'PEX Repipe 1500sf Home (Labor Only)',     '',   9500,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Water Main Repair',                       '',    750,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Pressure Regulator Replace',              '',    575,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Whole House Shutoff Valve Replace',       '',    450,  false, 'each'),

-- Water Filtration
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Water Softener Install (Labor Only)',     '',    595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Whole House Filter Install (Labor Only)', '',    450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Under Sink Filter Install',               '',    295,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Reverse Osmosis System Install',         '',    450,  false, 'each'),

-- Sump & Drainage
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Install Submersible (Labor Only)',  '',              695,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Replace',                           '',              795,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Repair',                            '',              395,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Storm Drain / French Drain Install',          'per linear ft', 145,  false, 'lf'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Effluent Pump Install',                       '',              895,  false, 'each'),

-- Gas
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Line Install (Interior)',  'per linear ft',  85,  false, 'lf'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Appliance Hookup',         '',              345,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Leak Test',                '',              295,  false, 'each'),

-- High-Rise & Commercial
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'High-Rise Service Call',                    '',    325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'High-Rise Water Heater Replace (Labor Only)','',   1100,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Commercial Drain Unclog',                   '',    595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Backflow Preventer Test',                   '',    245,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Backflow Preventer Replace',                '',    695,  false, 'each')

on conflict (owner_id, name) do nothing;
