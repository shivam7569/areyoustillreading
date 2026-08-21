-- =============================================================================
-- db/sitemap-entries.sql — public.sitemap_entries: every DB-served permalink for the edge sitemap
-- (functions/sitemap-posts.xml). The @astrojs/sitemap build output covers the STATIC routes;
-- content.posts is served at runtime (/@handle/slug), so those URLs need a runtime sitemap.
-- Returns paths (the Function prefixes the origin) + a lastmod. Published/public only. Idempotent.
-- Apply: node --env-file=.env scripts/apply-sql.mjs db/sitemap-entries.sql
-- =============================================================================
drop function if exists public.sitemap_entries();
create or replace function public.sitemap_entries()
returns table (loc text, lastmod timestamptz)
language sql stable security definer set search_path = content, public, extensions as $$
  -- every published essay
  select '/@' || pr.handle::text || '/' || po.slug, greatest(po.pub_date, po.updated_at)
  from content.posts po
  join content.profiles pr on pr.id = po.author_id
  where po.status = 'published' and po.visibility = 'public' and po.deleted_at is null
  union all
  -- each author who has published work (their /@handle page)
  select distinct '/@' || pr.handle::text, null::timestamptz
  from content.profiles pr
  where pr.handle is not null
    and exists (select 1 from content.posts po
                where po.author_id = pr.id and po.status = 'published'
                  and po.visibility = 'public' and po.deleted_at is null)
  order by 2 desc nulls last;
$$;
grant execute on function public.sitemap_entries() to anon, authenticated;
notify pgrst, 'reload schema';
