## What changed

<!-- Explain the behavior change and the problem it solves. -->

## Failure case

<!-- Include a minimal public example or a redacted error. Never paste credentials or private URLs. -->

## Verification

- [ ] `pnpm run check`
- [ ] Added or updated tests for changed behavior
- [ ] Tested Docker changes with `docker compose build`
- [ ] No `.env`, cookies, tokens, downloaded media, or private URLs included

## Download pipeline checklist

- [ ] A fallback cannot start after a valid artifact is committed
- [ ] Partial files cannot be mistaken for completed downloads
- [ ] Abort signals and size limits are preserved
- [ ] Discord success cannot be replaced by a later error
