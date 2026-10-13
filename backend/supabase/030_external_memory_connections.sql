-- Per-tenant external memory connections.
--
-- External credentials remain in the existing server-only MCP vault.  The
-- browser never receives secret_ciphertext and external Supabase access is
-- restricted by the backend to the dedicated read-only `dengta_memories`
-- table in the user's external project.

alter table public.mcp_connections
    add column if not exists connection_type text not null default 'mcp_device';

alter table public.mcp_connections
    add column if not exists connection_config jsonb not null default '{}'::jsonb;

alter table public.mcp_connections
    drop constraint if exists mcp_connections_connection_type_check;

alter table public.mcp_connections
    add constraint mcp_connections_connection_type_check
    check (connection_type in (
        'mcp_device',
        'ombre_brain_mcp',
        'supabase_memory'
    ));

create unique index if not exists mcp_connections_tenant_external_type_uidx
    on public.mcp_connections (user_id, companion_id, connection_type)
    where connection_type in ('ombre_brain_mcp', 'supabase_memory');

comment on column public.mcp_connections.connection_type is
    'Tenant connection kind. External-memory kinds have one row per tenant.';

comment on column public.mcp_connections.connection_config is
    'Non-secret, backend-validated connection metadata. Never store credentials here.';

alter table public.memories
    add column if not exists external_source_type text;

alter table public.memories
    add column if not exists external_source_id text;

alter table public.memories
    drop constraint if exists memories_external_source_pair_check;

alter table public.memories
    add constraint memories_external_source_pair_check
    check (
        (external_source_type is null and external_source_id is null)
        or
        (
            external_source_type in ('supabase_memory')
            and char_length(external_source_id) between 1 and 240
        )
    );

drop index if exists public.memories_tenant_external_source_uidx;
create unique index memories_tenant_external_source_uidx
    on public.memories (
        user_id,
        companion_id,
        external_source_type,
        external_source_id
    );

comment on column public.memories.external_source_type is
    'Optional safe import source marker; never contains a credential.';

comment on column public.memories.external_source_id is
    'Stable hashed-project/source identifier for idempotent external imports.';
