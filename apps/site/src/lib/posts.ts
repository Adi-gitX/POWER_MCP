export interface Post {
  slug: string;
  title: string;
  description: string;
  category: string;
  date: string;
  displayDate: string;
  image: string;
  imageAlt: string;
  html: string;
}

export const POSTS: Post[] = [
  {
    slug: 'one-connection-not-twenty',
    title: 'Why your agent needs one connection, not twenty',
    description:
      'Every MCP server you add loads its whole toolbox into the context window. One connection that can search for a capability does the opposite.',
    category: 'Industry',
    date: '2026-10-23',
    displayDate: 'Oct 23, 2026',
    image: '/assets/img/blog-earth.jpg',
    imageAlt: 'Earth at night seen from orbit',
    html: `
<p class="lead">Connect a second MCP server and the agent gets more tools. Connect twenty and it gets worse: thousands of tokens of tool descriptions before the first question, overlapping names, and a model choosing between capabilities it cannot tell apart.</p>
<p>The problem is not that the tools are bad. It is that every server is designed to be the only one. Each wants its entire catalogue loaded at the start of the conversation, whether or not this task needs any of it.</p>
<h2>Context is the budget</h2>
<p>A tool schema is not free. Every name, description, argument and enum sits in the context window on every turn. At a few dozen tools the overhead is noticeable; at a few hundred it is the largest thing in the prompt, and the model starts to lose the actual request in the scaffolding.</p>
<p>There is a second cost that is harder to measure. Tools with similar names compete. A model that sees <code>create_file</code>, <code>write_file</code>, <code>put_file</code> and <code>save_file</code> has to guess which one this server honours, and a wrong guess is not an error — it is a plausible call that does the wrong thing.</p>
<h2>Search, then load</h2>
<p>Power is one server with one endpoint, and it exposes a small set of stable verbs. When an agent needs something specific, it calls <code>search_capabilities</code> with a description of the job. The server returns the few capabilities that match. The agent activates one, and only then does the full schema enter the context.</p>
<p>That keeps the baseline small and the working set relevant. It also means the catalogue can grow without making every conversation more expensive. The agent does not need to know what exists up front; it needs to know how to look.</p>
<h2>Tools are only part of the context</h2>
<p>Knowing which function to call still leaves the agent guessing about the project. Which framework, which database, which account model, which rules are permanent? Those answers usually arrive as a paragraph of instructions, retyped or re-explained every session, and quietly drift out of date.</p>
<p>Power keeps them in the Project Contract: stack choices, decisions and permanent rules, written once and loaded by every agent. The contract is not a memory trick. It is the same source of truth the gates check against, which is why an agent cannot quietly decide that billing belongs in the client.</p>
<h2>One endpoint, checked work</h2>
<p>The useful measure of a connection is not how many tools it advertises. It is how much of the work is verified before you see it. Power runs the build, the tests, the security checks and the browser pass on the server, and stops for your approval before production.</p>
<p>One connection, a contract that survives the conversation, and evidence attached to every step. That is a smaller prompt and a much larger guarantee.</p>`,
  },
  {
    slug: 'project-contracts',
    title: 'Project Contracts: the decisions your agent never forgets',
    description:
      'A context window ends. The decisions behind a project should not. How one versioned contract keeps every agent, and every gate, on the same facts.',
    category: 'Product',
    date: '2026-10-16',
    displayDate: 'Oct 16, 2026',
    image: '/assets/img/blog-rocket.jpg',
    imageAlt: 'A rocket launch arcing into the night sky',
    html: `
<p class="lead">Every long-running project accumulates decisions that are not in the code. Billing belongs to the team. Service keys stay server-side. Production changes need approval. Postgres, not SQLite. The model usually learns these the same way a new contractor does: someone explains them again, slightly differently.</p>
<p>Then the context window closes, and the explanation is gone.</p>
<h2>What a contract holds</h2>
<p>A Project Contract is a small, versioned record attached to the project. It holds the choices that shape implementation: the frontend, the database, the account model, billing, deployment, and the permanent rules every agent has to follow.</p>
<p>It is not a design document and not a prompt. It is structured data the server can read, the agent can load, and a person can edit without touching code. A new session starts by loading it. There is no interview about the stack and no chance for a plausible but wrong assumption to take root.</p>
<h2>The gates read it too</h2>
<p>A document nobody enforces is a suggestion. The contract matters because the pipeline checks against it. If the contract says production requires approval, a publish call cannot skip the gate by describing itself differently. If the contract says service-role keys stay server-side, the security check has something concrete to look for.</p>
<p>That is the difference between remembering a rule and enforcing one. Memory helps the model get it right; the gate makes sure being wrong does not ship.</p>
<h2>Change is deliberate</h2>
<p>Contracts are versioned. Changing the database or the account model is a decision, not an edit buried in a long prompt. The change is visible, attributable, and available to the next agent before it writes a line.</p>
<p>Open questions get answered once and kept. The next run does not reopen them because the conversation is new. It starts from the same facts and spends its budget on the work instead.</p>
<h2>Fewer briefings, fewer surprises</h2>
<p>The point is not to make an agent omniscient. It is to remove a class of failure that has nothing to do with model quality: the forgotten constraint, the re-litigated choice, the rule that existed only in someone's memory of a previous chat.</p>
<p>Write the decisions down once, in a form the server can check. Then let every agent, and every run, start there.</p>`,
  },
  {
    slug: 'capability-search',
    title: 'How capability search keeps tool schemas out of context',
    description:
      'A catalogue can be large without making every prompt large. The design behind capability search, and the trade-off it asks of the agent.',
    category: 'Engineering',
    date: '2026-10-09',
    displayDate: 'Oct 9, 2026',
    image: '/assets/img/blog-stars.jpg',
    imageAlt: 'A field of stars in the night sky',
    html: `
<p class="lead">Tool definitions are the most expensive documentation in an agent system, because they are paid for on every turn whether or not they are used. A server with forty tools can spend more context describing itself than the user spends describing the task.</p>
<p>Most servers accept that cost. Power is built the other way around: the catalogue is large, the always-loaded surface is small, and the rest arrives on demand.</p>
<h2>Three verbs instead of forty schemas</h2>
<p>The agent starts with the stable parts: how to search, how to load a capability, and how to run the pipeline. When it needs to do something specific, it calls <code>search_capabilities</code> with a natural description of the job — “add authentication with team accounts”, “export the repository”, “check the migration”.</p>
<p>The server returns a short list of matching capabilities with one-line descriptions. The agent picks one and calls <code>activate_skill</code>. Only then does the full schema, instructions and checks for that capability enter the context.</p>
<h2>What the server does</h2>
<p>Search runs on the server against a curated capability index, not against the model's memory. Results are deterministic for a given query and catalogue version, and the response names the capability that matched rather than asking the model to infer it from a dump.</p>
<p>The index is part of the product, versioned alongside the tools. A capability that is removed stops appearing in search and stops being callable, which is a much better failure mode than a stale description that the model keeps trying.</p>
<h2>The trade-off is one call</h2>
<p>Activation is not free: it is one extra round trip before the work begins. In practice that call is cheap, and it is often cheaper than the tokens it replaces. The agent also gets a better description at the moment it needs it, instead of a compressed one that had to survive in the baseline.</p>
<p>When the task is obvious and the capability is already active, there is no call at all. The working set persists for the session, so repeated work does not repeatedly pay.</p>
<h2>Keep the context for the work</h2>
<p>Capability search is not a smarter prompt. It is a boundary: the model sees the tools for the job in front of it, not the entire surface of the platform. The catalogue can keep growing, and the conversation can stay about the thing being built.</p>
<p>That is the whole design goal. A large platform should not feel large from inside a context window.</p>`,
  },
];

export const postFor = (slug: string) => POSTS.find((post) => post.slug === slug);
