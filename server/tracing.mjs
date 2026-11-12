// Preloaded with --import so dd-trace hooks module loading before server/main.ts imports anything.
// Unless DD_TRACE_ENABLED is exactly "true", nothing is loaded and nothing changes.
if (process.env.DD_TRACE_ENABLED === 'true') {
  process.env.DD_SERVICE ||= 'forge-gateway';
  Object.assign(process.env, {
    // Remote configuration could later turn on header tags, AppSec or dynamic instrumentation.
    DD_REMOTE_CONFIGURATION_ENABLED: 'false',
    DD_APPSEC_ENABLED: 'false',
    DD_IAST_ENABLED: 'false',
    DD_DYNAMIC_INSTRUMENTATION_ENABLED: 'false',
    DD_TRACE_HEADER_TAGS: '',
    DD_TRACE_CLIENT_IP_ENABLED: 'false',
    DD_TRACE_BAGGAGE_TAG_KEYS: '',
    DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP: '.*',
    // Child process spans record full argv.
    DD_TRACE_CHILD_PROCESS_ENABLED: 'false',
  });
  await import('dd-trace/initialize.mjs');
}
