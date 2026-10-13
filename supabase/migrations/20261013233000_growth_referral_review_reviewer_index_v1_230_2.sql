-- TAMÃO V1.230.2: cover the administrative reviewer foreign key.
create index if not exists growth_referral_reviews_reviewer_v1_230_2
 on public.growth_referral_reviews_v1_230(reviewer_user_id);
