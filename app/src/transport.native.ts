import { fetch } from 'expo/fetch';
import type { HttpAgentFetchFn } from '@ag-ui/client';
export const transport: HttpAgentFetchFn = (url, init) => fetch(url, init);
