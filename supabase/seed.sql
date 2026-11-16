-- =====================================================================
-- Seed: subscription plans + starter global bike makes/models
-- Prices are placeholders in KES — edit before launch.
-- Bike model list is a STARTER set: verify and extend with real market data.
-- =====================================================================

insert into public.plans (code, name, price_monthly, price_yearly, max_branches, max_users, max_products, features) values
  ('starter', 'Starter', 1000,  10000, 1,    3,    2000, '{"sms":false,"etims":false}'),
  ('growth',  'Growth',  2500,  25000, 3,    10,   20000,'{"sms":true,"etims":true}'),
  ('chain',   'Chain',   6000,  60000, 10,   50,   null, '{"sms":true,"etims":true,"api":true}')
on conflict (code) do nothing;

insert into public.bike_makes (tenant_id, name) values
  (null,'Bajaj'),(null,'TVS'),(null,'Honda'),(null,'Yamaha'),
  (null,'Haojue'),(null,'Hero'),(null,'Suzuki')
on conflict do nothing;

insert into public.bike_models (tenant_id, make_id, name, engine_cc)
select null, m.id, v.model, v.cc
from (values
  ('Bajaj','Boxer BM100',100), ('Bajaj','Boxer BM150',150), ('Bajaj','Pulsar 150',150),
  ('TVS','HLX 125',125), ('TVS','HLX 150',150), ('TVS','Star City+',110),
  ('Honda','CG125',125), ('Honda','CB125F',125), ('Honda','XR150L',150),
  ('Yamaha','YBR125',125),
  ('Haojue','DK150',150),
  ('Hero','Splendor',100),
  ('Suzuki','GN125',125)
) as v(make, model, cc)
join public.bike_makes m on m.name = v.make and m.tenant_id is null
on conflict do nothing;
