alter table public.ppl
  add column if not exists data_aplicarii_regimului_provizoriu date
  generated always as (data_depunerii + 21) stored;

create index if not exists ppl_data_aplicarii_regimului_provizoriu_idx
  on public.ppl (data_aplicarii_regimului_provizoriu);

comment on column public.ppl.data_aplicarii_regimului_provizoriu is
  'Ziua 22: data depunerii + 21 zile calendaristice. Ziua depunerii este Ziua 1; Ziua 21 ramane ultima zi a carantinei.';
