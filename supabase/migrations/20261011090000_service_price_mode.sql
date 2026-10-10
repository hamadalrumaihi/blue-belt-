-- How a package's price is presented on the website:
--   fixed : "350 QAR"            (price_qr required)
--   from  : "from 350 QAR"       (price_qr required; the final price is confirmed with the client)
--   quote : "Quote on request"   (price_qr ignored on the public site)
-- Existing rows keep today's behaviour: a price means "from", no price means "quote".
alter table public.photo_services
  add column if not exists price_mode text not null default 'from'
  check (price_mode in ('fixed', 'from', 'quote'));

update public.photo_services set price_mode = 'quote' where price_qr is null and price_mode = 'from';
