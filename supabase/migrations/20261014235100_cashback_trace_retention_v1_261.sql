-- V1.261: keep trace events immutable on updates while preserving standard FK cascades.
drop trigger if exists cashback_trace_events_immutable_v1_261 on public.platform_cashback_trace_events_v1_261;
drop trigger if exists cashback_trace_flows_immutable_v1_261 on public.platform_cashback_trace_flows_v1_261;
create trigger cashback_trace_events_immutable_v1_261 before update on public.platform_cashback_trace_events_v1_261 for each row execute function platform_cashback_trace_private_v1_261.immutable();
create trigger cashback_trace_flows_immutable_v1_261 before update on public.platform_cashback_trace_flows_v1_261 for each row execute function platform_cashback_trace_private_v1_261.immutable();
