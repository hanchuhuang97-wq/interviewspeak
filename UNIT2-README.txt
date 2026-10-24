Unit 2 · Hello — 部署与启用
============================

这个 zip 已经包含：
- 最新网站代码
- 15 个 Unit 2 音频（assets/unit2/，四句 + 整段，每项黄老师/小伙伴/慢速）
- Supabase 插入 SQL（supabase/unit2.sql）
- 你线上已有的 Supabase 登录配置（assets/auth-config.js）

部署
----
1. 解压这个 zip。
2. 把里面的内容上传到你 Vercel 对应 GitHub 仓库的根目录（与 index.html 同级），
   替换旧文件；不要只上传 UNIT2-README.txt，也不要把整个父文件夹套进去。
3. 提交后等 Vercel 部署完成。
4. 检查音频地址能打开（应返回 200，而不是 404）：
   https://interviewspeak.vercel.app/assets/unit2/01_my_name_teacher.mp3

启用 Unit 2
-----------
5. 打开 Supabase → SQL Editor → New query。
6. 打开仓库里的 supabase/unit2.sql，复制整段运行。
7. 运行下面的查询，确认 Unit 2 是 active：
   select id, title, active, created_at from public.units order by created_at desc;
8. 用学生账号刷新页面，应该看到 Unit 2 · Hello：4 句 + 整段挑战。

注意
----
- 只上传音频或只部署网站都不会切换课程；一定要运行 supabase/unit2.sql。
- SQL 已把旧的 active 单元设为 false，并激活 Unit 2，所以不会叠加。
- Unit 1 仍保留；老师可在「家长设置 → 课程管理（老师）」切回或删除。
- 如果首页还是旧内容，检查线上 index.html 是否引用了 app.js?v=20261018z，并强制刷新。
- 如果登录失效，检查 assets/auth-config.js 是否保留了你原来的 Supabase URL 和 publishable key。
