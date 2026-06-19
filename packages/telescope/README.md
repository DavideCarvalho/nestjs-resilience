# @dudousxd/nestjs-resilience-telescope

A [`@dudousxd/nestjs-telescope`](https://github.com/DavideCarvalho/nestjs-telescope) extension that
surfaces [`@dudousxd/nestjs-resilience`](https://github.com/DavideCarvalho/nestjs-resilience) state
transitions — circuit opened/closed/half-open, short-circuited, failover, timeout, retry — in the
Telescope dashboard.

It subscribes to the `aviary:resilience:*` diagnostics channels (so it costs nothing until resilience
emits), records one `resilience` entry per transition, and contributes a **Resilience** dashboard:
open circuits, recent failovers, most-tripped circuits, and a table of recent transitions.

## Install

```bash
pnpm add @dudousxd/nestjs-resilience-telescope @dudousxd/nestjs-telescope
```

Requires `@dudousxd/nestjs-telescope` (peer) and `@dudousxd/nestjs-diagnostics`. Make sure resilience
is emitting diagnostics (`ResilienceModule.forRoot({ emit: true })`, the default).

## Usage

```ts
import { TelescopeModule } from '@dudousxd/nestjs-telescope';
import { nestjsResilienceTelescope } from '@dudousxd/nestjs-resilience-telescope';

@Module({
  imports: [
    TelescopeModule.forRoot({ extensions: [nestjsResilienceTelescope()] }),
  ],
})
export class AppModule {}
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `topKeysLimit` | `10` | How many keys to show in the "Most-tripped circuits" panel. |
| `recentLimit` | `50` | How many transitions to list in the "Recent transitions" table. |

## License

MIT
