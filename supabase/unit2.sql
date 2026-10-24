-- Alternative: keep the MP3s in the website's own assets/unit2/ folder.
-- Put the 15 MP3s under assets/unit2/ in your repo and deploy; then run this SQL.
insert into public.units (id, title, title_zh, sentences, challenge, active, created_by)
values (
  'd2f8e7a4-5b3c-4c1e-9a6f-2b7d8e9f0a1b',
  'Unit 2 · Hello',
  'Unit 2 · Hello',
  '[{"id": "s1", "en": "My name is Winnie and I am five years old.", "zh": "我叫 Winnie，今年五岁。", "scene": "assets/img/scene-lesson.svg", "sceneAlt": "An open storybook with stars", "maxSeconds": 20, "audio": {"teacher": "assets/unit2/01_my_name_teacher.mp3", "friend": "assets/unit2/01_my_name_friend.mp3", "slow": "assets/unit2/01_my_name_slow.mp3"}, "durations": {"teacher": 3.48, "friend": 3.94, "slow": 4.1}}, {"id": "s2", "en": "My hobbies are dancing, drawing and playing ball games. They are so fun!", "zh": "我的爱好是跳舞、画画和玩球。它们太好玩了！", "scene": "assets/img/scene-lesson.svg", "sceneAlt": "An open storybook with stars", "maxSeconds": 24, "audio": {"teacher": "assets/unit2/02_my_hobbies_teacher.mp3", "friend": "assets/unit2/02_my_hobbies_friend.mp3", "slow": "assets/unit2/02_my_hobbies_slow.mp3"}, "durations": {"teacher": 5.76, "friend": 7.22, "slow": 6.82}}, {"id": "s3", "en": "My mom''s name is Linda, and my dad''s name is Jack. They are company owners.", "zh": "我妈妈叫 Linda，我爸爸叫 Jack。他们是公司老板。", "scene": "assets/img/scene-lesson.svg", "sceneAlt": "An open storybook with stars", "maxSeconds": 24, "audio": {"teacher": "assets/unit2/03_my_family_teacher.mp3", "friend": "assets/unit2/03_my_family_friend.mp3", "slow": "assets/unit2/03_my_family_slow.mp3"}, "durations": {"teacher": 5.38, "friend": 7.42, "slow": 6.67}}, {"id": "s4", "en": "I come here today to have an interview. Nice to meet you!", "zh": "我今天来参加面试。很高兴认识你！", "scene": "assets/img/scene-lesson.svg", "sceneAlt": "An open storybook with stars", "maxSeconds": 20, "audio": {"teacher": "assets/unit2/04_interview_teacher.mp3", "friend": "assets/unit2/04_interview_friend.mp3", "slow": "assets/unit2/04_interview_slow.mp3"}, "durations": {"teacher": 3.84, "friend": 5.45, "slow": 4.56}}]'::jsonb,
  '{"id": "challenge", "en": "My name is Winnie and I am five years old. My hobbies are dancing, drawing and playing ball games. They are so fun! My mom''s name is Linda, and my dad''s name is Jack. They are company owners. I come here today to have an interview. Nice to meet you!", "zh": "我叫 Winnie，今年五岁。我的爱好是跳舞、画画和玩球。它们太好玩了！我妈妈叫 Linda，我爸爸叫 Jack。他们是公司老板。我今天来参加面试。很高兴认识你！", "scene": "assets/img/scene-lesson.svg", "sceneAlt": "An open storybook with stars", "maxSeconds": 80, "audio": {"teacher": "assets/unit2/full_all_four_teacher.mp3", "friend": "assets/unit2/full_all_four_friend.mp3", "slow": "assets/unit2/full_all_four_slow.mp3"}, "durations": {"teacher": 18.82, "friend": 23.69, "slow": 22.27}}'::jsonb,
  false,
  null
)
on conflict (id) do update set
  title = excluded.title,
  title_zh = excluded.title_zh,
  sentences = excluded.sentences,
  challenge = excluded.challenge,
  active = false;
update public.units set active = false where active = true;
update public.units set active = true where id = 'd2f8e7a4-5b3c-4c1e-9a6f-2b7d8e9f0a1b';
select id, title, active, created_at from public.units order by created_at desc;
