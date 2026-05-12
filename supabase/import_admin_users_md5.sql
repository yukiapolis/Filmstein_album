update public.admin_users
set is_active = false,
    updated_at = timezone('utc', now())
where lower(username) in ('filmstein', 'test');

insert into public.admin_users (username, password)
values
  ('fkun', '1f1bea267ae8548344114a01da1b2512'),
  ('schorsch', 'e89414fd8816e7392173c551090ca830'),
  ('luming', '750201ff921e4d470bfbf89c3fc2f930'),
  ('王纪元', 'aad33064eaf6c78846b6fc1e5f81319d'),
  ('HUAZE', 'ab3a1519b488d183451d10c430b22867'),
  ('nw7608s', 'a45cf6b077be365d6270233d9662b1e2'),
  ('yuki', 'b45abdcbb1d70b9e3150816326b3c362'),
  ('leoyang', '8f780dde27899112c5357d76f060111f'),
  ('beasley_zhang', 'd8db6ca9c4abd33a7420c0b4f7c78e30'),
  ('revelinlife_win9', 'da777ac59d0f79f8b68ad97057cfd2ca'),
  ('mumu', 'f9a250c8ea02a695d4b244e459cf3da3'),
  ('会计', 'b78ae18ba9a0c5f4c5f8282433b538c4'),
  ('cyber_liam', 'f317521537cd1be1c6b875e83307809d'),
  ('刘昌宇', 'bbef8a606baa0b1ea6c133712725d0eb'),
  ('SimonTang', '8fb042134a3d36e3ec57946a43e334ae'),
  ('boxinbu', 'cf4208a95b53a03540ad3fef407bd8e1'),
  ('2438247983', '54d71dbbb8ec836987163e3d72265401'),
  ('Trunkenbold', 'd689302ceb05db73d7d26270391f3e5b'),
  ('张剑', '1f5a69724b5f4111e0ea9e5d0df5603e'),
  ('张佳', '9a932f5891281a2d2d5613dfcaa70ca0'),
  ('antonioluo', '244465f1efdc376ea6f1f9b3f5473db0'),
  ('ronghe', '7e36cf429844d65223ed9400cfdcc2cf'),
  ('Hydrogen', '1cabab27ee567065f72598ad1cb32af6'),
  ('Phoebe', 'b5e38ccb2714b9ab4be6b735d4054fbe')
on conflict ((lower(username))) do update
set password = excluded.password,
    updated_at = timezone('utc', now());

update public.admin_users
set is_active = true,
    role = case when lower(username) = 'fkun' then 'super_admin' else coalesce(role, 'admin') end,
    updated_at = timezone('utc', now())
where lower(username) in (
  'fkun', 'schorsch', 'luming', '王纪元', 'huaze', 'nw7608s', 'yuki', 'leoyang',
  'beasley_zhang', 'revelinlife_win9', 'mumu', '会计', 'cyber_liam', '刘昌宇',
  'simontang', 'boxinbu', '2438247983', 'trunkenbold', '张剑', '张佳', 'antonioluo',
  'ronghe', 'hydrogen', 'phoebe'
);
