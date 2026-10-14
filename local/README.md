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
