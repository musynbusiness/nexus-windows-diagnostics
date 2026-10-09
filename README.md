# NEXUS Windows cloud diagnostics

Public, isolated diagnostic repository: never upload an enrollment JSON, login
token or user data. Application sources are not copied; the exact existing packaged
Windows app is downloaded from a public ZIP pinned by SHA-256.

The workflow is manual, single-job and limited to ten minutes on a standard
GitHub-hosted Windows runner, free for public repositories. No paid/larger
runners, cache, custom images or billed artifact storage are used. Results are
committed only to this diagnostic repository, with its narrowly scoped job token.
Generated qa-config.json contains only server origin, version, bundle URL and hash.

Compare Node fetch, Electron fetch and Electron request on the real Windows
runtime. Use only public health and a deliberately invalid enrollment. Record
response statuses, not bodies containing potential TURN credentials or cookies.
Start with a fresh user-data directory; the console must show sign-in.

This does not verify Windows 11 Smart App Control, native Connect IPC, a complete
authenticated session, real screen capture, SendInput or per-user installation.
No TLS bypass or Windows protection changes are permitted.
