-- HiGrade Sample Data — Jacob Petersen
-- Run in Supabase SQL editor after 001_initial_schema.sql and seed.sql

do $$
declare client_id bigint;
begin
  select id into client_id from clients where name = 'Jacob Petersen' limit 1;

  -- ── Invoices ────────────────────────────────────────────────────────────────

  -- INV0753 · Drain Clean Snake · PAID
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0753','invoice', client_id,'Jacob Petersen','2026-03-05','2026-03-05','paid',4.712,0,'$','',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0753','Drain Clean – Snake',
    E'Locate and access main line cleanout\nSet up drain snake equipment\nFeed snake through drain line to break up clog\nRetrieve snake and inspect for debris\nFlush line with water to confirm clear\nReplace cleanout cap and clean work area',
    1, 350, 'flat', 0, '%', true, 0);
  insert into payments (invoice_id, amount, method, date)
  values ('INV0753', 366.49, 'Cash', '2026-03-05');

  -- INV0754 · Toilet Replace · PAID
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0754','invoice', client_id,'Jacob Petersen','2026-03-12','2026-03-12','paid',4.712,0,'$','',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0754','Toilet Replace (Supply + Labor)',
    E'Shut off water supply and flush toilet to empty tank and bowl\nDisconnect supply line and remove old toilet\nInspect floor flange and replace wax ring\nSet new toilet and secure to floor bolts\nReconnect supply line and restore water\nTest flush and inspect all connections for leaks\nHaul away old toilet',
    1, 750, 'flat', 0, '%', true, 0);
  insert into payments (invoice_id, amount, method, date)
  values ('INV0754', 785.34, 'Check', '2026-03-12');

  -- INV0755 · After Hours Emergency · PAID
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0755','invoice', client_id,'Jacob Petersen','2026-02-20','2026-02-20','paid',4.712,0,'$','Weekend emergency call',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0755','After Hours Emergency',
    E'Respond to emergency call outside of normal business hours\nAssess and diagnose plumbing issue on arrival\nShut off water supply to affected area\nPerform emergency repair to stop leak\nTest repair and confirm water is restored\nDocument findings and advise on follow-up work if needed',
    1, 385, 'flat', 0, '%', true, 0);
  insert into payments (invoice_id, amount, method, date)
  values ('INV0755', 403.14, 'Venmo', '2026-02-20');

  -- INV0756 · Hydro Jet · PAID
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0756','invoice', client_id,'Jacob Petersen','2026-03-28','2026-03-28','paid',4.712,0,'$','',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0756','Drain Clean – Hydro Jet',
    E'Locate and access main line cleanout\nSet up hydro-jet equipment and safety barriers\nInsert jetting hose and clear grease buildup and debris\nFlush line at 3500 PSI from cleanout to street connection\nBackflush to clear any remaining obstruction\nRun camera to confirm line is fully clear\nRestore cleanout cap and clean work area',
    1, 750, 'flat', 0, '%', true, 0);
  insert into payments (invoice_id, amount, method, date)
  values ('INV0756', 785.34, 'Zelle', '2026-03-28');

  -- INV0757 · Faucet Replace · OUTSTANDING (due today = same-day)
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0757','invoice', client_id,'Jacob Petersen','2026-04-28','2026-04-28','outstanding',4.712,0,'$','',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0757','Faucet Replace (Supply + Labor)',
    E'Shut off hot and cold supply valves under sink\nDisconnect supply lines and remove old faucet\nClean mounting surface and inspect for corrosion\nInstall new customer-supplied faucet with new supply lines\nReconnect drain and check garbage disposal connection\nRestore water and test for leaks at all connections\nVerify hot and cold operation and proper flow rate',
    1, 575, 'flat', 0, '%', true, 0);

  -- INV0758 · Sewer Camera Inspection · PARTIAL
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0758','invoice', client_id,'Jacob Petersen','2026-04-10','2026-04-10','partial',4.712,0,'$','Balance due on completion of spot repair',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0758','Sewer Camera Inspection',
    E'Locate cleanout access and set up camera equipment\nRun camera through main sewer line from cleanout to street\nInspect for root intrusion, cracks, offset joints, and blockages\nDocument findings with footage and timestamps\nProvide written report of pipe condition\nRecommend repair scope and provide estimate',
    1, 450, 'flat', 0, '%', true, 0);
  insert into payments (invoice_id, amount, method, date, note)
  values ('INV0758', 236.00, 'Cash', '2026-04-10', 'Deposit');

  -- INV0759 · Gas Line Repair · OVERDUE (due date in the past, still unpaid)
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0759','invoice', client_id,'Jacob Petersen','2026-03-15','2026-03-31','outstanding',4.712,0,'$','',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0759','Gas Line Repair',
    E'Shut off gas supply at meter and verify with detector\nLocate and expose damaged section of gas line\nCut out corroded or damaged pipe section\nInstall new threaded or press-fit fittings and pipe\nPressure test repaired section with nitrogen\nCheck all joints with leak detection solution\nRestore gas supply and re-light appliances',
    1, 1200, 'flat', 0, '%', true, 0);

  -- INV0760 · Water Heater · NET 30 (due date in future = Pending)
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0760','invoice', client_id,'Jacob Petersen','2026-04-15','2026-05-15','net30',4.712,0,'$','Commercial account – Net 30',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0760','Water Heater – Electric 40gal',
    E'Shut off power at breaker and cold water supply to unit\nDrain existing water heater and disconnect supply lines\nDisconnect electrical connections and remove old unit\nPosition and secure new 40-gallon electric water heater\nReconnect cold supply, hot outlet, and pressure relief valve\nReconnect electrical wiring and verify proper grounding\nRestore power and water, purge air from lines\nTest thermostat settings and check all connections for leaks',
    1, 1800, 'flat', 0, '%', true, 0);

  -- ── Estimates ───────────────────────────────────────────────────────────────

  -- INV0761 · Tankless Water Heater · ESTIMATE
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0761','estimate', client_id,'Jacob Petersen','2026-04-20','2026-05-20','outstanding',4.712,0,'$','Customer inquired about going tankless',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0761','Tankless Water Heater Install',
    E'Remove existing tank water heater and haul away\nUpgrade gas line to 3/4 inch for required BTU load\nInstall condensate drain and new venting\nMount tankless unit and connect gas, water, and electrical\nProgram temperature settings and flow rates\nFlush system and test all hot water fixtures\nProvide warranty documentation and maintenance instructions',
    1, 4200, 'flat', 0, '%', true, 0);

  -- INV0762 · Bathroom Remodel Plumbing · ESTIMATE
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0762','estimate', client_id,'Jacob Petersen','2026-04-22','2026-05-22','outstanding',4.712,0,'$','Master bath full remodel rough-in and trim',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0762','Bathroom Remodel – Plumbing',
    E'Demo and remove existing fixtures, supply lines, and drain assemblies\nRough-in new shower valve, tub filler, and drain locations per plan\nInstall new toilet rough-in at updated location\nRun new supply lines for dual vanity and shower\nInstall new tub drain and overflow assembly\nConnect trim kit for shower valve and tub filler\nSet toilet, connect supply, and test all fixtures\nFinal inspection and pressure test entire system',
    1, 6800, 'flat', 0, '%', true, 0);

  -- INV0763 · Sewer Spot Repair · ESTIMATE
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0763','estimate', client_id,'Jacob Petersen','2026-04-25','2026-05-25','outstanding',4.712,0,'$','Follow-up from sewer camera inspection INV0758',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0763','Sewer Spot Repair',
    E'Mark and excavate access to damaged pipe section\nCut out offset joint or cracked section of sewer line\nInstall new PVC pipe and couplings at repair location\nBackfill and compact excavation\nRun post-repair camera to confirm alignment and flow\nRestore landscaping and clean work area\nProvide written warranty on repair',
    1, 2800, 'flat', 0, '%', true, 0);

  -- INV0764 · Toilet Repair · ESTIMATE
  insert into invoices (id, type, client_id, client_name, date, due_date, status, tax, discount, discount_type, notes, year)
  values ('INV0764','estimate', client_id,'Jacob Petersen','2026-04-28','2026-05-28','outstanding',4.712,0,'$','Running toilet, customer will confirm',2026);
  insert into invoice_items (invoice_id, name, desc, qty, price, unit, discount, discount_type, taxable, sort_order)
  values ('INV0764','Toilet Repair',
    E'Diagnose fill valve, flapper, and flush valve for wear or failure\nShut off water supply and drain tank\nReplace fill valve and flapper assembly with new parts\nAdjust float level for proper fill height\nRestore water supply and test flush operation\nCheck for leaks at base and supply line connections',
    1, 295, 'flat', 0, '%', true, 0);

  -- Update next_num to 765
  update settings set value = '765' where key = 'next_num';

end $$;
