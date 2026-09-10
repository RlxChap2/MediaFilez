# MediaFilez Privacy Policy

**Effective date:** September 10, 2026  
**Last updated:** September 10, 2026

This Privacy Policy explains how the official hosted instance of the MediaFilez Discord application (the **"Service"**) processes information. The Service is operated by the MediaFilez project (the **"Operator," "we," "us,"** or **"our"**).

MediaFilez is open-source software. A person or organization that hosts its own copy is an independent operator and must provide a privacy policy that describes that deployment. This Policy does not cover independently hosted copies.

## 1. What the Service does

MediaFilez receives a public URL through the `/media` Discord command, retrieves media from that URL or its public source platform, may convert or compress the media, and sends the resulting attachment to Discord. The command can be used in servers, direct messages, and private channels supported by Discord.

Some public media is visible only to a signed-in visitor. For those requests, the Operator may configure a dedicated, Operator-controlled source-platform account or exported session cookies. Users do not sign in through MediaFilez, and the Service does not ask for or receive users' source-platform passwords or cookies. Authenticated access is not used to bypass private-account permissions, paywalls, digital rights management, removed content, or other access controls.

## 2. Information we process

We process only the information reasonably needed to run, secure, and troubleshoot the Service:

- **Discord interaction data:** Discord user ID, username or display tag, command name, selected command options, interaction context, application and interaction identifiers, guild or channel context made available by Discord, app permission information, and the attachment-size limit supplied by Discord.
- **Information you submit:** the source URL, requested output type, and whether the result should be fitted to Discord's upload limit. A submitted URL may itself contain personal information, account names, post identifiers, or query parameters. Do not submit secrets, private links, or access tokens.
- **Media and source metadata:** downloaded media, filenames, file type and size, and metadata exposed by the source, such as title, creator, duration, dimensions, thumbnail URL, source URL, and source item ID.
- **Operational data:** timestamps, command context, Discord username or tag, selected download method, filenames, file sizes, processing times, error codes, and diagnostic messages. The Service does not intentionally log bot tokens, cookies, interaction tokens, authorization headers, or signed media URLs. Diagnostics produced by a source or downloader may nevertheless incidentally contain a URL or filename.

The Service does not use a user-account database, advertising SDK, or analytics service. It does not request the Discord Message Content privileged intent and does not read ordinary message content.

## 3. How we use information

We use the information above to:

- accept and validate a command;
- prevent excessive concurrent requests from the same user;
- retrieve, validate, convert, and deliver the requested media;
- show progress and error messages;
- protect the Service, Discord, and third parties from abuse, malicious URLs, unsafe files, and unauthorized access;
- diagnose failures and maintain reliability; and
- comply with applicable law and enforce the [Terms of Service](TERMS_OF_SERVICE.md).

Where applicable law requires a legal basis, we rely on performance of the service requested by you, our legitimate interests in operating and securing the Service, compliance with legal obligations, and consent where the law specifically requires it.

## 4. When information is disclosed

We do not sell personal information, rent it, or use it for targeted or cross-context behavioral advertising.

To perform a request, information may be disclosed to:

- **Discord:** command interactions are received from Discord, and the result, filename, source title or creator when available, status text, and attachment are sent back to Discord. Discord processes this information under its [Privacy Policy](https://discord.com/privacy).
- **The submitted source and its content-delivery providers:** the Service connects to the URL and related public media endpoints from the Service's server. Those services normally receive the server IP address, request headers, and requested URL. When an Operator-controlled account or session is used, the source platform may associate the requested URL and related activity with that account.
- **Configured media processors or relays:** locally run tools such as yt-dlp, gallery-dl, FFmpeg, and YouTube.js process requests. The default configuration may send the relevant public Instagram URL to `kkkinstagram.com` and a public Reddit URL to `redditez.com`. Reddit requests may also use `embed.reddit.com`. Operators can disable these relays. A configured Cobalt instance receives the submitted source URL and requested media options; the default Docker deployment uses private, self-hosted Cobalt containers, while an operator may configure another instance.
- **Infrastructure providers:** hosting, networking, and log-storage providers may process limited technical data on our behalf.
- **Authorities or other parties when required:** we may disclose information when reasonably necessary to comply with law, protect rights and safety, investigate abuse, or establish or defend legal claims.

Third-party websites and independently operated Cobalt or relay instances have their own terms and privacy practices. We do not control their independent processing.

## 5. Public and private replies

Replies in Discord servers are public in the invoking channel by default, unless the deployment is configured for private guild replies or Discord requires a private response. Direct-message and private-channel visibility is controlled by Discord. Do not use the Service for media or metadata you do not want exposed to the people who can view the destination channel.

## 6. Retention

- **Queue data:** a Discord user ID and active-job count are held in memory only while that user's request is running or queued, then removed.
- **Temporary files:** source media, converted files, extractor metadata, and any per-attempt cookie copy are stored in an isolated temporary directory. The Service attempts to delete that directory after success or failure. If the process or host stops unexpectedly, an abandoned directory may remain until a later successful startup detects that its owner is inactive and removes it.
- **Discord copies:** the delivered message and attachment remain on Discord according to Discord's retention rules and actions taken by users, server administrators, or Discord. They are not controlled by the Service's temporary-file cleanup.
- **Operational logs:** logs are kept only as long as reasonably needed for security, abuse prevention, and troubleshooting, then rotated or deleted according to the hosting environment. The repository's default Docker configuration uses size-based rotation of three files of up to 10 MiB per service; time in storage therefore varies with activity. Legal holds or applicable law may require longer retention.

Backups or provider-level logs, if present, may take additional time to expire through their normal rotation cycle.

## 7. Security

MediaFilez limits Discord access to the Guilds intent, validates public URLs and redirects, blocks private-network destinations, limits transfer sizes and execution time, isolates temporary jobs, sanitizes filenames, avoids shell command construction, and does not intentionally place credentials in logs. No service can guarantee absolute security. Please report a suspected vulnerability using the private process in [SECURITY.md](SECURITY.md).

## 8. Your privacy choices and rights

Depending on where you live, you may have rights to request access, correction, deletion, restriction, portability, or objection, and to appeal or complain to a data-protection authority. We will not discriminate against you for exercising an applicable privacy right.

To make a request, email **mediafilez44@gmail.com** with the subject **"MediaFilez Privacy Request"**. Include your Discord user ID, an approximate command date and time, and the type of request. Do not send a Discord token, cookie file, password, or private media. We may request limited verification to avoid disclosing or deleting another person's information.

Because MediaFilez has no persistent user-account database and operational logs may not include a stable user ID, we may be unable to locate data that cannot reasonably be linked to a verified request. You may need to use Discord's own controls or contact Discord regarding messages, attachments, or account information held by Discord.

## 9. Children

The Service is not directed to children under 13 or anyone below the minimum age required to use Discord in their country. Do not use the Service if you are not eligible to use Discord. If you believe a child submitted personal information contrary to these requirements, contact us so we can review and delete information where reasonably possible.

## 10. International processing

Discord, hosting providers, source platforms, relays, and content-delivery providers may process information in countries other than your own. Those countries may have different data-protection laws. Where applicable law requires it, an appropriate mechanism must be used for an international transfer.

## 11. Changes to this Policy

We may update this Policy when the Service, its providers, or legal requirements change. We will update the date above and publish the revised Policy at the same public location. Material changes may also be announced through the repository or the Service where practical.

## 12. Contact

For privacy questions or requests, contact:

**MediaFilez Project**  
Email: **mediafilez44@gmail.com**  
Repository: <https://github.com/RlxChap2/MediaFilez>

This Policy is intended to describe the Service accurately; it is not a substitute for legal advice to the Operator or to a self-hosting party.
