# Xianyu Assistant Chrome Extension Design

## 1. Background

The project is a private Chrome extension named `xianyu-assistant`. It helps a seller turn a Taobao or JD product link into an editable Xianyu listing draft, optionally improve the factual copy with an OpenAI-compatible model, and fill the Xianyu web publishing form. The extension must stop before the final Xianyu publish action so the user remains responsible for reviewing and submitting the listing.

The implementation may learn from `donggeai/xianyu-skills`, specifically its Xianyu page discovery, form-field identification, category-warning detection, login-state checks, and post-action diagnostics. It must not copy the reference repository's Python WebSocket bridge, cookie access, debugger access, unrestricted evaluation endpoint, or broad permanent host permissions.

## 2. Goals

- Build a Manifest V3 Chrome extension with an original right-side assistant experience using Chrome's native Side Panel API.
- Parse product details and images from Taobao, Tmall, and JD URLs.
- Preserve a generic structured-data parser as a fallback for unsupported shopping pages.
- Allow the user to edit all listing content before any Xianyu interaction.
- Improve a user-authored title and description through an OpenAI-compatible Chat Completions endpoint.
- Open or reuse a Xianyu publishing tab, detect login state, and fill supported fields and images.
- Never click Xianyu's final publish button.
- Store drafts and AI configuration locally in the browser.
- Provide repeatable local development, test, production-build, and ZIP packaging commands.
- Deliver the source on the `main` branch of a private `yanquankun/xianyu-assistant` GitHub repository and add the local repository to GitHub Desktop.

## 3. Non-goals

- No automatic final publication, scheduled publication, bulk publication, message automation, favorites, or "I want it" actions.
- No server-side application, account system, database, telemetry, analytics, or remote draft synchronization.
- No Cookie API, Chrome Debugger API, browser-history access, or permanent `<all_urls>` permission.
- No guarantee that every Taobao or JD page can be parsed when the site requires CAPTCHA, extra login verification, application-only access, or changes its DOM.
- No attempt to bypass CAPTCHA, risk-control pages, paywalls, login controls, or platform restrictions.
- No AI-generated claims about condition, authenticity, inventory, warranty, authorization, shipping time, after-sales service, or any fact absent from parsed or user-supplied data.

## 4. Recommended Architecture

Use WXT, React, TypeScript, and Manifest V3. WXT provides build-time entrypoint discovery and produces the final Chrome manifest and extension package. React renders the side panel. Browser-specific logic stays behind typed interfaces so parsers, AI request construction, permission calculation, and Xianyu automation decisions can be tested without a live browser.

The project contains these runtime units:

1. **Side panel application**
   - Holds the editing workflow, configuration screen, status banner, image selection, and operation log.
   - Sends typed messages to the background service worker.
   - Never reads or writes page DOM directly.

2. **Background service worker**
   - Opens the side panel from the toolbar action.
   - Requests optional origin access during an explicit user gesture.
   - Finds, opens, activates, and observes product or Xianyu tabs.
   - Calls configured AI endpoints from a trusted extension context.
   - Coordinates extraction and form-fill content scripts.

3. **Product extraction content script**
   - Runs only after the user provides a URL and grants access to that origin.
   - Extracts JSON-LD, Open Graph, canonical URL, visible price/title/description text, and candidate product images.
   - Selects a Taobao/Tmall, JD, or generic adapter by normalized hostname.

4. **Xianyu automation content script**
   - Runs only on `https://www.goofish.com/*`.
   - Detects whether the current page represents a logged-in account, login prompt, or publishing form.
   - Fills supported text, numeric, and image fields using observable DOM events.
   - Returns a structured result with filled fields, skipped fields, warnings, current URL, and visible page messages.
   - Contains no command that clicks a final publish control.

5. **Persistence layer**
   - Stores AI settings, user preferences, current draft, and bounded operation history through `chrome.storage.local`.
   - Restricts storage access to trusted extension contexts where Chrome supports access-level controls.

## 5. Technology Decisions

- Runtime: Chrome 116 or newer. Chrome 114 introduced Side Panel support; Chrome 116 supports programmatic opening from a user gesture.
- Extension framework: WXT with a React entrypoint.
- Language: TypeScript with strict mode and no `any` escapes.
- Package manager: `pnpm` with a committed lockfile.
- Tests: Vitest with happy-dom or jsdom fixtures for pure logic and DOM adapters; Playwright with an isolated Chromium profile and local fixture pages for extension integration flows.
- Formatting and linting: ESLint and Prettier, integrated into a single `pnpm check` command together with TypeScript validation.
- Styling: plain CSS modules or scoped CSS, with responsive units such as `rem`, `em`, `%`, `vh`, and `vw`. Do not use `px` values and do not include Emoji in interface copy, code comments, or documentation.

Required package scripts:

- `pnpm dev`: start WXT development mode for Chrome.
- `pnpm test`: run the Vitest suite once.
- `pnpm test:watch`: run Vitest in watch mode.
- `pnpm test:e2e`: run isolated Playwright extension tests against local fixtures.
- `pnpm typecheck`: run TypeScript validation without emitting files.
- `pnpm lint`: run ESLint.
- `pnpm check`: run lint, typecheck, unit tests, and production build.
- `pnpm build`: produce the unpacked production extension.
- `pnpm zip`: produce a distributable Chrome extension ZIP archive.

## 6. Permissions Model

Required permissions:

- `sidePanel` for the native side panel.
- `storage` for local settings and drafts.
- `activeTab` and `scripting` for user-initiated page extraction and form filling.
- `tabs` for finding or creating the source and Xianyu tabs and reading permitted tab state.

Required host permission:

- `https://www.goofish.com/*` because form filling is a core feature and should not require a repeated permission prompt.

Optional host permissions:

- `https://*/*` and `http://*/*` are declared only in `optional_host_permissions`. The extension requests the exact URL origin at runtime for the submitted Taobao/JD page or configured AI endpoint.

The extension must explain the requested origin and purpose before triggering Chrome's permission prompt. Permission rejection leaves the user's draft intact and produces an actionable message. It must not request cookies, debugger, history, downloads, clipboard, webRequest, or unlimited storage.

## 7. Side Panel User Experience

The product name shown in the interface is "闲鱼上架助手". The original visual system uses neutral white and light-gray surfaces, dark text, and a restrained yellow accent inspired by marketplace workflows without copying ChatGPT or Xianyu branded navigation.

The panel has three top-level views:

1. **商品整理**
   - Xianyu login status banner.
   - Product URL input and "解析商品" action.
   - Parsed source summary and parser confidence/warnings.
   - Selectable image grid with source-host labels and failed-image states.
   - Editable title, price, original price, description, shipping method, and category note.
   - "AI 扩写" and "填入闲鱼" actions.
   - Persistent warning that final publication must be performed manually.

2. **AI 配置**
   - Base URL, API Key, model, temperature, and optional system instruction fields.
   - Masked API Key display after save.
   - "测试连接" action that sends a minimal request and reports status without logging the key.
   - Defaults to a Chat Completions request at `{normalizedBaseUrl}/chat/completions`.

3. **运行记录**
   - A bounded local history of parse, AI, login, and form-fill outcomes.
   - Human-readable timestamp, stage, outcome, and non-sensitive error details.
   - No API keys, authorization headers, cookies, full HTML, or image binary data.

The panel uses the browser's configured side. Chrome does not permit an extension to force the right side. If the API reports a left-side layout, onboarding copy explains how the user can change Chrome's side-panel alignment.

## 8. Product Parsing

### 8.1 URL validation

- Accept only absolute `http` or `https` URLs.
- Normalize the hostname and remove URL credentials before storage or logs.
- Reject browser-internal, local-file, JavaScript, data, and extension URLs.
- Classify `taobao.com` and `tmall.com` as Taobao-family pages, and `jd.com` as JD pages.

### 8.2 Extraction order

1. Reuse the current tab if it already displays the normalized submitted URL.
2. Otherwise create an inactive temporary tab for the source URL.
3. Wait for the page to complete or reach a bounded extraction timeout.
4. Extract JSON-LD `Product` objects.
5. Extract Open Graph and standard metadata.
6. Run the host-specific DOM adapter.
7. Merge candidates using source priority and confidence rules.
8. Deduplicate and normalize image URLs.
9. Close only the temporary tab created by the extension.

If the page requires login, CAPTCHA, or app-only viewing, preserve partial results and return a user-facing warning. The extension never attempts to bypass the restriction.

### 8.3 Parsed draft

The normalized draft contains:

- source platform and canonical URL;
- source title and editable listing title;
- source price, optional original price, and currency;
- source description and editable listing description;
- image candidates with selected state and load status;
- extraction warnings and confidence;
- user-entered shipping method and category note.

## 9. AI Expansion

AI configuration follows the OpenAI-compatible Chat Completions request shape:

- `Base URL`, normalized without a trailing slash;
- `API Key`, transmitted only in the `Authorization: Bearer` header to the configured endpoint;
- `Model`;
- bounded `Temperature`;
- optional user-authored system instruction.

The AI prompt includes only the source facts, current editable draft, selected style instruction, and explicit constraints. The response must conform to a validated JSON object with `title`, `description`, and `warnings`. Invalid JSON, missing required fields, oversized output, network errors, authorization failures, and rate limits preserve the existing draft and produce a recoverable error.

AI output is never applied silently. The side panel shows the proposed title and description, and the user explicitly applies or discards it. Before applying, the extension highlights price changes or claims absent from the factual input.

## 10. Xianyu Automation

When the user selects "填入闲鱼":

1. Validate that the draft has a non-empty title/description, a valid positive price, and at least one selected loadable image.
2. Reuse the current tab if it is already on `www.goofish.com`.
3. Otherwise activate an existing Xianyu tab when one exists.
4. Otherwise open `https://www.goofish.com/publish` in a new active tab.
5. Wait for the page to settle and execute login-state detection.
6. If logged out, stop immediately, keep the draft, display "需要登录闲鱼", and offer a user-initiated button to open the login page.
7. If logged in but not on the publishing page, navigate the selected Xianyu tab to the publishing URL.
8. Fetch selected remote images from their user-approved origins in the background worker, validate MIME type and size, and pass them to the page as `File` objects through a controlled content-script message.
9. Fill fields by dispatching the input, change, and focus/blur events expected by controlled web forms.
10. Read the resulting page state and return filled, skipped, and warning fields.
11. Leave the page visible for user review.

The automation module has no selector, text match, command name, message type, or exported interface for clicking a final publish button. Tests must assert this absence and verify that the workflow ends after form fill.

DOM changes are expected. Selectors therefore use ordered strategies: semantic label and accessible name, stable input attributes, observed component structure, and visible text as the final fallback. Failure to locate a field is reported rather than treated as a successful fill.

## 11. Error Handling

- Every cross-context message returns a discriminated success or failure result.
- Errors shown to users include the failed stage, actionable recovery, and whether the draft was preserved.
- Parser timeouts, permission denial, AI failure, image-download failure, Xianyu login absence, unsupported category markers, and missing page elements have separate error codes.
- Logs redact API keys, authorization headers, URL credentials, cookies, and raw page HTML.
- Background operations are cancellable when the side panel closes or the user starts a newer parse for the same draft.

## 12. Test Strategy

TDD applies to every behavior-bearing module. Each implementation begins with a failing test and proceeds through red, green, and refactor cycles.

Unit and DOM-fixture coverage includes:

- URL validation, hostname normalization, and exact origin permission calculation.
- Taobao/Tmall JSON-LD, Open Graph, and DOM fallback extraction.
- JD JSON-LD, Open Graph, and DOM fallback extraction.
- Generic parser fallback and malformed structured data.
- Product candidate merge, price normalization, image deduplication, and warning generation.
- AI endpoint normalization, request construction, redaction, response validation, and fact-drift warnings.
- Xianyu login-state classification using logged-in, logged-out, and ambiguous fixtures.
- Xianyu field fill results, missing fields, unsupported categories, and event dispatch.
- Tab selection rules for current Xianyu page, existing Xianyu tab, and newly created tab.
- The invariant that no final publication action exists or is invoked.

Isolated Playwright coverage includes:

- Toolbar action opens the side panel.
- Runtime permission acceptance and rejection using controlled fixture origins.
- Taobao and JD fixtures populate an editable draft.
- Mock OpenAI-compatible responses produce an explicit preview before apply.
- A logged-out Xianyu fixture shows the login warning.
- A logged-in Xianyu publishing fixture is filled and remains unsubmitted.
- Production extension output loads successfully in an isolated Chromium profile.

Live Xianyu verification, when authorized separately, is limited to loading the unpacked extension, checking login state, filling a disposable draft, and confirming that the user remains in control of final publication.

## 13. Delivery and Acceptance

The work is accepted only when all of the following are evidenced:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, and `pnpm zip` exit successfully.
- The unpacked extension loads in isolated Chromium and opens the side panel.
- Taobao and JD fixtures populate title, price, description, and image candidates.
- AI settings can be saved, masked, tested, and used without exposing the API key in logs.
- The Xianyu fixture distinguishes logged-in and logged-out states.
- The form-fill fixture ends with populated fields and an untouched final publish control.
- README documents prerequisites, development, packaging, Chrome loading, permissions, AI configuration, supported platforms, platform limitations, and manual publication responsibility.
- Git history is on `main` with no committed secrets or generated dependency directories.
- GitHub repository `yanquankun/xianyu-assistant` exists with private visibility and the verified `main` branch is pushed.
- The local repository is present in GitHub Desktop.

## 14. Risks and Mitigations

- **Shopping-page DOM drift:** Prefer structured data, isolate host adapters, maintain local fixtures, and surface partial results.
- **Xianyu DOM drift:** Use ordered selector strategies, fixture tests, structured diagnostics, and fail visibly on missing fields.
- **CAPTCHA or risk control:** Stop and ask the user to complete the platform's own flow; never bypass it.
- **Remote image restrictions:** Request the exact source origin, validate response type/size, report failures per image, and allow manual removal.
- **API key exposure:** Keep it in trusted extension storage, mask it in UI, redact logs, never sync or commit it, and document local-storage limitations.
- **AI factual drift:** Use fact-constrained prompts, structured validation, a diff preview, and explicit user application.
- **Accidental publication:** Do not implement a publish-click command and enforce the absence with tests.
- **Chrome side placement:** Explain that the browser controls left/right placement and provide instructions rather than claiming the extension can force it.

## 15. Authoritative References

- Chrome Side Panel API: <https://developer.chrome.com/docs/extensions/reference/api/sidePanel>
- Chrome Permissions API: <https://developer.chrome.com/docs/extensions/reference/api/permissions>
- Chrome permission declaration guidance: <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>
- Chrome Storage API: <https://developer.chrome.com/docs/extensions/reference/api/storage>
- WXT manifest generation: <https://wxt.dev/guide/essentials/config/manifest.html>
- WXT entrypoints: <https://wxt.dev/guide/essentials/entrypoints>
