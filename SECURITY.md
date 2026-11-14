# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: on the repository's **Security** tab,
choose **Report a vulnerability**. Don't open a public issue for them.

Include what you found, how to reproduce it, and which version you tested (Settings > About shows
it). I'll reply as soon as I can and keep you posted on the fix. Cairn has one maintainer, so this
is best effort, but security reports come first.

## Supported versions

Only the latest release gets security fixes. They ship as a patch release; if you run the `:1`
image tag, you get them on your next pull.

## Scope

Cairn holds private journals, so anything that lets someone read, change or delete another
person's data, sign in without their password, or run code on the server matters. Some things
are left to how you run it, and are covered in the deployment guide's
[security checklist](docs/deployment.md#security-checklist): https in front of Cairn, a strong
password, `TRUST_PROXY` set only for your own proxy, and keeping the backup password off the server.
