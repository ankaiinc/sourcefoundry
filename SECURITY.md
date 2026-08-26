# Security policy

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's private **Security → Report a vulnerability** form with the affected version, impact, reproduction steps, and any suggested mitigation. Do not include live credentials or customer data.

We will acknowledge a report within five business days and coordinate remediation and disclosure when the issue is confirmed. There is no bug-bounty program at this time.

## Supported versions

Until the first stable release, security fixes are applied to the latest commit on `main` and the latest published container or package release.

## Operator responsibilities

Self-hosters own their database, provider accounts, keys, network controls, backups, retention policy, and compliance obligations. Provider keys belong only in the worker environment or secret store. Never place them in source-feed requests, source URLs, prompts, or metadata.
