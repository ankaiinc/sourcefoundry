const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function landingPage(baseUrl: string): string {
  const origin = escapeHtml(baseUrl);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="Autonomous source infrastructure for agents." />
  <title>SourceFoundry — sources for agents</title>
  <style>
    :root { --ink:#12130f; --paper:#f7f3e9; --line:#d9d1c0; --lime:#d8ff43; --blue:#dcecff; --muted:#69665e; }
    * { box-sizing:border-box } body { margin:0; background:var(--paper); color:var(--ink); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
    a { color:inherit } main { max-width:1160px; margin:auto; padding:24px; } .top { display:flex; justify-content:space-between; border-bottom:1px solid var(--ink); padding-bottom:17px; font-size:13px; }
    .brand { font-weight:800; letter-spacing:-.06em; font-size:20px; } .eyebrow { color:var(--muted); text-transform:uppercase; letter-spacing:.08em; font-size:11px; }
    .hero { display:grid; grid-template-columns:1.25fr .75fr; gap:48px; padding:80px 0 62px; border-bottom:1px solid var(--ink); } h1 { font:500 clamp(48px,8vw,105px)/.86 Georgia,serif; letter-spacing:-.075em; margin:12px 0 26px; max-width:820px; }
    .lead { max-width:560px; font:18px/1.5 Georgia,serif; } .panel { align-self:end; border:1px solid var(--ink); background:var(--blue); padding:20px; } .panel p { font-size:13px; line-height:1.5; margin:0 0 14px; }
    .steps { display:grid; grid-template-columns:repeat(3,1fr); border-bottom:1px solid var(--ink); } .step { padding:20px 20px 26px 0; min-height:150px; } .step + .step { border-left:1px solid var(--ink); padding-left:20px; } .step strong { display:block; font:500 30px Georgia,serif; letter-spacing:-.04em; margin:22px 0 8px; }
    .enrol { display:grid; grid-template-columns:.8fr 1.2fr; gap:48px; padding:64px 0; } h2 { font:500 clamp(36px,5vw,62px)/.95 Georgia,serif; letter-spacing:-.06em; margin:10px 0; } form { border:1px solid var(--ink); padding:20px; background:#fffdf7; } label { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; margin-top:16px; } input { width:100%; border:0; border-bottom:1px solid var(--ink); background:transparent; font:16px ui-monospace,SFMono-Regular,Menlo,monospace; padding:10px 0; outline:none; } button { margin-top:26px; border:1px solid var(--ink); background:var(--lime); color:var(--ink); padding:13px 16px; font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace; cursor:pointer; } button:disabled { opacity:.55; cursor:wait; }
    #result { display:none; white-space:pre-wrap; overflow-wrap:anywhere; margin:18px 0 0; padding:14px; border:1px solid var(--ink); background:var(--ink); color:#f9f6ee; font-size:12px; line-height:1.5; } .quiet { color:var(--muted); font-size:12px; line-height:1.5; }
    footer { border-top:1px solid var(--ink); padding:22px 0 8px; display:flex; justify-content:space-between; gap:20px; font-size:12px; } @media (max-width:720px) { .hero,.enrol { grid-template-columns:1fr; gap:28px; padding:48px 0; } .steps { grid-template-columns:1fr; } .step + .step { border-left:0; border-top:1px solid var(--ink); padding-left:0; } footer,.top { flex-direction:column; } }
  </style>
</head>
<body>
  <main>
    <header class="top"><span class="brand">SOURCEFOUNDRY</span><span>sources for agents · <a href="${origin}/agent.md">agent guide</a></span></header>
    <section class="hero">
      <div><span class="eyebrow">A self-service source utility</span><h1>Give your agent a working source desk.</h1><p class="lead">Create a private workspace, add feeds or approved search sources, and retrieve normalized evidence. No account, sales call, dashboard admin, or human hand-off.</p></div>
      <aside class="panel"><span class="eyebrow">The boundary</span><p>Your agent receives one tenant-scoped credential. SourceFoundry operates provider access; agents never send provider secrets. Small limits keep autonomous access reliable for everyone.</p><a href="${origin}/openapi.json">Read the OpenAPI contract →</a></aside>
    </section>
    <section class="steps"><div class="step"><span class="eyebrow">01 / Enrol</span><strong>Create a workspace</strong><span class="quiet">A slug, a name, and an agent label are enough.</span></div><div class="step"><span class="eyebrow">02 / Configure</span><strong>Add sources</strong><span class="quiet">RSS, Atom, and hosted Tavily, Exa, or Serper discovery.</span></div><div class="step"><span class="eyebrow">03 / Use</span><strong>Read evidence</strong><span class="quiet">Queue fetches, then consume one normalized signals contract.</span></div></section>
    <section class="enrol"><div><span class="eyebrow">Start now</span><h2>Make the credential your agent needs.</h2><p class="quiet">The token is displayed once. Put it directly into the agent runtime’s secret store; do not place it in prompts, source configuration, or code.</p></div>
      <form id="enrollment"><label for="slug">Workspace slug</label><input id="slug" name="slug" required minlength="3" pattern="[a-z0-9-]+" placeholder="market-intelligence" /><label for="name">Workspace name</label><input id="name" name="name" required placeholder="Market Intelligence" /><label for="agentLabel">Agent label</label><input id="agentLabel" name="agentLabel" required value="autonomous-agent" /><button id="submit" type="submit">Create workspace + token</button><pre id="result" aria-live="polite"></pre></form>
    </section>
    <footer><span>Product of <a href="https://4agents.fyi">4agents.fyi</a></span><span><a href="${origin}/.well-known/sourcefoundry.json">service descriptor</a> · <a href="${origin}/v1/meta">capabilities</a></span></footer>
  </main>
  <script>
    const form = document.querySelector('#enrollment'); const result = document.querySelector('#result'); const submit = document.querySelector('#submit');
    form.addEventListener('submit', async (event) => { event.preventDefault(); submit.disabled = true; result.style.display = 'block'; result.textContent = 'Creating your workspace…';
      try { const response = await fetch('/v1/agent-enrollments', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(form))) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Enrollment failed');
        result.textContent = '# Store this secret now — it is not shown again\\nSOURCEFOUNDRY_URL=' + body.baseUrl + '\\nSOURCEFOUNDRY_API_TOKEN=' + body.token + '\\nSOURCEFOUNDRY_TENANT_ID=' + body.tenant.id + '\\n\\n# Next: POST /v1/sources, then POST /v1/ingest/source\\n# Contract: ' + body.next.openapi;
      } catch (error) { result.textContent = 'Could not create workspace: ' + error.message; } finally { submit.disabled = false; }
    });
  </script>
</body>
</html>`;
}
