-- TAMÃO discovery: bind private evidence to the actual Storage uploader.
-- No public reads, no service-role bypass, no changes to order/payment flows.
-- The original INSERT policy compared storage.objects.owner_id with itself
-- inside the correlated subquery. Qualify the actor explicitly.
alter policy discovery_document_owner_insert
 on public.discovery_documents
 with check (
  owner_id=(select auth.uid())
  and (select public.discovery_verified_account())
  and split_part(object_path,'/',1)=owner_id::text
  and split_part(object_path,'/',2)=listing_id::text
  and (select public.discovery_document_editable(listing_id::text))
  and exists(
    select 1 from storage.objects o
    where o.bucket_id='tamao-discovery-documents'
      and o.name=discovery_documents.object_path
      and o.owner_id=(select auth.uid())::text
  )
 );

-- A deactivated/unverified advertiser cannot use an old authenticated
-- token to continue accessing private documents. Superadmin oversight
-- retains its existing separately checked administrative privilege.
alter policy discovery_document_owner_or_admin_read
 on public.discovery_documents
 using (
  (owner_id=(select auth.uid()) and (select public.discovery_verified_account()))
  or (select public.discovery_is_superadmin())
 );

alter policy discovery_document_owner_delete
 on public.discovery_documents
 using (
  owner_id=(select auth.uid())
  and (select public.discovery_verified_account())
  and (select public.discovery_document_editable(listing_id::text))
 );
