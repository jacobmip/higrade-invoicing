-- Flat-rate price book seed for HI Grade Plumbing.
-- Adds a unique index on (owner_id, name) so ON CONFLICT DO NOTHING
-- actually deduplicates on re-run. Safe to run multiple times.
-- owner_id = Jake's auth UUID so items appear under his RLS scope.

create unique index if not exists saved_items_owner_name_uniq
  on saved_items (owner_id, name);

insert into saved_items (owner_id, category, name, description, price, taxable, unit) values

-- Service Calls & Labor
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Service Call / Diagnostic',            'Dispatch, on-site assessment, and diagnosis of plumbing issue. Includes travel to job site and written findings.',                                                                                                                                     225,   false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Emergency Service Call (After Hours)',  'Priority response outside normal business hours including evenings, weekends, and holidays. Includes dispatch and on-site assessment.',                                                                                                               425,   false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Service Calls & Labor', 'Additional Labor',                     'Hourly labor rate applied after the first hour of service for extended or complex repairs.',                                                                                                                                                        195,   false, 'hr'),

-- Drains
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Sink/Tub/Shower Drain Unclog',        'Snake and clear stoppage in bathroom sink, bathtub, or shower drain. Includes basic cleanup.',                                                                                                                                325, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Kitchen Drain Unclog',                 'Snake and clear grease, food debris, and buildup from kitchen sink drain. Includes cleanup of work area.',                                                                                                                    395, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Toilet Unclog',                        'Clear toilet stoppage using auger or snake. Includes inspection of drain line and cleanup.',                                                                                                                                   325, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Urinal Snake',                         'Snake and clear urinal drain stoppage. Includes cleanup of work area.',                                                                                                                                                        285, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Main Sewer Line Snake',                'Snake main sewer line from cleanout to clear blockage or obstruction. Includes basic line test.',                                                                                                                             595, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Main Sewer Line Snake (Pull Toilet)',  'Snake main sewer line with toilet removal and reset required for access. Includes new wax ring and cleanup.',                                                                                                                 650, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Hydro Jet Main Line',                  'High-pressure water jetting of main sewer line to clear heavy buildup, grease, and root intrusion. Includes pre and post flow test.',                                                                                        1200, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Drain Line Camera Inspection',         'Video camera inspection of drain or sewer line to locate blockages, damage, or root intrusion. Footage reviewed on-site.',                                                                                                   595, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Drains', 'Camera Inspection + Written Report',   'Video camera inspection with detailed written report including findings, footage description, and recommended repairs.',                                                                                                      695, false, 'each'),

-- Toilets
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Rebuild (Internals Only)',                      'Replace all internal tank components including fill valve, flapper, flush valve, and handle. Restores proper flush and stops running.',                                                                                        325, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Replace (Labor Only, Customer-Supplied)',       'Remove existing toilet and install customer-supplied replacement. Includes new wax ring, supply line connection, and leak test.',                                                                                           395, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Replace (Includes Standard Toilet)',            'Remove existing toilet and install new standard two-piece toilet. Includes wax ring, supply line, seat, and leak test.',                                                                                                 750, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Toilet Flange Repair',                                 'Repair or replace damaged toilet flange at floor level. Includes new wax ring and toilet reset.',                                                                                                                        450, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Toilets', 'Bidet Installation',                                   'Install customer-supplied bidet seat or attachment on existing toilet. Includes supply line connection and function test.',                                                                                               325, false, 'each'),

-- Water Heaters
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 40gal Electric (Labor Only)', 'Remove existing 40-gallon electric water heater and install customer-supplied replacement. Includes new connections, drip leg, and leak test.',                       750,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 50gal Electric (Labor Only)', 'Remove existing 50-gallon electric water heater and install customer-supplied replacement. Includes new connections, drip leg, and leak test.',                       850,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 40gal Gas (Labor Only)',       'Remove existing 40-gallon gas water heater and install customer-supplied replacement. Includes new gas flex, connections, and leak test.',                              850,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Replace 50gal Gas (Labor Only)',       'Remove existing 50-gallon gas water heater and install customer-supplied replacement. Includes new gas flex, connections, and leak test.',                              950,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Tankless Water Heater Install (Labor Only)',        'Install customer-supplied tankless water heater including water connections, gas or electric hookup, venting, and system test.',                                        1450, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Water Heater Flush & Service',                     'Flush sediment from water heater tank, inspect anode rod, test pressure relief valve, and check all connections.',                                                      225,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Pressure Relief Valve Replace',                    'Remove and replace temperature and pressure relief valve on water heater. Includes new discharge line and leak test.',                                                  325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Heaters', 'Expansion Tank Install',                           'Install thermal expansion tank on cold water supply line to water heater. Includes pre-charge pressure check and connection.',                                          375,  false, 'each'),

-- Faucets & Fixtures
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Faucet Repair / Cartridge Replace',       'Diagnose and repair leaking or malfunctioning faucet. Replace cartridge, seats, springs, or O-rings as needed.',                                                                                        285, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Faucet Replace (Labor Only)',              'Remove existing bathroom faucet and install customer-supplied replacement. Includes supply line connections and leak test.',                                                                              345, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Kitchen Faucet Replace (Labor Only)',      'Remove existing kitchen faucet and install customer-supplied replacement. Includes supply line connections, sprayer hookup if applicable, and leak test.',                                              375, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Shower Valve Repair',                      'Diagnose and repair shower valve including cartridge replacement, seat grinding, or stem repair to stop dripping or restore function.',                                                                  395, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Shower Valve Replace (Labor Only)',        'Replace shower valve body with customer-supplied unit. Includes shutoff, valve swap, connection, and pressure test.',                                                                                    595, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Tub/Shower Trim Kit Install',              'Install customer-supplied tub or shower trim kit including handles, escutcheons, and spout on existing valve body.',                                                                                    345, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Hose Bib Replace',                         'Remove and replace exterior or interior hose bib. Includes shutoff and leak test.',                                                                                                                     285, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Garbage Disposal Install (Labor Only)',    'Install customer-supplied garbage disposal under kitchen sink. Includes drain connection, electrical hookup, and test run.',                                                                            295, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Faucets & Fixtures', 'Garbage Disposal Replace (Labor Only)',    'Remove existing garbage disposal and install customer-supplied replacement. Includes drain connection and test run.',                                                                                   295, false, 'each'),

-- Sinks & Supply Lines
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Sink Install (Labor Only)',          'Install customer-supplied bathroom sink including drain assembly, supply lines, P-trap, and leak test.',                                            375, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Kitchen Sink Install (Labor Only)',  'Install customer-supplied kitchen sink including drain basket, supply lines, P-trap, and leak test.',                                             450, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Supply Line Replace',               'Replace braided stainless supply line from angle stop to fixture. Includes shutoff and leak test.',                                               165, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'Angle Stop Valve Replace',          'Replace under-sink or behind-toilet angle stop shutoff valve. Includes water shutoff, valve swap, and leak test.',                               195, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sinks & Supply Lines', 'P-Trap Replace',                    'Remove and replace P-trap assembly under sink. Includes drain connection and leak test.',                                                          225, false, 'each'),

-- Pipes & Leak Repair
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Minor Leak Repair (Accessible)',         'Locate and repair minor leak at accessible pipe joint, fitting, or connection. Includes pressure test and cleanup.',                                                                                                 325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Pipe Repair / Section Replace',          'Cut out and replace damaged section of supply or drain pipe. Includes fittings, solder or press connections, and leak test.',                                                                                 450,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Copper Repipe Per Fixture (Labor Only)', 'Repipe supply lines to one fixture location using copper pipe. Includes shutoff, new pipe run, connections, and pressure test.',                                                                             525,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'PEX Repipe 1500sf Home (Labor Only)',    'Full repipe of 1,500 square foot home using PEX tubing. Includes removal of old supply lines, new manifold, all fixture connections, pressure test, and drywall patch prep.',                               9500, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Water Main Repair',                      'Locate and repair break or leak in water main supply line. Includes excavation if needed, repair, backfill, and pressure test.',                                                                              750,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Pressure Regulator Replace',             'Remove and replace whole-house pressure reducing valve. Includes system pressure test and adjustment to code.',                                                                                               575,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Pipes & Leak Repair', 'Whole House Shutoff Valve Replace',      'Replace main water shutoff valve for entire property. Includes water shutoff coordination, valve swap, and leak test.',                                                                                       450,  false, 'each'),

-- Water Filtration
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Water Softener Install (Labor Only)',      'Install customer-supplied water softener including inlet/outlet connections, drain line, bypass valve, and system startup.',                595, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Whole House Filter Install (Labor Only)',  'Install customer-supplied whole house inline filter housing on main supply line. Includes shutoff, connections, and leak test.',           450, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Under Sink Filter Install',               'Install customer-supplied under-sink water filter system. Includes supply saddle or dedicated line, drain connection, and faucet installation.', 295, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Water Filtration', 'Reverse Osmosis System Install',          'Install customer-supplied reverse osmosis system under kitchen sink. Includes feed line, drain connection, storage tank, and dedicated faucet.',  450, false, 'each'),

-- Sump & Drainage
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Install Submersible (Labor Only)', 'Install customer-supplied submersible sump pump in existing pit. Includes discharge line, check valve, float adjustment, and test run.',                                    695, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Replace',                          'Remove failed sump pump and install customer-supplied replacement. Includes discharge reconnection, float setup, and test run.',                                             795, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Sump Pump Repair',                           'Diagnose and repair sump pump system including float, switch, discharge line, or check valve. Includes test run.',                                                          395, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Storm Drain / French Drain Install',         'Install storm or French drain system for surface water management. Includes trench, perforated pipe, gravel bed, and outlet connection.',                                   145, false, 'lf'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Sump & Drainage', 'Effluent Pump Install',                      'Install customer-supplied effluent pump in dosing chamber or collection pit. Includes discharge line, float, check valve, and test run.',                                  895, false, 'each'),

-- Gas
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Line Install (Interior)', 'Run new interior gas supply line from existing gas meter or branch to appliance location. Includes fittings, pressure test, and leak check.',  85,  false, 'lf'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Appliance Hookup',        'Connect gas appliance to existing gas supply line using new flexible connector. Includes leak test and appliance startup.',                    345, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'Gas', 'Gas Leak Test',               'Pressure test gas system to locate and confirm presence of leak. Includes isolation of affected section and written findings.',               295, false, 'each'),

-- High-Rise & Commercial
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'High-Rise Service Call',                     'Dispatch and on-site service for high-rise residential or commercial building. Includes coordination with building management and elevator access time.',     325,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'High-Rise Water Heater Replace (Labor Only)', 'Remove and replace water heater in high-rise unit. Includes logistical coordination, building protection, and all connections.',                              1100, false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Commercial Drain Unclog',                    'Snake and clear drain stoppage in commercial property. Includes access coordination, drain snake, and cleanup.',                                                595,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Backflow Preventer Test',                    'Test and certify backflow prevention assembly per Hawaii DOH requirements. Includes written test report.',                                                       245,  false, 'each'),
('0a3bcefd-6faf-4bae-b43b-cd4492dd9938', 'High-Rise & Commercial', 'Backflow Preventer Replace',                 'Remove and replace backflow prevention assembly. Includes shutoff, new device, pressure test, and certification.',                                               695,  false, 'each')

on conflict (owner_id, name) do nothing;

-- Back-fill descriptions for any rows already seeded without them.
update saved_items set description = v.description
from (values
  ('Service Call / Diagnostic',            'Dispatch, on-site assessment, and diagnosis of plumbing issue. Includes travel to job site and written findings.'),
  ('Emergency Service Call (After Hours)', 'Priority response outside normal business hours including evenings, weekends, and holidays. Includes dispatch and on-site assessment.'),
  ('Additional Labor',                     'Hourly labor rate applied after the first hour of service for extended or complex repairs.'),
  ('Sink/Tub/Shower Drain Unclog',        'Snake and clear stoppage in bathroom sink, bathtub, or shower drain. Includes basic cleanup.'),
  ('Kitchen Drain Unclog',                 'Snake and clear grease, food debris, and buildup from kitchen sink drain. Includes cleanup of work area.'),
  ('Toilet Unclog',                        'Clear toilet stoppage using auger or snake. Includes inspection of drain line and cleanup.'),
  ('Urinal Snake',                         'Snake and clear urinal drain stoppage. Includes cleanup of work area.'),
  ('Main Sewer Line Snake',               'Snake main sewer line from cleanout to clear blockage or obstruction. Includes basic line test.'),
  ('Main Sewer Line Snake (Pull Toilet)', 'Snake main sewer line with toilet removal and reset required for access. Includes new wax ring and cleanup.'),
  ('Hydro Jet Main Line',                  'High-pressure water jetting of main sewer line to clear heavy buildup, grease, and root intrusion. Includes pre and post flow test.'),
  ('Drain Line Camera Inspection',         'Video camera inspection of drain or sewer line to locate blockages, damage, or root intrusion. Footage reviewed on-site.'),
  ('Camera Inspection + Written Report',   'Video camera inspection with detailed written report including findings, footage description, and recommended repairs.'),
  ('Toilet Rebuild (Internals Only)',                      'Replace all internal tank components including fill valve, flapper, flush valve, and handle. Restores proper flush and stops running.'),
  ('Toilet Replace (Labor Only, Customer-Supplied)',       'Remove existing toilet and install customer-supplied replacement. Includes new wax ring, supply line connection, and leak test.'),
  ('Toilet Replace (Includes Standard Toilet)',            'Remove existing toilet and install new standard two-piece toilet. Includes wax ring, supply line, seat, and leak test.'),
  ('Toilet Flange Repair',                                 'Repair or replace damaged toilet flange at floor level. Includes new wax ring and toilet reset.'),
  ('Bidet Installation',                                   'Install customer-supplied bidet seat or attachment on existing toilet. Includes supply line connection and function test.'),
  ('Water Heater Replace 40gal Electric (Labor Only)', 'Remove existing 40-gallon electric water heater and install customer-supplied replacement. Includes new connections, drip leg, and leak test.'),
  ('Water Heater Replace 50gal Electric (Labor Only)', 'Remove existing 50-gallon electric water heater and install customer-supplied replacement. Includes new connections, drip leg, and leak test.'),
  ('Water Heater Replace 40gal Gas (Labor Only)',      'Remove existing 40-gallon gas water heater and install customer-supplied replacement. Includes new gas flex, connections, and leak test.'),
  ('Water Heater Replace 50gal Gas (Labor Only)',      'Remove existing 50-gallon gas water heater and install customer-supplied replacement. Includes new gas flex, connections, and leak test.'),
  ('Tankless Water Heater Install (Labor Only)',       'Install customer-supplied tankless water heater including water connections, gas or electric hookup, venting, and system test.'),
  ('Water Heater Flush & Service',                    'Flush sediment from water heater tank, inspect anode rod, test pressure relief valve, and check all connections.'),
  ('Pressure Relief Valve Replace',                   'Remove and replace temperature and pressure relief valve on water heater. Includes new discharge line and leak test.'),
  ('Expansion Tank Install',                          'Install thermal expansion tank on cold water supply line to water heater. Includes pre-charge pressure check and connection.'),
  ('Faucet Repair / Cartridge Replace',    'Diagnose and repair leaking or malfunctioning faucet. Replace cartridge, seats, springs, or O-rings as needed.'),
  ('Faucet Replace (Labor Only)',          'Remove existing bathroom faucet and install customer-supplied replacement. Includes supply line connections and leak test.'),
  ('Kitchen Faucet Replace (Labor Only)', 'Remove existing kitchen faucet and install customer-supplied replacement. Includes supply line connections, sprayer hookup if applicable, and leak test.'),
  ('Shower Valve Repair',                  'Diagnose and repair shower valve including cartridge replacement, seat grinding, or stem repair to stop dripping or restore function.'),
  ('Shower Valve Replace (Labor Only)',    'Replace shower valve body with customer-supplied unit. Includes shutoff, valve swap, connection, and pressure test.'),
  ('Tub/Shower Trim Kit Install',          'Install customer-supplied tub or shower trim kit including handles, escutcheons, and spout on existing valve body.'),
  ('Hose Bib Replace',                     'Remove and replace exterior or interior hose bib. Includes shutoff and leak test.'),
  ('Garbage Disposal Install (Labor Only)','Install customer-supplied garbage disposal under kitchen sink. Includes drain connection, electrical hookup, and test run.'),
  ('Garbage Disposal Replace (Labor Only)','Remove existing garbage disposal and install customer-supplied replacement. Includes drain connection and test run.'),
  ('Sink Install (Labor Only)',         'Install customer-supplied bathroom sink including drain assembly, supply lines, P-trap, and leak test.'),
  ('Kitchen Sink Install (Labor Only)', 'Install customer-supplied kitchen sink including drain basket, supply lines, P-trap, and leak test.'),
  ('Supply Line Replace',              'Replace braided stainless supply line from angle stop to fixture. Includes shutoff and leak test.'),
  ('Angle Stop Valve Replace',         'Replace under-sink or behind-toilet angle stop shutoff valve. Includes water shutoff, valve swap, and leak test.'),
  ('P-Trap Replace',                   'Remove and replace P-trap assembly under sink. Includes drain connection and leak test.'),
  ('Minor Leak Repair (Accessible)',         'Locate and repair minor leak at accessible pipe joint, fitting, or connection. Includes pressure test and cleanup.'),
  ('Pipe Repair / Section Replace',          'Cut out and replace damaged section of supply or drain pipe. Includes fittings, solder or press connections, and leak test.'),
  ('Copper Repipe Per Fixture (Labor Only)', 'Repipe supply lines to one fixture location using copper pipe. Includes shutoff, new pipe run, connections, and pressure test.'),
  ('PEX Repipe 1500sf Home (Labor Only)',    'Full repipe of 1,500 square foot home using PEX tubing. Includes removal of old supply lines, new manifold, all fixture connections, pressure test, and drywall patch prep.'),
  ('Water Main Repair',                      'Locate and repair break or leak in water main supply line. Includes excavation if needed, repair, backfill, and pressure test.'),
  ('Pressure Regulator Replace',             'Remove and replace whole-house pressure reducing valve. Includes system pressure test and adjustment to code.'),
  ('Whole House Shutoff Valve Replace',      'Replace main water shutoff valve for entire property. Includes water shutoff coordination, valve swap, and leak test.'),
  ('Water Softener Install (Labor Only)',     'Install customer-supplied water softener including inlet/outlet connections, drain line, bypass valve, and system startup.'),
  ('Whole House Filter Install (Labor Only)','Install customer-supplied whole house inline filter housing on main supply line. Includes shutoff, connections, and leak test.'),
  ('Under Sink Filter Install',              'Install customer-supplied under-sink water filter system. Includes supply saddle or dedicated line, drain connection, and faucet installation.'),
  ('Reverse Osmosis System Install',         'Install customer-supplied reverse osmosis system under kitchen sink. Includes feed line, drain connection, storage tank, and dedicated faucet.'),
  ('Sump Pump Install Submersible (Labor Only)', 'Install customer-supplied submersible sump pump in existing pit. Includes discharge line, check valve, float adjustment, and test run.'),
  ('Sump Pump Replace',                          'Remove failed sump pump and install customer-supplied replacement. Includes discharge reconnection, float setup, and test run.'),
  ('Sump Pump Repair',                           'Diagnose and repair sump pump system including float, switch, discharge line, or check valve. Includes test run.'),
  ('Storm Drain / French Drain Install',         'Install storm or French drain system for surface water management. Includes trench, perforated pipe, gravel bed, and outlet connection.'),
  ('Effluent Pump Install',                      'Install customer-supplied effluent pump in dosing chamber or collection pit. Includes discharge line, float, check valve, and test run.'),
  ('Gas Line Install (Interior)', 'Run new interior gas supply line from existing gas meter or branch to appliance location. Includes fittings, pressure test, and leak check.'),
  ('Gas Appliance Hookup',        'Connect gas appliance to existing gas supply line using new flexible connector. Includes leak test and appliance startup.'),
  ('Gas Leak Test',               'Pressure test gas system to locate and confirm presence of leak. Includes isolation of affected section and written findings.'),
  ('High-Rise Service Call',                     'Dispatch and on-site service for high-rise residential or commercial building. Includes coordination with building management and elevator access time.'),
  ('High-Rise Water Heater Replace (Labor Only)', 'Remove and replace water heater in high-rise unit. Includes logistical coordination, building protection, and all connections.'),
  ('Commercial Drain Unclog',                    'Snake and clear drain stoppage in commercial property. Includes access coordination, drain snake, and cleanup.'),
  ('Backflow Preventer Test',                    'Test and certify backflow prevention assembly per Hawaii DOH requirements. Includes written test report.'),
  ('Backflow Preventer Replace',                 'Remove and replace backflow prevention assembly. Includes shutoff, new device, pressure test, and certification.')
) as v(name, description)
where saved_items.owner_id = '0a3bcefd-6faf-4bae-b43b-cd4492dd9938'
  and saved_items.name = v.name
  and (saved_items.description is null or saved_items.description = '');
