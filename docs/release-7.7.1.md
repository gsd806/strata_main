# STRATA 7.7.1 — Pricing benefit layout

This focused patch repairs the Strata+ benefit list on the Pricing page. It does not change accounts, access, storage, the seven-day trial, or the $0.99 USD monthly subscription.

## Readable benefit copy

Each benefit previously supplied the checkmark, heading, and bare description as three items to a two-column CSS grid. The browser correctly placed the first two items on the first row, then auto-placed the description into the next row's 24 px checkmark column. Because long text is allowed to wrap safely, the description stayed inside the card but broke into fragments only a few characters wide.

Every Strata+ and free-tier benefit now groups its complete copy in one shrink-safe content wrapper. The grid keeps a fixed checkmark column and a `minmax(0,1fr)` copy column, while the Strata+ heading remains visually distinct above its explanation. The repair applies without a breakpoint-specific exception.

## Regression protection

The required browser suite now renders the actual Pricing benefit markup and production styles at 320, 430, 768, 980, 981, 1252, and 1440 px. It verifies that descriptions begin in the same content column as their headings, receive useful line width, remain within a reasonable row height, and do not create horizontal overflow. This measures readability directly instead of treating containment alone as success.

Build 7.7.1 also advances every managed asset reference and the service-worker cache name, ensuring that installed PWAs replace the broken 7.7.0 pricing markup and styles after activation.

See [current verification](release-readiness.md) for the exact checks completed before release.
