# Bearer
Plugin for Elysia for retrieving the Bearer token.

## Installation
```bash
bun add @elysia/bearer
```

## Basic Usage
```typescript twoslash
import { Elysia } from 'elysia'
import { bearer } from '@elysia/bearer'

const app = new Elysia()
    .use(bearer())
    .get('/sign', ({ bearer }) => bearer, {
        beforeHandle({ bearer, set, status }) {
            if (!bearer) {
                set.headers[
                    'WWW-Authenticate'
                ] = `Bearer realm='sign', error="invalid_request"`

                return status(400, 'Unauthorized')
            }
        }
    })
    .listen(3000)
```

This plugin is for retrieving a Bearer token specified in RFC6750
