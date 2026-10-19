-- TAMÃO — variações locais por unidade comercial, sem preço ou disponibilidade
-- Uma unidade no carrinho corresponde à embalagem/unidade descrita no nome.
-- A revenda informa e confirma preço e estoque de cada SKU separadamente.
-- Preserva os códigos WOOD, CHARCOAL4 e ICE5 já cadastrados.
-- Não cria anúncios, estoques, cobranças, pedidos, nem ativa a cidade.
insert into public.product_delivery_profiles
 (product_code,product_name,category_key,delivery_class,
  requires_isolated_delivery,active,customer_visible,merchant_add_allowed,sort_order)
values
  ('WOOD_SACK','Lenha — saco','barbecue','household_general',false,true,true,true,312),
  ('WOOD_100','Lenha — cento de peças','barbecue','household_general',false,true,true,true,313),
  ('WOOD_1000','Lenha — milheiro de peças','barbecue','household_general',false,true,true,true,314),
  ('CHARCOAL2','Carvão — saco 2 kg','barbecue','household_general',false,true,true,true,301),
  ('CHARCOAL3','Carvão — saco 3 kg','barbecue','household_general',false,true,true,true,302),
  ('CHARCOAL5','Carvão — saco 5 kg','barbecue','household_general',false,true,true,true,303),
  ('CHARCOAL8','Carvão — saco 8 kg','barbecue','household_general',false,true,true,true,304),
  ('CHARCOAL10','Carvão — saco 10 kg','barbecue','household_general',false,true,true,true,305),
  ('ICE2','Gelo em cubos — saco 2 kg','ice','household_general',false,true,true,true,401),
  ('ICE3','Gelo em cubos — saco 3 kg','ice','household_general',false,true,true,true,402),
  ('ICE10','Gelo em cubos — saco 10 kg','ice','household_general',false,true,true,true,403),
  ('ICE_CRUSH5','Gelo triturado — saco 5 kg','ice','household_general',false,true,true,true,404),
  ('ICE_BLOCK','Gelo em barra — unidade','ice','household_general',false,true,true,true,405),
  ('ICE_BLOCK10','Gelo em barra — 10 kg','ice','household_general',false,true,true,true,406),
  ('ICE_BLOCK20','Gelo em barra — 20 kg','ice','household_general',false,true,true,true,407)
on conflict (product_code) do nothing;
