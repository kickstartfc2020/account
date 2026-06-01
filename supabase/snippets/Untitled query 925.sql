begin;

with new_user as (
insert into auth.users (
instance_id,
id,
aud,
role,
email,
encrypted_password,
email_confirmed_at,
raw_app_meta_data,
raw_user_meta_data,
created_at,
updated_at,
confirmation_token,
email_change,
email_change_token_new,
recovery_token
)
values (
'00000000-0000-0000-0000-000000000000',
gen_random_uuid(),
'authenticated',
'authenticated',
'admin@example.com',
crypt('Admin@123456', gen_salt('bf')),
now(),
'{"provider":"email","providers":["email"]}',
'{"full_name":"Admin User"}',
now(),
now(),
'',
'',
'',
''
)
returning id
)
insert into public.profiles (
id,
role,
full_name,
status,
created_at,
updated_at
)
select
id,
'super_admin',
'Admin User',
'active',
now(),
now()
from new_user;

commit;