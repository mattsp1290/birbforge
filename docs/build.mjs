import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const root = dirname(fileURLToPath(import.meta.url));
const pages = [
  ['design-checkpoint', 'System overview', 'Understand', 'The agreed behavior, components and implementation order.'],
  ['pstack-foundations', 'Why pstack', 'Understand', 'The practices we borrow and the platform work they leave to us.'],
  ['repository-owners', 'Repository map', 'Understand', 'One accountable owner per repository, with explicit dependencies.'],
  ['ag-ui-architecture', 'AG-UI everywhere', 'Contracts', 'One interaction protocol across coworkers, conversation and inbox.'],
  ['beans-integration', 'Beans and shared work', 'Contracts', 'Authored work has one home. Execution and approval have separate owners.'],
  ['verification-contract', 'Verification & evidence', 'Contracts', 'What a worker must establish before a candidate can satisfy delivery policy.'],
  ['design-decisions', 'Decision register', 'Contracts', 'The full accepted product behavior and its remaining deployment gates.'],
  ['runtime-recommendation', 'Runtime choice', 'Research', 'Why Temporal and Pydantic AI are the first combination to prove.'],
  ['component-options', 'Build less, reuse more', 'Research', 'Evaluated components, tradeoffs and primary sources.'],
  ['start-repository-owner', 'Start an owner', 'Build', 'Codex implementation with fresh Claude CLI review. Birbcrew goes first.'],
  ['birbcrew-first-milestone', '01 · Birbcrew', 'Build', 'Prove durable conversations before downstream product work.', '../../birbcrew/docs/first-milestone.md'],
  ['first-milestone', '02 · Birbforge', 'Build', 'One conversation and one input decision across phone and browser.'],
  ['birbverify-first-milestone', '03 · Birbverify', 'Build', 'Prove attributable execution and recovery before real staging admission.', '../../birbverify/docs/first-milestone.md'],
  ['durable-verification-queue', '04 · Durable verification', 'Build', 'The pinned fixture queue, immutable results, recovery, and evidence gates.'],
  ['integration-briefs', 'Existing repositories', 'Build', 'Bounded work for Beans, Birbhomes and the Birbparty pilot.'],
];
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const slug = s => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
await mkdir(join(root, 'assets'), { recursive: true });

function svgFrame(id, title, description, body, height = 570) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${title}</title><desc id="${id}-desc">${description}</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="#91a59d"/></marker></defs><style>text{font-family:ui-sans-serif,system-ui,sans-serif;fill:#eef5f0}.label{font-size:19px;font-weight:650}.sub{font-size:14px;fill:#afc0b8}.box{fill:#16231f;stroke:#426458;stroke-width:1.5;rx:12}.line{fill:none;stroke:#91a59d;stroke-width:1.5;marker-end:url(#arrow)}.accent{fill:#c3ee91}</style><rect width="940" height="${height}" fill="#101a15"/>${body}</svg>`;
}
function box(x,y,w,title,sub) {return `<rect class="box" x="${x}" y="${y}" width="${w}" height="76"/><text class="label" x="${x+18}" y="${y+30}">${title}</text><text class="sub" x="${x+18}" y="${y+55}">${sub}</text>`;}
const line = d => `<path class="line" d="${d}"/>`;
const diagrams = {
  architecture: svgFrame('architecture', 'Factory component and delivery map', 'Phone and browser use AG-UI through Birbforge to Birbcrew. Birbcrew reads scoped Beans notes. Temporal coordinates authors, candidate PR review and verification on shared k3s staging. Gates recheck approvals before existing CI deploys and the owner observes production health.',
    box(310,15,320,'Phone + Mac browser','Conversation and the decision inbox')+
    box(310,135,320,'Birbforge','Policy, actions and delivery ownership')+
    box(20,135,240,'Beans','Authored work and shared notes')+
    box(680,135,240,'Birbcrew','Pydantic AI · durable AG-UI')+
    box(310,250,320,'Temporal','Delivery + coworker workflows')+
    box(20,365,250,'Cloud authors','Eligible subscriptions')+
    box(345,365,250,'Candidate PR + review','Independent review · exact SHA')+
    box(670,365,250,'Birbverify','Linux + native Mac activities')+
    box(670,485,250,'Shared k3s staging','Deploy · check · clean up')+
    box(345,485,250,'Recheck merge gates','Evidence + required approvals')+
    box(20,485,250,'Existing CI + health','Owner observes; pup + Datadog')+
    line('M470 91V135')+line('M310 173H260')+line('M630 173H680')+
    line('M800 135V115H140V135')+line('M470 211V250')+
    line('M800 211V288H630')+line('M390 326V345H145V365')+
    line('M270 403H345')+line('M595 403H670')+line('M795 441V485')+
    line('M670 523H595')+line('M345 523H270')+
    `<text class="sub" x="490" y="108">AG-UI</text><text class="sub" x="680" y="100">Scoped note reads</text>`, 590),
  interaction: svgFrame('interaction', 'AG-UI through the authenticated gateway', 'Client A starts a conversation through Birbforge. Birbcrew returns events through Birbforge. Client B later resolves the same request by ID and version. Responses again pass through the gateway. The isolated first Birbcrew proof tests this contract without the full Birbforge app.',
    box(10,20,200,'Client A','Phone or browser')+
    box(250,20,210,'Birbforge','Authenticated gateway')+
    box(500,20,210,'Birbcrew','Durable conversation')+
    box(750,20,180,'Client B','Second device')+
    `<path d="M110 110V620M355 110V620M605 110V620M840 110V620" stroke="#31473d" stroke-dasharray="4 7" fill="none"/>`+
    line('M110 155H355')+`<text class="sub" x="120" y="142">Input + request ID</text>`+
    line('M355 210H605')+`<text class="sub" x="370" y="197">Authorized durable run</text>`+
    line('M605 275H355')+`<text class="sub" x="370" y="262">AG-UI events</text>`+
    line('M355 330H110')+`<text class="sub" x="120" y="317">Forward messages + state</text>`+
    line('M840 405H355')+`<text class="sub" x="430" y="392">Answer same request by ID + version</text>`+
    line('M355 465H605')+`<text class="sub" x="370" y="452">Authorized resolution</text>`+
    line('M605 525H355')+`<text class="sub" x="370" y="512">Authoritative state</text>`+
    line('M355 585H840')+`<text class="sub" x="430" y="572">Snapshot + subsequent events to Client B</text>`+
    `<text class="accent" x="20" y="655" font-size="17">Disconnect ≠ cancel. Client state ≠ approval.</text>`, 680),
  verification: svgFrame('verification', 'Verification reservation lifecycle', 'An immutable request waits for staging, then deploys, checks identity, verifies journeys, persists evidence and cleans up. Only confirmed cleanup releases staging. Worker loss or uncertain ownership quarantines the environment.',
    box(25,20,260,'Admit exact candidate','Commit + plan + policy revision')+
    box(340,20,260,'Wait for staging','Birbforge Temporal workflow')+
    box(655,20,260,'Reserve environment','Fence stale mutation attempts')+
    box(655,175,260,'Deploy and identify','Pinned artifacts; observe revision')+
    box(340,175,260,'Run journeys','Repository tests + native checks')+
    box(25,175,260,'Persist evidence','Assertions + private artifacts')+
    box(25,330,260,'Reconcile cleanup','Stop workers and remove fixtures')+
    box(340,330,260,'Release or quarantine','Unknown stop keeps gate shut')+
    box(655,330,260,'Evaluate delivery','Fresh evidence + separate approvals')+
    line('M285 58H340')+line('M600 58H655')+line('M785 96V175')+
    line('M655 213H600')+line('M340 213H285')+line('M155 251V330')+
    line('M285 368H340')+line('M600 368H655')+
    `<text class="sub" x="25" y="465">The reservation spans deployment, Linux and Mac checks, evidence, and cleanup.</text><text class="accent" x="25" y="505" font-size="17">A passed assertion set does not excuse failed cleanup.</text>`,535),
};
for (const [name, svg] of Object.entries(diagrams)) await writeFile(join(root, 'assets', `${name}.svg`), svg);
const diagramFor = {'design-checkpoint':'architecture','component-options':'architecture','ag-ui-architecture':'interaction','verification-contract':'verification'};
function diagram(name) { return `<figure class="diagram"><div class="diagram-scroll" tabindex="0" aria-label="Scrollable system diagram"><img src="assets/${name}.svg" alt="${{architecture:'Factory component map',interaction:'AG-UI interaction and authority',verification:'Verification reservation lifecycle'}[name]}"/></div><figcaption>Design diagram · <a href="assets/${name}.svg">Open full size</a></figcaption></figure>`; }
function nav(current) {
  let group='';
  return `<a class="brand" href="index.html"><span class="mark" aria-hidden="true">b/</span><span>birbforge<small>FACTORY FIELD GUIDE</small></span></a><label class="find">Find a page<input type="search" id="page-search" placeholder="Try “verification”" autocomplete="off"></label><nav aria-label="Documentation"><a class="nav-link ${current==='index'?'selected':''}" ${current==='index'?'aria-current="page"':''} href="index.html">Start here</a>${pages.map(([id,title,g])=>{const header=g!==group?`<div class="nav-group">${g}</div>`:''; group=g; return `${header}<a class="nav-link ${id===current?'selected':''}" ${id===current?'aria-current="page"':''} href="${id}.html">${title}</a>`;}).join('')}<p id="no-pages" hidden>No matching pages.</p></nav><div class="sidebar-foot">First UI proof recorded<br>Durable queue evidence pending.</div>`;
}
function shell(id,title,summary,body,toc=[], group='Field guide') {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="${esc(summary)}"><title>${esc(title)} · Birbforge</title><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/site.css"><script src="assets/site.js" defer></script></head><body><a class="skip" href="#main">Skip to content</a><div class="reading-progress" aria-hidden="true"></div><header class="topbar"><a href="index.html">birbforge <span>/ ${esc(group)}</span></a><div><button id="focus-mode" type="button" aria-pressed="false">Focus view</button><button id="nav-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Browse docs</button></div></header><aside id="sidebar" class="sidebar">${nav(id)}</aside><main id="main"><div class="page-heading"><div class="eyebrow">${esc(group)} <span>· DESIGN RECORD</span></div><h1>${esc(title)}</h1><p class="lead">${esc(summary)}</p></div>${body}<footer><p>Birbforge / private factory, public workflow.</p><p>Design and milestone documentation. Evidence applies to its recorded revision.</p><a href="#main">Back to top ↑</a></footer></main>${toc.length?`<aside class="contents"><div class="eyebrow">On this page</div><nav aria-label="On this page">${toc.map(([id,text])=>`<a href="#${id}">${text}</a>`).join('')}</nav></aside>`:''}</body></html>`;
}
for (const [id,title,group,summary,path] of pages) {
  let source = await readFile(join(root,path || `${id}.md`),'utf8');
  source=source.replace(/^# .+\n/, '');
  const toc=[], counts=new Map();
  const renderer=new marked.Renderer();
  renderer.heading=function(token) {
    const text=this.parser.parseInline(token.tokens);
    const base=slug(token.text), count=counts.get(base)||0; counts.set(base,count+1);
    const key=count?`${base}-${count}`:base;
    if(token.depth===2) toc.push([key,text.replace(/<[^>]*>/g,'')]);
    return `<h${token.depth} id="${key}">${text}<a class="anchor" href="#${key}" aria-label="Link to ${esc(token.text)}">#</a></h${token.depth}>`;
  };
  renderer.link=function(token) {
    const isExternal = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(token.href);
    const href = isExternal ? token.href : token.href.replace(/\.md(?=#|$)/, '.html');
    return `<a href="${esc(href)}">${this.parser.parseInline(token.tokens)}</a>`;
  };
  renderer.code=function(token) {
    if (token.lang === 'mermaid') {
      const drawing = diagramFor[id];
      if (!drawing) throw new Error(`No diagram mapping for ${id}`);
      return `${diagram(drawing)}<details class="source-detail"><summary>Detailed logical source behind this simplified diagram</summary><pre><code>${esc(token.text)}</code></pre></details>`;
    }
    return `<div class="code-block"><pre><code>${esc(token.text)}</code></pre><button class="copy-code" type="button">Copy</button></div>`;
  };
  let html=marked.parse(source,{renderer,gfm:true});
  html=html.replace(/<table>/g,'<div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable reference table"><table>').replace(/<\/table>/g,'</table></div>');
  await writeFile(join(root,`${id}.html`),shell(id,title,summary,`<article>${html}</article>`,toc,group));
}
const home=`<section class="home-status"><span class="status-dot"></span>First UI proof recorded <span class="divider">/</span> Durable verification queue <span class="pill">EVIDENCE PENDING</span></section><p class="home-intro">A private software factory that turns your approved goals into independently reviewed changes, verifies them in k3s, and stays responsible after merge.</p><div class="start-actions"><a class="primary" href="design-checkpoint.html">Read the system overview <span>↗</span></a><a class="secondary" href="start-repository-owner.html">Start a repository owner →</a></div>${diagram('architecture')}<section class="reading-paths"><h2>Choose your depth.</h2><a href="design-checkpoint.html"><span class="step">01</span><div><h3>Understand the system</h3><p>Behavior, ownership and the path from a goal to a healthy deployment.</p></div><span aria-hidden="true">↗</span></a><a href="verification-contract.html"><span class="step">02</span><div><h3>Inspect the guarantees</h3><p>Revision-bound evidence, durable recovery and authority boundaries.</p></div><span aria-hidden="true">↗</span></a><a href="birbcrew-first-milestone.html"><span class="step">03</span><div><h3>Build the first proof</h3><p>One coworker, two AG-UI clients, a worker restart and no repeated effect.</p></div><span aria-hidden="true">↗</span></a></section><section class="boundaries"><div><div class="eyebrow">USE WHAT ALREADY EXISTS</div><h2>Own the workflow.<br>Reuse the machinery.</h2></div><p>Beans for authored work. Temporal for durable execution. Pydantic AI for the first coworker proof. AG-UI and CopilotKit OSS for interaction. Existing repository tests for verification.</p></section><section class="callout"><div class="eyebrow">THE IMPORTANT DISTINCTION</div><h2>Agreed does not mean proven.</h2><p>The architecture is agreed. Subscription integration, recovery, deployed verification and production follow-through still need their acceptance evidence. Each repository brief names those gates.</p><a href="repository-owners.html">See the implementation order →</a></section><section><h2>What stays with the human?</h2><p>Approve goals. Review authentication, permissions, destructive migrations, secrets and production infrastructure changes. Resolve decisions that the agents cannot safely settle within approved scope.</p><p>The phone supports the full daily workflow. Slack and push notifications link back to the same decision inbox.</p></section>`;
await writeFile(join(root,'index.html'),shell('index','Approved goals.\nVerified changes.','The Birbforge software factory design and implementation field guide.',home));
console.log(`Built ${pages.length+1} self-contained HTML pages and 3 SVG diagrams.`);
