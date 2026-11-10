import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Octokit} from 'octokit';
import {GitHubConnection, GitHubUnavailable} from '../server/github';

type Reply = {status: number; body: unknown; headers?: Record<string, string>};
type ApiRequest = {url: URL; method: string; headers: Headers};

function repository(id: number, name = `repo-${id}`) {
  return {id, name, full_name: `owner/${name}`, html_url: `https://github.com/owner/${name}`,
    default_branch: 'main', archived: false, disabled: false, private: true, owner: {login: 'owner'}};
}
function connection(respond: (request: ApiRequest) => Reply | Promise<Reply>, login = 'owner') {
  const requests: ApiRequest[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const observed = {url: new URL(request.url), method: request.method, headers: request.headers};
    assert.equal(observed.url.origin, 'https://api.github.com', 'The adapter must only request GitHub API fixture URLs');
    requests.push(observed);
    const reply = await respond(observed);
    return new Response(JSON.stringify(reply.body), {status: reply.status,
      headers: {'Content-Type': 'application/json', ...reply.headers}});
  };
  const client = new Octokit({auth: 'fixture-token', request: {fetch: transport}, retry: {enabled: false},
    throttle: {enabled: false}, log: {debug() {}, info() {}, warn() {}, error() {}}});
  return {github: new GitHubConnection(client, login), requests};
}
function unavailable(code: GitHubUnavailable['code']) {
  return (error: unknown) => error instanceof GitHubUnavailable && error.code === code;
}
const missing = {status: 404, body: {message: 'Not Found'}};

test('repository discovery consumes GitHub pagination and presents searchable owner pages', async () => {
  const {github, requests} = connection(({url, headers}) => {
    assert.equal(headers.get('authorization'), 'token fixture-token');
    if (url.pathname === '/user') return {status: 200, body: {login: 'OWNER'}};
    assert.equal(url.pathname, '/user/repos');
    assert.equal(url.searchParams.get('per_page'), '100');
    assert.equal(url.searchParams.get('affiliation'), 'owner,collaborator,organization_member');
    if (url.searchParams.get('page') === '2') return {status: 200, body: [repository(101), repository(102)]};
    return {status: 200, body: Array.from({length: 100}, (_, index) => repository(index + 1)),
      headers: {link: '<https://api.github.com/user/repos?per_page=100&page=2&affiliation=owner%2Ccollaborator%2Corganization_member>; rel="next"'}};
  });
  const first = await github.repositories('', 1, true);
  assert.equal(first.repositories.length, 30);
  assert.equal(first.repositories[0]?.id, 1);
  assert.equal(first.has_more, true);
  const last = await github.repositories('', 4, false);
  assert.deepEqual(last.repositories.map(repo => repo.id), Array.from({length: 12}, (_, index) => index + 91));
  assert.equal(last.has_more, false);
  assert.deepEqual(await github.repositories('OWNER/REPO-102', 1, false), {
    repositories: [{id: 102, name: 'repo-102', full_name: 'owner/repo-102', html_url: 'https://github.com/owner/repo-102', default_branch: 'main'}],
    page: 1, has_more: false,
  });
  assert.deepEqual(await github.repositories('no-matches', 1, false), {repositories: [], page: 1, has_more: false});
  assert.deepEqual(await github.repositories('', 5, false), {repositories: [], page: 5, has_more: false});
  assert.equal(requests.filter(request => request.url.pathname === '/user/repos').length, 2);
});

test('repository identity survives a GitHub rename and discovery deduplicates the stable ID', async () => {
  let renamed = false;
  const {github, requests} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/user/repos') return {status: 200, body: renamed
      ? [repository(42, 'before'), repository(42, 'after'), {...repository(43), disabled: true}]
      : [repository(42, 'before')]};
    if (url.pathname === '/repositories/42') return {status: 200, body: repository(42, renamed ? 'after' : 'before')};
    return missing;
  });
  assert.equal((await github.repositories('', 1, true)).repositories[0]?.full_name, 'owner/before');
  renamed = true;
  assert.deepEqual(await github.repository(42), {
    id: 42, name: 'after', full_name: 'owner/after', html_url: 'https://github.com/owner/after', default_branch: 'main',
  });
  const refreshed = await github.repositories('', 1, true);
  assert.deepEqual(refreshed.repositories.map(repo => [repo.id, repo.full_name]), [[42, 'owner/after']]);
  assert.ok(requests.some(request => request.url.pathname === '/repositories/42'));
});

test('cached membership never authorizes a repository after access is lost', async () => {
  let accessible = true;
  const {github, requests} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/user/repos') return {status: 200, body: [repository(42)]};
    if (url.pathname === '/repositories/42' && accessible) return {status: 200, body: repository(42)};
    return missing;
  });
  await github.repositories('', 1, true);
  assert.equal((await github.repository(42)).id, 42);
  accessible = false;
  await assert.rejects(github.repository(42), unavailable('repository_access_lost'));
  await assert.rejects(github.context(42), unavailable('repository_access_lost'));
  assert.equal(requests.filter(request => request.url.pathname.includes('/contents/')).length, 0);
  assert.equal((await github.repositories('', 1, false)).repositories[0]?.id, 42,
    'Historical catalog metadata remains available without becoming read permission');
});

test('a configured owner identity mismatch stops discovery and repository access', async () => {
  const {github, requests} = connection(() => ({status: 200, body: {login: 'another-owner'}}));
  await assert.rejects(github.repositories('', 1, true), unavailable('github_identity_mismatch'));
  await assert.rejects(github.repository(42), unavailable('github_identity_mismatch'));
  assert.deepEqual(requests.map(request => request.url.pathname), ['/user', '/user']);
});

test('interrupted paginated refresh reports unavailable and preserves the previous complete catalog', async () => {
  let generation = 0;
  const {github} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/user/repos' && generation === 0) return {status: 200, body: [repository(1, 'retained')]};
    if (url.searchParams.get('page') === '2') return {status: 503, body: {message: 'Service unavailable'}};
    return {status: 200, body: [repository(2, 'partial')],
      headers: {link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next"'}};
  });
  await github.repositories('', 1, true);
  generation = 1;
  await assert.rejects(github.repositories('', 1, true), unavailable('github_unavailable'));
  assert.deepEqual((await github.repositories('', 1, false)).repositories.map(repo => repo.full_name), ['owner/retained']);
});

test('project source context binds actual UTF-8 bytes and every file request to one exact GitHub commit', async () => {
  const commit = 'a1'.repeat(20);
  const text = '# Alpha\nCafé owners run builds.\n';
  const {github, requests} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/repositories/42') return {status: 200, body: repository(42, 'alpha')};
    if (url.pathname === '/repos/owner/alpha/commits/main') return {status: 200, body: {sha: commit, commit: {message: 'fixture'}}};
    if (url.pathname === '/repos/owner/alpha/contents/README.md') return {status: 200, body: {
      type: 'file', encoding: 'base64', content: Buffer.from(text).toString('base64'), size: Buffer.byteLength(text),
    }};
    return missing;
  });
  const context = await github.context(42);
  assert.equal(context.repository.id, 42);
  assert.equal(context.commit, commit);
  assert.deepEqual(context.files, [{path: 'README.md', commit,
    content_sha256: '6a47364dad875c341f5d406c81b679966c4a2953563fbb991eda20eb2a10fd51', content: text}]);
  const reads = requests.filter(request => request.url.pathname.includes('/contents/'));
  assert.equal(reads.length, 4);
  assert.ok(reads.every(request => request.url.searchParams.get('ref') === commit));
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('source context rejects mismatched identity and records malformed source gaps', async () => {
  let mismatched = true;
  const {github} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/repositories/42') return {status: 200, body: repository(mismatched ? 99 : 42, 'alpha')};
    if (url.pathname === '/repos/owner/alpha/commits/main') return {status: 200, body: {sha: 'b'.repeat(40)}};
    if (url.pathname.endsWith('/README.md')) return {status: 200, body: {type: 'file', encoding: 'base64', content: 'YWJj', size: 99}};
    return missing;
  });
  await assert.rejects(github.context(42), unavailable('repository_unavailable'));
  mismatched = false;
  const context = await github.context(42);
  assert.deepEqual(context.files, []);
  assert.ok(context.unavailable_files.some(file => file.path === 'README.md' && file.reason === 'invalid_content'));
});


test('unreadable selected files are explicit gaps without rewriting repository membership', async () => {
  const {github} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/repositories/42') return {status: 200, body: repository(42, 'alpha')};
    if (url.pathname.includes('/commits/')) return {status: 200, body: {sha: 'b'.repeat(40)}};
    if (url.pathname.endsWith('/README.md')) return {status: 200, body: {type: 'file', encoding: 'base64', content: Buffer.from([0xff]).toString('base64'), size: 1}};
    if (url.pathname.endsWith('/AGENTS.md')) return {status: 200, body: {type: 'symlink', target: 'elsewhere'}};
    return missing;
  });
  const captured = await github.context(42);
  assert.equal(captured.repository.id, 42);
  assert.deepEqual(captured.files, []);
  assert.deepEqual(captured.unavailable_files.map(file => file.reason), ['invalid_utf8', 'unsupported_type', 'missing', 'missing']);
});

test('new project reads require contents permission at the frozen commit after metadata remains accessible', async () => {
  const commit = 'd'.repeat(40);
  const {github, requests} = connection(({url}) => {
    if (url.pathname === '/user') return {status: 200, body: {login: 'owner'}};
    if (url.pathname === '/repositories/42') return {status: 200, body: repository(42, 'alpha')};
    return {status: 403, body: {message: 'Resource not accessible by integration'}};
  });
  assert.equal((await github.repository(42)).id, 42);
  await assert.rejects(github.assertReadable(42, commit, 'README.md'), error => error instanceof GitHubUnavailable && error.code === 'repository_access_lost' && error.status === 403);
  assert.ok(requests.some(request => request.url.pathname.endsWith('/contents/README.md') && request.url.searchParams.get('ref') === commit));
});
