# IMAP Authentication: Provider Status and OAuth2 Implications

**Date**: 2026-04-12
**Status**: Complete
**Related**: investigation-mailbox-ingest.md
**Research Depth**: Medium

---

## Overview

This document covers the current authentication landscape for IMAP access across major email providers as of 2026. The primary concern driving this research is Microsoft's multi-year deprecation of Basic Authentication for Exchange Online, which directly affects any IMAP-based mailbox ingestion feature targeting Outlook.com, Hotmail, or Microsoft 365 (work/school) accounts.

The key finding is that **basic authentication for IMAP in Exchange Online is already permanently disabled** (since late 2022). This is not a pending change — it is done. OAuth2 (XOAUTH2) is the only supported authentication method for Exchange Online IMAP, but the good news is that imapflow has built-in support for it.

---

## 1. Microsoft 365 / Exchange Online IMAP Auth Status

### 1.1 Basic Authentication: Already Disabled

Microsoft disabled basic authentication for IMAP (and POP, EWS, EAS, Remote PowerShell, Autodiscover, OAB) in Exchange Online in a phased rollout that completed **by end of 2022**. This is permanent and irrevocable:

> "Basic authentication is now disabled in all tenants. Before December 31 2022, you could re-enable the affected protocols if users and apps in your tenant couldn't connect. Now no one (you or Microsoft support) can re-enable Basic authentication in your tenant."
> — Microsoft Learn, Deprecation of Basic Authentication in Exchange Online

The affected account types are:
- **Microsoft 365 business/enterprise/education accounts** (Outlook.com for work, `user@company.onmicrosoft.com`, any custom domain on Exchange Online)
- **Personal Outlook.com / Hotmail / Live / MSN accounts** — basic auth is also disabled for consumer accounts

### 1.2 App Passwords: Not Available for M365 IMAP

Unlike Gmail or iCloud, **Microsoft does not offer app passwords for Exchange Online IMAP**. The Microsoft deprecation document explicitly notes: "The deprecation of basic authentication also prevents the use of app passwords with apps that don't support two-step verification." There is no workaround using app-specific passwords.

### 1.3 SMTP AUTH: Separate and Still in Transition

SMTP AUTH (client submission) is a separate protocol from IMAP READ access and is on a different, slower retirement timeline:

| Phase | Timeline | Status |
|-------|----------|--------|
| SMTP AUTH basic auth behavior unchanged | Now to December 2026 | In effect |
| SMTP AUTH disabled by default for existing tenants | End of December 2026 | Upcoming |
| SMTP AUTH unavailable by default for new tenants | After December 2026 | Upcoming |
| Final removal date announced | Second half of 2027 | Planned |

This research focuses on IMAP READ access (for mailbox ingestion). SMTP is not relevant to the mailbox ingest feature.

### 1.4 New Accounts After 2025

New Outlook.com / Microsoft 365 accounts created in 2025-2026 may find SMTP AUTH disabled entirely with no user toggle available — even on paid Microsoft 365 Personal subscriptions. This is an administrative decision by Microsoft. For IMAP READ access, this is irrelevant (IMAP itself still works — only the authentication method matters).

### 1.5 Required: OAuth2 via XOAUTH2

The only supported authentication mechanism for Exchange Online IMAP is **OAuth 2.0 via the SASL XOAUTH2 mechanism**. The IMAP protocol itself (port 993, IMAPS with TLS) continues to work; only basic username/password authentication is blocked.

Microsoft documentation confirms OAuth2 support for IMAP has been available since April 2020 and is the required path forward.

---

## 2. imapflow OAuth2 Support

### 2.1 Built-in XOAUTH2 Support

imapflow supports OAuth2 authentication natively via the `auth.accessToken` property. When `accessToken` is provided instead of `pass`, imapflow automatically constructs the SASL XOAUTH2 token internally:

```typescript
const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: {
        user: 'user@company.com',
        accessToken: 'eyJ0eXAiOiJKV1...'  // Bearer token from OAuth2 flow
    },
    logger: false
});
```

The same pattern works for Gmail and any other XOAUTH2-capable server:

```typescript
// Gmail
const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
        user: 'user@gmail.com',
        accessToken: 'ya29.a0ARrd...'
    },
    logger: false
});
```

No additional libraries are needed to construct the XOAUTH2 string — imapflow handles it. The format it constructs internally is:
```
base64("user=" + email + "\x01auth=Bearer " + accessToken + "\x01\x01")
```

### 2.2 Token Management Is the Developer's Responsibility

imapflow accepts an already-obtained access token. It does not handle:
- Token acquisition (the OAuth2 authorization flow)
- Token refresh (access tokens are short-lived, typically 60 minutes)
- Token storage / caching

The caller must obtain a valid, non-expired access token before passing it to ImapFlow. For a CLI tool running under cron, this means the OAuth2 token acquisition and refresh must be handled separately.

---

## 3. What OAuth2 for Exchange Online IMAP Requires

Adding OAuth2 support for Exchange Online IMAP is a non-trivial feature because it requires Azure app registration and tenant-specific consent. Below is a complete picture of the requirements.

### 3.1 Application Registration (Azure)

1. **Register the application** in Microsoft Entra ID (formerly Azure Active Directory) at `portal.azure.com`
2. **API Permission required**: `Office 365 Exchange Online` > `IMAP.AccessAsApp` (Application permission, not Delegated)
3. **Admin consent** must be granted by a tenant administrator
4. **Service principal setup** via PowerShell: After admin consent, a service principal must be created and mailbox permissions granted using PowerShell cmdlets. This step is required and commonly missed.

The PowerShell service principal setup uses the **Enterprise Applications ObjectId** (not the App Registrations ObjectId — they differ and using the wrong one is a common error).

### 3.2 Token Acquisition (MSAL Node.js)

Two flows are available depending on use case:

**Client Credentials Flow** (recommended for daemon/server applications and CLI tools):
- No user interaction required
- Uses `clientId` + `clientSecret` (or certificate)
- Grants access to mailboxes the service principal has been granted access to
- Does NOT issue refresh tokens (the client credentials can re-acquire directly)
- Appropriate scope: `https://outlook.office365.com/.default`

```typescript
import * as msal from '@azure/msal-node';

const msalConfig = {
    auth: {
        clientId: 'YOUR_CLIENT_ID',
        authority: 'https://login.microsoftonline.com/YOUR_TENANT_ID',
        clientSecret: 'YOUR_CLIENT_SECRET'
    }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

async function getAccessToken(): Promise<string> {
    const result = await cca.acquireTokenByClientCredential({
        scopes: ['https://outlook.office365.com/.default']
    });
    return result!.accessToken;
}
```

**Authorization Code Flow** (for interactive user-delegated access):
- Requires user to authenticate in a browser
- Issues refresh tokens for long-lived access
- More complex setup for a CLI context
- Scope: `https://outlook.office365.com/IMAP.AccessAsUser.All`

For a background CLI tool (cron-friendly), the **client credentials flow** is the appropriate choice.

### 3.3 Required Package

```
npm install @azure/msal-node
```

The `@azure/msal-node` package is the official Microsoft Authentication Library for Node.js.

### 3.4 Configuration Needed from the User

To support Exchange Online IMAP with OAuth2, the user would need to provide (per mailbox):

| Config Key | Description |
|------------|-------------|
| `tenantId` | Azure AD Tenant ID (GUID) |
| `clientId` | Application (client) ID from Azure app registration |
| `clientSecret` | Client secret from the app registration |
| `userEmail` | The mailbox email address to access |

These values are sensitive credentials and should be stored as environment variables or in a secured config file, following the same pattern as `WIKI_LLM_API_KEY`.

### 3.5 Complexity Assessment

Implementing Exchange Online OAuth2 IMAP is significantly more complex than basic auth or Gmail app passwords:

- Requires Azure portal access and a Microsoft Entra tenant (not available to personal Outlook.com users without a tenant)
- Requires admin-level PowerShell to set up service principal
- Adds `@azure/msal-node` as a production dependency
- Adds token expiry and refresh logic
- Personal Outlook.com accounts cannot use the client credentials flow (it requires a tenant); they would need the Authorization Code flow with its browser-based interaction — impractical for a CLI tool

**Conclusion**: OAuth2 for Exchange Online IMAP is technically achievable but has meaningful infrastructure prerequisites. It is appropriate as a future enhancement clearly scoped to **organizational Exchange Online accounts** (work/school tenants), not personal Outlook.com/Hotmail accounts.

---

## 4. Gmail: App Passwords (Current Status)

### 4.1 Personal Gmail Accounts

Gmail app passwords **still work** for IMAP access in 2026 for personal Google accounts. This is the recommended approach for the initial implementation.

**Requirements**:
- 2-Step Verification must be enabled on the Google account
- Generate app password at: `https://myaccount.google.com/apppasswords`
- The generated password is 16 characters and used in place of the regular Google password

**Steps**:
1. Go to Google Account > Security
2. Enable 2-Step Verification (required prerequisite)
3. Under "2-Step Verification", scroll to "App passwords"
4. Select "Mail" and generate a password
5. Use the 16-character password as the IMAP password in config

**IMAP Settings**:
- Host: `imap.gmail.com`
- Port: `993`
- Security: SSL/TLS (`secure: true` in imapflow)
- Username: full Gmail address
- Password: 16-character app password

### 4.2 Google Workspace Accounts (Business/Education)

Starting **May 1, 2025**, Google Workspace accounts (business and education) no longer support less secure app access or basic username/password sign-in. Workspace accounts require OAuth2 for IMAP access, same as Microsoft 365.

**Impact**: Users with `user@company.com` accounts running on Google Workspace cannot use Gmail app passwords for IMAP as of mid-2025. Only personal `@gmail.com` accounts retain app password support.

### 4.3 Gmail IMAP Must Be Enabled

Since January 2025, IMAP is enabled by default for all Google accounts. Previously users had to manually enable it in Gmail Settings > See all settings > Forwarding and POP/IMAP.

---

## 5. Other Providers

### 5.1 iCloud Mail (Apple)

iCloud Mail uses **app-specific passwords** for IMAP access when the Apple ID has Two-Factor Authentication enabled. This is the required method — the regular Apple ID password cannot be used with third-party IMAP clients.

**Status**: App-specific passwords continue to work for iCloud IMAP as of 2026.

**Requirements**:
- Two-Factor Authentication enabled on the Apple ID
- Generate app-specific password at: `https://account.apple.com` > Sign-In and Security > App-Specific Passwords
- Each generated password has a label (e.g., "LLM Wiki") and is tied to the Apple ID account

**IMAP Settings**:
- Host: `imap.mail.me.com`
- Port: `993`
- Security: SSL/TLS
- Username: full iCloud email address (e.g., `user@icloud.com`)
- Password: app-specific password (format: `xxxx-xxxx-xxxx-xxxx`, hyphens may need removing depending on client)

### 5.2 Yahoo Mail

Yahoo Mail requires **app passwords** for IMAP access with third-party clients since May 2024. Plain Yahoo passwords are no longer accepted for IMAP.

**Status**: App passwords work for Yahoo IMAP as of 2026.

**Requirements**:
- Yahoo account with 2-step verification enabled
- Generate app password at: Yahoo Account Security > Generate app password
- OAuth2 is Yahoo's preferred method but is not required for IMAP (app passwords suffice)

**IMAP Settings**:
- Host: `imap.mail.yahoo.com`
- Port: `993`
- Security: SSL/TLS
- Username: full Yahoo email address
- Password: generated app password

### 5.3 FastMail

FastMail supports IMAP with app passwords. App passwords are generated from FastMail's settings and are the recommended approach for third-party client access.

**Status**: App passwords work for FastMail IMAP.

**Requirements**:
- FastMail plan that includes third-party client access (Basic plan does NOT include IMAP/SMTP)
- Generate app password at: Settings > Privacy & Security > App passwords

**IMAP Settings**:
- Host: `imap.fastmail.com`
- Port: `993`
- Security: SSL/TLS
- Username: full FastMail email address
- Password: generated app password

### 5.4 Zoho Mail

Zoho Mail supports IMAP with app-specific passwords when 2FA is enabled. Standard passwords may work when 2FA is disabled, but app passwords are recommended.

**IMAP Settings**:
- Host: `imap.zoho.com` (or `imap.zoho.eu` for EU region)
- Port: `993`
- Security: SSL/TLS

### 5.5 Self-Hosted / Corporate (Dovecot, Postfix, Zimbra)

Self-hosted IMAP servers (Dovecot, Postfix with Dovecot SASL, Zimbra, Courier, etc.) typically support basic username/password authentication without OAuth requirements. The exact behavior depends on server configuration, but these servers remain the simplest case for the initial implementation.

**Typical IMAP Settings**:
- Host: server-specific
- Port: `993` (IMAPS) or `143` (IMAP + STARTTLS)
- Username: full email or local part (server-specific)
- Password: account password or server-generated app password (if server supports it)

### 5.6 ProtonMail

ProtonMail uses end-to-end encryption and does NOT natively support standard IMAP. Access requires the **ProtonMail Bridge** application, which is a local proxy that provides a standard IMAP/SMTP interface on localhost. The Bridge is a desktop application and requires a paid ProtonMail plan.

**Impact**: ProtonMail is not a direct IMAP target for this feature. Users would technically connect to `127.0.0.1:1143` (the Bridge port) with a Bridge-generated password, but this requires the Bridge application to be running and is a niche scenario.

---

## 6. Provider Summary Table

| Provider | Auth Method | App Passwords? | OAuth2 Required? | Notes |
|----------|-------------|----------------|------------------|-------|
| **Gmail (personal)** | App password | Yes | No | Requires 2SV; works for `@gmail.com` |
| **Google Workspace** | OAuth2 | No (as of May 2025) | Yes | Business/education accounts only |
| **Outlook.com / Hotmail (personal)** | OAuth2 only | No | Yes | Basic auth removed 2022. No tenant = no client credentials flow |
| **Microsoft 365 (work/school)** | OAuth2 only | No | Yes | Basic auth removed 2022. Requires Azure app registration |
| **iCloud Mail** | App-specific password | Yes | No | Requires Apple 2FA |
| **Yahoo Mail** | App password | Yes | No (optional) | Plain passwords blocked since May 2024 |
| **FastMail** | App password | Yes | No | Requires paid plan (not Basic) |
| **Zoho Mail** | App password | Yes | No | Standard or app passwords |
| **Self-hosted (Dovecot, etc.)** | Basic auth | N/A | No | Server config determines options |
| **ProtonMail** | Bridge proxy | N/A | No | Requires Bridge app on localhost |

---

## 7. Impact on Initial Implementation

### 7.1 Providers That Work Out of the Box

The following providers work with the basic auth / app password approach that the initial implementation supports:

- Personal Gmail accounts (app password)
- iCloud Mail (app-specific password)
- Yahoo Mail (app password)
- FastMail (app password)
- Zoho Mail (app password)
- Self-hosted servers (direct basic auth)

### 7.2 Providers That Require Future OAuth2 Work

- Microsoft 365 work/school accounts — requires Azure app registration, MSAL, tenant admin cooperation
- Google Workspace accounts — requires Google OAuth2 app registration
- Personal Outlook.com/Hotmail — technically requires OAuth2 but the client credentials flow is unavailable for personal accounts; Authorization Code flow would be needed, which is impractical for a CLI tool without a browser redirect URI

### 7.3 Configuration Guide Guidance

The configuration guide must clearly state:

1. **Microsoft 365 / Outlook.com / Hotmail is NOT supported in the initial release**. These accounts require OAuth2 which is a planned future enhancement. Users attempting to use these accounts will receive an IMAP authentication error.

2. **Gmail app passwords work for personal `@gmail.com` accounts** but require 2-Step Verification to be enabled first.

3. **Google Workspace (business Gmail)** accounts are also not supported unless the organization's Google Workspace admin has configured OAuth2 for IMAP (which is beyond the scope of the initial implementation).

4. The `passwordExpiry` config field provides a proactive warning when a generated app password is approaching expiration (following the same pattern as `WIKI_LLM_API_KEY_EXPIRY`).

---

## 8. Future OAuth2 Implementation Plan

When OAuth2 for Exchange Online IMAP is added as a future feature, the architecture would be:

### 8.1 New Auth Type in Mailbox Config

```typescript
interface MailboxAuth {
    type: 'basic' | 'oauth2-msal';  // future: 'oauth2-google'
    
    // For type: 'basic'
    user?: string;
    password?: string;
    
    // For type: 'oauth2-msal'
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    userEmail?: string;  // mailbox to access
}
```

### 8.2 Token Acquisition and Caching

```typescript
import * as msal from '@azure/msal-node';

async function acquireM365Token(auth: MailboxAuth): Promise<string> {
    const cca = new msal.ConfidentialClientApplication({
        auth: {
            clientId: auth.clientId!,
            authority: `https://login.microsoftonline.com/${auth.tenantId}`,
            clientSecret: auth.clientSecret!
        }
    });
    
    const result = await cca.acquireTokenByClientCredential({
        scopes: ['https://outlook.office365.com/.default']
    });
    
    if (!result) throw new Error('Failed to acquire OAuth2 token for M365 IMAP');
    return result.accessToken;
}
```

### 8.3 Passing Token to imapflow

```typescript
// Token flows directly into imapflow auth object
const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    auth: {
        user: auth.userEmail!,
        accessToken: await acquireM365Token(auth)
    },
    logger: false
});
```

### 8.4 Access Token Lifetime

Microsoft Entra access tokens have a configurable lifetime, but the default is 60-75 minutes. For long-running batch operations over many mailboxes, token refresh may be needed mid-run. Since the client credentials flow does not issue refresh tokens, the solution is simply to re-call `acquireTokenByClientCredential` when needed (MSAL handles in-memory caching automatically within a single process run).

---

## 9. Assumptions and Uncertainties

### 9.1 Assumptions

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| Exchange Online basic auth for IMAP is permanently disabled (not just temporarily blocked) | HIGH | No impact — Microsoft's official documentation is unambiguous: "no one (you or Microsoft support) can re-enable Basic authentication" |
| imapflow `auth.accessToken` field handles XOAUTH2 encoding internally | HIGH | Implementation would need manual base64 encoding, which is straightforward |
| Gmail app passwords will remain available for personal accounts through 2026 | MEDIUM | Google has shown a pattern of incremental tightening; they could phase out app passwords for personal accounts in the future |
| Client credentials flow is unavailable for personal Outlook.com accounts | HIGH | Personal consumer accounts do not have an Azure tenant, making enterprise OAuth2 flows inapplicable |

### 9.2 Uncertainties

- **Yahoo app password longevity**: Yahoo has moved to OAuth2 as its preferred method. It is unclear if Yahoo will eventually require OAuth2 and remove app password support for IMAP (as they did for plain passwords in May 2024).
- **iCloud password format**: Some sources note that iCloud app-specific passwords include hyphens (`xxxx-xxxx-xxxx-xxxx`) that may need to be stripped depending on the IMAP client. imapflow should handle this transparently, but it should be tested.
- **FastMail plan boundary**: FastMail's Basic plan does not include IMAP access. There is no programmatic way to detect this — users on the Basic plan will receive an authentication error.
- **Google Workspace OAuth2 for personal use**: Some Google Workspace accounts are set up by individuals (not corporations). The "May 2025 deadline" for Workspace accounts may affect a broader audience than expected.

### 9.3 Clarifying Questions for Follow-up

1. Are Microsoft 365 personal consumer Outlook.com accounts in scope at all? If not, the limitation should be documented but does not need an OAuth2 solution.
2. Is Google Workspace (organizational Gmail) in scope for the initial release, or only personal `@gmail.com` accounts?
3. Should the implementation proactively detect when a user provides an M365 IMAP host and surface a clear, actionable error message rather than a generic IMAP authentication failure?
4. Is there a preference for supporting OAuth2 via the Device Code flow (browser-based, interactive) as an alternative to client credentials for users who cannot set up service principals?

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | Microsoft Learn: Deprecation of Basic Authentication in Exchange Online | https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online | Official confirmation of IMAP basic auth removal date (end 2022), permanently irrevocable, SMTP AUTH still transitioning |
| 2 | Microsoft Tech Community: Exchange Online SMTP AUTH Deprecation | https://techcommunity.microsoft.com/blog/exchange/exchange-online-to-retire-basic-auth-for-client-submission-smtp-auth/4114750 | SMTP AUTH timeline, distinction from IMAP auth status |
| 3 | Updated SMTP AUTH Timeline (January 2026) | https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835 | Latest SMTP AUTH phased retirement dates |
| 4 | Microsoft Learn: Authenticate IMAP/POP/SMTP with OAuth | https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth | Step-by-step OAuth2 setup for Exchange Online IMAP, required scopes, XOAUTH2 format |
| 5 | Mailbird: Microsoft Modern Authentication Enforcement in 2026 | https://www.getmailbird.com/microsoft-modern-authentication-enforcement-email-guide/ | Consumer account behavior, new account limitations |
| 6 | Mautic GitHub Issue: IMAP basic auth deprecated in M365 | https://github.com/mautic/mautic/issues/12041 | Real-world impact confirmation for application developers |
| 7 | Google Support: Sign in with app passwords | https://support.google.com/mail/answer/185833?hl=en | Official Gmail app password documentation |
| 8 | imapflow GitHub Issue #117: OAuth2 for Outlook 365 | https://github.com/postalsys/imapflow/issues/117 | Community confirmation of imapflow XOAUTH2 usage with MSAL tokens |
| 9 | imapflow Documentation | https://imapflow.com/module-imapflow-ImapFlow.html | auth.accessToken field documentation |
| 10 | Google Developers: XOAUTH2 Protocol for Gmail | https://developers.google.com/workspace/gmail/imap/xoauth2-protocol | SASL XOAUTH2 format specification |
| 11 | Microsoft Learn: MSAL Authentication Flows | https://learn.microsoft.com/en-us/entra/identity-platform/msal-authentication-flows | Client credentials flow description and Node.js MSAL patterns |
| 12 | Limilabs: OAuth2 Client Credentials Flow for Exchange IMAP | https://www.limilabs.com/blog/oauth2-client-credential-flow-office365-exchange-imap-pop3-smtp | Practical OAuth2 setup for Exchange Online IMAP with code examples |
| 13 | Apple Support: App-specific passwords | https://support.apple.com/en-us/102654 | iCloud app-specific password setup process |
| 14 | Apple Support: iCloud Mail server settings | https://support.apple.com/en-us/102525 | iCloud IMAP server settings (imap.mail.me.com, port 993) |
| 15 | Yahoo Help: IMAP basic authorization discontinuation | https://help.yahoo.com/kb/SLN36636.html | Yahoo IMAP basic auth removal timeline (May 2024) |
| 16 | FastMail Help: App passwords | https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords | FastMail app password setup and plan requirements |
| 17 | Mailjerry: How to Create a Gmail App Password in 2026 | https://www.mailjerry.com/create-gmail-app-password | Step-by-step Gmail app password process confirmation |
| 18 | Microsoft Learn: OAuth2 Client Credentials Grant Flow | https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow | Client credentials flow technical details and token lifetime |

### Recommended for Deep Reading

- **Microsoft Learn: Authenticate IMAP/POP/SMTP with OAuth** (Source #4): The definitive reference for implementing OAuth2 IMAP access for Exchange Online. Contains exact PowerShell commands for service principal setup, required API permissions, and step-by-step instructions.
- **imapflow Documentation** (Source #9): Official reference for the `auth.accessToken` property. Confirms imapflow handles XOAUTH2 encoding automatically.
- **Limilabs: OAuth2 Client Credentials for Exchange IMAP** (Source #12): Practical third-party guide with working code examples that cross-references the Microsoft documentation.
