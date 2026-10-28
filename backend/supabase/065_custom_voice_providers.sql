-- DengTa Home: user-supplied speech providers (BYO TTS).
-- Apply after 027 (voice_provider_profiles). Safe to re-run.
--
-- Users can now choose:
--   edge              Edge Read Aloud free neural voices (no API key)
--   openai_compatible any /audio/speech compatible endpoint
--   custom_http       arbitrary HTTP TTS API (custom headers/body, binary/base64/url response)
-- Existing rows keep provider = 'server_default' / 'deepgram' and behave as before.

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_provider_check;

alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_provider_check
    check (provider in ('server_default', 'deepgram', 'edge', 'openai_compatible', 'custom_http'));

alter table public.voice_provider_profiles
    add column if not exists api_base_url text not null default '',
    add column if not exists voice_id text not null default '',
    add column if not exists output_format text not null default 'mp3',
    add column if not exists rate numeric(4, 1) not null default 0,
    add column if not exists pitch numeric(4, 1) not null default 0,
    add column if not exists volume numeric(4, 1) not null default 0,
    add column if not exists method text not null default 'POST',
    add column if not exists headers_template text not null default '',
    add column if not exists body_template text not null default '',
    add column if not exists response_mode text not null default 'binary',
    add column if not exists audio_path text not null default '',
    add column if not exists mime_type text not null default '';

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_output_format_check;
alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_output_format_check
    check (output_format in ('mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'));

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_response_mode_check;
alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_response_mode_check
    check (response_mode in ('binary', 'json_base64', 'json_url'));

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_method_check;
alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_method_check
    check (method in ('GET', 'POST', 'PUT', 'PATCH'));

comment on column public.voice_provider_profiles.api_base_url is
    'User-supplied TTS endpoint (https public by default; self-hosted may allow http/private via env).';
comment on column public.voice_provider_profiles.voice_id is
    'Provider-specific voice/model id (Edge voice name, OpenAI voice, etc.).';
comment on column public.voice_provider_profiles.headers_template is
    'Custom HTTP headers JSON template. Only returned to the owning account.';
comment on column public.voice_provider_profiles.body_template is
    'Custom HTTP body template with {{text}} / {{text_json}} / {{voice}} / {{api_key}} placeholders.';

notify pgrst, 'reload schema';

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_speed_check;
alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_speed_check
    check (speed between 0.25 and 4.00);

comment on column public.voice_provider_profiles.speed is
    'Playback speed. Deepgram keeps 0.70-1.50 in code; other providers may use 0.25-4.00.';
