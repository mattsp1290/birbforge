import type { HttpAgentFetchFn } from '@ag-ui/client';
export const transport: HttpAgentFetchFn = (url, init) => globalThis.fetch(url, init);
