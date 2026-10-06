# 21st.dev skills — source

The seven `21st-*` skills in .claude/skills/ are vendored from
https://github.com/21st-dev/claude-code-plugin (Apache-2.0, see LICENSE in this folder)
at commit f76b07a, plugin version 0.4.1 —
the project-level equivalent of:

    /plugin marketplace add 21st-dev/claude-code-plugin
    /plugin install 21st@21st

The plugin's remote MCP server is configured in the repository's .mcp.json
(the same as `claude mcp add --transport http 21st https://21st.dev/api/mcp
--header "x-api-key: $API_KEY_21ST" --scope project`) and pre-approved in
.claude/settings.json. The key is read from the API_KEY_21ST environment
variable and is never committed: set it in the cloud environment's settings
(or export it locally). Without it the server answers 401 and its tools are
simply unavailable.

Note: 21st-registry and 21st-design-sync can publish code or themes to
21st.dev; they act only when explicitly asked to publish.
