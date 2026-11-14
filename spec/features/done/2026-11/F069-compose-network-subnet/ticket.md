---
opened: 2026-11-12
landed: 2026-11-14
---

# F069 · Pin the Compose network subnet

## Outcome

`WEB_TRUSTED_PROXIES` keeps its value after the stack is recreated. Today it holds the gateway of `email-assistant_default` (`172.18.0.1` on the VPS). A `docker compose down` or a Docker upgrade can recreate the network with a new gateway. Then every request has the new gateway as its peer, the proxy is no longer trusted, and `auth_sessions.ip_address` and the login rate limit see the gateway instead of the client.

## Notes

Moved from `tasks/planned/compose-network-subnet.md` on 2026-11-12. The full old task (plan, decisions, log): [plan.md](plan.md).
