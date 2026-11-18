-- TAMÃO Agenda V1.1070: separate anonymous vs authenticated RLS read paths.
-- Anonymous browsers cannot SELECT agenda_pages, even from a subquery in a policy.
-- Keep owner writes unchanged; no grants to private tables or booking/financial objects.
drop policy if exists agenda_design_public_select on public.agenda_page_design;
drop policy if exists agenda_design_authenticated_select on public.agenda_page_design;

create policy agenda_design_public_select
 on public.agenda_page_design for select to anon
 using ((select tamao_acl.agenda_design_published(page_id)));

create policy agenda_design_authenticated_select
 on public.agenda_page_design for select to authenticated
 using (
  (select tamao_acl.agenda_design_published(page_id))
  or exists (
   select 1 from public.agenda_pages p
   where p.id=agenda_page_design.page_id and p.owner_id=(select auth.uid())
  )
 );

-- Users may update the rows they own through the existing owner-scoped
-- insert/update policies. Visitors still have no write privileges.
