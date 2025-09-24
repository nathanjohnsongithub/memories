CREATE OR REPLACE VIEW public.memories_with_author
WITH (security_invoker = on) AS
SELECT
  m.*,
  COALESCE(m.attribution_name, p.display_name, 'Unknown') AS author_name
FROM public.memories m
LEFT JOIN public.profiles p ON p.id = m.created_by;

REVOKE ALL ON public.memories_with_author FROM PUBLIC, anon;
GRANT SELECT ON public.memories_with_author TO authenticated;
