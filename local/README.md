# Local Development Environment

This folder spins up a local Solace PubSub+ event broker via Docker Compose, used for local development/testing of the AEM Suite services (Solace sessions, subscriptions, etc.).

## Prerequisites

- Docker Desktop (with the WSL2 backend on Windows)

## Setup

From this folder, start the broker in the background:

```powershell
docker compose up -d
```

Check that the container is healthy:

```powershell
docker ps --filter name=solace-broker
docker logs solace-broker --tail 50
```

Startup is successful once you see lines like:

```
Determining platform type: [ OK ]
Generating license file: [ OK ]
Running pre-startup checks: [ OK ]
```

Stop the broker:

```powershell
docker compose down
```

### Troubleshooting: "nofile" resource limit error

If the container logs show:

```
POST Violation [022]: Required system resource missing, Hard resource limit nofile 1048576 is required, ... detected
```

the Docker host's open-file limit is too low. This is fixed via the `ulimits.nofile` setting already configured in [docker-compose.yml](docker-compose.yml) (`soft`/`hard: 1048576`). If you still see the error, your Docker daemon/WSL2 VM may be capping it lower — restart Docker Desktop, or increase the limit in WSL, then run `docker compose up -d --force-recreate`.

## Accessing the broker

| Interface                           | Address                 | Notes                                  |
| ----------------------------------- | ----------------------- | -------------------------------------- |
| PubSub+ Manager (Web UI) / SEMP API | http://localhost:8080   | Login with the admin credentials below |
| SMF (native Solace messaging)       | `tcp://localhost:55555` | Used by `solclientjs` based services   |
| MQTT                                | `localhost:1883`        |                                        |
| AMQP                                | `localhost:5672`        |                                        |
| WebSocket (SMF over WS)             | `ws://localhost:9000`   |                                        |

**Admin credentials** (from `environment` in [docker-compose.yml](docker-compose.yml)):

- Username: `admin`
- Password: `admin`
- Message VPN: `default`

Use these credentials/host values when configuring the Solace connection in the service's environment (e.g. `default-env.json` or local `.env`).

## Provisioning users and queues (Terragrunt)

[terragrunt/](terragrunt/) creates a dedicated Message VPN `aem-local` on the running broker, with ACL profiles, client usernames and queues. Terraform/Terragrunt run in Docker, so nothing has to be installed locally:

```powershell
cd terragrunt
.\tg.ps1 plan
.\tg.ps1 apply
.\tg.ps1 destroy   # removes the whole aem-local VPN again
```

Edit users, queues and topic subscriptions in [terragrunt/local/terragrunt.hcl](terragrunt/local/terragrunt.hcl), then run `.\tg.ps1 apply` again.

### Sample users

> Local test credentials only – never reuse them on a shared or cloud broker.

All users live in Message VPN `aem-local` and connect via `tcp://localhost:55555` (SMF) or `ws://localhost:9000` (WebSocket). Topic access is deny-by-default; only the topics listed are allowed.

| Username         | Password     | ACL profile  | May publish | May subscribe | Demo broker in the app      |
| ---------------- | ------------ | ------------ | ----------- | ------------- | --------------------------- |
| `aem-suite`      | `aemsuite`   | `full`       | `>` (all)   | `>` (all)     | `local-docker`              |
| `aem-publisher`  | `publisher`  | `publisher`  | `aem/>`     | –             | `local-docker (publisher)`  |
| `aem-subscriber` | `subscriber` | `subscriber` | –           | `aem/>`       | `local-docker (subscriber)` |

All three use client profile `app`, which allows sending and receiving guaranteed (persistent) messages and creating endpoints. In the app, the password is entered on every run, connection test or subscription; it is never stored. With `local-docker (ask for user)` you enter any of the usernames above together with its password.

Typical results when publishing:

| User             | `aem/orders/...` | `other/...`                  |
| ---------------- | ---------------- | ---------------------------- |
| `aem-suite`      | PASSED           | PASSED                       |
| `aem-publisher`  | PASSED           | FAILED – Publish ACL Denied  |
| `aem-subscriber` | FAILED – Publish ACL Denied | FAILED – Publish ACL Denied |

### Queues

| Queue          | Access        | Owner            | Topic subscriptions                     |
| -------------- | ------------- | ---------------- | --------------------------------------- |
| `q.aem.orders` | exclusive     | `aem-subscriber` | `aem/orders/>`                          |
| `q.aem.events` | non-exclusive | –                | `aem/events/>`, `aem/notifications/*`   |
| `q.aem.dlq`    | exclusive     | –                | none                                    |

Every client username may consume from every queue (`permission = consume`). `aem/notifications/*` matches exactly one level, so `aem/notifications/email` is queued but `aem/notifications/email/sent` is not.

To browse the queues, open PubSub+ Manager at <http://localhost:8080> (`admin`/`admin`), select VPN `aem-local` and go to **Queues**.
