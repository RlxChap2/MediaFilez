# Download architecture

## Invariants

Three rules prevent duplicate downloads and false error messages:

1. Only one engine transfers data at a time for a job.
2. A valid artifact is committed once. No fallback runs after that commit.
3. Discord delivery has one terminal owner. Code can't replace a committed or unknown response with an error.

Resolution probes may be parallelized later, but transfers must remain sequential unless the orchestrator gains explicit cancellation and winner ownership.

## Job flow

```text
request
  -> URL and SSRF validation
  -> engine plan
  -> isolated attempt directory
  -> engine transfer
  -> file signature and FFprobe validation
  -> atomic artifact commit
  -> optional conversion
  -> one Discord attachment edit
  -> cleanup
```

When an engine process exits with an error, the orchestrator scans only that engine's attempt directory. If it finds a complete file of the requested media type, it commits the file and stops. Partial files and sidecars are never candidates.

## Engine contract

An engine receives the source URL, an empty attempt directory, and job options containing `outputType`, `maxBytes`, `signal`, and `onProgress`. It returns a candidate with at least `filePath`, `fileName`, and `method`. Metadata is optional.

Engines must write incomplete data with a partial extension, honor the abort signal, and leave a complete artifact in the attempt directory if a process fails after finalizing it. The orchestrator owns validation, commit, fallback selection, and failed-attempt cleanup.

## Delivery ownership

`ReplySession` has five internal states: `open`, `committing`, `committed`, `failed`, and `unknown`.

- Status edits are allowed only while open.
- Commit sends the final text and attachment together.
- A failed upload call is checked with `fetchReply` before it becomes an error.
- Failed and unknown verification never trigger a blind attachment-clearing edit.
- Temporary files are removed only after commit or a terminal failure.

Upload duration is logged locally. It is intentionally absent from the final reply because measuring it would require a second edit after a successful attachment upload.

## Security boundaries

User URLs allow HTTP and HTTPS only. The initial lookup and direct HTTP redirects reject private, link-local, multicast, loopback, and documentation ranges. Undici uses the same guarded DNS lookup during connection establishment to reduce DNS-rebinding risk.

A configured Cobalt host is trusted because operators may run it on a private Compose network. Media URLs returned by Cobalt aren't trusted unless they use that same configured host.

Cookie files and Cobalt credentials are runtime secrets. They must stay outside the repository and be mounted read-only in containers.
