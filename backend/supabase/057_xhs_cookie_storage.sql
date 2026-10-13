-- 057 小红书登录态本地加密存储:内置浏览器提取的 Cookie 在独立服务未部署时也能保存
alter table public.xhs_connections
    add column if not exists cookie_ciphertext text;

notify pgrst, 'reload schema';
