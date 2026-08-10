# Pydantic AI 2.0's "capabilities" primitive is every agent framework admitting the same thing

*Written by Claude (Anthropic's Fable model) as part of an autonomous research-and-writing pipeline. Jody's annotations appear in the marked blocks. Everything else is machine-drafted, human-curated.*

---

Pydantic AI went stable this month, 2.0 after seven betas, and the headline is the reorganizing idea rather than the stability: a new **capabilities** primitive that bundles an agent's tools, hooks, instructions, and model settings into one composable unit.

If that sounds familiar, it should. It's a skill. It's a plugin. It's an MCP server's toolset plus its prompt. Claude Code calls them skills, a folder of instructions, tools, and configuration that composes into a session. Vercel's agent tooling, the spec-driven frameworks, the plugin marketplaces sprouting around every coding agent: everyone is converging on the same shape from different directions. The unit of agent composition turns out to be the *bundle* of tools, instructions, and settings that together encode one competency, rather than the tool or the prompt on its own.

That convergence is the story, because it tells you the ecosystem finished an argument. The first generation of agent frameworks organized around the loop (plan, act, observe) and treated tools as a flat list you dumped into context. That works until an agent has thirty tools, five behavioral rules that only apply during certain tasks, and a model configuration that should differ between "browse the web" and "refactor this module." Flat lists don't scale; namespaced, composable bundles do. Pydantic AI arriving at capabilities after seven betas of production feedback is the Python ecosystem's most type-safety-obsessed team writing that conclusion down formally.

Why it matters that *this* team shipped it: Pydantic sits underneath everything. FastAPI validates with it, most Python LLM tooling serializes through it, and the same org now stewards httpx2. When the load-bearing layer of the Python API ecosystem blesses a composition pattern for agents, that pattern stops being a framework quirk and starts being infrastructure. It is also, quietly, Python's strongest counter to the gravitational pull of the TypeScript agent stack. The pitch is not "we have an agent loop too." It is "your agent's contract surface gets the same validation rigor as your API's."

> **[JODY'S TAKE]** - *You've been surveying this exact landscape, agent frameworks, memory approaches, skills architecture, for months, and you maintain a public Claude Code skills repo. Suggested: "I've built the same primitive three times now under three names: Claude Code skills, plugin definitions, and now this. My test for whether a framework's composition unit is real: can I hand it to another engineer as a folder and have it work without a meeting? Capabilities pass that test on paper. The open question is versioning, because nobody has solved what happens when two capabilities disagree about the same hook."*

One adjacent item from the same ecosystem deserves a paragraph, because it's the sober counterweight to the composability excitement. Starlette, the ASGI layer under FastAPI and, increasingly, under a large share of MCP servers and agent backends, patched a moderate CVE where a malformed Host header could make `request.url.path` report a different path than the router actually matched. Any middleware making authorization decisions off that path could be fooled. The framing worth internalizing is that an "AI agent backend" is a Python web service carrying the *old* risks, now holding tool-execution authority. Path-confusion bugs were annoying when the endpoint returned JSON. They're considerably more interesting when the endpoint can invoke tools. Patch your Starlette, and stop authorizing in middleware.

The composability convergence and the CVE are the same lesson at two altitudes. Agent systems are becoming ordinary software, composed from versioned units, validated at boundaries, patched on Tuesdays. The frameworks that win the next phase will be the ones that made agents boring to operate, not the ones with the cleverest loop. Pydantic AI 2.0 is a serious bid for exactly that, and "boring to operate" is the highest compliment infrastructure can earn.

---

*Sources: Pydantic AI 2.0 stable release notes, Real Python's July 2026 news roundup, Starlette 1.0.1 security advisory. Research and drafting: Claude. Curation and annotations: Jody Brewster.*
